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

use molbiocraft_formats::pdb_mmcif::{parse_mmcif_structure, parse_pdb_structure};
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

    a_microheterogeneous_position_reads_as_one_letter();
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

/// One residue number modelled as two residue types under alternate ids (microheterogeneity):
/// the full-atom model keeps both residues, but a sequence reads one letter for the run (D0211):
/// residues listed one after another at one (number, insertion code), each carrying alternate
/// ids, read as the residue whose atoms carry alt id A, else the first listed, which is the
/// residue the PDB C-alpha view keeps (it takes alt id A or blank). Wrong implementations, and
/// the case that catches each:
/// - a letter per residue rather than per run: ARG 2 alt A, LYS 2 alt B reads ARKG;
/// - alt id A not kept (the last-listed residue kept, say): it reads AKG;
/// - `modified` read from every residue rather than from the residue kept: an MSE listed second
///   at a position appears in `modified` though its letter is not in the sequence;
/// - a position keyed by the number alone: GLY 3 and SER 3A (an insertion) merge into one letter.
fn alt_pdb_atom(serial: usize, alt: char, res: &str, seq: i32, ins: char, x: f64) -> String {
    let mut line = atom("ATOM", serial, " CA", res, seq, x, "C").into_bytes();
    line[16] = alt as u8;
    line[26] = ins as u8;
    String::from_utf8(line).unwrap()
}

fn microheterogeneous_pdb(second: (&str, &str)) -> String {
    let mut out = String::from("HEADER    SYNTHETIC\n");
    out.push_str(&alt_pdb_atom(1, ' ', "ALA", 1, ' ', 0.0));
    out.push_str(&alt_pdb_atom(2, 'A', second.0, 2, ' ', 3.8));
    out.push_str(&alt_pdb_atom(3, 'B', second.1, 2, ' ', 3.9));
    out.push_str(&alt_pdb_atom(4, ' ', "GLY", 3, ' ', 7.6));
    out.push_str("END\n");
    out
}

fn microheterogeneous_cif(second: (&str, &str)) -> String {
    let header = CIF_HEADER.replace("_atom_site.label_atom_id\n", "_atom_site.label_atom_id\n_atom_site.label_alt_id\n");
    let mut out = header;
    let rows = [("ALA", "."), (second.0, "A"), (second.1, "B"), ("GLY", ".")];
    for (k, (res, alt)) in rows.iter().enumerate() {
        let seq = [1, 2, 2, 3][k];
        let group = if matches!(*res, "MSE" | "SEP") { "HETATM" } else { "ATOM" };
        out.push_str(&format!("{group} {} C CA {alt} {res} A {seq} A {seq} {k}.000 1.000 2.000\n", k + 1));
    }
    out
}

/// Part of US-01M6VFMX AC4 (also called from
/// [`chain_sequences_read_parents_nucleic_chains_and_no_ions`], which its Verify line runs), and
/// of BG-01M7Q1X2 AC3, whose Verify line runs every test named `microheterogeneous`.
#[test]
fn a_microheterogeneous_position_reads_as_one_letter() {
    let one = |seq: &str, mods: &[(&str, i32, &str)]| {
        json!({ "chains": [chain("A", "Protein", seq, 1, mods)], "skipped": [], "warnings": [] })
    };
    for (what, text) in [("PDB", microheterogeneous_pdb(("ARG", "LYS"))), ("mmCIF", microheterogeneous_cif(("ARG", "LYS")))] {
        assert_eq!(sequences(text), one("ARG", &[]), "{what}: ARG 2 alt A, LYS 2 alt B");
    }
    // The sequence and the PDB C-alpha view of one file agree in length.
    let atoms = rpc("parse_pdb_ca", json!({ "pdbText": microheterogeneous_pdb(("ARG", "LYS")) }));
    let names: Vec<&str> = atoms.as_array().unwrap().iter().map(|a| a["resName"].as_str().unwrap()).collect();
    assert_eq!(names, ["ALA", "ARG", "GLY"]);

    // `modified` follows the residue kept.
    for (what, text) in [("PDB", microheterogeneous_pdb(("ARG", "MSE"))), ("mmCIF", microheterogeneous_cif(("ARG", "MSE")))] {
        assert_eq!(sequences(text), one("ARG", &[]), "{what}: ARG 2 alt A, MSE 2 alt B");
    }
    for (what, text) in [("PDB", microheterogeneous_pdb(("SEP", "LYS"))), ("mmCIF", microheterogeneous_cif(("SEP", "LYS")))] {
        assert_eq!(sequences(text), one("ASG", &[("SEP", 2, "S")]), "{what}: SEP 2 alt A, LYS 2 alt B");
    }

    // An insertion code is its own position: GLY 3 and SER 3A are two letters.
    let mut inserted = microheterogeneous_pdb(("ARG", "LYS")).replace("END\n", "");
    inserted.push_str(&alt_pdb_atom(5, ' ', "SER", 3, 'A', 11.4));
    inserted.push_str("END\n");
    assert_eq!(sequences(inserted), one("ARGS", &[]), "GLY 3 and SER 3A");
}

