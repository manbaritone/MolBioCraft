// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hexagon, Highlighter } from 'lucide-react';
import { dataUrlToBytes, saveWorkbenchFile } from '../platform/macosMenuBridge';
import type { PdbCaAtom } from '../core/genomicsAndStructureSuite';
import { resolveContactAtomIndices, type StructureContactLike } from '../core/structureContacts';
import { ResultWarnings } from './ResultWarnings';
import {
  caAtomIndicesOf, chainOf, featureResidues, ligandsOfChains, residueNumberLabel, withFileSecondaryStructure,
  type MappedResidue, type Structure, type StructureLigand,
} from '../core/structureView';
import 'molstar/build/viewer/molstar.css';

export type Protein3DStyle = 'cartoon' | 'backbone' | 'ball-stick' | 'spacefill';
export type Protein3DColorScheme = 'secondary' | 'plddt' | 'hydropathy' | 'chain' | 'rainbow';
export type Protein3DPreset =
  | 'auto'
  | 'polymer-and-hetero'
  | 'polymer-and-ligand'
  | 'polymer-cartoon'
  | 'protein-and-nucleic'
  | 'atomic-detail'
  | 'molecular-surface'
  | 'coarse-surface'
  | 'auto-lod'
  | 'illustrative'
  | 'empty';

export interface ProteinStructure3DViewerProps {
  primaryAtoms: PdbCaAtom[];
  overlayAtoms?: PdbCaAtom[];
  /** Engine contacts (`{ resI, resJ }`, 0-based into primaryAtoms) or explicit atom indices. */
  contacts?: StructureContactLike[];
  title?: string;
  rmsdAngstrom?: number;
  tmScore?: number;
  /** Residue pairs the superposition used (engine `alignedResiduePairs`). */
  alignedResiduePairs?: number;
  /** How those residues were paired (engine `pairingMethod`), shown on the pair-count badge. */
  pairingMethod?: string;
  /**
   * The full-atom model of the file `primaryAtoms` were read from (`parseStructure`): the viewer
   * then draws the ligands bound to the chains it shows and colours by the file's own secondary
   * structure when the file declares one.
   */
  structure?: Structure;
  /**
   * Optional raw structure file text (`.pdb` or `.cif` / mmCIF). When provided, Mol* parses the
   * full-atom coordinate file directly; otherwise a standard PDB coordinate block is synthesized
   * from `structure` or `primaryAtoms`.
   */
  structureText?: string;
  /** Explicit format hint for `structureText` (`'mmcif'` or `'pdb'`). Auto-detected if omitted. */
  structureFormat?: 'mmcif' | 'pdb';
  /**
   * When `structureText` holds a multi-chain entry and the document represents a single chain,
   * restrict the Mol* view to this chain id (`label_asym_id` for mmCIF, `auth_asym_id` for PDB).
   */
  activeChainId?: string;
  /**
   * A sequence feature to highlight (needs `structure`): the chain it is on (label id, which is an
   * mmCIF structure document's `Chain`), the protein sequence its 1-based positions are on, its range.
   */
  selectedFeature?: { chainId: string; sequence: string; start: number; end: number; name?: string };
  heightPx?: number;
  offscreenDeferred?: boolean;
}

/** What the `tmScore` badge is: the engine scores the sequence-paired superposition, not a TM-align search. */
const TM_APPROXIMATE_NOTE =
  'Approximate TM-score, scored on the sequence-paired superposition; not TM-align, which searches for the superposition that maximises it';

const AA1_TO_AA3: Record<string, string> = {
  A: 'ALA', R: 'ARG', N: 'ASN', D: 'ASP', C: 'CYS',
  Q: 'GLN', E: 'GLU', G: 'GLY', H: 'HIS', I: 'ILE',
  L: 'LEU', K: 'LYS', M: 'MET', F: 'PHE', P: 'PRO',
  S: 'SER', T: 'THR', W: 'TRP', Y: 'TYR', V: 'VAL',
};

const KD_BY_RES3: Record<string, number> = {
  ILE: 4.5, VAL: 4.2, LEU: 3.8, PHE: 2.8, CYS: 2.5,
  MET: 1.9, ALA: 1.8, GLY: -0.4, THR: -0.7, SER: -0.8,
  TRP: -0.9, TYR: -1.3, PRO: -1.6, HIS: -3.2, GLU: -3.5,
  GLN: -3.5, ASP: -3.5, ASN: -3.5, LYS: -3.9, ARG: -4.5,
};

const CHAIN_PALETTE = ['#2563eb', '#db2777', '#059669', '#d97706', '#7c3aed', '#0891b2'];

const LIGAND_ELEMENT_COLORS: Record<string, string> = {
  C: '#a3e635', N: '#60a5fa', O: '#f87171', S: '#facc15', P: '#fb923c', FE: '#f97316',
};

interface ContentVisibilityEvent extends Event {
  readonly skipped?: boolean;
}

/**
 * The most contact lines the overlay draws in a frame, so the view still turns smoothly: drawn as
 * one path, 50,000 dashed lines took about 9 ms a frame in headless WebKit (BG-01M6S13D). All 7,790
 * contacts of the spike trimer 6VXX (2,916 Cα) are well under it.
 */
export const CONTACT_DRAW_LIMIT = 50_000;

/**
 * The contacts the overlay draws: every one, up to {@link CONTACT_DRAW_LIMIT}; past it, every k-th
 * of the list (the engine lists them in residue order), with the sentence that says so.
 */
export function contactOverlay(contacts: readonly StructureContactLike[] | undefined): {
  drawn: readonly StructureContactLike[];
  warning: string | null;
} {
  const all = contacts ?? [];
  if (all.length <= CONTACT_DRAW_LIMIT) return { drawn: all, warning: null };
  const step = Math.ceil(all.length / CONTACT_DRAW_LIMIT);
  const drawn = all.filter((_, i) => i % step === 0);
  const n = (v: number) => v.toLocaleString('en-US');
  const suffix = step % 100 >= 11 && step % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][step % 10] ?? 'th');
  return {
    drawn,
    warning: `The contact overlay draws ${n(drawn.length)} of the ${n(all.length)} Cα contacts within 8 Å: every ${n(step)}${suffix} in residue order, so the view stays responsive.`,
  };
}

/**
 * Synthesizes 3D C-alpha backbone coordinates (3.8 A virtual bond geometry) from an amino-acid
 * sequence and GOR secondary-structure state profile for instant interactive 3D fold inspection.
 */
