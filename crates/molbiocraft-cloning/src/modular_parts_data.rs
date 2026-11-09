// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModularVectorPart {
    pub id: String,
    pub name: String,
    pub category: String,
    pub sub_category: String,
    pub source: String,
    pub host_system: String,
    pub feature_type: String,
    pub color: String,
    pub nominal_bp: usize,
    pub sequence: String,
    pub summary: String,
}

/// Curated Catalog of 97 Modular DNA Parts (Promoters, Origins, Markers, Reporters, Tags, Viral ITRs/LTRs, CRISPR, Fc).
pub fn get_modular_vector_parts() -> Vec<ModularVectorPart> {
    vec![
        ModularVectorPart {
            id: "prom-cmv".to_string(),
            name: "CMV Promoter/Enhancer".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Ubiquitous".to_string(),
            source: "GenBank X17403.1 (human cytomegalovirus strain AD169, complete genome), minus strand 173,745-174,252".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#2563EB".to_string(),
            nominal_bp: 589,
            sequence: "CGTTACATAACTTACGGTAAATGGCCCGCCTGGCTGACCGCCCAACGACCCCCGCCCATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAGGGACTTTCCATTGACGTCAATGGGTGGAGTATTTACGGTAAACTGCCCACTTGGCAGTACATCAAGTGTATCATATGCCAAGTACGCCCCCTATTGACGTCAATGACGGTAAATGGCCCGCCTGGCATTATGCCCAGTACATGACCTTATGGGACTTTCCTACTTGGCAGTACATCTACGTATTAGTCATCGCTATTACCATGGTGATGCGGTTTTGGCAGTACATCAATGGGCGTGGATAGCGGTTTGACTCACGGGGATTTCCAAGTCTCCACCCCATTGACGTCAATGGGAGTTTGTTTTGGCACCAAAATCAACGGGACTTTCCAAAATGTCGTAACAACTCCGCCCCATTGACGCAAATGGGCGGTAGGCGTGTACGGTGGGAGGTCTATATAAGCAGAGCT".to_string(),
            summary: "Human cytomegalovirus immediate-early enhancer/promoter; ultra-strong transient expression in HEK293, CHO, HeLa; prone to silencing in stem/primary cells.".to_string(),
        },
        ModularVectorPart {
            id: "prom-ef1a".to_string(),
            name: "EF1A (Full-Length + Intron 1)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Ubiquitous".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#1D4ED8".to_string(),
            nominal_bp: 1179,
            sequence: "GGCTCCGGTGCCCGTCAGTGGGCAGAGCGCACATCGCCCACAGTCCCCGAGAAGTTGGGGGGAGGGGTCGGCAATTGAACCGGTGCCTAGAGAAGGTGGCGCGGGGTAAACTGGGAAAGTGATGTCGTGTACTGGCTCCGCCTTTTTCCCGAGGGTGGGGGAGAACCGTATATAAGTGCAGTAGTCGCCGTGAACGTTCTTTTTCGCAACGGGTTTGCCGCCAGAACACAGGTAAGTGCCGTGTGTGGTTCCCGCGGGCCTGGCCTCTTTACGGGTTATGGCCCTTGCGTGCCTTGAATTACTTCCACCTGGCTGCAGTACGTGATTCTTGATCCCGAGCTTCGGGTTGGAAGTGGGTGGGAGAGTTCGAGGCCTTGCGCTTAAGGAGCCCCTTCGCCTCGTGCTTGAGTTGAGGCCTGGCCTGGGCGCTGGGGCCGCCGCGTGCGAATCTGGTGGCACCTTCGCGCCTGTCTCGCTGCTTTCGATAAGTCTCTAGCCATTTAAAATTTTTGATGACCTGCTGCGACGCTTTTTTTCTGGCAAGATAGTCTTGTAAATGCGGGCCAAGATCTGCACACTGGTATTTCGGTTTTTGGGGCCGCGGGCGGCGACGGGGCCCGTGCGTCCCAGCGCACATGTTCGGCGAGGCGGGGCCTGCGAGCGCGGCCACCGAGAATCGGACGGGGGTAGTCTCAAGCTGGCCGGCCTGCTCTGGTGCCTGGCCTCGCGCCGCCGTGTATCGCCCCGCCCTGGGCGGCAAGGCTGGCCCGGTCGGCACCAGTTGCGTGAGCGGAAAGATGGCCGCTTCCCGGCCCTGCTGCAGGGAGCTCAAAATGGAGGACGCGGCGCTCGGGAGAGCGGGCGGGTGAGTCACCCACACAAAGGAAAAGGGCCTTTCCGTCCTCAGCCGTCGCTTCATGTGACTCCACGGAGTACCGGGCGCCGTCCAGGCACCTCGATTAGTTCTCGAGCTTTTGGAGTACGTCGTCTTTAGGTTGGGGGGAGGGGTTTTATGCGATGGAGTTTCCCCACACTGAGTGGGTGGAGACTGAAGTTAGGCCAGCTTGGCACTTGATGTAATTCTCCTTGGAATTTGCCCTTTTTGAGTTTGGATCTTGGTTCATTCTCAAGCCTCAGACAGTGGTTCAAAGTTTTTTTCTTCCATTTCAGGTGTCGTGA".to_string(),
            summary: "Human EEF1A1 promoter with first intron; strong, silencing-resistant constitutive expression across ESCs, iPSCs, T cells, neurons, and lentiviral vectors.".to_string(),
        },
        ModularVectorPart {
            id: "prom-efs".to_string(),
            name: "EFS (Core Short EF1α)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Ubiquitous".to_string(),
            source: "RefSeq NC_000006.12 (GRCh38.p14 chromosome 6), minus strand 73,521,000-73,521,211".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#3B82F6".to_string(),
            nominal_bp: 212,
            sequence: "GGGCAGAGCGCACATCGCCCACAGTCCCCGAGAAGTTGGGGGGAGGGGTCGGCAATTGAACCGGTGCCTAGAGAAGGTGGCGCGGGGTAAACTGGGAAAGTGATGTCGTGTACTGGCTCCGCCTTTTTCCCGAGGGTGGGGGAGAACCGTATATAAGTGCAGTAGTCGCCGTGAACGTTCTTTTTCGCAACGGGTTTGCCGCCAGAACACAG".to_string(),
            summary: "Intronless 212 bp core human EF1α promoter; ideal for space-constrained AAV and SpCas9 lentiviral backbones.".to_string(),
        },
        ModularVectorPart {
            id: "prom-cag".to_string(),
            name: "CAG Hybrid Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Ubiquitous".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#1E40AF".to_string(),
            nominal_bp: 1733,
            sequence: "CGTTACATAACTTACGGTAAATGGCCCGCCTGGCTGACCGCCCAACGACCCCCGCCCATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAGGGACTTTCCATTGACGTCAATGGGTGGAGTATTTACGGTAAACTGCCCACTTGGCAGTACATCAAGTGTATCATATGCCAAGTACGCCCCCTATTGACGTCAATGACGGTAAATGGCCCGCCTGGCATTATGCCCAGTACATGACCTTATGGGACTTTCCTACTTGGCAGTACATCTACGTATTAGTCATCGCTATTACCATGGGTCGAGGTGAGCCCCACGTTCTGCTTCACTCTCCCCATCTCCCCCCCCTCCCCACCCCCAATTTTGTATTTATTTATTTTTTAATTATTTTGTGCAGCGATGGGGGCGGGGGGGGGGGGGGCGCGCGCCAGGCGGGGCGGGGCGGGGCGAGGGGCGGGGCGGGGCGAGGCGGAGAGGTGCGGCGGCAGCCAATCAGAGCGGCGCGCTCCGAAAGTTTCCTTTTATGGCGAGGCGGCGGCGGCGGCGGCCCTATAAAAAGCGAAGCGCGCGGCGGGCGGGAGTCGCTGCGTTGCCTTCGCCCCGTGCCCCGCTCCGCGCCGCCTCGCGCCGCCCGCCCCGGCTCTGACTGACCGCGTTACTCCCACAGGTGAGCGGGCGGGACGGCCCTTCTCCTCCGGGCTGTAATTAGCGCTTGGTTTAATGACGGCTCGTTTCTTTTCTGTGGCTGCGTGAAAGCCTTAAAGGGCTCCGGGAGGGCCCTTTGTGCGGGGGGGAGCGGCTCGGGGGGTGCGTGCGTGTGTGTGTGCGTGGGGAGCGCCGCGTGCGGCCCGCGCTGCCCGGCGGCTGTGAGCGCTGCGGGCGCGGCGCGGGGCTTTGTGCGCTCCGCGTGTGCGCGAGGGGAGCGCGGCCGGGGGCGGTGCCCCGCGGTGCGGGGGGGCTGCGAGGGGAACAAAGGCTGCGTGCGGGGTGTGTGCGTGGGGGGGTGAGCAGGGGGTGTGGGCGCGGCGGTCGGGCTGTAACCCCCCCCTGCACCCCCCTCCCCGAGTTGCTGAGCACGGCCCGGCTTCGGGTGCGGGGCTCCGTGCGGGGCGTGGCGCGGGGCTCGCCGTGCCGGGCGGGGGGTGGCGGCAGGTGGGGGTGCCGGGCGGGGCGGGGCCGCCTCGGGCCGGGGAGGGCTCGGGGGAGGGGCGCGGCGGCCCCGGAGCGCCGGCGGCTGTCGAGGCGCGGCGAGCCGCAGCCATTGCCTTTTATGGTAATCGTGCGAGAGGGCGCAGGGACTTCCTTTGTCCCAAATCTGGCGGAGCCGAAATCTGGGAGGCGCCGCCGCACCCCCTCTAGCGGGCGCGGGCGAAGCGGTGCGGCGCCGGCAGGAAGGAAATGGGCGGGGAGGGCCTTCGTGCGTCGCCGCGCCGCCGTCCCCTTCTCCATCTCCAGCCTCGGGGCTGCCGCAGGGGGACGGCTGCCTTCGGGGGGGACGGGGCAGGGCGGGGTTCGGCTTCTGGCGTGTGACCGGCGGCTCTAGAGCCTCTGCTAACCATGTTCATGCCTTCTTCTTTTTCCTACAGCTCCTGGGCAACGTGCTGGTTATTGTGCTGTCTCATCATTTTGGCAAAGAATT".to_string(),
            summary: "CMV IE enhancer + chicken β-actin promoter + chimeric rabbit β-globin intron; highest expression in vivo, muscle, brain, and transgenic animals.".to_string(),
        },
        ModularVectorPart {
            id: "prom-sffv".to_string(),
            name: "SFFV Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Hematopoietic".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#2563EB".to_string(),
            nominal_bp: 412,
            sequence: "GTAACGCCATTTTGCAAGGCATGGAAAAATACCAAGAGCTGGAATAGCTCAAAGGTAGGAACAGATGGTCCCCAGATGCGGTCCAGCCCTCAGCAGTTTCTAGAGAACCATCAGATGTTTCCAGGGTGCCCCAAGGACCTGAAATGACCCTGTGCCTTATTTGAACTAACCAATCAGTTCGCTTCTCGCTTCTGTTCGCGCGCTTCTGCTCCCCGAGCTCTATATAAGCAGAGCTCGTTTAGTGAACCGTCAGATCGCCTGGAGACGCCATCCACGCTGTTTTGACCTCCATAGAAGACACC".to_string(),
            summary: "Spleen focus-forming virus LTR promoter; premier choice in Twist & Modular lentiviral vectors for primary T cells, HSCs, and myeloid lineages.".to_string(),
        },
        ModularVectorPart {
            id: "prom-pgk".to_string(),
            name: "hPGK Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Ubiquitous".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#3B82F6".to_string(),
            nominal_bp: 511,
            sequence: "GGGGTTGGGGTTGCGCCTTTTCCAAGGCAGCCCTGGGTTTGCGCAGGGACGCGGCTGCTCTGGGCGTGGTTCCGGGAAACGCAGCGGCGCCGACCCTGGGTCTCGCACATTCTTCACGTCCGTTCGCAGCGTCACCCGGATCTTCGCCGCTACCCTTGTGGGCCCCCCGGCGACGCTTCCTGCTCCGCCCCTAAGTCGGGAAGGTTCCTTGCGGTTCGCGGCGTGCCGGACGTGACAAACGGAAGCCGCACGTCTCACTAGTACCCTCGCAGACGGACAGCGCCAGGGAGCAATGGCAGCGCGCCGACCGCGATGGGCTGTGGCCAATAGCGGCTGCTCAGCAGGGCGCGCCGAGAGCAGCGGCCGGGAAGGGGCGGTGCGGGAGGCGGGGTGTGGGGCGGTAGTGTGGGCCCTGTTCCTGCCCGCGCGGTGTTCCGCATTCTGCAAGCCTCCGGAGCGCACGTCGGCAGTCGGCTCCCTCGTTGACCGAATCACCGACCTCTCTCCCCAG".to_string(),
            summary: "Human phosphoglycerate kinase 1 promoter; moderate physiological ubiquitous expression ideal for drug resistance markers and low-toxicity transgenes.".to_string(),
        },
        ModularVectorPart {
            id: "prom-ubc".to_string(),
            name: "UBC Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Mammalian Ubiquitous".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#3B82F6".to_string(),
            nominal_bp: 1207,
            sequence: "GGCCTCCGCGCCGGGTTTTGGCGCCTCCCGCGGGCGCCCCCCTCCTCACGGCGAGCGCTGCCACGTCAGACGAAGGGCGCAGCGAGCGTCCTGATCCTTCCGCCCGGACGCTCAGGACAGCGGCCCGCTGCTCATAAGACTCGGCCTTAGAACCCCAGTATCAGCAGAAGGACATTTTAGGACGGGACTTGGGTGACTCTAGGGCACTGGTTTTCTTTCCAGAGAGCGGAACAGGCGAGGAAAAGTAGTCCCTTCTCGGCGATTCTGCGGAGGGATCTCCGTGGGGCGGTGAACGCCGATGATTATATAAGGACGCGCCGGGTGTGGCACAGCTAGTTCCGTCGCAGCCGGGATTTGGGTCGCGGTTCTTGTTTGTGGATCGCTGTGATCGTCACTTGGTGAGTAGCGGGCTGCTGGGCTGGCCGGGGCTTTCGTGGCCGCCGGGCCGCTCGGTGGGACGGAAGCGTGTGGAGAGACCGCCAAGGGCTGTAGTCTGGGTCCGCGAGCAAGGTTGCCCTGAACTGGGGGTTGGGGGGAGCGCAGCAAAATGGCGGCTGTTCCCGAGTCTTGAATGGAAGACGCTTGTGAGGCGGGCTGTGAGGTCGTTGAAACAAGGTGGGGGGCATGGTGGGCGGCAAGAACCCAAGGTCTTGAGGCCTTCGCTAATGCGGGAAAGCTCTTATTCGGGTGAGATGGGCTGGGGCACCATCTGGGGACCCTGACGTGAAGTTTGTCACTGACTGGAGAACTCGGTTTGTCGTCTGTTGCGGGGGCGGCAGTTATGGCGGTGCCGTTGGGCAGTGCACCCGTACCTTTGGGAGCGCGCGCCCTCGTCGTGTCGTGACGTCACCCGTTCTGTTGGCTTATAATGCAGGGTGGGGCCACCTGCCGGTAGGTGTGCGGTAGGCTTTTCTCCGTCGCAGGACGCAGGGTTCGGGCCTAGGGTAGGCTCTCCTGAATCGACAGGCGCCGGACCTCTGGTGAGGGGAGGGATAAGTGAGGCGTCAGTTTCTTTGGTCGGTTTTATGTACCTATCTTCTTAAGTAGCTGAAGCTCCGGTTTTGAACTATGCGCTCGGGGTTGGCGAGTGTGTTTTGTGAAGTTTTTTAGGCACCTTTTGAAATGTAATCATTTGGGTCAATATGTAATTTTCAGTGTTAGACTAGTAAATTGTCCGCTAAATTCTGGCCGTTTTTGGCTTTTTTGTTAGAC".to_string(),
            summary: "Human ubiquitin C promoter; stable moderate expression across mammalian tissues and stem cells.".to_string(),
        },
        ModularVectorPart {
            id: "prom-syn1".to_string(),
            name: "hSyn1 (Human Synapsin 1)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Tissue-Specific (Neuron)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#0284C7".to_string(),
            nominal_bp: 469,
            sequence: "AGTGCAAGTGGGTTTTAGGACCAGGATGAGGCGGGGTGGGGGTGCCTACCTGACGACCGACCCCGACCCACTGGACAAGCACCCAACCCCCATTCCCCAAATTGCGCATCCCCTATCAGAGAGGGGGAGGGGAAACAGGATGCGGCGAGGCGCGTGCGCACTGCCAGCTTCAGCACCGCGGACAGTGCCTTCGCCCCCGCCTGGCGGCGCGCGCCACCGCCGCCTCAGCACTGAAGGCGCGCTGACGTCACTCGCCGGTCCCCCGCAAACTCCCCTTCCCGGCCACCTTGGTCGCGTCCGCGCCGCCGCCGGCCCAGCCGGACCGCACCACGCGAGGCGCGAGATAGGGGGGCACGGGCGCGACCATCTGCGCTGCGGCGCCGGCGACTCAGCGCTGCCTCAGTCTGCGGTGGGCAGCGGAGGAGTCGTGTCGTGCCTGAGAGCGCAG".to_string(),
            summary: "Compact 469 bp pan-neuronal promoter; gold-standard for AAV brain/CNS expression of GCaMP, optogenetics, and DREADDs without glial leakiness.".to_string(),
        },
        ModularVectorPart {
            id: "prom-camk2a".to_string(),
            name: "CaMKIIα (Excitatory Neuron)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Tissue-Specific (Neuron)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#0284C7".to_string(),
            nominal_bp: 1291,
            sequence: "ACTTGTGGACTAAGTTTGTTCGCATCCCCTTCTCCAACCCCCTCAGTACATCACCCTGGGGGAACAGGGTCCACTTGCTCCTGGGCCCACACAGTCCTGCAGTATTGTGTATATAAGGCCAGGGCAAAGAGGAGCAGGTTTTAAAGTGAAAGGCAGGCAGGTGTTGGGGAGGCAGTTACCGGGGCAACGGGAACAGGGCGTTTCGGAGGTGGTTGCCATGGGGACCTGGATGCTGACGAAGGCTCGCGAGGCTGTGAGCAGCCACAGTGCCCTGCTCAGAAGCCCCAAGCTCGTCAGTCAAGCCGGTTCTCCGTTTGCACTCAGGAGCACGGGCAGGCGAGTGGCCCCTAGTTCTGGGGGCAGCGGGGATGCGGGTGTGGGGCTGCCTTGGAAGCGGAGAGAGACAGCGTGGAGAGTCCTTGGATAGGCCTATCCGACCTGGAGCCCAAGAACTTGCCTGTGAGCAAGTGTAGGGCTGGAGAGATGGCTCAGCGGTTAAGAGCACTGACTGCTCTTCCAGAGGTCCTGAGTTCAATTCCCAGCAACCACATGGTGGCTCACAACCATCTGTAATGGGATCTGATGCCCTCTTCTGGTGTGTCTGAAGACAGCTACAGTGTACTTACATATAATAAATAAATAAATCTTTTTAAAAAGAACTTGCCTGTGAGCAAACAGAAAGCCTGTGCATAGGAGCAAGCACAGCCTGGAGCTGGAGCTGGAGCTGGAGCTGGAGCTGGGACCCTGAGCCAAGTCAGAGGCCAGCCTCGGTTCCACAGAGAAACCCTGTCTCAAAAAACAAAAACAAAAACAAACAAACAAAAAAACAGCCTGTGCATAGGAGCAAGCACAGCCTGGAGCTGGAGCTGGAGCTGGAGCTGGAGCTGGGACCCTGAGCCAAGTCAGAGGCCAGCCTCGGTTCCACAGAGAAACCCTGTCTCAAAAAACAAACAAACAAACAAAAAAACCACAGCCTGTGCA".to_string(),
            summary: "Mouse Ca2+/calmodulin-dependent protein kinase II alpha promoter; selective expression in forebrain glutamatergic pyramidal neurons.".to_string(),
        },
        ModularVectorPart {
            id: "prom-gfap".to_string(),
            name: "gfaABC1D (Compact GFAP Astrocyte)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Tissue-Specific (Glia)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#0284C7".to_string(),
            nominal_bp: 681,
            sequence: "AACATATCCTGGTGTGGAGTAGGGGACGCTGCTCTGACAGAGGCTCGGGGGCCTGAGCTGGCTCTGTGAGCTGGGGAGGAGGCAGACAGCCAGGCCTTGTCTGCAAGCAGACCTGGCAGCATTGGGCTGGCCGCCCCCCAGGGCCTCCTCTTCATGCCCAGTGAATGACTCACCTTGGCACAGACACAATGTTCGGGGTGGGCACAGTGCCTGCTTCCCGCCGCACCCCAGCCCCCCTCAAATGCCTTCCGAGAAGCCCATTGAGCAGGGGGCTTGCATTGCACCCCAGCCTGACAGCCTGGCATCTTGGGATAAAAGCAGCACAGCCCCCTAGGGGCTGCCCTTGCTGTGTGGCGCCACCGGCGGTGGAGAACAAGGCTCTATTCAGCCTGTGCCCAGGAAAGGGGATCAGGGGATGCCCAGGCATGGACAGTGGGTGGCAGGGGGGGAGAGGAGGGCTGTCTGCTTCCCAGAAGTCCAAGGACACAAATGGGTGAGGGGAGAGCTCTCCCCATAGCTGGGCTGCGGCCCAACCCCACCCCCTCAGGCTATGCCAGGGGGTGTTGCCAGGGGCACCCGGGCATCGCCAGTCTAGCCCACTCCTTCATAAAGCCCTCGCATCCCAGGAGCGAGCAGAGCCAGAGCAGGTTGGAGAGGAGACGCATCACCTCCGCTGCTCGC".to_string(),
            summary: "Truncated 681 bp human GFAP promoter retaining full astrocyte specificity while fitting AAV cargo limits.".to_string(),
        },
        ModularVectorPart {
            id: "prom-tbG".to_string(),
            name: "TBG (Hepatocyte-Specific)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Tissue-Specific (Liver)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#0284C7".to_string(),
            nominal_bp: 460,
            sequence: "AGGTTAATTTTTAAAAAGCAGTCAAAAGTCCAAGTGGCCCTTGGCAGCATTTACTCTCTCTGTTTGCTCTGGTTAATAATCTCAGGAGCACAAACATTCCAGATCCAGGTTAATTTTTAAAAAGCAGTCAAAAGTCCAAGTGGCCCTTGGCAGCATTTACTCTCTCTGTTTGCTCTGGTTAATAATCTCAGGAGCACAAACATTCCAGATCCGGCGCGCCGCTGCTGAAGAGGAGACTGCTGGTGCTGCTGAAGAGGAGACTGCTGGTGCTGCTGAAGAGGAGACTGCTGGTATATAAGCAGAGCTCGTTTAGTGAACCGTCAGATCGCCTGGAGACGCCATCCACGCTGTTTTGACCTCCATAGAAGACACC".to_string(),
            summary: "Thyroxine-binding globulin promoter + α1-microglobulin enhancer; liver hepatocyte-specific expression for AAV8/AAV9 gene therapy.".to_string(),
        },
        ModularVectorPart {
            id: "prom-mhck7".to_string(),
            name: "MHCK7 (Cardiac & Skeletal Muscle)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Tissue-Specific (Muscle)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#0284C7".to_string(),
            nominal_bp: 770,
            sequence: "AGCTTGیرهCCCTTCAGATTAAAAATAACTGAGGTAAGGGCCTGGGTAGGGGAGGTGGTGTGAGACGCTCCTGTCTCTCCTCTATCTGCCCATCGGCCCTTTGGGGAGGAGGAATGTGCCCAAGGACTAAAAAAAGGCCATGGAGCCAGAGGGGCGAGGGCAACAGACCTTTCATGGGCAAACCTTGGGGCCCTGCTGTCTAGCATGCCCCACTACGGGTCTAGGCTGCCCATGTAAGGAGGCAAGGCCTGGGGACACCCGAGATGCCTGGTTATAATTAACCCAGACATGTGGCTGCCCCCCCCCCCCCAACACCTGCTGCCTCTAAAAATAACCCTGTCCCTGGTGGATCCCCTGCATGCGAAGATCTTCGAACAAGGCTGTGGGGGACTGAGGGCAGGCTGTAACAGGCTTGGGGGCCAGGGCTTATACGTGCCTGGGACTCCCAAAGTATTACTGTTCCATGTTCCCGGCGAAGGGCCAGCTGTCCCCCGCCAGCTAGACTCAGCACTTAGTTTAGGAACCAGTGAGCAAGTCAGCCCTTGGGGCAGCCCATACAAGGCCATGGGGCTGGGCAAGCTGCACGCCTGGGTCCGGGGTGGGCACGGTGCCCGGGCAACGAGCTGAAAGCTCATCTGCTCTCAGGGGCCCCTCCCTGGGGACAGCCCCTCCTGGCTAGTCACACCCTGTAGGCTCCTCTATATAACCCAGGGGCACAGGGGCTGCCCTCATTCTACCACCACCTCCACAGCACAGACAGACACTCAGGAGCCAGCCAGC".to_string(),
            summary: "Chimeric α-MHC enhancer + MCK promoter; high-level expression selectively in myocardium and skeletal muscle.".to_string(),
        },
        ModularVectorPart {
            id: "prom-tre3g".to_string(),
            name: "TRE3G (3rd-Gen Tet-Inducible)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Inducible Mammalian".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 389,
            sequence: "GAGTTTACTCCCTATCAGTGATAGAGAACGTATGAAGAGTTTACTCCCTATCAGTGATAGAGAACGTATGCAGACTTTACTCCCTATCAGTGATAGAGAACGTATAAGGAGTTTACTCCCTATCAGTGATAGAGAACGTATGACCAGTTTACTCCCTATCAGTGATAGAGAACGTATCTACAGTTTACTCCCTATCAGTGATAGAGAACGTATATCCAGTTTACTCCCTATCAGTGATAGAGAACGTATAAGCTTTAGGCGTGTACGGTGGGCGCCTATAAAAGCAGAGCTCGTTTAGTGAACCGTCAGATCGCCTGGAGCAATTCCACAACACTTTTGTCTTATACCAACTTTCCGTACCACTTCCTACCCTCGTAAA".to_string(),
            summary: "7x TetO heptamer + mutated minimal CMV; ultra-low basal leakiness and >1,000-fold doxycycline induction with Tet-On 3G (rtTA).".to_string(),
        },
        ModularVectorPart {
            id: "prom-u6".to_string(),
            name: "hU6 (RNA Pol III Promoter)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "RNA Pol III (gRNA/shRNA)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#4F46E5".to_string(),
            nominal_bp: 249,
            sequence: "GAGGGCCTATTTCCCATGATTCCTTCATATTTGCATATACGATACAAGGCTGTTAGAGAGATAATTGGAATTAATTTGACTGTAAACACAAAGATATTAGTACAAAATACGTGACGTAGAAAGTAATAATTTCTTGGGTAGTTTGCAGTTTTAAAATTATGTTTTAAAATGGACTATCATATGCTTACCGTAACTTGAAAGTATTTCGATTTCTTGGCTTTATATATCTTGTGGAAAGGACGAAACACC".to_string(),
            summary: "Human U6 snRNA Pol III promoter (+1 G preference); drives precise transcription of CRISPR sgRNAs and shRNAs.".to_string(),
        },
        ModularVectorPart {
            id: "prom-h1".to_string(),
            name: "H1 (RNA Pol III Promoter)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "RNA Pol III (gRNA/shRNA)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "promoter".to_string(),
            color: "#4F46E5".to_string(),
            nominal_bp: 100,
            sequence: "ATATTTGCATGTCGCTATGTGTTCTGGGAAATCACCATAAACGTGAAATGTCTTTGGATTTGGGAATCTTATAAGTTCTGTATGAGACCACTTGGATCC".to_string(),
            summary: "Compact 100 bp human H1 RNA Pol III promoter; pairs orthogonally with hU6 in dual-gRNA CRISPR constructs without recombination.".to_string(),
        },
        ModularVectorPart {
            id: "prom-t7lac".to_string(),
            name: "T7lac Promoter + lacO".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Bacterial Expression".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli (DE3)".to_string(),
            feature_type: "promoter".to_string(),
            color: "#2563EB".to_string(),
            nominal_bp: 45,
            sequence: "TAATACGACTCACTATAGGGGAATTGTGAGCGGATAACAATTCCC".to_string(),
            summary: "Bacteriophage T7 promoter fused to lac operator (pET series); IPTG-inducible ultra-high expression in BL21(DE3).".to_string(),
        },
        ModularVectorPart {
            id: "prom-t7".to_string(),
            name: "T7 Core Promoter (IVT / pT7)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Bacterial / IVT".to_string(),
            source: "RefSeq NC_001604.1 (Enterobacteria phage T7, complete genome), plus strand 18,528-18,547".to_string(),
            host_system: "E. coli / Cell-Free IVT".to_string(),
            feature_type: "promoter".to_string(),
            color: "#2563EB".to_string(),
            nominal_bp: 20,
            sequence: "TAATACGACTCACTATAGGG".to_string(),
            summary: "Canonical 20 bp T7 RNA polymerase promoter for cell-free IVT mRNA synthesis and bacterial expression.".to_string(),
        },
        ModularVectorPart {
            id: "prom-tac".to_string(),
            name: "tac Hybrid Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Bacterial Expression".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "promoter".to_string(),
            color: "#2563EB".to_string(),
            nominal_bp: 73,
            sequence: "TTGACAATTAATCATCGGCTCGTATAATGTGTGGAATTGTGAGCGGATAACAATTTCACACAGGAAACAGAAT".to_string(),
            summary: "Hybrid trp (-35) + lacUV5 (-10) + lacO promoter (pGEX / pMAL); IPTG-inducible in any E. coli strain without needing λDE3.".to_string(),
        },
        ModularVectorPart {
            id: "prom-arabad".to_string(),
            name: "araBAD (pBAD) Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Bacterial Inducible".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "promoter".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 274,
            sequence: "AAGAAACCAATTGTCCATATTGCATCAGACATTGCCGTCACTGCGTCTTTTACTGGCTCTTCTCGCTAACCAAACCGGTAACCCCGCTTATTAAAAGCATTCTGTAACAAAGCGGGACCAAAGCCATGACAAAAACGCGTAACAAAAGTGTCTATAATCACGGCAGAAAAGTCCACATTGATTATTTGCACGGCGTCACACTTTGCTATGCCATAGCATTTTTATCCATAAGATTAGCGGATCCTACCTGACGCTTTTTATCGCAACTCTCTACTGTTTCTCCATA".to_string(),
            summary: "L-arabinose-inducible, glucose-repressed bacterial promoter with tight titratable expression for toxic proteins.".to_string(),
        },
        ModularVectorPart {
            id: "prom-cspa".to_string(),
            name: "cspA Cold-Shock Promoter".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Bacterial Cold-Shock".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "promoter".to_string(),
            color: "#0284C7".to_string(),
            nominal_bp: 185,
            sequence: "GCATTTTTTACCCAAAACGAGTAGAATTTGCCACGTTTCAGGCGCGTTTTTGTTGTCTCTGTCAAATGAAACTGAATGGTACAAATAATAACATGACTTCTACCTGATAAATGTTAACGCTTTGTTAAATTGTTTACGGCTGCCGTTATTGTTTAACGCATAAAGGAGGTAAATAT".to_string(),
            summary: "pCold series 15°C cold-shock promoter; suppresses host proteases and chaperones aggregation-prone proteins.".to_string(),
        },
        ModularVectorPart {
            id: "prom-gal1".to_string(),
            name: "GAL1 Promoter (S. cerevisiae)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Yeast Inducible".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "S. cerevisiae".to_string(),
            feature_type: "promoter".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 452,
            sequence: "ACGGATTAGAAGCCGCCGAGCGGGTGACAGCCCTCCGAAGGAAGACTCTCCTCCGTGCGTCCTCGTCTTCACCGGTCGCGTTCCTGAAACGCAGATGTGCCTCGCGCCGCACTGCTCCGAACAATAAAGATTCTACAATACTAGCTTTTATGGTTATGAAGAGGAAAAATTGGCAGTAACCTGGCCCCACAAACCTTCAAATGAACGAATCAAATTAACAACCATAGGATGATAATGCGATTAGTTTTTTAGCCTTATTTCTGGGGTAATTAATCAGCGAAGCGATGATTTTTGATCTATTAACAGATATATAAATGCAAAAACTGCATAACCACTTTAACTAATACTTTCAACATTTTCGGTTTGTATTACTTCTTATTCAAATGTAATAAAAGTATCAACAAAAAATTGTTAATATACCTCTATACTTTAACGTCAAGGAGAAAAAACCCC".to_string(),
            summary: "Galactose-inducible, glucose-repressed yeast promoter (pYES2); >1,000-fold induction in Saccharomyces cerevisiae.".to_string(),
        },
        ModularVectorPart {
            id: "prom-aox1".to_string(),
            name: "AOX1 Promoter (P. pastoris)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Yeast Methanol-Inducible".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "P. pastoris".to_string(),
            feature_type: "promoter".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 938,
            sequence: "AGATCTAACATCCAAAGACGAAAGGTTGAATGAAACCTTTTTGCCATCCGACATCCACAGGTCCATTCTCACACATAAGTGCCAAACGCAACAGGAGGGGATACACTAGCAGCAGACCGTTGCAAACGCAGGACCTCCACTCCTCTTCTCCTCAACACCCACTTTTGCCATCGAAAAACCAGCCCAGTTATTGGGCTTGATTGGAGCTCGCTCATTCCAATTCCTTCTATTAGGCTACTAACACCATGACTTTATTAGCCTGTCTATCCTGGCCCCCCTGGCGAGGTTCATGTTTGTTTATTTCCGAATGCAACAAGCTCCGCATTACACCCGAACATCACTCCAGATGAGGGCTTTCTGAGTGTGGGGTCAAATAGTTTCATGTTCCCCAAATGGCCCAAAACTGACAGTTTAAACGCTGTCTTGGAACCTAATATGACAAAAGCGTGATCTCATCCAAGATGAACTAAGTTTGGTTCGTTGAAATGCTAACGGCCAGTTGGTCAAAAAGAAACTTCCAAAAGTCGGCATACCGTTTGTCTTGTTTGGTATTGATTGACGAATGCTCAAAAATAATCTCATTAATGCTTAGCGCAGTCTCTCTATCGCTTCTGAACCCCGGTGCACCTGTGCCGAAACGCAAATGGGGAAACACCCGCTTTTTGGATGATTATGCATTGTCTCCACATTGTATGCTTCCAAGATTCTGGTGGGAATACTGCTGATAGCCTAACGTTCATGATCAAAATTTAACTGTTCTAACCCCTACTTGACAGCAATATATAAACAGAAGGAAGCTGCCCTGTCTTAAACCTTTTTTTTTATCATCATTATTAGCTTACTTTCATAATTGCGACTGGTTCCAATTGACAAGCTTTTGATTTTAACGACTTTTAACGACAACTTGAGAAGATCAAAAAACAACTAATTATTCGAAACG".to_string(),
            summary: "Alcohol oxidase 1 promoter for Komagataella phaffii (Pichia pastoris); methanol-inducible recombinant protein production up to g/L titers.".to_string(),
        },
        ModularVectorPart {
            id: "prom-camv35s".to_string(),
            name: "CaMV 35S (2x Enhanced Plant)".to_string(),
            category: "Promoter".to_string(),
            sub_category: "Plant Ubiquitous".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Plant (Dicots)".to_string(),
            feature_type: "promoter".to_string(),
            color: "#16A34A".to_string(),
            nominal_bp: 346,
            sequence: "AGATTAGCCTTTTCAATTTCAGAAAGAATGCTAACCCACAGATGGTTAGAGAGGCTTACGCAGCAGGTCTCATCAAGACGATCTACCCGAGCAATAATCTCCAGGAAATCAAATACCTTCCCAAGAAGGTTAAAGATGCAGTCAAAAGATTCAGGACTAACTGCATCAAGAACACAGAGAAAGATATATTTCTCAAGATCAGAAGTACTATTCCAGTATGGACGATTCAAGGCTTGCTTCACAAACCAAGGCAAGTAATAGAGATTGGAGTCTCTAAAAAGGTAGTTCCCACTGAATCAAAGGCCATGGAGTCAAAGATTCAAATAGAGGACCTAACAGAACTCGCCGTAAAGACTGGCGAACAGTTCATACAGAGTCTCTTACGACTCAATGACAAGAAGAAAATCTTCGTCAACATGGTGGAGCACGACACACTTGTCTACTCCAAAAATATCAAAGATACAGTCTCAGAAGACCAAAGGGCAATTGAGACTTTTCAACAAAGGGTAATATCCGGAAACCTCCTCGGATTCCATTGCCCAGCTATCTGTCACTTTATTGTGAAGATAGTGGAAAAGGAAGGTGGCTCCTACAAATGCCATCATTGGCGATAAAGGAAAGGCCATCGTTGAAGATGCCTCTGCCGACAGTGGTCCCAAAGATGGACCCCCACCCACGAGGAGCATCGTGGAAAAAGAAGACGTTCCAACCACGTCTTCAAAGCAAGTGGATTGATGTGATATCTCCACTGACGTAAGGGATGACGCACAATCCCACTATCCTTCGCAAGACCCTTCCTCTATATAAGGAAGTTCATTTCATTTGGAGAGA".to_string(),
            summary: "Cauliflower mosaic virus 35S promoter; standard constitutive promoter in dicot plants (Arabidopsis, Nicotiana, tomato).".to_string(),
        },
        ModularVectorPart {
            id: "orf-egfp".to_string(),
            name: "EGFP".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Fluorescent (Green)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "CDS".to_string(),
            color: "#10B981".to_string(),
            nominal_bp: 720,
            sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA".to_string(),
            summary: "Enhanced GFP (Ex 488 nm / Em 507 nm, F64L/S65T); standard green fluorescent reporter.".to_string(),
        },
        ModularVectorPart {
            id: "orf-mcherry".to_string(),
            name: "mCherry".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Fluorescent (Red)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "CDS".to_string(),
            color: "#E11D48".to_string(),
            nominal_bp: 711,
            sequence: "ATGGTGAGCAAGGGCGAGGAGGATAACATGGCCATCATCAAGGAGTTCATGCGCTTCAAGGTGCACATGGAGGGCTCCGTGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCGCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAAGGCCTACGTGAAGCACCCCGCCGACATCCCCGACTACTTGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCGAGTTCATCTACAAGGTGAAGCTGCGCGGCACCAACTTCCCCTCCGACGGCCCCGTAATGCAGAAGAAGACCATGGGCTGGGAGGCCTCCTCCGAGCGGATGTACCCCGAGGACGGCGCCCTGAAGGGCGAGATCAAGCAGAGGCTGAAGCTGAAGGACGGCGGCCACTACGACGCTGAGGTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGCTGCCCGGCGCCTACAACGTCAACATCAAGTTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAACGCGCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAA".to_string(),
            summary: "Monomeric red fluorescent protein (Ex 587 nm / Em 610 nm); fast maturation, orthogonal to GFP/YFP.".to_string(),
        },
        ModularVectorPart {
            id: "orf-mscarlet3".to_string(),
            name: "mScarlet3".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Fluorescent (Bright Red)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "CDS".to_string(),
            color: "#F43F5E".to_string(),
            nominal_bp: 699,
            sequence: "ATGGTGAGCAAGGGCGAGGCAGTGATCAAGGAGTTCATGCGGTTCAAGGTGCACATGGAGGGCTCCATGAACGGCCACGAGTTCGAGATCGAGGGCGAGGGCGAGGGCCGCCCCTACGAGGGCACCCAGACCGCCAAGCTGAAGGTGACCAAGGGTGGCCCCCTGCCCTTCTCCTGGGACATCCTGTCCCCTCAGTTCATGTACGGCTCCAGGGCCTTCATCAAGCACCCCGCCGACATCCCCGACTACTATAAGCAGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGCGCCGTGACCGTGACCCAGGACACCTCCCTGGAGGACGGCACCCTGATCTACAAGGTGAAGCTCCGCGGCACCAACTTCCCTCCTGACGGCCCCGTAATGCAGAAGAAGACAATGGGCTGGGAAGCGTCCACCGAGCGGTTGTACCCCGAGGACGGCGTGCTGAAGGGCGACATTAAGATGGCCCTGCGCCTGAAGGACGGCGGCCGCTACCTGGCGGACTTCAAGACCACCTACAAGGCCAAGAAGCCCGTGCAGATGCCCGGCGCCTACAACGTCGACCGCAAGTTGGACATCACCTCCCACAACGAGGACTACACCGTGGTGGAACAGTACGAACGCTCCGAGGGCCGCCACTCCACCGGCGGCATGGACGAGCTGTACAAGTAA".to_string(),
            summary: "Next-generation ultra-bright, rapid-maturing true monomeric RFP (Ex 569 nm / Em 592 nm) with minimal cytotoxicity.".to_string(),
        },
        ModularVectorPart {
            id: "orf-mneongreen".to_string(),
            name: "mNeonGreen".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Fluorescent (Ultra-Bright Green)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "CDS".to_string(),
            color: "#22C55E".to_string(),
            nominal_bp: 711,
            sequence: "ATGGTGAGCAAGGGCGAGGAGGATAACATGGCTTCTCTCCCAGCCACACATGAGCTGCACATCTTTGGCTCCATCAACGGGGTGGACTTTGACATGGTGGGTCAGGGCACCGGCAATCCAAATGATGGTTATGAGGAGTTAAACCTGAAGTCCACCAAGGGTGACCTCCAGTTCTCCCCCTGGATTCTGGTCCCTCATATCGGGTATGGCTTCCATCAGTACCTGCCCTACCCTGACGGGATGTCGCCTTTCCAGGCCGCCATGGTAGATGGCTCCGGATACCAAGTCCATCGCACAATGCAGTTTGAAGATGGTGCCTCCCTTACTGTTAACTACCGCTACACCTACGAGGGAAGCCACATCAAAGGAGAGGCCCAGGTGAAGGGGACTGGTTTCCCTGCTGACGGTCCTGTGATGACCAACTCGCTGACCGCTGCGGACTGGTGCAGGTCGAAGAAGACTTACCCCAACGACAAAACCATCATCAGTACCTTTAAGTGGAGTTACACCACTGGAAATGGCAAGCGCTACCGGAGCACTGCGCGGACCACCTACACCTTTGCCAAGCCAATGGCGGCTAACTATCTGAAGAACCAGCCGATGTACGTGTTCCGTAAGACGGAGCTCAAGCACTCCAAGACCGAGCTCAACTTCAAGGAGTGGCAAAAGGCCTTTACCGATGTGATGGGCATGGACGAGCTGTACAAGTAA".to_string(),
            summary: "Branchiostoma lanceolatum monomeric yellow-green FP (Ex 506 nm / Em 517 nm); ~3x brighter than EGFP.".to_string(),
        },
        ModularVectorPart {
            id: "orf-tagbfp2".to_string(),
            name: "TagBFP2".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Fluorescent (Blue)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "CDS".to_string(),
            color: "#3B82F6".to_string(),
            nominal_bp: 702,
            sequence: "ATGAGCGAGCTGATTAAGGAGAACATGCACATGAAGCTGTACATGGAGGGCACCGTGGACAACCATCACTTCAAGTGCACATCCGAGGGCGAAGGCAAGCCCTACGAGGGCACCCAGACCATGAGAATCAAGGTGGTCGAGGGCGGCCCTCTCCCCTTCGCCTGGGACATCCTGTCTCCCCAGTTCATGTACGGCTCCAAAGCATACGTGAAGCACCCCGCCGACATCCCCGATTACAAGAAGCTGTCCTTCCCCGAGGGCTTCAAGTGGGAGCGCGTGATGAACTTCGAGGACGGCGGTCTGGTGACCGTGACCCAGGACTCCTCCCTGCAGGACGGCACGCTGATCTACAAGGTGAAGATGCGCGGCACCAACTTCCCCCCCGACGGCCCCGTAATGCAGAAGAAGACCATGGGCTGGGAGGCCTCCACCGAGCGCCTGTACCCCCGCGACGGCGTGCTGAAGGGCGAGATCCACCAGGCCCTGAAGCTGAAGGACGGCGGCCACTACCTGGTGGAGTTCAAGACCATCTACATGGCCAAGAAGCCCGTGCAACTGCCCGGCTACTACTACGTGGACACCAAGCTGGACATCACCTCCCACAACGAGGACTACACCATCGTGGAACAGTACGAGCGCTCCGAGGGCCGCCACCACCTGTTCCTGGGGCATGGCACCGGCAGCACCGGCAGCGGCAGCTCC".to_string(),
            summary: "Photostable monomeric blue fluorescent protein (Ex 399 nm / Em 454 nm) for 4-color multiplexing.".to_string(),
        },
        ModularVectorPart {
            id: "orf-nanoluc".to_string(),
            name: "NanoLuc Luciferase".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Bioluminescent".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "CDS".to_string(),
            color: "#F59E0B".to_string(),
            nominal_bp: 516,
            sequence: "ATGGTCTTCACACTCGAAGATTTCGTTGGGGACTGGCGACAGACAGCCGGCTACAACCTGGACCAAGTCCTTGAACAGGGAGGTGTGTCCAGTTTGTTTCAGAATCTCGGGGTGTCCGTAACTCCGATCCAAAGGATTGTCCTGAGCGGTGAAAATGGGCTGAAGATCGACATCCATGTCATCATCCCGTATGAAGGTCTGAGCGGCGACCAAATGGGCCAGATCGAAAAAATTTTTAAGGTGGTGTACCCTGTGGATGATCATCACTTTAAGGTGATCCTGCACTATGGCACACTGGTAATCGACGGGGTTACGCCGAACATGATCGACTATTTCGGACGGCCGTATGAAGGCATCGCCGTGTTCGACGGCAAAAAGATCACTGTAACAGGGACCCTGTGGAACGGCAACAAAATTATCGACGAGCGCCTGATCAACCCCGACGGCTCCCTGCTGTTCCGAGTAACCATCAACGGAGTGACCGGCTGGCGGCTGTGCGAACGCATTCTGGCGTAA".to_string(),
            summary: "Ultra-compact 19 kDa Oplophorus engineered luciferase (~150x brighter than Firefly/Renilla; furimazine substrate).".to_string(),
        },
        ModularVectorPart {
            id: "orf-luc2".to_string(),
            name: "Luc2 (Firefly Luciferase)".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Bioluminescent".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "CDS".to_string(),
            color: "#D97706".to_string(),
            nominal_bp: 1653,
            sequence: "ATGGAAGATGCCAAAAACATTAAGAAGGGCCCAGCGCCATTCTACCCACTCGAAGACGGGACCGCCGGCGAGCAGCTGCACAAAGCCATGAAGCGCTACGCCCTGGTGCCCGGCACCATCGCCTTTACCGACGCACATATCGAGGTGGACATTACCTACGCCGAGTACTTCGAGATGAGCGTTCGGCTGGCAGAAGCTATGAAGCGCTATGGGCTGAATACAAACCATCGGATCGTGGTGTGCAGCGAGAATAGCTTGCAGTTCTTCATGCCCGTGTTGGGTGCCCTGTTCATCGGTGTGGCTGTGGCCCCAGCTAACGACATCTACAACGAGCGCGAGCTGCTGAACAGCATGGGCATCAGCCAGCCCACCGTCGTATTCGTGAGCAAGAAAGGGCTGCAAAAGATCCTCAACGTGCAAAAGAAGCTACCGATCATACAAAAGATCATCATCATGGATAGCAAGACCGACTACCAGGGCTTCCAAAGCATGTACACCTTCGTGACTTCCCATTTGCCACCCGGCTTCAACGAGTACGACTTCGTGCCCGAGAGCTTCGACCGGGACAAAACCATCGCCCTGATCATGAACAGTAGTGGCAGTACCGGATTGCCCAAGGGCGTAGCCCTACCGCACCGCACCGCTTGTGTCCGATTCAGTCATGCCCGCGACCCCATCTTCGGCAACCAGATCATCCCCGACACCGCTATCCTCAGCGTGGTGCCATTTCACCACGGCTTCGGCATGTTCACCACGCTGGGCTACTTGATCTGCGGCTTTCGGGTCGTGCTCATGTACCGCTTCGAGGAGGAGCTATTCTTGCGCAGCTTGCAAGACTATAAGATTCAATCTGCCCTGCTGGTGCCCACACTATTTAGCTTCTTCGCTAAGAGCACTCTCATCGACAAGTACGACCTAAGCAACTTGCACGAGATCGCCAGCGGCGGGGCGCCGCTCAGCAAGGAGGTAGGTGAGGCCGTGGCCAAACGCTTCCACCTACCAGGCATCCGCCAGGGCTACGGCCTGACAGAAACAACCAGCGCCATTCTGATCACCCCCGAAGGGGACGACAAGCCTGGCGCAGTAGGCAAGGTGGTGCCCTTCTTCGAGGCTAAGGTGGTGGACTTGGACACCGGTAAGACACTGGGTGTGAACCAGCGCGGCGAGCTGTGCGTCCGTGGCCCCATGATCATGAGCGGCTACGTTAACAACCCCGAGGCTACAAACGCTCTCATCGACAAGGACGGCTGGCTGCACAGCGGCGACATCGCCTACTGGGACGAGGACGAGCACTTCTTCATCGTGGACCGGCTGAAGAGCCTGATCAAATACAAGGGCTACCAGGTAGCCCCAGCCGAACTGGAGAGCATCCTGCTGCAACACCCCAACATCTTCGACGCCGGGGTCGCCGGCCTGCCCGACGACGATGCCGGCGAGCTGCCCGCCGCAGTCGTCGTGCTGGAACACGGTAAAACCATGACCGAGAAGGAGATCGTGGACTATGTGGCCAGCCAGGTTACAACCGCCAAGAAGCTGCGCGGTGGTGTTGTGTTCGTGGACGAGGTGCCTAAAGGACTGACCGGCAAGTTGGACGCCCGCAAGATCCGCGAGATTCTCATTAAGGCCAAGAAGGGCGGAAAGATCGCCGTGTAA".to_string(),
            summary: "Codon-optimized Photinus pyralis firefly luciferase (pGL4.10[luc2]) with cryptic TF sites removed; D-luciferin 560 nm emission.".to_string(),
        },
        ModularVectorPart {
            id: "orf-gcamp8f".to_string(),
            name: "jGCaMP8f (Fast Calcium Sensor)".to_string(),
            category: "Reporter / ORF".to_string(),
            sub_category: "Biosensor (Calcium)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (Neurons)".to_string(),
            feature_type: "CDS".to_string(),
            color: "#059669".to_string(),
            nominal_bp: 1350,
            sequence: "ATGGGTTCTCATCATCATCATCATCATGGTATGGCTAGCATGACTGGTGGACAGCAAATGGGTCGGGATCTGTACGACGATGACGATAAGGATCTCGCCACCATGGTCGACTCATCACGTCGTAAGTGGAATAAGGCAGGTCACGCAGTCAGAGCTATAGGTCGGCTGAGCTCACTCGAGAACGTGTACATCAAAGGCCGCAAGCAGAAGAACGGCATCAAGGCGAACTTCAAGATCCGCCACAACATCGAGGACGGCGGCGTGCAGCTCGCCTACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCGTGCAGTCCAAACTTTCGAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGGGTGGTACCGGAGGGAGCATGGACCAACTGACAGAAAGCAGATTGCTGCAGGACTTTCACAAGAAACTGGATAAAGACGGTGATGGTTATATCAGCGCAGAGGAGTTGCAGGTGATGACAAACTTAGGAGAAAAGCTAACAGATGAAGAGGTTGATGAAATGATCAGAGAAGCAGATATTGATGGAGATGGTCAGGTAAACTATGAAGAGTTTGTACAAATGATGACAGCAAAGTGA".to_string(),
            summary: "Janelia 8th-generation fast genetically encoded calcium indicator for millisecond neuronal action potential imaging.".to_string(),
        },
        ModularVectorPart {
            id: "sel-ampr".to_string(),
            name: "AmpR (bla β-Lactamase)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Bacterial Antibiotic".to_string(),
            source: "GenBank L09137.2 (cloning vector pUC19c, complete sequence), minus strand 1,626-2,486".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "CDS".to_string(),
            color: "#DC2626".to_string(),
            nominal_bp: 861,
            sequence: "ATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTGTTTTTGCTCACCCAGAAACGCTGGTGAAAGTAAAAGATGCTGAAGATCAGTTGGGTGCACGAGTGGGTTACATCGAACTGGATCTCAACAGCGGTAAGATCCTTGAGAGTTTTCGCCCCGAAGAACGTTTTCCAATGATGAGCACTTTTAAAGTTCTGCTATGTGGCGCGGTATTATCCCGTATTGACGCCGGGCAAGAGCAACTCGGTCGCCGCATACACTATTCTCAGAATGACTTGGTTGAGTACTCACCAGTCACAGAAAAGCATCTTACGGATGGCATGACAGTAAGAGAATTATGCAGTGCTGCCATAACCATGAGTGATAACACTGCGGCCAACTTACTTCTGACAACGATCGGAGGACCGAAGGAGCTAACCGCTTTTTTGCACAACATGGGGGATCATGTAACTCGCCTTGATCGTTGGGAACCGGAGCTGAATGAAGCCATACCAAACGACGAGCGTGACACCACGATGCCTGTAGCAATGGCAACAACGTTGCGCAAACTATTAACTGGCGAACTACTTACTCTAGCTTCCCGGCAACAATTAATAGACTGGATGGAGGCGGATAAAGTTGCAGGACCACTTCTGCGCTCGGCCCTTCCGGCTGGCTGGTTTATTGCTGATAAATCTGGAGCCGGTGAGCGTGGGTCTCGCGGTATCATTGCAGCACTGGGGCCAGATGGTAAGCCCTCCCGTATCGTAGTTATCTACACGACGGGGAGTCAGGCAACTATGGATGAACGAAATAGACAGATCGCTGAGATAGGTGCCTCACTGATTAAGCATTGGTAA".to_string(),
            summary: "TEM-1 β-lactamase conferring Ampicillin / Carbenicillin resistance (100 µg/mL in E. coli).".to_string(),
        },
        ModularVectorPart {
            id: "sel-kanr".to_string(),
            name: "KanR (aph(3')-IIa)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Bacterial / Dual Antibiotic".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "CDS".to_string(),
            color: "#B91C1C".to_string(),
            nominal_bp: 795,
            sequence: "ATGATTGAACAAGATGGATTGCACGCAGGTTCTCCGGCCGCTTGGGTGGAGAGGCTATTCGGCTATGACTGGGCACAACAGACAATCGGCTGCTCTGATGCCGCCGTGTTCCGGCTGTCAGCGCAGGGGCGCCCGGTTCTTTTTGTCAAGACCGACCTGTCCGGTGCCCTGAATGAACTGCAGGACGAGGCAGCGCGGCTATCGTGGCTGGCCACGACGGGCGTTCCTTGCGCAGCTGTGCTCGACGTTGTCACTGAAGCGGGAAGGGACTGGCTGCTATTGGGCGAAGTGCCGGGGCAGGATCTCCTGTCATCTCACCTTGCTCCTGCCGAGAAAGTATCCATCATGGCTGATGCAATGCGGCGGCTGCATACGCTTGATCCGGCTACCTGCCCATTCGACCACCAAGCGAAACATCGCATCGAGCGAGCACGTACTCGGATGGAAGCCGGTCTTGTCGATCAGGATGATCTGGACGAAGAGCATCAGGGGCTCGCGCCAGCCGAACTGTTCGCCAGGCTCAAGGCGCGCATGCCCGACGGCGAGGATCTCGTCGTGACCCATGGCGATGCCTGCTTGCCGAATATCATGGTGGAAAATGGCCGCTTTTCTGGATTCATCGACTGTGGCCGGCTGGGTGTGGCGGACCGCTATCAGGACATAGCGTTGGCTACCCGTGATATTGCTGAAGAGCTTGGCGGCGAATGGGCTGACCGCTTCCTCGTGCTTTACGGTATCGCCGCTCCCGATTCGCAGCGCATCGCCTTCTATCGCCTTCTTGACGAGTTCTTCTGA".to_string(),
            summary: "Aminoglycoside phosphotransferase conferring Kanamycin (50 µg/mL bacterial) and G418/Neomycin (mammalian) resistance; preferred for GMP/FDA vectors.".to_string(),
        },
        ModularVectorPart {
            id: "sel-cmr".to_string(),
            name: "CmR (cat Chloramphenicol)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Bacterial Antibiotic".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "CDS".to_string(),
            color: "#991B1B".to_string(),
            nominal_bp: 660,
            sequence: "ATGGAGAAAAAAATCACTGGATATACCACCGTTGATATATCCCAATGGCATCGTAAAGAACATTTTGAGGCATTTCAGTCAGTTGCTCAATGTACCTATAACCAGACCGTTCAGCTGGATATTACGGCCTTTTTAAAGACCGTAAAGAAAAATAAGCACAAGTTTTATCCGGCCTTTATTCACATTCTTGCCCGCCTGATGAATGCTCATCCGGAATTCCGTATGGCAATGAAAGACGGTGAGCTGGTGATATGGGATAGTGTTCACCCTTGTTACACCGTTTTCCATGAGCAAACTGAAACGTTTTCATCGCTCTGGAGTGAATACCACGACGATTTCCGGCAGTTTCTACACATATATTCGCAAGATGTGGCGTGTTACGGTGAAAACCTGGCCTATTTCCCTAAAGGGTTTATTGAGAATATGTTTTTCGTCTCAGCCAATCCCTGGGTGAGTTTCACCAGTTTTGATTTAAACGTGGCCAATATGGACAACTTCTTCGCCCCCGTTTTCACCATGGGCAAATATTATACGCAAGGCGACAAGGTGCTGATGCCGCTGGCGATTCAGGTTCATCATGCCGTTTGTGATGGCTTCCATGTCGGCAGAATGCTTAATGAATTACAACAGTACTGCGATGAGTGGCAGGGCGGGGCGTAATAA".to_string(),
            summary: "Chloramphenicol acetyltransferase (25 µg/mL in E. coli); orthogonal marker for p15A / pTwist Chlor co-transformation.".to_string(),
        },
        ModularVectorPart {
            id: "sel-specr".to_string(),
            name: "SpecR (aadA Spectinomycin)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Bacterial / Plant Antibiotic".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli / Agrobacterium".to_string(),
            feature_type: "CDS".to_string(),
            color: "#DC2626".to_string(),
            nominal_bp: 792,
            sequence: "ATGAGGGAAGCGGTGATCGCCGAAGTATCGACTCAACTATCAGAGGTAGTTGGCGTCATCGAGCGCCATCTCGAACCGACGTTGCTGGCCGTACATTTGTACGGCTCCGCAGTGGATGGCGGCCTGAAGCCACACAGTGATATTGATTTGCTGGTTACGGTGACCGTAAGGCTTGATGAAACAACGCGGCGAGCTTTGATCAACGACCTTTTGGAAACTTCGGCTTCCCCTGGAGAGAGCGAGATTCTCCGCGCTGTAGAAGTCACCATTGTTGTGCACGACGACATCATTCCGTGGCGTTATCCAGCTAAGCGCGAACTGCAATTTGGAGAATGGCAGCGCAATGACATTCTTGCAGGTATCTTCGAGCCAGCCACGATCGACATTGATCTGGCTATCTTGCTGACAAAAGCAAGAGAACATAGCGTTGCCTTGGTAGGTCCAGCGGCGGAGGAACTCTTTGATCCGGTTCCTGAACAGGATCTATTTGAGGCGCTAAATGAAACCTTAACGCTATGGAACTCGGCCCGCCGACTGGGCTGGCGATGAGCGAAATGTAGTGCTTACGTTGTCCCGCATTTGGTACAGCGCAGTAACCGGCAAAATCGCGCCGAAGGATGTCGCTGCCGACTGGGCAATGGAGCGCCTGCCGGCCCAGTATCAGCCCGTCATACTTGAAGCTAGACAGGCTTATCTTGGACAAGAAGAAGATCGCTTGGCCTCGCGCGCAGATCAGTTGGAAGAATTTGTCCACTACGTGAAAGGCGAGATCACCAAGGTAGTCGGCAAATAA".to_string(),
            summary: "Aminoglycoside adenylyltransferase conferring Spectinomycin (100 µg/mL) and Streptomycin resistance.".to_string(),
        },
        ModularVectorPart {
            id: "sel-puror".to_string(),
            name: "PuroR (pac Puromycin)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Mammalian Selection".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "CDS".to_string(),
            color: "#EA580C".to_string(),
            nominal_bp: 600,
            sequence: "ATGACCGAGTACAAGCCCACGGTGCGCCTCGCCACCCGCGACGACGTCCCCAGGGCCGTACGCACCCTCGCCGCCGCGTTCGCCGACTACCCCGCCACGCGCCACACCGTCGATCCGGACCGCCACATCGAGCGGGTCACCGAGCTGCAAGAACTCTTCCTCACGCGCGTCGGGCTCGACATCGGCAAGGTGTGGGTCGCGGACGACGGCGCCGCGGTGGCGGTCTGGACCACGCCGGAGAGCGTCGAAGCGGGGGCGGTGTTCGCCGAGATCGGCCCGCGCATGGCCGAGTTGAGCGGTTCCCGGCTGGCCGCGCAGCAACAGATGGAAGGCCTCCTGGCGCCGCACCGGCCCAAGGAGCCCGCGTGGTTCCTGGCCACCGTCGGCGTCTCGCCCGACCACCAGGGCAAGGGTCTGGGCAGCGCCGTCGTGCTCCCCGGAGTGGAGGCGGCCGAGCGCGCCGGGGTGCCCGCCTTCCTGGAGACCTCCGCGCCCCGCAACCTCCCCTTCTACGAGCGGCTCGGCTTCACCGTCACCGCCGACGTCGAGGTGCCCGAAGGACCGCGCACCTGGTGCATGACCCGCAAGCCCGGTGCCTGA".to_string(),
            summary: "Streptomyces puromycin N-acetyltransferase; rapid 2–4 day mammalian stable cell selection (1–5 µg/mL puromycin).".to_string(),
        },
        ModularVectorPart {
            id: "sel-hygror".to_string(),
            name: "HygroR (hph Hygromycin B)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Mammalian / Plant Selection".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / Plant".to_string(),
            feature_type: "CDS".to_string(),
            color: "#D97706".to_string(),
            nominal_bp: 1026,
            sequence: "ATGAAAAAGCCTGAACTCACCGCGACGTCTGTCGAGAAGTTTCTGATCGAAAAGTTCGACAGCGTCTCCGACCTGATGCAGCTCTCGGAGGGCGAAGAATCTCGTGCTTTCAGCTTCGATGTAGGAGGGCGTGGATATGTCCTGCGGGTAAATAGCTGCGCCGATGGTTTCTACAAAGATCGTTATGTTTATCGGCACTTTGCATCGGCCGCGCTCCCGATTCCGGAAGTGCTTGACATTGGGGAATTCAGCGAGAGCCTGACCTATTGCATCTCCCGCCGTGCACAGGGTGTCACGTTGCAAGACCTGCCTGAAACCGAACTGCCCGCTGTTCTGCAGCCGGTCGCGGAGGCCATGGATGCGATCGCTGCGGCCGATCTTAGCCAGACGAGCGGGTTCGGCCCATTCGGACCGCAAGGAATCGGTCAATACACTACATGGCGTGATTTCATATGCGCGATTGCTGATCCCCATGTGTATCACTGGCAAACTGTGATGGACGACACCGTCAGTGCGTCCGTCGCGCAGGCTCTCGATGAGCTGATGCTTTGGGCCGAGGACTGCCCCGAAGTCCGGCACCTCGTGCACGCGGATTTCGGCTCCAACAATGTCCTGACGGACAATGGCCGCATAACAGCGGTCATTGACTGGAGCGAGGCGATGTTCGGGGATTCCCAATACGAGGTCGCCAACATCTTCTTCTGGAGGCCGTGGTTGGCTTGTATGGAGCAGCAGACGCGCTACTTCGAGCGGAGGCATCCGGAGCTTGCAGGATCGCCGCGGCTCCGGGCGTATATGCTCCGCATTGGTCTTGACCAACTCTATCAGAGCTTGGTTGACGGCAATTTCGATGATGCAGCTTGGGCGCAGGGTCGATGCGACGCAATCGTCCGATCCGGAGCCGGGACTGTCGGGCGTACACAAATCGCCCGCAGAAGCGCGGCCGTCTGGACCGATGGCTGTGTAGAAGTACTCGCCGATAGTGGAAACCGACGCCCCAGCACTCGTCCGAGGGCAAAGGAATAG".to_string(),
            summary: "Hygromycin B phosphotransferase (100–400 µg/mL mammalian; 25–50 µg/mL plant transgenic selection).".to_string(),
        },
        ModularVectorPart {
            id: "sel-bsdr".to_string(),
            name: "BsdR (Blasticidin S)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Mammalian / Bacterial Selection".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / E. coli".to_string(),
            feature_type: "CDS".to_string(),
            color: "#EA580C".to_string(),
            nominal_bp: 399,
            sequence: "ATGGCCAAGCCTTTGTCTCAAGAAGAATCCACCCTCATTGAAAGAGCAACGGCTACAATCAACAGCATCCCCATCTCTGAAGACTACAGCGTCGCCAGCGCAGCTCTCTCTAGCGACGGCCGCATCTTCACTGGTGTCAATGTATATCATTTTACTGGGGGACCTTGTGCAGAACTCGTGGTGCTGGGCACTGCTGCTGCTGCGGCAGCTGGCAACCTGACTTGTATCGTCGCGATCGGAAATGAGAACAGGGGCATCTTGAGCCCCTGCGGACGGTGCCGACAGGTGCTTCTCGATCTGCATCCTGGGATCAAAGCCATAGTGAAGGACAGTGATGGACAGCCGACGGCAGTTGGGATTCGTGAATTGCTGCCCTCTGGTTATGTGTGGGAGGGCTAA".to_string(),
            summary: "Ultra-compact 399 bp Blasticidin S deaminase; fast 3–5 day mammalian selection (5–10 µg/mL; Twist production 100 µg/mL).".to_string(),
        },
        ModularVectorPart {
            id: "sel-zeor".to_string(),
            name: "ZeoR / BleoR (Sh ble Zeocin)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Dual Bacterial / Yeast / Mammalian".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli / Yeast / Mammalian".to_string(),
            feature_type: "CDS".to_string(),
            color: "#EA580C".to_string(),
            nominal_bp: 375,
            sequence: "ATGGCCAAGTTGACCAGTGCCGTTCCGGTGCTCACCGCGCGCGACGTCGCCGGAGCGGTCGAGTTCTGGACCGACCGGCTCGGGTTCTCCCGGGACTTCGTGGAGGACGACTTCGCCGGTGTGGTCCGGGACGACGTGACCCTGTTCATCAGCGCGGTCCAGGACCAGGTGGTGCCGGACAACACCCTGGCCTGGGTGTGGGTGCGCGGCCTGGACGAGCTGTACGCCGAGTGGTCGGAGGTCGTGTCCACGAACTTCCGGGACGCCTCCGGGCCGGCCATGACCGAGATCGGCGAGCAGCCGTGGGGGCGGGAGTTCGCCCTGCGCGACCCGGCCGGCAACTGCGTGCACTTCGTGGCCGAGGAGCAGGACTGA".to_string(),
            summary: "375 bp Streptoalloteichus hindustanus bleomycin binding protein; works across E. coli, Pichia pastoris (pPICZ), and mammalian cells (50–200 µg/mL Zeocin).".to_string(),
        },
        ModularVectorPart {
            id: "sel-ura3".to_string(),
            name: "URA3 (Yeast Auxotrophic)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Yeast Auxotrophy / 5-FOA".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "S. cerevisiae".to_string(),
            feature_type: "CDS".to_string(),
            color: "#D97706".to_string(),
            nominal_bp: 804,
            sequence: "ATGTCGAAAGCTACATATAAGGAACGTGCTGCTACTCATCCTAGTCCTGTTGCTGCCAAGCTATTTAATATCATGCACGAAAAGCAAACAAACTTGTGTGCTTCATTGGATGTTCGTACCACCAAGGAATTACTGGAGTTAGTTGAAGCATTAGGTCCCAAAATTTGTTTACTAAAAACACATGTGGATATCTTGACTGATTTTTCCATGGAGGGCACAGTTAAGCCGCTAAAGGCATTATCCGCCAAGTACAATTTTTTACTCTTCGAAGACAGAAAATTTGCTGACATTGGTAATACAGTCAAATTGCAGTACTCTGCGGGTGTATACAGAATAGCAGAATGGGCAGACATTACGAATGCACACGGTGTGGTGGGCCCAGGTATTGTTAGCGGTTTGAAGCAGGCGGCAGAAGAAGTAACAAAGGAACCTAGAGGCCTTTTGATGTTAGCAGAATTGTCATGCAAGGGCTCCCTAGCTACTGGAGAATATACTAAGGGTACTGTTGACATTGCGAAGAGCGACAAAGATTTTGTTATCGGCTTTATTGCTCAAAGAGACATGGGTGGAAGAGATGAAGGTTACGATTGGTTGATTATGACACCCGGTGTGGGTTTAGATGACAAGGGAGACGCATTGGGTCAACAGTATAGAACCGTGGATGATGTGGTCTCTACAGGATCTGACATTATTATTGTTGGAAGAGGACTATTTGCAAAGGGAAGGGATGCTAAGGTAGAGGGTGAACGTTACAGAAAAGCAGGCTGGGAAGCATATTTGAGAAGATGCGGCCAGCAAAACTAA".to_string(),
            summary: "Orotidine-5'-phosphate decarboxylase; positive selection on SC-Ura media and counter-selection on 5-FOA.".to_string(),
        },
        ModularVectorPart {
            id: "sel-ccdb".to_string(),
            name: "ccdB (Gateway Negative Marker)".to_string(),
            category: "Selection Marker".to_string(),
            sub_category: "Bacterial Counter-Selection".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli (ccdB Survival)".to_string(),
            feature_type: "CDS".to_string(),
            color: "#991B1B".to_string(),
            nominal_bp: 306,
            sequence: "ATGCAGTTTAAGGTTTACACCTATAAAAGAGAGAGCCGTTATCGTCTGTTTGTGGATGTACAGAGTGATATTATTGACACGCCCGGGCGACGGATGGTGATCCCCCTGGCCAGTGCACGTCTGCTGTCAGATAAAGTCTCCCGTGAACTTTACCCGGTGGTGCATATCGGGGATGAAAGCTGGCGCATGATGACCACCGATATGGCCAGTGTGCCGGTCTCCGTTATCGGGGAAGAAGTGGCTGATCTCAGCCACCGCGAAAATGACATCAAAAACGCCATTAACCTGATGTTCTGGGGAATATAA".to_string(),
            summary: "DNA gyrase toxin killing standard DH5α/TOP10 cells; enforces >99% recombinant efficiency in Gateway pDEST/pDONR vectors (forbidden in final Twist clonal vectors).".to_string(),
        },
        ModularVectorPart {
            id: "ori-puc".to_string(),
            name: "pUC Origin (High Copy ~500–700)".to_string(),
            category: "Origin".to_string(),
            sub_category: "ColE1 Group (IncG/pMB1)".to_string(),
            source: "GenBank L09137.2 (cloning vector pUC19c, complete sequence), minus strand 807-1,455".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#F59E0B".to_string(),
            nominal_bp: 589,
            sequence: "TTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTTCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATG".to_string(),
            summary: "G->A mutated pMB1 origin lacking functional Rom/Rop regulation (~500–700 copies/cell); Twist High-Copy Accepted.".to_string(),
        },
        ModularVectorPart {
            id: "ori-pbr322".to_string(),
            name: "pBR322 / pMB1 Origin (Med ~15–20)".to_string(),
            category: "Origin".to_string(),
            sub_category: "ColE1 Group (IncG/pMB1)".to_string(),
            source: "GenBank J01749.1 (cloning vector pBR322, complete sequence), minus strand 2,474-3,122".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#D97706".to_string(),
            nominal_bp: 589,
            sequence: "TTGAGATCCTTTTTTTCTGCGCGTAATCTGCTGCTTGCAAACAAAAAAACCACCGCTACCAGCGGTGGTTTGTTTGCCGGATCAAGAGCTACCAACTCTTTTTCCGAAGGTAACTGGCTTCAGCAGAGCGCAGATACCAAATACTGTCCTTCTAGTGTAGCCGTAGTTAGGCCACCACTTCAAGAACTCTGTAGCACCGCCTACATACCTCGCTCTGCTAATCCTGTTACCAGTGGCTGCTGCCAGTGGCGATAAGTCGTGTCTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACGGGGGGTTCGTGCACACAGCCCAGCTTGGAGCGAACGACCTACACCGAACTGAGATACCTACAGCGTGAGCTATGAGAAAGCGCCACGCTTCCCGAAGGGAGAAAGGCGGACAGGTATCCGGTAAGCGGCAGGGTCGGAACAGGAGAGCGCACGAGGGAGCTTCCAGGGGGAAACGCCTGGTATCTTTATAGTCCTGTCGGGTTTCGCCACCTCTGACTTGAGCGTCGATTTTTGTGATGCTCGTCAGGGGGGCGGAGCCTATGGAAAAACGCCAGCAACGCGGCCTTTTTACGGTTCCTGGCCTTTTGCTGGCCTTTTGCTCACATG".to_string(),
            summary: "Wild-type pMB1 origin (~15–40 copies/cell with rop); used in pET and pBR322 to limit metabolic toxicity; Twist Accepted.".to_string(),
        },
        ModularVectorPart {
            id: "ori-p15a".to_string(),
            name: "p15A Origin (Medium Copy ~10–15)".to_string(),
            category: "Origin".to_string(),
            sub_category: "IncP15A (Orthogonal to ColE1)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#B45309".to_string(),
            nominal_bp: 545,
            sequence: "GCGCTAGCGGAGTGTATACTGGCTTACTATGTTGGCACTGATGAGGGTGTCAGTGAAGTGCTTCATGTGGCAGGAGAAAAAAGGCTGCACCGGTGCGTCAGCAGAATATGTGATACAGGATATATTCCGCTTCCTCGCTCACTGACTCGCTACGCTCGGTCGTTCGACTGCGGCGAGCGGAAATGGCTTACGAACGGGGCGGAGATTTCCTGGAAGATGCCAGGAAGATACTTAACAGGGAAGTGAGAGGGCCGCGGCAAAGCCGTTTTTCCATAGGCTCCGCCCCCCTGACAAGCATCACGAAATCTGACGCTCAAATCAGTGGTGGCGAAACCCGACAGGACTATAAAGATACCAGGCGTTTCCCCCTGGCGGCTCCCTCGTGCGCTCTCCTGTTCCTGCCTTTCGGTTTACCGGTGTCATTCCGCTGTTATGGCCGCGTTTGTCTCATTCCACGCCTGACACTCAGTTCCGGGTAGGCAGTTCGCTCCAAGCTGGACTGTATGCACGAACCCCCCGTTCAGTCCGACCGCTGCGCCTTATCCGGTAACTATCGTCTTGAGTCCAACCCGGAAAGACATGCAAAAGCACCACTGGCAGCAGCCACTGGTAATTGATTTAGAGGAGTTAGTCTTGAAGTCATGCGCCGGTTAAGGCTAAACTGAAAGAACAGATTTGGTGAGTGC".to_string(),
            summary: "pACYC184 / pTwist Medium Copy origin (~10–15 copies/cell); compatible with pUC/pET/ColE1 for dual-plasmid co-transformation.".to_string(),
        },
        ModularVectorPart {
            id: "ori-psc101".to_string(),
            name: "pSC101 Origin (Low Copy ~5)".to_string(),
            category: "Origin".to_string(),
            sub_category: "IncX / RepA Low Copy".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#92400E".to_string(),
            nominal_bp: 380,
            sequence: "GACAGTAAGACGGGTAAGCCTGTTGATGATACCGCTGCCTTACTGGGTGCATTAGCCAGTCTGAATGACCTGTCACGGGATAATCCGAAGTGGTCAGACTGGAAAATCAGAGGGCAGGAACTGCTGAACAGCAAAAAGTCAGATAGCACCACATAGCAGACCCGCCATAAAACGCCCTGAGAAGCCCGTGACGGGCTTTTCTTGTATTATGGGTAGTTTCCTTGCATGAATCCATAAAAGGCGCCTGTAGTGCCATTTACCCCCATTCACTGCCAGAGCCGTGAGCGCAGCGAACTGAATGTCACGAAAAAGACAGCGACTCAGGTGCCTGATGGTCGGAGACAAAAGGAATATTCAGCGATTTGCCCGAGCTTGCGAGG".to_string(),
            summary: "Stringent RepA-dependent low-copy (~5 copies/cell) origin for toxic inserts (Note: Rejected by Twist Custom Vector Onboarding).".to_string(),
        },
        ModularVectorPart {
            id: "ori-sv40".to_string(),
            name: "SV40 Origin".to_string(),
            category: "Origin".to_string(),
            sub_category: "Mammalian Episomal".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (HEK293T/COS-7)".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#F59E0B".to_string(),
            nominal_bp: 136,
            sequence: "ATCCCGCCCCTAACTCCGCCCAGTTCCGCCCATTCTCCGCCCCATGGCTGACTAATTTTTTTTATTTATGCAGAGGCCGAGGCCGCCTCGGCCTCTGAGCTATTCCAGAAGTAGTGAGGAGGCTTTTTTGGAGGCCTAGGCTTTTGCAAAAAGCTA".to_string(),
            summary: "Simian virus 40 origin driving high-copy episomal amplification in Large T-antigen positive cells (HEK293T, COS-7).".to_string(),
        },
        ModularVectorPart {
            id: "ori-orip".to_string(),
            name: "EBV OriP".to_string(),
            category: "Origin".to_string(),
            sub_category: "Mammalian Episomal".to_string(),
            source: "GenBank V01555.2 (Epstein-Barr virus strain B95-8, complete genome), plus strand 7,450-7,835".to_string(),
            host_system: "Mammalian (EBNA1+)".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#F59E0B".to_string(),
            nominal_bp: 320,
            sequence: "AGGATAGCATATGCTACCCGGATACAGATTAGGATAGCATATACTACCCAGATATAGATTAGGATAGCATATGCTACCCAGATATAGATTAGGATAGCCTATGCTACCCAGATATAAATTAGGATAGCATATACTACCCAGATATAGATTAGGATAGCATATGCTACCCAGATATAGATTAGGATAGCCTATGCTACCCAGATATAGATTAGGATAGCATATGCTACCCAGATATAGATTAGGATAGCATATGCTATCCAGATATTTGGGTAGTATATGCTACCCAGATATAAATTAGGATAGCATATACTACCCTAATCTCTATTAGGATAGCATATGCTACCCGGATACAGATTAGGATAGCATATACTACCCAGATATAGATT".to_string(),
            summary: "Epstein-Barr virus FR+DS episomal maintenance element (pTwist CMV OriP); sustains long-term extrachromosomal expression in HEK293-EBNA1.".to_string(),
        },
        ModularVectorPart {
            id: "ori-2micron".to_string(),
            name: "Yeast 2μ Origin (High Copy)".to_string(),
            category: "Origin".to_string(),
            sub_category: "Yeast Episomal".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "S. cerevisiae".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#D97706".to_string(),
            nominal_bp: 420,
            sequence: "AACGAAGCATCTGTGCTTCATTTTGTAGAACAAAAATGCAACGCGAGAGCGCTAATTTTTCAAACAAAGAATCTGAGCTGCATTTTTACAGAACAGAAATGCAACGCGAAAGCGCTATTTTACCAACGAAGAATCTGTGCTTCATTTTTGTAAAACAAAAATGCAACGCGAGAGCGCTAATTTTTCAAACAAAGAATCTGAGCTGCATTTTTACAGAACAGAAATGCAACGCGAGAGCGCTATTTTACCAACAAAGAATCTATACTTCTTTTTTGTTCTACAAAAATGCATCCCGAGAGCGCTATTTTTCTAACAAAGCATCTTAGATTACTTTTTTTCTCCTTTGTGCGCTCTATAATGCAGTCTCTTGATAACTTTTTGCACTGTAGGTCCGTTAAGGTTAGAAGAAGGCTACTTTGG".to_string(),
            summary: "Multi-copy (~50–100 copies/cell) yeast episomal 2-micron origin (pYES2 / pRS425).".to_string(),
        },
        ModularVectorPart {
            id: "ori-cenars".to_string(),
            name: "CEN6/ARS4 (Yeast Single-Copy)".to_string(),
            category: "Origin".to_string(),
            sub_category: "Yeast Centromeric".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "S. cerevisiae".to_string(),
            feature_type: "rep_origin".to_string(),
            color: "#B45309".to_string(),
            nominal_bp: 506,
            sequence: "ATCACGTGCTATAAAAATAATTATAATTTAAATTTTTTAATATAAATATATAAATTAAAAATAGAAAGTAAAAAAAGAAATTAAAGAAAAAATAGTTTTTGTTTTCCGAAGATGTAAAAGACTCTAGGGGGATCGCCAACAAATACTACCTTTTATCTTGCTCTTCCTGCTCTCAGGTATTAATGCCGAATTGTTTCATCTTGTCTGTGTAGAAGACCACACACGAAAATCCTGTGATTTTACATTTTACTTATCGTTAATCGAATGTATATCTATTTAATCTGCTTTTCTTGTCTAATAAATATATATGTAAAGTACGCTTTTTGTTGAAATTTTTTAAACCTTTGTTTATTTTTTTTCTTCATTCCGTAACTCTTCTACCTTCTTTATTTACTTTCTAAAATCCAAATACAAAACATAAAAATAAATAAACACAGAGTAAATTCCCAAATTATTCCATCATTAAAAGATACGAGGCGCGTGTAAGTTACAGGCAAGCGATCCGTC".to_string(),
            summary: "Yeast centromere + autonomously replicating sequence (pRS415); stable mitotic segregation at 1–2 copies/cell.".to_string(),
        },
        ModularVectorPart {
            id: "tag-6xhis".to_string(),
            name: "6xHis Tag".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "IMAC Affinity".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "tag".to_string(),
            color: "#8B5CF6".to_string(),
            nominal_bp: 18,
            sequence: "CATCACCATCACCATCAC".to_string(),
            summary: "Hexahistidine Ni-NTA / Co-TALON IMAC purification tag (0.8 kDa).".to_string(),
        },
        ModularVectorPart {
            id: "tag-10xhis".to_string(),
            name: "10xHis Tag".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "High-Stringency IMAC".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "tag".to_string(),
            color: "#8B5CF6".to_string(),
            nominal_bp: 30,
            sequence: "CACCATCACCATCACCATCACCATCACCAT".to_string(),
            summary: "Decahistidine tag allowing high-imidazole washes for membrane and mammalian secreted proteins.".to_string(),
        },
        ModularVectorPart {
            id: "tag-flag".to_string(),
            name: "FLAG Tag (DYKDDDDK)".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Epitope / Enterokinase".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "tag".to_string(),
            color: "#A855F7".to_string(),
            nominal_bp: 24,
            sequence: "GACTACAAGGACGACGATGACAAG".to_string(),
            summary: "Hydrophilic 8-aa anti-FLAG M2 epitope tag with built-in Enterokinase cleavage site.".to_string(),
        },
        ModularVectorPart {
            id: "tag-3xflag".to_string(),
            name: "3xFLAG Tag".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Ultra-Sensitive Epitope".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "tag".to_string(),
            color: "#A855F7".to_string(),
            nominal_bp: 66,
            sequence: "GACTACAAAGACCATGACGGTGATTATAAAGATCATGACATCGACTACAAGGATGACGATGACAAG".to_string(),
            summary: "Tandem 22-aa 3xFLAG epitope; 20–200x higher detection sensitivity for ChIP, Co-IP, and endogenous knock-in.".to_string(),
        },
        ModularVectorPart {
            id: "tag-ha".to_string(),
            name: "HA Tag (YPYDVPDYA)".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Epitope".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "tag".to_string(),
            color: "#A855F7".to_string(),
            nominal_bp: 27,
            sequence: "TACCCATACGATGTTCCAGATTACGCT".to_string(),
            summary: "Influenza hemagglutinin 9-aa epitope tag for Western blot, IF, and Co-IP.".to_string(),
        },
        ModularVectorPart {
            id: "tag-myc".to_string(),
            name: "c-Myc Tag (EQKLISEEDL)".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Epitope".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "tag".to_string(),
            color: "#A855F7".to_string(),
            nominal_bp: 30,
            sequence: "GAACAAAAACTCATCTCAGAAGAGGATCTG".to_string(),
            summary: "Human c-Myc 10-aa 9E10 monoclonal antibody epitope tag.".to_string(),
        },
        ModularVectorPart {
            id: "tag-v5".to_string(),
            name: "V5 Tag".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Epitope".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / Yeast".to_string(),
            feature_type: "tag".to_string(),
            color: "#A855F7".to_string(),
            nominal_bp: 42,
            sequence: "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG".to_string(),
            summary: "Paramyxovirus SV5 GKPIPNPLLGLDST 14-aa high-affinity epitope tag (pYES2/pcDNA3.1-V5).".to_string(),
        },
        ModularVectorPart {
            id: "tag-strepii".to_string(),
            name: "Twin-Strep-tag".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Strep-Tactin XT Affinity".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "tag".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 84,
            sequence: "TGGAGCCACCCGCAGTTCGAGAAAGGTGGAGGTTCCGGAGGTGGATCGGGAGGTTCGGCGTGGAGCCACCCGCAGTTCGAAAAA".to_string(),
            summary: "Tandem WSHPQFEK Strep-tag II for picomolar Strep-Tactin XT physiological affinity purification (desthiobiotin elution).".to_string(),
        },
        ModularVectorPart {
            id: "tag-avitag".to_string(),
            name: "AviTag (BirA Biotinylation)".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Site-Specific Biotinylation".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "tag".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 45,
            sequence: "GGCCTGAACGACATCTTCGAGGCTCAGAAAATCGAATGGCACGAA".to_string(),
            summary: "15-aa GLNDIFEAQKIEWHE acceptor peptide enzymatically biotinylated by E. coli BirA ligase for SPR/streptavidin capture.".to_string(),
        },
        ModularVectorPart {
            id: "tag-sumo".to_string(),
            name: "SUMO (Smt3 Solubility Tag)".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Solubility / Scarless Cleavage".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "tag".to_string(),
            color: "#6D28D9".to_string(),
            nominal_bp: 294,
            sequence: "ATGTCGGACTCAGAAGTCAATCAAGAAGCTAAGCCAGAGGTCAAGCCAGAAGTCAAGCCTGAGACTCACATCAATTTAAAGGTGTCCGATGGATCTTCAGAGATCTTCTTCAAGATCAAAAAGACCACTCCTTTAAGAAGGCTGATGGAAGCGTTCGCTAAAAGACAGGGTAAGGAAATGGACTCCTTAAGATTCTTGTACGACGGTATTAGAATTCAAGCTGATCAGACCCCTGAAGATTTGGACATGGAGGATAACGATATTATTGAGGCTCACAGAGAACAGATTGGTGGT".to_string(),
            summary: "Yeast Smt3 chaperone tag (~11 kDa) enhancing E. coli soluble folding; Ulp1 protease cleaves immediately after C-terminal Gly-Gly leaving zero scar.".to_string(),
        },
        ModularVectorPart {
            id: "tag-gst".to_string(),
            name: "GST (Schistosoma 26 kDa Tag)".to_string(),
            category: "Affinity & Fusion Tag".to_string(),
            sub_category: "Solubility & Glutathione Affinity".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "tag".to_string(),
            color: "#6D28D9".to_string(),
            nominal_bp: 660,
            sequence: "ATGTCCCCTATACTAGGTTATTGGAAAATTAAGGGCCTTGTGCAACCCACTCGACTTCTTTTGGAATATCTTGAAGAAAAATATGAAGAGCATTTGTATGAGCGCGATGAAGGTGATAAATGGCGAAACAAAAAGTTTGAATTGGGTTTGGAGTTTCCCAATCTTCCTTATTATATTGATGGTGATGTTAAATTAACACAGTCTATGGCCATCATACGTTATATAGCTGACAAGCACAACATGTTGGGTGGTTGTCCAAAAGAGCGTGCAGAGATTTCAATGCTTGAAGGAGCGGTTTTGGATATTAGATACGGTGTTTCGAGAATTGCATATAGTAAAGACTTTGAAACTCTCAAAGTTGATTTTCTTAGCAAGCTACCTGAAATGCTGAAAATGTTCGAAGATCGTTTATGTCATAAAACATATTTAAATGGTGATCATGTAACCCATCCTGACTTCATGTTGTATGACGCTCTTGATGTTGTTTTATACATGGACCCAATGTGCCTGGATGCGTTCCCAAAATTAGTTTGTTTTAAAAAACGTATTGAAGCTATCCCACAAATTGATAAGTACTTGAAATCCAGCAAGTATATAGCATGGCCTTTGCAGGGCTGGCAAGCCACGTTTGGTGGTGGCGACCATCCTCCAAAATCG".to_string(),
            summary: "Glutathione S-transferase tag (pGEX-4T-1); glutathione-Sepharose affinity capture and pull-down assays.".to_string(),
        },
        ModularVectorPart {
            id: "prot-tev".to_string(),
            name: "TEV Protease Site (ENLYFQ/G)".to_string(),
            category: "Protease Cleavage".to_string(),
            sub_category: "Sequence-Specific Protease".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#EC4899".to_string(),
            nominal_bp: 21,
            sequence: "GAGAACCTGTACTTCCAGGGC".to_string(),
            summary: "Tobacco Etch Virus protease site; stringent cleavage between Gln and Gly/Ser.".to_string(),
        },
        ModularVectorPart {
            id: "prot-hrv3c".to_string(),
            name: "HRV 3C / PreScission Site".to_string(),
            category: "Protease Cleavage".to_string(),
            sub_category: "Cold-Active 4°C Protease".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#EC4899".to_string(),
            nominal_bp: 24,
            sequence: "CTGGAAGTTCTGTTCCAGGGGCCC".to_string(),
            summary: "Human rhinovirus 3C protease recognition site (LEVLFQ/GP); active at 4°C for labile proteins.".to_string(),
        },
        ModularVectorPart {
            id: "prot-thrombin".to_string(),
            name: "Thrombin Site (LVPR/GS)".to_string(),
            category: "Protease Cleavage".to_string(),
            sub_category: "Serine Protease".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#EC4899".to_string(),
            nominal_bp: 18,
            sequence: "CTGGTGCCGCGCGGCAGC".to_string(),
            summary: "Canonical pET-28a(+) / pGEX-4T-1 thrombin cleavage motif.".to_string(),
        },
        ModularVectorPart {
            id: "prot-factorxa".to_string(),
            name: "Factor Xa Site (IEGR/)".to_string(),
            category: "Protease Cleavage".to_string(),
            sub_category: "Scarless N-Terminus".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#EC4899".to_string(),
            nominal_bp: 12,
            sequence: "ATCGAAGGTCGT".to_string(),
            summary: "pMAL-c5X Factor Xa cleavage site cutting immediately C-terminal to Arg with zero extra residues.".to_string(),
        },
        ModularVectorPart {
            id: "lnk-3xggggs".to_string(),
            name: "(GGGGS)3 Flexible Linker".to_string(),
            category: "Linker / 2A / IRES".to_string(),
            sub_category: "Flexible Peptide Linker".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#14B8A6".to_string(),
            nominal_bp: 45,
            sequence: "GGTGGCGGTGGCTCGGGCGGTGGTGGGTCGGGTGGCGGCGGATCT".to_string(),
            summary: "Standard 15-aa Gly-Ser flexible linker for scFvs, fusion reporters, and CAR hinges.".to_string(),
        },
        ModularVectorPart {
            id: "lnk-eaaak3".to_string(),
            name: "(EAAAK)3 Rigid α-Helical Linker".to_string(),
            category: "Linker / 2A / IRES".to_string(),
            sub_category: "Rigid Helical Spacer".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#14B8A6".to_string(),
            nominal_bp: 45,
            sequence: "GAAGCTGCAGCTAAGGAAGCAGCCGCAAAAGAGGCAGCGGCCAAA".to_string(),
            summary: "Salt-bridge-stabilized α-helical spacer maintaining fixed domain separation.".to_string(),
        },
        ModularVectorPart {
            id: "lnk-p2a".to_string(),
            name: "GSG-P2A (Porcine Teschovirus 2A)".to_string(),
            category: "Linker / 2A / IRES".to_string(),
            sub_category: "Bicistrons (Ribosomal Skip)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / Zebrafish".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#0D9488".to_string(),
            nominal_bp: 66,
            sequence: "GGAAGCGGAGCTACTAACTTCAGCCTGCTGAAGCAGGCTGGAGACGTGGAGGAGAACCCTGGACCT".to_string(),
            summary: "Highest ribosome-skipping efficiency (>95%) in human, mouse, and zebrafish cells for 1:1 stoichiometric co-expression.".to_string(),
        },
        ModularVectorPart {
            id: "lnk-t2a".to_string(),
            name: "GSG-T2A (Thosea asigna 2A)".to_string(),
            category: "Linker / 2A / IRES".to_string(),
            sub_category: "Bicistrons (Ribosomal Skip)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / Insect".to_string(),
            feature_type: "misc_feature".to_string(),
            color: "#0D9488".to_string(),
            nominal_bp: 63,
            sequence: "GGAAGCGGAGAGGGCAGAGGAAGTCTGCTAACATGCGGTGACGTCGAGGAGAATCCTGGACCT".to_string(),
            summary: "63 bp 2A peptide; orthogonal sequence to P2A to prevent recombination in tricistronic P2A + T2A vectors.".to_string(),
        },
        ModularVectorPart {
            id: "lnk-ires".to_string(),
            name: "EMCV IRES".to_string(),
            category: "Linker / 2A / IRES".to_string(),
            sub_category: "Cap-Independent Translation".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#0F766E".to_string(),
            nominal_bp: 585,
            sequence: "GCCCCTCTCCCTCCCCCCCCCCTAACGTTACTGGCCGAAGCCGCTTGGAATAAGGCCGGTGTGCGTTTGTCTATATGTTATTTTCCACCATATTGCCGTCTTTTGGCAATGTGAGGGCCCGGAAACCTGGCCCTGTCTTCTTGACGAGCATTCCTAGGGGTCTTTCCCCTCTCGCCAAAGGAATGCAAGGTCTGTTGAATGTCGTGAAGGAAGCAGTTCCTCTGGAAGCTTCTTGAAGACAAACAACGTCTGTAGCGACCCTTTGCAGGCAGCGGAACCCCCCACCTGGCGACAGGTGCCTCTGCGGCCAAAAGCCACGTGTATAAGATACACCTGCAAAGGCGGCACAACCCCAGTGCCACGTTGTGAGTTGGATAGTTGTGGAAAGAGTCAAATGGCTCTCCTCAAGCGTATTCAACAAGGGGCTGAAGGATGCCCAGAAGGTACCCCATTGTATGGGATCTGATCTGGGGCCTCGGTGCACATGCTTTACATGTGTTTAGTCGAGGTTAAAAAAACGTCTAGGCCCCCCGAACCACGGGGACGTGGTTTTCCTTTGAAAAACACGATGATAAT".to_string(),
            summary: "Encephalomyocarditis virus internal ribosome entry site (pIRES2-EGFP / pWPI); drives native untagged downstream translation (~20–50% of cap cistron).".to_string(),
        },
        ModularVectorPart {
            id: "sig-kozak".to_string(),
            name: "Kozak Consensus (GCCACC)".to_string(),
            category: "Signal & Localization".to_string(),
            sub_category: "Eukaryotic Ribosome Init".to_string(),
            source: "Kozak initiation consensus, printed 5'-GCCACC-3' by Kozak M, Nucleic Acids Res 15(20):8125-8148 (1987), doi:10.1093/nar/15.20.8125".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#06B6D4".to_string(),
            nominal_bp: 6,
            sequence: "GCCACC".to_string(),
            summary: "Vertebrate 40S ribosome initiation consensus immediately upstream of ATG.".to_string(),
        },
        ModularVectorPart {
            id: "sig-rbs".to_string(),
            name: "Shine-Dalgarno RBS (pET)".to_string(),
            category: "Signal & Localization".to_string(),
            sub_category: "Prokaryotic Ribosome Init".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#06B6D4".to_string(),
            nominal_bp: 18,
            sequence: "AAGAAGGAGATATACCAT".to_string(),
            summary: "Strong T7 gene 10 ribosome binding site (AGGAG) spaced 7 nt upstream of start codon.".to_string(),
        },
        ModularVectorPart {
            id: "sig-sv40nls".to_string(),
            name: "SV40 Large-T NLS (PKKKRKV)".to_string(),
            category: "Signal & Localization".to_string(),
            sub_category: "Nuclear Localization".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Eukaryotic".to_string(),
            feature_type: "sig_peptide".to_string(),
            color: "#0891B2".to_string(),
            nominal_bp: 21,
            sequence: "CCCAAGAAGAAGAGGAAGGTG".to_string(),
            summary: "Importin-α/β nuclear import signal essential for Cas9, Cre, and nuclear biosensors.".to_string(),
        },
        ModularVectorPart {
            id: "sig-pelb".to_string(),
            name: "PelB Periplasmic Leader".to_string(),
            category: "Signal & Localization".to_string(),
            sub_category: "Bacterial Periplasmic Secretion".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "sig_peptide".to_string(),
            color: "#0891B2".to_string(),
            nominal_bp: 66,
            sequence: "ATGAAATACCTGCTGCCGACCGCTGCTGCTGGTCTGCTGCTCCTCGCTGCCCAGCCGGCGATGGCC".to_string(),
            summary: "Erwinia carotovora pectate lyase B 22-aa leader directing oxidizing periplasmic disulfide folding (pET-22b / scFvs).".to_string(),
        },
        ModularVectorPart {
            id: "sig-igk".to_string(),
            name: "Murine Igκ Secretion Leader".to_string(),
            category: "Signal & Localization".to_string(),
            sub_category: "Mammalian Secretion".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (HEK293/CHO)".to_string(),
            feature_type: "sig_peptide".to_string(),
            color: "#0891B2".to_string(),
            nominal_bp: 63,
            sequence: "ATGGAGACAGACACACTCCTGCTATGGGTACTGCTGCTCTGGGTTCCAGGTTCCACTGGTGAC".to_string(),
            summary: "High-efficiency Ig kappa chain ER secretion leader for recombinant mAbs, Fc-fusions, and cytokines.".to_string(),
        },
        ModularVectorPart {
            id: "sig-cd8leader".to_string(),
            name: "Human CD8α Signal Peptide".to_string(),
            category: "Signal & Localization".to_string(),
            sub_category: "CAR-T Surface Trafficking".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (T/NK Cells)".to_string(),
            feature_type: "sig_peptide".to_string(),
            color: "#0891B2".to_string(),
            nominal_bp: 63,
            sequence: "ATGGCCTTACCAGTGACCGCCTTGCTCCTGCCGCTGGCCTTGCTGCTCCACGCCGCCAGGCCG".to_string(),
            summary: "Canonical 21-aa CD8α leader peptide directing CAR-T receptors to the plasma membrane.".to_string(),
        },
        ModularVectorPart {
            id: "reg-wpre".to_string(),
            name: "WPRE (Woodchuck Post-Transcriptional Element)".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "mRNA Export & Stability".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (Lenti/AAV)".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#475569".to_string(),
            nominal_bp: 589,
            sequence: "AATCAACCTCTGGATTACAAAATTTGTGAAAGATTGACTGGTATTCTTAACTATGTTGCTCCTTTTACGCTATGTGGATACGCTGCTTTAATGCCTTTGTATCATGCTATTGCTTCCCGTATGGCTTTCATTTTCTCCTCCTTGTATAAATCCTGGTTGCTGTCTCTTTATGAGGAGTTGTGGCCCGTTGTCAGGCAACGTGGCGTGGTGTGCACTGTGTTTGCTGACGCAACCCCCACTGGTTGGGGCATTGCCACCACCTGTCAGCTCCTTTCCGGGACTTTCGCTTTCCCCCTCCCTATTGCCACGGCGGAACTCATCGCCGCCTGCCTTGCCCGCTGCTGGACAGGGGCTCGGCTGTTGGGCACTGACAATTCCGTGGTGTTGTCGGGGAAATCATCGTCCTTTCCTTGGCTGCTCGCCTGTGTTGCCACCTGGATTCTGCGCGGGACGTCCTTCTGCTACGTCCCTTCGGCCCTCAATCCAGCGGACCTTCCTTCCCGCGGCCTGCTGCCGGCTCTGCGGCCTCTTCCGCGTCTTCGCCTTCGCCCTCAGACGAGTCGGATCTCCCTTTGGGCCGCCTCCCCGC".to_string(),
            summary: "Boosts intronless viral/transgene mRNA nuclear export and steady-state expression 3–8 fold (mutated X-protein start codon).".to_string(),
        },
        ModularVectorPart {
            id: "reg-wpre3".to_string(),
            name: "WPRE3 (Compact γ+α WPRE)".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "Compact AAV Enhancer".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (AAV)".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#475569".to_string(),
            nominal_bp: 247,
            sequence: "GATAATCAACCTCTGGATTACAAAATTTGTGAAAGATTGACTGGTATTCTTAACTATGTTGCTCCTTTTACGCTATGTGGATACGCTGCTTTAATGCCTTTGTATCATGCTATTGCTTCCCGTATGGCTTTCATTTTCTCCTCCTTGTATAAATCCTGGTTAGTTCTTGCCACGGCGGAACTCATCGCCGCCTGCCTTGCCCGCTGCTGGACAGGGGCTCGGCTGTTGGGCACTGACAATTCCGTGGT".to_string(),
            summary: "247 bp minimal WPRE retaining ~85% activity while saving 342 bp of precious AAV packaging capacity.".to_string(),
        },
        ModularVectorPart {
            id: "reg-bghpa".to_string(),
            name: "bGH Poly(A) Signal".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "Mammalian Polyadenylation".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "terminator".to_string(),
            color: "#64748B".to_string(),
            nominal_bp: 225,
            sequence: "CTGTGCCTTCTAGTTGCCAGCCATCTGTTGTTTGCCCCTCCCCCGTGCCTTCCTTGACCCTGGAAGGTGCCACTCCCACTGTCCTTTCCTAATAAAATGAGGAAATTGCATCGCATTGTCTGAGTAGGTGTCATTCTATTCTGGGGGGTGGGGTGGGGCAGGACAGCAAGGGGGAGGATTGGGAAGACAATAGCAGGCATGCTGGGGATGCGGTGGGCTCTATGG".to_string(),
            summary: "Bovine growth hormone polyadenylation signal (pcDNA3.1 / pTwist CMV); efficient 3' cleavage and poly-A tailing.".to_string(),
        },
        ModularVectorPart {
            id: "reg-sv40pa".to_string(),
            name: "SV40 Late Poly(A) Signal".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "Compact Mammalian Poly(A)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "terminator".to_string(),
            color: "#64748B".to_string(),
            nominal_bp: 135,
            sequence: "CAGACATGATAAGATACATTGATGAGTTTGGACAAACCACAACTAGAATGCAGTGAAAAAAATGCTTTATTTGTGAAATTTGTGATGCTATTGCTTTATTTGTAACCATTATAAGCTGCAATAAACAAGTTAACA".to_string(),
            summary: "Compact 135 bp SV40 bidirectional/late polyadenylation signal ideal for AAV and dual-cistron plasmids.".to_string(),
        },
        ModularVectorPart {
            id: "reg-t7term".to_string(),
            name: "T7φ Terminator".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "Bacterial Terminator".to_string(),
            source: "RefSeq NC_001604.1 (Enterobacteria phage T7, complete genome), plus strand 24,163-24,210".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "terminator".to_string(),
            color: "#64748B".to_string(),
            nominal_bp: 48,
            sequence: "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG".to_string(),
            summary: "Bacteriophage T7 late stem-loop transcription terminator for pET expression vectors.".to_string(),
        },
        ModularVectorPart {
            id: "reg-rrnb".to_string(),
            name: "rrnB T1/T2 Terminator".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "Bacterial Rho-Independent".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "E. coli".to_string(),
            feature_type: "terminator".to_string(),
            color: "#64748B".to_string(),
            nominal_bp: 158,
            sequence: "AAATAAAACGAAAGGCTCAGTCGAAAGACTGGGCCTTTCGTTTTATCTGTTGTTTGTCGGTGAACGCTCTCCTGAGTAGGACAAATCCGCCGGGAGCGGATTTGAACGTTGCGAAGCAACGGCCCGGAGGGTGGCGGGCAGGACGCCCGCCATAAACT".to_string(),
            summary: "Strong E. coli ribosomal RNA operon rho-independent terminator preventing read-through into replication origin.".to_string(),
        },
        ModularVectorPart {
            id: "reg-ivthbg".to_string(),
            name: "Human β-Globin 3'UTR + 50A Tail".to_string(),
            category: "Regulatory / PolyA / Terminator".to_string(),
            sub_category: "IVT mRNA UTR + PolyA".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian IVT mRNA".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#475569".to_string(),
            nominal_bp: 183,
            sequence: "GCTCGCTTTCTTGCTGTCCAATTTCTATTAAAGGTTCCTTTGTTCCCTAAGTCCAACTACTAAACTGGGGGATATTATGAAGGGCCTTGAGCATCTGGATTCTGCCTAATAAAAAACATTTATTTTCATTGCAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA".to_string(),
            summary: "pTwist IVT hBG 50A 3'UTR and encoded 50-adenosine tail for high-stability synthetic mRNA.".to_string(),
        },
        ModularVectorPart {
            id: "vir-sinltr".to_string(),
            name: "HIV-1 3' ΔU3 SIN LTR".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "Lentiviral Transfer".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Lentivirus (3rd-Gen)".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#BE123C".to_string(),
            nominal_bp: 234,
            sequence: "TGGAAGGGCTAATTCACTCCCAACGAAGACAAGATCTGCTTTTTGCTTGTACTGGGTCTCTCTGGTTAGACCAGATCTGAGCCTGGGAGCTCTCTGGCTAACTAGGGAACCCACTGCTTAAGCCTCAATAAAGCTTGCCTTGAGTGCTTCAAGTAGTGTGTGCCCGTCTGTTGTGTGACTCTGGTAACTAGAGATCCCTCAGACCCTTTTAGTCAGTGTGGAAAATCTCTAGCA".to_string(),
            summary: "Self-inactivating U3-deleted lentiviral LTR preventing replication-competent virus and enhancer oncogenesis.".to_string(),
        },
        ModularVectorPart {
            id: "vir-aav2itr".to_string(),
            name: "AAV2 145 bp ITR (Flip/Flop)".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "AAV Packaging Signal".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "AAV (Propagate in Stbl3 30°C)".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#BE123C".to_string(),
            nominal_bp: 141,
            sequence: "CCTGCAGGCAGCTGCGCGCTCGCTCGCTCACTGAGGCCGCCCGGGCAAAGCCCGGGCGTCGGGCGACCTTTGGTCGCCCGGCCTCAGTGAGCGAGCGAGCGCGCAGAGAGGGAGTGGCCAACTCCATCACTAGGGGTTCCT".to_string(),
            summary: "T-hairpin inverted terminal repeat required in cis for AAV Rep-mediated rescue and capsid packaging (4.7 kb max ITR-to-ITR).".to_string(),
        },
        ModularVectorPart {
            id: "vir-pbitr".to_string(),
            name: "PiggyBac 5'/3' Terminal Repeat".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "DNA Transposon (TTAA)".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / Insect".to_string(),
            feature_type: "regulatory".to_string(),
            color: "#9F1239".to_string(),
            nominal_bp: 235,
            sequence: "TTAACCCTAGAAAGATAATCATATTGTGACGTACGTTAAAGATAATCATGCGTAAAATTGACGCATGTGTTTTATCGGTCTGTATATCGAGGTTTATTTATTAATTTGAATAGATATTAAGTTTTATTATATTTACACTTACATACTAATAATAAATTCAACAAACAATTTATTTATGTTTATTTATTTATTAAAAAAAAACAAAAACTCAAAATTTCTTCTATAAAGTAACAAA".to_string(),
            summary: "Trichoplusia ni PiggyBac transposase terminal repeat; integrates large >15 kb cargos into TTAA sites with footprint-free excision.".to_string(),
        },
        ModularVectorPart {
            id: "rec-loxp".to_string(),
            name: "loxP (34 bp Cre Site)".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "Cre/Lox Recombination".to_string(),
            source: "Bacteriophage P1 loxP site, printed 5'-ATAACTTCGTATAGCATACATTATACGAAGTTAT-3' by Hoess RH et al., Proc Natl Acad Sci U S A 79(11):3398-3402 (1982), doi:10.1073/pnas.79.11.3398".to_string(),
            host_system: "Universal".to_string(),
            feature_type: "protein_bind".to_string(),
            color: "#E11D48".to_string(),
            nominal_bp: 34,
            sequence: "ATAACTTCGTATAGCATACATTATACGAAGTTAT".to_string(),
            summary: "Wild-type bacteriophage P1 Cre recombinase site for conditional knockout or FLEX/DIO inversion.".to_string(),
        },
        ModularVectorPart {
            id: "rec-lox2272".to_string(),
            name: "lox2272 (Orthogonal FLEX Cre Site)".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "FLEX / DIO Switch".to_string(),
            source: "Mutant spacer lox2272 site, printed 5'-ATAACTTCGTATAAAGTATCCTATACGAAGTTAT-3' by Lee G & Saito I, Gene 216(1):55-65 (1998), doi:10.1016/S0378-1119(98)00325-4".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "protein_bind".to_string(),
            color: "#E11D48".to_string(),
            nominal_bp: 34,
            sequence: "ATAACTTCGTATAAAGTATCCTATACGAAGTTAT".to_string(),
            summary: "Mutant spacer lox site pairing exclusively with lox2272 (zero cross-reaction with WT loxP) to lock Cre-dependent FLEX switches.".to_string(),
        },
        ModularVectorPart {
            id: "rec-frt".to_string(),
            name: "FRT (34 bp Flp Site)".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "Flp/FRT Recombination".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian / Yeast / Fly".to_string(),
            feature_type: "protein_bind".to_string(),
            color: "#E11D48".to_string(),
            nominal_bp: 34,
            sequence: "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC".to_string(),
            summary: "S. cerevisiae 2μ Flp recombinase target (pcDNA5/FRT isogenic Flp-In locus integration).".to_string(),
        },
        ModularVectorPart {
            id: "rec-attl1".to_string(),
            name: "attL1 (Gateway Entry Site)".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "Gateway LR Cloning".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Gateway System".to_string(),
            feature_type: "protein_bind".to_string(),
            color: "#DB2777".to_string(),
            nominal_bp: 100,
            sequence: "CAAATAATGATTTTATTTTGACTGATAGTGACCTGTTCGTTGCAACAAATTGATGAGCAATGCTTTTTTATAATGCCAACTTTGTACAAAAAAGCAGGCT".to_string(),
            summary: "pTwist ENTR upstream λ-integrase recombination site for 1-hour LR Clonase transfer into any pDEST expression vector.".to_string(),
        },
        ModularVectorPart {
            id: "rec-attl2".to_string(),
            name: "attL2 (Gateway Entry Site)".to_string(),
            category: "Viral / Recombination".to_string(),
            sub_category: "Gateway LR Cloning".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Gateway System".to_string(),
            feature_type: "protein_bind".to_string(),
            color: "#DB2777".to_string(),
            nominal_bp: 100,
            sequence: "ACCCAGCTTTCTTGTACAAAGTGGTTCGATAACAAATTGATGAGCAATTAATTTTTTATAATGCCAACTTTGTACAAGAAAGCTGGGT".to_string(),
            summary: "pTwist ENTR downstream λ-integrase recombination site.".to_string(),
        },
        ModularVectorPart {
            id: "cas-spcas9scaffold".to_string(),
            name: "SpCas9 sgRNA Scaffold + PolyT".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "CRISPR Guide Scaffold".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian".to_string(),
            feature_type: "crispr_guide".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 83,
            sequence: "GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGCTTTTTTT".to_string(),
            summary: "F+E optimized S. pyogenes Cas9 tracrRNA/crRNA chimeric scaffold with Pol III T7 termination.".to_string(),
        },
        ModularVectorPart {
            id: "cas-aavs1grna".to_string(),
            name: "Human AAVS1 Safe-Harbor Spacer".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "Safe-Harbor Knock-In".to_string(),
            source: "AAVS1 T2 protospacer, printed 5'-GGGGCCACTAGGGACAGGAT-3' by Mali P et al., Science 339(6121):823-826 (2013), doi:10.1126/science.1232033".to_string(),
            host_system: "Human (PPP1R12C)".to_string(),
            feature_type: "crispr_guide".to_string(),
            color: "#7C3AED".to_string(),
            nominal_bp: 20,
            sequence: "GGGGCCACTAGGGACAGGAT".to_string(),
            summary: "Validated human PPP1R12C intron 1 AAVS1 safe-harbor SpCas9 protospacer (PAM: TGG).".to_string(),
        },
        ModularVectorPart {
            id: "car-41bbcd3z".to_string(),
            name: "CD8-Hinge/TM + 4-1BB + CD3ζ (2nd-Gen CAR)".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "CAR-T Signaling Domain".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Human Primary T/NK Cells".to_string(),
            feature_type: "CDS".to_string(),
            color: "#6366F1".to_string(),
            nominal_bp: 681,
            sequence: "ACCACGACGCCAGCGCCGCGACCACCAACACCGGCGCCCACCATCGCGTCGCAGCCCCTGTCCCTGCGCCCAGAGGCGTGCCGGCCAGCGGCGGGGGGCGCAGTGCACACGAGGGGGCTGGACTTCGCCTGTGATATCTACATCTGGGCGCCCTTGGCCGGGACTTGTGGGGTCCTTCTCCTGTCACTGGTTATCACCCTTTACTGCAAACGGGGCAGAAAGAAACTCCTGTATATATTCAAACAACCATTTATGAGACCAGTACAAACTACTCAAGAGGAAGATGGCTGTAGCTGCCGATTTCCAGAAGAAGAAGAAGGAGGATGTGAACTGAGAGTGAAGTTCAGCAGGAGCGCAGACGCCCCCGCGTACAAGCAGGGCCAGAACCAGCTCTATAACGAGCTCAATCTAGGACGAAGAGAGGAGTACGATGTTTTGGACAAGAGACGTGGCCGGGACCCTGAGATGGGGGGAAAGCCGAGAAGGAAGAACCCTCAGGAAGGCCTGTACAATGAACTGCAGAAAGATAAGATGGCGGAGGGCCTACAGTGAGATTGGGATGAAAGGCGAGCGCCGGAGGGGCAAGGGGCACGATGGCCTTTACCAGGGTCTCAGTACAGCCACCAAGGACACCTACGACGCCCTTCACATGCAGGCCCTGCCCCCTCGCTAA".to_string(),
            summary: "Tisagenlecleucel-class CD8α hinge/TM + 4-1BB (CD137) costimulatory + CD3ζ ITAM intracellular signaling cassette promoting central-memory T-cell persistence.".to_string(),
        },
        ModularVectorPart {
            id: "car-cd19scfv".to_string(),
            name: "FMC63 Anti-CD19 scFv (VL-GGGGS3-VH)".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "CAR-T Antigen Binder".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Human CAR-T".to_string(),
            feature_type: "CDS".to_string(),
            color: "#6366F1".to_string(),
            nominal_bp: 726,
            sequence: "GACATCCAGATGACACAGACTACATCCTCCCTGTCTGCCTCTCTGGGAGACAGAGTCACCATCAGTTGCAGGGCAAGTCAGGACATTAGTAAATATTTAAATTGGTATCAGCAGAAACCAGATGGAACTGTTAAACTCCTGATCTACCATACATCAAGATTACACTCAGGAGTCCCATCAAGGTTCAGTGGCAGTGGGTCTGGAACAGATTATTCTCTCACCATTAGCAACCTGGAGCAAGAAGATATTGCCACTTACTTTTGCCAACAGGGTAATACGCTTCCGTACACGTTCGGAGGGGGGACCAAGCTGGAGATCACAGGTGGCGGTGGCTCGGGCGGTGGTGGGTCGGGTGGCGGCGGATCTGAGGTGAAACTGCAGGAGTCAGGACCTGGCCTGGTGGCGCCCTCACAGAGCCTGTCCGTCACATGCACTGTCTCAGGGGTCTCATTACCCGACTATGGTGTAAGCTGGATTCGCCAGCCTCCACGAAAGGGTCTGGAGTGGCTGGGAGTAATATGGGGTAGTGAAACCACATACTATAATTCAGCTCTCAAATCCAGACTGACCATCATCAAGGACAACTCCAAGAGCCAAGTTTTCTTAAAAATGAACAGTCTGCAAACTGATGACACAGCCATTTACTACTGTGCCAAACATTATTACTACGGTGGTAGCTATGCTATGGACTACTGGGGCCAAGGAACCTCAGTCACCGTCTCCTCA".to_string(),
            summary: "Clinically validated FMC63 murine anti-human CD19 single-chain variable fragment.".to_string(),
        },
        ModularVectorPart {
            id: "ab-higg1fc".to_string(),
            name: "Human IgG1-Fc (Hinge-CH2-CH3)".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "Antibody Constant / Fc Fusion".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (HEK293/CHO)".to_string(),
            feature_type: "CDS".to_string(),
            color: "#4F46E5".to_string(),
            nominal_bp: 699,
            sequence: "GAGCCCAAATCTTGTGACAAAACTCACACATGCCCACCGTGCCCAGCACCTGAACTCCTGGGGGGACCGTCAGTCTTCCTCTTCCCCCCAAAACCCAAGGACACCCTCATGATCTCCCGGACCCCTGAGGTCACATGCGTGGTGGTGGACGTGAGCCACGAAGACCCTGAGGTCAAGTTCAACTGGTACGTGGACGGCGTGGAGGTGCATAATGCCAAGACAAAGCCGCGGGAGGAGCAGTACAACAGCACGTACCGTGTGGTCAGCGTCCTCACCGTCCTGCACCAGGACTGGCTGAATGGCAAGGAGTACAAGTGCAAGGTCTCCAACAAAGCCCTCCCAGCCCCCATCGAGAAAACCATCTCCAAAGCCAAAGGGCAGCCCCGAGAACCACAGGTGTACACCCTGCCCCCATCCCGGGATGAGCTGACCAAGAACCAGGTCAGCCTGACCTGCCTGGTCAAAGGCTTCTATCCCAGCGACATCGCCGTGGAGTGGGAGAGCAATGGGCAGCCGGAGAACAACTACAAGACCACGCCTCCCGTGCTGGACTCCGACGGCTCCTTCTTCCTCTACAGCAAGCTCACCGTGGACAAGAGCAGGTGGCAGCAGGGGAACGTCTTCTCATGCTCCGTGATGCATGAGGCTCTGCACAACCACTACACGCAGAAGAGCCTCTCCCTGTCTCCGGGTAAATGA".to_string(),
            summary: "pTwist CMV hIgG1-Fc human IgG1 constant Fc domain enabling Protein A purification, bivalency, and FcRn half-life extension.".to_string(),
        },
        ModularVectorPart {
            id: "ab-higg1-lalapgyte".to_string(),
            name: "Human IgG1 Fc (LALA-PG + YTE Engineered)".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "Effector-Silent Extended Half-Life IgG".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (HEK293/CHO)".to_string(),
            feature_type: "CDS".to_string(),
            color: "#4F46E5".to_string(),
            nominal_bp: 699,
            sequence: "GAGCCCAAATCTTGTGACAAAACTCACACATGCCCACCGTGCCCAGCACCTGAAGCCGCGGGGGGACCGTCAGTCTTCCTCTTCCCCCCAAAACCCAAGGACACCCTCTACATCACCCGGGAGCCTGAGGTCACATGCGTGGTGGTGGACGTGAGCCACGAAGACCCTGAGGTCAAGTTCAACTGGTACGTGGACGGCGTGGAGGTGCATAATGCCAAGACAAAGCCGCGGGAGGAGCAGTACAACAGCACGTACCGTGTGGTCAGCGTCCTCACCGTCCTGCACCAGGACTGGCTGAATGGCAAGGAGTACAAGTGCAAGGTCTCCAACAAAGCCCTCGGCGCCCCCATCGAGAAAACCATCTCCAAAGCCAAAGGGCAGCCCCGAGAACCACAGGTGTACACCCTGCCCCCATCCCGGGATGAGCTGACCAAGAACCAGGTCAGCCTGACCTGCCTGGTCAAAGGCTTCTATCCCAGCGACATCGCCGTGGAGTGGGAGAGCAATGGGCAGCCGGAGAACAACTACAAGACCACGCCTCCCGTGCTGGACTCCGACGGCTCCTTCTTCCTCTACAGCAAGCTCACCGTGGACAAGAGCAGGTGGCAGCAGGGGAACGTCTTCTCATGCTCCGTGATGCATGAGGCTCTGCACAACCACTACACGCAGAAGAGCCTCTCCCTGTCTCCGGGTAAATGA".to_string(),
            summary: "pTwist CMV hIgG1 L234A/L235A/P329G (ablated FcγR/C1q effector toxicity) + M252Y/S254T/T256E (3–4x enhanced FcRn serum half-life).".to_string(),
        },
        ModularVectorPart {
            id: "ab-higk-cl".to_string(),
            name: "Human Igκ Light-Chain Constant (CL)".to_string(),
            category: "CRISPR / CAR-T / Antibody".to_string(),
            sub_category: "Antibody Light Chain".to_string(),
            source: "MolBioCraft example design".to_string(),
            host_system: "Mammalian (HEK293/CHO)".to_string(),
            feature_type: "CDS".to_string(),
            color: "#4F46E5".to_string(),
            nominal_bp: 324,
            sequence: "CGAACTGTGGCTGCACCATCTGTCTTCATCTTCCCGCCATCTGATGAGCAGTTGAAATCTGGAACTGCCTCTGTTGTGTGCCTGCTGAATAACTTCTATCCCAGAGAGGCCAAAGTACAGTGGAAGGTGGATAACGCCCTCCAATCGGGTAACTCCCAGGAGAGTGTCACAGAGCAGGACAGCAAGGACAGCACCTACAGCCTCAGCAGCACCCTGACGCTGAGCAAAGCAGACTACGAGAAACACAAAGTCTACGCCTGCGAAGTCACCCATCAGGGCCTGAGCTCGCCCGTCACAAAGAGCTTCAACAGGGGAGAGTGTTAG".to_string(),
            summary: "pTwist CMV hIgK constant kappa domain for pairing with variable VL inserts.".to_string(),
        }
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, Clone, PartialEq, Eq)]
    enum ProvenanceKind {
        Record {
            accession: String,
            strand: String,
            start: usize,
            end: usize,
        },
        Publication {
            doi: String,
            oligo: String,
        },
        Example,
    }

    const FORBIDDEN_VENDORS: &[&str] = &[
        concat!("Gene", "ious"),
        concat!("Snap", "Gene"),
        concat!("ME", "GA"),
        concat!("Vector", "NTI"),
        concat!("Bench", "ling"),
        concat!("PA", "UP"),
        concat!("CL", "C"),
        concat!("Dotma", "tics"),
        concat!("GSL Bio", "tech"),
        concat!("Biomat", "ters"),
        concat!("GeneMap", "per"),
        concat!("Twist Bio", "science"),
        concat!("Conduct", "Science"),
        concat!("Modular Vector ", "Systems"),
    ];

    fn rc(seq: &str) -> String {
        seq.chars()
            .rev()
            .map(|c| match c {
                'A' => 'T',
                'T' => 'A',
                'G' => 'C',
                'C' => 'G',
                other => other,
            })
            .collect()
    }

    fn parse_record_citation(s: &str) -> Option<(String, String, usize, usize)> {
        let rest = s
            .strip_prefix("GenBank ")
            .or_else(|| s.strip_prefix("RefSeq "))?;
        let (acc, after_acc) = rest.split_once(" (")?;
        if acc.is_empty()
            || !acc.contains('.')
            || !acc
                .chars()
                .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_' || c == '.')
        {
            return None;
        }
        let (_, after_paren) = after_acc.split_once("), ")?;
        if after_paren.contains(')') {
            return None;
        }
        let (strand, span) = if let Some(sp) = after_paren.strip_prefix("plus strand ") {
            ("plus", sp)
        } else if let Some(sp) = after_paren.strip_prefix("minus strand ") {
            ("minus", sp)
        } else {
            return None;
        };
        let (raw_start, raw_end) = span.split_once('-')?;
        let start: usize = raw_start.replace(',', "").parse().ok()?;
        let end: usize = raw_end.replace(',', "").parse().ok()?;
        if start == 0 || end < start {
            return None;
        }
        Some((acc.to_string(), strand.to_string(), start, end))
    }

    fn parse_publication_citation(s: &str) -> Option<(String, String)> {
        let (_, after_printed) = s.split_once(", printed 5'-")?;
        let (oligo, after_oligo) = after_printed.split_once("-3' by ")?;
        if oligo.is_empty() || !oligo.chars().all(|c| matches!(c, 'A' | 'C' | 'G' | 'T')) {
            return None;
        }
        let (_, doi_tail) = after_oligo.rsplit_once(", doi:")?;
        if !doi_tail.starts_with("10.")
            || doi_tail.contains(char::is_whitespace)
            || !doi_tail.contains('/')
        {
            return None;
        }
        Some((format!("doi:{doi_tail}"), oligo.to_string()))
    }

    fn contains_phrase_case_insensitive(haystack: &str, phrase: &str) -> bool {
        let h_bytes = haystack.as_bytes();
        let p_bytes = phrase.as_bytes();
        if p_bytes.is_empty() || p_bytes.len() > h_bytes.len() {
            return false;
        }
        for i in 0..=h_bytes.len() - p_bytes.len() {
            if h_bytes[i..i + p_bytes.len()].eq_ignore_ascii_case(p_bytes) {
                let left_ok = i == 0 || !h_bytes[i - 1].is_ascii_alphanumeric();
                let right_ok = i + p_bytes.len() == h_bytes.len()
                    || !h_bytes[i + p_bytes.len()].is_ascii_alphanumeric();
                if left_ok && right_ok {
                    return true;
                }
            }
        }
        false
    }

    fn classify_part_provenance(part: &ModularVectorPart) -> Result<ProvenanceKind, String> {
        if part.id.trim().is_empty() || part.name.trim().is_empty() {
            return Err("empty id or name".to_string());
        }
        if part.sequence.trim().is_empty() {
            return Err(format!("{}: sequence is empty", part.id));
        }
        let src = part.source.trim();
        if src.is_empty() {
            return Err(format!("{}: empty provenance", part.id));
        }
        for vendor in FORBIDDEN_VENDORS {
            if contains_phrase_case_insensitive(src, vendor) {
                return Err(format!(
                    "{}: names forbidden vendor '{}' in '{}'",
                    part.id, vendor, src
                ));
            }
        }
        let is_example = src == "MolBioCraft example design";
        let rec = parse_record_citation(src);
        let pub_cite = parse_publication_citation(src);
        let matched = usize::from(is_example) + usize::from(rec.is_some()) + usize::from(pub_cite.is_some());
        if matched != 1 {
            return Err(format!(
                "{}: must match exactly 1 provenance shape (matched {matched}): '{src}'",
                part.id
            ));
        }
        if is_example {
            if src.contains("GenBank") || src.contains("RefSeq") || src.contains("doi:10.") {
                return Err(format!("{}: example design cites a record or paper ({src})", part.id));
            }
            return Ok(ProvenanceKind::Example);
        }
        if let Some((accession, strand, start, end)) = rec {
            if src.contains("doi:10.") || src.contains("MolBioCraft example design") {
                return Err(format!("{}: record citation mixes shapes: '{src}'", part.id));
            }
            let span_len = end - start + 1;
            if span_len != part.sequence.len() {
                return Err(format!(
                    "{}: sequence length {} != cited span length {} ({start}-{end})",
                    part.id,
                    part.sequence.len(),
                    span_len
                ));
            }
            return Ok(ProvenanceKind::Record {
                accession,
                strand,
                start,
                end,
            });
        }
        let (doi, oligo) = pub_cite.unwrap();
        if src.contains("GenBank") || src.contains("RefSeq") || src.contains("MolBioCraft example design") {
            return Err(format!("{}: publication citation mixes shapes: '{src}'", part.id));
        }
        if oligo != part.sequence {
            return Err(format!(
                "{}: sequence '{}' != cited publication oligo '{oligo}'",
                part.id, part.sequence
            ));
        }
        Ok(ProvenanceKind::Publication { doi, oligo })
    }

    fn reference_text(rel: &str) -> Option<String> {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir = match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
            Some(d) if !d.is_empty() => {
                let dp = std::path::PathBuf::from(d);
                if dp.is_absolute() {
                    dp
                } else {
                    repo.join(dp)
                }
            }
            _ => repo.join("test-data"),
        };
        let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
        let required = match v.to_str() {
            Some("1") => true,
            Some("" | "0") => false,
            _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
        };
        let ncbi_dir_present = dir.join("ncbi").is_dir();
        let p = dir.join(rel);
        match std::fs::read_to_string(&p) {
            Ok(text) => Some(text),
            Err(e)
                if matches!(
                    e.kind(),
                    std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory
                ) =>
            {
                assert!(
                    !required && !ncbi_dir_present,
                    "reference data file missing (required={required}, ncbi_dir_present={ncbi_dir_present}): {}",
                    p.display()
                );
                eprintln!("skipped: reference data absent ({})", p.display());
                None
            }
            Err(e) => panic!("{}: unreadable: {e}", p.display()),
        }
    }

    fn parse_single_fasta(text: &str) -> (String, String) {
        let mut header = String::new();
        let mut seq = String::new();
        let mut headers = 0usize;
        for line in text.lines() {
            let trimmed = line.trim();
            if trimmed.starts_with('>') {
                headers += 1;
                header = trimmed.to_string();
            } else {
                seq.push_str(&trimmed.to_ascii_uppercase());
            }
        }
        assert_eq!(headers, 1, "expected single-record FASTA");
        (header, seq)
    }

    fn record_rel_path(accession: &str) -> &'static str {
        match accession {
            "X17403.1" => "ncbi/X17403.1.fasta",
            "NC_000006.12" => "ncbi/NC_000006.12.fasta",
            "NC_001604.1" => "ncbi/NC_001604.fasta",
            "L09137.2" => "ncbi/L09137.fasta",
            "J01749.1" => "ncbi/J01749.fasta",
            "V01555.2" => "ncbi/V01555.fasta",
            other => panic!("unrecognised catalogue part accession: {other}"),
        }
    }

    const V01555_ORIP_PLUS_7450_7835: &str = "AGGATAGCATATGCTACCCGGATACAGATTAGGATAGCATATACTACCCAGATATAGATTAGGATAGCATATGCTACCCAGATATAGATTAGGATAGCCTATGCTACCCAGATATAAATTAGGATAGCATATACTACCCAGATATAGATTAGGATAGCATATGCTACCCAGATATAGATTAGGATAGCCTATGCTACCCAGATATAGATTAGGATAGCATATGCTACCCAGATATAGATTAGGATAGCATATGCTATCCAGATATTTGGGTAGTATATGCTACCCAGATATAAATTAGGATAGCATATACTACCCTAATCTCTATTAGGATAGCATATGCTACCCGGATACAGATTAGGATAGCATATACTACCCAGATATAGATT";

    #[test]
    fn modular_parts_provenance() {
        let parts = get_modular_vector_parts();
        assert_eq!(parts.len(), 97);

        let samples = crate::sample_library_data::get_sample_library();
        let sample_by_name = |name: &str| -> String {
            samples
                .iter()
                .find(|d| d.name == name)
                .unwrap_or_else(|| panic!("missing sample {name}"))
                .sequence
                .to_ascii_uppercase()
        };
        let puc19_seq = sample_by_name("pUC19_Standard_Vector");
        let t7_seq = sample_by_name("Phage T7");
        let ptwist_cmv_seq = sample_by_name("pTwist CMV");
        let plv_ef1a_seq = sample_by_name("pLV[Exp]-EF1A>MCS-T2A-EGFP-P2A-Puro");
        let pet28a_seq = sample_by_name("pET-28a(+)-eGFP");
        let cmv_primer_seq = sample_by_name("CMV_IE_Enhancer_Fwd");
        let x17403_plus_173745_174252 = rc(&ptwist_cmv_seq[68..576]);
        let nc000006_plus_73521000_73521211 = rc(&plv_ef1a_seq[357..569]);
        let j01749_plus_2474_3122 = rc(&pet28a_seq[1496..2145]);

        let mut record_ids = Vec::new();
        let mut pub_ids = Vec::new();
        let mut example_count = 0usize;
        let mut in_tree_checked = 0usize;

        for part in &parts {
            match classify_part_provenance(part).unwrap_or_else(|e| panic!("{e}")) {
                ProvenanceKind::Record {
                    accession,
                    strand,
                    start,
                    end,
                } => {
                    record_ids.push(part.id.clone());
                    // Unconditionally verify against in-tree reference sequences across all 6 accessions (all 8 record-citing parts).
                    let (in_tree_offset, in_tree_plus): (usize, &str) = match accession.as_str() {
                        "X17403.1" => (173_745, x17403_plus_173745_174252.as_str()),
                        "NC_000006.12" => (73_521_000, nc000006_plus_73521000_73521211.as_str()),
                        "NC_001604.1" => (1, t7_seq.as_str()),
                        "L09137.2" => (1, puc19_seq.as_str()),
                        "J01749.1" => (2_474, j01749_plus_2474_3122.as_str()),
                        "V01555.2" => (7_450, V01555_ORIP_PLUS_7450_7835),
                        other => panic!("unrecognised catalogue part accession: {other}"),
                    };
                    assert!(
                        start >= in_tree_offset && end <= in_tree_offset + in_tree_plus.len() - 1,
                        "{}: cited span {start}-{end} out of in-tree {accession} range {}..={}",
                        part.id,
                        in_tree_offset,
                        in_tree_offset + in_tree_plus.len() - 1
                    );
                    let raw = &in_tree_plus[start - in_tree_offset..end - in_tree_offset + 1];
                    let expected = if strand == "minus" {
                        rc(raw)
                    } else {
                        raw.to_string()
                    };
                    assert_eq!(
                        part.sequence, expected,
                        "{} does not match in-tree {} {strand} strand {start}-{end}",
                        part.id, accession
                    );
                    in_tree_checked += 1;
                    if part.id == "prom-cmv" {
                        // X17403.1 minus strand 173,745-174,252 holds CMV_IE_Enhancer_Fwd (minus strand 173,774-173,794)
                        let sub_start = 174_252 - 173_794;
                        let sub_end = 174_252 - 173_774 + 1;
                        assert_eq!(&part.sequence[sub_start..sub_end], cmv_primer_seq);
                    }
                    // Also check against fetched NCBI FASTA in test-data/ncbi/ when available.
                    let rel = record_rel_path(&accession);
                    if let Some(fasta_text) = reference_text(rel) {
                        let (header, seq) = parse_single_fasta(&fasta_text);
                        assert!(
                            header.starts_with(&format!(">{accession} "))
                                || header.starts_with(&format!(">{accession}:")),
                            "{}: unexpected FASTA header {header}",
                            part.id
                        );
                        let offset = if let Some(after_colon) =
                            header.strip_prefix(&format!(">{accession}:"))
                        {
                            let coords = after_colon.split_whitespace().next().unwrap();
                            let (s_start, s_end) = coords.split_once('-').unwrap();
                            let off: usize = s_start.parse().unwrap();
                            let stop: usize = s_end.parse().unwrap();
                            assert_eq!(stop - off + 1, seq.len());
                            off
                        } else {
                            1
                        };
                        let raw = &seq[start - offset..end - offset + 1];
                        let expected = if strand == "minus" {
                            rc(raw)
                        } else {
                            raw.to_string()
                        };
                        assert_eq!(
                            part.sequence, expected,
                            "{} does not match fetched {accession} {strand} strand {start}-{end}",
                            part.id
                        );
                    }
                }
                ProvenanceKind::Publication { doi, oligo } => {
                    assert!(doi.starts_with("doi:10."));
                    assert_eq!(part.sequence, oligo);
                    pub_ids.push(part.id.clone());
                }
                ProvenanceKind::Example => {
                    example_count += 1;
                }
            }
        }

        assert_eq!(in_tree_checked, 8);

        assert_eq!(
            record_ids,
            vec![
                "prom-cmv",
                "prom-efs",
                "prom-t7",
                "sel-ampr",
                "ori-puc",
                "ori-pbr322",
                "ori-orip",
                "reg-t7term"
            ]
        );
        assert_eq!(
            pub_ids,
            vec!["sig-kozak", "rec-loxp", "rec-lox2272", "cas-aavs1grna"]
        );
        assert_eq!(example_count, 85);

        // Verify the vendor-name gate and provenance-shape classifier reject invalid entries.
        for bad_label in [
            concat!("Twist Bio", "science"),
            concat!("Conduct", "Science"),
            concat!("Modular Vector ", "Systems"),
            concat!("Snap", "Gene"),
            concat!("GenBank X17403.1 (Twist Bio", "science), minus strand 173,745-174,252"),
            "GenBank X17403.1 (HCMV), minus strand 1-10",
            "loxP, printed 5'-ACGT-3' by Hoess et al., doi:10.1073/pnas.79.11.3398",
            "Unverified catalogue entry",
        ] {
            let mut probe = parts[0].clone();
            probe.source = bad_label.to_string();
            assert!(
                classify_part_provenance(&probe).is_err(),
                "expected gate to reject '{bad_label}'"
            );
        }
    }
}