// ─── BG-01M7Q1X2: D0211, which residues sharing a number a sequence keeps ───

/// A PDB C-alpha line with an alternate id, a chain column (`' '` for a blank chain), a residue
/// number and an x coordinate.
fn ca_line(serial: usize, alt: char, res: &str, chain: char, seq: i32, x: f64) -> String {
    let mut line = atom("ATOM", serial, " CA", res, seq, x, "C").into_bytes();
    line[16] = alt as u8;
    line[21] = chain as u8;
    String::from_utf8(line).unwrap()
}

/// PDB text from (alt id, residue, number) rows of one blank chain, with `TER` after the row
/// `ter_after` names (if any).
fn blank_chain_pdb(rows: &[(char, &str, i32)], ter_after: Option<usize>) -> String {
    let mut out = String::from("HEADER    SYNTHETIC\n");
    for (k, (alt, res, seq)) in rows.iter().enumerate() {
        out.push_str(&ca_line(k + 1, *alt, res, ' ', *seq, 3.8 * k as f64));
        if ter_after == Some(k) {
            out.push_str("TER\n");
        }
    }
    out.push_str("END\n");
    out
}

/// mmCIF text, with `label_alt_id`, from (alt id, residue, number) rows of chain A ('.' for no alt
/// id); the label and author numbers are the row's number.
fn alt_cif(rows: &[(&str, &str, i32)]) -> String {
    let mut out = CIF_HEADER.replace("_atom_site.label_atom_id\n", "_atom_site.label_atom_id\n_atom_site.label_alt_id\n");
    for (k, (alt, res, seq)) in rows.iter().enumerate() {
        out.push_str(&format!("ATOM {} C CA {alt} {res} A {seq} A {seq} {k}.000 1.000 2.000\n", k + 1));
    }
    out
}

fn c_alpha_names(text: String) -> Vec<String> {
    let atoms = rpc("parse_pdb_ca", json!({ "pdbText": text }));
    atoms.as_array().unwrap().iter().map(|a| a["resName"].as_str().unwrap().to_string()).collect()
}

fn protein_a(sequence: &str, first: i32) -> Value {
    json!({ "chains": [chain("A", "Protein", sequence, first, &[])], "skipped": [], "warnings": [] })
}

