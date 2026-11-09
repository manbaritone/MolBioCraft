// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Sequence-exact in-silico cloning. Every construct is assembled from real cut sites, homology
//! arms or recombination sites found in the input sequences; when the inputs do not support a
//! method (enzyme does not cut, cuts more than once, insert lacks the site, no att sites, …) the
//! simulation fails with an explanation instead of inventing an insertion point.
//!
//! Fragments carry their annotations: features (including segmented and origin-spanning ones) that
//! lie wholly inside a kept fragment are transferred with corrected coordinates; features cut by
//! the cloning are dropped and counted in the warnings.

use crate::cloning_crispr::CloningOutcome;
use crate::rebase_catalog::{get_rebase_enzymes, scan_restriction_sites, RestrictionPositionLimit};
use crate::thermodynamics::calculate_primer_metrics;
use molbiocraft_core::{
    clean_alpha_sequence, reverse_complement_iupac, FeatureSegment, HistoryTreeNode, InsertedRange,
    MoleculeType, RestrictionCutSite, RestrictionEnzyme, SequenceDocument, SequenceFeature, Topology,
};

/// A linear stretch of DNA with the features that lie wholly inside it (1-based, inclusive).
#[derive(Clone, Default)]
struct Piece {
    seq: String,
    feats: Vec<SequenceFeature>,
}

fn intervals(f: &SequenceFeature, len: usize) -> Vec<(usize, usize)> {
    match &f.segments {
        Some(segs) if !segs.is_empty() => segs.iter().map(|s| (s.start, s.end)).collect(),
        _ if f.start > f.end => vec![(f.start, len), (1, f.end)],
        _ => vec![(f.start, f.end)],
    }
}

fn with_intervals(f: &SequenceFeature, mut ivs: Vec<(usize, usize)>) -> SequenceFeature {
    // merge abutting intervals (an origin-spanning feature becomes contiguous once moved)
    let mut merged: Vec<(usize, usize)> = Vec::new();
    for iv in ivs.drain(..) {
        match merged.last_mut() {
            Some(last) if iv.0 == last.1 + 1 => last.1 = iv.1,
            _ => merged.push(iv),
        }
    }
    let mut nf = f.clone();
    nf.start = merged.iter().map(|x| x.0).min().unwrap_or(1);
    nf.end = merged.iter().map(|x| x.1).max().unwrap_or(1);
    nf.segments = (merged.len() > 1).then(|| {
        merged
            .iter()
            .enumerate()
            .map(|(i, &(a, b))| {
                let old = f.segments.as_ref().and_then(|s| s.get(i));
                FeatureSegment {
                    index: i + 1,
                    name: old.map(|o| o.name.clone()).unwrap_or_else(|| format!("{} part {}", f.name, i + 1)),
                    start: a,
                    end: b,
                    color: old.map(|o| o.color.clone()).unwrap_or_else(|| f.color.clone()),
                }
            })
            .collect()
    });
    nf
}

/// Extract `[start0, start0 + len)` (0-based) from a document; for circular documents the
/// region may run through the origin.
fn extract(doc_seq: &str, features: &[SequenceFeature], circular: bool, start0: usize, len: usize) -> (Piece, usize) {
    let l = doc_seq.len();
    let seq: String = if circular {
        (0..len).map(|k| doc_seq.as_bytes()[(start0 + k) % l] as char).collect()
    } else {
        doc_seq[start0..(start0 + len).min(l)].to_string()
    };
    let end = start0 + len;
    let mut kept = Vec::new();
    let mut dropped = 0usize;
    for f in features {
        let mut mapped = Vec::new();
        let mut ok = true;
        for (a, b) in intervals(f, l) {
            let (a0, b0) = (a - 1, b); // half-open
            let k = [0usize, l, 2 * l].into_iter().find(|&k| a0 + k >= start0 && b0 + k <= end && (circular || k == 0));
            match k {
                Some(k) => mapped.push((a0 + k - start0 + 1, b0 + k - start0)),
                None => {
                    ok = false;
                    break;
                }
            }
        }
        if ok {
            mapped.sort_unstable();
            kept.push(with_intervals(f, mapped));
        } else if intervals(f, l).iter().any(|&(a, b)| {
            // count only features that overlap the region (cut by the cloning)
            [0usize, l].iter().any(|&k| (a - 1 + k) < end && (b + k) > start0)
        }) {
            dropped += 1;
        }
    }
    (Piece { seq, feats: kept }, dropped)
}

fn rc_piece(p: &Piece) -> Piece {
    let l = p.seq.len();
    let feats = p
        .feats
        .iter()
        .map(|f| {
            let mut ivs: Vec<(usize, usize)> = intervals(f, l).into_iter().map(|(a, b)| (l + 1 - b, l + 1 - a)).collect();
            ivs.sort_unstable();
            let mut nf = with_intervals(f, ivs);
            nf.strand = -f.strand;
            nf
        })
        .collect();
    Piece { seq: reverse_complement_iupac(&p.seq, false), feats }
}

fn concat(parts: &[&Piece]) -> Piece {
    let mut out = Piece::default();
    for p in parts {
        let off = out.seq.len();
        for f in &p.feats {
            let ivs = intervals(f, p.seq.len()).into_iter().map(|(a, b)| (a + off, b + off)).collect();
            out.feats.push(with_intervals(f, ivs));
        }
        out.seq.push_str(&p.seq);
    }
    out
}

/// Rotate a circular sequence so 0-based index `origin0` becomes base 1; features crossing the new
/// origin become two-segment (origin-spanning) features.
pub(crate) fn rotate_features(seq: &str, feats: &[SequenceFeature], origin0: usize) -> (String, Vec<SequenceFeature>) {
    let r = rotate(&Piece { seq: seq.to_string(), feats: feats.to_vec() }, origin0);
    (r.seq, r.feats)
}