export function synthesizeFoldedCaAtomsFromStates(
  proteinSeq: string,
  states: ('H' | 'E' | 'C')[],
  maxResidues = 480
): PdbCaAtom[] {
  const clean = proteinSeq.replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, maxResidues);
  const atoms: PdbCaAtom[] = [];
  let x = 0;
  let y = 0;
  let z = 0;
  let dirTheta = 0.35;
  let dirPhi = 0.2;
  let helixPhase = 0;

  for (let i = 0; i < clean.length; i++) {
    const aa = clean[i];
    const ss = states[i] ?? 'C';
    if (i > 0) {
      if (ss === 'H') {
        helixPhase += (100 * Math.PI) / 180;
        x += 1.5 * Math.cos(dirTheta) + 1.9 * Math.cos(helixPhase) * Math.sin(dirTheta);
        y += 1.5 * Math.sin(dirTheta) - 1.9 * Math.cos(helixPhase) * Math.cos(dirTheta);
        z += 1.9 * Math.sin(helixPhase) + 0.45 * Math.sin(dirPhi);
      } else if (ss === 'E') {
        const pleat = i % 2 === 0 ? 0.85 : -0.85;
        x += 3.3 * Math.cos(dirTheta) * Math.cos(dirPhi);
        y += 3.3 * Math.sin(dirTheta) * Math.cos(dirPhi) + pleat * 0.55;
        z += 3.3 * Math.sin(dirPhi) + pleat;
      } else {
        dirTheta += 0.62 * Math.sin(i * 0.73 + 0.4);
        dirPhi = Math.max(-1.1, Math.min(1.1, dirPhi + 0.44 * Math.cos(i * 0.51)));
        x += 3.65 * Math.cos(dirTheta) * Math.cos(dirPhi);
        y += 3.65 * Math.sin(dirTheta) * Math.cos(dirPhi);
        z += 3.65 * Math.sin(dirPhi);
      }
    }
    atoms.push({
      resSeq: i + 1,
      resName: AA1_TO_AA3[aa] ?? 'UNK',
      chainId: 'A',
      bFactor: ss === 'H' ? 91.5 : ss === 'E' ? 87.0 : 72.5,
      secondaryStructure: ss,
      x: Number(x.toFixed(3)),
      y: Number(y.toFixed(3)),
      z: Number(z.toFixed(3)),
    });
  }
  return atoms;
}

function colorForAtom(
  atom: PdbCaAtom,
  idx: number,
  total: number,
  scheme: Protein3DColorScheme
): string {
  if (scheme === 'secondary') {
    const ss = atom.secondaryStructure ?? 'C';
    if (ss === 'H') return '#e11d48';
    if (ss === 'E') return '#d97706';
    return '#0d9488';
  }
  if (scheme === 'plddt') {
    const b = atom.bFactor ?? 82;
    if (b >= 90) return '#1d4ed8';
    if (b >= 70) return '#06b6d4';
    if (b >= 50) return '#eab308';
    return '#f97316';
  }
  if (scheme === 'hydropathy') {
    const kd = KD_BY_RES3[atom.resName.toUpperCase()] ?? 0;
    const t = Math.max(0, Math.min(1, (kd + 4.5) / 9.0));
    const r = Math.round(37 + t * 202);
    const g = Math.round(99 - Math.abs(t - 0.5) * 60);
    const b = Math.round(235 - t * 200);
    return `rgb(${r},${g},${b})`;
  }
  if (scheme === 'chain') {
    const ch = (atom.chainId ?? 'A').charCodeAt(0);
    return CHAIN_PALETTE[Math.abs(ch - 65) % CHAIN_PALETTE.length];
  }
  const hue = Math.round((1 - idx / Math.max(1, total - 1)) * 240);
  return `hsl(${hue}, 82%, 48%)`;
}

const padCol = (s: string | number, w: number, right = true): string =>
  (right ? String(s).padStart(w) : String(s).padEnd(w)).slice(0, w);

/**
 * Serializes `primaryAtoms` (plus optional full-atom `structure` and `ligands`) into a valid PDB
 * coordinate text block with `HELIX`, `SHEET`, `ATOM`, and `HETATM` records so Mol* can render
 * full secondary structure, sidechains, and ligands even when raw file text is not supplied.
 */
function buildPdbTextForMolstar(
  atoms: PdbCaAtom[],
  structure: Structure | undefined,
  ligands: StructureLigand[],
  showLigands: boolean,
  defaultChain = 'A'
): string {
  const lines: string[] = [];
  let i = 0;
  let h = 0;
  let e = 0;
  while (i < atoms.length) {
    const ss = atoms[i].secondaryStructure;
    let j = i;
    while (
      j + 1 < atoms.length &&
      atoms[j + 1].secondaryStructure === ss &&
      (atoms[j + 1].chainId ?? defaultChain) === (atoms[i].chainId ?? defaultChain)
    ) {
      j++;
    }
    const a = atoms[i];
    const b = atoms[j];
    const ch = (a.chainId || defaultChain).slice(0, 1);
    if (ss === 'H') {
      h++;
      lines.push(
        `HELIX  ${padCol(h, 3)} ${padCol(h, 3)} ${padCol(a.resName, 3)} ${ch} ${padCol(a.resSeq, 4)}  ${padCol(b.resName, 3)} ${ch} ${padCol(b.resSeq, 4)}  1`
      );
    } else if (ss === 'E') {
      e++;
      lines.push(
        `SHEET  ${padCol(e, 3)} ${padCol('S' + e, 3)} 1 ${padCol(a.resName, 3)} ${ch}${padCol(a.resSeq, 4)}  ${padCol(b.resName, 3)} ${ch}${padCol(b.resSeq, 4)}  0`
      );
    }
    i = j + 1;
  }

  let serial = 0;
  const shownChains = new Set(atoms.map((a) => a.chainId || defaultChain));
  const model0 = structure?.models[0];
  const fullChains = model0
    ? model0.chains.filter((c) => shownChains.has(c.labelAsymId) || shownChains.has(c.authAsymId))
    : [];

  if (fullChains.length > 0) {
    for (const chain of fullChains) {
      const ch = (chain.labelAsymId || chain.authAsymId || defaultChain).slice(0, 1);
      for (const res of chain.residues) {
        if (res.labelSeqId === null) continue;
        const seqNum = res.labelSeqId ?? res.authSeqId ?? 1;
        const ins = (res.insCode || ' ').slice(0, 1);
        for (const at of res.atoms) {
          if (at.record !== 'ATOM') continue;
          serial++;
          const atomName = at.name.length < 4 ? ` ${padCol(at.name, 3, false)}` : padCol(at.name, 4, false);
          const el = padCol((at.element || at.name.slice(0, 1)).toUpperCase(), 2);
          lines.push(
            `ATOM  ${padCol(serial, 5)} ${atomName} ${padCol(res.resName, 3)} ${ch}${padCol(seqNum, 4)}${ins}   ` +
              `${padCol(at.x.toFixed(3), 8)}${padCol(at.y.toFixed(3), 8)}${padCol(at.z.toFixed(3), 8)}` +
              `${padCol((at.occupancy ?? 1).toFixed(2), 6)}${padCol((at.bFactor ?? 80).toFixed(2), 6)}          ${el}`
          );
        }
      }
    }
  } else {
    for (const a of atoms) {
      serial++;
      const ch = (a.chainId || defaultChain).slice(0, 1);
      lines.push(
        `ATOM  ${padCol(serial, 5)}  CA  ${padCol(a.resName, 3)} ${ch}${padCol(a.resSeq, 4)}    ` +
          `${padCol(a.x.toFixed(3), 8)}${padCol(a.y.toFixed(3), 8)}${padCol(a.z.toFixed(3), 8)}` +
          `  1.00${padCol((a.bFactor ?? 80).toFixed(2), 6)}           C`
      );
    }
  }

  if (showLigands && ligands.length > 0) {
    for (const lig of ligands) {
      const ch = (lig.chainId || lig.labelAsymId || defaultChain).slice(0, 1);
      const seqNum = lig.authSeqId ?? 999;
      const ins = (lig.insCode || ' ').slice(0, 1);
      for (const at of lig.atoms) {
        serial++;
        const atomName = at.name.length < 4 ? ` ${padCol(at.name, 3, false)}` : padCol(at.name, 4, false);
        const el = padCol((at.element || at.name.slice(0, 1)).toUpperCase(), 2);
        lines.push(
          `HETATM${padCol(serial, 5)} ${atomName} ${padCol(lig.resName, 3)} ${ch}${padCol(seqNum, 4)}${ins}   ` +
            `${padCol(at.x.toFixed(3), 8)}${padCol(at.y.toFixed(3), 8)}${padCol(at.z.toFixed(3), 8)}` +
            `${padCol((at.occupancy ?? 1).toFixed(2), 6)}${padCol((at.bFactor ?? 30).toFixed(2), 6)}          ${el}`
        );
      }
    }
  }

  lines.push('END');
  return lines.join('\n') + '\n';
}

