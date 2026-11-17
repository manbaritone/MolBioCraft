// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  changedAfterSearch, createSearchRunner, deletedAfterSearch, hitFolderId, motifNotSearchedReason, openSearchHit, nextTask, resolveSearchScope, scopesOffered, searchText, TEXT_NOT_SEARCHED, TEXT_SEARCH_FIELDS,
  TEXT_SEARCH_STATEMENT, type MotifEngine, type SearchContext, type SearchRunEvent, type SearchScope,
} from '../core/projectSearch';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { generateLargeGenomeBenchmarkRust, searchIupacMotifRust } from '../lib/rustBioEngine';
import { PROJECT_ROOT, type ExplorerFolder } from '../core/projectExplorer';
import type { SequenceDocument, SequenceFeature } from '../types/bio';

const doc = (id: string, folder: string, extra: Partial<SequenceDocument> = {}): SequenceDocument => ({
  id, name: `Doc ${id}`, accession: '', description: '', sequence: '', moleculeType: 'DNA', topology: 'linear',
  folder, createdAt: '', updatedAt: '', features: [], primers: [], history: [], ...extra,
});

const feature = (name: string, type: string, extra: Partial<SequenceFeature> = {}): SequenceFeature => ({
  id: `f-${name}`, name, type: type as SequenceFeature['type'], start: 1, end: 3, strand: 1, color: '#000', ...extra,
});

/** Four built-in folders as App.tsx's explorerFolders builds them, plus custom A > B > C and a hidden pair. */
const FOLDERS: ExplorerFolder[] = [
  { id: 'Sample Documents', label: 'Sample Documents', parent: PROJECT_ROOT, matchFolders: [] },
  { id: 'Cloning', label: 'Cloning', parent: 'Sample Documents', matchFolders: ['Cloning', 'Cloning Inserts & PCR'] },
  { id: 'Genomes', label: 'Genomes', parent: 'Sample Documents', matchFolders: ['Genomes', 'Genomes & NGS'] },
  { id: 'Genomes/Bacteria', label: 'Bacteria', parent: 'Genomes', matchFolders: ['Genomes/Bacteria'] },
  { id: 'A', label: 'A', parent: PROJECT_ROOT, matchFolders: ['A'] },
  { id: 'B', label: 'B', parent: 'A', matchFolders: ['B'] },
  { id: 'C', label: 'Gamma', parent: 'B', matchFolders: ['C'] },
  { id: 'H1', label: 'Hidden parent', parent: PROJECT_ROOT, matchFolders: ['H1'] },
  { id: 'H2', label: 'Hidden child', parent: 'H1', matchFolders: ['H2'] },
];

const DOCS: SequenceDocument[] = [
  doc('dA', 'A'), doc('dB', 'B'), doc('dC', 'C'),
  doc('dClone', 'Cloning Inserts & PCR'),
  doc('dGen', 'Genomes'), doc('dNgs', 'Genomes & NGS'), doc('dBac', 'Genomes/Bacteria'),
  doc('dRoot', PROJECT_ROOT), doc('dLocal', 'Local'), doc('dAllDocs', 'All Documents'),
  doc('dOrphan', 'A folder no explorer lists'),
  doc('dHidden', 'H2', { description: 'kept out of sight' }),
  doc('dFav', 'B'),
  doc('dDeleted', 'A'),
  doc('dDeletedHidden', 'H2'),
];

const CTX: SearchContext = {
  documents: DOCS, folders: FOLDERS,
  deletedIds: ['dDeleted', 'dDeletedHidden'], favoriteIds: ['dFav', 'dDeleted'],
};

const resolved = (folderId: string, scope: SearchScope) => {
  const result = resolveSearchScope(folderId, scope, CTX);
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return { label: result.label, ids: new Set(result.documents.map((d) => d.id)) };
};

const ALL_NON_DELETED = new Set(DOCS.map((d) => d.id).filter((id) => !CTX.deletedIds.includes(id)));

const hitsOf = (query: string, documents: SequenceDocument[], folders = FOLDERS) => {
  const result = searchText(query, documents, folders);
  if ('refused' in result) throw new Error(`refused: ${result.refused}`);
  return result.results.flatMap((r) => r.hits.map((h) => ({ ...h, documentId: r.documentId })));
};

