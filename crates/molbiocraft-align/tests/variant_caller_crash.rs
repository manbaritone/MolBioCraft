// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression (BG-01M6S1QP): calling variants on a sample of about 40 kb trapped the WASM engine.
//!
//! The caller aligned the whole sample in one rust-bio banded alignment, whose traceback is the
//! full (|sample| + 1) x (|window| + 1) matrix of two-byte cells whatever the band: about 3.2 GB
//! at 40 kb. A 32-bit engine cannot request one allocation over `isize::MAX` (2 GiB - 1 on
//! wasm32), so the request panicked there and the engine trapped with `unreachable`.
//!
//! This test binary's allocator refuses any single request over that wasm32 ceiling, so the old
//! caller aborts here as the engine did (and never takes the 20 GB it asks for at 100 kb), and it
//! records the largest request so the test can bound it.
//!
//! The first fix aligned the sample in fixed 1,000-base blocks and invented or dropped variants
//! wherever a block's cut fell in or just before an indel of about 300 bp or more. Four of the
//! tests after the first plant 300- to 2,000-bp insertions, and deletions of those lengths made up
//! by an insertion further on, at and across the caller's seams, below and past the one-shot limit,
//! and indels in tandem repeats, and compare every call with the calls read off an exact
//! full-matrix alignment of the same pair, computed here. The rest bound the largest allocation on
//! a long low-complexity run and on a long stretch unlike the reference, and check that a sample
//! within the one-shot limit is still aligned in one piece.

use molbiocraft_align::call_freebayes_variants;
use molbiocraft_align::ngs_assembly::{call_freebayes_variants_with_one_shot_limit, CALL_ONE_SHOT_MAX_BYTES};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::RwLock;

/// The largest single allocation a wasm32 engine can request: Rust refuses a layout over
/// `isize::MAX`, which is `i32::MAX` bytes on a 32-bit target.
const WASM32_MAX_ALLOCATION: usize = i32::MAX as usize;

/// What one call may request in a single allocation: far under the wasm32 ceiling, and the same
/// at 40 kb and 100 kb, so the aligner's matrix does not grow with the sample.
const ALLOCATION_BOUND: usize = 64 << 20;

static LARGEST_REQUEST: AtomicUsize = AtomicUsize::new(0);

struct Wasm32Ceiling;

unsafe impl GlobalAlloc for Wasm32Ceiling {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        LARGEST_REQUEST.fetch_max(layout.size(), Ordering::Relaxed);
        if layout.size() > WASM32_MAX_ALLOCATION {
            return std::ptr::null_mut();
        }
        System.alloc(layout)
    }
    unsafe fn alloc_zeroed(&self, layout: Layout) -> *mut u8 {
        LARGEST_REQUEST.fetch_max(layout.size(), Ordering::Relaxed);
        if layout.size() > WASM32_MAX_ALLOCATION {
            return std::ptr::null_mut();
        }
        System.alloc_zeroed(layout)
    }
    unsafe fn dealloc(&self, ptr: *mut u8, layout: Layout) {
        System.dealloc(ptr, layout)
    }
    unsafe fn realloc(&self, ptr: *mut u8, layout: Layout, new_size: usize) -> *mut u8 {
        LARGEST_REQUEST.fetch_max(new_size, Ordering::Relaxed);
        if new_size > WASM32_MAX_ALLOCATION {
            return std::ptr::null_mut();
        }
        System.realloc(ptr, layout, new_size)
    }
}

#[global_allocator]
static ALLOCATOR: Wasm32Ceiling = Wasm32Ceiling;

/// A test that bounds [`LARGEST_REQUEST`] holds this for writing, so no other test of this binary
/// allocates while it measures; the others hold it for reading, and run alongside one another.
static ALLOCATION_PROBE: RwLock<()> = RwLock::new(());

/// Deterministic pseudo-random DNA (LCG, fixed seed).
fn genome(len: usize, seed: u64) -> Vec<u8> {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            b"ACGT"[((x >> 33) % 4) as usize]
        })
        .collect()
}

/// A base other than `b`: its transition, or a transversion when `transversion`.
fn substitute(b: u8, transversion: bool) -> u8 {
    match (b, transversion) {
        (b'A', false) => b'G',
        (b'G', false) => b'A',
        (b'C', false) => b'T',
        (b'T', false) => b'C',
        (b'A' | b'G', true) => b'C',
        _ => b'A',
    }
}

/// A base that is neither `a` nor `b`.
fn other_than(a: u8, b: u8) -> u8 {
    *b"ACGT".iter().find(|&&c| c != a && c != b).unwrap()
}

type Call = (usize, String, String, String);

fn text(b: &[u8]) -> String {
    String::from_utf8(b.to_vec()).unwrap()
}