function detectTrajectoryFormat(text: string, hint?: 'mmcif' | 'pdb'): 'mmcif' | 'pdb' {
  if (hint) return hint;
  const trimmed = text.trimStart();
  if (trimmed.startsWith('data_') || trimmed.includes('_atom_site.')) return 'mmcif';
  return 'pdb';
}

function canUseWebGLInBrowser(): boolean {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;
  try {
    const probe = document.createElement('canvas');
    if (typeof probe.getContext !== 'function') return false;
    const gl = probe.getContext('webgl2') || probe.getContext('webgl');
    return Boolean(gl);
  } catch {
    return false;
  }
}

const MOLSTAR_COLOR_THEME_BY_SCHEME: Record<Protein3DColorScheme, string> = {
  secondary: 'secondary-structure',
  plddt: 'uncertainty',
  hydropathy: 'hydrophobicity',
  chain: 'chain-id',
  rainbow: 'sequence-id',
};

const MOLSTAR_REPR_BY_STYLE: Record<Protein3DStyle, string> = {
  cartoon: 'cartoon',
  backbone: 'backbone',
  'ball-stick': 'ball-and-stick',
  spacefill: 'spacefill',
};

export const ProteinStructure3DViewer: React.FC<ProteinStructure3DViewerProps> = ({
  primaryAtoms,
  overlayAtoms,
  contacts,
  title = '3D Macromolecular Structure Viewer',
  rmsdAngstrom,
  tmScore,
  alignedResiduePairs,
  pairingMethod,
  structure,
  structureText,
  structureFormat,
  activeChainId,
  selectedFeature,
  heightPx = 330,
  offscreenDeferred = false,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const molstarHostRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const molstarPluginRef = useRef<any>(null);
  const projectedRef = useRef<{ x: number; y: number; z: number; idx: number }[]>([]);

  const [preset, setPreset] = useState<Protein3DPreset>('polymer-and-hetero');
  const [style, setStyle] = useState<Protein3DStyle>('cartoon');
  const [colorScheme, setColorScheme] = useState<Protein3DColorScheme>('secondary');
  const [showSequence, setShowSequence] = useState<boolean>(false);
  const [showOverlay, setShowOverlay] = useState<boolean>(true);
  const [showContacts, setShowContacts] = useState<boolean>(false);
  const [showLigands, setShowLigands] = useState<boolean>(true);
  const [autoSpin, setAutoSpin] = useState<boolean>(false);
  const [isOffscreenPaused, setIsOffscreenPaused] = useState<boolean>(false);
  const [molstarActive, setMolstarActive] = useState<boolean>(false);
  const [molstarReady, setMolstarReady] = useState<boolean>(false);
  const [molstarExpanded, setMolstarExpanded] = useState<boolean>(false);
  const [molstarControlsOpen, setMolstarControlsOpen] = useState<boolean>(false);

  const [rotX, setRotX] = useState<number>(-0.32);
  const [rotY, setRotY] = useState<number>(0.54);
  const [zoom, setZoom] = useState<number>(1.0);
  const [pan, setPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);
  const [measuredPair, setMeasuredPair] = useState<number[]>([]);

  const dragStateRef = useRef<{
    dragging: boolean;
    pointerId: number;
    shiftKey: boolean;
    lastX: number;
    lastY: number;
    moved: boolean;
  }>({
    dragging: false,
    pointerId: -1,
    shiftKey: false,
    lastX: 0,
    lastY: 0,
    moved: false,
  });

  useEffect(() => {
    const onBlur = () => {
      dragStateRef.current.dragging = false;
      dragStateRef.current.pointerId = -1;
    };
    window.addEventListener('blur', onBlur);
    return () => window.removeEventListener('blur', onBlur);
  }, []);

  // The file's own secondary structure, its ligands, and the residues of the selected feature
  const ssView = useMemo(
    () => (structure ? withFileSecondaryStructure(structure, primaryAtoms) : { atoms: primaryAtoms, source: null }),
    [structure, primaryAtoms]
  );
  const atoms = ssView.atoms;
  const ligands = useMemo(
    () => (structure ? ligandsOfChains(structure, primaryAtoms.map((a) => a.chainId ?? '')) : []),
    [structure, primaryAtoms]
  );
  const featureView = useMemo((): { label: string; indices: number[]; residues: MappedResidue[] } | { error: string } | null => {
    if (!selectedFeature) return null;
    if (!structure) return { error: 'No full-atom model is loaded, so the feature cannot be placed.' };
    const chain = chainOf(structure, selectedFeature.chainId);
    if (!chain) return { error: `The structure has no chain ${selectedFeature.chainId}.` };
    try {
      const mapped = featureResidues(chain, selectedFeature.sequence, selectedFeature);
      const rs = mapped.residues;
      const span = rs.length
        ? ` (${rs[0].chainId} ${residueNumberLabel(rs[0])}–${residueNumberLabel(rs[rs.length - 1])})`
        : '';
      const missing = mapped.unmodelled.length ? `, ${mapped.unmodelled.length} not modelled` : '';
      const indices = caAtomIndicesOf(primaryAtoms, rs);
      const shown = indices.length === rs.length ? '' : `, ${indices.length} in view`;
      return {
        label: `${selectedFeature.name ?? 'Feature'}: ${rs.length} residues${span}${missing}${shown}`,
        indices,
        residues: rs,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }, [selectedFeature, structure, primaryAtoms]);
  const highlighted = featureView && 'indices' in featureView ? featureView.indices : null;
  const highlightedResidues = featureView && 'residues' in featureView ? featureView.residues : null;
  const contactView = useMemo(() => contactOverlay(contacts), [contacts]);

  // Center & normalize radius from primary atoms
  const geometry = useMemo(() => {
    if (primaryAtoms.length === 0) {
      return { cx: 0, cy: 0, cz: 0, maxR: 15 };
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const a of primaryAtoms) {
      sx += a.x;
      sy += a.y;
      sz += a.z;
    }
    const cx = sx / primaryAtoms.length;
    const cy = sy / primaryAtoms.length;
    const cz = sz / primaryAtoms.length;
    let maxR = 6;
    for (const a of primaryAtoms) {
      const r = Math.hypot(a.x - cx, a.y - cy, a.z - cz);
      if (r > maxR) maxR = r;
    }
    return { cx, cy, cz, maxR };
  }, [primaryAtoms]);

  // Pause background rAF auto-spin when skipped offscreen (direct listener + IO fallback)
  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof document === 'undefined') return;

    if ('contentVisibility' in document.documentElement.style) {
      const onCvChange = (ev: Event) => {
        const cv = ev as ContentVisibilityEvent;
        setIsOffscreenPaused(Boolean(cv.skipped));
      };
      el.addEventListener('contentvisibilityautostatechange', onCvChange);
      return () => el.removeEventListener('contentvisibilityautostatechange', onCvChange);
    }

    if (typeof IntersectionObserver !== 'undefined') {
      const io = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          setIsOffscreenPaused(!entry.isIntersecting);
        }
      });
      io.observe(el);
      return () => io.disconnect();
    }
  }, []);

  // Initialize Mol* PluginUIContext when WebGL is available in a real browser DOM
  useEffect(() => {
    const host = molstarHostRef.current;
    if (!host || !canUseWebGLInBrowser()) return;

    let cancelled = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let createdPlugin: any = null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let layoutSub: any = null;

    (async () => {
      try {
        const [{ createPluginUI }, { renderReact18 }, { DefaultPluginUISpec }, { PluginConfig }, { Color }, { PluginCommands }] =
          await Promise.all([
            import('molstar/lib/mol-plugin-ui/index'),
            import('molstar/lib/mol-plugin-ui/react18'),
            import('molstar/lib/mol-plugin-ui/spec'),
            import('molstar/lib/mol-plugin/config'),
            import('molstar/lib/mol-util/color/index'),
            import('molstar/lib/mol-plugin/commands'),
          ]);
        if (cancelled) return;

        const baseSpec = DefaultPluginUISpec();
        const spec: typeof baseSpec = {
          ...baseSpec,
          layout: {
            initial: {
              isExpanded: false,
              showControls: false,
              controlsDisplay: 'reactive',
              regionState: {
                top: 'full',
                left: 'hidden',
                right: 'full',
                bottom: 'hidden',
              },
            },
          },
          components: {
            ...baseSpec.components,
            remoteState: 'none',
            controls: {
              ...baseSpec.components?.controls,
              left: 'none',
              bottom: 'none',
            },
          },
          config: [
            ...(baseSpec.config ?? []),
            [PluginConfig.General.AllowMajorPerformanceCaveat, true],
            [PluginConfig.Viewport.ShowExpand, true],
            [PluginConfig.Viewport.ShowToggleFullscreen, false],
            [PluginConfig.Viewport.ShowControls, true],
            [PluginConfig.Viewport.ShowSettings, true],
            [PluginConfig.Viewport.ShowSelectionMode, true],
            [PluginConfig.Viewport.ShowAnimation, false],
            [PluginConfig.VolumeStreaming.Enabled, false],
          ],
        };

        const plugin = await createPluginUI({
          target: host,
          render: renderReact18,
          spec,
        });

        if (cancelled) {
          plugin.dispose();
          return;
        }

        if (!plugin.canvas3d) {
          plugin.dispose();
          setMolstarActive(false);
          setMolstarReady(false);
          return;
        }

        plugin.canvas3d.setProps({
          renderer: {
            backgroundColor: Color(0x020617),
          },
        });
        plugin.handleResize?.();

        if (plugin.layout?.events?.updated) {
          layoutSub = plugin.layout.events.updated.subscribe(() => {
            if (cancelled) return;
            const st = plugin.layout?.state;
            if (st?.expandToFullscreen) {
              // In Desktop/Tauri WebView, route hover-box Fullscreen to in-window expanded mode
              // so the bottom floating controls and Escape key always exit cleanly.
              void PluginCommands.Layout.Update(plugin, {
                state: { isExpanded: !st.isExpanded, expandToFullscreen: false },
              });
              return;
            }
            if (
              st?.showControls &&
              st?.regionState?.top === 'hidden' &&
              st?.regionState?.right === 'hidden'
            ) {
              void PluginCommands.Layout.Update(plugin, {
                state: {
                  showControls: true,
                  regionState: {
                    ...st.regionState,
                    top: 'full',
                    right: 'full',
                  },
                },
              });
              return;
            }
            const expanded = Boolean(st?.isExpanded);
            const controlsOpen = Boolean(st?.showControls);
            const seqOpen = Boolean(st?.showControls && st?.regionState?.top !== 'hidden');
            setMolstarExpanded(expanded);
            setMolstarControlsOpen(controlsOpen);
            setShowSequence(seqOpen);
            if (typeof requestAnimationFrame === 'function') {
              requestAnimationFrame(() => plugin.handleResize?.());
            } else {
              plugin.handleResize?.();
            }
          });
        }

        molstarPluginRef.current = plugin;
        createdPlugin = plugin;
        setMolstarActive(true);
      } catch {
        setMolstarActive(false);
        setMolstarReady(false);
      }
    })();

    return () => {
      cancelled = true;
      molstarPluginRef.current = null;
      if (layoutSub && typeof layoutSub.unsubscribe === 'function') {
        try {
          layoutSub.unsubscribe();
        } catch {
          // Ignore subscription cleanup errors
        }
      }
      if (createdPlugin) {
        try {
          createdPlugin.dispose();
        } catch {
          // Ignore disposal errors on unmount
        }
      }
    };
  }, []);

  const handleExitMolstarExpanded = useCallback(async () => {
    const plugin = molstarPluginRef.current;
    if (!plugin) {
      setMolstarExpanded(false);
      return;
    }
    try {
      const { PluginCommands } = await import('molstar/lib/mol-plugin/commands');
      await PluginCommands.Layout.Update(plugin, {
        state: {
          isExpanded: false,
          expandToFullscreen: false,
        },
      });
      if (typeof document !== 'undefined' && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
      setMolstarExpanded(false);
      plugin.handleResize?.();
    } catch {
      setMolstarExpanded(false);
    }
  }, []);

  useEffect(() => {
    if (!molstarExpanded || typeof window === 'undefined') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void handleExitMolstarExpanded();
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [molstarExpanded, handleExitMolstarExpanded]);

  const handleToggleSequence = useCallback(async () => {
    const next = !showSequence;
    setShowSequence(next);
    const plugin = molstarPluginRef.current;
    if (!plugin || !molstarActive) return;
    try {
      const { PluginCommands } = await import('molstar/lib/mol-plugin/commands');
      const curRegions = plugin.layout?.state?.regionState ?? {};
      const rightVisible = Boolean(plugin.layout?.state?.showControls && curRegions.right === 'full');
      await PluginCommands.Layout.Update(plugin, {
        state: {
          showControls: next || rightVisible,
          regionState: {
            ...curRegions,
            top: next ? 'full' : 'hidden',
            left: 'hidden',
            right: rightVisible ? 'full' : 'hidden',
            bottom: 'hidden',
          },
        },
      });
      plugin.handleResize?.();
    } catch {
      // Ignore layout sync errors
    }
  }, [molstarActive, showSequence]);

  // Sync trackball auto-spin with Mol*
  useEffect(() => {
    const plugin = molstarPluginRef.current;
    if (!plugin || !molstarActive) return;
    const spinning = autoSpin && !isOffscreenPaused;
    plugin.canvas3d?.setProps({
      trackball: {
        ...plugin.canvas3d.props.trackball,
        animate: spinning
          ? { name: 'spin', params: { speed: 1, axis: plugin.canvas3d.props.trackball.animate.params?.axis } }
          : { name: 'off', params: {} },
      },
    });
  }, [molstarActive, autoSpin, isOffscreenPaused]);

  // Load / update structure, representation preset, style, color scheme, ligands, and Model B in Mol*
  useEffect(() => {
    const plugin = molstarPluginRef.current;
    if (!plugin || !molstarActive) return;
    let cancelled = false;

    (async () => {
      try {
        await plugin.clear();
        if (cancelled || primaryAtoms.length === 0) {
          if (!cancelled) setMolstarReady(false);
          return;
        }

        // When raw structureText is provided without single-chain filtering (and ligands are shown),
        // pass the raw file text directly to Mol*; otherwise synthesize the filtered PDB from the
        // parsed full-atom model / primaryAtoms so single-chain documents and ligand toggles match.
        const useRawText = Boolean(structureText?.trim()) && !activeChainId && showLigands;
        const mainDataText = useRawText
          ? structureText!
          : buildPdbTextForMolstar(atoms, structure, ligands, showLigands, activeChainId || 'A');
        const mainFormat = useRawText ? detectTrajectoryFormat(structureText!, structureFormat) : 'pdb';

        const rawData = await plugin.builders.data.rawData(
          { data: mainDataText, label: title },
          { state: { isGhost: true } }
        );
        if (cancelled) return;
        const trajectory = await plugin.builders.structure.parseTrajectory(rawData, mainFormat);
        if (cancelled) return;

        const themeName = MOLSTAR_COLOR_THEME_BY_SCHEME[colorScheme] ?? 'secondary-structure';
        const normalizedPreset = preset === 'polymer-and-hetero' ? 'polymer-and-ligand' : preset;
        const effectivePreset =
          !showLigands && (normalizedPreset === 'polymer-and-ligand' || normalizedPreset === 'auto')
            ? 'polymer-cartoon'
            : normalizedPreset;

        if (effectivePreset === 'empty') {
          const model = await plugin.builders.structure.createModel(trajectory);
          const modelProps = await plugin.builders.structure.insertModelProperties(model);
          const struct = await plugin.builders.structure.createStructure(modelProps || model);
          const structProps = await plugin.builders.structure.insertStructureProperties(struct);
          const polymer = await plugin.builders.structure.tryCreateComponentStatic(structProps, 'polymer');
          const reprType = MOLSTAR_REPR_BY_STYLE[style] ?? 'cartoon';
          await plugin.builders.structure.representation.addRepresentation(polymer || structProps, {
            type: reprType,
            color: themeName,
          });
          if (showLigands && ligands.length > 0) {
            const ligandComp = await plugin.builders.structure.tryCreateComponentStatic(structProps, 'ligand');
            if (ligandComp) {
              await plugin.builders.structure.representation.addRepresentation(ligandComp, {
                type: 'ball-and-stick',
                color: 'element-symbol',
              });
            }
          }
        } else {
          await plugin.builders.structure.hierarchy.applyPreset(trajectory, 'default', {
            representationPreset: effectivePreset,
            representationPresetParams: {
              theme: { globalName: themeName },
            },
          });

          // If the user explicitly changed `style` away from default cartoon while using a polymer preset,
          // also add/update the polymer representation style
          if (style !== 'cartoon') {
            const reprType = MOLSTAR_REPR_BY_STYLE[style];
            const structures = plugin.managers.structure.hierarchy.current.structures;
            if (structures.length > 0) {
              const sRef = structures[0];
              const polymerComp = await plugin.builders.structure.tryCreateComponentStatic(sRef.cell, 'polymer');
              if (polymerComp) {
                await plugin.builders.structure.representation.addRepresentation(polymerComp, {
                  type: reprType,
                  color: themeName,
                });
              }
            }
          }
        }

        // Optional Kabsch-superimposed Model B overlay
        if (showOverlay && overlayAtoms && overlayAtoms.length > 1) {
          const overlayPdb = buildPdbTextForMolstar(overlayAtoms, undefined, [], false, 'B');
          const overlayData = await plugin.builders.data.rawData(
            { data: overlayPdb, label: 'Model B (Superimposed)' },
            { state: { isGhost: true } }
          );
          if (!cancelled) {
            const overlayTraj = await plugin.builders.structure.parseTrajectory(overlayData, 'pdb');
            const overlayModel = await plugin.builders.structure.createModel(overlayTraj);
            const overlayStruct = await plugin.builders.structure.createStructure(overlayModel);
            const { Color } = await import('molstar/lib/mol-util/color/index');
            await plugin.builders.structure.representation.addRepresentation(overlayStruct, {
              type: style === 'spacefill' ? 'spacefill' : style === 'ball-stick' ? 'ball-and-stick' : 'backbone',
              color: 'uniform',
              colorParams: { value: Color(0xa78bfa) },
            });
          }
        }

        // Highlight & focus selected sequence feature in Mol*
        if (!cancelled && highlightedResidues && highlightedResidues.length > 0) {
          try {
            const { applyStructureInteractivity } = await import('molstar/lib/extensions/plugin/interactivity');
            const items = highlightedResidues.map((r) =>
              useRawText && mainFormat === 'mmcif'
                ? { label_asym_id: r.labelAsymId, label_seq_id: r.labelSeqId }
                : { auth_asym_id: (r.labelAsymId || r.chainId || 'A').slice(0, 1), auth_seq_id: r.labelSeqId }
            );
            applyStructureInteractivity(plugin, {
              elements: { items },
              action: ['select', 'highlight', 'focus'],
            });
          } catch {
            // Ignore optional interactivity extension errors
          }
        }

        if (!cancelled) {
          plugin.handleResize?.();
          try {
            const { PluginCommands } = await import('molstar/lib/mol-plugin/commands');
            await PluginCommands.Camera.Reset(plugin, { durationMs: 0 });
          } catch {
            // Ignore camera reset errors
          }
          setMolstarReady(true);
        }
      } catch {
        // Fallback canvas remains intact if parsing fails
        if (!cancelled) setMolstarReady(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    molstarActive,
    atoms,
    primaryAtoms.length,
    structure,
    structureText,
    structureFormat,
    activeChainId,
    ligands,
    showLigands,
    preset,
    style,
    colorScheme,
    showOverlay,
    overlayAtoms,
    highlightedResidues,
    title,
  ]);

  useEffect(() => {
    if (!autoSpin || isOffscreenPaused || (molstarActive && !showContacts)) return;
    let rafId = 0;
    const step = () => {
      setRotY((prev) => prev + 0.012);
      rafId = window.requestAnimationFrame(step);
    };
    rafId = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(rafId);
  }, [autoSpin, isOffscreenPaused, molstarActive, showContacts]);

  const drawScene = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
    const cssW = canvas.clientWidth || 520;
    const cssH = canvas.clientHeight || heightPx;
    if (canvas.width !== Math.round(cssW * dpr) || canvas.height !== Math.round(cssH * dpr)) {
      canvas.width = Math.round(cssW * dpr);
      canvas.height = Math.round(cssH * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);

    // Subtle scientific radial stage background
    const grad = ctx.createRadialGradient(
      cssW * 0.5,
      cssH * 0.45,
      20,
      cssW * 0.5,
      cssH * 0.5,
      Math.max(cssW, cssH) * 0.65
    );
    grad.addColorStop(0, 'rgba(15, 23, 42, 0.94)');
    grad.addColorStop(1, 'rgba(2, 6, 23, 0.98)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, cssW, cssH);

    if (primaryAtoms.length === 0) {
      ctx.fillStyle = '#94a3b8';
      ctx.font = '12.5px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('No 3D Cα coordinates loaded.', cssW / 2, cssH / 2);
      return;
    }

    const cosX = Math.cos(rotX);
    const sinX = Math.sin(rotX);
    const cosY = Math.cos(rotY);
    const sinY = Math.sin(rotY);
    const baseScale = (Math.min(cssW, cssH) * 0.41 * zoom) / geometry.maxR;
    const camDist = geometry.maxR * 3.6;

    const projectAtom = (a: { x: number; y: number; z: number }) => {
      const dx = a.x - geometry.cx;
      const dy = a.y - geometry.cy;
      const dz = a.z - geometry.cz;
      const x1 = dx * cosY + dz * sinY;
      const z1 = -dx * sinY + dz * cosY;
      const y2 = dy * cosX - z1 * sinX;
      const z2 = dy * sinX + z1 * cosX;
      const persp = camDist / Math.max(4, camDist - z2);
      return {
        sx: cssW * 0.5 + pan.x + x1 * baseScale * persp,
        sy: cssH * 0.5 + pan.y - y2 * baseScale * persp,
        z: z2,
        persp,
      };
    };

    const projPrimary = atoms.map((a, idx) => ({
      ...projectAtom(a),
      atom: a,
      idx,
      color: colorForAtom(a, idx, atoms.length, colorScheme),
    }));
    projectedRef.current = projPrimary.map((p) => ({
      x: p.sx,
      y: p.sy,
      z: p.z,
      idx: p.idx,
    }));

    // Optional contact network (Cα pairs within 8 A): the contacts contactOverlay picks, drawn as
    // one path (a stroke per line costs several times more a frame)
    if (showContacts && contactView.drawn.length > 0) {
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.34)';
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      for (const contact of contactView.drawn) {
        const resolved = resolveContactAtomIndices(contact);
        if (!resolved) continue;
        const [idxA, idxB] = resolved;
        const pa = projPrimary[idxA];
        const pb = projPrimary[idxB];
        if (!pa || !pb) continue;
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Optional Kabsch-superimposed Model B overlay trace
    if (showOverlay && overlayAtoms && overlayAtoms.length > 1) {
      const projB = overlayAtoms.map(projectAtom);
      ctx.save();
      ctx.strokeStyle = 'rgba(167, 139, 250, 0.82)';
      ctx.lineWidth = 2.1 * Math.sqrt(zoom);
      ctx.lineCap = 'round';
      ctx.beginPath();
      for (let i = 0; i < projB.length; i++) {
        if (i === 0) ctx.moveTo(projB[i].sx, projB[i].sy);
        else ctx.lineTo(projB[i].sx, projB[i].sy);
      }
      ctx.stroke();
      ctx.restore();
    }

    // Depth-sorted segments / spheres (painter's algorithm back-to-front)
    if (style === 'spacefill') {
      const sorted = [...projPrimary].sort((a, b) => a.z - b.z);
      for (const p of sorted) {
        const r = Math.max(3.5, 5.8 * p.persp * Math.sqrt(zoom));
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, r, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(p.sx - r * 0.28, p.sy - r * 0.28, r * 0.28, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.34)';
        ctx.fill();
      }
    } else {
      const segs = [];
      for (let i = 0; i < projPrimary.length - 1; i++) {
        const a = projPrimary[i];
        const b = projPrimary[i + 1];
        if ((a.atom.chainId ?? 'A') !== (b.atom.chainId ?? 'A')) continue;
        segs.push({ i, a, b, zMid: (a.z + b.z) * 0.5 });
      }
      segs.sort((u, v) => u.zMid - v.zMid);

      for (const seg of segs) {
        const { i, a, b } = seg;
        const ss = a.atom.secondaryStructure ?? 'C';
        const depthAlpha = Math.max(0.42, Math.min(1, 0.72 + seg.zMid / (geometry.maxR * 2.4)));
        ctx.save();
        ctx.globalAlpha = depthAlpha;
        ctx.strokeStyle = a.color;
        ctx.lineCap = 'round';

        if (style === 'cartoon') {
          const p0 = projPrimary[Math.max(0, i - 1)];
          const p3 = projPrimary[Math.min(projPrimary.length - 1, i + 2)];
          const cp1x = a.sx + (b.sx - p0.sx) / 6;
          const cp1y = a.sy + (b.sy - p0.sy) / 6;
          const cp2x = b.sx - (p3.sx - a.sx) / 6;
          const cp2y = b.sy - (p3.sy - a.sy) / 6;
          const baseW = ss === 'H' ? 6.4 : ss === 'E' ? 5.6 : 2.3;
          ctx.lineWidth = Math.max(1.5, baseW * a.persp * Math.sqrt(zoom));
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.bezierCurveTo(cp1x, cp1y, cp2x, cp2y, b.sx, b.sy);
          ctx.stroke();

          if (ss === 'H' || ss === 'E') {
            ctx.strokeStyle = 'rgba(255, 255, 255, 0.32)';
            ctx.lineWidth = Math.max(0.8, ctx.lineWidth * 0.3);
            ctx.stroke();
          }
        } else {
          ctx.lineWidth = Math.max(1.4, 2.5 * a.persp * Math.sqrt(zoom));
          ctx.beginPath();
          ctx.moveTo(a.sx, a.sy);
          ctx.lineTo(b.sx, b.sy);
          ctx.stroke();

          if (style === 'ball-stick') {
            const r = Math.max(2.1, 3.2 * a.persp * Math.sqrt(zoom));
            ctx.fillStyle = a.color;
            ctx.beginPath();
            ctx.arc(a.sx, a.sy, r, 0, Math.PI * 2);
            ctx.fill();
          }
        }
        ctx.restore();
      }
    }

    // Ligand atoms of the shown chains, back to front
    if (showLigands && ligands.length > 0) {
      const pts = ligands.flatMap((l) =>
        l.atoms.map((a) => ({ ...projectAtom(a), el: (a.element ?? a.name.slice(0, 1)).toUpperCase() }))
      );
      pts.sort((p, q) => p.z - q.z);
      ctx.save();
      for (const p of pts) {
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(1.6, 2.4 * p.persp * Math.sqrt(zoom)), 0, Math.PI * 2);
        ctx.fillStyle = LIGAND_ELEMENT_COLORS[p.el] ?? '#e2e8f0';
        ctx.fill();
      }
      ctx.restore();
    }

    // Residues of the selected sequence feature
    if (highlighted && highlighted.length > 0) {
      ctx.save();
      ctx.strokeStyle = '#f0abfc';
      ctx.fillStyle = 'rgba(240, 171, 252, 0.3)';
      ctx.lineWidth = 1.6;
      for (const i of highlighted) {
        const p = projPrimary[i];
        if (!p) continue;
        ctx.beginPath();
        ctx.arc(p.sx, p.sy, Math.max(4, 5.5 * p.persp * Math.sqrt(zoom)), 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();
    }

    // Distance ruler between two clicked C-alpha atoms
    if (measuredPair.length === 2) {
      const p1 = projPrimary[measuredPair[0]];
      const p2 = projPrimary[measuredPair[1]];
      if (p1 && p2) {
        const distA = Math.hypot(
          p1.atom.x - p2.atom.x,
          p1.atom.y - p2.atom.y,
          p1.atom.z - p2.atom.z
        );
        ctx.save();
        ctx.strokeStyle = '#facc15';
        ctx.lineWidth = 1.8;
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(p1.sx, p1.sy);
        ctx.lineTo(p2.sx, p2.sy);
        ctx.stroke();
        ctx.setLineDash([]);
        for (const pt of [p1, p2]) {
          ctx.fillStyle = '#facc15';
          ctx.beginPath();
          ctx.arc(pt.sx, pt.sy, 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
        const mx = (p1.sx + p2.sx) * 0.5;
        const my = (p1.sy + p2.sy) * 0.5 - 8;
        const label = `${p1.atom.resName}${p1.atom.resSeq} ↔ ${p2.atom.resName}${p2.atom.resSeq}: ${distA.toFixed(2)} Å`;
        ctx.font = '600 11.5px ui-monospace, SFMono-Regular, monospace';
        const tw = ctx.measureText(label).width + 12;
        ctx.fillStyle = 'rgba(15, 23, 42, 0.9)';
        ctx.fillRect(mx - tw / 2, my - 13, tw, 18);
        ctx.fillStyle = '#fef08a';
        ctx.textAlign = 'center';
        ctx.fillText(label, mx, my);
        ctx.restore();
      }
    }

    // Hover highlight halo
    if (hoveredIdx !== null && projPrimary[hoveredIdx]) {
      const hp = projPrimary[hoveredIdx];
      ctx.save();
      ctx.strokeStyle = '#38bdf8';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(hp.sx, hp.sy, 6.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }, [
    atoms,
    colorScheme,
    contactView,
    geometry,
    heightPx,
    highlighted,
    hoveredIdx,
    ligands,
    measuredPair,
    overlayAtoms,
    pan,
    primaryAtoms,
    rotX,
    rotY,
    showContacts,
    showLigands,
    showOverlay,
    style,
    zoom,
  ]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (dragStateRef.current.dragging) return;
    try {
      e.currentTarget.setPointerCapture?.(e.pointerId);
    } catch {
      // Ignore synthetic event environments without pointer capture
    }
    dragStateRef.current = {
      dragging: true,
      pointerId: e.pointerId,
      shiftKey: e.shiftKey,
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;

    if (dragStateRef.current.dragging) {
      if (
        dragStateRef.current.pointerId !== -1 &&
        e.pointerId !== dragStateRef.current.pointerId
      ) {
        return;
      }
      const dx = e.clientX - dragStateRef.current.lastX;
      const dy = e.clientY - dragStateRef.current.lastY;
      if (Math.hypot(dx, dy) > 2) dragStateRef.current.moved = true;
      dragStateRef.current.lastX = e.clientX;
      dragStateRef.current.lastY = e.clientY;

      if (dragStateRef.current.shiftKey || e.shiftKey) {
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
      } else {
        setRotY((ry) => ry + dx * 0.011);
        setRotX((rx) => Math.max(-1.52, Math.min(1.52, rx + dy * 0.011)));
      }
      return;
    }

    let bestIdx: number | null = null;
    let bestD2 = 144;
    for (const pt of projectedRef.current) {
      const d2 = (pt.x - lx) * (pt.x - lx) + (pt.y - ly) * (pt.y - ly);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestIdx = pt.idx;
      }
    }
    setHoveredIdx(bestIdx);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      dragStateRef.current.pointerId !== -1 &&
      e.pointerId !== dragStateRef.current.pointerId
    ) {
      return;
    }
    const wasClick = dragStateRef.current.dragging && !dragStateRef.current.moved;
    dragStateRef.current.dragging = false;
    dragStateRef.current.pointerId = -1;
    try {
      if (e.currentTarget.hasPointerCapture?.(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // Ignore release errors
    }
    if (wasClick && hoveredIdx !== null) {
      setMeasuredPair((prev) =>
        prev.length === 1 && prev[0] !== hoveredIdx ? [prev[0], hoveredIdx] : [hoveredIdx]
      );
    }
  };

  const handlePointerCancel = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (
      dragStateRef.current.pointerId !== -1 &&
      e.pointerId !== dragStateRef.current.pointerId
    ) {
      return;
    }
    dragStateRef.current.dragging = false;
    dragStateRef.current.pointerId = -1;
  };

  const handleLostPointerCapture = () => {
    dragStateRef.current.dragging = false;
    dragStateRef.current.pointerId = -1;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.09 : 0.92;
    setZoom((z) => Math.max(0.35, Math.min(4.5, z * factor)));
  };

  const handleResetView = async () => {
    setRotX(-0.32);
    setRotY(0.54);
    setZoom(1.0);
    setPan({ x: 0, y: 0 });
    setMeasuredPair([]);
    const plugin = molstarPluginRef.current;
    if (plugin && molstarActive) {
      try {
        const { PluginCommands } = await import('molstar/lib/mol-plugin/commands');
        await PluginCommands.Camera.Reset(plugin, {});
      } catch {
        // Ignore camera reset errors
      }
    }
  };

  const handleExportPng = async () => {
    const plugin = molstarPluginRef.current;
    if (plugin && molstarActive && !showContacts && plugin.helpers?.viewportScreenshot) {
      try {
        const dataUri = await plugin.helpers.viewportScreenshot.getImageDataUri();
        saveWorkbenchFile(`${title}_3D.png`, dataUrlToBytes(dataUri), 'image/png');
        return;
      } catch {
        // Fall through to canvas export
      }
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    saveWorkbenchFile(`${title}_3D.png`, dataUrlToBytes(canvas.toDataURL('image/png')), 'image/png');
  };

  const hoveredAtom = hoveredIdx !== null ? atoms[hoveredIdx] : null;
  const ligandList = ligands.map((l) => `${l.resName} ${l.chainId}${residueNumberLabel(l)}`).join(', ');
  const showMolstarViewport = molstarActive && molstarReady && !showContacts && primaryAtoms.length > 0;
  const effectiveHeightPx =
    (showSequence || molstarControlsOpen) && showMolstarViewport ? Math.max(heightPx, 420) : heightPx;

  useEffect(() => {
    if (!showMolstarViewport) {
      drawScene();
    } else {
      molstarPluginRef.current?.handleResize?.();
    }
  }, [showMolstarViewport, effectiveHeightPx, drawScene]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      molstarPluginRef.current?.handleResize?.();
      drawScene();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [drawScene]);

  return (
    <div
      ref={containerRef}
      className={`protein-3d-viewer-stage${molstarExpanded ? ' is-molstar-expanded' : ''}`}
      style={
        offscreenDeferred && !showMolstarViewport && !molstarExpanded
          ? {
              contentVisibility: 'auto',
              containIntrinsicSize: `auto none auto ${effectiveHeightPx + 74}px`,
              border: '1px solid var(--mbc-border)',
              borderRadius: 8,
              overflow: 'hidden',
              background: '#020617',
            }
          : {
              border: '1px solid var(--mbc-border)',
              borderRadius: 8,
              overflow: molstarExpanded ? 'visible' : 'hidden',
              background: '#020617',
            }
      }
    >
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 6,
          padding: '6px 10px',
          background: 'var(--mbc-bg-panel)',
          borderBottom: '1px solid var(--mbc-border)',
          fontSize: 11.5,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <strong style={{ color: 'var(--mbc-text-main)' }}>{title}</strong>
          <span className="badge-accent">{primaryAtoms.length} Cα</span>
          {typeof rmsdAngstrom === 'number' && (
            <span className="badge-accent">RMSD {rmsdAngstrom} Å</span>
          )}
          {typeof tmScore === 'number' && (
            <span className="badge-accent" title={TM_APPROXIMATE_NOTE} aria-label={`TM-score about ${tmScore}: ${TM_APPROXIMATE_NOTE}`}>
              TM≈ {tmScore}
            </span>
          )}
          {typeof alignedResiduePairs === 'number' && (
            <span className="badge-accent" title={pairingMethod} aria-label={pairingMethod ? `${alignedResiduePairs} Cα pairs: ${pairingMethod}` : undefined}>
              {alignedResiduePairs} Cα pairs
            </span>
          )}
          {ssView.source && (
            <span
              className="badge-accent"
              title={ssView.source === 'file' ? 'Helices and strands as the file declares them' : 'The file declares no helices or strands for these residues, so they are inferred from Cα geometry'}
            >
              {ssView.source === 'file' ? 'SS from file' : 'SS inferred'}
            </span>
          )}
          {ligands.length > 0 && (
            <span className="badge-accent" title={ligandList} aria-label={`Ligands: ${ligandList}`}>
              {`${ligands.length} ligand${ligands.length === 1 ? '' : 's'}`}
            </span>
          )}
          {featureView && (
            <span
              className="badge-accent"
              title={'error' in featureView ? featureView.error : undefined}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Highlighter size={12} strokeWidth={2.2} aria-hidden="true" />
              {'error' in featureView ? `Feature not placed: ${featureView.error}` : featureView.label}
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <select
            aria-label="3D Representation Preset"
            value={preset}
            onChange={(e) => setPreset(e.target.value as Protein3DPreset)}
            style={{ fontSize: 11.5, padding: '2px 6px' }}
          >
            <option value="polymer-and-hetero">Preset: Polymer &amp; Hetero</option>
            <option value="auto">Preset: Automatic</option>
            <option value="polymer-cartoon">Preset: Polymer Cartoon</option>
            <option value="protein-and-nucleic">Preset: Protein &amp; Nucleic</option>
            <option value="atomic-detail">Preset: Atomic Detail</option>
            <option value="molecular-surface">Preset: Molecular Surface</option>
            <option value="coarse-surface">Preset: Coarse Surface</option>
            <option value="auto-lod">Preset: Auto Detail (LOD)</option>
            <option value="illustrative">Preset: Illustrative (Spacefill)</option>
            <option value="empty">Preset: Custom Style Only</option>
          </select>

          <select
            aria-label="3D Representation Style"
            value={style}
            onChange={(e) => setStyle(e.target.value as Protein3DStyle)}
            style={{ fontSize: 11.5, padding: '2px 6px' }}
          >
            <option value="cartoon">Cartoon / Ribbon</option>
            <option value="backbone">Cα Backbone</option>
            <option value="ball-stick">Ball &amp; Stick</option>
            <option value="spacefill">Spacefill (VdW)</option>
          </select>

          <select
            aria-label="3D Color Scheme"
            value={colorScheme}
            onChange={(e) => setColorScheme(e.target.value as Protein3DColorScheme)}
            style={{ fontSize: 11.5, padding: '2px 6px' }}
          >
            <option value="secondary">Secondary Struct (H/E/C)</option>
            <option value="plddt">Confidence (pLDDT / B-Factor)</option>
            <option value="hydropathy">Kyte-Doolittle Hydropathy</option>
            <option value="chain">Chain ID</option>
            <option value="rainbow">N→C Rainbow</option>
          </select>

          <button
            type="button"
            className="btn-secondary btn-xs"
            aria-pressed={showSequence}
            onClick={() => void handleToggleSequence()}
          >
            {showSequence ? 'Hide Sequence' : 'Show Sequence'}
          </button>

          {overlayAtoms && overlayAtoms.length > 1 && (
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => setShowOverlay((v) => !v)}
            >
              {showOverlay ? 'Hide Model B' : 'Show Model B'}
            </button>
          )}
          {contacts && contacts.length > 0 && (
            <button
              type="button"
              className="btn-secondary btn-xs"
              onClick={() => setShowContacts((v) => !v)}
            >
              {showContacts ? 'Hide Contacts' : 'Contacts (<8Å)'}
            </button>
          )}
          {ligands.length > 0 && (
            <button
              type="button"
              className="btn-secondary btn-xs"
              aria-pressed={showLigands}
              onClick={() => setShowLigands((v) => !v)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
            >
              <Hexagon size={12} strokeWidth={2.2} aria-hidden="true" />
              {showLigands ? 'Hide Ligands' : 'Show Ligands'}
            </button>
          )}
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={() => setAutoSpin((v) => !v)}
          >
            {autoSpin ? 'Pause Spin' : 'Spin'}
          </button>
          <button
            type="button"
            className="btn-secondary btn-xs"
            onClick={handleResetView}
          >
            Reset
          </button>
          <button type="button" className="btn-secondary btn-xs" onClick={handleExportPng}>
            PNG
          </button>
        </div>
      </div>

      {showContacts && contactView.warning && (
        <div style={{ padding: '0 10px', background: 'var(--mbc-bg-panel)', borderBottom: '1px solid var(--mbc-border)' }}>
          <ResultWarnings warnings={[contactView.warning]} label="Contact overlay" />
        </div>
      )}

      <div
        className="protein-3d-canvas-viewport"
        style={{ position: 'relative', width: '100%', height: effectiveHeightPx }}
      >
        <div
          ref={molstarHostRef}
          className="molstar-viewer-host"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            visibility: showMolstarViewport ? 'visible' : 'hidden',
            opacity: showMolstarViewport ? 1 : 0,
            pointerEvents: showMolstarViewport ? 'auto' : 'none',
            zIndex: molstarExpanded ? 10000 : 2,
          }}
        />
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerCancel}
          onLostPointerCapture={handleLostPointerCapture}
          onWheel={handleWheel}
          style={{
            width: '100%',
            height: '100%',
            display: showMolstarViewport ? 'none' : 'block',
            cursor: 'grab',
            touchAction: 'none',
          }}
        />
        {!showMolstarViewport && (
          <div
            style={{
              position: 'absolute',
              left: 10,
              bottom: 8,
              right: 10,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              pointerEvents: 'none',
              fontSize: 11,
              color: '#cbd5e1',
            }}
          >
            <span>
              {hoveredAtom
                ? `${hoveredAtom.resName} ${hoveredAtom.resSeq} (Chain ${hoveredAtom.chainId ?? 'A'}) • SS ${hoveredAtom.secondaryStructure ?? 'C'} • B/pLDDT ${(hoveredAtom.bFactor ?? 80).toFixed(1)}`
                : 'Drag: 3D rotate • Shift+Drag: pan • Scroll: zoom • Click 2 Cα atoms: Å ruler'}
            </span>
            {overlayAtoms && overlayAtoms.length > 1 && showOverlay && (
              <span style={{ color: '#c4b5fd' }}>Violet trace: Kabsch-superimposed Model B</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
};