fn rotate(p: &Piece, origin0: usize) -> Piece {
    let l = p.seq.len();
    if l == 0 || origin0 % l == 0 {
        return p.clone();
    }
    let o = origin0 % l;
    let seq = format!("{}{}", &p.seq[o..], &p.seq[..o]);
    let feats = p
        .feats
        .iter()
        .map(|f| {
            let mut ivs = Vec::new();
            for (a, b) in intervals(f, l) {
                let na = (a - 1 + l - o) % l + 1;
                let nb = (b - 1 + l - o) % l + 1;
                if na <= nb {
                    ivs.push((na, nb));
                } else {
                    ivs.push((na, l));
                    ivs.push((1, nb));
                }
            }
            with_intervals(f, ivs)
        })
        .collect();
    Piece { seq, feats }
}

fn enzyme_by_name(name: &str) -> Result<RestrictionEnzyme, String> {
    let n = name.trim();
    get_rebase_enzymes()
        .into_iter()
        .find(|e| e.name.eq_ignore_ascii_case(n))
        .or_else(|| {
            // "BsaI" → "BsaI-HFv2" etc.
            get_rebase_enzymes().into_iter().find(|e| {
                e.name.split('-').next().is_some_and(|b| b.eq_ignore_ascii_case(n))
            })
        })
        .ok_or_else(|| format!("Unknown enzyme \"{n}\"."))
}

/// Every cut of `e`: each site Dam and Dcm methylation does not block, none left out, since the
/// messages count them and Golden Gate checks each one (BG-01M6S1K2).
fn cuts(seq: &str, topo: Topology, e: &RestrictionEnzyme) -> Vec<RestrictionCutSite> {
    scan_restriction_sites(seq, topo, Some(std::slice::from_ref(e)), RestrictionPositionLimit::All)
        .sites
        .into_iter()
        .filter(|c| !c.methylation_blocked)
        .collect()
}

fn unique_cut(seq: &str, topo: Topology, e: &RestrictionEnzyme, what: &str) -> Result<RestrictionCutSite, String> {
    let c = cuts(seq, topo, e);
    match c.len() {
        0 => Err(format!("{} does not cut the {what}.", e.name)),
        1 => Ok(c.into_iter().next().unwrap()),
        n => Err(format!("{} cuts the {what} {n} times; choose an enzyme with a unique site.", e.name)),
    }
}

fn doc_piece(doc: &SequenceDocument, seq: &str) -> Piece {
    Piece { seq: seq.to_string(), feats: doc.features.clone() }
}

struct Built {
    product: Piece,
    circular: bool,
    insert_range: (usize, usize), // 1-based inclusive in the final product
    left_label: String,
    right_label: String,
    summary: String,
    operation: String,
    warnings: Vec<String>,
}

fn fail(vector: &SequenceDocument, method: &str, reason: String, mut warnings: Vec<String>) -> CloningOutcome {
    warnings.insert(0, reason.clone());
    CloningOutcome {
        success: false,
        method: method.to_string(),
        construct_document: vector.clone(),
        summary: format!("{method} could not be simulated: {reason}"),
        left_junction_seq: String::new(),
        right_junction_seq: String::new(),
        overhang_or_homology_left: String::new(),
        overhang_or_homology_right: String::new(),
        warnings,
    }
}

/// Linearize a circular vector by removing the stuffer between two cuts (or opening it at one cut).
/// Returns the backbone (starting at the downstream cut, ending at the upstream cut), the
/// upstream and downstream cut sites, and the 0-based vector index of the backbone's first base.
fn open_vector(
    vseq: &str,
    vector: &SequenceDocument,
    e_a: &RestrictionEnzyme,
    e_b: &RestrictionEnzyme,
    warnings: &mut Vec<String>,
) -> Result<(Piece, RestrictionCutSite, RestrictionCutSite, usize), String> {
    let l = vseq.len();
    let circular = vector.topology == Topology::Circular;
    let ca = unique_cut(vseq, vector.topology, e_a, "vector")?;
    let cb = if e_a.name == e_b.name { ca.clone() } else { unique_cut(vseq, vector.topology, e_b, "vector")? };
    let (pa, pb) = (ca.cut_top - 1, cb.cut_top - 1);
    if !circular {
        return Err("The vector is linear; circular vectors are linearized by the selected enzymes.".into());
    }
    if pa == pb {
        // single cut: the whole plasmid becomes the backbone
        let (bb, _) = extract(vseq, &vector.features, true, pa, l);
        return Ok((bb, ca.clone(), ca, pa));
    }
    // two cuts → two fragments; the larger one is the backbone, the smaller one the stuffer
    let (lo, hi, c_lo, c_hi) = if pa < pb { (pa, pb, ca, cb) } else { (pb, pa, cb, ca) };
    let inner = hi - lo;
    let outer = l - inner;
    if inner.min(outer) * 10 > l * 4 {
        warnings.push("The two vector fragments are of similar size; the larger one was taken as the backbone.".into());
    }
    let (start, len, up, down) = if outer >= inner { (hi, outer, c_lo, c_hi) } else { (lo, inner, c_hi, c_lo) };
    let (bb, dropped) = extract(vseq, &vector.features, true, start, len);
    if dropped > 0 {
        warnings.push(format!("{dropped} vector feature(s) overlapping the removed fragment were not transferred."));
    }
    Ok((bb, up, down, start))
}

