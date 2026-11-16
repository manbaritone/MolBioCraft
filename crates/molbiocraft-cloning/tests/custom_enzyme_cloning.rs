// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7HRV4 (D0153): restriction cloning resolves a `custom:` enzyme id against the definitions
//! sent with the request, reads a catalogue name exactly as before, and tells two enzymes apart by
//! the id of the RESOLVED record, never by display name.
//!
//! Every expected value is written here from the fixture's construction (segment lengths, the
//! definition's own offsets, the catalogue motifs Bio.Restriction gives) and never read from the op.

use molbiocraft_cloning::cloning_sim::{
    simulate_molecular_cloning, simulate_molecular_cloning_with_custom_enzymes,
};
use molbiocraft_core::types::{EnzymeSource, MoleculeType, RestrictionEnzyme, SequenceDocument, Topology};

/// Poly-A filler: no motif below, and no reverse complement of one, holds only A's, so none is ever
/// found in it or across the junction of a circular fixture; and it carries no Dam (GATC), Dcm
/// (CCWGG) or CpG context, so no site planted beside it is methylation-blocked.
fn fill(n: usize) -> String {
    "A".repeat(n)
}

fn doc(id: &str, sequence: String, topology: Topology) -> SequenceDocument {
    SequenceDocument {
        id: id.into(),
        name: id.into(),
        molecule_type: MoleculeType::DNA,
        topology,
        sequence,
        ..Default::default()
    }
}

/// A stored definition: `custom:<id>`, its own name (a built-in's included), motif and offsets.
fn custom(id: &str, name: &str, motif: &str, cut_fwd: i32, cut_rev: i32, type_iis: bool) -> RestrictionEnzyme {
    RestrictionEnzyme {
        id: format!("custom:{id}"),
        source: EnzymeSource::Custom,
        name: name.into(),
        recognition_seq: motif.into(),
        cut_fwd,
        cut_rev,
        is_type_iis: type_iis,
        suppliers: vec![],
        methylation_sensitivity: vec![],
        buffer_standard: String::new(),
        temp_c: 37,
        provenance: String::new(),
        notes: String::new(),
    }
}

/// Adaeze's own "EcoRI": the built-in's name over another motif and other offsets (5' TGGT).
fn mine() -> RestrictionEnzyme {
    custom("mine", "EcoRI", "TGGTGGTGA", 3, 7, false)
}
/// A second definition, also named "EcoRI", over a third motif (5' TGAT).
fn other() -> RestrictionEnzyme {
    custom("other", "EcoRI", "TGATGATGC", 3, 7, false)
}

/// The vector of the by-name pins: one EcoRI site (G^AATTC after base 21) and one XhoI site
/// (C^TCGAG after base 31), as `cloning_sim`'s own unit tests use it.
const VEC: &str = "ACGTTGCAAGCTAGCTTACGGAATTCAAAACTCGAGTTGACCATGCATGCAGTTACCGGA";

fn clone6(v: &SequenceDocument, i: &SequenceDocument, method: &str, e5: &str, e3: &str, gg: &str) -> molbiocraft_cloning::CloningOutcome {
    simulate_molecular_cloning(v, i, method, e5, e3, gg)
}
fn clone_with(
    v: &SequenceDocument,
    i: &SequenceDocument,
    method: &str,
    e5: &str,
    e3: &str,
    gg: &str,
    defs: &[RestrictionEnzyme],
) -> molbiocraft_cloning::CloningOutcome {
    simulate_molecular_cloning_with_custom_enzymes(v, i, method, e5, e3, gg, defs)
}

// ─── AC2: the by-name path, and what a `custom:` id may and may not reach ───

