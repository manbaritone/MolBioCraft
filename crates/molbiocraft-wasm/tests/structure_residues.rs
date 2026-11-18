// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFMX AC3 and AC4: modified residues, nucleic-acid chains and ions as the app reads them
//! through the dispatcher every transport shares (`parse_pdb_ca`, `structure_chain_sequences`,
//! `parse_structure`). Wrong implementations, and the case that catches each:
//! - a PDB C-alpha view that reads `ATOM` records only: the HETATM MSE 1 and SEC 3 are lost (8
//!   atoms, not 10);
//! - a C-alpha view that takes any atom named CA: the calcium ion joins the PDB list, and makes a
//!   chain B in the mmCIF one;
//! - an atom read as a residue: MSE carries a second atom (SE), so its chain would read MM...;
//! - SEC read as modified cysteine or X, or a modified residue read under its own name: the chain
//!   must read MKUVTFISLL with only MSE in `modified`;
//! - a nucleic chain read as protein (G -> Gly), DNA told from RNA wrongly, or PSU dropped: B and C
//!   of the complex fixture must read GUAC (RNA) and ACGT (DNA);
//! - an ion or a water read as a chain: the mmCIF fixture has no chain B;
//! - a residue the table lacks dropped or read silently: XYZ7 must be X with its warning, and a
//!   chain of nothing but NAG must be named as skipped, not read as XX;
//! - a missing, empty or unreadable text answered with an empty list: each is refused by name.

use molbiocraft_formats::pdb_mmcif::parse_mmcif_structure;
use molbiocraft_wasm::dispatch_bio_rpc;
use serde_json::{json, Value};

fn atom(record: &str, serial: usize, name: &str, res: &str, seq: i32, x: f64, element: &str) -> String {
    format!(
        "{record:<6}{serial:>5} {name:<4} {res:>3} A{seq:>4}    {x:>8.3}{:>8.3}{:>8.3}  1.00 20.00          {element:>2}\n",
        1.0, 2.0
    )
}

/// Chain A: HETATM MSE 1 (with its selenium), ATOM LYS 2, HETATM SEC 3, ATOM VAL 4 to LEU 10,
/// then a calcium ion, HETATM CA CA A 101.
fn pdb_fixture() -> String {
    let mut out = String::from("HEADER    SYNTHETIC\n");
    out.push_str(&atom("HETATM", 1, " CA", "MSE", 1, 0.0, "C"));
    out.push_str(&atom("HETATM", 2, "SE", "MSE", 1, 0.5, "SE"));
    out.push_str(&atom("ATOM", 3, " CA", "LYS", 2, 3.8, "C"));
    out.push_str(&atom("HETATM", 4, " CA", "SEC", 3, 7.6, "C"));
    for (k, res) in ["VAL", "THR", "PHE", "ILE", "SER", "LEU", "LEU"].iter().enumerate() {
        out.push_str(&atom("ATOM", 5 + k, " CA", res, 4 + k as i32, 11.4 + 3.8 * k as f64, "C"));
    }
    out.push_str(&atom("HETATM", 12, "CA", "CA", 101, 5.0, "CA"));
    out.push_str("END\n");
    out
}

const CIF_HEADER: &str = "data_T
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_seq_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
";

/// mmCIF rows from (group, element, atom, residue, label chain, label_seq_id, auth number); the
/// author chain is the label chain.
fn cif(rows: &[(&str, &str, &str, &str, &str, &str, i32)]) -> String {
    let mut out = String::from(CIF_HEADER);
    for (k, (group, el, name, res, chain, seq, auth)) in rows.iter().enumerate() {
        out.push_str(&format!("{group} {} {el} {name} {res} {chain} {seq} {chain} {auth} {}.000 1.000 2.000\n", k + 1, k));
    }
    out
}

/// label_asym A: MSE, LYS, SEP, VAL (label_seq_id 1-4); label_asym B: a calcium ion ('.').
fn cif_fixture() -> String {
    cif(&[
        ("HETATM", "C", "CA", "MSE", "A", "1", 1),
        ("HETATM", "SE", "SE", "MSE", "A", "1", 1),
        ("ATOM", "C", "CA", "LYS", "A", "2", 2),
        ("HETATM", "C", "CA", "SEP", "A", "3", 3),
        ("ATOM", "C", "CA", "VAL", "A", "4", 4),
        ("HETATM", "CA", "CA", "CA", "B", ".", 101),
    ])
}

