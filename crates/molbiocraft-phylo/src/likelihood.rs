// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Nucleotide maximum-likelihood engine used by model selection, ancestral reconstruction,
//! site-rate estimation and the molecular-clock test.
//!
//! * Models: the GTR family (JC69, K2P, T92, HKY, TN93, GTR) with optional discrete Γ
//!   (Yang 1994, mean category rates) and a proportion of invariable sites.
//! * Likelihood: Felsenstein (1981) pruning over compressed site patterns with per-node scaling.
//!   Gaps and `N` are missing data; IUPAC ambiguity codes are state sets.
//! * Optimisation: every branch length by Brent's method using exact edge likelihoods from
//!   up/down partials, model parameters by Brent on transformed scales, alternated to convergence.
//!   Node heights of a clock-constrained (ultrametric) tree are optimised the same way.

use statrs::distribution::{ContinuousCDF, Gamma};
use statrs::function::gamma::gamma_lr;

/// A rooted tree with arbitrary arity. Branch length `t` is the edge above the node.
#[derive(Debug, Clone)]
pub struct LkTree {
    pub nodes: Vec<LkNode>,
    pub root: usize,
}

#[derive(Debug, Clone)]
pub struct LkNode {
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub taxon: Option<usize>,
    pub t: f64,
}

impl LkTree {
    pub fn preorder(&self) -> Vec<usize> {
        let mut out = Vec::with_capacity(self.nodes.len());
        let mut stack = vec![self.root];
        while let Some(v) = stack.pop() {
            out.push(v);
            for &c in self.nodes[v].children.iter().rev() {
                stack.push(c);
            }
        }
        out
    }

    pub fn postorder(&self) -> Vec<usize> {
        let mut out = self.preorder();
        out.reverse();
        out
    }

    /// Taxon indices below `v`.
    pub fn leaves_below(&self, v: usize) -> Vec<usize> {
        let mut out = Vec::new();
        let mut stack = vec![v];
        while let Some(x) = stack.pop() {
            if let Some(t) = self.nodes[x].taxon {
                out.push(t);
            }
            stack.extend(self.nodes[x].children.iter().copied());
        }
        out.sort_unstable();
        out
    }
}

pub fn nucleotide_mask(b: u8) -> u8 {
    match b.to_ascii_uppercase() {
        b'A' => 1,
        b'C' => 2,
        b'G' => 4,
        b'T' | b'U' => 8,
        b'R' => 1 | 4,
        b'Y' => 2 | 8,
        b'S' => 2 | 4,
        b'W' => 1 | 8,
        b'K' => 4 | 8,
        b'M' => 1 | 2,
        b'B' => 2 | 4 | 8,
        b'D' => 1 | 4 | 8,
        b'H' => 1 | 2 | 8,
        b'V' => 1 | 2 | 4,
        _ => 15,
    }
}

/// Unique site patterns (rows = taxa) with their multiplicities.
#[derive(Debug, Clone)]
pub struct Patterns {
    pub n_taxa: usize,
    pub cols: Vec<Vec<u8>>,
    pub weights: Vec<f64>,
    pub site_pattern: Vec<usize>,
    pub n_sites: usize,
}

impl Patterns {
    pub fn from_alignment(seqs: &[String]) -> Self {
        let n_taxa = seqs.len();
        let n_sites = seqs.iter().map(|s| s.len()).max().unwrap_or(0);
        let mut index = std::collections::HashMap::new();
        let mut cols = Vec::new();
        let mut weights = Vec::new();
        let mut site_pattern = Vec::with_capacity(n_sites);
        for c in 0..n_sites {
            let col: Vec<u8> = seqs.iter().map(|s| nucleotide_mask(*s.as_bytes().get(c).unwrap_or(&b'-'))).collect();
            let k = *index.entry(col.clone()).or_insert_with(|| {
                cols.push(col);
                weights.push(0.0);
                cols.len() - 1
            });
            weights[k] += 1.0;
            site_pattern.push(k);
        }
        Patterns { n_taxa, cols, weights, site_pattern, n_sites }
    }

    pub fn len(&self) -> usize {
        self.cols.len()
    }

    /// Empirical base frequencies (ambiguity codes split evenly, missing data ignored).
    pub fn base_frequencies(&self) -> [f64; 4] {
        let mut f = [0.0; 4];
        for (col, &w) in self.cols.iter().zip(&self.weights) {
            for &m in col {
                if m == 15 {
                    continue;
                }
                let k = m.count_ones() as f64;
                for (s, fs) in f.iter_mut().enumerate() {
                    if m >> s & 1 == 1 {
                        *fs += w / k;
                    }
                }
            }
        }
        let tot: f64 = f.iter().sum();
        if tot <= 0.0 {
            return [0.25; 4];
        }
        f.map(|x| (x / tot).max(1e-4))
    }
}

/// Substitution-model family.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Family {
    Jc69,
    K2p,
    T92,
    Hky,
    Tn93,
    Gtr,
}

