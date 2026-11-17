// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  activeConditions, combineConditions, filterDocument, noSingleSequenceReason, NO_READABLE_MODIFIED_DATE, type CombineChoice, type ConditionsOutcome, type SearchCondition, type SearchFilters, type SearchRequest,
  changedAfterSearch, createSearchRunner, deletedAfterSearch, openPrimerHit, primerHitPortion, hitFolderId, motifNotSearchedReason, openSearchHit, nextTask, resolveSearchScope, scopesOffered, searchText, TEXT_NOT_SEARCHED, TEXT_SEARCH_FIELDS,
  TEXT_SEARCH_STATEMENT, type MotifEngine, type SearchContext, type SearchRunEvent, type SearchScope,
} from '../core/projectSearch';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { generateLargeGenomeBenchmarkRust, searchIupacMotifRust } from '../lib/rustBioEngine';
import { PROJECT_ROOT, type ExplorerFolder } from '../core/projectExplorer';
import type { DatabasePrimer, SequenceDocument, SequenceFeature } from '../types/bio';

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
    // The root view lists the session's documents only, never a catalog-only sample document, and
    // Favorites lists only the favorited ones: these documents are not favorited (BG-01M7MRF8).
    const notRoot = (folderId: string) => folderId !== PROJECT_ROOT && folderId !== 'Favorites';
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

// ─── BG-01M7MRF8: Favorites is the last folder a hit opens in ───

describe('BG-01M7MRF8: a favorited document no other shown folder lists opens under Favorites', () => {
  /** A view per folder as App's getDocsForFolderView answers it: the root never lists it, `also` do. */
  const views = (...also: string[]) => (folderId: string) => also.includes(folderId);
  const hiddenSamples = '"Doc x" is in the hidden folder "Sample Documents", and no folder the explorer shows lists it: show that folder to open this result.';
  const notShown = '"Doc x" is in no folder the explorer shows, so this result cannot open.';

  it('BG-01M7MRF8 AC1 opens under Favorites only when no folder up from its own lists it, and refuses as before when not favorited', () => {
    expect(hitFolderId(doc('x', 'Genomes & NGS'), false, FOLDERS, ['Sample Documents'], views('Favorites')),
      'hidden Sample Documents, favorited').toEqual({ folderId: 'Favorites' });
    expect(hitFolderId(doc('x', 'Genomes & NGS'), false, FOLDERS, ['Sample Documents'], views()),
      'hidden Sample Documents, not favorited: the hidden-folder sentence').toEqual({ refused: hiddenSamples });
    expect(hitFolderId(doc('x', 'Local'), false, FOLDERS, [], views('Favorites')), 'a root document the root view does not list').toEqual({ folderId: 'Favorites' });
    expect(hitFolderId(doc('x', 'Local'), false, FOLDERS, [], views()), 'not favorited').toEqual({ refused: notShown });
  });

  it('BG-01M7MRF8 AC1 Favorites is the last folder tried: its own folder, or a shown folder above it, opens it first', () => {
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, [], views('C', 'B', 'A', PROJECT_ROOT, 'Favorites')), 'its own folder').toEqual({ folderId: 'C' });
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, [], views('A', 'Favorites')), 'a shown folder above it').toEqual({ folderId: 'A' });
    expect(hitFolderId(doc('x', 'C'), false, FOLDERS, ['B'], views('A', 'Favorites')), 'above a hidden one').toEqual({ folderId: 'A' });
    expect(hitFolderId(doc('x', 'Local'), false, FOLDERS, [], views(PROJECT_ROOT, 'Favorites')), 'the root').toEqual({ folderId: PROJECT_ROOT });
    expect(hitFolderId(doc('x', 'Genomes & NGS'), false, FOLDERS, [], views('Genomes', 'Favorites'))).toEqual({ folderId: 'Genomes' });
  });

  it('BG-01M7MRF8 AC1 a deleted favorited document opens in Deleted Items, never under Favorites', () => {
    expect(hitFolderId(doc('x', 'C'), true, FOLDERS, [], views('Deleted Items', 'Favorites'))).toEqual({ folderId: 'Deleted Items' });
    expect(hitFolderId(doc('x', 'C'), true, FOLDERS, [], views('Favorites', 'C')), 'Deleted Items does not list it').toEqual({ refused: notShown });
  });
});