/// A: ALA, GLY; B: G, PSU, A, C (RNA, P and C1' atoms); C: DA, DC, DG, DT.
fn complex_fixture() -> String {
    let mut rows = vec![("ATOM", "C", "CA", "ALA", "A", "1", 1), ("ATOM", "C", "CA", "GLY", "A", "2", 2)];
    for (k, res) in ["G", "PSU", "A", "C"].iter().enumerate() {
        let seq = ["1", "2", "3", "4"][k];
        let group = if *res == "PSU" { "HETATM" } else { "ATOM" };
        rows.push((group, "P", "P", res, "B", seq, k as i32 + 1));
        rows.push((group, "C", "\"C1'\"", res, "B", seq, k as i32 + 1));
    }
    for (k, res) in ["DA", "DC", "DG", "DT"].iter().enumerate() {
        let seq = ["1", "2", "3", "4"][k];
        rows.push(("ATOM", "P", "P", res, "C", seq, k as i32 + 1));
        rows.push(("ATOM", "C", "\"C1'\"", res, "C", seq, k as i32 + 1));
    }
    cif(&rows)
}

/// Chain A: MET ALA GLY SER THR LYS then XYZ at label_seq_id 7; chain D: two NAG (1-2).
fn unknown_fixture() -> String {
    let mut rows: Vec<(&str, &str, &str, &str, &str, &str, i32)> = Vec::new();
    for (k, res) in ["MET", "ALA", "GLY", "SER", "THR", "LYS", "XYZ"].iter().enumerate() {
        rows.push(("ATOM", "C", "CA", res, "A", ["1", "2", "3", "4", "5", "6", "7"][k], k as i32 + 1));
    }
    rows.push(("HETATM", "C", "C1", "NAG", "D", "1", 1));
    rows.push(("HETATM", "C", "C1", "NAG", "D", "2", 2));
    cif(&rows)
}

fn rpc(op: &str, payload: Value) -> Value {
    dispatch_bio_rpc(op, payload).unwrap_or_else(|e| panic!("{op} refused: {e}"))
}

#[test]
fn the_c_alpha_view_keeps_modified_residues_and_drops_ions() {
    let atoms = rpc("parse_pdb_ca", json!({ "pdbText": pdb_fixture() }));
    let atoms = atoms.as_array().unwrap();
    let names: Vec<&str> = atoms.iter().map(|a| a["resName"].as_str().unwrap()).collect();
    assert_eq!(names, ["MSE", "LYS", "SEC", "VAL", "THR", "PHE", "ILE", "SER", "LEU", "LEU"]);
    let numbers: Vec<i64> = atoms.iter().map(|a| a["resSeq"].as_i64().unwrap()).collect();
    assert_eq!(numbers, (1..=10).collect::<Vec<i64>>());

    let atoms = rpc("parse_pdb_ca", json!({ "pdbText": cif_fixture() }));
    let atoms = atoms.as_array().unwrap();
    let chains: Vec<&str> = atoms.iter().map(|a| a["chainId"].as_str().unwrap()).collect();
    assert_eq!(chains, ["A", "A", "A", "A"], "4 atoms in chain A, none in B");
    let names: Vec<&str> = atoms.iter().map(|a| a["resName"].as_str().unwrap()).collect();
    assert_eq!(names, ["MSE", "LYS", "SEP", "VAL"]);

    // A calcium written as an ATOM record (some writers do) is still not a C-alpha: its element is
    // not carbon.
    let atom_calcium = pdb_fixture().replace("HETATM   12", "ATOM     12");
    assert!(atom_calcium.contains("ATOM     12 CA    CA A 101"), "{atom_calcium}");
    let atoms = rpc("parse_pdb_ca", json!({ "pdbText": atom_calcium }));
    assert_eq!(atoms.as_array().unwrap().len(), 10, "the ATOM calcium is not an 11th C-alpha");
}

