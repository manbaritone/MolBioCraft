// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useState } from 'react';
import { saveWorkbenchFile } from '../platform/macosMenuBridge';
import { SequenceDocument } from '../types/bio';
import { exportToFasta, exportToGenBank } from '../core/fileParsers';
import { cleanSequence } from '../core/bioEngine';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import {
  MODULAR_VECTOR_PARTS,
  ModularPartCategory,
  ModularVectorPart,
} from '../data/modularVectorParts';
import {
  CatalogVectorEntry,
  VECTOR_CATALOG,
  VectorCatalogCategory,
} from '../data/vectorCatalog';
import {
  HOST_STRAIN_GUIDES,
  ORIGIN_COMPATIBILITY_GROUPS,
  VECTOR_SYSTEM_GUIDES,
} from '../data/vectorSystemsAndStrains';
import {
  assembleModularCustomVector,
  auditTwistCustomVectorOnboarding,
  buildCatalogVectorDocument,
  checkCoTransformationCompatibility,
  exportVectorCatalogCsv,
  generateCatalogCircularSvg,
  simulateTwistClonalGeneInsertion,
} from '../core/vectorDesignerEngine';

export type VectorStudioTab =
  | 'catalog'
  | 'architect'
  | 'parts'
  | 'twist-onboarding'
  | 'systems-strains';

interface VectorLibraryAndDesignStudioProps {
  activeDoc: SequenceDocument;
  documents: SequenceDocument[];
  initialSubTab?: VectorStudioTab;
  /** Incremented on every menu request so re-requesting the same sub-tab re-applies it. */
  commandNonce?: number;
  onAddDocument: (doc: SequenceDocument) => void;
  onInsertPartIntoActiveDoc: (part: ModularVectorPart, positionBp: number) => void;
  onJumpToCoordinate?: (start: number, end: number, label?: string, docId?: string) => void;
  onStatusNotice?: (message: string) => void;
}

function triggerTextDownload(filename: string, content: string, mime = 'text/plain;charset=utf-8') {
  saveWorkbenchFile(filename, content, mime);
}

