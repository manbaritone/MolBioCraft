// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Import and export of every file type, on public files: Biopython's own format test files
 * (alignments, multi-record GenBank / EMBL, FASTQ encodings) against Biopython's parses
 * (`scripts/outside-data/ref_formats_bp.py`), SAM / VCF / FASTQ from the phiX174 simulation, and
 * export → import round trips (alignments in every export format, GenBank / EMBL / FASTA / GFF3,
 * Newick, .mbc sessions and .zip folders). Skipped without test-data.
 */

import { describe, expect, it } from 'vitest';
import { bamToSam, exportToEMBL, exportToFasta, exportToGenBank, exportToGFF3, parseDnaBinaryPacket, parseEMBL, parseFasta, parseFastq, parseGenBank, parseGFF3, parseNexusAlignment } from '../core/fileParsers';
import { parseAlignedFasta, parseTextAlignment, splitFlatfileRecords } from '../core/alignmentFormats';
import { formatAlignmentText, type AlignmentTextFormat } from '../core/alignmentExport';
import { exportReadsToFastq, fastqToReadDocuments, samToContigs, vcfToFeatures } from '../core/importFormats';
import { parseNewick, toNewick, leafNames } from '../core/treeConsensus';
import { parseMbcFolderZip, parseMbcWorkbench, serializeMbcFolderZip, serializeMbcWorkbench, type MbcWorkbenchSnapshot } from '../core/mbcSessionFormat';
import type { SequenceDocument } from '../types/bio';
import { dataPath, haveTestData } from './testData';

interface NodeFs {
  existsSync: (p: string) => boolean;
  readFileSync: (p: string, e?: string) => string & Uint8Array & { buffer: ArrayBuffer; byteOffset: number; byteLength: number };
  readdirSync: (p: string) => string[];
}
let fs: NodeFs | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
const REF = dataPath('reference/formats_bp.json');
const B = dataPath('biopython-tests');
const have = haveTestData(REF, 'reference/phylo_r.json', 'biopython-tests', 'ncbi', 'synthego-ice');
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R: any = have ? JSON.parse(String(fs!.readFileSync(REF, 'utf8'))) : null;
const text = (p: string) => String(fs!.readFileSync(p, 'utf8'));
const bytes = (p: string) => { const b = fs!.readFileSync(p); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer; };
const plain = (s: string) => s.toUpperCase().replace(/[.~]/g, '-');

