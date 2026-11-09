// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/** Workflows → Manage Workflows… and Workflows → Run Workflow… */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Copy, Download, Play, Plus, Trash2, Upload } from 'lucide-react';
import { StaticModalDialog } from './MenusPreferencesAndBlastModal';
import { OperationDialog, OptionRow } from './OperationDialog';
import { listProfiles, type OptionValues } from '../core/optionProfiles';
import {
  allWorkflows,
  copyWorkflow,
  deleteWorkflow,
  describeSettings,
  exportWorkflowsFile,
  importWorkflowsFile,
  loadUserWorkflows,
  resolveStepValues,
  runWorkflow,
  saveWorkflow,
  WORKFLOW_OP_IDS,
  WORKFLOW_OPS,
  WORKFLOWS_EVENT,
  workflowInputProblem,
  type StepSettings,
  type Workflow,
  type WorkflowOpId,
  type WorkflowRunResult,
  type WorkflowStep,
} from '../core/workflows';
import type { SequenceDocument } from '../types/bio';

function useWorkflows(): Workflow[] {
  const [list, setList] = useState<Workflow[]>(() => allWorkflows());
  useEffect(() => {
    const sync = () => setList(allWorkflows());
    window.addEventListener(WORKFLOWS_EVENT, sync);
    return () => window.removeEventListener(WORKFLOWS_EVENT, sync);
  }, []);
  return list;
}

const settingsKey = (s: StepSettings) => (s.kind === 'profile' ? `profile:${s.name}` : s.kind);

/** Editable fields for an operation's options (generic: checkbox / number / text by default type). */
function OptionFieldsGrid({ op, values, readOnly, onChange }: { op: WorkflowOpId; values: OptionValues; readOnly?: boolean; onChange: (v: OptionValues) => void }) {
  const spec = WORKFLOW_OPS[op];
  return (
    <div className="mbc-wf-custom-grid">
      {Object.entries(spec.defaults).filter(([k]) => k !== 'resultName').map(([k, def]) => {
        const val = values[k] ?? def;
        const set = (nv: string | number | boolean) => onChange({ ...values, [k]: nv });
        return (
          <label key={k} className="mbc-wf-custom-field">
            <span>{k}</span>
            {typeof def === 'boolean' ? (
              <input type="checkbox" disabled={readOnly} checked={Boolean(val)} onChange={(e) => set(e.target.checked)} />
            ) : typeof def === 'number' ? (
              <input type="number" disabled={readOnly} value={Number(val)} onChange={(e) => set(Number(e.target.value))} />
            ) : (
              <input type="text" disabled={readOnly} value={String(val)} onChange={(e) => set(e.target.value)} />
            )}
          </label>
        );
      })}
    </div>
  );
}

function StepSettingsEditor({ step, readOnly, onChange }: { step: WorkflowStep; readOnly: boolean; onChange: (s: StepSettings) => void }) {
  const spec = WORKFLOW_OPS[step.op];
  const profiles = listProfiles(step.op);
  const custom = step.settings.kind === 'custom' ? step.settings.values : null;
  return (
    <div className="mbc-wf-step-settings">
      <select
        aria-label="Options for this step"
        disabled={readOnly}
        value={settingsKey(step.settings)}
        onChange={(e) => {
          const k = e.target.value;
          if (k === 'defaults' || k === 'last-used' || k === 'ask') onChange({ kind: k });
          else if (k === 'custom') onChange({ kind: 'custom', values: { ...spec.defaults } });
          else onChange({ kind: 'profile', name: k.slice('profile:'.length) });
        }}
      >
        <option value="defaults">Default options</option>
        <option value="last-used">Options last used in its window</option>
        <option value="custom">Options set here</option>
        <option value="ask">Ask when the workflow runs</option>
        {profiles.length > 0 && (
          <optgroup label="Saved option profiles">
            {profiles.map((p) => <option key={p.name} value={`profile:${p.name}`}>{p.name}</option>)}
          </optgroup>
        )}
        {step.settings.kind === 'profile' && !profiles.some((p) => p.name === (step.settings as { name: string }).name) && (
          <option value={settingsKey(step.settings)}>{(step.settings as { name: string }).name} (missing)</option>
        )}
      </select>
      {custom && (
        <OptionFieldsGrid op={step.op} values={custom} readOnly={readOnly} onChange={(values) => onChange({ kind: 'custom', values })} />
      )}
    </div>
  );
}

