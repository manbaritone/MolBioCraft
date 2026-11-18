// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Comprehensive integration test suite for `molbiocraft-cloning`:
//! - All 4 Guided Multi-Task Bioinformatics Pipelines (`cloning-expression-qc`, `crispr-hdr-knockout`,
//!   `multihost-protein-mrna`, `viral-twist-onboarding`), POSIX `LF` vs Windows `CRLF` Markdown exports,
//!   and `BioEngineError::EmptySequence` guard
//! - Multi-enzyme restriction digest reaction buffer planner (`rCutSmart` / `r1.1` / `r2.1` / `r3.1`),
//!   temperature conflict sequential digest detection, and star-activity alerts
//! - Pryor et al. (2020) T4 DNA Ligase 4-nt Golden Gate overhang fidelity scoring
//! - Gibson / HiFi isothermal 50 °C overlap junction $T_m$ analyzer
//! - Built-in `aho-corasick` Rust workflow macros & 10-method molecular cloning / agarose gel physics.

use molbiocraft_cloning::{
    analyze_gibson_overlap_junction, compute_agarose_gel_band_physics,
    compute_dna_and_ligation_calculations, design_pcr_primers,
    evaluate_golden_gate_overhang_fidelity, evaluate_multi_digest_buffer_plan,
    execute_bio_pipeline_rust, execute_builtin_rust_workflow_macro,
    generate_large_genome_benchmark, generate_large_protein_benchmark, get_bio_pipeline_catalog,
    get_sample_library, get_vector_catalog, predict_secondary_structure,
    simulate_molecular_cloning, simulate_site_directed_mutagenesis, BioPipelineExecutionReport,
    BioPipelineStepResult, GoldenGateOverhangPairRisk,
};
use molbiocraft_core::{BioEngineError, SequenceDocument, Topology};

#[test]
fn all_four_guided_bio_pipelines_execute_cleanly_in_rust_with_lf_and_crlf_exports() {
    let catalog = get_bio_pipeline_catalog();
    assert_eq!(catalog.len(), 4);
    let ids: Vec<&str> = catalog.iter().map(|c| c.id.as_str()).collect();
    assert_eq!(
        ids,
        vec![
            "cloning-expression-qc",
            "crispr-hdr-knockout",
            "multihost-protein-mrna",
            "viral-twist-onboarding"
        ]
    );

    let samples = get_sample_library();
    let pet28 = samples
        .iter()
        .find(|d| d.name.contains("pET-28a"))
        .unwrap_or(&samples[0]);

    for def in &catalog {
        let report = execute_bio_pipeline_rust(
            pet28,
            &def.id,
            "macos",
            "2026-10-31T08:30:00Z",
        )
        .unwrap_or_else(|e| panic!("Pipeline {} failed: {}", def.id, e));

        assert_eq!(report.pipeline_id, def.id);
        assert_eq!(report.steps.len(), def.step_titles.len());
        assert!((15..=100).contains(&report.readiness_score));
        assert!(!report.visual_zones.is_empty());
        assert!(report.markdown_protocol.contains(&report.pipeline_title));
        assert!(!report.markdown_protocol.contains("\r\n"));
    }

    // Windows hostOS must emit CRLF (\r\n) line endings and avoid DOS reserved stems
    let mut con_doc = pet28.clone();
    con_doc.name = "CON".into();
    let win_report = execute_bio_pipeline_rust(
        &con_doc,
        "cloning-expression-qc",
        "windows",
        "2026-10-31T08:30:00Z",
    )
    .unwrap();
    assert!(win_report.markdown_protocol.contains("\r\n"));
    assert!(win_report.suggested_export_filename.starts_with("MBC_"));

    // Empty / < 12 bp document must return BioEngineError::EmptySequence
    let empty_doc = SequenceDocument {
        id: "empty-1".into(),
        name: "TinyFrag".into(),
        sequence: "ATGC".into(),
        topology: Topology::Linear,
        ..Default::default()
    };
    let err = execute_bio_pipeline_rust(
        &empty_doc,
        "cloning-expression-qc",
        "linux",
        "2026-10-31T08:30:00Z",
    );
    assert!(matches!(err, Err(BioEngineError::EmptySequence(_))));
}

/// BG-01M6PWB5: the CRISPR pipeline's guide scores are a rule-of-thumb on-target heuristic and a
/// specificity score from exact seed matches inside the sequence, so no catalog entry, report or
/// Markdown export may attribute them to a published model (Doench, Hsu-Zhang) that was never run.
///
/// The readout it reads is now the rank bare beside the seed count, under a label that states the
/// range the scorer owns (BG-01M7E61C): the old `"{on}/100 • {seed}/100"` value printed a rank out
/// of a 100 it can never reach, and the specificity it parsed was a 100 / (1 + matches) percentage.
///
/// The rationale it reads is now the engine's own description of the rank (BG-01M7EGF6): this test
/// reads it only for what BG-01M6PWB5 guards — a rule of thumb with no published model behind it —
/// and `bg_01m7egf6_ac1_the_grna_rationale_reads_the_rule_the_scorer_runs_over_the_spcas9_guides`
/// owns the retired spellings, so the sentence is pinned once.
#[test]
fn crispr_pipeline_labels_guide_scores_as_the_heuristics_it_computes() {
    let (rank_lo, rank_hi) = molbiocraft_cloning::cloning_crispr::CRISPR_HEURISTIC_RANK_RANGE;
    let score_label =
        format!("Heuristic Rank ({rank_lo}–{rank_hi}) / Exact Seed Matches (range searched)");
    let score_label = score_label.as_str();
    const UNRUN_MODELS: [&str; 4] = ["Doench", "Hsu", "Zhang", "Rule Set"];

    let samples = get_sample_library();
    let pet28 = samples
        .iter()
        .find(|d| d.name.contains("pET-28a"))
        .unwrap_or(&samples[0]);

    for def in &get_bio_pipeline_catalog() {
        let report = execute_bio_pipeline_rust(pet28, &def.id, "macos", "2026-10-31T08:30:00Z")
            .unwrap_or_else(|e| panic!("Pipeline {} failed: {}", def.id, e));
        let catalog_json = serde_json::to_string(def).unwrap();
        let report_json = serde_json::to_string(&report).unwrap();
        for model in UNRUN_MODELS {
            assert!(!catalog_json.contains(model), "{} catalog entry names {model}", def.id);
            assert!(!report_json.contains(model), "{} report names {model}", def.id);
            assert!(
                !report.markdown_protocol.contains(model),
                "{} Markdown export names {model}",
                def.id
            );
        }
    }

    let crispr =
        execute_bio_pipeline_rust(pet28, "crispr-hdr-knockout", "macos", "2026-10-31T08:30:00Z")
            .unwrap();
    let ranking = crispr
        .steps
        .iter()
        .find(|s| s.id == "grna-ranking")
        .expect("gRNA ranking step");
    assert!(ranking
        .biological_rationale
        .contains("a rule of thumb over the spacer and its PAM"));
    assert!(ranking.biological_rationale.contains("not a trained on-target model"));
    let score = ranking
        .metrics
        .iter()
        .find(|m| m.label == score_label)
        .unwrap_or_else(|| panic!("no '{score_label}' metric in {:?}", ranking.metrics));
    // The fixture reaches the lead-guide branch, so the label carries real scores, not "N/A".
    let (rank, seed_matches) = score
        .value
        .split_once(" • ")
        .unwrap_or_else(|| panic!("unexpected score value {:?}", score.value));
    let n: i32 = rank.parse().unwrap();
    assert!(
        (rank_lo..=rank_hi).contains(&n),
        "rank {n} outside the range the scorer reports ({rank_lo} to {rank_hi})"
    );
    // The seed readout is a count in the studio's words, never a percentage (BG-01M7E61C).
    assert!(
        seed_matches == "No other seed copy"
            || seed_matches.ends_with(" seed match")
            || seed_matches.ends_with(" seed matches"),
        "unexpected seed readout {seed_matches:?}"
    );
    assert!(
        ranking
            .finding_summary
            .contains(&format!("heuristic rank {rank}, {}", seed_matches.to_lowercase())),
        "the summary does not say the same thing as the readout: {}",
        ranking.finding_summary
    );
    assert!(!score.value.contains("/100") && !ranking.finding_summary.contains("/100"));
    assert!(crispr
        .markdown_protocol
        .contains(&format!("| {score_label} | {} |", score.value)));
}

