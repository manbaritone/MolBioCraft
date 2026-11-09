// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Parsers validated against trace files the tests write themselves (SCF v3 and ABIF v1.01, from
//! the published Staden and Applied Biosystems layouts, over seeded chromatograms) and against
//! public reference files in the git-ignored test-data folder, with Biopython's parses as ground
//! truth, and cross-format agreement.

use molbiocraft_core::Topology;
use molbiocraft_formats::{
    compute_chromatogram_viewport, encode_abif_chromatogram_bytes, export_embl_flatfile, export_genbank_flatfile,
    parse_binary_sequence_packet, parse_embl_flatfile, parse_genbank_flatfile, trim_sanger_trace_mott_phred,
};
use std::path::{Path, PathBuf};

/// The reference-data folder: `MOLBIOCRAFT_TEST_DATA_DIR` (a relative value is read from the repo
/// root), else `<repo>/test-data`.
fn test_data_dir() -> PathBuf {
    let repo = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    match std::env::var_os("MOLBIOCRAFT_TEST_DATA_DIR") {
        Some(d) if !d.is_empty() => repo.join(d),
        _ => repo.join("test-data"),
    }
}

/// Whether `MOLBIOCRAFT_REQUIRE_TEST_DATA=1`; any value other than `1`, `0` or empty is refused
/// rather than read as "not required".
fn data_required() -> bool {
    let v = std::env::var_os("MOLBIOCRAFT_REQUIRE_TEST_DATA").unwrap_or_default();
    match v.to_str() {
        Some("1") => true,
        Some("" | "0") => false,
        _ => panic!("MOLBIOCRAFT_REQUIRE_TEST_DATA must be 1, 0 or unset, not {v:?}"),
    }
}

/// A file of the git-ignored reference-data folder, or `None` (after printing the skip line) when
/// it is absent and not required; with `MOLBIOCRAFT_REQUIRE_TEST_DATA=1` an absent file fails.
fn data_file(rel: &str) -> Option<String> {
    let required = data_required();
    let p = test_data_dir().join(rel);
    match std::fs::read_to_string(&p) {
        Ok(s) => Some(s),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
            assert!(!required, "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}", p.display());
            eprintln!("skipped: reference data absent ({})", p.display());
            None
        }
        Err(e) => panic!("{}: unreadable: {e}", p.display()),
    }
}

// ─── Trace files the tests write ───
//
// The two writers below are test code, built from the published layouts: SCF v3.00 from the
// Staden package's io_lib (`scf.h`, `write_scf.c`), ABIF v1.01 from Applied Biosystems' "ABIF File
// Format Specification". The chromatograms they write are seeded, so every run reads the same
// files.

/// A seeded chromatogram of `n` calls, the stand-in for an instrument read. Peaks lie 8 to 16
/// samples apart, drawn from the seed, so the spacing is irregular as in a real run. Each call
/// peaks in its own channel (every 97th call is an `N` that peaks in two), and the four channels
/// have different baselines and gains, so no two carry the same signal: a reader that swaps any
/// two channels returns values other than the ones written. Qualities run from Q2 to Q60.
/// Samples are whole numbers, as both formats store them.
fn seeded_chromatogram(seed: u64, n: usize) -> molbiocraft_core::ChromatogramData {
    let mut rng = Lcg(seed);
    let base_calls: String = (0..n).map(|i| if i % 97 == 50 { 'N' } else { b"ACGT"[rng.below(4)] as char }).collect();
    let mut peak_locations = Vec::with_capacity(n);
    let mut at = 12usize;
    for _ in 0..n {
        peak_locations.push(at);
        at += 8 + rng.below(9);
    }
    let len = at + 12;
    let (baseline, gain) = ([11.0, 23.0, 37.0, 53.0], [900.0, 1150.0, 700.0, 1300.0]);
    let mut traces: [Vec<f64>; 4] = [vec![], vec![], vec![], vec![]];
    for (k, trace) in traces.iter_mut().enumerate() {
        for _ in 0..len {
            trace.push(baseline[k] + rng.below(7) as f64);
        }
    }
    for (i, b) in base_calls.bytes().enumerate() {
        let channels = match b {
            b'A' => vec![0],
            b'C' => vec![1],
            b'G' => vec![2],
            b'T' => vec![3],
            _ => {
                let k = rng.below(4);
                vec![k, (k + 1 + rng.below(3)) % 4]
            }
        };
        let height = (55 + rng.below(45)) as f64 / 100.0 / channels.len() as f64;
        let p = peak_locations[i];
        for &k in &channels {
            for x in p - 8..=p + 8 {
                let d = x as f64 - p as f64;
                traces[k][x] += gain[k] * height * (-d * d / 6.0).exp();
            }
        }
    }
    let [trace_a, trace_c, trace_g, trace_t] = traces.map(|t| t.into_iter().map(f64::round).collect::<Vec<f64>>());
    molbiocraft_core::ChromatogramData {
        trace_a,
        trace_c,
        trace_g,
        trace_t,
        peak_locations,
        phred_scores: (0..n).map(|_| 2 + rng.below(59) as u8).collect(),
        base_calls,
    }
}

/// `chrom` as an SCF v3.00 file: the 128-byte header; the samples of channel A, then C, G and T,
/// as 16-bit values delta-encoded twice; the bases block (the peak indexes, the A, C, G and T
/// probability arrays, the calls, then three spare bytes per call); and a `NAME=` comment. A
/// call's quality is its own channel's probability, and all four channels' for a call other than
/// A, C, G or T.
fn scf_v3_bytes(chrom: &molbiocraft_core::ChromatogramData, name: &str) -> Vec<u8> {
    let channels = [&chrom.trace_a, &chrom.trace_c, &chrom.trace_g, &chrom.trace_t];
    let samples = chrom.trace_a.len();
    assert!(channels.iter().all(|c| c.len() == samples), "the writer takes four channels of one length");
    let calls = chrom.base_calls.as_bytes();
    let comments = format!("NAME={name}\n\0");
    let samples_offset = 128;
    let bases_offset = samples_offset + 4 * samples * 2;
    let comments_offset = bases_offset + 12 * calls.len();
    let mut out = b".scf".to_vec();
    for v in [samples, samples_offset, calls.len(), 0, 0, bases_offset, comments.len(), comments_offset] {
        out.extend((v as u32).to_be_bytes());
    }
    out.extend(b"3.00");
    for v in [2u32, 0, 0, 0] {
        // sample size (bytes), code set, private data size and offset
        out.extend(v.to_be_bytes());
    }
    out.resize(samples_offset, 0);
    for channel in channels {
        let mut v: Vec<u16> = channel.iter().map(|&x| x as u16).collect();
        for _ in 0..2 {
            let mut prev = 0u16;
            for x in v.iter_mut() {
                let here = *x;
                *x = here.wrapping_sub(prev);
                prev = here;
            }
        }
        for x in v {
            out.extend(x.to_be_bytes());
        }
    }
    for &p in &chrom.peak_locations {
        out.extend((p as u32).to_be_bytes());
    }
    for k in 0..4 {
        for (i, &b) in calls.iter().enumerate() {
            let own = b"ACGT".iter().position(|&c| c == b);
            out.push(if own.is_none() || own == Some(k) { chrom.phred_scores[i] } else { 0 });
        }
    }
    out.extend(calls);
    out.resize(comments_offset, 0);
    out.extend(comments.as_bytes());
    out
}