/// AC1 (D0211): numbering that restarts under one chain id is not microheterogeneity, so every
/// residue is read. Wrong implementations, and the case that catches each:
/// - a position kept once per chain (the round-2 rule): ALA 1, GLY 2, SER 1, THR 2 reads AG;
/// - `TER` read as ending the chain's sequence: the TER case reads AG;
/// - residues dropped for sharing a number with the residue before them, alternate ids or not:
///   ALA 1, SER 1 listed one after the other reads A.
#[test]
fn a_restarted_numbering_keeps_every_residue() {
    let rows = [(' ', "ALA", 1), (' ', "GLY", 2), (' ', "SER", 1), (' ', "THR", 2)];
    for (what, ter) in [("no TER", None), ("TER after GLY 2", Some(1))] {
        let text = blank_chain_pdb(&rows, ter);
        assert_eq!(sequences(text.clone()), protein_a("AGST", 1), "{what}");
        assert_eq!(c_alpha_names(text), ["ALA", "GLY", "SER", "THR"], "{what}");
    }
    // Two residues at one number, one after the other, with no alternate ids: both are read.
    let adjacent = blank_chain_pdb(&[(' ', "ALA", 1), (' ', "SER", 1), (' ', "GLY", 2)], None);
    assert_eq!(sequences(adjacent.clone()), protein_a("ASG", 1), "ALA 1, SER 1, GLY 2, no alt ids");
    assert_eq!(c_alpha_names(adjacent), ["ALA", "SER", "GLY"]);
    let adjacent_cif = alt_cif(&[(".", "ALA", 1), (".", "SER", 1), (".", "GLY", 2)]);
    assert_eq!(sequences(adjacent_cif), protein_a("ASG", 1), "mmCIF ALA 1, SER 1, GLY 2, no alt ids");
}

/// AC2 (D0211): a restarted number whose residue has alternate conformers keeps its residue, as
/// the PDB C-alpha view keeps its alt-A atom. Wrong implementation, and the case that catches it:
/// - an alternate-id residue dropped at any number an earlier residue of the chain took (the
///   `!has_alt || positions.insert` rule): ALA 1 (A/B), GLY 2, SER 1 (A/B) reads AG against 3
///   C-alpha atoms.
#[test]
fn a_restarted_number_with_alternate_conformers_keeps_its_residue() {
    let rows = [('A', "ALA", 1), ('B', "ALA", 1), (' ', "GLY", 2), ('A', "SER", 1), ('B', "SER", 1)];
    let text = blank_chain_pdb(&rows, None);
    assert_eq!(sequences(text.clone()), protein_a("AGS", 1), "PDB");
    assert_eq!(c_alpha_names(text), ["ALA", "GLY", "SER"]);
    let cif_rows = [("A", "ALA", 1), ("B", "ALA", 1), (".", "GLY", 2), ("A", "SER", 1), ("B", "SER", 1)];
    assert_eq!(sequences(alt_cif(&cif_rows)), protein_a("AGS", 1), "mmCIF");

    // Residues with alternate conformers one after another at different numbers are a run of
    // nothing: ALA 1 (A/B), GLY 2 (A/B) reads AG, not A.
    let consecutive = blank_chain_pdb(&[('A', "ALA", 1), ('B', "ALA", 1), ('A', "GLY", 2), ('B', "GLY", 2)], None);
    assert_eq!(sequences(consecutive.clone()), protein_a("AG", 1), "ALA 1 (A/B), GLY 2 (A/B)");
    assert_eq!(c_alpha_names(consecutive), ["ALA", "GLY"]);
}

