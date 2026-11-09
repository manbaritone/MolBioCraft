// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Backbone torsions of one protein chain, and the Ramachandran region of each residue.
//!
//! ## Torsions
//!
//! Read from the first model of an mmCIF file's full-atom [`Structure`], over the chain's polymer
//! residues (`label_seq_id` set) in chain order, using the conformer the reader keeps for an atom
//! with alternate locations (see [`parse_mmcif_structure`]):
//!
//! - $\phi_i$ = C(i-1) - N(i) - CA(i) - C(i)
//! - $\psi_i$ = N(i) - CA(i) - C(i) - N(i+1)
//! - $\omega_i$ = CA(i-1) - C(i-1) - N(i) - CA(i), the peptide bond *before* residue i (the bond
//!   that makes a proline cis or trans)
//!
//! in degrees, in (-180, 180]. Two residues are joined when the distance C(i-1)-N(i) is below
//! [`PEPTIDE_BOND_MAX_ANGSTROM`] (1.8 Å), whatever their numbering says; a chain's first residue
//! and a residue after a break have no $\phi$ or $\omega$, its last residue and a residue before a
//! break have no $\psi$. This is the test Biopython's `PPBuilder` applies to split a chain into
//! polypeptides (C-N distance below its default radius of 1.8 Å), so on a chain of standard amino
//! acids without alternate locations the two report the same torsions. Where they differ:
//! `PPBuilder` (with its default `aa_only=1`) also ends a polypeptide at a residue outside the 20
//! standard amino acids, such as selenomethionine, where here such a residue is part of the chain
//! and has torsions when its backbone atoms are bonded; and `PPBuilder` tries every alternate
//! location of the C and N atoms for a bond, where here only the conformer kept is tested.
//! A residue missing N, CA or C has no torsion that needs the missing atom.
//!
//! ## Regions
//!
//! Each residue with both $\phi$ and $\psi$ is placed in a **favoured**, **allowed** or
//! **outlier** region by [`ramachandran_region`]: a lookup in a 10° x 10° grid for its
//! [`RamachandranClass`]. The grids (the `*_REGIONS` constants below) are a coarse approximation of
//! the Ramachandran categories MolProbity reports, not MolProbity's classifier:
//!
//! - **Source:** the Top8000 Ramachandran contour grids of the Richardson Laboratory, Duke
//!   University (Williams et al. 2018, *Protein Sci.* 27:293-315,
//!   doi:10.1002/pro.3330), file `Top8000/Top8000_ramachandran_pct_contour_grids/rama8000-*.data`
//!   of <https://github.com/rlabduke/reference_data>, licensed CC BY 4.0. Each file gives a value
//!   at 2° nodes (φ, ψ = -179, -177, ..., 179).
//! - **Cutoffs:** MolProbity's (Lovell et al. 2003, *Proteins* 50:437-450,
//!   doi:10.1002/prot.10286; as coded in cctbx `mmtbx/validation/ramalyze.py`): a node is
//!   favoured at a value of at least 0.02 (the contour enclosing 98% of the reference residues),
//!   allowed at least 0.0005 for the general case, 0.0020 for cis-Pro and 0.0010 for every other
//!   class, and an outlier below that.
//! - **Resampling (the change made to the source):** a 10° cell takes the median class of the
//!   25 nodes inside it (favoured when at least 13 nodes are favoured, outlier when at least 13
//!   are outliers, allowed otherwise).
//! - **Classes**, as MolProbity assigns them, the first that applies: Gly; Pro, cis when
//!   $-90° < \omega < 90°$ and trans otherwise; pre-Pro, a residue bonded to a following Pro;
//!   Ile/Val; and every other residue.
//!
//! In each grid, row `r` holds $\psi$ in [170 - 10 r, 180 - 10 r) (row 0 at the top is
//! $\psi$ = 170..180, row 35 is -180..-170) and column `c` holds $\phi$ in [-180 + 10 c,
//! -170 + 10 c); `#` is favoured, `+` allowed and `.` outlier. An angle of exactly 180 falls in
//! the cell of -180. Near a contour the 10° cell can give a different category from MolProbity.

use molbiocraft_formats::pdb_mmcif::{parse_mmcif_structure, Structure, StructureResidue};
use nalgebra::Vector3;
use serde::{Deserialize, Serialize};

/// C(i-1)-N(i) distance, in Å, from which two residues are not bonded (Biopython `PPBuilder`'s
/// default radius): a shorter distance is a peptide bond, this or a longer one a chain break.
pub const PEPTIDE_BOND_MAX_ANGSTROM: f64 = 1.8;

