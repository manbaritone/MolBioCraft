// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1P2: gene prediction lists its 24 highest-scoring CDS, and reports beside that list how
//! many it predicted, with a warning when the list holds fewer. The sequences are built here, from
//! a fixed seed, so that the number of CDS the predictor can find in them is known exactly.

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