/// Restriction ligation, HiFi, Golden Gate through the dash-prefix fallback, the TA opener's refusal
/// and an unknown name, with no definition sent: each the literal result it gives today.
#[test]
fn us_01m7hrv4_ac2_catalogue_names_are_read_exactly_as_before() {
    let v = doc("pVec", VEC.to_string(), Topology::Circular);
    let i = doc("pIns", "GGGAATTCATGAAAGGGTTTTAACTCGAGCC".to_string(), Topology::Linear);

    let r = clone6(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "");
    assert!(r.success, "{:?}", r.warnings);
    // The vector up to G^AATTC, the insert's released fragment, the vector from TCGAG on.
    assert_eq!(r.construct_document.sequence, format!("{}{}{}", &VEC[..21], "AATTCATGAAAGGGTTTTAAC", &VEC[31..]));
    assert_eq!(r.overhang_or_homology_left, "EcoRI 5'-AATT-3' (5prime)");
    assert_eq!(r.overhang_or_homology_right, "XhoI 5'-TCGA-3' (5prime)");
    assert_eq!(
        r.summary,
        "EcoRI/XhoI-cut insert (21 bp) ligated into the EcoRI/XhoI-opened pVec backbone (50 bp): 71 bp circular construct."
    );
    assert_eq!(
        r.construct_document.history.last().map(|h| h.operation.clone()),
        Some("Restriction Ligation (EcoRI / XhoI)".to_string())
    );

    let h = clone6(&v, &doc("pHiFi", "ATGAAAGGGTTTTAAATGCCC".to_string(), Topology::Linear), "NEBuilder HiFi Assembly", "EcoRI", "XhoI", "");
    assert!(h.success, "{}", h.summary);
    assert_eq!(
        h.summary,
        "NEBuilder HiFi Assembly: 21 bp insert joined to the EcoRI/XhoI-linearized vector through 20-bp homology arms: 75 bp circular construct."
    );

    // Golden Gate through the dash-prefix fallback: "BsaI" is the catalogue's BsaI-HFv2, which its
    // messages name, so the fallback's own result is pinned here.
    let gg_v = doc("ggVec", "AAAACCCCGGGGTTTTTGCCAGAGACCAAAAAAAAGGTCTCAGCTTACGTACGTACGTACGTACGTAC".to_string(), Topology::Circular);
    let gg_i = doc("ggPart", "TTGGTCTCATGCCATGAAACCCGGGTAAGCTTAGAGACCTT".to_string(), Topology::Linear);
    let g = clone6(&gg_v, &gg_i, "Golden Gate (Type IIS)", "", "", "BsaI");
    let full = clone6(&gg_v, &gg_i, "Golden Gate (Type IIS)", "", "", "BsaI-HFv2");
    assert!(g.success, "{}", g.summary);
    // "BsaI" is the catalogue's BsaI-HFv2: the same construct, the same words, naming BsaI-HFv2.
    assert_eq!((g.success, &g.summary, &g.warnings), (full.success, &full.summary, &full.warnings));
    assert_eq!(g.construct_document.sequence, full.construct_document.sequence);
    assert!(g.summary.starts_with("BsaI-HFv2 Golden Gate: "), "{}", g.summary);
    assert!(g.summary.ends_with("through TGCC/GCTT overhangs: 61 bp construct."), "{}", g.summary);
    assert_eq!(g.construct_document.sequence.len(), 61);
    assert_eq!(g.overhang_or_homology_left, "5'-TGCC-3'");
    assert_eq!(g.overhang_or_homology_right, "5'-GCTT-3'");
    // The part between the Type IIS cuts, with both recognition sites excised.
    assert!(g.construct_document.sequence.contains("TGCCATGAAACCCGGGTAAGCTT"), "{}", g.construct_document.sequence);
    assert!(!g.construct_document.sequence.contains("GGTCTC") && !g.construct_document.sequence.contains("GAGACC"));

    // The TA opener's refusal names the enzyme it opened the vector with.
    let ta = clone6(&v, &i, "TA / GC Cloning", "EcoRI", "", "");
    assert!(!ta.success);
    assert_eq!(
        ta.warnings[0],
        "T-overhang needs a linear T-overhang vector (or a blunt single cut to model one); EcoRI leaves 5prime overhangs."
    );

    // An unknown name is unknown, as before.
    let u = clone6(&v, &i, "Restriction Ligation", "NotARealEnzyme", "XhoI", "");
    assert!(!u.success);
    assert_eq!(u.warnings[0], "Unknown enzyme \"NotARealEnzyme\".");
}

