// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use aho_corasick::{AhoCorasick, AhoCorasickBuilder, MatchKind};
use molbiocraft_core::{
    clean_alpha_sequence, format_thousands, iupac_base_matches, reverse_complement_iupac,
    RestrictionCutSite, RestrictionEnzyme, SequenceDocument, Topology,
};
use molbiocraft_protein::translate_codon_standard;
use rustc_hash::FxHashSet;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DigestFragment {
    pub id: String,
    pub index: usize,
    pub start: usize,
    pub end: usize,
    pub length_bp: usize,
    pub left_enzyme: String,
    pub left_overhang: String,
    pub left_overhang_type: String,
    pub right_enzyme: String,
    pub right_overhang: String,
    pub right_overhang_type: String,
    pub sequence: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilentMutationCandidate {
    pub enzyme_name: String,
    pub recognition_seq: String,
    pub position_bp: usize,
    pub codon_number: usize,
    pub amino_acid: String,
    pub wild_type_codon: String,
    pub mutant_codon: String,
    pub mutation_label: String,
    /// Name of the CDS the codon belongs to (CDS-aware analysis only).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub cds_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgaroseGelBandPhysics {
    pub size_bp: usize,
    pub log10_bp: f64,
    pub relative_mobility_rf: f64,
    pub migration_mm: f64,
    pub diffusion_sigma_mm: f64,
    pub relative_fluorescence: f64,
}

fn enz(
    name: &str,
    rec: &str,
    cut_fwd: i32,
    cut_rev: i32,
    is_type_iis: bool,
    suppliers: &[&str],
    meth: &[&str],
    buf: &str,
    temp_c: u32,
) -> RestrictionEnzyme {
    RestrictionEnzyme {
        name: name.to_string(),
        recognition_seq: rec.to_string(),
        cut_fwd,
        cut_rev,
        is_type_iis,
        suppliers: suppliers.iter().map(|s| (*s).to_string()).collect(),
        methylation_sensitivity: meth.iter().map(|m| (*m).to_string()).collect(),
        buffer_standard: buf.to_string(),
        temp_c,
    }
}

/// How many of the catalog's first enzymes (the core cloning set) `find_restriction_cut_sites`
/// scans a sequence of more than 100,000 bp with, when it is given no enzymes of its own. The App
/// names this count to the user as `CORE_CATALOG_LEN` in src/components/CircularPlasmidMap.tsx,
/// which src/__tests__/accessibilityFloor.test.tsx holds equal to this line.
pub const CORE_CATALOG_LEN: usize = 28;

/// Curated REBASE Type II, Type IIS Golden Gate, 8-bp Rare-Cutter, and Homing Endonuclease Catalog (132 enzymes).
/// Preserves the exact 28 primary MCS enzymes at indices 0..28, followed by 104 high-specificity
/// 6-bp, 7-bp, 8-bp, Type IIS, and homing endonucleases used in molecular cloning and genome mapping.
pub fn get_rebase_enzymes() -> Vec<RestrictionEnzyme> {
    vec![
        // ─── Core 28 Standard Cloning, Blunt, & Type IIS Enzymes (Indices 0..28) ───
        enz("EcoRI", "GAATTC", 1, 5, false, &["NEB", "Thermo", "Takara", "Promega"], &["CpG"], "rCutSmart / NEBuffer EcoRI", 37),
        enz("BamHI", "GGATCC", 1, 5, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart / NEBuffer r3.1", 37),
        enz("HindIII", "AAGCTT", 1, 5, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart / NEBuffer r2.1", 37),
        enz("NotI", "GCGGCCGC", 2, 6, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart", 37),
        enz("XhoI", "CTCGAG", 1, 5, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart", 37),
        enz("NdeI", "CATATG", 2, 4, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("NcoI", "CCATGG", 1, 5, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("XbaI", "TCTAGA", 1, 5, false, &["NEB", "Thermo", "Takara"], &["Dam"], "rCutSmart", 37),
        enz("SpeI", "ACTAGT", 1, 5, false, &["NEB", "Thermo"], &[], "rCutSmart", 37),
        enz("PstI", "CTGCAG", 5, 1, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart / NEBuffer r3.1", 37),
        enz("SalI", "GTCGAC", 1, 5, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart / NEBuffer r3.1", 37),
        enz("KpnI", "GGTACC", 5, 1, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("SacI", "GAGCTC", 5, 1, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("SmaI", "CCCGGG", 3, 3, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart", 25),
        enz("EcoRV", "GATATC", 3, 3, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart / NEBuffer r3.1", 37),
        enz("PvuII", "CAGCTG", 3, 3, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("BglII", "AGATCT", 1, 5, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart / NEBuffer r3.1", 37),
        enz("NheI", "GCTAGC", 1, 5, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart", 37),
        enz("AgeI", "ACCGGT", 1, 5, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart", 37),
        enz("MluI", "ACGCGT", 1, 5, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart / NEBuffer r3.1", 37),
        enz("PacI", "TTAATTAA", 5, 3, false, &["NEB", "Thermo"], &[], "rCutSmart", 37),
        enz("AscI", "GGCGCGCC", 2, 6, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart", 37),
        enz("AvrII", "CCTAGG", 1, 5, false, &["NEB", "Thermo"], &[], "rCutSmart", 37),
        enz("ClaI", "ATCGAT", 2, 4, false, &["NEB", "Thermo"], &["Dam", "CpG"], "rCutSmart", 37),
        // DpnI *requires* Dam-methylated GATC (template DNA from dam+ E. coli); it is not blocked by it.
        enz("DpnI", "GATC", 2, 2, false, &["NEB", "Thermo"], &[], "rCutSmart (cuts only Dam-methylated GA(m6)TC)", 37),
        enz("BsaI-HFv2", "GGTCTC", 7, 11, true, &["NEB"], &["Dcm", "CpG"], "rCutSmart (Golden Gate Type IIS)", 37),
        enz("BsmBI-v2", "CGTCTC", 7, 11, true, &["NEB", "Thermo"], &["CpG"], "NEBuffer r3.1 (Golden Gate Type IIS)", 55),
        enz("BbsI-HF", "GAAGAC", 8, 12, true, &["NEB", "Thermo"], &[], "rCutSmart (Golden Gate Type IIS)", 37),
        // ─── Extended Type IIS Modular & Golden Gate Assembly Endonucleases ───
        enz("SapI", "GCTCTTC", 8, 11, true, &["NEB"], &[], "rCutSmart (Type IIS 3-nt overhang)", 37),
        enz("PaqCI", "CACCTGC", 11, 15, true, &["NEB"], &[], "rCutSmart (AarI isoschizomer Type IIS)", 37),
        enz("AarI", "CACCTGC", 11, 15, true, &["Thermo"], &[], "Buffer AarI (Type IIS 4-nt overhang)", 37),
        enz("Esp3I", "CGTCTC", 7, 11, true, &["Thermo", "NEB"], &["CpG"], "rCutSmart / Tango (Type IIS)", 37),
        enz("BtgZI", "GCGATG", 16, 20, true, &["NEB"], &["CpG"], "rCutSmart (Long-reach Type IIS)", 60),
        enz("BfuAI", "ACCTGC", 10, 14, true, &["NEB"], &[], "NEBuffer r3.1 (Type IIS)", 50),
        enz("BspMI", "ACCTGC", 10, 14, true, &["NEB"], &[], "NEBuffer r3.1 (Type IIS)", 37),
        enz("EarI", "CTCTTC", 7, 10, true, &["NEB"], &[], "rCutSmart (Type IIS 3-nt overhang)", 37),
        enz("BseRI", "GAGGAG", 16, 14, true, &["NEB"], &[], "rCutSmart (Type IIS 3' 2-nt overhang)", 37),
        enz("BciVI", "GTATCC", 12, 11, true, &["NEB"], &[], "rCutSmart (Type IIS)", 37),
        enz("BmrI", "ACTGGG", 11, 10, true, &["NEB"], &[], "NEBuffer r2.1 (Type IIS)", 37),
        enz("BpuEI", "CTTGAG", 22, 20, true, &["NEB"], &[], "rCutSmart (Type IIS)", 37),
        // BsaXI cuts on both sides, (9/12)ACNNNNNCTCC(10/7); only the downstream cut is modelled.
        enz("BsaXI", "ACNNNNNCTCC", 21, 18, true, &["NEB"], &[], "rCutSmart (Type IIB; downstream cut only)", 37),
        enz("BsgI", "GTGCAG", 22, 20, true, &["NEB"], &[], "rCutSmart (Type IIS)", 37),
        enz("BsmAI", "GTCTC", 6, 10, true, &["NEB"], &["CpG"], "rCutSmart (Type IIS)", 55),
        enz("BsmFI", "GGGAC", 15, 19, true, &["NEB"], &["Dcm", "CpG"], "rCutSmart (Type IIS)", 65),
        enz("BspCNI", "CTCAG", 14, 12, true, &["NEB"], &[], "rCutSmart (Type IIS)", 25),
        enz("BsrDI", "GCAATG", 8, 6, true, &["NEB"], &[], "NEBuffer r2.1 (Type IIS)", 65),
        enz("BtsI-v2", "GCAGTG", 8, 6, true, &["NEB"], &[], "rCutSmart (Type IIS)", 37),
        enz("BtsIMutI", "CAGTG", 7, 5, true, &["NEB"], &[], "rCutSmart (Type IIS)", 55),
        enz("AcuI", "CTGAAG", 22, 20, true, &["NEB"], &[], "rCutSmart (Type IIS)", 37),
        enz("EciI", "GGCGGA", 17, 15, true, &["NEB"], &["CpG"], "rCutSmart (Type IIS)", 37),
        // ─── 8-bp Rare-Cutters & Megabase Genome Mapping Endonucleases ───
        enz("PmeI", "GTTTAAAC", 4, 4, false, &["NEB", "Thermo"], &[], "rCutSmart (8-bp Blunt Rare-Cutter)", 37),
        enz("SwaI", "ATTTAAAT", 4, 4, false, &["NEB", "Thermo", "Takara"], &[], "NEBuffer r3.1 (8-bp Blunt Rare-Cutter)", 25),
        enz("FseI", "GGCCGGCC", 6, 2, false, &["NEB"], &["CpG"], "rCutSmart (8-bp GC Rare-Cutter)", 37),
        enz("SbfI", "CCTGCAGG", 6, 2, false, &["NEB", "Thermo"], &[], "rCutSmart (8-bp Rare-Cutter)", 37),
        enz("AsiSI", "GCGATCGC", 5, 3, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart (8-bp Rare-Cutter)", 37),
        enz("SrfI", "GCCCGGGC", 4, 4, false, &["NEB"], &["CpG"], "rCutSmart (8-bp Blunt Rare-Cutter)", 37),
        enz("SgrAI", "CRCCGGYG", 2, 6, false, &["NEB"], &["CpG"], "rCutSmart (8-bp Degenerate Rare-Cutter)", 37),
        enz("SfiI", "GGCCNNNNNGGCC", 8, 5, false, &["NEB", "Thermo", "Takara"], &["Dcm", "CpG"], "rCutSmart", 50),
        enz("MauBI", "CGCGCGCG", 2, 6, false, &["Thermo"], &["CpG"], "Buffer Tango (8-bp CpG Island Cutter)", 37),
        enz("MssI", "GTTTAAAC", 4, 4, false, &["Thermo"], &[], "Buffer B (PmeI Isoschizomer)", 37),
        // ─── Homing Endonucleases (Intron / Intein Megabase Mapping) ───
        enz("I-SceI", "TAGGGATAACAGGGTAAT", 9, 5, false, &["NEB", "Thermo"], &[], "rCutSmart (18-bp Homing Endonuclease)", 37),
        enz("I-CeuI", "TAACTATAACGGTCCTAAGGTAGCGAA", 18, 14, false, &["NEB"], &[], "rCutSmart (27-bp rRNA Homing Endonuclease)", 37),
        enz("PI-SceI", "ATCTATGTCGGGTGCGGAGAAAGAGGTAAT", 15, 11, false, &["NEB"], &[], "NEBuffer PI-SceI (Intein Homing)", 37),
        enz("PI-PspI", "TGGCAAACAGCTATTATGGGTATTATGGGT", 17, 13, false, &["NEB"], &[], "NEBuffer PI-PspI (Homing Endonuclease)", 65),
        // ─── Standard 6-bp Cohesive & Blunt Type II Laboratory Enzymes ───
        enz("ApaI", "GGGCCC", 5, 1, false, &["NEB", "Thermo", "Takara", "Promega"], &["Dcm", "CpG"], "rCutSmart", 25),
        enz("PspOMI", "GGGCCC", 1, 5, false, &["NEB"], &["Dcm", "CpG"], "rCutSmart (5'-overhang ApaI neoschizomer)", 37),
        enz("ApaLI", "GTGCAC", 1, 5, false, &["NEB", "Takara"], &["CpG"], "rCutSmart", 37),
        enz("AflII", "CTTAAG", 1, 5, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("AfeI", "AGCGCT", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("AleI-v2", "CACNNNNGTG", 5, 5, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("AlwNI", "CAGNNNCTG", 6, 3, false, &["NEB"], &["Dcm"], "rCutSmart", 37),
        enz("AseI", "ATTAAT", 2, 4, false, &["NEB", "Thermo"], &[], "NEBuffer r3.1 (NdeI-compatible TA overhang)", 37),
        enz("AvaI", "CYCGRG", 1, 5, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart", 37),
        enz("BaeGI", "GKGCMC", 5, 1, false, &["NEB"], &[], "NEBuffer r3.1", 37),
        enz("BanI", "GGYRCC", 1, 5, false, &["NEB"], &["Dcm", "CpG"], "rCutSmart", 37),
        enz("BanII", "GRGCYC", 5, 1, false, &["NEB", "Takara"], &[], "rCutSmart", 37),
        enz("BclI", "TGATCA", 1, 5, false, &["NEB", "Thermo", "Promega"], &["Dam"], "NEBuffer r3.1 (BamHI-compatible GATC)", 50),
        enz("BglI", "GCCNNNNNGGC", 7, 4, false, &["NEB", "Thermo", "Takara"], &["CpG"], "NEBuffer r3.1", 37),
        enz("BlpI", "GCTNAGC", 2, 5, false, &["NEB"], &[], "rCutSmart", 37),
        enz("BmgBI", "CACGTC", 3, 3, false, &["NEB"], &["CpG"], "NEBuffer r3.1 (Blunt)", 37),
        enz("BmtI-HF", "GCTAGC", 5, 1, false, &["NEB"], &["CpG"], "rCutSmart (3'-overhang NheI neoschizomer)", 37),
        enz("Bpu10I", "CCTNAGC", 2, 5, false, &["NEB", "Thermo"], &[], "NEBuffer r3.1", 37),
        enz("BsaAI", "YACGTR", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("BsaBI", "GATNNNNATC", 5, 5, false, &["NEB"], &["Dam"], "rCutSmart (Blunt)", 60),
        enz("BsaWI", "WCCGGW", 1, 5, false, &["NEB"], &[], "rCutSmart", 60),
        enz("BsiWI-HF", "CGTACG", 1, 5, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart", 37),
        enz("BsmI", "GAATGC", 7, 5, false, &["NEB", "Thermo"], &[], "rCutSmart", 65),
        enz("BsoBI", "CYCGRG", 1, 5, false, &["NEB"], &[], "rCutSmart", 37),
        enz("Bsp1286I", "GDGCHC", 5, 1, false, &["NEB"], &[], "rCutSmart", 37),
        enz("BspDI", "ATCGAT", 2, 4, false, &["NEB"], &["Dam", "CpG"], "rCutSmart (ClaI isoschizomer)", 37),
        enz("BspEI", "TCCGGA", 1, 5, false, &["NEB", "Thermo"], &["Dam", "CpG"], "NEBuffer r3.1 (AgeI/XmaI-compatible)", 37),
        enz("BspHI", "TCATGA", 1, 5, false, &["NEB"], &["Dam"], "rCutSmart (NcoI/PciI-compatible CATG)", 37),
        enz("BsrBI", "CCGCTC", 3, 3, false, &["NEB"], &[], "rCutSmart (Blunt)", 37),
        enz("BsrFI-v2", "RCCGGY", 1, 5, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("BsrGI-HF", "TGTACA", 1, 5, false, &["NEB", "Thermo"], &[], "rCutSmart", 37),
        enz("BssHII", "GCGCGC", 1, 5, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart", 50),
        enz("BstAPI", "GCANNNNNTGC", 7, 4, false, &["NEB"], &[], "rCutSmart", 60),
        enz("BstBI", "TTCGAA", 2, 4, false, &["NEB"], &["CpG"], "rCutSmart", 65),
        enz("BstEII-HF", "GGTNACC", 1, 6, false, &["NEB"], &[], "rCutSmart", 37),
        enz("BstXI", "CCANNNNNNTGG", 8, 4, false, &["NEB", "Thermo", "Takara"], &["Dcm"], "NEBuffer r3.1", 37),
        enz("BstYI", "RGATCY", 1, 5, false, &["NEB"], &[], "rCutSmart", 60),
        enz("BstZ17I-HF", "GTATAC", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("Bsu36I", "CCTNAGG", 2, 5, false, &["NEB", "Thermo"], &[], "rCutSmart", 37),
        enz("DraI", "TTTAAA", 3, 3, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart (Blunt)", 37),
        enz("DraIII-HF", "CACNNNGTG", 6, 3, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("DrdI", "GACNNNNNNGTC", 7, 5, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("EaeI", "YGGCCR", 1, 5, false, &["NEB", "Takara"], &["Dcm", "CpG"], "rCutSmart", 37),
        enz("EagI-HF", "CGGCCG", 1, 5, false, &["NEB"], &["CpG"], "rCutSmart (NotI-compatible GGCC)", 37),
        enz("EcoNI", "CCTNNNNNAGG", 5, 6, false, &["NEB"], &[], "rCutSmart", 37),
        enz("EcoO109I", "RGGNCCY", 2, 5, false, &["NEB", "Takara"], &["Dcm"], "rCutSmart", 37),
        enz("FspI", "TGCGCA", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("HaeII", "RGCGCY", 5, 1, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("HincII", "GTYRAC", 3, 3, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("HpaI", "GTTAAC", 3, 3, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("KasI", "GGCGCC", 1, 5, false, &["NEB"], &["CpG"], "rCutSmart (NarI/PluTI neoschizomer)", 37),
        enz("MfeI-HF", "CAATTG", 1, 5, false, &["NEB", "Thermo"], &[], "rCutSmart (EcoRI-compatible AATT)", 37),
        enz("MscI", "TGGCCA", 3, 3, false, &["NEB", "Thermo"], &["Dcm"], "rCutSmart (Blunt)", 37),
        enz("MslI", "CAYNNNNRTG", 5, 5, false, &["NEB"], &[], "rCutSmart (Blunt)", 37),
        enz("MspA1I", "CMGCKG", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("NaeI", "GCCGGC", 3, 3, false, &["NEB", "Takara"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("NarI", "GGCGCC", 2, 4, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart", 37),
        enz("NgoMIV", "GCCGGC", 1, 5, false, &["NEB", "Promega"], &["CpG"], "rCutSmart (AgeI/XmaI-compatible CCGG)", 37),
        enz("NruI-HF", "TCGCGA", 3, 3, false, &["NEB", "Thermo", "Takara"], &["Dam", "CpG"], "rCutSmart (Blunt)", 37),
        enz("NsiI-HF", "ATGCAT", 5, 1, false, &["NEB", "Thermo"], &[], "rCutSmart (PstI-compatible TGCA)", 37),
        enz("PciI", "ACATGT", 1, 5, false, &["NEB"], &[], "NEBuffer r3.1 (NcoI-compatible CATG)", 37),
        enz("PflFI", "GACNNNGTC", 4, 5, false, &["NEB"], &[], "rCutSmart", 37),
        enz("PflMI", "CCANNNNNTGG", 7, 4, false, &["NEB"], &["Dcm"], "NEBuffer r3.1", 37),
        enz("PmlI", "CACGTG", 3, 3, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("PsiI-v2", "TTATAA", 3, 3, false, &["NEB"], &[], "rCutSmart (Blunt)", 37),
        enz("PshAI", "GACNNNNGTC", 5, 5, false, &["NEB", "Takara"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("PspXI", "VCTCGAGB", 2, 6, false, &["NEB"], &["CpG"], "rCutSmart (XhoI/SalI-compatible TCGA)", 37),
        enz("PvuI-HF", "CGATCG", 4, 2, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart (PacI-compatible AT)", 37),
        enz("RsrII", "CGGWCCG", 2, 5, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("SacII", "CCGCGG", 4, 2, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart", 37),
        enz("ScaI-HF", "AGTACT", 3, 3, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart (Blunt)", 37),
        enz("SexAI", "ACCWGGT", 1, 6, false, &["NEB"], &["Dcm"], "rCutSmart", 37),
        enz("SfoI", "GGCGCC", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("SmlI", "CTYRAG", 1, 5, false, &["NEB"], &[], "rCutSmart", 55),
        enz("SnaBI", "TACGTA", 3, 3, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart (Blunt)", 37),
        enz("SphI-HF", "GCATGC", 5, 1, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("SspI-HF", "AATATT", 3, 3, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart (Blunt)", 37),
        enz("StuI", "AGGCCT", 3, 3, false, &["NEB", "Thermo", "Takara"], &["Dcm"], "rCutSmart (Blunt)", 37),
        enz("StyI-HF", "CCWWGG", 1, 5, false, &["NEB"], &[], "rCutSmart", 37),
        enz("Tth111I", "GACNNNGTC", 4, 5, false, &["NEB", "Takara"], &[], "rCutSmart", 65),
        enz("XcmI", "CCANNNNNNNNNTGG", 8, 7, false, &["NEB"], &[], "NEBuffer r2.1 (T-vector 3'-T generator)", 37),
        enz("XmaI", "CCCGGG", 1, 5, false, &["NEB", "Thermo"], &["CpG"], "rCutSmart (5'-CCGG SmaI neoschizomer)", 37),
        enz("XmnI", "GAANNNNTTC", 5, 5, false, &["NEB"], &[], "rCutSmart (Blunt)", 37),
        enz("ZraI", "GACGTC", 3, 3, false, &["NEB"], &["CpG"], "rCutSmart (Blunt AatII neoschizomer)", 37),
        enz("AatII", "GACGTC", 5, 1, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart", 37),
        // frequent cutters (4- and 5-base sites), as in REBASE / NEB
        enz("AluI", "AGCT", 2, 2, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart", 37),
        enz("HaeIII", "GGCC", 2, 2, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart", 37),
        enz("MboI", "GATC", 0, 4, false, &["NEB", "Thermo", "Takara"], &["Dam"], "rCutSmart (blocked by Dam methylation)", 37),
        enz("Sau3AI", "GATC", 0, 4, false, &["NEB", "Thermo", "Takara", "Promega"], &["CpG"], "rCutSmart (not blocked by Dam)", 37),
        enz("DpnII", "GATC", 0, 4, false, &["NEB"], &["Dam"], "NEBuffer DpnII (blocked by Dam methylation)", 37),
        enz("TaqI-v2", "TCGA", 1, 3, false, &["NEB", "Thermo", "Promega"], &["Dam"], "rCutSmart", 65),
        enz("MspI", "CCGG", 1, 3, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart (not blocked by CpG methylation)", 37),
        enz("HpaII", "CCGG", 1, 3, false, &["NEB", "Thermo", "Takara"], &["CpG"], "rCutSmart (blocked by CpG methylation)", 37),
        enz("HhaI", "GCGC", 3, 1, false, &["NEB", "Thermo", "Promega"], &["CpG"], "rCutSmart", 37),
        enz("RsaI", "GTAC", 2, 2, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart", 37),
        enz("MseI", "TTAA", 1, 3, false, &["NEB", "Thermo"], &[], "rCutSmart", 37),
        enz("NlaIII", "CATG", 4, 0, false, &["NEB"], &[], "rCutSmart", 37),
        enz("CviAII", "CATG", 1, 3, false, &["NEB"], &[], "rCutSmart", 25),
        enz("FatI", "CATG", 0, 4, false, &["NEB"], &[], "NEBuffer r2.1", 55),
        enz("HinfI", "GANTC", 1, 4, false, &["NEB", "Thermo", "Takara", "Promega"], &[], "rCutSmart", 37),
        enz("DdeI", "CTNAG", 1, 4, false, &["NEB", "Thermo", "Takara"], &[], "rCutSmart", 37),
        enz("BfaI", "CTAG", 1, 3, false, &["NEB"], &[], "rCutSmart", 37),
        enz("AciI", "CCGC", 1, 3, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("HpyCH4IV", "ACGT", 1, 3, false, &["NEB"], &["CpG"], "rCutSmart", 37),
        enz("HpyCH4V", "TGCA", 2, 2, false, &["NEB"], &[], "rCutSmart", 37),
        enz("MluCI", "AATT", 0, 4, false, &["NEB"], &[], "rCutSmart", 37),
        enz("Sau96I", "GGNCC", 1, 4, false, &["NEB", "Thermo"], &["Dcm"], "rCutSmart", 37),
        enz("ScrFI", "CCNGG", 2, 3, false, &["NEB"], &["Dcm"], "rCutSmart", 37),
        enz("BstNI", "CCWGG", 2, 3, false, &["NEB"], &[], "NEBuffer r3.1", 60),
        enz("CviQI", "GTAC", 1, 3, false, &["NEB"], &[], "rCutSmart", 25),
    ]
}

/// The most cut-site positions `find_restriction_cut_sites` and the `scan_restriction_sites` RPC
/// keep for one enzyme (BG-01M6S1K2). An enzyme that cuts more often keeps its complete count in
/// the scan's `site_counts`, is named in its `capped_enzymes`, and is named with that count in its
/// `warnings`: only its list of positions, and the marks drawn from it, stops at this many.
pub const RESTRICTION_POSITIONS_PER_ENZYME: usize = 2_000;

/// How many of the sites a restriction scan finds it keeps as positioned cut sites. Every limit
/// counts every site over the scanned range; a limit bounds only the list of positions.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RestrictionPositionLimit {
    /// Keep every site.
    All,
    /// Keep each enzyme's first `n` sites by position.
    PerEnzyme(usize),
    /// Keep the first `n` sites by position, all enzymes together.
    Total(usize),
}

/// One scanned enzyme's complete number of sites over the scanned range, and how many of them
/// Dam or Dcm methylation blocks.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EnzymeSiteCount {
    pub enzyme: String,
    pub sites: usize,
    /// Of `sites`, every one a dam+ dcm+ host's methylation blocks, by the rule each kept site's
    /// `methylation_blocked` follows; the others are the enzyme's cuts (BG-01M6S1K2).
    pub methylation_blocked: usize,
}

/// A restriction scan: every scanned enzyme's complete site count, the cut sites it kept, and
/// whether it kept them all (BG-01M6S1K2). Single cutters, noncutters and per-enzyme counts are
/// read from `site_counts`, never from the length of `sites`.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RestrictionSiteScan {
    /// The cut sites kept, by position and then enzyme name.
    pub sites: Vec<RestrictionCutSite>,
    /// Every scanned enzyme, in scan order, with its complete site count (0 for a noncutter).
    pub site_counts: Vec<EnzymeSiteCount>,
    /// The enzymes with sites left out of `sites`, in scan order.
    pub capped_enzymes: Vec<String>,
    /// The per-enzyme position limit the scan ran with, if it kept positions per enzyme.
    pub positions_per_enzyme_cap: Option<usize>,
    /// The position limit for all enzymes together, if the scan ran with one.
    pub positions_total_cap: Option<usize>,
    /// Whether the scan kept fewer sites than it found, so a reader that needs every positioned
    /// site (a methylation or Type IIS check, a digest) has not been given them all.
    pub stopped_early: bool,
    /// One plain sentence per position limit that left sites out (D0005).
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The largest number of exact motifs a degenerate recognition site is spelled out into for the
/// Aho-Corasick pass; a more degenerate site (BglI's GCCNNNNNGGC and the like) is matched base by
/// base instead. Both passes give the same matches.
const MAX_SPELLED_OUT_MOTIFS: usize = 64;

fn is_exact_acgt(motif: &str) -> bool {
    !motif.is_empty()
        && motif
            .bytes()
            .all(|b| matches!(b, b'A' | b'C' | b'G' | b'T'))
}

/// The sequence bases an IUPAC recognition-site base matches, as `iupac_base_matches` reads them:
/// an N also matches an N in the sequence. Empty for a code it does not know, which matches nothing.
fn iupac_options(pattern_base: u8) -> &'static [u8] {
    match pattern_base {
        b'A' => b"A",
        b'C' => b"C",
        b'G' => b"G",
        b'T' | b'U' => b"T",
        b'R' => b"AG",
        b'Y' => b"CT",
        b'S' => b"CG",
        b'W' => b"AT",
        b'K' => b"GT",
        b'M' => b"AC",
        b'B' => b"CGT",
        b'D' => b"AGT",
        b'H' => b"ACT",
        b'V' => b"ACG",
        b'N' => b"ACGTN",
        _ => b"",
    }
}

/// Every exact motif a degenerate site matches, when there are at most `MAX_SPELLED_OUT_MOTIFS`.
/// An N in the site is spelled out as an N too only when the sequence holds one (`sequence_has_n`).
fn spell_out_motif(motif: &[u8], sequence_has_n: bool) -> Option<Vec<Vec<u8>>> {
    let options = |b: u8| {
        let o = iupac_options(b);
        if b == b'N' && !sequence_has_n { &o[..4] } else { o }
    };
    let mut total = 1usize;
    for &b in motif {
        total = total.saturating_mul(options(b).len());
        if total > MAX_SPELLED_OUT_MOTIFS {
            return None;
        }
    }
    let mut out: Vec<Vec<u8>> = vec![Vec::with_capacity(motif.len())];
    for &b in motif {
        out = out
            .into_iter()
            .flat_map(|prefix| {
                options(b).iter().map(move |&o| {
                    let mut p = prefix.clone();
                    p.push(o);
                    p
                })
            })
            .collect();
    }
    Some(out)
}

/// The top- and bottom-strand cut offsets, from the start of the search space, of a site of `enz`
/// whose recognition sequence starts at `idx` on `strand`.
fn raw_cut_offsets(enz: &RestrictionEnzyme, idx: usize, motif_len: usize, strand: i8) -> (isize, isize) {
    let idx_i = idx as isize;
    let m_i = motif_len as isize;
    if strand == 1 {
        (idx_i + enz.cut_fwd as isize, idx_i + enz.cut_rev as isize)
    } else {
        (idx_i + m_i - enz.cut_rev as isize, idx_i + m_i - enz.cut_fwd as isize)
    }
}

/// Whether a site cuts the molecule: on a linear one both strands' cuts must fall inside it.
fn site_cuts_molecule(
    enz: &RestrictionEnzyme,
    idx: usize,
    motif_len: usize,
    strand: i8,
    seq_len: usize,
    topology: Topology,
) -> bool {
    if idx >= seq_len {
        return false;
    }
    if topology != Topology::Linear {
        return true;
    }
    let (top, bottom) = raw_cut_offsets(enz, idx, motif_len, strand);
    let len = seq_len as isize;
    (0..=len).contains(&top) && (0..=len).contains(&bottom)
}

fn record_cut_site(
    sites: &mut Vec<RestrictionCutSite>,
    enz: &RestrictionEnzyme,
    idx: usize,
    motif_len: usize,
    strand: i8,
    seq_len: usize,
    search_space: &[u8],
    topology: Topology,
) {
    if !site_cuts_molecule(enz, idx, motif_len, strand, seq_len, topology) {
        return;
    }
    let (cut_top_raw, cut_bottom_raw) = raw_cut_offsets(enz, idx, motif_len, strand);

    let len_i = seq_len as isize;
    let cut_top = (((cut_top_raw % len_i) + len_i) % len_i) as usize + 1;
    let cut_bottom = (((cut_bottom_raw % len_i) + len_i) % len_i) as usize + 1;

    let min_cut = cut_top_raw.min(cut_bottom_raw).max(0) as usize;
    let max_cut = (cut_top_raw.max(cut_bottom_raw).max(0) as usize).min(search_space.len());
    let overhang_seq = if max_cut > min_cut && min_cut < search_space.len() {
        String::from_utf8_lossy(&search_space[min_cut..max_cut]).to_string()
    } else {
        String::new()
    };

    let overhang_type = if cut_top_raw < cut_bottom_raw {
        "5prime"
    } else if cut_top_raw > cut_bottom_raw {
        "3prime"
    } else {
        "blunt"
    };

    let methylation_blocked = MethylationSensitivity::of(enz).blocks(idx, motif_len, search_space);

    sites.push(RestrictionCutSite {
        id: format!("{}-{}-{}", enz.name, idx + 1, strand),
        enzyme: enz.clone(),
        position: idx + 1,
        cut_top,
        cut_bottom,
        strand,
        overhang_seq,
        overhang_type: overhang_type.to_string(),
        methylation_blocked,
    });
}

/// Which host methylation blocks an enzyme's sites: Dam (GATC), Dcm (CCWGG), both or neither.
#[derive(Debug, Clone, Copy)]
struct MethylationSensitivity {
    dam: bool,
    dcm: bool,
}

impl MethylationSensitivity {
    fn of(enz: &RestrictionEnzyme) -> Self {
        let has = |name: &str| enz.methylation_sensitivity.iter().any(|m| m == name);
        MethylationSensitivity { dam: has("Dam"), dcm: has("Dcm") }
    }

    /// Whether a dam+ dcm+ host blocks the site starting at `idx` in `search_space`: the enzyme is
    /// sensitive to a methylation whose motif lies within the site or the three bases either side.
    fn blocks(self, idx: usize, motif_len: usize, search_space: &[u8]) -> bool {
        if !self.dam && !self.dcm {
            return false;
        }
        let ctx_start = idx.saturating_sub(3);
        let ctx_end = (idx + motif_len + 3).min(search_space.len());
        let ctx = &search_space[ctx_start..ctx_end];
        let has_sub = |needle: &[u8]| ctx.windows(needle.len()).any(|w| w == needle);
        (self.dam && has_sub(b"GATC")) || (self.dcm && (has_sub(b"CCAGG") || has_sub(b"CCTGG")))
    }
}

/// The enzymes a scan given no enzymes of its own reads: the whole catalog, or over 100,000 bp
/// only its first `CORE_CATALOG_LEN` (the core cloning set), so cut-site lists of multi-megabase
/// chromosomes stay concise.
fn default_scan_enzymes(seq_len: usize) -> Vec<RestrictionEnzyme> {
    let mut catalog = get_rebase_enzymes();
    if seq_len > 100_000 {
        catalog.truncate(CORE_CATALOG_LEN);
    }
    catalog
}

/// The cleaned sequence a scan reads (upper case, U read as T) and its search space: the sequence,
/// plus its first 36 bases again when it is circular, so a site across the origin is found.
fn scan_search_space(raw_seq: &str, topology: Topology) -> (Vec<u8>, usize) {
    let mut seq = clean_alpha_sequence(raw_seq).replace('U', "T").into_bytes();
    let seq_len = seq.len();
    if topology == Topology::Circular && seq_len > 0 {
        let wrap = seq[..seq_len.min(36)].to_vec();
        seq.extend_from_slice(&wrap);
    }
    (seq, seq_len)
}

/// What `count_and_keep_sites` found, per enzyme in the order given.
struct SiteTally {
    /// Every site that cuts the molecule.
    counts: Vec<usize>,
    /// Of those, every one Dam or Dcm methylation blocks.
    blocked: Vec<usize>,
    /// The first `keep` sites by position, as (start, strand).
    kept: Vec<Vec<(usize, i8)>>,
}

/// Every site of every enzyme in `search` (the first `seq_len` bases are the molecule): each
/// enzyme's complete count of sites that cut the molecule and of those methylation blocks, and its
/// first `keep` sites by position. Exact and slightly degenerate sites are found in one
/// Aho-Corasick pass over the sequence; a highly degenerate site is matched base by base, strand
/// by strand.
fn count_and_keep_sites(
    search: &[u8],
    seq_len: usize,
    enzymes: &[RestrictionEnzyme],
    topology: Topology,
    keep: usize,
) -> SiteTally {
    let mut counts = vec![0usize; enzymes.len()];
    let mut blocked = vec![0usize; enzymes.len()];
    let mut kept: Vec<Vec<(usize, i8)>> = vec![Vec::new(); enzymes.len()];
    if seq_len == 0 {
        return SiteTally { counts, blocked, kept };
    }
    let sensitivity: Vec<MethylationSensitivity> = enzymes.iter().map(MethylationSensitivity::of).collect();
    let sequence_has_n = search[..seq_len].contains(&b'N');

    let mut ac_patterns: Vec<Vec<u8>> = Vec::with_capacity(enzymes.len() * 2);
    let mut ac_meta: Vec<(usize, i8, usize)> = Vec::with_capacity(enzymes.len() * 2);
    let mut window_patterns: Vec<(usize, Vec<u8>, i8)> = Vec::new();
    for (e_idx, e) in enzymes.iter().enumerate() {
        let rec = e.recognition_seq.to_ascii_uppercase();
        if rec.is_empty() {
            continue;
        }
        let rc = reverse_complement_iupac(&rec, false);
        let strands: Vec<(Vec<u8>, i8)> = if rec == rc {
            vec![(rec.into_bytes(), 1)]
        } else {
            vec![(rec.into_bytes(), 1), (rc.into_bytes(), -1)]
        };
        for (motif, strand) in strands {
            let exact = is_exact_acgt(std::str::from_utf8(&motif).unwrap_or(""));
            let spelled = if exact { Some(vec![motif.clone()]) } else { spell_out_motif(&motif, sequence_has_n) };
            match spelled {
                Some(list) => {
                    for p in list {
                        ac_meta.push((e_idx, strand, p.len()));
                        ac_patterns.push(p);
                    }
                }
                None => window_patterns.push((e_idx, motif, strand)),
            }
        }
    }

    if !ac_patterns.is_empty() {
        let ac = AhoCorasickBuilder::new()
            .match_kind(MatchKind::Standard)
            .build(&ac_patterns)
            .or_else(|_| AhoCorasick::new(&ac_patterns));
        if let Ok(ac) = ac {
            // Overlapping matches arrive in order of their end, so one enzyme's sites (all its
            // motifs are one length) arrive in order of their start.
            for mat in ac.find_overlapping_iter(search) {
                let (e_idx, strand, m_len) = ac_meta[mat.pattern().as_usize()];
                let start = mat.start();
                if site_cuts_molecule(&enzymes[e_idx], start, m_len, strand, seq_len, topology) {
                    counts[e_idx] += 1;
                    if sensitivity[e_idx].blocks(start, m_len, search) {
                        blocked[e_idx] += 1;
                    }
                    if kept[e_idx].len() < keep {
                        kept[e_idx].push((start, strand));
                    }
                }
            }
        }
    }

    for (e_idx, pat, strand) in &window_patterns {
        let m_len = pat.len();
        if search.len() < m_len {
            continue;
        }
        let limit = seq_len.min(search.len() - m_len + 1);
        let mut kept_here = 0usize;
        for i in 0..limit {
            if (0..m_len).all(|k| iupac_base_matches(search[i + k], pat[k]))
                && site_cuts_molecule(&enzymes[*e_idx], i, m_len, *strand, seq_len, topology)
            {
                counts[*e_idx] += 1;
                if sensitivity[*e_idx].blocks(i, m_len, search) {
                    blocked[*e_idx] += 1;
                }
                if kept_here < keep {
                    kept[*e_idx].push((i, *strand));
                    kept_here += 1;
                }
            }
        }
    }
    // A base-by-base enzyme's two strands were kept one after the other: keep its first by position.
    for k in kept.iter_mut() {
        k.sort_unstable();
        k.truncate(keep);
    }
    SiteTally { counts, blocked, kept }
}

/// The D0005 sentence for a scan whose position limit left sites of `capped` out.
fn positions_capped_warning(limit: RestrictionPositionLimit, capped: &[(String, usize)]) -> Option<String> {
    if capped.is_empty() {
        return None;
    }
    let named = capped
        .iter()
        .map(|(name, n)| format!("{} ({} sites)", name, format_thousands(*n)))
        .collect::<Vec<_>>();
    let named = match named.len() {
        1 => named[0].clone(),
        2 => format!("{} and {}", named[0], named[1]),
        n => format!("{} and {}", named[..n - 1].join(", "), named[n - 1]),
    };
    match limit {
        RestrictionPositionLimit::PerEnzyme(n) => Some(format!(
            "Cut-site positions are kept for at most {} sites per enzyme, so only the first {} positions of {} are listed; their site counts are complete.",
            format_thousands(n),
            format_thousands(n),
            named
        )),
        RestrictionPositionLimit::Total(n) => Some(format!(
            "Cut-site positions are kept for the first {} sites of all enzymes together, so the positions of {} are not all listed; their site counts are complete.",
            format_thousands(n),
            named
        )),
        RestrictionPositionLimit::All => None,
    }
}

/// Scan a sequence for restriction sites (BG-01M6S1K2): every enzyme's site count is complete over
/// the scanned range, whatever `limit` keeps of the positions; the scan names every enzyme whose
/// positions it left out and says so in `warnings`. With no enzymes of its own it reads the whole
/// catalog, or over 100,000 bp the core `CORE_CATALOG_LEN`. Exact sites, and degenerate ones of up
/// to `MAX_SPELLED_OUT_MOTIFS` spellings, are found in a single pass of an Aho-Corasick automaton;
/// a more degenerate site is matched base by base. Sites run across the origin of a circle, Type IIS
/// sites cut outside themselves, and each kept site is marked when Dam (`GATC`) or Dcm (`CCWGG`)
/// methylation blocks it; each enzyme's count of blocked sites is complete too.
pub fn scan_restriction_sites(
    raw_seq: &str,
    topology: Topology,
    custom_enzymes: Option<&[RestrictionEnzyme]>,
    limit: RestrictionPositionLimit,
) -> RestrictionSiteScan {
    let (search, seq_len) = scan_search_space(raw_seq, topology);
    let default_catalog;
    let enzymes: &[RestrictionEnzyme] = match custom_enzymes {
        Some(list) => list,
        None => {
            default_catalog = default_scan_enzymes(seq_len);
            &default_catalog
        }
    };
    let keep = match limit {
        RestrictionPositionLimit::All => usize::MAX,
        RestrictionPositionLimit::PerEnzyme(n) | RestrictionPositionLimit::Total(n) => n,
    };
    let SiteTally { counts, blocked, kept } = count_and_keep_sites(&search, seq_len, enzymes, topology, keep);

    let mut picks: Vec<(usize, i8, usize)> = kept
        .iter()
        .enumerate()
        .flat_map(|(e_idx, k)| k.iter().map(move |&(start, strand)| (start, strand, e_idx)))
        .collect();
    let by_position = |a: &(usize, i8, usize), b: &(usize, i8, usize)| {
        a.0.cmp(&b.0).then_with(|| enzymes[a.2].name.cmp(&enzymes[b.2].name))
    };
    if let RestrictionPositionLimit::Total(n) = limit {
        picks.sort_by(by_position);
        picks.truncate(n);
    }
    let mut kept_per_enzyme = vec![0usize; enzymes.len()];
    let mut sites: Vec<RestrictionCutSite> = Vec::with_capacity(picks.len());
    for &(start, strand, e_idx) in &picks {
        kept_per_enzyme[e_idx] += 1;
        let m_len = enzymes[e_idx].recognition_seq.len();
        record_cut_site(&mut sites, &enzymes[e_idx], start, m_len, strand, seq_len, &search, topology);
    }
    sites.sort_by(|a, b| a.position.cmp(&b.position).then_with(|| a.enzyme.name.cmp(&b.enzyme.name)));

    let capped: Vec<(String, usize)> = enzymes
        .iter()
        .enumerate()
        .filter(|(i, _)| kept_per_enzyme[*i] < counts[*i])
        .map(|(i, e)| (e.name.clone(), counts[i]))
        .collect();
    let warnings: Vec<String> = positions_capped_warning(limit, &capped).into_iter().collect();
    RestrictionSiteScan {
        sites,
        site_counts: enzymes
            .iter()
            .enumerate()
            .map(|(i, e)| EnzymeSiteCount { enzyme: e.name.clone(), sites: counts[i], methylation_blocked: blocked[i] })
            .collect(),
        stopped_early: !capped.is_empty(),
        capped_enzymes: capped.into_iter().map(|(name, _)| name).collect(),
        positions_per_enzyme_cap: match limit {
            RestrictionPositionLimit::PerEnzyme(n) => Some(n),
            _ => None,
        },
        positions_total_cap: match limit {
            RestrictionPositionLimit::Total(n) => Some(n),
            _ => None,
        },
        warnings,
    }
}

/// The cut sites of `scan_restriction_sites` with each enzyme's first
/// `RESTRICTION_POSITIONS_PER_ENZYME` sites kept. The list is complete for every enzyme cutting
/// that often or less; count an enzyme's sites from `scan_restriction_sites`'s `site_counts`.
pub fn find_restriction_cut_sites(
    raw_seq: &str,
    topology: Topology,
    custom_enzymes: Option<&[RestrictionEnzyme]>,
) -> Vec<RestrictionCutSite> {
    scan_restriction_sites(
        raw_seq,
        topology,
        custom_enzymes,
        RestrictionPositionLimit::PerEnzyme(RESTRICTION_POSITIONS_PER_ENZYME),
    )
    .sites
}

/// Return all REBASE enzymes that have zero recognition sites on the sequence
/// (0-cutters), scanning it as circular. Prefer
/// [`find_non_cutting_enzymes_for_topology`] when the topology is known.
pub fn find_non_cutting_enzymes(
    raw_seq: &str,
    custom_enzymes: Option<&[RestrictionEnzyme]>,
) -> Vec<RestrictionEnzyme> {
    find_non_cutting_enzymes_for_topology(raw_seq, Topology::Circular, custom_enzymes)
}

/// 0-cutters for a molecule of the given topology, from every enzyme's complete site count over
/// the whole molecule and the whole catalog (or `custom_enzymes`). A linear molecule has no
/// end-to-start junction, so a site that only exists across that junction does not make the
/// enzyme a cutter (previously always scanned as circular).
pub fn find_non_cutting_enzymes_for_topology(
    raw_seq: &str,
    topology: Topology,
    custom_enzymes: Option<&[RestrictionEnzyme]>,
) -> Vec<RestrictionEnzyme> {
    let default_catalog;
    let catalog: &[RestrictionEnzyme] = match custom_enzymes {
        Some(c) => c,
        None => {
            default_catalog = get_rebase_enzymes();
            &default_catalog
        }
    };
    let (search, seq_len) = scan_search_space(raw_seq, topology);
    let counts = count_and_keep_sites(&search, seq_len, catalog, topology, 0).counts;
    catalog
        .iter()
        .zip(&counts)
        .filter(|(_, &n)| n == 0)
        .map(|(e, _)| e.clone())
        .collect()
}

/// Simulate an in silico single or multi-enzyme restriction digest and compute linear/circular fragments.
pub fn simulate_restriction_digest(
    doc: &SequenceDocument,
    selected_enzyme_names: &[String],
) -> Vec<DigestFragment> {
    let s = clean_alpha_sequence(&doc.sequence).replace('U', "T");
    let seq_len = s.len();
    let chosen_set: FxHashSet<&str> = selected_enzyme_names.iter().map(|n| n.as_str()).collect();
    let catalog = get_rebase_enzymes();
    let chosen: Vec<RestrictionEnzyme> = catalog
        .into_iter()
        .filter(|e| chosen_set.contains(e.name.as_str()))
        .collect();

    // Every cut of the chosen enzymes (BG-01M6S1K2): a digest drawn from part of them would show
    // one band for a stretch the enzymes cut many times.
    let mut cuts: Vec<RestrictionCutSite> =
        scan_restriction_sites(&s, doc.topology, Some(&chosen), RestrictionPositionLimit::All)
            .sites
            .into_iter()
            .filter(|c| !c.methylation_blocked)
            .collect();

    if cuts.is_empty() || seq_len == 0 {
        let term = if doc.topology == Topology::Circular {
            "Supercoiled/Uncut"
        } else {
            "5' End"
        };
        let term_r = if doc.topology == Topology::Circular {
            "Supercoiled/Uncut"
        } else {
            "3' End"
        };
        return vec![DigestFragment {
            id: format!("{}-uncut", doc.id),
            index: 1,
            start: 1,
            end: seq_len.max(1),
            length_bp: seq_len,
            left_enzyme: term.to_string(),
            left_overhang: String::new(),
            left_overhang_type: "blunt".to_string(),
            right_enzyme: term_r.to_string(),
            right_overhang: String::new(),
            right_overhang_type: "blunt".to_string(),
            sequence: s,
        }];
    }

    cuts.sort_by_key(|c| c.cut_top);
    let mut unique_cuts: Vec<RestrictionCutSite> = Vec::with_capacity(cuts.len());
    let mut seen_pos: FxHashSet<usize> = FxHashSet::default();
    for c in cuts {
        if seen_pos.insert(c.cut_top) {
            unique_cuts.push(c);
        }
    }

    let mut fragments: Vec<DigestFragment> = Vec::new();
    if doc.topology == Topology::Linear {
        let mut prev_pos = 1usize;
        let mut prev_enz = "5' Terminus".to_string();
        let mut prev_oh = String::new();
        let mut prev_oh_type = "blunt".to_string();

        for (idx, c) in unique_cuts.iter().enumerate() {
            let start0 = prev_pos.saturating_sub(1).min(seq_len);
            let end0 = c.cut_top.saturating_sub(1).min(seq_len);
            let frag_seq = if end0 >= start0 {
                s[start0..end0].to_string()
            } else {
                String::new()
            };
            let frag_len = frag_seq.len().max(1);
            fragments.push(DigestFragment {
                id: format!("{}-frag-{}", doc.id, idx + 1),
                index: idx + 1,
                start: prev_pos,
                end: c.cut_top.saturating_sub(1).max(prev_pos),
                length_bp: frag_len,
                left_enzyme: prev_enz,
                left_overhang: prev_oh,
                left_overhang_type: prev_oh_type,
                right_enzyme: c.enzyme.name.clone(),
                right_overhang: c.overhang_seq.clone(),
                right_overhang_type: c.overhang_type.clone(),
                sequence: frag_seq,
            });
            prev_pos = c.cut_top;
            prev_enz = c.enzyme.name.clone();
            prev_oh = c.overhang_seq.clone();
            prev_oh_type = c.overhang_type.clone();
        }

        let tail_start0 = prev_pos.saturating_sub(1).min(seq_len);
        let tail_seq = s[tail_start0..].to_string();
        let tail_len = tail_seq.len().max(1);
        fragments.push(DigestFragment {
            id: format!("{}-frag-{}", doc.id, unique_cuts.len() + 1),
            index: unique_cuts.len() + 1,
            start: prev_pos,
            end: seq_len,
            length_bp: tail_len,
            left_enzyme: prev_enz,
            left_overhang: prev_oh,
            left_overhang_type: prev_oh_type,
            right_enzyme: "3' Terminus".to_string(),
            right_overhang: String::new(),
            right_overhang_type: "blunt".to_string(),
            sequence: tail_seq,
        });
    } else {
        for i in 0..unique_cuts.len() {
            let left_cut = &unique_cuts[i];
            let right_cut = &unique_cuts[(i + 1) % unique_cuts.len()];
            let l0 = left_cut.cut_top.saturating_sub(1).min(seq_len);
            let r0 = right_cut.cut_top.saturating_sub(1).min(seq_len);
            let frag_seq = if r0 > l0 {
                s[l0..r0].to_string()
            } else {
                format!("{}{}", &s[l0..], &s[..r0])
            };
            let frag_len = frag_seq.len().max(1);
            fragments.push(DigestFragment {
                id: format!("{}-cfrag-{}", doc.id, i + 1),
                index: i + 1,
                start: left_cut.cut_top,
                // The fragment ends on the base before the next cut (as in the
                // linear branch), wrapping through the origin. It used to end
                // on the cut base itself: off by one, and a single-cut digest
                // reported a 1-bp selection (start == end).
                end: (right_cut.cut_top + seq_len - 2) % seq_len + 1,
                length_bp: frag_len,
                left_enzyme: left_cut.enzyme.name.clone(),
                left_overhang: left_cut.overhang_seq.clone(),
                left_overhang_type: left_cut.overhang_type.clone(),
                right_enzyme: right_cut.enzyme.name.clone(),
                right_overhang: right_cut.overhang_seq.clone(),
                right_overhang_type: right_cut.overhang_type.clone(),
                sequence: frag_seq,
            });
        }
    }

    fragments.sort_by(|a, b| b.length_bp.cmp(&a.length_bp));
    fragments
}

/// Empirical agarose-gel migration model: a sigmoid in log10(bp) whose midpoint and slope shift with
/// agarose %, approximating Southern (1979) / Ogston sieving. It is a display model, not a calibrated
/// prediction; ladder bands are drawn with the same function, so relative positions are consistent.
/// Computes $\log_{10}(\text{bp})$ reptation + Ogston sieving mobility as a function of agarose % and buffer (`TAE`/`TBE`/`SB`).
pub fn compute_agarose_gel_band_physics(
    fragment_sizes_bp: &[usize],
    agarose_pct: f64,
    buffer_type: &str,
    gel_length_mm: f64,
) -> Vec<AgaroseGelBandPhysics> {
    let ag = agarose_pct.clamp(0.4, 4.0);
    let gel_mm = gel_length_mm.max(40.0);
    let buffer_factor = match buffer_type.to_ascii_uppercase().as_str() {
        "TBE" => 0.94,
        "SB" => 1.07,
        _ => 1.00, // TAE
    };

    let max_bp = (*fragment_sizes_bp.iter().max().unwrap_or(&10_000)).max(100) as f64;
    fragment_sizes_bp
        .iter()
        .map(|&bp| {
            let eff_bp = (bp.max(25)) as f64;
            let log_bp = eff_bp.log10();
            // Ferguson-Southern sigmoidal pore-sieving curve calibrated for 0.5% - 3.5% agarose
            let midpoint_log = 4.15 - 0.52 * ag;
            let slope = 1.35 + 0.22 * ag;
            let rf_raw = 1.0 / (1.0 + ((log_bp - midpoint_log) * slope).exp());
            let rf = (0.08 + 0.84 * rf_raw * buffer_factor).clamp(0.05, 0.96);
            let migration_mm = ((rf * gel_mm) * 100.0).round() / 100.0;
            let diffusion_sigma_mm =
                ((0.55 + 1.45 * (1000.0 / (eff_bp + 400.0)) / ag.sqrt()) * 100.0).round() / 100.0;
            // Intercalating-dye signal scales with dsDNA mass; equimolar fragments from one digest
            // therefore glow in proportion to their length (floored so small bands stay visible).
            let relative_fluorescence = ((eff_bp / max_bp).clamp(0.12, 1.0) * 100.0).round() / 100.0;
            AgaroseGelBandPhysics {
                size_bp: bp,
                log10_bp: (log_bp * 1000.0).round() / 1000.0,
                relative_mobility_rf: (rf * 1000.0).round() / 1000.0,
                migration_mm,
                diffusion_sigma_mm,
                relative_fluorescence,
            }
        })
        .collect()
}

/// How many silent-mutation candidates a scan lists when its caller names no number of its own.
pub const SILENT_MUTATION_LIST_DEFAULT: usize = 18;

/// A silent-mutation scan: the candidates it lists, how many it found in all, and what the list
/// left out.
///
/// `total_candidates` counts every candidate over the whole length of every scanned coding
/// sequence, however few are listed, so a caller can say "the first N of M" rather than offer N as
/// the total (BG-01M6S1Q9). `warnings` carries that sentence for the UI (D0005).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SilentMutationScan {
    pub candidates: Vec<SilentMutationCandidate>,
    pub total_candidates: usize,
    pub warnings: Vec<String>,
}

/// The catalog's exactly-spelled recognition sites of 6 bp or more - the sites a silent mutation
/// can engineer as a diagnostic cut - in one Aho-Corasick automaton, so a window is read once for
/// every site instead of once per enzyme. Isoschizomers spelling the same site each keep their own
/// pattern, and so their own candidate.
struct SilentSiteFinder {
    enzymes: Vec<RestrictionEnzyme>,
    automaton: AhoCorasick,
}

impl SilentSiteFinder {
    fn new() -> Self {
        let enzymes: Vec<RestrictionEnzyme> = get_rebase_enzymes()
            .into_iter()
            .filter(|e| e.recognition_seq.len() >= 6 && is_exact_acgt(&e.recognition_seq))
            .collect();
        let automaton = AhoCorasickBuilder::new()
            .match_kind(MatchKind::Standard)
            .build(enzymes.iter().map(|e| e.recognition_seq.as_bytes()))
            .expect("the exactly-spelled recognition sites build an automaton");
        SilentSiteFinder { enzymes, automaton }
    }

    /// Where each enzyme's site first starts in `window`, or [`usize::MAX`] where the window holds
    /// no site of it. Overlapping matches are read, so a site inside another enzyme's site counts.
    fn first_sites(&self, window: &[u8], out: &mut [usize]) {
        out.fill(usize::MAX);
        for m in self.automaton.find_overlapping_iter(window) {
            let slot = &mut out[m.pattern().as_usize()];
            if *slot == usize::MAX {
                *slot = m.start();
            }
        }
    }
}

/// Every synonymous single-base substitution in `cds` - read in frame from its first base - that
/// creates a recognition site its wild-type window does not already hold, in codon order: the
/// first `wanted` are returned, and the second value counts every one of them.
///
/// With `count_all` the whole coding sequence is read however many candidates are listed, which is
/// what makes the count a total; without it the scan returns as soon as it has `wanted`, and the
/// count is only of those (BG-01M6S1Q9: the scan used to stop at the first 3,600 bases, so a
/// candidate in the 3' end of a longer gene was never offered).
fn scan_silent_sites(
    cds: &str,
    finder: &SilentSiteFinder,
    wanted: usize,
    count_all: bool,
) -> (Vec<SilentMutationCandidate>, usize) {
    let s = cds.as_bytes();
    let mut listed: Vec<SilentMutationCandidate> = Vec::new();
    let mut total = 0usize;
    if s.len() < 12 {
        return (listed, total);
    }
    let num_codons = s.len() / 3;
    let bases = [b'A', b'C', b'G', b'T'];
    let mut wt_sites = vec![usize::MAX; finder.enzymes.len()];
    let mut mutant_sites = vec![usize::MAX; finder.enzymes.len()];
    let mut window = Vec::with_capacity(19);

    for codon_idx in 1..num_codons.saturating_sub(2) {
        let pos0 = codon_idx * 3;
        let wt_codon = &cds[pos0..pos0 + 3];
        let wt_aa = translate_codon_standard(wt_codon);
        if wt_aa == '*' || wt_aa == 'X' {
            continue;
        }
        let win_start = pos0.saturating_sub(8);
        let win_end = (pos0 + 11).min(s.len());
        window.clear();
        window.extend_from_slice(&s[win_start..win_end]);
        // The wild-type window is read once per codon: it is the same for every substitution in it.
        let mut read_wild_type = false;

        for wobble_offset in [2usize, 0usize] {
            let orig_base = wt_codon.as_bytes()[wobble_offset];
            let in_window = pos0 + wobble_offset - win_start;
            for &alt_base in &bases {
                if alt_base == orig_base {
                    continue;
                }
                let mut mut_codon_bytes = [
                    wt_codon.as_bytes()[0],
                    wt_codon.as_bytes()[1],
                    wt_codon.as_bytes()[2],
                ];
                mut_codon_bytes[wobble_offset] = alt_base;
                let mut_codon = std::str::from_utf8(&mut_codon_bytes).unwrap_or("NNN");
                if translate_codon_standard(mut_codon) != wt_aa {
                    continue;
                }
                if !read_wild_type {
                    finder.first_sites(&window, &mut wt_sites);
                    read_wild_type = true;
                }
                window[in_window] = alt_base;
                finder.first_sites(&window, &mut mutant_sites);
                window[in_window] = orig_base;

                for (idx, enz) in finder.enzymes.iter().enumerate() {
                    if wt_sites[idx] != usize::MAX || mutant_sites[idx] == usize::MAX {
                        continue;
                    }
                    total += 1;
                    if listed.len() < wanted {
                        listed.push(SilentMutationCandidate {
                            enzyme_name: enz.name.clone(),
                            recognition_seq: enz.recognition_seq.clone(),
                            position_bp: win_start + mutant_sites[idx] + 1,
                            codon_number: codon_idx + 1,
                            amino_acid: wt_aa.to_string(),
                            wild_type_codon: wt_codon.to_string(),
                            mutant_codon: mut_codon.to_string(),
                            mutation_label: format!(
                                "{}{}{} ({}→{}, {}{}=)",
                                orig_base as char,
                                pos0 + wobble_offset + 1,
                                alt_base as char,
                                wt_codon,
                                mut_codon,
                                wt_aa,
                                codon_idx + 1
                            ),
                            cds_name: None,
                        });
                    } else if !count_all {
                        return (listed, total);
                    }
                }
            }
        }
    }

    (listed, total)
}

/// Scan coding sequence triplets for synonymous single-nucleotide substitutions that introduce
/// a diagnostic 6+ bp restriction enzyme recognition site without altering the amino acid sequence.
///
/// Reads its input in frame 1 from the first base over its whole length, and returns the first
/// `max_candidates` candidates in codon order. [`analyze_silent_mutations_in_cds`] is the scan for
/// an annotated construct, and the one that reports how many candidates there are in all.
pub fn analyze_silent_mutations(
    raw_seq: &str,
    max_candidates: usize,
) -> Vec<SilentMutationCandidate> {
    let s = clean_alpha_sequence(raw_seq).replace('U', "T");
    let wanted = if max_candidates == 0 {
        SILENT_MUTATION_LIST_DEFAULT
    } else {
        max_candidates
    };
    scan_silent_sites(&s, &SilentSiteFinder::new(), wanted, false).0
}

/// A coding region to scan for silent restriction-site mutations.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CodingRegion1Based {
    pub name: String,
    pub start: usize,
    pub end: usize,
    pub strand: i8,
}

/// CDS-aware silent-mutation scan.
///
/// [`analyze_silent_mutations`] reads its input in frame 1 from the first base,
/// which is only meaningful when the input *is* a coding sequence. For an
/// annotated construct this extracts each CDS (reverse-complementing minus-strand
/// genes), scans it in frame, and reports positions and mutation labels in the
/// construct's own 1-based coordinates.
///
/// Every CDS is read over its whole length, so the reply's `total_candidates` is the number of
/// candidates there are and the listed `candidates` are the first `max_candidates` of them in
/// codon order, first CDS first (BG-01M6S1Q9).
pub fn analyze_silent_mutations_in_cds(
    raw_seq: &str,
    regions: &[CodingRegion1Based],
    max_candidates: usize,
) -> SilentMutationScan {
    let s = clean_alpha_sequence(raw_seq).replace('U', "T");
    let len = s.len();
    let limit = if max_candidates == 0 {
        SILENT_MUTATION_LIST_DEFAULT
    } else {
        max_candidates
    };
    let finder = SilentSiteFinder::new();
    let mut out = Vec::new();
    let mut total = 0usize;
    for region in regions {
        if region.start == 0 || region.end > len || region.start > region.end {
            continue;
        }
        let forward = &s[region.start - 1..region.end];
        let reverse = region.strand < 0;
        let cds = if reverse {
            reverse_complement_iupac(forward, false)
        } else {
            forward.to_string()
        };
        // Map a 1-based CDS coordinate back to the construct.
        let to_construct = |p: usize| -> usize {
            if reverse {
                region.end + 1 - p
            } else {
                region.start + p - 1
            }
        };
        let (listed, found) = scan_silent_sites(&cds, &finder, limit.saturating_sub(out.len()), true);
        total += found;
        for mut c in listed {
            let site_len = c.recognition_seq.len();
            // Report the site's lowest construct coordinate.
            c.position_bp = if reverse {
                to_construct(c.position_bp + site_len - 1)
            } else {
                to_construct(c.position_bp)
            };
            // Re-express "X<pos>Y" with the construct coordinate of the changed base.
            let changed_idx = c
                .wild_type_codon
                .bytes()
                .zip(c.mutant_codon.bytes())
                .position(|(a, b)| a != b)
                .unwrap_or(2);
            let cds_pos = (c.codon_number - 1) * 3 + changed_idx + 1;
            let wt_base = c.wild_type_codon.as_bytes()[changed_idx] as char;
            let mut_base = c.mutant_codon.as_bytes()[changed_idx] as char;
            let (wt_shown, mut_shown) = if reverse {
                (complement_base(wt_base), complement_base(mut_base))
            } else {
                (wt_base, mut_base)
            };
            c.mutation_label = format!(
                "{}{}{} ({}→{}, {}{}= in {}{})",
                wt_shown,
                to_construct(cds_pos),
                mut_shown,
                c.wild_type_codon,
                c.mutant_codon,
                c.amino_acid,
                c.codon_number,
                region.name,
                if reverse { ", minus strand" } else { "" }
            );
            c.cds_name = Some(region.name.clone());
            out.push(c);
        }
    }
    let mut warnings = Vec::new();
    if total > out.len() {
        warnings.push(format!(
            "Silent-mutation list capped: it shows the first {} of the {} candidates found over the whole length of {} annotated CDS.",
            format_thousands(out.len()),
            format_thousands(total),
            format_thousands(regions.len()),
        ));
    }
    SilentMutationScan { candidates: out, total_candidates: total, warnings }
}

fn complement_base(b: char) -> char {
    match b {
        'A' => 'T',
        'T' => 'A',
        'G' => 'C',
        'C' => 'G',
        other => other,
    }
}

#[cfg(test)]
mod rebase_validation {
    use super::*;

    /// The catalog's name for a Bio.Restriction enzyme: the catalog lists four of the oracle's
    /// enzymes under their product names, with the same sites and cuts.
    fn catalog_name(name: &str) -> &str {
        match name {
            "BsaI" => "BsaI-HFv2",
            "BsmBI" => "BsmBI-v2",
            "ScaI" => "ScaI-HF",
            "TaqI" => "TaqI-v2",
            other => other,
        }
    }

    /// The sample library's pUC19, the NCBI record L09137.2 (public domain), built into the
    /// library: no file is read.
    fn puc19() -> String {
        crate::sample_library_data::get_sample_library()
            .into_iter()
            .find(|d| d.accession == "L09137.2")
            .expect("the sample library holds pUC19, L09137.2")
            .sequence
            .to_ascii_uppercase()
    }

    /// Bio.Restriction's analysis of circular L09137 (Biopython 1.88, `Analysis(rb, seq,
    /// linear=False).full()`): the record's length and each enzyme's cut positions, 1-based, the
    /// first base after the top-strand cut. It is the committed oracle
    /// test-data/reference/seqtools.json, key `restriction.L09137`, written by
    /// scripts/outside-data/ref_seqtools.py, read from the reference-data folder:
    /// `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read from the repo root), else
    /// `<repo>/test-data`. When the file is absent this prints `skipped: reference data absent`
    /// and returns `None`; with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1` it fails instead.
    fn bio_restriction_on_l09137() -> Option<(usize, std::collections::BTreeMap<String, Vec<usize>>)> {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir = match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
            Some(d) if !d.is_empty() => repo.join(d),
            _ => repo.join("test-data"),
        };
        let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
        let required = match v.to_str() {
            Some("1") => true,
            Some("" | "0") => false,
            _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
        };
        let p = dir.join("reference/seqtools.json");
        let text = match std::fs::read_to_string(&p) {
            Ok(text) => text,
            Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
                assert!(!required, "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}", p.display());
                eprintln!("skipped: reference data absent ({})", p.display());
                return None;
            }
            Err(e) => panic!("{}: unreadable: {e}", p.display()),
        };
        let json: serde_json::Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
        let r = &json["restriction"]["L09137"];
        assert_eq!(r["circular"], serde_json::Value::Bool(true), "the oracle analysed L09137 as circular");
        let length = r["length"].as_u64().expect("restriction.L09137.length") as usize;
        let cuts = r["cuts"]
            .as_object()
            .expect("restriction.L09137.cuts")
            .iter()
            .map(|(name, at)| {
                let at = at.as_array().unwrap().iter().map(|v| v.as_u64().unwrap() as usize).collect();
                (name.clone(), at)
            })
            .collect();
        Some((length, cuts))
    }

    #[test]
    fn cds_aware_silent_mutations_scan_in_frame_and_map_to_construct_coordinates() {
        let orf = "ATGGGTTCTGAAGCTCTGGAACTGAAAGGTGCTCTGGATCTGAAACTGTAA";
        let junk = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
        let construct = format!("{junk}{orf}{junk}");
        let region = CodingRegion1Based {
            name: "demo".into(),
            start: junk.len() + 1,
            end: junk.len() + orf.len(),
            strand: 1,
        };
        let scan = analyze_silent_mutations_in_cds(&construct, std::slice::from_ref(&region), 50);
        let hits = scan.candidates;
        assert!(!hits.is_empty());
        // Nothing is left out of a list this long, so the scan owes no warning.
        assert_eq!((scan.total_candidates, scan.warnings.len()), (hits.len(), 0));
        for h in &hits {
            assert_eq!(
                translate_codon_standard(&h.wild_type_codon),
                translate_codon_standard(&h.mutant_codon)
            );
            assert!(h.position_bp >= region.start && h.position_bp <= region.end, "{h:?}");
            assert_eq!(h.cds_name.as_deref(), Some("demo"));
            // The wild-type codon really is at the reported codon, in frame.
            let codon_start = region.start - 1 + (h.codon_number - 1) * 3;
            assert_eq!(&construct[codon_start..codon_start + 3], h.wild_type_codon);
        }

        // Same gene on the minus strand: same candidates, mirrored coordinates. The right flank is
        // shorter than the left, so mirroring across the CDS (x -> start + end - x) and across the
        // whole construct (x -> len + 1 - x) give different answers.
        let rc_construct = format!("{junk}{}{}", reverse_complement_iupac(orf, false), "G".repeat(12));
        let rc_region = CodingRegion1Based { strand: -1, ..region.clone() };
        let rc_hits = analyze_silent_mutations_in_cds(&rc_construct, std::slice::from_ref(&rc_region), 50).candidates;
        assert_eq!(rc_hits.len(), hits.len());
        for h in &rc_hits {
            assert!(h.position_bp >= region.start && h.position_bp <= region.end, "{h:?}");
        }
        // Each minus-strand site is its forward twin mirrored across the CDS and reported by its
        // lowest coordinate: forward [a, a + len - 1] becomes [start + end - (a + len - 1), start + end - a].
        for (f, r) in hits.iter().zip(&rc_hits) {
            assert_eq!((&f.enzyme_name, f.codon_number), (&r.enzyme_name, r.codon_number));
            let last = f.position_bp + f.recognition_seq.len() - 1;
            assert_eq!(r.position_bp, region.start + region.end - last, "{f:?} / {r:?}");
        }

        // Every reported site is really in the construct where it is reported.
        assert_sites_lie_where_reported(&construct, &region, &hits);
        assert_sites_lie_where_reported(&rc_construct, &rc_region, &rc_hits);

        // Exact construct coordinates, derived by hand from the sequence and confirmed with
        // Biopython 1.88 (Bio.Restriction site strings, Bio.SeqUtils.nt_search on the mutated
        // construct, Bio.Seq.translate for silence; HindIII.search gives 42 and 67, the first base
        // after A^AGCTT). The CDS is bases 31..81 of both constructs.
        //  - Forward: bases 41..46 read AAGCTC; C46T turns codon 6 CTG (Leu) into TTG (Leu) and
        //    makes HindIII AAGCTT at 41..46. Bases 52..57 read CTGAAA; A57G turns codon 9 AAA (Lys)
        //    into AAG and makes AcuI CTGAAG at 52..57.
        //  - Minus strand: forward base x sits at 31 + 81 - x = 112 - x, complemented. HindIII's
        //    41..46 becomes 66..71 (lowest 66, change G66A); AcuI's 52..57 becomes 55..60 (lowest
        //    55, change T55C; the top strand reads CTTCAG there).
        let at = |hs: &[SilentMutationCandidate], enzyme: &str, codon: usize| -> (usize, String) {
            let h = hs
                .iter()
                .find(|h| h.enzyme_name == enzyme && h.codon_number == codon)
                .unwrap_or_else(|| panic!("no {enzyme} candidate at codon {codon}: {hs:?}"));
            (h.position_bp, h.mutation_label.clone())
        };
        assert_eq!(at(&hits, "HindIII", 6), (41, "C46T (CTG→TTG, L6= in demo)".to_string()));
        assert_eq!(at(&hits, "AcuI", 9), (52, "A57G (AAA→AAG, K9= in demo)".to_string()));
        assert_eq!(at(&rc_hits, "HindIII", 6), (66, "G66A (CTG→TTG, L6= in demo, minus strand)".to_string()));
        assert_eq!(at(&rc_hits, "AcuI", 9), (55, "T55C (AAA→AAG, K9= in demo, minus strand)".to_string()));
    }

    /// Apply each candidate's labelled substitution ("X<pos>Y", construct coordinates, top strand)
    /// and check that it creates the recognition site - read on the gene's own strand - at
    /// `position_bp..position_bp + len - 1`, where the wild type lacks it, without changing the protein.
    fn assert_sites_lie_where_reported(construct: &str, region: &CodingRegion1Based, hits: &[SilentMutationCandidate]) {
        let protein = |s: &str| -> String {
            let gene = &s[region.start - 1..region.end];
            let gene = if region.strand < 0 { reverse_complement_iupac(gene, false) } else { gene.to_string() };
            gene.as_bytes()
                .chunks(3)
                .map(|c| translate_codon_standard(std::str::from_utf8(c).unwrap()))
                .collect()
        };
        for h in hits {
            let change = h.mutation_label.split(' ').next().unwrap();
            let (wt, mt) = (&change[..1], &change[change.len() - 1..]);
            let pos: usize = change[1..change.len() - 1].parse().unwrap();
            assert_eq!(&construct[pos - 1..pos], wt, "{h:?}");
            let mut mutant = construct.to_string();
            mutant.replace_range(pos - 1..pos, mt);
            assert_eq!(protein(&mutant), protein(construct), "{h:?}");
            let site = if region.strand < 0 {
                reverse_complement_iupac(&h.recognition_seq, false)
            } else {
                h.recognition_seq.clone()
            };
            let span = h.position_bp - 1..h.position_bp - 1 + site.len();
            assert!(span.contains(&(pos - 1)), "{h:?}");
            assert_eq!(&mutant[span.clone()], site, "{h:?}");
            assert_ne!(&construct[span], site, "{h:?}");
        }
    }


    /// The default scan of a sequence over 100,000 bp uses exactly the catalog's first
    /// `CORE_CATALOG_LEN` enzymes, the count the App names to the user ("28 core enzymes"), and a
    /// shorter sequence every enzyme. Each enzyme's site is planted once, so a slice cut shorter or
    /// longer than the constant, or a slice that no longer reads it, finds a different set.
    #[test]
    fn long_sequences_are_scanned_with_the_core_catalog_its_constant_names() {
        let catalog = get_rebase_enzymes();
        assert!(catalog.len() > CORE_CATALOG_LEN, "the core is a strict part of the catalog");
        // A degenerate base is read as one concrete base it matches.
        let concrete = |rec: &str| -> String {
            rec.chars()
                .map(|b| match b.to_ascii_uppercase() {
                    'R' | 'W' | 'M' | 'D' | 'H' | 'V' | 'N' => 'A',
                    'Y' | 'B' => 'C',
                    'S' | 'K' => 'G',
                    other => other,
                })
                .collect()
        };
        let planted: String = catalog
            .iter()
            .map(|e| format!("{}TTTTTTTTTT", concrete(&e.recognition_seq)))
            .collect();
        let scanned = |len: usize| -> FxHashSet<String> {
            let seq = format!("{planted}{}", "T".repeat(len - planted.len()));
            find_restriction_cut_sites(&seq, Topology::Circular, None)
                .into_iter()
                .map(|c| c.enzyme.name)
                .collect()
        };
        let names = |enzymes: &[RestrictionEnzyme]| -> FxHashSet<String> {
            enzymes.iter().map(|e| e.name.clone()).collect()
        };
        assert_eq!(scanned(100_001), names(&catalog[..CORE_CATALOG_LEN]), "over 100,000 bp: the core enzymes, all of them and no other");
        assert_eq!(scanned(100_000), names(&catalog), "at 100,000 bp: every catalog enzyme");
    }

    /// Cut positions cross-checked against Biopython's REBASE tables (`Bio.Restriction`): every
    /// enzyme of the oracle, at the positions it lists and no others.
    #[test]
    fn puc19_cut_positions_match_rebase() {
        let s = puc19();
        let Some((length, cuts)) = bio_restriction_on_l09137() else { return };
        assert_eq!(s.len(), length, "the sample library's pUC19 is the record the oracle analysed");
        let catalog = get_rebase_enzymes();
        let at = |name: &str| -> Vec<usize> {
            let name = catalog_name(name);
            let e = catalog.iter().find(|e| e.name == name).unwrap_or_else(|| panic!("{name} is in the catalog")).clone();
            let mut v: Vec<usize> = find_restriction_cut_sites(&s, Topology::Circular, Some(&[e]))
                .iter()
                .map(|c| c.cut_top)
                .collect();
            v.sort_unstable();
            v.dedup();
            v
        };
        assert!(
            cuts.values().any(Vec::is_empty) && cuts.values().any(|v| v.len() > 1),
            "the oracle holds noncutters and multiple cutters"
        );
        for (name, want) in &cuts {
            assert_eq!(&at(name), want, "{name}: Bio.Restriction search() on circular pUC19");
        }
        // Some map viewers label a site by the last base before the cut.
        let e = catalog.iter().find(|e| e.name == "EcoRI").unwrap().clone();
        let c = &find_restriction_cut_sites(&s, Topology::Circular, Some(&[e]))[0];
        assert_eq!(
            (c.cut_top - 1, c.overhang_seq.as_str(), c.overhang_type.as_str()),
            (cuts["EcoRI"][0] - 1, "AATT", "5prime")
        );
    }

    /// Fragment sizes cross-checked against Biopython for single and multiple digests: each
    /// expected size is the distance between consecutive Bio.Restriction cut positions around the
    /// circular record, the last fragment running through the origin back to the first cut.
    #[test]
    fn puc19_digest_fragment_sizes_match_biopython() {
        let s = puc19();
        let Some((length, cuts)) = bio_restriction_on_l09137() else { return };
        assert_eq!(s.len(), length, "the sample library's pUC19 is the record the oracle analysed");
        let mut doc: SequenceDocument = serde_json::from_str(
            r#"{"id":"d","name":"d","accession":"","description":"","moleculeType":"DNA","topology":"circular","sequence":"","features":[],"primers":[],"history":[],"createdAt":"","updatedAt":"","folder":""}"#,
        )
        .unwrap();
        doc.sequence = s;
        let sizes = |enzymes: &[&str]| -> Vec<usize> {
            let names: Vec<String> = enzymes.iter().map(|x| catalog_name(x).to_string()).collect();
            let mut v: Vec<usize> = simulate_restriction_digest(&doc, &names).iter().map(|f| f.length_bp).collect();
            v.sort_unstable();
            v
        };
        let expected = |enzymes: &[&str]| -> Vec<usize> {
            let mut at: Vec<usize> = enzymes.iter().flat_map(|e| cuts[*e].iter().copied()).collect();
            at.sort_unstable();
            at.dedup();
            assert!(!at.is_empty(), "{enzymes:?} cut pUC19");
            let mut v: Vec<usize> = at.windows(2).map(|w| w[1] - w[0]).collect();
            v.push(length - at[at.len() - 1] + at[0]);
            v.sort_unstable();
            v
        };
        for enzymes in [
            &["BamHI"][..],
            &["EcoRI", "HindIII"],
            &["EcoRI", "BamHI", "HindIII", "PstI"],
            &["NdeI", "ScaI"],
            &["PvuII", "TaqI"],
        ] {
            assert_eq!(sizes(enzymes), expected(enzymes), "{enzymes:?}");
        }
    }
}