describe('project text search scopes', () => {
  it('US-01M7DVC0 AC1: "This folder only" returns a folder\'s own documents and its aliases, never a subfolder\'s', () => {
    expect(resolved('A', 'This folder only')).toEqual({ label: 'A only', ids: new Set(['dA']) });
    expect(resolved('Cloning', 'This folder only')).toEqual({ label: 'Sample Documents › Cloning only', ids: new Set(['dClone']) });
    expect(resolved('Genomes', 'This folder only')).toEqual({ label: 'Sample Documents › Genomes only', ids: new Set(['dGen', 'dNgs']) });
    expect(resolved('C', 'This folder only')).toEqual({ label: 'A › B › Gamma only', ids: new Set(['dC']) });
  });

  it('US-01M7DVC0 AC1: "Folder and subfolders" returns the folder\'s whole subtree, labelled by its path', () => {
    expect(resolved('A', 'Folder and subfolders')).toEqual({ label: 'A and subfolders', ids: new Set(['dA', 'dB', 'dC', 'dFav']) });
    expect(resolved('Genomes/Bacteria', 'Folder and subfolders'))
      .toEqual({ label: 'Sample Documents › Genomes › Bacteria and subfolders', ids: new Set(['dBac']) });
    expect(resolved('Genomes', 'Folder and subfolders'))
      .toEqual({ label: 'Sample Documents › Genomes and subfolders', ids: new Set(['dGen', 'dNgs', 'dBac']) });
  });

  it('US-01M7DVC0 AC1: "Entire project" is every non-deleted document, whatever folder is selected', () => {
    for (const folder of ['A', 'Genomes/Bacteria', PROJECT_ROOT]) {
      expect(resolved(folder, 'Entire project')).toEqual({ label: 'Entire project', ids: ALL_NON_DELETED });
    }
    expect(ALL_NON_DELETED.has('dOrphan')).toBe(true);
  });

  it('US-01M7DVC0 AC1: on the root, "Folder and subfolders" is the entire project and "This folder only" is what is filed at the root', () => {
    expect(scopesOffered(PROJECT_ROOT)).toEqual(['This folder only', 'Folder and subfolders', 'Entire project']);
    expect(resolved(PROJECT_ROOT, 'Folder and subfolders')).toEqual({ label: 'Entire project', ids: ALL_NON_DELETED });
    expect(resolved(PROJECT_ROOT, 'This folder only')).toEqual({ label: 'All Project Files only', ids: new Set(['dRoot', 'dLocal', 'dAllDocs']) });
    for (const alias of ['All Documents', 'Local']) {
      expect(resolved(alias, 'Folder and subfolders')).toEqual({ label: 'Entire project', ids: ALL_NON_DELETED });
    }
  });

  it('US-01M7DVC0 AC1: Favorites offers only "This folder only", returning the non-deleted favourites', () => {
    expect(scopesOffered('Favorites')).toEqual(['This folder only']);
    expect(scopesOffered('A')).toEqual(['This folder only', 'Folder and subfolders', 'Entire project']);
    expect(resolved('Favorites', 'This folder only')).toEqual({ label: 'Favorites only', ids: new Set(['dFav']) });
  });

  it('US-01M7DVC0 AC1: a scope the folder does not offer, or a folder the context does not hold, is refused by name', () => {
    expect(resolveSearchScope('Favorites', 'Entire project', CTX)).toEqual({ refused: 'scope not offered' });
    expect(resolveSearchScope('Deleted Items', 'Folder and subfolders', CTX)).toEqual({ refused: 'scope not offered' });
    expect(resolveSearchScope('No such folder', 'This folder only', CTX)).toEqual({ refused: 'unknown folder' });
  });
});

describe('deleted documents and hidden folders', () => {
  it('US-01M7DVC0 AC2: a deleted document is in no scope but Deleted Items, which returns every deleted document', () => {
    const folderIds = [PROJECT_ROOT, 'Favorites', ...FOLDERS.map((f) => f.id)];
    for (const folder of folderIds) {
      for (const scope of scopesOffered(folder)) {
        const { ids } = resolved(folder, scope);
        expect(ids.has('dDeleted'), `${folder} / ${scope}`).toBe(false);
        expect(ids.has('dDeletedHidden'), `${folder} / ${scope}`).toBe(false);
      }
    }
    expect(scopesOffered('Deleted Items')).toEqual(['This folder only']);
    expect(resolved('Deleted Items', 'This folder only'))
      .toEqual({ label: 'Deleted Items (trash)', ids: new Set(['dDeleted', 'dDeletedHidden']) });
  });

  it('US-01M7DVC0 AC2: a document in a hidden folder is in the entire project, and its result names its folder path through the hidden folders', () => {
    const entire = resolveSearchScope('A', 'Entire project', CTX);
    if ('refused' in entire) throw new Error(entire.refused);
    expect(entire.documents.map((d) => d.id)).toContain('dHidden');
    const result = searchText('sight', entire.documents, FOLDERS);
    if ('refused' in result) throw new Error(result.refused);
    expect(result.results.map((r) => [r.documentId, r.folderPath])).toEqual([['dHidden', 'Hidden parent › Hidden child']]);
  });

  it('US-01M7DVC0 AC2: a result names the folder that owns an alias, the root, or the raw folder when no folder holds it', () => {
    const named = DOCS.filter((d) => ['dNgs', 'dC', 'dRoot', 'dOrphan'].includes(d.id)).map((d) => ({ ...d, description: 'needle' }));
    const result = searchText('needle', named, FOLDERS);
    if ('refused' in result) throw new Error(result.refused);
    expect(Object.fromEntries(result.results.map((r) => [r.documentId, r.folderPath]))).toEqual({
      dNgs: 'Sample Documents › Genomes', dC: 'A › B › Gamma', dRoot: 'All Project Files', dOrphan: 'A folder no explorer lists',
    });
  });
});