/// The long indels in each sample: wider than the band (64) on either side of the k-mer chain.
/// Each long deletion but the last is followed by a long insertion of the same length, so the
/// sample's net deletion stays under the 200 reference bases the caller's window runs past the
/// sample's mapped end.
const LONG_INDEL: usize = 150;

/// A reference of `len` bases and a sample carrying one edit every 613 bases (SNPs, MNPs, 1-, 6-
/// and [`LONG_INDEL`]-bp deletions, 2-, 4- and [`LONG_INDEL`]-bp insertions) and a last
/// [`LONG_INDEL`]-bp deletion 400 bases from the end, with the VCF call each edit must produce
/// (1-based position, REF, ALT, type). Edits 613 bases apart fall at offsets that vary along the
/// caller's segments (a seam every 1,000 sample bases where the sample matches), and every indel is
/// placed where it cannot slide left or right, so its anchored position is unique.
fn planted(len: usize, seed: u64) -> (String, String, Vec<Call>) {
    let r = genome(len, seed);
    let mut inserted = genome(len, seed ^ 0xA5A5).into_iter();
    let del = |p: usize, l: usize| -> usize {
        (p..p + 40).find(|&q| r[q - 1] != r[q + l - 1] && r[q] != r[q + l]).unwrap()
    };
    let mut sample = Vec::with_capacity(len);
    let mut calls = Vec::new();
    let mut copied = 0usize;
    let mut n = 0usize;
    let mut p = 150usize;
    while p + 700 < len {
        let kind = n % 9;
        sample.extend_from_slice(&r[copied..p.min(r.len())]);
        copied = p;
        match kind {
            0 | 2 | 4 => {
                let alt = substitute(r[p], kind == 2);
                sample.push(alt);
                copied = p + 1;
                calls.push((p + 1, text(&r[p..p + 1]), text(&[alt]), "SNP".into()));
            }
            1 | 5 | 7 => {
                let l = [6, 1, LONG_INDEL][kind / 3];
                let q = del(p, l);
                sample.extend_from_slice(&r[p..q]);
                copied = q + l;
                calls.push((q, text(&r[q - 1..q + l]), text(&r[q - 1..q]), "DEL".into()));
            }
            _ => {
                let (first, last) = (other_than(r[p], r[p]), other_than(r[p - 1], r[p - 1]));
                let middle: Vec<u8> = match kind {
                    3 => vec![],
                    6 => b"GT".to_vec(),
                    _ => inserted.by_ref().take(LONG_INDEL - 2).collect(),
                };
                let mut ins = vec![first];
                ins.extend_from_slice(&middle);
                ins.push(last);
                sample.extend_from_slice(&ins);
                let mut alt = vec![r[p - 1]];
                alt.extend_from_slice(&ins);
                calls.push((p, text(&r[p - 1..p]), text(&alt), "INS".into()));
            }
        }
        if n % 11 == 10 {
            // an MNP: two adjacent substitutions, 150 bases after this edit
            let m = copied + 150;
            sample.extend_from_slice(&r[copied..m]);
            let alt = [substitute(r[m], false), substitute(r[m + 1], true)];
            sample.extend_from_slice(&alt);
            copied = m + 2;
            calls.push((m + 1, text(&r[m..m + 2]), text(&alt), "MNP".into()));
        }
        n += 1;
        p += 613;
    }
    let end = len - 400;
    sample.extend_from_slice(&r[copied..end]);
    let q = del(end, LONG_INDEL);
    sample.extend_from_slice(&r[end..q]);
    calls.push((q, text(&r[q - 1..q + LONG_INDEL]), text(&r[q - 1..q]), "DEL".into()));
    sample.extend_from_slice(&r[q + LONG_INDEL..]);
    (text(&r), text(&sample), calls)
}

#[test]
fn calls_variants_on_40kb_and_100kb_samples() {
    let _measuring = ALLOCATION_PROBE.write().unwrap_or_else(|e| e.into_inner());
    for (len, seed) in [(40_000usize, 0x5EED_0040u64), (100_000, 0x5EED_0100)] {
        let (reference, sample, expected) = planted(len, seed);
        assert!(sample.len() < 100_000 && expected.len() < 500, "fixture stays inside the caller's caps");
        LARGEST_REQUEST.store(0, Ordering::Relaxed);
        let rep = call_freebayes_variants("ref", &reference, &sample);
        let largest = LARGEST_REQUEST.load(Ordering::Relaxed);
        eprintln!("{len} bp: largest single allocation {largest} bytes");
        assert!(
            largest <= ALLOCATION_BOUND,
            "{len} bp: one allocation of {largest} bytes, over the {ALLOCATION_BOUND}-byte bound"
        );
        let calls: Vec<Call> = rep
            .variants
            .iter()
            .map(|v| (v.position_bp, v.ref_allele.clone(), v.alt_allele.clone(), v.variant_type.clone()))
            .collect();
        assert_eq!(calls, expected, "{len} bp");
        assert_eq!(rep.total_variants, expected.len(), "{len} bp");
        let vcf_rows = rep.vcf_text.lines().filter(|l| !l.starts_with('#')).count();
        assert_eq!(vcf_rows, expected.len(), "{len} bp");
    }
}

