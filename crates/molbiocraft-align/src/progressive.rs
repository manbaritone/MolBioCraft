// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Progressive multiple sequence alignment (the ClustalW / MUSCLE / MAFFT family of methods).
//! Accuracy is checked against Pfam seed alignments and MAFFT / MUSCLE / Clustal Omega in
//! `tests/outside_data_reference.rs`. Plain progressive mode:
//!
//! 1. distances from pairwise global alignments (k-mer distances for large inputs);
//! 2. a UPGMA guide tree;
//! 3. profile–profile Gotoh alignment up the tree (column scores are the frequency-weighted
//!    substitution scores; affine gaps, cheaper at the ends; Henikoff sequence weights);
//! 4. optional tree-dependent restricted partitioning refinement (MUSCLE): each guide-tree edge
//!    splits the alignment in two, the halves are re-aligned, and the result is kept when the
//!    weighted sum-of-pairs score improves; then the guide tree can be rebuilt from the
//!    alignment and the progressive step repeated (MAFFT FFT-NS-2 / MUSCLE stage 2).
//!
//! Every residue of every input is kept in order; gap-only columns are never produced.

use bio::alignment::pairwise::{Aligner, Scoring};
use bio::scores::blosum62;

/// Options of one progressive run.
#[derive(Clone, Copy, Debug)]
pub struct ProgressiveOptions {
    /// Rebuild the guide tree from the first alignment and align again.
    pub second_pass: bool,
    /// Tree-dependent refinement passes over all edges (0 = none).
    pub refine_passes: usize,
}

struct Alphabet {
    symbols: Vec<u8>,
    index: [u8; 256],
    score: Vec<Vec<f32>>,
}

const NO: u8 = 255;

fn alphabet(seqs: &[Vec<u8>], protein: bool) -> Alphabet {
    let mut seen = [false; 256];
    for s in seqs {
        for &b in s {
            seen[b as usize] = true;
        }
    }
    let symbols: Vec<u8> = (0u8..=255).filter(|&b| seen[b as usize]).collect();
    let mut index = [NO; 256];
    for (i, &b) in symbols.iter().enumerate() {
        index[b as usize] = i as u8;
    }
    let score = symbols
        .iter()
        .map(|&a| symbols.iter().map(|&b| pair_score(a, b, protein)).collect())
        .collect();
    Alphabet { symbols, index, score }
}

fn pair_score(a: u8, b: u8, protein: bool) -> f32 {
    if protein {
        blosum62(a, b) as f32
    } else if a == b && a != b'N' {
        5.0
    } else if crate::pairwise::compatible_nucleotides(a, b) {
        1.0
    } else {
        -4.0
    }
}

/// Gap open / extend (BLOSUM62 half-bit units for proteins; +5 / −4 scoring for nucleotides).
fn gap_costs(_protein: bool) -> (f32, f32) {
    (-10.0, -1.0)
}

/// Bonus added to every aligned column pair (MUSCLE's "centre" parameter): without it, weakly
/// similar columns lose to gaps too easily. Chosen on 26 Pfam seed alignments (Q +0.02).
const COLUMN_BONUS: f32 = 2.0;

// ───────────────────────────── distances and guide tree ─────────────────────────────

fn kmer_distance(a: &[u8], b: &[u8], k: usize) -> f64 {
    use rustc_hash::FxHashMap;
    if a.len() < k || b.len() < k {
        return 1.0;
    }
    let mut ca: FxHashMap<&[u8], i32> = FxHashMap::default();
    for w in a.windows(k) {
        *ca.entry(w).or_default() += 1;
    }
    let mut shared = 0i32;
    for w in b.windows(k) {
        if let Some(c) = ca.get_mut(w) {
            if *c > 0 {
                *c -= 1;
                shared += 1;
            }
        }
    }
    1.0 - shared as f64 / (a.len().min(b.len()) - k + 1) as f64
}

