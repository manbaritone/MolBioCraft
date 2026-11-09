// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decideSessionReplacement,
  isSessionContentDirty,
  SessionContentSnapshot,
} from '../core/sessionGuard';
import {
  buildCommandDocumentContext,
  checkMultiDocumentSelection,
  commandAvailability,
  CommandContext,
  CommandId,
} from '../core/commandAvailability';
import {
  clearWorkbenchLocalAutosave,
  hasWorkbenchLocalAutosave,
  workbenchAutosaveNeedsRecovery,
  writeWorkbenchAutosaveDirtyFlag,
} from '../core/mbcSessionFormat';
import { sanitizeExportFilename, validateCrossPlatformFilename } from '../platform/osPlatform';
import { mountApp } from './appHarness';

/**
 * BG-01M6XPSR: the session-restore probes. The Rust session parser maps an unknown colour scheme to
 * 'standard' before App sees it, so to check App's own guard, the parser App calls is wrapped: while
 * `restoreProbe.colorScheme` is set, the envelope it returns carries that value as the workspace's
 * colour scheme. The sequence view is wrapped too, passing through, to record the colour scheme App
 * hands it.
 */
const restoreProbe = vi.hoisted(() => ({ colorScheme: null as string | null, drawn: [] as string[] }));
vi.mock('../core/mbcSessionFormat', async (importOriginal) => {
  const real = await importOriginal<typeof import('../core/mbcSessionFormat')>();
  return {
    ...real,
    parseMbcWorkbench: (...args: Parameters<typeof real.parseMbcWorkbench>) => {
      const parsed = real.parseMbcWorkbench(...args);
      if (restoreProbe.colorScheme === null) return parsed;
      const workspace = { ...parsed.envelope.workspace, colorScheme: restoreProbe.colorScheme as typeof parsed.envelope.workspace.colorScheme };
      return { ...parsed, envelope: { ...parsed.envelope, workspace } };
    },
  };
});
vi.mock('../components/LinearSequenceView', async (importOriginal) => {
  const real = await importOriginal<typeof import('../components/LinearSequenceView')>();
  const React = await import('react');
  const Recorded = (props: Parameters<typeof real.LinearSequenceView>[0]) => {
    restoreProbe.drawn.push(String(props.colorScheme));
    return React.createElement(real.LinearSequenceView, props);
  };
  return { ...real, LinearSequenceView: Recorded };
});

const snapshot = (overrides: Partial<SessionContentSnapshot> = {}): SessionContentSnapshot => ({
  documents: [],
  deletedDocIds: [],
  customFolders: [],
  folderNames: {},
  folderParents: {},
  sessionName: 'Session',
  ...overrides,
});

describe('session data-loss guard', () => {
  it('treats the captured baseline as clean and any new content reference as modified', () => {
    const base = snapshot();
    expect(isSessionContentDirty(base, { ...base })).toBe(false);
    expect(isSessionContentDirty(base, { ...base, documents: [] })).toBe(true);
    expect(isSessionContentDirty(base, { ...base, deletedDocIds: ['x'] })).toBe(true);
    expect(isSessionContentDirty(base, { ...base, sessionName: 'Renamed' })).toBe(true);
    expect(isSessionContentDirty(null, base)).toBe(false);
  });

  it('asks before discarding unsaved work, then before discarding an unrecovered autosave', () => {
    expect(decideSessionReplacement({ hasUnsavedChanges: false, pendingAutosaveRecovery: false }).kind).toBe('proceed');
    expect(decideSessionReplacement({ hasUnsavedChanges: true, pendingAutosaveRecovery: false }).kind).toBe(
      'confirm-unsaved-changes'
    );
    expect(decideSessionReplacement({ hasUnsavedChanges: false, pendingAutosaveRecovery: true }).kind).toBe(
      'confirm-discard-autosave'
    );
    // Unsaved in-memory work is the more important loss and is asked about first.
    expect(decideSessionReplacement({ hasUnsavedChanges: true, pendingAutosaveRecovery: true }).kind).toBe(
      'confirm-unsaved-changes'
    );
  });
});

