// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! BG-01M6SMBS: a join whose parts are each complemented, `join(complement(b),complement(a))`, is
//! the same minus-strand feature as `complement(join(a,b))`, and the GenBank importer stores it the
//! same way: on the minus strand, with its parts in the reverse of the listed order, numbered 1..n
//! in that order. A join that mixes plus- and minus-strand parts cannot be held by one feature,
//! which carries one strand; it keeps its listed order on the plus strand, and the imported
//! document's Notes say so in the D0005 "Warnings:" block.
//!
//! The records are written here, inline, by a port of the `seededDna` and `genbankRecord` helpers
//! of src/__tests__/sequenceSearchStats.test.tsx (SEQ_600 = `seededDna(600, 41)`), so no test-data
//! is read. Biopython 1.88 (`SeqIO.read(text, 'genbank')`, recorded 2026-11-07 on exactly these
//! records) parses each per-part form to the location of its complement(join(...)) form here:
//! join(complement(101..160),complement(11..40)) to [100:160](-), [10:40](-), which is
//! complement(join(11..40,101..160)); and so on for the 3-part and ascending-listed forms.

use molbiocraft_core::SequenceDocument;
use molbiocraft_formats::parse_genbank_flatfile;

/// Seeded ACGT (an LCG's top two bits), `seededDna` of the Vitest suites.
fn seeded_dna(length: usize, seed: u32) -> String {
    let mut x = seed;
    (0..length)
        .map(|_| {
            x = x.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            b"ACGT"[(x >> 30) as usize] as char
        })
        .collect()
}

/// The GenBank text `genbankRecord(gene, seq, topology, location)` writes: a source and one CDS at
/// `location`, named by its /gene.
fn genbank_record(gene: &str, seq: &str, topology: &str, location: &str) -> String {
    let mut lines = vec![
        format!("LOCUS       {gene:<16} {:>11} bp    DNA     {topology:<8} SYN 07-NOV-2026", seq.len()),
        format!("DEFINITION  Synthetic {topology} record holding the CDS {gene}."),
        format!("ACCESSION   {gene}"),
        format!("VERSION     {gene}"),
        "KEYWORDS    .".into(),
        "SOURCE      synthetic DNA construct".into(),
        "  ORGANISM  synthetic DNA construct".into(),
        "            other sequences; artificial sequences.".into(),
        "FEATURES             Location/Qualifiers".into(),
        format!("     source          1..{}", seq.len()),
        "                     /mol_type=\"other DNA\"".into(),
        format!("     CDS             {location}"),
        format!("                     /gene=\"{gene}\""),
        "ORIGIN".into(),
    ];
    let lower = seq.to_ascii_lowercase();
    for (i, row) in lower.as_bytes().chunks(60).enumerate() {
        let groups: Vec<&str> = row.chunks(10).map(|g| std::str::from_utf8(g).unwrap()).collect();
        lines.push(format!("{:>9} {}", i * 60 + 1, groups.join(" ")));
    }
    lines.push("//".into());
    lines.push(String::new());
    lines.join("\n")
}

/// The one CDS of a parsed record: its strand, its span, and its segments as (index, start, end).
fn cds_shape(doc: &SequenceDocument) -> (i8, usize, usize, Vec<(usize, usize, usize)>) {
    let cds: Vec<_> = doc.features.iter().filter(|f| f.feature_type == "CDS").collect();
    assert_eq!(cds.len(), 1, "{}: one CDS", doc.name);
    let f = cds[0];
    let segments = f.segments.as_ref().map(|s| s.iter().map(|s| (s.index, s.start, s.end)).collect()).unwrap_or_default();
    (f.strand, f.start, f.end, segments)
}

fn notes(doc: &SequenceDocument) -> Option<String> {
    doc.doc_metadata.as_ref()?.get("Notes").and_then(|v| v.as_str()).map(str::to_string)
}

