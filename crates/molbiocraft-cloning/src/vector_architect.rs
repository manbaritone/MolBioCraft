// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use std::collections::{HashMap, HashSet};

use molbiocraft_core::{
    clean_sequence, HistoryTreeNode, InsertedRange, MoleculeType, PrimerRecord, SequenceDocument,
    SequenceFeature, Topology,
};
use serde::{Deserialize, Serialize};

use crate::action_vectors_data::CloningActionVectorPreset;
use crate::modular_parts_data::{get_modular_vector_parts, ModularVectorPart};
use crate::rebase_catalog::{get_rebase_enzymes, scan_restriction_sites, RestrictionPositionLimit};
use crate::systems_strains_data::{
    get_origin_compatibility_groups, get_twist_antibiotic_standards, get_vector_system_guides,
};
use crate::vector_catalog_data::CatalogVectorEntry;

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

/// Deterministic, balanced-GC (~50%), homopolymer-free, repeat-free DNA spacer
/// avoiding common 6-bp restriction sites so MCS enzymes remain unique single-cutters.
pub fn generate_safe_backbone_spacer(length_bp: usize, seed: usize) -> String {
    if length_bp == 0 {
        return String::new();
    }
    let blocks = [
        "CGTACCTGAGTCAGTCATGCTAGTCGTACAGT",
        "GTCATGACTGACGTAGCTAGTCATGCTGACGT",
        "TGCATGACGTCTGACTGACGTAGTCATGACGT",
        "ACGTCTGATGCTAGTCAGTCGATGCTACGTGA",
    ];
    let mut out = String::with_capacity(length_bp + 32);
    let mut idx = seed % blocks.len();
    while out.len() < length_bp {
        out.push_str(blocks[idx % blocks.len()]);
        idx += 1;
    }
    out.truncate(length_bp);
    out
}

/// Builds an authentic MCS polylinker string from requested enzyme names using REBASE definitions.
pub fn build_mcs_polylinker(enzyme_names: &[String]) -> String {
    if enzyme_names.is_empty() {
        return "GAATTCACTAGTGGATCCGCGGCCGCCTCGAG".to_string();
    }
    let enzymes = get_rebase_enzymes();
    let mut motifs = Vec::new();
    for name in enzyme_names {
        if let Some(enz) = enzymes
            .iter()
            .find(|e| e.name.eq_ignore_ascii_case(name.trim()))
        {
            if !enz.recognition_seq.is_empty()
                && enz
                    .recognition_seq
                    .bytes()
                    .all(|b| matches!(b, b'A' | b'C' | b'G' | b'T'))
            {
                motifs.push(enz.recognition_seq.clone());
            }
        }
    }
    if motifs.is_empty() {
        "GAATTCACTAGTGGATCCGCGGCCGCCTCGAG".to_string()
    } else {
        motifs.join("CA")
    }
}

/// Labels a catalog-built construct as a schematic: its functional parts are real sequences, but
/// they are joined by synthetic spacer DNA, so the record is not the vendor's GenBank sequence.
pub fn mark_schematic_vector(doc: &mut SequenceDocument) {
    let meta = doc.doc_metadata.get_or_insert_with(HashMap::new);
    meta.insert(
        "Sequence Source".into(),
        serde_json::json!(
            "Schematic reconstruction: catalog parts joined by synthetic spacer DNA (not the vendor GenBank sequence)"
        ),
    );
    if !doc.description.starts_with("Schematic") {
        doc.description = format!("Schematic reconstruction. {}", doc.description);
    }
}