describe('autosave recovery flag', () => {
  const store = new Map<string, string>();
  const g = globalThis as unknown as { localStorage?: Storage };
  let original: Storage | undefined;
  beforeEach(() => {
    original = g.localStorage;
    store.clear();
    g.localStorage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => void store.set(k, String(v)),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    } as Storage;
  });
  afterEach(() => {
    g.localStorage = original;
  });

  it('only flags an autosave that may hold unsaved work', () => {
    expect(workbenchAutosaveNeedsRecovery()).toBe(false);
    store.set('molbiocraft.workbench.autosave.v1', '{"format":"mbc"}');
    expect(hasWorkbenchLocalAutosave()).toBe(true);
    // Autosaves written before the flag existed are treated as unsaved.
    expect(workbenchAutosaveNeedsRecovery()).toBe(true);
    writeWorkbenchAutosaveDirtyFlag(false);
    expect(workbenchAutosaveNeedsRecovery()).toBe(false);
    writeWorkbenchAutosaveDirtyFlag(true);
    expect(workbenchAutosaveNeedsRecovery()).toBe(true);
    clearWorkbenchLocalAutosave();
    expect(hasWorkbenchLocalAutosave()).toBe(false);
    expect(workbenchAutosaveNeedsRecovery()).toBe(false);
    expect(store.size).toBe(0);
  });
});

const dna = { id: 'd1', moleculeType: 'DNA' as const, topology: 'circular' as const, sequence: 'ACGTACGT' };
const linearDna = { ...dna, id: 'd2', topology: 'linear' as const };
const rna = { ...dna, id: 'r1', moleculeType: 'RNA' as const, topology: 'linear' as const, sequence: 'ACGU' };
const protein = { id: 'p1', moleculeType: 'Protein' as const, topology: 'linear' as const, sequence: 'MKT' };

const ctx = (overrides: Partial<CommandContext> = {}): CommandContext => ({
  sessionActive: true,
  activeDoc: buildCommandDocumentContext(dna),
  selection: { start: 3, end: 3 },
  undoDepth: 0,
  redoDepth: 0,
  ...overrides,
});