/// Each flagged overhang pair as (a, b, rule), the rule named by the issue text it carries.
fn overhang_flags(pairs: &[GoldenGateOverhangPairRisk]) -> Vec<(&str, &str, &'static str)> {
    pairs
        .iter()
        .map(|p| {
            let rule = [
                ("All A/T", "all A/T"),
                ("cross-ligate", "cross-ligate"),
                ("One mismatch", "one mismatch"),
                ("Near-palindrome", "near-palindrome"),
            ]
            .into_iter()
            .find(|(k, _)| p.issue.contains(k))
            .map_or("unrecognised issue", |(_, rule)| rule);
            (p.overhang_a.as_str(), p.overhang_b.as_str(), rule)
        })
        .collect()
}

#[test]
fn multi_digest_buffer_compatibility_golden_gate_fidelity_and_gibson_junctions() {
    // 1. Compatible 37 °C double digest in 1x rCutSmart Buffer (EcoRI-HF / BamHI / NdeI)
    let compat = evaluate_multi_digest_buffer_plan(&[
        "EcoRI".to_string(),
        "NdeI".to_string(),
        "XhoI".to_string(),
    ]);
    assert_eq!(compat.recommended_buffer, "1× rCutSmart Buffer");
    assert_eq!(compat.minimum_shared_activity_pct, 100);
    assert!(!compat.sequential_digest_required);
    assert_eq!(compat.incubation_temp_c, 37);

    // 2. Incompatible temperature / buffer pair: BamHI (r2.1/rCutSmart, 37 °C) + BsmBI (r3.1, 55 °C)
    let conflict = evaluate_multi_digest_buffer_plan(&[
        "BamHI".to_string(),
        "BsmBI".to_string(),
    ]);
    assert!(conflict.sequential_digest_required);
    assert!(conflict
        .protocol_notes
        .iter()
        .any(|n| n.contains("Temperature") || n.contains("Sequential")));

    // 3. High-fidelity orthogonal MoClo 4-nt Golden Gate set vs palindromic/duplicate collision set
    let high_fi = evaluate_golden_gate_overhang_fidelity(&[
        "GGAG".into(),
        "TACT".into(),
        "AATG".into(),
        "GCTT".into(),
    ]);
    // Rule-based screen: no quantitative fidelity is claimed without the T4 ligase pairing matrix.
    assert!(high_fi.overall_fidelity_pct.is_nan());
    assert!(high_fi.palindromic_overhangs.is_empty());
    assert!(high_fi.risky_pairs.is_empty(), "{:?}", high_fi.risky_pairs);

    let low_fi = evaluate_golden_gate_overhang_fidelity(&[
        "AATT".into(), // Palindromic!
        "GGAG".into(),
        "CTCC".into(), // Reverse complement of GGAG!
    ]);
    assert!(low_fi.risky_pairs.iter().any(|r| r.issue.contains("cross-ligate")));
    assert_eq!(low_fi.palindromic_overhangs, vec!["AATT".to_string()]);
    assert!(!low_fi.risky_pairs.is_empty());

    // The screen's verdicts, derived by hand from the overhangs (reverse complements checked with
    // Biopython 1.88 Seq.reverse_complement). The MoClo set above has no palindrome, no all-A/T
    // overhang, and no pair within one mismatch of complementary.
    assert_eq!(
        high_fi.verdict,
        "No palindromes, duplicates or one-mismatch cross-pairings in this set."
    );
    // AATT is its own reverse complement (self-ligates) and all A/T; GGAG and CTCC are each
    // other's reverse complement (cross-ligate); every other pair is 4 mismatches from pairing.
    assert_eq!(
        overhang_flags(&low_fi.risky_pairs),
        vec![("AATT", "AATT", "all A/T"), ("GGAG", "CTCC", "cross-ligate")]
    );
    assert!(low_fi.overall_fidelity_pct.is_nan());
    assert!(low_fi.verdict.starts_with("3 issue(s) flagged"), "{}", low_fi.verdict);
    assert!(low_fi.verdict.contains("no quantitative fidelity is predicted"));
    // Duplicate and one-mismatch overhangs: GCTT listed twice cross-ligates with itself; AAGG is
    // one base from AAGC, the reverse complement GCTT pairs with (5'-GCTT-3' over 3'-GGAA-5'
    // pairs G:G, C:G, T:A, T:A), so each GCTT can mis-ligate to it. Nothing is palindromic or all A/T.
    let dup = evaluate_golden_gate_overhang_fidelity(&["GCTT".into(), "GCTT".into(), "AAGG".into()]);
    assert!(dup.palindromic_overhangs.is_empty());
    assert_eq!(
        overhang_flags(&dup.risky_pairs),
        vec![
            ("GCTT", "GCTT", "cross-ligate"),
            ("GCTT", "AAGG", "one mismatch"),
            ("GCTT", "AAGG", "one mismatch"),
        ]
    );
    assert!(dup.overall_fidelity_pct.is_nan());

    // 4. Gibson 50 °C isothermal overlap junction analyzer
    let opt_junc = analyze_gibson_overlap_junction("GTCCAGGAGCGCACCATCTTCTTCA");
    assert!(opt_junc.isothermal_50c_optimal);
    assert!(opt_junc.tm_c >= 50.0);

    let short_junc = analyze_gibson_overlap_junction("AATTAA");
    assert!(!short_junc.isothermal_50c_optimal);
}

#[test]
fn builtin_workflow_macros_gel_physics_cloning_and_large_benchmark_generators() {
    let samples = get_sample_library();
    let pet28 = &samples[0];

    for macro_id in [
        "js-goldengate-domestication",
        "js-kozak-rbs-auditor",
        "js-crispr-spcas9-scanner",
    ] {
        let out = execute_builtin_rust_workflow_macro(macro_id, pet28);
        assert!(out.get("plugin").and_then(|v| v.as_str()).is_some());
    }

    // Agarose gel band migration physics across TAE / TBE / SB buffers
    let bands = compute_agarose_gel_band_physics(&[5_000, 1_500, 500], 1.0, "TAE", 100.0);
    assert_eq!(bands.len(), 3);
    // Smaller DNA fragments migrate strictly farther down the gel than larger fragments
    assert!(bands[2].migration_mm > bands[1].migration_mm);
    assert!(bands[1].migration_mm > bands[0].migration_mm);

    let vec_cat = get_vector_catalog();
    assert_eq!(vec_cat.len(), 69);

    let pcr = design_pcr_primers(pet28, 100, 750, 60.0, "GAATTC", "CTCGAG");
    assert!(pcr.amplicon_length >= 650);

    let mut_sim =
        simulate_site_directed_mutagenesis(pet28, "Substitution", 120, "GCG", 3);
    assert_eq!(mut_sim.replacement_subseq, "GCG");

    let rna_fold = predict_secondary_structure("GGGAAACCCGGGAAACCC", "RNA");
    assert!(rna_fold.minimum_free_energy_kcal_mol < 0.0);

    let calc = compute_dna_and_ligation_calculations(4_500, 50.0, 20.0, 100.0, 1_200);
    assert!(!calc.ligation_ratios.is_empty());

    let cloned = simulate_molecular_cloning(
        pet28,
        &samples[1],
        "Gibson",
        "EcoRI",
        "BamHI",
        "BsaI",
    );
    assert!(cloned.construct_document.sequence.len() > 1_000);

    // Verify large 500 kbp genome & 10,000 aa giant protein generators
    let big_chr = generate_large_genome_benchmark(500_000, "Escherichia coli K-12");
    assert_eq!(big_chr.sequence.len(), 500_000);
    assert!(!big_chr.features.is_empty());

    let big_prot = generate_large_protein_benchmark(10_000, "Titin / NRPS Megasynthase");
    assert_eq!(big_prot.sequence.len(), 10_000);
}

