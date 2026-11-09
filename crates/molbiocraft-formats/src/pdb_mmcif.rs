// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! 3D Macromolecular PDB & mmCIF Coordinate Parser and Secondary-Structure Backbone Synthesizer.
//!
//! An mmCIF file is read into a full-atom [`Structure`] ([`parse_mmcif_structure`]): every model,
//! chains with both their label and author ids, residues and atoms, with each `_atom_site` column
//! found by its name in the loop header, so a file that lists the columns in another order reads
//! the same. Helices and strands come from the file's `_struct_conf` and `_struct_sheet_range`.
//! Legacy fixed-column PDB text is read into the same model ([`parse_pdb_structure`]), with
//! helices and strands from its `HELIX` and `SHEET` records.
//!
//! The $C_\alpha$ list used by superposition and the 3D canvas ([`PdbCaAtom`]) is derived from
//! that model for mmCIF input; for legacy PDB text it still comes from the fixed-column $C_\alpha$
//! reader, which reads the first model only.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::f64::consts::PI;
use std::fmt;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdbCaAtom {
    pub serial: usize,
    pub res_name: String,
    pub chain_id: String,
    pub res_seq: i32,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    #[serde(default = "default_bfactor")]
    pub b_factor: f64,
    #[serde(default = "default_sec_struct")]
    pub secondary_structure: String, // "H" | "E" | "C"
}

fn default_bfactor() -> f64 {
    85.0
}

fn default_sec_struct() -> String {
    "C".to_string()
}

pub fn one_to_three_aa(aa: u8) -> &'static str {
    match aa.to_ascii_uppercase() {
        b'A' => "ALA",
        b'R' => "ARG",
        b'N' => "ASN",
        b'D' => "ASP",
        b'C' => "CYS",
        b'Q' => "GLN",
        b'E' => "GLU",
        b'G' => "GLY",
        b'H' => "HIS",
        b'I' => "ILE",
        b'L' => "LEU",
        b'K' => "LYS",
        b'M' => "MET",
        b'F' => "PHE",
        b'P' => "PRO",
        b'S' => "SER",
        b'T' => "THR",
        b'W' => "TRP",
        b'Y' => "TYR",
        b'V' => "VAL",
        _ => "UNK",
    }
}

pub fn three_to_one_aa(res3: &str) -> char {
    match res3.trim().to_ascii_uppercase().as_str() {
        "ALA" => 'A',
        "ARG" => 'R',
        "ASN" => 'N',
        "ASP" => 'D',
        "CYS" => 'C',
        "GLN" => 'Q',
        "GLU" => 'E',
        "GLY" => 'G',
        "HIS" => 'H',
        "ILE" => 'I',
        "LEU" => 'L',
        "LYS" => 'K',
        "MET" => 'M',
        "PHE" => 'F',
        "PRO" => 'P',
        "SER" => 'S',
        "THR" => 'T',
        "TRP" => 'W',
        "TYR" => 'Y',
        "VAL" => 'V',
        _ => 'X',
    }
}

// ─── Full-atom structure model read from mmCIF or legacy PDB ───

/// A macromolecular structure read from an mmCIF file ([`parse_mmcif_structure`]) or a legacy
/// fixed-column PDB file ([`parse_pdb_structure`]): every model in the file, plus the secondary
/// structure the file itself declares.
///
/// Field docs name the mmCIF item each field holds, then the PDB columns (1-based, as the wwPDB
/// format v3.3 numbers them) when a legacy file is read.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Structure {
    /// The models in the order they first appear (`_atom_site.pdbx_PDB_model_num`; PDB `MODEL`
    /// records).
    pub models: Vec<StructureModel>,
    /// `_struct_conf` rows whose `conf_type_id` is a helix type (`HELX_P`, `HELX_RH_AL_P`, ...);
    /// PDB `HELIX` records.
    pub helices: Vec<SecondaryStructureSegment>,
    /// `_struct_sheet_range` rows, one per strand; PDB `SHEET` records.
    pub strands: Vec<SecondaryStructureSegment>,
    /// `true` when the file has no label ids, as a legacy PDB file has none: every `label_*`
    /// field (`label_asym_id`, `label_seq_id`, also in [`ResidueRef`]) then holds the author value
    /// beside it, for ligands and waters too, rather than an mmCIF label id. `false` for mmCIF.
    #[serde(default)]
    pub label_ids_from_author: bool,
}

/// One model (one NMR conformer, or the single model of a crystal structure).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureModel {
    /// `_atom_site.pdbx_PDB_model_num`; PDB `MODEL` serial (columns 11-14). 1 when the file has
    /// no such column, or no `MODEL` record.
    pub model_num: i32,
    /// `ATOM` rows read for this model, counting every alternate-location row.
    pub atom_record_count: usize,
    /// `HETATM` rows read for this model, counting every alternate-location row.
    pub hetatm_record_count: usize,
    /// Chains in the order they first appear.
    pub chains: Vec<StructureChain>,
}

/// One chain instance: the atoms sharing a `label_asym_id` (and its author chain id). In mmCIF,
/// waters and ligands have label ids of their own, so one author chain can span several of these;
/// a legacy PDB file has only author chain ids, so there it is every atom of one chain id.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureChain {
    /// `_atom_site.label_asym_id`; for legacy PDB the chain id, the same as `auth_asym_id`
    /// (see [`Structure::label_ids_from_author`]).
    pub label_asym_id: String,
    /// `_atom_site.auth_asym_id`, the chain id a legacy PDB file shows (column 22, empty when
    /// blank); the label id when an mmCIF file has no author chain id.
    pub auth_asym_id: String,
    /// Residues in the order they first appear.
    pub residues: Vec<StructureResidue>,
}

/// One residue (or ligand, or water molecule).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureResidue {
    /// `_atom_site.label_comp_id`; PDB resName (columns 18-20, empty when blank).
    pub res_name: String,
    /// `_atom_site.label_seq_id`; `None` for non-polymer residues, which have none (`.`). For
    /// legacy PDB the author residue number, the same as `auth_seq_id`
    /// (see [`Structure::label_ids_from_author`]).
    pub label_seq_id: Option<i32>,
    /// `_atom_site.auth_seq_id`, the residue number a legacy PDB file shows (resSeq, columns 23-26).
    pub auth_seq_id: Option<i32>,
    /// `_atom_site.pdbx_PDB_ins_code`; PDB iCode (column 27).
    pub ins_code: Option<String>,
    /// The helix or strand the file declares over this residue (see
    /// [`SecondaryStructureKind`]); `None` when the file declares neither. Nothing is inferred
    /// from geometry.
    pub secondary_structure: Option<SecondaryStructureKind>,
    /// Atoms in the order they first appear; an atom with alternate locations appears once
    /// (see [`parse_mmcif_structure`]).
    pub atoms: Vec<StructureAtom>,
}

/// The secondary structure a file declares over a residue: inside one of its
/// [`Structure::helices`] or one of its [`Structure::strands`].
///
/// A segment covers the residues from its first to its last residue in the order the chain lists
/// them, so a range across insertion codes (52A to 52B) covers just those. A residue inside both a
/// helix and a strand is a data error in the file; it is given **`Helix`**, as the $C_\alpha$ view
/// of a legacy PDB file ([`parse_pdb_or_mmcif_ca_coordinates`]) gives it. A segment whose first or
/// last residue is not in the chain, whose last residue comes before its first, or whose two ends
/// name different chains covers no residue, but stays listed as the file declares it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SecondaryStructureKind {
    Helix,
    Strand,
}

/// Whether an atom came from an `ATOM` or a `HETATM` row.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "UPPERCASE")]
pub enum AtomRecord {
    Atom,
    Hetatm,
}

/// One atom.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StructureAtom {
    /// `_atom_site.id`; the 1-based row number when the file has no such column. PDB serial
    /// (columns 7-11).
    pub serial: usize,
    /// `_atom_site.label_atom_id`; PDB name (columns 13-16, trimmed).
    pub name: String,
    /// `_atom_site.type_symbol`; PDB element (columns 77-78), or from the atom name when those
    /// columns are blank (see [`parse_pdb_structure`]).
    pub element: Option<String>,
    /// `_atom_site.label_alt_id` of the conformer kept; PDB altLoc (column 17).
    pub alt_loc: Option<String>,
    pub x: f64,
    pub y: f64,
    pub z: f64,
    /// `_atom_site.occupancy`; PDB occupancy (columns 55-60).
    pub occupancy: Option<f64>,
    /// `_atom_site.B_iso_or_equiv`; PDB tempFactor (columns 61-66).
    pub b_factor: Option<f64>,
    pub record: AtomRecord,
}

/// A helix or strand as the file declares it, from its first to its last residue.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecondaryStructureSegment {
    /// `_struct_conf.id` or `_struct_sheet_range.id`; for PDB the `HELIX` serNum (columns 8-10)
    /// or the `SHEET` strand number (columns 8-10).
    pub id: String,
    /// `_struct_conf.conf_type_id` (helices only); `HELX_P` for every PDB `HELIX` record, the
    /// type the wwPDB gives `HELIX` records in its mmCIF files.
    pub conf_type_id: Option<String>,
    /// `_struct_sheet_range.sheet_id` (strands only); PDB `SHEET` sheetID (columns 12-14).
    pub sheet_id: Option<String>,
    pub begin: ResidueRef,
    pub end: ResidueRef,
}

/// A residue named by a secondary-structure row (`beg_*` or `end_*` items; a PDB record's
/// `init*` or `end*` fields). For legacy PDB the label fields hold the author chain id and
/// residue number, as on the residues (see [`Structure::label_ids_from_author`]).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidueRef {
    pub res_name: Option<String>,
    pub label_asym_id: String,
    pub label_seq_id: i32,
    pub auth_asym_id: Option<String>,
    pub auth_seq_id: Option<i32>,
    pub ins_code: Option<String>,
}

/// Why legacy PDB text could not be read into a [`Structure`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PdbError {
    /// A field holds something other than what its columns must hold, or is blank (an empty
    /// `value`) where a value is required. `field` names the record, field and columns, e.g.
    /// `ATOM x (columns 31-38)`, or is `ATOM record` (say) when the record is not ASCII text,
    /// with the whole line as `value`.
    BadValue { line: usize, field: String, value: String, expected: &'static str },
    /// There are no `ATOM` or `HETATM` records, so there are no atom coordinates.
    NoAtoms,
}

impl fmt::Display for PdbError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            PdbError::BadValue { line, field, value, expected } if value.is_empty() => {
                write!(f, "PDB line {line}: {field} is blank, expected {expected}")
            }
            PdbError::BadValue { line, field, value, expected } => {
                write!(f, "PDB line {line}: {field} is '{value}', expected {expected}")
            }
            PdbError::NoAtoms => {
                write!(f, "PDB text has no ATOM or HETATM records, so it holds no atom coordinates")
            }
        }
    }
}

impl std::error::Error for PdbError {}

/// Why an mmCIF file could not be read into a [`Structure`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MmcifError {
    /// The text is not well-formed CIF (an unclosed quote or text field, an empty `loop_`).
    Syntax { line: usize, message: String },
    /// There is no `_atom_site` category, so there are no coordinates.
    NoAtomSite,
    /// A column the model cannot be built without is absent, e.g. `_atom_site.Cartn_y`.
    MissingColumn { column: String },
    /// A value cannot be read as what its column holds (`?` and `.` mean missing).
    BadValue { line: usize, column: String, value: String, expected: &'static str },
    /// A loop's value count is not a whole number of rows.
    LoopShape { line: usize, category: String, values: usize, columns: usize },
}

impl fmt::Display for MmcifError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            MmcifError::Syntax { line, message } => write!(f, "mmCIF line {line}: {message}"),
            MmcifError::NoAtomSite => {
                write!(f, "mmCIF file has no _atom_site category, so it holds no atom coordinates")
            }
            MmcifError::MissingColumn { column } => {
                write!(f, "mmCIF file has no {column} column, which is required")
            }
            MmcifError::BadValue { line, column, value, expected } => {
                write!(f, "mmCIF line {line}: {column} is '{value}', expected {expected}")
            }
            MmcifError::LoopShape { line, category, values, columns } => write!(
                f,
                "mmCIF line {line}: the {category} loop has {values} values, \
                 which is not a whole number of rows of {columns} columns"
            ),
        }
    }
}

