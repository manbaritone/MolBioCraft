// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! A motif search by IUPAC rules (US-01M7DVBH): each letter of the query and of the target stands
//! for a set of bases (or residues), and a target letter `t` matches a query letter `q`
//! **definitely** when set(t) ⊆ set(q), **possibly** when the sets meet but set(t) ⊄ set(q), and
//! not at all otherwise. A target letter outside the alphabet (a gap, a digit, `*` in nucleotide
//! mode) stands for no base and matches nothing. A window is definite when every position is,
//! possible when every position matches and at least one only possibly.
//!
//! This is separate from `iupac_base_matches` (iupac.rs), which restriction scanning reads and
//! which treats a target N under a query N as a match without telling definite from possible.

use crate::format_thousands;
use serde::{Deserialize, Serialize};

/// Which alphabet the query and target are read in.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MotifAlphabet {
    Nucleotide,
    Protein,
}

/// Whether every position of a window matched definitely, or at least one only possibly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MotifCertainty {
    Definite,
    Possible,
}

/// One window that matches the query. `start` and `end` are 1-based inclusive top-strand
/// coordinates; `start > end` is a window across the origin of a circular molecule. `strand` is
/// -1 when the window matches the query's IUPAC reverse complement. `palindromic` is set when the
/// query is its own reverse complement, letter for letter, so the one +1 hit stands for both
/// strands.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IupacMotifHit {
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    pub certainty: MotifCertainty,
    pub palindromic: bool,
}

/// The first `max_hits` hits by start (the +1 hit first at a shared start), with the counts over
/// the whole molecule and a warning when the list leaves hits out.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IupacMotifSearch {
    pub hits: Vec<IupacMotifHit>,
    pub total_hits: usize,
    pub definite_hits: usize,
    pub possible_hits: usize,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct MotifSearchOptions {
    pub alphabet: MotifAlphabet,
    /// Read the molecule as circular, so a window may cross the origin. Nucleotide mode only:
    /// protein windows never wrap.
    pub circular: bool,
    /// Also report windows that match the query's IUPAC reverse complement, as strand -1.
    /// Nucleotide mode only: a protein query is never reverse-complemented.
    pub both_strands: bool,
    /// How many hits the reply lists, at least 1.
    pub max_hits: usize,
}

const NA_A: u32 = 1;
const NA_C: u32 = 2;
const NA_G: u32 = 4;
const NA_T: u32 = 8;

/// The base set of a nucleotide letter (case ignored, U read as T), or 0 outside the alphabet.
fn nucleotide_set(b: u8) -> u32 {
    match b.to_ascii_uppercase() {
        b'A' => NA_A,
        b'C' => NA_C,
        b'G' => NA_G,
        b'T' | b'U' => NA_T,
        b'R' => NA_A | NA_G,
        b'Y' => NA_C | NA_T,
        b'S' => NA_G | NA_C,
        b'W' => NA_A | NA_T,
        b'K' => NA_G | NA_T,
        b'M' => NA_A | NA_C,
        b'B' => NA_C | NA_G | NA_T,
        b'D' => NA_A | NA_G | NA_T,
        b'H' => NA_A | NA_C | NA_T,
        b'V' => NA_A | NA_C | NA_G,
        b'N' => NA_A | NA_C | NA_G | NA_T,
        _ => 0,
    }
}

/// The 20 standard residues, then U (selenocysteine) and O (pyrrolysine), each its own bit.
const RESIDUES: &[u8; 22] = b"ACDEFGHIKLMNPQRSTVWYUO";
const STOP_BIT: u32 = 1 << 22;

fn residue_bit(r: u8) -> u32 {
    RESIDUES
        .iter()
        .position(|&x| x == r)
        .map(|i| 1u32 << i)
        .unwrap_or(0)
}

/// The residue set of a protein letter (case ignored), or 0 outside the alphabet. U and O are
/// residues of their own: the nucleotide rule that reads U as T never applies here.
fn protein_set(b: u8) -> u32 {
    match b.to_ascii_uppercase() {
        b'B' => residue_bit(b'D') | residue_bit(b'N'),
        b'Z' => residue_bit(b'E') | residue_bit(b'Q'),
        b'J' => residue_bit(b'I') | residue_bit(b'L'),
        b'X' => STOP_BIT - 1,
        b'*' => STOP_BIT,
        other => residue_bit(other),
    }
}

/// The base set of the IUPAC complement of a nucleotide set.
fn complement_set(set: u32) -> u32 {
    let mut out = 0;
    if set & NA_A != 0 {
        out |= NA_T;
    }
    if set & NA_T != 0 {
        out |= NA_A;
    }
    if set & NA_C != 0 {
        out |= NA_G;
    }
    if set & NA_G != 0 {
        out |= NA_C;
    }
    out
}