/// The sites of `site` (an IUPAC recognition sequence) on a circular `seq`, on the top strand and,
/// when it is not its own reverse complement, the bottom strand too, across the origin as well:
/// a direct count, with nothing taken from the engine's scanner. An N in a site matches any base.
fn direct_circular_sites(seq: &[u8], site: &str) -> usize {
    let matches = |b: u8, code: u8| match code {
        b'R' => b"AG".contains(&b),
        b'Y' => b"CT".contains(&b),
        b'S' => b"CG".contains(&b),
        b'W' => b"AT".contains(&b),
        b'K' => b"GT".contains(&b),
        b'M' => b"AC".contains(&b),
        b'B' => b"CGT".contains(&b),
        b'D' => b"AGT".contains(&b),
        b'H' => b"ACT".contains(&b),
        b'V' => b"ACG".contains(&b),
        b'N' => true,
        c => b == c,
    };
    let complement = |c: u8| match c {
        b'A' => b'T', b'C' => b'G', b'G' => b'C', b'T' => b'A', b'R' => b'Y', b'Y' => b'R',
        b'K' => b'M', b'M' => b'K', b'B' => b'V', b'V' => b'B', b'D' => b'H', b'H' => b'D', c => c,
    };
    let top = site.as_bytes().to_vec();
    let bottom: Vec<u8> = top.iter().rev().map(|&c| complement(c)).collect();
    let strands = if top == bottom { vec![top] } else { vec![top, bottom] };
    let n = seq.len();
    strands
        .iter()
        .map(|m| (0..n).filter(|&i| m.iter().enumerate().all(|(k, &c)| matches(seq[(i + k) % n], c))).count())
        .sum()
}

/// BG-01M6S1K2: the cloning QC pipeline's restriction audit names the unique cutters and counts
/// the Type IIS sites from every enzyme's complete site count, not from the positions the scan
/// keeps (2,000 per enzyme).
#[test]
fn restriction_audit_counts_unique_cutters_and_type_iis_sites_completely() {
    use molbiocraft_cloning::get_rebase_enzymes;
    // 30 kb, circular: seeded random bases with 2,100 GTCTCA repeats from base 12,001. Each repeat
    // is a site of BsmAI (GTCTC) and BspCNI (CTCAG), Type IIS enzymes that then cut more often than
    // the scan keeps positions for; some enzymes cut it once and some not at all.
    let mut x: u64 = 0x5EED_0030;
    let mut base = || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        b"ACGT"[(x >> 33) as usize % 4] as char
    };
    let random: String = (0..30_000).map(|_| base()).collect();
    let seq = format!("{}{}{}", &random[..12_000], "GTCTCA".repeat(2_100), &random[24_600..]);
    let doc = SequenceDocument {
        id: "type-iis-30kb".into(),
        name: "TypeIIS_30kb".into(),
        sequence: seq.clone(),
        topology: Topology::Circular,
        ..Default::default()
    };
    // Under 100,000 bp the scan reads the whole catalogue.
    let catalog = get_rebase_enzymes();
    let direct: Vec<(String, bool, usize)> = catalog
        .iter()
        .map(|e| (e.name.clone(), e.is_type_iis, direct_circular_sites(seq.as_bytes(), &e.recognition_seq)))
        .collect();
    let once: Vec<&str> = direct.iter().filter(|d| d.2 == 1).map(|d| d.0.as_str()).collect();
    let none = direct.iter().filter(|d| d.2 == 0).count();
    let type_iis_sites: usize = direct.iter().filter(|d| d.1).map(|d| d.2).sum();
    let over_cap = direct.iter().filter(|d| d.1 && d.2 > 2_000).count();
    assert!(!once.is_empty() && none > 0, "the fixture has single cutters and noncutters: {} and {none}", once.len());
    assert!(over_cap >= 2, "the fixture: BsmAI and BspCNI cut more often than positions are kept for");

    let report = execute_bio_pipeline_rust(&doc, "cloning-expression-qc", "linux", "2026-11-07T00:00:00Z").unwrap();
    let step = report.steps.iter().find(|s| s.id == "restriction-strain-audit").expect("the restriction audit step");
    assert!(
        step.finding_summary.starts_with(&format!("{} unique 1-cutters (", once.len())),
        "exactly the enzymes that cut once: {}",
        step.finding_summary
    );
    assert!(
        step.finding_summary.contains(&format!(", {none} 0-cutters, {type_iis_sites} Type IIS site(s), and ")),
        "every Type IIS site: {}",
        step.finding_summary
    );
    let metric = |label: &str| step.metrics.iter().find(|m| m.label == label).map(|m| m.value.clone()).unwrap_or_default();
    assert_eq!(metric("Type IIS Sites (BsaI/BsmBI/BbsI)"), format!("{type_iis_sites} site(s)"));
    let named = metric("Unique 1-Cutter Enzymes");
    assert!(named.split(", ").all(|n| once.contains(&n)), "only single cutters are named: {named}");
    assert_eq!(step.status, "WARN", "more than two Type IIS sites");
}

/// BG-01M6SMBS: the Multi-Host Protein Expression pipeline reads its CDS from the stored segments
/// in index order (`pipeline_coding_sequence`), so it harmonizes a join of complemented parts as
/// the GenBank importer stores it. A seeded 6 kb record whose CDS is
/// join(complement(4002..5501),complement(1001..3700)), parsed by `parse_genbank_flatfile`, gives
/// the step-2 metrics, finding summary and CDS description of the same record written
/// complement(join(1001..3700,4002..5501)). Both parts are whole codons, so a read's CAI as written
/// does not change when its parts trade places (asserted below): the strand is what it sees, and
/// the description, which names the parts in stored order, is what sees their order.
#[test]
fn pipeline_reads_a_per_part_complement_join_as_its_complement_join_form() {
    use molbiocraft_formats::parse_genbank_flatfile;
    use molbiocraft_protein::translation_orf::codon_adaptation_index;
    // Seeded ACGT (an LCG's top two bits), as the Vitest suites' seededDna.
    let mut x: u32 = 0x5EED_6000;
    let seq: String = (0..6_000)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            b"ACGT"[(x >> 30) as usize] as char
        })
        .collect();
    let record = |location: &str| {
        let mut gb = format!(
            "LOCUS       SplitMinus  {} bp    DNA     linear   SYN 07-NOV-2026\nFEATURES             Location/Qualifiers\n     source          1..{}\n     CDS             {location}\n                     /gene=\"splitMinus\"\nORIGIN\n",
            seq.len(),
            seq.len()
        );
        for (i, row) in seq.to_ascii_lowercase().as_bytes().chunks(60).enumerate() {
            let groups: Vec<&str> = row.chunks(10).map(|g| std::str::from_utf8(g).unwrap()).collect();
            gb.push_str(&format!("{:>9} {}\n", i * 60 + 1, groups.join(" ")));
        }
        gb.push_str("//\n");
        gb
    };
    // Step 2: its finding summary and every metric, label and value.
    let step2 = |location: &str| {
        let doc = parse_genbank_flatfile(&record(location), "SplitMinus");
        assert_eq!(doc.sequence, seq, "{location}: the record's bases");
        let report = execute_bio_pipeline_rust(&doc, "multihost-protein-mrna", "linux", "2026-11-07T00:00:00Z").unwrap();
        let step = report.steps.iter().find(|s| s.id == "multihost-cai").expect("the multi-host CAI step");
        (step.finding_summary.clone(), step.metrics.iter().map(|m| (m.label.clone(), m.value.clone())).collect::<Vec<_>>())
    };
    let joined = step2("complement(join(1001..3700,4002..5501))");
    let per_part = step2("join(complement(4002..5501),complement(1001..3700))");
    assert_eq!(per_part, joined, "the per-part form is harmonized as its complement(join) form");

    let metric = |label: &str| joined.1.iter().find(|m| m.0 == label).map(|m| m.1.clone()).unwrap_or_default();
    let description = "CDS \"splitMinus\" (4,200 bp, join(1,001..3,700,4,002..5,501), - strand)";
    assert_eq!(metric("Coding Sequence Read"), description);
    assert!(joined.0.ends_with(&format!("harmonized from {description}.")), "{}", joined.0);

    // What both read is the gene, rc(1001..3700 + 4002..5501), and the base's read of the per-part
    // form (the + strand, the parts as listed) is not.
    let rc = |s: &str| -> String {
        s.bytes()
            .rev()
            .map(|b| match b {
                b'A' => 'T',
                b'C' => 'G',
                b'G' => 'C',
                _ => 'A',
            })
            .collect()
    };
    let as_written = |coding: &str| {
        format!(
            "{:.2} / {:.2} / {:.2}",
            codon_adaptation_index(coding, "ecoli_k12"),
            codon_adaptation_index(coding, "human_hek293"),
            codon_adaptation_index(coding, "yeast_scerevisiae")
        )
    };
    let gene = rc(&format!("{}{}", &seq[1_000..3_700], &seq[4_001..5_501]));
    assert_eq!(gene.len(), 4_200);
    assert_eq!(metric("CDS CAI As Written (E. coli / Human / Yeast)"), as_written(&gene));
    let base_read = format!("{}{}", &seq[4_001..5_501], &seq[1_000..3_700]);
    assert_ne!(as_written(&base_read), as_written(&gene), "the fixture tells the strands apart");
    assert_eq!(as_written(&rc(&base_read)), as_written(&gene), "whole-codon parts: CAI does not see their order");
}

