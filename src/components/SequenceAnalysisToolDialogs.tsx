// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Primers → Design Degenerate Primers… (on an alignment) and
 * Annotate → Annotate from Documents… (features copied from reference documents).
 */

import React, { useMemo, useState } from 'react';
import { OperationDialog, OptionRow } from './OperationDialog';
import { alignmentRowsOf, runCalculateExpressionLevels, runFindStructuralVariants, runCrisprEditing, runAnnotateByBlast, runAnnotateFromDocuments, runDesignDegeneratePrimers, runImportPrimers, type OperationResult } from '../core/operationRunners';
import { featuresTooLongToTransfer, MAX_TRANSFERRED_FEATURE_BP } from '../core/annotateFromDocuments';
import { parsePrimerSpreadsheet } from '../core/primerImport';
import type { LocalSequenceDbEntry } from '../core/localBlastDb';
import { DEGENERATE_DEFAULTS } from '../core/degeneratePrimers';
import type { SequenceDocument } from '../types/bio';

const numInput = (id: string, value: number, set: (n: number) => void, min: number, max: number, width = 64, step: number | 'any' = 1) => (
  <input id={id} type="number" min={min} max={max} step={step} style={{ width }} value={value}
    onChange={(e) => set(Math.max(min, Math.min(max, Number(e.target.value) || min)))} />
);

