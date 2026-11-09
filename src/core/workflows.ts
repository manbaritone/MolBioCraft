// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Workflows: saved chains of operations. Each step runs one operation with options taken
 * from its defaults, the last-used options, a saved option profile, or values stored in
 * the step. A step's output documents (created, or else updated) are the next step's input.
 */

import { listProfiles, loadLastUsed, sanitizeValues, type OptionValues } from './optionProfiles';
import {
  runBatchRename,
  runBuildTree,
  runConsensus,
  runDeNovo,
  runDigest,
  runFindOrfs,
  runMaskAlignment,
  runMultipleAlignment,
  runTranslationAlign,
  runTrimEnds,
  runBackTranslate,
  runMergePairedReads,
  runComputeDistances,
  type OperationResult,
  type RunContext,
} from './operationRunners';
import { ALIGNED_MEMBER_METADATA_KEY } from './documentViews';
import type { SequenceDocument } from '../types/bio';

export type WorkflowOpId =
  | 'align-multiple'
  | 'translation-align'
  | 'mask-alignment'
  | 'generate-consensus'
  | 'build-tree'
  | 'find-orfs'
  | 'digest-fragments'
  | 'de-novo-assemble'
  | 'batch-rename'
  | 'trim-ends'
  | 'back-translate'
  | 'merge-pairs'
  | 'compute-distances';

/** What a step consumes: a set of sequences, one aligned document, or each document separately. */
type InputShape = 'sequences' | 'alignment' | 'each';

export interface WorkflowOpSpec {
  label: string;
  input: InputShape;
  /** Default options (same keys as the operation's options window). */
  defaults: OptionValues;
  run: (inputs: SequenceDocument[], v: OptionValues, ctx: RunContext) => OperationResult | Promise<OperationResult>;
}

const perDoc = (fn: (d: SequenceDocument, v: OptionValues, ctx: RunContext) => OperationResult) =>
  (inputs: SequenceDocument[], v: OptionValues, ctx: RunContext): OperationResult => {
    const results = inputs.map((d) => fn(d, v, ctx));
    return {
      created: results.flatMap((r) => r.created),
      updated: results.flatMap((r) => r.updated),
      summary: results.map((r) => r.summary).join('; '),
    };
  };

export const WORKFLOW_OPS: Record<WorkflowOpId, WorkflowOpSpec> = {
  'align-multiple': { label: 'Multiple Alignment', input: 'sequences', defaults: { algorithm: '', resultName: '' }, run: runMultipleAlignment },
  'translation-align': { label: 'Translation Alignment', input: 'sequences', defaults: { frame: 1, geneticCode: 'Standard', algorithm: '', resultName: '' }, run: runTranslationAlign },
  'mask-alignment': {
    label: 'Mask Alignment', input: 'alignment',
    defaults: { content: 'all-gaps', gapPct: 50, codon1: false, codon2: false, codon3: false, charset: '', action: 'strip' },
    run: (inputs, v, ctx) => runMaskAlignment(inputs[0], v, ctx),
  },
  'generate-consensus': {
    label: 'Generate Consensus', input: 'alignment',
    defaults: { threshold: 'Majority', ignoreGaps: true, stripGaps: true, resultName: '' },
    run: (inputs, v, ctx) => runConsensus(inputs[0], v, ctx),
  },
  'build-tree': {
    label: 'Build Tree', input: 'sequences',
    defaults: { method: 'Neighbor-Joining (NJ)', model: 'Tamura-Nei (TN93)', resampling: 'none', replicates: 100, jackknifePct: 50, randomAdditions: 10, littleSamples: 10, littleSize: 0, alignFirst: '', outgroup: '', gaps: 'pairwise', coveragePct: 95, pos1: true, pos2: true, pos3: true, resultName: '' },
    run: runBuildTree,
  },
  'find-orfs': {
    label: 'Find ORFs', input: 'each',
    defaults: { minAa: 100, altStart: false, strands: 'both', annotateAs: 'misc_feature', replace: true },
    run: perDoc((d, v) => runFindOrfs(d, v)),
  },
  'digest-fragments': { label: 'Digest into Fragments', input: 'each', defaults: { enzymes: '', keepAnnotations: true }, run: perDoc((d, v) => runDigest(d, v)) },
  'back-translate': { label: 'Back-Translate', input: 'sequences', defaults: { mode: 'likely', host: 'ecoli', geneticCode: 'Standard', addStop: false }, run: runBackTranslate },
  'compute-distances': {
    label: 'Compute Distances', input: 'sequences',
    defaults: { analysis: 'pairwise', model: 'Maximum Composite Likelihood (MCL)', withSE: false, alignFirst: '', gaps: 'pairwise', coveragePct: 95, pos1: true, pos2: true, pos3: true, resultName: '' },
    run: runComputeDistances,
  },
  'merge-pairs': { label: 'Merge Paired Reads', input: 'sequences', defaults: { minOverlap: 20, maxMismatchPct: 10 }, run: runMergePairedReads },
  'trim-ends': {
    label: 'Trim Ends', input: 'sequences',
    defaults: { minQuality: 20, trimAdapters: true, trimLowComplexity: true, action: 'copy', minLength: 50 },
    run: runTrimEnds,
  },
  'de-novo-assemble': { label: 'De Novo Assemble', input: 'sequences', defaults: { minOverlap: 18, keepSingletons: false }, run: runDeNovo },
  'batch-rename': {
    label: 'Batch Rename', input: 'sequences',
    defaults: { field: 'name', template: '{name}', prefix: '', suffix: '', find: '', replace: '', counterStart: 1 },
    run: (inputs, v) => runBatchRename(inputs, v),
  },
};