/// AC3 (D0211): within a microheterogeneous run the residue with alt id A is read, wherever it is
/// listed, else the first listed. Wrong implementations, and the case that catches each:
/// - the first-listed residue kept: LYS 2 alt B listed before ARG 2 alt A reads AKG, and the
///   sequence disagrees with the PDB C-alpha view (ALA1 ARG2 GLY3);
/// - `modified` read from a residue not kept: MSE 2 alt B before ARG 2 alt A lists MSE;
/// - `modified` not read from the alt-A residue: LYS 2 alt B before SEP 2 alt A must list SEP 2 S;
/// - no fallback when no residue of the run has alt id A: alt B, alt C reads both letters;
/// - a run that needs alternate ids on one residue only: ARG 2 alt A next to a LYS 2 with none
///   reads one letter, though the C-alpha view gives both;
/// - a run keyed by the number alone: GLY 3 alt A and SER 3A alt A read one letter.
#[test]
fn a_microheterogeneous_position_keeps_its_alt_a_residue_wherever_listed() {
    let pdb = |b: &str, a: &str| blank_chain_pdb(&[(' ', "ALA", 1), ('B', b, 2), ('A', a, 2), (' ', "GLY", 3)], None);
    let cif = |b: &str, a: &str| alt_cif(&[(".", "ALA", 1), ("B", b, 2), ("A", a, 2), (".", "GLY", 3)]);
    for (what, text) in [("PDB", pdb("LYS", "ARG")), ("mmCIF", cif("LYS", "ARG"))] {
        assert_eq!(sequences(text), protein_a("ARG", 1), "{what}: LYS 2 alt B, then ARG 2 alt A");
    }
    let names = c_alpha_names(pdb("LYS", "ARG"));
    assert_eq!(names, ["ALA", "ARG", "GLY"]);
    let atoms = rpc("parse_pdb_ca", json!({ "pdbText": pdb("LYS", "ARG") }));
    let numbers: Vec<i64> = atoms.as_array().unwrap().iter().map(|a| a["resSeq"].as_i64().unwrap()).collect();
    assert_eq!(numbers, [1, 2, 3]);

    for (what, text) in [("PDB", pdb("MSE", "ARG")), ("mmCIF", cif("MSE", "ARG"))] {
        assert_eq!(sequences(text), protein_a("ARG", 1), "{what}: MSE 2 alt B, then ARG 2 alt A");
    }
    let sep = json!({ "chains": [chain("A", "Protein", "ASG", 1, &[("SEP", 2, "S")])], "skipped": [], "warnings": [] });
    for (what, text) in [("PDB", pdb("LYS", "SEP")), ("mmCIF", cif("LYS", "SEP"))] {
        assert_eq!(sequences(text), sep, "{what}: LYS 2 alt B, then SEP 2 alt A");
    }

    // A run of three, alt A listed last; and a run with no alt id A, read from the first listed.
    let three = blank_chain_pdb(&[('B', "LYS", 1), ('C', "SER", 1), ('A', "ARG", 1), (' ', "GLY", 2)], None);
    assert_eq!(sequences(three), protein_a("RG", 1), "LYS 1 alt B, SER 1 alt C, ARG 1 alt A");
    let no_a = blank_chain_pdb(&[(' ', "ALA", 1), ('B', "LYS", 2), ('C', "ARG", 2), (' ', "GLY", 3)], None);
    assert_eq!(sequences(no_a), protein_a("AKG", 1), "LYS 2 alt B, then ARG 2 alt C");

    // A run needs alternate ids on both residues: either order of ARG 2 alt A and a LYS 2 with
    // none reads both, as the C-alpha view gives both.
    for (rows, read) in [
        ([(' ', "ALA", 1), ('A', "ARG", 2), (' ', "LYS", 2), (' ', "GLY", 3)], "ARKG"),
        ([(' ', "ALA", 1), (' ', "LYS", 2), ('A', "ARG", 2), (' ', "GLY", 3)], "AKRG"),
    ] {
        let text = blank_chain_pdb(&rows, None);
        assert_eq!(sequences(text.clone()), protein_a(read, 1), "{read}");
        assert_eq!(c_alpha_names(text).len(), 4, "{read}");
    }

    // An insertion code is its own position, alternate ids or not: GLY 3 alt A, SER 3A alt A.
    let mut inserted = String::from("HEADER    SYNTHETIC\n");
    inserted.push_str(&alt_pdb_atom(1, ' ', "ALA", 1, ' ', 0.0));
    inserted.push_str(&alt_pdb_atom(2, 'A', "GLY", 3, ' ', 3.8));
    inserted.push_str(&alt_pdb_atom(3, 'A', "SER", 3, 'A', 7.6));
    inserted.push_str("END\n");
    assert_eq!(sequences(inserted), protein_a("AGS", 1), "GLY 3 alt A, SER 3A alt A");
}