export interface DegeneratePrimersDialogProps {
  doc: SequenceDocument;
  onApply: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const DegeneratePrimersDialog: React.FC<DegeneratePrimersDialogProps> = ({ doc, onApply, onClose, onDownload }) => {
  const rows = alignmentRowsOf(doc);
  const width = rows?.[0]?.sequence.length ?? 0;
  return (
    <OperationDialog
      operationId="degenerate-primers"
      title="Design Degenerate Primers…"
      runLabel="Design"
      transientKeys={['resultName', 'regionStart', 'regionEnd']}
      defaults={{ ...DEGENERATE_DEFAULTS, savePrimerDocs: false, prefix: '', resultName: '' }}
      onDownload={onDownload}
      summary={rows
        ? <span><strong>{doc.name}</strong> · {rows.length} sequences × {width.toLocaleString()} columns. Bases that differ between sequences become IUPAC codes.</span>
        : <span>Open an aligned nucleotide document first.</span>}
      validate={(v) => {
        if (!rows) return 'Design Degenerate Primers works on an alignment.';
        if (doc.moleculeType === 'Protein') return 'Primers need a nucleotide alignment.';
        if (Number(v.minLen) > Number(v.maxLen)) return 'Minimum length is above the maximum.';
        if (Number(v.tmMin) > Number(v.tmMax)) return 'Minimum Tm is above the maximum.';
        if (Number(v.productMin) > Number(v.productMax)) return 'Minimum product size is above the maximum.';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Primer length:" htmlFor="opdlg-dp-minlen">
            <div className="prefs-row">
              {numInput('opdlg-dp-minlen', Number(v.minLen), (n) => set('minLen', n), 12, 40)}<span>–</span>
              {numInput('opdlg-dp-maxlen', Number(v.maxLen), (n) => set('maxLen', n), 12, 40)}<span>bases</span>
            </div>
          </OptionRow>
          <OptionRow label="Tm:" htmlFor="opdlg-dp-tmmin" hint="Every version of the primer (lowest to highest GC) should fall in this range.">
            <div className="prefs-row">
              {numInput('opdlg-dp-tmmin', Number(v.tmMin), (n) => set('tmMin', n), 30, 80)}<span>–</span>
              {numInput('opdlg-dp-tmmax', Number(v.tmMax), (n) => set('tmMax', n), 30, 85)}<span>°C</span>
            </div>
          </OptionRow>
          <OptionRow label="Degeneracy:" htmlFor="opdlg-dp-deg" hint="Maximum number of distinct sequences in one degenerate primer; the last bases at the 3′ end must be exact.">
            <div className="prefs-row">
              <span>at most</span>{numInput('opdlg-dp-deg', Number(v.maxDegeneracy), (n) => set('maxDegeneracy', n), 1, 4096, 76)}
              <span>· exact 3′ bases</span>{numInput('opdlg-dp-exact', Number(v.exact3Prime), (n) => set('exact3Prime', n), 0, 8, 52)}
            </div>
          </OptionRow>
          <OptionRow label="Include bases in ≥" htmlFor="opdlg-dp-incl" hint="Rarer bases in a column are ignored (they will mismatch the primer).">
            <div className="prefs-row">{numInput('opdlg-dp-incl', Number(v.inclusionPct), (n) => set('inclusionPct', n), 0, 50)}<span>% of sequences</span></div>
          </OptionRow>
          <OptionRow label="Product size:" htmlFor="opdlg-dp-pmin">
            <div className="prefs-row">
              {numInput('opdlg-dp-pmin', Number(v.productMin), (n) => set('productMin', n), 40, 100000, 80)}<span>–</span>
              {numInput('opdlg-dp-pmax', Number(v.productMax), (n) => set('productMax', n), 40, 100000, 80)}<span>columns · pairs</span>
              {numInput('opdlg-dp-pairs', Number(v.pairs), (n) => set('pairs', n), 1, 20, 52)}
            </div>
          </OptionRow>
          <OptionRow label="Output:">
            <label className="mbc-check-row">
              <input type="checkbox" checked={Boolean(v.savePrimerDocs)} onChange={(e) => set('savePrimerDocs', e.target.checked)} />
              <span>Also save each primer as a primer document</span>
            </label>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <>
          <OptionRow label="Target region:" htmlFor="opdlg-dp-rs" hint="Alignment columns the product must lie in (0 = whole alignment).">
            <div className="prefs-row">
              {numInput('opdlg-dp-rs', Number(v.regionStart), (n) => set('regionStart', n), 0, width, 80)}<span>–</span>
              {numInput('opdlg-dp-re', Number(v.regionEnd), (n) => set('regionEnd', n), 0, width, 80)}
            </div>
          </OptionRow>
          <OptionRow label="Primer names:" htmlFor="opdlg-dp-prefix">
            <input id="opdlg-dp-prefix" type="text" placeholder={doc.name.replace(/\s+/g, '_').slice(0, 20)} value={String(v.prefix)} onChange={(e) => set('prefix', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => onApply(runDesignDegeneratePrimers(doc, v, { sourceLabel: doc.name, folder: doc.folder }))}
      onClose={onClose}
    />
  );
};

export interface AnnotateFromDocumentsDialogProps {
  targets: SequenceDocument[];
  candidates: SequenceDocument[];
  onApply: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const AnnotateFromDocumentsDialog: React.FC<AnnotateFromDocumentsDialogProps> = ({ targets, candidates, onApply, onClose, onDownload }) => {
  const [query, setQuery] = useState('');
  const refs = useMemo(() => candidates.filter((c) => !targets.some((t) => t.id === c.id) && c.moleculeType !== 'Protein' && c.sequence.length > 0
    && c.features.some((f) => f.type !== 'source')), [candidates, targets]);
  const shown = refs.filter((r) => !query || r.name.toLowerCase().includes(query.toLowerCase())).slice(0, 200);
  /** How many features of the chosen references are too long to transfer (BG-01M6S1Q9). */
  const tooLong = (chosen: readonly string[]) => featuresTooLongToTransfer(refs.filter((r) => chosen.includes(r.id)));
  return (
    <OperationDialog
      operationId="annotate-from-documents"
      title="Annotate from Documents…"
      runLabel="Annotate"
      transientKeys={['references']}
      defaults={{ references: '[]', minIdentity: 90, minLength: 15, replace: true }}
      onDownload={onDownload}
      summary={<span>Annotate <strong>{targets.length}</strong> sequence{targets.length === 1 ? '' : 's'}{targets.length === 1 ? ` (${targets[0].name})` : ''} with features found in reference documents (both strands; circular sequences across the origin). Features longer than {MAX_TRANSFERRED_FEATURE_BP.toLocaleString()} bp are not transferred.</span>}
      validate={(v) => {
        const chosen = (() => { try { return JSON.parse(String(v.references)) as string[]; } catch { return []; } })();
        if (!targets.length) return 'Select the sequences to annotate.';
        if (!chosen.length) return 'Tick at least one reference document.';
        return null;
      }}
      renderOptions={(v, set) => {
        const chosen: string[] = (() => { try { return JSON.parse(String(v.references)) as string[]; } catch { return []; } })();
        const toggle = (id: string) => set('references', JSON.stringify(chosen.includes(id) ? chosen.filter((x) => x !== id) : [...chosen, id]));
        const skipped = tooLong(chosen);
        return (
          <>
            <OptionRow label="Reference documents:" hint={`${refs.length} annotated nucleotide documents in the project; ${chosen.length} chosen.${
              skipped > 0
                ? ` ${skipped.toLocaleString()} of their features are longer than ${MAX_TRANSFERRED_FEATURE_BP.toLocaleString()} bp and will not be transferred.`
                : ''
            }`}>
              <div style={{ display: 'grid', gap: 4, width: '100%' }}>
                <input type="search" placeholder="Filter by name…" value={query} onChange={(e) => setQuery(e.target.value)} />
                <div style={{ maxHeight: 180, overflow: 'auto', border: '1px solid var(--mbc-border)', borderRadius: 4, padding: 4 }}>
                  {shown.map((r) => (
                    <label key={r.id} className="mbc-check-row" style={{ display: 'flex' }}>
                      <input type="checkbox" checked={chosen.includes(r.id)} onChange={() => toggle(r.id)} />
                      <span>{r.name} <span className="mbc-opdlg-muted">· {r.features.filter((f) => f.type !== 'source').length} features</span></span>
                    </label>
                  ))}
                  {!shown.length && <span className="mbc-opdlg-muted">No annotated documents match.</span>}
                </div>
              </div>
            </OptionRow>
            <OptionRow label="Minimum identity:" htmlFor="opdlg-afd-id" hint="Over the whole length of the reference feature.">
              <div className="prefs-row">{numInput('opdlg-afd-id', Number(v.minIdentity), (n) => set('minIdentity', n), 50, 100)}<span>%</span>
                <span>· features of at least</span>{numInput('opdlg-afd-len', Number(v.minLength), (n) => set('minLength', n), 6, MAX_TRANSFERRED_FEATURE_BP, 70)}<span>bp</span></div>
            </OptionRow>
            <OptionRow label="Existing:">
              <label className="mbc-check-row">
                <input type="checkbox" checked={v.replace !== false} onChange={(e) => set('replace', e.target.checked)} />
                <span>Replace annotations added by an earlier run</span>
              </label>
            </OptionRow>
          </>
        );
      }}
      onRun={(v) => {
        const chosen: string[] = (() => { try { return JSON.parse(String(v.references)) as string[]; } catch { return []; } })();
        onApply(runAnnotateFromDocuments(targets, refs.filter((r) => chosen.includes(r.id)), v));
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Import Primers ─────────────────────────────

export interface ImportPrimersDialogProps {
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
}

export const ImportPrimersDialog: React.FC<ImportPrimersDialogProps> = ({ onCreate, onClose }) => {
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const preview = useMemo(() => (text.trim() ? parsePrimerSpreadsheet(text) : null), [text]);
  return (
    <OperationDialog
      operationId="import-primers"
      title="Import Primers from Spreadsheet…"
      runLabel="Import"
      transientKeys={[]}
      defaults={{ folder: 'Primers' }}
      summary={<span>Paste rows or choose a CSV / TSV file: a name column and a sequence column (a header row is optional; extra columns such as notes become the description).</span>}
      validate={() => (!preview ? 'Paste primer rows or choose a file.' : !preview.rows.length ? 'No valid primer rows found.' : null)}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Primer list:" htmlFor="opdlg-ip-text">
            <div style={{ display: 'grid', gap: 6, width: '100%' }}>
              <textarea id="opdlg-ip-text" rows={7} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={'name,sequence,notes\nM13F,GTAAAACGACGGCCAGT,universal forward'} style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }} />
              <div className="prefs-row">
                <label className="mbc-btn">
                  Choose file…
                  <input type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values" style={{ display: 'none' }}
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (!f) return;
                      setFileName(f.name);
                      void f.text().then(setText);
                    }} />
                </label>
                {fileName && <span className="mbc-opdlg-muted">{fileName}</span>}
              </div>
            </div>
          </OptionRow>
          {preview && (
            <OptionRow label="Preview:">
              <div className="mbc-opdlg-muted" style={{ paddingTop: 4 }}>
                {preview.rows.length} primer{preview.rows.length === 1 ? '' : 's'}
                {preview.rows.length ? ` (${preview.rows.slice(0, 3).map((r) => r.name).join(', ')}${preview.rows.length > 3 ? ', …' : ''})` : ''}
                {preview.skipped.length ? ` · ${preview.skipped.length} skipped: ${preview.skipped.slice(0, 3).map((s) => `line ${s.line} ${s.reason}`).join('; ')}` : ''}
              </div>
            </OptionRow>
          )}
          <OptionRow label="Folder:" htmlFor="opdlg-ip-folder">
            <input id="opdlg-ip-folder" type="text" value={String(v.folder)} onChange={(e) => set('folder', e.target.value)} />
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runImportPrimers(text, v))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Annotate by BLAST ─────────────────────────────

export interface AnnotateByBlastDialogProps {
  targets: SequenceDocument[];
  databases: { id: string; name: string; docs: SequenceDocument[] }[];
  onApply: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const AnnotateByBlastDialog: React.FC<AnnotateByBlastDialogProps> = ({ targets, databases, onApply, onClose, onDownload }) => (
  <OperationDialog
    operationId="annotate-by-blast"
    title="Annotate by BLAST…"
    runLabel="Annotate"
    defaults={{ database: databases[0]?.id ?? '', maxHits: 5, minHitIdentity: 80, minIdentity: 90, minLength: 15, replace: true }}
    onDownload={onDownload}
    summary={<span>BLAST <strong>{targets.length}</strong> sequence{targets.length === 1 ? '' : 's'} against a local database, then copy the annotations of the best annotated hits onto {targets.length === 1 ? 'it' : 'them'}.</span>}
    validate={(v) => (!targets.length ? 'Select the sequences to annotate.' : !databases.some((d) => d.id === v.database) ? 'Choose a local database.' : null)}
    renderOptions={(v, set) => (
      <>
        <OptionRow label="Database:" htmlFor="opdlg-ab-db">
          <select id="opdlg-ab-db" value={String(v.database)} onChange={(e) => set('database', e.target.value)}>
            {databases.map((d) => <option key={d.id} value={d.id}>{d.name} ({d.docs.length} sequences)</option>)}
          </select>
        </OptionRow>
        <OptionRow label="Hits used:" htmlFor="opdlg-ab-hits" hint="Annotated hits, best bit score first.">
          <div className="prefs-row">
            <span>up to</span>{numInput('opdlg-ab-hits', Number(v.maxHits), (n) => set('maxHits', n), 1, 20, 56)}
            <span>hits with ≥</span>{numInput('opdlg-ab-hid', Number(v.minHitIdentity), (n) => set('minHitIdentity', n), 50, 100, 56)}<span>% identity</span>
          </div>
        </OptionRow>
        <OptionRow label="Feature identity:" htmlFor="opdlg-ab-fid" hint="Each annotation is copied only where the feature itself matches this well over its length.">
          <div className="prefs-row">{numInput('opdlg-ab-fid', Number(v.minIdentity), (n) => set('minIdentity', n), 50, 100)}<span>%</span></div>
        </OptionRow>
        <OptionRow label="Existing:">
          <label className="mbc-check-row">
            <input type="checkbox" checked={v.replace !== false} onChange={(e) => set('replace', e.target.checked)} />
            <span>Replace annotations added by an earlier run</span>
          </label>
        </OptionRow>
      </>
    )}
    onRun={(v) => onApply(runAnnotateByBlast(targets, databases.find((d) => d.id === v.database)?.docs ?? [], v))}
    onClose={onClose}
  />
);

// ───────────────────────────── CRISPR editing analysis ─────────────────────────────

export interface CrisprEditingDialogProps {
  traces: SequenceDocument[];
  selected: SequenceDocument[];
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
  onDownload?: (content: string, fileName: string) => void;
}

export const CrisprEditingDialog: React.FC<CrisprEditingDialogProps> = ({ traces, selected, onCreate, onClose, onDownload }) => {
  const edited = selected.filter((d) => d.chromatogram);
  return (
    <OperationDialog
      operationId="crispr-editing"
      title="CRISPR Editing Analysis…"
      runLabel="Analyse"
      transientKeys={['resultName']}
      defaults={{ control: traces.find((t) => !edited.some((e) => e.id === t.id))?.id ?? '', guide: '', cutPosition: 0, maxIndel: 10, window: 100, donor: '', resultName: '' }}
      onDownload={onDownload}
      summary={<span>Estimates indel frequencies in <strong>{edited.length}</strong> edited Sanger read{edited.length === 1 ? '' : 's'} by decomposing each trace against an unedited control trace (TIDE method; ICE-compatible scores and HDR with a donor template).</span>}
      validate={(v) => {
        if (!edited.length) return 'Select the edited Sanger reads (.ab1) in the table first.';
        if (!v.control) return 'Choose the control (unedited) read.';
        if (edited.every((e) => e.id === v.control)) return 'The control must differ from the edited reads.';
        const g = String(v.guide ?? '').replace(/\s/g, '');
        if (!g && Number(v.cutPosition) <= 0) return 'Enter the guide sequence, or the cut position in the control read.';
        if (g && !/^[ACGTUacgtu]{15,30}$/.test(g)) return 'The guide should be 15–30 nucleotides (without the PAM).';
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Control read:" htmlFor="opdlg-ce-ctrl" hint="An unedited (wild-type) trace of the same amplicon, sequenced with the same primer.">
            <select id="opdlg-ce-ctrl" value={String(v.control)} onChange={(e) => set('control', e.target.value)}>
              <option value="">Choose…</option>
              {traces.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </OptionRow>
          <OptionRow label="Guide (5′→3′):" htmlFor="opdlg-ce-guide" hint="Protospacer without the PAM; found on either strand of the control. The cut is 3 bp upstream of the PAM.">
            <input id="opdlg-ce-guide" type="text" value={String(v.guide)} placeholder="e.g. GACCAGGATGGGCACCACCC" style={{ fontFamily: 'var(--font-mono, monospace)' }}
              onChange={(e) => set('guide', e.target.value.toUpperCase())} />
          </OptionRow>
          {!String(v.guide).trim() && (
            <OptionRow label="Cut after base:" htmlFor="opdlg-ce-cut" hint="Position in the control read (1-based) when no guide is given.">
              {numInput('opdlg-ce-cut', Number(v.cutPosition), (n) => set('cutPosition', n), 0, 100000, 90)}
            </OptionRow>
          )}
          <OptionRow label="Donor (HDR):" htmlFor="opdlg-ce-donor" hint="Optional donor template (ssODN or HDR arm sequence, either orientation). Its homology arms are found in the control and the knock-in allele is fitted as a separate outcome.">
            <textarea id="opdlg-ce-donor" rows={2} value={String(v.donor ?? '')} placeholder="leave empty for indels only" style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 12 }}
              onChange={(e) => set('donor', e.target.value.replace(/\s/g, '').toUpperCase())} />
          </OptionRow>
          <OptionRow label="Indel sizes:" htmlFor="opdlg-ce-max">
            <div className="prefs-row"><span>up to ±</span>{numInput('opdlg-ce-max', Number(v.maxIndel), (n) => set('maxIndel', n), 1, 30, 56)}<span>bases</span></div>
          </OptionRow>
        </>
      )}
      renderMoreOptions={(v, set) => (
        <OptionRow label="Decomposition window:" htmlFor="opdlg-ce-win" hint="Bases after the cut used for the fit.">
          <div className="prefs-row">{numInput('opdlg-ce-win', Number(v.window), (n) => set('window', n), 20, 1000, 80)}<span>bases</span></div>
        </OptionRow>
      )}
      onRun={(v) => {
        const control = traces.find((t) => t.id === v.control);
        if (!control) throw new Error('Choose the control read.');
        onCreate(runCrisprEditing(control, edited, v, { sourceLabel: control.name }));
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Make BLAST Database from Selection ─────────────────────────────

export interface MakeBlastDbDialogProps {
  selected: SequenceDocument[];
  existingNames: string[];
  onCreate: (entry: LocalSequenceDbEntry) => void;
  onClose: () => void;
}

export const MakeBlastDbDialog: React.FC<MakeBlastDbDialogProps> = ({ selected, existingNames, onCreate, onClose }) => {
  const withSeq = selected.filter((d) => d.sequence.length > 0);
  const nuc = withSeq.filter((d) => d.moleculeType !== 'Protein');
  const prot = withSeq.filter((d) => d.moleculeType === 'Protein');
  return (
    <OperationDialog
      operationId="make-blast-db"
      title="Make BLAST Database from Selection…"
      runLabel="Create"
      transientKeys={['name']}
      defaults={{ name: '', moleculeType: nuc.length >= prot.length ? 'Nucleotide' : 'Protein' }}
      summary={<span>A local BLAST database made of exactly the <strong>{withSeq.length}</strong> selected sequence{withSeq.length === 1 ? '' : 's'} ({nuc.length} nucleotide, {prot.length} protein). It is used by BLAST Search and Annotate by BLAST and kept in this browser.</span>}
      validate={(v) => {
        const n = String(v.name).trim();
        if (!withSeq.length) return 'Select the sequences for the database in the table first.';
        if (!n) return 'Name the database.';
        if (existingNames.some((x) => x.toLowerCase() === n.toLowerCase())) return `A database named "${n}" already exists.`;
        if ((v.moleculeType === 'Protein' ? prot : nuc).length === 0) return `None of the selected sequences are ${v.moleculeType === 'Protein' ? 'proteins' : 'nucleotide sequences'}.`;
        return null;
      }}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Database name:" htmlFor="opdlg-mdb-name">
            <input id="opdlg-mdb-name" type="text" value={String(v.name)} placeholder="e.g. My_cloning_vectors" onChange={(e) => set('name', e.target.value)} />
          </OptionRow>
          <OptionRow label="Molecule type:" htmlFor="opdlg-mdb-type" hint="Sequences of the other type in the selection are left out.">
            <select id="opdlg-mdb-type" value={String(v.moleculeType)} onChange={(e) => set('moleculeType', e.target.value)}>
              <option value="Nucleotide">Nucleotide ({nuc.length})</option>
              <option value="Protein">Protein ({prot.length})</option>
            </select>
          </OptionRow>
        </>
      )}
      onRun={(v) => {
        const docs = v.moleculeType === 'Protein' ? prot : nuc;
        onCreate({
          id: `local-db-${Date.now().toString(36)}`, name: String(v.name).trim(), moleculeType: v.moleculeType === 'Protein' ? 'Protein' : 'Nucleotide',
          sourceFolder: 'Selected documents', sequenceCount: docs.length, docIds: docs.map((d) => d.id),
        });
      }}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Calculate Expression Levels ─────────────────────────────

export interface ExpressionLevelsDialogProps {
  contigs: SequenceDocument[];
  findDoc: (id: string) => SequenceDocument | undefined;
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
}

export const ExpressionLevelsDialog: React.FC<ExpressionLevelsDialogProps> = ({ contigs, findDoc, onCreate, onClose }) => {
  const usable = contigs.filter((c) => (c.alignmentMeta?.sequences?.length ?? 0) > 1 && c.docMetadata?.Reference);
  const ref = usable[0] ? findDoc(usable[0].history[0]?.parentIds?.[0] ?? '') : undefined;
  const types = ref ? [...new Set(ref.features.map((f) => f.type))].filter((t) => t !== 'source') : [];
  return (
    <OperationDialog
      operationId="expression-levels"
      title="Calculate Expression Levels…"
      runLabel="Calculate"
      transientKeys={['resultName']}
      defaults={{ featureTypes: types.includes('gene') ? 'gene' : 'CDS', minOverlap: 10, ambiguous: 'split', resultName: '' }}
      summary={<span>Counts reads per annotated gene in <strong>{usable.length}</strong> reference-mapping contig{usable.length === 1 ? '' : 's'} (one per sample){ref ? <> on <strong>{ref.name}</strong></> : ''} and reports reads, FPKM and TPM.</span>}
      validate={() => (!usable.length ? 'Select contigs made by Map to Reference (one per sample).' : !ref ? 'The reference of the selected contigs is not in the project.' : null)}
      renderOptions={(v, set) => (
        <>
          <OptionRow label="Count reads on:" htmlFor="opdlg-el-types" hint={types.length ? `Annotation types on the reference: ${types.join(', ')}.` : undefined}>
            <input id="opdlg-el-types" type="text" value={String(v.featureTypes)} onChange={(e) => set('featureTypes', e.target.value)} placeholder="gene, CDS" />
          </OptionRow>
          <OptionRow label="Minimum overlap:" htmlFor="opdlg-el-ov">
            <div className="prefs-row">{numInput('opdlg-el-ov', Number(v.minOverlap), (n) => set('minOverlap', n), 1, 1000, 70)}<span>bases</span></div>
          </OptionRow>
          <OptionRow label="Reads on several genes:" htmlFor="opdlg-el-amb">
            <select id="opdlg-el-amb" value={String(v.ambiguous)} onChange={(e) => set('ambiguous', e.target.value)}>
              <option value="split">Split between the genes</option>
              <option value="each">Count to each gene</option>
              <option value="discard">Leave out</option>
            </select>
          </OptionRow>
        </>
      )}
      onRun={(v) => onCreate(runCalculateExpressionLevels(usable, findDoc, v, { sourceLabel: ref?.name ?? 'Expression' }))}
      onClose={onClose}
    />
  );
};

// ───────────────────────────── Find Structural Variants ─────────────────────────────

export interface StructuralVariantsDialogProps {
  reads: SequenceDocument[];
  references: SequenceDocument[];
  onCreate: (r: OperationResult) => void;
  onClose: () => void;
}

export const StructuralVariantsDialog: React.FC<StructuralVariantsDialogProps> = ({ reads, references, onCreate, onClose }) => (
  <OperationDialog
    operationId="structural-variants"
    title="Find Structural Variants…"
    runLabel="Find"
    defaults={{ reference: references[0]?.id ?? '', minSize: 20, minClip: 20, minSupport: 2, tolerance: 10 }}
    summary={<span>Finds deletions, insertions, tandem duplications and inversion breakpoints from <strong>{reads.length}</strong> read{reads.length === 1 ? '' : 's'} that are split across a breakpoint.</span>}
    validate={(v) => (!reads.length ? 'Select the reads in the table first.' : !references.some((r) => r.id === v.reference) ? 'Choose the reference sequence.' : null)}
    renderOptions={(v, set) => (
      <>
        <OptionRow label="Reference:" htmlFor="opdlg-sv-ref">
          <select id="opdlg-sv-ref" value={String(v.reference)} onChange={(e) => set('reference', e.target.value)}>
            {references.map((r) => <option key={r.id} value={r.id}>{r.name} ({r.sequence.length.toLocaleString()} bp)</option>)}
          </select>
        </OptionRow>
        <OptionRow label="Smallest event:" htmlFor="opdlg-sv-size">
          <div className="prefs-row">{numInput('opdlg-sv-size', Number(v.minSize), (n) => set('minSize', n), 5, 100000, 80)}<span>bp</span></div>
        </OptionRow>
        <OptionRow label="Supporting reads:" htmlFor="opdlg-sv-sup" hint="Reads that must show the same breakpoint (within the tolerance).">
          <div className="prefs-row">{numInput('opdlg-sv-sup', Number(v.minSupport), (n) => set('minSupport', n), 1, 1000, 60)}<span>reads, breakpoints within ±</span>{numInput('opdlg-sv-tol', Number(v.tolerance), (n) => set('tolerance', n), 1, 200, 56)}<span>bp</span></div>
        </OptionRow>
      </>
    )}
    renderMoreOptions={(v, set) => (
      <OptionRow label="Unmatched read ends:" htmlFor="opdlg-sv-clip" hint="A read end at least this long that matches nowhere in the reference is taken as inserted sequence.">
        <div className="prefs-row">{numInput('opdlg-sv-clip', Number(v.minClip), (n) => set('minClip', n), 10, 1000, 70)}<span>bases</span></div>
      </OptionRow>
    )}
    onRun={(v) => {
      const ref = references.find((r) => r.id === v.reference);
      if (!ref) throw new Error('Choose the reference sequence.');
      onCreate(runFindStructuralVariants(ref, reads, v, { sourceLabel: ref.name }));
    }}
    onClose={onClose}
  />
);
