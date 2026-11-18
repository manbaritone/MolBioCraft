// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VF33 AC2 and AC3, through the dispatcher every transport shares.
//!
//! AC2, `translate_sequence`: a whole gap codon is '-', a codon with a gap in part or a letter the
//! genetic code does not read is X with a sentence naming it and its bases, and `.` is a gap as `-`
//! is, never dropped so that it shifts the frame. Wrong implementations, and the case that catches
//! each:
//! - `.` dropped before translation (today's clean_sequence): ATG.AAATTT would read "MKF";
//! - a gap codon read as X: ATG---AAA must read "M-K", with no warning;
//! - a partial gap codon read as a gap: ATG-AAATTTGGG must read X at codon 2, not '-';
//! - the sentence numbering bases from the frame rather than the sequence: frame 1 of AATG-AATTT
//!   puts codon 2 at bases 5-7;
//! - each letter named once per occurrence (III as "I, I, I"), or out of order (EFL);
//! - an ambiguous codon warned of: ATGRAY is "MB" with no warning;
//! - every codon named past ten, or the overflow counted wrong: twelve codons give ten sentences
//!   and "2 more", eleven give "1 more codon";
//! - the translation's warnings put before the genetic-code warning: with table 99 that one is first.
//!
//! AC3, `optimize_codons`: every residue is written, U as TGA and O as TAG with the read-through
//! caveat, B, Z, J and X as RAY, SAR, MTH and NNN, an internal stop as the host's most-used stop,
//! each with one sentence per class, and none of them weighed in the CAI. Wrong implementations:
//! - a residue with no host codon dropped (today: MKUW gives ATGAAATGGTAA);
//! - the stop always written as TAA: the human host's most-used stop is TGA;
//! - one sentence per residue rather than per class, or every position named past ten;
//! - a final stop warned of, or doubled: MKUW* writes one TAA and only the U sentence;
//! - TGA or TAG weighed in the CAI: E. coli uses neither as often as TAA, so its w is below 1.

use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

fn translate(dna: &str, frame: u64, table: u64) -> Value {
    dispatch_bio_rpc("translate_sequence", json!({ "dna": dna, "frameOffset": frame, "tableId": table })).expect("the op answers")
}

fn reply(protein: &str, warnings: &[&str]) -> Value {
    json!({ "protein": protein, "warnings": warnings })
}

const GAP_2: &str = "Codon 2 (-AA) at bases 4-6 holds a gap: translated as X.";

#[test]
fn translation_names_every_codon_it_cannot_read() {
    assert_eq!(translate("ATG---AAA", 0, 1), reply("M-K", &[]));
    assert_eq!(translate("ATG-AAATTTGGG", 0, 1), reply("MXIW", &[GAP_2]));
    assert_eq!(translate("ATG.AAATTT", 0, 1), reply("MXI", &["Codon 2 (.AA) at bases 4-6 holds a gap: translated as X."]));
    assert_eq!(
        translate("ATGIII", 0, 1),
        reply("MX", &["Codon 2 (III) at bases 4-6 holds I, which the genetic code does not read: translated as X."])
    );
    assert_eq!(
        translate("ATGEFL", 0, 1),
        reply("MX", &["Codon 2 (EFL) at bases 4-6 holds E, F, L, which the genetic code does not read: translated as X."])
    );
    assert_eq!(translate("ATGRAY", 0, 1), reply("MB", &[]));
    // a codon with a gap and a letter the code does not read is named for its gap
    assert_eq!(translate("ATG-IA", 0, 1), reply("MX", &["Codon 2 (-IA) at bases 4-6 holds a gap: translated as X."]));
    // the bases are the sequence's, the codon number the frame's
    assert_eq!(translate("AATG-AATTT", 1, 1), reply("MXF", &["Codon 2 (-AA) at bases 5-7 holds a gap: translated as X."]));
    // the unchanged case: stops and no warning
    assert_eq!(translate("ATGTGATAA", 0, 1), reply("M**", &[]));

    // past ten codons, one last sentence counts the rest
    let named = |k: usize| -> Vec<String> {
        (2..2 + k).map(|n| format!("Codon {n} (-AA) at bases {}-{} holds a gap: translated as X.", 3 * n - 2, 3 * n)).collect()
    };
    let twelve = translate(&format!("ATG{}", "-AA".repeat(12)), 0, 1);
    let mut want = named(10);
    want.push("2 more codons hold a gap or a letter the genetic code does not read; each is translated as X.".into());
    assert_eq!(twelve, json!({ "protein": format!("M{}", "X".repeat(12)), "warnings": want }));
    let eleven = translate(&format!("ATG{}", "-AA".repeat(11)), 0, 1);
    let mut want = named(10);
    want.push("1 more codon holds a gap or a letter the genetic code does not read; it is translated as X.".into());
    assert_eq!(eleven["warnings"], json!(want));
    let ten = translate(&format!("ATG{}", "-AA".repeat(10)), 0, 1);
    assert_eq!(ten["warnings"], json!(named(10)));

    // the genetic-code warning comes first
    assert_eq!(
        translate("ATG-AAATTTGGG", 0, 99),
        reply("MXIW", &["Unknown genetic code 99: translated with the Standard code (table 1).", GAP_2])
    );
}

