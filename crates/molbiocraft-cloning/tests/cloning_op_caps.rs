// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1Q9: three cloning operations read only the first bases or the first few items of
//! their input and said nothing about the rest - the silent-mutation scan stopped at the first
//! 3,600 bases of a coding sequence, the annotation extraction at 12 features, and the
//! multi-host codon pipeline harmonized the document's first 1,800 bases rather than its gene.
//!
//! Every count here is checked against a direct count written in this file: its own standard
//! genetic code, its own window arithmetic, and the catalog's recognition sites as data, with
//! nothing taken from the engine's scanner. The fixtures are generated from fixed seeds.

use molbiocraft_cloning::batch_ops::MAX_EXTRACTED_FEATURE_DOCUMENTS;
use molbiocraft_cloning::{
    analyze_silent_mutations, analyze_silent_mutations_in_cds, execute_bio_pipeline_rust,
    extract_annotated_features_to_documents, get_rebase_enzymes, CodingRegion1Based,
};
use molbiocraft_core::types::{
    FeatureSegment, MoleculeType, SequenceDocument, SequenceFeature, Topology,
};
use molbiocraft_protein::optimize_codons_for_host;
use molbiocraft_protein::translation_orf::codon_adaptation_index;

// ─── The standard genetic code, written here ───

/// NCBI translation table 1, amino acids in TCAG x TCAG x TCAG codon order.
const TABLE_1: &str = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";

/// The amino acid `codon` codes for, `*` for a stop and `X` for anything unreadable.
fn amino_acid(codon: &str) -> char {
    let index = |b: u8| match b.to_ascii_uppercase() {
        b'T' | b'U' => Some(0usize),
        b'C' => Some(1),
        b'A' => Some(2),
        b'G' => Some(3),
        _ => None,
    };
    let b = codon.as_bytes();
    if b.len() != 3 {
        return 'X';
    }
    match (index(b[0]), index(b[1]), index(b[2])) {
        (Some(i), Some(j), Some(k)) => TABLE_1.as_bytes()[16 * i + 4 * j + k] as char,
        _ => 'X',
    }
}

/// `seq` translated in frame 1 until its first stop, as a codon optimizer reads a CDS.
fn translate_to_stop(seq: &str) -> String {
    seq.as_bytes()
        .chunks_exact(3)
        .map(|c| amino_acid(std::str::from_utf8(c).unwrap_or("NNN")))
        .take_while(|&a| a != '*')
        .collect()
}

fn complement(b: u8) -> u8 {
    match b.to_ascii_uppercase() {
        b'A' => b'T',
        b'T' | b'U' => b'A',
        b'C' => b'G',
        b'G' => b'C',
        other => other,
    }
}

fn reverse_complement(seq: &str) -> String {
    seq.bytes().rev().map(|b| complement(b) as char).collect()
}

// ─── Seeded fixtures ───