/// A `custom:` id with no definition sent is unknown by that id: never the built-in of that name,
/// never prefix-matched to one, whatever definitions are sent.
#[test]
fn us_01m7hrv4_ac2_a_custom_id_with_no_definition_is_unknown_never_a_builtin() {
    let v = doc("pVec", VEC.to_string(), Topology::Circular);
    let i = doc("pIns", "GGGAATTCATGAAAGGGTTTTAACTCGAGCC".to_string(), Topology::Linear);

    // Nothing sent at all.
    let none = clone6(&v, &i, "Restriction Ligation", "custom:gone", "XhoI", "");
    assert!(!none.success);
    assert_eq!(none.warnings[0], "Unknown enzyme \"custom:gone\".");
    assert_eq!(none.construct_document.sequence, VEC);

    // Definitions sent, none of them this id: still unknown, and never the built-in "EcoRI" the
    // sent definition is named after, nor a prefix match on "custom".
    let sent = clone_with(&v, &i, "Restriction Ligation", "custom:gone", "XhoI", "", &[mine()]);
    assert!(!sent.success);
    assert_eq!(sent.warnings[0], "Unknown enzyme \"custom:gone\".");
    assert_eq!(sent.construct_document.sequence, VEC);

    // Every call site: the homology opener, Golden Gate and the TA/TOPO opener.
    for (method, e5, gg) in [
        ("Gibson Assembly", "custom:gone", ""),
        ("Golden Gate (Type IIS)", "", "custom:gone"),
        ("TOPO Cloning", "custom:gone", ""),
    ] {
        let r = clone_with(&v, &i, method, e5, "XhoI", gg, &[mine()]);
        assert!(!r.success, "{method} resolved custom:gone");
        assert_eq!(r.warnings[0], "Unknown enzyme \"custom:gone\".", "{method}");
    }
}

/// A NAME is never matched against the supplied definitions: with a same-named custom "EcoRI" sent,
/// `enzyme5Prime = "EcoRI"` is still the built-in, and the construct is the catalogue's own.
#[test]
fn us_01m7hrv4_ac2_a_name_is_never_matched_against_the_sent_definitions() {
    let v = doc("pVec", VEC.to_string(), Topology::Circular);
    let i = doc("pIns", "GGGAATTCATGAAAGGGTTTTAACTCGAGCC".to_string(), Topology::Linear);
    let r = clone_with(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "", &[mine(), other()]);
    assert!(r.success, "{:?}", r.warnings);
    assert_eq!(r.construct_document.sequence, format!("{}{}{}", &VEC[..21], "AATTCATGAAAGGGTTTTAAC", &VEC[31..]));
    assert_eq!(r.overhang_or_homology_left, "EcoRI 5'-AATT-3' (5prime)");
    assert_eq!(
        r.summary,
        "EcoRI/XhoI-cut insert (21 bp) ligated into the EcoRI/XhoI-opened pVec backbone (50 bp): 71 bp circular construct."
    );
    // The custom definition's own motif (TGGTGGTGA) is nowhere in the catalogue construct, and the
    // catalogue run with no definitions sent gives the same construct byte for byte.
    assert_eq!(r.construct_document.sequence, clone6(&v, &i, "Restriction Ligation", "EcoRI", "XhoI", "").construct_document.sequence);
}

