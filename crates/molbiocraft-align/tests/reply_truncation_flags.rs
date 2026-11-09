// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression (BG-01M6S17Y): the banded aligner cuts each input to `maxLen` residues (25,000 when
//! it is 0, at most 100,000) and its reply said nothing of it, so `align_pairwise_banded_sparse`
//! over two 60 kb sequences came back as an alignment of the first 25 kb. The reply the RPC op now
//! sends, [`align_pairwise_banded_sparse_with_warnings`], carries a warning (D0005) naming each cut
//! sequence with its whole length and the length aligned, and none when nothing was cut.
//!
//! Every expected length is counted here from the input, by the same rule the aligner cleans it
//! with (the letters, whatever their case; digits, spaces and line breaks dropped), never read from
//! the cap the code prints. Each input is generated from a fixed seed, so no reference data is needed.

use molbiocraft_align::align_pairwise_banded_sparse;
use molbiocraft_align::poa_and_banded::align_pairwise_banded_sparse_with_warnings;

/// Deterministic pseudo-random DNA (LCG, fixed seed), as in `variant_caller_crash.rs`.
fn dna(len: usize, seed: u64) -> String {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            b"ACGT"[((x >> 33) % 4) as usize] as char
        })
        .collect()
}

/// A copy of `s` with every 37th base changed, so a pair is related but not identical.
fn diverge(s: &str) -> String {
    s.bytes()
        .enumerate()
        .map(|(i, b)| if i % 37 == 5 { if b == b'A' { 'C' } else { 'A' } } else { b as char })
        .collect()
}

/// `s` as a GenBank ORIGIN block prints it: lower case, a right-aligned position, then 60 bases a
/// line in groups of 10. The raw text is much longer than the sequence it holds.
fn genbank_origin(s: &str) -> String {
    let lower = s.to_ascii_lowercase();
    let mut out = String::new();
    for (line, chunk) in lower.as_bytes().chunks(60).enumerate() {
        out.push_str(&format!("{:>9}", line * 60 + 1));
        for group in chunk.chunks(10) {
            out.push(' ');
            out.push_str(std::str::from_utf8(group).unwrap());
        }
        out.push('\n');
    }
    out
}

/// The residues the aligner reads, counted from the raw input: its letters.
fn residues(raw: &str) -> usize {
    raw.bytes().filter(u8::is_ascii_alphabetic).count()
}

