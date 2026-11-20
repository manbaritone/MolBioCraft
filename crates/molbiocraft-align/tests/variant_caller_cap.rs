// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Regression (BG-01M6S1ED): the variant caller stopped reading the alignment at its 500th variant,
//! annotated only the first 30, and aligned at most the first 100,000 bp of the sample without
//! saying so, while its totals, Ti/Tv, VCF and the HGVS consequences read off that VCF were
//! presented as the whole sample's. A 30 kb sample with 750 SNPs gave 500 variants, the last at
//! 19,482.
//!
//! The caller now reads every variant off the alignment, annotates every one, and says in its
//! `warnings` how much of a sample longer than its 100,000-bp alignment cap it aligned, where
//! calling stopped and how much of the sample was left. The reference window a capped sample is
//! aligned in is no longer cut to its first 100,000 bases, so the cut no longer reads as an
//! insertion at the end; and a window reaches past a sample's net deletion of more than its
//! 200-base flank, so the end of such a sample is no longer miscalled.
//!
//! Every input is generated here from a fixed seed, so no reference data is needed.

use molbiocraft_align::call_freebayes_variants;
use molbiocraft_align::ngs_assembly::{call_freebayes_variants_with_one_shot_limit, CALL_ONE_SHOT_MAX_BYTES};
use molbiocraft_align::FreeBayesVariantReport;
use molbiocraft_core::SequenceFeature;
use molbiocraft_formats::annotate_vcf_coding_consequences_noodles;

/// How much of a sample the caller aligns.
const ALIGNED_CAP_BP: usize = 100_000;

/// Deterministic pseudo-random DNA (LCG, fixed seed), as in `variant_caller_crash.rs`.
fn genome(len: usize, seed: u64) -> Vec<u8> {
    let mut x = seed;
    (0..len)
        .map(|_| {
            x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            b"ACGT"[((x >> 33) % 4) as usize]
        })
        .collect()
}

fn text(b: &[u8]) -> String {
    String::from_utf8(b.to_vec()).unwrap()
}

fn transition(b: u8) -> u8 {
    match b {
        b'A' => b'G',
        b'G' => b'A',
        b'C' => b'T',
        _ => b'C',
    }
}

fn transversion(b: u8) -> u8 {
    match b {
        b'A' | b'G' => b'C',
        _ => b'A',
    }
}

fn other_than(a: u8, b: u8) -> u8 {
    *b"ACGT".iter().find(|&&c| c != a && c != b).unwrap()
}

/// The reverse complement of A/C/G/T, with N left as N.
fn reverse_complement(s: &[u8]) -> Vec<u8> {
    s.iter()
        .rev()
        .map(|&b| match b {
            b'A' => b'T',
            b'T' => b'A',
            b'C' => b'G',
            b'G' => b'C',
            other => other,
        })
        .collect()
}

/// A VCF call: 1-based position, REF, ALT, type.
type Call = (usize, String, String, String);

fn report_calls(rep: &FreeBayesVariantReport) -> Vec<Call> {
    rep.variants.iter().map(|v| (v.position_bp, v.ref_allele.clone(), v.alt_allele.clone(), v.variant_type.clone())).collect()
}

/// The data rows of a VCF, as (POS, REF, ALT).
fn vcf_rows(vcf: &str) -> Vec<(usize, String, String)> {
    vcf.lines()
        .filter(|l| !l.starts_with('#') && !l.is_empty())
        .map(|l| {
            let f: Vec<&str> = l.split('\t').collect();
            (f[1].parse().unwrap(), f[3].to_string(), f[4].to_string())
        })
        .collect()
}

/// Ti/Tv as the caller reports it: rounded to two decimals, 0 with no transversion.
fn ti_tv(transitions: usize, transversions: usize) -> f64 {
    if transversions == 0 {
        0.0
    } else {
        ((transitions as f64 / transversions as f64) * 100.0).round() / 100.0
    }
}

/// A 30 kb reference and a copy carrying 750 SNPs 39 bases apart, with the call each must make and
/// the transitions and transversions among them. The first 500 are two transitions to each
/// transversion, the last 250 one to four, so the Ti/Tv over all 750 (384 / 366, 1.05) is neither
/// the Ti/Tv over the first 500 (2.01) nor one that leaves out the last 250's transitions (0.91)
/// or their transversions (2.31).
fn thirty_kb_with_750_snps() -> (Vec<u8>, Vec<u8>, Vec<Call>, usize, usize) {
    let reference = genome(30_000, 0xED_0750);
    let mut sample = reference.clone();
    let (mut calls, mut ti, mut tv) = (Vec::new(), 0, 0);
    for i in 0..750 {
        let p = 20 + 39 * i;
        let tv_here = if i < 500 { i % 3 == 2 } else { i % 5 != 0 };
        sample[p] = if tv_here { transversion(reference[p]) } else { transition(reference[p]) };
        if tv_here {
            tv += 1;
        } else {
            ti += 1;
        }
        calls.push((p + 1, text(&reference[p..p + 1]), text(&sample[p..p + 1]), "SNP".to_string()));
    }
    (reference, sample, calls, ti, tv)
}

#[test]
fn reports_all_750_planted_snps() {
    let (reference, sample, planted, ti, tv) = thirty_kb_with_750_snps();
    assert_eq!((planted.len(), ti, tv), (750, 384, 366), "fixture");
    assert_eq!(ti_tv(ti, tv), 1.05, "fixture: Ti/Tv over all 750");
    // and every Ti/Tv short of all 750 differs from it: over the first 500, and without the last
    // 250's transitions or transversions
    assert_eq!([ti_tv(334, 166), ti_tv(334, 366), ti_tv(384, 166)], [2.01, 0.91, 2.31], "fixture");

    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
    assert_eq!(report_calls(&rep), planted);
    assert_eq!((rep.total_variants, rep.snp_count, rep.mnp_or_indel_count), (750, 750, 0));
    assert_eq!(rep.ti_tv_ratio, ti_tv(ti, tv), "Ti/Tv over every SNP");
    let rows = vcf_rows(&rep.vcf_text);
    assert_eq!(rows.len(), 750, "one VCF row per variant");
    assert_eq!(rows.last().map(|r| r.0), Some(29_232), "the last VCF row is the last planted SNP");
    // nothing was cut, so nothing is said to be
    assert_eq!(rep.warnings, Vec::<String>::new());
}

#[test]
fn reports_every_snp_past_500_on_a_sample_aligned_in_one_piece() {
    // 11 kb, the reference's own length: within the one-shot limit, so the sample is aligned in one
    // rust-bio alignment rather than in segments, and every SNP past the 500th is still read
    let reference = genome(11_000, 0xED_0600);
    assert!(2 * 11_001 * 11_001 <= CALL_ONE_SHOT_MAX_BYTES, "fixture: within the one-shot limit");
    let mut sample = reference.clone();
    let (mut planted, mut ti, mut tv) = (Vec::new(), 0, 0);
    // three transitions to a transversion in the first 500, one to one in the last 100: Ti/Tv 2.43
    // over all 600, 3.00 over the first 500
    for i in 0..600 {
        let p = 9 + 18 * i;
        let tv_here = if i < 500 { i % 4 == 3 } else { i % 2 == 0 };
        sample[p] = if tv_here { transversion(reference[p]) } else { transition(reference[p]) };
        if tv_here {
            tv += 1;
        } else {
            ti += 1;
        }
        planted.push((p + 1, text(&reference[p..p + 1]), text(&sample[p..p + 1]), "SNP".to_string()));
    }
    assert_eq!((ti, tv, ti_tv(ti, tv), ti_tv(375, 125)), (425, 175, 2.43, 3.0), "fixture");
    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
    assert_eq!(report_calls(&rep), planted);
    assert_eq!(rep.total_variants, 600);
    assert_eq!(rep.ti_tv_ratio, ti_tv(ti, tv));
    assert_eq!(vcf_rows(&rep.vcf_text).len(), 600);
    assert_eq!(rep.warnings, Vec::<String>::new());
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
/// reference it was made from, the call each edit must produce, and the reference offset each
/// sample base was copied from (`None` for an inserted base). Every indel is made where it cannot
/// slide: an inserted run's end bases differ from the reference bases beside it, and a deleted
/// run's end bases are set to differ from the bases beside it.
fn plant(mut r: Vec<u8>, from: usize, to: usize, edits: &[Edit], seed: u64) -> (Vec<u8>, Vec<u8>, Vec<Call>, Vec<Option<usize>>) {
    for e in edits {
        if let Edit::Del(p, n) = *e {
            if r[p + n - 1] == r[p - 1] {
                r[p + n - 1] = other_than(r[p - 1], r[p - 1]);
            }
            if r[p] == r[p + n] {
                r[p] = other_than(r[p + n], r[p + n]);
            }
        }
    }
    let mut filler = genome(8_000, seed).into_iter();
    let (mut sample, mut source, mut calls) = (Vec::new(), Vec::new(), Vec::new());
    let mut copied = from;
    let copy = |sample: &mut Vec<u8>, source: &mut Vec<Option<usize>>, a: usize, b: usize| {
        sample.extend_from_slice(&r[a..b]);
        source.extend((a..b).map(Some));
    };
    for e in edits {
        match *e {
            Edit::Snp(p) => {
                copy(&mut sample, &mut source, copied, p);
                let alt = transition(r[p]);
                sample.push(alt);
                source.push(Some(p));
                copied = p + 1;
                calls.push((p + 1, text(&r[p..p + 1]), text(&[alt]), "SNP".into()));
            }
            Edit::Ins(p, n) => {
                copy(&mut sample, &mut source, copied, p);
                let mut ins: Vec<u8> = filler.by_ref().take(n).collect();
                ins[0] = other_than(r[p], r[p]);
                ins[n - 1] = other_than(r[p - 1], r[p - 1]);
                sample.extend_from_slice(&ins);
                source.extend((0..n).map(|_| None));
                copied = p;
                calls.push((p, text(&r[p - 1..p]), text(&[&r[p - 1..p], &ins[..]].concat()), "INS".into()));
            }
            Edit::Del(p, n) => {
                copy(&mut sample, &mut source, copied, p);
                copied = p + n;
                calls.push((p, text(&r[p - 1..p + n]), text(&r[p - 1..p]), "DEL".into()));
            }
        }
    }
    copy(&mut sample, &mut source, copied, to);
    (r, sample, calls, source)
}

/// A sample copied from 300 bases into a 160 kb reference with a SNP every 47 bases and three
/// indels, ending where it is `len` bases long; the reference, the sample, and the calls of the
/// edits in its first [`ALIGNED_CAP_BP`] bases with the 1-based reference base its last aligned
/// base was copied from. No edit falls within 150 sample bases of the cap.
fn long_sample(len: usize) -> (Vec<u8>, Vec<u8>, Vec<Call>, usize) {
    let r = genome(160_000, 0xED_C100);
    // the indels before the cap change the sample's length by -30 + 12 - 5
    let to = 300 + len + 23;
    let mut edits = vec![Edit::Del(40_000, 30), Edit::Ins(70_000, 12), Edit::Del(90_000, 5)];
    edits.extend(
        (330..to - 200)
            .step_by(47)
            .filter(|&p| [40_000usize, 70_000, 90_000].iter().all(|&q| p.abs_diff(q) > 150))
            // reference offset 100,322 is the sample's 100,000th base
            .filter(|&p| p.abs_diff(100_322) > 150)
            .map(Edit::Snp),
    );
    edits.sort_by_key(|e| match *e {
        Edit::Snp(p) | Edit::Ins(p, _) | Edit::Del(p, _) => p,
    });
    let (reference, sample, calls, source) = plant(r, 300, to, &edits, 0xED_C101);
    assert_eq!(sample.len(), len, "fixture length");
    let last_aligned = source[..len.min(ALIGNED_CAP_BP)].iter().rev().find_map(|&s| s).unwrap() + 1;
    let aligned: Vec<Call> = calls.into_iter().filter(|c| c.0 <= last_aligned).collect();
    (reference, sample, aligned, last_aligned)
}

#[test]
fn warns_when_the_sample_exceeds_the_alignment_cap() {
    let (reference, sample, planted, stop) = long_sample(150_377);
    assert_eq!(stop, 100_323, "fixture: the sample's 100,000th base is reference base 100,323");
    assert!(planted.len() > 2_000, "fixture: more than 2,000 calls in the aligned part ({})", planted.len());
    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
    // every variant in the aligned part, and none invented where the alignment stops
    assert_eq!(report_calls(&rep), planted);
    assert_eq!(rep.total_variants, planted.len());
    assert_eq!(rep.warnings, vec![
        "Variants were called over the first 100,000 bp of the 150,377-bp sample only (the caller aligns at most 100,000 bp): \
         calling stopped at reference base 100,323, and the last 50,377 bp of the sample were not compared."
            .to_string()
    ]);

    // read on the reverse strand, the sample's last 100,000 bases are the ones aligned
    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&reverse_complement(&sample)));
    assert_eq!(report_calls(&rep), planted, "reverse strand");
    assert_eq!(rep.warnings, vec![
        "Variants were called over the last 100,000 bp of the 150,377-bp sample only, read as its reverse complement \
         (the caller aligns at most 100,000 bp): calling stopped at reference base 100,323, and the first 50,377 bp of \
         the sample were not compared."
            .to_string()
    ]);

    // at the cap, nothing is left out and nothing is said to be; one base past it, that base is
    for (len, warned) in [(ALIGNED_CAP_BP, false), (ALIGNED_CAP_BP + 1, true)] {
        let (reference, sample, planted, stop) = long_sample(len);
        assert_eq!(stop, 100_323, "{len} bp fixture");
        let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
        assert_eq!(report_calls(&rep), planted, "{len} bp");
        let expected = if warned {
            vec!["Variants were called over the first 100,000 bp of the 100,001-bp sample only (the caller aligns at most \
                  100,000 bp): calling stopped at reference base 100,323, and the last 1 bp of the sample were not compared."
                .to_string()]
        } else {
            Vec::new()
        };
        assert_eq!(rep.warnings, expected, "{len} bp");
    }
}

