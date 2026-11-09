// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Checks structure superposition on RCSB mmCIF files (`rcsb/*.cif` in the git-ignored
//! reference-data folder) against `reference/structure.json`, computed by
//! `scripts/outside-data/ref_structure.py` (Biopython 1.88 `PairwiseAligner` and
//! `SVDSuperimposer`; TM-align through tmtools 0.3.0). Chains are named as Biopython names them,
//! by author chain id.
//!
//! The folder is `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read from the repo root), else
//! `<repo>/test-data`. When a file is absent each test prints `skipped: reference data absent`
//! with the path and returns; with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1` it fails instead.

use molbiocraft_protein::biophysics_3d::align_pdb_chains_kabsch;
use serde_json::Value;
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

/// `reference/structure.json`.
fn reference() -> Option<Value> {
    let text = data_file("reference/structure.json")?;
    Some(serde_json::from_str(&text).unwrap_or_else(|e| panic!("structure.json: not valid JSON: {e}")))
}

/// `"4HHB.A"` -> (`"4HHB"`, `"A"`).
fn entry_and_chain(v: &Value) -> (String, String) {
    let s = v.as_str().unwrap_or_else(|| panic!("reference chain is not a string: {v}"));
    let (entry, chain) = s.split_once('.').unwrap_or_else(|| panic!("reference chain '{s}' is not ENTRY.CHAIN"));
    (entry.to_string(), chain.to_string())
}

fn number(v: &Value, what: &str) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("reference {what} is not a number: {v}"))
}

/// Biopython's sequence-based superposition: align the chains' sequences (global, BLOSUM62, gap
/// open -10, extend -0.5), superpose the aligned C-alpha pairs by SVD and take the RMSD over all
/// of them. The equivalent-residue count, the identity over the pairs and the alignment score
/// must be Biopython's exactly; the RMSD within 0.05 A.
#[test]
fn sequence_superposition_matches_biopython() {
    let Some(r) = reference() else { return };
    let cases = r["sequence_superposition"].as_array().expect("sequence_superposition cases");
    assert_eq!(cases.len(), 2, "4HHB.A/4HHB.B and 1MBN.A/4HHB.A");
    let mut bad = Vec::new();
    for c in cases {
        let (entry_a, chain_a) = entry_and_chain(&c["chain_1"]);
        let (entry_b, chain_b) = entry_and_chain(&c["chain_2"]);
        let Some(cif_a) = data_file(&format!("rcsb/{entry_a}.cif")) else { return };
        let Some(cif_b) = data_file(&format!("rcsb/{entry_b}.cif")) else { return };
        let got = align_pdb_chains_kabsch(&cif_a, &cif_b, Some(&chain_a), Some(&chain_b))
            .unwrap_or_else(|e| panic!("{entry_a}.{chain_a}/{entry_b}.{chain_b}: {e}"));

        let pairs = number(&c["equivalent_residues"], "equivalent_residues") as usize;
        let identity = number(&c["identity"], "identity");
        let rmsd = number(&c["rmsd"], "rmsd");
        let score = number(&c["score"], "score");
        let line = format!(
            "{entry_a}.{chain_a}/{entry_b}.{chain_b}: pairs {} ref {pairs}, identity {} ref {identity}, \
             RMSD {} ref {rmsd}, score {} ref {score}",
            got.aligned_residue_pairs, got.sequence_identity, got.rmsd_angstrom, got.alignment_score
        );
        eprintln!("{line}");
        assert_eq!((got.chain_a.as_str(), got.chain_b.as_str()), (chain_a.as_str(), chain_b.as_str()));
        if got.aligned_residue_pairs != pairs
            || (got.sequence_identity - identity).abs() > 5e-5
            || (got.rmsd_angstrom - rmsd).abs() > 0.05
            || (got.alignment_score - score).abs() > 1e-9
        {
            bad.push(line);
        }
    }
    assert!(bad.is_empty(), "sequence superposition differs from Biopython:\n{}", bad.join("\n"));
}

// ---- US01M6PB2V: backbone torsions ----

