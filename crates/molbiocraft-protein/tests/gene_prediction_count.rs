// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1P2: gene prediction lists its 24 highest-scoring CDS, and reports beside that list how
//! many it predicted, with a warning when the list holds fewer. The sequences are built here, from
//! a fixed seed, so that the number of CDS the predictor can find in them is known exactly.
//!
//! BG-01M6SK22 (D0265): where two six-frame candidates overlap by more than 50 bp (Glimmer3's
//! default maximum overlap), on the same or opposite strands, only the higher-scoring one (the
//! longer on a tie) is a predicted CDS. The candidates each fixture holds are counted here by a
//! scan of its own, so a fixture that does not reach the case it names fails as a fixture.

use molbiocraft_protein::predict_glimmer_microbial_genes;

/// A spacer of CTAG repeats: a stop codon within every four codons in all six frames, and no
/// start codon in any, so no reading frame runs through it and no CDS starts in it.
const SPACER: &str = "CTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAG";

/// One CDS of 97 amino acids: ATG, 12 blocks of 8 sense codons, then TAA. Each block opens with
/// CTA GCT AAC GCT TAC, which reads TAG and TAA in the two other forward frames and CTA, CTA and TTA (stops read on the
/// reverse strand) in the three reverse frames, so no other frame runs 50 codons without a stop;
/// three random sense codons follow, so no two CDS are alike.
fn planted_cds(x: &mut u64) -> String {
    let mut cds = String::from("ATG");
    for _ in 0..12 {
        cds.push_str("CTAGCTAACGCTTAC");
        for _ in 0..3 {
            loop {
                *x ^= *x << 13;
                *x ^= *x >> 7;
                *x ^= *x << 17;
                let codon: String = (0..3).map(|s| b"ACGT"[((*x >> (2 * s)) % 4) as usize] as char).collect();
                if !matches!(codon.as_str(), "TAA" | "TAG" | "TGA") {
                    cds.push_str(&codon);
                    break;
                }
            }
        }
    }
    cds.push_str("TAA");
    cds
}

/// `count` CDS, each between spacers, alternating strands so both are searched.
fn genome_of(count: usize, seed: u64) -> String {
    let mut x = seed;
    let mut seq = String::from(SPACER);
    for t in 0..count {
        let cds = planted_cds(&mut x);
        if t % 2 == 0 {
            seq.push_str(&cds);
        } else {
            seq.push_str(&molbiocraft_core::reverse_complement_iupac(&cds, false));
        }
        seq.push_str(SPACER);
    }
    seq
}

#[test]
fn reports_total_predicted_cds_beside_the_top_list() {
    // 40 CDS: the list holds the top 24, and the report says 40 were predicted
    let report = predict_glimmer_microbial_genes(&genome_of(40, 0x6e0e_5eed), 50);
    assert_eq!(report.genes.len(), 24);
    assert_eq!(report.annotations.len(), 24);
    assert_eq!(report.total_predicted_cds, 40);
    assert_eq!(
        report.warnings,
        ["Gene list capped: it shows the 24 highest-scoring of the 40 predicted CDS, and only these are annotated."]
    );
    // the 24 listed are the highest-scoring, best first, on both strands
    assert!(report.genes.windows(2).all(|w| w[0].coding_score >= w[1].coding_score));
    assert!(report.genes.iter().any(|g| g.strand == 1) && report.genes.iter().any(|g| g.strand == -1));

    // the fixture: each planted CDS is one prediction and nothing else is predicted, so a genome
    // of 10 lists all 10, with no warning, and genomes of 20 from other seeds list exactly 20
    let ten = predict_glimmer_microbial_genes(&genome_of(10, 0x6e0e_5eed), 50);
    assert_eq!((ten.genes.len(), ten.total_predicted_cds), (10, 10));
    assert!(ten.warnings.is_empty(), "{:?}", ten.warnings);
    assert!(ten.genes.iter().all(|g| g.length_aa == 97 && g.start_codon == "ATG"), "{:?}", ten.genes);
    for seed in [0x1111_2222u64, 0x3333_4444] {
        let half = predict_glimmer_microbial_genes(&genome_of(20, seed), 50);
        assert_eq!((half.genes.len(), half.total_predicted_cds), (20, 20));
    }

    // a report serialises the total and its warnings by these names, as the RPC replies
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["totalPredictedCds"], 40);
    assert_eq!(json["warnings"].as_array().map(Vec::len), Some(1));
    assert_eq!(serde_json::to_value(&ten).unwrap()["warnings"], serde_json::json!([]));
}

/// The overlap, in bp, of two 1-based inclusive spans.
fn overlap_bp(a: (usize, usize), b: (usize, usize)) -> usize {
    (a.1.min(b.1) + 1).saturating_sub(a.0.max(b.0))
}

