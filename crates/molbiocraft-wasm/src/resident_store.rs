// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Resident Native/WASM Genome & Giant-Protein Sequence Store.
//!
//! Keeps multi-megabase chromosomes (500 kbp – 50+ Mbp) and giant multi-domain proteins (10,000+ aa)
//! resident inside Rust linear/native memory with pre-built `rust-bio` `IntervalTree`, pre-built
//! `rust-bio` Suffix Array / BWT / FM-Index (for instant $O(m)$ keystroke motif lookup), cached
//! multi-resolution `GenomeTrackOverview` (`oriC`/`terC` GC-skew + GC%), and cached protein
//! secondary-structure / biochemical-class tracks.
//!
//! Eliminates repeated full-genome JavaScript string copies, `complement()` allocations, and
//! multi-megabyte JSON serialization across viewport page turns and circular map renders.

use std::cell::RefCell;

use bio::alphabets::Alphabet;
use bio::data_structures::bwt::{bwt, less, BWT, Less, Occ};
use bio::data_structures::fmindex::{BackwardSearchResult, FMIndex, FMIndexable};
use bio::data_structures::interval_tree::IntervalTree;
use bio::data_structures::suffix_array::suffix_array;
use molbiocraft_core::{
    clean_alpha_sequence, compute_genome_track_overview, format_thousands, iupac_complement_byte,
    reverse_complement_iupac, FmIndexSearchHit, GenomeTrackOverview, SequenceFeature,
};
use serde::{Deserialize, Serialize};

const MAX_RESIDENT_DOCS: usize = 16;
const MAX_RESIDENT_BYTES: usize = 128 * 1024 * 1024; // 128 MiB cap
const FM_INDEX_MAX_LEN: usize = 262_144;

struct PrebuiltFmComponents {
    sa: Vec<usize>,
    bwt_vec: BWT,
    less_vec: Less,
    occ: Occ,
}

impl PrebuiltFmComponents {
    fn build(upper_bytes: &[u8]) -> Self {
        let mut text = Vec::with_capacity(upper_bytes.len() + 1);
        for &b in upper_bytes {
            text.push(match b {
                b'A' | b'C' | b'G' | b'T' => b,
                b'U' => b'T',
                _ => b'N',
            });
        }
        text.push(b'$');
        let alphabet = Alphabet::new(b"$ACGTN");
        let sa = suffix_array(&text);
        let bwt_vec = bwt(&text, &sa);
        let less_vec = less(&bwt_vec, &alphabet);
        let occ = Occ::new(&bwt_vec, 3, &alphabet);
        Self {
            sa,
            bwt_vec,
            less_vec,
            occ,
        }
    }

    /// Pushes the first `cap` occurrences of `pat_bytes` by position onto `out` on `strand`, and
    /// returns how many there are in the whole text: the size of the FM interval.
    fn search_strand(
        &self,
        pat_bytes: &[u8],
        strand: i8,
        cap: usize,
        out: &mut Vec<FmIndexSearchHit>,
    ) -> usize {
        let fm = FMIndex::new(&self.bwt_vec, &self.less_vec, &self.occ);
        let norm: Vec<u8> = pat_bytes
            .iter()
            .map(|&b| if b == b'U' { b'T' } else { b })
            .collect();
        if let BackwardSearchResult::Complete(interval) = fm.backward_search(norm.iter()) {
            let total = interval.upper - interval.lower;
            let mut occs = interval.occ(&self.sa);
            occs.sort_unstable();
            for pos in occs.into_iter().take(cap) {
                out.push(FmIndexSearchHit {
                    start: pos + 1,
                    end: pos + norm.len(),
                    strand,
                });
            }
            return total;
        }
        0
    }
}

