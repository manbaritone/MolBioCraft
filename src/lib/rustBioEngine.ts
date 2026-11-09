// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Synchronous Zero-Import Rust WebAssembly (`molbiocraft-wasm`) & Native Tauri v2 (`cmd_rust_bio_invoke`)
 * Bioinformatics Execution Engine.
 *
 * Executes compiled Rust (`rust-bio`, `noodles`, `nalgebra`, `statrs`, `petgraph`, `aho-corasick`)
 * directly via zero-allocation linear-memory scratch buffers in React, Vitest, Vite browser builds,
 * standalone HTML, and native macOS/Windows/Linux desktop shells.
 */

import type {
  ChromatogramData,
  MoleculeType,
  SequenceDocument,
  SequenceFeature,
  Topology,
} from '../types/bio';
import {
  MOLBIOCRAFT_WASM_BASE64,
  MOLBIOCRAFT_WASM_BYTES,
} from 'virtual:molbiocraft-wasm-bytes';

interface MolBioCraftWasmExports {
  memory: WebAssembly.Memory;
  mbc_wasm_scratch_ptr: (minCap: number) => number;
  mbc_wasm_invoke_scratch: (opLen: number, payloadLen: number) => number;
  mbc_wasm_alloc: (size: number) => number;
  mbc_wasm_dealloc: (ptr: number, size: number) => void;
  mbc_wasm_invoke: (
    opPtr: number,
    opLen: number,
    payloadPtr: number,
    payloadLen: number
  ) => number;
  mbc_wasm_last_len: () => number;
  mbc_wasm_last_is_err: () => number;
}

export interface GenomeViewportSlice {
  totalLength: number;
  startPos: number;
  endPos: number;
  topStrand: string;
  bottomStrand: string;
  overlappingFeatureIndices: number[];
  windowGcPercent: number;
}

export interface GenomeTrackOverview {
  sequenceLengthBp: number;
  binCount: number;
  windowBp: number;
  gcFractionBins: number[];
  atFractionBins: number[];
  gcSkewBins: number[];
  cumulativeGcSkewBins: number[];
  shannonEntropyBins: number[];
  predictedOricBp: number;
  predictedTercBp: number;
  meanGcPercent: number;
}

export interface FmIndexSearchHit {
  start: number;
  end: number;
  strand: 1 | -1;
}

export interface AgaroseGelBandPhysics {
  sizeBp: number;
  log10Bp: number;
  migrationMm: number;
  relativeMobilityRf: number;
  diffusionSigmaMm: number;
  relativeFluorescence: number;
}

export interface FastqReadRecord {
  name: string;
  description: string;
  sequence: string;
  phredScores: number[];
  meanPhred: number;
}

export interface FastqParseSummary {
  readCount: number;
  totalBases: number;
  meanReadLength: number;
  meanPhredScore: number;
  q20BasePct: number;
  q30BasePct: number;
  reads: FastqReadRecord[];
}

export interface ParsedVcfVariant {
  chrom: string;
  position: number;
  refBases: string;
  altBases: string[];
  quality: number | null;
}

export interface SamAlignmentSummary {
  totalRecords: number;
  mappedRecords: number;
  unmappedRecords: number;
  meanMapq: number;
}

export interface MyersPatternHit {
  start: number;
  end: number;
  editDistance: number;
  strand: 1 | -1;
  matchedSeq: string;
}

export interface RustEngineDiagnostics {
  engine: string;
  version: string;
  libraries: string[];
  targetArch: string;
  isWasm: boolean;
}

let wasmExportsSingleton: MolBioCraftWasmExports | null = null;
const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const encodedOpCache = new Map<string, Uint8Array>();
const lruResultCache = new Map<string, unknown>();
const MAX_LRU_ENTRIES = 160;

/**
 * RPC payload capture for the dispatcher contract test (`crates/molbiocraft-wasm/tests/rpc_contract.rs`),
 * driven by `npm run rpc:capture`. Null, and so never called, unless `MOLBIOCRAFT_RPC_CAPTURE` is set
 * (to the directory to write into); a browser has no `process`, so it is always null there. When on,
 * each distinct (op, top-level payload keys as serialised) pair this module instance sends is appended
 * once, as a JSON line, to a file named for this process and thread inside that directory. A failed
 * write throws from the invoke that made it; it is not swallowed here.
 */
const recordRpcPayload: ((op: string, payloadJson: string) => void) | null = createRpcPayloadRecorder();

function createRpcPayloadRecorder(): ((op: string, payloadJson: string) => void) | null {
  const proc = (globalThis as {
    process?: {
      env?: Record<string, string | undefined>;
      pid?: number;
      getBuiltinModule?: (id: string) => unknown;
    };
  }).process;
  const dir = proc?.env?.MOLBIOCRAFT_RPC_CAPTURE;
  if (!dir) {
    return null;
  }
  if (typeof proc?.getBuiltinModule !== 'function') {
    throw new Error('MOLBIOCRAFT_RPC_CAPTURE is set but process.getBuiltinModule is unavailable (needs Node 20.16+ or 22.3+)');
  }
  const fs = proc.getBuiltinModule('node:fs') as { appendFileSync: (file: string, data: string) => void };
  const path = proc.getBuiltinModule('node:path') as { join: (...parts: string[]) => string };
  const { threadId } = proc.getBuiltinModule('node:worker_threads') as { threadId: number };
  const file = path.join(dir, `rpc-${proc.pid}-${threadId}.jsonl`);
  const seen = new Set<string>();
  return (op, payloadJson) => {
    const sent: unknown = payloadJson === '' ? null : JSON.parse(payloadJson);
    const keys = sent !== null && typeof sent === 'object' && !Array.isArray(sent) ? Object.keys(sent).sort() : [];
    const line = JSON.stringify({ op, keys });
    if (!seen.has(line)) {
      seen.add(line);
      fs.appendFileSync(file, `${line}\n`);
    }
  };
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const g = globalThis as unknown as {
    Buffer?: { from: (s: string, enc: string) => Uint8Array };
  };
  if (g.Buffer && typeof g.Buffer.from === 'function') {
    return new Uint8Array(g.Buffer.from(b64, 'base64'));
  }
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

function getWasmExports(): MolBioCraftWasmExports {
  if (wasmExportsSingleton) {
    return wasmExportsSingleton;
  }
  const wasmBytes =
    MOLBIOCRAFT_WASM_BYTES ?? decodeBase64ToBytes(MOLBIOCRAFT_WASM_BASE64);
  const wasmModule = new WebAssembly.Module(wasmBytes as unknown as BufferSource);
  const wasmInstance = new WebAssembly.Instance(wasmModule, {});
  wasmExportsSingleton = wasmInstance.exports as unknown as MolBioCraftWasmExports;
  return wasmExportsSingleton;
}

function getEncodedOp(op: string): Uint8Array {
  let bytes = encodedOpCache.get(op);
  if (!bytes) {
    bytes = textEncoder.encode(op);
    encodedOpCache.set(op, bytes);
  }
  return bytes;
}

/**
 * Fast 64-bit FNV-1a fingerprint sampled densely on short sequences and strided + boundary-exact
 * on multi-megabase chromosomes so cache keys stay O(1) even on 5,000,000 bp genomes.
 */
export function fingerprintSequenceFast(seq: string): string {
  const len = seq.length;
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const stride = len > 16384 ? Math.floor(len / 4096) : 1;
  for (let i = 0; i < len; i += stride) {
    const c = seq.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193);
    h2 ^= c + (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b);
  }
  if (len > 32) {
    for (let i = len - 32; i < len; i++) {
      h1 ^= seq.charCodeAt(i);
      h1 = Math.imul(h1, 0x01000193);
    }
  }
  return `${len}:${(h1 >>> 0).toString(36)}_${(h2 >>> 0).toString(36)}`;
}

