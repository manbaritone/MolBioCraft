// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Coalescent Population Genetics, Hudson-Kaplan Four-Gamete Minimum Recombination ($R_m$),
//! Linkage Disequilibrium ($D, |D'|, r^2, \chi^2$), Fu & Li's $D^*/F^*$, Fay & Wu's $H$,
//! McDonald-Kreitman ($MK$) Adaptive Divergence Test (`statrs`), and `petgraph`-Powered
//! Robinson-Foulds ($RF$) Phylogenetic Tree Clade Topology Comparison.

use molbiocraft_core::format_thousands;
use petgraph::graph::{DiGraph, NodeIndex};
use petgraph::Direction;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::{Deserialize, Serialize};
use statrs::distribution::{ChiSquared, ContinuousCDF};

use crate::distances::translate_standard_codon;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkageDisequilibriumPair {
    pub site_i_bp: usize, // 1-based
    pub site_j_bp: usize, // 1-based
    pub distance_bp: usize,
    pub d_raw: f64,
    pub d_prime_abs: f64,
    pub r_squared: f64,
    pub chi_sq: f64,
    pub p_value: f64,
    pub four_gamete_violation: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecombinationInterval {
    pub left_snp_bp: usize,
    pub right_snp_bp: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecombinationAndLdReport {
    pub num_sequences: usize,
    pub alignment_length_bp: usize,
    pub segregating_sites_s: usize,
    pub singleton_mutations_eta_s: usize,
    pub distinct_haplotypes: usize,
    pub haplotype_diversity_hd: f64,
    pub watterson_theta_per_site: f64,
    pub nucleotide_diversity_pi: f64,
    pub fu_li_d_star: f64,
    pub fu_li_f_star: f64,
    pub fay_wu_h: f64,
    /// Rm, the mean r² and |D'| and the four-gamete count are computed over the first
    /// `biallelic_sites_used` of the `biallelic_sites_total` biallelic sites.
    pub minimum_recombination_events_rm: usize,
    pub mean_r_squared: f64,
    pub mean_d_prime: f64,
    pub four_gamete_incompatible_pairs: usize,
    pub rm_intervals: Vec<RecombinationInterval>,
    /// The first site pairs (in site order) of the `ld_pairs_total` pairs evaluated.
    pub ld_pairs: Vec<LinkageDisequilibriumPair>,
    /// Biallelic sites (no gap or ambiguity code) in the whole alignment.
    #[serde(default)]
    pub biallelic_sites_total: usize,
    /// Biallelic sites the pairwise statistics use: the first 2,000 of them at most.
    #[serde(default)]
    pub biallelic_sites_used: usize,
    /// Site pairs evaluated: every pair of the sites used.
    #[serde(default)]
    pub ld_pairs_total: usize,
    /// One plain sentence per bound that left sites or pairs out (D0005); empty when none did.
    #[serde(default)]
    pub warnings: Vec<String>,
}

/// The most biallelic sites the pairwise statistics use: the pairs grow with the square of the
/// sites (2,000 sites are 1,999,000 pairs), and the call is synchronous.
const MAX_LD_SITES: usize = 2000;
/// The most site pairs `ld_pairs` lists.
const MAX_LD_PAIRS_LISTED: usize = 250;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McDonaldKreitmanReport {
    pub ingroup_count: usize,
    pub codons_analyzed: usize,
    pub polymorphic_nonsynonymous_pn: usize,
    pub polymorphic_synonymous_ps: usize,
    pub fixed_nonsynonymous_dn: usize,
    pub fixed_synonymous_ds: usize,
    pub neutrality_index_ni: f64,
    pub alpha_adaptive_fraction: f64,
    pub direction_of_selection_dos: f64,
    pub chi_sq_yates: f64,
    pub p_value: f64,
    pub evolutionary_regime: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RobinsonFouldsReport {
    pub shared_taxa_count: usize,
    pub tree_a_nontrivial_splits: usize,
    pub tree_b_nontrivial_splits: usize,
    pub shared_splits: usize,
    pub unique_to_tree_a: usize,
    pub unique_to_tree_b: usize,
    pub robinson_foulds_distance: usize,
    pub max_possible_rf: usize,
    pub normalized_rf: f64,
    pub clade_concordance_pct: f64,
}

/// Computes Hudson & Kaplan (1985) minimum recombination events ($R_m$), pairwise linkage
/// disequilibrium ($D, |D'|, r^2$), haplotype diversity ($H_d$), Fu & Li's $D^*/F^*$ (1993),
/// and Fay & Wu's $H$ (2000) across an aligned population dataset.
pub fn analyze_recombination_and_ld(aligned_seqs: &[String]) -> RecombinationAndLdReport {
    let n = aligned_seqs.len();
    let len = aligned_seqs.first().map(|s| s.len()).unwrap_or(0);
    if n < 3 || len == 0 {
        return RecombinationAndLdReport {
            num_sequences: n,
            alignment_length_bp: len,
            segregating_sites_s: 0,
            singleton_mutations_eta_s: 0,
            distinct_haplotypes: n,
            haplotype_diversity_hd: 0.0,
            watterson_theta_per_site: 0.0,
            nucleotide_diversity_pi: 0.0,
            fu_li_d_star: 0.0,
            fu_li_f_star: 0.0,
            fay_wu_h: 0.0,
            minimum_recombination_events_rm: 0,
            mean_r_squared: 0.0,
            mean_d_prime: 0.0,
            four_gamete_incompatible_pairs: 0,
            rm_intervals: Vec::new(),
            ld_pairs: Vec::new(),
            biallelic_sites_total: 0,
            biallelic_sites_used: 0,
            ld_pairs_total: 0,
            warnings: Vec::new(),
        };
    }

    let rows: Vec<Vec<u8>> = aligned_seqs
        .iter()
        .map(|s| {
            s.bytes()
                .map(|b| {
                    let u = b.to_ascii_uppercase();
                    if u == b'U' {
                        b'T'
                    } else {
                        u
                    }
                })
                .collect()
        })
        .collect();

    // Haplotype diversity Hd = (N / (N - 1)) * (1 - sum p_h^2)
    let mut hap_counts: FxHashMap<&[u8], usize> = FxHashMap::default();
    for r in &rows {
        *hap_counts.entry(r.as_slice()).or_insert(0) += 1;
    }
    let nf = n as f64;
    let sum_ph2: f64 = hap_counts
        .values()
        .map(|&c| {
            let p = (c as f64) / nf;
            p * p
        })
        .sum();
    let hd = (nf / (nf - 1.0)) * (1.0 - sum_ph2);

    // Collect segregating sites and biallelic SNP columns (major=0, minor=1)
    let mut s_total = 0usize;
    let mut eta_singletons = 0usize;
    let mut pi_site_sum = 0.0f64;
    let mut theta_h_sum = 0.0f64; // Fay & Wu theta_H using last sequence as ancestral proxy
    let mut biallelic_sites: Vec<(usize, Vec<u8>)> = Vec::new(); // (1-based pos, 0/1 allele vec)
    let mut valid_sites = 0usize; // complete-deletion site count (no gaps / ambiguity)
    let mut theta_pi_ingroup = 0.0f64; // Fay & Wu θ_π on the ingroup, same sites as θ_H

    for col in 0..len {
        let mut counts = [0usize; 4]; // A, C, G, T
        let mut gap_or_ambig = false;
        for r in &rows {
            if col >= r.len() {
                gap_or_ambig = true;
                break;
            }
            match r[col] {
                b'A' => counts[0] += 1,
                b'C' => counts[1] += 1,
                b'G' => counts[2] += 1,
                b'T' => counts[3] += 1,
                _ => {
                    gap_or_ambig = true;
                    break;
                }
            }
        }
        if gap_or_ambig {
            continue;
        }
        valid_sites += 1;

        let present_alleles: Vec<(usize, usize)> = counts
            .iter()
            .copied()
            .enumerate()
            .filter(|&(_, c)| c > 0)
            .collect();
        if present_alleles.len() <= 1 {
            continue;
        }

        s_total += 1;
        for &(_, c) in &present_alleles {
            if c == 1 {
                eta_singletons += 1;
            }
        }

        // Exact pairwise mismatches at this site
        let same_pairs: usize = present_alleles
            .iter()
            .map(|&(_, c)| c * c.saturating_sub(1) / 2)
            .sum();
        let tot_pairs = n * (n - 1) / 2;
        let diff_pairs = tot_pairs.saturating_sub(same_pairs);
        pi_site_sum += (diff_pairs as f64) / (tot_pairs as f64);

        // Fay & Wu theta_H: use sequence[n-1] as ancestral state proxy for ingroup 0..(n-1)
        let anc = rows[n - 1][col];
        let mut derived_cnt = 0usize;
        for r in rows.iter().take(n - 1) {
            if r[col] != anc {
                derived_cnt += 1;
            }
        }
        let n_in = (n - 1) as f64;
        if n_in >= 2.0 && derived_cnt > 0 && derived_cnt < (n - 1) {
            let dc = derived_cnt as f64;
            theta_h_sum += (2.0 * dc * dc) / (n_in * (n_in - 1.0));
            theta_pi_ingroup += (2.0 * dc * (n_in - dc)) / (n_in * (n_in - 1.0));
        }

        if present_alleles.len() == 2 {
            let major_code = if present_alleles[0].1 >= present_alleles[1].1 {
                present_alleles[0].0
            } else {
                present_alleles[1].0
            };
            let major_base = [b'A', b'C', b'G', b'T'][major_code];
            let bit_col: Vec<u8> = rows
                .iter()
                .map(|r| if r[col] == major_base { 0u8 } else { 1u8 })
                .collect();
            biallelic_sites.push((col + 1, bit_col));
        }
    }

    let a1: f64 = (1..n).map(|i| 1.0 / (i as f64)).sum();
    let a2: f64 = (1..n).map(|i| 1.0 / ((i * i) as f64)).sum();
    let s_f = s_total as f64;
    let eta_s = eta_singletons as f64;
    let watterson_per_seq = if a1 > 0.0 { s_f / a1 } else { 0.0 };
    let l_valid = valid_sites.max(1) as f64;
    let pi_per_site = pi_site_sum / l_valid;
    let watterson_per_site = watterson_per_seq / l_valid;

    // Fu & Li (1993) D* and F* variance coefficients
    let cn = if n == 2 {
        1.0
    } else {
        2.0 * (nf * a1 - 2.0 * (nf - 1.0)) / ((nf - 1.0) * (nf - 2.0))
    };
    let dn = cn
        + (nf - 2.0) / ((nf - 1.0) * (nf - 1.0))
        + (2.0 / (nf - 1.0)) * (1.5 - (2.0 * (a1 + 1.0 / nf) - 3.0) / (nf - 2.0) - 1.0 / nf);
    let v_d = (((nf / (nf - 1.0)).powi(2)) * a2 + a1 * a1 * dn
        - (2.0 * nf * a1 * (a1 + 1.0)) / ((nf - 1.0).powi(2)))
        / (a1 * a1 + a2);
    let u_d = (nf / (nf - 1.0)) * (a1 - nf / (nf - 1.0)) - v_d;

    let denom_d = (u_d * s_f + v_d * s_f * s_f).max(0.0).sqrt();
    let fu_li_d_star = if s_total > 0 && denom_d > 1e-9 {
        ((nf / (nf - 1.0)) * s_f - a1 * eta_s) / denom_d
    } else {
        f64::NAN
    };

    // Fu & Li (1993) F*, with the variance terms as corrected by Simonsen, Churchill &
    // Aquadro (1995, Genetics 141:413) — the coefficients DnaSP uses.
    let a_n1 = a1 + 1.0 / nf;
    let v_f = ((2.0 * nf.powi(3) + 110.0 * nf * nf - 255.0 * nf + 153.0) / (9.0 * nf * nf * (nf - 1.0))
        + 2.0 * (nf - 1.0) * a1 / (nf * nf)
        - 8.0 * a2 / nf)
        / (a1 * a1 + a2);
    let u_f = ((4.0 * nf * nf + 19.0 * nf + 3.0 - 12.0 * (nf + 1.0) * a_n1) / (3.0 * nf * (nf - 1.0))) / a1 - v_f;
    let denom_f = (u_f * s_f + v_f * s_f * s_f).max(0.0).sqrt();
    let fu_li_f_star = if s_total > 0 && denom_f > 1e-9 {
        (pi_site_sum - ((nf - 1.0) / nf) * eta_s) / denom_f
    } else {
        f64::NAN
    };

    // Fay & Wu (2000) unnormalised H = θ_π − θ_H on the ingroup, with the last sequence as outgroup.
    let fay_wu_h = theta_pi_ingroup - theta_h_sum;

    // Pairwise LD & Hudson-Kaplan four-gamete intervals over the first MAX_LD_SITES biallelic
    // sites; the first MAX_LD_PAIRS_LISTED pairs are listed. `warnings` names both bounds.
    let capped_m = biallelic_sites.len().min(MAX_LD_SITES);
    let chi1 = ChiSquared::new(1.0).ok();
    let mut ld_pairs = Vec::new();
    let mut incompatible_intervals: Vec<(usize, usize)> = Vec::new();
    let mut r2_sum = 0.0f64;
    let mut dp_sum = 0.0f64;

    for i in 0..capped_m {
        let (pos_i, ref col_i) = biallelic_sites[i];
        let c1_i = col_i.iter().filter(|&&b| b == 1).count();
        let p_a = (c1_i as f64) / nf;

        for j in (i + 1)..capped_m {
            let (pos_j, ref col_j) = biallelic_sites[j];
            let c1_j = col_j.iter().filter(|&&b| b == 1).count();
            let p_b = (c1_j as f64) / nf;

            let mut g00 = 0usize;
            let mut g01 = 0usize;
            let mut g10 = 0usize;
            let mut g11 = 0usize;
            for k in 0..n {
                match (col_i[k], col_j[k]) {
                    (0, 0) => g00 += 1,
                    (0, 1) => g01 += 1,
                    (1, 0) => g10 += 1,
                    _ => g11 += 1,
                }
            }

            let four_gamete = g00 > 0 && g01 > 0 && g10 > 0 && g11 > 0;
            if four_gamete {
                incompatible_intervals.push((pos_i, pos_j));
            }

            let p_ab = (g11 as f64) / nf;
            let d = p_ab - p_a * p_b;
            let d_max = if d >= 0.0 {
                (p_a * (1.0 - p_b)).min((1.0 - p_a) * p_b)
            } else {
                (p_a * p_b).min((1.0 - p_a) * (1.0 - p_b))
            };
            let dp = if d_max > 1e-12 {
                (d.abs() / d_max).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let denom_r2 = p_a * (1.0 - p_a) * p_b * (1.0 - p_b);
            let r2 = if denom_r2 > 1e-12 {
                ((d * d) / denom_r2).clamp(0.0, 1.0)
            } else {
                0.0
            };
            let chi_sq = nf * r2;
            let p_val = chi1
                .as_ref()
                .map(|dist| (1.0 - dist.cdf(chi_sq)).clamp(0.0, 1.0))
                .unwrap_or(1.0);

            r2_sum += r2;
            dp_sum += dp;

            if ld_pairs.len() < MAX_LD_PAIRS_LISTED {
                ld_pairs.push(LinkageDisequilibriumPair {
                    site_i_bp: pos_i,
                    site_j_bp: pos_j,
                    distance_bp: pos_j.saturating_sub(pos_i),
                    d_raw: (d * 10000.0).round() / 10000.0,
                    d_prime_abs: (dp * 10000.0).round() / 10000.0,
                    r_squared: (r2 * 10000.0).round() / 10000.0,
                    chi_sq: (chi_sq * 1000.0).round() / 1000.0,
                    p_value: p_val,
                    four_gamete_violation: four_gamete,
                });
            }
        }
    }

    let total_pairs_evaluated = if capped_m >= 2 {
        capped_m * (capped_m - 1) / 2
    } else {
        0
    };
    let incompatible_count = incompatible_intervals.len();

    let mut warnings = Vec::new();
    if biallelic_sites.len() > capped_m {
        warnings.push(format!(
            "Linkage disequilibrium, the four-gamete test and Rm use the first {} of {} biallelic sites (alignment columns 1 to {} of {}).",
            format_thousands(capped_m),
            format_thousands(biallelic_sites.len()),
            format_thousands(biallelic_sites[capped_m - 1].0),
            format_thousands(len)
        ));
    }
    if total_pairs_evaluated > ld_pairs.len() {
        warnings.push(format!(
            "The pair table lists the first {} of {} site pairs.",
            format_thousands(ld_pairs.len()),
            format_thousands(total_pairs_evaluated)
        ));
    }

    // Hudson & Kaplan (1985) greedy right-endpoint interval scheduling for exact R_m:
    // Maximum number of pairwise-disjoint four-gamete incompatible intervals (l, r)
    incompatible_intervals.sort_unstable_by(|a, b| a.1.cmp(&b.1).then_with(|| b.0.cmp(&a.0)));
    let mut rm_intervals = Vec::new();
    let mut last_right = 0usize;
    for (l, r) in incompatible_intervals {
        if l >= last_right {
            rm_intervals.push(RecombinationInterval {
                left_snp_bp: l,
                right_snp_bp: r,
            });
            last_right = r;
        }
    }

    let r4 = |v: f64| (v * 10000.0).round() / 10000.0;

    RecombinationAndLdReport {
        num_sequences: n,
        alignment_length_bp: len,
        segregating_sites_s: s_total,
        singleton_mutations_eta_s: eta_singletons,
        distinct_haplotypes: hap_counts.len(),
        haplotype_diversity_hd: r4(hd),
        watterson_theta_per_site: r4(watterson_per_site),
        nucleotide_diversity_pi: r4(pi_per_site),
        fu_li_d_star: r4(fu_li_d_star),
        fu_li_f_star: r4(fu_li_f_star),
        fay_wu_h: r4(fay_wu_h),
        minimum_recombination_events_rm: rm_intervals.len(),
        mean_r_squared: if total_pairs_evaluated > 0 {
            r4(r2_sum / total_pairs_evaluated as f64)
        } else {
            0.0
        },
        mean_d_prime: if total_pairs_evaluated > 0 {
            r4(dp_sum / total_pairs_evaluated as f64)
        } else {
            0.0
        },
        four_gamete_incompatible_pairs: incompatible_count,
        rm_intervals,
        ld_pairs,
        biallelic_sites_total: biallelic_sites.len(),
        biallelic_sites_used: capped_m,
        ld_pairs_total: total_pairs_evaluated,
        warnings,
    }
}

/// Runs the McDonald-Kreitman (1991) $2 \times 2$ polymorphism-vs-divergence adaptive evolution test
/// comparing ingroup coding alignments against a diverged outgroup coding sequence.
pub fn run_mcdonald_kreitman_test(
    ingroup_cds: &[String],
    outgroup_cds: &str,
) -> McDonaldKreitmanReport {
    let n_in = ingroup_cds.len();
    let min_len = ingroup_cds
        .iter()
        .map(|s| s.len())
        .chain(std::iter::once(outgroup_cds.len()))
        .min()
        .unwrap_or(0);
    let num_codons = min_len / 3;

    if n_in < 2 || num_codons == 0 {
        return McDonaldKreitmanReport {
            ingroup_count: n_in,
            codons_analyzed: num_codons,
            polymorphic_nonsynonymous_pn: 0,
            polymorphic_synonymous_ps: 0,
            fixed_nonsynonymous_dn: 0,
            fixed_synonymous_ds: 0,
            neutrality_index_ni: f64::NAN,
            alpha_adaptive_fraction: f64::NAN,
            direction_of_selection_dos: f64::NAN,
            chi_sq_yates: f64::NAN,
            p_value: f64::NAN,
            evolutionary_regime: "Insufficient Ingroup/Outgroup Codons".into(),
        };
    }

    let in_up: Vec<Vec<u8>> = ingroup_cds.iter().map(|s| s.to_ascii_uppercase().replace('U', "T").into_bytes()).collect();
    let out_up = outgroup_cds.to_ascii_uppercase().replace('U', "T").into_bytes();
    let is_base = |b: u8| matches!(b, b'A' | b'C' | b'G' | b'T');
    let aa_of = |c: &[u8]| translate_standard_codon(std::str::from_utf8(c).unwrap_or("NNN"));

    // Changes are counted per nucleotide site (McDonald & Kreitman 1991). Each change is classified
    // by substituting it alone into the ingroup majority codon; codons with gaps, ambiguity or a
    // stop codon in any sequence are skipped.
    let (mut pn, mut ps, mut dn, mut ds) = (0usize, 0usize, 0usize, 0usize);
    let mut analysed = 0usize;
    for c_idx in 0..num_codons {
        let r = c_idx * 3..c_idx * 3 + 3;
        let out_cod = &out_up[r.clone()];
        let ok = |c: &[u8]| c.iter().all(|&b| is_base(b)) && aa_of(c) != "*";
        if !ok(out_cod) || in_up.iter().any(|s| !ok(&s[r.clone()])) {
            continue;
        }
        analysed += 1;
        let mut counts: FxHashMap<&[u8], usize> = FxHashMap::default();
        for s in &in_up {
            *counts.entry(&s[r.clone()]).or_insert(0) += 1;
        }
        let majority: [u8; 3] = {
            let mut v: Vec<(&[u8], usize)> = counts.into_iter().collect();
            v.sort_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(b.0)));
            [v[0].0[0], v[0].0[1], v[0].0[2]]
        };
        let maj_aa = aa_of(&majority);
        let classify = |pos: usize, base: u8| -> bool {
            let mut m = majority;
            m[pos] = base;
            aa_of(&m) == maj_aa
        };
        for pos in 0..3 {
            let mut alleles: Vec<u8> = in_up.iter().map(|s| s[c_idx * 3 + pos]).collect();
            alleles.sort_unstable();
            alleles.dedup();
            if alleles.len() > 1 {
                for &b in alleles.iter().filter(|&&b| b != majority[pos]) {
                    if classify(pos, b) {
                        ps += 1;
                    } else {
                        pn += 1;
                    }
                }
            } else if alleles[0] != out_cod[pos] {
                if classify(pos, out_cod[pos]) {
                    ds += 1;
                } else {
                    dn += 1;
                }
            }
        }
    }

    let nan_if = |num: f64, den: f64| if den > 0.0 { num / den } else { f64::NAN };
    // Neutrality index (Rand & Kann 1996); undefined when Ps or Dn is zero.
    let ni = nan_if(nan_if(pn as f64, ps as f64), nan_if(dn as f64, ds as f64));
    let alpha = 1.0 - ni;
    // Stoletzki & Eyre-Walker (2011) Direction of Selection DoS = Dn/(Dn+Ds) - Pn/(Pn+Ps)
    let dos = nan_if(dn as f64, (dn + ds) as f64) - nan_if(pn as f64, (pn + ps) as f64);

    let total = (pn + ps + dn + ds) as f64;
    let r1 = (pn + dn) as f64;
    let r2 = (ps + ds) as f64;
    let c1 = (pn + ps) as f64;
    let c2 = (dn + ds) as f64;
    let det = ((pn as f64) * (ds as f64) - (ps as f64) * (dn as f64)).abs();
    let yates_num = (det - 0.5 * total).max(0.0);
    let denom = r1 * r2 * c1 * c2;
    let chi_sq = if denom > 0.0 { (total * yates_num * yates_num) / denom } else { f64::NAN };
    // Two-tailed Fisher's exact test on the 2×2 table (the test DnaSP reports for MK).
    let p_val = fisher_exact_two_tailed(pn as u64, ps as u64, dn as u64, ds as u64);

    let regime = if p_val < 0.05 && dos > 0.0 {
        "Excess nonsynonymous divergence (DoS > 0, p < 0.05): consistent with adaptive fixation"
    } else if p_val < 0.05 && dos < 0.0 {
        "Excess nonsynonymous polymorphism (NI > 1, p < 0.05): consistent with slightly deleterious polymorphism"
    } else if total == 0.0 {
        "No polymorphic or fixed differences"
    } else {
        "No significant departure from neutrality (Fisher p ≥ 0.05)"
    };

    let r4 = |v: f64| (v * 10000.0).round() / 10000.0;

    McDonaldKreitmanReport {
        ingroup_count: n_in,
        codons_analyzed: analysed,
        polymorphic_nonsynonymous_pn: pn,
        polymorphic_synonymous_ps: ps,
        fixed_nonsynonymous_dn: dn,
        fixed_synonymous_ds: ds,
        neutrality_index_ni: r4(ni),
        alpha_adaptive_fraction: r4(alpha),
        direction_of_selection_dos: r4(dos),
        chi_sq_yates: r4(chi_sq),
        p_value: p_val,
        evolutionary_regime: regime.into(),
    }
}

/// Two-tailed Fisher exact P for the table [[a, b], [c, d]]: the summed probability of all tables
/// with the same margins that are no more likely than the observed one.
fn fisher_exact_two_tailed(a: u64, b: u64, c: u64, d: u64) -> f64 {
    use statrs::function::factorial::ln_factorial as lf;
    let (r1, r2, c1, n) = (a + b, c + d, a + c, a + b + c + d);
    if n == 0 {
        return 1.0;
    }
    let ln_p = |x: u64| lf(r1) + lf(r2) + lf(c1) + lf(n - c1) - lf(n) - lf(x) - lf(r1 - x) - lf(c1 - x) - lf(r2 + x - c1);
    let lo = c1.saturating_sub(r2);
    let hi = r1.min(c1);
    let obs = ln_p(a);
    (lo..=hi).map(ln_p).filter(|&l| l <= obs + 1e-7).map(f64::exp).sum::<f64>().min(1.0)
}

/// Parses a Newick string into a `petgraph::graph::DiGraph<Option<String>, f64>` where leaves carry
/// `Some(taxon_name)` and edges carry branch lengths.
fn parse_newick_to_petgraph(newick: &str) -> Option<(DiGraph<Option<String>, f64>, NodeIndex)> {
    let trimmed = newick.trim().trim_end_matches(';').trim();
    if trimmed.is_empty() {
        return None;
    }

    let mut graph: DiGraph<Option<String>, f64> = DiGraph::new();
    let bytes = trimmed.as_bytes();
    let mut pos = 0usize;

    fn skip_ws(b: &[u8], p: &mut usize) {
        while *p < b.len() && b[*p].is_ascii_whitespace() {
            *p += 1;
        }
    }

    fn parse_label_and_len(b: &[u8], p: &mut usize) -> (Option<String>, f64) {
        skip_ws(b, p);
        let start = *p;
        while *p < b.len() && !matches!(b[*p], b',' | b')' | b':' | b';') {
            *p += 1;
        }
        let raw_lbl = std::str::from_utf8(&b[start..*p]).unwrap_or("").trim();
        // Ignore pure numeric bootstrap support labels on internal nodes
        let label = if raw_lbl.is_empty() || raw_lbl.parse::<f64>().is_ok() {
            None
        } else {
            Some(raw_lbl.trim_matches('\'').trim_matches('"').to_string())
        };

        let mut br_len = 0.0f64;
        skip_ws(b, p);
        if *p < b.len() && b[*p] == b':' {
            *p += 1;
            skip_ws(b, p);
            let l_start = *p;
            while *p < b.len() && !matches!(b[*p], b',' | b')' | b';') {
                *p += 1;
            }
            let num_s = std::str::from_utf8(&b[l_start..*p]).unwrap_or("").trim();
            br_len = num_s.parse::<f64>().unwrap_or(0.0);
        }
        (label, br_len)
    }

    fn parse_subtree(
        b: &[u8],
        p: &mut usize,
        g: &mut DiGraph<Option<String>, f64>,
    ) -> (NodeIndex, f64) {
        skip_ws(b, p);
        if *p < b.len() && b[*p] == b'(' {
            *p += 1; // '('
            let mut children = Vec::new();
            loop {
                let child = parse_subtree(b, p, g);
                children.push(child);
                skip_ws(b, p);
                if *p < b.len() && b[*p] == b',' {
                    *p += 1;
                } else {
                    break;
                }
            }
            if *p < b.len() && b[*p] == b')' {
                *p += 1;
            }
            let (_, br_len) = parse_label_and_len(b, p);
            let internal = g.add_node(None);
            for (c_idx, c_len) in children {
                g.add_edge(internal, c_idx, c_len);
            }
            (internal, br_len)
        } else {
            let (lbl, br_len) = parse_label_and_len(b, p);
            let leaf = g.add_node(lbl);
            (leaf, br_len)
        }
    }

    let (root, _) = parse_subtree(bytes, &mut pos, &mut graph);
    Some((graph, root))
}

fn collect_canonical_splits(
    graph: &DiGraph<Option<String>, f64>,
    root: NodeIndex,
    shared_taxa: &[String],
) -> FxHashSet<Vec<bool>> {
    let n_taxa = shared_taxa.len();
    let taxon_to_idx: FxHashMap<&str, usize> = shared_taxa
        .iter()
        .enumerate()
        .map(|(i, s)| (s.as_str(), i))
        .collect();

    fn dfs_mask(
        g: &DiGraph<Option<String>, f64>,
        u: NodeIndex,
        n_taxa: usize,
        lookup: &FxHashMap<&str, usize>,
        splits: &mut FxHashSet<Vec<bool>>,
    ) -> Vec<bool> {
        let mut mask = vec![false; n_taxa];
        let mut has_children = false;
        for child in g.neighbors_directed(u, Direction::Outgoing) {
            has_children = true;
            let c_mask = dfs_mask(g, child, n_taxa, lookup, splits);
            for k in 0..n_taxa {
                if c_mask[k] {
                    mask[k] = true;
                }
            }
        }
        if !has_children {
            if let Some(Some(name)) = g.node_weight(u) {
                if let Some(&idx) = lookup.get(name.as_str()) {
                    mask[idx] = true;
                }
            }
        }

        let ones = mask.iter().filter(|&&b| b).count();
        // Non-trivial unrooted bipartition has 2 <= ones <= n_taxa - 2
        if ones >= 2 && ones + 2 <= n_taxa {
            // Canonicalize unrooted split so taxon 0 is always `false`
            let canonical = if mask[0] {
                mask.iter().map(|&b| !b).collect()
            } else {
                mask.clone()
            };
            splits.insert(canonical);
        }
        mask
    }

    let mut splits = FxHashSet::default();
    if n_taxa >= 4 {
        dfs_mask(graph, root, n_taxa, &taxon_to_idx, &mut splits);
    }
    splits
}

/// Compares two Newick phylogenetic trees using `petgraph::graph::DiGraph` bipartition extraction
/// to compute the exact unrooted Robinson-Foulds ($RF$) symmetric clade distance and normalized $nRF$.
pub fn compare_tree_topologies_robinson_foulds(
    newick_a: &str,
    newick_b: &str,
) -> RobinsonFouldsReport {
    let parsed_a = parse_newick_to_petgraph(newick_a);
    let parsed_b = parse_newick_to_petgraph(newick_b);

    let (Some((ga, ra)), Some((gb, rb))) = (parsed_a, parsed_b) else {
        return RobinsonFouldsReport {
            shared_taxa_count: 0,
            tree_a_nontrivial_splits: 0,
            tree_b_nontrivial_splits: 0,
            shared_splits: 0,
            unique_to_tree_a: 0,
            unique_to_tree_b: 0,
            robinson_foulds_distance: 0,
            max_possible_rf: 0,
            normalized_rf: 0.0,
            clade_concordance_pct: 100.0,
        };
    };

    let taxa_a: FxHashSet<String> = ga
        .node_weights()
        .filter_map(|w| w.clone())
        .collect();
    let taxa_b: FxHashSet<String> = gb
        .node_weights()
        .filter_map(|w| w.clone())
        .collect();

    let mut shared_taxa: Vec<String> = taxa_a.intersection(&taxa_b).cloned().collect();
    shared_taxa.sort();
    let n = shared_taxa.len();

    let splits_a = collect_canonical_splits(&ga, ra, &shared_taxa);
    let splits_b = collect_canonical_splits(&gb, rb, &shared_taxa);

    let shared_cnt = splits_a.intersection(&splits_b).count();
    let uniq_a = splits_a.len().saturating_sub(shared_cnt);
    let uniq_b = splits_b.len().saturating_sub(shared_cnt);
    let rf = uniq_a + uniq_b;
    let max_rf = splits_a.len() + splits_b.len();
    let nrf = if max_rf > 0 {
        (rf as f64) / (max_rf as f64)
    } else if n >= 3 {
        0.0
    } else {
        0.0
    };
    let concordance = ((1.0 - nrf).clamp(0.0, 1.0) * 1000.0).round() / 10.0;

    RobinsonFouldsReport {
        shared_taxa_count: n,
        tree_a_nontrivial_splits: splits_a.len(),
        tree_b_nontrivial_splits: splits_b.len(),
        shared_splits: shared_cnt,
        unique_to_tree_a: uniq_a,
        unique_to_tree_b: uniq_b,
        robinson_foulds_distance: rf,
        max_possible_rf: max_rf,
        normalized_rf: (nrf * 10000.0).round() / 10000.0,
        clade_concordance_pct: concordance,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fisher_exact_matches_scipy_on_the_mcdonald_kreitman_adh_table() {
        // McDonald & Kreitman (1991) Drosophila Adh: Pn 2, Ps 42, Dn 7, Ds 17.
        // scipy.stats.fisher_exact([[2, 42], [7, 17]]) -> p = 0.0073272
        assert!((fisher_exact_two_tailed(2, 42, 7, 17) - 0.007_327_153_7).abs() < 1e-8);
        assert!((fisher_exact_two_tailed(3, 1, 1, 3) - 0.485_714_285_7).abs() < 1e-8);
    }

    #[test]
    fn diversity_statistics_use_only_complete_sites() {
        // Two gap columns must not dilute π or θ_W.
        let seqs: Vec<String> = ["AAAA--", "AAAT--", "AATA--", "AATT--"].iter().map(|s| s.to_string()).collect();
        let r = analyze_recombination_and_ld(&seqs);
        assert_eq!(r.segregating_sites_s, 2);
        // k̂ = 8/6 differences over 4 complete sites
        assert!((r.nucleotide_diversity_pi - (8.0f64 / 6.0 / 4.0 * 1e4).round() / 1e4).abs() < 1e-9);
        let a1: f64 = 1.0 + 0.5 + 1.0 / 3.0;
        assert!((r.watterson_theta_per_site - (2.0 / a1 / 4.0 * 1e4).round() / 1e4).abs() < 1e-9);
    }
}
