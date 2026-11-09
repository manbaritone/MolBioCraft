// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Regression (BG-01M6S1QP): calling variants on a sample of about 40 kb trapped the WASM engine
 * ('RuntimeError: unreachable'), and the Genomics variants tab makes that call while it renders.
 *
 * The caller aligned the whole sample in one rust-bio banded alignment, whose traceback is the
 * full (|sample| + 1) x (|window| + 1) matrix of two-byte cells: for a sample the length of its
 * reference, past 32,766 bp that is one request over the 2 GiB a wasm32 engine can allocate. This
 * runs the built engine (public/molbiocraft_wasm.wasm) on samples of 40 kb and 100 kb, in a fresh
 * instance and through the wrapper the tab calls; and, since the first fix aligned long samples in
 * blocks whose cuts invented and dropped variants at indels of about 300 bp and more, on a 40 kb
 * sample with 500- to 2,000-bp insertions and deletions.
 */

import { describe, expect, it } from 'vitest';
import { callFreeBayesVariants, type FreeBayesVariantReport } from '../core/genomicsAndStructureSuite';

const nodeFsModName = 'node:fs';
const nodeFs = (await import(/* @vite-ignore */ nodeFsModName)) as {
  readFileSync: (p: URL) => Uint8Array<ArrayBuffer>;
};
const engine = new WebAssembly.Module(
  nodeFs.readFileSync(new URL('../../public/molbiocraft_wasm.wasm', import.meta.url))
);

interface EngineExports {
  memory: WebAssembly.Memory;
  mbc_wasm_scratch_ptr: (minCap: number) => number;
  mbc_wasm_invoke_scratch: (opLen: number, payloadLen: number) => number;
  mbc_wasm_last_len: () => number;
  mbc_wasm_last_is_err: () => number;
}

type Outcome =
  | { kind: 'report'; report: FreeBayesVariantReport; memoryBytes: number }
  | { kind: 'error' | 'trap'; message: string };

/** Invokes `op` in a fresh, synchronously instantiated engine, as the build's smoke test does. */
function invokeInFreshEngine(op: string, payload: unknown): Outcome {
  const exp = new WebAssembly.Instance(engine, {}).exports as unknown as EngineExports;
  const enc = new TextEncoder();
  const opBytes = enc.encode(op);
  const body = enc.encode(JSON.stringify(payload));
  try {
    const ptr = exp.mbc_wasm_scratch_ptr(opBytes.length + body.length);
    const mem = new Uint8Array(exp.memory.buffer);
    mem.set(opBytes, ptr);
    mem.set(body, ptr + opBytes.length);
    const out = exp.mbc_wasm_invoke_scratch(opBytes.length, body.length);
    const text = new TextDecoder().decode(new Uint8Array(exp.memory.buffer, out, exp.mbc_wasm_last_len()));
    if (exp.mbc_wasm_last_is_err() !== 0) return { kind: 'error', message: text };
    return { kind: 'report', report: JSON.parse(text) as FreeBayesVariantReport, memoryBytes: exp.memory.buffer.byteLength };
  } catch (e) {
    if (e instanceof WebAssembly.RuntimeError) return { kind: 'trap', message: String(e) };
    throw e;
  }
}

/** Deterministic pseudo-random DNA: the same LCG and seed handling as the Rust test. */
function genome(len: number, seed: bigint): string {
  const mask = (1n << 64n) - 1n;
  let x = seed;
  const out: string[] = new Array(len);
  for (let i = 0; i < len; i++) {
    x = (x * 6364136223846793005n + 1442695040888963407n) & mask;
    out[i] = 'ACGT'[Number((x >> 33n) % 4n)];
  }
  return out.join('');
}

const TRANSITION: Record<string, string> = { A: 'G', G: 'A', C: 'T', T: 'C' };
const otherThan = (b: string): string => (b === 'A' ? 'C' : 'A');

type Call = [position: number, ref: string, alt: string, type: string];

/** The long indels: wider than the engine's alignment band (64) on either side of its k-mer chain. */
const LONG_INDEL = 150;