export const WORKFLOW_OP_IDS = Object.keys(WORKFLOW_OPS) as WorkflowOpId[];

/** Where a step's options come from when it runs. */
export type StepSettings =
  | { kind: 'defaults' }
  | { kind: 'last-used' }
  | { kind: 'profile'; name: string }
  | { kind: 'custom'; values: OptionValues }
  /** Shown in the Run Workflow window (starting from the last-used options) each time it runs. */
  | { kind: 'ask' };

export interface WorkflowStep {
  op: WorkflowOpId;
  settings: StepSettings;
}

export interface Workflow {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  /** Keep documents made by intermediate steps (otherwise only the last step's results are kept). */
  keepIntermediate: boolean;
  /** Built-in examples cannot be edited or deleted (copy them instead). */
  builtIn?: boolean;
}

export const EXAMPLE_WORKFLOWS: Workflow[] = [
  {
    id: 'example-align-tree',
    name: 'Align and build a bootstrap tree',
    description: 'Multiple alignment (2 refinement passes), then a Neighbor-Joining tree with 100 bootstrap replicates.',
    steps: [
      { op: 'align-multiple', settings: { kind: 'custom', values: { algorithm: 'MAFFT (FFT-NS-i / L-INS-i)' } } },
      { op: 'build-tree', settings: { kind: 'custom', values: { method: 'Neighbor-Joining (NJ)', resampling: 'bootstrap', replicates: 100 } } },
    ],
    keepIntermediate: true,
    builtIn: true,
  },
  {
    id: 'example-codon-consensus',
    name: 'Translation-align coding sequences, strip gaps, consensus',
    description: 'Codon-preserving alignment, remove columns with ≥ 50% gaps, then a majority consensus.',
    steps: [
      { op: 'translation-align', settings: { kind: 'defaults' } },
      { op: 'mask-alignment', settings: { kind: 'custom', values: { content: 'gap-pct', gapPct: 50, action: 'strip' } } },
      { op: 'generate-consensus', settings: { kind: 'defaults' } },
    ],
    keepIntermediate: false,
    builtIn: true,
  },
  {
    id: 'example-orfs',
    name: 'Annotate ORFs ≥ 100 aa',
    description: 'Find ORFs on every selected sequence (both strands, ATG starts).',
    steps: [{ op: 'find-orfs', settings: { kind: 'custom', values: { minAa: 100 } } }],
    keepIntermediate: true,
    builtIn: true,
  },
];

const KEY = 'molbiocraft.workflows.v1';
const FILE_FORMAT = 'molbiocraft-workflows';
export const WORKFLOWS_EVENT = 'molbiocraft:workflows';

function isStep(s: unknown): s is WorkflowStep {
  const x = s as WorkflowStep;
  return !!x && typeof x.op === 'string' && x.op in WORKFLOW_OPS && !!x.settings && typeof x.settings.kind === 'string';
}