#[test]
fn consequences_and_annotations_cover_every_variant() {
    let (reference, sample, planted, _, _) = thirty_kb_with_750_snps();
    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
    assert_eq!(rep.total_variants, 750);

    // the HGVS consequences the Genomics studio reads off the caller's VCF, against one CDS over
    // most of the reference: every variant is annotated, and the impact counts add up to all of them
    let cds = SequenceFeature {
        id: "cds1".into(),
        name: "orf1".into(),
        feature_type: "CDS".into(),
        start: 101,
        end: 29_899,
        strand: 1,
        color: "#000000".into(),
        notes: None,
        qualifiers: None,
        segments: None,
        cleavage_site: None,
    };
    let consequences = annotate_vcf_coding_consequences_noodles(&text(&reference), &[cds], &rep.vcf_text, 11);
    assert_eq!(consequences.total_variants, 750);
    assert_eq!(consequences.snv_count, 750);
    assert_eq!(
        consequences.high_impact_count
            + consequences.moderate_impact_count
            + consequences.low_impact_count
            + consequences.modifier_impact_count,
        750
    );
    let positions: Vec<usize> = consequences.annotated_variants.iter().map(|a| a.position_bp).collect();
    assert_eq!(positions, planted.iter().map(|c| c.0).collect::<Vec<_>>());
    assert_eq!(consequences.ts_tv_ratio, rep.ti_tv_ratio, "the consequences' Ti/Tv is the caller's");

    // one annotation per variant, at its position
    assert_eq!(rep.annotations.len(), 750);
    for (a, v) in rep.annotations.iter().zip(&rep.variants) {
        assert_eq!((a.id.as_str(), a.start, a.end), (v.id.as_str(), v.position_bp, v.position_bp), "{a:?}");
    }
    assert_eq!(rep.warnings, Vec::<String>::new(), "nothing is left unannotated");
}

/// The reference bases the caller's window runs past each end of where the sample maps.
const FLANK: usize = 200;

#[test]
fn calls_a_net_deletion_longer_than_the_window_flank_where_it_lies() {
    // A sample with a net deletion of more than the window's 200-base flank spans more reference
    // than the window held: its end was aligned as an insertion, and a SNP there was lost. The
    // mapper places the sample on the diagonal of its longer part, so the deletion cut short the
    // window's end when it lies after the sample's longer part and its start when before.
    for (len, one_piece) in [(8_000usize, true), (20_000, false)] {
        for del in [300usize, 500, 2_000] {
            // five eighths in, the longer part is before the deletion; near the start, after it
            for (place, at) in [("five eighths in", len * 5 / 8), ("near the start", if del < 1_000 { 1_000 } else { 2_500 })] {
                let (from, to) = (400, 400 + len + del);
                let edits = [Edit::Snp(from + 100), Edit::Snp(from + at - 300), Edit::Del(from + at, del), Edit::Snp(to - 120)];
                let (reference, sample, planted, _) = plant(genome(to + 400, 0xED_D000 + (len + del + at) as u64), from, to, &edits, 0xED_D001);
                let one_shot = 2 * (sample.len() + 1) * (len + del + 2 * FLANK + 1);
                assert_eq!(one_shot <= CALL_ONE_SHOT_MAX_BYTES, one_piece, "{len} bp: fixture on the wrong side of the one-shot limit");
                let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
                assert_eq!(report_calls(&rep), planted, "{len}-bp sample, {del}-bp deletion {place}");
                assert_eq!(rep.warnings, Vec::<String>::new());
            }
        }
    }
}

// ---------------------------------------------------------------------------------------------
// BG-01M6T6GK: the caller removed N and every other letter but A, C, G and T from both sequences
// before calling. 10 N in the reference read as a 10-bp insertion and moved every later call 10
// bases left (a SNP at 8,001 was reported at 7,991), 5 N in the sample read as a 5-bp deletion,
// and the cap warning counted only the sample's A/C/G/T bases. The caller now keeps every base in
// place, calls nothing where either sequence holds one that is not A, C, G or T, and says where.
// ---------------------------------------------------------------------------------------------

/// The seed of the 10 kb genome the N pairs are made from. `src/__tests__/variantNCoordinates.test.tsx`
/// makes the same reference and sample from it, with the same generator.
const N_SEED: u64 = 0x6B_0010;
/// The reference's N run, bases 4,990-4,999, as 0-based offsets.
const REF_N: std::ops::Range<usize> = 4_989..4_999;
/// The planted SNP, reference base 8,001, as a 0-based offset.
const SNP_AT: usize = 8_000;

/// A 10 kb genome whose bases 4,990-4,999 hold no A (each A there made a G), the sample (its bases
/// 301-9,700 with base 8,001 replaced by its transition) and the SNP's call. The reference is the
/// genome with bases 4,990-4,999 made N, so the sample holds real bases other than A opposite the
/// run: reading N as A would call SNPs there, and dropping N would shift every base after it.
fn reference_n_pair() -> (Vec<u8>, Vec<u8>, Call) {
    let mut genome = genome(10_000, N_SEED);
    for b in &mut genome[REF_N] {
        if *b == b'A' {
            *b = b'G';
        }
    }
    let alt = transition(genome[SNP_AT]);
    let mut sample = genome[300..9_700].to_vec();
    sample[SNP_AT - 300] = alt;
    let snp = (SNP_AT + 1, text(&genome[SNP_AT..SNP_AT + 1]), text(&[alt]), "SNP".to_string());
    genome[REF_N].fill(b'N');
    (genome, sample, snp)
}