describe('text fields searched', () => {
  const EVERY_FIELD = doc('every', 'A', {
    name: 'zeta name', accession: 'ZETA01', description: 'about zeta',
    docMetadata: { Notes: 'a zeta note', Organism: 'zeta coli', Newick: '(zeta:1,b:2);', Count: 7 },
    features: [feature('zetaF', 'CDS', { qualifiers: { gene: 'zetaG' }, notes: 'feature zeta note' }),
      feature('other', 'zeta_region')],
    primers: [{ name: 'zetaP', sequence: 'ACGT' } as SequenceDocument['primers'][number]],
    history: [{ id: 'h1', timestamp: '', operation: 'zeta op', description: 'zeta desc', parentIds: [], lengthBp: 4, topology: 'linear' }],
  });

  it('US-01M7DVC0 AC3: TEXT_SEARCH_FIELDS is the one list of searched fields, and each yields its own hit', () => {
    expect(TEXT_SEARCH_FIELDS.map((f) => f.id)).toEqual([
      'name', 'accession', 'description', 'notes', 'metadata', 'featureName', 'featureType',
      'featureQualifier', 'featureNotes', 'primerName', 'historyOperation', 'historyDescription',
    ]);
    const hits = hitsOf('zeta', [EVERY_FIELD]);
    expect(hits.map((h) => [h.fieldId, h.field])).toEqual([
      ['name', 'Name'], ['accession', 'Accession'], ['description', 'Description'], ['notes', 'Notes'],
      ['metadata', 'metadata Organism'],
      ['featureName', 'name of feature zetaF'], ['featureType', 'type of feature other'],
      ['featureQualifier', 'qualifier /gene of feature zetaF'], ['featureNotes', 'notes of feature zetaF'],
      ['primerName', 'name of primer zetaP'],
      ['historyOperation', 'operation of history step 1'], ['historyDescription', 'description of history step 1'],
    ]);
  });

  it('US-01M7DVC0 AC3: Notes is reported once, as Notes, and a Newick value is never a hit', () => {
    const notes = hitsOf('note', [EVERY_FIELD]).filter((h) => h.value === 'a zeta note');
    expect(notes.map((h) => h.field)).toEqual(['Notes']);
    expect(hitsOf('(zeta:1', [EVERY_FIELD])).toEqual([]);
    expect(hitsOf('b:2', [EVERY_FIELD])).toEqual([]);
    expect(hitsOf('7', [EVERY_FIELD]).map((h) => h.field)).toEqual(['metadata Count']);
  });

  it('US-01M7DVC0 AC3: a hit gives UTF-16 offsets into the field\'s unmodified value, also after a character whose lower case is longer', () => {
    const lac = doc('lac', 'A', {
      description: 'İstanbul strain lacZ',
      features: [feature('lacZα', 'CDS', { qualifiers: { gene: 'İİ lacZ' } })],
    });
    const hits = hitsOf('LACZ', [lac]);
    expect(hits.map((h) => [h.field, h.start, h.end])).toEqual([
      ['Description', 16, 20], ['name of feature lacZα', 0, 4], ['qualifier /gene of feature lacZα', 3, 7],
    ]);
    for (const h of hits) {
      expect(h.value.slice(h.start, h.end).toLowerCase()).toBe('lacz');
    }
    expect(hits[0].value).toBe('İstanbul strain lacZ');
  });

  it('US-01M7DVC0 AC3: residue-valued qualifiers (/translation and keys ending in "sequence") are not searched; a plain qualifier is', () => {
    const cds = doc('cds', 'A', {
      features: [feature('orf1', 'CDS', { qualifiers: {
        translation: 'MKTAYIAK', primer_sequence: 'GGGAATTCAA', sequence: 'GAATTCMKT', gene: 'MKT-GAATTC tag',
      } })],
    });
    expect(hitsOf('GAATTC', [cds]).map((h) => [h.field, h.start])).toEqual([['qualifier /gene of feature orf1', 4]]);
    expect(hitsOf('MKT', [cds]).map((h) => [h.field, h.start])).toEqual([['qualifier /gene of feature orf1', 0]]);
  });

  it('US-01M7DVC0 AC3: a feature with no name is named "(unnamed feature)" in its hits', () => {
    const unnamed = doc('un', 'A', { features: [feature('', 'rep_origin', { qualifiers: { note: 'ori site' }, notes: 'high copy ori' })] });
    expect(hitsOf('ori', [unnamed]).map((h) => h.field)).toEqual([
      'type of feature (unnamed feature)', 'qualifier /note of feature (unnamed feature)', 'notes of feature (unnamed feature)',
    ]);
    const blank = doc('bl', 'A', { features: [feature('  ', 'CDS')] });
    expect(hitsOf('CDS', [blank]).map((h) => h.field)).toEqual(['type of feature (unnamed feature)']);
  });

  it('US-01M7DVC0 AC3: history operation and history description are separate fields', () => {
    const gibson = doc('gib', 'A', {
      history: [{ id: 'h', timestamp: '', operation: 'Gibson Assembly', description: 'Assembly of two inserts', parentIds: [], lengthBp: 1, topology: 'linear' }],
    });
    expect(hitsOf('Assembly', [gibson]).map((h) => [h.field, h.start])).toEqual([
      ['operation of history step 1', 7], ['description of history step 1', 0],
    ]);
    expect(hitsOf('Assembly Assembly', [gibson])).toEqual([]);
    expect(hitsOf('Assembly: Assembly', [gibson])).toEqual([]);
  });
});

