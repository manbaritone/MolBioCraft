// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Standards-compliant GenBank (`.gb`/`.gbk`), EMBL (`.embl`), Applied Biosystems ABIF v1.0
//! (`.ab1`) Sanger 4-Dye Capillary Chromatogram Parser & Synthesizer, and NCBI Direct Submission
//! (`.fsa` + `.tbl`) Validator.

use crate::noodles_io::color_for_feature_type;
use molbiocraft_core::{
    clean_alpha_sequence, ChromatogramData, FeatureSegment, HistoryTreeNode, MoleculeType, SequenceDocument,
    SequenceFeature, Topology,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Placeholder end of an interval that runs to the end of the record (resolved after parsing).
pub const WRAP_TO_END: usize = usize::MAX;

/// Replaces [`WRAP_TO_END`] in parsed features by the record length.
pub fn resolve_wrapped_features(features: &mut [SequenceFeature], len: usize) {
    for f in features.iter_mut() {
        if f.end == WRAP_TO_END {
            f.end = len.max(f.start);
        }
        if let Some(segs) = f.segments.as_mut() {
            for sg in segs.iter_mut() {
                if sg.end == WRAP_TO_END {
                    sg.end = len.max(sg.start);
                }
            }
        }
    }
}

/// Parses an INSDC feature location (`a..b`, `complement(...)`, `join(...)`, `order(...)`,
/// partial markers `<`/`>`, single bases). Returns (start, end, strand, intervals in stored order),
/// as [`parse_insdc_location_parts`] reads them.
pub fn parse_insdc_location(loc: &str) -> Option<(usize, usize, i8, Vec<(usize, usize)>)> {
    parse_insdc_location_parts(loc).map(|l| (l.start, l.end, l.strand, l.intervals))
}

/// An INSDC feature location as one feature holds it: one strand, and its parts in the order that
/// strand's reading needs (see [`parse_insdc_location_parts`]).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct InsdcLocation {
    /// The lowest base of any part (at least 1).
    pub start: usize,
    /// The highest base of any part.
    pub end: usize,
    /// -1 when every part is on the minus strand, else 1.
    pub strand: i8,
    /// The parts, each `start <= end`, in stored order.
    pub intervals: Vec<(usize, usize)>,
    /// The location joins plus- and minus-strand parts, which one strand cannot hold: it is then
    /// held on the plus strand with its parts in the listed order.
    pub mixed_strands: bool,
}

/// Each part of a location, by its place in the comma-separated list, with whether it is on the
/// minus strand, in the order the location reads its parts (5' to 3'): `complement(x)` reads the
/// parts of `x` in reverse order, each on the other strand, and `join`, `order` and any other
/// wrapper read theirs in the listed order. A part is placed by the wrapper around its first digit;
/// a wrapper left open at the end of the text closes there, and a `)` with none open is ignored.
fn part_reading_order(compact: &str) -> Vec<(usize, bool)> {
    // The open wrappers, innermost last: whether each is complement(), and its parts so far.
    let mut frames: Vec<(bool, Vec<(usize, bool)>)> = vec![(false, Vec::new())];
    let close = |frames: &mut Vec<(bool, Vec<(usize, bool)>)>| {
        if frames.len() > 1 {
            if let Some((complement, mut parts)) = frames.pop() {
                if complement {
                    parts.reverse();
                    parts.iter_mut().for_each(|p| p.1 = !p.1);
                }
                if let Some(parent) = frames.last_mut() {
                    parent.1.extend(parts);
                }
            }
        }
    };
    let (mut part, mut placed, mut word_start) = (0usize, false, 0usize);
    for (i, c) in compact.char_indices() {
        match c {
            '(' => {
                frames.push((&compact[word_start..i] == "complement", Vec::new()));
                word_start = i + 1;
            }
            ')' => {
                close(&mut frames);
                word_start = i + 1;
            }
            ',' => {
                part += 1;
                placed = false;
                word_start = i + 1;
            }
            d if d.is_ascii_digit() && !placed => {
                if let Some(top) = frames.last_mut() {
                    top.1.push((part, false));
                }
                placed = true;
            }
            _ => {}
        }
    }
    while frames.len() > 1 {
        close(&mut frames);
    }
    frames.pop().map(|f| f.1).unwrap_or_default()
}

/// Parses an INSDC feature location, reading each part's own `complement()`, into the one strand
/// and stored part order a [`SequenceFeature`] holds:
///
/// - every part on the plus strand: strand 1, the parts in the order the location reads them;
/// - every part on the minus strand: strand -1, the parts in the reverse of that order, which is
///   the plus-strand order a reader reverse-complements. So `join(complement(101..160),
///   complement(11..40))` is stored as `complement(join(11..40,101..160))` is, with parts
///   11..40 then 101..160, and `join(complement(11..40),complement(101..160))` as
///   `complement(join(101..160,11..40))`, with parts 101..160 then 11..40: never sorted. Biopython
///   1.88 reads each such pair as one location and extracts the same protein from it;
/// - parts on both strands (`join(11..40,complement(101..160))`, a trans-spliced gene): strand 1,
///   the parts in the listed order, and `mixed_strands`, since a feature carries one strand.
///   A `complement()` around a join that holds a complemented part, which Biopython 1.88 rejects
///   as a double complement, is read the same way.
///
/// A range written across the origin (`8569..276`, as some sequence editors write it) is the two parts
/// `8569..` [`WRAP_TO_END`] and `1..276`, kept in that order inside its place. Remote references
/// (`J00194.1:100..202`) are dropped. Negative positions give no location.
pub fn parse_insdc_location_parts(loc: &str) -> Option<InsdcLocation> {
    let compact: String = loc.chars().filter(|c| !c.is_whitespace()).collect();
    // negative positions are not valid INSDC locations (Biopython drops such features too)
    if compact.is_empty() || compact.starts_with('-') || compact.contains("(-") || compact.contains(",-") || compact.contains("..-") {
        return None;
    }
    // Each comma-separated part's intervals, by its place in the list.
    let pieces: Vec<Vec<(usize, usize)>> = compact
        .split(',')
        .map(|part| {
            // Drop remote references (e.g. "J00194.1:100..202") and wrapper keywords.
            if part.contains(':') {
                return Vec::new();
            }
            let digits: Vec<usize> = part
                .split(|c: char| !c.is_ascii_digit())
                .filter(|t| !t.is_empty())
                .filter_map(|t| t.parse().ok())
                .collect();
            match digits.as_slice() {
                [a] => vec![(*a, *a)],
                // "8569..276": a range written across the origin of a circular record (as some
                // sequence editors write it); WRAP_TO_END is replaced by the record length once it is known
                [a, b, ..] if a > b && !part.contains('^') => vec![(*a, WRAP_TO_END), (1, *b)],
                [a, b, ..] => vec![((*a).min(*b), (*a).max(*b))],
                _ => Vec::new(),
            }
        })
        .collect();
    let read: Vec<(usize, bool)> = part_reading_order(&compact)
        .into_iter()
        .filter(|&(p, _)| pieces.get(p).is_some_and(|i| !i.is_empty()))
        .collect();
    let all_minus = !read.is_empty() && read.iter().all(|&(_, minus)| minus);
    let mixed_strands = !all_minus && read.iter().any(|&(_, minus)| minus);
    let order: Vec<usize> = if all_minus {
        read.iter().rev().map(|&(p, _)| p).collect()
    } else if mixed_strands {
        (0..pieces.len()).collect()
    } else {
        read.iter().map(|&(p, _)| p).collect()
    };
    let intervals: Vec<(usize, usize)> = order.iter().flat_map(|&p| pieces[p].iter().copied()).collect();
    if intervals.is_empty() {
        return None;
    }
    let start = intervals.iter().map(|i| i.0).min()?.max(1);
    let end = intervals.iter().map(|i| i.1).max()?.max(start);
    Some(InsdcLocation { start, end, strand: if all_minus { -1 } else { 1 }, intervals, mixed_strands })
}

/// The D0005 warning for a feature whose location mixes strands (see
/// [`InsdcLocation::mixed_strands`]), naming it by its /gene, else its /locus_tag, else its name.
fn mixed_strand_warning(f: &SequenceFeature, location: &str) -> String {
    let first = |key: &str| {
        f.qualifiers
            .as_ref()
            .and_then(|q| q.get(key))
            .and_then(|v| v.split('\n').next())
            .filter(|v| !v.is_empty())
            .map(str::to_string)
    };
    let name = first("gene").or_else(|| first("locus_tag")).unwrap_or_else(|| f.name.clone());
    let consequence = if f.feature_type == "CDS" { "its translation is not the annotated protein" } else { "its sequence is not the annotated one" };
    format!(
        "{} {name} {location} mixes plus- and minus-strand parts, which one feature here cannot hold; it was imported on the plus strand in the listed order, so {consequence}.",
        f.feature_type
    )
}

/// Formats a feature's location in INSDC syntax, writing `join(...)` for multi-interval features.
pub fn format_insdc_location(feat: &SequenceFeature) -> String {
    let body = match feat.segments.as_ref().filter(|s| s.len() > 1) {
        Some(segs) => format!(
            "join({})",
            segs.iter()
                .map(|s| if s.start == s.end { s.start.to_string() } else { format!("{}..{}", s.start, s.end) })
                .collect::<Vec<_>>()
                .join(",")
        ),
        None if feat.start == feat.end => feat.start.to_string(),
        None => format!("{}..{}", feat.start, feat.end),
    };
    if feat.strand < 0 {
        format!("complement({body})")
    } else {
        body
    }
}