// ------------------------------------------------------------------------------------------------
// Long indels, seams and repeats, called against an exact alignment of the same pair
// ------------------------------------------------------------------------------------------------

/// An exact alignment of all of `q` to `r`, the reference before and after it free, over the full
/// (|q| + 1) x (|r| + 1) matrix: Gotoh's three-state recurrence under the caller's scoring (match 2,
/// mismatch -3, a gap of n bases -5 - 2n). Returns the columns (query base, reference base; `-` for
/// a gap) and how many reference bases precede the first column.
fn exact_alignment(q: &[u8], r: &[u8]) -> (Vec<(u8, u8)>, usize) {
    const NONE: i32 = i32::MIN / 4;
    let (m, n) = (q.len(), r.len());
    let w = n + 1;
    // per cell: bits 0-1 the last column of the best path to it (0 two bases, 1 a deletion, 2 an
    // insertion), bit 2 set when the deletion ending there extends one, bit 3 likewise an insertion
    let mut from = vec![0u8; (m + 1) * w];
    // row i - 1 (`_up`) and row i: the best score, and the best ending in an insertion; row 0 is free
    let (mut best_up, mut ins_up) = (vec![0i32; w], vec![NONE; w]);
    let (mut best, mut ins) = (vec![0i32; w], vec![NONE; w]);
    for i in 1..=m {
        let row = &mut from[i * w..(i + 1) * w];
        ins[0] = -5 - 2 * i as i32;
        best[0] = ins[0];
        row[0] = if i > 1 { 2 | 8 } else { 2 };
        let mut del = NONE;
        let qi = q[i - 1];
        // Raw pointers rather than indexing: an unoptimised test build checks and calls through
        // every index, which halves the speed of this loop, the bulk of these tests' time.
        let (row, rr) = (row.as_mut_ptr(), r.as_ptr());
        let (up, ins_above, here, ins_here) = (best_up.as_ptr(), ins_up.as_ptr(), best.as_mut_ptr(), ins.as_mut_ptr());
        for j in 1..=n {
            // SAFETY: the five rows hold w = n + 1 cells and `r` n bases, so j and j - 1 are in
            // bounds; `here` and `ins_here` point into other vectors than `up` and `ins_above`
            unsafe {
                let (open, extend) = (*up.add(j) - 7, *ins_above.add(j) - 2);
                let (iv, ib) = if extend > open { (extend, 8u8) } else { (open, 0) };
                *ins_here.add(j) = iv;
                let (open, extend) = (*here.add(j - 1) - 7, del - 2);
                let (dv, db) = if extend > open { (extend, 4u8) } else { (open, 0) };
                del = dv;
                let diagonal = *up.add(j - 1) + if qi == *rr.add(j - 1) { 2 } else { -3 };
                let (bv, bb) = if diagonal >= dv && diagonal >= iv {
                    (diagonal, 0u8)
                } else if dv >= iv {
                    (dv, 1)
                } else {
                    (iv, 2)
                };
                *here.add(j) = bv;
                *row.add(j) = bb | db | ib;
            }
        }
        std::mem::swap(&mut best, &mut best_up);
        std::mem::swap(&mut ins, &mut ins_up);
    }
    // the reference after the sample is free: end in the best cell of the last row
    let mut j = (0..=n).max_by_key(|&j| (best_up[j], std::cmp::Reverse(j))).unwrap();
    let (mut i, mut state) = (m, 0u8);
    let mut cols = Vec::with_capacity(m + 64);
    while i > 0 {
        let cell = from[i * w + j];
        match state {
            0 => match cell & 3 {
                0 => {
                    cols.push((q[i - 1], r[j - 1]));
                    i -= 1;
                    j -= 1;
                }
                s => state = s,
            },
            1 => {
                cols.push((b'-', r[j - 1]));
                state = if cell & 4 != 0 { 1 } else { 0 };
                j -= 1;
            }
            _ => {
                cols.push((q[i - 1], b'-'));
                state = if cell & 8 != 0 { 2 } else { 0 };
                i -= 1;
            }
        }
    }
    cols.reverse();
    (cols, j)
}

