// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0
import React, { useEffect, useState } from 'react';
import type { SequenceDocument } from '../types/bio';
import { hasBiologicalSequence, isTreeDocument } from '../core/documentViews';
import {
  CUSTOM_FIELD_KINDS, CUSTOM_FIELDS_EVENT, fieldDefinitionError, loadCustomFields, parseFieldValue, storeCustomFields,
  type CustomField, type CustomFieldKind,
} from '../core/customMetadata';

/** Custom metadata fields: values for this document, plus an inline manager for the definitions. */
export function CustomFieldsEditor({ doc, onUpdateDocument }: {
  doc: SequenceDocument; onUpdateDocument: (doc: SequenceDocument) => void;
}) {
  const [fields, setFields] = useState<CustomField[]>(() => loadCustomFields());
  useEffect(() => {
    const on = () => setFields(loadCustomFields());
    window.addEventListener(CUSTOM_FIELDS_EVENT, on);
    return () => window.removeEventListener(CUSTOM_FIELDS_EVENT, on);
  }, []);
  const current = (f: CustomField) => { const v = doc.docMetadata?.[f.name]; return v === undefined || v === null ? '' : String(v); };
  const [draft, setDraft] = useState<Record<string, string>>({});
  useEffect(() => { setDraft({}); }, [doc.id]);
  const [error, setError] = useState('');
  const [managing, setManaging] = useState(false);
  const [newName, setNewName] = useState('');
  const [newKind, setNewKind] = useState<CustomFieldKind>('text');
  const [newChoices, setNewChoices] = useState('');
  const dirty = fields.some((f) => draft[f.name] !== undefined && draft[f.name] !== current(f));
  const save = () => {
    const meta: Record<string, string | number> = { ...(doc.docMetadata ?? {}) } as Record<string, string | number>;
    for (const f of fields) {
      if (draft[f.name] === undefined) continue;
      const r = parseFieldValue(f, draft[f.name]);
      if ('error' in r) { setError(r.error); return; }
      if (r.value === null) delete meta[f.name]; else meta[f.name] = r.value;
    }
    setError('');
    setDraft({});
    onUpdateDocument({ ...doc, docMetadata: meta, updatedAt: new Date().toISOString() });
  };
  const addField = () => {
    const choices = newChoices.split(/[,;\n]/).map((c) => c.trim()).filter(Boolean);
    const err = fieldDefinitionError(newName, newKind, choices, fields);
    if (err) { setError(err); return; }
    const next = [...fields, { id: `cf-${Date.now().toString(36)}`, name: newName.trim(), kind: newKind, ...(newKind === 'choice' ? { choices } : {}) }];
    setFields(next);
    storeCustomFields(next);
    setNewName(''); setNewChoices(''); setError('');
  };
  return <section className="mbc-custom-fields" aria-label="Custom fields">
    <div className="mbc-custom-fields-head">
      <h4>Custom fields</h4>
      <button type="button" className="mbc-btn" onClick={() => setManaging((m) => !m)}>{managing ? 'Done' : 'Manage fields…'}</button>
    </div>
    {!fields.length && !managing && <p className="mbc-opdlg-muted">No custom fields yet. Use “Manage fields…” to define fields (text, numbers, dates, choice lists, yes/no) for all documents.</p>}
    {fields.length > 0 && <dl>{fields.map((f) => {
      const value = draft[f.name] ?? current(f);
      const set = (v: string) => setDraft((d) => ({ ...d, [f.name]: v }));
      const id = `cf-input-${f.id}`;
      return <div key={f.id}>
        <dt><label htmlFor={id}>{f.name}</label></dt>
        <dd>
          {f.kind === 'choice' || f.kind === 'boolean' ? (
            <select id={id} value={value} onChange={(e) => set(e.target.value)}>
              <option value="">—</option>
              {(f.kind === 'boolean' ? ['Yes', 'No'] : f.choices ?? []).map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <input id={id} type={f.kind === 'date' ? 'date' : f.kind === 'number' || f.kind === 'integer' ? 'number' : 'text'}
              step={f.kind === 'integer' ? 1 : 'any'} value={value} onChange={(e) => set(e.target.value)} />
          )}
          {managing && <button type="button" className="mbc-btn mbc-btn-ghost" aria-label={`Remove field ${f.name}`}
            onClick={() => { const next = fields.filter((x) => x.id !== f.id); setFields(next); storeCustomFields(next); }}>Remove field</button>}
        </dd>
      </div>;
    })}</dl>}
    {fields.length > 0 && <div><button type="button" className="mbc-btn primary" disabled={!dirty} onClick={save}>Save fields</button></div>}
    {managing && <div className="mbc-custom-fields-new">
      <input aria-label="New field name" placeholder="Field name" value={newName} onChange={(e) => setNewName(e.target.value)} />
      <select aria-label="New field type" value={newKind} onChange={(e) => setNewKind(e.target.value as CustomFieldKind)}>
        {Object.entries(CUSTOM_FIELD_KINDS).map(([k, label]) => <option key={k} value={k}>{label}</option>)}
      </select>
      {newKind === 'choice' && <input aria-label="Choices" placeholder="Choices, comma-separated" value={newChoices} onChange={(e) => setNewChoices(e.target.value)} />}
      <button type="button" className="mbc-btn" onClick={addField}>Add field</button>
      <span className="mbc-opdlg-muted">Fields apply to every document; removing a field keeps values already saved.</span>
    </div>}
    {error && <p role="alert" className="mbc-custom-fields-error">{error}</p>}
  </section>;
}

export function DocumentNotesEditor({ doc, onUpdateDocument }: {
  doc: SequenceDocument; onUpdateDocument: (doc: SequenceDocument) => void;
}) {
  const saved = String(doc.docMetadata?.Notes ?? '');
  const [notes, setNotes] = useState(saved);
  useEffect(() => { setNotes(saved); }, [doc.id, saved]);
  return <form className="mbc-document-notes" onSubmit={(event) => {
    event.preventDefault();
    if (notes === saved) return;
    onUpdateDocument({ ...doc, docMetadata: { ...doc.docMetadata, Notes: notes }, updatedAt: new Date().toISOString() });
  }}>
    <label htmlFor="document-notes">Notes</label>
    <textarea id="document-notes" value={notes} onChange={(event) => setNotes(event.target.value)}
      placeholder="Add source details, observations, or lab notes…" rows={7} />
    <div><button type="submit" className="mbc-btn primary" disabled={notes === saved}>Save notes</button>
      <span role="status">{notes !== saved ? 'Unsaved notes' : 'Notes saved with the project'}</span></div>
  </form>;
}

export function DocumentInfoPanel({ doc, onUpdateDocument }: {
  doc: SequenceDocument; onUpdateDocument: (doc: SequenceDocument) => void;
}) {
  const hasSequence = hasBiologicalSequence(doc);
  const unit = doc.moleculeType === 'Protein' ? 'aa' : doc.moleculeType === 'RNA' ? 'nt' : 'bp';
  // A record imported from a reference database carries the dates the database holds for it;
  // `createdAt`/`updatedAt` are only this workspace's own bookkeeping. Prefer the record's own
  // dates so the panel cannot show two different answers to the same question, and render the
  // bookkeeping fallback as a readable date rather than a raw ISO timestamp.
  const readableDate = (value: string) => {
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString(undefined, {
      day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  };
  const recordedCreated = doc.docMetadata?.Created;
  const recordedModified = doc.docMetadata?.Modified;
  const created = recordedCreated != null && recordedCreated !== ''
    ? String(recordedCreated) : readableDate(doc.createdAt);
  const modified = recordedModified != null && recordedModified !== ''
    ? String(recordedModified) : readableDate(doc.updatedAt);
  const customNames = new Set(loadCustomFields().map((f) => f.name));
  const fields: [string, string | number][] = [
    ['Name', doc.name], ['Description', doc.description], ['Folder', doc.folder],
    ['Accession', doc.accession],
    ['Document type', String(doc.docMetadata?.['Document Type'] ?? (isTreeDocument(doc) ? 'Tree' : doc.documentKind ?? doc.moleculeType))],
    ...(hasSequence ? [['Molecule', doc.moleculeType], ['Sequence length', `${doc.sequence.length.toLocaleString()} ${unit}`],
      ...(doc.moleculeType !== 'Protein' ? [['Topology', doc.topology]] : []),
      ['Annotations', doc.features.length], ...(doc.moleculeType === 'DNA' ? [['Primers', doc.primers.length]] : [])] as [string, string | number][] : []),
    ['Created', created], ['Modified', modified],
    // Created/Modified are listed above from the record itself, so they are not repeated here.
    ...Object.entries(doc.docMetadata ?? {}).filter(([key]) =>
      !['Notes', 'PDBText', 'Newick', 'Document Type', 'Created', 'Modified', 'Tree display'].includes(key) && !customNames.has(key)),
  ];
  return <section className="mbc-document-info" aria-label="Document information">
    <h3>Document information</h3>
    <dl>{fields.map(([name, value]) => <div key={name}>
      <dt>{name}</dt><dd>{value === '' ? 'Not recorded' : String(value)}</dd>
    </div>)}</dl>
    <CustomFieldsEditor doc={doc} onUpdateDocument={onUpdateDocument} />
    <DocumentNotesEditor doc={doc} onUpdateDocument={onUpdateDocument} />
  </section>;
}
