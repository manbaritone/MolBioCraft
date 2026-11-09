// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use molbiocraft_align::{
    align_pairwise_banded_sparse, align_pairwise_standard, compute_dotplot_hits,
    run_multiple_sequence_alignment_with_algorithm, MsaInputDoc,
};
use molbiocraft_core::reverse_complement_iupac;

#[test]
fn reverse_dotplot_compares_reverse_order_not_just_complement() {
    let query = "ACGTTGCAAGT";
    let target = reverse_complement_iupac(query, false);
    for padding in [0, 4001] {
        let subject = format!("{target}{}", "N".repeat(padding));
        let hits = compute_dotplot_hits(query, &subject, 11, 11);
        assert!(hits.iter().any(|h| h.x == 1 && h.y == 1 && h.strand == -1 && h.score == 11));
    }
}

/// Every dotplot hit by brute force, as (x, y, strand, score) with 1-based window starts: a forward
/// hit where `w`-letter windows of `a` and `b` agree at `min` or more positions, a reverse hit where
/// the window of `a` agrees with the reverse complement of the window of `b` at `min` or more.
fn brute_force_dotplot(a: &[u8], b: &[u8], w: usize, min: usize) -> Vec<(usize, usize, i8, usize)> {
    let comp = |c: u8| match c { b'A' => b'T', b'C' => b'G', b'G' => b'C', b'T' => b'A', other => other };
    let mut hits = Vec::new();
    for i in 0..=a.len().saturating_sub(w) {
        for j in 0..=b.len().saturating_sub(w) {
            let fwd = (0..w).filter(|&k| a[i + k] == b[j + k]).count();
            let rev = (0..w).filter(|&k| a[i + k] == comp(b[j + w - 1 - k])).count();
            if fwd >= min { hits.push((i + 1, j + 1, 1, fwd)); }
            if rev >= min { hits.push((i + 1, j + 1, -1, rev)); }
        }
    }
    hits.sort();
    hits
}

#[test]
fn palindromic_dotplot_reports_both_strands() {
    // PRD F11: the dotplot uses window 11 and a minimum of 9 matching positions.
    let (w, min) = (11, 9);
    let dotplot = |a: &str, b: &str| {
        let mut hits: Vec<_> = compute_dotplot_hits(a, b, w, min).iter().map(|h| (h.x, h.y, h.strand, h.score)).collect();
        hits.sort();
        hits
    };
    // EcoRI, BamHI, EcoRI: an 18-nt sequence that is its own reverse complement, so its self-dotplot
    // carries a full-score line on both strands: the forward diagonal x = y, and on the reverse
    // strand the anti-diagonal x + y = 9 (window x of the sequence is the reverse complement of
    // window 18 - 11 + 2 - x).
    let pal = "GAATTCGGATCCGAATTC";
    let hits = dotplot(pal, pal);
    for x in 1..=8 {
        assert!(hits.contains(&(x, x, 1, 11)), "forward diagonal lacks window {x}: {hits:?}");
        assert!(hits.contains(&(x, 9 - x, -1, 11)), "reverse anti-diagonal lacks window {x}: {hits:?}");
    }
    assert_eq!(hits, brute_force_dotplot(pal.as_bytes(), pal.as_bytes(), w, min));
    // the EcoRI site alone, as one window of 6 that must match in full
    let ecori = compute_dotplot_hits("GAATTC", "GAATTC", 6, 6);
    assert!(ecori.iter().any(|h| h.strand == 1));
    assert!(ecori.iter().any(|h| h.strand == -1));
    // A non-palindromic control: random DNA against a copy carrying a substitution every 7th base and
    // a reverse-complemented block, so windows with 9 and 10 matches occur on both strands.
    let a = lcg_seq(120, b"ACGT", 11);
    let mut b: Vec<u8> = a.bytes().enumerate().map(|(i, c)| if i % 7 == 3 { if c == b'A' { b'C' } else { b'A' } } else { c }).collect();
    let block: Vec<u8> = b[40..80].iter().rev().map(|&c| match c { b'A' => b'T', b'C' => b'G', b'G' => b'C', _ => b'A' }).collect();
    b.splice(40..80, block);
    let b = String::from_utf8(b).unwrap();
    let hits = dotplot(&a, &b);
    let expected = brute_force_dotplot(a.as_bytes(), b.as_bytes(), w, min);
    for strand in [1, -1] {
        for score in [9, 10] {
            assert!(expected.iter().any(|h| h.2 == strand && h.3 == score), "fixture lacks a strand {strand} hit of {score}");
        }
    }
    assert_eq!(hits, expected);
}

#[test]
fn banded_identity_is_exact_not_iupac_compatibility() {
    let result = align_pairwise_banded_sparse(
        "ACGTNACGTACGT", "ACGTAACGTACGT", "global", 3, 24, 2, -1, -5, -1, 100,
    );
    assert_eq!(result.matches, 12);
    assert_eq!(result.mismatches, 1);
    assert_eq!(result.identity_pct, 92.3);
    assert_eq!(result.similarity_pct, 100.0);
}

#[test]
fn global_alignments_preserve_empty_and_nonempty_rows() {
    for (a, b) in [("", ""), ("", "ACGT"), ("ACGT", "")] {
        let full = align_pairwise_standard(a, b, false, 2, -1, -5, -1);
        let banded = align_pairwise_banded_sparse(a, b, "global", 3, 24, 2, -1, -5, -1, 100);
        for result in [full, banded] {
            assert_eq!(result.aligned_seq1.len(), result.aligned_seq2.len());
            assert_eq!(result.aligned_seq1.replace('-', ""), a);
            assert_eq!(result.aligned_seq2.replace('-', ""), b);
            assert_eq!(result.gaps, a.len() + b.len());
        }
    }
}

#[test]
fn global_and_local_banded_coordinates_agree_with_source() {
    for mode in ["global", "local"] {
        for (a, b) in [
            ("TTTTACGTCAGTAAAA", "GGGGACGTCAGTCCCC"),
            ("ACGT", "TTACGTAA"), ("ACGTACGT", "ACGACGT"),
        ] {
            let r = align_pairwise_banded_sparse(a, b, mode, 3, 24, 2, -2, -5, -1, 100);
            assert_eq!(r.aligned_seq1.len(), r.aligned_seq2.len());
            assert_eq!(r.aligned_seq1.replace('-', ""), a[r.xstart..r.xend]);
            assert_eq!(r.aligned_seq2.replace('-', ""), b[r.ystart..r.yend]);
            assert_eq!(r.matches + r.mismatches + r.gaps, r.aligned_seq1.len());
        }
    }
}

#[test]
fn supported_center_star_presets_preserve_taxa_and_residues() {
    let docs: Vec<_> = ["ACGTACGT", "ACGTTTACGT", "ACGACGT", "ACGT"]
        .iter().enumerate().map(|(i, seq)| MsaInputDoc {
            id: i.to_string(), name: format!("Taxon {i}"), sequence: seq.to_string(),
        }).collect();
    for preset in ["", "MAFFT", "MUSCLE", "Clustal Omega"] {
        let result = run_multiple_sequence_alignment_with_algorithm(&docs, 2400, preset);
        assert_eq!(result.rows.len(), docs.len());
        for doc in &docs {
            let row = result.rows.iter().find(|r| r.id == doc.id).unwrap();
            assert_eq!(row.aligned_seq.replace('-', ""), doc.sequence);
            assert_eq!(row.aligned_seq.len(), result.consensus.len());
        }
    }
}

// Independent affine-gap score oracle; deliberately simple cubic gap scans for tiny fixtures.
fn reference_score(a: &[u8], b: &[u8], local: bool) -> i32 {
    let mut scores = vec![vec![0; b.len() + 1]; a.len() + 1];
    if !local {
        for i in 1..=a.len() { scores[i][0] = -3 - i as i32; }
        for j in 1..=b.len() { scores[0][j] = -3 - j as i32; }
    }
    let mut best = 0;
    for i in 1..=a.len() {
        for j in 1..=b.len() {
            let mut score = scores[i - 1][j - 1] + if a[i - 1] == b[j - 1] { 2 } else { -1 };
            for k in 1..=i { score = score.max(scores[i - k][j] - 3 - k as i32); }
            for k in 1..=j { score = score.max(scores[i][j - k] - 3 - k as i32); }
            if local { score = score.max(0); }
            scores[i][j] = score;
            best = best.max(score);
        }
    }
    if local { best } else { scores[a.len()][b.len()] }
}

/// Textbook Gotoh (1982) affine-gap Needleman-Wunsch score in linear memory: the linear-time twin
/// of `reference_score(.., false)` for pairs too long for its cubic gap scans.
fn gotoh_global_score(a: &[u8], b: &[u8], (m, mm, open, extend): LocalScoring) -> i32 {
    const NEG: i32 = i32::MIN / 4;
    let mut h_prev: Vec<i32> = (0..=b.len()).map(|j| if j == 0 { 0 } else { open + j as i32 * extend }).collect();
    let mut h_row = vec![0; b.len() + 1];
    let mut f = vec![NEG; b.len() + 1]; // best score ending in a gap that consumes a[i - 1]
    for i in 1..=a.len() {
        h_row[0] = open + i as i32 * extend;
        let mut e = NEG; // best score ending in a gap that consumes b[j - 1]
        for j in 1..=b.len() {
            e = (e + extend).max(h_row[j - 1] + open + extend);
            f[j] = (f[j] + extend).max(h_prev[j] + open + extend);
            let s = if a[i - 1] == b[j - 1] { m } else { mm };
            h_row[j] = (h_prev[j - 1] + s).max(e).max(f[j]);
        }
        std::mem::swap(&mut h_prev, &mut h_row);
    }
    h_prev[b.len()]
}

