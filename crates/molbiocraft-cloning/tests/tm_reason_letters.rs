// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFP8 AC4: the Tm no-answer reason names inosine and the letters that are no nucleotide
//! code, rather than calling them N. Wrong implementations, and the case that catches each:
//! - every letter that is not A, C, G or T counted as an ambiguity base (today's sentence): the
//!   I and XX oligos would read "1 N" and "2 N";
//! - inosine counted as a foreign letter, or the reverse: the mixed oligo names each count apart;
//! - the singular and plural mixed up: one inosine, one X and two X are each written out;
//! - an oligo of N and other codes only given the new form: it keeps today's sentence.

use molbiocraft_cloning::thermodynamics::{calculate_primer_metrics, tm_no_answer_reason};

const TAIL: &str = "; Tm is computed on A/C/G/T only, as Primer3 does";

#[test]
fn the_tm_reason_names_inosine_and_foreign_letters() {
    let cases: [(&str, String); 5] = [
        ("ACGTACGTACGTACGTACGI", format!("Tm n/a: the span holds 1 inosine (I){TAIL}")),
        ("ACGTACGTACGTACGTACXX", format!("Tm n/a: the span holds 2 letters that are not nucleotide codes{TAIL}")),
        (
            "ACGTNNACGTACGTACGTIX",
            format!("Tm n/a: the span holds 2 N or other ambiguity bases, 1 inosine (I) and 1 letter that is not a nucleotide code{TAIL}"),
        ),
        ("ACGTACGTACGTACGTNNRY", format!("Tm n/a: the span holds 4 N or other ambiguity bases{TAIL}")),
        ("acgtacgtacgtacgtacgu", String::new()),
    ];
    for (oligo, want) in cases {
        let m = calculate_primer_metrics(oligo, 50.0, 1.5, 250.0);
        let want = (!want.is_empty()).then_some(want);
        assert_eq!(m.tm_no_answer_reason, want, "{oligo}");
    }
    // The codes-only sentence is the one BG-01M6SHQ0 wrote, for any count of them.
    assert_eq!(tm_no_answer_reason(4), format!("Tm n/a: the span holds 4 N or other ambiguity bases{TAIL}"));
}