/**
 * Synchronously invokes any of the 100+ Rust bioinformatics operations compiled into `molbiocraft-wasm`
 * using zero-allocation reusable linear-memory scratch buffers.
 */
export function invokeRustBioSync<T>(op: string, payload?: unknown): T {
  const exp = getWasmExports();
  const opBytes = getEncodedOp(op);
  const jsonStr = payload === undefined ? '' : JSON.stringify(payload);
  recordRpcPayload?.(op, jsonStr);
  // Worst-case UTF-8 expansion is 3 bytes per UTF-16 code unit
  const maxBytes = opBytes.length + jsonStr.length * 3 + 16;
  const scratchPtr = exp.mbc_wasm_scratch_ptr(maxBytes);

  // Re-acquire Uint8Array view AFTER `mbc_wasm_scratch_ptr` in case WASM memory grew
  const memIn = new Uint8Array(exp.memory.buffer);
  memIn.set(opBytes, scratchPtr);

  let payloadByteLen = 0;
  if (jsonStr.length > 0) {
    if (typeof textEncoder.encodeInto === 'function') {
      const targetSub = memIn.subarray(scratchPtr + opBytes.length);
      const res = textEncoder.encodeInto(jsonStr, targetSub);
      payloadByteLen = res.written ?? 0;
    } else {
      const encoded = textEncoder.encode(jsonStr);
      memIn.set(encoded, scratchPtr + opBytes.length);
      payloadByteLen = encoded.length;
    }
  }

  const outPtr = exp.mbc_wasm_invoke_scratch(opBytes.length, payloadByteLen);
  const outLen = exp.mbc_wasm_last_len();
  const isErr = exp.mbc_wasm_last_is_err();
  const outText = textDecoder.decode(new Uint8Array(exp.memory.buffer, outPtr, outLen));

  if (isErr !== 0) {
    throw new Error(`[MolBioCraft Rust Engine :: ${op}] ${outText}`);
  }
  return JSON.parse(outText) as T;
}

/**
 * Bounded LRU-cached synchronous Rust invocation for hot React render-loop queries.
 */
export function invokeRustBioCachedSync<T>(
  cacheKey: string,
  op: string,
  payload?: unknown
): T {
  if (lruResultCache.has(cacheKey)) {
    const val = lruResultCache.get(cacheKey) as T;
    lruResultCache.delete(cacheKey);
    lruResultCache.set(cacheKey, val);
    return val;
  }
  const computed = invokeRustBioSync<T>(op, payload);
  if (lruResultCache.size >= MAX_LRU_ENTRIES) {
    const oldestKey = lruResultCache.keys().next().value;
    if (oldestKey !== undefined) {
      lruResultCache.delete(oldestKey);
    }
  }
  lruResultCache.set(cacheKey, computed);
  return computed;
}

/**
 * Invokes the Rust bioinformatics workspace asynchronously via Tauri v2's multi-core `rayon`
 * worker pool (`cmd_rust_bio_invoke`) when running inside the native desktop shell, falling back
 * seamlessly to the in-process Rust WebAssembly engine in browser/WebView/test environments.
 */
export async function invokeRustBioNativeAsync<T>(
  op: string,
  payload?: unknown
): Promise<T> {
  const win = globalThis as unknown as {
    __TAURI_INTERNALS__?: {
      invoke?: <R>(cmd: string, args?: Record<string, unknown>) => Promise<R>;
    };
    __TAURI__?: {
      core?: {
        invoke?: <R>(cmd: string, args?: Record<string, unknown>) => Promise<R>;
      };
    };
  };
  const tauriInvoke = win.__TAURI_INTERNALS__?.invoke ?? win.__TAURI__?.core?.invoke;
  if (typeof window !== 'undefined' && typeof tauriInvoke === 'function') {
    recordRpcPayload?.(op, JSON.stringify(payload ?? null));
    try {
      return await tauriInvoke<T>('cmd_rust_bio_invoke', {
        op,
        payload: payload ?? null,
      });
    } catch {
      // Fall through to synchronous Rust WASM engine
    }
  }
  return invokeRustBioSync<T>(op, payload);
}

export function getRustEngineDiagnostics(): RustEngineDiagnostics {
  return invokeRustBioCachedSync<RustEngineDiagnostics>(
    'diag:v1',
    'engine_diagnostics'
  );
}

export function sliceGenomeViewportRust(
  seq: string,
  features: SequenceFeature[],
  startPos: number,
  endPos: number,
  isRna = false,
  isProtein = false
): GenomeViewportSlice {
  const key = `vp:${fingerprintSequenceFast(seq)}:${features.length}:${startPos}:${endPos}:${isRna ? 1 : 0}:${isProtein ? 1 : 0}`;
  return invokeRustBioCachedSync<GenomeViewportSlice>(
    key,
    'slice_genome_viewport',
    {
      seq,
      features,
      startPos,
      endPos,
      isRna,
      isProtein,
    }
  );
}

export function computeGenomeTrackOverviewRust(
  seq: string,
  bins = 180
): GenomeTrackOverview {
  const key = `trk:${fingerprintSequenceFast(seq)}:${bins}`;
  return invokeRustBioCachedSync<GenomeTrackOverview>(
    key,
    'compute_genome_track_overview',
    { seq, bins }
  );
}

export function searchGenomeMotifFmIndexRust(
  seq: string,
  pattern: string,
  searchBothStrands = true,
  maxHits = 250
): FmIndexSearchHit[] {
  return invokeRustBioSync<FmIndexSearchHit[]>('search_genome_motif_fmindex', {
    seq,
    pattern,
    searchBothStrands,
    maxHits,
  });
}

