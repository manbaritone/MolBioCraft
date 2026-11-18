// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7NKNJ: every aligner that picks its own scoring makes one call of the shared alphabet rule
//! (US-01M6VFRY's `classify_molecule`) over all its inputs together, scores a nucleotide call with
//! the IUPAC nucleotide matrix under US-01M6VF1T's pair class, keeps a letter that is no nucleotide
//! code as written, names it in `warnings` as scored as N, and names the matrix it used in `matrix`.
//!
//! Each reply here is the one the `dispatch_bio_rpc` arm returns: the function the arm calls, with
//! the arm's defaults, serialised to JSON as the arm serialises it (`align_pairwise_gotoh`: match 2,
//! mismatch -1, gap open -5, gap extend -1, maxLen 4000; `run_msa`: maxSeqLen 2400, the default
//! route when `algorithm` is empty; `align_pairwise_banded_sparse`: k 6, w 24, match 2, mismatch -1,
//! gap open -5, gap extend -1, maxLen 25000). molbiocraft-wasm depends on this crate and is no
//! dependency of its tests, so the arms' calls are repeated here, as nucleotide_ambiguity_scoring.rs
//! does.
//!
//! Wrong implementations this catches: a per-sequence protein test (one I or X switching the pair or
//! the whole MSA to BLOSUM62 and the protein distance formula, as before); the stray letter dropped
//! or replaced in the aligned text; no warning, or one naming the wrong letter, position or
//! sequence; a stray letter counted in the ambiguity-identity sentence; the matrix field missing or
//! naming BLOSUM62 for a nucleotide call; the banded aligner keeping `a == b` (N/N counted as an
//! identity) or its own compatibility rule (A/N scored as a match); the uncertain call left unsaid.

use molbiocraft_align::msa::{run_multiple_sequence_alignment, MsaInputDoc};
use molbiocraft_align::pairwise::align_pairwise_named;
use molbiocraft_align::poa_and_banded::{
    align_pairwise_banded_sparse_with_warnings, run_multiple_sequence_alignment_with_algorithm,
};
use serde_json::{json, Value};

const DNA: &str = "ACGTACGTAAACCCGGGTTT";
const WITH_I: &str = "ACGTACGTAAICCCGGGTTT";
const WITH_X: &str = "ACGTACGTAAXCCCGGGTTT";

/// The `align_pairwise_gotoh` reply for this pair, mode global, matrix `matrix`.
fn gotoh(seq1: &str, seq2: &str, matrix: &str) -> Value {
    serde_json::to_value(align_pairwise_named(seq1, seq2, "global", matrix, 2, -1, -5, -1, 4000)).unwrap()
}

/// The `align_pairwise_banded_sparse` reply for this pair, mode global.
fn banded(seq1: &str, seq2: &str) -> Value {
    serde_json::to_value(align_pairwise_banded_sparse_with_warnings(seq1, seq2, "global", 6, 24, 2, -1, -5, -1, 25_000))
        .unwrap()
}

/// The `run_msa` reply for these rows (ids r1.., names row_1..), by `algorithm` ("" = the default).
fn msa(rows: &[&str], algorithm: &str) -> Value {
    let docs: Vec<MsaInputDoc> = rows
        .iter()
        .enumerate()
        .map(|(i, s)| MsaInputDoc { id: format!("r{}", i + 1), name: format!("row_{}", i + 1), sequence: s.to_string() })
        .collect();
    serde_json::to_value(if algorithm.is_empty() {
        run_multiple_sequence_alignment(&docs, 2400)
    } else {
        run_multiple_sequence_alignment_with_algorithm(&docs, 2400, algorithm)
    })
    .unwrap()
}

fn warnings(reply: &Value) -> Vec<String> {
    reply["warnings"].as_array().expect("warnings is a list").iter().map(|w| w.as_str().unwrap().to_string()).collect()
}

