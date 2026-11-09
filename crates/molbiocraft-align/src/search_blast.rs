// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Bit-parallel approximate matching (`bio::pattern_matching::myers::Myers`),
//! indexed k-mer/minimizer dotplots (`compute_dotplot_hits`), seed-and-extend local BLAST
//! (`blastn`, `blastp`, `blastx`, `tblastn`) with Karlin-Altschul bit-scores & E-values,
//! and k-mer/Aho-Corasick taxonomic marker classification.

use crate::pairwise::{align_pairwise_gotoh, PairwiseAlignmentResult, PairwiseMode, ScoringMatrixKind};
use aho_corasick::AhoCorasick;
use bio::pattern_matching::myers::Myers;
use molbiocraft_core::{clean_alpha_sequence, clean_sequence, reverse_complement_iupac};
use rustc_hash::FxHashMap;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MyersPatternHit {
    pub start: usize,
    pub end: usize,
    pub strand: i8,
    pub edit_distance: u8,
    pub matched_seq: String,
}

/// Bit-parallel approximate sequence search on both strands via `rust-bio` `Myers::<u64>`.
pub fn search_approximate_myers(
    haystack_raw: &str,
    pattern_raw: &str,
    max_edit_dist: u8,
    search_revcomp: bool,
    max_hits: usize,
) -> Vec<MyersPatternHit> {
    let hay = clean_alpha_sequence(haystack_raw);
    let pat = clean_alpha_sequence(pattern_raw);
    if hay.is_empty() || pat.is_empty() || pat.len() > 64 {
        return Vec::new();
    }
    let limit = if max_hits == 0 { 256 } else { max_hits };
    let hay_bytes = hay.as_bytes();
    let mut hits = Vec::new();

    let mut myers_fwd = Myers::<u64>::new(pat.as_bytes());
    for (start, end, dist) in myers_fwd.find_all(hay_bytes, max_edit_dist) {
        let e = end.min(hay_bytes.len());
        let s = start.min(e);
        hits.push(MyersPatternHit {
            start: s + 1,
            end: e,
            strand: 1,
            edit_distance: dist,
            matched_seq: hay[s..e].to_string(),
        });
        if hits.len() >= limit {
            return hits;
        }
    }

    if search_revcomp {
        let rc = reverse_complement_iupac(&pat, false);
        if rc != pat && rc.len() <= 64 {
            let mut myers_rev = Myers::<u64>::new(rc.as_bytes());
            for (start, end, dist) in myers_rev.find_all(hay_bytes, max_edit_dist) {
                let e = end.min(hay_bytes.len());
                let s = start.min(e);
                hits.push(MyersPatternHit {
                    start: s + 1,
                    end: e,
                    strand: -1,
                    edit_distance: dist,
                    matched_seq: hay[s..e].to_string(),
                });
                if hits.len() >= limit {
                    break;
                }
            }
        }
    }

    hits.sort_by_key(|h| (h.edit_distance, h.start));
    hits
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DotplotHit {
    pub x: usize,
    pub y: usize,
    pub strand: i8,
    pub score: usize,
}

/// High-throughput sliding-window & k-mer seed dotplot engine supporting both small plasmids
/// and multi-megabase chromosomes via adaptive striding + seed lookup.
pub fn compute_dotplot_hits(
    raw_seq1: &str,
    raw_seq2: &str,
    window_size: usize,
    min_matches: usize,
) -> Vec<DotplotHit> {
    let s1 = clean_alpha_sequence(raw_seq1);
    let s2 = clean_alpha_sequence(raw_seq2);
    let w = window_size.clamp(5, 31);
    let min_m = min_matches.clamp(3, w);

    if s1.len() < w || s2.len() < w {
        return Vec::new();
    }

    let b1 = s1.as_bytes();
    let b2 = s2.as_bytes();
    let rc2_str = reverse_complement_iupac(&s2, false);
    let rc2 = rc2_str.as_bytes();

    // For sequences > 4,000 bp, use a fast FxHashMap seed index; for smaller sequences, use strided exact window scan.
    if b1.len().max(b2.len()) > 4000 {
        let seed_k = (min_m / 2).clamp(6, 13).min(w);
        let stride2 = (b2.len() / 2400).max(1);
        let stride1 = (b1.len() / 2400).max(1);

        let mut fwd_idx: FxHashMap<&[u8], Vec<usize>> = FxHashMap::default();
        let mut rev_idx: FxHashMap<&[u8], Vec<usize>> = FxHashMap::default();
        let mut j = 0usize;
        while j + w <= b2.len() {
            let entry_f = fwd_idx.entry(&b2[j..j + seed_k]).or_default();
            if entry_f.len() < 12 {
                entry_f.push(j);
            }
            let rj = b2.len() - w - j;
            let entry_r = rev_idx.entry(&rc2[rj..rj + seed_k]).or_default();
            if entry_r.len() < 12 {
                entry_r.push(j);
            }
            j += stride2;
        }

        let mut hits = Vec::new();
        let mut i = 0usize;
        while i + w <= b1.len() && hits.len() < 4000 {
            let seed = &b1[i..i + seed_k];
            if let Some(js) = fwd_idx.get(seed) {
                for &j_pos in js {
                    let mut m = 0usize;
                    for k in 0..w {
                        if b1[i + k] == b2[j_pos + k] {
                            m += 1;
                        }
                    }
                    if m >= min_m {
                        hits.push(DotplotHit {
                            x: i + 1,
                            y: j_pos + 1,
                            strand: 1,
                            score: m,
                        });
                    }
                }
            }
            if let Some(js) = rev_idx.get(seed) {
                for &j_pos in js {
                    let mut m = 0usize;
                    for k in 0..w {
                        if b1[i + k] == rc2[b2.len() - w - j_pos + k] {
                            m += 1;
                        }
                    }
                    if m >= min_m {
                        hits.push(DotplotHit {
                            x: i + 1,
                            y: j_pos + 1,
                            strand: -1,
                            score: m,
                        });
                    }
                }
            }
            i += stride1;
        }
        return hits;
    }

    let step = (b1.len().max(b2.len()) / 280).max(1);
    let mut hits = Vec::new();
    let mut i = 0usize;
    while i + w <= b1.len() {
        let mut j = 0usize;
        while j + w <= b2.len() {
            let mut fwd = 0usize;
            let mut rev = 0usize;
            for k in 0..w {
                if b1[i + k] == b2[j + k] {
                    fwd += 1;
                }
                if b1[i + k] == rc2[b2.len() - w - j + k] {
                    rev += 1;
                }
            }
            if fwd >= min_m {
                hits.push(DotplotHit {
                    x: i + 1,
                    y: j + 1,
                    strand: 1,
                    score: fwd,
                });
            }
            if rev >= min_m {
                hits.push(DotplotHit {
                    x: i + 1,
                    y: j + 1,
                    strand: -1,
                    score: rev,
                });
            }
            j += step;
        }
        i += step;
    }
    hits
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlastSubjectDoc {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub accession: String,
    #[serde(default)]
    pub description: String,
    /// The subject's sequence, not FASTA text: its ASCII letters are searched as residues, and
    /// FASTA header (`>`) or comment (`;`) lines are not stripped here as they are from the query
    /// (BG-01M6QHDJ), so the letters of a header sent in this field are searched as subject residues.
    pub sequence: String,
    /// Source organism of the record, if known.
    #[serde(default)]
    pub organism: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BlastHitRecord {
    pub id: String,
    pub accession: String,
    pub description: String,
    pub organism: String,
    pub program: String,
    pub query_coverage_pct: f64,
    pub identity_pct: f64,
    pub e_value: String,
    pub bit_score: f64,
    pub align_length: usize,
    pub query_start: usize,
    pub query_end: usize,
    pub subject_start: usize,
    pub subject_end: usize,
    pub aligned_query: String,
    pub aligned_midline: String,
    pub aligned_subject: String,
    /// Why the hit comes from less than the whole query (D0005): set when the query was cut to the
    /// program's query cap. Empty, and left out of the JSON, when the whole query was searched.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub warnings: Vec<String>,
}

/// Seed-and-extend local BLAST search (`blastn`, `blastp`, `blastx`, `tblastn`) powered by
fn revcomp_dna(s: &str) -> String {
    s.bytes()
        .rev()
        .map(|b| match b.to_ascii_uppercase() {
            b'A' => 'T',
            b'C' => 'G',
            b'G' => 'C',
            b'T' | b'U' => 'A',
            b'R' => 'Y',
            b'Y' => 'R',
            b'K' => 'M',
            b'M' => 'K',
            b'B' => 'V',
            b'V' => 'B',
            b'D' => 'H',
            b'H' => 'D',
            b'-' => '-',
            x => x as char,
        })
        .collect()
}

/// Standard-code translation of `dna` from `offset`, keeping stops as '*' so residue i maps to
/// nucleotides offset+3i .. offset+3i+2.
fn translate_frame(dna: &[u8], offset: usize) -> String {
    let mut out = String::with_capacity(dna.len() / 3);
    let mut i = offset;
    while i + 3 <= dna.len() {
        let c = |k: usize| match dna[i + k].to_ascii_uppercase() { b'U' => b'T', x => x };
        let aa = match (c(0), c(1), c(2)) {
            (b'T', b'T', b'T' | b'C') => 'F',
            (b'T', b'T', b'A' | b'G') | (b'C', b'T', b'A' | b'C' | b'G' | b'T') => 'L',
            (b'A', b'T', b'T' | b'C' | b'A') => 'I',
            (b'A', b'T', b'G') => 'M',
            (b'G', b'T', b'A' | b'C' | b'G' | b'T') => 'V',
            (b'T', b'C', b'A' | b'C' | b'G' | b'T') | (b'A', b'G', b'T' | b'C') => 'S',
            (b'C', b'C', b'A' | b'C' | b'G' | b'T') => 'P',
            (b'A', b'C', b'A' | b'C' | b'G' | b'T') => 'T',
            (b'G', b'C', b'A' | b'C' | b'G' | b'T') => 'A',
            (b'T', b'A', b'T' | b'C') => 'Y',
            (b'T', b'A', b'A' | b'G') | (b'T', b'G', b'A') => '*',
            (b'C', b'A', b'T' | b'C') => 'H',
            (b'C', b'A', b'A' | b'G') => 'Q',
            (b'A', b'A', b'T' | b'C') => 'N',
            (b'A', b'A', b'A' | b'G') => 'K',
            (b'G', b'A', b'T' | b'C') => 'D',
            (b'G', b'A', b'A' | b'G') => 'E',
            (b'T', b'G', b'T' | b'C') => 'C',
            (b'T', b'G', b'G') => 'W',
            (b'C', b'G', b'A' | b'C' | b'G' | b'T') | (b'A', b'G', b'A' | b'G') => 'R',
            (b'G', b'G', b'A' | b'C' | b'G' | b'T') => 'G',
            _ => 'X',
        };
        out.push(aa);
        i += 3;
    }
    out
}

/// Candidate windows of `q` × `s` around the best-supported diagonals of shared k-mers (0-based,
/// end-exclusive), best first, at most `max`. Overlapping windows on the same diagonal band merge.
fn seeded_windows(q: &[u8], s: &[u8], k: usize, max: usize) -> Vec<(usize, usize, usize, usize)> {
    if q.len() < k || s.len() < k {
        return Vec::new();
    }
    let mut index: std::collections::HashMap<&[u8], Vec<u32>> = std::collections::HashMap::new();
    for i in 0..=s.len() - k {
        let e = index.entry(&s[i..i + k]).or_default();
        if e.len() < 64 {
            e.push(i as u32);
        }
    }
    let mut votes: std::collections::HashMap<i64, Vec<(usize, usize)>> = std::collections::HashMap::new();
    for j in 0..=q.len() - k {
        if let Some(hits) = index.get(&q[j..j + k]) {
            if hits.len() > 48 {
                continue; // repetitive k-mer
            }
            for &i in hits {
                let d = i as i64 - j as i64;
                votes.entry(d.div_euclid(32)).or_default().push((j, i as usize));
            }
        }
    }
    let mut bins: Vec<(i64, Vec<(usize, usize)>)> = votes.into_iter().filter(|(_, v)| v.len() >= 2).collect();
    bins.sort_by(|a, b| b.1.len().cmp(&a.1.len()).then(a.0.cmp(&b.0)));
    let pad = 60;
    let mut out: Vec<(usize, usize, usize, usize)> = Vec::new();
    for (_, seeds) in bins {
        if out.len() >= max {
            break;
        }
        // seeds of one diagonal band can belong to several HSPs far apart: split at gaps > 400
        let mut seeds = seeds;
        seeds.sort_unstable();
        let mut groups: Vec<Vec<(usize, usize)>> = Vec::new();
        for sd in seeds {
            match groups.last_mut() {
                Some(g) if sd.0 <= g.last().unwrap().0 + 400 => g.push(sd),
                _ => groups.push(vec![sd]),
            }
        }
        for g in groups.into_iter().filter(|g| g.len() >= 2) {
            let w = (
                g.iter().map(|x| x.0).min().unwrap().saturating_sub(pad),
                (g.iter().map(|x| x.0).max().unwrap() + k + pad).min(q.len()),
                g.iter().map(|x| x.1).min().unwrap().saturating_sub(pad),
                (g.iter().map(|x| x.1).max().unwrap() + k + pad).min(s.len()),
            );
            // windows that overlap (an HSP whose indels move it to a neighbouring diagonal) merge,
            // so one gapped alignment spans them
            if let Some(o) = out.iter_mut().find(|o| w.0 < o.1 && o.0 < w.1 && w.2 < o.3 && o.2 < w.3) {
                *o = (o.0.min(w.0), o.1.max(w.1), o.2.min(w.2), o.3.max(w.3));
            } else if out.len() < max {
                out.push(w);
            }
        }
    }
    out
}

/// One HSP: the local alignment and the 0-based offsets of the aligned window.
struct Hsp {
    aln: PairwiseAlignmentResult,
    q_off: usize,
    s_off: usize,
}

/// Up to `max_hsps` non-overlapping local alignments of `q` in `s`, best first. Small products are
/// aligned in full (Smith–Waterman) with the subject's found segments masked between rounds; larger
/// ones in the windows around shared k-mer diagonals.
fn find_hsps(q: &str, s: &str, protein: bool, max_hsps: usize, min_score: i32) -> Vec<Hsp> {
    let (matrix, ms, mm, go, ge) = if protein {
        (ScoringMatrixKind::Blosum62, 1, -1, -11, -1)
    } else {
        (ScoringMatrixKind::DnaIupac, 2, -3, -5, -2)
    };
    let mut out: Vec<Hsp> = Vec::new();
    let windows: Vec<(usize, usize, usize, usize)> = if q.len().saturating_mul(s.len()) <= 4_000_000 {
        vec![(0, q.len(), 0, s.len())]
    } else {
        seeded_windows(q.as_bytes(), s.as_bytes(), if protein { 3 } else { 11 }, max_hsps * 2)
    };
    // masking character that scores as a mismatch against every residue
    let mask = if protein { b'X' } else { b'#' };
    for (q0, q1, s0, s1) in windows {
        let mut subj: Vec<u8> = s.as_bytes()[s0..s1].to_vec();
        for _ in 0..max_hsps {
            if out.len() >= max_hsps {
                break;
            }
            let sub = String::from_utf8_lossy(&subj).into_owned();
            let aln = align_pairwise_gotoh(&q[q0..q1], &sub, PairwiseMode::Local, Some(matrix), ms, mm, go, ge, 0);
            if aln.score < min_score.max(1) {
                break;
            }
            let (ys, ye) = (aln.ystart.max(1) - 1, aln.yend.max(1));
            let overlaps = out.iter().any(|h| {
                let (a0, a1) = (h.s_off + h.aln.ystart.max(1) - 1, h.s_off + h.aln.yend.max(1));
                let (b0, b1) = (s0 + ys, s0 + ye);
                let (c0, c1) = (h.q_off + h.aln.xstart.max(1) - 1, h.q_off + h.aln.xend.max(1));
                let (d0, d1) = (q0 + aln.xstart.max(1) - 1, q0 + aln.xend.max(1));
                b0 < a1 && a0 < b1 && d0 < c1 && c0 < d1
            });
            let ye = ye.min(subj.len());
            for x in subj[ys.min(ye)..ye].iter_mut() {
                *x = mask;
            }
            if !overlaps {
                out.push(Hsp { aln, q_off: q0, s_off: s0 });
            }
        }
    }
    out.sort_by(|a, b| b.aln.score.cmp(&a.aln.score));
    out
}

/// The warning on every hit of a query whose first FASTA header has non-blank text before it.
const TEXT_BEFORE_HEADER_IGNORED: &str = "Text before the first FASTA header was ignored.";

/// What `read_blast_query` trims from both ends of a line: Unicode whitespace
/// (`char::is_whitespace`: space, tab, no-break space and the rest) and U+FEFF, the byte-order mark.
fn is_query_blank(c: char) -> bool {
    c.is_whitespace() || c == '\u{feff}'
}

/// The letters a BLAST search reads from a pasted query, and the warnings owed for the text it does
/// not read (BG-01M6QHDJ). `prog` and `unit` name the program and its unit in the warnings.
///
/// Lines end at `\n`, `\r\n` or a lone `\r`, and each is trimmed of `is_query_blank` characters at
/// both ends. A line that then starts with `;` is a comment and is dropped; one that starts with `>`
/// is a FASTA header, which is never residues. If the text holds a header, the query is the lines of
/// the first record only, from its header to the next header or the end. Any other line before that
/// header is ignored, and a non-blank one draws the warning `TEXT_BEFORE_HEADER_IGNORED`; a query of
/// more than one record warns that only the first was searched, with that record's length. An empty
/// first record is read as empty: the next record is never read in its place. With no header every
/// line but the comments is the query, and this reading warns of nothing. The letters are the ASCII
/// letters of the lines read, uppercased (`clean_alpha_sequence`).
fn read_blast_query(raw: &str, prog: &str, unit: &str) -> (String, Vec<String>) {
    let (mut headers, mut text_before_header) = (0usize, false);
    let (mut unheaded, mut first) = (String::new(), String::new());
    for line in raw.split(['\n', '\r']) {
        let t = line.trim_matches(is_query_blank);
        if t.starts_with(';') {
            continue;
        }
        if t.starts_with('>') {
            headers += 1;
            continue;
        }
        match headers {
            0 => {
                text_before_header |= !t.is_empty();
                unheaded.push_str(t);
            }
            1 => first.push_str(t),
            _ => {}
        }
    }
    if headers == 0 {
        return (clean_alpha_sequence(&unheaded), Vec::new());
    }
    let query = clean_alpha_sequence(&first);
    let mut warnings = Vec::new();
    if headers > 1 {
        warnings.push(format!(
            "Query holds {headers} FASTA records: {prog} searched only the first ({} {unit}); query coordinates and coverage are against that record.",
            query.len()
        ));
    }
    if text_before_header {
        warnings.push(TEXT_BEFORE_HEADER_IGNORED.to_string());
    }
    (query, warnings)
}

/// Seed-and-extend local BLAST search: `blastn` (both strands), `blastp`, `blastx` (query in six
/// frames), `tblastn` (subjects in six frames), with up to five HSPs per subject and Karlin–Altschul
/// statistics (blastn +2/−3, gaps 5/2: λ 0.625, K 0.41; BLOSUM62, gaps 11/1: λ 0.267, K 0.041).
/// E = m·n·2^−S′ over the whole database (no edge-effect correction), with m the searched query
/// length. The query may be FASTA, read by `read_blast_query` for every program: its header (`>`)
/// and comment (`;`) lines are never residues, text before its first header is ignored, and of
/// several records only the first is searched (joining them would align across the junctions of
/// unrelated sequences). Queries up to the query cap (10,000 letters; blastx 30,000 nt) are searched
/// in full; a longer query is searched on its first cap letters only, and query coverage stays
/// relative to the whole query (its first record). Ignored non-blank text before the first header,
/// records after the first and a cut at the cap are each named in a warning on every hit. A search
/// that finds no hit returns an empty list, which carries no warning.
pub fn run_local_blast_search(
    query_seq_raw: &str,
    all_docs: &[BlastSubjectDoc],
    program: &str,
    database_name: &str,
) -> Vec<BlastHitRecord> {
    const MAX_HSPS: usize = 5;
    let prog = match program {
        "blastp" | "blastx" | "tblastn" => program,
        _ => "blastn",
    };
    // query cap (PRD TD-05), kept; cutting the query must be reported, not silent (D0005)
    let (cap, unit) = match prog {
        "blastx" => (30_000, "nt"),
        "blastn" => (10_000, "nt"),
        _ => (10_000, "residues"),
    };
    // a FASTA header or comment line is not residues, nor is text before the first header
    // (BG-01M6QHDJ). Warnings ride on hits, so a search with no hit, here or after searching, carries
    // none: a caller that must still report what was not searched (D0005) reads the query by the
    // same rule.
    let (q_raw_clean, mut warnings) = read_blast_query(query_seq_raw, prog, unit);
    if q_raw_clean.len() < 8 {
        return Vec::new();
    }
    let q_full = q_raw_clean.len();
    let q_nt: &str = &q_raw_clean[..q_full.min(cap)];
    if q_full > cap {
        warnings.push(format!(
            "Query truncated: {prog} has a query cap of {cap} {unit}, so only query 1-{cap} of {q_full} {unit} was searched; query coverage is against all {q_full} {unit}."
        ));
    }
    let protein = prog != "blastn";
    let (lambda, karlin_k) = if protein { (0.267f64, 0.041f64) } else { (0.625f64, 0.41f64) };
    let db_residues: f64 = all_docs
        .iter()
        .map(|d| d.sequence.len().max(1) as f64 / if prog == "tblastn" { 3.0 } else { 1.0 })
        .sum::<f64>()
        .max(1000.0);
    // query "frames": (protein or nucleotide text, strand, frame offset)
    let mut q_frames: Vec<(String, i8, usize)> = Vec::new();
    match prog {
        "blastn" => {
            q_frames.push((q_nt.to_string(), 1, 0));
            q_frames.push((revcomp_dna(q_nt), -1, 0));
        }
        "blastx" => {
            let rc = revcomp_dna(q_nt);
            for f in 0..3 {
                q_frames.push((translate_frame(q_nt.as_bytes(), f), 1, f));
                q_frames.push((translate_frame(rc.as_bytes(), f), -1, f));
            }
        }
        _ => q_frames.push((q_nt.to_string(), 1, 0)),
    }
    let m_eff = match prog {
        "blastx" => (q_nt.len() / 3).max(1) as f64,
        "blastn" => q_frames[0].0.len() as f64,
        _ => q_frames[0].0.len() as f64,
    };
    // minimum raw score whose E-value can be ≤ 10
    let min_bits = ((m_eff * db_residues) / 10.0).log2();
    let min_score = ((min_bits * std::f64::consts::LN_2 + karlin_k.ln()) / lambda).floor() as i32;
    let fmt_e = |e: f64| if e < 1e-180 { "0.0".to_string() } else if e >= 0.01 { format!("{e:.2}") } else { format!("{e:.1e}") };
    // coverage is against the whole query (blastx: in codons), not the searched prefix `m_eff`
    let cov_len = (if prog == "blastx" { q_full / 3 } else { q_full }).max(1) as f64;

    let mut hits: Vec<BlastHitRecord> = Vec::new();
    for doc in all_docs {
        let subj_raw = clean_alpha_sequence(&doc.sequence);
        if subj_raw.len() < 8 {
            continue;
        }
        let s_frames: Vec<(String, i8, usize)> = if prog == "tblastn" {
            let rc = revcomp_dna(&subj_raw);
            (0..3).flat_map(|f| [(translate_frame(subj_raw.as_bytes(), f), 1i8, f), (translate_frame(rc.as_bytes(), f), -1i8, f)]).collect()
        } else {
            vec![(subj_raw.clone(), 1, 0)]
        };
        let (q_len_nt, s_len_nt) = (q_nt.len(), subj_raw.len());
        let mut found: Vec<(Hsp, i8, usize, i8, usize, usize)> = Vec::new(); // hsp, q strand, q frame, s strand, s frame, query text len
        for (qt, qstrand, qf) in &q_frames {
            for (st, sstrand, sf) in &s_frames {
                for h in find_hsps(qt, st, protein, MAX_HSPS, min_score) {
                    found.push((h, *qstrand, *qf, *sstrand, *sf, qt.len()));
                }
            }
        }
        found.sort_by(|a, b| b.0.aln.score.cmp(&a.0.aln.score));
        found.truncate(MAX_HSPS);
        let organism = if doc.organism.trim().is_empty() { "-" } else { doc.organism.trim() };
        let desc_snippet: String = doc.description.chars().take(95).collect();
        for (k, (h, qstrand, qf, sstrand, sf, qtext_len)) in found.into_iter().enumerate() {
            let aln = &h.aln;
            let raw_s = aln.score as f64;
            let bit_score = (((lambda * raw_s - karlin_k.ln()) / std::f64::consts::LN_2) * 10.0).round() / 10.0;
            let e_val = m_eff * db_residues * 2.0f64.powf(-bit_score);
            if e_val > 10.0 {
                continue;
            }
            // 1-based inclusive coordinates in the searched text
            let (qa, qb) = (h.q_off + aln.xstart.max(1), h.q_off + aln.xend.max(1));
            let (sa, sb) = (h.s_off + aln.ystart.max(1), h.s_off + aln.yend.max(1));
            // query / subject coordinates on the forward nucleotide (or protein) sequence
            let to_nt = |a: usize, b: usize, strand: i8, f: usize, len_nt: usize, translated: bool| -> (usize, usize) {
                let (x, y) = if translated { (f + 3 * (a - 1) + 1, f + 3 * b) } else { (a, b) };
                if strand < 0 { (len_nt - x + 1, len_nt - y + 1) } else { (x, y) }
            };
            let (q_start, q_end) = to_nt(qa, qb, qstrand, qf, if prog == "blastx" { q_len_nt } else { qtext_len }, prog == "blastx");
            let (s_start, s_end) = to_nt(sa, sb, sstrand, sf, s_len_nt, prog == "tblastn");
            // blastn minus strand: report the query ascending and the subject descending
            let (q_start, q_end, s_start, s_end, aq, am, as_) = if prog == "blastn" && qstrand < 0 {
                (q_end, q_start, s_end, s_start, revcomp_dna(&aln.aligned_seq1), aln.midline.chars().rev().collect::<String>(), revcomp_dna(&aln.aligned_seq2))
            } else {
                (q_start, q_end, s_start, s_end, aln.aligned_seq1.clone(), aln.midline.clone(), aln.aligned_seq2.clone())
            };
            let ungap_q = aln.aligned_seq1.bytes().filter(|&b| b != b'-').count();
            let q_cov = (((ungap_q as f64 / cov_len) * 100.0).min(100.0) * 10.0).round() / 10.0;
            let frame_note = match prog {
                "blastn" if qstrand < 0 => " (minus strand)".to_string(),
                "blastx" => format!(" (query frame {}{})", if qstrand < 0 { '-' } else { '+' }, qf + 1),
                "tblastn" => format!(" (subject frame {}{})", if sstrand < 0 { '-' } else { '+' }, sf + 1),
                _ => String::new(),
            };
            hits.push(BlastHitRecord {
                id: if k == 0 { format!("blast-hit-{}", doc.id) } else { format!("blast-hit-{}~hsp{}", doc.id, k + 1) },
                accession: if doc.accession.is_empty() { doc.name.chars().take(40).collect() } else { doc.accession.clone() },
                description: format!("{} — {} [{}]{}{}", doc.name, desc_snippet, database_name, frame_note, if k > 0 { format!(" HSP {}", k + 1) } else { String::new() }),
                organism: organism.to_string(),
                program: prog.to_string(),
                query_coverage_pct: q_cov,
                identity_pct: aln.identity_pct,
                e_value: fmt_e(e_val),
                bit_score,
                align_length: aln.aligned_seq1.len(),
                query_start: q_start,
                query_end: q_end,
                subject_start: s_start,
                subject_end: s_end,
                aligned_query: aq.chars().take(120).collect(),
                aligned_midline: am.chars().take(120).collect(),
                aligned_subject: as_.chars().take(120).collect(),
                warnings: warnings.clone(),
            });
        }
    }
    hits.sort_by(|a, b| b.bit_score.partial_cmp(&a.bit_score).unwrap_or(std::cmp::Ordering::Equal));
    hits
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TaxonomicClassificationHit {
    pub rank: usize,
    pub lineage: String,
    pub taxon_name: String,
    pub marker_class: String,
    pub confidence_pct: f64,
    pub matched_signatures: Vec<String>,
}

struct TaxonSignatureEntry {
    taxon_name: &'static str,
    lineage: &'static str,
    marker_class: &'static str,
    motifs: &'static [&'static str],
}

const TAXONOMIC_SIGNATURE_DB: &[TaxonSignatureEntry] = &[
    TaxonSignatureEntry {
        taxon_name: "Escherichia coli / ColE1 Enterobacterial Replicon",
        lineage: "Bacteria > Pseudomonadota > Gammaproteobacteria > Enterobacterales > Enterobacteriaceae > Escherichia",
        marker_class: "Prokaryotic / Bacterial Replicon & 16S Signature",
        motifs: &[
            "TAATACGACTCACTATAG",
            "GGAATTGTGAGCGGATAACAA",
            "CCGTAGTTAGGCCACCACTT",
            "CTGCTGCCAGTGGCGATAAG",
        ],
    },
    TaxonSignatureEntry {
        taxon_name: "Bacteriophage T7 / Studier Expression System",
        lineage: "Viruses > Duplodnaviria > Heunggongvirae > Uroviricota > Autographiviridae > Teseptimavirus",
        marker_class: "Phage T7 Promoter / Terminator Signature",
        motifs: &[
            "TAATACGACTCACTATAGGG",
            "CTAGCATAACCCCTTGGGGCCTCTAAACGGGTCTTGAGGGGTTTTTTG",
        ],
    },
    TaxonSignatureEntry {
        taxon_name: "Aequorea victoria / Engineered Fluorescent Reporter Lineage",
        lineage: "Eukaryota > Metazoa > Cnidaria > Hydrozoa > Hydroidolina > Aequoreidae > Aequorea",
        marker_class: "Cnidarian Chromophore Barrel Coding Signature",
        motifs: &[
            "ATGGTGAGCAAGGGCGAGGAG",
            "CTGACCTACGGCGTGCAGTGC",
            "ACCCTGAAGTTCATCTGCACC",
        ],
    },
    TaxonSignatureEntry {
        taxon_name: "Bacillus / Firmicutes 16S rRNA V3-V4 Ribosomal Conserved Box",
        lineage: "Bacteria > Bacillota > Bacilli > Bacillales > Bacillaceae > Bacillus",
        marker_class: "16S rRNA Ribosomal Amplicon",
        motifs: &[
            "ACTCCTACGGGAGGCAGCAG",
            "GTGCCAGCAGCCGCGGTAAT",
            "GGATTAGATACCCTGGTAGTC",
        ],
    },
    TaxonSignatureEntry {
        taxon_name: "Saccharomyces / Ascomycota ITS1-5.8S-ITS2 Ribosomal Cluster",
        lineage: "Eukaryota > Fungi > Dikarya > Ascomycota > Saccharomycotina > Saccharomycetes > Saccharomyces",
        marker_class: "Fungal Nuclear ITS Ribosomal Marker",
        motifs: &[
            "TCCGTAGGTGAACCTGCGG",
            "GCATCGATGAAGAACGCAGC",
            "TCCTCCGCTTATTGATATGC",
        ],
    },
    TaxonSignatureEntry {
        taxon_name: "Mammalian / Human CMV-EF1α Expression Cassette Context",
        lineage: "Eukaryota > Metazoa > Chordata > Mammalia > Primates > Hominidae > Homo",
        marker_class: "Mammalian Regulatory / Coding Context",
        motifs: &[
            "CATTGACGTCAATAATGACGTATGTTCCCATAGTAACGCCAATAG",
            "AATAAAAGATCTTTATTTTCATTAGATCTGTGTGTTGGTTTTTTGTGTG",
        ],
    },
];

/// Fast Aho-Corasick + 8-mer signature taxonomic marker classifier (16S / 18S / ITS / Replicon).
pub fn classify_sequence_taxonomy(raw_seq: &str) -> Vec<TaxonomicClassificationHit> {
    let seq = clean_sequence(raw_seq);
    let rc = reverse_complement_iupac(&seq, false);
    let gc_count = seq
        .as_bytes()
        .iter()
        .filter(|&&b| b == b'G' || b == b'C')
        .count();
    let gc_pct = if seq.is_empty() {
        50.0
    } else {
        (gc_count as f64 / seq.len() as f64) * 100.0
    };

    let mut scored: Vec<(&TaxonSignatureEntry, Vec<String>, f64)> = TAXONOMIC_SIGNATURE_DB
        .iter()
        .map(|entry| {
            let mut matched = Vec::new();
            let mut score = 34.0f64;

            let full_sub: Vec<String> = entry
                .motifs
                .iter()
                .map(|m| {
                    let s: String = m
                        .chars()
                        .filter(|c| matches!(c, 'A' | 'C' | 'G' | 'T'))
                        .take(14)
                        .collect();
                    s
                })
                .filter(|s| s.len() >= 8)
                .collect();

            if let Ok(ac) = AhoCorasick::new(&full_sub) {
                for m in ac.find_iter(&seq).chain(ac.find_iter(&rc)) {
                    let pat = &full_sub[m.pattern().as_usize()];
                    if !matched.contains(pat) {
                        matched.push(pat.clone());
                        score += 24.0;
                    }
                }
            }

            if matched.is_empty() {
                for sub in &full_sub {
                    let mut k = 0usize;
                    while k + 8 <= sub.len() {
                        let oct = &sub[k..k + 8];
                        if seq.contains(oct) || rc.contains(oct) {
                            matched.push(oct.to_string());
                            score += 7.0;
                            break;
                        }
                        k += 3;
                    }
                }
            }

            if gc_pct >= 50.0 && entry.lineage.contains("Bacteria") {
                score += 4.0;
            }
            (entry, matched, (score * 10.0).round().min(996.0) / 10.0)
        })
        .collect();

    // An entry without a single matched marker signature is not evidence of
    // that taxon: it only carried the 34-point base score, yet the top four
    // were always reported as classifications.
    scored.retain(|(_, matched, _)| !matched.is_empty());
    scored.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));

    scored
        .into_iter()
        .take(4)
        .enumerate()
        .map(|(idx, (entry, matched, conf))| TaxonomicClassificationHit {
            rank: idx + 1,
            lineage: entry.lineage.to_string(),
            taxon_name: entry.taxon_name.to_string(),
            marker_class: entry.marker_class.to_string(),
            confidence_pct: conf,
            matched_signatures: matched,
        })
        .collect()
}

#[cfg(test)]
mod seeded_blastn_tests {
    use super::*;

    fn random_dna(n: usize, seed: u64) -> String {
        let mut x = seed;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGT"[(x % 4) as usize] as char
            })
            .collect()
    }

    fn doc(id: &str, seq: String) -> BlastSubjectDoc {
        BlastSubjectDoc { id: id.into(), name: id.into(), accession: String::new(), description: String::new(), sequence: seq, organism: String::new() }
    }

    /// A query up to the program's cap (blastn 10,000 nt, blastx 30,000 nt) is searched in full;
    /// past the cap only its first cap letters are searched, coverage stays against the whole query
    /// and every hit says so. Expected coordinates are where the query was cut from the subject.
    #[test]
    fn long_query_is_searched_in_full() {
        let subject = random_dna(5000, 3);
        let query = subject[1000..3500].to_string(); // 2,500 bases, far beyond the old 640 cap
        let hits = run_local_blast_search(&query, &[doc("s", subject)], "blastn", "db");
        let h = &hits[0];
        assert_eq!((h.query_start, h.query_end), (1, 2500), "{h:?}");
        assert_eq!((h.subject_start, h.subject_end), (1001, 3500));
        assert!((h.query_coverage_pct - 100.0).abs() < 1e-9);
        assert!((h.identity_pct - 100.0).abs() < 1e-9);
        assert!(h.warnings.is_empty(), "{:?}", h.warnings);

        // blastn at its cap: all 10,000 nt are searched and nothing warns
        let subject = random_dna(14_000, 4);
        let at_cap = &run_local_blast_search(&subject[2000..12_000], &[doc("s", subject.clone())], "blastn", "db")[0];
        assert_eq!((at_cap.query_start, at_cap.query_end, at_cap.subject_start, at_cap.subject_end), (1, 10_000, 2001, 12_000), "{at_cap:?}");
        assert!((at_cap.query_coverage_pct - 100.0).abs() < 1e-9, "{}", at_cap.query_coverage_pct);
        assert!(at_cap.warnings.is_empty(), "{:?}", at_cap.warnings);
        // 12,000 nt, past the cap: query 1-10,000 is searched, coverage 10,000 / 12,000 = 83.3 %
        let over = run_local_blast_search(&subject[2000..14_000], &[doc("s", subject.clone())], "blastn", "db");
        assert_eq!((over[0].query_start, over[0].query_end, over[0].subject_start, over[0].subject_end), (1, 10_000, 2001, 12_000), "{:?}", over[0]);
        assert!((over[0].query_coverage_pct - 83.3).abs() < 1e-9, "{}", over[0].query_coverage_pct);
        for h in &over {
            assert!(h.warnings.len() == 1 && h.warnings[0].contains("query cap of 10000 nt") && h.warnings[0].contains("1-10000 of 12000 nt"), "{:?}", h.warnings);
        }

        // blastx at its cap: a 30,000-nt query (10,000 codons, stop-free in frame +1) is searched in
        // full against the 10,000-residue protein it encodes; at 33,000 nt only 1-30,000 is searched
        // and coverage is 10,000 of 11,000 codons = 90.9 %
        // random protein: residue i from the base pair (2i, 2i + 1) of random DNA, one stop-free codon each
        const CODONS: [(char, &str); 16] = [
            ('A', "GCT"), ('C', "TGT"), ('D', "GAT"), ('E', "GAA"), ('F', "TTT"), ('G', "GGT"), ('H', "CAT"), ('I', "ATT"),
            ('K', "AAA"), ('L', "CTG"), ('M', "ATG"), ('N', "AAT"), ('P', "CCG"), ('Q', "CAG"), ('R', "CGT"), ('W', "TGG"),
        ];
        let base = |b: u8| b"ACGT".iter().position(|&x| x == b).unwrap();
        let picks: Vec<usize> = random_dna(22_000, 5).as_bytes().chunks(2).map(|p| 4 * base(p[0]) + base(p[1])).collect();
        let protein: String = picks.iter().map(|&i| CODONS[i].0).collect();
        let codons: String = picks.iter().map(|&i| CODONS[i].1).collect();
        let target = [doc("p", protein[..10_000].to_string())];
        let hx = &run_local_blast_search(&codons[..30_000], &target, "blastx", "db")[0];
        assert_eq!((hx.query_start, hx.query_end, hx.subject_start, hx.subject_end), (1, 30_000, 1, 10_000), "{hx:?}");
        assert!((hx.query_coverage_pct - 100.0).abs() < 1e-9 && hx.warnings.is_empty(), "{hx:?}");
        let ox = &run_local_blast_search(&codons[..33_000], &target, "blastx", "db")[0];
        assert_eq!((ox.query_start, ox.query_end, ox.subject_start, ox.subject_end), (1, 30_000, 1, 10_000), "{ox:?}");
        assert!((ox.query_coverage_pct - 90.9).abs() < 1e-9, "{}", ox.query_coverage_pct);
        assert!(ox.warnings.len() == 1 && ox.warnings[0].contains("query cap of 30000 nt") && ox.warnings[0].contains("1-30000 of 33000 nt"), "{:?}", ox.warnings);
    }

    /// D0005: one letter past a program's query cap (blastn, blastp and tblastn 10,000 letters,
    /// blastx 30,000 nt), every hit of every subject carries the warning naming that program's cap,
    /// the searched span and the whole length, in its JSON too; a blastn or blastp query at the cap
    /// draws no warning.
    #[test]
    fn query_cap_is_reported_as_a_warning() {
        // one stop-free codon per letter, so a protein and its back-translation share coordinates
        const CODONS: [(u8, &str); 16] = [
            (b'A', "GCT"), (b'C', "TGT"), (b'D', "GAT"), (b'E', "GAA"), (b'F', "TTT"), (b'G', "GGT"), (b'H', "CAT"), (b'I', "ATT"),
            (b'K', "AAA"), (b'L', "CTG"), (b'M', "ATG"), (b'N', "AAT"), (b'P', "CCG"), (b'Q', "CAG"), (b'R', "CGT"), (b'W', "TGG"),
        ];
        let protein = |n: usize, seed: u64| -> String { random_dna(2 * n, seed).as_bytes().chunks(2).map(|p| CODONS[4 * (p[0] % 4) as usize + (p[1] % 4) as usize].0 as char).collect() };
        let back = |p: &str| -> String { p.bytes().map(|aa| CODONS.iter().find(|c| c.0 == aa).unwrap().1).collect() };
        let warning = |prog: &str, cap: usize, unit: &str| {
            format!("Query truncated: {prog} has a query cap of {cap} {unit}, so only query 1-{cap} of {} {unit} was searched; query coverage is against all {} {unit}.", cap + 1, cap + 1)
        };

        // blastn: two subjects that each hold part of the query's first 1,000 nt
        let dna = random_dna(3000, 41);
        let other = format!("{}{}{}", random_dna(700, 42), &dna[600..1000], random_dna(700, 43));
        let nt_query = format!("{}{}", &dna[500..1500], random_dna(9001, 44));
        // the protein programs: a 300-residue subject that holds the query's first 200 residues
        let prot = protein(300, 45);
        let aa_query = format!("{}{}", &prot[50..250], protein(9801, 46));
        let blastx_query = format!("{}{}", back(&prot[50..250]), random_dna(29_401, 47));
        let cases = [
            ("blastn", nt_query, vec![doc("s1", dna.clone()), doc("s2", other)], 10_000, "nt"),
            ("blastp", aa_query.clone(), vec![doc("p", prot.clone())], 10_000, "residues"),
            ("tblastn", aa_query, vec![doc("p", back(&prot))], 10_000, "residues"),
            ("blastx", blastx_query, vec![doc("p", prot.clone())], 30_000, "nt"),
        ];
        for (program, query, subjects, cap, unit) in &cases {
            assert_eq!(query.len(), cap + 1, "fixture: {program}");
            let expected = warning(program, *cap, unit);
            let over = run_local_blast_search(query, subjects, program, "db");
            assert!(over.iter().any(|h| h.query_start == 1), "fixture: {program} finds the planted match: {over:?}");
            for h in &over {
                assert_eq!(h.warnings, [expected.as_str()], "{program}: {h:?}");
                assert_eq!(serde_json::to_value(h).unwrap()["warnings"], serde_json::json!([expected]), "{program}");
            }
        }
        // at the cap nothing warns; the cut is one test for every program, so the two cheap ones
        // are searched at it (a 30,000-nt blastx or 10,000-residue tblastn search takes seconds)
        for (program, query, subjects, cap, _) in &cases[..2] {
            let at_cap = run_local_blast_search(&query[..*cap], subjects, program, "db");
            assert!(!at_cap.is_empty(), "fixture: {program} at the cap");
            assert!(at_cap.iter().all(|h| h.warnings.is_empty()), "{program}: {at_cap:?}");
        }
        // every subject's hits are warned, not only the best hit's: blastn hits both subjects
        let over = run_local_blast_search(&cases[0].1, &cases[0].2, "blastn", "db");
        for id in ["blast-hit-s1", "blast-hit-s2"] {
            assert!(over.iter().any(|h| h.id == id && h.warnings.len() == 1), "{id}: {over:?}");
        }
    }

    #[test]
    fn minus_strand_hits_are_found_and_reported_blast_style() {
        let subject = random_dna(3000, 9);
        let query = revcomp_dna(&subject[500..1700]);
        let hits = run_local_blast_search(&query, &[doc("s", subject)], "blastn", "db");
        let h = &hits[0];
        assert_eq!((h.query_start, h.query_end), (1, 1200), "{h:?}");
        // subject descending on the minus strand
        assert_eq!((h.subject_start, h.subject_end), (1700, 501));
        assert!(h.description.contains("minus strand"));
        // the aligned query preview is in query orientation
        assert_eq!(h.aligned_query, query[..120].to_string());
    }

    #[test]
    fn partial_coverage_is_relative_to_the_whole_query() {
        let subject = random_dna(2000, 5);
        let query = format!("{}{}", &subject[100..700], random_dna(600, 77));
        let hits = run_local_blast_search(&query, &[doc("s", subject)], "blastn", "db");
        let h = &hits[0];
        assert!(h.query_end <= 615 && h.query_end >= 595, "{h:?}");
        assert!((h.query_coverage_pct - 50.0).abs() < 2.0, "{}", h.query_coverage_pct);
    }

    #[test]
    fn tblastn_and_blastx_report_nucleotide_coordinates_on_minus_frames() {
        // a 40-codon ORF (ATG…), reverse-complemented into random DNA at 1-based 801..920;
        // the flanks contain stop codons in every frame, which must not shift coordinates
        let cds = "ATGAGCATTCAGCATTTTCGCGTGGCGCTGATTCCGTTTTTTGCGGCGTTTTGCCTGCCGGTGTTTGCGCATCCGGAAACCCTGGTGAAAGTGAAAGATGCGGAAGATCAGCTGGGC";
        let protein = "MSIQHFRVALIPFFAAFCLPVFAHPETLVKVKDAEDQLG";
        let left = random_dna(800, 21).replace("ATG", "TAA");
        let subject = format!("{left}{}{}", revcomp_dna(cds), random_dna(600, 22));
        let hits = run_local_blast_search(protein, &[doc("s", subject.clone())], "tblastn", "db");
        let h = &hits[0];
        assert_eq!((h.query_start, h.query_end), (1, 39), "{h:?}");
        assert_eq!((h.subject_start, h.subject_end), (800 + 117, 801), "{h:?}");
        assert!(h.description.contains("frame -"), "{}", h.description);
        // blastx: the same region as the query against the protein
        let q = &subject[700..1000];
        let hx = &run_local_blast_search(q, &[doc("p", protein.to_string())], "blastx", "db")[0];
        assert_eq!((hx.query_start, hx.query_end), (217, 101), "{hx:?}");
        assert_eq!((hx.subject_start, hx.subject_end), (1, 39));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn random_text(n: usize, seed: u64, alphabet: &[u8]) -> String {
        let mut x = seed;
        (0..n)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                alphabet[(x % alphabet.len() as u64) as usize] as char
            })
            .collect()
    }

    fn subject(seq: String) -> BlastSubjectDoc {
        BlastSubjectDoc { id: "s".into(), name: "s".into(), accession: String::new(), description: String::new(), sequence: seq, organism: String::new() }
    }

    /// One stop-free codon per amino acid, as `translate_frame` reads them back.
    fn back_translate(protein: &str) -> String {
        protein
            .chars()
            .map(|aa| match aa {
                'A' => "GCT", 'C' => "TGT", 'D' => "GAT", 'E' => "GAA", 'F' => "TTT",
                'G' => "GGT", 'H' => "CAT", 'I' => "ATT", 'K' => "AAA", 'L' => "CTG",
                'M' => "ATG", 'N' => "AAT", 'P' => "CCG", 'Q' => "CAG", 'R' => "CGT",
                'S' => "TCT", 'T' => "ACC", 'V' => "GTG", 'W' => "TGG", 'Y' => "TAT",
                other => panic!("no codon for {other}"),
            })
            .collect()
    }

    /// `query` is longer than `program`'s cap of `cap` `unit`, and its first `cap` letters match
    /// `subj` exactly at `subject_span`. The over-cap search must report the same hit as a search of
    /// those first `cap` letters alone, except for its coverage (against the whole query) and a
    /// warning naming the cap, the searched span and the whole length; the at-cap search must not warn.
    #[allow(clippy::too_many_arguments)]
    fn check_truncation(program: &str, query: &str, subj: &BlastSubjectDoc, cap: usize, unit: &str, query_span: (usize, usize), subject_span: (usize, usize), coverage: f64) {
        let over = run_local_blast_search(query, std::slice::from_ref(subj), program, "db");
        let at_cap = run_local_blast_search(&query[..cap], std::slice::from_ref(subj), program, "db");
        let (o, c) = (&over[0], &at_cap[0]);
        // the cap is kept: the over-cap query searches exactly its first `cap` letters
        for h in [o, c] {
            assert_eq!((h.query_start, h.query_end), query_span, "{program}: {h:?}");
            assert_eq!((h.subject_start, h.subject_end), subject_span, "{program}: {h:?}");
        }
        assert_eq!((o.bit_score, &o.e_value, o.identity_pct, o.align_length), (c.bit_score, &c.e_value, c.identity_pct, c.align_length), "{program}");
        // coverage is against the whole query, not the searched prefix
        assert!((o.query_coverage_pct - coverage).abs() < 1e-9, "{program}: coverage {} != {coverage}", o.query_coverage_pct);
        assert!((c.query_coverage_pct - 100.0).abs() < 1e-9, "{program}: at-cap coverage {}", c.query_coverage_pct);
        // every hit of the truncated query warns, naming the cap, the searched span and the whole length
        for h in &over {
            assert_eq!(h.warnings.len(), 1, "{program}: {h:?}");
            let w = &h.warnings[0];
            for needle in [program.to_string(), format!("query cap of {cap} {unit}"), format!("1-{cap} of {} {unit}", query.len()), format!("all {} {unit}", query.len())] {
                assert!(w.contains(&needle), "{program}: warning {w:?} lacks {needle:?}");
            }
        }
        // the warning crosses the JSON boundary that the WASM, IPC and REST transports serialise through
        let json = serde_json::to_value(o).unwrap();
        assert_eq!(json["warnings"][0].as_str(), Some(o.warnings[0].as_str()), "{program}: {json}");
        // a query within the cap: no warning, and the hit's JSON is unchanged (no warnings key)
        for h in &at_cap {
            assert!(h.warnings.is_empty(), "{program}: {h:?}");
            assert!(serde_json::to_value(h).unwrap().get("warnings").is_none(), "{program}: {h:?}");
        }
    }

    #[test]
    fn truncated_query_reports_true_coverage_and_warns() {
        // blastn: a 12,000-nt query cut from a 20,000-nt subject is searched to 10,000 nt -> 83.3 %
        let dna = random_text(20_000, 0x5eed_b1a5, b"ACGT");
        check_truncation("blastn", &dna[4000..16_000], &subject(dna.clone()), 10_000, "nt", (1, 10_000), (4001, 14_000), 83.3);
        // one letter past the cap still warns, though its coverage (10000/10001) rounds to 100.0
        let one_over = run_local_blast_search(&dna[4000..14_001], &[subject(dna.clone())], "blastn", "db");
        assert!((one_over[0].query_coverage_pct - 100.0).abs() < 1e-9, "{:?}", one_over[0]);
        assert!(one_over[0].warnings.first().is_some_and(|w| w.contains("1-10000 of 10001 nt")), "{:?}", one_over[0].warnings);
        // the E-value keeps the searched length as m: a 40-nt match, whose E-value does not underflow
        // to 0.0, gets the same E-value over the cap as at it
        let noise = random_text(12_000, 0x0dd_ba11, b"ACGT");
        let short = format!("{}{}{}", &noise[..5000], &dna[1000..1040], &noise[5040..]);
        let small = [subject(dna[..2000].to_string())];
        let (o, c) = (&run_local_blast_search(&short, &small, "blastn", "db")[0], &run_local_blast_search(&short[..10_000], &small, "blastn", "db")[0]);
        assert_ne!(o.e_value, "0.0", "{o:?}");
        assert_eq!((o.query_start, o.query_end, &o.e_value), (c.query_start, c.query_end, &c.e_value), "{o:?} / {c:?}");
        // blastp shares the 10,000-residue cap: 12,000 residues of a 12,500-residue subject
        let prot = random_text(12_500, 0x0b1a_57e9, b"ACDEFGHIKLMNPQRSTVWY");
        check_truncation("blastp", &prot[500..], &subject(prot.clone()), 10_000, "residues", (1, 10_000), (501, 10_500), 83.3);
        // tblastn caps its protein query at 10,000 residues, not blastx's 30,000 nt, and counts
        // coverage in residues: the same 12,000 residues against the protein's 37,500-nt back-translation
        check_truncation("tblastn", &prot[500..], &subject(back_translate(&prot)), 10_000, "residues", (1, 10_000), (1501, 31_500), 83.3);
        // blastx: 36,000 nt (12,000 codons) cut to 30,000 nt -> 10,000 of 12,000 codons aligned; the
        // subject is kept small because each search seeds 30,000 nt in all six frames against it
        let query_nt = back_translate(&prot[500..]);
        check_truncation("blastx", &query_nt, &subject(prot), 30_000, "nt", (1, 30_000), (501, 10_500), 83.3);

        // blastx counts whole codons: a 602-nt query holds 200 (its last 2 nt are no codon), so 100
        // aligned codons are 50.0 percent of it, not 100 of 201 (49.8)
        let target = random_text(100, 0x7a26_e7, b"ACDEFGHIKLMNPQRSTVWY");
        let codons = format!("{}{}", back_translate(&target), random_text(302, 0x7a11, b"ACGT"));
        let hx = &run_local_blast_search(&codons, &[subject(target.clone())], "blastx", "db")[0];
        assert_eq!((hx.query_start, hx.query_end, hx.subject_start, hx.subject_end), (1, 300, 1, 100), "{hx:?}");
        assert!((hx.query_coverage_pct - 50.0).abs() < 1e-9, "{hx:?}");
        assert!(hx.warnings.is_empty(), "{hx:?}");

        // the protein programs keep the searched length as m too: a 30-residue match planted at query
        // 5001-5030 (blastx: nt 15001-15090), whose E-value does not underflow to 0.0, gets the same
        // E-value over the cap as at it; the subjects are 100 residues (300 nt) to keep the searches cheap
        let pnoise = random_text(12_000, 0x0dd_5eed, b"ACDEFGHIKLMNPQRSTVWY");
        let pquery = format!("{}{}{}", &pnoise[..5000], &target[30..60], &pnoise[5030..]);
        let xnoise = random_text(36_000, 0x0dd_c0d0, b"ACGT");
        let xquery = format!("{}{}{}", &xnoise[..15_000], back_translate(&target[30..60]), &xnoise[15_090..]);
        for (program, query, cap, subj, plant) in [
            ("blastp", &pquery, 10_000, subject(target.clone()), (5001, 5030)),
            ("blastx", &xquery, 30_000, subject(target.clone()), (15_001, 15_090)),
            ("tblastn", &pquery, 10_000, subject(back_translate(&target)), (5001, 5030)),
        ] {
            let over = run_local_blast_search(query, std::slice::from_ref(&subj), program, "db");
            let at_cap = run_local_blast_search(&query[..cap], std::slice::from_ref(&subj), program, "db");
            let (o, c) = (&over[0], &at_cap[0]);
            assert!(o.query_start <= plant.0 && o.query_end >= plant.1, "{program}: not the planted match: {o:?}");
            assert_ne!(o.e_value, "0.0", "{program}: {o:?}");
            assert_eq!((o.query_start, o.query_end, o.subject_start, o.subject_end, &o.e_value), (c.query_start, c.query_end, c.subject_start, c.subject_end, &c.e_value), "{program}: {o:?} / {c:?}");
            assert_eq!((o.warnings.len(), c.warnings.len()), (1, 0), "{program}: {o:?} / {c:?}");
        }

        // the cap and the coverage count the cleaned query: the 12,000-nt query wrapped at 60 columns
        // and indented (12,600 characters) is cut at 10,000 nt, reads 83.3 percent and is named 12,000 nt
        let wrap = |s: &str| -> String { s.as_bytes().chunks(60).map(|l| format!("  {}\n", std::str::from_utf8(l).unwrap())).collect() };
        let hw = &run_local_blast_search(&wrap(&dna[4000..16_000]), &[subject(dna.clone())], "blastn", "db")[0];
        assert_eq!((hw.query_start, hw.query_end, hw.subject_start, hw.subject_end), (1, 10_000, 4001, 14_000), "{hw:?}");
        assert!((hw.query_coverage_pct - 83.3).abs() < 1e-9, "{hw:?}");
        assert_eq!(hw.warnings, ["Query truncated: blastn has a query cap of 10000 nt, so only query 1-10000 of 12000 nt was searched; query coverage is against all 12000 nt."], "{hw:?}");
        // and the same query wrapped at the cap (10,000 nt in 10,501 characters) is not cut at all
        let hw = &run_local_blast_search(&wrap(&dna[4000..14_000]), &[subject(dna.clone())], "blastn", "db")[0];
        assert_eq!((hw.query_start, hw.query_end, hw.subject_start, hw.subject_end), (1, 10_000, 4001, 14_000), "{hw:?}");
        assert!((hw.query_coverage_pct - 100.0).abs() < 1e-9 && hw.warnings.is_empty(), "{hw:?}");
    }

    /// BG-01M6QHDJ: the BLAST window takes "FASTA or raw residues", so a pasted query can carry its
    /// FASTA header, `;` comment lines and text before the header. None of it is residues: a
    /// header-bearing query gives exactly the hits of its record alone, text before the first header
    /// is ignored and every hit says so, and a query of several records searches the first and every
    /// hit says so. A search with no hit returns no hit, and no other record in its place.
    #[test]
    fn fasta_header_lines_are_not_query_residues() {
        const HEADER: &str = ">sp|P42212|GFP_AEQVI Green fluorescent protein";
        // the warnings pinned verbatim, for the BLAST window's TypeScript to copy for a search with
        // no hit (BG-01M6Q0VH)
        const IGNORED: &str = "Text before the first FASTA header was ignored.";
        let records = |n: usize, prog: &str, len: usize, unit: &str| {
            format!("Query holds {n} FASTA records: {prog} searched only the first ({len} {unit}); query coordinates and coverage are against that record.")
        };
        // 60-column lines, as a FASTA file holds them
        let lines = |s: &str| -> String { s.as_bytes().chunks(60).map(|l| format!("{}\n", std::str::from_utf8(l).unwrap())).collect() };
        let json = |hits: &[BlastHitRecord]| serde_json::to_value(hits).unwrap();
        // the hits' JSON without their warnings, after checking every hit carries exactly `warnings`
        let unwarned = |hits: &[BlastHitRecord], warnings: &[&str], what: &str| {
            assert!(!hits.is_empty(), "{what}: no hit");
            for h in hits {
                assert_eq!(h.warnings, warnings, "{what}: {h:?}");
            }
            let mut v = json(hits);
            for h in v.as_array_mut().unwrap() {
                h.as_object_mut().unwrap().remove("warnings");
            }
            v
        };
        let dna = random_text(3000, 0x0fa5_7a01, b"ACGT");
        let prot = random_text(400, 0x0fa5_7a02, b"ACDEFGHIKLMNPQRSTVWY");
        // (program, the record, its subject, the record's span on the subject)
        let cases = [
            ("blastn", dna[500..1100].to_string(), subject(dna.clone()), (501, 1100)),
            ("blastp", prot[50..250].to_string(), subject(prot.clone()), (51, 250)),
            ("blastx", back_translate(&prot[50..250]), subject(prot.clone()), (51, 250)),
            ("tblastn", prot[50..250].to_string(), subject(back_translate(&prot)), (151, 750)),
        ];
        for (program, record, subj, span) in &cases {
            let bare = run_local_blast_search(record, std::slice::from_ref(subj), program, "db");
            let h = &bare[0];
            // the record alone is found whole, at full coverage and without a warning
            assert_eq!((h.query_start, h.query_end, h.subject_start, h.subject_end), (1, record.len(), span.0, span.1), "{program}: {h:?}");
            assert!((h.query_coverage_pct - 100.0).abs() < 1e-9 && h.warnings.is_empty(), "{program}: {h:?}");
            // the same record under its header, with comment lines before the header and inside the
            // residue lines, and in CRLF, CR-only and indented layouts: the same hits, coordinates,
            // scores and coverage, so the query searched is the record's own letters and nothing else
            let body = lines(record);
            let (head, tail) = body.split_at(120 + 2); // two 60-letter lines and their line breaks
            for query in [
                format!("{HEADER}\n{body}"),
                format!("; exported by a lab notebook\n{HEADER}\n{head}; a comment between residue lines\n{tail}"),
                format!("{HEADER}\n{body}").replace('\n', "\r\n"),
                format!("{HEADER}\n{body}").replace('\n', "\r"),
                format!("  {HEADER}\n{body}"),
                // the ways a paste opens: the header indented by a tab, a no-break space or an
                // ideographic space; after a blank line, a whitespace-only line or a CRLF; after a
                // UTF-8 byte-order mark, alone or before a blank line; and a header-free record whose
                // comment line is dropped. None is text before the header, so none warns.
                format!("\t{HEADER}\n{body}"),
                format!("\u{a0}{HEADER}\n{body}"),
                format!("\u{3000}{HEADER}\n{body}"),
                format!("\n{HEADER}\n{body}"),
                format!(" \t\u{a0}\n{HEADER}\n{body}"),
                format!("\n{HEADER}\n{body}").replace('\n', "\r\n"),
                format!("\u{feff}{HEADER}\n{body}"),
                format!("\u{feff}\r\n{HEADER}\r\n{body}"),
                format!("; exported by a lab notebook\n{body}"),
            ] {
                assert_eq!(json(&run_local_blast_search(&query, std::slice::from_ref(subj), program, "db")), json(&bare), "{program}: {query:?}");
            }
            // text before the first header is not the query and does not displace the record under
            // the header: a free-text label, a digits-only line, and the residue lines of another
            // sequence (the record reversed) give the record's own hits, each one saying the text
            // was ignored
            let reversed: String = record.chars().rev().collect();
            for pre in ["Here is my query".to_string(), "1".to_string(), lines(&reversed)] {
                let query = format!("{pre}\n{HEADER}\n{body}");
                let hits = run_local_blast_search(&query, std::slice::from_ref(subj), program, "db");
                assert_eq!(unwarned(&hits, &[IGNORED], &format!("{program}: {pre:?}")), json(&bare), "{program}: {query:?}");
            }
        }

        // a query holding only a header has no residues to search, even against a subject that holds
        // the header's letters
        let header_letters: String = HEADER.bytes().filter(u8::is_ascii_alphabetic).map(|b| b.to_ascii_uppercase() as char).collect();
        let holds_header = subject(format!("{}{header_letters}{}", &prot[..100], &prot[100..200]));
        assert!(!run_local_blast_search(&header_letters, std::slice::from_ref(&holds_header), "blastp", "db").is_empty(), "fixture: the header's letters are a findable protein query");
        assert!(run_local_blast_search(&format!("{HEADER}\n"), &[holds_header], "blastp", "db").is_empty());

        // the header's letters do not count toward the query cap: a 10,000-nt record under its header
        // is searched whole, at full coverage, without a truncation warning
        let long = random_text(14_000, 0x0fa5_7a03, b"ACGT");
        let at_cap = run_local_blast_search(&format!("{HEADER}\n{}", lines(&long[2000..12_000])), &[subject(long.clone())], "blastn", "db");
        let h = &at_cap[0];
        assert_eq!((h.query_start, h.query_end, h.subject_start, h.subject_end), (1, 10_000, 2001, 12_000), "{h:?}");
        assert!((h.query_coverage_pct - 100.0).abs() < 1e-9 && h.warnings.is_empty(), "{h:?}");

        // several records: only the first is searched, never the records joined into one query (which
        // would also report the second record's match, at query coordinates past the first record)
        // nor the last or the longest; every hit says so (D0005). The second record, longer than the
        // first, matches the subject elsewhere.
        let (first, second) = (&dna[200..800], &dna[1500..2400]);
        let search = |query: &str| run_local_blast_search(query, &[subject(dna.clone())], "blastn", "db");
        let (alone, second_alone) = (json(&search(first)), json(&search(second)));
        let two = records(2, "blastn", 600, "nt");
        let query = format!(">first\n{}>second\n{}", lines(first), lines(second));
        assert_eq!(unwarned(&search(&query), &[&two], &query), alone);
        // the residue lines of a sequence before the first header are text before it, not a record:
        // the record under the header is searched and its hits say the text was ignored
        let query = format!("{}>second\n{}", lines(first), lines(second));
        assert_eq!(unwarned(&search(&query), &[IGNORED], &query), second_alone);
        // a label before two records: the first record's hits, with both warnings in this order
        let query = format!("Here is my query\n>first\n{}>second\n{}", lines(first), lines(second));
        assert_eq!(unwarned(&search(&query), &[&two, IGNORED], &query), alone);

        // an empty first record is searched as empty: no hit, and never the next record in its place,
        // though `second` matches the subject
        for query in [format!(">a\n>b\n{}", lines(second)), format!(">a\n\n  \n>b\n{}", lines(second)).replace('\n', "\r\n")] {
            assert!(search(&query).is_empty(), "{query:?}");
            // the warning it owes is the multi-record one (0 nt searched), as the query reader gives it
            assert_eq!(read_blast_query(&query, "blastn", "nt"), (String::new(), vec![records(2, "blastn", 0, "nt")]), "{query:?}");
        }
        // a first record that finds nothing: no hit, though the second record matches the subject.
        // Warnings ride on hits and the engine has no other channel for them, so this search returns
        // an empty list and no warning; showing the multi-record warning then falls to the BLAST
        // window's TypeScript, which must read the query by the same rule (BG-01M6Q0VH).
        // (a random 600-nt record finds chance hits at E <= 10; a poly-A record of 600 nt finds none
        // in this subject, as the fixture check shows)
        let nothing = "A".repeat(600);
        assert!(search(&nothing).is_empty(), "fixture: the first record alone finds nothing");
        let query = format!(">first\n{}>second\n{}", lines(&nothing), lines(second));
        assert!(search(&query).is_empty(), "{query:?}");
        assert_eq!(read_blast_query(&query, "blastn", "nt"), (nothing.clone(), vec![records(2, "blastn", 600, "nt")]));
        // the reader for blastp: its unit, three records and a label before the header
        let query = format!("Here is my query\n>first\n{}>second\n>third\n{}", lines(&prot[..100]), lines(&prot[100..200]));
        assert_eq!(read_blast_query(&query, "blastp", "residues"), (prot[..100].to_string(), vec![records(3, "blastp", 100, "residues"), IGNORED.to_string()]));
        // with no header the whole text is the query, comment lines dropped, and nothing warns
        assert_eq!(read_blast_query("1 acgt\n; note\n\u{feff}ACGT 9\r\n", "blastn", "nt"), ("ACGTACGT".to_string(), vec![]));
    }
}