/// The VCF calls of alignment `cols` against `r`, `offset` reference bases preceding its first
/// column: a run of mismatched columns is a SNP or MNP at its first base, and an insertion or
/// deletion is anchored on the reference base before it and left-normalised as VCF normalisation
/// does it, moved left while its last base equals that anchor base.
fn calls_of(cols: &[(u8, u8)], offset: usize, r: &[u8]) -> Vec<Call> {
    let mut calls = Vec::new();
    let mut pos = offset;
    let mut c = 0usize;
    while c < cols.len() {
        let (qb, rb) = cols[c];
        if qb != b'-' && rb != b'-' {
            if qb == rb {
                pos += 1;
                c += 1;
                continue;
            }
            let s = c;
            while c < cols.len() && cols[c].0 != b'-' && cols[c].1 != b'-' && cols[c].0 != cols[c].1 {
                c += 1;
            }
            let (refa, alt): (Vec<u8>, Vec<u8>) = cols[s..c].iter().map(|&(a, b)| (b, a)).unzip();
            calls.push((pos + 1, text(&refa), text(&alt), if c - s == 1 { "SNP" } else { "MNP" }.into()));
            pos += c - s;
            continue;
        }
        let del = qb == b'-';
        let s = c;
        while c < cols.len() && if del { cols[c].0 == b'-' } else { cols[c].1 == b'-' } {
            c += 1;
        }
        let mut indel: Vec<u8> = cols[s..c].iter().map(|&(a, b)| if del { b } else { a }).collect();
        assert!(pos > 0, "an indel before the first reference base");
        let mut anchor = pos;
        while anchor > 1 && indel.last() == Some(&r[anchor - 1]) {
            indel.rotate_right(1);
            anchor -= 1;
        }
        let a = r[anchor - 1];
        let with_anchor = [&[a][..], &indel].concat();
        let (refa, alt) = if del { (with_anchor, vec![a]) } else { (vec![a], with_anchor) };
        calls.push((anchor, text(&refa), text(&alt), if del { "DEL" } else { "INS" }.into()));
        if del {
            pos += c - s;
        }
    }
    calls
}

/// One planted edit at a 0-based reference position.
#[derive(Clone, Copy, Debug)]
enum Edit {
    /// the base there replaced by its transition
    Snp(usize),
    /// this many random bases inserted before the base there
    Ins(usize, usize),
    /// this many bases deleted from there on
    Del(usize, usize),
}

/// A sample copying `r[from..to]` with `edits` (in order, apart, inside that span) made, the
/// reference it was made from, and the call each edit must produce. Every indel is made where it
/// cannot slide: an inserted run's first and last bases differ from the reference bases after and
/// before it, and the deleted run's own end bases are set to differ from the bases beside it.
fn plant(mut r: Vec<u8>, from: usize, to: usize, edits: &[Edit], seed: u64) -> (Vec<u8>, Vec<u8>, Vec<Call>) {
    for e in edits {
        if let Edit::Del(p, n) = *e {
            assert!(n >= 2);
            if r[p + n - 1] == r[p - 1] {
                r[p + n - 1] = other_than(r[p - 1], r[p - 1]);
            }
            if r[p] == r[p + n] {
                r[p] = other_than(r[p + n], r[p + n]);
            }
        }
    }
    let mut filler = genome(4 * (to - from) + 4_000, seed).into_iter();
    let mut sample = Vec::with_capacity(to - from + 8_000);
    let mut calls = Vec::new();
    let mut copied = from;
    for e in edits {
        match *e {
            Edit::Snp(p) => {
                sample.extend_from_slice(&r[copied..p]);
                let alt = substitute(r[p], false);
                sample.push(alt);
                copied = p + 1;
                calls.push((p + 1, text(&r[p..p + 1]), text(&[alt]), "SNP".into()));
            }
            Edit::Ins(p, n) => {
                sample.extend_from_slice(&r[copied..p]);
                let mut ins: Vec<u8> = filler.by_ref().take(n).collect();
                ins[0] = other_than(r[p], r[p]);
                ins[n - 1] = if n == 1 { other_than(r[p], r[p - 1]) } else { other_than(r[p - 1], r[p - 1]) };
                sample.extend_from_slice(&ins);
                copied = p;
                calls.push((p, text(&r[p - 1..p]), text(&[&r[p - 1..p], &ins[..]].concat()), "INS".into()));
            }
            Edit::Del(p, n) => {
                sample.extend_from_slice(&r[copied..p]);
                copied = p + n;
                calls.push((p, text(&r[p - 1..p + n]), text(&r[p - 1..p]), "DEL".into()));
            }
        }
    }
    sample.extend_from_slice(&r[copied..to]);
    (r, sample, calls)
}

struct Fixture {
    name: String,
    reference: Vec<u8>,
    sample: Vec<u8>,
    /// reference bases the sample was copied from
    span: usize,
    /// the calls the planted edits make: the exact alignment must make them too, so the fixture is
    /// known to hold what its name says before the caller is compared with it
    planted: Vec<Call>,
}

fn fixture(name: String, len: usize, from: usize, to: usize, edits: &[Edit], seed: u64) -> Fixture {
    let (reference, sample, planted) = plant(genome(len, seed), from, to, edits, seed ^ 0x1D3);
    Fixture { name, reference, sample, span: to - from, planted }
}

