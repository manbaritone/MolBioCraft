// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6TD2N, natively: the Sanger contig layout across tandem repeats, low-complexity and N
//! overlaps, the two-sided 50-base count, the contig's orientation and each read's identity.
//!
//! The reads are made here from the same fixed-seed generator (mulberry32) as the studio's cases in
//! `src/__tests__/chromatogramPoaInput.test.tsx`, so the two suites assemble the same sequences;
//! the studio's run over the WASM build, these over the native build. Edits are counted with an
//! edit distance written here, never the engine's aligner. Every assembly runs under a deadline, so
//! a traceback that never ends fails the test rather than hanging it (D0049, D0052).

use molbiocraft_align::{assemble_sanger_contig_poa, PoaContigAssemblyReport, PoaReadInput};
use molbiocraft_core::reverse_complement_iupac;
use std::time::{Duration, Instant};

/// mulberry32, as the studio's tests run it.
struct Mulberry(u32);

impl Mulberry {
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        f64::from(t ^ (t >> 14)) / 4_294_967_296.0
    }

    fn dna(&mut self, n: usize) -> String {
        (0..n).map(|_| b"ACGT"[(self.next() * 4.0) as usize] as char).collect()
    }

    /// `seq` with about 1% of its bases substituted, each by the next of A, C, G, T.
    fn substituted(&mut self, seq: &str) -> String {
        seq.chars().map(|b| if self.next() < 0.01 { next_base(b) } else { b }).collect()
    }
}

fn next_base(b: char) -> char {
    match b {
        'A' => 'C',
        'C' => 'G',
        'G' => 'T',
        _ => 'A',
    }
}

fn other_than(avoid: &[u8]) -> char {
    ['A', 'C', 'G', 'T'].into_iter().find(|&b| !avoid.contains(&(b as u8))).unwrap()
}

fn rc(seq: &str) -> String {
    reverse_complement_iupac(seq, false)
}

fn q40(id: &str, sequence: String) -> PoaReadInput {
    PoaReadInput { id: id.into(), name: format!("{id}.ab1"), phred_scores: vec![40; sequence.len()], sequence }
}

/// The assembly on a worker thread, failed when it has not returned by the deadline.
fn assemble_within(reads: Vec<PoaReadInput>, secs: u64) -> PoaContigAssemblyReport {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let _ = tx.send(assemble_sanger_contig_poa(&reads, "contig", true));
    });
    rx.recv_timeout(Duration::from_secs(secs)).unwrap_or_else(|_| panic!("the contig assembly did not finish within {secs} s"))
}

/// A global alignment of `a` to `b` by edit distance (substitutions, inserted and deleted bases),
/// with `b`'s ends free when `stretch`: then it is the fewest edits that turn `a` into some stretch
/// of `b`, and a contig that dropped repeat copies inside itself is no stretch of the amplicon.
/// Returns (edits, identical columns, columns).
fn align(a: &[u8], b: &[u8], stretch: bool) -> (usize, usize, usize) {
    let w = b.len() + 1;
    let mut d = vec![0usize; (a.len() + 1) * w];
    for j in 0..=b.len() {
        d[j] = if stretch { 0 } else { j };
    }
    for i in 1..=a.len() {
        d[i * w] = i;
        for j in 1..=b.len() {
            d[i * w + j] = (d[(i - 1) * w + j - 1] + usize::from(a[i - 1] != b[j - 1])).min(d[(i - 1) * w + j] + 1).min(d[i * w + j - 1] + 1);
        }
    }
    let end = if stretch { (0..=b.len()).min_by_key(|&j| d[a.len() * w + j]).unwrap() } else { b.len() };
    let (mut i, mut j, mut same, mut columns) = (a.len(), end, 0usize, 0usize);
    // Each step lowers i or j, and a stretch's walk ends on its free first row.
    while i > 0 || (j > 0 && !stretch) {
        let here = d[i * w + j];
        if i > 0 && j > 0 && here == d[(i - 1) * w + j - 1] + usize::from(a[i - 1] != b[j - 1]) {
            same += usize::from(a[i - 1] == b[j - 1]);
            (i, j) = (i - 1, j - 1);
        } else if i > 0 && here == d[(i - 1) * w + j] + 1 {
            i -= 1;
        } else {
            j -= 1;
        }
        columns += 1;
    }
    (d[a.len() * w + end], same, columns)
}