describe.skipIf(!have)('import of public format test files (vs Biopython)', () => {
  it('Clustal, PHYLIP and Stockholm alignments', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.alignments) as [string, { format: string; names: string[]; seqs: string[] }][]) {
      if (ref.format === 'fasta') continue;
      try {
        const a = parseTextAlignment(text(`${B}/${file}`), file);
        if (JSON.stringify(a.names) !== JSON.stringify(ref.names)) bad.push(`${file}: names ${a.names.slice(0, 3)}… vs ${ref.names.slice(0, 3)}…`);
        if (JSON.stringify(a.sequences.map(plain)) !== JSON.stringify(ref.seqs.map(plain))) bad.push(`${file}: sequences differ`);
      } catch (e) { bad.push(`${file}: ${(e as Error).message}`); }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  const KNOWN_FEATURE_DELTA: Record<string, number> = {
    'EMBL/AAA03323.embl#1': -1, // CDS U01210.1:1212..2756 (remote only)
    'GenBank/addgene-plasmid-11664-sequence-180430.gbk#1': +1, // enhancer 8569..276 (wraps the origin)
  };
  it('multi-record GenBank and EMBL files keep every record', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.records) as [string, { format: string; records: { length: number; seq: string; features: unknown[] }[] }][]) {
      const recs = splitFlatfileRecords(text(`${B}/${file}`));
      if (recs.length !== ref.records.length) { bad.push(`${file}: ${recs.length} records vs ${ref.records.length}`); continue; }
      recs.forEach((r, i) => {
        const doc = ref.format === 'embl' ? parseEMBL(r, file) : parseGenBank(r, file);
        const want = ref.records[i];
        if (want.seq && doc.sequence.toUpperCase() !== want.seq) bad.push(`${file} #${i + 1}: sequence ${doc.sequence.length} vs ${want.length} bp`);
        // (Biopython drops the features of records without a sequence)
        // Known, deliberate differences from Biopython: a feature whose location is wholly on
        // another record ("U01210.1:1212..2756") is dropped rather than placed at those
        // coordinates on this one, and a range across the origin of a circular record
        // ("8569..276", as some sequence editors write it) is kept, where Biopython drops it.
        const expected = want.features.length + (KNOWN_FEATURE_DELTA[`${file}#${i + 1}`] ?? 0);
        if (want.seq && doc.features.length !== expected) bad.push(`${file} #${i + 1}: ${doc.features.length} features vs ${expected}`);
      });
    }
    expect(bad, bad.slice(0, 40).join('\n')).toEqual([]);
  });

  it('FASTQ in every quality encoding (Sanger, Illumina 1.3+, Solexa)', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.fastq) as [string, { format: string; records: { id: string; seq: string; qual: number[] }[] }][]) {
      const fq = parseFastq(text(`${B}/${file}`), 100000);
      const nonEmpty = ref.records.filter((r) => r.seq.length);
      if (fq.readCount !== nonEmpty.length) { bad.push(`${file}: ${fq.readCount} reads vs ${nonEmpty.length}`); continue; }
      const toPhred = (q: number) => (ref.format === 'fastq-solexa' ? Math.round(10 * Math.log10(10 ** (q / 10) + 1)) : q);
      fq.reads.forEach((r, i) => {
        if (r.sequence !== nonEmpty[i].seq.toUpperCase()) bad.push(`${file} #${i + 1}: sequence differs`);
        if (JSON.stringify(r.phredScores) !== JSON.stringify(nonEmpty[i].qual.map(toPhred))) bad.push(`${file} #${i + 1}: qualities differ (${r.phredScores.slice(0, 5)} vs ${nonEmpty[i].qual.slice(0, 5).map(toPhred)})`);
      });
    }
    expect(bad, bad.slice(0, 20).join('\n')).toEqual([]);
  });
});