/// Fractional identity over aligned residue pairs of a global alignment, as a distance
/// (Kimura's protein correction, or Jukes–Cantor for nucleotides).
fn alignment_distance(a: &[u8], b: &[u8], protein: bool) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 1.0;
    }
    let (go, ge) = (-10, -1);
    let aln = if protein {
        Aligner::with_capacity_and_scoring(a.len(), b.len(), Scoring::new(go, ge, blosum62)).global(a, b)
    } else {
        let f = |x: u8, y: u8| if x == y { 5i32 } else { -4i32 };
        Aligner::with_capacity_and_scoring(a.len(), b.len(), Scoring::new(go, ge, f)).global(a, b)
    };
    use bio::alignment::AlignmentOperation::*;
    let (mut same, mut pairs) = (0usize, 0usize);
    for op in &aln.operations {
        match op {
            Match => { same += 1; pairs += 1; }
            Subst => pairs += 1,
            _ => {}
        }
    }
    if pairs == 0 {
        return 1.0;
    }
    let p = 1.0 - same as f64 / pairs as f64;
    if protein {
        let x = 1.0 - p - 0.2 * p * p;
        if x <= 0.0 { 3.0 } else { (-x.ln()).min(3.0) }
    } else {
        let x = 1.0 - 4.0 / 3.0 * p;
        if x <= 0.0 { 3.0 } else { (-0.75 * x.ln()).min(3.0) }
    }
}

fn distance_matrix(seqs: &[Vec<u8>], protein: bool) -> Vec<Vec<f64>> {
    let n = seqs.len();
    let total: usize = seqs.iter().map(|s| s.len()).sum();
    let mean = total / n.max(1);
    // exact pairwise alignments while affordable (≈ n²/2 · L² cells), k-mers beyond
    let exact = (n * n / 2).saturating_mul(mean * mean) <= 400_000_000;
    let mut d = vec![vec![0.0; n]; n];
    for i in 0..n {
        for j in i + 1..n {
            let v = if exact { alignment_distance(&seqs[i], &seqs[j], protein) } else { kmer_distance(&seqs[i], &seqs[j], if protein { 3 } else { 6 }) };
            d[i][j] = v;
            d[j][i] = v;
        }
    }
    d
}

/// Distances from an existing alignment (fraction of differing residue pairs, Kimura-corrected).
fn distances_from_alignment(rows: &[Vec<u8>], protein: bool) -> Vec<Vec<f64>> {
    let n = rows.len();
    let mut d = vec![vec![0.0; n]; n];
    for i in 0..n {
        for j in i + 1..n {
            let (mut same, mut pairs) = (0usize, 0usize);
            for (a, b) in rows[i].iter().zip(&rows[j]) {
                if *a != b'-' && *b != b'-' {
                    pairs += 1;
                    if a == b { same += 1; }
                }
            }
            let p = if pairs == 0 { 1.0 } else { 1.0 - same as f64 / pairs as f64 };
            let x = if protein { 1.0 - p - 0.2 * p * p } else { 1.0 - 4.0 / 3.0 * p };
            let v = if x <= 0.0 { 3.0 } else if protein { (-x.ln()).min(3.0) } else { (-0.75 * x.ln()).min(3.0) };
            d[i][j] = v;
            d[j][i] = v;
        }
    }
    d
}

/// Guide tree node: leaves are 0..n, internal nodes n.. with their two children.
struct Tree {
    children: Vec<(usize, usize)>,
    n: usize,
}

impl Tree {
    fn root(&self) -> usize { self.n + self.children.len() - 1 }
    fn leaves(&self, node: usize, out: &mut Vec<usize>) {
        if node < self.n { out.push(node); } else { let (a, b) = self.children[node - self.n]; self.leaves(a, out); self.leaves(b, out); }
    }
}

fn upgma(d: &[Vec<f64>]) -> Tree {
    let n = d.len();
    let mut active: Vec<(usize, usize)> = (0..n).map(|i| (i, 1)).collect(); // (node id, size)
    let mut dist: Vec<Vec<f64>> = d.to_vec();
    let mut children = Vec::new();
    while active.len() > 1 {
        let (mut bi, mut bj, mut best) = (0, 1, f64::INFINITY);
        for i in 0..active.len() {
            for j in i + 1..active.len() {
                if dist[i][j] < best { best = dist[i][j]; bi = i; bj = j; }
            }
        }
        let (ni, si) = active[bi];
        let (nj, sj) = active[bj];
        let id = n + children.len();
        children.push((ni, nj));
        // new row: size-weighted average
        let row: Vec<f64> = (0..active.len()).map(|k| (dist[bi][k] * si as f64 + dist[bj][k] * sj as f64) / (si + sj) as f64).collect();
        for k in 0..active.len() { dist[bi][k] = row[k]; dist[k][bi] = row[k]; }
        dist[bi][bi] = 0.0;
        active[bi] = (id, si + sj);
        active.remove(bj);
        dist.remove(bj);
        for r in dist.iter_mut() { r.remove(bj); }
    }
    Tree { children, n }
}