/// Q40 reads of `template` over `spans` ([from, to] 1-based inclusive, forward or not), each with
/// about 1% substitutions; and the most amplicon positions left undecided (the reads carrying its
/// base not more than half of those over it) by all the reads, the forward ones alone or the
/// reverse ones alone: either may be all a contig is built from.
fn noisy_reads(r: &mut Mulberry, template: &str, spans: &[(usize, usize, bool)]) -> (Vec<PoaReadInput>, usize) {
    let sense: Vec<String> = spans.iter().map(|&(from, to, _)| r.substituted(&template[from - 1..to])).collect();
    let undecided = |pick: &dyn Fn(usize) -> bool| {
        let (mut carriers, mut depth) = (vec![0usize; template.len()], vec![0usize; template.len()]);
        for (i, s) in sense.iter().enumerate().filter(|(i, _)| pick(*i)) {
            for (k, b) in s.bytes().enumerate() {
                depth[spans[i].0 - 1 + k] += 1;
                carriers[spans[i].0 - 1 + k] += usize::from(b == template.as_bytes()[spans[i].0 - 1 + k]);
            }
        }
        (0..template.len()).filter(|&p| depth[p] > 0 && 2 * carriers[p] <= depth[p]).count()
    };
    let most = undecided(&|_| true).max(undecided(&|i| spans[i].2)).max(undecided(&|i| !spans[i].2));
    let reads = sense.into_iter().enumerate().map(|(i, s)| q40(&format!("read{i}"), if spans[i].2 { s } else { rc(&s) })).collect();
    (reads, most)
}

/// A 1,400 bp amplicon holding `copies` exact copies of a random `unit`-bp unit from base `at`,
/// between random flanks whose bases next to the repeat do not continue it; and the generator,
/// to draw the reads from.
fn tandem_amplicon(seed: u32, unit: usize, copies: usize, at: usize) -> (Mulberry, String) {
    let mut r = Mulberry(seed);
    let u = r.dna(unit);
    let mut left: Vec<char> = r.dna(at - 1).chars().collect();
    let mut right: Vec<char> = r.dna(1400 - (at - 1) - unit * copies).chars().collect();
    let last = left.len() - 1;
    left[last] = other_than(&[u.as_bytes()[unit - 1]]);
    right[0] = other_than(&[u.as_bytes()[0]]);
    let template = format!("{}{}{}", left.iter().collect::<String>(), u.repeat(copies), right.iter().collect::<String>());
    (r, template)
}

fn alternate(fwd: [(usize, usize); 4], rev: [(usize, usize); 4]) -> Vec<(usize, usize, bool)> {
    fwd.iter().zip(&rev).flat_map(|(&(a, b), &(c, d))| [(a, b, true), (c, d, false)]).collect()
}

/// The repeat layouts of the studio's cases: (unit, copies, at, spans, whether one read spans it).
fn tandem_layouts() -> Vec<(usize, usize, usize, Vec<(usize, usize, bool)>, bool)> {
    let rev40 = [(651, 1400); 4];
    let rev150 = [(600, 1400), (650, 1400), (700, 1400), (750, 1400)];
    vec![
        (40, 8, 601, alternate([(1, 750); 4], rev40), false),
        (40, 8, 601, alternate([(1, 750), (1, 750), (1, 750), (1, 1000)], rev40), true),
        (150, 4, 401, alternate([(1, 700), (1, 750), (1, 800), (1, 850)], rev150), false),
        (150, 4, 401, alternate([(1, 700), (1, 750), (1, 800), (1, 1100)], rev150), true),
    ]
}

/// Checks one repeat assembly: either the amplicon's length within `bound` edits, from every read,
/// with nothing to say; or the reads it left out named with the repeat's unit, and the contig a
/// stretch of the amplicon within `bound` edits, so no copy is lost inside it. Returns whether it
/// was assembled whole.
fn never_silently_collapsed(rep: &PoaContigAssemblyReport, template: &str, unit: usize, reads: usize, bound: usize, case: &str) -> bool {
    let said: Vec<&String> = rep.warnings.iter().filter(|w| w.contains("tandem repeat")).collect();
    let cons = rep.consensus_sequence.as_bytes();
    if said.is_empty() {
        assert!(rep.warnings.is_empty(), "{case}: {:?}", rep.warnings);
        assert_eq!((rep.consensus_length_bp, rep.read_count), (1400, reads), "{case}");
        assert!(align(cons, template.as_bytes(), false).0 <= bound, "{case}: edits from the amplicon");
        return true;
    }
    assert_eq!(said.len(), 1, "{case}: {said:?}");
    assert!(said[0].contains(&format!("a tandem repeat of a {unit}-bp unit")), "{case}: {}", said[0]);
    let named = (0..reads).filter(|i| said[0].contains(&format!("read{i}.ab1"))).count();
    assert_eq!(named + rep.read_count, reads, "{case}: every read is in the contig or named");
    assert!(named > 0, "{case}");
    assert!(align(cons, template.as_bytes(), true).0 <= bound, "{case}: edits from a stretch of the amplicon");
    false
}