/// The reports for a pair aligned in one piece (the default, as the studio calls it) and in
/// segments, which the caller uses for a sample past the one-shot limit.
fn both_paths(reference: &[u8], sample: &[u8]) -> [(&'static str, FreeBayesVariantReport); 2] {
    [
        ("one piece", call_freebayes_variants("chr1", &text(reference), &text(sample))),
        ("segments", call_freebayes_variants_with_one_shot_limit("chr1", &text(reference), &text(sample), 0)),
    ]
}

/// No record whose REF span overlaps reference bases `from..=to` (1-based), and no indel anchored
/// on the base before them or on their last base.
fn assert_nothing_called_over(rep: &FreeBayesVariantReport, from: usize, to: usize, label: &str) {
    for v in &rep.variants {
        let end = v.position_bp + v.ref_allele.len() - 1;
        assert!(end < from || v.position_bp > to, "{label}: {v:?} overlaps {from}-{to}");
        let indel = v.variant_type == "INS" || v.variant_type == "DEL";
        assert!(!(indel && (v.position_bp == from - 1 || v.position_bp == to)), "{label}: indel at an end of {from}-{to}: {v:?}");
    }
}

#[test]
fn n_in_the_reference_keeps_reference_coordinates() {
    let (reference, sample, snp) = reference_n_pair();
    assert_eq!(snp.0, 8_001, "fixture");
    assert_eq!(text(&reference[REF_N]), "NNNNNNNNNN", "fixture");
    // real bases other than A opposite the run (variantNCoordinates.test.tsx checks the same bases)
    assert_eq!(text(&sample[REF_N.start - 300..REF_N.end - 300]), "GCGGTTGGGT", "fixture");
    let [one_piece, segments] = both_paths(&reference, &sample);
    let reverse = ("reverse strand", call_freebayes_variants("chr1", &text(&reference), &text(&reverse_complement(&sample))));
    for (label, rep) in [one_piece, segments, reverse] {
        // the planted truth: the sample is reference bases 301-9,700 base for base, but for the SNP,
        // so the SNP is the only call, at its reference position, in the calls and in the VCF
        assert_eq!(report_calls(&rep), vec![snp.clone()], "{label}");
        assert_eq!(vcf_rows(&rep.vcf_text), vec![(snp.0, snp.1.clone(), snp.2.clone())], "{label}: VCF");
        assert_nothing_called_over(&rep, 4_990, 4_999, label);
        assert_eq!(rep.annotations.iter().map(|a| (a.start, a.end)).collect::<Vec<_>>(), vec![(8_001, 8_001)], "{label}");
        assert_eq!(rep.warnings, vec!["The reference holds 10 N at 4,990-4,999; no variant is called there.".to_string()], "{label}");
    }
}

#[test]
fn n_in_the_sample_is_not_called_as_a_deletion() {
    // an N-free 10 kb reference whose bases 6,001-6,005 hold no A, so a sample N read as A would be
    // called there, and a copy of all of it holding 5 N at its bases 6,001-6,005 and the transition
    // of base 8,001
    let sample_n = 6_000..6_005;
    let mut reference = genome(10_000, N_SEED + 1);
    for b in &mut reference[sample_n.clone()] {
        if *b == b'A' {
            *b = b'G';
        }
    }
    let alt = transition(reference[SNP_AT]);
    let snp = (SNP_AT + 1, text(&reference[SNP_AT..SNP_AT + 1]), text(&[alt]), "SNP".to_string());
    let mut sample = reference.clone();
    sample[sample_n].fill(b'N');
    sample[SNP_AT] = alt;
    for (label, rep) in both_paths(&reference, &sample) {
        assert_eq!(report_calls(&rep), vec![snp.clone()], "{label}");
        assert_eq!(vcf_rows(&rep.vcf_text), vec![(snp.0, snp.1.clone(), snp.2.clone())], "{label}: VCF");
        assert_nothing_called_over(&rep, 6_001, 6_005, label);
        assert_eq!(rep.warnings, vec!["The sample holds 5 N at 6,001-6,005; no variant is called there.".to_string()], "{label}");
    }

    // The sample's run is given in its own numbering: copied from 300 bases in, its N are its bases
    // 5,701-5,705 (opposite reference 6,001-6,005), and given as its reverse complement (9,700
    // bases), its bases 3,996-4,000.
    let shifted = sample[300..].to_vec();
    let rc = reverse_complement(&shifted);
    assert_eq!((text(&shifted[5_700..5_705]), text(&rc[3_995..4_000])), ("NNNNN".into(), "NNNNN".into()), "fixture");
    for (label, given, run) in [("300 bases in", &shifted, "5,701-5,705"), ("reverse strand", &rc, "3,996-4,000")] {
        let rep = call_freebayes_variants("chr1", &text(&reference), &text(given));
        assert_eq!(report_calls(&rep), vec![snp.clone()], "{label}");
        assert_nothing_called_over(&rep, 6_001, 6_005, label);
        assert_eq!(rep.warnings, vec![format!("The sample holds 5 N at {run}; no variant is called there.")], "{label}");
    }
}

#[test]
fn the_cap_warning_counts_every_base_of_the_sample() {
    // 100,020 bases copied from 300 bases into a 120 kb reference: 20 N at the sample's bases
    // 50,001-50,020, opposite reference bases that hold no A, and a SNP every 97 bases elsewhere,
    // none within 150 bases of the run or of the cap
    let mut r = genome(120_000, N_SEED + 2);
    let run = 300 + 50_000..300 + 50_020;
    for b in &mut r[run.clone()] {
        if *b == b'A' {
            *b = b'G';
        }
    }
    let mut sample = r[300..300 + 100_020].to_vec();
    sample[50_000..50_020].fill(b'N');
    let mut planted = Vec::new();
    for p in (330..300 + ALIGNED_CAP_BP - 150).step_by(97).filter(|p| p + 150 < run.start || *p >= run.end + 150) {
        let alt = transition(r[p]);
        sample[p - 300] = alt;
        planted.push((p + 1, text(&r[p..p + 1]), text(&[alt]), "SNP".to_string()));
    }
    assert_eq!((sample.len(), sample.iter().filter(|&&b| b == b'N').count()), (100_020, 20), "fixture");
    assert!(planted.len() > 1_000, "fixture: {} SNPs", planted.len());
    let rep = call_freebayes_variants("chr1", &text(&r), &text(&sample));
    // the sample's first 100,000 bases, N and all, are aligned: the last is reference base 100,300
    assert_eq!(report_calls(&rep), planted);
    assert_eq!(rep.warnings, vec![
        "Variants were called over the first 100,000 bp of the 100,020-bp sample only (the caller aligns at most 100,000 bp): \
         calling stopped at reference base 100,300, and the last 20 bp of the sample were not compared."
            .to_string(),
        "The sample holds 20 N at 50,001-50,020; no variant is called there.".to_string(),
    ]);
}

#[test]
fn a_deletion_beside_a_reference_n_run_invents_no_snp() {
    // The AC1 pair with the 10 reference bases after the run (5,000-5,009) deleted from the sample:
    // the k-th of them equals the sample's k-th base opposite the run for two k, and differs for
    // the other eight. Either way the alignment holds one 10-base deletion; scored as mismatches,
    // the run's sample bases opposite the 10 N score -30, and opposite the deleted bases -20 (two
    // matches, eight mismatches), so deleting the run instead scores higher and calls the 8 that
    // differ, a SNP and two MNPs at 5,000-5,009 that are not there. N is an unknown base, scored 1,
    // between a mismatch and a match, whatever it faces (BG-01M6TE8J): the run's sample bases score
    // 10 opposite the 10 N, and -20 moved off them. The sample's bases stay opposite the run, and the
    // deletion beside it is not called, since where it lies against unknown bases is not known; a
    // warning names the reference bases it deletes (BG-01M6TE8J).
    let (reference, ac1_sample, snp) = reference_n_pair();
    let mut r = reference.clone();
    let after = r[5_009];
    let opposite = ac1_sample[REF_N.start - 300..REF_N.end - 300].to_vec();
    for k in 0..10 {
        r[4_999 + k] = if k == 1 || k == 4 { opposite[k] } else { other_than(opposite[k], if k == 0 { after } else { opposite[k] }) };
    }
    let mut sample = ac1_sample[..REF_N.end - 300].to_vec();
    sample.extend_from_slice(&ac1_sample[5_009 - 300..]);
    let at = SNP_AT - 300 - 10;
    assert_eq!((text(&r[SNP_AT..SNP_AT + 1]), text(&sample[at..at + 1])), (snp.1.clone(), snp.2.clone()), "fixture");
    assert_eq!((0..10).filter(|&k| r[4_999 + k] == opposite[k]).count(), 2, "fixture");
    for (label, rep) in both_paths(&r, &sample) {
        assert_eq!(report_calls(&rep), vec![snp.clone()], "{label}");
        assert_nothing_called_over(&rep, 4_990, 5_009, label);
        assert_eq!(
            rep.warnings,
            vec![
                "The reference holds 10 N at 4,990-4,999; no variant is called there.".to_string(),
                "A 10-bp deletion of reference bases 5,000-5,009 lies beside bases that are not known and is not called.".to_string(),
            ],
            "{label}"
        );
    }
}

// ---------------------------------------------------------------------------------------------
// BG-01M6TE8J: the data seat's findings on BG-01M6T6GK. A real deletion beside a reference N run
// was still split or shifted into a false call; an indel left out beside unknown bases was not
// named; the R and Y half of the fix and the lower-casing of the sample's unknown bases were
// unpinned; and the warnings had no cap. (An empty reference or sample is pinned through the studio,
// in src/__tests__/variantNCoordinates.test.tsx.)
// ---------------------------------------------------------------------------------------------

/// One probe: a 6 kb genome from its own seed, a deletion of `len` bases starting `gap` bases after
/// the reference's N run (4,990-4,999), the sample (genome bases 301-5,700 with the deletion made
/// and base 5,501 replaced by its transition), and the reference (the genome with 4,990-4,999 made
/// N, so the sample holds the genome's real bases opposite the run).
struct Probe {
    len: usize,
    gap: usize,
    reference: Vec<u8>,
    sample: Vec<u8>,
    snp: Call,
}

/// The probes' planted SNP, reference base 5,501, as a 0-based offset.
const PROBE_SNP_AT: usize = 5_500;

/// The seed of the probes' draws. Before BG-01M6TE8J, two of its 73 probes gave a false call
/// aligned in one piece: a 10-bp deletion that touches the run gave a SNP C>A at 5,007, and a 7-bp
/// deletion that does not (its VCF placement is POS 5,000) gave a 1-bp DEL at 5,004 and a SNP T>A
/// at 5,007 in its place. Of seeds 1-40, 31 gave no false call and none more than three, so the
/// data seat's 5 of 73 came from other draws; this seed is one of the two that give both kinds.
const PROBE_SEED: u64 = 29;

/// The 73 probes: each draws its genome's seed, its deletion's length (1-10) and its gap after the
/// run (0-30) from one LCG seeded with `seed`.
fn deletion_beside_reference_n_probes(seed: u64) -> Vec<Probe> {
    let mut x: u64 = seed;
    let mut next = move || {
        x = x.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        x >> 33
    };
    (0..73)
        .map(|_| {
            let seed = next();
            let len = 1 + (next() % 10) as usize;
            let gap = (next() % 31) as usize;
            let mut g = genome(6_000, seed);
            let alt = transition(g[PROBE_SNP_AT]);
            let snp = (PROBE_SNP_AT + 1, text(&g[PROBE_SNP_AT..PROBE_SNP_AT + 1]), text(&[alt]), "SNP".to_string());
            let del = REF_N.end + gap..REF_N.end + gap + len;
            let mut sample = g[300..del.start].to_vec();
            sample.extend_from_slice(&g[del.end..5_700]);
            sample[PROBE_SNP_AT - 300 - len] = alt;
            g[REF_N].fill(b'N');
            Probe { len, gap, reference: g, sample, snp }
        })
        .collect()
}


/// The reference bases a warning names for a deletion of `len` bases left out beside unknown bases,
/// as 1-based (first, last): "A 3-bp deletion of reference bases 5,000-5,002 lies beside ...", "A
/// 3-bp deletion, somewhere in reference bases 4,996-5,005, lies beside ...", or "... of reference
/// base 5,000 ...". `None` when the warning is not about such a deletion.
fn named_deletion(warning: &str, len: usize) -> Option<(usize, usize)> {
    let rest = warning.strip_prefix(&format!("A {len}-bp deletion"))?;
    if !rest.ends_with("lies beside bases that are not known and is not called.") {
        return None;
    }
    let at = &rest[rest.find("reference base")? + "reference base".len()..];
    let span: String = at.trim_start_matches('s').trim_start().chars().take_while(|c| c.is_ascii_digit() || *c == ',' || *c == '-').collect();
    let num = |s: &str| s.trim_matches(',').replace(',', "").parse::<usize>().ok();
    match span.trim_end_matches(',').split_once('-') {
        Some((a, b)) => Some((num(a)?, num(b)?)),
        None => num(&span).map(|a| (a, a)),
    }
}

/// The reference bases a warning for an insertion of `len` bases left out beside unknown bases
/// names it between, as 1-based (after, before): "A 2-bp insertion after reference base 7,503 lies
/// beside ..." is (7,503, 7,504), "A 2-bp insertion, somewhere between reference bases 7,500 and
/// 7,504, lies beside ..." is (7,500, 7,504). `None` when the warning is not about such an insertion.
fn named_insertion(warning: &str, len: usize) -> Option<(usize, usize)> {
    let rest = warning.strip_prefix(&format!("A {len}-bp insertion"))?;
    let rest = rest.strip_suffix(" lies beside bases that are not known and is not called.")?;
    let num = |s: &str| s.trim_matches(',').replace(',', "").parse::<usize>().ok();
    if let Some(at) = rest.strip_prefix(" after reference base ") {
        let a = num(at)?;
        return Some((a, a + 1));
    }
    let (a, b) = rest.strip_prefix(", somewhere between reference bases ")?.split_once(" and ")?;
    Some((num(a)?, num(b)?))
}

#[test]
fn no_false_call_beside_a_reference_n_run_with_a_real_deletion() {
    // Each probe's deletion has one VCF placement: as far left as it moves without changing a base,
    // that is, while the base before it equals its last base. A reference N equals no base, so it
    // stops at the run. Where its anchor (the base before it) is then known, it is called there;
    // where its anchor is the run's last N, it is left out, and a warning names reference bases
    // that hold both that placement and the planted deletion. The planted SNP is called in every
    // probe at 5,501, its reference position, and nothing else is.
    let run = "The reference holds 10 N at 4,990-4,999; no variant is called there.".to_string();
    let (mut called, mut left_out) = (0, 0);
    for (i, p) in deletion_beside_reference_n_probes(PROBE_SEED).iter().enumerate() {
        let r = &p.reference;
        // 0-based: the planted deletion's first base, and its VCF placement's
        let planted = REF_N.end + p.gap;
        let mut s = planted;
        while r[s - 1] == r[s + p.len - 1] {
            s -= 1;
        }
        let label = format!("probe {i}: a {}-bp deletion {} bases after the run", p.len, p.gap);
        for (path, rep) in both_paths(r, &p.sample) {
            if s > REF_N.end {
                // VCF: POS is the anchor, REF the anchor and the deleted bases, ALT the anchor
                let del = (s, text(&r[s - 1..s + p.len]), text(&r[s - 1..s]), "DEL".to_string());
                assert_eq!(report_calls(&rep), vec![del, p.snp.clone()], "{label}, {path}: called at its VCF placement");
                assert_eq!(rep.warnings, vec![run.clone()], "{label}, {path}");
            } else {
                assert_eq!(report_calls(&rep), vec![p.snp.clone()], "{label}, {path}: left out");
                assert_eq!(rep.warnings.len(), 2, "{label}, {path}: {:?}", rep.warnings);
                assert_eq!(rep.warnings[0], run, "{label}, {path}");
                let (first, last) = named_deletion(&rep.warnings[1], p.len).unwrap_or_else(|| panic!("{label}, {path}: {:?}", rep.warnings));                // 1-based: the VCF placement deletes s+1..=s+len, the planted one planted+1..=planted+len
                assert!(first <= s + 1 && last >= planted + p.len, "{label}, {path}: {first}-{last} misses its span: {:?}", rep.warnings);
                // and the named span lies beside the run, not across the genome
                assert!(first >= 4_990 - 10 && last <= planted + p.len + 30, "{label}, {path}: {first}-{last}");
            }
        }
        if s > REF_N.end {
            called += 1;
        } else {
            left_out += 1;
        }
    }
    // the fixture holds deletions of both kinds
    assert!(called > 0 && left_out > 0, "fixture: {called} callable, {left_out} touching the run");
}

/// 1-based thousands, as the caller writes positions in its warnings.
fn thousands(n: usize) -> String {
    let digits = n.to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    out
}

/// The caller's sentence for a run of `n` copies of `letter` from 1-based `start` in `whose`.
fn run_sentence(whose: &str, letter: char, start: usize, n: usize) -> String {
    let at = if n == 1 { thousands(start) } else { format!("{}-{}", thousands(start), thousands(start + n - 1)) };
    format!("The {whose} holds {} {letter} at {at}; no variant is called there.", thousands(n))
}

#[test]
fn other_ambiguity_codes_and_shared_n_columns_keep_coordinates() {
    // 1. R and Y. A 12 kb reference whose first 4,000 bases are runs of R and Y (an R run, a Y run,
    // an R run, a Y run, 1,000 each), and which holds 5 R at 7,001-7,005 and 3 Y at 7,501-7,503;
    // the sample is its bases 6,001-7,800, real bases where the reference holds R and Y, with an R
    // at its own base 400 and the transition of base 7,201. The mapper keeps only A, C, G, T and N,
    // so handed the R and Y as they are it would place the sample 4,000 bases left of where it
    // lies, outside the window the caller searches, and the sample would be aligned against R and
    // Y: the caller hands it every unknown base as N.
    let g = genome(12_000, N_SEED + 3);
    let mut reference = g.clone();
    for (i, b) in reference[..4_000].iter_mut().enumerate() {
        *b = if (i / 1_000) % 2 == 0 { b'R' } else { b'Y' };
    }
    reference[7_000..7_005].fill(b'R');
    reference[7_500..7_503].fill(b'Y');
    // and 2 bases inserted after reference base 7,503, the Y run's last: where they lie against the
    // three real bases the Y stand for is not known, so the insertion is left out, and named
    // between reference bases that hold the place it was made
    let mut sample = g[6_000..7_503].to_vec();
    let ins = [other_than(g[7_503], g[7_502]), other_than(g[7_502], g[7_503])];
    sample.extend_from_slice(&ins);
    sample.extend_from_slice(&g[7_503..7_800]);
    let alt = transition(g[7_200]);
    sample[7_200 - 6_000] = alt;
    sample[399] = b'R';
    let snp = (7_201, text(&g[7_200..7_201]), text(&[alt]), "SNP".to_string());
    for (label, rep) in both_paths(&reference, &sample) {
        assert_eq!(report_calls(&rep), vec![snp.clone()], "R and Y, {label}");
        assert_eq!(
            rep.warnings[..3],
            [run_sentence("reference", 'R', 7_001, 5), run_sentence("reference", 'Y', 7_501, 3), run_sentence("sample", 'R', 400, 1)],
            "R and Y, {label}"
        );
        assert_eq!(rep.warnings.len(), 4, "R and Y, {label}: {:?}", rep.warnings);
        let (after, before) = named_insertion(&rep.warnings[3], 2).unwrap_or_else(|| panic!("R and Y, {label}: {:?}", rep.warnings));
        assert!(after <= 7_503 && before >= 7_504 && after >= 7_490, "R and Y, {label}: {after}-{before}: {:?}", rep.warnings);    }

    // 2. N in both sequences at the same column. A 10 kb reference holding N at 3,001-3,004, at
    // 6,001 and at 6,004; the sample is all of it but reference bases 6,002-6,004, so it holds N
    // where the reference does at 3,001-3,004 and at 6,001, and the transition of base 8,001. The
    // 3-bp deletion holds the reference's N at 6,004 and lies beside the N both hold at 6,001, so
    // it may delete 6,001-6,003 or 6,002-6,004: the sample's N faces the other reference N. It is
    // not called, and stays on the side of that column it is aligned on. Two unknown bases never
    // fit and no column of two of them is a match, because the caller aligns the sample's unknown
    // bases in lower case: kept in upper case, the two N would match, the deletion would move past
    // the column, and the warning would name both placements, 6,001-6,004.
    let mut reference = genome(10_000, N_SEED + 4);
    reference[3_000..3_004].fill(b'N');
    reference[6_000] = b'N';
    reference[6_003] = b'N';
    // neither placement moves off the other way: the deleted run's first base differs from the base
    // after it, and its last from the base before the shared column
    if reference[6_001] == reference[6_004] {
        reference[6_001] = other_than(reference[6_004], reference[6_004]);
    }
    if reference[6_002] == reference[5_999] {
        reference[6_002] = other_than(reference[5_999], reference[5_999]);
    }
    let mut sample = reference[..6_001].to_vec();
    sample.extend_from_slice(&reference[6_004..]);
    let alt = transition(reference[SNP_AT]);
    sample[SNP_AT - 3] = alt;
    let snp = (SNP_AT + 1, text(&reference[SNP_AT..SNP_AT + 1]), text(&[alt]), "SNP".to_string());
    assert_eq!((text(&sample[3_000..3_004]), text(&sample[6_000..6_001])), ("NNNN".into(), "N".into()), "fixture");
    // The deletion may be reference bases 6,001-6,003 or 6,002-6,004, which score alike, and the
    // warning names both: a column of two unknown bases scores as any column holding one does
    // (BG-01M6W02V AC4, D0268, which re-pinned this from either single placement).
    let covering = "A 3-bp deletion, somewhere in reference bases 6,001-6,004, lies beside bases that are not known and is not called.";
    for (label, rep) in both_paths(&reference, &sample) {
        assert_eq!(report_calls(&rep), vec![snp.clone()], "shared N, {label}");
        assert_nothing_called_over(&rep, 3_001, 3_004, label);
        assert_nothing_called_over(&rep, 6_001, 6_004, label);
        let runs = vec![
            run_sentence("reference", 'N', 3_001, 4),
            run_sentence("reference", 'N', 6_001, 1),
            run_sentence("reference", 'N', 6_004, 1),
            run_sentence("sample", 'N', 3_001, 4),
            run_sentence("sample", 'N', 6_001, 1),
        ];
        assert_eq!(rep.warnings[..runs.len()], runs[..], "shared N, {label}");
        assert_eq!(rep.warnings.len(), runs.len() + 1, "shared N, {label}: {:?}", rep.warnings);
        assert_eq!(rep.warnings[runs.len()], covering, "shared N, {label}: {:?}", rep.warnings);    }
}

/// A 6 kb reference (seed `seed`) with an N at each of `ref_n` (1-based) and the sample copied from
/// its bases 301-5,700 with an R at each of `sample_r` (the sample's own 1-based bases) and the
/// transition of reference base 5,501; with the SNP's call.
fn runs_pair(seed: u64, ref_n: &[usize], sample_r: &[usize]) -> (Vec<u8>, Vec<u8>, Call) {
    let mut reference = genome(6_000, seed);
    let mut sample = reference[300..5_700].to_vec();
    let alt = transition(reference[PROBE_SNP_AT]);
    sample[PROBE_SNP_AT - 300] = alt;
    let snp = (PROBE_SNP_AT + 1, text(&reference[PROBE_SNP_AT..PROBE_SNP_AT + 1]), text(&[alt]), "SNP".to_string());
    for &p in ref_n {
        reference[p - 1] = b'N';
    }
    for &p in sample_r {
        sample[p - 1] = b'R';
    }
    (reference, sample, snp)
}

#[test]
fn caps_the_run_warnings_and_counts_the_rest() {
    // The reference's N runs come first, then the sample's R runs, in order; the first 20 are named
    // and one sentence counts the rest by sequence. A run is one letter repeated: an N at 1,001 and
    // 1,002 is one run, each R its own.
    let reference_runs = [1_001, 1_002, 2_001, 3_001, 3_002, 3_003, 3_004, 3_005];
    let named_reference = vec![run_sentence("reference", 'N', 1_001, 2), run_sentence("reference", 'N', 2_001, 1), run_sentence("reference", 'N', 3_001, 5)];
    // an R every 50 sample bases from its base 125: none opposite a reference N or the SNP
    let r_every_50 = |k: usize| (0..k).map(|i| 125 + 50 * i).collect::<Vec<_>>();
    for (rs, rest) in [
        (17, None),
        (18, Some("1 more run of bases other than A, C, G or T (1 in the sample) is not listed; no variant is called there.")),
        (106, Some("89 more runs of bases other than A, C, G or T (89 in the sample) are not listed; no variant is called there.")),
    ] {
        let sample_r = r_every_50(rs);
        let (reference, sample, snp) = runs_pair(N_SEED + 5, &reference_runs, &sample_r);
        let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
        assert_eq!(report_calls(&rep), vec![snp], "{rs} sample runs");
        let mut expected = named_reference.clone();
        expected.extend(sample_r.iter().take(20 - 3).map(|&p| run_sentence("sample", 'R', p, 1)));
        expected.extend(rest.map(String::from));
        assert_eq!(rep.warnings, expected, "{rs} sample runs");
    }

    // 25 reference runs and 5 sample runs: 20 of the reference's are named, and the rest of both
    // counted
    let reference_runs: Vec<usize> = (0..25).map(|i| 1_000 + 100 * i).collect();
    let sample_r: Vec<usize> = (0..5).map(|i| 3_825 + 50 * i).collect();
    let (reference, sample, snp) = runs_pair(N_SEED + 6, &reference_runs, &sample_r);
    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
    assert_eq!(report_calls(&rep), vec![snp]);
    let mut expected: Vec<String> = reference_runs[..20].iter().map(|&p| run_sentence("reference", 'N', p, 1)).collect();
    expected.push("10 more runs of bases other than A, C, G or T (5 in the reference, 5 in the sample) are not listed; no variant is called there.".into());
    assert_eq!(rep.warnings, expected, "reference and sample runs past the cap");

    // 25 1-bp deletions, each of the reference base after a sample R: each is left out beside it,
    // the first 20 are named, and the rest counted after them
    let mut reference = genome(6_000, N_SEED + 7);
    let alt = transition(reference[PROBE_SNP_AT]);
    let snp = (PROBE_SNP_AT + 1, text(&reference[PROBE_SNP_AT..PROBE_SNP_AT + 1]), text(&[alt]), "SNP".to_string());
    reference[PROBE_SNP_AT] = alt;
    // 0-based reference offsets of the bases each R stands for and of the deleted bases after them
    let r_at: Vec<usize> = (0..25).map(|i| 400 + 100 * i).collect();
    let sample: Vec<u8> = (300..5_700)
        .filter(|p| !r_at.contains(&(p - 1)))
        .map(|p| if r_at.contains(&p) { b'R' } else { reference[p] })
        .collect();
    reference[PROBE_SNP_AT] = snp.1.as_bytes()[0];
    let rep = call_freebayes_variants("chr1", &text(&reference), &text(&sample));
    assert_eq!(report_calls(&rep), vec![snp], "deletions beside sample R");
    let deletions: Vec<&String> = rep.warnings.iter().filter(|w| named_deletion(w, 1).is_some()).collect();
    assert_eq!(deletions.len(), 20, "{:?}", rep.warnings);
    assert_eq!(
        rep.warnings.last().map(String::as_str),
        Some("5 more indels beside bases that are not known (5 deletions) are not listed; none of them is called.")
    );
    // and the 25 R runs before them are capped the same way
    assert_eq!(rep.warnings.len(), 20 + 1 + 20 + 1, "{:?}", rep.warnings);
    assert_eq!(rep.warnings[20], "5 more runs of bases other than A, C, G or T (5 in the sample) are not listed; no variant is called there.");
}

// ---------------------------------------------------------------------------------------------
// BG-01M6TE8J, AC5: an N run of the wrong size. An assembly gap is often filled with more N than
// the bases it stands for, so the sample holds fewer bases opposite the run than the run has N.
// Scored as a match, an N let the known bases beside such a run slide into its spare N columns
// for nothing, so a SNP near the run was hidden behind a deletion warning, or traded for a false
// deletion and a false SNP (the data seat's round-1 REJECT). Scored 0, it let the sample's bases
// opposite a run of the right size slide off it onto a real deletion beside it (D0068). Both
// families are probed here against their planted truth, aligned in one piece and in segments.
// ---------------------------------------------------------------------------------------------

/// splitmix64, the generator the data seat's probe drew its families with.
struct SplitMix(u64);

impl SplitMix {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.0;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^ (z >> 31)
    }

    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }

    fn bases(&mut self, n: usize) -> Vec<u8> {
        (0..n).map(|_| b"ACGT"[self.below(4)]).collect()
    }

    /// A base other than `b`.
    fn other(&mut self, b: u8) -> u8 {
        loop {
            let c = b"ACGT"[self.below(4)];
            if c != b {
                return c;
            }
        }
    }
}