describe('command availability state matrix', () => {
  // Each row: [state label, context, expected enabled per command]
  const commands: CommandId[] = [
    'undo',
    'redo',
    'strand-transform',
    'convert-dna-rna',
    'set-origin',
    'nucleotide-analysis',
    'document-edit',
    'export-active-document',
    'export-sequence',
  ];
  const matrix: Array<[string, CommandContext, Record<CommandId, boolean>]> = [
    [
      'no session',
      ctx({ sessionActive: false, undoDepth: 3, redoDepth: 1 }),
      { undo: false, redo: false, 'strand-transform': false, 'convert-dna-rna': false, 'set-origin': false, 'nucleotide-analysis': false, 'document-edit': false, 'export-active-document': false, 'export-sequence': false },
    ],
    [
      'blank session (no documents)',
      ctx({ activeDoc: buildCommandDocumentContext({ id: '', moleculeType: 'DNA', topology: 'linear', sequence: '' }), selection: null }),
      { undo: false, redo: false, 'strand-transform': false, 'convert-dna-rna': false, 'set-origin': false, 'nucleotide-analysis': false, 'document-edit': false, 'export-active-document': false, 'export-sequence': false },
    ],
    [
      'circular DNA with cursor and history',
      ctx({ undoDepth: 2, redoDepth: 1 }),
      { undo: true, redo: true, 'strand-transform': true, 'convert-dna-rna': true, 'set-origin': true, 'nucleotide-analysis': true, 'document-edit': true, 'export-active-document': true, 'export-sequence': true },
    ],
    [
      'circular DNA without a selection',
      ctx({ selection: null }),
      { undo: false, redo: false, 'strand-transform': true, 'convert-dna-rna': true, 'set-origin': false, 'nucleotide-analysis': true, 'document-edit': true, 'export-active-document': true, 'export-sequence': true },
    ],
    [
      'linear DNA',
      ctx({ activeDoc: buildCommandDocumentContext(linearDna) }),
      { undo: false, redo: false, 'strand-transform': true, 'convert-dna-rna': true, 'set-origin': false, 'nucleotide-analysis': true, 'document-edit': true, 'export-active-document': true, 'export-sequence': true },
    ],
    [
      'RNA',
      ctx({ activeDoc: buildCommandDocumentContext(rna) }),
      { undo: false, redo: false, 'strand-transform': true, 'convert-dna-rna': true, 'set-origin': false, 'nucleotide-analysis': true, 'document-edit': true, 'export-active-document': true, 'export-sequence': true },
    ],
    [
      'protein',
      ctx({ activeDoc: buildCommandDocumentContext(protein) }),
      { undo: false, redo: false, 'strand-transform': false, 'convert-dna-rna': false, 'set-origin': false, 'nucleotide-analysis': false, 'document-edit': true, 'export-active-document': true, 'export-sequence': true },
    ],
  ];

  for (const [label, context, expected] of matrix) {
    it(`state: ${label}`, () => {
      for (const id of commands) {
        const result = commandAvailability(id, context);
        expect({ id, enabled: result.enabled }).toEqual({ id, enabled: expected[id] });
        if (!result.enabled) {
          // Every disabled state carries a user-facing reason.
          expect(result.reason, `${id} reason`).toBeTruthy();
        }
      }
    });
  }

  it('multi-document operations need enough documents of one molecule class', () => {
    expect(checkMultiDocumentSelection([], 2).ok).toBe(false);
    expect(checkMultiDocumentSelection([dna], 2).ok).toBe(false);
    expect(checkMultiDocumentSelection([dna, rna], 2).ok).toBe(true);
    const mixed = checkMultiDocumentSelection([dna, protein], 2);
    expect(mixed.ok).toBe(false);
    expect(mixed.ok ? '' : mixed.reason).toMatch(/mixes/);
    expect(checkMultiDocumentSelection([protein, protein], 2).ok).toBe(true);
  });
});

describe('tag / protease detection filter', () => {
  it('uses the engine classification, not substrings of names and notes', async () => {
    const { isTagOrProteaseFeature } = await import('../core/commandAvailability');
    expect(isTagOrProteaseFeature({ type: 'tag' })).toBe(true);
    expect(isTagOrProteaseFeature({ type: 'protein_bind', cleavageSite: 'ENLYFQ/G' })).toBe(true);
    // KanR (notes mention "Kanamycin") and an EF1alpha promoter used to match "myc" / "ha".
    expect(isTagOrProteaseFeature({ type: 'CDS' })).toBe(false);
    expect(isTagOrProteaseFeature({ type: 'promoter' })).toBe(false);
    expect(isTagOrProteaseFeature({ type: 'protein_bind' })).toBe(false);
  });
});

describe('undo snapshots', () => {
  it('restore content but keep the folder the document was moved to', async () => {
    const { applyHistorySnapshot } = await import('../core/undoSnapshots');
    const snapshot = { id: 'd', name: 'old', sequence: 'ACGT', folder: 'Cloning' } as never;
    const current = { id: 'd', name: 'new', sequence: 'ACGTT', folder: 'Archive' } as never;
    const restored = applyHistorySnapshot(current, snapshot) as { sequence: string; folder: string; name: string };
    expect(restored.sequence).toBe('ACGT');
    expect(restored.name).toBe('old');
    expect(restored.folder).toBe('Archive');
  });
});

describe('annotation-only records', () => {
  it('can still be exported (GFF3 / GenBank / EMBL) although they have no sequence', () => {
    const base = { sessionActive: true, selection: null, undoDepth: 0, redoDepth: 0 };
    const summary = buildCommandDocumentContext({
      id: 'contig-summary',
      moleculeType: 'DNA',
      topology: 'linear',
      sequence: '',
      features: [{}, {}],
    });
    expect(commandAvailability('export-active-document', { ...base, activeDoc: summary }).enabled).toBe(true);
    // FASTA / Copy Sequence write residues, which an annotation-only record lacks.
    expect(commandAvailability('export-sequence', { ...base, activeDoc: summary }).enabled).toBe(false);
    const empty = buildCommandDocumentContext({ id: 'e', moleculeType: 'DNA', topology: 'linear', sequence: '', features: [] });
    expect(commandAvailability('export-active-document', { ...base, activeDoc: empty }).enabled).toBe(false);
  });
});