// ─── US-01M7DVHA: conditions combined with ALL or ANY, and filters that always narrow ───
//
// Each case names the wrong implementation it fails: ANY read as ALL, an empty condition counted
// as one with no hits, Definite only applied after the conditions are combined, a filter dropped
// under ANY (or read as another condition), an inapplicable filter read as a non-match, and a run
// that passes each condition over every document in turn instead of reading one document a step.

/** Runs `request` to its end with no wait between steps, collecting what each step read. */
async function runToEnd(request: SearchRequest, onStep: () => void = () => {}) {
  const runner = createSearchRunner(async () => { onStep(); });
  return new Promise<Extract<SearchRunEvent, { kind: 'done' }>['result']>((resolve) => {
    runner.start(request, (e) => { if (e.kind === 'done') resolve(e.result); });
  });
}
const conditionsAnswer = (outcome: ConditionsOutcome) => {
  if (!('documents' in outcome)) throw new Error(`the run did not search: ${JSON.stringify(outcome)}`);
  return outcome;
};
async function combined(rows: SearchCondition[], choice: CombineChoice, definiteOnly: boolean, documents: SequenceDocument[], filters?: SearchFilters) {
  const result = await runToEnd({ mode: 'Conditions', conditions: rows, documents, folders: FOLDERS, bothStrands: true, engine: searchIupacMotifRust, filters });
  if (result.mode !== 'Conditions') throw new Error(`a ${result.mode} run`);
  const answer = conditionsAnswer(result.outcome);
  return { ...combineConditions(answer.documents, answer.conditions, choice, definiteOnly), searched: answer.searched, filtering: result.filtering };
}
const ids = (results: { documentId: string }[]) => results.map((r) => r.documentId).sort();

const HVA_DOCS: SequenceDocument[] = [
  doc('both', 'A', { description: 'a zqalpha vector', sequence: 'CCCGAATTCCCC' }),
  doc('text-only', 'A', { description: 'zqalpha only', sequence: 'CCCCCCCCCCCC' }),
  doc('motif-only', 'A', { sequence: 'CCCGAATTCCCC' }),
  // Its only GAATTC site is possible (N), so Definite only leaves the motif condition no hit here.
  doc('possible', 'A', { description: 'zqalpha with an N', sequence: 'CCCGAANTCCCC' }),
  // Nucleotide motif does not read a protein: under ALL never a result, under ANY one through Text.
  doc('protein', 'A', { description: 'zqalpha protein', moleculeType: 'Protein', sequence: 'MKWWGAATTC' }),
  doc('neither', 'A', { sequence: 'TTTTTTTTTTTT' }),
];
const TEXT_ALPHA: SearchCondition = { mode: 'Text', query: 'zqalpha' };
const MOTIF_ECO: SearchCondition = { mode: 'Nucleotide motif', query: 'GAATTC' };

