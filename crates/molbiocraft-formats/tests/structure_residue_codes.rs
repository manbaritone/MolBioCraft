// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VFMX AC1 and AC2: the one residue table a structure is read by, and the code each
//! residue of a parsed structure carries from it. Wrong implementations, and the case that
//! catches each:
//! - a table of the 19 parents biophysics_3d.rs held, without NLE and ORN: both are listed;
//! - SEC and PYL read as modified cysteine and lysine, or as X: they are U and O, unmodified;
//! - a nucleic table that drops a modified base, or reads DA as RNA or A as DNA: every entry is
//!   checked with its molecule;
//! - `one_to_three_aa` still giving UNK for U and O;
//! - a residue code given to a water or an ion (a Ca2+ named CA, which the 20-letter reader would
//!   take for nothing but whose atom is named like a C-alpha), or withheld from a polymer residue
//!   the table lacks: HOH and CA must be null and a polymer XYZ must be X, in both formats.

use molbiocraft_formats::pdb_mmcif::{
    one_to_three_aa, parse_mmcif_structure, parse_pdb_structure, residue_code_of, PolymerMolecule, ResidueCode,
    Structure, StructureResidue,
};
use serde_json::Value;

/// Biopython 1.88 `Bio.Data.PDBData.protein_letters_3to1_extended`, for the modified amino acids
/// the story names, as the story transcribes them (each is the parent its wwPDB CCD entry gives in
/// `mon_nstd_parent_comp_id`).
const MODIFIED_PROTEIN: [(&str, char); 21] = [
    ("MSE", 'M'),
    ("FME", 'M'),
    ("MHO", 'M'),
    ("SEP", 'S'),
    ("TPO", 'T'),
    ("PTR", 'Y'),
    ("TYS", 'Y'),
    ("CSO", 'C'),
    ("CSD", 'C'),
    ("CME", 'C'),
    ("OCS", 'C'),
    ("HYP", 'P'),
    ("PCA", 'Q'),
    ("CGU", 'E'),
    ("MLY", 'K'),
    ("M3L", 'K'),
    ("ALY", 'K'),
    ("KCX", 'K'),
    ("LLP", 'K'),
    ("NLE", 'L'),
    ("ORN", 'A'),
];

const STANDARD_PROTEIN: [(&str, char); 20] = [
    ("ALA", 'A'),
    ("ARG", 'R'),
    ("ASN", 'N'),
    ("ASP", 'D'),
    ("CYS", 'C'),
    ("GLN", 'Q'),
    ("GLU", 'E'),
    ("GLY", 'G'),
    ("HIS", 'H'),
    ("ILE", 'I'),
    ("LEU", 'L'),
    ("LYS", 'K'),
    ("MET", 'M'),
    ("PHE", 'F'),
    ("PRO", 'P'),
    ("SER", 'S'),
    ("THR", 'T'),
    ("TRP", 'W'),
    ("TYR", 'Y'),
    ("VAL", 'V'),
];

/// `nucleic_letters_3to1_extended`, for the modified nucleotides the story names: all six are
/// ribonucleotides.
const MODIFIED_NUCLEIC: [(&str, char); 6] =
    [("PSU", 'U'), ("5MC", 'C'), ("1MA", 'A'), ("2MG", 'G'), ("H2U", 'U'), ("OMC", 'C')];

fn entry(code: char, molecule: PolymerMolecule, modified: bool) -> Option<ResidueCode> {
    Some(ResidueCode { code, molecule, modified })
}

