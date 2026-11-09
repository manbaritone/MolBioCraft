// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Bootstrap support must not be reported for an arbitrary resolution of identical sequences:
//! a clade inside a group of identical sequences has a zero-length branch and no site backs it.

use molbiocraft_phylo::construct_phylogenetic_tree;

fn mutate(base: &str, pos: &[usize]) -> String {
    base.bytes()
        .enumerate()
        .map(|(i, b)| if pos.contains(&i) { if b == b'A' { 'G' } else { 'A' } } else { b as char })
        .collect()
}

fn names(v: &[&str]) -> Vec<String> {
    v.iter().map(|s| s.to_string()).collect()
}

#[test]
fn identical_sequences_get_no_support_for_their_arbitrary_resolution() {
    let base = "ACGTACGTTGCAAGCTTGACCATGGATCCGAATTCGGTACCAGTCTAGAGCTCGCATGCAAGCTT";
    let ident = mutate(base, &[1, 5, 9, 13, 17, 21]);
    let names = names(&["A", "B", "C", "D", "E", "F"]);
    let seqs = vec![
        ident.clone(),
        ident.clone(),
        ident.clone(),
        mutate(base, &[40, 44, 48]),
        mutate(base, &[40, 44, 52]),
        mutate(base, &[40, 56, 60]),
    ];
    for algo in ["Neighbor-Joining (NJ)", "UPGMA"] {
        let rep = construct_phylogenetic_tree(&names, &seqs, algo, "Jukes-Cantor (JC69)", 200);
        assert_eq!(rep.bootstrap_replicates, 200, "{algo}");
        // Any clade that holds exactly two of the three identical sequences is an arbitrary tie-break.
        let identical = ["A", "B", "C"];
        for row in &rep.clade_bootstraps {
            let members: Vec<&str> = row.clade_label.split(", ").collect();
            let side_in = members.iter().filter(|m| identical.contains(m)).count();
            let pair_of_identicals = members.len() == 2 && side_in == 2;
            let complement_of_pair = members.len() == 4 && side_in == 1;
            if pair_of_identicals || complement_of_pair {
                assert_eq!(row.support_pct, 0, "{algo}: arbitrary clade reported {:?}", rep.clade_bootstraps);
                assert!(row.branch_length.abs() < 1e-9, "{algo}: {:?}", rep.clade_bootstraps);
            }
        }
        // The real clade of all three identical sequences stays fully supported.
        let abc = rep
            .clade_bootstraps
            .iter()
            .find(|c| c.clade_label == "A, B, C" || c.clade_label == "D, E, F")
            .unwrap_or_else(|| panic!("{algo}: {:?}", rep.clade_bootstraps));
        assert!(abc.support_pct >= 90, "{algo}: {:?}", rep.clade_bootstraps);
        assert!(rep.method_note.contains("zero-length"), "{algo}: {}", rep.method_note);
    }
}