/// AC10 (folded from BG-01M7Q015): the first model, the blank chain, and the molecule ties.
/// Wrong implementations, and the case that catches each:
/// - every model read: the two-model file gives chain A twice (or model 2's residues);
/// - a blank chain id passed through: it reads "" rather than A;
/// - an amino acid in a nucleic-acid chain read by its code, or silently: DA DC DG ALA must read
///   ACGN with the ALA4 sentence;
/// - the Protein tie broken toward nucleic acid (`>` for `>=`): ALA GLY DA DC reads as DNA;
/// - the DNA/RNA tie broken toward DNA (`>=` for `>`): DA DC G U reads as DNA.
#[test]
fn chain_sequences_pin_model_chain_and_tie_rules() {
    let model = |n: usize, res: [&str; 2]| {
        format!("MODEL     {n:>4}\n{}{}ENDMDL\n", ca_line(1, ' ', res[0], 'A', 1, 0.0), ca_line(2, ' ', res[1], 'A', 2, 3.8))
    };
    let two_models = format!("HEADER    SYNTHETIC\n{}{}END\n", model(1, ["GLY", "ALA"]), model(2, ["SER", "THR"]));
    assert_eq!(sequences(two_models), protein_a("GA", 1), "two models");

    let blank = blank_chain_pdb(&[(' ', "MET", 1), (' ', "LYS", 2)], None);
    assert!(blank.lines().nth(1).is_some_and(|l| &l[21..22] == " "), "{blank}");
    assert_eq!(sequences(blank)["chains"][0]["chainId"], json!("A"), "a blank chain reads A");

    let nucleic = |chain_id: &str, residues: &[&str]| -> Vec<(&'static str, &'static str, &'static str, String, String, String, i32)> {
        residues
            .iter()
            .enumerate()
            .map(|(k, r)| ("ATOM", "P", "P", r.to_string(), chain_id.to_string(), (k + 1).to_string(), k as i32 + 1))
            .collect()
    };
    let text = |rows: Vec<(&str, &str, &str, String, String, String, i32)>| {
        let rows: Vec<(&str, &str, &str, &str, &str, &str, i32)> =
            rows.iter().map(|r| (r.0, r.1, r.2, r.3.as_str(), r.4.as_str(), r.5.as_str(), r.6)).collect();
        cif(&rows)
    };
    assert_eq!(
        sequences(text(nucleic("B", &["DA", "DC", "DG", "ALA"]))),
        json!({
            "chains": [chain("B", "DNA", "ACGN", 1, &[])],
            "skipped": [],
            "warnings": ["Residue ALA4 in chain B is an amino acid in a nucleic-acid chain: read as N."]
        })
    );
    assert_eq!(
        sequences(text(nucleic("A", &["ALA", "GLY", "DA", "DC"]))),
        json!({
            "chains": [chain("A", "Protein", "AGXX", 1, &[])],
            "skipped": [],
            "warnings": [
                "Residue DA3 in chain A is a nucleotide in a protein chain: read as X.",
                "Residue DC4 in chain A is a nucleotide in a protein chain: read as X."
            ]
        })
    );
    assert_eq!(
        sequences(text(nucleic("A", &["DA", "DC", "G", "U"]))),
        json!({ "chains": [chain("A", "RNA", "ACGU", 1, &[])], "skipped": [], "warnings": [] })
    );
}

/// PDB text of one blank chain from (alt id, residue, number, atom names) rows, one `ATOM` line
/// per atom name, with `TER` after the row `ter_after` names (if any).
fn blank_chain_atoms(rows: &[(char, &str, i32, &[&str])], ter_after: Option<usize>) -> String {
    let mut out = String::from("HEADER    SYNTHETIC\n");
    let mut serial = 0;
    for (k, (alt, res, seq, names)) in rows.iter().enumerate() {
        for name in names.iter() {
            serial += 1;
            let mut line = atom("ATOM", serial, name, res, *seq, 1.5 * serial as f64, &name.trim()[..1]).into_bytes();
            line[16] = *alt as u8;
            line[21] = b' ';
            out.push_str(std::str::from_utf8(&line).unwrap());
        }
        if ter_after == Some(k) {
            out.push_str("TER\n");
        }
    }
    out.push_str("END\n");
    out
}

/// The chains of a structure's first model: each chain's label id and its residues, each as
/// (residue name, atom names).
fn chains_of(s: Value) -> Vec<(String, Vec<(String, Vec<String>)>)> {
    let str_of = |v: &Value| v.as_str().unwrap().to_string();
    s["models"][0]["chains"]
        .as_array()
        .unwrap()
        .iter()
        .map(|c| {
            let residues = c["residues"]
                .as_array()
                .unwrap()
                .iter()
                .map(|r| (str_of(&r["resName"]), r["atoms"].as_array().unwrap().iter().map(|a| str_of(&a["name"])).collect()))
                .collect();
            (str_of(&c["labelAsymId"]), residues)
        })
        .collect()
}

