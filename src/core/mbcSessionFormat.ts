// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import {
  computeMbcPayloadChecksumRust,
  isMbcFileOrPayloadRust,
  parseMbcWorkbenchRust,
  serializeMbcWorkbenchRust,
} from '../lib/rustBioEngine';
import type { ProjectExplorerState } from './projectExplorer';
import { NucleotideColorScheme, SequenceDocument } from '../types/bio';

export const MBC_FORMAT_MAGIC = 'MBC_WORKBENCH_V1' as const;
export const MBC_SCHEMA_VERSION = '1.0.0' as const;
export const MBC_FILE_EXTENSION = '.mbc' as const;
export const MBC_MIME_TYPE = 'application/json;charset=utf-8' as const;
export const MBC_ZIP_MIME_TYPE = 'application/zip' as const;
const LOCAL_AUTOSAVE_KEY = 'molbiocraft.workbench.autosave.v1';
/**
 * Side-car flag recording whether the autosaved session held unsaved edits
 * when it was written. Stored under its own key so the .mbc autosave payload
 * format is unchanged.
 */
const LOCAL_AUTOSAVE_DIRTY_KEY = 'molbiocraft.workbench.autosave.v1.dirty';


export type MbcViewerTabId =
  | 'sequence-view'
  | 'annotations-table'
  | 'text-view'
  | 'vector-library'
  | 'cloning-gel'
  | 'primers-pcr'
  | 'sequence-alignment'
  | 'phylogenetics'
  | 'sanger-contig'
  | 'genomics-ngs'
  | 'history-hybrid'
  | 'guided-pipelines'
  | 'document-info';

export interface MbcDisplaySettings {
  showOrfs: boolean;
  minOrfAa: number;
  allowAltStartCodons: boolean;
  showPrimers: boolean;
  showTranslation: boolean;
  showGcGraph: boolean;
  showHydropathyGraph: boolean;
  showUniqueCuttersOnly: boolean;
}

export interface MbcWorkspaceUiState {
  projectExplorer?: ProjectExplorerState;
  activeDocId: string;
  selectedFolder: string;
  navHistory: string[];
  navIndex: number;
  viewerTab: MbcViewerTabId;
  mapLayoutMode: 'split' | 'circular' | 'linear';
  zoomLevel: number;
  textFormat: 'genbank' | 'fasta' | 'embl' | 'gff3';
  colorScheme: NucleotideColorScheme;
  darkMode: boolean;
  sidebarOpen: boolean;
  docTableCollapsed: boolean;
  selectedRange: { start: number; end: number; label?: string } | null;
  displaySettings: MbcDisplaySettings;
}

export interface MbcWorkbenchSnapshot {
  sessionName: string;
  documents: SequenceDocument[];
  workspace: MbcWorkspaceUiState;
}

export interface MbcWorkbenchFileEnvelope {
  format: 'MolBioCraft-Workbench';
  magic: typeof MBC_FORMAT_MAGIC;
  schemaVersion: string;
  appVersion: string;
  license: 'CC-BY-NC-4.0';
  savedAt: string;
  sessionName: string;
  documentCount: number;
  totalBasePairs: number;
  checksumFnv1a: string;
  checksumCrc32?: string;
  workspace: MbcWorkspaceUiState;
  documents: SequenceDocument[];
}

export interface ParsedMbcWorkbenchResult {
  envelope: MbcWorkbenchFileEnvelope;
  checksumVerified: boolean;
  warnings: string[];
}

export function computeMbcPayloadChecksum(documents: SequenceDocument[]): string {
  return computeMbcPayloadChecksumRust(
    documents.map((doc) => ({
      id: doc.id,
      name: doc.name,
      topology: doc.topology,
      moleculeType: doc.moleculeType,
      sequence: doc.sequence,
      featureCount: doc.features.length,
      primerCount: doc.primers.length,
    }))
  );
}

export function isMbcFileOrPayload(fileName: string, rawText?: string): boolean {
  const lower = (fileName || '').trim().toLowerCase();
  if (lower.endsWith('.mcb') || lower.endsWith('.mbc')) {
    return true;
  }
  return isMbcFileOrPayloadRust(fileName, rawText);
}