/// AC1: the per-part forms import as their complement(join(...)) forms do; those import unchanged.
#[test]
fn per_part_complement_join_imports_as_minus_strand() {
    let seq = seeded_dna(600, 41);
    // (per-part gene, its location, the complement(join) gene, its location, the shape both import as)
    type Shape = (i8, usize, usize, Vec<(usize, usize, usize)>);
    let cases: [(&str, &str, &str, &str, Shape); 3] = [
        (
            "perPartMinus",
            "join(complement(101..160),complement(11..40))",
            "splicedMinus",
            "complement(join(11..40,101..160))",
            (-1, 11, 160, vec![(1, 11, 40), (2, 101, 160)]),
        ),
        (
            "perPartMinus3",
            "join(complement(201..260),complement(101..159),complement(11..41))",
            "exportMinus3",
            "complement(join(11..41,101..159,201..260))",
            (-1, 11, 260, vec![(1, 11, 41), (2, 101, 159), (3, 201, 260)]),
        ),
        (
            // Listed in ascending order, so sorting the parts would leave them as listed: stored
            // reversed, its first part is the highest.
            "perPartAscending",
            "join(complement(11..40),complement(101..160))",
            "exportAscending",
            "complement(join(101..160,11..40))",
            (-1, 11, 160, vec![(1, 101, 160), (2, 11, 40)]),
        ),
    ];
    for (per_part, per_part_location, joined, joined_location, want) in cases {
        let joined_doc = parse_genbank_flatfile(&genbank_record(joined, &seq, "linear", joined_location), joined);
        assert_eq!(joined_doc.sequence, seq, "{joined}: the record's bases");
        assert_eq!(cds_shape(&joined_doc), want, "{joined} {joined_location} imports unchanged");

        let doc = parse_genbank_flatfile(&genbank_record(per_part, &seq, "linear", per_part_location), per_part);
        assert_eq!(doc.sequence, seq, "{per_part}: the record's bases");
        assert_eq!(cds_shape(&doc), want, "{per_part} {per_part_location} imports as {joined_location}");
        // The parts are named by their stored place, as the importer names every part.
        let f = doc.features.iter().find(|f| f.feature_type == "CDS").unwrap();
        assert_eq!(f.name, per_part);
        let names: Vec<String> = f.segments.as_ref().unwrap().iter().map(|s| s.name.clone()).collect();
        let want_names: Vec<String> = (1..=want.3.len()).map(|i| format!("{per_part} part {i}")).collect();
        assert_eq!(names, want_names, "{per_part}: its parts' names");

        // All-minus joins need no warning.
        assert_eq!(notes(&doc), None, "{per_part}: no Notes");
        assert_eq!(notes(&joined_doc), None, "{joined}: no Notes");
    }

    // Across the origin of a circular record: rc(1..30) then rc(571..600) is
    // complement(join(571..600,1..30)), the shape the importer gives that form.
    let wrap = parse_genbank_flatfile(&genbank_record("wrapPerPart", &seq, "circular", "join(complement(1..30),complement(571..600))"), "w");
    let wrap_joined = parse_genbank_flatfile(&genbank_record("wrapMinus", &seq, "circular", "complement(join(571..600,1..30))"), "w");
    assert_eq!(cds_shape(&wrap_joined), (-1, 1, 600, vec![(1, 571, 600), (2, 1, 30)]));
    assert_eq!(cds_shape(&wrap), cds_shape(&wrap_joined));

    // One complemented part inside join() is a minus-strand range, as complement(11..40) is.
    let one = parse_genbank_flatfile(&genbank_record("onePart", &seq, "linear", "join(complement(11..40))"), "o");
    assert_eq!(cds_shape(&one), (-1, 11, 40, vec![]));
}