/// AC1: a forward/reverse pair whose whole overlap lies in an exact tandem repeat (a 40-bp unit x8;
/// a 150-bp unit x4, the true overlap ranking below collapsed ones, so it is found only past the
/// first three diagonals) is never assembled with copies lost: the studio's four layouts on the
/// studio's seed give the outcome the studio expects, and on eight more seeds the same holds within
/// the edits each seed's reads leave undecided.
#[test]
fn a_tandem_repeat_holding_the_overlap_is_never_silently_collapsed() {
    for (unit, copies, at, spans, spanned) in tandem_layouts() {
        for seed in [2u32, 1, 3, 4, 5, 6, 7, 8, 9] {
            let (mut r, template) = tandem_amplicon(seed, unit, copies, at);
            let (reads, undecided) = noisy_reads(&mut r, &template, &spans);
            let rep = assemble_within(reads, 60);
            let case = format!("{unit}-bp unit x{copies}, spanned {spanned}, seed {seed}");
            let whole = never_silently_collapsed(&rep, &template, unit, spans.len(), undecided.max(2), &case);
            if seed == 2 {
                assert_eq!(whole, spanned, "{case}: the outcome the studio's case pins");
            }
        }
    }
    // Without substitutions the left-out repeats are named exactly: the 40-bp unit over the
    // contig's bases 601-750 (the forward reads' 601-750).
    let (_, template) = tandem_amplicon(2, 40, 8, 601);
    let spans = alternate([(1, 750); 4], [(651, 1400); 4]);
    let reads: Vec<PoaReadInput> = spans
        .iter()
        .enumerate()
        .map(|(i, &(a, b, f))| q40(&format!("read{i}"), if f { template[a - 1..b].to_string() } else { rc(&template[a - 1..b]) }))
        .collect();
    let rep = assemble_within(reads, 60);
    assert_eq!(rep.consensus_sequence, template[..750]);
    assert_eq!(
        rep.warnings,
        vec!["Reads read1.ab1, read3.ab1, read5.ab1, read7.ab1 overlap the other reads only inside a tandem repeat of a 40-bp unit (contig bases 601-750), where each fits in more than one place, so how many copies the contig holds there cannot be told from these reads; they were left out and the contig is built from the other 4 reads.".to_string()]
    );
}

/// Four exact Q40 reads of amplicon bases 1-1,000 and a Q40 reverse read `probe` (given 5' to 3' on
/// the amplicon's strand).
fn four_forward_and_probe(template: &str, probe: &str) -> Vec<PoaReadInput> {
    (0..4).map(|i| q40(&format!("fwd{i}"), template[..1000].to_string())).chain([q40("probe", rc(probe))]).collect()
}

/// A 1,400 bp amplicon of random flanks around `block` at base 501, four exact Q40 reads of it
/// (two forward, two reverse), and a Q40 read of `inside` bases of the block from its 21st.
fn block_and_short_read(seed: u32, block: &str, inside: usize, forward: bool) -> (String, Vec<PoaReadInput>) {
    let mut r = Mulberry(seed);
    let template = format!("{}{}{}", r.dna(500), block, r.dna(900 - block.len()));
    let short = template[520..520 + inside].to_string();
    let mut reads: Vec<PoaReadInput> =
        (0..4).map(|i| q40(&format!("whole{i}"), if i % 2 == 0 { template.clone() } else { rc(&template) })).collect();
    reads.push(q40("short", if forward { short } else { rc(&short) }));
    (template, reads)
}

/// A reverse read overlapping four forward reads over 1-1,000 by amplicon bases 901-1,000, with
/// overlap bases 11-30 called N and `substituted` of its bases substituted, every third from the
/// 41st.
fn n_probe(substituted: usize) -> (String, Vec<PoaReadInput>) {
    let template = Mulberry(0x5ee0).dna(1400);
    let probe: String = template[900..]
        .chars()
        .enumerate()
        .map(|(k, b)| {
            if (10..30).contains(&k) {
                'N'
            } else if (40..40 + 3 * substituted).contains(&k) && (k - 40) % 3 == 0 {
                next_base(b)
            } else {
                b
            }
        })
        .collect();
    let reads = four_forward_and_probe(&template, &probe);
    (template, reads)
}

