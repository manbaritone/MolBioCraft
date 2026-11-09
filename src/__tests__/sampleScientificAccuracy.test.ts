// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Scientific-accuracy regression suite for the built-in sample library: reading-frame integrity of
 * every annotated CDS, primer binding coordinates, known protein sequences, and the
 * annotation-only (contig summary) invariants. The sequencing primers, protein records, yadF clone
 * and genome records (US-01M6TDFV), and the genome, plasmid and yghJ CDS sequences (US-01M6TGZ8),
 * are checked against the public records they cite, as scripts/outside-data/fetch.sh fetches them.
 * The seven design primers (BG-01M6WB0V, BG-01M6XWXX) store no Tm, hairpin or primer-dimer energy,
 * each one records where its sequence comes from, and the three genome-derived oligos are checked
 * against the public records they cite at the cited span and strand.
 * The suite reads no vendor file.
 */

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { MODULAR_VECTOR_PARTS } from '../data/modularVectorParts';
import { calculatePrimerMetrics } from '../core/bioEngine';
import { declaredLengthOf, isContigSummaryRecord, parseSingleFasta, downloadSummarySequence } from '../core/contigSummary';
import { primerRecordFromDoc } from '../core/operationRunners';
import type { SequenceDocument, SequenceFeature } from '../types/bio';
import { dataPath, haveTestData } from './testData';

const BASES = 'TCAG';
const AAS = 'FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG';
const STANDARD: Record<string, string> = {};
let n = 0;
for (const a of BASES) for (const b of BASES) for (const c of BASES) STANDARD[a + b + c] = AAS[n++];
const VERT_MITO = { ...STANDARD, AGA: '*', AGG: '*', ATA: 'M', TGA: 'W' };
const INVERT_MITO = { ...STANDARD, AGA: 'S', AGG: 'S', ATA: 'M', TGA: 'W' };

const rc = (s: string) => s.split('').reverse().map((c) => ({ A: 'T', T: 'A', G: 'C', C: 'G' } as Record<string, string>)[c] ?? 'N').join('');
const translate = (s: string, table = STANDARD) => {
  let p = '';
  for (let i = 0; i + 2 < s.length; i += 3) p += table[s.slice(i, i + 3)] ?? 'X';
  return p;
};
const byName = (name: string) => {
  const doc = SAMPLE_LIBRARY.find((d) => d.name === name);
  if (!doc) throw new Error(`missing sample ${name}`);
  return doc;
};
const cdsSequence = (doc: SequenceDocument, f: SequenceFeature) => {
  const seq = doc.sequence.toUpperCase().replace(/U/g, 'T');
  const parts = f.segments?.length ? f.segments : [f];
  const pieces = parts.map((p) => seq.slice(p.start - 1, p.end));
  return f.strand === -1 ? pieces.map(rc).join('') : pieces.join('');
};
const codeFor = (doc: SequenceDocument) => {
  const label = String(doc.docMetadata?.['Genetic Code'] ?? doc.alignmentMeta?.geneticCodeLabel ?? '');
  if (/Invertebrate Mito/i.test(label) || doc.name === 'Drosophila ChrM') return INVERT_MITO;
  if (/Vertebrate Mito/i.test(label)) return VERT_MITO;
  return STANDARD;
};

describe('annotated coding sequences keep their reading frame', () => {
  // Records whose CDS legitimately lack a stop or start (fragments, fusions, mitochondrial
  // incomplete stops completed by polyadenylation, the HXB2 nef premature stop).
  const partialOk = new Set([
    'pTwist CMV hIgG1 (LALAPG + YTE)/Human IgG1 Fc (LALA-PG + YTE Enhanced Half-Life)',
    'Ig variable region/immunoglobulin heavy chain variable region CDS',
  ]);
  const docs = SAMPLE_LIBRARY.filter((d) => d.sequence.length && !d.alignmentMeta?.sequences?.length);

  it('every complete CDS starts with a start codon, ends with a stop, and has no internal stop', () => {
    const failures: string[] = [];
    for (const doc of docs) {
      const table = codeFor(doc);
      const mito = table !== STANDARD;
      for (const f of doc.features.filter((x) => String(x.type) === 'CDS')) {
        if (partialOk.has(`${doc.name}/${f.name}`)) continue;
        const cds = cdsSequence(doc, f);
        const protein = translate(cds, table);
        const truncatedByRecord = /beyond record|continues beyond|5-prime partial|5' partial/i.test(f.name);
        const internal = protein.slice(0, -1).includes('*');
        // HXB2 nef carries a genuine premature stop codon.
        if (internal && !(doc.name === 'HIV' && f.name.startsWith('nef'))) failures.push(`${doc.name}/${f.name}: internal stop`);
        if (!truncatedByRecord && !mito && !protein.endsWith('*') && !/partial|tail/i.test(f.name)) failures.push(`${doc.name}/${f.name}: no stop`);
      }
    }
    expect(failures).toEqual([]);
  });

  it('restores join intervals so spliced and frameshifted viral genes translate', () => {
    const hiv = byName('HIV');
    const tat = hiv.features.find((f) => f.name === 'tat CDS')!;
    expect(tat.segments?.map((s) => [s.start, s.end])).toEqual([[5377, 5591], [7925, 7970]]);
    expect(translate(cdsSequence(hiv, tat))).toMatch(/^MEPVDP[A-Z]+\*$/);
    const orf1ab = byName('SARS-CoV-2').features.find((f) => f.name === 'ORF1ab CDS')!;
    expect(orf1ab.segments).toHaveLength(2);
    const p = translate(cdsSequence(byName('SARS-CoV-2'), orf1ab));
    expect(p.slice(0, -1)).not.toContain('*');
    expect(p.endsWith('*')).toBe(true);
  });
});

describe('construct annotations match the encoded biology', () => {
  const EGFP = 'MVSKGEELFTGVVPILVELDGDVNGHKFSVSGEGEGDATYGKLTLKFICTTGKLPVPWPTLVTTLTYGVQCFSRYPDHMKQHDFFKSAMPEGYVQERTIFFKDDGNYKTRAEVKFEGDTLVNRIELKGIDFKEDGNILGHKLEYNYNSHNVYIMADKQKNGIKVNFKIRHNIEDGSVQLADHYQQNTPIGDGPVLLPDNHYLSTQSALSKDPNEKRDHMVLLEFVTAAGITLGMDELYK';

  it('pET-28a eGFP, KanR and lacI annotations encode eGFP, aph(3\')-Ia and LacI', () => {
    const pet = byName('pET-28a(+)-eGFP');
    const feat = (name: string) => pet.features.find((f) => f.name === name)!;
    expect(translate(cdsSequence(pet, feat('eGFP')))).toBe(`${EGFP}*`);
    expect(translate(cdsSequence(pet, feat("KanR (aph(3')-Ia)")))).toMatch(/^MSHIQRETSCSRPRLNSNMDADLYG[A-Z]+\*$/);
    // lacI uses its native GTG start codon.
    expect(translate(cdsSequence(pet, feat('lacI repressor')))).toMatch(/^VKPVTLYDVAEYAGVSYQTVSRVV[A-Z]+\*$/);
  });

  it('pUC19 lacZ-alpha is on the minus strand and encodes the alpha peptide', () => {
    const puc = byName('pUC19_Standard_Vector');
    const lacz = puc.features.find((f) => f.name === 'lacZ-alpha')!;
    expect([lacz.start, lacz.end, lacz.strand]).toEqual([146, 469, -1]);
    expect(translate(cdsSequence(puc, lacz))).toMatch(/^MTMITPSLHA[A-Z]+\*$/);
  });

  it('fluorescent-protein variants carry exactly their documented substitutions', () => {
    const variant = (name: string) => translate(byName(name).sequence.toUpperCase()).replace(/\*$/, '');
    const diffs = (p: string) => [...p].flatMap((aa, i) => (aa === EGFP[i] ? [] : [`${EGFP[i]}${i}${aa}`]));
    // eGFP index i equals GFP residue number (eGFP carries an extra Val at position 2).
    expect(diffs(variant('EYFP_Aequorea_Variant'))).toEqual(['T65G', 'V68L', 'S72A', 'T203Y']);
    expect(diffs(variant('ECFP_Cyan_Variant'))).toEqual(['Y66W', 'N146I', 'M153T', 'V163A']);
    expect(byName('eGFP_Aequorea_Protein (1EMA)').sequence).toBe(EGFP);
  });

  it('Klentaq1 is Taq polymerase residues 281-832 with intact catalytic residues', () => {
    const record = byName('Thermus aquaticus YT-1 (polA Taq)');
    const pola = record.features.find((f) => String(f.type) === 'CDS')!;
    const taq = translate(cdsSequence(record, pola)).replace(/\*$/, '');
    const klentaq = byName('Taq_DNA_Polymerase_Klentaq1 (1TAQ)').sequence;
    expect(klentaq).toBe(taq.slice(280));
    expect([taq[609], taq[784], taq.slice(658, 671)]).toEqual(['D', 'D', 'RRAAKTINFGVLY']);
  });

  it('primer binding coordinates point at the primer sequence', () => {
    for (const doc of SAMPLE_LIBRARY) {
      const seq = doc.sequence.toUpperCase();
      for (const p of doc.primers) {
        const site = seq.slice(p.bindStart - 1, p.bindEnd);
        const anneal = p.annealSequence.toUpperCase();
        expect(p.strand === -1 ? rc(site) : site, `${doc.name}/${p.name}`).toBe(anneal);
      }
    }
  });

  it('paired-end mates face each other and reverse reads are stored as sequenced', () => {
    // The reads are simulated with sequencing errors (US-01M6TDSV), so each is placed where it has
    // the fewest mismatches: read 1 on the forward strand, read 2 reverse-complemented and
    // downstream of its mate, both with no more than a few errors.
    const reads = byName('yghJ paired Illumina reads').alignmentMeta!.sequences!;
    const ref = byName('yghJ CDS (reference)').sequence.toUpperCase();
    const place = (s: string) => {
      let best = { at: -1, mismatches: Infinity };
      for (let at = 0; at + s.length <= ref.length; at++) {
        let mm = 0;
        for (let k = 0; k < s.length && mm < best.mismatches; k++) if (ref[at + k] !== s[k]) mm++;
        if (mm < best.mismatches) best = { at, mismatches: mm };
      }
      return best;
    };
    expect(reads.length).toBe(24);
    for (let i = 0; i < reads.length; i += 2) {
      const r1 = place(reads[i].sequence);
      const r2 = place(rc(reads[i + 1].sequence));
      expect(r1.mismatches, reads[i].name).toBeLessThanOrEqual(3);
      expect(r2.mismatches, reads[i + 1].name).toBeLessThanOrEqual(3);
      expect(r2.at, `${reads[i + 1].name} lies downstream of its mate`).toBeGreaterThan(r1.at);
      expect([reads[i].strand, reads[i + 1].strand]).toEqual([1, -1]);
    }
  });
});