/// AC1's scoring: match 2, mismatch -1, a gap of length L scoring -3 - L (rust-bio open -3, extend
/// -1; Biopython 1.88 `PairwiseAligner` match 2, mismatch -1, open_gap_score -4, extend_gap_score -1).
const AC1_SCORING: LocalScoring = (2, -1, -3, -1);

/// One pair through all four pairwise modes, in this order: full-matrix global and local
/// (`align_pairwise_standard`), banded global and banded local (`align_pairwise_banded_sparse` at
/// k-mer `k`, band `w`). Every result's columns must re-score to its reported score.
fn four_modes(a: &[u8], b: &[u8], sc: LocalScoring, k: usize, w: usize, what: &str) -> [molbiocraft_align::PairwiseAlignmentResult; 4] {
    let (sa, sb) = (std::str::from_utf8(a).unwrap(), std::str::from_utf8(b).unwrap());
    let max_len = a.len().max(b.len()).max(100);
    let results = [
        align_pairwise_standard(sa, sb, false, sc.0, sc.1, sc.2, sc.3),
        align_pairwise_standard(sa, sb, true, sc.0, sc.1, sc.2, sc.3),
        align_pairwise_banded_sparse(sa, sb, "global", k, w, sc.0, sc.1, sc.2, sc.3, max_len),
        align_pairwise_banded_sparse(sa, sb, "local", k, w, sc.0, sc.1, sc.2, sc.3, max_len),
    ];
    for (name, r) in ["full global", "full local", "banded global", "banded local"].iter().zip(&results) {
        assert_eq!(r.aligned_seq1.len(), r.aligned_seq2.len(), "{what}: {name} rows differ in length");
        assert_eq!(local_column_score(&r.aligned_seq1, &r.aligned_seq2, sc), r.score, "{what}: {name} columns disagree with its score");
    }
    for r in [&results[0], &results[2]] {
        assert_eq!((r.aligned_seq1.replace('-', ""), r.aligned_seq2.replace('-', "")), (sa.to_string(), sb.to_string()), "{what}: a global row lost residues");
    }
    results
}

/// Asserts that all four modes reach the oracle's (global, local) optimum.
fn assert_four_modes_exact(a: &[u8], b: &[u8], (global, local): (i32, i32), what: &str) {
    let [fg, fl, bg, bl] = four_modes(a, b, AC1_SCORING, 3, 24, what);
    let (sa, sb) = (std::str::from_utf8(a).unwrap(), std::str::from_utf8(b).unwrap());
    let got = (fg.score, fl.score, bg.score, bl.score);
    assert_eq!(got, (global, local, global, local), "{what}: (full global, full local, banded global, banded local)\n  {sa}\n  {sb}");
    // within the 5 M-cell budget banded local (BG-01M6PX3B) and banded global (BG-01M6Q2R6) are the
    // full matrix, so no k-mer band can miss the optimum
    assert!(bl.algorithm.contains("full matrix"), "{what}: banded local took {}", bl.algorithm);
}

#[test]
fn four_pairwise_modes_match_independent_affine_score_oracle() {
    // 1. Every A/C string of up to 4 nt against every other.
    let mut seqs = vec![String::new()];
    for len in 1..=4 {
        for bits in 0..(1 << len) {
            seqs.push((0..len).map(|i| if bits & (1 << i) == 0 { 'A' } else { 'C' }).collect());
        }
    }
    for a in &seqs {
        for b in &seqs {
            let (ab, bb) = (a.as_bytes(), b.as_bytes());
            let expected = (reference_score(ab, bb, false), reference_score(ab, bb, true));
            if a.is_empty() || b.is_empty() {
                // an empty side has no band; the banded entry point hands it to the full aligner
                let [fg, fl, bg, bl] = four_modes(ab, bb, AC1_SCORING, 3, 24, "A/C empty");
                assert_eq!((fg.score, fl.score, bg.score, bl.score), (expected.0, expected.1, expected.0, expected.1), "{a}/{b}");
            } else {
                assert_four_modes_exact(ab, bb, expected, &format!("A/C {a}/{b}"));
            }
        }
    }

    // 2. Pairs on which a band built from the k-mer chain alone (rust-bio `banded::Aligner::local`,
    // the local code before BG-01M6PX3B) scores 10, 13, 11, 18, 19 and 17 at k = 3, w = 24, below
    // the local optimum on all but the fifth, with Biopython 1.88 PairwiseAligner scores under
    // AC1_SCORING in mode="global" then mode="local". Both oracles must agree with Biopython before
    // they are trusted on the random pairs below.
    let recorded: [(&str, &str, i32, i32); 6] = [
        ("GAACGGTTACGCTACCAACTTGCCTAT", "CTCTCTAGAATTCGTTATGTGCAAGGACTCGAGTAGGGCCGCACTCGGCAAC", -13, 13),
        ("GACAGAGCTAAGTCAGAAAGGATACGCCAGCCGGATGGAGAGTCCCACTTAGGACTG", "GATAATACATCACTATGTCCTTTTT", -18, 14),
        ("TATAAATATTGCGAACTG", "AGCATAATTAAGCGCAGCCAGAAGGCAATGGTAATGCGGTTTACTTTACACCCG", -24, 13),
        ("TCTATTTAGCGTATTTGATATCATGGCGTTCCGGATATAA", "CCTATAAGAGTGTGTGTGACGACACACCCTAACGG", 10, 20),
        ("CAATAACGACAGGGTCCGCCTCAGCCTGGATTTTCTTCCACGCAGGTTAACTA", "GGGTCCTACTTTACACACTAACTCCGCCGCTATATGCTGTGACGA", -1, 19),
        ("CCACGACTCCAGTTTCAGTTAGGCTATAGTTGGTACTAAATTGCCCCTCGGTACAAGCA", "CTCTCGCCCATACTATCAATCACCTCTAGGAGGGAATTTGCATCTCCAGTCGGAGCCG", 22, 29),
    ];
    for (a, b, global, local) in recorded {
        let (ab, bb) = (a.as_bytes(), b.as_bytes());
        assert_eq!((reference_score(ab, bb, false), reference_score(ab, bb, true)), (global, local), "cubic oracle vs Biopython: {a}/{b}");
        assert_eq!((gotoh_global_score(ab, bb, AC1_SCORING), gotoh_local_score(ab, bb, AC1_SCORING)), (global, local), "Gotoh oracle vs Biopython: {a}/{b}");
        assert_four_modes_exact(ab, bb, (global, local), "recorded pair");
    }

    // 3. 400 seeded random DNA pairs long enough for a k = 3, w = 24 k-mer band to bind (5-85 nt):
    // unrelated 5-60 nt pairs, and a diverged 8-30 nt segment planted between 0-30 nt flanks at
    // independent offsets so the optimum is usually off the main diagonal; 82 of these pairs have a
    // sequence of 61-85 nt.
    let mut rng = PairRng(0x0AC1_5EED);
    for p in 0..400 {
        let (a, b) = if p % 2 == 0 {
            let n = rng.between(5, 60);
            let a = rng.dna(n);
            let n = rng.between(5, 60);
            (a, rng.dna(n))
        } else {
            let n = rng.between(8, 30);
            let seg = rng.dna(n);
            (rng.embed(&seg, 0, 30, 60, 20), rng.embed(&seg, 0, 30, 60, 20))
        };
        assert_four_modes_exact(&a, &b, (reference_score(&a, &b, false), reference_score(&a, &b, true)), &format!("random pair {p}"));
    }

    // 4. Long homologous pairs past the 5 M-cell exact budget, aligned the way the studio calls the
    // banded aligner (STUDIO_DNA, k = 6, w = 24): a 2.0-2.6 kb core re-drawn at 2, 6 or 12 % of
    // positions (plus 1 % insertions and 1 % deletions) between independent random flanks. The full
    // matrix stays exact here (well under its 50 M-cell switch). Above 5 M cells both banded modes
    // follow a k-mer band, a heuristic: they may never score above the optimum, and on pairs 0-4 they
    // reach it, but on pair 5 (12 % divergence) banded global and banded local fall short, as banded
    // local does on every one of these pairs under the more lenient AC1_SCORING.
    // Biopython 1.88 (global, local) scores, open_gap_score -7, extend_gap_score -2:
    let biopython_long = [(2361, 3366), (1649, 2565), (1106, 2044), (2587, 3599), (2334, 2855), (588, 1932)];
    let mut rng = PairRng(0x0AC1_10B6);
    for (p, &(global, local)) in biopython_long.iter().enumerate() {
        let n = rng.between(2000, 2600);
        let core = rng.dna(n);
        let sub = [20, 60, 120][p % 3];
        let (a, b) = (rng.embed(&core, 150, 600, sub, 10), rng.embed(&core, 150, 600, sub, 10));
        assert!((a.len() + 1) * (b.len() + 1) > 5_000_000, "long pair {p} must exceed the exact budget");
        assert_eq!((gotoh_global_score(&a, &b, STUDIO_DNA), gotoh_local_score(&a, &b, STUDIO_DNA)), (global, local), "long pair {p}: Gotoh oracle vs Biopython");
        let [fg, fl, bg, bl] = four_modes(&a, &b, STUDIO_DNA, 6, 24, &format!("long pair {p}"));
        assert_eq!((fg.score, fl.score), (global, local), "long pair {p}: full matrix");
        assert!(bl.algorithm.contains("Banded"), "long pair {p}: expected the k-mer band, got {}", bl.algorithm);
        assert!(bg.score <= global && bl.score <= local, "long pair {p}: a band scored above the optimum: {} / {}", bg.score, bl.score);
        if p < 5 {
            assert_eq!((bg.score, bl.score), (global, local), "long pair {p}: banded global / banded local");
        }
    }
}

