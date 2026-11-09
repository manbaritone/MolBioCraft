// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useEffect, useMemo, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import {
  CrisprGuideRecord,
  PrimerRecord,
  SequenceDocument,
  SequenceFeature,
} from '../types/bio';
import {
  calculatePrimerMetrics,
  designPCRPrimers,
  findCrisprGuides,
  testSavedPrimersOnSequence,
} from '../core/bioEngine';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { MolBioMenuGlyph } from './MolBioIcons';
import { ResultWarnings } from './ResultWarnings';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { originSpanningSiteCount, primerSiteStatus } from '../core/primerSiteStatus';
import { primerTmText } from './CircularPlasmidMap';

/** How many of the candidate guides the CRISPR tab lists. */
const CRISPR_GUIDES_LISTED = 25;

/**
 * A guide record with the scan facts every one of them carries (BG-01M6S15R): the engine's
 * `find_crispr_guides` reply is the guide list alone, so each guide repeats how many candidate
 * guides the scan found, the range of the sequence it read, and the scan's own warnings.
 */
type ScannedGuide = CrisprGuideRecord & {
  candidateCount?: number;
  scannedLengthBp?: number;
  sequenceLengthBp?: number;
  /** Whether the scan read the record as the circle it is, origin and all (BG-01M6T6GQ). */
  scannedCircular?: boolean;
  /** The bases across the origin such a scan read, 0 when it did not wrap. */
  originSpanBp?: number;
  warnings?: string[];
};

/** A count or a length as a researcher reads it, grouped like the engine's own sentences. */
const bp = (n: number) => n.toLocaleString('en-US');

/**
 * The bases a guide covers. A guide whose site straddles a circular record's origin runs from a
 * start past its end — the coordinate convention this workbench uses for a site across the origin —
 * so the range says so rather than reading backwards (BG-01M6T6GQ).
 */
const guideRange = (g: CrisprGuideRecord) =>
  `${bp(g.start)}..${bp(g.end)}${g.start > g.end ? ' (across the origin)' : ''}`;

interface PrimerAndPCRStudioProps {
  doc: SequenceDocument;
  allDocuments?: SequenceDocument[];
  onUpdateDocument: (updated: SequenceDocument) => void;
  onAddConstruct: (ampliconDoc: SequenceDocument) => void;
  onStatusNotice?: (message: string) => void;
  onJumpToCoordinate?: (start: number, end: number, label?: string) => void;
  /** Sub-tab requested by a menu command (CRISPR sites, saved primers, design). */
  initialSubTab?: 'design' | 'saved' | 'crispr';
  commandNonce?: number;
}

