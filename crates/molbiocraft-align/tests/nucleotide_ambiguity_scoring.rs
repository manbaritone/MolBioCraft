// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VF1T: one nucleotide pair class (iupac.rs) decides how the pairwise and the progressive
//! aligners score, count and mark a column. Identity is the same definite base (A, C, G, T, U read
//! as T); Overlap is a definite base against a two-base code that holds it, exactly the off-diagonal
//! pairs NCBI NUC.4.4 (EDNAFULL) scores +1; everything else, N/N and R/R included, is a Mismatch.
//!
//! The expected classes come from this file's own table of the twelve NUC.4.4-positive pairs, not
//! from the engine. The pairwise reply is the one `dispatch_bio_rpc` `align_pairwise_gotoh` returns
//! (`align_pairwise_named` with the dispatcher's defaults: match 2, mismatch -1, gap open -5, gap
//! extend -1).
//!
//! Wrong implementations this catches: `a == b` read as identity for any letter (N/N and R/R
//! counted, marked '|' and written '=' in the CIGAR, as today); any meeting pair given the overlap
//! credit (A/N, A/V, N/N); the progressive aligner keeping its own rule (R/R at 5); an identity
//! sentence missing, miscounted, or given for a pure A/C/G/T pair.

use molbiocraft_align::pairwise::{align_pairwise_gotoh, align_pairwise_named, PairwiseMode, ScoringMatrixKind};
use molbiocraft_align::progressive::pair_score;
use molbiocraft_core::iupac::{nucleotide_pair_class, NucleotidePairClass};

const LETTERS: &[u8] = b"ACGTURYSWKMBDHVN";
/// The off-diagonal pairs NUC.4.4 scores +1: a definite base and a two-base code holding it.
const NUC44_POSITIVE: [(u8, u8); 12] = [
    (b'A', b'R'), (b'A', b'W'), (b'A', b'M'),
    (b'C', b'S'), (b'C', b'Y'), (b'C', b'M'),
    (b'G', b'R'), (b'G', b'S'), (b'G', b'K'),
    (b'T', b'W'), (b'T', b'Y'), (b'T', b'K'),
];

fn as_t(b: u8) -> u8 {
    if b == b'U' { b'T' } else { b }
}

fn expected(a: u8, b: u8) -> NucleotidePairClass {
    let (a, b) = (as_t(a), as_t(b));
    if a == b && b"ACGT".contains(&a) {
        NucleotidePairClass::Identity
    } else if NUC44_POSITIVE.iter().any(|&(x, y)| (x, y) == (a, b) || (y, x) == (a, b)) {
        NucleotidePairClass::Overlap
    } else {
        NucleotidePairClass::Mismatch
    }
}

#[test]
fn one_pair_rule_for_both_aligners() {
    let mut overlaps = 0;
    for &a in LETTERS {
        for &b in LETTERS {
            let class = expected(a, b);
            assert_eq!(nucleotide_pair_class(a, b), class, "{}/{}", a as char, b as char);
            assert_eq!(
                nucleotide_pair_class(a.to_ascii_lowercase(), b),
                class,
                "{}/{} in lower case",
                a as char,
                b as char
            );
            if class == NucleotidePairClass::Overlap && a != b'U' && b != b'U' {
                overlaps += 1;
            }

            // The progressive aligner: 5, 1, -4 by the class.
            let want = match class {
                NucleotidePairClass::Identity => 5.0,
                NucleotidePairClass::Overlap => 1.0,
                NucleotidePairClass::Mismatch => -4.0,
            };
            assert_eq!(pair_score(a, b, false), want, "progressive {}/{}", a as char, b as char);

            // The pairwise aligner on a one-column pair: the class's score, identity count, mark,
            // CIGAR operation and similarity.
            let r = align_pairwise_gotoh(
                &(a as char).to_string(),
                &(b as char).to_string(),
                PairwiseMode::Global,
                Some(ScoringMatrixKind::DnaIupac),
                2,
                -1,
                -5,
                -1,
                4000,
            );
            let (score, matches, mark, cigar, similarity) = match class {
                NucleotidePairClass::Identity => (2, 1, "|", "1=", 100.0),
                NucleotidePairClass::Overlap => (1, 0, ":", "1X", 100.0),
                NucleotidePairClass::Mismatch => (-1, 0, ".", "1X", 0.0),
            };
            assert_eq!(
                (r.score, r.matches, r.midline.as_str(), r.cigar.as_str(), r.similarity_pct),
                (score, matches, mark, cigar, similarity),
                "pairwise {}/{}",
                a as char,
                b as char
            );
        }
    }
    assert_eq!(overlaps, 24, "the twelve NUC.4.4-positive pairs, each way round");
    for (a, b) in [(b'N', b'N'), (b'R', b'R'), (b'A', b'N'), (b'A', b'V')] {
        assert_eq!(nucleotide_pair_class(a, b), NucleotidePairClass::Mismatch, "{}/{}", a as char, b as char);
    }
}