// ─── BG-01M6T6JA: the gRNA pipeline's guide counts, its scan warnings, and a circular record ───

/// Seeded pseudo-random bases over `alphabet` (an LCG, the same one the Vitest suites' `randomDna`
/// uses), so every run reads the same record and no fixture file is committed.
fn seeded_bases(len: usize, seed: u32, alphabet: &[u8]) -> String {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            alphabet[(x >> 30) as usize % alphabet.len()] as char
        })
        .collect()
}

/// Every candidate guide of `seq` as `(cut site, strand, crosses the origin)`: an exhaustive
/// both-strand PAM scan, with nothing taken from the engine's own scan or its `candidate_count`.
///
/// SpCas9 reads a 20-nt spacer then an NGG PAM — a 23-base site, starting at every base
/// `0..=len-23` of each strand — and cuts bluntly 3 bp 5' of the PAM, between site bases 17 and 18.
/// Cas12a reads a TTTV PAM then a 20-nt spacer — a 24-base site, `0..=len-24` — and cuts after
/// spacer nt 18, between site bases 22 and 23. A spacer holding anything but A, C, G or T is no
/// candidate, since no seed of A, C, G and T can be counted for it. On a circle every base of each
/// strand starts a site, and a site that runs off the last base continues at base 1.
///
/// The cut site is the 1-based plus-strand base the nuclease cuts after: of the two bases that
/// flank the cut, the one that comes first in plus-strand reading order. That is site base 17 (22
/// for Cas12a) on the plus strand and the next site base on the minus strand, because the two
/// strands run in opposite directions.
fn oracle_candidate_guides(seq: &str, is_spcas9: bool, circular: bool) -> Vec<(usize, i8, bool)> {
    let plus = seq.as_bytes();
    let len = plus.len();
    let span = if is_spcas9 { 23 } else { 24 };
    let mut found = Vec::new();
    if len < span {
        return found;
    }
    let minus: Vec<u8> = plus
        .iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'C' => b'G',
            b'G' => b'C',
            b'T' => b'A',
            other => other,
        })
        .collect();
    let starts = if circular { len } else { len - span + 1 };
    let cut_after = if is_spcas9 { 17 } else { 22 };
    for strand in [1i8, -1] {
        let read: &[u8] = if strand == 1 { plus } else { &minus };
        for i in 0..starts {
            let site: Vec<u8> = (0..span).map(|k| read[(i + k) % len]).collect();
            let (spacer, pam_ok) = if is_spcas9 {
                (&site[..20], site[21] == b'G' && site[22] == b'G')
            } else {
                (&site[4..], site[..3] == *b"TTT" && matches!(site[3], b'A' | b'C' | b'G'))
            };
            if !pam_ok || spacer.iter().any(|b| !b"ACGT".contains(b)) {
                continue;
            }
            // Base `k` (1-based) of this site, in 1-based plus-strand coordinates.
            let plus_coord = |k: usize| -> usize {
                if strand == 1 {
                    (i + k - 1) % len + 1
                } else {
                    len - (i + k - 1) % len
                }
            };
            let cut = plus_coord(if strand == 1 { cut_after } else { cut_after + 1 });
            found.push((cut, strand, i + span > len));
        }
    }
    found
}

/// A DNA document of `seq`, with `features` annotated on it.
fn pipeline_doc(
    id: &str,
    seq: &str,
    topology: Topology,
    features: Vec<molbiocraft_core::SequenceFeature>,
) -> SequenceDocument {
    SequenceDocument {
        id: id.into(),
        name: id.into(),
        sequence: seq.into(),
        topology,
        features,
        ..Default::default()
    }
}

/// A CDS annotated on the plus strand from `start` to `end` (1-based, inclusive).
fn cds_feature(start: usize, end: usize) -> molbiocraft_core::SequenceFeature {
    molbiocraft_core::SequenceFeature {
        id: "cds-ko".into(),
        name: "koTarget".into(),
        feature_type: "CDS".into(),
        start,
        end,
        strand: 1,
        color: "#2563eb".into(),
        notes: None,
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    }
}

/// 100 kb of seeded random bases with a CDS annotated over its first 60,000, so the knockout window
/// the step maps (10%–70% of the coding span) is a third of the record and thousands of candidate
/// guides cut inside it — far more than the 40 the guide list keeps.
fn hundred_kb_knockout_record() -> SequenceDocument {
    pipeline_doc(
        "Grna_Counts_100kb",
        &seeded_bases(100_000, 0x5EED_6A01, b"ACGT"),
        Topology::Linear,
        vec![cds_feature(1, 60_000)],
    )
}

/// 5,000 bases of seeded random DNA made a circle, with an SpCas9 and a Cas12a site planted across
/// its origin on each strand: four guides a straight read of the same bases cannot find.
///
/// Each plant is the PAM alone, written over the random background, which supplies the spacer:
/// bases 11 and 12 are the GG of a plus-strand SpCas9 site that starts at base 4,990; bases 1 and
/// 5,000 are the C,C a minus-strand SpCas9 site reads as its GG; bases 4,990..4,993 are a
/// plus-strand TTTA; and bases 4,983..4,980 read TTTA on the minus strand. Every one of the four
/// sites therefore holds both base 5,000 and base 1.
fn origin_crossing_plasmid() -> SequenceDocument {
    let mut bases = seeded_bases(5_000, 0x5EED_6A03, b"ACGT").into_bytes();
    let len = bases.len();
    for (at, b) in [
        (11, b'G'),
        (12, b'G'),
        (1, b'C'),
        (len, b'C'),
        (len - 10, b'T'),
        (len - 9, b'T'),
        (len - 8, b'T'),
        (len - 7, b'A'),
        (20, b'A'),
        (19, b'A'),
        (18, b'A'),
        (17, b'T'),
    ] {
        bases[at - 1] = b;
    }
    pipeline_doc(
        "Grna_Origin_5kb",
        &String::from_utf8(bases).expect("ASCII bases"),
        Topology::Circular,
        Vec::new(),
    )
}

/// The CRISPR knockout pipeline run on `doc`: its report, and its gRNA ranking step.
fn grna_report(doc: &SequenceDocument) -> (BioPipelineExecutionReport, BioPipelineStepResult) {
    let report =
        execute_bio_pipeline_rust(doc, "crispr-hdr-knockout", "linux", "2026-11-07T00:00:00Z")
            .expect("the CRISPR knockout pipeline runs");
    let step = report
        .steps
        .iter()
        .find(|s| s.id == "grna-ranking")
        .expect("the gRNA ranking step")
        .clone();
    (report, step)
}

/// A step's metric by label.
fn step_metric(step: &BioPipelineStepResult, label: &str) -> String {
    step.metrics
        .iter()
        .find(|m| m.label == label)
        .map(|m| m.value.clone())
        .unwrap_or_else(|| panic!("no '{label}' metric in {:?}", step.metrics))
}

