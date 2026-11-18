// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFP8 AC3: `compute_sequence_stats`, through the dispatcher the WASM op and the desktop IPC
//! commands share, gives the Tm's no-answer reason and flags a protein. Wrong implementations, and
//! the case that catches each:
//! - no reason at all (today): the N run must carry one;
//! - a reason with the basic Tm made null: basic_tm_c stays a number, as BG-01M6SHQ0 kept it;
//! - a reason or a warning on a plain A/C/G/T oligo: GAATTCATGCGT has neither, and its Wallace Tm;
//! - a protein read as nucleotide statistics with no word: the protein must be flagged by the
//!   shared alphabet rule.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

fn stats(seq: &str) -> Value {
    dispatch_bio_rpc("compute_sequence_stats", json!({ "seq": seq })).expect("the op answers")
}

#[test]
fn sequence_stats_give_the_tm_reason_and_flag_protein() {
    let n_run = stats("NNNNNNNNNNNNA");
    assert_eq!(
        n_run["tm_no_answer_reason"],
        json!("Tm n/a: the span holds 12 N or other ambiguity bases; Tm is computed on A/C/G/T only, as Primer3 does"),
        "{n_run}"
    );
    assert!(n_run["basic_tm_c"].is_number(), "{n_run}");
    assert_eq!(n_run["warnings"], json!([]), "{n_run}");

    let plain = stats("GAATTCATGCGT");
    assert_eq!(plain["tm_no_answer_reason"], Value::Null, "{plain}");
    assert_eq!(plain["warnings"], json!([]), "{plain}");
    assert_eq!(plain["basic_tm_c"], json!(34.0), "{plain}");

    let protein = stats("MKWVTFISLLFLFSSAYS");
    assert!(
        protein["tm_no_answer_reason"].as_str().is_some_and(|r| r.starts_with("Tm n/a:")),
        "{protein}"
    );
    assert_eq!(
        protein["warnings"],
        json!(["The sequence reads as protein by the shared alphabet rule: these nucleotide statistics do not apply to it."]),
        "{protein}"
    );
}