fn modified(entries: &[(&str, i32, &str)]) -> Value {
    entries.iter().map(|(n, k, c)| json!({ "resName": n, "number": k, "code": c })).collect()
}

fn chain(id: &str, molecule: &str, sequence: &str, first: i32, mods: &[(&str, i32, &str)]) -> Value {
    json!({ "chainId": id, "molecule": molecule, "sequence": sequence, "firstResidueNumber": first, "modified": modified(mods) })
}

fn sequences(text: String) -> Value {
    rpc("structure_chain_sequences", json!({ "text": text }))
}

#[test]
fn chain_sequences_read_parents_nucleic_chains_and_no_ions() {
    assert_eq!(
        sequences(pdb_fixture()),
        json!({ "chains": [chain("A", "Protein", "MKUVTFISLL", 1, &[("MSE", 1, "M")])], "skipped": [], "warnings": [] })
    );
    assert_eq!(
        sequences(cif_fixture()),
        json!({
            "chains": [chain("A", "Protein", "MKSV", 1, &[("MSE", 1, "M"), ("SEP", 3, "S")])],
            "skipped": [],
            "warnings": []
        })
    );
    assert_eq!(
        sequences(complex_fixture()),
        json!({
            "chains": [
                chain("A", "Protein", "AG", 1, &[]),
                chain("B", "RNA", "GUAC", 1, &[("PSU", 2, "U")]),
                chain("C", "DNA", "ACGT", 1, &[]),
            ],
            "skipped": [],
            "warnings": []
        })
    );
    assert_eq!(
        sequences(unknown_fixture()),
        json!({
            "chains": [chain("A", "Protein", "MAGSTKX", 1, &[])],
            "skipped": [{ "chainId": "D", "reason": "no amino-acid or nucleotide residues" }],
            "warnings": ["Residue XYZ7 in chain A has no entry in the residue table: read as X."]
        })
    );

    // Residues are numbered as the author numbers them, as a PDB file of the same entry is, not
    // by their label_seq_id.
    let renumbered = cif(&[
        ("HETATM", "C", "CA", "MSE", "A", "1", 101),
        ("ATOM", "C", "CA", "LYS", "A", "2", 102),
        ("ATOM", "C", "CA", "XYZ", "A", "3", 103),
    ]);
    assert_eq!(
        sequences(renumbered),
        json!({
            "chains": [chain("A", "Protein", "MKX", 101, &[("MSE", 101, "M")])],
            "skipped": [],
            "warnings": ["Residue XYZ103 in chain A has no entry in the residue table: read as X."]
        })
    );

    assert_eq!(
        dispatch_bio_rpc("structure_chain_sequences", json!({})),
        Err("Missing required field 'text' in RPC payload".to_string())
    );
    assert_eq!(
        dispatch_bio_rpc("structure_chain_sequences", json!({ "text": "" })),
        Err("PDB text has no ATOM or HETATM records, so it holds no atom coordinates".to_string())
    );
    let unreadable = "data_T\nloop_\n_atom_site.group_PDB\n_atom_site.id\nATOM 1\n";
    let reason = parse_mmcif_structure(unreadable).unwrap_err().to_string();
    assert!(!reason.is_empty());
    assert_eq!(dispatch_bio_rpc("structure_chain_sequences", json!({ "text": unreadable })), Err(reason));
}

/// The code each residue carries reaches the app through `parse_structure`.
#[test]
fn parse_structure_gives_each_residue_its_code() {
    let s = rpc("parse_structure", json!({ "text": cif_fixture() }));
    let residues: Vec<&Value> =
        s["models"][0]["chains"].as_array().unwrap().iter().flat_map(|c| c["residues"].as_array().unwrap()).collect();
    let coded: Vec<(&str, &Value, &Value)> =
        residues.iter().map(|r| (r["resName"].as_str().unwrap(), &r["code"], &r["modified"])).collect();
    assert_eq!(
        coded,
        [
            ("MSE", &json!("M"), &json!(true)),
            ("LYS", &json!("K"), &json!(false)),
            ("SEP", &json!("S"), &json!(true)),
            ("VAL", &json!("V"), &json!(false)),
            ("CA", &Value::Null, &json!(false)),
        ]
    );
}