#[test]
fn ambiguous_nucleotide_scoring_is_symmetric_and_not_protein_scoring() {
    // Biopython 1.88 PairwiseAligner scores (mode="global", then mode="local") with a substitution
    // matrix over ACGTRYSWKMBDHVN built from Bio.Data.IUPACData.ambiguous_dna_values: 2 for the same
    // letter, 1 (half the match score) for two letters whose base sets overlap, -1 otherwise;
    // open_gap_score -6, extend_gap_score -1 (rust-bio open -5, extend -1). The last three pairs are
    // seeded random IUPAC strings against seeded random ACGT strings. Scoring this IUPAC input with
    // BLOSUM62, or dropping the half-match credit to a mismatch, fails these pins.
    let pinned: [(&str, &str, i32, i32); 9] = [
        ("RYSWKMBDHVN", "ACGTACGTACG", 9, 9),
        ("R", "M", 1, 1),
        ("N", "A", 1, 1),
        ("GATTACAN", "GATYACAG", 14, 14),
        ("NNNNACGT", "ACGT", -1, 8),
        ("ACGTRYACGTKM", "ACGTAGACGTTC", 18, 18),
        ("ACGTAMVYSRNBABANCTRGGRMGYNBATD", "AATCCAGTTACTAGCTTCTCGACATACCGTAT", 0, 14),
        ("TKASACYWMATCMWTRAWKVRDYN", "GGGATTCAGGTGTGATTGAGCGAAGGTTT", -4, 13),
        ("KWDWBSSDGTMTMMSDNKYSHGYKBDHGHYC", "GCCAGCAAAAGGTGGCGTTTGATTCTGTG", -2, 15),
    ];
    for (a, b, global, local) in pinned {
        let forward = align_pairwise_standard(a, b, false, 2, -1, -5, -1);
        let backward = align_pairwise_standard(b, a, false, 2, -1, -5, -1);
        assert_eq!((forward.score, backward.score), (global, global), "global {a}/{b}");
        assert_eq!(forward.similarity_pct, backward.similarity_pct, "{a}/{b}");
        let (lf, lb) = (align_pairwise_standard(a, b, true, 2, -1, -5, -1), align_pairwise_standard(b, a, true, 2, -1, -5, -1));
        assert_eq!((lf.score, lb.score), (local, local), "local {a}/{b}");
    }
    // The overlap credit is the match score halved and rounded down, but never below 1, so at match
    // score 1 an overlap such as R/A scores 1, as much as an identity, and at match score 3 it scores
    // 1, not 1.5. Biopython 1.88 scores under that matrix rule (the same letter scores the match
    // score, an overlap max(match / 2 rounded down, 1), anything else -1; open -6, extend -1). On the
    // first pair an exact-half matrix (0.5, 1.5) scores 4 at match score 1 and 14 at match score 3
    // instead of 9, and halving without the floor (0 at match score 1) scores global -1, local 0.
    let floored: [(i32, &str, &str, i32, i32); 4] = [
        (1, "RYSWKMBDHVN", "ACGTACGTACG", 9, 9),
        (1, "R", "A", 1, 1),
        (3, "RYSWKMBDHVN", "ACGTACGTACG", 9, 9),
        (3, "GATTACAN", "GATYACAG", 20, 20),
    ];
    for (ms, a, b, global, local) in floored {
        let (g, l) = (align_pairwise_standard(a, b, false, ms, -1, -5, -1), align_pairwise_standard(a, b, true, ms, -1, -5, -1));
        assert_eq!((g.score, l.score), (global, local), "match score {ms}: {a}/{b}");
    }
    // Hand derivation of the first pair's only optimum (any gap costs at least -6, twice over in a
    // global alignment of equal lengths, so it is ungapped): R/A Y/C S/G W/T M/C B/G D/T H/A V/C N/G
    // share a base (+1 each, ':' in the midline) and K/A does not (-1, '.'): 10 - 1 = 9, no identical
    // column, 10 of 11 similar.
    let r = align_pairwise_standard("RYSWKMBDHVN", "ACGTACGTACG", false, 2, -1, -5, -1);
    assert_eq!((r.aligned_seq1.as_str(), r.aligned_seq2.as_str()), ("RYSWKMBDHVN", "ACGTACGTACG"));
    assert_eq!(r.midline, "::::.::::::");
    assert_eq!((r.matches, r.mismatches, r.gaps, r.identity_pct, r.similarity_pct), (0, 11, 0, 0.0, 90.91));
}

fn lcg_seq(len: usize, alphabet: &[u8], seed: u64) -> String {
    let mut s = seed;
    (0..len)
        .map(|_| {
            s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            alphabet[((s >> 33) % alphabet.len() as u64) as usize] as char
        })
        .collect()
}

fn mutate(base: &str, alphabet: &[u8], seed: u64) -> String {
    let mut s = seed;
    let mut out = String::new();
    for ch in base.chars() {
        s = s.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let r = (s >> 33) % 100;
        let pick = alphabet[((s >> 40) % alphabet.len() as u64) as usize] as char;
        match r {
            0..=3 => {}
            4..=7 => {
                out.push(ch);
                out.push(pick);
            }
            8..=13 => out.push(pick),
            _ => out.push(ch),
        }
    }
    out
}

fn fixture_sets() -> Vec<Vec<MsaInputDoc>> {
    let mut sets = Vec::new();
    for (alphabet, len) in [(&b"ACGT"[..], 300usize), (&b"ACDEFGHIKLMNPQRSTVWY"[..], 120)] {
        let base = lcg_seq(len, alphabet, 7);
        sets.push(
            (0..6)
                .map(|i| MsaInputDoc {
                    id: format!("m{i}"),
                    name: format!("Member {i}"),
                    sequence: if i == 0 { base.clone() } else { mutate(&base, alphabet, 31 * i as u64 + 5) },
                })
                .collect(),
        );
    }
    sets.push(
        ["ACGTACGTAC", "TTTTGGGGCCCCAAAA", "GA"]
            .iter()
            .enumerate()
            .map(|(i, s)| MsaInputDoc { id: i.to_string(), name: format!("d{i}"), sequence: s.to_string() })
            .collect(),
    );
    sets
}

#[test]
fn every_msa_preset_preserves_residues_and_reports_self_consistent_statistics() {
    use molbiocraft_align::run_multiple_sequence_alignment;
    // The shipped `run_msa` op sends an empty algorithm to plain centre-star
    // (`run_multiple_sequence_alignment`, molbiocraft-wasm/src/lib.rs `"run_msa"` arm) and every other
    // algorithm to the preset dispatcher, where "" (no preset named) is progressive alignment.
    const SHIPPED_DEFAULT: &str = "run_msa default (centre-star)";
    for docs in fixture_sets() {
        for preset in [SHIPPED_DEFAULT, "", "MAFFT (FFT-NS-i / L-INS-i)", "Clustal Omega (HMM)", "MUSCLE (Iterative)", "POA (rust-bio Partial-Order Graph)"] {
            let r = if preset == SHIPPED_DEFAULT {
                run_multiple_sequence_alignment(&docs, 2400)
            } else {
                run_multiple_sequence_alignment_with_algorithm(&docs, 2400, preset)
            };
            let cols = r.consensus.len();
            assert_eq!(r.rows.len(), docs.len(), "{preset}");
            assert_eq!(r.conservation.len(), cols, "{preset}");
            assert_eq!(r.shannon_entropy_bits.len(), cols, "{preset}");
            for (doc, row) in docs.iter().zip(&r.rows) {
                assert_eq!(row.id, doc.id, "{preset}: input order must be kept");
                assert_eq!(row.aligned_seq.len(), cols, "{preset}");
                assert_eq!(row.aligned_seq.replace('-', ""), doc.sequence.to_uppercase(), "{preset}: residues changed");
            }
            for c in 0..cols {
                assert!(r.rows.iter().any(|row| row.aligned_seq.as_bytes()[c] != b'-'), "{preset}: gap-only column {c}");
            }
            // Identical site = all rows spanning the column (end gaps ignored) share one residue.
            let spans: Vec<(usize, usize)> = r.rows.iter().map(|row| {
                let b = row.aligned_seq.as_bytes();
                (b.iter().position(|&x| x != b'-').unwrap(), b.iter().rposition(|&x| x != b'-').unwrap())
            }).collect();
            let identical = (0..cols)
                .filter(|&c| {
                    let inside: Vec<u8> = r.rows.iter().zip(&spans)
                        .filter(|(_, s)| c >= s.0 && c <= s.1)
                        .map(|(row, _)| row.aligned_seq.as_bytes()[c])
                        .collect();
                    !inside.is_empty() && inside[0] != b'-' && inside.iter().all(|&b| b == inside[0])
                })
                .count();
            let expected = ((identical as f64 / cols.max(1) as f64) * 1000.0).round() / 10.0;
            assert_eq!(r.identical_sites_pct, expected, "{preset}: stale identical-sites statistic");
            assert!(r.newick_tree.ends_with(';'));
        }
    }
}