/// Bytes of rust-bio traceback (two a cell) a one-shot alignment of `m` against `n` bases keeps.
fn one_shot_traceback(m: usize, n: usize) -> usize {
    2 * (m + 1) * (n + 1)
}

/// A way to call a fixture's variants, and its name in a failure.
type Caller<'a> = (&'a str, fn(&Fixture) -> Vec<Call>);

/// Aligns each fixture exactly and calls it with each of `callers`, on as many threads as the
/// machine has; returns a line for every fixture whose exact alignment does not make its planted
/// calls, and for every caller whose calls differ from the exact alignment's.
fn differences_from_exact(fixtures: &[Fixture], callers: &[Caller]) -> Vec<String> {
    let _alongside = ALLOCATION_PROBE.read().unwrap_or_else(|e| e.into_inner());
    let next = AtomicUsize::new(0);
    let found = std::sync::Mutex::new(Vec::new());
    let threads = std::thread::available_parallelism().map_or(2, |n| n.get()).min(fixtures.len());
    std::thread::scope(|s| {
        for _ in 0..threads {
            s.spawn(|| {
                while let Some(f) = fixtures.get(next.fetch_add(1, Ordering::Relaxed)) {
                    let (cols, offset) = exact_alignment(&f.sample, &f.reference);
                    let exact = calls_of(&cols, offset, &f.reference);
                    let mut lines = Vec::new();
                    if exact != f.planted {
                        lines.push(format!("{}: the exact alignment makes {:?}, not the planted {:?}", f.name, short(&exact), short(&f.planted)));
                    }
                    for (how, call) in callers {
                        let got = call(f);
                        if got != exact {
                            lines.push(format!("{} {how}: the caller makes {:?} where the exact alignment makes {:?}", f.name, short(&got), short(&exact)));
                        }
                    }
                    found.lock().unwrap().extend(lines);
                }
            });
        }
    });
    found.into_inner().unwrap()
}

/// A call with long alleles shortened to their length, for a readable failure.
fn short(calls: &[Call]) -> Vec<(usize, String, String, String)> {
    let cut = |s: &String| if s.len() > 14 { format!("{}..({} bp)", &s[..6], s.len()) } else { s.clone() };
    calls.iter().take(12).map(|(p, r, a, t)| (*p, cut(r), cut(a), t.clone())).collect()
}

fn report_calls(rep: &molbiocraft_align::FreeBayesVariantReport) -> Vec<Call> {
    rep.variants
        .iter()
        .map(|v| (v.position_bp, v.ref_allele.clone(), v.alt_allele.clone(), v.variant_type.clone()))
        .collect()
}

fn in_segments(f: &Fixture) -> Vec<Call> {
    report_calls(&call_freebayes_variants_with_one_shot_limit("ref", &text(&f.reference), &text(&f.sample), 0))
}

fn as_shipped(f: &Fixture) -> Vec<Call> {
    report_calls(&call_freebayes_variants("ref", &text(&f.reference), &text(&f.sample)))
}

/// Reference bases before and after each probe sample, so the caller's window starts inside the
/// reference and its free-prefix offset is part of every position.
const PROBE_FLANK: usize = 300;

/// A sample carrying one insertion of `len` bases, or a deletion of `len` bases with an insertion
/// of `len` bases further on that keeps the sample in step with its reference window, starting
/// `delta` sample bases past a seam of the caller's segments (they fall every 1,000 sample bases
/// where the sample matches, and it matches before the indel): the first such seam at least `len`
/// + 600 bases in. With `delta` from -500 on, each indel has more than `len` + 2 matched bases on
/// each side (158 more at the least), the matched sequence the one-shot alignment's 11-mer chain
/// needs to bridge it (its gap costs 5 + 2 x `len`, each matched base earns 2), so a probe
/// isolates what the seams do.
fn probe(len: usize, delta: isize, deletion: bool, seed: u64) -> Fixture {
    let seam = (len + 600).div_ceil(1_000) * 1_000;
    let p = (PROBE_FLANK + seam).checked_add_signed(delta).unwrap();
    let tail = len + 300;
    let (edits, to) = if deletion {
        // matched bases between the deletion and its compensating insertion: enough that the exact
        // alignment calls the two rather than pairing the deleted and inserted runs off as
        // mismatches (each probe's planted calls are checked against the exact alignment's)
        let between = len + len / 5 + 100;
        let back = p + len + between;
        (vec![Edit::Del(p, len), Edit::Ins(back, len)], back + tail)
    } else {
        (vec![Edit::Ins(p, len)], p + tail)
    };
    let kind = if deletion { "deletion (net zero)" } else { "insertion" };
    fixture(format!("{len}-bp {kind} at sample base {seam}{delta:+}"), to + PROBE_FLANK, PROBE_FLANK, to, &edits, seed)
}