export function computeAgaroseGelPhysicsRust(
  fragmentSizesBp: number[],
  agarosePct = 1.0,
  bufferType: 'TAE' | 'TBE' | 'SB' = 'TAE',
  gelLengthMm = 80
): AgaroseGelBandPhysics[] {
  return invokeRustBioSync<AgaroseGelBandPhysics[]>(
    'compute_agarose_gel_physics',
    {
      fragmentSizesBp,
      agarosePct,
      bufferType,
      gelLengthMm,
    }
  );
}

export function generateLargeGenomeBenchmarkRust(
  lengthBp = 500_000,
  organismPreset = 'Escherichia coli K-12'
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>(
    'generate_large_genome_benchmark',
    { lengthBp, organismPreset }
  );
}

export function generateLargeProteinBenchmarkRust(
  lengthAa = 10_000,
  proteinPreset = 'Titin_Ig_Polyprotein'
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>(
    'generate_large_protein_benchmark',
    { lengthAa, proteinPreset }
  );
}

export function parseFastqNoodlesRust(
  text: string,
  maxReads = 500
): FastqParseSummary {
  return invokeRustBioSync<FastqParseSummary>('parse_fastq', {
    text,
    maxReads,
  });
}

export function parseGff3NoodlesRust(text: string): SequenceFeature[] {
  return invokeRustBioSync<SequenceFeature[]>('parse_gff3', { text });
}

export function parseBedNoodlesRust(text: string): SequenceFeature[] {
  return invokeRustBioSync<SequenceFeature[]>('parse_bed', { text });
}

export function parseVcfNoodlesRust(text: string): ParsedVcfVariant[] {
  return invokeRustBioSync<ParsedVcfVariant[]>('parse_vcf', { text });
}

export function parseSamNoodlesRust(text: string): SamAlignmentSummary {
  return invokeRustBioSync<SamAlignmentSummary>('parse_sam', { text });
}

export function searchApproximateMyersRust(
  seq: string,
  pattern: string,
  maxEditDist = 2,
  searchRevcomp = true,
  maxHits = 100
): MyersPatternHit[] {
  return invokeRustBioSync<MyersPatternHit[]>('search_approximate_myers', {
    seq,
    pattern,
    maxEditDist,
    searchRevcomp,
    maxHits,
  });
}

// ─── Resident Native/WASM Sequence Store (Multi-Megabase Chromosomes & Giant Proteins) ───

export interface ResidentEnsureAck {
  docId: string;
  revisionKey: string;
  sequenceLength: number;
  featureCount: number;
  hasPrebuiltFmIndex: boolean;
  isProtein: boolean;
  cacheHit: boolean;
  residentDocCount: number;
  residentTotalBytes: number;
}

export interface ResidentViewportSlice extends GenomeViewportSlice {
  docId: string;
  proteinSecondaryStates?: string | null;
  proteinResidueClasses?: string | null;
}

export interface ResidentStoreStats {
  residentDocCount: number;
  residentTotalBytes: number;
  residentDocIds: string[];
}

const clientResidentRevisionCache = new Map<
  string,
  { revisionKey: string; ack: ResidentEnsureAck }
>();

export function buildDocumentRevisionKey(doc: SequenceDocument): string {
  return `${doc.updatedAt}|${doc.sequence.length}|${doc.features.length}|${doc.moleculeType}|${doc.topology}|${fingerprintSequenceFast(doc.sequence)}`;
}

/**
 * Registers or refreshes `doc` inside the Rust WASM linear-memory Resident Sequence Store.
 * Subsequent calls with an unchanged revision key short-circuit in < 1 microsecond without
 * copying or encoding `doc.sequence` across the JS -> WASM boundary.
 */
export function ensureResidentSequenceRust(
  doc: SequenceDocument,
  overviewBins = 180
): ResidentEnsureAck {
  const revisionKey = buildDocumentRevisionKey(doc);
  const existing = clientResidentRevisionCache.get(doc.id);
  if (existing && existing.revisionKey === revisionKey) {
    return existing.ack;
  }

  const ack = invokeRustBioSync<ResidentEnsureAck>('ensure_resident_sequence', {
    docId: doc.id,
    revisionKey,
    seq: doc.sequence,
    features: doc.features,
    isRna: doc.moleculeType === 'RNA',
    isProtein: doc.moleculeType === 'Protein',
    bins: overviewBins,
  });
  clientResidentRevisionCache.set(doc.id, {
    revisionKey,
    ack: { ...ack, cacheHit: true },
  });
  return ack;
}

export function sliceResidentViewportRust(
  doc: SequenceDocument,
  startPos: number,
  endPos: number
): ResidentViewportSlice {
  ensureResidentSequenceRust(doc);
  try {
    return invokeRustBioSync<ResidentViewportSlice>('slice_resident_viewport', {
      docId: doc.id,
      startPos,
      endPos,
    });
  } catch (err) {
    if (String(err).includes('RESIDENT_MISS:')) {
      clientResidentRevisionCache.delete(doc.id);
      ensureResidentSequenceRust(doc);
      return invokeRustBioSync<ResidentViewportSlice>('slice_resident_viewport', {
        docId: doc.id,
        startPos,
        endPos,
      });
    }
    throw err;
  }
}

export function getResidentTrackOverviewRust(
  doc: SequenceDocument,
  bins = 180
): GenomeTrackOverview {
  ensureResidentSequenceRust(doc, bins);
  try {
    return invokeRustBioSync<GenomeTrackOverview>('get_resident_track_overview', {
      docId: doc.id,
      bins,
    });
  } catch (err) {
    if (String(err).includes('RESIDENT_MISS:')) {
      clientResidentRevisionCache.delete(doc.id);
      ensureResidentSequenceRust(doc, bins);
      return invokeRustBioSync<GenomeTrackOverview>('get_resident_track_overview', {
        docId: doc.id,
        bins,
      });
    }
    throw err;
  }
}

/**
 * The resident motif search's reply (BG-01M6S17C): the first `maxHits` hits by position, both
 * strands merged before the cut; the number of hits in the whole sequence; and the engine's
 * `warnings` (D0005), one sentence when the list holds fewer hits than `totalHits`.
 */
export interface ResidentMotifSearchResult {
  hits: FmIndexSearchHit[];
  totalHits: number;
  warnings: string[];
}