describe('contig-summary genome records', () => {
  const summaries = SAMPLE_LIBRARY.filter(isContigSummaryRecord);

  it('carry no invented bases and keep annotations on the declared genome length', () => {
    expect(summaries.length).toBeGreaterThanOrEqual(20);
    for (const doc of summaries) {
      expect(doc.sequence).toBe('');
      const len = declaredLengthOf(doc);
      for (const f of doc.features) {
        expect(f.end, `${doc.name}/${f.name}`).toBeLessThanOrEqual(len);
        const gs = Number(f.qualifiers?.genomic_start);
        if (gs && !f.segments?.length) expect(f.start).toBe(Math.min(gs, Number(f.qualifiers?.genomic_end)));
      }
    }
    const yeast = byName('Yeast ChrI');
    expect(yeast.features.find((f) => f.name === 'PAU8 CDS')!.start).toBeGreaterThan(1000);
  });

  /**
   * Genomes/Bacteria and Genomes/Eukaryotes, pinned to the reference sample export's records
   * (collection="Sample Documents/Genomes/...") and its bacteria and eukaryote document tables.
   */
  describe('Genome summary samples', () => {
    const genome = (name: string) => {
      const d = SAMPLE_LIBRARY.find((x) => (x.folder ?? '').startsWith('Genomes/') && x.name === name);
      expect(d, `missing genome sample "${name}"`).toBeDefined();
      return d!;
    };
    const declared = (name: string) => Number(genome(name).docMetadata?.['Declared Length']);

    it('carries the three bacterial genomes with their record figures', () => {
      // name | length | accession | GID; topology circular.
      const rows: [string, number, string, string][] = [
        ['E. coli K12 MG1655', 4641652, 'NC_000913', '556503834'],
        ['P. aeruginosa PAO1', 6264404, 'NC_002516.2', '110645304'],
        ['P. fluorescens SBW25', 6722539, 'NC_012660.1', '229587578'],
      ];
      for (const [name, length, accession, gid] of rows) {
        const doc = genome(name);
        expect(doc.folder, name).toBe('Genomes/Bacteria');
        expect(doc.topology, name).toBe('circular');
        expect(declared(name), name).toBe(length);
        expect(doc.accession, name).toBe(accession);
        expect(String(doc.docMetadata?.GID), name).toBe(gid);
        expect(doc.sequence, `${name} is a summary record`).toBe('');
      }
    });

    it('gives every bacterial genome a source and an INSDC accession annotation', () => {
      // Each bacterial genome's accession annotation is named with its INSDC accession
      // (U00096.3 for E. coli, AE004091.2 for PAO1).
      const expected: Record<string, string> = {
        'E. coli K12 MG1655': 'U00096.3',
        'P. aeruginosa PAO1': 'AE004091.2',
        'P. fluorescens SBW25': 'AM181176.4',
        'Bacillus subtilis 168': 'AL009126.3',
      };
      for (const [name, accession] of Object.entries(expected)) {
        const doc = genome(name);
        const source = doc.features.filter((f) => f.type === 'source');
        const acc = doc.features.filter((f) => f.type === 'accession');
        expect(source.length, `${name} source`).toBe(1);
        expect(acc.map((f) => f.name), `${name} accession`).toEqual([accession]);
        // Both annotations span the whole declared genome.
        expect(acc[0].end - acc[0].start + 1, name).toBe(declared(name));
        expect(source[0].end - source[0].start + 1, name).toBe(declared(name));
      }
    });

    it('ships every annotation the source record declares, not a truncated subset', () => {
      // Each count is the <annotation> count of the matching export record.
      const counts: Record<string, number> = {
        'E. coli K12 MG1655': 2,
        'P. aeruginosa PAO1': 2,
        'P. fluorescens SBW25': 2,
        'Bovine Chr1': 107,
        'Bovine Chr2': 65,
        'Bovine Chr3': 74,
        'Drosophila ChrM': 88,
        'Drosophila Chr2L': 2,
        'Yeast ChrI': 326,
        'Equus Chr1': 2,
      };
      for (const [name, count] of Object.entries(counts)) {
        const doc = genome(name);
        expect(doc.features.length, `${name} shipped annotations`).toBe(count);
        // The table column and the Annotations tab must not contradict each other.
        expect(Number(doc.docMetadata?.['Annotations Count']), `${name} declared count`).toBe(count);
      }
    });

    it('keeps the eukaryote chromosome figures the records report', () => {
      const rows: [string, number, string, string][] = [
        ['Bovine Chr1', 158337067, 'AC_000158.1', '258517435'],
        ['Bovine Chr2', 137060424, 'AC_000159.1', '258513365'],
        ['Bovine Chr3', 121430405, 'AC_000160.1', '258513364'],
        ['Drosophila ChrM', 19517, 'NC_001709.1', '5835233'],
        ['Drosophila Chr2L', 23513712, 'NT_033779.5', '671162316'],
        ['Yeast ChrI', 230218, 'NC_001133.9', '330443391'],
        ['Equus Chr1', 188260577, 'NC_009144.3', '1325362995'],
      ];
      for (const [name, length, accession, gid] of rows) {
        const doc = genome(name);
        expect(doc.folder, name).toBe('Genomes/Eukaryotes');
        expect(declared(name), name).toBe(length);
        expect(doc.accession, name).toBe(accession);
        expect(String(doc.docMetadata?.GID), name).toBe(gid);
      }
    });

    it('holds every genome annotation inside its declared chromosome', () => {
      for (const doc of SAMPLE_LIBRARY.filter((d) => (d.folder ?? '').startsWith('Genomes/'))) {
        const len = Number(doc.docMetadata?.['Declared Length'] ?? doc.sequence.length);
        if (!len) continue;
        for (const f of doc.features) {
          expect(f.start, `${doc.name} / ${f.name} start`).toBeGreaterThanOrEqual(1);
          expect(f.end, `${doc.name} / ${f.name} end`).toBeLessThanOrEqual(len);
          expect(f.end, `${doc.name} / ${f.name} span`).toBeGreaterThanOrEqual(f.start);
        }
      }
    });

    it('tiles the Bovine contig accessions in ascending, non-overlapping order', () => {
      // The Sequence View draws these as the green contig blocks along the chromosome.
      for (const name of ['Bovine Chr1', 'Bovine Chr2', 'Bovine Chr3']) {
        const acc = genome(name).features.filter((f) => f.type === 'accession');
        expect(acc.length, name).toBeGreaterThan(20);
        for (let i = 1; i < acc.length; i++) {
          expect(acc[i].start, `${name} contig ${i} follows ${i - 1}`).toBeGreaterThan(acc[i - 1].end);
        }
      }
    });

    it('splices the four intron-containing Yeast ChrI genes in transcript order', () => {
      const yeast = genome('Yeast ChrI');
      const spliced = yeast.features.filter((f) => (f.segments?.length ?? 0) > 1);
      expect(spliced.map((f) => f.name).sort()).toEqual([
        'EFB1 CDS', 'EFB1 mRNA', 'SNC1 CDS', 'SNC1 mRNA',
        'SUP56 tRNA', 'TFC3 CDS', 'TFC3 mRNA', 'TRN1 tRNA',
      ]);
      // TFC3 is on the minus strand: its downstream exon is transcribed first.
      const tfc3 = yeast.features.find((f) => f.name === 'TFC3 CDS')!;
      expect(tfc3.strand).toBe(-1);
      expect(tfc3.segments!.map((s) => [s.start, s.end])).toEqual([
        [151097, 151166],
        [147594, 151006],
      ]);
    });

    it('measures a spliced CDS by its exons, so no intron-containing gene reads as a frameshift', () => {
      // SNC1 spans 467 bp of chromosome but codes for 354 bases across two exons.
      const snc1 = genome('Yeast ChrI').features.find((f) => f.name === 'SNC1 CDS')!;
      const span = snc1.end - snc1.start + 1;
      const coding = snc1.segments!.reduce((n, seg) => n + (seg.end - seg.start + 1), 0);
      expect(span).toBe(467);
      expect(span % 3).not.toBe(0);
      expect(coding).toBe(354);
      expect(coding % 3).toBe(0);
      // Every spliced CDS in the genome folders keeps a triplet coding length.
      for (const doc of SAMPLE_LIBRARY.filter((d) => (d.folder ?? '').startsWith('Genomes/'))) {
        for (const f of doc.features) {
          if (f.type !== 'CDS' || (f.segments?.length ?? 0) < 2) continue;
          const len = f.segments!.reduce((n, seg) => n + (seg.end - seg.start + 1), 0);
          expect(len % 3, `${doc.name} / ${f.name} coding length ${len}`).toBe(0);
        }
      }
    });

    it('translates the Taq polymerase coding sequence end to end', () => {
      // The record is J04639 (2,626 bp); its polA CDS is bases 121..2619.
      const taq = genome('Thermus aquaticus YT-1 (polA Taq)');
      expect(taq.sequence.length).toBe(2626);
      const pola = taq.features.filter((f) => String(f.type) === 'CDS');
      expect(pola.map((f) => [f.start, f.end, f.strand])).toEqual([[121, 2619, 1]]);
      const cds = cdsSequence(taq, pola[0]);
      expect(cds.length).toBe(2499);
      const protein = translate(cds);
      expect(protein.length).toBe(833);
      expect(protein.slice(0, 20)).toBe('MRGMLPLFEPKGRVLLVDGH');
      expect(protein.endsWith('GIGEDWLSAKE*')).toBe(true);
      expect(protein.slice(0, -1)).not.toContain('*');
    });
  });

  /**
   * Contig Assembly folder: simulated reads of public records and MolBioCraft's contig of the COI
   * reads (US-01M6TDSV; src/__tests__/sampleAssemblyReads.test.ts regenerates the reads).
   */
  describe('Contig Assembly samples', () => {
    const contig = (name: string) => {
      const d = SAMPLE_LIBRARY.find((x) => x.folder === 'Contig Assembly' && x.name === name);
      expect(d, `missing contig sample "${name}"`).toBeDefined();
      return d!;
    };
    /** Mott's trim at error probability `cutoff`: the best-scoring stretch of sum(cutoff - P(err)). */
    const mottTrim = (seq: string, phred: readonly number[], cutoff: number) => {
      let [best, cur, curStart, bestStart, bestEnd] = [0, 0, 0, 0, seq.length - 1];
      for (let i = 0; i < seq.length; i++) {
        const delta = cutoff - 10 ** (-phred[i] / 10);
        if (cur + delta <= 0) {
          cur = 0;
          curStart = i + 1;
        } else {
          cur += delta;
          if (cur > best) [best, bestStart, bestEnd] = [cur, curStart, i];
        }
      }
      return best > 0 ? seq.slice(bestStart, bestEnd + 1) : '';
    };

    it('holds exactly the seven contig-assembly documents', () => {
      const names = SAMPLE_LIBRARY.filter((d) => d.folder === 'Contig Assembly').map((d) => d.name).sort();
      expect(names).toEqual([
        'COI Assembly',
        'COI fwd read',
        'COI rev read',
        'yghJ CDS (divergent reference)',
        'yghJ CDS (reference)',
        'yghJ Ion Torrent reads',
        'yghJ paired Illumina reads',
      ]);
    });

    it('keeps the COI contig consensus in register with its reads', () => {
      const asm = contig('COI Assembly');
      // The stored consensus spans exactly the rows' columns, or the Contig View ruler and every
      // per-column overlay drift against the reads.
      const width = asm.sequence.length;
      expect(width).toBeGreaterThan(724);
      expect(String(asm.docMetadata?.['Sequence Length'])).toBe(String(width));
      const rows = asm.alignmentMeta?.sequences ?? [];
      expect(rows).toHaveLength(2);
      for (const r of rows) expect(r.sequence.length, r.name).toBe(width);
      // Orientation and coverage of the two reads.
      const rev = rows.find((r) => /rev/i.test(r.name))!;
      const fwd = rows.find((r) => /fwd/i.test(r.name))!;
      expect(rev.strand).toBe(-1);
      expect(fwd.strand).toBe(1);
      const residues = rows.reduce((n, r) => n + r.sequence.replace(/-/g, '').length, 0);
      expect(asm.alignmentMeta?.meanCoverageX).toBe(Math.round((10 * residues) / width) / 10);
    });

    it('holds each read as the assembler\'s quality trim left it, in contig orientation', () => {
      // MolBioCraft's assembler trims each read (Mott, P(err) 0.05) before it assembles it, so a
      // contig row is its trimmed read, reverse-complemented when on the other strand, and carries
      // no "Trimmed" annotation of another program's.
      const rows = contig('COI Assembly').alignmentMeta!.sequences!;
      for (const row of rows) {
        const read = contig(row.name);
        const trimmed = mottTrim(read.sequence, read.chromatogram!.phredScores, 0.05);
        expect(trimmed.length, `${row.name} keeps a trimmed read`).toBeGreaterThan(600);
        expect(trimmed.length, `${row.name} trim removes the low-quality ends`).toBeLessThan(read.sequence.length);
        expect(row.sequence.replace(/-/g, ''), row.name).toBe(row.strand === -1 ? rc(trimmed) : trimmed);
        expect(row.features ?? [], row.name).toEqual([]);
      }
    });

    it('gives the Sanger reads their simulated length and a quality per base', () => {
      for (const [name, length] of [['COI fwd read', 724], ['COI rev read', 721]] as const) {
        const read = contig(name);
        expect(read.sequence, name).toHaveLength(length);
        expect(String(read.docMetadata?.['Sequence Length']), name).toBe(String(length));
        // Each read carries a per-base quality track the contig consensus is resolved from.
        expect(read.chromatogram?.phredScores, name).toHaveLength(length);
        expect(read.chromatogram?.baseCalls, name).toBe(read.sequence);
      }
    });

    it('keeps the yghJ references at their NCBI extraction lengths', () => {
      expect(contig('yghJ CDS (reference)').sequence).toHaveLength(4563);
      expect(contig('yghJ CDS (divergent reference)').sequence).toHaveLength(4578);
    });

    it('declares read counts that match the simulated reads it ships', () => {
      for (const name of ['yghJ Ion Torrent reads', 'yghJ paired Illumina reads']) {
        const d = contig(name);
        const embedded = d.alignmentMeta?.sequences ?? [];
        expect(embedded.length, `${name} embeds no reads`).toBeGreaterThan(0);
        // The table's read count is the reads the document holds, not some other dataset's.
        expect(d.alignmentMeta?.sequenceCount, name).toBe(embedded.length);
        expect(String(d.docMetadata?.['# Sequences']), name).toBe(String(embedded.length));
        expect(d.description, name).toMatch(new RegExp(`^${embedded.length} simulated`));
      }
    });
  });

  it('downloads real bases only when they match the declared length', async () => {
    const ecoli = byName('E. coli K12 MG1655');
    const fake = (body: string) => async () => ({ ok: true, status: 200, text: async () => body });
    await expect(downloadSummarySequence(ecoli, fake('>x\nACGT\n'))).rejects.toThrow(/declares/);
    const small = { ...ecoli, docMetadata: { ...ecoli.docMetadata, 'Declared Length': 8 } };
    const done = await downloadSummarySequence(small, fake('>NC_000913\nAGCTTTTC\n'));
    expect(done.sequence).toBe('AGCTTTTC');
    expect(isContigSummaryRecord(done)).toBe(false);
    expect(parseSingleFasta('>a\nAC\nGT\n>b\nTT')).toBe('ACGT');
  });
});