/// Insert fragment between the cut of `e_left` and the cut of `e_right`, read in whichever
/// orientation puts `e_left` first.
fn insert_fragment(
    iseq: &str,
    insert: &SequenceDocument,
    e_left: &RestrictionEnzyme,
    e_right: &RestrictionEnzyme,
    warnings: &mut Vec<String>,
) -> Result<(Piece, RestrictionCutSite, RestrictionCutSite), String> {
    let l = iseq.len();
    let circular = insert.topology == Topology::Circular;
    for (seq, flipped) in [(iseq.to_string(), false), (reverse_complement_iupac(iseq, false), true)] {
        let base_piece = if flipped { rc_piece(&doc_piece(insert, iseq)) } else { doc_piece(insert, iseq) };
        let topo = insert.topology;
        let cl = cuts(&seq, topo, e_left);
        let cr = cuts(&seq, topo, e_right);
        let pair = if e_left.name == e_right.name {
            (cl.len() == 2).then(|| (cl[0].clone(), cl[1].clone()))
        } else if cl.len() == 1 && cr.len() == 1 && (circular || cl[0].cut_top < cr[0].cut_top) {
            Some((cl[0].clone(), cr[0].clone()))
        } else {
            None
        };
        let Some((c1, c2)) = pair else { continue };
        let (p1, p2) = (c1.cut_top - 1, c2.cut_top - 1);
        let len = if p2 > p1 { p2 - p1 } else { l - p1 + p2 };
        let (piece, dropped) = extract(&seq, &base_piece.feats, circular, p1, len);
        if dropped > 0 {
            warnings.push(format!("{dropped} insert feature(s) cut by the digest were not transferred."));
        }
        if flipped {
            warnings.push("The insert was used in reverse-complement orientation to match the enzyme order in the vector.".into());
        }
        return Ok((piece, c1, c2));
    }
    let count = |e: &RestrictionEnzyme| cuts(iseq, insert.topology, e).len();
    if e_left.name == e_right.name {
        Err(format!(
            "The insert must contain exactly two {} sites to release a fragment (found {}).",
            e_left.name,
            count(e_left)
        ))
    } else {
        Err(format!(
            "The insert needs one {} and one {} site (found {} and {}); add them with PCR primer tails.",
            e_left.name,
            e_right.name,
            count(e_left),
            count(e_right)
        ))
    }
}

fn restriction_ligation(v: &SequenceDocument, vs: &str, i: &SequenceDocument, is: &str, e5: &str, e3: &str) -> Result<Built, String> {
    let (ea, eb) = (enzyme_by_name(e5)?, enzyme_by_name(e3)?);
    let mut warnings = Vec::new();
    let (bb, up, down, bb_start) = open_vector(vs, v, &ea, &eb, &mut warnings)?;
    // the insert's left end joins the backbone's upstream end (its 3' end)
    let e_left = if up.enzyme.name == ea.name { ea.clone() } else { eb.clone() };
    let e_right = if down.enzyme.name == ea.name { ea.clone() } else { eb.clone() };
    let (ins, c1, c2) = insert_fragment(is, i, &e_left, &e_right, &mut warnings)?;
    if up.overhang_seq != c1.overhang_seq || down.overhang_seq != c2.overhang_seq || up.overhang_type != c1.overhang_type {
        return Err("The vector and insert ends are not compatible.".into());
    }
    if ea.name == eb.name {
        warnings.push(format!(
            "Single-enzyme ({}) cloning is non-directional (two orientations) and the vector can self-ligate; dephosphorylate it.",
            ea.name
        ));
    }
    let product = concat(&[&bb, &ins]);
    let l_v = vs.len();
    // rotate so the original vector origin stays at base 1 when it is in the backbone
    let origin = (l_v - bb_start) % l_v;
    let rot = if origin < bb.seq.len() { origin } else { 0 };
    let product = rotate(&product, rot);
    let ins_start = (bb.seq.len() + product.seq.len() - rot) % product.seq.len() + 1;
    Ok(Built {
        insert_range: (ins_start, ins_start + ins.seq.len() - 1),
        circular: true,
        left_label: format!("{} {} ({})", up.enzyme.name, up.overhang_seq_or_blunt(), up.overhang_type),
        right_label: format!("{} {} ({})", down.enzyme.name, down.overhang_seq_or_blunt(), down.overhang_type),
        summary: format!(
            "{}-cut insert ({} bp) ligated into the {}-opened {} backbone ({} bp): {} bp circular construct.",
            if ea.name == eb.name { ea.name.clone() } else { format!("{}/{}", ea.name, eb.name) },
            ins.seq.len(),
            if ea.name == eb.name { ea.name.clone() } else { format!("{}/{}", ea.name, eb.name) },
            v.name,
            bb.seq.len(),
            product.seq.len()
        ),
        operation: format!("Restriction Ligation ({} / {})", ea.name, eb.name),
        product,
        warnings,
    })
}

trait OverhangLabel {
    fn overhang_seq_or_blunt(&self) -> String;
}
impl OverhangLabel for RestrictionCutSite {
    fn overhang_seq_or_blunt(&self) -> String {
        if self.overhang_seq.is_empty() {
            "blunt".into()
        } else {
            format!("5'-{}-3'", self.overhang_seq)
        }
    }
}

