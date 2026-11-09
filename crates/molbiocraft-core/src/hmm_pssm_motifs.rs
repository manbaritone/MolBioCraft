// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Probabilistic Genome Compositional Segmentation via `bio::stats::hmm` (Discrete-Emission
//! Viterbi Hidden Markov Model), Position-Specific Scoring Matrix (`bio::pattern_matching::pssm::DNAMotif`)
//! Transcription Factor Motif Scanner, and `triple_accel` SIMD Levenshtein/Hamming Fuzzy Subsequence Search.

use crate::iupac::{clean_sequence, reverse_complement_iupac};
use bio::pattern_matching::pssm::{DNAMotif, Motif};
use bio::stats::hmm::discrete_emission::Model as DiscreteEmissionHMM;
use bio::stats::hmm::viterbi;
use ndarray::array;
use serde::{Deserialize, Serialize};
use triple_accel::levenshtein::{levenshtein_search_simd_with_opts, LEVENSHTEIN_COSTS};
use triple_accel::{hamming, SearchType};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HmmStateSegment {
    pub state_index: usize,
    pub state_label: String,
    pub start: usize,
    pub end: usize,
    pub length_bp: usize,
    pub gc_percent: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HmmGenomeSegmentationReport {
    /// The length of the sequence given, in bases after cleaning.
    pub sequence_length_bp: usize,
    /// How many bases were segmented, from base 1: the whole sequence, or its first
    /// [`HMM_SEGMENTATION_MAX_BP`]. The fractions and the segments describe these bases only.
    pub scanned_length_bp: usize,
    pub viterbi_log_prob: f64,
    pub at_rich_fraction_pct: f64,
    pub balanced_coding_fraction_pct: f64,
    pub gc_island_fraction_pct: f64,
    pub segments: Vec<HmmStateSegment>,
    /// What the segmentation left out of its input, one plain sentence per event (D0005): the
    /// cap stopping it short of the end. Always serialised, as an empty list when nothing was cut.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most bases [`segment_genome_hmm_viterbi`] segments, from base 1: 12 Mb, past the length of
/// most bacterial genomes, so such a genome is segmented whole. Measured on a 5 Mb genome: 0.11 s
/// native and 0.27 s in the WASM engine; at the cap, 0.7 to 0.9 s in the WASM engine.
pub const HMM_SEGMENTATION_MAX_BP: usize = 12_000_000;

fn state_label_for(idx: usize) -> &'static str {
    match idx {
        0 => "AT-Rich Intergenic / Promoter",
        1 => "Balanced Coding / Backbone",
        _ => "GC-Rich CpG / Regulatory Island",
    }
}

/// Runs a 3-state Discrete-Emission Hidden Markov Model (`bio::stats::hmm::discrete_emission::Model`
/// + `viterbi`) over `{A=0, C=1, G=2, T=3}` to partition a nucleotide sequence or whole chromosome
/// into AT-rich promoter/intergenic tracts, balanced coding regions, and GC-rich regulatory/CpG islands.
/// Segments the whole sequence up to [`HMM_SEGMENTATION_MAX_BP`] bases; past that it segments the
/// first [`HMM_SEGMENTATION_MAX_BP`] and a warning names the bases it covered.
pub fn segment_genome_hmm_viterbi(raw_seq: &str) -> HmmGenomeSegmentationReport {
    segment_genome_hmm_viterbi_within(raw_seq, HMM_SEGMENTATION_MAX_BP)
}

/// [`segment_genome_hmm_viterbi`] with the cap given, so the capped path can be tested on a short
/// sequence.
fn segment_genome_hmm_viterbi_within(raw_seq: &str, max_bp: usize) -> HmmGenomeSegmentationReport {
    let seq = clean_sequence(raw_seq);
    let whole = seq.len();
    let n = whole.min(max_bp);
    let mut warnings = Vec::new();
    if n < whole {
        let (scanned, total) = (crate::format_thousands(n), crate::format_thousands(whole));
        warnings.push(format!(
            "HMM segmentation covered only the first {scanned} bp of the {total}-bp sequence; the state fractions and segments describe bases 1-{scanned} only."
        ));
    }
    if n == 0 {
        return HmmGenomeSegmentationReport {
            sequence_length_bp: whole,
            scanned_length_bp: 0,
            viterbi_log_prob: 0.0,
            at_rich_fraction_pct: 0.0,
            balanced_coding_fraction_pct: 0.0,
            gc_island_fraction_pct: 0.0,
            segments: Vec::new(),
            warnings,
        };
    }

    // 3 hidden states:
    // 0: AT-rich (A=0.35, C=0.15, G=0.15, T=0.35)
    // 1: Balanced coding (A=0.25, C=0.25, G=0.25, T=0.25)
    // 2: GC-rich island (A=0.14, C=0.36, G=0.36, T=0.14)
    let transition = array![
        [0.985, 0.010, 0.005],
        [0.0075, 0.985, 0.0075],
        [0.005, 0.010, 0.985]
    ];
    let observation = array![
        [0.35, 0.15, 0.15, 0.35],
        [0.25, 0.25, 0.25, 0.25],
        [0.14, 0.36, 0.36, 0.14]
    ];
    let initial = array![0.30, 0.45, 0.25];

    let hmm = DiscreteEmissionHMM::with_float(&transition, &observation, &initial)
        .expect("Valid 3-state discrete emission HMM matrix dimensions");

    let bytes = &seq.as_bytes()[..n];
    let observe = |idx: usize, b: u8| -> usize {
        match b {
            b'A' => 0,
            b'C' => 1,
            b'G' => 2,
            b'T' | b'U' => 3,
            // Deterministic resolution for IUPAC degenerate calls
            b'S' => 1 + (idx & 1),
            b'W' => if idx & 1 == 0 { 0 } else { 3 },
            _ => idx & 3,
        }
    };

    // Chunked Viterbi execution (32 kbp blocks): the observations are built one block at a time
    // and the state path is kept one byte a base, so a multi-megabase genome needs little memory.
    let block_size = 32_768usize;
    let mut full_states: Vec<u8> = Vec::with_capacity(n);
    let mut total_log_prob = 0.0_f64;
    let mut obs: Vec<usize> = Vec::with_capacity(block_size.min(n));

    for (block, chunk) in bytes.chunks(block_size).enumerate() {
        obs.clear();
        let base = block * block_size;
        obs.extend(chunk.iter().enumerate().map(|(off, &b)| observe(base + off, b)));
        let (path, lp) = viterbi(&hmm, &obs);
        total_log_prob += *lp;
        full_states.extend(path.into_iter().map(|st| st.0.min(2) as u8));
    }

    let mut counts = [0usize; 3];
    for &st in &full_states {
        counts[st as usize] += 1;
    }

    // Run-length compress state path into contiguous genomic segments with exact local GC%
    let mut segments = Vec::new();
    let mut seg_start = 0usize;
    let mut cur_state = full_states[0];

    for idx in 1..=n {
        if idx == n || full_states[idx] != cur_state {
            let seg_len = idx - seg_start;
            let gc_cnt = bytes[seg_start..idx]
                .iter()
                .filter(|&&b| b == b'G' || b == b'C' || b == b'S')
                .count();
            let gc_pct = ((gc_cnt as f64 / seg_len.max(1) as f64) * 1000.0).round() / 10.0;
            segments.push(HmmStateSegment {
                state_index: cur_state as usize,
                state_label: state_label_for(cur_state as usize).to_string(),
                start: seg_start + 1,
                end: idx,
                length_bp: seg_len,
                gc_percent: gc_pct,
            });
            if idx < n {
                seg_start = idx;
                cur_state = full_states[idx];
            }
        }
    }

    let round1 = |v: f64| (v * 10.0).round() / 10.0;
    HmmGenomeSegmentationReport {
        sequence_length_bp: whole,
        scanned_length_bp: n,
        viterbi_log_prob: (total_log_prob * 100.0).round() / 100.0,
        at_rich_fraction_pct: round1((counts[0] as f64 / n as f64) * 100.0),
        balanced_coding_fraction_pct: round1((counts[1] as f64 / n as f64) * 100.0),
        gc_island_fraction_pct: round1((counts[2] as f64 / n as f64) * 100.0),
        segments,
        warnings,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PssmProfileSummary {
    pub matrix_id: String,
    pub tf_name: String,
    pub family: String,
    pub length_bp: usize,
    pub degenerate_consensus: String,
    pub information_content_bits: f64,
    pub hit_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PssmMotifHit {
    pub matrix_id: String,
    pub tf_name: String,
    pub family: String,
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    pub matched_seq: String,
    pub relative_score: f64,
    pub log_odds_bits: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PssmMotifScanReport {
    pub motifs_evaluated: usize,
    pub threshold_rel_score: f64,
    /// Every hit at or above the threshold, on both strands of the scanned bases, across every
    /// matrix: the sum of the profiles' `hit_count`.
    pub total_hits: usize,
    pub profiles: Vec<PssmProfileSummary>,
    /// The best-scoring hits across every matrix, at most [`PSSM_HITS_LISTED`]: highest
    /// `relative_score` (to 3 places, as given) first, then the earlier start, then the matrix's
    /// place in the catalogue, then `+` before `-`.
    pub hits: Vec<PssmMotifHit>,
    /// The length of the sequence given, in bases after cleaning.
    pub sequence_length_bp: usize,
    /// How many bases were scanned, from base 1, on both strands: the whole sequence, or its
    /// first [`PSSM_SCAN_MAX_BP`].
    pub scanned_length_bp: usize,
    /// What the scan left out of its input or its list, one plain sentence per event (D0005):
    /// the cap stopping it short of the end, and the list holding fewer hits than were found.
    /// Always serialised, as an empty list when nothing was left out.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most bases [`scan_jaspar_pssm_motifs`] scans, from base 1, on both strands: 12 Mb, past the
/// length of most bacterial genomes, so such a genome is scanned whole. Measured on a 5 Mb genome:
/// 0.24 s native and 0.27 s in the WASM engine; at the cap, about 0.9 s in the WASM engine.
pub const PSSM_SCAN_MAX_BP: usize = 12_000_000;

/// The most hits a TF motif scan lists: the best-scoring of every hit it found.
pub const PSSM_HITS_LISTED: usize = 250;

/// What a TF motif scan's result left out, one sentence per event (D0005): the scan stopping at
/// `scanned_bp` of a `sequence_bp`-base sequence, and a list of `listed` best-scoring hits of the
/// `found` counted. [`scan_jaspar_pssm_motifs`] says it of its own list; a caller that lists fewer
/// of the scan's hits (the workflow macro's top hits) says it of that list.
pub fn pssm_scan_warnings(scanned_bp: usize, sequence_bp: usize, listed: usize, found: usize) -> Vec<String> {
    let mut warnings = Vec::new();
    if scanned_bp < sequence_bp {
        let (scanned, whole) = (crate::format_thousands(scanned_bp), crate::format_thousands(sequence_bp));
        warnings.push(format!(
            "TF motif scan covered only the first {scanned} bp of the {whole}-bp sequence, on both strands; sites past base {scanned} are not reported."
        ));
    }
    if found > listed {
        let (listed, found) = (crate::format_thousands(listed), crate::format_thousands(found));
        warnings.push(format!("TF motif hit list capped: it lists the {listed} best-scoring of the {found} hits found."));
    }
    warnings
}

struct CuratedJasparSeed {
    matrix_id: &'static str,
    tf_name: &'static str,
    family: &'static str,
    aligned_sites: &'static [&'static [u8]],
}

const CURATED_JASPAR_SEEDS: &[CuratedJasparSeed] = &[
    CuratedJasparSeed {
        matrix_id: "MA0108.2",
        tf_name: "TBP (TATA-Box)",
        family: "TATA-Binding Core Promoter",
        aligned_sites: &[
            b"TATAAAAG",
            b"TATAAATG",
            b"TATATAAA",
            b"TATATAAG",
            b"TATAAAAC",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0079.5",
        tf_name: "SP1 (GC-Box)",
        family: "C2H2 Zinc Finger",
        aligned_sites: &[
            b"GGGGCGGGG",
            b"GGGGCGGAG",
            b"TGGGCGGGG",
            b"GGGGCGGGC",
            b"AGGGCGGGG",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0139.1",
        tf_name: "CTCF",
        family: "Chromatin Insulator C2H2 ZF",
        aligned_sites: &[
            b"CCACCAGGGGGCGC",
            b"CCACCAGGGGGCGG",
            b"CCACTAGGGGGCGC",
            b"CCAGCAGGGGGCGC",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0018.4",
        tf_name: "CREB1 (CRE)",
        family: "bZIP cAMP Response",
        aligned_sites: &[
            b"TGACGTCA",
            b"TGACGTMA",
            b"TGACGTCA",
            b"TGACGTAA",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0099.3",
        tf_name: "FOS::JUN (AP-1)",
        family: "bZIP Enhancer",
        aligned_sites: &[
            b"TGAGTCA",
            b"TGACTCA",
            b"TGAGTCA",
            b"TGACTCA",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0105.4",
        tf_name: "NFKB1",
        family: "Rel Homology Domain",
        aligned_sites: &[
            b"GGGAATTTCC",
            b"GGGACTTTCC",
            b"GGGAATTTCC",
            b"GGGAAATTCC",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0106.3",
        tf_name: "TP53",
        family: "p53 Tumor Suppressor",
        aligned_sites: &[
            b"RRRCATGYYY",
            b"GAACATGTCC",
            b"AGACATGCCT",
            b"GGGCATGTCC",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "MA0148.4",
        tf_name: "FOXA1",
        family: "Forkhead Pioneer Factor",
        aligned_sites: &[
            b"TGTTTACTTA",
            b"TGTTTACATA",
            b"TGTTTACTAA",
            b"TGTTTACTTA",
        ],
    },
    CuratedJasparSeed {
        matrix_id: "PROK_LAC",
        tf_name: "LacI Operator (lacO)",
        family: "Bacterial GalR/LacI Repressor",
        aligned_sites: &[
            b"AATTGTGAGCGGATAACAATT",
            b"AATTGTGAGCGCTCACAATT0".split_at(20).0, // replaced below dynamically via uniform lengths
        ],
    },
];

fn build_curated_pssm_catalog() -> Vec<(&'static str, &'static str, &'static str, DNAMotif)> {
    let mut out = Vec::with_capacity(10);
    for seed in CURATED_JASPAR_SEEDS {
        if seed.matrix_id == "PROK_LAC" {
            continue;
        }
        let vecs: Vec<Vec<u8>> = seed.aligned_sites.iter().map(|s| s.to_vec()).collect();
        if let Ok(motif) = DNAMotif::from_seqs(&vecs, None) {
            out.push((seed.matrix_id, seed.tf_name, seed.family, motif));
        }
    }

    // Add bacterial LacI operator & T7 RNA Polymerase promoter PSSMs with uniform site widths
    let laco_sites = vec![
        b"AATTGTGAGCGATAACAATT".to_vec(),
        b"AATTGTGAGCGCTCACAATT".to_vec(),
        b"AAATGTGAGCGAGTAACAAC".to_vec(),
    ];
    if let Ok(m) = DNAMotif::from_seqs(&laco_sites, None) {
        out.push((
            "PROK_LACO",
            "LacI Operator (lacO)",
            "Bacterial Repressor Operator",
            m,
        ));
    }

    let t7_sites = vec![
        b"TAATACGACTCACTATAGGG".to_vec(),
        b"TAATACGACTCACTATAGGA".to_vec(),
        b"TAATACGACTCACTATAGGC".to_vec(),
    ];
    if let Ok(m) = DNAMotif::from_seqs(&t7_sites, None) {
        out.push((
            "PHAGE_T7P",
            "T7 RNA Pol Promoter",
            "Bacteriophage T7 Promoter",
            m,
        ));
    }

    out
}

/// A hit kept for the list while the scan runs, before its strings are built: its relative score
/// in thousandths (the `relative_score` the report gives, 0.918 as 918), its 1-based genomic
/// start, the matrix's place in the catalogue, its strand and the window's 0-based offset on the
/// strand it was read from. Ordered from the best to list to the worst: higher score as reported,
/// then earlier start, then earlier matrix, then `+` before `-`, so hits the list shows with the
/// same score stand in coordinate order.
#[derive(Clone, Copy)]
struct RankedPssmHit {
    score_milli: i64,
    start: usize,
    matrix: usize,
    strand: i8,
    offset: usize,
}

impl RankedPssmHit {
    fn rank(&self, other: &Self) -> std::cmp::Ordering {
        other
            .score_milli
            .cmp(&self.score_milli)
            .then(self.start.cmp(&other.start))
            .then(self.matrix.cmp(&other.matrix))
            .then(other.strand.cmp(&self.strand))
    }
}

impl PartialEq for RankedPssmHit {
    fn eq(&self, other: &Self) -> bool {
        self.rank(other).is_eq()
    }
}
impl Eq for RankedPssmHit {}
impl PartialOrd for RankedPssmHit {
    fn partial_cmp(&self, other: &Self) -> Option<std::cmp::Ordering> {
        Some(self.cmp(other))
    }
}
/// Greater is worse, so a max-heap of these holds its worst hit on top, ready to be dropped.
impl Ord for RankedPssmHit {
    fn cmp(&self, other: &Self) -> std::cmp::Ordering {
        self.rank(other)
    }
}

/// Scans both strands of a nucleotide sequence against 10 curated JASPAR & prokaryotic
/// Position-Specific Scoring Matrices (`bio::pattern_matching::pssm::DNAMotif`), computing
/// relative min-max PWM scores, Shannon information content (bits), and log-odds bit scores.
/// Scans the whole sequence up to [`PSSM_SCAN_MAX_BP`] bases (past that, the first
/// [`PSSM_SCAN_MAX_BP`], and a warning names them); every hit is counted, and the list keeps the
/// [`PSSM_HITS_LISTED`] best-scoring across every matrix, each at its own coordinates on the
/// forward strand, whichever strand it was read from.
pub fn scan_jaspar_pssm_motifs(
    raw_seq: &str,
    min_rel_score: f64,
    custom_aligned_sites: Option<&[String]>,
) -> PssmMotifScanReport {
    scan_jaspar_pssm_motifs_within(raw_seq, min_rel_score, custom_aligned_sites, PSSM_SCAN_MAX_BP)
}

/// [`scan_jaspar_pssm_motifs`] with the scan cap given, so the capped path can be tested on a
/// short sequence.
fn scan_jaspar_pssm_motifs_within(
    raw_seq: &str,
    min_rel_score: f64,
    custom_aligned_sites: Option<&[String]>,
    max_scan_bp: usize,
) -> PssmMotifScanReport {
    let clean = clean_sequence(raw_seq);
    // Sanitize non-ATGC bases to uniform A/T/G/C for `DNAMotif::lookup` while preserving coordinates
    let sanitize_atgc = |s: &str| -> Vec<u8> {
        s.bytes()
            .enumerate()
            .map(|(i, b)| match b {
                b'A' | b'T' | b'G' | b'C' => b,
                b'U' => b'T',
                _ => [b'A', b'C', b'G', b'T'][i & 3],
            })
            .collect()
    };

    let threshold = min_rel_score.clamp(0.60, 0.99);
    let mut catalog: Vec<(String, String, String, DNAMotif)> = build_curated_pssm_catalog()
        .into_iter()
        .map(|(id, nm, fam, m)| (id.to_string(), nm.to_string(), fam.to_string(), m))
        .collect();

    if let Some(custom) = custom_aligned_sites {
        let cleaned_custom: Vec<Vec<u8>> = custom
            .iter()
            .map(|s| clean_sequence(s).into_bytes())
            .filter(|v| !v.is_empty())
            .collect();
        if let Some(first_len) = cleaned_custom.first().map(|v| v.len()) {
            let uniform: Vec<Vec<u8>> = cleaned_custom
                .into_iter()
                .filter(|v| v.len() == first_len)
                .collect();
            if !uniform.is_empty() {
                if let Ok(custom_motif) = DNAMotif::from_seqs(&uniform, None) {
                    catalog.insert(
                        0,
                        (
                            "CUSTOM_PWM".to_string(),
                            "Custom User Motif".to_string(),
                            "User-Trained PSSM".to_string(),
                            custom_motif,
                        ),
                    );
                }
            }
        }
    }

    // The scanned bases are the first `scan_len` of the sanitised sequence, and the reverse strand
    // is the reverse complement of exactly those bases, built from the sanitised forward bytes so
    // both have the same length (reverse_complement_iupac() drops symbols such as '*'). A window
    // of length m at offset `s` on the reverse strand is therefore forward bases
    // `scan_len - s - m + 1 ..= scan_len - s`, however long the sequence runs past the scan.
    let mut fwd_bytes = sanitize_atgc(&clean);
    let n = fwd_bytes.len();
    let scan_len = n.min(max_scan_bp);
    fwd_bytes.truncate(scan_len);
    let rev_bytes: Vec<u8> = fwd_bytes
        .iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'T' => b'A',
            b'G' => b'C',
            b'C' => b'G',
            other => other,
        })
        .collect();
    // `DNAMotif` column order: A, T, G, C
    let column_of = |b: u8| -> u8 {
        match b {
            b'A' => 0,
            b'T' => 1,
            b'G' => 2,
            _ => 3,
        }
    };
    let fwd_cols: Vec<u8> = fwd_bytes.iter().map(|&b| column_of(b)).collect();
    let rev_cols: Vec<u8> = rev_bytes.iter().map(|&b| column_of(b)).collect();

    // Each matrix as the scan scores it: its per-column probabilities (floored at 1e-4) and
    // log-odds, and what it takes for a window to reach the threshold.
    struct ScoringMatrix {
        m_len: usize,
        min_sc: f64,
        denom: f64,
        probs: Vec<[f64; 4]>,
        log_odds: Vec<[f64; 4]>,
        /// `best_rest[i]`: the most columns `i..` can add. A window whose sum so far cannot reach
        /// the threshold even with the best base in every remaining column is no hit, and is
        /// dropped without reading the rest of it; a window that survives is summed in the same
        /// order and tested exactly as an unpruned scan would test it.
        best_rest: Vec<f64>,
        /// The sum a window must still be able to reach, less a slack that keeps rounding from
        /// dropping a true hit.
        reach: f64,
        /// How many leading columns `lead_sums` covers: `LEAD` or the whole matrix if shorter.
        lead: usize,
        /// The sum over the leading columns for every `lead`-mer (first base in the high bits),
        /// added in column order, so it is the very value the column-by-column sum reaches.
        lead_sums: Vec<f64>,
    }
    const LEAD: usize = 6;
    let scoring: Vec<ScoringMatrix> = catalog
        .iter()
        .map(|(_, _, _, motif)| {
            let m_len = motif.len();
            let min_sc = f64::from(motif.get_min_score());
            let max_sc = f64::from(motif.get_max_score());
            let denom = (max_sc - min_sc).max(1e-6);
            let scores = motif.get_scores();
            let probs: Vec<[f64; 4]> = (0..m_len)
                .map(|i| [0, 1, 2, 3].map(|b| f64::from(scores[[i, b]]).max(1e-4)))
                .collect();
            let log_odds: Vec<[f64; 4]> = probs.iter().map(|row| row.map(|p| (p / 0.25).log2())).collect();
            let mut best_rest = vec![0.0_f64; m_len + 1];
            for i in (0..m_len).rev() {
                best_rest[i] = best_rest[i + 1] + probs[i].iter().copied().fold(f64::MIN, f64::max);
            }
            let lead = LEAD.min(m_len);
            let lead_sums: Vec<f64> = (0..1usize << (2 * lead))
                .map(|code| {
                    (0..lead).fold(0.0_f64, |sum, i| sum + probs[i][(code >> (2 * (lead - 1 - i))) & 3])
                })
                .collect();
            ScoringMatrix {
                m_len,
                min_sc,
                denom,
                reach: threshold * denom + min_sc - 1e-9,
                probs,
                log_odds,
                best_rest,
                lead,
                lead_sums,
            }
        })
        .collect();

    // The PSSM_HITS_LISTED best hits so far, the worst on top.
    let mut best: std::collections::BinaryHeap<RankedPssmHit> =
        std::collections::BinaryHeap::with_capacity(PSSM_HITS_LISTED + 1);
    let mut hit_counts = vec![0usize; catalog.len()];
    let lead_mask = (1usize << (2 * LEAD)) - 1;
    for (strand, cols) in [(1i8, &fwd_cols), (-1i8, &rev_cols)] {
        // The 2-bit code of the LEAD bases from each offset, the first base in the high bits; past
        // the end of the strand it reads A, which only a matrix shorter than LEAD could reach, and
        // such a matrix reads only its own leading bases.
        let mut code = 0usize;
        for i in 0..LEAD {
            code = (code << 2) | usize::from(cols.get(i).copied().unwrap_or(0));
        }
        for offset in 0..scan_len {
            for (matrix_idx, sm) in scoring.iter().enumerate() {
                let m_len = sm.m_len;
                if m_len == 0 || offset + m_len > scan_len {
                    continue;
                }
                let mut raw_sum = sm.lead_sums[code >> (2 * (LEAD - sm.lead))];
                if raw_sum + sm.best_rest[sm.lead] < sm.reach {
                    continue;
                }
                let mut alive = true;
                for i in sm.lead..m_len {
                    raw_sum += sm.probs[i][usize::from(cols[offset + i])];
                    if raw_sum + sm.best_rest[i + 1] < sm.reach {
                        alive = false;
                        break;
                    }
                }
                if !alive {
                    continue;
                }
                let rel = (raw_sum - sm.min_sc) / sm.denom;
                if rel >= threshold {
                    hit_counts[matrix_idx] += 1;
                    let start = if strand == 1 { offset + 1 } else { scan_len - offset - m_len + 1 };
                    let score_milli = (rel * 1000.0).round() as i64;
                    let hit = RankedPssmHit { score_milli, start, matrix: matrix_idx, strand, offset };
                    if best.len() < PSSM_HITS_LISTED {
                        best.push(hit);
                    } else if best.peek().is_some_and(|worst| hit < *worst) {
                        best.pop();
                        best.push(hit);
                    }
                }
            }
            code = ((code << 2) | usize::from(cols.get(offset + LEAD).copied().unwrap_or(0))) & lead_mask;
        }
    }

    let profiles: Vec<PssmProfileSummary> = catalog
        .iter()
        .zip(&scoring)
        .zip(&hit_counts)
        .map(|(((matrix_id, tf_name, family, motif), sm), &hit_count)| PssmProfileSummary {
            matrix_id: matrix_id.clone(),
            tf_name: tf_name.clone(),
            family: family.clone(),
            length_bp: sm.m_len,
            degenerate_consensus: String::from_utf8_lossy(&motif.degenerate_consensus()).into_owned(),
            information_content_bits: (f64::from(motif.info_content()) * 100.0).round() / 100.0,
            hit_count,
        })
        .collect();

    let hits: Vec<PssmMotifHit> = best
        .into_sorted_vec()
        .into_iter()
        .map(|h| {
            let (matrix_id, tf_name, family, _) = &catalog[h.matrix];
            let (m_len, log_odds) = (scoring[h.matrix].m_len, &scoring[h.matrix].log_odds);
            let (bytes, cols) = if h.strand == 1 { (&fwd_bytes, &fwd_cols) } else { (&rev_bytes, &rev_cols) };
            let bits = cols[h.offset..h.offset + m_len]
                .iter()
                .enumerate()
                .fold(0.0_f64, |acc, (i, &c)| acc + log_odds[i][c as usize]);
            PssmMotifHit {
                matrix_id: matrix_id.clone(),
                tf_name: tf_name.clone(),
                family: family.clone(),
                start: h.start,
                end: h.start + m_len - 1,
                strand: h.strand,
                matched_seq: String::from_utf8_lossy(&bytes[h.offset..h.offset + m_len]).into_owned(),
                relative_score: h.score_milli as f64 / 1000.0,
                log_odds_bits: (bits * 100.0).round() / 100.0,
            }
        })
        .collect();

    let total_hits: usize = profiles.iter().map(|p| p.hit_count).sum();
    let warnings = pssm_scan_warnings(scan_len, n, hits.len(), total_hits);
    PssmMotifScanReport {
        motifs_evaluated: profiles.len(),
        threshold_rel_score: threshold,
        total_hits,
        profiles,
        hits,
        sequence_length_bp: n,
        scanned_length_bp: scan_len,
        warnings,
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimdFuzzySubsequenceHit {
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    pub edit_distance: u32,
    pub hamming_distance: Option<u32>,
    pub matched_seq: String,
}

/// Hardware SIMD-accelerated fuzzy subsequence scanner powered by `triple_accel`
/// (`levenshtein_search_simd_with_opts` + `hamming`).
pub fn scan_fuzzy_subsequence_simd(
    raw_seq: &str,
    raw_pattern: &str,
    max_edits: u32,
    both_strands: bool,
    max_hits: usize,
) -> Vec<SimdFuzzySubsequenceHit> {
    let seq = clean_sequence(raw_seq);
    let pat = clean_sequence(raw_pattern);
    if seq.is_empty() || pat.is_empty() || pat.len() > seq.len() + max_edits as usize {
        return Vec::new();
    }

    let k = max_edits.min((pat.len() / 2) as u32);
    let limit = max_hits.clamp(1, 500);
    let mut hits = Vec::new();

    for m in levenshtein_search_simd_with_opts(
        pat.as_bytes(),
        seq.as_bytes(),
        k,
        SearchType::Best,
        LEVENSHTEIN_COSTS,
        false,
    ) {
        if m.end <= seq.len() && m.start < m.end {
            let slice = &seq[m.start..m.end];
            let ham = if slice.len() == pat.len() {
                Some(hamming(slice.as_bytes(), pat.as_bytes()))
            } else {
                None
            };
            hits.push(SimdFuzzySubsequenceHit {
                start: m.start + 1,
                end: m.end,
                strand: 1,
                edit_distance: m.k,
                hamming_distance: ham,
                matched_seq: slice.to_string(),
            });
            if hits.len() >= limit {
                break;
            }
        }
    }

    if both_strands && hits.len() < limit {
        let rc_pat = reverse_complement_iupac(&pat, false);
        if rc_pat != pat {
            for m in levenshtein_search_simd_with_opts(
                rc_pat.as_bytes(),
                seq.as_bytes(),
                k,
                SearchType::Best,
                LEVENSHTEIN_COSTS,
                false,
            ) {
                if m.end <= seq.len() && m.start < m.end {
                    let slice = &seq[m.start..m.end];
                    let ham = if slice.len() == rc_pat.len() {
                        Some(hamming(slice.as_bytes(), rc_pat.as_bytes()))
                    } else {
                        None
                    };
                    hits.push(SimdFuzzySubsequenceHit {
                        start: m.start + 1,
                        end: m.end,
                        strand: -1,
                        edit_distance: m.k,
                        hamming_distance: ham,
                        matched_seq: slice.to_string(),
                    });
                    if hits.len() >= limit {
                        break;
                    }
                }
            }
        }
    }

    hits.sort_by(|a, b| a.edit_distance.cmp(&b.edit_distance).then(a.start.cmp(&b.start)));
    hits.truncate(limit);
    hits
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_bases(n: usize, seed: u64) -> Vec<u8> {
        let mut x = seed;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGT"[(x % 4) as usize]
            })
            .collect()
    }

    fn revcomp(s: &[u8]) -> Vec<u8> {
        s.iter()
            .rev()
            .map(|&b| match b {
                b'A' => b'T',
                b'T' => b'A',
                b'G' => b'C',
                _ => b'G',
            })
            .collect()
    }

    /// BG-01M6S1C1: past the cap the segmentation describes the bases it covered, as a
    /// segmentation of those bases alone does, and a warning names them. Shown with a 20,000-bp
    /// cap, which takes the same path as the 12 Mb one.
    #[test]
    fn capped_segmentation_describes_the_bases_it_covered() {
        let mut seq = random_bases(30_000, 0x00a7_9c11);
        // an AT-rich stretch inside the cap and a GC-rich one past it
        seq[5_000..9_000].copy_from_slice(&b"ATTA".repeat(1_000));
        seq[22_000..28_000].copy_from_slice(&b"GCCG".repeat(1_500));
        let text = String::from_utf8(seq.clone()).unwrap();

        let capped = segment_genome_hmm_viterbi_within(&text, 20_000);
        let alone = segment_genome_hmm_viterbi(&text[..20_000]);
        assert_eq!((capped.scanned_length_bp, capped.sequence_length_bp), (20_000, 30_000));
        assert_eq!(serde_json::to_value(&capped.segments).unwrap(), serde_json::to_value(&alone.segments).unwrap());
        assert_eq!(
            (capped.at_rich_fraction_pct, capped.balanced_coding_fraction_pct, capped.gc_island_fraction_pct),
            (alone.at_rich_fraction_pct, alone.balanced_coding_fraction_pct, alone.gc_island_fraction_pct)
        );
        assert!(capped.segments.last().is_some_and(|s| s.end == 20_000));
        assert_eq!(
            capped.warnings,
            ["HMM segmentation covered only the first 20,000 bp of the 30,000-bp sequence; the state fractions and segments describe bases 1-20,000 only."]
        );
        // under the real cap the same sequence is segmented whole, with nothing to warn of
        let whole = segment_genome_hmm_viterbi(&text);
        assert_eq!((whole.scanned_length_bp, whole.sequence_length_bp), (30_000, 30_000));
        assert!(whole.gc_island_fraction_pct > alone.gc_island_fraction_pct, "fixture: the GC-rich stretch past the cap counts when read");
        assert_eq!(serde_json::to_value(&whole).unwrap()["warnings"], serde_json::json!([]));
    }

    /// BG-01M6S1C1: past the cap the TF scan reads both strands of the bases it covered, places
    /// a minus-strand hit at its own coordinates there, reports nothing past the cap, and a warning
    /// names the bases. Shown with a 40,000-bp cap, which takes the same path as the 12 Mb one.
    #[test]
    fn capped_scan_reads_both_strands_of_the_bases_it_covered() {
        let t7 = b"TAATACGACTCACTATAGGG";
        let mut seq = random_bases(60_000, 0x0007_7a11);
        seq[30_000..30_020].copy_from_slice(&revcomp(t7)); // minus strand, bases 30,001..30,020
        seq[10_000..10_020].copy_from_slice(t7); // plus strand, bases 10,001..10,020
        seq[50_000..50_020].copy_from_slice(&revcomp(t7)); // minus strand, past the cap
        let text = String::from_utf8(seq.clone()).unwrap();

        let capped = scan_jaspar_pssm_motifs_within(&text, 0.95, None, 40_000);
        assert_eq!((capped.scanned_length_bp, capped.sequence_length_bp), (40_000, 60_000));
        let t7_at = |r: &PssmMotifScanReport, start: usize, strand: i8| {
            r.hits.iter().any(|h| h.matrix_id == "PHAGE_T7P" && h.start == start && h.end == start + 19 && h.strand == strand)
        };
        assert!(t7_at(&capped, 30_001, -1) && t7_at(&capped, 10_001, 1), "{:?}", capped.hits);
        assert!(capped.hits.iter().all(|h| h.end <= 40_000), "nothing past the cap");
        for h in &capped.hits {
            let fwd = &seq[h.start - 1..h.end];
            let read = if h.strand == 1 { fwd.to_vec() } else { revcomp(fwd) };
            assert_eq!(String::from_utf8(read).unwrap(), h.matched_seq, "{h:?}");
        }
        // the capped scan is the scan of those bases alone
        let alone = scan_jaspar_pssm_motifs(&text[..40_000], 0.95, None);
        assert_eq!(serde_json::to_value(&capped.hits).unwrap(), serde_json::to_value(&alone.hits).unwrap());
        assert_eq!(capped.total_hits, alone.total_hits);
        assert_eq!(
            capped.warnings.first().map(String::as_str),
            Some("TF motif scan covered only the first 40,000 bp of the 60,000-bp sequence, on both strands; sites past base 40,000 are not reported.")
        );
        // the whole sequence under the real cap finds the site past 40,000 too
        assert!(t7_at(&scan_jaspar_pssm_motifs(&text, 0.95, None), 50_001, -1));
    }

    #[test]
    fn segments_genome_with_rust_bio_viterbi_hmm_and_scans_jaspar_pssms() {
        let mut synthetic = String::new();
        synthetic.push_str(&"ATATTAATATAAATTAATAT".repeat(12)); // 240 bp AT-rich
        synthetic.push_str("TAATACGACTCACTATAGGG"); // T7 promoter
        synthetic.push_str(&"CCGCGGCCGGCGCGCCGGCC".repeat(12)); // 240 bp GC-rich island
        synthetic.push_str("AATTGTGAGCGATAACAATT"); // LacI operator

        let hmm_rep = segment_genome_hmm_viterbi(&synthetic);
        assert_eq!(hmm_rep.sequence_length_bp, synthetic.len());
        assert!(hmm_rep.viterbi_log_prob < 0.0);
        assert!(hmm_rep.at_rich_fraction_pct > 25.0);
        assert!(hmm_rep.gc_island_fraction_pct > 25.0);
        assert!(hmm_rep.segments.len() >= 2);

        // Segmentation labels, against an independent Viterbi: a textbook log-space Viterbi
        // (Durbin et al. 1998, sec. 3.2) written in pure Python over the same transition, emission
        // and initial matrices labels 1..257 AT-rich (the 240 bp A/T block and the T7 promoter's
        // first 17 bases), 258..500 GC island (the promoter's closing GGG and the 240 bp G/C block),
        // 501..520 AT-rich (the LacI operator): 277 AT-rich bases, 0 balanced and 243 GC-island of 520.
        let spans: Vec<(usize, &str, usize, usize)> = hmm_rep
            .segments
            .iter()
            .map(|s| (s.state_index, s.state_label.as_str(), s.start, s.end))
            .collect();
        assert_eq!(
            spans,
            [
                (0, "AT-Rich Intergenic / Promoter", 1, 257),
                (2, "GC-Rich CpG / Regulatory Island", 258, 500),
                (0, "AT-Rich Intergenic / Promoter", 501, 520),
            ]
        );
        assert_eq!(hmm_rep.at_rich_fraction_pct, 53.3); // 277 / 520
        assert_eq!(hmm_rep.balanced_coding_fraction_pct, 0.0);
        assert_eq!(hmm_rep.gc_island_fraction_pct, 46.7); // 243 / 520

        let pssm_rep = scan_jaspar_pssm_motifs(&synthetic, 0.85, None);
        assert!(pssm_rep.motifs_evaluated >= 10);
        assert!(pssm_rep.total_hits >= 2);
        assert!(pssm_rep
            .hits
            .iter()
            .any(|h| h.matrix_id == "PHAGE_T7P" || h.matrix_id == "PROK_LACO"));

        let simd_hits =
            scan_fuzzy_subsequence_simd(&synthetic, "TAATACGACTCACTATAGGA", 1, true, 10);
        assert!(!simd_hits.is_empty());
        assert!(simd_hits[0].edit_distance <= 1);
    }
}
