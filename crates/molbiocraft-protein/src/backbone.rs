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
//! **outlier** region by [`ramachandran_region`]: the bilinear interpolation of its
//! [`RamachandranClass`]'s Top8000 2° grid at ($\phi$, $\psi$), compared with MolProbity's
//! cutoffs. This follows MolProbity's method (cctbx `NDimTable.valueAt` and `ramalyze.evalScore`)
//! without being MolProbity, whose own run can still differ (for example in the torsions it reads
//! from alternate locations):
//!
//! - **Source:** the Top8000 Ramachandran contour grids of the Richardson Laboratory, Duke
//!   University (Williams et al. 2018, *Protein Sci.* 27:293-315,
//!   doi:10.1002/pro.3330), file `Top8000/Top8000_ramachandran_pct_contour_grids/rama8000-*.data`
//!   of <https://github.com/rlabduke/reference_data>, licensed CC BY 4.0. Each file gives a value
//!   at 2° nodes (φ, ψ = -179, -177, ..., 179); a node it does not list is 0. The node values are
//!   embedded, rounded to `f32` as cctbx holds them, in [`crate::rama8000_grids`] (the change made
//!   to the source; `scripts/outside-data/derive_ramachandran_maps.py --check` compares them node
//!   for node with the SHA-256-pinned files).
//! - **Interpolation**, as cctbx `mmtbx/rotamer/n_dim_table.py` `valueAt`: an angle outside
//!   [-180, 180] is first brought into it by whole turns; on each axis the point lies between its
//!   nearest node and the next node on its side, weighted by distance, and the axes wrap, so an
//!   angle beyond ±179 is interpolated between the nodes at 179 and -179.
//! - **Cutoffs:** MolProbity's (Lovell et al. 2003, *Proteins* 50:437-450,
//!   doi:10.1002/prot.10286; as coded in cctbx `mmtbx/validation/ramalyze.py`): favoured at an
//!   interpolated value of at least 0.02 (the contour enclosing 98% of the reference residues),
//!   allowed at least 0.0005 for the general case, 0.0020 for cis-Pro and 0.0010 for every other
//!   class, and an outlier below that.
//! - **Classes**, as MolProbity assigns them, the first that applies: Gly; Pro, cis when
//!   $-90° < \omega < 90°$ and trans otherwise; pre-Pro, a residue bonded to a following Pro;
//!   Ile/Val; and every other residue.

use molbiocraft_formats::pdb_mmcif::{parse_mmcif_structure, Structure, StructureResidue};
use nalgebra::Vector3;
use serde::{Deserialize, Serialize};

/// C(i-1)-N(i) distance, in Å, from which two residues are not bonded (Biopython `PPBuilder`'s
/// default radius): a shorter distance is a peptide bond, this or a longer one a chain break.
pub const PEPTIDE_BOND_MAX_ANGSTROM: f64 = 1.8;

/// The region rule [`ramachandran_region`] applies, in words, as reports state it.
pub const RAMACHANDRAN_REGION_RULE: &str = "Favoured / allowed / outlier by bilinear \
     interpolation of the Richardson Lab Top8000 2-degree Ramachandran grids (Williams et al. 2018, \
     CC BY 4.0) at MolProbity's cutoffs (Lovell et al. 2003): favoured >= 0.02, allowed >= 0.0005 \
     (general), 0.0020 (cis-Pro) or 0.0010 (other classes); separate grids for Gly, trans-Pro, \
     cis-Pro, pre-Pro, Ile/Val and all other residues. Follows MolProbity's method; not MolProbity \
     itself";

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

/// The region of (`phi`, `psi`) for a residue of `class`: [`ramachandran_value`] at MolProbity's
/// cutoffs (see the module documentation). `None` when either angle is not finite.
pub fn ramachandran_region(class: RamachandranClass, phi: f64, psi: f64) -> Option<RamachandranRegion> {
    let value = ramachandran_value(class, phi, psi)?;
    let allowed = match class {
        RamachandranClass::General => 0.0005,
        RamachandranClass::CisProline => 0.0020,
        _ => 0.0010,
    };
    Some(if value >= 0.02 {
        RamachandranRegion::Favoured
    } else if value >= allowed {
        RamachandranRegion::Allowed
    } else {
        RamachandranRegion::Outlier
    })
}

