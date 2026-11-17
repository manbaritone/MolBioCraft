// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! US-01M7DVBH: the IUPAC motif search (`search_iupac_motif`), checked against hits scanned by
//! hand, base by base, from fixtures written here, never against the engine's own output.
//!
//! The wrong implementations each fixture reaches:
//! - an ambiguous target base read as a confirmed one (N under A definite): AC1's `AAA` and `NRA`;
//! - a base outside the alphabet (a gap) read as an empty set, which is a subset of every set, so
//!   a window over it would be a definite match: AC1's gap fixture;
//! - a palindrome (GAATTC, GANTC) reported once per strand: AC2 and AC3;
//! - an origin-crossing site missed, or a linear molecule wrapped: AC3;
//! - a window wrapped onto itself when the query is longer than the molecule, or that case
//!   answered with an empty list: AC3's refusal;
//! - a nucleotide code read as the wrong base set (S, W, K, M, B, D, H, V as well as R, Y and N),
//!   or complemented to the wrong set on the reverse strand: the code-table sweep;
//! - X not covering U, O or the ambiguity codes, X covering `*`, U read as T in protein mode, a
//!   protein window wrapped: AC4;
//! - a protein query reverse-complemented, or flagged palindromic, by the nucleotide rules: AC4's
//!   fixtures made only of A, C, D and E. A query holding any other residue cannot reach this
//!   defect in this engine, since its complement carries an empty set that matches nothing, so
//!   the GAC and ACGT protein fixtures alone would pass with it;
//! - the forward strand filling the cap before the reverse strand is read, the counts taken from
//!   the listed hits only, the reverse hit first at a shared start, a warning missing or without
//!   thousands separators, whitespace inside a query accepted, an empty reply instead of a
//!   refusal: AC5.

use molbiocraft_core::{
    search_iupac_motif, IupacMotifSearch, MotifAlphabet, MotifCertainty, MotifSearchOptions,
};

const D: MotifCertainty = MotifCertainty::Definite;
const P: MotifCertainty = MotifCertainty::Possible;

fn opts(alphabet: MotifAlphabet, circular: bool, both_strands: bool, max_hits: usize) -> MotifSearchOptions {
    MotifSearchOptions { alphabet, circular, both_strands, max_hits }
}

fn nuc(circular: bool, both_strands: bool) -> MotifSearchOptions {
    opts(MotifAlphabet::Nucleotide, circular, both_strands, 1_000_000)
}

fn prot(circular: bool, both_strands: bool) -> MotifSearchOptions {
    opts(MotifAlphabet::Protein, circular, both_strands, 1_000_000)
}

fn search(target: &str, query: &str, o: MotifSearchOptions) -> IupacMotifSearch {
    search_iupac_motif(target, query, &o)
        .unwrap_or_else(|e| panic!("{query:?} on {target:?} refused: {e}"))
}

/// Each hit as (start, end, strand, certainty, palindromic).
fn hits(target: &str, query: &str, o: MotifSearchOptions) -> Vec<(usize, usize, i8, MotifCertainty, bool)> {
    let r = search(target, query, o);
    assert_eq!(r.hits.len(), r.total_hits, "{query:?}: an uncut reply lists every hit");
    assert!(r.warnings.is_empty(), "{query:?}: an uncut reply carries no warning: {:?}", r.warnings);
    r.hits
        .iter()
        .map(|h| (h.start, h.end, h.strand, h.certainty, h.palindromic))
        .collect()
}

fn refusal(target: &str, query: &str, o: MotifSearchOptions) -> String {
    match search_iupac_motif(target, query, &o) {
        Err(reason) => reason,
        Ok(reply) => panic!("{query:?} on {target:?} must be refused, got {reply:?}"),
    }
}

