// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Tree Explorer for tree documents: layouts, support-value cutoff,
 * branch lengths, scale bar or time axis, taxon search, and node actions — root on branch,
 * flip, compress/expand, colour a clade, rename a tip — plus midpoint rooting, ladderize,
 * undo, saving the edited tree and export as Newick, SVG or PNG.
 *
 * Its display settings (layout, support cut-off, branch lengths, node ages, font) are a Tree
 * Display section of the workbench's shared inspector (US-01M6TAT0). Drawn on its own, as in the
 * split view's pane, it keeps them in its header toolbar. Find taxa, the edits, the exports and the
 * selected-node bar stay above the tree in both.
 */

import { FigureExportButton } from './FigureExportButton';
import { InspectorSection, useInWorkbench } from './WorkbenchInspector';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { parseNewick, toNewick, type TreeNode } from '../core/treeConsensus';
import {
  flipAt, hasLengths, ladderize, layoutTree, midpointRoot, niceLength, nodeAt, renameAt, rootOnPath, tipNames,
  type TreeStyle,
} from '../core/treeLayout';
import type { SequenceDocument } from '../types/bio';

interface DisplayState {
  style: TreeStyle;
  showSupport: boolean;
  supportCutoff: number;
  showLengths: boolean;
  showAges: boolean;
  fontSize: number;
  /** Clade key (sorted tip names) → colour. */
  colors: Record<string, string>;
  /** Clade keys shown as triangles. */
  compressed: string[];
}

const DEFAULT_DISPLAY: DisplayState = {
  style: 'rectangular', showSupport: true, supportCutoff: 0, showLengths: false, showAges: false, fontSize: 12, colors: {}, compressed: [],
};

const SWATCHES = ['#d14343', '#2f7de1', '#1f9d55', '#c77d14', '#8b5cf6', '#0e9aa7'];

const cladeKey = (n: TreeNode) => [...tipNames(n)].sort().join('\u0001');

function readDisplay(doc: SequenceDocument): DisplayState {
  try {
    const raw = doc.docMetadata?.['Tree display'];
    return raw ? { ...DEFAULT_DISPLAY, ...(JSON.parse(String(raw)) as Partial<DisplayState>) } : DEFAULT_DISPLAY;
  } catch {
    return DEFAULT_DISPLAY;
  }
}

export interface ImportedTreeViewerProps {
  doc: SequenceDocument;
  onUpdateDocument?: (doc: SequenceDocument) => void;
  onDownload?: (content: string, fileName: string, mime: string) => void;
  onDownloadBinary?: (bytes: Uint8Array, fileName: string, mime: string) => void;
}