/// The region rule [`ramachandran_region`] applies, in words, as reports state it.
pub const RAMACHANDRAN_REGION_RULE: &str = "Favoured / allowed / outlier from 10-degree cells \
     resampled from the Richardson Lab Top8000 Ramachandran contours (Williams et al. 2018, CC BY \
     4.0) at MolProbity's cutoffs (Lovell et al. 2003): favoured >= 0.02, allowed >= 0.0005 \
     (general), 0.0020 (cis-Pro) or 0.0010 (other classes); separate maps for Gly, trans-Pro, \
     cis-Pro, pre-Pro, Ile/Val and all other residues. A coarse approximation, not MolProbity's \
     own classifier";

/// Which Ramachandran map a residue is judged on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum RamachandranClass {
    /// Every residue not in another class.
    General,
    Glycine,
    /// Pro whose preceding peptide bond has $\omega$ outside (-90°, 90°), or no $\omega$.
    TransProline,
    /// Pro whose preceding peptide bond has $-90° < \omega < 90°$.
    CisProline,
    /// A residue other than Gly or Pro bonded to a following Pro.
    PreProline,
    /// Ile or Val not before a Pro.
    IleVal,
}

/// A Ramachandran region.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum RamachandranRegion {
    Favoured,
    Allowed,
    Outlier,
}

/// One residue's backbone torsions.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidueTorsions {
    /// Author chain id (the id a PDB file shows).
    pub chain: String,
    /// `_atom_site.label_seq_id`.
    pub label_seq_id: Option<i32>,
    /// `_atom_site.auth_seq_id`, the residue number a PDB file and Biopython show.
    pub auth_seq_id: Option<i32>,
    pub ins_code: Option<String>,
    pub res_name: String,
    /// Degrees in (-180, 180]; `None` for a chain's first residue, after a break, or when a
    /// needed atom is missing.
    pub phi: Option<f64>,
    /// Degrees in (-180, 180]; `None` for a chain's last residue, before a break, or when a
    /// needed atom is missing.
    pub psi: Option<f64>,
    /// The preceding peptide bond, degrees in (-180, 180]; `None` for a chain's first residue,
    /// after a break, or when a needed atom is missing.
    pub omega: Option<f64>,
    pub ramachandran_class: RamachandranClass,
    /// `None` when `phi` or `psi` is.
    pub region: Option<RamachandranRegion>,
}

/// How many residues fell in each region.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RamachandranRegionCounts {
    pub favoured: usize,
    pub allowed: usize,
    pub outlier: usize,
    /// Residues without both `phi` and `psi`.
    pub unclassified: usize,
}

/// The backbone torsions of one chain.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackboneTorsionReport {
    /// Author chain id.
    pub chain: String,
    /// mmCIF label chain id.
    pub label_chain: String,
    /// The chain's polymer residues in chain order.
    pub residues: Vec<ResidueTorsions>,
    pub counts: RamachandranRegionCounts,
    /// Adjacent residue pairs not joined by a peptide bond (C-N at least
    /// `peptide_bond_max_angstrom` apart, or the C or N atom missing).
    pub chain_breaks: usize,
    pub peptide_bond_max_angstrom: f64,
    /// [`RAMACHANDRAN_REGION_RULE`].
    pub region_rule: String,
}

/// Backbone torsions of one chain of an mmCIF structure (see the module documentation).
///
/// `chain` names the chain by author id, then by label id; `None`, or a blank id, takes the
/// first protein chain (the first chain with a polymer residue that has a CA atom), the same rule
/// the superposition uses to pick a chain. Errors name what is missing: text that is not mmCIF,
/// an mmCIF file that cannot be read, a structure with no protein chain, or a named chain that is
/// not there (with the chains that are).
pub fn backbone_torsions(text: &str, chain: Option<&str>) -> Result<BackboneTorsionReport, String> {
    if text.trim().is_empty() {
        return Err("No structure text: load an mmCIF structure".into());
    }
    // The same test the formats crate uses to tell mmCIF from PDB text.
    if !text.contains("_atom_site.") {
        return Err("Backbone torsions need an mmCIF structure (no _atom_site category found)".into());
    }
    let structure = parse_mmcif_structure(text).map_err(|e| e.to_string())?;
    backbone_torsions_of_structure(&structure, chain)
}