// ───────────────────────────── profiles ─────────────────────────────

/// An alignment of a subset of the sequences.
#[derive(Clone)]
struct Profile {
    members: Vec<usize>,
    rows: Vec<Vec<u8>>, // aligned rows, same order as members
}

/// Weighted residue frequencies per column (weights of all members sum to 1; gaps carry the rest).
fn column_freqs(p: &Profile, w: &[f64], al: &Alphabet) -> Vec<Vec<(u8, f32)>> {
    let len = p.rows.first().map(|r| r.len()).unwrap_or(0);
    let wsum: f64 = p.members.iter().map(|&m| w[m]).sum::<f64>().max(1e-12);
    (0..len)
        .map(|c| {
            let mut acc: Vec<(u8, f32)> = Vec::new();
            for (k, row) in p.rows.iter().enumerate() {
                let b = row[c];
                if b == b'-' { continue; }
                let idx = al.index[b as usize];
                let wt = (w[p.members[k]] / wsum) as f32;
                if let Some(e) = acc.iter_mut().find(|e| e.0 == idx) { e.1 += wt; } else { acc.push((idx, wt)); }
            }
            acc
        })
        .collect()
}

fn occupancy(p: &Profile, w: &[f64]) -> Vec<f32> {
    let len = p.rows.first().map(|r| r.len()).unwrap_or(0);
    let wsum: f64 = p.members.iter().map(|&m| w[m]).sum::<f64>().max(1e-12);
    (0..len)
        .map(|c| p.rows.iter().enumerate().filter(|(_, r)| r[c] != b'-').map(|(k, _)| w[p.members[k]]).sum::<f64>() as f32 / wsum as f32)
        .collect()
}