/// A gap probe's genome length, and the 10 genome bases its reference's N run stands for (0-based).
const GAP_GENOME_BP: usize = 1_400;
const GAP_TRUE: std::ops::Range<usize> = 600..610;
/// The genome bases a gap probe's sample copies (0-based).
const GAP_SAMPLE: std::ops::Range<usize> = 100..1_300;
/// A control SNP in every gap probe, 540 bases past the run: genome base 1,151.
const GAP_CONTROL_AT: usize = 1_150;
/// How far from the run (in known bases between them) a SNP is always called (AC5).
const GAP_CALLED_FROM: usize = 5;

/// What a gap probe changes in the sample, `k` or `gap` known bases from the run on one side of it.
#[derive(Clone, Copy, Debug)]
enum GapEdit {
    Snp { after: bool, k: usize },
    Del { after: bool, gap: usize, len: usize },
}

/// One planted variant, in the reference's own numbering.
enum Truth {
    /// A SNP's call, and whether it must be called (at least [`GAP_CALLED_FROM`] bases from the run).
    Snp(Call, bool),
    /// A deletion: its call at its VCF placement (as far left as it moves without changing a base;
    /// an N equals no base, so it stops at the run), and the 1-based reference bases from that
    /// placement's first to the planted deletion's last.
    Del(Call, usize, usize),
}

struct GapProbe {
    label: String,
    reference: Vec<u8>,
    sample: Vec<u8>,
    /// The run's first and last N, 1-based.
    run: (usize, usize),
    truth: Vec<Truth>,
}

/// A probe drawn from `rng`: a genome of [`GAP_GENOME_BP`] bases; the reference is the genome with
/// its 10 bases [`GAP_TRUE`] replaced by `run_n` N; the sample is the genome's [`GAP_SAMPLE`] bases,
/// all 10 true bases among them, with `edit` made and the control SNP. 13, 15 or 20 N stand for 10
/// bases as an assembly gap of the wrong size does; 10 N is a run of the right size.
fn gap_probe(rng: &mut SplitMix, run_n: usize, edit: GapEdit) -> GapProbe {
    let g = rng.bases(GAP_GENOME_BP);
    let mut reference = g[..GAP_TRUE.start].to_vec();
    reference.extend(std::iter::repeat_n(b'N', run_n));
    reference.extend_from_slice(&g[GAP_TRUE.end..]);
    // the 1-based reference number of genome base `i` outside the run
    let at = |i: usize| if i < GAP_TRUE.start { i + 1 } else { i + 1 + run_n - GAP_TRUE.len() };
    let snp_call = |i: usize, alt: u8| (at(i), text(&g[i..i + 1]), text(&[alt]), "SNP".to_string());
    let mut sample_g = g.clone();
    let mut truth = Vec::new();
    let mut deleted = 0..0;
    let label = match edit {
        GapEdit::Snp { after, k } => {
            let i = if after { GAP_TRUE.end + k } else { GAP_TRUE.start - 1 - k };
            let alt = rng.other(g[i]);
            sample_g[i] = alt;
            truth.push(Truth::Snp(snp_call(i, alt), k >= GAP_CALLED_FROM));
            format!("{run_n} N, SNP {k} bases {}", if after { "after" } else { "before" })
        }
        GapEdit::Del { after, gap, len } => {
            let first = if after { GAP_TRUE.end + gap } else { GAP_TRUE.start - gap - len };
            deleted = first..first + len;
            let mut s = first;
            while !GAP_TRUE.contains(&(s - 1)) && g[s - 1] == g[s + len - 1] {
                s -= 1;
            }
            let call = (at(s - 1), text(&g[s - 1..s + len]), text(&g[s - 1..s]), "DEL".to_string());
            truth.push(Truth::Del(call, at(s), at(first + len - 1)));
            format!("{run_n} N, {len}-bp deletion {gap} bases {}", if after { "after" } else { "before" })
        }
    };
    let control = rng.other(g[GAP_CONTROL_AT]);
    sample_g[GAP_CONTROL_AT] = control;
    truth.push(Truth::Snp(snp_call(GAP_CONTROL_AT, control), true));
    let sample = GAP_SAMPLE.filter(|i| !deleted.contains(i)).map(|i| sample_g[i]).collect();
    GapProbe { label, reference, sample, run: (GAP_TRUE.start + 1, GAP_TRUE.start + run_n), truth }
}

