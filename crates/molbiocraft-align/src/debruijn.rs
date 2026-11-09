// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! De Bruijn graph assembly of short reads (the Velvet / SPAdes family of methods):
//!
//! 1. canonical k-mers (2-bit packed, k ≤ 63) are counted over all reads;
//! 2. k-mers seen fewer times than a solidity threshold (from the k-mer count histogram) are
//!    treated as sequencing errors and dropped;
//! 3. the remaining graph is compacted into unitigs (maximal non-branching paths);
//! 4. tips (short dead-end branches from errors) are clipped and bubbles (two short paths between
//!    the same nodes — errors or heterozygous sites) are popped keeping the better-covered path,
//!    then the graph is compacted again, until nothing changes.
//!
//! Contigs are the unitigs that remain. Checked on simulated phiX174 reads against SPAdes in
//! `src/__tests__/outsideDataNgs.test.ts`.

use rustc_hash::{FxHashMap, FxHashSet};

#[inline]
fn code(b: u8) -> Option<u128> {
    match b {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    }
}

struct K {
    k: usize,
    mask: u128,
}

impl K {
    fn new(k: usize) -> Self {
        K { k, mask: if 2 * k >= 128 { u128::MAX } else { (1u128 << (2 * k)) - 1 } }
    }
    fn rc(&self, x: u128) -> u128 {
        let mut y = 0u128;
        let mut v = x;
        for _ in 0..self.k {
            y = (y << 2) | (3 - (v & 3));
            v >>= 2;
        }
        y
    }
    fn canon(&self, x: u128) -> u128 {
        x.min(self.rc(x))
    }
    fn decode(&self, x: u128) -> Vec<u8> {
        (0..self.k).rev().map(|i| b"ACGT"[((x >> (2 * i)) & 3) as usize]).collect()
    }
}

/// One assembled contig with its mean k-mer coverage.
pub struct DbgContig {
    pub seq: String,
    pub kmer_coverage: f64,
}

