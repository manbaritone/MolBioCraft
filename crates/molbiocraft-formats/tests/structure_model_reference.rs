// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Checks the full-atom structure model read from RCSB mmCIF files (`rcsb/*.cif` in the
//! git-ignored reference-data folder) against `reference/structure.json` "counts", computed by
//! `scripts/outside-data/ref_structure.py` with Biopython's MMCIFParser and MMCIF2Dict. Biopython
//! names chains by author id, so chains are compared on `auth_asym_id`.
//!
//! The same entries' legacy `.pdb` files (`rcsb/*.pdb`) are read into the same model and compared
//! with the mmCIF one. A legacy file has no label ids, so the two are compared on author ids.
//!
//! The folder is `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read from the repo root), else
//! `<repo>/test-data`. When a file is absent each test prints `skipped: reference data absent`
//! with the path and returns; with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1` it fails instead.

use molbiocraft_formats::pdb_mmcif::{
    ca_atoms_of_structure, parse_mmcif_structure, parse_pdb_or_mmcif_ca_coordinates, parse_pdb_structure,
    AtomRecord, PdbCaAtom, ResidueRef, SecondaryStructureKind, SecondaryStructureSegment, Structure, StructureModel,
    StructureResidue,
};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};

/// The reference-data folder: `MOLBIOCRAFT_TEST_DATA_DIR`, else `<repo>/test-data`.
fn test_data_dir() -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
        Some(d) if !d.is_empty() => repo.join(d),
        _ => repo.join("test-data"),
    }
}

/// Whether `MOLBIOCRAFT_REQUIRE_TEST_DATA=1`; any value other than `1`, `0` or empty is refused
/// rather than read as "not required".
fn data_required() -> bool {
    let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
    match v.to_str() {
        Some("1") => true,
        Some("" | "0") => false,
        _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
    }
}

/// A file of the reference-data folder, or `None` (after printing the skip line) when it is
/// absent and not required. Every test here gets its data through this, so none can skip silently.
fn data_file(rel: &str) -> Option<String> {
    let required = data_required();
    let p = test_data_dir().join(rel);
    match std::fs::read_to_string(&p) {
        Ok(s) => Some(s),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
            assert!(!required, "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}", p.display());
            eprintln!("skipped: reference data absent ({})", p.display());
            None
        }
        Err(e) => panic!("{}: unreadable: {e}", p.display()),
    }
}

/// `reference/structure.json` "counts".
fn reference_counts() -> Option<Value> {
    let text = data_file("reference/structure.json")?;
    let r: Value = serde_json::from_str(&text).unwrap_or_else(|e| panic!("structure.json: not valid JSON: {e}"));
    Some(r["counts"].clone())
}

/// The entry's mmCIF read into the model, or `None` when the file is absent (skip line printed).
fn structure(entry: &str) -> Option<Structure> {
    let text = data_file(&format!("rcsb/{entry}.cif"))?;
    Some(parse_mmcif_structure(&text).unwrap_or_else(|e| panic!("{entry}.cif: {e}")))
}

/// The entry's legacy PDB file read into the model, or `None` when the file is absent.
fn pdb_structure(entry: &str) -> Option<Structure> {
    let text = data_file(&format!("rcsb/{entry}.pdb"))?;
    Some(parse_pdb_structure(&text).unwrap_or_else(|e| panic!("{entry}.pdb: {e}")))
}

fn as_usize(v: &Value, what: &str) -> usize {
    v.as_u64().unwrap_or_else(|| panic!("reference {what} is not a count: {v}")) as usize
}

/// Author chain id -> polymer (`ATOM`) residues that have a C-alpha, as Biopython counts them.
fn residues_with_ca(model: &StructureModel) -> BTreeMap<String, usize> {
    let mut per = BTreeMap::new();
    for chain in &model.chains {
        let n = chain
            .residues
            .iter()
            .filter(|r| r.atoms.iter().any(|a| a.name == "CA" && a.record == AtomRecord::Atom))
            .count();
        *per.entry(chain.auth_asym_id.clone()).or_insert(0) += n;
    }
    per
}