describe('US-01M7DVHA conditions and filters in the core', () => {
  it('US-01M7DVHA AC1 ALL needs every condition with a query, ANY at least one, and an empty condition takes no part', async () => {
    const all = await combined([TEXT_ALPHA, MOTIF_ECO], 'ALL', false, HVA_DOCS);
    expect(ids(all.results), 'ALL: Text and motif both hit (the possible site counts without Definite only)').toEqual(['both', 'possible']);
    const any = await combined([TEXT_ALPHA, MOTIF_ECO], 'ANY', false, HVA_DOCS);
    expect(ids(any.results), 'ANY: at least one condition, the protein through Text').toEqual(['both', 'motif-only', 'possible', 'protein', 'text-only']);
    // A blank row between them: counted as a condition with no hits, ALL would list nothing.
    const withEmpty = await combined([TEXT_ALPHA, { mode: 'Text', query: '   ' }, MOTIF_ECO], 'ALL', false, HVA_DOCS);
    expect(ids(withEmpty.results), 'the empty condition takes no part').toEqual(['both', 'possible']);
    expect(activeConditions([TEXT_ALPHA, { mode: 'Protein motif', query: '' }, MOTIF_ECO]).map((c) => c.condition), 'conditions keep their row numbers').toEqual([1, 3]);
    // Each result's hits sit under the condition that found them, numbered by row.
    const both = withEmpty.results.find((r) => r.documentId === 'both')!;
    expect(both.sections.map((s) => [s.condition.condition, s.condition.mode, s.condition.query])).toEqual([[1, 'Text', 'zqalpha'], [3, 'Nucleotide motif', 'GAATTC']]);
    const textSection = both.sections[0];
    expect('textHits' in textSection ? textSection.textHits.map((h) => h.field) : null).toEqual(['Description']);
    const motifSection = both.sections[1];
    expect('motif' in motifSection ? motifSection.motif.hits.map((h) => [h.start, h.end]) : null).toEqual([[4, 9]]);
    // The protein is not read by the motif condition: listed as not searched, prefixed with its condition.
    expect(withEmpty.notSearched.map((n) => [n.documentId, n.reason])).toEqual([['protein', 'condition 3: protein sequence (use Protein motif)']]);
  });

  it('US-01M7DVHA AC1 Definite only drops possible hits before the conditions are combined', async () => {
    const all = await combined([TEXT_ALPHA, MOTIF_ECO], 'ALL', true, HVA_DOCS);
    expect(ids(all.results), 'a document whose only motif hits are possible is no ALL result').toEqual(['both']);
    const any = await combined([TEXT_ALPHA, MOTIF_ECO], 'ANY', true, HVA_DOCS);
    const possible = any.results.find((r) => r.documentId === 'possible')!;
    expect(possible.sections.map((s) => s.condition.condition), 'under ANY it stays a result through Text alone').toEqual([1]);
    const motifOnly = await combined([MOTIF_ECO], 'ALL', true, [HVA_DOCS[3]]);
    expect(motifOnly.results, 'a motif condition alone with only possible hits finds nothing').toEqual([]);
  });

  it('US-01M7DVHA AC1 filters narrow the documents searched under ANY as under ALL, and are never one more condition', async () => {
    const filters: SearchFilters = { documentType: 'Nucleotide Sequence' };
    const any = await combined([TEXT_ALPHA, MOTIF_ECO], 'ANY', false, HVA_DOCS, filters);
    // The protein meets the Text condition but is not of the type; "neither" is of the type but meets none.
    expect(ids(any.results)).toEqual(['both', 'motif-only', 'possible', 'text-only']);
    expect(any.searched, 'documents searched are those that pass the filters').toBe(5);
    expect(any.filtering?.filteredOut).toBe(1);
    const all = await combined([TEXT_ALPHA, MOTIF_ECO], 'ALL', false, HVA_DOCS, filters);
    expect(ids(all.results)).toEqual(['both', 'possible']);
    expect(all.notSearched, 'a filtered-out document is read by no condition').toEqual([]);
  });

  it('US-01M7DVHA AC4 topology and length do not apply to a document with no single sequence; type, date and annotation type apply to every one', async () => {
    const kinds: SequenceDocument[] = [
      doc('tree', 'A', { sequence: 'GAATTC', docMetadata: { Newick: '(a,b);' } }),
      doc('text', 'A', { sequence: 'GAATTC', docMetadata: { 'Document Type': 'Text Document' } }),
      doc('enzymes', 'A', { sequence: 'GAATTC', docMetadata: { 'Document Type': 'Enzyme Set' } }),
      doc('aln-kind', 'A', { documentKind: 'alignment', sequence: 'GAATTC' }),
      doc('aln-rows', 'A', { sequence: 'GAATTC', alignmentMeta: { sequences: [{ id: 'r1', name: 'r1', sequence: 'GAATTC' }, { id: 'r2', name: 'r2', sequence: 'GAATTA' }] } }),
      doc('contig', 'A', { sequence: '', docMetadata: { 'Is Contig Summary': 'yes', 'Declared Length': '5000' } }),
    ];
    // motifNotSearchedReason's words for each kind, written out by hand.
    const words: Record<string, string> = {
      tree: 'tree (no sequence)', text: 'text document (no sequence)', enzymes: 'enzyme set (no sequence)',
      'aln-kind': 'alignment (motif search reads single sequences)', 'aln-rows': 'alignment (motif search reads single sequences)',
      contig: 'contig summary (annotations only, no bases)',
    };
    for (const d of kinds) {
      expect(noSingleSequenceReason(d), d.id).toBe(words[d.id]);
      expect(filterDocument(d, { topology: 'linear' }), `${d.id}: topology`).toEqual({ notApplicable: `Topology does not apply: ${words[d.id]}` });
      expect(filterDocument(d, { length: { min: 0, max: null } }), `${d.id}: length`).toEqual({ notApplicable: `Length does not apply: ${words[d.id]}` });
      // Never a match: not "passes" even where the document's own topology or length would pass.
      expect(filterDocument(d, { topology: d.topology }), `${d.id}: its own topology`).not.toBe('passes');
      expect(filterDocument(d, { annotationType: 'CDS' }), `${d.id}: annotation type applies`).toBe('filtered out');
      expect(filterDocument({ ...d, updatedAt: '1999-06-01T12:00:00Z' }, { modified: { from: '2000-01-01', to: null } }), `${d.id}: date applies`).toBe('filtered out');
    }
    // An empty sequence, a protein and a DNA record hold a single sequence: topology and length apply.
    const single = [doc('empty', 'A', { sequence: '' }), doc('prot', 'A', { moleculeType: 'Protein', sequence: 'MKW' }), doc('dna', 'A', { sequence: 'ACGT' })];
    for (const d of single) {
      expect(noSingleSequenceReason(d), d.id).toBeNull();
      expect(filterDocument(d, { topology: 'linear' }), d.id).toBe('passes');
      expect(filterDocument(d, { topology: 'circular' }), d.id).toBe('filtered out');
    }
    expect(filterDocument(single[0], { length: { min: 0, max: 0 } }), 'an empty sequence is 0 long').toBe('passes');
    expect(filterDocument(single[1], { length: { min: 3, max: 3 } }), 'a protein counts aa').toBe('passes');
    expect(filterDocument(single[2], { length: { min: 5, max: null } })).toBe('filtered out');

    // In a run: listed apart, read by no condition, and counted neither as passing nor as filtered out.
    let calls = 0;
    const engine: MotifEngine = (...args) => { calls += 1; return searchIupacMotifRust(...args); };
    const result = await runToEnd({ mode: 'Conditions', conditions: [{ mode: 'Text', query: 'Doc' }, MOTIF_ECO], documents: [...kinds, ...single], folders: FOLDERS, bothStrands: true, engine, filters: { topology: 'linear' } });
    expect(result.filtering?.notApplicable.map((n) => [n.documentId, n.reason])).toEqual(kinds.map((d) => [d.id, `Topology does not apply: ${words[d.id]}`]));
    expect(result.filtering?.passed).toBe(3);
    expect(result.filtering?.filteredOut).toBe(0);
    expect(result.mode === 'Conditions' ? ids(conditionsAnswer(result.outcome).documents) : null, 'no inapplicable document is read').toEqual(['dna', 'empty', 'prot']);
    expect(calls, 'the motif engine read only the DNA record').toBe(1);
    // A single-condition run counts them the same way.
    const text = await runToEnd({ mode: 'Text', query: 'Doc', documents: [...kinds, ...single], folders: FOLDERS, filters: { length: { min: null, max: 10 } } });
    expect(text.filtering?.notApplicable).toHaveLength(kinds.length);
    expect(text.mode === 'Text' && 'results' in text.outcome ? ids(text.outcome.results) : null).toEqual(['dna', 'empty', 'prot']);
  });

  it('US-01M7DVHA AC5 reads one document per step with every condition evaluated in it, and a filtered-out document in none', async () => {
    const documents = [
      doc('s1', 'A', { sequence: 'GAATTCAAAAAA' }), doc('s2', 'A', { sequence: 'GGATCCAAAAAA' }),
      doc('s3', 'A', { sequence: 'AAAAAAAAAAAA', topology: 'circular' }), doc('s4', 'A', { sequence: 'GAATTCGGATCC' }),
    ];
    let step = 0;
    const calls: { step: number; seq: string; query: string }[] = [];
    const engine: MotifEngine = (seq, query, options) => { calls.push({ step, seq, query }); return searchIupacMotifRust(seq, query, options); };
    const rows: SearchCondition[] = [{ mode: 'Nucleotide motif', query: 'GAATTC' }, { mode: 'Text', query: 'Doc' }, { mode: 'Nucleotide motif', query: 'GGATCC' }];
    const result = await runToEnd({ mode: 'Conditions', conditions: rows, documents, folders: FOLDERS, bothStrands: true, engine, filters: { topology: 'linear' } }, () => { step += 1; });
    expect(step, 'one yield between every two documents').toBe(documents.length - 1);
    // Condition-major order (each condition over every document) would give steps 0,1,3 then 0,1,3.
    expect(calls.map((c) => [c.step, c.query])).toEqual([[0, 'GAATTC'], [0, 'GGATCC'], [1, 'GAATTC'], [1, 'GGATCC'], [3, 'GAATTC'], [3, 'GGATCC']]);
    for (const call of calls) expect(call.seq, `step ${call.step} reads its own document`).toBe(documents[call.step].sequence);
    if (result.mode !== 'Conditions') throw new Error('not a conditions run');
    const answer = conditionsAnswer(result.outcome);
    expect(ids(combineConditions(answer.documents, answer.conditions, 'ALL', false).results)).toEqual(['s4']);

    // US-01M7DVVS holds for the set: a newer run ends the older one, and stop() ends a run.
    const pending: (() => void)[] = [];
    const runner = createSearchRunner(() => new Promise<void>((resolve) => { pending.push(resolve); }));
    const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });
    const older: SearchRunEvent[] = [];
    const newer: SearchRunEvent[] = [];
    runner.start({ mode: 'Conditions', conditions: rows, documents, folders: FOLDERS, bothStrands: true, engine: searchIupacMotifRust }, (e) => older.push(e));
    runner.start({ mode: 'Conditions', conditions: rows.slice(0, 2), documents, folders: FOLDERS, bothStrands: true, engine: searchIupacMotifRust }, (e) => newer.push(e));
    pending[0](); await flush();
    expect(older, 'the older run is dropped at its next step').toEqual([{ kind: 'progress', reached: 1, total: 4 }]);
    while (pending.length > 1 && newer.every((e) => e.kind !== 'done')) { pending[pending.length - 1](); await flush(); }
    expect(newer.filter((e) => e.kind === 'done')).toHaveLength(1);
    const stopped: SearchRunEvent[] = [];
    runner.start({ mode: 'Conditions', conditions: rows, documents, folders: FOLDERS, bothStrands: true, engine: searchIupacMotifRust }, (e) => stopped.push(e));
    runner.stop();
    pending[pending.length - 1](); await flush();
    expect(stopped).toEqual([{ kind: 'progress', reached: 1, total: 4 }]);
  });
});