/// The importer's side of AC3: a join of plus- and minus-strand parts keeps its listed order on the
/// plus strand, and the document's Notes carry the D0005 block naming it by /gene, else /locus_tag.
#[test]
fn mixed_strand_join_keeps_its_listed_order_and_warns_in_notes() {
    let seq = seeded_dna(600, 41);
    let location = "join(11..40,complement(101..160))";
    let warning = |name: &str| {
        format!(
            "Warnings:\n- CDS {name} {location} mixes plus- and minus-strand parts, which one feature here cannot hold; \
             it was imported on the plus strand in the listed order, so its translation is not the annotated protein.\n"
        )
    };
    let doc = parse_genbank_flatfile(&genbank_record("mixedStrand", &seq, "linear", location), "m");
    assert_eq!(cds_shape(&doc), (1, 11, 160, vec![(1, 11, 40), (2, 101, 160)]));
    assert_eq!(notes(&doc).as_deref(), Some(warning("mixedStrand").as_str()));

    // No /gene: the /locus_tag names it; with both, /gene does, whatever the feature's label.
    let text = genbank_record("mixedStrand", &seq, "linear", location);
    let tagged = text.replace("/gene=\"mixedStrand\"", "/locus_tag=\"MS_0001\"");
    assert_eq!(notes(&parse_genbank_flatfile(&tagged, "m")).as_deref(), Some(warning("MS_0001").as_str()));
    let labelled = text.replace("/gene=\"mixedStrand\"", "/label=\"shown\"\n                     /locus_tag=\"MS_0001\"\n                     /gene=\"mixG\"");
    let labelled_doc = parse_genbank_flatfile(&labelled, "m");
    assert_eq!(labelled_doc.features.iter().find(|f| f.feature_type == "CDS").unwrap().name, "shown");
    assert_eq!(notes(&labelled_doc).as_deref(), Some(warning("mixG").as_str()));

    // One line per warning, each once, in the order the features are read.
    let gene_line = "                     /gene=\"mixedStrand\"";
    let three = text.replace(
        gene_line,
        &format!(
            "{gene_line}\n     CDS             {location}\n{gene_line}\n     gene            join(complement(201..230),\n                     301..330)\n                     /locus_tag=\"MS_0002\""
        ),
    );
    let three_doc = parse_genbank_flatfile(&three, "m");
    assert_eq!(three_doc.features.iter().filter(|f| f.feature_type != "source").count(), 3);
    assert_eq!(
        notes(&three_doc).unwrap(),
        format!(
            "{}- gene MS_0002 join(complement(201..230),301..330) mixes plus- and minus-strand parts, which one feature here cannot hold; \
             it was imported on the plus strand in the listed order, so its sequence is not the annotated one.\n",
            warning("mixedStrand")
        )
    );

    // complement() around a join that holds a complemented part mixes strands too. Biopython 1.88
    // sets such a location to None ("double complement"); the importer keeps the feature and warns.
    let wrapped = parse_genbank_flatfile(&genbank_record("mixOuter", &seq, "linear", "complement(join(11..40,complement(101..160)))"), "m");
    assert_eq!(cds_shape(&wrapped), (1, 11, 160, vec![(1, 11, 40), (2, 101, 160)]));
    assert!(notes(&wrapped).unwrap().contains("- CDS mixOuter complement(join(11..40,complement(101..160))) mixes plus- and minus-strand parts"));
}