impl std::error::Error for MmcifError {}

/// The `_atom_site` columns a structure cannot be built without. Every other column is optional:
/// without `id` an atom's serial is its row number, without `auth_asym_id` the author chain id is
/// the label id, without `pdbx_PDB_model_num` every atom is in model 1, and an absent
/// `type_symbol`, `label_alt_id`, `pdbx_PDB_ins_code`, `occupancy`, `B_iso_or_equiv` or
/// `auth_seq_id` reads as no value.
pub const REQUIRED_ATOM_SITE_COLUMNS: [&str; 8] = [
    "group_PDB",
    "label_atom_id",
    "label_comp_id",
    "label_asym_id",
    "label_seq_id",
    "Cartn_x",
    "Cartn_y",
    "Cartn_z",
];

/// Read an mmCIF file into a full-atom [`Structure`].
///
/// Columns are found by name in the `_atom_site` header, in any order; a category written as
/// `tag value` pairs (a one-row table) reads the same as a `loop_`. Values may be bare,
/// single- or double-quoted, or `;` text fields; a bare `?` or `.` is a missing value, a quoted
/// one is the literal character. Only the first data block is read.
///
/// **Alternate locations:** an atom whose rows carry a `label_alt_id` keeps one conformer, the
/// row with the highest occupancy; a row with no occupancy ranks below any row with one, and on
/// a tie the row listed first is kept. The choice is made per atom name within a residue. Record
/// counts on each model still count every row read. A position modelled as two different residue
/// types (microheterogeneity) keeps both residues, since they differ in `label_comp_id`.
///
/// Secondary structure is taken only from the file: `_struct_conf` helix rows and
/// `_struct_sheet_range` strands, which set each residue's
/// [`StructureResidue::secondary_structure`] through their label ids (`*_label_asym_id`,
/// `*_label_seq_id`); nothing is inferred from geometry here.
pub fn parse_mmcif_structure(text: &str) -> Result<Structure, MmcifError> {
    let [atom_site, struct_conf, sheet_range] = read_cif_tables(text)?;
    let atom_site = atom_site.ok_or(MmcifError::NoAtomSite)?;
    let models = build_models(text, &atom_site)?;
    let helices = match &struct_conf {
        Some(t) => read_segments(text, t, true)?,
        None => Vec::new(),
    };
    let strands = match &sheet_range {
        Some(t) => read_segments(text, t, false)?,
        None => Vec::new(),
    };
    let mut structure = Structure { models, helices, strands, label_ids_from_author: false };
    assign_secondary_structure(&mut structure);
    Ok(structure)
}

/// The $C_\alpha$ list of a structure for the C-alpha consumers (superposition, the 3D canvas,
/// radius of gyration), with the fields the earlier fixed-column mmCIF reader gave them: the
/// atoms named `CA` (`ATOM` or `HETATM`) with the label chain id (`label_asym_id`), the label
/// residue number (`label_seq_id`, or the atom's 1-based position in the list when the residue
/// has none), the B-factor (85.0 when the file gives none), and secondary structure inferred from
/// $C_\alpha$ geometry. Atoms come chain by chain and residue by residue in the order each first
/// appears, which is file order when the file keeps each chain's and residue's rows together.
/// For a structure read from legacy PDB text the label chain id and residue number are the
/// author ones ([`Structure::label_ids_from_author`]).
///
/// Only the **first model** is listed. The earlier reader appended every model, which read an
/// NMR entry such as 1A5R as one chain ten times as long; the other models are conformers of the
/// same chains and stay available in the [`Structure`].
pub fn ca_atoms_of_structure(structure: &Structure) -> Vec<PdbCaAtom> {
    let mut atoms: Vec<PdbCaAtom> = Vec::new();
    if let Some(model) = structure.models.first() {
        for chain in &model.chains {
            for residue in &chain.residues {
                for atom in residue.atoms.iter().filter(|a| a.name == "CA") {
                    let res_seq = residue.label_seq_id.unwrap_or((atoms.len() + 1) as i32);
                    atoms.push(PdbCaAtom {
                        serial: atom.serial,
                        res_name: residue.res_name.clone(),
                        chain_id: chain.label_asym_id.clone(),
                        res_seq,
                        x: atom.x,
                        y: atom.y,
                        z: atom.z,
                        b_factor: atom.b_factor.unwrap_or_else(default_bfactor),
                        secondary_structure: default_sec_struct(),
                    });
                }
            }
        }
    }
    infer_ca_secondary_structure_geometry(&mut atoms);
    atoms
}

/// Like [`parse_pdb_or_mmcif_ca_coordinates`], but an mmCIF file that cannot be read returns the
/// reason (for example the name of a missing `_atom_site` column) instead of an empty list.
pub fn try_parse_pdb_or_mmcif_ca_coordinates(text: &str) -> Result<Vec<PdbCaAtom>, MmcifError> {
    if is_mmcif_text(text) {
        return parse_mmcif_structure(text).map(|s| ca_atoms_of_structure(&s));
    }
    Ok(parse_legacy_pdb_ca_coordinates(text))
}

fn is_mmcif_text(text: &str) -> bool {
    text.contains("_atom_site.")
}

// ─── CIF tokens ───

#[derive(Debug, Clone, Copy, PartialEq)]
struct CifValue<'a> {
    text: &'a str,
    quoted: bool,
}

impl<'a> CifValue<'a> {
    /// The value, or `None` for a bare `?` (unknown) or `.` (not applicable).
    fn get(self) -> Option<&'a str> {
        if !self.quoted && (self.text == "?" || self.text == ".") {
            None
        } else {
            Some(self.text)
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum CifToken<'a> {
    Tag(&'a str),
    Value(CifValue<'a>),
    Loop,
    DataBlock,
    /// `save_`, `global_`, `stop_`: STAR words this reader skips.
    Reserved,
}

#[inline]
fn is_cif_space(b: u8) -> bool {
    matches!(b, b' ' | b'\t' | b'\n' | b'\r')
}

fn starts_with_ignore_case(word: &str, prefix: &str) -> bool {
    word.as_bytes()
        .get(..prefix.len())
        .is_some_and(|p| p.eq_ignore_ascii_case(prefix.as_bytes()))
}

fn line_at(text: &str, pos: usize) -> usize {
    memchr::memchr_iter(b'\n', &text.as_bytes()[..pos.min(text.len())]).count() + 1
}

/// The line a value (a slice of `text`) starts on.
fn line_of_value(text: &str, value: &str) -> usize {
    line_at(text, (value.as_ptr() as usize).wrapping_sub(text.as_ptr() as usize))
}

struct CifLexer<'a> {
    text: &'a str,
    pos: usize,
}

impl<'a> CifLexer<'a> {
    fn syntax(&self, at: usize, message: &str) -> MmcifError {
        MmcifError::Syntax { line: line_at(self.text, at), message: message.to_string() }
    }

    /// The next token and the byte offset it starts at.
    fn next_token(&mut self) -> Result<Option<(usize, CifToken<'a>)>, MmcifError> {
        let text = self.text;
        let b = text.as_bytes();
        loop {
            while self.pos < b.len() && is_cif_space(b[self.pos]) {
                self.pos += 1;
            }
            if self.pos >= b.len() {
                return Ok(None);
            }
            let start = self.pos;
            let c = b[start];
            if c == b'#' {
                self.pos = memchr::memchr(b'\n', &b[start..]).map_or(b.len(), |k| start + k);
                continue;
            }
            if c == b';' && (start == 0 || b[start - 1] == b'\n') {
                // A text field runs to the next line that begins with ';'.
                let body = start + 1;
                let mut search = body;
                loop {
                    let Some(k) = memchr::memchr(b'\n', &b[search..]) else {
                        return Err(self.syntax(start, "text field opened with ';' is never closed"));
                    };
                    let nl = search + k;
                    if b.get(nl + 1) == Some(&b';') {
                        let end = if nl > body && b[nl - 1] == b'\r' { nl - 1 } else { nl };
                        self.pos = nl + 2;
                        let value = CifValue { text: &text[body..end], quoted: true };
                        return Ok(Some((start, CifToken::Value(value))));
                    }
                    search = nl + 1;
                }
            }
            if c == b'\'' || c == b'"' {
                // A quoted value ends at the same quote followed by whitespace, so "O5'" holds a quote.
                let mut j = start + 1;
                loop {
                    if j >= b.len() || b[j] == b'\n' || b[j] == b'\r' {
                        return Err(self.syntax(start, "quoted value is not closed on its line"));
                    }
                    if b[j] == c && (j + 1 == b.len() || is_cif_space(b[j + 1])) {
                        break;
                    }
                    j += 1;
                }
                self.pos = j + 1;
                let value = CifValue { text: &text[start + 1..j], quoted: true };
                return Ok(Some((start, CifToken::Value(value))));
            }
            let mut j = start;
            while j < b.len() && !is_cif_space(b[j]) {
                j += 1;
            }
            self.pos = j;
            let word = &text[start..j];
            let token = if c == b'_' {
                CifToken::Tag(word)
            } else if word.eq_ignore_ascii_case("loop_") {
                CifToken::Loop
            } else if starts_with_ignore_case(word, "data_") {
                CifToken::DataBlock
            } else if starts_with_ignore_case(word, "save_")
                || word.eq_ignore_ascii_case("global_")
                || word.eq_ignore_ascii_case("stop_")
            {
                CifToken::Reserved
            } else {
                CifToken::Value(CifValue { text: word, quoted: false })
            };
            return Ok(Some((start, token)));
        }
    }
}

// ─── CIF categories ───

/// The categories the structure model reads, in the order [`read_cif_tables`] returns them.
const CIF_CATEGORIES: [&str; 3] = ["_atom_site", "_struct_conf", "_struct_sheet_range"];

struct CifTable<'a> {
    category: &'static str,
    items: Vec<&'a str>,
    values: Vec<CifValue<'a>>,
    looped: bool,
}

impl<'a> CifTable<'a> {
    fn rows(&self) -> usize {
        if self.items.is_empty() {
            0
        } else {
            self.values.len() / self.items.len()
        }
    }

    fn column(&self, item: &str) -> Option<usize> {
        self.items.iter().position(|n| n.eq_ignore_ascii_case(item))
    }

    fn required(&self, item: &str) -> Result<usize, MmcifError> {
        self.column(item).ok_or_else(|| MmcifError::MissingColumn {
            column: format!("{}.{}", self.category, item),
        })
    }

    fn value(&self, row: usize, col: usize) -> CifValue<'a> {
        self.values[row * self.items.len() + col]
    }
}

/// Which wanted category a tag belongs to, and its item name.
fn cif_category_of(tag: &str) -> Option<(usize, &str)> {
    CIF_CATEGORIES.iter().enumerate().find_map(|(i, cat)| {
        let n = cat.len();
        let b = tag.as_bytes();
        if b.len() > n + 1 && b[..n].eq_ignore_ascii_case(cat.as_bytes()) && b[n] == b'.' {
            tag.get(n + 1..).map(|item| (i, item))
        } else {
            None
        }
    })
}

