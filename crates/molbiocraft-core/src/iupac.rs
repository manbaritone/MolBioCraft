// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

use crate::types::SequenceStats;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Deterministic SplitMix64 PRNG for reproducible shuffling, bootstrap resampling, and simulation
/// across both native targets and WebAssembly (`wasm32-unknown-unknown`).
#[derive(Debug, Clone)]
pub struct SplitMix64 {
    state: u64,
}

impl SplitMix64 {
    pub fn new(seed: u64) -> Self {
        Self {
            state: if seed == 0 { 0x9E37_79B9_7F4A_7C15 } else { seed },
        }
    }

    #[inline]
    pub fn next_u64(&mut self) -> u64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    #[inline]
    pub fn next_f64(&mut self) -> f64 {
        ((self.next_u64() >> 11) as f64) * (1.0 / ((1u64 << 53) as f64))
    }

    #[inline]
    pub fn next_usize(&mut self, upper_exclusive: usize) -> usize {
        if upper_exclusive <= 1 {
            0
        } else {
            (self.next_u64() as usize) % upper_exclusive
        }
    }
}

/// Strip whitespace, digits, and non-alphabetic characters while uppercasing ASCII residues.
pub fn clean_sequence(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        if b.is_ascii_alphabetic() || b == b'*' || b == b'-' {
            out.push((b.to_ascii_uppercase()) as char);
        }
    }
    out
}

/// Strip everything except alphabetic IUPAC letters and uppercase.
pub fn clean_alpha_sequence(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    for b in raw.bytes() {
        if b.is_ascii_alphabetic() {
            out.push((b.to_ascii_uppercase()) as char);
        }
    }
    out
}

#[inline]
pub fn iupac_complement_byte(b: u8, is_rna: bool) -> u8 {
    match b.to_ascii_uppercase() {
        b'A' => {
            if is_rna {
                b'U'
            } else {
                b'T'
            }
        }
        b'T' | b'U' => b'A',
        b'G' => b'C',
        b'C' => b'G',
        b'R' => b'Y',
        b'Y' => b'R',
        b'S' => b'S',
        b'W' => b'W',
        b'K' => b'M',
        b'M' => b'K',
        b'B' => b'V',
        b'V' => b'B',
        b'D' => b'H',
        b'H' => b'D',
        b'N' => b'N',
        b'-' => b'-',
        other => other,
    }
}

/// Parallel- strand 5'->3' to 3'->5' IUPAC complement without reversing order.
pub fn complement_sequence(seq: &str, is_rna: bool) -> String {
    let mut bytes = Vec::with_capacity(seq.len());
    for b in seq.bytes() {
        if b.is_ascii_alphabetic() || b == b'-' {
            bytes.push(iupac_complement_byte(b, is_rna));
        }
    }
    // SAFETY: all pushed bytes are valid ASCII characters.
    unsafe { String::from_utf8_unchecked(bytes) }
}

/// Antiparallel 5'->3' reverse complement supporting full IUPAC ambiguity codes.
pub fn reverse_complement_iupac(seq: &str, is_rna: bool) -> String {
    let mut bytes = Vec::with_capacity(seq.len());
    for b in seq.bytes().rev() {
        if b.is_ascii_alphabetic() || b == b'-' {
            bytes.push(iupac_complement_byte(b, is_rna));
        }
    }
    unsafe { String::from_utf8_unchecked(bytes) }
}

/// Reverse sequence polarity without complementing bases.
pub fn reverse_only_sequence(seq: &str) -> String {
    let mut bytes: Vec<u8> = seq
        .bytes()
        .filter(|b| b.is_ascii_alphabetic() || *b == b'-')
        .map(|b| b.to_ascii_uppercase())
        .collect();
    bytes.reverse();
    unsafe { String::from_utf8_unchecked(bytes) }
}

/// Convert DNA <-> RNA (`T` <-> `U`) preserving IUPAC symbols.
pub fn convert_dna_rna(seq: &str, to_rna: bool) -> String {
    let mut bytes = Vec::with_capacity(seq.len());
    for b in seq.bytes() {
        if !b.is_ascii_alphabetic() {
            continue;
        }
        let u = b.to_ascii_uppercase();
        bytes.push(if to_rna && u == b'T' {
            b'U'
        } else if !to_rna && u == b'U' {
            b'T'
        } else {
            u
        });
    }
    unsafe { String::from_utf8_unchecked(bytes) }
}

