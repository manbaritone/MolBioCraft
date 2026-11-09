// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Turning NGS files into documents:
 *  - FASTQ → one read document per record, keeping every read (up to `maxReads`) and its Phred
 *    qualities (stored as a trace-less chromatogram: base calls + qualities, which mapping and
 *    variant calling read);
 *  - SAM → a reference contig built from the records' own POS / CIGAR (no re-alignment) when the
 *    reference named in @SQ / RNAME is open, else the reads;
 *  - VCF → variation features on the sequence named in CHROM (or the given target).
 */

import { parseFastq, parseVCF } from './fileParsers';
import { assembleReferenceContig, type MappedRead, type MapToReferenceOptions, type ReferenceContig } from './referenceMapping';
import type { SequenceDocument, SequenceFeature, VariantCall } from '../types/bio';

const nowIso = () => new Date().toISOString();
const stamp = () => Date.now().toString(36);

function readDocument(name: string, sequence: string, quals: number[] | null, source: string, idx: number, folder = 'Sequencing Reads (Sanger/NGS)'): SequenceDocument {
  const t = nowIso();
  const meanQ = quals?.length ? quals.reduce((a, b) => a + b, 0) / quals.length : null;
  return {
    id: `read-${idx}-${stamp()}`,
    name: name || `Read ${idx + 1}`,
    accession: '',
    description: `Read from ${source}${meanQ !== null ? ` (mean Phred Q${meanQ.toFixed(1)})` : ''}`,
    moleculeType: 'DNA',
    topology: 'linear',
    sequence,
    features: [],
    primers: [],
    ...(quals?.length ? { chromatogram: { traceA: [], traceC: [], traceG: [], traceT: [], peakLocations: [], phredScores: quals, baseCalls: sequence } } : {}),
    history: [{ id: `hist-read-${idx}-${stamp()}`, timestamp: t.slice(0, 16).replace('T', ' '), operation: 'Imported read', description: `${sequence.length} bp from ${source}`, parentIds: [], lengthBp: sequence.length, topology: 'linear' }],
    createdAt: t,
    updatedAt: t,
    folder,
    docMetadata: { 'Read Technology': /\.sam$/i.test(source) ? 'SAM alignment record' : 'FASTQ reads', ...(meanQ !== null ? { 'Mean Phred': Number(meanQ.toFixed(1)) } : {}) },
  } as SequenceDocument;
}

export interface FastqImport {
  reads: SequenceDocument[];
  total: number;
  meanPhred: number;
  q30Pct: number;
}

/** Every FASTQ record (up to `maxReads`) as a read document with its qualities. */
export function fastqToReadDocuments(text: string, fileName: string, maxReads = 20000): FastqImport {
  const fq = parseFastq(text, maxReads);
  const reads = fq.reads.map((r, i) => readDocument(r.name, r.sequence, r.phredScores, fileName, i));
  return { reads, total: fq.readCount, meanPhred: fq.meanPhredScore, q30Pct: fq.q30BasePct };
}

// ───────────────────────────── SAM ─────────────────────────────

export interface SamRecord { qname: string; flag: number; rname: string; pos: number; mapq: number; cigar: string; seq: string; qual: string }

export function parseSamRecords(text: string): { refs: { name: string; length: number }[]; records: SamRecord[] } {
  const refs: { name: string; length: number }[] = [];
  const records: SamRecord[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line) continue;
    if (line.startsWith('@')) {
      if (line.startsWith('@SQ')) {
        const sn = /\tSN:([^\t]+)/.exec(line)?.[1];
        const ln = Number(/\tLN:(\d+)/.exec(line)?.[1] ?? 0);
        if (sn) refs.push({ name: sn, length: ln });
      }
      continue;
    }
    const f = line.split('\t');
    if (f.length < 11) continue;
    records.push({ qname: f[0], flag: Number(f[1]), rname: f[2], pos: Number(f[3]), mapq: Number(f[4]), cigar: f[5], seq: f[9], qual: f[10] });
  }
  return { refs, records };
}