describe('export filename sanitisation', () => {
  it('turns data-derived names into names accepted on every OS', () => {
    const cases: Array<[string, string]> = [
      ['sp|P69905|HBA_HUMAN.fasta', 'sp_P69905_HBA_HUMAN.fasta'],
      ['chr1:100-200.gb', 'chr1_100-200.gb'],
      ['what?*<>.embl', 'what____.embl'],
      ['CON.gb', '_CON.gb'],
      ['trailing. .gff3', 'trailing.gff3'],
      ['', 'MolBioCraft_Export'],
      ['///.fasta', 'MolBioCraft_Export.fasta'],
    ];
    for (const [input, expected] of cases) {
      const out = sanitizeExportFilename(input);
      expect(out).toBe(expected);
      expect(() => validateCrossPlatformFilename(out, [], 'windows')).not.toThrow();
    }
  });

  it('keeps the extension when shortening names past the 255-byte limit', () => {
    const long = `${'α'.repeat(300)}.fasta`;
    const out = sanitizeExportFilename(long);
    expect(out.endsWith('.fasta')).toBe(true);
    expect(new TextEncoder().encode(out).byteLength).toBeLessThanOrEqual(255);
    expect(() => validateCrossPlatformFilename(out, [], 'linux')).not.toThrow();
  });
});

describe('imported document id allocation', () => {
  it('renames only colliding ids and keeps unique documents untouched', async () => {
    const { assignUniqueDocumentIds } = await import('../core/documentIds');
    const mk = (id: string) =>
      ({ id, name: id, sequence: 'ACGT' } as unknown as import('../types/bio').SequenceDocument);
    const a = mk('fasta-0-4');
    const b = mk('fasta-0-4');
    const c = mk('gb-x-4');
    const out = assignUniqueDocumentIds([a, b, c], ['fasta-0-4', 'fasta-0-4-2']);
    expect(out.map((d) => d.id)).toEqual(['fasta-0-4-3', 'fasta-0-4-4', 'gb-x-4']);
    expect(out[2]).toBe(c);
    expect(new Set(out.map((d) => d.id)).size).toBe(3);
    // Missing ids are never kept empty.
    expect(assignUniqueDocumentIds([mk('')], [])[0].id).toBe('doc-2');
  });
});

describe('strand transforms keep the molecule alphabet', () => {
  it('reverse-complements RNA with U, not T', async () => {
    const { reverseComplement } = await import('../core/bioEngine');
    expect(reverseComplement('AUGGCU', true)).toBe('AGCCAU');
    expect(reverseComplement('ATGGCT')).toBe('AGCCAT');
    expect(reverseComplement('AUGGCU', true)).not.toMatch(/T/);
  });
});