describe('BG-01M7MW9M an undated document is not applicable under a Modified date filter (D0183)', () => {
  const UNDATED_WORDS = 'Modified date does not apply: no readable modified date';
  const FROM_2000: SearchFilters = { modified: { from: '2000-01-01', to: null } };

  it('BG-01M7MW9M AC2 an empty or unparseable updatedAt is not applicable under a date filter, whatever the other filters say, in one exported sentence', () => {
    expect(NO_READABLE_MODIFIED_DATE, 'the words come from the exported constant').toBe(UNDATED_WORDS);
    const undated = [doc('blank', 'A', { sequence: 'ACGT' }), doc('garbled', 'A', { sequence: 'ACGT', updatedAt: 'last Tuesday' })];
    for (const d of undated) {
      expect(filterDocument(d, FROM_2000), d.id).toEqual({ notApplicable: UNDATED_WORDS });
      expect(filterDocument(d, { modified: { from: null, to: '2100-01-01' } }), `${d.id}: an upper bound alone`).toEqual({ notApplicable: UNDATED_WORDS });
      // Filters that would leave it out do not make it filtered out: the date cannot be read.
      for (const other of [{ documentType: 'Protein Sequence' }, { topology: 'circular' as const }, { length: { min: 50, max: null } }, { annotationType: 'CDS' }]) {
        expect(filterDocument(d, { ...other, ...FROM_2000 }), `${d.id}: ${JSON.stringify(other)}`).toEqual({ notApplicable: UNDATED_WORDS });
      }
      // With no date filter it passes, or is filtered out, as before.
      expect(filterDocument(d, {}), `${d.id}: no filter`).toBe('passes');
      expect(filterDocument(d, { topology: 'linear' }), `${d.id}: no date filter`).toBe('passes');
      expect(filterDocument(d, { topology: 'circular' }), `${d.id}: no date filter`).toBe('filtered out');
    }
    // Joined after the Topology and Length reasons, with '; '.
    const tree = doc('tree', 'A', { sequence: 'GAATTC', docMetadata: { Newick: '(a,b);' } });
    expect(filterDocument(tree, { topology: 'linear', ...FROM_2000 })).toEqual({ notApplicable: `Topology does not apply: tree (no sequence); ${UNDATED_WORDS}` });
    expect(filterDocument(tree, { topology: 'linear', length: { min: 1, max: null }, ...FROM_2000 }))
      .toEqual({ notApplicable: `Topology does not apply: tree (no sequence); Length does not apply: tree (no sequence); ${UNDATED_WORDS}` });
    // A dated tree under the same filters: its date is read, and only topology does not apply.
    expect(filterDocument({ ...tree, updatedAt: '2026-11-17T12:00:00Z' }, { topology: 'linear', ...FROM_2000 })).toEqual({ notApplicable: 'Topology does not apply: tree (no sequence)' });
    // A readable date is still compared: out of range is filtered out, in range passes.
    expect(filterDocument(doc('old', 'A', { updatedAt: '1999-06-01T12:00:00Z' }), FROM_2000)).toBe('filtered out');
    expect(filterDocument(doc('new', 'A', { updatedAt: '2026-11-17T12:00:00Z' }), FROM_2000)).toBe('passes');
  });

  it('BG-01M7MW9M AC2 in a run an undated document is listed apart, read by no condition and never counted as filtered out', async () => {
    const documents = [
      doc('blank', 'A', { sequence: 'GAATTC' }), doc('garbled', 'A', { sequence: 'GAATTC', updatedAt: 'not a date' }),
      doc('old', 'A', { sequence: 'GAATTC', updatedAt: '1999-06-01T12:00:00Z' }), doc('new', 'A', { sequence: 'GAATTC', updatedAt: '2026-11-17T12:00:00Z' }),
    ];
    let calls = 0;
    const engine: MotifEngine = (...args) => { calls += 1; return searchIupacMotifRust(...args); };
    const result = await runToEnd({ mode: 'Conditions', conditions: [{ mode: 'Text', query: 'Doc' }, MOTIF_ECO], documents, folders: FOLDERS, bothStrands: true, engine, filters: FROM_2000 });
    expect(result.filtering?.notApplicable.map((n) => [n.documentId, n.reason])).toEqual([['blank', UNDATED_WORDS], ['garbled', UNDATED_WORDS]]);
    expect(result.filtering?.filteredOut, 'only the readable date out of range').toBe(1);
    expect(result.filtering?.passed).toBe(1);
    expect(result.mode === 'Conditions' ? ids(conditionsAnswer(result.outcome).documents) : null, 'no undated document is read').toEqual(['new']);
    expect(calls, 'the motif engine read only the dated document in range').toBe(1);
    // With no date filter both undated documents are searched as before.
    const unfiltered = await runToEnd({ mode: 'Text', query: 'Doc', documents, folders: FOLDERS });
    expect(unfiltered.mode === 'Text' && 'results' in unfiltered.outcome ? ids(unfiltered.outcome.results) : null).toEqual(['blank', 'garbled', 'new', 'old']);
  });
});

