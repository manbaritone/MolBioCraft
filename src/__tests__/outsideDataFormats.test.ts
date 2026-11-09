// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * File parsers on public files against Biopython / samtools / bcftools parses
 * (`scripts/outside-data/ref_formats.py`): NCBI GenBank, ENA EMBL, AB1 traces, RCSB PDB / mmCIF,
 * NCBI GFF3, FASTQ, SAM, VCF. Skipped without test-data.
 */

import { describe, expect, it } from 'vitest';
import { exportToEMBL, exportToGenBank, parseDnaBinaryPacket, parseEMBL, parseFastq, parseGenBank, parseGFF3, parseNexusAlignment, parseSAM, parseVCF } from '../core/fileParsers';
import { parsePdbCaCoordinates } from '../core/genomicsAndStructureSuite';
import type { SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

interface NodeFs { existsSync: (p: string) => boolean; readFileSync: (p: string, e?: string) => string & Uint8Array & { buffer: ArrayBuffer; byteOffset: number; byteLength: number } }
let fs: NodeFs | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
interface NodeCrypto { createHash: (a: string) => { update: (d: string | Uint8Array) => { digest: (e: 'hex') => string } } }
let crypto: NodeCrypto | null = null;
try { const spec: string = 'node:crypto'; crypto = (await import(/* @vite-ignore */ spec)) as NodeCrypto; } catch { crypto = null; }
const sha256 = (d: string | Uint8Array): string => crypto!.createHash('sha256').update(d).digest('hex');
const REF = dataPath('reference/formats.json');
const have = haveTestData(REF, 'ncbi', 'ena', 'rcsb', 'biopython-abi', 'synthego-ice');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R: any = have ? JSON.parse(fs!.readFileSync(REF, 'utf8')) : null;
type RefFeat = { type: string; start: number; end: number; strand: number; parts: number; qualifiers: string[] };

function compareFeatures(file: string, doc: SequenceDocument, ref: { length: number; seq: string; features: RefFeat[] }): string[] {
  const bad: string[] = [];
  if (doc.sequence.toUpperCase() !== ref.seq) bad.push(`${file}: sequence differs (app ${doc.sequence.length} vs ${ref.length} bp)`);
  // the app keeps the source feature too; compare all features in order
  const app = doc.features;
  if (app.length !== ref.features.length) bad.push(`${file}: ${app.length} features vs ${ref.features.length}`);
  const used = new Set<number>();
  for (const f of ref.features) {
    const k = app.findIndex((a, i) => !used.has(i) && a.type === f.type && a.start === f.start && a.end === f.end);
    if (k < 0) { bad.push(`${file}: missing ${f.type} ${f.start}..${f.end}`); continue; }
    used.add(k);
    const a = app[k];
    if (f.strand && a.strand !== f.strand) bad.push(`${file}: ${f.type} ${f.start}..${f.end} strand ${a.strand} vs ${f.strand}`);
    const parts = a.segments?.length && a.segments.length > 1 ? a.segments.length : 1;
    if (parts !== f.parts) bad.push(`${file}: ${f.type} ${f.start}..${f.end} ${parts} parts vs ${f.parts}`);
    const q = Object.keys(a.qualifiers ?? {});
    const missingQ = f.qualifiers.filter((x) => !q.includes(x) && x !== 'translation');
    if (missingQ.length) bad.push(`${file}: ${f.type} ${f.start}..${f.end} lacks qualifiers ${missingQ.join(',')}`);
  }
  return bad;
}

describe.skipIf(!have)('file formats against Biopython / samtools / bcftools', () => {
  it('GenBank records from NCBI', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.genbank) as [string, { length: number; seq: string; features: RefFeat[]; topology: string }][]) {
      const doc = parseGenBank(String(fs!.readFileSync(dataPath(`ncbi/${file}`), 'utf8')), file);
      bad.push(...compareFeatures(file, doc, ref));
      if (ref.topology && doc.topology !== ref.topology) bad.push(`${file}: topology ${doc.topology} vs ${ref.topology}`);
    }
    expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
  });

  it('EMBL records from ENA', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.embl) as [string, { length: number; seq: string; features: RefFeat[] }][]) {
      const doc = parseEMBL(String(fs!.readFileSync(dataPath(`ena/${file}`), 'utf8')), file);
      bad.push(...compareFeatures(file, doc, ref));
    }
    expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
  });

  it('AB1 traces: base calls, qualities and peak positions', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.ab1) as [string, { basecalls: string; quals: number[]; ploc: number[] }][]) {
      const b = fs!.readFileSync(dataPath(file));
      const doc = parseDnaBinaryPacket(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), file.split('/').pop()!);
      const c = doc.chromatogram;
      if (!c) { bad.push(`${file}: no trace`); continue; }
      // (the app upper-cases base calls; Biopython keeps the file's case)
      if (c.baseCalls.toUpperCase() !== ref.basecalls.toUpperCase()) bad.push(`${file}: base calls differ (${c.baseCalls.length} vs ${ref.basecalls.length})`);
      const refQ = ref.quals;
      if (JSON.stringify(c.phredScores ?? []) !== JSON.stringify(refQ)) bad.push(`${file}: qualities differ (${(c.phredScores ?? []).length} vs ${refQ.length})`);
      if (ref.ploc.length && JSON.stringify(c.peakLocations) !== JSON.stringify(ref.ploc)) bad.push(`${file}: peak locations differ`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('PDB and mmCIF: Cα atoms per chain (model 1)', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.pdb) as [string, { chains: Record<string, { residues: number }> }][]) {
      const atoms = parsePdbCaCoordinates(String(fs!.readFileSync(dataPath(`rcsb/${file}`), 'utf8')));
      const per: Record<string, number> = {};
      for (const a of atoms as { chainId?: string; chain?: string }[]) { const ch = a.chainId ?? a.chain ?? '?'; per[ch] = (per[ch] ?? 0) + 1; }
      for (const [ch, v] of Object.entries(ref.chains)) if (v.residues && per[ch] !== v.residues) bad.push(`${file} chain ${ch}: ${per[ch] ?? 0} Cα vs ${v.residues} residues`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('GFF3, FASTQ, SAM and VCF', () => {
    for (const file of Object.keys(R.gff3)) {
      const text = String(fs!.readFileSync(dataPath(`ncbi/${file}`), 'utf8'));
      // lines sharing an ID are one (multi-segment) feature in GFF3 (e.g. the ORF1ab frameshift CDS)
      const rows = text.split('\n').filter((l) => l.trim() && !l.startsWith('#'));
      const ids = new Set(rows.map((l, i) => /(?:^|;)ID=([^;]+)/.exec(l.split('\t')[8] ?? '')?.[1] ?? `line${i}`));
      const f = parseGFF3(text);
      expect(f.length, file).toBe(ids.size);
    }
    const fq = parseFastq(String(fs!.readFileSync(dataPath('sim/phix_r1.fq'), 'utf8')), 100000);
    expect(fq.readCount).toBe(R.fastq.count);
    expect(fq.meanPhredScore).toBeCloseTo(R.fastq.mean_quality, 1);
    const sam = parseSAM(String(fs!.readFileSync(dataPath('sim/phix.sam'), 'utf8')));
    expect([sam.totalRecords, sam.mappedRecords]).toEqual([R.sam.records, R.sam.mapped]);
    const vcf = parseVCF(String(fs!.readFileSync(dataPath('sim/phix.vcf'), 'utf8')));
    expect(vcf.map((v) => `${v.position}:${v.refBases}>${v.altBases.join(',')}`)).toEqual(R.vcf.rows.map((r: { pos: number; ref: string; alt: string }) => `${r.pos}:${r.ref}>${r.alt}`));
  });

  it('GenBank and EMBL export round-trips keep sequence, features and qualifiers', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.genbank) as [string, { length: number; seq: string; features: RefFeat[] }][]) {
      const doc = parseGenBank(String(fs!.readFileSync(dataPath(`ncbi/${file}`), 'utf8')), file);
      bad.push(...compareFeatures(`${file} → GenBank`, parseGenBank(exportToGenBank(doc), file), ref));
      bad.push(...compareFeatures(`${file} → EMBL`, parseEMBL(exportToEMBL(doc), file), ref));
    }
    expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
  });

  it.skipIf(!haveTestData('reference/phylo_r.json', 'mrbayes/primates.nex'))('NEXUS matrix (MrBayes primates) reads as ape::read.nexus.data', () => {
    // The alignment is GPL-3.0 and not committed (D0016): phylo_r.json records the SHA-256 of the
    // fetched file and of the alignment ape read from it ("name<TAB>sequence" lines, upper-cased).
    const ape = JSON.parse(String(fs!.readFileSync(dataPath('reference/phylo_r.json'), 'utf8')));
    const want = ape.inputs['mrbayes/primates.nex'];
    const bytes = fs!.readFileSync(dataPath('mrbayes/primates.nex'));
    expect(sha256(bytes), 'the fetched mrbayes/primates.nex is not the file the references were computed from').toBe(want.sha256);
    const nx = parseNexusAlignment(new TextDecoder().decode(bytes));
    const rows = (nx as unknown as { taxa?: string[]; names?: string[]; sequences?: string[]; rows?: { name: string; sequence: string }[] });
    const names = rows.rows?.map((r) => r.name) ?? rows.taxa ?? rows.names ?? [];
    const seqs = rows.rows?.map((r) => r.sequence) ?? rows.sequences ?? [];
    expect(names).toHaveLength(12);
    expect(sha256(names.map((n, i) => `${n}\t${seqs[i].toUpperCase()}`).join('\n')), 'our reading differs from ape::read.nexus.data').toBe(want.alignment_sha256);
  });
});