describe('text matching rules', () => {
  const lacZ = doc('lz', 'A', { features: [feature('lacZ', 'CDS')], docMetadata: { Organism: 'E. coli' } });

  it('US-01M7DVC0 AC4: matching is case-insensitive within one value and never folds diacritics', () => {
    expect(hitsOf('LACZ', [lacZ]).map((h) => h.field)).toEqual(['name of feature lacZ']);
    const cafe = doc('c1', 'A', { description: 'Café au lait' });
    expect(hitsOf('cafe', [cafe])).toEqual([]);
    expect(hitsOf('CAFÉ', [cafe]).map((h) => [h.start, h.end])).toEqual([[0, 4]]);
  });

  it('US-01M7DVC0 AC4: Unicode forms are not folded: a match never starts on, or ends right before, a combining mark', () => {
    const decomposed = doc('c2', 'A', { description: 'Cafe\u0301 au lait' });
    const precomposed = doc('c3', 'A', { description: 'Caf\u00e9 au lait' });
    expect(hitsOf('cafe', [decomposed])).toEqual([]);
    expect(hitsOf('caf\u00e9', [decomposed])).toEqual([]);
    expect(hitsOf('cafe\u0301', [precomposed])).toEqual([]);
    expect(hitsOf('CAFE\u0301', [decomposed]).map((h) => [h.start, h.end, h.value.slice(h.start, h.end)])).toEqual([[0, 5, 'Cafe\u0301']]);
    expect(hitsOf('CAF\u00c9', [precomposed]).map((h) => [h.start, h.end])).toEqual([[0, 4]]);
    expect(hitsOf('\u0301 au', [decomposed])).toEqual([]);
    const both = doc('c4', 'A', { description: 'cafe\u0301 or cafe' });
    expect(hitsOf('cafe', [both]).map((h) => [h.start, h.end])).toEqual([[9, 13]]);
    const overlapping = doc('c5', 'A', { description: 'a\u0301a\u0301a' });
    expect(hitsOf('a\u0301a', [overlapping]).map((h) => [h.start, h.end])).toEqual([[2, 5]]);
    const otherMarks = doc('c6', 'A', { description: 'vec\u20d7 and tremolo\u{1d167} but xyz\u{1f600}' });
    expect(hitsOf('vec', [otherMarks])).toEqual([]);
    expect(hitsOf('tremolo', [otherMarks])).toEqual([]);
    expect(hitsOf('xyz', [otherMarks]).map((h) => [h.start, h.end])).toEqual([[23, 26]]);
  });

  it('US-01M7DVC0 AC4: every non-overlapping occurrence in a value is its own hit', () => {
    const repeats = doc('rep', 'A', { description: 'aaaa', name: 'lacZ and LacZ' });
    expect(hitsOf('aa', [repeats]).map((h) => [h.start, h.end])).toEqual([[0, 2], [2, 4]]);
    expect(hitsOf('lacz', [repeats]).map((h) => [h.field, h.start])).toEqual([['Name', 0], ['Name', 9]]);
  });

  it('US-01M7DVC0 AC4: no hit spans two values, and a metadata key alone is not a hit', () => {
    expect(hitsOf('lacZ CDS', [lacZ])).toEqual([]);
    expect(hitsOf('lacZ', [lacZ]).map((h) => h.field)).toEqual(['name of feature lacZ']);
    expect(hitsOf('CDS', [lacZ]).map((h) => h.field)).toEqual(['type of feature lacZ']);
    expect(hitsOf('Organism', [lacZ])).toEqual([]);
    expect(hitsOf('Organism: E', [lacZ])).toEqual([]);
    expect(hitsOf('coli', [lacZ]).map((h) => h.field)).toEqual(['metadata Organism']);
  });

  it('US-01M7DVC0 AC4: the query is trimmed, and an empty or whitespace-only query is refused without searching', () => {
    const trimmed = searchText('  lacZ \t', [lacZ], FOLDERS);
    expect(trimmed).toEqual(searchText('lacZ', [lacZ], FOLDERS));
    if ('refused' in trimmed) throw new Error(trimmed.refused);
    expect(trimmed.query).toBe('lacZ');
    expect(trimmed.results).toHaveLength(1);
    const untouchable = new Proxy([] as SequenceDocument[], { get() { throw new Error('documents were read'); } });
    for (const query of ['', '   ', '\t\n ']) {
      expect(searchText(query, untouchable, FOLDERS)).toEqual({ refused: 'empty query' });
    }
    const none = searchText('absent word', [lacZ], FOLDERS);
    expect(none).toEqual({ query: 'absent word', results: [] });
  });
});

