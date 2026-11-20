// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regressions for cloning-engine batch operations found by the functional audit.

use molbiocraft_cloning::batch_ops::convert_selection_to_oligo_primer_at;
use molbiocraft_cloning::{
    extract_annotated_features_to_documents, find_non_cutting_enzymes_for_topology,
    get_sample_library, mask_sequence_regions, simulate_restriction_digest, SelectionRange1Based,
    MAX_MASK_RUN_FEATURES,
};
use molbiocraft_core::types::{SequenceDocument, SequenceFeature, Topology};

fn doc(seq: &str, topology: Topology) -> SequenceDocument {
    let mut d = get_sample_library().into_iter().next().expect("sample");
    d.id = "t".into();
    d.sequence = seq.into();
    d.topology = topology;
    d.features.clear();
    d.primers.clear();
    d
}

fn feature(start: usize, end: usize) -> SequenceFeature {
    let mut f = get_sample_library()
        .into_iter()
        .flat_map(|d| d.features)
        .next()
        .expect("a sample feature");
    f.id = format!("f-{start}-{end}");
    f.name = "wrap".into();
    f.feature_type = "CDS".into();
    f.start = start;
    f.end = end;
    f.strand = 1;
    f.segments = None;
    f
}

#[test]
fn non_cutters_respect_linear_topology() {
    // EcoRI (GAATTC) only exists across the end-to-start junction.
    let seq = "TTCAAACCCAAACCCAAACCCAAACCCGAA";
    let linear: Vec<String> = find_non_cutting_enzymes_for_topology(seq, Topology::Linear, None)
        .into_iter()
        .map(|e| e.name)
        .collect();
    let circular: Vec<String> =
        find_non_cutting_enzymes_for_topology(seq, Topology::Circular, None)
            .into_iter()
            .map(|e| e.name)
            .collect();
    assert!(
        linear.iter().any(|n| n == "EcoRI"),
        "linear: EcoRI does not cut"
    );
    assert!(
        !circular.iter().any(|n| n == "EcoRI"),
        "circular: EcoRI cuts across the origin"
    );
}

#[test]
fn circular_digest_fragments_end_before_the_next_cut() {
    let unit = "ACGTTGCAACGTTGCA";
    let mut seq = unit.repeat(200); // 3200 bp, no EcoRI
    seq.replace_range(100..106, "GAATTC");
    seq.replace_range(1000..1006, "GAATTC");
    let d = doc(&seq, Topology::Circular);
    let frags = simulate_restriction_digest(&d, &["EcoRI".to_string()]);
    assert_eq!(frags.len(), 2);
    let len = seq.len();
    for f in &frags {
        // Inclusive span (wrapping) must equal the fragment length.
        let span = if f.end >= f.start {
            f.end - f.start + 1
        } else {
            len - f.start + 1 + f.end
        };
        assert_eq!(span, f.length_bp, "{f:?}");
    }
}

#[test]
fn mask_homopolymers_annotates_each_run_and_ignores_gaps_and_masked_runs() {
    let d = doc("AAAAACGTCGTCGTTTTTT", Topology::Linear);
    let r = mask_sequence_regions(&d, "low-complexity", None);
    assert_eq!(r.masked_bases, 11);
    let spans: Vec<(usize, usize)> = r
        .updated
        .features
        .iter()
        .map(|f| (f.start, f.end))
        .collect();
    assert_eq!(spans, vec![(1, 5), (14, 19)]);
    // Running again masks nothing new and adds no duplicate features.
    let again = mask_sequence_regions(&r.updated, "low-complexity", None);
    assert_eq!(again.masked_bases, 0);
    assert_eq!(again.updated.features.len(), 2);
    // Alignment gaps are not homopolymers.
    let gapped = mask_sequence_regions(
        &doc("ACG-----TACGT", Topology::Linear),
        "low-complexity",
        None,
    );
    assert_eq!(gapped.updated.sequence, "ACG-----TACGT");
}

#[test]
fn extract_features_spanning_the_origin() {
    let seq: String = "ACGTACGTAC".repeat(4); // 40 bp
    let mut d = doc(&seq, Topology::Circular);
    d.features = vec![feature(35, 6)];
    let out = extract_annotated_features_to_documents(&d, "CDS");
    assert_eq!(out.len(), 1);
    assert_eq!(
        out[0].sequence.len(),
        12,
        "6 bases before + 6 after the origin"
    );
    assert_eq!(out[0].sequence, format!("{}{}", &seq[34..], &seq[..6]));
}

#[test]
fn mask_of_many_runs_masks_without_flooding_or_spanning_annotations() {
    // 600 separate homopolymer runs: one annotation each would flood the document.
    let seq: String = (0..600).map(|_| "AAAAAC").collect();
    let r = mask_sequence_regions(&doc(&seq, Topology::Linear), "low-complexity", None);
    assert_eq!(r.masked_bases, 600 * 5);
    assert!(600 > MAX_MASK_RUN_FEATURES);
    // No annotation that would span the unmasked bases between runs.
    assert!(r.updated.features.is_empty());
    assert_eq!(r.masked_runs, 600);
    assert!(r.annotations_omitted);
    assert_eq!(r.updated.sequence.matches('N').count(), 3000);
}

