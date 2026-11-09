// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! Standards-compliant genomics streaming I/O powered by `noodles`:
//! - `noodles-fasta` (FASTA multi-record parsing & formatted 70-col serialization)
//! - `noodles-fastq` (FASTQ Phred+33 read parsing & Q20/Q30 quality control metrics)
//! - `noodles-gff` (GFF3 feature parsing & Sequence Ontology record writing)
//! - `noodles-bed` (BED3/BED6 genomic interval track parsing)
//! - `noodles-vcf` (VCF v4.3+ header & variant call record parsing/formatting)
//! - `noodles-sam` (SAM alignment header & mapped read summary statistics)

use std::collections::HashMap;

use molbiocraft_core::{
    clean_alpha_sequence, FeatureSegment, HistoryTreeNode, MoleculeType, SequenceDocument, SequenceFeature,
    Topology,
};
use noodles_core::Position;
use noodles_fasta as fasta;
use noodles_gff as gff;
use noodles_sam as sam;
use noodles_vcf as vcf;
use serde::{Deserialize, Serialize};
use std::io::{BufReader, Cursor};

fn detect_molecule_type(seq: &str) -> MoleculeType {
    let mut non_nuc = 0usize;
    let mut has_u = false;
    let mut has_t = false;
    for b in seq.bytes().take(4096) {
        match b.to_ascii_uppercase() {
            b'A' | b'C' | b'G' | b'N' | b'R' | b'Y' | b'S' | b'W' | b'K' | b'M' => {}
            b'U' => has_u = true,
            b'T' => has_t = true,
            b if b.is_ascii_alphabetic() => non_nuc += 1,
            _ => {}
        }
    }
    if non_nuc > 2 {
        MoleculeType::Protein
    } else if has_u && !has_t {
        MoleculeType::RNA
    } else {
        MoleculeType::DNA
    }
}

pub fn color_for_feature_type(ft: &str) -> &'static str {
    match ft {
        "CDS" | "gene" | "mRNA" => "#10b981",
        "promoter" => "#0284c7",
        "terminator" => "#dc2626",
        "rep_origin" => "#d97706",
        "primer_bind" => "#059669",
        "enhancer" | "regulatory" => "#7c3aed",
        "tag" | "sig_peptide" => "#8b5cf6",
        "crispr_guide" => "#e11d48",
        _ => "#3b82f6",
    }
}

/// Parse single or multi-record FASTA text via `noodles_fasta::io::Reader`.
/// Gracefully handles raw headerless sequence paste by wrapping it into a valid FASTA definition.
pub fn parse_fasta_noodles(text: &str, default_name: &str) -> Vec<SequenceDocument> {
    // Classic FASTA / PIR ';' comment lines carry no sequence; left in place
    // their words would be read as residues.
    let without_comments: String = text
        .lines()
        .filter(|line| !line.trim_start().starts_with(';'))
        .collect::<Vec<_>>()
        .join("\n");
    let trimmed = without_comments.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let normalized = if trimmed.starts_with('>') {
        trimmed.to_string()
    } else {
        format!(">{}\n{}", default_name, trimmed)
    };

    let cursor = Cursor::new(normalized.as_bytes());
    let mut reader = fasta::io::Reader::new(BufReader::new(cursor));
    let mut docs = Vec::new();
    let now = "2026-10-31".to_string();

    for (idx, res) in reader.records().enumerate() {
        let Ok(record) = res else {
            continue;
        };
        let raw_name = String::from_utf8_lossy(record.name()).trim().to_string();
        let name = if raw_name.is_empty() {
            format!("{}_{}", default_name, idx + 1)
        } else {
            raw_name
        };
        let desc = record
            .description()
            .map(|d| String::from_utf8_lossy(d).trim().to_string())
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| format!("Imported FASTA sequence ({})", name));

        let seq_bytes = record.sequence().as_ref();
        let raw_seq_str = String::from_utf8_lossy(seq_bytes);
        let clean_seq = clean_alpha_sequence(&raw_seq_str);
        if clean_seq.is_empty() {
            continue;
        }

        let mol_type = detect_molecule_type(&clean_seq);
        let lower_desc = desc.to_ascii_lowercase();
        let topology = if mol_type != MoleculeType::Protein
            && (lower_desc.contains("circular") || lower_desc.contains("plasmid"))
        {
            Topology::Circular
        } else {
            Topology::Linear
        };
        let folder = match mol_type {
            MoleculeType::Protein => "Protein Documents",
            _ if clean_seq.len() >= 25_000 => "Genomes",
            _ if topology == Topology::Circular => "Plasmids & Vectors",
            _ => "Cloning",
        };

        let len = clean_seq.len();
        docs.push(SequenceDocument {
            id: format!("fasta-{}-{}", idx + 1, len),
            name: name.clone(),
            accession: format!("FASTA_{:03}", idx + 1),
            description: desc,
            molecule_type: mol_type,
            topology,
            sequence: clean_seq,
            features: Vec::new(),
            primers: Vec::new(),
            history: vec![HistoryTreeNode {
                id: format!("hist-fasta-{}", idx + 1),
                timestamp: now.clone(),
                operation: "Imported FASTA (Noodles)".into(),
                description: format!("Parsed FASTA record '{}' ({} residues)", name, len),
                parent_ids: Vec::new(),
                length_bp: len,
                topology,
                history_color: Some("#2563eb".into()),
                inserted_range: None,
            }],
            chromatogram: None,
            alignment_meta: None,
            document_kind: None,
            doc_metadata: None,
            created_at: now.clone(),
            updated_at: now.clone(),
            folder: folder.into(),
        });
    }

    docs
}

