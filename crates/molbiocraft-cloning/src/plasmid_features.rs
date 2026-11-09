// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use aho_corasick::AhoCorasick;
use molbiocraft_core::{
    clean_alpha_sequence, reverse_complement_iupac, SequenceDocument, SequenceFeature,
};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommonFeatureTemplate {
    pub id: String,
    pub name: String,
    #[serde(rename = "type")]
    pub feature_type: String,
    pub sequence_motif: String,
    pub color: String,
    pub description: String,
    pub category: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub host_system: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub length_bp: Option<usize>,
}

fn cf(
    id: &str,
    name: &str,
    ftype: &str,
    motif: &str,
    color: &str,
    desc: &str,
    cat: &str,
) -> CommonFeatureTemplate {
    CommonFeatureTemplate {
        id: id.to_string(),
        name: name.to_string(),
        feature_type: ftype.to_string(),
        sequence_motif: motif.to_string(),
        color: color.to_string(),
        description: desc.to_string(),
        category: cat.to_string(),
        host_system: None,
        length_bp: Some(motif.len()),
    }
}

/// Curated Library of 72 Common Plasmid & Viral Vector Features for Automatic Feature Detection.
pub fn get_common_plasmid_features() -> Vec<CommonFeatureTemplate> {
    vec![
        cf("cf-t7-prom", "T7 promoter", "promoter", "TAATACGACTCACTATAGG", "#0284c7", "Bacteriophage T7 RNA polymerase promoter", "Promoter"),
        cf("cf-lac-op", "lac operator", "regulatory", "GGAATTGTGAGCGGATAACAATT", "#8b5cf6", "LacI repressor binding operator site", "Promoter"),
        cf("cf-6xhis", "6xHis affinity tag", "tag", "CACCACCACCACCACCAC", "#f59e0b", "Hexahistidine IMAC Ni-NTA purification tag", "Affinity Tag"),
        cf("cf-tev", "TEV protease site", "protein_bind", "GAAAACCTGTATTTTCAGGGC", "#ec4899", "Tobacco Etch Virus protease cleavage recognition site (ENLYFQ/G)", "Protease Cleavage"),
        cf("cf-egfp-core", "eGFP chromophore core", "CDS", "ATGGTGAGCAAGGGCGAGGAGCTGTTCACC", "#10b981", "Enhanced Green Fluorescent Protein N-terminal coding signature", "Reporter"),
        cf("cf-t7-term", "T7 terminator", "terminator", "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG", "#ef4444", "Bacteriophage T7 transcription terminator hairpin", "Terminator"),
        cf("cf-attb1", "attB1 recombination site", "misc_feature", "ACAAGTTTGTACAAAAAAGCAGGCT", "#7c3aed", "Bacteriophage lambda Integrase attB1 recombination site", "Recombination"),
        cf("cf-attb2", "attB2 recombination site", "misc_feature", "ACCCAGCTTTCTTGTACAAAGTGGT", "#7c3aed", "Bacteriophage lambda Integrase attB2 recombination site", "Recombination"),
        cf("cf-rbs", "Shine-Dalgarno RBS", "regulatory", "AAGGAG", "#14b8a6", "Prokaryotic 16S rRNA ribosome binding site consensus", "Promoter"),
        cf("cf-kozak", "Kozak consensus", "regulatory", "GCCACCATGG", "#0ea5e9", "Vertebrate translation initiation consensus sequence", "Promoter"),
        cf("cf-cmv", "CMV IE Promoter/Enhancer", "promoter", "TGGGAGGTCTATATAAGCAGAGCT", "#2563eb", "Human CMV immediate-early TATA/core promoter", "Promoter"),
        cf("cf-ef1a", "EF1A Promoter Core", "promoter", "CGTGAGGCTCCGGTGCCCGTCAGTGGGCAGAGCGCACATCGCCCACAGT", "#1d4ed8", "Human EEF1A1 ubiquitous silencing-resistant promoter", "Promoter"),
        cf("cf-efs", "EFS Core Promoter", "promoter", "TGGCTCCGCCTTTTTCCCGAGGGTGGGGGAGAACCGTATATAAGTGCAGTAGTC", "#3b82f6", "Core human EF1alpha promoter", "Promoter"),
        cf("cf-sffv", "SFFV LTR Promoter", "promoter", "CCGAGCTCTATATAAGCAGAGCTCGTTTAGTGAACCGTCAGATC", "#2563eb", "Spleen focus-forming virus hematopoietic promoter", "Promoter"),
        cf("cf-hsyn1", "hSyn1 Neuronal Promoter", "promoter", "AGTGCAAGTGGGTTTTAGGACCAGGATGAGGCGGGGTGGGGGTGC", "#0284c7", "Human Synapsin 1 pan-neuronal promoter", "Promoter"),
        cf("cf-tre3g", "TRE3G Tet-Inducible Operator", "promoter", "TCCCTATCAGTGATAGAGAACGTATGAAGAGTTTACTCCCTATCAGTGATAGAGA", "#7c3aed", "3rd-generation TetO doxycycline-inducible array", "Promoter"),
        cf("cf-hu6", "hU6 Pol III Promoter", "promoter", "GCTTACCGTAACTTGAAAGTATTTCGATTTCTTGGCTTTATATATCTTGTGGAAAGGACGAAACACC", "#4f46e5", "Human U6 RNA Pol III sgRNA/shRNA promoter", "CRISPR / RNAi"),
        cf("cf-sp6", "SP6 Promoter", "promoter", "ATTTAGGTGACACTATAG", "#0284c7", "Bacteriophage SP6 RNA polymerase promoter", "Promoter"),
        cf("cf-t3", "T3 Promoter", "promoter", "AATTAACCCTCACTAAAGGG", "#0284c7", "Bacteriophage T3 RNA polymerase promoter", "Promoter"),
        cf("cf-tac", "tac Hybrid Promoter", "promoter", "TTGACAATTAATCATCGGCTCGTATAATGTGTGGAATTGTGAGCG", "#0284c7", "IPTG-inducible trp-lac hybrid bacterial expression promoter", "Promoter"),
        cf("cf-arabad", "araBAD (pBAD) Promoter", "promoter", "AAGAAACCAATTGTCCATATTGCATCAGACATTGCCGTCACTGCGTCTTTTACTGGCTCTTCTCGCTAACCAAACCGGTAACCCCGCTTATTAAAAGCATTCTGTAACAAAGCGGGACCAAAGCCATGACAAAAACGCGTAACAAAAGTGTCTATAATCACGGCAGAAAAGTCCACATTGATTATTTGCACGGCGTCACACTTTGCTATGCCATAGCATTTTTATCCATAAGATTAGCGGATCCTACCTGACGCTTTTTATCGCAACTCTCTACTGTTTCTCCAT", "#0284c7", "L-arabinose inducible AraC-regulated bacterial promoter", "Promoter"),
        cf("cf-j23100", "Anderson BBa_J23100 Constitutive Promoter", "promoter", "TTGACGGCTAGCTCAGTCCTAGGTACAGTGCTAGC", "#0284c7", "Strong synthetic constitutive sigma70 E. coli promoter", "Promoter"),
        cf("cf-ampr", "AmpR (bla β-lactamase)", "CDS", "ATGAGTATTCAACATTTCCGTGTCGCCCTTATTCCCTTTTTTGCGGCATTTTGCCTTCCTG", "#dc2626", "TEM-1 beta-lactamase Ampicillin/Carbenicillin resistance marker", "Resistance"),
        cf("cf-kanr", "KanR / NeoR (aph(3')-IIa)", "CDS", "ATGATTGAACAAGATGGATTGCACGCAGGTTCTCCGGCCGCTTGGGTGGAGAGGCTATTC", "#b91c1c", "Kanamycin / G418 aminoglycoside phosphotransferase", "Resistance"),
        cf("cf-cmr", "CmR (cat Chloramphenicol)", "CDS", "ATGGAGAAAAAAATCACTGGATATACCACCGTTGATATATCCCAATGGCATCGTAAAGAAC", "#991b1b", "Chloramphenicol acetyltransferase resistance marker", "Resistance"),
        cf("cf-specr", "SpecR (aadA Spectinomycin)", "CDS", "ATGAGGGAAGCGGTGATCGCCGAAGTATCGACTCAACTATCAGAGGTAGTTGGCGTCATCG", "#991b1b", "Aminoglycoside-3''-adenylyltransferase Spectinomycin/Streptomycin resistance", "Resistance"),
        cf("cf-tetr", "TetR (tetA Tetracycline Efflux)", "CDS", "ATGAAATCTAACAATGCGCTCATCGTCATCCTCGGCACCGTCACCCTGGATGCTGTAGGCA", "#991b1b", "Tetracycline resistance antiporter marker", "Resistance"),
        cf("cf-puror", "PuroR (pac Puromycin)", "CDS", "ATGACCGAGTACAAGCCCACGGTGCGCCTCGCCACCCGCGACGACGTCCCCAGGGCCGTA", "#ea580c", "Puromycin N-acetyltransferase mammalian marker", "Resistance"),
        cf("cf-hygror", "HygroR (hph Hygromycin B)", "CDS", "ATGAAAAAGCCTGAACTCACCGCGACGTCTGTCGAGAAGTTTCTGATCGAAAAGTTCGAC", "#d97706", "Hygromycin B phosphotransferase marker", "Resistance"),
        cf("cf-bsdr", "BsdR (Blasticidin S)", "CDS", "ATGGCCAAGCCTTTGTCTCAAGAAGAATCCACCCTCATTGAAAGAGCAACGGCTACAATC", "#ea580c", "Blasticidin S deaminase resistance marker", "Resistance"),
        cf("cf-zeor", "ZeoR / Sh ble (Zeocin)", "CDS", "ATGGCCAAGTTGACCAGTGCCGTTCCGGTGCTCACCGCGCGCGACGTCGCCGGAGCGGTC", "#ea580c", "Zeocin/bleomycin resistance protein", "Resistance"),
        cf("cf-ccdb", "ccdB Gyrase Toxin", "CDS", "ATGCAGTTTAAGGTTTACACCTATAAAAGAGAGAGCCGTTATCGTCTGTTTGTGGATGTA", "#991b1b", "Gateway negative counter-selection toxin", "Resistance"),
        cf("cf-puc-ori", "pUC / ColE1 Origin Core", "rep_origin", "CTTACCGGGTTGGACTCAAGACGATAGTTACCGGATAAGGCGCAGCGGTCGGGCTGAACG", "#f59e0b", "ColE1/pMB1/pUC bacterial origin of replication RNA II core", "Origin"),
        cf("cf-p15a-ori", "p15A Origin Core", "rep_origin", "CCATAGGCTCCGCCCCCCTGACAAGCATCACGAAATCTGACGCTCAAATCAGTGGTGGCG", "#b45309", "Medium-copy p15A orthogonal bacterial origin", "Origin"),
        cf("cf-psc101-ori", "pSC101 Low-Copy Origin Core", "rep_origin", "GACAGTAAGACGGGTAAGCCTGTTGATGATACCGCTGCCTTACTGGGTGCATTAGCCAGT", "#b45309", "RepA iteron-controlled low-copy bacterial origin (~5 copies)", "Origin"),
        cf("cf-f1-ori", "f1 Filamentous Phage Origin", "rep_origin", "ACGCGCCCTGTAGCGGCGCATTAAGCGCGGCGGGTGTGGTGGTTACGCGCAGCGTGACCG", "#d97706", "f1/M13 single-stranded phagemid packaging origin", "Origin"),
        cf("cf-sv40-ori", "SV40 Mammalian Origin", "rep_origin", "TCCGCCCAGTTCCGCCCATTCTCCGCCCCATGGCTGACTAATTTTTTTTATTTATGCAGAGG", "#f59e0b", "Simian virus 40 episomal origin of replication", "Origin"),
        cf("cf-2micron", "Yeast 2-Micron (2μ) Origin", "rep_origin", "AACGAAGCATCTGTGCTTCATTTTGTAGAACAAAAATGCAACGCGAGAGCGCTAATTTTT", "#d97706", "High-copy Saccharomyces cerevisiae 2-micron episomal origin", "Origin"),
        cf("cf-6xhis-alt", "6xHis Tag (CATCAC)", "tag", "CATCACCATCACCATCAC", "#8b5cf6", "Hexahistidine affinity tag", "Affinity Tag"),
        cf("cf-8xhis", "8xHis Tag", "tag", "CATCACCATCACCATCACCATCAC", "#8b5cf6", "Octahistidine high-affinity IMAC tag", "Affinity Tag"),
        cf("cf-flag", "FLAG Epitope Tag", "tag", "GACTACAAGGACGACGATGACAAG", "#a855f7", "DYKDDDDK anti-FLAG epitope tag", "Affinity Tag"),
        cf("cf-3xflag", "3xFLAG Epitope Tag", "tag", "GACTACAAAGACCATGACGGTGATTATAAAGATCATGACATCGACTACAAGGATGACGATGACAAG", "#a855f7", "Tandem 3xFLAG high-sensitivity epitope tag", "Affinity Tag"),
        cf("cf-ha", "HA Epitope Tag", "tag", "TACCCATACGATGTTCCAGATTACGCT", "#a855f7", "Hemagglutinin YPYDVPDYA epitope tag", "Affinity Tag"),
        cf("cf-myc", "c-Myc Epitope Tag", "tag", "GAACAAAAACTCATCTCAGAAGAGGATCTG", "#a855f7", "EQKLISEEDL c-Myc epitope tag", "Affinity Tag"),
        cf("cf-v5", "V5 Epitope Tag", "tag", "GGTAAGCCTATCCCTAACCCTCTCCTCGGTCTCGATTCTACG", "#a855f7", "GKPIPNPLLGLDST V5 epitope tag", "Affinity Tag"),
        cf("cf-strepii", "Strep-tag II", "tag", "TGGAGCCACCCGCAGTTCGAAAAA", "#7c3aed", "WSHPQFEK Strep-Tactin affinity tag", "Affinity Tag"),
        cf("cf-avi", "AviTag Biotinylation Motif", "tag", "GGCCTGAACGACATCTTCGAGGCTCAGAAAATCGAATGGCACGAA", "#7c3aed", "GLNDIFEAQKIEWHE BirA enzymatic site-specific biotinylation tag", "Affinity Tag"),
        cf("cf-tev-std", "TEV Protease Site (ENLYFQG)", "protein_bind", "GAGAACCTGTACTTCCAGGGC", "#ec4899", "TEV protease site", "Protease Cleavage"),
        cf("cf-hrv3c", "HRV 3C / PreScission Site", "protein_bind", "CTGGAAGTTCTGTTCCAGGGGCCC", "#ec4899", "LEVLFQ/GP cold-active protease cleavage site", "Protease Cleavage"),
        cf("cf-thrombin", "Thrombin Cleavage Site", "protein_bind", "CTGGTGCCGCGCGGCAGC", "#ec4899", "LVPR/GS thrombin cleavage motif", "Protease Cleavage"),
        cf("cf-enterokinase", "Enterokinase Cleavage Site", "protein_bind", "GACGACGACGACAAG", "#ec4899", "DDDDK/ enterokinase scarless N-terminal cleavage site", "Protease Cleavage"),
        cf("cf-p2a", "P2A Self-Cleaving Peptide", "misc_feature", "GCTACTAACTTCAGCCTGCTGAAGCAGGCTGGAGACGTGGAGGAGAACCCTGGACCT", "#0d9488", "Porcine teschovirus-1 2A ribosomal skipping peptide", "Linker / 2A / IRES"),
        cf("cf-t2a", "T2A Self-Cleaving Peptide", "misc_feature", "GAGGGCAGAGGAAGTCTGCTAACATGCGGTGACGTCGAGGAGAATCCTGGACCT", "#0d9488", "Thosea asigna virus 2A ribosomal skipping peptide", "Linker / 2A / IRES"),
        cf("cf-e2a", "E2A Self-Cleaving Peptide", "misc_feature", "CAGTGTACTAATTATGCTCTCTTGAAATTGGCTGGAGATGTTGAGAGCAACCCTGGACCT", "#0d9488", "Equine rhinitis A virus 2A ribosomal skipping peptide", "Linker / 2A / IRES"),
        cf("cf-ires", "EMCV IRES Core", "regulatory", "CCCCCTAACGTTACTGGCCGAAGCCGCTTGGAATAAGGCCGGTGTGCGTTTGTCTATATG", "#0f766e", "Encephalomyocarditis virus internal ribosome entry site", "Linker / 2A / IRES"),
        cf("cf-sv40nls", "SV40 NLS", "sig_peptide", "CCCAAGAAGAAGAGGAAGGTG", "#0891b2", "PKKKRKV nuclear localization signal", "Signal / Localization"),
        cf("cf-nucleoplasmin-nls", "Nucleoplasmin Bipartite NLS", "sig_peptide", "AAAAGGCCGGCGGCCACGAAAAAGGCCGGCCAGGCAAAAAAGAAAAAG", "#0891b2", "KRPAATKKAGQAKKKK bipartite nuclear localization signal for Cas9/base editors", "Signal / Localization"),
        cf("cf-pelb", "PelB Periplasmic Signal", "sig_peptide", "ATGAAATACCTGCTGCCGACCGCTGCTGCTGGTCTGCTGCTCCTCGCTGCCCAGCCGGCGATGGCC", "#0891b2", "E. coli periplasmic secretion leader", "Signal / Localization"),
        cf("cf-igk", "Murine Igκ Secretion Signal", "sig_peptide", "ATGGAGACAGACACACTCCTGCTATGGGTACTGCTGCTCTGGGTTCCAGGTTCCACTGGTGAC", "#0891b2", "Mammalian Ig kappa ER secretion signal peptide", "Signal / Localization"),
        cf("cf-il2-sig", "Human IL-2 Secretion Signal", "sig_peptide", "ATGTACAGGATGCAACTCCTGTCTTGCATTGCACTAAGTCTTGCACTTGTCACAAACAGT", "#0891b2", "MYRMQLLSCIALSLALVTNS mammalian secretory leader peptide", "Signal / Localization"),
        cf("cf-wpre", "WPRE Post-Transcriptional Element", "regulatory", "AATCAACCTCTGGATTACAAAATTTGTGAAAGATTGACTGGTATTCTTAACTATGTTGCT", "#475569", "Woodchuck hepatitis post-transcriptional regulatory element", "Viral / Regulatory"),
        cf("cf-cppt", "cPPT / CTS Lentiviral Flap", "regulatory", "TTTTAAAAGAAAAGGGGGGATTGGGGGGTACAGTGCAGGGGAAAGAATAGTAGACATAAT", "#475569", "HIV-1 central polypurine tract nuclear import enhancer", "Viral / Regulatory"),
        cf("cf-bghpa", "bGH Poly(A) Signal", "terminator", "CTGTGCCTTCTAGTTGCCAGCCATCTGTTGTTTGCCCCTCCCCCGTGCCTTCCTTGACCC", "#64748b", "Bovine growth hormone polyadenylation signal", "Terminator"),
        cf("cf-sv40pa", "SV40 Poly(A) Signal", "terminator", "CAGACATGATAAGATACATTGATGAGTTTGGACAAACCACAACTAGAATGCAGTGAAAAA", "#64748b", "SV40 late polyadenylation signal", "Terminator"),
        cf("cf-rrnb-t1", "rrnB T1 Bacterial Terminator", "terminator", "AAATAAAACGAAAGGCTCAGTCGAAAGACTGGGCCTTTCGTTTTATCTGTTGTTTGTCGGTGAACGCTCTC", "#64748b", "Strong E. coli rrnB T1 Rho-independent transcription terminator", "Terminator"),
        cf("cf-aav2itr", "AAV2 ITR Hairpin", "regulatory", "CCTGCAGGCAGCTGCGCGCTCGCTCGCTCACTGAGGCCGCCCGGGCAAAGCCCGGGCGTC", "#be123c", "Adeno-associated virus serotype 2 inverted terminal repeat", "Viral / Regulatory"),
        cf("cf-sinltr", "HIV-1 ΔU3 SIN LTR", "regulatory", "TGGAAGGGCTAATTCACTCCCAACGAAGACAAGATCTGCTTTTTGCTTGTACTGGGTCTC", "#be123c", "3rd-generation self-inactivating lentiviral LTR", "Viral / Regulatory"),
        cf("cf-loxp", "loxP Cre Site", "protein_bind", "ATAACTTCGTATAGCATACATTATACGAAGTTAT", "#e11d48", "34 bp Cre recombinase loxP target", "Recombination"),
        cf("cf-lox2272", "lox2272 Orthogonal FLEX Site", "protein_bind", "ATAACTTCGTATAAAGTATCCTATACGAAGTTAT", "#e11d48", "34 bp mutant FLEX/DIO Cre target", "Recombination"),
        cf("cf-frt", "FRT Flp Site", "protein_bind", "GAAGTTCCTATTCTCTAGAAAGTATAGGAACTTC", "#e11d48", "34 bp Flp recombinase target", "Recombination"),
        cf("cf-attl1", "attL1 Gateway Entry Site", "protein_bind", "TTTATAATGCCAACTTTGTACAAAAAAGCAGGCT", "#db2777", "Gateway Entry upstream attL1 recombination core", "Recombination"),
        cf("cf-attl2", "attL2 Gateway Entry Site", "protein_bind", "ACCCAGCTTTCTTGTACAAAGTGGTTCGATAAC", "#db2777", "Gateway Entry downstream attL2 recombination core", "Recombination"),
        cf("cf-cas9-scaf", "SpCas9 sgRNA Scaffold", "crispr_guide", "GTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGC", "#7c3aed", "S. pyogenes Cas9 chimeric sgRNA scaffold", "CRISPR / RNAi"),
        cf("cf-higg1-fc", "Human IgG1 Hinge-CH2 Core", "CDS", "GAGCCCAAATCTTGTGACAAAACTCACACATGCCCACCGTGCCCAGCACCTGA", "#4f46e5", "Human IgG1 constant Fc hinge-CH2 signature", "Antibody / CAR-T"),
    ]
}

