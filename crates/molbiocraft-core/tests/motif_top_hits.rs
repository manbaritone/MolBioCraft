// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6S1C1: the JASPAR TF motif scan lists the best-scoring hits across every matrix (not the
//! first 250 in matrix-by-matrix scan order), scans a sequence past 250 kb whole, and reports every
//! minus-strand hit at its own coordinates.
//!
//! The expected hits come from a brute-force scan written here: the same matrices, built with
//! `rust-bio` from the curated sites (checked against the engine's profiles), every window of both
//! strands scored column by column with no pruning, every hit kept, ranked and cut to 250. Each
//! listed hit's coordinates are also checked against the sequence itself: a `+` hit's bases are
//! the forward bases at its coordinates, a `-` hit's are their reverse complement.

use bio::pattern_matching::pssm::{DNAMotif, Motif};
use molbiocraft_core::{scan_jaspar_pssm_motifs, PssmMotifScanReport};

/// The curated catalogue's aligned sites, in catalogue order (the engine's `CURATED_JASPAR_SEEDS`
/// without the skipped PROK_LAC entry, then lacO and the T7 promoter).
const CATALOGUE: &[(&str, &[&str])] = &[
    ("MA0108.2", &["TATAAAAG", "TATAAATG", "TATATAAA", "TATATAAG", "TATAAAAC"]),
    ("MA0079.5", &["GGGGCGGGG", "GGGGCGGAG", "TGGGCGGGG", "GGGGCGGGC", "AGGGCGGGG"]),
    ("MA0139.1", &["CCACCAGGGGGCGC", "CCACCAGGGGGCGG", "CCACTAGGGGGCGC", "CCAGCAGGGGGCGC"]),
    ("MA0018.4", &["TGACGTCA", "TGACGTMA", "TGACGTCA", "TGACGTAA"]),
    ("MA0099.3", &["TGAGTCA", "TGACTCA", "TGAGTCA", "TGACTCA"]),
    ("MA0105.4", &["GGGAATTTCC", "GGGACTTTCC", "GGGAATTTCC", "GGGAAATTCC"]),
    ("MA0106.3", &["RRRCATGYYY", "GAACATGTCC", "AGACATGCCT", "GGGCATGTCC"]),
    ("MA0148.4", &["TGTTTACTTA", "TGTTTACATA", "TGTTTACTAA", "TGTTTACTTA"]),
    ("PROK_LACO", &["AATTGTGAGCGATAACAATT", "AATTGTGAGCGCTCACAATT", "AAATGTGAGCGAGTAACAAC"]),
    ("PHAGE_T7P", &["TAATACGACTCACTATAGGG", "TAATACGACTCACTATAGGA", "TAATACGACTCACTATAGGC"]),
];

/// A matrix as the brute-force scan scores it.
struct Matrix {
    id: &'static str,
    /// Per column, the probability of A, T, G, C (rust-bio's column order), floored at 1e-4.
    probs: Vec<[f64; 4]>,
    min: f64,
    denom: f64,
    consensus: String,
}

fn matrices(report: &PssmMotifScanReport) -> Vec<Matrix> {
    let built: Vec<Matrix> = CATALOGUE
        .iter()
        .filter_map(|(id, sites)| {
            let seqs: Vec<Vec<u8>> = sites.iter().map(|s| s.as_bytes().to_vec()).collect();
            let motif = DNAMotif::from_seqs(&seqs, None).ok()?;
            let scores = motif.get_scores();
            let probs: Vec<[f64; 4]> = (0..motif.len())
                .map(|i| [0, 1, 2, 3].map(|b| f64::from(scores[[i, b]]).max(1e-4)))
                .collect();
            let (min, max) = (f64::from(motif.get_min_score()), f64::from(motif.get_max_score()));
            let consensus = probs
                .iter()
                .map(|row| {
                    let best = (0..4).fold(0, |b, j| if row[j] > row[b] { j } else { b });
                    b"ATGC"[best] as char
                })
                .collect();
            Some(Matrix { id, probs, min, denom: (max - min).max(1e-6), consensus })
        })
        .collect();
    // The copy is the engine's catalogue: the same matrices, in the same order, the same lengths
    // and the same degenerate consensus.
    let engine: Vec<(&str, usize)> = report.profiles.iter().map(|p| (p.matrix_id.as_str(), p.length_bp)).collect();
    let mine: Vec<(&str, usize)> = built.iter().map(|m| (m.id, m.probs.len())).collect();
    assert_eq!(engine, mine, "the test's matrices are the engine's catalogue");
    for (profile, (id, sites)) in report.profiles.iter().zip(CATALOGUE.iter().filter(|(id, _)| built.iter().any(|m| m.id == *id))) {
        let seqs: Vec<Vec<u8>> = sites.iter().map(|s| s.as_bytes().to_vec()).collect();
        let motif = DNAMotif::from_seqs(&seqs, None).unwrap();
        assert_eq!(profile.degenerate_consensus, String::from_utf8(motif.degenerate_consensus()).unwrap(), "{id}");
    }
    built
}