/** A SAM record as a read placed on the reference (pairs and per-base variants from its CIGAR). */
function samToMapped(rec: SamRecord, ref: string, doc: SequenceDocument): MappedRead | null {
  if (rec.flag & 4 || rec.cigar === '*' || rec.seq === '*' || rec.pos < 1) return null;
  const ops = [...rec.cigar.matchAll(/(\d+)([MIDNSHP=X])/g)].map((m) => [Number(m[1]), m[2]] as const);
  const quals = rec.qual !== '*' ? [...rec.qual].map((c) => c.charCodeAt(0) - 33) : null;
  const pairs: [string, string][] = [];
  const variants: VariantCall[] = [];
  let r = rec.pos; // 1-based reference position of the next reference base
  let q = 0; // read index
  let same = 0, aligned = 0;
  for (const [n, op] of ops) {
    if (op === 'S') { q += n; continue; }
    if (op === 'H' || op === 'P') continue;
    for (let k = 0; k < n; k++) {
      if (op === 'M' || op === '=' || op === 'X') {
        const rb = ref[r - 1] ?? 'N';
        const qb = rec.seq[q]?.toUpperCase() ?? 'N';
        pairs.push([rb, qb]);
        aligned++;
        if (rb === qb) same++;
        else variants.push({ position: r, refBase: rb, altBase: qb, type: 'SNP', phredQuality: quals?.[q] ?? 0, readName: rec.qname });
        r++; q++;
      } else if (op === 'I') {
        const qb = rec.seq[q]?.toUpperCase() ?? 'N';
        pairs.push(['-', qb]);
        variants.push({ position: r, refBase: '-', altBase: qb, type: 'Insertion', phredQuality: quals?.[q] ?? 0, readName: rec.qname });
        q++;
      } else if (op === 'D' || op === 'N') {
        const rb = ref[r - 1] ?? 'N';
        pairs.push([rb, '-']);
        if (op === 'D') variants.push({ position: r, refBase: rb, altBase: '-', type: 'Deletion', phredQuality: Math.min(quals?.[Math.max(0, q - 1)] ?? 0, quals?.[q] ?? 0), readName: rec.qname });
        r++;
      }
    }
  }
  if (!pairs.length) return null;
  return {
    doc, refStart: rec.pos, refEnd: r - 1, strand: rec.flag & 16 ? -1 : 1,
    identityPct: aligned ? Math.round((1000 * same) / aligned) / 10 : 0, alignedLength: pairs.filter((p) => p[1] !== '-').length,
    pairs, variants,
  };
}

export interface SamImport {
  contigs: { reference: SequenceDocument; contig: ReferenceContig }[];
  reads: SequenceDocument[];
  missingReferences: string[];
  records: number;
}

/**
 * SAM records grouped by reference; references are matched to `openDocs` by name, accession or
 * (when there is a single @SQ) by length.
 */