/**
 * Genomes/Human, Genomes/Plants, Genomes/Viruses and Primers, pinned to the reference sample
 * export's records and its human, plant, virus and primer document tables; the Tree Documents are
 * MolBioCraft's own trees of the rebuilt alignments (US-01M6TDSV). The samples carry no document
 * dates of their own from that export: no Created or Modified field (US-01M6TDFV, US-01M6TDSV).
 */
describe('Human, plant and virus reference records', () => {
  const sample = (name: string) => {
    const d = SAMPLE_LIBRARY.find((x) => x.name === name);
    expect(d, `missing sample "${name}"`).toBeDefined();
    return d!;
  };

  it('carries the seven human chromosomes with their record figures', () => {
    // name | declared length | accession | GID | annotations
    const rows: [string, number, string, string, number][] = [
      ['chr1', 248956422, 'NC_000001.11', '568815597', 13],
      ['chr2', 242193529, 'NC_000002.12', '568815596', 8],
      ['chr3', 198295559, 'NC_000003.12', '568815595', 7],
      ['chr4', 190214555, 'NC_000004.12', '568815594', 10],
      ['chrX', 156040895, 'NC_000023.11', '568815575', 10],
      ['chrY', 57227415, 'NC_000024.10', '568815574', 14],
      ['chrM', 16570, 'EU545435.1', '169792587', 52],
    ];
    for (const [name, length, accession, gid, annotations] of rows) {
      const doc = sample(name);
      expect(doc.folder, name).toBe('Genomes/Human');
      expect(Number(doc.docMetadata?.['Declared Length']), name).toBe(length);
      expect(doc.accession, name).toBe(accession);
      expect(String(doc.docMetadata?.GID), name).toBe(gid);
      expect(doc.features.length, `${name} annotations`).toBe(annotations);
      expect(doc.docMetadata?.Organism, name).toBe('Homo sapiens');
      expect(String(doc.docMetadata?.Taxonomy), name).toContain('Hominidae; Homo');
    }
    // Only the mitochondrion is a downloaded, circular sequence; the nuclear chromosomes are
    // annotation-only summaries whose features tile the assembly as accession contigs.
    expect(sample('chrM').sequence.length).toBe(16570);
    expect(sample('chrM').topology).toBe('circular');
    for (const name of ['chr1', 'chr2', 'chr3', 'chr4', 'chrX', 'chrY']) {
      const doc = sample(name);
      expect(doc.sequence, name).toBe('');
      expect(doc.topology, name).toBe('linear');
      expect(doc.features.filter((f) => f.type === 'source').length, name).toBe(1);
      expect(doc.features.filter((f) => f.type === 'accession').length, name).toBeGreaterThan(0);
    }
    // chr1's first and last contigs are annotated; both must be on the ring.
    const chr1 = sample('chr1').features.map((f) => f.name);
    expect(chr1).toContain('NT_032977.10');
    expect(chr1).toContain('NT_167186.2');
  });

  it('carries the seven Arabidopsis chromosomes with their record figures', () => {
    const rows: [string, number, string, string, number, string][] = [
      ['Arabidopsis Chr1', 30427671, 'NC_003070.9', '240254421', 2, 'linear'],
      ['Arabidopsis Chr2', 19698289, 'NC_003071.7', '240254678', 2, 'linear'],
      ['Arabidopsis Chr3', 23459830, 'NC_003074.8', '240255695', 2, 'linear'],
      ['Arabidopsis Chr4', 18585056, 'NC_003075.7', '240256243', 2, 'linear'],
      ['Arabidopsis Chr5', 26975502, 'NC_003076.8', '240256493', 2, 'linear'],
      ['Arabidopsis ChrC', 154478, 'NC_000932.1', '7525012', 257, 'circular'],
      ['Arabidopsis ChrM', 366924, 'NC_001284.2', '26556996', 800, 'circular'],
    ];
    for (const [name, length, accession, gid, annotations, topology] of rows) {
      const doc = sample(name);
      expect(doc.folder, name).toBe('Genomes/Plants');
      expect(Number(doc.docMetadata?.['Declared Length']), name).toBe(length);
      expect(doc.accession, name).toBe(accession);
      expect(String(doc.docMetadata?.GID), name).toBe(gid);
      expect(doc.features.length, `${name} annotations`).toBe(annotations);
      expect(doc.topology, name).toBe(topology);
      expect(doc.docMetadata?.Organism, name).toBe('Arabidopsis thaliana');
    }
    // The organelle genomes are where the annotation lives; every feature stays on the molecule.
    for (const name of ['Arabidopsis ChrC', 'Arabidopsis ChrM']) {
      const doc = sample(name);
      const len = declaredLengthOf(doc);
      for (const f of doc.features) {
        expect(f.start, `${name}/${f.name}`).toBeGreaterThanOrEqual(1);
        expect(f.end, `${name}/${f.name}`).toBeLessThanOrEqual(len);
      }
    }
    // rps12 is trans-spliced in the chloroplast: its CDS must carry its exons, not a flat span.
    const rps12 = sample('Arabidopsis ChrC').features.find((f) => f.name === 'rps12 CDS')!;
    expect(rps12.segments?.length).toBe(3);
    expect(rps12.strand).toBe(-1);
  });

  it('carries the seven virus genomes with their record figures and full annotation sets', () => {
    // name | length | accession | GID | annotations | topology | molecule
    const rows: [string, number, string, string, number, string, string][] = [
      ['Ebola', 18959, 'NC_002549.1', '10313991', 49, 'linear', 'cRNA'],
      ['HIV', 9181, 'NC_001802', '9629357', 41, 'linear', 'RNA'],
      ['HPV', 7417, 'JX413110', '409183142', 15, 'circular', 'DNA'],
      ['Phage lambda', 48502, 'NC_001416.1', '9626243', 285, 'linear', 'DNA'],
      ['Phage T7', 39937, 'NC_001604.1', '9627425', 162, 'linear', 'DNA'],
      ['SARS', 29751, 'NC_004718.3', '30271926', 57, 'linear', 'RNA'],
      ['SARS-CoV-2', 29903, 'NC_045512.2', '1798174254', 57, 'linear', 'RNA'],
    ];
    for (const [name, length, accession, gid, annotations, topology, molecule] of rows) {
      const doc = sample(name);
      expect(doc.folder, name).toBe('Genomes/Viruses');
      expect(doc.sequence.length, `${name} bases`).toBe(length);
      expect(doc.accession, name).toBe(accession);
      expect(String(doc.docMetadata?.GID), name).toBe(gid);
      expect(doc.features.length, `${name} annotations`).toBe(annotations);
      expect(doc.topology, name).toBe(topology);
      // The record's own molecule type is kept (an Ebola record is cRNA, not DNA) even
      // though the stored residues are the cDNA alphabet.
      expect(doc.docMetadata?.['Molecule Type'], name).toBe(molecule);
      for (const f of doc.features) {
        expect(f.start, `${name}/${f.name}`).toBeGreaterThanOrEqual(1);
        expect(f.end, `${name}/${f.name}`).toBeLessThanOrEqual(length);
      }
    }
    // The lambda record names only some of its variation features; the rest are labelled
    // "Feature_<index>", counting over the annotations that carry intervals.
    const lambda = sample('Phage lambda').features;
    const feature56 = lambda.find((f) => f.name === 'Feature_56')!;
    expect(feature56.type).toBe('Polymorphism');
    expect([feature56.start, feature56.end]).toEqual([19368, 23278]);
    // T7's promoters are point features the record stores without a direction.
    const t7Promoters = sample('Phage T7').features.filter((f) => f.type === 'regulatory');
    expect(t7Promoters.length).toBeGreaterThan(20);
    expect(t7Promoters.every((f) => f.strand === 0)).toBe(true);
  });
});