#[test]
fn us_01m7dvbh_ac1_definite_and_possible_hits_on_the_forward_strand() {
    let t = "ACGTNRACGT";
    let fwd = nuc(false, false);
    // ACG: positions 1-3 ACG and 7-9 ACG; no other window starts A C {G}.
    assert_eq!(hits(t, "ACG", fwd), vec![(1, 3, 1, D, false), (7, 9, 1, D, false)]);
    // AAA: only 5-7 (N R A) meets every position at least possibly; N under A and R under A are
    // possible, so the window is possible, never definite.
    assert_eq!(hits(t, "AAA", fwd), vec![(5, 7, 1, P, false)]);
    // NRA: 5-7 N R A is definite (N in N, R in R, A in A); 4-6 T N R: T in N, N under R possible,
    // R under A possible.
    assert_eq!(hits(t, "NRA", fwd), vec![(4, 6, 1, P, false), (5, 7, 1, D, false)]);
    // Case is ignored on both sides, and U is read as T in nucleotide mode.
    assert_eq!(hits("acgtnracgt", "acg", fwd), hits(t, "ACG", fwd));
    assert_eq!(hits("ACGUNRACGU", "CGU", fwd), vec![(2, 4, 1, D, false), (8, 10, 1, D, false)]);
}

#[test]
fn us_01m7dvbh_ac1_n_under_n_is_definite_and_a_gap_matches_nothing() {
    let fwd = nuc(false, false);
    // N and NN are their own reverse complement, so every hit is flagged palindromic, with or
    // without the reverse strand searched.
    assert_eq!(hits("ANA", "N", fwd), vec![(1, 1, 1, D, true), (2, 2, 1, D, true), (3, 3, 1, D, true)]);
    assert_eq!(hits("ANA", "N", nuc(false, true)), hits("ANA", "N", fwd));
    // A gap, a stop and a digit are outside the alphabet: no window covering one is a match, not
    // even under N, which accepts every base.
    assert_eq!(hits("AC-GT", "N", fwd), vec![(1, 1, 1, D, true), (2, 2, 1, D, true), (4, 4, 1, D, true), (5, 5, 1, D, true)]);
    assert_eq!(hits("AC-GT", "NN", fwd), vec![(1, 2, 1, D, true), (4, 5, 1, D, true)]);
    assert_eq!(hits("A*1A", "NN", fwd), vec![]);
}

#[test]
fn us_01m7dvbh_ac1_every_hit_carries_the_reply_fields() {
    let r = search("ACGTNRACGT", "NRA", nuc(false, false));
    let v = serde_json::to_value(&r).unwrap();
    assert_eq!(
        v,
        serde_json::json!({
            "hits": [
                { "start": 4, "end": 6, "strand": 1, "certainty": "possible", "palindromic": false },
                { "start": 5, "end": 7, "strand": 1, "certainty": "definite", "palindromic": false },
            ],
            "totalHits": 2, "definiteHits": 1, "possibleHits": 1, "warnings": [],
        })
    );
}

#[test]
fn us_01m7dvbh_ac2_reverse_strand_hits_use_top_strand_coordinates() {
    // GAGACC (BsaI) reverse-complements to GGTCTC, which sits at 4-9 of the top strand.
    let t = "AAAGGTCTCAAAGAGACCAA";
    assert_eq!(hits(t, "GAGACC", nuc(false, true)), vec![(4, 9, -1, D, false), (13, 18, 1, D, false)]);
    // With both strands off, no strand -1 hit.
    assert_eq!(hits(t, "GAGACC", nuc(false, false)), vec![(13, 18, 1, D, false)]);
    // The reverse complement is taken by IUPAC rules: RC(GAN) = NTC, so CTC at 3-5 and ATC at 8-10
    // are reverse hits; GAT at 7-9 is a forward hit; window 2-4 GCT matches neither.
    assert_eq!(
        hits("AGCTCAGATCA", "GAN", nuc(false, true)),
        vec![(3, 5, -1, D, false), (7, 9, 1, D, false), (8, 10, -1, D, false)]
    );
    // An ambiguous target base under the reverse complement is possible: RC(GAC) = GTC, and Y={C,T}
    // under T is possible, while Y under A (the forward query) is nothing.
    assert_eq!(hits("AGYCA", "GAC", nuc(false, true)), vec![(2, 4, -1, P, false)]);
}