describe('import content validation', () => {
  it('rejects non-sequence text that the FASTA reader would otherwise accept', async () => {
    const { assessRawSequenceText, unsupportedImportReason } = await import('../core/fileParsers');
    expect(assessRawSequenceText('>seq1\nACGT\n').ok).toBe(true);
    expect(assessRawSequenceText('ACGTACGTACGTACGT\nACGTACGT').ok).toBe(true);
    expect(assessRawSequenceText('        1 atgaccatga ttacgccaag\n       21 cttgcatgcc tgcaggtcga').ok).toBe(true);
    expect(assessRawSequenceText('MKTAYIAKQRQISFVKSHFSRQ').ok).toBe(true);
    expect(assessRawSequenceText('').ok).toBe(false);
    expect(assessRawSequenceText('Lab notes: ligate the insert tomorrow, then transform.').ok).toBe(false);
    expect(assessRawSequenceText('the quick brown fox jumps over the lazy dog').ok).toBe(false);
    expect(assessRawSequenceText('##fileformat=VCFv4.2\n#CHROM\tPOS').ok).toBe(false);
    expect(assessRawSequenceText('ABIF\u0000\u0001binary').ok).toBe(false);
    expect(assessRawSequenceText('{"a": 1}').ok).toBe(false);
    // Grouped nucleotide text is a sequence however it is spaced (review finding).
    expect(assessRawSequenceText('ATG GCC AAA TTT GGG CCC TAA').ok).toBe(true);
    expect(assessRawSequenceText('ACGTA CGTAC GTACG TACGT').ok).toBe(true);
    expect(assessRawSequenceText('ACGT\nACGT').ok).toBe(true);
    expect(assessRawSequenceText(';comment line\nACGTACGTACGT').ok).toBe(true);
    expect(assessRawSequenceText("5'-ATGCGTACCTGA-3'").ok).toBe(true);
    // Short prose spelled from IUPAC letters is still prose.
    expect(assessRawSequenceText('A cat had a bad day').ok).toBe(false);
    // Codon-spaced degenerate primers (IUPAC ambiguity codes) are sequences.
    expect(assessRawSequenceText('ATG GAY CAR AAR').ok).toBe(true);
    expect(assessRawSequenceText('ATG CGT RYK NNN').ok).toBe(true);
    // (VCF, SAM and BAM import as variant features / a reference contig: importFormats.ts)
    for (const name of ['db.ma4', 'proteins.pa4', 'oligos.oa4', 'table.csv', 'x.json']) {
      expect(unsupportedImportReason(name), name).toMatch(/cannot be opened/);
    }
    for (const name of ['a.fasta', 'b.txt', 'c.gb', 'noext', 'calls.vcf', 'reads.SAM', 'reads.bam']) {
      expect(unsupportedImportReason(name), name).toBeNull();
    }
  });

  // US-01M6TDCD AC1: the proprietary plasmid, alignment and sequence-database file types are refused
  // by name with the open format to export to. Each group has its own export hint, so a message
  // shared across groups, a hint keyed on the wrong extension, or a name dropped from the message
  // each fails one line here; the open trace, sequence and alignment types stay importable.
  it('names the export format for each refused file type', async () => {
    const { unsupportedImportReason } = await import('../core/fileParsers');
    const refused = (name: string, hint: string) =>
      `"${name}" cannot be opened: MolBioCraft does not read this file type. ${hint}`;
    const SEQUENCE = 'Export the sequence as GenBank (.gb), EMBL or FASTA and open that file.';
    const ALIGNMENT = 'Export the alignment as FASTA, NEXUS or PHYLIP and open that file.';
    const RECORDS = 'Export the records as GenBank and open those files.';
    const cases: [string, string][] = [
      ['pUC19.dna', SEQUENCE], ['KPYK1 ECOLI.prot', SEQUENCE], ['16S.rna', SEQUENCE], ['Construct.DNA', SEQUENCE],
      ['crab_rRNA.meg', ALIGNMENT],
      ['plasmids.ma4', RECORDS], ['proteins.pa4', RECORDS], ['oligos.oa4', RECORDS],
    ];
    for (const [name, hint] of cases) {
      expect(unsupportedImportReason(name), name).toBe(refused(name, hint));
    }
    for (const name of ['trace.ab1', 'trace.abi', 'trace.scf', 'run.fsa', 'pUC19.gb', 'reads.fasta', 'aln.nex', 'aln.phy']) {
      expect(unsupportedImportReason(name), name).toBeNull();
    }
  });
});