/// Where [`wrap_feature_line`] may end a line, and so how the reader rejoins the lines.
#[derive(Clone, Copy, PartialEq, Eq)]
enum BreakAt {
    /// After the last comma that fits, which stays on the line: a location such as
    /// `join(1..9,20..40)`, or an /anticodon or /transl_except value, which INSDC writes as
    /// `(pos:...,aa:...)` with no spaces. The reader rejoins the lines with nothing between them,
    /// quoted or not (INSDC, NCBI and Biopython write these two unquoted, and Biopython cuts them at
    /// the width wherever it falls).
    Comma,
    /// At the last space that fits, which the line break replaces, or, with none, as `Comma`:
    /// prose, which the reader rejoins with one space.
    Space,
    /// At the width, wherever it falls: a value the reader rejoins with nothing between its lines
    /// (/translation, /primer_sequence).
    Width,
}

/// The break point for a qualifier's value, matching how the reader rejoins its lines.
fn qualifier_break(key: &str) -> BreakAt {
    if key == "translation" || key.ends_with("sequence") {
        BreakAt::Width
    } else if matches!(key, "anticodon" | "transl_except") {
        BreakAt::Comma
    } else {
        BreakAt::Space
    }
}

/// Wraps a feature-table value onto continuation lines (79-column INSDC layout). Prose breaks at
/// the last space that keeps the line within 79 columns, so a word ending exactly in column 79
/// stays on its line, as it does in Biopython's GenBankWriter at the same width. A line with no
/// break point inside the width is cut at the width, as Biopython cuts it; prose with no space
/// that fits is first broken after its last comma that does. A cut never falls between the two
/// quotes of a doubled quote (see [`quoted_qualifier`]): the line would end in a lone quote, which
/// the reader takes for the closing one, so the cut moves one column back. No line of a quoted
/// value holds only a quote but its closing one: every break falls at a space, after a comma, or
/// at or near the width, never between the two quotes of a pair.
///
/// In a quoted qualifier value, one more break moves: one the reader would misread, where a line
/// ends in an even run of quotes and the next line, cut as above, begins a qualifier
/// ([`begins_qualifier`]: "/" and a name, then "=" or the line's end), since the reader closes
/// the value there (see [`QuoteEnd::EvenRun`]). Such a break moves back to the latest earlier
/// space on its line that leaves no misread break and, with none, forward to the first later one
/// that does, so that line runs past column 79, because a break inside a word would put a space
/// into the value. A cut inside a run with no space moves back past one doubled quote instead,
/// which then begins the next line; in prose such a run reads back with a space at its cut
/// wherever it falls. No other break moves: a line that begins with "/" but no qualifier name,
/// such as `/gene; its ...` or `/Users/...`, keeps its break even after a line ending in doubled
/// quotes, as in Biopython's layout. Biopython has neither rule.
fn wrap_feature_line(prefix: &str, cont: &str, text: &str, break_at: BreakAt) -> String {
    const WIDTH: usize = 79;
    let room = WIDTH - prefix.len();
    // Where the reader starts a quoted qualifier value: right after its `/key="`.
    let value_start = text.strip_prefix('/').and_then(|t| t.find("=\"")).map(|i| i + 3);
    // The line of `text` from byte `at` to `at + cut`, as the reader reads it.
    let line = |at: usize, cut: usize| text[at..at + cut].trim_end_matches(' ');
    // A continuation starts at its first non-space character, right after `cont` (column 22 in
    // the feature table).
    let next_at = |at: usize, cut: usize| text.len() - text[at + cut..].trim_start_matches(' ').len();
    // Where the line that starts at `at` ends by its break point alone.
    let natural = |at: usize| -> usize {
        let rest = &text[at..];
        if rest.len() <= room {
            return rest.len();
        }
        let mut limit = room;
        while limit > 0 && !rest.is_char_boundary(limit) {
            limit -= 1;
        }
        let limit = limit.max(rest.chars().next().map_or(1, char::len_utf8));
        // The comma ends the line, so it must fall inside the width.
        let after_comma = || rest[..limit].rfind(',').map(|i| i + 1);
        let cut = match break_at {
            BreakAt::Comma => after_comma(),
            // The space is dropped, so it may sit one past the width (`room` is its byte offset).
            BreakAt::Space => rest.as_bytes()[..=room].iter().rposition(|&b| b == b' ').filter(|&i| i > 0).or_else(after_comma),
            BreakAt::Width => None,
        }
        .filter(|&i| i > 0)
        .unwrap_or(limit);
        // Between two quotes, the cut splits a doubled quote when the quotes before it, the
        // opening one included, are even in number. Only a cut at the width falls between two
        // quotes, at least `room` - 3 bytes into its line (55 at the narrowest, the feature
        // table's), so one column back leaves far more than a lone quote on the line.
        let bytes = rest.as_bytes();
        if bytes[cut - 1] == b'"' && bytes.get(cut) == Some(&b'"') && text[..at + cut].matches('"').count().is_multiple_of(2) {
            cut - 1
        } else {
            cut
        }
    };
    // Whether a line of a quoted value ends in an even run of quotes, the first line's counted
    // from after its opening quote.
    let ends_in_pairs = |at: usize, cut: usize| {
        value_start.is_some_and(|start| {
            let l = line(at, cut);
            let body = if at == 0 { l.get(start..).unwrap_or("") } else { l };
            let run = body.len() - body.trim_end_matches('"').len();
            run > 0 && run % 2 == 0
        })
    };
    // Whether the reader keeps the line from `at` to `at + cut` in the value: after a line that
    // ends in an even run it must not begin a qualifier, and ending in one itself, it must not
    // come before a line that does, cut where `natural` cuts it. A move on that next line never
    // makes it begin one: back, this check refuses it; forward, a line that is no qualifier
    // stays none however much longer it gets.
    let reads_right = |at: usize, cut: usize, after_pairs: bool| {
        let next = next_at(at, cut);
        !(after_pairs && begins_qualifier(line(at, cut)))
            && (!ends_in_pairs(at, cut) || next >= text.len() || !begins_qualifier(line(next, natural(next))))
    };
    let mut out = String::new();
    let (mut at, mut after_pairs) = (0, false);
    while at < text.len() {
        let rest = &text[at..];
        let cut = natural(at);
        let later = |cut: usize| rest.match_indices(' ').map(|(i, _)| i).find(|&i| i > cut && reads_right(at, i, after_pairs));
        let cut = if reads_right(at, cut, after_pairs) {
            cut
        } else if break_at == BreakAt::Space && rest.as_bytes().get(cut) == Some(&b' ') {
            let earlier = rest[..cut].match_indices(' ').map(|(i, _)| i).filter(|&i| i > 0).rev().find(|&i| reads_right(at, i, after_pairs));
            earlier.or_else(|| later(cut)).unwrap_or(rest.len())
        } else {
            let back = cut.checked_sub(2).filter(|&i| i > 0 && reads_right(at, i, after_pairs));
            back.or_else(|| later(cut)).unwrap_or(rest.len())
        };
        out.push_str(if at == 0 { prefix } else { cont });
        out.push_str(if cut == rest.len() { rest } else { line(at, cut) });
        out.push('\n');
        after_pairs = ends_in_pairs(at, cut);
        at = next_at(at, cut);
    }
    out
}

/// Qualifiers worth writing to a flatfile (skips MolBioCraft-internal bookkeeping keys).
fn exportable_qualifiers(feat: &SequenceFeature) -> Vec<(String, String)> {
    let mut q: Vec<(String, String)> = feat
        .qualifiers
        .as_ref()
        .map(|m| {
            m.iter()
                .filter(|(k, v)| {
                    !k.contains(' ')
                        && !k.starts_with("genomic_")
                        && !k.starts_with("intervals_")
                        && !matches!(k.as_str(), "label" | "note" | "raw_type" | "source")
                        && (!v.is_empty() || is_flag_qualifier(k) || k.as_str() == "replace")
                })
                .map(|(k, v)| (k.clone(), v.clone()))
                .collect()
        })
        .unwrap_or_default();
    q.sort();
    q
}

/// A feature's qualifier lines after its location, each `qual` column-22 lead: its name as the
/// /label, unless `label` is false (a GenBank source), and the further /label values it was read
/// with; then its other qualifiers; then its notes as /note. A repeated qualifier, its values
/// separated by "\n" (see [`parse_genbank_flatfile`]), takes one line per value, in order.
fn feature_qualifier_lines(feat: &SequenceFeature, qual: &str, label: bool) -> String {
    let mut out = String::new();
    let mut line = |k: &str, v: &str| out.push_str(&wrap_feature_line(qual, qual, &qualifier_text(k, v), qualifier_break(k)));
    if label {
        // The name stands for the first /label read.
        line("label", &feat.name);
        let read = feat.qualifiers.as_ref().and_then(|q| q.get("label"));
        for v in read.into_iter().flat_map(|v| v.split('\n').skip(1)) {
            line("label", v);
        }
    }
    for (k, v) in exportable_qualifiers(feat) {
        for value in v.split('\n') {
            line(&k, value);
        }
    }
    for note in feat.notes.iter().filter(|n| !n.is_empty()).flat_map(|n| n.split('\n')) {
        line("note", note);
    }
    out
}

/// INSDC qualifiers that take no value (written as `/focus`, not `/focus=""`).
fn is_flag_qualifier(k: &str) -> bool {
    matches!(
        k,
        "focus" | "pseudo" | "proviral" | "germline" | "macronuclear" | "rearranged" | "transgenic"
            | "environmental_sample" | "ribosomal_slippage" | "trans_splicing" | "circular_RNA" | "metagenomic"
    )
}

