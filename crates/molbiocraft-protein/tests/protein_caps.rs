// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S13D: the epitope list and the structure contact list cover the whole chain.
//!
//! Each list is checked against a direct computation of the same rule written here, on inputs
//! generated from a fixed seed (no fixture files):
//! - Kolaskar-Tongaonkar antigenic regions of a 4,000 aa protein: every maximal run of at least six
//!   residues whose 7-residue window average is at least 1.06, the last one too when it runs to the
//!   C terminus. The list used to stop after 16 regions (the last ending near residue 750) and to
//!   drop a region that ran to the end of the chain.
//! - Non-local Cα contacts (at most 8.0 Å apart and at least 4 apart in atom order) of a compact
//!   300-residue chain and of a 1,000-residue, two-chain structure. The list used to come from the
//!   first 600 atoms only and stop at 160 contacts, all near the N terminus.
//! - The bases a DNA input's analysis translated: the longest forward ORF of at least 30 aa, or,
//!   with none, the forward frame with the fewest stop codons. The report did not say which, so the
//!   protein tab could only name the slice it passed in.

use molbiocraft_protein::biophysics_3d::{TranslatedSpan, TranslationRule};
use molbiocraft_protein::{align_pdb_structures_kabsch, analyze_protein_sequence};

/// xorshift64*: the same numbers on every run and platform.
struct Rng(u64);

impl Rng {
    fn next(&mut self) -> u64 {
        self.0 ^= self.0 >> 12;
        self.0 ^= self.0 << 25;
        self.0 ^= self.0 >> 27;
        self.0.wrapping_mul(0x2545_F491_4F6C_DD1D)
    }
    /// Uniform in [-1, 1).
    fn signed_unit(&mut self) -> f64 {
        (self.next() >> 11) as f64 / (1u64 << 53) as f64 * 2.0 - 1.0
    }
}

const STANDARD_AA: &[u8; 20] = b"ACDEFGHIKLMNPQRSTVWY";

fn random_protein(len: usize, seed: u64) -> String {
    let mut rng = Rng(seed);
    (0..len).map(|_| STANDARD_AA[(rng.next() % 20) as usize] as char).collect()
}

/// The antigenicity scale `analyze_protein_sequence` reads, residue by residue.
fn antigenicity(aa: u8) -> f64 {
    match aa {
        b'V' => 1.38,
        b'C' => 1.41,
        b'L' => 1.25,
        b'I' => 1.15,
        b'Y' => 1.16,
        b'H' => 1.10,
        b'F' => 1.07,
        b'P' => 1.06,
        b'K' => 1.05,
        b'A' => 1.06,
        b'Q' => 1.03,
        b'S' => 1.02,
        b'T' => 0.96,
        b'E' => 0.93,
        b'R' => 0.90,
        b'W' => 0.89,
        b'D' => 0.87,
        b'M' => 0.83,
        b'N' => 0.78,
        b'G' => 0.74,
        _ => 1.0,
    }
}

/// Every antigenic region of `seq` by the rule written out directly: 1-based (start, end), the
/// peptide, and the best window average to 2 decimals.
fn direct_regions(seq: &str) -> Vec<(usize, usize, String, f64)> {
    let b = seq.as_bytes();
    let n = b.len();
    let window_avg = |i: usize| {
        let (s, e) = (i.saturating_sub(3), (i + 3).min(n - 1));
        b[s..=e].iter().map(|&c| antigenicity(c)).sum::<f64>() / ((e - s + 1) as f64)
    };
    let mut out = Vec::new();
    let mut i = 0;
    while i < n {
        if window_avg(i) < 1.06 {
            i += 1;
            continue;
        }
        let start = i;
        let mut best = window_avg(i);
        while i < n && window_avg(i) >= 1.06 {
            best = best.max(window_avg(i));
            i += 1;
        }
        // residues start..i (0-based, end exclusive)
        if i - start >= 6 {
            out.push((start + 1, i, seq[start..i].to_string(), (best * 100.0).round() / 100.0));
        }
    }
    out
}

fn reported_regions(seq: &str) -> Vec<(usize, usize, String, f64)> {
    analyze_protein_sequence(seq, false, 9)
        .antigenic_determinants
        .into_iter()
        .map(|r| (r.start_aa, r.end_aa, r.peptide, r.max_score))
        .collect()
}