/// Gibson / NEBuilder HiFi / In-Fusion: the insert is joined to the opened vector through
/// homology arms copied from the vector ends (added by primer tails, or already present).
fn homology_assembly(v: &SequenceDocument, vs: &str, i: &SequenceDocument, is: &str, e5: &str, e3: &str, arm: usize, label: &str) -> Result<Built, String> {
    let mut warnings = Vec::new();
    let (bb, up, bb_start, opened) = if v.topology == Topology::Linear {
        (doc_piece(v, vs), None, 0usize, "linear vector".to_string())
    } else {
        let (ea, eb) = (enzyme_by_name(e5)?, enzyme_by_name(e3)?);
        let (bb, up, _down, start) = open_vector(vs, v, &ea, &eb, &mut warnings)?;
        (bb, Some(up), start, format!("{}/{}-linearized vector", ea.name, eb.name))
    };
    // A 5' overhang at the upstream end is double-stranded vector sequence that the assembly keeps.
    let mut left = bb.clone();
    if let Some(c) = &up {
        if c.overhang_type == "5prime" {
            left.seq.push_str(&c.overhang_seq);
        } else if c.overhang_type == "3prime" {
            warnings.push(format!("{} leaves 3' overhangs; exonuclease-based assembly removes them — check the junction.", c.enzyme.name));
        }
    }
    let left_arm = left.seq[left.seq.len().saturating_sub(arm)..].to_string();
    let right_arm = bb.seq[..arm.min(bb.seq.len())].to_string();
    let mut insert_seq = is.to_string();
    let mut ins_piece = doc_piece(i, is);
    if is.starts_with(&left_arm) && is.ends_with(&right_arm) && is.len() > 2 * arm {
        let (p, _) = extract(is, &i.features, false, arm, is.len() - 2 * arm);
        ins_piece = p;
        insert_seq = ins_piece.seq.clone();
        warnings.push(format!("The insert already carries the {arm}-bp homology arms; they were not duplicated."));
    } else {
        warnings.push(format!(
            "Amplify the insert with primers carrying the {arm}-bp arms: forward 5'-{left_arm}…, reverse 5'-{}….",
            reverse_complement_iupac(&right_arm, false)
        ));
    }
    let left_body = Piece { seq: left.seq.clone(), feats: bb.feats.clone() };
    let product = concat(&[&left_body, &ins_piece]);
    let l_v = vs.len();
    let origin = (l_v - bb_start) % l_v.max(1);
    let rot = if v.topology == Topology::Circular && origin < bb.seq.len() { origin } else { 0 };
    let product = rotate(&product, rot);
    let ins_start = (left_body.seq.len() + product.seq.len() - rot) % product.seq.len() + 1;
    // An arm holding N has no Tm: the label gives the reason in its place (BG-01M6SHQ0).
    let arm_metrics = calculate_primer_metrics(&left_arm, 50.0, 10.0, 50.0);
    let overlap_tm = arm_metrics.tm_no_answer_reason.unwrap_or_else(|| format!("Tm {:.1} °C", arm_metrics.tm_c));
    Ok(Built {
        insert_range: (ins_start, ins_start + insert_seq.len() - 1),
        circular: true,
        left_label: format!("{} bp: 5'-{}-3' ({})", left_arm.len(), left_arm, overlap_tm),
        right_label: format!("{} bp: 5'-{}-3'", right_arm.len(), right_arm),
        summary: format!(
            "{label}: {} bp insert joined to the {opened} through {}-bp homology arms: {} bp circular construct.",
            insert_seq.len(),
            arm,
            product.seq.len()
        ),
        operation: label.to_string(),
        product,
        warnings,
    })
}

/// Golden Gate / MoClo: Type IIS digestion of vector and part; the fragments without
/// recognition sites are joined through their overhangs.
fn golden_gate(v: &SequenceDocument, vs: &str, i: &SequenceDocument, is: &str, enzyme: &str) -> Result<Built, String> {
    let e = enzyme_by_name(enzyme)?;
    if !e.is_type_iis {
        return Err(format!("{} is not a Type IIS enzyme.", e.name));
    }
    let mut warnings = Vec::new();
    let site_free = |seq: &str, topo: Topology, start0: usize, len: usize| -> bool {
        let l = seq.len();
        cuts(seq, topo, &e).iter().all(|c| {
            let rec0 = c.position - 1;
            let rel = (rec0 + l - start0) % l;
            rel + e.recognition_seq.len() > len || rel >= len
        }) && len > 0
    };
    let pick = |seq: &str, topo: Topology, what: &str| -> Result<(usize, usize, RestrictionCutSite, RestrictionCutSite), String> {
        let c = cuts(seq, topo, &e);
        if c.len() != 2 {
            return Err(format!("The {what} has {} {} sites; Golden Gate needs exactly two.", c.len(), e.name));
        }
        let l = seq.len();
        let (a, b) = (c[0].cut_top - 1, c[1].cut_top - 1);
        let options = if topo == Topology::Circular {
            vec![(a, (b + l - a) % l, c[0].clone(), c[1].clone()), (b, (a + l - b) % l, c[1].clone(), c[0].clone())]
        } else {
            vec![(a, b - a, c[0].clone(), c[1].clone())]
        };
        options
            .into_iter()
            .find(|&(s, len, _, _)| site_free(seq, topo, s, len))
            .ok_or_else(|| format!("No {what} fragment between the {} sites is free of recognition sites (sites point the wrong way).", e.name))
    };
    let (vs0, vlen, v_left_cut, v_right_cut) = pick(vs, v.topology, "vector")?;
    let (bb, dropped) = extract(vs, &v.features, v.topology == Topology::Circular, vs0, vlen);
    if dropped > 0 {
        warnings.push(format!("{dropped} vector feature(s) in the drop-out were not transferred."));
    }
    // backbone runs from v_left_cut (its 5' overhang begins it) to v_right_cut
    let up_oh = v_right_cut.overhang_seq.clone();
    let down_oh = v_left_cut.overhang_seq.clone();
    let mut ins: Option<(Piece, String, String)> = None;
    for flipped in [false, true] {
        let seq = if flipped { reverse_complement_iupac(is, false) } else { is.to_string() };
        let base = if flipped { rc_piece(&doc_piece(i, is)) } else { doc_piece(i, is) };
        if let Ok((s0, len, c1, c2)) = pick(&seq, i.topology, "insert") {
            if c1.overhang_seq == up_oh && c2.overhang_seq == down_oh {
                let (p, _) = extract(&seq, &base.feats, i.topology == Topology::Circular, s0, len);
                if flipped {
                    warnings.push("The part was used in reverse-complement orientation.".into());
                }
                ins = Some((p, c1.overhang_seq, c2.overhang_seq));
                break;
            }
        }
    }
    let Some((ins, oh_l, oh_r)) = ins else {
        let ins_err = pick(is, i.topology, "insert").err();
        return Err(ins_err.unwrap_or_else(|| {
            format!("The part's overhangs do not match the vector's ({up_oh} … {down_oh}).")
        }));
    };
    let product = concat(&[&bb, &ins]);
    let l_v = vs.len();
    let origin = (l_v - vs0) % l_v;
    let rot = if origin < bb.seq.len() { origin } else { 0 };
    let product = rotate(&product, rot);
    let ins_start = (bb.seq.len() + product.seq.len() - rot) % product.seq.len() + 1;
    if !cuts(&product.seq, Topology::Circular, &e).is_empty() {
        warnings.push(format!("The product still contains a {} site and would be re-cut during cycling.", e.name));
    }
    Ok(Built {
        insert_range: (ins_start, ins_start + ins.seq.len() - 1),
        circular: true,
        left_label: format!("5'-{oh_l}-3'"),
        right_label: format!("5'-{oh_r}-3'"),
        summary: format!(
            "{} Golden Gate: {} bp part joined to the {} bp backbone through {oh_l}/{oh_r} overhangs: {} bp construct.",
            e.name,
            ins.seq.len(),
            bb.seq.len(),
            product.seq.len()
        ),
        operation: format!("Golden Gate Assembly ({})", e.name),
        product,
        warnings,
    })
}