/// Profile–profile Gotoh alignment; returns the merged profile.
fn align_profiles(a: &Profile, b: &Profile, w: &[f64], al: &Alphabet, protein: bool) -> Profile {
    let fa = column_freqs(a, w, al);
    let fb = column_freqs(b, w, al);
    let oa = occupancy(a, w);
    let ob = occupancy(b, w);
    let (la, lb) = (fa.len(), fb.len());
    let k = al.symbols.len();
    // va[i][y] = Σ_x fa[i][x] · S[x][y]
    let va: Vec<Vec<f32>> = fa.iter().map(|col| (0..k).map(|y| col.iter().map(|&(x, f)| f * al.score[x as usize][y]).sum()).collect()).collect();
    let sc = |i: usize, j: usize| -> f32 { fb[j].iter().map(|&(y, f)| va[i][y as usize] * f).sum() };
    let (go, ge) = gap_costs(protein);
    // a gap opened against a column that is itself mostly gaps costs less (ClustalW-style)
    let open_in_b = |i: usize| go * oa[i].max(0.05); // B gets a gap opposite A column i
    let open_in_a = |j: usize| go * ob[j].max(0.05);
    const NEG: f32 = f32::NEG_INFINITY;
    let w2 = lb + 1;
    let mut m = vec![NEG; (la + 1) * w2];
    let mut x = vec![NEG; (la + 1) * w2]; // A column consumed, gap in B
    let mut y = vec![NEG; (la + 1) * w2]; // B column consumed, gap in A
    let mut tb = vec![0u8; (la + 1) * w2]; // bits 0-1: M from; 2: X from (0 = M/open, 1 = X/extend); 3: Y from
    m[0] = 0.0;
    // terminal gaps: extension cost only
    for i in 1..=la { x[i * w2] = ge * i as f32; tb[i * w2] |= if i > 1 { 4 } else { 0 }; }
    for j in 1..=lb { y[j] = ge * j as f32; tb[j] |= if j > 1 { 8 } else { 0 }; }
    for i in 1..=la {
        let end_i = i == la;
        for j in 1..=lb {
            let end_j = j == lb;
            let d = (i - 1) * w2 + (j - 1);
            let s = sc(i - 1, j - 1) + COLUMN_BONUS;
            let (mm, xx, yy) = (m[d], x[d], y[d]);
            let (best, from) = if mm >= xx && mm >= yy { (mm, 0u8) } else if xx >= yy { (xx, 1) } else { (yy, 2) };
            let c = i * w2 + j;
            m[c] = best + s;
            let mut t = from;
            // X: gap in B opposite A column i-1 (B's last consumed column is j)
            let up = (i - 1) * w2 + j;
            let ox = if end_j { ge } else { open_in_b(i - 1) + ge };
            let (o, e) = (m[up].max(y[up]) + ox, x[up] + ge);
            if e > o { x[c] = e; t |= 4; } else { x[c] = o; if y[up] > m[up] { t |= 16; } }
            // Y: gap in A opposite B column j-1
            let left = i * w2 + (j - 1);
            let oy = if end_i { ge } else { open_in_a(j - 1) + ge };
            let (o, e) = (m[left].max(x[left]) + oy, y[left] + ge);
            if e > o { y[c] = e; t |= 8; } else { y[c] = o; if x[left] > m[left] { t |= 32; } }
            tb[c] = t;
        }
    }
    // traceback
    let mut i = la;
    let mut j = lb;
    let end = la * w2 + lb;
    let mut state = if m[end] >= x[end] && m[end] >= y[end] { 0 } else if x[end] >= y[end] { 1 } else { 2 };
    let mut ops: Vec<u8> = Vec::with_capacity(la + lb);
    while i > 0 || j > 0 {
        if i == 0 { ops.push(2); j -= 1; state = 2; continue; }
        if j == 0 { ops.push(1); i -= 1; state = 1; continue; }
        let t = tb[i * w2 + j];
        match state {
            0 => { ops.push(0); state = t & 3; i -= 1; j -= 1; }
            1 => { ops.push(1); state = if t & 4 != 0 { 1 } else if t & 16 != 0 { 2 } else { 0 }; i -= 1; }
            _ => { ops.push(2); state = if t & 8 != 0 { 2 } else if t & 32 != 0 { 1 } else { 0 }; j -= 1; }
        }
    }
    ops.reverse();
    let mut rows: Vec<Vec<u8>> = vec![Vec::with_capacity(ops.len()); a.rows.len() + b.rows.len()];
    let (mut ia, mut ib) = (0usize, 0usize);
    for op in ops {
        for (r, row) in a.rows.iter().enumerate() { rows[r].push(if op == 2 { b'-' } else { row[ia] }); }
        for (r, row) in b.rows.iter().enumerate() { rows[a.rows.len() + r].push(if op == 1 { b'-' } else { row[ib] }); }
        if op != 2 { ia += 1; }
        if op != 1 { ib += 1; }
    }
    let mut members = a.members.clone();
    members.extend(&b.members);
    Profile { members, rows }
}

fn progressive(seqs: &[Vec<u8>], tree: &Tree, w: &[f64], al: &Alphabet, protein: bool) -> Vec<Vec<u8>> {
    let mut profiles: Vec<Option<Profile>> = (0..seqs.len()).map(|i| Some(Profile { members: vec![i], rows: vec![seqs[i].clone()] })).collect();
    for (a, b) in tree.children.iter().copied() {
        let pa = profiles[a].take().unwrap();
        let pb = profiles[b].take().unwrap();
        profiles.push(Some(align_profiles(&pa, &pb, w, al, protein)));
    }
    let root = profiles.pop().flatten().unwrap();
    let mut out = vec![Vec::new(); seqs.len()];
    for (k, &m) in root.members.iter().enumerate() { out[m] = root.rows[k].clone(); }
    out
}

/// Henikoff & Henikoff position-based sequence weights from an alignment.
fn henikoff_weights(rows: &[Vec<u8>]) -> Vec<f64> {
    let n = rows.len();
    let len = rows.first().map(|r| r.len()).unwrap_or(0);
    let mut w = vec![0.0; n];
    for c in 0..len {
        let mut counts = [0u32; 256];
        let mut kinds = 0;
        for r in rows { let b = r[c] as usize; if counts[b] == 0 { kinds += 1; } counts[b] += 1; }
        for (k, r) in rows.iter().enumerate() { w[k] += 1.0 / (kinds as f64 * counts[r[c] as usize] as f64); }
    }
    let s: f64 = w.iter().sum();
    if s <= 0.0 { return vec![1.0; n]; }
    w.iter().map(|x| x / s * n as f64).collect()
}