/// xorshift64* draws from a fixed seed.
fn draws(seed: u64) -> impl FnMut() -> u64 {
    let mut s = seed;
    move || {
        s ^= s >> 12;
        s ^= s << 25;
        s ^= s >> 27;
        s.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
}

fn random_dna(len: usize, seed: u64) -> String {
    let mut next = draws(seed);
    (0..len).map(|_| b"ACGT"[(next() >> 33) as usize % 4] as char).collect()
}

/// A coding sequence of `codons` codons: ATG, then random sense codons (no stop inside), then TAA.
fn random_cds(codons: usize, seed: u64) -> String {
    let mut next = draws(seed);
    let mut out = String::with_capacity(codons * 3);
    out.push_str("ATG");
    while out.len() < (codons - 1) * 3 {
        let c: String = (0..3).map(|_| b"ACGT"[(next() >> 33) as usize % 4] as char).collect();
        if amino_acid(&c) != '*' {
            out.push_str(&c);
        }
    }
    out.push_str("TAA");
    out
}

// ─── The direct silent-mutation count ───

/// One candidate as this file derives it: the codon (1-based), the enzyme, and the 1-based
/// position its new site starts at in the coding sequence.
#[derive(Debug, PartialEq, Eq, Clone)]
struct DirectCandidate {
    codon_number: usize,
    enzyme: String,
    position_bp: usize,
}

/// Every silent-mutation candidate of `cds`, read in frame from its first base, derived here:
/// for each codon from the second to the third from last, each single-base change at the third
/// or first base of the codon that leaves the amino acid unchanged, and each enzyme whose
/// exactly-spelled recognition site of 6 bp or more appears in the mutated window
/// `[codon start - 8, codon start + 11)` while the wild-type window holds none of it. The order
/// is codon, then the third base before the first, then A, C, G, T, then catalog order.
fn direct_silent_candidates(cds: &str) -> Vec<DirectCandidate> {
    let sites: Vec<(String, String)> = get_rebase_enzymes()
        .into_iter()
        .filter(|e| {
            e.recognition_seq.len() >= 6
                && e.recognition_seq.bytes().all(|b| matches!(b, b'A' | b'C' | b'G' | b'T'))
        })
        .map(|e| (e.name, e.recognition_seq))
        .collect();
    let s = cds.as_bytes();
    let num_codons = s.len() / 3;
    let mut out = Vec::new();
    for codon_idx in 1..num_codons.saturating_sub(2) {
        let pos0 = codon_idx * 3;
        let wt_codon = &cds[pos0..pos0 + 3];
        let wt_aa = amino_acid(wt_codon);
        if wt_aa == '*' || wt_aa == 'X' {
            continue;
        }
        let win_start = pos0.saturating_sub(8);
        let win_end = (pos0 + 11).min(s.len());
        let wt_window = &cds[win_start..win_end];
        for offset in [2usize, 0usize] {
            for &alt in b"ACGT" {
                if alt == wt_codon.as_bytes()[offset] {
                    continue;
                }
                let mut codon = wt_codon.as_bytes().to_vec();
                codon[offset] = alt;
                let mut_codon = String::from_utf8(codon).unwrap();
                if amino_acid(&mut_codon) != wt_aa {
                    continue;
                }
                let mut window = wt_window.as_bytes().to_vec();
                window[pos0 + offset - win_start] = alt;
                let mut_window = String::from_utf8(window).unwrap();
                for (name, site) in &sites {
                    if wt_window.contains(site.as_str()) {
                        continue;
                    }
                    if let Some(at) = mut_window.find(site.as_str()) {
                        out.push(DirectCandidate {
                            codon_number: codon_idx + 1,
                            enzyme: name.clone(),
                            position_bp: win_start + at + 1,
                        });
                    }
                }
            }
        }
    }
    out
}

// ─── AC1: the silent-mutation scan reads the whole CDS ───

/// Two 4,500 bp genes, one on each strand, are read to their last codon: the scan's
/// `totalCandidates` is every candidate a direct count finds in both, the listed candidates are
/// the first of them, and candidates are offered in the 3' end of each gene - past base 3,600,
/// where the scan used to stop.
#[test]
fn silent_sites_cover_the_whole_cds() {
    let plus = random_cds(1_500, 0x5EED_01C9);
    let minus = random_cds(1_500, 0x5EED_02C9);
    assert_eq!((plus.len(), minus.len()), (4_500, 4_500));
    let left = random_dna(600, 0x33);
    let middle = random_dna(300, 0x44);
    let right = random_dna(600, 0x55);
    let construct = format!("{left}{plus}{middle}{}{right}", reverse_complement(&minus));
    let regions = vec![
        CodingRegion1Based {
            name: "plus_gene".into(),
            start: left.len() + 1,
            end: left.len() + plus.len(),
            strand: 1,
        },
        CodingRegion1Based {
            name: "minus_gene".into(),
            start: left.len() + plus.len() + middle.len() + 1,
            end: left.len() + plus.len() + middle.len() + minus.len(),
            strand: -1,
        },
    ];

    // The direct count over each gene's whole length, and the share of it the old 3,600-base stop
    // could never have reached.
    let direct_plus = direct_silent_candidates(&plus);
    let direct_minus = direct_silent_candidates(&minus);
    let total = direct_plus.len() + direct_minus.len();
    let past_3600 = direct_plus.iter().chain(&direct_minus).filter(|c| c.position_bp > 3_600).count();
    assert!(total > 400, "the fixture holds plenty of candidates: {total}");
    assert!(past_3600 > 20, "and {past_3600} of them past base 3,600, where the scan stopped");

    // The complete total, with a short list: the first 24 candidates and one sentence saying so.
    let listed = 24;
    let capped = analyze_silent_mutations_in_cds(&construct, &regions, listed);
    assert_eq!(capped.total_candidates, total, "every candidate in both genes is counted");
    assert_eq!(capped.candidates.len(), listed);
    assert_eq!(
        capped.warnings,
        vec![format!(
            "Silent-mutation list capped: it shows the first 24 of the {} candidates found over the whole length of 2 annotated CDS.",
            molbiocraft_core::format_thousands(total)
        )]
    );

    // Asked for every candidate: the same total, the whole list, no warning, and the candidates in
    // the order and at the coding-sequence positions the direct count gives.
    let full = analyze_silent_mutations_in_cds(&construct, &regions, total + 1);
    assert_eq!((full.total_candidates, full.candidates.len()), (total, total));
    assert!(full.warnings.is_empty(), "nothing is left out: {:?}", full.warnings);
    let plus_hits: Vec<DirectCandidate> = full
        .candidates
        .iter()
        .filter(|c| c.cds_name.as_deref() == Some("plus_gene"))
        .map(|c| DirectCandidate {
            codon_number: c.codon_number,
            enzyme: c.enzyme_name.clone(),
            // back to the gene's own coordinates (the gene starts at `left.len() + 1`)
            position_bp: c.position_bp - left.len(),
        })
        .collect();
    assert_eq!(plus_hits, direct_plus, "the plus-strand gene, candidate for candidate");
    let minus_hits: Vec<(usize, String)> = full
        .candidates
        .iter()
        .filter(|c| c.cds_name.as_deref() == Some("minus_gene"))
        .map(|c| (c.codon_number, c.enzyme_name.clone()))
        .collect();
    let minus_direct: Vec<(usize, String)> =
        direct_minus.iter().map(|c| (c.codon_number, c.enzyme.clone())).collect();
    assert_eq!(minus_hits, minus_direct, "the minus-strand gene, candidate for candidate");

    // The last codon of each gene is reached: a candidate past base 3,600 is listed for both.
    for gene in ["plus_gene", "minus_gene"] {
        let last = full
            .candidates
            .iter()
            .filter(|c| c.cds_name.as_deref() == Some(gene))
            .map(|c| (c.codon_number - 1) * 3 + 1)
            .max()
            .unwrap_or(0);
        assert!(last > 3_600, "{gene} is read past base 3,600: last candidate at {last}");
    }

    // The frame-1 scan of a bare coding sequence reads it whole too.
    let bare = analyze_silent_mutations(&plus, total + 1);
    assert_eq!(bare.len(), direct_plus.len());
    assert!(
        bare.iter().map(|c| c.position_bp).max().unwrap_or(0) > 3_600,
        "a bare coding sequence is read past base 3,600"
    );
}

// ─── AC2: the extraction returns every feature, or leaves a stated number out ───

fn feature(id: &str, name: &str, feature_type: &str, start: usize, end: usize, strand: i8) -> SequenceFeature {
    SequenceFeature {
        id: id.into(),
        name: name.into(),
        feature_type: feature_type.into(),
        start,
        end,
        strand,
        color: "#2563eb".into(),
        notes: None,
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    }
}

fn dna_doc(name: &str, sequence: String, topology: Topology) -> SequenceDocument {
    SequenceDocument {
        id: format!("doc-{name}"),
        name: name.into(),
        sequence,
        topology,
        molecule_type: MoleculeType::DNA,
        ..Default::default()
    }
}

/// A 50-feature record gives 50 feature documents, where it used to give 12; a record annotated
/// with more features than one extraction creates documents for gives exactly that many, so the
/// number left out is the record's feature count less the documents returned.
#[test]
fn extraction_returns_every_feature_or_the_count_left() {
    let seq = random_dna(20_000, 0x5EED_0050);
    let mut fifty = dna_doc("Fifty_Features", seq.clone(), Topology::Circular);
    fifty.features = (0..50)
        .map(|i| {
            let start = 1 + i * 300;
            feature(
                &format!("f{i}"),
                &format!("feat_{i:02}"),
                if i % 3 == 0 { "CDS" } else { "misc_feature" },
                start,
                start + 119,
                if i % 2 == 0 { 1 } else { -1 },
            )
        })
        .collect();
    // One spliced feature and one across the origin, the two shapes whose bases are not one slice.
    fifty.features[7] = feature("f7", "feat_07", "misc_feature", 2_101, 2_460, 1);
    fifty.features[7].segments = Some(vec![
        FeatureSegment { index: 1, name: "e1".into(), start: 2_101, end: 2_150, color: "#2563eb".into() },
        FeatureSegment { index: 2, name: "e2".into(), start: 2_401, end: 2_460, color: "#2563eb".into() },
    ]);
    fifty.features[11] = feature("f11", "wrap_feat", "misc_feature", 19_951, 40, 1);

    let out = extract_annotated_features_to_documents(&fifty, "all");
    assert_eq!(out.len(), 50, "every annotated feature, not the first 12");
    assert_eq!(
        out.iter().map(|d| d.features[0].name.clone()).collect::<Vec<_>>(),
        fifty.features.iter().map(|f| f.name.clone()).collect::<Vec<_>>(),
        "in the record's own feature order"
    );
    // The bases of a plain feature, a spliced one, one across the origin, and a minus-strand one.
    assert_eq!(out[0].sequence, seq[..120]);
    assert_eq!(out[7].sequence, format!("{}{}", &seq[2_100..2_150], &seq[2_400..2_460]));
    assert_eq!(out[11].sequence, format!("{}{}", &seq[19_950..], &seq[..40]));
    assert_eq!(out[1].sequence, reverse_complement(&seq[300..420]));

    // Six more features than one extraction returns documents for: exactly the cap comes back, and
    // the caller states the six that did not (src/App.tsx prints that count).
    let over = MAX_EXTRACTED_FEATURE_DOCUMENTS + 6;
    let genome = random_dna(over * 20 + 200, 0x5EED_0600);
    let mut many = dna_doc("Many_Features", genome, Topology::Linear);
    many.features = (0..over)
        .map(|i| feature(&format!("g{i}"), &format!("gene_{i:05}"), "CDS", 1 + i * 20, 1 + i * 20 + 59, 1))
        .collect();
    let capped = extract_annotated_features_to_documents(&many, "all");
    assert_eq!(capped.len(), MAX_EXTRACTED_FEATURE_DOCUMENTS);
    assert_eq!(many.features.len() - capped.len(), 6, "the number left out");
    assert_eq!(capped.last().unwrap().features[0].name, format!("gene_{:05}", MAX_EXTRACTED_FEATURE_DOCUMENTS - 1));
}

// ─── AC3: the pipeline's CAI is computed on the CDS ───

/// The value of the metric labelled `label` in the pipeline step `step_id`.
fn metric(report: &molbiocraft_cloning::BioPipelineExecutionReport, step_id: &str, label: &str) -> String {
    let step = report
        .steps
        .iter()
        .find(|s| s.id == step_id)
        .unwrap_or_else(|| panic!("no {step_id} step: {:?}", report.steps.iter().map(|s| &s.id).collect::<Vec<_>>()));
    step.metrics
        .iter()
        .find(|m| m.label == label)
        .unwrap_or_else(|| panic!("no \"{label}\" metric: {:?}", step.metrics.iter().map(|m| &m.label).collect::<Vec<_>>()))
        .value
        .clone()
}

const HOSTS: [(&str, &str); 3] = [
    ("ecoli_k12", "E. coli BL21/K12 Optimization"),
    ("human_hek293", "Human HEK293/CHO Optimization"),
    ("yeast_scerevisiae", "S. cerevisiae Optimization"),
];

/// The harmonized candidates and their CAI come from the document's gene - the whole CDS, on its
/// own strand, its exons joined - and not from the document's first 1,800 bases.
#[test]
fn pipeline_cai_uses_the_cds() {
    // 6 kb plasmid; the gene sits on the minus strand at 3,001..4,500, so the first 1,800 bases
    // the step used to read are backbone, and reading the plus strand gives another protein.
    let gene = random_cds(500, 0x5EED_CA1);
    assert_eq!(gene.len(), 1_500);
    let backbone = random_dna(6_000, 0x5EED_BB1);
    let sequence = format!("{}{}{}", &backbone[..3_000], reverse_complement(&gene), &backbone[4_500..]);
    let mut doc = dna_doc("CAI_Plasmid", sequence.clone(), Topology::Circular);
    doc.features = vec![
        feature("f-ori", "ori", "rep_origin", 1, 600, 1),
        feature("f-gene", "target_gene", "CDS", 3_001, 4_500, -1),
    ];

    let report = execute_bio_pipeline_rust(&doc, "multihost-protein-mrna", "linux", "2026-11-07T00:00:00Z").unwrap();
    assert_eq!(
        metric(&report, "multihost-cai", "Coding Sequence Read"),
        "CDS \"target_gene\" (1,500 bp, 3,001..4,500, - strand)"
    );

    // The gene this file reads from the document, on its own strand: exactly the bases planted.
    let read_here = reverse_complement(&sequence[3_000..4_500]);
    assert_eq!(read_here, gene);
    let old_slice = &sequence[..1_800];

    // The gene's own adaptation, each host read from the gene this file derived (not from the
    // document's first bases, which give other numbers).
    let as_written = |seq: &str| {
        format!(
            "{:.2} / {:.2} / {:.2}",
            codon_adaptation_index(seq, "ecoli_k12"),
            codon_adaptation_index(seq, "human_hek293"),
            codon_adaptation_index(seq, "yeast_scerevisiae")
        )
    };
    assert_eq!(
        metric(&report, "multihost-cai", "CDS CAI As Written (E. coli / Human / Yeast)"),
        as_written(&read_here)
    );
    assert_ne!(as_written(old_slice), as_written(&read_here), "the fixture tells the two apart");

    for (host, label) in HOSTS {
        let on_cds = optimize_codons_for_host(&read_here, true, host);
        let on_first_1800 = optimize_codons_for_host(old_slice, true, host);
        assert_eq!(
            metric(&report, "multihost-cai", label),
            format!("CAI {:.2} ({:.1}% GC)", on_cds.cai_score, on_cds.gc_percent),
            "{host} is harmonized from the CDS"
        );
        assert_ne!(
            format!("CAI {:.2} ({:.1}% GC)", on_first_1800.cai_score, on_first_1800.gc_percent),
            format!("CAI {:.2} ({:.1}% GC)", on_cds.cai_score, on_cds.gc_percent),
            "{host}: the fixture tells the CDS and the first 1,800 bases apart"
        );
        // The protein harmonized is the whole CDS translated here, stop and all.
        assert_eq!(on_cds.protein_sequence, translate_to_stop(&gene));
        assert_eq!(on_cds.protein_sequence.len(), 499, "every codon of the gene but its stop");
        // An independent CAI of the designed sequence (Sharp & Li 1987, computed by a different
        // path than the optimizer's running product) agrees with the reported one.
        assert!(
            (codon_adaptation_index(&on_cds.optimized_dna, host) - on_cds.cai_score).abs() < 0.002,
            "{host}: reported CAI {} against an independent {}",
            on_cds.cai_score,
            codon_adaptation_index(&on_cds.optimized_dna, host)
        );
    }

    // A spliced gene: the exons alone are harmonized, in their stored order, and the metric names
    // the join. The intron here shifts the frame, so reading the whole span gives another protein.
    let exon1 = &gene[..600];
    let exon2 = &gene[600..];
    let intron = random_dna(401, 0x5EED_0147);
    let spliced_seq = format!("{}{exon1}{intron}{exon2}{}", &backbone[..1_000], &backbone[2_902..]);
    let mut spliced = dna_doc("Spliced_Gene", spliced_seq.clone(), Topology::Linear);
    let mut cds = feature("f-spliced", "split_gene", "CDS", 1_001, 1_000 + 600 + 401 + 900, 1);
    cds.segments = Some(vec![
        FeatureSegment { index: 1, name: "exon 1".into(), start: 1_001, end: 1_600, color: "#2563eb".into() },
        FeatureSegment { index: 2, name: "exon 2".into(), start: 2_002, end: 2_901, color: "#2563eb".into() },
    ]);
    spliced.features = vec![cds];
    let spliced_report = execute_bio_pipeline_rust(&spliced, "multihost-protein-mrna", "linux", "2026-11-07T00:00:00Z").unwrap();
    assert_eq!(
        metric(&spliced_report, "multihost-cai", "Coding Sequence Read"),
        "CDS \"split_gene\" (1,500 bp, join(1,001..1,600,2,002..2,901), + strand)"
    );
    let exons = format!("{exon1}{exon2}");
    assert_eq!(exons, gene);
    for (host, label) in HOSTS {
        let on_exons = optimize_codons_for_host(&exons, true, host);
        let on_span = optimize_codons_for_host(&spliced_seq[1_000..2_901], true, host);
        assert_eq!(
            metric(&spliced_report, "multihost-cai", label),
            format!("CAI {:.2} ({:.1}% GC)", on_exons.cai_score, on_exons.gc_percent),
            "{host} is harmonized from the exons"
        );
        assert_ne!(
            on_span.protein_sequence, on_exons.protein_sequence,
            "{host}: the fixture tells the exons and the whole span apart"
        );
    }
}