/// The reference bases each warning for an indel left out beside unknown bases names: (first, last)
/// for a deletion, (after, before) for an insertion.
fn left_out_spans(rep: &FreeBayesVariantReport) -> Vec<(usize, usize)> {
    rep.warnings
        .iter()
        .filter_map(|w| {
            let len: usize = w.strip_prefix("A ")?.split_once("-bp ")?.0.parse().ok()?;
            named_deletion(w, len).or_else(|| named_insertion(w, len))
        })
        .collect()
}

/// How a report reads against its probe's planted truth: `Ok(true)` when it calls every planted
/// variant, `Ok(false)` when it leaves one out with a warning naming reference bases that hold it,
/// and `Err` naming what is wrong: a call the truth does not hold, a variant neither called nor
/// covered by such a warning, a SNP [`GAP_CALLED_FROM`] or more bases from the run not called, or a
/// warning for an indel left out that names reference bases neither in nor next to the run, though
/// the run is what the indel may lie against.
fn read_against_truth(p: &GapProbe, rep: &FreeBayesVariantReport) -> Result<bool, String> {
    let calls = report_calls(rep);
    let spans = left_out_spans(rep);
    let planted = |t: &Truth| match t {
        Truth::Snp(c, _) | Truth::Del(c, ..) => c.clone(),
    };
    let mut all_called = true;
    let mut wrong: Vec<String> = spans
        .iter()
        .filter(|&&(a, b)| a > p.run.1 + 1 || b + 1 < p.run.0)
        .map(|(a, b)| format!("a warning names {a}-{b}, apart from the run"))
        .collect();
    for t in &p.truth {
        if calls.contains(&planted(t)) {
            continue;
        }
        all_called = false;
        let covered = match t {
            Truth::Snp(c, must) => !must && spans.iter().any(|&(a, b)| a <= c.0 && c.0 <= b),
            Truth::Del(_, first, last) => spans.iter().any(|&(a, b)| a <= *first && *last <= b),
        };
        if !covered {
            wrong.push(format!("missed {:?}", planted(t)));
        }
    }
    for c in calls.iter().filter(|c| !p.truth.iter().any(|t| planted(t) == **c)) {
        wrong.push(format!("false {c:?}"));
    }
    if wrong.is_empty() {
        Ok(all_called)
    } else {
        Err(format!("{}; warnings {:?}", wrong.join(", "), rep.warnings))
    }
}

#[test]
fn no_false_call_beside_an_n_run_longer_than_its_bases() {
    // Every probe is drawn from one seed. The SNP probes: 10 true bases under a run of 13, 15 or 20
    // N (too long) or of 10 N (the right size), and a SNP 0-30 known bases before or after the run.
    // The deletion probes (AC2's family, D0068): 10 N for 10 bases, and a 1-10 bp deletion 0-30
    // bases before or after the run. Each report is right (every planted variant called), left out
    // (one not called, and a warning names reference bases that hold it), or wrong. None may be
    // wrong, and every SNP 5 or more bases from the run is called.
    let mut rng = SplitMix(0x0AC5_06A9);
    let mut probes = Vec::new();
    for run_n in [13, 15, 20, 10] {
        for after in [false, true] {
            for k in 0..=30 {
                probes.push(gap_probe(&mut rng, run_n, GapEdit::Snp { after, k }));
            }
        }
    }
    for after in [false, true] {
        for gap in 0..=30 {
            let len = 1 + rng.below(10);
            probes.push(gap_probe(&mut rng, 10, GapEdit::Del { after, gap, len }));
        }
    }
    // Two more, each drawn from its own seed: a 7-bp deletion 1 base before the run and a 4-bp one
    // 1 base after it, where enough of the run's sample bases happen to equal the bases they would
    // face, were the deletion moved into the run, that the known bases alone score it higher there,
    // with a SNP beside it that is not there. The caller moves an indel to such a placement only
    // where the alignment scores it no lower.
    for (seed, after, len) in [(6, false, 7), (67, true, 4)] {
        probes.push(gap_probe(&mut SplitMix(seed), 10, GapEdit::Del { after, gap: 1, len }));
    }
    let (mut right, mut left_out, mut wrong) = (0, 0, Vec::new());
    for p in &probes {
        for (path, rep) in both_paths(&p.reference, &p.sample) {
            match read_against_truth(p, &rep) {
                Ok(true) => right += 1,
                Ok(false) => left_out += 1,
                Err(e) => wrong.push(format!("{}, {path}: {e}", p.label)),
            }
        }
    }
    assert!(
        wrong.is_empty(),
        "{} of {} reports wrong ({right} right, {left_out} left out):\n{}",
        wrong.len(),
        2 * probes.len(),
        wrong.join("\n")
    );
    // the probes reach both outcomes a run can give: called, and left out beside it
    assert!(right > 0 && left_out > 0, "fixture: {right} right, {left_out} left out");
}

// ---------------------------------------------------------------------------------------------
// BG-01M6VMNF: above the 100,000-base cap, a run of N about as long as the anchored sample beside
// it gave thousands of false calls: 7,393 for the first sample below at c52da78, a 101,000-bp sample
// whose 30,000 N stand for 28,000 bases, where Sprint 4's caller (ae2c162) made 1 call on such a
// sample (it removed the N first). The 11-mer chain the segments band along did not reach past the
// run: rust-bio's sdpkpp charges a gap 2 a base of its longer side, so crossing 30,000 N cost more
// than the 30,000 anchored bases after them (once the cap cut the sample's last 1,000) scored, and
// the chain ended at the run. The pieces after it were then cut on the diagonal of the end of both
// sequences, which the cap, or the window's 200-base flank, puts off the sample's own diagonal, so
// every base after the run was aligned off by that much. Where the stretch before the run is the
// shorter, the chain began after the run, and the bases before it were aligned on the diagonal of
// the bases after it.
// ---------------------------------------------------------------------------------------------

/// One stretch of a sample over the cap, in order.
enum Piece {
    /// genome bases copied, with a planted SNP every [`CAP_SNP_EVERY`] bases inside them
    Copy(std::ops::Range<usize>),
    /// a run of this many N
    N(usize),
    /// bases inserted after the genome base before them
    Ins(Vec<u8>),
}

/// How far apart the planted SNPs lie, and how far each lies from the ends of the stretch copied
/// and from the cap's cut.
const CAP_SNP_EVERY: usize = 1_009;
const CAP_SNP_CLEAR: usize = 300;

/// A pair over the cap: the reference, the sample, and the calls the caller must make, those of the
/// planted variants in the sample's first 100,000 bases (the part it aligns).
struct CapPair {
    label: String,
    reference: Vec<u8>,
    sample: Vec<u8>,
    truth: Vec<Call>,
}

impl CapPair {
    /// A sample made of `pieces` of `genome` against `reference` (the genome, or the genome with a run
    /// of N). Each copied stretch carries the transition of every [`CAP_SNP_EVERY`]th base at least
    /// [`CAP_SNP_CLEAR`] bases inside it and from the cap's cut, opposite a known reference base.
    fn new(label: &str, genome: &[u8], reference: Vec<u8>, pieces: &[Piece]) -> CapPair {
        let (mut sample, mut truth, mut copied_to) = (Vec::new(), Vec::new(), 0usize);
        for p in pieces {
            match p {
                Piece::Copy(r) => {
                    for i in r.clone() {
                        let s = sample.len();
                        let inside = i >= r.start + CAP_SNP_CLEAR && i + CAP_SNP_CLEAR < r.end && s + CAP_SNP_CLEAR < ALIGNED_CAP_BP;
                        if inside && i % CAP_SNP_EVERY == 0 && reference[i] == genome[i] {
                            let alt = transition(genome[i]);
                            sample.push(alt);
                            truth.push((i + 1, text(&genome[i..i + 1]), text(&[alt]), "SNP".to_string()));
                        } else {
                            sample.push(genome[i]);
                        }
                    }
                    copied_to = r.end;
                }
                Piece::N(n) => sample.extend(std::iter::repeat_n(b'N', *n)),
                Piece::Ins(b) => {
                    assert!(sample.len() + b.len() + CAP_SNP_CLEAR < ALIGNED_CAP_BP, "{label}: fixture");
                    let anchor = &genome[copied_to - 1..copied_to];
                    truth.push((copied_to, text(anchor), text(&[anchor, &b[..]].concat()), "INS".to_string()));
                    sample.extend_from_slice(b);
                }
            }
        }
        assert!(sample.len() > ALIGNED_CAP_BP, "{label}: fixture within the cap");
        assert!(truth.len() > 50, "{label}: fixture: {} planted", truth.len());
        truth.sort();
        CapPair { label: label.to_string(), reference, sample, truth }
    }

    /// The report through each of the caller's entry points, labelled: the one the studio calls,
    /// and the one that aligns in segments whatever the sample's length. Above the cap the one-shot
    /// alignment's traceback (2 x 100,001 x about 100,000 bytes) is far past its 256 MiB limit, so
    /// both align in segments.
    fn reports(&self) -> Vec<(String, FreeBayesVariantReport)> {
        let (reference, sample) = (text(&self.reference), text(&self.sample));
        std::thread::scope(|s| {
            let runs = [
                ("as called", s.spawn(|| call_freebayes_variants("chr1", &reference, &sample))),
                ("in segments", s.spawn(|| call_freebayes_variants_with_one_shot_limit("chr1", &reference, &sample, 0))),
            ];
            runs.into_iter().map(|(path, h)| (format!("{}, {path}", self.label), h.join().unwrap())).collect()
        })
    }

    /// Every call a report makes that the truth does not hold (the first five, then how many), and
    /// every true call it misses.
    fn wrong_calls(&self, rep: &FreeBayesVariantReport) -> Vec<String> {
        let mut calls = report_calls(rep);
        calls.sort();
        let false_calls: Vec<&Call> = calls.iter().filter(|c| !self.truth.contains(c)).collect();
        let mut wrong: Vec<String> = false_calls.iter().take(5).map(|c| format!("false {c:?}")).collect();
        if false_calls.len() > 5 {
            wrong.push(format!("{} false calls in all", false_calls.len()));
        }
        wrong.extend(self.truth.iter().filter(|c| !calls.contains(c)).take(5).map(|c| format!("missed {c:?}")));
        wrong
    }
}

/// The warnings for indels left out beside unknown bases.
fn left_out_warnings(rep: &FreeBayesVariantReport) -> Vec<&String> {
    rep.warnings.iter().filter(|w| w.ends_with("lies beside bases that are not known and is not called.")).collect()
}

/// Whether an insertion named between reference bases `after` and `next` may lie anywhere among
/// the `stands_for` bases after genome base `before` that a run of N stands for, and reaches no
/// further past them than its own length (`surplus`, the N the run holds past those bases) and 100
/// bases: an insertion of N fits opposite any known base, so the caller's warning names every
/// placement up to its own length into either flank, none of which pairs a known base with a
/// different one.
fn covers_the_run(after: usize, next: usize, before: usize, stands_for: usize, surplus: usize) -> bool {
    let first_after = before + stands_for + 1;
    after <= before && next >= first_after && after + surplus + 100 >= before && next <= first_after + surplus + 100
}