#[test]
fn epitopes_cover_the_whole_chain_or_report_the_total() {
    let len = 4_000;
    let seq = random_protein(len, 0x0B61_3D01);
    let expected = direct_regions(&seq);
    // The fixture crosses the old cap: far more than 16 regions, the last near the C terminus.
    assert!(expected.len() > 16 * 3, "fixture has only {} regions", expected.len());
    let last_end = expected.last().unwrap().1;
    assert!(last_end > len * 9 / 10, "fixture's last region ends at {last_end}");
    let got = reported_regions(&seq);
    assert_eq!(got.len(), expected.len(), "region count: reported {}, direct {}", got.len(), expected.len());
    assert_eq!(got, expected);

    // A region that runs to the last residue is reported, ending there.
    let antigenic_tail = "VCLVCLVCLVCL";
    let tailed = format!("{}{antigenic_tail}", &seq[..len - antigenic_tail.len()]);
    let expected = direct_regions(&tailed);
    assert_eq!(expected.last().unwrap().1, len, "fixture's tail is not a region to the end");
    assert_eq!(reported_regions(&tailed), expected);
    // and so does a protein that is one region from end to end
    let all = antigenic_tail.repeat(3);
    assert_eq!(reported_regions(&all), vec![(1, all.len(), all.clone(), (direct_regions(&all)[0].3))]);
}

/// A compact chain of `n` Cα positions: a serpentine walk through a cubic lattice of 3.8 Å
/// spacing, `side` points along each edge, each point moved by up to 0.3 Å per axis. Points on
/// neighbouring rows and layers of the walk are 3.8 to 7.6 Å apart, so residues all along the chain
/// are in contact with residues of the rows and layers beside theirs.
fn lattice_chain(n: usize, side: usize, origin: [f64; 3], seed: u64) -> Vec<[f64; 3]> {
    assert!(n <= side * side * side);
    let mut rng = Rng(seed);
    let mut out = Vec::with_capacity(n);
    'walk: for z in 0..side {
        for yy in 0..side {
            let y = if z.is_multiple_of(2) { yy } else { side - 1 - yy };
            for xx in 0..side {
                let x = if (z * side + yy).is_multiple_of(2) { xx } else { side - 1 - xx };
                if out.len() == n {
                    break 'walk;
                }
                let at = |k: usize, o: f64, rng: &mut Rng| o + 3.8 * k as f64 + 0.3 * rng.signed_unit();
                out.push([at(x, origin[0], &mut rng), at(y, origin[1], &mut rng), at(z, origin[2], &mut rng)]);
            }
        }
    }
    out
}

/// PDB `ATOM` records of Cα atoms, one chain per entry of `chains`.
fn ca_pdb(chains: &[(char, &[[f64; 3]])]) -> String {
    let mut out = String::new();
    let mut serial = 1;
    for (chain, coords) in chains {
        for (k, p) in coords.iter().enumerate() {
            out.push_str(&format!(
                "ATOM  {serial:>5}  CA  ALA {chain}{:>4}    {:>8.3}{:>8.3}{:>8.3}  1.00 50.00           C\n",
                k + 1,
                p[0],
                p[1],
                p[2]
            ));
            serial += 1;
        }
    }
    out.push_str("END\n");
    out
}

/// A contact as (first atom, second atom, distance in Å to 2 decimals).
type Contact = (usize, usize, f64);

/// The contacts of structure A as reported, and every pair of its Cα atoms (as the report read
/// them) at most 8.0 Å apart and at least 4 apart in order, with the distance to 2 decimals.
fn reported_and_direct_contacts(pdb: &str) -> (Vec<Contact>, Vec<Contact>) {
    let report = align_pdb_structures_kabsch(pdb, pdb);
    let atoms = &report.atoms_a;
    let mut direct = Vec::new();
    for i in 0..atoms.len() {
        for j in (i + 4)..atoms.len() {
            let (dx, dy, dz) = (atoms[i].x - atoms[j].x, atoms[i].y - atoms[j].y, atoms[i].z - atoms[j].z);
            let d2 = dx * dx + dy * dy + dz * dz;
            if d2 <= 64.0 {
                direct.push((i, j, (d2.sqrt() * 100.0).round() / 100.0));
            }
        }
    }
    let got = report.intra_chain_contacts.iter().map(|c| (c.res_i, c.res_j, c.distance_angstrom)).collect();
    (got, direct)
}

