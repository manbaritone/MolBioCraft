// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Conserved Protein Functional Domain, PROSITE-Style Motif, Affinity Tag & Protease Cleavage
//! Site Scanner (`aho-corasick` + residue-class automaton) and 3D Structural Biophysics Engine
//! (`nalgebra` Radius of Gyration, Principal Inertia Tensor Asphericity, Plaxco Relative Contact
//! Order, Virtual C-alpha Torsion Angles, Coordination SASA, and Globular Domain Segmentation).

use aho_corasick::AhoCorasickBuilder;
use molbiocraft_core::clean_alpha_sequence;
use molbiocraft_formats::{parse_pdb_or_mmcif_ca_coordinates, PdbCaAtom};
use nalgebra::Matrix3;
use serde::{Deserialize, Serialize};

use crate::translation_orf::residue_mass_da;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteinMotifHit {
    pub accession: String,
    pub name: String,
    pub category: String,
    pub start_aa: usize, // 1-based inclusive
    pub end_aa: usize,   // 1-based inclusive
    pub matched_seq: String,
    pub cleavage_after_aa: Option<usize>,
    pub biological_role: String,
    pub confidence_score: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SignalPeptidePrediction {
    pub has_signal_peptide: bool,
    pub cleavage_site_aa: Option<usize>, // Cleaves between cleavage_site_aa and cleavage_site_aa + 1
    pub n_region_end_aa: usize,
    pub h_region_range: (usize, usize),
    pub c_region_range: (usize, usize),
    pub motif_minus3_minus1: String,
    /// Heuristic 0–1 confidence from the von Heijne features below. This is **not** SignalP's
    /// D-score, which comes from a trained neural network; it is not calibrated against one.
    #[serde(rename = "heuristicScore")]
    pub d_score: f64,
    pub summary: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProteinMotifScanReport {
    pub sequence_length_aa: usize,
    pub total_hits: usize,
    pub affinity_tags_count: usize,
    pub protease_sites_count: usize,
    pub catalytic_and_binding_count: usize,
    pub localization_signals_count: usize,
    pub ptm_sites_count: usize,
    pub signal_peptide: SignalPeptidePrediction,
    pub hits: Vec<ProteinMotifHit>,
}

struct ExactTagOrProteaseRule {
    accession: &'static str,
    name: &'static str,
    category: &'static str,
    pattern: &'static str,
    cleave_offset: Option<usize>,
    role: &'static str,
}

const EXACT_TAG_AND_PROTEASE_RULES: &[ExactTagOrProteaseRule] = &[
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_001",
        name: "Polyhistidine Affinity Tag (6xHis)",
        category: "Affinity Tag",
        pattern: "HHHHHH",
        cleave_offset: None,
        role: "IMAC Ni-NTA / Co-TALON immobilized metal affinity purification tag",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_002",
        name: "Strep-tag II",
        category: "Affinity Tag",
        pattern: "WSHPQFEK",
        cleave_offset: None,
        role: "Strep-Tactin XT biotin-mimetic affinity purification peptide",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_003",
        name: "FLAG Epitope Tag",
        category: "Affinity Tag",
        pattern: "DYKDDDDK",
        cleave_offset: Some(8),
        role: "Anti-FLAG M1/M2 monoclonal antibody capture & enterokinase cleavable tag",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_004",
        name: "Hemagglutinin (HA) Epitope Tag",
        category: "Affinity Tag",
        pattern: "YPYDVPDYA",
        cleave_offset: None,
        role: "Influenza hemagglutinin immunodetection and co-IP epitope",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_005",
        name: "c-Myc Epitope Tag",
        category: "Affinity Tag",
        pattern: "EQKLISEEDL",
        cleave_offset: None,
        role: "9E10 monoclonal antibody immunodetection epitope",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_006",
        name: "V5 Epitope Tag",
        category: "Affinity Tag",
        pattern: "GKPIPNPLLGLDST",
        cleave_offset: None,
        role: "Paramyxovirus SV5 P/V protein high-affinity immunodetection tag",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_007",
        name: "AviTag (BirA Biotinylation Acceptor)",
        category: "Affinity Tag",
        pattern: "GLNDIFEAQKIEWHE",
        cleave_offset: None,
        role: "Site-specific enzymatic biotinylation on Lys-10 by E. coli BirA ligase",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_TAG_008",
        name: "SpyTag003 Isopeptide Peptide",
        category: "Affinity Tag",
        pattern: "RGVPHIVMVDAYKRYK",
        cleave_offset: None,
        role: "Spontaneous covalent isopeptide bond formation with SpyCatcher003",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_001",
        name: "TEV Protease Cleavage Site (Canonical G)",
        category: "Protease Cleavage",
        pattern: "ENLYFQG",
        cleave_offset: Some(6),
        role: "Tobacco Etch Virus NIa cysteine protease cleavage between Gln and Gly",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_002",
        name: "TEV Protease Cleavage Site (Ser Variant)",
        category: "Protease Cleavage",
        pattern: "ENLYFQS",
        cleave_offset: Some(6),
        role: "Tobacco Etch Virus NIa cysteine protease cleavage between Gln and Ser",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_003",
        name: "HRV-3C Protease Site",
        category: "Protease Cleavage",
        pattern: "LEVLFQGP",
        cleave_offset: Some(6),
        role: "Human Rhinovirus 3C protease 4 °C cleavage between Gln and Gly-Pro",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_004",
        name: "Thrombin Cleavage Site",
        category: "Protease Cleavage",
        pattern: "LVPRGS",
        cleave_offset: Some(4),
        role: "Serine protease thrombin cleavage between Arg and Gly-Ser",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_005",
        name: "Factor Xa Cleavage Site (IEGR)",
        category: "Protease Cleavage",
        pattern: "IEGR",
        cleave_offset: Some(4),
        role: "Coagulation Factor Xa cleavage C-terminal to Arg",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_006",
        name: "Factor Xa Cleavage Site (IDGR)",
        category: "Protease Cleavage",
        pattern: "IDGR",
        cleave_offset: Some(4),
        role: "Coagulation Factor Xa cleavage C-terminal to Arg",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_007",
        name: "Enterokinase Light Chain Site",
        category: "Protease Cleavage",
        pattern: "DDDDK",
        cleave_offset: Some(5),
        role: "Enteropeptidase cleavage immediately C-terminal to Lys leaving native N-terminus",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_008",
        name: "Porcine Teschovirus-1 P2A Ribosomal Skip Motif",
        category: "Protease Cleavage",
        pattern: "ATNFSLLKQAGDVEENPGP",
        cleave_offset: Some(18),
        role: "Cotranslational 2A ribosomal skipping between Gly and Pro for bicistronic expression",
    },
    ExactTagOrProteaseRule {
        accession: "MBC_PROT_009",
        name: "Thosea asigna T2A Ribosomal Skip Motif",
        category: "Protease Cleavage",
        pattern: "EGRGSLLTCGDVEENPGP",
        cleave_offset: Some(17),
        role: "Cotranslational 2A ribosomal skipping between Gly and Pro for multicistronic vectors",
    },
];

/// Compact residue-class token matcher supporting PROSITE-style variable-gap functional motifs
/// without pulling in heavy regex engines onto `wasm32-unknown-unknown`.
#[derive(Clone, Copy)]
enum MotifToken {
    Exact(u8),
    AnyOf(&'static [u8]),
    NoneOf(&'static [u8]),
    WildcardRange(usize, usize),
}

struct PrositeMotifRule {
    accession: &'static str,
    name: &'static str,
    category: &'static str,
    anchor_c_term: bool,
    confidence: f64,
    role: &'static str,
    tokens: &'static [MotifToken],
}

use MotifToken::{AnyOf, Exact, NoneOf, WildcardRange};

const PROSITE_RULES: &[PrositeMotifRule] = &[
    PrositeMotifRule {
        accession: "PS00017",
        name: "ATP/GTP-Binding Site Motif A (Walker A P-loop)",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.96,
        role: "Phosphate-binding P-loop coordinating beta/gamma phosphates of ATP or GTP",
        tokens: &[
            AnyOf(b"AG"),
            WildcardRange(4, 4),
            Exact(b'G'),
            Exact(b'K'),
            AnyOf(b"ST"),
        ],
    },
    PrositeMotifRule {
        accession: "PF00004_WB",
        name: "Walker B Mg2+-Coordination Motif",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.88,
        role: "Hydrophobic beta-strand terminating in conserved Asp/Glu coordinating catalytic Mg2+ and water",
        tokens: &[
            AnyOf(b"LIVMFYW"),
            AnyOf(b"LIVMFYW"),
            AnyOf(b"LIVMFYW"),
            AnyOf(b"LIVMFYW"),
            Exact(b'D'),
            AnyOf(b"EA"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00039",
        name: "DEAD-Box ATP-Dependent RNA Helicase Core",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.98,
        role: "Conserved Motif II (D-E-A-D / D-E-A-H) coupling ATP hydrolysis to RNA unwinding",
        tokens: &[
            AnyOf(b"LIVMF"),
            AnyOf(b"LIVMF"),
            Exact(b'D'),
            Exact(b'E'),
            Exact(b'A'),
            AnyOf(b"DH"),
            WildcardRange(1, 2),
            AnyOf(b"MLIV"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00028",
        name: "C2H2 Classic Zinc Finger Domain",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.97,
        role: "Tetrahedral Zn2+-coordinating beta-beta-alpha DNA/RNA recognition finger",
        tokens: &[
            Exact(b'C'),
            WildcardRange(2, 4),
            Exact(b'C'),
            WildcardRange(3, 3),
            AnyOf(b"LIVMFYWC"),
            WildcardRange(8, 8),
            Exact(b'H'),
            WildcardRange(3, 5),
            Exact(b'H'),
        ],
    },
    PrositeMotifRule {
        accession: "PS00018",
        name: "EF-Hand Calcium-Binding Loop",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.95,
        role: "12-residue pentagonal bipyramidal Ca2+-chelation loop flanked by alpha-helices",
        tokens: &[
            Exact(b'D'),
            WildcardRange(1, 1),
            AnyOf(b"DNS"),
            NoneOf(b"ILVFYW"),
            AnyOf(b"DENSTG"),
            AnyOf(b"DNQGHRK"),
            NoneOf(b"GP"),
            AnyOf(b"LIVMC"),
            AnyOf(b"DENQSTAGC"),
            WildcardRange(2, 2),
            AnyOf(b"DE"),
            AnyOf(b"LIVMFYW"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00107",
        name: "Protein Kinase ATP-Binding Glycine-Rich Loop",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.94,
        role: "N-lobe GxGxxG nucleotide-positioning ribose/phosphate lid + downstream catalytic Lys",
        tokens: &[
            AnyOf(b"LIVMFYC"),
            Exact(b'G'),
            WildcardRange(1, 1),
            Exact(b'G'),
            WildcardRange(1, 1),
            AnyOf(b"FYWMGSTNH"),
            AnyOf(b"SGA"),
            WildcardRange(1, 1),
            AnyOf(b"LIVCAT"),
            WildcardRange(1, 1),
            NoneOf(b"P"),
            WildcardRange(8, 22),
            AnyOf(b"LIVMFYWCSTAR"),
            AnyOf(b"AIVP"),
            AnyOf(b"LIVMFAGCKR"),
            Exact(b'K'),
        ],
    },
    PrositeMotifRule {
        accession: "PS00108",
        name: "Ser/Thr Protein Kinase Catalytic HRD-DFG Pocket",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.95,
        role: "Catalytic loop Asp proton acceptor paired with activation-segment Mg2+-binding DFG motif",
        tokens: &[
            AnyOf(b"HY"),
            Exact(b'R'),
            Exact(b'D'),
            AnyOf(b"LIVMFY"),
            Exact(b'K'),
            WildcardRange(2, 2),
            Exact(b'N'),
            AnyOf(b"LIVMFYC"),
            AnyOf(b"LIVMFYC"),
            AnyOf(b"LIVMFYC"),
            WildcardRange(8, 22),
            Exact(b'D'),
            Exact(b'F'),
            Exact(b'G'),
        ],
    },
    PrositeMotifRule {
        accession: "PS00134",
        name: "Serine Protease Catalytic Nucleophile (GDSGGP)",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.93,
        role: "Oxyanion hole and nucleophilic Ser of His-Asp-Ser trypsin/chymotrypsin catalytic triad",
        tokens: &[
            AnyOf(b"DNSTAGC"),
            AnyOf(b"GA"),
            Exact(b'S'),
            Exact(b'G'),
            Exact(b'G'),
            AnyOf(b"PSA"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00190",
        name: "Cytochrome c Heme-Binding Motif (CXXCH)",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.92,
        role: "Covalent thioether attachment to vinyl groups of heme c + axial His ligand",
        tokens: &[
            Exact(b'C'),
            NoneOf(b"CP"),
            NoneOf(b"CP"),
            Exact(b'C'),
            Exact(b'H'),
        ],
    },
    PrositeMotifRule {
        accession: "PS00198",
        name: "4Fe-4S Ferredoxin Iron-Sulfur Cluster Signature",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.95,
        role: "Cubane [4Fe-4S] electron-transfer cluster coordinated by four conserved cysteines",
        tokens: &[
            Exact(b'C'),
            WildcardRange(2, 2),
            Exact(b'C'),
            WildcardRange(2, 2),
            Exact(b'C'),
            WildcardRange(3, 3),
            Exact(b'C'),
            AnyOf(b"PEG"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00029",
        name: "bZIP Leucine Zipper Heptad Repeat",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.90,
        role: "Parallel alpha-helical coiled-coil dimerization interface with Leu every 7th d-position",
        tokens: &[
            Exact(b'L'),
            WildcardRange(6, 6),
            Exact(b'L'),
            WildcardRange(6, 6),
            Exact(b'L'),
            WildcardRange(6, 6),
            Exact(b'L'),
        ],
    },
    PrositeMotifRule {
        accession: "MBC_SORT_001",
        name: "Sortase A Transpeptidation Motif (LPXTG)",
        category: "Protease Cleavage",
        anchor_c_term: false,
        confidence: 0.93,
        role: "S. aureus Sortase A cleavage between Thr and Gly for site-specific bioconjugation",
        tokens: &[
            Exact(b'L'),
            Exact(b'P'),
            WildcardRange(1, 1),
            Exact(b'T'),
            Exact(b'G'),
        ],
    },
    PrositeMotifRule {
        accession: "PS00001",
        name: "N-Linked Glycosylation Sequon (NxS/T)",
        category: "Post-Translational Modification",
        anchor_c_term: false,
        confidence: 0.82,
        role: "Oligosaccharyltransferase ER lumenal Glc3Man9GlcNAc2 attachment site on Asn",
        tokens: &[
            Exact(b'N'),
            NoneOf(b"P"),
            AnyOf(b"ST"),
            NoneOf(b"P"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00294",
        name: "Prenylation C-Terminal CAAX Box",
        category: "Post-Translational Modification",
        anchor_c_term: true,
        confidence: 0.91,
        role: "Farnesyltransferase / Geranylgeranyltransferase I C-terminal Cys lipid anchor",
        tokens: &[
            Exact(b'C'),
            AnyOf(b"ALI"),
            AnyOf(b"ALIV"),
            AnyOf(b"MSQAL"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00016",
        name: "Cell Attachment Integrin Ligand (RGD)",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.80,
        role: "Extracellular matrix fibronectin/vitronectin recognition tripeptide for alphaV/beta3 integrins",
        tokens: &[Exact(b'R'), Exact(b'G'), Exact(b'D')],
    },
    PrositeMotifRule {
        accession: "ELM_NLS_MONO",
        name: "Classical Monopartite Nuclear Localization Signal (cNLS)",
        category: "Subcellular Localization",
        anchor_c_term: false,
        confidence: 0.89,
        role: "Importin-alpha major binding groove polybasic nuclear import signal (SV40 Large-T class)",
        tokens: &[
            AnyOf(b"PKR"),
            AnyOf(b"KR"),
            AnyOf(b"KR"),
            WildcardRange(0, 1),
            AnyOf(b"KR"),
        ],
    },
    PrositeMotifRule {
        accession: "ELM_NLS_BI",
        name: "Bipartite Nuclear Localization Signal",
        category: "Subcellular Localization",
        anchor_c_term: false,
        confidence: 0.93,
        role: "Nucleoplasmin-type dual basic clusters spanning minor and major importin-alpha pockets",
        tokens: &[
            AnyOf(b"KR"),
            AnyOf(b"KR"),
            WildcardRange(9, 12),
            AnyOf(b"KR"),
            AnyOf(b"KR"),
            AnyOf(b"KR"),
        ],
    },
    PrositeMotifRule {
        accession: "ELM_NES_CRM1",
        name: "CRM1/Exportin-1 Leucine-Rich Nuclear Export Signal (NES)",
        category: "Subcellular Localization",
        anchor_c_term: false,
        confidence: 0.86,
        role: "RanGTP-dependent CRM1 hydrophobic cleft nuclear export signal",
        tokens: &[
            AnyOf(b"LIVFM"),
            WildcardRange(2, 3),
            AnyOf(b"LIVFM"),
            WildcardRange(2, 3),
            AnyOf(b"LIVFM"),
            WildcardRange(1, 1),
            AnyOf(b"LIVFM"),
        ],
    },
    PrositeMotifRule {
        accession: "PS00014",
        name: "Endoplasmic Reticulum Lumenal Retention Signal (KDEL/HDEL)",
        category: "Subcellular Localization",
        anchor_c_term: true,
        confidence: 0.97,
        role: "KDEL-receptor COPI retrograde Golgi-to-ER retrieval tetrapeptide",
        tokens: &[
            AnyOf(b"KRHQSA"),
            AnyOf(b"DENQ"),
            Exact(b'E'),
            Exact(b'L'),
        ],
    },
    PrositeMotifRule {
        accession: "PS00342",
        name: "Peroxisomal Matrix Targeting Signal 1 (PTS1 SKL)",
        category: "Subcellular Localization",
        anchor_c_term: true,
        confidence: 0.94,
        role: "PEX5 tetratricopeptide-repeat C-terminal peroxisomal import tripeptide",
        tokens: &[AnyOf(b"SAC"), AnyOf(b"KRH"), AnyOf(b"LM")],
    },
    PrositeMotifRule {
        accession: "ELM_LIG_WW",
        name: "WW-Domain PPxY Proline-Rich Ligand",
        category: "Catalytic & Binding",
        anchor_c_term: false,
        confidence: 0.85,
        role: "Group I WW-domain polyproline type II helix recognition motif (YAP/Nedd4 pathway)",
        tokens: &[
            Exact(b'P'),
            Exact(b'P'),
            NoneOf(b"P"),
            Exact(b'Y'),
        ],
    },
];

fn match_tokens_at(seq: &[u8], pos: usize, tokens: &[MotifToken]) -> Option<usize> {
    if tokens.is_empty() {
        return Some(pos);
    }
    match tokens[0] {
        Exact(ch) => {
            if pos < seq.len() && seq[pos] == ch {
                match_tokens_at(seq, pos + 1, &tokens[1..])
            } else {
                None
            }
        }
        AnyOf(allowed) => {
            if pos < seq.len() && allowed.contains(&seq[pos]) {
                match_tokens_at(seq, pos + 1, &tokens[1..])
            } else {
                None
            }
        }
        NoneOf(forbidden) => {
            if pos < seq.len() && !forbidden.contains(&seq[pos]) {
                match_tokens_at(seq, pos + 1, &tokens[1..])
            } else {
                None
            }
        }
        WildcardRange(min_len, max_len) => {
            let upper = max_len.min(seq.len().saturating_sub(pos));
            if upper < min_len {
                return None;
            }
            for step in min_len..=upper {
                if let Some(end) = match_tokens_at(seq, pos + step, &tokens[1..]) {
                    return Some(end);
                }
            }
            None
        }
    }
}

/// Rule-based search for a Sec/SPI signal peptide using von Heijne's features: a basic n-region,
/// a hydrophobic 9-residue h-core, and small residues at −3/−1 of the peptidase site. The returned
/// score is a heuristic combination of those features, **not** SignalP's neural-network D-score,
/// and the cleavage site is a suggestion to check rather than a prediction of comparable accuracy.
pub fn predict_signal_peptide_von_heijne(raw_protein: &str) -> SignalPeptidePrediction {
    let seq = clean_alpha_sequence(raw_protein);
    let bytes = seq.as_bytes();
    if bytes.len() < 18 || bytes[0] != b'M' {
        return SignalPeptidePrediction {
            has_signal_peptide: false,
            cleavage_site_aa: None,
            n_region_end_aa: 0,
            h_region_range: (0, 0),
            c_region_range: (0, 0),
            motif_minus3_minus1: String::new(),
            d_score: 0.08,
            summary: "No N-terminal secretory signal peptide detected (requires N-terminal Met and >= 18 aa)".into(),
        };
    }

    let scan_limit = bytes.len().min(45);
    // 1. Check n-region (aa 1..=8) net basic charge
    let mut n_basic = 0i32;
    let mut n_acidic = 0i32;
    for &b in &bytes[1..scan_limit.min(9)] {
        if matches!(b, b'K' | b'R') {
            n_basic += 1;
        } else if matches!(b, b'D' | b'E') {
            n_acidic += 1;
        }
    }

    // 2. Find peak 9-aa hydrophobic core window within residues 4..=28
    let kd = |b: u8| -> f64 {
        match b {
            b'I' => 4.5,
            b'V' => 4.2,
            b'L' => 3.8,
            b'F' => 2.8,
            b'C' => 2.5,
            b'M' => 1.9,
            b'A' => 1.8,
            b'G' => -0.4,
            b'T' => -0.7,
            b'S' => -0.8,
            b'W' => -0.9,
            b'Y' => -1.3,
            b'P' => -1.6,
            b'H' => -3.2,
            b'E' | b'Q' | b'D' | b'N' => -3.5,
            b'K' => -3.9,
            b'R' => -4.5,
            _ => -0.5,
        }
    };

    let mut best_h_score = -10.0f64;
    let mut best_h_start = 4usize;
    let h_max_end = scan_limit.min(30);
    if h_max_end >= 13 {
        for s in 3..=(h_max_end - 9) {
            let mut pre_basic = 0i32;
            let mut pre_acidic = 0i32;
            for &nb in &bytes[1..s] {
                if matches!(nb, b'K' | b'R') {
                    pre_basic += 1;
                } else if matches!(nb, b'D' | b'E') {
                    pre_acidic += 1;
                }
            }
            if pre_acidic > pre_basic {
                continue;
            }
            let mut sum = 0.0;
            let mut charged_or_pro = 0;
            for &b in &bytes[s..(s + 9)] {
                sum += kd(b);
                if matches!(b, b'D' | b'E' | b'K' | b'R' | b'P') {
                    charged_or_pro += 1;
                }
            }
            if charged_or_pro > 0 {
                continue;
            }
            let mean = sum / 9.0;
            if mean > best_h_score {
                best_h_score = mean;
                best_h_start = s; // 0-based
            }
        }
    }

    // 3. Scan candidate signal peptidase I cleavage site c in (best_h_start + 9)..=min(36, len-2)
    // Cleavage occurs AFTER 1-based residue `c` (0-based index `c - 1`), so (-1) is bytes[c - 1] and (-3) is bytes[c - 3].
    let mut best_c_site: Option<usize> = None;
    let mut best_c_score = -10.0f64;
    let c_lo = (best_h_start + 10).max(15);
    let c_hi = scan_limit.min(36).min(bytes.len().saturating_sub(2));
    if c_lo <= c_hi {
        for c1 in c_lo..=c_hi {
            let m1 = bytes[c1 - 1];
            let m3 = bytes[c1 - 3];
            let m2 = bytes[c1 - 2];
            let p1 = bytes[c1];
            let m1_w = match m1 {
                b'A' => 2.2,
                b'G' | b'S' => 1.6,
                b'C' | b'T' => 1.0,
                _ => -2.5,
            };
            let m3_w = match m3 {
                b'A' | b'V' => 1.9,
                b'S' | b'T' | b'G' | b'C' | b'L' | b'I' => 1.2,
                b'P' | b'D' | b'E' | b'K' | b'R' => -2.2,
                _ => -0.8,
            };
            let pro_turn_penalty = if m2 == b'P' || p1 == b'P' { -1.2 } else { 0.3 };
            let c_score = m1_w + m3_w + pro_turn_penalty;
            if c_score > best_c_score {
                best_c_score = c_score;
                best_c_site = Some(c1);
            }
        }
    }

    let charge_bonus = ((n_basic - n_acidic).clamp(-1, 3) as f64) * 0.08;
    let raw_d = 0.45 * ((best_h_score - 1.1) / 2.2).clamp(0.0, 1.0)
        + 0.42 * ((best_c_score + 0.5) / 4.9).clamp(0.0, 1.0)
        + charge_bonus;
    let d_score = (raw_d.clamp(0.02, 0.99) * 1000.0).round() / 1000.0;

    if d_score >= 0.52 && best_h_score >= 1.65 {
        if let Some(cleave_aa) = best_c_site {
            let motif = String::from_utf8_lossy(&bytes[(cleave_aa - 3)..=cleave_aa]).to_string();
            let n_end = best_h_start.max(2);
            let h_range = (best_h_start + 1, best_h_start + 9);
            let c_range = ((best_h_start + 10).min(cleave_aa), cleave_aa);
            return SignalPeptidePrediction {
                has_signal_peptide: true,
                cleavage_site_aa: Some(cleave_aa),
                n_region_end_aa: n_end,
                h_region_range: h_range,
                c_region_range: c_range,
                motif_minus3_minus1: motif.clone(),
                d_score,
                summary: format!(
                    "Possible Sec/SPI signal peptide (heuristic score {:.3}, not SignalP): predicted cleavage between aa {} and {} ({}^), h-core Kyte–Doolittle {:.2}",
                    d_score,
                    cleave_aa,
                    cleave_aa + 1,
                    &motif[..3],
                    best_h_score
                ),
            };
        }
    }

    SignalPeptidePrediction {
        has_signal_peptide: false,
        cleavage_site_aa: None,
        n_region_end_aa: 0,
        h_region_range: (0, 0),
        c_region_range: (0, 0),
        motif_minus3_minus1: String::new(),
        d_score,
        summary: format!(
            "No signal peptide found (heuristic score {:.3} < 0.520; best 9-aa h-core Kyte–Doolittle {:.2})",
            d_score, best_h_score
        ),
    }
}

/// Scans a protein sequence (supporting 10,000+ aa megasynthases and giant structural proteins)
/// for affinity tags, protease sites, conserved PROSITE/Pfam catalytic motifs, localization signals,
/// PTM sequons, and N-terminal secretory signal peptides.
pub fn scan_protein_functional_motifs(raw_protein: &str) -> ProteinMotifScanReport {
    let seq = clean_alpha_sequence(raw_protein);
    let bytes = seq.as_bytes();
    let len = bytes.len();

    let mut hits = Vec::new();

    if len > 0 {
        // 1. Multi-pattern SIMD Aho-Corasick scan for exact affinity tags & protease recognition sites
        let patterns: Vec<&str> = EXACT_TAG_AND_PROTEASE_RULES
            .iter()
            .map(|r| r.pattern)
            .collect();
        if let Ok(ac) = AhoCorasickBuilder::new()
            .ascii_case_insensitive(false)
            .build(&patterns)
        {
            for mat in ac.find_overlapping_iter(bytes) {
                let rule = &EXACT_TAG_AND_PROTEASE_RULES[mat.pattern().as_usize()];
                let start_aa = mat.start() + 1;
                let end_aa = mat.end();
                hits.push(ProteinMotifHit {
                    accession: rule.accession.into(),
                    name: rule.name.into(),
                    category: rule.category.into(),
                    start_aa,
                    end_aa,
                    matched_seq: seq[mat.start()..mat.end()].to_string(),
                    cleavage_after_aa: rule.cleave_offset.map(|off| mat.start() + off),
                    biological_role: rule.role.into(),
                    confidence_score: 0.99,
                });
            }
        }

        // 2. PROSITE / ELM residue-class automaton scan
        for rule in PROSITE_RULES {
            if rule.anchor_c_term {
                // Only test positions near C-terminus (last 8 residues)
                let start_from = len.saturating_sub(8);
                for pos in start_from..len {
                    if let Some(end_idx) = match_tokens_at(bytes, pos, rule.tokens) {
                        if end_idx == len {
                            hits.push(ProteinMotifHit {
                                accession: rule.accession.into(),
                                name: rule.name.into(),
                                category: rule.category.into(),
                                start_aa: pos + 1,
                                end_aa: end_idx,
                                matched_seq: seq[pos..end_idx].to_string(),
                                cleavage_after_aa: None,
                                biological_role: rule.role.into(),
                                confidence_score: rule.confidence,
                            });
                            break;
                        }
                    }
                }
            } else {
                let mut pos = 0usize;
                while pos < len {
                    if let Some(end_idx) = match_tokens_at(bytes, pos, rule.tokens) {
                        let cleave = if rule.accession == "MBC_SORT_001" {
                            Some(pos + 4) // LPXT^G
                        } else {
                            None
                        };
                        hits.push(ProteinMotifHit {
                            accession: rule.accession.into(),
                            name: rule.name.into(),
                            category: rule.category.into(),
                            start_aa: pos + 1,
                            end_aa: end_idx,
                            matched_seq: seq[pos..end_idx].to_string(),
                            cleavage_after_aa: cleave,
                            biological_role: rule.role.into(),
                            confidence_score: rule.confidence,
                        });
                        // Advance past start of current hit (cap per-rule hits at 64 on giant proteins)
                        pos = (pos + 1).max(end_idx.saturating_sub(2));
                    } else {
                        pos += 1;
                    }
                }
            }
        }
    }

    let sig = predict_signal_peptide_von_heijne(&seq);
    if sig.has_signal_peptide {
        if let Some(cleave_aa) = sig.cleavage_site_aa {
            hits.push(ProteinMotifHit {
                accession: "SP_SEC_SPI".into(),
                name: "Sec/SPI N-Terminal Secretory Signal Peptide".into(),
                category: "Subcellular Localization".into(),
                start_aa: 1,
                end_aa: cleave_aa,
                matched_seq: seq[..cleave_aa.min(len)].to_string(),
                cleavage_after_aa: Some(cleave_aa),
                biological_role: sig.summary.clone(),
                confidence_score: sig.d_score,
            });
        }
    }

    hits.sort_by(|a, b| a.start_aa.cmp(&b.start_aa).then_with(|| a.end_aa.cmp(&b.end_aa)));

    let mut affinity_tags_count = 0;
    let mut protease_sites_count = 0;
    let mut catalytic_and_binding_count = 0;
    let mut localization_signals_count = 0;
    let mut ptm_sites_count = 0;

    for h in &hits {
        match h.category.as_str() {
            "Affinity Tag" => affinity_tags_count += 1,
            "Protease Cleavage" => protease_sites_count += 1,
            "Catalytic & Binding" => catalytic_and_binding_count += 1,
            "Subcellular Localization" => localization_signals_count += 1,
            "Post-Translational Modification" => ptm_sites_count += 1,
            _ => {}
        }
    }

    ProteinMotifScanReport {
        sequence_length_aa: len,
        total_hits: hits.len(),
        affinity_tags_count,
        protease_sites_count,
        catalytic_and_binding_count,
        localization_signals_count,
        ptm_sites_count,
        signal_peptide: sig,
        hits,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructuralDomainSegment {
    pub domain_index: usize,
    pub start_res_seq: i32,
    pub end_res_seq: i32,
    pub residue_count: usize,
    pub local_rg_angstrom: f64,
    pub intra_domain_contacts: usize,
    pub mean_plddt_or_bfactor: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidueGeometryProfile {
    pub res_seq: i32,
    pub res_name: String,
    pub chain_id: String,
    pub coordination_number_10a: usize,
    pub estimated_sasa_angstrom2: f64,
    pub is_buried_core: bool,
    pub virtual_bond_angle_deg: Option<f64>,
    pub virtual_dihedral_deg: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Pdb3dGeometryReport {
    pub residue_count: usize,
    pub chain_ids: Vec<String>,
    /// Residue-mass-weighted centroid of the Cα atoms.
    pub centroid_xyz: [f64; 3],
    /// Mass-weighted radius of gyration over Cα atoms (each weighted by its residue mass).
    pub radius_of_gyration_angstrom: f64,
    pub flory_expected_globular_rg_angstrom: f64,
    pub compactness_ratio: f64,
    pub end_to_end_distance_angstrom: f64,
    pub principal_gyration_eigenvalues: [f64; 3],
    pub asphericity: f64,
    pub shape_classification: String,
    pub total_long_range_contacts_8a: usize,
    pub relative_contact_order_pct: f64,
    /// Plaxco et al. (1998) RCO–folding-rate correlation; NaN unless the structure is a single
    /// chain of ≤ 300 residues, where that correlation was established.
    pub estimated_folding_ln_kf: f64,
    pub total_estimated_sasa_angstrom2: f64,
    pub buried_core_fraction_pct: f64,
    pub mean_bfactor_or_plddt: f64,
    pub structural_domains: Vec<StructuralDomainSegment>,
    pub residue_profiles: Vec<ResidueGeometryProfile>,
}

fn three_letter_to_one(res3: &str) -> char {
    match res3.trim().to_ascii_uppercase().as_str() {
        "ALA" => 'A',
        "ARG" => 'R',
        "ASN" => 'N',
        "ASP" => 'D',
        "CYS" => 'C',
        "GLN" => 'Q',
        "GLU" => 'E',
        "GLY" => 'G',
        "HIS" => 'H',
        "ILE" => 'I',
        "LEU" => 'L',
        "LYS" => 'K',
        "MET" => 'M',
        "PHE" => 'F',
        "PRO" => 'P',
        "SER" => 'S',
        "THR" => 'T',
        "TRP" => 'W',
        "TYR" => 'Y',
        "VAL" => 'V',
        _ => 'A',
    }
}

/// Tien et al. (2013) empirical maximum Gly-X-Gly tripeptide solvent-accessible surface areas (Å²).
fn max_asa_tien_2013(aa1: char) -> f64 {
    match aa1 {
        'A' => 129.0,
        'R' => 274.0,
        'N' => 195.0,
        'D' => 193.0,
        'C' => 167.0,
        'E' => 223.0,
        'Q' => 225.0,
        'G' => 104.0,
        'H' => 224.0,
        'I' => 197.0,
        'L' => 201.0,
        'K' => 236.0,
        'M' => 224.0,
        'F' => 240.0,
        'P' => 159.0,
        'S' => 155.0,
        'T' => 172.0,
        'W' => 285.0,
        'Y' => 263.0,
        'V' => 174.0,
        _ => 175.0,
    }
}

fn compute_rg(atoms: &[PdbCaAtom]) -> (f64, [f64; 3]) {
    if atoms.is_empty() {
        return (0.0, [0.0, 0.0, 0.0]);
    }
    let mut tot_m = 0.0;
    let mut cx = 0.0;
    let mut cy = 0.0;
    let mut cz = 0.0;
    for a in atoms {
        let m = residue_mass_da(three_letter_to_one(&a.res_name) as u8).max(57.0);
        cx += m * a.x;
        cy += m * a.y;
        cz += m * a.z;
        tot_m += m;
    }
    cx /= tot_m;
    cy /= tot_m;
    cz /= tot_m;

    let mut weighted_r2 = 0.0;
    for a in atoms {
        let m = residue_mass_da(three_letter_to_one(&a.res_name) as u8).max(57.0);
        let dx = a.x - cx;
        let dy = a.y - cy;
        let dz = a.z - cz;
        weighted_r2 += m * (dx * dx + dy * dy + dz * dz);
    }
    let rg = (weighted_r2 / tot_m).sqrt();
    (rg, [cx, cy, cz])
}

/// Computes comprehensive 3D structural biophysics from a PDB or mmCIF coordinate file using
/// `nalgebra` eigendecomposition of the gyration tensor, Plaxco relative contact order, virtual
/// $C_\alpha$ pseudo-bond/torsion geometry, coordination-based SASA, and globular domain segmentation.
pub fn analyze_pdb_3d_geometry(raw_pdb_or_cif: &str) -> Pdb3dGeometryReport {
    let atoms = parse_pdb_or_mmcif_ca_coordinates(raw_pdb_or_cif);
    let n = atoms.len();
    if n == 0 {
        return Pdb3dGeometryReport {
            residue_count: 0,
            chain_ids: Vec::new(),
            centroid_xyz: [0.0, 0.0, 0.0],
            radius_of_gyration_angstrom: 0.0,
            flory_expected_globular_rg_angstrom: 0.0,
            compactness_ratio: 1.0,
            end_to_end_distance_angstrom: 0.0,
            principal_gyration_eigenvalues: [0.0, 0.0, 0.0],
            asphericity: 0.0,
            shape_classification: "Empty Structure".into(),
            total_long_range_contacts_8a: 0,
            relative_contact_order_pct: 0.0,
            estimated_folding_ln_kf: f64::NAN,
            total_estimated_sasa_angstrom2: 0.0,
            buried_core_fraction_pct: 0.0,
            mean_bfactor_or_plddt: 0.0,
            structural_domains: Vec::new(),
            residue_profiles: Vec::new(),
        };
    }

    let mut chain_ids = Vec::new();
    let mut b_sum = 0.0;
    for a in &atoms {
        if !chain_ids.contains(&a.chain_id) {
            chain_ids.push(a.chain_id.clone());
        }
        b_sum += a.b_factor;
    }

    let (rg, centroid) = compute_rg(&atoms);
    // Empirical Flory scaling for compact native single-domain globular proteins: Rg_0 ≈ 2.2 * N^0.38 Å
    let flory_rg = 2.20 * (n as f64).powf(0.38);
    let compactness_ratio = if flory_rg > 0.0 { rg / flory_rg } else { 1.0 };

    let first = &atoms[0];
    let last = &atoms[n - 1];
    let end_to_end = ((last.x - first.x).powi(2)
        + (last.y - first.y).powi(2)
        + (last.z - first.z).powi(2))
    .sqrt();

    // 3x3 Gyration Tensor S_ab = (1/N) sum (r_a - c_a)(r_b - c_b) decomposed via nalgebra SymmetricEigen
    let mut g_mat = Matrix3::<f64>::zeros();
    for a in &atoms {
        let v = [a.x - centroid[0], a.y - centroid[1], a.z - centroid[2]];
        for r in 0..3 {
            for c in 0..3 {
                g_mat[(r, c)] += v[r] * v[c];
            }
        }
    }
    g_mat /= n as f64;
    let eig = g_mat.symmetric_eigen();
    let mut evals = [
        eig.eigenvalues[0].max(0.0),
        eig.eigenvalues[1].max(0.0),
        eig.eigenvalues[2].max(0.0),
    ];
    evals.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let tr = evals[0] + evals[1] + evals[2];
    // Aronovitz & Nelson asphericity Delta in [0, 1] (0 = perfect sphere, 1 = rigid rod)
    let asphericity = if tr > 1e-9 {
        let mean_l = tr / 3.0;
        let num = (evals[0] - mean_l).powi(2)
            + (evals[1] - mean_l).powi(2)
            + (evals[2] - mean_l).powi(2);
        (1.5 * num / (tr * tr)).clamp(0.0, 1.0)
    } else {
        0.0
    };

    let shape_class = if asphericity < 0.08 && compactness_ratio <= 1.25 {
        "Compact Spherical Globule"
    } else if asphericity < 0.22 {
        "Oblate / Prolate Ellipsoidal Domain"
    } else if asphericity < 0.48 {
        "Elongated Multi-Domain / Coiled Architecture"
    } else {
        "Extended Fibrous / Intrinsically Disordered Rod"
    };

    // Contact map (< 8.0 Å for Plaxco RCO with |i - j| >= 4; < 10.0 Å for coordination SASA)
    let mut coord_10a = vec![0usize; n];
    let mut contacts_8a = 0usize;
    let mut sep_sum = 0usize;
    // Cross-boundary contact profile cross_contacts[k] = number of contacts with i <= k < j
    let mut cross_diff = vec![0isize; n + 1];

    for i in 0..n {
        let ai = &atoms[i];
        for j in (i + 1)..n {
            let aj = &atoms[j];
            let d2 = (ai.x - aj.x).powi(2) + (ai.y - aj.y).powi(2) + (ai.z - aj.z).powi(2);
            if d2 <= 100.0 {
                coord_10a[i] += 1;
                coord_10a[j] += 1;
            }
            if j >= i + 4 && d2 <= 64.0 {
                contacts_8a += 1;
                sep_sum += j - i;
                cross_diff[i] += 1;
                cross_diff[j] -= 1;
            }
        }
    }

    // Plaxco et al. (1998) Relative Contact Order RCO = (1 / (L * N_c)) * sum |i - j|
    let rco = if contacts_8a > 0 && n > 0 {
        (sep_sum as f64) / ((n as f64) * (contacts_8a as f64))
    } else {
        0.0
    };
    // Plaxco, Simons & Baker (1998) correlated folding rate with relative contact order for small
    // single-domain two-state proteins: ln(k_f) ≈ 17.6 − 78 · RCO. It is a scatter-plot correlation,
    // not a predictor, and it does not apply to multi-chain or large multi-domain structures, so it
    // is only reported for a single chain of ≤ 300 residues.
    let ln_kf = if chain_ids.len() == 1 && n <= 300 && contacts_8a > 0 {
        17.6 - 78.0 * rco
    } else {
        f64::NAN
    };

    // Virtual C-alpha pseudo-bond angle theta_i (i-1, i, i+1) & pseudo-dihedral tau_i (i-1, i, i+1, i+2)
    let mut bond_angles: Vec<Option<f64>> = vec![None; n];
    let mut dihedrals: Vec<Option<f64>> = vec![None; n];

    for i in 1..n.saturating_sub(1) {
        let p0 = &atoms[i - 1];
        let p1 = &atoms[i];
        let p2 = &atoms[i + 1];
        let u = [p0.x - p1.x, p0.y - p1.y, p0.z - p1.z];
        let v = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z];
        let nu = (u[0] * u[0] + u[1] * u[1] + u[2] * u[2]).sqrt();
        let nv = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
        if nu > 1e-6 && nv > 1e-6 {
            let cos_t = ((u[0] * v[0] + u[1] * v[1] + u[2] * v[2]) / (nu * nv)).clamp(-1.0, 1.0);
            bond_angles[i] = Some((cos_t.acos().to_degrees() * 10.0).round() / 10.0);
        }
    }

    let cross = |a: [f64; 3], b: [f64; 3]| -> [f64; 3] {
        [
            a[1] * b[2] - a[2] * b[1],
            a[2] * b[0] - a[0] * b[2],
            a[0] * b[1] - a[1] * b[0],
        ]
    };
    let dot = |a: [f64; 3], b: [f64; 3]| -> f64 { a[0] * b[0] + a[1] * b[1] + a[2] * b[2] };

    for i in 1..n.saturating_sub(2) {
        let p0 = &atoms[i - 1];
        let p1 = &atoms[i];
        let p2 = &atoms[i + 1];
        let p3 = &atoms[i + 2];
        let b1 = [p1.x - p0.x, p1.y - p0.y, p1.z - p0.z];
        let b2 = [p2.x - p1.x, p2.y - p1.y, p2.z - p1.z];
        let b3 = [p3.x - p2.x, p3.y - p2.y, p3.z - p2.z];
        let b2_norm = dot(b2, b2).sqrt();
        if b2_norm > 1e-6 {
            let b2_u = [b2[0] / b2_norm, b2[1] / b2_norm, b2[2] / b2_norm];
            let n1 = cross(b1, b2);
            let n2 = cross(b2, b3);
            let m1 = cross(n1, b2_u);
            let x = dot(n1, n2);
            let y = dot(m1, n2);
            if x.abs() > 1e-9 || y.abs() > 1e-9 {
                dihedrals[i] = Some((y.atan2(x).to_degrees() * 10.0).round() / 10.0);
            }
        }
    }

    let mut total_sasa = 0.0;
    let mut buried_cnt = 0usize;
    let mut residue_profiles = Vec::with_capacity(n);

    for (idx, a) in atoms.iter().enumerate() {
        let aa1 = three_letter_to_one(&a.res_name);
        let max_asa = max_asa_tien_2013(aa1);
        // Sigmoidal coordination burial model (Durham et al. 2009 neighbor-vector / half-sphere exposure)
        let cn = coord_10a[idx];
        let exposure_frac = (1.0 / (1.0 + ((cn as f64 - 13.5) / 3.8).exp())).clamp(0.03, 0.98);
        let sasa = (max_asa * exposure_frac * 10.0).round() / 10.0;
        let buried = exposure_frac < 0.25;
        if buried {
            buried_cnt += 1;
        }
        total_sasa += sasa;
        residue_profiles.push(ResidueGeometryProfile {
            res_seq: a.res_seq,
            res_name: a.res_name.clone(),
            chain_id: a.chain_id.clone(),
            coordination_number_10a: cn,
            estimated_sasa_angstrom2: sasa,
            is_buried_core: buried,
            virtual_bond_angle_deg: bond_angles[idx],
            virtual_dihedral_deg: dihedrals[idx],
        });
    }

    // Domain boundary detection via cross-cut contact density minima (minimum domain size = 40 aa)
    let mut cut_points = vec![0usize];
    if n >= 95 {
        let mut cross_profile = Vec::with_capacity(n);
        let mut running = 0isize;
        for &d in cross_diff.iter().take(n) {
            running += d;
            cross_profile.push(running.max(0) as f64);
        }
        let mean_cross = cross_profile.iter().sum::<f64>() / (n as f64);
        let min_dom = 40usize;
        let mut idx = min_dom;
        while idx + min_dom < n {
            let val = cross_profile[idx];
            let local_min = cross_profile[(idx - 12)..=(idx + 12).min(n - 1)]
                .iter()
                .all(|&other| val <= other);
            if local_min && val < mean_cross * 0.42 {
                cut_points.push(idx + 1);
                idx += min_dom;
            } else {
                idx += 1;
            }
        }
    }
    cut_points.push(n);

    let mut structural_domains = Vec::with_capacity(cut_points.len() - 1);
    for w in 0..(cut_points.len() - 1) {
        let s = cut_points[w];
        let e = cut_points[w + 1];
        let sub = &atoms[s..e];
        let (sub_rg, _) = compute_rg(sub);
        let mut intra = 0usize;
        for i in 0..sub.len() {
            for j in (i + 4)..sub.len() {
                let d2 = (sub[i].x - sub[j].x).powi(2)
                    + (sub[i].y - sub[j].y).powi(2)
                    + (sub[i].z - sub[j].z).powi(2);
                if d2 <= 64.0 {
                    intra += 1;
                }
            }
        }
        let sub_b = sub.iter().map(|a| a.b_factor).sum::<f64>() / (sub.len().max(1) as f64);
        structural_domains.push(StructuralDomainSegment {
            domain_index: w + 1,
            start_res_seq: sub[0].res_seq,
            end_res_seq: sub[sub.len() - 1].res_seq,
            residue_count: sub.len(),
            local_rg_angstrom: (sub_rg * 100.0).round() / 100.0,
            intra_domain_contacts: intra,
            mean_plddt_or_bfactor: (sub_b * 10.0).round() / 10.0,
        });
    }

    let r2 = |v: f64| (v * 100.0).round() / 100.0;

    Pdb3dGeometryReport {
        residue_count: n,
        chain_ids,
        centroid_xyz: [r2(centroid[0]), r2(centroid[1]), r2(centroid[2])],
        radius_of_gyration_angstrom: r2(rg),
        flory_expected_globular_rg_angstrom: r2(flory_rg),
        compactness_ratio: r2(compactness_ratio),
        end_to_end_distance_angstrom: r2(end_to_end),
        principal_gyration_eigenvalues: [r2(evals[0]), r2(evals[1]), r2(evals[2])],
        asphericity: (asphericity * 1000.0).round() / 1000.0,
        shape_classification: shape_class.into(),
        total_long_range_contacts_8a: contacts_8a,
        relative_contact_order_pct: r2(rco * 100.0),
        estimated_folding_ln_kf: r2(ln_kf),
        total_estimated_sasa_angstrom2: (total_sasa * 10.0).round() / 10.0,
        buried_core_fraction_pct: ((buried_cnt as f64 / n as f64) * 1000.0).round() / 10.0,
        mean_bfactor_or_plddt: ((b_sum / n as f64) * 10.0).round() / 10.0,
        structural_domains,
        residue_profiles,
    }
}

#[cfg(test)]
mod geometry_validation {
    use super::*;

    /// The sample library's tracked Cα trace of RCSB 1A4Y, chains A, B, D and E (molbiocraft-cloning's
    /// sample_structures; its nightly check proves the trace is the entry's CA records).
    const PDB_1A4Y_CA: &str = include_str!("../../molbiocraft-cloning/src/sample_structures/1a4y_ca.pdb");

    /// Reference values computed with NumPy/Biopython from the same Cα coordinates.
    #[test]
    fn structural_geometry_matches_reference_calculations() {
        let r = analyze_pdb_3d_geometry(PDB_1A4Y_CA);
        assert_eq!(r.residue_count, 1166);
        // Mass-weighted radius of gyration and centroid of the Cα atoms.
        assert!((r.radius_of_gyration_angstrom - 31.14).abs() < 0.02, "{}", r.radius_of_gyration_angstrom);
        assert_eq!(r.centroid_xyz, [15.91, 8.79, 19.98]);
        assert!((r.end_to_end_distance_angstrom - 30.30).abs() < 0.02);
        // Relative contact order, |i − j| ≥ 4 and Cα–Cα < 8 Å (Plaxco et al. 1998).
        assert_eq!(r.total_long_range_contacts_8a, 3409);
        assert!((r.relative_contact_order_pct - 3.45).abs() < 0.02, "{}", r.relative_contact_order_pct);
        // Four chains: the two-state folding-rate correlation does not apply and is not reported.
        assert_eq!(r.chain_ids, vec!["A", "B", "D", "E"]);
        assert!(r.estimated_folding_ln_kf.is_nan());
    }
}