/// Backbone phi/psi of RCSB 1UBQ chain A against Biopython's `PPBuilder` and
/// `Polypeptide.get_phi_psi_list` (reference `ramachandran["1UBQ.A"]`, rounded there to 0.01
/// degree; `null` where a torsion is undefined): all 76 residues in order, with the same author
/// numbers and names, every angle within 0.1 degree, no phi for the first residue and no psi for
/// the last. Both split the chain where C(i-1)-N(i) is 1.8 A or longer.
#[test]
fn backbone_torsions_match_biopython() {
    let Some(r) = reference() else { return };
    let rows = r["ramachandran"]["1UBQ.A"].as_array().expect("ramachandran[\"1UBQ.A\"]");
    assert_eq!(rows.len(), 76, "1UBQ.A has 76 residues in the reference");
    let Some(cif) = data_file("rcsb/1UBQ.cif") else { return };
    let got = molbiocraft_protein::backbone::backbone_torsions(&cif, Some("A")).unwrap_or_else(|e| panic!("1UBQ.A: {e}"));
    assert_eq!(got.chain, "A");
    assert_eq!(got.residues.len(), rows.len(), "residue count");
    assert_eq!(got.chain_breaks, 0);

    let angle = |v: &Value, what: &str| -> Option<f64> {
        if v.is_null() { None } else { Some(number(v, what)) }
    };
    // Difference on the circle, so 179.99 and -179.99 are 0.02 apart.
    let diff = |a: f64, b: f64| ((a - b + 540.0).rem_euclid(360.0) - 180.0).abs();
    let mut bad = Vec::new();
    let mut worst = 0.0f64;
    for (res, row) in got.residues.iter().zip(rows) {
        let seq = number(&row["seq_id"], "seq_id") as i32;
        let name = row["resname"].as_str().expect("resname");
        let (phi, psi) = (angle(&row["phi"], "phi"), angle(&row["psi"], "psi"));
        let ok = |mine: Option<f64>, theirs: Option<f64>| match (mine, theirs) {
            (None, None) => true,
            (Some(a), Some(b)) => diff(a, b) <= 0.1,
            _ => false,
        };
        for (m, t) in [(res.phi, phi), (res.psi, psi)] {
            if let (Some(a), Some(b)) = (m, t) {
                worst = worst.max(diff(a, b));
            }
        }
        if res.auth_seq_id != Some(seq) || res.res_name != name || !ok(res.phi, phi) || !ok(res.psi, psi) {
            bad.push(format!(
                "{name} {seq}: got {} {:?} phi {:?} psi {:?}, Biopython phi {phi:?} psi {psi:?}",
                res.res_name, res.auth_seq_id, res.phi, res.psi
            ));
        }
    }
    eprintln!("1UBQ.A: {} residues, largest phi/psi difference from Biopython {worst:.4} degree", got.residues.len());
    assert!(bad.is_empty(), "backbone torsions differ from Biopython:\n{}", bad.join("\n"));
    assert_eq!((got.residues[0].phi, got.residues[75].psi), (None, None), "no phi first, no psi last");
    assert!(got.residues[1..].iter().all(|r| r.phi.is_some()) && got.residues[..75].iter().all(|r| r.psi.is_some()));
}

// ---- US01M6P2A3 round 2 ----

/// A legacy PDB file and the mmCIF file of the same entry read as the same structure: each
/// chain superposed on its other-format self pairs every residue with itself at RMSD zero, and
/// both files list the same polymer C-alpha atoms. 1A5R is an NMR entry of ten models, so this
/// holds only when both readers take the first model: read as one chain of all ten, the PDB
/// file paired model 10 against the mmCIF file's model 1 (RMSD 4.6 A, round-1 review).
#[test]
fn a_pdb_file_superposes_its_first_model_like_its_mmcif() {
    // (entry, chain, residues in that chain, polymer C-alpha atoms in the first model), the
    // counts as `reference/structure.json` gives them (Biopython MMCIFParser).
    for (entry, chain, residues, atoms) in [("1A5R", "A", 103usize, 103usize), ("4HHB", "A", 141, 574)] {
        let Some(pdb) = data_file(&format!("rcsb/{entry}.pdb")) else { return };
        let Some(cif) = data_file(&format!("rcsb/{entry}.cif")) else { return };
        for (a, b, order) in [(&pdb, &cif, "pdb/cif"), (&cif, &pdb, "cif/pdb")] {
            let r = align_pdb_chains_kabsch(a, b, Some(chain), Some(chain))
                .unwrap_or_else(|e| panic!("{entry}.{chain} {order}: {e}"));
            eprintln!(
                "{entry}.{chain} {order}: pairs {} RMSD {} atoms {}/{}",
                r.aligned_residue_pairs, r.rmsd_angstrom, r.atoms_model_a, r.atoms_model_b
            );
            assert_eq!(r.aligned_residue_pairs, residues, "{entry}.{chain} {order}: pairs");
            assert!(r.rmsd_angstrom < 1e-3, "{entry}.{chain} {order}: RMSD {}", r.rmsd_angstrom);
            assert_eq!(r.aligned_sequence_a, r.aligned_sequence_b, "{entry}.{chain} {order}: sequence");
            assert_eq!((r.atoms_model_a, r.atoms_model_b), (atoms, atoms), "{entry} {order}: polymer C-alpha atoms");
            // The atoms listed are the app's C-alpha view of that file, field for field (these
            // entries have no atom named CA outside their polymer chains).
            let view = serde_json::to_value(molbiocraft_formats::parse_pdb_or_mmcif_ca_coordinates(a)).unwrap();
            assert!(serde_json::to_value(&r.atoms_a).unwrap() == view, "{entry} {order}: atoms_a is not the C-alpha view");
        }
    }
}

