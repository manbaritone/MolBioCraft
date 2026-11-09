// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1GB: ancestral reconstruction, the codon scan, the time tree, the site-rate profile and
//! the LD statistics return their total beside each list. The first four list every row the total
//! counts; the LD statistics keep their bound and say in `warnings` what it left out.
//!
//! The inputs cross each bound the engine used to apply without saying so (60 internal nodes,
//! 2,000 sites, 500 variable codons, 10,000 sites, 2,000 biallelic sites). They are generated from
//! fixed seeds; tiling a short block of columns keeps the likelihood fits fast in a debug build
//! (few site patterns) and gives the rows past each old bound a known answer: a column repeated
//! from the block must reproduce the row of the column it repeats. Every total is checked against
//! a count made here, never against the engine's own constants: the internal nodes of a fully
//! resolved rooted tree on n tips (n - 1, and the clades listed must form exactly that tree), the
//! columns, the variable codons and the biallelic sites of the input. The parsimony states of
//! every node are recomputed here by Fitch (1971) on the tree the clades describe.

use molbiocraft_core::SplitMix64;
use molbiocraft_phylo::{
    analyze_recombination_and_ld, estimate_gamma_and_site_rates, infer_ancestral_sequences,
    run_molecular_clock_and_timetree, run_selection_and_neutrality_tests, translate_standard_codon,
};
use std::collections::BTreeSet;

const BASES: &[u8; 4] = b"ACGT";

/// `n` sequences of `block` columns evolved down a random binary splitting process (each split
/// copies the parent and changes each base with probability `p`, except in the first `shared`
/// columns, which every sequence keeps), then the block repeated to `total` columns.
fn tiled_alignment(seed: u64, n: usize, block: usize, shared: usize, total: usize, p: f64) -> Vec<String> {
    let mut rng = SplitMix64::new(seed);
    let mut pool: Vec<Vec<u8>> = vec![(0..block).map(|_| BASES[rng.next_usize(4)]).collect()];
    while pool.len() < n {
        let parent = pool.swap_remove(rng.next_usize(pool.len()));
        for _ in 0..2 {
            let child: Vec<u8> =
                parent.iter().enumerate().map(|(c, &b)| if c >= shared && rng.next_f64() < p { BASES[rng.next_usize(4)] } else { b }).collect();
            pool.push(child);
        }
    }
    pool.into_iter()
        .map(|row| (0..total).map(|c| row[c % block] as char).collect())
        .collect()
}

fn names(n: usize) -> Vec<String> {
    (0..n).map(|i| format!("t{i:02}")).collect()
}

/// The clades a list of "a, b, c" descendant strings describes, after checking that they are
/// exactly the internal nodes of one fully resolved rooted tree on `taxa`: distinct, pairwise
/// nested or disjoint, the root clade holds every taxon, and there are `taxa.len() - 1` of them
/// (the most a nested family of non-singleton clades on n taxa can hold, reached only by a
/// binary tree).
fn clades_of_binary_tree(labels: &[String], taxa: &[String]) -> Vec<BTreeSet<usize>> {
    let index = |t: &str| taxa.iter().position(|x| x == t).unwrap_or_else(|| panic!("unknown taxon {t}"));
    let clades: Vec<BTreeSet<usize>> = labels.iter().map(|l| l.split(", ").map(index).collect()).collect();
    assert_eq!(clades.len(), taxa.len() - 1, "one row per internal node of a binary tree on {} tips", taxa.len());
    assert_eq!(clades[0].len(), taxa.len(), "the first row is the root, over every taxon");
    for (i, a) in clades.iter().enumerate() {
        assert!(a.len() >= 2, "row {i} is an internal node");
        for b in &clades[i + 1..] {
            assert_ne!(a, b, "each internal node is listed once");
            assert!(a.is_disjoint(b) || a.is_subset(b) || b.is_subset(a), "clades nest");
        }
    }
    clades
}