/// AC2, the studio's cases natively: low-complexity overlaps ((CA)n, ACGT repeats, a homopolymer
/// inside the others and one ending them) and N-holding ones are placed by the 90% rule, an N
/// counted as neither a match nor a mismatch: 20 Ns and 8 substitutions in 100 bases is 72 of 80
/// called bases, placed; with 9 it is 71 of 80, left out (91 of 100 would place it).
#[test]
fn low_complexity_and_n_holding_overlaps_are_placed_by_the_90_percent_rule() {
    let homopolymer_end = || {
        let mut bases: Vec<char> = Mulberry(0x9a).dna(1400).chars().collect();
        for b in &mut bases[950..1000] {
            *b = 'A';
        }
        for (p, b) in [947, 948, 949, 1000, 1001, 1002].into_iter().zip("CGTCGT".chars()) {
            bases[p] = b;
        }
        let template: String = bases.into_iter().collect();
        let reads = four_forward_and_probe(&template, &template[950..]);
        (template, reads)
    };
    let n_runs = || {
        let template = Mulberry(0x4e).dna(1400);
        let reads = (0..8)
            .map(|k| {
                let (from, to) = if k % 2 == 0 { (1, 1000) } else { (401, 1400) };
                let n0 = 401 + 75 * k;
                let s: String =
                    template[from - 1..to].chars().enumerate().map(|(i, b)| if (n0..n0 + 100).contains(&(from + i)) { 'N' } else { b }).collect();
                q40(&format!("read{k}"), if k % 2 == 0 { s } else { rc(&s) })
            })
            .collect();
        (template, reads)
    };
    let cases: Vec<(&str, (String, Vec<PoaReadInput>), bool)> = vec![
        ("(CA)n", block_and_short_read(0xca, &"CA".repeat(100), 80, false), true),
        ("ACGT repeats", block_and_short_read(0xac, &"ACGT".repeat(50), 80, true), true),
        ("a poly-A run inside the others", block_and_short_read(0xaa, &"A".repeat(120), 60, false), true),
        ("a poly-A run ending the others", homopolymer_end(), true),
        ("eight reads with N runs", n_runs(), true),
        ("20 Ns and 8 substitutions", n_probe(8), true),
        ("20 Ns and 9 substitutions", n_probe(9), false),
    ];
    for (case, (template, reads), placed) in cases {
        let n = reads.len();
        let rep = assemble_within(reads, 60);
        if placed {
            assert!(rep.warnings.is_empty(), "{case}: {:?}", rep.warnings);
            assert_eq!(rep.read_count, n, "{case}");
            assert_eq!(rep.consensus_sequence, template, "{case}");
        } else {
            assert_eq!(rep.read_count, n - 1, "{case}");
            assert_eq!(rep.consensus_sequence, template[..1000], "{case}");
            assert_eq!(rep.warnings.len(), 1, "{case}");
            assert!(rep.warnings[0].starts_with("Reads probe.ab1 could not be placed"), "{case}: {:?}", rep.warnings);
        }
    }
    // An N scores nothing in the overlap alignment either. The probe's 60 called bases (amplicon
    // 501-560) lie exactly inside the reads, its other 140 bases are N, and the reads' last 60
    // bases copy 501-560 with 4 substituted. Exact, the probe scores 120 and adds nothing; on the
    // copy, at 93%, 104 less the overhang, and it would add its 140 Ns past the reads. Scored as
    // mismatches, its Ns sink the exact place to -160, the copy wins, the exact place becomes its
    // rival, and the probe is left out as ambiguous.
    let (template, reads) = n_run_and_copy();
    let rep = assemble_within(reads, 60);
    assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
    assert_eq!(rep.read_count, 5);
    assert_eq!(rep.consensus_sequence, template[..1000]);
}