// ───────────────────────────── Manage Workflows ─────────────────────────────

export interface ManageWorkflowsDialogProps {
  onRun: (workflowId: string) => void;
  onClose: () => void;
  onDownload: (content: string, fileName: string) => void;
}

const blankWorkflow = (): Workflow => ({ id: '', name: 'New workflow', description: '', steps: [{ op: 'align-multiple', settings: { kind: 'defaults' } }], keepIntermediate: true });

export const ManageWorkflowsDialog: React.FC<ManageWorkflowsDialogProps> = ({ onRun, onClose, onDownload }) => {
  const list = useWorkflows();
  const [selectedId, setSelectedId] = useState<string>(() => list[0]?.id ?? '');
  const [draft, setDraft] = useState<Workflow | null>(() => list[0] ?? null);
  const [dirty, setDirty] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [addOp, setAddOp] = useState<WorkflowOpId>('build-tree');
  const importRef = useRef<HTMLInputElement | null>(null);
  const readOnly = Boolean(draft?.builtIn);

  const select = (w: Workflow) => {
    setSelectedId(w.id);
    setDraft(w);
    setDirty(false);
    setError(null);
  };
  const update = (patch: Partial<Workflow>) => {
    if (!draft) return;
    setDraft({ ...draft, ...patch });
    setDirty(true);
    setNotice(null);
  };
  const updateStep = (i: number, s: WorkflowStep) => draft && update({ steps: draft.steps.map((x, j) => (j === i ? s : x)) });
  const move = (i: number, d: -1 | 1) => {
    if (!draft) return;
    const steps = [...draft.steps];
    const j = i + d;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    update({ steps });
  };
  const save = () => {
    if (!draft) return;
    try {
      const saved = saveWorkflow(draft);
      setSelectedId(saved.id);
      setDraft(saved);
      setDirty(false);
      setError(null);
      setNotice(`Saved "${saved.name}".`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <StaticModalDialog titleId="mbc-wf-manage" title="Manage Workflows" sizeClass="modal-size-prefs" onClose={onClose}>
      <div className="prefs-split-layout">
        <nav className="prefs-sidebar-nav" aria-label="Workflows">
          <ul className="prefs-sidebar-list" role="listbox" aria-label="Workflows">
            {list.map((w) => (
              <li key={w.id} role="presentation">
                <button type="button" role="option" aria-selected={w.id === selectedId}
                  className={`prefs-sidebar-item ${w.id === selectedId ? 'active' : ''}`} onClick={() => select(w)}>
                  {w.name}
                  {w.builtIn && <span className="mbc-opdlg-muted"> · example</span>}
                </button>
              </li>
            ))}
          </ul>
          <div className="mbc-wf-list-actions">
            <button type="button" className="btn-secondary-sm" onClick={() => { const w = blankWorkflow(); setSelectedId(''); setDraft(w); setDirty(true); setNotice(null); }}>
              <Plus size={13} /> New
            </button>
            <button type="button" className="btn-secondary-sm" disabled={!draft || !draft.id} onClick={() => {
              if (!draft) return;
              const c = copyWorkflow(draft);
              select(c);
              setNotice(`Copied to "${c.name}".`);
            }}><Copy size={13} /> Copy</button>
            <button type="button" className="btn-secondary-sm" disabled={!draft || readOnly || !draft.id} onClick={() => {
              if (!draft) return;
              deleteWorkflow(draft.id);
              const next = allWorkflows()[0] ?? null;
              if (next) select(next); else { setDraft(null); setSelectedId(''); }
              setNotice(`Deleted "${draft.name}".`);
            }}><Trash2 size={13} /> Delete</button>
            <button type="button" className="btn-secondary-sm" onClick={() => importRef.current?.click()}><Upload size={13} /> Import…</button>
            <button type="button" className="btn-secondary-sm" disabled={loadUserWorkflows().length === 0}
              onClick={() => onDownload(exportWorkflowsFile(loadUserWorkflows()), 'MolBioCraft_Workflows.json')}>
              <Download size={13} /> Export
            </button>
            <input ref={importRef} type="file" accept=".json,application/json" hidden onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              try {
                const n = importWorkflowsFile(await f.text());
                setNotice(`Imported ${n} workflow${n === 1 ? '' : 's'}.`);
                setError(null);
              } catch (err) {
                setError(err instanceof Error ? err.message : String(err));
              }
            }} />
          </div>
        </nav>

        <div className="prefs-pane-scroll">
          {!draft ? (
            <div className="info-callout">No workflow selected. Click New to create one.</div>
          ) : (
            <div className="prefs-section-stack">
              {readOnly && <div className="info-callout" role="note">This is a built-in example. Copy it to make changes.</div>}
              <OptionRow label="Name:" htmlFor="mbc-wf-name">
                <input id="mbc-wf-name" type="text" disabled={readOnly} value={draft.name} onChange={(e) => update({ name: e.target.value })} />
              </OptionRow>
              <OptionRow label="Description:" htmlFor="mbc-wf-desc">
                <input id="mbc-wf-desc" type="text" disabled={readOnly} value={draft.description} onChange={(e) => update({ description: e.target.value })} />
              </OptionRow>
              <fieldset className="prefs-fieldset">
                <legend>Steps (each step works on the documents the previous step produced)</legend>
                <ol className="mbc-wf-steps">
                  {draft.steps.map((s, i) => (
                    <li key={i} className="mbc-wf-step">
                      <div className="mbc-wf-step-head">
                        <span className="mbc-wf-step-num">{i + 1}</span>
                        <select aria-label={`Step ${i + 1} operation`} disabled={readOnly} value={s.op}
                          onChange={(e) => updateStep(i, { op: e.target.value as WorkflowOpId, settings: { kind: 'defaults' } })}>
                          {WORKFLOW_OP_IDS.map((op) => <option key={op} value={op}>{WORKFLOW_OPS[op].label}</option>)}
                        </select>
                        <span className="mbc-opdlg-muted">{describeSettings(s)}</span>
                        {!readOnly && (
                          <span className="mbc-wf-step-tools">
                            <button type="button" className="mbc-opdlg-icon-btn" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp size={13} /></button>
                            <button type="button" className="mbc-opdlg-icon-btn" aria-label={`Move step ${i + 1} down`} disabled={i === draft.steps.length - 1} onClick={() => move(i, 1)}><ArrowDown size={13} /></button>
                            <button type="button" className="mbc-opdlg-icon-btn" aria-label={`Remove step ${i + 1}`} disabled={draft.steps.length === 1}
                              onClick={() => update({ steps: draft.steps.filter((_, j) => j !== i) })}><Trash2 size={13} /></button>
                          </span>
                        )}
                      </div>
                      <StepSettingsEditor step={s} readOnly={readOnly} onChange={(settings) => updateStep(i, { ...s, settings })} />
                    </li>
                  ))}
                </ol>
                {!readOnly && (
                  <div className="prefs-row">
                    <select aria-label="Operation to add" value={addOp} onChange={(e) => setAddOp(e.target.value as WorkflowOpId)}>
                      {WORKFLOW_OP_IDS.map((op) => <option key={op} value={op}>{WORKFLOW_OPS[op].label}</option>)}
                    </select>
                    <button type="button" className="btn-secondary-sm" onClick={() => update({ steps: [...draft.steps, { op: addOp, settings: { kind: 'defaults' } }] })}>
                      <Plus size={13} /> Add step
                    </button>
                  </div>
                )}
              </fieldset>
              <label className="mbc-check-row">
                <input type="checkbox" disabled={readOnly} checked={draft.keepIntermediate} onChange={(e) => update({ keepIntermediate: e.target.checked })} />
                <span>Keep documents made by intermediate steps (otherwise only the last step’s results are saved)</span>
              </label>
              {notice && <div className="mbc-opdlg-notice" role="status">{notice}</div>}
              {error && <div className="info-callout" role="alert" style={{ color: 'var(--mbc-red)' }}>{error}</div>}
            </div>
          )}
        </div>
      </div>
      <div className="prefs-modal-footer">
        <span className="prefs-live-hint">{dirty ? 'Unsaved changes' : 'Workflows are stored on this computer; use Export to share them.'}</span>
        <div className="mbc-opdlg-footer-actions">
          {draft && !readOnly && <button type="button" className="btn-secondary-sm" disabled={!dirty} onClick={save}>Save</button>}
          <button type="button" className="btn-secondary-sm" disabled={!draft || dirty || !draft.id} title={dirty ? 'Save first' : undefined}
            onClick={() => draft && onRun(draft.id)}><Play size={13} /> Run…</button>
          <button type="button" className="btn-primary-sm" onClick={onClose}>Done</button>
        </div>
      </div>
    </StaticModalDialog>
  );
};

