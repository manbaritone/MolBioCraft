// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M7Q9E4: the co-transformation check resolves the E. coli replicon, not the yeast element.
//!
//! `tests/vector_architect_audits.rs::cotransformation_flags_shared_origin_group` keeps to plain
//! `pUC` and `p15A` origins, so it never reaches the shuttle vectors whose origin string names a
//! yeast element as well (`pUC + CEN6/ARS4`, `pUC + Yeast 2μ`) or the ΦX174 standard that fell to
//! the resolver's fallback label. Those are pinned here, together with the pairs that must stay
//! compatible (p15A + pUC, pSC101 + pUC) so a fix cannot buy the shuttle cases by collapsing
//! genuinely different incompatibility groups into one.

use molbiocraft_cloning::systems_strains_data::get_origin_compatibility_groups;
use molbiocraft_cloning::{
    check_cotransformation_compatibility, get_vector_catalog, CatalogVectorEntry,
};

/// The label `resolve_origin_group` fell back to before BG-01M7Q9E4; it is in no group table.
const FALLBACK_LABEL: &str = "IncG / ColE1 (pMB1/pUC/pBR322)";

fn catalog_entry(id: &str) -> CatalogVectorEntry {
    get_vector_catalog()
        .into_iter()
        .find(|v| v.id == id)
        .unwrap_or_else(|| panic!("the catalogue holds {id}"))
}

fn with_marker(mut entry: CatalogVectorEntry, marker: &str) -> CatalogVectorEntry {
    entry.bacterial_marker = marker.to_string();
    entry
}

fn with_origin(mut entry: CatalogVectorEntry, origin: &str) -> CatalogVectorEntry {
    entry.origin = origin.to_string();
    entry
}

/// The compatibility table's own group code for a replicon the table lists.
fn table_code(origin: &str) -> String {
    get_origin_compatibility_groups()
        .into_iter()
        .find(|g| g.origins.iter().any(|o| o.eq_ignore_ascii_case(origin)))
        .unwrap_or_else(|| panic!("the table holds the {origin} group"))
        .group_code
}

/// The replication-control group the check resolves for one vector.
fn group_of(entry: &CatalogVectorEntry) -> String {
    check_cotransformation_compatibility(entry, entry).group_a
}