/// One qualifier line's text: `/key="value"`, or `/key` for a valueless flag.
fn qualifier_text(k: &str, v: &str) -> String {
    if v.is_empty() && is_flag_qualifier(k) {
        format!("/{k}")
    } else {
        quoted_qualifier(k, v)
    }
}

/// `/key="value"`, with each double quote inside the value doubled, as INSDC writes it (feature
/// table definition 3.3.3.1: `/note="This is an example of ""escaped"" quotation marks"`) and as
/// Biopython does. [`quoted_value_line`] undoes it.
fn quoted_qualifier(k: &str, v: &str) -> String {
    format!("/{k}=\"{}\"", v.replace('"', "\"\""))
}

/// How one line of a quoted qualifier value leaves the value.
#[derive(Clone, Copy, PartialEq, Eq)]
enum QuoteEnd {
    /// The line ends in an odd run of quotes, whose last quote closes the value. On a line before
    /// the value's last, which export never writes (it doubles every quote), that is a quote left
    /// unescaped, and the close moves it: `/note="cloned from "pUC19"` then `and more text"` reads
    /// as `cloned from "pUC19 and more text"`, its second line an unquoted continuation that keeps
    /// its quote, where Biopython 1.88 reads `cloned from "pUC19" and more text`.
    Closed,
    /// No quote ends the line: the value continues.
    Open,
    /// The line ends in an even run of quotes: doubled quotes that a line break follows, which
    /// keep the value open, or a quote left unescaped and the closing one, which close it, as in
    /// `/note="End not properly "escaped""` (Biopython's test file qualifier_escaping_read.gb).
    /// The next line decides: one that begins a qualifier (see [`begins_qualifier`]) or a feature,
    /// or ends the feature table, closes the value, and any other continues it. Biopython 1.88
    /// closes the value at any line that ends in a quote, and from there reads a line that does
    /// not begin with "/" into it as well, so `/note="a ""b""` then `continued here"` reads
    /// `a "b" continued here` in both. The two part only at a line beginning with "/" that this
    /// reader keeps in the value and Biopython reads as a new qualifier: right after the even run,
    /// one that names no qualifier, such as `/gene; its ...` or `/cgi-bin/view?id=3 ...`; after a
    /// line that went on with no quote at its end, any, `/gene=""x"" more"` among them.
    /// [`wrap_feature_line`] never ends a line in an even run before one this reader takes for a
    /// qualifier, so its own export reads back whole here, and keeps its break before any other
    /// "/" line, which Biopython splits off, as it splits its own output there.
    EvenRun,
}

/// One line of a quoted qualifier value, without the opening quote on its first line: the text,
/// with each doubled quote turned back into one, and how the line leaves the value. An even run
/// reads the same either way: 2k quotes are k pairs, or k-1 pairs, a lone quote and the closing
/// one, and both give k quotes.
fn quoted_value_line(line: &str) -> (String, QuoteEnd) {
    let run = line.len() - line.trim_end_matches('"').len();
    let (text, end) = match run {
        0 => (line, QuoteEnd::Open),
        _ if run % 2 == 1 => (&line[..line.len() - 1], QuoteEnd::Closed),
        _ => (line, QuoteEnd::EvenRun),
    };
    (text.replace("\"\"", "\""), end)
}