/// Four exact Q40 reads of amplicon bases 1-1,000, whose last 60 bases copy 501-560 with every
/// 15th from the 8th substituted, and a forward Q40 probe of bases 501-560 followed by 140 Ns.
fn n_run_and_copy() -> (String, Vec<PoaReadInput>) {
    let mut bases: Vec<char> = Mulberry(0xd1).dna(1400).chars().collect();
    for k in 0..60 {
        bases[940 + k] = if k % 15 == 7 { next_base(bases[500 + k]) } else { bases[500 + k] };
    }
    let template: String = bases.into_iter().collect();
    let probe = format!("{}{}", &template[500..560], "N".repeat(140));
    let reads = (0..4).map(|i| q40(&format!("fwd{i}"), template[..1000].to_string())).chain([q40("probe", probe)]).collect();
    (template, reads)
}

/// AC3: the 50-base overlap is counted on the draft and on the read. 49 draft bases with 1 read
/// base inserted (50 read bases) and 50 draft bases with 1 deleted (49) are left out; 50 + 1 and
/// 51 - 1 are placed.
#[test]
fn the_50_base_overlap_is_counted_on_both_the_draft_and_the_read() {
    let template = Mulberry(0x2b5).dna(1400);
    for (draft, insert, placed) in [(49, true, false), (50, false, false), (50, true, true), (51, false, true)] {
        let s = &template[1000 - draft..];
        let b = s.as_bytes();
        let probe = if insert { format!("{}{}{}", &s[..25], other_than(&[b[24], b[25]]), &s[25..]) } else { format!("{}{}", &s[..24], &s[25..]) };
        let rep = assemble_within(four_forward_and_probe(&template, &probe), 60);
        let case = format!("{draft} draft bases, {} read base {}", 1, if insert { "inserted" } else { "deleted" });
        if placed {
            assert!(rep.warnings.is_empty(), "{case}: {:?}", rep.warnings);
            assert_eq!(rep.consensus_sequence, template, "{case}");
        } else {
            assert_eq!(rep.read_count, 4, "{case}");
            assert_eq!(rep.consensus_sequence, template[..1000], "{case}");
            assert!(rep.warnings[0].starts_with("Reads probe.ab1 could not be placed"), "{case}: {:?}", rep.warnings);
        }
    }
}

/// AC4: four forward reads over 1-900 and four longer reverse reads over 401-1,400 (the old layout
/// grew from a reverse read, and the contig was the amplicon's reverse complement); read 0 lacks 3
/// bases and read 1 carries 2 extra. The contig reads along the forward reads, and each read's
/// identity is over its own span, gap columns included, as an alignment written here counts it.
#[test]
fn the_contig_keeps_the_forward_orientation_and_identity_over_each_span() {
    let mut r = Mulberry(1);
    let template = r.dna(1400);
    let mut sense: Vec<String> =
        (0..8).map(|i| if i % 2 == 0 { r.substituted(&template[..900]) } else { r.substituted(&template[400..]) }).collect();
    sense[0] = format!("{}{}", &sense[0][..449], &sense[0][452..]);
    let extra = other_than(&[sense[1].as_bytes()[299], sense[1].as_bytes()[300]]).to_string().repeat(2);
    sense[1] = format!("{}{}{}", &sense[1][..300], extra, &sense[1][300..]);
    let reads: Vec<PoaReadInput> =
        sense.iter().enumerate().map(|(i, s)| q40(&format!("read{i}"), if i % 2 == 0 { s.clone() } else { rc(s) })).collect();
    let rep = assemble_within(reads.clone(), 60);
    assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
    assert_eq!(rep.consensus_sequence, template, "the contig reads along the forward reads");
    assert_eq!(notes(&rep), ORIENTATION.replace("{}", "read0.ab1"));
    for row in &rep.aligned_reads {
        let i: usize = row.id.trim_start_matches("read").parse().unwrap();
        assert_eq!(row.strand, if i % 2 == 0 { 1 } else { -1 }, "{}", row.id);
        let span = if i % 2 == 0 { &template[..900] } else { &template[400..] };
        let (_, same, columns) = align(sense[i].as_bytes(), span.as_bytes(), false);
        let want = ((same as f64 / columns as f64) * 10000.0).round() / 100.0;
        assert_eq!(row.identity_pct, want, "{}: identity over its span", row.id);
        assert!(row.identity_pct > 98.0, "{}", row.id);
    }
    // Traces carry no strand of their own: with a reverse read listed first the contig follows
    // it, the amplicon's reverse complement, and its notes say which read it follows.
    let mut turned = reads;
    turned.swap(0, 1);
    let rep = assemble_within(turned, 60);
    assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
    assert_eq!(rep.consensus_sequence, rc(&template), "the contig reads along read1, a reverse read");
    assert_eq!(notes(&rep), ORIENTATION.replace("{}", "read1.ab1"));
    for row in &rep.aligned_reads {
        let i: usize = row.id.trim_start_matches("read").parse().unwrap();
        assert_eq!(row.strand, if i % 2 == 0 { -1 } else { 1 }, "{}", row.id);
    }
}

