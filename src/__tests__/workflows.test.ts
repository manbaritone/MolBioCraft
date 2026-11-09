// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { beforeEach, describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { saveProfile } from '../core/optionProfiles';
import {
  allWorkflows, copyWorkflow, deleteWorkflow, EXAMPLE_WORKFLOWS, exportWorkflowsFile, importWorkflowsFile,
  loadUserWorkflows, resolveStepValues, runWorkflow, saveWorkflow, workflowInputProblem, type Workflow,
} from '../core/workflows';
import { phylogenySourceDocuments } from '../core/documentViews';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
}
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
});

const coxii = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
// The Ig variable region set (5 unaligned nucleotide members) stands in for the dropped
// fictitious-character People set (D0094).
const igVariable = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-ig-variable')!;
const ctx = { sourceLabel: 'Test' };

describe('workflow store', () => {
  it('saves, copies, deletes and round-trips through an exported file; examples are read-only', () => {
    expect(() => saveWorkflow(EXAMPLE_WORKFLOWS[0])).toThrow(/Built-in/);
    const copy = copyWorkflow(EXAMPLE_WORKFLOWS[0]);
    expect(copy.name).toMatch(/\(copy\)$/);
    expect(allWorkflows().length).toBe(EXAMPLE_WORKFLOWS.length + 1);
    const file = exportWorkflowsFile(loadUserWorkflows());
    deleteWorkflow(copy.id);
    expect(loadUserWorkflows()).toEqual([]);
    expect(importWorkflowsFile(file)).toBe(1);
    expect(loadUserWorkflows()[0].steps).toEqual(copy.steps);
    expect(() => importWorkflowsFile('{"x":1}')).toThrow(/not a MolBioCraft workflow/);
    expect(() => saveWorkflow({ id: '', name: 'empty', description: '', steps: [], keepIntermediate: true })).toThrow(/at least one step/);
  });

  it('resolves step options from defaults, custom values and saved profiles', () => {
    expect(resolveStepValues({ op: 'find-orfs', settings: { kind: 'custom', values: { minAa: 75 } } }).minAa).toBe(75);
    saveProfile('find-orfs', 'Short', { minAa: 30, altStart: true });
    expect(resolveStepValues({ op: 'find-orfs', settings: { kind: 'profile', name: 'Short' } })).toMatchObject({ minAa: 30, altStart: true });
    expect(() => resolveStepValues({ op: 'find-orfs', settings: { kind: 'profile', name: 'Gone' } })).toThrow(/no longer exists/);
  });
});

describe('running workflows', () => {
  it('align → bootstrap tree on unaligned sequences, keeping both results', async () => {
    const inputs = phylogenySourceDocuments(igVariable, [], SAMPLE_LIBRARY);
    const log: string[] = [];
    const r = await runWorkflow(EXAMPLE_WORKFLOWS[0], inputs, ctx, (l) => log.push(l.label));
    expect(log).toEqual(['Multiple Alignment', 'Build Tree']);
    expect(r.created.map((d) => d.documentKind)).toEqual(['alignment', 'tree']);
    expect(String(r.created[1].docMetadata?.['Branch support'])).toMatch(/bootstrap, 100 replicates/);
    // the tree was built from the step-1 alignment, not re-aligned
    expect(r.created[1].history[0].description).toMatch(/input alignment used as given/);
  });

  it('translation align → mask gaps → consensus keeps only the final document', async () => {
    const inputs = phylogenySourceDocuments(coxii, [], SAMPLE_LIBRARY).slice(0, 6);
    const r = await runWorkflow(EXAMPLE_WORKFLOWS[1], inputs, ctx);
    expect(r.created).toHaveLength(1);
    expect(r.created[0].name).toMatch(/consensus$/);
    expect(r.created[0].sequence).not.toContain('-');
  });

  it('per-document steps update existing documents, and a mismatched chain explains itself', async () => {
    const plasmids = SAMPLE_LIBRARY.filter((d) => d.topology === 'circular' && d.sequence.length > 2000).slice(0, 2);
    const r = await runWorkflow(EXAMPLE_WORKFLOWS[2], plasmids, ctx);
    expect(r.updated.map((d) => d.id).sort()).toEqual(plasmids.map((d) => d.id).sort());
    const bad: Workflow = { id: 'b', name: 'bad', description: '', keepIntermediate: true, steps: [{ op: 'generate-consensus', settings: { kind: 'defaults' } }] };
    expect(workflowInputProblem(bad, plasmids)).toMatch(/needs one aligned document/);
    expect(workflowInputProblem(bad, [coxii])).toBeNull();
  });
});

describe('options asked at run time', () => {
  it('uses the values entered in the Run window for "ask" steps', async () => {
    const plasmids = SAMPLE_LIBRARY.filter((d) => d.topology === 'circular' && d.sequence.length > 2000).slice(0, 1);
    const w: Workflow = { id: 'ask', name: 'ask', description: '', keepIntermediate: true, steps: [{ op: 'find-orfs', settings: { kind: 'ask' } }] };
    const strict = await runWorkflow(w, plasmids, ctx, undefined, { 0: { minAa: 400 } });
    const loose = await runWorkflow(w, plasmids, ctx, undefined, { 0: { minAa: 50 } });
    const count = (r: typeof strict) => r.updated[0].features.filter((f) => f.notes?.includes('Find ORFs')).length;
    expect(count(loose)).toBeGreaterThan(count(strict));
    expect(resolveStepValues({ op: 'find-orfs', settings: { kind: 'ask' } }, { minAa: 77 }).minAa).toBe(77);
  });
});