/// Whether a feature-table line begins a qualifier: "/" and a name of letters, digits, `_` or
/// `-`, then "=" or the end of the line (`/codon_start=1`, `/pseudo`). Prose that begins with "/",
/// as in `/gene; its UGA codon ...`, does not.
fn begins_qualifier(line: &str) -> bool {
    line.strip_prefix('/').is_some_and(|body| {
        let name = body.split_once('=').map_or(body, |(k, _)| k);
        !name.is_empty() && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

/// Whether a line ends a GenBank or EMBL record: "//" from column 1, trailing space aside, as
/// Biopython 1.88 ends one and the app's importer splits a file (splitFlatfileRecords). An
/// indented line beginning with "//", such as a wrapped qualifier's, does not.
fn ends_record(line: &str) -> bool {
    line.trim_end() == "//"
}

/// A description as the one line DEFINITION and DE hold, before they wrap it: each line break, with
/// the space around it, becomes one space, as both readers join the lines of either. A line break
/// written raw would start a line in column 1, and one that is "//" there would end the record
/// (see [`ends_record`]). A carriage return counts as a line break, since Python, and so
/// Biopython, and the app's importer read one as such.
fn description_line(description: &str) -> String {
    description.split(['\r', '\n']).map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")
}

fn segments_from_intervals(name: &str, color: &str, intervals: &[(usize, usize)]) -> Option<Vec<FeatureSegment>> {
    (intervals.len() > 1).then(|| {
        intervals
            .iter()
            .enumerate()
            .map(|(i, &(a, b))| FeatureSegment {
                index: i + 1,
                name: format!("{name} part {}", i + 1),
                start: a,
                end: b,
                color: color.to_string(),
            })
            .collect()
    })
}

/// Parse an INSDC GenBank flatfile into a fully annotated `SequenceDocument`.
///
/// DEFINITION follows GenBank's convention that the definition ends with a full stop ("The last
/// line must end with a period", NCBI GenBank release notes 3.4.5): this reader drops exactly that
/// one, and [`export_genbank_flatfile`] always writes it. So a description that itself ends in one,
/// such as "Bacillus sp.", is written "Bacillus sp.." and reads back unchanged, as in Biopython
/// 1.88, which writes and reads it the same way. A full stop that only ends a line, as in "E."
/// before a line break, is kept.
///
/// A qualifier that a feature carries more than once (several /db_xref, /note, /EC_number,
/// /inference or /transl_except) keeps every value, in file order, in its one entry of the
/// feature's qualifier map, each separated from the next by "\n"; a repeat written with no value
/// at all, as a second `/pseudo`, adds none, as in Biopython 1.88. A value read from GenBank or
/// EMBL never holds a newline itself, since its continuation lines are joined with a space or
/// with nothing, so the separator cannot be mistaken for its text. The feature's notes hold every
/// /note the same way, and its name is the first value of the qualifier it is taken from.
/// [`export_genbank_flatfile`] and [`export_embl_flatfile`] write one line per value, in order.
///
/// The record ends at its "//" line whether or not it has an ORIGIN block (a CONTIG record has
/// none), the line at which Biopython 1.88 ends it too, so the text of a multi-record file reads
/// as its first record alone, with that record's own LOCUS, DEFINITION and features. Inside ORIGIN
/// a line that begins with "//" once its indent is trimmed, such as an indented "//" or "//x" in
/// column 1, holds no bases and does not end the record, as in Biopython 1.88, which reads on past
/// each.
///
/// A feature's location is read by [`parse_insdc_location_parts`]: a join whose parts are each
/// complemented is stored as its `complement(join(...))` form is, on the minus strand with its
/// parts in the reverse of the listed order, numbered 1..n in that order. A location that mixes
/// plus- and minus-strand parts is kept, on the plus strand in the listed order, and the
/// document's Notes (`doc_metadata["Notes"]`, shown on the Info tab) end with the D0005 block
/// withWarningNotes writes, "Warnings:" and one "- " line per such feature (a repeated line once),
/// naming it by its /gene, else its /locus_tag (BG-01M6SMBS). A record with no such feature gets no
/// Notes.
pub fn parse_genbank_flatfile(text: &str, fallback_name: &str) -> SequenceDocument {
    let lines: Vec<&str> = text.lines().collect();
    let mut name = fallback_name.to_string();
    let mut accession = "GB_IMPORT_001".to_string();
    let mut description = format!("Imported GenBank document ({})", fallback_name);
    let mut topology = Topology::Linear;
    let mut molecule_type = MoleculeType::DNA;
    let mut features: Vec<SequenceFeature> = Vec::new();
    let mut seq_buf = String::with_capacity(text.len() / 2);

    let mut in_features = false;
    let mut in_origin = false;
    let mut current_feat: Option<SequenceFeature> = None;
    let mut loc_buf = String::new();
    // How the line before ended a quoted value that is still open (Open or EvenRun), and the
    // current feature's latest qualifier.
    let mut in_qualifier: Option<QuoteEnd> = None;
    let mut last_qualifier: Option<String> = None;
    let mut in_definition = false;
    let mut definition = String::new();
    let without_final_stop = |d: &str| d.strip_suffix('.').unwrap_or(d).to_string();
    let mut locus_length: usize = 0;

    // The D0005 warnings the import writes into the document's Notes (see this function's doc).
    let mut warnings: Vec<String> = Vec::new();

    /// Applies the accumulated location and naming qualifiers once a feature is complete, and adds
    /// the warning for a location that mixes strands.
    fn finish_feature(mut f: SequenceFeature, loc: &str, warnings: &mut Vec<String>) -> SequenceFeature {
        let location = parse_insdc_location_parts(loc);
        if let Some(l) = location.as_ref() {
            f.start = l.start;
            f.end = l.end;
            f.strand = l.strand;
            f.segments = segments_from_intervals(&f.name, &f.color, &l.intervals);
        } else {
            // no valid location: marked for removal below
            f.start = 0;
            f.end = 0;
        }
        if let Some(q) = f.qualifiers.as_ref() {
            // The name is the first value of a repeated qualifier; the notes are every /note.
            for key in ["label", "gene", "product", "standard_name", "locus_tag"] {
                if let Some(v) = q.get(key).and_then(|v| v.split('\n').next()).filter(|v| !v.is_empty()) {
                    if f.feature_type != "source" {
                        f.name = v.to_string();
                    }
                    break;
                }
            }
            f.notes = q.get("note").cloned();
            if let Some(segs) = f.segments.as_mut() {
                for s in segs.iter_mut() {
                    s.name = format!("{} part {}", f.name, s.index);
                }
            }
        }
        if location.is_some_and(|l| l.mixed_strands) {
            let compact: String = loc.chars().filter(|c| !c.is_whitespace()).collect();
            warnings.push(mixed_strand_warning(&f, &compact));
        }
        f
    }

    for raw_line in &lines {
        // The record's "//" line ends it, after ORIGIN or without one (see this function's doc).
        if ends_record(raw_line) {
            break;
        }
        if in_origin {
            // A line that begins with "//" once its indent is trimmed holds no bases and does not
            // end the record (see this function's doc).
            if raw_line.trim_start().starts_with("//") {
                continue;
            }
            for b in raw_line.bytes() {
                if b.is_ascii_alphabetic() {
                    seq_buf.push((b.to_ascii_uppercase()) as char);
                }
            }
            continue;
        }

        if raw_line.starts_with("LOCUS") {
            let parts: Vec<&str> = raw_line.split_whitespace().collect();
            if parts.len() >= 2 {
                name = parts[1].to_string();
            }
            if let Some(i) = parts.iter().position(|t| *t == "bp" || *t == "aa") {
                locus_length = parts.get(i.wrapping_sub(1)).and_then(|t| t.parse().ok()).unwrap_or(0);
            }
            // Classify only the tokens after the record name: a LOCUS name such
            // as "pRNA_vector" or "circularRNA_probe" must not change the molecule
            // type or topology.
            let after_name: Vec<String> = parts.iter().skip(2).map(|t| t.to_ascii_lowercase()).collect();
            if after_name.iter().any(|t| t == "circular") {
                topology = Topology::Circular;
            }
            if after_name.iter().any(|t| t == "aa") {
                molecule_type = MoleculeType::Protein;
            } else if after_name.iter().any(|t| t.ends_with("rna")) {
                // RNA, mRNA, rRNA, tRNA, ss-RNA, ds-RNA, cRNA ...
                molecule_type = MoleculeType::RNA;
            }
            continue;
        }

        // The one full stop that ends the definition is dropped, GenBank's convention (see this
        // function's doc); one before it, as in "sp..", and one that only ends a line, as in "E."
        // or "str." before a line break, are kept.
        if let Some(rest) = raw_line.strip_prefix("DEFINITION") {
            definition = rest.trim().to_string();
            if without_final_stop(&definition).is_empty() {
                definition.clear();
            } else {
                description = without_final_stop(&definition);
            }
            in_definition = true;
            continue;
        }
        // DEFINITION continues on lines indented to column 13
        if in_definition && !in_features && raw_line.starts_with("            ") {
            let d = raw_line.trim();
            if !d.is_empty() {
                definition = if definition.is_empty() { d.to_string() } else { format!("{definition} {d}") };
                description = without_final_stop(&definition);
            }
            continue;
        }
        in_definition = false;

        if let Some(rest) = raw_line.strip_prefix("ACCESSION") {
            if let Some(tok) = rest.split_whitespace().next() {
                accession = tok.to_string();
            }
            continue;
        }

        if raw_line.starts_with("FEATURES") {
            in_features = true;
            continue;
        }

        if raw_line.starts_with("ORIGIN") {
            if let Some(f) = current_feat.take() {
                features.push(finish_feature(f, &loc_buf, &mut warnings));
            }
            in_features = false;
            in_origin = true;
            continue;
        }

        if in_features {
            let leading_spaces = raw_line.len() - raw_line.trim_start_matches(' ').len();
            let trimmed = raw_line.trim();
            if trimmed.is_empty() {
                continue;
            }
            // A keyword in column 1 (BASE COUNT, CONTIG, WGS …) ends the feature table: feature
            // keys start in column 6.
            if leading_spaces == 0 {
                if let Some(f) = current_feat.take() {
                    features.push(finish_feature(f, &loc_buf, &mut warnings));
                }
                in_features = false;
            }
        }

        if in_features {
            let leading_spaces = raw_line.len() - raw_line.trim_start_matches(' ').len();
            let trimmed = raw_line.trim();
            if leading_spaces <= 8 && !trimmed.starts_with('/') {
                if let Some(f) = current_feat.take() {
                    features.push(finish_feature(f, &loc_buf, &mut warnings));
                }
                let mut toks = trimmed.split_whitespace();
                let feat_key = toks.next().unwrap_or("misc_feature");
                loc_buf = toks.collect::<Vec<_>>().join("");
                in_qualifier = None;
                last_qualifier = None;
                let idx = features.len() + 1;
                current_feat = Some(SequenceFeature {
                    id: format!("gb-feat-{}", idx),
                    name: if feat_key == "source" { "source".into() } else { format!("{}_{}", feat_key, idx) },
                    feature_type: feat_key.to_string(),
                    start: 1,
                    end: 1,
                    strand: 1,
                    color: color_for_feature_type(feat_key).into(),
                    notes: None,
                    qualifiers: Some(HashMap::new()),
                    segments: None,
                    cleavage_site: None,
                });
            } else if trimmed.starts_with('/')
                && match in_qualifier {
                    None => true,
                    // A value whose last line ended in an even run of quotes closes before a line
                    // that begins a qualifier (a new feature or the end of the table closes it too).
                    Some(end) => end == QuoteEnd::EvenRun && begins_qualifier(trimmed),
                }
            {
                if let Some(ref mut feat) = current_feat {
                    let body = trimmed.trim_start_matches('/');
                    let (k, v_raw) = body.split_once('=').unwrap_or((body, ""));
                    // A quoted value continues until its closing quote; an unquoted one, such as
                    // /transl_except, until the next /key or feature.
                    let (v, end) = match v_raw.strip_prefix('"') {
                        Some(quoted) => quoted_value_line(quoted),
                        None => (v_raw.to_string(), QuoteEnd::Closed),
                    };
                    // A repeated qualifier keeps every value, the next after a "\n" (see this
                    // function's doc).
                    if let Some(ref mut qmap) = feat.qualifiers {
                        match qmap.get_mut(k) {
                            // A repeat with no value at all (`/pseudo` again) adds none.
                            Some(_) if !body.contains('=') => {}
                            Some(values) => {
                                values.push('\n');
                                values.push_str(&v);
                            }
                            None => {
                                qmap.insert(k.to_string(), v);
                            }
                        }
                    }
                    in_qualifier = (end != QuoteEnd::Closed).then_some(end);
                    last_qualifier = Some(k.to_string());
                }
            } else if let Some(ref mut feat) = current_feat {
                // A line that does not begin a /key continues the latest qualifier or, before the
                // first, the location. Inside an open quoted value a line beginning with "/" does
                // too, unless the branch above took it as the next qualifier.
                if let Some(key) = last_qualifier.clone() {
                    let (piece, end) = if in_qualifier.is_some() {
                        quoted_value_line(trimmed)
                    } else {
                        (trimmed.to_string(), QuoteEnd::Closed)
                    };
                    if let Some(ref mut qmap) = feat.qualifiers {
                        let entry = qmap.entry(key.clone()).or_default();
                        // Sequences (translation, primer_sequence …) and /anticodon and /transl_except join
                        // without spaces; prose joins with one. A line holding only the closing quote,
                        // which follows a word that filled its line, adds nothing. The line continues
                        // the last value of a repeated qualifier.
                        let value = entry.rsplit('\n').next().unwrap_or_default();
                        if qualifier_break(&key) == BreakAt::Space && !value.is_empty() && !piece.is_empty() {
                            entry.push(' ');
                        }
                        entry.push_str(&piece);
                    }
                    in_qualifier = (end != QuoteEnd::Closed).then_some(end);
                } else {
                    // Continuation of a long location such as join(...).
                    loc_buf.push_str(trimmed);
                }
            }
        }
    }

    if let Some(f) = current_feat.take() {
        features.push(finish_feature(f, &loc_buf, &mut warnings));
    }

    // A record without ORIGIN (e.g. a CONTIG/summary record) has no bases; never treat the
    // flatfile text itself as sequence. Plain text without a LOCUS line is still accepted.
    let is_flatfile = lines.iter().any(|l| l.starts_with("LOCUS"));
    if seq_buf.is_empty() && !is_flatfile {
        seq_buf = clean_alpha_sequence(text);
    }
    let mut doc_metadata: Option<HashMap<String, serde_json::Value>> = None;
    if seq_buf.is_empty() && locus_length > 0 {
        doc_metadata = Some(HashMap::from([
            ("Declared Length".to_string(), serde_json::json!(locus_length)),
            ("Is Contig Summary".to_string(), serde_json::json!(true)),
        ]));
    }
    // The block withWarningNotes (src/core/operationRunners.ts) writes: "Warnings:", then one
    // "- " line per warning, each once, in the order the features are read.
    let mut seen = std::collections::HashSet::new();
    let kept: Vec<&String> = warnings.iter().filter(|w| seen.insert(w.as_str())).collect();
    if !kept.is_empty() {
        let lines: Vec<String> = kept.iter().map(|w| format!("- {w}")).collect();
        doc_metadata
            .get_or_insert_with(HashMap::new)
            .insert("Notes".to_string(), serde_json::json!(format!("Warnings:\n{}\n", lines.join("\n"))));
    }

    let len = seq_buf.len();
    features.retain(|f| f.start > 0);
    resolve_wrapped_features(&mut features, if len > 0 { len } else { locus_length });
    let now = "2026-10-31".to_string();
    let folder = if molecule_type == MoleculeType::Protein {
        "Protein Documents"
    } else if len >= 25_000 {
        "Genomes"
    } else if topology == Topology::Circular {
        "Plasmids & Vectors"
    } else {
        "Cloning"
    };

    SequenceDocument {
        id: format!("gb-{}-{}", name.to_ascii_lowercase(), len),
        name,
        accession,
        description,
        molecule_type,
        topology,
        sequence: seq_buf,
        features,
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: "hist-gb-1".into(),
            timestamp: now.clone(),
            operation: "Imported GenBank Flatfile (Rust)".into(),
            description: format!("Parsed GenBank record ({} residues)", len),
            parent_ids: Vec::new(),
            length_bp: len,
            topology,
            history_color: Some("#0284c7".into()),
            inserted_range: None,
        }],
        chromatogram: None,
        alignment_meta: None,
        document_kind: None,
        doc_metadata,
        created_at: now.clone(),
        updated_at: now,
        folder: folder.into(),
    }
}

/// Record length for export headers. Annotation-only (contig summary) records
/// have no bases but keep their declared length, which their features use.
pub(crate) fn record_length(doc: &SequenceDocument) -> usize {
    let declared = doc
        .doc_metadata
        .as_ref()
        .and_then(|m| m.get("Declared Length").or_else(|| m.get("Sequence Length")))
        .and_then(|v| v.as_u64().or_else(|| v.as_str().and_then(|s| s.replace(',', "").parse().ok())))
        .unwrap_or(0) as usize;
    if doc.sequence.is_empty() && declared > 0 {
        declared
    } else {
        doc.sequence.len()
    }
}

/// Export a `SequenceDocument` to INSDC GenBank flatfile format.
///
/// The DEFINITION ends with GenBank's full stop, written after any the description already ends
/// with, and [`parse_genbank_flatfile`] drops exactly that one again: a description ending in an
/// abbreviation is written "Bacillus sp.." and reads back "Bacillus sp.", as Biopython 1.88
/// writes and reads it. A line break in the description is written as one space (see
/// [`description_line`]), so "a\n//\nb" reads back "a // b".
pub fn export_genbank_flatfile(doc: &SequenceDocument) -> String {
    // Annotation-only summary records keep their declared length and have no ORIGIN bases.
    let len = record_length(doc);
    let unit = if doc.molecule_type == MoleculeType::Protein {
        "aa"
    } else {
        "bp"
    };
    let mol_str = match doc.molecule_type {
        MoleculeType::DNA => "   DNA",
        MoleculeType::RNA => "   RNA",
        MoleculeType::Protein => "",
    };
    let topo_str = match doc.topology {
        Topology::Circular => "circular",
        Topology::Linear => "linear  ",
    };
    let safe_locus = doc
        .name
        .chars()
        .map(|c| if c.is_ascii_alphanumeric() || c == '_' || c == '-' { c } else { '_' })
        .take(24)
        .collect::<String>();

    let mut out = String::with_capacity(len + len / 3 + 1024);
    // INSDC LOCUS layout: name (13-28), length right-aligned to column 40, units, strandedness +
    // molecule (45-53), topology (56-63), division (65-67), date (69-79).
    let name_field = if safe_locus.len() <= 16 { format!("{:<16}", safe_locus) } else { safe_locus.clone() };
    let len_width = if safe_locus.len() <= 16 { 11 } else { 1 };
    out.push_str(&format!(
        "LOCUS       {} {:>w$} {} {:<9}  {} SYN 31-OCT-2026\n",
        name_field,
        len,
        unit,
        mol_str,
        topo_str,
        w = len_width
    ));
    // GenBank's final full stop, after any the description ends with (see this function's doc).
    out.push_str(&wrap_feature_line("DEFINITION  ", "            ", &format!("{}.", description_line(&doc.description)), BreakAt::Space));
    let accession = if doc.accession.trim().is_empty() { safe_locus.clone() } else { doc.accession.clone() };
    out.push_str(&format!("ACCESSION   {}\n", accession));
    out.push_str(&format!("VERSION     {}\n", accession));
    out.push_str("FEATURES             Location/Qualifiers\n");
    let has_source = doc.features.iter().any(|f| f.feature_type == "source");
    if !has_source {
        out.push_str(&format!(
            "     source          1..{}\n                     /mol_type=\"{}\"\n",
            len.max(1),
            match doc.molecule_type {
                MoleculeType::RNA => "other RNA",
                MoleculeType::Protein => "protein",
                MoleculeType::DNA => "other DNA",
            }
        ));
    }

    const QUAL: &str = "                     ";
    for feat in &doc.features {
        let key = &feat.feature_type;
        out.push_str(&wrap_feature_line(&format!("     {:<15} ", key), QUAL, &format_insdc_location(feat), BreakAt::Comma));
        out.push_str(&feature_qualifier_lines(feat, QUAL, key != "source"));
    }

    out.push_str("ORIGIN\n");
    let lower_bytes = doc.sequence.to_ascii_lowercase();
    let bytes = lower_bytes.as_bytes();
    let mut idx = 0usize;
    while idx < bytes.len() {
        out.push_str(&format!("{:>9}", idx + 1));
        let row_end = (idx + 60).min(bytes.len());
        let mut col = idx;
        while col < row_end {
            let chunk_end = (col + 10).min(row_end);
            out.push(' ');
            out.push_str(&lower_bytes[col..chunk_end]);
            col = chunk_end;
        }
        out.push('\n');
        idx = row_end;
    }
    out.push_str("//\n");
    out
}

/// Parse an EMBL/ENA flatfile.
///
/// EMBL and GenBank share the INSDC feature-table syntax (keys at column 6,
/// qualifiers at column 22), so the record is rewritten line-by-line into its
/// GenBank equivalent (ID→LOCUS, DE→DEFINITION, AC→ACCESSION, FT→FEATURES,
/// SQ→ORIGIN) and handed to [`parse_genbank_flatfile`]. Previously `.embl`
/// files went straight to the GenBank parser, which — finding no LOCUS line —
/// read every letter of the file, headers included, as sequence.
///
/// DE has no full-stop convention: the description is its DE lines joined
/// with one space, a final full stop kept, as Biopython 1.88 reads it, and
/// [`export_embl_flatfile`] writes it as it is.
///
/// The record ends at its "//" line whether or not it has an SQ block (a CON record has CO lines
/// instead), the line at which Biopython 1.88 ends it too, so the text of a multi-record file
/// reads as its first record alone, with that record's own ID, DE and features. Inside SQ it also
/// ends at an indented "//", as Biopython 1.88's EMBL reader does, which strips a sequence line on
/// both sides before it compares it with "//".
pub fn parse_embl_flatfile(text: &str, fallback_name: &str) -> SequenceDocument {
    let mut name = String::new();
    let mut accession = String::new();
    let mut description: Vec<String> = Vec::new();
    let mut topology = "linear";
    let mut mol = "DNA";
    let mut unit = "bp";
    let mut declared_len: usize = 0;
    let mut features: Vec<String> = Vec::new();
    let mut origin: Vec<String> = Vec::new();
    let mut in_sq = false;

    for raw in text.lines() {
        // The record's "//" line ends it, after SQ or without one (see this function's doc).
        if ends_record(raw) {
            break;
        }
        if in_sq {
            if raw.trim_start().starts_with("//") {
                break;
            }
            origin.push(raw.to_string());
            continue;
        }
        let (tag, rest) = if raw.len() >= 2 { raw.split_at(2) } else { (raw, "") };
        match tag {
            "ID" => {
                let fields: Vec<&str> = rest.split(';').map(|f| f.trim()).collect();
                if let Some(first) = fields.first() {
                    name = first.split_whitespace().next().unwrap_or("").to_string();
                }
                // fields[0] is the entry name: "pRNA_vec" must not make a DNA
                // record RNA (the same defect the LOCUS reader had).
                for (fi, f) in fields.iter().enumerate() {
                    let lower = f.to_ascii_lowercase();
                    if lower == "circular" {
                        topology = "circular";
                    }
                    if fi > 0 {
                        if lower == "prt" || lower.contains("protein") {
                            mol = "PRT";
                            unit = "aa";
                        } else if lower.ends_with("rna") {
                            mol = "RNA";
                        }
                    }
                    let toks: Vec<&str> = lower.trim_end_matches('.').split_whitespace().collect();
                    if toks.len() == 2 && (toks[1] == "bp" || toks[1] == "aa") {
                        declared_len = toks[0].parse().unwrap_or(0);
                        // The app's own protein export writes "PRT; … 22 BP."; the
                        // molecule type wins over the length unit.
                        if toks[1] == "aa" || mol == "PRT" {
                            unit = "aa";
                            mol = "PRT";
                        }
                    }
                }
            }
            "AC" if accession.is_empty() => {
                accession = rest
                    .split(';')
                    .next()
                    .unwrap_or("")
                    .trim()
                    .to_string();
            }
            "DE" => description.push(rest.trim().to_string()),
            // "FT" + 3 spaces + key  ->  5 spaces + key (identical column layout).
            "FT" => features.push(format!("  {}", rest)),
            "SQ" => in_sq = true,
            _ => {}
        }
    }

    if name.is_empty() {
        name = if accession.is_empty() { fallback_name.to_string() } else { accession.clone() };
    }
    let mut gb = String::with_capacity(text.len() + 256);
    let mol_token = if mol == "PRT" { "" } else { mol };
    gb.push_str(&format!(
        "LOCUS       {} {} {} {} {}\n",
        name, declared_len, unit, mol_token, topology
    ));
    if !description.is_empty() {
        gb.push_str(&format!("DEFINITION  {}\n", description.join(" ")));
    }
    if !accession.is_empty() {
        gb.push_str(&format!("ACCESSION   {}\n", accession));
    }
    gb.push_str("FEATURES             Location/Qualifiers\n");
    for line in &features {
        gb.push_str(line);
        gb.push('\n');
    }
    gb.push_str("ORIGIN\n");
    for line in &origin {
        // Strip the trailing base-count column; the GenBank reader keeps letters only.
        gb.push_str(line);
        gb.push('\n');
    }
    gb.push_str("//\n");
    let mut doc = parse_genbank_flatfile(&gb, fallback_name);
    if accession.is_empty() {
        doc.accession = String::new();
    }
    if !description.is_empty() {
        doc.description = description.join(" ");
    }
    doc
}

/// Export a `SequenceDocument` to EMBL-EBI flatfile format (`.embl`). A line break in the
/// description is written as one space on DE (see [`description_line`]).
pub fn export_embl_flatfile(doc: &SequenceDocument) -> String {
    let len = record_length(doc);
    let topo = match doc.topology {
        Topology::Circular => "circular",
        Topology::Linear => "linear",
    };
    let mol = match doc.molecule_type {
        MoleculeType::RNA => "RNA",
        MoleculeType::Protein => "PRT",
        MoleculeType::DNA => "genomic DNA",
    };
    let mut out = String::with_capacity(len + 1024);
    out.push_str(&format!(
        "ID   {}; SV 1; {}; {}; SYN; SYN; {} BP.\n",
        doc.accession, topo, mol, len
    ));
    out.push_str("XX\n");
    out.push_str(&format!("AC   {};\n", doc.accession));
    out.push_str("XX\n");
    out.push_str(&wrap_feature_line("DE   ", "DE   ", &description_line(&doc.description), BreakAt::Space));
    out.push_str("XX\n");
    out.push_str("FH   Key             Location/Qualifiers\n");
    out.push_str("FH\n");
    const FT_QUAL: &str = "FT                   ";
    for feat in &doc.features {
        out.push_str(&wrap_feature_line(
            &format!("FT   {:<15} ", feat.feature_type),
            FT_QUAL,
            &format_insdc_location(feat),
            BreakAt::Comma,
        ));
        out.push_str(&feature_qualifier_lines(feat, FT_QUAL, true));
    }
    out.push_str("XX\n");
    // Annotation-only (CON-like) records carry no bases: no SQ block, as the
    // GenBank export omits ORIGIN; the ID line keeps the declared length.
    if !doc.sequence.is_empty() {
        out.push_str(&format!("SQ   Sequence {} BP;\n", len));
    }
    let lower = doc.sequence.to_ascii_lowercase();
    let mut i = 0usize;
    while i < lower.len() {
        let end = (i + 60).min(lower.len());
        out.push_str("    ");
        let mut c = i;
        while c < end {
            let ce = (c + 10).min(end);
            out.push(' ');
            out.push_str(&lower[c..ce]);
            c = ce;
        }
        out.push_str(&format!(" {:>9}\n", end));
        i = end;
    }
    out.push_str("//\n");
    out
}

/// Parse an Applied Biosystems ABIF v1.0 (`.ab1`) binary file according to the published
/// ABIF directory specification (`ABIF` magic header, 28-byte big-endian directory entries,
/// `FWO_ 1` filter-wheel base order, `PBAS 1/2` called bases, `PCON 1/2` Phred quality values,
/// `PLOC 1/2` peak sample positions, and `DATA 9..12` processed 4-dye fluorescence traces).
pub fn parse_abif_chromatogram(bytes: &[u8]) -> Option<ChromatogramData> {
    if bytes.len() < 34 || &bytes[0..4] != b"ABIF" {
        return None;
    }
    let num_elements = i32::from_be_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]) as usize;
    let dir_offset = u32::from_be_bytes([bytes[26], bytes[27], bytes[28], bytes[29]]) as usize;
    if num_elements == 0 || num_elements > 16_384 || dir_offset >= bytes.len() {
        return None;
    }

    let mut fwo: [u8; 4] = *b"GATC";
    let mut pbas: Option<String> = None;
    let mut pcon: Option<Vec<u8>> = None;
    let mut ploc: Option<Vec<usize>> = None;
    let mut data_channels: [Option<Vec<f64>>; 4] = [None, None, None, None]; // DATA 9, 10, 11, 12
    let mut raw_channels: [Option<Vec<f64>>; 4] = [None, None, None, None]; // DATA 1, 2, 3, 4

    for idx in 0..num_elements {
        let entry_pos = dir_offset.saturating_add(idx.saturating_mul(28));
        if entry_pos.saturating_add(28) > bytes.len() {
            break;
        }
        let entry = &bytes[entry_pos..entry_pos + 28];
        let tag_name = &entry[0..4];
        let tag_num = i32::from_be_bytes([entry[4], entry[5], entry[6], entry[7]]);
        let elem_type = i16::from_be_bytes([entry[8], entry[9]]);
        let elem_count = i32::from_be_bytes([entry[12], entry[13], entry[14], entry[15]]).max(0) as usize;
        let data_size = i32::from_be_bytes([entry[16], entry[17], entry[18], entry[19]]).max(0) as usize;
        let raw_offset_bytes = [entry[20], entry[21], entry[22], entry[23]];

        let payload: &[u8] = if data_size <= 4 {
            &entry[20..20 + data_size]
        } else {
            let off = u32::from_be_bytes(raw_offset_bytes) as usize;
            if off.saturating_add(data_size) > bytes.len() {
                continue;
            }
            &bytes[off..off + data_size]
        };

        if tag_name == b"FWO_" && tag_num == 1 && payload.len() >= 4 {
            fwo = [
                payload[0].to_ascii_uppercase(),
                payload[1].to_ascii_uppercase(),
                payload[2].to_ascii_uppercase(),
                payload[3].to_ascii_uppercase(),
            ];
        } else if tag_name == b"PBAS" && (tag_num == 1 || (tag_num == 2 && pbas.is_none())) {
            let s: String = payload
                .iter()
                .copied()
                .filter(|b| b.is_ascii_alphabetic())
                .map(|b| (b.to_ascii_uppercase()) as char)
                .collect();
            if !s.is_empty() {
                pbas = Some(s);
            }
        } else if tag_name == b"PCON" && (tag_num == 1 || (tag_num == 2 && pcon.is_none())) {
            if !payload.is_empty() {
                pcon = Some(payload.iter().map(|&q| q.min(93)).collect());
            }
        } else if tag_name == b"PLOC" && (tag_num == 1 || (tag_num == 2 && ploc.is_none())) {
            if elem_type == 4 && payload.len() >= 2 {
                let mut locs = Vec::with_capacity(elem_count.min(payload.len() / 2));
                for chunk in payload.chunks_exact(2) {
                    locs.push(u16::from_be_bytes([chunk[0], chunk[1]]) as usize);
                }
                ploc = Some(locs);
            }
        } else if tag_name == b"DATA" && (1..=4).contains(&tag_num) {
            if elem_type == 4 && payload.len() >= 2 {
                raw_channels[(tag_num - 1) as usize] = Some(
                    payload
                        .chunks_exact(2)
                        .map(|c| i16::from_be_bytes([c[0], c[1]]).max(0) as f64)
                        .collect(),
                );
            }
        } else if tag_name == b"DATA" && (9..=12).contains(&tag_num) {
            let ch_idx = (tag_num - 9) as usize;
            if elem_type == 4 && payload.len() >= 2 {
                let mut trace = Vec::with_capacity(elem_count.min(payload.len() / 2));
                for chunk in payload.chunks_exact(2) {
                    let v = i16::from_be_bytes([chunk[0], chunk[1]]).max(0) as f64;
                    trace.push(v);
                }
                data_channels[ch_idx] = Some(trace);
            }
        }
    }

    let base_calls = pbas?;
    if base_calls.is_empty() {
        return None;
    }

    // Prefer processed traces (DATA 9..12); fall back to raw traces (DATA 1..4). Both are stored
    // in filter-wheel order (FWO_). Absent traces stay absent rather than being synthesized.
    if data_channels.iter().any(|c| c.is_none()) && raw_channels.iter().all(|c| c.is_some()) {
        data_channels = raw_channels;
    }
    let has_all_traces = data_channels.iter().all(|c| c.is_some());

    let mut trace_a = Vec::new();
    let mut trace_c = Vec::new();
    let mut trace_g = Vec::new();
    let mut trace_t = Vec::new();
    if has_all_traces {
        for (ch_idx, &base_letter) in fwo.iter().enumerate() {
            let vec = data_channels[ch_idx].take().unwrap_or_default();
            match base_letter {
                b'A' => trace_a = vec,
                b'C' => trace_c = vec,
                b'G' => trace_g = vec,
                _ => trace_t = vec,
            }
        }
    }
    let trace_len = trace_a
        .len()
        .max(trace_c.len())
        .max(trace_g.len())
        .max(trace_t.len());
    trace_a.resize(trace_len, 0.0);
    trace_c.resize(trace_len, 0.0);
    trace_g.resize(trace_len, 0.0);
    trace_t.resize(trace_len, 0.0);

    // Peak positions and qualities are reported only when the file records them.
    let peak_locations = ploc.unwrap_or_default();
    let phred_scores = pcon.unwrap_or_default();

    Some(ChromatogramData {
        trace_a,
        trace_c,
        trace_g,
        trace_t,
        peak_locations,
        phred_scores,
        base_calls,
    })
}