// ---- US01M6PBV4: TM-score structure alignment ----

use molbiocraft_protein::structure_align::align_structures_tm;

/// TM-align (tmtools 0.3.0) on three pairs of diverged chains: two globin chains of one
/// haemoglobin, myoglobin against haemoglobin alpha (27% identical), and ubiquitin against SUMO-1
/// (1A5R, NMR: its first model). Each TM-score, normalised by its own chain, must be within 0.02
/// of TM-align's, the RMSD within 0.15 A and the aligned length within 3; the chain lengths, which
/// the scores are normalised by, must be TM-align's exactly.
#[test]
fn tm_search_matches_tm_align_on_three_pairs() {
    let Some(r) = reference() else { return };
    let cases: Vec<&Value> = r["tm_align"]
        .as_array()
        .expect("tm_align cases")
        .iter()
        .filter(|c| c["chain_1"] != c["chain_2"])
        .collect();
    assert_eq!(cases.len(), 3, "4HHB.A/4HHB.B, 1MBN.A/4HHB.A and 1UBQ.A/1A5R.A");
    let mut bad = Vec::new();
    for c in cases {
        let (entry_a, chain_a) = entry_and_chain(&c["chain_1"]);
        let (entry_b, chain_b) = entry_and_chain(&c["chain_2"]);
        let Some(cif_a) = data_file(&format!("rcsb/{entry_a}.cif")) else { return };
        let Some(cif_b) = data_file(&format!("rcsb/{entry_b}.cif")) else { return };
        let started = std::time::Instant::now();
        let got = align_structures_tm(&cif_a, &cif_b, Some(&chain_a), Some(&chain_b))
            .unwrap_or_else(|e| panic!("{entry_a}.{chain_a}/{entry_b}.{chain_b}: {e}"));
        let elapsed = started.elapsed();

        let lengths = (number(&c["length_1"], "length_1") as usize, number(&c["length_2"], "length_2") as usize);
        let tm1 = number(&c["tm_score_norm_1"], "tm_score_norm_1");
        let tm2 = number(&c["tm_score_norm_2"], "tm_score_norm_2");
        let rmsd = number(&c["rmsd"], "rmsd");
        let aligned = number(&c["aligned_length"], "aligned_length") as usize;
        let line = format!(
            "{entry_a}.{chain_a}/{entry_b}.{chain_b}: TM {:.5}/{:.5} ref {tm1}/{tm2}, RMSD {:.3} ref {rmsd}, \
             aligned {} ref {aligned}, identity {:.4}, {:.0} ms",
            got.tm_score_a,
            got.tm_score_b,
            got.rmsd_angstrom,
            got.aligned_length,
            got.sequence_identity,
            elapsed.as_secs_f64() * 1000.0
        );
        eprintln!("{line}");
        assert_eq!((got.length_a, got.length_b), lengths, "{entry_a}.{chain_a}/{entry_b}.{chain_b} chain lengths");
        if (got.tm_score_a - tm1).abs() > 0.02
            || (got.tm_score_b - tm2).abs() > 0.02
            || (got.rmsd_angstrom - rmsd).abs() > 0.15
            || got.aligned_length.abs_diff(aligned) > 3
        {
            bad.push(line);
        }
    }
    assert!(bad.is_empty(), "TM-score alignment differs from TM-align:\n{}", bad.join("\n"));
}