/// The six-frame ORF candidates of `seq` before any overlap resolution, as (strand, start, end) on
/// the forward strand, 1-based and inclusive: on each strand and frame, each run of codons closed
/// by TAA, TAG or TGA gives one candidate, from its first ATG, GTG or TTG, when at least `min_aa`
/// codons lie between that start codon and the stop.
fn six_frame_candidates(seq: &str, min_aa: usize) -> Vec<(i8, usize, usize)> {
    let n = seq.len();
    let rc = molbiocraft_core::reverse_complement_iupac(seq, false);
    let mut out = Vec::new();
    for (strand, t) in [(1i8, seq.as_bytes()), (-1, rc.as_bytes())] {
        for frame in 0..3 {
            let mut start: Option<usize> = None;
            for i in (frame..n.saturating_sub(2)).step_by(3) {
                let codon = &t[i..i + 3];
                if matches!(codon, b"TAA" | b"TAG" | b"TGA") {
                    if let Some(s) = start.filter(|&s| (i - s) / 3 - 1 >= min_aa) {
                        out.push(if strand == 1 { (1, s + 1, i + 3) } else { (-1, n - (i + 3) + 1, n - s) });
                    }
                    start = None;
                } else if start.is_none() && matches!(codon, b"ATG" | b"GTG" | b"TTG") {
                    start = Some(i);
                }
            }
        }
    }
    out
}

/// `n` random bases from an xorshift64 seed.
fn random_bases(n: usize, seed: u64) -> String {
    let mut x = seed;
    (0..n)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            b"ACGT"[(x >> 62) as usize] as char
        })
        .collect()
}

fn revcomp(s: &str) -> String {
    molbiocraft_core::reverse_complement_iupac(s, false)
}

/// `codon` repeated `n` times.
fn codons(codon: &str, n: usize) -> String {
    codon.repeat(n)
}

/// A forward CDS that holds, in frame, a reverse-strand ORF `ATG + inner + TGA`: the forward strand
/// reads `ATG + head + TCA + revcomp(inner) + CAT + tail + TAA`, so the reverse ORF lies wholly
/// inside the forward one. `rbs` goes before the forward ATG; spacers close every frame either side.
fn nested_pair(rbs: &str, head: &str, inner: &str, tail: &str) -> String {
    let reverse_orf = format!("ATG{inner}TGA");
    format!("{SPACER}{rbs}ATG{head}{}{tail}TAA{SPACER}", revcomp(&reverse_orf))
}

/// The coding score the predictor gives the one CDS of `seq`.
fn sole_score(seq: &str, min_aa: usize) -> f64 {
    let r = predict_glimmer_microbial_genes(seq, min_aa);
    assert_eq!(r.total_predicted_cds, 1, "fixture: one CDS in {seq}");
    r.genes[0].coding_score
}

