// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { TriangleAlert } from 'lucide-react';
import { CloningMethodType, GelBufferType, SequenceDocument } from '../types/bio';
import { REBASE_ENZYMES } from '../data/rebaseEnzymes';
import { MolBioMenuGlyph, resolveMenuItemIcon } from './MolBioIcons';
import { ScrollableMenuStrip } from './ScrollableMenuStrip';
import { FigureExportButton } from './FigureExportButton';
import { setFigureFileDrawing } from '../core/figureCapture';
import { WorkbenchSmartTable } from './WorkbenchSmartTable';
import { ResultWarnings } from './ResultWarnings';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import {
  analyzeSilentMutationsInCds,
  annealComplementaryOligos,
  CloningOutcome,
  complement,
  computeDnaAndLigationCalculations,
  findNonCuttingEnzymes,
  simulateMolecularCloning,
  simulateRestrictionDigest,
  simulateSiteDirectedMutagenesis,
} from '../core/bioEngine';
import {
  analyzeGibsonOverlapJunctionRust,
  computeAgaroseGelPhysicsRust,
  evaluateGoldenGateFidelityRust,
  evaluateMultiDigestBufferPlanRust,
} from '../lib/rustBioEngine';

export type CloningSubToolType =
  | 'gel'
  | 'mutagenesis'
  | 'anneal-oligos'
  | 'non-cutters'
  | 'silent-mutations'
  | 'dna-calculations';

interface CloningAndGelStudioProps {
  documents: SequenceDocument[];
  activeDoc: SequenceDocument;
  onAddConstruct: (newDoc: SequenceDocument) => void;
  initialMethod?: CloningMethodType;
  initialSubTool?: CloningSubToolType;
  /** Incremented on every menu request so re-requesting the same method / sub-tool re-applies it. */
  commandNonce?: number;
  onJumpToCoordinate?: (start: number, end: number, label?: string) => void;
  onStatusNotice?: (message: string) => void;
}