#[test]
fn us_01m7dvbh_ac2_a_palindrome_is_one_hit_per_site_on_the_forward_strand() {
    // GAATTC is its own reverse complement: one hit per site, strand +1, flagged palindromic.
    assert_eq!(hits("AAGAATTCAAGAATTCA", "GAATTC", nuc(false, true)), vec![(3, 8, 1, D, true), (11, 16, 1, D, true)]);
    // GANTC is too (RC: C->G, T->A, N->N, A->T, G->C, reversed).
    assert_eq!(hits("AGACTCA", "GANTC", nuc(false, true)), vec![(2, 6, 1, D, true)]);
    // Typed with U it is still GAATTC.
    assert_eq!(hits("AAGAATTCAA", "GAAUUC", nuc(false, true)), vec![(3, 8, 1, D, true)]);
    // A non-palindrome is flagged false on both strands.
    assert!(hits("AAAGGTCTCAAAGAGACCAA", "GAGACC", nuc(false, true)).iter().all(|h| !h.4));
}

#[test]
fn us_01m7dvbh_ac3_hits_cross_the_origin_of_a_circular_molecule() {
    // 3,000 bp: 1-3 TTC, 4-2997 A, 2998-3000 GAA. GAATTC reads 2998 3000 then 1 3.
    let eco = format!("TTC{}GAA", "A".repeat(2994));
    assert_eq!(eco.len(), 3000);
    assert_eq!(hits(&eco, "GAATTC", nuc(true, true)), vec![(2998, 3, 1, D, true)]);
    assert_eq!(hits(&eco, "GAATTC", nuc(false, true)), vec![]);
    // GGTCTC across the origin: 2998-3000 GGT, 1-3 CTC. GAGACC finds it on strand -1.
    let bsa = format!("CTC{}GGT", "A".repeat(2994));
    assert_eq!(bsa.len(), 3000);
    assert_eq!(hits(&bsa, "GAGACC", nuc(true, true)), vec![(2998, 3, -1, D, false)]);
    assert_eq!(hits(&bsa, "GAGACC", nuc(false, true)), vec![]);
    assert_eq!(hits(&bsa, "GAGACC", nuc(true, false)), vec![]);
}

#[test]
fn us_01m7dvbh_ac3_a_window_never_covers_a_base_twice() {
    for circular in [false, true] {
        assert_eq!(refusal("ACGTAC", "ACGTACG", nuc(circular, true)), "query longer than the sequence (7 > 6)");
        assert_eq!(refusal("MKV", "MKVL", prot(circular, false)), "query longer than the sequence (4 > 3)");
    }
    // A query as long as a circular molecule reads each rotation once, each base once per window:
    // ACGT, CGTA, GTAC, TACG; only the rotation at 1 is ACGT, and RC(ACGT) = ACGT.
    assert_eq!(hits("ACGT", "ACGT", nuc(true, true)), vec![(1, 4, 1, D, true)]);
    assert_eq!(hits("ACGT", "GTAC", nuc(true, true)), vec![(3, 2, 1, D, true)]);
}

#[test]
fn us_01m7dvbh_ac4_protein_x_covers_every_residue_but_not_stop() {
    let p = prot(false, false);
    // X = the 20 standard residues, U and O: B, Z, J, X, U and O under X are definite; * is not.
    assert_eq!(
        hits("BZJXUO*", "X", p),
        vec![(1, 1, 1, D, false), (2, 2, 1, D, false), (3, 3, 1, D, false), (4, 4, 1, D, false), (5, 5, 1, D, false), (6, 6, 1, D, false)]
    );
    let all = "ACDEFGHIKLMNPQRSTVWYUO";
    assert_eq!(search(all, "X", p).definite_hits, 22);
    assert_eq!(search(all, "X", p).total_hits, 22);
    // * matches only *.
    assert_eq!(hits("A*X*", "*", p), vec![(2, 2, 1, D, false), (4, 4, 1, D, false)]);
    // A gap matches nothing, even under X.
    assert_eq!(hits("M-K", "X", p), vec![(1, 1, 1, D, false), (3, 3, 1, D, false)]);
}