export const PrimerAndPCRStudio: React.FC<PrimerAndPCRStudioProps> = ({
  doc,
  allDocuments = [],
  onUpdateDocument,
  onAddConstruct,
  onStatusNotice,
  onJumpToCoordinate,
  initialSubTab = 'design',
  commandNonce,
}) => {
  // In the workbench the conditions of each sub-tab sit in App's inspector; drawn on its own, the
  // studio keeps every setting where it sits in its card (US-01M6TAKD).
  const inWorkbench = useInWorkbench();
  const [subTab, setSubTab] = useState<'design' | 'saved' | 'crispr'>(initialSubTab);
  // Menu commands such as Find CRISPR Sites always landed on the design tab.
  useEffect(() => {
    setSubTab(initialSubTab);
  }, [initialSubTab, commandNonce]);

  const [regionStart, setRegionStart] = useState<number>(
    doc.features.find((f) => f.type === 'CDS')?.start ?? 100
  );
  const [regionEnd, setRegionEnd] = useState<number>(
    doc.features.find((f) => f.type === 'CDS')?.end ?? Math.min(doc.sequence.length, 820)
  );
  // Region defaults come from the document the studio opened on; re-derive them
  // when the active document changes (they used to keep the previous
  // document's coordinates, clamped into a mislabelled product).
  useEffect(() => {
    const cds = doc.features.find((f) => f.type === 'CDS' && f.start < f.end);
    setRegionStart(cds?.start ?? Math.min(100, Math.max(1, Math.floor(doc.sequence.length / 4))));
    setRegionEnd(cds?.end ?? Math.min(doc.sequence.length, 820));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id]);
  const [targetTm, setTargetTm] = useState<number>(60.0);
  const [fwdTailEnz, setFwdTailEnz] = useState<string>('None');
  const [revTailEnz, setRevTailEnz] = useState<string>('None');
  const [includeClampTail, setIncludeClampTail] = useState<boolean>(true);

  // Manual Oligo Evaluator
  const [customOligo, setCustomOligo] = useState<string>(
    'GGAATTCCATATGGTGAGCAAGGGCGAGGAG'
  );
  const [naMm, setNaMm] = useState<number>(50);
  const [mgMm, setMgMm] = useState<number>(1.5);
  const [primerNm, setPrimerNm] = useState<number>(250);

  // Test with Saved Primers state
  const [maxAllowedMismatches, setMaxAllowedMismatches] = useState<number>(2);

  // CRISPR Guide Finder state
  const [crisprNuclease, setCrisprNuclease] = useState<
    'SpCas9 (NGG)' | 'Cas12a / Cpf1 (TTTV)'
  >('SpCas9 (NGG)');

  const fwdTailSeq = useMemo(() => {
    if (fwdTailEnz === 'None') return '';
    const enz = REBASE_ENZYMES.find((e) => e.name === fwdTailEnz);
    return (includeClampTail ? 'GCG' : '') + (enz?.recognitionSeq ?? '');
  }, [fwdTailEnz, includeClampTail]);

  const revTailSeq = useMemo(() => {
    if (revTailEnz === 'None') return '';
    const enz = REBASE_ENZYMES.find((e) => e.name === revTailEnz);
    return (includeClampTail ? 'CGC' : '') + (enz?.recognitionSeq ?? '');
  }, [revTailEnz, includeClampTail]);

  // Valid linear target: inside the sequence, start before end, long enough
  // for two primers. Reversed / out-of-range regions used to produce 0-bp or
  // nonsense amplicons that could still be saved.
  const pcrRegionValid =
    regionStart >= 1 &&
    regionEnd <= doc.sequence.length &&
    regionEnd - regionStart + 1 >= 40;

  const designedPCR = useMemo(
    () =>
      designPCRPrimers(
        doc,
        regionStart,
        regionEnd,
        targetTm,
        fwdTailSeq,
        revTailSeq
      ),
    [doc, regionStart, regionEnd, targetTm, fwdTailSeq, revTailSeq]
  );

  const customMetrics = useMemo(
    () => calculatePrimerMetrics(customOligo, naMm, mgMm, primerNm),
    [customOligo, naMm, mgMm, primerNm]
  );

  // Collect all saved primers across workspace documents + standard universal sequencing primers
  const savedPrimerCatalog = useMemo(() => {
    const map = new Map<string, PrimerRecord>();
    for (const d of [doc, ...allDocuments]) {
      for (const p of d.primers) {
        map.set(p.name, p);
      }
    }
    return Array.from(map.values());
  }, [doc, allDocuments]);

  const savedPrimerHits = useMemo(
    () => testSavedPrimersOnSequence(doc.sequence, savedPrimerCatalog, maxAllowedMismatches),
    [doc.sequence, savedPrimerCatalog, maxAllowedMismatches]
  );

  // Per-primer binding multiplicity & specificity alerts on active template
  const docPrimerSiteCounts = useMemo(() => {
    const hits = testSavedPrimersOnSequence(doc.sequence, doc.primers, 1);
    const counts = new Map<string, number>();
    for (const p of doc.primers) {
      counts.set(p.name, 0);
    }
    for (const h of hits) {
      counts.set(h.primer.name, (counts.get(h.primer.name) ?? 0) + 1);
    }
    return counts;
  }, [doc.sequence, doc.primers]);

  // The record's own topology goes to the engine: a plasmid is scanned as the circle it is, so the
  // guides across its origin are listed (BG-01M6T6GQ).
  const crisprGuides = useMemo(
    () =>
      findCrisprGuides(
        doc.sequence,
        crisprNuclease,
        CRISPR_GUIDES_LISTED,
        doc.topology === 'circular'
      ) as ScannedGuide[],
    [doc.sequence, doc.topology, crisprNuclease]
  );
  // What the scan itself reports, taken from the guides it returned and never derived here: a scan
  // that found no guide counted no seed match either, and says so instead of naming a range.
  const crisprScan = crisprGuides[0];
  const crisprCandidates = crisprScan?.candidateCount ?? 0;
  const crisprScanned = crisprScan?.scannedLengthBp;
  const crisprSequenceBp = crisprScan?.sequenceLengthBp;
  const crisprScanIsPartial =
    crisprScanned !== undefined &&
    crisprSequenceBp !== undefined &&
    crisprScanned < crisprSequenceBp;
  // Read from the scan's own reply, never from the document: a circular record the scan could not
  // read whole was read straight, and says so instead of claiming its origin.
  const crisprScanWrapped =
    crisprScan?.scannedCircular === true && (crisprScan.originSpanBp ?? 0) > 0;
  const crisprTabCount =
    crisprCandidates > crisprGuides.length
      ? `top ${bp(crisprGuides.length)} of ${bp(crisprCandidates)} Guides`
      : `${bp(crisprGuides.length)} Guides`;

  const handleSavePrimersToDoc = () => {
    const updatedPrimers: PrimerRecord[] = [
      ...doc.primers,
      designedPCR.forward,
      designedPCR.reverse,
    ];
    onUpdateDocument({
      ...doc,
      primers: updatedPrimers,
      updatedAt: new Date().toISOString(),
    });
    onStatusNotice?.(
      `Bound primer pair "${designedPCR.forward.name}" & "${designedPCR.reverse.name}" (${regionStart.toLocaleString()}..${regionEnd.toLocaleString()} bp) to "${doc.name}"`
    );
  };

  const handleAnnotateCrisprGuide = (g: CrisprGuideRecord) => {
    const newFeat: SequenceFeature = {
      id: `feat-${g.id}-${Date.now()}`,
      name: `${g.name} (${g.pamSeq})`,
      type: 'crispr_guide',
      start: g.start,
      end: g.end,
      strand: g.strand,
      color: g.onTargetScore >= 70 ? '#16a34a' : g.onTargetScore >= 50 ? '#d97706' : '#dc2626',
      notes: `${g.nuclease} spacer ${g.spacerSeq} | Cut @ ${g.cutPosition} | Heuristic=${g.onTargetScore}, seed matches=${g.offTargetCount}`,
    };
    onUpdateDocument({
      ...doc,
      features: [...doc.features, newFeat],
      updatedAt: new Date().toISOString(),
    });
    onStatusNotice?.(
      `Annotated CRISPR guide "${g.name}" (${g.start.toLocaleString()}..${g.end.toLocaleString()} bp, DSB @ ${g.cutPosition.toLocaleString()} bp) on "${doc.name}"`
    );
  };

  const handleAnnotateTop5Crispr = () => {
    const top5: SequenceFeature[] = crisprGuides.slice(0, 5).map((g, idx) => ({
      id: `feat-top-${g.id}-${Date.now()}-${idx}`,
      name: `${g.name} (${g.pamSeq})`,
      type: 'crispr_guide',
      start: g.start,
      end: g.end,
      strand: g.strand,
      color: g.onTargetScore >= 70 ? '#16a34a' : '#d97706',
      notes: `${g.nuclease} spacer ${g.spacerSeq} | Heuristic=${g.onTargetScore}, seed matches=${g.offTargetCount}`,
    }));
    onUpdateDocument({
      ...doc,
      features: [...doc.features, ...top5],
      updatedAt: new Date().toISOString(),
    });
    onStatusNotice?.(
      `Annotated top ${top5.length} CRISPR guides onto "${doc.name}"`
    );
  };

  const handleCreateAmpliconDocument = () => {
    const ampDoc: SequenceDocument = {
      id: `doc-pcr-${Date.now()}`,
      name: `PCR_${doc.name}_${regionStart}_${regionEnd}`,
      accession: `MBC_PCR_${regionStart}`,
      description: `In silico PCR amplicon (${designedPCR.ampliconLength} bp) amplified from ${doc.name} (${regionStart}..${regionEnd}) using ${designedPCR.forward.name} and ${designedPCR.reverse.name}.`,
      moleculeType: 'DNA',
      topology: 'linear',
      sequence: designedPCR.ampliconSeq,
      folder: 'Cloning Inserts & PCR',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      features: [
        {
          id: `f-amp-${Date.now()}`,
          name: `Amplified Target (${regionStart}..${regionEnd})`,
          type: 'CDS',
          start: fwdTailSeq.length + 1,
          end: designedPCR.ampliconLength - revTailSeq.length,
          strand: 1,
          color: '#10b981',
        },
      ],
      primers: [designedPCR.forward, designedPCR.reverse],
      history: [
        ...doc.history,
        {
          id: `h-pcr-${Date.now()}`,
          timestamp: new Date().toISOString().slice(0, 16).replace('T', ' '),
          operation: `In Silico PCR Amplification`,
          description: `Amplified ${designedPCR.ampliconLength} bp product (${regionStart}..${regionEnd}) with 5' ${fwdTailEnz}/${revTailEnz} adapter tails`,
          parentIds: [doc.id],
          lengthBp: designedPCR.ampliconLength,
          topology: 'linear',
        },
      ],
    };
    onAddConstruct(ampDoc);
    onStatusNotice?.(
      `Amplified "${ampDoc.name}" (${designedPCR.ampliconLength.toLocaleString()} bp) and saved to workspace`
    );
  };

  // ─── The settings each sub-tab offers, drawn in App's inspector or in the card they sit in ───

  const targetTmField = (
    <label className="form-field">
      <span>Target Annealing Tm (°C):</span>
      <input
        type="number"
        min={45}
        max={75}
        step={0.5}
        value={targetTm}
        onChange={(e) => setTargetTm(Number(e.target.value))}
      />
    </label>
  );

  // The tails keep their progressive details and its summary line, which says what the pair carries.
  const adapterTailsDetails = (
    <details className="mbc-progressive-details">
      <summary className="mbc-progressive-summary">
        <span>5&apos; Cloning Adapter Tails (Optional)</span>
        <span className="mbc-progressive-summary-meta">
          {fwdTailEnz === 'None' && revTailEnz === 'None'
            ? 'Blunt / Direct PCR'
            : `5' ${fwdTailEnz} / ${revTailEnz}${includeClampTail ? ' + 3-nt leader' : ''}`}
        </span>
      </summary>
      <div className="form-grid-3col" style={{ marginTop: 8 }}>
        <label className="form-field">
          <span>5&apos; Forward Enzyme Tail:</span>
          <select value={fwdTailEnz} onChange={(e) => setFwdTailEnz(e.target.value)}>
            <option value="None">None (Blunt PCR)</option>
            {REBASE_ENZYMES.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.recognitionSeq})
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>5&apos; Reverse Enzyme Tail:</span>
          <select value={revTailEnz} onChange={(e) => setRevTailEnz(e.target.value)}>
            <option value="None">None (Blunt PCR)</option>
            {REBASE_ENZYMES.map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.recognitionSeq})
              </option>
            ))}
          </select>
        </label>
        <label className="form-field checkbox-centered">
          <input
            type="checkbox"
            checked={includeClampTail}
            onChange={(e) => setIncludeClampTail(e.target.checked)}
          />
          Add 3-nt 5&apos; Cleavage Leader (GCG)
        </label>
      </div>
    </details>
  );

  /**
   * The oligo calculator's buffer: it corrects the custom oligo's Tm only. `designPCRPrimers` is
   * never handed these, so the inspector section says whose conditions they are.
   */
  const bufferGrid = (
    <div className="form-grid-3col" style={{ marginTop: 8 }}>
      <label className="form-field">
        <span>[Na⁺ / K⁺] (mM):</span>
        <input
          type="number"
          value={naMm}
          onChange={(e) => setNaMm(Number(e.target.value))}
        />
      </label>
      <label className="form-field">
        <span>[Mg²⁺] (mM):</span>
        <input
          type="number"
          step={0.1}
          value={mgMm}
          onChange={(e) => setMgMm(Number(e.target.value))}
        />
      </label>
      <label className="form-field">
        <span>[Primer] (nM):</span>
        <input
          type="number"
          value={primerNm}
          onChange={(e) => setPrimerNm(Number(e.target.value))}
        />
      </label>
    </div>
  );

  const mismatchSelect = (
    <select
      value={maxAllowedMismatches}
      onChange={(e) => setMaxAllowedMismatches(Number(e.target.value))}
    >
      <option value={0}>0 (Exact 100% Match Only)</option>
      <option value={1}>Up to 1 Mismatch</option>
      <option value={2}>Up to 2 Mismatches</option>
      <option value={3}>Up to 3 Mismatches</option>
    </select>
  );
  const MISMATCH_LABEL = "Max 5' Mismatches Allowed (3' 5-nt Clamp Required):";

  const nucleaseSelect = (
    <select
      aria-label="Nuclease / PAM:"
      value={crisprNuclease}
      onChange={(e) =>
        setCrisprNuclease(e.target.value as 'SpCas9 (NGG)' | 'Cas12a / Cpf1 (TTTV)')
      }
    >
      <option value="SpCas9 (NGG)">SpCas9 — 5&apos;-N20-NGG-3&apos; (3&apos; PAM)</option>
      <option value="Cas12a / Cpf1 (TTTV)">
        LbCas12a / Cpf1 — 5&apos;-TTTV-N20-3&apos; (5&apos; PAM)
      </option>
    </select>
  );

  return (
    <div className="alignment-studio-wrapper">
      <div className="studio-card-header" style={{ marginBottom: 8 }}>
        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Primer and CRISPR Tools"
          activeKey={subTab}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide primer tools left"
          nextAriaLabel="Slide primer tools right"
        >
          <button
            type="button"
            role="tab"
            tabIndex={subTab === 'design' ? 0 : -1}
            aria-selected={subTab === 'design'}
            className={`method-tab-btn ${subTab === 'design' ? 'active' : ''}`}
            onClick={() => setSubTab('design')}
          >
            <MolBioMenuGlyph glyph="primer-design" size={13} />
            <span>Design New Primers &amp; Oligo Biophysics</span>
          </button>
          <button
            type="button"
            role="tab"
            tabIndex={subTab === 'saved' ? 0 : -1}
            aria-selected={subTab === 'saved'}
            className={`method-tab-btn ${subTab === 'saved' ? 'active' : ''}`}
            onClick={() => setSubTab('saved')}
          >
            <MolBioMenuGlyph glyph="primer-map" size={13} />
            <span>Test with Saved Primers ({savedPrimerHits.length} Binding Sites)</span>
          </button>
          <button
            type="button"
            role="tab"
            tabIndex={subTab === 'crispr' ? 0 : -1}
            aria-selected={subTab === 'crispr'}
            className={`method-tab-btn ${subTab === 'crispr' ? 'active' : ''}`}
            onClick={() => setSubTab('crispr')}
          >
            <MolBioMenuGlyph glyph="crispr-cas9" size={13} />
            <span>Find CRISPR Sites &amp; Off-Targets ({crisprTabCount})</span>
          </button>
        </ScrollableMenuStrip>
      </div>

      {subTab === 'design' && (
        <div className="studio-split-grid">
          {inWorkbench && (
            <>
              <InspectorSection title="Primer Design" order={1}>
                {targetTmField}
                {adapterTailsDetails}
              </InspectorSection>
              <InspectorSection title={'Oligo Calculator: Buffer & Ionic Conditions'} order={2}>
                {bufferGrid}
              </InspectorSection>
            </>
          )}
          {/* Automated Primer Design & PCR Simulator */}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>PCR Primer Design &amp; Amplicon Simulator</h3>
              <span className="badge-accent">SantaLucia 1998 Nearest-Neighbor</span>
            </div>

            {/* The target region stays with the pair it amplifies; in the workbench the Tm that
                designs it sits in the inspector, and the row is the two fields it then holds. */}
            <div className={inWorkbench ? 'form-grid-2col' : 'form-grid-3col'}>
              <label className="form-field">
                <span>Target Start (bp):</span>
                <input
                  type="number"
                  min={1}
                  max={doc.sequence.length}
                  value={regionStart}
                  onChange={(e) => setRegionStart(Number(e.target.value))}
                />
              </label>
              <label className="form-field">
                <span>Target End (bp):</span>
                <input
                  type="number"
                  min={1}
                  max={doc.sequence.length}
                  value={regionEnd}
                  onChange={(e) => setRegionEnd(Number(e.target.value))}
                />
              </label>
              {!inWorkbench && targetTmField}
            </div>

            {!inWorkbench && adapterTailsDetails}

            {/* Designed Forward & Reverse Primer Cards */}
            <div className="primer-pair-cards">
              {[designedPCR.forward, designedPCR.reverse].map((prm) => (
                <div key={prm.id} className="primer-detail-card">
                  <div className="primer-card-top">
                    <strong>
                      {prm.strand === 1 ? 'Forward Primer:' : 'Reverse Primer:'} {prm.name}
                    </strong>
                    <span className="tm-pill">
                      Anneal {primerTmText(prm)} | Full {primerTmText(prm, { full: true })}
                    </span>
                  </div>
                  <div className="primer-seq-display">
                    5&apos;-
                    {prm.tail5Prime && <span className="tail-highlight">{prm.tail5Prime}</span>}
                    <span>{prm.annealSequence}</span>-3&apos;
                  </div>
                  <div className="primer-metrics-strip">
                    <span>Length: {prm.length} nt</span>
                    <span>GC: {prm.gcPercent}%</span>
                    <span>ΔG°37: {prm.deltaG37} kcal/mol</span>
                    <span>Hairpin ΔG: {prm.hairpinDeltaG} kcal/mol</span>
                    <span>Self-Dimer ΔG: {prm.selfDimerDeltaG} kcal/mol</span>
                    <span className={prm.gcClamp3Prime ? 'ok-tag' : 'warn-tag'}>
                      3&apos; GC Clamp: {prm.gcClamp3Prime ? 'Yes' : 'No'}
                    </span>
                  </div>
                </div>
              ))}
            </div>

            <div className="cloning-action-row">
              <button className="btn-primary" disabled={!pcrRegionValid} onClick={handleSavePrimersToDoc}>
                + Bind Primer Pair to {doc.name}
              </button>
              <button
                className="btn-success"
                disabled={!pcrRegionValid}
                title={pcrRegionValid ? undefined : 'Choose a target region inside the sequence (start before end, at least 40 bp)'}
                onClick={handleCreateAmpliconDocument}
              >
                Amplify &amp; Save {designedPCR.ampliconLength} bp PCR Product to Workspace
              </button>
            </div>
          </div>

          {/* Interactive Oligo Thermodynamics & Existing Primers Table */}
          <div className="studio-card">
            <div className="studio-card-header">
              <h3>Oligo Biophysics &amp; Secondary Structure Calculator</h3>
              <span className="badge-accent">Owczarzy Mg²⁺ / Na⁺ Salt Correction</span>
            </div>

            <label className="form-field">
              <span>Enter Custom Oligonucleotide Sequence (5&apos; → 3&apos;):</span>
              <input
                type="text"
                value={customOligo}
                onChange={(e) => setCustomOligo(e.target.value.toUpperCase())}
                className="mono-input"
              />
            </label>

            {!inWorkbench && (
              <details className="mbc-progressive-details">
                <summary className="mbc-progressive-summary">
                  <span>Buffer &amp; Ionic Conditions</span>
                  <span className="mbc-progressive-summary-meta">
                    {naMm} mM Na⁺ · {mgMm} mM Mg²⁺ · {primerNm} nM Oligo
                  </span>
                </summary>
                {bufferGrid}
              </details>
            )}

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">Salt-Corrected Tm</span>
                {/* An oligo holding N has no Tm: the engine's reason reads in its place (BG-01M6SHQ0). */}
                {customMetrics.tmNoAnswerReason ? (
                  <>
                    <strong className="kpi-val">n/a</strong>
                    <span className="kpi-label">{customMetrics.tmNoAnswerReason}</span>
                  </>
                ) : (
                  <strong className="kpi-val">{customMetrics.tmC} °C</strong>
                )}
              </div>
              <div className="kpi-box">
                <span className="kpi-label">GC Content</span>
                <strong className="kpi-val">{customMetrics.gcPercent}%</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Duplex ΔG°₃₇</span>
                <strong className="kpi-val">{customMetrics.deltaG37} kcal/mol</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Hairpin / Dimer ΔG</span>
                <strong className="kpi-val">
                  {customMetrics.hairpinDeltaG} / {customMetrics.selfDimerDeltaG}
                </strong>
              </div>
            </div>

            <h4 className="sub-heading">Cataloged Primers &amp; Binding Specificity on {doc.name}</h4>
            <WorkbenchSmartTable
              tableId="primer-studio-cataloged-primers"
              tableLabel="Cataloged Primers and Binding Specificity"
              regionMaxHeight={260}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Primer Name</th>
                  <th>Biophysics</th>
                  <th>Binding</th>
                  <th>Specificity Alert</th>
                  <th>Tm (°C)</th>
                </tr>
              </thead>
              <tbody>
                {doc.primers.map((p) => {
                  // A primer that no longer binds (e.g. after an edit) has 0 sites;
                  // it used to be shown as a green "unique site".
                  const siteCount = docPrimerSiteCounts.get(p.name) ?? 0;
                  const totalSites =
                    siteCount +
                    (doc.topology === 'circular' ? originSpanningSiteCount(p.annealSequence || p.sequence, doc.sequence) : 0);
                  const siteStatus = primerSiteStatus(
                    p.annealSequence || p.sequence,
                    doc.sequence,
                    doc.topology === 'circular',
                    siteCount
                  );
                  const mwDa = (p.length * 303.7 + 79.0).toFixed(1);
                  return (
                    <tr key={p.id}>
                      <td>
                        <strong>{p.name}</strong>
                        <div className="mono-cell" style={{ fontSize: 11, opacity: 0.85 }}>
                          5&apos;-{p.sequence}-3&apos;
                        </div>
                      </td>
                      <td>
                        {p.length}-mer &middot; {p.gcPercent}% GC &middot; {mwDa} Da
                      </td>
                      <td>
                        {onJumpToCoordinate ? (
                          <button
                            type="button"
                            className="mbc-coord-jump-btn"
                            title={`Jump to ${p.name} binding site (${p.bindStart}..${p.bindEnd} bp) in Sequence view`}
                            onClick={() =>
                              onJumpToCoordinate(p.bindStart, p.bindEnd, p.name)
                            }
                          >
                            {p.bindStart}..{p.bindEnd} ({p.strand === 1 ? '→' : '←'})
                          </button>
                        ) : (
                          <>
                            {p.bindStart}..{p.bindEnd} ({p.strand === 1 ? '→' : '←'})
                          </>
                        )}
                      </td>
                      <td>
                        {siteStatus === 'not-checked' ? (
                          <span
                            style={{ opacity: 0.75, fontSize: 11 }}
                            title="The binding check covers ACGT anneal regions of 12 nt or more that do not span the origin; this primer is outside that scope."
                          >
                            Binding not checked (short, degenerate or origin-spanning)
                          </span>
                        ) : siteStatus === 'none' ? (
                          <span className="warn-tag">⚠ No binding site (≤ 1 mismatch) in this sequence</span>
                        ) : siteStatus === 'multiple' ? (
                          <span className="warn-tag">
                            ⚠ Primer has {totalSites} binding sites
                          </span>
                        ) : (
                          <span className="ok-tag">✓ Unique site (1)</span>
                        )}
                      </td>
                      <td>
                        <strong>{primerTmText(p, { prefix: false })}</strong>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        </div>
      )}

      {subTab === 'saved' && (
        <div className="studio-card">
          {inWorkbench && (
            <InspectorSection title="Saved Primer Screening" order={1}>
              <label className="form-field">
                <span>{MISMATCH_LABEL}</span>
                {mismatchSelect}
              </label>
            </InspectorSection>
          )}
          <div className="studio-card-header">
            <h3>
              Test with Saved Primers — Screening {savedPrimerCatalog.length} Database Primers against{' '}
              {doc.name}
            </h3>
            {!inWorkbench && (
              <div className="gel-controls-inline">
                <label>
                  {MISMATCH_LABEL} {mismatchSelect}
                </label>
              </div>
            )}
          </div>

          <div className="info-callout">
            <strong>
              Primers{' '}
              <ChevronRight
                size={13}
                strokeWidth={2.4}
                className="mbc-inline-chevron"
                aria-hidden="true"
              />{' '}
              Test with Saved Primers
            </strong>{' '}
            screens your primer collection for binding sites on both strands of <strong>{doc.name}</strong> ({doc.sequence.length.toLocaleString()} bp) requiring a 3&apos; pentamer clamp.
          </div>

          <WorkbenchSmartTable
            tableId="primer-studio-saved-screening"
            tableLabel="Saved Primer Screening Hits"
            className="bio-table"
          >
            <thead>
              <tr>
                <th>Primer Name</th>
                <th>Sequence (5&apos;→3&apos;)</th>
                <th>Strand</th>
                <th>Binding Coordinates</th>
                <th>Mismatches</th>
                <th>Effective Tm (°C)</th>
              </tr>
            </thead>
            <tbody>
              {savedPrimerHits.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    No saved primers bound within {maxAllowedMismatches} mismatches. Try increasing mismatch tolerance or designing new primers.
                  </td>
                </tr>
              ) : (
                savedPrimerHits.map((hit, idx) => (
                  <tr key={idx}>
                    <td>
                      <strong>{hit.primer.name}</strong>
                    </td>
                    <td className="mono-cell">{hit.primer.sequence}</td>
                    <td>{hit.strand === 1 ? 'Forward (+)' : 'Reverse (-)'}</td>
                    <td>
                      {onJumpToCoordinate ? (
                        <button
                          type="button"
                          className="mbc-coord-jump-btn"
                          title={`Jump to ${hit.primer.name} (${hit.bindStart}..${hit.bindEnd} bp) in Sequence view`}
                          onClick={() =>
                            onJumpToCoordinate(hit.bindStart, hit.bindEnd, hit.primer.name)
                          }
                        >
                          {hit.bindStart}..{hit.bindEnd}
                        </button>
                      ) : (
                        <>
                          {hit.bindStart}..{hit.bindEnd}
                        </>
                      )}
                    </td>
                    <td>
                      <span className={hit.mismatches === 0 ? 'ok-tag' : 'warn-tag'}>
                        {hit.mismatches} mm
                      </span>
                    </td>
                    <td>{hit.effectiveTmC} °C</td>
                  </tr>
                ))
              )}
            </tbody>
          </WorkbenchSmartTable>
        </div>
      )}

      {subTab === 'crispr' && (
        <div className="studio-card">
          {inWorkbench && (
            <InspectorSection title="CRISPR Guides" order={1}>
              <label className="form-field">
                <span>Nuclease / PAM:</span>
                {nucleaseSelect}
              </label>
            </InspectorSection>
          )}
          <div className="studio-card-header">
            <h3>
              CRISPR/Cas Guide Finder &amp; Off-Target Specificity Scorer — {doc.name}
            </h3>
            <div className="cloning-action-row">
              {!inWorkbench && nucleaseSelect}
              <button className="btn-success" onClick={handleAnnotateTop5Crispr}>
                + Annotate Top 5 Guides onto {doc.name}
              </button>
            </div>
          </div>

          <div className="info-callout">
            {crisprScan === undefined
              ? `No ${crisprNuclease} guide in this sequence.`
              : crisprCandidates > crisprGuides.length
              ? `Lists the ${bp(crisprGuides.length)} highest-scoring of the ${bp(crisprCandidates)} candidate ${crisprNuclease} guides found.`
              : `Lists all ${bp(crisprCandidates)} candidate ${crisprNuclease} guides found.`}{' '}
            <strong>Heuristic score</strong>: rule-of-thumb activity (GC 40–65 %, 3&apos; G, no TTTT) — not a trained Doench model.{' '}
            {crisprScan !== undefined && (
              <>
                <strong>Seed matches</strong>:{' '}
                {crisprScanIsPartial
                  ? `other exact copies of the 12-nt PAM-proximal seed in bases 1 to ${bp(crisprScanned!)} of the ${bp(crisprSequenceBp!)} bases of this sequence — the range searched, on both strands`
                  : crisprScanWrapped
                  ? `other exact copies of the 12-nt PAM-proximal seed across all ${bp(crisprSequenceBp!)} bases of this circular sequence, including the ${bp(crisprScan!.originSpanBp!)} across its origin, on both strands`
                  : `other exact copies of the 12-nt PAM-proximal seed across all ${bp(crisprSequenceBp!)} bases of this linear sequence, on both strands`}{' '}
                (no genome-wide off-target search).
              </>
            )}
          </div>

          <ResultWarnings warnings={crisprScan?.warnings} label="CRISPR guide warnings" />

          <WorkbenchSmartTable
            tableId="primer-studio-crispr-guides"
            tableLabel="CRISPR Guide Candidates Table"
            regionMaxHeight={340}
            className="bio-table"
          >
            <thead>
              <tr>
                <th>Guide Name</th>
                <th>20-nt Spacer Sequence (5&apos;→3&apos;)</th>
                <th>PAM</th>
                <th>Strand</th>
                <th>Region (Cut Site)</th>
                <th>GC%</th>
                <th>Heuristic Score</th>
                <th>Hsu Specificity</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {crisprGuides.map((g) => (
                <tr key={g.id}>
                  <td>
                    <strong>{g.name}</strong>
                  </td>
                  <td className="mono-cell">{g.spacerSeq}</td>
                  <td className="mono-cell">
                    <strong>{g.pamSeq}</strong>
                  </td>
                  <td>{g.strand === 1 ? 'Forward (+)' : 'Reverse (-)'}</td>
                  <td>
                    {onJumpToCoordinate ? (
                      <button
                        type="button"
                        className="mbc-coord-jump-btn"
                        title={`Jump to ${g.name} (${guideRange(g)} bp, DSB @ ${bp(g.cutPosition)}) in Sequence view`}
                        onClick={() =>
                          onJumpToCoordinate(g.start, g.end, `${g.name} (${g.pamSeq})`)
                        }
                      >
                        {guideRange(g)} (DSB @ {bp(g.cutPosition)})
                      </button>
                    ) : (
                      <>
                        {guideRange(g)} (DSB @ {bp(g.cutPosition)})
                      </>
                    )}
                  </td>
                  <td>{g.gcPercent}%</td>
                  <td>
                    <span
                      className="score-heat-pill"
                      style={{
                        background:
                          g.onTargetScore >= 70
                            ? '#dcfce7'
                            : g.onTargetScore >= 50
                            ? '#fef3c7'
                            : '#fee2e2',
                        color:
                          g.onTargetScore >= 70
                            ? '#166534'
                            : g.onTargetScore >= 50
                            ? '#92400e'
                            : '#991b1b',
                      }}
                    >
                      {g.onTargetScore} / 100
                    </span>
                  </td>
                  <td>
                    <span
                      className="score-heat-pill"
                      style={{
                        background: g.specificityScore >= 80 ? '#e0f2fe' : '#fef3c7',
                        color: g.specificityScore >= 80 ? '#0369a1' : '#92400e',
                      }}
                    >
                      {g.offTargetCount === 0 ? 'Unique seed' : `${g.offTargetCount} seed match${g.offTargetCount > 1 ? 'es' : ''}`}
                    </span>
                  </td>
                  <td>
                    <button
                      className="btn-secondary-sm"
                      onClick={() => handleAnnotateCrisprGuide(g)}
                    >
                      + Annotate
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </WorkbenchSmartTable>
        </div>
      )}
    </div>
  );
};
