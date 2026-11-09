// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Trace files the tests write themselves, so the trace readers are checked without a vendor
 * sample. The writers are test code, built from the published layouts: SCF v3.00 from the Staden
 * package's io_lib (`scf.h`, `write_scf.c`) and ABIF v1.01 from Applied Biosystems' "ABIF File
 * Format Specification". The Rust copies are in crates/molbiocraft-formats/tests/real_resource_files.rs.
 */

import type { ChromatogramData } from '../types/bio';

/** A seeded 32-bit generator (mulberry32): the same numbers on every run. */
function seeded(seed: number): (n: number) => number {
  let a = seed >>> 0;
  return (n: number) => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) % n);
  };
}

/**
 * A seeded chromatogram of `calls` calls. Peaks lie 8 to 16 samples apart, drawn from the seed, so
 * the spacing is irregular. Each call peaks in its own channel, 385 to 1300 high; the calls `mixed`
 * picks (0-based) also carry a second peak half as tall in the next channel, a mixed call. The
 * four channels have different baselines (under 60) and gains, so no two carry the same signal
 * and a reader that swaps two channels returns values other than the ones written; and only the
 * mixed calls have a second channel at 35% or more of the first. Qualities run from Q2 to Q60.
 * Samples are whole numbers, as both formats store them.
 */
export function seededChromatogram(seed: number, calls: number, mixed: (i: number) => boolean = () => false): ChromatogramData {
  const rnd = seeded(seed);
  const baseCalls = Array.from({ length: calls }, () => 'ACGT'[rnd(4)]).join('');
  const peakLocations: number[] = [];
  let at = 12;
  for (let i = 0; i < calls; i++) {
    peakLocations.push(at);
    at += 8 + rnd(9);
  }
  const length = at + 12;
  const baseline = [11, 23, 37, 53];
  const gain = [900, 1150, 700, 1300];
  const traces = baseline.map((b) => Array.from({ length }, () => b + rnd(7)));
  for (let i = 0; i < calls; i++) {
    const k = 'ACGT'.indexOf(baseCalls[i]);
    const height = (55 + rnd(45)) / 100;
    const p = peakLocations[i];
    const top = gain[k] * height;
    for (let x = p - 8; x <= p + 8; x++) {
      const shape = Math.exp(-((x - p) ** 2) / 6);
      traces[k][x] += top * shape;
      if (mixed(i)) traces[(k + 1) % 4][x] += (top / 2) * shape;
    }
  }
  const [traceA, traceC, traceG, traceT] = traces.map((t) => t.map(Math.round));
  return { traceA, traceC, traceG, traceT, peakLocations, phredScores: Array.from({ length: calls }, () => 2 + rnd(59)), baseCalls };
}

/** A growing big-endian byte buffer. */
class Bytes {
  readonly out: number[] = [];
  u8(v: number) { this.out.push(v & 0xff); }
  u16(v: number) { this.u8(v >>> 8); this.u8(v); }
  u32(v: number) { this.u16(v >>> 16); this.u16(v); }
  text(s: string) { for (const ch of s) this.u8(ch.charCodeAt(0)); }
  pad(to: number) { while (this.out.length < to) this.u8(0); }
  buffer(): ArrayBuffer { return new Uint8Array(this.out).buffer; }
}

/**
 * `c` as an SCF v3.00 file: the 128-byte header; the samples of channel A, then C, G and T, as
 * 16-bit values delta-encoded twice; the bases block (the peak indexes, the A, C, G and T
 * probability arrays, the calls, then three spare bytes per call); and a `NAME=` comment. A call's
 * quality is its own channel's probability, and all four channels' for a call other than A, C, G or T.
 */