/// The bilinear interpolation of `class`'s Top8000 grid at (`phi`, `psi`), computed as cctbx
/// `NDimTable.valueAt` computes it (in `f64` over the `f32` node values, summing the four nodes in
/// its order). `None` when either angle is not finite.
pub fn ramachandran_value(class: RamachandranClass, phi: f64, psi: f64) -> Option<f64> {
    use crate::rama8000_grids as g;
    if !(phi.is_finite() && psi.is_finite()) {
        return None;
    }
    let grid: &[f32] = match class {
        RamachandranClass::General => &g::GENERAL,
        RamachandranClass::Glycine => &g::GLYCINE,
        RamachandranClass::TransProline => &g::TRANS_PROLINE,
        RamachandranClass::CisProline => &g::CIS_PROLINE,
        RamachandranClass::PreProline => &g::PRE_PROLINE,
        RamachandranClass::IleVal => &g::ILE_VAL,
    };
    let n = g::NODES_PER_AXIS as i64;
    // One axis: the home node (whereIs: the 2-degree bin holding the angle, the last bin for
    // 180), the neighbouring node on the angle's side of the home node's centre, and the weight
    // of that neighbour (on [0, 0.5]). Indices wrap around the 180 nodes.
    let axis = |angle: f64| {
        let x = if (-180.0..=180.0).contains(&angle) { angle } else { (angle + 180.0).rem_euclid(360.0) - 180.0 };
        let home = (((x + 180.0) / 2.0).floor() as i64).min(n - 1);
        let centre = -180.0 + 2.0 * (home as f64 + 0.5);
        let neighbour = if x < centre { home - 1 } else { home + 1 };
        (home.rem_euclid(n) as usize, neighbour.rem_euclid(n) as usize, ((x - centre) / 2.0).abs())
    };
    let ((h0, n0, c0), (h1, n1, c1)) = (axis(phi), axis(psi));
    let mut value = 0.0;
    for bin in 0..4 {
        let mut coeff = 1.0;
        let i = if bin & 1 == 0 { coeff *= 1.0 - c0; h0 } else { coeff *= c0; n0 };
        let j = if bin & 2 == 0 { coeff *= 1.0 - c1; h1 } else { coeff *= c1; n1 };
        value += coeff * f64::from(grid[i * g::NODES_PER_AXIS + j]);
    }
    Some(value)
}

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

    /// Fixture for [`regions_match_interpolated_top8000_grid`], written by an independent Python
    /// reference (run with `python3 -I`, not committed): cctbx `mmtbx/rotamer/n_dim_table.py`
    /// `NDimTable` (createFromText, whereIs, bin2index_limit, valueAt) transcribed line for line
    /// over the six raw `rama8000-*.data` files at the pinned commit (full double precision, not
    /// this crate's f32 grids), then `ramalyze.evalScore`'s cutoffs, on the phi / psi / class this
    /// module reads from the RCSB mmCIF files `rcsb/<entry>.cif` of the reference-data folder (1A5R,
    /// 1CRN, 1MBN, 1UBQ, 4HHB, 6VXX: every protein chain, 3868 residues, 3780 with both angles).
    ///
    /// MOVED: the 61 residues whose region D0009's 10° maps got wrong (entry, chain, index in the
    /// chain, name, class, phi, psi, the region of the 10° map, the interpolated region). EDGES:
    /// the interpolated value itself, at nodes, between nodes and across the ±180 wrap.
    type Moved = (&'static str, &'static str, usize, &'static str, K, f64, f64, RamachandranRegion, RamachandranRegion);
    const MOVED: &[Moved] = &[
        ("1A5R", "A", 44, "HIS", K::General, -52.23542376892049, 175.95086756275538, Allowed, Outlier),
        ("1A5R", "A", 45, "LEU", K::General, -79.66135170423769, 10.492241224848986, Allowed, Favoured),
        ("1MBN", "A", 2, "SER", K::General, -49.56738901914932, 150.06341170788224, Allowed, Favoured),
        ("1MBN", "A", 14, "ALA", K::General, -39.683852749599424, -35.44186421604856, Outlier, Allowed),
        ("1MBN", "A", 47, "HIS", K::General, -40.89181771384346, -36.72491805209752, Favoured, Allowed),
        ("1MBN", "A", 52, "ALA", K::General, -54.03014360223181, -61.548190536995435, Allowed, Favoured),
        ("1MBN", "A", 66, "THR", K::General, -47.98213926408385, -60.489935220105465, Allowed, Favoured),
        ("1MBN", "A", 75, "LEU", K::General, -48.906762883030936, -70.64303833523299, Outlier, Allowed),
        ("1MBN", "A", 80, "HIS", K::General, -91.01135644329975, 57.68317736485111, Allowed, Favoured),
        ("1MBN", "A", 86, "LYS", K::PreProline, -44.7980427528714, -71.81976910942326, Outlier, Allowed),
        ("1MBN", "A", 107, "SER", K::General, -40.729418527569216, -38.02328629797981, Favoured, Allowed),
        ("1MBN", "A", 113, "VAL", K::IleVal, -46.11962325108197, -51.91348702681403, Allowed, Favoured),
        ("1MBN", "A", 116, "SER", K::General, -29.182431546664443, -52.98295516525157, Outlier, Allowed),
        ("1MBN", "A", 146, "LYS", K::General, -40.895138578598086, -70.9650917608958, Outlier, Allowed),
        ("1MBN", "A", 147, "GLU", K::General, -26.995707374780807, -61.92999594311568, Outlier, Allowed),
        ("4HHB", "A", 2, "SER", K::PreProline, -60.782614384029145, -176.0317433013969, Allowed, Outlier),
        ("4HHB", "A", 21, "GLY", K::Glycine, -29.928304354276936, -57.51957561764847, Outlier, Allowed),
        ("4HHB", "A", 81, "ALA", K::General, -61.47631366784261, -61.730970219273566, Allowed, Favoured),
        ("4HHB", "A", 121, "HIS", K::General, -41.035574826036225, -70.13410230494036, Outlier, Allowed),
        ("4HHB", "B", 55, "GLY", K::Glycine, -107.10641943462556, 41.399572537105314, Allowed, Favoured),
        ("4HHB", "B", 73, "GLY", K::Glycine, -42.58171420157992, -33.35699101005206, Favoured, Allowed),
        ("4HHB", "B", 122, "THR", K::PreProline, -68.5786685081658, 172.50214579673528, Allowed, Favoured),
        ("4HHB", "C", 12, "ALA", K::General, -50.48514261481387, -61.549191058419545, Allowed, Favoured),
        ("4HHB", "C", 14, "GLY", K::Glycine, -44.66247596593933, -63.32386035744412, Allowed, Favoured),
        ("4HHB", "C", 16, "VAL", K::IleVal, -65.42771808582877, -70.33324329892608, Outlier, Allowed),
        ("4HHB", "C", 38, "THR", K::General, -58.547623455497856, -16.802386145955793, Allowed, Favoured),
        ("4HHB", "C", 75, "MET", K::PreProline, -74.93570863251227, -39.3572261265745, Allowed, Favoured),
        ("4HHB", "C", 108, "LEU", K::General, -48.77442804549846, -61.23998565789955, Allowed, Favoured),
        ("4HHB", "C", 109, "ALA", K::General, -40.19801706673621, -56.758145191719485, Favoured, Allowed),
        ("4HHB", "D", 32, "VAL", K::IleVal, -74.12836511544724, -60.42132865372679, Allowed, Favoured),
        ("4HHB", "D", 38, "GLN", K::General, -67.47522758648377, 0.48953208338013393, Allowed, Favoured),
        ("4HHB", "D", 71, "SER", K::General, -40.747484897593175, -71.68836984334396, Outlier, Allowed),
        ("4HHB", "D", 88, "SER", K::General, -49.089483504169465, -60.61862269240211, Allowed, Favoured),
        ("6VXX", "A", 32, "PHE", K::General, 59.97205620338765, 19.865675123623603, Allowed, Favoured),
        ("6VXX", "A", 50, "ASN", K::General, 53.90552324683894, -124.38624427245566, Allowed, Favoured),
        ("6VXX", "A", 60, "LYS", K::General, -138.3924218198376, -17.235389675515563, Favoured, Allowed),
        ("6VXX", "A", 141, "LEU", K::General, -163.3195356883963, 127.81302877778137, Allowed, Favoured),
        ("6VXX", "A", 155, "LEU", K::General, -124.7310829257411, -41.58777381101526, Allowed, Favoured),
        ("6VXX", "A", 228, "SER", K::General, -157.67721343788207, -167.0486296089998, Allowed, Favoured),
        ("6VXX", "A", 322, "ILE", K::IleVal, -89.43007774418257, 85.07555874228018, Allowed, Favoured),
        ("6VXX", "A", 401, "HIS", K::General, -69.71623170729102, 103.18336899400468, Allowed, Favoured),
        ("6VXX", "A", 556, "ALA", K::General, -78.1818876540955, 65.08914196739946, Allowed, Favoured),
        ("6VXX", "A", 865, "ASP", K::General, 58.22388828614899, 15.644424956849285, Allowed, Favoured),
        ("6VXX", "B", 50, "ASN", K::General, 53.885276496467505, -124.37556923875957, Allowed, Favoured),
        ("6VXX", "B", 60, "LYS", K::General, -138.37022626260563, -17.35211822217867, Favoured, Allowed),
        ("6VXX", "B", 141, "LEU", K::General, -163.3586734409801, 127.87948726595329, Allowed, Favoured),
        ("6VXX", "B", 155, "LEU", K::General, -124.69481079466766, -41.617429951341485, Allowed, Favoured),
        ("6VXX", "B", 228, "SER", K::General, -157.6660976074106, -167.09857361196646, Allowed, Favoured),
        ("6VXX", "B", 322, "ILE", K::IleVal, -89.49743086261658, 85.12551619780649, Allowed, Favoured),
        ("6VXX", "B", 401, "HIS", K::General, -69.64415937836232, 103.13043020311157, Allowed, Favoured),
        ("6VXX", "B", 556, "ALA", K::General, -78.20373695587246, 65.09672462958673, Allowed, Favoured),
        ("6VXX", "B", 865, "ASP", K::General, 58.27025053265637, 15.552659449764542, Allowed, Favoured),
        ("6VXX", "C", 50, "ASN", K::General, 53.882333588917966, -124.34754741112653, Allowed, Favoured),
        ("6VXX", "C", 60, "LYS", K::General, -138.4122506647927, -17.265535043198483, Favoured, Allowed),
        ("6VXX", "C", 141, "LEU", K::General, -163.36758675747697, 127.81808976120568, Allowed, Favoured),
        ("6VXX", "C", 155, "LEU", K::General, -124.70751587502382, -41.57278140085147, Allowed, Favoured),
        ("6VXX", "C", 228, "SER", K::General, -157.72609336262488, -167.0781408644321, Allowed, Favoured),
        ("6VXX", "C", 322, "ILE", K::IleVal, -89.42234585500128, 85.06761077238701, Allowed, Favoured),
        ("6VXX", "C", 401, "HIS", K::General, -69.61383522070543, 103.16948053722018, Allowed, Favoured),
        ("6VXX", "C", 556, "ALA", K::General, -78.1500988080499, 65.07523694641702, Allowed, Favoured),
        ("6VXX", "C", 865, "ASP", K::General, 58.220917437749094, 15.637047817423742, Allowed, Favoured),
    ];

    const CHAINS: &[(&str, &str, &str)] = &[
        ("1A5R", "A", "-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFAFFOFFFFFFFFFFFFAFFFFAFFFFAFAFFFAFFFAFOFFFFFFAFFF\
             FFFFFFFFFFFF-"),
        ("1CRN", "A", "-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF-"),
        ("1MBN", "A", "-FFFFFFAFFFFFAAFFFFAAFFFFFOAAFFFFFFFFFFFFFFFFFFAAFFFFFAFFFFFFOAFFFFFFFFFFFFAOFAFFFAFFFAFFF\
             FFFFFAFFFFAFFFFOAAAAAFFFFAAFFAFFAFFFFFFAFFAFFFFFFFFFFFFAAAFFFO-"),
        ("1UBQ", "A", "-FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF-"),
        ("4HHB", "A", "-FOAFFFFFFFFFFFOFFFFOAFFAFFFFFFFFFFFFFFFFFAFFFFAFFFAFFFAFFFFFFFFFFFFFFFFFFAAAFFFFFFFFFFFFF\
             FFFFFFFFFFFFAFFFFFFFFFFFFFAAFFFAFFFFFFFFFFFFFFFFFF-"),
        ("4HHB", "B", "-FFOAFAFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFAAFFFAFFFFFFFFFFAFFFFFFFFFFFAFAFFFFFAFFFAFFFFFA\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFA-"),
        ("4HHB", "C", "-FAFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFAAFFFFFFFFFFFFFFFFFFFFFAFFAFFFFFFFFFFFA\
             FFFFFFFFFFFFFFFFAFFAFFAFFFAFAFFFFFFFFFFFFFFFFFFFFF-"),
        ("4HHB", "D", "-FAFFFFFFFFFFFFFFFAAFAFFFFFFFFAFFFFFFFFFFFFFFFFFFAFFFFFFFFFAFFFFFAFFFFFAOFFAOOFAFFFFFFFFFF\
             FFAFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF-"),
        ("6VXX", "A", "-FFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF--FFFFFFFFFFFFFFFFAAFFFFFFFFFFFFFFFFFFFFFFFFAFFF\
             FFFAFFFFFFFFFFFF--FFFFFF--FFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF--FFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFF\
             FFFFFFFFFFFFFFFFFFFAFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFF--FF\
             FFFF--FFFFF--FFFFFFAFFFF--FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF--FFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFF--\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF--FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFAFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFF-"),
        ("6VXX", "B", "-FFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF--FFFFFFFFFFFFFFFFAAFFFFFFFFFFFFFFFFFFFFFFFFAFFF\
             FFFAFFFFFFFFFFFF--FFFFFF--FFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF--FFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFF\
             FFFFFFFFFFFFFFFFFFFAFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFF--FF\
             FFFF--FFFFF--FFFFFFAFFFF--FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF--FFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFF--\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF--FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFAFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFF-"),
        ("6VXX", "C", "-FFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF--FFFFFFFFFFFFFFFFAAFFFFFFFFFFFFFFFFFFFFFFFFAFFF\
             FFFAFFFFFFFFFFFF--FFFFFF--FFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF--FFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFF\
             FFFFFFFFFFFFFFFFFFFAFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFF--FF\
             FFFF--FFFFF--FFFFFFAFFFF--FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAF--FFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFF--\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF--FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFAFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFF\
             FFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFFFFFFFFFFFFFFFFAFFFFFFFFFFF-"),
    ];

    const EDGES: &[(K, f64, f64, f64)] = &[
        (K::General, -179.0, -179.0, 0.005560270487425575),
        (K::General, -63.0, -43.0, 1.0),
        (K::Glycine, 180.0, 180.0, 0.48804346893789297),
        (K::Glycine, -180.0, -180.0, 0.48804346893789297),
        (K::General, 180.0, 0.0, 5.557444668102811e-05),
        (K::General, -180.0, 0.0, 5.557444668102811e-05),
        (K::General, 0.0, 180.0, 0.0),
        (K::TransProline, -60.0, 179.5, 0.002887484178168887),
        (K::CisProline, -75.0, 160.0, 0.9719485495347564),
        (K::PreProline, -60.0, 150.0, 0.716155307952183),
        (K::IleVal, -120.0, 130.0, 0.747744549755745),
        (K::General, -62.0, -60.5, 0.035279294562464265),
    ];

    /// The reference-data file `rel`, or `None` (after printing the skip line) when it is absent and
    /// MOLBIOCRAFT_REQUIRE_TEST_DATA is not 1. The folder is MOLBIOCRAFT_TEST_DATA_DIR (relative to
    /// the repo root), else `<repo>/test-data`.
    fn reference_file(rel: &str) -> Option<String> {
        let repo = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let dir = match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
            Some(d) if !d.is_empty() => repo.join(d),
            _ => repo.join("test-data"),
        };
        let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
        let required = match v.to_str() {
            Some("1") => true,
            Some("" | "0") => false,
            _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
        };
        let p = dir.join(rel);
        match std::fs::read_to_string(&p) {
            Ok(text) => Some(text),
            Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
                assert!(!required, "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}", p.display());
                eprintln!("skipped: reference data absent ({})", p.display());
                None
            }
            Err(e) => panic!("{}: unreadable: {e}", p.display()),
        }
    }

    /// Regions are the bilinear interpolation of the class's Top8000 2-degree grid at MolProbity's
    /// cutoffs, as an independent reference computes them on real chains (BG-01M6PXQ7, AC1). The
    /// 61 residues D0009's 10° maps misplaced are checked without the data folder; with it, every
    /// residue of the 11 fixture chains is, and each MOVED row is tied to its residue.
    #[test]
    fn regions_match_interpolated_top8000_grid() {
        assert_eq!(MOVED.len(), 61);
        for &(entry, chain, i, name, class, phi, psi, _, want) in MOVED {
            assert_eq!(ramachandran_region(class, phi, psi), Some(want), "{entry} {chain} #{i} {name} {class:?} ({phi}, {psi})");
        }
        for &(class, phi, psi, want) in EDGES {
            let got = ramachandran_value(class, phi, psi).expect("finite angles");
            assert!((got - want).abs() <= 1e-7 * want, "{class:?} ({phi}, {psi}): {got}, reference {want}");
        }
        assert_eq!(ramachandran_value(K::General, -63.0 + 360.0, -43.0 - 720.0), ramachandran_value(K::General, -63.0, -43.0));
        assert_eq!(ramachandran_value(K::General, 0.0, f64::INFINITY), None);
        // Each class's own allowed cutoff, at grid nodes whose file value lies between two of the
        // cutoffs: cis-Pro (-133, 3) = 0.00137, trans-Pro (-107, -3) = 0.00125 and general
        // (-179, -165) = 0.000746 (rama8000-cispro, -transpro and -general-noGPIVpreP.data).
        for (class, phi, psi, want) in [
            (K::CisProline, -133.0, 3.0, Outlier),
            (K::TransProline, -107.0, -3.0, Allowed),
            (K::General, -179.0, -165.0, Allowed),
        ] {
            assert_eq!(ramachandran_region(class, phi, psi), Some(want), "{class:?} ({phi}, {psi})");
        }
        let letter = |r: Option<RamachandranRegion>| match r {
            Some(Favoured) => 'F',
            Some(Allowed) => 'A',
            Some(Outlier) => 'O',
            None => '-',
        };
        assert_eq!(CHAINS.iter().map(|c| c.2.len()).sum::<usize>(), 3868);
        let mut compared = 0;
        for entry in ["1A5R", "1CRN", "1MBN", "1UBQ", "4HHB", "6VXX"] {
            let Some(text) = reference_file(&format!("rcsb/{entry}.cif")) else { continue };
            let structure = parse_mmcif_structure(&text).expect("mmCIF");
            for &(_, chain, want) in CHAINS.iter().filter(|c| c.0 == entry) {
                let report = backbone_torsions_of_structure(&structure, Some(chain)).expect("chain");
                let got: String = report.residues.iter().map(|r| letter(r.region)).collect();
                let differ: Vec<String> = got
                    .chars()
                    .zip(want.chars())
                    .enumerate()
                    .filter(|(_, (g, w))| g != w)
                    .map(|(i, (g, w))| format!("#{i} {}: {g}, reference {w}", report.residues[i].res_name))
                    .collect();
                assert_eq!((got.len(), differ), (want.len(), Vec::<String>::new()), "{entry} chain {chain}");
                compared += got.len();
                for &(_, _, i, name, class, phi, psi, _, _) in MOVED.iter().filter(|m| m.0 == entry && m.1 == chain) {
                    let r = &report.residues[i];
                    assert_eq!((r.res_name.as_str(), r.ramachandran_class, r.phi, r.psi), (name, class, Some(phi), Some(psi)), "{entry} {chain} #{i}");
                }
            }
        }
        eprintln!("compared {compared} residues of the fixture chains with the reference");
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
