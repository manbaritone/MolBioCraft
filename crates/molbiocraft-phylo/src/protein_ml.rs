// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Maximum-likelihood trees for protein alignments, built in (no external program): empirical
//! amino-acid models LG, WAG and JTT with optional discrete Γ (4 categories, mean rates),
//! Felsenstein pruning with up/down partials, exact per-branch Brent optimisation, Γ-shape
//! optimisation and PhyML-style NNI hill climbing from a Neighbor-Joining (Poisson) start.
//! Checked against IQ-TREE log-likelihoods in `src/__tests__/outsideDataPhylo.test.ts`.

use crate::aa_models::*;
use crate::likelihood::{brent_max, discrete_gamma_rates, LkTree};
use crate::ml_search::MlSearchReport;

const N: usize = 20;
const AA: &[u8; 20] = b"ARNDCQEGHILKMFPSTWYV";
const MIN_T: f64 = 1e-8;
const MAX_T: f64 = 10.0;

/// An empirical amino-acid substitution model, eigen-decomposed (Q normalised to one
/// substitution per site per unit time).
#[derive(Clone)]
pub struct AaModel {
    pub name: &'static str,
    pub pi: [f64; N],
    evals: [f64; N],
    /// eigenvectors of the symmetrised matrix, column k = vector k
    u: [[f64; N]; N],
    pub gamma: bool,
    pub alpha: f64,
    rates: Vec<f64>,
}