/// POA falls back to center-star when its backbone scores worse. (The MAFFT / MUSCLE / Clustal
/// presets are progressive / consistency aligners now; their accuracy is measured against Pfam
/// reference alignments in `outside_data_reference.rs`, not against center-star's SP score.)
#[test]
fn poa_preset_never_scores_worse_than_plain_center_star() {
    use molbiocraft_align::msa::sum_of_pairs_score_public as sp;
    use molbiocraft_align::run_multiple_sequence_alignment;
    for docs in fixture_sets() {
        let base = run_multiple_sequence_alignment(&docs, 2400);
        let base_rows: Vec<Vec<u8>> = base.rows.iter().map(|r| r.aligned_seq.as_bytes().to_vec()).collect();
        let r = run_multiple_sequence_alignment_with_algorithm(&docs, 2400, "POA");
        let rows: Vec<Vec<u8>> = r.rows.iter().map(|r| r.aligned_seq.as_bytes().to_vec()).collect();
        assert!(sp(&rows) >= sp(&base_rows), "POA degraded the alignment");
    }
}

#[test]
fn semiglobal_pairwise_keeps_unaligned_flanks_of_both_sequences() {
    use molbiocraft_align::pairwise::{align_pairwise_gotoh, PairwiseMode};
    // Biopython 1.88 PairwiseAligner(mode="global") with free end gaps (open_end_gap_score 0,
    // extend_end_gap_score 0), match 2, mismatch -1, open_gap_score -6, extend_gap_score -1 (rust-bio
    // open -5, extend -1): the score and the rows of its only optimal alignment. The comments give
    // Biopython's plain global and local scores, which semi-global scoring must not take.
    let pinned: [(&str, &str, i32, &str, &str); 6] = [
        // the second sequence overhangs both ends (global 2, local 20)
        ("ACGTACGTAC", "TTTTACGTACGTACGGGG", 20, "----ACGTACGTAC----", "TTTTACGTACGTACGGGG"),
        // the first sequence overhangs both ends (global 2, local 20)
        ("GGGGACGTACGTACCCCC", "ACGTACGTAC", 20, "GGGGACGTACGTACCCCC", "----ACGTACGTAC----"),
        // overlap: the first sequence's left flank and the second's right flank are free (global -2)
        ("GGGGGGACGTACGTAC", "ACGTACGTACTTTTTT", 20, "GGGGGGACGTACGTAC------", "------ACGTACGTACTTTTTT"),
        // overlap the other way round (global 10)
        ("ACGTACGTACTTTT", "CCCCACGTACGTAC", 20, "----ACGTACGTACTTTT", "CCCCACGTACGTAC----"),
        // both left flanks differ: only one may be left unaligned, so they are aligned (local 20)
        ("TTTTACGTACGTAC", "GGGGACGTACGTAC", 16, "TTTTACGTACGTAC", "GGGGACGTACGTAC"),
        // a mismatch inside the aligned core, flanks free (global 7)
        ("ACGTAGGTACGT", "TTACGTACGTACGTCC", 21, "--ACGTAGGTACGT--", "TTACGTACGTACGTCC"),
    ];
    for (a, b, score, row1, row2) in pinned {
        for (x, y, r1, r2) in [(a, b, row1, row2), (b, a, row2, row1)] {
            let r = align_pairwise_gotoh(x, y, PairwiseMode::Semiglobal, None, 2, -1, -5, -1, 100);
            assert_eq!(r.score, score, "{x}/{y}");
            assert_eq!((r.aligned_seq1.as_str(), r.aligned_seq2.as_str()), (r1, r2), "{x}/{y}: end gaps misplaced");
            // the midline marks identity only where both rows carry the same base
            let mid: String = r1.bytes().zip(r2.bytes())
                .map(|(p, q)| if p == b'-' || q == b'-' { ' ' } else if p == q { '|' } else { '.' })
                .collect();
            assert_eq!(r.midline, mid, "{x}/{y}");
            assert!(r.algorithm.contains("Semi-global"));
        }
    }
    // an empty side: the whole of the other sequence is one free end gap
    let r = align_pairwise_gotoh("ACGT", "", PairwiseMode::Semiglobal, None, 2, -1, -5, -1, 100);
    assert_eq!(r.aligned_seq1.len(), r.aligned_seq2.len());
    assert_eq!((r.score, r.aligned_seq1.replace('-', ""), r.aligned_seq2.replace('-', "")), (0, "ACGT".to_string(), String::new()));
    assert!(r.algorithm.contains("Semi-global"));
}

#[test]
fn difference_caller_reports_every_variant_with_vcf_anchoring_and_no_invented_quality() {
    use molbiocraft_align::call_freebayes_variants;
    let reference = lcg_seq(1200, b"ACGT", 99);
    let r = reference.as_bytes();
    // Edits (1-based reference coordinates): SNP at 100, 3-bp deletion of 301..303,
    // 2-bp insertion after 500, SNP at 800.
    let mut sample = String::new();
    sample.push_str(&reference[..99]);
    let snp1 = if r[99] == b'A' { 'G' } else { 'A' };
    sample.push(snp1);
    sample.push_str(&reference[100..300]);
    sample.push_str(&reference[303..500]);
    sample.push_str("TT");
    sample.push_str(&reference[500..799]);
    let snp2 = if r[799] == b'C' { 'T' } else { 'C' };
    sample.push(snp2);
    sample.push_str(&reference[800..1150]);

    let rep = call_freebayes_variants("ref", &reference, &sample);
    let calls: Vec<(usize, String, String, String)> = rep
        .variants
        .iter()
        .map(|v| (v.position_bp, v.ref_allele.clone(), v.alt_allele.clone(), v.variant_type.clone()))
        .collect();
    assert!(calls.contains(&(100, (r[99] as char).to_string(), snp1.to_string(), "SNP".into())), "{calls:?}");
    assert!(calls.contains(&(300, reference[299..303].to_string(), (r[299] as char).to_string(), "DEL".into())), "{calls:?}");
    assert!(calls.contains(&(500, (r[499] as char).to_string(), format!("{}TT", r[499] as char), "INS".into())), "{calls:?}");
    assert!(calls.contains(&(800, (r[799] as char).to_string(), snp2.to_string(), "SNP".into())), "{calls:?}");
    assert_eq!(calls.len(), 4, "{calls:?}");
    assert!(rep.vcf_text.lines().filter(|l| !l.starts_with('#')).all(|l| l.split('\t').nth(5) == Some(".")));
}

// ---------------------------------------------------------------------------------------------
// BG-01M6PX3B: banded local alignment reaches the affine-score optimum on random pairs.
// The oracle below is written here and shares no code with the crate, including the full-matrix
// path the banded entry point now takes for small matrices.
// ---------------------------------------------------------------------------------------------

/// (match, mismatch, gap open, gap extend), a gap of length L scoring `open + L * extend`
/// (rust-bio's convention; Biopython's `open_gap_score` is `open + extend`).
type LocalScoring = (i32, i32, i32, i32);
/// +2 / -1 with the gap scoring the full-tier data review quoted (Biopython open -4, extend -1).
const LENIENT_DNA: LocalScoring = (2, -1, -3, -1);
/// The Pairwise studio's DNA defaults (match 2, mismatch -3, gap open 5, gap extend 2).
const STUDIO_DNA: LocalScoring = (2, -3, -5, -2);

/// Textbook Gotoh (1982) affine-gap Smith-Waterman score in linear memory.
fn gotoh_local_score(a: &[u8], b: &[u8], (m, mm, open, extend): LocalScoring) -> i32 {
    const NEG: i32 = i32::MIN / 4;
    let mut h_prev = vec![0; b.len() + 1];
    let mut h_row = vec![0; b.len() + 1];
    let mut f = vec![NEG; b.len() + 1]; // best score ending in a gap that consumes a[i - 1]
    let mut best = 0;
    for i in 1..=a.len() {
        let mut e = NEG; // best score ending in a gap that consumes b[j - 1]
        h_row[0] = 0;
        for j in 1..=b.len() {
            e = (e + extend).max(h_row[j - 1] + open + extend);
            f[j] = (f[j] + extend).max(h_prev[j] + open + extend);
            let s = if a[i - 1] == b[j - 1] { m } else { mm };
            h_row[j] = 0.max(h_prev[j - 1] + s).max(e).max(f[j]);
            best = best.max(h_row[j]);
        }
        std::mem::swap(&mut h_prev, &mut h_row);
    }
    best
}