/// One ABIF directory entry: tag name, tag number, element type, element size, element count and
/// the data.
type AbifTag = (&'static [u8; 4], i32, i16, i16, usize, Vec<u8>);

/// Text as an ABIF `char` array (element type 2).
fn abif_chars(name: &'static [u8; 4], number: i32, text: &[u8]) -> AbifTag {
    (name, number, 2, 1, text.len(), text.to_vec())
}

/// Whole numbers as an ABIF `short` array (element type 4, big-endian).
fn abif_shorts(name: &'static [u8; 4], number: i32, values: impl IntoIterator<Item = f64>) -> AbifTag {
    let data: Vec<u8> = values.into_iter().flat_map(|v| (v as i16).to_be_bytes()).collect();
    (name, number, 4, 2, data.len() / 2, data)
}

/// Text as an ABIF `pString` (element type 18: a length byte, then the text).
fn abif_pstring(name: &'static [u8; 4], number: i32, text: &str) -> AbifTag {
    let data: Vec<u8> = std::iter::once(text.len() as u8).chain(text.bytes()).collect();
    (name, number, 18, 1, data.len(), data)
}

/// An ABIF v1.01 file holding these tags: the 128-byte header, whose `tdir` entry points at the
/// directory, then each tag's data (inside its entry when it fits in four bytes), then the
/// directory of 28-byte entries.
fn abif_file(tags: &[AbifTag]) -> Vec<u8> {
    let mut out = vec![0u8; 128];
    let mut dir = Vec::new();
    for (name, number, element_type, element_size, count, data) in tags {
        dir.extend(*name);
        dir.extend(number.to_be_bytes());
        dir.extend(element_type.to_be_bytes());
        dir.extend(element_size.to_be_bytes());
        dir.extend((*count as i32).to_be_bytes());
        dir.extend((data.len() as i32).to_be_bytes());
        if data.len() <= 4 {
            let mut inline = data.clone();
            inline.resize(4, 0);
            dir.extend(inline);
        } else {
            dir.extend((out.len() as u32).to_be_bytes());
            out.extend(data);
        }
        dir.extend(0i32.to_be_bytes()); // data handle
    }
    let dir_offset = out.len() as u32;
    out[0..4].copy_from_slice(b"ABIF");
    out[4..6].copy_from_slice(&101u16.to_be_bytes());
    out[6..10].copy_from_slice(b"tdir");
    out[10..14].copy_from_slice(&1i32.to_be_bytes());
    out[14..16].copy_from_slice(&1023i16.to_be_bytes());
    out[16..18].copy_from_slice(&28i16.to_be_bytes());
    out[18..22].copy_from_slice(&(tags.len() as i32).to_be_bytes());
    out[22..26].copy_from_slice(&(dir.len() as i32).to_be_bytes());
    out[26..30].copy_from_slice(&dir_offset.to_be_bytes());
    out.extend(dir);
    out
}

/// `doc` holds the trace `want` exactly: calls, qualities, peaks and all four channels, each by
/// name, so a channel read into the wrong slot fails on the channel it went to.
fn assert_holds_trace(label: &str, doc: &molbiocraft_core::SequenceDocument, want: &molbiocraft_core::ChromatogramData) {
    let got = doc.chromatogram.as_ref().unwrap_or_else(|| panic!("{label}: no trace read"));
    assert_eq!(doc.sequence, want.base_calls, "{label}: bases");
    assert_eq!(got.base_calls, want.base_calls, "{label}: calls");
    assert_eq!(got.phred_scores, want.phred_scores, "{label}: qualities");
    assert_eq!(got.peak_locations, want.peak_locations, "{label}: peaks");
    assert_eq!(got.trace_a, want.trace_a, "{label}: A channel");
    assert_eq!(got.trace_c, want.trace_c, "{label}: C channel");
    assert_eq!(got.trace_g, want.trace_g, "{label}: G channel");
    assert_eq!(got.trace_t, want.trace_t, "{label}: T channel");
    assert_eq!(doc.topology, Topology::Linear, "{label}: topology");
    assert_eq!(doc.document_kind.as_deref(), Some("trace"), "{label}: kind");
}

#[test]
fn abif_and_scf_traces_match_fastq_ground_truth_and_each_other() {
    // A seeded chromatogram, written as SCF v3 and as ABIF, reads back from each as written. No
    // two of its channels are equal, so an A/C/G/T order slip in either reader fails.
    let written = seeded_chromatogram(0x5CF3_0001, 420);
    let channels = [&written.trace_a, &written.trace_c, &written.trace_g, &written.trace_t];
    for i in 0..4 {
        for j in i + 1..4 {
            assert_ne!(channels[i], channels[j], "the fixture's channels {i} and {j} differ");
        }
    }
    let scf = parse_binary_sequence_packet(&scf_v3_bytes(&written, "seeded read"), "seeded read.scf");
    assert_holds_trace("written SCF", &scf, &written);
    assert_eq!(scf.doc_metadata.as_ref().unwrap()["Sample Name"], "seeded read");
    let abif = parse_binary_sequence_packet(&encode_abif_chromatogram_bytes(&written), "seeded read.ab1");
    assert_holds_trace("written ABIF", &abif, &written);

    // Biopython's ABIF test file 3730.ab1 (BSD): its calls, qualities and peaks are the ones
    // Biopython 1.88 reads (test-data/reference/formats.json, written by
    // scripts/outside-data/ref_formats.py), and the trace survives the SCF writer unchanged.
    let Some(reference) = data_file("reference/formats.json") else { return };
    let Some(bytes) = rpca_data_bytes("biopython-abi/3730.ab1") else { return };
    let reference: serde_json::Value = serde_json::from_str(&reference).expect("formats.json");
    let want = &reference["ab1"]["biopython-abi/3730.ab1"];
    let calls = want["basecalls"].as_str().expect("3730.ab1: Biopython's calls");
    let numbers = |key: &str| -> Vec<u64> { want[key].as_array().unwrap().iter().map(|v| v.as_u64().unwrap()).collect() };
    let (quals, ploc) = (numbers("quals"), numbers("ploc"));
    let a = parse_binary_sequence_packet(&bytes, "3730.ab1");
    let ac = a.chromatogram.clone().expect("3730.ab1: traces");
    assert_eq!(a.sequence, calls, "3730.ab1: calls, as Biopython reads them");
    assert_eq!(ac.phred_scores.iter().map(|&q| u64::from(q)).collect::<Vec<_>>(), quals, "3730.ab1: qualities, as Biopython reads them");
    assert_eq!(ac.peak_locations.iter().map(|&p| p as u64).collect::<Vec<_>>(), ploc, "3730.ab1: peaks, as Biopython reads them");
    let s = parse_binary_sequence_packet(&scf_v3_bytes(&ac, "3730"), "3730.scf");
    assert_holds_trace("3730.ab1 written as SCF", &s, &ac);

    // Against the instrument's own calls, so a channel order shared by both readers cannot pass:
    // at every Q30+ A, C, G or T call's peak, without exception, the called base's channel is the
    // tallest of the four. Biopython's calls and qualities say how many such calls there are.
    let q30 = calls.bytes().zip(&quals).filter(|&(b, &q)| q >= 30 && b"ACGT".contains(&b)).count();
    let (mut hq, mut tallest) = (0usize, 0usize);
    for (i, b) in a.sequence.bytes().enumerate() {
        let Some(k) = b"ACGT".iter().position(|&c| c == b) else { continue };
        let p = ac.peak_locations[i];
        if ac.phred_scores[i] < 30 || p >= ac.trace_a.len() {
            continue;
        }
        let h = [ac.trace_a[p], ac.trace_c[p], ac.trace_g[p], ac.trace_t[p]];
        hq += 1;
        tallest += usize::from(h.iter().all(|&v| h[k] >= v));
    }
    assert!(q30 > 0, "3730.ab1 has Q30+ calls");
    assert_eq!((tallest, hq), (q30, q30), "3730.ab1: called base tallest at {tallest} of {hq} Q30+ peaks");
}

#[test]
fn abif_without_quality_tags_reports_none_instead_of_inventing_them() {
    // An ABIF file with calls (PBAS 2), peaks (PLOC 2), the four processed channels (DATA 9-12,
    // in the G, A, T, C filter-wheel order FWO_ names) and a sample name (SMPL 1), but no PCON 2.
    let written = seeded_chromatogram(0xAB1F_0002, 300);
    let bytes = abif_file(&[
        abif_chars(b"FWO_", 1, b"GATC"),
        abif_chars(b"PBAS", 2, written.base_calls.as_bytes()),
        abif_shorts(b"PLOC", 2, written.peak_locations.iter().map(|&p| p as f64)),
        abif_shorts(b"DATA", 9, written.trace_g.iter().copied()),
        abif_shorts(b"DATA", 10, written.trace_a.iter().copied()),
        abif_shorts(b"DATA", 11, written.trace_t.iter().copied()),
        abif_shorts(b"DATA", 12, written.trace_c.iter().copied()),
        abif_pstring(b"SMPL", 1, "seeded-no-quality"),
    ]);
    let doc = parse_binary_sequence_packet(&bytes, "no_quality.ab1");
    assert_holds_trace("ABIF without PCON", &doc, &molbiocraft_core::ChromatogramData { phred_scores: vec![], ..written.clone() });
    let chrom = doc.chromatogram.expect("traces");
    assert!(chrom.phred_scores.is_empty(), "no quality is invented");
    // Mott trimming has nothing to trim on without qualities.
    let trim = trim_sanger_trace_mott_phred(&chrom, 0.05);
    assert_eq!((trim.trim_start_1based, trim.trim_end_1based), (1, written.base_calls.len()));
    let meta = doc.doc_metadata.unwrap();
    assert_eq!(meta["Sample Name"], "seeded-no-quality");
}

#[test]
fn viewport_places_bases_at_their_recorded_peaks() {
    // A seeded read with irregular peak spacing, written as ABIF: a viewport that spaced the bases
    // evenly, or by the trace's length, would put them away from their peaks.
    let written = seeded_chromatogram(0x1EE7_0003, 400);
    let chrom = parse_binary_sequence_packet(&encode_abif_chromatogram_bytes(&written), "r.ab1").chromatogram.unwrap();
    let peaks = &chrom.peak_locations;
    assert_eq!(peaks, &written.peak_locations);
    let gaps: std::collections::BTreeSet<usize> = peaks[299..345].windows(2).map(|w| w[1] - w[0]).collect();
    assert!(gaps.len() >= 5, "the window's peak spacing is irregular: {gaps:?}");
    let vp = compute_chromatogram_viewport(&chrom, 300, 45, false, true, 1.0, 150.0, 120.0);
    // The trace window spans the samples halfway between the neighbouring peaks of bases 300 and 345.
    let mid = |i: usize| ((peaks[i - 1] + peaks[i]) as f64 / 2.0).round() as usize;
    assert_eq!((vp.start_point, vp.end_point), (mid(300), mid(345)));
    // Each base sits at its own recorded peak, mapped from the window's samples onto x 25..805.
    assert_eq!(vp.base_x_positions.len(), 45);
    let span = (vp.end_point - vp.start_point - 1) as f64;
    for (j, &x) in vp.base_x_positions.iter().enumerate() {
        let at_peak = 25.0 + (peaks[300 + j] - vp.start_point) as f64 / span * 780.0;
        assert!((x - at_peak).abs() <= 0.05 + 1e-9, "base {}: x {x}, its peak is at x {at_peak:.2}", 301 + j);
    }
    assert!(vp.base_x_positions.windows(2).all(|w| w[1] > w[0]));
    assert!(vp.has_quality_values);
}

#[test]
fn unrecognised_binary_never_fabricates_a_sequence() {
    let doc = parse_binary_sequence_packet(&[0u8, 1, 2, 3, 200, 201, 7, 9, 0, 0], "mystery.dna");
    assert!(doc.sequence.is_empty());
    assert!(doc.chromatogram.is_none());
}

// A record that has to wrap everywhere: its definition, CDS location, translation and note are
// each longer than one line, and its 130 bases fill two ORIGIN rows and part of a third. It is
// handed to the reader unwrapped, one value per line, so every line break in the export is the
// exporter's own. It is a layout fixture: the translation is not the CDS's.
const WRAP_SEQ: &str = "ATGACCATGATTACGCCAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAGCTCGAATTCACTGGCCGTCGTTTTACAACGTCGTGACTGGGAAAACCCTGGCGTTACCCAACTTA";
const WRAP_LOCATION: &str = "complement(join(1..12,16..27,31..42,46..57,61..72,76..87,91..102,106..117,121..130))";
const WRAP_TRANSLATION: &str = "MTMITPSLHACRSTLEDPRVPSSNSLAVVLQRRDWENPGVTQLNRLAAHPPFASWRNSEEARTDRPSQQLRSLNGEWRLMRYFLLTHLCGISHRIWCTLSTICSDAA";
const WRAP_NOTE: &str = "a deliberately long free-text note that must wrap onto continuation lines, breaking only between words, so that prose as well as the location and the translation reach the limit";
const WRAP_DEFINITION: &str = "Synthetic lacZ alpha test record whose definition, CDS location, translation and note each run past column 79";

// What Biopython 1.88 writes for the same record, from FEATURES to the end. Biopython wraps at
// INSDC's 80-column maximum; MolBioCraft wraps one column inside it, so the oracle sets
// `GenBankWriter.MAX_WIDTH = 79`. Generated from the record's definition, never from MolBioCraft
// output (SEGS is WRAP_LOCATION's nine 1-based (start, end) pairs):
//
//     loc = CompoundLocation([SimpleLocation(a - 1, b, strand=-1) for a, b in reversed(SEGS)])
//     cds = SeqFeature(loc, type="CDS", qualifiers={"label": ["lacZ"], "gene": ["lacZ"],
//                      "translation": [WRAP_TRANSLATION], "note": [WRAP_NOTE]})
//     src = SeqFeature(SimpleLocation(0, 130, strand=1), type="source",
//                      qualifiers={"mol_type": ["other DNA"]})
//     rec = SeqRecord(Seq(WRAP_SEQ), id="LONGWRAP", name="LONGWRAP", description=WRAP_DEFINITION,
//                     annotations={"molecule_type": "DNA", "topology": "linear"})
//     rec.features = [src, cds]
//     class GenBankWriter79(GenBankWriter): MAX_WIDTH = 79
//     GenBankWriter79(handle).write_file([rec])
//
// The layout it shows is the INSDC one: feature keys at column 6, locations and qualifiers at
// column 22 with continuations indented to column 22, locations broken after a comma, prose
// broken between words, a translation broken anywhere, and ORIGIN rows of 60 bases in six
// 10-base blocks after a 9-column right-aligned base number. A word ending exactly in column 79
// stays on its line; `long_prose_qualifiers_round_trip_unchanged` pins that case.
const BIOPYTHON_79_FEATURES_TO_END: &str = "\
FEATURES             Location/Qualifiers
     source          1..130
                     /mol_type=\"other DNA\"
     CDS             complement(join(1..12,16..27,31..42,46..57,61..72,76..87,
                     91..102,106..117,121..130))
                     /label=\"lacZ\"
                     /gene=\"lacZ\"
                     /translation=\"MTMITPSLHACRSTLEDPRVPSSNSLAVVLQRRDWENPGVTQLN
                     RLAAHPPFASWRNSEEARTDRPSQQLRSLNGEWRLMRYFLLTHLCGISHRIWCTLSTI
                     CSDAA\"
                     /note=\"a deliberately long free-text note that must wrap
                     onto continuation lines, breaking only between words, so
                     that prose as well as the location and the translation
                     reach the limit\"
ORIGIN
        1 atgaccatga ttacgccaag cttgcatgcc tgcaggtcga ctctagagga tccccgggta
       61 ccgagctcga attcactggc cgtcgtttta caacgtcgtg actgggaaaa ccctggcgtt
      121 acccaactta
//
";

#[test]
fn genbank_round_trip_keeps_joins_and_wraps_at_79_columns() {
    let mut doc = parse_genbank_flatfile(
        "LOCUS       TEST                      40 bp    DNA     linear   SYN 01-JAN-2000\n\
         FEATURES             Location/Qualifiers\n\
         \x20    CDS             complement(join(1..9,\n\
         \x20                    20..40))\n\
         \x20                    /gene=\"abc\"\n\
         \x20                    /note=\"a long note that continues\n\
         \x20                    on the next line\"\n\
         ORIGIN\n\
         \x20       1 atgaaacccg ggttttaaac ccgggtttaa acccgggtag\n//\n",
        "t",
    );
    let cds = &doc.features[0];
    assert_eq!((cds.start, cds.end, cds.strand, cds.name.as_str()), (1, 40, -1, "abc"));
    assert_eq!(cds.segments.as_ref().unwrap().len(), 2);
    assert_eq!(cds.notes.as_deref(), Some("a long note that continues on the next line"));
    doc.name = "TEST".into();
    let out = export_genbank_flatfile(&doc);
    assert!(out.contains("complement(join(1..9,20..40))"));
    assert!(out.lines().all(|l| l.len() <= 79), "{out}");

    // The record above never needs a wrap: its longest line is the fixed-width LOCUS line. The
    // wrap is pinned on the record that must wrap everywhere.
    let long = parse_genbank_flatfile(
        &format!(
            "LOCUS       LONGWRAP                 130 bp    DNA     linear   SYN 01-JAN-2000\n\
             DEFINITION  {WRAP_DEFINITION}.\n\
             FEATURES             Location/Qualifiers\n\
             \x20    CDS             {WRAP_LOCATION}\n\
             \x20                    /gene=\"lacZ\"\n\
             \x20                    /translation=\"{WRAP_TRANSLATION}\"\n\
             \x20                    /note=\"{WRAP_NOTE}\"\n\
             ORIGIN\n\
             \x20       1 {}\n//\n",
            WRAP_SEQ.to_ascii_lowercase()
        ),
        "LONGWRAP",
    );
    assert_eq!(long.sequence, WRAP_SEQ);
    let out = export_genbank_flatfile(&long);
    let lines: Vec<&str> = out.lines().collect();
    for l in &lines {
        assert!(l.len() <= 79, "{} columns: {l}", l.len());
    }
    let definition_lines = lines.iter().skip_while(|l| !l.starts_with("DEFINITION")).take_while(|l| !l.starts_with("ACCESSION")).count();
    assert!(definition_lines >= 2, "the definition wraps:\n{out}");

    // Feature table: a key at column 6 opens each feature; every other line, a location or
    // qualifier continuation among them, starts at column 22.
    let table: Vec<&str> = lines.iter().copied().skip_while(|l| !l.starts_with("FEATURES")).skip(1).take_while(|l| *l != "ORIGIN").collect();
    for l in &table {
        let key_line = l.len() > 21 && l.starts_with("     ") && !l[5..].starts_with(' ') && &l[20..21] == " ";
        let at_col_22 = l.starts_with(&" ".repeat(21)) && !l[21..].starts_with(' ');
        assert!(key_line || at_col_22, "not at column 6 or 22: {l:?}");
    }
    let continuations = |q: &str| table.iter().skip_while(|l| !l.trim_start().starts_with(q)).skip(1).take_while(|l| !l.trim_start().starts_with('/')).count();
    assert_eq!(continuations("/translation="), 2, "the translation runs to three lines:\n{out}");
    assert_eq!(continuations("/note="), 3, "the note runs to four lines:\n{out}");
    assert_eq!(table.iter().filter(|l| l.contains("join(")).count(), 1);
    assert!(table.iter().any(|l| l.trim() == "91..102,106..117,121..130))"), "the location breaks after a comma:\n{out}");

    // ORIGIN: rows of 60 bases in six 10-base blocks, each after its 1-based start right-aligned
    // in 9 columns; only the last row is short.
    let rows: Vec<&str> = lines.iter().copied().skip_while(|l| *l != "ORIGIN").skip(1).take_while(|l| *l != "//").collect();
    assert_eq!(rows.len(), 3, "130 bases make three rows:\n{out}");
    for (k, row) in rows.iter().enumerate() {
        assert_eq!(&row[..9], format!("{:>9}", 60 * k + 1), "row {k} number: {row:?}");
        let blocks: Vec<&str> = row[9..].split(' ').skip(1).collect();
        let bases = (WRAP_SEQ.len() - 60 * k).min(60);
        assert_eq!(blocks.len(), bases.div_ceil(10), "row {k} blocks: {row:?}");
        for (b, block) in blocks.iter().enumerate() {
            assert_eq!(block.len(), (bases - 10 * b).min(10), "row {k} block {b}: {row:?}");
        }
        assert_eq!(row[9..].replace(' ', ""), WRAP_SEQ[60 * k..60 * k + bases].to_ascii_lowercase());
    }

    // The same layout, byte for byte, as an independent writer (Biopython) at the same width.
    let from_features = &out[out.find("\nFEATURES").expect("FEATURES") + 1..];
    assert_eq!(from_features, BIOPYTHON_79_FEATURES_TO_END);

    // And the wrapped export reads back to the values it was given.
    let back = parse_genbank_flatfile(&out, "LONGWRAP");
    assert_eq!(back.sequence, WRAP_SEQ);
    assert_eq!(back.description, WRAP_DEFINITION);
    let cds = back.features.iter().find(|f| f.feature_type == "CDS").expect("CDS");
    assert_eq!((cds.start, cds.end, cds.strand), (1, 130, -1));
    assert_eq!(cds.segments.as_ref().map(|s| s.len()), Some(9));
    let q = cds.qualifiers.as_ref().unwrap();
    assert_eq!(q.get("translation").map(String::as_str), Some(WRAP_TRANSLATION));
    assert_eq!(cds.notes.as_deref(), Some(WRAP_NOTE));

    // A record without ORIGIN has no bases; the flatfile text is not mistaken for sequence.
    let summary = parse_genbank_flatfile("LOCUS       CHR  230218 bp    DNA     linear   CON 01-JAN-2000\n//\n", "s");
    assert!(summary.sequence.is_empty());
}

// Prose qualifiers other than /note, each too long for one line. The /product is the one that
// came back as "...phosphotrans ferase...": it has no comma in its first 58 characters, so a
// writer that breaks prose at commas has to cut it mid-word. The /gene (also the feature's
// /label) has no comma at all. The /note carries the two edge cases: "which" ends exactly in
// column 79 with more prose after it, and "4,6-disubstituted" straddles column 79 with its comma
// inside the limit, so a writer that breaks at commas as well as spaces splits "4," from "6-".
// The definition wraps in GenBank's DEFINITION (67 columns after column 12) and in EMBL's DE (74
// after column 5); a writer that cut it at the width would split "co|li" or "tran|sposon". Its
// first DEFINITION line ends in "E.", a full stop the reader must keep: only the one that ends the
// definition is dropped.
// A layout fixture: the bases are only the first 30 of the gene.
const PROSE_SEQ: &str = "ATGAGCCATATTCAACGGGAAACGTCTTGC";
const PROSE_DEFINITION: &str = "Synthetic construct carrying the kanamycin resistance gene of E. coli transposon Tn903 for aminoglycoside 3'-phosphotransferase type Ia, partial cds";
const PROSE_GENE: &str = "aph(3')-Ia neo kanR aminoglycoside 3'-phosphotransferase type Ia from Tn903";
const PROSE_PRODUCT: &str = "kanamycin resistance aminoglycoside phosphotransferase protein from Tn903";
const PROSE_NOTE: &str = "confers resistance to kanamycin and neomycin, which are aminoglycosides whose 2-deoxystreptamine ring is 4,6-disubstituted, by ATP-dependent phosphorylation of their 3'-hydroxyl group";

// What Biopython 1.88 writes for the same record at MolBioCraft's width, generated from the
// values above and never from MolBioCraft output:
//
//     cds = SeqFeature(SimpleLocation(0, 30, strand=1), type="CDS",
//                      qualifiers={"label": [PROSE_GENE], "gene": [PROSE_GENE],
//                                  "product": [PROSE_PRODUCT], "note": [PROSE_NOTE]})
//     src = SeqFeature(SimpleLocation(0, 30, strand=1), type="source",
//                      qualifiers={"mol_type": ["other DNA"]})
//     rec = SeqRecord(Seq(PROSE_SEQ), id="KANWRAP", name="KANWRAP", description=PROSE_DEFINITION,
//                     annotations={"molecule_type": "DNA", "topology": "linear"})
//     rec.features = [src, cds]
//     class GenBankWriter79(GenBankWriter): MAX_WIDTH = 79
//     class EmblWriter79(EmblWriter): MAX_WIDTH = 79
//     GenBankWriter79(handle).write_file([rec])  # DEFINITION, and FEATURES to the end
//     EmblWriter79(handle).write_file([rec])     # DE
const BIOPYTHON_79_PROSE_DEFINITION: &str = "\
DEFINITION  Synthetic construct carrying the kanamycin resistance gene of E.
            coli transposon Tn903 for aminoglycoside 3'-phosphotransferase type
            Ia, partial cds.
";
const BIOPYTHON_79_PROSE_DE: &str = "\
DE   Synthetic construct carrying the kanamycin resistance gene of E. coli
DE   transposon Tn903 for aminoglycoside 3'-phosphotransferase type Ia, partial
DE   cds
";
const BIOPYTHON_79_PROSE_FEATURES_TO_END: &str = "\
FEATURES             Location/Qualifiers
     source          1..30
                     /mol_type=\"other DNA\"
     CDS             1..30
                     /label=\"aph(3')-Ia neo kanR aminoglycoside
                     3'-phosphotransferase type Ia from Tn903\"
                     /gene=\"aph(3')-Ia neo kanR aminoglycoside
                     3'-phosphotransferase type Ia from Tn903\"
                     /product=\"kanamycin resistance aminoglycoside
                     phosphotransferase protein from Tn903\"
                     /note=\"confers resistance to kanamycin and neomycin, which
                     are aminoglycosides whose 2-deoxystreptamine ring is
                     4,6-disubstituted, by ATP-dependent phosphorylation of
                     their 3'-hydroxyl group\"
ORIGIN
        1 atgagccata ttcaacggga aacgtcttgc
//
";

// Comma-separated values, which INSDC writes as (pos:...,aa:...) with no spaces, on a synthetic
// annotation-only record (no bases) long enough for chromosome-scale positions: the /anticodon
// of an 85-base minus-strand tRNA-Leu(CAA), at its bases 35-37, and the /transl_except of a
// selenocysteine codon in frame in a minus-strand CDS (codon 138 of 400). Quoted, each is 62
// characters, four more than the 58 left after column 21, so it wraps: MolBioCraft breaks it
// after its last comma that fits, and its reader rejoins the two lines with nothing between them.
// Biopython 1.88 at MAX_WIDTH = 79 (GenBankWriter79 above, same features) writes both unquoted,
// finds no space to break at and cuts at the width,
//
//                      /anticodon=(pos:complement(1234548..1234550),aa:Leu,seq:ca
//                      a)
//                      /transl_except=(pos:complement(123456789..123456791),aa:Se
//                      c)
//
// and reads them back as "...,seq:ca a)" and "...,aa:Se c)", so here the layout departs from
// Biopython's on purpose.
const VALUE_ANTICODON: &str = "(pos:complement(1234548..1234550),aa:Leu,seq:caa)";
const VALUE_TRANSL_EXCEPT: &str = "(pos:complement(123456789..123456791),aa:Sec)";

// The stated limits, on the same record. A run with no space in it cannot be kept whole when it
// is longer than the room left on its line: 58 columns after column 21 or, for a qualifier's first
// word, the room after its key (48 after /product=", 51 after /gene=" or /note="). It is broken
// after its last comma that fits or, with none, cut at the width as Biopython 1.88 cuts it, and
// it reads back with a space at the break. So a chemical name or a URL longer than that room is
// cut: the E. coli FolK /product below comes back as "...dihydropteridin e diphosphokinase", from
// Biopython as from MolBioCraft, in the same two lines. This /note's list of the enzymes that cut
// in the pUC19 multiple cloning site comes back as "...,HincII, PstI,...", where Biopython, which
// has no comma rule, cuts it at the width and reads back "...,PstI ,SbfI,...". DEFINITION and DE
// follow the same rule at 67 and 74 characters, where Biopython writes such a run whole on a line
// over the width. A run of spaces where a line breaks reads back as one space. A run that exactly
// fills its line is kept: the 58-character URL that ends this /note leaves the closing quote alone
// on the next line, as Biopython does, and reads back with no space added (Biopython's reader
// adds a trailing one).
const FOLK_PRODUCT: &str = "2-amino-4-hydroxy-6-hydroxymethyldihydropteridine diphosphokinase";
const MCS_NOTE: &str = "pUC19 multiple cloning site, EcoRI to HindIII: EcoRI,SacI,KpnI,SmaI,XmaI,BamHI,XbaI,SalI,AccI,HincII,PstI,SbfI,SphI,HindIII; see https://www.ncbi.nlm.nih.gov/nuccore/L09137?report=genbank";
const BIOPYTHON_79_FOLK_PRODUCT: &str = "\
                     /product=\"2-amino-4-hydroxy-6-hydroxymethyldihydropteridin
                     e diphosphokinase\"
";

/// Feature-table lines in GenBank's layout (an EMBL `FT` line with its tag blanked, as the EMBL
/// reader reads it), each checked to sit within 79 columns with a key at column 6 or a location
/// or qualifier at column 22.
fn feature_table(lines: impl Iterator<Item = String>) -> Vec<String> {
    let table: Vec<String> = lines.collect();
    for l in &table {
        assert!(l.len() <= 79, "{} columns: {l}", l.len());
        let key_line = l.starts_with("     ") && !l[5..].starts_with(' ');
        assert!(key_line || (l.starts_with(&" ".repeat(21)) && !l[21..].starts_with(' ')), "not at column 6 or 22: {l:?}");
    }
    table
}

/// The text of the qualifier that starts with `start`, one entry per line it takes.
fn qualifier_lines<'a>(table: &'a [String], start: &str) -> Vec<&'a str> {
    let i = table.iter().position(|l| l.trim_start().starts_with(start)).unwrap_or_else(|| panic!("no {start} line"));
    let continues = |l: &&String| l.starts_with(&" ".repeat(21)) && !l[21..].starts_with('/');
    std::iter::once(&table[i]).chain(table[i + 1..].iter().take_while(continues)).map(|l| l.trim()).collect()
}