/// Construct a standards-compliant Applied Biosystems ABIF v1.01 (`.ab1`) binary byte buffer
/// from a chromatogram so ABIF parsing can be validated deterministically in unit tests.
pub fn encode_abif_chromatogram_bytes(chrom: &ChromatogramData) -> Vec<u8> {
    let bases = chrom.base_calls.as_bytes();
    let n_bases = bases.len();
    let trace_len = chrom
        .trace_a
        .len()
        .min(chrom.trace_c.len())
        .min(chrom.trace_g.len())
        .min(chrom.trace_t.len());

    // 8 directory tags: FWO_ 1, PBAS 1, PCON 1, PLOC 1, DATA 9 (G), DATA 10 (A), DATA 11 (T), DATA 12 (C)
    let num_entries: usize = 8;
    let dir_offset: usize = 34;
    let payload_start: usize = dir_offset + num_entries * 28;

    let mut out = vec![0u8; payload_start];
    out[0..4].copy_from_slice(b"ABIF");
    out[4..6].copy_from_slice(&101u16.to_be_bytes());
    out[6..10].copy_from_slice(b"tdir");
    out[10..14].copy_from_slice(&1i32.to_be_bytes());
    out[14..16].copy_from_slice(&1023i16.to_be_bytes());
    out[16..18].copy_from_slice(&28i16.to_be_bytes());
    out[18..22].copy_from_slice(&(num_entries as i32).to_be_bytes());
    out[22..26].copy_from_slice(&((num_entries * 28) as i32).to_be_bytes());
    out[26..30].copy_from_slice(&(dir_offset as u32).to_be_bytes());

    let mut write_dir_entry =
        |idx: usize, name: &[u8; 4], num: i32, etype: i16, esize: i16, count: usize, data: &[u8]| {
            let pos = dir_offset + idx * 28;
            out[pos..pos + 4].copy_from_slice(name);
            out[pos + 4..pos + 8].copy_from_slice(&num.to_be_bytes());
            out[pos + 8..pos + 10].copy_from_slice(&etype.to_be_bytes());
            out[pos + 10..pos + 12].copy_from_slice(&esize.to_be_bytes());
            out[pos + 12..pos + 16].copy_from_slice(&(count as i32).to_be_bytes());
            out[pos + 16..pos + 20].copy_from_slice(&(data.len() as i32).to_be_bytes());
            if data.len() <= 4 {
                out[pos + 20..pos + 20 + data.len()].copy_from_slice(data);
            } else {
                let off = out.len() as u32;
                out[pos + 20..pos + 24].copy_from_slice(&off.to_be_bytes());
                out.extend_from_slice(data);
            }
        };

    write_dir_entry(0, b"FWO_", 1, 2, 1, 4, b"GATC");
    write_dir_entry(1, b"PBAS", 1, 2, 1, n_bases, bases);
    let pcon_bytes: Vec<u8> = (0..n_bases)
        .map(|i| chrom.phred_scores.get(i).copied().unwrap_or(40))
        .collect();
    write_dir_entry(2, b"PCON", 1, 2, 1, n_bases, &pcon_bytes);

    let mut ploc_bytes = Vec::with_capacity(n_bases * 2);
    for i in 0..n_bases {
        let loc = chrom.peak_locations.get(i).copied().unwrap_or(i * 12 + 8) as u16;
        ploc_bytes.extend_from_slice(&loc.to_be_bytes());
    }
    write_dir_entry(3, b"PLOC", 1, 4, 2, n_bases, &ploc_bytes);

    let encode_trace = |tr: &[f64]| -> Vec<u8> {
        let mut buf = Vec::with_capacity(trace_len * 2);
        for &v in tr.iter().take(trace_len) {
            let iv = v.round().clamp(0.0, 32000.0) as i16;
            buf.extend_from_slice(&iv.to_be_bytes());
        }
        buf
    };
    let g_bytes = encode_trace(&chrom.trace_g);
    let a_bytes = encode_trace(&chrom.trace_a);
    let t_bytes = encode_trace(&chrom.trace_t);
    let c_bytes = encode_trace(&chrom.trace_c);
    write_dir_entry(4, b"DATA", 9, 4, 2, trace_len, &g_bytes);
    write_dir_entry(5, b"DATA", 10, 4, 2, trace_len, &a_bytes);
    write_dir_entry(6, b"DATA", 11, 4, 2, trace_len, &t_bytes);
    write_dir_entry(7, b"DATA", 12, 4, 2, trace_len, &c_bytes);

    out
}

