// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0
// Reference amino-acid parameters: the one residue table every protein calculator reads.
//   Average residue masses: ExPASy ProtParam (free amino acid minus H2O, Da; water 18.01524).
//   Selenocysteine and pyrrolysine: Biopython IUPACData.protein_weights minus that water.
//   B, Z, J and X: the mean of the residues each letter may be (ExPASy Compute pI/Mw for B, Z, X).
//   Elemental compositions: the dehydrated in-chain residue (-NH-CH(R)-CO-), which the digest and
//   MS2 calculators weigh with monoisotopic and average atomic masses.
//   DIWV: Guruprasad, Reddy & Pandit (1990) Protein Eng. 4:155 dipeptide instability weights.
//   pKa: Bjellqvist et al. (1993/1994), the scale ExPASy ProtParam uses, plus selenocysteine (D0188).

/// The 20 standard residues in `aa_index` order, the order of `RESIDUE_MASS_DA` and `DIWV`.
const STANDARD_ORDER: &[u8; 20] = b"ACDEFGHIKLMNPQRSTVWY";

/// Average mass of each standard residue in a chain (free amino acid minus H2O), indexed by `aa_index`.
pub const RESIDUE_MASS_DA: [f64; 20] = [
    71.0788, 103.1388, 115.0886, 129.1155, 147.1766, 57.0519, 137.1411, 113.1594, 128.1741, 113.1594, 131.1926, 114.1038, 97.1167, 128.1307, 156.1875, 87.0782, 101.1051, 99.1326, 186.2132, 163.1760,
];

/// `ACDEFGHIKLMNPQRSTVWY` index of a standard amino-acid byte, or `None` for anything else
/// (U, O, B, Z, J and X too: they are in [`RESIDUES`] but not among the 20).
pub fn aa_index(b: u8) -> Option<usize> {
    STANDARD_ORDER.iter().position(|&x| x == b.to_ascii_uppercase())
}

/// Atoms of a dehydrated in-chain residue (`-NH-CH(R)-CO-`).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct Composition {
    pub c: i32,
    pub h: i32,
    pub n: i32,
    pub o: i32,
    pub s: i32,
    pub se: i32,
}

const fn atoms(c: i32, h: i32, n: i32, o: i32, s: i32, se: i32) -> Option<Composition> {
    Some(Composition { c, h, n, o, s, se })
}

/// What a letter of the protein alphabet stands for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResidueKind {
    /// One of the 20 standard residues.
    Standard,
    /// U, a residue of its own that titrates as an acid ([`PK_U`]).
    Selenocysteine,
    /// O, a residue of its own with no ionisable group in the Bjellqvist scale.
    Pyrrolysine,
    /// B, Z, J or X: one of several residues, weighed as their mean, with no charge.
    Ambiguous,
}

/// One letter of the protein alphabet.
#[derive(Debug, Clone, Copy)]
pub struct Residue {
    pub letter: u8,
    pub kind: ResidueKind,
    /// Average mass in a chain (Da).
    pub mass_da: f64,
    /// The atoms of the residue, or `None` for an ambiguity letter, which has no single one.
    pub composition: Option<Composition>,
}

const fn standard(i: usize, composition: Option<Composition>) -> Residue {
    Residue { letter: STANDARD_ORDER[i], kind: ResidueKind::Standard, mass_da: RESIDUE_MASS_DA[i], composition }
}

/// Biopython 1.88 `IUPACData.protein_weights` (free amino acid, Da) of selenocysteine and pyrrolysine.
const SELENOCYSTEINE_FREE_DA: f64 = 168.0532;
const PYRROLYSINE_FREE_DA: f64 = 255.3134;

/// The unweighted mean of the 20 standard residue masses, which X (any residue) weighs.
const fn mean_standard_mass() -> f64 {
    let mut sum = 0.0;
    let mut i = 0;
    while i < 20 {
        sum += RESIDUE_MASS_DA[i];
        i += 1;
    }
    sum / 20.0
}

/// The mean mass of two standard residues, given by their `STANDARD_ORDER` positions.
const fn mean_of(a: usize, b: usize) -> f64 {
    (RESIDUE_MASS_DA[a] + RESIDUE_MASS_DA[b]) / 2.0
}