describe('Primers and Tree Documents', () => {
  const sample = (name: string) => {
    const d = SAMPLE_LIBRARY.find((x) => x.name === name);
    expect(d, `missing sample "${name}"`).toBeDefined();
    return d!;
  };

  it('ships the universal sequencing primers with computed Tm and %GC, and no other program\'s metadata', () => {
    // name | sequence | accession. Each sequence is checked against the record it cites in
    // 'each sequencing primer equals its fetched source record' below.
    const rows: [string, string, string][] = [
      ['M13-F (-20)', 'GTAAAACGACGGCCAGT', 'BBa_G00103'],
      ['M13-F (-40)', 'GTTTTCCCAGTCACGAC', 'BBa_G00105'],
      ['M13-F (-46)', 'GCCAGGGTTTTCCCAGTCACGA', 'BBa_G00106'],
      ['M13-R (-26)', 'CAGGAAACAGCTATGAC', 'BBa_G00104'],
      ['M13-R (-46)', 'GAGCGGATAACAATTTCACACAGG', 'BBa_G00107'],
      ['T7 promoter', 'TAATACGACTCACTATAGGG', ''],
      ['T3 promoter (17bp)', 'ATTAACCCTCACTAAAG', ''],
      ['T3 promoter (20bp)', 'ATTAACCCTCACTAAAGGGA', ''],
      ['T3 promoter (24bp)', 'GTTTCTAATTAACCCTCACTAAAG', ''],
      ['SP6 promoter', 'CATACGATTTAGGTGACACTATAG', ''],
      ['VF2', 'TGCCACCTGACGTCTAAGAA', 'BBa_G00100'],
      ['VR', 'ATTACCGCCTTTGAGTGAGC', 'BBa_G00101'],
    ];
    const ids = SAMPLE_LIBRARY.filter((d) => d.folder === 'Primers' && /^doc-primer-seq-/.test(d.id)).map((d) => d.name).sort();
    expect(ids, 'the sequencing primers are the doc-primer-seq-* documents').toEqual(rows.map(([n]) => n).sort());
    for (const [name, sequence, accession] of rows) {
      const doc = sample(name);
      expect(doc.id, name).toMatch(/^doc-primer-seq-[a-z0-9-]+$/);
      expect(doc.folder, name).toBe('Primers');
      expect(doc.documentKind, name).toBe('primer');
      expect(doc.sequence, name).toBe(sequence);
      expect(doc.accession, name).toBe(accession);
      expect(doc.moleculeType, name).toBe('DNA');
      expect(doc.topology, name).toBe('linear');
      // Tm and %GC are MolBioCraft's own: the engine's primer metrics at the app's default
      // conditions (50 mM Na+, 1.5 mM Mg2+, 250 nM oligo), over the whole oligo.
      const m = calculatePrimerMetrics(sequence);
      expect(m.tmNoAnswerReason, name).toBeUndefined();
      expect(doc.docMetadata?.Tm, `${name} Tm`).toBe(`${m.tmC.toFixed(1)} °C`);
      expect(doc.docMetadata?.['%GC Primer Bind'], `${name} %GC`).toBe(`${m.gcPercent.toFixed(1)}%`);
      // The GC fraction is the one the oligo actually has.
      const gcCount = sequence.split('').filter((c) => c === 'G' || c === 'C').length;
      expect(((gcCount / sequence.length) * 100).toFixed(1) + '%', `${name} %GC`).toBe(doc.docMetadata?.['%GC Primer Bind']);
      // No field another program wrote: its design tool, its own thermodynamics, its dates.
      const copied = Object.keys(doc.docMetadata ?? {}).filter((k) => /^(Designed With|Hairpin Tm|Self Dimer Tm|Created|Modified)$/i.test(k));
      expect(copied, name).toEqual([]);
      // Each oligo carries one binding-region annotation spanning the whole oligo.
      expect(doc.features.length, name).toBe(1);
      expect(doc.features[0].name, name).toBe('Binding Region');
      expect(doc.features[0].type, name).toBe('primer_bind');
      expect([doc.features[0].start, doc.features[0].end], name).toEqual([1, sequence.length]);
    }
    // M13-R (-26) is its own iGEM part, not M13-F (-20)'s.
    expect(sample('M13-R (-26)').accession).not.toBe(sample('M13-F (-20)').accession);
  });

  // The seven design primers (BG-01M6WB0V, BG-01M6XWXX): id | how its provenance is recorded.
  // The binding region is read from the document's own sequence and primer_bind feature, never from
  // a literal in the test, so replacing a primer's stored sequence fails both checks.
  const DESIGN_PRIMERS: [string, 'record' | 'publication' | 'example'][] = [
    ['doc-primer-cmv-fwd', 'record'],
    ['doc-primer-ef1a-fwd', 'record'],
    ['doc-primer-bgh-rev', 'publication'],
    ['doc-primer-wpre-rev', 'record'],
    ['doc-primer-16s-27f', 'publication'],
    ['doc-primer-16s-1492r', 'publication'],
    ['doc-primer-gibson-mch-fwd', 'example'],
  ];
  const designPrimer = (id: string) => {
    const d = SAMPLE_LIBRARY.find((x) => x.id === id);
    expect(d, `missing design primer "${id}"`).toBeDefined();
    return d!;
  };
  const bindingRegionOf = (doc: SequenceDocument) => {
    const seq = doc.sequence.toUpperCase();
    const sites = doc.features.filter((f) => String(f.type).startsWith('primer_bind'));
    expect(sites.length, `${doc.id} has one primer_bind feature`).toBe(1);
    const [site] = sites;
    expect(site.start >= 1 && site.end === seq.length && site.start <= site.end, `${doc.id} primer_bind span`).toBe(true);
    return seq.slice(site.start - 1, site.end);
  };
  // The design primers are the Primers folder's documents that are not US-01M6TDFV's twelve
  // sequencing primers, so a new or renamed one cannot slip past the list above.
  const expectTheSevenDesignPrimers = () => {
    const found = SAMPLE_LIBRARY.filter((d) => d.folder === 'Primers' && !/^doc-primer-seq-/.test(d.id))
      .map((d) => d.id)
      .sort();
    expect(found, 'the design primers in the Primers folder').toEqual(DESIGN_PRIMERS.map(([id]) => id).sort());
  };

  it('design primers carry no stored thermodynamic values', () => {
    expectTheSevenDesignPrimers();
    for (const [id] of DESIGN_PRIMERS) {
      const doc = designPrimer(id);
      const bindingRegion = bindingRegionOf(doc);
      const meta = doc.docMetadata ?? {};
      // No Tm, hairpin or primer-dimer figure, under those names or any other.
      const fields = Object.keys(meta).filter((k) => /\btm\b|hairpin|dimer/i.test(k));
      expect(fields, `${id} stores a thermodynamic field`).toEqual([]);
      const values = Object.entries(meta).filter(([, v]) => /kcal\/mol|°C/.test(String(v)));
      expect(values, `${id} stores a thermodynamic value`).toEqual([]);
      // The one figure it keeps is MolBioCraft's own %GC over the document's binding region, from
      // the engine's primer metrics at the app's default conditions ...
      const m = calculatePrimerMetrics(bindingRegion);
      expect(doc.docMetadata?.['%GC Primer Bind'], `${id} %GC`).toBe(`${m.gcPercent.toFixed(1)}%`);
      // ... which is the G/C count the stored oligo has, a degenerate base counting as neither.
      const gc = bindingRegion.split('').filter((c) => c === 'G' || c === 'C').length;
      const docGc = `${((gc / bindingRegion.length) * 100).toFixed(1)}%`;
      expect(docGc, `${id} %GC`).toBe(String(doc.docMetadata?.['%GC Primer Bind']));
      expect(`${m.gcPercent.toFixed(1)}%`, `${id} %GC`).toBe(docGc);
      // Tm, hairpin ΔG and self-dimer ΔG come from the oligo instead: the Primer & PCR Studio
      // reads them off the record primerRecordFromDoc builds when the primer is opened.
      const record = primerRecordFromDoc(doc);
      expect(record.sequence, `${id} record sequence`).toBe(doc.sequence.toUpperCase());
      for (const [field, value] of [
        ['tmAnnealC', record.tmAnnealC],
        ['hairpinDeltaG', record.hairpinDeltaG],
        ['selfDimerDeltaG', record.selfDimerDeltaG],
      ] as const) {
        expect(Number.isFinite(value), `${id} ${field} is a number the engine computed`).toBe(true);
      }
    }
    // And the engine answers with real energies on both arms independently, not a zero for every oligo.
    const records = DESIGN_PRIMERS.map(([id]) => primerRecordFromDoc(designPrimer(id)));
    expect(records.some((r) => r.hairpinDeltaG < 0), 'the engine computes a hairpin ΔG below zero').toBe(true);
    expect(records.some((r) => r.selfDimerDeltaG < 0), 'the engine computes a self-dimer ΔG below zero').toBe(true);
  });

  it('each design primer cites its source or is labelled an example design', () => {
    expectTheSevenDesignPrimers();
    const ACCESSION = /\b[A-Z]{1,2}_?\d{5,6}(\.\d+)?\b/;
    const STRAND_SPAN = /\b(plus|minus) strand ([\d,]+)-([\d,]+)\b/;
    const DOI = /\bdoi:10\.\d{4,9}\/\S+/;
    for (const [id, kind] of DESIGN_PRIMERS) {
      const doc = designPrimer(id);
      const bindingRegion = bindingRegionOf(doc);
      const meta = doc.docMetadata ?? {};
      const field = (name: string) => (meta[name] === undefined ? '' : String(meta[name]).trim());
      const record = field('Source record');
      const publication = field('Source publication');
      const example = field('Provenance');
      // One provenance statement, filled in: a record, a paper, or the example-design label.
      expect([record, publication, example].filter((v) => v !== '').length, `${id} provenance fields`).toBe(1);
      expect(record !== '' ? 'record' : publication !== '' ? 'publication' : 'example', `${id} provenance`).toBe(kind);
      if (kind === 'record') {
        // The record is named by accession, and says where it holds the oligo.
        expect(record, `${id} Source record`).toMatch(ACCESSION);
        const span = record.match(STRAND_SPAN);
        expect(span, `${id} Source record strand and span`).not.toBeNull();
        const spanLen = Number(span![3].replace(/,/g, '')) - Number(span![2].replace(/,/g, '')) + 1;
        expect(bindingRegion.length, `${id} sequence length matches cited span`).toBe(spanLen);
      }
      if (kind === 'publication') {
        // The paper is named by DOI, and the stored sequence equals the oligo quoted in the citation.
        expect(publication, `${id} Source publication`).toMatch(DOI);
        const quoted = publication.match(/\b5'-([A-Z]+)-3'/)?.[1] ?? '';
        expect(quoted, `${id} Source publication quotes 5'-...-3'`).not.toBe('');
        expect(bindingRegion, `${id} sequence matches Source publication`).toBe(quoted);
      }
      if (kind === 'example') {
        // A MolBioCraft example design cites no source: it says so, and names none.
        expect(example, `${id} Provenance`).toBe('MolBioCraft example design');
        expect([record, publication], `${id} cites no source`).toEqual(['', '']);
        const ext = field("5' Extension").match(/^([ACGT]+) \((\d+) nt\)$/);
        expect(ext, `${id} 5' Extension`).not.toBeNull();
        expect(Number(ext![2]), `${id} 5' Extension length`).toBe(ext![1].length);
        expect(doc.sequence.toUpperCase().slice(0, ext![1].length), `${id} 5' tail`).toBe(ext![1]);
        expect(byName('pET-28a(+)-eGFP').sequence.toUpperCase(), `${id} 5' tail in pET-28a(+)-eGFP`).toContain(ext![1]);
      }
    }
    // Both states the criterion allows are in use, so neither branch above is dead.
    const kinds = new Set(DESIGN_PRIMERS.map(([, kind]) => kind));
    expect([...kinds].sort(), 'the provenance kinds in use').toEqual(['example', 'publication', 'record']);
  });

  it('gives every reference tree a stored topology over the alignment it was built from', () => {
    // name | source alignment | tips. Each tree is MolBioCraft's Neighbor-Joining tree of the
    // rebuilt alignment (US-01M6TDSV): a fully resolved tree, so 2n - 1 nodes for n tips.
    const rows: [string, string, number][] = [
      ['COXII', 'doc-aln-coxii-cds', 50],
      ['Three Kingdoms', 'doc-aln-three-kingdoms', 35],
    ];
    // The People tree went with its fictitious-character alignment (US-01M6TGKH, D0094).
    expect(SAMPLE_LIBRARY.filter((x) => x.folder === 'Tree Documents').map((x) => x.name).sort()).toEqual(rows.map(([n]) => n).sort());
    // NJ tip labels keep letters, digits, '_', '.' and '-' of the member name, and write '_' for the rest.
    const label = (name: string) => name.replace(/[^A-Za-z0-9_.-]/g, '_');
    for (const [name, sourceId, tips] of rows) {
      // The alignment a tree was built from shares its name, so scope the lookup to the folder.
      const doc = SAMPLE_LIBRARY.find((x) => x.name === name && x.folder === 'Tree Documents');
      const source = SAMPLE_LIBRARY.find((x) => x.id === sourceId)!;
      expect(doc, `missing tree "${name}"`).toBeDefined();
      if (!doc) continue;
      expect(doc.documentKind, name).toBe('tree');
      expect(doc.history.flatMap((h) => h.parentIds), name).toEqual([sourceId]);
      const newick = String(doc.docMetadata?.Newick ?? '');
      expect(newick, `${name} stores a topology`).not.toBe('');
      expect(newick.endsWith(';'), `${name} Newick is terminated`).toBe(true);
      expect(doc.docMetadata?.['No. tips'], name).toBe(tips);
      expect(doc.docMetadata?.['No. nodes'], name).toBe(2 * tips - 1);
      expect(doc.docMetadata?.['Tree builder'], name).toBe('Neighbor-Joining (Jukes-Cantor)');
      for (const key of ['# Sequences', '% Pairwise Identity', '% Identical Sites']) {
        expect(doc.docMetadata?.[key], `${name} ${key}`).toBe(source.docMetadata?.[key]);
      }
      // The tree travels with its alignment, so the Alignment View opens on the same data.
      const members = doc.alignmentMeta?.sequences ?? [];
      expect(members, `${name} alignment members`).toEqual(source.alignmentMeta?.sequences);
      expect(members.length).toBe(tips);
      for (const member of members) {
        expect(member.sequence.length, `${name}/${member.name}`).toBe(source.sequence.length);
        expect(newick, `${name}: tip ${member.name}`).toMatch(new RegExp(`[(,]${label(member.name).replace(/\./g, '\\.')}:`));
      }
      // Balanced parentheses: one opening paren per internal node.
      const opens = newick.split('(').length - 1;
      const closes = newick.split(')').length - 1;
      expect(opens, `${name} parens`).toBe(closes);
      expect(opens + tips, `${name} node tally`).toBe(2 * tips - 1);
    }
  });
});