/**
 * A reference of `len` bases and a sample with an edit every 997 bases (SNPs, 3- and 150-bp
 * deletions, 2- and 150-bp insertions) and a last 150-bp deletion 400 bases from the end, each
 * indel placed where it cannot slide, with the VCF call each must produce. Each long deletion but
 * the last is followed by a long insertion of the same length, so the sample's net deletion stays
 * under the 200 reference bases the caller's window runs past its mapped end.
 */
function planted(len: number, seed: bigint): { reference: string; sample: string; calls: Call[] } {
  const r = genome(len, seed);
  const filler = genome(len, seed ^ 0xa5a5n);
  let used = 0;
  const parts: string[] = [];
  const calls: Call[] = [];
  let copied = 0;
  /** Deletes `l` bases at or after `p` where the deletion cannot slide; returns where it starts. */
  const del = (p: number, l: number): number => {
    let q = p;
    while (r[q - 1] === r[q + l - 1] || r[q] === r[q + l]) q++;
    parts.push(r.slice(p, q));
    copied = q + l;
    calls.push([q, r.slice(q - 1, q + l), r[q - 1], 'DEL']);
    return q;
  };
  for (let p = 150, n = 0; p + 700 < len; p += 997, n++) {
    parts.push(r.slice(copied, p));
    const kind = n % 6 === 5 ? (n % 12 === 5 ? 'long-del' : 'long-ins') : n % 6;
    if (kind === 1 || kind === 'long-del') {
      del(p, kind === 1 ? 3 : LONG_INDEL);
    } else if (kind === 3 || kind === 'long-ins') {
      const middle = kind === 3 ? '' : filler.slice(used, (used += LONG_INDEL - 2));
      const ins = otherThan(r[p]) + middle + otherThan(r[p - 1]);
      parts.push(ins);
      copied = p;
      calls.push([p, r[p - 1], r[p - 1] + ins, 'INS']);
    } else {
      parts.push(TRANSITION[r[p]]);
      copied = p + 1;
      calls.push([p + 1, r[p], TRANSITION[r[p]], 'SNP']);
    }
  }
  parts.push(r.slice(copied, len - 400));
  del(len - 400, LONG_INDEL);
  parts.push(r.slice(copied));
  return { reference: r, sample: parts.join(''), calls };
}

/** What the engine's memory may reach on one call: one alignment of a whole 32 kb sample would keep 2 GB of traceback. */
const MEMORY_BOUND_BYTES = 128 * 1024 * 1024;

type Edit = { snp: number } | { ins: number; len: number } | { del: number; len: number };

/**
 * A reference of `len` bases and a sample copying it with `edits` (in order, apart; 0-based
 * reference positions) made, with the VCF call each edit must produce. Every indel is made where it
 * cannot slide: an inserted run's first and last bases differ from the reference bases after and
 * before it, and a deleted run's own end bases are set to differ from the bases beside it.
 */
function plantEdits(len: number, seed: bigint, edits: Edit[]): { reference: string; sample: string; calls: Call[] } {
  const r = genome(len, seed).split('');
  for (const e of edits) {
    if (!('del' in e)) continue;
    const { del: p, len: n } = e;
    if (r[p + n - 1] === r[p - 1]) r[p + n - 1] = otherThan(r[p - 1]);
    if (r[p] === r[p + n]) r[p] = otherThan(r[p + n]);
  }
  const filler = genome(len, seed ^ 0x1d3n);
  let used = 0;
  const parts: string[] = [];
  const calls: Call[] = [];
  let copied = 0;
  for (const e of edits) {
    if ('snp' in e) {
      parts.push(r.slice(copied, e.snp).join(''));
      const alt = TRANSITION[r[e.snp]];
      parts.push(alt);
      copied = e.snp + 1;
      calls.push([e.snp + 1, r[e.snp], alt, 'SNP']);
    } else if ('ins' in e) {
      const p = e.ins;
      parts.push(r.slice(copied, p).join(''));
      const ins = otherThan(r[p]) + filler.slice(used, (used += e.len - 2)) + otherThan(r[p - 1]);
      parts.push(ins);
      copied = p;
      calls.push([p, r[p - 1], r[p - 1] + ins, 'INS']);
    } else {
      const p = e.del;
      parts.push(r.slice(copied, p).join(''));
      copied = p + e.len;
      calls.push([p, r.slice(p - 1, p + e.len).join(''), r[p - 1], 'DEL']);
    }
  }
  parts.push(r.slice(copied).join(''));
  return { reference: r.join(''), sample: parts.join(''), calls };
}