export function searchResidentMotifFmIndexRust(
  doc: SequenceDocument,
  pattern: string,
  searchBothStrands = true,
  maxHits = 250
): ResidentMotifSearchResult {
  if (!pattern.trim()) return { hits: [], totalHits: 0, warnings: [] };
  ensureResidentSequenceRust(doc);
  try {
    return invokeRustBioSync<ResidentMotifSearchResult>('search_resident_motif_fmindex', {
      docId: doc.id,
      pattern,
      bothStrands: searchBothStrands,
      maxHits,
    });
  } catch (err) {
    if (String(err).includes('RESIDENT_MISS:')) {
      clientResidentRevisionCache.delete(doc.id);
      ensureResidentSequenceRust(doc);
      return invokeRustBioSync<ResidentMotifSearchResult>('search_resident_motif_fmindex', {
        docId: doc.id,
        pattern,
        bothStrands: searchBothStrands,
        maxHits,
      });
    }
    throw err;
  }
}

export function evictResidentSequenceRust(docId: string): boolean {
  clientResidentRevisionCache.delete(docId);
  return invokeRustBioSync<boolean>('evict_resident_sequence', { docId });
}

export function getResidentStoreStatsRust(): ResidentStoreStats {
  return invokeRustBioSync<ResidentStoreStats>('resident_store_stats');
}

// ─── Reference Databases, .mbc Checksum & Chromatogram Viewport (`molbiocraft-formats`) ───

export interface ReferenceDatabaseCategoryMeta {
  id: string;
  group: 'NCBI' | 'UniProt' | 'Local';
  label: string;
  subtitle: string;
}

