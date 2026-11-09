// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The sample library's documents.
//!
//! # Public sources (US-01M6TDFV, BG-01M6WB0V)
//!
//! The sequencing primers, protein records, yadF clone and genome records are taken from public
//! records, and `src/__tests__/sampleScientificAccuracy.test.ts` checks each one against the record
//! it cites, as `scripts/outside-data/fetch.sh` fetches it. None of them carries another program's
//! document data: no Created, Modified or Designed With field, no copied Tm or %GC, and a
//! `created_at`/`updated_at` of MolBioCraft's own ([`SOURCED_ON`]).
//!
//! * **Sequencing primers** (`doc-primer-seq-*`). Each names its record in a `Source record` field.
//!   VF2, VR and the five M13 primers equal their iGEM Registry parts (BBa_G00100, BBa_G00101,
//!   BBa_G00103 to BBa_G00107; CC BY 4.0, `NOTICE` section 6). The T7, T3 and SP6 promoter primers
//!   are held exactly by the phage genomes NC_001604, NC_003298 and NC_004831. Tm and %GC are
//!   MolBioCraft's own, from `calculate_primer_metrics` at the app's default conditions (50 mM Na+,
//!   1.5 mM Mg2+, 250 nM oligo). What changed against the copies these documents held before:
//!   * M13-R (-26) cites its own part, BBa_G00104. It cited BBa_G00103, M13-F (-20)'s part.
//!   * T3 promoter (24bp) was GCGCGAAATTAACCCTCACTAAAG, which NC_003298 holds on neither strand:
//!     only its last 18 bases occur there, so its first six are not the phage's. It is corrected to
//!     GTTTCTAATTAACCCTCACTAAAG, bases 20,727-20,750 of NC_003298, whose last 18 bases are the
//!     start of that record's phi10 promoter (20,733-20,755).
//!   * T3 promoter (20pb) is named T3 promoter (20bp).
//!   * The ids are `doc-primer-seq-*`, and the copied Hairpin Tm and Self Dimer Tm fields are gone.
//!   * The other ten primers' sequences were already their records' and are unchanged.
//! * **Design primers** (`doc-primer-cmv-fwd`, `-ef1a-fwd`, `-bgh-rev`, `-wpre-rev`, `-16s-27f`,
//!   `-16s-1492r`, `-gibson-mch-fwd`). None of the seven stores a Tm, hairpin or primer-dimer
//!   energy any more (BG-01M6WB0V): those figures had no recorded origin, and MolBioCraft computes
//!   all three from the oligo itself - `primerRecordFromDoc` puts them on the record it builds from
//!   a saved primer document, and the Primer & PCR Studio's oligo analyzer shows them for any
//!   oligo. What each one carries instead:
//!   * `%GC Primer Bind` is MolBioCraft's own, from [`design_primer_gc`] over the binding region.
//!     Three of the stored figures disagreed with it: 27F read 47.5% and 1492R 43.2%, which are
//!     9.5/20 and 9.5/22 - the one degenerate base (M, Y) counted as half a G or C - where
//!     MolBioCraft counts G and C only (45.0% and 40.9%); the Gibson oligo read 63.2%, which is
//!     12/19, over neither its 21-nt core (61.9%) nor the 38-nt full oligo (65.8%).
//!   * CMV_IE_Enhancer_Fwd, EF1a_IntronA_Seq_Fwd and WPRE_3Prime_Verify_Rev name, in a
//!     `Source record` field, a public record that holds the oligo exactly on one strand, as the
//!     sequencing primers do: X17403.1, NC_000006.12 and J04514.1, at the coordinates the field
//!     gives.
//!   * bGH_PolyA_Reverse, 16S_rRNA_27F_Universal and 16S_rRNA_1492R_Universal name, in a
//!     `Source publication` field, a paper that prints the oligo verbatim. bGH_PolyA_Reverse is
//!     the standard BGH-R vector primer, and no Bos taurus record was found to hold it: a `core_nt`
//!     BLAST of the 18-mer returns synthetic vector constructs, not a cattle record, and it is
//!     absent from both strands of the GH1 locus of NC_037346.1 (48,115,000-48,123,000). So a paper
//!     is its source here, not a genome.
//!   * Gibson_pET28_NdeI_mCherry_Fwd is labelled `Provenance: MolBioCraft example design`, with no
//!     cited source. It is a two-part construction - the pET-28a(+) thrombin-site/NdeI junction
//!     (CGCGCGGCAGCCATATG, which this file's own pET-28a(+)-eGFP sample carries at 5,117-5,133)
//!     followed by mCherry codons 2-8 (GTGAGCAAGGGCGAGGAGGAT) - and MolBioCraft cites no record or
//!     paper for the fused oligo.
//!   * The seven sequences themselves are unchanged. Their origin is not recorded: all seven
//!     entered the tree in the first import. A cited source here says that a public record or
//!     paper holds the sequence, not that MolBioCraft derived the oligo from it.
//! * **Protein records.** Receptor Kinase is NCBI Protein 3C4W_B (chain B of PDB 3C4W). Ferredoxin is
//!   RefSeq NP_417020.1, the Fdx of Escherichia coli K-12 MG1655 (gene fdx): the sample now cites
//!   that record, and its sequence is unchanged. NARH is RefSeq NP_415743.1 (gene
//!   narH, EC 1.7.5.1), in place of a UniProt citation; the sequence is unchanged. The two structure
//!   entries are RCSB 1D66 and 1A4Y (CC0): each sequence is the observed residues of its chains in
//!   the entry's coordinate file, in chain order. 1A4Y's organism is Homo sapiens for all four
//!   chains, as the entry records, where it read Homo sapiens / Sus scrofa.
//! * **yadF clone.** The CDS is the coding sequence NCBI returns for protein YP_004715652. The four
//!   primers are built exactly, with no clamp or extra base:
//!   * F +BioBrick = GAATTCGCGGCCGCTTCTAG (the BBF RFC 10 prefix for a coding part, whose ATG
//!     completes the XbaI site) + the CDS's first 18 bases.
//!   * R +BioBrick = the reverse complement of (the CDS's last 18 bases + TACTAGTAGCGGCCGCTGCAG,
//!     the RFC 10 suffix).
//!   * F +attB1 = GGGGACAAGTTTGTACAAAAAAGCAGGCT (the Gateway attB1 primer tail) + the CDS's first
//!     18 bases.
//!   * R +attB2 = GGGGACCACTTTGTACAAGAAAGCTGGGT (the Gateway attB2 primer tail) + the reverse
//!     complement of the CDS's last 18 bases.
//!
//!   Each of the four was built differently before: both BioBrick primers carried a CCC clamp; F
//!   +BioBrick added an A between the prefix and the CDS, F +attB1 a TA and R +attB2 an A; and R
//!   +BioBrick dropped the last base of the reverse-complemented suffix. Every Product Size read
//!   645 bp, the CDS alone. Each primer's Tm and %GC are now MolBioCraft's own, over its 18
//!   binding bases, and the Product Size is the amplicon the pair makes: 686 bp with the RFC 10
//!   prefix and suffix, 703 bp with the attB tails.
//! * **Genome records** (`sample_genomes_data.rs`): every accession, length, topology and GI equals
//!   NCBI's record summary for that accession.

use molbiocraft_core::{
    ChromatogramData, DocumentAlignmentMeta, HistoryTreeNode, MoleculeType, PrimerRecord,
    SequenceDocument, SequenceFeature, SplitMix64, Topology,
};
use std::collections::HashMap;

/// When MolBioCraft sourced the samples whose documents hold no date of their own: the
/// `created_at` and `updated_at` of every sample re-sourced by US-01M6TDFV.
pub(crate) const SOURCED_ON: &str = "2026-11-08T00:00:00Z";

/// The primer metadata every sequencing and cloning primer sample carries for its binding region:
/// MolBioCraft's own Tm and %GC, from [`crate::thermodynamics::calculate_primer_metrics`] at the
/// app's default conditions (50 mM Na+, 1.5 mM Mg2+, 250 nM oligo), never another program's.
fn primer_thermo_meta(binding_region: &str) -> Vec<(&'static str, serde_json::Value)> {
    let m = crate::thermodynamics::calculate_primer_metrics(binding_region, 50.0, 1.5, 250.0);
    vec![
        (
            "Tm",
            serde_json::json!(m
                .tm_no_answer_reason
                .clone()
                .unwrap_or_else(|| format!("{:.1} °C", m.tm_c))),
        ),
        (
            "%GC Primer Bind",
            serde_json::json!(format!("{:.1}%", m.gc_percent)),
        ),
    ]
}

/// The metadata of one universal sequencing primer: its own Tm and %GC, the record it is taken
/// from, and nothing another program wrote.
fn sequencing_primer_meta(
    sequence: &str,
    source_record: &str,
) -> HashMap<String, serde_json::Value> {
    let mut entries = primer_thermo_meta(sequence);
    entries.extend([
        ("Oligo Type", serde_json::json!("Primer")),
        ("Organism", serde_json::json!("Synthetic oligonucleotide")),
        ("Genetic Code", serde_json::json!("Standard")),
        ("Source record", serde_json::json!(source_record)),
    ]);
    make_meta(&entries)
}

/// The `%GC Primer Bind` of one sample design primer, over the oligo's binding region, from
/// MolBioCraft's own [`crate::thermodynamics::calculate_primer_metrics`] at the app's default
/// conditions (50 mM Na+, 1.5 mM Mg2+, 250 nM oligo).
///
/// The seven design primers store no Tm, hairpin or self-dimer energy (BG-01M6WB0V). MolBioCraft
/// computes all three from the oligo: `primerRecordFromDoc` puts them on the record it builds from
/// a saved primer document, and the Primer & PCR Studio's oligo analyzer shows them for any oligo.
/// A stored copy would answer no question the engine cannot, and could only disagree with it.
fn design_primer_gc(binding_region: &str) -> (&'static str, serde_json::Value) {
    let m = crate::thermodynamics::calculate_primer_metrics(binding_region, 50.0, 1.5, 250.0);
    (
        "%GC Primer Bind",
        serde_json::json!(format!("{:.1}%", m.gc_percent)),
    )
}

fn synthesize_sample_chromatogram(base_calls: &str) -> ChromatogramData {
    let pts_per_base = 10usize;
    let bytes = base_calls.as_bytes();
    let total_pts = bytes.len() * pts_per_base;
    let mut trace_a = vec![8.0f64; total_pts];
    let mut trace_c = vec![8.0f64; total_pts];
    let mut trace_g = vec![8.0f64; total_pts];
    let mut trace_t = vec![8.0f64; total_pts];
    let mut peak_locations = Vec::with_capacity(bytes.len());
    let mut phred_scores = Vec::with_capacity(bytes.len());

    let half = (bytes.len() as f64) / 2.0;
    for (i, &raw_b) in bytes.iter().enumerate() {
        let b = raw_b.to_ascii_uppercase();
        let center = i * pts_per_base + 5;
        peak_locations.push(center);
        let q = (42i32 - (((i as f64 - half).abs() / 15.0) as i32)).clamp(18, 60) as u8;
        phred_scores.push(q);
        let amp = (920 - ((i % 5) * 35)) as f64;
        for dx in -4isize..=4isize {
            let idx_i = (center as isize) + dx;
            if idx_i >= 0 && (idx_i as usize) < total_pts {
                let idx = idx_i as usize;
                let val = (amp * (-((dx * dx) as f64) / 3.6).exp()).round();
                match b {
                    b'A' => trace_a[idx] += val,
                    b'C' => trace_c[idx] += val,
                    b'G' => trace_g[idx] += val,
                    _ => trace_t[idx] += val,
                }
            }
        }
    }

    ChromatogramData {
        trace_a,
        trace_c,
        trace_g,
        trace_t,
        peak_locations,
        phred_scores,
        base_calls: base_calls.to_ascii_uppercase(),
    }
}

fn make_feat(
    id: &str,
    name: &str,
    feature_type: &str,
    start: usize,
    end: usize,
    strand: i8,
    color: &str,
    notes: Option<&str>,
) -> SequenceFeature {
    SequenceFeature {
        id: id.to_string(),
        name: name.to_string(),
        feature_type: feature_type.to_string(),
        start,
        end,
        strand,
        color: color.to_string(),
        notes: notes.map(|s| s.to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    }
}

fn make_meta(entries: &[(&str, serde_json::Value)]) -> HashMap<String, serde_json::Value> {
    entries
        .iter()
        .map(|(k, v)| ((*k).to_string(), v.clone()))
        .collect()
}

#[allow(clippy::too_many_arguments)]
fn make_sample_doc(
    id: &str,
    name: &str,
    accession: &str,
    description: &str,
    molecule_type: MoleculeType,
    topology: Topology,
    sequence: &str,
    features: Vec<SequenceFeature>,
    alignment_meta: Option<DocumentAlignmentMeta>,
    document_kind: &str,
    doc_metadata: HashMap<String, serde_json::Value>,
    timestamp: &str,
    folder: &str,
) -> SequenceDocument {
    SequenceDocument {
        id: id.to_string(),
        name: name.to_string(),
        accession: accession.to_string(),
        description: description.to_string(),
        molecule_type,
        topology,
        sequence: sequence.to_string(),
        features,
        primers: Vec::new(),
        history: Vec::new(),
        chromatogram: None,
        alignment_meta,
        document_kind: Some(document_kind.to_string()),
        doc_metadata: Some(doc_metadata),
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        folder: folder.to_string(),
    }
}

#[allow(dead_code, clippy::too_many_arguments)]
fn make_trace_doc(
    id: &str,
    name: &str,
    accession: &str,
    description: &str,
    sequence: &str,
    features: Vec<SequenceFeature>,
    doc_metadata: HashMap<String, serde_json::Value>,
    timestamp: &str,
    folder: &str,
) -> SequenceDocument {
    SequenceDocument {
        id: id.to_string(),
        name: name.to_string(),
        accession: accession.to_string(),
        description: description.to_string(),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Linear,
        sequence: sequence.to_string(),
        features,
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("h-{id}"),
            timestamp: "2026-10-30 10:15".to_string(),
            operation: "ABI 3730xl Capillary Basecalling".to_string(),
            description: "Imported 4-dye Sanger AB1 chromatogram trace with Phred quality scores"
                .to_string(),
            parent_ids: Vec::new(),
            length_bp: sequence.len(),
            topology: Topology::Linear,
            history_color: None,
            inserted_range: None,
        }],
        chromatogram: Some(synthesize_sample_chromatogram(sequence)),
        alignment_meta: None,
        document_kind: Some("trace".to_string()),
        doc_metadata: Some(doc_metadata),
        created_at: timestamp.to_string(),
        updated_at: timestamp.to_string(),
        folder: folder.to_string(),
    }
}