/// Re-scores the reported alignment columns, so a score the columns do not add up to cannot pass.
fn local_column_score(a1: &str, a2: &str, (m, mm, open, extend): LocalScoring) -> i32 {
    let (mut score, mut run) = (0, 0u8); // run: 0 = no gap, 1 = gap in row 1, 2 = gap in row 2
    for (x, y) in a1.bytes().zip(a2.bytes()) {
        let kind = if x == b'-' { 1 } else if y == b'-' { 2 } else { 0 };
        score += match kind {
            0 => if x == y { m } else { mm },
            k if k == run => extend,
            _ => open + extend,
        };
        run = kind;
    }
    score
}

struct PairRng(u64);
impl PairRng {
    fn below(&mut self, n: usize) -> usize {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        ((self.0 >> 33) % n as u64) as usize
    }
    fn between(&mut self, lo: usize, hi: usize) -> usize { lo + self.below(hi - lo + 1) }
    fn dna(&mut self, n: usize) -> Vec<u8> { (0..n).map(|_| b"ACGT"[self.below(4)]).collect() }
    /// `s` with a base re-drawn at random at `sub` per mille of positions, and insertions and
    /// deletions at `indel` per mille each.
    fn diverge(&mut self, s: &[u8], sub: usize, indel: usize) -> Vec<u8> {
        let mut out = Vec::with_capacity(s.len() + s.len() / 10);
        for &c in s {
            let r = self.below(1000);
            if r < indel {
                continue;
            }
            if r < 2 * indel {
                out.push(c);
                out.push(b"ACGT"[self.below(4)]);
            } else if r < 2 * indel + sub {
                out.push(b"ACGT"[self.below(4)]);
            } else {
                out.push(c);
            }
        }
        out
    }
    /// A diverged copy of `core` between random flanks of `lo..=hi` nt on each side.
    fn embed(&mut self, core: &[u8], lo: usize, hi: usize, sub: usize, indel: usize) -> Vec<u8> {
        let n = self.between(lo, hi);
        let mut s = self.dna(n);
        s.extend(self.diverge(core, sub, indel));
        let n = self.between(lo, hi);
        s.extend(self.dna(n));
        s
    }
}

/// Aligns with the banded entry point, checks it against the oracle, and returns (label, score).
fn assert_banded_local_optimum(a: &[u8], b: &[u8], k: usize, w: usize, sc: LocalScoring, what: &str) -> (String, i32) {
    let (sa, sb) = (std::str::from_utf8(a).unwrap(), std::str::from_utf8(b).unwrap());
    let expected = gotoh_local_score(a, b, sc);
    let r = align_pairwise_banded_sparse(sa, sb, "local", k, w, sc.0, sc.1, sc.2, sc.3, 100_000);
    assert_eq!(r.score, expected, "{what}: k={k} w={w} scoring={sc:?}\n  {sa}\n  {sb}");
    assert_eq!(local_column_score(&r.aligned_seq1, &r.aligned_seq2, sc), r.score, "{what}: columns disagree with the score");
    assert_eq!(r.aligned_seq1.replace('-', ""), sa[r.xstart..r.xend], "{what}: row 1 is not the reported slice");
    assert_eq!(r.aligned_seq2.replace('-', ""), sb[r.ystart..r.yend], "{what}: row 2 is not the reported slice");
    (r.algorithm, r.score)
}

#[test]
fn banded_local_reaches_the_optimum_on_random_pairs() {
    // Pairs on which the k-mer band missed the optimum before this fix (under LENIENT_DNA it scored
    // 10, 13, 11 and 18 at k=3 w=24, then 16 and 22 at k=6 w=24), with Biopython 1.88
    // PairwiseAligner(mode="local") scores:
    // match 2, mismatch -1, open_gap_score -4, extend_gap_score -1 -> LENIENT_DNA column;
    // match 2, mismatch -3, open_gap_score -7, extend_gap_score -2 -> STUDIO_DNA column.
    let recorded: [(&str, &str, i32, i32); 6] = [
        ("GAACGGTTACGCTACCAACTTGCCTAT", "CTCTCTAGAATTCGTTATGTGCAAGGACTCGAGTAGGGCCGCACTCGGCAAC", 13, 8),
        ("GACAGAGCTAAGTCAGAAAGGATACGCCAGCCGGATGGAGAGTCCCACTTAGGACTG", "GATAATACATCACTATGTCCTTTTT", 14, 9),
        ("TATAAATATTGCGAACTG", "AGCATAATTAAGCGCAGCCAGAAGGCAATGGTAATGCGGTTTACTTTACACCCG", 13, 9),
        ("TCTATTTAGCGTATTTGATATCATGGCGTTCCGGATATAA", "CCTATAAGAGTGTGTGTGACGACACACCCTAACGG", 20, 10),
        ("CAATAACGACAGGGTCCGCCTCAGCCTGGATTTTCTTCCACGCAGGTTAACTA", "GGGTCCTACTTTACACACTAACTCCGCCGCTATATGCTGTGACGA", 19, 12),
        ("CCACGACTCCAGTTTCAGTTAGGCTATAGTTGGTACTAAATTGCCCCTCGGTACAAGCA", "CTCTCGCCCATACTATCAATCACCTCTAGGAGGGAATTTGCATCTCCAGTCGGAGCCG", 29, 14),
    ];
    for (a, b, lenient, studio) in recorded {
        assert_eq!(gotoh_local_score(a.as_bytes(), b.as_bytes(), LENIENT_DNA), lenient, "oracle vs Biopython: {a}/{b}");
        assert_eq!(gotoh_local_score(a.as_bytes(), b.as_bytes(), STUDIO_DNA), studio, "oracle vs Biopython: {a}/{b}");
        for (k, w) in [(3, 24), (6, 24), (3, 8)] {
            assert_banded_local_optimum(a.as_bytes(), b.as_bytes(), k, w, LENIENT_DNA, "recorded pair");
        }
    }

    // 500 seeded pairs with independently drawn lengths: unrelated 5-60 nt pairs, and a diverged
    // 8-30 nt segment planted at independent offsets, so the optimum is usually off the main diagonal.
    // (k, w) = (3, 24) is this file's convention, (6, 24) the studio's call, (3, 8) the narrowest band.
    let configs = [(3, 24, LENIENT_DNA), (6, 24, LENIENT_DNA), (6, 24, STUDIO_DNA), (3, 8, LENIENT_DNA)];
    let mut rng = PairRng(1_000_003);
    for p in 0..500 {
        let (a, b) = if p % 2 == 0 {
            let n = rng.between(5, 60);
            let a = rng.dna(n);
            let n = rng.between(5, 60);
            (a, rng.dna(n))
        } else {
            let n = rng.between(8, 30);
            let seg = rng.dna(n);
            (rng.embed(&seg, 0, 30, 60, 20), rng.embed(&seg, 0, 30, 60, 20))
        };
        for &(k, w, sc) in &configs {
            let (label, _) = assert_banded_local_optimum(&a, &b, k, w, sc, &format!("pair {p}"));
            assert!(label.contains("full matrix"), "pair {p}: a small matrix must be aligned exactly, got {label}");
        }
    }

    // Long homologous pairs past the exact-matrix budget take the k-mer band: a 2.0-2.6 kb core
    // whose bases are re-drawn at random at 2, 6 or 12 % of positions (plus 1 % insertions and 1 %
    // deletions) inside independent random flanks, aligned the way the studio calls it. The oracle
    // scores of long pairs 0-2 equal Biopython 1.88's (STUDIO_DNA: open -7, extend -2).
    let biopython_long = [3241, 3212, 2078];
    let mut rng = PairRng(20261106);
    for p in 0..9 {
        let n = rng.between(2000, 2600);
        let core = rng.dna(n);
        let sub = [20, 60, 120][p % 3];
        let (a, b) = (rng.embed(&core, 150, 600, sub, 10), rng.embed(&core, 150, 600, sub, 10));
        assert!((a.len() + 1) * (b.len() + 1) > 5_000_000, "long pair {p} must exceed the exact budget");
        let (label, score) = assert_banded_local_optimum(&a, &b, 6, 24, STUDIO_DNA, &format!("long pair {p}"));
        assert!(label.contains("Banded"), "long pair {p}: expected the k-mer band, got {label}");
        if let Some(&expected) = biopython_long.get(p) {
            assert_eq!(score, expected, "long pair {p}: oracle vs Biopython");
        }
    }
}

// ---------------------------------------------------------------------------------------------
// BG-01M6Q0K7: rust-bio's banded aligner returns an empty alignment scored MIN_SCORE when its band
// exceeds 5,000,000 cells (`MAX_CELLS` in bio 2.3 `banded.rs`). No banded result may be that
// sentinel, and the full-matrix entry point's local mode above 50 M cells bands along the same
// extended k-mer path as banded local (BG-01M6PX3B).
// ---------------------------------------------------------------------------------------------

/// rust-bio's `MIN_SCORE`: the score of the empty alignment its banded aligner returns over its ceiling.
const BAND_CEILING_SENTINEL: i32 = -858_993_459;
/// The Pairwise studio's banded protein call: match 5, mismatch -4, gap open 11, gap extend 1.
const STUDIO_PROTEIN: LocalScoring = (5, -4, -11, -1);
const AMINO_ACIDS: &[u8] = b"ACDEFGHIKLMNPQRSTVWY";

