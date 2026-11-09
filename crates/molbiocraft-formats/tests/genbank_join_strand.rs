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