#[test]
fn no_false_calls_beside_a_long_wrong_sized_n_run_over_the_cap() {
    // 101,000-bp samples: genome bases 1-40,000, then 30,000 N standing for the next 28,000 (or
    // 20,000) genome bases, then the rest; and one with 25,000 bases before such a run, so that the
    // bases before it are the shorter stretch and the bases after it the one the chain keeps. A SNP
    // every 1,009 bases outside the run is the only truth: the run's surplus of N is an insertion
    // beside bases that are not known, never called, and named once as one insertion of its length.
    let mut rng = SplitMix(0x0B6F_A11F);
    let mut pairs: Vec<(CapPair, usize, usize)> = [(40_000usize, 28_000usize), (40_000, 20_000), (25_000, 28_000)]
        .iter()
        .map(|&(before, stands_for)| {
            let g = rng.bases(101_000 - 30_000 + stands_for);
            let pieces = [Piece::Copy(0..before), Piece::N(30_000), Piece::Copy(before + stands_for..g.len())];
            let label = format!("{} bases, then 30,000 N for {} bases", thousands(before), thousands(stands_for));
            (CapPair::new(&label, &g, g.clone(), &pieces), before, stands_for)
        })
        .collect();
    // H11 (BG-01M6VZXE AC1): 101,000-bp sample, 65 kb head, 30,000 N for 20,000, 6 kb tail, and a
    // 97%-identical 300-bp copy of the tail's start at reference 95,001 (inside the caller's window).
    let mut h11_rng = SplitMix(0x4832_0011);
    let mut h11_g = h11_rng.bases(101_000);
    let tail_start: Vec<u8> = h11_g[85_000..85_300].to_vec();
    for (j, &b) in tail_start.iter().enumerate() {
        h11_g[95_000 + j] = if j % 33 == 16 { h11_rng.other(b) } else { b };
    }
    pairs.push((
        CapPair::new(
            "H11 65,000 bases, 30,000 N for 20,000, 97% 300-bp tail copy at 95,001",
            &h11_g,
            h11_g.clone(),
            &[Piece::Copy(0..65_000), Piece::N(30_000), Piece::Copy(85_000..91_000)],
        ),
        65_000,
        20_000,
    ));
    let mut wrong = Vec::new();
    for (p, before, stands_for) in &pairs {
        for (label, rep) in p.reports() {
            let mut errors = p.wrong_calls(&rep);
            let run = format!("The sample holds 30,000 N at {}-{}; no variant is called there.", thousands(before + 1), thousands(before + 30_000));
            if !rep.warnings.contains(&run) {
                errors.push(format!("no run warning {run:?}"));
            }
            let surplus = 30_000 - stands_for;
            let named = match left_out_warnings(&rep)[..] {
                [one] => named_insertion(one, surplus),
                _ => None,
            };
            if !named.is_some_and(|(after, next)| covers_the_run(after, next, *before, *stands_for, surplus)) {
                errors.push(format!("the surplus is not named once over the run: {:?}", left_out_warnings(&rep)));
            }
            if !errors.is_empty() {
                wrong.push(format!("{label}: {} calls; {}", rep.total_variants, errors.join(", ")));
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn right_sized_long_n_run_over_the_cap_calls_only_true_snps() {
    // A 101,000-bp genome with its bases 40,001-70,000 made N, in the sample (the reference whole)
    // and in the reference (the sample whole), and one whose last 35,000 bases are N in the sample:
    // each run stands for as many bases as it holds, so there is no indel at all, and the true SNPs
    // every 1,009 bases outside the run are the only calls, each at its own coordinate. The chain
    // did not reach past the run in the first two either, and the window's 200-base flank put the
    // pieces after it 200 bases off: 26 and 50 false calls at c52da78. In the third no chain 11-mer
    // follows the run, and the pieces cut on the diagonal of the end of both sequences named a
    // 200-bp deletion that is not there.
    let mut rng = SplitMix(0x0B6F_A12F);
    let g = rng.bases(101_000);
    let mut with_run = g.clone();
    with_run[40_000..70_000].fill(b'N');
    let pairs = [
        ("sample", "40,001-70,000", CapPair::new("30,000 N in the sample", &g, g.clone(), &[Piece::Copy(0..40_000), Piece::N(30_000), Piece::Copy(70_000..101_000)])),
        ("reference", "40,001-70,000", CapPair::new("30,000 N in the reference", &g, with_run, &[Piece::Copy(0..101_000)])),
        ("sample", "66,001-100,000", CapPair::new("the sample's last 35,000 bases N", &g, g.clone(), &[Piece::Copy(0..66_000), Piece::N(35_000)])),
    ];
    let mut wrong = Vec::new();
    for (whose, at, p) in &pairs {
        let n = if p.label.starts_with("the sample's last") { "34,000" } else { "30,000" };
        for (label, rep) in p.reports() {
            let mut errors = p.wrong_calls(&rep);
            // and no indel is left out: the warnings are the cap's and the run's only
            let run = format!("The {whose} holds {n} N at {at}; no variant is called there.");
            if rep.warnings.len() != 2 || rep.warnings[1] != run {
                errors.push(format!("warnings {:?}", rep.warnings));
            }
            if !errors.is_empty() {
                wrong.push(format!("{label}: {} calls; {}", rep.total_variants, errors.join(", ")));
            }
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn over_the_cap_indels_are_kept_and_their_warnings_merged() {
    // 1. A 105,000-bp sample with 10,000 bases inserted after genome base 50,000 and no N: the one
    // insertion is called where it lies, with the true SNPs, and the cap's is the only warning.
    let mut rng = SplitMix(0x0B6F_A13F);
    let g = rng.bases(95_000);
    let mut ins = rng.bases(10_000);
    // so it cannot slide: its first base differs from the genome base after it, its last from the one before
    ins[0] = rng.other(g[50_000]);
    ins[9_999] = rng.other(g[49_999]);
    let insertion = CapPair::new("10,000-bp insertion", &g, g.clone(), &[Piece::Copy(0..50_000), Piece::Ins(ins), Piece::Copy(50_000..95_000)]);
    assert!(insertion.truth.iter().any(|c| c.3 == "INS"), "fixture");
    let mut wrong = Vec::new();
    for (label, rep) in insertion.reports() {
        let errors = insertion.wrong_calls(&rep);
        if !errors.is_empty() || rep.warnings.len() != 1 {
            wrong.push(format!("{label}: {}; warnings {:?}", errors.join(", "), rep.warnings));
        }
    }

    // 2. 12,000 N standing for the 2,000 genome bases 40,001-42,000 in a 105,000-bp sample: a net
    // insertion of 10,000 bases beside the run, which is not called. The band from the last chain
    // 11-mer before the run to the first after it is a line of slope 6, so the alignment holds the
    // insertion as a staircase of insertions between pairings of N with reference bases, and each
    // step was named as an insertion of its own: twelve sentences (eleven of about 900 bases) for
    // one event at c52da78. It is named once, with its whole length and the reference bases it may
    // lie between.
    let g = rng.bases(95_000);
    let beside = CapPair::new("12,000 N for 2,000 bases", &g, g.clone(), &[Piece::Copy(0..40_000), Piece::N(12_000), Piece::Copy(42_000..95_000)]);
    for (label, rep) in beside.reports() {
        let errors = beside.wrong_calls(&rep);
        let left_out = left_out_warnings(&rep);
        let named = match left_out[..] {
            [one] => named_insertion(one, 10_000),
            _ => None,
        };
        let whole = named.is_some_and(|(after, next)| covers_the_run(after, next, 40_000, 2_000, 10_000));
        if !errors.is_empty() || !whole {
            wrong.push(format!("{label}: {} {named:?}; left out {left_out:?}", errors.join(", ")));
        }
    }
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

// ---------------------------------------------------------------------------------------------
// BG-01M6VMNF AC4 / BG-01M6VZXE AC1 & AC7: the chain added past a long N run was the best chain of
// the matches beyond the run alone, with no cost for how far it lay from the chain it was added to.
// An exact repeat copy of the stretch beside the run scored as the stretch itself did, and the tie
// took the later copy. With the copy inside the bases a right-sized run stands for, or just past the
// sample's tail, the stretch was aligned on the copy: its SNPs were called at the copy's
// coordinates, and the run was named as an insertion or deletion as long as the distance to the
// copy. Conversely, charging only the diagonal shift without requiring the candidate chain to cover
// the query span of sdpkpp's own chain let a partial or near repeat copy (H1, H2, H6, H10, H11)
// capture the near end of the short stretch and strand the rest off-diagonal.
// ---------------------------------------------------------------------------------------------

/// A sample made of `pieces` of `genome` as the data seat's probe made it. Each copied stretch
/// carries a SNP every `step` genome bases, from 300 bases inside the stretch to 300 before its end
/// (and before the 100,000-bp aligned cap), each to a base drawn from `rng`; inserted bases are
/// taken as they are. Returns the sample and the calls of those SNPs.
fn repeat_probe_sample(genome: &[u8], pieces: &[Piece], step: usize, rng: &mut SplitMix) -> (Vec<u8>, Vec<Call>) {
    let (mut sample, mut truth) = (Vec::new(), Vec::new());
    for p in pieces {
        match p {
            Piece::Copy(r) => {
                let off = sample.len();
                sample.extend_from_slice(&genome[r.clone()]);
                let mut x = r.start + 300;
                while x + 300 < r.end && off + x - r.start + 300 < ALIGNED_CAP_BP {
                    let alt = rng.other(genome[x]);
                    sample[off + x - r.start] = alt;
                    truth.push((x + 1, text(&genome[x..x + 1]), text(&[alt]), "SNP".to_string()));
                    x += step;
                }
            }
            Piece::N(n) => sample.extend(std::iter::repeat_n(b'N', *n)),
            Piece::Ins(b) => sample.extend_from_slice(b),
        }
    }
    truth.sort();
    (sample, truth)
}

/// One repeat-copy fixture: the reference (holding the copy), the sample, its true SNPs, the
/// warning for the sample's N run, the indel warning expected beside the run when the run's length
/// differs from the reference bases it stands for, and whether the 200-bp deletion and insertion
/// the parent 30f90f0 called in pairs there are allowed (C4 only).
struct RepeatCopy {
    label: &'static str,
    reference: Vec<u8>,
    sample: Vec<u8>,
    truth: Vec<Call>,
    run: String,
    left_out: Option<&'static str>,
    paired_200_allowed: bool,
}

/// A run of N with a repeat copy of the shorter anchored stretch beside it in the reference:
/// - Exact copies of the whole stretch inside the bases a right-sized run stands for (C1, C5, G6),
///   before the head (C2), inside the run before the tail (C3), 3 kb past the tail in a 92 kb
///   genome (C4), or inside a surplus run's span (X2).
/// - Partial or near repeat copies beside a wrong-sized run (BG-01M6VZXE AC1): H1 (the 8 kb head's
///   last 1 kb copied at 17,001 inside a deficit run's span), H2 (an 80 kb sample, 42 kb head,
///   30,000 N for 20,000 bases, 8 kb tail, and an exact copy of the tail's first 1 kb at 72,001),
///   H11 (a 101,000-bp sample over the cap, 65 kb head, 30,000 N for 20,000 bases, 6 kb tail, and
///   a 97%-identical 300-bp copy of the tail's start at 95,001), and in H2's shape H6 (a
///   97%-identical 300-bp copy of the tail's start at 72,001) and H10 (a (CA)25 microsatellite in
///   the tail and another past it). Charging a candidate only for its diagonal shift (round 2's
///   engine, `covers` dropped) makes 1,472 to 2,267 calls a path on H2, H6, H10 and H11, of 50 to
///   69 true, and calls 7,301's SNP at 17,301 in H1.
/// - Copy-free controls in H2's and H11's shapes (H8, H12).
fn repeat_copy_fixtures() -> Vec<RepeatCopy> {
    let run = |from: usize, n: usize| format!("The sample holds {} N at {}-{}; no variant is called there.", thousands(n), thousands(from), thousands(from + n - 1));
    let mut out = Vec::new();
    // C1: an 80 kb genome, the sample's first 8 kb then 30,000 N for the next 30,000 bases, with an
    // exact copy of those 8 kb at genome bases 20,001-28,000, inside the run's span
    let mut rng = SplitMix(300);
    let mut g = rng.bases(80_000);
    let head = g[..8_000].to_vec();
    g[20_000..28_000].copy_from_slice(&head);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..8_000), Piece::N(30_000), Piece::Copy(38_000..80_000)], 2_000, &mut rng);
    out.push(RepeatCopy { label: "C1 8 kb head, its copy inside 30,000 N", reference: g, sample, truth, run: run(8_001, 30_000), left_out: None, paired_200_allowed: false });
    // C2: a 90 kb genome, the sample its bases 10,001-18,000, then 30,000 N for the next 30,000 and
    // the rest, with an exact copy of the first 8 kb at genome bases 1,001-9,000, before them
    let mut rng = SplitMix(301);
    let mut g = rng.bases(90_000);
    let head = g[10_000..18_000].to_vec();
    g[1_000..9_000].copy_from_slice(&head);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(10_000..18_000), Piece::N(30_000), Piece::Copy(48_000..90_000)], 2_000, &mut rng);
    out.push(RepeatCopy { label: "C2 8 kb head, its copy before it", reference: g, sample, truth, run: run(8_001, 30_000), left_out: None, paired_200_allowed: false });
    // C3: an 80 kb genome, a sample of its first 42 kb, 30,000 N for the next 30,000 and 8 kb more,
    // with an exact copy of those 8 kb at genome bases 55,001-63,000, inside the run's span
    let mut rng = SplitMix(302);
    let mut g = rng.bases(80_000);
    let tail = g[72_000..80_000].to_vec();
    g[55_000..63_000].copy_from_slice(&tail);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..42_000), Piece::N(30_000), Piece::Copy(72_000..80_000)], 2_000, &mut rng);
    out.push(RepeatCopy { label: "C3 8 kb tail, its copy inside 30,000 N", reference: g, sample, truth, run: run(42_001, 30_000), left_out: None, paired_200_allowed: false });
    // C4: a 92 kb genome, a sample of its first 42 kb, 30,000 N for the next 30,000 and 8 kb more,
    // with an exact copy of those 8 kb at genome bases 83,001-91,000, 3 kb past them
    let mut rng = SplitMix(303);
    let mut g = rng.bases(92_000);
    let tail = g[72_000..80_000].to_vec();
    g[83_000..91_000].copy_from_slice(&tail);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..42_000), Piece::N(30_000), Piece::Copy(72_000..80_000)], 2_000, &mut rng);
    out.push(RepeatCopy { label: "C4 8 kb tail, its copy 3 kb past it", reference: g, sample, truth, run: run(42_001, 30_000), left_out: None, paired_200_allowed: true });
    // C5: a 10 kb genome, the sample's first 1 kb then 6,000 N for the next 6,000, with an exact
    // copy of that 1 kb at genome bases 3,001-4,000, inside the run's span
    let mut rng = SplitMix(304);
    let mut g = rng.bases(10_000);
    let head = g[..1_000].to_vec();
    g[3_000..4_000].copy_from_slice(&head);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..1_000), Piece::N(6_000), Piece::Copy(7_000..10_000)], 400, &mut rng);
    out.push(RepeatCopy { label: "C5 1 kb head, its copy inside 6,000 N", reference: g, sample, truth, run: run(1_001, 6_000), left_out: None, paired_200_allowed: false });
    // G6: a 60 kb genome, the sample's first 2 kb then 12,000 N for the next 12,000, with an exact
    // copy of those 2 kb at genome bases 6,001-8,000, inside the run's span
    let mut rng = SplitMix(700 + 2_000 + 6_000);
    let mut g = rng.bases(60_000);
    let head = g[..2_000].to_vec();
    g[6_000..8_000].copy_from_slice(&head);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..2_000), Piece::N(12_000), Piece::Copy(14_000..60_000)], 500, &mut rng);
    out.push(RepeatCopy { label: "G6 2 kb head, its copy inside 12,000 N", reference: g, sample, truth, run: run(2_001, 12_000), left_out: None, paired_200_allowed: false });
    // X2: a 70 kb genome, the sample's first 8 kb then 30,000 N for the next 20,000 bases and the
    // rest, with an exact copy of those 8 kb at genome bases 15,001-23,000, inside the run's span
    let mut rng = SplitMix(310);
    let mut g = rng.bases(70_000);
    let head = g[..8_000].to_vec();
    g[15_000..23_000].copy_from_slice(&head);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..8_000), Piece::N(30_000), Piece::Copy(28_000..70_000)], 2_000, &mut rng);
    out.push(RepeatCopy { label: "X2 8 kb head, its copy inside 30,000 N for 20,000", reference: g, sample, truth, run: run(8_001, 30_000), left_out: Some("A 10000-bp insertion"), paired_200_allowed: false });
    // H1 (BG-01M6VZXE AC1): an 80 kb genome, 8 kb head, 20,000 N for 30,000 bases (deficit run),
    // 42 kb tail at 38,001-80,000, and an exact copy of the head's last 1 kb at 17,001-18,000
    let mut rng = SplitMix(0x4832_0001);
    let mut g = rng.bases(80_000);
    let head_last_1k = g[7_000..8_000].to_vec();
    g[17_000..18_000].copy_from_slice(&head_last_1k);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..8_000), Piece::N(20_000), Piece::Copy(38_000..80_000)], 1_000, &mut rng);
    out.push(RepeatCopy { label: "H1 8 kb head, exact copy of its last 1 kb at 17,001 in a deficit run", reference: g, sample, truth, run: run(8_001, 20_000), left_out: Some("A 10000-bp deletion"), paired_200_allowed: false });
    // H2 (BG-01M6VZXE AC1): an 80 kb genome, 42 kb head, 30,000 N for 20,000 bases, 8 kb tail at
    // 62,001-70,000, and an exact copy of the tail's first 1 kb at 72,001-73,000
    let mut rng = SplitMix(0x4832_0002);
    let mut g = rng.bases(80_000);
    let tail_1k = g[62_000..63_000].to_vec();
    g[72_000..73_000].copy_from_slice(&tail_1k);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..42_000), Piece::N(30_000), Piece::Copy(62_000..70_000)], 1_009, &mut rng);
    out.push(RepeatCopy { label: "H2 8 kb tail, exact copy of its first 1 kb at 72,001", reference: g, sample, truth, run: run(42_001, 30_000), left_out: Some("A 10000-bp insertion"), paired_200_allowed: false });
    // H11 (BG-01M6VZXE AC1): a 101,000-bp genome and sample over the cap, 65 kb head, 30,000 N for
    // 20,000 bases, 6 kb tail at 85,001-91,000, and a 97%-identical 300-bp copy of the tail's
    // start at 95,001-95,300
    let mut rng = SplitMix(0x4832_0011);
    let mut g = rng.bases(101_000);
    let tail_300 = g[85_000..85_300].to_vec();
    for (j, &b) in tail_300.iter().enumerate() {
        g[95_000 + j] = if j % 33 == 16 { rng.other(b) } else { b };
    }
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..65_000), Piece::N(30_000), Piece::Copy(85_000..91_000)], 1_009, &mut rng);
    out.push(RepeatCopy { label: "H11 6 kb tail over the cap, 97% 300-bp copy at 95,001", reference: g, sample, truth, run: run(65_001, 30_000), left_out: Some("A 10000-bp insertion"), paired_200_allowed: false });
    // H2's shape (80 kb genome, 42 kb head, 30,000 N for 20,000 bases, 8 kb tail at 62,001-70,000;
    // the caller's window reaches 10,000 bases past the tail), with a change made to its genome
    let h2_shape = |label: &'static str, seed: u64, change: &dyn Fn(&mut Vec<u8>, &mut SplitMix)| {
        let mut rng = SplitMix(seed);
        let mut g = rng.bases(80_000);
        change(&mut g, &mut rng);
        let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..42_000), Piece::N(30_000), Piece::Copy(62_000..70_000)], 1_009, &mut rng);
        RepeatCopy { label, reference: g, sample, truth, run: run(42_001, 30_000), left_out: Some("A 10000-bp insertion"), paired_200_allowed: false }
    };
    // H6 (BG-01M6VMNF round 2): H2's shape with a 97%-identical copy of the tail's first 300 bp at
    // 72,001-72,300 (every 33rd base changed), an Alu-like near copy where H2's is exact
    out.push(h2_shape("H6 8 kb tail, 97% 300-bp copy of its start at 72,001", 0x4832_0006, &|g, rng| {
        for j in 0..300 {
            g[72_000 + j] = if j % 33 == 16 { rng.other(g[62_000 + j]) } else { g[62_000 + j] };
        }
    }));
    // H10 (BG-01M6VMNF round 2): H2's shape with a (CA)25 microsatellite at 62,501 (inside the
    // tail) and another at 72,501 (in the window past it); charged only for its diagonal shift, the
    // engine called a 10,000-bp deletion at 62,498 here, where the sample holds none
    out.push(h2_shape("H10 8 kb tail, (CA)25 at 62,501 and 72,501", 0x4832_0010, &|g, _| {
        for at in [62_500, 72_500] {
            for j in 0..25 {
                g[at + 2 * j] = b'C';
                g[at + 2 * j + 1] = b'A';
            }
        }
    }));
    // H8 and H12, the copy-free controls: H2's and H11's shapes with no repeat at all
    out.push(h2_shape("H8 8 kb tail, no copy (control)", 0x4832_0008, &|_, _| {}));
    let mut rng = SplitMix(0x4832_0012);
    let g = rng.bases(101_000);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..65_000), Piece::N(30_000), Piece::Copy(85_000..91_000)], 1_009, &mut rng);
    out.push(RepeatCopy { label: "H12 6 kb tail over the cap, no copy (control)", reference: g, sample, truth, run: run(65_001, 30_000), left_out: Some("A 10000-bp insertion"), paired_200_allowed: false });
    out
}

