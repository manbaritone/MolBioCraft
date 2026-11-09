// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import type { BlastHitRecord, SequenceDocument } from '../types/bio';

export interface LocalSequenceDbEntry {
  id: string;
  name: string;
  moleculeType: 'Nucleotide' | 'Protein';
  sourceFolder: string;
  sequenceCount: number;
  /** Custom database: exactly these documents (Make BLAST Database from Selection). */
  docIds?: string[];
}

/**
 * Documents that make up a local BLAST database: its chosen documents, or its source folder
 * (or the whole project), restricted to its molecule type.
 */
export function localBlastDbDocuments(
  entry: Pick<LocalSequenceDbEntry, 'moleculeType' | 'sourceFolder' | 'docIds'>,
  docs: readonly SequenceDocument[]
): SequenceDocument[] {
  const wantProtein = entry.moleculeType === 'Protein';
  const ids = entry.docIds ? new Set(entry.docIds) : null;
  return docs.filter(
    (d) =>
      d.sequence.length > 0 &&
      (d.moleculeType === 'Protein') === wantProtein &&
      (ids
        ? ids.has(d.id)
        : entry.sourceFolder === 'All Project Files' ||
          d.folder === entry.sourceFolder ||
          d.folder.startsWith(`${entry.sourceFolder}/`))
  );
}

const STORE = 'molbiocraft.localBlastDbs.v1';

/** User-made databases saved in this browser (the built-in ones are not stored). */
export function loadStoredBlastDbs(): LocalSequenceDbEntry[] {
  try {
    const raw = localStorage.getItem(STORE);
    const list = raw ? (JSON.parse(raw) as LocalSequenceDbEntry[]) : [];
    return Array.isArray(list) ? list.filter((d) => d && typeof d.id === 'string' && typeof d.name === 'string') : [];
  } catch {
    return [];
  }
}

export function storeBlastDbs(list: LocalSequenceDbEntry[]): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(list));
  } catch {
    /* storage unavailable: databases last for this session */
  }
}

/**
 * Query-centric alignment: every hit's subject written in query
 * coordinates — columns where the query has a residue; subject insertions relative to the query
 * are dropped and positions outside the HSP are gaps.
 *
 * The local BLAST engine keeps only the first 120 alignment columns of each HSP for display;
 * when a hit spans more, `realign` (given the subject sequence) supplies the full alignment.
 */
export function queryCentricRows(
  querySeq: string,
  hits: readonly BlastHitRecord[],
  realign?: (hit: BlastHitRecord) => { alignedQuery: string; alignedSubject: string } | null
): { name: string; sequence: string; hit: BlastHitRecord; realigned: boolean }[] {
  const L = querySeq.length;
  return hits.map((h) => {
    const qs = Math.min(h.queryStart, h.queryEnd);
    const qe = Math.max(h.queryStart, h.queryEnd);
    const residues = [...h.alignedQuery].filter((c) => c !== '-').length;
    let aq = h.alignedQuery;
    let as = h.alignedSubject;
    let realigned = false;
    if (residues < qe - qs + 1 && realign) {
      const r = realign(h);
      if (r) { aq = r.alignedQuery; as = r.alignedSubject; realigned = true; }
    }
    const row = new Array<string>(L).fill('-');
    let qpos = qs - 1;
    for (let c = 0; c < aq.length; c++) {
      if (aq[c] === '-') continue;
      if (qpos >= 0 && qpos < L) row[qpos] = as[c] ?? '-';
      qpos++;
    }
    return { name: `${h.accession || h.id} (${h.identityPct}%)`, sequence: row.join(''), hit: h, realigned };
  });
}