#[test]
fn ccd_tables_match_biopython_pdbdata() {
    for (name, code) in MODIFIED_PROTEIN {
        assert_eq!(residue_code_of(name), entry(code, PolymerMolecule::Protein, true), "{name}");
    }
    for (name, code) in STANDARD_PROTEIN {
        assert_eq!(residue_code_of(name), entry(code, PolymerMolecule::Protein, false), "{name}");
    }
    // Residues of their own (INSDC 7.4.3), not modified cysteine or lysine.
    assert_eq!(residue_code_of("SEC"), entry('U', PolymerMolecule::Protein, false));
    assert_eq!(residue_code_of("PYL"), entry('O', PolymerMolecule::Protein, false));
    for (name, code) in MODIFIED_NUCLEIC {
        assert_eq!(residue_code_of(name), entry(code, PolymerMolecule::Rna, true), "{name}");
    }
    for (name, code) in [("DA", 'A'), ("DC", 'C'), ("DG", 'G'), ("DT", 'T')] {
        assert_eq!(residue_code_of(name), entry(code, PolymerMolecule::Dna, false), "{name}");
    }
    for (name, code) in [("A", 'A'), ("C", 'C'), ("G", 'G'), ("U", 'U')] {
        assert_eq!(residue_code_of(name), entry(code, PolymerMolecule::Rna, false), "{name}");
    }
    // A residue name is read as the file writes it, padded or not.
    assert_eq!(residue_code_of(" MSE "), entry('M', PolymerMolecule::Protein, true));
    // Not in the table: a ligand, a water, an ion, an unknown polymer residue.
    for name in ["XYZ", "HOH", "CA", "NAG", "UNK", "DU", ""] {
        assert_eq!(residue_code_of(name), None, "{name}");
    }
    assert_eq!(one_to_three_aa(b'U'), "SEC");
    assert_eq!(one_to_three_aa(b'O'), "PYL");
    assert_eq!(one_to_three_aa(b'M'), "MET");
    assert_eq!(one_to_three_aa(b'X'), "UNK");
}

const CIF: &str = "data_T
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
HETATM 1 C CA MSE A 1 A 1 0.000 0.000 0.000
ATOM 2 C CA LYS A 2 A 2 3.800 0.000 0.000
ATOM 3 C CA XYZ A 3 A 3 7.600 0.000 0.000
HETATM 4 CA CA CA B . A 101 1.000 1.000 1.000
HETATM 5 O O HOH C . A 201 2.000 2.000 2.000
";

fn pdb_line(record: &str, serial: usize, name: &str, res: &str, seq: i32, x: f64, element: &str) -> String {
    format!("{record:<6}{serial:>5} {name:<4} {res:>3} A{seq:>4}    {x:>8.3}{:>8.3}{:>8.3}  1.00 20.00          {element:>2}\n", 0.0, 0.0)
}

fn residue<'a>(s: &'a Structure, name: &str) -> &'a StructureResidue {
    s.models[0].chains.iter().flat_map(|c| &c.residues).find(|r| r.res_name == name).expect(name)
}

/// The code and modified flag of a residue, as `parse_structure` serialises them.
fn coded(s: &Structure, name: &str) -> (Value, Value) {
    let v = serde_json::to_value(residue(s, name)).unwrap();
    (v["code"].clone(), v["modified"].clone())
}

#[test]
fn structure_residues_carry_their_code() {
    let pdb = [
        pdb_line("HETATM", 1, " CA", "MSE", 1, 0.0, "C"),
        pdb_line("ATOM", 2, " CA", "LYS", 2, 3.8, "C"),
        pdb_line("ATOM", 3, " CA", "XYZ", 3, 7.6, "C"),
        pdb_line("HETATM", 4, "CA", "CA", 101, 1.0, "CA"),
        pdb_line("HETATM", 5, " O", "HOH", 201, 2.0, "O"),
    ]
    .concat();
    let structures = [("mmCIF", parse_mmcif_structure(CIF).unwrap()), ("PDB", parse_pdb_structure(&pdb).unwrap())];
    for (format, s) in &structures {
        assert_eq!(coded(s, "MSE"), (Value::from("M"), Value::from(true)), "{format}: MSE in the polymer");
        assert_eq!(coded(s, "LYS"), (Value::from("K"), Value::from(false)), "{format}");
        assert_eq!(coded(s, "XYZ"), (Value::from("X"), Value::from(false)), "{format}: a polymer residue the table lacks");
        assert_eq!(coded(s, "HOH"), (Value::Null, Value::from(false)), "{format}: a water");
        assert_eq!(coded(s, "CA"), (Value::Null, Value::from(false)), "{format}: a calcium ion");
        assert_eq!(residue(s, "MSE").code, Some('M'), "{format}");
        assert!(residue(s, "MSE").modified, "{format}");
    }
    // A HETATM the table lacks is not a polymer residue in a PDB file, so it has no code; an
    // mmCIF one with a label_seq_id is, and reads as X.
    let ligand = pdb_line("HETATM", 1, " CA", "SAM", 501, 0.0, "C");
    assert_eq!(coded(&parse_pdb_structure(&ligand).unwrap(), "SAM"), (Value::Null, Value::from(false)));
}