describe('text mode and residues', () => {
  it('US-01M7DVC0 AC5: a query of nucleotide letters matches text fields only, never residues or primer sequences', () => {
    const plasmid = doc('pl', 'A', {
      sequence: 'TTGAATTCGG', name: 'pUC19',
      primers: [{ name: 'fwd', sequence: 'GAATTC' } as SequenceDocument['primers'][number]],
      chromatogram: { traceA: [], traceC: [], traceG: [], traceT: [], peakLocations: [], phredScores: [] } as unknown as SequenceDocument['chromatogram'],
    });
    const noted = doc('noted', 'A', { sequence: 'AAAA', description: 'EcoRI site gaattc' });
    expect(hitsOf('GAATTC', [plasmid])).toEqual([]);
    expect(hitsOf('GAATTC', [plasmid, noted]).map((h) => [h.documentId, h.field])).toEqual([['noted', 'Description']]);
  });

  it('US-01M7DVC0 AC5: one exported statement names what is searched and what is not searched in this mode', () => {
    expect(TEXT_NOT_SEARCHED).toEqual(['residues', 'Newick text', 'chromatogram traces']);
    const [searched, notSearched] = TEXT_SEARCH_STATEMENT.split('Not searched in this mode:');
    expect(notSearched).toBeDefined();
    for (const field of TEXT_SEARCH_FIELDS) expect(searched).toContain(field.label);
    for (const field of TEXT_NOT_SEARCHED) expect(notSearched).toContain(field);
    expect(notSearched).toContain("residue-valued feature qualifiers (/translation and every key ending in 'sequence')");
    expect(notSearched).toContain('Accents and Unicode forms are not folded');
  });

  it('US-01M7DVC0 AC5: residue text held in a feature qualifier is not matched in text mode', () => {
    const bind = doc('pb', 'A', {
      features: [feature('M13 fwd', 'primer_bind', { qualifiers: { primer_sequence: 'GAATTC' } }),
        feature('lacI', 'CDS', { qualifiers: { translation: 'MKPVTLYDVAE' } })],
    });
    expect(hitsOf('GAATTC', [bind])).toEqual([]);
    expect(hitsOf('MKP', [bind])).toEqual([]);
  });
});

// ─── US-01M7DVVS: search runs ───

/** A step yield the test resolves by hand, one pending promise per call, in call order. */
function handYield() {
  const pending: (() => void)[] = [];
  return { pending, yieldStep: () => new Promise<void>((resolve) => { pending.push(resolve); }) };
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve(); };

