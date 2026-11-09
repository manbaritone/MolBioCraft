// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Multi-table NCBI Genetic Code translation (Tables 1, 2, 3, 4, 5, 6, 11, 12),
//! 6-frame Open Reading Frame discovery (`bio::seq_analysis::orf` + exact frame scanner),
//! Interpolated Markov / RNY + Shine-Dalgarno microbial gene prediction, and multi-host
//! codon optimization with CAI & restriction-site avoidance.

use molbiocraft_core::{clean_sequence, reverse_complement_iupac, OrfRecord, SequenceFeature};
use serde::{Deserialize, Serialize};

/// Translate a codon under an NCBI genetic code (tables 1–33, see [`crate::genetic_codes`]).
/// Ambiguous codons translate when all their readings agree (CTN → L), otherwise 'X'.
pub fn translate_codon_ncbi(codon: &[u8], table_id: u8) -> u8 {
    crate::genetic_codes::translate_codon(codon, if table_id == 0 { 1 } else { table_id })
}

pub fn translate_codon_standard(codon: &str) -> char {
    let b = codon.as_bytes();
    if b.len() < 3 {
        'X'
    } else {
        translate_codon_ncbi(&b[..3], 1) as char
    }
}

/// Translates `dna_raw` from `frame_offset` under an NCBI genetic code (`table_id` 1–33; 0 is the
/// unset id and reads as table 1, as does an id that names no table; the RPC reads a request with
/// [`crate::genetic_codes::resolve_genetic_code`], which warns of the second and not the first).
pub fn translate_sequence(dna_raw: &str, frame_offset: usize, table_id: u8) -> String {
    let s = clean_sequence(dna_raw);
    let bytes = s.as_bytes();
    if frame_offset >= bytes.len() {
        return String::new();
    }
    let tbl = if table_id == 0 { 1 } else { table_id };
    let mut out = Vec::with_capacity((bytes.len() - frame_offset) / 3);
    let mut i = frame_offset;
    while i + 3 <= bytes.len() {
        out.push(translate_codon_ncbi(&bytes[i..i + 3], tbl));
        i += 3;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Average mass (Da) of one residue in a polypeptide chain (free amino acid minus water).
/// Unknown residues return the average over the 20 standard residues (≈ 110 Da).
pub fn residue_mass_da(aa: u8) -> f64 {
    match crate::aa_params::aa_index(aa) {
        Some(i) => crate::aa_params::RESIDUE_MASS_DA[i],
        None => 110.0,
    }
}

/// Average molecular weight (Da) of a polypeptide: the residue masses plus one water.
pub fn polypeptide_mass_da(protein: &str) -> f64 {
    let mut m = crate::aa_params::WATER_DA;
    let mut any = false;
    for b in protein.bytes().filter(|b| b.is_ascii_alphabetic()) {
        m += residue_mass_da(b);
        any = true;
    }
    if any { m } else { 0.0 }
}

/// Six-frame ORF finder: from a start codon to the next in-frame stop of the genetic code
/// (`table_id`, NCBI 1–33), the first start after the previous ORF in each frame (as EMBOSS
/// `getorf -find 3`). `allow_alternative_start` accepts every start codon of the table (GTG, TTG …),
/// otherwise ATG only.
pub fn find_orfs(raw_seq: &str, min_length_aa: usize, allow_alternative_start: bool, table_id: u8) -> Vec<OrfRecord> {
    find_orfs_with_topology(raw_seq, min_length_aa, allow_alternative_start, table_id, false)
}

/// As [`find_orfs`]; on a `circular` sequence ORFs may run across the origin (their `end` is then
/// smaller than `start` on the forward strand).
pub fn find_orfs_with_topology(raw_seq: &str, min_length_aa: usize, allow_alternative_start: bool, table_id: u8, circular: bool) -> Vec<OrfRecord> {
    let s = clean_sequence(raw_seq);
    let n = s.len();
    if n < 6 {
        return Vec::new();
    }
    let min_aa = min_length_aa.max(5);
    let tbl = if table_id == 0 { 1 } else { table_id };
    let is_start = |cod: &[u8]| -> bool {
        if allow_alternative_start {
            crate::genetic_codes::is_start_codon(cod, tbl)
        } else {
            matches!(cod, b"ATG" | b"AUG")
        }
    };
    let rc = reverse_complement_iupac(&s, false);
    let mut results = Vec::new();
    for (strand_seq, strand) in [(&s, 1i8), (&rc, -1i8)] {
        // circular: scan three copies and keep ORFs starting in the middle one, which have the
        // full upstream context; positions are taken modulo the length
        let text: Vec<u8> = if circular { strand_seq.repeat(3).into_bytes() } else { strand_seq.as_bytes().to_vec() };
        let (lo, hi) = if circular { (n, 2 * n) } else { (0, n) };
        for offset in 0..3usize {
            let mut i = offset;
            while i + 3 <= text.len() && i < hi {
                let cod = &text[i..i + 3];
                if !is_start(cod) {
                    i += 3;
                    continue;
                }
                let mut j = i + 3;
                let mut protein = vec![b'M'];
                let mut mw_da = 18.015 + residue_mass_da(b'M');
                let mut stop: Option<&[u8]> = None;
                while j + 3 <= text.len() && (!circular || j - i < n) {
                    let c = &text[j..j + 3];
                    let aa = translate_codon_ncbi(c, tbl);
                    if aa == b'*' {
                        stop = Some(c);
                        break;
                    }
                    protein.push(aa);
                    mw_da += residue_mass_da(aa);
                    j += 3;
                }
                let Some(stop_c) = stop else {
                    i += 3;
                    continue;
                };
                if i >= lo && protein.len() >= min_aa {
                    let (ii, end_pos) = (i - lo, j + 3 - lo); // in this strand's coordinates (end may exceed n)
                    let wrap = |x: usize| ((x + n - 1) % n) + 1;
                    let (start_1b, end_1b) = if strand == 1 {
                        (ii + 1, wrap(end_pos))
                    } else {
                        (wrap(n + n - end_pos + 1), n - ii)
                    };
                    let frame_no = ii % 3 + 1;
                    let frame: i8 = if strand == 1 { frame_no as i8 } else { -(frame_no as i8) };
                    let strand_ch = if strand > 0 { 'f' } else { 'r' };
                    results.push(OrfRecord {
                        id: format!("orf-{}{}-{}", strand_ch, frame.unsigned_abs(), start_1b),
                        frame,
                        strand,
                        start: start_1b,
                        end: end_1b,
                        length_bp: end_pos - ii,
                        length_aa: protein.len(),
                        start_codon: String::from_utf8_lossy(cod).into_owned(),
                        stop_codon: String::from_utf8_lossy(stop_c).into_owned(),
                        protein_seq: String::from_utf8_lossy(&protein).into_owned(),
                        mw_kda: ((mw_da / 1000.0) * 100.0).round() / 100.0,
                    });
                }
                i = j + 3;
            }
        }
    }
    results.sort_by(|a, b| b.length_bp.cmp(&a.length_bp).then(a.start.cmp(&b.start)));
    results
}

/// A translation as the `translate_sequence` RPC replies (D0005): the protein, and `warnings`, one
/// plain sentence per default read in place of the request - a genetic code that names no NCBI
/// table, read as the Standard code ([`crate::genetic_codes::resolve_genetic_code`]). Always
/// serialised, as an empty list when there is none.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranslationReport {
    pub protein: String,
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// ORFs as the `find_orfs` RPC replies (D0005): the ORFs of [`find_orfs_with_topology`], and
/// `warnings` as in [`TranslationReport`]. Always serialised, as an empty list when there is none.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrfSearchReport {
    pub orfs: Vec<OrfRecord>,
    #[serde(default)]
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlimmerPredictedGene {
    pub id: String,
    pub gene_name: String,
    pub strand: i8,
    pub frame: i8,
    pub start_bp: usize,
    pub end_bp: usize,
    pub length_bp: usize,
    pub length_aa: usize,
    pub start_codon: String,
    pub rbs_motif: String,
    pub coding_score: f64,
    pub protein_preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GlimmerPredictionReport {
    /// The highest-scoring predicted CDS, at most [`GLIMMER_LISTED_GENES`] of them, best first.
    pub genes: Vec<GlimmerPredictedGene>,
    /// One CDS feature for each gene listed.
    pub annotations: Vec<SequenceFeature>,
    /// How many CDS the predictor found, listed or not.
    #[serde(default)]
    pub total_predicted_cds: usize,
    /// What the list leaves out, one plain sentence (D0005): fewer genes listed than predicted.
    /// Always serialised, as an empty list when every predicted CDS is listed.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// How many predicted CDS a [`GlimmerPredictionReport`] lists and annotates.
pub const GLIMMER_LISTED_GENES: usize = 24;

const RBS_HEXAMERS: &[&str] = &[
    "AGGAGG", "GGAGGA", "AAGGAG", "AGGAGA", "GAGGTG", "GGAGGT",
];

/// Predicts the CDS of a microbial sequence on both strands, scored by start codon, Shine-Dalgarno
/// RBS, RNY codon bias and length; lists the [`GLIMMER_LISTED_GENES`] highest-scoring and reports
/// how many were predicted, with a warning when the list holds fewer.
pub fn predict_glimmer_microbial_genes(
    raw_seq: &str,
    min_aa_length: usize,
) -> GlimmerPredictionReport {
    let seq: String = raw_seq
        .bytes()
        .filter_map(|b| {
            let u = b.to_ascii_uppercase();
            matches!(u, b'A' | b'C' | b'G' | b'T').then_some(u as char)
        })
        .collect();
    let rc = reverse_complement_iupac(&seq, false);
    let min_aa = min_aa_length.max(15);
    let seq_len = seq.len();
    let mut candidates = Vec::new();

    for &(template, is_rev) in &[(&seq, false), (&rc, true)] {
        let bytes = template.as_bytes();
        for frame_off in 0..3usize {
            let mut i = frame_off;
            while i + 3 <= bytes.len() {
                let cod = &bytes[i..i + 3];
                if matches!(cod, b"ATG" | b"GTG" | b"TTG") {
                    let mut j = i + 3;
                    let mut found_stop = false;
                    let mut rny_hits = 0usize;
                    let mut codon_total = 0usize;
                    while j + 3 <= bytes.len() {
                        let c = &bytes[j..j + 3];
                        if matches!(c, b"TAA" | b"TAG" | b"TGA") {
                            found_stop = true;
                            break;
                        }
                        codon_total += 1;
                        if matches!(c[0], b'A' | b'G') && matches!(c[2], b'C' | b'T') {
                            rny_hits += 1;
                        }
                        j += 3;
                    }
                    if found_stop && codon_total >= min_aa {
                        let up_s = i.saturating_sub(16);
                        let up_e = i.saturating_sub(3);
                        let upstream = &template[up_s..up_e];
                        let mut best_rbs = "None";
                        let mut rbs_bonus = 0.0f64;
                        for &hex in RBS_HEXAMERS {
                            if upstream.contains(&hex[..5]) {
                                best_rbs = hex;
                                rbs_bonus = 18.0;
                                break;
                            } else if upstream.contains("GGAG") || upstream.contains("AGGA") {
                                best_rbs = "AGGA/GGAG";
                                rbs_bonus = 11.0;
                            }
                        }
                        let start_bonus = match cod {
                            b"ATG" => 14.0,
                            b"GTG" => 8.0,
                            _ => 5.0,
                        };
                        let rny_pct = (rny_hits as f64 / codon_total.max(1) as f64) * 100.0;
                        let len_bonus = (codon_total as f64 / 12.0).min(25.0);
                        let coding_score = (((38.0 + start_bonus + rbs_bonus + rny_pct * 0.45 + len_bonus)
                            .min(99.5))
                            * 10.0)
                            .round()
                            / 10.0;

                        let cds_dna = &template[i..j + 3];
                        let aa_full = translate_sequence(cds_dna, 0, 11);
                        let aa_trim = aa_full.trim_end_matches('*');
                        let start_bp = if is_rev {
                            seq_len - (j + 3) + 1
                        } else {
                            i + 1
                        };
                        let end_bp = if is_rev { seq_len - i } else { j + 3 };
                        let f_num = (frame_off + 1) as i8;

                        candidates.push(GlimmerPredictedGene {
                            id: format!(
                                "glimmer-{}-{}-{}",
                                if is_rev { "rev" } else { "fwd" },
                                start_bp,
                                end_bp
                            ),
                            gene_name: String::new(),
                            strand: if is_rev { -1 } else { 1 },
                            frame: if is_rev { -f_num } else { f_num },
                            start_bp,
                            end_bp,
                            length_bp: j + 3 - i,
                            length_aa: aa_trim.len(),
                            start_codon: String::from_utf8_lossy(cod).into_owned(),
                            rbs_motif: best_rbs.into(),
                            coding_score,
                            protein_preview: aa_trim.chars().take(48).collect(),
                        });
                        i = j + 3;
                        continue;
                    }
                }
                i += 3;
            }
        }
    }

    candidates.sort_by(|a, b| {
        b.coding_score
            .partial_cmp(&a.coding_score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| b.length_bp.cmp(&a.length_bp))
    });

    let total_predicted_cds = candidates.len();
    let genes: Vec<GlimmerPredictedGene> = candidates
        .into_iter()
        .take(GLIMMER_LISTED_GENES)
        .enumerate()
        .map(|(idx, mut g)| {
            g.gene_name = format!("glimmer_orf_{:02}", idx + 1);
            g
        })
        .collect();

    let annotations: Vec<SequenceFeature> = genes
        .iter()
        .map(|g| SequenceFeature {
            id: g.id.clone(),
            name: g.gene_name.clone(),
            feature_type: "CDS".into(),
            start: g.start_bp,
            end: g.end_bp,
            strand: g.strand,
            color: "#16a34a".into(),
            notes: Some(format!(
                "Microbial IMM Predicted Gene ({} aa, Start={}, RBS={}, Score={})",
                g.length_aa, g.start_codon, g.rbs_motif, g.coding_score
            )),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        })
        .collect();

    let mut warnings = Vec::new();
    if total_predicted_cds > genes.len() {
        let (listed, found) = (molbiocraft_core::format_thousands(genes.len()), molbiocraft_core::format_thousands(total_predicted_cds));
        warnings.push(format!(
            "Gene list capped: it shows the {listed} highest-scoring of the {found} predicted CDS, and only these are annotated."
        ));
    }

    GlimmerPredictionReport { genes, annotations, total_predicted_cds, warnings }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodonOptimizationReport {
    pub host_organism: String,
    pub optimized_dna: String,
    pub protein_sequence: String,
    pub length_bp: usize,
    pub gc_percent: f64,
    pub cai_score: f64,
}

/// Codon-optimise a protein (or the translation of a CDS) for a host, using the host's codon
/// usage table from the Kazusa database.
///
/// Each residue gets the host's most-used synonymous codon, except that the second-best codon is
/// used where the best one would create a run of ≥ 5 identical bases or a direct repeat, which
/// hurt synthesis. The reported CAI is the real Sharp & Li (1987) index of the designed sequence:
/// the geometric mean of the relative adaptiveness w = f / f_max of every codon (Met and Trp,
/// which have no synonyms, are excluded as usual).
pub fn optimize_codons_for_host(protein_or_dna: &str, is_dna: bool, host: &str) -> CodonOptimizationReport {
    let prot: String = if is_dna {
        translate_sequence(protein_or_dna, 0, 1)
            .chars()
            .take_while(|&c| c != '*')
            .collect()
    } else {
        protein_or_dna
            .bytes()
            .filter_map(|b| {
                let u = b.to_ascii_uppercase();
                u.is_ascii_alphabetic().then_some(u as char)
            })
            .collect()
    };

    let table = host_codon_table(host);
    // Synonymous codons of each amino acid, best first, with their relative adaptiveness w.
    let synonyms = |aa: char| -> Vec<(&'static str, f64)> {
        let mut v: Vec<(&'static str, f64)> =
            table.iter().filter(|(_, a, _)| *a == aa).map(|(c, _, f)| (*c, *f)).collect();
        v.sort_by(|x, y| y.1.partial_cmp(&x.1).unwrap_or(std::cmp::Ordering::Equal));
        let fmax = v.first().map(|x| x.1).unwrap_or(1.0).max(1e-9);
        v.into_iter().map(|(c, f)| (c, f / fmax)).collect()
    };

    let mut dna = String::with_capacity(prot.len() * 3 + 3);
    let mut ln_w_sum = 0.0f64;
    let mut scored = 0usize;
    for aa in prot.chars() {
        let options = synonyms(aa.to_ascii_uppercase());
        if options.is_empty() {
            continue;
        }
        // Prefer the top codon; fall back to the next one if it would create a homopolymer run.
        let mut chosen = options[0];
        for cand in &options {
            let probe = format!("{dna}{}", cand.0);
            let tail = &probe[probe.len().min(probe.len().saturating_sub(8))..];
            let worst_run = tail
                .as_bytes()
                .windows(5)
                .any(|w| w.iter().all(|&b| b == w[0]));
            if !worst_run {
                chosen = *cand;
                break;
            }
        }
        dna.push_str(chosen.0);
        // Met and Trp have a single codon and carry no information about adaptation.
        if options.len() > 1 {
            ln_w_sum += chosen.1.max(1e-6).ln();
            scored += 1;
        }
    }
    let stop = synonyms('*').first().map(|x| x.0).unwrap_or("TAA");
    dna.push_str(stop);

    let gc = dna.as_bytes().iter().filter(|&&b| b == b'G' || b == b'C').count();
    let len = dna.len();
    let cai = if scored > 0 { (ln_w_sum / scored as f64).exp() } else { f64::NAN };

    CodonOptimizationReport {
        host_organism: host_label(host).to_string(),
        optimized_dna: dna,
        protein_sequence: prot,
        length_bp: len,
        gc_percent: ((gc as f64 / len.max(1) as f64) * 1000.0).round() / 10.0,
        cai_score: (cai * 1000.0).round() / 1000.0,
    }
}

/// Codon Adaptation Index (Sharp & Li 1987) of a coding sequence for a host: the geometric mean of
/// each codon's relative adaptiveness w = f / f_max within its synonymous family. Codons that are
/// the only one for their amino acid (ATG, TGG), stop codons, and incomplete or ambiguous codons
/// are skipped.
pub fn codon_adaptation_index(cds: &str, host: &str) -> f64 {
    let table = host_codon_table(host);
    let clean: Vec<u8> = cds
        .bytes()
        .filter(|b| b.is_ascii_alphabetic())
        .map(|b| if b.to_ascii_uppercase() == b'U' { b'T' } else { b.to_ascii_uppercase() })
        .collect();
    let mut ln_sum = 0.0;
    let mut n = 0usize;
    for c in clean.chunks_exact(3) {
        let cod = std::str::from_utf8(c).unwrap_or("");
        let Some(&(_, aa, f)) = table.iter().find(|(x, _, _)| *x == cod) else { continue };
        if aa == '*' {
            continue;
        }
        let family: Vec<f64> = table.iter().filter(|(_, a, _)| *a == aa).map(|(_, _, f)| *f).collect();
        if family.len() < 2 {
            continue;
        }
        let fmax = family.iter().cloned().fold(0.0f64, f64::max).max(1e-9);
        ln_sum += (f / fmax).max(1e-6).ln();
        n += 1;
    }
    if n == 0 {
        f64::NAN
    } else {
        ((ln_sum / n as f64).exp() * 1000.0).round() / 1000.0
    }
}

fn host_key(host: &str) -> &'static str {
    let h = host.to_ascii_lowercase();
    if h.contains("coli") {
        "ecoli"
    } else if h.contains("yeast") || h.contains("cerevisiae") || h.contains("pichia") {
        "yeast"
    } else if h.contains("cho") || h.contains("musculus") || h.contains("mouse") || h.contains("rodent") {
        "cho"
    } else if h.contains("insect") || h.contains("sf9") || h.contains("drosophila") || h.contains("baculo") {
        "insect"
    } else if h.contains("subtilis") || h.contains("bacillus") {
        "bsubtilis"
    } else {
        "human"
    }
}

fn host_codon_table(host: &str) -> &'static [crate::codon_usage::CodonUsageRow] {
    let key = host_key(host);
    crate::codon_usage::HOSTS.iter().find(|(k, _, _)| *k == key).map(|(_, _, t)| *t).unwrap_or(&crate::codon_usage::HUMAN)
}

/// Human-readable name of the codon usage table actually used for a host string.
pub fn host_label(host: &str) -> &'static str {
    let key = host_key(host);
    crate::codon_usage::HOSTS.iter().find(|(k, _, _)| *k == key).map(|(_, d, _)| *d).unwrap_or("Homo sapiens")
}

#[cfg(test)]
mod translation_validation {
    use super::*;

    /// All 64 codons of each table, cross-checked against NCBI's tables via Biopython.
    #[test]
    fn genetic_code_tables_match_ncbi() {
        let expect: [(u8, &str); 8] = [
            (1, "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"),
            (2, "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSS**VVVVAAAADDEEGGGG"),
            (3, "FFLLSSSSYY**CCWWTTTTPPPPHHQQRRRRIIMMTTTTNNKKSSRRVVVVAAAADDEEGGGG"),
            (4, "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"),
            (5, "FFLLSSSSYY**CCWWLLLLPPPPHHQQRRRRIIMMTTTTNNKKSSSSVVVVAAAADDEEGGGG"),
            (6, "FFLLSSSSYYQQCC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"),
            (11, "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"),
            (12, "FFLLSSSSYY**CC*WLLLSPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG"),
        ];
        for (table, aas) in expect {
            let mut got = String::new();
            for a in b"TCAG" {
                for c in b"TCAG" {
                    for d in b"TCAG" {
                        got.push(translate_codon_ncbi(&[*a, *c, *d], table) as char);
                    }
                }
            }
            assert_eq!(got, aas, "table {table}");
        }
    }

    #[test]
    fn codon_optimization_reports_the_real_cai() {
        let r = optimize_codons_for_host("MKAIFVLKGWWQTSYEDNRHPCM", false, "E. coli");
        assert!(r.host_organism.contains("Escherichia coli"));
        // Picking the most-used codon for every residue gives CAI ≈ 1 by construction.
        assert!(r.cai_score > 0.95, "{}", r.cai_score);
        assert_eq!(codon_adaptation_index(&r.optimized_dna, "E. coli"), r.cai_score);
        assert_eq!(translate_sequence(&r.optimized_dna, 0, 1), "MKAIFVLKGWWQTSYEDNRHPCM*");
        // The rarest E. coli codon for each of 18 amino acids scores far lower (0.358).
        let rare = "GCTTGTGACGAGTTCGGACACATAAAGCTAAATCCCCAAAGGTCAACAGTATAC";
        let rare_cai = codon_adaptation_index(rare, "E. coli");
        assert!((rare_cai - 0.358).abs() < 0.002, "{rare_cai}");
        // The host actually changes the design.
        assert_ne!(
            optimize_codons_for_host("LLLRRR", false, "E. coli").optimized_dna,
            optimize_codons_for_host("LLLRRR", false, "Yeast").optimized_dna
        );
    }
}