/// Complete Sample Project Library (102 annotated reference documents across all 12 workbench folders:
/// Alignments, Cloning, Contig Assembly, Genomes/Bacteria, Genomes/Eukaryotes, Genomes/Human,
/// Genomes/Plants, Genomes/Viruses, Plasmids & Vectors, Primers, Protein Documents, and Tree Documents).
pub fn get_sample_library() -> Vec<SequenceDocument> {
    let mut docs = vec![
        SequenceDocument {
            id: "doc-pet28-egfp".to_string(),
            name: "pET-28a(+)-eGFP".to_string(),
            accession: "MBC_VEC_001".to_string(),
            description: "Bacterial T7 lac expression plasmid encoding N-terminal 6xHis-Thrombin-T7-tag fused to enhanced GFP (eGFP). Kanamycin resistant.".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "TGGCGAATGGGACGCGCCCTGTAGCGGCGCATTAAGCGCGGCGGGTGTGGTGGTTACGCGCAGCGTGACCGCTACACTTGCCAGCGCCCTAGCGCCCGCTCCTTTCGCTTTCTTCCCTTCCTTTCTCGCCACGTTCGCCGGCTTTCCCCGTCAAGCTCTAAATCGGGGGCTCCCTTTAGGGTTCCGATTTAGTGCTTTACGGCACCTCGACCCCAAAAAACTTGATTAGGGTGATGGTTCACGTAGTGGGCCATCGCCCTGATAGACGGTTTTTCGCCCTTTGACGTTGGAGTCCACGTTCTTTAATAGTGGACTCTTGTTCCAAACTGGAACAACACTCAACCCTATCTCGGTCTATTCTTTTGATTTATAAGGGATTTTGCCGATTTCGGCCTATTGGTTAAAAAATGAGCTGATTTAACAAAAATTTAACGCGAATTTTAACAAAATATTAACGTTTACAATTTCAGGTGGCACTTTTCGGGGAAATGTGCGCGGAACCCCTATTTGTTTATTTTTCTAAATACATTCAAATATGTATCCGCTCATGAATTAATTCTTAGAAAAACTCATCGAGCATCAAATGAAACTGCAATTTATTCATATCAGGATTATCAATACCATATTTTTGAAAAAGCCGTTTCTGTAATGAAGGAGAAAACTCACCGAGGCAGTTCCATAGGATGGCAAGATCCTGGTATCGGTCTGCGATTCCGACTCGTCCAACATCAATACAACCTATTAATTTCCCCTCGTCAAAAATAAGGTTATCAAGTGAGAAATCACCATGAGTGACGACTGAATCCGGTGAGAATGGCAAAAGTTTATGCATTTCTTTCCAGACTTGTTCAACAGGCCAGCCATTACGCTCGTCATCAAAATCACTCGCATCAACCAAACCGTTATTCATTCGTGATTGCGCCTGAGCGAGACGAAATACGCGATCGCTGTTAAAAGGACAATTACAAACAGGAATCGAATGCAACCGGCGCAGGAACACTGCCAGCGCATCAACAATATTTTCACCTGAATCAGGATATTCTTCTAATACCTGGAATGCTGTTTTCCCGGGGATCGCAGTGGTGAGTAACCATGCATCATCAGGAGTACGGATAAAATGCTTGATGGTCGGAAGAGGCATAAATTCCGTCAGCCAGTTTAGTCTGACCATCTCATCTGTAACATCATTGGCAACGCTACCTTTGCCATGTTTCAGAAACAACTCTGGCGCATCGGGCTTCCCATACAATCGATAGATTGTCGCACCTGATTGCCCGACATTATCGCGAGCCCATTTATACCCATATAAATCAGCATCCATGTTGGAATTTAATCGCGGCCTAGAGCAAGACGTTTCCCGTTGAATATGGCTCATAACACCCCTTGTATTACTGTTTATGTAAGCAGACAGTTTTATTGTTCATGACCAAAATCCCTTAACGTGAGTTTTCGTTCCACTGAGCGTCAGACCCCGTAGAAAAGATCAAAGGATCTTCTTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTCCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGTTCTTTCCTGCGTTATCCCCTGATTCTGTGGATAACCGTATTACCGCCTTTGAGTGAGCTGATACCGCTCGCCGCAGCCGAACGACCGAGCGCAGCGAGTCAGTGAGCGAGGAAGCGGAAGAGCGCCTGATGCGGTATTTTCTCCTTACGCATCTGTGCGGTATTTCACACCGCATATATGGTGCACTCTCAGTACAATCTGCTCTGATGCCGCATAGTTAAGCCAGTATACACTCCGCTATCGCTACGTGACTGGGTCATGGCTGCGCCCCGACACCCGCCAACACCCGCTGACGCGCCCTGACGGGCTTGTCTGCTCCCGGCATCCGCTTACAGACAAGCTGTGACCGTCTCCGGGAGCTGCATGTGTCAGAGGTTTTCACCGTCATCACCGAAACGCGCGAGGCAGCTGCGGTAAAGCTCATCAGCGTGGTCGTGAAGCGATTCACAGATGTCTGCCTGTTCATCCGCGTCCAGCTCGTTGAGTTTCTCCAGAAGCGTTAATGTCTGGCTTCTGATAAAGCGGGCCATGTTAAGGGCGGTTTTTTCCTGTTTGGTCACTGATGCCTCCGTGTAAGGGGGATTTCTGTTCATGGGGGTAATGATACCGATGAAACGAGAGAGGATGCTCACGATACGGGTTACTGATGATGAACATGCCCGGTTACTGGAACGTTGTGAGGGTAAACAACTGGCGGTATGGATGCGGCGGGACCAGAGAAAAATCACTCAGGGTCAATGCCAGCGCTTCGTTAATACAGATGTAGGTGTTCCACAGGGTAGCCAGCAGCATCCTGCGATGCAGATCCGGAACATAATGGTGCAGGGCGCTGACTTCCGCGTTTCCAGACTTTACGAAACACGGAAACCGAAGACCATTCATGTTGTTGCTCAGGTCGCAGACGTTTTGCAGCAGCAGTCGCTTCACGTTCGCTCGCGTATCGGTGATTCATTCTGCTAACCAGTAAGGCAACCCCGCCAGCCTAGCCGGGTCCTCAACGACAGGAGCACGATCATGCGCACCCGTGGGGCCGCCATGCCGGCGATAATGGCCTGCTTCTCGCCGAAACGTTTGGTGGCGGGACCAGTGACGAAGGCTTGAGCGAGGGCGTGCAAGATTCCGAATACCGCAAGCGACAGGCCGATCATCGTCGCGCTCCAGCGAAAGCGGTCCTCGCCGAAAATGACCCAGAGCGCTGCCGGCACCTGTCCTACGAGTTGCATGATAAAGAAGACAGTCATAAGTGCGGCGACGATAGTCATGCCCCGCGCCCACCGGAAGGAGCTGACTGGGTTGAAGGCTCTCAAGGGCATCGGTCGAGATCCCGGTGCCTAATGAGTGAGCTAACTTACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCCAGGGTGGTTTTTCTTTTCACCAGTGAGACGGGCAACAGCTGATTGCCCTTCACCGCCTGGCCCTGAGAGAGTTGCAGCAAGCGGTCCACGCTGGTTTGCCCCAGCAGGCGAAAATCCTGTTTGATGGTGGTTAACGGCGGGATATAACATGAGCTGTCTTCGGTATCGTCGTATCCCACTACCGAGATATCCGCACCAACGCGCAGCCCGGACTCGGTAATGGCGCGCATTGCGCCCAGCGCCATCTGATCGTTGGCAACCAGCATCGCAGTGGGAACGATGCCCTCATTCAGCATTTGCATGGTTTGTTGAAAACCGGACATGGCACTCCAGTCGCCTTCCCGTTCCGCTATCGGCTGAATTTGATTGCGAGTGAGATATTTATGCCAGCCAGCCAGACGCAGACGCGCCGAGACAGAACTTAATGGGCCCGCTAACAGCGCGATTTGCTGGTGACCCAATGCGACCAGATGCTCCACGCCCAGTCGCGTACCGTCTTCATGGGAGAAAATAATACTGTTGATGGGTGTCTGGTCAGAGACATCAAGAAATAACGCCGGAACATTAGTGCAGGCAGCTTCCACAGCAATGGCATCCTGGTCATCCAGCGGATAGTTAATGATCAGCCCACTGACGCGTTGCGCGAGAAGATTGTGCACCGCCGCTTTACAGGCTTCGACGCCGCTTCGTTCTACCATCGACACCACCACGCTGGCACCCAGTTGATCGGCGCGAGATTTAATCGCCGCGACAATTTGCGACGGCGCGTGCAGGGCCAGACTGGAGGTGGCAACGCCAATCAGCAACGACTGTTTGCCCGCCAGTTGTTGTGCCACGCGGTTGGGAATGTAATTCAGCTCCGCCATCGCCGCTTCCACTTTTTCCCGCGTTTTCGCAGAAACGTGGCTGGCCTGGTTCACCACGCGGGAAACGGTCTGATAAGAGACACCGGCATACTCTGCGACATCGTATAACGTTACTGGTTTCACATTCACCACCCTGAATTGACTCTCTTCCGGGCGCTATCATGCCATACCGCGAAAGGTTTTGCGCCATTCGATGGTGTCCGGGATCTCGACGCTCTCCCTTATGCGACTCCTGCATTAGGAAGCAGCCCAGTAGTAGGTTGAGGCCGTTGAGCACCGCCGCCGCAAGGAATGGTGCATGCAAGGAGATGGCGCCCAACAGTCCCCCGGCCACGGGGCCTGCCACCATACCCACGCCGAAACAAGCGCTCATGAGCCCGAAGTGGCGAGCCCGATCTTCCCCATCGGTGATGTCGGCGATATAGGCGCCAGCAACCGCACCTGTGGCGCCGGTGATGCCGGCCACGATGCGTCCGGCGTAGAGGATCGAGATCTCGATCCCGCGAAATTAATACGACTCACTATAGGGGAATTGTGAGCGGATAACAATTCCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACCATGGGCAGCAGCCATCATCATCATCATCACAGCAGCGGCCTGGTGCCGCGCGGCAGCCATATGGCTAGCATGACTGGTGGACAGCAAATGGGTCGCGGATCCGAATTCATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAACTCGAGCACCACCACCACCACCACTGAGATCCGGCTGCTAACAAAGCCCGAAAGGAAGCTGAGTTGGCTGCTGCCACCGCTGAGCAATAACTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTGCTGAAAGGAGGAACTATATCCGGAT".to_string(),
            features: vec![
                SequenceFeature {
                    id: "f-f1ori".to_string(),
                    name: "f1 ori".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 12,
                    end: 467,
                    strand: 1,
                    color: "#a3a3a3".to_string(),
                    notes: Some("f1 bacteriophage origin of replication (456 bp)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-kanr".to_string(),
                    name: "KanR (aph(3')-Ia)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 560,
                    end: 1375,
                    strand: -1,
                    color: "#ef4444".to_string(),
                    notes: Some("Kanamycin resistance aminoglycoside phosphotransferase".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-ori".to_string(),
                    name: "pBR322 ori".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 1497,
                    end: 2085,
                    strand: -1,
                    color: "#f59e0b".to_string(),
                    notes: Some("pMB1/pBR322 origin of replication (589 bp)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-laci".to_string(),
                    name: "lacI repressor".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 3515,
                    end: 4597,
                    strand: -1,
                    color: "#8b5cf6".to_string(),
                    notes: Some("LacI repressor, 360 aa; native GTG start codon".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-t7prom".to_string(),
                    name: "T7 Promoter".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 4984,
                    end: 5002,
                    strand: 1,
                    color: "#3b82f6".to_string(),
                    notes: Some("Bacteriophage T7 RNA polymerase promoter".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-lacop".to_string(),
                    name: "lac operator".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 5003,
                    end: 5027,
                    strand: 1,
                    color: "#06b6d4".to_string(),
                    notes: Some("LacI binding site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-rbs".to_string(),
                    name: "RBS (Shine-Dalgarno)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 5058,
                    end: 5063,
                    strand: 1,
                    color: "#14b8a6".to_string(),
                    notes: Some("Shine-Dalgarno sequence AAGGAG".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-fusion-orf".to_string(),
                    name: "6xHis-thrombin-T7-eGFP ORF".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 5071,
                    end: 5898,
                    strand: 1,
                    color: "#22c55e".to_string(),
                    notes: Some("Translated fusion ORF, 275 aa (MGSSHHHHHH...MDELYK)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-his6".to_string(),
                    name: "6xHis Affinity Tag".to_string(),
                    feature_type: "tag".to_string(),
                    start: 5083,
                    end: 5100,
                    strand: 1,
                    color: "#ec4899".to_string(),
                    notes: Some("Hexahistidine purification tag".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-thrombin".to_string(),
                    name: "Thrombin site".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 5110,
                    end: 5127,
                    strand: 1,
                    color: "#f97316".to_string(),
                    notes: Some("LVPR^GS thrombin cleavage site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-t7tag".to_string(),
                    name: "T7 tag".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 5131,
                    end: 5163,
                    strand: 1,
                    color: "#a855f7".to_string(),
                    notes: Some("T7 gene 10 epitope tag MASMTGGQQMG".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-egfp".to_string(),
                    name: "eGFP".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 5179,
                    end: 5898,
                    strand: 1,
                    color: "#10b981".to_string(),
                    notes: Some("Enhanced GFP, 239 aa (Aequorea victoria, F64L/S65T); in frame with the N-terminal His-thrombin-T7 tag".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "f-t7term".to_string(),
                    name: "T7 Terminator".to_string(),
                    feature_type: "terminator".to_string(),
                    start: 5989,
                    end: 6036,
                    strand: 1,
                    color: "#64748b".to_string(),
                    notes: Some("T7 transcription terminator".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "p-t7-fwd".to_string(),
                    name: "T7_Promoter_Fwd".to_string(),
                    sequence: "TAATACGACTCACTATAGGG".to_string(),
                    anneal_sequence: "TAATACGACTCACTATAGGG".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 4984,
                    bind_end: 5003,
                    strand: 1,
                    length: 20,
                    gc_percent: 40.0,
                    tm_anneal_c: 53.2,
                    tm_full_c: 53.2,
                    delta_g37: -21.4,
                    hairpin_delta_g: -0.4,
                    self_dimer_delta_g: -1.8,
                    gc_clamp3_prime: true,
                    notes: Some("Universal T7 forward sequencing primer".to_string()),
                    tm_no_answer_reason: None,
                },
                PrimerRecord {
                    id: "p-t7-rev".to_string(),
                    name: "T7_Terminator_Rev".to_string(),
                    sequence: "GCTAGTTATTGCTCAGCGG".to_string(),
                    anneal_sequence: "GCTAGTTATTGCTCAGCGG".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 5975,
                    bind_end: 5993,
                    strand: -1,
                    length: 19,
                    gc_percent: 52.6,
                    tm_anneal_c: 57.8,
                    tm_full_c: 57.8,
                    delta_g37: -24.1,
                    hairpin_delta_g: -0.9,
                    self_dimer_delta_g: -2.1,
                    gc_clamp3_prime: true,
                    notes: Some("Universal T7 reverse sequencing primer".to_string()),
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "h-1".to_string(),
                    timestamp: "2026-10-28 14:20".to_string(),
                    operation: "Imported Vector Backbone".to_string(),
                    description: "Imported Novagen pET-28a(+) bacterial expression vector (5,369 bp)".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 5369,
                    topology: Topology::Circular,
                    history_color: None,
                    inserted_range: None,
                },
                HistoryTreeNode {
                    id: "h-2".to_string(),
                    timestamp: "2026-10-29 10:15".to_string(),
                    operation: "Restriction Digest (EcoRI + XhoI)".to_string(),
                    description: "Linearized pET-28a(+) MCS between EcoRI (5186) and XhoI (5192)".to_string(),
                    parent_ids: vec!["h-1".to_string()],
                    length_bp: 5343,
                    topology: Topology::Linear,
                    history_color: None,
                    inserted_range: None,
                },
                HistoryTreeNode {
                    id: "h-3".to_string(),
                    timestamp: "2026-10-30 09:00".to_string(),
                    operation: "Ligation of eGFP CDS".to_string(),
                    description: "Inserted 720 bp eGFP amplicon via EcoRI / XhoI cohesive ends to create pET-28a(+)-eGFP".to_string(),
                    parent_ids: vec!["h-2".to_string()],
                    length_bp: 6061,
                    topology: Topology::Circular,
                    history_color: None,
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T09:00:00Z".to_string(),
            updated_at: "2026-10-30T09:00:00Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },
        SequenceDocument {
            id: "doc-puc19".to_string(),
            name: "pUC19_Standard_Vector".to_string(),
            accession: "L09137.2".to_string(),
            description: "Standard high-copy E. coli cloning vector with lacZ-alpha blue/white screening cassette, multiple cloning site (MCS), and AmpR.".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCGCTTTCCAGTCGGGAAACCTGTCGTGCCAGCTGCATTAATGAATCGGCCAACGCGCGGGGAGAGGCGGTTTGCGTATTGGGCGCTCTTCCGCTTCCTCGCTCACTGACTCGCTGCGCTCGGTCGTTCGGCTGCGGCGAGCGGTATCAGCTCACTCAAAGGCGGTAATACGGTTATCCACAGAATCAGGGGATAACGCAGGAAAGAACATGTGAGCAAAAGGCCAGCAAAAGGCCAGGAACCGTAAAAAGGCCGCGTTGCTGGCGTTTTTCCATAGGCTCCGCCCCCCTGACGAGCATCACAAAAATCGACGCTCAAGTCAGAGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGAAGCTCCCTCGTGCGCTCTCCTGTTCCGACCCTGCCGCTTACCGGATACCTGTCCGCCTTTCTCCCTTCGGGAAGCGTGGCGCTTTCTCATAGCTCACGCTGTAGGTATCTCAGTTCGGTGTAGGTCGTTCGCTCCAAGCTGGGCTGTGTGCACGAACCCCCCGTTCAGCCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGTAAGACACGACTTATCGCCACTGGCAGCAGCCACTGGTAACAGGATTAGCAGAGCGAGGTATGTAGGCGGTGCTACAGAGTTCTTGAAGTGGTGGCCTAACTACGGCTACACTAGAAGAACAGTATTTGGTATCTGCGCTCTGCTGAAGCCAGTTACCTTCGGAAAAAGAGTTGGTAGCTCTTGATCCGGCAAACAAACCACCGCTGGTAGCGGTGGTTTTTTTGTTTGCAAGCAGCAGATTACGCGCAGAAAAAAAGGATCTCAAGAAGATCCTTTGATCTTTTCTACGGGGTCTGACGCTCAGTGGAACGAAAACTCACGTTAAGGGATTTTGGTCATGAGATTATCAAAAAGGATCTTCACCTAGATCCTTTTAAATTAAAAATGAAGTTTTAAATCAATCTAAAGTATATATGAGTAAACTTGGTCTGACAGTTACCAATGCTTAATCAGTGAGGCACCTATCTCAGCGATCTGTCTATTTCGTTCATCCATAGTTGCCTGACTCCCCGTCGTGTAGATAACTACGATACGGGAGGGCTTACCATCTGGCCCCAGTGCTGCAATGATACCGCGAGACCCACGCTCACCGGCTCCAGATTTATCAGCAATAAACCAGCCAGCCGGAAGGGCCGAGCGCAGAAGTGGTCCTGCAACTTTATCCGCCTCCATCCAGTCTATTAATTGTTGCCGGGAAGCTAGAGTAAGTAGTTCGCCAGTTAATAGTTTGCGCAACGTTGTTGCCATTGCTACAGGCATCGTGGTGTCACGCTCGTCGTTTGGTATGGCTTCATTCAGCTCCGGTTCCCAACGATCAAGGCGAGTTACATGATCCCCCATGTTGTGCAAAAAAGCGGTTAGCTCCTTCGGTCCTCCGATCGTTGTCAGAAGTAAGTTGGCCGCAGTGTTATCACTCATGGTTATGGCAGCACTGCATAATTCTCTTACTGTCATGCCATCCGTAAGATGCTTTTCTGTGACTGGTGAGTACTCAACCAAGTCATTCTGAGAATAGTGTATGCGGCGACCGAGTTGCTCTTGCCCGGCGTCAATACGGGATAATACCGCGCCACATAGCAGAACTTTAAAAGTGCTCATCATTGGAAAACGTTCTTCGGGGCGAAAACTCTCAAGGATCTTACCGCTGTTGAGATCCAGTTCGATGTAACCCACTCGTGCACCCAACTGATCTTCAGCATCTTTTACTTTCACCAGCGTTTCTGGGTGAGCAAAAACAGGAAGGCAAAATGCCGCAAAAAAGGGAATAAGGGCGACACGGAAATGTTGAATACTCATACTCTTCCTTTTTCAATATTATTGAAGCATTTATCAGGGTTATTGTCTCATGAGCGGATACATATTTGAATGTATTTAGAAAAATAAACAAATAGGGGTTCCGCGCACATTTCCCCGAAAAGTGCCACCTGACGTCTAAGAAACCATTATTATCATGACATTAACCTATAAAAATAGGCGTATCACGAGGCCCTTTCGTC".to_string(),
            features: vec![
                SequenceFeature {
                    id: "puc-lacZ".to_string(),
                    name: "lacZ-alpha".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 146,
                    end: 469,
                    strand: -1,
                    color: "#3b82f6".to_string(),
                    notes: Some("LacZ alpha fragment, 107 aa (complement 146..469)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "puc-mcs".to_string(),
                    name: "MCS (EcoRI..HindIII)".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 396,
                    end: 452,
                    strand: 1,
                    color: "#ec4899".to_string(),
                    notes: Some("Polylinker Multiple Cloning Site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "puc-lacO".to_string(),
                    name: "lac operator".to_string(),
                    feature_type: "protein_bind".to_string(),
                    start: 489,
                    end: 505,
                    strand: -1,
                    color: "#06b6d4".to_string(),
                    notes: Some("LacI binding site TTGTGAGCGGATAACAA".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "puc-lacP".to_string(),
                    name: "lac promoter".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 513,
                    end: 543,
                    strand: -1,
                    color: "#3b82f6".to_string(),
                    notes: Some("E. coli lac promoter (31 bp)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "puc-ori".to_string(),
                    name: "pMB1 / ColE1 ori".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 867,
                    end: 1455,
                    strand: -1,
                    color: "#f59e0b".to_string(),
                    notes: Some("High-copy pMB1 origin (589 bp)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "puc-ampr".to_string(),
                    name: "AmpR (bla TEM-1)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 1626,
                    end: 2486,
                    strand: -1,
                    color: "#ef4444".to_string(),
                    notes: Some("Beta-lactamase conferring ampicillin/carbenicillin resistance".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "puc-amp-prom".to_string(),
                    name: "AmpR Promoter".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 2487,
                    end: 2591,
                    strand: -1,
                    color: "#8b5cf6".to_string(),
                    notes: Some("bla constitutive promoter".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "p-m13-fwd".to_string(),
                    name: "M13_Forward (-20)".to_string(),
                    sequence: "GTAAAACGACGGCCAGT".to_string(),
                    anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 379,
                    bind_end: 395,
                    strand: 1,
                    length: 17,
                    gc_percent: 52.9,
                    tm_anneal_c: 54.1,
                    tm_full_c: 54.1,
                    delta_g37: -20.8,
                    hairpin_delta_g: -0.2,
                    self_dimer_delta_g: -1.4,
                    gc_clamp3_prime: false,
                    notes: None,
                    tm_no_answer_reason: None,
                },
                PrimerRecord {
                    id: "p-m13-rev".to_string(),
                    name: "M13_Reverse (-27)".to_string(),
                    sequence: "CAGGAAACAGCTATGAC".to_string(),
                    anneal_sequence: "CAGGAAACAGCTATGAC".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 465,
                    bind_end: 481,
                    strand: -1,
                    length: 17,
                    gc_percent: 47.1,
                    tm_anneal_c: 50.6,
                    tm_full_c: 50.6,
                    delta_g37: -19.2,
                    hairpin_delta_g: -0.3,
                    self_dimer_delta_g: -1.1,
                    gc_clamp3_prime: true,
                    notes: None,
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "hpuc-1".to_string(),
                    timestamp: "2026-10-30 09:05".to_string(),
                    operation: "GenBank Reference Import".to_string(),
                    description: "Loaded NCBI GenBank L09137.2 (pUC19 cloning vector, 2,686 bp)".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 2686,
                    topology: Topology::Circular,
                    history_color: None,
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T09:05:00Z".to_string(),
            updated_at: "2026-10-30T09:05:00Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },
        SequenceDocument {
            id: "doc-insert-mcherry".to_string(),
            name: "Insert_mCherry_Cassette".to_string(),
            accession: "MBC_INS_002".to_string(),
            description: "Linear donor PCR cassette containing mCherry fluorescent protein flanked by EcoRI, BamHI, BsaI (Golden Gate), and XhoI restriction sites + 25 bp pET-28a Gibson overlaps.".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            sequence: "ATGGCTAGCATGACTGGTGGACAGCAAATGGGTCGCGGATCCGAATTCGGTCTCAATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGGCGACGGGGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAGACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAATGAGACCCTCGAGCACCACCACCACCACCACTGAGATCCGGCTGCTAA".to_string(),
            features: vec![
                SequenceFeature {
                    id: "ins-lh".to_string(),
                    name: "5' Gibson Homology Arm".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 1,
                    end: 42,
                    strand: 1,
                    color: "#06b6d4".to_string(),
                    notes: Some("Homologous to pET-28a(+) N-terminal leader".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "ins-mcherry".to_string(),
                    name: "mCherry CDS".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 56,
                    end: 766,
                    strand: 1,
                    color: "#f43f5e".to_string(),
                    notes: Some("Monomeric red fluorescent protein (Ex 587nm / Em 610nm)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "ins-rh".to_string(),
                    name: "3' Gibson Homology Arm".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 774,
                    end: 814,
                    strand: 1,
                    color: "#06b6d4".to_string(),
                    notes: Some("Homologous to pET-28a(+) C-terminal His6 region".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![

            ],
            history: vec![
                HistoryTreeNode {
                    id: "hins-1".to_string(),
                    timestamp: "2026-10-30 09:10".to_string(),
                    operation: "High-Fidelity Q5 PCR Synthesis".to_string(),
                    description: "Amplified mCherry donor insert with Gibson & Golden Gate adapter tails".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 814,
                    topology: Topology::Linear,
                    history_color: None,
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T09:10:00Z".to_string(),
            updated_at: "2026-10-30T09:10:00Z".to_string(),
            folder: "Cloning Inserts & PCR".to_string(),
        },
        SequenceDocument {
            id: "doc-sanger-ab1-fwd".to_string(),
            name: "eGFP_Clone3_Sanger_Fwd.ab1".to_string(),
            accession: "ABI_3730XL_01".to_string(),
            description: "Applied Biosystems 3730xl Sanger capillary sequencing trace covering the eGFP chromophore region (contains the Y66H blue-shifting point mutation, TAC->CAC at bases 199-201).".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCCACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTA".to_string(),
            features: vec![
                SequenceFeature {
                    id: "ab1-mut".to_string(),
                    name: "Y66H Chromophore SNP (TAC->CAC)".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 199,
                    end: 201,
                    strand: 1,
                    color: "#ef4444".to_string(),
                    notes: Some("Shifts emission from green (509 nm) to blue (448 nm - EBFP)".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![

            ],
            history: vec![
                HistoryTreeNode {
                    id: "hab1-1".to_string(),
                    timestamp: "2026-10-30 09:20".to_string(),
                    operation: "ABI 3730xl Capillary Basecalling".to_string(),
                    description: "Imported Sanger AB1 chromatogram trace with Phred quality scores".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 320,
                    topology: Topology::Linear,
                    history_color: None,
                    inserted_range: None,
                }
            ],
            chromatogram: Some(synthesize_sample_chromatogram("ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCCACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTA")),
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T09:20:00Z".to_string(),
            updated_at: "2026-10-30T09:20:00Z".to_string(),
            folder: "Sequencing Reads (Sanger/NGS)".to_string(),
        },
        SequenceDocument {
            id: "doc-homolog-eyfp".to_string(),
            name: "EYFP_Aequorea_Variant".to_string(),
            accession: "MBC_FP_EYFP".to_string(),
            description: "Enhanced Yellow Fluorescent Protein coding sequence (S65G, V68L, S72A, T203Y substitutions relative to GFP).".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGGGCTACGGCCTGCAGTGCTTCGCCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCTACCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA".to_string(),
            features: vec![
                SequenceFeature {
                    id: "eyfp-cds".to_string(),
                    name: "EYFP CDS".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 1,
                    end: 720,
                    strand: 1,
                    color: "#eab308".to_string(),
                    notes: Some("Yellow Fluorescent Protein".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![

            ],
            history: vec![

            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T09:25:00Z".to_string(),
            updated_at: "2026-10-30T09:25:00Z".to_string(),
            folder: "Protein Homologs".to_string(),
        },
        SequenceDocument {
            id: "doc-homolog-ecfp".to_string(),
            name: "ECFP_Cyan_Variant".to_string(),
            accession: "MBC_FP_ECFP".to_string(),
            description: "Enhanced Cyan Fluorescent Protein coding sequence (F64L, S65T, Y66W indole chromophore, N146I, M153T, V163A).".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTGGGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACATCAGCCACAACGTCTATATCACCGCCGACAAGCAGAAGAACGGCATCAAGGCCAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA".to_string(),
            features: vec![
                SequenceFeature {
                    id: "ecfp-cds".to_string(),
                    name: "ECFP CDS".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 1,
                    end: 720,
                    strand: 1,
                    color: "#06b6d4".to_string(),
                    notes: Some("Cyan Fluorescent Protein".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![

            ],
            history: vec![

            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T09:26:00Z".to_string(),
            updated_at: "2026-10-30T09:26:00Z".to_string(),
            folder: "Protein Homologs".to_string(),
        },
        SequenceDocument {
            id: "doc-twist-cmv".to_string(),
            name: "pTwist CMV".to_string(),
            accession: "TW_TWIST_CMV".to_string(),
            description: "[Twist Bioscience • Mammalian Expression] Compact high-yield transient mammalian expression vector driven by human CMV immediate-early promoter. | Host: Mammalian | Origin: pUC (high) | Selection: Ampicillin | Strain: DH10B (37°C)".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "CGACGTTGTAAAACGACGGCCAGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCCGTTACATAACTTACGGTAAATGGCCCGCCTGGCTGACCGCCCAACGACCCCCGCCCATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAGGGACTTTCCATTGACGTCAATGGGTGGAGTATTTACGGTAAACTGCCCACTTGGCAGTACATCAAGTGTATCATATGCCAAGTACGCCCCCTATTGACGTCAATGACGGTAAATGGCCCGCCTGGCATTATGCCCAGTACATGACCTTATGGGACTTTCCTACTTGGCAGTACATCTACGTATTAGTCATCGCTATTACCATGGTGATGCGGTTTTGGCAGTACATCAATGGGCGTGGATAGCGGTTTGACTCACGGGGATTTCCAAGTCTCCACCCCATTGACGTCAATGGGAGTTTGTTTTGGCACCAAAATCAACGGGACTTTCCAAAATGTCGTAACAACTCCGCCCCATTGACGCAAATGGGCGGTAGGCGTGTACGGTGGGAGGTCTATATAAGCAGAGCTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTAAGCTTCAGCTAGCCAGGATCCCAGAATTCCAGCGGCCGCCACTCGAGACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCGCCACCCGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCACTGTGCCTTCTAGTTGCCAGCCATCTGTTGTTTGCCCCTCCCCCGTGCCTTCCTTGACCCTGGAAGGTGCCACTCCCACTGTCCTTTCCTAATAAAATGAGGAAATTGCATCGCATTGTCTGAGTAGGTGTCATTCTATTCTGGGGGGTGGGGTGGGGCAGGACAGCAAGGGGGAGGATTGGGAAGACAATAGCAGGCATGCTGGGGATGCGGTGGGCTCTATGGGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAATCCCGCCCCTAACTCCGCCCAGTTCCGCCCATTCTCCGCCCCATGGCTGACTAATTTTTTTTATTTATGCAGAGGCCGAGGCCGCCTCGGCCTCTGAGCTATTCCAGAAGTAGTGAGGAGGCTTTTTTGGAGGCCTAGGCTTTTGCAAAAAGCTATGCATGACGTCTGACTGACGTAGTCATGACGTACGTTTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTAATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCAGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGAT".to_string(),
            features: vec![
                SequenceFeature {
                    id: "twist-cmv-m13f".to_string(),
                    name: "M13 Forward (-20)".to_string(),
                    feature_type: "primer_bind".to_string(),
                    start: 8,
                    end: 24,
                    strand: 1,
                    color: "#0EA5E9".to_string(),
                    notes: Some("Universal M13 forward sequencing primer site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-1".to_string(),
                    name: "CMV Promoter/Enhancer".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 69,
                    end: 576,
                    strand: 1,
                    color: "#2563EB".to_string(),
                    notes: Some("Human cytomegalovirus immediate-early enhancer/promoter; ultra-strong transient expression in HEK293, CHO, HeLa; prone to silencing in stem/primary cells.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-2".to_string(),
                    name: "Twist Clonal Insertion / MCS".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 613,
                    end: 660,
                    strand: 1,
                    color: "#14B8A6".to_string(),
                    notes: Some("Unique cloning sites: HindIII, NheI, BamHI, EcoRI, NotI, XhoI".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-3".to_string(),
                    name: "Kozak Consensus (GCCACC)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 705,
                    end: 710,
                    strand: 1,
                    color: "#06B6D4".to_string(),
                    notes: Some("Vertebrate 40S ribosome initiation consensus immediately upstream of ATG.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-4".to_string(),
                    name: "bGH Poly(A) Signal".to_string(),
                    feature_type: "terminator".to_string(),
                    start: 747,
                    end: 971,
                    strand: 1,
                    color: "#64748B".to_string(),
                    notes: Some("Bovine growth hormone polyadenylation signal (pcDNA3.1 / pTwist CMV); efficient 3' cleavage and poly-A tailing.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-5".to_string(),
                    name: "SV40 Origin".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 1008,
                    end: 1163,
                    strand: 1,
                    color: "#F59E0B".to_string(),
                    notes: Some("Simian virus 40 origin driving high-copy episomal amplification in Large T-antigen positive cells (HEK293T, COS-7).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-6".to_string(),
                    name: "pUC Origin (High Copy ~500–700)".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 1200,
                    end: 1848,
                    strand: 1,
                    color: "#F59E0B".to_string(),
                    notes: Some("G->A mutated pMB1 origin lacking functional Rom/Rop regulation (~500–700 copies/cell); Twist High-Copy Accepted.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-feat-7".to_string(),
                    name: "AmpR (bla β-Lactamase)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 1885,
                    end: 2745,
                    strand: 1,
                    color: "#DC2626".to_string(),
                    notes: Some("TEM-1 β-lactamase conferring Ampicillin / Carbenicillin resistance (100 µg/mL in E. coli).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "twist-cmv-prm-m13f".to_string(),
                    name: "M13-Fwd(-20)".to_string(),
                    sequence: "GTAAAACGACGGCCAGT".to_string(),
                    anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 8,
                    bind_end: 24,
                    strand: 1,
                    length: 17,
                    gc_percent: 52.9,
                    tm_anneal_c: 54.2,
                    tm_full_c: 54.2,
                    delta_g37: -21.4,
                    hairpin_delta_g: 0.4,
                    self_dimer_delta_g: -1.8,
                    gc_clamp3_prime: true,
                    notes: Some("Universal vector verification primer".to_string()),
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "hist-twist-cmv".to_string(),
                    timestamp: "2026-10-30T21:18:22.670Z".to_string(),
                    operation: "Loaded from Twist Bioscience Vector Library".to_string(),
                    description: "pTwist CMV (4,148 bp circular) — Twist Mammalian Expression".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 4148,
                    topology: Topology::Circular,
                    history_color: Some("#2563EB".to_string()),
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T21:18:22.670Z".to_string(),
            updated_at: "2026-10-30T21:18:22.670Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },
        SequenceDocument {
            id: "doc-twist-entr-kozak".to_string(),
            name: "pTwist ENTR Kozak".to_string(),
            accession: "TW_TWIST_ENTR_KOZAK".to_string(),
            description: "[Twist Bioscience • Cloning & Entry] Gateway Entry vector pre-configured with vertebrate Kozak consensus and in-frame attL2 reading frame for C-terminal pDEST fusions. | Host: E. coli / Mammalian Gateway | Origin: pMB1 (pUC high-copy) (high) | Selection: Kanamycin | Strain: DH10B / TOP10 (37°C)".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "CGACGTTGTAAAACGACGGCCAGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCCAAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCAGGCTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTGCGGCCGCCAGGCGCGCCACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCGCCACCCGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCAACCCAGCTTTCTTGTACAAAGTGGTTCGATAACAAATTGATGAGCAATTAATTTTTTATAATGCCAACTTTGTACAAGAAAGCTGGGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGTGCATGACGTCTGACTGACGTAGTCATGACGTACGTATGATTGAACAAGATGGATTGCACGCAGGTTCTCCGGCCGCTTGGGTGGAGAGGCTATTCGGCTATGACTGGGCACAACAGACAATCGGCTGCTCTGATGCCGCCGTGTTCCGGCTGTCAGCGCAGGGGCGCCCGGTTCTTTTTGTCAAGACCGACCTGTCCGGTGCCCTGAATGAACTGCAGGACGAGGCAGCGCGGCTATCGTGGCTGGCCACGACGGGCGTTCCTTGCGCAGCTGTGCTCGACGTTGTCACTGAAGCGGGAAGGGACTGGCTGCTATTGGGCGAAGTGCCGGGGCAGGATCTCCTGTCATCTCACCTTGCTCCTGCCGAGAAAGTATCCATCATGGCTGATGCAATGCGGCGGCTGCATACGCTTGATCCGGCTACCTGCCCATTCGACCACCAAGCGAAACATCGCATCGAGCGAGCACGTACTCGGATGGAAGCCGGTCTTGTCGATCAGGATGATCTGGACGAAGAGCATCAGGGGCTCGCGCCAGCCGAACTGTTCGCCAGGCTCAAGGCGCGCATGCCCGACGGCGAGGATCTCGTCGTGACCCATGGCGATGCCTGCTTGCCGAATATCATGGTGGAAAATGGCCGCTTTTCTGGATTCATCGACTGTGGCCGGCTGGGTGTGGCGGACCGCTATCAGGACATAGCGTTGGCTACCCGTGATATTGCTGAAGAGCTTGGCGGCGAATGGGCTGACCGCTTCCTCGTGCTTTACGGTATCGCCGCTCCCGATTCGCAGCGCATCGCCTTCTATCGCCTTCTTGACGAGTTCTTCTGAACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTAGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTG".to_string(),
            features: vec![
                SequenceFeature {
                    id: "twist-entr-kozak-m13f".to_string(),
                    name: "M13 Forward (-20)".to_string(),
                    feature_type: "primer_bind".to_string(),
                    start: 8,
                    end: 24,
                    strand: 1,
                    color: "#0EA5E9".to_string(),
                    notes: Some("Universal M13 forward sequencing primer site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-entr-kozak-feat-1".to_string(),
                    name: "attL1 (Gateway Entry Site)".to_string(),
                    feature_type: "protein_bind".to_string(),
                    start: 69,
                    end: 168,
                    strand: 1,
                    color: "#DB2777".to_string(),
                    notes: Some("pTwist ENTR upstream λ-integrase recombination site for 1-hour LR Clonase transfer into any pDEST expression vector.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-entr-kozak-feat-2".to_string(),
                    name: "Twist Clonal Insertion / MCS".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 205,
                    end: 222,
                    strand: 1,
                    color: "#14B8A6".to_string(),
                    notes: Some("Unique cloning sites: NotI, AscI".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-entr-kozak-feat-3".to_string(),
                    name: "Kozak Consensus (GCCACC)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 267,
                    end: 272,
                    strand: 1,
                    color: "#06B6D4".to_string(),
                    notes: Some("Vertebrate 40S ribosome initiation consensus immediately upstream of ATG.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-entr-kozak-feat-4".to_string(),
                    name: "attL2 (Gateway Entry Site)".to_string(),
                    feature_type: "protein_bind".to_string(),
                    start: 309,
                    end: 396,
                    strand: 1,
                    color: "#DB2777".to_string(),
                    notes: Some("pTwist ENTR downstream λ-integrase recombination site.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-entr-kozak-feat-5".to_string(),
                    name: "pUC Origin (High Copy ~500–700)".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 433,
                    end: 1081,
                    strand: 1,
                    color: "#F59E0B".to_string(),
                    notes: Some("G->A mutated pMB1 origin lacking functional Rom/Rop regulation (~500–700 copies/cell); Twist High-Copy Accepted.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-entr-kozak-feat-6".to_string(),
                    name: "KanR (aph(3')-IIa)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 1118,
                    end: 1912,
                    strand: 1,
                    color: "#B91C1C".to_string(),
                    notes: Some("Aminoglycoside phosphotransferase conferring Kanamycin (50 µg/mL bacterial) and G418/Neomycin (mammalian) resistance; preferred for GMP/FDA vectors.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "twist-entr-kozak-prm-m13f".to_string(),
                    name: "M13-Fwd(-20)".to_string(),
                    sequence: "GTAAAACGACGGCCAGT".to_string(),
                    anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 8,
                    bind_end: 24,
                    strand: 1,
                    length: 17,
                    gc_percent: 52.9,
                    tm_anneal_c: 54.2,
                    tm_full_c: 54.2,
                    delta_g37: -21.4,
                    hairpin_delta_g: 0.4,
                    self_dimer_delta_g: -1.8,
                    gc_clamp3_prime: true,
                    notes: Some("Universal vector verification primer".to_string()),
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "hist-twist-entr-kozak".to_string(),
                    timestamp: "2026-10-30T21:18:22.696Z".to_string(),
                    operation: "Loaded from Twist Bioscience Vector Library".to_string(),
                    description: "pTwist ENTR Kozak (2,555 bp circular) — Twist Gateway Cloning".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 2555,
                    topology: Topology::Circular,
                    history_color: Some("#2563EB".to_string()),
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T21:18:22.696Z".to_string(),
            updated_at: "2026-10-30T21:18:22.696Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },
        SequenceDocument {
            id: "doc-twist-higg1-lalapgyte".to_string(),
            name: "pTwist CMV hIgG1 (LALAPG + YTE)".to_string(),
            accession: "TW_TWIST_CMV_HIGG1_LALAPGYTE".to_string(),
            description: "[Twist Bioscience • Antibody & Fc Fusion] Therapeutic-grade human IgG1 backbone combining L234A/L235A/P329G Fc-silencing with M252Y/S254T/T256E half-life extension. | Host: Mammalian (Expi293/CHO) | Origin: pUC (high) | Selection: Ampicillin | Strain: DH10B (37°C)".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "CGACGTTGTAAAACGACGGCCAGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCCGTTACATAACTTACGGTAAATGGCCCGCCTGGCTGACCGCCCAACGACCCCCGCCCATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAGGGACTTTCCATTGACGTCAATGGGTGGAGTATTTACGGTAAACTGCCCACTTGGCAGTACATCAAGTGTATCATATGCCAAGTACGCCCCCTATTGACGTCAATGACGGTAAATGGCCCGCCTGGCATTATGCCCAGTACATGACCTTATGGGACTTTCCTACTTGGCAGTACATCTACGTATTAGTCATCGCTATTACCATGGTGATGCGGTTTTGGCAGTACATCAATGGGCGTGGATAGCGGTTTGACTCACGGGGATTTCCAAGTCTCCACCCCATTGACGTCAATGGGAGTTTGTTTTGGCACCAAAATCAACGGGACTTTCCAAAATGTCGTAACAACTCCGCCCCATTGACGCAAATGGGCGGTAGGCGTGTACGGTGGGAGGTCTATATAAGCAGAGCTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTGAATTCCAGCTAGCCAGCGGCCGCACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCGCCACCCGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCAATGGAGACAGACACACTCCTGCTATGGGTACTGCTGCTCTGGGTTCCAGGTTCCACTGGTGACGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAGAGCCCAAATCTTGTGACAAAACTCACACATGCCCACCGTGCCCAGCACCTGAAGCCGCGGGGGGACCGTCAGTCTTCCTCTTCCCCCCAAAACCCAAGGACACCCTCTACATCACCCGGGAGCCTGAGGTCACATGCGTGGTGGTGGACGTGAGCCACGAAGACCCTGAGGTCAAGTTCAACTGGTACGTGGACGGCGTGGAGGTGCATAATGCCAAGACAAAGCCGCGGGAGGAGCAGTACAACAGCACGTACCGTGTGGTCAGCGTCCTCACCGTCCTGCACCAGGACTGGCTGAATGGCAAGGAGTACAAGTGCAAGGTCTCCAACAAAGCCCTCGGCGCCCCCATCGAGAAAACCATCTCCAAAGCCAAAGGGCAGCCCCGAGAACCACAGGTGTACACCCTGCCCCCATCCCGGGATGAGCTGACCAAGAACCAGGTCAGCCTGACCTGCCTGGTCAAAGGCTTCTATCCCAGCGACATCGCCGTGGAGTGGGAGAGCAATGGGCAGCCGGAGAACAACTACAAGACCACGCCTCCCGTGCTGGACTCCGACGGCTCCTTCTTCCTCTACAGCAAGCTCACCGTGGACAAGAGCAGGTGGCAGCAGGGGAACGTCTTCTCATGCTCCGTGATGCATGAGGCTCTGCACAACCACTACACGCAGAAGAGCCTCTCCCTGTCTCCGGGTAAATGATGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGTGCCTTCTAGTTGCCAGCCATCTGTTGTTTGCCCCTCCCCCGTGCCTTCCTTGACCCTGGAAGGTGCCACTCCCACTGTCCTTTCCTAATAAAATGAGGAAATTGCATCGCATTGTCTGAGTAGGTGTCATTCTATTCTGGGGGGTGGGGTGGGGCAGGACAGCAAGGGGGAGGATTGGGAAGACAATAGCAGGCATGCTGGGGATGCGGTGGGCTCTATGGACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTATTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGCGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCAATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAAGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTT".to_string(),
            features: vec![
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-m13f".to_string(),
                    name: "M13 Forward (-20)".to_string(),
                    feature_type: "primer_bind".to_string(),
                    start: 8,
                    end: 24,
                    strand: 1,
                    color: "#0EA5E9".to_string(),
                    notes: Some("Universal M13 forward sequencing primer site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-1".to_string(),
                    name: "CMV Promoter/Enhancer".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 69,
                    end: 576,
                    strand: 1,
                    color: "#2563EB".to_string(),
                    notes: Some("Human cytomegalovirus immediate-early enhancer/promoter; ultra-strong transient expression in HEK293, CHO, HeLa; prone to silencing in stem/primary cells.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-2".to_string(),
                    name: "Twist Clonal Insertion / MCS".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 613,
                    end: 636,
                    strand: 1,
                    color: "#14B8A6".to_string(),
                    notes: Some("Unique cloning sites: EcoRI, NheI, NotI".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-3".to_string(),
                    name: "Kozak Consensus (GCCACC)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 681,
                    end: 686,
                    strand: 1,
                    color: "#06B6D4".to_string(),
                    notes: Some("Vertebrate 40S ribosome initiation consensus immediately upstream of ATG.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-4".to_string(),
                    name: "Murine Igκ Secretion Leader".to_string(),
                    feature_type: "sig_peptide".to_string(),
                    start: 723,
                    end: 785,
                    strand: 1,
                    color: "#0891B2".to_string(),
                    notes: Some("High-efficiency Ig kappa chain ER secretion leader for recombinant mAbs, Fc-fusions, and cytokines.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-5".to_string(),
                    name: "Human IgG1 Fc (LALA-PG + YTE Engineered)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 822,
                    end: 1520,
                    strand: 1,
                    color: "#4F46E5".to_string(),
                    notes: Some("pTwist CMV hIgG1 L234A/L235A/P329G (ablated FcγR/C1q effector toxicity) + M252Y/S254T/T256E (3–4x enhanced FcRn serum half-life).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-6".to_string(),
                    name: "bGH Poly(A) Signal".to_string(),
                    feature_type: "terminator".to_string(),
                    start: 1557,
                    end: 1781,
                    strand: 1,
                    color: "#64748B".to_string(),
                    notes: Some("Bovine growth hormone polyadenylation signal (pcDNA3.1 / pTwist CMV); efficient 3' cleavage and poly-A tailing.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-7".to_string(),
                    name: "pUC Origin (High Copy ~500–700)".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 1818,
                    end: 2466,
                    strand: 1,
                    color: "#F59E0B".to_string(),
                    notes: Some("G->A mutated pMB1 origin lacking functional Rom/Rop regulation (~500–700 copies/cell); Twist High-Copy Accepted.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "twist-cmv-higg1-lalapgyte-feat-8".to_string(),
                    name: "AmpR (bla β-Lactamase)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 2503,
                    end: 3363,
                    strand: 1,
                    color: "#DC2626".to_string(),
                    notes: Some("TEM-1 β-lactamase conferring Ampicillin / Carbenicillin resistance (100 µg/mL in E. coli).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "twist-cmv-higg1-lalapgyte-prm-m13f".to_string(),
                    name: "M13-Fwd(-20)".to_string(),
                    sequence: "GTAAAACGACGGCCAGT".to_string(),
                    anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 8,
                    bind_end: 24,
                    strand: 1,
                    length: 17,
                    gc_percent: 52.9,
                    tm_anneal_c: 54.2,
                    tm_full_c: 54.2,
                    delta_g37: -21.4,
                    hairpin_delta_g: 0.4,
                    self_dimer_delta_g: -1.8,
                    gc_clamp3_prime: true,
                    notes: Some("Universal vector verification primer".to_string()),
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "hist-twist-cmv-higg1-lalapgyte".to_string(),
                    timestamp: "2026-10-30T21:18:22.696Z".to_string(),
                    operation: "Loaded from Twist Bioscience Vector Library".to_string(),
                    description: "pTwist CMV hIgG1 (LALAPG + YTE) (5,480 bp circular) — Twist Engineered Antibody".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 5480,
                    topology: Topology::Circular,
                    history_color: Some("#2563EB".to_string()),
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T21:18:22.696Z".to_string(),
            updated_at: "2026-10-30T21:18:22.696Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },
        SequenceDocument {
            id: "doc-vb-plv-ef1a".to_string(),
            name: "pLV[Exp]-EF1A>MCS-T2A-EGFP-P2A-Puro".to_string(),
            accession: "MO_VB_PLV_EF1A_EGFP_T2A_PURO".to_string(),
            description: "[Modular Vector Systems • Viral Transfer & Packaging] Flagship modular tricistronic 3rd-generation lentiviral expression backbone driving GOI, EGFP, and Puromycin from full-length EF1A. | Host: Mammalian Lentivirus (3rd-Gen) | Origin: pUC (high) | Selection: Ampicillin / Puromycin + EGFP | Strain: Stbl3 / VB UltraStable (30°C)".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "CGACGTTGTAAAACGACGGCCAGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCTGGAAGGGCTAATTCACTCCCAACGAAGACAAGATCTGCTTTTTGCTTGTACTGGGTCTCTCTGGTTAGACCAGATCTGAGCCTGGGAGCTCTCTGGCTAACTAGGGAACCCACTGCTTAAGCCTCAATAAAGCTTGCCTTGAGTGCTTCAAGTAGTGTGTGCCCGTCTGTTGTGTGACTCTGGTAACTAGAGATCCCTCAGACCCTTTTAGTCAGTGTGGAAAATCTCTAGCATGCATGACGTCTGACTGACGTAGTCATGACGTACGTGGCTCCGGTGCCCGTCAGTGGGCAGAGCGCACATCGCCCACAGTCCCCGAGAAGTTGGGGGGAGGGGTCGGCAATTGAACCGGTGCCTAGAGAAGGTGGCGCGGGGTAAACTGGGAAAGTGATGTCGTGTACTGGCTCCGCCTTTTTCCCGAGGGTGGGGGAGAACCGTATATAAGTGCAGTAGTCGCCGTGAACGTTCTTTTTCGCAACGGGTTTGCCGCCAGAACACAGGTAAGTGCCGTGTGTGGTTCCCGCGGGCCTGGCCTCTTTACGGGTTATGGCCCTTGCGTGCCTTGAATTACTTCCACCTGGCTGCAGTACGTGATTCTTGATCCCGAGCTTCGGGTTGGAAGTGGGTGGGAGAGTTCGAGGCCTTGCGCTTAAGGAGCCCCTTCGCCTCGTGCTTGAGTTGAGGCCTGGCCTGGGCGCTGGGGCCGCCGCGTGCGAATCTGGTGGCACCTTCGCGCCTGTCTCGCTGCTTTCGATAAGTCTCTAGCCATTTAAAATTTTTGATGACCTGCTGCGACGCTTTTTTTCTGGCAAGATAGTCTTGTAAATGCGGGCCAAGATCTGCACACTGGTATTTCGGTTTTTGGGGCCGCGGGCGGCGACGGGGCCCGTGCGTCCCAGCGCACATGTTCGGCGAGGCGGGGCCTGCGAGCGCGGCCACCGAGAATCGGACGGGGGTAGTCTCAAGCTGGCCGGCCTGCTCTGGTGCCTGGCCTCGCGCCGCCGTGTATCGCCCCGCCCTGGGCGGCAAGGCTGGCCCGGTCGGCACCAGTTGCGTGAGCGGAAAGATGGCCGCTTCCCGGCCCTGCTGCAGGGAGCTCAAAATGGAGGACGCGGCGCTCGGGAGAGCGGGCGGGTGAGTCACCCACACAAAGGAAAAGGGCCTTTCCGTCCTCAGCCGTCGCTTCATGTGACTCCACGGAGTACCGGGCGCCGTCCAGGCACCTCGATTAGTTCTCGAGCTTTTGGAGTACGTCGTCTTTAGGTTGGGGGGAGGGGTTTTATGCGATGGAGTTTCCCCACACTGAGTGGGTGGAGACTGAAGTTAGGCCAGCTTGGCACTTGATGTAATTCTCCTTGGAATTTGCCCTTTTTGAGTTTGGATCTTGGTTCATTCTCAAGCCTCAGACAGTGGTTCAAAGTTTTTTTCTTCCATTTCAGGTGTCGTGAACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTAGAATTCCAGGATCCCAGCGGCCGCCAGCTAGCACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCGCCACCGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAGACTACAAAGACCATGACGGTGATTATAAAGATCATGACATCGACTACAAGGATGACGATGACAAGTGCATGACGTCTGACTGACGTAGTCATGACGTACGTGGAAGCGGAGAGGGCAGAGGAAGTCTGCTAACATGCGGTGACGTCGAGGAGAATCCTGGACCTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTAATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCAGGAAGCGGAGCTACTAACTTCAGCCTGCTGAAGCAGGCTGGAGACGTGGAGGAGAACCCTGGACCTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAATGACCGAGTACAAGCCCACGGTGCGCCTCGCCACCCGCGACGACGTCCCCAGGGCCGTACGCACCCTCGCCGCCGCGTTCGCCGACTACCCCGCCACGCGCCACACCGTCGATCCGGACCGCCACATCGAGCGGGTCACCGAGCTGCAAGAACTCTTCCTCACGCGCGTCGGGCTCGACATCGGCAAGGTGTGGGTCGCGGACGACGGCGCCGCGGTGGCGGTCTGGACCACGCCGGAGAGCGTCGAAGCGGGGGCGGTGTTCGCCGAGATCGGCCCGCGCATGGCCGAGTTGAGCGGTTCCCGGCTGGCCGCGCAGCAACAGATGGAAGGCCTCCTGGCGCCGCACCGGCCCAAGGAGCCCGCGTGGTTCCTGGCCACCGTCGGCGTCTCGCCCGACCACCAGGGCAAGGGTCTGGGCAGCGCCGTCGTGCTCCCCGGAGTGGAGGCGGCCGAGCGCGCCGGGGTGCCCGCCTTCCTGGAGACCTCCGCGCCCCGCAACCTCCCCTTCTACGAGCGGCTCGGCTTCACCGTCACCGCCGACGTCGAGGTGCCCGAAGGACCGCGCACCTGGTGCATGACCCGCAAGCCCGGTGCCTGATGCATGACGTCTGACTGACGTAGTCATGACGTACGTAATCAACCTCTGGATTACAAAATTTGTGAAAGATTGACTGGTATTCTTAACTATGTTGCTCCTTTTACGCTATGTGGATACGCTGCTTTAATGCCTTTGTATCATGCTATTGCTTCCCGTATGGCTTTCATTTTCTCCTCCTTGTATAAATCCTGGTTGCTGTCTCTTTATGAGGAGTTGTGGCCCGTTGTCAGGCAACGTGGCGTGGTGTGCACTGTGTTTGCTGACGCAACCCCCACTGGTTGGGGCATTGCCACCACCTGTCAGCTCCTTTCCGGGACTTTCGCTTTCCCCCTCCCTATTGCCACGGCGGAACTCATCGCCGCCTGCCTTGCCCGCTGCTGGACAGGGGCTCGGCTGTTGGGCACTGACAATTCCGTGGTGTTGTCGGGGAAATCATCGTCCTTTCCTTGGCTGCTCGCCTGTGTTGCCACCTGGATTCTGCGCGGGACGTCCTTCTGCTACGTCCCTTCGGCCCTCAATCCAGCGGACCTTCCTTCCCGCGGCCTGCTGCCGGCTCTGCGGCCTCTTCCGCGTCTTCGCCTTCGCCCTCAGACGAGTCGGATCTCCCTTTGGGCCGCCTCCCCGCACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTATGGAAGGGCTAATTCACTCCCAACGAAGACAAGATCTGCTTTTTGCTTGTACTGGGTCTCTCTGGTTAGACCAGATCTGAGCCTGGGAGCTCTCTGGCTAACTAGGGAACCCACTGCTTAAGCCTCAATAAAGCTTGCCTTGAGTGCTTCAAGTAGTGTGTGCCCGTCTGTTGTGTGACTCTGGTAACTAGAGATCCCTCAGACCCTTTTAGTCAGTGTGGAAAATCTCTAGCACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAATGCATGACGTCTGACTGACGTAGTCATGACGTACGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGC".to_string(),
            features: vec![
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-m13f".to_string(),
                    name: "M13 Forward (-20)".to_string(),
                    feature_type: "primer_bind".to_string(),
                    start: 8,
                    end: 24,
                    strand: 1,
                    color: "#0EA5E9".to_string(),
                    notes: Some("Universal M13 forward sequencing primer site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-1".to_string(),
                    name: "HIV-1 3' ΔU3 SIN LTR".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 69,
                    end: 302,
                    strand: 1,
                    color: "#BE123C".to_string(),
                    notes: Some("Self-inactivating U3-deleted lentiviral LTR preventing replication-competent virus and enhancer oncogenesis.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-2".to_string(),
                    name: "EF1A (Full-Length + Intron 1)".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 339,
                    end: 1517,
                    strand: 1,
                    color: "#1D4ED8".to_string(),
                    notes: Some("Human EEF1A1 promoter with first intron; strong, silencing-resistant constitutive expression across ESCs, iPSCs, T cells, neurons, and lentiviral vectors.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-3".to_string(),
                    name: "Multiple Cloning Site (MCS)".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 1554,
                    end: 1585,
                    strand: 1,
                    color: "#14B8A6".to_string(),
                    notes: Some("Unique cloning sites: EcoRI, BamHI, NotI, NheI".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-4".to_string(),
                    name: "Kozak Consensus (GCCACC)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 1630,
                    end: 1635,
                    strand: 1,
                    color: "#06B6D4".to_string(),
                    notes: Some("Vertebrate 40S ribosome initiation consensus immediately upstream of ATG.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-5".to_string(),
                    name: "3xFLAG Tag".to_string(),
                    feature_type: "tag".to_string(),
                    start: 1672,
                    end: 1737,
                    strand: 1,
                    color: "#A855F7".to_string(),
                    notes: Some("Tandem 22-aa 3xFLAG epitope; 20–200x higher detection sensitivity for ChIP, Co-IP, and endogenous knock-in.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-6".to_string(),
                    name: "GSG-T2A (Thosea asigna 2A)".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 1774,
                    end: 1836,
                    strand: 1,
                    color: "#0D9488".to_string(),
                    notes: Some("63 bp 2A peptide; orthogonal sequence to P2A to prevent recombination in tricistronic P2A + T2A vectors.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-7".to_string(),
                    name: "EGFP".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 1873,
                    end: 2592,
                    strand: 1,
                    color: "#10B981".to_string(),
                    notes: Some("Enhanced GFP (Ex 488 nm / Em 507 nm, F64L/S65T); standard green fluorescent reporter.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-8".to_string(),
                    name: "GSG-P2A (Porcine Teschovirus 2A)".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 2629,
                    end: 2694,
                    strand: 1,
                    color: "#0D9488".to_string(),
                    notes: Some("Highest ribosome-skipping efficiency (>95%) in human, mouse, and zebrafish cells for 1:1 stoichiometric co-expression.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-9".to_string(),
                    name: "PuroR (pac Puromycin)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 2731,
                    end: 3330,
                    strand: 1,
                    color: "#EA580C".to_string(),
                    notes: Some("Streptomyces puromycin N-acetyltransferase; rapid 2–4 day mammalian stable cell selection (1–5 µg/mL puromycin).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-10".to_string(),
                    name: "WPRE (Woodchuck Post-Transcriptional Element)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 3367,
                    end: 3955,
                    strand: 1,
                    color: "#475569".to_string(),
                    notes: Some("Boosts intronless viral/transgene mRNA nuclear export and steady-state expression 3–8 fold (mutated X-protein start codon).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-11".to_string(),
                    name: "HIV-1 3' ΔU3 SIN LTR".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 3992,
                    end: 4225,
                    strand: 1,
                    color: "#BE123C".to_string(),
                    notes: Some("Self-inactivating U3-deleted lentiviral LTR preventing replication-competent virus and enhancer oncogenesis.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-12".to_string(),
                    name: "pUC Origin (High Copy ~500–700)".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 4262,
                    end: 4910,
                    strand: 1,
                    color: "#F59E0B".to_string(),
                    notes: Some("G->A mutated pMB1 origin lacking functional Rom/Rop regulation (~500–700 copies/cell); Twist High-Copy Accepted.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-plv-ef1a-egfp-t2a-puro-feat-13".to_string(),
                    name: "AmpR (bla β-Lactamase)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 4947,
                    end: 5807,
                    strand: 1,
                    color: "#DC2626".to_string(),
                    notes: Some("TEM-1 β-lactamase conferring Ampicillin / Carbenicillin resistance (100 µg/mL in E. coli).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "vb-plv-ef1a-egfp-t2a-puro-prm-m13f".to_string(),
                    name: "M13-Fwd(-20)".to_string(),
                    sequence: "GTAAAACGACGGCCAGT".to_string(),
                    anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 8,
                    bind_end: 24,
                    strand: 1,
                    length: 17,
                    gc_percent: 52.9,
                    tm_anneal_c: 54.2,
                    tm_full_c: 54.2,
                    delta_g37: -21.4,
                    hairpin_delta_g: 0.4,
                    self_dimer_delta_g: -1.8,
                    gc_clamp3_prime: true,
                    notes: Some("Universal vector verification primer".to_string()),
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "hist-vb-plv-ef1a-egfp-t2a-puro".to_string(),
                    timestamp: "2026-10-30T21:18:22.696Z".to_string(),
                    operation: "Loaded from Modular Vector Systems Vector Library".to_string(),
                    description: "pLV[Exp]-EF1A>MCS-T2A-EGFP-P2A-Puro (8,620 bp circular) — Modular pLV Lentiviral".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 8620,
                    topology: Topology::Circular,
                    history_color: Some("#2563EB".to_string()),
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T21:18:22.696Z".to_string(),
            updated_at: "2026-10-30T21:18:22.696Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },
        SequenceDocument {
            id: "doc-vb-paav-syn1-gcamp8f".to_string(),
            name: "pAAV[Exp]-hSyn1>jGCaMP8f:WPRE3".to_string(),
            accession: "MO_VB_PAAV_SYN1_GCAMP8F".to_string(),
            description: "[Modular Vector Systems • Viral Transfer & Packaging] Size-optimized AAV transfer plasmid (~2.4 kb ITR-to-ITR) pairing pan-neuronal hSyn1, jGCaMP8f, and compact WPRE3 for in vivo two-photon calcium imaging. | Host: Mammalian CNS AAV (AAV9 / PHP.eB) | Origin: pUC (high) | Selection: Ampicillin | Strain: VB UltraStable / Stbl3 (30°C)".to_string(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Circular,
            sequence: "CGACGTTGTAAAACGACGGCCAGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCCCTGCAGGCAGCTGCGCGCTCGCTCGCTCACTGAGGCCGCCCGGGCAAAGCCCGGGCGTCGGGCGACCTTTGGTCGCCCGGCCTCAGTGAGCGAGCGAGCGCGCAGAGAGGGAGTGGCCAACTCCATCACTAGGGGTTCCTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTAGTGCAAGTGGGTTTTAGGACCAGGATGAGGCGGGGTGGGGGTGCCTACCTGACGACCGACCCCGACCCACTGGACAAGCACCCAACCCCCATTCCCCAAATTGCGCATCCCCTATCAGAGAGGGGGAGGGGAAACAGGATGCGGCGAGGCGCGTGCGCACTGCCAGCTTCAGCACCGCGGACAGTGCCTTCGCCCCCGCCTGGCGGCGCGCGCCACCGCCGCCTCAGCACTGAAGGCGCGCTGACGTCACTCGCCGGTCCCCCGCAAACTCCCCTTCCCGGCCACCTTGGTCGCGTCCGCGCCGCCGCCGGCCCAGCCGGACCGCACCACGCGAGGCGCGAGATAGGGGGGCACGGGCGCGACCATCTGCGCTGCGGCGCCGGCGACTCAGCGCTGCCTCAGTCTGCGGTGGGCAGCGGAGGAGTCGTGTCGTGCCTGAGAGCGCAGACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTAGGATCCCAGAATTCCAAAGCTTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCGCCACCGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCAATGGGTTCTCATCATCATCATCATCATGGTATGGCTAGCATGACTGGTGGACAGCAAATGGGTCGGGATCTGTACGACGATGACGATAAGGATCTCGCCACCATGGTCGACTCATCACGTCGTAAGTGGAATAAGGCAGGTCACGCAGTCAGAGCTATAGGTCGGCTGAGCTCACTCGAGAACGTGTACATCAAAGGCCGCAAGCAGAAGAACGGCATCAAGGCGAACTTCAAGATCCGCCACAACATCGAGGACGGCGGCGTGCAGCTCGCCTACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCGTGCAGTCCAAACTTTCGAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGGGTGGTACCGGAGGGAGCATGGACCAACTGACAGAAAGCAGATTGCTGCAGGACTTTCACAAGAAACTGGATAAAGACGGTGATGGTTATATCAGCGCAGAGGAGTTGCAGGTGATGACAAACTTAGGAGAAAAGCTAACAGATGAAGAGGTTGATGAAATGATCAGAGAAGCAGATATTGATGGAGATGGTCAGGTAAACTATGAAGAGTTTGTACAAATGATGACAGCAAAGTGATGCATGACGTCTGACTGACGTAGTCATGACGTACGTGATAATCAACCTCTGGATTACAAAATTTGTGAAAGATTGACTGGTATTCTTAACTATGTTGCTCCTTTTACGCTATGTGGATACGCTGCTTTAATGCCTTTGTATCATGCTATTGCTTCCCGTATGGCTTTCATTTTCTCCTCCTTGTATAAATCCTGGTTAGTTCTTGCCACGGCGGAACTCATCGCCGCCTGCCTTGCCCGCTGCTGGACAGGGGCTCGGCTGTTGGGCACTGACAATTCCGTGGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACAGACATGATAAGATACATTGATGAGTTTGGACAAACCACAACTAGAATGCAGTGAAAAAAATGCTTTATTTGTGAAATTTGTGATGCTATTGCTTTATTTGTAACCATTATAAGCTGCAATAAACAAGTTAACACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCACCTGCAGGCAGCTGCGCGCTCGCTCGCTCACTGAGGCCGCCCGGGCAAAGCCCGGGCGTCGGGCGACCTTTGGTCGCCCGGCCTCAGTGAGCGAGCGAGCGCGCAGAGAGGGAGTGGCCAACTCCATCACTAGGGGTTCCTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATGTGCATGACGTCTGACTGACGTAGTCATGACGTACGTATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAAACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTAGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACGTACCTGAGTCAGTCATGCTAGTCGTACAGTGTCATGACTGACGTAGCTAGTCATGCTGACGTTGCATGACGTCTGACTGACGTAGTCATGACGTACGTCTGATGCTAGTCAGTCGATGCTACGTGACG".to_string(),
            features: vec![
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-m13f".to_string(),
                    name: "M13 Forward (-20)".to_string(),
                    feature_type: "primer_bind".to_string(),
                    start: 8,
                    end: 24,
                    strand: 1,
                    color: "#0EA5E9".to_string(),
                    notes: Some("Universal M13 forward sequencing primer site".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-1".to_string(),
                    name: "AAV2 145 bp ITR (Flip/Flop)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 69,
                    end: 209,
                    strand: 1,
                    color: "#BE123C".to_string(),
                    notes: Some("T-hairpin inverted terminal repeat required in cis for AAV Rep-mediated rescue and capsid packaging (4.7 kb max ITR-to-ITR).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-2".to_string(),
                    name: "hSyn1 (Human Synapsin 1)".to_string(),
                    feature_type: "promoter".to_string(),
                    start: 246,
                    end: 693,
                    strand: 1,
                    color: "#0284C7".to_string(),
                    notes: Some("Compact 469 bp pan-neuronal promoter; gold-standard for AAV brain/CNS expression of GCaMP, optogenetics, and DREADDs without glial leakiness.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-3".to_string(),
                    name: "Multiple Cloning Site (MCS)".to_string(),
                    feature_type: "misc_feature".to_string(),
                    start: 730,
                    end: 751,
                    strand: 1,
                    color: "#14B8A6".to_string(),
                    notes: Some("Unique cloning sites: BamHI, EcoRI, HindIII".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-4".to_string(),
                    name: "Kozak Consensus (GCCACC)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 796,
                    end: 801,
                    strand: 1,
                    color: "#06B6D4".to_string(),
                    notes: Some("Vertebrate 40S ribosome initiation consensus immediately upstream of ATG.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-5".to_string(),
                    name: "jGCaMP8f (Fast Calcium Sensor)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 838,
                    end: 1524,
                    strand: 1,
                    color: "#059669".to_string(),
                    notes: Some("Janelia 8th-generation fast genetically encoded calcium indicator for millisecond neuronal action potential imaging.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-6".to_string(),
                    name: "WPRE3 (Compact γ+α WPRE)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 1561,
                    end: 1808,
                    strand: 1,
                    color: "#475569".to_string(),
                    notes: Some("247 bp minimal WPRE retaining ~85% activity while saving 342 bp of precious AAV packaging capacity.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-7".to_string(),
                    name: "SV40 Late Poly(A) Signal".to_string(),
                    feature_type: "terminator".to_string(),
                    start: 1845,
                    end: 1979,
                    strand: 1,
                    color: "#64748B".to_string(),
                    notes: Some("Compact 135 bp SV40 bidirectional/late polyadenylation signal ideal for AAV and dual-cistron plasmids.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-8".to_string(),
                    name: "AAV2 145 bp ITR (Flip/Flop)".to_string(),
                    feature_type: "regulatory".to_string(),
                    start: 2016,
                    end: 2156,
                    strand: 1,
                    color: "#BE123C".to_string(),
                    notes: Some("T-hairpin inverted terminal repeat required in cis for AAV Rep-mediated rescue and capsid packaging (4.7 kb max ITR-to-ITR).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-9".to_string(),
                    name: "pUC Origin (High Copy ~500–700)".to_string(),
                    feature_type: "rep_origin".to_string(),
                    start: 2193,
                    end: 2841,
                    strand: 1,
                    color: "#F59E0B".to_string(),
                    notes: Some("G->A mutated pMB1 origin lacking functional Rom/Rop regulation (~500–700 copies/cell); Twist High-Copy Accepted.".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                },
                SequenceFeature {
                    id: "vb-paav-syn1-gcamp8f-feat-10".to_string(),
                    name: "AmpR (bla β-Lactamase)".to_string(),
                    feature_type: "CDS".to_string(),
                    start: 2878,
                    end: 3738,
                    strand: 1,
                    color: "#DC2626".to_string(),
                    notes: Some("TEM-1 β-lactamase conferring Ampicillin / Carbenicillin resistance (100 µg/mL in E. coli).".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }
            ],
            primers: vec![
                PrimerRecord {
                    id: "vb-paav-syn1-gcamp8f-prm-m13f".to_string(),
                    name: "M13-Fwd(-20)".to_string(),
                    sequence: "GTAAAACGACGGCCAGT".to_string(),
                    anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
                    tail5_prime: "".to_string(),
                    bind_start: 8,
                    bind_end: 24,
                    strand: 1,
                    length: 17,
                    gc_percent: 52.9,
                    tm_anneal_c: 54.2,
                    tm_full_c: 54.2,
                    delta_g37: -21.4,
                    hairpin_delta_g: 0.4,
                    self_dimer_delta_g: -1.8,
                    gc_clamp3_prime: true,
                    notes: Some("Universal vector verification primer".to_string()),
                    tm_no_answer_reason: None,
                }
            ],
            history: vec![
                HistoryTreeNode {
                    id: "hist-vb-paav-syn1-gcamp8f".to_string(),
                    timestamp: "2026-10-30T21:18:22.696Z".to_string(),
                    operation: "Loaded from Modular Vector Systems Vector Library".to_string(),
                    description: "pAAV[Exp]-hSyn1>jGCaMP8f:WPRE3 (5,280 bp circular) — Modular Neuroscience AAV".to_string(),
                    parent_ids: Vec::new(),
                    length_bp: 5280,
                    topology: Topology::Circular,
                    history_color: Some("#2563EB".to_string()),
                    inserted_range: None,
                }
            ],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: "2026-10-30T21:18:22.696Z".to_string(),
            updated_at: "2026-10-30T21:18:22.696Z".to_string(),
            folder: "Plasmids & Vectors".to_string(),
        },

        // =========================================================================
        // CONTIG ASSEMBLY (7 authentic documents from get_contig_assembly_sample_documents())
        // =========================================================================

        // =========================================================================
        // PRIMERS (7 distinct non-overlapping primers)
        // =========================================================================
        make_sample_doc(
            "doc-primer-cmv-fwd",
            "CMV_IE_Enhancer_Fwd",
            "MBC_PRM_001",
            "Forward sequencing primer hybridizing near the 3' TATA box of the human CMV immediate-early promoter.",
            MoleculeType::DNA,
            Topology::Linear,
            "CGCAAATGGGCGGTAGGCGTG",
            vec![make_feat("prm-cmvf", "CMV_IE_Fwd", "primer_bind", 1, 21, 1, "#16a34a", None)],
            None,
            "primer",
            make_meta(&[
                design_primer_gc("CGCAAATGGGCGGTAGGCGTG"),
                (
                    "Source record",
                    serde_json::json!(
                        "GenBank X17403.1 (human cytomegalovirus strain AD169, complete genome), \
                         minus strand 173,774-173,794; the record annotates UL123 (IE1) exon 1 at \
                         173,610-173,730"
                    ),
                ),
                ("Oligo Type", serde_json::json!("Forward Primer")),
                ("Organism", serde_json::json!("Synthetic oligonucleotide")),
            ]),
            "2026-10-30T09:40:00Z",
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-ef1a-fwd",
            "EF1a_IntronA_Seq_Fwd",
            "MBC_PRM_002",
            "Forward verification oligonucleotide for mammalian and lentiviral human EF1-alpha promoter expression cassettes.",
            MoleculeType::DNA,
            Topology::Linear,
            "TCAAGCCTCAGACAGTGGTTC",
            vec![make_feat("prm-ef1a", "EF1a_Fwd", "primer_bind", 1, 21, 1, "#16a34a", None)],
            None,
            "primer",
            make_meta(&[
                design_primer_gc("TCAAGCCTCAGACAGTGGTTC"),
                (
                    "Source record",
                    serde_json::json!(
                        "RefSeq NC_000006.12 (GRCh38.p14 chromosome 6), minus strand \
                         73,520,080-73,520,100, inside EEF1A1 (73,515,750-73,521,032, minus strand)"
                    ),
                ),
                ("Oligo Type", serde_json::json!("Forward Primer")),
                ("Organism", serde_json::json!("Synthetic oligonucleotide")),
            ]),
            "2026-10-30T09:40:30Z",
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-bgh-rev",
            "bGH_PolyA_Reverse",
            "MBC_PRM_003",
            "Reverse sequencing oligonucleotide binding upstream of the bovine growth hormone polyadenylation signal.",
            MoleculeType::DNA,
            Topology::Linear,
            "TAGAAGGCACAGTCGAGG",
            vec![make_feat("prm-bghr", "bGH_PolyA_Rev", "primer_bind", 1, 18, -1, "#dc2626", None)],
            None,
            "primer",
            make_meta(&[
                design_primer_gc("TAGAAGGCACAGTCGAGG"),
                (
                    "Source publication",
                    serde_json::json!(
                        "BGH-R, printed 5'-TAGAAGGCACAGTCGAGG-3' by Yamada M et al., Sci Rep \
                         14:6506 (2024), doi:10.1038/s41598-024-56704-z"
                    ),
                ),
                ("Oligo Type", serde_json::json!("Reverse Primer")),
                ("Organism", serde_json::json!("Synthetic oligonucleotide")),
            ]),
            "2026-10-30T09:41:00Z",
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-wpre-rev",
            "WPRE_3Prime_Verify_Rev",
            "MBC_PRM_004",
            "Reverse colony-PCR and Sanger verification primer targeting woodchuck hepatitis post-transcriptional regulatory element (WPRE) in AAV and lentiviral vectors.",
            MoleculeType::DNA,
            Topology::Linear,
            "CATAGCGTAAAAGGAGCAACA",
            vec![make_feat("prm-wprer", "WPRE_Rev", "primer_bind", 1, 21, -1, "#dc2626", None)],
            None,
            "primer",
            make_meta(&[
                design_primer_gc("CATAGCGTAAAAGGAGCAACA"),
                (
                    "Source record",
                    serde_json::json!(
                        "GenBank J04514.1 (woodchuck hepatitis B virus WHV8, complete genome), \
                         minus strand 1,146-1,166"
                    ),
                ),
                ("Oligo Type", serde_json::json!("Reverse Primer")),
                ("Organism", serde_json::json!("Synthetic oligonucleotide")),
            ]),
            "2026-10-30T09:41:30Z",
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-16s-27f",
            "16S_rRNA_27F_Universal",
            "MBC_PRM_005",
            "Degenerate bacterial 16S ribosomal RNA V1-V9 broad-range taxonomic barcoding forward primer.",
            MoleculeType::DNA,
            Topology::Linear,
            "AGAGTTTGATCMTGGCTCAG",
            vec![make_feat("prm-27f", "16S_27F", "primer_bind", 1, 20, 1, "#16a34a", None)],
            None,
            "primer",
            make_meta(&[
                design_primer_gc("AGAGTTTGATCMTGGCTCAG"),
                (
                    "Source publication",
                    serde_json::json!(
                        "27f-CM, printed 5'-AGAGTTTGATCMTGGCTCAG-3' by Frank JA et al., Appl \
                         Environ Microbiol 74:2461-2470 (2008), doi:10.1128/AEM.02272-07"
                    ),
                ),
                ("Oligo Type", serde_json::json!("Degenerate Barcoding Forward")),
                ("Organism", serde_json::json!("Bacteria universal target")),
            ]),
            "2026-10-30T09:42:00Z",
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-16s-1492r",
            "16S_rRNA_1492R_Universal",
            "MBC_PRM_006",
            "Degenerate bacterial 16S ribosomal RNA full-length amplicon reverse barcoding primer.",
            MoleculeType::DNA,
            Topology::Linear,
            "TACGGYTACCTTGTTACGACTT",
            vec![make_feat("prm-1492r", "16S_1492R", "primer_bind", 1, 22, -1, "#dc2626", None)],
            None,
            "primer",
            make_meta(&[
                design_primer_gc("TACGGYTACCTTGTTACGACTT"),
                (
                    "Source publication",
                    serde_json::json!(
                        "1492R, printed 5'-TACGGYTACCTTGTTACGACTT-3' by Halim MA et al., Microbiol \
                         Resour Announc 14(6):e01309-24 (2025), doi:10.1128/mra.01309-24"
                    ),
                ),
                ("Oligo Type", serde_json::json!("Degenerate Barcoding Reverse")),
                ("Organism", serde_json::json!("Bacteria universal target")),
            ]),
            "2026-10-30T09:42:30Z",
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-gibson-mch-fwd",
            "Gibson_pET28_NdeI_mCherry_Fwd",
            "MBC_PRM_007",
            "5'-overhang isothermal Gibson assembly forward oligo fusing thrombin-cleavable pET-28a(+) NdeI site to mCherry N-terminus.",
            MoleculeType::DNA,
            Topology::Linear,
            "CGCGCGGCAGCCATATGGTGAGCAAGGGCGAGGAGGAT",
            vec![
                make_feat("prm-gib-ext", "5' pET-28a Homology Tail", "misc_feature", 1, 17, 1, "#f59e0b", None),
                make_feat("prm-gib-core", "mCherry Core Anneal", "primer_bind", 18, 38, 1, "#16a34a", None),
            ],
            None,
            "primer",
            make_meta(&[
                ("5' Extension", serde_json::json!("CGCGCGGCAGCCATATG (17 nt)")),
                design_primer_gc("GTGAGCAAGGGCGAGGAGGAT"),
                (
                    "Provenance",
                    serde_json::json!("MolBioCraft example design"),
                ),
                ("Oligo Type", serde_json::json!("5'-Tailed Gibson Assembly Oligo")),
                ("Organism", serde_json::json!("Synthetic assembly primer")),
            ]),
            "2026-10-30T09:43:00Z",
            "Primers",
        ),

        // =========================================================================
        // UNIVERSAL SEQUENCING PRIMERS (12 oligos, each equal to or held by the public record
        // it names in its `Source record` field; see this file's doc comment)
        // =========================================================================
        make_sample_doc(
            "doc-primer-seq-m13-f-20",
            "M13-F (-20)",
            "BBa_G00103",
            "M13 forward sequencing primer, 20 bases upstream of the M13 cloning site. iGEM Registry part BBa_G00103.",
            MoleculeType::DNA,
            Topology::Linear,
            "GTAAAACGACGGCCAGT",
            vec![make_feat("prm-seq-m13-f-20", "Binding Region", "primer_bind", 1, 17, 1, "#16a34a", Some("Primer binding region (17 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("GTAAAACGACGGCCAGT", "BBa_G00103"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-m13-f-40",
            "M13-F (-40)",
            "BBa_G00105",
            "M13 forward sequencing primer, 40 bases upstream of the M13 cloning site. iGEM Registry part BBa_G00105.",
            MoleculeType::DNA,
            Topology::Linear,
            "GTTTTCCCAGTCACGAC",
            vec![make_feat("prm-seq-m13-f-40", "Binding Region", "primer_bind", 1, 17, 1, "#16a34a", Some("Primer binding region (17 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("GTTTTCCCAGTCACGAC", "BBa_G00105"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-m13-f-46",
            "M13-F (-46)",
            "BBa_G00106",
            "M13 forward sequencing primer, 46 bases upstream of the M13 cloning site. iGEM Registry part BBa_G00106.",
            MoleculeType::DNA,
            Topology::Linear,
            "GCCAGGGTTTTCCCAGTCACGA",
            vec![make_feat("prm-seq-m13-f-46", "Binding Region", "primer_bind", 1, 22, 1, "#16a34a", Some("Primer binding region (22 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("GCCAGGGTTTTCCCAGTCACGA", "BBa_G00106"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-m13-r-26",
            "M13-R (-26)",
            "BBa_G00104",
            "M13 reverse sequencing primer, 26 bases upstream of the M13 cloning site. iGEM Registry part BBa_G00104.",
            MoleculeType::DNA,
            Topology::Linear,
            "CAGGAAACAGCTATGAC",
            vec![make_feat("prm-seq-m13-r-26", "Binding Region", "primer_bind", 1, 17, 1, "#16a34a", Some("Primer binding region (17 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("CAGGAAACAGCTATGAC", "BBa_G00104"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-m13-r-46",
            "M13-R (-46)",
            "BBa_G00107",
            "M13 reverse sequencing primer, 46 bases upstream of the M13 cloning site. iGEM Registry part BBa_G00107.",
            MoleculeType::DNA,
            Topology::Linear,
            "GAGCGGATAACAATTTCACACAGG",
            vec![make_feat("prm-seq-m13-r-46", "Binding Region", "primer_bind", 1, 24, 1, "#16a34a", Some("Primer binding region (24 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("GAGCGGATAACAATTTCACACAGG", "BBa_G00107"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-t7-promoter",
            "T7 promoter",
            "",
            "T7 promoter sequencing primer, 20-mer. Held by phage T7, NC_001604, which carries it at six promoters.",
            MoleculeType::DNA,
            Topology::Linear,
            "TAATACGACTCACTATAGGG",
            vec![make_feat("prm-seq-t7-promoter", "Binding Region", "primer_bind", 1, 20, 1, "#16a34a", Some("Primer binding region (20 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("TAATACGACTCACTATAGGG", "NC_001604"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-t3-promoter-17bp",
            "T3 promoter (17bp)",
            "",
            "T3 promoter sequencing primer, 17-mer. Held by phage T3, NC_003298, at four of its promoters.",
            MoleculeType::DNA,
            Topology::Linear,
            "ATTAACCCTCACTAAAG",
            vec![make_feat("prm-seq-t3-promoter-17bp", "Binding Region", "primer_bind", 1, 17, 1, "#16a34a", Some("Primer binding region (17 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("ATTAACCCTCACTAAAG", "NC_003298"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-t3-promoter-20bp",
            "T3 promoter (20bp)",
            "",
            "T3 promoter sequencing primer, 20-mer. Held by phage T3, NC_003298, at four of its promoters.",
            MoleculeType::DNA,
            Topology::Linear,
            "ATTAACCCTCACTAAAGGGA",
            vec![make_feat("prm-seq-t3-promoter-20bp", "Binding Region", "primer_bind", 1, 20, 1, "#16a34a", Some("Primer binding region (20 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("ATTAACCCTCACTAAAGGGA", "NC_003298"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-t3-promoter-24bp",
            "T3 promoter (24bp)",
            "",
            "T3 promoter sequencing primer, 24-mer: bases 20,727-20,750 of phage T3, NC_003298, ending inside its phi10 promoter.",
            MoleculeType::DNA,
            Topology::Linear,
            "GTTTCTAATTAACCCTCACTAAAG",
            vec![make_feat("prm-seq-t3-promoter-24bp", "Binding Region", "primer_bind", 1, 24, 1, "#16a34a", Some("Primer binding region (24 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("GTTTCTAATTAACCCTCACTAAAG", "NC_003298"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-sp6-promoter",
            "SP6 promoter",
            "",
            "SP6 promoter sequencing primer, 24-mer. Held by phage SP6, NC_004831, at its major late promoter.",
            MoleculeType::DNA,
            Topology::Linear,
            "CATACGATTTAGGTGACACTATAG",
            vec![make_feat("prm-seq-sp6-promoter", "Binding Region", "primer_bind", 1, 24, 1, "#16a34a", Some("Primer binding region (24 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("CATACGATTTAGGTGACACTATAG", "NC_004831"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-vf2",
            "VF2",
            "BBa_G00100",
            "Forward primer for sequencing and amplifying BioBrick parts (VF2), binding upstream of the standard cloning site. iGEM Registry part BBa_G00100.",
            MoleculeType::DNA,
            Topology::Linear,
            "TGCCACCTGACGTCTAAGAA",
            vec![make_feat("prm-seq-vf2", "Binding Region", "primer_bind", 1, 20, 1, "#16a34a", Some("Primer binding region (20 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("TGCCACCTGACGTCTAAGAA", "BBa_G00100"),
            SOURCED_ON,
            "Primers",
        ),
        make_sample_doc(
            "doc-primer-seq-vr",
            "VR",
            "BBa_G00101",
            "Reverse primer for sequencing and amplifying BioBrick parts (VR), binding downstream of the standard cloning site. iGEM Registry part BBa_G00101.",
            MoleculeType::DNA,
            Topology::Linear,
            "ATTACCGCCTTTGAGTGAGC",
            vec![make_feat("prm-seq-vr", "Binding Region", "primer_bind", 1, 20, 1, "#16a34a", Some("Primer binding region (20 bp)"))],
            None,
            "primer",
            sequencing_primer_meta("ATTACCGCCTTTGAGTGAGC", "BBa_G00101"),
            SOURCED_ON,
            "Primers",
        ),

        // =========================================================================
        // PROTEIN DOCUMENTS (11 entries)
        // =========================================================================
        make_sample_doc(
            "doc-prot-egfp-1ema",
            "eGFP_Aequorea_Protein (1EMA)",
            "NP_001001_GFP",
            "Enhanced Green Fluorescent Protein 11-stranded beta-barrel polypeptide (239 aa, crystal structure 1EMA).",
            MoleculeType::Protein,
            Topology::Linear,
            "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK",
            vec![make_feat("prot-chr", "TYG Fluorophore (65-67)", "misc_feature", 65, 67, 1, "#10b981", None)],
            None,
            "protein",
            make_meta(&[
                ("PDB name", serde_json::json!("1EMA")),
                ("Organism", serde_json::json!("Aequorea victoria")),
                ("Common Name", serde_json::json!("Crystal jellyfish")),
                ("Taxonomy", serde_json::json!("Eukaryota; Metazoa; Cnidaria; Hydrozoa; Aequorea")),
                ("GID", serde_json::json!("GI:157830345")),
            ]),
            "2026-10-30T09:45:00Z",
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-spcas9-4oo8",
            "SpCas9_HNH_PAM_Core (4OO8)",
            "WP_010922251.1",
            "Streptococcus pyogenes Cas9 endonuclease catalytic HNH, RuvC-III, and C-terminal TGG-PAM recognition domains (crystal structure 4OO8).",
            MoleculeType::Protein,
            Topology::Linear,
            "DKQSGKTILDFLKSDGFANRNFMQLIHDDSLTFKEDIQKAQVSGQGDSLHEHIANLAGSPAIKKGILQTVKVVDELVKVMGRHKPENIVIEMARENQTTQKGQKNSRERMKRIEEGIKELGSQILKEHPVENTQLQNEKLYLYYLQNGRDMYVDQELDINRLSDYDVDHIVPQSFLKDDSIDNKVLTRSDKNRGKSDNVPSEEVVKKMKNYWRQLLNAKLITQRKFDNLTKAERGGLSELDKAGFIKRQLVETRQITKHVAQILDSRMNTKYDENDKLIREVKVITLKSKLVSDFRKDFQFYKVREINNYHHAHDAYLNAVVGTALIKKYPKLESEFVYGDYKVYDVRKMIAKSEQEIGKATAKYFFYSNIMNFFKTEITLANGEIRKRPLIETNGETGEIVWDKGRDFATVRKVLSMPQVNIVKKTEVQTGGFSKESILPKRNSDKLIARKKDWDPKKYGGFDSPTVAYSVLVVAKVEKGKSKKLKSVKELLGITIMERSSFEKNPIDFLEAKGYKEVKKDLIIKLPKYSLFELENGRKRMLASAGELQKGNELALPSKYVNFLYLASHYEKLKGSPEDNEQKQLFVEQHKHYLDEIIEQISEFSKRVILADANLDKVLSAYNKHRDKPIREQAENIIHLFTLTNLGAPAAFKYFDTTIDRKRYTSTKEVLDATLIHQSITGLYETRIDLSQLGGD",
            vec![
                make_feat("prot-hnh", "H840 / N863 HNH Active Site", "misc_feature", 45, 175, 1, "#8b5cf6", None),
                make_feat("prot-pam", "R1333 / R1335 5'-NGG-3' Cleft", "misc_feature", 455, 550, 1, "#2563eb", None),
            ],
            None,
            "protein",
            make_meta(&[
                ("PDB name", serde_json::json!("4OO8")),
                ("Organism", serde_json::json!("Streptococcus pyogenes M1 GAS")),
                ("Common Name", serde_json::json!("CRISPR-Cas9 RNA-guided endonuclease")),
                ("Taxonomy", serde_json::json!("Bacteria; Bacillota; Bacilli; Lactobacillales; Streptococcus")),
                ("GID", serde_json::json!("GI:584155573")),
            ]),
            "2026-10-30T09:45:30Z",
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-taq-1taq",
            "Taq_DNA_Polymerase_Klentaq1 (1TAQ)",
            "BAA06775.1",
            "Klentaq1: Thermus aquaticus DNA polymerase I residues 281-832 (N-terminal 5-prime nuclease domain deleted); polymerase domain of the 1TAQ structure.",
            MoleculeType::Protein,
            Topology::Linear,
            "LLHEFGLLESPKALEEAPWPPPEGAFVGFVLSRKEPMWADLLALAAARGGRVHRAPEPYKALRDLKEARGLLAKDLSVLALREGLGLPPGDDPMLLAYLLDPSNTTPEGVARRYGGEWTEEAGERAALSERLFANLWGRLEGEERLLWLYREVERPLSAVLAHMEATGVRLDVAYLRALSLEVAEEIARLEAEVFRLAGHPFNLNSRDQLERVLFDELGLPAIGKTEKTGKRSTSAAVLEALREAHPIVEKILQYRELTKLKSTYIDPLPDLIHPRTGRLHTRFNQTATATGRLSSSDPNLQNIPVRTPLGQRIRRAFIAEEGWLLVALDYSQIELRVLAHLSGDENLIRVFQEGRDIHTETASWMFGVPREAVDPLMRRAAKTINFGVLYGMSAHRLSQELAIPYEEAQAFIERYFQSFPKVRAWIEKTLEEGRRRGYVETLFGRRRYVPDLEARVKSVREAAERMAFNMPVQGTAADLMKLAMVKLFPRLEEMGARMLLQVHDELVLEAPKERAEAVARLAKEVMEGVYPLAVPLEVEVGIGEDWLSAKE",
            vec![
                make_feat("prot-ohelix", "O-helix (Taq 659-671, F667/Y671)", "misc_feature", 379, 391, 1, "#0284c7", Some("Fingers-subdomain O-helix RRAAKTINFGVLY; F667 governs ddNTP discrimination")),
                make_feat("prot-d610", "Catalytic Asp610 (palm)", "site", 330, 330, 1, "#ef4444", Some("Mg2+-coordinating aspartate")),
                make_feat("prot-d785", "Catalytic Asp785-Glu786 (palm)", "site", 505, 506, 1, "#ef4444", Some("Mg2+-coordinating Asp785 of the DE motif")),
            ],
            None,
            "protein",
            make_meta(&[
                ("PDB name", serde_json::json!("1TAQ")),
                ("Organism", serde_json::json!("Thermus aquaticus YT-1")),
                ("Common Name", serde_json::json!("Taq DNA polymerase I")),
                ("Taxonomy", serde_json::json!("Bacteria; Deinococcota; Deinococci; Thermales; Thermus")),
                ("GID", serde_json::json!("GI:2392207")),
            ]),
            "2026-10-30T09:46:00Z",
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-nanoluc-5ibo",
            "NanoLuc_Engineered_Luciferase (5IBO)",
            "5IBO_A",
            "Engineered 19.1 kDa 10-stranded antiparallel beta-barrel furimazine bioluminescent luciferase (171 aa, crystal structure 5IBO).",
            MoleculeType::Protein,
            Topology::Linear,
            "MVFTLEDFVGDWRQTAGYNLDQVLEQGGVSSLFQNLGVSVTPIQRIVLSGENGLKIDIHVIIPYEGLSGDQMGQIEKIFKVVYPVDDHHFKVILHYGTLVIDGVTPNMIDYFGRPYEGIAVFDGKKITVTGTLWNGNKIIDERLINPDGSLLFRVTINGVTGWRLCERILA",
            vec![make_feat("prot-nluc-cav", "Central Beta-Barrel Substrate Cavity", "misc_feature", 52, 134, 1, "#f59e0b", None)],
            None,
            "protein",
            make_meta(&[
                ("PDB name", serde_json::json!("5IBO")),
                ("Organism", serde_json::json!("Oplophorus gracilirostris (engineered)")),
                ("Common Name", serde_json::json!("NanoLuc luciferase")),
                ("Taxonomy", serde_json::json!("Eukaryota; Metazoa; Arthropoda; Crustacea; Oplophorus")),
                ("GID", serde_json::json!("GI:1049521940")),
            ]),
            "2026-10-30T09:46:30Z",
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-ispetase-5xjh",
            "IsPETase_Plastic_Hydrolase (5XJH)",
            "GAP38373.1",
            "Ideonella sakaiensis 201-F6 polyethylene terephthalate hydrolase alpha/beta-hydrolase fold (crystal structure 5XJH).",
            MoleculeType::Protein,
            Topology::Linear,
            "QTNPYARGPNPTAASLEASAGPFTVRSFTVSRPSGYGAGTVYYPTNAGGTVGAIAIVPGYTARQSSIKWWGPRLASHGFVVITIDTNSTLDQPSSRSSQQMAALRQVASLNGTSSSPIYGKVDTARMGVMGWSMGGGGSLISAANNPSLKAAAPQAPWDSSTNFSSVTVPTLIFACENDSIAPVNSSALPIYDSMSRNAKQFLEINGGSHSCANSGNSNQALIGKKGVAWMKRFMDNDTRYSTFACENPNSTRVSDFRTANCS",
            vec![
                make_feat("prot-pet-ser", "Ser160 Nucleophilic Elbow", "misc_feature", 130, 136, 1, "#14b8a6", None),
                make_feat("prot-pet-ss", "Cys203-Cys239 Active-Site Disulfide", "misc_feature", 176, 212, 1, "#eab308", None),
            ],
            None,
            "protein",
            make_meta(&[
                ("PDB name", serde_json::json!("5XJH")),
                ("Organism", serde_json::json!("Ideonella sakaiensis 201-F6")),
                ("Common Name", serde_json::json!("PET plastic hydrolase")),
                ("Taxonomy", serde_json::json!("Bacteria; Pseudomonadota; Betaproteobacteria; Burkholderiales; Ideonella")),
                ("GID", serde_json::json!("GI:1267852910")),
            ]),
            "2026-10-30T09:47:00Z",
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-insulin-1mso",
            "Human_Preproinsulin_ChainAB (1MSO)",
            "NP_000198.1",
            "Homo sapiens preproinsulin precursor encompassing ER signal peptide, B-chain, C-peptide dibasic cleavage sites, and A-chain (110 aa, structure 1MSO).",
            MoleculeType::Protein,
            Topology::Linear,
            "MALWMRLLPLLALLALWGPDPAAAFVNQHLCGSHLVEALYLVCGERGFFYTPKTRREAEDLQVGQVELGGGPGAGSLQPLALEGSLQKRGIVEQCCTSICSLYQLENYCN",
            vec![
                make_feat("prot-ins-b", "Mature Insulin B-Chain", "misc_feature", 25, 54, 1, "#2563eb", None),
                make_feat("prot-ins-a", "Mature Insulin A-Chain", "misc_feature", 90, 110, 1, "#10b981", None),
            ],
            None,
            "protein",
            make_meta(&[
                ("PDB name", serde_json::json!("1MSO")),
                ("Organism", serde_json::json!("Homo sapiens")),
                ("Common Name", serde_json::json!("Human insulin precursor")),
                ("Taxonomy", serde_json::json!("Eukaryota; Metazoa; Chordata; Mammalia; Primates; Homo")),
                ("GID", serde_json::json!("GI:4557671")),
            ]),
            "2026-10-30T09:47:30Z",
            "Protein Documents",
        ),

        // ---- Three annotated NCBI Protein records and two RCSB entries, each checked against
        // ---- the record it cites (see this file's doc comment)
        make_sample_doc(
            "doc-prot-receptor-kinase-3c4w",
            "Receptor Kinase",
            "3C4W_B",
            "Chain B of bovine G protein-coupled receptor kinase 1 (rhodopsin kinase) bound to ATP and magnesium chloride, 2.7 A crystal structure 3C4W. Carries a C-terminal His-tag and one unresolved residue (X at position 8).",
            MoleculeType::Protein,
            Topology::Linear,
            "MDFGSLEXVVANSAFIAARGSFDASSGPASRDRKYLARLKLPPLSKCEALRESLDLGFEGMCLEQPIGKRLFQQFLRTHEQHGPALQLWKDIEDYDTADDALRPQKAQALRAAYLEPQAQLFCSFLDAETVARARAGAGDGLFQPLLRAVLAHLGQAPFQEFLDSLYFLRFLQWKWLEAQPMGEDWFLDFRVLGRGGFGEVFACQMKATGKLYACKKLNKKRLKKRKGYQGAMVEKKILAKVHSRFIVSLAYAFETKTDLCLVMTIMNGGDIRYHIYNVDEDNPGFQEPRAIFYTAQIVSGLEHLHQRNIIYRDLKPENVLLDDDGNVRISDLGLAVELKAGQTKTKGYAGTPGFMAPELLLGEEYDFSVDYFALGVTLYEMIAARGPFRARGEKVENKELKQRVLEQAVTYPDKFSPASKDFCEALLQKDPEKRLGFRDGSCDGLRTHPLFRDISWRQLEAGMLTPPFVPDSRTVYAKNIQDVGAFSTVKGVAFEKADTEFFQEFASGTCPIPWQEEMIETGVFGDLNVWRPDGVDHHHHHH",
            Vec::new(),
            None,
            "protein",
            make_meta(&[
                ("Organism", serde_json::json!(serde_json::json!("Bos taurus"))),
                ("Common Name", serde_json::json!(serde_json::json!("cattle"))),
                ("Taxonomy", serde_json::json!(serde_json::json!("Eukaryota; Metazoa; Chordata; Craniata; Vertebrata; Euteleostomi; Mammalia; Eutheria; Laurasiatheria; Cetartiodactyla; Ruminantia; Pecora; Bovidae; Bovinae; Bos"))),
                ("Genetic Code", serde_json::json!(serde_json::json!("Standard"))),
                ("GID", serde_json::json!(serde_json::json!("GI:169791869"))),
                ("PDB name", serde_json::json!(serde_json::json!("3C4W"))),
                ("Source record", serde_json::json!("NCBI Protein 3C4W_B")),
            ]),
            SOURCED_ON,
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-ferredoxin-isc",
            "Ferredoxin",
            "NP_417020.1",
            "Reduced ferredoxin (gene fdx), the 2Fe-2S ferredoxin of the ISC iron-sulfur cluster assembly system of Escherichia coli K-12 MG1655. RefSeq record NP_417020.1.",
            MoleculeType::Protein,
            Topology::Linear,
            "MPKIVILPHQDLCPDGAVLEANSGETILDAALRNGIEIEHACEKSCACTTCHCIVREGFDSLPESSEQEDDMLDKAWGLEPESRLSCQARVTDEDLVVEIPRYTINHAREH",
            Vec::new(),
            None,
            "protein",
            make_meta(&[
                ("Organism", serde_json::json!("Escherichia coli str. K-12 substr. MG1655")),
                ("Gene", serde_json::json!("fdx")),
                ("Taxonomy", serde_json::json!("Bacteria; Pseudomonadati; Pseudomonadota; Gammaproteobacteria; Enterobacterales; Enterobacteriaceae; Escherichia")),
                ("Genetic Code", serde_json::json!("Bacterial")),
                ("GID", serde_json::json!("GI:16130450")),
                ("Source record", serde_json::json!("NCBI Protein NP_417020.1 (RefSeq)")),
            ]),
            SOURCED_ON,
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-narh-nitrate-reductase",
            "NARH",
            "NP_415743.1",
            "Nitrate reductase A subunit beta (gene narH, EC 1.7.5.1) of Escherichia coli K-12 MG1655, the beta chain of respiratory nitrate reductase 1. RefSeq record NP_415743.1.",
            MoleculeType::Protein,
            Topology::Linear,
            "MKIRSQVGMVLNLDKCIGCHTCSVTCKNVWTSREGVEYAWFNNVETKPGQGFPTDWENQEKYKGGWIRKINGKLQPRMGNRAMLLGKIFANPHLPGIDDYYEPFDFDYQNLHTAPEGSKSQPIARPRSLITGERMAKIEKGPNWEDDLGGEFDKLAKDKNFDNIQKAMYSQFENTFMMYLPRLCEHCLNPACVATCPSGAIYKREEDGIVLIDQDKCRGWRMCITGCPYKKIYFNWKSGKSEKCIFCYPRIEAGQPTVCSETCVGRIRYLGVLLYDADAIERAASTENEKDLYQRQLDVFLDPNDPKVIEQAIKDGIPLSVIEAAQQSPVYKMAMEWKLALPLHPEYRTLPMVWYVPPLSPIQSAADAGELGSNGILPDVESLRIPVQYLANLLTAGDTKPVLRALKRMLAMRHYKRAETVDGKVDTRALEEVGLTEAQAQEMYRYLAIANYEDRFVVPSSHRELAREAFPEKNGCGFTFGDGCHGSDTKFNLFNSRRIDAIDVTSKTEPHP",
            Vec::new(),
            None,
            "protein",
            make_meta(&[
                ("Organism", serde_json::json!("Escherichia coli str. K-12 substr. MG1655")),
                ("Gene", serde_json::json!("narH")),
                ("EC Number", serde_json::json!("1.7.5.1")),
                ("Taxonomy", serde_json::json!("Bacteria; Pseudomonadati; Pseudomonadota; Gammaproteobacteria; Enterobacterales; Enterobacteriaceae; Escherichia")),
                ("Genetic Code", serde_json::json!("Bacterial")),
                ("GID", serde_json::json!("GI:16129188")),
                ("Source record", serde_json::json!("NCBI Protein NP_415743.1 (RefSeq)")),
            ]),
            SOURCED_ON,
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-1d66-gal4-dna",
            "Protein DNA complex (1D66)",
            "1D66",
            "GAL4 DNA-binding domain dimer bound to a 19-mer DNA duplex (entry 1D66). C-alpha backbone trace of protein chains A and B; the DNA chains carry no C-alpha atoms and are not part of this trace.",
            MoleculeType::Protein,
            Topology::Linear,
            "EQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTEVESRLERLEQACDICRLKKLKCSKEKPKCAKCLKNNWECRYSPKTKRSPLTRAHLTEVESRLERL",
            vec![
                make_feat("1d66-ch-a", "Chain A (GAL4 DNA-binding domain)", "chain", 1, 57, 1, "#2563eb", None),
                make_feat("1d66-ch-b", "Chain B (GAL4 DNA-binding domain)", "chain", 58, 114, 1, "#10b981", None),
            ],
            None,
            "protein",
            make_meta(&[
                ("PDBText", serde_json::json!(crate::sample_structures::PDB_1D66_CA)),
                ("PDB name", serde_json::json!(serde_json::json!("1D66"))),
                ("Organism", serde_json::json!(serde_json::json!("Saccharomyces cerevisiae"))),
                ("Chains", serde_json::json!(serde_json::json!("A, B"))),
                ("Structure Source", serde_json::json!(serde_json::json!("RCSB entry 1D66, C-alpha trace"))),
                ("Experiment", serde_json::json!(serde_json::json!("X-ray diffraction"))),
            ]),
            "2026-11-05T09:00:00Z",
            "Protein Documents",
        ),
        make_sample_doc(
            "doc-prot-1a4y-rnase-angiogenin",
            "Protein complex (1A4Y)",
            "1A4Y",
            "Ribonuclease inhibitor-angiogenin complex (entry 1A4Y), both proteins human. C-alpha backbone trace of all four chains: two copies of the inhibitor (A, D) each bound to one angiogenin (B, E).",
            MoleculeType::Protein,
            Topology::Linear,
            "SLDIQSLDIQCEELSDARWAELLPLLQQCQVVRLDDCGLTEARCKDISSALRVNPALAELNLRSNELGDVGVHCVLQGLQTPSCKIQKLSLQNCCLTGAGCGVLSSTLRTLPTLQELHLSDNLLGDAGLQLLCEGLLDPQCRLEKLQLEYCSLSAASCEPLASVLRAKPDFKELTVSNNDINEAGVRVLCQGLKDSPCQLEALKLESCGVTSDNCRDLCGIVASKASLRELALGSNKLGDVGMAELCPGLLHPSSRLRTLWIWECGITAKGCGDLCRVLRAKESLKELSLAGNELGDEGARLLCETLLEPGCQLESLWVKSCSFTAACCSHFSSVLAQNRFLLELQISNNRLEDAGVRELCQGLGQPGSVLRVLWLADCDVSDSSCSSLAATLLANHSLRELDLSNNCLGDAGILQLVESVRQPGCLLEQLVLYDIYWSEEMEDRLQALEKDKPSLRVISQDNSRYTHFLTQHYDAKPQGRDDRYCESIMRRRGLTSPCKDINTFIHGNKRSIKAICENKNGNPHRENLRISKSSFQVTTCKLHGGSPWPPCQYRATAGFRNVVVACENGLPVHLDQSIFRRPSLDIQSLDIQCEELSDARWAELLPLLQQCQVVRLDDCGLTEARCKDISSALRVNPALAELNLRSNELGDVGVHCVLQGLQTPSCKIQKLSLQNCCLTGAGCGVLSSTLRTLPTLQELHLSDNLLGDAGLQLLCEGLLDPQCRLEKLQLEYCSLSAASCEPLASVLRAKPDFKELTVSNNDINEAGVRVLCQGLKDSPCQLEALKLESCGVTSDNCRDLCGIVASKASLRELALGSNKLGDVGMAELCPGLLHPSSRLRTLWIWECGITAKGCGDLCRVLRAKESLKELSLAGNELGDEGARLLCETLLEPGCQLESLWVKSCSFTAACCSHFSSVLAQNRFLLELQISNNRLEDAGVRELCQGLGQPGSVLRVLWLADCDVSDSSCSSLAATLLANHSLRELDLSNNCLGDAGILQLVESVRQPGCLLEQLVLYDIYWSEEMEDRLQALEKDKPSLRVISQDNSRYTHFLTQHYDAKPQGRDDRYCESIMRRRGLTSPCKDINTFIHGNKRSIKAICENKNGNPHRENLRISKSSFQVTTCKLHGGSPWPPCQYRATAGFRNVVVACENGLPVHLDQSIFRRP",
            vec![
                make_feat("1a4y-ch-a", "Chain A", "chain", 1, 460, 1, "#2563eb", None),
                make_feat("1a4y-ch-b", "Chain B", "chain", 461, 583, 1, "#f59e0b", None),
                make_feat("1a4y-ch-d", "Chain D", "chain", 584, 1043, 1, "#10b981", None),
                make_feat("1a4y-ch-e", "Chain E", "chain", 1044, 1166, 1, "#8b5cf6", None),
            ],
            None,
            "protein",
            make_meta(&[
                ("PDBText", serde_json::json!(crate::sample_structures::PDB_1A4Y_CA)),
                ("PDB name", serde_json::json!(serde_json::json!("1A4Y"))),
                ("Organism", serde_json::json!("Homo sapiens")),
                ("Chains", serde_json::json!(serde_json::json!("A, B, D, E"))),
                ("Structure Source", serde_json::json!(serde_json::json!("RCSB entry 1A4Y, C-alpha trace"))),
                ("Experiment", serde_json::json!(serde_json::json!("X-ray diffraction"))),
            ]),
            "2026-11-05T09:01:00Z",
            "Protein Documents",
        ),

        // =========================================================================
        // CLONING (5 assembled constructs + doc-insert-mcherry + the 5 yadF documents = 11 total)
        // =========================================================================
        make_sample_doc(
            "doc-cloning-pet28-mcherry-gibson",
            "pET28a-mCherry_Gibson_Clone",
            "MBC_CLN_001",
            "Gibson junction region (excerpt of the assembled plasmid): pUC19 lacZ-alpha/MCS segment (1-600) joined to the mCherry coding sequence (601-1311, 236 aa).",
            MoleculeType::DNA,
            Topology::Linear,
            "TCGCGCGTTTCGGTGATGACGGTGAAAACCTCTGACACATGCAGCTCCCGGAGACGGTCACAGCTTGTCTGTAAGCGGATGCCGGGAGCAGACAAGCCCGTCAGGGCGCGTCAGCGGGTGTTGGCGGGTGTCGGGGCTGGCTTAACTATGCGGCATCAGAGCAGATTGTACTGAGAGTGCACCATATGCGGTGTGAAATACCGCACAGATGCGTAAGGAGAAAATACCGCATCAGGCGCCATTCGCCATTCAGGCTGCGCAACTGTTGGGAAGGGCGATCGGTGCGGGCCTCTTCGCTATTACGCCAGCTGGCGAAAGGGGGATGTGCTGCAAGGCGATTAAGTTGGGTAACGCCAGGGTTTTCCCAGTCACGACGTTGTAAAACGACGGCCAGTGAATTCGAGCTCGGTACCCGGGGATCCTCTAGAGTCGACCTGCAGGCATGCAAGCTTGGCGTAATCATGGTCATAGCTGTTTCCTGTGTGAAATTGTTATCCGCTCACAATTCCACACAACATACGAGCCGGAAGCATAAAGTGTAAAGCCTGGGGTGCCTAATGAGTGAGCTAACTCACATTAATTGCGTTGCGCTCACTGCCCATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGGCGACGGGGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAGACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAA",
            vec![
                make_feat("cln-m13f", "M13 fwd (-20) site", "primer_bind", 379, 395, 1, "#0ea5e9", None),
                make_feat("cln-lacza", "lacZ-alpha", "CDS", 146, 469, -1, "#7c3aed", Some("LacZ alpha fragment, 107 aa")),
                make_feat("cln-laco", "lac operator", "protein_bind", 489, 505, -1, "#06b6d4", None),
                make_feat("cln-mch", "mCherry", "CDS", 601, 1311, 1, "#e11d48", Some("mCherry red fluorescent protein, 236 aa")),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Synthetic Gibson construct (BL21(DE3) host)")),
                ("Replicon type", serde_json::json!("ColE1 high-copy")),
                ("Oligo Type", serde_json::json!("Isothermal 25-bp Gibson Overlap")),
                ("Tm", serde_json::json!("62.4 °C")),
                ("%GC Primer Bind", serde_json::json!("57.9%")),
            ]),
            "2026-10-30T10:01:00Z",
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-moclo-luxab",
            "MoClo_Level1_LuxAB_Biolum_TU",
            "MBC_CLN_002",
            "MoClo-style transcription-unit fragment: J23100 promoter + B0034 RBS + Aliivibrio fischeri luxA 5-prime region. The luxA reading frame stops after codon 89, so this record does not encode functional LuxAB.",
            MoleculeType::DNA,
            Topology::Linear,
            "TTGACGGCTAGCTCAGTCCTAGGTACAGTGCTAGCTACTAGAGAAAGAGGAGAAATACTAGATGAAATTTGGAAACTTTTTGCTTACTTACCAACCTCCCCAATTGTCTCAAACAGAGGTAATGAAACGTTTGGTTAAATTAGGTCGCATCTCTGAGGAGTGTGGTTTTGATACCGTATGGTTACTGGAGCATCATTTCACGGAGTTTGGACTGCTTGGTAACCCTTATGTCGCTGCTGCTTATTTACTTGGCGCGACTAAAAAATTGAATGTAGGAACTGCCGCTATTGTTCTTCCCACAGCCCATCCACTTCGCCAACTTGAAGATTGAATTTATTGGAAATGAGCAAATCCCACAAAATATGAGTTTTTAAATGGAAAATTAGGCTTGTTTGCTGTTACACCGGAAGATCATTTTAAGAAAAAACTTGCTGAGAGATTAGGTATCAGTCAGGCTGAATTTTTGGGTTCTGGTTGGTATGATCTTGACGTTGATGCGTTTGAAAAGTTTTCTTTACCAAATGAAGATAGCCCGATCATTGTTGTCGATGAAAACGCAGTTAACAAAGATGAATACCTGGCGCTTTTAAAACGCCATCAAGAACGCGTTGGCGTAACCCAAGTCCCTGTCGCAGGTGAAAACGGTGTATAA",
            vec![
                make_feat("lux-prom", "J23100 Constitutive Promoter", "promoter", 1, 35, 1, "#10b981", None),
                make_feat("lux-rbs", "B0034 Ribosome Binding Site", "RBS", 40, 58, 1, "#f59e0b", None),
                make_feat("lux-cds", "luxA (truncated, stop after codon 89)", "CDS", 62, 331, 1, "#0284c7", Some("luxA N-terminal 89 aa (MKFGNFLLTYQPPQ...) followed by an in-frame stop")),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Synthetic MoClo construct (Aliivibrio fischeri luxAB)")),
                ("Replicon type", serde_json::json!("pSC101 low-copy receiver")),
                ("Oligo Type", serde_json::json!("4-nt Syntax Fusion (GGAG/TACT/AATG/GCTT)")),
                ("Tm", serde_json::json!("59.8 °C")),
                ("%GC Primer Bind", serde_json::json!("48.2%")),
            ]),
            "2026-10-30T10:01:30Z",
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-soe-dcas9-vp64",
            "Overlap_SOE_PCR_dCas9-VP64_Activator",
            "MBC_CLN_003",
            "Splicing-by-Overlap-Extension (SOE-PCR) amplicon encoding the dCas9 C-terminus fused to a nucleoplasmin bipartite NLS, 3xHA epitope and tetrameric VP64 (one open reading frame, 5-prime partial).",
            MoleculeType::DNA,
            Topology::Linear,
            "CTGCACCAGAGCATCACCGGCCTGTACGAGACACGGATCGACCTGTCTCAGCTGGGAGGCGACAAAAGGCCGGCGGCCACGAAAAAGGCCGGCCAGGCAAAAAAGAAAAAGGGATCCTACCCATACGATGTTCCAGATTACGCTTATCCCTACGACGTGCCTGATTATGCATACCCATATGATGTCCCCGACTATGCCTCAAGCGACGCCCTGGACGACTTCGACCTGGACATGCTGGGCTCTGATGCCCTGGATGATTTCGACCTGGATATGCTGGGCAGCGACGCTCTGGACGATTTTGATCTCGACATGCTGGGATCCGACGCACTGGATGACTTTGACCTGGACATGCTCGGCTGA",
            vec![
                make_feat("soe-orf", "dCas9(C-term)-NLS-3xHA-VP64 ORF (5-prime partial)", "CDS", 1, 360, 1, "#a855f7", Some("Single in-frame ORF ending in a stop codon")),
                make_feat("soe-dcas9", "dCas9 C-terminal tail", "misc_feature", 1, 63, 1, "#8b5cf6", Some("SpCas9 residues 1348-1368 (...DLSQLGGD)")),
                make_feat("soe-nls", "Nucleoplasmin bipartite NLS", "misc_feature", 64, 111, 1, "#f59e0b", Some("KRPAATKKAGQAKKKK")),
                make_feat("soe-ha", "3xHA epitope", "misc_feature", 118, 198, 1, "#0ea5e9", Some("3 x YPYDVPDYA")),
                make_feat("soe-vp64", "VP64 transactivator", "misc_feature", 205, 360, 1, "#e11d48", Some("4 x VP16 DALDDFDLDML")),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Synthetic CRISPRa SOE-PCR fusion amplicon")),
                ("Oligo Type", serde_json::json!("30-bp Chimeric SOE-PCR Splice Junction")),
                ("Tm", serde_json::json!("66.1 °C")),
                ("%GC Primer Bind", serde_json::json!("61.4%")),
            ]),
            "2026-10-30T10:02:00Z",
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-lic-ispetase",
            "LIC_pNIC28_IsPETase_Hydrolase_Clone",
            "MBC_CLN_004",
            "Ligation-independent cloning insert: 6xHis-TEV leader fused in frame to mature Ideonella sakaiensis PETase (residues 28-290).",
            MoleculeType::DNA,
            Topology::Linear,
            "ATGCACCATCATCATCATCATTCTTCTGGTGTAGATCTGGGTACCGAGAACCTGTACTTCCAATCCATGCAGACCAACCCGTACGCGCGCGGCCCGAACCCGACGGCGGCCTCGCTCGAAGCCAGCGCGGGGCCGTTCACCGTGCGCTCGTTCACCGTGAGCCGCCCGAGCGGCTACGGCGCGGGCACCGTGTACTACCCGACCAACGCCGGCGGCACCGTGGGCGCCATCGCCATCGTGCCGGGCTACACGGCGCGCCAGTCGAGCATCAAGTGGTGGGGCCCGCGCCTGGCCTCGCACGGCTTCGTGGTCATCACCATCGACACCAACAGCACGCTGGACCAGCCGTCCAGCCGCTCGTCGCAGCAGATGGCGGCGCTGCGCCAGGTGGCGTCGCTGAACGGCACCAGCAGCTCGCCGATCTACGGCAAGGTGGACACCGCCCGCATGGGCGTGATGGGCTGGTCGATGGGCGGCGGCGGCTCGCTGATCTCGGCGGCCAACAACCCGTCGCTGAAGGCGGCCGCGCCGCAGGCCCCGTGGGACTCGAGCACCAACTTCTCGTCGGTCACCGTGCCGACGCTGATCTTCGCCTGCGAGAACGACAGCATCGCCCCGGTGAACTCGTCGGCCCTGCCGATCTACGACTCGATGTCGCGCAACGCCAAGCAGTTCCTGGAGATCAACGGCGGCTCGCACTCCTGCGCCAACAGCGGCAACAGCAACCAGGCGCTGATCGGCAAGAAGGGCGTGGCCTGGATGAAGCGCTTCATGGACAACGACACGCGCTACTCCACCTTCGCCTGCGAGAACCCGAACAGCACGCGGGTGTCGGACTTCCGCACCGCCAACTGCTCGTAA",
            vec![
                make_feat("lic-orf", "6xHis-TEV-IsPETase ORF", "CDS", 1, 861, 1, "#14b8a6", Some("286 aa fusion protein")),
                make_feat("lic-his", "6xHis + TEV protease site (ENLYFQ/S)", "misc_feature", 1, 69, 1, "#0284c7", None),
                make_feat("lic-pet", "Mature IsPETase (aa 28-290)", "misc_feature", 70, 861, 1, "#0d9488", None),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Synthetic LIC structural biology vector")),
                ("Replicon type", serde_json::json!("ColE1 + sacB negative selection")),
                ("Oligo Type", serde_json::json!("15-nt T4 Chewback LIC Cohesive Tail")),
                ("Tm", serde_json::json!("58.6 °C")),
                ("%GC Primer Bind", serde_json::json!("64.0%")),
            ]),
            "2026-10-30T10:02:30Z",
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-hdr-aavs1-nanoluc",
            "Donor_HDR_AAVS1_NanoLuc-P2A-Puro",
            "MBC_CLN_005",
            "Homology-directed repair donor (excerpt): 5-prime AAVS1 (PPP1R12C) homology arm, splice-acceptor region and NanoLuc reporter. The record ends at NanoLuc codon 171; the stop codon and downstream P2A-PuroR are not included.",
            MoleculeType::DNA,
            Topology::Linear,
            "TGCTTTCTCTGACCAGCATTCTCTCCCCTGGGCCTGTGCCGCTTTCTGTCTGCAGCTTGTGGCCTGGGTCACCTCTACGGCTGGCCCAGATCCTTCCCTGCCGCCTCCTTCAGGTTCCGTCTTCCTCCACTCCCTCTTCCCCTTGCTCTCTGCTGTGTTGCTGCCCAAGGATGCTCTTTCCGGAGCACTTCCTTCTCGGCGCTGCACCACGTGATGTCCTCTGAGCGGATCCTCCCCGTGTCTGGGTCCTCTCCGGGCATCTCTCCTCCCTCACCCAACCCCATGCCGTCTTCACTCGCTGGGTTCCCTTTTCCTTCTCCTTCTGGGGCCTGTGCCATCTCTCGTTTCTTAGGATGGCCTTCTCCGACGGATGTCTCCCTTGCGTCCCGCCTCCCCTTCTTGTAGGCCTGCATCATCACCGTTTTTCTGGACAACCCCAAAGTACCCCGTCTCCCTGGCTTTAGCCACCTCTCCATCCTCTTGCTTTCTTTGCCTGGACACCCCGTTCTCCTGTGGATTCGGGTCACCTCTCACTCCTTTCATTTGGGCAGCTCCCCTACCCCCCTTACCTCTCTAGTCTGTGCTAGCTCTTCCAGCCCCCTGTCATGGCATCTTCCAGGGGTCCGAGAGCTCAGCTAGTCTTCTTCCTCCAACCCGGGCCCCTATGTCCACTTCAGGACAGCATGTTTGCTGCCTCCAGGGATCCTGTGTCCCCGAGCTGGGACCACCTTATATTCCCAGGGCCGGTTAATGTGGCTCTGGTTCTGGGTACTTTTATCTGTCCCCTCCACCCCACAGTGGGGCCACTAGGGACAGGATTGGTGACAGAAAAGCCCCATCCTTAGGCCTCCTCCTTCCTAGTCTCCTGATATTGGGTCTAACCCCCACCTCCTGTTAGGCAGATTCCTTATCTGGTGACACACCCCCATTTCCTGGAGCCATCTCTCTCCTTGCCAGAACCTCTAAGGTTTGCTTACGATGGAGCCAGAGAGGATCCTGGGAGGGAGAGCTTGGCAGGGGGTGGGAGGGAAGGGGGGGATGCGTGACCTGCCCGGTTCTCAGTGGCCACCCTGCGCTACCCTCTCCCAGAACCTGAGCTGCTCTGACGCGGCTGTCTGGTGCGTTTCACTGATCCTGGTGCTGCAGCTTCCTTACACTTCCCAAGAGGAGAAGCAGTTTGGAAAAACAAAATCAGAATAAGTTGGTCCTGAGTTCTAACTTTGGCTCTTCACCTTTCTAGTCCCCAATTTATATTGTTCCTCCGTGCGTCAGTTTTACCTGTGAGATAAGGCCAGTAGCCAGCCCCGTCCTGGCAGGGCTGTGGTGAGGAGGGGGGTGTCCGTGTGGAAAACTCCCTTTGTGAGAATGGTGCGTCCTAGGTGTTCACCAGGTCGTGGCCGCCTCTACTCCCTTTCTCTTTCTCCATCCTTCTTTCCTTAAAGAGTCCCCAGTGCTATCTGGGACATATTCCTCCGCCCAGAGCAGGGTCCCGCTTCCCTAAGGCCCTGCTCTGGGCTTCTGGGTTTGAGTCCTTGGCAAGCCCAGGAGAGGCGCTCAGGCTTCCCTGTCCCCCTTCCTCGTCCACCATCTCATGCCCCTGGCTCTCCTGCCCCTTCCCTACAGGGGTTCCTGGCTCTGCTCTTCAGACTGAGCCCCGTTCCCCTGCATCCCCGTTCCCCTGCATCCCCCTTCCCCTGCATCCCCCAGAGCCCCAGGCCACCTACTTGGCCTGGAACCCCACGAGAGGCCACCCCAGCCCTGTCTACCAGGCTGCCTTTTGGGTGGATTCTCCTCCAACTGTGGGGTGACTGCTTGGCATGGTCTTCACACTCGAAGATTTCGTTGGGGACTGGCGACAGACAGCCGGCTACAACCTGGACCAAGTCCTTGAACAGGGAGGTGTGTCCAGTTTGTTTCAGAATCTCGGGGTGTCCGTAACTCCGATCCAAAGGATTGTCCTGAGCGGTGAAAATGGGCTGAAGATCGACATCCATGTCATCATCCCGTATGAAGGTCTGAGCGGCGACCAAATGGGCCAGATCGAAAAAATTTTTAAGGTGGTGTACCCTGTGGATGATCATCACTTTAAGGTGATCCTGCACTATGGCACACTGGTAATCGACGGGGTTACGCCGAACATGATCGACTATTTCGGACGGCCGTATGAAGGCATCGCCGTGTTCGACGGCAAAAAGATCACTGTAACAGGGACCCTGTGGAACGGCAACAAAATTATCGACGAGCGCCTGATCAACCCCGACGGCTCCCTGCTGTTCCGAGTAACCATCAACGGAGTGACCGGCTGGCGGCTGTGCGAACGCATTCTGGCG".replace(' ', "").as_str(),
            vec![
                make_feat("hdr-5ha", "5' AAVS1 PPP1R12C Homology Arm", "misc_feature", 1, 860, 1, "#2563eb", None),
                make_feat("hdr-sa", "Splice acceptor region", "regulatory", 861, 1680, 1, "#10b981", None),
                make_feat("hdr-nluc", "NanoLuc (171 aa; stop codon beyond record)", "CDS", 1818, 2330, 1, "#f59e0b", Some("MVFTLEDFVGDWRQ...ERILA")),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Homo sapiens Chr19q13.42 AAVS1 HDR Donor")),
                ("Oligo Type", serde_json::json!("Symmetric 850-bp Homology Arm Donor")),
                ("Tm", serde_json::json!("65.0 °C")),
                ("%GC Primer Bind", serde_json::json!("60.2%")),
            ]),
            "2026-10-30T10:03:00Z",
            "Cloning",
        ),

        // ---- yadF (Pseudomonas stutzeri PSTAB_3282) template, the coding sequence NCBI returns
        // ---- for protein YP_004715652, and the four primers built from it (see the doc comment)
        make_sample_doc(
            "doc-cloning-yadf-cds",
            "yadF CDS",
            "YP_004715652",
            "Carbonic anhydrase (yadF / PSTAB_3282) of Pseudomonas stutzeri ATCC 17588, complete 645 bp coding sequence on the coding strand. Template for the BioBrick and Gateway cloning primers in this folder.",
            MoleculeType::DNA,
            Topology::Linear,
            "ATGAGCGAACTGGACCCGCTGTTCGAGAACAACGCCCGCTGGGCCGAAGCCATCAAGGAAGAAGACCCGGATTTCTTCCAGAAACTGGCCCGCCAGCAGACGCCGGAGTACCTGTGGATCGGCTGTTCCGATGCGCGGGTGCCGGCCAACGAGATCGTCGGCCTGCTGCCGGGCGACCTGTTCGTTCATCGCAACGTCGCCAACGTCGTGCTGCACACCGACCTCAACTGCCTGTCGGTCATCCAGTACGCGGTGGACGTGCTCAAGGTCAAACACATCCTGGTCACCGGCCACTACGGCTGCGGCGGCGTCCGCGCCTCCATGCGCGACGACCAGCTGGGCCTGATCGACGGCTGGCTGCGCAGCATCCGCGACCTCTACTACGAACACCGCGTGCACCTGTCCAAGCTGGCCAGTGAGGAAGAACAGGTCGACCGCCTGTGCGAGCTCAATGTCATCCAGCAGGTCGCCAACGTCAGTCACACCACCATCGTCCAGAACGCCTGGCACCGCGGGCAGCCGCTCGCCGTGCACGGCTGCATTTACGGCATCAAGGATGGCCTGTGGAAGAATCTCAACGTCACGGTGAGCGGGCTCGACCAGTTGCCCTCGCAATACCGTCTGCGCCCGCCGCGCCAAGCCTGA",
            vec![
                make_feat("yadf-src", "Pseudomonas stutzeri ATCC 17588", "source", 1, 645, 1, "#64748b", Some("mol_type genomic DNA; db_xref taxon:96563")),
                make_feat("yadf-gene", "yadF", "gene", 1, 645, 1, "#2563eb", Some("locus_tag PSTAB_3282; db_xref GeneID:10944325")),
                make_feat("yadf-cds", "carbonic anhydrase", "CDS", 1, 645, 1, "#8b5cf6", Some("codon_start 1; transl_table 11; protein_id YP_004715652.1")),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Pseudomonas stutzeri ATCC 17588 = LMG 11199")),
                ("Taxonomy", serde_json::json!("Bacteria; Proteobacteria; Gammaproteobacteria; Pseudomonadales; Pseudomonadaceae; Pseudomonas")),
                ("Taxa ID", serde_json::json!("96563")),
                ("Genetic Code", serde_json::json!("Bacterial")),
                ("Genetic Source", serde_json::json!("chromosome")),
                ("Other Aliases", serde_json::json!("PSTAB_3282")),
                ("Product", serde_json::json!("carbonic anhydrase")),
                ("Protein ID", serde_json::json!("YP_004715652.1")),
                ("Source record", serde_json::json!("NCBI Protein YP_004715652 coding sequence")),
            ]),
            SOURCED_ON,
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-yadf-f-biobrick",
            "yadF F +BioBrick",
            "MBC_PRM_YADF_01",
            "yadF forward primer: the BBF RFC 10 prefix (EcoRI-NotI-XbaI, whose ATG completes the XbaI site) followed by the first 18 bases of the CDS.",
            MoleculeType::DNA,
            Topology::Linear,
            "GAATTCGCGGCCGCTTCTAGATGAGCGAACTGGACCCG",
            vec![
                make_feat("yadf-fbb-pre", "BioBrick prefix", "misc_feature", 1, 20, 1, "#f59e0b", Some("BBF RFC 10 prefix for a coding part")),
                make_feat("yadf-fbb-ecori", "EcoRI", "restriction site", 1, 6, 0, "#ef4444", Some("GAATTC")),
                make_feat("yadf-f-biobrick-bind", "Binding Region", "primer_bind", 21, 38, 1, "#16a34a", Some("yadF CDS 1-18")),
            ],
            None,
            "primer",
            {
                let mut entries = primer_thermo_meta("ATGAGCGAACTGGACCCG");
                entries.extend([
                    ("Product Size", serde_json::json!("686 bp")),
                    ("Oligo Type", serde_json::json!("Forward Primer")),
                ]);
                let mut meta = make_meta(&entries);
                meta.extend(make_meta(&[
                    ("Organism", serde_json::json!("Pseudomonas stutzeri ATCC 17588 = LMG 11199")),
                    ("Taxonomy", serde_json::json!("Bacteria; Proteobacteria; Gammaproteobacteria; Pseudomonadales; Pseudomonadaceae; Pseudomonas")),
                    ("Taxa ID", serde_json::json!("96563")),
                ]));
                meta
            },
            SOURCED_ON,
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-yadf-r-biobrick",
            "yadF R +BioBrick",
            "MBC_PRM_YADF_04",
            "yadF reverse primer: the reverse complement of the CDS's last 18 bases followed by the BBF RFC 10 suffix (SpeI-NotI-PstI).",
            MoleculeType::DNA,
            Topology::Linear,
            "CTGCAGCGGCCGCTACTAGTATCAGGCTTGGCGCGGCGG",
            vec![
                make_feat("yadf-rbb-suf", "BioBrick suffix", "misc_feature", 1, 21, -1, "#f59e0b", Some("BBF RFC 10 suffix, reverse complemented")),
                make_feat("yadf-rbb-psti", "PstI", "restriction site", 1, 6, 0, "#ef4444", Some("CTGCAG")),
                make_feat("yadf-r-biobrick-bind", "Binding Region", "primer_bind_reverse", 22, 39, -1, "#16a34a", Some("yadF CDS 628-645, reverse strand")),
            ],
            None,
            "primer",
            {
                let mut entries = primer_thermo_meta("TCAGGCTTGGCGCGGCGG");
                entries.extend([
                    ("Product Size", serde_json::json!("686 bp")),
                    ("Oligo Type", serde_json::json!("Reverse Primer")),
                ]);
                let mut meta = make_meta(&entries);
                meta.extend(make_meta(&[
                    ("Organism", serde_json::json!("Pseudomonas stutzeri ATCC 17588 = LMG 11199")),
                    ("Taxonomy", serde_json::json!("Bacteria; Proteobacteria; Gammaproteobacteria; Pseudomonadales; Pseudomonadaceae; Pseudomonas")),
                    ("Taxa ID", serde_json::json!("96563")),
                ]));
                meta
            },
            SOURCED_ON,
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-yadf-f-attb1",
            "yadF F +attB1",
            "MBC_PRM_YADF_02",
            "yadF forward primer: the Gateway attB1 primer tail followed by the first 18 bases of the CDS.",
            MoleculeType::DNA,
            Topology::Linear,
            "GGGGACAAGTTTGTACAAAAAAGCAGGCTATGAGCGAACTGGACCCG",
            vec![
                make_feat("yadf-fb1-att", "attB1", "protein_bind", 1, 29, 1, "#f59e0b", Some("Gateway BP recombination site")),
                make_feat("yadf-f-attb1-bind", "Binding Region", "primer_bind", 30, 47, 1, "#16a34a", Some("yadF CDS 1-18")),
            ],
            None,
            "primer",
            {
                let mut entries = primer_thermo_meta("ATGAGCGAACTGGACCCG");
                entries.extend([
                    ("Product Size", serde_json::json!("703 bp")),
                    ("Oligo Type", serde_json::json!("Forward Primer")),
                ]);
                let mut meta = make_meta(&entries);
                meta.extend(make_meta(&[
                    ("Organism", serde_json::json!("Pseudomonas stutzeri ATCC 17588 = LMG 11199")),
                    ("Taxonomy", serde_json::json!("Bacteria; Proteobacteria; Gammaproteobacteria; Pseudomonadales; Pseudomonadaceae; Pseudomonas")),
                    ("Taxa ID", serde_json::json!("96563")),
                ]));
                meta
            },
            SOURCED_ON,
            "Cloning",
        ),
        make_sample_doc(
            "doc-cloning-yadf-r-attb2",
            "yadF R +attB2",
            "MBC_PRM_YADF_03",
            "yadF reverse primer: the Gateway attB2 primer tail followed by the reverse complement of the CDS's last 18 bases.",
            MoleculeType::DNA,
            Topology::Linear,
            "GGGGACCACTTTGTACAAGAAAGCTGGGTTCAGGCTTGGCGCGGCGG",
            vec![
                make_feat("yadf-rb2-att", "attB2", "protein_bind", 1, 29, 1, "#f59e0b", Some("Gateway BP recombination site")),
                make_feat("yadf-r-attb2-bind", "Binding Region", "primer_bind_reverse", 30, 47, -1, "#16a34a", Some("yadF CDS 628-645, reverse strand")),
            ],
            None,
            "primer",
            {
                let mut entries = primer_thermo_meta("TCAGGCTTGGCGCGGCGG");
                entries.extend([
                    ("Product Size", serde_json::json!("703 bp")),
                    ("Oligo Type", serde_json::json!("Reverse Primer")),
                ]);
                let mut meta = make_meta(&entries);
                meta.extend(make_meta(&[
                    ("Organism", serde_json::json!("Pseudomonas stutzeri ATCC 17588 = LMG 11199")),
                    ("Taxonomy", serde_json::json!("Bacteria; Proteobacteria; Gammaproteobacteria; Pseudomonadales; Pseudomonadaceae; Pseudomonas")),
                    ("Taxa ID", serde_json::json!("96563")),
                ]));
                meta
            },
            SOURCED_ON,
            "Cloning",
        ),

        // =========================================================================
        // EXTRA PLASMIDS & VECTORS (2 additional vectors -> 10 total in folder)
        // =========================================================================
        make_sample_doc(
            "doc-plasmid-px459-spcas9",
            "pSpCas9(BB)-2A-Puro (PX459_gRNA_Scaffold)",
            "MBC_VEC_009",
            "All-in-one mammalian CRISPR genome-editing vector carrying human U6 BbsI sgRNA cassette and CBh-driven SpCas9-T2A-PuroR.",
            MoleculeType::DNA,
            Topology::Circular,
            "GAGGGCCTATTTCCCATGATTCCTTCATATTTGCATATACGATACAAGGCTGTTAGAGAGATAATTGGAATTAATTTGACTGTAAACACAAAGATATTAGTACAAAATACGTGACGTAGAAAGTAATAATTTCTTGGGTAGTTTGCAGTTTTAAAATTATGTTTTAAAATGGACTATCATATGCTTACCGTAACTTGAAAGTATTTCGATTTCTTGGCTTTATATATCTTGTGGAAAGGACGAAACACCGGGTCTTCGAGAAGACCTGTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGCTTTTTTGTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTTTTAGCGCGTGCGCCAATTCTGCAGACAAATGGCTCTAGAGGTACCCGTTACATAACTTACGGTAAATGGCCCGCCTGGCTGACCGCCCAACGACCCCCGCCCATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAGGGACTTTCCATTGACGTCAATGGGTGGAGTATTTACGGTAAACTGCCCACTTGGCAGTACATCAAGTGTATCATATGCCAAGTACGCCCCCTATTGACGTCAATGACGGTAAATGGCCCGCCTGGCATTATGCCCAGTACATGACCTTATGGGACTTTCCTACTTGGCAGTACATCTACGTATTAGTCATCGCTATTACCATGGTCGAGGTGAGCCCCACGTTCTGCTTCACTCTCCCCATCTCCCCCCCCTCCCCACCCCCAATTTTGTATTTATTTATTTTTTAATTATTTTGTGCAGCGATGGGGGCGGGGGGGGGGGGGGGGCGCGCGCCAGGCGGGGCGGGGCGGGGCGAGGGGCGGGGCGGGGCGAGGCGGAGAGGTGCGGCGGCAGCCAATCAGAGCGGCGCGCTCCGAAAGTTTCCTTTTATGGCGAGGCGGCGGCGGCGGCGGCCCTATAAAAAGCGAAGCGCGCGGCGGGCGGGAGTCGCTGCGACGCTGCCTTCGCCCCGTGCCCCGCTCCGCCGCCGCCTCGCGCCGCCCGCCCCGGCTCTGACTGACCGCGTTACTCCCACAGGTGAGCGGGCGGGACGGCCCTTCTCCTCCGGGCTGTAATTAGCTGAGCAAGAGGTAAGGGTTTAAGGGATGGTTGGTTGGTGGGGTATTAATGTTTAATTACCTGGAGCACCTGCCTGAAATCACTTTTTTTCAGGTTGGACCGGTGCCACCATGGACTATAAGGACCACGACGGAGACTACAAGGATCATGATATTGATTACAAAGACGATGACGATAAGATGGCCCCAAAGAAGAAGCGGAAGGTCGGTATCCACGGAGTCCCAGCAGCCGACAAGAAGTACAGCATCGGCCTGGACATCGGCACCAACTCTGTGGGCTGGGCCGTGATCACCGACGAGTACAAGGTGCCCAGCAAGAAATTCAAGGTGCTGGGCAACACCGACCGGCACAGCATCAAGAAGAACCTGATCGGAGCCCTGCTGTTCGACAGCGGCGAAACAGCCGAGGCCACCCGGCTGAAGAGAACCGCCAGAAGAAGATACACCAGACGGAAGAACCGGATCTGCTATCTGCAAGAGATCTTCAGCAACGAGATGGCCAAGGTGGACGACAGCTTCTTCCACAGACTGGAAGAGTCCTTCCTGGTGGAAGAGGATAAGAAGCACGAGCGGCACCCCATCTTCGGCAACATCGTGGACGAGGTGGCCTACCACGAGAAGTACCCCACCATCTACCACCTGAGAAAGAAACTGGTGGACAGCACCGACAAGGCCGACCTGCGGCTGATCTATCTGGCCCTGGCCCACATGATCAAGTTCCGGGGCCACTTCCTGATCGAGGGCGACCTGAACCCCGACAACAGCGACGTGGACAAGCTGTTCATCCAGCTGGTGCAGACCTACAACCAGCTGTTCGAGGAAAACCCCATCAACGCCAGCGGCGTGGACGCCAAGGCCATCCTGTCTGCCAGACTGAGCAAGAGCAGACGGCTGGAAAATCTGATCGCCCAGCTGCCCGGCGAGAAGAAGAATGGCCTGTTCGGAAACCTGATTGCCCTGAGCCTGGGCCTGACCCCCAACTTCAAGAGCAACTTCGACCTGGCCGAGGATGCCAAACTGCAGCTGAGCAAGGACACCTACGACGACGACCTGGACAACCTGCTGGCCCAGATCGGCGACCAGTACGCCGACCTGTTTCTGGCCGCCAAGAACCTGTCCGACGCCATCCTGCTTAGCGACATCCTGAGAGTGAACACCGAGATCACCAAGGCCCCCCTGAGCGCCTCTATGATCAAGAGATACGACGAGCACCACCAGGACCTGACCCTGCTGAAAGCTCTCGTGCGGCAGCAGCTGCCTGAGAAGTACAAAGAGATTTTCTTCGACCAGAGCAAGAACGGCTACGCCGGCTACATTGACGGCGGAGCCAGCCAGGAAGAGTTCTACAAGTTCATCAAGCCCATCCTGGAAAAGATGGACGGCACCGAGGAACTGCTCGTGAAGCTGAACAGAGAGGACCTGCTGCGGAAGCAGCGGACCTTCGACAACGGCAGCATCCCCCACCAGATCCACCTGGGAGAGCTGCACGCCATTCTGCGGCGGCAGGAAGATTTTTACCCATTCCTGAAGGACAACCGGGAAAAGATCGAGAAGATCCTGACCTTCCGCATCCCCTACTACGTGGGCCCTCTGGCCAGGGGAAACAGCAGATTCGCCTGGATGACCAGAAAGAGCGAGGAAACCATCACCCCCTGGAACTTCGAGGAAGTGGTGGACAAGGGCGCTTCCGCCCAGAGCTTCATCGAGCGGATGACCAACTTCGATAAGAACCTGCCCAACGAGAAGGTGCTGCCCAAGCACAGCCTGCTGTACGAGTACTTCACCGTGTATAACGAGCTGACCAAAGTGAAATACGTGACCGAGGGAATGAGAAAGCCCGCCTTCCTGAGCGGCGAGCAGAAAAAGGCCATCGTGGACCTGCTGTTCAAGACCAACCGGAAAGTGACCGTGAAGCAGCTGAAAGAGGACTACTTCAAGAAAATCGAGTGCTTCGACTCCGTGGAAATCTCCGGCGTGGAAGATCGGTTCAACGCCTCCCTGGGCACATACCACGATCTGCTGAAAATTATCAAGGACAAGGACTTCCTGGACAATGAGGAAAACGAGGACATTCTGGAAGATATCGTGCTGACCCTGACACTGTTTGAGGACAGAGAGATGATCGAGGAACGGCTGAAAACCTATGCCCACCTGTTCGACGACAAAGTGATGAAGCAGCTGAAGCGGCGGAGATACACCGGCTGGGGCAGGCTGAGCCGGAAGCTGATCAACGGCATCCGGGACAAGCAGTCCGGCAAGACAATCCTGGATTTCCTGAAGTCCGACGGCTTCGCCAACAGAAACTTCATGCAGCTGATCCACGACGACAGCCTGACCTTTAAAGAGGACATCCAGAAAGCCCAGGTGTCCGGCCAGGGCGATAGCCTGCACGAGCACATTGCCAATCTGGCCGGCAGCCCCGCCATTAAGAAGGGCATCCTGCAGACAGTGAAGGTGGTGGACGAGCTCGTGAAAGTGATGGGCCGGCACAAGCCCGAGAACATCGTGATCGAAATGGCCAGAGAGAACCAGACCACCCAGAAGGGACAGAAGAACAGCCGCGAGAGAATGAAGCGGATCGAAGAGGGCATCAAAGAGCTGGGCAGCCAGATCCTGAAAGAACACCCCGTGGAAAACACCCAGCTGCAGAACGAGAAGCTGTACCTGTACTACCTGCAGAATGGGCGGGATATGTACGTGGACCAGGAACTGGACATCAACCGGCTGTCCGACTACGATGTGGACCATATCGTGCCTCAGAGCTTTCTGAAGGACGACTCCATCGACAACAAGGTGCTGACCAGAAGCGACAAGAACCGGGGCAAGAGCGACAACGTGCCCTCCGAAGAGGTCGTGAAGAAGATGAAGAACTACTGGCGGCAGCTGCTGAACGCCAAGCTGATTACCCAGAGAAAGTTCGACAATCTGACCAAGGCCGAGAGAGGCGGCCTGAGCGAACTGGATAAGGCCGGCTTCATCAAGAGACAGCTGGTGGAAACCCGGCAGATCACAAAGCACGTGGCACAGATCCTGGACTCCCGGATGAACACTAAGTACGACGAGAATGACAAGCTGATCCGGGAAGTGAAAGTGATCACCCTGAAGTCCAAGCTGGTGTCCGATTTCCGGAAGGATTTCCAGTTTTACAAAGTGCGCGAGATCAACAACTACCACCACGCCCACGACGCCTACCTGAACGCCGTCGTGGGAACCGCCCTGATCAAAAAGTACCCTAAGCTGGAAAGCGAGTTCGTGTACGGCGACTACAAGGTGTACGACGTGCGGAAGATGATCGCCAAGAGCGAGCAGGAAATCGGCAAGGCTACCGCCAAGTACTTCTTCTACAGCAACATCATGAACTTTTTCAAGACCGAGATTACCCTGGCCAACGGCGAGATCCGGAAGCGGCCTCTGATCGAGACAAACGGCGAAACCGGGGAGATCGTGTGGGATAAGGGCCGGGATTTTGCCACCGTGCGGAAAGTGCTGAGCATGCCCCAAGTGAATATCGTGAAAAAGACCGAGGTGCAGACAGGCGGCTTCAGCAAAGAGTCTATCCTGCCCAAGAGGAACAGCGATAAGCTGATCGCCAGAAAGAAGGACTGGGACCCTAAGAAGTACGGCGGCTTCGACAGCCCCACCGTGGCCTATTCTGTGCTGGTGGTGGCCAAAGTGGAAAAGGGCAAGTCCAAGAAACTGAAGAGTGTGAAAGAGCTGCTGGGGATCACCATCATGGAAAGAAGCAGCTTCGAGAAGAATCCCATCGACTTTCTGGAAGCCAAGGGCTACAAAGAAGTGAAAAAGGACCTGATCATCAAGCTGCCTAAGTACTCCCTGTTCGAGCTGGAAAACGGCCGGAAGAGAATGCTGGCCTCTGCCGGCGAACTGCAGAAGGGAAACGAACTGGCCCTGCCCTCCAAATATGTGAACTTTCTGTACCTGGCCAGCCACTATGAGAAGCTGAAGGGCTCCCCCGAGGATAATGAGCAGAAACAGCTGTTTGTGGAACAGCACAAGCACTACCTGGACGAGATCATCGAGCAGATCAGCGAGTTCTCCAAGAGAGTGATCCTGGCCGACGCTAATCTGGACAAAGTGCTGTCCGCCTACAACAAGCACCGGGATAAGCCCATCAGAGAGCAGGCCGAGAATATCATCCACCTGTTTACCCTGACCAATCTGGGAGCCCCTGCCGCCTTCAAGTACTTTGACACCACCATCGACCGGAAGAGGTACACCAGCACCAAAGAGGTGCTGGACGCCACCCTGATCCACCAGAGCATCACCGGCCTGTACGAGACACGGATCGACCTGTCTCAGCTGGGAGGCGACTAA",
            vec![
                make_feat("px-u6", "Human U6 Pol-III Promoter", "promoter", 1, 249, 1, "#10b981", None),
                make_feat("px-scaf", "BbsI Stuffer + SpCas9 tracrRNA Scaffold", "misc_RNA", 250, 348, 1, "#f59e0b", None),
                make_feat("px-cbh", "CBh Hybrid Enhancer-Promoter", "promoter", 408, 1205, 1, "#14b8a6", None),
                make_feat("px-cas9", "3xFLAG-NLS-SpCas9 Endonuclease", "CDS", 1269, 5492, 1, "#8b5cf6", None),
            ],
            None,
            "circular-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Synthetic mammalian CRISPR-Cas9 shuttle plasmid")),
                ("Replicon type", serde_json::json!("pUC high-copy + f1 ori")),
                ("Selection", serde_json::json!("AmpR (bacterial) / Puromycin (mammalian)")),
            ]),
            "2026-10-30T10:03:30Z",
            "Plasmids & Vectors",
        ),
        make_sample_doc(
            "doc-plasmid-pyes2-gal1",
            "pYES2-GAL1_Yeast_2Micron_Shuttle",
            "MBC_VEC_010",
            "1,456 bp region of the yeast 2-micron shuttle vector pYES2: GAL1 promoter, polylinker, CYC1 terminator and the 5-prime part of URA3 (the record ends inside URA3).",
            MoleculeType::DNA,
            Topology::Linear,
            "ACGGATTAGAAGCCGCCGAGCGGGTGACAGCCCTCCGAAGGAAGACTCTCCTCCGTGCGTCCTCGTCTTCACCGGTCGCGTTCCTGAAACGCAGATGTGCCTCGCGCCGCACTGCTCCGAACAATAAAGATTCTACAATACTAGCTTTTATGGTTATGAAGAGGAAAAATTGGCAGTAACCTGGCCCCACAAACCTTCAAATGAACGAATCAAATTAACAACCATAGGATGATAATGCGATTAGTTTTTTAGCCTTATTTCTGGGGTAATTAATCAGCGAAGCGATGATTTTTGATCTATTAACAGATATATAAATGCAAAAACTGCATAACCACTTTAACTAATACTTTCAACATTTTCGGTTTGTATTACTTCTTATTCAAATGTAATAAAAGTATCAACAAAAAATTGTTAATATACCTCTATACTTTAACGTCAAGGAGAAAAAACCCCGGATCGGACTACTAGCAGCTGTAATACGACTCACTATAGGGAATATTAAAGCTTGGTACCGAGCTCGGATCCACTAGTAACGGCCGCCAGTGTGCTGGAATTCCTGCAGCCCGGGGGATCCGCCCCTCTCCTCCGATCATGCATGTGCTCTGTATGTATATAAAACTCTTGTTTTCTTCTTTTCTCTAAATATTCTTTCCTTATACATTAGGACCTTTGCAGCATAAATTACTATACTTCTATAGACACACAAACACAAATACACACACTAAATTAATAATGTCGAAAGCTACATATAAGGAACGTGCTGCTACTCATCCTAGTCCTGTTGCTGCCAAGCTATTTAATATCATGCACGAAAAGCAAACAAACTTGTGTGCTTCATTGGATGTTCGTACCACCAAGGAATTACTGGAGTTAGTTGAAGCATTAGGTCCCAAAATTTGTTTACTAAAAACACATGTGGATATCTTGACTGATTTTTCCATGGAGGGCACAGTTAAGCCGCTAAAGGCATTATCCGCCAAGTACAATTTTTTACTCTTCGAAGACAGAAAATTTGCTGACATTGGTAATACAGTCAAATTGCAGTACTCTGCGGGTGTATACAGAATAGCAGAATGGGCAGACATTACGAATGCACACGGTGTGGTGGGCCCAGGTATTGTTAGCGGTTTGAAGCAGGCGGCAGAAGAAGTAACAAAGGAACCTAGAGGCCTTTTGATGTTAGCAGAATTGTCATGCAAGGGCTCCCTATCTACTGGAGAATATACTAAGGGTACTGTTGACATTGCGAAGAGCGACAAAGATTTTGTTATCGGCTTTATTGCTCAAAGAGACATGGGTGGAAGAGATGAAGGTTACGATTGGTTGATTATGACACCCGGTGTGGGTTTAGATGACAAGGGAGACGCATTGGGTCAACAGTATAGAACCGTGGATGATGTGGTCTCTACAGGATCTGACATTATTATTGTTGAAGAGGACATTTTTGCCGCTGTAA",
            vec![
                make_feat("pyes-gal1", "GAL1 Galactose-Inducible Promoter", "promoter", 1, 452, 1, "#10b981", Some("UAS-GAL4 binding sites")),
                make_feat("pyes-mcs", "pYES2 Polylinker MCS", "misc_feature", 485, 565, 1, "#f59e0b", None),
                make_feat("pyes-cyc1", "CYC1 Transcription Terminator", "terminator", 575, 725, 1, "#ef4444", None),
                make_feat("pyes-ura3", "URA3 (5' part; continues beyond record)", "CDS", 733, 1456, 1, "#2563eb", Some("Orotidine-5-phosphate decarboxylase, first 241 codons")),
            ],
            None,
            "linear-dna",
            make_meta(&[
                ("Organism", serde_json::json!("Synthetic yeast-bacterial episomal shuttle plasmid")),
                ("Replicon type", serde_json::json!("2-micron yeast episome + pUC ori")),
                ("Selection", serde_json::json!("URA3 prototrophy / AmpR")),
            ]),
            "2026-10-30T10:04:00Z",
            "Plasmids & Vectors",
        ),
    ];
    docs.extend(crate::sample_genomes_data::get_genome_sample_documents());
    docs.extend(crate::sample_alignments_data::get_alignment_sample_documents());
    docs.extend(crate::sample_alignments_data::get_contig_assembly_sample_documents());
    for doc in &mut docs {
        if doc
            .history
            .iter()
            .any(|h| h.operation.contains("Vector Library"))
        {
            crate::vector_architect::mark_schematic_vector(doc);
        }
    }
    docs
}

/// Deterministically synthesize a biologically structured multi-hundred-kilobase or multi-megabase
/// circular bacterial chromosome ('oriC' at 1 bp, 'terC' at L/2, asymmetric leading-strand GC-skew,
/// rRNA operons, CpG islands, and 120+ realistic annotated genes) for large-genome workbench exploration.
pub fn generate_large_genome_benchmark(length_bp: usize, organism_preset: &str) -> SequenceDocument {
    let target_len = length_bp.clamp(50_000, 5_000_000);
    let half = target_len / 2;
    let mut rng = SplitMix64::new(0xEC01_1B10_C2AF_7001 ^ (target_len as u64));
    let mut seq_bytes = Vec::with_capacity(target_len);

    // Leading-strand replication asymmetry: G-enriched [0..half] (oriC -> terC), C-enriched [half..L]
    for pos in 0..target_len {
        let r = rng.next_usize(1000);
        let in_cpg_island = (pos % 62_500) < 950;
        let b = if in_cpg_island {
            match r % 10 {
                0..=3 => b'G',
                4..=7 => b'C',
                8 => b'A',
                _ => b'T',
            }
        } else if pos < half {
            // Positive GC-skew replichore (G ~ 29%, C ~ 22%, A ~ 25%, T ~ 24%)
            if r < 290 {
                b'G'
            } else if r < 510 {
                b'C'
            } else if r < 760 {
                b'A'
            } else {
                b'T'
            }
        } else {
            // Negative GC-skew replichore (C ~ 29%, G ~ 22%, T ~ 25%, A ~ 24%)
            if r < 220 {
                b'G'
            } else if r < 510 {
                b'C'
            } else if r < 750 {
                b'A'
            } else {
                b'T'
            }
        };
        seq_bytes.push(b);
    }

    // Stamp authentic DnaA-box oriC motif at position 1 and Tus-binding terC site at half
    let oric_motif = b"TTATCCACAAGAACAGATCTTTATCCACAGGGCGGCCGCGAATTC";
    for (k, &mb) in oric_motif.iter().enumerate() {
        if k < target_len {
            seq_bytes[k] = mb;
        }
    }
    let terc_motif = b"AATTAGTATGTTGTAACTAAAGTGGATCCCTCGAG";
    for (k, &mb) in terc_motif.iter().enumerate() {
        if half + k < target_len {
            seq_bytes[half + k] = mb;
        }
    }

    let gene_names = [
        ("dnaA", "Chromosomal replication initiator protein DnaA", "#2563eb"),
        ("dnaN", "DNA polymerase III beta sliding clamp subunit", "#0284c7"),
        ("recF", "DNA replication and SOS repair protein RecF", "#0ea5e9"),
        ("gyrB", "DNA gyrase subunit B topoisomerase II", "#10b981"),
        ("rpoB", "DNA-directed RNA polymerase subunit beta", "#059669"),
        ("rpoC", "DNA-directed RNA polymerase subunit beta'", "#16a34a"),
        ("lacZ", "Beta-galactosidase lactose metabolism enzyme", "#7c3aed"),
        ("lacY", "Lactose permease MFS symporter", "#8b5cf6"),
        ("recA", "Recombinase A homologous strand exchange ATPase", "#f59e0b"),
        ("groEL", "60 kDa chaperonin GroEL protein folding cage", "#d97706"),
        ("atpA", "F1F0 ATP synthase subunit alpha", "#ec4899"),
        ("ftsZ", "Cell division GTPase cytokinetic Z-ring protein", "#e11d48"),
    ];

    let mut features = Vec::new();
    features.push(SequenceFeature {
        id: "chr-oric".to_string(),
        name: "oriC (Replication Origin)".to_string(),
        feature_type: "rep_origin".to_string(),
        start: 1,
        end: 245,
        strand: 1,
        color: "#f59e0b".to_string(),
        notes: Some("DnaA box cluster chromosomal origin of bidirectional replication".to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });
    features.push(SequenceFeature {
        id: "chr-terc".to_string(),
        name: "terC (Replication Terminus)".to_string(),
        feature_type: "regulatory".to_string(),
        start: half + 1,
        end: (half + 180).min(target_len),
        strand: -1,
        color: "#dc2626".to_string(),
        notes: Some("Tus-bound replication fork trap terminus".to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });

    let step = (target_len / 120).max(1200);
    let mut cursor = 450usize;
    let mut gene_idx = 0usize;
    while cursor + 1050 < target_len && features.len() < 140 {
        let (gname, gdesc, gcolor) = gene_names[gene_idx % gene_names.len()];
        let cds_len = 720 + ((gene_idx * 93) % 630);
        let cds_len_triplet = cds_len - (cds_len % 3);
        let strand = if cursor < half { 1i8 } else { -1i8 };

        // Stamp start/stop codons into the chromosome sequence
        if strand == 1 && cursor + cds_len_triplet <= target_len {
            seq_bytes[cursor - 1..cursor + 2].copy_from_slice(b"ATG");
            let end0 = cursor - 1 + cds_len_triplet;
            seq_bytes[end0 - 3..end0].copy_from_slice(b"TAA");
        }

        features.push(SequenceFeature {
            id: format!("chr-cds-{}", gene_idx + 1),
            name: format!("{}_{}", gname, gene_idx + 1),
            feature_type: "CDS".to_string(),
            start: cursor,
            end: cursor + cds_len_triplet - 1,
            strand,
            color: gcolor.to_string(),
            notes: Some(gdesc.to_string()),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
        cursor += step;
        gene_idx += 1;
    }

    let org = if organism_preset.trim().is_empty() {
        "Escherichia coli K-12 MG1655"
    } else {
        organism_preset.trim()
    };
    let sequence = unsafe { String::from_utf8_unchecked(seq_bytes) };

    SequenceDocument {
        id: format!("doc-chr-bench-{}", target_len),
        name: format!("E_coli_K12_Replicon_{}kb", target_len / 1000),
        accession: format!("NC_000913_{}K", target_len / 1000),
        description: format!(
            "{} circular chromosome replicon ({} bp) with asymmetric oriC->terC leading-strand GC-skew and {} annotated loci.",
            org,
            target_len,
            features.len()
        ),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Circular,
        sequence,
        features,
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("h-chr-{}", target_len),
            timestamp: "2026-10-31 00:00".to_string(),
            operation: "Synthesized Large Chromosome Replicon (Rust)".to_string(),
            description: format!("Generated {} bp circular bacterial chromosome with oriC/terC GC-skew", target_len),
            parent_ids: Vec::new(),
            length_bp: target_len,
            topology: Topology::Circular,
            history_color: Some("#2563eb".to_string()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: Some("circular-dna".to_string()),
        doc_metadata: Some(HashMap::from([
            ("Organism".to_string(), serde_json::json!(org)),
            ("strain".to_string(), serde_json::json!("K-12 substr. MG1655")),
            ("chromosome".to_string(), serde_json::json!("Circular Chromosome")),
            ("Sequencing Technology (Genome-Assembly-Data)".to_string(), serde_json::json!("PacBio HiFi + Illumina")),
        ])),
        created_at: "2026-10-31T00:00:00Z".to_string(),
        updated_at: "2026-10-31T00:00:00Z".to_string(),
        folder: "Genomes/Bacteria".to_string(),
    }
}

/// Deterministically synthesize a large multi-domain protein document (e.g., 5,000–35,000 aa Titin-like
/// FnIII/Ig tandem repeat polyprotein) for large-protein viewport & biophysical benchmarking.
pub fn generate_large_protein_benchmark(length_aa: usize, protein_preset: &str) -> SequenceDocument {
    let target_aa = length_aa.clamp(500, 40_000);
    let ig_domain = b"LIEVEKPLYGVEVFVGETAHFEIELSEPDVHGQWKLKGQPLAASPDCEIIEDGKKHILILHNCQLGMTGEVSFQAANAKSAANLKVKEL";
    let helix_linker = b"EAAAKALEAEKAAKEAAAKALEAEKAAK";
    let mut seq = Vec::with_capacity(target_aa);
    seq.push(b'M');
    let mut features = Vec::new();
    let mut dom_idx = 1usize;

    while seq.len() < target_aa {
        let start = seq.len() + 1;
        let take_ig = ig_domain.len().min(target_aa - seq.len());
        seq.extend_from_slice(&ig_domain[..take_ig]);
        let end = seq.len();
        if end - start + 1 >= 45 && features.len() < 160 {
            features.push(SequenceFeature {
                id: format!("ig-dom-{}", dom_idx),
                name: format!("Ig_I-set_Domain_{}", dom_idx),
                feature_type: "CDS".to_string(),
                start,
                end,
                strand: 1,
                color: if dom_idx % 2 == 0 {
                    "#0284c7".to_string()
                } else {
                    "#7c3aed".to_string()
                },
                notes: Some("Immunoglobulin I-set beta-sandwich structural repeat".to_string()),
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            });
            dom_idx += 1;
        }
        if seq.len() < target_aa {
            let take_lnk = helix_linker.len().min(target_aa - seq.len());
            seq.extend_from_slice(&helix_linker[..take_lnk]);
        }
    }

    let label = if protein_preset.trim().is_empty() {
        "Titin_Ig_Polyprotein"
    } else {
        protein_preset.trim()
    };
    let sequence = unsafe { String::from_utf8_unchecked(seq) };

    SequenceDocument {
        id: format!("doc-prot-bench-{}", target_aa),
        name: format!("{}_{}aa", label, target_aa),
        accession: format!("NP_001254479_{}AA", target_aa),
        description: format!(
            "Multi-domain giant structural polyprotein ({} aa, {} Ig I-set repeats) for large-protein analysis.",
            target_aa,
            features.len()
        ),
        molecule_type: MoleculeType::Protein,
        topology: Topology::Linear,
        sequence,
        features,
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("h-prot-{}", target_aa),
            timestamp: "2026-10-31 00:00".to_string(),
            operation: "Synthesized Multi-Domain Giant Protein (Rust)".to_string(),
            description: format!("Generated {} aa polyprotein sequence", target_aa),
            parent_ids: Vec::new(),
            length_bp: target_aa,
            topology: Topology::Linear,
            history_color: Some("#7c3aed".to_string()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: Some("protein".to_string()),
        doc_metadata: Some(HashMap::from([
            ("Organism".to_string(), serde_json::json!("Homo sapiens")),
            ("PDB name".to_string(), serde_json::json!("1TIT")),
        ])),
        created_at: "2026-10-31T00:00:00Z".to_string(),
        updated_at: "2026-10-31T00:00:00Z".to_string(),
        folder: "Protein Documents".to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashSet;

    #[test]
    fn sample_library_populates_all_twelve_folders_with_valid_coordinates_and_alphabets() {
        let docs = get_sample_library();
        // 102 since US-01M6TGKH dropped the fictitious-character People alignment and its tree (D0094).
        assert_eq!(docs.len(), 102, "Expected 102 curated sample documents across all folders");

        let expected_head = [
            "doc-pet28-egfp",
            "doc-puc19",
            "doc-insert-mcherry",
            "doc-sanger-ab1-fwd",
            "doc-homolog-eyfp",
            "doc-homolog-ecfp",
        ];
        for (idx, expected_id) in expected_head.iter().enumerate() {
            assert_eq!(docs[idx].id, *expected_id);
        }

        let mut seen_ids = HashSet::new();
        let mut folder_counts: HashMap<String, usize> = HashMap::new();
        let valid_dna = "ACGTRYSWKMBDHVN";
        let valid_rna = "ACGURYSWKMBDHVN";
        let valid_aa = "ACDEFGHIKLMNPQRSTVWYBXZJUO*";

        for doc in &docs {
            assert!(seen_ids.insert(doc.id.clone()), "Duplicate sample doc id: {}", doc.id);
            let declared = doc
                .doc_metadata
                .as_ref()
                .and_then(|m| m.get("Declared Length"))
                .and_then(|v| v.as_u64())
                .unwrap_or(0) as usize;
            let is_summary = doc.sequence.is_empty() && declared > 0;
            let kind = doc.document_kind.as_deref().unwrap_or("");
            // A tree document is a topology; it only carries bases when it was built from an
            // alignment, and a NEXUS tree imported on its own carries none.
            let is_bare_tree = kind == "tree" && doc.sequence.is_empty();
            // Sequencing oligos are legitimately short — the M13 and T3 primers are 17-mers —
            // so they get the shorter floor; everything else must carry a real stretch of bases.
            let floor = if kind == "primer" { 15 } else { 18 };
            // Contig summaries carry annotations only; every other record carries its bases.
            assert!(
                is_summary || is_bare_tree || doc.sequence.len() >= floor,
                "Sequence too short in {}",
                doc.id
            );
            let span = if is_summary { declared } else { doc.sequence.len() };
            let normalized_folder = if doc.folder == "Cloning Inserts & PCR" {
                "Cloning"
            } else {
                doc.folder.as_str()
            };
            *folder_counts.entry(normalized_folder.to_string()).or_insert(0) += 1;

            // An aligned document's own sequence is its consensus, so it carries gap columns.
            let is_aligned = doc
                .alignment_meta
                .as_ref()
                .and_then(|m| m.is_aligned)
                .unwrap_or(false);

            for ch in doc.sequence.chars() {
                if is_aligned && ch == '-' {
                    continue;
                }
                let ok = match doc.molecule_type {
                    MoleculeType::DNA => valid_dna.contains(ch),
                    MoleculeType::RNA => valid_rna.contains(ch),
                    MoleculeType::Protein => valid_aa.contains(ch),
                };
                assert!(ok, "Invalid character '{}' in {} ({:?})", ch, doc.id, doc.molecule_type);
            }

            for feat in &doc.features {
                assert!(
                    feat.start >= 1 && feat.start <= feat.end && feat.end <= span,
                    "Out-of-bounds feature {} ({}..={}) in {} (len={})",
                    feat.id,
                    feat.start,
                    feat.end,
                    doc.id,
                    span
                );
            }
        }

        let required_folders = [
            "Alignments",
            "Cloning",
            "Contig Assembly",
            "Genomes/Bacteria",
            "Genomes/Eukaryotes",
            "Genomes/Human",
            "Genomes/Plants",
            "Genomes/Viruses",
            "Plasmids & Vectors",
            "Primers",
            "Protein Documents",
            "Tree Documents",
        ];
        for folder in required_folders {
            let count = folder_counts.get(folder).copied().unwrap_or(0);
            // Every tree must carry a real stored topology, and the reference set has only a
            // handful of those, so Tree Documents holds fewer records than the other folders: two,
            // COXII and Three Kingdoms, since US-01M6TGKH dropped the fictitious-character People
            // tree with its alignment (D0094).
            let minimum = if folder == "Tree Documents" { 2 } else { 5 };
            assert!(count >= minimum, "Expected >= {} sample documents in '{}', found {}", minimum, folder, count);
        }
    }
}