export function serializeMbcWorkbench(
  snapshot: MbcWorkbenchSnapshot,
  appVersion = '1.0.0'
): string {
  return serializeMbcWorkbenchRust(snapshot, appVersion, new Date().toISOString());
}

export function parseMbcWorkbench(
  rawText: string,
  fallbackSessionName = 'Imported_Session'
): ParsedMbcWorkbenchResult {
  const cleanedFallback = fallbackSessionName.replace(/\.(mbc|mcb)$/i, '') || 'Imported_Session';
  return parseMbcWorkbenchRust<ParsedMbcWorkbenchResult>(
    rawText,
    cleanedFallback,
    new Date().toISOString()
  );
}

export interface MbcZipEntry {
  path: string;
  data: Uint8Array;
}

const CRC32_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export function computeCrc32Bytes(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC32_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function sanitizeZipSegment(segment: string): string {
  const cleaned = segment
    .trim()
    .replace(/[\\/:*?"<>|\x00-\x1f]/g, '_')
    .replace(/\s+/g, '_');
  return cleaned || 'Untitled';
}

export function isMbcZipArchiveBytes(input: Uint8Array | ArrayBuffer): boolean {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  return (
    bytes.length >= 4 &&
    bytes[0] === 0x50 &&
    bytes[1] === 0x4b &&
    bytes[2] === 0x03 &&
    bytes[3] === 0x04
  );
}

export function createZipArchiveBytes(entries: MbcZipEntry[]): Uint8Array {
  const encoder = new TextEncoder();
  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let localOffset = 0;

  for (const entry of entries) {
    const normalizedPath = entry.path.replace(/^\/+/, '').replace(/\\/g, '/');
    const nameBytes = encoder.encode(normalizedPath);
    const dataBytes = entry.data;
    const crc = computeCrc32Bytes(dataBytes);
    const size = dataBytes.length;

    // Local file header (30 bytes + filename)
    const localHeader = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(localHeader.buffer);
    lv.setUint32(0, 0x04034b50, true); // PK\x03\x04
    lv.setUint16(4, 20, true); // Version needed to extract (2.0)
    lv.setUint16(6, 0x0800, true); // UTF-8 filename flag
    lv.setUint16(8, 0, true); // Compression method 0 (Store)
    lv.setUint16(10, 0, true); // Mod time
    lv.setUint16(12, 0x5621, true); // Mod date
    lv.setUint32(14, crc, true);
    lv.setUint32(18, size, true);
    lv.setUint32(22, size, true);
    lv.setUint16(26, nameBytes.length, true);
    lv.setUint16(28, 0, true); // Extra field length
    localHeader.set(nameBytes, 30);

    localParts.push(localHeader, dataBytes);

    // Central directory header (46 bytes + filename)
    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(centralHeader.buffer);
    cv.setUint32(0, 0x02014b50, true); // PK\x01\x02
    cv.setUint16(4, 20, true); // Version made by
    cv.setUint16(6, 20, true); // Version needed
    cv.setUint16(8, 0x0800, true); // UTF-8 flag
    cv.setUint16(10, 0, true); // Store
    cv.setUint16(12, 0, true); // Mod time
    cv.setUint16(14, 0x5621, true); // Mod date
    cv.setUint32(16, crc, true);
    cv.setUint32(20, size, true);
    cv.setUint32(24, size, true);
    cv.setUint16(28, nameBytes.length, true);
    cv.setUint16(30, 0, true); // Extra length
    cv.setUint16(32, 0, true); // Comment length
    cv.setUint16(34, 0, true); // Disk number
    cv.setUint16(36, 0, true); // Internal attrs
    cv.setUint32(38, 0, true); // External attrs
    cv.setUint32(42, localOffset, true);
    centralHeader.set(nameBytes, 46);

    centralParts.push(centralHeader);
    localOffset += localHeader.length + size;
  }

  let centralSize = 0;
  for (const part of centralParts) {
    centralSize += part.length;
  }

  // End of central directory record (22 bytes)
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true); // PK\x05\x06
  ev.setUint16(4, 0, true);
  ev.setUint16(6, 0, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, centralSize, true);
  ev.setUint32(16, localOffset, true);
  ev.setUint16(20, 0, true);

  const totalLength = localOffset + centralSize + eocd.length;
  const output = new Uint8Array(totalLength);
  let cursor = 0;
  for (const part of localParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  for (const part of centralParts) {
    output.set(part, cursor);
    cursor += part.length;
  }
  output.set(eocd, cursor);
  return output;
}

export function extractZipArchiveEntries(input: Uint8Array | ArrayBuffer): MbcZipEntry[] {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  if (!isMbcZipArchiveBytes(bytes)) {
    throw new Error('Invalid MBC folder archive: missing PKZIP header');
  }
  const decoder = new TextDecoder('utf-8');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries: MbcZipEntry[] = [];
  let offset = 0;

  while (offset + 30 <= bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) {
      break;
    }
    const compressionMethod = view.getUint16(offset + 8, true);
    const compressedSize = view.getUint32(offset + 18, true);
    const fileNameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + fileNameLen + extraLen;
    if (dataStart + compressedSize > bytes.length) {
      break;
    }
    const path = decoder.decode(bytes.subarray(nameStart, nameStart + fileNameLen));
    if (compressionMethod === 0 && !path.endsWith('/')) {
      const data = bytes.slice(dataStart, dataStart + compressedSize);
      entries.push({ path, data });
    }
    offset = dataStart + compressedSize;
  }
  return entries;
}

export function serializeMbcFolderZip(
  snapshot: MbcWorkbenchSnapshot,
  folderScopeLabel?: string,
  appVersion = '1.0.0'
): Uint8Array {
  const encoder = new TextEncoder();
  const rootFolder = sanitizeZipSegment(
    folderScopeLabel || snapshot.sessionName || 'MolBioCraft_Folder'
  );
  const workbenchJson = serializeMbcWorkbench(snapshot, appVersion);

  const entries: MbcZipEntry[] = [
    {
      path: `${rootFolder}/workbench.mbc.json`,
      data: encoder.encode(workbenchJson),
    },
  ];

  const usedPaths = new Set<string>([`${rootFolder}/workbench.mbc.json`]);

  for (let i = 0; i < snapshot.documents.length; i++) {
    const doc = snapshot.documents[i];
    const folderDir = sanitizeZipSegment(doc.folder || 'Local');
    const baseName = sanitizeZipSegment(doc.name || `Sequence_${i + 1}`);
    let docJsonPath = `${rootFolder}/${folderDir}/${baseName}.mbc.json`;
    if (usedPaths.has(docJsonPath)) {
      docJsonPath = `${rootFolder}/${folderDir}/${baseName}_${i + 1}.mbc.json`;
    }
    usedPaths.add(docJsonPath);

    const singleDocEnvelope = {
      format: 'MolBioCraft-Document-JSON',
      magic: MBC_FORMAT_MAGIC,
      schemaVersion: MBC_SCHEMA_VERSION,
      appVersion,
      exportedAt: new Date().toISOString(),
      folder: doc.folder,
      document: doc,
    };
    entries.push({
      path: docJsonPath,
      data: encoder.encode(JSON.stringify(singleDocEnvelope, null, 2)),
    });

    const fastaHeader = `>${doc.name} [${doc.accession || doc.id}] ${doc.description || ''}`.trim();
    const fastaPath = docJsonPath.replace(/\.mbc\.json$/, '.fasta');
    entries.push({
      path: fastaPath,
      data: encoder.encode(`${fastaHeader}\n${doc.sequence}\n`),
    });
  }

  return createZipArchiveBytes(entries);
}

export function parseMbcFolderZip(
  input: Uint8Array | ArrayBuffer,
  fallbackSessionName = 'Imported_Folder'
): ParsedMbcWorkbenchResult {
  const entries = extractZipArchiveEntries(input);
  const decoder = new TextDecoder('utf-8');

  // 1. Prefer root workbench.mbc.json or workbench.json if present
  const workbenchEntry = entries.find(
    (e) =>
      e.path.endsWith('/workbench.mbc.json') ||
      e.path === 'workbench.mbc.json' ||
      e.path.endsWith('/workbench.json') ||
      e.path === 'workbench.json'
  );
  if (workbenchEntry) {
    const rawJson = decoder.decode(workbenchEntry.data);
    return parseMbcWorkbench(rawJson, fallbackSessionName);
  }

  // 2. Otherwise reconstruct workbench from individual *.mbc.json / *.json document files inside the ZIP folder
  const collectedDocs: SequenceDocument[] = [];
  for (const entry of entries) {
    if (!entry.path.toLowerCase().endsWith('.json')) continue;
    try {
      const parsedObj = JSON.parse(decoder.decode(entry.data)) as Record<string, unknown>;
      if (parsedObj.magic === MBC_FORMAT_MAGIC && Array.isArray(parsedObj.documents)) {
        return parseMbcWorkbench(decoder.decode(entry.data), fallbackSessionName);
      }
      if (parsedObj.document && typeof parsedObj.document === 'object') {
        collectedDocs.push(parsedObj.document as SequenceDocument);
      } else if (typeof parsedObj.sequence === 'string' && typeof parsedObj.name === 'string') {
        collectedDocs.push(parsedObj as unknown as SequenceDocument);
      }
    } catch {
      // Ignore non-document JSON files
    }
  }

  if (collectedDocs.length === 0) {
    throw new Error('MBC folder archive did not contain any valid JSON sequence documents.');
  }

  const cleanName = fallbackSessionName.replace(/\.(mbc|mcb|zip)$/i, '') || 'Imported_Folder';
  const syntheticSnapshot: MbcWorkbenchSnapshot = {
    sessionName: cleanName,
    documents: collectedDocs,
    workspace: {
      activeDocId: collectedDocs[0].id,
      selectedFolder: collectedDocs[0].folder || 'All Project Files',
      navHistory: [collectedDocs[0].id],
      navIndex: 0,
      viewerTab: 'sequence-view',
      mapLayoutMode: 'split',
      zoomLevel: 100,
      textFormat: 'genbank',
      colorScheme: 'standard',
      darkMode: false,
      sidebarOpen: true,
      docTableCollapsed: false,
      selectedRange: null,
      displaySettings: {
        showOrfs: true,
        minOrfAa: 50,
        allowAltStartCodons: false,
        showPrimers: true,
        showTranslation: true,
        showGcGraph: false,
        showHydropathyGraph: false,
        showUniqueCuttersOnly: false,
      },
    },
  };
  const serialized = serializeMbcWorkbench(syntheticSnapshot);
  return parseMbcWorkbench(serialized, cleanName);
}

export function saveWorkbenchToLocalAutosave(snapshot: MbcWorkbenchSnapshot): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    localStorage.setItem(LOCAL_AUTOSAVE_KEY, serializeMbcWorkbench(snapshot));
    return true;
  } catch {
    return false;
  }
}

