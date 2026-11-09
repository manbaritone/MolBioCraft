// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

const IUPAC_MAJORITY_MAP: Record<string, string> = {
  A: 'A',
  C: 'C',
  G: 'G',
  T: 'T',
  U: 'U',
  AC: 'M',
  AG: 'R',
  AT: 'W',
  AU: 'W',
  CG: 'S',
  CT: 'Y',
  CU: 'Y',
  GT: 'K',
  GU: 'K',
  ACG: 'V',
  ACT: 'H',
  ACU: 'H',
  AGT: 'D',
  AGU: 'D',
  CGT: 'B',
  CGU: 'B',
  ACGT: 'N',
  ACGU: 'N',
};

export function computeAlignmentConsensusAndIdentity(
  rows: { sequence: string }[],
  thresholdMode: string,
  ignoreGaps: boolean,
  isProtein = false
): { consensus: string; identityByCol: number[]; identicalSitesCount: number } {
  if (rows.length === 0) {
    return { consensus: '', identityByCol: [], identicalSitesCount: 0 };
  }
  const colLen = Math.max(...rows.map((r) => r.sequence.length), 0);
  const consChars: string[] = [];
  const identityByCol: number[] = [];
  let identicalSitesCount = 0;
  // [first, last] residue column of each row; outside it the row only has end gaps.
  const spans = rows.map((r) => {
    const seq = r.sequence;
    let first = 0;
    while (first < seq.length && seq[first] === '-') first++;
    let last = seq.length - 1;
    while (last >= first && seq[last] === '-') last--;
    return [first, last] as const;
  });

  const numericThr =
    thresholdMode === 'Majority' || thresholdMode === 'Most'
      ? -1
      : parseInt(thresholdMode.replace('%', ''), 10) || 0;

  for (let c = 0; c < colLen; c++) {
    const counts = new Map<string, number>();
    let nonGapTotal = 0;
    for (let r = 0; r < rows.length; r++) {
      const ch = (rows[r].sequence[c] ?? '-').toUpperCase();
      if (ch !== '-') {
        counts.set(ch, (counts.get(ch) ?? 0) + 1);
        nonGapTotal++;
      } else if (!ignoreGaps) {
        counts.set('-', (counts.get('-') ?? 0) + 1);
      }
    }
    const denom = ignoreGaps ? nonGapTotal : rows.length;
    if (counts.size === 0 || denom === 0) {
      consChars.push('-');
      identityByCol.push(0);
      continue;
    }
    const sorted = Array.from(counts.entries()).sort(
      (a, b) => b[1] - a[1] || a[0].localeCompare(b[0])
    );
    const topCount = sorted[0][1];
    // Identity = share of sequences carrying the most common residue (gaps never count as agreement).
    const topResidueCount = sorted.find((kv) => kv[0] !== '-')?.[1] ?? 0;
    const colIdentity = nonGapTotal > 0 ? topResidueCount / rows.length : 0;
    const ambiguityCode = (chars: string[]) => {
      if (isProtein) return 'X';
      const key = chars.slice().sort().join('');
      if (IUPAC_MAJORITY_MAP[key]) return IUPAC_MAJORITY_MAP[key];
      // Mixed residues with no IUPAC nucleotide code: N for nucleotides, X for amino acids.
      return chars.every((ch) => 'ACGTUNRYSWKMBDHV'.includes(ch)) ? 'N' : 'X';
    };
    identityByCol.push(colIdentity);
    // Identical site: every sequence spanning this column carries the same
    // residue. Sequences that have not started / have already ended (end gaps) are ignored;
    // an internal gap breaks identity.
    {
      let residue = '';
      let identical = true;
      let spanning = 0;
      for (let r = 0; r < rows.length && identical; r++) {
        if (c < spans[r][0] || c > spans[r][1]) continue;
        spanning++;
        const ch = (rows[r].sequence[c] ?? '-').toUpperCase();
        if (ch === '-' || (residue && ch !== residue)) identical = false;
        residue = ch;
      }
      if (identical && spanning > 0) identicalSitesCount++;
    }

    if (numericThr < 0) {
      // Majority (tie -> IUPAC ambiguity)
      const tied = sorted.filter((kv) => kv[1] === topCount && kv[0] !== '-').map((kv) => kv[0]);
      if (tied.length === 1) {
        consChars.push(tied[0]);
      } else {
        consChars.push(tied.length === 0 ? '-' : ambiguityCode(tied));
      }
    } else if (numericThr === 0) {
      consChars.push(sorted[0][0]);
    } else {
      // If gaps participate, an unmet threshold must not report a confident residue.
      if ((nonGapTotal / denom) * 100 < numericThr) {
        consChars.push('-');
        continue;
      }
      let acc = 0;
      let lastCount = 0;
      const chosen: string[] = [];
      for (const [b, cnt] of sorted) {
        if (b === '-') continue;
        // Once the threshold is met, residues tied with the last one chosen are equally
        // supported and must enter the ambiguity code rather than lose an alphabetical tie-break.
        if ((acc / denom) * 100 >= numericThr && cnt !== lastCount) break;
        chosen.push(b);
        acc += cnt;
        lastCount = cnt;
      }
      if (chosen.length === 1) {
        consChars.push(chosen[0]);
      } else if (chosen.length === 0) {
        consChars.push('-');
      } else {
        consChars.push(ambiguityCode(chosen));
      }
    }
  }

  return {
    consensus: consChars.join(''),
    identityByCol,
    identicalSitesCount,
  };
}