/// Serialize a `SequenceDocument` to FASTA via `noodles_fasta::io::Writer`, whose default (noodles-fasta 0.49) wraps the sequence at 80 bases per line.
pub fn export_fasta_noodles(doc: &SequenceDocument) -> String {
    let header_desc = format!(
        "{} | {} | {} {}",
        doc.accession,
        doc.description,
        doc.sequence.len(),
        if doc.molecule_type == MoleculeType::Protein {
            "aa"
        } else {
            "bp"
        }
    );
    let safe_name = doc.name.replace(char::is_whitespace, "_");
    let definition = fasta::record::Definition::new(safe_name.as_str(), Some(header_desc.into_bytes()));
    let sequence = fasta::record::Sequence::from(doc.sequence.as_bytes().to_vec());
    let record = fasta::Record::new(definition, sequence);

    let mut buf = Vec::with_capacity(doc.sequence.len() + 256);
    {
        let mut writer = fasta::io::Writer::new(&mut buf);
        let _ = writer.write_record(&record);
    }
    String::from_utf8_lossy(&buf).into_owned()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FastqReadRecord {
    pub name: String,
    pub description: String,
    pub sequence: String,
    pub phred_scores: Vec<u8>,
    pub mean_phred: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FastqParseSummary {
    pub read_count: usize,
    pub total_bases: usize,
    pub mean_read_length: f64,
    pub mean_phred_score: f64,
    pub q20_base_pct: f64,
    pub q30_base_pct: f64,
    pub reads: Vec<FastqReadRecord>,
}

/// Stream and parse FASTQ reads + Phred+33 base qualities using `noodles_fastq::io::Reader`.
/// FASTQ quality encodings (Cock et al. 2010): Sanger / Illumina 1.8+ (Phred+33), Illumina
/// 1.3–1.7 (Phred+64) and Solexa (Solexa+64, converted to Phred).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FastqQualityEncoding {
    Phred33,
    Phred64,
    Solexa64,
}

impl FastqQualityEncoding {
    fn phred(self, c: u8) -> u8 {
        match self {
            FastqQualityEncoding::Phred33 => c.saturating_sub(33),
            FastqQualityEncoding::Phred64 => c.saturating_sub(64),
            FastqQualityEncoding::Solexa64 => {
                let sq = c as f64 - 64.0;
                (10.0 * (10f64.powf(sq / 10.0) + 1.0).log10()).round().clamp(0.0, 93.0) as u8
            }
        }
    }
}

/// Guesses the encoding from the quality characters (every 4th line): any below ';' (59) means
/// Phred+33; otherwise characters below '@' (64) mean Solexa; otherwise characters above 'J'
/// (74) mean Phred+64. Ambiguous files are read as Phred+33, the modern standard.
pub fn detect_fastq_quality_encoding(text: &str) -> FastqQualityEncoding {
    let (mut lo, mut hi) = (u8::MAX, 0u8);
    for (_, _, _, q) in fastq_records(text) {
        for b in q {
            lo = lo.min(b);
            hi = hi.max(b);
        }
    }
    // Phred+33 reaches at most 'J'..'K' (Q41-42) in practice; only a range that also runs past
    // 'J' (74) is Solexa (';' and up) or Phred+64 ('@' and up). A narrow band such as a constant
    // '<' (wgsim, Q27) is Phred+33.
    if lo == u8::MAX || lo < 59 || hi <= 74 {
        FastqQualityEncoding::Phred33
    } else if lo < 64 {
        FastqQualityEncoding::Solexa64
    } else {
        FastqQualityEncoding::Phred64
    }
}

/// Splits FASTQ text into (name, description, sequence, quality bytes) records. Follows the
/// FASTQ definition (Cock et al. 2010): sequence lines run to the "+" line, quality lines until
/// they are as long as the sequence — so wrapped records and quality lines beginning with "@"
/// or "+" are read correctly.
fn fastq_records(text: &str) -> Vec<(String, String, String, Vec<u8>)> {
    let lines: Vec<&str> = text.lines().map(|l| l.trim_end_matches('\r')).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < lines.len() {
        let Some(head) = lines[i].strip_prefix('@') else {
            i += 1;
            continue;
        };
        let (name, desc) = match head.split_once(char::is_whitespace) {
            Some((n, d)) => (n.to_string(), d.trim().to_string()),
            None => (head.to_string(), String::new()),
        };
        i += 1;
        let mut seq = String::new();
        while i < lines.len() && !lines[i].starts_with('+') {
            seq.push_str(lines[i].trim());
            i += 1;
        }
        i += 1; // the "+" line
        let mut qual: Vec<u8> = Vec::new();
        while i < lines.len() && qual.len() < seq.len() {
            qual.extend(lines[i].trim().bytes());
            i += 1;
        }
        out.push((name, desc, seq, qual));
    }
    out
}

pub fn parse_fastq_noodles(text: &str, max_reads: usize) -> FastqParseSummary {

    let mut reads = Vec::new();
    let mut total_bases = 0usize;
    let mut total_q_sum = 0u64;
    let mut q20_bases = 0usize;
    let mut q30_bases = 0usize;
    let mut all_reads = 0usize;
    let cap = max_reads.max(1);
    let encoding = detect_fastq_quality_encoding(text);

    for (name, description, seq_raw, qual_raw) in fastq_records(text) {
        let seq = seq_raw.to_ascii_uppercase();
        let quals: Vec<u8> = qual_raw.iter().map(|&q| encoding.phred(q)).collect();
        let len = seq.len();
        if len == 0 {
            continue;
        }
        all_reads += 1;
        let read_q_sum: u64 = quals.iter().map(|&q| q as u64).sum();
        for &q in &quals {
            if q >= 20 {
                q20_bases += 1;
            }
            if q >= 30 {
                q30_bases += 1;
            }
        }
        total_bases += len;
        total_q_sum += read_q_sum;
        let mean_q = if quals.is_empty() {
            0.0
        } else {
            ((read_q_sum as f64 / quals.len() as f64) * 100.0).round() / 100.0
        };

        if reads.len() < cap {
            reads.push(FastqReadRecord {
                name,
                description,
                sequence: seq,
                phred_scores: quals,
                mean_phred: mean_q,
            });
        }
    }

    let read_count = all_reads;
    let denom_bases = total_bases.max(1) as f64;
    FastqParseSummary {
        read_count,
        total_bases,
        mean_read_length: if read_count > 0 {
            ((total_bases as f64 / read_count as f64) * 10.0).round() / 10.0
        } else {
            0.0
        },
        mean_phred_score: ((total_q_sum as f64 / denom_bases) * 100.0).round() / 100.0,
        q20_base_pct: ((q20_bases as f64 / denom_bases) * 1000.0).round() / 10.0,
        q30_base_pct: ((q30_bases as f64 / denom_bases) * 1000.0).round() / 10.0,
        reads,
    }
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn strand_of(col: &str) -> i8 {
    match col {
        "-" => -1,
        "+" => 1,
        _ => 0, // "." unstranded, "?" unknown
    }
}

/// Parse GFF3 annotations (1-based, inclusive). Features spanning several lines with the same
/// `ID` (e.g. the exons of one CDS) become one feature with segments; names come from the
/// `Name`, `gene`, `product` or `ID` attributes.
pub fn parse_gff3_noodles(text: &str) -> Vec<SequenceFeature> {
    let mut out: Vec<SequenceFeature> = Vec::new();
    let mut by_id: HashMap<String, usize> = HashMap::new();
    for line in text.lines() {
        if line.starts_with("##FASTA") {
            break;
        }
        if line.starts_with('#') || line.trim().is_empty() {
            continue;
        }
        let cols: Vec<&str> = line.split('\t').collect();
        if cols.len() < 8 {
            continue;
        }
        let (Ok(start), Ok(end)) = (cols[3].trim().parse::<usize>(), cols[4].trim().parse::<usize>()) else {
            continue;
        };
        if start == 0 || end < start {
            continue;
        }
        let ft = cols[2].to_string();
        let mut attrs: HashMap<String, String> = HashMap::new();
        if let Some(a) = cols.get(8) {
            for kv in a.split(';').filter(|kv| !kv.trim().is_empty()) {
                if let Some((k, v)) = kv.split_once('=') {
                    attrs.insert(percent_decode(k.trim()), percent_decode(v.trim()));
                }
            }
        }
        let id = attrs.get("ID").cloned();
        if let Some(existing) = id.as_ref().and_then(|i| by_id.get(&(ft.clone() + "\u{1}" + i))).copied() {
            let f = &mut out[existing];
            let segs = f.segments.get_or_insert_with(|| {
                vec![FeatureSegment { index: 1, name: format!("{} part 1", f.name), start: f.start, end: f.end, color: f.color.clone() }]
            });
            let n = segs.len() + 1;
            segs.push(FeatureSegment { index: n, name: format!("{} part {}", f.name, n), start, end, color: f.color.clone() });
            f.start = f.start.min(start);
            f.end = f.end.max(end);
            continue;
        }
        let name = ["Name", "gene", "product", "ID"]
            .iter()
            .find_map(|k| attrs.get(*k).cloned())
            .unwrap_or_else(|| format!("{}_{}", ft, out.len() + 1));
        let mut qualifiers = attrs.clone();
        qualifiers.insert("seqid".into(), cols[0].to_string());
        if cols[7] != "." {
            qualifiers.insert("phase".into(), cols[7].to_string());
        }
        if let Some(i) = &id {
            by_id.insert(ft.clone() + "\u{1}" + i, out.len());
        }
        out.push(SequenceFeature {
            id: format!("gff-{}", out.len() + 1),
            name,
            feature_type: ft.clone(),
            start,
            end,
            strand: strand_of(cols[6].trim()),
            color: color_for_feature_type(&ft).into(),
            notes: attrs.get("Note").cloned().or_else(|| Some(format!("Source: {} ({})", cols[1], cols[0]))),
            qualifiers: Some(qualifiers),
            segments: None,
            cleavage_site: None,
        });
    }
    out
}

/// Export `SequenceDocument` annotations to GFF3 format using `noodles_gff::io::Writer` & `RecordBuf`.
pub fn export_gff3_noodles(doc: &SequenceDocument) -> String {
    let seq_id = doc.accession.replace(char::is_whitespace, "_");
    let seq_id = if seq_id.is_empty() { "SEQ_1".to_string() } else { seq_id };
    let len = crate::flatfiles::record_length(doc).max(1);

    let mut buf = Vec::with_capacity(1024 + doc.features.len() * 128);
    buf.extend_from_slice(b"##gff-version 3\n");
    buf.extend_from_slice(format!("##sequence-region {} 1 {}\n", seq_id, len).as_bytes());

    {
        let mut writer = gff::io::Writer::new(&mut buf);
        for feat in &doc.features {
            let strand = if feat.strand < 0 {
                gff::record::Strand::Reverse
            } else if feat.strand > 0 {
                gff::record::Strand::Forward
            } else {
                gff::record::Strand::None
            };
            // One line per interval sharing the same ID (GFF3 multi-line features). CDS phase
            // counts bases already used in the direction of transcription.
            let mut parts: Vec<(usize, usize)> = match feat.segments.as_ref().filter(|s| s.len() > 1) {
                Some(segs) => segs.iter().map(|s| (s.start, s.end)).collect(),
                None => vec![(feat.start, feat.end)],
            };
            parts.sort_by_key(|p| p.0);
            let mut transcription_order: Vec<usize> = (0..parts.len()).collect();
            if feat.strand < 0 {
                transcription_order.reverse();
            }
            let mut phases = vec![0u8; parts.len()];
            let mut used = 0usize;
            for &i in &transcription_order {
                phases[i] = ((3 - used % 3) % 3) as u8;
                used += parts[i].1 + 1 - parts[i].0;
            }
            for (i, &(a, b)) in parts.iter().enumerate() {
                let s_pos = Position::try_from(a.max(1)).unwrap_or(Position::MIN);
                let e_pos = Position::try_from(b.max(a).max(1)).unwrap_or(s_pos);
                let attrs: gff::record_buf::Attributes = [
                    (
                        "ID".into(),
                        gff::record_buf::attributes::field::Value::from(feat.id.as_str()),
                    ),
                    (
                        "Name".into(),
                        gff::record_buf::attributes::field::Value::from(feat.name.as_str()),
                    ),
                ]
                .into_iter()
                .collect();
                let mut builder = gff::RecordBuf::builder()
                    .set_reference_sequence_name(seq_id.clone())
                    .set_source("MolBioCraft")
                    .set_type(feat.feature_type.clone())
                    .set_start(s_pos)
                    .set_end(e_pos)
                    .set_strand(strand)
                    .set_attributes(attrs);
                if feat.feature_type.eq_ignore_ascii_case("CDS") {
                    builder = builder.set_phase(match phases[i] {
                        1 => gff::record::Phase::One,
                        2 => gff::record::Phase::Two,
                        _ => gff::record::Phase::Zero,
                    });
                }
                let rec = builder.build();
                let _ = writer.write_record(&rec);
            }
        }
    }

    String::from_utf8_lossy(&buf).into_owned()
}

/// Parse BED3–BED12 intervals. BED is 0-based half-open, so `chromStart` is converted to a
/// 1-based start; name, strand and BED12 blocks (exons) are kept.
pub fn parse_bed_noodles(text: &str) -> Vec<SequenceFeature> {
    let mut out = Vec::new();
    for line in text.lines() {
        let t = line.trim_end();
        if t.is_empty() || t.starts_with('#') || t.starts_with("track") || t.starts_with("browser") {
            continue;
        }
        let cols: Vec<&str> = t.split(|c| c == '\t' || c == ' ').filter(|c| !c.is_empty()).collect();
        if cols.len() < 3 {
            continue;
        }
        let (Ok(start0), Ok(end)) = (cols[1].parse::<usize>(), cols[2].parse::<usize>()) else {
            continue;
        };
        if end <= start0 {
            continue;
        }
        let chrom = cols[0].to_string();
        let start = start0 + 1;
        let name = cols
            .get(3)
            .filter(|n| **n != ".")
            .map(|n| n.to_string())
            .unwrap_or_else(|| format!("{}:{}..{}", chrom, start, end));
        let strand = cols.get(5).map(|s| strand_of(s)).unwrap_or(0);
        let idx = out.len() + 1;
        let color = "#3b82f6".to_string();
        let mut segments = None;
        if cols.len() >= 12 {
            let sizes: Vec<usize> = cols[10].split(',').filter_map(|v| v.trim().parse().ok()).collect();
            let starts: Vec<usize> = cols[11].split(',').filter_map(|v| v.trim().parse().ok()).collect();
            if sizes.len() == starts.len() && sizes.len() > 1 {
                segments = Some(
                    sizes
                        .iter()
                        .zip(&starts)
                        .enumerate()
                        .map(|(i, (sz, st))| FeatureSegment {
                            index: i + 1,
                            name: format!("{name} block {}", i + 1),
                            start: start0 + st + 1,
                            end: start0 + st + sz,
                            color: color.clone(),
                        })
                        .collect(),
                );
            }
        }
        out.push(SequenceFeature {
            id: format!("bed-{}", idx),
            name,
            feature_type: "misc_feature".into(),
            start,
            end,
            strand,
            color,
            notes: Some(format!("BED interval on {}", chrom)),
            qualifiers: Some(HashMap::from([("seqid".to_string(), chrom)])),
            segments,
            cleavage_site: None,
        });
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ParsedVcfVariant {
    pub chrom: String,
    pub position: usize,
    pub ref_bases: String,
    pub alt_bases: Vec<String>,
    pub quality: Option<f32>,
}

/// Parse VCF v4.x headers and variant records via `noodles_vcf::io::Reader`.
pub fn parse_vcf_noodles(text: &str) -> Vec<ParsedVcfVariant> {
    let cursor = Cursor::new(text.as_bytes());
    let mut reader = vcf::io::Reader::new(BufReader::new(cursor));
    let Ok(header) = reader.read_header() else {
        return Vec::new();
    };
    let mut out = Vec::new();
    for res in reader.record_bufs(&header) {
        let Ok(rec) = res else {
            continue;
        };
        let pos = rec.variant_start().map(usize::from).unwrap_or(1);
        let alts: Vec<String> = rec
            .alternate_bases()
            .as_ref()
            .iter()
            .map(|s| s.clone())
            .collect();
        out.push(ParsedVcfVariant {
            chrom: rec.reference_sequence_name().to_string(),
            position: pos,
            ref_bases: rec.reference_bases().to_string(),
            alt_bases: alts,
            quality: rec.quality_score(),
        });
    }
    out
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SamAlignmentSummary {
    pub total_records: usize,
    pub mapped_records: usize,
    pub unmapped_records: usize,
    pub mean_mapq: f64,
}

/// Parse SAM alignment headers and records via `noodles_sam::io::Reader`.
pub fn parse_sam_noodles(text: &str) -> SamAlignmentSummary {
    let cursor = Cursor::new(text.as_bytes());
    let mut reader = sam::io::Reader::new(BufReader::new(cursor));
    let Ok(header) = reader.read_header() else {
        return SamAlignmentSummary {
            total_records: 0,
            mapped_records: 0,
            unmapped_records: 0,
            mean_mapq: 0.0,
        };
    };

    let mut total = 0usize;
    let mut mapped = 0usize;
    let mut unmapped = 0usize;
    let mut mapq_sum = 0u64;

    for res in reader.record_bufs(&header) {
        let Ok(rec) = res else {
            continue;
        };
        total += 1;
        if rec.flags().is_unmapped() {
            unmapped += 1;
        } else {
            mapped += 1;
            if let Some(mq) = rec.mapping_quality() {
                mapq_sum += u8::from(mq) as u64;
            }
        }
    }

    SamAlignmentSummary {
        total_records: total,
        mapped_records: mapped,
        unmapped_records: unmapped,
        mean_mapq: if mapped > 0 {
            ((mapq_sum as f64 / mapped as f64) * 10.0).round() / 10.0
        } else {
            0.0
        },
    }
}
