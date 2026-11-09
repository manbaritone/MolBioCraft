// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { Download, FolderPlus, Search, Trash2, TriangleAlert } from 'lucide-react';
import { MoleculeType, SequenceDocument, Topology } from '../types/bio';
import {
  buildCuratedDatabaseDocumentRust,
  getReferenceDatabaseCategoriesRust,
  parseRemoteDatabasePayloadRust,
  queryCuratedDatabaseRecordsRust,
} from '../lib/rustBioEngine';
import { StaticModalDialog } from './MenusPreferencesAndBlastModal';
import { localBlastDbDocuments, LocalSequenceDbEntry } from '../core/localBlastDb';
import {
  errorHeading, formatResolution, RCSB_MAX_IN_FLIGHT, RCSB_MAX_STARTS_PER_SECOND, rcsbPanelActions, RcsbExplorerSession,
  type ImportFiles, type RcsbExplorerState, type RcsbPanelActions,
} from '../core/rcsbExplorer';
export type { LocalSequenceDbEntry } from '../core/localBlastDb';
import {
  MolBioDocTypeIcon,
  MolBioMenuGlyph,
  MolBioSidebarNodeIcon,
} from './MolBioIcons';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';

export type ReferenceDatabaseCategoryId =
  | 'ncbi-gene'
  | 'ncbi-nucleotide'
  | 'ncbi-protein'
  | 'ncbi-pubmed'
  | 'ncbi-structure'
  | 'ncbi-taxonomy'
  | 'uniprot'
  | 'rcsb-pdb'
  | 'local-blast-dbs';

export interface CuratedDatabaseRecord {
  id: string;
  category: string;
  accession: string;
  title: string;
  organism: string;
  moleculeType: MoleculeType;
  topology: Topology;
  summary: string;
  metadataBadge: string;
  featureName: string;
  featureType: string;
  sequence: string;
  targetFolder: string;
}

interface DatabaseCategory {
  id: ReferenceDatabaseCategoryId;
  group: 'NCBI' | 'UniProt' | 'RCSB' | 'Local';
  label: string;
  subtitle: string;
}

/** The online-only RCSB PDB source, listed before the local databases. */
const RCSB_CATEGORY: DatabaseCategory = {
  id: 'rcsb-pdb',
  group: 'RCSB',
  label: 'RCSB PDB',
  subtitle: 'Search the Protein Data Bank and open an entry from its mmCIF file (online, only when you ask)',
};

const DB_CATEGORIES: DatabaseCategory[] = (() => {
  const curated = getReferenceDatabaseCategoriesRust() as DatabaseCategory[];
  const local = curated.findIndex((c) => c.id === 'local-blast-dbs');
  return local < 0 ? [...curated, RCSB_CATEGORY] : [...curated.slice(0, local), RCSB_CATEGORY, ...curated.slice(local)];
})();

const CategoryIcon: React.FC<{ id: ReferenceDatabaseCategoryId; size: number }> = ({ id, size }) =>
  id === 'rcsb-pdb'
    ? <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={size} />
    : <MolBioSidebarNodeIcon nodeKey={id} size={size} />;


interface DatabaseExplorerModalProps {
  initialCategory: ReferenceDatabaseCategoryId;
  documents: SequenceDocument[];
  localDatabases: LocalSequenceDbEntry[];
  onAddLocalDatabase: (entry: LocalSequenceDbEntry) => void;
  onRemoveLocalDatabase: (id: string) => void;
  onImportDocument: (doc: SequenceDocument) => void;
  /** The workbench's file import; an opened RCSB entry is handed to it as its mmCIF file. */
  onImportFiles?: ImportFiles;
  onOpenBlastModal: () => void;
  onClose: () => void;
}

