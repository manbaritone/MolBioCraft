// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Locally installed tree-inference programs (FastTree, PhyML, RAxML, MrBayes), run by the
 * desktop backend. Nothing is bundled: when a program is not found, or in the browser
 * build, the studio falls back to its built-in Neighbor-Joining tree and says so.
 */

import { invokeTauriCommand, isTauriDesktopRuntime } from '../lib/tauriIpc';
import type { PhyloTreeAlgorithm } from './phyloEvoEngine';

export const EXTERNAL_TREE_ALGORITHMS = [
  'FastTree (Approx-ML)',
  'PhyML (ML + SH-aLRT)',
  'RAxML (GTR+G Rapid ML)',
  'MrBayes (Bayesian MCMC)',
] as const satisfies readonly PhyloTreeAlgorithm[];

export type ExternalTreeAlgorithm = (typeof EXTERNAL_TREE_ALGORITHMS)[number];

export const EXTERNAL_TREE_NAMES: Record<ExternalTreeAlgorithm, string> = {
  'FastTree (Approx-ML)': 'FastTree',
  'PhyML (ML + SH-aLRT)': 'PhyML',
  'RAxML (GTR+G Rapid ML)': 'RAxML',
  'MrBayes (Bayesian MCMC)': 'MrBayes',
};

export function isExternalTreeAlgorithm(a: string): a is ExternalTreeAlgorithm {
  return (EXTERNAL_TREE_ALGORITHMS as readonly string[]).includes(a);
}

export interface ExternalProgramStatus {
  algorithm: ExternalTreeAlgorithm;
  name: string;
  available: boolean;
  executablePath: string | null;
  installHint: string;
}

export interface ExternalTreeResult {
  algorithm: ExternalTreeAlgorithm;
  program: string;
  version: string | null;
  executablePath: string;
  commandLine: string;
  model: string;
  newick: string;
  supportKind: string;
  programLogLikelihood: number | null;
  totalBranchLength: number;
  runtimeMs: number;
  warnings: string[];
}

/** `null` = not the desktop app (programs cannot be run from a browser). */
let detection: Promise<ExternalProgramStatus[] | null> | null = null;

export function detectExternalTreePrograms(refresh = false): Promise<ExternalProgramStatus[] | null> {
  if (!isTauriDesktopRuntime()) return Promise.resolve(null);
  if (!detection || refresh) {
    detection = invokeTauriCommand('cmd_detect_tree_programs', {}).catch(() => {
      detection = null;
      return null;
    });
  }
  return detection;
}

let nextJobId = 1;
const resultCache = new Map<string, ExternalTreeResult>();

export function externalTreeCacheKey(algorithm: string, names: readonly string[], seqs: readonly string[]): string {
  // FNV-1a over the inputs; collisions only cost a recompute-free wrong cache hit, so
  // the key also carries sizes.
  let h = 0x811c9dc5;
  const feed = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    h ^= 0x1f;
  };
  names.forEach(feed);
  seqs.forEach(feed);
  return `${algorithm}|${names.length}|${seqs[0]?.length ?? 0}|${h.toString(16)}`;
}

export function cachedExternalTree(key: string): ExternalTreeResult | undefined {
  return resultCache.get(key);
}

/** Starts a run; `cancel()` stops the external process. */
export function runExternalTree(
  algorithm: ExternalTreeAlgorithm,
  names: string[],
  alignedSeqs: string[]
): { promise: Promise<ExternalTreeResult>; cancel: () => void } {
  const key = externalTreeCacheKey(algorithm, names, alignedSeqs);
  const jobId = nextJobId++;
  const promise = invokeTauriCommand('cmd_run_external_tree', { algorithm, names, alignedSeqs, jobId }).then(
    (r) => {
      if (resultCache.size > 32) resultCache.delete(resultCache.keys().next().value as string);
      resultCache.set(key, r);
      return r;
    }
  );
  return {
    promise,
    cancel: () => {
      void invokeTauriCommand('cmd_cancel_external_tree', { jobId }).catch(() => undefined);
    },
  };
}