/// Weighted sum-of-pairs objective with affine gaps per pair (terminal gaps free).
fn sp_objective(rows: &[Vec<u8>], w: &[f64], al: &Alphabet, protein: bool) -> f64 {
    let (go, ge) = gap_costs(protein);
    let n = rows.len();
    let mut total = 0.0;
    for i in 0..n {
        for j in i + 1..n {
            let (a, b) = (&rows[i], &rows[j]);
            let first = (0..a.len()).find(|&c| a[c] != b'-' && b[c] != b'-');
            let Some(first) = first else { continue };
            let last = (0..a.len()).rev().find(|&c| a[c] != b'-' && b[c] != b'-').unwrap();
            let mut s = 0.0f64;
            let mut gap_state = 0u8; // 1: gap in a, 2: gap in b
            for c in first..=last {
                match (a[c] == b'-', b[c] == b'-') {
                    (true, true) => {}
                    (false, false) => { s += al.score[al.index[a[c] as usize] as usize][al.index[b[c] as usize] as usize] as f64; gap_state = 0; }
                    (true, false) => { s += if gap_state == 1 { ge } else { go + ge } as f64; gap_state = 1; }
                    (false, true) => { s += if gap_state == 2 { ge } else { go + ge } as f64; gap_state = 2; }
                }
            }
            total += s * w[i] * w[j];
        }
    }
    total
}

fn strip_gap_columns(rows: &mut Vec<Vec<u8>>) {
    let len = rows.first().map(|r| r.len()).unwrap_or(0);
    let keep: Vec<bool> = (0..len).map(|c| rows.iter().any(|r| r[c] != b'-')).collect();
    for r in rows.iter_mut() {
        let mut k = 0;
        r.retain(|_| { let v = keep[k]; k += 1; v });
    }
}

/// Tree-dependent restricted partitioning (MUSCLE's refinement).
fn refine(rows: Vec<Vec<u8>>, tree: &Tree, w: &[f64], al: &Alphabet, protein: bool, passes: usize) -> Vec<Vec<u8>> {
    let n = rows.len();
    let mut best = rows;
    let mut best_score = sp_objective(&best, w, al, protein);
    let root = tree.root();
    for _ in 0..passes {
        let mut improved = false;
        // every edge = every node except the root (its leaf set vs the rest)
        let mut nodes: Vec<usize> = (0..root).collect();
        nodes.reverse();
        for node in nodes {
            let mut side = Vec::new();
            tree.leaves(node, &mut side);
            if side.len() == n || side.is_empty() { continue; }
            let mut in_side = vec![false; n];
            for &s in &side { in_side[s] = true; }
            let other: Vec<usize> = (0..n).filter(|&i| !in_side[i]).collect();
            let mut ra: Vec<Vec<u8>> = side.iter().map(|&i| best[i].clone()).collect();
            let mut rb: Vec<Vec<u8>> = other.iter().map(|&i| best[i].clone()).collect();
            strip_gap_columns(&mut ra);
            strip_gap_columns(&mut rb);
            let merged = align_profiles(&Profile { members: side.clone(), rows: ra }, &Profile { members: other.clone(), rows: rb }, w, al, protein);
            let mut cand = vec![Vec::new(); n];
            for (k, &m) in merged.members.iter().enumerate() { cand[m] = merged.rows[k].clone(); }
            let s = sp_objective(&cand, w, al, protein);
            if s > best_score + 1e-9 { best_score = s; best = cand; improved = true; }
        }
        if !improved { break; }
    }
    best
}