fn column(b: u8) -> usize {
    match b {
        b'A' => 0,
        b'T' => 1,
        b'G' => 2,
        _ => 3,
    }
}

fn revcomp(s: &[u8]) -> Vec<u8> {
    s.iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'T' => b'A',
            b'G' => b'C',
            b'C' => b'G',
            o => o,
        })
        .collect()
}

#[derive(Debug, Clone, PartialEq)]
struct Hit {
    rel: f64,
    start: usize,
    end: usize,
    strand: i8,
    matrix: usize,
    matched: String,
}

/// Every hit at or above `threshold` on both strands of `seq` (A, C, G, T only), unranked.
fn brute_force(seq: &[u8], mats: &[Matrix], threshold: f64) -> Vec<Hit> {
    let n = seq.len();
    let rc = revcomp(seq);
    let mut hits = Vec::new();
    for (mi, m) in mats.iter().enumerate() {
        let len = m.probs.len();
        for (strand, s) in [(1i8, seq), (-1i8, rc.as_slice())] {
            for off in 0..=(n - len) {
                let sum = (0..len).fold(0.0_f64, |acc, i| acc + m.probs[i][column(s[off + i])]);
                let rel = (sum - m.min) / m.denom;
                if rel >= threshold {
                    let start = if strand == 1 { off + 1 } else { n - off - len + 1 };
                    hits.push(Hit {
                        rel,
                        start,
                        end: start + len - 1,
                        strand,
                        matrix: mi,
                        matched: String::from_utf8(s[off..off + len].to_vec()).unwrap(),
                    });
                }
            }
        }
    }
    hits
}

/// The best `k` of `hits`: higher score to 3 places (as the report gives it), then earlier start,
/// then earlier matrix, then `+` first.
fn best(mut hits: Vec<Hit>, k: usize) -> Vec<Hit> {
    let milli = |h: &Hit| (h.rel * 1000.0).round() as i64;
    hits.sort_by(|a, b| {
        milli(b)
            .cmp(&milli(a))
            .then(a.start.cmp(&b.start))
            .then(a.matrix.cmp(&b.matrix))
            .then(b.strand.cmp(&a.strand))
    });
    hits.truncate(k);
    hits
}

fn random_bases(n: usize, seed: u64) -> Vec<u8> {
    let mut x = seed;
    (0..n)
        .map(|_| {
            x ^= x << 13;
            x ^= x >> 7;
            x ^= x << 17;
            b"ACGT"[(x % 4) as usize]
        })
        .collect()
}

fn plant(seq: &mut [u8], at_1based: usize, site: &[u8]) {
    seq[at_1based - 1..at_1based - 1 + site.len()].copy_from_slice(site);
}

fn score(m: &Matrix, site: &[u8]) -> f64 {
    let sum = site.iter().enumerate().fold(0.0_f64, |acc, (i, &b)| acc + m.probs[i][column(b)]);
    (sum - m.min) / m.denom
}

fn group(n: usize) -> String {
    let d = n.to_string();
    d.chars()
        .enumerate()
        .flat_map(|(i, c)| (i > 0 && (d.len() - i) % 3 == 0).then_some(',').into_iter().chain([c]))
        .collect()
}