export function computeNonEndGapPairwiseMetric(
  seqA: string,
  seqB: string,
  metric: 'identity' | 'diffs' | 'p-dist' | 'jc69' | 'k2p'
): number {
  const len = Math.min(seqA.length, seqB.length);
  if (len === 0) return Number.NaN;

  let startA = 0;
  while (startA < len && seqA[startA] === '-') startA++;
  let endA = len - 1;
  while (endA >= startA && seqA[endA] === '-') endA--;

  let startB = 0;
  while (startB < len && seqB[startB] === '-') startB++;
  let endB = len - 1;
  while (endB >= startB && seqB[endB] === '-') endB--;

  const start = Math.max(startA, startB);
  const end = Math.min(endA, endB);
  if (end < start) return Number.NaN;

  let matches = 0;
  let diffs = 0;
  let transitions = 0;
  let transversions = 0;
  let validCols = 0;

  for (let i = start; i <= end; i++) {
    const model = metric === 'jc69' || metric === 'k2p';
    const a = model ? seqA[i].toUpperCase().replace('U', 'T') : seqA[i].toUpperCase();
    const b = model ? seqB[i].toUpperCase().replace('U', 'T') : seqB[i].toUpperCase();
    if (a === '-' && b === '-') continue;
    // p-distance uses pairwise deletion: indel columns are not substitutions,
    // keeping it consistent with the JC69/K2P corrections derived from it.
    if (metric === 'p-dist' && (a === '-' || b === '-')) continue;
    // Substitution models require unambiguous nucleotide pairs, not indels.
    if ((metric === 'jc69' || metric === 'k2p') && (!'ACGT'.includes(a) || !'ACGT'.includes(b))) continue;
    validCols++;
    if (a === b) {
      matches++;
    } else {
      diffs++;
      if (a !== '-' && b !== '-') {
        const pair = a < b ? `${a}${b}` : `${b}${a}`;
        if (pair === 'AG' || pair === 'CT' || pair === 'CU') {
          transitions++;
        } else {
          transversions++;
        }
      }
    }
  }

  if (validCols === 0) return Number.NaN;
  if (metric === 'diffs') return diffs;
  const p = diffs / validCols;
  if (metric === 'identity') return (matches / validCols) * 100;
  if (metric === 'p-dist') return p;
  if (metric === 'jc69') {
    const arg = 1 - (4 / 3) * p;
    return arg > 0 ? -0.75 * Math.log(arg) : Number.POSITIVE_INFINITY;
  }
  const P = transitions / validCols;
  const Q = transversions / validCols;
  const a1 = 1 - 2 * P - Q;
  const a2 = 1 - 2 * Q;
  if (a1 <= 0 || a2 <= 0) return Number.POSITIVE_INFINITY;
  return -0.5 * Math.log(a1) - 0.25 * Math.log(a2);
}