/// The class score of a column under the dispatcher's defaults.
fn column_score(a: u8, b: u8) -> i32 {
    match nucleotide_pair_class(a, b) {
        NucleotidePairClass::Identity => 2,
        NucleotidePairClass::Overlap => 1,
        NucleotidePairClass::Mismatch => -1,
    }
}

/// The score of the returned columns: each aligned column's class score, and each gap run's
/// open (-5) plus its extensions (-1 per column).
fn score_of_columns(a1: &[u8], a2: &[u8]) -> i32 {
    let mut total = 0;
    let mut gap_in: Option<u8> = None;
    for (&x, &y) in a1.iter().zip(a2) {
        let gap = if x == b'-' { Some(1) } else if y == b'-' { Some(2) } else { None };
        match gap {
            None => total += column_score(x, y),
            Some(row) => {
                if gap_in != Some(row) {
                    total -= 5;
                }
                total -= 1;
            }
        }
        gap_in = gap;
    }
    total
}

fn named(s1: &str, s2: &str) -> molbiocraft_align::pairwise::NamedPairwiseAlignment {
    align_pairwise_named(s1, s2, "global", "nucleotide", 2, -1, -5, -1, 4000)
}

fn identity_sentence(n: usize) -> String {
    format!(
        "Identity counts only identical A, C, G and T/U; {n} columns pair N or another ambiguity code and are not counted as identities."
    )
}

#[test]
fn n_pairs_score_and_count_as_nuc44_signs_them() {
    let n20 = "N".repeat(20);
    for (s1, s2, ambiguous) in [
        (format!("ACGT{n20}ACGT"), format!("TGCA{n20}TGCA"), 20),
        ("ACRRACGT".to_string(), "ACRRACGT".to_string(), 2),
        ("ACGTACGTAC".to_string(), "ACGAACGTAC".to_string(), 0),
    ] {
        let reply = named(&s1, &s2);
        let r = &reply.alignment;
        let (a1, a2, mid) = (r.aligned_seq1.as_bytes(), r.aligned_seq2.as_bytes(), r.midline.as_bytes());
        assert_eq!(a1.len(), a2.len());
        let identical: Vec<usize> = (0..a1.len())
            .filter(|&i| a1[i] == a2[i] && b"ACGT".contains(&a1[i]))
            .collect();
        let marked: Vec<usize> = (0..mid.len()).filter(|&i| mid[i] == b'|').collect();
        assert_eq!(r.matches, identical.len(), "{s1} / {s2}: matches are the identical A/C/G/T columns");
        assert_eq!(marked, identical, "{s1} / {s2}: '|' marks exactly those columns");
        let pct = ((identical.len() as f64 / a1.len() as f64) * 10000.0).round() / 100.0;
        assert_eq!(r.identity_pct, pct, "{s1} / {s2}: identity over the alignment length");
        assert_eq!(r.score, score_of_columns(a1, a2), "{s1} / {s2}: the score of the returned columns");
        let counted = (0..a1.len())
            .filter(|&i| a1[i] != b'-' && a2[i] != b'-' && !(b"ACGT".contains(&a1[i]) && b"ACGT".contains(&a2[i])))
            .count();
        assert_eq!(counted, ambiguous, "{s1} / {s2}: the fixture's ambiguity columns");
        let want: Vec<String> = if ambiguous == 0 { vec![] } else { vec![identity_sentence(ambiguous)] };
        assert_eq!(reply.warnings, want, "{s1} / {s2}");
    }
    // Today's reading of the N20 pair (20 matches, 71.43%) is gone.
    let r = named(&format!("ACGT{n20}ACGT"), &format!("TGCA{n20}TGCA")).alignment;
    assert!(r.matches < 20 && r.identity_pct < 71.43, "{} matches, {}%", r.matches, r.identity_pct);
}