export const DatabaseExplorerModal: React.FC<DatabaseExplorerModalProps> = ({
  initialCategory,
  documents,
  localDatabases,
  onAddLocalDatabase,
  onRemoveLocalDatabase,
  onImportDocument,
  onImportFiles,
  onOpenBlastModal,
  onClose,
}) => {
  const [activeCategory, setActiveCategory] =
    useState<ReferenceDatabaseCategoryId>(initialCategory);
  const [searchFilter, setSearchFilter] = useState<string>('');
  const [liveAccession, setLiveAccession] = useState<string>('');
  const [liveStatus, setLiveStatus] = useState<string | null>(null);
  const [newDbName, setNewDbName] = useState<string>('Custom_Project_Vectors_DB');
  const [newDbFolder, setNewDbFolder] = useState<string>('All Project Files');
  const [newDbMolType, setNewDbMolType] = useState<'Nucleotide' | 'Protein'>('Nucleotide');
  const [rcsbSession] = useState(() => new RcsbExplorerSession());

  const availableFolders = useMemo(() => {
    const set = new Set<string>(['All Project Files']);
    for (const d of documents) {
      if (d.folder) set.add(d.folder);
    }
    return Array.from(set);
  }, [documents]);

  const filteredRecords = useMemo(() => {
    if (activeCategory === 'local-blast-dbs' || activeCategory === 'rcsb-pdb') return [];
    return queryCuratedDatabaseRecordsRust(activeCategory, searchFilter.trim());
  }, [activeCategory, searchFilter]);

  const handleImportCuratedRecord = (rec: CuratedDatabaseRecord) => {
    const built = buildCuratedDatabaseDocumentRust(rec.id, new Date().toISOString());
    if (!built) return;
    const doc: SequenceDocument = {
      ...built,
      id: `doc-${rec.id}-${Date.now().toString(36)}`,
    };
    onImportDocument(doc);
    setLiveStatus(`Imported "${doc.name}" into active project workspace (Rust Aho-Corasick Catalog).`);
  };

  const handleLiveFetchAccession = async () => {
    const acc = liveAccession.trim();
    if (!acc) return;

    // Check curated offline match via Rust Aho-Corasick index first
    const localHits = queryCuratedDatabaseRecordsRust('', acc);
    const exactLocal = localHits.find(
      (r) => r.accession.toLowerCase() === acc.toLowerCase()
    );
    if (exactLocal) {
      handleImportCuratedRecord(exactLocal);
      return;
    }

    setLiveStatus(`Fetching ${acc} from public sequence service...`);
    try {
      const isUniProt = activeCategory === 'uniprot' || /^[OPQ][0-9][A-Z0-9]{3}[0-9]$/i.test(acc);
      const url = isUniProt
        ? `https://rest.uniprot.org/uniprotkb/${encodeURIComponent(acc)}.fasta`
        : `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=${
            activeCategory === 'ncbi-protein' ? 'protein' : 'nuccore'
          }&id=${encodeURIComponent(acc)}&rettype=fasta&retmode=text`;

      const resp = await fetch(url);
      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status} while querying ${acc}`);
      }
      const rawPayload = await resp.text();
      const targetFolder =
        isUniProt || activeCategory === 'ncbi-protein'
          ? 'Protein Documents'
          : 'Cloning Inserts & PCR';
      const parsed = parseRemoteDatabasePayloadRust(
        rawPayload,
        acc,
        isUniProt || activeCategory === 'ncbi-protein',
        targetFolder
      );
      if (parsed.length === 0) {
        throw new Error(`No FASTA/GenBank sequence returned for ${acc}`);
      }
      const doc = parsed[0];
      onImportDocument(doc);
      setLiveStatus(`Fetched and imported ${acc} (${doc.sequence.length.toLocaleString()} residues via Rust noodles-fasta).`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setLiveStatus(
        `Offline / network notice for "${acc}": ${msg}. Select any built-in curated record below for offline import.`
      );
    }
  };

  const handleCreateLocalBlastDb = () => {
    const cleanName = newDbName.trim() || 'Local_Project_DB';
    // True count of documents of the chosen type (0 allowed; it used to
    // report at least 1 and ignore the molecule type).
    const matchingDocs = localBlastDbDocuments(
      { moleculeType: newDbMolType, sourceFolder: newDbFolder },
      documents
    );
    onAddLocalDatabase({
      id: `local-db-${Date.now().toString(36)}`,
      name: cleanName,
      moleculeType: newDbMolType,
      sourceFolder: newDbFolder,
      sequenceCount: matchingDocs.length,
    });
    setLiveStatus(`Registered local BLAST database "${cleanName}" (${matchingDocs.length} sequences).`);
  };

  const activeCategoryMeta =
    DB_CATEGORIES.find((c) => c.id === activeCategory) ?? DB_CATEGORIES[0];

  return (
    <StaticModalDialog
      titleId="mbc-db-explorer-title"
      title="NCBI, UniProt, RCSB PDB & Local Sequence Databases"
      sizeClass="modal-size-db"
      onClose={onClose}
    >
      <div className="prefs-split-layout" style={{ minBlockSize: 470 }}>
        {/* Left Navigation Categories */}
        <nav className="prefs-category-sidebar" aria-label="Reference Databases">
          {DB_CATEGORIES.map((cat) => {
            const count =
              cat.id === 'rcsb-pdb'
                ? null
                : cat.id === 'local-blast-dbs'
                ? localDatabases.length
                : queryCuratedDatabaseRecordsRust(cat.id, '').length;
            return (
              <button
                key={cat.id}
                type="button"
                className={`prefs-category-item ${activeCategory === cat.id ? 'active' : ''}`}
                onClick={() => {
                  setActiveCategory(cat.id);
                  setLiveStatus(null);
                }}
              >
                <CategoryIcon id={cat.id} size={15} />
                <span style={{ flex: 1, textAlign: 'left' }}>{cat.label}</span>
                {count !== null && <span className="folder-count">{count}</span>}
              </button>
            );
          })}
        </nav>

        {/* Right Detail Pane */}
        <div className="prefs-detail-pane" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="studio-card-header" style={{ marginBottom: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <CategoryIcon id={activeCategory} size={18} />
              <div>
                <h3 style={{ margin: 0, fontSize: 15 }}>{activeCategoryMeta.label}</h3>
                <p style={{ margin: '2px 0 0', fontSize: 12, opacity: 0.78 }}>
                  {activeCategoryMeta.subtitle}
                </p>
              </div>
            </div>
            <button
              type="button"
              className="btn-secondary-sm"
              style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
              onClick={() => {
                onClose();
                onOpenBlastModal();
              }}
            >
              <MolBioMenuGlyph glyph="blast-search" size={13} />
              <span>Open BLAST Search</span>
            </button>
          </div>

          {liveStatus && (
            <div
              className="mbc-db-status-banner"
              role="status"
              style={{
                padding: '7px 11px',
                borderRadius: 6,
                fontSize: 12,
                background: 'rgba(16, 185, 129, 0.12)',
                border: '1px solid rgba(16, 185, 129, 0.35)',
              }}
            >
              {liveStatus}
            </div>
          )}

          {activeCategory === 'rcsb-pdb' ? (
            <RcsbExplorerPanel session={rcsbSession} documents={documents} onImportFiles={onImportFiles} />
          ) : activeCategory === 'local-blast-dbs' ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <fieldset className="prefs-fieldset">
                <legend>Add Local Sequence Database (From Project Folder)</legend>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.3fr 1fr 0.9fr auto',
                    gap: 8,
                    alignItems: 'end',
                  }}
                >
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span>Database Name</span>
                    <input
                      type="text"
                      className="prefs-text-input"
                      value={newDbName}
                      onChange={(e) => setNewDbName(e.target.value)}
                    />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span>Source Folder</span>
                    <select
                      className="prefs-select"
                      value={newDbFolder}
                      onChange={(e) => setNewDbFolder(e.target.value)}
                    >
                      {availableFolders.map((f) => (
                        <option key={f} value={f}>
                          {f}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                    <span>Database Type</span>
                    <select
                      className="prefs-select"
                      value={newDbMolType}
                      onChange={(e) =>
                        setNewDbMolType(e.target.value as 'Nucleotide' | 'Protein')
                      }
                    >
                      <option value="Nucleotide">Nucleotide (blastn/tblastn)</option>
                      <option value="Protein">Protein (blastp/blastx)</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="btn-primary-sm"
                    onClick={handleCreateLocalBlastDb}
                    style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    <FolderPlus size={13} />
                    <span>Add BLAST DB</span>
                  </button>
                </div>
              </fieldset>

              <fieldset className="prefs-fieldset">
                <legend>Registered Local Sequence Databases ({localDatabases.length})</legend>
                <WorkbenchSmartTable
                  tableId="local-blast-databases"
                  tableLabel="Registered Local Sequence Databases"
                  className="mbc-document-table"
                >
                  <thead>
                    <tr>
                      <th>Database Name</th>
                      <th>Type</th>
                      <th>Indexed Folder</th>
                      <th>Sequences</th>
                      <th style={{ width: 90 }}>Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {localDatabases.map((db) => (
                      <tr key={db.id}>
                        <td>
                          <span className="mbc-attr-inline">
                            <MolBioMenuGlyph glyph="blast-search" size={13} />
                            <strong>{db.name}</strong>
                          </span>
                        </td>
                        <td>
                          <span
                            className={`mbc-attr-pill ${
                              db.moleculeType === 'Protein' ? 'tone-cyan' : 'tone-indigo'
                            }`}
                          >
                            <MolBioDocTypeIcon
                              kind={db.moleculeType === 'Protein' ? 'protein' : 'linear-dna'}
                              visualOverride={
                                db.moleculeType === 'Protein' ? 'protein-seq' : 'linear-dsdna'
                              }
                              size={12}
                            />
                            <span className="mbc-attr-pill-text">{db.moleculeType}</span>
                          </span>
                        </td>
                        <td>
                          <span className="mbc-attr-inline">
                            <MolBioSidebarNodeIcon nodeKey={db.sourceFolder} size={13} />
                            <span>{db.sourceFolder}</span>
                          </span>
                        </td>
                        <td>{db.sequenceCount}</td>
                        <td>
                          <button
                            type="button"
                            className="btn-secondary-sm"
                            onClick={() => onRemoveLocalDatabase(db.id)}
                            title={`Remove ${db.name}`}
                          >
                            <Trash2 size={12} /> Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </WorkbenchSmartTable>
              </fieldset>
            </div>
          ) : (
            <>
              {/* Filter + Optional Live Accession Fetch Bar */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1.1fr',
                  gap: 8,
                }}
              >
                <div className="mbc-filter-input-wrap" style={{ width: '100%' }}>
                  <Search size={13} />
                  <input
                    type="text"
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    placeholder={`Filter ${activeCategoryMeta.label} records...`}
                    style={{ width: '100%' }}
                  />
                </div>

                <div style={{ display: 'flex', gap: 6 }}>
                  <input
                    type="text"
                    className="prefs-text-input"
                    value={liveAccession}
                    onChange={(e) => setLiveAccession(e.target.value)}
                    placeholder={
                      activeCategory === 'uniprot'
                        ? 'Accession (e.g. P42212, Q99ZW2)...'
                        : 'Entrez Accession (e.g. NC_045512.2, U02453.1)...'
                    }
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="btn-secondary-sm"
                    onClick={() => void handleLiveFetchAccession()}
                  >
                    Fetch ID
                  </button>
                </div>
              </div>

              {/* Curated Built-In Offline-Ready Records */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                  maxBlockSize: 330,
                  overflowY: 'auto',
                  paddingInlineEnd: 4,
                }}
              >
                {filteredRecords.map((rec) => (
                  <div
                    key={rec.id}
                    className="mbc-db-record-card"
                    style={{
                      border: '1px solid var(--mbc-border, rgba(148,163,184,0.3))',
                      borderRadius: 7,
                      padding: '9px 12px',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: 12,
                    }}
                  >
                    <div style={{ minInlineSize: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <MolBioDocTypeIcon
                          kind={
                            rec.category === 'ncbi-taxonomy'
                              ? 'tree'
                              : rec.moleculeType === 'Protein'
                              ? 'protein'
                              : rec.topology === 'circular'
                              ? 'circular-dna'
                              : 'linear-dna'
                          }
                          visualOverride={
                            rec.category === 'ncbi-structure'
                              ? 'structure-3d'
                              : rec.category === 'ncbi-taxonomy'
                              ? 'phylo-tree'
                              : rec.moleculeType === 'Protein'
                              ? 'protein-seq'
                              : rec.moleculeType === 'RNA'
                              ? 'linear-rna'
                              : rec.topology === 'circular'
                              ? rec.sequence.length >= 25000
                                ? 'circular-genome'
                                : 'circular-plasmid'
                              : 'linear-dsdna'
                          }
                          size={15}
                        />
                        <code
                          style={{
                            fontSize: 11.5,
                            fontWeight: 700,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: 'rgba(37, 99, 235, 0.12)',
                          }}
                        >
                          {rec.accession}
                        </code>
                        <strong style={{ fontSize: 13 }}>{rec.title}</strong>
                        <span className="badge-accent" style={{ fontSize: 11 }}>
                          {rec.metadataBadge}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, opacity: 0.82, marginTop: 4 }}>
                        <em>{rec.organism}</em> — {rec.summary}
                      </div>
                    </div>

                    <button
                      type="button"
                      className="btn-primary-sm"
                      onClick={() => handleImportCuratedRecord(rec)}
                      style={{
                        flexShrink: 0,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <Download size={13} />
                      <span>Import ({rec.sequence.length} {rec.moleculeType === 'Protein' ? 'aa' : 'bp'})</span>
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="prefs-modal-footer">
        <span style={{ fontSize: 11.5, opacity: 0.75 }}>
          Built-in curated reference bank works 100% offline • Optional direct Entrez / UniProt accession fetch and RCSB PDB search
        </span>
        <div className="prefs-footer-actions">
          <button type="button" className="btn-primary-sm" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </StaticModalDialog>
  );
};

const RCSB_ROW_STYLE: React.CSSProperties = {
  border: '1px solid var(--mbc-border, rgba(148,163,184,0.3))',
  borderRadius: 7,
  padding: '9px 12px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
};

interface RcsbExplorerPanelProps {
  session: RcsbExplorerSession;
  documents: SequenceDocument[];
  onImportFiles?: ImportFiles;
}

/**
 * RCSB PDB search and open, bound to a session: the view of the session's state, with the
 * controller's handlers (`rcsbPanelActions`). Only Search and Open contact RCSB.
 */
export const RcsbExplorerPanel: React.FC<RcsbExplorerPanelProps> = ({ session, documents, onImportFiles }) => {
  const state = useSyncExternalStore(session.subscribe, session.getSnapshot, session.getSnapshot);
  return <RcsbExplorerView state={state} documents={documents} actions={rcsbPanelActions(session, documents, onImportFiles)} />;
};

/**
 * What the RCSB panel shows for `state`. It holds no hooks, no refs and no handler code: every
 * handler on its controls is one of `actions`, passed through untouched, so it can be read and
 * driven without a DOM.
 */
export function RcsbExplorerView({ state, documents, actions }: {
  state: RcsbExplorerState;
  documents: SequenceDocument[];
  actions: RcsbPanelActions;
}): React.ReactElement {
  const proteins = documents.filter((d) => d.moleculeType === 'Protein');
  const bySequence = state.sequenceDocumentId !== null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <form style={{ display: 'grid', gridTemplateColumns: '0.9fr 1.4fr auto', gap: 8 }} onSubmit={actions.onSubmit}>
        <select
          className="prefs-select"
          aria-label="Search RCSB PDB by"
          value={state.sequenceDocumentId ?? ''}
          onChange={actions.onModeChange}
        >
          <option value="">Keywords</option>
          {proteins.map((d) => (
            <option key={d.id} value={d.id}>
              Sequence of {d.name}
            </option>
          ))}
        </select>
        <div className="mbc-filter-input-wrap" style={{ width: '100%' }}>
          <Search size={13} />
          <input
            type="search"
            aria-label="RCSB PDB keywords"
            value={state.query}
            disabled={bySequence}
            onChange={actions.onQueryChange}
            placeholder={bySequence ? 'Searching with the chosen protein sequence' : 'Keywords (e.g. hemoglobin, kinase, 4HHB)...'}
            style={{ width: '100%' }}
          />
        </div>
        <button
          type="submit"
          className="btn-primary-sm"
          disabled={state.searching}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}
        >
          <Search size={13} />
          <span>{state.searching ? 'Searching…' : 'Search RCSB'}</span>
        </button>
      </form>

      {state.error && (
        <div
          role="alert"
          style={{
            padding: '7px 11px',
            borderRadius: 6,
            fontSize: 12,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.4)',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 6,
          }}
        >
          <TriangleAlert size={13} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            <strong>{errorHeading(state.error)}</strong> {state.error.message}
          </span>
        </div>
      )}
      {state.notice && (
        <div
          role="status"
          style={{
            padding: '7px 11px',
            borderRadius: 6,
            fontSize: 12,
            background: 'rgba(16, 185, 129, 0.12)',
            border: '1px solid rgba(16, 185, 129, 0.35)',
          }}
        >
          {state.notice}
        </div>
      )}

      {state.totalCount !== null && (
        <p style={{ margin: 0, fontSize: 12, opacity: 0.8 }}>
          Showing {state.hits.length} of {state.totalCount.toLocaleString()} RCSB entries
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxBlockSize: 300, overflowY: 'auto', paddingInlineEnd: 4 }}>
        {state.hits.map((hit) => {
          const s = hit.summary;
          const opening = state.opening.includes(hit.id);
          return (
            <div key={hit.id} className="mbc-db-record-card" data-rcsb-entry={hit.id} style={RCSB_ROW_STYLE}>
              <div style={{ minInlineSize: 0, flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <MolBioDocTypeIcon kind="protein" visualOverride="structure-3d" size={15} />
                  <code
                    style={{ fontSize: 11.5, fontWeight: 700, padding: '1px 6px', borderRadius: 4, background: 'rgba(37, 99, 235, 0.12)' }}
                  >
                    {hit.id}
                  </code>
                  {s.state === 'loaded' && <strong style={{ fontSize: 13 }}>{s.summary.title ?? 'Untitled entry'}</strong>}
                </div>
                <div style={{ fontSize: 11.5, opacity: 0.82, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  {s.state === 'loading' && <span>Loading entry summary…</span>}
                  {s.state === 'failed' && (
                    <span role="alert">
                      Summary unavailable ({errorHeading(s.error)}): {s.error.message}
                    </span>
                  )}
                  {s.state === 'loaded' && (
                    <>
                      <span className="badge-accent" style={{ fontSize: 11 }}>
                        {s.summary.methods.join(', ') || 'Method not reported'}
                      </span>
                      <span>{formatResolution(s.summary) ?? 'No resolution reported'}</span>
                      {s.summary.releaseDate && <span>Released {s.summary.releaseDate}</span>}
                    </>
                  )}
                </div>
              </div>
              <button
                type="button"
                className="btn-primary-sm"
                value={hit.id}
                disabled={!actions.canOpen || opening}
                title={actions.canOpen ? `Download ${hit.id} as mmCIF from files.rcsb.org and open it` : 'This window cannot import files'}
                onClick={actions.onOpen}
                style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 5 }}
              >
                <Download size={13} />
                <span>{opening ? 'Opening…' : 'Open mmCIF'}</span>
              </button>
            </div>
          );
        })}
      </div>

      <p style={{ margin: 0, fontSize: 11.5, opacity: 0.75 }}>
        RCSB PDB is contacted only when you press Search RCSB or Open mmCIF, with at most {RCSB_MAX_IN_FLIGHT} requests at a
        time and {RCSB_MAX_STARTS_PER_SECOND} a second.
      </p>
    </div>
  );
};