/// Pushes the first `cap` occurrences of `pat` in `text` by position onto `out` on `strand`, and
/// returns how many there are in the whole text. Each search resumes one base after the last hit's
/// start, so overlapping hits (CACA twice in CACACA) are each found and counted.
fn scan_strand(
    text: &[u8],
    pat: &[u8],
    strand: i8,
    cap: usize,
    out: &mut Vec<FmIndexSearchHit>,
) -> usize {
    let finder = memchr::memmem::Finder::new(pat);
    let mut total = 0;
    let mut from = 0;
    while let Some(offset) = finder.find(&text[from..]) {
        let pos = from + offset;
        if total < cap {
            out.push(FmIndexSearchHit {
                start: pos + 1,
                end: pos + pat.len(),
                strand,
            });
        }
        total += 1;
        from = pos + 1;
    }
    total
}

/// The resident motif search's reply (BG-01M6S17C): the first `maxHits` hits in position order,
/// with both strands merged before the cut, the number of hits in the whole sequence, and one D0005
/// warning when the list holds fewer hits than that.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentMotifSearch {
    pub hits: Vec<FmIndexSearchHit>,
    pub total_hits: usize,
    #[serde(default)]
    pub warnings: Vec<String>,
}

impl ResidentMotifSearch {
    /// Orders `hits` by position (the forward hit first at a shared start), keeps the first `cap`,
    /// and says so when that leaves out any of the `total_hits`.
    fn first_of(mut hits: Vec<FmIndexSearchHit>, total_hits: usize, cap: usize) -> Self {
        hits.sort_by(|a, b| a.start.cmp(&b.start).then_with(|| b.strand.cmp(&a.strand)));
        hits.truncate(cap);
        let warnings = if hits.len() < total_hits {
            vec![format!(
                "Showing the first {} of {} hits.",
                format_thousands(hits.len()),
                format_thousands(total_hits)
            )]
        } else {
            Vec::new()
        };
        Self {
            hits,
            total_hits,
            warnings,
        }
    }

    fn none() -> Self {
        Self {
            hits: Vec::new(),
            total_hits: 0,
            warnings: Vec::new(),
        }
    }
}

struct ResidentSequenceEntry {
    doc_id: String,
    revision_key: String,
    upper_bytes: Vec<u8>,
    is_rna: bool,
    is_protein: bool,
    feature_count: usize,
    feature_tree: IntervalTree<u64, usize>,
    track_overview: GenomeTrackOverview,
    fm: Option<PrebuiltFmComponents>,
    protein_ss: Vec<u8>,
    protein_classes: Vec<u8>,
    last_access_tick: u64,
}

impl ResidentSequenceEntry {
    fn approx_footprint_bytes(&self) -> usize {
        let fm_bytes = self
            .fm
            .as_ref()
            .map(|f| f.sa.len() * std::mem::size_of::<usize>() + f.bwt_vec.len() * 4)
            .unwrap_or(0);
        self.upper_bytes.len()
            + self.protein_ss.len()
            + self.protein_classes.len()
            + self.feature_count * 48
            + fm_bytes
    }
}

#[derive(Default)]
struct ResidentStore {
    tick: u64,
    entries: Vec<ResidentSequenceEntry>,
}