#[test]
fn contacts_span_the_whole_structure() {
    // A 300-residue chain, placed at negative coordinates so cells on both sides of zero are read.
    let chain = lattice_chain(300, 7, [-11.4, -3.0, -19.0], 0x0B61_3D02);
    let (got, direct) = reported_and_direct_contacts(&ca_pdb(&[('A', &chain)]));
    assert_eq!(direct.iter().map(|c| c.0.max(c.1)).max(), Some(299), "fixture has no contact at the C terminus");
    assert!(direct.len() > 160 * 5, "fixture has only {} contacts", direct.len());
    let c_terminal = |list: &[Contact]| list.iter().filter(|c| c.0 >= 150).count();
    assert!(c_terminal(&direct) > 100, "fixture's C-terminal half has {} contacts", c_terminal(&direct));
    assert_eq!(got.len(), direct.len(), "contact count: reported {}, direct {}", got.len(), direct.len());
    assert_eq!(got, direct);

    // Past 600 atoms: two 500-residue chains side by side, so contacts join atoms of either chain,
    // and the last atoms of the second chain have theirs.
    let a = lattice_chain(500, 8, [0.0, 0.0, 0.0], 0x0B61_3D03);
    let b = lattice_chain(500, 8, [0.0, 0.0, 8.0 * 3.8 + 1.9], 0x0B61_3D04);
    let (got, direct) = reported_and_direct_contacts(&ca_pdb(&[('A', &a), ('B', &b)]));
    assert!(direct.iter().any(|c| c.0 < 500 && c.1 >= 500), "fixture's chains are not in contact");
    assert_eq!(direct.iter().map(|c| c.1).max(), Some(999), "fixture has no contact at its last atom");
    assert_eq!(got.len(), direct.len(), "contact count: reported {}, direct {}", got.len(), direct.len());
    assert_eq!(got, direct);
}

/// The standard genetic code (NCBI table 1), codons in TCAG order.
const STANDARD_CODE: &[u8; 64] = b"FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";

fn codon_aa(codon: &[u8]) -> u8 {
    let k = |b: u8| b"TCAG".iter().position(|&x| x == b).expect("an ACGT codon");
    STANDARD_CODE[k(codon[0]) * 16 + k(codon[1]) * 4 + k(codon[2])]
}

fn random_dna(len: usize, seed: u64, alphabet: &[u8]) -> String {
    let mut rng = Rng(seed);
    (0..len).map(|_| alphabet[(rng.next() % alphabet.len() as u64) as usize] as char).collect()
}

fn reverse_complement(dna: &str) -> String {
    dna.bytes()
        .rev()
        .map(|b| match b {
            b'A' => 'T',
            b'C' => 'G',
            b'G' => 'C',
            _ => 'A',
        })
        .collect()
}

/// Every forward ORF by the rule written out: in each frame, from an ATG to the first in-frame
/// stop (the stop included), the next ATG looked for after that stop, kept at 30 aa or more; as
/// 1-based (first base, last base).
fn forward_orfs(dna: &str) -> Vec<(usize, usize)> {
    let b = dna.as_bytes();
    let mut out = Vec::new();
    for frame in 0..3 {
        let mut i = frame;
        while i + 3 <= b.len() {
            if &b[i..i + 3] != b"ATG" {
                i += 3;
                continue;
            }
            let mut j = i + 3;
            while j + 3 <= b.len() && codon_aa(&b[j..j + 3]) != b'*' {
                j += 3;
            }
            if j + 3 > b.len() {
                // no stop before the end: not an ORF, so look for the next ATG
                i += 3;
                continue;
            }
            if (j - i) / 3 >= 30 {
                out.push((i + 1, j + 3));
            }
            i = j + 3;
        }
    }
    out
}

/// The longest forward ORF, the first-starting of two as long.
fn longest_forward_orf(dna: &str) -> Option<(usize, usize)> {
    forward_orfs(dna).into_iter().min_by_key(|&(s, e)| (std::cmp::Reverse(e - s), s))
}

/// The forward frame with the fewest stop codons, the lowest of two with as few: its 1-based first
/// and last translated base, and its stop count.
fn fewest_stop_frame(dna: &str) -> (usize, usize, usize) {
    let b = dna.as_bytes();
    (0..3)
        .map(|f| {
            let codons = (b.len() - f) / 3;
            let stops = (0..codons).filter(|k| codon_aa(&b[f + 3 * k..f + 3 * k + 3]) == b'*').count();
            (f + 1, f + 3 * codons, stops)
        })
        .min_by_key(|&(f, _, stops)| (stops, f))
        .unwrap()
}

