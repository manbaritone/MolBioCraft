// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Measured coordinates for the structure-backed sample documents.
//!
//! Each file is a Cα backbone trace carved out of the corresponding RCSB entry, keeping the
//! HELIX and SHEET records so the secondary structure survives. Side chains, ligands, solvent
//! and nucleic-acid chains are dropped: the workbench's structure viewer reads Cα atoms only,
//! and a full-atom copy of 1A4Y alone would add three quarters of a megabyte to the WASM module
//! that nothing would draw. The documents say so in their own description.

/// GAL4 DNA-binding domain dimer from entry 1D66 (chains A and B; the 19-mer DNA duplex of
/// chains D and E has no Cα atoms and is not part of this trace).
pub const PDB_1D66_CA: &str = include_str!("sample_structures/1d66_ca.pdb");

/// Ribonuclease inhibitor–angiogenin complex from entry 1A4Y (chains A, B, D and E).
pub const PDB_1A4Y_CA: &str = include_str!("sample_structures/1a4y_ca.pdb");

#[cfg(test)]
mod tests {
    use super::*;

    /// A file of the reference-data folder: `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read
    /// from the repo root), else `<repo>/test-data`. When it is absent this prints `skipped:
    /// reference data absent` and returns `None`; with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1` it fails
    /// instead, as the nightly reference check runs it.
    fn reference_text(rel: &str) -> Option<String> {
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

    /// One CA record: chain id, residue number with its insertion code, residue name, and x, y, z
    /// in thousandths of an ångström (the file's three decimals).
    type CaRecord = (String, String, String, [i64; 3]);

    /// The CA atoms of a legacy PDB file's first model, in file order, read from the fixed
    /// columns. Where a residue's CA has alternate locations, only the first listed is kept, and
    /// it must be location A or blank.
    fn ca_records(text: &str) -> Vec<CaRecord> {
        let col = |l: &str, from: usize, to: usize| l.get(from - 1..to.min(l.len())).unwrap_or("").to_string();
        let mut out: Vec<CaRecord> = Vec::new();
        let mut seen = std::collections::HashSet::new();
        for l in text.lines() {
            if l.starts_with("ENDMDL") {
                break;
            }
            if !(l.starts_with("ATOM  ") || l.starts_with("HETATM")) || col(l, 13, 16) != " CA " {
                continue;
            }
            let (chain, residue) = (col(l, 22, 22), col(l, 23, 27).trim().to_string());
            if !seen.insert((chain.clone(), residue.clone())) {
                continue;
            }
            let alt = col(l, 17, 17);
            assert!(alt == " " || alt == "A", "first-listed location of CA {chain} {residue} is {alt:?}");
            let xyz = [31, 39, 47].map(|from| {
                let v: f64 = col(l, from, from + 7).trim().parse().unwrap_or_else(|_| panic!("coordinate in {l}"));
                (v * 1000.0).round() as i64
            });
            out.push((chain, residue, col(l, 18, 20).trim().to_string(), xyz));
        }
        out
    }

    #[test]
    fn ca_traces_are_the_rcsb_entries_ca_atoms() {
        // RCSB entries 1D66 and 1A4Y (CC0), fetched by scripts/outside-data/fetch.sh.
        for (entry, trace, chains, count) in [
            ("1D66", PDB_1D66_CA, &["A", "B"][..], 114),
            ("1A4Y", PDB_1A4Y_CA, &["A", "B", "D", "E"][..], 1166),
        ] {
            let Some(text) = reference_text(&format!("rcsb/{entry}.pdb")) else { continue };
            let want: Vec<CaRecord> = ca_records(&text).into_iter().filter(|r| chains.contains(&r.0.as_str())).collect();
            let got = ca_records(trace);
            assert_eq!(trace.lines().filter(|l| l.starts_with("ATOM") || l.starts_with("HETATM")).count(), got.len(), "{entry}: every trace record is a CA");
            assert_eq!((got.len(), want.len()), (count, count), "{entry}: the CA atoms of chains {chains:?}");
            let mut trace_chains: Vec<&str> = got.iter().map(|r| r.0.as_str()).collect();
            trace_chains.dedup();
            assert_eq!(trace_chains, chains, "{entry}: the trace's chains");
            for (i, (g, w)) in got.iter().zip(&want).enumerate() {
                assert_eq!(g, w, "{entry}: CA record {} of the trace", i + 1);
            }
        }
    }
}