export const ImportedTreeViewer: React.FC<ImportedTreeViewerProps> = ({ doc, onUpdateDocument, onDownload, onDownloadBinary }) => {
  const original = String(doc.docMetadata?.Newick ?? '');
  const [history, setHistory] = useState<TreeNode[]>(() => {
    try { return [parseNewick(original)]; } catch { return []; }
  });
  const tree = history[history.length - 1] ?? null;
  const [display, setDisplay] = useState<DisplayState>(() => readDisplay(doc));
  const [displayDirty, setDisplayDirty] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [renameText, setRenameText] = useState('');
  const canvasRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [width, setWidth] = useState(900);
  const isTimetree = doc.docMetadata?.['Source Format'] === 'Timetree';
  const timeUnit = String(doc.docMetadata?.['Branch lengths'] ?? '');
  const inWorkbench = useInWorkbench();

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return;
    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth((w) => { const nw = Math.max(360, Math.floor(el.clientWidth - 24)); return nw === w ? w : nw; }));
    };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    update();
    return () => { ro.disconnect(); cancelAnimationFrame(frame); };
  }, []);

  const setD = (patch: Partial<DisplayState>) => { setDisplay((d) => ({ ...d, ...patch })); setDisplayDirty(true); };
  const edit = (fn: (t: TreeNode) => TreeNode) => {
    if (!tree) return;
    try {
      setHistory((h) => [...h, fn(tree)]);
      setSelected(null);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : String(e));
    }
  };

  const compressedPaths = useMemo(() => {
    const out = new Set<string>();
    if (!tree) return out;
    const keys = new Set(display.compressed);
    const walk = (n: TreeNode, path: string) => {
      if (n.children.length && keys.has(cladeKey(n))) { out.add(path); return; }
      n.children.forEach((c, i) => walk(c, path ? `${path}.${i}` : String(i)));
    };
    walk(tree, '');
    return out;
  }, [tree, display.compressed]);

  const labelWidth = useMemo(() => {
    if (!tree) return 120;
    const longest = Math.max(4, ...tipNames(tree).map((t) => t.length));
    return Math.min(260, 14 + longest * display.fontSize * 0.6);
  }, [tree, display.fontSize]);

  const layout = useMemo(() => (tree ? layoutTree(tree, {
    style: display.style, compressed: compressedPaths, width, rowHeight: Math.max(14, display.fontSize + 6), labelWidth,
  }) : null), [tree, display.style, display.fontSize, compressedPaths, width, labelWidth]);

  // colour lookup: a node takes the colour of its nearest coloured ancestor clade
  const colorOfPath = useMemo(() => {
    const map = new Map<string, string>();
    if (!tree) return map;
    const walk = (n: TreeNode, path: string, inherited: string | undefined) => {
      const c = display.colors[cladeKey(n)] ?? inherited;
      if (c) map.set(path, c);
      n.children.forEach((ch, i) => walk(ch, path ? `${path}.${i}` : String(i), c));
    };
    walk(tree, '', undefined);
    return map;
  }, [tree, display.colors]);

  const query = search.trim().toLowerCase();
  const selectedNode = tree && selected !== null ? nodeAt(tree, selected) : null;
  const dirty = history.length > 1 || displayDirty;
  const lengths = tree ? hasLengths(tree) : false;

  const save = () => {
    if (!tree || !onUpdateDocument) return;
    const t = new Date().toISOString();
    const newick = toNewick(tree);
    const changed = newick !== original;
    onUpdateDocument({
      ...doc,
      updatedAt: t,
      docMetadata: { ...doc.docMetadata, Newick: newick, 'Tree display': JSON.stringify(display) },
      history: changed
        ? [...doc.history, { id: `hist-${Date.now().toString(36)}`, timestamp: t, operation: 'Edit Tree', description: `Tree Explorer edits (${history.length - 1})`, parentIds: [doc.id], lengthBp: 0, topology: 'linear' }]
        : doc.history,
    });
    setHistory([tree]);
    setDisplayDirty(false);
  };

  const svgText = () => {
    const svg = svgRef.current;
    if (!svg) return '';
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(layout?.width ?? 800));
    clone.setAttribute('height', String(layout?.height ?? 600));
    clone.setAttribute('style', `color:#1f2933;background:#ffffff;font-family:Helvetica,Arial,sans-serif;font-size:${display.fontSize}px`);
    clone.querySelectorAll('text').forEach((tx) => { if (!tx.getAttribute('fill')) tx.setAttribute('fill', tx.classList.contains('mbc-tree-support') ? '#5b6670' : '#1f2933'); });
    return new XMLSerializer().serializeToString(clone);
  };
  const exportPng = () => {
    const text = svgText();
    if (!text || !layout || !onDownloadBinary) return;
    const img = new Image();
    const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    img.onload = () => {
      const k = 2;
      const canvas = document.createElement('canvas');
      canvas.width = layout.width * k;
      canvas.height = layout.height * k;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.scale(k, k);
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      canvas.toBlob((b) => { if (b) void b.arrayBuffer().then((buf) => onDownloadBinary(new Uint8Array(buf), `${doc.name}.png`, 'image/png')); }, 'image/png');
    };
    img.src = url;
  };

  if (!tree || !layout) {
    return (
      <div className="mbc-imported-tree-viewer">
        <p role="alert">The tree topology could not be displayed.</p>
        <details><summary>Newick source</summary><pre>{original}</pre></details>
      </div>
    );
  }

  const tips = layout.nodes.filter((n) => n.isTip);
  const circularLike = display.style === 'circular' || display.style === 'radial';
  const scaleBar = layout.scale > 0 && !isTimetree ? niceLength(layout.maxDepth / 5) : 0;
  const ageOf = (depth: number) => layout.maxDepth - depth;
  const fmtLen = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(2) : v.toPrecision(2));
  // App.css sets the font of every label in the tree canvas (.mbc-imported-tree-canvas text), which
  // beats the size the svg passes down and a font-size attribute. A label's own inline size beats it,
  // on screen and in the exported file, which writes each label's computed style before its own.
  const labelSize = { fontSize: display.fontSize };
  const smallSize = { fontSize: Math.max(8, display.fontSize - 2) };

  const layoutSelect = (
    <select value={display.style} onChange={(e) => setD({ style: e.target.value as TreeStyle })}>
      <option value="rectangular">{isTimetree ? 'Timetree' : 'Phylogram'}</option>
      <option value="cladogram">Cladogram (topology only)</option>
      <option value="circular">Circular</option>
      <option value="radial">Radial (unrooted)</option>
    </select>
  );
  const supportBox = <input type="checkbox" checked={display.showSupport} onChange={(e) => setD({ showSupport: e.target.checked })} />;
  const supportCutoff = (
    <input aria-label="Support cutoff" type="number" min={0} max={100} style={{ width: 52 }} value={display.supportCutoff}
      disabled={!display.showSupport} onChange={(e) => setD({ supportCutoff: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />
  );
  const lengthsBox = <input type="checkbox" checked={display.showLengths} disabled={!lengths} onChange={(e) => setD({ showLengths: e.target.checked })} />;
  const agesBox = <input type="checkbox" checked={display.showAges} onChange={(e) => setD({ showAges: e.target.checked })} />;
  const fontSelect = (
    <select value={display.fontSize} onChange={(e) => setD({ fontSize: Number(e.target.value) })}>
      {[9, 10, 11, 12, 14, 16, 18].map((s) => <option key={s} value={s}>{s}</option>)}
    </select>
  );
  // In the workbench the settings are rows of the inspector's section, as its other sections draw
  // theirs; drawn on its own (the split view's pane) the tree keeps them in its header toolbar.
  const displaySettings = inWorkbench ? (
    <>
      <label className="mbc-control-row"><span>Layout</span>{layoutSelect}</label>
      <div className="mbc-check-row">
        <label className="mbc-check-row">{supportBox}<span>Support ≥</span></label>
        {supportCutoff}
      </div>
      <label className="mbc-check-row">{lengthsBox}<span>Branch lengths</span></label>
      {isTimetree && <label className="mbc-check-row">{agesBox}<span>Node ages</span></label>}
      <label className="mbc-control-row"><span>Font</span>{fontSelect}</label>
    </>
  ) : (
    <div className="mbc-tree-toolbar" role="toolbar" aria-label="Tree display">
      <label>Layout{' '}{layoutSelect}</label>
      <label>{supportBox} Support ≥</label>
      {supportCutoff}
      <label>{lengthsBox} Branch lengths</label>
      {isTimetree && <label>{agesBox} Node ages</label>}
      <label>Font{' '}{fontSelect}</label>
    </div>
  );

  return (
    <div className="mbc-imported-tree-viewer mbc-tree-explorer">
      <div className="studio-card-header">
        <h3>{doc.name}</h3>
        <InspectorSection title="Tree Display" order={1}>{displaySettings}</InspectorSection>
      </div>
      <div className="mbc-tree-toolbar" role="toolbar" aria-label="Tree edits">
        <input type="search" aria-label="Find taxa" placeholder="Find taxa…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ width: 130 }} />
        <button type="button" className="mbc-btn" onClick={() => edit((t) => ladderize(t, true))}>Ladderize ↑</button>
        <button type="button" className="mbc-btn" onClick={() => edit((t) => ladderize(t, false))}>Ladderize ↓</button>
        <button type="button" className="mbc-btn" disabled={!lengths} onClick={() => edit(midpointRoot)}>Midpoint root</button>
        <button type="button" className="mbc-btn" disabled={history.length < 2} onClick={() => { setHistory((h) => h.slice(0, -1)); setSelected(null); }}>Undo</button>
        <button type="button" className="mbc-btn" disabled={!dirty} onClick={() => {
          try { setHistory([parseNewick(original)]); } catch { /* keep */ }
          setDisplay(readDisplay(doc)); setDisplayDirty(false); setSelected(null);
        }}>Revert</button>
        {onUpdateDocument && <button type="button" className="mbc-btn mbc-btn-primary" disabled={!dirty} onClick={save}>Save changes</button>}
        <span className="mbc-tree-toolbar-sep" />
        {onDownload && <button type="button" className="mbc-btn" onClick={() => onDownload(toNewick(tree), `${doc.name}.nwk`, 'text/plain;charset=utf-8')}>Export Newick</button>}
        <FigureExportButton
          compact
          targetRef={canvasRef}
          baseName={`${doc.name} — Tree`}
          title={`${doc.name} — phylogenetic tree`}
          table={{
            headers: ['Node', 'Label', 'Branch length', 'Support', 'Depth', 'Tips', 'Tip'],
            rows: layout.nodes.map((n) => [
              n.path,
              n.label,
              n.length === null ? '' : String(n.length),
              n.support === null ? '' : String(n.support),
              String(n.depth),
              String(n.tips),
              n.isTip ? 'yes' : 'no',
            ]),
            caption: `${doc.name} — ${tips.length} tips, ${layout.nodes.length - tips.length} internal nodes`,
          }}
        />
      </div>
      {selectedNode && selected !== null && (
        <div className="mbc-tree-node-bar" role="region" aria-label="Selected node">
          <strong>{selectedNode.children.length ? `Clade of ${tipNames(selectedNode).length} taxa` : selectedNode.name}</strong>
          {selected !== '' && <button type="button" className="mbc-btn" onClick={() => edit((t) => rootOnPath(t, selected))}>Root on this branch</button>}
          {selectedNode.children.length > 1 && <button type="button" className="mbc-btn" onClick={() => edit((t) => flipAt(t, selected))}>Flip</button>}
          {selectedNode.children.length > 0 && selected !== '' && (
            <button type="button" className="mbc-btn" onClick={() => {
              const k = cladeKey(selectedNode);
              setD({ compressed: display.compressed.includes(k) ? display.compressed.filter((x) => x !== k) : [...display.compressed, k] });
            }}>{display.compressed.includes(cladeKey(selectedNode)) ? 'Expand' : 'Compress'}</button>
          )}
          <span className="mbc-tree-swatches" aria-label="Colour">
            {SWATCHES.map((c) => (
              <button key={c} type="button" aria-label={`Colour ${c}`} style={{ background: c }} onClick={() => setD({ colors: { ...display.colors, [cladeKey(selectedNode)]: c } })} />
            ))}
            <button type="button" className="mbc-btn mbc-btn-ghost" onClick={() => { const { [cladeKey(selectedNode)]: _drop, ...rest } = display.colors; void _drop; setD({ colors: rest }); }}>No colour</button>
          </span>
          {!selectedNode.children.length && (
            <span className="prefs-row">
              <input aria-label="New tip name" value={renameText} onChange={(e) => setRenameText(e.target.value)} style={{ width: 140 }} />
              <button type="button" className="mbc-btn" disabled={!renameText.trim() || renameText.trim() === selectedNode.name}
                onClick={() => edit((t) => renameAt(t, selected, renameText.trim()))}>Rename</button>
            </span>
          )}
          <button type="button" className="mbc-btn mbc-btn-ghost" onClick={() => setSelected(null)}>Close</button>
        </div>
      )}
      <p>{tips.length} tips shown · {layout.nodes.length - tips.length} internal nodes · {String(doc.docMetadata?.['Source Format'] ?? 'Imported')} tree · click a branch or node for actions</p>
      <div ref={canvasRef} className="mbc-imported-tree-canvas">
        <svg ref={svgRef} viewBox={`0 0 ${layout.width} ${layout.height + (layout.scale > 0 && !circularLike ? 34 : 0)}`}
          style={{ maxWidth: circularLike ? Math.max(480, layout.width) : undefined, fontSize: display.fontSize }}
          role="img" aria-label={`Phylogenetic tree ${doc.name}`}>
          {layout.branches.map((b) => {
            const nodePath = b.path.replace(/#v$/, '');
            const color = colorOfPath.get(nodePath);
            const sel = selected !== null && (nodePath === selected || nodePath.startsWith(selected ? `${selected}.` : '')) && selected !== '';
            return (
              <g key={b.path}>
                <path d={b.d} fill="none" stroke={color ?? 'currentColor'} strokeWidth={sel ? 2.6 : 1.5} />
                {!b.path.endsWith('#v') && (
                  <path d={b.d} fill="none" stroke="transparent" strokeWidth={10} style={{ cursor: 'pointer' }}
                    onClick={() => { setSelected(b.path); setRenameText(nodeAt(tree, b.path)?.name ?? ''); }}>
                    <title>Select this branch</title>
                  </path>
                )}
                {display.showLengths && b.length !== null && !b.path.endsWith('#v') && (
                  <text x={b.mx} y={b.my - 4} textAnchor="middle" className="mbc-tree-support" style={labelSize}>{fmtLen(b.length)}</text>
                )}
              </g>
            );
          })}
          {layout.nodes.map((n) => {
            const color = colorOfPath.get(n.path);
            if (n.triangle) {
              return (
                <g key={`t${n.path}`} onClick={() => setSelected(n.path)} style={{ cursor: 'pointer' }}>
                  <path d={n.triangle} fill={color ?? 'currentColor'} fillOpacity={0.25} stroke={color ?? 'currentColor'} />
                </g>
              );
            }
            return null;
          })}
          {layout.nodes.filter((n) => !n.isTip).map((n) => (
            <g key={`c${n.path}`} style={{ cursor: 'pointer' }} onClick={() => setSelected(n.path)}>
              <circle cx={n.x} cy={n.y} r={9} fill="transparent" />
              <circle cx={n.x} cy={n.y} r={selected === n.path ? 4.5 : 2.5} fill={selected === n.path ? '#2f7de1' : 'currentColor'} fillOpacity={selected === n.path ? 1 : 0.35} />
              <title>Select this node</title>
            </g>
          ))}
          {tips.map((n) => {
            const color = colorOfPath.get(n.path);
            const hit = query && n.label.toLowerCase().includes(query);
            let x = n.x + 5;
            let y = n.y;
            let anchor: 'start' | 'end' = 'start';
            let rotate = 0;
            if (n.triangle) {
              const m = /L([\d.-]+),([\d.-]+) L([\d.-]+),([\d.-]+)/.exec(n.triangle);
              if (m) { x = Math.max(Number(m[1]), Number(m[3])) + 5; y = (Number(m[2]) + Number(m[4])) / 2; }
            }
            if (circularLike) {
              const a = n.angle;
              const flip = Math.cos((a * Math.PI) / 180) < 0;
              x = n.x + 5 * Math.cos((a * Math.PI) / 180);
              y = n.y + 5 * Math.sin((a * Math.PI) / 180);
              anchor = flip ? 'end' : 'start';
              rotate = flip ? a + 180 : a;
            }
            return (
              <text key={`l${n.path}`} x={x} y={y} textAnchor={anchor} dominantBaseline="middle"
                transform={rotate ? `rotate(${rotate} ${x} ${y})` : undefined}
                fill={color} fontWeight={hit || selected === n.path ? 700 : undefined}
                style={{ ...labelSize, cursor: 'pointer', textDecoration: hit ? 'underline' : undefined }}
                onClick={() => { setSelected(n.path); setRenameText(n.label); }}>
                {hit ? `▶ ${n.label}` : n.label}
              </text>
            );
          })}
          {display.showSupport && layout.nodes.filter((n) => !n.isTip && n.support !== null && n.support >= display.supportCutoff).map((n) => (
            <text key={`s${n.path}`} x={n.x + 3} y={n.y - 5} className="mbc-tree-support" style={smallSize}>{n.support}</text>
          ))}
          {isTimetree && display.showAges && layout.nodes.filter((n) => !n.isTip).map((n) => (
            <text key={`a${n.path}`} x={n.x + 3} y={n.y + 11} className="mbc-tree-support" style={smallSize}>{fmtLen(ageOf(n.depth))}</text>
          ))}
          {scaleBar > 0 && !circularLike && (
            <g transform={`translate(${layout.originX}, ${layout.height + 12})`}>
              <path d={`M0,0 H${scaleBar * layout.scale}`} stroke="currentColor" strokeWidth={1.5} />
              <text x={(scaleBar * layout.scale) / 2} y={16} textAnchor="middle" className="mbc-tree-support" style={labelSize}>{fmtLen(scaleBar)}</text>
            </g>
          )}
          {isTimetree && layout.scale > 0 && !circularLike && (() => {
            const step = niceLength(layout.maxDepth / 6);
            const ticks: number[] = [];
            for (let a = 0; a <= layout.maxDepth + 1e-9 && step > 0; a += step) ticks.push(a);
            const xOfAge = (a: number) => layout.originX + (layout.maxDepth - a) * layout.scale;
            return (
              <g transform={`translate(0, ${layout.height + 6})`}>
                <path d={`M${xOfAge(layout.maxDepth)},0 H${xOfAge(0)}`} stroke="currentColor" />
                {ticks.map((a) => (
                  <g key={a}>
                    <path d={`M${xOfAge(a)},0 V5`} stroke="currentColor" />
                    <text x={xOfAge(a)} y={18} textAnchor="middle" className="mbc-tree-support" style={labelSize}>{String(Number(a.toPrecision(6)))}</text>
                  </g>
                ))}
                <text x={xOfAge(0) + 14} y={18} className="mbc-tree-support" style={labelSize}>{timeUnit || 'time'}</text>
              </g>
            );
          })()}
        </svg>
      </div>
      <details>
        <summary>Newick source</summary>
        <pre>{toNewick(tree)}</pre>
      </details>
    </div>
  );
};
