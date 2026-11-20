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
    one_to_three_aa, parse_mmcif_structure, parse_pdb_structure, residue_code_of, structure_chain_sequences,
    PolymerMolecule, ResidueCode, Structure, StructureResidue,
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

/// BG-01M7V0ZH: the modified nucleotides of yeast tRNA-Phe (RCSB 1EHZ) the table lacked, and the
/// parent each one's wwPDB Chemical Component Dictionary entry names in
/// `_chem_comp.mon_nstd_parent_comp_id` (read from https://files.rcsb.org/ligands/view/<ID>.cif
/// on 2026-11-20; each is `RNA LINKING`).
const MODIFIED_NUCLEIC_1EHZ: [(&str, char); 5] = [
    ("M2G", 'G'), // N2,N2-dimethylguanosine
    ("OMG", 'G'), // 2'-O-methylguanosine
    ("YYG", 'G'), // a modified guanosine (CCD synonym), at tRNA-Phe position 37
    ("7MG", 'G'), // 7-methylguanosine
    ("5MU", 'U'), // 5-methyluridine (ribothymidine)
];

#[test]
fn bg_01m7v0zh_ccd_parents_of_the_1ehz_modified_nucleotides() {
    for (name, code) in MODIFIED_NUCLEIC_1EHZ {
        assert_eq!(residue_code_of(name), entry(code, PolymerMolecule::Rna, true), "{name}");
    }
}