// ───────────────────────────── Run Workflow ─────────────────────────────

export interface RunWorkflowDialogProps {
  inputs: SequenceDocument[];
  sourceLabel: string;
  folder?: string;
  initialWorkflowId?: string;
  onDone: (result: WorkflowRunResult, workflow: Workflow) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const RunWorkflowDialog: React.FC<RunWorkflowDialogProps> = ({ inputs, sourceLabel, folder, initialWorkflowId, onDone, onClose, onDownload }) => {
  const list = useWorkflows();
  const [asked, setAsked] = useState<Record<string, Record<number, OptionValues>>>({});
  const byId = useMemo(() => new Map(list.map((w) => [w.id, w])), [list]);
  const first = initialWorkflowId && byId.has(initialWorkflowId) ? initialWorkflowId : list[0]?.id ?? '';
  return (
    <OperationDialog
      operationId="run-workflow"
      title="Run Workflow…"
      runLabel="Run"
      transientKeys={initialWorkflowId ? ['workflowId'] : []}
      defaults={{ workflowId: first }}
      onDownload={onDownload}
      summary={<span><strong>{inputs.length}</strong> document{inputs.length === 1 ? '' : 's'} from <strong>{sourceLabel}</strong></span>}
      validate={(v) => {
        const w = byId.get(String(v.workflowId));
        if (!w) return 'Choose a workflow (create one in Manage Workflows).';
        return workflowInputProblem(w, inputs);
      }}
      renderOptions={(v, set) => {
        const w = byId.get(String(v.workflowId));
        return (
          <>
            <OptionRow label="Workflow:" htmlFor="opdlg-wf-id" hint={w?.description || undefined}>
              <select id="opdlg-wf-id" value={String(v.workflowId)} onChange={(e) => set('workflowId', e.target.value)}>
                {list.map((x) => <option key={x.id} value={x.id}>{x.name}{x.builtIn ? ' (example)' : ''}</option>)}
              </select>
            </OptionRow>
            {w && (
              <OptionRow label="Steps:">
                <ol className="mbc-wf-steps mbc-wf-steps-compact">
                  {w.steps.map((s, i) => (
                    <li key={i}><strong>{WORKFLOW_OPS[s.op].label}</strong> <span className="mbc-opdlg-muted">({describeSettings(s)})</span></li>
                  ))}
                </ol>
                <span className="mbc-opdlg-muted">{w.keepIntermediate ? 'Documents from every step are kept.' : 'Only the last step’s documents are kept.'}</span>
              </OptionRow>
            )}
            {w && w.steps.map((s, i) => s.settings.kind !== 'ask' ? null : (
              <OptionRow key={`ask-${i}`} label={`Step ${i + 1}: ${WORKFLOW_OPS[s.op].label}`}>
                <OptionFieldsGrid op={s.op} values={asked[w.id]?.[i] ?? resolveStepValues(s)}
                  onChange={(nv) => setAsked((prev) => ({ ...prev, [w.id]: { ...(prev[w.id] ?? {}), [i]: nv } }))} />
              </OptionRow>
            ))}
          </>
        );
      }}
      onRun={async (v, signal) => {
        const w = byId.get(String(v.workflowId))!;
        const result = await runWorkflow(w, inputs, { sourceLabel, folder, signal }, undefined, asked[w.id] ?? {});
        if (!signal.aborted) onDone(result, w);
      }}
      onClose={onClose}
    />
  );
};
