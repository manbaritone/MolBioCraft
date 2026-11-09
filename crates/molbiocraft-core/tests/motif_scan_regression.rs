// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression: a '*' (or other non-IUPAC symbol) in the sequence made the
//! reverse-strand buffer shorter than the forward one and the JASPAR scan
//! sliced past its end.

use molbiocraft_core::scan_jaspar_pssm_motifs;

#[test]
fn motif_scan_tolerates_symbols_dropped_by_reverse_complement() {
    let seq = format!(
        "{}*{}",
        "TATAAAAGGCGCGCCACGTGTTGACA".repeat(4),
        "CCAATCACGTG".repeat(3)
    );
    let report = scan_jaspar_pssm_motifs(&seq, 0.8, None);
    let json = serde_json::to_string(&report).unwrap();
    assert!(!json.is_empty());
}