const LADDERS: Record<string, number[]> = {
  '1 kb Plus DNA Ladder': [
    10000, 8000, 6000, 5000, 4000, 3000, 2000, 1500, 1000, 850, 650, 500, 400, 300, 200, 100,
  ],
  '1 kb DNA Ladder': [10000, 8000, 6000, 5000, 4000, 3500, 3000, 2500, 2000, 1500, 1000, 750, 500, 250],
  '100 bp DNA Ladder': [1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
};

/**
 * How many silent-mutation candidates the list shows. The engine scans every annotated CDS whole
 * and reports how many candidates there are, so the list names the share it shows rather than
 * offering its own length as the total (BG-01M6S1Q9).
 */
export const SILENT_MUTATION_LIST_LIMIT = 24;

/** The gel's drawing in its own units: the SVG's 430x350 view. */
const GEL_VIEW_WIDTH = 430;
const GEL_VIEW_HEIGHT = 350;
/** The size, in gel units, of the gel's lane, ladder and band labels on a gel drawn at full size. */
const GEL_LABEL_UNITS = 10.5;
/** The smallest size, in screen pixels, at which the gel draws a label: the 11px text floor. */
const GEL_LABEL_FLOOR_PX = 11;
/** A size in gel units, written to two decimals and rounded up, so rounding never takes it below the floor. */
const gelUnits = (n: number) => Math.ceil(n * 100 - 1e-9) / 100;

function calcMigrationY(
  bp: number,
  gelPercent: number,
  buffer: GelBufferType = 'TBE',
  isSupercoiled = false
): number {
  const bufferFactor = buffer === 'TBE' ? 0.72 : buffer === 'TAE' ? 0.78 : 0.68;
  const effectiveBp = Math.max(50, Math.round(isSupercoiled ? bp * bufferFactor : bp));
  const [band] = computeAgaroseGelPhysicsRust([effectiveBp], gelPercent, buffer, 270);
  if (band && Number.isFinite(band.migrationMm)) {
    return 48 + Math.max(6, Math.min(266, band.migrationMm));
  }
  return 160;
}

export const CloningAndGelStudio: React.FC<CloningAndGelStudioProps> = ({
  documents,
  activeDoc,
  onAddConstruct,
  initialMethod,
  initialSubTool,
  commandNonce,
  onJumpToCoordinate,
  onStatusNotice,
}) => {
  // In the workbench the reaction's enzymes and the gel's conditions and digest enzymes sit in
  // App's shared inspector; drawn on its own the studio keeps every setting where it sits, and
  // the method strip, the vector, the insert and Simulate stay in the controls column either way
  // (US-01M6TAAR).
  const inWorkbench = useInWorkbench();

  // Restriction Digest & Agarose Gel state
  const [selectedDigestEnzymes, setSelectedDigestEnzymes] = useState<string[]>([
    'BamHI',
    'XhoI',
  ]);
  const [agarosePercent, setAgarosePercent] = useState<number>(1.0);
  const [stainMode, setStainMode] = useState<'ethidium' | 'sybr'>('sybr');
  const [gelBuffer, setGelBuffer] = useState<GelBufferType>('TBE');
  const [selectedLadder, setSelectedLadder] = useState<string>('1 kb Plus DNA Ladder');

  const [rightToolTab, setRightToolTab] = useState<CloningSubToolType>(
    initialSubTool ?? 'gel'
  );

  // Screen pixels per gel unit as the gel is drawn (its 430x350 view fitted into the SVG's box).
  // Beside the controls the gel is drawn smaller than its view, so its labels are sized for the
  // scale it is drawn at and never fall below the 11px floor on screen. A render with no layout
  // (the server, a test) measures nothing and keeps 1.
  const [gelScale, setGelScale] = useState<number>(1);
  const gelObserverRef = useRef<ResizeObserver | null>(null);
  // The gel's drawing as of the last render, for an export to draw at full size (BG-01M6RJZB).
  const gelDrawingRef = useRef<((labelSize: number) => React.ReactElement) | null>(null);
  const gelSvgRef = useCallback((svg: SVGSVGElement | null) => {
    gelObserverRef.current?.disconnect();
    gelObserverRef.current = null;
    if (!svg) return;
    // An exported gel is drawn at full size, never at the scale of the window it was saved from.
    setFigureFileDrawing(svg, () => {
      const draw = gelDrawingRef.current;
      if (!draw) throw new Error('The gel has not been drawn yet');
      // Drawn inside an <svg>, as on screen, so its elements are read as SVG; the export keeps the inside.
      return renderToStaticMarkup(<svg>{draw(GEL_LABEL_UNITS)}</svg>).slice('<svg>'.length, -'</svg>'.length);
    });
    const measure = () => {
      const box = svg.getBoundingClientRect();
      // A hidden gel (zero box) keeps the scale it was last drawn at.
      if (!(box.width > 0 && box.height > 0)) return;
      setGelScale(Math.min(box.width / GEL_VIEW_WIDTH, box.height / GEL_VIEW_HEIGHT));
    };
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      gelObserverRef.current = new ResizeObserver(measure);
      gelObserverRef.current.observe(svg);
    }
  }, []);
  // The label size in gel units the screen draws the gel with (see drawGel).
  const gelLabelSize = gelUnits(Math.max(GEL_LABEL_UNITS, GEL_LABEL_FLOOR_PX / gelScale));

  // Site-Directed Mutagenesis (SDM) state
  const [sdmMode, setSdmMode] = useState<'Substitution' | 'Insertion' | 'Deletion'>('Substitution');
  // 5388 is inside the pET28-eGFP CDS; clamp so short documents get a usable default.
  const [sdmPositionBp, setSdmPositionBp] = useState<number>(() =>
    Math.min(5388, Math.max(1, Math.floor(activeDoc.sequence.length / 2)))
  );
  const [sdmReplacementBases, setSdmReplacementBases] = useState<string>('TAC');
  const [sdmDeletionLen, setSdmDeletionLen] = useState<number>(3);

  // Anneal Oligos state
  const [oligoName, setOligoName] = useState<string>('FlagTag_EcoRI_XhoI_Adapter');
  // FLAG (DYKDDDDK) coding adapter with EcoRI (AATT) / XhoI (TCGA) overhangs.
  // The previous default had the protein letters "DYKDDDDK" inside the DNA.
  const [topOligo, setTopOligo] = useState<string>('AATTCGACTACAAGGACGACGATGACAAGC');
  const [botOligo, setBotOligo] = useState<string>('TCGAGCTTGTCATCGTCGTCCTTGTAGTCG');
  const [oligoPhosphorylated, setOligoPhosphorylated] = useState<boolean>(true);

  // DNA & Ligation Calculations state
  const [calcConcNgUl, setCalcConcNgUl] = useState<number>(50);
  const [calcVolUl, setCalcVolUl] = useState<number>(20);
  const [calcVecMassNg, setCalcVecMassNg] = useState<number>(50);

  // Molecular Cloning state (10 Cloning Methods)
  const [cloningMethod, setCloningMethod] = useState<CloningMethodType>(
    initialMethod ?? 'Restriction Ligation'
  );

  useEffect(() => {
    if (initialMethod) setCloningMethod(initialMethod);
  }, [initialMethod, commandNonce]);

  useEffect(() => {
    if (initialSubTool) setRightToolTab(initialSubTool);
  }, [initialSubTool, commandNonce]);

  const nonCuttingEnzymes = useMemo(
    () => findNonCuttingEnzymes(activeDoc.sequence, activeDoc.topology),
    [activeDoc.sequence, activeDoc.topology]
  );

  // Codons are read inside annotated CDS features (frame and strand of each
  // gene). Reading the whole construct in frame 1 produced "synonymous"
  // changes in a meaningless translation. Each gene is read over its whole
  // length, and the scan says how many candidates there are in all, so the list
  // below can name the share of them it shows (BG-01M6S1Q9).
  const silentMutationScan = useMemo(
    () =>
      activeDoc.moleculeType === 'Protein'
        ? { candidates: [], totalCandidates: 0, warnings: [] }
        : analyzeSilentMutationsInCds(activeDoc, SILENT_MUTATION_LIST_LIMIT),
    [activeDoc]
  );
  const silentMutationCandidates = silentMutationScan.candidates;
  const hasCdsAnnotation = activeDoc.features.some((f) => f.type === 'CDS');

  const sdmPreview = useMemo(
    () =>
      simulateSiteDirectedMutagenesis(
        activeDoc,
        sdmMode,
        sdmPositionBp,
        sdmReplacementBases,
        sdmDeletionLen
      ),
    [activeDoc, sdmMode, sdmPositionBp, sdmReplacementBases, sdmDeletionLen]
  );

  // A mutation must change the sequence at a position inside it.
  const sdmCanCreate =
    sdmPositionBp >= 1 &&
    sdmPositionBp <= activeDoc.sequence.length &&
    (sdmMode === 'Deletion' ? sdmDeletionLen >= 1 : sdmReplacementBases.length > 0) &&
    sdmPreview.mutantDocument.sequence !== activeDoc.sequence;

  const annealedOligoPreview = useMemo(
    () => annealComplementaryOligos(oligoName, topOligo, botOligo, oligoPhosphorylated),
    [oligoName, topOligo, botOligo, oligoPhosphorylated]
  );


  const [vectorId, setVectorId] = useState<string>(activeDoc.id);
  // Loading a vector preset (or switching document) while the studio is open
  // left the previous recipient vector selected.
  useEffect(() => {
    if (activeDoc.id && activeDoc.moleculeType === 'DNA') setVectorId(activeDoc.id);
  }, [activeDoc.id, activeDoc.moleculeType]);
  const [insertId, setInsertId] = useState<string>(
    documents.find((d) => d.folder === 'Cloning Inserts & PCR')?.id ?? documents[0].id
  );
  const dnaCalcs = useMemo(
    () =>
      computeDnaAndLigationCalculations(
        activeDoc.sequence.length,
        calcConcNgUl,
        calcVolUl,
        calcVecMassNg,
        // Was a hard-coded 720 bp insert; use the selected insert document.
        Math.max(1, documents.find((d) => d.id === insertId)?.sequence.length ?? 720)
      ),
    [activeDoc.sequence.length, calcConcNgUl, calcVolUl, calcVecMassNg, documents, insertId]
  );

  const [enzyme5, setEnzyme5] = useState<string>('EcoRI');
  const [enzyme3, setEnzyme3] = useState<string>('XhoI');
  const [goldenGateEnz, setGoldenGateEnz] = useState<string>('BsaI-HFv2');
  const [lastCloningResult, setLastCloningResult] = useState<CloningOutcome | null>(null);

  const vectorDoc = useMemo(
    () => documents.find((d) => d.id === vectorId) ?? activeDoc,
    [documents, vectorId, activeDoc]
  );
  const insertDoc = useMemo(
    () => documents.find((d) => d.id === insertId) ?? documents[0],
    [documents, insertId]
  );

  // Compute restriction fragments for Lane 2 (Uncut), Lane 3 (Single Cutter), Lane 4 (Multi Digest)
  const uncutFragments = useMemo(
    () => simulateRestrictionDigest(activeDoc, []),
    [activeDoc]
  );
  const singleDigestFragments = useMemo(
    () => simulateRestrictionDigest(activeDoc, [selectedDigestEnzymes[0] || 'EcoRI']),
    [activeDoc, selectedDigestEnzymes]
  );
  const multiDigestFragments = useMemo(
    () => simulateRestrictionDigest(activeDoc, selectedDigestEnzymes),
    [activeDoc, selectedDigestEnzymes]
  );

  const digestBufferPlan = useMemo(
    () =>
      evaluateMultiDigestBufferPlanRust(
        selectedDigestEnzymes.length > 0 ? selectedDigestEnzymes : [enzyme5, enzyme3]
      ),
    [selectedDigestEnzymes, enzyme5, enzyme3]
  );

  // Enzymes in the digest that the buffer plan flags for star activity: the caution is shown
  // beside the gel and on the plan's summary line, never only inside the closed plan.
  const digestStarActivityEnzymes = digestBufferPlan.enzymes
    .filter((r) => r.starActivityRisk)
    .map((r) => r.enzymeName);

  const cloningBufferPlan = useMemo(
    () => evaluateMultiDigestBufferPlanRust([enzyme5, enzyme3]),
    [enzyme5, enzyme3]
  );

  const goldenGateFidelity = useMemo(
    () => evaluateGoldenGateFidelityRust(['GGAG', 'TACT', 'AATG', 'GCTT']),
    []
  );

  const gibsonOverlapReport = useMemo(
    () => analyzeGibsonOverlapJunctionRust(insertDoc.sequence.slice(0, 28)),
    [insertDoc.sequence]
  );

  const toggleDigestEnzyme = (name: string) => {
    setSelectedDigestEnzymes((prev) =>
      prev.includes(name) ? prev.filter((e) => e !== name) : [...prev, name]
    );
  };

  const handleRunCloning = () => {
    const res = simulateMolecularCloning(
      vectorDoc,
      insertDoc,
      cloningMethod,
      enzyme5,
      enzyme3,
      goldenGateEnz
    );
    setLastCloningResult(res);
    onStatusNotice?.(
      res.success
        ? `Simulated ${cloningMethod}: "${res.constructDocument.name}" (${res.constructDocument.sequence.length.toLocaleString()} bp)`
        : `${cloningMethod} not possible: ${res.summary}`
    );
  };

  /**
   * The gel inside its 430x350 view, its lane, ladder and band labels `labelSize` gel units tall:
   * the gaps that keep neighbouring ladder and band labels apart grow with them, so enlarged
   * labels never overlap. The screen draws it with labels sized for the scale it is shown at; an
   * exported figure draws it at full size, whatever window it was saved from.
   */
  const drawGel = (labelSize: number): React.ReactElement => {
    const labelGrowth = labelSize / GEL_LABEL_UNITS;
    return (
      <>
        <defs>
          <filter id="cloning-gel-glow" x="-30%" y="-100%" width="160%" height="300%">
            <feGaussianBlur stdDeviation="2.4" result="blur1" />
            <feGaussianBlur stdDeviation="0.9" result="blur2" />
            <feMerge>
              <feMergeNode in="blur1" />
              <feMergeNode in="blur2" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <radialGradient id="cloning-uv-glow" cx="50%" cy="45%" r="60%">
            <stop
              offset="0%"
              stopColor={
                stainMode === 'sybr'
                  ? 'rgba(34, 197, 94, 0.1)'
                  : 'rgba(249, 115, 22, 0.1)'
              }
            />
            <stop offset="100%" stopColor="transparent" />
          </radialGradient>
        </defs>
        <rect x="0" y="0" width="430" height="350" rx="8" fill="#090d16" stroke="#252d3d" strokeWidth="1.2" />
        <rect x="0" y="0" width="430" height="350" rx="8" fill="url(#cloning-uv-glow)" />
        {/* Loading Wells */}
        {[72, 160, 248, 332].map((wx, idx) => {
          const laneLabel =
            idx === 0
              ? selectedLadder.replace(' DNA Ladder', '')
              : idx === 1
              ? `Uncut (${gelBuffer})`
              : idx === 2
              ? selectedDigestEnzymes[0] || 'EcoRI'
              : selectedDigestEnzymes.length > 2
              ? `${selectedDigestEnzymes.slice(0, 2).join('+')}+${selectedDigestEnzymes.length - 2}`
              : selectedDigestEnzymes.join('+') || 'Digest';
          return (
            <g key={wx}>
              <rect
                x={wx - 22}
                y="20"
                width="44"
                height="10"
                rx="2"
                fill="#04060b"
                stroke={stainMode === 'sybr' ? 'rgba(34, 197, 94, 0.35)' : 'rgba(249, 115, 22, 0.35)'}
                strokeWidth="1"
              />
              <line
                x1={wx - 20}
                y1="21"
                x2={wx + 20}
                y2="21"
                stroke="#232d3d"
                strokeWidth="1"
              />
              <text
                x={wx}
                y="14"
                textAnchor="middle"
                fill="#d8dce0"
                fontSize={labelSize}
                fontWeight="600"
              >
                {laneLabel}
              </text>
            </g>
          );
        })}

        {/* Lane 1: Selected Molecular Weight DNA Ladder */}
        {(() => {
          let lastLadderLabelY = -999;
          return (LADDERS[selectedLadder] || LADDERS['1 kb Plus DNA Ladder']).map((bp) => {
            const y = calcMigrationY(bp, agarosePercent, gelBuffer, false) + 4;
            const isBright = bp === 3000 || bp === 1000 || bp === 500;
            const wantsLabel = [10000, 5000, 3000, 2000, 1000, 500, 200, 100].includes(bp);
            const showLabel = wantsLabel && Math.abs(y - lastLadderLabelY) >= 12 * labelGrowth;
            if (showLabel) lastLadderLabelY = y;
            return (
              <g key={bp}>
                <rect
                  x={52}
                  y={y}
                  width={40}
                  height={isBright ? 3.5 : 2}
                  rx={1}
                  fill={stainMode === 'sybr' ? '#4ade80' : '#ff8c38'}
                  filter="url(#cloning-gel-glow)"
                  opacity={isBright ? 0.98 : 0.72}
                />
                {showLabel && (
                  <text x={46} y={y + 4} textAnchor="end" fill="#bdc1c6" fontSize={labelSize}>
                    {bp >= 1000 ? `${bp / 1000}k` : bp}
                  </text>
                )}
              </g>
            );
          });
        })()}

        {/* Lane 2: Uncut Document (Supercoiled migration in TBE / TAE / SB) */}
        {uncutFragments.map((f) => {
          const y =
            calcMigrationY(
              f.lengthBp,
              agarosePercent,
              gelBuffer,
              activeDoc.topology === 'circular'
            ) + 4;
          return (
            <rect
              key={f.id}
              x={140}
              y={y}
              width={40}
              height={3}
              rx={1.5}
              fill={stainMode === 'sybr' ? '#4ade80' : '#ff8c38'}
              filter="url(#cloning-gel-glow)"
              opacity={0.92}
            />
          );
        })}

        {/* Lane 3: Single Enzyme Digest */}
        {singleDigestFragments.map((f) => {
          const y = calcMigrationY(f.lengthBp, agarosePercent, gelBuffer, false) + 4;
          return (
            <rect
              key={f.id}
              x={228}
              y={y}
              width={40}
              height={3}
              rx={1.5}
              fill={stainMode === 'sybr' ? '#4ade80' : '#ff8c38'}
              filter="url(#cloning-gel-glow)"
              opacity={0.94}
            />
          );
        })}

        {/* Lane 4: Multi-Enzyme Combined Digest with Y-decollided size callouts */}
        {(() => {
          const sorted = [...multiDigestFragments]
            .map((f) => ({
              ...f,
              bandY: calcMigrationY(f.lengthBp, agarosePercent, gelBuffer, false) + 4,
            }))
            .sort((a, b) => a.bandY - b.bandY);
          let prevLabelY = 26;
          const placed = sorted.map((item) => {
            const labelY = Math.min(340, Math.max(item.bandY, prevLabelY + 13 * labelGrowth));
            prevLabelY = labelY;
            return { ...item, labelY };
          });
          return placed.map((f) => (
            <g key={f.id}>
              <rect
                x={312}
                y={f.bandY}
                width={40}
                height={3.2}
                rx={1.5}
                fill={stainMode === 'sybr' ? '#4ade80' : '#ff8c38'}
                filter="url(#cloning-gel-glow)"
                opacity={0.98}
              />
              <line
                x1={354}
                y1={f.bandY + 1.5}
                x2={360}
                y2={f.labelY}
                stroke="#80868b"
                strokeWidth="0.9"
              />
              <text x={363} y={f.labelY + 3.5} fill="#e8eaed" fontSize={labelSize} fontWeight="600">
                {f.lengthBp} bp
              </text>
            </g>
          ));
        })()}
      </>
    );
  };
  gelDrawingRef.current = drawGel;

  /** The methods whose reaction the studio sets up with a 5' and a 3' restriction enzyme. */
  const usesRestrictionEnzymes =
    cloningMethod === 'Restriction Ligation' ||
    cloningMethod === 'Gibson Assembly' ||
    cloningMethod === 'In-Fusion Cloning' ||
    cloningMethod === 'NEBuilder HiFi Assembly';

  // Gibson / In-Fusion / HiFi open a circular vector with these enzymes too; the selects used to
  // be hidden for them, so the summary named enzymes the user could not see or change.
  const restrictionEnzymeSettings = (
    <>
      {cloningMethod !== 'Restriction Ligation' && (
        <div className="info-callout" style={{ marginBottom: 6 }}>
          The circular recipient vector is linearised with these two enzymes before assembly.
        </div>
      )}
      <div className="form-grid-2col">
        <label className="form-field">
          <span>5&apos; Restriction Enzyme:</span>
          <select value={enzyme5} onChange={(e) => setEnzyme5(e.target.value)}>
            {REBASE_ENZYMES.filter((e) => !e.isTypeIIS).map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.recognitionSeq}) — {e.bufferNEB}
              </option>
            ))}
          </select>
        </label>
        <label className="form-field">
          <span>3&apos; Restriction Enzyme:</span>
          <select value={enzyme3} onChange={(e) => setEnzyme3(e.target.value)}>
            {REBASE_ENZYMES.filter((e) => !e.isTypeIIS).map((e) => (
              <option key={e.name} value={e.name}>
                {e.name} ({e.recognitionSeq}) — {e.bufferNEB}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="info-callout" style={{ fontSize: 11.5 }}>
        <strong>Reaction Buffer Compatibility:</strong>{' '}
        {cloningBufferPlan.recommendedBuffer} at {cloningBufferPlan.incubationTempC}&deg;C (
        {cloningBufferPlan.minimumSharedActivityPct > 0
          ? `${cloningBufferPlan.minimumSharedActivityPct}% shared activity`
          : 'activity data not available for this pair'}
        {cloningBufferPlan.sequentialDigestRequired ? ' • Sequential digest advised' : ' • Single-tube co-digest'}
        )
      </div>
    </>
  );

  const goldenGateSettings = (
    <div className="form-grid-2col">
      <label className="form-field">
        <span>Type IIS Restriction Endonuclease:</span>
        <select
          value={goldenGateEnz}
          onChange={(e) => setGoldenGateEnz(e.target.value)}
        >
          {REBASE_ENZYMES.filter((e) => e.isTypeIIS).map((e) => (
            <option key={e.name} value={e.name}>
              {e.name} ({e.recognitionSeq}) — {e.tempC}°C
            </option>
          ))}
        </select>
      </label>
      <div className="info-callout">
        Outward Type IIS cleavage excises recognition sites and ligates 4-nt overhangs in a one-pot 37°C/16°C reaction •{' '}
        <strong>Overhang check: {goldenGateFidelity.verdict}</strong>
      </div>
    </div>
  );

  /**
   * The gel's conditions, each with the words that name it: inline in the gel's own header when the
   * studio is drawn on its own, one field per row in the inspector's section in the workbench.
   */
  const gelConditionFields: { name: string; control: React.ReactElement }[] = [
    {
      name: 'MW Ladder:',
      control: (
        <select value={selectedLadder} onChange={(e) => setSelectedLadder(e.target.value)}>
          {Object.keys(LADDERS).map((ldr) => (
            <option key={ldr} value={ldr}>
              {ldr}
            </option>
          ))}
        </select>
      ),
    },
    {
      name: 'Agarose:',
      control: (
        <select
          value={agarosePercent}
          onChange={(e) => setAgarosePercent(Number(e.target.value))}
        >
          <option value={0.7}>0.7% (High MW)</option>
          <option value={1.0}>1.0% (Standard)</option>
          <option value={1.5}>1.5% (Small PCR)</option>
          <option value={2.0}>2.0% (High Res)</option>
        </select>
      ),
    },
    {
      name: 'Buffer:',
      control: (
        <select
          value={gelBuffer}
          onChange={(e) => setGelBuffer(e.target.value as GelBufferType)}
          title="Supercoiled vs Linear migration buffer (Ishido et al., 2010)"
        >
          <option value="TBE">TBE Buffer</option>
          <option value="TAE">TAE Buffer</option>
          <option value="SB">SB Buffer</option>
        </select>
      ),
    },
    {
      name: 'Stain:',
      control: (
        <select
          value={stainMode}
          onChange={(e) => setStainMode(e.target.value as 'ethidium' | 'sybr')}
        >
          <option value="sybr">SYBR Safe (Green)</option>
          <option value="ethidium">Ethidium Bromide (Orange)</option>
        </select>
      ),
    },
  ];

  const digestEnzymeChips = (
    <div className="enzyme-picker-strip">
      {REBASE_ENZYMES.slice(0, 14).map((enz) => {
        const active = selectedDigestEnzymes.includes(enz.name);
        return (
          <button
            key={enz.name}
            className={`enz-chip ${active ? 'active' : ''}`}
            onClick={() => toggleDigestEnzyme(enz.name)}
          >
            {enz.name}
          </button>
        );
      })}
    </div>
  );

  return (
    // Figure first: the controls column (the cloning simulator, then the gel and enzyme tools)
    // sits beside the result column, whose gel stays in view while the controls scroll. Below
    // the canvas breakpoint the two columns stack, controls first.
    <div className="studio-split-grid is-figure-first">
      <div className="studio-controls-column">
      {/* Virtual Cloning Simulator (10 Cloning Methods) */}
      <div className="studio-card">
        <div className="studio-card-header">
          <h3>Molecular Cloning &amp; Construct Assembly Studio</h3>
        </div>

        <ScrollableMenuStrip
          className="mbc-scroll-strip--pills"
          trackClassName="cloning-method-tabs"
          role="tablist"
          ariaLabel="Cloning Methods"
          alwaysShowArrows
          activeKey={cloningMethod}
          enableSpatialArrowNav
          activateOnSpatialFocus
          prevAriaLabel="Slide cloning methods left"
          nextAriaLabel="Slide cloning methods right"
        >
          {(
            [
              'Restriction Ligation',
              'Gibson Assembly',
              'In-Fusion Cloning',
              'NEBuilder HiFi Assembly',
              'Parts Cloning',
              'Golden Gate (Type IIS)',
              'TA / GC Cloning',
              'TOPO Cloning',
              'Gateway BP/LR Recombination',
              'Overlap Extension PCR',
            ] as const
          ).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              tabIndex={cloningMethod === m ? 0 : -1}
              aria-selected={cloningMethod === m}
              className={`method-tab-btn ${cloningMethod === m ? 'active' : ''}`}
              onClick={() => setCloningMethod(m)}
            >
              <span className="mbc-tab-leading-icon" aria-hidden="true">
                {resolveMenuItemIcon('cloning-method', m, false, 13)}
              </span>
              <span>{m}</span>
            </button>
          ))}
        </ScrollableMenuStrip>

        <div className="form-grid-2col">
          <label className="form-field">
            <span>Recipient Vector Backbone:</span>
            <select value={vectorId} onChange={(e) => setVectorId(e.target.value)}>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.sequence.length} bp, {d.topology})
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            <span>Donor Insert Fragment:</span>
            <select value={insertId} onChange={(e) => setInsertId(e.target.value)}>
              {documents.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name} ({d.sequence.length} bp, {d.topology})
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* The reaction's enzymes: in the workbench they are App's inspector's first section, so
            the method strip, the vector, the insert and Simulate keep this column to themselves. */}
        {usesRestrictionEnzymes &&
          (inWorkbench ? (
            <InspectorSection title="Reaction Enzymes" order={1}>
              {restrictionEnzymeSettings}
            </InspectorSection>
          ) : (
            restrictionEnzymeSettings
          ))}

        {cloningMethod === 'Golden Gate (Type IIS)' &&
          (inWorkbench ? (
            <InspectorSection title="Reaction Enzymes" order={1}>
              {goldenGateSettings}
            </InspectorSection>
          ) : (
            goldenGateSettings
          ))}

        {cloningMethod === 'Gibson Assembly' && (
          <div className="info-callout">
            5&apos;→3&apos; T5 Exonuclease + Phusion Polymerase + Taq Ligase isothermal 50 °C assembly •{' '}
            {/* An arm holding N has no Tm: the engine's reason reads in its place (BG-01M6SHQ0). */}
            <strong>
              5&apos; Arm ({gibsonOverlapReport.lengthBp} bp):{' '}
              {gibsonOverlapReport.tmNoAnswerReason ?? `Tm ${gibsonOverlapReport.tmC.toFixed(1)}°C`}, ΔG{' '}
              {gibsonOverlapReport.hairpinDeltaG.toFixed(1)} kcal/mol
            </strong>
          </div>
        )}

        {cloningMethod === 'In-Fusion Cloning' && (
          <div className="info-callout">
            Vaccinia virus 3&apos;→5&apos; In-Fusion HD Exonuclease generates 15 bp single-stranded complementary ends between PCR insert and linearized vector (50 °C, 15 min) with no phosphatase or ligase treatment required.
          </div>
        )}

        {cloningMethod === 'Parts Cloning' && (
          <div className="info-callout">
            Standardized Modular Parts Cloning (MoClo / GoldenBraid Level-0 → Level-1 syntax) assembles Promoter (<code>GGAG</code>), RBS (<code>TACT</code>), CDS (<code>AATG</code>), and Terminator (<code>GCTT</code>) genetic parts in a single reaction.
          </div>
        )}

        {cloningMethod === 'TOPO Cloning' && (
          <div className="info-callout">
            Vaccinia virus Topoisomerase I covalently bound to 3&apos; phosphate at 5&apos;-CCCTT-3&apos; cleaves and ligates directional 5&apos;-CACC-3&apos; (D-TOPO) or 3&apos;-A overhang (TA TOPO) PCR amplicons in 5 minutes at room temperature.
          </div>
        )}

        {cloningMethod === 'Gateway BP/LR Recombination' && (
          <div className="info-callout">
            Bacteriophage λ Integrase (Int/IHF/Xis Clonase II) catalyzes directional site-specific recombination between 25 bp <code>attB1/attB2</code> and <code>attP1/attP2</code> / <code>attL1/attL2</code> sites while strictly preserving reading frame phase.
          </div>
        )}

        {cloningMethod === 'NEBuilder HiFi Assembly' && (
          <div className="info-callout">
            HiFi DNA Assembly Master Mix (50 °C, 15–60 min) combines a 5&apos;→3&apos; exonuclease, high-fidelity proofreading DNA polymerase, and thermostable ligase for seamless multi-fragment assembly (15–30 bp overlaps) and ssDNA oligo bridging.
          </div>
        )}

        {cloningMethod === 'TA / GC Cloning' && (
          <div className="info-callout">
            Non-templated 3&apos;-dA overhangs added by Taq polymerase (or 3&apos;-dG overhangs) base-pair directly with linearized 3&apos;-dT T-vectors (or 3&apos;-dC G-vectors) using T4 DNA Ligase.
          </div>
        )}

        {cloningMethod === 'Overlap Extension PCR' && (
          <div className="info-callout">
            Splicing by Overlap Extension PCR (SOE-PCR) fuses two PCR amplicons via 24 bp complementary chimeric internal primers without restriction enzymes or ligase.
          </div>
        )}

        <div className="cloning-action-row">
          <button className="btn-primary" onClick={handleRunCloning}>
            Simulate {cloningMethod} Reaction
          </button>
          {lastCloningResult?.success && (
            <button
              className="btn-success"
              onClick={() => onAddConstruct(lastCloningResult.constructDocument)}
            >
              + Save Construct ({lastCloningResult.constructDocument.name}) to Workspace
            </button>
          )}
        </div>

        {lastCloningResult && !lastCloningResult.success && (
          <div className="cloning-result-box is-blocked">
            <div className="result-headline" style={{ color: 'var(--mbc-red)' }}>
              <strong>{lastCloningResult.method} not possible with these sequences</strong>
            </div>
            <p className="result-summary-text">{lastCloningResult.summary}</p>
            <p className="result-summary-text">
              Nothing was assembled. Choose a vector and insert that carry the sites this method needs, or pick
              another method.
            </p>
          </div>
        )}

        {lastCloningResult?.success && (
          <div className="cloning-result-box">
            <div className="result-headline">
              <strong>Construct Preview:</strong> {lastCloningResult.constructDocument.name} (
              {lastCloningResult.constructDocument.sequence.length.toLocaleString()} bp,{' '}
              {lastCloningResult.constructDocument.topology})
            </div>
            <p className="result-summary-text">{lastCloningResult.summary}</p>
            <div className="junction-grid">
              <div className="junction-card">
                <span className="junction-title">5&apos; Left Junction / Overhang</span>
                <code>{lastCloningResult.overhangOrHomologyLeft}</code>
                <small>
                  5&apos;-...{lastCloningResult.leftJunctionSeq}...-3&apos;
                  <br />
                  3&apos;-...{complement(lastCloningResult.leftJunctionSeq)}...-5&apos;
                </small>
              </div>
              <div className="junction-card">
                <span className="junction-title">3&apos; Right Junction / Overhang</span>
                <code>{lastCloningResult.overhangOrHomologyRight}</code>
                <small>
                  5&apos;-...{lastCloningResult.rightJunctionSeq}...-3&apos;
                  <br />
                  3&apos;-...{complement(lastCloningResult.rightJunctionSeq)}...-5&apos;
                </small>
              </div>
            </div>
            {lastCloningResult.warnings.map((w, idx) => (
              <div key={idx} className="cloning-warning-note">
                ⚠ {w}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Gel controls and the enzyme tools: Mutagenesis, Annealed Oligos, 0-Cutters, Silent Mutations & DNA Calculations */}
      <div className="studio-card">
        <div className="studio-card-header" style={{ flexWrap: 'wrap' }}>
          <ScrollableMenuStrip
            className="mbc-scroll-strip--pills"
            trackClassName="cloning-method-tabs"
            style={{ marginBottom: 0 }}
            role="tablist"
            ariaLabel="Gel and Enzyme Utilities"
            alwaysShowArrows
            activeKey={rightToolTab}
            enableSpatialArrowNav
            activateOnSpatialFocus
            prevAriaLabel="Slide gel and enzyme tools left"
            nextAriaLabel="Slide gel and enzyme tools right"
          >
            <button
              type="button"
              role="tab"
              tabIndex={rightToolTab === 'gel' ? 0 : -1}
              aria-selected={rightToolTab === 'gel'}
              className={`method-tab-btn ${rightToolTab === 'gel' ? 'active' : ''}`}
              onClick={() => setRightToolTab('gel')}
            >
              <MolBioMenuGlyph glyph="agarose-gel" size={13} />
              <span>Virtual Gel &amp; Digest</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={rightToolTab === 'mutagenesis' ? 0 : -1}
              aria-selected={rightToolTab === 'mutagenesis'}
              className={`method-tab-btn ${rightToolTab === 'mutagenesis' ? 'active' : ''}`}
              onClick={() => setRightToolTab('mutagenesis')}
            >
              <MolBioMenuGlyph glyph="mutagenesis" size={13} />
              <span>Mutagenesis (⌘J)</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={rightToolTab === 'anneal-oligos' ? 0 : -1}
              aria-selected={rightToolTab === 'anneal-oligos'}
              className={`method-tab-btn ${rightToolTab === 'anneal-oligos' ? 'active' : ''}`}
              onClick={() => setRightToolTab('anneal-oligos')}
            >
              <MolBioMenuGlyph glyph="anneal-oligos" size={13} />
              <span>Anneal Oligos</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={rightToolTab === 'non-cutters' ? 0 : -1}
              aria-selected={rightToolTab === 'non-cutters'}
              className={`method-tab-btn ${rightToolTab === 'non-cutters' ? 'active' : ''}`}
              onClick={() => setRightToolTab('non-cutters')}
            >
              <MolBioMenuGlyph glyph="digest-scissors" size={13} />
              <span>Noncutters ({nonCuttingEnzymes.length})</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={rightToolTab === 'silent-mutations' ? 0 : -1}
              aria-selected={rightToolTab === 'silent-mutations'}
              className={`method-tab-btn ${rightToolTab === 'silent-mutations' ? 'active' : ''}`}
              onClick={() => setRightToolTab('silent-mutations')}
            >
              <MolBioMenuGlyph glyph="silent-mutation" size={13} />
              {/* Every candidate the engine found, not the number the list shows. */}
              <span>Silent Mutations ({silentMutationScan.totalCandidates.toLocaleString()})</span>
            </button>
            <button
              type="button"
              role="tab"
              tabIndex={rightToolTab === 'dna-calculations' ? 0 : -1}
              aria-selected={rightToolTab === 'dna-calculations'}
              className={`method-tab-btn ${rightToolTab === 'dna-calculations' ? 'active' : ''}`}
              onClick={() => setRightToolTab('dna-calculations')}
            >
              <MolBioMenuGlyph glyph="dna-calc" size={13} />
              <span>DNA Calculations (⇧⌘M)</span>
            </button>
          </ScrollableMenuStrip>
          {rightToolTab === 'gel' && !inWorkbench && (
            <div className="gel-controls-inline">
              {gelConditionFields.map((f) => (
                <label key={f.name}>
                  {f.name}
                  {f.control}
                </label>
              ))}
            </div>
          )}
        </div>

        {/* The gel's conditions and its digest enzymes: one section of App's inspector, where the
            digest the gel draws is set up (the chips choose the enzymes it is cut with). */}
        {rightToolTab === 'gel' && inWorkbench && (
          <InspectorSection title={'Gel & Digest'} order={2}>
            <div className="form-grid-2col">
              {gelConditionFields.map((f) => (
                <label className="form-field" key={f.name}>
                  <span>{f.name}</span>
                  {f.control}
                </label>
              ))}
            </div>
            {digestEnzymeChips}
          </InspectorSection>
        )}

        {/* 1. Site-Directed Mutagenesis (SDM) Tab */}
        {rightToolTab === 'mutagenesis' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="info-callout">
              <strong>Primer-Directed Site-Directed Mutagenesis (⌘J):</strong> Design overlapping mutagenic primer pairs to introduce point substitutions, codon replacements, insertions, or deletions into <strong>{activeDoc.name}</strong>.
            </div>
            <div className="form-grid-4col">
              <label className="form-field">
                <span>Mutagenesis Type:</span>
                <select
                  value={sdmMode}
                  onChange={(e) =>
                    setSdmMode(e.target.value as 'Substitution' | 'Insertion' | 'Deletion')
                  }
                >
                  <option value="Substitution">Point / Codon Substitution</option>
                  <option value="Insertion">Sequence Insertion</option>
                  <option value="Deletion">Sequence Deletion</option>
                </select>
              </label>
              <label className="form-field">
                <span>Target Coordinate (bp):</span>
                <input
                  type="number"
                  min={20}
                  max={activeDoc.sequence.length - 20}
                  value={sdmPositionBp}
                  onChange={(e) => setSdmPositionBp(Number(e.target.value))}
                />
              </label>
              {sdmMode !== 'Deletion' ? (
                <label className="form-field">
                  <span>{sdmMode === 'Substitution' ? 'Replacement Bases:' : 'Inserted Bases:'}</span>
                  <input
                    type="text"
                    value={sdmReplacementBases}
                    onChange={(e) => setSdmReplacementBases(toIupacDna(e.target.value))}
                  />
                </label>
              ) : (
                <label className="form-field">
                  <span>Deletion Length (bp):</span>
                  <input
                    type="number"
                    min={1}
                    max={30}
                    value={sdmDeletionLen}
                    onChange={(e) => setSdmDeletionLen(Number(e.target.value))}
                  />
                </label>
              )}
              <div className="form-field" style={{ justifyContent: 'flex-end' }}>
                <button
                  className="btn-success"
                  disabled={!sdmCanCreate}
                  title={sdmCanCreate ? undefined : 'Choose a position inside the sequence and valid replacement bases'}
                  onClick={() => onAddConstruct(sdmPreview.mutantDocument)}
                >
                  + Create Mutated Construct
                </button>
              </div>
            </div>

            <div className="cloning-result-box">
              <div>
                <strong>Mutation Summary:</strong> <code>{sdmPreview.codonChangeLabel}</code> at position{' '}
                {onJumpToCoordinate ? (
                  <button
                    type="button"
                    className="mbc-coord-jump-btn"
                    onClick={() =>
                      onJumpToCoordinate(
                        Math.max(1, sdmPreview.positionBp - 12),
                        Math.min(activeDoc.sequence.length, sdmPreview.positionBp + 12),
                        `SDM ${sdmPreview.codonChangeLabel} @ ${sdmPreview.positionBp} bp`
                      )
                    }
                    title="Jump to mutagenesis site in Sequence view"
                  >
                    {sdmPreview.positionBp.toLocaleString()} bp
                  </button>
                ) : (
                  <>{sdmPreview.positionBp} bp</>
                )}{' '}
                (Primer Tm = <strong>{sdmPreview.primerTmC} °C</strong>, Recommended Annealing ={' '}
                <strong>{sdmPreview.annealingTempC} °C</strong>)
              </div>
              <div className="primer-detail-card">
                <div>
                  <strong>Forward Mutagenic Primer (5&apos;→3&apos;):</strong>
                </div>
                <code className="primer-seq-display">{sdmPreview.forwardMutagenicPrimer}</code>
                <div>
                  <strong>Reverse Mutagenic Primer (5&apos;→3&apos;):</strong>
                </div>
                <code className="primer-seq-display">{sdmPreview.reverseMutagenicPrimer}</code>
              </div>
            </div>
          </div>
        )}

        {/* 2. Anneal Complementary Oligos Tab */}
        {rightToolTab === 'anneal-oligos' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="info-callout">
              <strong>Anneal Complementary Oligonucleotides:</strong> Anneal synthetic top and bottom single-stranded oligos into a double-stranded adapter with custom 5&apos; / 3&apos; sticky overhangs ready for direct ligation.
            </div>
            <div className="form-grid-2col">
              <label className="form-field">
                <span>Annealed Duplex Name:</span>
                <input
                  type="text"
                  value={oligoName}
                  onChange={(e) => setOligoName(e.target.value)}
                />
              </label>
              <label className="form-field">
                <span>5&apos; End Phosphorylation State:</span>
                <select
                  value={oligoPhosphorylated ? 'yes' : 'no'}
                  onChange={(e) => setOligoPhosphorylated(e.target.value === 'yes')}
                >
                  <option value="yes">5&apos;-Phosphorylated (T4 Polynucleotide Kinase / Synthesized 5&apos;-Phos)</option>
                  <option value="no">Unphosphorylated (5&apos;-OH)</option>
                </select>
              </label>
            </div>
            <label className="form-field">
              <span>Top Strand Oligo (5&apos; → 3&apos;):</span>
              <input
                type="text"
                value={topOligo}
                onChange={(e) => setTopOligo(toIupacDna(e.target.value))}
              />
            </label>
            <label className="form-field">
              <span>Bottom Strand Oligo (5&apos; → 3&apos;):</span>
              <input
                type="text"
                value={botOligo}
                onChange={(e) => setBotOligo(toIupacDna(e.target.value))}
              />
            </label>
            <div className="cloning-result-box">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  <strong>Duplex Length:</strong> {annealedOligoPreview.duplexLengthBp} bp •{' '}
                  <strong>Duplex Tm:</strong> {annealedOligoPreview.tmDuplexC} °C •{' '}
                  <strong>5&apos; Overhangs:</strong>{' '}
                  <code>5&apos;-{annealedOligoPreview.leftOverhang5Prime}</code> /{' '}
                  <code>5&apos;-{annealedOligoPreview.rightOverhang5Prime}</code>
                </span>
                <button
                  className="btn-success"
                  disabled={annealedOligoPreview.pairedLengthBp < 4}
                  title={annealedOligoPreview.pairedLengthBp < 4 ? 'The two oligos do not anneal (fewer than 4 paired bases)' : undefined}
                  onClick={() => onAddConstruct(annealedOligoPreview.annealedDocument)}
                >
                  + Save Annealed Oligo Duplex
                </button>
              </div>
            </div>
          </div>
        )}

        {/* 3. DNA & Ligation Calculations Tab */}
        {rightToolTab === 'dna-calculations' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div className="form-grid-3col">
              <label className="form-field">
                <span>Sample Concentration (ng/µL):</span>
                <input
                  type="number"
                  min={1}
                  max={2000}
                  value={calcConcNgUl}
                  onChange={(e) => setCalcConcNgUl(Number(e.target.value))}
                />
              </label>
              <label className="form-field">
                <span>Sample Volume (µL):</span>
                <input
                  type="number"
                  min={1}
                  max={1000}
                  value={calcVolUl}
                  onChange={(e) => setCalcVolUl(Number(e.target.value))}
                />
              </label>
              <label className="form-field">
                <span>Ligation Vector Mass (ng):</span>
                <input
                  type="number"
                  min={5}
                  max={500}
                  value={calcVecMassNg}
                  onChange={(e) => setCalcVecMassNg(Number(e.target.value))}
                />
              </label>
            </div>

            <div className="thermo-kpi-grid">
              <div className="kpi-box">
                <span className="kpi-label">dsDNA Molecular Weight</span>
                <strong className="kpi-val">{(dnaCalcs.mwDsDnaDa / 1000).toFixed(2)} kDa</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Molarity / pmol</span>
                <strong className="kpi-val">
                  {dnaCalcs.molarityNanomolar} nM ({dnaCalcs.pmolDsDna} pmol)
                </strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Linear 5&apos;/3&apos; Ends</span>
                <strong className="kpi-val">{dnaCalcs.pmolEndsLinear} pmol ends</strong>
              </div>
              <div className="kpi-box">
                <span className="kpi-label">Copy Number / OD260</span>
                <strong className="kpi-val">
                  {dnaCalcs.copyNumberPerUl}/µL ({dnaCalcs.od260Units} A260)
                </strong>
              </div>
            </div>

            <WorkbenchSmartTable
              tableId="cloning-ligation-molar-ratios"
              tableLabel="Vector Insert Molar Ligation Ratios"
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Vector : Insert Molar Ratio</th>
                  <th>Vector Mass (ng)</th>
                  <th>Insert Length (bp)</th>
                  <th>Required Insert Mass (ng)</th>
                  <th>Required Insert (pmol)</th>
                </tr>
              </thead>
              <tbody>
                {dnaCalcs.ligationRatios.map((r) => (
                  <tr key={r.ratioLabel}>
                    <td>
                      <strong>{r.ratioLabel}</strong>
                    </td>
                    <td>{r.vectorMassNg} ng</td>
                    <td>{r.insertLengthBp} bp</td>
                    <td>
                      <strong>{r.requiredInsertMassNg} ng</strong>
                    </td>
                    <td>{r.requiredInsertPmol} pmol</td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        )}

        {rightToolTab === 'non-cutters' && (
          <div>
            <div className="info-callout" style={{ marginBottom: 8 }}>
              Restriction enzymes with <strong>0 recognition sites</strong> in{' '}
              <strong>{activeDoc.name}</strong> ({activeDoc.sequence.length.toLocaleString()} bp) — safe for flanking MCS primer extensions without internal cleavage:
            </div>
            <WorkbenchSmartTable
              tableId="cloning-non-cutting-enzymes"
              tableLabel="Non-Cutting Restriction Enzymes"
              regionMaxHeight={350}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Enzyme</th>
                  <th>Recognition Site</th>
                  <th>Overhang Type</th>
                  <th>Optimal Buffer &amp; Temp</th>
                </tr>
              </thead>
              <tbody>
                {nonCuttingEnzymes.map((enz) => (
                  <tr key={enz.name}>
                    <td>
                      <strong>{enz.name}</strong>
                    </td>
                    <td>
                      <code>5&apos;-{enz.recognitionSeq}-3&apos;</code>
                    </td>
                    <td>{enz.isTypeIIS ? 'Type IIS (4-nt)' : 'Palindromic Type II'}</td>
                    <td>
                      {enz.bufferNEB} ({enz.tempC} °C)
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        )}

        {rightToolTab === 'silent-mutations' && (
          <div>
            <div className="info-callout" style={{ marginBottom: 8 }}>
              Synonymous single-nucleotide substitutions in the annotated CDS of <strong>{activeDoc.name}</strong> that engineer diagnostic restriction enzyme sites without altering the translated polypeptide sequence:
            </div>
            {!hasCdsAnnotation && (
              <div className="info-callout" role="status" style={{ marginBottom: 8 }}>
                No CDS is annotated on this document. Annotate the coding sequence (Features › Add Feature or Detect Common Features) to find silent mutation sites in its reading frame.
              </div>
            )}
            {/* What the table shows of what the engine found: the first N of M, or all M. */}
            <div className="mbc-opdlg-muted" data-mbc-silent-mutation-caption style={{ marginBottom: 6 }}>
              {silentMutationScan.totalCandidates > silentMutationCandidates.length
                ? `Showing the first ${silentMutationCandidates.length.toLocaleString()} of ${silentMutationScan.totalCandidates.toLocaleString()} candidates, in codon order, first CDS first.`
                : `Showing all ${silentMutationCandidates.length.toLocaleString()} candidate${silentMutationCandidates.length === 1 ? '' : 's'}, in codon order, first CDS first.`}
            </div>
            <ResultWarnings warnings={silentMutationScan.warnings} label="Silent mutation warnings" />
            <WorkbenchSmartTable
              tableId="cloning-silent-mutation-sites"
              tableLabel="Synonymous Silent Mutation Restriction Sites"
              regionMaxHeight={350}
              className="bio-table"
            >
              <thead>
                <tr>
                  <th>Enzyme Created</th>
                  <th>Recognition Site</th>
                  <th>Position (bp)</th>
                  <th>Codon / AA</th>
                  <th>Synonymous Substitution</th>
                </tr>
              </thead>
              <tbody>
                {silentMutationCandidates.map((cand, idx) => (
                  <tr key={`${cand.enzymeName}-${cand.positionBp}-${idx}`}>
                    <td>
                      <strong>{cand.enzymeName}</strong>
                    </td>
                    <td>
                      <code>{cand.recognitionSeq}</code>
                    </td>
                    <td>
                      {onJumpToCoordinate ? (
                        <button
                          type="button"
                          className="mbc-coord-jump-btn"
                          onClick={() =>
                            onJumpToCoordinate(
                              cand.positionBp,
                              Math.min(
                                activeDoc.sequence.length,
                                cand.positionBp + cand.recognitionSeq.length - 1
                              ),
                              `Silent ${cand.enzymeName} (${cand.mutationLabel})`
                            )
                          }
                          title={`Jump to ${cand.enzymeName} silent site (${cand.positionBp} bp) in Sequence view`}
                        >
                          {cand.positionBp.toLocaleString()} bp
                        </button>
                      ) : (
                        <>{cand.positionBp.toLocaleString()} bp</>
                      )}
                    </td>
                    <td>
                      Codon #{cand.codonNumber} (<strong>{cand.aminoAcid}</strong>)
                    </td>
                    <td>
                      <code>{cand.mutationLabel}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </WorkbenchSmartTable>
          </div>
        )}

        {rightToolTab === 'gel' && !inWorkbench && digestEnzymeChips}
      </div>
      </div>

      {/* Result column: the gel first (it stays in view beside the controls), then the digest
          fragments, then the co-digest buffer plan behind a disclosure. The gel shows whichever
          tool tab is open. A caution the plan raises (star activity) is shown in the gel's header
          and on the plan's summary line, so it stays in view with the disclosure closed. */}
      <div className="studio-result-column">
          {/* SVG Virtual Gel Canvas (UV Darkroom) */}
          <div data-mbc-figure className="studio-gel-figure">
          <div className="studio-card-header" style={{ paddingTop: 0 }}>
            <h4>Virtual Agarose Gel</h4>
            {digestStarActivityEnzymes.length > 0 && (
              <span className="cloning-warning-note studio-caution-flag" role="status">
                <TriangleAlert size={12} aria-hidden="true" />
                <span>Watch star activity ({digestStarActivityEnzymes.join(', ')})</span>
              </span>
            )}
            <FigureExportButton
              compact
              baseName={`${activeDoc.name} — Virtual Gel`}
              title={`${activeDoc.name} — virtual agarose gel`}
              table={{
                headers: ['Fragment #', 'Size (bp)', 'Start', 'End', "5' enzyme", "3' enzyme"],
                rows: multiDigestFragments.map((frag) => [
                  String(frag.index),
                  String(frag.lengthBp),
                  String(frag.start),
                  String(frag.end),
                  frag.leftEnzyme,
                  frag.rightEnzyme,
                ]),
                caption: `${activeDoc.name} — restriction digest fragments`,
              }}
            />
          </div>
          <svg viewBox="0 0 430 350" className="virtual-gel-svg" ref={gelSvgRef}>
            {drawGel(gelLabelSize)}
          </svg>
          </div>

          {/* Digest Fragments Table */}
          <WorkbenchSmartTable
            tableId="cloning-digest-fragments"
            tableLabel="Restriction Digest Fragments"
            regionMaxHeight={315}
            className="bio-table"
          >
            <thead>
              <tr>
                <th>#</th>
                <th>Size (bp)</th>
                <th>5&apos; End (Overhang)</th>
                <th>3&apos; End (Overhang)</th>
              </tr>
            </thead>
            <tbody>
              {multiDigestFragments.map((frag) => (
                <tr key={frag.id}>
                  <td>{frag.index}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                      <strong>{frag.lengthBp.toLocaleString()} bp</strong>
                      {onJumpToCoordinate && (
                        <button
                          type="button"
                          className="mbc-coord-jump-btn"
                          onClick={() =>
                            onJumpToCoordinate(
                              frag.start,
                              frag.end,
                              `Digest Fragment #${frag.index} (${frag.leftEnzyme}–${frag.rightEnzyme})`
                            )
                          }
                          title={`Jump to Fragment #${frag.index} (${frag.start}..${frag.end} bp) in Sequence view`}
                        >
                          {frag.start}..{frag.end}
                        </button>
                      )}
                    </div>
                  </td>
                  <td>
                    {frag.leftEnzyme}{' '}
                    <span className="overhang-tag">
                      {frag.leftOverhang || frag.leftOverhangType}
                    </span>
                  </td>
                  <td>
                    {frag.rightEnzyme}{' '}
                    <span className="overhang-tag">
                      {frag.rightOverhang || frag.rightOverhangType}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </WorkbenchSmartTable>

          <details className="mbc-progressive-details">
            <summary className="mbc-progressive-summary">
              <span>
                Co-digest buffer plan
                {digestStarActivityEnzymes.length > 0 && (
                  <>
                    {': '}
                    <span className="cloning-warning-note studio-caution-flag">
                      <TriangleAlert size={12} aria-hidden="true" />
                      watch star activity
                    </span>
                  </>
                )}
              </span>
            </summary>
            <div
              className="info-callout"
              style={{ fontSize: 11.5, padding: '6px 10px', marginTop: 6 }}
            >
              <strong>Co-Digest Buffer Plan:</strong> {digestBufferPlan.recommendedBuffer} (
              {digestBufferPlan.incubationTempC}&deg;C • {digestBufferPlan.minimumSharedActivityPct}% min activity
              {digestBufferPlan.enzymes.some((r) => r.starActivityRisk) ? ' • Watch star activity' : ''})
            </div>
          </details>
      </div>
    </div>
  );
};

/** Keep only IUPAC nucleotide letters (upper-case). */
function toIupacDna(raw: string): string {
  return raw.toUpperCase().replace(/[^ACGTURYSWKMBDHVN]/g, '');
}