/// [`backbone_torsions`] on a structure already read.
pub fn backbone_torsions_of_structure(
    structure: &Structure,
    chain: Option<&str>,
) -> Result<BackboneTorsionReport, String> {
    let model = structure
        .models
        .first()
        .ok_or("The structure holds no atoms")?;
    // Protein chains: label chains with a polymer residue that has a CA atom, in file order.
    let protein: Vec<_> = model
        .chains
        .iter()
        .filter(|c| {
            c.residues
                .iter()
                .any(|r| r.label_seq_id.is_some() && r.atoms.iter().any(|a| a.name == "CA"))
        })
        .collect();
    if protein.is_empty() {
        return Err("The structure has no protein chain: no polymer residue has a CA atom".into());
    }
    let picked = match chain.map(str::trim).filter(|c| !c.is_empty()) {
        None => protein[0],
        Some(id) => protein
            .iter()
            .find(|c| c.auth_asym_id == id)
            .or_else(|| protein.iter().find(|c| c.label_asym_id == id))
            .copied()
            .ok_or_else(|| {
                let ids: Vec<&str> = protein.iter().map(|c| c.auth_asym_id.as_str()).collect();
                format!("The structure has no protein chain '{id}' (its protein chains: {})", ids.join(", "))
            })?,
    };

    let residues: Vec<&StructureResidue> =
        picked.residues.iter().filter(|r| r.label_seq_id.is_some()).collect();
    let atom = |r: &StructureResidue, name: &str| {
        r.atoms.iter().find(|a| a.name == name).map(|a| Vector3::new(a.x, a.y, a.z))
    };
    let backbone: Vec<[Option<Vector3<f64>>; 3]> =
        residues.iter().map(|r| [atom(r, "N"), atom(r, "CA"), atom(r, "C")]).collect();
    // bonded[i]: residue i-1 and residue i are joined by a peptide bond.
    let bonded: Vec<bool> = (0..residues.len())
        .map(|i| {
            i > 0
                && match (backbone[i - 1][2], backbone[i][0]) {
                    (Some(c), Some(n)) => (n - c).norm() < PEPTIDE_BOND_MAX_ANGSTROM,
                    _ => false,
                }
        })
        .collect();
    let chain_breaks = bonded.iter().skip(1).filter(|b| !**b).count();

    let mut counts = RamachandranRegionCounts::default();
    let mut out = Vec::with_capacity(residues.len());
    for (i, r) in residues.iter().enumerate() {
        let [n, ca, c] = backbone[i];
        let prev = if bonded[i] { Some(backbone[i - 1]) } else { None };
        let next_bonded = i + 1 < residues.len() && bonded[i + 1];
        let next = if next_bonded { Some(backbone[i + 1]) } else { None };
        let phi = match (prev, n, ca, c) {
            (Some([_, _, Some(c0)]), Some(n), Some(ca), Some(c)) => dihedral(c0, n, ca, c),
            _ => None,
        };
        let psi = match (next, n, ca, c) {
            (Some([Some(n1), _, _]), Some(n), Some(ca), Some(c)) => dihedral(n, ca, c, n1),
            _ => None,
        };
        let omega = match (prev, n, ca) {
            (Some([_, Some(ca0), Some(c0)]), Some(n), Some(ca)) => dihedral(ca0, c0, n, ca),
            _ => None,
        };
        let next_name = if next_bonded { Some(residues[i + 1].res_name.as_str()) } else { None };
        let class = ramachandran_class(&r.res_name, next_name, omega);
        let region = match (phi, psi) {
            (Some(phi), Some(psi)) => ramachandran_region(class, phi, psi),
            _ => None,
        };
        match region {
            Some(RamachandranRegion::Favoured) => counts.favoured += 1,
            Some(RamachandranRegion::Allowed) => counts.allowed += 1,
            Some(RamachandranRegion::Outlier) => counts.outlier += 1,
            None => counts.unclassified += 1,
        }
        out.push(ResidueTorsions {
            chain: picked.auth_asym_id.clone(),
            label_seq_id: r.label_seq_id,
            auth_seq_id: r.auth_seq_id,
            ins_code: r.ins_code.clone(),
            res_name: r.res_name.clone(),
            phi,
            psi,
            omega,
            ramachandran_class: class,
            region,
        });
    }

    Ok(BackboneTorsionReport {
        chain: picked.auth_asym_id.clone(),
        label_chain: picked.label_asym_id.clone(),
        residues: out,
        counts,
        chain_breaks,
        peptide_bond_max_angstrom: PEPTIDE_BOND_MAX_ANGSTROM,
        region_rule: RAMACHANDRAN_REGION_RULE.into(),
    })
}

