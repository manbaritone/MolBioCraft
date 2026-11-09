// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1C1: the workflow macro's JASPAR TF scanner reports the engine scan's top hits, at the
//! same coordinates, for the same document: the studio's scan, which now reads the whole sequence
//! too. On a 300 kb sequence the top hits are the planted sites, on both strands and past 250 kb,
//! each at the bases it was planted on.

use molbiocraft_cloning::{execute_builtin_rust_workflow_macro, get_sample_library};
use molbiocraft_core::scan_jaspar_pssm_motifs;
use molbiocraft_core::types::SequenceDocument;

fn revcomp(s: &[u8]) -> Vec<u8> {
    s.iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'T' => b'A',
            b'G' => b'C',
            _ => b'G',
        })
        .collect()
}

fn group(n: usize) -> String {
    let d = n.to_string();
    d.chars()
        .enumerate()
        .flat_map(|(i, c)| (i > 0 && (d.len() - i) % 3 == 0).then_some(',').into_iter().chain([c]))
        .collect()
}

/// The consensus sites of two catalogue matrices: each scores the matrix's best (1.0).
const CTCF: (&str, &[u8]) = ("MA0139.1", b"CCACCAGGGGGCGC");
const T7: (&str, &[u8]) = ("PHAGE_T7P", b"TAATACGACTCACTATAGGG");

#[test]
fn macro_tf_scan_matches_the_studio_scan() {
    // 300 kb of A and C only (its minus strand G and T only). No catalogue site is made of one
    // such pair, so no window of it scores 1.000 on either strand (some score lower, such as
    // SP1's GGGGTGGGG on the minus strand), and the hits scoring 1.000 are the planted sites.
    // Five lie before base 250,000 and twelve past it, mostly on the minus strand.
    let mut x = 0x7f5c_a11e_u64;
    let mut seq: Vec<u8> = (0..300_000)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            if x & 1 == 0 { b'A' } else { b'C' }
        })
        .collect();
    let mut planted: Vec<(&str, usize, usize, i8)> = Vec::new();
    let sites = [
        (CTCF, 40_001, -1i8),
        (T7, 90_001, 1),
        (CTCF, 140_001, 1),
        (T7, 190_001, -1),
        (CTCF, 240_001, -1),
        (T7, 251_001, -1),
        (CTCF, 255_001, -1),
        (T7, 259_001, 1),
        (CTCF, 263_001, -1),
        (T7, 267_001, -1),
        (CTCF, 271_001, 1),
        (T7, 275_001, -1),
        (CTCF, 279_001, -1),
        (T7, 283_001, -1),
        (CTCF, 287_001, -1),
        (T7, 291_001, 1),
        (CTCF, 295_001, -1),
    ];
    for ((id, site), at, strand) in sites {
        let bases = if strand == 1 { site.to_vec() } else { revcomp(site) };
        seq[at - 1..at - 1 + site.len()].copy_from_slice(&bases);
        planted.push((id, at, at + site.len() - 1, strand));
    }
    // A document as the app holds an imported FASTA: lower case, 60 bases a line.
    let mut doc: SequenceDocument = get_sample_library().into_iter().next().expect("sample");
    doc.sequence = seq.chunks(60).map(|l| format!("{}\n", String::from_utf8(l.to_ascii_lowercase()).unwrap())).collect();
    doc.features.clear();

    let out = execute_builtin_rust_workflow_macro("js-jaspar-pssm-tf-scanner", &doc);
    let scan = scan_jaspar_pssm_motifs(&doc.sequence, 0.85, None);

    // The macro's top hits are the engine scan's first 15, field for field.
    let top = out["topHits"].as_array().expect("topHits");
    assert_eq!(top.len(), 15);
    assert_eq!(out["topHits"], serde_json::to_value(&scan.hits[..15]).unwrap());
    assert_eq!(out["totalHitsFound"], scan.total_hits);
    assert_eq!(out["motifsEvaluated"], scan.motifs_evaluated);
    assert_eq!((out["scannedLengthBp"].as_u64(), out["sequenceLengthBp"].as_u64()), (Some(300_000), Some(300_000)));

    // They are the 15 planted sites that come first: every one scores 1.0, so they rank by start,
    // and each sits at its own coordinates on its own strand.
    let got: Vec<(String, usize, usize, i8)> = top
        .iter()
        .map(|h| {
            (
                h["matrixId"].as_str().unwrap().to_string(),
                h["start"].as_u64().unwrap() as usize,
                h["end"].as_u64().unwrap() as usize,
                h["strand"].as_i64().unwrap() as i8,
            )
        })
        .collect();
    let want: Vec<(String, usize, usize, i8)> = planted[..15].iter().map(|&(id, s, e, st)| (id.to_string(), s, e, st)).collect();
    assert_eq!(got, want);
    for h in top {
        assert_eq!(h["relativeScore"], 1.0, "{h}");
        let (start, end) = (h["start"].as_u64().unwrap() as usize, h["end"].as_u64().unwrap() as usize);
        let fwd = &seq[start - 1..end];
        let read = if h["strand"] == 1 { fwd.to_vec() } else { revcomp(fwd) };
        assert_eq!(h["matchedSeq"].as_str().unwrap().as_bytes(), read.as_slice(), "{h}");
    }

    // Its warnings describe its own list: the whole sequence was read, and it shows 15 of the hits.
    assert!(scan.total_hits > 15, "fixture: more hits than the macro lists");
    assert_eq!(
        out["warnings"],
        serde_json::json!([format!("TF motif hit list capped: it lists the 15 best-scoring of the {} hits found.", group(scan.total_hits))])
    );
}