#[test]
fn long_prose_qualifiers_round_trip_unchanged() {
    // Handed to the reader one value per line, so every line break in the export is the
    // exporter's own.
    let doc = parse_genbank_flatfile(
        &format!(
            "LOCUS       KANWRAP                   30 bp    DNA     linear   SYN 01-JAN-2000\n\
             DEFINITION  {PROSE_DEFINITION}.\n\
             FEATURES             Location/Qualifiers\n\
             \x20    CDS             1..30\n\
             \x20                    /gene=\"{PROSE_GENE}\"\n\
             \x20                    /product=\"{PROSE_PRODUCT}\"\n\
             \x20                    /note=\"{PROSE_NOTE}\"\n\
             ORIGIN\n\
             \x20       1 {}\n//\n",
            PROSE_SEQ.to_ascii_lowercase()
        ),
        "KANWRAP",
    );
    let unchanged = |doc: &molbiocraft_core::SequenceDocument, via: &str| {
        assert_eq!(doc.description, PROSE_DEFINITION, "{via}: the definition");
        let cds = doc.features.iter().find(|f| f.feature_type == "CDS").unwrap_or_else(|| panic!("{via}: no CDS"));
        let q = cds.qualifiers.as_ref().unwrap_or_else(|| panic!("{via}: no qualifiers"));
        assert_eq!(q.get("product").map(String::as_str), Some(PROSE_PRODUCT), "{via}: /product");
        assert_eq!(q.get("gene").map(String::as_str), Some(PROSE_GENE), "{via}: /gene");
        assert_eq!(cds.name, PROSE_GENE, "{via}: the feature's name");
        assert_eq!(cds.notes.as_deref(), Some(PROSE_NOTE), "{via}: /note");
    };
    unchanged(&doc, "the unwrapped input");

    let out = export_genbank_flatfile(&doc);
    feature_table(out.lines().skip_while(|l| !l.starts_with("FEATURES")).skip(1).take_while(|l| *l != "ORIGIN").map(String::from));
    // The same lines, byte for byte, as an independent writer (Biopython) at the same width.
    assert_eq!(&out[out.find("\nDEFINITION").expect("DEFINITION") + 1..out.find("\nACCESSION").expect("ACCESSION") + 1], BIOPYTHON_79_PROSE_DEFINITION);
    assert_eq!(&out[out.find("\nFEATURES").expect("FEATURES") + 1..], BIOPYTHON_79_PROSE_FEATURES_TO_END);
    unchanged(&parse_genbank_flatfile(&out, "KANWRAP"), "GenBank export and import");

    // EMBL writes its description and feature table through the same wrapper, so it must keep the
    // text too.
    let embl = export_embl_flatfile(&doc);
    feature_table(embl.lines().filter(|l| l.starts_with("FT")).map(|l| format!("  {}", &l[2..])));
    assert_eq!(embl.lines().filter(|l| l.starts_with("DE")).map(|l| format!("{l}\n")).collect::<String>(), BIOPYTHON_79_PROSE_DE);
    unchanged(&parse_embl_flatfile(&embl, "KANWRAP"), "EMBL export and import");

    // Comma-separated values, and the stated limits.
    let values = parse_genbank_flatfile(
        &format!(
            "LOCUS       VALWRAP            130000000 bp    DNA     linear   CON 01-JAN-2000\n\
             FEATURES             Location/Qualifiers\n\
             \x20    tRNA            complement(1234500..1234584)\n\
             \x20                    /product=\"tRNA-Leu\"\n\
             \x20                    /anticodon=\"{VALUE_ANTICODON}\"\n\
             \x20    CDS             complement(123456003..123457202)\n\
             \x20                    /product=\"selenoprotein\"\n\
             \x20                    /transl_except=\"{VALUE_TRANSL_EXCEPT}\"\n\
             \x20    CDS             2001..2480\n\
             \x20                    /gene=\"folK\"\n\
             \x20                    /product=\"{FOLK_PRODUCT}\"\n\
             \x20    misc_feature    5001..5057\n\
             \x20                    /note=\"{MCS_NOTE}\"\n\
             //\n"
        ),
        "VALWRAP",
    );
    let read_as = |doc: &molbiocraft_core::SequenceDocument, via: &str, folk: &str, mcs: &str| {
        let value = |ty: &str, key: &str, with: Option<(&str, &str)>| {
            doc.features
                .iter()
                .filter(|f| f.feature_type == ty)
                .filter_map(|f| f.qualifiers.as_ref())
                .filter(|q| with.is_none_or(|(k, v)| q.get(k).is_some_and(|x| x == v)))
                .find_map(|q| q.get(key).cloned())
                .unwrap_or_else(|| panic!("{via}: no {ty} /{key}"))
        };
        assert_eq!(value("tRNA", "anticodon", None), VALUE_ANTICODON, "{via}: /anticodon");
        assert_eq!(value("CDS", "transl_except", None), VALUE_TRANSL_EXCEPT, "{via}: /transl_except");
        assert_eq!(value("CDS", "product", Some(("gene", "folK"))), folk, "{via}: the FolK /product");
        assert_eq!(value("misc_feature", "note", None), mcs, "{via}: the enzyme list");
    };
    read_as(&values, "the unwrapped input", FOLK_PRODUCT, MCS_NOTE);
    // What the limits leave: a space where each over-long run was broken.
    let folk_cut = FOLK_PRODUCT.replacen("dihydropteridine", "dihydropteridin e", 1);
    let mcs_broken = MCS_NOTE.replacen("HincII,PstI", "HincII, PstI", 1);

    let gb = export_genbank_flatfile(&values);
    let embl = export_embl_flatfile(&values);
    for (via, table) in [
        ("GenBank", feature_table(gb.lines().skip_while(|l| !l.starts_with("FEATURES")).skip(1).take_while(|l| *l != "ORIGIN" && *l != "//").map(String::from))),
        ("EMBL", feature_table(embl.lines().filter(|l| l.starts_with("FT")).map(|l| format!("  {}", &l[2..])))),
    ] {
        assert_eq!(qualifier_lines(&table, "/anticodon="), ["/anticodon=\"(pos:complement(1234548..1234550),aa:Leu,", "seq:caa)\""], "{via}");
        assert_eq!(qualifier_lines(&table, "/transl_except="), ["/transl_except=\"(pos:complement(123456789..123456791),", "aa:Sec)\""], "{via}");
        assert_eq!(
            qualifier_lines(&table, "/note="),
            [
                "/note=\"pUC19 multiple cloning site, EcoRI to HindIII:",
                "EcoRI,SacI,KpnI,SmaI,XmaI,BamHI,XbaI,SalI,AccI,HincII,",
                "PstI,SbfI,SphI,HindIII; see",
                "https://www.ncbi.nlm.nih.gov/nuccore/L09137?report=genbank",
                "\"",
            ],
            "{via}"
        );
        assert!(table.iter().map(|l| format!("{l}\n")).collect::<String>().contains(BIOPYTHON_79_FOLK_PRODUCT), "{via}: the FolK /product as Biopython writes it");
    }
    read_as(&parse_genbank_flatfile(&gb, "VALWRAP"), "GenBank export and import", &folk_cut, &mcs_broken);
    read_as(&parse_embl_flatfile(&embl, "VALWRAP"), "EMBL export and import", &folk_cut, &mcs_broken);
}

// A *sequence qualifier is cut at the width, as /translation is, and rejoined with nothing between
// its lines. The 70-nt primer below (a 22-nt tail, then 48 nt of the pUC19 multiple cloning site
// from its HindIII site) is 89 characters as /primer_sequence="...", so it takes two lines, the
// ones Biopython 1.88 writes at MAX_WIDTH = 79 (GenBankWriter79 above, with
// SeqFeature(SimpleLocation(0, 70, strand=1), type="primer_bind",
// qualifiers={"primer_sequence": [PRIMER_70]})). Biopython reads them back with a space at the
// cut; MolBioCraft must not. A layout fixture: the record's bases are the primer's own.
const PRIMER_70: &str = "ACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGAG";
const BIOPYTHON_79_PRIMER: &str = "\
                     /primer_sequence=\"ACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCAG
                     GTCGACTCTAGAGGATCCCCGGGTACCGAG\"
";

#[test]
fn long_primer_sequence_round_trips_without_an_inserted_space() {
    let doc = parse_genbank_flatfile(
        &format!(
            "LOCUS       PRIMWRAP                  70 bp    DNA     linear   SYN 01-JAN-2000\n\
             FEATURES             Location/Qualifiers\n\
             \x20    primer_bind     1..70\n\
             \x20                    /primer_sequence=\"{PRIMER_70}\"\n\
             ORIGIN\n\
             \x20       1 {}\n//\n",
            PRIMER_70.to_ascii_lowercase()
        ),
        "PRIMWRAP",
    );
    let primer = |doc: &molbiocraft_core::SequenceDocument, via: &str| {
        let q = doc.features.iter().find(|f| f.feature_type == "primer_bind").and_then(|f| f.qualifiers.as_ref());
        assert_eq!(q.and_then(|q| q.get("primer_sequence")).map(String::as_str), Some(PRIMER_70), "{via}: /primer_sequence");
    };
    primer(&doc, "the unwrapped input");

    let gb = export_genbank_flatfile(&doc);
    assert!(gb.contains(BIOPYTHON_79_PRIMER), "the primer as Biopython writes it:\n{gb}");
    primer(&parse_genbank_flatfile(&gb, "PRIMWRAP"), "GenBank export and import");
    let embl = export_embl_flatfile(&doc);
    // EMBL's FT lines, with the tag blanked, are the same lines.
    let ft: String = embl.lines().filter(|l| l.starts_with("FT")).map(|l| format!("  {}\n", &l[2..])).collect();
    assert!(ft.contains(BIOPYTHON_79_PRIMER), "the primer as Biopython writes it:\n{embl}");
    primer(&parse_embl_flatfile(&embl, "PRIMWRAP"), "EMBL export and import");
}

// Qualifiers written without quotes, such as /anticodon, /transl_except and /rpt_unit_range
// (unquoted in INSDC's feature table definition and in Biopython's writer, which lists them in
// FTQUAL_NO_QUOTE; NCBI writes /transl_except so too), wrap onto column-22 lines like any other
// value, and a column-22 line that does not begin a new /key belongs to the current qualifier.
// Both fixtures are Biopython 1.88's own output, byte for byte, at MolBioCraft's width, generated
// from the values below and never from MolBioCraft output:
//
//     trna = SeqFeature(SimpleLocation(1234499, 1234584, strand=-1), type="tRNA",
//                       qualifiers={"product": ["tRNA-Leu"], "anticodon": [UNQUOTED_ANTICODON]})
//     cds = SeqFeature(CompoundLocation([SimpleLocation(123456700, 123456789, strand=-1),
//                                        SimpleLocation(123455000, 123455001, strand=-1),
//                                        SimpleLocation(123452500, 123453001, strand=-1)]),
//                      type="CDS",
//                      qualifiers={"gene": ["selX"], "transl_except": [UNQUOTED_TRANSL_EXCEPT],
//                                  "note": [UNQUOTED_NOTE], "product": ["selenoprotein X"]})
//     rec = SeqRecord(Seq(None, length=130000000), id="SELWRAP", name="SELWRAP",
//                     description="Synthetic selenoprotein locus",
//                     annotations={"molecule_type": "DNA", "topology": "linear"})
//     rec.features = [trna, cds]
//     class GenBankWriter79(GenBankWriter): MAX_WIDTH = 79
//     class EmblWriter79(EmblWriter): MAX_WIDTH = 79
//     GenBankWriter79(handle).write_file([rec])  # BIOPYTHON_79_UNQUOTED_GB
//     EmblWriter79(handle).write_file([rec])     # BIOPYTHON_79_UNQUOTED_EMBL
//
// A layout fixture, on an annotation-only record long enough for chromosome-scale positions: no
// real codon has its three bases in three exons, but INSDC syntax allows it, and written so the
// /transl_except is 117 characters and wraps twice. Biopython writes it
// unquoted and, finding no space, cuts it at the width both times: once just after a comma and
// once inside "123|453001". It cuts the /anticodon inside "ca|a". Biopython's own reader puts a
// space at every line break ("...,seq:ca a)", and "...123456789), complement(..." and
// "...complement(123453001..123 453001)),aa:Sec)"); MolBioCraft joins these lines with nothing, as
// it joins the quoted form of the same two qualifiers. The /note shows the other half of the rule:
// its second line begins "/transl_except" but is still inside the open quoted value, not a new
// qualifier, which is how Biopython's scanner reads it too.
//
// What the test catches: continuation lines appended to the location (the defect: each value
// stopped at its first line, and the rest was read as location text); continuation lines joined
// with a space (Biopython's reader); a "/" at column 22 always opening a qualifier,
// even inside an open quoted value (the /note cut short and a stray qualifier); and every line
// after an unquoted value taken as its continuation, a new /key line included (/note and /product
// lost).
const UNQUOTED_TRANSL_EXCEPT: &str =
    "(pos:join(complement(123456789..123456789),complement(123455001..123455001),complement(123453001..123453001)),aa:Sec)";
const UNQUOTED_ANTICODON: &str = "(pos:complement(1234548..1234550),aa:Leu,seq:caa)";
const UNQUOTED_NOTE: &str = "the UGA codon given in this feature's /transl_except is read as selenocysteine, not as a stop";
const BIOPYTHON_79_UNQUOTED_GB: &str = r#"LOCUS       SELWRAP            130000000 bp    DNA     linear   UNK 01-JAN-1980
DEFINITION  Synthetic selenoprotein locus.
ACCESSION   SELWRAP
VERSION     SELWRAP
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
     tRNA            complement(1234500..1234584)
                     /product="tRNA-Leu"
                     /anticodon=(pos:complement(1234548..1234550),aa:Leu,seq:ca
                     a)
     CDS             complement(join(123452501..123453001,123455001,
                     123456701..123456789))
                     /gene="selX"
                     /transl_except=(pos:join(complement(123456789..123456789),
                     complement(123455001..123455001),complement(123453001..123
                     453001)),aa:Sec)
                     /note="the UGA codon given in this feature's
                     /transl_except is read as selenocysteine, not as a stop"
                     /product="selenoprotein X"
ORIGIN
//
"#;
// Biopython ends its empty sequence header with three spaces ("SQ   "), kept here as written.
const BIOPYTHON_79_UNQUOTED_EMBL: &str = concat!(
    r#"ID   SELWRAP; ; linear; DNA; ; UNC; 130000000 BP.
XX
AC   SELWRAP;
XX
DE   Synthetic selenoprotein locus
XX
OS   .
OC   .
XX
FH   Key             Location/Qualifiers
FH
FT   tRNA            complement(1234500..1234584)
FT                   /product="tRNA-Leu"
FT                   /anticodon=(pos:complement(1234548..1234550),aa:Leu,seq:ca
FT                   a)
FT   CDS             complement(join(123452501..123453001,123455001,
FT                   123456701..123456789))
FT                   /gene="selX"
FT                   /transl_except=(pos:join(complement(123456789..123456789),
FT                   complement(123455001..123455001),complement(123453001..123
FT                   453001)),aa:Sec)
FT                   /note="the UGA codon given in this feature's
FT                   /transl_except is read as selenocysteine, not as a stop"
FT                   /product="selenoprotein X"
XX
"#,
    "SQ   \n//\n"
);

/// A feature's qualifiers as sorted (key, value) pairs, so a stray or a missing one shows.
fn sorted_qualifiers(f: &molbiocraft_core::SequenceFeature) -> Vec<(String, String)> {
    let mut q: Vec<(String, String)> = f.qualifiers.clone().unwrap_or_default().into_iter().collect();
    q.sort();
    q
}

fn owned_pairs(pairs: &[(&str, &str)]) -> Vec<(String, String)> {
    pairs.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
}

#[test]
fn unquoted_wrapped_qualifiers_import_whole() {
    for (via, doc) in [
        ("GenBank", parse_genbank_flatfile(BIOPYTHON_79_UNQUOTED_GB, "SELWRAP")),
        ("EMBL", parse_embl_flatfile(BIOPYTHON_79_UNQUOTED_EMBL, "SELWRAP")),
    ] {
        let types: Vec<&str> = doc.features.iter().map(|f| f.feature_type.as_str()).collect();
        assert_eq!(types, ["tRNA", "CDS"], "{via}: the features");
        let (trna, cds) = (&doc.features[0], &doc.features[1]);
        assert_eq!((trna.start, trna.end, trna.strand), (1234500, 1234584, -1), "{via}: the tRNA's location");
        assert_eq!(
            sorted_qualifiers(trna),
            owned_pairs(&[("anticodon", UNQUOTED_ANTICODON), ("product", "tRNA-Leu")]),
            "{via}: the tRNA's qualifiers"
        );
        assert_eq!((cds.start, cds.end, cds.strand), (123452501, 123456789, -1), "{via}: the CDS's location");
        let exons: Option<Vec<(usize, usize)>> = cds.segments.as_ref().map(|s| s.iter().map(|s| (s.start, s.end)).collect());
        assert_eq!(exons, Some(vec![(123452501, 123453001), (123455001, 123455001), (123456701, 123456789)]), "{via}: the CDS's exons");
        assert_eq!(
            sorted_qualifiers(cds),
            owned_pairs(&[
                ("gene", "selX"),
                ("note", UNQUOTED_NOTE),
                ("product", "selenoprotein X"),
                ("transl_except", UNQUOTED_TRANSL_EXCEPT),
            ]),
            "{via}: the CDS's qualifiers"
        );
        assert_eq!(cds.notes.as_deref(), Some(UNQUOTED_NOTE), "{via}: the CDS's note");
    }
}