/// TA / GC and TOPO: the vector is a linear T-/TOPO vector, or is opened at the 5' enzyme's single blunt site.
fn open_end_vector(v: &SequenceDocument, vs: &str, e5: &str, what: &str, warnings: &mut Vec<String>) -> Result<(Piece, usize), String> {
    if v.topology == Topology::Linear {
        return Ok((doc_piece(v, vs), 0));
    }
    let e = enzyme_by_name(e5)?;
    let c = unique_cut(vs, v.topology, &e, "vector")?;
    if c.overhang_type != "blunt" {
        return Err(format!(
            "{what} needs a linear {what} vector (or a blunt single cut to model one); {} leaves {} overhangs.",
            e.name, c.overhang_type
        ));
    }
    warnings.push(format!("The vector was opened at its single {} site to model a linearized {what} vector.", e.name));
    let p = c.cut_top - 1;
    let (bb, _) = extract(vs, &v.features, true, p, vs.len());
    Ok((bb, p))
}

fn ta_or_topo(v: &SequenceDocument, vs: &str, i: &SequenceDocument, is: &str, e5: &str, topo: bool) -> Result<Built, String> {
    let mut warnings = Vec::new();
    let what = if topo { "TOPO" } else { "T-overhang" };
    let (bb, p0) = open_end_vector(v, vs, e5, what, &mut warnings)?;
    let directional = topo && is.starts_with("CACC");
    if topo && !directional {
        warnings.push("Directional (D-)TOPO cloning needs CACC at the insert's 5' end; this insert would clone in either orientation.".into());
    }
    if !topo {
        warnings.push("TA/GC cloning is non-directional: half of the clones carry the insert reversed.".into());
    }
    let ins = doc_piece(i, is);
    let product = concat(&[&bb, &ins]);
    let l_v = vs.len();
    let origin = (l_v - p0) % l_v.max(1);
    let rot = if v.topology == Topology::Circular && origin < bb.seq.len() { origin } else { 0 };
    let product = rotate(&product, rot);
    let ins_start = (bb.seq.len() + product.seq.len() - rot) % product.seq.len() + 1;
    Ok(Built {
        insert_range: (ins_start, ins_start + is.len() - 1),
        circular: true,
        left_label: if topo {
            "Vaccinia topoisomerase I at 5'-CCCTT-3' (vector end)".into()
        } else {
            "3'-dT vector overhang : 3'-dA insert overhang".into()
        },
        right_label: if topo {
            if directional { "GTGG vector overhang : CACC insert end".into() } else { "blunt".into() }
        } else {
            "3'-dA insert overhang : 3'-dT vector overhang".into()
        },
        summary: format!(
            "{} cloning of the {} bp insert into {}: {} bp circular construct.",
            if topo { "TOPO" } else { "TA/GC" },
            is.len(),
            v.name,
            product.seq.len()
        ),
        operation: if topo { "TOPO Cloning".into() } else { "TA / GC Cloning".into() },
        product,
        warnings,
    })
}

const ATT_B1: &str = "ACAAGTTTGTACAAAAAAGCAGGCT";
const ATT_B2: &str = "ACCCAGCTTTCTTGTACAAAGTGGT";
const ATT1_CORE: &str = "TTTGTACAAAAAAG";
const ATT2_CORE: &str = "CTTTCTTGTACAAAG";