#[test]
fn segments_call_long_indels_at_and_across_seams_as_an_exact_alignment_does() {
    let mut fixtures = Vec::new();
    for (i, len) in [300usize, 500, 1_000, 2_000].into_iter().enumerate() {
        // 500 sample bases before the seam (it then falls inside the 1,000- and 2,000-bp
        // insertions), 17 before it, at it, one past it, and 15 and 16 past it, either side of the
        // 16 matched bases a seam needs after it
        for (d, delta) in [-500isize, -17, 0, 1, 15, 16].into_iter().enumerate() {
            for deletion in [false, true] {
                let seed = 0x5EA4_0000 + (i * 100 + d * 2 + deletion as usize) as u64;
                fixtures.push(probe(len, delta, deletion, seed));
            }
        }
    }
    let differences = differences_from_exact(&fixtures, &[("in segments", in_segments)]);
    assert!(differences.is_empty(), "{} of {} probes:\n{}", differences.len(), fixtures.len(), differences.join("\n"));
}

#[test]
fn calls_long_indels_below_the_one_shot_limit_as_an_exact_alignment_does() {
    let mut fixtures = Vec::new();
    for (i, len) in [500usize, 1_000, 2_000].into_iter().enumerate() {
        for deletion in [false, true] {
            fixtures.push(probe(len, 0, deletion, 0x5EB0_0000 + (i * 2 + deletion as usize) as u64));
        }
    }
    // a 6 kb sample with a 450-bp insertion near its start, and a 10 kb one with a 2,000-bp
    // insertion and a SNP after it: samples shaped like the two the review of the first fix found
    // miscalled
    fixtures.push(fixture("6 kb, 450-bp insertion at 775".into(), 6_000, 0, 6_000, &[Edit::Snp(400), Edit::Ins(775, 450), Edit::Snp(5_200)], 0x5EB1));
    fixtures.push(fixture("10 kb, 2,000-bp insertion".into(), 10_000, 0, 10_000, &[Edit::Snp(1_500), Edit::Ins(4_000, 2_000), Edit::Snp(8_500)], 0x5EB2));
    for f in &fixtures {
        assert!(
            one_shot_traceback(f.sample.len(), f.reference.len()) <= CALL_ONE_SHOT_MAX_BYTES,
            "{}: past the one-shot limit",
            f.name
        );
    }
    let differences = differences_from_exact(&fixtures, &[("as shipped", as_shipped)]);
    assert!(differences.is_empty(), "{} of {} samples:\n{}", differences.len(), fixtures.len(), differences.join("\n"));
}

#[test]
fn calls_long_indels_past_the_one_shot_limit_as_an_exact_alignment_does() {
    let fixtures = [
        fixture(
            "15 kb: 2,000-bp insertion, 1,000-bp deletion and insertion, 500-bp insertion".into(),
            14_500,
            300,
            14_200,
            &[
                Edit::Snp(1_200),
                Edit::Ins(3_000, 2_000),
                Edit::Snp(5_500),
                Edit::Del(7_000, 1_000),
                Edit::Ins(9_650, 1_000),
                Edit::Snp(11_300),
                Edit::Ins(12_200, 500),
            ],
            0x5EC1,
        ),
        fixture(
            "13 kb: 2,000-bp deletion and insertion, 1,000-bp and 300-bp insertions".into(),
            13_500,
            0,
            13_500,
            &[
                Edit::Del(2_600, 2_000),
                Edit::Ins(7_500, 2_000),
                Edit::Snp(8_300),
                Edit::Ins(9_300, 1_000),
                Edit::Ins(11_700, 300),
            ],
            0x5EC2,
        ),
    ];
    for f in &fixtures {
        // the window the caller aligns covers at least the span the sample was copied from
        assert!(one_shot_traceback(f.sample.len(), f.span) > CALL_ONE_SHOT_MAX_BYTES, "{}: within the one-shot limit", f.name);
    }
    let differences = differences_from_exact(&fixtures, &[("as shipped", as_shipped)]);
    assert!(differences.is_empty(), "{} of {} samples:\n{}", differences.len(), fixtures.len(), differences.join("\n"));
}