/// Collect the categories in [`CIF_CATEGORIES`] from the first data block, skipping the rest.
fn read_cif_tables(text: &str) -> Result<[Option<CifTable<'_>>; 3], MmcifError> {
    let mut lexer = CifLexer { text, pos: 0 };
    let mut tables: [Option<CifTable<'_>>; 3] = [None, None, None];
    let mut pending: Option<(usize, CifToken<'_>)> = None;
    let mut in_block = false;
    loop {
        let next = match pending.take() {
            Some(t) => Some(t),
            None => lexer.next_token()?,
        };
        let Some((pos, token)) = next else { break };
        match token {
            CifToken::DataBlock => {
                if in_block {
                    break;
                }
                in_block = true;
            }
            CifToken::Loop => {
                let mut tags = Vec::new();
                loop {
                    match lexer.next_token()? {
                        Some((_, CifToken::Tag(t))) => tags.push(t),
                        other => {
                            pending = other;
                            break;
                        }
                    }
                }
                let Some(first) = tags.first() else {
                    return Err(lexer.syntax(pos, "loop_ has no column names"));
                };
                let wanted = cif_category_of(first).map(|(slot, _)| slot);
                let mut values = Vec::new();
                loop {
                    let next = match pending.take() {
                        Some(t) => Some(t),
                        None => lexer.next_token()?,
                    };
                    match next {
                        Some((_, CifToken::Value(v))) => {
                            if wanted.is_some() {
                                values.push(v);
                            }
                        }
                        other => {
                            pending = other;
                            break;
                        }
                    }
                }
                if let Some(slot) = wanted {
                    let category = CIF_CATEGORIES[slot];
                    let mut items = Vec::with_capacity(tags.len());
                    for tag in &tags {
                        match cif_category_of(tag) {
                            Some((s, item)) if s == slot => items.push(item),
                            _ => {
                                let msg = format!("loop_ of {category} also lists {tag}");
                                return Err(lexer.syntax(pos, &msg));
                            }
                        }
                    }
                    if values.len() % items.len() != 0 {
                        return Err(MmcifError::LoopShape {
                            line: line_at(text, pos),
                            category: category.to_string(),
                            values: values.len(),
                            columns: items.len(),
                        });
                    }
                    if tables[slot].is_some() {
                        let msg = format!("{category} appears more than once");
                        return Err(lexer.syntax(pos, &msg));
                    }
                    tables[slot] = Some(CifTable { category, items, values, looped: true });
                }
            }
            CifToken::Tag(tag) => {
                let next = lexer.next_token()?;
                match (cif_category_of(tag), next) {
                    (Some((slot, item)), Some((_, CifToken::Value(v)))) => {
                        let category = CIF_CATEGORIES[slot];
                        let table = tables[slot].get_or_insert_with(|| CifTable {
                            category,
                            items: Vec::new(),
                            values: Vec::new(),
                            looped: false,
                        });
                        if table.looped {
                            let msg = format!("{category} appears more than once");
                            return Err(lexer.syntax(pos, &msg));
                        }
                        table.items.push(item);
                        table.values.push(v);
                    }
                    (Some(_), _) => {
                        let msg = format!("{tag} has no value");
                        return Err(lexer.syntax(pos, &msg));
                    }
                    (None, Some((_, CifToken::Value(_)))) => {}
                    (None, other) => pending = other,
                }
            }
            CifToken::Value(_) | CifToken::Reserved => {}
        }
    }
    Ok(tables)
}

// ─── Building the model ───

fn bad_value(text: &str, table: &CifTable<'_>, v: CifValue<'_>, col: usize, expected: &'static str) -> MmcifError {
    MmcifError::BadValue {
        line: line_of_value(text, v.text),
        column: format!("{}.{}", table.category, table.items[col]),
        value: v.text.to_string(),
        expected,
    }
}

/// A value that must be present.
fn required_text<'a>(text: &str, table: &CifTable<'a>, row: usize, col: usize) -> Result<&'a str, MmcifError> {
    let v = table.value(row, col);
    v.get().ok_or_else(|| bad_value(text, table, v, col, "a value"))
}

/// A number that may be missing (`?` / `.`) but must parse when present.
fn optional_number<T: std::str::FromStr>(
    text: &str,
    table: &CifTable<'_>,
    row: usize,
    col: Option<usize>,
    expected: &'static str,
) -> Result<Option<T>, MmcifError> {
    let Some(col) = col else { return Ok(None) };
    let v = table.value(row, col);
    match v.get() {
        None => Ok(None),
        Some(s) => s.parse::<T>().map(Some).map_err(|_| bad_value(text, table, v, col, expected)),
    }
}

/// A number that must be present.
fn required_number<T: std::str::FromStr>(
    text: &str,
    table: &CifTable<'_>,
    row: usize,
    col: usize,
    expected: &'static str,
) -> Result<T, MmcifError> {
    optional_number(text, table, row, Some(col), expected)?
        .ok_or_else(|| bad_value(text, table, table.value(row, col), col, expected))
}

type ResidueKey = (Option<i32>, Option<i32>, Option<String>, String);

struct ChainBuilder {
    chain: StructureChain,
    residue_index: HashMap<ResidueKey, usize>,
}

struct ModelBuilder {
    model: StructureModel,
    chains: Vec<ChainBuilder>,
}

/// Rank used to choose between alternate locations: higher occupancy wins, missing ranks lowest.
fn occupancy_rank(occupancy: Option<f64>) -> f64 {
    occupancy.unwrap_or(f64::NEG_INFINITY)
}

fn build_models(text: &str, t: &CifTable<'_>) -> Result<Vec<StructureModel>, MmcifError> {
    let mut required = [0usize; REQUIRED_ATOM_SITE_COLUMNS.len()];
    for (slot, item) in required.iter_mut().zip(REQUIRED_ATOM_SITE_COLUMNS) {
        *slot = t.required(item)?;
    }
    let [c_group, c_atom, c_comp, c_asym, c_seq, c_x, c_y, c_z] = required;
    let c_id = t.column("id");
    let c_type = t.column("type_symbol");
    let c_alt = t.column("label_alt_id");
    let c_ins = t.column("pdbx_PDB_ins_code");
    let c_occ = t.column("occupancy");
    let c_b = t.column("B_iso_or_equiv");
    let c_auth_asym = t.column("auth_asym_id");
    let c_auth_seq = t.column("auth_seq_id");
    let c_model = t.column("pdbx_PDB_model_num");
    let present = |row: usize, col: Option<usize>| col.and_then(|c| t.value(row, c).get());

    let mut models = ModelsBuilder::default();
    for row in 0..t.rows() {
        let group = t.value(row, c_group);
        let record = match group.get() {
            Some(g) if g.eq_ignore_ascii_case("ATOM") => AtomRecord::Atom,
            Some(g) if g.eq_ignore_ascii_case("HETATM") => AtomRecord::Hetatm,
            _ => return Err(bad_value(text, t, group, c_group, "ATOM or HETATM")),
        };
        let name = required_text(text, t, row, c_atom)?;
        let res_name = required_text(text, t, row, c_comp)?;
        let label_asym = required_text(text, t, row, c_asym)?;
        let label_seq: Option<i32> = optional_number(text, t, row, Some(c_seq), "an integer")?;
        let x: f64 = required_number(text, t, row, c_x, "a number")?;
        let y: f64 = required_number(text, t, row, c_y, "a number")?;
        let z: f64 = required_number(text, t, row, c_z, "a number")?;
        let serial = match c_id {
            Some(c) => required_number(text, t, row, c, "a whole number")?,
            None => row + 1,
        };
        let occupancy: Option<f64> = optional_number(text, t, row, c_occ, "a number")?;
        let b_factor: Option<f64> = optional_number(text, t, row, c_b, "a number")?;
        let auth_seq: Option<i32> = optional_number(text, t, row, c_auth_seq, "an integer")?;
        let model_num: i32 = match c_model {
            Some(c) => required_number(text, t, row, c, "an integer")?,
            None => 1,
        };
        let auth_asym = present(row, c_auth_asym).unwrap_or(label_asym);
        let ins_code = present(row, c_ins);
        let alt_loc = present(row, c_alt);

        models.add(AtomRow {
            model_num,
            label_asym,
            auth_asym,
            label_seq,
            auth_seq,
            ins_code,
            res_name,
            atom: StructureAtom {
                serial,
                name: name.to_string(),
                element: present(row, c_type).map(str::to_string),
                alt_loc: alt_loc.map(str::to_string),
                x,
                y,
                z,
                occupancy,
                b_factor,
                record,
            },
        });
    }
    Ok(models.finish())
}

/// One atom row on its way into the model, from either reader.
struct AtomRow<'a> {
    model_num: i32,
    label_asym: &'a str,
    auth_asym: &'a str,
    label_seq: Option<i32>,
    auth_seq: Option<i32>,
    ins_code: Option<&'a str>,
    res_name: &'a str,
    atom: StructureAtom,
}

/// Places atom rows into models, chains, residues and atoms, so the mmCIF and the legacy PDB
/// reader group atoms and choose between alternate locations by the same rules (see
/// [`parse_mmcif_structure`]).
#[derive(Default)]
struct ModelsBuilder {
    models: Vec<ModelBuilder>,
}

impl ModelsBuilder {
    fn is_empty(&self) -> bool {
        self.models.is_empty()
    }

    fn add(&mut self, row: AtomRow<'_>) {
        let AtomRow { model_num, label_asym, auth_asym, label_seq, auth_seq, ins_code, res_name, atom } = row;
        let models = &mut self.models;
        let mi = match models.iter().rposition(|m| m.model.model_num == model_num) {
            Some(i) => i,
            None => {
                models.push(ModelBuilder {
                    model: StructureModel {
                        model_num,
                        atom_record_count: 0,
                        hetatm_record_count: 0,
                        chains: Vec::new(),
                    },
                    chains: Vec::new(),
                });
                models.len() - 1
            }
        };
        let mb = &mut models[mi];
        match atom.record {
            AtomRecord::Atom => mb.model.atom_record_count += 1,
            AtomRecord::Hetatm => mb.model.hetatm_record_count += 1,
        }
        let ci = match mb
            .chains
            .iter()
            .rposition(|c| c.chain.label_asym_id == label_asym && c.chain.auth_asym_id == auth_asym)
        {
            Some(i) => i,
            None => {
                mb.chains.push(ChainBuilder {
                    chain: StructureChain {
                        label_asym_id: label_asym.to_string(),
                        auth_asym_id: auth_asym.to_string(),
                        residues: Vec::new(),
                    },
                    residue_index: HashMap::new(),
                });
                mb.chains.len() - 1
            }
        };
        let cb = &mut mb.chains[ci];
        let same_as_last = cb.chain.residues.last().is_some_and(|r| {
            r.label_seq_id == label_seq
                && r.auth_seq_id == auth_seq
                && r.ins_code.as_deref() == ins_code
                && r.res_name == res_name
        });
        let ri = if same_as_last {
            cb.chain.residues.len() - 1
        } else {
            let key: ResidueKey = (label_seq, auth_seq, ins_code.map(str::to_string), res_name.to_string());
            match cb.residue_index.get(&key) {
                Some(&i) => i,
                None => {
                    cb.chain.residues.push(StructureResidue {
                        res_name: res_name.to_string(),
                        label_seq_id: label_seq,
                        auth_seq_id: auth_seq,
                        ins_code: ins_code.map(str::to_string),
                        secondary_structure: None,
                        atoms: Vec::new(),
                    });
                    let i = cb.chain.residues.len() - 1;
                    cb.residue_index.insert(key, i);
                    i
                }
            }
        };
        let residue = &mut cb.chain.residues[ri];
        if atom.alt_loc.is_some() {
            if let Some(kept) = residue
                .atoms
                .iter_mut()
                .find(|a| a.alt_loc.is_some() && a.name == atom.name)
            {
                if occupancy_rank(atom.occupancy) > occupancy_rank(kept.occupancy) {
                    *kept = atom;
                }
                return;
            }
        }
        residue.atoms.push(atom);
    }

    fn finish(self) -> Vec<StructureModel> {
        self.models
            .into_iter()
            .map(|mb| {
                let mut model = mb.model;
                model.chains = mb.chains.into_iter().map(|c| c.chain).collect();
                model
            })
            .collect()
    }
}

/// `_struct_conf` helices (`helices == true`) or `_struct_sheet_range` strands.
fn read_segments(
    text: &str,
    t: &CifTable<'_>,
    helices: bool,
) -> Result<Vec<SecondaryStructureSegment>, MmcifError> {
    let c_kind = t.required(if helices { "conf_type_id" } else { "sheet_id" })?;
    let c_id = t.required("id")?;
    let begin = SegmentEndColumns::find(t, "beg")?;
    let end = SegmentEndColumns::find(t, "end")?;
    let mut out = Vec::new();
    for row in 0..t.rows() {
        let kind = required_text(text, t, row, c_kind)?;
        if helices && !starts_with_ignore_case(kind, "HELX") {
            continue;
        }
        out.push(SecondaryStructureSegment {
            id: required_text(text, t, row, c_id)?.to_string(),
            conf_type_id: helices.then(|| kind.to_string()),
            sheet_id: (!helices).then(|| kind.to_string()),
            begin: begin.read(text, t, row)?,
            end: end.read(text, t, row)?,
        });
    }
    Ok(out)
}