/// An excerpt of RCSB 1EHZ (https://files.rcsb.org/download/1EHZ.cif, retrieved 2026-11-20; PDB
/// data is CC0): its own `_atom_site` header, the C1' row of each of chain A's 76 nucleotides,
/// one magnesium ion and one water, rows as the file writes them.
const EHZ_EXCERPT: &str = r#"data_1EHZ
#
loop_
_atom_site.group_PDB
_atom_site.id
_atom_site.type_symbol
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.label_comp_id
_atom_site.label_asym_id
_atom_site.label_entity_id
_atom_site.label_seq_id
_atom_site.pdbx_PDB_ins_code
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.occupancy
_atom_site.B_iso_or_equiv
_atom_site.pdbx_formal_charge
_atom_site.auth_seq_id
_atom_site.auth_comp_id
_atom_site.auth_asym_id
_atom_site.auth_atom_id
_atom_site.pdbx_PDB_model_num
ATOM 13 C "C1'" . G A 1 1 ? 51.502 47.007 54.836 1.00 95.70 ? 1 G A "C1'" 1
ATOM 36 C "C1'" . C A 1 2 ? 57.022 45.836 55.356 1.00 90.59 ? 2 C A "C1'" 1
ATOM 56 C "C1'" . G A 1 3 ? 62.018 44.572 53.194 1.00 73.98 ? 3 G A "C1'" 1
ATOM 79 C "C1'" . G A 1 4 ? 65.192 43.241 49.051 1.00 58.29 ? 4 G A "C1'" 1
ATOM 102 C "C1'" . A A 1 5 ? 65.646 42.719 43.615 1.00 44.50 ? 5 A A "C1'" 1
ATOM 124 C "C1'" . U A 1 6 ? 64.413 45.113 39.057 1.00 41.32 ? 6 U A "C1'" 1
ATOM 144 C "C1'" . U A 1 7 ? 63.015 49.475 35.442 1.00 37.23 ? 7 U A "C1'" 1
ATOM 164 C "C1'" . U A 1 8 ? 68.407 51.830 29.255 1.00 30.28 ? 8 U A "C1'" 1
ATOM 184 C "C1'" . A A 1 9 ? 65.985 50.969 21.571 1.00 28.79 ? 9 A A "C1'" 1
HETATM 206 C "C1'" . 2MG A 1 10 ? 60.152 47.173 19.012 1.00 44.62 ? 10 2MG A "C1'" 1
ATOM 230 C "C1'" . C A 1 11 ? 62.189 42.294 22.230 1.00 48.88 ? 11 C A "C1'" 1
ATOM 250 C "C1'" . U A 1 12 ? 66.013 40.478 25.565 1.00 47.40 ? 12 U A "C1'" 1
ATOM 270 C "C1'" . C A 1 13 ? 69.909 42.919 28.054 1.00 39.03 ? 13 C A "C1'" 1
ATOM 290 C "C1'" . A A 1 14 ? 75.325 45.147 28.805 1.00 32.12 ? 14 A A "C1'" 1
ATOM 312 C "C1'" . G A 1 15 ? 76.941 49.779 30.686 1.00 33.07 ? 15 G A "C1'" 1
HETATM 333 C "C1'" . H2U A 1 16 ? 78.428 53.548 33.551 1.00 88.13 ? 16 H2U A "C1'" 1
HETATM 353 C "C1'" . H2U A 1 17 ? 86.102 56.903 36.958 1.00 71.64 ? 17 H2U A "C1'" 1
ATOM 375 C "C1'" . G A 1 18 ? 80.191 61.615 36.658 1.00 31.24 ? 18 G A "C1'" 1
ATOM 398 C "C1'" . G A 1 19 ? 81.965 63.912 30.283 1.00 31.26 ? 19 G A "C1'" 1
ATOM 421 C "C1'" . G A 1 20 ? 80.836 58.580 23.876 1.00 33.29 ? 20 G A "C1'" 1
ATOM 444 C "C1'" . A A 1 21 ? 74.304 56.666 24.955 1.00 30.28 ? 21 A A "C1'" 1
ATOM 466 C "C1'" . G A 1 22 ? 75.605 50.671 23.444 1.00 25.75 ? 22 G A "C1'" 1
ATOM 489 C "C1'" . A A 1 23 ? 75.210 45.010 21.771 1.00 37.98 ? 23 A A "C1'" 1
ATOM 511 C "C1'" . G A 1 24 ? 72.412 40.925 20.073 1.00 45.11 ? 24 G A "C1'" 1
ATOM 534 C "C1'" . C A 1 25 ? 67.844 39.818 17.685 1.00 51.93 ? 25 C A "C1'" 1
HETATM 554 C "C1'" . M2G A 1 26 ? 64.147 42.470 14.901 1.00 46.92 ? 26 M2G A "C1'" 1
ATOM 579 C "C1'" . C A 1 27 ? 63.159 46.064 10.787 1.00 48.68 ? 27 C A "C1'" 1
ATOM 599 C "C1'" . C A 1 28 ? 65.046 48.767 5.987 1.00 56.20 ? 28 C A "C1'" 1
ATOM 619 C "C1'" . A A 1 29 ? 69.196 48.789 2.509 1.00 59.63 ? 29 A A "C1'" 1
ATOM 641 C "C1'" . G A 1 30 ? 73.839 46.903 0.605 1.00 60.48 ? 30 G A "C1'" 1
ATOM 664 C "C1'" . A A 1 31 ? 76.518 42.403 -0.649 1.00 62.06 ? 31 A A "C1'" 1
HETATM 683 C "C1'" . OMC A 1 32 ? 75.756 37.560 -2.358 1.00 68.30 ? 32 OMC A "C1'" 1
ATOM 707 C "C1'" . U A 1 33 ? 72.289 33.769 -5.226 1.00 72.04 ? 33 U A "C1'" 1
HETATM 728 C "C1'" . OMG A 1 34 ? 68.999 31.433 -10.593 1.00 61.80 ? 34 OMG A "C1'" 1
ATOM 751 C "C1'" . A A 1 35 ? 66.202 32.251 -6.217 1.00 69.82 ? 35 A A "C1'" 1
ATOM 773 C "C1'" . A A 1 36 ? 67.143 31.833 -1.328 1.00 88.90 ? 36 A A "C1'" 1
HETATM 795 C "C1'" . YYG A 1 37 ? 68.645 30.761 3.410 1.00 93.08 ? 37 YYG A "C1'" 1
ATOM 834 C "C1'" . A A 1 38 ? 73.308 31.178 6.015 1.00 88.20 ? 38 A A "C1'" 1
HETATM 853 C "C1'" . PSU A 1 39 ? 77.325 34.455 6.488 1.00 79.85 ? 39 PSU A "C1'" 1
HETATM 876 C "C1'" . 5MC A 1 40 ? 79.168 39.648 6.065 1.00 67.58 ? 40 5MC A "C1'" 1
ATOM 897 C "C1'" . U A 1 41 ? 78.651 45.424 5.527 1.00 49.85 ? 41 U A "C1'" 1
ATOM 917 C "C1'" . G A 1 42 ? 75.657 49.688 6.671 1.00 49.13 ? 42 G A "C1'" 1
ATOM 940 C "C1'" . G A 1 43 ? 71.295 52.730 8.219 1.00 46.94 ? 43 G A "C1'" 1
ATOM 963 C "C1'" . A A 1 44 ? 67.208 53.996 10.887 1.00 54.14 ? 44 A A "C1'" 1
ATOM 985 C "C1'" . G A 1 45 ? 65.456 53.277 15.954 1.00 45.24 ? 45 G A "C1'" 1
HETATM 1008 C "C1'" . 7MG A 1 46 ? 65.949 56.384 22.900 1.00 39.69 ? 46 7MG A "C1'" 1
ATOM 1032 C "C1'" . U A 1 47 ? 60.798 60.075 28.167 1.00 50.55 ? 47 U A "C1'" 1
ATOM 1052 C "C1'" . C A 1 48 ? 68.291 55.799 30.245 1.00 27.98 ? 48 C A "C1'" 1
HETATM 1072 C "C1'" . 5MC A 1 49 ? 60.568 54.849 34.825 1.00 33.10 ? 49 5MC A "C1'" 1
ATOM 1093 C "C1'" . U A 1 50 ? 58.966 60.259 36.646 1.00 31.45 ? 50 U A "C1'" 1
ATOM 1113 C "C1'" . G A 1 51 ? 60.143 64.799 39.378 1.00 37.87 ? 51 G A "C1'" 1
ATOM 1136 C "C1'" . U A 1 52 ? 63.119 67.888 42.237 1.00 31.31 ? 52 U A "C1'" 1
ATOM 1156 C "C1'" . G A 1 53 ? 68.019 68.537 43.991 1.00 32.96 ? 53 G A "C1'" 1
HETATM 1177 C "C1'" . 5MU A 1 54 ? 73.711 68.026 44.082 1.00 37.46 ? 54 5MU A "C1'" 1
HETATM 1197 C "C1'" . PSU A 1 55 ? 77.461 69.118 40.100 1.00 34.24 ? 55 PSU A "C1'" 1
ATOM 1220 C "C1'" . C A 1 56 ? 81.174 72.955 35.333 1.00 33.49 ? 56 C A "C1'" 1
ATOM 1240 C "C1'" . G A 1 57 ? 78.571 68.404 33.655 1.00 32.37 ? 57 G A "C1'" 1
HETATM 1263 C "C1'" . 1MA A 1 58 ? 73.908 63.150 35.551 1.00 33.62 ? 58 1MA A "C1'" 1
ATOM 1286 C "C1'" . U A 1 59 ? 71.808 56.483 32.934 1.00 34.05 ? 59 U A "C1'" 1
ATOM 1306 C "C1'" . C A 1 60 ? 75.336 56.786 37.306 1.00 32.64 ? 60 C A "C1'" 1
ATOM 1326 C "C1'" . C A 1 61 ? 74.974 60.515 43.421 1.00 36.12 ? 61 C A "C1'" 1
ATOM 1346 C "C1'" . A A 1 62 ? 70.711 62.312 46.995 1.00 38.85 ? 62 A A "C1'" 1
ATOM 1368 C "C1'" . C A 1 63 ? 65.541 62.713 48.233 1.00 39.95 ? 63 C A "C1'" 1
ATOM 1388 C "C1'" . A A 1 64 ? 60.283 61.983 47.026 1.00 51.87 ? 64 A A "C1'" 1
ATOM 1410 C "C1'" . G A 1 65 ? 57.142 59.262 44.032 1.00 42.23 ? 65 G A "C1'" 1
ATOM 1433 C "C1'" . A A 1 66 ? 55.595 55.117 40.311 1.00 40.50 ? 66 A A "C1'" 1
ATOM 1455 C "C1'" . A A 1 67 ? 55.669 50.417 38.391 1.00 41.64 ? 67 A A "C1'" 1
ATOM 1477 C "C1'" . U A 1 68 ? 57.286 45.028 38.018 1.00 40.75 ? 68 U A "C1'" 1
ATOM 1497 C "C1'" . U A 1 69 ? 58.796 41.050 41.019 1.00 34.46 ? 69 U A "C1'" 1
ATOM 1517 C "C1'" . C A 1 70 ? 60.163 37.591 45.267 1.00 36.50 ? 70 C A "C1'" 1
ATOM 1537 C "C1'" . G A 1 71 ? 59.915 36.661 50.374 1.00 59.19 ? 71 G A "C1'" 1
ATOM 1560 C "C1'" . C A 1 72 ? 57.184 38.082 54.963 1.00 72.55 ? 72 C A "C1'" 1
ATOM 1580 C "C1'" . A A 1 73 ? 52.823 40.304 57.196 1.00 69.17 ? 73 A A "C1'" 1
ATOM 1602 C "C1'" . C A 1 74 ? 47.080 40.621 56.662 1.00 79.08 ? 74 C A "C1'" 1
ATOM 1622 C "C1'" . C A 1 75 ? 43.631 36.926 54.915 1.00 82.57 ? 75 C A "C1'" 1
ATOM 1642 C "C1'" . A A 1 76 ? 35.314 37.959 58.950 1.00 100.19 ? 76 A A "C1'" 1
HETATM 1653 MG MG . MG B 2 . ? 70.566 35.530 1.665 1.00 65.44 ? 590 MG A MG 1
HETATM 1662 O O . HOH K 4 . ? 65.235 47.736 24.306 1.00 29.97 ? 101 HOH A O 1
#
"#;