export function loadWorkbenchFromLocalAutosave(): ParsedMbcWorkbenchResult | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(LOCAL_AUTOSAVE_KEY);
    if (!raw) return null;
    return parseMbcWorkbench(raw, 'Autosaved_Session');
  } catch {
    return null;
  }
}

export function clearWorkbenchLocalAutosave(): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem(LOCAL_AUTOSAVE_KEY);
      localStorage.removeItem(LOCAL_AUTOSAVE_DIRTY_KEY);
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
}

/** Cheap existence check that does not parse the (potentially multi-MB) autosave payload. */
export function hasWorkbenchLocalAutosave(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return Boolean(localStorage.getItem(LOCAL_AUTOSAVE_KEY));
  } catch {
    return false;
  }
}

export function writeWorkbenchAutosaveDirtyFlag(dirty: boolean): void {
  try {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(LOCAL_AUTOSAVE_DIRTY_KEY, dirty ? '1' : '0');
    }
  } catch {
    // Ignore storage access errors in restricted environments
  }
}

/**
 * True when an autosave exists that may hold work the user has not saved
 * elsewhere. Autosaves written by older builds (no flag) are treated as
 * unsaved, which errs on the side of not discarding them silently.
 */
export function workbenchAutosaveNeedsRecovery(): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    if (!localStorage.getItem(LOCAL_AUTOSAVE_KEY)) return false;
    return localStorage.getItem(LOCAL_AUTOSAVE_DIRTY_KEY) !== '0';
  } catch {
    return false;
  }
}