fn jacobi(mut a: [[f64; N]; N]) -> ([f64; N], [[f64; N]; N]) {
    let mut v = [[0.0; N]; N];
    for (i, row) in v.iter_mut().enumerate() {
        row[i] = 1.0;
    }
    for _sweep in 0..100 {
        let off: f64 = (0..N).flat_map(|i| (0..N).filter(move |&j| j != i).map(move |j| (i, j))).map(|(i, j)| a[i][j] * a[i][j]).sum();
        if off < 1e-22 {
            break;
        }
        for p in 0..N {
            for q in p + 1..N {
                if a[p][q].abs() < 1e-300 {
                    continue;
                }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let t = theta.signum() / (theta.abs() + (theta * theta + 1.0).sqrt());
                let t = if theta == 0.0 { 1.0 } else { t };
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..N {
                    let (akp, akq) = (a[k][p], a[k][q]);
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for k in 0..N {
                    let (apk, aqk) = (a[p][k], a[q][k]);
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for row in v.iter_mut() {
                    let (vkp, vkq) = (row[p], row[q]);
                    row[p] = c * vkp - s * vkq;
                    row[q] = s * vkp + c * vkq;
                }
            }
        }
    }
    let mut e = [0.0; N];
    for (i, x) in e.iter_mut().enumerate() {
        *x = a[i][i];
    }
    (e, v)
}

impl AaModel {
    /// "LG", "WAG" or "JTT", optionally "+G" (case-insensitive).
    pub fn parse(spec: &str) -> Option<AaModel> {
        let up = spec.to_ascii_uppercase();
        let base = up.split('+').next().unwrap_or("").trim();
        let (name, ex, fr) = match base {
            "LG" => ("LG", &LG_EXCHANGE, &LG_FREQS),
            "WAG" => ("WAG", &WAG_EXCHANGE, &WAG_FREQS),
            "JTT" => ("JTT", &JTT_EXCHANGE, &JTT_FREQS),
            _ => return None,
        };
        let mut pi = *fr;
        let s: f64 = pi.iter().sum();
        for x in pi.iter_mut() {
            *x /= s;
        }
        let mut sx = [[0.0; N]; N];
        let mut k = 0;
        for i in 1..N {
            for j in 0..i {
                sx[i][j] = ex[k];
                sx[j][i] = ex[k];
                k += 1;
            }
        }
        // mean rate Σ_i π_i Σ_{j≠i} S_ij π_j
        let mean: f64 = (0..N).map(|i| pi[i] * (0..N).filter(|&j| j != i).map(|j| sx[i][j] * pi[j]).sum::<f64>()).sum();
        let mut b = [[0.0; N]; N];
        for i in 0..N {
            let mut diag = 0.0;
            for j in 0..N {
                if i != j {
                    b[i][j] = sx[i][j] * (pi[i] * pi[j]).sqrt() / mean;
                    diag += sx[i][j] * pi[j] / mean;
                }
            }
            b[i][i] = -diag;
        }
        let (evals, u) = jacobi(b);
        let gamma = up.contains("+G");
        let mut m = AaModel { name, pi, evals, u, gamma, alpha: 1.0, rates: vec![1.0] };
        m.set_alpha(if gamma { 0.5 } else { 1.0 });
        Some(m)
    }

    pub fn set_alpha(&mut self, alpha: f64) {
        self.alpha = alpha;
        self.rates = if self.gamma { discrete_gamma_rates(alpha, 4) } else { vec![1.0] };
    }

    pub fn n_cat(&self) -> usize {
        self.rates.len()
    }

    /// P(t)[i][j].
    pub fn pmatrix(&self, t: f64) -> [[f64; N]; N] {
        let e: Vec<f64> = self.evals.iter().map(|l| (l * t).exp()).collect();
        let mut p = [[0.0; N]; N];
        for i in 0..N {
            for j in 0..N {
                let mut s = 0.0;
                for k in 0..N {
                    s += self.u[i][k] * self.u[j][k] * e[k];
                }
                p[i][j] = (s * (self.pi[j] / self.pi[i]).sqrt()).max(0.0);
            }
        }
        p
    }

    pub fn name(&self) -> String {
        format!("{}{}", self.name, if self.gamma { "+G" } else { "" })
    }
}

fn aa_mask(b: u8) -> u32 {
    let idx = |c: u8| AA.iter().position(|&x| x == c).map(|i| 1u32 << i).unwrap_or(0);
    match b.to_ascii_uppercase() {
        b'B' => idx(b'N') | idx(b'D'),
        b'Z' => idx(b'Q') | idx(b'E'),
        b'J' => idx(b'I') | idx(b'L'),
        c => {
            let m = idx(c);
            if m == 0 { (1u32 << N) - 1 } else { m }
        }
    }
}

/// Site patterns of a protein alignment (gaps / X as missing data).
pub struct AaPatterns {
    pub cols: Vec<Vec<u32>>,
    pub weights: Vec<f64>,
}

impl AaPatterns {
    pub fn from_alignment(seqs: &[String]) -> Self {
        let len = seqs.iter().map(|s| s.len()).max().unwrap_or(0);
        let mut map: std::collections::HashMap<Vec<u32>, usize> = std::collections::HashMap::new();
        let mut cols = Vec::new();
        let mut weights = Vec::new();
        for c in 0..len {
            let col: Vec<u32> = seqs.iter().map(|s| aa_mask(*s.as_bytes().get(c).unwrap_or(&b'-'))).collect();
            match map.get(&col) {
                Some(&i) => weights[i] += 1.0,
                None => {
                    map.insert(col.clone(), cols.len());
                    cols.push(col);
                    weights.push(1.0);
                }
            }
        }
        AaPatterns { cols, weights }
    }
}

#[derive(Clone)]
struct Part {
    v: Vec<f64>,
    ls: Vec<f64>,
}

pub struct AaEngine<'a> {
    pub tree: LkTree,
    pats: &'a AaPatterns,
    pub model: AaModel,
    down: Vec<Part>,
}

impl<'a> AaEngine<'a> {
    pub fn new(tree: LkTree, pats: &'a AaPatterns, model: AaModel) -> Self {
        let mut e = AaEngine { tree, pats, model, down: Vec::new() };
        e.compute_down();
        e
    }
    fn kp(&self) -> (usize, usize) {
        (self.model.n_cat(), self.pats.cols.len())
    }
    fn ones(&self) -> Part {
        let (k, np) = self.kp();
        Part { v: vec![1.0; np * k * N], ls: vec![0.0; np] }
    }
    fn leaf(&self, taxon: usize) -> Part {
        let (k, np) = self.kp();
        let mut v = vec![0.0; np * k * N];
        for p in 0..np {
            let m = self.pats.cols[p][taxon];
            for c in 0..k {
                for s in 0..N {
                    v[(p * k + c) * N + s] = if m >> s & 1 == 1 { 1.0 } else { 0.0 };
                }
            }
        }
        Part { v, ls: vec![0.0; np] }
    }
    fn pmats(&self, t: f64) -> Vec<[[f64; N]; N]> {
        let t = t.max(MIN_T);
        self.model.rates.iter().map(|r| self.model.pmatrix(t * r)).collect()
    }
    fn message(&self, child: &Part, t: f64) -> Part {
        let (k, np) = self.kp();
        let pm = self.pmats(t);
        let mut v = vec![0.0; np * k * N];
        for p in 0..np {
            for c in 0..k {
                let base = (p * k + c) * N;
                let l = &child.v[base..base + N];
                for x in 0..N {
                    let row = &pm[c][x];
                    let mut s = 0.0;
                    for y in 0..N {
                        s += row[y] * l[y];
                    }
                    v[base + x] = s;
                }
            }
        }
        Part { v, ls: child.ls.clone() }
    }
    fn mul(acc: &mut Part, o: &Part) {
        for (a, b) in acc.v.iter_mut().zip(&o.v) {
            *a *= b;
        }
        for (a, b) in acc.ls.iter_mut().zip(&o.ls) {
            *a += b;
        }
    }
    fn rescale(&self, part: &mut Part) {
        let (k, np) = self.kp();
        for p in 0..np {
            let sl = &mut part.v[p * k * N..(p + 1) * k * N];
            let m = sl.iter().copied().fold(0.0f64, f64::max);
            if m > 0.0 && !(1e-50..=1e50).contains(&m) {
                for x in sl.iter_mut() {
                    *x /= m;
                }
                part.ls[p] += m.ln();
            }
        }
    }
    fn node_down(&self, v: usize) -> Part {
        if let Some(t) = self.tree.nodes[v].taxon {
            if self.tree.nodes[v].children.is_empty() {
                return self.leaf(t);
            }
        }
        let mut acc = self.ones();
        for &c in &self.tree.nodes[v].children {
            let m = self.message(&self.down[c], self.tree.nodes[c].t);
            Self::mul(&mut acc, &m);
        }
        self.rescale(&mut acc);
        acc
    }
    pub fn compute_down(&mut self) {
        self.down = vec![Part { v: Vec::new(), ls: Vec::new() }; self.tree.nodes.len()];
        for v in self.tree.postorder() {
            self.down[v] = self.node_down(v);
        }
    }
    fn root_above(&self) -> Part {
        let (k, np) = self.kp();
        let mut v = vec![0.0; np * k * N];
        for ch in v.chunks_mut(N) {
            ch.copy_from_slice(&self.model.pi);
        }
        Part { v, ls: vec![0.0; np] }
    }
    fn ln_pair(&self, above: &Part, below: &Part) -> f64 {
        let (k, np) = self.kp();
        let mut tot = 0.0;
        for p in 0..np {
            let base = p * k * N;
            let mut s = 0.0;
            for i in 0..k * N {
                s += above.v[base + i] * below.v[base + i];
            }
            let s = s / k as f64;
            tot += self.pats.weights[p] * if s > 0.0 { s.ln() + above.ls[p] + below.ls[p] } else { -1e10 };
        }
        tot
    }
    pub fn log_likelihood(&self) -> f64 {
        self.ln_pair(&self.root_above(), &self.down[self.tree.root])
    }
    fn above_parent_side(&self, v: usize, a_v: &Part, c: usize) -> Part {
        let mut acc = a_v.clone();
        for &s in &self.tree.nodes[v].children {
            if s != c {
                let m = self.message(&self.down[s], self.tree.nodes[s].t);
                Self::mul(&mut acc, &m);
            }
        }
        self.rescale(&mut acc);
        acc
    }
    fn cross_down(&self, b: &Part, t: f64) -> Part {
        let (k, np) = self.kp();
        let pm = self.pmats(t);
        let mut v = vec![0.0; np * k * N];
        for p in 0..np {
            for c in 0..k {
                let base = (p * k + c) * N;
                for y in 0..N {
                    let mut s = 0.0;
                    for x in 0..N {
                        s += b.v[base + x] * pm[c][x][y];
                    }
                    v[base + y] = s;
                }
            }
        }
        Part { v, ls: b.ls.clone() }
    }
    fn edge_ln(&self, b: &Part, below: &Part, t: f64) -> f64 {
        self.ln_pair(b, &self.message(below, t))
    }
    /// One sweep optimising every branch length; returns ln L.
    pub fn optimize_branches(&mut self) -> f64 {
        let root = self.tree.root;
        let a = self.root_above();
        self.branch_pass(root, &a);
        self.down[root] = self.node_down(root);
        self.log_likelihood()
    }
    fn branch_pass(&mut self, v: usize, a_v: &Part) {
        let children = self.tree.nodes[v].children.clone();
        for c in children {
            let b = self.above_parent_side(v, a_v, c);
            let below = self.down[c].clone();
            let t0 = self.tree.nodes[c].t.clamp(MIN_T, MAX_T);
            let mut f = |x: f64| self.edge_ln(&b, &below, x.exp());
            let (x, _) = brent_max(&mut f, MIN_T.ln(), MAX_T.ln(), t0.ln(), 1e-4, 40);
            self.tree.nodes[c].t = x.exp();
            if !self.tree.nodes[c].children.is_empty() {
                let a_c = self.cross_down(&b, self.tree.nodes[c].t);
                self.branch_pass(c, &a_c);
                self.down[c] = self.node_down(c);
            }
        }
    }
    fn optimize_alpha(&mut self) -> f64 {
        if !self.model.gamma {
            return self.log_likelihood();
        }
        let a0 = self.model.alpha.ln();
        let mut f = |x: f64| {
            self.model.set_alpha(x.exp());
            self.compute_down();
            self.log_likelihood()
        };
        let (x, _) = brent_max(&mut f, (0.02f64).ln(), (100.0f64).ln(), a0, 1e-3, 30);
        self.model.set_alpha(x.exp());
        self.compute_down();
        self.log_likelihood()
    }
    /// Alternating branch-length and Γ-shape optimisation until ln L changes by < tol.
    pub fn fit(&mut self, rounds: usize, tol: f64) -> f64 {
        let mut l = self.optimize_branches();
        for _ in 0..rounds {
            let before = l;
            self.optimize_alpha();
            l = self.optimize_branches();
            if (l - before).abs() < tol {
                break;
            }
        }
        l
    }
    fn all_above(&self) -> Vec<Part> {
        let n = self.tree.nodes.len();
        let mut above = vec![Part { v: Vec::new(), ls: Vec::new() }; n];
        above[self.tree.root] = self.root_above();
        for v in self.tree.preorder() {
            let a_v = above[v].clone();
            for &c in &self.tree.nodes[v].children {
                let b = self.above_parent_side(v, &a_v, c);
                above[c] = self.cross_down(&b, self.tree.nodes[c].t);
            }
        }
        above
    }
    fn nni_quick(&self, above: &[Part], c: usize, x: usize, s: usize) -> (f64, f64) {
        let v = self.tree.nodes[c].parent.expect("non-root");
        let other = *self.tree.nodes[c].children.iter().find(|&&k| k != x).expect("binary");
        let mut dc = self.ones();
        Self::mul(&mut dc, &self.message(&self.down[s], self.tree.nodes[s].t));
        Self::mul(&mut dc, &self.message(&self.down[other], self.tree.nodes[other].t));
        self.rescale(&mut dc);
        let mut b = above[v].clone();
        Self::mul(&mut b, &self.message(&self.down[x], self.tree.nodes[x].t));
        for &y in &self.tree.nodes[v].children {
            if y != c && y != s {
                let m = self.message(&self.down[y], self.tree.nodes[y].t);
                Self::mul(&mut b, &m);
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
    /// NNI hill climbing (as the nucleotide engine); returns (swaps, rounds, evaluated).
    pub fn nni_search(&mut self, max_rounds: usize) -> (usize, usize, usize) {
        let (mut swaps, mut rounds, mut evaluated) = (0, 0, 0);
        let mut ln_l = self.log_likelihood();
        for _ in 0..max_rounds {
            rounds += 1;
            let above = self.all_above();
            let mut cands: Vec<(f64, usize, usize, usize, f64)> = Vec::new();
            for c in 0..self.tree.nodes.len() {
                let Some(v) = self.tree.nodes[c].parent else { continue };
                if self.tree.nodes[c].children.len() != 2 {
                    continue;
                }
                let Some(&s) = self.tree.nodes[v].children.iter().find(|&&k| k != c) else { continue };
                for &x in &self.tree.nodes[c].children {
                    evaluated += 1;
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
            let mut applied = 0;
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
            swaps += applied;
            ln_l = new_l;
        }
        (swaps, rounds, evaluated)
    }
    pub fn tree_length(&self) -> f64 {
        self.tree.nodes.iter().enumerate().filter(|(i, _)| *i != self.tree.root).map(|(_, n)| n.t).sum()
    }
}

/// Built-in ML tree search for a protein alignment: NJ (Poisson) start, model fit, NNI rounds.
pub fn protein_ml_tree_search(names: &[String], seqs: &[String], model: &str) -> Result<MlSearchReport, String> {
    let n = names.len().min(seqs.len());
    if n < 4 {
        return Err("Maximum-likelihood search needs at least 4 sequences.".into());
    }
    let w = seqs[0].len();
    if seqs[..n].iter().any(|s| s.len() != w) {
        return Err("Sequences must be aligned (equal length).".into());
    }
    let m = AaModel::parse(model).ok_or_else(|| format!("Unknown protein model \"{model}\" (use LG, WAG or JTT, optionally +G)."))?;
    // (any corrected model name gives Poisson-corrected amino-acid distances)
    let start = crate::trees::nj_likelihood_tree(&names[..n], &seqs[..n], "Jukes-Cantor (JC69)")
        .ok_or("Could not build a starting tree (some pairwise distances are undefined).")?;
    let tree = crate::ml_search::unroot(&start);
    let pats = AaPatterns::from_alignment(&seqs[..n]);
    let mut eng = AaEngine::new(tree, &pats, m);
    let start_l = eng.fit(5, 1e-3);
    let (mut swaps, mut rounds, mut evaluated) = (0, 0, 0);
    let mut ln_l = start_l;
    for _ in 0..4 {
        let (s, r, e) = eng.nni_search(200);
        swaps += s;
        rounds += r;
        evaluated += e;
        ln_l = eng.fit(3, 1e-3);
        if s == 0 {
            break;
        }
    }
    let labels = crate::ml_search::unique_labels(&names[..n]);
    let mut params = vec![format!("{} empirical rates and frequencies", eng.model.name)];
    if eng.model.gamma {
        params.push(format!("Γ shape α = {:.3} (4 categories)", eng.model.alpha));
    }
    Ok(MlSearchReport {
        newick: crate::ml_search::newick_of(&eng.tree, &labels),
        model: eng.model.name(),
        log_likelihood: (ln_l * 1000.0).round() / 1000.0,
        start_log_likelihood: (start_l * 1000.0).round() / 1000.0,
        nni_swaps: swaps,
        nni_rounds: rounds,
        nni_evaluated: evaluated,
        tree_length: eng.tree_length(),
        parameters: params.join("; "),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn transition_matrices_are_stochastic_and_reversible() {
        for spec in ["LG", "WAG", "JTT+G"] {
            let m = AaModel::parse(spec).unwrap();
            let p = m.pmatrix(0.3);
            for i in 0..N {
                let row: f64 = p[i].iter().sum();
                assert!((row - 1.0).abs() < 1e-9, "{spec} row {i} sums to {row}");
                for j in 0..N {
                    assert!((m.pi[i] * p[i][j] - m.pi[j] * p[j][i]).abs() < 1e-12);
                }
            }
            // one expected substitution per unit time
            let rate: f64 = (0..N).map(|i| m.pi[i] * (1.0 - m.pmatrix(1e-6)[i][i]) / 1e-6).sum();
            assert!((rate - 1.0).abs() < 1e-3, "{spec}: {rate}");
        }
    }
}