#[test]
fn shuttle_vectors_share_the_puc_group() {
    let shuttle_cen = catalog_entry("cs-prs415");
    let shuttle_2mu = catalog_entry("cs-pyes2");
    let puc19 = catalog_entry("cs-puc19");
    let phix174 = catalog_entry("cs-phix174");
    let p15a = catalog_entry("twist-chlor-med");

    // The fixture: two pUC shuttle vectors, pUC19 and the ΦX174 standard, as the catalogue
    // describes their origins. A catalogue edit that renames an origin fails here, not silently.
    assert_eq!(
        (
            shuttle_cen.origin.as_str(),
            shuttle_2mu.origin.as_str(),
            puc19.origin.as_str(),
            phix174.origin.as_str(),
            p15a.origin.as_str(),
        ),
        (
            "pUC + CEN6/ARS4",
            "pUC + Yeast 2μ",
            "pUC (pMB1 G->A)",
            "ΦX174 rolling-circle ori",
            "p15A",
        ),
        "the fixture: pUC shuttle vectors, pUC19, ΦX174 and a p15A vector"
    );

    // Different markers, so only the origin can make the pair incompatible.
    let shuttle_cen_kan = with_marker(shuttle_cen.clone(), "Kanamycin");
    let shuttle_2mu_chlor = with_marker(shuttle_2mu.clone(), "Chloramphenicol");
    assert_ne!(
        shuttle_cen_kan.bacterial_marker, puc19.bacterial_marker,
        "the fixture isolates the origin from the selection"
    );

    // pUC + CEN6/ARS4 against pUC19: both replicate from pUC in E. coli.
    let cen_vs_puc = check_cotransformation_compatibility(&shuttle_cen_kan, &puc19);
    assert!(
        !cen_vs_puc.origin_compatible,
        "a CEN/ARS shuttle still carries pUC: {}",
        cen_vs_puc.summary
    );
    assert!(cen_vs_puc.antibiotic_orthogonal, "{}", cen_vs_puc.summary);
    assert!(!cen_vs_puc.compatible, "{}", cen_vs_puc.summary);
    assert_eq!(cen_vs_puc.group_a, cen_vs_puc.group_b);
    assert!(
        cen_vs_puc
            .summary
            .starts_with("Origin Incompatibility Warning"),
        "{}",
        cen_vs_puc.summary
    );

    // pUC + Yeast 2μ against pUC + CEN6/ARS4: two shuttle vectors, one E. coli replicon.
    let mu_vs_cen = check_cotransformation_compatibility(&shuttle_2mu_chlor, &shuttle_cen_kan);
    assert!(
        !mu_vs_cen.origin_compatible,
        "both shuttle vectors replicate from pUC in E. coli: {}",
        mu_vs_cen.summary
    );
    assert!(!mu_vs_cen.compatible, "{}", mu_vs_cen.summary);
    assert_eq!(mu_vs_cen.group_a, mu_vs_cen.group_b);

    // Every pUC-family keyword resolves to the same E. coli group, whatever else the origin names.
    let puc_group = group_of(&puc19);
    assert_eq!(
        puc_group,
        table_code("pUC"),
        "the pUC group carries the table's own group code"
    );
    assert_eq!(
        group_of(&p15a),
        table_code("p15A"),
        "the p15A group carries the table's own group code"
    );
    for origin in [
        "pUC + CEN6/ARS4",
        "pUC + Yeast 2μ",
        // pMB1, pBR322 and ColE1 are named without "pUC", so each keyword is pinned on its own.
        "pMB1 + rop + CEN6/ARS4",
        "pBR322 + Yeast 2μ",
        "ColE1 + 2-micron",
        "pUC",
    ] {
        assert_eq!(
            group_of(&with_origin(puc19.clone(), origin)),
            puc_group,
            "{origin} replicates from the pUC/ColE1 replicon in E. coli"
        );
    }

    // An alias and the canonical origin name one group, so a pACYC184 plasmid is not offered as a
    // partner for a p15A plasmid.
    for (alias, canonical) in [
        ("pACYC184 ori", "p15A"),
        ("pCDFDuet (CloDF13)", "CloDF13"),
        ("pRSFDuet (RSF1030)", "RSF1030"),
        ("pSC101-ts", "pSC101"),
    ] {
        assert_eq!(
            group_of(&with_origin(puc19.clone(), alias)),
            table_code(canonical),
            "{alias} resolves to the table's own {canonical} group code"
        );
        assert_eq!(
            group_of(&with_origin(puc19.clone(), canonical)),
            table_code(canonical),
            "{canonical} resolves to the table's own group code"
        );
    }

    // ΦX174 replicates by rolling-circle A-protein nicking, not by ColE1 RNA I/RNA II control.
    let table_codes: Vec<String> = get_origin_compatibility_groups()
        .into_iter()
        .map(|g| g.group_code)
        .collect();
    let phix_group = group_of(&phix174);
    assert_ne!(
        phix_group, FALLBACK_LABEL,
        "ΦX174 must not fall to the ColE1-shaped fallback label"
    );
    assert!(
        table_codes.contains(&phix_group) || phix_group.contains("ΦX174"),
        "ΦX174 gets a group the table holds or its own named group, got {phix_group}"
    );
    assert_ne!(
        phix_group, puc_group,
        "ΦX174 rolling-circle replication is not under ColE1 copy-number control"
    );

    // An origin that names no replicon the table classifies is reported as unclassified, not as
    // ColE1: an unreadable origin is not an answer.
    let unclassified = group_of(&with_origin(puc19.clone(), "unnamed phage replicon"));
    assert_ne!(
        unclassified, FALLBACK_LABEL,
        "an unclassified origin must not be given a ColE1 name"
    );
    assert_ne!(unclassified, puc_group);
    assert!(
        unclassified.to_ascii_lowercase().contains("unclassified"),
        "an unclassified origin says so, got {unclassified}"
    );
    let unknown_a = with_marker(
        with_origin(puc19.clone(), "unnamed phage replicon"),
        "Kanamycin",
    );
    let unknown_b = with_marker(
        with_origin(puc19.clone(), "undocumented ori region"),
        "Chloramphenicol",
    );
    assert!(
        !check_cotransformation_compatibility(&unknown_a, &unknown_b).origin_compatible,
        "two unclassified origins are not promised to be orthogonal"
    );

    // The pairs that are genuinely orthogonal stay compatible.
    let p15a_vs_puc = check_cotransformation_compatibility(&p15a, &puc19);
    assert!(
        p15a_vs_puc.origin_compatible && p15a_vs_puc.compatible,
        "p15A and pUC are different incompatibility groups: {}",
        p15a_vs_puc.summary
    );
    let psc101 = with_marker(with_origin(puc19.clone(), "pSC101"), "Chloramphenicol");
    let psc101_vs_puc = check_cotransformation_compatibility(&psc101, &puc19);
    assert!(
        psc101_vs_puc.origin_compatible && psc101_vs_puc.compatible,
        "pSC101 and pUC are different incompatibility groups: {}",
        psc101_vs_puc.summary
    );

    // Each resolved group label is one the table holds, or a named group of its own - never the
    // fallback string.
    for entry in get_vector_catalog() {
        let group = group_of(&entry);
        assert_ne!(
            group, FALLBACK_LABEL,
            "{} ({}) read as the fallback label",
            entry.id, entry.origin
        );
        assert!(
            !group.is_empty(),
            "{} ({}) resolved to an empty group",
            entry.id,
            entry.origin
        );
    }
}