describe.skipIf(!have)('NGS files: FASTQ, SAM, VCF', () => {
  it('FASTQ import keeps every read and its qualities', () => {
    const fq = fastqToReadDocuments(text(dataPath('sim/phix_r1.fq')), 'phix_r1.fq');
    expect(fq.reads.length).toBe(fq.total);
    expect(fq.total).toBe(1500);
    expect(fq.reads[0].chromatogram?.phredScores.length).toBe(fq.reads[0].sequence.length);
  });

  it('SAM import builds the contig from the records and calls the same variants', () => {
    const ref = parseFasta(text(dataPath('sim/phix_ref.fa')), 'phiX174')[0];
    const sam = samToContigs(text(dataPath('sim/phix.sam')), 'phix.sam', [{ ...ref, name: 'phiX174' }], { minIdentityPct: 0, minAlignedLength: 1, minVariantFrequencyPct: 25, minVariantCoverage: 4 });
    expect(sam.missingReferences).toEqual([]);
    const c = sam.contigs[0].contig;
    expect(c.mapped.length).toBe(1500);
    expect(c.breadthPct).toBeGreaterThan(99);
    // the homozygous wgsim variants (3 insertions, 1 SNP)
    for (const [pos, type] of [[3059, 'SNP'], [153, 'Insertion'], [165, 'Insertion'], [1627, 'Insertion']] as const) {
      expect(c.variants.some((v) => Math.abs(v.refPosition - pos) <= 1 && v.type === type), `${type} at ${pos}`).toBe(true);
    }
    // Biopython's multi-reference SAM with its FASTA: one contig per reference
    const ex = parseFasta(text(`${B}/SamBam/ex1.fa`), 'ex1');
    const s2 = samToContigs(text(`${B}/SamBam/ex1.sam`), 'ex1.sam', ex, { minIdentityPct: 0, minAlignedLength: 1, minVariantFrequencyPct: 25, minVariantCoverage: 4 });
    expect(s2.contigs.map((x) => x.reference.name).sort()).toEqual(['chr1', 'chr2']);
    const placed = text(`${B}/SamBam/ex1.sam`).split('\n').filter((l) => l && !l.startsWith('@') && !(Number(l.split('\t')[1]) & 0x904)).length;
    expect(s2.contigs.reduce((n, x) => n + x.contig.mapped.length, 0)).toBe(placed);
  });

  it('BAM decodes to the same records as samtools view, and imports like the SAM', () => {
    const bad: string[] = [];
    for (const [file, ref] of Object.entries(R.bam ?? {}) as [string, { refs: string[]; records: string[] }][]) {
      const sam = bamToSam(bytes(dataPath(file)));
      const lines = sam.split('\n').filter(Boolean);
      const sq = lines.filter((l) => l.startsWith('@SQ')).map((l) => /SN:([^\t]+)/.exec(l)![1]);
      const recs = lines.filter((l) => !l.startsWith('@')).map((l) => l.split('\t').slice(0, 11).join('\t'));
      if (JSON.stringify(sq) !== JSON.stringify(ref.refs)) bad.push(`${file}: references ${sq} vs ${ref.refs}`);
      if (recs.length !== ref.records.length) bad.push(`${file}: ${recs.length} records vs ${ref.records.length}`);
      else { const k = recs.findIndex((r, i) => r !== ref.records[i]); if (k >= 0) bad.push(`${file} record ${k + 1}: ${recs[k].slice(0, 80)} vs ${ref.records[k].slice(0, 80)}`); }
    }
    expect(Object.keys(R.bam ?? {}).length).toBeGreaterThan(0);
    expect(bad, bad.join('\n')).toEqual([]);
    // BAM and SAM of the same alignments give the same contig
    const phix = parseFasta(text(dataPath('sim/phix_ref.fa')), 'phiX174')[0];
    const ref = { ...parseGenBank(`LOCUS       phiX174 ${phix.sequence.length} bp DNA linear\nORIGIN\n${phix.sequence}\n//\n`, 'phiX174'), name: 'phiX174' };
    const opts = { minIdentityPct: 0, minAlignedLength: 1, minVariantFrequencyPct: 20, minVariantCoverage: 2 };
    const a = samToContigs(text(dataPath('sim/phix.sam')), 'phix.sam', [ref], opts);
    const b = samToContigs(bamToSam(bytes(dataPath('sim/phix.bam'))), 'phix.bam', [ref], opts);
    expect(b.records).toBe(a.records);
    expect(b.contigs[0].contig.mapped.map((m) => m.refStart)).toEqual(a.contigs[0].contig.mapped.map((m) => m.refStart));
  });

  it('VCF variants attach to the sequence as features', () => {
    const vcf = text(dataPath('sim/phix.vcf'));
    const records = vcf.split('\n').filter((l) => l && !l.startsWith('#'));
    const { features } = vcfToFeatures(vcf, ['phiX174']);
    expect(features.map((f) => f.start)).toEqual(records.map((l) => Number(l.split('\t')[1])));
  });
});