impl Family {
    pub fn label(self) -> &'static str {
        match self {
            Family::Jc69 => "JC",
            Family::K2p => "K2",
            Family::T92 => "T92",
            Family::Hky => "HKY",
            Family::Tn93 => "TN93",
            Family::Gtr => "GTR",
        }
    }
    /// Free parameters excluding branch lengths, Γ and I (base frequencies count as free parameters).
    pub fn free_params(self) -> usize {
        match self {
            Family::Jc69 => 0,
            Family::K2p => 1,
            Family::T92 => 2,
            Family::Hky => 4,
            Family::Tn93 => 5,
            Family::Gtr => 8,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ModelSpec {
    pub family: Family,
    pub gamma: bool,
    pub invariant: bool,
    pub n_cat: usize,
}

impl ModelSpec {
    pub fn name(&self) -> String {
        let mut s = self.family.label().to_string();
        if self.gamma {
            s.push_str("+G");
        }
        if self.invariant {
            s.push_str("+I");
        }
        s
    }
    pub fn free_params(&self) -> usize {
        self.family.free_params() + self.gamma as usize + self.invariant as usize
    }
}

/// Exchangeabilities in the order AC, AG, AT, CG, CT, GT.
#[derive(Debug, Clone)]
pub struct NucModel {
    pub spec: ModelSpec,
    pub pi: [f64; 4],
    pub rates: [f64; 6],
    pub alpha: f64,
    pub pinv: f64,
    cat_rates: Vec<f64>,
    // P(t) = sum_k  U_ik U_jk exp(lambda_k t) sqrt(pi_j / pi_i)
    evals: [f64; 4],
    evecs: [[f64; 4]; 4],
}

const PAIR: [(usize, usize); 6] = [(0, 1), (0, 2), (0, 3), (1, 2), (1, 3), (2, 3)];

fn jacobi_eigen(mut a: [[f64; 4]; 4]) -> ([f64; 4], [[f64; 4]; 4]) {
    let mut v = [[0.0; 4]; 4];
    for (i, row) in v.iter_mut().enumerate() {
        row[i] = 1.0;
    }
    for _ in 0..100 {
        let mut off = 0.0;
        for i in 0..4 {
            for j in (i + 1)..4 {
                off += a[i][j] * a[i][j];
            }
        }
        if off < 1e-30 {
            break;
        }
        for p in 0..4 {
            for q in (p + 1)..4 {
                if a[p][q].abs() < 1e-300 {
                    continue;
                }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let t = if theta == 0.0 { 1.0 } else { t };
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..4 {
                    let akp = a[k][p];
                    let akq = a[k][q];
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for k in 0..4 {
                    let apk = a[p][k];
                    let aqk = a[q][k];
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for row in v.iter_mut() {
                    let vkp = row[p];
                    let vkq = row[q];
                    row[p] = c * vkp - s * vkq;
                    row[q] = s * vkp + c * vkq;
                }
            }
        }
    }
    ([a[0][0], a[1][1], a[2][2], a[3][3]], v)
}

/// Yang (1994) discrete-Γ category rates using the mean of each equal-probability category.
pub fn discrete_gamma_rates(alpha: f64, k: usize) -> Vec<f64> {
    if k <= 1 {
        return vec![1.0];
    }
    let Ok(g) = Gamma::new(alpha, alpha) else { return vec![1.0; k] };
    let cuts: Vec<f64> = (1..k).map(|i| g.inverse_cdf(i as f64 / k as f64)).collect();
    let mut prev = 0.0;
    let mut out = Vec::with_capacity(k);
    for i in 0..k {
        let upper = if i + 1 < k { gamma_lr(alpha + 1.0, cuts[i] * alpha) } else { 1.0 };
        out.push((upper - prev) * k as f64);
        prev = upper;
    }
    let mean = out.iter().sum::<f64>() / k as f64;
    out.iter().map(|r| r / mean).collect()
}

impl NucModel {
    pub fn new(spec: ModelSpec, pi: [f64; 4]) -> Self {
        let pi = match spec.family {
            Family::Jc69 | Family::K2p => [0.25; 4],
            Family::T92 => {
                let gc = (pi[1] + pi[2]).clamp(0.01, 0.99);
                [(1.0 - gc) / 2.0, gc / 2.0, gc / 2.0, (1.0 - gc) / 2.0]
            }
            _ => pi,
        };
        let mut m = NucModel {
            spec,
            pi,
            rates: [1.0; 6],
            alpha: 0.5,
            pinv: if spec.invariant { 0.2 } else { 0.0 },
            cat_rates: vec![1.0],
            evals: [0.0; 4],
            evecs: [[0.0; 4]; 4],
        };
        if !matches!(spec.family, Family::Jc69) {
            m.set_kappa(2.0, 2.0);
        }
        m.update();
        m
    }

    /// A model of `spec` seeded with another fitted model's exchangeabilities, Γ shape and p_inv
    /// (used to warm-start nested models).
    pub fn seeded_from(spec: ModelSpec, pi: [f64; 4], from: &NucModel, pinv: f64) -> Self {
        let mut m = NucModel::new(spec, pi);
        let k_ag = from.rates[1] / from.rates[5].max(1e-9);
        let k_ct = from.rates[4] / from.rates[5].max(1e-9);
        match spec.family {
            Family::Jc69 => {}
            Family::K2p | Family::T92 | Family::Hky => {
                let k = (0.5 * (k_ag + k_ct)).clamp(1e-3, 900.0);
                m.set_kappa(k, k)
            }
            Family::Tn93 => m.set_kappa(k_ag.clamp(1e-3, 900.0), k_ct.clamp(1e-3, 900.0)),
            Family::Gtr => {
                for i in 0..6 {
                    m.rates[i] = (from.rates[i] / from.rates[5].max(1e-9)).clamp(1e-3, 900.0);
                }
            }
        }
        if spec.gamma && from.spec.gamma {
            m.alpha = from.alpha;
        }
        if spec.invariant {
            m.pinv = pinv.clamp(1e-3, 0.95);
        }
        m.update();
        m
    }

    fn set_kappa(&mut self, k_ag: f64, k_ct: f64) {
        self.rates = [1.0, k_ag, 1.0, 1.0, k_ct, 1.0];
    }

    /// The free parameters on unconstrained scales, in a fixed order.
    pub fn params(&self) -> Vec<f64> {
        let mut p = Vec::new();
        match self.spec.family {
            Family::Jc69 => {}
            Family::K2p | Family::T92 | Family::Hky => p.push(self.rates[1].ln()),
            Family::Tn93 => {
                p.push(self.rates[1].ln());
                p.push(self.rates[4].ln());
            }
            Family::Gtr => {
                for r in &self.rates[..5] {
                    p.push(r.ln());
                }
            }
        }
        if self.spec.gamma {
            p.push(self.alpha.ln());
        }
        if self.spec.invariant {
            p.push((self.pinv / (1.0 - self.pinv)).ln());
        }
        p
    }

    pub fn param_bounds(&self) -> Vec<(f64, f64)> {
        let mut b = Vec::new();
        let n_rates = match self.spec.family {
            Family::Jc69 => 0,
            Family::K2p | Family::T92 | Family::Hky => 1,
            Family::Tn93 => 2,
            Family::Gtr => 5,
        };
        for _ in 0..n_rates {
            b.push((-6.9, 6.9));
        }
        if self.spec.gamma {
            b.push((-4.6, 6.9)); // α in [0.01, 1000]
        }
        if self.spec.invariant {
            b.push((-9.0, 4.6)); // p_inv in (0.0001, 0.99)
        }
        b
    }

    pub fn set_params(&mut self, p: &[f64]) {
        let mut it = p.iter().copied();
        match self.spec.family {
            Family::Jc69 => {}
            Family::K2p | Family::T92 | Family::Hky => {
                let k = it.next().unwrap().exp();
                self.set_kappa(k, k);
            }
            Family::Tn93 => {
                let a = it.next().unwrap().exp();
                let b = it.next().unwrap().exp();
                self.set_kappa(a, b);
            }
            Family::Gtr => {
                for i in 0..5 {
                    self.rates[i] = it.next().unwrap().exp();
                }
                self.rates[5] = 1.0;
            }
        }
        if self.spec.gamma {
            self.alpha = it.next().unwrap().exp();
        }
        if self.spec.invariant {
            let x = it.next().unwrap();
            self.pinv = 1.0 / (1.0 + (-x).exp());
        }
        self.update();
    }

    fn update(&mut self) {
        let mut q = [[0.0; 4]; 4];
        for (k, &(i, j)) in PAIR.iter().enumerate() {
            q[i][j] = self.rates[k] * self.pi[j];
            q[j][i] = self.rates[k] * self.pi[i];
        }
        let mut mu = 0.0;
        for i in 0..4 {
            let row: f64 = (0..4).filter(|&j| j != i).map(|j| q[i][j]).sum();
            q[i][i] = -row;
            mu += self.pi[i] * row;
        }
        let mut b = [[0.0; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                b[i][j] = q[i][j] / mu * (self.pi[i] / self.pi[j]).sqrt();
            }
        }
        // symmetrise against rounding
        for i in 0..4 {
            for j in (i + 1)..4 {
                let m = 0.5 * (b[i][j] + b[j][i]);
                b[i][j] = m;
                b[j][i] = m;
            }
        }
        let (evals, evecs) = jacobi_eigen(b);
        self.evals = evals;
        self.evecs = evecs;
        let base = if self.spec.gamma { discrete_gamma_rates(self.alpha, self.spec.n_cat) } else { vec![1.0] };
        // Rates are scaled so the mean over *all* sites (including invariable ones) is 1.
        let scale = 1.0 / (1.0 - self.pinv);
        self.cat_rates = base.iter().map(|r| r * scale).collect();
    }

    pub fn n_cat(&self) -> usize {
        self.cat_rates.len()
    }

    pub fn cat_rates(&self) -> &[f64] {
        &self.cat_rates
    }

    /// Transition probability matrix for branch length `t` (expected substitutions per site).
    pub fn pmatrix(&self, t: f64) -> [[f64; 4]; 4] {
        let e: [f64; 4] = self.evals.map(|l| (l * t).exp());
        let mut p = [[0.0; 4]; 4];
        for i in 0..4 {
            for j in 0..4 {
                let mut s = 0.0;
                for k in 0..4 {
                    s += self.evecs[i][k] * self.evecs[j][k] * e[k];
                }
                p[i][j] = (s * (self.pi[j] / self.pi[i]).sqrt()).max(1e-300);
            }
        }
        p
    }

    /// Ratio of the transition to transversion substitution flux (the ratio R; 0.5 under JC69).
    pub fn ts_tv_ratio(&self) -> f64 {
        let flux = |k: usize| {
            let (i, j) = PAIR[k];
            self.pi[i] * self.pi[j] * self.rates[k]
        };
        (flux(1) + flux(4)) / (flux(0) + flux(2) + flux(3) + flux(5))
    }
}

/// Partial likelihoods for every pattern and category: `v[(p*K + k)*4 + s]`, with a log-scale per pattern.
/// Outcome of a nearest-neighbour-interchange search.
#[derive(Debug, Clone, Copy, Default)]
pub struct NniStats {
    pub rounds: usize,
    pub swaps: usize,
    pub evaluated: usize,
}

#[derive(Clone)]
pub struct Partial {
    pub v: Vec<f64>,
    pub ls: Vec<f64>,
}

pub struct Engine<'a> {
    pub tree: LkTree,
    pub pats: &'a Patterns,
    pub model: NucModel,
    down: Vec<Partial>,
    inv_lik: Vec<f64>,
}

#[inline]
fn log_add(a: f64, b: f64) -> f64 {
    if a == f64::NEG_INFINITY {
        return b;
    }
    if b == f64::NEG_INFINITY {
        return a;
    }
    let m = a.max(b);
    m + ((a - m).exp() + (b - m).exp()).ln()
}

pub(crate) fn brent_max(f: &mut dyn FnMut(f64) -> f64, lo: f64, hi: f64, x0: f64, tol: f64, max_iter: usize) -> (f64, f64) {
    // Brent's method (minimisation of -f), Numerical Recipes formulation.
    const CGOLD: f64 = 0.381_966_011_250_105;
    let (mut a, mut b) = (lo, hi);
    let mut x = x0.clamp(lo, hi);
    let (mut w, mut v) = (x, x);
    let mut fx = -f(x);
    let (mut fw, mut fv) = (fx, fx);
    let (mut d, mut e): (f64, f64) = (0.0, 0.0);
    for _ in 0..max_iter {
        let xm = 0.5 * (a + b);
        let tol1 = tol * x.abs() + 1e-10;
        let tol2 = 2.0 * tol1;
        if (x - xm).abs() <= tol2 - 0.5 * (b - a) {
            break;
        }
        let mut use_golden = true;
        if e.abs() > tol1 {
            let r = (x - w) * (fx - fv);
            let mut q = (x - v) * (fx - fw);
            let mut p = (x - v) * q - (x - w) * r;
            q = 2.0 * (q - r);
            if q > 0.0 {
                p = -p;
            }
            q = q.abs();
            let etemp = e;
            e = d;
            if !(p.abs() >= (0.5 * q * etemp).abs() || p <= q * (a - x) || p >= q * (b - x)) {
                d = p / q;
                let u = x + d;
                if u - a < tol2 || b - u < tol2 {
                    d = tol1.copysign(xm - x);
                }
                use_golden = false;
            }
        }
        if use_golden {
            e = if x >= xm { a - x } else { b - x };
            d = CGOLD * e;
        }
        let u = if d.abs() >= tol1 { x + d } else { x + tol1.copysign(d) };
        let fu = -f(u);
        if fu <= fx {
            if u >= x {
                a = x;
            } else {
                b = x;
            }
            v = w;
            fv = fw;
            w = x;
            fw = fx;
            x = u;
            fx = fu;
        } else {
            if u < x {
                a = u;
            } else {
                b = u;
            }
            if fu <= fw || w == x {
                v = w;
                fv = fw;
                w = u;
                fw = fu;
            } else if fu <= fv || v == x || v == w {
                v = u;
                fv = fu;
            }
        }
    }
    (x, -fx)
}

const MIN_T: f64 = 1e-8;
const MAX_T: f64 = 10.0;

impl<'a> Engine<'a> {
    pub fn new(tree: LkTree, pats: &'a Patterns, model: NucModel) -> Self {
        let inv_lik = Vec::new();
        let mut e = Engine { tree, pats, model, down: Vec::new(), inv_lik };
        e.refresh_invariant();
        e.compute_down();
        e
    }

    fn refresh_invariant(&mut self) {
        self.inv_lik = self
            .pats
            .cols
            .iter()
            .map(|col| {
                let common = col.iter().fold(15u8, |acc, &m| acc & m);
                (0..4).filter(|&s| common >> s & 1 == 1).map(|s| self.model.pi[s]).sum()
            })
            .collect();
    }

    pub fn set_model(&mut self, model: NucModel) {
        self.model = model;
        self.refresh_invariant();
        self.compute_down();
    }

    fn kp(&self) -> (usize, usize) {
        (self.model.n_cat(), self.pats.len())
    }

    fn leaf_partial(&self, taxon: usize) -> Partial {
        let (k, np) = self.kp();
        let mut v = vec![0.0; np * k * 4];
        for p in 0..np {
            let m = self.pats.cols[p][taxon];
            for c in 0..k {
                for s in 0..4 {
                    v[(p * k + c) * 4 + s] = if m >> s & 1 == 1 { 1.0 } else { 0.0 };
                }
            }
        }
        Partial { v, ls: vec![0.0; np] }
    }

    fn pmats(&self, t: f64) -> Vec<[[f64; 4]; 4]> {
        let t = t.max(MIN_T);
        self.model.cat_rates().iter().map(|r| self.model.pmatrix(t * r)).collect()
    }

    /// Message a child sends up its edge: (P(t) · L_child).
    fn message(&self, child: &Partial, t: f64) -> Partial {
        let (k, np) = self.kp();
        let pm = self.pmats(t);
        let mut v = vec![0.0; np * k * 4];
        for p in 0..np {
            for c in 0..k {
                let base = (p * k + c) * 4;
                let l = &child.v[base..base + 4];
                for x in 0..4 {
                    let row = &pm[c][x];
                    v[base + x] = row[0] * l[0] + row[1] * l[1] + row[2] * l[2] + row[3] * l[3];
                }
            }
        }
        Partial { v, ls: child.ls.clone() }
    }

    fn multiply_into(acc: &mut Partial, other: &Partial) {
        for (a, b) in acc.v.iter_mut().zip(&other.v) {
            *a *= b;
        }
        for (a, b) in acc.ls.iter_mut().zip(&other.ls) {
            *a += b;
        }
    }

    fn rescale(&self, part: &mut Partial) {
        let (k, np) = self.kp();
        for p in 0..np {
            let sl = &mut part.v[p * k * 4..(p + 1) * k * 4];
            let m = sl.iter().copied().fold(0.0f64, f64::max);
            if m > 0.0 && !(1e-50..=1e50).contains(&m) {
                for x in sl.iter_mut() {
                    *x /= m;
                }
                part.ls[p] += m.ln();
            }
        }
    }

    fn ones(&self) -> Partial {
        let (k, np) = self.kp();
        Partial { v: vec![1.0; np * k * 4], ls: vec![0.0; np] }
    }

    fn node_down(&self, v: usize) -> Partial {
        if let Some(t) = self.tree.nodes[v].taxon {
            if self.tree.nodes[v].children.is_empty() {
                return self.leaf_partial(t);
            }
        }
        let mut acc = self.ones();
        for &c in &self.tree.nodes[v].children {
            let msg = self.message(&self.down[c], self.tree.nodes[c].t);
            Self::multiply_into(&mut acc, &msg);
        }
        self.rescale(&mut acc);
        acc
    }

    pub fn compute_down(&mut self) {
        let n = self.tree.nodes.len();
        self.down = vec![Partial { v: Vec::new(), ls: Vec::new() }; n];
        for v in self.tree.postorder() {
            self.down[v] = self.node_down(v);
        }
    }

    /// ln L for one pattern given matching `above` (states at the top of `node`, including the
    /// path to the root and the stationary distribution) and `below` vectors at the same node.
    fn site_ln(&self, p: usize, above: &Partial, below: &Partial) -> f64 {
        let k = self.model.n_cat();
        let base = p * k * 4;
        let mut s = 0.0;
        for i in 0..k * 4 {
            s += above.v[base + i] * below.v[base + i];
        }
        let var = (1.0 - self.model.pinv) * s / k as f64;
        let ln_var = if var > 0.0 { var.ln() + above.ls[p] + below.ls[p] } else { f64::NEG_INFINITY };
        if self.model.pinv > 0.0 && self.inv_lik[p] > 0.0 {
            log_add(ln_var, (self.model.pinv * self.inv_lik[p]).ln())
        } else {
            ln_var
        }
    }

    fn root_above(&self) -> Partial {
        let (k, np) = self.kp();
        let mut v = vec![0.0; np * k * 4];
        for chunk in v.chunks_mut(4) {
            chunk.copy_from_slice(&self.model.pi);
        }
        Partial { v, ls: vec![0.0; np] }
    }

    pub fn log_likelihood(&self) -> f64 {
        let above = self.root_above();
        let below = &self.down[self.tree.root];
        (0..self.pats.len()).map(|p| self.pats.weights[p] * self.site_ln(p, &above, below)).sum()
    }

    /// `above` for child `c` of `v` *before* crossing c's edge: A_v ⊙ Π(sibling messages).
    fn above_parent_side(&self, v: usize, a_v: &Partial, c: usize) -> Partial {
        let mut acc = a_v.clone();
        for &s in &self.tree.nodes[v].children {
            if s != c {
                let msg = self.message(&self.down[s], self.tree.nodes[s].t);
                Self::multiply_into(&mut acc, &msg);
            }
        }
        self.rescale(&mut acc);
        acc
    }

    /// Push an above-vector across an edge: A_c(y) = Σ_x B(x) P_xy(t).
    fn cross_edge_down(&self, b: &Partial, t: f64) -> Partial {
        let (k, np) = self.kp();
        let pm = self.pmats(t);
        let mut v = vec![0.0; np * k * 4];
        for p in 0..np {
            for c in 0..k {
                let base = (p * k + c) * 4;
                for y in 0..4 {
                    let mut s = 0.0;
                    for x in 0..4 {
                        s += b.v[base + x] * pm[c][x][y];
                    }
                    v[base + y] = s;
                }
            }
        }
        Partial { v, ls: b.ls.clone() }
    }

    fn edge_ln(&self, b: &Partial, below: &Partial, t: f64) -> f64 {
        let msg = self.message(below, t);
        (0..self.pats.len()).map(|p| self.pats.weights[p] * self.site_ln(p, b, &msg)).sum()
    }

    /// One sweep optimising every branch length with exact edge likelihoods.
    pub fn optimize_branches(&mut self) -> f64 {
        let root = self.tree.root;
        let a_root = self.root_above();
        self.branch_pass(root, &a_root);
        self.down[root] = self.node_down(root);
        self.log_likelihood()
    }

    fn branch_pass(&mut self, v: usize, a_v: &Partial) {
        let children = self.tree.nodes[v].children.clone();
        for c in children {
            let b = self.above_parent_side(v, a_v, c);
            let below = self.down[c].clone();
            let t0 = self.tree.nodes[c].t.clamp(MIN_T, MAX_T);
            let mut f = |x: f64| self.edge_ln(&b, &below, x.exp());
            let (x, _) = brent_max(&mut f, MIN_T.ln(), MAX_T.ln(), t0.ln(), 1e-4, 40);
            let t = x.exp();
            self.tree.nodes[c].t = if t <= 1.01 * MIN_T { 0.0 } else { t };
            if !self.tree.nodes[c].children.is_empty() {
                let a_c = self.cross_edge_down(&b, self.tree.nodes[c].t);
                self.branch_pass(c, &a_c);
                self.down[c] = self.node_down(c);
            }
        }
    }

    /// Marginal posterior state probabilities at node `v` for every pattern (Yang et al. 1995).
    pub fn marginal_states(&self) -> Vec<Vec<[f64; 4]>> {
        let n = self.tree.nodes.len();
        let mut above = vec![Partial { v: Vec::new(), ls: Vec::new() }; n];
        let root = self.tree.root;
        above[root] = self.root_above();
        for v in self.tree.preorder() {
            let a_v = above[v].clone();
            for &c in &self.tree.nodes[v].children {
                let b = self.above_parent_side(v, &a_v, c);
                above[c] = self.cross_edge_down(&b, self.tree.nodes[c].t);
            }
        }
        let (k, np) = self.kp();
        (0..n)
            .map(|v| {
                (0..np)
                    .map(|p| {
                        let mut post = [0.0; 4];
                        let base = p * k * 4;
                        for c in 0..k {
                            for s in 0..4 {
                                post[s] += above[v].v[base + c * 4 + s] * self.down[v].v[base + c * 4 + s];
                            }
                        }
                        // The invariable-site class contributes π_s at every node when the
                        // pattern is constant-compatible; put both classes on one scale.
                        let ln_var_scale = above[v].ls[p] + self.down[v].ls[p];
                        let col = &self.pats.cols[p];
                        let common = col.iter().fold(15u8, |acc, &m| acc & m);
                        let mut tot = 0.0;
                        let mut out = [0.0; 4];
                        let ln_site = self.site_ln(p, &above[v], &self.down[v]);
                        for s in 0..4 {
                            let var = (1.0 - self.model.pinv) * post[s] / k as f64;
                            let ln_v = if var > 0.0 { var.ln() + ln_var_scale } else { f64::NEG_INFINITY };
                            let inv = if self.model.pinv > 0.0 && common >> s & 1 == 1 {
                                (self.model.pinv * self.model.pi[s]).ln()
                            } else {
                                f64::NEG_INFINITY
                            };
                            out[s] = (log_add(ln_v, inv) - ln_site).exp();
                            tot += out[s];
                        }
                        if tot > 0.0 {
                            for x in &mut out {
                                *x /= tot;
                            }
                        }
                        out
                    })
                    .collect()
            })
            .collect()
    }

    /// Posterior probability of each rate category for every pattern (invariable class first
    /// when the model has one). Used for empirical-Bayes site rates.
    pub fn category_posteriors(&self) -> Vec<Vec<f64>> {
        let (k, np) = self.kp();
        let above = self.root_above();
        let below = &self.down[self.tree.root];
        (0..np)
            .map(|p| {
                let base = p * k * 4;
                let ln_site = self.site_ln(p, &above, below);
                let mut out = Vec::with_capacity(k + 1);
                if self.model.spec.invariant {
                    out.push(if self.inv_lik[p] > 0.0 { (self.model.pinv * self.inv_lik[p]).ln() - ln_site } else { f64::NEG_INFINITY }.exp());
                }
                for c in 0..k {
                    let s: f64 = (0..4).map(|x| above.v[base + c * 4 + x] * below.v[base + c * 4 + x]).sum();
                    let ln_c = if s > 0.0 { ((1.0 - self.model.pinv) * s / k as f64).ln() + below.ls[p] } else { f64::NEG_INFINITY };
                    out.push((ln_c - ln_site).exp());
                }
                out
            })
            .collect()
    }

    fn ln_l_with_params(&mut self, params: &[f64]) -> f64 {
        let mut m = self.model.clone();
        m.set_params(params);
        let saved = std::mem::replace(&mut self.model, m);
        self.refresh_invariant();
        self.compute_down();
        let l = self.log_likelihood();
        self.model = saved;
        l
    }

    /// Maximise ln L over the model parameters (branch lengths fixed) by box-constrained BFGS
    /// with central-difference gradients. GTR exchangeabilities are strongly correlated, so a
    /// joint quasi-Newton step converges far faster than one parameter at a time.
    fn optimize_model_params(&mut self) {
        let bounds = self.model.param_bounds();
        let d = bounds.len();
        if d == 0 {
            return;
        }
        let clamp = |x: &mut Vec<f64>| {
            for (v, (lo, hi)) in x.iter_mut().zip(&bounds) {
                *v = v.clamp(*lo, *hi);
            }
        };
        let mut x = self.model.params();
        clamp(&mut x);
        let mut fx = -self.ln_l_with_params(&x);
        let grad = |eng: &mut Self, x: &[f64]| -> Vec<f64> {
            (0..x.len())
                .map(|i| {
                    let h = 1e-4;
                    let (mut a, mut b) = (x.to_vec(), x.to_vec());
                    a[i] = (x[i] + h).min(bounds[i].1);
                    b[i] = (x[i] - h).max(bounds[i].0);
                    let span = a[i] - b[i];
                    if span <= 0.0 {
                        0.0
                    } else {
                        (-eng.ln_l_with_params(&a) + eng.ln_l_with_params(&b)) / span
                    }
                })
                .collect()
        };
        let mut g = grad(self, &x);
        let mut hinv = vec![vec![0.0; d]; d];
        for (i, row) in hinv.iter_mut().enumerate() {
            row[i] = 1.0;
        }
        for _ in 0..20 {
            let dir: Vec<f64> = (0..d).map(|i| -(0..d).map(|j| hinv[i][j] * g[j]).sum::<f64>()).collect();
            let slope: f64 = dir.iter().zip(&g).map(|(a, b)| a * b).sum();
            let dir = if slope >= 0.0 { g.iter().map(|v| -v).collect::<Vec<_>>() } else { dir };
            let mut step = 1.0;
            let mut accepted = None;
            for _ in 0..25 {
                let mut xn: Vec<f64> = x.iter().zip(&dir).map(|(a, b)| a + step * b).collect();
                clamp(&mut xn);
                let fnew = -self.ln_l_with_params(&xn);
                if fnew < fx - 1e-10 {
                    accepted = Some((xn, fnew));
                    break;
                }
                step *= 0.5;
            }
            let Some((xn, fnew)) = accepted else { break };
            let gn = grad(self, &xn);
            let s: Vec<f64> = xn.iter().zip(&x).map(|(a, b)| a - b).collect();
            let y: Vec<f64> = gn.iter().zip(&g).map(|(a, b)| a - b).collect();
            let sy: f64 = s.iter().zip(&y).map(|(a, b)| a * b).sum();
            let improvement = fx - fnew;
            x = xn;
            fx = fnew;
            g = gn;
            if sy > 1e-12 {
                let hy: Vec<f64> = (0..d).map(|i| (0..d).map(|j| hinv[i][j] * y[j]).sum()).collect();
                let yhy: f64 = y.iter().zip(&hy).map(|(a, b)| a * b).sum();
                for i in 0..d {
                    for j in 0..d {
                        hinv[i][j] += ((sy + yhy) * s[i] * s[j]) / (sy * sy) - (hy[i] * s[j] + s[i] * hy[j]) / sy;
                    }
                }
            }
            if improvement < 1e-4 {
                break;
            }
        }
        let mut m = self.model.clone();
        m.set_params(&x);
        self.set_model(m);
    }

    /// Fit branch lengths and model parameters by alternating optimisation until ln L changes
    /// by less than 0.001 between rounds.
    pub fn fit(&mut self, max_rounds: usize) -> f64 {
        self.fit_to(max_rounds, 1e-3)
    }

    pub fn fit_to(&mut self, max_rounds: usize, tol: f64) -> f64 {
        let mut ln_l = self.optimize_branches();
        for _ in 0..max_rounds {
            let before = ln_l;
            self.optimize_model_params();
            ln_l = self.optimize_branches();
            if (ln_l - before).abs() < tol {
                break;
            }
        }
        ln_l
    }

    /// `above` vectors for every node (the likelihood of everything outside the node's
    /// subtree, at the node), root = stationary distribution.
    fn all_above(&self) -> Vec<Partial> {
        let n = self.tree.nodes.len();
        let mut above = vec![Partial { v: Vec::new(), ls: Vec::new() }; n];
        let root = self.tree.root;
        above[root] = self.root_above();
        for v in self.tree.preorder() {
            let a_v = above[v].clone();
            for &c in &self.tree.nodes[v].children {
                let b = self.above_parent_side(v, &a_v, c);
                above[c] = self.cross_edge_down(&b, self.tree.nodes[c].t);
            }
        }
        above
    }

    /// ln L after exchanging `x` (a child of `c`) with `s` (a sibling of `c`), optimising only
    /// the central branch above `c` (all other branch lengths kept). Returns (ln L, branch).
    fn nni_quick(&self, above: &[Partial], c: usize, x: usize, s: usize) -> (f64, f64) {
        let v = self.tree.nodes[c].parent.expect("non-root");
        let other = *self.tree.nodes[c].children.iter().find(|&&k| k != x).expect("binary");
        let mut dc = self.ones();
        Self::multiply_into(&mut dc, &self.message(&self.down[s], self.tree.nodes[s].t));
        Self::multiply_into(&mut dc, &self.message(&self.down[other], self.tree.nodes[other].t));
        self.rescale(&mut dc);
        let mut b = above[v].clone();
        Self::multiply_into(&mut b, &self.message(&self.down[x], self.tree.nodes[x].t));
        for &y in &self.tree.nodes[v].children {
            if y != c && y != s {
                let msg = self.message(&self.down[y], self.tree.nodes[y].t);
                Self::multiply_into(&mut b, &msg);
            }
        }
        self.rescale(&mut b);
        let t0 = self.tree.nodes[c].t.clamp(MIN_T, MAX_T);
        let mut f = |lx: f64| self.edge_ln(&b, &dc, lx.exp());
        let (lx, best) = brent_max(&mut f, MIN_T.ln(), MAX_T.ln(), t0.ln(), 1e-3, 30);
        (best, lx.exp())
    }

    fn apply_nni(&mut self, c: usize, x: usize, s: usize, t: f64) {
        let v = self.tree.nodes[c].parent.expect("non-root");
        for k in self.tree.nodes[c].children.iter_mut() {
            if *k == x {
                *k = s;
            }
        }
        for k in self.tree.nodes[v].children.iter_mut() {
            if *k == s {
                *k = x;
            }
        }
        self.tree.nodes[s].parent = Some(c);
        self.tree.nodes[x].parent = Some(v);
        self.tree.nodes[c].t = t;
    }

    /// Nearest-neighbour-interchange hill climbing (as in PhyML): every NNI is scored with only
    /// its central branch re-optimised, the best non-conflicting improving swaps are applied
    /// together, then every branch is re-optimised; if the joint move does not improve ln L,
    /// only the single best swap is tried. Stops when no swap improves ln L. Model parameters
    /// are held fixed. Expects a binary tree with a trifurcating root.
    pub fn nni_search(&mut self, max_rounds: usize) -> NniStats {
        let mut stats = NniStats::default();
        let mut ln_l = self.log_likelihood();
        for _ in 0..max_rounds {
            stats.rounds += 1;
            let above = self.all_above();
            let mut cands: Vec<(f64, usize, usize, usize, f64)> = Vec::new();
            for c in 0..self.tree.nodes.len() {
                let Some(v) = self.tree.nodes[c].parent else { continue };
                if self.tree.nodes[c].children.len() != 2 {
                    continue;
                }
                let Some(&s) = self.tree.nodes[v].children.iter().find(|&&k| k != c) else { continue };
                for &x in &self.tree.nodes[c].children {
                    stats.evaluated += 1;
                    let (l, t) = self.nni_quick(&above, c, x, s);
                    if l > ln_l + 0.01 {
                        cands.push((l - ln_l, c, x, s, t));
                    }
                }
            }
            if cands.is_empty() {
                break;
            }
            cands.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
            let saved = self.tree.clone();
            let mut used = std::collections::HashSet::new();
            let mut applied = 0usize;
            for &(_, c, x, s, t) in &cands {
                let v = self.tree.nodes[c].parent.expect("non-root");
                if [v, c, x, s].iter().any(|n| used.contains(n)) {
                    continue;
                }
                used.extend([v, c, x, s]);
                self.apply_nni(c, x, s, t);
                applied += 1;
            }
            self.compute_down();
            let mut new_l = self.optimize_branches();
            if new_l < ln_l + 1e-4 && applied > 1 {
                self.tree = saved.clone();
                let (_, c, x, s, t) = cands[0];
                self.apply_nni(c, x, s, t);
                self.compute_down();
                new_l = self.optimize_branches();
                applied = 1;
            }
            if new_l < ln_l + 1e-4 {
                self.tree = saved;
                self.compute_down();
                break;
            }
            stats.swaps += applied;
            ln_l = new_l;
        }
        stats
    }

    pub fn tree_length(&self) -> f64 {
        self.tree.nodes.iter().enumerate().filter(|(i, _)| *i != self.tree.root).map(|(_, n)| n.t).sum()
    }

    /// Clock-constrained fit: node heights (leaves at 0) replace free branch lengths.
    /// The model parameters are held at their current values. Returns ln L of the ultrametric tree.
    pub fn fit_clock(&mut self, max_rounds: usize) -> f64 {
        let n = self.tree.nodes.len();
        let mut h = vec![0.0f64; n];
        for v in self.tree.postorder() {
            h[v] = self.tree.nodes[v]
                .children
                .iter()
                .map(|&c| h[c] + self.tree.nodes[c].t)
                .fold(0.0, f64::max);
        }
        // Ultrametric start: equalise each node's height to the mean root-to-tip depth of its clade.
        for v in self.tree.postorder() {
            if self.tree.nodes[v].children.is_empty() {
                continue;
            }
            let mut depth_sum = 0.0;
            let mut count = 0.0;
            let mut stack: Vec<(usize, f64)> = vec![(v, 0.0)];
            while let Some((x, d)) = stack.pop() {
                if self.tree.nodes[x].children.is_empty() {
                    depth_sum += d;
                    count += 1.0;
                }
                for &c in &self.tree.nodes[x].children {
                    stack.push((c, d + self.tree.nodes[c].t));
                }
            }
            let child_max = self.tree.nodes[v].children.iter().map(|&c| h[c]).fold(0.0, f64::max);
            h[v] = (depth_sum / count).max(child_max + MIN_T);
        }
        let apply = |tree: &mut LkTree, h: &[f64]| {
            for v in 0..tree.nodes.len() {
                if let Some(p) = tree.nodes[v].parent {
                    tree.nodes[v].t = (h[p] - h[v]).max(0.0);
                }
            }
        };
        apply(&mut self.tree, &h);
        self.compute_down();
        let mut ln_l = self.log_likelihood();
        for _ in 0..max_rounds {
            let before = ln_l;
            // Global move: scale every height (node-by-node moves alone crawl when the whole
            // tree is too tall or too short).
            let h0 = h.clone();
            let mut f = |x: f64| {
                let hs: Vec<f64> = h0.iter().map(|v| v * x.exp()).collect();
                let mut t = self.tree.clone();
                apply(&mut t, &hs);
                let saved = std::mem::replace(&mut self.tree, t);
                self.compute_down();
                let l = self.log_likelihood();
                self.tree = saved;
                l
            };
            let (x, _) = brent_max(&mut f, -4.0, 4.0, 0.0, 1e-5, 40);
            for v in h.iter_mut() {
                *v *= x.exp();
            }
            apply(&mut self.tree, &h);
            self.compute_down();
            let root = self.tree.root;
            let a_root = self.root_above();
            self.height_pass(root, None, &a_root, &mut h);
            self.down[root] = self.node_down(root);
            ln_l = self.log_likelihood();
            if (ln_l - before).abs() < 1e-3 {
                break;
            }
        }
        ln_l
    }

    fn height_pass(&mut self, v: usize, b_v: Option<&Partial>, a_root: &Partial, h: &mut Vec<f64>) {
        let children = self.tree.nodes[v].children.clone();
        if children.is_empty() {
            return;
        }
        let lo = children.iter().map(|&c| h[c]).fold(0.0, f64::max);
        let parent = self.tree.nodes[v].parent;
        let hi = parent.map(|p| h[p]).unwrap_or(lo + 2.0 * MAX_T);
        if hi > lo {
            let below: Vec<(Partial, f64)> = children.iter().map(|&c| (self.down[c].clone(), h[c])).collect();
            let mut f = |hv: f64| {
                let mut acc = self.ones();
                for (l, hc) in &below {
                    Self::multiply_into(&mut acc, &self.message(l, hv - hc));
                }
                match (b_v, parent) {
                    (Some(b), Some(p)) => self.edge_ln(b, &acc, h[p] - hv),
                    _ => (0..self.pats.len()).map(|p| self.pats.weights[p] * self.site_ln(p, a_root, &acc)).sum(),
                }
            };
            let (x, _) = brent_max(&mut f, lo, hi, h[v].clamp(lo, hi), 1e-5, 40);
            h[v] = x;
            for &c in &children {
                self.tree.nodes[c].t = (h[v] - h[c]).max(0.0);
            }
            if let Some(p) = parent {
                self.tree.nodes[v].t = (h[p] - h[v]).max(0.0);
            }
        }
        let a_v = match (b_v, parent) {
            (Some(b), Some(_)) => self.cross_edge_down(b, self.tree.nodes[v].t),
            _ => a_root.clone(),
        };
        for &c in &children {
            if self.tree.nodes[c].children.is_empty() {
                continue;
            }
            let b_c = self.above_parent_side(v, &a_v, c);
            self.height_pass(c, Some(&b_c), a_root, h);
            self.down[c] = self.node_down(c);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn two_taxon_tree(t: f64) -> LkTree {
        LkTree {
            nodes: vec![
                LkNode { parent: None, children: vec![1, 2], taxon: None, t: 0.0 },
                LkNode { parent: Some(0), children: vec![], taxon: Some(0), t: t / 2.0 },
                LkNode { parent: Some(0), children: vec![], taxon: Some(1), t: t / 2.0 },
            ],
            root: 0,
        }
    }

    #[test]
    fn jc69_two_taxon_ml_distance_matches_closed_form() {
        // 100 sites, 20 differences (every fifth site differs).
        let a: String = "ACGT".repeat(25);
        let b: String = a
            .bytes()
            .enumerate()
            .map(|(i, c)| if i % 5 == 0 { if c == b'A' { 'C' } else { 'A' } } else { c as char })
            .collect();
        let pats = Patterns::from_alignment(&[a, b]);
        let spec = ModelSpec { family: Family::Jc69, gamma: false, invariant: false, n_cat: 1 };
        // Closed form, by hand: d* = -3/4 ln(1 - 4/3 * 20/100) = -3/4 ln(11/15) = 0.2326161962...
        // and ln L* = 80 ln(1/4 (1/4 + 3/4 e)) + 20 ln(1/4 (1/4 - 1/4 e)), e = exp(-4 d*/3),
        // = -210.6419242392 (Python `math`, double precision).
        let d_star = -0.75 * (1.0 - 4.0 / 3.0 * 0.2f64).ln();
        assert!((d_star - 0.232_616_196_2).abs() < 1e-10);
        let ex = (-4.0 * d_star / 3.0).exp();
        let ln_l_star = 80.0 * (0.25 * (0.25 + 0.75 * ex)).ln() + 20.0 * (0.25 * (0.25 - 0.25 * ex)).ln();
        assert!((ln_l_star - -210.641_924_239_2).abs() < 1e-9);
        // How close the fit can honestly get: each branch is a Brent maximisation over ln t that
        // stops when its bracket is within 2 * (1e-4 |ln t| + 1e-10) of the optimum, about 3.4e-4
        // in ln t at t ~ 0.18, so the fitted d is within ~6e-5 of d* (measured: within 1.1e-5 from
        // every starting length below). More fit rounds do not move
        // it (measured when this tolerance was set: `fit_to(50, 1e-12)` gave the same d to 1e-9;
        // only the sum of the two branches is identifiable and the first Brent pass lands it),
        // so 1e-4 on d (0.04%)
        // is the honest tolerance - a 0.8% bias in d (1.9e-3) fails it. Every starting length
        // must reach the same optimum. ln L is flat at the maximum: with |d - d*| < 1e-4 and the
        // Fisher information of d here (~336 per unit d^2), ln L is within ~2e-6 of ln L*.
        for t0 in [0.01, 0.1, 0.5, 2.0] {
            let mut e = Engine::new(two_taxon_tree(t0), &pats, NucModel::new(spec, [0.25; 4]));
            e.fit(3);
            let d = e.tree_length();
            assert!((d - d_star).abs() < 1e-4, "start {t0}: d = {d}, closed form {d_star}");
            assert!((e.log_likelihood() - ln_l_star).abs() < 1e-5, "start {t0}: ln L = {}", e.log_likelihood());
        }
    }

    #[test]
    fn transition_matrices_are_stochastic_and_gamma_rates_average_one() {
        let spec = ModelSpec { family: Family::Gtr, gamma: true, invariant: false, n_cat: 4 };
        let mut m = NucModel::new(spec, [0.1, 0.2, 0.3, 0.4]);
        m.set_params(&[0.3, 1.2, -0.4, 0.2, 1.0, (0.7f64).ln()]);
        for t in [0.0, 0.01, 0.5, 3.0] {
            let p = m.pmatrix(t);
            for row in p {
                assert!((row.iter().sum::<f64>() - 1.0).abs() < 1e-9);
            }
        }
        let r = discrete_gamma_rates(0.5, 4);
        assert!((r.iter().sum::<f64>() / 4.0 - 1.0).abs() < 1e-9);
        // Yang (1994) Table: α = 0.5, K = 4 mean rates 0.0334, 0.2519, 0.8203, 2.8944
        for (got, want) in r.iter().zip([0.0334, 0.2519, 0.8203, 2.8944]) {
            assert!((got - want).abs() < 1e-3, "{r:?}");
        }
        // K2P R = κ/2
        let mut k2 = NucModel::new(ModelSpec { family: Family::K2p, gamma: false, invariant: false, n_cat: 1 }, [0.25; 4]);
        k2.set_params(&[(4.0f64).ln()]);
        assert!((k2.ts_tv_ratio() - 2.0).abs() < 1e-12);
    }
}
