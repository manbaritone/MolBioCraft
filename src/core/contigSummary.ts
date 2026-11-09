// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Contig-summary reference records: genome records whose annotations are known but whose bases
 * have not been downloaded. They carry an empty `sequence`, a `Declared Length`, and features at
 * true genomic coordinates. Nothing sequence-derived (GC, Tm, restriction sites, translations)
 * may be computed for them, and bases must never be synthesized.
 */

import type { SequenceDocument } from '../types/bio';

/** Largest record the interactive viewer will download in full (bases held in memory). */
export const MAX_SUMMARY_DOWNLOAD_BP = 12_000_000;

export function declaredLengthOf(doc: SequenceDocument): number {
  const raw = doc.docMetadata?.['Declared Length'] ?? doc.docMetadata?.['Sequence Length'];
  const n = Number(String(raw ?? '').replace(/,/g, ''));
  return Number.isFinite(n) && n > 0 ? n : doc.sequence.length;
}

export function isContigSummaryRecord(doc: SequenceDocument): boolean {
  return Boolean(doc.docMetadata?.['Is Contig Summary']) && doc.sequence.length === 0 &&
    declaredLengthOf(doc) > 0;
}

export function summaryDownloadUrl(accession: string): string {
  return `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=${
    encodeURIComponent(accession.trim())}&rettype=fasta&retmode=text`;
}

/** Parses a single-record FASTA payload; returns the upper-case residues. */
export function parseSingleFasta(text: string): string {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.startsWith('>')) throw new Error('The service did not return a FASTA record.');
  const second = lines.findIndex((l, i) => i > 0 && l.startsWith('>'));
  return lines.slice(1, second > 0 ? second : undefined).join('').replace(/\s+/g, '').toUpperCase();
}

/**
 * Downloads the full sequence of a summary record from NCBI and returns the completed document.
 * The download is accepted only if its length equals the declared length, so annotations stay
 * valid; otherwise an error is thrown and the record is left unchanged.
 */
export async function downloadSummarySequence(
  doc: SequenceDocument,
  fetchImpl: (url: string) => Promise<{ ok: boolean; status: number; text(): Promise<string> }> = fetch
): Promise<SequenceDocument> {
  const declared = declaredLengthOf(doc);
  if (!doc.accession) throw new Error('This record has no accession to download.');
  if (declared > MAX_SUMMARY_DOWNLOAD_BP) {
    throw new Error(`${declared.toLocaleString()} bp is larger than the ${MAX_SUMMARY_DOWNLOAD_BP.toLocaleString()} bp the interactive viewer can hold.`);
  }
  const resp = await fetchImpl(summaryDownloadUrl(doc.accession));
  if (!resp.ok) throw new Error(`NCBI returned HTTP ${resp.status} for ${doc.accession}.`);
  const sequence = parseSingleFasta(await resp.text());
  if (!/^[ACGTURYSWKMBDHVN]+$/.test(sequence)) throw new Error('The downloaded record contains non-nucleotide characters.');
  if (sequence.length !== declared) {
    throw new Error(`Downloaded ${sequence.length.toLocaleString()} bp but the record declares ${declared.toLocaleString()} bp; the annotations would no longer line up, so nothing was changed.`);
  }
  const meta = { ...(doc.docMetadata ?? {}) };
  delete meta['Is Contig Summary'];
  delete meta['First Residues'];
  const gc = (sequence.match(/[GCS]/g)?.length ?? 0) / sequence.length;
  meta['% GC'] = `${(gc * 100).toFixed(1)}%`;
  return { ...doc, sequence, docMetadata: meta, updatedAt: new Date().toISOString() };
}