/// What the saved contig's notes say of its orientation, `{}` the read it follows.
const ORIENTATION: &str =
    "Orientation: the contig reads along {}, the first read listed whose strand on the layout is known; reads on the other strand are reverse-complemented onto it.";

/// The contig document's notes.
fn notes(rep: &PoaContigAssemblyReport) -> String {
    let meta = rep.contig_document.doc_metadata.as_ref().expect("the contig document has metadata");
    meta.get("Notes").and_then(|v| v.as_str()).unwrap_or_default().to_string()
}

/// A read is left out as fitting in more than one place only when the other place fits it about as
/// well: the probe (amplicon bases 501-630) lies exactly inside four reads over 1-1,000 whose last
/// 100 bases copy bases 501-600 with 6 substituted, where at 94% it would run 30 bases past them.
/// It is placed, not left out.
#[test]
fn a_read_in_one_exact_place_is_placed_though_a_94_percent_copy_also_fits() {
    let mut bases: Vec<char> = Mulberry(0xd1).dna(1400).chars().collect();
    for k in 0..100 {
        bases[900 + k] = if k % 16 == 8 { next_base(bases[500 + k]) } else { bases[500 + k] };
    }
    let template: String = bases.into_iter().collect();
    let reads: Vec<PoaReadInput> =
        (0..4).map(|i| q40(&format!("fwd{i}"), template[..1000].to_string())).chain([q40("probe", template[500..630].to_string())]).collect();
    let rep = assemble_within(reads, 60);
    assert!(rep.warnings.is_empty(), "{:?}", rep.warnings);
    assert_eq!(rep.read_count, 5);
    assert_eq!(rep.consensus_sequence, template[..1000]);
}

/// LC-012: low-complexity k-mers now vote, sampled, so a read made only of them is aligned rather
/// than skipped. On the most repetitive input, every read one homopolymer, the assembly ends within
/// the 60 s deadline of a debug build and says what it left out: 24 poly-A reads of 2,500 bases
/// (each fits the others at any offset, so each is left out and named) and 8 of poly-G, half given
/// as poly-C. Every read seeds a layout of its own here, so the work grows with the square of the
/// read count.
#[test]
fn reads_of_one_repeated_base_end_promptly_and_are_named() {
    for (base, n) in [('A', 24usize), ('G', 8)] {
        let reads: Vec<PoaReadInput> = (0..n)
            .map(|i| {
                let s = base.to_string().repeat(2500);
                q40(&format!("read{i}"), if i % 2 == 0 { s } else { rc(&s) })
            })
            .collect();
        let started = Instant::now();
        let rep = assemble_within(reads, 60);
        eprintln!("{n} x poly-{base}: {:?}, {} placed, {:?}", started.elapsed(), rep.read_count, rep.warnings);
        let named = (0..n).filter(|i| rep.warnings.iter().any(|w| w.contains(&format!("read{i}.ab1")))).count();
        assert_eq!(named + rep.read_count, n, "every read is in the contig or named");
        assert!(rep.consensus_length_bp <= 2500, "no copy is invented");
    }
}

/// A 1,400 bp amplicon of random flanks around `block` from base `at` (1-based); and the
/// generator, to draw the reads from.
fn block_amplicon(seed: u32, block: &str, at: usize) -> (Mulberry, String) {
    let mut r = Mulberry(seed);
    let left = r.dna(at - 1);
    let right = r.dna(1400 - (at - 1) - block.len());
    (r, format!("{left}{block}{right}"))
}