#[test]
fn auto_matrix_reads_the_alphabet_rule_and_names_stray_letters() {
    let inosine = "1 inosine (I at 11 in sequence 1) was scored as N.";
    let other = "1 letter that is not a nucleotide code (X at 11 in sequence 1) was scored as N.";
    for (seq1, sentence) in [(WITH_I, inosine), (WITH_X, other)] {
        let r = gotoh(seq1, DNA, "auto");
        assert_eq!(r["matrix"], json!("IUPAC nucleotide"), "{seq1}: {r}");
        assert_eq!(r["score"], json!(37), "{seq1}: 19 matches at 2 and one mismatch at -1");
        assert_eq!(r["alignedSeq1"], json!(seq1), "{seq1}: the stray letter kept as written");
        assert_eq!(r["alignedSeq2"], json!(DNA));
        assert_eq!(r["matches"], json!(19));
        assert_eq!(warnings(&r), [sentence], "{seq1}");
        // the stray letter scores as an N in its place does
        let as_n = gotoh(&seq1.replace(['I', 'X'], "N"), DNA, "auto");
        assert_eq!((&as_n["score"], &as_n["matrix"]), (&r["score"], &r["matrix"]), "{seq1}");
        // the named nucleotide matrix aligns the same and names the same letter
        let named = gotoh(seq1, DNA, "nucleotide");
        assert_eq!(named, r, "{seq1}: matrix 'nucleotide'");
    }
    // the letter is named in the sequence that holds it, by its own position there
    assert_eq!(
        warnings(&gotoh(DNA, "ACGTXACGTAAACCCGGGTTT", "auto")),
        ["1 letter that is not a nucleotide code (X at 5 in sequence 2) was scored as N."]
    );
    assert_eq!(
        warnings(&gotoh("ACGTACGTAXIXCCGGGTTT", DNA, "auto")),
        [
            "1 inosine (I at 11 in sequence 1) was scored as N.",
            "2 letters that are not nucleotide codes (X at 10 and 12 in sequence 1) were scored as N.",
        ]
    );

    let pure = gotoh(DNA, DNA, "auto");
    assert_eq!((&pure["score"], &pure["matrix"]), (&json!(40), &json!("IUPAC nucleotide")));
    assert_eq!(warnings(&pure), Vec::<String>::new());

    let protein = "MKWVTFISLLFLFSSAYS";
    let p = gotoh(protein, protein, "auto");
    assert_eq!(p["matrix"], json!("BLOSUM62"), "{p}");
    assert_eq!(warnings(&p), Vec::<String>::new());
    assert_eq!(gotoh(protein, protein, "pam250")["matrix"], json!("PAM250"));

    // D0223: one call over a pair this dense in ambiguity codes (12 of 22 letters A, C, G, T, U or
    // N, under the rule's 60%) reads protein, certain (core under 60%), so 'auto' scores it by
    // BLOSUM62 and owes no sentence: none of its letters is outside the IUPAC nucleotide codes and
    // the call is not uncertain. tests/alignment_validation.rs pins its nucleotide scores by name.
    let dense = gotoh("RYSWKMBDHVN", "ACGTACGTACG", "auto");
    assert_eq!(dense["matrix"], json!("BLOSUM62"), "{dense}");
    assert_eq!(dense["score"], json!(-12), "{dense}");
    assert_eq!(warnings(&dense), Vec::<String>::new());
    let named = gotoh("RYSWKMBDHVN", "ACGTACGTACG", "nucleotide");
    assert_eq!((&named["matrix"], &named["score"]), (&json!("IUPAC nucleotide"), &json!(-1)), "{named}");
}