/// Aligns `seqs` (uppercase residues, no gaps). Rows are returned in input order.
pub fn progressive_msa(seqs: &[Vec<u8>], protein: bool, o: ProgressiveOptions) -> Vec<Vec<u8>> {
    let n = seqs.len();
    if n == 0 { return Vec::new(); }
    if n == 1 { return vec![seqs[0].clone()]; }
    let al = alphabet(seqs, protein);
    let d = distance_matrix(seqs, protein);
    let mut tree = upgma(&d);
    let ones = vec![1.0; n];
    let mut rows = progressive(seqs, &tree, &ones, &al, protein);
    let mut w = henikoff_weights(&rows);
    if o.second_pass {
        tree = upgma(&distances_from_alignment(&rows, protein));
        let again = progressive(seqs, &tree, &w, &al, protein);
        if sp_objective(&again, &w, &al, protein) >= sp_objective(&rows, &w, &al, protein) { rows = again; }
        w = henikoff_weights(&rows);
    }
    if o.refine_passes > 0 {
        rows = refine(rows, &tree, &w, &al, protein, o.refine_passes);
    }
    strip_gap_columns(&mut rows);
    rows
}

// ───────────────────────────── consistency (T-Coffee / L-INS-i style) ─────────────────────────────
//
// Consistency mode (MAFFT L-INS-i, MUSCLE 5, T-Coffee, ProbCons): every pair of sequences is
// aligned globally and each aligned residue pair is weighted by that alignment's identity; the
// library is then extended through every third sequence (W'(x,y) = W(x,y) + Σ_z min(W(x,z),
// W(z,y))), and profiles are aligned to maximise the summed library weight. Residue pairs that
// many alignments agree on win over pairs one alignment happens to prefer.

/// Library: for every residue (sequence, position) the residues it is aligned to, with weights.
type Library = Vec<Vec<Vec<(u32, u32, f32)>>>; // lib[seq][pos] = [(other seq, other pos, weight)]

fn pair_alignment(a: &[u8], b: &[u8], protein: bool) -> (Vec<(u32, u32)>, f32) {
    let aln = if protein {
        Aligner::with_capacity_and_scoring(a.len(), b.len(), Scoring::new(-11, -1, blosum62)).global(a, b)
    } else {
        let f = |x: u8, y: u8| if x == y { 5i32 } else { -4i32 };
        Aligner::with_capacity_and_scoring(a.len(), b.len(), Scoring::new(-10, -1, f)).global(a, b)
    };
    use bio::alignment::AlignmentOperation::*;
    let (mut i, mut j) = (aln.xstart, aln.ystart);
    let mut pairs = Vec::new();
    let mut same = 0usize;
    for op in &aln.operations {
        match op {
            Match | Subst => { if matches!(op, Match) { same += 1; } pairs.push((i as u32, j as u32)); i += 1; j += 1; }
            Del => j += 1,
            Ins => i += 1,
            Xclip(k) => i += k,
            Yclip(k) => j += k,
        }
    }
    let ident = if pairs.is_empty() { 0.0 } else { same as f32 / pairs.len() as f32 };
    (pairs, ident)
}

fn build_library(seqs: &[Vec<u8>], protein: bool) -> Library {
    let n = seqs.len();
    let mut primary: Library = seqs.iter().map(|s| vec![Vec::new(); s.len()]).collect();
    for i in 0..n {
        for j in i + 1..n {
            let (pairs, ident) = pair_alignment(&seqs[i], &seqs[j], protein);
            let w = ident.max(0.05);
            for (p, q) in pairs {
                primary[i][p as usize].push((j as u32, q, w));
                primary[j][q as usize].push((i as u32, p, w));
            }
        }
    }
    // extension: W'(x, y) = W(x, y) + Σ_z min(W(x, z), W(z, y))
    let mut ext: Library = seqs.iter().map(|s| vec![Vec::new(); s.len()]).collect();
    let mut acc: rustc_hash::FxHashMap<(u32, u32), f32> = rustc_hash::FxHashMap::default();
    for i in 0..n {
        for p in 0..seqs[i].len() {
            acc.clear();
            for &(j, q, w) in &primary[i][p] {
                *acc.entry((j, q)).or_default() += w;
                for &(k, r, w2) in &primary[j as usize][q as usize] {
                    if k as usize != i {
                        *acc.entry((k, r)).or_default() += w.min(w2);
                    }
                }
            }
            ext[i][p] = acc.iter().map(|(&(j, q), &w)| (j, q, w)).collect();
        }
    }
    ext
}