/// A chain aligned with itself scores TM-score 1.0 by either length, RMSD 0 and every residue
/// aligned: always on a synthetic trace rigidly moved to another frame, and on 4HHB.A against
/// itself (TM-align's own self case) when the reference data is present.
#[test]
fn self_alignment_scores_one() {
    use molbiocraft_formats::one_to_three_aa;
    use nalgebra::{Rotation3, Unit, Vector3};

    // A seeded random walk of 3.8 A steps, and the same trace rotated and shifted.
    let mut state: u64 = 0x2545_F491_4F6C_DD1D;
    let mut next = move || {
        state ^= state << 13;
        state ^= state >> 7;
        state ^= state << 17;
        (state >> 11) as f64 / (1u64 << 53) as f64 - 0.5
    };
    let mut pos = Vector3::new(0.0, 0.0, 0.0);
    let trace: Vec<Vector3<f64>> = (0..80)
        .map(|_| {
            pos += Vector3::new(next(), next(), next()).normalize() * 3.8;
            pos
        })
        .collect();
    let rot = Rotation3::from_axis_angle(&Unit::new_normalize(Vector3::new(-2.0, 1.0, 0.5)), 2.3);
    let shift = Vector3::new(-40.0, 15.5, 7.0);
    let pdb = |chain: &str, points: &[Vector3<f64>]| -> String {
        let mut out = String::new();
        for (k, p) in points.iter().enumerate() {
            out.push_str(&format!(
                "ATOM  {:>5}  CA  {:>3} {}{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 20.00           C\n",
                k + 1,
                one_to_three_aa(b"ACDEFGHIKLMNPQRSTVWY"[k % 20]),
                chain,
                k + 1,
                p.x,
                p.y,
                p.z
            ));
        }
        out + "END\n"
    };
    let moved: Vec<Vector3<f64>> = trace.iter().map(|p| rot * p + shift).collect();
    let got = align_structures_tm(&pdb("A", &trace), &pdb("B", &moved), None, None).expect("self alignment");
    assert_eq!((got.aligned_length, got.length_a, got.length_b), (80, 80, 80));
    assert!(
        (got.tm_score_a - 1.0).abs() < 1e-6 && (got.tm_score_b - 1.0).abs() < 1e-6,
        "TM {} / {}",
        got.tm_score_a,
        got.tm_score_b
    );
    assert!(got.rmsd_angstrom < 2e-3, "RMSD {}", got.rmsd_angstrom);
    assert_eq!(got.sequence_identity, 1.0);
    assert_eq!(got.aligned_sequence_a, got.aligned_sequence_b);
    assert!(!got.aligned_sequence_a.contains('-'));

    let Some(r) = reference() else { return };
    let case = r["tm_align"]
        .as_array()
        .expect("tm_align cases")
        .iter()
        .find(|c| c["chain_1"] == c["chain_2"])
        .expect("TM-align's self case");
    let (entry, chain) = entry_and_chain(&case["chain_1"]);
    let Some(cif) = data_file(&format!("rcsb/{entry}.cif")) else { return };
    let got = align_structures_tm(&cif, &cif, Some(&chain), Some(&chain)).unwrap_or_else(|e| panic!("{entry}.{chain}: {e}"));
    eprintln!(
        "{entry}.{chain} self: TM {}/{}, RMSD {}, aligned {}",
        got.tm_score_a, got.tm_score_b, got.rmsd_angstrom, got.aligned_length
    );
    assert!((got.tm_score_a - 1.0).abs() < 1e-12 && (got.tm_score_b - 1.0).abs() < 1e-12);
    assert!(got.rmsd_angstrom < 1e-6, "RMSD {}", got.rmsd_angstrom);
    assert_eq!(got.aligned_length, number(&case["aligned_length"], "aligned_length") as usize);
    assert_eq!(got.aligned_sequence_a, case["alignment_1"].as_str().expect("alignment_1"));
}

// ---- US01M6PBV4 round 2 ----

use molbiocraft_formats::{parse_pdb_or_mmcif_ca_coordinates, PdbCaAtom};
use nalgebra::Vector3;

/// The C-alpha atoms of chain `chain` of an RCSB file, as the app's C-alpha view reads them (the
/// first model; for these entries, the chain TM-align reads, which has no HETATM residue).
fn chain_atoms(text: &str, chain: &str) -> Vec<PdbCaAtom> {
    parse_pdb_or_mmcif_ca_coordinates(text).into_iter().filter(|a| a.chain_id == chain).collect()
}