#[test]
fn us_01m7dvbh_ac4_protein_u_is_selenocysteine_not_t() {
    let p = prot(false, false);
    assert_eq!(hits("UTCU", "U", p), vec![(1, 1, 1, D, false), (4, 4, 1, D, false)]);
    assert_eq!(hits("UTCU", "T", p), vec![(2, 2, 1, D, false)]);
    assert_eq!(hits("OK", "O", p), vec![(1, 1, 1, D, false)]);
}

#[test]
fn us_01m7dvbh_ac4_ambiguous_target_residues_are_possible() {
    let p = prot(false, false);
    // B={D,N} under D: possible. X under D: possible. N under D: no. D under D: definite.
    assert_eq!(hits("BXND", "D", p), vec![(1, 1, 1, P, false), (2, 2, 1, P, false), (4, 4, 1, D, false)]);
    // Z={E,Q} under E, J={I,L} under L: possible; under a query B, a target B is definite.
    assert_eq!(hits("ZJ", "E", p), vec![(1, 1, 1, P, false)]);
    assert_eq!(hits("ZJ", "L", p), vec![(2, 2, 1, P, false)]);
    assert_eq!(hits("BDNE", "B", p), vec![(1, 1, 1, D, false), (2, 2, 1, D, false), (3, 3, 1, D, false)]);
    // Nucleotide codes mean nothing in protein mode: R is arginine, N asparagine.
    assert_eq!(hits("RAGN", "R", p), vec![(1, 1, 1, D, false)]);
}

#[test]
fn us_01m7dvbh_ac4_protein_is_one_strand_and_never_wraps() {
    // GAC reverse-complements to GTC at 1-3, but a protein query is never reverse-complemented,
    // even with both strands asked for.
    let r = search("GTCGAC", "GAC", prot(false, true));
    assert_eq!(r.hits.iter().map(|h| (h.start, h.end, h.strand)).collect::<Vec<_>>(), vec![(4, 6, 1)]);
    assert!(r.hits.iter().all(|h| !h.palindromic));
    // ACGT is its own reverse complement in DNA; in protein it is just four residues.
    assert_eq!(hits("ACGTACGT", "ACGT", prot(true, true)), vec![(1, 4, 1, D, false), (5, 8, 1, D, false)]);
    // Circular asked for: a protein window still never wraps (GAC would read 5, 6, 1).
    assert_eq!(hits("CDEFGA", "GAC", prot(true, true)), vec![]);
    assert_eq!(hits("CTTTGA", "GAC", nuc(true, false)), vec![(5, 1, 1, D, false)]);
}

#[test]
fn us_01m7dvbh_ac4_a_protein_query_of_a_c_d_e_is_never_reverse_complemented() {
    // The protein residues A, C, D and E are the letters most likely to be read through the
    // nucleotide complement by mistake: AAA would complement to TTT (or, as residue sets, to EEE),
    // and AE would read as its own reverse complement. In protein mode none of that applies.
    let both = prot(false, true);
    // AAA on EEEDE: no window holds AAA, and no strand -1 hit is reported.
    assert_eq!(hits("EEEDE", "AAA", both), vec![]);
    assert_eq!(hits("EEEDE", "EEE", both), vec![(1, 3, 1, D, false)]);
    // AE on AEAE: two forward hits, neither flagged palindromic, and no strand -1 hit.
    assert_eq!(hits("AEAE", "AE", both), vec![(1, 2, 1, D, false), (3, 4, 1, D, false)]);
    // CD on DCDC: only the forward CD at 2-3; DC at 1-2 and 3-4 is not a reverse hit.
    assert_eq!(hits("DCDC", "CD", both), vec![(2, 3, 1, D, false)]);
    // The same letters as nucleotides do reverse-complement: AAA finds TTT on strand -1.
    assert_eq!(hits("TTTGT", "AAA", nuc(false, true)), vec![(1, 3, -1, D, false)]);
}