describe('US-01M7DVZP: Primer Database records in a run, read from the request alone', () => {
  const record = (id: string, name: string, extra: Partial<DatabasePrimer> = {}): DatabasePrimer => ({
    id, name, sequence: 'CATCACTGAGG', originalInput: 'CATCACTGAGG', molecule: 'DNA', modifications: '', tail5Prime: 'CATCAC',
    description: '', labels: [], createdAt: '2026-11-16T09:00:00.000Z', modifiedAt: '2026-11-16T09:00:00.000Z', provenance: 'test', ...extra,
  });
  const runOnce = (request: SearchRequest) => new Promise<SearchRunEvent & { kind: 'done' }>((resolve) => {
    createSearchRunner(() => Promise.resolve()).start(request, (e) => { if (e.kind === 'done') resolve(e); });
  });

  it('US-01M7DVZP core searches the read the request carries, never storage, and never a trashed record', async () => {
    // No storage exists here: a run that read the store itself would answer "unavailable".
    expect((globalThis as { localStorage?: unknown }).localStorage).toBeUndefined();
    const primers = { ok: true as const, stored: true, records: [record('p1', 'zq one'), record('p2', 'zq gone', { trashedAt: '2026-11-16T10:00:00.000Z' })] };
    const done = await runOnce({ mode: 'Text', query: 'zq', documents: [doc('d1', 'A', { name: 'zq doc' })], folders: FOLDERS, primers });
    expect(done.result.primers).toEqual({
      searched: 1, trashed: 1,
      records: [{ record: primers.records[0], answers: [{ condition: 1, textHits: [{ fieldId: 'name', field: 'Name', value: 'zq one', start: 0, end: 2 }] }] }],
    });
    // The documents' answer is the one a run without records gives.
    const without = await runOnce({ mode: 'Text', query: 'zq', documents: [doc('d1', 'A', { name: 'zq doc' })], folders: FOLDERS });
    expect(done.result.outcome).toEqual(without.result.outcome);
    expect(without.result.primers).toBeUndefined();
  });

  it('US-01M7DVZP core places a hit by the tail boundary, 1-based and inclusive', () => {
    const tailed = { tail5Prime: 'CATCAC' };
    expect([[1, 6], [3, 6], [6, 7], [6, 10], [7, 7], [7, 11]].map(([s, e]) => primerHitPortion(tailed, s, e))).toEqual([
      "in the 5' tail", "in the 5' tail", "spans the 5' tail and the annealing portion",
      "spans the 5' tail and the annealing portion", 'in the annealing portion', 'in the annealing portion',
    ]);
    expect(primerHitPortion({ tail5Prime: '' }, 1, 1)).toBe('in the annealing portion');
  });

  it('US-01M7DVZP core an unreadable read is never searched, and a stale hit says why', () => {
    const searched = record('p1', 'zq one');
    const error = { kind: 'malformed' as const, message: 'cannot be read: not JSON', fields: [] };
    expect(openPrimerHit(searched, { ok: false, error })).toEqual({ refused: 'cannot be read: not JSON' });
    expect(openPrimerHit(searched, { ok: true, stored: true, records: [searched] })).toEqual({ opens: 'p1' });
    expect(openPrimerHit(searched, { ok: true, stored: true, records: [{ ...searched, modifiedAt: 'later' }] })).toEqual({ refused: changedAfterSearch('zq one') });
    expect(openPrimerHit(searched, { ok: true, stored: true, records: [{ ...searched, trashedAt: 'now' }] })).toEqual({ refused: deletedAfterSearch('zq one') });
    expect(openPrimerHit(searched, { ok: true, stored: true, records: [] })).toEqual({ refused: deletedAfterSearch('zq one') });
  });
});