/// The columns naming one end (`beg` or `end`) of a secondary-structure row.
struct SegmentEndColumns {
    label_asym: usize,
    label_seq: usize,
    comp: Option<usize>,
    auth_asym: Option<usize>,
    auth_seq: Option<usize>,
    ins: Option<usize>,
}

impl SegmentEndColumns {
    fn find(t: &CifTable<'_>, end: &str) -> Result<Self, MmcifError> {
        Ok(SegmentEndColumns {
            label_asym: t.required(&format!("{end}_label_asym_id"))?,
            label_seq: t.required(&format!("{end}_label_seq_id"))?,
            comp: t.column(&format!("{end}_label_comp_id")),
            auth_asym: t.column(&format!("{end}_auth_asym_id")),
            auth_seq: t.column(&format!("{end}_auth_seq_id")),
            ins: t.column(&format!("pdbx_{end}_PDB_ins_code")),
        })
    }

    fn read(&self, text: &str, t: &CifTable<'_>, row: usize) -> Result<ResidueRef, MmcifError> {
        let present = |col: Option<usize>| col.and_then(|c| t.value(row, c).get()).map(str::to_string);
        Ok(ResidueRef {
            res_name: present(self.comp),
            label_asym_id: required_text(text, t, row, self.label_asym)?.to_string(),
            label_seq_id: required_number(text, t, row, self.label_seq, "an integer")?,
            auth_asym_id: present(self.auth_asym),
            auth_seq_id: optional_number(text, t, row, self.auth_seq, "an integer")?,
            ins_code: present(self.ins),
        })
    }
}

// ─── Secondary structure of each residue ───

/// Set each residue's [`StructureResidue::secondary_structure`], in every model, from the
/// structure's helices and strands (rules on [`SecondaryStructureKind`]).
fn assign_secondary_structure(structure: &mut Structure) {
    let Structure { models, helices, strands, label_ids_from_author } = structure;
    // Strands first, so a residue that a helix covers too ends up a helix.
    let segments = strands
        .iter()
        .map(|s| (s, SecondaryStructureKind::Strand))
        .chain(helices.iter().map(|s| (s, SecondaryStructureKind::Helix)));
    for (segment, kind) in segments {
        if segment.begin.label_asym_id != segment.end.label_asym_id {
            continue;
        }
        for model in models.iter_mut() {
            for chain in model.chains.iter_mut().filter(|c| c.label_asym_id == segment.begin.label_asym_id) {
                if let Some(span) = segment_span(&chain.residues, segment, *label_ids_from_author) {
                    for residue in &mut chain.residues[span] {
                        residue.secondary_structure = Some(kind);
                    }
                }
            }
        }
    }
}

/// The residues a segment covers: from the first residue that is its first end to the next one
/// that is its last end, plus any residue right after that at the same position (a second residue
/// type modelled there). In mmCIF a label residue number names a position on its own; a legacy
/// file's author number needs its insertion code as well (`with_ins_code`).
fn segment_span(
    residues: &[StructureResidue],
    segment: &SecondaryStructureSegment,
    with_ins_code: bool,
) -> Option<std::ops::RangeInclusive<usize>> {
    let is = |r: &StructureResidue, end: &ResidueRef| {
        r.label_seq_id == Some(end.label_seq_id) && (!with_ins_code || r.ins_code == end.ins_code)
    };
    let first = residues.iter().position(|r| is(r, &segment.begin))?;
    let mut last = first + residues[first..].iter().position(|r| is(r, &segment.end))?;
    while residues.get(last + 1).is_some_and(|r| is(r, &segment.end)) {
        last += 1;
    }
    Some(first..=last)
}

// ─── Building the model from legacy PDB ───

/// Read legacy fixed-column PDB text into a full-atom [`Structure`], the same model
/// [`parse_mmcif_structure`] builds from mmCIF. Columns are those of the wwPDB format v3.3,
/// numbered from 1.
///
/// Read are `ATOM` and `HETATM` records (serial 7-11, name 13-16, altLoc 17, resName 18-20,
/// chainID 22, resSeq 23-26, iCode 27, x/y/z 31-38/39-46/47-54, occupancy 55-60, tempFactor
/// 61-66, element 77-78), `MODEL` (serial 11-14), `HELIX` and `SHEET`; every other record is
/// skipped. An atom belongs to the model of the last `MODEL` record before it (model 1 before
/// any), and models are kept separately. Atoms are grouped into chains and residues, and one
/// conformer of each atom with alternate locations is kept, by the same rules as for mmCIF (see
/// [`parse_mmcif_structure`]): the highest occupancy, the first listed on a tie, per atom name
/// within a residue; record counts count every `ATOM` and `HETATM` record read.
///
/// **Label ids.** A legacy file has only author ids, so each label field holds the author value
/// beside it - `label_asym_id` the chain id, `label_seq_id` the residue number, for ligands and
/// waters too (an mmCIF file gives those no `label_seq_id`) - and
/// [`Structure::label_ids_from_author`] is `true`. Compare a legacy structure with an mmCIF one
/// on their `auth_*` fields.
///
/// **Values.** Coordinates, the atom serial and the atom name are required. A blank chain id or
/// residue name reads as an empty string; a blank altLoc, iCode, resSeq, occupancy or tempFactor
/// as no value. A field that does not parse, or a record that ends before column 54, is a
/// [`PdbError::BadValue`] naming the line, field and columns, never a default. When the element
/// columns are blank the element comes from the atom name: the format right-aligns a one-letter
/// symbol in columns 13-14, so a name with a blank or a digit in column 13 (` CA `, `1HG1`) gives
/// the first letter after it, and a name starting in column 13 gives the letters in columns 13-14
/// (`FE  `, or `CA  ` for calcium), or its first letter alone when column 14 is not a letter or
/// the name ends in two digits (a hydrogen such as `HG21`).
///
/// **Secondary structure.** `HELIX` records (`conf_type_id` `HELX_P`) and `SHEET` records are
/// listed as the file gives them, and set the [`StructureResidue::secondary_structure`] of the
/// residues each covers, matched by chain id, residue number and insertion code; the rules,
/// including helix over strand where both cover a residue, are on [`SecondaryStructureKind`].
///
/// Text with no `ATOM` or `HETATM` record is [`PdbError::NoAtoms`].
pub fn parse_pdb_structure(text: &str) -> Result<Structure, PdbError> {
    let mut models = ModelsBuilder::default();
    let mut helices = Vec::new();
    let mut strands = Vec::new();
    let mut model_num = 1;
    for (i, line) in text.lines().enumerate() {
        let record = match line.get(..6).unwrap_or(line).trim_end() {
            "ATOM" => "ATOM",
            "HETATM" => "HETATM",
            "MODEL" => "MODEL",
            "HELIX" => "HELIX",
            "SHEET" => "SHEET",
            _ => continue,
        };
        let r = PdbRecord { line, number: i + 1, record };
        if !line.is_ascii() {
            return Err(PdbError::BadValue {
                line: r.number,
                field: format!("{record} record"),
                value: line.to_string(),
                expected: "ASCII text in fixed columns",
            });
        }
        match record {
            "MODEL" => model_num = r.required_number("serial", 11, 14, "an integer")?,
            "HELIX" => helices.push(SecondaryStructureSegment {
                id: r.text(8, 10).unwrap_or("").to_string(),
                conf_type_id: Some("HELX_P".to_string()),
                sheet_id: None,
                begin: r.residue_ref("init", 16, 20, 22)?,
                end: r.residue_ref("end", 28, 32, 34)?,
            }),
            "SHEET" => strands.push(SecondaryStructureSegment {
                id: r.text(8, 10).unwrap_or("").to_string(),
                conf_type_id: None,
                sheet_id: Some(r.text(12, 14).unwrap_or("").to_string()),
                begin: r.residue_ref("init", 18, 22, 23)?,
                end: r.residue_ref("end", 29, 33, 34)?,
            }),
            _ => {
                let serial: usize = r.required_number("serial", 7, 11, "a whole number")?;
                let name = r.text(13, 16).ok_or_else(|| r.bad("name", 13, 16, "an atom name"))?;
                let res_seq: Option<i32> = r.optional_number("resSeq", 23, 26, "an integer")?;
                if line.len() < 54 {
                    return Err(r.bad("z", 47, 54, "a number ending at column 54"));
                }
                let x: f64 = r.required_number("x", 31, 38, "a number")?;
                let y: f64 = r.required_number("y", 39, 46, "a number")?;
                let z: f64 = r.required_number("z", 47, 54, "a number")?;
                let occupancy: Option<f64> = r.optional_number("occupancy", 55, 60, "a number")?;
                let b_factor: Option<f64> = r.optional_number("tempFactor", 61, 66, "a number")?;
                let element = match r.text(77, 78) {
                    Some(e) => Some(e.to_string()),
                    None => element_from_atom_name(&line[12..16]),
                };
                let chain = r.text(22, 22).unwrap_or("");
                models.add(AtomRow {
                    model_num,
                    label_asym: chain,
                    auth_asym: chain,
                    label_seq: res_seq,
                    auth_seq: res_seq,
                    ins_code: r.text(27, 27),
                    res_name: r.text(18, 20).unwrap_or(""),
                    atom: StructureAtom {
                        serial,
                        name: name.to_string(),
                        element,
                        alt_loc: r.text(17, 17).map(str::to_string),
                        x,
                        y,
                        z,
                        occupancy,
                        b_factor,
                        record: if record == "ATOM" { AtomRecord::Atom } else { AtomRecord::Hetatm },
                    },
                });
            }
        }
    }
    if models.is_empty() {
        return Err(PdbError::NoAtoms);
    }
    let mut structure = Structure { models: models.finish(), helices, strands, label_ids_from_author: true };
    assign_secondary_structure(&mut structure);
    Ok(structure)
}

/// One fixed-column record of a legacy PDB file (checked to be ASCII, so columns are bytes).
struct PdbRecord<'a> {
    line: &'a str,
    number: usize,
    record: &'static str,
}

impl<'a> PdbRecord<'a> {
    /// Columns `from..=to` (1-based), trimmed; `None` when blank or past the end of the line.
    fn text(&self, from: usize, to: usize) -> Option<&'a str> {
        let s = self.line.get(from - 1..to.min(self.line.len()))?.trim();
        (!s.is_empty()).then_some(s)
    }

    fn bad(&self, field: &str, from: usize, to: usize, expected: &'static str) -> PdbError {
        let columns = if from == to { format!("column {from}") } else { format!("columns {from}-{to}") };
        PdbError::BadValue {
            line: self.number,
            field: format!("{} {field} ({columns})", self.record),
            value: self.text(from, to).unwrap_or("").to_string(),
            expected,
        }
    }

    /// A number that may be blank but must parse when present.
    fn optional_number<T: std::str::FromStr>(
        &self,
        field: &str,
        from: usize,
        to: usize,
        expected: &'static str,
    ) -> Result<Option<T>, PdbError> {
        match self.text(from, to) {
            None => Ok(None),
            Some(s) => s.parse().map(Some).map_err(|_| self.bad(field, from, to, expected)),
        }
    }

    /// A number that must be present.
    fn required_number<T: std::str::FromStr>(
        &self,
        field: &str,
        from: usize,
        to: usize,
        expected: &'static str,
    ) -> Result<T, PdbError> {
        self.optional_number(field, from, to, expected)?.ok_or_else(|| self.bad(field, from, to, expected))
    }

    /// One end (`init` or `end`) of a `HELIX` or `SHEET` record: the residue name in the three
    /// columns from `res`, the chain id in column `chain`, the residue number in the four columns
    /// from `seq` and the insertion code in the column after them.
    fn residue_ref(&self, which: &str, res: usize, chain: usize, seq: usize) -> Result<ResidueRef, PdbError> {
        let chain_id = self.text(chain, chain).unwrap_or("").to_string();
        let seq_num: i32 = self.required_number(&format!("{which}SeqNum"), seq, seq + 3, "an integer")?;
        Ok(ResidueRef {
            res_name: self.text(res, res + 2).map(str::to_string),
            label_asym_id: chain_id.clone(),
            label_seq_id: seq_num,
            auth_asym_id: Some(chain_id),
            auth_seq_id: Some(seq_num),
            ins_code: self.text(seq + 4, seq + 4).map(str::to_string),
        })
    }
}

