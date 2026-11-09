// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Curated Biological Reference Databases (`NCBI Gene`, `NCBI Nucleotide`, `NCBI Protein`,
//! `NCBI PubMed`, `NCBI Structure (PDB)`, `NCBI Taxonomy`, `UniProtKB`) and multi-keyword
//! `aho-corasick` biological search & `noodles-fasta` record constructor.

use aho_corasick::AhoCorasickBuilder;
use molbiocraft_core::{HistoryTreeNode, MoleculeType, SequenceDocument, SequenceFeature, Topology};
use serde::{Deserialize, Serialize};

use crate::flatfiles::parse_genbank_flatfile;
use crate::noodles_io::{color_for_feature_type, parse_fasta_noodles};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceDatabaseCategoryMeta {
    pub id: String,
    pub group: String,
    pub label: String,
    pub subtitle: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CuratedDatabaseRecord {
    pub id: String,
    pub category: String,
    pub accession: String,
    pub title: String,
    pub organism: String,
    pub molecule_type: MoleculeType,
    pub topology: Topology,
    pub summary: String,
    pub metadata_badge: String,
    pub feature_name: String,
    pub feature_type: String,
    pub sequence: String,
    pub target_folder: String,
}

pub fn get_reference_database_categories() -> Vec<ReferenceDatabaseCategoryMeta> {
    vec![
        ReferenceDatabaseCategoryMeta {
            id: "ncbi-gene".into(),
            group: "NCBI".into(),
            label: "NCBI Gene".into(),
            subtitle: "Curated genomic loci & HGNC/EcoGene coding regions".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "ncbi-nucleotide".into(),
            group: "NCBI".into(),
            label: "NCBI Nucleotide".into(),
            subtitle: "RefSeq & GenBank DNA/mRNA constructs".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "ncbi-protein".into(),
            group: "NCBI".into(),
            label: "NCBI Protein".into(),
            subtitle: "RefSeq polypeptide & enzyme sequences".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "ncbi-pubmed".into(),
            group: "NCBI".into(),
            label: "NCBI PubMed".into(),
            subtitle: "Seminal cloning & genome-editing literature + linked cassettes".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "ncbi-structure".into(),
            group: "NCBI".into(),
            label: "NCBI Structure (PDB)".into(),
            subtitle: "X-Ray / Cryo-EM 3D chains & target duplexes".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "ncbi-taxonomy".into(),
            group: "NCBI".into(),
            label: "NCBI Taxonomy".into(),
            subtitle: "Host genetic codes & 16S / ITS rRNA barcodes".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "uniprot".into(),
            group: "UniProt".into(),
            label: "UniProtKB".into(),
            subtitle: "Reviewed Swiss-Prot functional protein records".into(),
        },
        ReferenceDatabaseCategoryMeta {
            id: "local-blast-dbs".into(),
            group: "Local".into(),
            label: "Local BLAST Databases".into(),
            subtitle: "Add or remove local sequence databases for homology search".into(),
        },
    ]
}

pub fn get_curated_database_records() -> Vec<CuratedDatabaseRecord> {
    vec![
        CuratedDatabaseRecord {
            id: "db-gene-tp53".into(),
            category: "ncbi-gene".into(),
            accession: "GeneID:7157".into(),
            title: "TP53 — Tumor Protein p53 Core DNA-Binding Domain (Homo sapiens)".into(),
            organism: "Homo sapiens (Chr 17p13.1)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Guardian-of-the-genome tumor suppressor transcription factor core DNA-binding domain coding locus (residues 94–292).".into(),
            metadata_badge: "HGNC:11998 • 17p13.1".into(),
            feature_name: "TP53 Core DBD CDS".into(),
            feature_type: "CDS".into(),
            target_folder: "Genomes & NGS".into(),
            sequence: "TCATCTTCTGTCCCTTCCCAGAAAACCTACCAGGGCAGCTACGGTTTCCGTCTGGGCTTCTTGCATTCTGGGACAGCCAAGTCTGTGACTTGCACGTACTCCCCTGCCCTCAACAAGATGTTTTGCCAACTGGCCAAGACCTGCCCTGTGCAGCTGTGGGTTGATTCCACACCCCCGCCCGGCACCCGCGTCCGCGCCATGGCCATCTACAAGCAGTCACAGCACATGACGGAGGTTGTGAGGCGCTGCCCCCACCATGAGCGCTGCTCAGATAGCGATGGTCTGGCCCCTCCTCAGCATCTTATCCGAGTGGAAGGAAATTTGCGTGTGGAGTATTTGGATGACAGAAACACTTTTCGACATAGTGTGGTGGTGCCCTATGAGCCGCCTGAGGTTGGCTCTGACTGTACCACCATCCACTACAACTACATGTGTAACAGTTCCTGCATGGGCGGCATGAACCGGAGGCCCATCCTCACCATCATCACACTGGAAGACTCCAGTGGTAATCTACTGGGACGGAACAGCTTTGAGGTGCGTGTTTGTGCCTGTCCTGGGAGAGACCGGCGCACAGAGGAAGAGAATCTCCGCAAGAAAGGGGAGCCTCACCACGAGCTGCCCCCAGGGAGCACTAAGCGAGCACTGCCCAACAACACCAGCTCCTCTCCCCAGCCAAAGAAGAAACCACTGGATGGAGAATATTTCACCCTTCAGATCCGTGGGCGTGAGCGCTTCGAGATGTTCCGAGAGCTGAATGAGGCCTTGGAACTCAAGGATGCCCAGGCTGGGAAGGAGCCAGGGGGGAGCAGGGCTCACTCCAGCCACCTGAAGTCCAAAAAGGGTCAGTCTACCTCCCGCCATAAAAAACTCATGTTCAAGACAGAAGGGCCTGACTCAGACTGA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-gene-lacz".into(),
            category: "ncbi-gene".into(),
            accession: "GeneID:945006".into(),
            title: "lacZ — Beta-Galactosidase Alpha-Complementation Peptide (E. coli K-12)".into(),
            organism: "Escherichia coli str. K-12 substr. MG1655".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Canonical lac operon alpha-donor peptide locus used in blue/white X-Gal colony screening.".into(),
            metadata_badge: "EcoGene:EG10527 • Table 11".into(),
            feature_name: "lacZ-alpha CDS".into(),
            feature_type: "CDS".into(),
            target_folder: "Genomes & NGS".into(),
            sequence: "ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTAATCGCCTTGCAGCACATCCCCCTTTCGCCAGCTGGCGTAATAGCGAAGAGGCCCGCACCGATCGCCCTTCCCAACAGTTGCGCAGCCTGAATGGCGAATGGCGCCTGATGCGGTATTTTCTCCTTACGCATCTGTGCGGTATTTCACACCGCATATGGTGCACTCTCAGTACAATCTGCTCTGATGCCGCATAGTTAAGCCAGCCCCGACACCCGCCAACACCCGCTGACGCGCCCTGACGGGCTTGTCTGCTCCCGGCATCCGCTTACAGACAAGCTGTGACCGTCTCCGGGAGCTGCATGTGTCAGAGGTTTTCACCGTCATCACCGAAACGCGCGA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-gene-egfr".into(),
            category: "ncbi-gene".into(),
            accession: "GeneID:1956".into(),
            title: "EGFR — Epidermal Growth Factor Receptor Kinase Activation Loop".into(),
            organism: "Homo sapiens (Chr 7p11.2)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Receptor tyrosine kinase catalytic exon 18–21 region harboring L858R and exon 19 deletion hotspots.".into(),
            metadata_badge: "HGNC:3236 • Exons 18-21".into(),
            feature_name: "EGFR Tyrosine Kinase Domain".into(),
            feature_type: "CDS".into(),
            target_folder: "Genomes & NGS".into(),
            sequence: "ATGGCCAGCGTGGACAACCCCCACGTGTGCCGCCTGCTGGGCATCTGCCTCACCTCCACCGTGCAGCTCATCACGCAGCTCATGCCCTTCGGCTGCCTCCTGGACTATGTCCGGGAACACAAAGACAATATTGGCTCCCAGTACCTGCTCAACTGGTGTGTGCAGATCGCAAAGGGCATGAACTACTTGGAGGACCGTCGCTTGGTGCACCGCGACCTGGCAGCCAGGAACGTACTGGTGAAAACACCGCAGCATGTCAAGATCACAGATTTTGGGCTGGCCAAACTGCTGGGTGCGGAAGAGAAAGAATACCATGCAGAAGGAGGCAAAGTGCCTATCAAGTGGATGGCATTGGAATCAATTTTACACAGAATCTATACCCACCAGAGTGATGTCTGGAGCTACGGGGTGACCGTTTGGGAGTTGATGACCTTTGGATCCAAGCCATATGACGGAATCCCTGCCAGCGAGATCTCCTCCATCCTGGAGAAAGGAGAACGCCTCCCTCAGCCACCCATATGTACCATCGATGTCTACATGATCATGGTCAAGTGCTGGATGATAGACGCAGATAGTCGCCCAAAGTTCCGTGAGTTGATCATCGAATTCTCCAAAATGGCCCGAGACCCCCAGCGCTACCTTGTCATTCAGGGGGATGAAAGAATGCATTTGCCAAGTCCTACAGACTCCAACTTCTACCGTGCCCTGATGGATGAAGAAGACATGGACGACGTGGTGGATGCCGACGAGTACCTCATCCCACAGCAGGGCTTCTTCAGCAGCCCCTCCACGTCACGGACTCCCCTCCTGAGCTCTCTGAGTGCAACCAGCAACAATTCCACCGTGGCTTGCATTGATAGAAATGGGCTGCAAAGCTGTCCCATCAAGGAAGACAGCTTCTTGCAGCGATACAGCTCAGACCCCACAGGCGCCTTGACTGAGGACAGCATAGACGACACCTTCCTCCCAGTGCCTGAATACATAAACCAGTCCGTTCCCAAAAGGCCCGCTGGCTCTGTGCAGAATCCTGTCTATCACAATCAGCCTCTGAACCCCGCGCCCAGCAGAGACCCACACTACCAGGACCCCCACAGCACTGCAGTGGGCAACCCCGAGTATCTCAACACTGTCCAGCCCACCTGTGTCAACAGCACATTCGACAGCCCTGCCCACTGGGCCCAGAAAGGCAGCCACCAAATTAGCCTGGACAACCCTGACTACCAGCAGGACTTCTTTCCCAAGGAAGCCAAGCCAAATGGCATCTTTAAGGGCTCCACAGCTGAAAATGCAGAATACCTAAGGGTCGCGCCACAAAGCAGTGAATTTATTGGAGCATGA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-gene-brca1".into(),
            category: "ncbi-gene".into(),
            accession: "GeneID:672".into(),
            title: "BRCA1 — RING Finger E3 Ubiquitin Ligase Domain (Homo sapiens)".into(),
            organism: "Homo sapiens (Chr 17q21.31)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Homologous recombination DNA repair N-terminal C3HC4 RING finger domain interacting with BARD1.".into(),
            metadata_badge: "HGNC:1100 • Exons 2-7".into(),
            feature_name: "BRCA1 RING Finger CDS".into(),
            feature_type: "CDS".into(),
            target_folder: "Genomes & NGS".into(),
            sequence: "ATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTCATTAATGCTATGCAGAAAATCTTAGAGTGTCCCATCTGTCTGGAGTTGATCAAGGAACCTGTCTCCACAAAGTGTGACCACATATTTTGCAAATTTTGCATGCTGAAACTTCTCAACCAGAAGAAAGGGCCTTCACAGTGTCCTTTATGTAAGAATGATATAACCAAAAGGAGCCTACAAGAAAGTACGAGATTTAGTCAACTTGTTGAAGAGCTATTGAAAATCATTTGTGCTTTTCAGCTTGACACAGGTTTGGAGTATGCAAACAGCTATAATTTTGCAAAAAAGGAAAATAACTCTCCTGAACATCTAAAAGATGAAGTTTCTATCATCCAAAGTATGGGCTACAGAAACCGTGCCAAAAGACTTCTACAGAGTGAACCCGAAAATCCTTCCTTGCAGGAAACCAGTCTCAGTGTCCAACTCTCTAACCTTGGAACTGTGAGAACTCTGAGGACAAAGCAGCGGATACAACCTCAAAAGACGTCTGTCTACATTGAATTGGGATCTGATTCTTCTGAAGATACCGTTAATAAGGCAACTTATTGCAGAGTGA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-nucl-spike".into(),
            category: "ncbi-nucleotide".into(),
            accession: "NC_045512.2".into(),
            title: "SARS-CoV-2 Surface Glycoprotein S1 Receptor-Binding Domain (RBD)".into(),
            organism: "Severe acute respiratory syndrome coronavirus 2".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "RefSeq coding region for the ACE2-binding Spike S1 RBD domain.".into(),
            metadata_badge: "RefSeq • 1,353 bp".into(),
            feature_name: "Spike S1 RBD CDS".into(),
            feature_type: "CDS".into(),
            target_folder: "Cloning Inserts & PCR".into(),
            sequence: "ATGTTTGTTTTTCTTGTTTTATTGCCACTAGTCTCTAGTCAGTGTGTTAATCTTACAACCAGAACTCAATTACCCCCTGCATACACTAATTCTTTCACACGTGGTGTTTATTACCCTGACAAAGTTTTCAGATCCTCAGTTTTACATTCAACTCAGGACTTGTTCTTACCTTTCTTTTCCAATGTTACTTGGTTCCATGCTATACATGTCTCTGGGACCAATGGTACTAAGAGGTTTGATAACCCTGTCCTACCATTTAATGATGGTGTTTATTTTGCTTCCACTGAGAAGTCTAACATAATAAGAGGCTGGATTTTTGGTACTACTTTAGATTCGAAGACCCAGTCCCTACTTATTGTTAATAACGCTACTAATGTTGTTATTAAAGTCTGTGAATTTCAATTTTGTAATGATCCATTTTTGGGTGTTTATTACCACAAAAACAACAAAAGTTGGATGGAAAGTGAGTTCAGAGTTTATTCTAGTGCGAATAATTGCACTTTTGAATATGTCTCTCAGCCTTTTCTTATGGACCTTGAAGGAAAACAGGGTAATTTCAAAAATCTTAGGGAATTTGTGTTTAAGAATATTGATGGTTATTTTAAAATATATTCTAAGCACACGCCTATTAATTTAGTGCGTGATCTCCCTCAGGGTTTTTCGGCTTTAGAACCATTGGTAGATTTGCCAATAGGTATTAACATCACTAGGTTTCAAACTTTACTTGCTTTACATAGAAGTTATTTGACTCCTGGTGATTCTTCTTCAGGTTGGACAGCTGGTGCTGCAGCTTATTATGTGGGTTATCTTCAACCTAGGACTTTTCTATTAAAATATAATGAAAATGGAACCATTACAGATGCTGTAGACTGTGCACTTGACCCTCTCTCAGAAACAAAGTGTACGTTGAAATCCTTCACTGTAGAAAAAGGAATCTATCAAACTTCTAACTTTAGAGTCCAACCAACAGAATCTATTGTTAGATTTCCTAATATTACAAACTTGTGCCCTTTTGGTGAAGTTTTTAACGCCACCAGATTTGCATCTGTTTATGCTTGGAACAGGAAGAGAATCAGCAACTGTGTTGCTGATTATTCTGTCCTATATAATTCCGCATCATTTTCCACTTTTAAGTGTTATGGAGTGTCTCCTACTAAATTAAATGATCTCTGCTTTACTAATGTCTATGCAGATTCATTTGTAATTAGAGGTGATGAAGTCAGACAAATCGCTCCAGGGCAAACTGGAAAGATTGCTGATTATAATTATAAATTACCAGATGATTTTACAGGCTGCGTTATAGCTTGGAATTCTAACAATCTTGATTCTAAGGTTGGTGGTAATTATAATTACCTGTATAGATTGTTTAGGAAGTCTAATCTCAAACCTTTTGAGAGAGATATTTCAACTGAAATCTATCAGGCCGGTAGCACACCTTGTAATGGTGTTGAAGGTTTTAATTGTTACTTTCCTTTACAATCATATGGTTTCCAACCCACTAATGGTGTTGGTTACCAACCATACAGAGTAGTAGTACTTTCTTTTGAACTTCTACATGCACCAGCAACTGTTTGTGGACCTAAAAAGTCTACTAATTTGGTTAAAAACAAATGTGTCAATTTCAACTTCAATGGTTTAACAGGCACAGGTGTTCTTACTGAGTCTAACAAAAAGTTTCTGCCTTTCCAACAATTTGGCAGAGACATTGCTGACACTACTGATGCTGTCCGTGATCCACAGACACTTGAGATTGCTTGAA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-nucl-gfp-wt".into(),
            category: "ncbi-nucleotide".into(),
            accession: "U02453.1".into(),
            title: "Aequorea victoria Green Fluorescent Protein (GFP) Complete CDS".into(),
            organism: "Aequorea victoria (Crystal Jellyfish)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Complete GenBank nucleotide coding sequence for fluorescent beta-barrel reporter protein.".into(),
            metadata_badge: "GenBank • 720 bp".into(),
            feature_name: "Aequorea GFP CDS".into(),
            feature_type: "CDS".into(),
            target_folder: "Cloning Inserts & PCR".into(),
            sequence: "ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-nucl-spcas9".into(),
            category: "ncbi-nucleotide".into(),
            accession: "NC_002737.2_cas9".into(),
            title: "Streptococcus pyogenes Cas9 Endonuclease Catalytic Core CDS".into(),
            organism: "Streptococcus pyogenes serotype M1".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "RNA-guided DNA endonuclease Cas9 RuvC/HNH catalytic coding sequence for genome editing constructs.".into(),
            metadata_badge: "RefSeq • 2,340 bp".into(),
            feature_name: "SpCas9 Catalytic Core".into(),
            feature_type: "CDS".into(),
            target_folder: "Cloning Inserts & PCR".into(),
            sequence: "ATGGACAAGAAGTACTCCATTGGGCTCGATATCGGCACAAACAGCGTCGGCTGGGCCGTCATTACGGACGAGTACAAGGTGCCGAGCAAAAAATTCAAAGTTCTGGGCAATACCGATCGCCACAGCATAAAGAAGAACCTCATTGGCGCCCTCCTGTTCGACTCCGGGGAGACGGCCGAAGCCACGCGGCTCAAAAGAACAGCACGGCGCAGATATACCCGCAGAAAGAATCGGATCTGCTACCTGCAGGAGATCTTTAGTAATGAGATGGCTAAGGTGGATGACTCTTTCTTCCATAGGCTGGAGGAGTCCTTTTTGGTGGAGGAGGATAAAAAGCACGAGCGCCACCCAATCTTTGGCAATATCGTGGACGAGGTGGCGTACCATGAAAAGTACCCAACCATATATCATCTGAGGAAGAAGCTTGTAGACAGTACTGATAAGGCTGACTTGCGGTTGATCTATCTCGCGCTGGCGCATATGATCAAATTTCGGGGACACTTCCTCATCGAGGGGGACCTGAACCCAGACAACAGCGATGTCGACAAACTCTTTATCCAACTGGTTCAGACTTACAATCAGCTTTTCGAAGAGAACCCGATCAACGCATCCGGAGTTGACGCCAAAGCAATCCTGAGCGCTAGGCTGTCCAAATCCCGGCGGCTCGAAAACCTCATCGCACAGCTCCCTGGGGAGAAGAAGAACGGCCTGTTTGGTAATCTTATCGCCCTGTCACTCGGGCTGACCCCCAACTTTAAATCTAACTTCGACCTGGCCGAAGATGCCAAGCTTCAACTGAGCAAAGACACCTACGATGATGATCTCGACAATCTGCTGGCCCAGATCGGCGACCAGTACGCAGACCTTTTTTTGGCGGCAAAGAACCTGTCAGACGCCATTCTGCTGAGTGATATTCTGCGAGTGAACACGGAGATCACCAAAGCTCCGCTGAGCGCTAGTATGATCAAGCGCTATGATGAGCACCACCAAGACTTGACTTTGCTGAAGGCCCTTGTCAGACAGCAACTGCCTGAGAAGTACAAGGAAATTTTCTTCGATCAGTCTAAAAATGGCTACGCCGGATACATTGACGGCGGAGCAAGCCAGGAGGAATTTTACAAATTTATTAAGCCCATCTTGGAAAAAATGGACGGCACCGAGGAGCTGCTGGTAAAGCTTAACAGAGAAGATCTGTTGCGCAAACAGCGCACTTTCGACAATGGAAGCATCCCCCACCAGATTCACCTGGGCGAACTGCACGCTATCCTCAGGCGGCAAGAGGATTTCTACCCCTTTTTGAAAGATAACAGGGAAAAGATTGAGAAAATCCTCACATTTCGGATACCCTACTATGTAGGCCCCCTCGCCCGGGGAAATTCCAGATTCGCGTGGATGACTCGCAAATCAGAAGAGACCATCACTCCCTGGAACTTCGAGGAAGTCGTGGATAAGGGGGCCTCTGCCCAGTCCTTCATCGAAAGGATGACTAACTTTGATAAAAATCTGCCTAACGAAAAGGTGCTTCCTAAACACTCTCTGCTGTACGAGTACTTCACAGTTTATAACGAGCTCACCAAGGTCAAATACGTCACAGAAGGGATGAGAAAGCCAGCATTCCTGTCTGGAGAGCAGAAGAAAGCTATCGTGGACCTCCTCTTCAAGACGAACCGGAAAGTTACCGTGAAACAGCTCAAAGAAGACTATTTCAAAAAGATTGAGTGTTTCGACTCTGTTGAAATCAGCGGAGTGGAGGATCGCTTCAACGCATCCCTGGGAACGTATCACGATCTCCTGAAAATCATTAAAGACAAGGACTTCCTGGACAATGAGGAGAACGAGGACATTCTTGAGGACATTGTCCTCACCCTTACGTTGTTTGAAGATAGGGAGATGATTGAAGAACGCTTGAAAACTTACGCTCATCTCTTCGACGACAAAGTCATGAAACAGCTCAAGAGGCGCCGATATACAGGATGGGGGCGGCTGTCAAGAAAACTGATCAATGGGATCCGAGACAAGCAGAGTGGAAAGACAATCCTGGATTTTCTTAAGTCCGATGGATTTGCCAACCGGAACTTCATGCAGTTGATCCATGATGACTCTCTCACCTTTAAGGAGGACATCCAGAAAGCACAAGTTTCTGGCCAGGGGGACAGTCTTCACGAGCACATCGCTAATCTTGCAGGTAGCCCAGCTATCAAAAAGGGAATACTGCAGACCGTTAAGGTCGTGGATGAACTCGTCAAAGTAATGGGAAGGCATAAGCCCGAGAATATCGTTATCGAGATGGCCCGAGAGAACCAAACTACCCAGAAGGGACAGAAGAACAGTAGGGAAAGGATGAAGAGGATTGAAGAGGGTATAAAAGAACTGGGGTCCCAAATCCTTAAGGAACACCCAGTTGAAAACACCCAGCTTCAGAATGAGAAGCTCTACCTGTACTACCTGCAGAACGGCAGGGACATGTACGTGGATCAGGAACTGGACATCAATCGGCTCTCCGACTACGACGTGGATCATATCGTGCCCCAGTCTTTTCTGA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-prot-p53".into(),
            category: "ncbi-protein".into(),
            accession: "NP_000537.3".into(),
            title: "Cellular Tumor Antigen p53 Isoform a [Homo sapiens]".into(),
            organism: "Homo sapiens".into(),
            molecule_type: MoleculeType::Protein,
            topology: Topology::Linear,
            summary: "Full-length 393 aa human p53 polypeptide containing transactivation, proline-rich, DNA-binding, and tetramerization domains.".into(),
            metadata_badge: "RefSeq Protein • 393 aa".into(),
            feature_name: "p53 Polypeptide".into(),
            feature_type: "CDS".into(),
            target_folder: "Protein Documents".into(),
            sequence: "MEEPQSDPSVEPPLSQETFSDLWKLLPENNVLSPLPSQAMDDLMLSPDDIEQWFTEDPGPDEAPRMPEAAPPVAPAPAAPTPAAPAPAPSWPLSSSVPSQKTYQGSYGFRLGFLHSGTAKSVTCTYSPALNKMFCQLAKTCPVQLWVDSTPPPGTRVRAMAIYKQSQHMTEVVRRCPHHERCSDSDGLAPPQHLIRVEGNLRVEYLDDRNTFRHSVVVPYEPPEVGSDCTTIHYNYMCNSSCMGGMNRRPILTIITLEDSSGNLLGRNSFEVRVCACPGRDRRTEEENLRKKGEPHHELPPGSTKRALPNNTSSSPQPKKKPLDGEYFTLQIRGRERFEMFRELNEALELKDAQAGKEPGGSRAHSSHLKSKKGQSTSRHKKLMFKTEGPDSD".into(),
        },
        CuratedDatabaseRecord {
            id: "db-prot-taq".into(),
            category: "ncbi-protein".into(),
            accession: "WP_011228479.1".into(),
            title: "Thermostable DNA Polymerase I (Taq) Catalytic Domain [Thermus aquaticus]".into(),
            organism: "Thermus aquaticus YT-1".into(),
            molecule_type: MoleculeType::Protein,
            topology: Topology::Linear,
            summary: "Thermostable Family A DNA polymerase palm/fingers/thumb catalytic core for PCR amplification.".into(),
            metadata_badge: "RefSeq Protein • 296 aa".into(),
            feature_name: "Taq Polymerase Core".into(),
            feature_type: "CDS".into(),
            target_folder: "Protein Documents".into(),
            sequence: "MRGMLPLFEPKGRVLLVDGHHLAYRTFHALKGLTTSRGEPVQAVYGFAKSLLKALKEDGDAVIVVFDAKAPSFRHEAYGGYKAGRAPTPEDFPRQLALIKELVDLLGLARLEVPGYEADDVLASLAKKAEKEGYEVRILTADKDLYQLLSDRIHVLHPEGYLITPAWLWEKYGLRPDQWADYRALTGDESDNLPGVKGIGEKTARKLLEEWGSLEALLKNLDRLKPAIREKILAHMDDLKLSWDLAKVRTDLPLEVDFAKRREPDRERLRAFLERLEFGSLLHEFGLLESPKALEEAPW".into(),
        },
        CuratedDatabaseRecord {
            id: "db-pubmed-gibson2009".into(),
            category: "ncbi-pubmed".into(),
            accession: "PMID:19363495".into(),
            title: "Enzymatic assembly of DNA molecules up to several hundred kilobases (Gibson et al., Nat Methods 2009)".into(),
            organism: "Synthetic / Isothermal 50°C Assembly Cassette".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "DOI: 10.1038/nmeth.1318 — Seminal one-step isothermal T5 exonuclease + Phusion polymerase + Taq DNA ligase overlap assembly reference cassette (40 bp homology arms).".into(),
            metadata_badge: "Nat Methods 2009 • Linked Cassette".into(),
            feature_name: "40-bp Gibson Overlap Test Cassette".into(),
            feature_type: "misc_feature".into(),
            target_folder: "Cloning Inserts & PCR".into(),
            sequence: "TTTAAGAAGGAGATATACCATGGGCAGCAGCCATCATCATATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTAACTCGAGCACCACCACCACCACCACTGAGATCCGGCTGCTAA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-pubmed-jinek2012".into(),
            category: "ncbi-pubmed".into(),
            accession: "PMID:22745249".into(),
            title: "A programmable dual-RNA-guided DNA endonuclease in adaptive bacterial immunity (Jinek et al., Science 2012)".into(),
            organism: "Streptococcus pyogenes sgRNA Scaffold".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "DOI: 10.1126/science.1225829 — Chimeric crRNA:tracrRNA single-guide RNA (sgRNA) expression cassette driven by U6 promoter with SpCas9 handle.".into(),
            metadata_badge: "Science 2012 • Linked sgRNA Scaffold".into(),
            feature_name: "Chimeric SpCas9 sgRNA Scaffold".into(),
            feature_type: "misc_feature".into(),
            target_folder: "Primers & Guides".into(),
            sequence: "GAGGGCCTATTTCCCATGATTCCTTCATATTTGCATATACGATACAAGGCTGTTAGAGAGATAATTGGAATTAATTTGACTGTAAACACAAAGATATTAGTACAAAATACGTGACGTAGAAAGTAATAATTTCTTGGGTAGTTTGCAGTTTTAAAATTATGTTTTAAAATGGACTATCATATGCTTACCGTAACTTGAAAGTATTTCGATTTCTTGGCTTTATATATCTTGTGGAAAGGACGAAACACCGGGTCTTCGAGAAGACCTGTTTTAGAGCTAGAAATAGCAAGTTAAAATAAGGCTAGTCCGTTATCAACTTGAAAAAGTGGCACCGAGTCGGTGCTTTTTT".into(),
        },
        CuratedDatabaseRecord {
            id: "db-pubmed-engler2008".into(),
            category: "ncbi-pubmed".into(),
            accession: "PMID:18989472".into(),
            title: "A one pot, one step, precision cloning method with high throughput capability (Engler et al., PLoS One 2008)".into(),
            organism: "Modular Type IIS Golden Gate Entry Cassette".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "DOI: 10.1371/journal.pone.0003647 — Golden Gate Type IIS BsaI outward-facing cleavage design eliminating recognition scars in the final ligated product.".into(),
            metadata_badge: "PLoS One 2008 • Type IIS BsaI Cassette".into(),
            feature_name: "Golden Gate BsaI Entry Part".into(),
            feature_type: "misc_feature".into(),
            target_folder: "Cloning Inserts & PCR".into(),
            sequence: "GGTCTCTAATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTAAGCTTTGAGACC".into(),
        },
        CuratedDatabaseRecord {
            id: "db-struct-1ema".into(),
            category: "ncbi-structure".into(),
            accession: "PDB:1EMA".into(),
            title: "Crystal Structure of Green Fluorescent Protein (1.9 Å X-Ray, Ormö et al.)".into(),
            organism: "Aequorea victoria (Chain A, 236 aa)".into(),
            molecule_type: MoleculeType::Protein,
            topology: Topology::Linear,
            summary: "11-stranded beta-barrel surrounding central alpha-helix bearing the p-hydroxybenzylideneimidazolinone Ser65-Tyr66-Gly67 chromophore.".into(),
            metadata_badge: "X-Ray 1.90 Å • Chain A".into(),
            feature_name: "1EMA Chain A Beta-Barrel".into(),
            feature_type: "CDS".into(),
            target_folder: "Protein Documents".into(),
            sequence: "MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKRHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK".into(),
        },
        CuratedDatabaseRecord {
            id: "db-struct-4oo8".into(),
            category: "ncbi-structure".into(),
            accession: "PDB:4OO8".into(),
            title: "Crystal Structure of SpCas9 Bound to sgRNA and Target DNA (Nishimasu et al.)".into(),
            organism: "Streptococcus pyogenes (Target DNA + PAM Duplex)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "2.5 Å ternary complex target protospacer DNA strand with 5'-TGG-3' NGG PAM recognition motif.".into(),
            metadata_badge: "X-Ray 2.50 Å • Target Duplex".into(),
            feature_name: "4OO8 Target Protospacer + TGG PAM".into(),
            feature_type: "misc_feature".into(),
            target_folder: "Primers & Guides".into(),
            sequence: "CAATACCATAAATTAAAAACCTAAATATTGGGGGCG".into(),
        },
        CuratedDatabaseRecord {
            id: "db-tax-ecoli".into(),
            category: "ncbi-taxonomy".into(),
            accession: "TaxID:83333".into(),
            title: "Escherichia coli K-12 (Bacteria; Pseudomonadota; Gammaproteobacteria)".into(),
            organism: "Escherichia coli K-12 (Genetic Code Table 11)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Primary bacterial molecular cloning host (DH5α, TOP10, BL21(DE3)). Imports 16S rRNA V3-V4 taxonomic barcode reference locus.".into(),
            metadata_badge: "Table 11 • 16S rRNA Barcode".into(),
            feature_name: "E. coli 16S rRNA V3-V4 Reference".into(),
            feature_type: "misc_feature".into(),
            target_folder: "Genomes & NGS".into(),
            sequence: "CCTACGGGAGGCAGCAGTGGGGAATATTGCACAATGGGCGCAAGCCTGATGCAGCCATGCCGCGTGTATGAAGAAGGCCTTCGGGTTGTAAAGTACTTTCAGCGGGGAGGAAGGGAGTAAAGTTAATACCTTTGCTCATTGACGTTACCCGCAGAAGAAGCACCGGCTAACTCCGTGCCAGCAGCCGCGGTAATACGGAGGGTGCAAGCGTTAATCGGAATTACTGGGCGTAAAGCGCACGCAGGCGGTTTGTTAAGTCAGATGTGAAATCCCCGGGCTCAACCTGGGAACTGCATCTGATACTGGCAAGCTTGAGTCTCGTAGAGGGGGGTAGAATTCCAGGTGTAGCGGTGAAATGCGTAGAGATCTGGAGGAATACCGGTGGCGAAGGCGGCCCCCTGGACGAAGACTGACGCTCAGGTGCGAAAGCGTGGGGAGCAAACAGGATTAGATACCCTGGTAGTCCACGCCGTAAACGATGTCGACTTGGAGGTTGTGCCCTTGAGGCGTGGCTTCCGGAGCTAACGCGTTAAGTCGACCGCCTGGGGAGTACGGCCGCAAGGTTAAAACTCAAATGAATTGACGGGGGCCCGCACAAGCGGTGGAGCATGTGGTTTAATTCGATGCAACGCGAAGAACCTTACCTGGTCTTGACATCCACGGAAGTTTTCAGAGATGAGAATGTGCCTTCGGGAACCGTGAGACAGGTGCTGCATGGCTGTCGTCAGCTCGTGTTGTGAAATGTTGGGTTAAGTCCCGCAACGAGCGCAACCCTTATCCTTTGTTGCCAGCGGTCCGGCCGGGAACTCAAAGGAGACTGCCAGTGATAAACTGGAGGAAGGTGGGGATGACGTCAAGTCATCATGGCCCTTACGACCAGGGCTACACACGTGCTACAATGGCGCATACAAAGAGAAGCGACCTCGCGAGAGCAAGCGGACCTCATAAAGTGCGTCGTAGTCCGGATTGGAGTCTGCAACTCGACTCCATGAAGTCGGAATCGCTAGTAATCGTGGATCAGAATGCCACGGTGAATACGTTCCCGGGCCTTGTACACACCGCCCGTCACACCATGGGAGTGGGTTGCAAAAGAAGTAGGTAGCTTAACCTTCGGGAGGGCGCTTACCACTTTGTGATTCATGACTGGGGTGAAGTCGTAACAAGGTAACCGTAGGGGAACCTGCGGTTGGATCACCTCCTTA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-tax-scerevisiae".into(),
            category: "ncbi-taxonomy".into(),
            accession: "TaxID:559292".into(),
            title: "Saccharomyces cerevisiae S288C (Eukaryota; Fungi; Ascomycota)".into(),
            organism: "Saccharomyces cerevisiae S288C (Genetic Code Table 1)".into(),
            molecule_type: MoleculeType::DNA,
            topology: Topology::Linear,
            summary: "Model eukaryotic budding yeast host (BY4741, W303). Imports fungal ITS1-5.8S-ITS2 rDNA taxonomic reference barcode.".into(),
            metadata_badge: "Table 1 • Fungal ITS Barcode".into(),
            feature_name: "S. cerevisiae ITS1-5.8S-ITS2 Barcode".into(),
            feature_type: "misc_feature".into(),
            target_folder: "Genomes & NGS".into(),
            sequence: "TCCGTAGGTGAACCTGCGGAAAGGATCATTAAAGAAATTTAATAATTTTGAAAATGGATTTTTTTGTTTTGGCAAGAGCATGAGAGCTTTTACTGGGCAAGAAGACAAGAGATGGAGAGTCCAGCCGGGCCTGCGCTTAAGTGCGCGGTCTTGCTAGGCTTGTAAGTTTCTTTCTTGCTATTCCAAACGGTGAGAGATTTCTGTGCTTTTGTTATAGGACAATTAAAACCGTTTCAATACAACACACTGTGGAGTTTTCATATCTTTGCAACTTTTTCTTTGGGCATTCGAGCAATCGGGGCCCAGAGGTAACAAACACAAACAATTTTATTTATTCATTAAATTTTTGTCAAAAACAAGAATTTTCGTAACTGGAAATTTTAAAATATTAAAAACTTTCAACAACGGATCTCTTGGTTCTCGCATCGATGAAGAACGCAGCGAAATGCGATACGTAATGTGAATTGCAGAATTCCGTGAATCATCGAATCTTTGAACGCACATTGCGCCCCTTGGTATTCCAGGGGGCATGCCTGTTTGAGCGTCATTTCCTTCTCAAACATTCTGTTTGGTAGTGAGTGATACTCTTTGGAGTTAACTTGAAATTGCTGGCCTTTTCATTGGATGTTTTTTTTCCAAAGAGAGGTTTCTCTGCGTGCTTGAGGTATAATGCAAGTACGGTCGTTTTAGGTTTTACCAACTGCGGCTAATCTTTTTTATACTGAGCGTATTGGAACGTTATCGATAAGAAGAGAGCGTCTAGGCGAACAATGTTCTTAAAGTTTGACCTCAAATCAGGTAGGAGTACCCGCTGAACTTAAGCATATCAATAAGCGGAGGAAAAGAAACCAACCGGGATTGCCTTAGTAACGGCGAGTGAAGCGGCAAAAGCTCAAATTTGAAATCTGGTACCTTCGGTGCCCGAGTTGTAATTTGGAGAGGGCAACTTTGGGGCCGTTCCTTGTCTATGTTCCTTGGAACAGGACGTCATAGAGGGTGAGAATCCCGTGTGGCGAGGAGTGCGGTTCTTTGTAAAGTGCCTTCGAAGAGTCGAGTTGTTTGGGAATGCAGCTCTAAGTGGGTGGTAAATTCCATCTAAAGCTAAATATTGGCGAGAGACCGATAGCGAACAAGTACAGTGATGGAAAGATGAAAAGAACTTTGAAAAGAGAGTGAAAAAGTACGTGAAATTGTTGAAAGGGAAGGGCATTTGATCAGACATGGTGTTTTGTGCCCTCTGCTCCTTGTGGGTAGGGGAATCTCGCATTTCACTGGGCCAGCATCAGTTTTGGTGGCAGGATAAATCCATAGGAATGTAGCTTGCCTCGGTAAGTATTATAGCCTGTGGGAATACTGCCAGCTGGGACTGAGGACTGCGACGTAAGTCAAGGATGCTGGCATAATGGTTATATGCCGCCCGTCTTGAAACACGGACCAAGGAGTCTAACGTCTATGCGAGTGTTTGGGTGTAAAACCCATACGCGTAATGAAAGTGAACGTAGGTGAA".into(),
        },
        CuratedDatabaseRecord {
            id: "db-uniprot-gfp".into(),
            category: "uniprot".into(),
            accession: "P42212".into(),
            title: "GFP_AEQVI — Green Fluorescent Protein (Reviewed Swiss-Prot)".into(),
            organism: "Aequorea victoria".into(),
            molecule_type: MoleculeType::Protein,
            topology: Topology::Linear,
            summary: "UniProtKB/Swiss-Prot reviewed entry P42212 (238 aa). Energy-transfer acceptor producing 509 nm green fluorescence.".into(),
            metadata_badge: "Swiss-Prot ★ • 238 aa".into(),
            feature_name: "UniProt P42212 GFP_AEQVI".into(),
            feature_type: "CDS".into(),
            target_folder: "Protein Documents".into(),
            sequence: "MSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTFSYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITHGMDELYK".into(),
        },
        CuratedDatabaseRecord {
            id: "db-uniprot-cas9".into(),
            category: "uniprot".into(),
            accession: "Q99ZW2".into(),
            title: "CAS9_STRP1 — CRISPR-associated Endonuclease Cas9/Csn1 (Reviewed Swiss-Prot)".into(),
            organism: "Streptococcus pyogenes serotype M1".into(),
            molecule_type: MoleculeType::Protein,
            topology: Topology::Linear,
            summary: "UniProtKB/Swiss-Prot reviewed entry Q99ZW2 N-terminal RuvC-I, Bridge Helix, REC lobe, and HNH nuclease domains.".into(),
            metadata_badge: "Swiss-Prot ★ • Catalytic Core".into(),
            feature_name: "UniProt Q99ZW2 CAS9_STRP1".into(),
            feature_type: "CDS".into(),
            target_folder: "Protein Documents".into(),
            sequence: "MDKKYSIGLDIGTNSVGWAVITDEYKVPSKKFKVLGNTDRHSIKKNLIGALLFDSGETAEATRLKRTARRRYTRRKNRICYLQEIFSNEMAKVDDSFFHRLEESFLVEEDKKHERHPIFGNIVDEVAYHEKYPTIYHLRKKLVDSTDKADLRLIYLALAHMIKFRGHFLIEGDLNPDNSDVDKLFIQLVQTYNQLFEENPINASGVDAKAILSARLSKSRRLENLIAQLPGEKKNGLFGNLIALSLGLTPNFKSNFDLAEDAKLQLSKDTYDDDLDNLLAQIGDQYADLFLAAKNLSDAILLSDILRVNTEITKAPLSASMIKRYDEHHQDLTLLKALVRQQLPEKYKEIFFDQSKNGYAGYIDGGASQEEFYKFIKPILEKMDGTEELLVKLNREDLLRKQRTFDNGSIPHQIHLGELHAILRRQEDFYPFLKDNREKIEKILTFRIPYYVGPLARGNSRFAWMTRKSEETITPWNFEEVVDKGASAQSFIERMTNFDKNLPNEKVLPKHSLLYEYFTVYNELTKVKYVTEGMRKPAFLSGEQKKAIVDLLFKTNRKVTVKQLKEDYFKKIECFDSVEISGVEDRFNASLGTYHDLLKIIKDKDFLDNEENEDILEDIVLTLTLFEDREMIEERLKTYAHLFDDKVMKQLKRRRYTGWGRLSRKLINGIRDKQSGKTILDFLKSDGFANRNFMQLIHDDSLTFKEDIQKAQVSGQGDSLHEHIANLAGSPAIKKGILQTVKVVDELVKVMGRHKPENIVIEMARENQTTQKGQKNSRERMKRIEEGIKELGSQILKEHPVENTQLQNEKLYLYYLQNGRDMYVDQELDINRLSDYDVDHIVPQSFL".into(),
        },
        CuratedDatabaseRecord {
            id: "db-uniprot-bla".into(),
            category: "uniprot".into(),
            accession: "P62593".into(),
            title: "BLAT_ECOLX — Beta-Lactamase TEM-1 (Reviewed Swiss-Prot)".into(),
            organism: "Escherichia coli (Transposon Tn3)".into(),
            molecule_type: MoleculeType::Protein,
            topology: Topology::Linear,
            summary: "UniProtKB/Swiss-Prot reviewed entry P62593 (286 aa, signal peptide 1..23, mature enzyme 24..286). Hydrolyzes beta-lactam antibiotics.".into(),
            metadata_badge: "Swiss-Prot ★ • 286 aa".into(),
            feature_name: "UniProt P62593 TEM-1 Beta-Lactamase".into(),
            feature_type: "CDS".into(),
            target_folder: "Protein Documents".into(),
            sequence: "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLGARVGYIELDLNSGKILESFRPEERFPMMSTFKVLLCGAVLSRVDAGQEQLGRRIHYSQNDLVEYSPVTEKHLTDGMTVRELCSAAITMSDNTAANLLLTTIGGPKELTAFLHNMGDHVTRLDRWEPELNEAIPNDERDTTMPAAMATTLRKLLTGELLTLASRQQLIDWMEADKVAGPLLRSALPAGWFIADKSGAGERGSRGIIAALGPDGKPSRIVVIYTTGSQATMDERNRQIAEIGASLIKHW".into(),
        },
    ]
}

/// Multi-keyword case-insensitive `aho-corasick` biological query across curated reference databases.
pub fn query_curated_database_records(
    category: &str,
    query: &str,
) -> Vec<CuratedDatabaseRecord> {
    if category == "local-blast-dbs" {
        return Vec::new();
    }
    let records = get_curated_database_records();
    let tokens: Vec<&str> = query
        .split_whitespace()
        .map(str::trim)
        .filter(|t| !t.is_empty())
        .collect();

    if tokens.is_empty() {
        return records
            .into_iter()
            .filter(|r| category.is_empty() || r.category == category)
            .collect();
    }

    let ac = match AhoCorasickBuilder::new()
        .ascii_case_insensitive(true)
        .build(&tokens)
    {
        Ok(automaton) => automaton,
        Err(_) => return Vec::new(),
    };

    let n_tokens = tokens.len();
    records
        .into_iter()
        .filter(|rec| {
            if !category.is_empty() && rec.category != category {
                return false;
            }
            let haystack = format!(
                "{} | {} | {} | {} | {}",
                rec.accession, rec.title, rec.organism, rec.metadata_badge, rec.summary
            );
            let mut matched_mask = vec![false; n_tokens];
            // Overlapping search: a non-overlapping scan reports one term per span of text, so where
            // one term lies inside another (`cas` in `cas9`) only one of the two is reported, and a
            // repeated term only once, and the AND below would drop the record.
            for mat in ac.find_overlapping_iter(&haystack) {
                matched_mask[mat.pattern().as_usize()] = true;
            }
            matched_mask.into_iter().all(|b| b)
        })
        .collect()
}

/// Materializes a curated reference database record into a full `SequenceDocument` ready for workbench import.
pub fn build_curated_database_document(
    record_id: &str,
    timestamp_iso: &str,
) -> Option<SequenceDocument> {
    let rec = get_curated_database_records()
        .into_iter()
        .find(|r| r.id == record_id || r.accession.eq_ignore_ascii_case(record_id))?;

    let head = rec.title.split('—').next().unwrap_or(&rec.title).trim();
    let sanitized: String = head
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '_'
            }
        })
        .collect();
    let safe_name = format!(
        "{}_{}",
        sanitized.trim_matches('_'),
        rec.accession.replace(':', "_")
    );
    let len = rec.sequence.len();
    let now = if timestamp_iso.is_empty() {
        "2026-10-31T00:00:00Z".to_string()
    } else {
        timestamp_iso.to_string()
    };

    let mut meta = std::collections::HashMap::new();
    meta.insert(
        "Organism".to_string(),
        serde_json::Value::String(rec.organism.clone()),
    );
    meta.insert(
        "Database Category".to_string(),
        serde_json::Value::String(rec.category.clone()),
    );

    Some(SequenceDocument {
        id: format!("doc-db-{}-{}", rec.id, len),
        name: safe_name,
        accession: rec.accession.clone(),
        description: format!("{} — {}", rec.title, rec.summary),
        molecule_type: rec.molecule_type,
        topology: rec.topology,
        folder: rec.target_folder.clone(),
        sequence: rec.sequence,
        features: vec![SequenceFeature {
            id: format!("feat-db-{}", rec.id),
            name: rec.feature_name,
            feature_type: rec.feature_type.clone(),
            start: 1,
            end: len.max(1),
            strand: 1,
            color: color_for_feature_type(&rec.feature_type).to_string(),
            notes: Some(format!("Imported from {} ({})", rec.category, rec.accession)),
            qualifiers: None,
            segments: None,
            cleavage_site: None,
        }],
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: format!("hist-db-{}", rec.id),
            timestamp: now.clone(),
            operation: format!("Imported Reference Record ({})", rec.accession),
            description: format!("{} ({})", rec.title, rec.organism),
            parent_ids: Vec::new(),
            length_bp: len,
            topology: rec.topology,
            history_color: Some("#0284c7".into()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: Some(
            if rec.molecule_type == MoleculeType::Protein {
                "protein".to_string()
            } else if rec.topology == Topology::Circular {
                "circular-dna".to_string()
            } else {
                "linear-dna".to_string()
            },
        ),
        doc_metadata: Some(meta),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// Parses an external NCBI Entrez / UniProt FASTA or GenBank payload via `noodles-fasta` / flatfile parser.
pub fn parse_remote_database_payload(
    raw_text: &str,
    accession: &str,
    is_protein_hint: bool,
    target_folder: &str,
) -> Vec<SequenceDocument> {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut docs = if trimmed.starts_with("LOCUS") {
        vec![parse_genbank_flatfile(trimmed, accession)]
    } else {
        parse_fasta_noodles(trimmed, accession)
    };
    for d in &mut docs {
        if is_protein_hint {
            d.molecule_type = MoleculeType::Protein;
        }
        if !target_folder.is_empty() {
            d.folder = target_folder.to_string();
        }
        if d.accession.is_empty() || d.accession == "UNKNOWN" {
            d.accession = accession.to_string();
        }
    }
    docs
}