#[test]
fn msa_reads_one_alphabet_call_for_all_rows() {
    let rows = ["ACGTACGTAAACCCGGGTTT", "ACGTACGTAAXCCCGGGTTT", "ACGTACGTAAGCCCGGGTTT"];
    let as_n: Vec<String> = rows.iter().map(|r| r.replace('X', "N")).collect();
    let as_n: Vec<&str> = as_n.iter().map(String::as_str).collect();
    let sentence = "1 letter that is not a nucleotide code (X at 11 in row 2) was scored as N.";
    // Row 2 one C short: BLOSUM62 aligns it to row 1 with the gap just after the X, the nucleotide
    // matrix three columns earlier, so a pair scored by BLOSUM62 for its X shows in the rows. Not
    // for graph-backbone: its POA backbone (rust-bio poa, scored by letter equality) is kept for
    // the N rows and loses to center-star for the X rows, a tie-break outside the scoring matrix.
    let gapped = ["ACGTACGTAAACCCGGGTTT", "ACGTACGTAAXCCGGGTTT", "ACGTACGTAAGCCCGGGTTT"];
    let gapped_n: Vec<&str> = vec![gapped[0], "ACGTACGTAANCCGGGTTT", gapped[2]];
    for algorithm in ["", "consistency-nj", "consistency-upgma", "progressive-upgma", "graph-backbone"] {
        if algorithm == "graph-backbone" {
            assert_eq!(msa(&gapped, algorithm)["matrix"], json!("IUPAC nucleotide"));
        } else {
            let (g, gn) = (msa(&gapped, algorithm), msa(&gapped_n, algorithm));
            assert_eq!(g["matrix"], json!("IUPAC nucleotide"), "{algorithm:?}: gapped");
            for key in ["consensus", "newickTree"] {
                assert_eq!(g[key], gn[key], "{algorithm:?}: gapped {key}");
            }
            let g_rows: Vec<String> = g["rows"].as_array().unwrap().iter().map(|r| r["alignedSeq"].as_str().unwrap().replace('X', "N")).collect();
            let gn_rows: Vec<String> = gn["rows"].as_array().unwrap().iter().map(|r| r["alignedSeq"].as_str().unwrap().to_string()).collect();
            assert_eq!(g_rows, gn_rows, "{algorithm:?}: the gapped rows the N rows give");
            assert!(warnings(&g).iter().any(|w| w == sentence), "{algorithm:?}: {:?}", warnings(&g));
        }

        let r = msa(&rows, algorithm);
        let n = msa(&as_n, algorithm);
        assert_eq!(r["matrix"], json!("IUPAC nucleotide"), "{algorithm:?}: {r}");
        let aligned = |v: &Value| -> Vec<String> {
            v["rows"].as_array().unwrap().iter().map(|row| row["alignedSeq"].as_str().unwrap().to_string()).collect()
        };
        let got = aligned(&r);
        assert_eq!(got[1].replace('-', ""), rows[1], "{algorithm:?}: row 2 keeps its X");
        let with_n: Vec<String> = got.iter().map(|s| s.replace('X', "N")).collect();
        assert_eq!(with_n, aligned(&n), "{algorithm:?}: the rows the N rows give");
        assert_eq!(r["consensus"], n["consensus"], "{algorithm:?}: consensus");
        assert_eq!(r["newickTree"], n["newickTree"], "{algorithm:?}: tree");
        assert!(warnings(&r).iter().any(|w| w == sentence), "{algorithm:?}: {:?}", warnings(&r));
        assert_eq!(warnings(&n), Vec::<String>::new(), "{algorithm:?}: the N rows warn of nothing");
    }
    let protein = ["MKWVTFISLLFLFSSAYS", "MKWVTFISLLFLFSSAYS", "MKWVTFISLLGLFSSAYS"];
    for algorithm in ["", "consistency-nj", "graph-backbone"] {
        let p = msa(&protein, algorithm);
        assert_eq!(p["matrix"], json!("BLOSUM62"), "{algorithm:?}: {p}");
        assert_eq!(warnings(&p), Vec::<String>::new(), "{algorithm:?}");
    }
}