/// Check whether a nucleotide byte matches an IUPAC pattern byte.
#[inline]
pub fn iupac_base_matches(seq_base: u8, pattern_base: u8) -> bool {
    let s = match seq_base.to_ascii_uppercase() {
        b'U' => b'T',
        other => other,
    };
    match pattern_base.to_ascii_uppercase() {
        b'A' => s == b'A',
        b'C' => s == b'C',
        b'G' => s == b'G',
        b'T' | b'U' => s == b'T',
        b'R' => s == b'A' || s == b'G',
        b'Y' => s == b'C' || s == b'T',
        b'S' => s == b'G' || s == b'C',
        b'W' => s == b'A' || s == b'T',
        b'K' => s == b'G' || s == b'T',
        b'M' => s == b'A' || s == b'C',
        b'B' => s == b'C' || s == b'G' || s == b'T',
        b'D' => s == b'A' || s == b'G' || s == b'T',
        b'H' => s == b'A' || s == b'C' || s == b'T',
        b'V' => s == b'A' || s == b'C' || s == b'G',
        b'N' => matches!(s, b'A' | b'C' | b'G' | b'T' | b'N'),
        _ => false,
    }
}

/// Biopython's average dNMP masses in Da (`IUPACData.unambiguous_dna_weights`: A, C, G, T) and the
/// water `molecular_weight` takes off for each bond (its `monoisotopic=False` value).
const DNMP_DA: [f64; 4] = [331.2218, 307.1971, 347.2212, 322.2085];
const WATER_DA: f64 = 18.0153;

/// The single- and double-stranded masses in Da of a linear DNA of these base counts, as Biopython
/// 1.88 `molecular_weight(seq, "DNA", double_stranded, circular=False)` weighs it: each strand is
/// the sum of its dNMP masses less one water per bond (a 5′ phosphate and a 3′ OH), and the double
/// strand adds the complementary strand, whose composition is the complement's. A closed circle
/// has one bond more per strand, so it weighs one water less per strand. `n` counts N and the
/// other IUPAC codes, which Biopython refuses: each is weighed as the mean of the four (Biopython's
/// `avg_ambiguous_dna_weights` N), so a mass with any of them is an estimate. Zero bases weigh 0.
fn linear_dna_masses_da(a: usize, c: usize, g: usize, t: usize, n: usize) -> (f64, f64) {
    let len = a + c + g + t + n;
    if len == 0 {
        return (0.0, 0.0);
    }
    let [wa, wc, wg, wt] = DNMP_DA;
    let wn = (wa + wc + wg + wt) / 4.0;
    let (a, c, g, t, n) = (a as f64, c as f64, g as f64, t as f64, n as f64);
    let bonds = (len - 1) as f64 * WATER_DA;
    let strand = a * wa + c * wc + g * wg + t * wt + n * wn - bonds;
    let complement = t * wa + g * wc + c * wg + a * wt + n * wn - bonds;
    (strand, strand + complement)
}