/// The dihedral angle a-b-c-d in degrees, in (-180, 180] (IUPAC sign: positive when, looking
/// along b->c, the bond to a turns clockwise to eclipse the bond to d). `None` when a, b, c or
/// b, c, d are collinear, or a coordinate is not finite, where the angle is undefined.
fn dihedral(a: Vector3<f64>, b: Vector3<f64>, c: Vector3<f64>, d: Vector3<f64>) -> Option<f64> {
    if ![a, b, c, d].iter().all(|p| p.iter().all(|x| x.is_finite())) {
        return None;
    }
    let (b0, b1, b2) = (b - a, c - b, d - c);
    let (n0, n1) = (b0.cross(&b1), b1.cross(&b2));
    if !(n0.norm() > 1e-9 && n1.norm() > 1e-9) {
        return None;
    }
    let deg = (b1.norm() * b0.dot(&n1)).atan2(n0.dot(&n1)).to_degrees();
    Some(if deg <= -180.0 { deg + 360.0 } else { deg })
}

/// The class MolProbity judges a residue on: Gly, then Pro (cis when the preceding peptide bond
/// has $-90° < \omega < 90°$), then pre-Pro (`next_res_name`, the residue bonded after this one,
/// is Pro), then Ile/Val, else general.
pub fn ramachandran_class(res_name: &str, next_res_name: Option<&str>, omega: Option<f64>) -> RamachandranClass {
    let is = |name: &str, want: &str| name.trim().eq_ignore_ascii_case(want);
    if is(res_name, "GLY") {
        RamachandranClass::Glycine
    } else if is(res_name, "PRO") {
        match omega {
            Some(w) if w > -90.0 && w < 90.0 => RamachandranClass::CisProline,
            _ => RamachandranClass::TransProline,
        }
    } else if next_res_name.is_some_and(|n| is(n, "PRO")) {
        RamachandranClass::PreProline
    } else if is(res_name, "ILE") || is(res_name, "VAL") {
        RamachandranClass::IleVal
    } else {
        RamachandranClass::General
    }
}

/// The region of (`phi`, `psi`) for a residue of `class`, from that class's 10° grid (see the
/// module documentation for the source, cutoffs and resampling). Angles are read modulo 360;
/// `None` when either is not finite.
pub fn ramachandran_region(class: RamachandranClass, phi: f64, psi: f64) -> Option<RamachandranRegion> {
    if !(phi.is_finite() && psi.is_finite()) {
        return None;
    }
    // Cell k covers [-180 + 10 k, -170 + 10 k), modulo 360.
    let cell = |angle: f64| (((angle + 180.0) / 10.0).floor() as i64).rem_euclid(36) as usize;
    let grid = match class {
        RamachandranClass::General => &GENERAL_REGIONS,
        RamachandranClass::Glycine => &GLYCINE_REGIONS,
        RamachandranClass::TransProline => &TRANS_PROLINE_REGIONS,
        RamachandranClass::CisProline => &CIS_PROLINE_REGIONS,
        RamachandranClass::PreProline => &PRE_PROLINE_REGIONS,
        RamachandranClass::IleVal => &ILE_VAL_REGIONS,
    };
    Some(match grid[35 - cell(psi)].as_bytes()[cell(phi)] {
        b'#' => RamachandranRegion::Favoured,
        b'+' => RamachandranRegion::Allowed,
        _ => RamachandranRegion::Outlier,
    })
}

// Region grids: rows psi 180 (top) to -180, columns phi -180 to 180, 10 degrees per cell;
// '#' favoured, '+' allowed, '.' outlier. Resampled from the Top8000 contour grids (Richardson
// Lab, CC BY 4.0) as the module documentation states.

/// General case: `rama8000-general-noGPIVpreP.data`, allowed cutoff 0.0005.
pub const GENERAL_REGIONS: [&str; 36] = [
    "###########++...........+++........+",
    "############+...........+++........+",
    "+############+..........+++........+",
    "+############+...........++........+",
    "+#############+..........+..........",
    "++############+.....................",
    "++##########+++..........+..........",
    "++#########++............+..........",
    "+++########+............++..........",
    ".+++#######............+++..........",
    ".+++++++###..........+++++..........",
    ".+++++++##+.........++++++..........",
    ".++++++++#+..........+##++..........",
    ".+++##+++++..........+###+..........",
    ".+++####+++...........+##+..........",
    ".+++#####++...........+##++.........",
    "..++######+............+##+.........",
    "..++#######+...........+##+.........",
    "..++########+...........+#++........",
    "..++########+...........++++........",
    "..+++########+..........+++.........",
    "..+++#########..........+++.........",
    "..++++########+.........+++.........",
    "..++++########+.........+++.........",
    "..+++++++++++++.........+++.........",
    "..++++++++++.............+..........",
    "..++++++++..........................",
    "...+++++++..........................",
    "...+++++++............+++...........",
    "...++++++............++++...........",
    "...++++++............++++...........",
    "...+++++++............+++...........",
    ".+++++++++............+++...........",
    "++++++++++.............++...........",
    "+++#+++++++............+++..........",
    "+##########+............++.........+",
];

