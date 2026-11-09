// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Comprehensive integration test suite for `molbiocraft-protein`:
//! - PROSITE / Pfam conserved functional domain & motif scanner (`aho-corasick` affinity tags,
//!   TEV/HRV-3C/Thrombin/Sortase protease cleavage sites, Walker A P-loop, C2H2 Zinc Finger,
//!   EF-Hand $\text{Ca}^{2+}$ loop, Ser/Thr kinase HRD-DFG, KDEL ER retention, PTS1, NLS)
//! - von Heijne tripartite N-terminal secretory signal peptide predictor (`Sec/SPI`)
//! - 3D Structural Biophysics (`nalgebra` Radius of Gyration $R_g$, Principal Gyration Eigenvalues
//!   & Asphericity, Plaxco Relative Contact Order & $\ln k_f$, Virtual $C_\alpha$ Bond/Dihedral
//!   Angles, Coordination SASA, and Globular Domain Boundary Segmentation)
//! - Intrinsic Disorder (`Uversky FoldIndex`), Zyggregator/TANGO $\beta$-aggregation hotspots,
//!   Eisenberg amphipathic $\alpha$-helical hydrophobic moment $\mu_H$, Boman index, and
//!   `HLA-A*02:01` MHC Class I nonamer peptide anchor scoring.

use molbiocraft_formats::synthesize_folded_pdb_from_protein;
use molbiocraft_protein::{
    analyze_pdb_3d_geometry, analyze_protein_disorder_aggregation_epitopes,
    analyze_protein_sequence, predict_coiled_coils_and_transmembrane,
    predict_glimmer_microbial_genes, predict_signal_peptide_von_heijne,
    scan_protein_functional_motifs, translate_sequence,
};

#[test]
fn scans_affinity_tags_protease_sites_prosite_domains_and_secretory_signal_peptides() {
    // Engineer a multi-domain recombinant fusion protein containing:
    // 1. N-terminal Sec/SPI signal peptide: MKKTAIAIAVALAGFATVAQA^ (OmpA leader, cleaves at aa 21!)
    // 2. 6xHis tag (HHHHHH) + TEV cleavage site (ENLYFQ^G)
    // 3. Walker A P-loop NTPase (GAAGSGKT)
    // 4. Classic C2H2 Zinc Finger (CEECGKSFSQSSHLVRHQRTHTG -> C-x2-C-x3-F-x8-H-x3-H)
    // 5. EF-Hand Ca2+ loop (DKDGDGTITTKE -> D-x-D-G-D-G-T-I-T-x2-E-L)
    // 6. Bipartite NLS (KRPAATKKAGQAKKKK) + N-glycosylation sequon (NTSA) + C-terminal ER KDEL
    let engineered = concat!(
        "MKKTAIAIAVALAGFATVAQA",
        "GSHHHHHHGSENLYFQGGS",
        "IVGAAGSGKTTLLQALAG",
        "YKCPECGKSFSQSSNLQKHQRTHTGEKP",
        "FSLFDKDGDGTITTKELGTVMRSL",
        "GSKRPAATKKAGQAKKKKGS",
        "ANSTGSVLPETGGSKDEL"
    );

    let sig = predict_signal_peptide_von_heijne(engineered);
    assert!(
        sig.has_signal_peptide,
        "Expected OmpA N-terminal signal peptide detection, got {:?}",
        sig
    );
    assert_eq!(sig.cleavage_site_aa, Some(21));

    let report = scan_protein_functional_motifs(engineered);
    assert_eq!(report.sequence_length_aa, engineered.len());
    assert!(report.affinity_tags_count >= 1);
    assert!(report.protease_sites_count >= 2); // TEV + Sortase LPETG
    assert!(report.catalytic_and_binding_count >= 3); // Walker A + C2H2 + EF-Hand
    assert!(report.localization_signals_count >= 3); // Signal peptide + NLS + KDEL
    assert!(report.ptm_sites_count >= 1); // N-glycosylation ANST -> NSTG

    let accs: Vec<&str> = report.hits.iter().map(|h| h.accession.as_str()).collect();
    assert!(accs.contains(&"MBC_TAG_001"), "Missing 6xHis in {:?}", accs);
    assert!(accs.contains(&"MBC_PROT_001"), "Missing TEV in {:?}", accs);
    assert!(accs.contains(&"PS00017"), "Missing Walker A P-loop in {:?}", accs);
    assert!(accs.contains(&"PS00028"), "Missing C2H2 Zn-finger in {:?}", accs);
    assert!(accs.contains(&"PS00018"), "Missing EF-Hand in {:?}", accs);
    assert!(accs.contains(&"ELM_NLS_BI"), "Missing Bipartite NLS in {:?}", accs);
    assert!(accs.contains(&"PS00014"), "Missing C-terminal KDEL in {:?}", accs);

    // Cytoplasmic eGFP N-terminus must NOT trigger a false-positive secretory signal peptide
    let egfp_sig =
        predict_signal_peptide_von_heijne("MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTL");
    assert!(!egfp_sig.has_signal_peptide);
}