/// BG-01M6T954 AC1: complement() around a join whose every part is complemented is a double
/// complement, which Biopython 1.88 rejects (it sets the location to None). The importer keeps the
/// feature, and the document's Notes carry a warning naming the location as written and what
/// Biopython 1.88 does with that shape (each measured on 2026-11-20 with `SeqIO.read`): it rejects
/// the join forms, reads `complement(complement(11..40))` as `complement(11..40)` on the minus strand,
/// and cannot parse a triple complement or a nested part inside a join. Every such shape is held on
/// the plus strand in the listed order, and the warning says so.
#[test]
fn a_complement_around_a_join_of_complemented_parts_warns_in_notes() {
    let seq = seeded_dna(600, 41);
    let warning = |name: &str, location: &str, biopython: &str| {
        format!(
            "Warnings:\n- CDS {name} {location} is a double complement, a complement() around parts already complemented, \
             which Biopython 1.88 {biopython}; it was imported on the plus strand in the listed order, so its translation may not be the annotated protein.\n"
        )
    };
    let rejects = "rejects as a double complement";
    let location = "complement(join(complement(11..40),complement(101..160)))";
    let doc = parse_genbank_flatfile(&genbank_record("dblComp", &seq, "linear", location), "d");
    assert_eq!(doc.sequence, seq, "the record's bases");
    assert_eq!(cds_shape(&doc), (1, 11, 160, vec![(1, 11, 40), (2, 101, 160)]), "the feature is kept, its parts as listed");
    let notes_text = notes(&doc).unwrap_or_default();
    assert!(notes_text.contains(&format!("- CDS dblComp {location} ")), "the warning names the feature and its location: {notes_text:?}");
    assert_eq!(notes_text, warning("dblComp", location, rejects));

    // Listed in descending order, so sorting or reversing the parts would show: they stay as listed.
    let descending = "complement(join(complement(101..160),complement(11..40)))";
    let desc_doc = parse_genbank_flatfile(&genbank_record("dblDesc", &seq, "linear", descending), "d");
    assert_eq!(cds_shape(&desc_doc), (1, 11, 160, vec![(1, 101, 160), (2, 11, 40)]));
    assert_eq!(notes(&desc_doc), Some(warning("dblDesc", descending, rejects)));
    // order() is rejected as join() is
    let ordered = "complement(order(complement(11..40),complement(101..160)))";
    assert_eq!(notes(&parse_genbank_flatfile(&genbank_record("dblOrder", &seq, "linear", ordered), "d")), Some(warning("dblOrder", ordered, rejects)));

    // A complement() directly around a complemented range is a double complement too, which
    // Biopython 1.88 reads as the inner complement, on the minus strand.
    let nested = "complement(complement(11..40))";
    let nested_doc = parse_genbank_flatfile(&genbank_record("dblRange", &seq, "linear", nested), "d");
    assert_eq!(cds_shape(&nested_doc), (1, 11, 40, vec![]));
    assert_eq!(notes(&nested_doc), Some(warning("dblRange", nested, "reads as complement(11..40), on the minus strand")));

    // Three complements, and a doubly complemented part inside a join (with or without a complement()
    // around the join), Biopython 1.88 cannot parse.
    // Counting complements would read the triple as minus; it is held by the same rule as every
    // other double complement, on the plus strand, and the warning says so.
    for (gene, shape) in [
        ("tripleRange", "complement(complement(complement(11..40)))"),
        ("dblPart", "join(complement(complement(11..40)),101..160)"),
        ("dblJoinPart", "complement(join(complement(complement(11..40)),101..160))"),
    ] {
        let doc = parse_genbank_flatfile(&genbank_record(gene, &seq, "linear", shape), "d");
        assert_eq!(cds_shape(&doc).0, 1, "{shape}: the plus strand");
        assert_eq!(notes(&doc), Some(warning(gene, shape, "cannot parse")), "{shape}");
    }
    let triple_doc = parse_genbank_flatfile(&genbank_record("tripleRange", &seq, "linear", "complement(complement(complement(11..40)))"), "d");
    assert_eq!(cds_shape(&triple_doc), (1, 11, 40, vec![]));
}