/// A `custom:` id of a sent Type IIS definition is resolved by the op for Golden Gate, whose
/// messages print the definition's label.
#[test]
fn us_01m7hrv4_ac2_a_custom_type_iis_id_is_resolved_for_golden_gate() {
    let iis = custom("iis", "AdaIIS", "TGGTGGTGA", 5, 9, true);
    // Three sites of the definition's motif: the op counts them, so it read this definition.
    let seq = format!("{}TGGTGGTGA{}TGGTGGTGA{}TGGTGGTGA{}", fill(20), fill(20), fill(20), fill(20));
    let v = doc("pIIS", seq, Topology::Circular);
    let i = doc("pPart", format!("{}TGGTGGTGA{}", fill(10), fill(10)), Topology::Linear);
    let r = clone_with(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:iis", &[iis.clone()]);
    assert!(!r.success);
    assert_eq!(r.warnings[0], "The vector has 3 AdaIIS (custom) sites; Golden Gate needs exactly two.");
    // Without the definition the same id is unknown, so the count above came from the definition.
    let bare = clone6(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:iis");
    assert_eq!(bare.warnings[0], "Unknown enzyme \"custom:iis\".");
}

// ─── AC3: "the same enzyme?" is the resolved record's id, never the display name ───

/// The two-enzyme vector of the same-named definitions: one `mine` site (top cut after base 33) and
/// one `other` site (after base 72) in 108 bp; its backbone is the 69 bp outside them.
fn twin_vector() -> SequenceDocument {
    let seq = format!("{}TGGTGGTGA{}TGATGATGC{}", fill(30), fill(30), fill(30));
    assert_eq!(seq.len(), 108);
    doc("pTwoMine", seq, Topology::Circular)
}
/// The insert: one `mine` site (top cut after base 23) and one `other` site (after base 52) in
/// 78 bp, so the released fragment is 29 bp.
fn twin_insert() -> SequenceDocument {
    let seq = format!("{}TGGTGGTGA{}TGATGATGC{}", fill(20), fill(20), fill(20));
    assert_eq!(seq.len(), 78);
    doc("iTwoMine", seq, Topology::Linear)
}

/// Two stored definitions both named "EcoRI" cut as two enzymes: no single-enzyme warning, one site
/// of each in the insert is enough, and each end is attributed to the enzyme that cut it.
#[test]
fn us_01m7hrv4_ac3_two_same_named_definitions_are_two_enzymes() {
    let (v, i) = (twin_vector(), twin_insert());
    let r = clone_with(&v, &i, "Restriction Ligation", "custom:mine", "custom:other", "", &[mine(), other()]);
    assert!(r.success, "{:?}", r.warnings);
    assert_eq!(r.construct_document.sequence.len(), 69 + 29);
    // The upstream end is `mine`'s (5' TGGT), the downstream end `other`'s (5' TGAT), never swapped.
    assert_eq!(r.overhang_or_homology_left, "EcoRI (custom) 5'-TGGT-3' (5prime)");
    assert_eq!(r.overhang_or_homology_right, "EcoRI (custom) 5'-TGAT-3' (5prime)");
    assert_eq!(
        r.summary,
        "EcoRI (custom)/EcoRI (custom)-cut insert (29 bp) ligated into the EcoRI (custom)/EcoRI (custom)-opened pTwoMine backbone (69 bp): 98 bp circular construct."
    );
    assert_eq!(
        r.construct_document.history.last().map(|h| h.operation.clone()),
        Some("Restriction Ligation (EcoRI (custom) / EcoRI (custom))".to_string())
    );
    assert!(
        !r.warnings.iter().any(|w| w.contains("Single-enzyme")),
        "two definitions are not one enzyme: {:?}",
        r.warnings
    );

    // One resolved id chosen twice IS the single-enzyme path: the insert then needs two of its
    // sites, and it holds one.
    let one = clone_with(&v, &i, "Restriction Ligation", "custom:mine", "custom:mine", "", &[mine(), other()]);
    assert!(!one.success);
    assert_eq!(
        one.warnings[0],
        "The insert must contain exactly two EcoRI (custom) sites to release a fragment (found 1)."
    );
}

/// A custom twin chosen beside the built-in of its name is the two-enzyme result, with both labels
/// and only the custom one marked.
#[test]
fn us_01m7hrv4_ac3_a_custom_twin_beside_its_builtin_is_two_enzymes() {
    let v = doc("pTwin", format!("{}GAATTC{}TGGTGGTGA{}", fill(30), fill(30), fill(30)), Topology::Circular);
    let i = doc("iTwin", format!("{}GAATTC{}TGGTGGTGA{}", fill(20), fill(20), fill(20)), Topology::Linear);
    assert_eq!((v.sequence.len(), i.sequence.len()), (105, 75));
    let r = clone_with(&v, &i, "Restriction Ligation", "EcoRI", "custom:mine", "", &[mine()]);
    assert!(r.success, "{:?}", r.warnings);
    assert_eq!(r.construct_document.sequence.len(), 67 + 28);
    assert_eq!(r.overhang_or_homology_left, "EcoRI 5'-AATT-3' (5prime)");
    assert_eq!(r.overhang_or_homology_right, "EcoRI (custom) 5'-TGGT-3' (5prime)");
    assert_eq!(
        r.summary,
        "EcoRI/EcoRI (custom)-cut insert (28 bp) ligated into the EcoRI/EcoRI (custom)-opened pTwin backbone (67 bp): 95 bp circular construct."
    );
    assert!(
        !r.warnings.iter().any(|w| w.contains("Single-enzyme")),
        "a custom twin is not its built-in: {:?}",
        r.warnings
    );
}

/// The catalogue pairs keep today's single-enzyme words: EcoRI + EcoRI, and 5' "BsaI" with
/// 3' "BsaI-HFv2", which both resolve to the one catalogue record.
#[test]
fn us_01m7hrv4_ac3_catalogue_pairs_keep_todays_single_enzyme_words() {
    // EcoRI + EcoRI: the vector's single EcoRI site opens it, the insert's two release the fragment.
    let v = doc("pVec", VEC.to_string(), Topology::Circular);
    let i = doc("pIns", "CCGAATTCATGAAAGGGTTTTAAGAATTCCC".to_string(), Topology::Linear);
    let r = clone6(&v, &i, "Restriction Ligation", "EcoRI", "EcoRI", "");
    assert!(r.success, "{:?}", r.warnings);
    assert_eq!(r.construct_document.sequence, format!("{}{}{}", &VEC[..21], "AATTCATGAAAGGGTTTTAAG", &VEC[21..]));
    assert_eq!(
        r.warnings,
        vec![
            "Single-enzyme (EcoRI) cloning is non-directional (two orientations) and the vector can self-ligate; dephosphorylate it."
                .to_string()
        ]
    );
    assert_eq!(
        r.summary,
        "EcoRI-cut insert (21 bp) ligated into the EcoRI-opened pVec backbone (60 bp): 81 bp circular construct."
    );

    // 5' "BsaI" and 3' "BsaI-HFv2": the dash-prefix fallback makes both the one catalogue record, so
    // this is the single-enzyme path today, warning and summary included. The vector holds one
    // GGTCTC site (top cut after base 47, 5' overhang AAAA) and the insert two (cuts after bases 17
    // and 43), so the 26 bp between them is released and ligates at either end.
    let bvec = format!("{}GGTCTC{}", fill(40), fill(40));
    let bins = format!("{}GGTCTC{}GGTCTC{}", fill(10), fill(20), fill(10));
    assert_eq!((bvec.len(), bins.len()), (86, 52));
    let bv = doc("pBsa", bvec.clone(), Topology::Circular);
    let bi = doc("iBsa", bins, Topology::Linear);
    let b = clone6(&bv, &bi, "Restriction Ligation", "BsaI", "BsaI-HFv2", "");
    assert!(b.success, "{:?}", b.warnings);
    assert_eq!(
        b.warnings,
        vec![
            "Single-enzyme (BsaI-HFv2) cloning is non-directional (two orientations) and the vector can self-ligate; dephosphorylate it."
                .to_string()
        ]
    );
    assert_eq!(
        b.summary,
        "BsaI-HFv2-cut insert (26 bp) ligated into the BsaI-HFv2-opened pBsa backbone (86 bp): 112 bp circular construct."
    );
    assert_eq!(b.construct_document.sequence, format!("{}{}GGTCTC{}{}", &bvec[..47], fill(19), fill(1), &bvec[47..]));
    assert_eq!(b.overhang_or_homology_left, "BsaI-HFv2 5'-AAAA-3' (5prime)");
    assert_eq!(b.overhang_or_homology_right, "BsaI-HFv2 5'-AAAA-3' (5prime)");

    // And the single-enzyme rule reaches the insert too: one site is not two.
    let one = clone6(&bv, &doc("iOne", format!("{}GGTCTC{}", fill(20), fill(20)), Topology::Linear), "Restriction Ligation", "BsaI", "BsaI-HFv2", "");
    assert!(!one.success);
    assert_eq!(
        one.warnings[0],
        "The insert must contain exactly two BsaI-HFv2 sites to release a fragment (found 1)."
    );
}

/// The definitions reach the resolver only: a sent definition never changes a catalogue enzyme's
/// own result, whichever method asks for it.
#[test]
fn us_01m7hrv4_ac2_sent_definitions_leave_every_catalogue_method_byte_identical() {
    let v = doc("pVec", VEC.to_string(), Topology::Circular);
    let i = doc("pIns", "GGGAATTCATGAAAGGGTTTTAACTCGAGCC".to_string(), Topology::Linear);
    let defs = [mine(), other(), custom("iis", "BsaI", "TGGTGGTGA", 5, 9, true)];
    for method in ["Restriction Ligation", "Gibson Assembly", "In-Fusion Cloning", "NEBuilder HiFi Assembly"] {
        let bare = clone6(&v, &i, method, "EcoRI", "XhoI", "BsaI");
        let sent = clone_with(&v, &i, method, "EcoRI", "XhoI", "BsaI", &defs);
        assert_eq!((sent.success, &sent.summary, &sent.warnings), (bare.success, &bare.summary, &bare.warnings), "{method}");
        assert_eq!(sent.construct_document.sequence, bare.construct_document.sequence, "{method}");
    }
    // Golden Gate's "BsaI" is the catalogue's BsaI-HFv2 even with a custom Type IIS named "BsaI".
    let gg_v = doc("ggVec", "AAAACCCCGGGGTTTTTGCCAGAGACCAAAAAAAAGGTCTCAGCTTACGTACGTACGTACGTACGTAC".to_string(), Topology::Circular);
    let gg_i = doc("ggPart", "TTGGTCTCATGCCATGAAACCCGGGTAAGCTTAGAGACCTT".to_string(), Topology::Linear);
    let bare = clone6(&gg_v, &gg_i, "Golden Gate (Type IIS)", "", "", "BsaI");
    let sent = clone_with(&gg_v, &gg_i, "Golden Gate (Type IIS)", "", "", "BsaI", &defs);
    assert!(sent.success && bare.success);
    assert_eq!(sent.summary, bare.summary);
    assert_eq!(sent.construct_document.sequence, bare.construct_document.sequence);
    assert!(sent.summary.starts_with("BsaI-HFv2 Golden Gate: "), "{}", sent.summary);
}

/// The source a definition carries is what marks it, so a definition is never shown as a built-in.
#[test]
fn us_01m7hrv4_ac3_a_definitions_source_is_what_marks_its_label() {
    let e = mine();
    assert_eq!(e.source, EnzymeSource::Custom);
    assert_eq!(molbiocraft_cloning::rebase_catalog::enzyme_label(&e), "EcoRI (custom)");
}

// ─── US-01M7J165: Golden Gate assembled with a stored custom Type IIS definition ───

/// Poly-C filler: it holds no motif below and no reverse complement of one, and carries no Dam
/// (GATC) or Dcm (CCWGG) context; a definition declares no methylation sensitivity here, so no
/// site planted beside it is ever read as blocked.
fn cs(n: usize) -> String {
    "C".repeat(n)
}

/// Adaeze's own Type IIS enzyme: a 7-nt motif, the top-strand cut 1 nt past it (`cut_fwd` 8) and
/// the bottom-strand cut 4 nt further (`cut_rev` 12), so it leaves a 4-nt 5' overhang outside its
/// recognition site - BsaI-HFv2's geometry over a motif of her own.
fn ada_iis() -> RestrictionEnzyme {
    custom("iis", "AdaIIS", "CTGCCGA", 8, 12, true)
}
/// The same definition NOT marked Type IIS, so only the flag differs.
fn ada_not_iis() -> RestrictionEnzyme {
    custom("flat", "AdaFlat", "CTGCCGA", 8, 12, false)
}

/// The 16 bp the construct opens with, and the 22 bp it ends with: the vector's two backbone
/// stretches, outside both of its sites.
const X: usize = 16;
const Y: usize = 22;
/// The part's own 16 bp between its overhangs. It begins "GA", which with the backbone's last C and
/// the TGCC overhang spells CTGCCGA again once the two are joined - the residual site, present in
/// neither input (the vector reads C TGCC A, the part A TGCC GA).
const INNER: &str = "GATGAAACCCGGGTAA";

/// The vector, 70 bp circular: a reverse-strand site whose overhang is TGCC and a forward-strand
/// site whose overhang is GCTT, pointing at each other, so the backbone between them is site-free.
fn iis_vector() -> SequenceDocument {
    let seq = format!("{}TGCCA{}{}{}AGCTT{}", cs(X), "TCGGCAG", cs(8), "CTGCCGA", cs(Y));
    assert_eq!(seq.len(), X + 5 + 7 + 8 + 7 + 5 + Y);
    assert_eq!(seq.len(), 70);
    doc("pIIS", seq, Topology::Circular)
}
/// The part, 41 bp linear: its two sites release TGCC + INNER + GCTT, the vector's own overhangs.
fn iis_part() -> SequenceDocument {
    let seq = format!("TT{}ATGCC{}GCTTA{}TT", "CTGCCGA", INNER, "TCGGCAG");
    assert_eq!(seq.len(), 2 + 7 + 5 + INNER.len() + 5 + 7 + 2);
    doc("pPart", seq, Topology::Linear)
}
/// The construct: the vector's two backbone stretches with the part's fragment between them, both
/// recognition sites excised - 16 + (4 + 16 + 4) + 22 = 62 bp.
fn iis_construct() -> String {
    format!("{}TGCC{}GCTT{}", cs(X), INNER, cs(Y))
}

/// Golden Gate with a `custom:` Type IIS id: the definition's own construct, its two overhangs, its
/// own words, and the residual-site warning its motif earns at the new junction.
#[test]
fn us_01m7j165_golden_gate_assembles_with_a_custom_type_iis_definition() {
    let (v, i) = (iis_vector(), iis_part());
    let r = clone_with(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:iis", &[ada_iis()]);
    assert!(r.success, "{:?}", r.warnings);
    assert_eq!(r.construct_document.sequence, iis_construct());
    assert_eq!(r.construct_document.sequence.len(), 62);
    assert_eq!(r.construct_document.topology, Topology::Circular);
    assert_eq!(r.overhang_or_homology_left, "5'-TGCC-3'");
    assert_eq!(r.overhang_or_homology_right, "5'-GCTT-3'");
    // Each piece runs from cut to cut, so one overhang travels with each: the part's fragment is
    // TGCC + INNER (20 bp) and the backbone GCTT + Y + X (42 bp), 62 bp once they are joined.
    assert_eq!(
        r.summary,
        "AdaIIS (custom) Golden Gate: 20 bp part joined to the 42 bp backbone through TGCC/GCTT overhangs: 62 bp construct."
    );
    assert_eq!(
        r.warnings,
        vec!["The product still contains a AdaIIS (custom) site and would be re-cut during cycling.".to_string()]
    );
    assert_eq!(
        r.construct_document.history.last().map(|h| h.operation.clone()),
        Some("Golden Gate Assembly (AdaIIS (custom))".to_string())
    );
    // Neither recognition site survives, and the motif's own count says the definition was read.
    assert!(!r.construct_document.sequence.contains("TCGGCAG"));
    assert_eq!(r.construct_document.sequence.matches("CTGCCGA").count(), 1);

    // Without the definition the same id is unknown, so the construct above is the definition's.
    let bare = clone6(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:iis");
    assert!(!bare.success);
    assert_eq!(bare.warnings[0], "Unknown enzyme \"custom:iis\".");
    assert_eq!(bare.construct_document.sequence, v.sequence);
}

/// A custom definition that is not marked Type IIS is refused by its label, however it cuts: only
/// the flag differs from the definition that assembles above.
#[test]
fn us_01m7j165_a_custom_definition_that_is_not_type_iis_is_refused_by_its_label() {
    let (v, i) = (iis_vector(), iis_part());
    let r = clone_with(&v, &i, "Golden Gate (Type IIS)", "", "", "custom:flat", &[ada_not_iis()]);
    assert!(!r.success);
    assert_eq!(r.warnings[0], "AdaFlat (custom) is not a Type IIS enzyme.");
    assert_eq!(r.construct_document.sequence, v.sequence);
    // A catalogue Type II enzyme is refused the same way, by its bare name.
    let b = clone6(&v, &i, "Golden Gate (Type IIS)", "", "", "EcoRI");
    assert!(!b.success);
    assert_eq!(b.warnings[0], "EcoRI is not a Type IIS enzyme.");
}