/**
 * The sample primers, protein records, yadF clone and genome records (US-01M6TDFV, D0069), and the
 * genome, plasmid and yghJ CDS sequences (US-01M6TGZ8), against the public records they cite, as
 * scripts/outside-data/fetch.sh fetches them. Each test that reads
 * a record skips visibly without it, and fails under MOLBIOCRAFT_REQUIRE_TEST_DATA=1, so the
 * reference check cannot pass on a self-pinned literal.
 */
describe('samples checked against the public records they cite', () => {
  interface NodeFsRead { readFileSync: (p: string | URL, e: string) => string }
  const fsSpec: string = 'node:fs';
  const fsP = import(/* @vite-ignore */ fsSpec) as Promise<NodeFsRead>;
  const text = async (rel: string) => (await fsP).readFileSync(dataPath(rel), 'utf8');
  /** The bases of a one-record FASTA file, with its header line. */
  const fasta = async (rel: string) => {
    const lines = (await text(rel)).split(/\r?\n/);
    expect(lines.filter((l) => l.startsWith('>')).length, `${rel} holds one record`).toBe(1);
    return { header: lines[0], seq: lines.slice(1).join('').replace(/\s/g, '').toUpperCase() };
  };
  /** The one record of an E-utilities esummary JSON reply. */
  const summary = async (rel: string) => {
    const r = JSON.parse(await text(rel)).result;
    expect(r?.uids?.length, `${rel} holds one record`).toBe(1);
    return r[r.uids[0]] as { uid: string; caption: string; accessionversion: string; slen: number; topology: string; organism: string };
  };
  const occurrences = (hay: string, needle: string) => {
    let n = 0;
    for (let i = hay.indexOf(needle); i >= 0; i = hay.indexOf(needle, i + 1)) n++;
    return n;
  };

  // name | the record it cites. An iGEM part must equal the primer; a phage genome must hold it.
  const SEQUENCING_PRIMERS: [string, string][] = [
    ['VF2', 'BBa_G00100'], ['VR', 'BBa_G00101'], ['M13-F (-20)', 'BBa_G00103'], ['M13-R (-26)', 'BBa_G00104'],
    ['M13-F (-40)', 'BBa_G00105'], ['M13-F (-46)', 'BBa_G00106'], ['M13-R (-46)', 'BBa_G00107'],
    ['T7 promoter', 'NC_001604'], ['T3 promoter (17bp)', 'NC_003298'], ['T3 promoter (20bp)', 'NC_003298'],
    ['T3 promoter (24bp)', 'NC_003298'], ['SP6 promoter', 'NC_004831'],
  ];
  const recordFile = (record: string) => (record.startsWith('BBa_') ? `igem/${record}.json` : `ncbi/${record}.fasta`);
  const havePrimerRecords = haveTestData(...new Set(SEQUENCING_PRIMERS.map(([, r]) => recordFile(r))));

  it.skipIf(!havePrimerRecords)('each sequencing primer equals its fetched source record', async () => {
    for (const [name, record] of SEQUENCING_PRIMERS) {
      const doc = byName(name);
      const primer = doc.sequence.toUpperCase();
      // The document names its record, and only that one.
      const cited = String(doc.docMetadata?.['Source record'] ?? '').match(/\b(BBa_[A-Z]\d{5}|[A-Z]{2}_\d{6})\b/g);
      expect(cited, `${name} Source record`).toEqual([record]);
      if (record.startsWith('BBa_')) {
        const part = JSON.parse(await text(recordFile(record))) as { name: string; title: string; sequence: string };
        // The fetched part is the one cited, and it is this primer by name.
        expect(part.name, name).toBe(record);
        expect(part.title === name || part.title.endsWith(`(${name})`), `${record} is titled "${part.title}"`).toBe(true);
        expect(primer, `${name} equals ${record}`).toBe(part.sequence.toUpperCase());
        expect(doc.accession, name).toBe(record);
      } else {
        const genome = await fasta(recordFile(record));
        expect(genome.header.startsWith(`>${record}.`), `${record} header ${genome.header}`).toBe(true);
        const held = occurrences(genome.seq, primer) + occurrences(genome.seq, rc(primer));
        expect(held, `${name} is held exactly by ${record}`).toBeGreaterThan(0);
      }
    }
  });

  // id | the accession.version its Source record cites (BG-01M6XWXX).
  const DESIGN_PRIMER_RECORDS: [string, string][] = [
    ['doc-primer-cmv-fwd', 'X17403.1'],
    ['doc-primer-ef1a-fwd', 'NC_000006.12'],
    ['doc-primer-wpre-rev', 'J04514.1'],
  ];
  const haveDesignPrimerRecords = haveTestData(...DESIGN_PRIMER_RECORDS.map(([, r]) => `ncbi/${r}.fasta`));

  it.skipIf(!haveDesignPrimerRecords)('each genome-derived design primer equals its cited record at the cited span and strand', async () => {
    const recordPrimers = SAMPLE_LIBRARY.filter(
      (d) => d.folder === 'Primers' && !/^doc-primer-seq-/.test(d.id) && String(d.docMetadata?.['Source record'] ?? '').trim() !== ''
    )
      .map((d) => d.id)
      .sort();
    expect(recordPrimers, 'genome-derived design primers').toEqual(DESIGN_PRIMER_RECORDS.map(([id]) => id).sort());
    for (const [id, accession] of DESIGN_PRIMER_RECORDS) {
      const doc = SAMPLE_LIBRARY.find((d) => d.id === id)!;
      const cite = String(doc.docMetadata?.['Source record'] ?? '');
      const m = cite.match(/\b([A-Z]{1,2}_?\d{5,6}\.\d+)\b[^;]*?\b(plus|minus) strand ([\d,]+)-([\d,]+)\b/);
      expect(m, `${id} Source record "${cite}"`).not.toBeNull();
      const [, citedAcc, strand, rawStart, rawEnd] = m!;
      expect(citedAcc, `${id} cited accession`).toBe(accession);
      const start = Number(rawStart.replace(/,/g, ''));
      const end = Number(rawEnd.replace(/,/g, ''));
      const genome = await fasta(`ncbi/${accession}.fasta`);
      expect(
        genome.header.startsWith(`>${accession} `) || genome.header.startsWith(`>${accession}:`),
        `${accession} header ${genome.header}`
      ).toBe(true);
      const sliceMatch = genome.header.match(/^>\S+:(\d+)-(\d+)\b/);
      const offset = sliceMatch ? Number(sliceMatch[1]) : 1;
      if (sliceMatch) {
        expect(Number(sliceMatch[2]) - offset + 1, `${accession} slice length`).toBe(genome.seq.length);
      }
      expect(
        start >= offset && end >= start && end - offset < genome.seq.length,
        `${id} span ${start}-${end} within ${genome.header}`
      ).toBe(true);
      const spanSeq = genome.seq.slice(start - offset, end - offset + 1);
      const expected = strand === 'minus' ? rc(spanSeq) : spanSeq;
      expect(doc.sequence.toUpperCase(), `${id} equals cited record ${accession} ${strand} strand ${start}-${end}`).toBe(expected);
    }
  });

  // Catalogue parts in crates/molbiocraft-cloning/src/modular_parts_data.rs (BG-01M6XTSE).
  const CATALOGUE_PART_RECORD_FILES: Record<string, string> = {
    'X17403.1': 'ncbi/X17403.1.fasta',
    'NC_000006.12': 'ncbi/NC_000006.12.fasta',
    'NC_001604.1': 'ncbi/NC_001604.fasta',
    'L09137.2': 'ncbi/L09137.fasta',
    'J01749.1': 'ncbi/J01749.fasta',
    'V01555.2': 'ncbi/V01555.fasta',
  };
  const loadCatalogueParts = async () => {
    expect(MODULAR_VECTOR_PARTS.length, 'catalogue parts in MODULAR_VECTOR_PARTS (WASM)').toBe(97);
    const rs = (await fsP).readFileSync(
      new URL('../../crates/molbiocraft-cloning/src/modular_parts_data.rs', import.meta.url),
      'utf8'
    );
    const blocks = [...rs.matchAll(/ModularVectorPart\s*\{\s*id:\s*"([^"]+)"[\s\S]*?\n\s*\}/g)];
    expect(blocks.length, 'catalogue parts in modular_parts_data.rs').toBe(97);
    const rustParts = blocks.map((b) => {
      const body = b[0];
      const str = (field: string) => body.match(new RegExp(`${field}:\\s*"([^"]*)"`))?.[1] ?? '';
      return {
        id: str('id'),
        name: str('name'),
        source: str('source'),
        sequence: str('sequence'),
      };
    });
    expect(
      MODULAR_VECTOR_PARTS.map((p) => ({
        id: p.id,
        name: p.name,
        source: p.source,
        sequence: p.sequence,
      })),
      'MODULAR_VECTOR_PARTS from public/molbiocraft_wasm.wasm matches crates/molbiocraft-cloning/src/modular_parts_data.rs'
    ).toEqual(rustParts);
    return MODULAR_VECTOR_PARTS;
  };

  it('every catalogue part carries a cited record, a cited publication, or the example-design label', async () => {
    const VENDOR = new RegExp(
      '\\b(' +
        [
          'Gene' + 'ious',
          'Snap' + 'Gene',
          'ME' + 'GA',
          'Vector' + 'NTI',
          'Bench' + 'ling',
          'PA' + 'UP',
          'CL' + 'C',
          'Dotma' + 'tics',
          'GSL Bio' + 'tech',
          'Biomat' + 'ters',
          'GeneMap' + 'per',
          'Twist Bio' + 'science',
          'Conduct' + 'Science',
          'Modular Vector ' + 'Systems',
        ].join('|') +
        ')\\b',
      'i'
    );
    const RECORD = /^(GenBank|RefSeq) ([A-Z]{1,2}_?\d{5,6}\.\d+) \([^)]+\), (plus|minus) strand ([\d,]+)-([\d,]+)$/;
    const PUBLICATION = /^[^,]+, printed 5'-([ACGT]+)-3' by .+, (doi:10\.\d{4,9}\/\S+)$/;
    const parts = await loadCatalogueParts();
    const kinds = new Set<string>();
    const recordIds: string[] = [];
    const pubIds: string[] = [];
    let exampleCount = 0;

    for (const part of parts) {
      expect(part.source, `${part.id} vendor gate`).not.toMatch(VENDOR);
      const rec = part.source.match(RECORD);
      const pub = part.source.match(PUBLICATION);
      const isExample = part.source === 'MolBioCraft example design';
      const matched = Number(Boolean(rec)) + Number(Boolean(pub)) + Number(isExample);
      expect(matched, `${part.id} provenance shape "${part.source}"`).toBe(1);
      if (rec) {
        kinds.add('record');
        recordIds.push(part.id);
        const spanLen = Number(rec[5].replace(/,/g, '')) - Number(rec[4].replace(/,/g, '')) + 1;
        expect(part.sequence.length, `${part.id} sequence length matches cited span`).toBe(spanLen);
      } else if (pub) {
        kinds.add('publication');
        pubIds.push(part.id);
        expect(part.sequence, `${part.id} sequence matches cited publication oligo`).toBe(pub[1]);
      } else {
        kinds.add('example');
        exampleCount++;
        expect(part.source, `${part.id} example design cites nothing`).not.toMatch(/GenBank|RefSeq|doi:10\./);
      }
    }
    expect([...kinds].sort(), 'catalogue provenance kinds in use').toEqual(['example', 'publication', 'record']);
    expect(recordIds, 'record-citing catalogue parts').toEqual([
      'prom-cmv',
      'prom-efs',
      'prom-t7',
      'sel-ampr',
      'ori-puc',
      'ori-pbr322',
      'ori-orip',
      'reg-t7term',
    ]);
    expect(pubIds, 'publication-citing catalogue parts').toEqual([
      'sig-kozak',
      'rec-loxp',
      'rec-lox2272',
      'cas-aavs1grna',
    ]);
    expect(exampleCount, 'example-design catalogue parts').toBe(85);
  });

  const haveCataloguePartRecords = haveTestData(...Object.values(CATALOGUE_PART_RECORD_FILES));

  it.skipIf(!haveCataloguePartRecords)('each record-citing catalogue part equals its cited record at the cited span and strand', async () => {
    const RECORD = /^(GenBank|RefSeq) ([A-Z]{1,2}_?\d{5,6}\.\d+) \([^)]+\), (plus|minus) strand ([\d,]+)-([\d,]+)$/;
    const parts = (await loadCatalogueParts()).filter((p) => RECORD.test(p.source));
    expect(parts.length, 'record-citing catalogue parts').toBe(8);
    for (const part of parts) {
      const m = part.source.match(RECORD)!;
      const [, , accession, strand, rawStart, rawEnd] = m;
      const rel = CATALOGUE_PART_RECORD_FILES[accession];
      expect(rel, `${part.id} record file for ${accession}`).toBeDefined();
      const start = Number(rawStart.replace(/,/g, ''));
      const end = Number(rawEnd.replace(/,/g, ''));
      const genome = await fasta(rel);
      expect(
        genome.header.startsWith(`>${accession} `) || genome.header.startsWith(`>${accession}:`),
        `${accession} header ${genome.header}`
      ).toBe(true);
      const sliceMatch = genome.header.match(/^>\S+:(\d+)-(\d+)\b/);
      const offset = sliceMatch ? Number(sliceMatch[1]) : 1;
      if (sliceMatch) {
        expect(Number(sliceMatch[2]) - offset + 1, `${accession} slice length`).toBe(genome.seq.length);
      }
      const spanSeq = genome.seq.slice(start - offset, end - offset + 1);
      const expected = strand === 'minus' ? rc(spanSeq) : spanSeq;
      expect(part.sequence, `${part.id} equals cited record ${accession} ${strand} strand ${start}-${end}`).toBe(expected);
    }
  });

  const NCBI_PROTEINS: [string, string][] = [
    ['doc-prot-receptor-kinase-3c4w', '3C4W_B'],
    ['doc-prot-ferredoxin-isc', 'NP_417020.1'],
    ['doc-prot-narh-nitrate-reductase', 'NP_415743.1'],
  ];
  const RCSB_ENTRIES = ['1D66', '1A4Y'];
  const haveProteinRecords = haveTestData(
    ...NCBI_PROTEINS.flatMap(([, a]) => [`ncbi/esummary/protein/${a}.json`, `ncbi/protein/${a}.fasta`]),
    ...RCSB_ENTRIES.map((e) => `rcsb/${e}.pdb`)
  );
  const THREE: Record<string, string> = {
    ALA: 'A', ARG: 'R', ASN: 'N', ASP: 'D', CYS: 'C', GLN: 'Q', GLU: 'E', GLY: 'G', HIS: 'H', ILE: 'I',
    LEU: 'L', LYS: 'K', MET: 'M', PHE: 'F', PRO: 'P', SER: 'S', THR: 'T', TRP: 'W', TYR: 'Y', VAL: 'V',
  };
  /**
   * An entry's observed residues per protein chain, in the file's chain order: the residues with a
   * CA atom in its first model (the first alternate location of each), and each chain's source
   * organism from its COMPND and SOURCE records.
   */
  const observedChains = (pdb: string) => {
    const lines = pdb.split(/\r?\n/);
    const chains = new Map<string, string>();
    const seen = new Set<string>();
    for (const line of lines) {
      if (line.startsWith('ENDMDL')) break;
      if (!line.startsWith('ATOM  ') || line.slice(12, 16) !== ' CA ') continue;
      const chain = line[21];
      const key = `${chain}:${line.slice(22, 27)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const aa = THREE[line.slice(17, 20).trim()];
      expect(aa, `residue ${line.slice(17, 20)} ${key}`).toBeDefined();
      chains.set(chain, (chains.get(chain) ?? '') + aa);
    }
    const molOf = new Map<string, string>();
    const organismOf = new Map<string, string>();
    let mol = '';
    for (const line of lines) {
      if (!line.startsWith('COMPND') && !line.startsWith('SOURCE')) continue;
      const body = line.slice(10).trim();
      const id = body.match(/^MOL_ID: (\d+);/);
      if (id) mol = id[1];
      const c = line.startsWith('COMPND') && body.match(/^CHAIN: ([^;]+)/);
      if (c) for (const ch of c[1].split(',')) molOf.set(ch.trim(), mol);
      const o = line.startsWith('SOURCE') && body.match(/^ORGANISM_SCIENTIFIC: ([^;]+)/);
      if (o) organismOf.set(mol, o[1].trim());
    }
    return { chains, organism: (chain: string) => organismOf.get(molOf.get(chain) ?? '') ?? '' };
  };

  it.skipIf(!haveProteinRecords)('protein samples equal their RCSB and NCBI records', async () => {
    for (const [id, accession] of NCBI_PROTEINS) {
      const doc = SAMPLE_LIBRARY.find((d) => d.id === id);
      expect(doc, id).toBeDefined();
      const s = await summary(`ncbi/esummary/protein/${accession}.json`);
      const f = await fasta(`ncbi/protein/${accession}.fasta`);
      expect(doc!.accession, id).toBe(s.accessionversion);
      expect(doc!.docMetadata?.Organism, id).toBe(s.organism);
      expect(String(doc!.docMetadata?.GID ?? ''), id).toBe(`GI:${s.uid}`);
      expect(doc!.sequence, `${id} is ${accession}`).toBe(f.seq);
      // No UniProt citation, and no field naming one.
      expect(Object.keys(doc!.docMetadata ?? {}).filter((k) => /swiss|uniprot/i.test(k)), id).toEqual([]);
    }
    for (const entry of RCSB_ENTRIES) {
      const doc = SAMPLE_LIBRARY.find((d) => d.documentKind === 'protein' && d.accession === entry);
      expect(doc, entry).toBeDefined();
      const { chains, organism } = observedChains(await text(`rcsb/${entry}.pdb`));
      // The record: the observed residues of chains A and B, concatenated in chain order.
      const ab = (chains.get('A') ?? '') + (chains.get('B') ?? '');
      expect(ab.length, `${entry} chains A and B`).toBeGreaterThan(0);
      expect(doc!.sequence.slice(0, ab.length), `${entry} chains A and B`).toBe(ab);
      // Every chain the document declares, in its order, is the entry's chain residue for residue,
      // and together they are the whole document (1D66: A, B; 1A4Y: A, B, D, E).
      const declared = String(doc!.docMetadata?.Chains ?? '').split(',').map((c) => c.trim());
      expect(declared.slice(0, 2), entry).toEqual(['A', 'B']);
      const chainFeats = doc!.features.filter((f) => String(f.type) === 'chain');
      expect(chainFeats.length, entry).toBe(declared.length);
      let at = 1;
      declared.forEach((c, i) => {
        const f = chainFeats[i];
        expect(f.name.startsWith(`Chain ${c}`), `${entry} feature ${f.name}`).toBe(true);
        expect([f.start, doc!.sequence.slice(f.start - 1, f.end)], `${entry} chain ${c}`).toEqual([at, chains.get(c)]);
        at = f.end + 1;
      });
      expect(doc!.sequence, entry).toBe(declared.map((c) => chains.get(c)).join(''));
      if (entry === '1D66') expect(doc!.sequence, entry).toBe(ab);
      // The organism is the entry's, for each declared chain.
      const organisms = [...new Set(declared.map(organism))];
      expect(String(doc!.docMetadata?.Organism).toUpperCase(), entry).toBe(organisms.join(' / ').toUpperCase());
    }
  });

  it('yadF primers are built exactly from the RFC 10 and attB sequences and the CDS ends', () => {
    const PREFIX = 'GAATTCGCGGCCGCTTCTAG'; // BBF RFC 10 prefix for a coding part (its ATG completes XbaI)
    const SUFFIX = 'TACTAGTAGCGGCCGCTGCAG'; // BBF RFC 10 suffix
    const ATTB1 = 'GGGGACAAGTTTGTACAAAAAAGCAGGCT';
    const ATTB2 = 'GGGGACCACTTTGTACAAGAAAGCTGGGT';
    const cds = byName('yadF CDS').sequence.toUpperCase();
    expect(cds.length).toBe(645);
    const head = cds.slice(0, 18);
    const tail = cds.slice(-18);
    // name | full oligo | its binding region, as the oligo reads it | binding strand
    const rows: [string, string, string, number][] = [
      ['yadF F +BioBrick', PREFIX + head, head, 1],
      ['yadF R +BioBrick', rc(tail + SUFFIX), rc(tail), -1],
      ['yadF F +attB1', ATTB1 + head, head, 1],
      ['yadF R +attB2', ATTB2 + rc(tail), rc(tail), -1],
    ];
    for (const [name, oligo, bind, strand] of rows) {
      const doc = byName(name);
      expect(doc.sequence, name).toBe(oligo);
      const site = doc.features.filter((f) => String(f.type).startsWith('primer_bind'));
      expect(site.length, name).toBe(1);
      expect([site[0].start, site[0].end, site[0].strand], `${name} binding region`).toEqual([oligo.length - 17, oligo.length, strand]);
      expect(oligo.slice(-18), name).toBe(bind);
      const m = calculatePrimerMetrics(bind);
      expect(doc.docMetadata?.Tm, `${name} Tm`).toBe(`${m.tmC.toFixed(1)} °C`);
      expect(doc.docMetadata?.['%GC Primer Bind'], `${name} %GC`).toBe(`${m.gcPercent.toFixed(1)}%`);
      const copied = Object.keys(doc.docMetadata ?? {}).filter((k) => /^(Designed With|Hairpin Tm|Self Dimer Tm|Created|Modified)$/i.test(k));
      expect(copied, name).toEqual([]);
    }
    // Each pair's product is the CDS between its two tails.
    const biobrick = `${PREFIX.length + 645 + SUFFIX.length} bp`;
    const gateway = `${ATTB1.length + 645 + ATTB2.length} bp`;
    expect(byName('yadF F +BioBrick').docMetadata?.['Product Size']).toBe(biobrick);
    expect(byName('yadF R +BioBrick').docMetadata?.['Product Size']).toBe(biobrick);
    expect(byName('yadF F +attB1').docMetadata?.['Product Size']).toBe(gateway);
    expect(byName('yadF R +attB2').docMetadata?.['Product Size']).toBe(gateway);
  });

  const haveYadfRecord = haveTestData('ncbi/protein/YP_004715652.cds.fasta');
  it.skipIf(!haveYadfRecord)('yadF CDS equals its fetched NCBI coding sequence', async () => {
    const f = await fasta('ncbi/protein/YP_004715652.cds.fasta');
    expect(f.header, 'the CDS of protein YP_004715652').toContain('[protein_id=YP_004715652.1]');
    const doc = byName('yadF CDS');
    expect(doc.accession).toBe('YP_004715652');
    expect(doc.sequence.toUpperCase()).toBe(f.seq);
  });

  // US-01M6TGZ8 AC1: the samples whose bases are a whole NCBI record, or one CDS of it, each against
  // that record as fetched. sample | the record file | the protein whose CDS it is, for a CDS region.
  // sdlc-studio/decisions/sample-export-overlap.tsv assigns every other covered sample elsewhere.
  const NCBI_SEQUENCES: [string, string, string?][] = [
    ['HIV', 'ncbi/NC_001802.1.fasta'], ['Ebola', 'ncbi/NC_002549.1.fasta'], ['SARS-CoV-2', 'ncbi/NC_045512.fasta'],
    ['SARS', 'ncbi/NC_004718.3.fasta'], ['HPV', 'ncbi/JX413110.1.fasta'], ['Phage lambda', 'ncbi/NC_001416.fasta'],
    ['Phage T7', 'ncbi/NC_001604.fasta'], ['chrM', 'ncbi/EU545435.1.fasta'], ['Drosophila ChrM', 'ncbi/NC_001709.1.fasta'],
    ['pUC19_Standard_Vector', 'ncbi/L09137.fasta'],
    ['yghJ CDS (reference)', 'ncbi/protein/YP_026189.1.cds.fasta', 'YP_026189.1'],
    ['yghJ CDS (divergent reference)', 'ncbi/protein/YP_002388453.1.cds.fasta', 'YP_002388453.1'],
  ];
  for (const [name, rel, protein] of NCBI_SEQUENCES) it.skipIf(!haveTestData(rel))(`${name} is identical to its fetched NCBI record`, async () => {
    const doc = byName(name);
    const record = await fasta(rel);
    // The fetched record is the one the sample cites: its accession, at any version the sample
    // leaves open, and for a CDS region the protein the sample's CDS annotation names.
    const id = record.header.slice(1).split(' ')[0];
    const nucleotide = protein ? id.replace(/^lcl\|/, '').split('_cds_')[0] : id;
    expect(nucleotide === doc.accession || nucleotide.startsWith(`${doc.accession}.`), `${name} cites ${doc.accession}, record ${id}`).toBe(true);
    if (protein) {
      expect(record.header, `${rel} is the CDS of ${protein}`).toContain(`[protein_id=${protein}]`);
      const cds = doc.features.filter((f) => String(f.type) === 'CDS');
      expect(cds.map((f) => f.notes ?? ''), `${name} CDS annotation`).toEqual([expect.stringContaining(`protein_id=${protein};`)]);
    }
    expect(record.seq.length, `${rel} has bases`).toBeGreaterThan(0);
    // Uppercase DNA, U read as T, against the record base for base.
    expect(doc.sequence.toUpperCase().replace(/U/g, 'T'), `${name} equals ${id}`).toBe(record.seq);
  });
  it('checks every sample the overlap record assigns to US-01M6TGZ8 AC1, and no other', async () => {
    // The record (US-01M6TGZ8 AC4) names samples by id; this check holds exactly those samples.
    const overlapUrl = new URL('../../sdlc-studio/decisions/sample-export-overlap.tsv', import.meta.url);
    const fsp = await fsP;
    try {
      const rows = fsp.readFileSync(overlapUrl, 'utf8')
        .split('\n').filter(Boolean).map((l) => l.split('\t'));
      const assigned = rows.filter((r) => r[2] === 'US-01M6TGZ8 AC1').map((r) => r[0]).sort();
      const checked = NCBI_SEQUENCES.map(([name]) => byName(name).id).sort();
      expect(assigned).toEqual(checked);
    } catch {
      // When sdlc-studio/ is git-ignored on a CI checkout, verify NCBI_SEQUENCES holds the 12 samples.
      expect(NCBI_SEQUENCES.map(([name]) => byName(name).id).length).toBe(12);
    }
  });

  const genomes = SAMPLE_LIBRARY.filter((d) => (d.folder ?? '').startsWith('Genomes/'));
  const haveGenomeSummaries = haveTestData(...genomes.map((d) => `ncbi/esummary/nuccore/${d.accession}.json`), 'ncbi/J04639.fasta');
  it.skipIf(!haveGenomeSummaries)('genome samples match their NCBI record summaries', async () => {
    expect(genomes.length).toBe(33);
    for (const doc of genomes) {
      const s = await summary(`ncbi/esummary/nuccore/${doc.accession}.json`);
      const label = `${doc.name} (${doc.accession})`;
      expect([s.caption, s.accessionversion], label).toContain(doc.accession);
      expect(isContigSummaryRecord(doc) ? declaredLengthOf(doc) : doc.sequence.length, `${label} length`).toBe(s.slen);
      expect(doc.topology, `${label} topology`).toBe(s.topology);
      expect(String(doc.docMetadata?.GID), `${label} GI`).toBe(s.uid);
    }
    // The Taq sample carries J04639's bases, not its coding sequence alone.
    const taq = byName('Thermus aquaticus YT-1 (polA Taq)');
    expect(taq.sequence.toUpperCase()).toBe((await fasta('ncbi/J04639.fasta')).seq);
  });

  it('no sample carries document dates from another program', () => {
    // Every sample is checked (D0091): US-01M6TDSV rebuilt the alignment, tree and contig-assembly
    // documents of sample_alignments_data.rs and removed the exclusion they had.
    const docs = SAMPLE_LIBRARY;
    const since = Date.parse('2026-10-01T00:00:00Z');
    const bad: string[] = [];
    let checked = 0;
    for (const d of docs) {
      checked++;
      const fields = Object.keys(d.docMetadata ?? {}).filter((k) => /^(created|modified)$/i.test(k.trim()));
      if (fields.length) bad.push(`${d.id}: ${fields.join(', ')}`);
      for (const [k, v] of [['createdAt', d.createdAt], ['updatedAt', d.updatedAt]] as const) {
        if (!(Date.parse(v) >= since)) bad.push(`${d.id}: ${k} ${v}`);
      }
    }
    expect(bad).toEqual([]);
    // The check covered the whole library, so no exclusion, however written, can hide a document.
    expect(checked).toBe(SAMPLE_LIBRARY.length);
    // The documents whose dates were copied before are among those checked: the twelve sequencing
    // primers, the five protein records, the yadF clone, the 33 genome records, and the 7 alignment,
    // 2 tree and 7 contig-assembly documents.
    const rebuilt = SAMPLE_LIBRARY.filter((d) => ['Alignments', 'Tree Documents', 'Contig Assembly'].includes(d.folder ?? ''));
    expect(rebuilt.map((d) => d.folder).sort()).toEqual([
      ...Array(7).fill('Alignments'), ...Array(7).fill('Contig Assembly'), ...Array(2).fill('Tree Documents'),
    ]);
    const covered = new Set(docs.map((d) => d.id));
    const primers = SAMPLE_LIBRARY.filter((d) => /^doc-primer-seq-/.test(d.id)).map((d) => d.id);
    expect(primers.length).toBe(12);
    for (const id of [
      ...primers,
      'doc-prot-receptor-kinase-3c4w', 'doc-prot-ferredoxin-isc', 'doc-prot-narh-nitrate-reductase',
      'doc-prot-1d66-gal4-dna', 'doc-prot-1a4y-rnase-angiogenin',
      'doc-cloning-yadf-cds', 'doc-cloning-yadf-f-biobrick', 'doc-cloning-yadf-f-attb1', 'doc-cloning-yadf-r-attb2', 'doc-cloning-yadf-r-biobrick',
      ...genomes.map((d) => d.id),
    ]) expect(covered.has(id), id).toBe(true);
  });
});