/// `_entity_poly.pdbx_seq_one_letter_code_can` of 1EHZ: every residue read as its parent.
const EHZ_CANONICAL: &str = "GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA";

/// BG-01M7V0ZH: 1EHZ reads as its canonical sequence, every modified nucleotide as its parent
/// (none as N) and none with a warning; the ion and the water are not chains.
#[test]
fn bg_01m7v0zh_1ehz_reads_its_modified_nucleotides_as_their_parents() {
    let s = structure_chain_sequences(EHZ_EXCERPT).unwrap();
    assert_eq!(s.warnings, Vec::<String>::new(), "no residue read as N with a warning");
    assert!(s.skipped.is_empty(), "{:?}", s.skipped);
    assert_eq!(s.chains.len(), 1, "the ion and the water are not chains");
    let chain = &s.chains[0];
    assert_eq!((chain.chain_id.as_str(), chain.molecule, chain.first_residue_number), ("A", PolymerMolecule::Rna, 1));
    assert_eq!(chain.sequence, EHZ_CANONICAL);
    let modified: Vec<(&str, i32, char)> =
        chain.modified.iter().map(|m| (m.res_name.as_str(), m.number, m.code)).collect();
    assert_eq!(
        modified,
        [
            ("2MG", 10, 'G'),
            ("H2U", 16, 'U'),
            ("H2U", 17, 'U'),
            ("M2G", 26, 'G'),
            ("OMC", 32, 'C'),
            ("OMG", 34, 'G'),
            ("YYG", 37, 'G'),
            ("PSU", 39, 'U'),
            ("5MC", 40, 'C'),
            ("7MG", 46, 'G'),
            ("5MC", 49, 'C'),
            ("5MU", 54, 'U'),
            ("PSU", 55, 'U'),
            ("1MA", 58, 'A'),
        ]
    );
}