fn text(s: &[u8]) -> &str {
    std::str::from_utf8(s).unwrap()
}

/// The bug's 22 kb homologs: a 21 kb core re-drawn at 2 % of positions (plus 1 % insertions and 1 %
/// deletions) between independent random 300-900 nt flanks.
fn homologs_22kb() -> (Vec<u8>, Vec<u8>) {
    let mut rng = PairRng(0x22_0000);
    let core = rng.dna(21_000);
    (rng.embed(&core, 300, 900, 20, 10), rng.embed(&core, 300, 900, 20, 10))
}

/// Whether rust-bio's own banded aligner at `k`, `w` returns the ceiling sentinel for this pair in
/// both global and local mode: a fixture that does not reach the ceiling proves nothing here.
fn rust_bio_band_hits_ceiling(a: &[u8], b: &[u8], (m, mm, open, extend): LocalScoring, k: usize, w: usize) -> bool {
    use bio::alignment::pairwise::banded::Aligner;
    let mut aligner = Aligner::new(open, extend, move |x: u8, y: u8| if x == y { m } else { mm }, k, w);
    aligner.global(a, b).score == BAND_CEILING_SENTINEL && aligner.local(a, b).score == BAND_CEILING_SENTINEL
}

/// A result is a real alignment: not the sentinel, two non-empty rows of one length that re-score
/// to the reported score and hold exactly `rows` (the whole of both sequences in global mode).
fn assert_real_alignment(r: &molbiocraft_align::PairwiseAlignmentResult, rows: (&[u8], &[u8]), sc: LocalScoring, what: &str) {
    assert_ne!(r.score, BAND_CEILING_SENTINEL, "{what}: returned the band ceiling's sentinel ({})", r.algorithm);
    assert!(!r.aligned_seq1.is_empty(), "{what}: empty alignment, score {} ({})", r.score, r.algorithm);
    assert_eq!(r.aligned_seq1.len(), r.aligned_seq2.len(), "{what}: rows differ in length");
    assert_eq!(local_column_score(&r.aligned_seq1, &r.aligned_seq2, sc), r.score, "{what}: columns disagree with the score");
    assert!(r.aligned_seq1.replace('-', "").as_bytes() == rows.0, "{what}: row 1 is not the aligned part of sequence 1");
    assert!(r.aligned_seq2.replace('-', "").as_bytes() == rows.1, "{what}: row 2 is not the aligned part of sequence 2");
}

#[test]
fn banded_alignment_over_the_ceiling_never_returns_the_sentinel() {
    use bio::alignment::sparse::find_kmer_matches;
    use molbiocraft_align::pairwise::{align_pairwise_gotoh, PairwiseMode};

    // 1. The bug's studio repro: two unrelated 3,000-aa proteins at the studio's banded protein call
    // (5 / -4, gap open 11, extend 1, k = 6, w = 24). They share no 6-mer, so rust-bio bands the whole
    // 9 M-cell matrix and returns the sentinel. The matrix is within the 50 M cells the full-matrix
    // entry point aligns exactly, so it is aligned in full and reaches the optimum: Biopython 1.88
    // PairwiseAligner (match 5, mismatch -4, open_gap_score -12, extend_gap_score -1) global -5105,
    // local 27.
    let (a, b) = (lcg_seq(3000, AMINO_ACIDS, 101), lcg_seq(3000, AMINO_ACIDS, 202));
    let (ab, bb) = (a.as_bytes(), b.as_bytes());
    assert!(find_kmer_matches(ab, bb, 6).is_empty(), "the 3,000-aa proteins must share no 6-mer");
    assert!(rust_bio_band_hits_ceiling(ab, bb, STUDIO_PROTEIN, 6, 24), "the 3,000-aa proteins must reach the band ceiling");
    assert_eq!((gotoh_global_score(ab, bb, STUDIO_PROTEIN), gotoh_local_score(ab, bb, STUDIO_PROTEIN)), (-5105, 27), "Gotoh oracle vs Biopython");
    for (mode, optimum) in [("global", -5105), ("local", 27)] {
        let r = align_pairwise_banded_sparse(&a, &b, mode, 6, 24, 5, -4, -11, -1, 25_000);
        let rows = if mode == "global" { (ab, bb) } else { (&ab[r.xstart..r.xend], &bb[r.ystart..r.yend]) };
        assert_real_alignment(&r, rows, STUDIO_PROTEIN, &format!("3,000-aa proteins, banded {mode}"));
        assert_eq!(r.score, optimum, "3,000-aa proteins, banded {mode}: {}", r.algorithm);
        assert!(r.algorithm.contains("full matrix"), "3,000-aa proteins, banded {mode}: {}", r.algorithm);
    }

    // 2. The bug's second repro: 22 kb homologs at w = 64 (studio DNA scoring, k = 6). Their k-mer band
    // at w = 64 is over the ceiling and the 495 M-cell matrix is far past the exact limit, so the band
    // is narrowed until it fits. That is a heuristic, so it may not beat the optimum: Biopython 1.88
    // (match 2, mismatch -3, open_gap_score -7, extend_gap_score -2) global 31672, local 32704, and
    // 31730 for rust-bio's semi-global (all of the first sequence, the second's end gaps free:
    // mode="global", end_insertion_score 0). On this pair the narrowed band (w = 32) still reaches the
    // global and local optimum, so an alignment that is merely valid cannot pass.
    let (a, b) = homologs_22kb();
    assert_eq!((a.len(), b.len()), (22243, 22239), "the 22 kb fixture drifted from the pinned scores");
    assert!(rust_bio_band_hits_ceiling(&a, &b, STUDIO_DNA, 6, 64), "the 22 kb homologs must reach the band ceiling at w = 64");
    for (mode, optimum) in [("global", 31672), ("local", 32704), ("semiglobal", 31730)] {
        let r = align_pairwise_banded_sparse(text(&a), text(&b), mode, 6, 64, 2, -3, -5, -2, 100_000);
        let rows = if mode == "global" { (&a[..], &b[..]) } else { (&a[r.xstart..r.xend], &b[r.ystart..r.yend]) };
        let what = format!("22 kb homologs, banded {mode}");
        assert_real_alignment(&r, rows, STUDIO_DNA, &what);
        assert!(r.score <= optimum, "{what}: scored {} above the optimum {optimum}", r.score);
        if mode != "semiglobal" {
            assert_eq!(r.score, optimum, "{what}: {}", r.algorithm);
        }
        assert!(r.algorithm.contains("narrowed from w=64") && r.algorithm.contains("heuristic"), "{what}: {}", r.algorithm);
    }

    // 3. The same pair through the full-matrix entry point, past its 50 M-cell exact limit: it bands at
    // k = 11 and w = 111 (1/200 of the longer sequence), a band rust-bio refuses, so it narrows too,
    // here to w = 55, which still reaches the optimum.
    for (mode, optimum) in [(PairwiseMode::Global, 31672), (PairwiseMode::Local, 32704)] {
        let r = align_pairwise_gotoh(text(&a), text(&b), mode, None, 2, -3, -5, -2, 0);
        let rows = if mode == PairwiseMode::Global { (&a[..], &b[..]) } else { (&a[r.xstart - 1..r.xend], &b[r.ystart - 1..r.yend]) };
        let what = format!("22 kb homologs, {mode:?} past the exact limit");
        assert_real_alignment(&r, rows, STUDIO_DNA, &what);
        assert_eq!(r.score, optimum, "{what}: {}", r.algorithm);
        assert!(r.algorithm.contains("narrowed from w=111") && r.algorithm.contains("heuristic"), "{what}: {}", r.algorithm);
    }
    // semi-global shows both sequences in full, the free end gaps included
    let r = align_pairwise_gotoh(text(&a), text(&b), PairwiseMode::Semiglobal, None, 2, -3, -5, -2, 0);
    assert_ne!(r.score, BAND_CEILING_SENTINEL, "22 kb homologs, semi-global: {}", r.algorithm);
    assert!(r.score > 0, "22 kb homologs, semi-global: score {} ({})", r.score, r.algorithm);
    assert!(r.aligned_seq1.replace('-', "").as_bytes() == &a[..] && r.aligned_seq2.replace('-', "").as_bytes() == &b[..], "22 kb homologs, semi-global lost residues");
    assert!(r.algorithm.contains("narrowed") && r.algorithm.contains("heuristic"), "22 kb homologs, semi-global: {}", r.algorithm);

    // 4. No shared k-mer and a matrix past the exact limit: two unrelated 7,200-aa proteins at k = 8.
    // rust-bio bands the whole 52 M-cell matrix whatever the width, so the band follows the main
    // diagonal instead.
    let (a, b) = (lcg_seq(7200, AMINO_ACIDS, 303), lcg_seq(7200, AMINO_ACIDS, 404));
    let (ab, bb) = (a.as_bytes(), b.as_bytes());
    assert!(find_kmer_matches(ab, bb, 8).is_empty(), "the 7,200-aa proteins must share no 8-mer");
    assert!(rust_bio_band_hits_ceiling(ab, bb, STUDIO_PROTEIN, 8, 24), "the 7,200-aa proteins must reach the band ceiling");
    for mode in ["global", "local"] {
        let r = align_pairwise_banded_sparse(&a, &b, mode, 8, 24, 5, -4, -11, -1, 25_000);
        let rows = if mode == "global" { (ab, bb) } else { (&ab[r.xstart..r.xend], &bb[r.ystart..r.yend]) };
        let what = format!("7,200-aa proteins, banded {mode}");
        assert_real_alignment(&r, rows, STUDIO_PROTEIN, &what);
        assert!(r.algorithm.contains("main diagonal") && r.algorithm.contains("heuristic"), "{what}: {}", r.algorithm);
    }

    // 5. A pair no band can hold: a global band needs a cell in each of the 10,000,002 columns of the
    // matrix for a 5 nt and a 10,000,001 nt sequence, twice the ceiling, so the entry point says it
    // did not align them.
    let long = "ACGT".repeat(2_500_000) + "A";
    let r = align_pairwise_gotoh("ACGTA", &long, PairwiseMode::Global, None, 2, -3, -5, -2, 0);
    assert_ne!(r.score, BAND_CEILING_SENTINEL, "5 nt x 10 Mb: {}", r.algorithm);
    assert!(r.algorithm.starts_with("Not aligned"), "5 nt x 10 Mb: {}", r.algorithm);
    assert!(r.aligned_seq1.is_empty() && r.aligned_seq2.is_empty(), "5 nt x 10 Mb: a refusal carries no rows");
}