describe.skipIf(!have)('export → import round trips', () => {
  it('alignments in every export format read back with the same names and residues', () => {
    const bad: string[] = [];
    const sources = (Object.entries(R.alignments) as [string, { names: string[]; seqs: string[] }][]).slice(0, 12);
    for (const [file, ref] of sources) {
      const rows = ref.names.map((name, i) => ({ name, sequence: ref.seqs[i] }));
      const molecule = /^[ACGTUN\-.?]+$/i.test(ref.seqs.join('')) ? 'DNA' : 'Protein';
      for (const fmt of ['FASTA', 'Clustal', 'PHYLIP', 'NEXUS'] as AlignmentTextFormat[]) {
        const out = formatAlignmentText(rows, fmt, molecule);
        let names: string[], seqs: string[];
        // gap-free FASTA stays separate sequences; with gaps it reads back as an alignment
        if (fmt === 'FASTA') { const d = parseAlignedFasta(out); const f = parseFasta(out, 'x'); names = d?.names ?? f.map((x) => x.name); seqs = d?.sequences ?? f.map((x) => x.sequence); }
        else if (fmt === 'NEXUS') { const n = parseNexusAlignment(out); names = n.names; seqs = n.sequences; }
        else { const a = parseTextAlignment(out, fmt === 'Clustal' ? 'x.aln' : 'x.phy'); names = a.names; seqs = a.sequences; }
        const wantNames = fmt === 'PHYLIP' ? names /* 10-character identifiers by definition */ : ref.names.map((n) => (fmt === 'Clustal' ? n.replace(/\s+/g, '_') : fmt === 'FASTA' && !parseAlignedFasta(out) ? n.split(/\s/)[0] /* FASTA id = first word */ : n));
        if (JSON.stringify(names) !== JSON.stringify(wantNames)) bad.push(`${file} ${fmt}: names ${names.slice(0, 2)} vs ${wantNames.slice(0, 2)}`);
        if (JSON.stringify(seqs.map(plain)) !== JSON.stringify(ref.seqs.map(plain))) bad.push(`${file} ${fmt}: residues differ`);
      }
    }
    expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
  });

  it('sequence documents through GenBank, EMBL, FASTA and GFF3', () => {
    const bad: string[] = [];
    const docs: SequenceDocument[] = [];
    for (const f of ['L09137', 'J01749', 'NC_001422']) docs.push(parseGenBank(text(dataPath(`ncbi/${f}.gb`)), f));
    for (const d of docs) {
      const g = parseGenBank(exportToGenBank(d), d.name);
      const e = parseEMBL(exportToEMBL(d), d.name);
      const fa = parseFasta(exportToFasta(d), d.name)[0];
      const gff = parseGFF3(exportToGFF3(d));
      for (const [label, x] of [['GenBank', g], ['EMBL', e]] as const) {
        if (x.sequence.toUpperCase() !== d.sequence.toUpperCase()) bad.push(`${d.name} ${label}: sequence`);
        if (x.topology !== d.topology) bad.push(`${d.name} ${label}: topology ${x.topology} vs ${d.topology}`);
        // (a directionless feature reads back as + strand: plain INSDC locations carry no 'none')
        // GenBank / EMBL require a source feature; the exporters add one when the document has none
        const hasSource = d.features.some((f) => f.type === 'source');
        const key = (z: SequenceDocument) => z.features.filter((f) => hasSource || f.type !== 'source').map((f) => `${f.type}:${f.start}-${f.end}:${f.strand === -1 ? -1 : 1}:${(f.segments?.length ?? 0) > 1 ? f.segments!.length : 0}`).sort().join('|');
        if (key(x) !== key(d)) bad.push(`${d.name} ${label}: features differ`);
        // a second export is identical to the first (export is stable)
        if (label === 'GenBank' && exportToGenBank(x).replace(/^LOCUS.*$/m, '') !== exportToGenBank(d).replace(/^LOCUS.*$/m, '')) bad.push(`${d.name}: GenBank export not stable`);
      }
      if (fa.sequence.toUpperCase() !== d.sequence.toUpperCase()) bad.push(`${d.name} FASTA: sequence`);
      if (gff.length !== d.features.filter((f) => f.type !== 'source').length && gff.length !== d.features.length) bad.push(`${d.name} GFF3: ${gff.length} features vs ${d.features.length}`);
    }
    expect(bad, bad.slice(0, 30).join('\n')).toEqual([]);
  });

  it('reads export as FASTQ with their qualities and read back the same', () => {
    for (const file of Object.keys(R.fastq)) {
      if (/solexa|illumina/.test(file)) continue; // re-encoded as Sanger on import
      const ref = R.fastq[file] as { records: { id: string; seq: string; qual: number[] }[] };
      if (!ref.records.length) continue;
      const { reads } = fastqToReadDocuments(text(`${B}/${file}`), file);
      const fq = exportReadsToFastq(reads);
      expect(fq.written, file).toBe(ref.records.filter((r) => r.seq.length).length);
      const back = fastqToReadDocuments(fq.text, 'x.fastq').reads;
      expect(back.map((d) => d.sequence), file).toEqual(reads.map((d) => d.sequence));
      expect(back.map((d) => d.chromatogram?.phredScores), file).toEqual(reads.map((d) => d.chromatogram?.phredScores));
    }
    // documents without per-base qualities are skipped, not given invented ones
    const plainDoc = parseGenBank(text(dataPath('ncbi/J01749.gb')), 'J01749');
    expect(exportReadsToFastq([plainDoc])).toMatchObject({ written: 0, skipped: [plainDoc.name] });
  });

  it('Newick trees, .mbc sessions and .zip folders', () => {
    // The trees R computed into phylo_r.json (scripts/outside-data/ref_phylo.R), and
    // synthetic strings with quoted labels, support values, comments and zero-length branches.
    const phylo = JSON.parse(text(dataPath('reference/phylo_r.json'))) as Record<string, unknown>;
    const trees = Object.entries(phylo).filter((e): e is [string, string] => typeof e[1] === 'string' && e[1].trim().startsWith('('));
    expect(trees.map(([k]) => k).sort()).toEqual(['bionj_k80', 'mp_best_tree', 'nj_k80', 'nj_tn93_midpoint', 'upgma_jc']);
    const synthetic: [string, string][] = [
      ['quoted labels', "(('Homo sapiens':0.1,'E. coli K-12':0.2):0.05,'x, y: z':0.3,plain_name:0.4);"],
      ['support values', '((A:0.1,B:0.2)95:0.3,(C:0.1,D:0.1)0.87:0.2,E:0.5)100;'],
      ['comments', '[&R] ((A[first]:0.1,B:0.2)[a node]:0.3,C:0.4)[the root];'],
      ['zero-length branches', '((A:0,B:0.0):0,(C:0.25,D:0):0.000000);'],
    ];
    for (const [f, nwk] of [...trees, ...synthetic]) {
      const t = parseNewick(nwk);
      expect(leafNames(t).length, f).toBeGreaterThanOrEqual(3);
      const again = parseNewick(toNewick(t));
      expect(leafNames(again), f).toEqual(leafNames(t));
      expect(toNewick(again), f).toBe(toNewick(t));
    }
    const read = (nwk: string) => parseNewick(toNewick(parseNewick(nwk)));
    // Quoted labels keep their spaces and punctuation, without the quotes.
    expect(leafNames(read(synthetic[0][1]))).toEqual(['Homo sapiens', 'E. coli K-12', 'x, y: z', 'plain_name']);
    // Support values stay on their nodes; comments are not names.
    const supported = read(synthetic[1][1]);
    expect([supported.label, supported.children[0].label, supported.children[1].label]).toEqual(['100', '95', '0.87']);
    expect(leafNames(read(synthetic[2][1]))).toEqual(['A', 'B', 'C']);
    expect(toNewick(read(synthetic[2][1]))).toBe('((A:0.1,B:0.2):0.3,C:0.4);');
    // A zero-length branch is a length of 0, not a missing one.
    const zero = read(synthetic[3][1]);
    expect([zero.children[0].length, zero.children[0].children[0].length, zero.children[0].children[1].length, zero.children[1].length]).toEqual([0, 0, 0, 0]);
    const docs: SequenceDocument[] = [
      parseGenBank(text(dataPath('ncbi/L09137.gb')), 'pUC19'),
      parseDnaBinaryPacket(bytes(dataPath('synthego-ice/good_example_control.ab1')), 'good_example_control.ab1'),
      ...fastqToReadDocuments(text(dataPath('sim/phix_r1.fq')), 'phix_r1.fq', 3).reads,
    ];
    const snapshot: MbcWorkbenchSnapshot = {
      sessionName: 'Round trip', documents: docs,
      workspace: {
        activeDocId: docs[0].id, selectedFolder: 'All Project Files', navHistory: [docs[0].id], navIndex: 0,
        viewerTab: 'sequence-view', mapLayoutMode: 'linear', zoomLevel: 100, textFormat: 'genbank',
        colorScheme: 'standard', darkMode: false, sidebarOpen: true, docTableCollapsed: false, selectedRange: null,
        displaySettings: { showOrfs: true, minOrfAa: 50, allowAltStartCodons: false, showPrimers: true, showTranslation: true, showGcGraph: false, showHydropathyGraph: false, showUniqueCuttersOnly: false },
      },
    };
    for (const parsed of [parseMbcWorkbench(serializeMbcWorkbench(snapshot)), parseMbcFolderZip(serializeMbcFolderZip(snapshot))]) {
      expect(parsed.checksumVerified).toBe(true);
      const back = parsed.envelope.documents;
      expect(back.map((d) => d.sequence)).toEqual(docs.map((d) => d.sequence));
      expect(back.map((d) => d.features.length)).toEqual(docs.map((d) => d.features.length));
      expect(back[1].chromatogram?.traceA.length).toBe(docs[1].chromatogram?.traceA.length);
      expect(back[2].chromatogram?.phredScores).toEqual(docs[2].chromatogram?.phredScores);
    }
  });
});