/// The knockout window step 1 mapped, as the 1-based first and last bases its metric names.
fn ko_window(report: &BioPipelineExecutionReport) -> (usize, usize) {
    let step = report
        .steps
        .iter()
        .find(|s| s.id == "ko-window")
        .expect("the knockout window step");
    let shown = step_metric(step, "Optimal NMD Knockout Window");
    let (first, last) = shown
        .trim_start_matches("bp ")
        .split_once("..")
        .unwrap_or_else(|| panic!("unexpected window {shown:?}"));
    (first.parse().unwrap(), last.parse().unwrap())
}

const SPCAS9_METRIC: &str = "SpCas9 (5'-NGG-3') Candidates";
const CAS12A_METRIC: &str = "LbCas12a (5'-TTTV-3') Candidates";

/// BG-01M6T6JA/AC1: the gRNA step reports the candidate guides the scans found, and the candidates
/// that cut inside the knockout window — not the 40 and 25 its own lists keep.
///
/// Wrong implementations this catches: the shipped `find_crispr_guides(.., 40).len()` as the total
/// (the fixture holds thousands of candidates, so a list length is never the total); the window
/// counted over the listed guides (more than 40 candidates cut inside the window, which a count
/// over a 40-guide list cannot reach); the window count passed off as the total, or the total as
/// the window count (both are asserted, and they differ); and the Markdown export left on the old
/// numbers (its rows are read too).
#[test]
fn grna_pipeline_counts_every_candidate_guide() {
    let doc = hundred_kb_knockout_record();
    let (report, step) = grna_report(&doc);
    let (win_start, win_end) = ko_window(&report);

    let spcas9 = oracle_candidate_guides(&doc.sequence, true, false);
    let cas12a = oracle_candidate_guides(&doc.sequence, false, false);
    let in_window = spcas9
        .iter()
        .filter(|&&(cut, _, _)| (win_start..=win_end).contains(&cut))
        .count();
    assert!(
        spcas9.len() > 40 && cas12a.len() > 25,
        "the fixture caps both lists, so neither length is its total: {} and {}",
        spcas9.len(),
        cas12a.len()
    );
    assert!(
        in_window > 40,
        "the fixture's window holds more candidates than the 40 listed, so a count over the list cannot reach it: {in_window}"
    );
    assert!(
        in_window < spcas9.len(),
        "and not every candidate: {in_window} of {}",
        spcas9.len()
    );

    let fmt = molbiocraft_core::format_thousands;
    let headline = format!(
        "Found {} SpCas9 and {} Cas12a candidate guides; listing the top 40 and top 25;",
        fmt(spcas9.len()),
        fmt(cas12a.len())
    );
    assert!(
        step.finding_summary.starts_with(&headline),
        "{}",
        step.finding_summary
    );
    assert_eq!(
        step_metric(&step, SPCAS9_METRIC),
        format!("{} ({} in KO window)", fmt(spcas9.len()), fmt(in_window))
    );
    assert_eq!(step_metric(&step, CAS12A_METRIC), fmt(cas12a.len()));

    for line in [
        format!("**Summary**: {}", step.finding_summary),
        format!(
            "| {SPCAS9_METRIC} | {} ({} in KO window) |",
            fmt(spcas9.len()),
            fmt(in_window)
        ),
        format!("| {CAS12A_METRIC} | {} |", fmt(cas12a.len())),
    ] {
        assert!(
            report.markdown_protocol.contains(&line),
            "the Markdown export is missing {line:?}"
        );
    }
}

/// BG-01M6T6JA/AC2: the gRNA step carries the guide scans' own warnings, and the Markdown export
/// writes them in a Warnings section — one `- sentence` line each.
///
/// Wrong implementations this catches: the scans' warnings dropped (the shipped step has no
/// warnings at all); the sentences rewritten rather than carried as the engine wrote them (both are
/// asserted in full, with the oracle's totals in them); a Warnings section printed for every step
/// whatever it found (the short record's export has none).
#[test]
fn grna_pipeline_keeps_the_guide_scan_warnings_in_its_report_and_export() {
    let doc = hundred_kb_knockout_record();
    let (report, step) = grna_report(&doc);
    let fmt = molbiocraft_core::format_thousands;
    let expected = vec![
        format!(
            "Guide list capped: it shows the 40 highest-scoring of the {} candidate guides found.",
            fmt(oracle_candidate_guides(&doc.sequence, true, false).len())
        ),
        format!(
            "Guide list capped: it shows the 25 highest-scoring of the {} candidate guides found.",
            fmt(oracle_candidate_guides(&doc.sequence, false, false).len())
        ),
    ];
    assert_eq!(step.warnings, expected);
    let section = format!("**Warnings**:\n- {}\n- {}", expected[0], expected[1]);
    assert!(
        report.markdown_protocol.contains(&section),
        "the export's Warnings section: {:?}",
        report.markdown_protocol
    );

    // A record short enough that both lists hold every candidate warns about nothing, and its
    // export has no Warnings section at all.
    let short = pipeline_doc(
        "Grna_Counts_150bp",
        &seeded_bases(150, 0x5EED_6A02, b"ACGT"),
        Topology::Linear,
        Vec::new(),
    );
    assert!(
        oracle_candidate_guides(&short.sequence, true, false).len() <= 40
            && oracle_candidate_guides(&short.sequence, false, false).len() <= 25,
        "the short fixture's guide lists are not capped"
    );
    let (short_report, short_step) = grna_report(&short);
    assert_eq!(short_step.warnings, Vec::<String>::new());
    assert!(
        !short_report.markdown_protocol.contains("Warnings"),
        "a report with nothing to warn about writes no Warnings section"
    );
}