/// Every letter the protein calculators read: the 20 (in `aa_index` order), then U, O, B, Z, J, X.
pub const RESIDUES: [Residue; 26] = [
    standard(0, atoms(3, 5, 1, 1, 0, 0)),   // A
    standard(1, atoms(3, 5, 1, 1, 1, 0)),   // C
    standard(2, atoms(4, 5, 1, 3, 0, 0)),   // D
    standard(3, atoms(5, 7, 1, 3, 0, 0)),   // E
    standard(4, atoms(9, 9, 1, 1, 0, 0)),   // F
    standard(5, atoms(2, 3, 1, 1, 0, 0)),   // G
    standard(6, atoms(6, 7, 3, 1, 0, 0)),   // H
    standard(7, atoms(6, 11, 1, 1, 0, 0)),  // I
    standard(8, atoms(6, 12, 2, 1, 0, 0)),  // K
    standard(9, atoms(6, 11, 1, 1, 0, 0)),  // L
    standard(10, atoms(5, 9, 1, 1, 1, 0)),  // M
    standard(11, atoms(4, 6, 2, 2, 0, 0)),  // N
    standard(12, atoms(5, 7, 1, 1, 0, 0)),  // P
    standard(13, atoms(5, 8, 2, 2, 0, 0)),  // Q
    standard(14, atoms(6, 12, 4, 1, 0, 0)), // R
    standard(15, atoms(3, 5, 1, 2, 0, 0)),  // S
    standard(16, atoms(4, 7, 1, 2, 0, 0)),  // T
    standard(17, atoms(5, 9, 1, 1, 0, 0)),  // V
    standard(18, atoms(11, 10, 2, 1, 0, 0)), // W
    standard(19, atoms(9, 9, 1, 2, 0, 0)),  // Y
    Residue { letter: b'U', kind: ResidueKind::Selenocysteine, mass_da: SELENOCYSTEINE_FREE_DA - WATER_DA, composition: atoms(3, 5, 1, 1, 0, 1) },
    Residue { letter: b'O', kind: ResidueKind::Pyrrolysine, mass_da: PYRROLYSINE_FREE_DA - WATER_DA, composition: atoms(12, 19, 3, 2, 0, 0) },
    // B is D or N, Z is E or Q (ExPASy Compute pI/Mw weighs each as the mean of the two).
    Residue { letter: b'B', kind: ResidueKind::Ambiguous, mass_da: mean_of(2, 11), composition: None },
    Residue { letter: b'Z', kind: ResidueKind::Ambiguous, mass_da: mean_of(3, 13), composition: None },
    // J is I or L, which have one composition (and so one mass): J weighs and fragments as either.
    Residue { letter: b'J', kind: ResidueKind::Ambiguous, mass_da: mean_of(7, 9), composition: atoms(6, 11, 1, 1, 0, 0) },
    Residue { letter: b'X', kind: ResidueKind::Ambiguous, mass_da: mean_standard_mass(), composition: None },
];

/// The table row of a protein letter (any case), or `None` for a byte that is no letter.
pub fn residue(b: u8) -> Option<&'static Residue> {
    let u = b.to_ascii_uppercase();
    RESIDUES.iter().find(|r| r.letter == u)
}

/// Mass of one water molecule (Da), added once per polypeptide chain.
pub const WATER_DA: f64 = 18.01524;