describe('flatfile import through the embedded Rust engine', () => {
  it('reads EMBL records with the EMBL reader and round-trips the app’s own EMBL export', async () => {
    const { parseEMBL, parseGenBank, exportToEMBL, looksLikeEmblRecord } = await import('../core/fileParsers');
    const gb = [
      'LOCUS       pRNA_vec               60 bp    DNA     circular SYN 01-JAN-2026',
      'DEFINITION  Round trip.',
      'ACCESSION   RT001',
      'FEATURES             Location/Qualifiers',
      '     CDS             complement(5..34)',
      '                     /gene="demo"',
      'ORIGIN',
      '        1 atgaccatga ttacgccaag cttgcatgcc tgcaggtcga ctctagagga tccccgggta',
      '//',
    ].join('\n');
    const original = parseGenBank(gb, 'x');
    expect(original.moleculeType).toBe('DNA'); // name contains "RNA" but the record is DNA
    expect(original.topology).toBe('circular');
    const embl = exportToEMBL(original);
    expect(looksLikeEmblRecord(embl)).toBe(true);
    const back = parseEMBL(embl, 'x');
    expect(back.sequence).toBe(original.sequence);
    expect(back.features.map((f) => [f.start, f.end, f.strand])).toEqual(
      original.features.map((f) => [f.start, f.end, f.strand])
    );
  });
});

describe('phylogeny input alignment detection', () => {
  it('does not treat equal-length unaligned sequences as an alignment', async () => {
    const { isPreAlignedInputSet, ALIGNED_MEMBER_METADATA_KEY } = await import('../core/documentViews');
    const raw = [{ sequence: 'ACGTACGTAC' }, { sequence: 'ACGTTCGTAA' }];
    expect(isPreAlignedInputSet(raw)).toBe(false);
    expect(isPreAlignedInputSet([{ sequence: 'ACG-ACGTAC' }, { sequence: 'ACGTTCGTAA' }])).toBe(true);
    const members = raw.map((d) => ({ ...d, docMetadata: { [ALIGNED_MEMBER_METADATA_KEY]: 1 } }));
    expect(isPreAlignedInputSet(members)).toBe(true);
    expect(isPreAlignedInputSet([{ sequence: 'ACG' }, { sequence: 'ACGT' }])).toBe(false);
  });
});

describe('contig statistics exclude quality-trimmed read ends', () => {
  it('maps trimmed read coordinates to alignment columns before masking', async () => {
    const { maskTrimmedReadRegions } = await import('../core/alignmentViewModel');
    // Read with 3 leading gaps; "Trimmed 1..2" covers the first two read bases.
    expect(maskTrimmedReadRegions('---ACGT-TA', [{ name: 'Trimmed', start: 1, end: 2 }])).toBe('-----GT-TA');
    // Internal gap: read bases 5..6 are columns 8..9.
    expect(maskTrimmedReadRegions('---ACGT-TA', [{ name: 'Trimmed', start: 5, end: 6 }])).toBe('---ACGT---');
    expect(maskTrimmedReadRegions('ACGT', [{ name: 'CDS', start: 1, end: 2 }])).toBe('ACGT');
  });

  // US-01M6TDSV AC6: the COI contig is MolBioCraft's Sanger assembly of two seeded simulated reads
  // (src/__tests__/sampleAssemblyReads.test.ts regenerates them). The value pinned is MolBioCraft's
  // pairwise identity of the contig's rows, which its quality pre-trim already cut back, so no
  // "Trimmed" region is left to mask; on those reads the simulated errors make it fall short of 100%.
  it('reproduces the reference pairwise identity of the COI contig sample', async () => {
    const { maskTrimmedReadRegions, meanPairwiseIdentity } = await import('../core/alignmentViewModel');
    const { SAMPLE_LIBRARY } = await import('../data/sampleLibrary');
    const contig = SAMPLE_LIBRARY.find((d) => d.id === 'doc-contig-coi-assembly');
    expect(contig, 'COI contig sample').toBeTruthy();
    expect(contig!.docMetadata?.Simulated, 'the contig is of simulated reads').toBe('yes');
    const members = contig!.alignmentMeta?.sequences ?? [];
    expect(members.map((m) => m.id).sort()).toEqual(['doc-contig-coi-fwd', 'doc-contig-coi-rev']);
    const masked = members.map((m) => maskTrimmedReadRegions(m.sequence, m.features ?? []));
    expect(masked).toEqual(members.map((m) => m.sequence));
    expect(meanPairwiseIdentity(masked)).toBe(99.6);
    // The value is of the trimmed reads: untrimmed, the reads would span the whole 760 bp
    // reference region; trimmed, the contig is 757 columns with 3 disagreements.
    expect(contig!.sequence.length).toBe(757);
    expect(contig!.docMetadata?.['# Disagreements']).toBe(3);
  });
});

