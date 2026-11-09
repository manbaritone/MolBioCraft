// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use std::collections::{HashMap, HashSet};

use molbiocraft_align::{run_multiple_sequence_alignment, MsaInputDoc};
use molbiocraft_core::{
    clean_alpha_sequence, clean_sequence, reverse_complement, DocumentAlignmentMeta,
    HistoryTreeNode, MoleculeType, PrimerRecord, SequenceDocument, SequenceFeature, Topology,
};
use molbiocraft_formats::export_genbank_flatfile;
use molbiocraft_protein::translate_sequence;
use serde::{Deserialize, Serialize};

use crate::thermodynamics::calculate_primer_metrics;

fn format_thousands(n: usize) -> String {
    let s = n.to_string();
    let bytes = s.as_bytes();
    let mut out = String::with_capacity(s.len() + s.len() / 3);
    for (idx, &b) in bytes.iter().enumerate() {
        if idx > 0 && (bytes.len() - idx) % 3 == 0 {
            out.push(',');
        }
        out.push(b as char);
    }
    out
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionRange1Based {
    pub start: usize,
    pub end: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MaskSequenceResult {
    pub updated: SequenceDocument,
    pub masked_bases: usize,
    /// Homopolymer runs masked (low-complexity mode); 0 in selection mode.
    #[serde(default)]
    pub masked_runs: usize,
    /// True when runs were masked but not annotated (more than MAX_MASK_RUN_FEATURES).
    #[serde(default)]
    pub annotations_omitted: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertOligoResult {
    pub updated_doc: SequenceDocument,
    pub primer: PrimerRecord,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnotateAttResult {
    pub updated_doc: SequenceDocument,
    pub added_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LineageBundleGenBankResult {
    pub content: String,
    pub included_names: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GroupByPrefixResult {
    pub updated_docs: Vec<SequenceDocument>,
    pub groups_created: Vec<String>,
}

/// Concatenate 2 or more `SequenceDocument`s end-to-end (with optional nucleotide/peptide spacer),
/// accurately shifting all `SequenceFeature` and `PrimerRecord` coordinates and recording lineage.
pub fn concatenate_sequence_documents(
    docs: &[SequenceDocument],
    spacer: &str,
) -> Result<SequenceDocument, String> {
    if docs.is_empty() {
        return Err("At least one sequence document is required to concatenate.".to_string());
    }
    let clean_spacer = clean_alpha_sequence(spacer);
    let is_protein = docs.iter().all(|d| d.molecule_type == MoleculeType::Protein);
    let now = "2026-10-31T00:00:00.000Z".to_string();

    let mut combined_seq = String::new();
    let mut combined_features: Vec<SequenceFeature> = Vec::new();
    let mut combined_primers: Vec<PrimerRecord> = Vec::new();
    let segment_colors = [
        "#2563eb", "#059669", "#d97706", "#7c3aed", "#db2777", "#0891b2",
    ];

    for (idx, doc) in docs.iter().enumerate() {
        if idx > 0 && !clean_spacer.is_empty() {
            let sp_start = combined_seq.len() + 1;
            combined_seq.push_str(&clean_spacer);
            combined_features.push(SequenceFeature {
                id: format!("concat-spacer-{}", idx),
                name: format!("Spacer_{}", idx),
                feature_type: "misc_feature".to_string(),
                start: sp_start,
                end: combined_seq.len(),
                strand: 1,
                color: "#64748b".to_string(),
                notes: Some(format!(
                    "Inter-sequence concatenation linker ({} bp)",
                    clean_spacer.len()
                )),
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            });
        }

        let offset = combined_seq.len();
        let part_seq = doc.sequence.to_ascii_uppercase();
        combined_seq.push_str(&part_seq);

        combined_features.push(SequenceFeature {
            id: format!("concat-part-{}-{}", idx, doc.id),
            name: format!("Part_{}_{}", idx + 1, doc.name),
            feature_type: "misc_feature".to_string(),
            start: offset + 1,
            end: offset + part_seq.len(),
            strand: 1,
            color: segment_colors[idx % segment_colors.len()].to_string(),
            notes: Some(format!(
                "Concatenated segment {} from {} ({})",
                idx + 1,
                doc.name,
                doc.accession
            )),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });

        for f in &doc.features {
            let mut nf = f.clone();
            nf.id = format!("concat-f-{}-{}", idx, f.id);
            nf.start += offset;
            nf.end += offset;
            if let Some(segs) = &mut nf.segments {
                for seg in segs.iter_mut() {
                    seg.start += offset;
                    seg.end += offset;
                }
            }
            combined_features.push(nf);
        }

        for p in &doc.primers {
            let mut np = p.clone();
            np.id = format!("concat-p-{}-{}", idx, p.id);
            np.bind_start += offset;
            np.bind_end += offset;
            combined_primers.push(np);
        }
    }

    let raw_base = if docs.len() == 1 {
        format!("{}_Tandem", docs[0].name)
    } else {
        format!("{}_plus_{}_Concatenated", docs[0].name, docs.len() - 1)
    };
    let name: String = raw_base.chars().take(56).collect();
    let names_joined: Vec<&str> = docs.iter().map(|d| d.name.as_str()).collect();
    let total_len = combined_seq.len();

    Ok(SequenceDocument {
        id: format!("doc-concat-{}-{}", docs.len(), total_len),
        name,
        accession: format!("MBC_CONCAT_{}", docs.len()),
        description: format!(
            "Concatenated {} sequence(s): {} ({} {}).",
            docs.len(),
            names_joined.join(" + "),
            format_thousands(total_len),
            if is_protein { "aa" } else { "bp" }
        ),
        molecule_type: if is_protein {
            MoleculeType::Protein
        } else {
            docs[0].molecule_type.clone()
        },
        topology: Topology::Linear,
        sequence: combined_seq,
        features: combined_features,
        primers: combined_primers,
        history: vec![HistoryTreeNode {
            id: format!("hist-concat-{}", total_len),
            timestamp: "2026-10-31 00:00".to_string(),
            operation: format!("Concatenate Sequences ({})", docs.len()),
            description: format!(
                "Joined {} into linear {} bp construct.",
                names_joined.join(", "),
                total_len
            ),
            parent_ids: docs.iter().map(|d| d.id.clone()).collect(),
            length_bp: total_len,
            topology: Topology::Linear,
            history_color: None,
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: Some(DocumentAlignmentMeta {
            sequence_count: Some(docs.len()),
            pairwise_identity_pct: None,
            identical_sites_pct: None,
            mean_coverage_x: None,
            genetic_code_label: Some("Standard (1)".to_string()),
            tree_builder: None,
            is_aligned: Some(true),
            sequences: None,
        }),
        document_kind: None,
        doc_metadata: None,
        created_at: now.clone(),
        updated_at: now,
        folder: "Alignments".to_string(),
    })
}

fn iupac_ambiguity_code(sorted_bases: &str) -> Option<char> {
    match sorted_bases {
        "A" => Some('A'),
        "C" => Some('C'),
        "G" => Some('G'),
        "T" => Some('T'),
        "AC" => Some('M'),
        "AG" => Some('R'),
        "AT" => Some('W'),
        "CG" => Some('S'),
        "CT" => Some('Y'),
        "GT" => Some('K'),
        "ACG" => Some('V'),
        "ACT" => Some('H'),
        "AGT" => Some('D'),
        "CGT" => Some('B'),
        "ACGT" => Some('N'),
        _ => None,
    }
}

/// Longest sequence the consensus generator will realign (center-star DP cost).
pub const MAX_CONSENSUS_REALIGN_LEN: usize = 3000;

/// Align 2+ `SequenceDocument`s via `rust-bio` progressive MSA and compute a thresholded
/// IUPAC Consensus `SequenceDocument` with exact % Pairwise Identity and % Identical Sites.
pub fn generate_consensus_document(
    docs: &[SequenceDocument],
    threshold_pct: f64,
) -> Result<SequenceDocument, String> {
    if docs.is_empty() {
        return Err("Select at least one sequence document to generate a consensus.".to_string());
    }
    let now = "2026-10-31T00:00:00.000Z".to_string();
    if docs.len() == 1 {
        let mut single = docs[0].clone();
        single.id = format!("doc-cons-1-{}", single.sequence.len());
        single.name = format!("{}_Consensus", single.name);
        single.accession = "MBC_CONS_1".to_string();
        single.folder = "Alignments".to_string();
        single.created_at = now.clone();
        single.updated_at = now;
        single.alignment_meta = Some(DocumentAlignmentMeta {
            sequence_count: Some(1),
            pairwise_identity_pct: Some(100.0),
            identical_sites_pct: Some(100.0),
            mean_coverage_x: None,
            genetic_code_label: Some("Standard (1)".to_string()),
            tree_builder: None,
            is_aligned: Some(true),
            sequences: None,
        });
        return Ok(single);
    }

    // Already-aligned input (equal-length rows carrying gaps, or documents
    // flagged as aligned) is used as-is: realigning would discard the user's
    // alignment. Unaligned input is realigned, but never silently truncated —
    // the center-star aligner only handles MAX_CONSENSUS_REALIGN_LEN residues.
    let first_len = docs[0].sequence.len();
    let equal_len = docs.iter().all(|d| d.sequence.len() == first_len);
    let flagged_aligned = docs.iter().all(|d| {
        d.alignment_meta
            .as_ref()
            .and_then(|m| m.is_aligned)
            .unwrap_or(false)
    });
    let has_gaps = docs.iter().any(|d| d.sequence.contains('-'));
    let aligned_rows: Vec<String> = if equal_len && (has_gaps || flagged_aligned) {
        docs.iter().map(|d| d.sequence.to_ascii_uppercase()).collect()
    } else {
        if let Some(long) = docs
            .iter()
            .find(|d| d.sequence.len() > MAX_CONSENSUS_REALIGN_LEN)
        {
            return Err(format!(
                "\"{}\" is {} residues long; consensus realignment is limited to {} residues per sequence. \
                 Align the sequences first (Alignment › Multiple Alignment) and build the consensus from the alignment.",
                long.name,
                long.sequence.len(),
                MAX_CONSENSUS_REALIGN_LEN
            ));
        }
        let msa_inputs: Vec<MsaInputDoc> = docs
            .iter()
            .map(|d| MsaInputDoc {
                id: d.id.clone(),
                name: d.name.clone(),
                sequence: d.sequence.clone(),
            })
            .collect();
        let msa = run_multiple_sequence_alignment(&msa_inputs, MAX_CONSENSUS_REALIGN_LEN);
        msa.rows.into_iter().map(|r| r.aligned_seq).collect()
    };
    let rows = &aligned_rows;
    let col_count = rows.first().map(|r| r.len()).unwrap_or(0);

    let mut consensus_bases = String::with_capacity(col_count);
    let mut identical_cols = 0usize;
    let mut total_pair_matches = 0usize;
    let mut total_pairs = 0usize;

    for col in 0..col_count {
        let mut counts: HashMap<char, usize> = HashMap::new();
        let mut non_gap_total = 0usize;
        let mut col_chars: Vec<char> = Vec::with_capacity(rows.len());

        for r in rows {
            let ch = r
                .as_bytes()
                .get(col)
                .map(|b| (*b as char).to_ascii_uppercase())
                .unwrap_or('-');
            col_chars.push(ch);
            if ch != '-' {
                *counts.entry(ch).or_insert(0) += 1;
                non_gap_total += 1;
            }
        }

        for i in 0..col_chars.len() {
            for j in (i + 1)..col_chars.len() {
                total_pairs += 1;
                if col_chars[i] == col_chars[j] && col_chars[i] != '-' {
                    total_pair_matches += 1;
                }
            }
        }

        if non_gap_total == 0 {
            continue;
        }

        let mut sorted_bases: Vec<(char, usize)> = counts.into_iter().collect();
        sorted_bases.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));

        if sorted_bases.len() == 1 && non_gap_total == rows.len() {
            identical_cols += 1;
        }

        let top_pct = (sorted_bases[0].1 as f64 / rows.len() as f64) * 100.0;
        if top_pct >= threshold_pct {
            consensus_bases.push(sorted_bases[0].0);
        } else {
            let mut acc_count = 0usize;
            let mut chosen: Vec<char> = Vec::new();
            for &(b, cnt) in &sorted_bases {
                if matches!(b, 'A' | 'C' | 'G' | 'T' | 'U') {
                    // RNA U shares T's ambiguity codes.
                    let base = if b == 'U' { 'T' } else { b };
                    if !chosen.contains(&base) {
                        chosen.push(base);
                    }
                    acc_count += cnt;
                    if (acc_count as f64 / rows.len() as f64) * 100.0 >= threshold_pct {
                        break;
                    }
                }
            }
            chosen.sort_unstable();
            let key: String = chosen.into_iter().collect();
            consensus_bases.push(iupac_ambiguity_code(&key).unwrap_or(sorted_bases[0].0));
        }
    }

    let pairwise_identity_pct = if total_pairs > 0 {
        (((total_pair_matches as f64 / total_pairs as f64) * 1000.0).round()) / 10.0
    } else {
        100.0
    };
    let identical_sites_pct = if col_count > 0 {
        (((identical_cols as f64 / col_count as f64) * 1000.0).round()) / 10.0
    } else {
        100.0
    };

    if consensus_bases.is_empty() {
        consensus_bases = clean_sequence(&docs[0].sequence);
    }
    let cons_len = consensus_bases.len();
    let raw_name = format!("Consensus_{}_{}seqs", docs[0].name, docs.len());
    let name: String = raw_name.chars().take(56).collect();
    let src_names: Vec<&str> = docs.iter().map(|d| d.name.as_str()).collect();

    Ok(SequenceDocument {
        id: format!("doc-cons-{}-{}", docs.len(), cons_len),
        name,
        accession: format!("MBC_CONS_{}", docs.len()),
        description: format!(
            "{}% threshold consensus across {} aligned sequences ({:.1}% pairwise identity, {:.1}% identical sites).",
            threshold_pct,
            docs.len(),
            pairwise_identity_pct,
            identical_sites_pct
        ),
        molecule_type: docs[0].molecule_type.clone(),
        topology: Topology::Linear,
        sequence: consensus_bases,
        features: vec![SequenceFeature {
            id: format!("feat-cons-core-{}", cons_len),
            name: format!(
                "Consensus ({} sequences, {:.1}% identity)",
                docs.len(),
                pairwise_identity_pct
            ),
            feature_type: "misc_feature".to_string(),
            start: 1,
            end: cons_len.max(1),
            strand: 1,
            color: "#0d9488".to_string(),
            notes: Some(format!(
                "Threshold: {}% | Identical sites: {:.1}% | Sources: {}",
                threshold_pct,
                identical_sites_pct,
                src_names.join(", ")
            )),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }],
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("hist-cons-{}", cons_len),
            timestamp: "2026-10-31 00:00".to_string(),
            operation: format!("Generate Consensus ({}% Threshold)", threshold_pct),
            description: format!(
                "Computed {} bp consensus from {} sequences ({:.1}% pairwise identity).",
                cons_len,
                docs.len(),
                pairwise_identity_pct
            ),
            parent_ids: docs.iter().map(|d| d.id.clone()).collect(),
            length_bp: cons_len,
            topology: Topology::Linear,
            history_color: None,
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: Some(DocumentAlignmentMeta {
            sequence_count: Some(docs.len()),
            pairwise_identity_pct: Some(pairwise_identity_pct),
            identical_sites_pct: Some(identical_sites_pct),
            mean_coverage_x: None,
            genetic_code_label: Some("Standard (1)".to_string()),
            tree_builder: Some("Neighbor-Joining".to_string()),
            is_aligned: Some(true),
            sequences: None,
        }),
        document_kind: None,
        doc_metadata: None,
        created_at: now.clone(),
        updated_at: now,
        folder: "Alignments".to_string(),
    })
}

/// Above this many masked runs, low-complexity masking masks the bases but adds
/// no annotations (reported via `masked_runs` / `annotations_omitted`).
pub const MAX_MASK_RUN_FEATURES: usize = 500;

/// Mask either the selected range or low-complexity homopolymer tracts (>=5 identical residues)
/// with `'N'` (nucleotide) or `'X'` (protein).
pub fn mask_sequence_regions(
    doc: &SequenceDocument,
    mode: &str,
    range: Option<SelectionRange1Based>,
) -> MaskSequenceResult {
    let mask_byte = if doc.molecule_type == MoleculeType::Protein {
        b'X'
    } else {
        b'N'
    };
    let mask_char = mask_byte as char;
    let mut bytes = doc.sequence.as_bytes().to_vec();
    let len = bytes.len();
    let mut masked_bases = 0usize;
    let mut mask_start = 1usize;
    let mut mask_end = 1usize;
    // Low-complexity mode: one annotation per masked run (a single aggregate
    // feature used to span the unmasked bases between the first and last run).
    let mut runs: Vec<(usize, usize)> = Vec::new();

    if mode == "selection" {
        if let Some(r) = range {
            if len > 0 {
                let s = r.start.clamp(1, len);
                let e = r.end.clamp(s, len);
                mask_start = s;
                mask_end = e;
                for b in &mut bytes[(s - 1)..e] {
                    *b = mask_byte;
                    masked_bases += 1;
                }
            }
        }
    } else {
        let mut i = 0usize;
        while i < len {
            let cur = bytes[i].to_ascii_uppercase();
            let mut j = i + 1;
            while j < len && bytes[j].to_ascii_uppercase() == cur {
                j += 1;
            }
            // Runs that are already masked, alignment gaps and non-letters are
            // not homopolymers: re-running used to re-count masked runs, and
            // '-----' gap runs were turned into 'NNNNN'.
            let maskable = cur.is_ascii_alphabetic() && cur != mask_byte;
            if j - i >= 5 && maskable {
                runs.push((i + 1, j));
                for b in &mut bytes[i..j] {
                    *b = mask_byte;
                    masked_bases += 1;
                }
            }
            i = j;
        }
    }

    let now = "2026-10-31T00:00:00.000Z".to_string();
    let mut updated = doc.clone();
    updated.sequence = String::from_utf8_lossy(&bytes).into_owned();
    // A multi-Mbp genome has ~3 such runs per kb; one annotation per run would
    // flood the document, and one feature spanning first..last run would claim
    // the unmasked bases between runs. Above the cap the bases are masked
    // without annotations; `masked_runs` / `annotations_omitted` report it.
    if masked_bases > 0 && mode != "selection" && runs.len() <= MAX_MASK_RUN_FEATURES {
        for &(rs, re) in &runs {
            let id = format!("feat-mask-{}-{}", rs, re);
            if updated.features.iter().any(|f| f.id == id) {
                continue;
            }
            updated.features.push(SequenceFeature {
                id,
                name: "Low-Complexity Mask".to_string(),
                feature_type: "misc_feature".to_string(),
                start: rs,
                end: re,
                strand: 1,
                color: "#94a3b8".to_string(),
                notes: Some(format!(
                    "Masked homopolymer run of {} residue(s) with '{}'",
                    re - rs + 1,
                    mask_char
                )),
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            });
        }
    }
    if masked_bases > 0 && mode == "selection" {
        updated.features.push(SequenceFeature {
            id: format!("feat-mask-{}-{}", mask_start, mask_end),
            name: if mode == "selection" {
                format!("Masked Region ({}..{})", mask_start, mask_end)
            } else {
                "Low-Complexity Mask".to_string()
            },
            feature_type: "misc_feature".to_string(),
            start: mask_start,
            end: mask_end,
            strand: 1,
            color: "#94a3b8".to_string(),
            notes: Some(format!(
                "Masked {} residue(s) with '{}' ({})",
                masked_bases, mask_char, mode
            )),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
    }
    updated.updated_at = now;
    updated.history.push(HistoryTreeNode {
        id: format!("hist-mask-{}", masked_bases),
        timestamp: "2026-10-31 00:00".to_string(),
        operation: format!("Mask Sequence ({})", mode),
        description: format!(
            "Masked {} base(s) with {} in {}.",
            masked_bases, mask_char, doc.name
        ),
        parent_ids: vec![doc.id.clone()],
        length_bp: len,
        topology: doc.topology.clone(),
        history_color: None,
        inserted_range: None,
    });

    MaskSequenceResult {
        updated,
        masked_bases,
        masked_runs: runs.len(),
        annotations_omitted: mode != "selection" && runs.len() > MAX_MASK_RUN_FEATURES,
    }
}

/// How many feature documents one extraction creates at most.
///
/// Every annotated feature of an ordinary record is extracted (BG-01M6S1Q9: the extraction used to
/// stop at 12, so a 50-feature record gave 12 documents and said nothing). A record annotated with
/// more features than this - a whole genome - has the rest left out, and the caller states how many
/// by comparing this many documents against the record's own feature count (`src/App.tsx` names it
/// in the Extract Annotations banner).
pub const MAX_EXTRACTED_FEATURE_DOCUMENTS: usize = 2_000;

/// Extract annotated features (supporting spliced multi-segment features) into standalone linear
/// `SequenceDocument`s: every feature the filter selects, up to
/// [`MAX_EXTRACTED_FEATURE_DOCUMENTS`], in the record's own feature order.
pub fn extract_annotated_features_to_documents(
    doc: &SequenceDocument,
    filter_type: &str,
) -> Vec<SequenceDocument> {
    let candidates: Vec<&SequenceFeature> = doc
        .features
        .iter()
        .filter(|f| {
            if filter_type == "CDS" {
                f.feature_type == "CDS"
            } else {
                true
            }
        })
        .collect();
    let targets: Vec<&SequenceFeature> = if candidates.is_empty() {
        doc.features.iter().collect()
    } else {
        candidates
    };
    let now = "2026-10-31T00:00:00.000Z".to_string();
    let seq_len = doc.sequence.len();

    targets
        .into_iter()
        .take(MAX_EXTRACTED_FEATURE_DOCUMENTS)
        .enumerate()
        .map(|(idx, feat)| {
            let mut raw_extracted = String::new();
            if let Some(segs) = &feat.segments {
                if !segs.is_empty() {
                    let mut ordered = segs.clone();
                    ordered.sort_by_key(|s| s.index);
                    for seg in &ordered {
                        let s = seg.start.saturating_sub(1).min(seq_len);
                        let e = seg.end.min(seq_len).max(s);
                        raw_extracted.push_str(&doc.sequence[s..e]);
                    }
                }
            }
            if raw_extracted.is_empty() {
                if doc.topology == Topology::Circular
                    && feat.start > feat.end
                    && feat.start <= seq_len
                    && feat.end >= 1
                {
                    // Feature spanning the origin of a circular molecule
                    // (start > end): start..len followed by 1..end. This used
                    // to collapse to an empty 0-bp document.
                    raw_extracted.push_str(&doc.sequence[feat.start - 1..]);
                    raw_extracted.push_str(&doc.sequence[..feat.end.min(seq_len)]);
                } else {
                    let s = feat.start.saturating_sub(1).min(seq_len);
                    let e = feat.end.min(seq_len).max(s);
                    raw_extracted.push_str(&doc.sequence[s..e]);
                }
            }

            let final_seq = if feat.strand == -1 && doc.molecule_type != MoleculeType::Protein {
                reverse_complement(&raw_extracted)
            } else {
                raw_extracted
            };
            let safe_feat_name: String = feat
                .name
                .chars()
                .map(|c| {
                    if c.is_ascii_alphanumeric() || matches!(c, '_' | '+' | '-') {
                        c
                    } else {
                        '_'
                    }
                })
                .collect();
            let raw_doc_name = format!("{}_{}", doc.name, safe_feat_name);
            let name: String = raw_doc_name.chars().take(56).collect();
            let final_len = final_seq.len();
            let mut history = doc.history.clone();
            history.push(HistoryTreeNode {
                id: format!("hist-extfeat-{}", idx),
                timestamp: "2026-10-31 00:00".to_string(),
                operation: format!("Extract Annotation ({})", feat.name),
                description: format!(
                    "Extracted {} bp {} annotation from {}.",
                    final_len, feat.feature_type, doc.name
                ),
                parent_ids: vec![doc.id.clone()],
                length_bp: final_len,
                topology: Topology::Linear,
                history_color: None,
                inserted_range: None,
            });

            SequenceDocument {
                id: format!("doc-extfeat-{}-{}", doc.id, idx),
                name,
                accession: format!("MBC_FEAT_{}", idx + 1),
                description: format!(
                    "Extracted {} \"{}\" ({}..{}, {} strand) from {}.",
                    feat.feature_type,
                    feat.name,
                    feat.start,
                    feat.end,
                    if feat.strand == 1 { "+" } else { "-" },
                    doc.name
                ),
                molecule_type: doc.molecule_type.clone(),
                topology: Topology::Linear,
                sequence: final_seq,
                features: vec![SequenceFeature {
                    id: format!("f-extracted-{}", idx),
                    name: feat.name.clone(),
                    feature_type: feat.feature_type.clone(),
                    start: 1,
                    end: final_len.max(1),
                    strand: 1,
                    color: feat.color.clone(),
                    notes: Some(feat.notes.clone().unwrap_or_else(|| {
                        format!("Extracted from {} ({}..{})", doc.name, feat.start, feat.end)
                    })),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                }],
                primers: Vec::new(),
                history,
                chromatogram: None,
                alignment_meta: None,
                document_kind: None,
                doc_metadata: None,
                created_at: now.clone(),
                updated_at: now.clone(),
                folder: "Cloning Inserts & PCR".to_string(),
            }
        })
        .collect()
}

/// Convert a selected subsequence (14..60 bp) into a `PrimerRecord` attached to the active `SequenceDocument`.
pub fn convert_selection_to_oligo_primer(
    doc: &SequenceDocument,
    range: Option<SelectionRange1Based>,
    strand: i8,
) -> ConvertOligoResult {
    let seq_len = doc.sequence.len();
    let raw_start = range
        .map(|r| r.start.clamp(1, seq_len.max(1)))
        .unwrap_or(1);
    let raw_end = range
        .map(|r| r.end.min(raw_start + 59).clamp(raw_start, seq_len.max(1)))
        .unwrap_or_else(|| seq_len.min(22));
    let adj_end = if raw_end.saturating_sub(raw_start) + 1 < 14 {
        seq_len.min(raw_start + 19)
    } else {
        raw_end
    };

    let sub = if seq_len == 0 {
        "GTAAAACGACGGCCAGT".to_string()
    } else {
        doc.sequence[(raw_start - 1)..adj_end].to_ascii_uppercase()
    };
    let oligo_seq = if strand == -1 {
        reverse_complement(&sub)
    } else {
        sub
    };
    let metrics = calculate_primer_metrics(&oligo_seq, 50.0, 1.5, 250.0);
    let round1 = |v: f64| (v * 10.0).round() / 10.0;

    let primer = PrimerRecord {
        id: format!("prm-oligo-{}-{}", raw_start, adj_end),
        name: format!(
            "Oligo_{}_{}_{}",
            raw_start,
            adj_end,
            if strand == 1 { "Fwd" } else { "Rev" }
        ),
        sequence: oligo_seq.clone(),
        anneal_sequence: oligo_seq.clone(),
        tail5_prime: String::new(),
        bind_start: raw_start,
        bind_end: adj_end,
        strand: if strand == -1 { -1 } else { 1 },
        length: oligo_seq.len(),
        gc_percent: round1(metrics.gc_percent),
        tm_anneal_c: round1(metrics.tm_c),
        tm_full_c: round1(metrics.tm_c),
        delta_g37: round1(metrics.delta_g37),
        hairpin_delta_g: round1(metrics.hairpin_delta_g),
        self_dimer_delta_g: round1(metrics.self_dimer_delta_g),
        gc_clamp3_prime: metrics.gc_clamp3_prime,
        notes: Some(format!(
            "Converted from {} ({}..{})",
            doc.name, raw_start, adj_end
        )),
        // An oligo holding N has no Tm; the record says why beside its number (BG-01M6SHQ0).
        tm_no_answer_reason: metrics.tm_no_answer_reason,
    };

    let mut updated_doc = doc.clone();
    updated_doc.primers.push(primer.clone());
    updated_doc.updated_at = "2026-10-31T00:00:00.000Z".to_string();

    ConvertOligoResult {
        updated_doc,
        primer,
    }
}

/// Scan a `SequenceDocument` for Gateway `attB` / `attP` / `attL` / `attR` recombination sites and annotate matches.
pub fn annotate_gateway_att_sites(doc: &SequenceDocument) -> AnnotateAttResult {
    let gateway_att_motifs = [
        ("attB1", "ACAAGTTTGTACAAAAAAGCAGGCT", "#7c3aed"),
        ("attB2", "ACCCAGCTTTCTTGTACAAAGTGGT", "#7c3aed"),
        (
            "attL1_core",
            "CAAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCAGGCT",
            "#8b5cf6",
        ),
        (
            "attR1_core",
            "ACAAGTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATG",
            "#6366f1",
        ),
        ("att_15bp_core", "GTTTGTACAAAAAAG", "#a855f7"),
    ];

    let upper = doc.sequence.to_ascii_uppercase();
    let mut added: Vec<SequenceFeature> = Vec::new();

    for (name, motif, color) in &gateway_att_motifs {
        if let Some(fwd_idx) = upper.find(motif) {
            let start = fwd_idx + 1;
            let end = fwd_idx + motif.len();
            let dup = doc.features.iter().any(|f| {
                f.start.abs_diff(start) < 5 && f.name.to_ascii_lowercase().contains("att")
            });
            if !dup {
                added.push(SequenceFeature {
                    id: format!("feat-att-fwd-{}-{}", name, start),
                    name: (*name).to_string(),
                    feature_type: "misc_feature".to_string(),
                    start,
                    end,
                    strand: 1,
                    color: (*color).to_string(),
                    notes: Some(format!("Gateway recombination site ({} bp)", motif.len())),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                });
            }
        }

        let rc_motif = reverse_complement(motif);
        if let Some(rev_idx) = upper.find(&rc_motif) {
            let start = rev_idx + 1;
            let end = rev_idx + rc_motif.len();
            let dup = doc.features.iter().chain(added.iter()).any(|f| {
                f.start.abs_diff(start) < 5 && f.name.to_ascii_lowercase().contains("att")
            });
            if !dup {
                added.push(SequenceFeature {
                    id: format!("feat-att-rev-{}-{}", name, start),
                    name: format!("{} (rev)", name),
                    feature_type: "misc_feature".to_string(),
                    start,
                    end,
                    strand: -1,
                    color: (*color).to_string(),
                    notes: Some(format!(
                        "Gateway recombination site ({} bp, reverse strand)",
                        rc_motif.len()
                    )),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                });
            }
        }
    }

    let added_count = added.len();
    let mut updated_doc = doc.clone();
    if added_count > 0 {
        updated_doc.features.extend(added);
        updated_doc.updated_at = "2026-10-31T00:00:00.000Z".to_string();
    }

    AnnotateAttResult {
        updated_doc,
        added_count,
    }
}

/// Flank a selected region (or full linear sequence) with Gateway `attB1` and `attB2` sites.
pub fn add_attb_sites_to_sequence(
    doc: &SequenceDocument,
    range: Option<SelectionRange1Based>,
) -> SequenceDocument {
    let att_b1 = "GGGGACAAGTTTGTACAAAAAAGCAGGCTAA";
    let att_b2 = "TTACCCAGCTTTCTTGTACAAAGTGGTCCCC";
    let seq_len = doc.sequence.len();
    let s = range.map(|r| r.start.max(1)).unwrap_or(1).min(seq_len.max(1));
    let e = range
        .map(|r| r.end.min(seq_len))
        .unwrap_or(seq_len)
        .max(s);
    let core_insert = if seq_len == 0 {
        String::new()
    } else {
        doc.sequence[(s - 1)..e].to_ascii_uppercase()
    };
    let full_seq = format!("{}{}{}", att_b1, core_insert, att_b2);
    let full_len = full_seq.len();
    let now = "2026-10-31T00:00:00.000Z".to_string();
    let raw_name = format!("{}_attB1_attB2_Amplicon", doc.name);
    let name: String = raw_name.chars().take(56).collect();

    let mut history = doc.history.clone();
    history.push(HistoryTreeNode {
        id: format!("hist-attb-{}", full_len),
        timestamp: "2026-10-31 00:00".to_string(),
        operation: "Add Gateway attB1 / attB2 Sites".to_string(),
        description: format!(
            "Flanked {} bp region of {} with attB1 & attB2 adapters ({} bp).",
            core_insert.len(),
            doc.name,
            full_len
        ),
        parent_ids: vec![doc.id.clone()],
        length_bp: full_len,
        topology: Topology::Linear,
        history_color: None,
        inserted_range: None,
    });

    SequenceDocument {
        id: format!("doc-attb-{}-{}", doc.id, full_len),
        name,
        accession: format!("MBC_ATTB_{}", core_insert.len()),
        description: format!(
            "Gateway BP-ready PCR amplicon: attB1 + {} ({}..{}) + attB2 ({} bp).",
            doc.name, s, e, full_len
        ),
        molecule_type: MoleculeType::DNA,
        topology: Topology::Linear,
        sequence: full_seq,
        features: vec![
            SequenceFeature {
                id: "f-attb1-left".to_string(),
                name: "attB1".to_string(),
                feature_type: "misc_feature".to_string(),
                start: 1,
                end: att_b1.len(),
                strand: 1,
                color: "#7c3aed".to_string(),
                notes: Some(
                    "5' Gateway attB1 recombination site (with 4-G booster + in-frame AA)"
                        .to_string(),
                ),
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            },
            SequenceFeature {
                id: "f-attb-insert".to_string(),
                name: format!("{}_Insert", doc.name),
                feature_type: "CDS".to_string(),
                start: att_b1.len() + 1,
                end: att_b1.len() + core_insert.len(),
                strand: 1,
                color: "#10b981".to_string(),
                notes: Some(format!("Amplified from {} ({}..{})", doc.name, s, e)),
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            },
            SequenceFeature {
                id: "f-attb2-right".to_string(),
                name: "attB2".to_string(),
                feature_type: "misc_feature".to_string(),
                start: att_b1.len() + core_insert.len() + 1,
                end: full_len,
                strand: -1,
                color: "#7c3aed".to_string(),
                notes: Some("3' Gateway attB2 recombination site".to_string()),
                qualifiers: None,
                segments: None,
                cleavage_site: None,
            },
        ],
        primers: Vec::new(),
        history,
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: now.clone(),
        updated_at: now,
        folder: "Cloning Inserts & PCR".to_string(),
    }
}

/// Export a multi-record GenBank bundle containing `target_doc` plus all ancestor and descendant
/// documents linked via `history[].parent_ids`.
pub fn export_lineage_bundle_genbank(
    target_doc: &SequenceDocument,
    all_docs: &[SequenceDocument],
) -> LineageBundleGenBankResult {
    let by_id: HashMap<&str, &SequenceDocument> =
        all_docs.iter().map(|d| (d.id.as_str(), d)).collect();
    let mut included_ids: HashSet<String> = HashSet::new();
    included_ids.insert(target_doc.id.clone());

    let mut changed = true;
    while changed {
        changed = false;
        let snapshot: Vec<String> = included_ids.iter().cloned().collect();
        for id in snapshot {
            if let Some(d) = by_id.get(id.as_str()) {
                for h in &d.history {
                    for pid in &h.parent_ids {
                        if by_id.contains_key(pid.as_str()) && included_ids.insert(pid.clone()) {
                            changed = true;
                        }
                    }
                }
            }
        }
    }

    changed = true;
    while changed {
        changed = false;
        for candidate in all_docs {
            if included_ids.contains(&candidate.id) {
                continue;
            }
            let has_linked_parent = candidate
                .history
                .iter()
                .any(|h| h.parent_ids.iter().any(|pid| included_ids.contains(pid)));
            if has_linked_parent && included_ids.insert(candidate.id.clone()) {
                changed = true;
            }
        }
    }

    let ordered_docs: Vec<&SequenceDocument> = all_docs
        .iter()
        .filter(|d| included_ids.contains(&d.id))
        .collect();
    let final_docs: Vec<&SequenceDocument> = if ordered_docs.is_empty() {
        vec![target_doc]
    } else {
        ordered_docs
    };

    let content = final_docs
        .iter()
        .map(|d| export_genbank_flatfile(d))
        .collect::<Vec<_>>()
        .join("\n\n");
    let included_names = final_docs.iter().map(|d| d.name.clone()).collect();

    LineageBundleGenBankResult {
        content,
        included_names,
    }
}

/// Batch Workflow: Modify Annotation Intervals by extending/trimming 5' and 3' feature boundaries.
pub fn batch_modify_annotation_intervals(
    doc: &SequenceDocument,
    delta_start_bp: isize,
    delta_end_bp: isize,
) -> SequenceDocument {
    let max_len = doc.sequence.len().max(1) as isize;
    let updated_features = doc
        .features
        .iter()
        .map(|f| {
            let next_start = (f.start as isize + delta_start_bp).clamp(1, max_len) as usize;
            let next_end =
                (f.end as isize + delta_end_bp).clamp(next_start as isize, max_len) as usize;
            let mut nf = f.clone();
            nf.start = next_start;
            nf.end = next_end;
            nf
        })
        .collect();

    let mut out = doc.clone();
    out.features = updated_features;
    out.updated_at = "2026-10-31T00:00:00.000Z".to_string();
    out
}

/// Batch Workflow: Set CDS Translation Property on all CDS features in a document.
pub fn batch_set_cds_translation_property(doc: &SequenceDocument) -> SequenceDocument {
    if doc.molecule_type == MoleculeType::Protein {
        return doc.clone();
    }
    let seq_len = doc.sequence.len();
    let updated_features = doc
        .features
        .iter()
        .map(|f| {
            if f.feature_type != "CDS" {
                return f.clone();
            }
            let s = f.start.saturating_sub(1).min(seq_len);
            let e = f.end.min(seq_len).max(s);
            let raw_sub = &doc.sequence[s..e];
            let coding_dna = if f.strand == -1 {
                reverse_complement(raw_sub)
            } else {
                raw_sub.to_string()
            };
            let aa_raw = translate_sequence(&coding_dna, 0, 11);
            let aa = aa_raw.strip_suffix('*').unwrap_or(&aa_raw).to_string();

            let mut nf = f.clone();
            let mut quals = nf.qualifiers.unwrap_or_default();
            quals.insert("codon_start".to_string(), "1".to_string());
            quals.insert("transl_table".to_string(), "11".to_string());
            quals.insert("translation".to_string(), aa.clone());
            nf.qualifiers = Some(quals);
            nf.notes = Some(match &nf.notes {
                Some(n) if n.contains("aa translation") => n.clone(),
                Some(n) => format!("{} [{} aa translation annotated]", n, aa.len()),
                None => format!("{} aa translation annotated", aa.len()),
            });
            nf
        })
        .collect();

    let mut out = doc.clone();
    out.features = updated_features;
    out.updated_at = "2026-10-31T00:00:00.000Z".to_string();
    out
}

/// Batch Workflow: Deterministic Fisher-Yates random subsample of `sample_size` documents.
pub fn randomly_sample_documents(
    docs: &[SequenceDocument],
    sample_size: usize,
    seed: u32,
) -> Vec<SequenceDocument> {
    if sample_size >= docs.len() || docs.is_empty() {
        return docs.to_vec();
    }
    let mut copy = docs.to_vec();
    let mut s = seed;
    let mut next_rand = || -> f64 {
        s = s.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        (s as f64) / 4_294_967_296.0
    };
    for i in (1..copy.len()).rev() {
        let j = (next_rand() * ((i + 1) as f64)).floor() as usize;
        copy.swap(i, j.min(i));
    }
    copy.truncate(sample_size.max(1));
    copy
}

/// Batch Workflow: Group sequences into folders based on leading name prefix (before `'_'` or `'-'`).
pub fn group_documents_by_prefix(docs: &[SequenceDocument]) -> GroupByPrefixResult {
    let extract_prefix = |name: &str| -> String {
        let token = name
            .split(&['_', '-'][..])
            .next()
            .map(str::trim)
            .unwrap_or("Grouped");
        if token.chars().count() >= 2 {
            token.to_string()
        } else {
            "Grouped".to_string()
        }
    };

    let mut prefix_counts: HashMap<String, usize> = HashMap::new();
    for d in docs {
        let p = extract_prefix(&d.name);
        *prefix_counts.entry(p).or_insert(0) += 1;
    }

    let mut groups_created: Vec<String> = Vec::new();
    let mut seen_groups: HashSet<String> = HashSet::new();
    let updated_docs: Vec<SequenceDocument> = docs
        .iter()
        .map(|d| {
            let p = extract_prefix(&d.name);
            let mut nd = d.clone();
            if prefix_counts.get(&p).copied().unwrap_or(0) >= 2 {
                let folder_name = format!("Group_{}", p);
                if seen_groups.insert(folder_name.clone()) {
                    groups_created.push(folder_name.clone());
                }
                nd.folder = folder_name;
            }
            nd
        })
        .collect();

    GroupByPrefixResult {
        updated_docs,
        groups_created,
    }
}