/// PDB text through the PDB model reader (D0285: the `parse_structure` op reads mmCIF only).
fn pdb_model(text: &str) -> Vec<(String, Vec<(String, Vec<String>)>)> {
    chains_of(serde_json::to_value(parse_pdb_structure(text).unwrap()).unwrap())
}

/// mmCIF text through the `parse_structure` op.
fn cif_model(text: &str) -> Vec<(String, Vec<(String, Vec<String>)>)> {
    chains_of(rpc("parse_structure", json!({ "text": text })))
}

const BACKBONE: &[&str] = &[" N", " CA", " C", " O"];

/// BG-01M7QC16 AC1 (D0285): numbering that restarts and repeats a residue's name and number
/// (ALA 1, GLY 2, ALA 1, GLY 2, as modelling and MD output write it) is four residues, not two: a
/// residue key seen earlier in the chain names the earlier residue only while every residue listed
/// since is at that same position. The PDB model is read by `parse_pdb_structure`, the mmCIF one
/// by the `parse_structure` op, the sequence and C-alpha views through the dispatcher. Wrong implementations, and the case that catches each:
/// - residues merged by key alone (the reader before this fix): two residues, AG;
/// - a new residue only after `TER`: the no-TER case reads AG;
/// - a repeated key never rejoining its residue: an interleaved microheterogeneous position (PRO
///   22 alt A and SER 22 alt B, row by row) reads as four residues rather than two;
/// - conformers listed back to back split: ALA 3 with CA alt A, CA alt B, or whole-residue alt A
///   then alt B, is no longer one residue.
#[test]
fn a_restart_repeating_name_and_number_keeps_both_residues() {
    let restart: [(char, &str, i32, &[&str]); 4] =
        [(' ', "ALA", 1, BACKBONE), (' ', "GLY", 2, BACKBONE), (' ', "ALA", 1, BACKBONE), (' ', "GLY", 2, BACKBONE)];
    let backbone = || BACKBONE.iter().map(|n| n.trim().to_string()).collect::<Vec<_>>();
    for (what, ter) in [("no TER", None), ("TER after GLY 2", Some(1))] {
        let text = blank_chain_atoms(&restart, ter);
        let chains = pdb_model(&text);
        // The one blank chain: the model keeps its id blank, the sequence view names it A.
        assert_eq!(chains.iter().map(|c| c.0.as_str()).collect::<Vec<_>>(), [""], "{what}: one blank chain");
        let read: Vec<(&str, &Vec<String>)> = chains[0].1.iter().map(|(n, a)| (n.as_str(), a)).collect();
        let b = backbone();
        assert_eq!(read, [("ALA", &b), ("GLY", &b), ("ALA", &b), ("GLY", &b)], "{what}: the PDB model");
        assert_eq!(sequences(text.clone()), protein_a("AGAG", 1), "{what}: chain A reads AGAG, no warnings");
        assert_eq!(c_alpha_names(text), ["ALA", "GLY", "ALA", "GLY"], "{what}: parse_pdb_ca");
    }
    // mmCIF whose label and author numbers both restart is read the same way.
    let cif = alt_cif(&[(".", "ALA", 1), (".", "GLY", 2), (".", "ALA", 1), (".", "GLY", 2)]);
    assert_eq!(cif_model(&cif)[0].1.len(), 4, "mmCIF through parse_structure: four residues");
    assert_eq!(sequences(cif), protein_a("AGAG", 1), "mmCIF");

    // Conformers listed back to back stay one residue: per atom (CA alt A, CA alt B) and per
    // residue (ALA 3 alt A's backbone, then alt B's).
    let per_atom = blank_chain_atoms(
        &[(' ', "GLY", 2, &[" N"]), ('A', "ALA", 3, &[" CA"]), ('B', "ALA", 3, &[" CA"]), (' ', "ALA", 3, &[" C", " O"])],
        None,
    );
    let read: Vec<(String, Vec<String>)> = pdb_model(&per_atom).remove(0).1;
    assert_eq!(read.len(), 2, "per-atom conformers: {read:?}");
    assert_eq!(read[1], ("ALA".to_string(), vec!["CA".to_string(), "C".to_string(), "O".to_string()]));
    let per_residue = blank_chain_atoms(&[(' ', "GLY", 2, BACKBONE), ('A', "ALA", 3, BACKBONE), ('B', "ALA", 3, BACKBONE)], None);
    let read = pdb_model(&per_residue).remove(0).1;
    assert_eq!(read.iter().map(|(n, a)| (n.as_str(), a.len())).collect::<Vec<_>>(), [("GLY", 4), ("ALA", 4)], "per residue");
    assert_eq!(sequences(per_residue), protein_a("GA", 2), "per residue");

    // An interleaved microheterogeneous position keeps one residue per type.
    let interleaved = blank_chain_atoms(
        &[
            (' ', "GLY", 21, BACKBONE),
            ('A', "PRO", 22, &[" N"]),
            ('B', "SER", 22, &[" N"]),
            ('A', "PRO", 22, &[" CA"]),
            ('B', "SER", 22, &[" CA"]),
            (' ', "GLY", 23, BACKBONE),
        ],
        None,
    );
    let read = pdb_model(&interleaved).remove(0).1;
    let shape: Vec<(&str, usize)> = read.iter().map(|(n, a)| (n.as_str(), a.len())).collect();
    assert_eq!(shape, [("GLY", 4), ("PRO", 2), ("SER", 2), ("GLY", 4)], "interleaved PRO/SER 22");
    assert_eq!(sequences(interleaved), protein_a("GPG", 21), "the run reads its alt-A residue");

    // A restart onto an interleaved site: the restarted ALA 1 is the residue its later rows rejoin.
    let restart_site = blank_chain_atoms(
        &[
            (' ', "ALA", 1, BACKBONE),
            (' ', "GLY", 2, BACKBONE),
            ('A', "ALA", 1, &[" N"]),
            ('B', "SER", 1, &[" N"]),
            ('A', "ALA", 1, &[" CA"]),
            ('B', "SER", 1, &[" CA"]),
        ],
        None,
    );
    let read = pdb_model(&restart_site).remove(0).1;
    let shape: Vec<(&str, usize)> = read.iter().map(|(n, a)| (n.as_str(), a.len())).collect();
    assert_eq!(shape, [("ALA", 4), ("GLY", 4), ("ALA", 2), ("SER", 2)], "restart onto an interleaved site");

    // A residue at the position among those listed since does not make it one site: ALA 1, GLY 2,
    // SER 1, ALA 1 is four residues.
    let through = blank_chain_atoms(
        &[(' ', "ALA", 1, BACKBONE), (' ', "GLY", 2, BACKBONE), (' ', "SER", 1, BACKBONE), (' ', "ALA", 1, BACKBONE)],
        None,
    );
    let names: Vec<String> = pdb_model(&through).remove(0).1.into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, ["ALA", "GLY", "SER", "ALA"], "ALA 1, GLY 2, SER 1, ALA 1");
    assert_eq!(sequences(through), protein_a("AGSA", 1), "ALA 1, GLY 2, SER 1, ALA 1");

    // An insertion code is a position of its own: GLY 1, SER 1A, GLY 1 is a restart.
    let mut inserted = String::from("HEADER    SYNTHETIC\n");
    inserted.push_str(&alt_pdb_atom(1, ' ', "GLY", 1, ' ', 0.0));
    inserted.push_str(&alt_pdb_atom(2, ' ', "SER", 1, 'A', 3.8));
    inserted.push_str(&alt_pdb_atom(3, ' ', "GLY", 1, ' ', 7.6));
    inserted.push_str("END\n");
    let names: Vec<String> = pdb_model(&inserted).remove(0).1.into_iter().map(|(n, _)| n).collect();
    assert_eq!(names, ["GLY", "SER", "GLY"], "GLY 1, SER 1A, GLY 1");
}
