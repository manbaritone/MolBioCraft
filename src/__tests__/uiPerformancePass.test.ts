// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Regression guards for the UI/UX + performance pass documented in
 * MOLBIOCRAFT_UI_UX_PERFORMANCE_REPORT.md. These assert the structural contracts that keep the
 * measured wins in place (font payload, non-inherited splitter variables, observer stability,
 * gated pairwise compute) rather than pixel output.
 */

import { describe, expect, it } from 'vitest';
import appSrc from '../App.tsx?raw';
import stripSrc from '../components/ScrollableMenuStrip.tsx?raw';
import alignSrc from '../components/AlignmentAndPhyloStudio.tsx?raw';
import mapSrc from '../components/CircularPlasmidMap.tsx?raw';
import viewer3dSrc from '../components/ProteinStructure3DViewer.tsx?raw';
import viteConfigSrc from '../../vite.config.ts?raw';
import { analyzeProteinSequence, invertSequenceCoordinates } from '../core/bioEngine';

// CSS `?raw` imports are stubbed by Vitest's CSS handling, so read the stylesheet from disk.
const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as {
  readFileSync: (p: URL, enc: string) => string;
  existsSync: (p: URL) => boolean;
  statSync: (p: URL) => { size: number };
};
const appCss = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');

describe('UI/UX performance pass regression guards', () => {
  it('bundles subset WOFF2 UI fonts instead of multi-megabyte TTF masters', () => {
    const { existsSync, statSync } = nodeFs;
    const fontUrls = [...appCss.matchAll(/url\('(\.\/assets\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
    // The faces App.css declares (D0080): Google Sans and Google Sans Code, upright and italic, one
    // variable file per style; Space Grotesk's variable file; and Poppins' five static weights.
    expect(fontUrls.length).toBeGreaterThanOrEqual(10);
    for (const rel of fontUrls) {
      expect(rel.endsWith('.subset.woff2')).toBe(true);
      const url = new URL(`../${rel.slice(2)}`, import.meta.url);
      expect(existsSync(url)).toBe(true);
      // Every subset face should stay well under 100 KB (TTF masters were up to 2.1 MB each).
      expect(statSync(url).size).toBeLessThan(100_000);
    }
    expect(appCss).not.toMatch(/format\('truetype'\)/);
  });

  it('registers splitter geometry variables as non-inherited and sets them on consumers', () => {
    for (const name of ['--mbc-sidebar-width', '--mbc-doc-table-h', '--mbc-split-left-w']) {
      expect(appCss).toMatch(new RegExp(`@property ${name} \\{[^}]*inherits: false`));
    }
    expect(appSrc).toContain("style={sidebarOpen ? sidebarWidthVarStyle : undefined}");
    expect(appSrc).toContain("style={{ '--mbc-doc-table-h': `${docTableHeightPx}px` } as React.CSSProperties}");
  });

  it('coalesces splitter drags to animation frames and commits React state on release', () => {
    expect(appSrc).toContain("el.style.setProperty('--mbc-sidebar-width', value)");
    expect(appSrc).toContain("el.style.setProperty('--mbc-inspector-width', value)");
    expect(appSrc).toMatch(/if \(raf === 0\) raf = requestAnimationFrame\(apply\);/);
    expect(appSrc).not.toMatch(/const onMove = \(ev: PointerEvent\) => \{[^}]*setSidebarWidthPx\(nextW\)/);
    expect(appSrc).not.toMatch(/const onMove = \(ev: PointerEvent\) => \{[^}]*setInspectorWidthPx\(nextW\)/);

    // Geometry is written to storage once the drag settles, never per frame: every
    // splitter's dragging flag must gate the persistence effect.
    expect(appSrc).toMatch(
      /if \(sidebarDragging \|\| inspectorDragging \|\| workspacePaneDragging\) return;\s*savePersistedWorkspaceLayout\(\{/
    );
    for (const key of [
      'sidebarWidthPx',
      'inspectorWidthPx',
      'docTableHeightPx',
      'docTableWidthPx',
    ]) {
      expect(appSrc).toContain(key);
    }
  });

  it('installs ScrollableMenuStrip observers once instead of on every parent render', () => {
    expect(stripSrc).toContain('}, [syncScrollMetrics]);');
    expect(stripSrc).not.toContain('}, [syncScrollMetrics, children]);');
  });

  it('only runs pairwise DP when the Pairwise sub-mode is visible', () => {
    expect(alignSrc).toContain("const pairwiseVisible = alignSubMode === 'pairwise';");
    expect(alignSrc).toMatch(/const pairwiseRes = useMemo\(\(\) => \{\s*if \(!pairwiseVisible\) return null;/);
  });

  it('drops the duplicate raw WASM copy from build output', () => {
    expect(viteConfigSrc).toContain("path.join(resolvedOutDir, 'molbiocraft_wasm.wasm')");
  });

  it('wires setStatusBanner to a live aria-live status toast and removes blocking window.prompt calls', () => {
    expect(appSrc).not.toContain('const setStatusBanner = (_message: string | null): void => {};');
    expect(appSrc).toContain('const [statusBanner, setStatusBannerState] = useState<string | null>(null);');
    expect(appSrc).toContain('className="statusbar-toast-pill"');
    expect(appSrc).toContain('aria-live="polite"');
    expect(appSrc).not.toMatch(/\bwindow\.prompt\s*\(/);
  });

  it('inverts feature and primer coordinates on Reverse Complement and Reverse-Only transforms', () => {
    const invertedRc = invertSequenceCoordinates(
      {
        features: [
          {
            id: 'f1',
            name: 'T7_promoter',
            type: 'promoter',
            start: 101,
            end: 120,
            strand: 1,
            color: '#0072B2',
            segments: [
              { index: 1, name: 'Exon 1', start: 101, end: 108, color: '#0072B2' },
              { index: 2, name: 'Exon 2', start: 112, end: 120, color: '#0072B2' },
            ],
          },
        ],
        primers: [
          {
            id: 'p1',
            name: 'Fwd_1',
            sequence: 'ATGCATGCATGCATGCATGC',
            annealSequence: 'ATGCATGCATGCATGCATGC',
            tail5Prime: '',
            bindStart: 50,
            bindEnd: 69,
            strand: 1,
            length: 20,
            gcPercent: 50,
            tmAnnealC: 60,
            tmFullC: 60,
            deltaG37: -24,
            hairpinDeltaG: 0,
            selfDimerDeltaG: -2,
            gcClamp3Prime: true,
          },
        ],
      },
      1000,
      true
    );
    expect(invertedRc.features[0].start).toBe(881);
    expect(invertedRc.features[0].end).toBe(900);
    expect(invertedRc.features[0].strand).toBe(-1);
    expect(invertedRc.features[0].segments?.[0]).toMatchObject({
      index: 1,
      start: 881,
      end: 889,
    });
    expect(invertedRc.features[0].segments?.[1]).toMatchObject({
      index: 2,
      start: 893,
      end: 900,
    });
    expect(invertedRc.primers[0]).toMatchObject({
      bindStart: 932,
      bindEnd: 951,
      strand: -1,
    });

    const invertedRevOnly = invertSequenceCoordinates(
      {
        features: invertedRc.features,
        primers: invertedRc.primers,
      },
      1000,
      false
    );
    expect(invertedRevOnly.features[0].start).toBe(101);
    expect(invertedRevOnly.features[0].end).toBe(120);
    expect(invertedRevOnly.features[0].strand).toBe(-1);
  });

  it('computes full-length protein molecular weight without 1,200-residue truncation', () => {
    expect(appSrc).not.toContain('activeDoc.sequence.slice(0, 1200)');
    const shortProtein = analyzeProteinSequence('ACDEFGHIKLMNPQRSTVWY'.repeat(60), false, 9);
    const fullProtein = analyzeProteinSequence('ACDEFGHIKLMNPQRSTVWY'.repeat(500), false, 9);
    expect(fullProtein.lengthAa).toBe(10000);
    expect(fullProtein.molecularWeightKda).toBeGreaterThan(shortProtein.molecularWeightKda * 7);
  });

  it('guards pointer drags against secondary pointers, lostpointercapture, and window blur', () => {
    expect(appSrc).toContain("window.addEventListener('lostpointercapture', onUp);");
    expect(appSrc).toContain("window.addEventListener('blur', onBlur);");
    expect(appSrc).toContain('ev.pointerId !== sidebarDragRef.current.pointerId');
    expect(mapSrc).toContain('onLostPointerCapture=');
    expect(mapSrc).toContain('e.pointerId !== dragStateRef.current.pointerId');
    expect(viewer3dSrc).toContain('onPointerCancel={handlePointerCancel}');
    expect(viewer3dSrc).toContain('onLostPointerCapture={handleLostPointerCapture}');
  });
});