describe('US-01M7DVVS search runs', () => {
  it('US-01M7DVVS AC2 drops an older run that finishes after a newer one started, whichever order the steps resolve in', async () => {
    const docs = [
      doc('r1', 'A', { description: 'zqold and zqnew' }),
      doc('r2', 'A', { description: 'zqold only' }),
      doc('r3', 'A', { description: 'zqnew only' }),
    ];
    const { pending, yieldStep } = handYield();
    const runner = createSearchRunner(yieldStep);
    const older: SearchRunEvent[] = [];
    const newer: SearchRunEvent[] = [];
    runner.start({ mode: 'Text', query: 'zqold', documents: docs, folders: FOLDERS }, (e) => older.push(e));
    // The older run read its first document and waits on its first yield (pending[0]).
    expect(older).toEqual([{ kind: 'progress', reached: 1, total: 3 }]);
    runner.start({ mode: 'Text', query: 'zqnew', documents: docs, folders: FOLDERS }, (e) => newer.push(e));
    expect(pending).toHaveLength(2);
    // Reverse order: the newer run's steps resolve first and it completes...
    pending[1](); await flush();
    pending[2](); await flush();
    expect(pending).toHaveLength(3);
    const done = newer.filter((e) => e.kind === 'done');
    expect(done).toHaveLength(1);
    const result = (done[0] as Extract<SearchRunEvent, { kind: 'done' }>).result;
    expect(result.mode === 'Text' && 'results' in result.outcome ? result.outcome.results.map((r) => r.documentId) : null).toEqual(['r1', 'r3']);
    // ...then the older run's step resolves, after the newer one finished: it reports nothing and reads no further document.
    pending[0](); await flush();
    expect(pending, 'the older run took no further step').toHaveLength(3);
    expect(older, 'the older run is dropped').toEqual([{ kind: 'progress', reached: 1, total: 3 }]);
    expect(newer.filter((e) => e.kind === 'done')).toHaveLength(1);

    // stop() ends a run the same way: no document after it, and no answer.
    const stopped: SearchRunEvent[] = [];
    runner.start({ mode: 'Text', query: 'zqold', documents: docs, folders: FOLDERS }, (e) => stopped.push(e));
    runner.stop();
    pending[3](); await flush();
    expect(stopped).toEqual([{ kind: 'progress', reached: 1, total: 3 }]);
  });

  it('US-01M7DVVS AC5 yields between documents over the sample library and a 500 kbp genome, one document per engine call', async () => {
    const genome = generateLargeGenomeBenchmarkRust(500_000, 'Escherichia coli K-12');
    expect(genome.sequence.length).toBe(500_000);
    const documents = [...SAMPLE_LIBRARY, genome];
    let step = 0;
    let yields = 0;
    const calls: { step: number; seq: string; ms: number }[] = [];
    const engine: MotifEngine = (seq, query, options) => {
      const t0 = performance.now();
      try {
        return searchIupacMotifRust(seq, query, options);
      } finally {
        calls.push({ step, seq, ms: performance.now() - t0 });
      }
    };
    const runner = createSearchRunner(() => { yields += 1; step += 1; return nextTask(); });
    const t0 = performance.now();
    const result = await new Promise<Extract<SearchRunEvent, { kind: 'done' }>['result']>((resolve) => {
      runner.start({ mode: 'Nucleotide motif', query: 'GAATTC', documents, folders: [], bothStrands: true, engine }, (e) => {
        if (e.kind === 'done') resolve(e.result);
      });
    });
    const elapsed = performance.now() - t0;
    if (result.mode === 'Text' || !('results' in result.outcome)) throw new Error(`the run did not search: ${JSON.stringify(result.outcome)}`);
    // The run yields between every two documents, and each engine call reads exactly that step's document.
    expect(yields).toBe(documents.length - 1);
    for (const call of calls) {
      expect(calls.filter((c) => c.step === call.step), `step ${call.step} makes one engine call`).toHaveLength(1);
      expect(call.seq, `step ${call.step} reads its own document`).toBe(documents[call.step].sequence);
    }
    expect(calls.map((c) => c.seq.length)).toContain(500_000);
    expect(calls, 'one engine call per document the mode reads').toHaveLength(documents.filter((d) => motifNotSearchedReason(d, 'Nucleotide motif') === null).length);
    const residues = calls.reduce((n, c) => n + c.seq.length, 0);
    const longest = calls.reduce((a, c) => (c.ms > a.ms ? c : a));
    console.log(`US-01M7DVVS AC5: ${documents.length} documents in scope, ${result.outcome.searched} searched, `
      + `${residues} residues, ${elapsed.toFixed(1)} ms elapsed, longest single engine call ${longest.ms.toFixed(1)} ms `
      + `(${longest.seq.length} residues)${longest.ms > 50 ? ' - over 50 ms: file the Web Worker follow-up' : ''}`);
  });
});

// ─── US-01M7DV78: where a hit opens ───