/// Compute comprehensive nucleotide biophysical & informational statistics in a single $O(N)$ byte scan.
/// Handles multi-megabase genomes with zero intermediate heap allocations for the sequence.
pub fn compute_sequence_stats_fast(seq: &str) -> SequenceStats {
    let mut a_cnt = 0usize;
    let mut t_cnt = 0usize;
    let mut g_cnt = 0usize;
    let mut c_cnt = 0usize;
    let mut n_cnt = 0usize;
    let mut valid_len = 0usize;

    for b in seq.bytes() {
        if !b.is_ascii_alphabetic() {
            continue;
        }
        valid_len += 1;
        match b.to_ascii_uppercase() {
            b'A' => a_cnt += 1,
            b'T' | b'U' => t_cnt += 1,
            b'G' => g_cnt += 1,
            b'C' => c_cnt += 1,
            _ => n_cnt += 1,
        }
    }

    let mut counts = HashMap::with_capacity(5);
    counts.insert('A', a_cnt);
    counts.insert('T', t_cnt);
    counts.insert('G', g_cnt);
    counts.insert('C', c_cnt);
    counts.insert('N', n_cnt);

    let a = a_cnt as f64;
    let t = t_cnt as f64;
    let g = g_cnt as f64;
    let c = c_cnt as f64;
    let canonical = (a + t + g + c).max(1.0);

    let gc_percent = ((g + c) / canonical) * 100.0;
    let at_percent = ((a + t) / canonical) * 100.0;
    let gc_skew = if g + c > 0.0 { (g - c) / (g + c) } else { 0.0 };
    let at_skew = if a + t > 0.0 { (a - t) / (a + t) } else { 0.0 };

    let (mw_ssdna_da, mw_dsdna_da) = linear_dna_masses_da(a_cnt, c_cnt, g_cnt, t_cnt, n_cnt);
    let mw_rna_da = a * 329.21 + t * 306.17 + g * 345.21 + c * 305.18 + (n_cnt as f64) * 321.44 + 159.0;

    let basic_tm_c = if valid_len == 0 {
        0.0
    } else if valid_len < 14 {
        2.0 * (a + t) + 4.0 * (g + c)
    } else {
        64.9 + 41.0 * ((g + c - 16.4) / canonical)
    };

    let mut entropy = 0.0;
    for cnt in [a, t, g, c] {
        if cnt > 0.0 {
            let p = cnt / canonical;
            entropy -= p * p.log2();
        }
    }

    SequenceStats {
        length: valid_len,
        gc_percent,
        at_percent,
        mw_ssdna_da,
        mw_dsdna_da,
        mw_rna_da,
        basic_tm_c,
        gc_skew,
        at_skew,
        shannon_entropy_bits: entropy,
        counts,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SequenceBaseCounts {
    #[serde(rename = "A")]
    pub a: usize,
    #[serde(rename = "T")]
    pub t: usize,
    #[serde(rename = "G")]
    pub g: usize,
    #[serde(rename = "C")]
    pub c: usize,
    #[serde(rename = "N")]
    pub n: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SequenceComposition {
    pub length: usize,
    pub gc_percent: f64,
    pub at_percent: f64,
    /// The linear chain's masses in Da, Biopython's (`linear_dna_masses_da`); estimates when
    /// `counts.n` is not 0.
    pub mw_ss_dna_da: f64,
    pub mw_ds_dna_da: f64,
    pub extinction_coeff260: f64,
    pub melting_temp_basic_c: f64,
    pub counts: SequenceBaseCounts,
    /// The 1-based start of each Dam (`GATC`) site, the first [`METHYLATION_SITE_LIST_CAP`] at most.
    pub dam_sites: Vec<usize>,
    /// The 1-based start of each Dcm (`CCWGG`) site, the first [`METHYLATION_SITE_LIST_CAP`] at most.
    pub dcm_sites: Vec<usize>,
    /// A sentence for each site list the cap cut, with the whole count of its sites (D0005,
    /// BG-01M6S17Y). Always serialised, as an empty list when both lists are whole.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most Dam and the most Dcm sites [`analyze_sequence_composition`] lists, each.
pub const METHYLATION_SITE_LIST_CAP: usize = 4096;

/// Fast single-pass sequence composition, molecular weight, Beer-Lambert $\varepsilon_{260}$,
/// basic $T_m$, and Dam (`GATC`) / Dcm (`CCWGG`) methylation site scanner.
/// Caps returned Dam/Dcm coordinate lists at 4,096 sites on multi-megabase genomes for bounded IPC
/// size; every site is still counted, and a cut list is named in `warnings` with its whole count.
pub fn analyze_sequence_composition(raw_seq: &str) -> SequenceComposition {
    let mut cleaned: Vec<u8> = Vec::with_capacity(raw_seq.len());
    let mut a_cnt = 0usize;
    let mut t_cnt = 0usize;
    let mut g_cnt = 0usize;
    let mut c_cnt = 0usize;
    let mut n_cnt = 0usize;

    for b in raw_seq.bytes() {
        if !b.is_ascii_alphabetic() {
            continue;
        }
        let u = match b.to_ascii_uppercase() {
            b'U' => b'T',
            other => other,
        };
        cleaned.push(u);
        match u {
            b'A' => a_cnt += 1,
            b'T' => t_cnt += 1,
            b'G' => g_cnt += 1,
            b'C' => c_cnt += 1,
            _ => n_cnt += 1,
        }
    }

    let len = cleaned.len();
    let total_canonical = (a_cnt + t_cnt + g_cnt + c_cnt).max(1) as f64;
    let gc_percent = ((g_cnt + c_cnt) as f64 / total_canonical) * 100.0;
    let at_percent = ((a_cnt + t_cnt) as f64 / total_canonical) * 100.0;

    let (mw_ss_dna_da, mw_ds_dna_da) = linear_dna_masses_da(a_cnt, c_cnt, g_cnt, t_cnt, n_cnt);
    let extinction_coeff260 = (a_cnt as f64) * 15400.0
        + (c_cnt as f64) * 7400.0
        + (g_cnt as f64) * 11500.0
        + (t_cnt as f64) * 8700.0;

    let melting_temp_basic_c = if len < 14 {
        2.0 * ((a_cnt + t_cnt) as f64) + 4.0 * ((g_cnt + c_cnt) as f64)
    } else {
        64.9 + (41.0 * (((g_cnt + c_cnt) as f64) - 16.4)) / total_canonical
    };

    let mut dam_sites = Vec::new();
    let mut dcm_sites = Vec::new();
    let (mut dam_total, mut dcm_total) = (0usize, 0usize);
    if len >= 4 {
        for i in 0..=(len - 4) {
            if &cleaned[i..i + 4] == b"GATC" {
                dam_total += 1;
                if dam_sites.len() < METHYLATION_SITE_LIST_CAP {
                    dam_sites.push(i + 1);
                }
            }
            if i + 5 <= len {
                let pent = &cleaned[i..i + 5];
                if pent == b"CCAGG" || pent == b"CCTGG" {
                    dcm_total += 1;
                    if dcm_sites.len() < METHYLATION_SITE_LIST_CAP {
                        dcm_sites.push(i + 1);
                    }
                }
            }
        }
    }
    let warnings = [("Dam", "GATC", dam_total), ("Dcm", "CCWGG", dcm_total)]
        .into_iter()
        .filter(|&(_, _, total)| total > METHYLATION_SITE_LIST_CAP)
        .map(|(name, motif, total)| {
            format!(
                "{name} site list capped: it lists the first {} of the {} {name} ({motif}) sites in the sequence.",
                crate::format_thousands(METHYLATION_SITE_LIST_CAP),
                crate::format_thousands(total)
            )
        })
        .collect();

    SequenceComposition {
        length: len,
        gc_percent,
        at_percent,
        mw_ss_dna_da,
        mw_ds_dna_da,
        extinction_coeff260,
        melting_temp_basic_c,
        counts: SequenceBaseCounts {
            a: a_cnt,
            t: t_cnt,
            g: g_cnt,
            c: c_cnt,
            n: n_cnt,
        },
        dam_sites,
        dcm_sites,
        warnings,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutateShuffleResult {
    pub mode: String,
    pub original_length_bp: usize,
    pub output_length_bp: usize,
    pub output_sequence: String,
    pub mutations_applied: usize,
    pub gc_original_pct: f64,
    pub gc_output_pct: f64,
    pub dinucleotide_correlation: f64,
}

fn dinucleotide_vector(seq: &[u8]) -> [f64; 16] {
    let mut vec = [0.0f64; 16];
    let idx_of = |b: u8| -> Option<usize> {
        match b {
            b'A' => Some(0),
            b'C' => Some(1),
            b'G' => Some(2),
            b'T' | b'U' => Some(3),
            _ => None,
        }
    };
    for w in seq.windows(2) {
        if let (Some(i), Some(j)) = (idx_of(w[0]), idx_of(w[1])) {
            vec[i * 4 + j] += 1.0;
        }
    }
    vec
}

fn pearson_corr_16(x: &[f64; 16], y: &[f64; 16]) -> f64 {
    let mx = x.iter().sum::<f64>() / 16.0;
    let my = y.iter().sum::<f64>() / 16.0;
    let mut num = 0.0;
    let mut dx2 = 0.0;
    let mut dy2 = 0.0;
    for i in 0..16 {
        let dx = x[i] - mx;
        let dy = y[i] - my;
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    let denom = (dx2 * dy2).sqrt();
    if denom <= 1e-12 {
        1.0
    } else {
        (num / denom).clamp(-1.0, 1.0)
    }
}

/// Altschul-Erickson (1985) Eulerian dinucleotide-preserving sequence shuffle,
/// uniform Fisher-Yates mononucleotide shuffle, or Kimura transition/transversion (Ti/Tv = 2.0) point mutator.
pub fn mutate_or_shuffle_sequence(
    raw_seq: &str,
    mode: &str,
    mutation_rate_pct: f64,
    seed: u64,
) -> MutateShuffleResult {
    let clean = clean_alpha_sequence(raw_seq);
    let orig_bytes = clean.as_bytes();
    let n = orig_bytes.len();
    if n < 4 {
        return MutateShuffleResult {
            mode: mode.to_string(),
            original_length_bp: n,
            output_length_bp: n,
            output_sequence: clean,
            mutations_applied: 0,
            gc_original_pct: 0.0,
            gc_output_pct: 0.0,
            dinucleotide_correlation: 1.0,
        };
    }

    let mut rng = SplitMix64::new(seed);
    let is_rna = orig_bytes.contains(&b'U') && !orig_bytes.contains(&b'T');
    let t_or_u = if is_rna { b'U' } else { b'T' };

    let out_bytes: Vec<u8> = match mode {
        "shuffle-mononucleotide" => {
            let mut arr = orig_bytes.to_vec();
            for i in (1..n).rev() {
                let j = rng.next_usize(i + 1);
                arr.swap(i, j);
            }
            arr
        }
        "point-mutate" => {
            let rate = (mutation_rate_pct / 100.0).clamp(0.001, 0.75);
            let mut arr = orig_bytes.to_vec();
            for b in &mut arr {
                if rng.next_f64() < rate {
                    // Kimura 2-parameter bias: ~67% transitions (A<->G, C<->T), ~33% transversions
                    let r = rng.next_f64();
                    *b = match *b {
                        b'A' => {
                            if r < 0.67 {
                                b'G'
                            } else if r < 0.835 {
                                b'C'
                            } else {
                                t_or_u
                            }
                        }
                        b'G' => {
                            if r < 0.67 {
                                b'A'
                            } else if r < 0.835 {
                                b'C'
                            } else {
                                t_or_u
                            }
                        }
                        b'C' => {
                            if r < 0.67 {
                                t_or_u
                            } else if r < 0.835 {
                                b'A'
                            } else {
                                b'G'
                            }
                        }
                        _ => {
                            if r < 0.67 {
                                b'C'
                            } else if r < 0.835 {
                                b'A'
                            } else {
                                b'G'
                            }
                        }
                    };
                }
            }
            arr
        }
        _ => {
            // Altschul-Erickson Eulerian graph dinucleotide-preserving shuffle:
            // Build outgoing edge lists for A(0), C(1), G(2), T/U(3), fix a random arborescence
            // directed toward the final vertex `last`, shuffle remaining outgoing edges, and traverse Eulerian trail.
            let base_to_idx = |b: u8| -> usize {
                match b {
                    b'A' => 0,
                    b'C' => 1,
                    b'G' => 2,
                    _ => 3,
                }
            };
            let idx_to_base = [b'A', b'C', b'G', t_or_u];
            let mut edges: [Vec<usize>; 4] = [Vec::new(), Vec::new(), Vec::new(), Vec::new()];
            for w in orig_bytes.windows(2) {
                edges[base_to_idx(w[0])].push(base_to_idx(w[1]));
            }
            let last_v = base_to_idx(orig_bytes[n - 1]);

            // Shuffle each vertex's outgoing adjacency list via Fisher-Yates, keeping a valid last-exit spanning tree
            for v in 0..4 {
                let len = edges[v].len();
                for i in (1..len).rev() {
                    let j = rng.next_usize(i + 1);
                    edges[v].swap(i, j);
                }
            }

            // Ensure last outgoing edge from non-last vertices forms a directed tree rooted at `last_v`
            let mut connected = [false; 4];
            connected[last_v] = true;
            let mut last_edge: [Option<usize>; 4] = [None; 4];
            for _pass in 0..8 {
                for v in 0..4 {
                    if connected[v] || edges[v].is_empty() {
                        continue;
                    }
                    if let Some(pos) = edges[v].iter().position(|&u| connected[u]) {
                        let target = edges[v][pos];
                        let last_idx = edges[v].len() - 1;
                        edges[v].swap(pos, last_idx);
                        last_edge[v] = Some(target);
                        connected[v] = true;
                    }
                }
            }
            // Shuffle all non-tree edges [0..len-1] while preserving the spanning-tree final edge at len-1
            for v in 0..4 {
                if last_edge[v].is_some() && edges[v].len() > 2 {
                    let non_tree_len = edges[v].len() - 1;
                    for i in (1..non_tree_len).rev() {
                        let j = rng.next_usize(i + 1);
                        edges[v].swap(i, j);
                    }
                }
            }

            let mut cursor = [0usize; 4];
            let mut cur = base_to_idx(orig_bytes[0]);
            let mut trail = Vec::with_capacity(n);
            trail.push(idx_to_base[cur]);
            for _ in 0..(n - 1) {
                if cursor[cur] < edges[cur].len() {
                    let nxt = edges[cur][cursor[cur]];
                    cursor[cur] += 1;
                    cur = nxt;
                    trail.push(idx_to_base[cur]);
                } else {
                    break;
                }
            }
            if trail.len() == n {
                trail
            } else {
                // Fallback if non-canonical N bases disconnected Eulerian trail
                let mut arr = orig_bytes.to_vec();
                for i in (1..n).rev() {
                    let j = rng.next_usize(i + 1);
                    arr.swap(i, j);
                }
                arr
            }
        }
    };

    let mut changed = 0usize;
    for i in 0..n {
        if orig_bytes[i] != out_bytes[i] {
            changed += 1;
        }
    }

    let orig_gc = compute_sequence_stats_fast(&clean).gc_percent;
    let out_str = String::from_utf8_lossy(&out_bytes).into_owned();
    let out_gc = compute_sequence_stats_fast(&out_str).gc_percent;
    let corr = pearson_corr_16(&dinucleotide_vector(orig_bytes), &dinucleotide_vector(&out_bytes));

    let out_len = out_str.len();
    MutateShuffleResult {
        mode: mode.to_string(),
        original_length_bp: n,
        output_length_bp: out_len,
        output_sequence: out_str,
        mutations_applied: changed,
        gc_original_pct: (orig_gc * 100.0).round() / 100.0,
        gc_output_pct: (out_gc * 100.0).round() / 100.0,
        dinucleotide_correlation: (corr * 10000.0).round() / 10000.0,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// GATTACA, AGGGAGGA and C are masses printed by Biopython 1.88 `molecular_weight(seq, "DNA",
    /// double_stranded=False|True)` (2026-11-07). The A/G-rich 8-mer has a strand unlike its
    /// complement, so twice the strand is not the duplex. The other three are not Biopython output:
    /// `molecular_weight` refuses N and U in DNA. ACGTN is weighed by the same formula with
    /// Biopython's `avg_ambiguous_dna_weights` (N 326.96215). gauuaca and the empty sequence are
    /// the engine's own conventions: it reads U as T (and any case), so gauuaca weighs as GATTACA;
    /// and it weighs no bases as 0, where Biopython's formula gives one water per strand, 18.0153
    /// and 36.0306.
    #[test]
    fn composition_masses_are_biopythons() {
        let cases: [(&str, f64, f64); 6] = [
            ("GATTACA", 2184.4089, 4359.8045),
            ("gauuaca", 2184.4089, 4359.8045), // the engine's convention: U read as T
            ("AGGGAGGA", 2603.6643, 4980.1682),
            ("C", 307.1971, 654.4183),
            ("ACGTN", 1562.74955, 3125.4991), // Biopython's avg_ambiguous_dna_weights
            ("", 0.0, 0.0), // the engine's convention: no bases weigh 0
        ];
        for (seq, ss, ds) in cases {
            let comp = analyze_sequence_composition(seq);
            assert!((comp.mw_ss_dna_da - ss).abs() < 1e-6, "{seq}: ssDNA {} vs Biopython {ss}", comp.mw_ss_dna_da);
            assert!((comp.mw_ds_dna_da - ds).abs() < 1e-6, "{seq}: dsDNA {} vs Biopython {ds}", comp.mw_ds_dna_da);
            let stats = compute_sequence_stats_fast(seq);
            assert_eq!((stats.mw_ssdna_da, stats.mw_dsdna_da), (comp.mw_ss_dna_da, comp.mw_ds_dna_da), "{seq}: one convention");
        }
    }

    /// BG-01M6S17Y: the Dam and Dcm site lists stop at 4,096 sites each, for a bounded reply, and the
    /// reply said nothing of it, so an API caller read the length of a full list as the count. A cut
    /// list now comes with a warning giving the whole count, and a list of 4,096 sites or fewer with
    /// none. Every count and position here is found by scanning the sequence as the engine reads it
    /// (letters only, any case, U as T), never read from the cap. Wrong implementations, and the case
    /// that catches each: a count that stops at the cap (5,000 and 6,123 sites); a warning from 4,096
    /// sites on (the 4,096 pair); one warning for both lists, or the counts swapped (Dam cut alone, Dcm
    /// cut alone, and two different totals); sites counted in the raw text (lower-case GAUC sites,
    /// line breaks between blocks); the list no longer the first 4,096 sites (its positions).
    #[test]
    fn dam_dcm_cap_is_reported() {
        // `dam` GATC blocks, every third written gauc as RNA in lower case, then `dcm` CCWGG blocks,
        // one block a line
        let build = |dam: usize, dcm: usize| -> String {
            let blocks = (0..dam).map(|i| if i % 3 == 0 { "gaucaaaa" } else { "GATCAAAA" });
            let blocks = blocks.chain((0..dcm).map(|i| if i % 2 == 0 { "CCAGGTTT" } else { "cctggttt" }));
            blocks.collect::<Vec<_>>().join("\n")
        };
        let read: fn(&str) -> Vec<u8> = |raw| {
            raw.bytes().filter(u8::is_ascii_alphabetic).map(|b| match b.to_ascii_uppercase() { b'U' => b'T', u => u }).collect()
        };
        let sites = |raw: &str, pats: &[&[u8]]| -> Vec<usize> {
            let s = read(raw);
            let n = pats[0].len();
            (0..s.len().saturating_sub(n - 1)).filter(|&i| pats.contains(&&s[i..i + n])).map(|i| i + 1).collect()
        };
        let grouped = |n: usize| {
            let d = n.to_string();
            d.chars().enumerate().fold(String::new(), |mut o, (i, c)| {
                if i > 0 && (d.len() - i) % 3 == 0 {
                    o.push(',');
                }
                o.push(c);
                o
            })
        };
        let dam_warning = |n: usize| format!("Dam site list capped: it lists the first 4,096 of the {} Dam (GATC) sites in the sequence.", grouped(n));
        let dcm_warning = |n: usize| format!("Dcm site list capped: it lists the first 4,096 of the {} Dcm (CCWGG) sites in the sequence.", grouped(n));

        for (dam, dcm) in [(4_096, 4_096), (4_097, 4_096), (10, 4_097), (5_000, 6_123), (0, 0)] {
            let raw = build(dam, dcm);
            let dam_at = sites(&raw, &[b"GATC"]);
            let dcm_at = sites(&raw, &[b"CCAGG", b"CCTGG"]);
            assert_eq!((dam_at.len(), dcm_at.len()), (dam, dcm), "fixture: {dam} GATC and {dcm} CCWGG sites");
            let comp = analyze_sequence_composition(&raw);
            assert_eq!(comp.dam_sites, dam_at[..dam.min(4_096)], "{dam}/{dcm}: the Dam list is the first 4,096 sites");
            assert_eq!(comp.dcm_sites, dcm_at[..dcm.min(4_096)], "{dam}/{dcm}: the Dcm list is the first 4,096 sites");
            let mut expected = Vec::new();
            if dam_at.len() > 4_096 {
                expected.push(dam_warning(dam_at.len()));
            }
            if dcm_at.len() > 4_096 {
                expected.push(dcm_warning(dcm_at.len()));
            }
            assert_eq!(comp.warnings, expected, "{dam} Dam / {dcm} Dcm sites");
            let json = serde_json::to_value(&comp).unwrap();
            assert_eq!(json["warnings"], serde_json::json!(expected), "{dam}/{dcm}: the reply carries `warnings`, empty when nothing was cut");
        }
    }
}