#[test]
fn banded_pairwise_reads_the_same_rules() {
    let r = banded(WITH_I, DNA);
    assert_eq!(r["matrix"], json!("IUPAC nucleotide"), "{r}");
    assert_eq!(r["alignedSeq1"], json!(WITH_I));
    assert_eq!(r["score"], json!(37));
    assert_eq!(warnings(&r), ["1 inosine (I at 11 in sequence 1) was scored as N."]);

    // a nucleotide call scores R/A as the overlap it is (+1, ':'), not as a protein mismatch (-1)
    let overlap = banded("ACGTACGTAAIRCCGGGTTT", "ACGTACGTAAAACCGGGTTT");
    assert_eq!(overlap["score"], json!(18 * 2 - 1 + 1), "{overlap}");
    assert_eq!(overlap["midline"], json!("||||||||||.:||||||||"));

    // N/N is no identity, and A/N no match (US-01M6VF1T AC4, as align_pairwise_gotoh counts it)
    let n20 = "N".repeat(20);
    let (s1, s2) = (format!("ACGT{n20}ACGT"), format!("TGCA{n20}TGCA"));
    let b = banded(&s1, &s2);
    let (a1, a2) = (b["alignedSeq1"].as_str().unwrap().as_bytes(), b["alignedSeq2"].as_str().unwrap().as_bytes());
    let identical = (0..a1.len()).filter(|&i| a1[i] == a2[i] && b"ACGT".contains(&a1[i])).count();
    assert_eq!(b["matches"], json!(identical), "{b}");
    let nn = (0..a1.len()).filter(|&i| a1[i] == b'N' && a2[i] == b'N').count();
    assert!(nn > 0, "fixture: N/N columns aligned");
    let marked = b["midline"].as_str().unwrap().bytes().filter(|&m| m == b'|').count();
    assert_eq!(marked, identical, "'|' marks only identical A/C/G/T columns");
    assert!(!b["cigar"].as_str().unwrap().contains(&format!("{nn}=")), "N/N is no '=' in the CIGAR: {}", b["cigar"]);
    assert_eq!(b["matrix"], json!("IUPAC nucleotide"));
    // the gotoh reply for the same pair counts the same identities
    assert_eq!(b["matches"], gotoh(&s1, &s2, "auto")["matches"]);
    let small = banded("ACGTN", "ACGTA");
    assert_eq!(small["score"], json!(4 * 2 - 1), "A/N is a mismatch: {small}");
}

#[test]
fn an_uncertain_call_is_named_in_the_reply() {
    let s = "MKVAGCATNG";
    let r = gotoh(s, s, "auto");
    assert_eq!(r["matrix"], json!("IUPAC nucleotide"), "{r}");
    let sentence = "Read as DNA, though 3 of 10 letters (K, M, V) are also amino-acid letters: set the molecule type to Protein if this is a protein.";
    assert!(warnings(&r).iter().any(|w| w == sentence), "{:?}", warnings(&r));
    // two different sequences are read in one call over both: 20 letters
    let other = gotoh(s, "MKVAGCATNA", "auto");
    let both = "Read as DNA, though 6 of 20 letters (K, M, V) are also amino-acid letters: set the molecule type to Protein if this is a protein.";
    assert!(warnings(&other).iter().any(|w| w == both), "{:?}", warnings(&other));
    // a named matrix is the caller's choice, and the call's sentence is not owed
    assert!(!warnings(&gotoh(s, s, "nucleotide")).iter().any(|w| w.starts_with("Read as")));
    // a certain call says nothing of it
    assert!(!warnings(&gotoh(DNA, DNA, "auto")).iter().any(|w| w.starts_with("Read as")));
    // the MSA reads one call over all its rows and says it the same way
    let m = msa(&[s, s, s], "");
    let sentence30 = "Read as DNA, though 9 of 30 letters (K, M, V) are also amino-acid letters: set the molecule type to Protein if this is a protein.";
    assert!(warnings(&m).iter().any(|w| w == sentence30), "{:?}", warnings(&m));
    assert_eq!(m["matrix"], json!("IUPAC nucleotide"));
}