/// Ile/Val not before Pro: `rama8000-ileval-nopreP.data`, allowed cutoff 0.0010.
pub const ILE_VAL_REGIONS: [&str; 36] = [
    ".++####+++++........................",
    "+++########++.......................",
    "++##########+.......................",
    "++###########+......................",
    "++###########++.....................",
    ".++##########++.....................",
    "..++########++......................",
    "..++#######+........................",
    "...++#####++........................",
    "...++++++++.........................",
    "...++++++++.........................",
    "...++++++++...........+++...........",
    "...+++++++...........++++...........",
    "...+++++.............++++...........",
    "...++++++............++++...........",
    "...++##+++.............+............",
    "...++####++.........................",
    "...++#####++........................",
    "...++#######+.......................",
    "...++#######+.......................",
    "...+++#######+......................",
    "...+++#######+......................",
    "...+++########+.........++..........",
    "...++########++.........+++.........",
    "....++++++++++..........++..........",
    "....+++++++.........................",
    ".....++++...........................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....+++.............................",
    "...++++++...........................",
    "..+++++++++.........................",
];

/// Gly: `rama8000-gly-sym.data` (symmetrised), allowed cutoff 0.0010.
pub const GLYCINE_REGIONS: [&str; 36] = [
    "############+..........+############",
    "#############...........+###########",
    "#############+..........+###########",
    "##############...........+##########",
    "##############+..........+#######+++",
    "+++###########+..........++#####++++",
    "+++++########++...........+####+++++",
    "+++++++###+++.............++##++++++",
    ".+++++++++++.............+++##+++++.",
    ".++++++++++..............+++++++....",
    ".++++++++#+...........+++++++++.....",
    "+++++++++##..........++###+++++.....",
    "+++++++++##..........+#####++++.....",
    "++++++++##++.........+######++++....",
    "++++######++..........#######+++....",
    ".+++######++..........+#######+++...",
    "..++#######+...........########++...",
    "..++#######+...........+########+...",
    "...+########+...........+#######++..",
    "...++########...........+#######++..",
    "...+++#######+..........++######+++.",
    "....+++#######..........++######++++",
    "....++++######+.........++##++++++++",
    ".....++++#####+..........##+++++++++",
    ".....+++++###++..........##+++++++++",
    ".....+++++++++...........+#++++++++.",
    "....+++++++..............++++++++++.",
    ".+++++##+++.............+++++++++++.",
    "++++++##++.............+++###+++++++",
    "+++++####+...........++########+++++",
    "++++#####++..........+###########+++",
    "+++#######+..........+##############",
    "##########+...........##############",
    "###########+..........+#############",
    "###########+...........#############",
    "############+..........+############",
];

/// Pre-Pro (not Gly or Pro): `rama8000-prepro-noGP.data`, allowed cutoff 0.0010.
pub const PRE_PROLINE_REGIONS: [&str; 36] = [
    "+##########++......................+",
    "############++..........++.........+",
    "+############+..........+++........+",
    "+############++..........+.........+",
    "+#############+....................+",
    "++############++...................+",
    "++############++...................+",
    "++########++++++....................",
    "++######+++.........................",
    "++#####++...........++++++..........",
    "++#####+...........+++++++..........",
    "++####++...........+++##++..........",
    "+++###++............++##++..........",
    ".++++++..............+++++..........",
    "...++++...............+++...........",
    ".....+..............................",
    "....................................",
    "....................................",
    ".......++...........................",
    "......+++++++.......................",
    "......++++++++......................",
    ".......++++###+.....................",
    ".......+++####+.....................",
    "........++####++....................",
    "........+++#+++.....................",
    "..........+++.......................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "..+.................................",
    "++++++++++++........................",
];

/// Trans-Pro: `rama8000-transpro.data`, allowed cutoff 0.0010.
pub const TRANS_PROLINE_REGIONS: [&str; 36] = [
    ".......++###+.......................",
    ".......++####.......................",
    ".......++####+......................",
    ".......++#####......................",
    "........+#####+.....................",
    "........+#####+.....................",
    "........++###+......................",
    "........+++++.......................",
    "........++++........................",
    "........++++........................",
    "........+##+........................",
    "........+##+........................",
    "........+##+........................",
    "........++++........................",
    "........++++........................",
    "........+++.........................",
    ".......++#+.........................",
    ".......+###+........................",
    ".......+####+.......................",
    "........+####.......................",
    "........++###+......................",
    ".........+####+.....................",
    "..........+###+.....................",
    "...........+##+.....................",
    "............+++.....................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "........+++.........................",
    "........++#+........................",
];