#[test]
fn pdb_3d_geometry_rg_asphericity_contact_order_torsions_and_sasa_work() {
    let egfp_seq = concat!(
        "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPT",
        "LVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTL",
        "VNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLA"
    );
    let pdb = synthesize_folded_pdb_from_protein(egfp_seq, "A", 0.0);
    let geom = analyze_pdb_3d_geometry(&pdb);

    assert_eq!(geom.residue_count, 180);
    assert_eq!(geom.chain_ids, vec!["A".to_string()]);
    assert!(geom.radius_of_gyration_angstrom > 8.0 && geom.radius_of_gyration_angstrom < 65.0);
    assert!((0.0..=1.0).contains(&geom.asphericity));
    assert!(geom.total_long_range_contacts_8a > 10);
    assert!(geom.relative_contact_order_pct > 0.5);
    assert!(geom.total_estimated_sasa_angstrom2 > 5_000.0);
    assert!(!geom.structural_domains.is_empty());
    assert_eq!(geom.residue_profiles.len(), 180);

    // Interior residues must carry valid virtual C-alpha pseudo-bond and pseudo-dihedral angles
    assert!(geom.residue_profiles[10].virtual_bond_angle_deg.is_some());
    assert!(geom.residue_profiles[10].virtual_dihedral_deg.is_some());
}

#[test]
fn disorder_foldindex_amyloid_hotspots_amphipathic_helices_and_hla_epitopes_work() {
    // Chimera combining:
    // - Highly charged disordered poly-E/K/S tail (aa 1..30)
    // - Amphipathic alpha-helix (LKELAKELAKELAKELA)
    // - Amyloidogenic beta-aggregation hotspot (VVFFIIVVY, A-beta42-like hydrophobic core)
    // - Canonical HLA-A*02:01 influenza Matrix M1(58-66) strong-binder nonamer GILGFVFTL!
    let chimera = concat!(
        "EEKKSSEEKKSSEEKKSSEEKKSSEEKKSS",
        "GSLKELAKELAKELAKELAGS",
        "GSVVFFIIVVYGS",
        "GSGILGFVFTLGS"
    );

    let rep = analyze_protein_disorder_aggregation_epitopes(chimera);
    assert_eq!(rep.sequence_length_aa, chimera.len());
    assert!(
        !rep.disordered_regions.is_empty(),
        "Expected N-terminal charged IDR segment"
    );
    assert_eq!(rep.disordered_regions[0].start_aa, 1);

    assert!(
        !rep.aggregation_hotspots.is_empty(),
        "Expected VVFFIIVVY beta-aggregation hotspot"
    );
    assert!(rep.aggregation_hotspots[0].peak_zygg_score >= 1.2);

    assert!(
        !rep.amphipathic_helices.is_empty(),
        "Expected amphipathic alpha-helix with mu_H >= 0.48, peak = {}",
        rep.peak_helical_hydrophobic_moment
    );

    assert!(
        rep.top_mhc_class1_peptides
            .iter()
            .any(|p| p.nonamer == "GILGFVFTL" && p.estimated_ic50_nm <= 60.0),
        "Expected influenza GILGFVFTL strong HLA-A*02:01 binder in {:?}",
        rep.top_mhc_class1_peptides
    );

    // Also verify giant 10,000 aa protein scans complete rapidly without overflow
    let giant = "MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPT".repeat(167);
    assert!(giant.len() >= 10_000);
    let giant_bio = analyze_protein_sequence(&giant, false, 9);
    assert_eq!(giant_bio.length_aa, giant.len());
    let giant_coils = predict_coiled_coils_and_transmembrane(&giant);
    assert_eq!(giant_coils.length_aa, giant.len());

    // Multi-table NCBI translation & Glimmer microbial gene predictor
    let mito_aa = translate_sequence("ATGTGATAA", 0, 2); // Vertebrate Mito (Table 2): TGA = Trp (W)!
    assert_eq!(mito_aa, "MW*");

    let glimmer = predict_glimmer_microbial_genes(
        &"ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCGTGCCCTGGCCCACCCTCGTGACCACCCTGACCTACGGCGTGCAGTGCTTCAGCCGCTACCCCGACCACATGAAGCAGCACGACTTCTTCAAGTCCGCCATGCCCGAAGGCTACGTCCAGGAGCGCACCATCTTCTTCAAGGACGACGGCAACTACAAGACCCGCGCCGAGGTGAAGTTCGAGGGCGACACCCTGGTGAACCGCATCGAGCTGAAGGGCATCGACTTCAAGGAGGACGGCAACATCCTGGGGCACAAGCTGGAGTACAACTACAACAGCCACAACGTCTATATCATGGCCGACAAGCAGAAGAACGGCATCAAGGTGAACTTCAAGATCCGCCACAACATCGAGGACGGCAGCGTGCAGCTCGCCGACCACTACCAGCAGAACACCCCCATCGGCGACGGCCCCGTGCTGCTGCCCGACAACCACTACCTGAGCACCCAGTCCGCCCTGAGCAAAGACCCCAACGAGAAGCGCGATCACATGGTCCTGCTGGAGTTCGTGACCGCCGCCGGGATCACTCTCGGCATGGACGAGCTGTACAAGTAA".repeat(2),
        120,
    );
    assert!(!glimmer.genes.is_empty());
}