/// The element a PDB atom name (columns 13-16, untrimmed) implies, for a record whose element
/// columns are blank; the rule is on [`parse_pdb_structure`].
fn element_from_atom_name(name: &str) -> Option<String> {
    let b = name.as_bytes();
    let first = *b.first()?;
    if first == b' ' || first.is_ascii_digit() {
        return b[1..].iter().find(|c| c.is_ascii_alphabetic()).map(|&c| char::from(c).to_string());
    }
    if !first.is_ascii_alphabetic() {
        return None;
    }
    let hydrogen_style = b.len() == 4 && b[2].is_ascii_digit() && b[3].is_ascii_digit();
    let two_letters = b.get(1).is_some_and(u8::is_ascii_alphabetic) && !hydrogen_style;
    Some(name[..if two_letters { 2 } else { 1 }].to_string())
}

/// Parse PDB `ATOM` (`CA`) records + `HELIX`/`SHEET` secondary-structure ranges,
/// OR mmCIF `_atom_site` records into normalized `PdbCaAtom` coordinates.
///
/// mmCIF text (anything containing `_atom_site.`) is read into the full-atom model and its
/// $C_\alpha$ view returned ([`ca_atoms_of_structure`]); an mmCIF file that cannot be read gives
/// an empty list here, and [`try_parse_pdb_or_mmcif_ca_coordinates`] says why. From either
/// format only the first model is listed.
pub fn parse_pdb_or_mmcif_ca_coordinates(text: &str) -> Vec<PdbCaAtom> {
    try_parse_pdb_or_mmcif_ca_coordinates(text).unwrap_or_default()
}

/// Legacy fixed-column PDB: `ATOM` `CA` records, with `HELIX`/`SHEET` ranges when present.
///
/// Only the **first model** is read: `ATOM` records after a second `MODEL` record are not, so an
/// NMR entry such as 1A5R is one chain of 103 residues rather than ten copies end to end, as from
/// its mmCIF file. A file without `MODEL` records is one model.
fn parse_legacy_pdb_ca_coordinates(text: &str) -> Vec<PdbCaAtom> {
    let mut helix_ranges: Vec<(String, i32, i32)> = Vec::new();
    let mut sheet_ranges: Vec<(String, i32, i32)> = Vec::new();
    let mut atoms: Vec<PdbCaAtom> = Vec::new();
    let mut models_begun = 0usize;
    let mut first_model_ended = false;

    for line in text.lines() {
        if line.starts_with("HELIX ") && line.len() >= 37 {
            let chain = line.get(19..20).unwrap_or("A").trim().to_string();
            let s = line.get(21..25).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
            let e = line.get(33..37).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
            if e >= s && s > 0 {
                helix_ranges.push((chain, s, e));
            }
        } else if line.starts_with("SHEET ") && line.len() >= 37 {
            let chain = line.get(21..22).unwrap_or("A").trim().to_string();
            let s = line.get(22..26).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
            let e = line.get(33..37).unwrap_or("0").trim().parse::<i32>().unwrap_or(0);
            if e >= s && s > 0 {
                sheet_ranges.push((chain, s, e));
            }
        } else if line.starts_with("MODEL") {
            models_begun += 1;
            first_model_ended |= models_begun > 1;
        } else if line.starts_with("ATOM  ") && line.len() >= 54 && !first_model_ended {
            let atom_name = line.get(12..16).unwrap_or("").trim();
            if atom_name != "CA" {
                continue;
            }
            let alt_loc = line.as_bytes().get(16).copied().unwrap_or(b' ');
            if alt_loc != b' ' && alt_loc != b'A' {
                continue;
            }
            let serial = line
                .get(6..11)
                .unwrap_or("")
                .trim()
                .parse::<usize>()
                .unwrap_or(atoms.len() + 1);
            let res_name = line.get(17..20).unwrap_or("UNK").trim().to_string();
            let chain_raw = line.get(21..22).unwrap_or("A").trim();
            let chain_id = if chain_raw.is_empty() { "A" } else { chain_raw }.to_string();
            let res_seq = line
                .get(22..26)
                .unwrap_or("")
                .trim()
                .parse::<i32>()
                .unwrap_or((atoms.len() + 1) as i32);
            let x = line.get(30..38).unwrap_or("0").trim().parse::<f64>().unwrap_or(0.0);
            let y = line.get(38..46).unwrap_or("0").trim().parse::<f64>().unwrap_or(0.0);
            let z = line.get(46..54).unwrap_or("0").trim().parse::<f64>().unwrap_or(0.0);
            let b_factor = line
                .get(60..66)
                .unwrap_or("85.0")
                .trim()
                .parse::<f64>()
                .unwrap_or(85.0);

            let mut ss = "C";
            if helix_ranges
                .iter()
                .any(|(c, s, e)| (c == &chain_id || c.is_empty()) && res_seq >= *s && res_seq <= *e)
            {
                ss = "H";
            } else if sheet_ranges
                .iter()
                .any(|(c, s, e)| (c == &chain_id || c.is_empty()) && res_seq >= *s && res_seq <= *e)
            {
                ss = "E";
            }

            atoms.push(PdbCaAtom {
                serial,
                res_name,
                chain_id,
                res_seq,
                x,
                y,
                z,
                b_factor,
                secondary_structure: ss.into(),
            });
        }
    }

    if helix_ranges.is_empty() && sheet_ranges.is_empty() {
        infer_ca_secondary_structure_geometry(&mut atoms);
    }

    atoms
}

/// Differential $C_\alpha(i) - C_\alpha(i+3)$ / $C_\alpha(i+4)$ distance heuristic (Richards & Kundrot)
/// assigning Helix (`H`, $d_{i,i+3} \approx 5.1\text{ \AA}, d_{i,i+4} \approx 6.0\text{ \AA}$) and Strand (`E`, $d_{i,i+3} \ge 8.8\text{ \AA}$)
/// when PDB `HELIX`/`SHEET` header cards are omitted.
fn infer_ca_secondary_structure_geometry(atoms: &mut [PdbCaAtom]) {
    let n = atoms.len();
    if n < 5 {
        return;
    }
    let dist = |a: &PdbCaAtom, b: &PdbCaAtom| -> f64 {
        ((a.x - b.x).powi(2) + (a.y - b.y).powi(2) + (a.z - b.z).powi(2)).sqrt()
    };
    let mut tags = vec!["C"; n];
    for i in 0..(n - 4) {
        let d3 = dist(&atoms[i], &atoms[i + 3]);
        let d4 = dist(&atoms[i], &atoms[i + 4]);
        if (4.5..=6.2).contains(&d3) && (5.2..=7.1).contains(&d4) {
            for t in &mut tags[i..=(i + 4)] {
                *t = "H";
            }
        } else if d3 >= 8.7 && d4 >= 11.2 {
            for t in &mut tags[i..=(i + 3)] {
                if *t == "C" {
                    *t = "E";
                }
            }
        }
    }
    for (atom, tag) in atoms.iter_mut().zip(tags.into_iter()) {
        atom.secondary_structure = tag.into();
    }
}