export function samToContigs(text: string, fileName: string, openDocs: SequenceDocument[], opts: MapToReferenceOptions): SamImport {
  const { refs, records } = parseSamRecords(text);
  const primary = records.filter((r) => !(r.flag & 0x900)); // no secondary / supplementary
  const reads = primary.filter((r) => r.seq !== '*').map((r, i) => {
    const seq = r.flag & 16 ? revcomp(r.seq.toUpperCase()) : r.seq.toUpperCase();
    const quals = r.qual !== '*' ? [...r.qual].map((c) => c.charCodeAt(0) - 33) : null;
    return readDocument(r.qname, seq, quals && r.flag & 16 ? quals.reverse() : quals, fileName, i);
  });
  const byName = new Map(reads.map((d, i) => [i, d]));
  const names = refs.length ? refs.map((x) => x.name) : [...new Set(primary.map((r) => r.rname).filter((x) => x !== '*'))];
  const contigs: SamImport['contigs'] = [];
  const missing: string[] = [];
  for (const name of names) {
    const len = refs.find((x) => x.name === name)?.length;
    const refDoc = openDocs.find((d) => d.sequence && (d.name === name || d.accession === name || d.name.split(/\s/)[0] === name))
      ?? (names.length === 1 && len ? openDocs.find((d) => d.sequence.length === len && d.moleculeType !== 'Protein') : undefined);
    if (!refDoc) { missing.push(name); continue; }
    const ref = refDoc.sequence.toUpperCase();
    const mapped: MappedRead[] = [];
    primary.forEach((rec, i) => {
      if (rec.rname !== name) return;
      const doc = byName.get(i);
      if (!doc) return;
      // reads are stored in their original orientation; the alignment is in reference orientation
      const m = samToMapped({ ...rec, seq: rec.seq.toUpperCase() }, ref, doc);
      if (m) mapped.push(m);
    });
    if (mapped.length) contigs.push({ reference: refDoc, contig: assembleReferenceContig(refDoc, mapped, [], opts) });
  }
  return { contigs, reads, missingReferences: missing, records: primary.length };
}

const COMP: Record<string, string> = { A: 'T', C: 'G', G: 'C', T: 'A', N: 'N' };
const revcomp = (s: string) => [...s].reverse().map((c) => COMP[c] ?? 'N').join('');

// ───────────────────────────── VCF ─────────────────────────────

/** VCF records on the target sequence as variation features (1-based, REF span). */
export function vcfToFeatures(text: string, targetNames: string[]): { features: SequenceFeature[]; other: number } {
  const all = parseVCF(text);
  const want = new Set(targetNames.filter(Boolean));
  const chroms = [...new Set(all.map((v) => v.chrom))];
  // a single-chromosome VCF annotates the target whatever it calls it
  const mine = chroms.length === 1 ? all : all.filter((v) => want.has(v.chrom));
  const features = mine.map((v, i): SequenceFeature => ({
    id: `vcf-${i}-${stamp()}`,
    name: `${v.refBases}>${v.altBases.join(',')}`,
    type: 'variation' as SequenceFeature['type'],
    start: v.position,
    end: v.position + Math.max(1, v.refBases.length) - 1,
    strand: 1,
    color: '#dc2626',
    notes: `VCF ${v.chrom}:${v.position} ${v.refBases}>${v.altBases.join(',')}${v.quality !== null ? ` QUAL ${v.quality}` : ''}`,
    qualifiers: { replace: v.altBases.join(','), ...(v.quality !== null ? { note: `QUAL=${v.quality}` } : {}) },
  }));
  return { features, other: all.length - mine.length };
}

// ───────────────────────────── FASTQ export ─────────────────────────────

/**
 * Read documents as FASTQ (Sanger / Phred+33): reads keep the Phred qualities they were imported
 * with (FASTQ, SAM, BAM or an .ab1 trace). Documents without per-base qualities are skipped and
 * named, since inventing a quality would misstate the data.
 */
export function exportReadsToFastq(docs: SequenceDocument[]): { text: string; written: number; skipped: string[] } {
  const out: string[] = [];
  const skipped: string[] = [];
  for (const d of docs) {
    const q = d.chromatogram?.phredScores ?? [];
    const seq = d.chromatogram?.baseCalls && d.chromatogram.baseCalls.length === q.length ? d.chromatogram.baseCalls : d.sequence;
    if (!seq.length || q.length !== seq.length) { skipped.push(d.name); continue; }
    const name = d.name.replace(/\s+/g, '_') || 'read';
    out.push(`@${name}`, seq.toUpperCase(), '+', q.map((v) => String.fromCharCode(33 + Math.max(0, Math.min(93, Math.round(v))))).join(''));
  }
  return { text: out.length ? out.join('\n') + '\n' : '', written: out.length / 4, skipped };
}