/// A C-alpha-only PDB text of `(residue name, position)`, chain A numbered from 1, coordinates
/// to 3 decimals: the text both this search and TM-align are given.
fn ca_only_pdb(residues: &[(String, Vector3<f64>)]) -> String {
    let mut out = String::new();
    for (k, (name, p)) in residues.iter().enumerate() {
        out.push_str(&format!(
            "ATOM  {:>5}  CA  {name:>3} A{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00  0.00           C\n",
            k + 1,
            k + 1,
            p.x,
            p.y,
            p.z
        ));
    }
    out + "END\n"
}

fn named_positions(atoms: &[PdbCaAtom]) -> Vec<(String, Vector3<f64>)> {
    atoms.iter().map(|a| (a.res_name.clone(), Vector3::new(a.x, a.y, a.z))).collect()
}

/// A hinge motion: the residues after residue `h` (0-based) turned by `degrees` about the axis
/// through residue `h` at right angles to both arms, from it to the mean of the residues before
/// it and to the mean of those after (Rodrigues' formula).
fn hinged(residues: &[(String, Vector3<f64>)], h: usize, degrees: f64) -> Vec<(String, Vector3<f64>)> {
    let mean = |set: &[(String, Vector3<f64>)]| set.iter().fold(Vector3::zeros(), |acc, (_, p)| acc + p) / set.len() as f64;
    let origin = residues[h].1;
    let axis = (mean(&residues[..h]) - origin).cross(&(mean(&residues[h + 1..]) - origin)).normalize();
    let (c, s) = (degrees.to_radians().cos(), degrees.to_radians().sin());
    residues
        .iter()
        .enumerate()
        .map(|(k, (name, p))| {
            if k <= h {
                return (name.clone(), *p);
            }
            let v = p - origin;
            (name.clone(), v * c + axis.cross(&v) * s + axis * axis.dot(&v) * (1.0 - c) + origin)
        })
        .collect()
}

/// TM-align (tmtools 0.3.0) on pairs harder than AC1's, where the round-1 search fell short of
/// it: crambin against ubiquitin (46 and 76 residues, unrelated folds), ubiquitin's first 19
/// residues against SUMO-1 (1A5R, NMR, first model), and myoglobin against itself with its
/// residues after residue 78 turned 50 degrees about a hinge there ([`hinged`]). Each TM-score,
/// normalised by its own chain, must be within 0.02 of TM-align's, the RMSD within 0.15 A and
/// the aligned length within 3; the chain lengths must be TM-align's exactly.
///
/// The reference values are tmtools 0.3.0's `tm_align` (TM-align's own code; it reads no HETATM
/// record, and none of these chains has one) on the C-alpha coordinates and sequences of exactly
/// these inputs: the chains as Biopython 1.88's `MMCIFParser` reads them from `rcsb/*.cif` (the
/// same C-alpha atoms as here), the fragment and the hinged chain written with 3 decimals as
/// [`ca_only_pdb`] writes them. The fourth pair of that run, 1A5R.A/1CRN.A, is
/// `tm_search_keeps_a_better_alignment_than_tm_align_on_sumo_and_crambin`.
#[test]
fn tm_search_matches_tm_align_on_harder_pairs() {
    let Some(crn) = data_file("rcsb/1CRN.cif") else { return };
    let Some(ubq) = data_file("rcsb/1UBQ.cif") else { return };
    let Some(sumo) = data_file("rcsb/1A5R.cif") else { return };
    let Some(mbn) = data_file("rcsb/1MBN.cif") else { return };
    let ubq19 = ca_only_pdb(&named_positions(&chain_atoms(&ubq, "A")[..19]));
    let hinge = ca_only_pdb(&hinged(&named_positions(&chain_atoms(&mbn, "A")), 77, 50.0));
    // (pair, A, B, lengths, TM by A, TM by B, RMSD, aligned) from tmtools 0.3.0.
    let cases = [
        ("1CRN.A/1UBQ.A", &crn, &ubq, (46, 76), 0.36145, 0.26816, 3.284, 32usize),
        ("1UBQ.A[1-19]/1A5R.A", &ubq19, &sumo, (19, 103), 0.26655, 0.16833, 1.184, 19),
        ("1MBN.A/1MBN.A hinged 50 degrees at 78", &mbn, &hinge, (153, 153), 0.58754, 0.58754, 3.557, 113),
    ];
    let mut bad = Vec::new();
    for (name, a, b, lengths, tm1, tm2, rmsd, aligned) in cases {
        let got = align_structures_tm(a, b, Some("A"), Some("A")).unwrap_or_else(|e| panic!("{name}: {e}"));
        let line = format!(
            "{name}: TM {:.5}/{:.5} ref {tm1}/{tm2}, RMSD {:.3} ref {rmsd}, aligned {} ref {aligned}",
            got.tm_score_a, got.tm_score_b, got.rmsd_angstrom, got.aligned_length
        );
        eprintln!("{line}");
        assert_eq!((got.length_a, got.length_b), lengths, "{name} chain lengths");
        if (got.tm_score_a - tm1).abs() > 0.02
            || (got.tm_score_b - tm2).abs() > 0.02
            || (got.rmsd_angstrom - rmsd).abs() > 0.15
            || got.aligned_length.abs_diff(aligned) > 3
        {
            bad.push(line);
        }
    }
    assert!(bad.is_empty(), "TM-score alignment differs from TM-align:\n{}", bad.join("\n"));
}

