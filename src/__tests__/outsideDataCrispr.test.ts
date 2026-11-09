// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * CRISPR editing analysis against Synthego ICE 1.2 on its own test traces
 * (`scripts/outside-data/ref_ice.py`). Skipped without test-data.
 */

import { describe, expect, it } from 'vitest';
import { parseDnaBinaryPacket } from '../core/fileParsers';
import { analyzeEditing } from '../core/crisprEditing';
import { dataPath, haveTestData } from './testData';

interface NodeFs { existsSync: (p: string) => boolean; readFileSync: (p: string) => Uint8Array & { buffer: ArrayBuffer; byteOffset: number; byteLength: number } }
let fs: NodeFs | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
const REF = dataPath('reference/ice.json');
const have = haveTestData(REF, 'synthego-ice');

describe.skipIf(!have)('CRISPR editing against Synthego ICE', () => {
  it('ICE-compatible editing score, R² and HDR match ICE on its test traces', () => {
    const R = JSON.parse(new TextDecoder().decode(fs!.readFileSync(REF)));
    const load = (n: string) => { const b = fs!.readFileSync(dataPath(`synthego-ice/${n}.ab1`)); return parseDnaBinaryPacket(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength), `${n}.ab1`).chromatogram!; };
    const report: string[] = [];
    for (const [name, c] of Object.entries(R) as [string, { control: string; edited: string; guide: string; donor: string | null; ice: number; hdr_pct: number; indels: { r_sq: number; editing_outcomes: Record<string, number> } }][]) {
      const r = analyzeEditing(load(c.control), load(c.edited), { guide: c.guide.replace(/U/g, 'T'), cutIndex: -1, maxIndel: 20, window: 100, donor: c.donor ?? undefined });
      const top = Object.entries(c.indels.editing_outcomes).filter(([k]) => k !== '0').sort((a, b) => b[1] - a[1])[0][0];
      const appTop = [...r.ice.spectrum].filter((x) => x.indel !== 0).sort((a, b) => b.pct - a.pct)[0].indel;
      const line = `${name}: app ${r.ice.editingPct.toFixed(1)}% (R² ${r.ice.rSquared.toFixed(3)}${r.ice.hdrPct !== undefined ? `, HDR ${r.ice.hdrPct.toFixed(1)}` : ''}; top indel ${appTop}) vs ICE ${c.ice}% (R² ${c.indels.r_sq}${c.donor ? `, HDR ${c.hdr_pct}` : ''}; top ${top})`;
      report.push(line);
      const bad = Math.abs(r.ice.editingPct - c.ice) > 5 || Math.abs(r.ice.rSquared - c.indels.r_sq) > 0.03 || (c.donor && Math.abs((r.ice.hdrPct ?? 0) - c.hdr_pct) > 9) || String(appTop) !== top;
      if (bad) report.push(`  ↑ outside tolerance`);
    }
    console.log('ICE\n' + report.join('\n'));
    expect(report.filter((l) => l.includes('outside tolerance')), report.join('\n')).toEqual([]);
  });
});