/// BG-01M6VZSJ AC3 (D0300): a feature across the origin of a circular record, held as the app holds
/// one (`start > end`, the bases `start..len` then `1..end`), is written `join(start..len,1..end)`,
/// never `start..end`, and read back as one feature whose parts are exactly those bases, on the
/// strand it was written with. The importer is unchanged: the re-imported start..end is its
/// recorded bounding span 1..len and the parts carry the bases (D0053). The guide is a
/// `crispr_guide` at 4,980..12 of a 4,990 bp circle, on each strand, both as the CRISPR tab's
/// Annotate writes it (two parts) and as a hand-built feature with no parts; every count is derived
/// from that feature, never written out.
///
/// Wrong implementations this kills: `start..end` written as it stands (`crispr_guide 4980..12`);
/// a writer that gives a minus-strand site its parts in the other order or drops its strand; a join
/// that re-imports covering any base the guide does not.
#[test]
fn bg_01m6vzsj_ac3_an_origin_crossing_feature_round_trips_as_a_join() {
    use molbiocraft_core::{FeatureSegment, MoleculeType, SequenceFeature, Topology};
    use molbiocraft_formats::export_genbank_flatfile_dated;

    let len = 4990;
    let seq = seeded_dna(len, 7);
    let positions = |start: usize, end: usize| -> Vec<usize> {
        if start <= end { (start..=end).collect() } else { (start..=len).chain(1..=end).collect() }
    };
    let covered = |f: &SequenceFeature| -> Vec<usize> {
        match f.segments.as_ref().filter(|s| s.len() > 1) {
            Some(segs) => segs.iter().flat_map(|s| positions(s.start, s.end)).collect(),
            None => positions(f.start, f.end),
        }
    };
    for strand in [1i8, -1] {
        for with_parts in [true, false] {
            let (start, end) = (4980, 12);
            let part = |index: usize, start: usize, end: usize| FeatureSegment {
                index,
                name: format!("G1 spacer part {index}"),
                start,
                end,
                color: "#16a34a".into(),
            };
            let guide = SequenceFeature {
                id: "feat-g1-spacer".into(),
                name: "G1 spacer".into(),
                feature_type: "crispr_guide".into(),
                start,
                end,
                strand,
                color: "#16a34a".into(),
                notes: None,
                qualifiers: None,
                segments: with_parts.then(|| vec![part(1, start, len), part(2, 1, end)]),
                cleavage_site: None,
            };
            let want_bases = positions(guide.start, guide.end);
            assert_eq!(want_bases.len(), len - guide.start + 1 + guide.end, "the guide's own count of bases");
            let doc = SequenceDocument {
                id: "vzsj".into(),
                name: "pVZSJ".into(),
                accession: "VZSJ".into(),
                molecule_type: MoleculeType::DNA,
                topology: Topology::Circular,
                sequence: seq.clone(),
                features: vec![guide.clone()],
                ..Default::default()
            };
            let case = format!("strand {strand}, {}", if with_parts { "two parts" } else { "no parts" });

            let gb = export_genbank_flatfile_dated(&doc, "2026-11-21");
            let join = format!("join({}..{},1..{})", guide.start, len, guide.end);
            let location = if strand < 0 { format!("complement({join})") } else { join };
            assert!(gb.contains(&format!("     crispr_guide    {location}\n")), "{case}: written as {location}\n{gb}");
            assert!(!gb.contains(&format!("{}..{}\n", guide.start, guide.end)), "{case}: never written start..end\n{gb}");

            let back = parse_genbank_flatfile(&gb, "fallback");
            assert_eq!(back.sequence, seq, "{case}: the bases");
            let got: Vec<_> = back.features.iter().filter(|f| f.feature_type == "crispr_guide").collect();
            assert_eq!(got.len(), 1, "{case}: one feature, {gb}");
            let f = got[0];
            assert_eq!(f.strand, guide.strand, "{case}: the strand it was written with");
            assert_eq!((f.start, f.end), (1, len), "{case}: the importer's bounding span (D0300, D0053)");
            let parts: Vec<_> = f.segments.as_ref().map(|s| s.iter().map(|s| (s.start, s.end)).collect()).unwrap_or_default();
            assert_eq!(parts, vec![(guide.start, len), (1, guide.end)], "{case}: the record's end, then its start");
            assert_eq!(covered(f), want_bases, "{case}: exactly the bases the guide covers");
            assert_eq!(covered(f).len(), want_bases.len(), "{case}: as many bases as the guide covers");
            // Lossless: written again, the re-imported feature reads exactly as the first export.
            let again = export_genbank_flatfile_dated(&back, "2026-11-21");
            assert!(again.contains(&format!("     crispr_guide    {location}\n")), "{case}: written again as {location}\n{again}");

            // The EMBL writer takes the same rule (D0300): written as a join, read back to the same parts.
            if !with_parts {
                let embl = molbiocraft_formats::export_embl_flatfile(&doc);
                assert!(embl.contains(&format!("FT   crispr_guide    {location}\n")), "{case}: EMBL written as {location}\n{embl}");
                assert!(!embl.contains(&format!("{}..{}\n", guide.start, guide.end)), "{case}: EMBL never writes start..end\n{embl}");
                let back = molbiocraft_formats::parse_embl_flatfile(&embl, "fallback");
                assert_eq!(back.sequence, seq, "{case}: EMBL bases");
                let got: Vec<_> = back.features.iter().filter(|f| f.feature_type == "crispr_guide").collect();
                assert_eq!(got.len(), 1, "{case}: EMBL one feature, {embl}");
                let f = got[0];
                assert_eq!(f.strand, guide.strand, "{case}: EMBL keeps the strand");
                assert_eq!((f.start, f.end), (1, len), "{case}: EMBL importer's bounding span (D0300, D0053)");
                let parts: Vec<_> = f.segments.as_ref().map(|s| s.iter().map(|s| (s.start, s.end)).collect()).unwrap_or_default();
                assert_eq!(parts, vec![(guide.start, len), (1, guide.end)], "{case}: EMBL parts, the record's end then its start");
                assert_eq!(covered(f), want_bases, "{case}: EMBL re-imports exactly the bases the guide covers");
            }
        }
    }

    // A linear record has no origin to run across: its two-part join keeps the span it reads as.
    let linear = genbank_record("vzsjLinear", &seq, "linear", &format!("join(4980..{len},1..12)"));
    assert_eq!(cds_shape(&parse_genbank_flatfile(&linear, "l")), (1, 1, len, vec![(1, 4980, len), (2, 1, 12)]));
}
