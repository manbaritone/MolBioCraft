// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Zuker minimum-free-energy folding with the full nearest-neighbour model: Turner 2004 for RNA,
//! Mathews 2004 for DNA (stacks, hairpins with terminal mismatches and special tri/tetra/hexaloops,
//! bulges, 1×1 / 1×2 / 2×2 / 1×n / 2×3 / generic interior loops with Ninio asymmetry, linear
//! multiloops and terminal AU/GU penalties), with dangling ends as ViennaRNA's default `-d2`
//! (every helix end in the exterior loop or a multiloop gets the terminal-mismatch energy of its
//! neighbouring bases) or without them (`-d0`), at 37 degrees or at any other temperature, where
//! every loop energy is re-derived from its enthalpy. Alongside the single best structure it sums
//! over all of them (McCaskill), giving the ensemble free energy, the share of the ensemble the
//! MFE structure holds and how far apart two structures drawn from it are. Results reproduce
//! `RNAfold`, `RNAfold -d0` and `RNAfold -p -T`.

use crate::fold_params::*;
use crate::fold_params_h::*;

const INF: i32 = 10_000_000;
const MAXLOOP: usize = 30;
const TURN: usize = 3;

/// The 37 degree reference temperature of both parameter sets, in kelvin.
const T_MEASURE: f64 = 310.15;
const ZERO_CELSIUS: f64 = 273.15;