/// Cleavage motif (▼ = scissile bond) for a protease-site template, or None.
/// Every protease site used to be labelled with the TEV motif.
fn protease_cleavage_motif(tpl: &CommonFeatureTemplate) -> Option<String> {
    if tpl.category != "Protease Cleavage" {
        return None;
    }
    let motif = match tpl.id.as_str() {
        "cf-hrv3c" => "LEVLFQ▼GP",
        "cf-thrombin" => "LVPR▼GS",
        "cf-enterokinase" => "DDDDK▼",
        _ if tpl.name.to_ascii_lowercase().contains("tev") => "ENLYFQ▼G",
        _ => "cleavage site",
    };
    Some(motif.to_string())
}

/// Automatically scan a `SequenceDocument` on both forward and reverse-complement strands in a single
/// `AhoCorasick` automaton pass to discover unannotated common plasmid & viral elements.
pub fn detect_common_features(doc: &SequenceDocument) -> Vec<SequenceFeature> {
    let s = clean_alpha_sequence(&doc.sequence).replace('U', "T");
    let seq_len = s.len();
    if seq_len < 6 {
        return Vec::new();
    }
    let rc = reverse_complement_iupac(&s, false);
    let templates = get_common_plasmid_features();
    let patterns: Vec<&str> = templates
        .iter()
        .map(|t| t.sequence_motif.as_str())
        .collect();

    let Ok(ac) = AhoCorasick::new(&patterns) else {
        return Vec::new();
    };

    let mut discovered: Vec<SequenceFeature> = Vec::new();
    let mut seen_fwd: Vec<bool> = vec![false; templates.len()];
    let mut seen_rev: Vec<bool> = vec![false; templates.len()];

    for mat in ac.find_overlapping_iter(&s) {
        let tid = mat.pattern().as_usize();
        if seen_fwd[tid] {
            continue;
        }
        seen_fwd[tid] = true;
        let tpl = &templates[tid];
        let start = mat.start() + 1;
        let end = mat.end();
        let already = doc.features.iter().any(|f| {
            f.start.abs_diff(start) <= 5 && f.name.eq_ignore_ascii_case(&tpl.name)
        });
        if !already {
            discovered.push(SequenceFeature {
                id: format!("auto-cf-{}-{}", tpl.id, start),
                name: tpl.name.clone(),
                feature_type: tpl.feature_type.clone(),
                start,
                end,
                strand: 1,
                color: tpl.color.clone(),
                notes: Some(format!("{} [Auto-Detected]", tpl.description)),
                qualifiers: None,
                segments: None,
                cleavage_site: protease_cleavage_motif(tpl),
            });
        }
    }

    for mat in ac.find_overlapping_iter(&rc) {
        let tid = mat.pattern().as_usize();
        if seen_rev[tid] {
            continue;
        }
        seen_rev[tid] = true;
        let tpl = &templates[tid];
        let start = seq_len.saturating_sub(mat.end()) + 1;
        let end = seq_len.saturating_sub(mat.start());
        let already = doc.features.iter().any(|f| {
            f.start.abs_diff(start) <= 5 && f.name.eq_ignore_ascii_case(&tpl.name)
        });
        if !already {
            discovered.push(SequenceFeature {
                id: format!("auto-cf-rev-{}-{}", tpl.id, start),
                name: tpl.name.clone(),
                feature_type: tpl.feature_type.clone(),
                start,
                end,
                strand: -1,
                color: tpl.color.clone(),
                notes: Some(format!("{} [Auto-Detected Reverse]", tpl.description)),
                qualifiers: None,
                segments: None,
                // A protease site read on the reverse strand is still a site.
                cleavage_site: protease_cleavage_motif(tpl),
            });
        }
    }

    discovered.sort_by_key(|f| f.start);
    discovered
}