/// Fitch (1971) parsimony states, recomputed on the tree the clades describe: down-pass sets
/// (intersection, else union), then each node keeps its parent's final state when the parent's
/// is a single base its own set allows. A node whose final set holds several bases takes the
/// last of them in A, C, G, T order, as the engine's state probabilities (uniform over the set)
/// pick it. Returns, per clade, the state string and the share of sites with a single state.
fn fitch_states(clades: &[BTreeSet<usize>], seqs: &[String]) -> Vec<(String, f64)> {
    let mask = |b: u8| 1u8 << BASES.iter().position(|&x| x == b).expect("ACGT only");
    // The parent of a clade is its smallest strict superset; a tip's parent is the smallest clade
    // that holds it.
    let parent_of = |set: &BTreeSet<usize>| {
        (0..clades.len()).filter(|&j| clades[j].len() > set.len() && set.is_subset(&clades[j])).min_by_key(|&j| clades[j].len())
    };
    let parents: Vec<Option<usize>> = clades.iter().map(parent_of).collect();
    let tip_parent: Vec<usize> = (0..seqs.len()).map(|t| parent_of(&BTreeSet::from([t])).expect("a tip under the root")).collect();
    let mut by_size: Vec<usize> = (0..clades.len()).collect();
    by_size.sort_by_key(|&i| clades[i].len());
    let len = seqs[0].len();
    let mut out = vec![(String::with_capacity(len), 0.0); clades.len()];
    let mut unique = vec![0usize; clades.len()];
    for site in 0..len {
        let mut down = vec![0u8; clades.len()];
        let mut children: Vec<Vec<u8>> = vec![Vec::new(); clades.len()];
        for (t, s) in seqs.iter().enumerate() {
            children[tip_parent[t]].push(mask(s.as_bytes()[site]));
        }
        for &i in &by_size {
            let sets = &children[i];
            assert_eq!(sets.len(), 2, "binary tree");
            let inter = sets[0] & sets[1];
            down[i] = if inter != 0 { inter } else { sets[0] | sets[1] };
            if let Some(p) = parents[i] {
                children[p].push(down[i]);
            }
        }
        let mut fin = down.clone();
        for &i in by_size.iter().rev() {
            if let Some(p) = parents[i] {
                if fin[p].count_ones() == 1 && down[i] & fin[p] != 0 {
                    fin[i] = fin[p];
                }
            }
        }
        for i in 0..clades.len() {
            out[i].0.push(BASES[7 - fin[i].leading_zeros() as usize] as char);
            unique[i] += usize::from(fin[i].count_ones() == 1);
        }
    }
    for i in 0..clades.len() {
        out[i].1 = (100.0 * unique[i] as f64 / len as f64 * 10.0).round() / 10.0;
    }
    out
}

/// Shannon entropy (bits) of an alignment column, rounded to 0.001.
fn column_entropy(seqs: &[String], c: usize) -> f64 {
    let mut counts = [0usize; 4];
    for s in seqs {
        counts[BASES.iter().position(|&x| x == s.as_bytes()[c]).unwrap()] += 1;
    }
    let n = seqs.len() as f64;
    let h: f64 = counts.iter().filter(|&&k| k > 0).map(|&k| -(k as f64 / n) * (k as f64 / n).log2()).sum();
    (h * 1000.0).round() / 1000.0
}