/// The listed hits as (matrix id, start, end, strand, matched bases, score to 3 places).
fn listed(report: &PssmMotifScanReport) -> Vec<(String, usize, usize, i8, String, f64)> {
    report
        .hits
        .iter()
        .map(|h| (h.matrix_id.clone(), h.start, h.end, h.strand, h.matched_seq.clone(), h.relative_score))
        .collect()
}

fn expected(hits: &[Hit], mats: &[Matrix]) -> Vec<(String, usize, usize, i8, String, f64)> {
    hits.iter()
        .map(|h| (mats[h.matrix].id.to_string(), h.start, h.end, h.strand, h.matched.clone(), (h.rel * 1000.0).round() / 1000.0))
        .collect()
}

/// Every listed hit sits at its own coordinates: its bases are the sequence's there, read on its strand.
fn assert_true_coordinates(report: &PssmMotifScanReport, seq: &[u8]) {
    for h in &report.hits {
        let forward = &seq[h.start - 1..h.end];
        let read = if h.strand == 1 { forward.to_vec() } else { revcomp(forward) };
        assert_eq!(String::from_utf8(read).unwrap(), h.matched_seq, "{} {}..{} ({})", h.matrix_id, h.start, h.end, h.strand);
    }
}

#[test]
fn top_hits_span_every_matrix() {
    // 60 kb of random bases. The first matrix in scan order (TBP) gets 400 near-consensus TATA
    // boxes in the first 40 kb, more than the list holds; every other matrix gets its consensus
    // site late in the sequence, once on each strand. Listing the first 250 hits in scan order
    // fills the list with TATA boxes; the best 250 lead with every matrix's consensus site.
    let probe = scan_jaspar_pssm_motifs("ACGTACGTACGTACGTACGTACGT", 0.85, None);
    let mats = matrices(&probe);
    assert!(mats.len() >= 8, "fixture: most of the catalogue builds: {}", mats.len());
    let tbp = &mats[0];
    assert_eq!(tbp.id, "MA0108.2", "fixture: TBP is scanned first");
    // TBP's best one-base variant that still scores in [0.9, 1): below every consensus site.
    let variant: Vec<u8> = (0..tbp.consensus.len())
        .flat_map(|i| b"ACGT".iter().map(move |&b| (i, b)))
        .map(|(i, b)| {
            let mut v = tbp.consensus.as_bytes().to_vec();
            v[i] = b;
            v
        })
        .filter(|v| (0.9..1.0).contains(&score(tbp, v)))
        .max_by(|a, b| score(tbp, a).total_cmp(&score(tbp, b)))
        .expect("fixture: a near-consensus TATA box");

    let mut seq = random_bases(60_000, 0x00c1_70f5);
    for i in 0..400 {
        plant(&mut seq, 1_001 + i * 100, &variant);
    }
    for (j, m) in mats.iter().enumerate().skip(1) {
        plant(&mut seq, 44_001 + j * 1_000, m.consensus.as_bytes());
        plant(&mut seq, 44_501 + j * 1_000, &revcomp(m.consensus.as_bytes()));
    }
    let text = String::from_utf8(seq.clone()).unwrap();

    let report = scan_jaspar_pssm_motifs(&text, 0.85, None);
    let all = brute_force(&seq, &mats, 0.85);
    assert!(all.len() > 250, "fixture: more hits than the list holds: {}", all.len());
    assert!(all.iter().filter(|h| h.matrix == 0).count() >= 400, "fixture: TBP alone fills the list");

    // The count is every hit, the per-matrix counts are each matrix's, and the list is the best 250.
    assert_eq!(report.total_hits, all.len());
    for (mi, p) in report.profiles.iter().enumerate() {
        assert_eq!(p.hit_count, all.iter().filter(|h| h.matrix == mi).count(), "{}", p.matrix_id);
    }
    assert_eq!(listed(&report), expected(&best(all.clone(), 250), &mats));

    // Every matrix with a hit is in the list, and its consensus sites lead it on both strands.
    for (j, m) in mats.iter().enumerate() {
        assert!(report.hits.iter().any(|h| h.matrix_id == m.id), "{} is listed", m.id);
        if j > 0 {
            for (start, strand) in [(44_001 + j * 1_000, 1i8), (44_501 + j * 1_000, -1i8)] {
                assert!(
                    report.hits.iter().any(|h| h.matrix_id == m.id && h.start == start && h.strand == strand && h.relative_score == 1.0),
                    "{} consensus at {start} ({strand}) is listed",
                    m.id
                );
            }
        }
    }
    // The list leads with the sites scoring 1.000, every planted consensus site among them.
    assert!(report.hits.iter().take_while(|h| h.relative_score == 1.0).count() >= 2 * (mats.len() - 1));
    assert_true_coordinates(&report, &seq);

    // The whole sequence was scanned, and the warning names the list cut with the brute-force count.
    assert_eq!((report.scanned_length_bp, report.sequence_length_bp), (60_000, 60_000));
    assert_eq!(
        report.warnings,
        [format!("TF motif hit list capped: it lists the 250 best-scoring of the {} hits found.", group(all.len()))]
    );
    let json = serde_json::to_value(&report).unwrap();
    assert_eq!(json["scannedLengthBp"], 60_000);
    assert_eq!(json["warnings"].as_array().unwrap().len(), 1);
}