fn optimize(protein: &str, host: &str) -> Value {
    dispatch_bio_rpc("optimize_codons", json!({ "seq": protein, "isDna": false, "host": host })).expect("the op answers")
}

const ECOLI: &str = "Escherichia coli K-12";
const U_TAIL: &str = "selenocysteine (U), written as TGA: TGA reads as Sec only with a SECIS element downstream, and as a stop without one.";
const O_TAIL: &str = "pyrrolysine (O), written as TAG: TAG reads as Pyl only in a host with the pyrrolysine machinery (pylT, pylS) and a PylIS, and as a stop elsewhere.";

#[test]
fn back_translation_writes_every_residue() {
    let base = optimize("MKW", ECOLI);
    assert_eq!(base["optimizedDna"], "ATGAAATGGTAA", "fixture");
    assert_eq!(base["warnings"], json!([]));
    let cai = base["caiScore"].as_f64().unwrap();

    for (protein, dna, warning) in [
        ("MKUW", "ATGAAATGATGGTAA", format!("Residue 3 is {U_TAIL}")),
        ("MKOW", "ATGAAATAGTGGTAA", format!("Residue 3 is {O_TAIL}")),
        ("MKBW", "ATGAAARAYTGGTAA", "Residue 3 (B: D or N) has no single codon: written as the degenerate codon RAY.".into()),
        ("MKZW", "ATGAAASARTGGTAA", "Residue 3 (Z: E or Q) has no single codon: written as the degenerate codon SAR.".into()),
        ("MKJW", "ATGAAAMTHTGGTAA", "Residue 3 (J: I or L) has no single codon: written as the degenerate codon MTH.".into()),
        ("MKXW", "ATGAAANNNTGGTAA", "Residue 3 (X) has no codon: written as NNN.".into()),
        ("MK*W", "ATGAAATAATGGTAA", "Residue 3 is a stop (*): written as TAA, so the CDS ends there.".into()),
    ] {
        let r = optimize(protein, ECOLI);
        assert_eq!(r["optimizedDna"], dna, "{protein}");
        assert_eq!(r["proteinSequence"], protein, "{protein}");
        assert_eq!(r["warnings"], json!([warning]), "{protein}");
        assert_eq!(r["caiScore"].as_f64().unwrap(), cai, "{protein}: the written codon is not weighed");
        assert_eq!(r["lengthBp"], dna.len(), "{protein}");
    }

    // a final stop ends the CDS: it is written once, and not warned of
    let ended = optimize("MKUW*", ECOLI);
    assert_eq!(ended["optimizedDna"], "ATGAAATGATGGTAA");
    assert_eq!(ended["warnings"], json!([format!("Residue 3 is {U_TAIL}")]));

    // the stop is the host's most used: TGA in Homo sapiens (AAG is its most-used Lys codon)
    let human = optimize("MK*W", "Homo sapiens");
    assert_eq!(human["optimizedDna"], "ATGAAGTGATGGTGA");
    assert_eq!(human["warnings"], json!(["Residue 3 is a stop (*): written as TGA, so the CDS ends there."]));

    // residues of one class share a sentence; the classes in the order U, O, B, Z, J, X, *
    let r = optimize("MKUAAAUW", ECOLI);
    assert_eq!(r["warnings"], json!([format!("Residues 3 and 7 are {U_TAIL}")]));
    let dna = r["optimizedDna"].as_str().unwrap();
    assert_eq!((&dna[6..9], &dna[18..21]), ("TGA", "TGA"));
    let r = optimize("MXBUBXOJ*ZOW", ECOLI);
    assert_eq!(
        r["warnings"],
        json!([
            format!("Residue 4 is {U_TAIL}"),
            format!("Residues 7 and 11 are {O_TAIL}"),
            "Residues 3 and 5 (B: D or N) have no single codon: written as the degenerate codon RAY.",
            "Residue 10 (Z: E or Q) has no single codon: written as the degenerate codon SAR.",
            "Residue 8 (J: I or L) has no single codon: written as the degenerate codon MTH.",
            "Residues 2 and 6 (X) have no codon: written as NNN.",
            "Residue 9 is a stop (*): written as TAA, so the CDS ends there.",
        ])
    );
    assert_eq!(r["optimizedDna"], "ATGNNNRAYTGARAYNNNTAGMTHTAASARTAGTGGTAA");
    assert_eq!(r["proteinSequence"], "MXBUBXOJ*ZOW");
    let r = optimize("MUUU", ECOLI);
    assert_eq!(r["warnings"], json!([format!("Residues 2, 3 and 4 are {U_TAIL}")]));

    // at most the first ten positions are named
    let r = optimize(&format!("M{}", "U".repeat(12)), ECOLI);
    assert_eq!(r["warnings"], json!([format!("Residues 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 and 2 more are {U_TAIL}")]));
    assert_eq!(r["optimizedDna"], format!("ATG{}TAA", "TGA".repeat(12)));
}