/// SUMO-1 (1A5R.A, 103 residues) against crambin (1CRN.A, 46), the one pair of the round-2 run
/// this search does not bring within 0.02 of TM-align: TM-align (tmtools 0.3.0, as in
/// `tm_search_matches_tm_align_on_harder_pairs`) gives TM 0.20650 by 1A5R and 0.29987 by 1CRN,
/// RMSD 4.060 A over 36 pairs. This search reports another alignment, one that begins with
/// crambin's residues 5-10 on SUMO-1's 42-47 (counted in chain order) where TM-align's begins
/// with crambin's 2-4 on SUMO-1's 28-30, and it scores higher by the shorter chain, 0.32061,
/// 0.0207 above TM-align: the start is chosen by the TM-score it reports, so the better one is
/// kept. TM-align's alignment scores 0.29987 under this scorer too, and is ahead on the
/// search-scale score (d0 + 0.8 A, pairs within d8): 0.3907 against 0.3847, measured when this
/// was written, which is consistent with TM-align ranking its candidates by that score. So the
/// TM-score by 1CRN is pinned at 0.32061, above TM-align's, while the TM-score by 1A5R, the RMSD
/// and the aligned length are within AC1's tolerances.
#[test]
fn tm_search_keeps_a_better_alignment_than_tm_align_on_sumo_and_crambin() {
    let Some(sumo) = data_file("rcsb/1A5R.cif") else { return };
    let Some(crn) = data_file("rcsb/1CRN.cif") else { return };
    let got = align_structures_tm(&sumo, &crn, Some("A"), Some("A")).unwrap_or_else(|e| panic!("1A5R.A/1CRN.A: {e}"));
    eprintln!(
        "1A5R.A/1CRN.A: TM {:.5}/{:.5} ref 0.20650/0.29987, RMSD {:.3} ref 4.060, aligned {} ref 36",
        got.tm_score_a, got.tm_score_b, got.rmsd_angstrom, got.aligned_length
    );
    assert_eq!((got.length_a, got.length_b), (103, 46));
    assert!((got.tm_score_a - 0.20650).abs() <= 0.02, "TM by 1A5R {}", got.tm_score_a);
    assert!((got.rmsd_angstrom - 4.060).abs() <= 0.15, "RMSD {}", got.rmsd_angstrom);
    assert!(got.aligned_length.abs_diff(36) <= 3, "aligned {}", got.aligned_length);
    assert!(got.tm_score_b > 0.29987, "below TM-align by the shorter chain: {}", got.tm_score_b);
    assert!((got.tm_score_b - 0.32061).abs() < 5e-4, "TM by 1CRN {}", got.tm_score_b);
}