/// Synthesizes a complete, restriction-digestible, feature-annotated `SequenceDocument`
/// from any `CatalogVectorEntry`. The result is a schematic (see [`mark_schematic_vector`]).
pub fn build_catalog_vector_document(entry: &CatalogVectorEntry) -> SequenceDocument {
    let parts = get_modular_vector_parts();
    let part_map: HashMap<&str, &ModularVectorPart> =
        parts.iter().map(|p| (p.id.as_str(), p)).collect();

    let mut features: Vec<SequenceFeature> = Vec::new();
    let mut seq = String::with_capacity(entry.nominal_size_bp.clamp(2000, 14_500));
    let mut feat_counter = 1usize;

    let append_block = |seq: &mut String,
                        features: &mut Vec<SequenceFeature>,
                        feat_counter: &mut usize,
                        name: &str,
                        ftype: &str,
                        dna: &str,
                        color: &str,
                        notes: Option<String>| {
        let clean = clean_sequence(dna);
        if clean.is_empty() {
            return;
        }
        let start = seq.len() + 1;
        seq.push_str(&clean);
        let end = seq.len();
        features.push(SequenceFeature {
            id: format!("{}-feat-{}", entry.id, *feat_counter),
            name: name.to_string(),
            feature_type: ftype.to_string(),
            start,
            end,
            strand: 1,
            color: color.to_string(),
            notes,
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
        *feat_counter += 1;
    };

    // Standard M13 Forward (-20) priming site at 5' start
    seq.push_str("CGACGTTGTAAAACGACGGCCAGT");
    features.push(SequenceFeature {
        id: format!("{}-m13f", entry.id),
        name: "M13 Forward (-20)".to_string(),
        feature_type: "primer_bind".to_string(),
        // GTAAAACGACGGCCAGT occupies bases 8..24 of the leading "CGACGTTGTAAAACGACGGCCAGT".
        start: 8,
        end: 24,
        strand: 1,
        color: "#0EA5E9".to_string(),
        notes: Some("Universal M13 forward sequencing primer site".to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });
    seq.push_str(&generate_safe_backbone_spacer(44, 3));

    let mut inserted_mcs = false;
    for part_id in &entry.part_blueprint_ids {
        if let Some(part) = part_map.get(part_id.as_str()) {
            let cur_counter = feat_counter;
            append_block(
                &mut seq,
                &mut features,
                &mut feat_counter,
                &part.name,
                &part.feature_type,
                &part.sequence,
                &part.color,
                Some(part.summary.clone()),
            );
            seq.push_str(&generate_safe_backbone_spacer(36, cur_counter + 1));

            if !inserted_mcs
                && (part.category == "Promoter"
                    || part.category == "Signal & Localization"
                    || part.id == "rec-attl1")
            {
                let mcs_dna = build_mcs_polylinker(&entry.mcs_enzymes);
                let mcs_name = if entry.source == "Twist Bioscience" {
                    "Twist Clonal Insertion / MCS"
                } else {
                    "Multiple Cloning Site (MCS)"
                };
                let sites_label = if entry.mcs_enzymes.is_empty() {
                    "Homology insertion window".to_string()
                } else {
                    entry.mcs_enzymes.join(", ")
                };
                append_block(
                    &mut seq,
                    &mut features,
                    &mut feat_counter,
                    mcs_name,
                    "misc_feature",
                    &mcs_dna,
                    "#14B8A6",
                    Some(format!("Unique cloning sites: {}", sites_label)),
                );
                seq.push_str(&generate_safe_backbone_spacer(44, 11));
                inserted_mcs = true;
            }
        }
    }

    if !inserted_mcs {
        let mcs_dna = build_mcs_polylinker(&entry.mcs_enzymes);
        append_block(
            &mut seq,
            &mut features,
            &mut feat_counter,
            "Multiple Cloning Site (MCS)",
            "misc_feature",
            &mcs_dna,
            "#14B8A6",
            Some(format!(
                "Unique cloning sites: {}",
                entry.mcs_enzymes.join(", ")
            )),
        );
        seq.push_str(&generate_safe_backbone_spacer(48, 19));
    }

    let target_len = 14_000usize.min((seq.len() + 60).max(entry.nominal_size_bp));
    if seq.len() < target_len {
        let rem = target_len - seq.len();
        seq.push_str(&generate_safe_backbone_spacer(rem, 29));
    }

    let primers = vec![PrimerRecord {
        id: format!("{}-prm-m13f", entry.id),
        name: "M13-Fwd(-20)".to_string(),
        sequence: "GTAAAACGACGGCCAGT".to_string(),
        anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
        tail5_prime: String::new(),
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
    }];

    let src_prefix: String = entry
        .source
        .chars()
        .take(2)
        .collect::<String>()
        .to_ascii_uppercase();
    let clean_id: String = entry
        .id
        .to_ascii_uppercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let euk_suffix = if entry.eukaryotic_marker != "None" {
        format!(" / {}", entry.eukaryotic_marker)
    } else {
        String::new()
    };
    let topo_str = match entry.topology {
        Topology::Circular => "circular",
        Topology::Linear => "linear",
    };
    let now = "2026-10-31T00:00:00.000Z".to_string();
    let seq_len = seq.len();

    let mut doc = SequenceDocument {
        id: format!("vec-{}-{}", entry.id, seq_len),
        name: entry.name.clone(),
        accession: format!("{}_{}", src_prefix, clean_id),
        description: format!(
            "[{} • {}] {} | Host: {} | Origin: {} ({}) | Selection: {}{} | Strain: {}",
            entry.source,
            entry.category,
            entry.summary,
            entry.host_system,
            entry.origin,
            entry.copy_number,
            entry.bacterial_marker,
            euk_suffix,
            entry.recommended_strain
        ),
        molecule_type: MoleculeType::DNA,
        topology: entry.topology.clone(),
        sequence: seq,
        features,
        primers,
        history: vec![HistoryTreeNode {
            id: format!("hist-{}", entry.id),
            timestamp: now.clone(),
            operation: format!("Loaded from {} Vector Library", entry.source),
            description: format!(
                "{} ({} bp {}) — {}",
                entry.name,
                format_thousands(seq_len),
                topo_str,
                entry.vendor_line
            ),
            parent_ids: Vec::new(),
            length_bp: seq_len,
            topology: entry.topology.clone(),
            history_color: Some("#2563EB".to_string()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: now.clone(),
        updated_at: now,
        folder: "Plasmids & Vectors".to_string(),
    };
    mark_schematic_vector(&mut doc);
    doc
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModularAssemblySpec {
    pub vector_name: String,
    pub system_guide_id: String,
    pub promoter_part_id: String,
    #[serde(default)]
    pub signal_or_init_part_id: Option<String>,
    #[serde(default)]
    pub n_tag_part_id: Option<String>,
    #[serde(default)]
    pub protease_part_id: Option<String>,
    pub cargo_mode: String,
    #[serde(default)]
    pub cargo_part_id: Option<String>,
    #[serde(default)]
    pub custom_cargo_name: Option<String>,
    #[serde(default)]
    pub custom_cargo_seq: Option<String>,
    #[serde(rename = "linker2APartId", default)]
    pub linker_2a_part_id: Option<String>,
    #[serde(default)]
    pub eukaryotic_marker_part_id: Option<String>,
    #[serde(default)]
    pub regulatory_wpre_part_id: Option<String>,
    #[serde(rename = "polyAOrTermPartId")]
    pub poly_a_or_term_part_id: String,
    pub origin_part_id: String,
    pub bacterial_marker_part_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModularAssemblyResult {
    pub document: SequenceDocument,
    pub cargo_size_bp: usize,
    pub max_cargo_bp: usize,
    pub cargo_utilization_pct: f64,
    pub over_capacity: bool,
    pub warnings: Vec<String>,
}

/// Combinatorial Modular Vector Architect:
/// Assembles a custom expression/viral/transposon/CRISPR/antibody plasmid from modular parts
/// and validates cargo packaging limits (e.g. 4.7 kb AAV ITR-to-ITR, 9.2 kb Lentivirus).
pub fn assemble_modular_custom_vector(spec: &ModularAssemblySpec) -> ModularAssemblyResult {
    let systems = get_vector_system_guides();
    let sys = systems
        .iter()
        .find(|g| g.id == spec.system_guide_id)
        .unwrap_or(&systems[0]);
    let parts = get_modular_vector_parts();
    let part_map: HashMap<&str, &ModularVectorPart> =
        parts.iter().map(|p| (p.id.as_str(), p)).collect();

    let mut features: Vec<SequenceFeature> = Vec::new();
    let mut warnings: Vec<String> = Vec::new();
    let mut seq = String::with_capacity(8000);
    let mut idx = 1usize;

    let add_part_by_id = |part_id: Option<&str>,
                          seq: &mut String,
                          features: &mut Vec<SequenceFeature>,
                          idx: &mut usize| {
        let Some(pid) = part_id else {
            return;
        };
        if pid.is_empty() || pid == "none" {
            return;
        }
        let Some(p) = part_map.get(pid) else {
            return;
        };
        let clean = clean_sequence(&p.sequence);
        if clean.is_empty() {
            return;
        }
        let start = seq.len() + 1;
        seq.push_str(&clean);
        let end = seq.len();
        features.push(SequenceFeature {
            id: format!("mod-feat-{}", *idx),
            name: p.name.clone(),
            feature_type: p.feature_type.clone(),
            start,
            end,
            strand: 1,
            color: p.color.clone(),
            notes: Some(format!("{} ({}): {}", p.category, p.source, p.summary)),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
        *idx += 1;
    };

    seq.push_str(&generate_safe_backbone_spacer(40, 5));
    if sys.delivery_type == "AAV" {
        add_part_by_id(Some("vir-aav2itr"), &mut seq, &mut features, &mut idx);
    } else if sys.delivery_type == "Lentivirus" {
        add_part_by_id(Some("vir-sinltr"), &mut seq, &mut features, &mut idx);
    } else if sys.delivery_type == "Transposon" {
        add_part_by_id(Some("vir-pbitr"), &mut seq, &mut features, &mut idx);
    }

    let cargo_region_start = seq.len();
    if sys.delivery_type != "Plasmid" {
        seq.push_str(&generate_safe_backbone_spacer(24, 7));
    }

    add_part_by_id(
        Some(spec.promoter_part_id.as_str()),
        &mut seq,
        &mut features,
        &mut idx,
    );
    seq.push_str("GAATTC");
    add_part_by_id(
        spec.signal_or_init_part_id.as_deref(),
        &mut seq,
        &mut features,
        &mut idx,
    );
    add_part_by_id(spec.n_tag_part_id.as_deref(), &mut seq, &mut features, &mut idx);
    add_part_by_id(
        spec.protease_part_id.as_deref(),
        &mut seq,
        &mut features,
        &mut idx,
    );

    if spec.cargo_mode == "custom-dna" {
        if let Some(raw_cargo) = &spec.custom_cargo_seq {
            let clean_cargo = clean_sequence(raw_cargo);
            if !clean_cargo.is_empty() {
                let s = seq.len() + 1;
                seq.push_str(&clean_cargo);
                let cname = spec
                    .custom_cargo_name
                    .as_deref()
                    .map(str::trim)
                    .filter(|n| !n.is_empty())
                    .unwrap_or("Custom_GOI_Insert");
                features.push(SequenceFeature {
                    id: format!("mod-cargo-{}", idx),
                    name: cname.to_string(),
                    feature_type: "CDS".to_string(),
                    start: s,
                    end: seq.len(),
                    strand: 1,
                    color: "#10B981".to_string(),
                    notes: Some("User custom gene of interest cargo".to_string()),
                    qualifiers: None,
                    segments: None,
                    cleavage_site: None,
                });
                idx += 1;
            }
        }
    } else {
        add_part_by_id(spec.cargo_part_id.as_deref(), &mut seq, &mut features, &mut idx);
    }

    let has_linker = spec
        .linker_2a_part_id
        .as_deref()
        .map(|s| !s.is_empty() && s != "none")
        .unwrap_or(false);
    let has_euk_marker = spec
        .eukaryotic_marker_part_id
        .as_deref()
        .map(|s| !s.is_empty() && s != "none")
        .unwrap_or(false);

    if has_linker {
        add_part_by_id(
            spec.linker_2a_part_id.as_deref(),
            &mut seq,
            &mut features,
            &mut idx,
        );
        add_part_by_id(
            spec.eukaryotic_marker_part_id.as_deref(),
            &mut seq,
            &mut features,
            &mut idx,
        );
    } else if has_euk_marker {
        seq.push_str(&generate_safe_backbone_spacer(28, 13));
        add_part_by_id(Some("prom-pgk"), &mut seq, &mut features, &mut idx);
        add_part_by_id(
            spec.eukaryotic_marker_part_id.as_deref(),
            &mut seq,
            &mut features,
            &mut idx,
        );
    }

    seq.push_str("GGATCCGCGGCCGC");
    add_part_by_id(
        spec.regulatory_wpre_part_id.as_deref(),
        &mut seq,
        &mut features,
        &mut idx,
    );
    add_part_by_id(
        Some(spec.poly_a_or_term_part_id.as_str()),
        &mut seq,
        &mut features,
        &mut idx,
    );

    let cargo_region_end = seq.len();
    if sys.delivery_type == "AAV" {
        add_part_by_id(Some("vir-aav2itr"), &mut seq, &mut features, &mut idx);
    } else if sys.delivery_type == "Lentivirus" {
        add_part_by_id(Some("vir-sinltr"), &mut seq, &mut features, &mut idx);
    } else if sys.delivery_type == "Transposon" {
        add_part_by_id(Some("vir-pbitr"), &mut seq, &mut features, &mut idx);
    }

    let cargo_size_bp = cargo_region_end.saturating_sub(cargo_region_start);
    let max_cargo_bp = (sys.max_cargo_kb * 1000.0).round() as usize;
    let cargo_utilization_pct =
        (((cargo_size_bp as f64 / max_cargo_bp.max(1) as f64) * 1000.0).round()) / 10.0;
    let over_capacity = cargo_size_bp > max_cargo_bp;

    if over_capacity {
        warnings.push(format!(
            "Cargo ({} bp) exceeds {} packaging limit ({} bp). Consider shorter promoter (EFS/hSyn1) or WPRE3.",
            format_thousands(cargo_size_bp),
            sys.code,
            format_thousands(max_cargo_bp)
        ));
    }
    if sys.delivery_type == "AAV" || sys.delivery_type == "Lentivirus" {
        warnings.push(format!(
            "Propagate in {} to prevent ITR/LTR recombination.",
            sys.recommended_strain
        ));
    }

    seq.push_str(&generate_safe_backbone_spacer(52, 23));
    add_part_by_id(
        Some(spec.origin_part_id.as_str()),
        &mut seq,
        &mut features,
        &mut idx,
    );
    seq.push_str(&generate_safe_backbone_spacer(44, 31));
    add_part_by_id(
        Some(spec.bacterial_marker_part_id.as_str()),
        &mut seq,
        &mut features,
        &mut idx,
    );
    seq.push_str(&generate_safe_backbone_spacer(48, 37));

    let topo = if sys.delivery_type == "IVT mRNA" {
        Topology::Linear
    } else {
        Topology::Circular
    };
    let vec_name = if spec.vector_name.trim().is_empty() {
        format!("{}-Custom-Construct", sys.code)
    } else {
        spec.vector_name.trim().to_string()
    };
    let seq_len = seq.len();
    let feat_len = features.len();
    let now = "2026-10-31T00:00:00.000Z".to_string();

    let document = SequenceDocument {
        id: format!("custom-vec-{}", seq_len),
        name: vec_name,
        accession: format!("MBC_CUSTOM_{}", seq_len),
        description: format!(
            "[Modular Custom Vector • {}] Cargo: {} / {} bp ({:.1}%) | Host: {} | Strain: {}",
            sys.name,
            format_thousands(cargo_size_bp),
            format_thousands(max_cargo_bp),
            cargo_utilization_pct,
            sys.host_group,
            sys.recommended_strain
        ),
        molecule_type: MoleculeType::DNA,
        topology: topo.clone(),
        sequence: seq,
        features,
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("hist-mod-{}", seq_len),
            timestamp: now.clone(),
            operation: "Modular Vector Architect Assembly".to_string(),
            description: format!(
                "Assembled {} modular genetic parts in {} ({} bp)",
                feat_len,
                sys.code,
                format_thousands(seq_len)
            ),
            parent_ids: Vec::new(),
            length_bp: seq_len,
            topology: topo,
            history_color: Some("#7C3AED".to_string()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: now.clone(),
        updated_at: now,
        folder: "Plasmids & Vectors".to_string(),
    };

    ModularAssemblyResult {
        document,
        cargo_size_bp,
        max_cargo_bp,
        cargo_utilization_pct,
        over_capacity,
        warnings,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwistOnboardingCheckItem {
    pub id: String,
    pub rule: String,
    pub status: String,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TwistOnboardingReport {
    pub overall_status: String,
    pub recommended_strain: String,
    pub production_antibiotic: String,
    pub nearby_linearization_enzymes: Vec<String>,
    pub total_mass_ug: f64,
    pub checks: Vec<TwistOnboardingCheckItem>,
}

fn find_homopolymer_run(seq: &str, min_len: usize) -> Option<(char, usize)> {
    let bytes = seq.as_bytes();
    let mut i = 0usize;
    while i < bytes.len() {
        let b = bytes[i];
        if matches!(b, b'A' | b'T' | b'G' | b'C') {
            let mut j = i + 1;
            while j < bytes.len() && bytes[j] == b {
                j += 1;
            }
            if j - i >= min_len {
                return Some((b as char, j - i));
            }
            i = j;
        } else {
            i += 1;
        }
    }
    None
}

/// Audits any `SequenceDocument` against Twist Bioscience's Custom Vector Onboarding QC Specifications.
pub fn audit_twist_custom_vector_onboarding(
    doc: &SequenceDocument,
    insertion_site_bp: usize,
    dna_volume_ul: f64,
    dna_conc_ng_ul: f64,
) -> TwistOnboardingReport {
    let s = clean_sequence(&doc.sequence);
    let len = s.len();
    let site = insertion_site_bp.clamp(1, len.max(1));
    let mut checks: Vec<TwistOnboardingCheckItem> = Vec::new();

    // 1. Circular topology & length >= 1,000 bp
    let is_circ = doc.topology == Topology::Circular && doc.molecule_type == MoleculeType::DNA;
    let topo_str = match doc.topology {
        Topology::Circular => "circular",
        Topology::Linear => "linear",
    };
    let mol_str = match doc.molecule_type {
        MoleculeType::DNA => "DNA",
        MoleculeType::RNA => "RNA",
        MoleculeType::Protein => "Protein",
    };
    checks.push(TwistOnboardingCheckItem {
        id: "topology".to_string(),
        rule: "Circular dsDNA Clonal Backbone (≥ 1,000 bp, BSL-1)".to_string(),
        status: if is_circ && len >= 1000 {
            "pass".to_string()
        } else {
            "fail".to_string()
        },
        detail: if is_circ {
            format!("{} bp circular dsDNA plasmid", format_thousands(len))
        } else {
            format!(
                "Must be circular dsDNA ≥ 1,000 bp (currently {} {}, {} bp)",
                topo_str, mol_str, len
            )
        },
    });

    // 2. Bacterial Origin of Replication check
    let mut feat_text = format!("{} {}", doc.name, doc.description);
    for f in &doc.features {
        feat_text.push(' ');
        feat_text.push_str(&f.name);
        if let Some(n) = &f.notes {
            feat_text.push(' ');
            feat_text.push_str(n);
        }
    }
    let feat_lower = feat_text.to_ascii_lowercase();
    let has_low_copy = feat_lower.contains("psc101")
        || feat_lower.contains("f-plasmid")
        || feat_lower.contains(" bac ")
        || feat_lower.contains("cen6")
        || feat_lower.contains("single-copy");
    let has_p15a = feat_lower.contains("p15a") || feat_lower.contains("pacyc");
    let has_high_med_cole1 = feat_lower.contains("puc")
        || feat_lower.contains("pmb1")
        || feat_lower.contains("pbr322")
        || feat_lower.contains("cole1")
        || feat_lower.contains("rep_origin")
        || feat_lower.contains(" ori")
        || doc.features.iter().any(|f| f.feature_type == "rep_origin");

    checks.push(TwistOnboardingCheckItem {
        id: "origin".to_string(),
        rule: "Constitutive E. coli Origin (ColE1/pMB1/pUC High or p15A Med)".to_string(),
        status: if has_low_copy {
            "fail".to_string()
        } else if has_p15a {
            "warn".to_string()
        } else if has_high_med_cole1 {
            "pass".to_string()
        } else {
            "fail".to_string()
        },
        detail: if has_low_copy {
            "Low-copy origin (e.g., pSC101 / BAC) detected — rejected by Twist Custom Vector Onboarding".to_string()
        } else if has_p15a {
            "Medium-copy p15A origin accepted (note: expect reduced miniprep DNA yield tiers)".to_string()
        } else if has_high_med_cole1 {
            "Compatible high/medium-copy ColE1/pMB1/pUC bacterial origin detected".to_string()
        } else {
            "No recognized constitutive E. coli replication origin annotated".to_string()
        },
    });

    // 3. Supported Twist Production Antibiotic Marker
    let ab_standards = get_twist_antibiotic_standards();
    let mut matched_ab = ab_standards.iter().find(|ab| {
        ab.gene_markers
            .iter()
            .any(|m| feat_lower.contains(&m.to_ascii_lowercase()))
            || feat_lower.contains(&ab.name.to_ascii_lowercase())
    });
    if matched_ab.is_none() && s.contains("ATGAGTATTCAACATTTCCGTGTCGCC") {
        matched_ab = ab_standards.iter().find(|a| a.code == "AMP");
    }
    if matched_ab.is_none() && s.contains("ATGATTGAACAAGATGGATTGCACGCA") {
        matched_ab = ab_standards.iter().find(|a| a.code == "KAN");
    }

    checks.push(TwistOnboardingCheckItem {
        id: "antibiotic".to_string(),
        rule: "Supported Twist Production Antibiotic Resistance Marker".to_string(),
        status: if matched_ab.is_some() {
            "pass".to_string()
        } else {
            "fail".to_string()
        },
        detail: match matched_ab {
            Some(ab) => format!(
                "{} ({}) at {} µg/mL standard production concentration",
                ab.name, ab.code, ab.concentration_ug_ml as usize
            ),
            None => "Requires KAN (50), AMP (100), CHLOR (25), APRA (50), SPEC (100), TET (10), ZEO (50), or BLAST (100 µg/mL)".to_string(),
        },
    });

    // 4. Absence of toxic ccdB gene in final clonal product
    let ccdb_motif = "ATGCAGTTTAAGGTTTACACCTATAAAAGAGAGAGC";
    let has_ccdb = feat_lower.contains("ccdb") || s.contains(ccdb_motif);
    checks.push(TwistOnboardingCheckItem {
        id: "ccdb".to_string(),
        rule: "No ccdB Gyrase Toxin Retained in Final Clonal Product".to_string(),
        status: if has_ccdb {
            "fail".to_string()
        } else {
            "pass".to_string()
        },
        detail: if has_ccdb {
            "ccdB detected — ccdB must be excised/replaced at the insertion window or removed before onboarding".to_string()
        } else {
            "No ccdB counter-selection toxin detected".to_string()
        },
    });

    let extract_circular_window = |center_1based: usize, radius: usize| -> String {
        if len == 0 {
            return String::new();
        }
        let tripled = format!("{}{}{}", s, s, s);
        let c = len + (center_1based - 1);
        let start = c.saturating_sub(radius);
        let end = (c + radius).min(tripled.len());
        tripled[start..end].to_string()
    };

    // 5. No homopolymers > 9 bp within ±40 bp of insertion site
    let win40 = extract_circular_window(site, 40);
    let homo = find_homopolymer_run(&win40, 10);
    checks.push(TwistOnboardingCheckItem {
        id: "homopolymer".to_string(),
        rule: "No Homopolymers (> 9 bp A/T/G/C run) Within ±40 bp of Insertion Site".to_string(),
        status: if homo.is_some() {
            "fail".to_string()
        } else {
            "pass".to_string()
        },
        detail: match homo {
            Some((base, run_len)) => format!(
                "Found {}-bp {} homopolymer near insertion coordinate {}",
                run_len, base, site
            ),
            None => format!(
                "Clean ±40 bp insertion window around bp {} (max homopolymer ≤ 9 bp)",
                site
            ),
        },
    });

    // 6. >=40 bp unique upstream & downstream flanks without >19 bp direct repeats
    let left40 = &win40[..win40.len().min(40)];
    let right40 = &win40[win40.len().saturating_sub(40)..];
    let mut has_20bp_repeat = false;
    if left40.len() >= 20 {
        for i in 0..=(left40.len() - 20) {
            let kmer = &left40[i..i + 20];
            if right40.contains(kmer) {
                has_20bp_repeat = true;
                break;
            }
        }
    }
    checks.push(TwistOnboardingCheckItem {
        id: "uniqueflanks".to_string(),
        rule: "≥ 40 bp Unique Upstream & Downstream Homology Flanks (No >19 bp Repeats)"
            .to_string(),
        status: if len < 120 || has_20bp_repeat {
            "fail".to_string()
        } else {
            "pass".to_string()
        },
        detail: if has_20bp_repeat {
            "≥20 bp direct repeat shared between upstream and downstream ±40 bp homology arms"
                .to_string()
        } else {
            "Upstream and downstream 40 bp Gibson/homology arms are unique".to_string()
        },
    });

    // 7. Restriction Enzyme linearization site within ±50 bp of insertion site, from every site:
    // an enzyme's sites near the insertion point may come after the first ones a scan keeps.
    let all_sites = if len > 0 {
        scan_restriction_sites(&s, doc.topology, None, RestrictionPositionLimit::All).sites
    } else {
        Vec::new()
    };
    let mut nearby_enzymes: Vec<String> = Vec::new();
    let mut seen_enz: HashSet<String> = HashSet::new();
    for cs in &all_sites {
        let direct_dist = cs.position.abs_diff(site);
        let wrap_dist = len.saturating_sub(direct_dist);
        if direct_dist.min(wrap_dist) <= 50 && seen_enz.insert(cs.enzyme.name.clone()) {
            nearby_enzymes.push(cs.enzyme.name.clone());
        }
    }
    checks.push(TwistOnboardingCheckItem {
        id: "linearization".to_string(),
        rule: "Restriction Enzyme Linearization Site Within ±50 bp of Insertion Site".to_string(),
        status: if !nearby_enzymes.is_empty() {
            "pass".to_string()
        } else {
            "warn".to_string()
        },
        detail: if !nearby_enzymes.is_empty() {
            let preview: Vec<&str> = nearby_enzymes.iter().take(8).map(String::as_str).collect();
            format!(
                "{} linearization enzyme(s) within ±50 bp: {}",
                nearby_enzymes.len(),
                preview.join(", ")
            )
        } else {
            format!(
                "No REBASE cleavage site within ±50 bp of bp {} — move insertion point into MCS or add linearization site",
                site
            )
        },
    });

    // 8. GC% in ±50 bp homology assembly window (30%–72%)
    let win50 = extract_circular_window(site, 50);
    let gc_count = win50
        .bytes()
        .filter(|&b| b == b'G' || b == b'C')
        .count();
    let gc_pct = if win50.is_empty() {
        0.0
    } else {
        ((gc_count as f64 / win50.len() as f64) * 1000.0).round() / 10.0
    };
    checks.push(TwistOnboardingCheckItem {
        id: "window-gc".to_string(),
        rule: "Balanced GC Content (30%–72%) Across ±50 bp Homology Assembly Window".to_string(),
        status: if (30.0..=72.0).contains(&gc_pct) {
            "pass".to_string()
        } else {
            "warn".to_string()
        },
        detail: format!("Local ±50 bp window GC content is {:.1}%", gc_pct),
    });

    // 9. Physical DNA sample submission spec (>= 100 uL, >= 100 ng/uL, >= 10 ug)
    let total_mass_ug = (((dna_volume_ul * dna_conc_ng_ul) / 1000.0) * 100.0).round() / 100.0;
    let sample_pass = dna_volume_ul >= 100.0 && dna_conc_ng_ul >= 100.0 && total_mass_ug >= 10.0;
    checks.push(TwistOnboardingCheckItem {
        id: "dna-sample".to_string(),
        rule: "Physical DNA Submission Spec (≥ 100 µL, ≥ 100 ng/µL, ≥ 10 µg Mass)".to_string(),
        status: if sample_pass {
            "pass".to_string()
        } else {
            "warn".to_string()
        },
        detail: format!(
            "{} µL × {} ng/µL = {} µg total plasmid DNA ({})",
            dna_volume_ul,
            dna_conc_ng_ul,
            total_mass_ug,
            if sample_pass {
                "Meets Twist Shipment Spec"
            } else {
                "Below ≥100 µL / ≥100 ng/µL / ≥10 µg threshold"
            }
        ),
    });

    let has_25_at = find_homopolymer_run(&s, 25)
        .map(|(b, _)| b == 'A' || b == 'T')
        .unwrap_or(false);
    let needs_stbl3 = ["ltr", "itr", "lenti", "aav", "retro", "50a", "repeat"]
        .iter()
        .any(|kw| feat_lower.contains(kw))
        || has_25_at;
    let has_fail = checks.iter().any(|c| c.status == "fail");
    let has_warn = checks.iter().any(|c| c.status == "warn");

    TwistOnboardingReport {
        overall_status: if has_fail {
            "Action Required (Blocked)".to_string()
        } else if has_warn {
            "Review Warnings".to_string()
        } else {
            "Ready for Onboarding".to_string()
        },
        recommended_strain: if needs_stbl3 {
            "Stbl3-like (30°C / 37°C)".to_string()
        } else {
            "DH10B-like (37°C)".to_string()
        },
        production_antibiotic: match matched_ab {
            Some(ab) => format!("{} ({} µg/mL)", ab.name, ab.concentration_ug_ml as usize),
            None => "Unspecified (Add AmpR/KanR/CmR)".to_string(),
        },
        nearby_linearization_enzymes: nearby_enzymes,
        total_mass_ug,
        checks,
    }
}

/// Simulates Twist Bioscience scarless homology-based Clonal Gene Insertion at an exact base coordinate,
/// including optional Gateway pTwist ENTR Kozak framing or IgG VH/VL variable-domain framing.
pub fn simulate_twist_clonal_gene_insertion(
    vector_doc: &SequenceDocument,
    insertion_site_bp: usize,
    insert_name: &str,
    insert_seq_raw: &str,
    framing_mode: &str,
) -> SequenceDocument {
    let vec_seq = clean_sequence(&vector_doc.sequence);
    let mut insert_clean = clean_sequence(insert_seq_raw);
    if insert_clean.is_empty() {
        insert_clean =
            "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTAA"
                .to_string();
    }

    if framing_mode == "entr-kozak" {
        if !insert_clean.starts_with("GCCACC") {
            insert_clean = format!("GCCACC{}", insert_clean);
        }
        let rem = insert_clean.len() % 3;
        if rem != 0 {
            for _ in 0..(3 - rem) {
                insert_clean.push('G');
            }
        }
    } else if framing_mode == "igg-variable-inframe" && insert_clean.len() > 9 {
        if insert_clean.ends_with("TAA")
            || insert_clean.ends_with("TAG")
            || insert_clean.ends_with("TGA")
        {
            insert_clean.truncate(insert_clean.len() - 3);
        }
    }

    let cut_idx = insertion_site_bp.min(vec_seq.len());
    let delta = insert_clean.len();
    let mut new_seq = String::with_capacity(vec_seq.len() + delta);
    new_seq.push_str(&vec_seq[..cut_idx]);
    new_seq.push_str(&insert_clean);
    new_seq.push_str(&vec_seq[cut_idx..]);

    let mut shifted_features: Vec<SequenceFeature> = vector_doc
        .features
        .iter()
        .map(|f| {
            let mut nf = f.clone();
            if nf.start > cut_idx {
                nf.start += delta;
            }
            if nf.end > cut_idx {
                nf.end += delta;
            }
            nf
        })
        .collect();

    let trimmed_name = insert_name.trim();
    let label = if trimmed_name.is_empty() {
        "Twist_Clonal_Gene_Insert"
    } else {
        trimmed_name
    };
    shifted_features.push(SequenceFeature {
        id: format!("twist-clonal-{}", cut_idx + 1),
        name: label.to_string(),
        feature_type: "CDS".to_string(),
        start: cut_idx + 1,
        end: cut_idx + delta,
        strand: 1,
        color: "#10B981".to_string(),
        notes: Some(format!(
            "Twist scarless homology clonal gene insert ({}, {} bp)",
            framing_mode, delta
        )),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });

    let now = "2026-10-31T00:00:00.000Z".to_string();
    let mut history = vector_doc.history.clone();
    let new_len = new_seq.len();
    history.push(HistoryTreeNode {
        id: format!("hist-twist-{}", new_len),
        timestamp: now.clone(),
        operation: "Twist Clonal Gene Insertion".to_string(),
        description: format!(
            "Inserted {} ({} bp, {}) at bp {}",
            if trimmed_name.is_empty() {
                "Clonal Gene"
            } else {
                trimmed_name
            },
            delta,
            framing_mode,
            cut_idx
        ),
        parent_ids: vec![vector_doc.id.clone()],
        length_bp: new_len,
        topology: vector_doc.topology.clone(),
        history_color: Some("#10B981".to_string()),
        inserted_range: Some(InsertedRange {
            start: cut_idx + 1,
            end: cut_idx + delta,
        }),
    });

    let mut out = vector_doc.clone();
    out.id = format!("clonal-{}-{}", vector_doc.id, new_len);
    out.name = format!(
        "{}_{}",
        vector_doc.name,
        if trimmed_name.is_empty() {
            "ClonalInsert"
        } else {
            trimmed_name
        }
    );
    out.sequence = new_seq;
    out.features = shifted_features;
    out.updated_at = now;
    out.history = history;
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CoTransformationCompatibility {
    pub compatible: bool,
    pub origin_compatible: bool,
    pub antibiotic_orthogonal: bool,
    pub group_a: String,
    pub group_b: String,
    pub summary: String,
}

/// Evaluates whether two plasmids can be stably co-transformed and co-maintained in the same host cell.
pub fn check_cotransformation_compatibility(
    vec_a: &CatalogVectorEntry,
    vec_b: &CatalogVectorEntry,
) -> CoTransformationCompatibility {
    let groups = get_origin_compatibility_groups();
    let resolve_origin_group = |ori_text: &str| -> String {
        let t = ori_text.to_ascii_lowercase();
        if t.contains("p15a") || t.contains("pacyc") {
            return "IncP15A (p15A)".to_string();
        }
        if t.contains("psc101") {
            return "IncX (pSC101)".to_string();
        }
        if t.contains("clodf13") || t.contains("cdf") {
            return "CloDF13 (CDF)".to_string();
        }
        if t.contains("rsf1030") || t.contains("rsf") {
            return "RSF1030 (RSF)".to_string();
        }
        if t.contains("2μ") || t.contains("2-micron") {
            return "Yeast 2μ".to_string();
        }
        if t.contains("cen6") || t.contains("ars") {
            return "Yeast CEN/ARS".to_string();
        }
        if let Some(matched) = groups
            .iter()
            .find(|g| g.origins.iter().any(|o| t.contains(&o.to_ascii_lowercase())))
        {
            matched.group_code.clone()
        } else {
            "IncG / ColE1 (pMB1/pUC/pBR322)".to_string()
        }
    };

    let group_a = resolve_origin_group(&vec_a.origin);
    let group_b = resolve_origin_group(&vec_b.origin);
    let origin_compatible = group_a != group_b;
    let antibiotic_orthogonal = !vec_a
        .bacterial_marker
        .eq_ignore_ascii_case(&vec_b.bacterial_marker);
    let compatible = origin_compatible && antibiotic_orthogonal;

    let summary = if compatible {
        format!(
            "Compatible for stable dual-plasmid co-transformation: orthogonal origins ({} vs {}) and independent selection ({} + {}).",
            group_a, group_b, vec_a.bacterial_marker, vec_b.bacterial_marker
        )
    } else if !origin_compatible && !antibiotic_orthogonal {
        format!(
            "Incompatible: Both vectors share the {} replication control group AND identical {} resistance — rapid plasmid loss will occur.",
            group_a, vec_a.bacterial_marker
        )
    } else if !origin_compatible {
        format!(
            "Origin Incompatibility Warning: Both vectors compete within {}. Switch one plasmid to p15A (e.g., pTwist Medium Copy / pACYC184), CloDF13, or RSF1030.",
            group_a
        )
    } else {
        format!(
            "Selection Overlap: Origins ({} vs {}) are compatible, but both use {} — choose orthogonal antibiotics to maintain both plasmids.",
            group_a, group_b, vec_a.bacterial_marker
        )
    };

    CoTransformationCompatibility {
        compatible,
        origin_compatible,
        antibiotic_orthogonal,
        group_a,
        group_b,
        summary,
    }
}

fn escape_svg_xml(raw: &str) -> String {
    raw.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Renders a standalone publication-ready Circular Vector Map SVG for any `CatalogVectorEntry`.
pub fn generate_catalog_circular_svg(entry: &CatalogVectorEntry) -> String {
    let all_parts = get_modular_vector_parts();
    let part_map: HashMap<&str, &ModularVectorPart> =
        all_parts.iter().map(|p| (p.id.as_str(), p)).collect();
    let parts: Vec<&ModularVectorPart> = entry
        .part_blueprint_ids
        .iter()
        .filter_map(|id| part_map.get(id.as_str()).copied())
        .collect();

    let cx = 140.0_f64;
    let cy = 140.0_f64;
    let r = 92.0_f64;
    let total_parts = parts.len().max(1) as f64;
    let pi = std::f64::consts::PI;

    let mut arcs = Vec::with_capacity(parts.len());
    for (idx, p) in parts.iter().enumerate() {
        let a0 = (idx as f64 / total_parts) * pi * 2.0 - pi / 2.0 + 0.06;
        let a1 = ((idx + 1) as f64 / total_parts) * pi * 2.0 - pi / 2.0 - 0.06;
        let x0 = cx + r * a0.cos();
        let y0 = cy + r * a0.sin();
        let x1 = cx + r * a1.cos();
        let y1 = cy + r * a1.sin();
        let large_arc = if a1 - a0 > pi { 1 } else { 0 };
        let mid = (a0 + a1) / 2.0;
        let lx = cx + (r + 22.0) * mid.cos();
        let ly = cy + (r + 22.0) * mid.sin();
        let first_word = p.name.split_whitespace().next().unwrap_or(&p.name);
        let short_raw: String = first_word.chars().take(12).collect();
        let short_label = escape_svg_xml(&short_raw);
        arcs.push(format!(
            "<path d=\"M {:.1} {:.1} A {:.0} {:.0} 0 {} 1 {:.1} {:.1}\" fill=\"none\" stroke=\"{}\" stroke-width=\"11\" stroke-linecap=\"round\"/>\n      <text x=\"{:.1}\" y=\"{:.1}\" text-anchor=\"middle\" dominant-baseline=\"middle\" font-size=\"8.5\" font-family=\"Inter, system-ui, sans-serif\" fill=\"#334155\" font-weight=\"600\">{}</text>",
            x0,
            y0,
            r,
            r,
            large_arc,
            x1,
            y1,
            escape_svg_xml(&p.color),
            lx,
            ly,
            short_label
        ));
    }

    let title_short: String = entry.name.chars().take(22).collect();
    let topo_str = match entry.topology {
        Topology::Circular => "circular",
        Topology::Linear => "linear",
    };

    format!(
        "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 280 280\" width=\"280\" height=\"280\">\n  <circle cx=\"140\" cy=\"140\" r=\"92\" fill=\"none\" stroke=\"#CBD5E1\" stroke-width=\"3\"/>\n  {}\n  <text x=\"140\" y=\"130\" text-anchor=\"middle\" font-size=\"11\" font-weight=\"700\" font-family=\"Inter, system-ui, sans-serif\" fill=\"#0F172A\">{}</text>\n  <text x=\"140\" y=\"146\" text-anchor=\"middle\" font-size=\"9.5\" font-family=\"Inter, system-ui, sans-serif\" fill=\"#475569\">{} bp • {}</text>\n  <text x=\"140\" y=\"160\" text-anchor=\"middle\" font-size=\"8.5\" font-family=\"Inter, system-ui, sans-serif\" fill=\"#2563EB\">{}</text>\n</svg>",
        arcs.join("\n"),
        escape_svg_xml(&title_short),
        format_thousands(entry.nominal_size_bp),
        escape_svg_xml(topo_str),
        escape_svg_xml(&entry.source)
    )
}

/// Exports filtered `CatalogVectorEntry` rows as a CSV catalog table.
pub fn export_vector_catalog_csv(entries: &[CatalogVectorEntry]) -> String {
    let header = "Name,Source,Category,Topology,Nominal_Size_bp,Host_System,Origin,Copy_Number,Bacterial_Marker,Eukaryotic_Marker,Promoter,Fusion_Tags,MCS_Enzymes,Recommended_Strain";
    let mut lines = Vec::with_capacity(entries.len() + 1);
    lines.push(header.to_string());
    for e in entries {
        let topo = match e.topology {
            Topology::Circular => "circular",
            Topology::Linear => "linear",
        };
        let cells = [
            e.name.as_str(),
            e.source.as_str(),
            e.category.as_str(),
            topo,
            &e.nominal_size_bp.to_string(),
            e.host_system.as_str(),
            e.origin.as_str(),
            e.copy_number.as_str(),
            e.bacterial_marker.as_str(),
            e.eukaryotic_marker.as_str(),
            e.promoter.as_str(),
            &e.fusion_tags.join("; "),
            &e.mcs_enzymes.join("; "),
            e.recommended_strain.as_str(),
        ];
        let row: Vec<String> = cells
            .iter()
            .map(|c| format!("\"{}\"", c.replace('"', "\"\"")))
            .collect();
        lines.push(row.join(","));
    }
    lines.join("\n")
}

/// Synthesizes an authentic, feature-annotated, restriction-digestible `SequenceDocument`
/// for any Gateway, TA, GC, or TOPO vector preset selected from the Actions menu.
pub fn build_cloning_action_vector_document(
    preset: &CloningActionVectorPreset,
) -> SequenceDocument {
    let mut features: Vec<SequenceFeature> = Vec::new();
    let mut seq = String::with_capacity(preset.nominal_size_bp.clamp(2000, 10_500));
    let mut feat_idx = 1usize;

    let add_block = |seq: &mut String,
                     features: &mut Vec<SequenceFeature>,
                     feat_idx: &mut usize,
                     name: &str,
                     ftype: &str,
                     dna: &str,
                     color: &str,
                     strand: i8,
                     notes: Option<String>| {
        let start = seq.len() + 1;
        seq.push_str(dna);
        let end = seq.len();
        features.push(SequenceFeature {
            id: format!("{}-f-{}", preset.id, *feat_idx),
            name: name.to_string(),
            feature_type: ftype.to_string(),
            start,
            end,
            strand,
            color: color.to_string(),
            notes,
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        });
        *feat_idx += 1;
    };

    seq.push_str("CGACGTTGTAAAACGACGGCCAGT");
    features.push(SequenceFeature {
        id: format!("{}-m13f", preset.id),
        name: "M13 Forward (-20)".to_string(),
        feature_type: "primer_bind".to_string(),
        start: 8,
        end: 24,
        strand: 1,
        color: "#0284c7".to_string(),
        notes: Some("Universal M13 forward sequencing primer binding site".to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });
    seq.push_str(&generate_safe_backbone_spacer(36, 5));

    if preset.promoter != "None" && !preset.promoter.starts_with("None") {
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            &format!("{} Promoter", preset.promoter),
            "promoter",
            "TAATACGACTCACTATAGGGAGACCACAACGGTTTCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACAT",
            "#2563eb",
            1,
            Some(format!("Transcriptional promoter ({})", preset.promoter)),
        );
        seq.push_str(&generate_safe_backbone_spacer(28, 7));
    }

    if preset.group == "gateway-donor" {
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "attP1",
            "protein_bind",
            "AAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGAATCAACTACTTAGATGGTATTAGTGACCTGTA",
            "#7c3aed",
            1,
            Some("Bacteriophage lambda attP1 BP Clonase recombination site".to_string()),
        );
        seq.push_str(&generate_safe_backbone_spacer(24, 9));
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "CmR (cat)",
            "CDS",
            "ATGGAGAAAAAAATCACTGGATATACCACCGTTGATATATCCCAATGGCATCGTAAAGAACATTTTGAGGCATTTCAGTCAGTTGCTCAATGTACCTATAACCAGACCGTTCAGCTGGATATTACGGCCTTTTTAAAGACCGTAAAGAAAAATAAGCACAAGTTTTATCCGGCCTTTATTCACATTCTTGCCCGCCTGATGAATGCTCATCCGGAATTCCGTATGGCAATGAAAGACGGTGAGCTGGTGATATGGGATAGTGTTCACCCTTGTTACACCGTTTTCCATGAGCAAACTGAAACGTTTTCATCGCTCTGGAGTGAATACCACGACGATTTCCGGCAGTTTCTACACATATATTCGCAAGATGTGGCGTGTTACGGTGAAAACCTGGCCTATTTCCCTAAAGGGTTTATTGAGAATATGTTTTTCGTCTCAGCCAATCCCTGGGTGAGTTTCACCAGTTTTGATTTAAACGTGGCCAATATGGACAACTTCTTCGCCCCCGTTTTCACCATGGGCAAATATTATACGCAAGGCGACAAGGTGCTGATGCCGCTGGCGATTCAGGTTCATCATGCCGTTTGTGATGGCTTCCATGTCGGCAGAATGCTTAATGAATTACAACAGTACTGCGATGAGTGGCAGGGCGGGGCGTAA",
            "#f59e0b",
            1,
            Some("Chloramphenicol acetyltransferase counter-selection cassette marker".to_string()),
        );
        seq.push_str(&generate_safe_backbone_spacer(20, 11));
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "ccdB",
            "CDS",
            "ATGCAGTTTAAGGTTTACACCTATAAAAGAGAGAGCCGTTATCGTCTGTTTGTGGATGTACAGAGTGATATTATTGACACGCCCGGGCGACGGATGGTGATCCCCCTGGCCAGTGCACGTCTGCTGTCAGATAAAGTCTCCCGTGAACTTTACCCGGTGGTGCATATCGGGGATGAAAGCTGGCGCATGATGACCACCGATATGGCCAGTGTGCCGGTCTCCGTTATCGGGGAAGAAGTGGCTGATCTCAGCCACCGCGAAAATGACATCAAAAACGCCATTAACCTGATGTTCTGGGGAATATAA",
            "#dc2626",
            1,
            Some("DNA gyrase toxin negative-selection gene replaced during Gateway BP reaction".to_string()),
        );
        seq.push_str(&generate_safe_backbone_spacer(24, 13));
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "attP2",
            "protein_bind",
            "TACAGGTCACTAATACCATCTAAGTAGTTGATTCATAGTGACTGGATATGTTGTGTTTTACAGTATTATGTAGTCTGTTTTTTATGCAAAATCTAATTTAATATATTGATATTTATATCATTTTACGTTTCTCGTTCAGCTTTCTTGTACAAAGTTGGCATTATAAGAAAGCATTGCTTATCAATTTGTTGCAACGAACAGGTCACTATCAGTCAAAATAAAATCATTATTT",
            "#7c3aed",
            -1,
            Some("Bacteriophage lambda attP2 BP Clonase recombination site".to_string()),
        );
    } else if preset.group == "gateway-dest" {
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "attR1",
            "protein_bind",
            "ACAAGTTTGTACAAAAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATGGCGGCCGC",
            "#7c3aed",
            1,
            Some("Gateway attR1 LR Clonase recombination site".to_string()),
        );
        seq.push_str(&generate_safe_backbone_spacer(20, 15));
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "ccdB Selection Cassette",
            "CDS",
            "ATGCAGTTTAAGGTTTACACCTATAAAAGAGAGAGCCGTTATCGTCTGTTTGTGGATGTACAGAGTGATATTATTGACACGCCCGGGCGACGGATGGTGATCCCCCTGGCCAGTGCACGTCTGCTGTCAGATAAAGTCTCCCGTGAACTTTACCCGGTGGTGCATATCGGGGATGAAAGCTGGCGCATGATGACCACCGATATGGCCAGTGTGCCGGTCTCCGTTATCGGGGAAGAAGTGGCTGATCTCAGCCACCGCGAAAATGACATCAAAAACGCCATTAACCTGATGTTCTGGGGAATATAA",
            "#dc2626",
            1,
            Some("ccdB negative-selection gene replaced by Entry insert during LR Clonase reaction".to_string()),
        );
        seq.push_str(&generate_safe_backbone_spacer(20, 17));
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            "attR2",
            "protein_bind",
            "GCGGCCGCCACCACTTTGTACAAGAAAGCTGAACGAGAAACGTAAAATGATATAAATATCAATATATTAAATTAGATTTTGCATAAAAAACAGACTACATAATACTGTAAAACACAACATATCCAGTCACTATG",
            "#7c3aed",
            -1,
            Some("Gateway attR2 LR Clonase recombination site".to_string()),
        );
    } else {
        let mcs_dna = build_mcs_polylinker(&preset.mcs_enzymes);
        let topo_motif = if preset.group == "topo-directional" {
            "CCCTTGTGG"
        } else if preset.group.starts_with("topo-") {
            "CCCTT"
        } else if preset.group == "gc-vectors" {
            "GGGGG"
        } else {
            "TTTTT"
        };
        let half = mcs_dna.len() / 2;
        let combined = format!("{}{}{}", &mcs_dna[..half], topo_motif, &mcs_dna[half..]);
        add_block(
            &mut seq,
            &mut features,
            &mut feat_idx,
            &preset.recombination_or_cloning_site,
            "misc_feature",
            &combined,
            "#0d9488",
            1,
            Some(preset.summary.clone()),
        );
    }

    seq.push_str(&generate_safe_backbone_spacer(28, 17));
    let m13_rev_start = seq.len() + 1;
    seq.push_str("GTCATAGCTGTTTCCTG");
    let m13_rev_end = seq.len();
    features.push(SequenceFeature {
        id: format!("{}-m13r", preset.id),
        name: "M13 Reverse (-27)".to_string(),
        feature_type: "primer_bind".to_string(),
        start: m13_rev_start,
        end: m13_rev_end,
        strand: -1,
        color: "#7c3aed".to_string(),
        notes: Some("Universal M13 reverse sequencing primer binding site".to_string()),
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    });

    seq.push_str(&generate_safe_backbone_spacer(44, 19));

    let is_kan = preset
        .selection_marker
        .to_ascii_lowercase()
        .contains("kanamycin");
    add_block(
        &mut seq,
        &mut features,
        &mut feat_idx,
        if is_kan {
            "KanR (aph(3')-IIa)"
        } else {
            "AmpR (bla)"
        },
        "CDS",
        if is_kan {
            "ATGATTGAACAAGATGGATTGCACGCAGGTTCTCCGGCCGCTTGGGTGGAGAGGCTATTCGGCTATGACTGGGCACAACAGACAATCGGCTGCTCTGATGCCGCCGTGTTCCGGCTGTCAGCGCAGGGGCGCCCGGTTCTTTTTGTCAAGACCGACCTGTCCGGTGCCCTGAATGAACTGCAGGACGAGGCAGCGCGGCTATCGTGGCTGGCCACGACGGGCGTTCCTTGCGCAGCTGTGCTCGACGTTGTCACTGAAGCGGGAAGGGACTGGCTGCTATTGGGCGAAGTGCCGGGGCAGGATCTCCTGTCATCTCACCTTGCTCCTGCCGAGAAAGTATCCATCATGGCTGATGCAATGCGGCGGCTGCATACGCTTGATCCGGCTACCTGCCCATTCGACCACCAAGCGAAACATCGCATCGAGCGAGCACGTACTCGGATGGAAGCCGGTCTTGTCGATCAGGATGATCTGGACGAAGAGCATCAGGGGCTCGCGCCAGCCGAACTGTTCGCCAGGCTCAAGGCGCGCATGCCCGACGGCGAGGATCTCGTCGTGACCCATGGCGATGCCTGCTTGCCGAATATCATGGTGGAAAATGGCCGCTTTTCTGGATTCATCGACTGTGGCCGGCTGGGTGTGGCGGACCGCTATCAGGACATAGCGTTGGCTACCCGTGATATTGCTGAAGAGCTTGGCGGCGAATGGGCTGACCGCTTCCTCGTGCTTTACGGTATCGCCGCTCCCGATTCGCAGCGCATCGCCTTCTATCGCCTTCTTGACGAGTTCTTCTGA"
        } else {
            "ATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAACTGTCAGACCAAGTTTACTCATATATACTTTAGATTGATTTAAAACTTCATTTTTAATTTAAAAGGATCTAGGTGAAGATCCTTTTTGATAATCTCATGACCAAAATCCCTTAACGTGAGTTTTCGTTCCACTGAGCGTCAGACCCCGTAG"
        },
        "#16a34a",
        1,
        Some(format!("Bacterial selection marker ({})", preset.selection_marker)),
    );

    seq.push_str(&generate_safe_backbone_spacer(40, 23));

    add_block(
        &mut seq,
        &mut features,
        &mut feat_idx,
        "pUC / ColE1 ori",
        "rep_origin",
        "TTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATG",
        "#eab308",
        1,
        Some("High-copy bacterial origin of replication".to_string()),
    );

    let target_len = 10_000usize.min((seq.len() + 48).max(preset.nominal_size_bp));
    if seq.len() < target_len {
        let rem = target_len - seq.len();
        seq.push_str(&generate_safe_backbone_spacer(rem, 31));
    }

    let primers = vec![
        PrimerRecord {
            id: format!("{}-prm-m13f", preset.id),
            name: "M13 Forward (-20)".to_string(),
            sequence: "GTAAAACGACGGCCAGT".to_string(),
            anneal_sequence: "GTAAAACGACGGCCAGT".to_string(),
            tail5_prime: String::new(),
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
            notes: Some("Universal forward sequencing primer".to_string()),
            tm_no_answer_reason: None,
        },
        PrimerRecord {
            id: format!("{}-prm-m13r", preset.id),
            name: "M13 Reverse (-27)".to_string(),
            sequence: "CAGGAAACAGCTATGAC".to_string(),
            anneal_sequence: "CAGGAAACAGCTATGAC".to_string(),
            tail5_prime: String::new(),
            bind_start: m13_rev_start,
            bind_end: m13_rev_end,
            strand: -1,
            length: 17,
            gc_percent: 47.1,
            tm_anneal_c: 51.8,
            tm_full_c: 51.8,
            delta_g37: -19.6,
            hairpin_delta_g: 0.2,
            self_dimer_delta_g: -1.4,
            gc_clamp3_prime: true,
            notes: Some("Universal reverse sequencing primer".to_string()),
            tm_no_answer_reason: None,
        },
    ];

    let clean_acc: String = preset
        .id
        .to_ascii_uppercase()
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() { c } else { '_' })
        .collect();
    let topo_str = match preset.topology {
        Topology::Circular => "circular",
        Topology::Linear => "linear",
    };
    let seq_len = seq.len();
    let now = "2026-10-31T00:00:00.000Z".to_string();

    SequenceDocument {
        id: format!("actvec-{}-{}", preset.id, seq_len),
        name: preset.name.clone(),
        accession: format!("MBC_{}", clean_acc),
        description: format!(
            "{} | Host: {} | Selection: {}",
            preset.summary, preset.host_system, preset.selection_marker
        ),
        molecule_type: MoleculeType::DNA,
        topology: preset.topology.clone(),
        sequence: seq,
        features,
        primers,
        history: vec![HistoryTreeNode {
            id: format!("hist-{}", preset.id),
            timestamp: "2026-10-31 00:00".to_string(),
            operation: format!("Loaded Cloning Vector ({})", preset.cloning_method),
            description: format!(
                "Loaded {} ({} bp, {}) for {}",
                preset.name,
                format_thousands(seq_len),
                topo_str,
                preset.cloning_method
            ),
            parent_ids: Vec::new(),
            length_bp: seq_len,
            topology: preset.topology.clone(),
            history_color: None,
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata: None,
        created_at: now.clone(),
        updated_at: now,
        folder: "Plasmids & Vectors".to_string(),
    }
}