/// Profile alignment maximising the summed library weight of aligned residue pairs (no gap costs).
fn align_profiles_lib(a: &Profile, b: &Profile, lib: &Library, w: &[f64]) -> Profile {
    let la = a.rows.first().map(|r| r.len()).unwrap_or(0);
    let lb = b.rows.first().map(|r| r.len()).unwrap_or(0);
    let n_seq = w.len();
    // column of each residue of B's members
    let mut col_of: Vec<Vec<u32>> = vec![Vec::new(); n_seq];
    let mut in_b = vec![false; n_seq];
    for (k, &m) in b.members.iter().enumerate() {
        in_b[m] = true;
        let mut cols = Vec::new();
        for (c, &ch) in b.rows[k].iter().enumerate() { if ch != b'-' { cols.push(c as u32); } }
        col_of[m] = cols;
    }
    let mut sc = vec![0f32; la * lb];
    for (k, &m) in a.members.iter().enumerate() {
        let mut pos = 0usize;
        for (c, &ch) in a.rows[k].iter().enumerate() {
            if ch == b'-' { continue; }
            for &(j, q, wt) in &lib[m][pos] {
                if in_b[j as usize] {
                    let cb = col_of[j as usize][q as usize] as usize;
                    sc[c * lb + cb] += wt * (w[m] * w[j as usize]) as f32;
                }
            }
            pos += 1;
        }
    }
    // Needleman–Wunsch on library scores; a small per-gap-column cost (in library units) keeps
    // chance pairs from scattering alignments of 4-letter sequences
    let gap = 0.2 * (a.members.len() * b.members.len()) as f32;
    let w2 = lb + 1;
    let mut f = vec![0f32; (la + 1) * w2];
    let mut tb = vec![0u8; (la + 1) * w2];
    for i in 1..=la { tb[i * w2] = 1; }
    for j in 1..=lb { tb[j] = 2; }
    for i in 1..=la {
        for j in 1..=lb {
            let d = f[(i - 1) * w2 + j - 1] + sc[(i - 1) * lb + j - 1];
            let u = f[(i - 1) * w2 + j] - if j == lb { 0.0 } else { gap };
            let l = f[i * w2 + j - 1] - if i == la { 0.0 } else { gap };
            let c = i * w2 + j;
            if d >= u && d >= l { f[c] = d; tb[c] = 0; } else if u >= l { f[c] = u; tb[c] = 1; } else { f[c] = l; tb[c] = 2; }
        }
    }
    let (mut i, mut j) = (la, lb);
    let mut ops = Vec::with_capacity(la + lb);
    while i > 0 || j > 0 {
        let t = tb[i * w2 + j];
        ops.push(t);
        match t { 0 => { i -= 1; j -= 1; } 1 => i -= 1, _ => j -= 1 }
    }
    ops.reverse();
    let mut rows: Vec<Vec<u8>> = vec![Vec::with_capacity(ops.len()); a.rows.len() + b.rows.len()];
    let (mut ia, mut ib) = (0usize, 0usize);
    for op in ops {
        for (r, row) in a.rows.iter().enumerate() { rows[r].push(if op == 2 { b'-' } else { row[ia] }); }
        for (r, row) in b.rows.iter().enumerate() { rows[a.rows.len() + r].push(if op == 1 { b'-' } else { row[ib] }); }
        if op != 2 { ia += 1; }
        if op != 1 { ib += 1; }
    }
    let mut members = a.members.clone();
    members.extend(&b.members);
    Profile { members, rows }
}

/// Summed library weight of all residue pairs aligned in `rows` (the COFFEE objective).
fn library_objective(rows: &[Vec<u8>], lib: &Library, w: &[f64]) -> f64 {
    let n = rows.len();
    // column → residue index per row
    let pos: Vec<Vec<i32>> = rows.iter().map(|r| { let mut p = -1; r.iter().map(|&c| if c == b'-' { -1 } else { p += 1; p }).collect() }).collect();
    let mut col_of: Vec<Vec<u32>> = vec![Vec::new(); n];
    for (k, r) in rows.iter().enumerate() { for (c, &ch) in r.iter().enumerate() { if ch != b'-' { col_of[k].push(c as u32); } } }
    let mut total = 0.0;
    for i in 0..n {
        for (p, entries) in lib[i].iter().enumerate() {
            let c = col_of[i][p];
            for &(j, q, wt) in entries {
                if (j as usize) > i && pos[j as usize][c as usize] == q as i32 {
                    total += wt as f64 * w[i] * w[j as usize];
                }
            }
        }
    }
    total
}