/// Checks an assembly across a repeat of reads over `spans`: the reads `kept` are in the contig;
/// every other read is in it or named; every sentence of a read that fits in more than one place
/// names a tandem repeat of a `unit`-bp unit, never "a repeat"; the notes name the read the contig
/// follows, the first listed that is placed or named as fitting in more than one place; and the
/// contig, turned to the amplicon's strand when that read is a reverse one, is within `bound`
/// edits of a stretch of the amplicon. Returns how many sentences name the repeat.
fn kept_and_named(rep: &PoaContigAssemblyReport, template: &str, spans: &[(usize, usize, bool)], kept: &[usize], unit: usize, bound: usize, case: &str) -> usize {
    let placed = |i: usize| rep.aligned_reads.iter().any(|row| row.id == format!("read{i}"));
    for &i in kept {
        assert!(placed(i), "{case}: read{i} is kept; {:?}", rep.warnings);
    }
    for i in (0..spans.len()).filter(|&i| !placed(i)) {
        assert!(rep.warnings.iter().any(|w| w.contains(&format!("read{i}.ab1"))), "{case}: read{i} is named; {:?}", rep.warnings);
    }
    let repeats: Vec<&String> = rep.warnings.iter().filter(|w| w.contains("fits in more than one place")).collect();
    for w in &repeats {
        assert!(w.contains(&format!("inside a tandem repeat of a {unit}-bp unit (")), "{case}: {w}");
    }
    let known = |i: usize| placed(i) || repeats.iter().any(|w| w.contains(&format!("read{i}.ab1")));
    let follows = (0..spans.len()).find(|&i| known(i)).expect("a read is placed");
    assert_eq!(notes(rep), ORIENTATION.replace("{}", &format!("read{follows}.ab1")), "{case}");
    let contig = if spans[follows].2 { rep.consensus_sequence.clone() } else { rc(&rep.consensus_sequence) };
    assert!(align(contig.as_bytes(), template.as_bytes(), true).0 <= bound, "{case}: edits from a stretch of the amplicon");
    repeats.len()
}

/// AC5: reads ending in a self-complementary tandem repeat keep every replicate whose overlap holds
/// unique bases. Turned round, such a read runs off the draft's end inside the repeat, and that
/// placement on the other strand left every replicate but the seed out: forward replicates over
/// 1-1,000, 990, 980 and 970 of an amplicon with (AT)60 at 901-1,020 gave "1,000 bp (1 of 4
/// reads)", and on the AC1 shapes with the overlap inside an (AT)60 or an (ACGT)100 the forward
/// reads went too. A rival inside a repeat on the same strand is discounted as well: replicates
/// starting in a (CA)60 and ending in another fit the draft's ends on their own strand. Wrong
/// implementations, and what catches each: every other-strand placement a rival (the (AT)60 and
/// (ACGT)100 cases); the discount on the other strand only (the two (CA)60s); a best fixed by its
/// draft bases holding no unit, whether or not it matches them (the (CA)150 ending 91 bases in,
/// seed 3, where reads all (TG)n laid past the draft's (TG)n onto 17 flank bases with 7 errors
/// collapsed the repeat: 1,335 bp, 67 edits); a wider same-placement window, 40 bases for 2 (the (CA)150
/// cases, whose rivals lie 4 to 20 bases off: a silent 1,362-1,386 bp contig).
/// Every seed's contig is within the edits its reads leave undecided (at least 2).
#[test]
fn replicates_ending_in_a_self_complementary_repeat_are_kept() {
    let ca_both_ends = |seed: u32| {
        let mut r = Mulberry(seed);
        let template = format!("{}{}{}{}", "CA".repeat(60), r.dna(780), "CA".repeat(60), r.dna(380));
        (r, template)
    };
    let replicates = vec![(1, 1000, true), (1, 990, true), (1, 980, true), (1, 970, true)];
    for seed in [1u32, 2, 3, 4] {
        let cases: Vec<(&str, (Mulberry, String), Vec<(usize, usize, bool)>, usize, &[usize])> = vec![
            ("(AT)60 at 901, four forward replicates", block_amplicon(seed, &"AT".repeat(60), 901), replicates.clone(), 2, &[0, 1, 2, 3]),
            ("(AT)60 at 901, F 1-1,000 and R 961-1,400", block_amplicon(seed, &"AT".repeat(60), 901), alternate([(1, 1000); 4], [(961, 1400); 4]), 2, &[0, 2, 4, 6]),
            ("(ACGT)100 at 601, F 1-750 and R 651-1,400", block_amplicon(seed, &"ACGT".repeat(100), 601), alternate([(1, 750); 4], [(651, 1400); 4]), 4, &[0, 2, 4, 6]),
            ("(CA)60 at 1 and 901, four forward replicates", ca_both_ends(seed), replicates.clone(), 2, &[0, 1, 2, 3]),
        ];
        for (name, (mut r, template), spans, unit, kept) in cases {
            let (reads, undecided) = noisy_reads(&mut r, &template, &spans);
            let rep = assemble_within(reads, 60);
            let case = format!("{name}, seed {seed}");
            kept_and_named(&rep, &template, &spans, kept, unit, undecided.max(2), &case);
            if kept.len() == spans.len() {
                assert!(rep.warnings.is_empty(), "{case}: {:?}", rep.warnings);
                assert_eq!(rep.consensus_length_bp, 1000, "{case}");
            }
        }
        // (CA)150 ending h bases into reverse reads over 560-1,400; forward reads over 1-600 end
        // inside it. The reads overlap by 41 bases, under the 50-base rule, so they cannot join,
        // and every overlap that places a forward read lies inside the repeat a unit or more off.
        // With h 54 an overlap of 50 to 55 bases places a read only where no substitution falls
        // in it, so a seed may leave every place short of the rule and the reads merely unplaced;
        // with h 58, 70 and 91 the rivals are found and the repeat named. With h 91 and seed 3 the
        // forward reads' best overlap, all (TG)n on the read, runs past the draft's 91 bases of
        // (TG)n onto the 17 before them with 7 errors: bases outside the repeat on the draft's
        // side only, matched by chance.
        for h in [54usize, 58, 70, 91] {
            let (mut r, template) = block_amplicon(seed, &"CA".repeat(150), 560 + h - 300);
            let spans = alternate([(1, 600); 4], [(560, 1400); 4]);
            let (reads, undecided) = noisy_reads(&mut r, &template, &spans);
            let rep = assemble_within(reads, 60);
            let case = format!("(CA)150 ending {h} bases into the reverse reads, seed {seed}");
            assert!(rep.read_count < spans.len(), "{case}: the reads cannot join over 41 bases; {:?}", rep.warnings);
            let named = kept_and_named(&rep, &template, &spans, &[], 2, undecided.max(2), &case);
            assert!(h == 54 || named > 0, "{case}: {:?}", rep.warnings);
        }
    }
}