#[test]
fn large_local_alignment_uses_the_extended_band() {
    use bio::alignment::pairwise::{banded::Aligner, Scoring};
    use bio::alignment::sparse::find_kmer_matches;
    // Homologous pairs past the full-matrix entry point's 50 M-cell exact limit, in local mode at the
    // studio's DNA scoring: a 5.6-6.4 kb core re-drawn at 2, 6 or 12 % of positions (plus 1 %
    // insertions and 1 % deletions) between independent random 0.6-1.2 kb flanks. That entry point
    // bands at k = 11 and w = 64. Biopython 1.88 PairwiseAligner(mode="local"), match 2, mismatch -3,
    // open_gap_score -7, extend_gap_score -2, on pairs 1, 2, 4 and 5:
    let biopython = [(1, 7959), (2, 5777), (4, 7442), (5, 5742)];
    let mut rng = PairRng(0x0AC2_0000);
    let pairs: Vec<(Vec<u8>, Vec<u8>)> = (0..6)
        .map(|p| {
            let n = rng.between(5600, 6400);
            let core = rng.dna(n);
            let sub = [20, 60, 120][p % 3];
            (rng.embed(&core, 600, 1200, sub, 10), rng.embed(&core, 600, 1200, sub, 10))
        })
        .collect();
    let score = |x: u8, y: u8| if x == y { 2 } else { -3 };
    for (p, optimum) in biopython {
        let (a, b) = &pairs[p];
        let what = format!("pair {p} ({} x {})", a.len(), b.len());
        assert!(a.len() * b.len() > 50_000_000, "{what} must exceed the exact limit");
        assert_eq!(gotoh_local_score(a, b, STUDIO_DNA), optimum, "{what}: Gotoh oracle vs Biopython");
        let r = align_pairwise_standard(text(a), text(b), true, 2, -3, -5, -2);
        assert_real_alignment(&r, (&a[r.xstart - 1..r.xend], &b[r.ystart - 1..r.yend]), STUDIO_DNA, &what);
        assert!(r.algorithm.contains("banded"), "{what}: {}", r.algorithm);
        // the band rust-bio's own local() builds from the sdpkpp chain alone, which this path used
        let chain = Aligner::new(-5, -2, score, 11, 64).local(a, b).score;
        // the BG-01M6PX3B band: that chain extended by the LCSk++ path
        let extended = Aligner::with_scoring(Scoring::new(-5, -2, score).xclip(0).yclip(0), 11, 64)
            .custom_with_expanded_matches(a, b, find_kmer_matches(a, b, 11), None, true)
            .score;
        assert!(chain < extended, "{what}: the fixture must tell the two bands apart ({chain} vs {extended})");
        assert_eq!(r.score, extended, "{what}: not the extended band's score (chain-only band {chain}, optimum {optimum})");
        assert!(r.score <= optimum, "{what}: scored {} above the optimum {optimum}", r.score);
        // the extended band is still a heuristic: on pair 5 (12 % divergence) it falls 31 short
        if p != 5 {
            assert_eq!(r.score, optimum, "{what}: the extended band missed the optimum");
        }
    }
}

// ---------------------------------------------------------------------------------------------
// BG-01M6Q2R6: within the 5 M-cell budget banded local already aligns in full (BG-01M6PX3B),
// banded global is the full-matrix Needleman-Wunsch-Gotoh optimum too, and every banded result
// says whether it is exact or a heuristic that can score below the optimum.
// ---------------------------------------------------------------------------------------------

/// The banded entry point's exact budget: a matrix of at most this many cells, (|x| + 1) * (|y| + 1),
/// is aligned in full in local and global mode.
const EXACT_BUDGET: usize = 5_000_000;
/// What a heuristic result's label says.
const HEURISTIC_NOTE: &str = "a heuristic that can score below the optimum";

/// Pairs within the budget: a 1.2-1.9 kb core re-drawn at 6, 12 or 20 % of positions (plus 1 %
/// insertions and 1 % deletions) inside independent random 0-200 nt flanks, and every fourth pair
/// unrelated 0.3-2 kb DNA.
fn medium_pairs(count: usize) -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut rng = PairRng(0x0B2F_0000);
    (0..count)
        .map(|p| {
            if p % 4 == 3 {
                let n = rng.between(300, 2000);
                let a = rng.dna(n);
                let n = rng.between(300, 2000);
                (a, rng.dna(n))
            } else {
                let n = rng.between(1200, 1900);
                let core = rng.dna(n);
                let sub = [60, 120, 200][p % 4];
                (rng.embed(&core, 0, 200, sub, 10), rng.embed(&core, 0, 200, sub, 10))
            }
        })
        .collect()
}

/// US-01M6P2Z3's long homologs (as in `four_pairwise_modes_match_independent_affine_score_oracle`):
/// a 2.0-2.6 kb core at 2, 6 or 12 % divergence between random 150-600 nt flanks, all above the budget.
fn long_pairs() -> Vec<(Vec<u8>, Vec<u8>)> {
    let mut rng = PairRng(0x0AC1_10B6);
    (0..6)
        .map(|p| {
            let n = rng.between(2000, 2600);
            let core = rng.dna(n);
            let sub = [20, 60, 120][p % 3];
            (rng.embed(&core, 150, 600, sub, 10), rng.embed(&core, 150, 600, sub, 10))
        })
        .collect()
}

