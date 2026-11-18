// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M6VF33 AC1: an ambiguous codon whose readings are {D, N}, {E, Q} or {I, L} translates to
//! B, Z or J, as Biopython's `CodonTable.AmbiguousForwardTable` reads it through
//! `IUPACData.extended_protein_values`; a codon whose readings all agree is that amino acid (CTN is
//! L); any other mixed set, a stop among them included, stays X.
//!
//! Wrong implementations, and the case that catches each:
//! - X for every ambiguous codon (today's mixed-set rule): RAY, SAR and MTY must be B, Z and J;
//! - B for any set holding D and N (a superset test): RAN reads {K, N, D, E} and must stay X;
//! - J for any set holding I or L: WTY reads {I, F} and YTN under table 3 reads {L, T}, both X;
//! - J for a set holding I and L with something else: MTH under table 2 reads ATA as M, so its
//!   set is {I, L, M} and must stay X, while under table 1 it is {I, L}, so J;
//! - the resolution keyed to table 1's codons only: tables 2 and 11 must resolve the same way;
//! - a stop dropped from the set before the rule is read: TAN reads {Y, *} and must stay X, and
//!   NNN, which reads every amino acid and the stop, stays X.

use molbiocraft_protein::genetic_codes::translate_codon;
use molbiocraft_protein::translate_sequence;

fn read(codon: &str, table: u8) -> char {
    translate_codon(codon.as_bytes(), table) as char
}

#[test]
fn ambiguous_codons_resolve_to_b_z_and_j() {
    // table 1: the eight codons the criterion names
    let named = ["RAY", "SAR", "MTY", "GCN", "CTN", "TAN", "NNN", "RAN"].map(|c| read(c, 1));
    assert_eq!(named, ['B', 'Z', 'J', 'A', 'L', 'X', 'X', 'X']);

    // lower case is read as upper case
    assert_eq!(["ray", "sar", "mty"].map(|c| read(c, 1)), ['B', 'Z', 'J']);

    // tables 2 and 11 resolve B, Z and J the same way
    for table in [2u8, 11] {
        assert_eq!(["RAY", "SAR", "MTY", "GCN", "TAN", "RAN"].map(|c| read(c, table)), ['B', 'Z', 'J', 'A', 'X', 'X'], "table {table}");
    }

    // MTH is {I, L} under table 1, so J; under table 2 ATA is Met, so {I, L, M} stays X
    assert_eq!(read("MTH", 1), 'J');
    assert_eq!(read("ATA", 2), 'M', "fixture: table 2 reads ATA as Met");
    assert_eq!(read("MTH", 2), 'X');

    // a mixed set other than {D, N}, {E, Q} and {I, L} stays X
    for (codon, table, set) in [
        ("RAN", 1, "K, N, D, E"),
        ("KAY", 1, "D, Y"),
        ("YAY", 1, "H, Y"),
        ("WTY", 1, "I, F"),
        ("SAY", 1, "H, D"),
        ("MTY", 3, "I, T: table 3 reads CTN as Thr"),
        ("TAN", 11, "Y, *"),
    ] {
        assert_eq!(read(codon, table), 'X', "{codon} under table {table} reads {set}");
    }
    // a subset of one of the three pairs is that one amino acid, not the pair's code
    assert_eq!(["GAY", "AAY", "GAR", "CAR", "ATY", "CTY"].map(|c| read(c, 1)), ['D', 'N', 'E', 'Q', 'I', 'L']);

    // the translation of a sequence reads the same codons
    assert_eq!(translate_sequence("ATGRAYSARMTYTAA", 0, 1), "MBZJ*");
}