/// The TM-score search reads its chains with the reader the sequence-paired superposition uses,
/// so a chain's length, which a TM-score is normalised by, does not depend on the format of the
/// file: a selenomethionine entry made from 1UBQ and from 1MBN by writing every methionine as a
/// `HETATM` `MSE` (as the wwPDB files a SeMet structure) reads from its PDB file and from its
/// mmCIF file alike as the native chain's 76 and 153 residues, each `MSE` coded `M`; and a
/// calcium ion written into 1CRN.pdb's chain A as an `ATOM` record (as molecular-dynamics
/// packages write ions; its atom is named `CA`) is not one of its 46 residues. Each aligns with
/// the native chain at TM-score 1, every residue paired at identity 1, and reads residue for
/// residue as `align_pdb_chains_kabsch` reads it. (A reader of its own read 75 and 151 residues
/// from the PDB files, coded the mmCIF `MSE` as `X`, and read 47 residues of 1CRN.)
#[test]
fn the_tm_search_reads_modified_residues_and_ions_as_the_superposition_does() {
    // Every methionine record rewritten: PDB columns 1-6 and 18-20, mmCIF the record word and
    // both residue-name fields.
    let semet = |text: &str, cif: bool| -> String {
        text.lines()
            .map(|l| {
                if !cif && l.starts_with("ATOM  ") && l.get(17..20) == Some("MET") {
                    format!("HETATM{}MSE{}\n", &l[6..17], &l[20..])
                } else if cif && l.starts_with("ATOM ") && l.contains(" MET ") {
                    format!("HETATM {}\n", l[4..].trim_start().replace(" MET ", " MSE "))
                } else {
                    format!("{l}\n")
                }
            })
            .collect()
    };
    let residues = |s: &str| s.replace('-', "");
    let check = |name: &str, text: &str, native: &str, length: usize| {
        let tm = align_structures_tm(text, native, Some("A"), Some("A")).unwrap_or_else(|e| panic!("{name}: {e}"));
        let kabsch = align_pdb_chains_kabsch(text, native, Some("A"), Some("A")).unwrap_or_else(|e| panic!("{name}: {e}"));
        eprintln!("{name}: {} residues, TM {:.6}, identity {}", tm.length_a, tm.tm_score_a, tm.sequence_identity);
        assert_eq!((tm.length_a, tm.length_b, tm.aligned_length), (length, length, length), "{name}");
        assert_eq!(residues(&tm.aligned_sequence_a), residues(&tm.aligned_sequence_b), "{name}: as the native chain");
        assert_eq!(residues(&tm.aligned_sequence_a), residues(&kabsch.aligned_sequence_a), "{name}: as the superposition reads it");
        assert_eq!(tm.sequence_identity, 1.0, "{name}");
        assert!(tm.tm_score_a > 1.0 - 1e-9 && tm.rmsd_angstrom < 1e-6, "{name}: TM {} RMSD {}", tm.tm_score_a, tm.rmsd_angstrom);
    };
    for (entry, length, methionines) in [("1UBQ", 76usize, 1usize), ("1MBN", 153, 2)] {
        let Some(native) = data_file(&format!("rcsb/{entry}.cif")) else { return };
        for format in ["pdb", "cif"] {
            let Some(text) = data_file(&format!("rcsb/{entry}.{format}")) else { return };
            let text = semet(&text, format == "cif");
            let ca_mse = text.lines().filter(|l| l.starts_with("HETATM") && l.contains("MSE") && l.contains(" CA ")).count();
            assert_eq!(ca_mse, methionines, "{entry}.{format}: the fixture's MSE C-alpha atoms");
            check(&format!("SeMet {entry}.{format}"), &text, &native, length);
        }
    }

    let Some(crn_pdb) = data_file("rcsb/1CRN.pdb") else { return };
    let Some(crn_cif) = data_file("rcsb/1CRN.cif") else { return };
    let crn_atoms = chain_atoms(&crn_pdb, "A");
    let near = &crn_atoms[9];
    let ion = format!(
        "ATOM    329 CA    CA A 101    {:>8.3}{:>8.3}{:>8.3}  1.00 20.00          CA\n",
        near.x + 2.0,
        near.y,
        near.z
    );
    let last_atom = crn_pdb.rfind("\nATOM  ").expect("1CRN.pdb ATOM records");
    let end_of_last = last_atom + 1 + crn_pdb[last_atom + 1..].find('\n').expect("a full line") + 1;
    let with_ion = format!("{}{ion}{}", &crn_pdb[..end_of_last], &crn_pdb[end_of_last..]);
    assert!(with_ion.contains("ATOM    329 CA    CA A 101"), "the fixture holds its ion");
    check("1CRN.pdb with an ATOM-record calcium", &with_ion, &crn_cif, 46);
}