#[test]
fn banded_global_is_exact_within_the_cell_budget() {
    use bio::alignment::pairwise::banded::Aligner;
    // the k-mer band banded global used at every size before this fix: rust-bio's banded global()
    let chain_band = |a: &[u8], b: &[u8], (m, mm, open, extend): LocalScoring, k: usize, w: usize| {
        Aligner::new(open, extend, move |x: u8, y: u8| if x == y { m } else { mm }, k, w).global(a, b).score
    };

    // 1. Medium pairs at the studio's call (STUDIO_DNA, k = 6, w = 24), at k = 11, and under the
    // lenient AC1 scoring: 78 cases, on 45 of which the k-mer band fell short of the optimum, by up
    // to 3,457. The Gotoh oracle is pinned to Biopython 1.88 PairwiseAligner(mode="global") on five
    // of them (STUDIO_DNA: match 2, mismatch -3, open_gap_score -7, extend_gap_score -2;
    // LENIENT_DNA: 2, -1, -4, -1).
    let pairs = medium_pairs(26);
    for (p, sc, score) in [(1, STUDIO_DNA, 855), (15, STUDIO_DNA, -903), (23, STUDIO_DNA, -1436), (23, LENIENT_DNA, 508), (25, STUDIO_DNA, 1205)] {
        assert_eq!(gotoh_global_score(&pairs[p].0, &pairs[p].1, sc), score, "medium pair {p}: Gotoh oracle vs Biopython");
    }
    let mut band_misses = 0;
    for (p, (a, b)) in pairs.iter().enumerate() {
        assert!((a.len() + 1) * (b.len() + 1) <= EXACT_BUDGET, "medium pair {p} must be within the budget");
        for (sc, k) in [(STUDIO_DNA, 6), (STUDIO_DNA, 11), (LENIENT_DNA, 6)] {
            let what = format!("medium pair {p} ({} x {}), k = {k}, scoring {sc:?}", a.len(), b.len());
            let optimum = gotoh_global_score(a, b, sc);
            let r = align_pairwise_banded_sparse(text(a), text(b), "global", k, 24, sc.0, sc.1, sc.2, sc.3, 25_000);
            assert_real_alignment(&r, (a, b), sc, &what);
            assert_eq!(r.score, optimum, "{what}: {}", r.algorithm);
            assert!(r.algorithm.contains("full matrix") && !r.algorithm.contains("heuristic"), "{what}: {}", r.algorithm);
            if chain_band(a, b, sc, k, 24) < optimum {
                band_misses += 1;
            }
        }
    }
    // the fixture must reach the pairs a k-mer band misses, or it proves nothing
    assert!(band_misses >= 30, "the k-mer band missed the optimum on only {band_misses} of 78 medium cases");

    // 2. Short random pairs at k = 3 and 6, w = 24, and the narrowest band, w = 8: unrelated 5-60 nt
    // pairs, and a diverged 8-30 nt segment planted at independent offsets.
    let mut rng = PairRng(0x0B2F_5EED);
    for p in 0..300 {
        let (a, b) = if p % 2 == 0 {
            let n = rng.between(5, 60);
            let a = rng.dna(n);
            let n = rng.between(5, 60);
            (a, rng.dna(n))
        } else {
            let n = rng.between(8, 30);
            let seg = rng.dna(n);
            (rng.embed(&seg, 0, 30, 60, 20), rng.embed(&seg, 0, 30, 60, 20))
        };
        for (k, w, sc) in [(3, 24, LENIENT_DNA), (6, 24, STUDIO_DNA), (3, 8, LENIENT_DNA)] {
            let r = align_pairwise_banded_sparse(text(&a), text(&b), "global", k, w, sc.0, sc.1, sc.2, sc.3, 100);
            let what = format!("short pair {p}, k = {k}, w = {w}");
            assert_real_alignment(&r, (&a, &b), sc, &what);
            assert_eq!(r.score, gotoh_global_score(&a, &b, sc), "{what}: {}", r.algorithm);
        }
    }

    // 3. A protein pair at the studio's protein call: a 1,500-aa sequence and a copy with about 4 %
    // deletions, 4 % insertions and 6 % substitutions. Biopython 1.88 (match 5, mismatch -4,
    // open_gap_score -12, extend_gap_score -1): 5096.
    let a = lcg_seq(1500, AMINO_ACIDS, 505);
    let b = mutate(&a, AMINO_ACIDS, 606);
    assert_eq!(gotoh_global_score(a.as_bytes(), b.as_bytes(), STUDIO_PROTEIN), 5096, "1,500-aa pair: Gotoh oracle vs Biopython");
    let r = align_pairwise_banded_sparse(&a, &b, "global", 6, 24, 5, -4, -11, -1, 25_000);
    assert_real_alignment(&r, (a.as_bytes(), b.as_bytes()), STUDIO_PROTEIN, "1,500-aa pair");
    assert_eq!(r.score, 5096, "1,500-aa pair: {}", r.algorithm);
    assert!(r.algorithm.contains("full matrix"), "1,500-aa pair: {}", r.algorithm);

    // 4. The edge of the budget, the same for both modes: a 1,999 x 2,499 pair (5,000,000 cells with
    // the empty row and column) is aligned in full; a 2,000 x 2,500 pair (5,004,501 cells) is banded.
    let mut rng = PairRng(0x0B2F_ED6E);
    let core = rng.dna(2600);
    let copy = rng.diverge(&core, 60, 10);
    for (n1, n2, exact) in [(1999, 2499, true), (2000, 2500, false)] {
        let (a, b) = (&core[..n1], &copy[..n2]);
        for (mode, optimum) in [("global", gotoh_global_score(a, b, STUDIO_DNA)), ("local", gotoh_local_score(a, b, STUDIO_DNA))] {
            let what = format!("{n1} x {n2} {mode}");
            let r = align_pairwise_banded_sparse(text(a), text(b), mode, 6, 24, 2, -3, -5, -2, 25_000);
            let rows = if mode == "global" { (a, b) } else { (&a[r.xstart..r.xend], &b[r.ystart..r.yend]) };
            assert_real_alignment(&r, rows, STUDIO_DNA, &what);
            if exact {
                assert_eq!(r.score, optimum, "{what}: {}", r.algorithm);
                assert!(r.algorithm.contains("full matrix"), "{what}: {}", r.algorithm);
            } else {
                assert!(r.score <= optimum, "{what}: scored {} above the optimum {optimum}", r.score);
                assert!(r.algorithm.starts_with("Banded") && r.algorithm.contains(HEURISTIC_NOTE), "{what}: {}", r.algorithm);
            }
        }
    }
}

#[test]
fn banded_results_above_budget_are_labelled_heuristic() {
    use molbiocraft_align::pairwise::{align_pairwise_gotoh, PairwiseMode};
    // 1. The banded entry point above the budget, every mode, at the studio's call (STUDIO_DNA, k = 6,
    // w = 24) on US-01M6P2Z3's long pairs 2 and 5. On pair 5 (3,147 x 2,482, 12 % divergence) banded
    // global scores 390 against the Biopython 1.88 optimum of 588, so the note is not a formality.
    // Banded global keeps the better of the sdpkpp chain's band and the
    // LCSk++-extended band: the chain's on pair 2 (1106, the optimum, against 669), the extension's on
    // pair 5 (390 against -1739, where it scored 2,327 below the optimum before this fix).
    use bio::alignment::pairwise::{banded::Aligner, Scoring};
    use bio::alignment::sparse::find_kmer_matches;
    let score = |x: u8, y: u8| if x == y { 2 } else { -3 };
    let long = long_pairs();
    for (p, chain_wins) in [(2, true), (5, false)] {
        let (a, b) = &long[p];
        assert!((a.len() + 1) * (b.len() + 1) > EXACT_BUDGET, "long pair {p} must be above the budget");
        for mode in ["global", "local", "semiglobal"] {
            let r = align_pairwise_banded_sparse(text(a), text(b), mode, 6, 24, 2, -3, -5, -2, 25_000);
            let what = format!("long pair {p}, banded {mode}");
            assert_ne!(r.score, BAND_CEILING_SENTINEL, "{what}");
            assert!(r.algorithm.starts_with("Banded") && r.algorithm.contains(HEURISTIC_NOTE), "{what}: {}", r.algorithm);
            if mode == "global" {
                let chain = Aligner::new(-5, -2, score, 6, 24).global(a, b).score;
                let extended = Aligner::with_scoring(Scoring::new(-5, -2, score), 6, 24)
                    .custom_with_expanded_matches(a, b, find_kmer_matches(a, b, 6), None, true)
                    .score;
                assert_eq!(chain_wins, chain > extended, "{what}: the fixture must have each band win once ({chain} vs {extended})");
                assert_eq!(r.score, chain.max(extended), "{what}: not the better band (chain {chain}, extended {extended})");
            }
        }
    }

    // 2. Semi-global is banded at every size, so it carries the note within the budget too; global
    // and local within the budget are exact and do not.
    let (a, b) = &medium_pairs(2)[1];
    for mode in ["global", "local", "semiglobal"] {
        let r = align_pairwise_banded_sparse(text(a), text(b), mode, 6, 24, 2, -3, -5, -2, 25_000);
        let what = format!("medium pair 1, banded {mode}");
        if mode == "semiglobal" {
            assert!(r.algorithm.starts_with("Banded") && r.algorithm.contains(HEURISTIC_NOTE), "{what}: {}", r.algorithm);
        } else {
            assert!(r.algorithm.contains("full matrix") && !r.algorithm.contains("heuristic"), "{what}: {}", r.algorithm);
        }
    }

    // 3. Over rust-bio's band limit with a matrix small enough to align in full (BG-01M6Q0K7's
    // 3,000-aa proteins) the result is exact, and says so rather than calling itself a heuristic.
    let (a, b) = (lcg_seq(3000, AMINO_ACIDS, 101), lcg_seq(3000, AMINO_ACIDS, 202));
    for mode in ["global", "local"] {
        let r = align_pairwise_banded_sparse(&a, &b, mode, 6, 24, 5, -4, -11, -1, 25_000);
        assert!(r.algorithm.contains("full matrix") && !r.algorithm.contains("heuristic"), "3,000-aa proteins, {mode}: {}", r.algorithm);
    }

    // 4. The full-matrix entry point bands past its 50 M-cell exact limit; those results carry the
    // note in every mode (pair 1 of `large_local_alignment_uses_the_extended_band`, 7,845 x 8,199),
    // and its exact results within the limit do not.
    let mut rng = PairRng(0x0AC2_0000);
    let mut pairs = (0..2).map(|p| {
        let n = rng.between(5600, 6400);
        let core = rng.dna(n);
        let sub = [20, 60, 120][p % 3];
        (rng.embed(&core, 600, 1200, sub, 10), rng.embed(&core, 600, 1200, sub, 10))
    });
    let (a, b) = pairs.nth(1).unwrap();
    assert_eq!((a.len(), b.len()), (7845, 8199), "the 7.8 kb pair drifted");
    for mode in [PairwiseMode::Global, PairwiseMode::Local, PairwiseMode::Semiglobal] {
        let r = align_pairwise_gotoh(text(&a), text(&b), mode, None, 2, -3, -5, -2, 0);
        assert!(r.algorithm.contains("banded") && r.algorithm.contains(HEURISTIC_NOTE), "7.8 kb pair, {mode:?}: {}", r.algorithm);
    }
    let (a, b) = &medium_pairs(2)[1];
    for mode in [PairwiseMode::Global, PairwiseMode::Local, PairwiseMode::Semiglobal] {
        let r = align_pairwise_gotoh(text(a), text(b), mode, None, 2, -3, -5, -2, 0);
        assert!(!r.algorithm.contains("banded") && !r.algorithm.contains("heuristic"), "medium pair 1, {mode:?}: {}", r.algorithm);
    }
}