export const VectorLibraryAndDesignStudio: React.FC<VectorLibraryAndDesignStudioProps> = ({
  activeDoc,
  documents,
  initialSubTab = 'catalog',
  commandNonce,
  onAddDocument,
  onInsertPartIntoActiveDoc,
  onJumpToCoordinate,
  onStatusNotice,
}) => {
  const [subTab, setSubTab] = useState<VectorStudioTab>(initialSubTab);
  // Menu commands targeting a Vector sub-tab while the studio is already open
  // were ignored (the prop only seeded the initial state).
  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab, commandNonce]);
  const [selectedCassetteFeatId, setSelectedCassetteFeatId] = useState<string | null>(null);

  // ─── 1. Catalog Browser State ───
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<string>('All');
  const [categoryFilter, setCategoryFilter] = useState<string>('All');
  const [copyFilter, setCopyFilter] = useState<string>('All');
  const [markerFilter, setMarkerFilter] = useState<string>('All');
  const [minBp, setMinBp] = useState<number>(0);
  const [maxBp, setMaxBp] = useState<number>(20000);
  const [selectedVectorId, setSelectedVectorId] = useState<string>(VECTOR_CATALOG[0].id);

  // ─── 2. Modular Vector Architect State ───
  const [archName, setArchName] = useState('pMBC-EF1A-3xFLAG-mScarlet3-P2A-Puro');
  const [archSystemId, setArchSystemId] = useState(VECTOR_SYSTEM_GUIDES[1]?.id ?? VECTOR_SYSTEM_GUIDES[0].id);
  const [archPromoterId, setArchPromoterId] = useState('prom-ef1a');
  const [archSignalId, setArchSignalId] = useState('sig-kozak');
  const [archTagId, setArchTagId] = useState('tag-3xflag');
  const [archProteaseId, setArchProteaseId] = useState('prot-tev');
  const [archCargoMode, setArchCargoMode] = useState<'part' | 'custom-dna'>('part');
  const [archCargoPartId, setArchCargoPartId] = useState('orf-mscarlet3');
  const [archCustomCargoName, setArchCustomCargoName] = useState('Custom_GOI');
  const [archCustomCargoSeq, setArchCustomCargoSeq] = useState('ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCTAA');
  const [archLinkerId, setArchLinkerId] = useState('lnk-p2a');
  const [archEukMarkerId, setArchEukMarkerId] = useState('sel-puror');
  const [archWpreId, setArchWpreId] = useState('reg-wpre');
  const [archPolyAId, setArchPolyAId] = useState('reg-bghpa');
  const [archOriginId, setArchOriginId] = useState('ori-puc');
  const [archBactMarkerId, setArchBactMarkerId] = useState('sel-ampr');

  // ─── 3. Modular Parts Browser State ───
  const [partQuery, setPartQuery] = useState('');
  const [partCatFilter, setPartCatFilter] = useState<string>('All');
  const [insertCoordBp, setInsertCoordBp] = useState<number>(Math.min(120, activeDoc.sequence.length));

  // ─── 4. Twist Custom Vector Onboarding & Clonal Gene State ───
  const [twistDocId, setTwistDocId] = useState<string>(activeDoc.id);
  const [twistSiteBp, setTwistSiteBp] = useState<number>(() => {
    const mcs = activeDoc.features.find((f) => /mcs|insertion|cloning/i.test(f.name));
    return mcs ? mcs.start : Math.min(200, Math.max(1, Math.floor(activeDoc.sequence.length / 4)));
  });
  const [twistVolUl, setTwistVolUl] = useState<number>(120);
  const [twistConcNgUl, setTwistConcNgUl] = useState<number>(150);
  const [clonalGeneName, setClonalGeneName] = useState<string>('FMC63_VH_or_GOI');
  const [clonalGeneSeq, setClonalGeneSeq] = useState<string>(
    'ATGGTGAGCAAGGGCGAGGAGCTGTTCACCGGGGTGGTGCCCATCCTGGTCGAGCTGGACGGCGACGTAAACGGCCACAAGTTCAGCGTGTCCGGCGAGGGCGAGGGCGATGCCACCTACGGCAAGCTGACCCTGAAGTTCATCTGCACCACCGGCAAGCTGCCCTAA'
  );
  // Arbitrary text ("hello world 123 MKV") used to be spliced into DNA
  // constructs. Whitespace and position numbers are tolerated as formatting.
  const cargoSeqProblem = dnaSequenceInputProblem(archCustomCargoSeq);
  const clonalSeqProblem = dnaSequenceInputProblem(clonalGeneSeq);
  const [clonalFraming, setClonalFraming] = useState<
    'standard-scarless' | 'entr-kozak' | 'igg-variable-inframe'
  >('standard-scarless');

  // ─── 5. Co-Transformation Compatibility State ───
  const [coVecAId, setCoVecAId] = useState<string>('twist-pet28a');
  const [coVecBId, setCoVecBId] = useState<string>('twist-chlor-med');

  const filteredCatalog = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return VECTOR_CATALOG.filter((v) => {
      if (sourceFilter !== 'All' && v.source !== sourceFilter) return false;
      if (categoryFilter !== 'All' && v.category !== categoryFilter) return false;
      if (copyFilter !== 'All' && v.copyNumber !== copyFilter) return false;
      if (
        markerFilter !== 'All' &&
        !v.bacterialMarker.toLowerCase().includes(markerFilter.toLowerCase()) &&
        !v.eukaryoticMarker.toLowerCase().includes(markerFilter.toLowerCase())
      ) {
        return false;
      }
      if (v.nominalSizeBp < minBp || v.nominalSizeBp > maxBp) return false;
      if (!q) return true;
      const hay = `${v.name} ${v.source} ${v.vendorLine} ${v.category} ${v.hostSystem} ${v.promoter} ${v.origin} ${v.bacterialMarker} ${v.eukaryoticMarker} ${v.fusionTags.join(' ')} ${v.summary}`.toLowerCase();
      return hay.includes(q);
    });
  }, [searchQuery, sourceFilter, categoryFilter, copyFilter, markerFilter, minBp, maxBp]);

  const selectedVector: CatalogVectorEntry = useMemo(
    () =>
      filteredCatalog.find((v) => v.id === selectedVectorId) ??
      VECTOR_CATALOG.find((v) => v.id === selectedVectorId) ??
      filteredCatalog[0] ??
      VECTOR_CATALOG[0],
    [filteredCatalog, selectedVectorId]
  );

  const previewAssembly = useMemo(
    () =>
      assembleModularCustomVector({
        vectorName: archName,
        systemGuideId: archSystemId,
        promoterPartId: archPromoterId,
        signalOrInitPartId: archSignalId,
        nTagPartId: archTagId,
        proteasePartId: archProteaseId,
        cargoMode: archCargoMode,
        cargoPartId: archCargoPartId,
        customCargoName: archCustomCargoName,
        customCargoSeq: archCustomCargoSeq,
        linker2APartId: archLinkerId,
        eukaryoticMarkerPartId: archEukMarkerId,
        regulatoryWprePartId: archWpreId,
        polyAOrTermPartId: archPolyAId,
        originPartId: archOriginId,
        bacterialMarkerPartId: archBactMarkerId,
      }),
    [
      archName, archSystemId, archPromoterId, archSignalId, archTagId, archProteaseId,
      archCargoMode, archCargoPartId, archCustomCargoName, archCustomCargoSeq,
      archLinkerId, archEukMarkerId, archWpreId, archPolyAId, archOriginId, archBactMarkerId,
    ]
  );

  const filteredParts = useMemo(() => {
    const q = partQuery.trim().toLowerCase();
    return MODULAR_VECTOR_PARTS.filter((p) => {
      if (partCatFilter !== 'All' && p.category !== partCatFilter) return false;
      if (!q) return true;
      return `${p.name} ${p.category} ${p.subCategory} ${p.source} ${p.hostSystem} ${p.summary}`
        .toLowerCase()
        .includes(q);
    });
  }, [partQuery, partCatFilter]);

  const twistTargetDoc = useMemo(
    () => documents.find((d) => d.id === twistDocId) ?? activeDoc,
    [documents, twistDocId, activeDoc]
  );

  const twistAudit = useMemo(
    () => auditTwistCustomVectorOnboarding(twistTargetDoc, twistSiteBp, twistVolUl, twistConcNgUl),
    [twistTargetDoc, twistSiteBp, twistVolUl, twistConcNgUl]
  );

  const coCompat = useMemo(() => {
    const a = VECTOR_CATALOG.find((v) => v.id === coVecAId) ?? VECTOR_CATALOG[0];
    const b = VECTOR_CATALOG.find((v) => v.id === coVecBId) ?? VECTOR_CATALOG[3];
    return { a, b, report: checkCoTransformationCompatibility(a, b) };
  }, [coVecAId, coVecBId]);

  const partsByCat = (cat: ModularPartCategory) =>
    MODULAR_VECTOR_PARTS.filter((p) => p.category === cat);

  const categories: VectorCatalogCategory[] = [
    'Cloning & Entry',
    'Bacterial Expression',
    'Mammalian Expression',
    'Antibody & Fc Fusion',
    'Viral Transfer & Packaging',
    'CRISPR, Transposon & CAR-T',
    'Yeast, Plant, Insect & IVT',
    'Reporter & Standard DNA',
  ];

  const partCategories: ModularPartCategory[] = [
    'Promoter',
    'Reporter / ORF',
    'Selection Marker',
    'Origin',
    'Affinity & Fusion Tag',
    'Protease Cleavage',
    'Linker / 2A / IRES',
    'Signal & Localization',
    'Regulatory / PolyA / Terminator',
    'Viral / Recombination',
    'CRISPR / CAR-T / Antibody',
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '4px 0', minWidth: 0 }}>
      {/* Top Studio Header & Sub-Tabs */}
      <div className="studio-card" style={{ padding: '10px 14px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
          <div>
            <h3 style={{ margin: 0, fontSize: 15 }}>
              Comprehensive Vector Library, Modular Architect &amp; Twist Onboarding Suite
            </h3>
            <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>
              {VECTOR_CATALOG.length} Curated Vectors • {MODULAR_VECTOR_PARTS.length} Modular DNA Parts • {VECTOR_SYSTEM_GUIDES.length} Vector Systems • {HOST_STRAIN_GUIDES.length} Host Strains (Twist Bioscience • Modular Systems • ConductScience)
            </div>
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              className="method-tab-btn"
              onClick={() =>
                triggerTextDownload(
                  'MolBioCraft_Vector_Library_Catalog.csv',
                  exportVectorCatalogCsv(filteredCatalog),
                  'text/csv;charset=utf-8'
                )
              }
            >
              Export Catalog CSV ({filteredCatalog.length})
            </button>
          </div>
        </div>

        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Vector Studio Modules"
          alwaysShowArrows
          activeKey={subTab}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide vector modules left"
          nextAriaLabel="Slide vector modules right"
        >
          {(
            [
              ['catalog', `Vector Catalog (${VECTOR_CATALOG.length})`],
              ['architect', 'Modular Vector Designer (Combinatorial Architect)'],
              ['parts', `Modular Parts & Components (${MODULAR_VECTOR_PARTS.length})`],
              ['twist-onboarding', 'Twist Custom Vector Onboarding & Clonal Gene'],
              ['systems-strains', 'Systems, Strains & Co-Transformation Checker'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              tabIndex={subTab === id ? 0 : -1}
              aria-selected={subTab === id}
              className={`method-tab-btn ${subTab === id ? 'active' : ''}`}
              onClick={() => setSubTab(id)}
            >
              {label}
            </button>
          ))}
        </ScrollableMenuStrip>
      </div>

      {/* ─── SUB-TAB 1: VECTOR CATALOG ─── */}
      {subTab === 'catalog' && (
        <div className="studio-split-grid">
          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>Browse &amp; Filter Plasmid Backbones</h3>
              <span className="badge-accent">{filteredCatalog.length} matches</span>
            </div>

            <div className="form-grid-2col">
              <label className="form-field">
                <span>Search Name, Promoter, Tag, Host, Enzyme:</span>
                <input
                  type="text"
                  placeholder="e.g. pTwist, EF1A, hIgG1, AAV, pET-28a, GCaMP, CAR-T..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>Source / Vendor Collection:</span>
                <select value={sourceFilter} onChange={(e) => setSourceFilter(e.target.value)}>
                  <option value="All">All Sources ({VECTOR_CATALOG.length})</option>
                  <option value="Twist Bioscience">Twist Bioscience Catalog</option>
                  <option value="Modular Vector Systems">Modular Vector Systems</option>
                  <option value="ConductScience">ConductScience &amp; Classic Reference</option>
                </select>
              </label>
              <label className="form-field">
                <span>Functional Category:</span>
                <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
                  <option value="All">All Categories</option>
                  {categories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Copy Number &amp; Resistance Filter:</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <select value={copyFilter} onChange={(e) => setCopyFilter(e.target.value)} style={{ flex: 1 }}>
                    <option value="All">Any Copy #</option>
                    <option value="high">High Copy</option>
                    <option value="medium">Medium Copy</option>
                    <option value="single">Single / CEN</option>
                  </select>
                  <select value={markerFilter} onChange={(e) => setMarkerFilter(e.target.value)} style={{ flex: 1 }}>
                    <option value="All">Any Marker</option>
                    <option value="Ampicillin">Ampicillin</option>
                    <option value="Kanamycin">Kanamycin</option>
                    <option value="Chloramphenicol">Chloramphenicol</option>
                    <option value="Puromycin">Puromycin</option>
                    <option value="Hygromycin">Hygromycin</option>
                    <option value="Blasticidin">Blasticidin</option>
                    <option value="Zeocin">Zeocin</option>
                  </select>
                </div>
              </label>
              <label className="form-field">
                <span>Min Length (bp):</span>
                <input type="number" value={minBp} min={0} step={500} onChange={(e) => setMinBp(Number(e.target.value) || 0)} />
              </label>
              <label className="form-field">
                <span>Max Length (bp):</span>
                <input type="number" value={maxBp} min={1000} step={500} onChange={(e) => setMaxBp(Number(e.target.value) || 20000)} />
              </label>
            </div>

            <WorkbenchSmartTable
              tableId="vector-library-catalog"
              tableLabel="Curated Vector Catalog"
              regionMaxHeight={410}
              style={{ width: '100%', fontSize: 12 }}
            >
              <thead>
                <tr style={{ background: 'var(--mbc-bg-elevated)', textAlign: 'left' }}>
                  <th style={{ padding: '7px 8px' }}>Vector Name</th>
                  <th style={{ padding: '7px 8px' }}>Source</th>
                  <th style={{ padding: '7px 8px' }}>Promoter</th>
                  <th style={{ padding: '7px 8px' }}>Origin / Copy</th>
                  <th style={{ padding: '7px 8px' }}>Selection</th>
                  <th style={{ padding: '7px 8px' }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {filteredCatalog.map((vec) => {
                  const isSel = vec.id === selectedVector.id;
                  return (
                    <tr
                      key={vec.id}
                      onClick={() => setSelectedVectorId(vec.id)}
                      style={{
                        cursor: 'pointer',
                        borderTop: '1px solid var(--border)',
                        background: isSel ? 'var(--mbc-bg-selected)' : 'transparent',
                        color: isSel ? 'var(--mbc-text-selected)' : 'inherit',
                        fontWeight: isSel ? 600 : 400,
                      }}
                    >
                      <td style={{ padding: '6px 8px' }}>{vec.name}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11 }}>{vec.source}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11 }}>{vec.promoter}</td>
                      <td style={{ padding: '6px 8px', fontSize: 11 }}>{vec.origin} ({vec.copyNumber})</td>
                      <td style={{ padding: '6px 8px', fontSize: 11 }}>
                        {vec.bacterialMarker}
                        {vec.eukaryoticMarker !== 'None' ? ` + ${vec.eukaryoticMarker}` : ''}
                      </td>
                      <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{vec.nominalSizeBp.toLocaleString()} bp</td>
                    </tr>
                  );
                })}
              </tbody>
            </WorkbenchSmartTable>
          </div>

          {/* Right Pane: Selected Vector Inspector & Circular SVG Preview */}
          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>{selectedVector.name}</h3>
              <span className="badge-accent">{selectedVector.source}</span>
            </div>

            <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
              <div
                style={{ width: 210, height: 210, flexShrink: 0, background: 'var(--mbc-bg-panel)', borderRadius: 10, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                dangerouslySetInnerHTML={{ __html: generateCatalogCircularSvg(selectedVector) }}
              />
              <div style={{ flex: 1, minWidth: 210, fontSize: 12.5, lineHeight: 1.55 }}>
                <p style={{ margin: '0 0 8px 0' }}>{selectedVector.summary}</p>
                <div><strong>Category:</strong> {selectedVector.category} ({selectedVector.vendorLine})</div>
                <div><strong>Host System:</strong> {selectedVector.hostSystem}</div>
                <div><strong>Promoter:</strong> {selectedVector.promoter}</div>
                <div><strong>Replication Origin:</strong> {selectedVector.origin} ({selectedVector.copyNumber} copy)</div>
                <div><strong>Selection Markers:</strong> Bacterial: {selectedVector.bacterialMarker} | Eukaryotic: {selectedVector.eukaryoticMarker}</div>
                <div><strong>Recommended Host Strain:</strong> {selectedVector.recommendedStrain}</div>
                {selectedVector.maxCargoKb && (
                  <div><strong>Max Viral/Transposon Cargo:</strong> {selectedVector.maxCargoKb} kb</div>
                )}
                {selectedVector.fusionTags.length > 0 && (
                  <div><strong>Fusion Tags / Constant Domains:</strong> {selectedVector.fusionTags.join(', ')}</div>
                )}
                {selectedVector.mcsEnzymes.length > 0 && (
                  <div><strong>MCS / Cloning Sites:</strong> {selectedVector.mcsEnzymes.join(', ')}</div>
                )}
              </div>
            </div>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 4 }}>
              <button
                className="btn-primary"
                onClick={() => onAddDocument(buildCatalogVectorDocument(selectedVector))}
              >
                + Load Vector into Workbench
              </button>
              <button
                className="method-tab-btn"
                onClick={() => {
                  const doc = buildCatalogVectorDocument(selectedVector);
                  triggerTextDownload(`${selectedVector.name.replace(/[^A-Za-z0-9_.-]/g, '_')}.gb`, exportToGenBank(doc));
                }}
              >
                Download .gb (GenBank)
              </button>
              <button
                className="method-tab-btn"
                onClick={() => {
                  const doc = buildCatalogVectorDocument(selectedVector);
                  triggerTextDownload(`${selectedVector.name.replace(/[^A-Za-z0-9_.-]/g, '_')}.fasta`, exportToFasta(doc));
                }}
              >
                Download .fasta
              </button>
              <button
                className="method-tab-btn"
                onClick={() =>
                  triggerTextDownload(
                    `${selectedVector.name.replace(/[^A-Za-z0-9_.-]/g, '_')}_map.svg`,
                    generateCatalogCircularSvg(selectedVector),
                    'image/svg+xml;charset=utf-8'
                  )
                }
              >
                Download Map .svg
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SUB-TAB 2: MODULAR VECTOR DESIGNER (COMBINATORIAL ARCHITECT) ─── */}
      {subTab === 'architect' && (
        <div className="studio-split-grid">
          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>Combinatorial Vector Architect</h3>
            </div>

            {/* Primary Construct Identity + Core 4-Part Expression Cassette */}
            <div className="form-grid-2col mbc-architect-core-grid">
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Custom Construct Name:</span>
                <input type="text" value={archName} onChange={(e) => setArchName(e.target.value)} />
              </label>
              <label className="form-field">
                <span>1. Delivery / Vector System Backbone:</span>
                <select value={archSystemId} onChange={(e) => setArchSystemId(e.target.value)}>
                  {VECTOR_SYSTEM_GUIDES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.code} — {s.name} (Max Cargo {s.maxCargoKb} kb)
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>2. Core Promoter:</span>
                <select value={archPromoterId} onChange={(e) => setArchPromoterId(e.target.value)}>
                  {partsByCat('Promoter').map((p) => (
                    <option key={p.id} value={p.id}>{p.name} [{p.subCategory}, {p.sequence.length} bp]</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>3. Cargo Source (Gene of Interest / Reporter / CAR):</span>
                <select value={archCargoMode} onChange={(e) => setArchCargoMode(e.target.value as 'part' | 'custom-dna')}>
                  <option value="part">Library Reporter / Biosensor / CAR / IgG Fc</option>
                  <option value="custom-dna">Paste Custom DNA Coding Sequence</option>
                </select>
              </label>
              {archCargoMode === 'part' ? (
                <label className="form-field">
                  <span>Select Cargo ORF / Module:</span>
                  <select value={archCargoPartId} onChange={(e) => setArchCargoPartId(e.target.value)}>
                    {[...partsByCat('Reporter / ORF'), ...partsByCat('CRISPR / CAR-T / Antibody')].map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sequence.length} bp)</option>
                    ))}
                  </select>
                </label>
              ) : (
                <label className="form-field">
                  <span>Custom ORF Name:</span>
                  <input type="text" value={archCustomCargoName} onChange={(e) => setArchCustomCargoName(e.target.value)} />
                </label>
              )}
              {archCargoMode === 'custom-dna' && (
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Custom Cargo DNA Sequence (5&apos;→3&apos;):</span>
                  <textarea rows={2} value={archCustomCargoSeq} onChange={(e) => setArchCustomCargoSeq(e.target.value)} />
                  {cargoSeqProblem && <span className="warn-tag" role="alert">{cargoSeqProblem}</span>}
                </label>
              )}
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>4. Poly(A) Signal / Transcription Terminator:</span>
                <select value={archPolyAId} onChange={(e) => setArchPolyAId(e.target.value)}>
                  {partsByCat('Regulatory / PolyA / Terminator').map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sequence.length} bp)</option>
                  ))}
                </select>
              </label>
            </div>

            {/* Progressive Disclosure Group A: Optional Translation Leader, Fusion Tags & Bicistronic Marker */}
            <details className="mbc-progressive-details">
              <summary className="mbc-progressive-summary">
                <span>Optional Fusion Tags, Leader &amp; Bicistronic Selection</span>
                <span className="mbc-progressive-summary-meta">
                  {[
                    archSignalId !== 'none' ? 'Leader' : null,
                    archTagId !== 'none' ? 'N-Tag' : null,
                    archProteaseId !== 'none' ? 'Protease' : null,
                    archLinkerId !== 'none' ? '2A/IRES' : null,
                    archEukMarkerId !== 'none' ? 'Euk Marker' : null,
                  ]
                    .filter(Boolean)
                    .join(' · ') || 'None active'}
                </span>
              </summary>
              <div className="form-grid-2col" style={{ marginTop: 8 }}>
                <label className="form-field">
                  <span>5&apos; Translation Init / Secretion Leader:</span>
                  <select value={archSignalId} onChange={(e) => setArchSignalId(e.target.value)}>
                    <option value="none">None</option>
                    {partsByCat('Signal & Localization').map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sequence.length} bp)</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>N-Terminal Affinity / Solubility Tag:</span>
                  <select value={archTagId} onChange={(e) => setArchTagId(e.target.value)}>
                    <option value="none">None (Untagged)</option>
                    {partsByCat('Affinity & Fusion Tag').map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sequence.length} bp)</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Protease Cleavage Site:</span>
                  <select value={archProteaseId} onChange={(e) => setArchProteaseId(e.target.value)}>
                    <option value="none">None</option>
                    {partsByCat('Protease Cleavage').map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Bicistronic 2A / IRES Element:</span>
                  <select value={archLinkerId} onChange={(e) => setArchLinkerId(e.target.value)}>
                    <option value="none">None (Separate PGK Promoter or No Marker)</option>
                    {partsByCat('Linker / 2A / IRES').map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sequence.length} bp)</option>
                    ))}
                  </select>
                </label>
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Eukaryotic Selection Marker:</span>
                  <select value={archEukMarkerId} onChange={(e) => setArchEukMarkerId(e.target.value)}>
                    <option value="none">None</option>
                    {partsByCat('Selection Marker').map((p) => (
                      <option key={p.id} value={p.id}>{p.name} [{p.subCategory}]</option>
                    ))}
                  </select>
                </label>
              </div>
            </details>

            {/* Progressive Disclosure Group B: Post-Transcriptional Enhancer & Bacterial Backbone */}
            <details className="mbc-progressive-details">
              <summary className="mbc-progressive-summary">
                <span>Bacterial Backbone Maintenance &amp; Viral Enhancer (WPRE)</span>
                <span className="mbc-progressive-summary-meta">
                  {archOriginId.replace('ori-', '').toUpperCase()} Ori · {archBactMarkerId.replace('sel-', '').toUpperCase()}
                  {archWpreId !== 'none' ? ' · WPRE' : ''}
                </span>
              </summary>
              <div className="form-grid-2col" style={{ marginTop: 8 }}>
                <label className="form-field">
                  <span>Post-Transcriptional Enhancer (WPRE):</span>
                  <select value={archWpreId} onChange={(e) => setArchWpreId(e.target.value)}>
                    <option value="none">None</option>
                    {partsByCat('Regulatory / PolyA / Terminator')
                      .filter((p) => p.id.includes('wpre') || p.id.includes('ivthbg'))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.name} ({p.sequence.length} bp)</option>
                      ))}
                  </select>
                </label>
                <label className="form-field">
                  <span>Bacterial Origin of Replication:</span>
                  <select value={archOriginId} onChange={(e) => setArchOriginId(e.target.value)}>
                    {partsByCat('Origin').map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                  <span>Bacterial Antibiotic Resistance:</span>
                  <select value={archBactMarkerId} onChange={(e) => setArchBactMarkerId(e.target.value)}>
                    {partsByCat('Selection Marker')
                      .filter((p) => p.hostSystem.includes('E. coli'))
                      .map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                  </select>
                </label>
              </div>
            </details>
          </div>

          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>5&apos;→3&apos; SBOL Cassette Track &amp; Cargo Gauge</h3>
              <span className="badge-accent">{previewAssembly.document.sequence.length.toLocaleString()} bp Total</span>
            </div>

            {/* Interactive 5' -> 3' SBOL Cassette Ribbon */}
            <div className="mbc-sbol-cassette-shell" role="region" aria-label="5 prime to 3 prime SBOL Cassette Track">
              <div className="mbc-sbol-cassette-header">
                <span>Directional 5&apos; → 3&apos; Expression &amp; Backbone Architecture</span>
                <span className="mbc-sbol-phase-pill">
                  Reading Frame Continuity: Phase 0 (In-Frame)
                </span>
              </div>
              <div className="mbc-sbol-cassette-track">
                <span className="mbc-sbol-end-cap">5&apos;</span>
                {previewAssembly.document.features.map((f, idx) => {
                  const lenBp = f.end - f.start + 1;
                  const phase = lenBp % 3;
                  const isSelected = selectedCassetteFeatId === f.id;
                  return (
                    <React.Fragment key={f.id}>
                      {idx > 0 && (
                        <span className="mbc-sbol-junction-arrow" aria-hidden="true">
                          →
                        </span>
                      )}
                      <button
                        type="button"
                        className={`mbc-sbol-part-node ${isSelected ? 'selected' : ''}`}
                        style={{
                          borderColor: f.color,
                        }}
                        onClick={() => {
                          setSelectedCassetteFeatId(f.id);
                          onStatusNotice?.(
                            `Selected cassette module "${f.name}" (${f.start.toLocaleString()}..${f.end.toLocaleString()} bp, ${lenBp.toLocaleString()} bp)`
                          );
                        }}
                        title={`${f.name} (${f.type}) • ${f.start}..${f.end} bp (${lenBp} bp)`}
                      >
                        <span className="mbc-sbol-part-role" style={{ color: f.color }}>
                          {f.type.toUpperCase()}
                        </span>
                        <strong className="mbc-sbol-part-name">{f.name}</strong>
                        <span className="mbc-sbol-part-coords">
                          {f.start}..{f.end} bp ({lenBp} bp{f.type === 'CDS' ? ` • +${phase}` : ''})
                        </span>
                      </button>
                    </React.Fragment>
                  );
                })}
                <span className="mbc-sbol-end-cap">3&apos;</span>
              </div>
            </div>

            <div className={`mbc-cargo-gauge-card ${previewAssembly.overCapacity ? 'is-over' : 'is-ok'}`}>
              <div className="mbc-cargo-gauge-header">
                <span>Packaging / Expression Cargo: {previewAssembly.cargoSizeBp.toLocaleString()} / {previewAssembly.maxCargoBp.toLocaleString()} bp</span>
                <span>{previewAssembly.cargoUtilizationPct}%</span>
              </div>
              <div className="mbc-cargo-gauge-track">
                <div
                  className="mbc-cargo-gauge-fill"
                  style={{
                    width: `${Math.min(100, previewAssembly.cargoUtilizationPct)}%`,
                  }}
                />
              </div>
              {previewAssembly.warnings.map((w, idx) => (
                <div key={idx} className="mbc-cargo-gauge-warning">
                  • {w}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
              <button
                className="btn-primary"
                disabled={archCargoMode === 'custom-dna' && Boolean(cargoSeqProblem)}
                onClick={() => onAddDocument(previewAssembly.document)}
              >
                + Assemble &amp; Open Custom Vector in Workbench
              </button>
              <button
                className="method-tab-btn"
                disabled={archCargoMode === 'custom-dna' && Boolean(cargoSeqProblem)}
                title={
                  archCargoMode === 'custom-dna' && cargoSeqProblem
                    ? `Fix the custom cargo first: ${cargoSeqProblem}`
                    : undefined
                }
                onClick={() =>
                  triggerTextDownload(
                    `${previewAssembly.document.name.replace(/[^A-Za-z0-9_.-]/g, '_')}.gb`,
                    exportToGenBank(previewAssembly.document)
                  )
                }
              >
                Export .gb
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SUB-TAB 3: MODULAR PARTS & COMPONENTS LIBRARY ─── */}
      {subTab === 'parts' && (
        <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="studio-card-header">
            <h3>Modular Vector Components &amp; Genetic Parts ({filteredParts.length})</h3>
          </div>

          <div className="form-grid-2col">
            <label className="form-field">
              <span>Search Promoters, Tags, Linkers, Reporters, CRISPR, IgG, CAR-T:</span>
              <input
                type="text"
                placeholder="e.g. hSyn1, TRE3G, 3xFLAG, P2A, WPRE3, AAV2 ITR, LALA-PG, FMC63..."
                value={partQuery}
                onChange={(e) => setPartQuery(e.target.value)}
              />
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <label className="form-field" style={{ flex: 1 }}>
                <span>Component Category:</span>
                <select value={partCatFilter} onChange={(e) => setPartCatFilter(e.target.value)}>
                  <option value="All">All 11 Categories ({MODULAR_VECTOR_PARTS.length})</option>
                  {partCategories.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </label>
              <label className="form-field" style={{ width: 155 }}>
                <span>Insert Into {activeDoc.name.slice(0, 12)} @ bp:</span>
                <input
                  type="number"
                  min={1}
                  max={activeDoc.sequence.length + 1}
                  value={insertCoordBp}
                  onChange={(e) => setInsertCoordBp(Number(e.target.value) || 1)}
                />
              </label>
            </div>
          </div>

          <WorkbenchSmartTable
            tableId="vector-library-modular-parts"
            tableLabel="Modular Vector Parts Library"
            regionMaxHeight={470}
            style={{ width: '100%', fontSize: 12 }}
          >
            <thead>
              <tr style={{ background: 'var(--mbc-bg-elevated)', textAlign: 'left' }}>
                <th style={{ padding: '7px 8px' }}>Part Name</th>
                <th style={{ padding: '7px 8px' }}>Category / Sub-Type</th>
                <th style={{ padding: '7px 8px' }}>Host</th>
                <th style={{ padding: '7px 8px' }}>Length</th>
                <th style={{ padding: '7px 8px' }}>Biological Function</th>
                <th style={{ padding: '7px 8px' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredParts.map((part) => (
                <tr key={part.id} style={{ borderTop: '1px solid var(--border)' }}>
                  <td style={{ padding: '6px 8px', fontWeight: 600 }}>
                    <span style={{ display: 'inline-block', width: 9, height: 9, borderRadius: '50%', background: part.color, marginRight: 6 }} />
                    {part.name}
                  </td>
                  <td style={{ padding: '6px 8px', fontSize: 11 }}>{part.category} • {part.subCategory}</td>
                  <td style={{ padding: '6px 8px', fontSize: 11 }}>{part.hostSystem}</td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>{part.sequence.length} bp</td>
                  <td style={{ padding: '6px 8px', fontSize: 11.5 }}>{part.summary}</td>
                  <td style={{ padding: '6px 8px', whiteSpace: 'nowrap' }}>
                    <div style={{ display: 'flex', gap: 5 }}>
                      <button
                        className="method-tab-btn"
                        onClick={() => onInsertPartIntoActiveDoc(part, insertCoordBp)}
                        title={`Splice ${part.name} into ${activeDoc.name} at bp ${insertCoordBp}`}
                      >
                        + Splice @ {insertCoordBp}
                      </button>
                      <button
                        className="method-tab-btn"
                        onClick={() => {
                          const seq = cleanSequence(part.sequence);
                          const now = new Date().toISOString();
                          onAddDocument({
                            id: `part-${part.id}-${Date.now().toString(36)}`,
                            name: part.name.replace(/[^A-Za-z0-9_.-]/g, '_'),
                            accession: `PART_${part.id.toUpperCase().replace(/-/g, '_')}`,
                            description: `[${part.category} • ${part.source}] ${part.summary}`,
                            moleculeType: 'DNA',
                            topology: 'linear',
                            sequence: seq,
                            features: [
                              {
                                id: `pf-${part.id}`,
                                name: part.name,
                                type: part.featureType,
                                start: 1,
                                end: seq.length,
                                strand: 1,
                                color: part.color,
                                notes: part.summary,
                              },
                            ],
                            primers: [],
                            history: [],
                            createdAt: now,
                            updatedAt: now,
                            folder: 'Cloning Inserts & PCR',
                          });
                        }}
                      >
                        Open Linear Part
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </WorkbenchSmartTable>
        </div>
      )}

      {/* ─── SUB-TAB 4: TWIST CUSTOM VECTOR ONBOARDING & CLONAL GENE STUDIO ─── */}
      {subTab === 'twist-onboarding' && (
        <div className="studio-split-grid">
          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>Twist Custom Vector Onboarding QC Validator</h3>
              <span
                className={`badge-accent ${
                  twistAudit.overallStatus === 'Ready for Onboarding'
                    ? 'mbc-status-pill--pass'
                    : twistAudit.overallStatus === 'Review Warnings'
                    ? 'mbc-status-pill--warn'
                    : 'mbc-status-pill--fail'
                }`}
              >
                {twistAudit.overallStatus}
              </span>
            </div>

            <div className="form-grid-2col">
              <label className="form-field">
                <span>Workspace Plasmid Backbone to Audit:</span>
                <select value={twistTargetDoc.id} onChange={(e) => setTwistDocId(e.target.value)}>
                  {documents.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.sequence.length.toLocaleString()} bp • {d.topology})
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 6 }}>
                  <span>Target Insertion Coordinate (1-based bp):</span>
                  {onJumpToCoordinate && (
                    <button
                      type="button"
                      className="mbc-coord-jump-btn"
                      onClick={() =>
                        onJumpToCoordinate(
                          twistSiteBp,
                          Math.min(twistTargetDoc.sequence.length, twistSiteBp + 20),
                          `Insertion Site @ ${twistSiteBp} bp`,
                          twistTargetDoc.id
                        )
                      }
                      title="Jump to insertion coordinate in Sequence view"
                    >
                      Jump to {twistSiteBp.toLocaleString()} bp →
                    </button>
                  )}
                </span>
                <input
                  type="number"
                  min={1}
                  max={Math.max(1, twistTargetDoc.sequence.length)}
                  value={twistSiteBp}
                  onChange={(e) => setTwistSiteBp(Number(e.target.value) || 1)}
                />
              </label>
              <label className="form-field">
                <span>DNA Shipment Volume (µL, spec ≥ 100 µL):</span>
                <input type="number" min={10} value={twistVolUl} onChange={(e) => setTwistVolUl(Number(e.target.value) || 0)} />
              </label>
              <label className="form-field">
                <span>DNA Concentration (ng/µL, spec ≥ 100 ng/µL):</span>
                <input type="number" min={10} value={twistConcNgUl} onChange={(e) => setTwistConcNgUl(Number(e.target.value) || 0)} />
              </label>
            </div>

            <div style={{ fontSize: 12, padding: '8px 10px', borderRadius: 6, background: 'var(--mbc-bg-selected-soft)', border: '1px solid var(--border)' }}>
              <strong>Recommended Onboarding Host:</strong> {twistAudit.recommendedStrain} &nbsp;|&nbsp;
              <strong>Production Antibiotic:</strong> {twistAudit.productionAntibiotic} &nbsp;|&nbsp;
              <strong>Total Mass:</strong> {twistAudit.totalMassUg} µg (Spec ≥ 10 µg)
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {twistAudit.checks.map((chk) => {
                const coordMatch = chk.detail.match(/(?:@\s*|bp\s+|position\s+)(\d{1,7})\b/i);
                const parsedBp = coordMatch ? Number(coordMatch[1]) : null;
                const jumpBp =
                  parsedBp && parsedBp >= 1 && parsedBp <= twistTargetDoc.sequence.length
                    ? parsedBp
                    : chk.id.includes('flank') || chk.id.includes('site') || chk.status !== 'pass'
                    ? twistSiteBp
                    : null;
                return (
                  <div
                    key={chk.id}
                    className={`mbc-qc-check-row status-${chk.status}`}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                      <div style={{ fontWeight: 700 }}>
                        {chk.status === 'pass' ? 'PASS' : chk.status === 'warn' ? 'WARN' : 'FAIL'} — {chk.rule}
                      </div>
                      {onJumpToCoordinate && jumpBp !== null && (
                        <button
                          type="button"
                          className="mbc-coord-jump-btn"
                          onClick={() =>
                            onJumpToCoordinate(
                              Math.max(1, jumpBp - 15),
                              Math.min(twistTargetDoc.sequence.length, jumpBp + 15),
                              `${chk.rule} (@ ${jumpBp} bp)`,
                              twistTargetDoc.id
                            )
                          }
                          title={`Inspect ${chk.rule} locus around ${jumpBp} bp in Sequence view`}
                        >
                          Inspect @ {jumpBp.toLocaleString()} bp
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 11.5, color: 'var(--text-secondary)', marginTop: 2 }}>{chk.detail}</div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>Scarless Clonal Gene Insertion Simulator</h3>
            </div>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-secondary)' }}>
              Twist synthesizes inserts with flanking vector homology arms, so inserts splice scarlessly at bp <strong>{twistSiteBp}</strong> without needing extra restriction enzyme overhangs inside your ORF.
            </p>

            <div className="form-grid-2col">
              <label className="form-field">
                <span>Clonal Gene Insert Name:</span>
                <input type="text" value={clonalGeneName} onChange={(e) => setClonalGeneName(e.target.value)} />
              </label>
              <label className="form-field">
                <span>Reading Frame / Vector Adapter Preset:</span>
                <select
                  value={clonalFraming}
                  onChange={(e) =>
                    setClonalFraming(
                      e.target.value as 'standard-scarless' | 'entr-kozak' | 'igg-variable-inframe'
                    )
                  }
                >
                  <option value="standard-scarless">Standard Scarless Homology Splice</option>
                  <option value="entr-kozak">pTwist ENTR Kozak (Prepend GCCACC + Frame Pad)</option>
                  <option value="igg-variable-inframe">pTwist IgG VH/VL (Strip Stop Codon into CH1/CL)</option>
                </select>
              </label>
              <label className="form-field" style={{ gridColumn: '1 / -1' }}>
                <span>Clonal Gene DNA Sequence (0.3 kb – 5.0 kb Twist Synthesis Range):</span>
                <textarea rows={5} value={clonalGeneSeq} onChange={(e) => setClonalGeneSeq(e.target.value)} />
                {clonalSeqProblem && <span className="warn-tag" role="alert">{clonalSeqProblem}</span>}
              </label>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn-primary"
                disabled={Boolean(clonalSeqProblem)}
                onClick={() =>
                  onAddDocument(
                    simulateTwistClonalGeneInsertion(
                      twistTargetDoc,
                      twistSiteBp,
                      clonalGeneName,
                      clonalGeneSeq,
                      clonalFraming
                    )
                  )
                }
              >
                + Simulate Clonal Gene Insertion &amp; Open Construct
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ─── SUB-TAB 5: VECTOR SYSTEMS, HOST STRAINS & CO-TRANSFORMATION CHECKER ─── */}
      {subTab === 'systems-strains' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="studio-card" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="studio-card-header">
              <h3>Dual-Plasmid Co-Transformation &amp; Origin Compatibility Matrix</h3>
              <span className="badge-accent">{coCompat.report.compatible ? 'Compatible Pair' : 'Conflict Detected'}</span>
            </div>
            <div className="form-grid-2col">
              <label className="form-field">
                <span>Plasmid A:</span>
                <select value={coVecAId} onChange={(e) => setCoVecAId(e.target.value)}>
                  {VECTOR_CATALOG.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} [{v.origin} • {v.bacterialMarker}]</option>
                  ))}
                </select>
              </label>
              <label className="form-field">
                <span>Plasmid B:</span>
                <select value={coVecBId} onChange={(e) => setCoVecBId(e.target.value)}>
                  {VECTOR_CATALOG.map((v) => (
                    <option key={v.id} value={v.id}>{v.name} [{v.origin} • {v.bacterialMarker}]</option>
                  ))}
                </select>
              </label>
            </div>
            <div
              style={{
                padding: '9px 12px',
                borderRadius: 6,
                fontSize: 12.5,
                fontWeight: 600,
                background: coCompat.report.compatible ? 'rgba(16,185,129,0.11)' : 'rgba(220,38,38,0.11)',
                border: '1px solid var(--border)',
              }}
            >
              {coCompat.report.summary}
            </div>
          </div>

          <div className="studio-split-grid">
            <div className="studio-card">
              <div className="studio-card-header">
                <h3>Vector Systems &amp; Packaging Limits</h3>
                <span className="badge-accent">{VECTOR_SYSTEM_GUIDES.length} Systems</span>
              </div>
              <WorkbenchSmartTable
                tableId="vector-systems-packaging-limits"
                tableLabel="Vector Systems and Packaging Limits"
                regionMaxHeight={330}
                style={{ width: '100%', fontSize: 11.5 }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>Code</th>
                    <th style={{ padding: 6 }}>Delivery</th>
                    <th style={{ padding: 6 }}>Max Cargo</th>
                    <th style={{ padding: 6 }}>Strain &amp; Key Advantages</th>
                  </tr>
                </thead>
                <tbody>
                  {VECTOR_SYSTEM_GUIDES.map((g) => (
                    <tr key={g.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontWeight: 700 }}>{g.code}</td>
                      <td style={{ padding: 6 }}>{g.deliveryType} ({g.biosafetyLevel})</td>
                      <td style={{ padding: 6, whiteSpace: 'nowrap' }}>{g.maxCargoKb} kb</td>
                      <td style={{ padding: 6 }}><strong>{g.recommendedStrain}:</strong> {g.advantages}</td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>

            <div className="studio-card">
              <div className="studio-card-header">
                <h3>Host Strains &amp; Origin Groups</h3>
                <span className="badge-accent">{HOST_STRAIN_GUIDES.length} Strains • {ORIGIN_COMPATIBILITY_GROUPS.length} Ori Groups</span>
              </div>
              <WorkbenchSmartTable
                tableId="vector-host-strains-origins"
                tableLabel="Host Strains and Origin Groups"
                regionMaxHeight={330}
                style={{ width: '100%', fontSize: 11.5 }}
              >
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid var(--border)' }}>
                    <th style={{ padding: 6 }}>Strain</th>
                    <th style={{ padding: 6 }}>Category</th>
                    <th style={{ padding: 6 }}>Temp / Methylation</th>
                    <th style={{ padding: 6 }}>Application Highlights</th>
                  </tr>
                </thead>
                <tbody>
                  {HOST_STRAIN_GUIDES.map((st) => (
                    <tr key={st.id} style={{ borderTop: '1px solid var(--border)' }}>
                      <td style={{ padding: 6, fontWeight: 700 }}>{st.name}</td>
                      <td style={{ padding: 6 }}>{st.category}</td>
                      <td style={{ padding: 6 }}>{st.growthTempC} • {st.methylation}</td>
                      <td style={{ padding: 6 }}>{st.highlights}</td>
                    </tr>
                  ))}
                </tbody>
              </WorkbenchSmartTable>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

/** Reason a pasted DNA sequence is unusable, or null when it is valid IUPAC DNA. */
function dnaSequenceInputProblem(raw: string): string | null {
  const cleaned = raw.replace(/[\s\d]/g, '');
  if (!cleaned) return 'Enter a DNA sequence.';
  const bad = cleaned.toUpperCase().match(/[^ACGTURYSWKMBDHVN]/g);
  if (bad) {
    return `Not DNA: contains ${Array.from(new Set(bad)).slice(0, 6).join(', ')} (only IUPAC nucleotide letters are allowed).`;
  }
  return null;
}