export interface CuratedDatabaseRecordRust {
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

export function getReferenceDatabaseCategoriesRust(): ReferenceDatabaseCategoryMeta[] {
  return invokeRustBioCachedSync<ReferenceDatabaseCategoryMeta[]>(
    'ref-db-cats:v1',
    'get_reference_database_categories'
  );
}

export function queryCuratedDatabaseRecordsRust(
  category: string,
  query: string
): CuratedDatabaseRecordRust[] {
  return invokeRustBioSync<CuratedDatabaseRecordRust[]>(
    'query_curated_database_records',
    { category, query }
  );
}

export function buildCuratedDatabaseDocumentRust(
  recordId: string,
  timestampIso = new Date().toISOString()
): SequenceDocument | null {
  return invokeRustBioSync<SequenceDocument | null>(
    'build_curated_database_document',
    { recordId, timestampIso }
  );
}

export function parseRemoteDatabasePayloadRust(
  rawText: string,
  accession: string,
  isProteinHint: boolean,
  targetFolder: string
): SequenceDocument[] {
  return invokeRustBioSync<SequenceDocument[]>('parse_remote_database_payload', {
    rawText,
    accession,
    isProteinHint,
    targetFolder,
  });
}

export interface MbcChecksumDocInput {
  id: string;
  name: string;
  topology: string;
  moleculeType: string;
  sequence: string;
  featureCount: number;
  primerCount: number;
}

export function computeMbcPayloadChecksumRust(docs: MbcChecksumDocInput[]): string {
  return invokeRustBioSync<string>('compute_mbc_payload_checksum', { docs });
}

export interface HeterozygotePeakCall {
  baseIndex: number;
  position1based: number;
  primaryBase: string;
  secondaryBase: string;
  iupacCode: string;
  secondaryRatio: number;
  phredScore: number;
}

export interface ChromatogramViewportReport {
  startBase: number;
  endBase: number;
  startPoint: number;
  endPoint: number;
  pathA: string;
  pathC: string;
  pathG: string;
  pathT: string;
  areaA: string;
  areaC: string;
  areaG: string;
  areaT: string;
  meanPhred: number;
  q20Pct: number;
  q30Pct: number;
  /**
   * The Mott trim's region at P(err) 0.05, 1-based: 1..0 when every quality value misses 0.05. A
   * read without a quality value for every call is not trimmed (hasQualityValues is false).
   */
  hqTrimStart1based: number;
  hqTrimEnd1based: number;
  signalToNoiseRatio: number;
  heterozygotePeaks: HeterozygotePeakCall[];
  /** SVG x of each base in the window, at its recorded trace peak. */
  baseXPositions?: number[];
  /** False when the trace file has no per-base quality values. */
  hasQualityValues?: boolean;
}

export function computeChromatogramViewportRust(
  chromatogram: ChromatogramData,
  baseOffset: number,
  windowBases: number,
  rawMode: boolean,
  autoscaled: boolean,
  verticalScale: number,
  baselineY: number,
  maxPeakHeight: number
): ChromatogramViewportReport {
  return invokeRustBioSync<ChromatogramViewportReport>(
    'compute_chromatogram_viewport',
    {
      chromatogram,
      baseOffset,
      windowBases,
      rawMode,
      autoscaled,
      verticalScale,
      baselineY,
      maxPeakHeight,
    }
  );
}

// ─── Guided Pipelines, Reaction Buffers, Golden Gate Fidelity & Macros (`molbiocraft-cloning`) ───

export function getBioPipelineCatalogRust<T>(): T[] {
  return invokeRustBioCachedSync<T[]>('bio-pipe-cat:v1', 'get_bio_pipeline_catalog');
}

export function executeBioPipelineRust<T>(
  doc: SequenceDocument,
  pipelineId: string,
  hostOS: string,
  completedAtIso = new Date().toISOString()
): T {
  return invokeRustBioSync<T>('execute_bio_pipeline_rust', {
    doc,
    pipelineId,
    hostOS,
    completedAtIso,
  });
}

export interface EnzymeBufferActivityRow {
  enzymeName: string;
  /** NEB activity (%); null = not in the built-in table (check the supplier chart). */
  rCutSmartPct: number | null;
  bufferR11Pct: number | null;
  bufferR21Pct: number | null;
  bufferR31Pct: number | null;
  optimalTempC: number;
  heatInactivation: string;
  starActivityRisk: boolean;
  methylationNote: string;
}

export interface MultiDigestBufferPlan {
  enzymes: EnzymeBufferActivityRow[];
  recommendedBuffer: string;
  minimumSharedActivityPct: number;
  sequentialDigestRequired: boolean;
  incubationTempC: number;
  heatInactivationSummary: string;
  protocolNotes: string[];
}

export function evaluateMultiDigestBufferPlanRust(
  enzymes: string[]
): MultiDigestBufferPlan {
  return invokeRustBioSync<MultiDigestBufferPlan>(
    'evaluate_multi_digest_buffer_plan',
    { enzymes }
  );
}

export interface GoldenGateOverhangPairRisk {
  overhangA: string;
  overhangB: string;
  issue: string;
  mismatchPenalty: number;
}

export interface GoldenGateFidelityReport {
  overhangs: string[];
  /** Always null: a quantitative fidelity needs the measured T4 ligase pairing matrix (not bundled). */
  overallFidelityPct: number | null;
  palindromicOverhangs: string[];
  riskyPairs: GoldenGateOverhangPairRisk[];
  verdict: string;
}

export function evaluateGoldenGateFidelityRust(
  overhangs: string[]
): GoldenGateFidelityReport {
  return invokeRustBioSync<GoldenGateFidelityReport>(
    'evaluate_golden_gate_overhang_fidelity',
    { overhangs }
  );
}

export interface GibsonJunctionThermodynamics {
  overlapSeq: string;
  lengthBp: number;
  gcPercent: number;
  tmC: number;
  hairpinDeltaG: number;
  isothermal50cOptimal: boolean;
  recommendation: string;
  /** Why `tmC` is no answer: the overlap holds N or another ambiguity base (BG-01M6SHQ0). */
  tmNoAnswerReason?: string;
}

export function analyzeGibsonOverlapJunctionRust(
  overlapSeq: string
): GibsonJunctionThermodynamics {
  return invokeRustBioSync<GibsonJunctionThermodynamics>(
    'analyze_gibson_overlap_junction',
    { overlapSeq }
  );
}

export function executeBuiltinWorkflowMacroRust(
  macroId: string,
  doc: SequenceDocument
): Record<string, unknown> {
  return invokeRustBioSync<Record<string, unknown>>(
    'execute_builtin_rust_workflow_macro',
    { macroId, doc }
  );
}

// ─── Protein Motifs, 3D Geometry, Mash Minimizers & Robinson-Foulds ───

export interface ProteinMotifHit {
  accession: string;
  name: string;
  category: string;
  startAa: number;
  endAa: number;
  matchedSequence: string;
  confidenceScore: number;
  biologicalRole: string;
}

export interface SignalPeptidePrediction {
  hasSignalPeptide: boolean;
  cleavageSiteAa: number | null;
  nRegionEndAa: number;
  hRegionRange: [number, number];
  cRegionRange: [number, number];
  motifMinus3Minus1: string;
  /** Heuristic 0-1 score from von Heijne features — not SignalP's neural-network D-score. */
  heuristicScore: number;
  summary: string;
}

export interface ProteinMotifScanReport {
  sequenceLengthAa: number;
  totalHits: number;
  affinityTagsCount: number;
  proteaseSitesCount: number;
  catalyticAndBindingCount: number;
  localizationSignalsCount: number;
  ptmSitesCount: number;
  signalPeptide: SignalPeptidePrediction;
  hits: ProteinMotifHit[];
}

export function scanProteinFunctionalMotifsRust(
  proteinSeq: string
): ProteinMotifScanReport {
  return invokeRustBioSync<ProteinMotifScanReport>(
    'scan_protein_functional_motifs',
    { proteinSeq }
  );
}

export interface Pdb3dGeometrySummary {
  residueCount: number;
  chainCount: number;
  chainIds: string[];
  centroidXYZ: [number, number, number];
  radiusOfGyrationAngstrom: number;
  maxEndToEndDistanceAngstrom: number;
  principalMoments: [number, number, number];
  asphericity: number;
  shapeDescriptor: string;
  relativeContactOrderPct: number;
  totalLongRangeContacts8a: number;
  totalEstimatedSasaAngstrom2: number;
  buriedCoreResidues: number;
  exposedSurfaceResidues: number;
}

export function analyzePdb3dGeometryRust(pdbOrCif: string): Pdb3dGeometrySummary {
  return invokeRustBioSync<Pdb3dGeometrySummary>('analyze_pdb_3d_geometry', {
    pdbOrCif,
  });
}

export interface MashMinimizerReport {
  kmerSize: number;
  windowSize: number;
  sketchCapacity: number;
  seqALengthBp: number;
  seqBLengthBp: number;
  sketchASize: number;
  sketchBSize: number;
  sharedSketchHashes: number;
  unionSketchHashes: number;
  jaccardIndex: number;
  mashDistance: number;
  estimatedAniPct: number;
  containmentAInB: number;
  containmentBInA: number;
  pValue: number;
  evolutionaryRelationship: string;
}

export function computeMashMinimizerDistanceRust(
  seqA: string,
  seqB: string,
  k = 15,
  w = 5,
  sketchCapacity = 2048
): MashMinimizerReport {
  return invokeRustBioSync<MashMinimizerReport>('compute_mash_minimizer_distance', {
    seqA,
    seqB,
    k,
    w,
    sketchCapacity,
  });
}

export interface RobinsonFouldsReport {
  sharedLeafCount: number;
  maxPossibleRf: number;
  robinsonFouldsDistance: number;
  normalizedRf: number;
  sharedInternalSplits: number;
  uniqueSplitsTreeA: number;
  uniqueSplitsTreeB: number;
  topologyCongruenceVerdict: string;
}

export function compareTreeTopologiesRobinsonFouldsRust(
  newickA: string,
  newickB: string
): RobinsonFouldsReport {
  return invokeRustBioSync<RobinsonFouldsReport>(
    'compare_tree_topologies_robinson_foulds',
    { newickA, newickB }
  );
}

// ─── Noodles Genomic Pileup/VCF/Intervals, Large-Genome Chaining & Proteomics MS ───

export interface SamPileupCoverageReport {
  referenceLengthBp: number;
  totalReads: number;
  mappedReads: number;
  unmappedReads: number;
  forwardStrandReads: number;
  reverseStrandReads: number;
  properPairReads: number;
  meanMapq: number;
  meanInsertSizeBp: number;
  stdInsertSizeBp: number;
  meanCoverageDepth: number;
  medianCoverageDepth: number;
  stdCoverageDepth: number;
  maxCoverageDepth: number;
  breadth1xPct: number;
  breadth10xPct: number;
  breadth30xPct: number;
  softClippedBases: number;
  alignedBases: number;
  mismatchedBases: number;
  empiricalErrorRatePct: number;
  coverageWindows: {
    windowIndex: number;
    startBp: number;
    endBp: number;
    meanDepth: number;
    maxDepth: number;
    minDepth: number;
    gcPercent: number;
  }[];
  pileupVariants: {
    positionBp: number;
    refBase: string;
    altAllele: string;
    variantClass: string;
    totalDepth: number;
    altCount: number;
    alleleFrequency: number;
    forwardAlt: number;
    reverseAlt: number;
    strandBiasPValue: number;
    shannonEntropyBits: number;
    phredQualEstimate: number;
  }[];
}

export function computeSamPileupAndCoverageNoodlesRust(
  referenceSeq: string,
  samText: string,
  windowCount = 64
): SamPileupCoverageReport {
  return invokeRustBioSync<SamPileupCoverageReport>(
    'compute_sam_pileup_and_coverage_noodles',
    { referenceSeq, samText, windowCount }
  );
}

export interface VcfConsequenceSummaryReport {
  totalVariants: number;
  snvCount: number;
  indelCount: number;
  transitions: number;
  transversions: number;
  tsTvRatio: number;
  highImpactCount: number;
  moderateImpactCount: number;
  lowImpactCount: number;
  modifierImpactCount: number;
  annotatedVariants: {
    chrom: string;
    positionBp: number;
    refAllele: string;
    altAllele: string;
    quality: number | null;
    consequenceTerm: string;
    impactTier: string;
    featureName: string | null;
    featureType: string | null;
    strand: number;
    hgvsCoding: string;
    hgvsProtein: string | null;
    refCodon: string | null;
    altCodon: string | null;
    granthamDistance: number | null;
    isTransition: boolean;
  }[];
}

export function annotateVcfCodingConsequencesNoodlesRust(
  referenceSeq: string,
  features: SequenceFeature[],
  vcfText: string,
  geneticCodeId = 11
): VcfConsequenceSummaryReport {
  return invokeRustBioSync<VcfConsequenceSummaryReport>(
    'annotate_vcf_coding_consequences_noodles',
    { referenceSeq, features, vcfText, geneticCodeId }
  );
}

export function intersectGenomicIntervalsNoodlesRust(
  trackAText: string,
  trackBText: string,
  referenceFasta?: string,
  flankBp = 0
) {
  return invokeRustBioSync<{
    trackAIntervalCount: number;
    trackBIntervalCount: number;
    trackACoveredBp: number;
    trackBCoveredBp: number;
    intersectionBp: number;
    unionBp: number;
    jaccardSimilarity: number;
    overlapFractionOfA: number;
    overlapFractionOfB: number;
    foldEnrichmentVsGenome: number;
    intersectedIntervals: {
      chrom: string;
      startBp: number;
      endBp: number;
      overlapLengthBp: number;
      trackALabel: string;
      trackBLabel: string;
      extractedSequence: string | null;
    }[];
  }>('intersect_genomic_intervals_noodles', {
    trackAText,
    trackBText,
    referenceFasta: referenceFasta ?? null,
    flankBp,
  });
}

export function alignLargeGenomesMinimizerChainRust(
  targetSeq: string,
  querySeq: string,
  windowW = 10,
  kmerK = 15,
  maxSeedOccurrences = 64
) {
  return invokeRustBioSync<{
    targetLengthBp: number;
    queryLengthBp: number;
    windowW: number;
    kmerK: number;
    targetMinimizerCount: number;
    queryMinimizerCount: number;
    rawSeedMatches: number;
    targetCoveredPct: number;
    queryCoveredPct: number;
    weightedIdentityPct: number;
    inversionChains: number;
    chains: {
      chainId: number;
      isPrimary: boolean;
      strand: number;
      targetStartBp: number;
      targetEndBp: number;
      queryStartBp: number;
      queryEndBp: number;
      anchorCount: number;
      chainScore: number;
      alignedSpanBp: number;
      estimatedIdentityPct: number;
      mashDivergence: number;
      structuralEvent: string;
      myersRefinedGapEdits: number;
    }[];
  }>('align_large_genomes_minimizer_chain', {
    targetSeq,
    querySeq,
    windowW,
    kmerK,
    maxSeedOccurrences,
  });
}

export function searchProteomeBlosum62HspsRust(
  queryProtein: string,
  targets: { id: string; name: string; sequence: string }[],
  wordLen = 3,
  evalueCutoff = 1e-2
) {
  return invokeRustBioSync<{
    queryLengthAa: number;
    databaseSequences: number;
    databaseTotalResidues: number;
    reducedWordLength: number;
    hits: {
      targetId: string;
      targetName: string;
      targetLengthAa: number;
      queryStartAa: number;
      queryEndAa: number;
      targetStartAa: number;
      targetEndAa: number;
      alignmentLengthAa: number;
      identicalAa: number;
      positiveSimilarAa: number;
      identityPct: number;
      positivesPct: number;
      rawBlosum62Score: number;
      bitScore: number;
      eValue: number;
      queryComplexityEntropy: number;
      alignedQuery: string;
      midline: string;
      alignedTarget: string;
    }[];
  }>('search_proteome_blosum62_hsps', {
    queryProtein,
    targets,
    wordLen,
    evalueCutoff,
  });
}

export function simulateProteolyticDigestMsRust(
  proteinSeq: string,
  protease = 'Trypsin',
  maxMissedCleavages = 1,
  minMassDa = 400.0,
  maxMassDa = 4500.0,
  carbamidomethylCys = true
) {
  return invokeRustBioSync<{
    proteinLengthAa: number;
    protease: string;
    maxMissedCleavages: number;
    carbamidomethylCysteine: boolean;
    intactMonoisotopicDa: number;
    intactAverageDa: number;
    totalCleavageSites: number;
    observablePeptideCount: number;
    sequenceCoveragePct: number;
    peptides: {
      peptideIndex: number;
      startAa: number;
      endAa: number;
      lengthAa: number;
      missedCleavages: number;
      sequence: string;
      chemicalFormula: string;
      monoisotopicNeutralDa: number;
      mzCharge1: number;
      mzCharge2: number;
      mzCharge3: number;
      hplcRetentionMin: number;
    }[];
    /**
     * How the digest departed from what was asked (D0005), one plain sentence each: an unknown
     * protease digested with Trypsin. Read as none when the reply leaves it out.
     */
    warnings?: string[];
  }>('simulate_proteolytic_digest_ms', {
    proteinSeq,
    protease,
    maxMissedCleavages,
    minMassDa,
    maxMassDa,
    carbamidomethylCys,
  });
}

export function simulatePeptideMs2SpectrumRust(
  peptideSeq: string,
  carbamidomethylCys = true
) {
  return invokeRustBioSync<{
    peptideSequence: string;
    precursorMonoisotopicDa: number;
    precursorMz2plus: number;
    peaks: {
      label: string;
      ionSeries: string;
      ordinal: number;
      charge: number;
      mz: number;
      /** Qualitative drawing height (0-100), not a predicted intensity — see the engine docs. */
      relativeIntensity: number;
      fragmentSequence: string;
    }[];
  }>('simulate_peptide_ms2_spectrum', {
    peptideSeq,
    carbamidomethylCys,
  });
}

export function scanPostTranslationalModificationsRust(proteinSeq: string) {
  return invokeRustBioSync<{
    proteinLengthAa: number;
    totalCysteines: number;
    predictedSubcellularCompartment: string;
    ptmSites: {
      category: string;
      modificationName: string;
      modifiedResidueAa: number;
      matchedMotif: string;
      massShiftDa: number;
      confidenceScore: number;
    }[];
    pestDegrons: {
      startAa: number;
      endAa: number;
      sequence: string;
      rogersPestScore: number;
    }[];
    disulfideBonds: {
      cys1Aa: number;
      cys2Aa: number;
      sequenceSeparation: number;
      caDistanceAngstrom: number | null;
      confidence: number;
      basis: string;
    }[];
  }>('scan_post_translational_modifications', { proteinSeq });
}

// ─── Viterbi HMM, JASPAR PSSM, SIMD Fuzzy Search, POA Contigs, Banded DP, Newick Layout, .mbc Codec & Table/Lineage Engine ───

export interface HmmGenomeSegmentationReport {
  sequenceLengthBp: number;
  viterbiLogProb: number;
  atRichFractionPct: number;
  balancedCodingFractionPct: number;
  gcIslandFractionPct: number;
  segments: {
    stateIndex: number;
    stateLabel: string;
    start: number;
    end: number;
    lengthBp: number;
    gcPercent: number;
  }[];
}

export function segmentGenomeHmmViterbiRust(seq: string): HmmGenomeSegmentationReport {
  return invokeRustBioSync<HmmGenomeSegmentationReport>('segment_genome_hmm_viterbi', {
    seq,
  });
}

export interface PssmMotifScanReport {
  motifsEvaluated: number;
  thresholdRelScore: number;
  totalHits: number;
  profiles: {
    matrixId: string;
    tfName: string;
    family: string;
    lengthBp: number;
    degenerateConsensus: string;
    informationContentBits: number;
    hitCount: number;
  }[];
  hits: {
    matrixId: string;
    tfName: string;
    family: string;
    start: number;
    end: number;
    strand: 1 | -1;
    matchedSeq: string;
    relativeScore: number;
    logOddsBits: number;
  }[];
}

export function scanJasparPssmMotifsRust(
  seq: string,
  minRelScore = 0.85,
  customSites?: string[]
): PssmMotifScanReport {
  return invokeRustBioSync<PssmMotifScanReport>('scan_jaspar_pssm_motifs', {
    seq,
    minRelScore,
    customSites: customSites ?? null,
  });
}

export function scanFuzzySubsequenceSimdRust(
  seq: string,
  pattern: string,
  maxEdits = 2,
  bothStrands = true,
  maxHits = 100
) {
  return invokeRustBioSync<
    {
      start: number;
      end: number;
      strand: 1 | -1;
      editDistance: number;
      hammingDistance: number | null;
      matchedSeq: string;
    }[]
  >('scan_fuzzy_subsequence_simd', {
    seq,
    pattern,
    maxEdits,
    bothStrands,
    maxHits,
  });
}

export function isMbcFileOrPayloadRust(fileName: string, rawText?: string): boolean {
  return invokeRustBioSync<boolean>('is_mbc_file_or_payload_rust', {
    fileName,
    rawText: rawText ?? null,
  });
}

export function serializeMbcWorkbenchRust(
  snapshot: unknown,
  appVersion = '1.0.0',
  savedAtIso = new Date().toISOString()
): string {
  return invokeRustBioSync<string>('serialize_mbc_workbench_rust', {
    snapshot,
    appVersion,
    savedAtIso,
  });
}

export function parseMbcWorkbenchRust<T>(
  rawText: string,
  fallbackSessionName = 'Imported_Session',
  nowIso = new Date().toISOString()
): T {
  return invokeRustBioSync<T>('parse_mbc_workbench_rust', {
    rawText,
    fallbackSessionName,
    nowIso,
  });
}

export interface MottPhredTrimReport {
  rawLengthBp: number;
  trimmedLengthBp: number;
  /**
   * The kept bases, 1-based. A read with no base better than the cutoff keeps none: 1..0, 0 bp,
   * with no sequence. A read without a quality value for every call is not trimmed: 1..its length.
   */
  trimStart1based: number;
  trimEnd1based: number;
  errorProbabilityCutoff: number;
  expectedErrorsRaw: number;
  expectedErrorsTrimmed: number;
  meanPhredTrimmed: number;
  trimmedSequence: string;
  iupacHeterozygoteConsensus: string;
  heterozygoteCount: number;
}

export function trimSangerTraceMottPhredRust(
  chromatogram: ChromatogramData,
  errorCutoff = 0.05
): MottPhredTrimReport {
  return invokeRustBioSync<MottPhredTrimReport>('trim_sanger_trace_mott_phred', {
    chromatogram,
    errorCutoff,
  });
}

export function buildNcbiReferencePresetDocumentRust(
  preset: 'spike' | 'cas9',
  nowIso = new Date().toISOString()
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('build_ncbi_reference_preset_document', {
    preset,
    nowIso,
  });
}

export interface PoaReadInput {
  id: string;
  name: string;
  sequence: string;
  phredScores?: number[];
}

export interface PoaContigAssemblyReport {
  contigName: string;
  consensusSequence: string;
  consensusLengthBp: number;
  readCount: number;
  forwardReads: number;
  reverseComplementedReads: number;
  graphNodeCount: number;
  graphEdgeCount: number;
  graphBranchBubbles: number;
  meanCoverageX: number;
  pairwiseIdentityPct: number;
  disagreementsCount: number;
  coveragePerBase: number[];
  alignedReads: {
    id: string;
    name: string;
    strand: 1 | -1;
    rawLengthBp: number;
    postTrimLengthBp: number;
    alignedRow: string;
    poaScore: number;
    identityPct: number;
  }[];
  polymorphicSites: {
    consensusPos1based: number;
    consensusBase: string;
    altBases: string[];
    depth: number;
  }[];
  contigDocument: SequenceDocument;
}

export function assembleSangerContigPoaRust(
  reads: PoaReadInput[],
  contigName = 'POA_Consensus_Contig',
  trimLowQuality = true
): PoaContigAssemblyReport {
  return invokeRustBioSync<PoaContigAssemblyReport>('assemble_sanger_contig_poa', {
    reads,
    contigName,
    trimLowQuality,
  });
}

export function alignPairwiseBandedSparseRust(
  seq1: string,
  seq2: string,
  mode: 'global' | 'local' | 'semiglobal' = 'global',
  k = 6,
  w = 24,
  matchScore = 2,
  mismatchScore = -1,
  gapOpen = -5,
  gapExtend = -1,
  maxLen = 25000
) {
  return invokeRustBioSync<{
    alignedSeq1: string;
    alignedSeq2: string;
    midline: string;
    score: number;
    matches: number;
    mismatches: number;
    gaps: number;
    identityPct: number;
    similarityPct: number;
    xstart: number;
    xend: number;
    ystart: number;
    yend: number;
    cigar: string;
    algorithm: string;
    engineUsed: string;
  }>('align_pairwise_banded_sparse', {
    seq1,
    seq2,
    mode,
    k,
    w,
    matchScore,
    mismatchScore,
    gapOpen,
    gapExtend,
    maxLen,
  });
}

export interface NewickTreeLayoutReport {
  style: string;
  width: number;
  height: number;
  totalNodes: number;
  tipCount: number;
  internalCount: number;
  maxRootToTipDistance: number;
  totalTreeLength: number;
  rootX: number;
  rootY: number;
  svgPaths: {
    id: string;
    d: string;
    isTerminal: boolean;
    branchLength: number;
    targetLabel: string;
  }[];
  nodes: {
    nodeId: number;
    x: number;
    y: number;
    label: string;
    bootstrap: number | null;
    branchLength: number;
    depthDistance: number;
    isTip: boolean;
    isRoot: boolean;
    labelX: number;
    labelY: number;
    labelAngleDeg: number;
    textAnchor: 'start' | 'end' | 'middle';
  }[];
  scaleBar: {
    x1: number;
    x2: number;
    y: number;
    units: number;
    label: string;
  } | null;
}

export function layoutNewickPhylogeneticTreeRust(
  newick: string,
  style: 'phylogram' | 'cladogram' | 'radial',
  width = 800,
  height = 300
): NewickTreeLayoutReport {
  return invokeRustBioSync<NewickTreeLayoutReport>('layout_newick_phylogenetic_tree', {
    newick,
    style,
    width,
    height,
  });
}

export interface ComputedDocumentRowMetricsRust {
  docTypeLabel: string;
  iconKind: string;
  lengthNum: number;
  lengthLabel: string;
  gcPct: number;
  gcLabel: string;
  annotationsCount: number;
  numSequences: number;
  pairwiseIdentityPct: number | null;
  pairwiseIdentityLabel: string;
  identicalSitesPct: number | null;
  identicalSitesLabel: string;
  geneticCodeLabel: string;
  meanCoverageX: number | null;
  meanCoverageLabel: string;
  treeBuilderLabel: string;
  modifiedFormatted: string;
  createdFormatted: string;
  alertsCount: number;
  alertsSummary: string;
  /** How far the record checks got; an empty alert list is a clear record only when `complete` (BG-01M6S1B3). */
  checksState: RecordChecksState;
  /** The checks that did not run or did not finish, and why, in plain words; empty when every check ran in full. */
  checksNotRun: string;
}

/** `complete`: every record check ran on the whole record; `partial`: some did not run or did not finish; `not-run`: none ran. */
export type RecordChecksState = 'complete' | 'partial' | 'not-run';

export function computeDocumentTableMetricsRust(
  doc: SequenceDocument
): ComputedDocumentRowMetricsRust {
  return invokeRustBioSync<ComputedDocumentRowMetricsRust>(
    'compute_document_table_metrics_rust',
    { doc }
  );
}

export function exportTableDelimitedCsvRust(
  headers: string[],
  rows: string[][],
  delimiter = ','
): string {
  return invokeRustBioSync<string>('export_table_delimited_csv_rust', {
    headers,
    rows,
    delimiter,
  });
}

export function extractRegionWithAnnotationsRust(
  doc: SequenceDocument,
  start1Based: number,
  end1Based: number,
  nowIso = new Date().toISOString()
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('extract_region_with_annotations_rust', {
    doc,
    start1Based,
    end1Based,
    nowIso,
  });
}

export function spliceModularPartIntoDocumentRust(
  doc: SequenceDocument,
  part: unknown,
  positionBp: number,
  nowIso = new Date().toISOString()
): SequenceDocument {
  return invokeRustBioSync<SequenceDocument>('splice_modular_part_into_document_rust', {
    doc,
    part,
    positionBp,
    nowIso,
  });
}

export interface ConstructLineageDagReport {
  width: number;
  height: number;
  layerCount: number;
  isAcyclic: boolean;
  topologicalOrder: string[];
  ancestorDocumentCount: number;
  descendantDocumentCount: number;
  nodes: {
    nodeId: string;
    docId: string | null;
    title: string;
    subtitle: string;
    operation: string;
    timestamp: string;
    lengthBp: number;
    topology: Topology;
    color: string;
    isActiveTarget: boolean;
    isDocumentNode: boolean;
    layer: number;
    x: number;
    y: number;
  }[];
  edges: {
    id: string;
    fromId: string;
    toId: string;
    label: string;
    svgPath: string;
  }[];
}

export function buildConstructLineageDagRust(
  targetDoc: SequenceDocument,
  allDocs: SequenceDocument[]
): ConstructLineageDagReport {
  return invokeRustBioSync<ConstructLineageDagReport>('build_construct_lineage_dag_rust', {
    targetDoc,
    allDocs,
  });
}

export interface BuiltinWorkflowMacroDef {
  id: string;
  rustMacroId: string;
  name: string;
  category: string;
  description: string;
  code: string;
}

export function getBuiltinWorkflowMacrosRust(): BuiltinWorkflowMacroDef[] {
  return invokeRustBioSync<BuiltinWorkflowMacroDef[]>(
    'get_builtin_workflow_macros_rust',
    {}
  );
}

export interface CodonOptimizationResult {
  host: string;
  proteinSequence: string;
  optimizedDna: string;
  lengthBp: number;
  gcPercent: number;
  caiScore: number;
  removedForbiddenSites: number;
  engine: 'Rust Bioinformatics Engine';
}

interface RustCodonOptReport {
  hostOrganism: string;
  proteinSequence: string;
  optimizedDna: string;
  lengthBp: number;
  gcPercent: number;
  caiScore: number;
  removedForbiddenSites?: number;
}

export function optimizeCodonsRust(
  dnaSeq: string,
  host: 'ecoli_k12' | 'human_hek293' | 'yeast_scerevisiae'
): CodonOptimizationResult {
  const res = invokeRustBioSync<RustCodonOptReport>('optimize_codons', {
    seq: dnaSeq,
    isDna: true,
    host,
  });
  return {
    host,
    proteinSequence: res.proteinSequence,
    optimizedDna: res.optimizedDna,
    lengthBp: res.lengthBp,
    gcPercent: res.gcPercent,
    caiScore: res.caiScore,
    removedForbiddenSites: res.removedForbiddenSites ?? 0,
    engine: 'Rust Bioinformatics Engine',
  };
}