function normalize(w: Partial<Workflow>): Workflow | null {
  if (!w || typeof w.name !== 'string' || !Array.isArray(w.steps)) return null;
  const steps = w.steps.filter(isStep);
  if (!steps.length) return null;
  return {
    id: typeof w.id === 'string' && w.id ? w.id : `wf-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    name: w.name.trim() || 'Untitled workflow',
    description: typeof w.description === 'string' ? w.description : '',
    steps,
    keepIntermediate: w.keepIntermediate !== false,
  };
}

export function loadUserWorkflows(): Workflow[] {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const list = raw ? (JSON.parse(raw) as unknown[]) : [];
    return Array.isArray(list) ? list.map((w) => normalize(w as Partial<Workflow>)).filter((w): w is Workflow => !!w) : [];
  } catch {
    return [];
  }
}

function saveAll(list: Workflow[]) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify(list));
  } catch {
    // storage unavailable
  }
  try {
    globalThis.dispatchEvent?.(new CustomEvent(WORKFLOWS_EVENT));
  } catch {
    // no event target
  }
}

export function allWorkflows(): Workflow[] {
  return [...EXAMPLE_WORKFLOWS, ...loadUserWorkflows()];
}

export function saveWorkflow(w: Workflow): Workflow {
  if (w.builtIn) throw new Error('Built-in example workflows cannot be changed; make a copy first.');
  const n = normalize(w);
  if (!n) throw new Error('A workflow needs a name and at least one step.');
  const list = loadUserWorkflows();
  saveAll(list.some((x) => x.id === n.id) ? list.map((x) => (x.id === n.id ? n : x)) : [...list, n]);
  return n;
}

export function deleteWorkflow(id: string): void {
  saveAll(loadUserWorkflows().filter((w) => w.id !== id));
}

export function copyWorkflow(w: Workflow): Workflow {
  return saveWorkflow({ ...w, id: '', name: `${w.name} (copy)`, builtIn: undefined });
}

export function exportWorkflowsFile(list: Workflow[]): string {
  return JSON.stringify({ format: FILE_FORMAT, version: 1, workflows: list.map(({ builtIn: _b, ...w }) => w) }, null, 2);
}

/** Imports workflows (new ids, so nothing is overwritten). Returns how many were added. */
export function importWorkflowsFile(text: string): number {
  let parsed: { format?: string; workflows?: unknown[] };
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('This is not a MolBioCraft workflow file (invalid JSON).');
  }
  if (parsed?.format !== FILE_FORMAT || !Array.isArray(parsed.workflows)) throw new Error('This is not a MolBioCraft workflow file.');
  const incoming = parsed.workflows.map((w) => normalize({ ...(w as Partial<Workflow>), id: '' })).filter((w): w is Workflow => !!w);
  saveAll([...loadUserWorkflows(), ...incoming]);
  return incoming.length;
}

/** The option values a step will run with right now. */
export function resolveStepValues(step: WorkflowStep, asked?: OptionValues): OptionValues {
  const spec = WORKFLOW_OPS[step.op];
  const s = step.settings;
  if (s.kind === 'ask') return sanitizeValues(spec.defaults, asked ?? loadLastUsed(step.op, spec.defaults));
  if (s.kind === 'last-used') return loadLastUsed(step.op, spec.defaults);
  if (s.kind === 'profile') {
    const p = listProfiles(step.op).find((x) => x.name === s.name);
    if (!p) throw new Error(`${spec.label}: option profile "${s.name}" no longer exists.`);
    return sanitizeValues(spec.defaults, p.values);
  }
  if (s.kind === 'custom') return sanitizeValues(spec.defaults, s.values);
  return { ...spec.defaults };
}

export function describeSettings(step: WorkflowStep): string {
  const s = step.settings;
  if (s.kind === 'last-used') return 'last-used options';
  if (s.kind === 'ask') return 'asked when run';
  if (s.kind === 'profile') return `profile "${s.name}"`;
  if (s.kind === 'custom') {
    const d = WORKFLOW_OPS[step.op].defaults;
    const changed = Object.entries(s.values).filter(([k, v]) => k in d && d[k] !== v);
    return changed.length ? changed.map(([k, v]) => `${k}=${String(v)}`).join(', ') : 'defaults';
  }
  return 'defaults';
}

/** Expands a single aligned document into its member rows (marked as already aligned). */
function asSequences(docs: SequenceDocument[]): SequenceDocument[] {
  if (docs.length !== 1) return docs;
  const d = docs[0];
  const members = d.alignmentMeta?.sequences ?? [];
  if (members.length < 2) return docs;
  const aligned = d.alignmentMeta?.isAligned !== false;
  return members.map((m) => ({
    ...d,
    id: m.id,
    name: m.name,
    accession: m.accession ?? '',
    description: m.description ?? '',
    sequence: m.sequence,
    features: m.features ?? [],
    primers: [],
    alignmentMeta: undefined,
    documentKind: d.moleculeType === 'Protein' ? 'protein' : 'linear-dna',
    docMetadata: aligned ? { [ALIGNED_MEMBER_METADATA_KEY]: 1 } : undefined,
  }));
}

export interface WorkflowRunLog {
  step: number;
  label: string;
  settings: string;
  summary: string;
}

export interface WorkflowRunResult {
  created: SequenceDocument[];
  updated: SequenceDocument[];
  log: WorkflowRunLog[];
}

/** Checks the first step can accept these inputs (later steps are checked as they run). */
export function workflowInputProblem(w: Workflow, inputs: SequenceDocument[]): string | null {
  if (!w.steps.length) return 'This workflow has no steps.';
  if (!inputs.length) return 'Select the documents to run the workflow on.';
  const first = WORKFLOW_OPS[w.steps[0].op];
  if (first.input === 'alignment' && !(inputs.length === 1 && (inputs[0].alignmentMeta?.sequences?.length ?? 0) > 1)) {
    return `The first step (${first.label}) needs one aligned document; select an alignment, or add Multiple Alignment as the first step.`;
  }
  return null;
}

export async function runWorkflow(
  w: Workflow,
  inputs: SequenceDocument[],
  ctx: RunContext,
  onStep?: (log: WorkflowRunLog) => void,
  /** Values entered in the Run Workflow window for 'ask' steps, by step index. */
  asked: Record<number, OptionValues> = {}
): Promise<WorkflowRunResult> {
  const problem = workflowInputProblem(w, inputs);
  if (problem) throw new Error(problem);
  let current = inputs;
  const created: SequenceDocument[] = [];
  const updated = new Map<string, SequenceDocument>();
  const log: WorkflowRunLog[] = [];
  for (let i = 0; i < w.steps.length; i++) {
    if (ctx.signal?.aborted) throw new Error('Cancelled.');
    const step = w.steps[i];
    const spec = WORKFLOW_OPS[step.op];
    const values = resolveStepValues(step, asked[i]);
    let stepInputs = current;
    if (spec.input === 'sequences') stepInputs = asSequences(current);
    if (spec.input === 'alignment') {
      if (current.length !== 1 || (current[0].alignmentMeta?.sequences?.length ?? 0) < 2) {
        throw new Error(`Step ${i + 1} (${spec.label}) needs one aligned document, but step ${i} produced ${current.length} document${current.length === 1 ? '' : 's'}.`);
      }
    }
    let r: OperationResult;
    try {
      r = await spec.run(stepInputs, values, { ...ctx, sourceLabel: i === 0 ? ctx.sourceLabel : current.length === 1 ? current[0].name : ctx.sourceLabel });
    } catch (e) {
      throw new Error(`Step ${i + 1} (${spec.label}) failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    const isLast = i === w.steps.length - 1;
    if (w.keepIntermediate || isLast) created.push(...r.created);
    // Updates to documents that exist in the project are kept; updates to documents
    // created earlier in this run replace them in the created list.
    for (const u of r.updated) {
      if (stepInputs.includes(u) || current.includes(u)) continue; // passed through unchanged
      const idx = created.findIndex((c) => c.id === u.id);
      if (idx >= 0) created[idx] = u;
      else updated.set(u.id, u);
    }
    const entry = { step: i + 1, label: spec.label, settings: describeSettings(step), summary: r.summary };
    log.push(entry);
    onStep?.(entry);
    current = r.created.length ? r.created : r.updated;
    if (!current.length && !isLast) throw new Error(`Step ${i + 1} (${spec.label}) produced no documents for the next step.`);
  }
  return { created, updated: Array.from(updated.values()), log };
}