export function scfV3Bytes(c: ChromatogramData, name: string): ArrayBuffer {
  const channels = [c.traceA, c.traceC, c.traceG, c.traceT];
  const samples = c.traceA.length;
  if (!channels.every((t) => t.length === samples)) throw new Error('the writer takes four channels of one length');
  const calls = c.baseCalls.length;
  const comments = `NAME=${name}\n\0`;
  const samplesOffset = 128;
  const basesOffset = samplesOffset + 4 * samples * 2;
  const commentsOffset = basesOffset + 12 * calls;
  const b = new Bytes();
  b.text('.scf');
  for (const v of [samples, samplesOffset, calls, 0, 0, basesOffset, comments.length, commentsOffset]) b.u32(v);
  b.text('3.00');
  for (const v of [2, 0, 0, 0]) b.u32(v); // sample size (bytes), code set, private data size and offset
  b.pad(samplesOffset);
  for (const channel of channels) {
    let v = channel.map((x) => x & 0xffff);
    for (let round = 0; round < 2; round++) v = v.map((x, i) => (x - (i ? v[i - 1] : 0)) & 0xffff);
    for (const x of v) b.u16(x);
  }
  for (const p of c.peakLocations) b.u32(p);
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < calls; i++) {
      const own = 'ACGT'.indexOf(c.baseCalls[i]);
      b.u8(own < 0 || own === k ? c.phredScores[i] : 0);
    }
  }
  b.text(c.baseCalls);
  b.pad(commentsOffset);
  b.text(comments);
  return b.buffer();
}

/** One ABIF directory entry: tag name, tag number, element type, element size, element count and the data. */
export interface AbifTag { name: string; number: number; type: number; size: number; count: number; data: number[] }

/** Text as an ABIF `char` array (element type 2). */
export const abifChars = (name: string, number: number, text: string): AbifTag =>
  ({ name, number, type: 2, size: 1, count: text.length, data: Array.from(text, (ch) => ch.charCodeAt(0)) });

/** Whole numbers as an ABIF `short` array (element type 4, big-endian). */
export const abifShorts = (name: string, number: number, values: number[]): AbifTag =>
  ({ name, number, type: 4, size: 2, count: values.length, data: values.flatMap((v) => [(v >>> 8) & 0xff, v & 0xff]) });

/** Text as an ABIF `pString` (element type 18: a length byte, then the text). */
export const abifPString = (name: string, number: number, text: string): AbifTag =>
  ({ name, number, type: 18, size: 1, count: text.length + 1, data: [text.length, ...Array.from(text, (ch) => ch.charCodeAt(0))] });

/**
 * An ABIF v1.01 file holding these tags: the 128-byte header, whose `tdir` entry points at the
 * directory, then each tag's data (inside its entry when it fits in four bytes), then the
 * directory of 28-byte entries.
 */
export function abifFile(tags: AbifTag[]): ArrayBuffer {
  const body = new Bytes();
  body.pad(128);
  const dir = new Bytes();
  for (const t of tags) {
    dir.text(t.name);
    dir.u32(t.number);
    dir.u16(t.type);
    dir.u16(t.size);
    dir.u32(t.count);
    dir.u32(t.data.length);
    if (t.data.length <= 4) {
      for (let i = 0; i < 4; i++) dir.u8(t.data[i] ?? 0);
    } else {
      dir.u32(body.out.length);
      for (const v of t.data) body.u8(v);
    }
    dir.u32(0); // data handle
  }
  const dirOffset = body.out.length;
  const head = new Bytes();
  head.text('ABIF');
  head.u16(101);
  head.text('tdir');
  head.u32(1);
  head.u16(1023);
  head.u16(28);
  head.u32(tags.length);
  head.u32(dir.out.length);
  head.u32(dirOffset);
  head.out.forEach((v, i) => { body.out[i] = v; });
  body.out.push(...dir.out);
  return body.buffer();
}

/**
 * `c` as an ABIF file with its calls (PBAS 2), peaks (PLOC 2), the four processed channels
 * (DATA 9-12, in the G, A, T, C filter-wheel order FWO_ names) and a sample name (SMPL 1), and no
 * quality values (no PCON tag).
 */
export const abifWithoutQualities = (c: ChromatogramData, sample: string): ArrayBuffer => abifFile([
  abifChars('FWO_', 1, 'GATC'),
  abifChars('PBAS', 2, c.baseCalls),
  abifShorts('PLOC', 2, c.peakLocations),
  abifShorts('DATA', 9, c.traceG),
  abifShorts('DATA', 10, c.traceA),
  abifShorts('DATA', 11, c.traceT),
  abifShorts('DATA', 12, c.traceC),
  abifPString('SMPL', 1, sample),
]);