// A double quote inside a qualifier value is written as two, the INSDC rule (feature table
// definition 3.3.3.1, and NCBI's GenBank release notes 3.4.12.3: /note="This is an example of
// ""escaped"" quotation marks"), and the reader turns each pair back into one. Biopython 1.88
// writes it the same way (`value.replace('"', '""')`); MolBioCraft wrote an apostrophe.
//
// The values put a quote wherever a writer or a reader can lose one: the /note opens with one and
// the /product ends with one; the /product's first line ends in a doubled quote and its second
// begins with one; and the /note has "/gene" after a doubled quote. A value closes at a line that
// ends in an odd run of quotes: the last one closes it and the rest are pairs. A line that ends in
// an even run closes it only when the next line begins a qualifier or a feature or ends the table
// (`unescaped_final_quote_keeps_following_qualifiers`). BIOPYTHON_79_QUOTES is what Biopython 1.88
// writes for these two values (GenBankWriter79 and EmblWriter79 above, with
// SeqFeature(SimpleLocation(0, 30, strand=1), type="CDS",
//            qualifiers={"product": [QUOTE_PRODUCT], "note": [QUOTE_NOTE]})).
//
// MolBioCraft writes both as Biopython does. The /note's first line ends in the doubled quote
// after "selW" and the next begins "/gene;", which is no qualifier name ("/", a name, then "=" or
// the line's end), so the reader keeps it in the value and the export keeps Biopython's break
// there (`own_export_reads_back_unchanged_fuzz` holds that rule over 5,000 values). Biopython
// 1.88, which closes a value at any line ending in a quote and takes any next line beginning with
// "/" for a qualifier, reads these bytes, its own and so MolBioCraft's, as '"SelW" in the 2003
// survey, annotated "selW"' plus a valueless qualifier named 'gene; its UGA codon is read as
// selenocysteine"'.
//
// QUOTE_OLIGO holds two runs with no space or comma, 59 and 60 characters once their quotes are
// doubled, so each is longer than the 58 a line holds and is cut at the width.
// For the first, the width falls between the two quotes of the pair that closes the oligo, and
// there the layout departs from Biopython's on purpose. Biopython 1.88 (GenBankWriter79 above,
// with SeqFeature(SimpleLocation(0, 30, strand=1), type="misc_feature",
// qualifiers={"note": [QUOTE_OLIGO]})) cuts there,
//
//                      /note="cloned with the oligo
//                      selW_fwd=""GGTCTCAACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCA"
//                      " and its partner
//                      selW_rev_GCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGA_tail=""
//                      "" so no tail was added"
//
// and that line ends in a lone quote, which a reader takes for the closing one; MolBioCraft cuts
// one column earlier, so the pair begins the next line. For the second, the empty tail "" (four
// quotes when doubled) has the width between its two pairs, a cut that splits neither, and
// MolBioCraft cuts there as Biopython does. Each run reads back with a space at its cut, the stated
// limit of any run longer than its line (`long_prose_qualifiers_round_trip_unchanged`); Biopython
// reads the first back as `CTGCA" " and`, the pair it split left as two quotes.
//
// What the test catches: a quote written as an apostrophe (the defect); quotes doubled on export
// and not undone on import; every quote stripped from a value's ends (`trim_matches('"')`, as the
// reader did) rather than the one pair that delimits it; a value closed at any line that ends in a
// quote; a value closed at a line ending in an even run before any line that begins with "/"
// (Biopython's bytes for the /note); a break moved before a "/" line that names no qualifier (the
// /note broken one word earlier); a cut between the two quotes of a pair; and a cut
// moved back between any two quotes, which splits the first pair of the empty tail.
const QUOTE_SEQ: &str = "ATGAGCCATATTCAACGGGAAACGTCTTGC";
const QUOTE_PRODUCT: &str = r#"putative selenoprotein W homologue "SelW" "Rdx12" family member, called "SelW-like""#;
const QUOTE_NOTE: &str = r#""SelW" in the 2003 survey, annotated "selW" /gene; its UGA codon is read as selenocysteine"#;
const QUOTE_OLIGO: &str = r#"cloned with the oligo selW_fwd="GGTCTCAACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCA" and its partner selW_rev_GCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGA_tail="" so no tail was added"#;
const BIOPYTHON_79_QUOTES: &str = r#"                     /product="putative selenoprotein W homologue ""SelW""
                     ""Rdx12"" family member, called ""SelW-like"""
                     /note="""SelW"" in the 2003 survey, annotated ""selW""
                     /gene; its UGA codon is read as selenocysteine"
"#;
const MOLBIOCRAFT_79_QUOTE_OLIGO: &str = r#"                     /note="cloned with the oligo
                     selW_fwd=""GGTCTCAACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCA
                     "" and its partner
                     selW_rev_GCATGCCTGCAGGTCGACTCTAGAGGATCCCCGGGTACCGA_tail=""
                     "" so no tail was added"
"#;