#[test]
fn protease_sites_carry_their_own_motif_on_both_strands() {
    use molbiocraft_cloning::detect_common_features;
    let rc = |s: &str| -> String {
        s.chars()
            .rev()
            .map(|c| match c {
                'A' => 'T',
                'T' => 'A',
                'G' => 'C',
                'C' => 'G',
                o => o,
            })
            .collect()
    };
    let pad = "ATATATATATCGCGCGATATATATATCG";
    let tev = "GAGAACCTGTACTTCCAGGGC";
    let thrombin = "CTGGTGCCGCGCGGCAGC";
    let seq = format!("{pad}{}{pad}{thrombin}{pad}", rc(tev));
    let found = detect_common_features(&doc(&seq, Topology::Linear));
    let tev_hit = found
        .iter()
        .find(|f| f.name.to_ascii_lowercase().contains("tev") && f.strand == -1)
        .expect("reverse-strand TEV site detected");
    assert_eq!(tev_hit.cleavage_site.as_deref(), Some("ENLYFQ▼G"));
    let thr = found
        .iter()
        .find(|f| f.name.contains("Thrombin"))
        .expect("thrombin site detected");
    assert_eq!(thr.cleavage_site.as_deref(), Some("LVPR▼GS"));
}

/// A 400 bp linear sequence, long enough for a 301..322 oligo to be taken as selected.
fn oligo_doc() -> SequenceDocument {
    let unit = "ATGCGTACCTGAGTCAAGTTCGAT";
    doc(&unit.repeat(17)[..400], Topology::Linear)
}

fn primer_ids(d: &SequenceDocument) -> Vec<String> {
    d.primers.iter().map(|p| p.id.clone()).collect()
}

fn range(start: usize, end: usize) -> Option<SelectionRange1Based> {
    Some(SelectionRange1Based { start, end })
}

// BG-01M6VZR5 AC1: a repeat conversion of one range keeps both records, under distinct ids.
#[test]
fn converting_a_range_twice_gives_distinct_oligo_ids() {
    let first = convert_selection_to_oligo_primer_at(&oligo_doc(), range(301, 322), 1, "");
    assert_eq!(first.primer.id, "prm-oligo-301-322");
    let second = convert_selection_to_oligo_primer_at(&first.updated_doc, range(301, 322), 1, "");
    assert_eq!(second.primer.id, "prm-oligo-301-322-2");
    assert_eq!(
        primer_ids(&second.updated_doc),
        vec!["prm-oligo-301-322", "prm-oligo-301-322-2"]
    );
    // The record returned is the record stored.
    assert_eq!(second.updated_doc.primers[1].id, second.primer.id);
    assert_eq!(
        second.updated_doc.primers[1].sequence,
        second.primer.sequence
    );
    let third = convert_selection_to_oligo_primer_at(&second.updated_doc, range(301, 322), 1, "");
    assert_eq!(third.primer.id, "prm-oligo-301-322-3");

    // Unique in the document, not counted per range: an id another primer already holds is
    // skipped and a free one below it is used, so a suffix drawn from a count of same-range
    // oligos (which lands on the taken `-3` here) cannot pass.
    let mut taken = oligo_doc();
    let mut squatter = first.primer.clone();
    squatter.id = "prm-oligo-301-322-3".into();
    squatter.name = "Imported".into();
    taken.primers.push(squatter);
    let a = convert_selection_to_oligo_primer_at(&taken, range(301, 322), 1, "");
    assert_eq!(a.primer.id, "prm-oligo-301-322");
    let b = convert_selection_to_oligo_primer_at(&a.updated_doc, range(301, 322), 1, "");
    assert_eq!(b.primer.id, "prm-oligo-301-322-2");
    let c = convert_selection_to_oligo_primer_at(&b.updated_doc, range(301, 322), 1, "");
    assert_eq!(c.primer.id, "prm-oligo-301-322-4");
    assert_eq!(
        primer_ids(&c.updated_doc),
        vec![
            "prm-oligo-301-322-3",
            "prm-oligo-301-322",
            "prm-oligo-301-322-2",
            "prm-oligo-301-322-4"
        ]
    );
}

// BG-01M6VZR5 AC2: the forward and the reverse oligo of one range are two primers, not one id.
#[test]
fn forward_and_reverse_oligos_of_one_range_get_distinct_ids() {
    for (first_strand, second_strand) in [(1, -1), (-1, 1)] {
        let a =
            convert_selection_to_oligo_primer_at(&oligo_doc(), range(301, 322), first_strand, "");
        let b = convert_selection_to_oligo_primer_at(
            &a.updated_doc,
            range(301, 322),
            second_strand,
            "",
        );
        let ids = primer_ids(&b.updated_doc);
        assert_eq!(ids.len(), 2, "both oligos are stored: {ids:?}");
        assert_ne!(
            ids[0], ids[1],
            "strands {first_strand}/{second_strand}: {ids:?}"
        );
        assert_eq!(b.primer.id, ids[1]);
        assert_eq!(b.updated_doc.primers[0].strand, first_strand);
        assert_eq!(b.updated_doc.primers[1].strand, second_strand);
    }
}