/// A window's certainty against `pattern` (one set per query letter), or `None` when a position
/// does not match. `base(i)` is the set of the window's i-th target letter.
fn classify(pattern: &[u32], base: impl Fn(usize) -> u32) -> Option<MotifCertainty> {
    let mut certainty = MotifCertainty::Definite;
    for (i, &q) in pattern.iter().enumerate() {
        let t = base(i);
        // A letter outside the alphabet is the empty set, which is a subset of every set; it
        // stands for no base, so it matches nothing.
        if t & q == 0 {
            return None;
        }
        if t & !q != 0 {
            certainty = MotifCertainty::Possible;
        }
    }
    Some(certainty)
}

/// Finds every window of `target` that matches `query` by IUPAC rules, as `MotifSearchOptions`
/// asks, and lists the first `max_hits` (at least 1) by start, the +1 hit first at a shared start.
/// Both strands are scanned together, window by window, so the list is cut only after both are
/// read, and the counts cover the whole molecule.
///
/// Refuses, with the reason as the error: an empty or whitespace-only query ("query is empty"); a
/// query letter outside the alphabet, named as typed ("query letter 'X' is not a nucleotide code",
/// "... is not a protein code"), whitespace inside the query included, since only its leading and
/// trailing whitespace is trimmed; an empty or whitespace-only target ("sequence is empty"), the
/// target itself never trimmed, so its whitespace keeps its positions; and a query longer than
/// the target ("query longer than the sequence (Q > L)"), since a window never covers a base twice.
pub fn search_iupac_motif(
    target: &str,
    query: &str,
    opts: &MotifSearchOptions,
) -> Result<IupacMotifSearch, String> {
    let protein = opts.alphabet == MotifAlphabet::Protein;
    let set_of = if protein { protein_set } else { nucleotide_set };
    let query = query.trim();
    if query.is_empty() {
        return Err("query is empty".to_string());
    }
    let mut pattern = Vec::with_capacity(query.len());
    for ch in query.chars() {
        let set = if ch.is_ascii() { set_of(ch as u8) } else { 0 };
        if set == 0 {
            let kind = if protein { "protein" } else { "nucleotide" };
            return Err(format!("query letter '{}' is not a {} code", ch, kind));
        }
        pattern.push(set);
    }
    if target.trim().is_empty() {
        return Err("sequence is empty".to_string());
    }
    // One set per target character; a non-ASCII character is one position outside the alphabet.
    let bases: Vec<u32> = if target.is_ascii() {
        target.bytes().map(set_of).collect()
    } else {
        target
            .chars()
            .map(|c| if c.is_ascii() { set_of(c as u8) } else { 0 })
            .collect()
    };
    let q = pattern.len();
    let l = bases.len();
    if q > l {
        return Err(format!("query longer than the sequence ({} > {})", q, l));
    }

    let reverse: Vec<u32> = pattern.iter().rev().map(|&s| complement_set(s)).collect();
    // Letter for letter: complementing a letter's set and taking it back to its letter is a
    // bijection on the IUPAC codes, so equal sets mean equal letters (U having been read as T).
    let palindromic = !protein && reverse == pattern;
    let scan_reverse = !protein && opts.both_strands && !palindromic;
    let wrap = !protein && opts.circular;
    let starts = if wrap { l } else { l - q + 1 };
    let cap = opts.max_hits.max(1);

    let mut out = IupacMotifSearch {
        hits: Vec::new(),
        total_hits: 0,
        definite_hits: 0,
        possible_hits: 0,
        warnings: Vec::new(),
    };
    let mut record = |s: usize, strand: i8, certainty: MotifCertainty| {
        out.total_hits += 1;
        match certainty {
            MotifCertainty::Definite => out.definite_hits += 1,
            MotifCertainty::Possible => out.possible_hits += 1,
        }
        if out.hits.len() < cap {
            out.hits.push(IupacMotifHit {
                start: s + 1,
                end: (s + q - 1) % l + 1,
                strand,
                certainty,
                palindromic,
            });
        }
    };
    for s in 0..starts {
        let base = |i: usize| {
            let p = s + i;
            bases[if p >= l { p - l } else { p }]
        };
        if let Some(c) = classify(&pattern, base) {
            record(s, 1, c);
        }
        if scan_reverse {
            if let Some(c) = classify(&reverse, base) {
                record(s, -1, c);
            }
        }
    }
    if out.hits.len() < out.total_hits {
        out.warnings.push(format!(
            "Showing the first {} of {} hits.",
            format_thousands(out.hits.len()),
            format_thousands(out.total_hits)
        ));
    }
    Ok(out)
}