/// Loop energies at the folding temperature. Owned rather than borrowed from the static tables,
/// because every table is re-derived from its enthalpy whenever the temperature is not 37 degrees.
struct Params {
    stack: Vec<i32>,
    mm_h: Vec<i32>,
    mm_i: Vec<i32>,
    mm_1n: Vec<i32>,
    mm_23: Vec<i32>,
    int11: Vec<i32>,
    int21: Vec<i32>,
    int22: Vec<i32>,
    hairpin: Vec<i32>,
    bulge: Vec<i32>,
    internal: Vec<i32>,
    ml: Vec<i32>,
    ninio: Vec<i32>,
    terminal_au: i32,
    lxc: f64,
    tetra: Vec<(&'static str, i32)>,
    tri: Vec<(&'static str, i32)>,
    hexa: Vec<(&'static str, i32)>,
    mm_ext: Vec<i32>,
    mm_multi: Vec<i32>,
    dangle5: Vec<i32>,
    dangle3: Vec<i32>,
    /// How many table units make up one dcal/mol. One for the MFE tables; the ensemble's tables
    /// are held a hundred times finer, so that rounding each rescaled energy to a whole unit
    /// costs the partition function a hundredth of what it would otherwise.
    sub_dcal: f64,
}

/// How a rescaled energy is cut back to whole dcal/mol. ViennaRNA stores the MFE tables as C
/// ints, which truncates, and keeps full precision in the Boltzmann factors of the partition
/// function; reproducing both of its numbers at a temperature other than 37 degrees means
/// matching each in turn, since the two differ by a few hundredths of a kcal/mol over a fold.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Rounding {
    /// As a C int assignment: what the MFE recursions see.
    TowardZero,
    /// As close to the real rescaled energy as a hundredth of a dcal/mol gets: what the ensemble
    /// sees, since a sum over structures feels a truncation far more than a minimum over them.
    Nearest,
}

/// Table units per dcal/mol under each rounding.
impl Rounding {
    fn sub_dcal(self) -> f64 {
        match self {
            Rounding::TowardZero => 1.0,
            Rounding::Nearest => 100.0,
        }
    }
}

/// A loop energy at temperature T, from its 37 degree value and its enthalpy — ViennaRNA's
/// `RESCALE_dG`. An entry that is unreachable at 37 degrees stays unreachable.
#[inline]
fn rescale(g37: i32, h: i32, tempf: f64, how: Rounding) -> i32 {
    if g37 >= INF || h >= INF {
        return INF;
    }
    let e = h as f64 - (h - g37) as f64 * tempf;
    match how {
        Rounding::TowardZero => e as i32,
        Rounding::Nearest => (e * 100.0).round() as i32,
    }
}

fn rescale_table(g37: &[i32], h: &[i32], tempf: f64, how: Rounding) -> Vec<i32> {
    g37.iter()
        .zip(h.iter())
        .map(|(&g, &e)| rescale(g, e, tempf, how))
        .collect()
}

fn rescale_loops(
    g37: &[(&'static str, i32)],
    h: &[(&'static str, i32)],
    tempf: f64,
    how: Rounding,
) -> Vec<(&'static str, i32)> {
    g37.iter()
        .zip(h.iter())
        .map(|(&(seq, g), &(_, e))| (seq, rescale(g, e, tempf, how)))
        .collect()
}

/// Loop energies for the given molecule at the given folding temperature in degrees Celsius.
fn params_at(dna: bool, temperature_c: f64, how: Rounding) -> Params {
    let tempf = (temperature_c + ZERO_CELSIUS) / T_MEASURE;
    macro_rules! t {
        ($rna:ident, $rna_h:ident, $dna:ident, $dna_h:ident) => {
            if dna {
                rescale_table(&$dna, &$dna_h, tempf, how)
            } else {
                rescale_table(&$rna, &$rna_h, tempf, how)
            }
        };
    }
    macro_rules! l {
        ($rna:ident, $rna_h:ident, $dna:ident, $dna_h:ident) => {
            if dna {
                rescale_loops(&$dna, &$dna_h, tempf, how)
            } else {
                rescale_loops(&$rna, &$rna_h, tempf, how)
            }
        };
    }
    Params {
        stack: t!(RNA_STACK, RNA_STACK_H, DNA_STACK, DNA_STACK_H),
        mm_h: t!(RNA_MM_HAIRPIN, RNA_MM_HAIRPIN_H, DNA_MM_HAIRPIN, DNA_MM_HAIRPIN_H),
        mm_i: t!(RNA_MM_INTERNAL, RNA_MM_INTERNAL_H, DNA_MM_INTERNAL, DNA_MM_INTERNAL_H),
        mm_1n: t!(
            RNA_MM_INTERNAL_1N,
            RNA_MM_INTERNAL_1N_H,
            DNA_MM_INTERNAL_1N,
            DNA_MM_INTERNAL_1N_H
        ),
        mm_23: t!(
            RNA_MM_INTERNAL_23,
            RNA_MM_INTERNAL_23_H,
            DNA_MM_INTERNAL_23,
            DNA_MM_INTERNAL_23_H
        ),
        int11: t!(RNA_INT11, RNA_INT11_H, DNA_INT11, DNA_INT11_H),
        int21: t!(RNA_INT21, RNA_INT21_H, DNA_INT21, DNA_INT21_H),
        int22: t!(RNA_INT22, RNA_INT22_H, DNA_INT22, DNA_INT22_H),
        hairpin: t!(RNA_HAIRPIN, RNA_HAIRPIN_H, DNA_HAIRPIN, DNA_HAIRPIN_H),
        bulge: t!(RNA_BULGE, RNA_BULGE_H, DNA_BULGE, DNA_BULGE_H),
        internal: t!(RNA_INTERNAL, RNA_INTERNAL_H, DNA_INTERNAL, DNA_INTERNAL_H),
        ml: t!(RNA_ML, RNA_ML_H, DNA_ML, DNA_ML_H),
        ninio: t!(RNA_NINIO, RNA_NINIO_H, DNA_NINIO, DNA_NINIO_H),
        terminal_au: if dna {
            rescale(DNA_TERMINAL_AU, DNA_TERMINAL_AU_H, tempf, how)
        } else {
            rescale(RNA_TERMINAL_AU, RNA_TERMINAL_AU_H, tempf, how)
        },
        lxc: (if dna { DNA_LXC } else { RNA_LXC }) * tempf * how.sub_dcal(),
        tetra: l!(RNA_TETRALOOPS, RNA_TETRALOOPS_H, DNA_TETRALOOPS, DNA_TETRALOOPS_H),
        tri: l!(RNA_TRILOOPS, RNA_TRILOOPS_H, DNA_TRILOOPS, DNA_TRILOOPS_H),
        hexa: l!(RNA_HEXALOOPS, RNA_HEXALOOPS_H, DNA_HEXALOOPS, DNA_HEXALOOPS_H),
        mm_ext: t!(RNA_MM_EXTERIOR, RNA_MM_EXTERIOR_H, DNA_MM_EXTERIOR, DNA_MM_EXTERIOR_H),
        mm_multi: t!(RNA_MM_MULTI, RNA_MM_MULTI_H, DNA_MM_MULTI, DNA_MM_MULTI_H),
        dangle5: t!(RNA_DANGLE5, RNA_DANGLE5_H, DNA_DANGLE5, DNA_DANGLE5_H),
        dangle3: t!(RNA_DANGLE3, RNA_DANGLE3_H, DNA_DANGLE3, DNA_DANGLE3_H),
        sub_dcal: how.sub_dcal(),
    }
}

fn encode(b: u8) -> usize {
    match b.to_ascii_uppercase() {
        b'A' => 1,
        b'C' => 2,
        b'G' => 3,
        b'U' | b'T' => 4,
        _ => 0,
    }
}

/// Pair type (Vienna numbering) of bases a–b, 0 if they cannot pair.
fn pair_type(a: usize, b: usize) -> usize {
    match (a, b) {
        (2, 3) => 1, // CG
        (3, 2) => 2, // GC
        (3, 4) => 3, // GU
        (4, 3) => 4, // UG
        (1, 4) => 5, // AU
        (4, 1) => 6, // UA
        _ => 0,
    }
}

fn loop_extrap(table: &[i32], n: usize, lxc: f64) -> i32 {
    if n <= MAXLOOP {
        table[n]
    } else {
        table[MAXLOOP] + (lxc * (n as f64 / MAXLOOP as f64).ln()) as i32
    }
}

struct Folder<'a> {
    p: Params,
    s: Vec<usize>,
    seq: &'a [u8],
    n: usize,
    /// ViennaRNA -d2 dangling ends
    dangles: bool,
    /// Whether the molecule closes on itself, so that position 0 follows position n-1 and the
    /// loop outside the outermost helices wraps the origin instead of hanging open at both ends.
    circular: bool,
    /// The folding temperature in kelvin, for the one loop a circular molecule has that no
    /// parameter table prices.
    temperature_k: f64,
}

impl Folder<'_> {
    /// The uppercase RNA text of a loop: its closing pair with the loop between them, `size + 2`
    /// bases read from `start` round the molecule, so a loop that wraps the origin reads the same
    /// way as one that does not.
    fn loop_text(&self, start: usize, size: usize) -> String {
        (0..(size + 2))
            .map(|k| match self.seq[(start + k) % self.n].to_ascii_uppercase() {
                b'T' => 'U',
                c => c as char,
            })
            .collect()
    }

    /// A hairpin loop of `size` unpaired bases closed by a pair of type `t`, whose neighbours
    /// inside the loop are `si1` (3' of the closing pair's first base) and `sj1` (5' of its
    /// second). `start` is where the closing pair's first base sits, for the special tri-, tetra-
    /// and hexaloops that are looked up by sequence rather than computed.
    fn hairpin_energy(&self, size: usize, t: usize, si1: usize, sj1: usize, start: usize) -> i32 {
        let p = &self.p;
        let mut e = loop_extrap(&p.hairpin, size, p.lxc);
        if size < 3 {
            return e;
        }
        let special = |table: &[(&'static str, i32)]| -> Option<i32> {
            let text = self.loop_text(start, size);
            table.iter().find(|(s, _)| *s == text).map(|(_, en)| *en)
        };
        if size == 4 {
            if let Some(en) = special(&p.tetra) {
                return en;
            }
        } else if size == 6 {
            if let Some(en) = special(&p.hexa) {
                return en;
            }
        } else if size == 3 {
            if let Some(en) = special(&p.tri) {
                return en;
            }
            return e + if t > 2 { p.terminal_au } else { 0 };
        }
        e += p.mm_h[t * 25 + si1 * 5 + sj1];
        e
    }

    fn hairpin(&self, i: usize, j: usize, t: usize) -> i32 {
        self.hairpin_energy(j - i - 1, t, self.s[i + 1], self.s[j - 1], i)
    }

    /// One position back round the molecule, and one position on.
    fn back(&self, i: usize) -> usize {
        (i + self.n - 1) % self.n
    }
    fn fwd(&self, i: usize) -> usize {
        (i + 1) % self.n
    }

    /// A circular molecule whose only helix is (i, j): everything outside that helix is one
    /// hairpin loop, closed by the same pair read the other way round.
    fn exterior_hairpin(&self, i: usize, j: usize) -> i32 {
        let t = pair_type(self.s[j], self.s[i]);
        let size = self.n - (j - i + 1);
        self.hairpin_energy(size, t, self.s[self.fwd(j)], self.s[self.back(i)], j)
    }

    /// Loop closed by (i, j) with inner pair (k, l).
    fn interior(&self, i: usize, j: usize, k: usize, l: usize) -> i32 {
        self.interior_energy(
            pair_type(self.s[i], self.s[j]),
            pair_type(self.s[l], self.s[k]),
            k - i - 1,
            j - l - 1,
            self.s[i + 1],
            self.s[j - 1],
            self.s[k - 1],
            self.s[l + 1],
        )
    }

    /// A circular molecule whose only two helices are (i, j) and (p, q), with i < j < p < q:
    /// everything outside them is one interior loop, with `p - j - 1` unpaired bases on one side
    /// and the stretch that wraps the origin on the other. Both pairs are read from outside, so
    /// both pair types are the reversed ones.
    fn exterior_interior(&self, i: usize, j: usize, p: usize, q: usize) -> i32 {
        self.interior_energy(
            pair_type(self.s[j], self.s[i]),
            pair_type(self.s[q], self.s[p]),
            p - j - 1,
            i + self.n - 1 - q,
            self.s[self.fwd(j)],
            self.s[self.back(i)],
            self.s[p - 1],
            self.s[self.fwd(q)],
        )
    }

    /// An interior loop between a closing pair of type `t` and an enclosed pair of type `t2`
    /// (read from inside the loop, so reversed), with `n1` and `n2` unpaired bases on the two
    /// sides and `si1`/`sj1`, `sp1`/`sq1` the four bases facing into it.
    #[allow(clippy::too_many_arguments)]
    fn interior_energy(
        &self,
        t: usize,
        t2: usize,
        n1: usize,
        n2: usize,
        si1: usize,
        sj1: usize,
        sp1: usize,
        sq1: usize,
    ) -> i32 {
        let p = &self.p;
        let (nl, ns) = (n1.max(n2), n1.min(n2));
        if nl == 0 {
            return p.stack[t * 8 + t2];
        }
        if ns == 0 {
            let mut e = loop_extrap(&p.bulge, nl, p.lxc);
            if nl == 1 {
                e += p.stack[t * 8 + t2];
            } else {
                if t > 2 {
                    e += p.terminal_au;
                }
                if t2 > 2 {
                    e += p.terminal_au;
                }
            }
            return e;
        }
        let ninio = |d: usize| (p.ninio[0] * d as i32).min(p.ninio[1]);
        if ns == 1 {
            if nl == 1 {
                return p.int11[(t * 8 + t2) * 25 + si1 * 5 + sj1];
            }
            if nl == 2 {
                return if n1 == 1 {
                    p.int21[(t * 8 + t2) * 125 + si1 * 25 + sq1 * 5 + sj1]
                } else {
                    p.int21[(t2 * 8 + t) * 125 + sq1 * 25 + si1 * 5 + sp1]
                };
            }
            let mut e = loop_extrap(&p.internal, nl + 1, p.lxc);
            e += ninio(nl - ns);
            e += p.mm_1n[t * 25 + si1 * 5 + sj1] + p.mm_1n[t2 * 25 + sq1 * 5 + sp1];
            return e;
        }
        if ns == 2 {
            if nl == 2 {
                return p.int22[(t * 8 + t2) * 625 + si1 * 125 + sp1 * 25 + sq1 * 5 + sj1];
            }
            if nl == 3 {
                let mut e = p.internal[5] + p.ninio[0];
                e += p.mm_23[t * 25 + si1 * 5 + sj1] + p.mm_23[t2 * 25 + sq1 * 5 + sp1];
                return e;
            }
        }
        let u = nl + ns;
        let mut e = loop_extrap(&p.internal, u, p.lxc);
        e += ninio(nl - ns);
        e += p.mm_i[t * 25 + si1 * 5 + sj1] + p.mm_i[t2 * 25 + sq1 * 5 + sp1];
        e
    }

    /// Multiloop branch of pair type `t` with neighbours n5 / n3.
    fn ml_stem(&self, t: usize, n5: Option<usize>, n3: Option<usize>) -> i32 {
        self.p.ml[2] + self.dangle(&self.p.mm_multi, t, n5, n3) + if t > 2 { self.p.terminal_au } else { 0 }
    }

    /// Terminal mismatch / dangle of a helix end with neighbours `n5` (5′ of the pair's first
    /// base) and `n3` (3′ of its second base), as ViennaRNA `E_ExtLoop` / `E_MLstem` with -d2.
    fn dangle(&self, mm: &[i32], t: usize, n5: Option<usize>, n3: Option<usize>) -> i32 {
        if !self.dangles {
            return 0;
        }
        let p = &self.p;
        match (n5.map(|k| self.s[k]), n3.map(|k| self.s[k])) {
            (Some(a), Some(b)) => mm[t * 25 + a * 5 + b],
            (Some(a), None) => p.dangle5[t * 5 + a],
            (None, Some(b)) => p.dangle3[t * 5 + b],
            (None, None) => 0,
        }
    }
    /// Exterior-loop helix closed by (i, j).
    fn ext_stem(&self, t: usize, i: usize, j: usize) -> i32 {
        let n5 = (i > 0).then(|| i - 1);
        let n3 = (j + 1 < self.n).then(|| j + 1);
        self.dangle(&self.p.mm_ext, t, n5, n3) + if t > 2 { self.p.terminal_au } else { 0 }
    }
    /// A branch (i, j) inside a multiloop. On a circular molecule the bases either side of the
    /// branch are always there, because the ends of the strand are neighbours.
    fn ml_branch(&self, t: usize, i: usize, j: usize) -> i32 {
        let n5 = (i > 0 || self.circular).then(|| self.back(i));
        let n3 = (j + 1 < self.n || self.circular).then(|| self.fwd(j));
        self.ml_stem(t, n5, n3)
    }
    /// The closing pair (i, j) of a multiloop, seen from inside (reversed pair type).
    fn ml_closing(&self, tc: usize, i: usize, j: usize) -> i32 {
        self.ml_stem(tc, Some(j - 1), Some(i + 1))
    }

    /// Returns (MFE in dcal/mol, pair table).
    /// The inside matrices, which do not care whether the molecule is circular: what a helix
    /// encloses is the same either way. `v[i][j]` is the best structure closed by the pair
    /// (i, j), `wm[i][j]` a stretch of multiloop holding at least one branch, and `wm1[i][j]` one
    /// holding exactly one, which opens at `i` and is followed by unpaired bases.
    fn fill(&self) -> (Vec<i32>, Vec<i32>, Vec<i32>) {
        let n = self.n;
        let idx = |i: usize, j: usize| i * n + j;
        let mut v = vec![INF; n * n];
        let mut wm = vec![INF; n * n];
        let mut wm1 = vec![INF; n * n];
        let (cu, cc) = (self.p.ml[0], self.p.ml[1]);
        for d in (TURN + 1)..n {
            for i in 0..(n - d) {
                let j = i + d;
                let t = pair_type(self.s[i], self.s[j]);
                if t != 0 {
                    let mut best = self.hairpin(i, j, t);
                    for k in (i + 1)..j.min(i + MAXLOOP + 2) {
                        let n1 = k - i - 1;
                        if n1 > MAXLOOP {
                            break;
                        }
                        let min_l = (k + TURN + 1).max(j.saturating_sub(MAXLOOP - n1 + 1));
                        for l in (min_l..j).rev() {
                            if v[idx(k, l)] >= INF || pair_type(self.s[k], self.s[l]) == 0 {
                                continue;
                            }
                            let e = self.interior(i, j, k, l) + v[idx(k, l)];
                            best = best.min(e);
                        }
                    }
                    // multiloop closed by (i, j): at least two branches inside
                    let tc = pair_type(self.s[j], self.s[i]);
                    for u in (i + TURN + 2)..(j - TURN - 1) {
                        let a = wm[idx(i + 1, u)];
                        let b = wm[idx(u + 1, j - 1)];
                        if a < INF && b < INF {
                            best = best.min(a + b + cc + self.ml_closing(tc, i, j));
                        }
                    }
                    v[idx(i, j)] = best;
                }
                // WM: part of a multiloop with ≥ 1 branch
                let mut m = INF;
                if v[idx(i, j)] < INF {
                    m = m.min(v[idx(i, j)] + self.ml_branch(t, i, j));
                }
                if wm[idx(i + 1, j)] < INF {
                    m = m.min(wm[idx(i + 1, j)] + cu);
                }
                if wm[idx(i, j - 1)] < INF {
                    m = m.min(wm[idx(i, j - 1)] + cu);
                }
                for u in (i + 1)..j {
                    let a = wm[idx(i, u)];
                    let b = wm[idx(u + 1, j)];
                    if a < INF && b < INF {
                        m = m.min(a + b);
                    }
                }
                wm[idx(i, j)] = m;

                // WM1: exactly one branch, opening at i, with the rest of [i..j] unpaired.
                let mut m1 = INF;
                if v[idx(i, j)] < INF {
                    m1 = v[idx(i, j)] + self.ml_branch(t, i, j);
                }
                if j > i && wm1[idx(i, j - 1)] < INF {
                    m1 = m1.min(wm1[idx(i, j - 1)] + cu);
                }
                wm1[idx(i, j)] = m1;
            }
        }
        (v, wm, wm1)
    }

    /// Returns (MFE in dcal/mol, pair table).
    fn fold(&self) -> (i32, Vec<Option<usize>>) {
        let (v, wm, wm1) = self.fill();
        if self.circular {
            self.fold_circular(&v, &wm, &wm1)
        } else {
            self.fold_linear(&v, &wm, &wm1)
        }
    }

    /// The exterior loop of a linear molecule: a prefix of unpaired bases and helices, left open
    /// at both ends.
    fn fold_linear(&self, v: &[i32], wm: &[i32], wm1: &[i32]) -> (i32, Vec<Option<usize>>) {
        let n = self.n;
        let idx = |i: usize, j: usize| i * n + j;
        // Exterior loop
        let mut f = vec![0i32; n + 1]; // f[j] = MFE of s[0..j)
        for j in 1..=n {
            let mut best = f[j - 1];
            let jj = j - 1;
            for i in 0..jj.saturating_sub(TURN) {
                if v[idx(i, jj)] < INF {
                    let t = pair_type(self.s[i], self.s[jj]);
                    best = best.min(f[i] + v[idx(i, jj)] + self.ext_stem(t, i, jj));
                }
            }
            f[j] = best;
        }

        let pt = self.backtrack(v, wm, wm1, &f, vec![(0, 0, n)]);
        (f[n], pt)
    }

    /// What a circular molecule pays for holding no base pairs at all. Closing a chain of n
    /// bases into a ring costs the usual polymer loop-closure entropy, (3/2)RT ln n, plus a
    /// constant: a circle is a loop even when nothing in it is paired, which is why `RNAfold -c`
    /// scores an unpairable circle at several kcal/mol rather than at zero. Neither term is in
    /// the parameter files — they price loops closed by a base pair, and this one is closed by
    /// the backbone — so the constant is the one that reproduces ViennaRNA, which it does to the
    /// last dcal/mol from 10 to 70 degrees and from 10 to 100 nucleotides.
    fn open_circle(&self) -> i32 {
        // In the table units of whichever parameter set is in hand, which the ensemble holds a
        // hundred times finer than the MFE does.
        let rt = self.temperature_k * GAS_CONSTANT_KCAL * 100.0; // dcal/mol
        let dcal = 270.0 * self.temperature_k / T_MEASURE + 1.5 * rt * (self.n as f64).ln();
        (dcal * self.p.sub_dcal).round() as i32
    }

    /// The exterior loop of a circular molecule. The helices themselves are unchanged — what a
    /// pair encloses does not know where the strand was cut — but what lies outside them is no
    /// longer an open stretch. It is a loop like any other, closed by the outermost helices from
    /// the far side, so it has to be scored as one: a hairpin when a single helix is left, an
    /// interior loop when two are, a multiloop when three or more are, or nothing at all when the
    /// molecule stays open. Follows ViennaRNA's `fold_circ`.
    fn fold_circular(&self, v: &[i32], wm: &[i32], wm1: &[i32]) -> (i32, Vec<Option<usize>>) {
        let n = self.n;
        let idx = |i: usize, j: usize| i * n + j;
        let cc = self.p.ml[1];

        // The circle with no pairs at all, which is always available but is not free.
        let mut best = self.open_circle();
        let mut seeds: Vec<(u8, usize, usize)> = Vec::new();

        for i in 0..n {
            for j in (i + TURN + 1)..n {
                if v[idx(i, j)] >= INF || pair_type(self.s[i], self.s[j]) == 0 {
                    continue;
                }
                // One helix: everything outside it is a hairpin loop.
                if n - (j - i + 1) >= TURN {
                    let e = v[idx(i, j)] + self.exterior_hairpin(i, j);
                    if e < best {
                        best = e;
                        seeds = vec![(1, i, j)];
                    }
                }
                // Two helices: everything outside them is an interior loop. Its two sides hold
                // at most MAXLOOP bases between them, which pins both helices near the origin.
                if i > MAXLOOP {
                    continue;
                }
                for p in (j + 1)..n {
                    let u1 = p - j - 1;
                    if u1 + i > MAXLOOP {
                        break;
                    }
                    for q in (p + TURN + 1)..n {
                        let u2 = i + n - 1 - q;
                        if u1 + u2 > MAXLOOP {
                            continue;
                        }
                        if v[idx(p, q)] >= INF || pair_type(self.s[p], self.s[q]) == 0 {
                            continue;
                        }
                        let e = v[idx(i, j)] + v[idx(p, q)] + self.exterior_interior(i, j, p, q);
                        if e < best {
                            best = e;
                            seeds = vec![(1, i, j), (1, p, q)];
                        }
                    }
                }
            }
        }

        // Three or more helices: a multiloop with no closing pair, so only the cost of closing
        // one. [0..i] brings at least one branch and [i+1..n-1] at least two more.
        if n > 2 * TURN + 4 {
            for i in TURN..(n - 2 * TURN - 3) {
                if wm[idx(0, i)] >= INF {
                    continue;
                }
                for u in (i + TURN + 2)..(n - TURN - 1) {
                    if wm[idx(i + 1, u)] >= INF || wm1[idx(u + 1, n - 1)] >= INF {
                        continue;
                    }
                    let e = wm[idx(0, i)] + wm[idx(i + 1, u)] + wm1[idx(u + 1, n - 1)] + cc;
                    if e < best {
                        best = e;
                        seeds = vec![(2, 0, i), (2, i + 1, u), (3, u + 1, n - 1)];
                    }
                }
            }
        }

        let pt = self.backtrack(v, wm, wm1, &[], seeds);
        (best, pt)
    }

    /// Reads a chosen case back into a pair table. `seeds` says where to start: the whole
    /// exterior prefix for a linear molecule, or the helices the circular exterior loop picked.
    fn backtrack(
        &self,
        v: &[i32],
        wm: &[i32],
        wm1: &[i32],
        f: &[i32],
        seeds: Vec<(u8, usize, usize)>,
    ) -> Vec<Option<usize>> {
        let n = self.n;
        let idx = |i: usize, j: usize| i * n + j;
        let (cu, cc) = (self.p.ml[0], self.p.ml[1]);
        let mut pt: Vec<Option<usize>> = vec![None; n];
        let mut stack = seeds;
        while let Some((kind, i, j)) = stack.pop() {
            match kind {
                0 => {
                    if j == 0 {
                        continue;
                    }
                    if f[j] == f[j - 1] {
                        stack.push((0, 0, j - 1));
                        continue;
                    }
                    let jj = j - 1;
                    let mut found = false;
                    for ii in 0..jj.saturating_sub(TURN) {
                        if v[idx(ii, jj)] < INF {
                            let t = pair_type(self.s[ii], self.s[jj]);
                            if f[j] == f[ii] + v[idx(ii, jj)] + self.ext_stem(t, ii, jj) {
                                stack.push((0, 0, ii));
                                stack.push((1, ii, jj));
                                found = true;
                                break;
                            }
                        }
                    }
                    debug_assert!(found);
                }
                1 => {
                    pt[i] = Some(j);
                    pt[j] = Some(i);
                    let t = pair_type(self.s[i], self.s[j]);
                    let e = v[idx(i, j)];
                    if e == self.hairpin(i, j, t) {
                        continue;
                    }
                    let mut done = false;
                    'outer: for k in (i + 1)..j.min(i + MAXLOOP + 2) {
                        let n1 = k - i - 1;
                        if n1 > MAXLOOP {
                            break;
                        }
                        let min_l = (k + TURN + 1).max(j.saturating_sub(MAXLOOP - n1 + 1));
                        for l in (min_l..j).rev() {
                            if v[idx(k, l)] < INF
                                && pair_type(self.s[k], self.s[l]) != 0
                                && e == self.interior(i, j, k, l) + v[idx(k, l)]
                            {
                                stack.push((1, k, l));
                                done = true;
                                break 'outer;
                            }
                        }
                    }
                    if !done {
                        let tc = pair_type(self.s[j], self.s[i]);
                        for u in (i + TURN + 2)..(j - TURN - 1) {
                            let a = wm[idx(i + 1, u)];
                            let b = wm[idx(u + 1, j - 1)];
                            if a < INF && b < INF && e == a + b + cc + self.ml_closing(tc, i, j) {
                                stack.push((2, i + 1, u));
                                stack.push((2, u + 1, j - 1));
                                break;
                            }
                        }
                    }
                }
                3 => {
                    let m = wm1[idx(i, j)];
                    let t = pair_type(self.s[i], self.s[j]);
                    if v[idx(i, j)] < INF && m == v[idx(i, j)] + self.ml_branch(t, i, j) {
                        stack.push((1, i, j));
                    } else if j > i {
                        stack.push((3, i, j - 1));
                    }
                }
                _ => {
                    let m = wm[idx(i, j)];
                    let t = pair_type(self.s[i], self.s[j]);
                    if v[idx(i, j)] < INF && m == v[idx(i, j)] + self.ml_branch(t, i, j) {
                        stack.push((1, i, j));
                    } else if i + 1 <= j && wm[idx(i + 1, j)] < INF && m == wm[idx(i + 1, j)] + cu {
                        stack.push((2, i + 1, j));
                    } else if j >= 1 && wm[idx(i, j - 1)] < INF && m == wm[idx(i, j - 1)] + cu {
                        stack.push((2, i, j - 1));
                    } else {
                        for u in (i + 1)..j {
                            let a = wm[idx(i, u)];
                            let b = wm[idx(u + 1, j)];
                            if a < INF && b < INF && m == a + b {
                                stack.push((2, i, u));
                                stack.push((2, u + 1, j));
                                break;
                            }
                        }
                    }
                }
            }
        }
        pt
    }

}

/// Free energy (kcal/mol) of an isolated stem-loop: the stacks of a `stem_len`-bp helix whose
/// outermost pair is (i, j) (0-based) plus the hairpin loop it closes, with the exterior terminal
/// AU/GU penalty — i.e. what that hairpin alone would contribute to the MFE.
pub fn stem_loop_energy(seq: &str, dna: bool, i: usize, j: usize, stem_len: usize) -> f64 {
    stem_loop_energy_at(seq, dna, 37.0, i, j, stem_len)
}

/// As [`stem_loop_energy`], at the given folding temperature in degrees Celsius.
pub fn stem_loop_energy_at(
    seq: &str,
    dna: bool,
    temperature_c: f64,
    i: usize,
    j: usize,
    stem_len: usize,
) -> f64 {
    let bytes = seq.as_bytes();
    let f = Folder { circular: false, temperature_k: temperature_c + ZERO_CELSIUS, p: params_at(dna, temperature_c, Rounding::TowardZero), s: bytes.iter().map(|&b| encode(b)).collect(), seq: bytes, n: bytes.len(), dangles: true };
    let mut e = f.ext_stem(pair_type(f.s[i], f.s[j]), i, j);
    for k in 0..stem_len.saturating_sub(1) {
        e += f.interior(i + k, j - k, i + k + 1, j - k - 1);
    }
    let (a, b) = (i + stem_len - 1, j + 1 - stem_len);
    e += f.hairpin(a, b, pair_type(f.s[a], f.s[b]));
    e as f64 / 100.0
}

/// MFE structure (dot-bracket) and energy in kcal/mol, with dangling ends as `RNAfold` (-d2).
pub fn mfe_fold(seq: &str, dna: bool) -> (String, f64, Vec<Option<usize>>) {
    mfe_fold_with_dangles(seq, dna, true)
}

/// As [`mfe_fold`]; `dangles = false` reproduces `RNAfold -d0`.
pub fn mfe_fold_with_dangles(seq: &str, dna: bool, dangles: bool) -> (String, f64, Vec<Option<usize>>) {
    mfe_fold_at(seq, dna, dangles, 37.0)
}

/// As [`mfe_fold_with_dangles`], folding at the given temperature in degrees Celsius: every loop
/// energy is re-derived from its enthalpy, reproducing `RNAfold -T`.
pub fn mfe_fold_at(
    seq: &str,
    dna: bool,
    dangles: bool,
    temperature_c: f64,
) -> (String, f64, Vec<Option<usize>>) {
    mfe_fold_full(seq, dna, dangles, temperature_c, false)
}

/// As [`mfe_fold_at`]; `circular = true` folds the molecule as a closed circle, where the loop
/// outside the outermost helices wraps the origin — ViennaRNA `RNAfold -c`.
pub fn mfe_fold_full(
    seq: &str,
    dna: bool,
    dangles: bool,
    temperature_c: f64,
    circular: bool,
) -> (String, f64, Vec<Option<usize>>) {
    let bytes = seq.as_bytes();
    let n = bytes.len();
    if n < TURN + 2 {
        return (".".repeat(n), 0.0, vec![None; n]);
    }
    let folder = Folder { circular, temperature_k: temperature_c + ZERO_CELSIUS, p: params_at(dna, temperature_c, Rounding::TowardZero), s: bytes.iter().map(|&b| encode(b)).collect(), seq: bytes, n, dangles };
    let (e, pt) = folder.fold();
    let db: String = (0..n)
        .map(|k| match pt[k] {
            Some(m) if m > k => '(',
            Some(_) => ')',
            None => '.',
        })
        .collect();
    (db, e as f64 / 100.0, pt)
}

/// Boltzmann constant times the standard temperature, in kcal/mol per K, as ViennaRNA uses it.
const GAS_CONSTANT_KCAL: f64 = 1.987_17e-3;

/// What the ensemble of all foldings looks like, rather than only its single best member.
#[derive(Debug, Clone)]
pub struct EnsembleReport {
    /// −RT ln Q over every structure the molecule can adopt. Always at or below the MFE.
    pub ensemble_free_energy_kcal_mol: f64,
    /// The share of the ensemble the MFE structure itself holds, exp((G − E)/RT).
    pub mfe_frequency: f64,
    /// Mean base-pair distance between two structures drawn from the ensemble: 0 for a molecule
    /// with one way to fold, large for one that is genuinely undecided.
    pub ensemble_diversity: f64,
    /// How many structures the diversity was estimated from.
    pub sampled_structures: usize,
}

/// Linear congruential sampler. A fixed seed keeps a report reproducible: the same sequence
/// always gives the same diversity, which a changing number would make impossible to cite.
struct Rng(u64);
impl Rng {
    fn next_f64(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        ((self.0 >> 11) as f64) / ((1u64 << 53) as f64)
    }
}

/// McCaskill inside matrices, scaled per nucleotide so a long molecule's partition function does
/// not overflow a double.
struct Inside {
    n: usize,
    /// Structures on [i..j] with (i, j) paired.
    qb: Vec<f64>,
    /// [i..j] inside a multiloop, holding at least one branch.
    qm: Vec<f64>,
    /// [i..j] inside a multiloop, holding exactly one branch, which starts at i.
    qm1: Vec<f64>,
    /// Exterior-loop prefix: structures on [0..j].
    q: Vec<f64>,
    /// scale[k] = pf_scale^-k, the factor a segment of k nucleotides carries.
    scale: Vec<f64>,
    ln_pf_scale: f64,
    kt: f64,
    /// Whether the exterior loop wraps the origin.
    circular: bool,
    /// The whole partition function of a circular molecule, summed over the four shapes its
    /// exterior loop can take.
    qc: f64,
    /// [i..j] inside a multiloop, holding at least two branches, for closing a multiloop that
    /// has no closing pair because it wraps the origin.
    qmm: Vec<f64>,
    /// Every way a circular molecule's exterior loop can be built, as a running total so that a
    /// draw from the ensemble finds its case with a search rather than another pass over the
    /// molecule: (cumulative weight, case, i, j), where case 0 is the circle with no pairs,
    /// 1 a hairpin outside one helix, 2 an interior loop outside two, 3 a multiloop outside
    /// three or more, whose last branch opens at i.
    exterior_cases: Vec<(f64, u8, usize, usize)>,
}

impl Folder<'_> {
    fn boltz(&self, e: i32, kt: f64) -> f64 {
        (-(e as f64) / self.p.sub_dcal / 100.0 / kt).exp()
    }

    /// McCaskill's inside algorithm over the same loop energies the MFE recursions use.
    ///
    /// The decomposition differs from the MFE one on purpose. Taking a minimum over overlapping
    /// cases is harmless; summing over them is not, because the same structure would be counted
    /// more than once. So a multiloop is split at its leftmost branch — `qm1` holds exactly one
    /// branch and `qm` prepends either unpaired bases or a shorter `qm` — which reaches every
    /// structure exactly once.
    fn inside(&self, kt: f64, mfe_dcal: i32) -> Inside {
        let n = self.n;
        let idx = |i: usize, j: usize| i * n + j;
        let (cu, cc) = (self.p.ml[0], self.p.ml[1]);

        // Each nucleotide carries roughly the MFE's per-nucleotide energy, pulled out of every
        // term so the sums stay near 1 instead of running off to 10^300.
        let pf_scale = (-1.07 * (mfe_dcal as f64 / 100.0) / (n as f64) / kt).exp();
        let mut scale = vec![1.0f64; n + 2];
        for k in 1..=(n + 1) {
            scale[k] = scale[k - 1] / pf_scale;
        }

        let mut qb = vec![0.0f64; n * n];
        let mut qm = vec![0.0f64; n * n];
        let mut qm1 = vec![0.0f64; n * n];

        for d in (TURN + 1)..n {
            for i in 0..(n - d) {
                let j = i + d;
                let t = pair_type(self.s[i], self.s[j]);
                if t != 0 {
                    let mut sum = self.boltz(self.hairpin(i, j, t), kt) * scale[j - i + 1];
                    for k in (i + 1)..j.min(i + MAXLOOP + 2) {
                        let n1 = k - i - 1;
                        if n1 > MAXLOOP {
                            break;
                        }
                        let min_l = (k + TURN + 1).max(j.saturating_sub(MAXLOOP - n1 + 1));
                        for l in min_l..j {
                            if qb[idx(k, l)] == 0.0 || pair_type(self.s[k], self.s[l]) == 0 {
                                continue;
                            }
                            sum += self.boltz(self.interior(i, j, k, l), kt)
                                * qb[idx(k, l)]
                                * scale[(k - i) + (j - l)];
                        }
                    }
                    // Multiloop closed by (i, j), split at the leftmost branch inside it.
                    let tc = pair_type(self.s[j], self.s[i]);
                    let closing = self.boltz(cc + self.ml_closing(tc, i, j), kt) * scale[2];
                    if j >= TURN + 2 {
                        for u in (i + TURN + 2)..(j - TURN - 1) {
                            if qm[idx(i + 1, u - 1)] != 0.0 && qm1[idx(u, j - 1)] != 0.0 {
                                sum += qm[idx(i + 1, u - 1)] * qm1[idx(u, j - 1)] * closing;
                            }
                        }
                    }
                    qb[idx(i, j)] = sum;
                }

                // Exactly one branch, opening at i.
                let mut m1 = 0.0f64;
                for l in (i + TURN + 1)..=j {
                    if qb[idx(i, l)] == 0.0 {
                        continue;
                    }
                    let tl = pair_type(self.s[i], self.s[l]);
                    m1 += qb[idx(i, l)]
                        * self.boltz(self.ml_branch(tl, i, l), kt)
                        * self.boltz(cu * (j - l) as i32, kt)
                        * scale[j - l];
                }
                qm1[idx(i, j)] = m1;

                // At least one branch: unpaired bases, or a shorter multiloop, then one branch.
                let mut m = 0.0f64;
                for k in i..=j.saturating_sub(TURN + 1) {
                    if qm1[idx(k, j)] == 0.0 {
                        continue;
                    }
                    let left = self.boltz(cu * (k - i) as i32, kt) * scale[k - i]
                        + if k > i { qm[idx(i, k - 1)] } else { 0.0 };
                    m += left * qm1[idx(k, j)];
                }
                qm[idx(i, j)] = m;
            }
        }

        // Exterior loop: q[j] over [0..j], built by whether j is paired and to what.
        let mut q = vec![0.0f64; n + 1];
        q[0] = 1.0; // q[j] is indexed by length, so q[0] is the empty prefix
        for j in 1..=n {
            let jj = j - 1;
            let mut sum = q[j - 1] * scale[1];
            for i in 0..jj.saturating_sub(TURN) {
                if qb[idx(i, jj)] == 0.0 {
                    continue;
                }
                let t = pair_type(self.s[i], self.s[jj]);
                sum += q[i] * qb[idx(i, jj)] * self.boltz(self.ext_stem(t, i, jj), kt);
            }
            q[j] = sum;
        }

        // The exterior loop of a circular molecule, as the same four cases the MFE weighs, but
        // decomposed so that no structure is reached twice: a sum over overlapping cases would
        // count one twice where a minimum over them does no harm.
        let mut qc = 0.0f64;
        let mut qmm = vec![0.0f64; n];
        let mut exterior_cases: Vec<(f64, u8, usize, usize)> = Vec::new();
        if self.circular {
            qc = self.boltz(self.open_circle(), kt) * scale[n];
            exterior_cases.push((qc, 0, 0, 0));

            for i in 0..n {
                for j in (i + TURN + 1)..n {
                    if qb[idx(i, j)] == 0.0 {
                        continue;
                    }
                    if n - (j - i + 1) >= TURN {
                        let w = qb[idx(i, j)]
                            * self.boltz(self.exterior_hairpin(i, j), kt)
                            * scale[n - (j - i + 1)];
                        if w > 0.0 {
                            qc += w;
                            exterior_cases.push((qc, 1, i, j));
                        }
                    }
                    if i > MAXLOOP {
                        continue;
                    }
                    let mut inner = 0.0f64;
                    for p in (j + 1)..n {
                        let u1 = p - j - 1;
                        if u1 + i > MAXLOOP {
                            break;
                        }
                        for q in (p + TURN + 1)..n {
                            let u2 = i + n - 1 - q;
                            if u1 + u2 > MAXLOOP || qb[idx(p, q)] == 0.0 {
                                continue;
                            }
                            inner += qb[idx(p, q)]
                                * self.boltz(self.exterior_interior(i, j, p, q), kt)
                                * scale[u1 + u2];
                        }
                    }
                    if inner > 0.0 {
                        qc += qb[idx(i, j)] * inner;
                        exterior_cases.push((qc, 2, i, j));
                    }
                }
            }

            // At least two branches in [0..j], split at the last of them.
            for j in 0..n {
                let mut m = 0.0f64;
                for u in 1..=j {
                    if qm[idx(0, u - 1)] != 0.0 && qm1[idx(u, j)] != 0.0 {
                        m += qm[idx(0, u - 1)] * qm1[idx(u, j)];
                    }
                }
                qmm[j] = m;
            }
            // Three or more, split at the last branch of all, which opens at k. Nothing closes
            // this multiloop but the backbone, so it pays the closing cost and no stem.
            let closing = self.boltz(cc, kt);
            for k in 1..n {
                if qmm[k - 1] == 0.0 || qm1[idx(k, n - 1)] == 0.0 {
                    continue;
                }
                qc += qmm[k - 1] * qm1[idx(k, n - 1)] * closing;
                exterior_cases.push((qc, 3, k, 0));
            }
        }

        Inside {
            n,
            qb,
            qm,
            qm1,
            q,
            scale,
            ln_pf_scale: pf_scale.ln(),
            kt,
            circular: self.circular,
            qc,
            qmm,
            exterior_cases,
        }
    }
}

impl Inside {
    /// −RT ln Q, with the per-nucleotide scaling taken back out.
    fn ensemble_free_energy(&self) -> f64 {
        let q = if self.circular { self.qc } else { self.q[self.n] };
        -self.kt * (q.ln() + self.n as f64 * self.ln_pf_scale)
    }
}

/// Draws the shape of a circular molecule's exterior loop, and returns what is left to fill in:
/// nothing for the circle with no pairs, the one or two helices the loop closes, or the pieces of
/// the multiloop that wraps the origin.
fn circular_exterior(f: &Folder<'_>, ins: &Inside, rng: &mut Rng) -> Vec<(u8, usize, usize)> {
    let n = ins.n;
    let idx = |i: usize, j: usize| i * n + j;
    let kt = ins.kt;
    if ins.exterior_cases.is_empty() {
        return Vec::new();
    }
    let r = rng.next_f64() * ins.qc;
    // The cases are stored as a running total, so the first one past the draw is the one picked.
    let at = ins
        .exterior_cases
        .partition_point(|(cumulative, _, _, _)| *cumulative < r)
        .min(ins.exterior_cases.len() - 1);
    let (_, case, i, j) = ins.exterior_cases[at];
    match case {
        0 => Vec::new(),
        1 => vec![(1, i, j)],
        2 => {
            // Which second helix, within the one interior loop that can reach round the origin.
            let total: f64 = {
                let mut sum = 0.0;
                for p in (j + 1)..n {
                    let u1 = p - j - 1;
                    if u1 + i > MAXLOOP {
                        break;
                    }
                    for q in (p + TURN + 1)..n {
                        let u2 = i + n - 1 - q;
                        if u1 + u2 > MAXLOOP || ins.qb[idx(p, q)] == 0.0 {
                            continue;
                        }
                        sum += ins.qb[idx(p, q)]
                            * f.boltz(f.exterior_interior(i, j, p, q), kt)
                            * ins.scale[u1 + u2];
                    }
                }
                sum
            };
            let mut r = rng.next_f64() * total;
            let mut chosen = None;
            'pick: for p in (j + 1)..n {
                let u1 = p - j - 1;
                if u1 + i > MAXLOOP {
                    break;
                }
                for q in (p + TURN + 1)..n {
                    let u2 = i + n - 1 - q;
                    if u1 + u2 > MAXLOOP || ins.qb[idx(p, q)] == 0.0 {
                        continue;
                    }
                    r -= ins.qb[idx(p, q)]
                        * f.boltz(f.exterior_interior(i, j, p, q), kt)
                        * ins.scale[u1 + u2];
                    chosen = Some((p, q));
                    if r <= 0.0 {
                        break 'pick;
                    }
                }
            }
            match chosen {
                Some((p, q)) => vec![(1, i, j), (1, p, q)],
                None => vec![(1, i, j)],
            }
        }
        _ => {
            // i is where the last branch opens; the one before it is drawn from qmm.
            let k = i;
            let mut r = rng.next_f64() * ins.qmm[k - 1];
            let mut chosen = None;
            for u in 1..k {
                if ins.qm[idx(0, u - 1)] == 0.0 || ins.qm1[idx(u, k - 1)] == 0.0 {
                    continue;
                }
                r -= ins.qm[idx(0, u - 1)] * ins.qm1[idx(u, k - 1)];
                chosen = Some(u);
                if r <= 0.0 {
                    break;
                }
            }
            match chosen {
                Some(u) => vec![(3, k, n - 1), (3, u, k - 1), (2, 0, u - 1)],
                None => vec![(3, k, n - 1)],
            }
        }
    }
}

/// One structure drawn from the ensemble with its Boltzmann probability (Ding & Lawrence): the
/// MFE backtrack again, but choosing among the cases in proportion to how much each contributes
/// rather than always taking the best.
fn sample_structure(f: &Folder<'_>, ins: &Inside, rng: &mut Rng) -> Vec<Option<usize>> {
    let n = ins.n;
    let idx = |i: usize, j: usize| i * n + j;
    let (cu, cc) = (f.p.ml[0], f.p.ml[1]);
    let kt = ins.kt;
    let mut pt: Vec<Option<usize>> = vec![None; n];
    // (kind, i, j): 0 exterior prefix of length j, 1 pair (i, j), 2 qm, 3 qm1
    let mut stack: Vec<(u8, usize, usize)> = if ins.circular {
        circular_exterior(f, ins, rng)
    } else {
        vec![(0, 0, n)]
    };

    while let Some((kind, i, j)) = stack.pop() {
        match kind {
            0 => {
                if j == 0 {
                    continue;
                }
                let jj = j - 1;
                let mut r = rng.next_f64() * ins.q[j];
                r -= ins.q[j - 1] * ins.scale[1];
                if r <= 0.0 {
                    stack.push((0, 0, j - 1));
                    continue;
                }
                let mut chosen = None;
                for k in 0..jj.saturating_sub(TURN) {
                    if ins.qb[idx(k, jj)] == 0.0 {
                        continue;
                    }
                    let t = pair_type(f.s[k], f.s[jj]);
                    r -= ins.q[k] * ins.qb[idx(k, jj)] * f.boltz(f.ext_stem(t, k, jj), kt);
                    if r <= 0.0 {
                        chosen = Some(k);
                        break;
                    }
                }
                // Rounding can exhaust the draw without a hit; the last branch is then the pick.
                let k = chosen.unwrap_or_else(|| {
                    (0..jj.saturating_sub(TURN)).rev().find(|&k| ins.qb[idx(k, jj)] != 0.0).unwrap_or(0)
                });
                if ins.qb[idx(k, jj)] == 0.0 {
                    stack.push((0, 0, j - 1));
                } else {
                    stack.push((0, 0, k));
                    stack.push((1, k, jj));
                }
            }
            1 => {
                pt[i] = Some(j);
                pt[j] = Some(i);
                let t = pair_type(f.s[i], f.s[j]);
                let mut r = rng.next_f64() * ins.qb[idx(i, j)];
                r -= f.boltz(f.hairpin(i, j, t), kt) * ins.scale[j - i + 1];
                if r <= 0.0 {
                    continue;
                }
                let mut done = false;
                'interior: for k in (i + 1)..j.min(i + MAXLOOP + 2) {
                    let n1 = k - i - 1;
                    if n1 > MAXLOOP {
                        break;
                    }
                    let min_l = (k + TURN + 1).max(j.saturating_sub(MAXLOOP - n1 + 1));
                    for l in min_l..j {
                        if ins.qb[idx(k, l)] == 0.0 || pair_type(f.s[k], f.s[l]) == 0 {
                            continue;
                        }
                        r -= f.boltz(f.interior(i, j, k, l), kt)
                            * ins.qb[idx(k, l)]
                            * ins.scale[(k - i) + (j - l)];
                        if r <= 0.0 {
                            stack.push((1, k, l));
                            done = true;
                            break 'interior;
                        }
                    }
                }
                if done {
                    continue;
                }
                let tc = pair_type(f.s[j], f.s[i]);
                let closing = f.boltz(cc + f.ml_closing(tc, i, j), kt) * ins.scale[2];
                let mut picked = false;
                if j >= TURN + 2 {
                    for u in (i + TURN + 2)..(j - TURN - 1) {
                        let w = ins.qm[idx(i + 1, u - 1)] * ins.qm1[idx(u, j - 1)] * closing;
                        if w == 0.0 {
                            continue;
                        }
                        r -= w;
                        if r <= 0.0 {
                            stack.push((2, i + 1, u - 1));
                            stack.push((3, u, j - 1));
                            picked = true;
                            break;
                        }
                    }
                }
                if !picked && j >= TURN + 2 {
                    // Numerical slack: fall back to the heaviest split rather than dropping the loop.
                    let mut best = (0.0f64, 0usize);
                    for u in (i + TURN + 2)..(j - TURN - 1) {
                        let w = ins.qm[idx(i + 1, u - 1)] * ins.qm1[idx(u, j - 1)];
                        if w > best.0 {
                            best = (w, u);
                        }
                    }
                    if best.0 > 0.0 {
                        stack.push((2, i + 1, best.1 - 1));
                        stack.push((3, best.1, j - 1));
                    }
                }
            }
            2 => {
                let mut r = rng.next_f64() * ins.qm[idx(i, j)];
                let mut picked = false;
                for k in i..=j.saturating_sub(TURN + 1) {
                    if ins.qm1[idx(k, j)] == 0.0 {
                        continue;
                    }
                    let unpaired = f.boltz(cu * (k - i) as i32, kt) * ins.scale[k - i];
                    r -= unpaired * ins.qm1[idx(k, j)];
                    if r <= 0.0 {
                        stack.push((3, k, j));
                        picked = true;
                        break;
                    }
                    if k > i {
                        r -= ins.qm[idx(i, k - 1)] * ins.qm1[idx(k, j)];
                        if r <= 0.0 {
                            stack.push((2, i, k - 1));
                            stack.push((3, k, j));
                            picked = true;
                            break;
                        }
                    }
                }
                if !picked {
                    if let Some(k) = (i..=j.saturating_sub(TURN + 1)).rev().find(|&k| ins.qm1[idx(k, j)] != 0.0) {
                        stack.push((3, k, j));
                    }
                }
            }
            _ => {
                let mut r = rng.next_f64() * ins.qm1[idx(i, j)];
                let mut picked = None;
                for l in (i + TURN + 1)..=j {
                    if ins.qb[idx(i, l)] == 0.0 {
                        continue;
                    }
                    let tl = pair_type(f.s[i], f.s[l]);
                    r -= ins.qb[idx(i, l)]
                        * f.boltz(f.ml_branch(tl, i, l), kt)
                        * f.boltz(cu * (j - l) as i32, kt)
                        * ins.scale[j - l];
                    if r <= 0.0 {
                        picked = Some(l);
                        break;
                    }
                }
                let l = picked.or_else(|| ((i + TURN + 1)..=j).rev().find(|&l| ins.qb[idx(i, l)] != 0.0));
                if let Some(l) = l {
                    stack.push((1, i, l));
                }
            }
        }
    }
    pt
}


/// The ensemble a sequence folds into, beside the single structure [`mfe_fold`] returns.
///
/// The free energy of the ensemble and the MFE structure's share of it are exact, read straight
/// off the partition function. The diversity is estimated by drawing `samples` structures from
/// the ensemble and averaging the base-pair distance between them, which converges on the exact
/// mean to about a tenth of a pair by a thousand draws.
pub fn ensemble_fold(seq: &str, dna: bool, dangles: bool, samples: usize) -> EnsembleReport {
    ensemble_fold_at(seq, dna, dangles, 37.0, samples)
}

/// As [`ensemble_fold`], at the given folding temperature in degrees Celsius.
pub fn ensemble_fold_at(
    seq: &str,
    dna: bool,
    dangles: bool,
    temperature_c: f64,
    samples: usize,
) -> EnsembleReport {
    ensemble_fold_full(seq, dna, dangles, temperature_c, false, samples)
}

/// As [`ensemble_fold_at`], over the ensemble of a circular molecule.
pub fn ensemble_fold_full(
    seq: &str,
    dna: bool,
    dangles: bool,
    temperature_c: f64,
    circular: bool,
    samples: usize,
) -> EnsembleReport {
    let bytes = seq.as_bytes();
    let n = bytes.len();
    if n < TURN + 2 {
        return EnsembleReport {
            ensemble_free_energy_kcal_mol: 0.0,
            mfe_frequency: 1.0,
            ensemble_diversity: 0.0,
            sampled_structures: 0,
        };
    }
    let folder = Folder {
        circular,
        temperature_k: temperature_c + ZERO_CELSIUS,
        p: params_at(dna, temperature_c, Rounding::TowardZero),
        s: bytes.iter().map(|&b| encode(b)).collect(),
        seq: bytes,
        n,
        dangles,
    };
    let (mfe_dcal, _) = folder.fold();
    // The ensemble is summed over the full-precision energies, the way ViennaRNA's Boltzmann
    // factors are, while the MFE above comes from the truncated ones its recursions use.
    let folder = Folder {
        p: params_at(dna, temperature_c, Rounding::Nearest),
        ..folder
    };
    let kt = (temperature_c + ZERO_CELSIUS) * GAS_CONSTANT_KCAL;
    let ins = folder.inside(kt, mfe_dcal);
    let g = ins.ensemble_free_energy();
    let e_mfe = mfe_dcal as f64 / 100.0;
    // G is at or below the MFE, so the exponent is at or below zero and the share at or below 1.
    let mfe_frequency = ((g - e_mfe) / kt).exp().min(1.0);

    let mut rng = Rng(0x5eed_1234_abcd_ef01);
    let mut pair_count = vec![0u32; n * n];
    for _ in 0..samples {
        let pt = sample_structure(&folder, &ins, &mut rng);
        for (i, partner) in pt.iter().enumerate() {
            if let Some(j) = *partner {
                if j > i {
                    pair_count[i * n + j] += 1;
                }
            }
        }
    }

    // The expected distance between two independent draws is the sum over every pair of how often
    // one draw has it and the other does not: 2·p(1−p), summed. Reading it off the pair
    // frequencies uses all the draws at once, where comparing the draws two at a time would both
    // cost a square in their number and be noisier. The m/(m−1) factor removes the downward bias
    // that estimating p from the same draws introduces.
    let m = samples as f64;
    let diversity = if samples < 2 {
        0.0
    } else {
        let sum: f64 = pair_count
            .iter()
            .map(|&c| {
                let p = c as f64 / m;
                2.0 * p * (1.0 - p)
            })
            .sum();
        sum * m / (m - 1.0)
    };

    EnsembleReport {
        ensemble_free_energy_kcal_mol: (g * 100.0).round() / 100.0,
        mfe_frequency,
        ensemble_diversity: (diversity * 100.0).round() / 100.0,
        sampled_structures: samples,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// D0005: the secondary-structure report folds at most 600 nt. A longer sequence is folded over
    /// its first 600 nt and its `warnings` names the cap and the whole length (and, for a circle,
    /// that the cut fragment was folded linear); a sequence of 600 nt written in 60-nt lines is
    /// folded whole and warns of nothing, and its JSON still carries an empty list.
    #[test]
    fn fold_cap_is_reported_as_a_warning() {
        use crate::predict_secondary_structure_with as fold;
        let mut x = 0x0f01_dcafu64;
        let seq: String = (0..1234)
            .map(|_| {
                x ^= x << 13;
                x ^= x >> 7;
                x ^= x << 17;
                b"ACGU"[(x % 4) as usize] as char
            })
            .collect();
        // 60-nt lines, as a FASTA file holds them: more characters than nucleotides
        let lines = |s: &str| -> String { s.as_bytes().chunks(60).map(|l| format!("{}\n", std::str::from_utf8(l).unwrap())).collect() };
        let (whole, first) = (lines(&seq), lines(&seq[..600]));
        assert!(first.len() > 600, "fixture: the 600-nt text is longer than 600 characters");

        let at_cap = fold(&first, "RNA", 37.0, true, false);
        assert_eq!(at_cap.length_nt, 600);
        assert!(at_cap.warnings.is_empty(), "{:?}", at_cap.warnings);
        assert_eq!(serde_json::to_value(&at_cap).unwrap()["warnings"], serde_json::json!([]));

        let over = fold(&whole, "RNA", 37.0, true, false);
        let cut = "Folding capped at 600 nt: only nucleotides 1-600 of the 1,234-nt sequence were folded.";
        assert_eq!(over.warnings, [cut]);
        assert_eq!(serde_json::to_value(&over).unwrap()["warnings"], serde_json::json!([cut]));
        // what the warning says was folded is what was folded: nucleotides 1-600, and nothing else
        let unwarned = |r: &crate::SecondaryStructureReport| {
            let mut v = serde_json::to_value(r).unwrap();
            v.as_object_mut().unwrap().remove("warnings");
            v
        };
        assert_eq!(unwarned(&over), unwarned(&at_cap));

        // a circle cut at the cap is no longer a circle: it is folded as the same linear fragment,
        // and the warning says so
        let ring = fold(&whole, "RNA", 37.0, true, true);
        assert!(!ring.circular);
        assert_eq!(ring.warnings, [format!("{cut} They were folded as a linear fragment, not as a circle.")]);
        assert_eq!(unwarned(&ring), unwarned(&over));
    }

    // Reference values: ViennaRNA 2.7.2, `RNAfold -d0` (Turner 2004) and `--noconv -d0 -P DNA` (Mathews 2004).
    #[test]
    fn reproduces_viennarna_d0_mfe() {
        let cases = [
            ("GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", false, "((((...))))(((((((....))))))).." , -14.40),
            ("GGGAAAUCCCGCGCAAAAGCGCAUUUUAAAGCGGGAAACCCGC", false, "(((....)))((((....))))........(((((...)))))", -14.60),
        ];
        for (s, dna, db_ref, e_ref) in cases {
            let (db, e, _) = mfe_fold_with_dangles(s, dna, false);
            assert_eq!(db, db_ref);
            assert!((e - e_ref).abs() < 1e-9, "{s}: {e}");
        }
        // Too short to close a hairpin.
        assert_eq!(mfe_fold("GGAC", false).1, 0.0);
    }

    /// Reference values: ViennaRNA 2.7.2 `RNAfold -c -p`, with and without dangling ends. A
    /// circular molecule's helices are filled by the same recursions as a linear one's — what a
    /// pair encloses does not know where the strand was cut — so what these check is the loop
    /// outside them: a hairpin, an interior loop or a multiloop that wraps the origin, or the
    /// bare ring when nothing pairs at all.
    #[test]
    fn folds_a_circle_like_viennarna() {
        // (sequence, dangling ends, structure, MFE, ensemble free energy, MFE frequency, diversity)
        let cases: [(&str, bool, &str, f64, f64, f64, f64); 10] = [
            // One helix, so everything outside it is one hairpin loop.
            ("AAAAAAGGGGAAACCCCAAAAAA", false, "......((((...))))......", 0.70, 0.62, 0.877249, 1.23),
            // Nothing can pair: the ring itself, which costs the entropy of closing it.
            ("AAAAAAAAAAAAAAAAAAAA", false, "....................", 5.47, 5.47, 1.0, 0.0),
            // Two helices, so what is left is an interior loop reaching round the origin.
            ("GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", false, "((((...))))(((((((....)))))))..", -11.60, -11.94, 0.580069, 2.84),
            ("GCGCUUCGCCCUGGCGAGAAGCGC", false, "..(((((((....))))..)))..", -1.20, -1.85, 0.346172, 3.76),
            ("GGGGAAACCCCGGGGAAACCCCGGGGAAACCCCAAA", false, "((((...((((((((...))))))))...))))...", -19.30, -19.36, 0.911371, 0.62),
            // Three helices, so the exterior loop is a multiloop with nothing closing it.
            ("GGGAAAUCCCGCGCAAAAGCGCAUUUUAAAGCGGGAAACCCGC", false, "..(((((...((((....)))))))))...(((((...)))))", -10.90, -11.26, 0.556700, 8.62),
            ("GGGAAAUCCCGCGCAAAAGCGCAUUUUAAAGCGGGAAACCCGC", true, "(((....)))((((....))))........(((((...)))))", -12.40, -12.53, 0.813064, 2.43),
            ("GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", true, "((((...))))(((((((....)))))))..", -11.60, -11.94, 0.580069, 2.84),
            // An E. coli tRNA-Leu, circularised: eight helices over a hundred nucleotides.
            ("CUGGGAUACCCAGUGCUUCGGCACUGUUGCAUCUCAGGCUCGCGCCAGCAGGAUUCGAACCUGCGACCAAUUGAUUAAAAGUCAACUGCUCUACCAACUGAGCUAACGGCCC", false, "(((((((...((((((....))))))....)))))))(...(.(((.(((((.......)))))......((((((...))))))..((((........))))....)))))", -28.20, -29.60, 0.103993, 5.74),
            ("CUGGGAUACCCAGUGCUUCGGCACUGUUGCAUCUCAGGCUCGCGCCAGCAGGAUUCGAACCUGCGACCAAUUGAUUAAAAGUCAACUGCUCUACCAACUGAGCUAACGGCCC", true, "(((((((...((((((....))))))....)))))))(...(.(((.(((((.......)))))......((((((...))))))..((((........))))....)))))", -32.90, -34.39, 0.0892545, 5.21),
        ];
        for (seq, dangles, db_ref, mfe_ref, g_ref, freq_ref, diversity_ref) in cases {
            let (db, mfe, _) = mfe_fold_full(seq, false, dangles, 37.0, true);
            assert_eq!(db, db_ref, "{seq}: circular structure");
            assert!((mfe - mfe_ref).abs() < 0.011, "{seq}: circular MFE {mfe} (RNAfold {mfe_ref})");
            let r = ensemble_fold_full(seq, false, dangles, 37.0, true, 20_000);
            assert!(
                (r.ensemble_free_energy_kcal_mol - g_ref).abs() < 0.011,
                "{seq}: circular ensemble free energy {} (RNAfold {g_ref})",
                r.ensemble_free_energy_kcal_mol
            );
            assert!(
                (r.mfe_frequency - freq_ref).abs() < 0.001,
                "{seq}: circular MFE frequency {} (RNAfold {freq_ref})",
                r.mfe_frequency
            );
            assert!(
                (r.ensemble_diversity - diversity_ref).abs() < 0.15,
                "{seq}: circular ensemble diversity {} (RNAfold {diversity_ref})",
                r.ensemble_diversity
            );
        }
    }

    /// Folding a circle must not change what a linear molecule does, and a molecule long enough
    /// that its ends never meet must fold much the same either way.
    #[test]
    fn a_circle_only_changes_what_lies_outside_the_helices() {
        let seq = "GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC";
        let (linear, e_lin, _) = mfe_fold_at(seq, false, false, 37.0);
        let (circle, e_circ, _) = mfe_fold_full(seq, false, false, 37.0, true);
        // The same helices, but the circle pays for the loop that joins its ends.
        assert_eq!(linear, circle);
        assert!(e_circ > e_lin, "closing the ring cannot stabilise it ({e_circ} vs {e_lin})");
    }

    /// Reference values: ViennaRNA 2.7.2 `RNAfold -p -d0 -T <temperature>`. Every loop energy is
    /// re-derived from its enthalpy, so agreeing at 15, 25, 50 and 65 degrees checks the enthalpy
    /// tables and the rescaling together, not just one temperature.
    #[test]
    fn folds_at_other_temperatures_like_viennarna() {
        // (temperature, sequence, MFE structure, MFE, ensemble free energy, MFE frequency, diversity)
        let cases = [
            (15.0, "GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", "((((...))))(((((((....)))))))..", -21.31, -21.46, 0.774983, 1.53),
            (15.0, "GCGCUUCGCCCUGGCGAGAAGCGC", "(((((((.(......).)))))))", -15.78, -16.46, 0.302663, 3.46),
            (25.0, "GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", "((((...))))(((((((....)))))))..", -18.17, -18.35, 0.738773, 1.94),
            (25.0, "GCGCUUCGCCCUGGCGAGAAGCGC", "(((((((((....))))..)))))", -13.56, -14.29, 0.292790, 3.54),
            (50.0, "GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", "((((...))))(((((((....)))))))..", -10.24, -10.74, 0.456226, 3.35),
            (50.0, "GCGCUUCGCCCUGGCGAGAAGCGC", "(((((((((....))))..)))))", -8.39, -9.03, 0.369712, 3.15),
            (65.0, "GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", "((((...))))(((((((....)))))))..", -5.51, -6.43, 0.254801, 4.39),
            (65.0, "GCGCUUCGCCCUGGCGAGAAGCGC", "(((((((((....))))..)))))", -5.28, -5.97, 0.358135, 3.03),
            (65.0, "GGGAAAUCCCGCGCAAAAGCGCAUUUUAAAGCGGGAAACCCGC", "(((...((((((..................))))))..)))..", -5.52, -7.15, 0.0890497, 8.23),
        ];
        for (t, seq, db_ref, mfe_ref, g_ref, freq_ref, diversity_ref) in cases {
            let (db, mfe, _) = mfe_fold_at(seq, false, false, t);
            assert_eq!(db, db_ref, "{seq} at {t} C: structure");
            assert!((mfe - mfe_ref).abs() < 0.011, "{seq} at {t} C: MFE {mfe} (RNAfold {mfe_ref})");
            let r = ensemble_fold_at(seq, false, false, t, 20_000);
            assert!(
                (r.ensemble_free_energy_kcal_mol - g_ref).abs() < 0.011,
                "{seq} at {t} C: ensemble free energy {} (RNAfold {g_ref})",
                r.ensemble_free_energy_kcal_mol
            );
            assert!(
                (r.mfe_frequency - freq_ref).abs() < 0.001,
                "{seq} at {t} C: MFE frequency {} (RNAfold {freq_ref})",
                r.mfe_frequency
            );
            assert!(
                (r.ensemble_diversity - diversity_ref).abs() < 0.15,
                "{seq} at {t} C: ensemble diversity {} (RNAfold {diversity_ref})",
                r.ensemble_diversity
            );
        }
    }

    /// Reference values: ViennaRNA 2.7.2 `RNAfold -p -d0`, whose second line is the ensemble free
    /// energy and whose last line prints the MFE frequency and the ensemble diversity.
    #[test]
    fn reproduces_viennarna_d0_ensemble() {
        // (sequence, ensemble free energy, MFE frequency, ensemble diversity)
        let cases = [
            ("GGGGAAACCCCAUAGCGCGAAAGCGCUAUCC", -14.66, 0.655463, 2.54),
            ("GGGAAAUCCCGCGCAAAAGCGCAUUUUAAAGCGGGAAACCCGC", -15.14, 0.415982, 13.11),
            ("GCGCUUCGCCCUGGCGAGAAGCGC", -11.74, 0.355989, 3.38),
        ];
        for (seq, g_ref, freq_ref, diversity_ref) in cases {
            let r = ensemble_fold(seq, false, false, 20_000);
            assert!(
                (r.ensemble_free_energy_kcal_mol - g_ref).abs() < 0.01,
                "{seq}: ensemble free energy {} (RNAfold {g_ref})",
                r.ensemble_free_energy_kcal_mol
            );
            assert!(
                (r.mfe_frequency - freq_ref).abs() < 0.001,
                "{seq}: MFE frequency {} (RNAfold {freq_ref})",
                r.mfe_frequency
            );
            // Sampled, so compared with a sampling tolerance rather than exactly.
            assert!(
                (r.ensemble_diversity - diversity_ref).abs() < 0.15,
                "{seq}: ensemble diversity {} (RNAfold {diversity_ref})",
                r.ensemble_diversity
            );
        }
    }
}