/// BG-01M6T6JA/AC3: on a circular record the gRNA step's totals are the circle's own candidates —
/// the number `scan_crispr_guides` reports for it, which is the number the CRISPR tab shows — and
/// not a straight read's.
///
/// Wrong implementations this catches: the shipped straight `find_crispr_guides` (the planted
/// guides across the origin are missing, and the straight count is asserted to differ); a pipeline
/// that reads every record as a circle (the linear 100 kb record of AC1 pins the other side); and
/// the window count taken from a straight read of a circle (the circular oracle's in-window count
/// is asserted too).
#[test]
fn grna_pipeline_reads_a_circular_record_across_its_origin() {
    use molbiocraft_cloning::cloning_crispr::scan_crispr_guides;
    let doc = origin_crossing_plasmid();
    let (report, step) = grna_report(&doc);
    let (win_start, win_end) = ko_window(&report);
    let fmt = molbiocraft_core::format_thousands;

    for (is_spcas9, nuclease, listed, metric) in [
        (true, "SpCas9 (NGG)", 40usize, SPCAS9_METRIC),
        (false, "Cas12a / Cpf1 (TTTV)", 25, CAS12A_METRIC),
    ] {
        let circle = oracle_candidate_guides(&doc.sequence, is_spcas9, true);
        let straight = oracle_candidate_guides(&doc.sequence, is_spcas9, false);
        // The fixture reaches the straight read: a planted guide across the origin on each strand.
        for strand in [1i8, -1] {
            assert!(
                circle.iter().any(|&(_, s, crosses)| crosses && s == strand),
                "{nuclease}: no candidate across the origin on strand {strand}"
            );
        }
        assert!(
            straight.len() < circle.len(),
            "{nuclease}: a straight read of the circle is short of it ({} of {})",
            straight.len(),
            circle.len()
        );
        assert!(
            circle.len() > listed,
            "{nuclease}: the fixture caps the guide list ({} candidates)",
            circle.len()
        );

        // The engine's own scan of the circle — the count the CRISPR tab shows — is the oracle's.
        let scan = scan_crispr_guides(&doc.sequence, nuclease, listed, None, true);
        assert_eq!(scan.candidate_count, circle.len(), "{nuclease}: scan total");
        assert_eq!(scan.guides.len(), listed, "{nuclease}: the list it keeps");
        // And every guide it lists is one of the oracle's, cut site and strand alike, so the cut
        // sites the window count is read over are the ones the engine reports.
        for g in &scan.guides {
            assert!(
                circle
                    .iter()
                    .any(|&(cut, strand, _)| cut == g.cut_position && strand == g.strand),
                "{nuclease}: {} cuts at {} on strand {}, which the oracle does not hold",
                g.name,
                g.cut_position,
                g.strand
            );
        }
        assert!(
            scan_crispr_guides(&doc.sequence, nuclease, listed, None, false).candidate_count
                < scan.candidate_count,
            "{nuclease}: reading the same bases straight gives a different number"
        );

        // And so is the pipeline's.
        let shown = step_metric(&step, metric);
        let total = shown.split(' ').next().unwrap_or_default();
        assert_eq!(total, fmt(scan.candidate_count), "{nuclease}: {shown}");
    }

    let circle = oracle_candidate_guides(&doc.sequence, true, true);
    let in_window = |window: (usize, usize)| -> usize {
        circle
            .iter()
            .filter(|&&(cut, _, _)| (window.0..=window.1).contains(&cut))
            .count()
    };
    assert_eq!(
        step_metric(&step, SPCAS9_METRIC),
        format!(
            "{} ({} in KO window)",
            fmt(circle.len()),
            fmt(in_window((win_start, win_end)))
        )
    );

    // The same circle with a 50-base CDS annotated at its start, so the window the step maps is
    // bases 6..36 and the guide planted across the origin cuts inside it: the window count is read
    // around the origin, not from base 1.
    let at_origin = pipeline_doc(
        "Grna_Origin_window_5kb",
        &doc.sequence,
        Topology::Circular,
        vec![cds_feature(1, 50)],
    );
    let (origin_report, origin_step) = grna_report(&at_origin);
    let origin_window = ko_window(&origin_report);
    assert_eq!(origin_window, (6, 36), "the window at the record's start");
    assert!(
        circle
            .iter()
            .any(|&(cut, _, crosses)| crosses && (origin_window.0..=origin_window.1).contains(&cut)),
        "the fixture's window holds a guide that crosses the origin"
    );
    assert_eq!(
        step_metric(&origin_step, SPCAS9_METRIC),
        format!(
            "{} ({} in KO window)",
            fmt(circle.len()),
            fmt(in_window(origin_window))
        )
    );
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────
// BG-01M7EGF6: the guided pipeline's gRNA-ranking step says what its rank is, whose guides it
// ranks, and decides its verdict from the two numbers it puts on screen.
// ─────────────────────────────────────────────────────────────────────────────────────────────────

/// The CRISPR knockout pipeline's catalogue entry.
fn crispr_pipeline_definition() -> molbiocraft_cloning::PipelineDefinition {
    get_bio_pipeline_catalog()
        .into_iter()
        .find(|d| d.id == "crispr-hdr-knockout")
        .expect("the CRISPR knockout pipeline is in the catalogue")
}

/// A sample-library document by a fragment of its name — the records the workbench ships, read
/// through the shipped `get_sample_library`.
fn sample_doc(name_fragment: &str) -> SequenceDocument {
    get_sample_library()
        .into_iter()
        .find(|d| d.name.contains(name_fragment))
        .unwrap_or_else(|| panic!("no sample document named like {name_fragment:?}"))
}

/// A record whose only two SpCas9 sites are the same 23 bases, so its lead guide's seed has another
/// exact copy: 600 bases of A/T background (which holds no `GG`, no `CC` and no `TTT`, so it offers
/// no PAM of its own to either nuclease) with one 20-nt spacer + `AGG` planted twice.
///
/// Both candidates score a heuristic rank of 90 (a base of 68, +14 for 45 % GC, +8 for the G at
/// spacer position 20) and count one other seed copy, so the rank half of the step's PASS is
/// satisfied and the seed half is the half that decides — the one case the whole sample library
/// cannot reach, since every guide it lists has a unique seed (LC-002).
fn repeated_seed_record() -> SequenceDocument {
    const SITE: &str = "AGACTGACTAGCATGACATGAGG";
    let mut bases: String = "AT".repeat(300);
    for at in [100usize, 400] {
        bases.replace_range(at..at + SITE.len(), SITE);
    }
    pipeline_doc(
        "Grna_Repeat_Seed",
        &bases,
        Topology::Linear,
        vec![cds_feature(1, 600)],
    )
}

/// A record whose one SpCas9 site scores the bare base of the heuristic rank — 68, with no feature
/// of the rule raising or lowering it — and whose seed has no other copy, so it passes on the rank
/// the step asks for and nothing else.
///
/// Its spacer is 35 % GC (neither the 40–65 % raise nor the outside-30–75 % drop), reads A at
/// position 20, T at 16 and C at 4 (none of the three position raises, and not the T-at-20 drop),
/// holds no TTTT run, and its PAM is AGG, not one ending GGG. The whole sample library's lowest
/// lead-guide rank is 79, so without this record the rank half of the step's PASS is a threshold no
/// fixture reaches: raising it from 60 to 70 passed every test in the repo (LC-008).
fn lowest_passing_rank_record() -> SequenceDocument {
    const SITE: &str = "ATTCAGATTGCTGAATCAGAAGG";
    let mut bases: String = "AT".repeat(300);
    bases.replace_range(200..200 + SITE.len(), SITE);
    pipeline_doc(
        "Grna_Rank_68",
        &bases,
        Topology::Linear,
        vec![cds_feature(1, 600)],
    )
}

/// BG-01M7EGF6 AC1: the gRNA-ranking step's rationale is the rule the scorer runs, formatted from
/// the engine's own description of it, and it says whose guides are the ranked ones.
///
/// Wrong implementations this kills — each of them passed every test in the repo before this bug:
/// the shipped sentence "Ranks guides by a rule-of-thumb activity heuristic (GC content, 3' G, no
/// poly-T)…", which calls the rank an activity (the one word US-01M7DVVR AC3/AC5 forbids about this
/// number on every other surface), enumerates three of the six features the scorer reads (five of
/// the spacer and one of its PAM, weighed in seven adjustment arms over the spacer and an eighth
/// for the PAM), and
/// claims to rank "guides" when only the SpCas9 guides are ranked and only the SpCas9 lead guide
/// decides the step's verdict; and any later restatement of the rule beside
/// `crispr_heuristic_rank_description()` instead of from it, which is how those three drifted apart
/// from the scorer in the first place.
#[test]
fn bg_01m7egf6_ac1_the_grna_rationale_reads_the_rule_the_scorer_runs_over_the_spcas9_guides() {
    let (_, step) = grna_report(&sample_doc("pET-28a"));
    let rationale = &step.biological_rationale;

    // Formatted from the engine's own description, word for word, not restated beside it.
    let described = molbiocraft_cloning::reaction_buffers::crispr_heuristic_rank_description();
    assert!(
        rationale.contains(&described),
        "the rationale is not formatted from crispr_heuristic_rank_description():\n  rationale: {rationale}\n  description: {described}"
    );

    // Never an activity, and never the three-feature rule the scorer never ran.
    for retired in ["activity", "Activity", "3' G", "no poly-T", "poly-T"] {
        assert!(
            !rationale.contains(retired),
            "the rationale says {retired:?}, which this number is not: {rationale}"
        );
    }

    // Whose guides are ranked is said wherever the rationale says guides are ranked.
    assert!(
        rationale.contains("Only the SpCas9 guides are ranked"),
        "the rationale does not say that the SpCas9 guides are the ranked ones: {rationale}"
    );
    assert!(
        rationale.contains("Cas12a"),
        "the rationale does not say what becomes of the Cas12a candidates: {rationale}"
    );
    for sentence in sentences(rationale) {
        let claims_a_ranking = sentence.contains("rank") && sentence.contains("guide");
        assert!(
            !claims_a_ranking || sentence.contains("SpCas9"),
            "a sentence ranks guides without saying whose: {sentence:?}"
        );
    }
}

/// The sentences of `text`, as the frontend's own vocabulary guard splits them
/// (`src/__tests__/crisprScoreProvenance.test.tsx`, US-01M7DVVR AC5).
fn sentences(text: &str) -> Vec<&str> {
    text.split_inclusive(|c| matches!(c, '.' | '!' | '?'))
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .collect()
}

/// US-01M7DVVR AC5's rule, applied to one CRISPR surface: a sentence may name a measured quality
/// only to deny it, and the only specificity this engine computes is named for what it counts.
///
/// The denial is the studio's own sentence, so "it is not a trained on-target model" — true, and
/// what the retired rationale said — does not buy the word "activity".
fn assert_no_forbidden_crispr_vocabulary(surface: &str, text: &str) {
    const NOT_A_MEASURED_NUMBER: &str = "not a measured or predicted cutting efficiency";
    const NOT_COMPUTED: &str = "no genome-wide specificity is computed";
    for sentence in sentences(text) {
        let lower = sentence.to_lowercase();
        if lower.contains("activity") || lower.contains("efficien") {
            assert!(
                lower.contains(NOT_A_MEASURED_NUMBER),
                "{surface} calls a heuristic number an activity or an efficiency: {sentence:?}"
            );
        }
        if lower.contains("genome-wide") {
            assert!(
                lower.contains(NOT_COMPUTED) || lower.contains("not evaluated"),
                "{surface} claims something genome-wide: {sentence:?}"
            );
        }
        if lower.contains("specificity") {
            assert!(
                lower.contains("in-sequence")
                    || lower.contains("seed-match")
                    || lower.contains(NOT_COMPUTED)
                    || lower.contains("not evaluated"),
                "{surface} names a specificity without saying what it counts: {sentence:?}"
            );
        }
    }
}

/// BG-01M7EGF6 AC2: US-01M7DVVR AC5's forbidden-vocabulary guard reads every CRISPR surface its
/// words already claim. Its own test reads the Primer & PCR studio's render alone
/// (`src/__tests__/crisprScoreProvenance.test.tsx`), which is why the guided pipeline — the same
/// numbers, worded by the engine — was never held to the criterion that covers it. Here the
/// pipeline's catalogue entry and its gRNA step's every string are inside the guard, read from the
/// shipped `get_bio_pipeline_catalog` and `execute_bio_pipeline_rust` over the whole sample library
/// (LC-003), never from a helper that only a test calls.
///
/// Wrong implementations this kills: putting "activity", "efficiency" or a genome-wide claim back
/// into the rationale, the finding summary, a metric label or a recommendation of this step — none
/// of which failed a test before this bug; and a seed readout renamed to a bare "specificity",
/// which reads as the genome-wide number this engine does not compute.
#[test]
fn bg_01m7egf6_ac2_no_pipeline_crispr_surface_calls_the_heuristic_rank_an_activity() {
    let def = crispr_pipeline_definition();
    assert_no_forbidden_crispr_vocabulary(
        "the CRISPR pipeline's catalogue entry",
        &serde_json::to_string(&def).unwrap(),
    );

    let mut steps_read = 0usize;
    for doc in get_sample_library() {
        let Ok(report) =
            execute_bio_pipeline_rust(&doc, &def.id, "macos", "2026-11-15T00:00:00Z")
        else {
            // A record too short to run the pipeline shows no CRISPR surface at all.
            continue;
        };
        let step = report
            .steps
            .iter()
            .find(|s| s.id == "grna-ranking")
            .expect("the gRNA ranking step");
        let surface = format!("the gRNA step of {}", doc.name);
        // Every string of the step a reader sees, the rationale and the summary among them.
        let all = serde_json::to_string(step).unwrap();
        assert!(
            all.contains(&step.finding_summary.replace('"', "\\\""))
                || all.contains(&step.finding_summary),
            "{surface}: the guard does not read the summary it claims to"
        );
        assert_no_forbidden_crispr_vocabulary(&surface, &all);
        assert_no_forbidden_crispr_vocabulary(&surface, &step.biological_rationale);
        assert_no_forbidden_crispr_vocabulary(&surface, &step.finding_summary);
        steps_read += 1;
    }
    assert!(
        steps_read > 50,
        "the guard read only {steps_read} gRNA steps of the sample library"
    );
}

/// The thresholds the gRNA step states in its own words, parsed out of the sentence a reader reads:
/// the rank it asks of the lead guide, and what it asks that guide's seed count to read.
fn stated_grna_pass_threshold(step: &BioPipelineStepResult) -> (i32, String) {
    let text = &step.biological_rationale;
    let (_, after) = text
        .split_once("heuristic rank is ")
        .unwrap_or_else(|| panic!("the step does not state the rank it asks for: {text}"));
    let (rank, rest) = after
        .split_once(" or more and ")
        .unwrap_or_else(|| panic!("the step does not state both halves of its verdict: {text}"));
    let seed = rest
        .split('"')
        .nth(1)
        .unwrap_or_else(|| panic!("the step does not quote the seed count it asks for: {text}"));
    (
        rank.trim()
            .parse()
            .unwrap_or_else(|e| panic!("the stated rank {rank:?} is no number: {e}")),
        seed.to_string(),
    )
}

/// What the step printed about its lead guide, as the summary prints it: the heuristic rank and the
/// seed count, or `None` where the step found no guide at all.
fn printed_lead_guide_numbers(step: &BioPipelineStepResult) -> Option<(i32, String)> {
    let (_, after) = step.finding_summary.split_once("(heuristic rank ")?;
    let (rank, rest) = after.split_once(", ").expect("the summary's own format");
    let (seed, _) = rest.split_once(')').expect("the summary's own format");
    Some((rank.parse().expect("the printed rank is a number"), seed.to_string()))
}

/// BG-01M7EGF6 AC3: the step's PASS/WARN is decided only by numbers the step puts on screen.
///
/// The retired seed half was `specificity_score >= 70`, a threshold on the `100 / (1 + matches)`
/// percentage BG-01M7E61C took off the screen when it made the readout a seed count: a user who saw
/// WARN beside "2 seed matches" had no number on screen that explained it. The two formulations are
/// exactly equivalent (`round(100 / (1 + off)) >= 70` iff `off == 0`), which this test records over
/// every guide the sample library's own scans list, so the repair is shown to move no verdict.
///
/// Wrong implementations this kills: a seed threshold the step's words do not follow (the status is
/// re-derived from the printed numbers and the stated threshold alone, so `off <= 1` beside a
/// sentence asking for "no other seed copy" fails); and dropping the seed half altogether, which
/// the repeated-seed record catches — its lead guide ranks 90, above the rank half, and WARNs only
/// because its seed has another copy.
#[test]
fn bg_01m7egf6_ac3_the_grna_verdict_reads_the_seed_count_the_step_shows() {
    // 1. The two formulations agree over every guide the sample library's scans list, on both
    //    sides of the threshold: `off == 0` and `off > 0` are both reached here.
    let mut with_other_copies = 0usize;
    let mut guides_read = 0usize;
    for doc in get_sample_library() {
        let circular = doc.topology == Topology::Circular;
        let clean: String = doc.sequence.chars().filter(|c| c.is_ascii_alphabetic()).collect();
        for nuclease in ["SpCas9 (NGG)", "Cas12a / Cpf1 (TTTV)"] {
            let scan = molbiocraft_cloning::cloning_crispr::scan_crispr_guides(
                &clean, nuclease, 4_000, None, circular,
            );
            for g in &scan.guides {
                assert_eq!(
                    g.specificity_score >= 70,
                    g.off_target_count == 0,
                    "{} {nuclease}: the retired percentage and the shown count disagree (specificity {}, {} other copies)",
                    doc.name,
                    g.specificity_score,
                    g.off_target_count
                );
                guides_read += 1;
                if g.off_target_count > 0 {
                    with_other_copies += 1;
                }
            }
        }
    }
    assert!(guides_read > 1_000, "only {guides_read} guides were read");
    assert!(
        with_other_copies > 0,
        "no guide of the sample library has another seed copy, so the record is one-sided"
    );

    // 2. Every verdict the step reaches is the verdict its own printed numbers and its own stated
    //    threshold give, over the sample library and over a record whose lead guide's seed repeats.
    let mut seen_pass = 0usize;
    let mut seen_warn_on_the_seed_half = 0usize;
    let mut seen_action_required = 0usize;
    let mut docs: Vec<SequenceDocument> = get_sample_library();
    docs.push(repeated_seed_record());
    docs.push(lowest_passing_rank_record());
    for doc in docs {
        let Ok(report) =
            execute_bio_pipeline_rust(&doc, "crispr-hdr-knockout", "linux", "2026-11-15T00:00:00Z")
        else {
            continue;
        };
        let step = report
            .steps
            .iter()
            .find(|s| s.id == "grna-ranking")
            .expect("the gRNA ranking step");
        let (min_rank, pass_seed) = stated_grna_pass_threshold(step);
        match printed_lead_guide_numbers(step) {
            None => {
                assert_eq!(
                    step.status, "ACTION_REQUIRED",
                    "{}: no lead guide, but the step is not ACTION_REQUIRED",
                    doc.name
                );
                seen_action_required += 1;
            }
            Some((rank, seed)) => {
                let expected = if rank >= min_rank && seed == pass_seed { "PASS" } else { "WARN" };
                assert_eq!(
                    step.status, expected,
                    "{}: the step is {} where its own numbers (rank {rank}, {seed:?}) and its own threshold (rank {min_rank} or more, {pass_seed:?}) say {expected}",
                    doc.name, step.status
                );
                if expected == "PASS" {
                    seen_pass += 1;
                } else if rank >= min_rank {
                    seen_warn_on_the_seed_half += 1;
                }
            }
        }
    }
    assert!(seen_pass > 0 && seen_action_required > 0, "PASS {seen_pass}, none {seen_action_required}");
    assert!(
        seen_warn_on_the_seed_half > 0,
        "no record WARNs on the seed half alone, so the seed half is untested"
    );

    // 3. Both halves of the stated threshold are thresholds a record reaches, so neither is a
    //    number a reader is told and no fixture holds: a lead guide ranking the rule's bare base of
    //    68 with no other seed copy passes.
    let (_, lowest) = grna_report(&lowest_passing_rank_record());
    let (lowest_rank, lowest_seed) = printed_lead_guide_numbers(&lowest).expect("a lead guide");
    assert_eq!(
        (lowest_rank, lowest_seed.as_str()),
        (68, "no other seed copy"),
        "the record no longer reaches the rank it was built for: {}",
        lowest.finding_summary
    );
    assert_eq!(
        lowest.status, "PASS",
        "a lead guide ranking 68 with no other seed copy does not pass: {}",
        lowest.finding_summary
    );

    // 4. The threshold is stated in the words the summary prints, so the two cannot drift: the
    //    phrase the step asks for is the phrase a passing step printed.
    let (_, passing) = grna_report(&sample_doc("pET-28a"));
    assert_eq!(passing.status, "PASS", "the pET-28a fixture reaches the PASS branch");
    let (_, pass_seed) = stated_grna_pass_threshold(&passing);
    let (_, printed_seed) = printed_lead_guide_numbers(&passing).expect("a lead guide");
    assert_eq!(
        printed_seed, pass_seed,
        "the step asks for a seed count it does not print: {}",
        passing.finding_summary
    );
}

/// FNV-1a 64 of `s` as 16 hex digits: a fingerprint that is the same on every run and every
/// machine, which `std`'s own hashers do not promise to be.
fn fingerprint(s: &str) -> String {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for b in s.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    format!("{h:016x}")
}

/// Everything a reader of a pipeline report sees except the one sentence BG-01M7EGF6 AC1 rewrites:
/// the overall verdict and readiness score, every step's status, finding summary, metrics,
/// artifacts, recommendations, warnings and highlight, every visual zone, and the Markdown export
/// with its "Why this matters" rationale lines (one per step) dropped.
fn reader_visible_snapshot(report: &BioPipelineExecutionReport) -> String {
    let mut out = format!(
        "{} {} {}\n",
        report.overall_status, report.readiness_score, report.sequence_length_bp
    );
    for s in &report.steps {
        out.push_str(&format!(
            "step {} {} [{}] {} -> {}/{}\n  {}\n",
            s.step_number, s.id, s.status, s.title, s.target_studio, s.target_studio_label, s.finding_summary
        ));
        for m in &s.metrics {
            out.push_str(&format!(
                "  metric {} = {} [{}]\n",
                m.label,
                m.value,
                m.tone.as_deref().unwrap_or("-")
            ));
        }
        for a in &s.artifacts {
            out.push_str(&format!("  artifact {} {} {}\n", a.label, a.sequence, a.note));
        }
        for r in &s.recommendations {
            out.push_str(&format!("  recommend {r}\n"));
        }
        for w in &s.warnings {
            out.push_str(&format!("  warn {w}\n"));
        }
        if let Some(h) = &s.highlight_range {
            out.push_str(&format!("  highlight {}..{} {}\n", h.start, h.end, h.label));
        }
    }
    for z in &report.visual_zones {
        out.push_str(&format!(
            "zone {} {} {} [{}] {}..{} strand {:?} {} -> {}\n",
            z.id, z.track, z.label, z.status, z.start, z.end, z.strand, z.color, z.target_studio
        ));
    }
    const RATIONALE: &str = "> **Why this matters**: ";
    let rationale_lines = report
        .markdown_protocol
        .lines()
        .filter(|l| l.starts_with(RATIONALE))
        .count();
    assert_eq!(
        rationale_lines,
        report.steps.len(),
        "the export does not carry one rationale line per step, so dropping them drops something else"
    );
    for line in report.markdown_protocol.lines().filter(|l| !l.starts_with(RATIONALE)) {
        out.push_str(line);
        out.push('\n');
    }
    out
}

/// BG-01M7EGF6 AC4: no verdict and no number a user reads changes. The fingerprint below is of
/// every pipeline's whole reader-visible report over the whole sample library — each step's status,
/// finding summary, metrics, artifacts, recommendations, warnings and highlight, every visual zone,
/// the overall verdict and readiness score, and the Markdown export — taken at the run's base
/// revision, before the verdict's seed half and the gRNA rationale were touched, and excluding only
/// the rationale sentence AC1 rewrites.
///
/// Regenerate it (and say in the commit why it moved) with:
/// `BG_01M7EGF6_AC4=print cargo test -p molbiocraft-cloning cloning_pipelines -- --nocapture`
///
/// Wrong implementations this kills: a seed threshold that moves a PASS to a WARN (`off <= 1` on
/// this library moves none, but `off >= 1` or a rank threshold change moves many), and any edit to
/// the step's numbers or wording smuggled in beside the one sentence this bug rewrites.
const BG_01M7EGF6_AC4_READER_VISIBLE: [(&str, &str); 4] = [
    ("cloning-expression-qc", "42f64ead527cdced"),
    ("crispr-hdr-knockout", "48ee426c46530b6e"),
    ("multihost-protein-mrna", "b86e224078c60f5f"),
    ("viral-twist-onboarding", "b355cabe03450c44"),
];

#[test]
fn cloning_pipelines_show_the_same_verdicts_and_numbers_as_before_bg_01m7egf6() {
    let printing = std::env::var("BG_01M7EGF6_AC4").as_deref() == Ok("print");
    let mut taken: Vec<(String, String)> = Vec::new();
    for (pipeline, _) in BG_01M7EGF6_AC4_READER_VISIBLE {
        let mut whole = String::new();
        let mut reports = 0usize;
        for doc in get_sample_library() {
            whole.push_str(&format!("=== {} / {}\n", doc.name, pipeline));
            match execute_bio_pipeline_rust(&doc, pipeline, "macos", "2026-11-15T00:00:00Z") {
                Ok(report) => {
                    whole.push_str(&reader_visible_snapshot(&report));
                    reports += 1;
                }
                // A refusal is a reader-visible answer too, and it is pinned as one (LC-006).
                Err(e) => whole.push_str(&format!("refused: {e}\n")),
            }
        }
        assert!(reports > 50, "{pipeline} ran on only {reports} sample records");
        taken.push((pipeline.to_string(), fingerprint(&whole)));
    }
    if printing {
        for (pipeline, print) in &taken {
            println!("    (\"{pipeline}\", \"{print}\"),");
        }
        return;
    }
    let expected: Vec<(String, String)> = BG_01M7EGF6_AC4_READER_VISIBLE
        .iter()
        .map(|(p, f)| (p.to_string(), f.to_string()))
        .collect();
    assert_eq!(
        taken, expected,
        "a verdict or a number a user reads moved; regenerate with BG_01M7EGF6_AC4=print and say what moved"
    );
}