/**
 * 500-, 1,000- and 2,000-bp insertions, and deletions of those lengths each followed by an insertion
 * of the same length that keeps the sample in step with its reference window, with SNPs between.
 * Each indel has more matched bases on each side of it, up to the next edit, than its own length
 * (the caller's 11-mer chain bridges an indel only where the matched bases beside it outscore its
 * gap), and a deletion's insertion is more than 1.2 x its length on: the shapes variant_caller_crash
 * checks against an exact alignment of the same pair.
 */
const LONG_INDELS: Edit[] = [
  { snp: 1_000 },
  { ins: 3_000, len: 500 },
  { snp: 5_000 },
  { del: 7_000, len: 1_000 },
  { ins: 9_400, len: 1_000 },
  { snp: 11_900 },
  { ins: 14_000, len: 2_000 },
  { snp: 17_500 },
  { del: 20_000, len: 2_000 },
  { ins: 24_600, len: 2_000 },
  { snp: 28_000 },
  { del: 30_000, len: 500 },
  { ins: 31_300, len: 500 },
  { ins: 34_000, len: 1_000 },
  { snp: 38_500 },
];

describe('variant calling in the WASM engine (BG-01M6S1QP)', () => {
  it('returns a report from the wasm engine at 40 kb and 100 kb', () => {
    for (const [len, seed] of [
      [40_000, 0x5eed0040n],
      [100_000, 0x5eed0100n],
    ] as const) {
      const { reference, sample, calls } = planted(len, seed);
      const payload = { refName: 'ref', refSeq: reference, sampleSeq: sample };
      const outcome = invokeInFreshEngine('call_freebayes_variants', payload);
      if (outcome.kind !== 'report') throw new Error(`${len} bp: the engine returned a ${outcome.kind}: ${outcome.message}`);
      const got = outcome.report.variants.map((v): Call => [v.positionBp, v.refAllele, v.altAllele, v.variantType]);
      expect(got, `${len} bp`).toEqual(calls);
      expect(outcome.report.totalVariants, `${len} bp`).toBe(calls.length);
      expect(outcome.memoryBytes, `${len} bp: engine memory`).toBeLessThanOrEqual(MEMORY_BOUND_BYTES);
      // the Genomics variants tab calls the engine through this wrapper while it renders
      expect(callFreeBayesVariants('ref', reference, sample).variants, `${len} bp via the wrapper`).toEqual(
        outcome.report.variants
      );
    }
  }, 60_000);

  it('calls 500- to 2,000-bp insertions and deletions in a 40 kb sample where they were planted', () => {
    const { reference, sample, calls } = plantEdits(40_000, 0x5eed0400n, LONG_INDELS);
    const outcome = invokeInFreshEngine('call_freebayes_variants', { refName: 'ref', refSeq: reference, sampleSeq: sample });
    if (outcome.kind !== 'report') throw new Error(`the engine returned a ${outcome.kind}: ${outcome.message}`);
    const got = outcome.report.variants.map((v): Call => [v.positionBp, v.refAllele, v.altAllele, v.variantType]);
    expect(got).toEqual(calls);
    expect(outcome.report.totalVariants).toBe(calls.length);
    expect(outcome.memoryBytes, 'engine memory').toBeLessThanOrEqual(MEMORY_BOUND_BYTES);
    expect(callFreeBayesVariants('ref', reference, sample).variants, 'via the wrapper').toEqual(outcome.report.variants);
  }, 60_000);
});