/// Gateway LR/BP: the region between the vector's att1 and att2 sites (attR / attP cassette) is
/// replaced by attB1–insert–attB2. att-site boundaries are taken from the conserved core sequences.
fn gateway(v: &SequenceDocument, vs: &str, i: &SequenceDocument, is: &str) -> Result<Built, String> {
    let mut warnings = Vec::new();
    let a1 = vs.find(ATT1_CORE).ok_or("The vector has no att1 (attR1/attP1) site; use a Gateway destination or donor vector.")?;
    let a2 = vs.find(ATT2_CORE).ok_or("The vector has no att2 (attR2/attP2) site; use a Gateway destination or donor vector.")?;
    if a2 <= a1 {
        return Err("The vector's att2 site precedes att1; check the vector orientation.".into());
    }
    // attB1 = ACAAG|TTTGTACAAAAAAG|CAGGCT ; attB2 = ACCCAG|CTTTCTTGTACAAAG|TGGT
    let left_end = a1.saturating_sub(5);
    let right_start = (a2 + ATT2_CORE.len() + 4).min(vs.len());
    let (core_ins, ins_feats) = match (is.find(ATT_B1), is.find(ATT_B2)) {
        (Some(p), Some(q)) if q > p => {
            let (pc, _) = extract(is, &i.features, false, p + ATT_B1.len(), q - p - ATT_B1.len());
            (pc.seq, pc.feats)
        }
        _ => {
            warnings.push("The insert has no attB sites; attB1/attB2 are added by the PCR primers (Invitrogen attB adapter design).".into());
            (is.to_string(), i.features.clone())
        }
    };
    let (left, _) = extract(vs, &v.features, false, 0, left_end);
    let (right, dropped) = extract(vs, &v.features, false, right_start, vs.len() - right_start);
    if dropped > 0 {
        warnings.push(format!("{dropped} feature(s) spanning the att cassette were not transferred."));
    }
    let feat = |name: &str, s: usize, e: usize, color: &str| SequenceFeature {
        id: format!("gw-{name}"),
        name: name.to_string(),
        feature_type: "protein_bind".to_string(),
        start: s,
        end: e,
        strand: 1,
        color: color.to_string(),
        notes: Some("λ integrase recombination site".to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    };
    let att1 = Piece { seq: ATT_B1.into(), feats: vec![feat("attB1", 1, ATT_B1.len(), "#7c3aed")] };
    let att2 = Piece { seq: ATT_B2.into(), feats: vec![feat("attB2", 1, ATT_B2.len(), "#7c3aed")] };
    let ins = Piece { seq: core_ins.clone(), feats: ins_feats };
    let product = concat(&[&left, &att1, &ins, &att2, &right]);
    warnings.push("att-site boundaries are inferred from the conserved core sequences.".into());
    let s = left.seq.len() + ATT_B1.len() + 1;
    Ok(Built {
        insert_range: (s, s + core_ins.len() - 1),
        circular: v.topology == Topology::Circular,
        left_label: format!("attB1 5'-{ATT_B1}-3'"),
        right_label: format!("attB2 5'-{ATT_B2}-3'"),
        summary: format!(
            "Gateway recombination replaced the vector's att1–att2 cassette with attB1-{}-attB2: {} bp construct.",
            i.name,
            product.seq.len()
        ),
        operation: "Gateway Recombination".into(),
        product,
        warnings,
    })
}

/// Overlap-extension PCR: fragment A (first document) and fragment B (second) are fused end to end.
fn overlap_extension(v: &SequenceDocument, vs: &str, i: &SequenceDocument, is: &str) -> Result<Built, String> {
    let mut warnings = Vec::new();
    if vs.len() < 20 || is.len() < 20 {
        return Err("Both fragments must be at least 20 bp.".into());
    }
    if v.topology == Topology::Circular {
        warnings.push(format!("{} is circular; it is used as a linear fragment from base 1.", v.name));
    }
    let overlap = format!("{}{}", &vs[vs.len() - 12..], &is[..12]);
    // A junction holding N has no Tm: the sentence gives the reason in its place (BG-01M6SHQ0).
    let junction = calculate_primer_metrics(&overlap, 50.0, 1.5, 250.0);
    let tm = junction
        .tm_no_answer_reason
        .unwrap_or_else(|| format!("Tm {:.1} °C at 50 mM Na⁺, 1.5 mM Mg²⁺", junction.tm_c));
    warnings.push(format!("Chimeric primers share the 24-nt junction {overlap} ({tm})."));
    let a = doc_piece(v, vs);
    let mut a_lin = a.clone();
    if v.topology == Topology::Circular {
        let (p, _) = extract(vs, &v.features, false, 0, vs.len());
        a_lin = p;
    }
    let b = doc_piece(i, is);
    let product = concat(&[&a_lin, &b]);
    Ok(Built {
        insert_range: (vs.len() + 1, vs.len() + is.len()),
        circular: false,
        left_label: format!("junction 5'-{overlap}-3'"),
        right_label: String::new(),
        summary: format!("SOE-PCR fused {} ({} bp) and {} ({} bp) into a {} bp linear product.", v.name, vs.len(), i.name, is.len(), product.seq.len()),
        operation: "Overlap Extension PCR (SOE-PCR)".into(),
        product,
        warnings,
    })
}

pub fn simulate_molecular_cloning(
    vector_doc: &SequenceDocument,
    insert_doc: &SequenceDocument,
    method: &str,
    enzyme5_prime: &str,
    enzyme3_prime: &str,
    golden_gate_enzyme: &str,
) -> CloningOutcome {
    let vs = clean_alpha_sequence(&vector_doc.sequence).replace('U', "T");
    let is = clean_alpha_sequence(&insert_doc.sequence).replace('U', "T");
    if vs.is_empty() || is.is_empty() {
        return fail(vector_doc, method, "Both the vector and the insert need a sequence.".into(), Vec::new());
    }
    let m = method.to_ascii_lowercase();
    let built = if m.contains("restriction") {
        restriction_ligation(vector_doc, &vs, insert_doc, &is, enzyme5_prime, enzyme3_prime)
    } else if m.contains("in-fusion") {
        homology_assembly(vector_doc, &vs, insert_doc, &is, enzyme5_prime, enzyme3_prime, 15, "In-Fusion Cloning")
    } else if m.contains("hifi") {
        homology_assembly(vector_doc, &vs, insert_doc, &is, enzyme5_prime, enzyme3_prime, 20, "NEBuilder HiFi Assembly")
    } else if m.contains("gibson") {
        homology_assembly(vector_doc, &vs, insert_doc, &is, enzyme5_prime, enzyme3_prime, 25, "Gibson Assembly")
    } else if m.contains("golden") {
        golden_gate(vector_doc, &vs, insert_doc, &is, golden_gate_enzyme)
    } else if m.contains("parts") {
        golden_gate(vector_doc, &vs, insert_doc, &is, "BsaI-HFv2")
    } else if m.contains("ta /") || m.starts_with("ta") {
        ta_or_topo(vector_doc, &vs, insert_doc, &is, enzyme5_prime, false)
    } else if m.contains("topo") {
        ta_or_topo(vector_doc, &vs, insert_doc, &is, enzyme5_prime, true)
    } else if m.contains("gateway") {
        gateway(vector_doc, &vs, insert_doc, &is)
    } else if m.contains("overlap") {
        overlap_extension(vector_doc, &vs, insert_doc, &is)
    } else {
        Err(format!("Unknown cloning method \"{method}\"."))
    };
    let b = match built {
        Ok(b) => b,
        Err(e) => return fail(vector_doc, method, e, Vec::new()),
    };

    let product_len = b.product.seq.len();
    let (s, e) = b.insert_range;
    let junction = |p: usize| {
        let lo = p.saturating_sub(12);
        b.product.seq[lo..(p + 12).min(product_len)].to_string()
    };
    let mut features = b.product.feats.clone();
    features.push(SequenceFeature {
        id: format!("clone-insert-{s}"),
        name: format!("{} (insert)", insert_doc.name),
        feature_type: "misc_feature".to_string(),
        start: s,
        end: e.min(product_len),
        strand: 1,
        color: "#f43f5e".to_string(),
        notes: Some(b.operation.clone()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });
    let topology = if b.circular { Topology::Circular } else { Topology::Linear };
    let mut history = vector_doc.history.clone();
    history.push(HistoryTreeNode {
        id: format!("h-clone-{}-{}", product_len, s),
        timestamp: "2026-10-31 00:00".to_string(),
        operation: b.operation.clone(),
        description: b.summary.clone(),
        parent_ids: vec![vector_doc.id.clone(), insert_doc.id.clone()],
        length_bp: product_len,
        topology,
        history_color: Some("#16a34a".to_string()),
        inserted_range: Some(InsertedRange { start: s, end: e.min(product_len) }),
    });
    let construct = SequenceDocument {
        id: format!("doc-cloned-{}-{}", product_len, s),
        name: format!("{}-{}", vector_doc.name, insert_doc.name),
        accession: String::new(),
        description: b.summary.clone(),
        molecule_type: MoleculeType::DNA,
        topology,
        sequence: b.product.seq.clone(),
        features,
        primers: Vec::new(),
        history,
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: "2026-10-31T00:00:00Z".to_string(),
        updated_at: "2026-10-31T00:00:00Z".to_string(),
        folder: "Plasmids & Vectors".to_string(),
    };
    CloningOutcome {
        success: true,
        method: method.to_string(),
        construct_document: construct,
        summary: b.summary,
        left_junction_seq: junction(s - 1),
        right_junction_seq: junction(e),
        overhang_or_homology_left: b.left_label,
        overhang_or_homology_right: b.right_label,
        warnings: b.warnings,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn doc(seq: &str, topo: Topology, feats: Vec<SequenceFeature>) -> SequenceDocument {
        let mut d: SequenceDocument = serde_json::from_str(
            r#"{"id":"x","name":"x","accession":"","description":"","moleculeType":"DNA","topology":"linear","sequence":"","features":[],"primers":[],"history":[],"createdAt":"","updatedAt":"","folder":""}"#,
        )
        .unwrap();
        d.sequence = seq.into();
        d.topology = topo;
        d.features = feats;
        d
    }
    fn feat(name: &str, s: usize, e: usize) -> SequenceFeature {
        SequenceFeature {
            id: name.into(),
            name: name.into(),
            feature_type: "misc_feature".into(),
            start: s,
            end: e,
            strand: 1,
            color: String::new(),
            notes: None,
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }
    }

    // 60-bp backbone with EcoRI (GAATTC) at 21..26 and XhoI (CTCGAG) at 31..36
    const VEC: &str = "ACGTTGCAAGCTAGCTTACGGAATTCAAAACTCGAGTTGACCATGCATGCAGTTACCGGA";

    #[test]
    fn restriction_ligation_is_sequence_exact_and_shifts_downstream_features() {
        let v = doc(VEC, Topology::Circular, vec![feat("up", 2, 10), feat("down", 40, 55), feat("stuffer", 27, 30)]);
        let i = doc("GGGAATTCATGAAAGGGTTTTAACTCGAGCC", Topology::Linear, vec![feat("orf", 9, 23)]);
        let r = simulate_molecular_cloning(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "");
        assert!(r.success, "{:?}", r.warnings);
        // vector up to G^AATTC, insert AATTC…C, vector from TCGAG on
        let expect = format!("{}{}{}", &VEC[..21], "AATTCATGAAAGGGTTTTAAC", &VEC[31..]);
        assert_eq!(r.construct_document.sequence, expect);
        let f = |n: &str| r.construct_document.features.iter().find(|f| f.name == n).cloned();
        assert_eq!(f("up").map(|f| (f.start, f.end)), Some((2, 10)));
        let shift = 21 - 10; // insert 21 bp replaces a 10-bp stuffer
        assert_eq!(f("down").map(|f| (f.start, f.end)), Some((40 + shift, 55 + shift)));
        assert!(f("stuffer").is_none());
        let orf = f("orf").unwrap();
        assert_eq!(&r.construct_document.sequence[orf.start - 1..orf.end], &i.sequence[8..23]);
    }

    #[test]
    fn cloning_refuses_impossible_requests_instead_of_inventing_sites() {
        let v = doc(VEC, Topology::Circular, vec![]);
        let i = doc("ATGAAAGGGTTTTAA", Topology::Linear, vec![]);
        let r = simulate_molecular_cloning(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "");
        assert!(!r.success && r.summary.contains("insert needs"));
        let r = simulate_molecular_cloning(&v, &i, "Restriction Ligation", "BamHI", "XhoI", "");
        assert!(!r.success && r.summary.contains("does not cut"));
        let r = simulate_molecular_cloning(&v, &i, "Gateway BP/LR Recombination", "", "", "");
        assert!(!r.success && r.summary.contains("att1"));
        assert_eq!(r.construct_document.sequence, VEC);
        // AluI (AG^CT) cuts VEC twice, at AGCT 9..12 and 13..16 (Bio.Restriction AluI.search on the
        // circular VEC gives [11, 15]): the vector is refused, not opened at its first site.
        let r = simulate_molecular_cloning(&v, &i, "Restriction Ligation", "AluI", "XhoI", "");
        assert!(!r.success);
        assert!(r.summary.contains("AluI cuts the vector 2 times"), "{}", r.summary);
        assert_eq!(r.construct_document.sequence, VEC);
    }

    #[test]
    fn gibson_joins_through_vector_homology_without_extra_bases() {
        let v = doc(VEC, Topology::Circular, vec![]);
        let i = doc("ATGAAAGGGTTTTAAATGCCC", Topology::Linear, vec![]);
        let r = simulate_molecular_cloning(&v, &i, "NEBuilder HiFi Assembly", "EcoRI", "XhoI", "");
        assert!(r.success, "{:?}", r.warnings);
        // backbone keeps the EcoRI 5' overhang (AATT) upstream and starts at XhoI's TCGAG
        let expect = format!("{}AATT{}{}", &VEC[..21], i.sequence, &VEC[31..]);
        assert_eq!(r.construct_document.sequence, expect);
        assert_eq!(r.overhang_or_homology_right, "20 bp: 5'-TCGAGTTGACCATGCATGCA-3'");

        // Gibson Assembly itself, with an insert whose PCR tails already carry its 25-bp arms.
        // Built by hand from VEC (Bio.Restriction: EcoRI G^AATTC cuts after base 21, XhoI C^TCGAG
        // after base 31; EcoRI leaves the 5' overhang AATT). The opened backbone runs from XhoI's
        // TCGAG (base 32) round to EcoRI's G (base 21) and keeps AATT, so its upstream 25-bp arm is
        // bases 1..25 (ACGTTGCAAGCTAGCTTACGGAATT) and its downstream arm bases 32..56
        // (TCGAGTTGACCATGCATGCAGTTAC). Read from the vector origin, the product is the vector up to
        // the overhang, the insert body between its arms, then the vector from TCGAG on: 75 bp, each
        // arm present once. With HiFi's 20-bp arm, or a zero-length one, nothing of these tails is
        // removed, so both arms appear twice.
        let left_arm = "ACGTTGCAAGCTAGCTTACGGAATT";
        let right_arm = "TCGAGTTGACCATGCATGCAGTTAC";
        let armed = doc(&format!("{left_arm}ATGAAAGGGTTTTAAATGCCC{right_arm}"), Topology::Linear, vec![]);
        let g = simulate_molecular_cloning(&v, &armed, "Gibson Assembly", "EcoRI", "XhoI", "");
        assert!(g.success, "{}", g.summary);
        assert_eq!(
            g.construct_document.sequence,
            "ACGTTGCAAGCTAGCTTACGGAATTATGAAAGGGTTTTAAATGCCCTCGAGTTGACCATGCATGCAGTTACCGGA"
        );
        assert_eq!(g.construct_document.sequence.matches(left_arm).count(), 1);
        assert_eq!(g.construct_document.sequence.matches(right_arm).count(), 1);
        assert!(g.overhang_or_homology_left.starts_with(&format!("25 bp: 5'-{left_arm}-3' (Tm ")), "{}", g.overhang_or_homology_left);
        assert_eq!(g.overhang_or_homology_right, format!("25 bp: 5'-{right_arm}-3'"));
        assert_eq!(
            g.summary,
            "Gibson Assembly: 21 bp insert joined to the EcoRI/XhoI-linearized vector through 25-bp homology arms: 75 bp circular construct."
        );
    }

    #[test]
    fn golden_gate_uses_real_overhangs() {
        // vector: BsaI sites flank a drop-out and point inward; overhangs TGCC (left) and GCTT (right)
        let vector = "AAAACCCCGGGGTTTTTGCCAGAGACCAAAAAAAAGGTCTCAGCTTACGTACGTACGTACGTACGTAC";
        // part: GGTCTCN|TGCC …part… GCTT|NGAGACC
        let part = "TTGGTCTCATGCCATGAAACCCGGGTAAGCTTAGAGACCTT";
        let v = doc(vector, Topology::Circular, vec![]);
        let i = doc(part, Topology::Linear, vec![]);
        let r = simulate_molecular_cloning(&v, &i, "Golden Gate (Type IIS)", "", "", "BsaI");
        assert!(r.success, "{}", r.summary);
        assert_eq!(r.overhang_or_homology_left, "5'-TGCC-3'");
        assert!(r.construct_document.sequence.contains("TGCCATGAAACCCGGGTAAGCTT"));
        assert!(!r.construct_document.sequence.contains("GGTCTC") && !r.construct_document.sequence.contains("GAGACC"));
    }

    #[test]
    fn rotation_splits_features_across_the_new_origin() {
        let p = Piece { seq: "ACGTACGTAC".into(), feats: vec![feat("f", 3, 8)] };
        let r = rotate(&p, 5);
        let f = &r.feats[0];
        assert_eq!(f.segments.as_ref().map(|s| s.iter().map(|x| (x.start, x.end)).collect::<Vec<_>>()), Some(vec![(8, 10), (1, 3)]));
    }
}