/// A reference with `units` copies of `unit` from 0-based `at`, the bases beside the repeat set so
/// it ends there (the base before differs from the unit's last base, the base after from its
/// first), and samples copying it with one indel in the repeat's middle: each deletion of
/// `deletions` units, then each insertion of `insertions` units. The planted call is the indel at
/// the repeat's left end, anchored on the base before it, where VCF normalisation places it.
#[allow(clippy::too_many_arguments)]
fn repeat_fixtures(name: &str, len: usize, at: usize, unit: &[u8], units: usize, deletions: &[usize], insertions: &[usize], seed: u64) -> Vec<Fixture> {
    let mut r = genome(len, seed);
    for c in 0..units {
        r[at + c * unit.len()..at + (c + 1) * unit.len()].copy_from_slice(unit);
    }
    let end = at + units * unit.len();
    r[at - 1] = other_than(unit[unit.len() - 1], unit[unit.len() - 1]);
    r[end] = other_than(unit[0], unit[0]);
    let middle = at + units / 2 * unit.len() + unit.len() / 3;
    let anchor = r[at - 1];
    let mut out = Vec::new();
    for (&n, deletion) in deletions.iter().map(|n| (n, true)).chain(insertions.iter().map(|n| (n, false))) {
        let run = unit.repeat(n);
        // the run the sample gains, read from the repeat at `middle`
        let shifted: Vec<u8> = (0..n * unit.len()).map(|i| r[middle + i]).collect();
        let sample = if deletion {
            [&r[..middle], &r[middle + n * unit.len()..]].concat()
        } else {
            [&r[..middle], &shifted[..], &r[middle..]].concat()
        };
        let with_anchor = [&[anchor][..], &run].concat();
        let call = if deletion {
            (at, text(&with_anchor), text(&[anchor]), "DEL".to_string())
        } else {
            (at, text(&[anchor]), text(&with_anchor), "INS".to_string())
        };
        let kind = if deletion { "deletion" } else { "insertion" };
        out.push(Fixture {
            name: format!("{name}: {}-bp {kind} at base {middle}", n * unit.len()),
            reference: r.clone(),
            sample,
            span: len,
            planted: vec![call],
        });
    }
    out
}

#[test]
fn indels_in_a_tandem_repeat_are_called_at_its_left_end_wherever_a_seam_falls() {
    // a 900-bp (ACGTTG)n repeat from 2,698, across the sample's third seam
    let short_unit = repeat_fixtures("(ACGTTG)150", 6_000, 2_698, b"ACGTTG", 150, &[1, 2], &[1], 0x5ED1);
    // repeats of six and of nine copies of a 150-bp unit, at three offsets across that seam, whose
    // 11-mers the caller's chain keeps, so seams can fall inside them
    let unit = genome(150, 0x5ED2);
    let mut long_unit = Vec::new();
    for (i, at) in [2_600usize, 2_750, 2_900].into_iter().enumerate() {
        for copies in [6usize, 9] {
            let name = format!("{copies} x 150 bp at {at}");
            long_unit.extend(repeat_fixtures(&name, 7_000, at, &unit, copies, &[1], &[1], 0x5ED3 + (i * 10 + copies) as u64));
        }
    }
    // 300 copies of a 24-bp unit (7.2 kb): its 11-mers match 2.16 million times, past the 2,000,000
    // the caller's chain is found among, so the chain keeps only the rotations of the unit with 299
    // copies, its jump falls near the array's right end, and a seam falls inside the array before it
    let array = genome(24, 0x5ED5);
    let partly_chained = repeat_fixtures("(24 bp)300", 10_000, 1_400, &array, 300, &[1], &[1], 0x5ED6);
    // past the one-shot limit: a 13 kb sample with the (ACGTTG)n repeat, and a 17 kb one with 600
    // copies of the 24-bp unit, none of whose 11-mers the chain keeps
    let mut long = repeat_fixtures("(ACGTTG)150 in 13 kb", 13_000, 2_698, b"ACGTTG", 150, &[1], &[], 0x5ED4);
    long.extend(repeat_fixtures("(24 bp)600", 17_200, 1_400, &array, 600, &[1], &[1], 0x5ED7));
    for f in &long {
        assert!(one_shot_traceback(f.sample.len(), f.span) > CALL_ONE_SHOT_MAX_BYTES, "{}: within the one-shot limit", f.name);
    }
    let differences: Vec<String> = std::thread::scope(|s| {
        [
            s.spawn(|| differences_from_exact(&short_unit, &[("as shipped", as_shipped), ("in segments", in_segments)])),
            s.spawn(|| differences_from_exact(&partly_chained, &[("as shipped", as_shipped), ("in segments", in_segments)])),
            s.spawn(|| differences_from_exact(&long_unit, &[("in segments", in_segments)])),
            s.spawn(|| differences_from_exact(&long, &[("as shipped", as_shipped)])),
        ]
        .into_iter()
        .flat_map(|h| h.join().unwrap())
        .collect()
    });
    assert!(differences.is_empty(), "{}", differences.join("\n"));
}

#[test]
fn a_long_low_complexity_run_keeps_the_largest_allocation_bounded() {
    let _measuring = ALLOCATION_PROBE.write().unwrap_or_else(|e| e.into_inner());
    // 4,000 bases of poly-A in a 40 kb reference: every 11-mer of it is in the reference 4,000
    // times, so a chain of every 11-mer match would hold 16 million matches (128 MB)
    let mut r = genome(40_000, 0x5EE1);
    r[20_000..24_000].fill(b'A');
    let snps: Vec<Edit> = (1..20).map(|i| Edit::Snp(i * 1_997)).filter(|e| !matches!(e, Edit::Snp(p) if (19_900..24_100).contains(p))).collect();
    let (reference, sample, planted) = plant(r, 0, 40_000, &snps, 0x5EE2);
    LARGEST_REQUEST.store(0, Ordering::Relaxed);
    let rep = call_freebayes_variants("ref", &text(&reference), &text(&sample));
    let largest = LARGEST_REQUEST.load(Ordering::Relaxed);
    assert!(largest <= ALLOCATION_BOUND, "one allocation of {largest} bytes, over the {ALLOCATION_BOUND}-byte bound");
    assert_eq!(report_calls(&rep), planted);
}