/// AC5: a read is placed only on at least 50 called overlap bases. A foreign read of 42 Ns, then the
/// draft's last 8 bases, then 400 bases of its own shares one 8-mer with the draft, so its only
/// candidate place is the 50-column overlap that holds 8 called bases; counting the N columns
/// placed it there, appending its 400 bases. With 20 Ns among its overlap bases 11-30, a read
/// overlapping by 70 bases (50 called) is placed and one overlapping by 69 (49 called) is left out.
/// Wrong implementations, and what catches each: N columns counted toward the 50 (the foreign
/// read, and the 69-base overlap); more than 50 called bases asked for (the 70-base overlap).
#[test]
fn reads_are_placed_only_on_called_overlap_bases() {
    let mut r = Mulberry(34);
    let template = r.dna(1400);
    let probe = format!("{}{}{}", "N".repeat(42), &template[992..1000], r.dna(400));
    let kmers = |s: &str| -> std::collections::HashSet<String> {
        (0..=s.len() - 8).map(|i| s[i..i + 8].to_string()).filter(|k| !k.contains('N')).collect()
    };
    let draft = kmers(&template[..1000]);
    assert_eq!(kmers(&probe).iter().filter(|k| draft.contains(*k)).count(), 1, "the foreign read's one seed is the draft's last 8 bases");
    let rep = assemble_within(four_forward_and_probe(&template, &probe), 60);
    assert_eq!(rep.read_count, 4, "{:?}", rep.warnings);
    assert_eq!(rep.consensus_sequence, template[..1000]);
    assert_eq!(rep.warnings, vec!["Reads probe.ab1 could not be placed in one contig with the others and were left out; the contig is built from the other 4 reads.".to_string()]);
    for (overlap, placed) in [(70usize, true), (69, false)] {
        let template = Mulberry(0x5ee0).dna(1400);
        let probe: String = template[1000 - overlap..].chars().enumerate().map(|(k, b)| if (10..30).contains(&k) { 'N' } else { b }).collect();
        let rep = assemble_within(four_forward_and_probe(&template, &probe), 60);
        if placed {
            assert!(rep.warnings.is_empty(), "{overlap}: {:?}", rep.warnings);
            assert_eq!(rep.consensus_sequence, template, "{overlap}");
        } else {
            assert_eq!(rep.read_count, 4, "{overlap}");
            assert_eq!(rep.consensus_sequence, template[..1000], "{overlap}");
            assert!(rep.warnings[0].starts_with("Reads probe.ab1 could not be placed"), "{overlap}: {:?}", rep.warnings);
        }
    }
}