/// DIWV[first][second] dipeptide instability weight.
pub const DIWV: [[f64; 20]; 20] = [
    [1.00, 44.94, -7.49, 1.00, 1.00, 1.00, -7.49, 1.00, 1.00, 1.00, 1.00, 1.00, 20.26, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00],
    [1.00, 1.00, 20.26, 1.00, 1.00, 1.00, 33.60, 1.00, 1.00, 20.26, 33.60, 1.00, 20.26, -6.54, 1.00, 1.00, 33.60, -6.54, 24.68, 1.00],
    [1.00, 1.00, 1.00, 1.00, -6.54, 1.00, 1.00, 1.00, -7.49, 1.00, 1.00, 1.00, 1.00, 1.00, -6.54, 20.26, -14.03, 1.00, 1.00, 1.00],
    [1.00, 44.94, 20.26, 33.60, 1.00, 1.00, -6.54, 20.26, 1.00, 1.00, 1.00, 1.00, 20.26, 20.26, 1.00, 20.26, 1.00, 1.00, -14.03, 1.00],
    [1.00, 1.00, 13.34, 1.00, 1.00, 1.00, 1.00, 1.00, -14.03, 1.00, 1.00, 1.00, 20.26, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 33.60],
    [-7.49, 1.00, 1.00, -6.54, 1.00, 13.34, 1.00, -7.49, -7.49, 1.00, 1.00, -7.49, 1.00, 1.00, 1.00, 1.00, -7.49, 1.00, 13.34, -7.49],
    [1.00, 1.00, 1.00, 1.00, -9.37, -9.37, 1.00, 44.94, 24.68, 1.00, 1.00, 24.68, -1.88, 1.00, 1.00, 1.00, -6.54, 1.00, -1.88, 44.94],
    [1.00, 1.00, 1.00, 44.94, 1.00, 1.00, 13.34, 1.00, -7.49, 20.26, 1.00, 1.00, -1.88, 1.00, 1.00, 1.00, 1.00, -7.49, 1.00, 1.00],
    [1.00, 1.00, 1.00, 1.00, 1.00, -7.49, 1.00, -7.49, 1.00, -7.49, 33.60, 1.00, -6.54, 24.64, 33.60, 1.00, 1.00, -7.49, 1.00, 1.00],
    [1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, -7.49, 1.00, 1.00, 1.00, 20.26, 33.60, 20.26, 1.00, 1.00, 1.00, 24.68, 1.00],
    [13.34, 1.00, 1.00, 1.00, 1.00, 1.00, 58.28, 1.00, 1.00, 1.00, -1.88, 1.00, 44.94, -6.54, -6.54, 44.94, -1.88, 1.00, 1.00, 24.68],
    [1.00, -1.88, 1.00, 1.00, -14.03, -14.03, 1.00, 44.94, 24.68, 1.00, 1.00, 1.00, -1.88, -6.54, 1.00, 1.00, -7.49, 1.00, -9.37, 1.00],
    [20.26, -6.54, -6.54, 18.38, 20.26, 1.00, 1.00, 1.00, 1.00, 1.00, -6.54, 1.00, 20.26, 20.26, -6.54, 20.26, 1.00, 20.26, -1.88, 1.00],
    [1.00, -6.54, 20.26, 20.26, -6.54, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 20.26, 20.26, 1.00, 44.94, 1.00, -6.54, 1.00, -6.54],
    [1.00, 1.00, 1.00, 1.00, 1.00, -7.49, 20.26, 1.00, 1.00, 1.00, 1.00, 13.34, 20.26, 20.26, 58.28, 44.94, 1.00, 1.00, 58.28, -6.54],
    [1.00, 33.60, 1.00, 20.26, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 1.00, 44.94, 20.26, 20.26, 20.26, 1.00, 1.00, 1.00, 1.00],
    [1.00, 1.00, 1.00, 20.26, 13.34, -7.49, 1.00, 1.00, 1.00, 1.00, 1.00, -14.03, 1.00, -6.54, 1.00, 1.00, 1.00, 1.00, -14.03, 1.00],
    [1.00, 1.00, -14.03, 1.00, 1.00, -7.49, 1.00, 1.00, -1.88, 1.00, 1.00, 1.00, 20.26, 1.00, 1.00, 1.00, -7.49, 1.00, 1.00, -6.54],
    [-14.03, 1.00, 1.00, 1.00, 1.00, -9.37, 24.68, 1.00, 1.00, 13.34, 24.68, 13.34, 1.00, 1.00, 1.00, 1.00, -14.03, -7.49, 1.00, 1.00],
    [24.68, 1.00, 24.68, -6.54, 1.00, -7.49, 13.34, 1.00, 1.00, 1.00, 44.94, 1.00, 13.34, 1.00, -15.91, 1.00, -7.49, 1.00, -9.37, 13.34],
];

/// Bjellqvist pKa values (ExPASy ProtParam): side chains, termini, and the
/// position-specific terminal values that override them for certain residues.
pub const PK_K: f64 = 10.0;
pub const PK_R: f64 = 12.0;
pub const PK_H: f64 = 5.98;
pub const PK_D: f64 = 4.05;
pub const PK_E: f64 = 4.45;
pub const PK_C: f64 = 9.0;
pub const PK_Y: f64 = 10.0;
/// Selenocysteine's selenol, an acid (D0188; Huber & Criddle 1967, Arch. Biochem. Biophys.
/// 122:164). ExPASy ProtParam does not titrate U, so this is the one value off its scale.
pub const PK_U: f64 = 5.2;
pub const PK_NTERM: f64 = 7.5;
pub const PK_CTERM: f64 = 3.55;

/// N-terminal pKa when the first residue is one of these.
pub const PK_NTERM_SPECIFIC: [(u8, f64); 7] =
    [(b'A', 7.59), (b'M', 7.0), (b'S', 6.93), (b'P', 8.36), (b'T', 6.82), (b'V', 7.44), (b'E', 7.7)];

/// C-terminal pKa when the last residue is one of these.
pub const PK_CTERM_SPECIFIC: [(u8, f64); 2] = [(b'D', 4.55), (b'E', 4.75)];