/// Whether a call is a deletion or an insertion of exactly 200 bases, and which.
fn indel_of_200(c: &Call) -> Option<&'static str> {
    match c.3.as_str() {
        "DEL" if c.1.len() == 201 && c.2.len() == 1 => Some("DEL"),
        "INS" if c.1.len() == 1 && c.2.len() == 201 => Some("INS"),
        _ => None,
    }
}

#[test]
fn an_exact_repeat_copy_does_not_capture_a_short_anchored_stretch() {
    // Every true SNP is called at its own coordinate, no other call is made (no SNP at the copy, and
    // no insertion or deletion: the sample holds none), and no indel is named as left out beside
    // the run but the run's own surplus or deficit (in X2, H1, H2 and H11), once, as an indel of
    // that length. In C4 the 200-bp deletion and insertion the parent called in pairs there are
    // allowed, and an indel of any other length is not (round 1 named an 11,000-bp deletion, the
    // distance to the copy).
    let mut wrong = Vec::new();
    for f in repeat_copy_fixtures() {
        let (reference, sample) = (text(&f.reference), text(&f.sample));
        let reports = std::thread::scope(|s| {
            let runs = [
                ("as called", s.spawn(|| call_freebayes_variants("chr1", &reference, &sample))),
                ("in segments", s.spawn(|| call_freebayes_variants_with_one_shot_limit("chr1", &reference, &sample, 0))),
            ];
            runs.map(|(path, h)| (path, h.join().unwrap()))
        });
        for (path, rep) in reports {
            let mut calls = report_calls(&rep);
            calls.sort();
            let paired: Vec<&'static str> = calls.iter().filter_map(indel_of_200).collect();
            let allowed = |c: &Call| f.paired_200_allowed && indel_of_200(c).is_some();
            let mut errors: Vec<String> = calls.iter().filter(|c| !f.truth.contains(c) && !allowed(c)).take(5).map(|c| format!("false {c:?}")).collect();
            errors.extend(f.truth.iter().filter(|c| !calls.contains(c)).take(5).map(|c| format!("missed {c:?}")));
            if f.paired_200_allowed && paired.iter().filter(|&&k| k == "DEL").count() != paired.iter().filter(|&&k| k == "INS").count() {
                errors.push(format!("200-bp indels not in pairs: {paired:?}"));
            }
            if !rep.warnings.contains(&f.run) {
                errors.push(format!("no run warning {:?}", f.run));
            }
            let named: Vec<&String> = left_out_warnings(&rep)
                .into_iter()
                .filter(|w| !(f.paired_200_allowed && (named_deletion(w, 200).is_some() || named_insertion(w, 200).is_some())))
                .collect();
            let named_right = match (named.as_slice(), f.left_out) {
                ([], None) => true,
                ([one], Some(prefix)) => one.starts_with(prefix),
                _ => false,
            };
            if !named_right {
                errors.push(format!("named as left out {named:?}"));
            }
            if !errors.is_empty() {
                wrong.push(format!("{}, {path}: {} calls, {} true; {}", f.label, rep.total_variants, f.truth.len(), errors.join(", ")));
            }
        }
    }

    // The floor a chain of the matches past the chain's ends must reach to be added (32 matched
    // bases) keeps chance 11-mer matches out, both as the chain added and as one chosen over it.
    // The data seat's E1: 2,000 unrelated bases, then genome bases 30,001-90,000 of a 150 kb genome.
    // With no floor, a chain of chance matches put the unrelated bases 13 kb before the bases the
    // sample copies, called there as a 1,722-bp insertion at 16,839. With it, every call lies
    // within those 2,000 bases and the window's 200-base flank before them. (The unrelated bases
    // are still compared base by base with the flank, which makes about 600 false calls there;
    // that is filed apart from this unit.)
    let mut rng = SplitMix(500);
    let g = rng.bases(150_000);
    let unrelated = rng.bases(2_000);
    let (sample, _) = repeat_probe_sample(&g, &[Piece::Ins(unrelated), Piece::Copy(30_000..90_000)], 2_500, &mut rng);
    let rep = call_freebayes_variants("chr1", &text(&g), &text(&sample));
    let far: Vec<Call> = report_calls(&rep).into_iter().filter(|c| c.0 <= 30_000 - 2_000 - 200).take(3).collect();
    wrong.extend((!far.is_empty()).then(|| format!("E1 2,000 unrelated bases before 30,001: calls before 27,801 {far:?}")));
    // The data seat's F probe of 800 bases, 7,000 N for the next 9,500 and 2,000 more, in
    // segments: the 2,500-base deletion the run hides costs more than the 800 bases before it
    // score, so a chance match near the chain's diagonal, scored with no floor, was chosen over
    // them, and 153 false calls were made. With the floor the true SNPs are the only calls.
    let mut rng = SplitMix(606);
    let g = rng.bases(800 + 9_500 + 2_000 + 500);
    let (sample, truth) = repeat_probe_sample(&g, &[Piece::Copy(0..800), Piece::N(7_000), Piece::Copy(10_300..12_300)], 350, &mut rng);
    let rep = call_freebayes_variants_with_one_shot_limit("chr1", &text(&g), &text(&sample), 0);
    let mut calls = report_calls(&rep);
    calls.sort();
    wrong.extend((calls != truth).then(|| format!("F 800 bases, 7,000 N for 9,500, in segments: {} calls, {} true", calls.len(), truth.len())));
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}