/// Consistency-based progressive alignment with tree-dependent refinement on the library objective.
pub fn consistency_msa(seqs: &[Vec<u8>], protein: bool, refine_passes: usize) -> Vec<Vec<u8>> {
    let n = seqs.len();
    if n < 3 { return progressive_msa(seqs, protein, ProgressiveOptions { second_pass: false, refine_passes: 0 }); }
    let lib = build_library(seqs, protein);
    let d = distance_matrix(seqs, protein);
    let tree = upgma(&d);
    let ones = vec![1.0; n];
    let mut profiles: Vec<Option<Profile>> = (0..n).map(|i| Some(Profile { members: vec![i], rows: vec![seqs[i].clone()] })).collect();
    for (a, b) in tree.children.iter().copied() {
        let pa = profiles[a].take().unwrap();
        let pb = profiles[b].take().unwrap();
        profiles.push(Some(align_profiles_lib(&pa, &pb, &lib, &ones)));
    }
    let root = profiles.pop().flatten().unwrap();
    let mut best = vec![Vec::new(); n];
    for (k, &m) in root.members.iter().enumerate() { best[m] = root.rows[k].clone(); }
    let mut best_score = library_objective(&best, &lib, &ones);
    for _ in 0..refine_passes {
        let mut improved = false;
        for node in (0..tree.root()).rev() {
            let mut side = Vec::new();
            tree.leaves(node, &mut side);
            if side.len() == n { continue; }
            let mut in_side = vec![false; n];
            for &x in &side { in_side[x] = true; }
            let other: Vec<usize> = (0..n).filter(|&i| !in_side[i]).collect();
            let mut ra: Vec<Vec<u8>> = side.iter().map(|&i| best[i].clone()).collect();
            let mut rb: Vec<Vec<u8>> = other.iter().map(|&i| best[i].clone()).collect();
            strip_gap_columns(&mut ra);
            strip_gap_columns(&mut rb);
            let merged = align_profiles_lib(&Profile { members: side.clone(), rows: ra }, &Profile { members: other.clone(), rows: rb }, &lib, &ones);
            let mut cand = vec![Vec::new(); n];
            for (k, &m) in merged.members.iter().enumerate() { cand[m] = merged.rows[k].clone(); }
            let s = library_objective(&cand, &lib, &ones);
            if s > best_score + 1e-6 { best_score = s; best = cand; improved = true; }
        }
        if !improved { break; }
    }
    strip_gap_columns(&mut best);
    if !protein {
        // with four letters the library's chance pairs can mislead; keep the plain progressive
        // alignment when it scores better on the substitution / affine-gap objective
        let plain = progressive_msa(seqs, protein, ProgressiveOptions { second_pass: true, refine_passes: 2 });
        let al = alphabet(seqs, protein);
        let w = henikoff_weights(&plain);
        if sp_objective(&plain, &w, &al, protein) > sp_objective(&best, &w, &al, protein) {
            return plain;
        }
    }
    best
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_residues_and_aligns_an_insertion() {
        let seqs: Vec<Vec<u8>> = ["MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQRQISFVKSHFSRQ", "MKTAYIAKQGGGRQISFVKSHFSRQ", "MKTAYAKQRQISFVKSHFSRQ"].iter().map(|s| s.as_bytes().to_vec()).collect();
        for o in [ProgressiveOptions { second_pass: false, refine_passes: 0 }, ProgressiveOptions { second_pass: true, refine_passes: 2 }] {
            let rows = progressive_msa(&seqs, true, o);
            let len = rows[0].len();
            assert!(rows.iter().all(|r| r.len() == len));
            for (r, s) in rows.iter().zip(&seqs) {
                assert_eq!(r.iter().filter(|&&b| b != b'-').copied().collect::<Vec<u8>>(), *s);
            }
            assert_eq!(len, 25);
            assert_eq!(&rows[0][..9], b"MKTAYIAKQ");
            assert_eq!(&rows[0][rows[0].len() - 13..], b"RQISFVKSHFSRQ");
        }
    }
}