/// Synthesize realistic 3D PDB $C_\alpha$ coordinates (`ATOM` + `HELIX`/`SHEET`) from a protein sequence
/// folding $\alpha$-helical, $\beta$-strand, and turn segments according to Chou-Fasman propensities.
pub fn synthesize_folded_pdb_from_protein(
    protein_seq: &str,
    chain_id: &str,
    perturbation_angstrom: f64,
) -> String {
    let clean: Vec<u8> = protein_seq
        .bytes()
        .filter(|b| b.is_ascii_alphabetic() && *b != b'*')
        .map(|b| b.to_ascii_uppercase())
        .take(600)
        .collect();
    let ch = chain_id.chars().next().unwrap_or('A');
    if clean.is_empty() {
        return "END\n".into();
    }

    // Assign local Chou-Fasman propensity state (H, E, C) per residue window
    let n = clean.len();
    let mut states = vec![b'C'; n];
    for i in 0..n {
        let lo = i.saturating_sub(2);
        let hi = (i + 3).min(n);
        let mut h_score = 0.0;
        let mut e_score = 0.0;
        for &aa in &clean[lo..hi] {
            let (ph, pe) = match aa {
                b'E' | b'A' | b'L' | b'M' | b'Q' | b'K' | b'R' | b'H' => (1.28, 0.84),
                b'V' | b'I' | b'Y' | b'F' | b'W' | b'C' | b'T' => (0.91, 1.38),
                b'G' | b'P' | b'S' | b'D' | b'N' => (0.68, 0.76),
                _ => (1.0, 1.0),
            };
            h_score += ph;
            e_score += pe;
        }
        let span = (hi - lo) as f64;
        if h_score / span >= 1.10 {
            states[i] = b'H';
        } else if e_score / span >= 1.12 {
            states[i] = b'E';
        }
    }

    let mut pdb = String::with_capacity(n * 86 + 512);
    pdb.push_str("HEADER    MOLBIOCRAFT 3D PROTEIN BACKBONE         31-OCT-26   MBC1\n");

    // 3D turtle integrator producing realistic folded compact domain coordinates (3.8 Å C_alpha step)
    let mut x = 0.0f64;
    let mut y = 0.0f64;
    let mut z = 0.0f64;
    let mut dir_theta = 0.35f64;
    let mut dir_phi = 0.25f64;

    for (i, &aa) in clean.iter().enumerate() {
        let res_num = (i + 1) as i32;
        let jitter = perturbation_angstrom * (((i as f64) * 1.618).sin());
        let (px, py, pz, plddt) = match states[i] {
            b'H' => {
                // Pauling-Corey alpha-helix: 100 deg per residue, 1.5 A axial rise, 2.3 A radius
                let angle = (i as f64) * (100.0 * PI / 180.0);
                x += 1.5 * dir_theta.cos();
                y += 1.5 * dir_theta.sin() * dir_phi.cos();
                z += 1.5 * dir_phi.sin();
                (
                    x + 2.3 * angle.cos() + jitter,
                    y + 2.3 * angle.sin() + jitter * 0.7,
                    z + 0.4 * (angle * 0.5).sin() - jitter * 0.5,
                    92.4,
                )
            }
            b'E' => {
                // Pleated beta-strand: 3.3 A axial advance with alternating +/- 0.85 A pleat
                let pleat = if i % 2 == 0 { 0.85 } else { -0.85 };
                x += 3.25 * dir_theta.cos();
                y += 3.25 * dir_theta.sin() * dir_phi.cos();
                z += 3.25 * dir_phi.sin();
                (x + jitter, y + pleat + jitter * 0.5, z - pleat * 0.4, 88.6)
            }
            _ => {
                // Turn / loop: smoothly curve domain trajectory back toward compact globular core
                dir_theta += 0.58;
                dir_phi += 0.41;
                x += 3.6 * dir_theta.cos();
                y += 3.6 * dir_theta.sin() * dir_phi.cos();
                z += 3.6 * dir_phi.sin();
                (x + jitter, y - jitter * 0.6, z + jitter * 0.4, 71.5)
            }
        };

        let res3 = one_to_three_aa(aa);
        pdb.push_str(&format!(
            "ATOM  {:>5}  CA  {:>3} {}{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00{:>6.2}           C\n",
            i + 1,
            res3,
            ch,
            res_num,
            px,
            py,
            pz,
            plddt
        ));
    }
    pdb.push_str("END\n");
    pdb
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::BTreeMap;
    use std::path::{Path, PathBuf};

    /// The fixture's `_atom_site` columns, in the order RCSB writes them.
    const COLUMNS: [&str; 21] = [
        "group_PDB",
        "id",
        "type_symbol",
        "label_atom_id",
        "label_alt_id",
        "label_comp_id",
        "label_asym_id",
        "label_entity_id",
        "label_seq_id",
        "pdbx_PDB_ins_code",
        "Cartn_x",
        "Cartn_y",
        "Cartn_z",
        "occupancy",
        "B_iso_or_equiv",
        "pdbx_formal_charge",
        "auth_seq_id",
        "auth_comp_id",
        "auth_asym_id",
        "auth_atom_id",
        "pdbx_PDB_model_num",
    ];

    /// Author chain X and author numbering from 10, so label and author ids cannot be confused.
    const ROWS: &[&str] = &[
        "ATOM 1 N N . MET A 1 1 ? 11.104 6.134 -6.504 1.00 21.69 ? 10 MET X N 1",
        "ATOM 2 C CA . MET A 1 1 ? 10.120 12.450 8.300 1.00 92.40 ? 10 MET X CA 1",
        "ATOM 3 C CA . VAL A 1 2 ? 13.710 13.520 9.110 1.00 94.10 ? 11 VAL X CA 1",
        "ATOM 4 O O . VAL A 1 2 ? 14.000 14.000 10.000 1.00 90.00 ? 11 VAL X O 1",
        "ATOM 5 C CA . SER A 1 3 ? 16.920 11.880 10.220 1.00 90.80 ? 12 SER X CA 1",
        "HETATM 6 O O . HOH B 2 . ? 1.000 2.000 3.000 1.00 30.00 ? 101 HOH X O 1",
    ];

    /// An mmCIF text whose `_atom_site` loop lists `columns[i]` for each `i` of `order`, in that
    /// order; with `wrap`, every row is broken across two lines (CIF rows need not be one line).
    fn atom_site_cif(columns: &[&str], rows: &[&str], order: &[usize], wrap: bool) -> String {
        let mut s = String::from("data_TEST\n#\nloop_\n");
        for &i in order {
            s.push_str(&format!("_atom_site.{}\n", columns[i]));
        }
        for row in rows {
            let v: Vec<&str> = row.split_whitespace().collect();
            assert_eq!(v.len(), columns.len(), "fixture row {row}");
            let picked: Vec<&str> = order.iter().map(|&i| v[i]).collect();
            if wrap {
                s.push_str(&picked[..5].join(" "));
                s.push('\n');
                s.push_str(&picked[5..].join("   "));
            } else {
                s.push_str(&picked.join(" "));
            }
            s.push('\n');
        }
        s.push_str("#\n");
        s
    }

    fn all_columns() -> Vec<usize> {
        (0..COLUMNS.len()).collect()
    }

    fn ca_summary(text: &str) -> Vec<(String, String, i32, [f64; 3])> {
        parse_pdb_or_mmcif_ca_coordinates(text)
            .iter()
            .map(|a| (a.res_name.clone(), a.chain_id.clone(), a.res_seq, [a.x, a.y, a.z]))
            .collect()
    }

    #[test]
    fn reordered_atom_site_columns_parse_the_same_coordinates() {
        let standard = atom_site_cif(&COLUMNS, ROWS, &all_columns(), false);
        let want = vec![
            ("MET".to_string(), "A".to_string(), 1, [10.120, 12.450, 8.300]),
            ("VAL".to_string(), "A".to_string(), 2, [13.710, 13.520, 9.110]),
            ("SER".to_string(), "A".to_string(), 3, [16.920, 11.880, 10.220]),
        ];
        assert_eq!(ca_summary(&standard), want);

        let reversed: Vec<usize> = all_columns().into_iter().rev().collect();
        // 8 is coprime with 21, so this visits every column once, none in its own place.
        let shuffled: Vec<usize> = (0..COLUMNS.len()).map(|i| (i * 8 + 5) % COLUMNS.len()).collect();
        assert!(shuffled.iter().enumerate().all(|(i, &c)| i != c));
        let standard_model = parse_mmcif_structure(&standard).unwrap();
        let standard_ca = serde_json::to_value(parse_pdb_or_mmcif_ca_coordinates(&standard)).unwrap();
        for (order, wrap) in [(&reversed, true), (&shuffled, false), (&shuffled, true)] {
            let text = atom_site_cif(&COLUMNS, ROWS, order, wrap);
            assert_eq!(ca_summary(&text), want, "order {order:?}, wrapped {wrap}");
            let ca = serde_json::to_value(parse_pdb_or_mmcif_ca_coordinates(&text)).unwrap();
            assert_eq!(ca, standard_ca, "order {order:?}, wrapped {wrap}");
            assert_eq!(parse_mmcif_structure(&text).unwrap(), standard_model, "order {order:?}");
        }
    }

    #[test]
    fn missing_atom_site_column_is_named_in_the_error() {
        // Stated here rather than read from the constant, so dropping a column from the
        // implementation's list fails this test instead of shrinking it.
        let required = [
            "group_PDB",
            "label_atom_id",
            "label_comp_id",
            "label_asym_id",
            "label_seq_id",
            "Cartn_x",
            "Cartn_y",
            "Cartn_z",
        ];
        assert_eq!(REQUIRED_ATOM_SITE_COLUMNS, required);
        for missing in required {
            let keep: Vec<usize> = (0..COLUMNS.len()).filter(|&i| COLUMNS[i] != missing).collect();
            assert_eq!(keep.len(), COLUMNS.len() - 1, "{missing} is a fixture column");
            let text = atom_site_cif(&COLUMNS, ROWS, &keep, false);
            let column = format!("_atom_site.{missing}");
            let err = parse_mmcif_structure(&text).unwrap_err();
            assert_eq!(err, MmcifError::MissingColumn { column: column.clone() });
            assert!(err.to_string().contains(&column), "message does not name {column}: {err}");
            assert_eq!(try_parse_pdb_or_mmcif_ca_coordinates(&text).unwrap_err(), err);
        }
        for optional in [
            "id",
            "type_symbol",
            "label_alt_id",
            "pdbx_PDB_ins_code",
            "occupancy",
            "B_iso_or_equiv",
            "auth_seq_id",
            "auth_asym_id",
            "pdbx_PDB_model_num",
        ] {
            let keep: Vec<usize> = (0..COLUMNS.len()).filter(|&i| COLUMNS[i] != optional).collect();
            let text = atom_site_cif(&COLUMNS, ROWS, &keep, false);
            let s = parse_mmcif_structure(&text).unwrap_or_else(|e| panic!("without {optional}: {e}"));
            assert_eq!(s.models.len(), 1);
            assert_eq!((s.models[0].atom_record_count, s.models[0].hetatm_record_count), (5, 1));
        }
        // A value that is present but unreadable is named too, with its line.
        let row = ROWS[0].replace("6.134", "6,134");
        let bad = atom_site_cif(&COLUMNS, &[row.as_str()], &all_columns(), false);
        let err = parse_mmcif_structure(&bad).unwrap_err();
        assert!(
            matches!(&err, MmcifError::BadValue { column, value, line: 25, .. }
                if column == "_atom_site.Cartn_y" && value == "6,134"),
            "{err:?}"
        );
        assert!(err.to_string().contains("line 25"), "{err}");
    }

    #[test]
    fn alternate_locations_keep_one_conformer() {
        let rows = [
            "ATOM 1 C CA . GLY A 1 1 ? 0.0 0.0 0.0 1.00 10.0 ? 1 GLY A CA 1",
            // CA: B has the higher occupancy and is listed second.
            "ATOM 2 C CA A SER A 1 2 ? 1.0 1.0 1.0 0.40 10.0 ? 2 SER A CA 1",
            "ATOM 3 C CA B SER A 1 2 ? 2.0 2.0 2.0 0.60 11.0 ? 2 SER A CA 1",
            // CB: a tie, so the row listed first.
            "ATOM 4 C CB A SER A 1 2 ? 3.0 3.0 3.0 0.50 10.0 ? 2 SER A CB 1",
            "ATOM 5 C CB B SER A 1 2 ? 4.0 4.0 4.0 0.50 10.0 ? 2 SER A CB 1",
            // OG: A has the higher occupancy and is listed first.
            "ATOM 6 O OG A SER A 1 2 ? 5.0 5.0 5.0 0.70 10.0 ? 2 SER A OG 1",
            "ATOM 7 O OG B SER A 1 2 ? 6.0 6.0 6.0 0.30 10.0 ? 2 SER A OG 1",
            "ATOM 8 N N . ALA A 1 3 ? 7.0 7.0 7.0 1.00 10.0 ? 3 ALA A N 1",
            // A row with no occupancy ranks below one that has it.
            "ATOM 9 C CA A ALA A 1 3 ? 8.0 8.0 8.0 ? 10.0 ? 3 ALA A CA 1",
            "ATOM 10 C CA B ALA A 1 3 ? 9.0 9.0 9.0 0.20 10.0 ? 3 ALA A CA 1",
            // Microheterogeneity: two residue types at one position stay two residues.
            "ATOM 11 C CA A THR A 1 4 ? 10.0 10.0 10.0 0.60 10.0 ? 4 THR A CA 1",
            "ATOM 12 C CA B VAL A 1 4 ? 11.0 11.0 11.0 0.40 10.0 ? 4 VAL A CA 1",
        ];
        let text = atom_site_cif(&COLUMNS, &rows, &all_columns(), false);
        let s = parse_mmcif_structure(&text).unwrap();
        let model = &s.models[0];
        assert_eq!(model.atom_record_count, 12, "every row read is counted");
        let residues = &model.chains[0].residues;
        let names: Vec<&str> = residues.iter().map(|r| r.res_name.as_str()).collect();
        assert_eq!(names, ["GLY", "SER", "ALA", "THR", "VAL"]);
        let kept = |r: usize| -> Vec<(&str, Option<&str>, f64, usize)> {
            residues[r].atoms.iter().map(|a| (a.name.as_str(), a.alt_loc.as_deref(), a.x, a.serial)).collect()
        };
        assert_eq!(kept(1), [("CA", Some("B"), 2.0, 3), ("CB", Some("A"), 3.0, 4), ("OG", Some("A"), 5.0, 6)]);
        assert_eq!(kept(2), [("N", None, 7.0, 8), ("CA", Some("B"), 9.0, 10)]);
        let ca = parse_pdb_or_mmcif_ca_coordinates(&text);
        assert_eq!(ca.len(), 5, "one C-alpha per residue that has one");
        assert_eq!((ca[1].res_name.as_str(), ca[1].x, ca[1].b_factor), ("SER", 2.0, 11.0));
        assert_eq!((ca[2].res_name.as_str(), ca[2].x), ("ALA", 9.0));
    }

    #[test]
    fn quoted_values_and_missing_markers_are_read() {
        let text = concat!(
            "data_Q\n",
            "# loop_ _atom_site.in_a_comment\n",
            "_struct_conf.conf_type_id HELX_P\n",
            "_struct_conf.id HELX_P1\n",
            "_struct_conf.beg_label_comp_id ILE\n",
            "_struct_conf.beg_label_asym_id A\n",
            "_struct_conf.beg_label_seq_id 7\n",
            "_struct_conf.end_label_comp_id PRO\n",
            "_struct_conf.end_label_asym_id A\n",
            "_struct_conf.end_label_seq_id 19\n",
            "_struct_conf.details 'DISTORTED 3/10 AT RES 30'\n",
            "_pdbx_entry_details.compound_details\n",
            ";A TEXT FIELD THAT LOOKS LIKE A LOOP\n",
            "loop_\n",
            "_atom_site.not_a_column\n",
            ";\n",
            "loop_\n",
            "_atom_site.group_PDB\n",
            "_atom_site.id\n",
            "_atom_site.label_atom_id\n",
            "_atom_site.label_comp_id\n",
            "_atom_site.label_asym_id\n",
            "_atom_site.label_seq_id\n",
            "_atom_site.Cartn_x\n",
            "_atom_site.Cartn_y\n",
            "_atom_site.Cartn_z\n",
            "_atom_site.B_iso_or_equiv\n",
            "_atom_site.auth_asym_id\n",
            "ATOM 1 \"O5'\" DG C 1 1.0 2.0 3.0 ? '.'\n",
            "HETATM 2 'C1 X' \"LIG A\" D . 4.0 5.0 6.0 7.5 .\n",
        );
        let s = parse_mmcif_structure(text).unwrap();
        let chains = &s.models[0].chains;
        assert_eq!(chains.len(), 2);
        let dg = &chains[0].residues[0];
        assert_eq!((dg.res_name.as_str(), dg.atoms[0].name.as_str()), ("DG", "O5'"));
        assert_eq!(dg.atoms[0].b_factor, None, "bare ? is a missing value");
        assert_eq!(chains[0].auth_asym_id, ".", "quoted '.' is the character, not a missing value");
        let lig = &chains[1].residues[0];
        assert_eq!(
            (lig.res_name.as_str(), lig.atoms[0].name.as_str(), lig.label_seq_id),
            ("LIG A", "C1 X", None)
        );
        assert_eq!(chains[1].auth_asym_id, "D", "a bare . author id falls back to the label id");
        assert_eq!(s.helices.len(), 1, "a one-row category written as tag-value pairs");
        assert_eq!((s.helices[0].begin.label_seq_id, s.helices[0].end.label_seq_id), (7, 19));
        let turn = text.replace("conf_type_id HELX_P", "conf_type_id TURN_P");
        assert_eq!(parse_mmcif_structure(&turn).unwrap().helices, [], "a turn is not a helix");
        // Only the first data block is read: a second _atom_site there would be a duplicate.
        let two_blocks = format!("{text}data_SECOND\n_atom_site.group_PDB ATOM\n");
        assert_eq!(parse_mmcif_structure(&two_blocks).unwrap(), s);

        let unclosed = "data_x\nloop_\n_atom_site.id\n'open\n";
        assert!(matches!(parse_mmcif_structure(unclosed), Err(MmcifError::Syntax { line: 4, .. })));
        let ragged = "data_x\nloop_\n_atom_site.id\n_atom_site.group_PDB\n1 ATOM 2\n";
        assert!(matches!(
            parse_mmcif_structure(ragged),
            Err(MmcifError::LoopShape { values: 3, columns: 2, .. })
        ));
        assert_eq!(parse_mmcif_structure("data_x\n_cell.length_a 1\n"), Err(MmcifError::NoAtomSite));
    }

    // Reference data: the same MOLBIOCRAFT_TEST_DATA_DIR / MOLBIOCRAFT_REQUIRE_TEST_DATA rules as
    // crates/molbiocraft-align/tests/outside_data_reference.rs.
    fn test_data_dir() -> PathBuf {
        let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
            Some(d) if !d.is_empty() => repo.join(d),
            _ => repo.join("test-data"),
        }
    }

    fn data_required() -> bool {
        let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
        match v.to_str() {
            Some("1") => true,
            Some("" | "0") => false,
            _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
        }
    }

    /// A reference-data file, or `None` (after printing the skip line) when absent and not required.
    fn reference_text(rel: &str) -> Option<String> {
        let required = data_required();
        let p = test_data_dir().join(rel);
        match std::fs::read_to_string(&p) {
            Ok(s) => Some(s),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
                assert!(
                    !required,
                    "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}",
                    p.display()
                );
                eprintln!("skipped: reference data absent ({})", p.display());
                None
            }
            Err(e) => panic!("{}: unreadable: {e}", p.display()),
        }
    }

    /// Length and CRC-32 of the C-alpha list as the RPC op serialises it, so any field change shows.
    fn ca_digest(text: &str) -> (usize, u32) {
        let atoms = parse_pdb_or_mmcif_ca_coordinates(text);
        (atoms.len(), crc32fast::hash(serde_json::to_string(&atoms).unwrap().as_bytes()))
    }

    /// The sample library's tracked C-alpha traces of RCSB 1D66 and 1A4Y (molbiocraft-cloning's
    /// sample_structures; its nightly check proves each is its entry's CA records).
    const TRACKED_TRACES: [(&str, &str); 2] = [
        ("1d66_ca.pdb", include_str!("../../molbiocraft-cloning/src/sample_structures/1d66_ca.pdb")),
        ("1a4y_ca.pdb", include_str!("../../molbiocraft-cloning/src/sample_structures/1a4y_ca.pdb")),
    ];

    #[test]
    fn ca_view_is_unchanged_for_legacy_pdb() {
        // Digests recorded from the reader before the full-atom model existed (commit def1df4),
        // on these two traces. That reader gives 1A4Y's trace 0xcfc4_614d, as it gave the earlier
        // full-atom copy of 1A4Y. 1D66's trace was regenerated from the RCSB entry's coordinates
        // (D0089): the earlier copy's digest was 0x5362_fecd, and the def1df4 reader gives
        // 0x60c5_ae42 for the regenerated one.
        for ((file, text), want) in TRACKED_TRACES.into_iter().zip([(114, 0x60c5_ae42), (1166, 0xcfc4_614d)]) {
            assert_eq!(ca_digest(text), want, "{file}");
        }

        let Some(text) = reference_text("rcsb/1CRN.pdb") else { return };
        let atoms = parse_pdb_or_mmcif_ca_coordinates(&text);
        assert_eq!(atoms.len(), 46);
        let first = &atoms[0];
        assert_eq!(
            (first.serial, first.res_name.as_str(), first.chain_id.as_str(), first.res_seq),
            (2, "THR", "A", 1)
        );
        assert_eq!((first.x, first.y, first.z, first.b_factor), (16.967, 12.784, 4.338, 10.80));
        // HELIX 7-19 and 23-30, SHEET 1-4 and 32-35.
        let ss: String = atoms.iter().map(|a| a.secondary_structure.as_str()).collect();
        let want: String = (1..=46)
            .map(|i| match i {
                7..=19 | 23..=30 => 'H',
                1..=4 | 32..=35 => 'E',
                _ => 'C',
            })
            .collect();
        assert_eq!(ss, want);
        assert_eq!(ca_digest(&text), (46, 0xcb4b_9dcf));
    }

    // ─── Legacy PDB into the full-atom model ───

    /// `atom_site_cif` rows written as legacy PDB records instead, with author chain and residue
    /// ids, and `MODEL`/`ENDMDL` around each model.
    fn pdb_from_rows(rows: &[&str]) -> String {
        fn missing(v: &str) -> &str {
            if v == "?" || v == "." {
                ""
            } else {
                v
            }
        }
        let mut s = String::new();
        let mut model = "";
        for row in rows {
            let v: Vec<&str> = row.split_whitespace().collect();
            assert_eq!(v.len(), COLUMNS.len(), "fixture row {row}");
            if v[20] != model {
                if !model.is_empty() {
                    s.push_str("ENDMDL\n");
                }
                model = v[20];
                s.push_str(&format!("MODEL     {model:>4}\n"));
            }
            let (name, element) = (v[3], v[2]);
            // One-letter elements start the name in column 14, as the format aligns them.
            let name = if name.len() < 4 && element.len() == 1 { format!(" {name:<3}") } else { format!("{name:<4}") };
            let num = |t: &str| t.parse::<f64>().unwrap();
            let opt = |t: &str| match missing(t) {
                "" => String::new(),
                t => format!("{:.2}", num(t)),
            };
            s.push_str(&format!(
                "{:<6}{:>5} {name}{:1}{:>3} {:1}{:>4}{:1}   {:>8.3}{:>8.3}{:>8.3}{:>6}{:>6}          {element:>2}  \n",
                v[0],
                v[1],
                missing(v[4]),
                v[5],
                v[18],
                v[16],
                missing(v[9]),
                num(v[10]),
                num(v[11]),
                num(v[12]),
                opt(v[13]),
                opt(v[14]),
            ));
        }
        s.push_str("ENDMDL\nEND\n");
        s
    }

    /// The alternate-location rows of `alternate_locations_keep_one_conformer`, where label and
    /// author ids agree, then a HEM iron on a label chain of its own (B) but author chain A, then
    /// a second model of three atoms.
    fn two_model_rows() -> Vec<String> {
        let mut rows: Vec<String> = [
            "ATOM 1 C CA . GLY A 1 1 ? 0.0 0.0 0.0 1.00 10.0 ? 1 GLY A CA 1",
            "ATOM 2 C CA A SER A 1 2 ? 1.0 1.0 1.0 0.40 10.0 ? 2 SER A CA 1",
            "ATOM 3 C CA B SER A 1 2 ? 2.0 2.0 2.0 0.60 11.0 ? 2 SER A CA 1",
            "ATOM 4 C CB A SER A 1 2 ? 3.0 3.0 3.0 0.50 10.0 ? 2 SER A CB 1",
            "ATOM 5 C CB B SER A 1 2 ? 4.0 4.0 4.0 0.50 10.0 ? 2 SER A CB 1",
            "ATOM 6 O OG A SER A 1 2 ? 5.0 5.0 5.0 0.70 10.0 ? 2 SER A OG 1",
            "ATOM 7 O OG B SER A 1 2 ? 6.0 6.0 6.0 0.30 10.0 ? 2 SER A OG 1",
            "ATOM 8 N N . ALA A 1 3 ? 7.0 7.0 7.0 1.00 10.0 ? 3 ALA A N 1",
            "ATOM 9 C CA A ALA A 1 3 ? 8.0 8.0 8.0 ? 10.0 ? 3 ALA A CA 1",
            "ATOM 10 C CA B ALA A 1 3 ? 9.0 9.0 9.0 0.20 10.0 ? 3 ALA A CA 1",
            "ATOM 11 C CA A THR A 1 4 ? 10.0 10.0 10.0 0.60 10.0 ? 4 THR A CA 1",
            "ATOM 12 C CA B VAL A 1 4 ? 11.0 11.0 11.0 0.40 10.0 ? 4 VAL A CA 1",
            "HETATM 13 FE FE . HEM B 2 . ? 12.0 12.0 12.0 1.00 15.0 ? 5 HEM A FE 1",
        ]
        .map(String::from)
        .to_vec();
        for (serial, row) in rows.clone()[..3].iter().enumerate() {
            let v: Vec<&str> = row.split_whitespace().collect();
            let mut w = v.clone();
            let id = (14 + serial).to_string();
            let x = format!("{}.5", 20 + serial);
            w[1] = &id;
            w[10] = &x;
            w[20] = "2";
            rows.push(w.join(" "));
        }
        rows
    }

    #[test]
    fn pdb_follows_the_mmcif_rules_for_models_and_alternate_locations() {
        let rows = two_model_rows();
        let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
        let cif = parse_mmcif_structure(&atom_site_cif(&COLUMNS, &rows, &all_columns(), false)).unwrap();
        let pdb_text = pdb_from_rows(&rows);
        let pdb = parse_pdb_structure(&pdb_text).unwrap_or_else(|e| panic!("{e}\n{pdb_text}"));
        assert_eq!(pdb.models.len(), 2, "models are kept separately\n{pdb_text}");
        // The fixture's label ids are its author ids, and the HEM's label chain is B: apart from
        // that chain, which a legacy file cannot express, the two models are the same.
        let mut cif_models = cif.models.clone();
        let hem = cif_models[0].chains.remove(1);
        assert_eq!(hem.label_asym_id, "B");
        let mut pdb_models = pdb.models.clone();
        let pdb_hem = pdb_models[0].chains[0].residues.pop().unwrap();
        assert_eq!(pdb_models, cif_models);
        let mut want_hem = hem.residues[0].clone();
        want_hem.label_seq_id = Some(5);
        assert_eq!(pdb_hem, want_hem, "a ligand's label residue number is its author number");
        assert_eq!((pdb.models[0].atom_record_count, pdb.models[0].hetatm_record_count), (12, 1));
        assert_eq!((pdb.models[1].atom_record_count, pdb.models[1].hetatm_record_count), (3, 0));
        assert!(pdb.label_ids_from_author && !cif.label_ids_from_author);
        assert_eq!(
            serde_json::to_value(ca_atoms_of_structure(&pdb)).unwrap(),
            serde_json::to_value(ca_atoms_of_structure(&cif)).unwrap()
        );

        // The drawn C-alpha list of a legacy file is its first model only.
        let model = |n: i32, x: f64| {
            format!("MODEL     {n:>4}\n{}{}ENDMDL\n", ca_record(1, "GLY", 'A', 1, x), ca_record(2, "ALA", 'A', 2, x + 3.8))
        };
        let nmr = format!("{}{}END\n", model(1, 1.0), model(2, 50.0));
        let drawn: Vec<(i32, f64)> = parse_pdb_or_mmcif_ca_coordinates(&nmr).iter().map(|a| (a.res_seq, a.x)).collect();
        assert_eq!(drawn, [(1, 1.0), (2, 4.8)]);
        // The second MODEL record ends the first model, with or without an ENDMDL before it.
        let no_endmdl = nmr.replace("ENDMDL\n", "");
        assert_eq!(parse_pdb_or_mmcif_ca_coordinates(&no_endmdl).len(), 2);
        assert_eq!(parse_pdb_structure(&no_endmdl).unwrap().models.len(), 2);
    }

    /// An `ATOM` record of a C-alpha at (`x`, 0, 0), occupancy 1, B-factor 20, element C.
    fn ca_record(serial: usize, res: &str, chain: char, seq: i32, x: f64) -> String {
        format!("ATOM  {serial:>5}  CA  {res:>3} {chain}{seq:>4}    {x:>8.3}{:>8.3}{:>8.3}  1.00 20.00           C  \n", 0.0, 0.0)
    }

    #[test]
    fn pdb_columns_are_read_where_the_format_puts_them() {
        // A record with every field filled; one with a blank chain id, occupancy, tempFactor and
        // element; names whose element must come from columns 13-16; and a calcium written
        // ` CA ` (aligned like a carbon) whose element columns say what it is.
        let text = concat!(
            "HETATM 1234 FE  BHEM X 512C     11.104  -6.134 123.504  0.45 33.21          FE  \n",
            "ATOM      7  CA  GLY     9      -1.000   2.000  -3.000                        \n",
            "ATOM      8 HG21 THR Q  10       1.000   1.000   1.000  1.00 10.00            \n",
            "ATOM      9 1HG1 VAL Q  11       2.000   2.000   2.000  1.00 10.00            \n",
            "HETATM   10 CA    CA Q 301       3.000   3.000   3.000  1.00 10.00            \n",
            "HETATM   11  CA   CA Q 302       4.000   4.000   4.000  1.00 10.00          CA  \n",
        );
        let s = parse_pdb_structure(text).unwrap();
        let chains = &s.models[0].chains;
        let ids: Vec<(&str, &str)> = chains.iter().map(|c| (c.label_asym_id.as_str(), c.auth_asym_id.as_str())).collect();
        assert_eq!(ids, [("X", "X"), ("", ""), ("Q", "Q")], "a blank chain id is an empty string");
        let hem = &chains[0].residues[0];
        assert_eq!(
            (hem.res_name.as_str(), hem.label_seq_id, hem.auth_seq_id, hem.ins_code.as_deref()),
            ("HEM", Some(512), Some(512), Some("C"))
        );
        assert_eq!(
            hem.atoms[0],
            StructureAtom {
                serial: 1234,
                name: "FE".into(),
                element: Some("FE".into()),
                alt_loc: Some("B".into()),
                x: 11.104,
                y: -6.134,
                z: 123.504,
                occupancy: Some(0.45),
                b_factor: Some(33.21),
                record: AtomRecord::Hetatm,
            }
        );
        let gly = &chains[1].residues[0];
        assert_eq!((gly.res_name.as_str(), gly.auth_seq_id, gly.ins_code.as_deref()), ("GLY", Some(9), None));
        let ca = &gly.atoms[0];
        assert_eq!((ca.serial, ca.name.as_str(), ca.alt_loc.as_deref(), ca.record), (7, "CA", None, AtomRecord::Atom));
        assert_eq!((ca.x, ca.y, ca.z, ca.occupancy, ca.b_factor), (-1.0, 2.0, -3.0, None, None), "blank columns are no value");
        // Blank element columns: the element comes from how the name sits in columns 13-16.
        // Filled ones win over the name.
        let elements: Vec<(&str, Option<&str>)> = chains
            .iter()
            .flat_map(|c| &c.residues)
            .flat_map(|r| &r.atoms)
            .map(|a| (a.name.as_str(), a.element.as_deref()))
            .collect();
        assert_eq!(
            elements,
            [
                ("FE", Some("FE")),
                ("CA", Some("C")),
                ("HG21", Some("H")),
                ("1HG1", Some("H")),
                ("CA", Some("CA")),
                ("CA", Some("CA")),
            ]
        );

        // Values that cannot be read are named, with their line, field and columns.
        let line2 = |l: &str| format!("HELIX    1   1 ALA A    2  ALA A    4  1\n{l}\n");
        let good = "ATOM      7  CA  GLY A   9      -1.000   2.000  -3.000  1.00 20.00           C  ";
        let cases = [
            (good.replace("-1.000", "-1.0.0"), "PDB line 2: ATOM x (columns 31-38) is '-1.0.0', expected a number"),
            (good.replace("    7", "     "), "PDB line 2: ATOM serial (columns 7-11) is blank, expected a whole number"),
            (good.replace(" CA ", "    "), "PDB line 2: ATOM name (columns 13-16) is blank, expected an atom name"),
            (good.replace("   9", "  9x"), "PDB line 2: ATOM resSeq (columns 23-26) is '9x', expected an integer"),
            (good.replace(" 20.00", " 2O.00"), "PDB line 2: ATOM tempFactor (columns 61-66) is '2O.00', expected a number"),
            (good[..50].to_string(), "PDB line 2: ATOM z (columns 47-54) is '-3', expected a number ending at column 54"),
            (good.replace("GLY", "GLÝ"), "is not ASCII"),
        ];
        for (line, want) in cases {
            let err = parse_pdb_structure(&line2(&line)).unwrap_err();
            if want == "is not ASCII" {
                assert!(matches!(&err, PdbError::BadValue { line: 2, field, .. } if field == "ATOM record"), "{err:?}");
            } else {
                assert_eq!(err.to_string(), want);
            }
        }
        let bad_helix = format!("HELIX    1   1 ALA A    x  ALA A    4  1\n{good}\n");
        assert_eq!(
            parse_pdb_structure(&bad_helix).unwrap_err().to_string(),
            "PDB line 1: HELIX initSeqNum (columns 22-25) is 'x', expected an integer"
        );
        let bad_model = format!("MODEL     one\n{good}\n");
        assert!(matches!(parse_pdb_structure(&bad_model), Err(PdbError::BadValue { line: 1, .. })));
        // No ATOM or HETATM record: no coordinates, not an empty structure.
        assert_eq!(parse_pdb_structure(&line2("TER")), Err(PdbError::NoAtoms));
        assert_eq!(parse_pdb_structure(""), Err(PdbError::NoAtoms));
    }

    #[test]
    fn mmcif_segments_set_each_residue_by_its_label_ids() {
        // A helix from SER 2 to the position 4 modelled as THR and VAL: both residue types are in it.
        // Position 4 carries an author insertion code the helix row does not give; in mmCIF the
        // label residue number alone names the position.
        let rows: Vec<String> = two_model_rows()
            .into_iter()
            .take(12)
            .map(|r| if r.contains(" 4 ? ") { r.replace(" 4 ? ", " 4 A ") } else { r })
            .collect();
        assert_eq!(rows.iter().filter(|r| r.contains(" 4 A ")).count(), 2);
        let rows: Vec<&str> = rows.iter().map(String::as_str).collect();
        let mut text = atom_site_cif(&COLUMNS, &rows, &all_columns(), false);
        text.push_str(concat!(
            "_struct_conf.conf_type_id HELX_P\n_struct_conf.id HELX_P1\n",
            "_struct_conf.beg_label_asym_id A\n_struct_conf.beg_label_seq_id 2\n",
            "_struct_conf.end_label_asym_id A\n_struct_conf.end_label_seq_id 4\n",
        ));
        let s = parse_mmcif_structure(&text).unwrap();
        let ss: Vec<(&str, Option<SecondaryStructureKind>)> =
            s.models[0].chains[0].residues.iter().map(|r| (r.res_name.as_str(), r.secondary_structure)).collect();
        let h = Some(SecondaryStructureKind::Helix);
        assert_eq!(ss, [("GLY", None), ("SER", h), ("ALA", h), ("THR", h), ("VAL", h)]);
        // A segment whose last residue is not in the chain covers nothing, but stays listed.
        let past_the_end = text.replace("end_label_seq_id 4", "end_label_seq_id 40");
        let s = parse_mmcif_structure(&past_the_end).unwrap();
        assert_eq!(s.helices.len(), 1);
        assert!(s.models[0].chains[0].residues.iter().all(|r| r.secondary_structure.is_none()));
    }

    /// Caffeine, C8H10N4O2, as 24 `HETATM` records with no residue name, no chain id and no
    /// element columns (each line ends at the temperature factor, column 66), so every element
    /// comes from the atom name: carbons, nitrogens and oxygens named from column 14 (" C1 "),
    /// hydrogens from column 13 ("H1  " to "H10 "). The coordinates are points on a spiral, not
    /// caffeine's geometry, which this test does not check.
    fn caffeine_pdb() -> String {
        let names: Vec<String> = [("C", 8), ("N", 4), ("O", 2)]
            .iter()
            .flat_map(|&(e, n)| (1..=n).map(move |i| format!(" {:<3}", format!("{e}{i}"))))
            .chain((1..=10).map(|i| format!("{:<4}", format!("H{i}"))))
            .collect();
        let mut text = String::from("COMPND    CAFFEINE\n");
        for (i, name) in names.iter().enumerate() {
            let t = i as f64;
            let (x, y, z) = (1.25 * (t * 0.7).cos() + 0.1 * t, 1.25 * (t * 0.7).sin() - 0.05 * t, 0.3 * (t * 1.3).sin());
            text.push_str(&format!("HETATM{:>5} {name}      {:>4}    {x:8.3}{y:8.3}{z:8.3}  1.00  0.00\n", i + 1, 1));
        }
        text.push_str("END\n");
        text
    }

    #[test]
    fn sample_pdb_files_read_into_the_model() {
        // Caffeine, C8H10N4O2: no residue name, no chain id, no element columns.
        let text = caffeine_pdb();
        let lines: Vec<&str> = text.lines().filter(|l| l.starts_with("HETATM")).collect();
        assert_eq!(lines.len(), 24);
        for l in &lines {
            assert_eq!((l.len(), &l[17..20], &l[21..22]), (66, "   ", " "), "{l}");
        }
        let s = parse_pdb_structure(&text).unwrap();
        let model = &s.models[0];
        assert_eq!((model.atom_record_count, model.hetatm_record_count), (0, 24));
        assert_eq!((model.chains.len(), model.chains[0].auth_asym_id.as_str()), (1, ""));
        let residues = &model.chains[0].residues;
        assert_eq!((residues.len(), residues[0].res_name.as_str(), residues[0].auth_seq_id), (1, "", Some(1)));
        let mut formula: BTreeMap<String, usize> = BTreeMap::new();
        for a in &residues[0].atoms {
            *formula.entry(a.element.clone().expect("element from the atom name")).or_default() += 1;
        }
        let want: BTreeMap<String, usize> = [("C", 8), ("H", 10), ("N", 4), ("O", 2)].map(|(e, n)| (e.to_string(), n)).into();
        assert_eq!(formula, want);

        // Protein files: one segment per record, and each residue's secondary structure is the
        // letter the C-alpha list drawn from the same file gives its C-alpha.
        for ((file, text), (helices, strands)) in TRACKED_TRACES.into_iter().zip([(6, 0), (40, 46)]) {
            let s = parse_pdb_structure(text).unwrap_or_else(|e| panic!("{file}: {e}"));
            assert_eq!((s.helices.len(), s.strands.len()), (helices, strands), "{file}");
            let letter = |k: Option<SecondaryStructureKind>| match k {
                Some(SecondaryStructureKind::Helix) => "H",
                Some(SecondaryStructureKind::Strand) => "E",
                None => "C",
            };
            let from_model: Vec<(String, i32, &str)> = s.models[0]
                .chains
                .iter()
                .flat_map(|c| c.residues.iter().map(move |r| (c, r)))
                .filter(|(_, r)| r.atoms.iter().any(|a| a.name == "CA" && a.record == AtomRecord::Atom))
                .map(|(c, r)| (c.auth_asym_id.clone(), r.auth_seq_id.unwrap(), letter(r.secondary_structure)))
                .collect();
            let drawn = parse_pdb_or_mmcif_ca_coordinates(text);
            let from_view: Vec<(String, i32, &str)> =
                drawn.iter().map(|a| (a.chain_id.clone(), a.res_seq, a.secondary_structure.as_str())).collect();
            assert_eq!(from_model, from_view, "{file}");
            assert!(from_model.iter().any(|(_, _, l)| *l == "H"), "{file}");
        }
    }
}