fn translate(dna: &str) -> String {
    dna.as_bytes().chunks_exact(3).map(|c| codon_aa(c) as char).collect()
}

#[test]
fn translated_span_names_the_bases_analysed() {
    let orf_span = |start, end| TranslatedSpan { rule: TranslationRule::LongestForwardOrf, start, end, stops_removed: 0 };
    let mut first_is_not_longest = false;
    for seed in [0x0B61_3D05u64, 0x0B61_3D06, 0x0B61_3D07, 0x0B61_3D08] {
        let dna = random_dna(1_200, seed, b"ACGT");
        let (start, end) = longest_forward_orf(&dna).expect("fixture has an ORF of 30 aa");
        let report = analyze_protein_sequence(&dna, true, 9);
        assert_eq!(report.translated_span, Some(orf_span(start, end)), "seed {seed:#x}");
        // the analysis counts that ORF's residues, its stop left out
        let protein = translate(&dna[start - 1..end - 3]);
        assert_eq!(report.length_aa, protein.len());
        assert_eq!(report.amino_acid_counts, analyze_protein_sequence(&protein, false, 9).amino_acid_counts);
        // the fixture reaches the plausible wrong answers: an ORF after base 1, and not the first
        assert!(start > 1);
        first_is_not_longest |= forward_orfs(&dna).iter().map(|o| o.0).min() != Some(start);
    }
    assert!(first_is_not_longest, "every fixture's first ORF is its longest");

    // A longer ORF on the reverse strand is not the one analysed.
    let codons = ["GCT", "GAA", "CTG", "AAA", "GTT", "TCC", "CGT", "GGC"];
    let gene = |n: usize, seed: u64| {
        let mut rng = Rng(seed);
        format!("ATG{}TAA", (0..n).map(|_| codons[(rng.next() % 8) as usize]).collect::<String>())
    };
    let dna = format!(
        "{}{}{}{}",
        random_dna(150, 0x0B61_3D09, b"ACGT"),
        gene(40, 1),
        random_dna(60, 0x0B61_3D0A, b"ACGT"),
        reverse_complement(&gene(250, 2))
    );
    let forward = longest_forward_orf(&dna).unwrap();
    let reverse = longest_forward_orf(&reverse_complement(&dna)).unwrap();
    assert!(reverse.1 - reverse.0 > forward.1 - forward.0, "fixture's reverse ORF is not the longer");
    assert_eq!(analyze_protein_sequence(&dna, true, 9).translated_span, Some(orf_span(forward.0, forward.1)));

    // No ATG at all: the frame with the fewest stops, translated through its last codon.
    let mut chose_a_later_frame = false;
    for seed in [0x0B61_3D0Bu64, 0x0B61_3D0C, 0x0B61_3D0D, 0x0B61_3D0E] {
        let dna = random_dna(1_200, seed, b"ACGT").replace("ATG", "ACG");
        assert!(forward_orfs(&dna).is_empty());
        let (frame, end, stops) = fewest_stop_frame(&dna);
        let report = analyze_protein_sequence(&dna, true, 9);
        let span = TranslatedSpan { rule: TranslationRule::FewestStopFrame, start: frame, end, stops_removed: stops };
        assert_eq!(report.translated_span, Some(span), "seed {seed:#x}");
        assert_eq!(report.length_aa, translate(&dna[frame - 1..end]).replace('*', "").len());
        chose_a_later_frame |= frame > 1;
    }
    assert!(chose_a_later_frame, "every fixture's fewest-stop frame is frame 1");
    // with no stop in any frame, the first frame: bases 1..1,200, not 3..1,200
    let no_stop = random_dna(1_201, 0x0B61_3D0F, b"CGT");
    let span = TranslatedSpan { rule: TranslationRule::FewestStopFrame, start: 1, end: 1_200, stops_removed: 0 };
    assert_eq!(analyze_protein_sequence(&no_stop, true, 9).translated_span, Some(span));

    // Fewer than three bases hold no codon, a lone stop leaves an empty frame the fewest-stop one,
    // and a protein input translates nothing.
    assert_eq!(analyze_protein_sequence("AC", true, 9).translated_span, None);
    let lone_stop = analyze_protein_sequence("TAA", true, 9);
    assert_eq!((lone_stop.translated_span, lone_stop.length_aa), (None, 0));
    assert_eq!(analyze_protein_sequence(&random_protein(300, 7), false, 9).translated_span, None);
}