/// `n` with its digits grouped in threes by commas, written out here rather than taken from the code.
fn grouped(n: usize) -> String {
    let d = n.to_string();
    let mut out = String::new();
    for (i, c) in d.chars().enumerate() {
        if i > 0 && (d.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// The warning for a cut at `cap` residues of the sequences in `cut` (their number and whole raw
/// input), with `asked` the maxLen asked for when it was over the aligner's 100,000-residue ceiling.
fn cut_warning(cap: usize, asked: Option<usize>, cut: &[(u8, &str)]) -> String {
    let list: Vec<String> = cut.iter().map(|(n, raw)| format!("sequence {n} ({} residues)", grouped(residues(raw)))).collect();
    let ceiling = asked.map_or(String::new(), |a| format!(" (the most it aligns; maxLen {} was asked for)", grouped(a)));
    let tail = if cut.len() == 1 { format!("Only its first {} residues were aligned.", grouped(cap)) } else { format!("Only the first {} residues of each were aligned.", grouped(cap)) };
    format!("Banded alignment input truncated to the length cap of {} residues{ceiling}: {}. {tail}", grouped(cap), list.join(", "))
}

fn run(seq1: &str, seq2: &str, mode: &str, max_len: usize) -> (molbiocraft_align::poa_and_banded::BandedPairwiseAlignment, serde_json::Value) {
    let reply = align_pairwise_banded_sparse_with_warnings(seq1, seq2, mode, 6, 24, 2, -3, -5, -2, max_len);
    let json = serde_json::to_value(&reply).unwrap();
    (reply, json)
}

#[test]
fn banded_alignment_warns_when_inputs_are_cut() {
    let a = dna(3_700, 0x17A1);
    let b = diverge(&a)[..3_250].to_string();
    let (raw_a, raw_b) = (genbank_origin(&a), genbank_origin(&b));
    assert_eq!((residues(&raw_a), residues(&raw_b)), (3_700, 3_250), "fixture");
    assert!(raw_b.len() > 3_300, "fixture: the raw text must be longer than its residues");

    // 1. Both cut at maxLen 3,000: the warning names each with its whole length and the length
    // aligned, and the global alignment's rows hold exactly the first 3,000 residues of each.
    let (reply, json) = run(&raw_a, &raw_b, "global", 3_000);
    assert_eq!(reply.warnings, vec![cut_warning(3_000, None, &[(1, &raw_a), (2, &raw_b)])]);
    let r = &reply.alignment;
    assert_eq!(r.aligned_seq1.replace('-', ""), a[..3_000], "the first 3,000 residues of sequence 1 are what was aligned");
    assert_eq!(r.aligned_seq2.replace('-', ""), b[..3_000], "the first 3,000 residues of sequence 2 are what was aligned");
    // the reply is the alignment the aligner gives, unchanged, its fields flattened beside `warnings`
    assert_eq!(
        serde_json::to_value(&reply.alignment).unwrap(),
        serde_json::to_value(align_pairwise_banded_sparse(&raw_a, &raw_b, "global", 6, 24, 2, -3, -5, -2, 3_000)).unwrap()
    );
    for key in ["alignedSeq1", "alignedSeq2", "score", "cigar", "algorithm", "warnings"] {
        assert!(json.get(key).is_some(), "the reply has no top-level {key}: {json}");
    }

    // 2. Only one cut: only it is named, whichever side it is on.
    let (one, _) = run(&raw_b, &raw_a, "local", 3_500);
    assert_eq!(one.warnings, vec![cut_warning(3_500, None, &[(2, &raw_a)])]);
    let (one, _) = run(&raw_a, &raw_b, "semiglobal", 3_500);
    assert_eq!(one.warnings, vec![cut_warning(3_500, None, &[(1, &raw_a)])]);

    // 3. The cut is of the residues, not of the raw text: 3,250 residues under a cap of 3,250 are
    // aligned whole, though the text holding them is far longer; one residue over is cut.
    let short = genbank_origin(&dna(400, 0x5EED));
    let (whole, whole_json) = run(&raw_b, &short, "global", 3_250);
    assert_eq!(whole.warnings, Vec::<String>::new(), "3,250 residues under a cap of 3,250 are not cut");
    assert_eq!(whole_json["warnings"], serde_json::json!([]), "nothing cut: the field is still there, empty");
    assert_eq!(whole.alignment.aligned_seq1.replace('-', ""), b, "aligned whole");
    let (over, _) = run(&raw_b, &short, "global", 3_249);
    assert_eq!(over.warnings, vec![cut_warning(3_249, None, &[(1, &raw_b)])]);

    // 4. maxLen 0 is the default cap of 25,000 residues, and the warning names it, not 0.
    let long = dna(25_001, 0xD0E5);
    let (default_cap, _) = run(&long, &short, "global", 0);
    assert_eq!(default_cap.warnings, vec![cut_warning(25_000, None, &[(1, &long)])]);
    let (at_default, _) = run(&long[..25_000], &short, "global", 0);
    assert_eq!(at_default.warnings, Vec::<String>::new(), "25,000 residues under the default cap are not cut");

    // 5. A maxLen over the 100,000-residue ceiling: the cut is at 100,000, and the warning says the
    // larger maxLen asked for was not used.
    let longest = dna(100_001, 0xCE11);
    let (ceiling, _) = run(&short, &longest, "local", 150_000);
    assert_eq!(ceiling.warnings, vec![cut_warning(100_000, Some(150_000), &[(2, &longest)])]);
    let (at_ceiling, _) = run(&short, &longest[..100_000], "local", 150_000);
    assert_eq!(at_ceiling.warnings, Vec::<String>::new(), "100,000 residues are under the ceiling");
}