/// Cis-Pro: `rama8000-cispro.data`, allowed cutoff 0.0020.
pub const CIS_PROLINE_REGIONS: [&str; 36] = [
    "......+######+......................",
    "......+######+......................",
    "......+#######......................",
    ".......+######......................",
    ".......+#####+......................",
    ".......+####+.......................",
    ".......++##++.......................",
    "........++++........................",
    "....................................",
    "....................................",
    "....................................",
    "......+++...........................",
    "......++++..........................",
    "......+##+..........................",
    "......+###+.........................",
    "......+###+.........................",
    ".....++####+........................",
    ".....++####+........................",
    "......+#####+.......................",
    "......+#####+.......................",
    ".......+####+.......................",
    "........++##+.......................",
    ".........+++........................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    "....................................",
    ".........++.........................",
    "........++++........................",
    ".......++##+........................",
    "......++####+.......................",
];

#[cfg(test)]
mod tests {
    use super::*;
    use RamachandranClass as K;
    use RamachandranRegion::{Allowed, Favoured, Outlier};

    /// One residue to build: name, label number, the C(i-1)-N(i) bond length before it, the
    /// omega of that bond, and its phi and psi (degrees).
    struct Build {
        name: &'static str,
        seq: i32,
        peptide_bond: f64,
        omega: f64,
        phi: f64,
        psi: f64,
    }

    fn res(name: &'static str, seq: i32, phi: f64, psi: f64) -> Build {
        Build { name, seq, peptide_bond: 1.329, omega: 180.0, phi, psi }
    }

    /// Place d from a, b, c: |cd| = `len`, angle b-c-d = `angle`, dihedral a-b-c-d = `torsion`
    /// (degrees), by the natural extension reference frame (Parsons et al. 2005).
    fn place(a: Vector3<f64>, b: Vector3<f64>, c: Vector3<f64>, len: f64, angle: f64, torsion: f64) -> Vector3<f64> {
        let (angle, torsion) = (angle.to_radians(), torsion.to_radians());
        let bc = (c - b).normalize();
        let n = (b - a).cross(&bc).normalize();
        let m = n.cross(&bc);
        c + bc * (-len * angle.cos()) + m * (len * angle.sin() * torsion.cos()) + n * (len * angle.sin() * torsion.sin())
    }

    /// An mmCIF chain built residue by residue with Engh & Huber (1991) bond lengths and angles,
    /// so each residue has exactly the phi, psi and omega asked for. Coordinates are written to
    /// 6 decimals so the read-back torsions agree to well under 0.001 degree.
    fn chain_cif(residues: &[Build]) -> String {
        let (n_ca, ca_c) = (1.458, 1.525);
        let (ang_n_ca_c, ang_ca_c_n, ang_c_n_ca) = (111.2, 116.2, 121.7);
        let mut atoms: Vec<[Vector3<f64>; 3]> = Vec::new();
        let n0 = Vector3::new(0.0, 0.0, 0.0);
        let ca0 = Vector3::new(n_ca, 0.0, 0.0);
        let t = (180.0f64 - ang_n_ca_c).to_radians();
        let c0 = ca0 + Vector3::new(ca_c * t.cos(), ca_c * t.sin(), 0.0);
        atoms.push([n0, ca0, c0]);
        for i in 1..residues.len() {
            let [n, ca, c] = atoms[i - 1];
            let r = &residues[i];
            let n1 = place(n, ca, c, r.peptide_bond, ang_ca_c_n, residues[i - 1].psi);
            let ca1 = place(ca, c, n1, n_ca, ang_c_n_ca, r.omega);
            let c1 = place(c, n1, ca1, ca_c, ang_n_ca_c, r.phi);
            atoms.push([n1, ca1, c1]);
        }
        let mut cif = String::from(
            "data_T\nloop_\n_atom_site.group_PDB\n_atom_site.id\n_atom_site.label_atom_id\n\
             _atom_site.label_comp_id\n_atom_site.label_asym_id\n_atom_site.label_seq_id\n\
             _atom_site.Cartn_x\n_atom_site.Cartn_y\n_atom_site.Cartn_z\n_atom_site.auth_seq_id\n\
             _atom_site.auth_asym_id\n",
        );
        let mut id = 0;
        for (r, xyz) in residues.iter().zip(&atoms) {
            for (name, p) in ["N", "CA", "C"].iter().zip(xyz) {
                id += 1;
                cif.push_str(&format!(
                    "ATOM {id} {name} {} A {} {:.6} {:.6} {:.6} {} A\n",
                    r.name, r.seq, p.x, p.y, p.z, r.seq
                ));
            }
        }
        cif
    }