describe('engine placeholder timestamps', () => {
  it('replaces the WASM placeholder date on new and edited documents only', async () => {
    const { stampEngineTimestamps, isEnginePlaceholderTimestamp } = await import('../core/engineTimestamps');
    const now = '2026-11-04T10:20:30.000Z';
    const base = {
      id: 'd', name: 'd', accession: '', description: '', moleculeType: 'DNA', topology: 'linear',
      sequence: 'ACGT', features: [], primers: [], folder: 'Local',
      createdAt: '2026-10-31T00:00:00.000Z', updatedAt: '2026-10-31T00:00:00Z',
      history: [{ id: 'h1', timestamp: '2026-10-31 00:00', operation: 'x', description: '', parentIds: [], lengthBp: 4, topology: 'linear' }],
    } as unknown as import('../types/bio').SequenceDocument;
    expect(isEnginePlaceholderTimestamp('2026-10-31')).toBe(true);
    expect(isEnginePlaceholderTimestamp('2025-01-02T00:00:00Z')).toBe(false);
    const fresh = stampEngineTimestamps(base, now);
    expect([fresh.createdAt, fresh.updatedAt, fresh.history[0].timestamp]).toEqual([now, now, '2026-11-04 10:20']);
    // Edit: original creation time and existing history are kept; the new entry is stamped.
    const prev = { ...fresh };
    const edited = stampEngineTimestamps(
      { ...fresh, createdAt: '2026-10-31T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z',
        history: [...fresh.history, { ...base.history[0], id: 'h2' }] },
      '2026-11-05T00:00:00.000Z',
      prev
    );
    expect(edited.createdAt).toBe(now);
    expect(edited.updatedAt).toBe('2026-11-05T00:00:00.000Z');
    expect(edited.history.map((h) => h.timestamp)).toEqual(['2026-11-04 10:20', '2026-11-05 00:00']);
  });
});

describe("BG-01M6XPSR: session restore checks the sequence view's colour scheme", () => {
  // Each check launches the App afresh.
  vi.setConfig({ testTimeout: 60_000 });

  const PLASMID = {
    id: 'xpsr-plasmid', name: 'XPSR Plasmid', accession: 'XPSR_0001', description: 'A plasmid built in the test',
    sequence: 'ATGGCTAGCAAGGAGGAACTGTTCACCGGCGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTG',
    moleculeType: 'DNA', topology: 'circular', folder: 'Local',
    createdAt: '2026-11-08T00:00:00Z', updatedAt: '2026-11-08T00:00:00Z', features: [], primers: [], history: [],
  } as unknown as import('../types/bio').SequenceDocument;

  /** Restores the plasmid on the sequence view with the parser's envelope carrying `colorScheme`, and returns the scheme the view is drawn in. */
  async function restoredScheme(colorScheme: string): Promise<string> {
    const app = await mountApp();
    try {
      restoreProbe.colorScheme = colorScheme;
      restoreProbe.drawn.length = 0;
      await app.restoreSession({ documents: [PLASMID], activeDocId: PLASMID.id, viewerTab: 'sequence-view' });
      expect(restoreProbe.drawn.length, 'the restored session draws the sequence view').toBeGreaterThan(0);
      return restoreProbe.drawn[restoreProbe.drawn.length - 1];
    } finally {
      restoreProbe.colorScheme = null;
      app.unmount();
    }
  }

  it('a session whose colour scheme is not a known nucleotide scheme opens with the default', async () => {
    // Wrong implementation this fails: App setting the restored workspace's colour scheme unchecked,
    // so a value the session parser let through reaches the sequence view.
    expect(await restoredScheme('no-such-scheme')).toBe('standard');
  });

  it('a session whose colour scheme is a known nucleotide scheme opens with that scheme', async () => {
    // Wrong implementation this fails: the guard replacing every restored scheme with the default.
    expect(await restoredScheme('gc_heatmap')).toBe('gc_heatmap');
  });
});
