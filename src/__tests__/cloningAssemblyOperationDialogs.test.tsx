// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import {
  CloningOperationDialog, DeNovoOperationDialog, DE_NOVO_MAX_READS, FindOrfsOperationDialog,
} from '../components/CloningAssemblyOperationDialogs';
import { BlastSearchModal } from '../components/MenusPreferencesAndBlastModal';
import { saveLastUsed } from '../core/optionProfiles';
import { findORFs, simulateMolecularCloning } from '../core/bioEngine';
import { runDeNovoAssembly } from '../core/genomicsAndStructureSuite';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const noop = () => undefined;
const dnaDocs = SAMPLE_LIBRARY.filter((d) => d.moleculeType === 'DNA' && d.sequence.length > 0);
const plasmid = dnaDocs.find((d) => d.topology === 'circular' && d.sequence.length > 2000)!;

describe('Find ORFs window', () => {
  it('renders options and blocks protein input', () => {
    expect(renderToStaticMarkup(<FindOrfsOperationDialog doc={plasmid} onUpdate={noop} onClose={noop} />)).toContain('Minimum length');
    const prot = SAMPLE_LIBRARY.find((d) => d.moleculeType === 'Protein')!;
    expect(renderToStaticMarkup(<FindOrfsOperationDialog doc={prot} onUpdate={noop} onClose={noop} />))
      .toContain('Find ORFs needs a nucleotide sequence');
  });

  it('the engine finds ORFs on a plasmid (bla is > 250 aa)', () => {
    expect(findORFs(plasmid.sequence, 250, false).length).toBeGreaterThan(0);
  });
});

describe('Clone Insert into Vector window', () => {
  it('defaults vector and insert to different documents and lists methods', () => {
    const html = renderToStaticMarkup(<CloningOperationDialog candidates={dnaDocs} initialVectorId={plasmid.id} onCreate={noop} onClose={noop} />);
    expect(html).toContain('Golden Gate (Type IIS)');
    expect(html).toContain('cut the vector exactly once');
    // A plasmid vector is scanned with the whole catalog, so its line names no scope (BG-01M6S1D2).
    expect(html).toMatch(/>\d+ enzymes cut the vector exactly once\.</);
    expect(html).not.toContain('must be different documents');
  });

  it('refuses the same document as vector and insert', () => {
    const html = renderToStaticMarkup(<CloningOperationDialog candidates={[plasmid]} onCreate={noop} onClose={noop} />);
    expect(html).toContain('Choose a vector and an insert');
  });

  it('reports failure from the engine instead of returning the vector', () => {
    const out = simulateMolecularCloning(plasmid, plasmid, 'Restriction Ligation', 'NotARealEnzyme', 'NotARealEnzyme');
    expect(out.success).toBe(false);
  });
});

describe('De Novo Assemble window', () => {
  it('needs at least two reads and respects the merge limit', () => {
    expect(renderToStaticMarkup(<DeNovoOperationDialog reads={dnaDocs.slice(0, 1)} sourceLabel="x" onCreate={noop} onClose={noop} />))
      .toContain('at least two nucleotide sequences');
    const many = Array.from({ length: DE_NOVO_MAX_READS + 1 }, (_, i) => ({ ...dnaDocs[0], id: `r${i}` }));
    expect(renderToStaticMarkup(<DeNovoOperationDialog reads={many} sourceLabel="x" onCreate={noop} onClose={noop} />))
      .toContain('at most 1,000 reads per run');
  });

  it('assembles more than 64 tiled reads into one contig (former merge cap)', () => {
    // Non-repetitive generated sequence (real vectors such as lentiviral LTRs contain repeats
    // that any overlap assembler collapses).
    let x = 12345;
    const g = Array.from({ length: 8000 }, () => {
      x = (Math.imul(x, 1103515245) + 12345) >>> 0;
      return 'ACGT'[(x >>> 16) & 3];
    }).join('');
    const reads = Array.from({ length: 75 }, (_, i) => ({ name: `r${i}`, sequence: g.slice(i * 100, i * 100 + 500) }));
    const rep = runDeNovoAssembly(reads, 'CAP3', 30);
    expect(rep.contigCount).toBe(1);
    expect(rep.contigs[0].sequence).toBe(g.slice(0, 7900));
  });

  it('joins two overlapping reads into one contig', () => {
    const src = plasmid.sequence.slice(0, 600);
    const rep = runDeNovoAssembly([{ name: 'a', sequence: src.slice(0, 400) }, { name: 'b', sequence: src.slice(300) }], 'CAP3', 18);
    expect(rep.contigs[0].sequence).toBe(src);
  });
});

describe('BLAST remembers its options', () => {
  it('starts from the last-used program and shows the settings menu', () => {
    saveLastUsed('blast', { program: 'blastx', database: 'swissprot (UniProtKB / Swiss-Prot)' });
    const html = renderToStaticMarkup(<BlastSearchModal activeDoc={plasmid} allDocs={dnaDocs.slice(0, 5)} onClose={noop} onSelectHitDoc={noop} />);
    expect(html).toMatch(/<option value="blastx" selected="">/);
    expect(html).toContain('Search settings');
  });
});