    fn close(got: Option<f64>, want: f64) -> bool {
        got.is_some_and(|g| ((g - want + 540.0).rem_euclid(360.0) - 180.0).abs() < 1e-3)
    }

    /// Residues built at known phi/psi land in the region their class's grid gives them, and the
    /// class decides it: the same (phi, psi) is favoured for one class and an outlier for
    /// another. Gly, trans-Pro, cis-Pro, pre-Pro and Ile/Val each use their own map.
    #[test]
    fn classifies_residues_into_documented_regions() {
        // (name, phi, psi, expected class, expected region); the first and last residues have
        // no phi / no psi and so no region.
        let plan: Vec<(&str, f64, f64, K, Option<RamachandranRegion>)> = vec![
            ("MET", 0.0, -40.0, K::General, None),
            ("ALA", -63.0, -43.0, K::General, Some(Favoured)), // alpha helix
            ("ALA", -120.0, 130.0, K::General, Some(Favoured)), // beta strand
            ("ALA", 95.0, 5.0, K::General, Some(Outlier)), // left-handed: an outlier for Ala...
            ("GLY", 95.0, 5.0, K::Glycine, Some(Favoured)), // ...and favoured for Gly
            ("GLY", 85.0, -165.0, K::Glycine, Some(Favoured)),
            ("ALA", 85.0, -165.0, K::General, Some(Outlier)),
            ("ALA", 62.0, 42.0, K::General, Some(Favoured)), // alpha-L: favoured for general...
            ("VAL", 62.0, 42.0, K::IleVal, Some(Allowed)), // ...allowed for Ile/Val...
            ("ALA", 62.0, 42.0, K::PreProline, Some(Allowed)), // ...and for pre-Pro
            ("PRO", -65.0, 145.0, K::TransProline, Some(Favoured)), // polyproline II
            ("PRO", -125.0, 135.0, K::TransProline, Some(Outlier)), // beta: not for Pro (phi)
            ("ALA", -125.0, 135.0, K::General, Some(Favoured)),
            ("ALA", -60.0, -40.0, K::General, Some(Favoured)),
        ];
        let mut built: Vec<Build> =
            plan.iter().enumerate().map(|(i, p)| res(p.0, i as i32 + 1, p.1, p.2)).collect();
        // A cis-Pro then a trans-Pro at the same (phi, psi): cis is favoured there, trans is not.
        built.push(Build { omega: 0.0, ..res("PRO", 15, -105.0, 45.0) });
        built.push(res("ALA", 16, -63.0, -43.0));
        built.push(res("PRO", 17, -105.0, 45.0));
        built.push(res("ALA", 18, -63.0, 140.0));
        let report = backbone_torsions(&chain_cif(&built), None).expect("torsions");
        assert_eq!(report.residues.len(), 18);
        assert_eq!(report.chain_breaks, 0);

        let mut want: Vec<(K, Option<RamachandranRegion>)> = plan.iter().map(|p| (p.3, p.4)).collect();
        // Residue 14 (ALA) precedes the cis-Pro, residue 16 (ALA) the trans-Pro.
        want[13] = (K::PreProline, Some(Favoured));
        want.extend([
            (K::CisProline, Some(Favoured)),
            (K::PreProline, Some(Favoured)),
            (K::TransProline, Some(Outlier)),
            (K::General, None),
        ]);
        for (i, (r, (class, region))) in report.residues.iter().zip(&want).enumerate() {
            let b = &built[i];
            if i > 0 {
                assert!(close(r.phi, b.phi), "residue {}: phi {:?}, built {}", i + 1, r.phi, b.phi);
                assert!(close(r.omega, b.omega), "residue {}: omega {:?}, built {}", i + 1, r.omega, b.omega);
            }
            if i + 1 < built.len() {
                assert!(close(r.psi, b.psi), "residue {}: psi {:?}, built {}", i + 1, r.psi, b.psi);
            }
            assert_eq!((r.ramachandran_class, r.region), (*class, *region), "residue {} {}", i + 1, r.res_name);
        }
        assert_eq!((report.residues[0].phi, report.residues[17].psi), (None, None));
        let counts = report.counts;
        assert_eq!((counts.favoured, counts.allowed, counts.outlier, counts.unclassified), (10, 2, 4, 2));

        // The grid lookup itself: angles are read modulo 360, 180 sits in the cell of -180, and a
        // non-finite angle has no region.
        assert_eq!(ramachandran_region(K::General, -63.0 + 360.0, -43.0), Some(Favoured));
        assert_eq!(
            ramachandran_region(K::Glycine, 180.0, 180.0),
            ramachandran_region(K::Glycine, -180.0, -180.0)
        );
        assert_eq!(ramachandran_region(K::General, f64::NAN, 0.0), None);
        // And the class rule: Gly before Pro is still Gly; Pro before Pro is still Pro.
        assert_eq!(ramachandran_class("GLY", Some("PRO"), None), K::Glycine);
        assert_eq!(ramachandran_class("PRO", Some("PRO"), Some(-179.0)), K::TransProline);
        assert_eq!(ramachandran_class("ILE", None, None), K::IleVal);
    }