// ---------------------------------------------------------------------------------------------
// BG-01M6W02V: the data seat's findings on BG-01M6TE8J's round 2. Beside a 10-N run a 4- or 7-bp
// deletion 0-2 bases away still gave a false call on a few draws; beside a run of more N than the
// bases it stands for, a deletion a few bases away was merged with the run's spare N and named as
// one deletion of both lengths; the leave-out check's tie arm (a placement the known bases score
// equal) was untested; and with N at the same columns of both sequences, a left-out deletion was
// named over bases that missed it.
// ---------------------------------------------------------------------------------------------

/// The caller's alignment score for a column pair (BG-01M6W02V, D0268): match 2, mismatch -3, and 1
/// where either base is not A, C, G or T; a gap of n bases scores -5 - 2n.
fn d0268_score(a: u8, b: u8) -> i32 {
    let known = |c: u8| matches!(c, b'A' | b'C' | b'G' | b'T');
    if !known(a) || !known(b) {
        1
    } else if a == b {
        2
    } else {
        -3
    }
}

/// The score of a gap probe's true reading under [`d0268_score`]: every sample base paired with the
/// reference base it was copied from, the planted deletion's bases deleted, and the N a run holds
/// past the bases it stands for deleted at the end of the run nearer the deletion (where a deletion
/// touching the run then joins them, as one gap).
fn true_reading_score(p: &GapProbe) -> i32 {
    let (del_from, del_len) = p
        .truth
        .iter()
        .find_map(|t| match t {
            Truth::Del(c, ..) => Some((c.0 + 1, c.1.len() - 1)),
            Truth::Snp(..) => None,
        })
        .unwrap_or((0, 0));
    let spare = (p.run.1 + 1 - p.run.0).saturating_sub(GAP_TRUE.len());
    let after = del_from > p.run.1;
    let spare_at = if after { p.run.1 + 1 - spare..p.run.1 + 1 } else { p.run.0..p.run.0 + spare };
    let last = p.reference.len() - (GAP_GENOME_BP - GAP_SAMPLE.end);
    let (mut score, mut q, mut in_gap) = (0i32, 0usize, false);
    for r in GAP_SAMPLE.start + 1..=last {
        if (del_from..del_from + del_len).contains(&r) || spare_at.contains(&r) {
            score -= if in_gap { 2 } else { 7 };
            in_gap = true;
        } else {
            score += d0268_score(p.sample[q], p.reference[r - 1]);
            (q, in_gap) = (q + 1, false);
        }
    }
    assert_eq!(q, p.sample.len(), "{}: the true reading pairs every sample base", p.label);
    score
}

/// The best score any reading of the probe's sample against its reference reaches under
/// [`d0268_score`]: the whole sample aligned, the reference's flanks free, as the caller aligns it.
fn best_reading_score(p: &GapProbe) -> i32 {
    let mut aligner = bio::alignment::pairwise::Aligner::with_capacity(p.sample.len(), p.reference.len(), -5, -2, d0268_score);
    aligner.semiglobal(&p.sample, &p.reference).score
}

/// Each probe read against its truth ([`read_against_truth`]) on both paths, four probes at a time,
/// with `also` checked on each report; the reports that are wrong. Where `outscored` holds, a wrong
/// report of a probe whose best reading outscores its true one is not a defect of the caller
/// (D0268): it is returned apart, with both scores, and every other wrong report stays wrong.
fn wrong_reports(probes: &[GapProbe], also: &(dyn Fn(&GapProbe, &FreeBayesVariantReport) -> Option<String> + Sync)) -> Vec<String> {
    let (wrong, outscored) = wrong_reports_scored(probes, also, false);
    assert!(outscored.is_empty());
    wrong
}

/// [`wrong_reports`], with the reports of outscored probes apart when `excuse_outscored`.
fn wrong_reports_scored(
    probes: &[GapProbe],
    also: &(dyn Fn(&GapProbe, &FreeBayesVariantReport) -> Option<String> + Sync),
    excuse_outscored: bool,
) -> (Vec<String>, Vec<String>) {
    let chunk = probes.len().div_ceil(4).max(1);
    std::thread::scope(|s| {
        let handles: Vec<_> = probes
            .chunks(chunk)
            .map(|ps| {
                s.spawn(move || {
                    let (mut wrong, mut outscored) = (Vec::new(), Vec::new());
                    for p in ps {
                        let mut scores = None;
                        for (path, rep) in both_paths(&p.reference, &p.sample) {
                            let mut errors: Vec<String> = read_against_truth(p, &rep).err().into_iter().collect();
                            errors.extend(also(p, &rep));
                            if errors.is_empty() {
                                continue;
                            }
                            let line = format!("{}, {path}: {}", p.label, errors.join("; "));
                            let (truth, best) = *scores.get_or_insert_with(|| (true_reading_score(p), best_reading_score(p)));
                            if excuse_outscored && best > truth {
                                outscored.push(format!("{line} [true reading {truth}, best {best}]"));
                            } else {
                                wrong.push(format!("{line} [true reading {truth}, best {best}]"));
                            }
                        }
                    }
                    (wrong, outscored)
                })
            })
            .collect();
        let (mut wrong, mut outscored) = (Vec::new(), Vec::new());
        for h in handles {
            let (w, o) = h.join().unwrap();
            wrong.extend(w);
            outscored.extend(o);
        }
        (wrong, outscored)
    })
}

/// The planted deletion's reference bases, 1-based (first, last), and its length.
fn planted_deletion(p: &GapProbe) -> Option<(usize, usize, usize)> {
    p.truth.iter().find_map(|t| match t {
        Truth::Del(c, first, last) => Some((*first, *last, c.1.len() - 1)),
        Truth::Snp(..) => None,
    })
}

#[test]
fn a_short_deletion_near_a_ten_n_run_gives_no_false_call() {
    // The data seat's family F6t: a 4- or 7-bp deletion 0, 1 or 2 bases before or after a run of
    // 10 N standing for 10 bases, 250 genomes, 3,000 draws a path. No call the truth does not hold,
    // and every warning for a deletion left out beside the run names bases that cover the planted
    // one. On seed 19, a 7-bp deletion just after the run was aligned as 5 of the run's N deleted, 5
    // of the sample's bases opposite the run matched by chance to the 5 reference bases after it,
    // and a 2-bp deletion after them, which was called.
    let mut probes = Vec::new();
    for seed in 0..250 {
        for after in [false, true] {
            for gap in 0..=2 {
                for len in [4, 7] {
                    let mut p = gap_probe(&mut SplitMix(seed), 10, GapEdit::Del { after, gap, len });
                    p.label = format!("seed {seed}, {}", p.label);
                    probes.push(p);
                }
            }
        }
    }
    assert_eq!(probes.len(), 3_000, "fixture");
    let every_warning_covers = |p: &GapProbe, rep: &FreeBayesVariantReport| {
        let (first, last, _) = planted_deletion(p)?;
        let misses: Vec<(usize, usize)> = left_out_spans(rep).into_iter().filter(|&(a, b)| !(a <= first && last <= b)).collect();
        (!misses.is_empty()).then(|| format!("warnings name {misses:?}, not all of {first}-{last}"))
    };
    // A draw whose best reading outscores its true one under the alignment's own scoring is not a
    // defect of the caller (D0268): seed 89, a 7-bp deletion just after the run, where 7 of the
    // run's N deleted, 6 chance matches and a false SNP score 2 more than the truth.
    let (wrong, outscored) = wrong_reports_scored(&probes, &every_warning_covers, true);
    println!("outscored (D0268):\n{}", outscored.join("\n"));
    assert!(wrong.is_empty(), "{} of 6,000 reports wrong:\n{}", wrong.len(), wrong.join("\n"));
    assert!(outscored.len() <= 4, "outscored draws, more than the family has held:\n{}", outscored.join("\n"));
}

#[test]
fn a_deletion_beside_a_too_long_n_run_keeps_its_own_length() {
    // The data seat's family F8 at 5-7 bases from the run: a 5-, 6-, 7- or 9-bp deletion 5, 6 or 7
    // bases before or after a run of 13, 15 or 20 N standing for 10 bases, 72 draws. It is called
    // at its VCF placement, or left out with a warning naming its own length over bases that cover
    // it; no warning names a deletion of any length but its own and the run's spare N. Before
    // BG-01M6W02V, a 6-bp deletion 5 bases before 15 N was named as one 11-bp deletion: the sample
    // bases between were paired with the spare N and the two gaps were one.
    let mut probes = Vec::new();
    for run_n in [13, 15, 20] {
        for after in [false, true] {
            for gap in 5..=7 {
                for len in [5, 6, 7, 9] {
                    let seed = 0x0E02_0000 + (run_n * 1_000 + gap * 10 + len) as u64 + if after { 500 } else { 0 };
                    probes.push(gap_probe(&mut SplitMix(seed), run_n, GapEdit::Del { after, gap, len }));
                }
            }
        }
    }
    assert_eq!(probes.len(), 72, "fixture");
    let own_length = |p: &GapProbe, rep: &FreeBayesVariantReport| {
        let (first, last, len) = planted_deletion(p)?;
        let called = p.truth.iter().any(|t| matches!(t, Truth::Del(c, ..) if report_calls(rep).contains(c)));
        let spare = p.run.1 + 1 - p.run.0 - GAP_TRUE.len();
        let lengths: Vec<usize> = rep.warnings.iter().filter_map(|w| w.strip_prefix("A ")?.split_once("-bp deletion")?.0.parse().ok()).collect();
        let named = rep.warnings.iter().any(|w| named_deletion(w, len).is_some_and(|(a, b)| a <= first && last <= b));
        let mut errors = Vec::new();
        if !called && !named {
            errors.push(format!("neither called nor named as {len} bp over {first}-{last}"));
        }
        if let Some(other) = lengths.iter().find(|&&l| l != len && l != spare) {
            errors.push(format!("a {other}-bp deletion named (own {len}, spare {spare})"));
        }
        (!errors.is_empty()).then(|| errors.join(", "))
    };
    let (wrong, outscored) = wrong_reports_scored(&probes, &own_length, true);
    println!("outscored (D0268):\n{}", outscored.join("\n"));
    assert!(wrong.is_empty(), "{} of 144 reports wrong:\n{}", wrong.len(), wrong.join("\n"));
}

#[test]
fn an_equal_score_placement_against_unknown_bases_leaves_the_indel_out() {
    // A SNP just before a run of 3 N standing for 10 bases: the alignment pairs the 3 N and inserts
    // the other 7 sample bases a base or two before the run, among known bases. Moved past those
    // bases, the insertion lies against the run in a placement the known bases score exactly as
    // they score this one, so where it lies is not known, and it is left out with a warning rather
    // than called. With the tie arm taken out (`p.known > 0`), each of these 5 draws called a 7-bp
    // insertion before the run that the sample does not hold.
    let probes: Vec<GapProbe> = [1_030u64, 1_130, 1_330, 1_430, 1_530].iter().map(|&seed| gap_probe(&mut SplitMix(seed), 3, GapEdit::Snp { after: false, k: 0 })).collect();
    let left_out_insertion = |_: &GapProbe, rep: &FreeBayesVariantReport| {
        let indels: Vec<Call> = report_calls(rep).into_iter().filter(|c| c.3 != "SNP").collect();
        let warned = rep.warnings.iter().any(|w| w.starts_with("A 7-bp insertion") && w.ends_with("lies beside bases that are not known and is not called."));
        (!indels.is_empty() || !warned).then(|| format!("indels called {indels:?}; warnings {:?}", rep.warnings))
    };
    let wrong = wrong_reports(&probes, &left_out_insertion);
    assert!(wrong.is_empty(), "{}", wrong.join("\n"));
}

#[test]
fn a_left_out_deletion_beside_shared_n_columns_is_named_over_every_placement() {
    // A run of 10 N at the same columns of the reference and the sample, and a 1- to 10-bp deletion
    // 0-30 bases before or after it, 124 draws. A column of two unknown bases scores as any column
    // holding one does, so a deletion touching the run may lie on either side of it: the warning
    // names every such placement. It stopped beside the shared N, and a deletion just after the run
    // was named over the bases before it (an 8-bp deletion of 611-618 as "somewhere in reference
    // bases 593-608").
    let mut probes = Vec::new();
    for seed in 0..2u64 {
        for after in [false, true] {
            for gap in 0..=30 {
                let len = 1 + (seed as usize * 7 + gap) % 10;
                let mut p = gap_probe(&mut SplitMix(0x0E02_4000 + seed * 1_000 + gap as u64), 10, GapEdit::Del { after, gap, len });
                let sample_offset = GAP_SAMPLE.start + if after { 0 } else { len };
                for i in GAP_TRUE {
                    p.sample[i - sample_offset] = b'N';
                }
                p.label = format!("shared N, {}", p.label);
                probes.push(p);
            }
        }
    }
    let wrong = wrong_reports(&probes, &|_, _| None);
    assert!(wrong.is_empty(), "{} of {} reports wrong:\n{}", wrong.len(), 2 * probes.len(), wrong.join("\n"));
}