/// Reads ABIF metadata tags useful to a user (instrument, sample, dye set, run date).
fn abif_text_tags(bytes: &[u8]) -> Vec<(String, String)> {
    let mut out = Vec::new();
    if bytes.len() < 34 || &bytes[0..4] != b"ABIF" {
        return out;
    }
    let n = i32::from_be_bytes([bytes[18], bytes[19], bytes[20], bytes[21]]).max(0) as usize;
    let dir = u32::from_be_bytes([bytes[26], bytes[27], bytes[28], bytes[29]]) as usize;
    for idx in 0..n.min(16_384) {
        let pos = dir + idx * 28;
        let Some(e) = bytes.get(pos..pos + 28) else { break };
        let label = match (&e[0..4], i32::from_be_bytes([e[4], e[5], e[6], e[7]])) {
            (b"MCHN", 1) => "Instrument",
            (b"MODL", 1) => "Instrument Model",
            (b"SMPL", 1) => "Sample Name",
            (b"PDMF", 1) => "Mobility File",
            (b"TUBE", 1) => "Well",
            _ => continue,
        };
        let size = i32::from_be_bytes([e[16], e[17], e[18], e[19]]).max(0) as usize;
        let data: &[u8] = if size <= 4 {
            &e[20..20 + size]
        } else {
            let off = u32::from_be_bytes([e[20], e[21], e[22], e[23]]) as usize;
            match bytes.get(off..off + size) { Some(d) => d, None => continue }
        };
        // pString (type 18) carries a leading length byte.
        let etype = i16::from_be_bytes([e[8], e[9]]);
        let data = if etype == 18 && !data.is_empty() { &data[1..] } else { data };
        // ABI writes Mac OS Roman text; map its trademark sign and treat other bytes as Latin-1.
        let text: String = data
            .iter()
            .map(|&b| if b == 0xAA { '™' } else { b as char })
            .collect::<String>()
            .trim_matches(char::from(0))
            .trim()
            .to_string();
        if !text.is_empty() {
            out.push((label.to_string(), text));
        }
    }
    out
}