/// Each nucleotide code with its bases, written from the IUPAC table by hand.
const CODE_TABLE: &[(char, &str)] = &[
    ('A', "A"), ('C', "C"), ('G', "G"), ('T', "T"), ('U', "T"),
    ('R', "AG"), ('Y', "CT"), ('S', "CG"), ('W', "AT"), ('K', "GT"), ('M', "AC"),
    ('B', "CGT"), ('D', "AGT"), ('H', "ACT"), ('V', "ACG"), ('N', "ACGT"),
];

fn complement_bases(bases: &str) -> String {
    let mut out: Vec<char> = bases
        .chars()
        .map(|b| match b { 'A' => 'T', 'T' => 'A', 'C' => 'G', 'G' => 'C', _ => unreachable!() })
        .collect();
    out.sort_unstable();
    out.into_iter().collect()
}

#[test]
fn us_01m7dvbh_ac1_every_nucleotide_code_is_its_base_set() {
    for &(code, bases) in CODE_TABLE {
        // As a query on A, C, G, T: a definite hit at each base in the set, and nowhere else.
        let want: Vec<_> = "ACGT"
            .char_indices()
            .filter(|(_, b)| bases.contains(*b))
            .map(|(i, _)| (i + 1, i + 1, 1, D))
            .collect();
        let got: Vec<_> = search("ACGT", &code.to_string(), nuc(false, false))
            .hits
            .iter()
            .map(|h| (h.start, h.end, h.strand, h.certainty))
            .collect();
        assert_eq!(got, want, "query {code}");
        for q in ['A', 'C', 'G', 'T'] {
            // As a target under one base: definite when it is that base alone, possible when the
            // set holds it and more, nothing when the set does not hold it.
            let want = if !bases.contains(q) {
                vec![]
            } else if bases.len() == 1 {
                vec![(1, 1, 1, D)]
            } else {
                vec![(1, 1, 1, P)]
            };
            let got: Vec<_> = search(&code.to_string(), &q.to_string(), nuc(false, false))
                .hits
                .iter()
                .map(|h| (h.start, h.end, h.strand, h.certainty))
                .collect();
            assert_eq!(got, want, "target {code} under query {q}");
        }
        // Under itself and under N a code is definite.
        assert_eq!(search(&code.to_string(), &code.to_string(), nuc(false, false)).definite_hits, 1, "{code} under {code}");
        assert_eq!(search(&code.to_string(), "N", nuc(false, false)).definite_hits, 1, "{code} under N");
    }
}

#[test]
fn us_01m7dvbh_ac2_every_nucleotide_code_complements_to_its_base_set() {
    for &(code, bases) in CODE_TABLE {
        let comp = complement_bases(bases);
        let mut sorted: Vec<char> = bases.chars().collect();
        sorted.sort_unstable();
        let self_rc = sorted.into_iter().collect::<String>() == comp;
        // With both strands on, the base at each position is a +1 hit when the set holds it and a
        // -1 hit when the complement set does, unless the code is its own complement (S, W, N),
        // which reports once on +1 flagged palindromic.
        let mut want = Vec::new();
        for (i, b) in "ACGT".char_indices() {
            if bases.contains(b) {
                want.push((i + 1, 1, self_rc));
            }
            if !self_rc && comp.contains(b) {
                want.push((i + 1, -1, false));
            }
        }
        let got: Vec<_> = search("ACGT", &code.to_string(), nuc(false, true))
            .hits
            .iter()
            .map(|h| (h.start, h.strand, h.palindromic))
            .collect();
        assert_eq!(got, want, "query {code}, both strands");
    }
}