/// Assembles `reads` with k-mers of length `k` (odd, ≤ 63).
pub fn assemble_debruijn(reads: &[String], k: usize) -> Vec<DbgContig> {
    let k = k.clamp(15, 63) | 1;
    let km = K::new(k);
    // 1. count canonical k-mers
    let mut counts: FxHashMap<u128, u32> = FxHashMap::default();
    for r in reads {
        let b = r.as_bytes();
        let mut x = 0u128;
        let mut valid = 0usize;
        for &c in b {
            match code(c) {
                Some(v) => {
                    x = ((x << 2) | v) & km.mask;
                    valid += 1;
                    if valid >= k {
                        *counts.entry(km.canon(x)).or_default() += 1;
                    }
                }
                None => valid = 0,
            }
        }
    }
    if counts.is_empty() {
        return Vec::new();
    }
    // 2. solidity threshold: the first valley of the count histogram (at least 2)
    let mut hist = vec![0usize; 256];
    for &c in counts.values() {
        hist[(c as usize).min(255)] += 1;
    }
    let mut thr = 2usize;
    for c in 2..64 {
        if hist[c] <= hist[c + 1] {
            thr = c.max(2);
            break;
        }
    }
    counts.retain(|_, c| *c as usize >= thr);
    let solid: FxHashSet<u128> = counts.keys().copied().collect();
    let has = |x: u128| solid.contains(&km.canon(x));
    let succ = |x: u128| -> Vec<u128> { (0..4u128).map(|b| ((x << 2) | b) & km.mask).filter(|&y| has(y)).collect() };
    let pred = |x: u128| -> Vec<u128> { (0..4u128).map(|b| (b << (2 * (k - 1))) | (x >> 2)).filter(|&y| has(y)).collect() };

    // 3. unitigs: walk maximal non-branching paths (each canonical k-mer used once)
    let build = |removed: &FxHashSet<u128>| -> Vec<(Vec<u128>, f64)> {
        let alive = |x: u128| has(x) && !removed.contains(&km.canon(x));
        let succ_a = |x: u128| -> Vec<u128> { succ(x).into_iter().filter(|&y| alive(y)).collect() };
        let pred_a = |x: u128| -> Vec<u128> { pred(x).into_iter().filter(|&y| alive(y)).collect() };
        let mut seen: FxHashSet<u128> = FxHashSet::default();
        let mut unitigs = Vec::new();
        let mut keys: Vec<u128> = solid.iter().copied().filter(|c| !removed.contains(c)).collect();
        keys.sort_unstable();
        for start in keys {
            if seen.contains(&start) {
                continue;
            }
            seen.insert(start);
            let mut path = vec![start];
            // extend right
            let mut cur = start;
            loop {
                let s = succ_a(cur);
                if s.len() != 1 { break; }
                let nx = s[0];
                if pred_a(nx).len() != 1 || seen.contains(&km.canon(nx)) { break; }
                seen.insert(km.canon(nx));
                path.push(nx);
                cur = nx;
            }
            // extend left
            let mut left = Vec::new();
            let mut cur = start;
            loop {
                let p = pred_a(cur);
                if p.len() != 1 { break; }
                let pv = p[0];
                if succ_a(pv).len() != 1 || seen.contains(&km.canon(pv)) { break; }
                seen.insert(km.canon(pv));
                left.push(pv);
                cur = pv;
            }
            left.reverse();
            left.extend(path);
            let cov = left.iter().map(|&x| counts[&km.canon(x)] as f64).sum::<f64>() / left.len() as f64;
            unitigs.push((left, cov));
        }
        unitigs
    };
    let spell = |path: &[u128]| -> String {
        let mut s = km.decode(path[0]);
        for &x in &path[1..] {
            s.push(b"ACGT"[(x & 3) as usize]);
        }
        String::from_utf8(s).unwrap()
    };

    // 4. clip tips and pop bubbles until stable
    let mut removed: FxHashSet<u128> = FxHashSet::default();
    let mut unitigs = build(&removed);
    for _round in 0..6 {
        let mut changed = false;
        let alive = |x: u128, removed: &FxHashSet<u128>| has(x) && !removed.contains(&km.canon(x));
        // tips: short unitigs with a dead end on one side and a branch on the other
        let mut to_remove: Vec<u128> = Vec::new();
        for (p, _cov) in &unitigs {
            if p.len() >= 2 * k {
                continue;
            }
            let first = p[0];
            let last = *p.last().unwrap();
            let ins = pred(first).into_iter().filter(|&y| alive(y, &removed)).count();
            let outs = succ(last).into_iter().filter(|&y| alive(y, &removed)).count();
            if (ins == 0) != (outs == 0) || (ins == 0 && outs == 0 && p.len() < k) {
                to_remove.extend(p.iter().map(|&x| km.canon(x)));
            }
        }
        // bubbles: unitigs between the same two neighbours; keep the best covered
        let mut by_ends: FxHashMap<(u128, u128), Vec<usize>> = FxHashMap::default();
        for (i, (p, _)) in unitigs.iter().enumerate() {
            if p.len() > 3 * k {
                continue;
            }
            let a = pred(p[0]).into_iter().filter(|&y| alive(y, &removed)).collect::<Vec<_>>();
            let b = succ(*p.last().unwrap()).into_iter().filter(|&y| alive(y, &removed)).collect::<Vec<_>>();
            if a.len() == 1 && b.len() == 1 {
                by_ends.entry((km.canon(a[0]), km.canon(b[0]))).or_default().push(i);
            }
        }
        for (_, group) in by_ends {
            if group.len() < 2 {
                continue;
            }
            let best = *group.iter().max_by(|&&x, &&y| unitigs[x].1.partial_cmp(&unitigs[y].1).unwrap()).unwrap();
            for &i in &group {
                if i != best {
                    to_remove.extend(unitigs[i].0.iter().map(|&x| km.canon(x)));
                }
            }
        }
        for x in to_remove {
            if removed.insert(x) {
                changed = true;
            }
        }
        if !changed {
            break;
        }
        unitigs = build(&removed);
    }
    let mut out: Vec<DbgContig> = unitigs
        .into_iter()
        .filter(|(p, _)| p.len() + k - 1 >= (2 * k).max(100))
        .map(|(p, cov)| DbgContig { seq: spell(&p), kmer_coverage: cov })
        .collect();
    out.sort_by(|a, b| b.seq.len().cmp(&a.seq.len()));
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn assembles_a_genome_from_error_containing_reads() {
        let mut x = 7u64;
        let mut rnd = || { x ^= x << 13; x ^= x >> 7; x ^= x << 17; x };
        let genome: String = (0..3000).map(|_| b"ACGT"[(rnd() % 4) as usize] as char).collect();
        let comp = |s: &str| -> String { s.bytes().rev().map(|b| match b { b'A' => 'T', b'C' => 'G', b'G' => 'C', _ => 'A' }).collect() };
        let mut reads = Vec::new();
        for _ in 0..800 {
            let p = (rnd() % (3000 - 100)) as usize;
            let mut r: Vec<u8> = genome.as_bytes()[p..p + 100].to_vec();
            if rnd() % 50 == 0 { let q = (rnd() % 100) as usize; r[q] = b"ACGT"[(rnd() % 4) as usize]; }
            let r = String::from_utf8(r).unwrap();
            reads.push(if rnd() % 2 == 0 { comp(&r) } else { r });
        }
        let contigs = assemble_debruijn(&reads, 31);
        assert!(!contigs.is_empty());
        let c = &contigs[0].seq;
        assert!(c.len() > 2900, "longest {}", c.len());
        assert!(genome.contains(c.as_str()) || genome.contains(comp(c).as_str()));
    }
}