fn file_stem(file_name: &str) -> String {
    let base = file_name.rsplit(['/', '\\']).next().unwrap_or(file_name);
    match base.rfind('.') {
        Some(i) if i > 0 => base[..i].to_string(),
        _ => base.to_string(),
    }
}

/// Decodes a binary trace file by its signature: ABIF (`.ab1`/`.abi`) or SCF. Plain-text sequence
/// saved under a binary extension is also accepted.
/// Unrecognised data yields a document with an empty sequence and an explanatory description;
/// bases, traces and qualities are never synthesized.
pub fn parse_binary_sequence_packet(bytes: &[u8], file_name: &str) -> SequenceDocument {
    use crate::scf::parse_scf_chromatogram;
    let stem = file_stem(file_name);
    let now = "2026-10-31".to_string();
    let mut meta: HashMap<String, serde_json::Value> = HashMap::new();
    let molecule = MoleculeType::DNA;
    let topology = Topology::Linear;
    let features = Vec::new();
    let mut description;
    let op_title;
    let mut folder = "Plasmids & Vectors".to_string();
    let mut kind = None;

    let (seq, chromatogram) = if bytes.starts_with(b"ABIF") {
        let chrom = parse_abif_chromatogram(bytes);
        for (k, v) in abif_text_tags(bytes) {
            meta.insert(k, serde_json::json!(v));
        }
        meta.insert("Source Format".into(), serde_json::json!("ABIF"));
        op_title = "Imported ABIF chromatogram".to_string();
        folder = "Sequencing Reads (Sanger/NGS)".into();
        kind = Some("trace".to_string());
        match chrom {
            Some(c) => {
                description = format!(
                    "Applied Biosystems ABIF trace {} ({} bases{})",
                    file_name,
                    c.base_calls.len(),
                    if c.phred_scores.is_empty() { "; file has no per-base quality values" } else { "" }
                );
                (c.base_calls.clone(), Some(c))
            }
            None => {
                description = format!("{file_name}: ABIF file without base calls (PBAS); nothing could be read.");
                (String::new(), None)
            }
        }
    } else if let Some(scf) = parse_scf_chromatogram(bytes) {
        for (k, v) in &scf.comments {
            let label = match k.as_str() {
                "NAME" => "Sample Name",
                "MACH" => "Instrument",
                "MODL" => "Instrument Model",
                "DYEP" => "Mobility File",
                "DATE" => "Run Date",
                "LANE" => "Lane",
                _ => continue,
            };
            meta.insert(label.into(), serde_json::json!(v));
        }
        meta.insert("Source Format".into(), serde_json::json!(format!("SCF {}", scf.version)));
        op_title = "Imported SCF chromatogram".to_string();
        folder = "Sequencing Reads (Sanger/NGS)".into();
        kind = Some("trace".to_string());
        description = format!(
            "Standard Chromatogram Format (SCF {}) trace {} ({} bases)",
            scf.version, file_name, scf.chromatogram.base_calls.len()
        );
        (scf.chromatogram.base_calls.clone(), Some(scf.chromatogram))
    } else {
        let printable = !bytes.is_empty()
            && bytes.iter().all(|b| b.is_ascii_graphic() || b.is_ascii_whitespace());
        let text_seq: String = if printable {
            let t = String::from_utf8_lossy(bytes);
            let body: String = t.lines().filter(|l| !l.starts_with('>') && !l.starts_with(';')).collect();
            body.chars().filter(|c| c.is_ascii_alphabetic()).map(|c| c.to_ascii_uppercase()).collect()
        } else {
            String::new()
        };
        if !text_seq.is_empty() && text_seq.chars().all(|c| "ACGTURYSWKMBDHVN".contains(c)) {
            op_title = "Imported plain-text sequence".to_string();
            description = format!("Plain-text sequence read from {file_name}");
            (text_seq, None)
        } else {
            op_title = "Unrecognized file".to_string();
            description = format!(
                "{file_name} is not an ABIF or SCF file and contains no plain-text sequence; nothing was imported."
            );
            (String::new(), None)
        }
    };
    if seq.is_empty() && !description.contains("nothing") {
        description = format!("{description} (no sequence found)");
    }

    let len = seq.len();
    SequenceDocument {
        id: format!("bin-{}-{}", stem.to_ascii_lowercase().replace(' ', "-"), len),
        name: stem.clone(),
        accession: String::new(),
        description: description.clone(),
        molecule_type: molecule,
        topology: topology.clone(),
        sequence: seq,
        features,
        primers: Vec::new(),
        history: vec![HistoryTreeNode {
            id: "hist-bin-1".into(),
            timestamp: now.clone(),
            operation: op_title,
            description,
            parent_ids: Vec::new(),
            length_bp: len,
            topology,
            history_color: Some("#0072B2".into()),
            inserted_range: None,
        }],
        chromatogram,
        alignment_meta: None,
        document_kind: kind,
        doc_metadata: if meta.is_empty() { None } else { Some(meta) },
        created_at: now.clone(),
        updated_at: now,
        folder,
    }
}