#[test]
fn us_01m7dvbh_ac5_refusals_carry_exactly_their_reason() {
    let n = nuc(false, true);
    let p = prot(false, false);
    assert_eq!(refusal("ACGT", "", n), "query is empty");
    assert_eq!(refusal("ACGT", "  \t\n ", n), "query is empty");
    assert_eq!(refusal("ACGT", "", p), "query is empty");
    assert_eq!(refusal("ACGT", "ACXG", n), "query letter 'X' is not a nucleotide code");
    assert_eq!(refusal("ACGT", "acxeg", n), "query letter 'x' is not a nucleotide code");
    assert_eq!(refusal("ACGT", "AC-G", n), "query letter '-' is not a nucleotide code");
    assert_eq!(refusal("ACGT", "A*", n), "query letter '*' is not a nucleotide code");
    assert_eq!(refusal("MKV", "MK1", p), "query letter '1' is not a protein code");
    assert_eq!(refusal("MKV", "Mé", p), "query letter 'é' is not a protein code");
    // Whitespace inside a query is a letter outside the alphabet.
    assert_eq!(refusal("ACGTACGT", "AC GT", n), "query letter ' ' is not a nucleotide code");
    assert_eq!(refusal("MKVL", "MK\tV", p), "query letter '\t' is not a protein code");
    assert_eq!(refusal("", "ACG", n), "sequence is empty");
    assert_eq!(refusal("", "MK", p), "sequence is empty");
    // Leading and trailing whitespace is trimmed.
    // RC(ACG) = CGT sits at 4-6.
    assert_eq!(hits("TTACGTT", "  ACG\n", n), vec![(3, 5, 1, D, false), (4, 6, -1, D, false)]);
}

#[test]
fn us_01m7dvbh_ac5_both_strands_are_collected_before_the_cut() {
    // Hand scan for GAC (RC GTC) over GACAGTCAAAAGACAAGRCAAGTCA (25 bp); every G starts a window:
    // 1 GAC +1 definite; 5 GTC -1 definite; 12 GAC +1 definite; 17 GRC +1 possible (R under A;
    // R under T is nothing, so no -1); 22 GTC -1 definite. Five hits, four definite, one possible.
    let t = "GACAGTCAAAAGACAAGRCAAGTCA";
    let all = hits(t, "GAC", nuc(false, true));
    assert_eq!(all, vec![(1, 3, 1, D, false), (5, 7, -1, D, false), (12, 14, 1, D, false), (17, 19, 1, P, false), (22, 24, -1, D, false)]);
    let r = search(t, "GAC", opts(MotifAlphabet::Nucleotide, false, true, 2));
    let listed: Vec<_> = r.hits.iter().map(|h| (h.start, h.end, h.strand, h.certainty)).collect();
    assert_eq!(listed, vec![(1, 3, 1, D), (5, 7, -1, D)]);
    assert_eq!((r.total_hits, r.definite_hits, r.possible_hits), (5, 4, 1));
    assert_eq!(r.warnings, vec!["Showing the first 2 of 5 hits.".to_string()]);
}

#[test]
fn us_01m7dvbh_ac5_order_cap_floor_and_thousands() {
    // AN reverse-complements to NT; AT at 1-2 matches both: the +1 hit comes first at the shared
    // start, and both are listed.
    assert_eq!(hits("AT", "AN", nuc(false, true)), vec![(1, 2, 1, D, false), (1, 2, -1, D, false)]);
    // maxHits 0 keeps one hit.
    let r = search("AAAA", "A", opts(MotifAlphabet::Nucleotide, false, false, 0));
    assert_eq!((r.hits.len(), r.total_hits), (1, 4));
    assert_eq!(r.warnings, vec!["Showing the first 1 of 4 hits.".to_string()]);
    // Thousands separators, as search_resident_motif_fmindex writes them.
    let r = search(&"A".repeat(1500), "A", opts(MotifAlphabet::Nucleotide, false, false, 1000));
    assert_eq!((r.hits.len(), r.total_hits, r.definite_hits, r.possible_hits), (1000, 1500, 1500, 0));
    assert_eq!(r.warnings, vec!["Showing the first 1,000 of 1,500 hits.".to_string()]);
    // A list cut at exactly its length carries no warning.
    let r = search("AAAA", "A", opts(MotifAlphabet::Nucleotide, false, false, 4));
    assert_eq!((r.hits.len(), r.total_hits), (4, 4));
    assert!(r.warnings.is_empty());
}