#[test]
fn embedded_quotes_round_trip() {
    // Handed to the reader one value per line, escaped as INSDC escapes them, so every line break
    // in the export is the exporter's own.
    let escaped = |v: &str| v.replace('"', "\"\"");
    let doc = parse_genbank_flatfile(
        &format!(
            "LOCUS       QUOTES                    30 bp    DNA     linear   SYN 01-JAN-2000\n\
             FEATURES             Location/Qualifiers\n\
             \x20    CDS             1..30\n\
             \x20                    /product=\"{}\"\n\
             \x20                    /note=\"{}\"\n\
             \x20    misc_feature    1..30\n\
             \x20                    /note=\"{}\"\n\
             ORIGIN\n\
             \x20       1 {}\n//\n",
            escaped(QUOTE_PRODUCT),
            escaped(QUOTE_NOTE),
            escaped(QUOTE_OLIGO),
            QUOTE_SEQ.to_ascii_lowercase()
        ),
        "QUOTES",
    );
    let read_as = |doc: &molbiocraft_core::SequenceDocument, via: &str, oligo: &str| {
        // The GenBank export adds a source feature when the record has none.
        let features: Vec<&molbiocraft_core::SequenceFeature> = doc.features.iter().filter(|f| f.feature_type != "source").collect();
        let types: Vec<&str> = features.iter().map(|f| f.feature_type.as_str()).collect();
        assert_eq!(types, ["CDS", "misc_feature"], "{via}: the features");
        let (cds, misc) = (features[0], features[1]);
        let q = cds.qualifiers.as_ref().unwrap_or_else(|| panic!("{via}: no qualifiers"));
        assert_eq!(q.get("product").map(String::as_str), Some(QUOTE_PRODUCT), "{via}: /product");
        assert_eq!(cds.name, QUOTE_PRODUCT, "{via}: the feature's name (its /label on export)");
        assert_eq!(cds.notes.as_deref(), Some(QUOTE_NOTE), "{via}: /note");
        assert!(q.keys().all(|k| matches!(k.as_str(), "label" | "product" | "note")), "{via}: a stray qualifier in {q:?}");
        assert_eq!(misc.notes.as_deref(), Some(oligo), "{via}: the oligo's /note");
    };
    read_as(&doc, "the unwrapped input", QUOTE_OLIGO);
    // Biopython's own layout, the /note's "/gene" line after a doubled quote included.
    let biopython = parse_genbank_flatfile(
        &format!(
            "LOCUS       QUOTES                    30 bp    DNA     linear   SYN 01-JAN-2000\n\
             FEATURES             Location/Qualifiers\n\
             \x20    CDS             1..30\n\
             {BIOPYTHON_79_QUOTES}\
             ORIGIN\n//\n"
        ),
        "QUOTES",
    );
    let (bp_cds, bp_q) = (&biopython.features[0], biopython.features[0].qualifiers.as_ref().expect("qualifiers"));
    assert_eq!(bp_q.get("product").map(String::as_str), Some(QUOTE_PRODUCT), "Biopython's layout: /product");
    assert_eq!(bp_cds.notes.as_deref(), Some(QUOTE_NOTE), "Biopython's layout: /note");
    assert_eq!(bp_q.len(), 2, "Biopython's layout: a stray qualifier in {bp_q:?}");
    // What the limit leaves: a space where each over-long run was cut.
    let oligo_cut = QUOTE_OLIGO.replacen("CTGCA\"", "CTGCA \"", 1).replacen("_tail=\"\"", "_tail=\" \"", 1);
    assert_eq!(oligo_cut.len(), QUOTE_OLIGO.len() + 2);

    let gb = export_genbank_flatfile(&doc);
    let embl = export_embl_flatfile(&doc);
    for (via, table) in [
        ("GenBank", feature_table(gb.lines().skip_while(|l| !l.starts_with("FEATURES")).skip(1).take_while(|l| *l != "ORIGIN").map(String::from))),
        ("EMBL", feature_table(embl.lines().filter(|l| l.starts_with("FT")).map(|l| format!("  {}", &l[2..])))),
    ] {
        let text: String = table.iter().map(|l| format!("{l}\n")).collect();
        assert!(text.contains(BIOPYTHON_79_QUOTES), "{via}: /product and /note as Biopython writes them:\n{text}");
        assert!(text.contains(MOLBIOCRAFT_79_QUOTE_OLIGO), "{via}: the oligo's closing pair kept whole:\n{text}");
        assert_eq!(
            qualifier_lines(&table, "/label="),
            [r#"/label="putative selenoprotein W homologue ""SelW"""#, r#"""Rdx12"" family member, called ""SelW-like""""#],
            "{via}: the /label"
        );
    }
    read_as(&parse_genbank_flatfile(&gb, "QUOTES"), "GenBank export and import", &oligo_cut);
    read_as(&parse_embl_flatfile(&embl, "QUOTES"), "EMBL export and import", &oligo_cut);
}

// A quoted value whose last line ends in an even run of quotes, a quote left unescaped and then
// the closing one, as in `/note="cloned from "pUC19""`: the form of the sig_peptide /note in
// Biopython's test file qualifier_escaping_read.gb (`/note="End not properly "escaped""`, which a
// new feature follows). The value closes at that line when the next one begins a qualifier or a
// feature or ends the feature table, as Biopython 1.88 reads it; before any other line the run is
// doubled quotes and a line break, and the value goes on (`embedded_quotes_round_trip`).
// UNESCAPED_PROBE_TABLE puts each of those lines after one: a qualifier with a value
// (/codon_start, after the /note's first line), a valueless one (/pseudo, after a continuation
// line), a feature, and the end of the table. Every expected value is what Biopython 1.88 reads
// from the same text, as GenBank and, behind "FT", as EMBL (`SeqIO.read(handle, "genbank")` and
// "embl"), and what it reads from qualifier_escaping_read.gb.
//
// What the test catches: a value left open at an even run until a line ends in an odd one (the
// round-1 regression, which read /codon_start, /transl_table and /product into the first /note
// and /pseudo into the second); the close applied on a value's first line only; a qualifier taken
// to need "=" (the /pseudo); and every quote of the run dropped at the close, not the closing one.
const UNESCAPED_PROBE_TABLE: &str = r#"     CDS             1..30
                     /gene="bla"
                     /note="cloned from "pUC19""
                     /codon_start=1
                     /transl_table=11
                     /product="beta-lactamase"
     misc_feature    1..30
                     /note="a two-line note whose second line ends in an
                     unescaped "quote""
                     /pseudo
     misc_feature    1..12
                     /note="End not properly "escaped""
     misc_feature    13..30
                     /note="and the table ends after "this""
"#;
const UNESCAPED_PROBE_SEQ: &str = "atgagtattc aacatttccg tgtcgccctt";

// So that its own output is never read that way, MolBioCraft's export never ends a line in an even
// run of quotes before a line the reader takes for a qualifier
// (`own_export_reads_back_unchanged_fuzz`). SLASH_NOTE's run with no space, `fwd="..."/rev="..."`,
// is longer than a line, and the width falls just before its "/rev=". Biopython 1.88
// (GenBankWriter79 and EmblWriter79 above, with SeqFeature(SimpleLocation(0, 30, strand=1),
// type="misc_feature",
// qualifiers={"note": [SLASH_NOTE]})) cuts there,
//
//                      /note="cloned with
//                      fwd=""GGTCTCAACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCAGGTC""
//                      /rev=""GCATGCCTGCAGGTCGACTCTAGAGGATCC"" from the kit"
//
// and reads its own output back as a /note that ends at the first oligo plus a qualifier /rev,
// as MolBioCraft's reader would. A cut inside a run with no space reads back with a space wherever
// it falls, the stated limit of a run longer than its line, so MolBioCraft moves it back past the
// doubled quote, which then begins the next line, and these bytes differ from Biopython's on
// purpose (MOLBIOCRAFT_79_SLASH_NOTE). This catches a writer that moves a break only to an
// earlier space: the run has none. A run of 70 "/" with no quote in it is no such case and stays
// cut at the width, after 51 of them, never moved back into `/note="` (a writer that does writes
// `/note=` and the run unquoted).
const SLASH_NOTE: &str = r#"cloned with fwd="GGTCTCAACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCAGGTC"/rev="GCATGCCTGCAGGTCGACTCTAGAGGATCC" from the kit"#;
const MOLBIOCRAFT_79_SLASH_NOTE: &str = r#"                     /note="cloned with
                     fwd=""GGTCTCAACGTTGCAAGGCTTAACCGGTTAAGCTTGCATGCCTGCAGGTC
                     ""/rev=""GCATGCCTGCAGGTCGACTCTAGAGGATCC"" from the kit"
"#;

#[test]
fn unescaped_final_quote_keeps_following_qualifiers() {
    let probe: [&[(&str, &str)]; 4] = [
        &[("codon_start", "1"), ("gene", "bla"), ("note", r#"cloned from "pUC19""#), ("product", "beta-lactamase"), ("transl_table", "11")],
        &[("note", r#"a two-line note whose second line ends in an unescaped "quote""#), ("pseudo", "")],
        &[("note", r#"End not properly "escaped""#)],
        &[("note", r#"and the table ends after "this""#)],
    ];
    // An export adds a /label to each feature, and a source feature when the record has none.
    let read_as = |doc: &molbiocraft_core::SequenceDocument, via: &str| {
        let features: Vec<&molbiocraft_core::SequenceFeature> = doc.features.iter().filter(|f| f.feature_type != "source").collect();
        let types: Vec<&str> = features.iter().map(|f| f.feature_type.as_str()).collect();
        assert_eq!(types, ["CDS", "misc_feature", "misc_feature", "misc_feature"], "{via}: the features");
        for (f, want) in features.iter().zip(probe) {
            let got: Vec<(String, String)> = sorted_qualifiers(f).into_iter().filter(|(k, _)| k != "label").collect();
            assert_eq!(got, owned_pairs(want), "{via}: the {} at {}..{}", f.feature_type, f.start, f.end);
            assert_eq!(f.notes.as_deref(), want.iter().find(|(k, _)| *k == "note").map(|(_, v)| *v), "{via}: the note at {}..{}", f.start, f.end);
        }
    };
    let gb = format!(
        "LOCUS       PROBE                     30 bp    DNA     linear   SYN 01-JAN-2000\n\
         FEATURES             Location/Qualifiers\n\
         {UNESCAPED_PROBE_TABLE}\
         ORIGIN\n\
         \x20       1 {UNESCAPED_PROBE_SEQ}\n//\n"
    );
    let embl = format!(
        "ID   PROBE; SV 1; linear; genomic DNA; STD; SYN; 30 BP.\nXX\nFH   Key             Location/Qualifiers\nFH\n\
         {}XX\nSQ   Sequence 30 BP;\n     {UNESCAPED_PROBE_SEQ}        30\n//\n",
        UNESCAPED_PROBE_TABLE.lines().map(|l| format!("FT{}\n", &l[2..])).collect::<String>()
    );
    for (via, doc) in [("GenBank", parse_genbank_flatfile(&gb, "PROBE")), ("EMBL", parse_embl_flatfile(&embl, "PROBE"))] {
        read_as(&doc, via);
        read_as(&parse_genbank_flatfile(&export_genbank_flatfile(&doc), "PROBE"), &format!("{via}, then GenBank export and import"));
        read_as(&parse_embl_flatfile(&export_embl_flatfile(&doc), "PROBE"), &format!("{via}, then EMBL export and import"));
    }

    // Biopython's own file of quotes escaped and not, read as Biopython 1.88 reads it.
    if let Some(text) = data_file("biopython-tests/GenBank/qualifier_escaping_read.gb") {
        let doc = parse_genbank_flatfile(&text, "qualifier_escaping_read");
        let want: [(&str, &[(&str, &str)]); 5] = [
            ("source", &[("chromosome", "4"), ("db_xref", "taxon:10090"), ("map", "4 42.6 cM"), ("note", r#""This" is "already" "escaped""#), ("organism", "Mus musculus")]),
            ("Protein", &[("note", r#"One missing "quotation mark" here"#), ("product", "interferon beta, fibroblast")]),
            ("sig_peptide", &[("note", r#"End not properly "escaped""#)]),
            ("Region", &[("db_xref", "CDD:pfam00143"), ("note", r#""Start" not properly escaped"#), ("region_name", "Interferon alpha/beta domain")]),
            ("misc_feature", &[("note", r#"Middle not "properly" escaped"#), ("standard_name", "RP11-242F24")]),
        ];
        let types: Vec<&str> = doc.features.iter().map(|f| f.feature_type.as_str()).collect();
        assert_eq!(types, want.map(|(ty, _)| ty), "qualifier_escaping_read.gb: the features");
        for (f, (ty, q)) in doc.features.iter().zip(want) {
            assert_eq!(sorted_qualifiers(f), owned_pairs(q), "qualifier_escaping_read.gb: the {ty}");
        }
    }

    // A cut inside a run with no space moves back past a doubled quote that would end its line
    // before "/rev=", and a run of "/" with no quote in it keeps its cut at the width.
    let slash_run = "/".repeat(70);
    let doc = parse_genbank_flatfile(
        &format!(
            "LOCUS       SLASH                     30 bp    DNA     linear   SYN 01-JAN-2000\n\
             FEATURES             Location/Qualifiers\n\
             \x20    misc_feature    1..30\n\
             \x20                    /note=\"{}\"\n\
             \x20    misc_feature    1..12\n\
             \x20                    /note=\"{slash_run}\"\n\
             ORIGIN\n\
             \x20       1 {UNESCAPED_PROBE_SEQ}\n//\n",
            SLASH_NOTE.replace('"', "\"\"")
        ),
        "SLASH",
    );
    let notes: Vec<Option<&str>> = doc.features.iter().map(|f| f.notes.as_deref()).collect();
    assert_eq!(notes, [Some(SLASH_NOTE), Some(slash_run.as_str())], "the unwrapped input");
    let slash_cut = SLASH_NOTE.replacen("GGTC\"/rev", "GGTC \"/rev", 1);
    let run_cut = format!("{} {}", &slash_run[..51], &slash_run[51..]);
    let gb = export_genbank_flatfile(&doc);
    let embl = export_embl_flatfile(&doc);
    for (via, table, back) in [
        (
            "GenBank",
            feature_table(gb.lines().skip_while(|l| !l.starts_with("FEATURES")).skip(1).take_while(|l| *l != "ORIGIN").map(String::from)),
            parse_genbank_flatfile(&gb, "SLASH"),
        ),
        ("EMBL", feature_table(embl.lines().filter(|l| l.starts_with("FT")).map(|l| format!("  {}", &l[2..]))), parse_embl_flatfile(&embl, "SLASH")),
    ] {
        let text: String = table.iter().map(|l| format!("{l}\n")).collect();
        assert!(text.contains(MOLBIOCRAFT_79_SLASH_NOTE), "{via}: the cut moved back past the doubled quote before \"/rev=\":\n{text}");
        let i = table.iter().position(|l| l.trim_start().starts_with("/note=\"/")).unwrap_or_else(|| panic!("{via}: no run of \"/\""));
        assert_eq!(
            [table[i].trim(), table[i + 1].trim()],
            [format!("/note=\"{}", &slash_run[..51]), format!("{}\"", &slash_run[51..])],
            "{via}: the run of \"/\""
        );
        let misc: Vec<&molbiocraft_core::SequenceFeature> = back.features.iter().filter(|f| f.feature_type == "misc_feature").collect();
        let notes: Vec<Option<&str>> = misc.iter().map(|f| f.notes.as_deref()).collect();
        assert_eq!(notes, [Some(slash_cut.as_str()), Some(run_cut.as_str())], "{via}: the /notes read back");
        for f in misc {
            assert!(f.qualifiers.as_ref().is_some_and(|q| q.keys().all(|k| matches!(k.as_str(), "label" | "note"))), "{via}: a stray qualifier in {:?}", f.qualifiers);
        }
    }
}

// GenBank ends a DEFINITION with a full stop that is not the description's, so a description that
// itself ends in one is written with two, and the reader drops exactly one; EMBL's DE has no such
// stop and keeps the description as it is. Biopython 1.88 writes and reads both so: the fixtures
// are its output for STOP_WRAPPED, byte for byte (GenBankWriter79 and EmblWriter79 above, with
// SeqRecord(Seq(STOP_SEQ), id="STOP", name="STOP", description=STOP_WRAPPED,
// annotations={"molecule_type": "DNA", "topology": "linear"})), and it reads each back as
// STOP_WRAPPED. Each description below, with a final full stop and without, must be written as
// Biopython writes it and read back unchanged.
//
// What the test catches: an export that writes one full stop in place of the description's own
// ("sp.", the defect); an import that drops every final full stop ("sp"), or none ("Bacillus sp."
// from "Bacillus sp"), or one only on DEFINITION's first line, since the wrapped definition ends on
// a continuation line; an EMBL import that drops DE's final full stop (the defect); and an EMBL
// export that adds one.
const STOP_SEQ: &str = "ATGAGTATTCAACATTTCCGTGTCGCCCTT";
const STOP_WRAPPED: &str = "Synthetic construct carrying the beta-lactamase gene of a soil isolate identified only to genus, Bacillus sp.";
const BIOPYTHON_79_STOP_GB: &str = r#"LOCUS       STOP                      30 bp    DNA     linear   UNK 01-JAN-1980
DEFINITION  Synthetic construct carrying the beta-lactamase gene of a soil
            isolate identified only to genus, Bacillus sp..
ACCESSION   STOP
VERSION     STOP
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
ORIGIN
        1 atgagtattc aacatttccg tgtcgccctt
//
"#;
const BIOPYTHON_79_STOP_EMBL: &str = r#"ID   STOP; ; linear; DNA; ; UNC; 30 BP.
XX
AC   STOP;
XX
DE   Synthetic construct carrying the beta-lactamase gene of a soil isolate
DE   identified only to genus, Bacillus sp.
XX
OS   .
OC   .
XX
FH   Key             Location/Qualifiers
FH
XX
SQ   Sequence 30 BP; 6 A; 8 C; 5 G; 11 T; 0 other;
     atgagtattc aacatttccg tgtcgccctt                                         30
//
"#;

/// A record's lines that begin with `tag`, each with its line break.
fn tagged_lines(record: &str, tag: &str) -> String {
    record.lines().filter(|l| l.starts_with(tag)).map(|l| format!("{l}\n")).collect()
}

#[test]
fn description_full_stop_round_trips() {
    let gb = parse_genbank_flatfile(BIOPYTHON_79_STOP_GB, "STOP");
    assert_eq!(gb.description, STOP_WRAPPED, "Biopython's GenBank output");
    assert_eq!(gb.sequence, STOP_SEQ, "Biopython's GenBank output");
    assert_eq!(parse_embl_flatfile(BIOPYTHON_79_STOP_EMBL, "STOP").description, STOP_WRAPPED, "Biopython's EMBL output");

    // DEFINITION's lines, from DEFINITION to ACCESSION.
    let definition = |record: &str| record[record.find("DEFINITION").expect("DEFINITION")..record.find("ACCESSION").expect("ACCESSION")].to_string();
    for (description, biopython_definition, biopython_de) in [
        ("Bacillus sp.", "DEFINITION  Bacillus sp..\n".to_string(), "DE   Bacillus sp.\n".to_string()),
        ("Bacillus sp", "DEFINITION  Bacillus sp.\n".to_string(), "DE   Bacillus sp\n".to_string()),
        (STOP_WRAPPED, definition(BIOPYTHON_79_STOP_GB), tagged_lines(BIOPYTHON_79_STOP_EMBL, "DE")),
    ] {
        let mut doc = gb.clone();
        doc.description = description.to_string();
        let out = export_genbank_flatfile(&doc);
        assert_eq!(definition(&out), biopython_definition, "{description:?}: DEFINITION as Biopython writes it");
        assert_eq!(parse_genbank_flatfile(&out, "STOP").description, description, "{description:?}: GenBank export and import");
        let out = export_embl_flatfile(&doc);
        assert_eq!(tagged_lines(&out, "DE"), biopython_de, "{description:?}: DE as Biopython writes it");
        assert_eq!(parse_embl_flatfile(&out, "STOP").description, description, "{description:?}: EMBL export and import");
    }
}

// ---- BG-01M6RRQW: where a record ends, and a description that holds line breaks ----------------
//
// A GenBank or EMBL record ends at a line that is "//" from column 1 once its trailing space is
// trimmed (ends_record in flatfiles.rs; splitFlatfileRecords in the importer), the line Biopython
// 1.88 takes for the terminator too (its scanners strip a line's trailing space before they
// compare it with "//"). An indented "//", as on a wrapped DEFINITION, DE or qualifier line, ends
// none, and nor does a line that only begins with "//", such as "//x" or "///". Inside ORIGIN the
// GenBank reader reads on past either, as Biopython 1.88 does; inside SQ the EMBL reader ends the
// record at an indented "//", as Biopython 1.88 does (its EMBL scanner strips a sequence line on
// both sides before it compares it with "//").
//
// EDGE_GB_1 and EDGE_EMBL_1 hold an indented "//" on a wrapped DEFINITION or DE line, on a /note
// line and among the bases, a /note line that begins with "//", and "//x" and "///" in the
// header, and EDGE_GB_1 "//x" among its bases too; EDGE_GB_2 and EDGE_EMBL_2 hold a record after
// them. The first record ends at each of EDGE_TERMINATORS in turn. EDGE_GB_RECORD and
// EDGE_EMBL_RECORD are what Biopython 1.88 reads as the first record of every one of those ten
// files (`SeqIO.parse`, printed as in the note to embl_records_end_at_their_terminator below; it
// reads the second record as EDGE_GB_2 and EDGE_EMBL_2 hold it): the GenBank record with all 40
// bases, the EMBL record with the 20 before its indented "//" (Biopython warns that its ID line
// declares 40).
//
// GenBank's DEFINITION and EMBL's DE cannot hold a line break: both readers, and Biopython 1.88,
// join a description's lines with one space. So each writer writes a description's line breaks,
// with the space around each, as one space. Written raw, a line break started a line of its own in
// column 1, and a description holding a line that is "//" ended its record there: it read back as
// a summary of its declared length with no bases or features, and Biopython 1.88 refused the
// file. A carriage return counts as a line break, since Python, and so Biopython, and the importer
// read one as such. Biopython 1.88 reads each GenBank and EMBL export of DESCRIPTION_BREAKS, and
// of the fuzz's 400 below, with the description the test expects, the record's 40 bases and its
// misc_feature, and no warning. The seeded fuzz puts "\n", "\r\n" and "\r" line breaks, with and
// without space around them, between the words of 400 more descriptions, among words that are or
// begin with "//", flatfile keywords and full stops.
//
// What the test catches: a writer that passes a line break through (the defect), or turns only
// "\n" into a space and leaves "\r", which ends a line for Python and the importer; one that keeps
// the space around a line break, drops a line that is "//", or joins lines with nothing; a reader
// that ends a record at a line which begins with "//" ("//x" in each header), at one that is "//"
// once trimmed on both sides (the indented DEFINITION, DE, /note and ORIGIN lines), or only at one
// that is "//" exactly (each terminator but the first then reads on into the second record); and
// a GenBank reader that ends ORIGIN at an indented "//" (the defect), or reads "//x" there as a
// base, and an EMBL reader that reads on past an indented "//" inside SQ.
const EDGE_GB_1: &str = r#"LOCUS       EDGE1                     40 bp    DNA     linear   SYN 01-JAN-1980
DEFINITION  Synthetic record whose definition, note and bases each hold a line
            //
            that is two slashes once its indent is trimmed.
ACCESSION   EDGE1
VERSION     EDGE1
//x
///
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
     misc_feature    1..40
                     /note="see http:
                     //example.org/edge, then a line that is two slashes:
                     //
                     and the note goes on"
ORIGIN
        1 acgtacgtac gtacgtacgt
    //
//x
       21 ttttaaaacc ccggggtttt
"#;
const EDGE_GB_2: &str = r#"LOCUS       EDGE2                     12 bp    DNA     circular SYN 01-JAN-1980
DEFINITION  Second record, which the first must not read into.
ACCESSION   EDGE2
VERSION     EDGE2
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
     CDS             1..12
                     /gene="selY"
ORIGIN
        1 atgaaaccct aa
//
"#;
const EDGE_EMBL_1: &str = r#"ID   EDGE1; SV 1; linear; DNA; ; SYN; 40 BP.
XX
AC   EDGE1;
XX
DE   Synthetic record whose description, note and bases each hold a line
DE   //
DE   that is two slashes once its tag is set aside.
XX
//x
///
XX
FH   Key             Location/Qualifiers
FH
FT   misc_feature    1..40
FT                   /note="see http:
FT                   //example.org/edge, then a line that is two slashes:
FT                   //
FT                   and the note goes on"
XX
SQ   Sequence 40 BP; 10 A; 10 C; 10 G; 10 T; 0 other;
     acgtacgtac gtacgtacgt                                                    20
     //
     ttttaaaacc ccggggtttt                                                    40
"#;
const EDGE_EMBL_2: &str = r#"ID   EDGE2; SV 1; circular; DNA; ; SYN; 12 BP.
XX
AC   EDGE2;
XX
DE   Second record, which the first must not read into
XX
FH   Key             Location/Qualifiers
FH
FT   CDS             1..12
FT                   /gene="selY"
XX
SQ   Sequence 12 BP; 5 A; 3 C; 1 G; 3 T; 0 other;
     atgaaaccct aa                                                            12
//
"#;

/// The first record's last line, each in turn: "//" alone, then with a trailing space, a tab,
/// three spaces, and a carriage return (a CRLF line end).
const EDGE_TERMINATORS: [&str; 5] = ["//", "// ", "//\t", "//   ", "//\r"];

const EDGE_FEATURES: &[BiopythonFeature] =
    &[("misc_feature", 1, 40, &[("note", "see http: //example.org/edge, then a line that is two slashes: // and the note goes on")])];
const EDGE_GB_RECORD: BiopythonRecord = BiopythonRecord {
    name: "EDGE1",
    accession: "EDGE1",
    description: "Synthetic record whose definition, note and bases each hold a line // that is two slashes once its indent is trimmed",
    length: 40,
    sequence: Some("ACGTACGTACGTACGTACGTTTTTAAAACCCCGGGGTTTT"),
    topology: Topology::Linear,
    features: EDGE_FEATURES,
};
const EDGE_EMBL_RECORD: BiopythonRecord = BiopythonRecord {
    name: "EDGE1",
    accession: "EDGE1",
    description: "Synthetic record whose description, note and bases each hold a line // that is two slashes once its tag is set aside.",
    length: 20,
    sequence: Some("ACGTACGTACGTACGTACGT"),
    topology: Topology::Linear,
    features: EDGE_FEATURES,
};

/// Descriptions with line breaks, each with the description Biopython 1.88 reads from the app's
/// GenBank and from its EMBL export of EDGE_GB_1 carrying it. The first is the defect's.
const DESCRIPTION_BREAKS: &[(&str, &str)] = &[
    ("a\n//\nb", "a // b"),
    ("a\r\n//\r\nb", "a // b"),
    ("a\r//\rb", "a // b"),
    ("\n//\n", "//"),
    ("a \n // \n\n\t//\t\r\nb", "a // // b"),
    ("//x\n///\n//", "//x /// //"),
    (".\na", ". a"),
    ("Escherichia coli str.\nK-12 substr.\nMG1655.", "Escherichia coli str. K-12 substr. MG1655."),
    (
        "Synthetic construct whose description is long enough to wrap before\n//\nthe line that is two slashes",
        "Synthetic construct whose description is long enough to wrap before // the line that is two slashes",
    ),
];

/// The lines of `text` as Python, and so Biopython, and the importer read them: "\r\n", "\r" and
/// "\n" each end one.
fn universal_lines(text: &str) -> Vec<&str> {
    text.split("\r\n").flat_map(|l| l.split(['\r', '\n'])).collect()
}

/// A fuzz description and the description it reads back as: 1 to 40 words, each pair parted by a
/// space or by line breaks with or without space around them, maybe with white space before the
/// first and after the last. No word holds white space, so it reads back as its words joined by
/// one space.
fn fuzz_description(rng: &mut Lcg) -> (String, String) {
    const WORDS: &[&str] = &[
        "//", "//", "//", "///", "//x", "/", "a", "of", "E.", "sp.", "str.", ".", "\"", "ORIGIN", "LOCUS", "FEATURES", "DEFINITION",
        "ID", "DE", "SQ", "XX", "selX", "pUC19", "plasmid", "fragment", "abcdefghijklmnop",
    ];
    const BETWEEN: &[&str] = &[" ", " ", " ", " ", "\n", "\r\n", "\r", "\n\n", " \n", "\n ", "\t\n", "\r\n\r\n", " \r "];
    const ENDS: &[&str] = &["", "", "", "\n", "\r\n", "\r", " \n", "\n\n"];
    let words: Vec<&str> = (0..1 + rng.below(40)).map(|_| rng.pick(WORDS)).collect();
    let mut d = rng.pick(ENDS).to_string();
    for (i, w) in words.iter().enumerate() {
        if i > 0 {
            d.push_str(rng.pick(BETWEEN));
        }
        d.push_str(w);
    }
    d.push_str(rng.pick(ENDS));
    (d, words.join(" "))
}

#[test]
fn record_terminator_edge_cases() {
    type Reader = fn(&str, &str) -> molbiocraft_core::SequenceDocument;
    type Writer = fn(&molbiocraft_core::SequenceDocument) -> String;
    let readers: [(&str, &str, &str, Reader, &BiopythonRecord); 2] = [
        ("GenBank", EDGE_GB_1, EDGE_GB_2, parse_genbank_flatfile, &EDGE_GB_RECORD),
        ("EMBL", EDGE_EMBL_1, EDGE_EMBL_2, parse_embl_flatfile, &EDGE_EMBL_RECORD),
    ];
    for (format, first, second, read, want) in readers {
        for terminator in EDGE_TERMINATORS {
            let text = format!("{first}{terminator}\n{second}");
            reads_as_biopython(&read(&text, "X"), want, &format!("{format} record ending at {terminator:?}, then another"));
        }
    }

    let doc = parse_genbank_flatfile(&format!("{EDGE_GB_1}//\n"), "EDGE");
    let writers: [(&str, Writer, Reader); 2] =
        [("GenBank", export_genbank_flatfile, parse_genbank_flatfile), ("EMBL", export_embl_flatfile, parse_embl_flatfile)];
    type Feature = (String, usize, usize, Vec<(String, String)>);
    let features = |d: &molbiocraft_core::SequenceDocument| -> Vec<Feature> {
        d.features.iter().map(|f| (f.feature_type.clone(), f.start, f.end, sorted_qualifiers(f))).collect()
    };
    // The bases and features each export reads back with, under a description with no line break.
    let controls: Vec<(String, Vec<Feature>)> = writers
        .iter()
        .map(|(_, write, read)| {
            let back = read(&write(&molbiocraft_core::SequenceDocument { description: "x".into(), ..doc.clone() }), "EDGE");
            (back.sequence.clone(), features(&back))
        })
        .collect();
    assert!(
        controls.iter().all(|(bases, feats)| bases.len() == 40 && feats.iter().any(|f| (f.0.as_str(), f.1, f.2) == ("misc_feature", 1, 40))),
        "each export reads back the record's 40 bases and its misc_feature: {controls:?}"
    );

    let mut rng = Lcg(0x5EED_0B6E_2771);
    let fuzz: Vec<(String, String)> = (0..400).map(|_| fuzz_description(&mut rng)).collect();
    let cases = DESCRIPTION_BREAKS.iter().map(|&(d, w)| (d.to_string(), w.to_string(), true)).chain(fuzz.into_iter().map(|(d, w)| (d, w, false)));
    for (description, want, biopython) in cases {
        let with = molbiocraft_core::SequenceDocument { description: description.clone(), ..doc.clone() };
        for ((format, write, read), (bases, feats)) in writers.iter().zip(&controls) {
            let via = format!("{format} export of {description:?}{}", if biopython { " (Biopython 1.88's reading)" } else { "" });
            let out = write(&with);
            let lines = universal_lines(&out);
            let slashed: Vec<usize> = (0..lines.len()).filter(|&i| lines[i].starts_with("//")).collect();
            assert_eq!(slashed, [lines.len() - 2], "{via}: only the record's last line begins with \"//\"\n{out}");
            assert_eq!(lines[lines.len() - 2..], ["//", ""], "{via}: the record's last line\n{out}");
            let back = read(&out, "EDGE");
            assert_eq!(back.description, want, "{via}: the description read back\n{out}");
            assert_eq!((&back.sequence, &features(&back)), (bases, feats), "{via}: the bases and features read back\n{out}");
        }
    }

    // The defect's description, as each writer writes it: the DEFINITION as Biopython 1.88's
    // GenBank writer writes it too (its EMBL writer writes the line break raw, and Biopython then
    // refuses its own file).
    let with = molbiocraft_core::SequenceDocument { description: DESCRIPTION_BREAKS[0].0.into(), ..doc.clone() };
    assert_eq!(tagged_lines(&export_genbank_flatfile(&with), "DEFINITION"), "DEFINITION  a // b.\n", "GenBank: the defect's DEFINITION");
    assert_eq!(tagged_lines(&export_embl_flatfile(&with), "DE "), "DE   a // b\n", "EMBL: the defect's DE");
    // A description of nothing but line breaks and spaces is written as an empty one.
    let blank = molbiocraft_core::SequenceDocument { description: " \n\r\n\t\r".into(), ..doc.clone() };
    let empty = molbiocraft_core::SequenceDocument { description: String::new(), ..doc.clone() };
    for (format, write, _) in writers {
        assert_eq!(write(&blank), write(&empty), "{format}: a description of line breaks and spaces");
    }
}

// A feature can carry a qualifier more than once: almost every NCBI CDS has several /db_xref, a
// selenoprotein with more than one Sec codon a /transl_except for each, and /note, /EC_number and
// /inference repeat too. The reader keeps every value, in file order, in the qualifier's one map
// entry, separated by "\n". No value read from a GenBank or EMBL line holds a newline, since its
// continuation lines are joined with a space or with nothing, so the separator is never part of a
// value; the test checks that of every value it reads. The writers write one line per value.
// BIOPYTHON_79_REPEAT_GB and BIOPYTHON_79_REPEAT_EMBL are Biopython 1.88's output for this record,
// byte for byte (GenBankWriter79 and EmblWriter79 above, with
//
//     cds = SeqFeature(SimpleLocation(0, 90, strand=1), type="CDS",
//                      qualifiers={"gene": ["selX"], "db_xref": ["GeneID:1", "UniProtKB:P1"],
//                                  "transl_except": ["(pos:31..33,aa:Sec)", "(pos:61..63,aa:Sec)"],
//                                  "note": [<the two notes of REPEAT_CDS>],
//                                  "product": ["selenoprotein X"]})
//     misc = SeqFeature(SimpleLocation(30, 63, strand=1), type="misc_feature",
//                       qualifiers={"label": ["Sec codons", "UGA pair"], "gene": ["selX", "selX2"]})
//     rec = SeqRecord(Seq(REPEAT_SEQ), id="REPEAT", name="REPEAT",
//                     description="Synthetic selenoprotein with two Sec codons",
//                     annotations={"molecule_type": "DNA", "topology": "linear"})
//     rec.features = [cds, misc]
//
// ), and REPEAT_CDS and REPEAT_MISC are what Biopython 1.88 reads back from either, each value in
// its order. A layout fixture: the CDS's two TGA codons sit at its codons 11 and 21.
//
// What the test catches: a later value replacing the one before (the defect); every value kept
// but written on one /key line, which reads back as one value; a continuation line joined to the
// first value rather than the last (the second /note wraps); a space put at the start of a later
// value that begins on the line after its key; the feature's name taken from the whole entry,
// newline and all (the misc_feature's /label); and a second /label lost because the export
// writes the feature's name as its /label.
const REPEAT_SEQ: &str = "ATGAAACGTCTGATTGCCGGTCTGCCGGCATGAACCGCTGAAGCGCTGGCAGAACGTCTGTGAGCGGTTCAGCTGGAAGCGCTGCGCTAA";
const REPEAT_CDS: &[(&str, &[&str])] = &[
    ("db_xref", &["GeneID:1", "UniProtKB:P1"]),
    ("gene", &["selX"]),
    (
        "note",
        &[
            "two in-frame UGA codons are read as selenocysteine",
            "both are recoded by a selenocysteine insertion sequence element, which this synthetic record does not include",
        ],
    ),
    ("product", &["selenoprotein X"]),
    ("transl_except", &["(pos:31..33,aa:Sec)", "(pos:61..63,aa:Sec)"]),
];
const REPEAT_MISC: &[(&str, &[&str])] = &[("gene", &["selX", "selX2"]), ("label", &["Sec codons", "UGA pair"])];
const BIOPYTHON_79_REPEAT_GB: &str = r#"LOCUS       REPEAT                    90 bp    DNA     linear   UNK 01-JAN-1980
DEFINITION  Synthetic selenoprotein with two Sec codons.
ACCESSION   REPEAT
VERSION     REPEAT
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
     CDS             1..90
                     /gene="selX"
                     /db_xref="GeneID:1"
                     /db_xref="UniProtKB:P1"
                     /transl_except=(pos:31..33,aa:Sec)
                     /transl_except=(pos:61..63,aa:Sec)
                     /note="two in-frame UGA codons are read as selenocysteine"
                     /note="both are recoded by a selenocysteine insertion
                     sequence element, which this synthetic record does not
                     include"
                     /product="selenoprotein X"
     misc_feature    31..63
                     /label="Sec codons"
                     /label="UGA pair"
                     /gene="selX"
                     /gene="selX2"
ORIGIN
        1 atgaaacgtc tgattgccgg tctgccggca tgaaccgctg aagcgctggc agaacgtctg
       61 tgagcggttc agctggaagc gctgcgctaa
//
"#;
const BIOPYTHON_79_REPEAT_EMBL: &str = r#"ID   REPEAT; ; linear; DNA; ; UNC; 90 BP.
XX
AC   REPEAT;
XX
DE   Synthetic selenoprotein with two Sec codons
XX
OS   .
OC   .
XX
FH   Key             Location/Qualifiers
FH
FT   CDS             1..90
FT                   /gene="selX"
FT                   /db_xref="GeneID:1"
FT                   /db_xref="UniProtKB:P1"
FT                   /transl_except=(pos:31..33,aa:Sec)
FT                   /transl_except=(pos:61..63,aa:Sec)
FT                   /note="two in-frame UGA codons are read as selenocysteine"
FT                   /note="both are recoded by a selenocysteine insertion
FT                   sequence element, which this synthetic record does not
FT                   include"
FT                   /product="selenoprotein X"
FT   misc_feature    31..63
FT                   /label="Sec codons"
FT                   /label="UGA pair"
FT                   /gene="selX"
FT                   /gene="selX2"
XX
SQ   Sequence 90 BP; 19 A; 23 C; 30 G; 18 T; 0 other;
     atgaaacgtc tgattgccgg tctgccggca tgaaccgctg aagcgctggc agaacgtctg        60
     tgagcggttc agctggaagc gctgcgctaa                                         90
//
"#;

#[test]
fn repeated_qualifiers_keep_every_value() {
    let owned = |q: &[(&str, &[&str])]| -> Vec<(String, Vec<String>)> {
        q.iter().map(|(k, vs)| (k.to_string(), vs.iter().map(|v| v.to_string()).collect())).collect()
    };
    for (k, vs) in REPEAT_CDS.iter().chain(REPEAT_MISC) {
        assert!(vs.iter().all(|v| !v.contains('\n')), "Biopython's /{k} holds a newline");
    }
    // A feature's qualifiers by key, each with its values in order, split at the "\n" between them.
    let values = |f: &molbiocraft_core::SequenceFeature| -> Vec<(String, Vec<String>)> {
        let mut q: Vec<(String, Vec<String>)> =
            f.qualifiers.clone().unwrap_or_default().into_iter().map(|(k, v)| (k, v.split('\n').map(String::from).collect())).collect();
        q.sort();
        q
    };
    // After an export the CDS also carries its name as a /label.
    let read_as = |doc: &molbiocraft_core::SequenceDocument, via: &str, exported: bool| {
        let features: Vec<&molbiocraft_core::SequenceFeature> = doc.features.iter().filter(|f| f.feature_type != "source").collect();
        let types: Vec<&str> = features.iter().map(|f| f.feature_type.as_str()).collect();
        assert_eq!(types, ["CDS", "misc_feature"], "{via}: the features");
        let (cds, misc) = (features[0], features[1]);
        let mut want_cds = owned(REPEAT_CDS);
        if exported {
            want_cds.push(("label".to_string(), vec!["selX".to_string()]));
            want_cds.sort();
        }
        // Equal to Biopython's newline-free values, so no value read holds a newline either.
        assert_eq!(values(cds), want_cds, "{via}: the CDS's qualifiers");
        assert_eq!(values(misc), owned(REPEAT_MISC), "{via}: the misc_feature's qualifiers");
        assert_eq!((cds.name.as_str(), misc.name.as_str()), ("selX", "Sec codons"), "{via}: the names, from the first value");
        let notes: Option<Vec<&str>> = cds.notes.as_deref().map(|n| n.split('\n').collect());
        assert_eq!(notes.as_deref(), REPEAT_CDS.iter().find(|(k, _)| *k == "note").map(|(_, v)| *v), "{via}: the CDS's notes");
    };
    let gb = parse_genbank_flatfile(BIOPYTHON_79_REPEAT_GB, "REPEAT");
    assert_eq!(gb.sequence, REPEAT_SEQ);
    let embl = parse_embl_flatfile(BIOPYTHON_79_REPEAT_EMBL, "REPEAT");
    for (via, doc) in [("Biopython's GenBank", gb), ("Biopython's EMBL", embl)] {
        read_as(&doc, via, false);
        let out = export_genbank_flatfile(&doc);
        assert!(out.contains("                     /db_xref=\"GeneID:1\"\n                     /db_xref=\"UniProtKB:P1\"\n"), "{via}: one /db_xref line each:\n{out}");
        read_as(&parse_genbank_flatfile(&out, "REPEAT"), &format!("{via}, then GenBank export and import"), true);
        let out = export_embl_flatfile(&doc);
        assert!(out.contains("FT                   /db_xref=\"GeneID:1\"\nFT                   /db_xref=\"UniProtKB:P1\"\n"), "{via}: one /db_xref line each:\n{out}");
        read_as(&parse_embl_flatfile(&out, "REPEAT"), &format!("{via}, then EMBL export and import"), true);
    }

    // A value that begins on the line after its key reads the same whether it is a qualifier's
    // first value or a later one: with no space at its start, where Biopython 1.88 reads one in
    // (' a second note ...'), as it does for a single value.
    let notes = |qualifiers: &str| {
        let doc = parse_genbank_flatfile(
            &format!(
                "LOCUS       NEXTLINE                  30 bp    DNA     linear   SYN 01-JAN-2000\n\
                 FEATURES             Location/Qualifiers\n\
                 \x20    misc_feature    1..30\n\
                 {qualifiers}\
                 ORIGIN\n//\n"
            ),
            "NEXTLINE",
        );
        doc.features[0].notes.clone()
    };
    let next_line = "                     /note=\"\n                     a second note that begins on the line after its key\"\n";
    assert_eq!(notes(next_line).as_deref(), Some("a second note that begins on the line after its key"), "a single value");
    assert_eq!(
        notes(&format!("                     /note=\"a first note\"\n{next_line}")).as_deref(),
        Some("a first note\na second note that begins on the line after its key"),
        "the second value"
    );
    // A repeat with no value at all adds none, as Biopython 1.88 reads its test file
    // empty_feature_qualifier.gb ('/note="This is a correct note, the following one isn't"', then
    // '/note'); one written `/note=""` adds an empty value.
    assert_eq!(notes("                     /note=\"a first note\"\n                     /note\n").as_deref(), Some("a first note"), "a valueless repeat");
    assert_eq!(notes("                     /note=\"a first note\"\n                     /note=\"\"\n").as_deref(), Some("a first note\n"), "an empty repeat");
}

// MolBioCraft's own GenBank and EMBL export of a qualifier value must read back unchanged through
// its own readers. A fixed-seed generator (Lcg, no crate) makes FUZZ_VALUES values heavy in what a
// line break can lose: "/" words, `/name` and `/name=...` words, quotes and doubled quotes, runs
// with no space, and words of one to three characters, 50 to 400 characters each; fuzz_fixed adds
// the cases a review found by hand, and one more. Each value is a misc_feature's /product (so also
// its name and /label) and its /note, exported through GenBank and through EMBL and read back.
//
// The values stay inside what a 79-column layout can carry exactly: one space between words, none
// at either end, and no word longer than 48 characters once its quotes are doubled, so every word
// fits on a line, the first one after `/product="` included. A run of spaces, and a word longer
// than its line, are the stated limits (`long_prose_qualifiers_round_trip_unchanged`); the one
// longer word in fuzz_fixed is there because the export keeps it whole.
//
// Per value and format the test requires: the value read back unchanged as /product, name, /label
// and /note, with no stray qualifier; every line break at a space, so no word is cut; no line
// holding only a quote other than the value's closing one; Biopython's own layout
// (biopython_layout) wherever that layout has no break the reader misreads (a line ending in
// doubled quotes before a line that names a qualifier); and every line within 79 columns, unless
// no break inside the width is one the reader reads right.
//
// What the test catches: a writer that never moves such a break (the value closes early and the
// rest is read as a stray qualifier); one that moves every break before a "/" line, as round 2 did
// (Biopython's layout lost where nothing needed moving, and words cut where no earlier space was
// left: "se e /Users/...", `"KanR "`, and a line holding a lone quote); one that judges the next
// line by its first word alone, not as it will be cut; one that lets a break moved back leave a
// line that itself names a qualifier; and one that runs a line past the width where an earlier
// space would do.
const FUZZ_VALUES: usize = 5000;
const FUZZ_SEED: u64 = 0x5EED_2026_1106_0003;

/// A fixed-seed linear congruential generator (Knuth's MMIX multiplier and increment), so the
/// fuzz values are the same on every run and machine.
struct Lcg(u64);

impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6_364_136_223_846_793_005).wrapping_add(1_442_695_040_888_963_407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
    fn pick<'a>(&mut self, from: &[&'a str]) -> &'a str {
        from[self.below(from.len())]
    }
}

const FUZZ_NAMES: &[&str] = &[
    "gene", "locus_tag", "product", "note", "db_xref", "inference", "experiment", "standard_name", "old_locus_tag", "function",
    "pseudo", "EC_number", "codon_start", "rev", "a-b", "x", "Users",
];
const FUZZ_SHORT: &[&str] = &["a", "of", "the", "to", "in", "is", "see", "E.", "sp.", "x", "5'", ";", ",", "-", "=", "/", "\"", "\"\"", "x\"", "\"x", "(a)"];
const FUZZ_PIECES: &[&str] = &[
    "/", "/", "/", "\"", "\"", "\"\"", "=", "-", "_", ".", "?", ":", ";", "lab", "Users", "cgi-bin", "view", "id=3", "pUC19", "selW",
    "KanR", "v2.gb", "ACGT", "GGTCTCAACG", "projects",
];

/// `len` characters or a few more of FUZZ_PIECES, run together.
fn fuzz_run(rng: &mut Lcg, len: usize) -> String {
    let mut s = String::new();
    while s.len() < len {
        s.push_str(rng.pick(FUZZ_PIECES));
    }
    s
}

/// One word of a fuzz value: no space, and at most 48 characters once its quotes are doubled.
fn fuzz_word(rng: &mut Lcg) -> String {
    loop {
        let word = match rng.below(12) {
            0 | 1 => rng.pick(FUZZ_SHORT).to_string(),
            2 => format!("/{}", rng.pick(FUZZ_NAMES)),
            3 | 4 => {
                let name = rng.pick(FUZZ_NAMES);
                let len = 1 + rng.below(14);
                format!("/{name}={}", fuzz_run(rng, len))
            }
            5 => {
                let len = 1 + rng.below(10);
                format!("\"{}\"", fuzz_run(rng, len))
            }
            6 => (0..1 + rng.below(5)).map(|_| format!("/{}", rng.pick(&FUZZ_PIECES[13..]))).collect(),
            7 | 8 => {
                let len = 20 + rng.below(26);
                fuzz_run(rng, len)
            }
            9 => (0..4 + rng.below(7)).map(|_| char::from(b'a' + rng.below(26) as u8)).collect(),
            _ => ["\"", "\"\"", "x\"\"", "\"KanR\"", "\"\"x\"\"", "\"/\""][rng.below(6)].to_string(),
        };
        if word.replace('"', "\"\"").len() <= 48 {
            return word;
        }
    }
}

/// A fuzz value of 50 to 400 characters: words joined by one space.
fn fuzz_value(rng: &mut Lcg) -> String {
    let target = 50 + rng.below(351);
    let mut v = fuzz_word(rng);
    while v.len() < target {
        let w = fuzz_word(rng);
        if v.len() + 1 + w.len() > 400 {
            break;
        }
        v.push(' ');
        v.push_str(&w);
    }
    v
}

/// Values a review found by hand: a path after a short word and after a quoted word, each at 16
/// places in its line (round 2 cut "see" and `"KanR"` there), and the /note round 2 left with a
/// line holding a lone quote. One more: a 60-letter name after doubled quotes, longer than its
/// line, which the reader would take for a valueless qualifier on a line of its own after them,
/// so the export keeps it whole beside them on a line past column 79.
fn fuzz_fixed() -> Vec<String> {
    const PATH: &str = "/Users/lab/projects/cloning/pUC19-selW-final-v2.gb";
    let mut v = Vec::new();
    for lead in ["see", "\"KanR\""] {
        for i in 0..16 {
            v.push(format!("{}{lead} {PATH}", "x ".repeat(i)));
        }
    }
    v.push(r#"fields cleared by the "x" /gene /locus_tag /product /note /db_xref /inference /experiment /standard_name /old_locus_tag /function"#.to_string());
    v.push(format!("see \"x\" /{}", "a".repeat(60)));
    v
}

/// Whether the reader takes a feature-table line's text for a qualifier after a line ending in
/// doubled quotes: "/" and a name of letters, digits, `_` or `-`, then "=" or the line's end.
fn names_a_qualifier(line: &str) -> bool {
    line.strip_prefix('/').is_some_and(|body| {
        let name = body.split_once('=').map_or(body, |(k, _)| k);
        !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

/// Whether a line of a quoted value ends in an even run of quotes; a value's first line is read
/// from after its `/key="`.
fn ends_in_doubled_quotes(line: &str, first: bool) -> bool {
    let body = if first { line.split_once("=\"").map_or("", |(_, b)| b) } else { line };
    let run = body.len() - body.trim_end_matches('"').len();
    run > 0 && run % 2 == 0
}

/// Biopython 1.88's layout of a qualifier's text at width 79 (GenBankWriter's
/// `_write_feature_qualifier` with MAX_WIDTH 79): each line ends at the last space that keeps it
/// within 79 columns, or at the width with none.
fn biopython_layout(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    let mut rest = text;
    while rest.len() > 58 {
        let cut = rest.as_bytes()[..=58].iter().rposition(|&b| b == b' ').filter(|&i| i > 1).unwrap_or(58);
        lines.push(rest[..cut].trim_end().to_string());
        rest = rest[cut..].trim_start();
    }
    lines.push(rest.to_string());
    lines
}

/// The first line break of a quoted value's lines that the reader misreads: a line ending in
/// doubled quotes before a line that names a qualifier.
fn misread_break(lines: &[String]) -> Option<usize> {
    lines.windows(2).enumerate().position(|(i, w)| ends_in_doubled_quotes(&w[0], i == 0) && names_a_qualifier(&w[1]))
}

/// What is wrong with one qualifier's exported lines (`lines`, the text after column 22) for its
/// text `/key="..."`, or nothing.
fn layout_fault(text: &str, lines: &[String]) -> Option<String> {
    if lines.join(" ") != text {
        return Some("a line break that is not at a space".into());
    }
    if let Some(i) = lines[..lines.len() - 1].iter().position(|l| l == "\"") {
        return Some(format!("line {} holds a lone quote", i + 1));
    }
    let biopython = biopython_layout(text);
    if misread_break(&biopython).is_none() && lines != biopython.as_slice() {
        return Some(format!("not Biopython's layout, which reads right: {biopython:#?}"));
    }
    // A line past the width: every break inside the width must be one the reader misreads, after
    // the line before or before the line after (cut as Biopython would cut it).
    let mut at = 0;
    for (k, line) in lines.iter().enumerate() {
        if 21 + line.len() > 79 {
            let after_pairs = k > 0 && ends_in_doubled_quotes(&lines[k - 1], k == 1);
            for s in line.match_indices(' ').map(|(s, _)| s).filter(|&s| 21 + s <= 79) {
                let next = &biopython_layout(&text[at + s + 1..])[0];
                let misread = (ends_in_doubled_quotes(&line[..s], k == 0) && names_a_qualifier(next))
                    || (after_pairs && names_a_qualifier(&line[..s]));
                if !misread {
                    return Some(format!("line {} runs past column 79 where a break at {s} reads right", k + 1));
                }
            }
        }
        at += line.len() + 1;
    }
    None
}

// Four generated values whose export moves a break, three to an earlier space and the last
// (1639) past column 79, each with the misc_feature's qualifier lines MolBioCraft exports for it
// and the value Biopython 1.88 reads from those lines as /label, /product and /note alike, as
// GenBank and, behind "FT", as EMBL. Biopython's own writer lays each of the four out so that it
// reads its own output back changed. The readings came from this snippet, run once in a
// throwaway venv with biopython==1.88, `block` being each entry's lines:
//
//     import io; from Bio import SeqIO
//     table = "     misc_feature    1..30\n" + block
//     gb = ("LOCUS       FUZZ                      30 bp    DNA     linear   SYN 01-JAN-2000\n"
//           "FEATURES             Location/Qualifiers\n" + table + "ORIGIN\n//\n")
//     embl = ("ID   FUZZ; SV 1; linear; genomic DNA; STD; SYN; 30 BP.\nXX\n"
//             "FH   Key             Location/Qualifiers\nFH\n"
//             + "".join("FT" + l[2:] + "\n" for l in table.splitlines())
//             + "XX\nSQ   Sequence 0 BP;\n//\n")
//     for text, fmt in ((gb, "genbank"), (embl, "embl")):
//         q = SeqIO.read(io.StringIO(text), fmt).features[0].qualifiers
//         print(sorted(q), {q["label"][0], q["product"][0], q["note"][0]})
//
// which printed ['label', 'note', 'product'] and one value each time. Of all 5,000 generated
// values, Biopython 1.88 reads MolBioCraft's export back unchanged for 2,433 in each format,
// every value it reads back from its own writer's output (1,800) among them. Each of the rest
// has a line ending in doubled quotes and, later in the same value, a line beginning with "/",
// where Biopython starts a new qualifier (see QuoteEnd::EvenRun), and Biopython reads none of
// them back from its own writer's output either.
const BIOPYTHON_79_FUZZ_SAMPLE: [(usize, &str, &str); 4] = [
    (
        4969,
        r#"                     /label="""/"" ""KanR"" /cgi-bin/view a
                     "" /locus_tag=projects x"""
                     /product="""/"" ""KanR"" /cgi-bin/view a
                     "" /locus_tag=projects x"""
                     /note="""/"" ""KanR"" /cgi-bin/view a
                     "" /locus_tag=projects x"""
"#,
        r#""/" "KanR" /cgi-bin/view a " /locus_tag=projects x""#,
    ),
    (
        2283,
        r#"                     /label="ythqdvoi """" = "" /standard_name=Usersview""pUC19
                     /product"
                     /product="ythqdvoi """" =
                     "" /standard_name=Usersview""pUC19 /product"
                     /note="ythqdvoi """" = "" /standard_name=Usersview""pUC19
                     /product"
"#,
        r#"ythqdvoi "" = " /standard_name=Usersview"pUC19 /product"#,
    ),
    (
        3638,
        r#"                     /label="pqqlwyddx ; /old_locus_tag="".selW
                     "" /db_xref=""selWcgi-bin"
                     /product="pqqlwyddx ; /old_locus_tag="".selW
                     "" /db_xref=""selWcgi-bin"
                     /note="pqqlwyddx ; /old_locus_tag="".selW
                     "" /db_xref=""selWcgi-bin"
"#,
        r#"pqqlwyddx ; /old_locus_tag=".selW " /db_xref="selWcgi-bin"#,
    ),
    (
        1639,
        r#"                     /label="5'
                     ACGTviewprojects.pUC19/GGTCTCAACGselW_"" /codon_start=GGTCTCAACG"
                     /product="5'
                     ACGTviewprojects.pUC19/GGTCTCAACGselW_"" /codon_start=GGTCTCAACG"
                     /note="5'
                     ACGTviewprojects.pUC19/GGTCTCAACGselW_"" /codon_start=GGTCTCAACG"
"#,
        r#"5' ACGTviewprojects.pUC19/GGTCTCAACGselW_" /codon_start=GGTCTCAACG"#,
    ),
];

#[test]
fn own_export_reads_back_unchanged_fuzz() {
    let mut rng = Lcg(FUZZ_SEED);
    let generated: Vec<String> = (0..FUZZ_VALUES).map(|_| fuzz_value(&mut rng)).collect();
    assert!(generated.iter().all(|v| (50..=400).contains(&v.len())));
    let values: Vec<String> = fuzz_fixed().into_iter().chain(generated.iter().cloned()).collect();
    let record = |v: &str| {
        let e = v.replace('"', "\"\"");
        format!(
            "LOCUS       FUZZ                      30 bp    DNA     linear   SYN 01-JAN-2000\n\
             FEATURES             Location/Qualifiers\n\
             \x20    misc_feature    1..30\n\
             \x20                    /product=\"{e}\"\n\
             \x20                    /note=\"{e}\"\n\
             ORIGIN\n\
             \x20       1 {UNESCAPED_PROBE_SEQ}\n//\n"
        )
    };
    // The misc_feature's /product, name, /label and /note, and any other qualifier.
    type Read = (String, String, String, String, Vec<String>);
    let read = |doc: &molbiocraft_core::SequenceDocument| -> Option<Read> {
        let misc: Vec<&molbiocraft_core::SequenceFeature> = doc.features.iter().filter(|f| f.feature_type == "misc_feature").collect();
        let [f] = misc.as_slice() else { return None };
        let q = f.qualifiers.clone().unwrap_or_default();
        let stray = q.keys().filter(|k| !matches!(k.as_str(), "label" | "product" | "note")).cloned().collect();
        let get = |k: &str| q.get(k).cloned().unwrap_or_default();
        Some((get("product"), f.name.clone(), get("label"), f.notes.clone().unwrap_or_default(), stray))
    };
    let (mut misread, mut faulty, mut over_width) = ([0usize; 2], [0usize; 2], 0usize);
    let mut examples: Vec<String> = Vec::new();
    for v in &values {
        let doc = parse_genbank_flatfile(&record(v), "FUZZ");
        let unwrapped = read(&doc).expect("one misc_feature");
        assert_eq!((&unwrapped.0, &unwrapped.3, unwrapped.4.len()), (v, v, 0), "the unwrapped input");
        let gb = export_genbank_flatfile(&doc);
        let embl = export_embl_flatfile(&doc);
        let gb_table: Vec<String> =
            gb.lines().skip_while(|l| !l.starts_with("     misc_feature")).skip(1).take_while(|l| *l != "ORIGIN").map(String::from).collect();
        let embl_table: Vec<String> =
            embl.lines().skip_while(|l| !l.starts_with("FT   misc_feature")).skip(1).filter(|l| l.starts_with("FT")).map(|l| format!("  {}", &l[2..])).collect();
        let want: Read = (v.clone(), v.clone(), v.clone(), v.clone(), Vec::new());
        for (f, (via, back, table)) in
            [("GenBank", parse_genbank_flatfile(&gb, "FUZZ"), gb_table), ("EMBL", parse_embl_flatfile(&embl, "FUZZ"), embl_table)].into_iter().enumerate()
        {
            let got = read(&back);
            if got.as_ref() != Some(&want) {
                misread[f] += 1;
                if examples.len() < 6 {
                    examples.push(format!("{via} read back {got:#?}\nfor {v:?}\nfrom\n{}", table.join("\n")));
                }
                continue;
            }
            // The export's lines, split into the /label, /product and /note by their texts.
            let mut lines = table.iter().map(|l| l.trim().to_string());
            for text in ["label", "product", "note"].map(|k| format!("/{k}=\"{}\"", v.replace('"', "\"\""))) {
                let mut own: Vec<String> = Vec::new();
                while own.iter().map(|l| l.len() + 1).sum::<usize>() < text.len() + 1 {
                    let Some(line) = lines.next() else { break };
                    own.push(line);
                }
                over_width += own.iter().filter(|l| 21 + l.len() > 79).count();
                let fault = if own.is_empty() { Some("no lines".to_string()) } else { layout_fault(&text, &own) };
                if let Some(fault) = fault {
                    faulty[f] += 1;
                    if examples.len() < 6 {
                        examples.push(format!("{via}: {fault}\nfor {text}\nas\n{}", own.join("\n")));
                    }
                    break;
                }
            }
        }
    }
    assert!(
        misread == [0, 0] && faulty == [0, 0],
        "of {} values, GenBank and EMBL export read back changed {misread:?} times and were laid out wrong {faulty:?} times:\n{}",
        values.len(),
        examples.join("\n\n")
    );
    eprintln!("{} values; {over_width} exported lines past column 79", values.len());

    // The bytes Biopython 1.88 read are still the export, and it read each value unchanged.
    for (i, block, biopython_read) in BIOPYTHON_79_FUZZ_SAMPLE {
        assert_eq!(generated[i], biopython_read, "fuzz value {i}: as Biopython read it");
        let doc = parse_genbank_flatfile(&record(&generated[i]), "FUZZ");
        let gb = export_genbank_flatfile(&doc);
        assert!(gb.contains(&format!("     misc_feature    1..30\n{block}ORIGIN\n")), "fuzz value {i}: GenBank as Biopython read it:\n{gb}");
        let ft: String = block.lines().map(|l| format!("FT{}\n", &l[2..])).collect();
        let embl = export_embl_flatfile(&doc);
        assert!(embl.contains(&format!("FT   misc_feature    1..30\n{ft}XX\n")), "fuzz value {i}: EMBL as Biopython read it:\n{embl}");
    }
}

// After a line ending in doubled quotes, a line that begins with "/" closes the value only when it
// names a qualifier: "/" and a name of letters, digits, `_` or `-`, then "=" or the line's end. A
// "/" line whose would-be name holds other punctuation, a URL path or a dotted name, stays in the
// value, and the /gene after it is still read. Biopython 1.88 reads each "/" line here as a new
// qualifier ('cgi-bin/view?id', 'v1.2'), as it reads any line beginning with "/" after a line
// ending in a quote, which is where the two readers part (see QuoteEnd::EvenRun). What the test
// catches: a reader that takes any name without a space for a qualifier.
const SLASH_PROSE_TABLE: &str = r#"     misc_feature    1..30
                     /note="see ""x""
                     /cgi-bin/view?id=3 for details"
                     /gene="bla"
     misc_feature    1..12
                     /note="released as ""selW""
                     /v1.2=final"
"#;

#[test]
fn slash_prose_after_doubled_quotes_stays_in_the_value() {
    let want: [&[(&str, &str)]; 2] =
        [&[("gene", "bla"), ("note", r#"see "x" /cgi-bin/view?id=3 for details"#)], &[("note", r#"released as "selW" /v1.2=final"#)]];
    let gb = format!(
        "LOCUS       PROSE                     30 bp    DNA     linear   SYN 01-JAN-2000\n\
         FEATURES             Location/Qualifiers\n\
         {SLASH_PROSE_TABLE}\
         ORIGIN\n\
         \x20       1 {UNESCAPED_PROBE_SEQ}\n//\n"
    );
    let embl = format!(
        "ID   PROSE; SV 1; linear; genomic DNA; STD; SYN; 30 BP.\nXX\nFH   Key             Location/Qualifiers\nFH\n\
         {}XX\nSQ   Sequence 30 BP;\n     {UNESCAPED_PROBE_SEQ}        30\n//\n",
        SLASH_PROSE_TABLE.lines().map(|l| format!("FT{}\n", &l[2..])).collect::<String>()
    );
    for (via, doc) in [("GenBank", parse_genbank_flatfile(&gb, "PROSE")), ("EMBL", parse_embl_flatfile(&embl, "PROSE"))] {
        let got: Vec<Vec<(String, String)>> = doc.features.iter().map(sorted_qualifiers).collect();
        assert_eq!(got, want.map(owned_pairs), "{via}: the qualifiers");
        let back = parse_genbank_flatfile(&export_genbank_flatfile(&doc), "PROSE");
        let notes: Vec<Option<&str>> = back.features.iter().filter(|f| f.feature_type != "source").map(|f| f.notes.as_deref()).collect();
        assert_eq!(notes, [Some(want[0][1].1), Some(want[1][0].1)], "{via}, then GenBank export and import: the notes");
    }
}

// A record of a GenBank or EMBL file ends at its "//" line, and one without a sequence block (a
// CON record, with CONTIG or CO lines and no ORIGIN or SQ) ends there too. Each reader, given a
// file from a record's first line on (for the first record, the whole file, as the parse_genbank
// and parse_embl ops receive it), reads that record alone; the app's importer splits a file at the
// same lines (splitFlatfileRecords) before it reads each record, and reads the same.
//
// The pins are what Biopython 1.88 reads, run with `python -I` in a venv outside the repo:
//
//     from Bio import SeqIO
//     records = list(SeqIO.parse(path, fmt))  # fmt "embl" or "genbank"
//     print(len(records))
//     for r in records:
//         print(r.name, r.annotations["accessions"][0], repr(r.description), len(r),
//               r.seq.defined and str(r.seq), r.annotations["topology"],
//               [(f.type, int(f.location.start) + 1, int(f.location.end), dict(f.qualifiers))
//                for f in r.features])
//
// test-data's Human_contigs.embl holds two CON records. NOSEQ_GB and NOSEQ_EMBL are Biopython
// 1.88's GenBank and EMBL output for two records, the first written with its sequence undefined
// and its empty ORIGIN or SQ line then replaced by a CONTIG or CO line, as a CON record has; its
// /note wraps before a "//" word, as Biopython's writer and the app's own wrap it.
//
// What the test catches: a reader that ends a record only at the "//" after its sequence (the
// defect), which reads on into the next record and takes its ID or LOCUS name, its topology, its
// features, its DE text (appended to the first record's) or DEFINITION (in its place) and, in
// NOSEQ_GB and NOSEQ_EMBL, its bases; and a GenBank reader that ends a record at a line which
// begins with "//" once its indent is trimmed, the test the reader applies inside ORIGIN, which
// cuts the first record's /note at its continuation line, in NOSEQ_GB and, since the EMBL reader
// hands its record to the GenBank reader, in NOSEQ_EMBL. Each record is also read alone, as the
// importer reads it, which the defect never reached.
const NOSEQ_GB: &str = r#"LOCUS       NOSEQ1                   120 bp    DNA     linear   SYN 01-JAN-1980
DEFINITION  Synthetic contig whose bases are held only in its two parts.
ACCESSION   NOSEQ1
VERSION     NOSEQ1
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
     source          1..120
                     /organism="synthetic construct"
                     /mol_type="other DNA"
     misc_feature    1..60
                     /note="first half of the contig, held in PART1, up to the
                     // that joins it to PART2"
CONTIG      join(PART1.1:1..60,PART2.1:1..60)
//
LOCUS       SEQ2                      30 bp    DNA     circular SYN 01-JAN-1980
DEFINITION  Synthetic plasmid fragment that carries its own bases.
ACCESSION   SEQ2
VERSION     SEQ2
KEYWORDS    .
SOURCE      .
  ORGANISM  .
            .
FEATURES             Location/Qualifiers
     CDS             1..30
                     /gene="selX"
ORIGIN
        1 atgagtattc aacatttccg tgtcgccctt
//
"#;
const NOSEQ_EMBL: &str = r#"ID   NOSEQ1; ; linear; DNA; ; SYN; 120 BP.
XX
AC   NOSEQ1;
XX
DE   Synthetic contig whose bases are held only in its two parts
XX
OS   .
OC   .
XX
FH   Key             Location/Qualifiers
FH
FT   source          1..120
FT                   /organism="synthetic construct"
FT                   /mol_type="other DNA"
FT   misc_feature    1..60
FT                   /note="first half of the contig, held in PART1, up to the
FT                   // that joins it to PART2"
XX
CO   join(PART1.1:1..60,PART2.1:1..60)
//
ID   SEQ2; ; circular; DNA; ; SYN; 30 BP.
XX
AC   SEQ2;
XX
DE   Synthetic plasmid fragment that carries its own bases
XX
OS   .
OC   .
XX
FH   Key             Location/Qualifiers
FH
FT   CDS             1..30
FT                   /gene="selX"
XX
SQ   Sequence 30 BP; 6 A; 8 C; 5 G; 11 T; 0 other;
     atgagtattc aacatttccg tgtcgccctt                                         30
//
"#;

/// A feature as Biopython 1.88 reads it: type, 1-based start and end, and qualifiers.
type BiopythonFeature = (&'static str, usize, usize, &'static [(&'static str, &'static str)]);

/// A record as Biopython 1.88 reads it; `sequence` is `None` where its sequence is undefined.
struct BiopythonRecord {
    name: &'static str,
    accession: &'static str,
    description: &'static str,
    length: usize,
    sequence: Option<&'static str>,
    topology: Topology,
    features: &'static [BiopythonFeature],
}

const NOSEQ_RECORDS: [BiopythonRecord; 2] = [
    BiopythonRecord {
        name: "NOSEQ1",
        accession: "NOSEQ1",
        description: "Synthetic contig whose bases are held only in its two parts",
        length: 120,
        sequence: None,
        topology: Topology::Linear,
        features: &[
            ("source", 1, 120, &[("mol_type", "other DNA"), ("organism", "synthetic construct")]),
            ("misc_feature", 1, 60, &[("note", "first half of the contig, held in PART1, up to the // that joins it to PART2")]),
        ],
    },
    BiopythonRecord {
        name: "SEQ2",
        accession: "SEQ2",
        description: "Synthetic plasmid fragment that carries its own bases",
        length: 30,
        sequence: Some("ATGAGTATTCAACATTTCCGTGTCGCCCTT"),
        topology: Topology::Circular,
        features: &[("CDS", 1, 30, &[("gene", "selX")])],
    },
];

const HUMAN_CONTIGS_RECORDS: [BiopythonRecord; 2] = [
    BiopythonRecord {
        name: "AJ229040",
        accession: "AJ229040",
        description: "Homo sapiens 959 kb contig between AML1 and CBR1 on chromosome 21q22",
        length: 958952,
        sequence: None,
        topology: Topology::Linear,
        features: &[(
            "source",
            1,
            958952,
            &[("chromosome", "21"), ("db_xref", "taxon:9606"), ("map", "q22"), ("mol_type", "genomic DNA"), ("organism", "Homo sapiens")],
        )],
    },
    BiopythonRecord {
        name: "AL954800",
        accession: "AL954800",
        description: "Human chromosome 14 complete sequence",
        length: 87191216,
        sequence: None,
        topology: Topology::Linear,
        features: &[(
            "source",
            1,
            87191216,
            &[("chromosome", "14"), ("db_xref", "taxon:9606"), ("mol_type", "genomic DNA"), ("organism", "Homo sapiens")],
        )],
    },
];

/// Each record of a flatfile twice: its own text, up to and including its "//" line, and the
/// text from its first line to the file's end. A record ends at a line that is "//" once its
/// trailing space is trimmed, as Biopython 1.88 and splitFlatfileRecords end one.
fn records_of(text: &str) -> Vec<(&str, &str)> {
    let mut starts = vec![0];
    let mut offset = 0;
    for line in text.split_inclusive('\n') {
        offset += line.len();
        if line.trim_end() == "//" {
            starts.push(offset);
        }
    }
    if text[*starts.last().unwrap_or(&0)..].trim().is_empty() {
        starts.pop();
    }
    starts.iter().enumerate().map(|(i, &s)| (&text[s..starts.get(i + 1).copied().unwrap_or(text.len())], &text[s..])).collect()
}

/// Asserts that `doc` reads as Biopython 1.88 reads `want`. A record without bases reads as an
/// empty sequence of its declared length.
fn reads_as_biopython(doc: &molbiocraft_core::SequenceDocument, want: &BiopythonRecord, via: &str) {
    let declared = doc.doc_metadata.as_ref().and_then(|m| m.get("Declared Length")).and_then(|v| v.as_u64()).unwrap_or(0) as usize;
    let length = if doc.sequence.is_empty() { declared } else { doc.sequence.len() };
    let sequence = (!doc.sequence.is_empty()).then_some(doc.sequence.as_str());
    assert_eq!(
        (doc.name.as_str(), doc.accession.as_str(), doc.description.as_str(), length, sequence, doc.topology),
        (want.name, want.accession, want.description, want.length, want.sequence, want.topology),
        "{via}: name, accession, description, length, sequence and topology"
    );
    type Feature = (String, usize, usize, Vec<(String, String)>);
    let features: Vec<Feature> = doc.features.iter().map(|f| (f.feature_type.clone(), f.start, f.end, sorted_qualifiers(f))).collect();
    let want_features: Vec<Feature> = want.features.iter().map(|(t, s, e, q)| (t.to_string(), *s, *e, owned_pairs(q))).collect();
    assert_eq!(features, want_features, "{via}: the features");
}

#[test]
fn embl_records_end_at_their_terminator() {
    type Reader = fn(&str, &str) -> molbiocraft_core::SequenceDocument;
    let check = |file: &str, text: &str, read: Reader, want: &[BiopythonRecord]| {
        let records = records_of(text);
        assert_eq!(records.len(), want.len(), "{file}: the records, as Biopython 1.88 counts them");
        for (i, ((own, to_end), want)) in records.iter().zip(want).enumerate() {
            reads_as_biopython(&read(to_end, "X"), want, &format!("{file} read from record {} on", i + 1));
            reads_as_biopython(&read(own, "X"), want, &format!("{file} record {} read alone", i + 1));
        }
    };
    check("NOSEQ_EMBL", NOSEQ_EMBL, parse_embl_flatfile, &NOSEQ_RECORDS);
    check("NOSEQ_GB", NOSEQ_GB, parse_genbank_flatfile, &NOSEQ_RECORDS);
    if let Some(text) = data_file("biopython-tests/EMBL/Human_contigs.embl") {
        check("Human_contigs.embl", &text, parse_embl_flatfile, &HUMAN_CONTIGS_RECORDS);
    }
}

// ---- BG-01M6RPCA: a read with no good base trims to no region ----------------------------------
//
// The Mott trim keeps the stretch of bases with the highest sum of (cutoff - P(err)), where
// P(err) = 10^(-Q/10). A stretch scores above zero exactly when one of its bases has an error
// probability below the cutoff, so a read with no such base has no high-quality region, and the
// trim reports none: trim_start_1based 1 and trim_end_1based 0 (the empty 1-based interval), 0 bp
// kept, no sequence, no mixed-peak consensus and no mixed peaks. It used to fall back to the whole
// read (D0027). The viewport's HQ window is the same trim at its fixed 0.05, and reports the same
// empty interval. A read the trim cannot score (no quality value for every call) is not trimmed and
// keeps every base, as before (D0030).
//
// Wrong implementations, and the case that catches each:
// - the whole-read fallback (the bug): the Q0 and Q13 reads, and 310.ab1 (868 bp, Q0 throughout);
// - no region only when every quality is 0: the Q13 read (P(err) 0.0501, just over 0.05);
// - no region whenever some base misses the cutoff: the read with Q2 ends, trimmed to 7..19;
// - no region whenever the trim keeps the whole read: the Q14 read (P(err) 0.0398), kept 1..30;
// - the cutoff fixed at 0.05: the Q17 read (P(err) 0.0200), a region at 0.05 and none at 0.01;
// - no region for a read the trim cannot score: the read with no qualities and the 29-for-30 read;
// - an empty region given coordinates that hold a base (1..1, or the read's last base): every
//   case checks its coordinates against the bases it keeps, and an empty read is 1..0 too;
// - the whole read's mixed peaks counted as the region's: the Q0 read's two;
// - the viewport's window computed apart from the trim, or left at the whole read: the viewport
//   reply is checked against the trim at 0.05 on every case, and as JSON, the form WASM, IPC and
//   REST carry it in.

/// A file of the reference-data folder as bytes, under the same rules as `data_file`.
fn rpca_data_bytes(rel: &str) -> Option<Vec<u8>> {
    let required = data_required();
    let p = test_data_dir().join(rel);
    match std::fs::read(&p) {
        Ok(b) => Some(b),
        Err(e) if matches!(e.kind(), std::io::ErrorKind::NotFound | std::io::ErrorKind::NotADirectory) => {
            assert!(!required, "reference data required (MOLBIOCRAFT_REQUIRE_TEST_DATA=1) but absent: {}", p.display());
            eprintln!("skipped: reference data absent ({})", p.display());
            None
        }
        Err(e) => panic!("{}: unreadable: {e}", p.display()),
    }
}

/// A trace of `calls` calls (ACGT repeated) with these quality values, one peak every 10 samples;
/// the calls at `mixed` (1-based) carry a second peak half as tall as the first, a mixed IUPAC call.
fn rpca_trace(calls: usize, phred: &[u8], mixed: &[usize]) -> molbiocraft_core::ChromatogramData {
    let bases: Vec<char> = "ACGT".chars().cycle().take(calls).collect();
    let mut traces = [vec![0.0; calls * 10], vec![0.0; calls * 10], vec![0.0; calls * 10], vec![0.0; calls * 10]];
    for (i, &b) in bases.iter().enumerate() {
        let ch = "ACGT".find(b).unwrap();
        traces[ch][i * 10 + 5] = 1000.0;
        if mixed.contains(&(i + 1)) {
            traces[(ch + 1) % 4][i * 10 + 5] = 500.0;
        }
    }
    let [trace_a, trace_c, trace_g, trace_t] = traces;
    molbiocraft_core::ChromatogramData {
        trace_a,
        trace_c,
        trace_g,
        trace_t,
        peak_locations: (0..calls).map(|i| i * 10 + 5).collect(),
        phred_scores: phred.to_vec(),
        base_calls: bases.into_iter().collect(),
    }
}

/// What a trim report says it kept, after checking that its coordinates hold exactly the bases it
/// kept: (start, end, kept bp, kept sequence, mixed peaks in it).
fn rpca_kept(name: &str, r: &molbiocraft_formats::MottPhredTrimReport) -> (usize, usize, usize, String, usize) {
    assert_eq!((r.trim_end_1based + 1).checked_sub(r.trim_start_1based), Some(r.trimmed_length_bp), "{name}: the coordinates hold the kept bases");
    assert!(r.trim_start_1based >= 1 && r.trim_end_1based <= r.raw_length_bp, "{name}: the coordinates lie in the read");
    assert_eq!(r.trimmed_sequence.len(), r.trimmed_length_bp, "{name}: the kept sequence");
    assert_eq!(r.iupac_heterozygote_consensus.len(), r.trimmed_length_bp, "{name}: the kept mixed-peak consensus");
    (r.trim_start_1based, r.trim_end_1based, r.trimmed_length_bp, r.trimmed_sequence.clone(), r.heterozygote_count)
}

/// A read, the cutoff it is trimmed at, and the region the trim keeps of it as (start, end, kept
/// bp, mixed peaks in it), or None for no region.
type RpcaCase = (&'static str, molbiocraft_core::ChromatogramData, f64, Option<(usize, usize, usize, usize)>);

fn rpca_cases() -> Vec<RpcaCase> {
    let ends = [vec![2u8; 6], vec![40; 13], vec![2; 6]].concat();
    vec![
        ("Q0", rpca_trace(25, &[0; 25], &[3, 12]), 0.05, None),
        ("Q13", rpca_trace(30, &[13; 30], &[]), 0.05, None),
        ("Q2 ends", rpca_trace(25, &ends, &[3, 12]), 0.05, Some((7, 19, 13, 1))),
        ("Q14", rpca_trace(30, &[14; 30], &[]), 0.05, Some((1, 30, 30, 0))),
        ("Q17 at 0.05", rpca_trace(30, &[17; 30], &[]), 0.05, Some((1, 30, 30, 0))),
        ("Q17 at 0.01", rpca_trace(30, &[17; 30], &[]), 0.01, None),
        ("no qualities", rpca_trace(30, &[], &[4]), 0.05, Some((1, 30, 30, 1))),
        ("29 for 30", rpca_trace(30, &[40; 29], &[]), 0.05, Some((1, 30, 30, 0))),
        ("empty", rpca_trace(0, &[], &[]), 0.05, None),
    ]
}

#[test]
fn all_bad_quality_trims_to_no_region() {
    for (name, chrom, cutoff, want) in rpca_cases() {
        let r = trim_sanger_trace_mott_phred(&chrom, cutoff);
        let (start, end, len, seq, mixed) = rpca_kept(name, &r);
        assert_eq!(r.raw_length_bp, chrom.base_calls.len(), "{name}: the read's length");
        match want {
            None => {
                assert_eq!((start, end, len, seq.as_str(), mixed), (1, 0, 0, "", 0), "{name}: no region");
                assert_eq!((r.expected_errors_trimmed, r.mean_phred_trimmed), (0.0, 0.0), "{name}: nothing kept to score");
            }
            Some((s, e, l, m)) => {
                assert_eq!((start, end, len, mixed), (s, e, l, m), "{name}: the region");
                assert_eq!(seq, chrom.base_calls[s - 1..e], "{name}: the kept sequence");
            }
        }
    }
    // The Q0 read's errors are still counted over the whole read: one per base.
    assert_eq!(trim_sanger_trace_mott_phred(&rpca_trace(25, &[0; 25], &[3, 12]), 0.05).expected_errors_raw, 25.0);

    if let Some(bytes) = rpca_data_bytes("biopython-abi/310.ab1") {
        let chrom = parse_binary_sequence_packet(&bytes, "310.ab1").chromatogram.expect("310.ab1: traces");
        // The file is the case it stands for: a quality value for every call, and every one 0.
        assert_eq!((chrom.base_calls.len(), chrom.phred_scores.len(), chrom.phred_scores.iter().max().copied()), (868, 868, Some(0)));
        let r = trim_sanger_trace_mott_phred(&chrom, 0.05);
        assert_eq!(rpca_kept("310.ab1", &r), (1, 0, 0, String::new(), 0), "310.ab1: no region");
        assert_eq!(r.raw_length_bp, 868);
    }
}

#[test]
fn viewport_reply_has_no_trimmed_region_for_an_all_bad_read() {
    let window = |chrom: &molbiocraft_core::ChromatogramData| {
        let vp = compute_chromatogram_viewport(chrom, 0, 40, false, true, 1.0, 150.0, 120.0);
        let wire = serde_json::to_value(&vp).expect("the reply serializes");
        assert_eq!(
            (wire["hqTrimStart1based"].as_u64(), wire["hqTrimEnd1based"].as_u64()),
            (Some(vp.hq_trim_start_1based as u64), Some(vp.hq_trim_end_1based as u64)),
            "the reply carries the window as hqTrimStart1based and hqTrimEnd1based"
        );
        vp
    };
    // The viewport's window is the trim at 0.05 for every read whose qualities score every call.
    for (name, chrom, cutoff, want) in rpca_cases() {
        if cutoff != 0.05 || chrom.phred_scores.len() != chrom.base_calls.len() || chrom.base_calls.is_empty() {
            continue;
        }
        let vp = window(&chrom);
        let trim = trim_sanger_trace_mott_phred(&chrom, 0.05);
        assert!(vp.has_quality_values, "{name}: the read has quality values");
        assert_eq!((vp.hq_trim_start_1based, vp.hq_trim_end_1based), (trim.trim_start_1based, trim.trim_end_1based), "{name}: the window is the trim's");
        let expected = want.map_or((1, 0), |(s, e, _, _)| (s, e));
        assert_eq!((vp.hq_trim_start_1based, vp.hq_trim_end_1based), expected, "{name}: the window");
    }
    // A read with no quality values is told apart from one with no good base.
    assert!(!window(&rpca_trace(30, &[], &[])).has_quality_values);

    if let Some(bytes) = rpca_data_bytes("biopython-abi/310.ab1") {
        let chrom = parse_binary_sequence_packet(&bytes, "310.ab1").chromatogram.expect("310.ab1: traces");
        let vp = window(&chrom);
        assert!(vp.has_quality_values, "310.ab1 has a quality value for every call");
        assert_eq!((vp.hq_trim_start_1based, vp.hq_trim_end_1based), (1, 0), "310.ab1: no window");
    }
}