thread_local! {
    static RESIDENT_STORE: RefCell<ResidentStore> = RefCell::new(ResidentStore::default());
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentEnsureAck {
    pub doc_id: String,
    pub revision_key: String,
    pub sequence_length: usize,
    pub feature_count: usize,
    pub has_prebuilt_fm_index: bool,
    pub is_protein: bool,
    pub cache_hit: bool,
    pub resident_doc_count: usize,
    pub resident_total_bytes: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentViewportSlice {
    pub doc_id: String,
    pub total_length: usize,
    pub start_pos: usize, // 1-based inclusive
    pub end_pos: usize,   // 1-based inclusive
    pub top_strand: String,
    pub bottom_strand: String,
    pub overlapping_feature_indices: Vec<usize>,
    pub window_gc_percent: f64,
    pub protein_secondary_states: Option<String>,
    pub protein_residue_classes: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResidentStoreStats {
    pub resident_doc_count: usize,
    pub resident_total_bytes: usize,
    pub resident_doc_ids: Vec<String>,
}

/// Fast Chou-Fasman / GOR sliding-window secondary structure (`H`, `E`, `C`) and non-color-only
/// biochemical class (`H` hydrophobic, `P` polar, `+` basic, `-` acidic, `G` special) precomputation
/// for resident protein sequences (completes in < 0.4 ms for 10,000 aa).
fn build_protein_tracks(upper: &[u8]) -> (Vec<u8>, Vec<u8>) {
    let n = upper.len();
    let mut classes = Vec::with_capacity(n);
    for &b in upper {
        let cls = match b {
            b'A' | b'V' | b'I' | b'L' | b'M' | b'F' | b'Y' | b'W' => b'H',
            b'K' | b'R' | b'H' => b'+',
            b'D' | b'E' => b'-',
            b'G' | b'P' | b'C' => b'G',
            _ => b'P',
        };
        classes.push(cls);
    }

    let p_helix = |b: u8| -> f64 {
        match b {
            b'E' => 1.51,
            b'M' => 1.45,
            b'A' => 1.42,
            b'L' => 1.21,
            b'K' => 1.16,
            b'F' => 1.13,
            b'Q' => 1.11,
            b'W' => 1.08,
            b'I' => 1.08,
            b'V' => 1.06,
            b'D' => 1.01,
            b'H' => 1.00,
            b'R' => 0.98,
            b'T' => 0.83,
            b'S' => 0.77,
            b'C' => 0.70,
            b'Y' => 0.69,
            b'N' => 0.67,
            b'P' => 0.57,
            b'G' => 0.57,
            _ => 0.90,
        }
    };
    let p_sheet = |b: u8| -> f64 {
        match b {
            b'V' => 1.70,
            b'I' => 1.60,
            b'Y' => 1.47,
            b'F' => 1.38,
            b'W' => 1.37,
            b'L' => 1.30,
            b'C' => 1.19,
            b'T' => 1.19,
            b'Q' => 1.10,
            b'M' => 1.05,
            b'R' => 0.93,
            b'N' => 0.89,
            b'H' => 0.87,
            b'A' => 0.83,
            b'S' => 0.75,
            b'G' => 0.75,
            b'K' => 0.74,
            b'P' => 0.55,
            b'D' => 0.54,
            b'E' => 0.37,
            _ => 0.90,
        }
    };

    let mut ss = Vec::with_capacity(n);
    for i in 0..n {
        let lo = i.saturating_sub(3);
        let hi = (i + 4).min(n);
        let span = (hi - lo).max(1) as f64;
        let mut h_sum = 0.0;
        let mut e_sum = 0.0;
        let mut pro_break = false;
        for (idx, &ch) in upper[lo..hi].iter().enumerate() {
            h_sum += p_helix(ch);
            e_sum += p_sheet(ch);
            if ch == b'P' && (lo + idx).abs_diff(i) <= 1 {
                pro_break = true;
            }
        }
        let h_avg = h_sum / span;
        let e_avg = e_sum / span;
        if !pro_break && h_avg >= 1.07 && h_avg >= e_avg {
            ss.push(b'H');
        } else if e_avg >= 1.06 && e_avg > h_avg {
            ss.push(b'E');
        } else {
            ss.push(b'C');
        }
    }
    (ss, classes)
}

/// Ensures that `doc_id` with `revision_key` is indexed and resident in Rust memory.
/// If `doc_id` + `revision_key` is already resident, returns immediately with `cache_hit: true`.
pub fn ensure_resident_sequence(
    doc_id: &str,
    revision_key: &str,
    raw_seq: &str,
    features: &[SequenceFeature],
    is_rna: bool,
    is_protein: bool,
    overview_bins: usize,
) -> ResidentEnsureAck {
    RESIDENT_STORE.with(|cell| {
        let mut store = cell.borrow_mut();
        store.tick += 1;
        let now_tick = store.tick;

        if let Some(pos) = store
            .entries
            .iter()
            .position(|e| e.doc_id == doc_id && e.revision_key == revision_key && !revision_key.is_empty())
        {
            store.entries[pos].last_access_tick = now_tick;
            let seq_len = store.entries[pos].upper_bytes.len();
            let feat_cnt = store.entries[pos].feature_count;
            let has_fm = store.entries[pos].fm.is_some();
            let is_prot = store.entries[pos].is_protein;
            let total_bytes: usize = store.entries.iter().map(|e| e.approx_footprint_bytes()).sum();
            return ResidentEnsureAck {
                doc_id: doc_id.to_string(),
                revision_key: revision_key.to_string(),
                sequence_length: seq_len,
                feature_count: feat_cnt,
                has_prebuilt_fm_index: has_fm,
                is_protein: is_prot,
                cache_hit: true,
                resident_doc_count: store.entries.len(),
                resident_total_bytes: total_bytes,
            };
        }

        // Remove older revision of same doc_id if present
        store.entries.retain(|e| e.doc_id != doc_id);

        let upper_bytes: Vec<u8> = raw_seq
            .bytes()
            .map(|b| b.to_ascii_uppercase())
            .collect();
        let seq_len = upper_bytes.len();

        let mut feature_tree: IntervalTree<u64, usize> = IntervalTree::new();
        for (idx, feat) in features.iter().enumerate() {
            let lo = feat.start.min(feat.end).max(1) as u64;
            let hi = (feat.end.max(feat.start).max(1) as u64) + 1;
            feature_tree.insert(lo..hi, idx);
        }

        let upper_str = unsafe { std::str::from_utf8_unchecked(&upper_bytes) };
        let track_overview = compute_genome_track_overview(upper_str, overview_bins.clamp(32, 360));

        let fm = if !is_protein && seq_len > 0 && seq_len <= FM_INDEX_MAX_LEN {
            Some(PrebuiltFmComponents::build(&upper_bytes))
        } else {
            None
        };

        let (protein_ss, protein_classes) = if is_protein {
            build_protein_tracks(&upper_bytes)
        } else {
            (Vec::new(), Vec::new())
        };

        let rev = if revision_key.is_empty() {
            format!("{}:{}:{}", seq_len, features.len(), now_tick)
        } else {
            revision_key.to_string()
        };

        let entry = ResidentSequenceEntry {
            doc_id: doc_id.to_string(),
            revision_key: rev.clone(),
            upper_bytes,
            is_rna,
            is_protein,
            feature_count: features.len(),
            feature_tree,
            track_overview,
            fm,
            protein_ss,
            protein_classes,
            last_access_tick: now_tick,
        };
        let has_fm = entry.fm.is_some();
        store.entries.push(entry);

        // Enforce LRU document count and memory budget caps
        while store.entries.len() > MAX_RESIDENT_DOCS
            || (store.entries.len() > 1
                && store
                    .entries
                    .iter()
                    .map(|e| e.approx_footprint_bytes())
                    .sum::<usize>()
                    > MAX_RESIDENT_BYTES)
        {
            if let Some((oldest_idx, _)) = store
                .entries
                .iter()
                .enumerate()
                .min_by_key(|(_, e)| e.last_access_tick)
            {
                store.entries.swap_remove(oldest_idx);
            } else {
                break;
            }
        }

        let total_bytes: usize = store.entries.iter().map(|e| e.approx_footprint_bytes()).sum();
        ResidentEnsureAck {
            doc_id: doc_id.to_string(),
            revision_key: rev,
            sequence_length: seq_len,
            feature_count: features.len(),
            has_prebuilt_fm_index: has_fm,
            is_protein,
            cache_hit: false,
            resident_doc_count: store.entries.len(),
            resident_total_bytes: total_bytes,
        }
    })
}

/// Slices a bounded 1-based viewport `[start_pos..=end_pos]` directly from Resident Rust memory
/// in $< 50\ \mu\text{s}$ without transferring the full genome across JS↔WASM.
pub fn slice_resident_viewport(
    doc_id: &str,
    start_pos: usize,
    end_pos: usize,
) -> Result<ResidentViewportSlice, String> {
    RESIDENT_STORE.with(|cell| {
        let mut store = cell.borrow_mut();
        store.tick += 1;
        let now_tick = store.tick;
        let entry = store
            .entries
            .iter_mut()
            .find(|e| e.doc_id == doc_id)
            .ok_or_else(|| format!("RESIDENT_MISS:{}", doc_id))?;
        entry.last_access_tick = now_tick;

        let total_len = entry.upper_bytes.len();
        if total_len == 0 {
            return Ok(ResidentViewportSlice {
                doc_id: doc_id.to_string(),
                total_length: 0,
                start_pos: 1,
                end_pos: 1,
                top_strand: String::new(),
                bottom_strand: String::new(),
                overlapping_feature_indices: Vec::new(),
                window_gc_percent: 0.0,
                protein_secondary_states: entry.is_protein.then(String::new),
                protein_residue_classes: entry.is_protein.then(String::new),
            });
        }

        let s1 = start_pos.max(1).min(total_len);
        let e1 = end_pos.max(s1).min(total_len);
        let slice = &entry.upper_bytes[(s1 - 1)..e1];

        let top_strand = String::from_utf8_lossy(slice).into_owned();
        let mut bot = if entry.is_protein {
            Vec::new()
        } else {
            Vec::with_capacity(slice.len())
        };
        let mut gc_cnt = 0usize;
        let mut atgc_cnt = 0usize;

        if !entry.is_protein {
            for &u in slice {
                bot.push(iupac_complement_byte(u, entry.is_rna));
                match u {
                    b'G' | b'C' => {
                        gc_cnt += 1;
                        atgc_cnt += 1;
                    }
                    b'A' | b'T' | b'U' => {
                        atgc_cnt += 1;
                    }
                    _ => {}
                }
            }
        }

        let q_lo = s1 as u64;
        let q_hi = (e1 as u64) + 1;
        let mut overlapping: Vec<usize> = entry
            .feature_tree
            .find(q_lo..q_hi)
            .map(|it| *it.data())
            .collect();
        overlapping.sort_unstable();
        overlapping.dedup();

        let window_gc = if atgc_cnt > 0 {
            ((gc_cnt as f64 / atgc_cnt as f64) * 1000.0).round() / 10.0
        } else {
            0.0
        };

        let (prot_ss, prot_cls) = if entry.is_protein {
            (
                Some(String::from_utf8_lossy(&entry.protein_ss[(s1 - 1)..e1]).into_owned()),
                Some(String::from_utf8_lossy(&entry.protein_classes[(s1 - 1)..e1]).into_owned()),
            )
        } else {
            (None, None)
        };

        Ok(ResidentViewportSlice {
            doc_id: doc_id.to_string(),
            total_length: total_len,
            start_pos: s1,
            end_pos: e1,
            top_strand,
            bottom_strand: unsafe { String::from_utf8_unchecked(bot) },
            overlapping_feature_indices: overlapping,
            window_gc_percent: window_gc,
            protein_secondary_states: prot_ss,
            protein_residue_classes: prot_cls,
        })
    })
}

/// Returns the cached `GenomeTrackOverview` for `doc_id` in $< 20\ \mu\text{s}$ (recomputing only if
/// a different bin resolution is explicitly requested).
pub fn get_resident_track_overview(
    doc_id: &str,
    requested_bins: Option<usize>,
) -> Result<GenomeTrackOverview, String> {
    RESIDENT_STORE.with(|cell| {
        let mut store = cell.borrow_mut();
        store.tick += 1;
        let now_tick = store.tick;
        let entry = store
            .entries
            .iter_mut()
            .find(|e| e.doc_id == doc_id)
            .ok_or_else(|| format!("RESIDENT_MISS:{}", doc_id))?;
        entry.last_access_tick = now_tick;

        if let Some(req) = requested_bins {
            let clamped = req.clamp(16, 512);
            if clamped != entry.track_overview.bin_count && entry.upper_bytes.len() > clamped {
                let s = unsafe { std::str::from_utf8_unchecked(&entry.upper_bytes) };
                return Ok(compute_genome_track_overview(s, clamped));
            }
        }
        Ok(entry.track_overview.clone())
    })
}

/// Searches a resident genome or giant protein in Rust memory: through the pre-built `rust-bio`
/// FM-Index ($O(m)$ zero-rebuild backward search) for DNA of up to 262,144 bp searched with A, C,
/// G, T, U or N, and otherwise (longer chromosomes, other IUPAC letters, proteins) by a `memchr`
/// scan that finds and counts every hit, overlapping ones included. Both strands are collected
/// before the list is cut to `max_hits` (at least 1), and the reply carries the number of hits in
/// the whole sequence. A palindrome, whose reverse complement is itself, is one hit per site on the
/// forward strand.
pub fn search_resident_motif_fmindex(
    doc_id: &str,
    raw_pattern: &str,
    search_both_strands: bool,
    max_hits: usize,
) -> Result<ResidentMotifSearch, String> {
    let pat = clean_alpha_sequence(raw_pattern);
    if pat.is_empty() {
        return Ok(ResidentMotifSearch::none());
    }

    RESIDENT_STORE.with(|cell| {
        let mut store = cell.borrow_mut();
        store.tick += 1;
        let now_tick = store.tick;
        let entry = store
            .entries
            .iter_mut()
            .find(|e| e.doc_id == doc_id)
            .ok_or_else(|| format!("RESIDENT_MISS:{}", doc_id))?;
        entry.last_access_tick = now_tick;

        if pat.len() > entry.upper_bytes.len() {
            return Ok(ResidentMotifSearch::none());
        }

        let cap = max_hits.max(1);
        let mut hits = Vec::new();
        let canonical_dna = !entry.is_protein
            && pat
                .bytes()
                .all(|b| matches!(b, b'A' | b'C' | b'G' | b'T' | b'U' | b'N'));

        if canonical_dna {
            if let Some(ref fm) = entry.fm {
                // The index reads U as T, so the palindrome test does too: GAAUUC is GAATTC.
                let dna = pat.replace('U', "T");
                let mut total = fm.search_strand(dna.as_bytes(), 1, cap, &mut hits);
                if search_both_strands {
                    let rc = reverse_complement_iupac(&dna, false);
                    if rc != dna {
                        total += fm.search_strand(rc.as_bytes(), -1, cap, &mut hits);
                    }
                }
                return Ok(ResidentMotifSearch::first_of(hits, total, cap));
            }
        }

        // memchr scan over resident upper_bytes (zero JS string serialization)
        let pat_norm: Vec<u8> = if entry.is_rna {
            pat.bytes().map(|b| if b == b'T' { b'U' } else { b }).collect()
        } else if !entry.is_protein {
            pat.bytes().map(|b| if b == b'U' { b'T' } else { b }).collect()
        } else {
            pat.into_bytes()
        };

        let mut total = scan_strand(&entry.upper_bytes, &pat_norm, 1, cap, &mut hits);
        if search_both_strands && !entry.is_protein {
            let pat_str = unsafe { std::str::from_utf8_unchecked(&pat_norm) };
            let rc = reverse_complement_iupac(pat_str, entry.is_rna);
            if rc.as_bytes() != pat_norm.as_slice() {
                total += scan_strand(&entry.upper_bytes, rc.as_bytes(), -1, cap, &mut hits);
            }
        }
        Ok(ResidentMotifSearch::first_of(hits, total, cap))
    })
}

pub fn evict_resident_sequence(doc_id: &str) -> bool {
    RESIDENT_STORE.with(|cell| {
        let mut store = cell.borrow_mut();
        let before = store.entries.len();
        if doc_id == "*" {
            store.entries.clear();
        } else {
            store.entries.retain(|e| e.doc_id != doc_id);
        }
        store.entries.len() < before
    })
}

pub fn resident_store_stats() -> ResidentStoreStats {
    RESIDENT_STORE.with(|cell| {
        let store = cell.borrow();
        ResidentStoreStats {
            resident_doc_count: store.entries.len(),
            resident_total_bytes: store
                .entries
                .iter()
                .map(|e| e.approx_footprint_bytes())
                .sum(),
            resident_doc_ids: store.entries.iter().map(|e| e.doc_id.clone()).collect(),
        }
    })
}