#[test]
fn samples_within_the_one_shot_limit_are_aligned_in_one_piece_as_before() {
    let _measuring = ALLOCATION_PROBE.write().unwrap_or_else(|e| e.into_inner());
    // samples the length of their reference, so the window the caller aligns is the reference
    for (len, one_piece) in [(11_000usize, true), (12_000, false)] {
        let snps: Vec<Edit> = (1..len / 1_000).map(|i| Edit::Snp(i * 997)).collect();
        let (reference, sample, planted) = plant(genome(len, 0x5EF0 + len as u64), 0, len, &snps, 0x5EF1);
        let one_shot = one_shot_traceback(sample.len(), reference.len());
        assert_eq!(one_shot <= CALL_ONE_SHOT_MAX_BYTES, one_piece, "{len} bp: the fixture is on the wrong side of the limit");
        LARGEST_REQUEST.store(0, Ordering::Relaxed);
        let rep = call_freebayes_variants("ref", &text(&reference), &text(&sample));
        let largest = LARGEST_REQUEST.load(Ordering::Relaxed);
        if one_piece {
            // one rust-bio banded alignment of the whole sample keeps the whole matrix as traceback
            assert!(largest >= one_shot, "{len} bp: largest allocation {largest} bytes, not the one-shot traceback of {one_shot}");
        } else {
            assert!(largest <= ALLOCATION_BOUND, "{len} bp: one allocation of {largest} bytes, over the {ALLOCATION_BOUND}-byte bound");
        }
        assert_eq!(report_calls(&rep), planted, "{len} bp");
    }
}

#[test]
fn a_sample_whose_end_has_no_seam_keeps_its_last_segment_within_the_limit() {
    let _measuring = ALLOCATION_PROBE.write().unwrap_or_else(|e| e.into_inner());
    // A 3,000-bp insertion makes the window run 3,200 reference bases past the sample's end, and a
    // SNP every 25 bases over the sample's last 5,000 leaves no matched stretch a seam can fall in.
    // The last cut then falls after the chain 11-mer that ends the sample; a last segment running on
    // through those 3,200 bases would keep 2 x 5,017 x 8,217 bytes (82 MB) of traceback.
    let mut edits = vec![Edit::Snp(1_000), Edit::Ins(4_000, 3_000)];
    edits.extend((0..200).map(|i| Edit::Snp(10_000 + 25 * i)));
    let (reference, sample, planted) = plant(genome(20_000, 0x5F10), 0, 15_000, &edits, 0x5F11);
    assert!(one_shot_traceback(sample.len(), sample.len() + 200) > CALL_ONE_SHOT_MAX_BYTES, "within the one-shot limit");
    LARGEST_REQUEST.store(0, Ordering::Relaxed);
    let rep = call_freebayes_variants("ref", &text(&reference), &text(&sample));
    let largest = LARGEST_REQUEST.load(Ordering::Relaxed);
    assert!(largest <= ALLOCATION_BOUND, "one allocation of {largest} bytes, over the {ALLOCATION_BOUND}-byte bound");
    assert_eq!(report_calls(&rep), planted);
}

#[test]
fn a_stretch_unlike_the_reference_past_the_limit_is_aligned_within_it() {
    let _measuring = ALLOCATION_PROBE.write().unwrap_or_else(|e| e.into_inner());
    // 30 kb whose middle 13 kb is unrelated to the reference: no seam can fall in it, and one
    // segment across it would keep 2 x 14,000 x 14,000 bytes (392 MB) of traceback
    let snps = [Edit::Snp(1_000), Edit::Snp(3_000), Edit::Snp(5_000), Edit::Snp(25_000)];
    let (reference, mut sample, planted) = plant(genome(30_000, 0x5F00), 0, 30_000, &snps, 0x5F01);
    sample[6_000..19_000].copy_from_slice(&genome(13_000, 0x5F02));
    LARGEST_REQUEST.store(0, Ordering::Relaxed);
    let rep = call_freebayes_variants("ref", &text(&reference), &text(&sample));
    let largest = LARGEST_REQUEST.load(Ordering::Relaxed);
    assert!(largest <= ALLOCATION_BOUND, "one allocation of {largest} bytes, over the {ALLOCATION_BOUND}-byte bound");
    let calls = report_calls(&rep);
    assert_eq!(calls[..3], planted[..3], "the calls before the unrelated stretch");
}