#[test]
fn counts_match_biopython_for_four_entries() {
    let Some(counts) = reference_counts() else { return };
    let mut bad = Vec::new();
    let mut checked = 0;
    for entry in ["1CRN", "1UBQ", "4HHB", "1MBN"] {
        let r = &counts[entry];
        assert!(r.is_object(), "structure.json has no counts for {entry}");
        let Some(s) = structure(entry) else { return };
        let m = &s.models[0];
        let pairs = [
            ("models", s.models.len(), &r["models"]),
            ("ATOM records in model 1", m.atom_record_count, &r["atom_records_model_1"]),
            ("HETATM records in model 1", m.hetatm_record_count, &r["hetatm_records_model_1"]),
        ];
        for (what, got, want) in pairs {
            if got != as_usize(want, what) {
                bad.push(format!("{entry}: {what} {got} vs Biopython {want}"));
            }
        }
        let chains: BTreeSet<String> = m.chains.iter().map(|c| c.auth_asym_id.clone()).collect();
        let want_chains: BTreeSet<String> = r["chains_model_1"]
            .as_array()
            .expect("chains_model_1")
            .iter()
            .map(|c| c.as_str().expect("chain id").to_string())
            .collect();
        if chains != want_chains {
            bad.push(format!("{entry}: chains {chains:?} vs Biopython {want_chains:?}"));
        }
        let want_residues: BTreeMap<String, usize> = r["polymer_residues_with_ca"]
            .as_object()
            .expect("polymer_residues_with_ca")
            .iter()
            .map(|(k, v)| (k.clone(), as_usize(v, "residues")))
            .collect();
        let got_residues = residues_with_ca(m);
        if got_residues != want_residues {
            bad.push(format!("{entry}: residues with CA {got_residues:?} vs Biopython {want_residues:?}"));
        }
        // The C-alpha view the app draws holds one atom per such residue (no HETATM CA here).
        let ca = ca_atoms_of_structure(&s).len();
        let want_ca: usize = want_residues.values().sum();
        if ca != want_ca {
            bad.push(format!("{entry}: C-alpha view has {ca} atoms vs {want_ca} residues with CA"));
        }
        checked += 1;
    }
    assert_eq!(checked, 4);
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn nmr_entry_keeps_every_model() {
    let Some(counts) = reference_counts() else { return };
    let r = &counts["1A5R"];
    let Some(s) = structure("1A5R") else { return };
    assert_eq!(s.models.len(), as_usize(&r["models"], "models"));
    assert_eq!(s.models.len(), 10);
    let nums: Vec<i32> = s.models.iter().map(|m| m.model_num).collect();
    assert_eq!(nums, (1..=10).collect::<Vec<_>>());
    assert_eq!(s.models[0].atom_record_count, as_usize(&r["atom_records_model_1"], "ATOM records"));
    assert_eq!(s.models[0].atom_record_count, 1622);
    let atoms = |m: &StructureModel| -> Vec<[f64; 3]> {
        m.chains.iter().flat_map(|c| &c.residues).flat_map(|r| &r.atoms).map(|a| [a.x, a.y, a.z]).collect()
    };
    let first = atoms(&s.models[0]);
    for m in &s.models {
        assert_eq!(m.atom_record_count, 1622, "model {}", m.model_num);
        assert_eq!(atoms(m).len(), 1622, "model {} atoms", m.model_num);
        assert_eq!(residues_with_ca(m), BTreeMap::from([("A".to_string(), 103)]), "model {}", m.model_num);
    }
    for m in &s.models[1..] {
        assert_ne!(atoms(m), first, "model {} repeats model 1's coordinates", m.model_num);
    }
    // The C-alpha view is the first model only, not ten copies of the chain end to end.
    let ca = ca_atoms_of_structure(&s);
    assert_eq!(ca.len(), 103);
    let model_1_ca: Vec<[f64; 3]> = s.models[0].chains[0].residues.iter()
        .flat_map(|r| r.atoms.iter().filter(|a| a.name == "CA"))
        .map(|a| [a.x, a.y, a.z])
        .collect();
    assert_eq!(ca.iter().map(|a| [a.x, a.y, a.z]).collect::<Vec<_>>(), model_1_ca);
}

#[test]
fn secondary_structure_counts_match_the_file() {
    let Some(counts) = reference_counts() else { return };
    let mut bad = Vec::new();
    for entry in ["1CRN", "1UBQ", "4HHB", "1A5R", "1MBN"] {
        let r = &counts[entry];
        let Some(s) = structure(entry) else { return };
        let helices = as_usize(&r["helices_struct_conf"], "helices");
        let strands = as_usize(&r["strands_struct_sheet_range"], "strands");
        if (s.helices.len(), s.strands.len()) != (helices, strands) {
            bad.push(format!(
                "{entry}: {} helices and {} strands vs {helices} and {strands} in the file",
                s.helices.len(),
                s.strands.len()
            ));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));

    // The ranges themselves, as 1CRN.cif lists them.
    let Some(s) = structure("1CRN") else { return };
    let span = |seg: &molbiocraft_formats::pdb_mmcif::SecondaryStructureSegment| {
        (
            seg.id.clone(),
            seg.begin.res_name.clone().unwrap_or_default(),
            seg.begin.label_asym_id.clone(),
            seg.begin.label_seq_id,
            seg.end.res_name.clone().unwrap_or_default(),
            seg.end.label_seq_id,
            seg.end.auth_seq_id,
        )
    };
    let helices: Vec<_> = s.helices.iter().map(span).collect();
    assert_eq!(
        helices,
        vec![
            ("HELX_P1".into(), "ILE".into(), "A".into(), 7, "PRO".into(), 19, Some(19)),
            ("HELX_P2".into(), "GLU".into(), "A".into(), 23, "THR".into(), 30, Some(30)),
        ]
    );
    assert!(s.helices.iter().all(|h| h.conf_type_id.as_deref() == Some("HELX_P")));
    let strands: Vec<_> = s.strands.iter().map(span).collect();
    assert_eq!(
        strands,
        vec![
            ("1".into(), "THR".into(), "A".into(), 1, "CYS".into(), 4, Some(4)),
            ("2".into(), "CYS".into(), "A".into(), 32, "ILE".into(), 35, Some(35)),
        ]
    );
    assert!(s.strands.iter().all(|e| e.sheet_id.as_deref() == Some("S1")));
}

// ─── Legacy PDB files read into the same model ───

/// A residue as a legacy file can name it: author residue number, insertion code, name.
type ResidueId = (Option<i32>, Option<String>, String);

fn residue_id(r: &StructureResidue) -> ResidueId {
    (r.auth_seq_id, r.ins_code.clone(), r.res_name.clone())
}

/// Author chain ids in the order they first appear.
fn author_chain_order(model: &StructureModel) -> Vec<String> {
    let mut ids: Vec<String> = Vec::new();
    for c in &model.chains {
        if !ids.contains(&c.auth_asym_id) {
            ids.push(c.auth_asym_id.clone());
        }
    }
    ids
}

/// Author chain id -> its residues in order, across every chain instance that shares the id (an
/// mmCIF file gives ligands and waters label chains of their own; a legacy file cannot).
fn residues_by_author_chain(model: &StructureModel) -> BTreeMap<String, Vec<&StructureResidue>> {
    let mut per: BTreeMap<String, Vec<&StructureResidue>> = BTreeMap::new();
    for c in &model.chains {
        per.entry(c.auth_asym_id.clone()).or_default().extend(&c.residues);
    }
    per
}

fn distance(a: [f64; 3], b: [f64; 3]) -> f64 {
    ((a[0] - b[0]).powi(2) + (a[1] - b[1]).powi(2) + (a[2] - b[2]).powi(2)).sqrt()
}

/// Whether two points are within 0.001 A (a NaN is never within).
fn within_a_milliangstrom(a: [f64; 3], b: [f64; 3]) -> bool {
    distance(a, b) <= 0.001
}

/// Where two C-alpha lists differ in length, residue name or position (beyond 0.001 A).
fn ca_list_differences(what: &str, got: &[PdbCaAtom], want: &[PdbCaAtom]) -> Vec<String> {
    if got.len() != want.len() {
        return vec![format!("{what}: {} C-alphas vs {}", got.len(), want.len())];
    }
    got.iter()
        .zip(want)
        .enumerate()
        .filter(|(_, (g, w))| g.res_name != w.res_name || !within_a_milliangstrom([g.x, g.y, g.z], [w.x, w.y, w.z]))
        .map(|(i, (g, w))| {
            format!("{what}: C-alpha {i} is {} at {:?}, vs {} at {:?}", g.res_name, [g.x, g.y, g.z], w.res_name, [w.x, w.y, w.z])
        })
        .collect()
}

#[test]
fn pdb_and_mmcif_give_the_same_model() {
    let Some(counts) = reference_counts() else { return };
    let mut bad = Vec::new();
    let mut checked = Vec::new();
    // 4HHB is the criterion's entry; the others add waters and ligands (1UBQ, 1MBN) and an NMR
    // ensemble of ten models (1A5R).
    let entries = ["4HHB", "1CRN", "1UBQ", "1MBN", "1A5R"];
    for entry in entries {
        let (Some(pdb_text), Some(cif_text)) =
            (data_file(&format!("rcsb/{entry}.pdb")), data_file(&format!("rcsb/{entry}.cif")))
        else {
            return;
        };
        let pdb = parse_pdb_structure(&pdb_text).unwrap_or_else(|e| panic!("{entry}.pdb: {e}"));
        let cif = parse_mmcif_structure(&cif_text).unwrap_or_else(|e| panic!("{entry}.cif: {e}"));
        // A legacy file has no label ids, and the model says its label fields hold author ones.
        assert!(pdb.label_ids_from_author, "{entry}.pdb");
        assert!(!cif.label_ids_from_author, "{entry}.cif");
        let nums = |s: &Structure| s.models.iter().map(|m| m.model_num).collect::<Vec<_>>();
        assert_eq!(nums(&pdb), nums(&cif), "{entry}: model numbers");

        for (p, c) in pdb.models.iter().zip(&cif.models) {
            let what = format!("{entry} model {}", p.model_num);
            let records = |m: &StructureModel| (m.atom_record_count, m.hetatm_record_count);
            if records(p) != records(c) {
                bad.push(format!("{what}: (ATOM, HETATM) records {:?} vs {:?}", records(p), records(c)));
            }
            if author_chain_order(p) != author_chain_order(c) {
                bad.push(format!("{what}: chains {:?} vs {:?}", author_chain_order(p), author_chain_order(c)));
                continue;
            }
            let (p_chains, c_chains) = (residues_by_author_chain(p), residues_by_author_chain(c));
            for (chain, p_res) in &p_chains {
                let c_res = &c_chains[chain];
                let ids = |rs: &[&StructureResidue]| rs.iter().map(|r| residue_id(r)).collect::<Vec<_>>();
                if ids(p_res) != ids(c_res) {
                    bad.push(format!("{what} chain {chain}: {} residues vs {}, or not the same ones", p_res.len(), c_res.len()));
                    continue;
                }
                for (pr, cr) in p_res.iter().zip(c_res) {
                    let ca = |r: &StructureResidue| {
                        r.atoms.iter().filter(|a| a.name == "CA").map(|a| [a.x, a.y, a.z]).collect::<Vec<_>>()
                    };
                    let (p_ca, c_ca) = (ca(pr), ca(cr));
                    if p_ca.len() != c_ca.len() || p_ca.iter().zip(&c_ca).any(|(a, b)| !within_a_milliangstrom(*a, *b)) {
                        bad.push(format!("{what} chain {chain} {:?}: C-alpha {p_ca:?} vs {c_ca:?}", residue_id(pr)));
                    }
                }
            }
            if residues_with_ca(p) != residues_with_ca(c) {
                bad.push(format!("{what}: residues with CA {:?} vs {:?}", residues_with_ca(p), residues_with_ca(c)));
            }
        }

        // Model 1 of the legacy file against Biopython's counts for the entry.
        let r = &counts[entry];
        assert!(r.is_object(), "structure.json has no counts for {entry}");
        let m = &pdb.models[0];
        let pairs = [
            ("models", pdb.models.len(), &r["models"]),
            ("ATOM records in model 1", m.atom_record_count, &r["atom_records_model_1"]),
            ("HETATM records in model 1", m.hetatm_record_count, &r["hetatm_records_model_1"]),
        ];
        for (what, got, want) in pairs {
            if got != as_usize(want, what) {
                bad.push(format!("{entry}.pdb: {what} {got} vs Biopython {want}"));
            }
        }
        let chains: BTreeSet<String> = m.chains.iter().map(|c| c.auth_asym_id.clone()).collect();
        let want_chains: BTreeSet<String> = r["chains_model_1"]
            .as_array()
            .expect("chains_model_1")
            .iter()
            .map(|c| c.as_str().expect("chain id").to_string())
            .collect();
        if chains != want_chains {
            bad.push(format!("{entry}.pdb: chains {chains:?} vs Biopython {want_chains:?}"));
        }
        let want_residues: BTreeMap<String, usize> = r["polymer_residues_with_ca"]
            .as_object()
            .expect("polymer_residues_with_ca")
            .iter()
            .map(|(k, v)| (k.clone(), as_usize(v, "residues")))
            .collect();
        if residues_with_ca(m) != want_residues {
            bad.push(format!("{entry}.pdb: residues with CA {:?} vs Biopython {want_residues:?}", residues_with_ca(m)));
        }

        // The model's C-alpha view, and the C-alpha list the app draws from each file.
        bad.extend(ca_list_differences(
            &format!("{entry} model C-alpha view"),
            &ca_atoms_of_structure(&pdb),
            &ca_atoms_of_structure(&cif),
        ));
        bad.extend(ca_list_differences(
            &format!("{entry} drawn C-alpha list"),
            &parse_pdb_or_mmcif_ca_coordinates(&pdb_text),
            &parse_pdb_or_mmcif_ca_coordinates(&cif_text),
        ));
        checked.push(entry);
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    assert_eq!(checked, entries);
}

#[test]
fn nmr_pdb_ca_view_is_the_first_model() {
    let (Some(pdb_text), Some(cif_text)) = (data_file("rcsb/1A5R.pdb"), data_file("rcsb/1A5R.cif")) else { return };
    // Ten models are in the file, so a reader that appends them all draws 1030 C-alphas.
    let s = parse_pdb_structure(&pdb_text).unwrap_or_else(|e| panic!("1A5R.pdb: {e}"));
    assert_eq!(s.models.iter().map(|m| m.model_num).collect::<Vec<_>>(), (1..=10).collect::<Vec<_>>());
    for m in &s.models {
        assert_eq!((m.atom_record_count, residues_with_ca(m)["A"]), (1622, 103), "model {}", m.model_num);
    }
    let drawn = parse_pdb_or_mmcif_ca_coordinates(&pdb_text);
    assert_eq!(drawn.len(), 103);
    let cif_drawn = parse_pdb_or_mmcif_ca_coordinates(&cif_text);
    assert_eq!(cif_drawn.len(), 103);
    let mut bad = ca_list_differences("1A5R.pdb vs 1A5R.cif", &drawn, &cif_drawn);
    // Model 1, not another of the ten.
    bad.extend(ca_list_differences("1A5R.pdb vs its model 1", &drawn, &ca_atoms_of_structure(&s)));
    assert!(bad.is_empty(), "{}", bad.join("\n"));
    assert!(drawn.iter().all(|a| a.chain_id == "A") && drawn.windows(2).all(|w| w[0].res_seq < w[1].res_seq));
}

/// A legacy `ATOM`/`HETATM` record in the wwPDB v3.3 columns: serial 7-11, name 13-16, altLoc 17,
/// resName 18-20, chainID 22, resSeq 23-26, iCode 27, x/y/z 31-54, occupancy 55-60,
/// tempFactor 61-66, element 77-78.
fn atom_record(record: &str, serial: usize, name: &str, res: &str, chain: char, seq: i32, icode: char) -> String {
    let x = serial as f64;
    format!(
        "{record:<6}{serial:>5} {name:<4} {res:>3} {chain}{seq:>4}{icode}   {x:>8.3}{:>8.3}{:>8.3}{:>6.2}{:>6.2}          {:>2}  \n",
        0.5, -1.0, 1.0, 20.0, "C"
    )
}

/// A residue end of a `HELIX` or `SHEET` record: name, chain, number, insertion code.
type End = (&'static str, char, i32, char);

/// `HELIX`: serNum 8-10, helixID 12-14, initResName 16-18, initChainID 20, initSeqNum 22-25,
/// initICode 26, endResName 28-30, endChainID 32, endSeqNum 34-37, endICode 38, helixClass 39-40.
fn helix_record(ser: u32, id: &str, b: End, e: End, class: u32) -> String {
    format!("HELIX  {ser:>3} {id:>3} {:>3} {} {:>4}{} {:>3} {} {:>4}{}{class:>2}", b.0, b.1, b.2, b.3, e.0, e.1, e.2, e.3)
}

/// `SHEET`: strand 8-10, sheetID 12-14, numStrands 15-16, initResName 18-20, initChainID 22,
/// initSeqNum 23-26, initICode 27, endResName 29-31, endChainID 33, endSeqNum 34-37, endICode 38,
/// sense 39-40.
fn sheet_record(strand: u32, sheet: &str, n: u32, b: End, e: End, sense: i32) -> String {
    format!("SHEET  {strand:>3} {sheet:>3}{n:>2} {:>3} {}{:>4}{} {:>3} {}{:>4}{}{sense:>2}", b.0, b.1, b.2, b.3, e.0, e.1, e.2, e.3)
}

/// A residue's secondary structure as one letter: H helix, E strand, C neither.
fn ss_letter(r: &StructureResidue) -> char {
    match r.secondary_structure {
        Some(SecondaryStructureKind::Helix) => 'H',
        Some(SecondaryStructureKind::Strand) => 'E',
        None => 'C',
    }
}

#[test]
fn pdb_helix_and_sheet_records_set_secondary_structure() {
    // The record builders reproduce 1CRN's own HELIX and SHEET lines column for column.
    assert_eq!(
        helix_record(1, "H1", ("ILE", 'A', 7, ' '), ("PRO", 'A', 19, ' '), 1),
        "HELIX    1  H1 ILE A    7  PRO A   19  1"
    );
    assert_eq!(
        sheet_record(2, "S1", 2, ("CYS", 'A', 32, ' '), ("ILE", 'A', 35, ' '), -1),
        "SHEET    2  S1 2 CYS A  32  ILE A  35 -1"
    );

    // Residue A4 is in both a helix and a strand (a data error): the helix wins. The second helix
    // runs between insertion codes, 52A to 52B, so 52 and 53 stay out of it. The strand of chain B
    // does not reach chain A, and a water numbered inside a range (HOH A 3) is not in it. A helix
    // whose ends are in two chains, and a strand whose last residue comes before its first, are
    // data errors too: they cover nothing.
    let mut text = String::new();
    for line in [
        helix_record(1, "1", ("ALA", 'A', 2, ' '), ("ALA", 'A', 4, ' '), 1),
        sheet_record(1, "S1", 2, ("ALA", 'A', 4, ' '), ("ALA", 'A', 6, ' '), 0),
        helix_record(2, "2", ("GLY", 'A', 52, 'A'), ("GLY", 'A', 52, 'B'), 5),
        sheet_record(2, "S1", 2, ("ALA", 'B', 1, ' '), ("ALA", 'B', 2, ' '), -1),
        helix_record(3, "3", ("ALA", 'A', 6, ' '), ("ALA", 'B', 3, ' '), 1),
        sheet_record(1, "S2", 1, ("ALA", 'B', 3, ' '), ("ALA", 'B', 1, ' '), 0),
    ] {
        text.push_str(&line);
        text.push('\n');
    }
    let mut serial = 0;
    let mut atom = |record: &str, name: &str, res: &str, chain: char, seq: i32, icode: char| {
        serial += 1;
        atom_record(record, serial, name, res, chain, seq, icode)
    };
    for seq in 1..=7 {
        text.push_str(&atom("ATOM", " CA ", "ALA", 'A', seq, ' '));
    }
    for (seq, icode) in [(52, ' '), (52, 'A'), (52, 'B'), (53, ' ')] {
        text.push_str(&atom("ATOM", " CA ", "GLY", 'A', seq, icode));
    }
    text.push_str("TER\n");
    for seq in 1..=3 {
        text.push_str(&atom("ATOM", " CA ", "ALA", 'B', seq, ' '));
    }
    text.push_str("TER\n");
    text.push_str(&atom("HETATM", " O  ", "HOH", 'A', 3, ' '));
    text.push_str(&atom("HETATM", " O  ", "HOH", 'B', 2, ' '));
    text.push_str("END\n");

    let s = parse_pdb_structure(&text).unwrap_or_else(|e| panic!("{e}\n{text}"));
    let chains: Vec<(String, String)> = s.models[0]
        .chains
        .iter()
        .map(|c| (c.auth_asym_id.clone(), c.residues.iter().map(ss_letter).collect()))
        .collect();
    assert_eq!(chains, [("A".into(), "CHHHEECCHHCC".into()), ("B".into(), "EECC".into())], "{text}");
    type EndId = (Option<String>, Option<String>, Option<i32>, Option<String>);
    let end_id = |r: &ResidueRef| -> EndId { (r.res_name.clone(), r.auth_asym_id.clone(), r.auth_seq_id, r.ins_code.clone()) };
    let ends = |segs: &[SecondaryStructureSegment]| {
        segs.iter()
            .map(|g| (g.id.clone(), g.conf_type_id.clone(), g.sheet_id.clone(), end_id(&g.begin), end_id(&g.end)))
            .collect::<Vec<_>>()
    };
    let at = |name: &str, chain: &str, seq: i32, ins: Option<&str>| -> EndId {
        (Some(name.to_string()), Some(chain.to_string()), Some(seq), ins.map(str::to_string))
    };
    let helx = Some("HELX_P".to_string());
    assert_eq!(
        ends(&s.helices),
        [
            ("1".into(), helx.clone(), None, at("ALA", "A", 2, None), at("ALA", "A", 4, None)),
            ("2".into(), helx.clone(), None, at("GLY", "A", 52, Some("A")), at("GLY", "A", 52, Some("B"))),
            ("3".into(), helx, None, at("ALA", "A", 6, None), at("ALA", "B", 3, None)),
        ],
        "every record is listed as the file gives it, including those that cover nothing"
    );
    let (s1, s2) = (Some("S1".to_string()), Some("S2".to_string()));
    assert_eq!(
        ends(&s.strands),
        [
            ("1".into(), None, s1.clone(), at("ALA", "A", 4, None), at("ALA", "A", 6, None)),
            ("2".into(), None, s1, at("ALA", "B", 1, None), at("ALA", "B", 2, None)),
            ("1".into(), None, s2, at("ALA", "B", 3, None), at("ALA", "B", 1, None)),
        ]
    );
    // The label ids of a legacy file are its author ids.
    for g in s.helices.iter().chain(&s.strands) {
        for r in [&g.begin, &g.end] {
            assert_eq!((Some(&r.label_asym_id), Some(r.label_seq_id)), (r.auth_asym_id.as_ref(), r.auth_seq_id));
        }
    }

    // Reference files: as many helices and strands as the mmCIF file lists, and every residue of
    // every model given the secondary structure the mmCIF file gives it.
    let Some(counts) = reference_counts() else { return };
    let mut bad = Vec::new();
    for entry in ["1CRN", "1UBQ", "4HHB", "1A5R", "1MBN"] {
        let r = &counts[entry];
        let (Some(pdb), Some(cif)) = (pdb_structure(entry), structure(entry)) else { return };
        let want = (as_usize(&r["helices_struct_conf"], "helices"), as_usize(&r["strands_struct_sheet_range"], "strands"));
        if (pdb.helices.len(), pdb.strands.len()) != want {
            bad.push(format!("{entry}.pdb: {} HELIX and {} SHEET records read vs {want:?}", pdb.helices.len(), pdb.strands.len()));
        }
        assert_eq!(pdb.models.len(), cif.models.len(), "{entry}: models");
        for (p, c) in pdb.models.iter().zip(&cif.models) {
            let per = |m: &StructureModel| -> BTreeMap<String, Vec<(ResidueId, char)>> {
                residues_by_author_chain(m)
                    .into_iter()
                    .map(|(chain, rs)| (chain, rs.into_iter().map(|r| (residue_id(r), ss_letter(r))).collect()))
                    .collect()
            };
            let (ps, cs) = (per(p), per(c));
            if ps != cs {
                let letters = |m: &BTreeMap<String, Vec<(ResidueId, char)>>| -> Vec<String> {
                    m.iter().map(|(chain, rs)| format!("{chain}: {}", rs.iter().map(|(_, l)| l).collect::<String>())).collect()
                };
                bad.push(format!("{entry} model {}:\n  .pdb {:?}\n  .cif {:?}", p.model_num, letters(&ps), letters(&cs)));
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));

    // Every one of 1A5R's ten models, residue by residue, as its records give it (the comparison
    // above shares the assignment with the mmCIF reader, so this states it from the file): HELIX
    // 44-55 and 76-80; SHEET 32-39, 21-28, 86-92 and 62-65; the residues run from -1 to 101.
    let Some(s) = pdb_structure("1A5R") else { return };
    let want: String = (-1..=101)
        .map(|i| match i {
            44..=55 | 76..=80 => 'H',
            21..=28 | 32..=39 | 62..=65 | 86..=92 => 'E',
            _ => 'C',
        })
        .collect();
    assert_eq!(s.models.len(), 10);
    for m in &s.models {
        let got: String = m.chains[0].residues.iter().map(ss_letter).collect();
        assert_eq!(got, want, "model {}", m.model_num);
    }

    // 1CRN residue by residue, as its records give it: HELIX 7-19 and 23-30, SHEET 1-4 and 32-35.
    let Some(s) = pdb_structure("1CRN") else { return };
    let got: String = s.models[0].chains[0].residues.iter().map(ss_letter).collect();
    let want: String = (1..=46)
        .map(|i| match i {
            7..=19 | 23..=30 => 'H',
            1..=4 | 32..=35 => 'E',
            _ => 'C',
        })
        .collect();
    assert_eq!(got, want);
    let ids: Vec<(String, Option<String>)> = s.helices.iter().chain(&s.strands).map(|g| (g.id.clone(), g.sheet_id.clone())).collect();
    let s1 = Some("S1".to_string());
    assert_eq!(ids, [("1".into(), None), ("2".into(), None), ("1".into(), s1.clone()), ("2".into(), s1)]);

    // 4HHB: 32 HELIX records and no SHEET; no two of its helices overlap, so each chain has as
    // many helix residues as its records' lengths add up to (alpha 16+16+7+2+20+9+19+21, beta
    // 15+16+7+7+20+9+19+21).
    let Some(s) = pdb_structure("4HHB") else { return };
    let mut per_chain: BTreeMap<String, (usize, usize)> = BTreeMap::new();
    for (chain, residues) in residues_by_author_chain(&s.models[0]) {
        let n = |k: SecondaryStructureKind| residues.iter().filter(|r| r.secondary_structure == Some(k)).count();
        per_chain.insert(chain, (n(SecondaryStructureKind::Helix), n(SecondaryStructureKind::Strand)));
    }
    let want: BTreeMap<String, (usize, usize)> =
        [("A", 110), ("B", 114), ("C", 110), ("D", 114)].into_iter().map(|(c, h)| (c.to_string(), (h, 0))).collect();
    assert_eq!(per_chain, want);
}