#[test]
fn capped_phylo_results_report_their_totals() {
    // --- Ancestral reconstruction: 64 tips (63 internal nodes, past the old 60), 2,120 columns
    // (past the old 2,000) tiled from a 40-column block.
    let (n, block, cols) = (64, 40, 2_120);
    let seqs = tiled_alignment(0x5EED_0A11, n, block, 4, cols, 0.06);
    let taxa = names(n);
    for method in ["Maximum Parsimony (Fitch)", "Maximum Likelihood (Empirical Bayes)"] {
        let rep = infer_ancestral_sequences(&taxa, &seqs, method);
        assert_eq!(rep.total_internal_nodes, n - 1, "{method}: total internal nodes");
        let labels: Vec<String> = rep.nodes.iter().map(|r| r.descendants.clone()).collect();
        let clades = clades_of_binary_tree(&labels, &taxa);
        assert_eq!(rep.total_sites, cols, "{method}: total sites");
        assert_eq!(rep.site_evolutionary_probabilities.len(), cols, "{method}: a root row for every column");
        for (i, row) in rep.site_evolutionary_probabilities.iter().enumerate() {
            assert_eq!(row.position, i + 1);
            if i >= block {
                let twin = &rep.site_evolutionary_probabilities[i - block];
                assert_eq!(
                    (row.ancestral_state_root.as_str(), row.prob_a, row.prob_c, row.prob_g, row.prob_t, row.consensus_state.as_str()),
                    (twin.ancestral_state_root.as_str(), twin.prob_a, twin.prob_c, twin.prob_g, twin.prob_t, twin.consensus_state.as_str()),
                    "{method}: column {} repeats column {}",
                    i + 1,
                    i + 1 - block
                );
            }
        }
        for node in &rep.nodes {
            assert_eq!(node.ancestral_sequence.len(), cols, "{method}: {} covers every column", node.node_name);
            let s = node.ancestral_sequence.as_bytes();
            assert!((block..cols).all(|c| s[c] == s[c - block]), "{method}: {} repeats with the block", node.node_name);
        }
        // A column every tip shares has that base at every ancestor, under either method.
        let constant: Vec<usize> = (0..cols).filter(|&c| seqs.iter().all(|s| s.as_bytes()[c] == seqs[0].as_bytes()[c])).collect();
        assert!(constant.iter().any(|&c| c >= 2_000), "the fixture has a shared column past the old 2,000-site bound");
        for node in &rep.nodes {
            for &c in &constant {
                assert_eq!(node.ancestral_sequence.as_bytes()[c], seqs[0].as_bytes()[c], "{method}: {} column {}", node.node_name, c + 1);
            }
        }
        if method.contains("Parsimony") {
            let fitch = fitch_states(&clades, &seqs);
            for (node, (states, unambiguous)) in rep.nodes.iter().zip(&fitch) {
                assert_eq!(&node.ancestral_sequence, states, "Fitch states of {}", node.node_name);
                assert_eq!(node.mean_posterior_confidence, *unambiguous, "unambiguous share of {}", node.node_name);
            }
        }
    }

    // --- Time tree on the same 64 tips: every internal node, ages nested under the calibration.
    let clock = run_molecular_clock_and_timetree(&taxa, &seqs, "RelTime-ML", 42.5);
    assert_eq!(clock.total_internal_nodes, n - 1, "time tree: total internal nodes");
    assert_eq!(clock.divergence_nodes[0].node_label, "Root (calibration)");
    let mut labels: Vec<String> = clock.divergence_nodes.iter().map(|r| r.node_label.clone()).collect();
    labels[0] = taxa.join(", ");
    let clades = clades_of_binary_tree(&labels, &taxa);
    let age = |i: usize| clock.divergence_nodes[i].divergence_time_mya;
    assert_eq!(age(0), 42.5, "the root is the calibration");
    for i in 1..clades.len() {
        let parent = (0..clades.len()).filter(|&j| clades[j].len() > clades[i].len() && clades[i].is_subset(&clades[j])).min_by_key(|&j| clades[j].len()).unwrap();
        assert!((0.0..=age(parent)).contains(&age(i)), "node {i} is younger than its parent");
    }

    // --- Site-rate profile: 10,050 columns (past the old 10,000) tiled from a 50-column block.
    let (rate_block, rate_cols) = (50, 10_050);
    let rate_seqs = tiled_alignment(0x5EED_0A7E, 5, rate_block, 0, rate_cols, 0.25);
    let rates = estimate_gamma_and_site_rates(&rate_seqs, 4);
    assert_eq!(rates.total_sites, rate_cols, "site rates: total sites");
    assert_eq!(rates.site_rates.len(), rate_cols, "a rate for every column");
    for (i, row) in rates.site_rates.iter().enumerate() {
        assert_eq!(row.position, i + 1);
        assert_eq!(row.entropy_bits, column_entropy(&rate_seqs, i), "entropy of column {}", i + 1);
        if i >= rate_block {
            let twin = &rates.site_rates[i - rate_block];
            assert_eq!((row.relative_rate, row.rate_category), (twin.relative_rate, twin.rate_category), "column {} repeats", i + 1);
        }
    }

    // --- Codon scan: 6 sequences of 1,560 codons, of which about two in three vary (over 1,000
    // variable codons, past the old 500; counted below). Codon k of each group of three: 0 can
    // vary only at a fourfold third position (GCN, Ala: synonymous only), 1 varies only at the
    // first position (ATG Met / CTG Leu / GTG Val: nonsynonymous only), 2 is the same everywhere.
    let (m, codons) = (6, 1_560);
    let mut rng = SplitMix64::new(0x5EED_0C0D);
    let coding: Vec<String> = (0..m)
        .map(|s| {
            (0..codons)
                .map(|k| match k % 3 {
                    0 => format!("GC{}", if s == 0 { 'A' } else { BASES[rng.next_usize(4)] as char }),
                    1 => if s == 0 { "ATG".to_string() } else { ["ATG", "CTG", "GTG"][1 + rng.next_usize(2)].to_string() },
                    _ => "TGG".to_string(),
                })
                .collect()
        })
        .collect();
    let mut variable = Vec::new();
    for k in 0..codons {
        let mut seen: Vec<&str> = Vec::new();
        for s in &coding {
            let c = &s[3 * k..3 * k + 3];
            if !seen.contains(&c) {
                seen.push(c);
            }
        }
        if seen.len() >= 2 {
            variable.push((k + 1, seen.join(" / ")));
        }
    }
    assert!(variable.len() > 1_000, "the fixture crosses the old 500-codon bound twice over");
    let sel = run_selection_and_neutrality_tests(&coding);
    assert_eq!(sel.total_variable_codons, variable.len(), "codon scan: total variable codons");
    let listed: Vec<(usize, String)> = sel.codon_site_selection.iter().map(|r| (r.codon_index, r.codons_observed.clone())).collect();
    assert_eq!(listed, variable, "every variable codon, in order, with the codons seen");
    for row in &sel.codon_site_selection {
        let codon = &coding[0][3 * (row.codon_index - 1)..3 * row.codon_index];
        let aa_changes = coding.iter().any(|s| translate_standard_codon(&s[3 * (row.codon_index - 1)..3 * row.codon_index]) != translate_standard_codon(codon));
        if aa_changes {
            assert!(row.dn_minus_ds > 0.0, "codon {}: only nonsynonymous differences", row.codon_index);
        } else {
            assert!(row.dn_minus_ds < 0.0, "codon {}: only synonymous differences", row.codon_index);
        }
    }

    // --- LD statistics: 10 haplotypes, 3,000 columns of which every fourth is triallelic or holds
    // a gap, so 2,250 are biallelic; the pairwise statistics use the first 2,000 of them.
    let mut rng = SplitMix64::new(0x5EED_01D0);
    let h = 10;
    let mut columns: Vec<Vec<u8>> = Vec::new();
    for c in 0..3_000 {
        let col: Vec<u8> = match c % 4 {
            3 if c % 8 == 3 => (0..h).map(|i| b"ACG"[i % 3]).collect(),
            3 => (0..h).map(|i| if i == 0 { b'-' } else { b"AT"[rng.next_usize(2)] }).collect(),
            _ => {
                let mut col: Vec<u8> = (0..h).map(|_| b"CT"[rng.next_usize(2)]).collect();
                col[0] = b'C';
                col[1] = b'T';
                col
            }
        };
        columns.push(col);
    }
    let haps: Vec<String> = (0..h).map(|i| columns.iter().map(|c| c[i] as char).collect()).collect();
    let biallelic: Vec<usize> = (0..columns.len())
        .filter(|&c| {
            let col = &columns[c];
            col.iter().all(|b| b"ACGT".contains(b)) && col.iter().collect::<BTreeSet<_>>().len() == 2
        })
        .collect();
    assert!(biallelic.len() > 2_000, "the fixture crosses the 2,000-site bound");
    let used = &biallelic[..2_000];
    let ld = analyze_recombination_and_ld(&haps);
    assert_eq!(ld.biallelic_sites_total, biallelic.len(), "LD: total biallelic sites");
    assert_eq!(ld.biallelic_sites_used, used.len(), "LD: sites used");
    assert_eq!(ld.ld_pairs_total, used.len() * (used.len() - 1) / 2, "LD: every pair of the sites used");
    assert_eq!(ld.ld_pairs.len(), 250);
    assert_eq!((ld.ld_pairs[0].site_i_bp, ld.ld_pairs[0].site_j_bp), (used[0] + 1, used[1] + 1));
    // The four-gamete count, recounted here over exactly the sites used.
    let mut four_gamete = 0;
    for (a, &i) in used.iter().enumerate() {
        for &j in &used[a + 1..] {
            let mut gametes = 0u8;
            for k in 0..h {
                gametes |= 1 << (2 * usize::from(columns[i][k] == b'C') + usize::from(columns[j][k] == b'C'));
            }
            four_gamete += usize::from(gametes == 0b1111);
        }
    }
    assert_eq!(ld.four_gamete_incompatible_pairs, four_gamete, "four-gamete pairs over the sites used");
    assert_eq!(
        ld.warnings,
        vec![
            format!(
                "Linkage disequilibrium, the four-gamete test and Rm use the first 2,000 of {} biallelic sites (alignment columns 1 to {} of 3,000).",
                molbiocraft_core::format_thousands(biallelic.len()),
                molbiocraft_core::format_thousands(used[1_999] + 1)
            ),
            "The pair table lists the first 250 of 1,999,000 site pairs.".to_string(),
        ]
    );
    // Under both bounds: nothing is left out and nothing is said.
    let small: Vec<String> = haps.iter().map(|s| s[..24].to_string()).collect();
    let small_biallelic = biallelic.iter().filter(|&&c| c < 24).count();
    assert!(small_biallelic * (small_biallelic - 1) / 2 <= 250);
    let ld_small = analyze_recombination_and_ld(&small);
    assert_eq!((ld_small.biallelic_sites_total, ld_small.biallelic_sites_used), (small_biallelic, small_biallelic));
    assert_eq!(ld_small.ld_pairs.len(), ld_small.ld_pairs_total);
    assert!(ld_small.warnings.is_empty(), "no warning when nothing is left out: {:?}", ld_small.warnings);
}
