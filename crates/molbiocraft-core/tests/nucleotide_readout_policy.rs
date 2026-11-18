// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFP8 AC1 and AC2: `analyze_sequence_composition` counts four kinds of letter apart, and
//! its ε260 says how it weighed each. Wrong implementations, and the case that catches each:
//! - every letter that is not A, C, G or T folded into N (today's count): RYKM, IIII and EFLP each
//!   read N 4;
//! - inosine counted as an ambiguity code, or a foreign letter as one: IIII and EFLP must land in
//!   their own counts;
//! - ε260 left at A/C/G/T only (172,000 for NNNN and RRRR), or every code weighed as N (215,000 for
//!   RRRR): RRRR must weigh 225,800, the mean of A and G four times over 172,000;
//! - inosine or a foreign letter weighed as N: IIII and EFLP must stay at 172,000, each named;
//! - a warning on an all-A/C/G/T sequence: ACGT×5 has none.

use molbiocraft_core::analyze_sequence_composition;

const ACGT4: &str = "ACGTACGTACGTACGT";

#[test]
fn composition_counts_codes_inosine_and_other_letters_apart() {
    // (tail, N, ambiguity, inosine, other)
    let cases: [(&str, usize, usize, usize, usize); 5] = [
        ("NNNN", 4, 0, 0, 0),
        ("RYKM", 0, 4, 0, 0),
        ("IIII", 0, 0, 4, 0),
        ("EFLP", 0, 0, 0, 4),
        // lower case and U read the same way; a gap and a stop are no letter at all
        ("nr-*iu", 1, 1, 1, 0),
    ];
    for (tail, n, ambiguity, inosine, other) in cases {
        let comp = analyze_sequence_composition(&format!("{ACGT4}{tail}"));
        let c = &comp.counts;
        let t = if tail.contains('u') { 5 } else { 4 };
        assert_eq!(
            (c.a, c.c, c.g, c.t, c.n, c.ambiguity, c.inosine, c.other),
            (4, 4, 4, t, n, ambiguity, inosine, other),
            "ACGT×4 + {tail}"
        );
    }
    // The reply names the counts by these keys, and keeps a zero count out of `counts` so a reader
    // comparing the A/C/G/T/N counts whole still reads them; the foreign letters are listed apart.
    let json = serde_json::to_value(analyze_sequence_composition(&format!("{ACGT4}RIIEEF"))).unwrap();
    assert_eq!(json["counts"], serde_json::json!({ "A": 4, "C": 4, "G": 4, "T": 4, "N": 0, "ambiguity": 1, "inosine": 2, "other": 3 }));
    assert_eq!(json["otherLetters"], serde_json::json!(["E", "F"]));
    let plain = serde_json::to_value(analyze_sequence_composition(ACGT4)).unwrap();
    assert_eq!(plain["counts"], serde_json::json!({ "A": 4, "C": 4, "G": 4, "T": 4, "N": 0 }));
}

#[test]
fn extinction_weighs_codes_by_their_bases_and_names_what_it_leaves_out() {
    let codes = |n: usize| format!("ε260 weighs {n} N or other ambiguity bases as the mean of the bases each may be; it is an estimate.");
    let cases: [(String, f64, Vec<String>); 8] = [
        (ACGT4.to_string(), 172_000.0, vec![]),
        ("ACGT".repeat(5), 215_000.0, vec![]),
        (format!("{ACGT4}NNNN"), 215_000.0, vec![codes(4)]),
        (format!("{ACGT4}RRRR"), 225_800.0, vec![codes(4)]),
        // Y 8,050, K 10,100, M 11,400 and N 10,750 by the same mean
        (format!("{ACGT4}YKMN"), 172_000.0 + 8_050.0 + 10_100.0 + 11_400.0 + 10_750.0, vec![codes(4)]),
        (format!("{ACGT4}IIII"), 172_000.0, vec!["ε260 leaves out 4 letters it has no value for: 4 inosine (I).".to_string()]),
        (
            format!("{ACGT4}EFLP"),
            172_000.0,
            vec!["ε260 leaves out 4 letters it has no value for: 4 that are not nucleotide codes (E, F, L, P).".to_string()],
        ),
        (
            format!("{ACGT4}RIX"),
            172_000.0 + 13_450.0,
            vec![
                "ε260 weighs 1 N or other ambiguity base as the mean of the bases each may be; it is an estimate.".to_string(),
                "ε260 leaves out 2 letters it has no value for: 1 inosine (I) and 1 that is not a nucleotide code (X).".to_string(),
            ],
        ),
    ];
    for (seq, eps, warnings) in cases {
        let comp = analyze_sequence_composition(&seq);
        assert!((comp.extinction_coeff260 - eps).abs() < 1e-6, "{seq}: ε260 {} not {eps}", comp.extinction_coeff260);
        assert_eq!(comp.warnings, warnings, "{seq}");
    }
}