#[test]
fn minus_strand_hits_carry_true_coordinates_past_250kb() {
    // 300 kb of random bases with consensus sites planted on the minus strand past 250 kb (and
    // one inside it), and on the plus strand past it. A scan of the first 250 kb misses the plus
    // site; one that reads the minus strand from the last 250 kb but places it in the first puts
    // every minus-strand hit at the wrong bases.
    let probe = scan_jaspar_pssm_motifs("ACGTACGTACGTACGTACGTACGT", 0.9, None);
    let mats = matrices(&probe);
    let by_id = |id: &str| mats.iter().find(|m| m.id == id).expect(id);
    let planted: Vec<(&str, usize, i8)> = vec![
        ("PROK_LACO", 260_001, -1),
        ("PHAGE_T7P", 270_001, -1),
        ("MA0139.1", 280_001, -1),
        ("MA0148.4", 299_901, -1),
        ("PHAGE_T7P", 290_001, 1),
        ("MA0148.4", 100_001, -1),
        ("MA0139.1", 50_001, 1),
    ];
    let mut seq = random_bases(300_000, 0x0250_0b0b);
    for &(id, at, strand) in &planted {
        let site = by_id(id).consensus.as_bytes().to_vec();
        plant(&mut seq, at, &if strand == 1 { site } else { revcomp(&site) });
    }
    // The engine reads a FASTA-style text: lower case, 60 bases a line. Coordinates are bases.
    let text: String = seq
        .chunks(60)
        .map(|l| format!("{}\n", String::from_utf8(l.to_ascii_lowercase()).unwrap()))
        .collect();

    let report = scan_jaspar_pssm_motifs(&text, 0.9, None);
    assert_eq!((report.scanned_length_bp, report.sequence_length_bp), (300_000, 300_000), "the whole sequence is scanned");
    assert!(report.warnings.iter().all(|w| !w.contains("covered only")), "{:?}", report.warnings);

    assert_true_coordinates(&report, &seq);
    assert!(report.hits.iter().any(|h| h.strand == -1 && h.start > 250_000), "fixture: minus-strand hits past 250 kb are listed");
    for &(id, at, strand) in &planted {
        let len = by_id(id).probs.len();
        assert!(
            report.hits.iter().any(|h| h.matrix_id == id && h.start == at && h.end == at + len - 1 && h.strand == strand && h.relative_score == 1.0),
            "{id} at {at} ({strand}) is listed at its own coordinates"
        );
    }

    let all = brute_force(&seq, &mats, 0.9);
    assert_eq!(report.total_hits, all.len());
    assert_eq!(listed(&report), expected(&best(all.clone(), 250), &mats));
    let cut = (all.len() > 250).then(|| format!("TF motif hit list capped: it lists the 250 best-scoring of the {} hits found.", group(all.len())));
    assert_eq!(report.warnings, cut.into_iter().collect::<Vec<_>>());
}