describe('US-01M7DV78: a hit opens at its own feature, primer or field, and a stale one says why', () => {
  const twin = (id: string, start: number, end: number, extra: Partial<SequenceFeature> = {}) =>
    feature('zqgene', 'CDS', { id, start, end, ...extra });
  const base = doc('dHit', 'A', {
    name: 'Hit doc', topology: 'circular', sequence: 'A'.repeat(1000), updatedAt: '2026-11-17T00:00:00Z',
    description: 'a zqdesc record',
    features: [
      twin('f1', 100, 200), twin('f2', 300, 400, { qualifiers: { note: 'zqqual' } }),
      feature('zqwrap', 'misc_feature', { id: 'f3', start: 950, end: 50, notes: 'zqnote' }),
      feature('zqjoin', 'CDS', {
        id: 'f4', start: 500, end: 650,
        segments: [{ index: 0, name: 'a', start: 500, end: 520, color: '#000' }, { index: 1, name: 'b', start: 600, end: 650, color: '#000' }],
      }),
    ],
    primers: [{ id: 'p1', name: 'zqprimer', bindStart: 700, bindEnd: 720 } as SequenceDocument['primers'][number]],
    history: [{ id: 'h1', timestamp: '', operation: 'zqop', description: 'zqhist', parentIds: [], lengthBp: 1000, topology: 'circular' }],
  });
  const live = { doc: base, deleted: false };
  const hits = (query: string, d = base) => {
    const found = searchText(query, [d], FOLDERS);
    if ('refused' in found) throw new Error('refused');
    return found.results.flatMap((r) => r.hits);
  };
  const open = (hit: ReturnType<typeof hits>[number], current = live) => openSearchHit({ mode: 'Text', hit }, live, current);
  const selection = (hit: ReturnType<typeof hits>[number]) => {
    const r = open(hit);
    if (!('opens' in r)) throw new Error(r.refused);
    return r.opens.selection && [r.opens.selection.start, r.opens.selection.end];
  };

  it('US-01M7DV78 AC2 two features of one name: each hit carries its own featureId and selects its own span', () => {
    const named = hits('zqgene').filter((h) => h.fieldId === 'featureName');
    expect(named.map((h) => h.featureId)).toEqual(['f1', 'f2']);
    expect(named.map(selection)).toEqual([[100, 200], [300, 400]]);
    expect(selection(hits('zqqual')[0]), 'a qualifier hit selects its feature').toEqual([300, 400]);
    expect(selection(hits('zqnote')[0]), 'an origin-crossing feature keeps start > end').toEqual([950, 50]);
    expect(selection(hits('zqjoin')[0]), 'a joined feature selects first-to-last').toEqual([500, 650]);
    expect(selection(hits('misc_feature')[0]), 'a type hit selects its feature').toEqual([950, 50]);
    expect(selection(hits('zqprimer')[0]), 'a primer name selects its binding site').toEqual([700, 720]);
  });

  it('US-01M7DV78 AC2 a joined feature whose own start..end is not first-to-last still selects first-to-last', () => {
    const odd = { ...base, features: [feature('zqjoin', 'CDS', {
      id: 'j', start: 1, end: 1000,
      segments: [{ index: 0, name: 'a', start: 900, end: 950, color: '#000' }, { index: 1, name: 'b', start: 10, end: 40, color: '#000' }],
    })] };
    const r = openSearchHit({ mode: 'Text', hit: hits('zqjoin', odd)[0] }, { doc: odd, deleted: false }, { doc: odd, deleted: false });
    expect('opens' in r && r.opens.selection).toEqual({ start: 900, end: 40, label: 'zqjoin' });
  });

  it('US-01M7DV78 AC2 a hit in a document field or a history step opens no selection and names the field', () => {
    for (const [query, field, index] of [['zqdesc', 'Description', undefined], ['zqop', 'operation of history step 1', 0], ['zqhist', 'description of history step 1', 0]] as const) {
      const hit = hits(query)[0];
      expect(hit.historyIndex).toBe(index);
      const r = open(hit);
      expect(r).toEqual({ opens: { documentId: 'dHit', selection: null, field: hit } });
      expect('opens' in r && r.opens.field?.field).toBe(field);
    }
  });

  it('US-01M7DV78 AC1 a motif hit across the origin selects start > end, not its complement', () => {
    const hit = { start: 998, end: 3, strand: 1, palindromic: true, certainty: 'definite', letters: 'GAATTC' } as unknown as Parameters<typeof openSearchHit>[0]['hit'];
    expect(openSearchHit({ mode: 'Nucleotide motif', hit } as Parameters<typeof openSearchHit>[0], live, live))
      .toEqual({ opens: { documentId: 'dHit', selection: { start: 998, end: 3 }, field: null } });
  });

  it('US-01M7DV78 AC3 a changed updatedAt, a changed sequence or a feature gone each refuse with the changed sentence', () => {
    const hit = hits('zqgene')[1];
    const changed = changedAfterSearch('Hit doc');
    expect(changed).toBe('"Hit doc" changed after this search ran: this result is out of date.');
    expect(open(hit, { doc: { ...base, updatedAt: '2026-11-18T00:00:00Z' }, deleted: false })).toEqual({ refused: changed });
    expect(open(hit, { doc: { ...base, sequence: `C${base.sequence.slice(1)}` }, deleted: false })).toEqual({ refused: changed });
    expect(open(hit, { doc: { ...base, features: base.features.filter((f) => f.id !== 'f2') }, deleted: false })).toEqual({ refused: changed });
    expect(open(hits('zqprimer')[0], { doc: { ...base, primers: [] }, deleted: false })).toEqual({ refused: changed });
    expect(open(hit, { doc: { ...base }, deleted: false }), 'an equal copy is not a change').toHaveProperty('opens');
  });

  it('US-01M7DV78 AC4 gone from the catalog, or moved to Deleted Items since, refuse with the deleted sentence; a document searched in Deleted Items opens', () => {
    const hit = hits('zqgene')[0];
    const deleted = deletedAfterSearch('Hit doc');
    expect(deleted).toBe('"Hit doc" was deleted after this search ran.');
    expect(openSearchHit({ mode: 'Text', hit }, live, null)).toEqual({ refused: deleted });
    expect(openSearchHit({ mode: 'Text', hit }, live, { doc: base, deleted: true })).toEqual({ refused: deleted });
    const trashed = { doc: base, deleted: true };
    expect(openSearchHit({ mode: 'Text', hit }, trashed, trashed)).toHaveProperty('opens');
    expect(openSearchHit({ mode: 'Text', hit }, trashed, null), 'erased from Deleted Items').toEqual({ refused: deleted });
  });

  it('US-01M7DV78 AC1 the folder a hit opens in: Deleted Items, its own or its alias owner, or the nearest visible ancestor of a hidden one', () => {
    const all = () => true;
    expect(hitFolderId(doc('x', 'C'), true, FOLDERS, [], all)).toEqual({ folderId: 'Deleted Items' });
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, [], all)).toEqual({ folderId: 'C' });
    expect(hitFolderId(doc('x', 'Genomes & NGS'), false, FOLDERS, [], all)).toEqual({ folderId: 'Genomes' });
    expect(hitFolderId(doc('x', 'Local'), false, FOLDERS, [], all)).toEqual({ folderId: PROJECT_ROOT });
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, ['C'], all)).toEqual({ folderId: 'B' });
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, ['B'], all), 'a visible folder under a hidden one').toEqual({ folderId: 'A' });
    expect(hitFolderId(doc('x', 'H2'), false, FOLDERS, ['H1', 'H2'], all)).toEqual({ folderId: PROJECT_ROOT });
  });

  it('US-01M7DV78 AC1 the nearest visible folder whose view lists the document, or a refusal naming why when none does', () => {
    // The root view lists the session's documents only, never a catalog-only sample document.
    const notRoot = (folderId: string) => folderId !== PROJECT_ROOT;
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, ['C'], (f) => f === 'A'), 'B does not list it, its parent A does').toEqual({ folderId: 'A' });
    expect(hitFolderId(doc('x', 'Genomes & NGS'), false, FOLDERS, [], notRoot)).toEqual({ folderId: 'Genomes' });
    expect(hitFolderId(doc('x', 'Genomes & NGS'), false, FOLDERS, ['Sample Documents'], notRoot)).toEqual({
      refused: '"Doc x" is in the hidden folder "Sample Documents", and no folder the explorer shows lists it: show that folder to open this result.',
    });
    expect(hitFolderId(doc('x', 'H2'), false, FOLDERS, ['H2'], notRoot), 'the topmost hidden folder is named').toEqual({ folderId: 'H1' });
    expect(hitFolderId(doc('x', 'H2'), false, FOLDERS, ['H1', 'H2'], notRoot)).toEqual({
      refused: '"Doc x" is in the hidden folder "Hidden parent", and no folder the explorer shows lists it: show that folder to open this result.',
    });
    expect(hitFolderId(doc('x', 'Local'), false, FOLDERS, [], notRoot)).toEqual({
      refused: '"Doc x" is in no folder the explorer shows, so this result cannot open.',
    });
    expect(hitFolderId(doc('x', 'C'), true, FOLDERS, [], () => false)).toEqual({
      refused: '"Doc x" is in no folder the explorer shows, so this result cannot open.',
    });
  });
});