/// Synthesize 4-channel capillary electrophoresis Gaussian peaks (12 samples/base) + Phred scores.
pub fn synthesize_sanger_chromatogram(seq: &str) -> ChromatogramData {
    let bases: Vec<u8> = seq.bytes().take(800).map(|b| b.to_ascii_uppercase()).collect();
    let n = bases.len();
    let spacing = 12usize;
    let total_pts = (n * spacing + 12).max(24);
    let mut trace_a = vec![4.0f64; total_pts];
    let mut trace_c = vec![4.0f64; total_pts];
    let mut trace_g = vec![4.0f64; total_pts];
    let mut trace_t = vec![4.0f64; total_pts];
    let mut peak_locations = Vec::with_capacity(n);
    let mut phred_scores = Vec::with_capacity(n);

    for (i, &b) in bases.iter().enumerate() {
        let center = i * spacing + 8;
        peak_locations.push(center);
        let edge_dist = i.min(n.saturating_sub(1 + i));
        let phred = if edge_dist < 8 {
            (18 + edge_dist * 2) as u8
        } else {
            42u8
        };
        phred_scores.push(phred);

        let amp = 420.0 + ((i * 37) % 110) as f64;
        let sigma2 = 2.0 * (2.65_f64).powi(2);
        let lo = center.saturating_sub(9);
        let hi = (center + 10).min(total_pts);
        for x in lo..hi {
            let dx = (x as f64) - (center as f64);
            let val = amp * (-(dx * dx) / sigma2).exp();
            match b {
                b'A' => trace_a[x] += val,
                b'C' => trace_c[x] += val,
                b'G' => trace_g[x] += val,
                _ => trace_t[x] += val,
            }
        }
    }

    ChromatogramData {
        trace_a,
        trace_c,
        trace_g,
        trace_t,
        peak_locations,
        phred_scores,
        base_calls: String::from_utf8_lossy(&bases).into_owned(),
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenBankSubmissionMeta {
    pub organism: String,
    pub strain_or_isolate: String,
    pub mol_type: String,
    pub genetic_code_id: u8,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenBankValidationIssue {
    pub severity: String, // "ERROR" | "WARN" | "PASS"
    pub rule: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GenBankSubmissionPackage {
    pub ready_for_submission: bool,
    pub fasta_fsa_text: String,
    pub feature_table_tbl_text: String,
    pub issues: Vec<GenBankValidationIssue>,
}

/// Validate a `SequenceDocument` against NCBI BankIt / GenBank Direct Submission rules
/// and generate the paired `.fsa` (annotated header FASTA) and 5-column `.tbl` feature table.
pub fn prepare_genbank_submission_package(
    doc: &SequenceDocument,
    meta: &GenBankSubmissionMeta,
) -> GenBankSubmissionPackage {
    let seq = clean_alpha_sequence(&doc.sequence);
    let len = seq.len();
    let mut issues = Vec::new();
    let mut has_error = false;

    if len < 200 {
        has_error = true;
        issues.push(GenBankValidationIssue {
            severity: "ERROR".into(),
            rule: "MIN_SEQUENCE_LENGTH".into(),
            message: format!(
                "NCBI GenBank requires >= 200 nt for direct submissions (current length: {} bp).",
                len
            ),
        });
    } else {
        issues.push(GenBankValidationIssue {
            severity: "PASS".into(),
            rule: "MIN_SEQUENCE_LENGTH".into(),
            message: format!("Sequence length ({} bp) satisfies NCBI >= 200 bp threshold.", len),
        });
    }

    if seq.starts_with('N') || seq.ends_with('N') {
        has_error = true;
        issues.push(GenBankValidationIssue {
            severity: "ERROR".into(),
            rule: "TERMINAL_AMBIGUOUS_N".into(),
            message: "Terminal 5' or 3' ambiguous 'N' bases are rejected by NCBI validation; trim ends first.".into(),
        });
    }

    let n_count = seq.bytes().filter(|&b| b == b'N').count();
    if len > 0 && (n_count as f64) / (len as f64) > 0.05 {
        issues.push(GenBankValidationIssue {
            severity: "WARN".into(),
            rule: "HIGH_AMBIGUITY_FRACTION".into(),
            message: format!(
                "Ambiguous 'N' content is {:.1}% (> 5.0% warning threshold).",
                (n_count as f64 / len as f64) * 100.0
            ),
        });
    }

    for feat in &doc.features {
        if feat.start == 0 || feat.end > len || feat.start > feat.end {
            has_error = true;
            issues.push(GenBankValidationIssue {
                severity: "ERROR".into(),
                rule: "FEATURE_BOUNDS".into(),
                message: format!(
                    "Feature '{}' ({}..{}) exceeds sequence bounds 1..{}.",
                    feat.name, feat.start, feat.end, len
                ),
            });
        } else if feat.feature_type == "CDS" && (feat.end - feat.start + 1) % 3 != 0 {
            issues.push(GenBankValidationIssue {
                severity: "WARN".into(),
                rule: "CDS_READING_FRAME".into(),
                message: format!(
                    "CDS '{}' length ({} bp) is not a multiple of 3; partial (<1 or >end) codon qualifier recommended.",
                    feat.name,
                    feat.end - feat.start + 1
                ),
            });
        }
    }

    if !has_error {
        issues.push(GenBankValidationIssue {
            severity: "PASS".into(),
            rule: "INSDC_SUBMISSION_GATE".into(),
            message: "All mandatory NCBI GenBank .fsa / 5-column .tbl checks passed.".into(),
        });
    }

    let seq_id = doc.accession.replace(char::is_whitespace, "_");
    let topo_tag = if doc.topology == Topology::Circular {
        " [topology=circular]"
    } else {
        ""
    };
    let fsa_header = format!(
        ">{} [organism={}] [strain={}] [moltype={}] [gcode={}]{} {}\n",
        seq_id,
        meta.organism,
        meta.strain_or_isolate,
        meta.mol_type,
        meta.genetic_code_id,
        topo_tag,
        doc.description
    );
    let mut fsa = String::with_capacity(fsa_header.len() + len + len / 70 + 8);
    fsa.push_str(&fsa_header);
    for chunk in seq.as_bytes().chunks(70) {
        fsa.push_str(&String::from_utf8_lossy(chunk));
        fsa.push('\n');
    }

    let mut tbl = format!(">Feature {}\n", seq_id);
    for feat in &doc.features {
        let (c1, c2) = if feat.strand < 0 {
            (feat.end, feat.start)
        } else {
            (feat.start, feat.end)
        };
        tbl.push_str(&format!("{}\t{}\t{}\n", c1, c2, feat.feature_type));
        let qual_key = if feat.feature_type == "CDS" {
            "product"
        } else if feat.feature_type == "gene" {
            "gene"
        } else {
            "note"
        };
        tbl.push_str(&format!("\t\t\t{}\t{}\n", qual_key, feat.name));
        if feat.feature_type == "CDS" {
            tbl.push_str(&format!("\t\t\ttransl_table\t{}\n", meta.genetic_code_id));
        }
    }

    GenBankSubmissionPackage {
        ready_for_submission: !has_error,
        fasta_fsa_text: fsa,
        feature_table_tbl_text: tbl,
        issues,
    }
}