    /// Every grid is 36 rows of 36 cells, each '#', '+' or '.'.
    #[test]
    fn region_grids_are_36_by_36() {
        for grid in [
            &GENERAL_REGIONS,
            &ILE_VAL_REGIONS,
            &GLYCINE_REGIONS,
            &PRE_PROLINE_REGIONS,
            &TRANS_PROLINE_REGIONS,
            &CIS_PROLINE_REGIONS,
        ] {
            for row in grid.iter() {
                assert_eq!(row.len(), 36, "{row}");
                assert!(row.bytes().all(|b| matches!(b, b'#' | b'+' | b'.')), "{row}");
            }
        }
    }

    /// A chain breaks where C(i-1)-N(i) is 1.8 A or longer, not where the numbering jumps: a gap
    /// in the numbering over a real peptide bond keeps the torsions, a stretched bond under
    /// contiguous numbers loses them.
    #[test]
    fn chain_breaks_follow_the_peptide_bond_not_the_numbering() {
        let mut built: Vec<Build> = (0..8).map(|i| res("ALA", i + 1, -63.0, -43.0)).collect();
        built[3].seq = 10; // numbering jumps 3 -> 10 over a normal bond
        for b in &mut built[4..] {
            b.seq += 6;
        }
        built[5].peptide_bond = 1.79; // still bonded
        built[6].peptide_bond = 1.81; // broken, though numbered 12 -> 13
        let report = backbone_torsions(&chain_cif(&built), Some("A")).expect("torsions");
        let r = &report.residues;
        assert_eq!(report.chain_breaks, 1);
        assert!(close(r[2].psi, -43.0) && close(r[3].phi, -63.0), "numbering gap is not a break");
        assert!(close(r[4].psi, -43.0) && close(r[5].phi, -63.0), "1.79 A is a peptide bond");
        assert_eq!((r[5].psi, r[6].phi, r[6].omega), (None, None, None), "1.81 A is a break");
        assert_eq!((r[5].region, r[6].region), (None, None));
        assert_eq!(report.counts.unclassified, 4);
    }

    /// Chains are picked by author id, then label id, else the first protein chain; anything else
    /// is an error that names what is missing.
    #[test]
    fn picks_chains_and_names_what_is_missing() {
        let cif = chain_cif(&(0..3).map(|i| res("ALA", i + 1, -63.0, -43.0)).collect::<Vec<_>>());
        assert_eq!(backbone_torsions(&cif, Some(" ")).unwrap().chain, "A");
        let err = backbone_torsions(&cif, Some("B")).unwrap_err();
        assert!(err.contains("'B'") && err.contains("protein chains: A"), "{err}");
        assert!(backbone_torsions("", None).unwrap_err().contains("No structure text"));
        let pdb = "ATOM      1  CA  ALA A   1       0.000   0.000   0.000  1.00  0.00           C\n";
        assert!(backbone_torsions(pdb, None).unwrap_err().contains("mmCIF"));
        let no_x = cif.replace("_atom_site.Cartn_x\n", "");
        assert!(backbone_torsions(&no_x, None).is_err());
    }

    /// The mmCIF reader accepts `inf` and `NaN` as coordinates; a torsion through such an atom is
    /// absent rather than a number.
    #[test]
    fn non_finite_coordinates_give_no_torsion() {
        let cif = chain_cif(&(0..3).map(|i| res("ALA", i + 1, -63.0, -43.0)).collect::<Vec<_>>());
        for bad in ["inf", "NaN"] {
            // Atom 5 is the CA of residue 2; its x is the 7th field of the row.
            let text: String = cif
                .lines()
                .map(|l| {
                    let mut f: Vec<&str> = l.split(' ').collect();
                    if l.starts_with("ATOM 5 ") {
                        f[6] = bad;
                    }
                    f.join(" ") + "\n"
                })
                .collect();
            let r = backbone_torsions(&text, None).expect("torsions").residues;
            assert_eq!((r[1].phi, r[1].psi, r[1].omega, r[1].region), (None, None, None, None), "{bad}");
            assert!(close(r[0].psi, -43.0) && close(r[2].phi, -63.0), "{bad}: torsions not through CA 2 stay");
        }
    }
}