#[test]
fn overlapping_candidates_keep_the_best_scoring_one() {
    // AC1: a planted 97-aa CDS, after a Shine-Dalgarno AGGAGG, holding a 70-aa ORF on the reverse
    // strand (half its codons RNY, so it scores lower): one predicted CDS, the planted one
    let inner: String = (0..69).map(|k| if k % 2 == 0 { "AGC" } else { "CTG" }).collect();
    let planted = nested_pair("AGGAGGAAACAAC", &codons("GCT", 12), &inner, &codons("ACT", 13));
    let found = six_frame_candidates(&planted, 50);
    assert_eq!(found.len(), 2, "fixture: the planted CDS and the reverse ORF {found:?}");
    let (fwd, rev) = (found.iter().find(|c| c.0 == 1).unwrap(), found.iter().find(|c| c.0 == -1).unwrap());
    assert_eq!((fwd.2 - fwd.1 + 1, rev.2 - rev.1 + 1), (98 * 3, 71 * 3), "fixture: 97 aa and 70 aa");
    assert!(fwd.1 < rev.1 && rev.2 < fwd.2, "fixture: the reverse ORF lies inside the planted CDS");
    let rev_alone = format!("{SPACER}{}{SPACER}", revcomp(&format!("ATG{inner}TGA")));
    assert!(sole_score(&planted, 80) > sole_score(&rev_alone, 50), "fixture: the planted CDS scores higher");
    let report = predict_glimmer_microbial_genes(&planted, 50);
    assert_eq!(report.total_predicted_cds, 1, "{:?}", report.genes);
    assert_eq!(report.genes.len(), 1);
    let g = &report.genes[0];
    assert_eq!((g.strand, g.start_bp, g.end_bp, g.length_aa), (1, fwd.1, fwd.2, 97));
    assert_eq!(report.annotations.len(), 1);
    assert!(report.warnings.is_empty(), "{:?}", report.warnings);

    // the higher score wins, not the greater length: a long forward CDS of mostly non-RNY codons
    // holding a shorter, all-RNY reverse ORF keeps the reverse ORF
    let better_short = nested_pair("", &codons("CTG", 60), &codons("AGC", 40), &codons("CTG", 60));
    let found = six_frame_candidates(&better_short, 30);
    assert_eq!(found.len(), 2, "fixture: {found:?}");
    let short_alone = format!("{SPACER}{}{SPACER}", revcomp(&format!("ATG{}TGA", codons("AGC", 40))));
    assert!(sole_score(&better_short, 100) < sole_score(&short_alone, 30), "fixture: the shorter scores higher");
    let report = predict_glimmer_microbial_genes(&better_short, 30);
    assert_eq!(report.total_predicted_cds, 1, "{:?}", report.genes);
    assert_eq!((report.genes[0].strand, report.genes[0].length_aa), (-1, 41));

    // on a tie (both at the 99.5 ceiling) the longer is kept
    let tie = nested_pair("", &codons("GCT", 10), &codons("AGC", 40), &codons("ACT", 10));
    let found = six_frame_candidates(&tie, 30);
    assert_eq!(found.len(), 2, "fixture: {found:?}");
    assert_eq!(sole_score(&tie, 45), 99.5, "fixture: the forward CDS at the ceiling");
    assert_eq!(sole_score(&short_alone, 30), 99.5, "fixture: the reverse ORF at the ceiling");
    let report = predict_glimmer_microbial_genes(&tie, 30);
    assert_eq!(report.total_predicted_cds, 1, "{:?}", report.genes);
    assert_eq!((report.genes[0].strand, report.genes[0].length_aa), (1, 63));

    // the bound is 50 bp: two candidates sharing exactly 50 bp (opposite strands) are both
    // predicted; two sharing 51 bp (same strand) leave one
    for (seed, shared, predicted) in [(1974u64, 50usize, 2usize), (3731, 51, 1)] {
        let seq = format!("{SPACER}{}{SPACER}", random_bases(240, seed));
        let found = six_frame_candidates(&seq, 15);
        assert_eq!(found.len(), 2, "fixture: seed {seed} {found:?}");
        assert_eq!(overlap_bp((found[0].1, found[0].2), (found[1].1, found[1].2)), shared, "fixture: seed {seed}");
        let report = predict_glimmer_microbial_genes(&seq, 15);
        assert_eq!(report.total_predicted_cds, predicted, "seed {seed}: {:?}", report.genes);
    }
}

#[test]
fn random_sequence_predicts_no_overlapping_cds() {
    // AC2, the bug's repro: 200 kb of random sequence at the studio's 45-aa minimum
    let seq = random_bases(200_000, 0x5eed_c0de);
    let candidates = six_frame_candidates(&seq, 45);
    assert!(candidates.len() > 900, "fixture: over 900 unresolved candidates (the bug's repro read 1,083), found {}", candidates.len());
    let report = predict_glimmer_microbial_genes(&seq, 45);
    assert!(
        report.total_predicted_cds < candidates.len(),
        "{} predicted of {} candidates",
        report.total_predicted_cds,
        candidates.len()
    );
    let spans: Vec<(usize, usize)> = report.genes.iter().map(|g| (g.start_bp, g.end_bp)).collect();
    for (i, a) in spans.iter().enumerate() {
        for b in &spans[i + 1..] {
            assert!(overlap_bp(*a, *b) <= 50, "{a:?} and {b:?} overlap by more than 50 bp");
        }
    }

    // in 3-kb windows, where the list holds every CDS: the list is candidates, no two sharing
    // more than 50 bp, and each candidate left out shares more than 50 bp with one listed
    let mut left_out = 0;
    for w in 0..12 {
        let win = &seq[w * 3_000..(w + 1) * 3_000];
        let r = predict_glimmer_microbial_genes(win, 45);
        assert_eq!(r.genes.len(), r.total_predicted_cds, "fixture: window {w} lists every CDS");
        let found = six_frame_candidates(win, 45);
        let listed: Vec<(i8, usize, usize)> = r.genes.iter().map(|g| (g.strand, g.start_bp, g.end_bp)).collect();
        assert!(listed.iter().all(|g| found.contains(g)), "window {w}: {listed:?} not all candidates");
        for (i, a) in listed.iter().enumerate() {
            for b in &listed[i + 1..] {
                assert!(overlap_bp((a.1, a.2), (b.1, b.2)) <= 50, "window {w}: {a:?} and {b:?}");
            }
        }
        for c in found.iter().filter(|c| !listed.contains(c)) {
            left_out += 1;
            assert!(
                listed.iter().any(|g| overlap_bp((g.1, g.2), (c.1, c.2)) > 50),
                "window {w}: {c:?} left out though it shares 50 bp or less with each listed CDS"
            );
        }
    }
    assert!(left_out > 0, "fixture: the windows hold overlapping candidates");
}
