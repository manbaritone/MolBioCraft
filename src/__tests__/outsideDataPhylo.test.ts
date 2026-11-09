// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Phylogenetics against outside references in the git-ignored `test-data/reference/` folder:
 * R ape / phangorn / pegas (`scripts/outside-data/ref_phylo.R`), IQ-TREE and PAML yn00
 * (`ref_phylo_tools.py`), on the MrBayes primate mtDNA and PAML codon alignments.
 * Skipped when the reference files are absent.
 *
 * The alignments themselves are GPL-3.0 and never committed (D0016): `fetch.sh` downloads them, the
 * committed JSON records the SHA-256 of each file and of the alignment the reference tool read from
 * it, and a test that needs one skips, naming it, when it is absent, and fails when the fetched file
 * or the alignment read from it differs from those checksums.
 */

import { describe, expect, it } from 'vitest';
import { analyzeUserTree, computeEvolutionaryDistances, constructPhylogeneticTree, estimateGammaAndSiteRates, findBestSubstitutionModels, mlTreeSearch, runMolecularClockAndTimetree, runSelectionAndNeutralityTests } from '../core/phyloEvoEngine';
import { parseNewick, leafNames, type TreeNode } from '../core/treeConsensus';
import { fullMatrix, searchTree } from '../core/treeSearch';
import { dataPath, haveTestData } from './testData';

interface NodeFs { existsSync: (p: string) => boolean; readFileSync: (p: string, e?: string) => string & Uint8Array }
interface NodeCrypto { createHash: (a: string) => { update: (d: string | Uint8Array) => { digest: (e: 'hex') => string } } }
let fs: NodeFs | null = null;
let crypto: NodeCrypto | null = null;
try { const spec: string = 'node:fs'; fs = (await import(/* @vite-ignore */ spec)) as NodeFs; } catch { fs = null; }
try { const spec: string = 'node:crypto'; crypto = (await import(/* @vite-ignore */ spec)) as NodeCrypto; } catch { crypto = null; }
const R_FILE = dataPath('reference/phylo_r.json');
const T_FILE = dataPath('reference/phylo_tools.json');
const have = haveTestData(R_FILE, T_FILE);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const R: any = have ? JSON.parse(fs!.readFileSync(R_FILE, 'utf8')) : null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: any = have ? JSON.parse(fs!.readFileSync(T_FILE, 'utf8')) : null;

// The GPL-3.0 inputs, fetched by scripts/outside-data/fetch.sh (D0016)
const PRIMATES = 'mrbayes/primates.nex';
const PAML = ['paml/HIVenvSweden.txt', 'paml/lysozymeSmall.txt'];
const havePrimates = have && haveTestData(PRIMATES);
const havePaml = have && haveTestData(...PAML);
const itPrimates = it.skipIf(!havePrimates);

const sha256 = (d: string | Uint8Array): string => crypto!.createHash('sha256').update(d).digest('hex');

/** The MATRIX rows of a non-interleaved NEXUS file, upper-cased, in file order. */
function readNexusMatrix(text: string): [string[], string[]] {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rows = lines.slice(lines.findIndex((l) => l.toLowerCase() === 'matrix') + 1);
  const body = rows.slice(0, rows.findIndex((l) => l.startsWith(';'))).filter(Boolean).map((l) => l.split(/\s+/));
  return [body.map((r) => r[0]), body.map((r) => r.slice(1).join('').toUpperCase())];
}

/** PAML's sequential format, read as `ref_phylo_tools.py` reads it. */
function readPamlSeqs(text: string): [string[], string[]] {
  const lines = text.split('\n').map((l) => l.trimEnd());
  const [n, len] = lines[0].trim().split(/\s+/).map(Number);
  const body = lines.slice(1).filter((l) => l.trim());
  const names: string[] = [];
  const seqs: string[] = [];
  const residues = (s: string) => s.replace(/[^A-Za-z\-?]/g, '');
  let i = 0;
  while (names.length < n && i < body.length) {
    const [name, ...rest] = body[i++].trim().split(/\s+/);
    let s = residues(rest.join(''));
    while (s.length < len && i < body.length) s += residues(body[i++]);
    names.push(name);
    seqs.push(s.slice(0, len).toUpperCase());
  }
  return [names, seqs];
}

/**
 * A fetched GPL-3.0 alignment, checked first against the SHA-256 that `doc.inputs[rel]` records for
 * the file and for the alignment the reference tool read from it ("name<TAB>sequence" lines).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function fetchedAlignment(doc: any, rel: string, read: (text: string) => [string[], string[]]): [string[], string[]] {
  const want = doc?.inputs?.[rel];
  if (!want) throw new Error(`${rel}: the reference JSON records no checksum for it`);
  const bytes = fs!.readFileSync(dataPath(rel));
  const got = sha256(bytes);
  if (got !== want.sha256) throw new Error(`${rel}: the fetched file has SHA-256 ${got}, but the references were computed from ${want.sha256}`);
  const [names, seqs] = read(new TextDecoder().decode(bytes));
  const aln = sha256(names.map((x, k) => `${x}\t${seqs[k]}`).join('\n'));
  if (aln !== want.alignment_sha256) throw new Error(`${rel}: the alignment read here has SHA-256 ${aln}, not ${want.alignment_sha256} as the reference tool read it`);
  return [names, seqs];
}
let primates: [string[], string[]] | undefined;
const primateAlignment = (): [string[], string[]] => (primates ??= fetchedAlignment(R, PRIMATES, readNexusMatrix));

/** Engine numbers are `null` when not computable. */
const num = (x: number | null | undefined): number => x ?? NaN;

/** Non-trivial splits of an unrooted tree, as sorted tip-name keys of the side without the first tip. */
function splits(t: TreeNode): Set<string> {
  const all = leafNames(t).sort();
  const out = new Set<string>();
  const walk = (n: TreeNode): string[] => {
    const tips = n.children?.length ? n.children.flatMap(walk) : [n.name ?? ''];
    if (tips.length > 1 && tips.length < all.length - 1) {
      const side = tips.includes(all[0]) ? all.filter((x) => !tips.includes(x)) : tips;
      if (side.length > 1 && side.length < all.length - 1) out.add([...side].sort().join(','));
    }
    return tips;
  };
  walk(t);
  return out;
}
const rf = (a: string, b: string) => {
  const x = splits(parseNewick(a));
  const y = splits(parseNewick(b));
  return [...x].filter((s) => !y.has(s)).length + [...y].filter((s) => !x.has(s)).length;
};

describe.skipIf(!have)('phylogenetics against ape / phangorn / IQ-TREE / PAML', () => {
  itPrimates('pairwise distances match ape::dist.dna (pairwise deletion)', () => {
    const [names, seqs] = primateAlignment();
    const models: [string, string, number][] = [['p-distance', 'raw', 1e-4], ['Jukes-Cantor (JC69)', 'JC69', 1e-4], ['Kimura 2-parameter (K2P)', 'K80', 1e-4], ['Tamura 3-parameter (T92)', 'T92', 1e-4], ['Tamura-Nei (TN93)', 'TN93', 1e-4]];
    const report: string[] = [];
    for (const [model, key, tol] of models) {
      const d = computeEvolutionaryDistances(names, seqs, model as never);
      let worst = 0;
      for (let i = 0; i < names.length; i++) for (let j = 0; j < i; j++) worst = Math.max(worst, Math.abs(num(d.pairwiseMatrix[i][j]) - R.dist[key][i][j]));
      report.push(`${model}: worst |Δ| ${worst.toExponential(2)}`);
      expect(worst, `${model} vs ape ${key}\n${report.join('\n')}`).toBeLessThanOrEqual(tol);
    }
  });

  itPrimates('Neighbor-Joining gives the ape::nj topology', () => {
    const [names, seqs] = primateAlignment();
    const t = constructPhylogeneticTree(names, seqs, 'Neighbor-Joining (NJ)' as never, 'Kimura 2-parameter (K2P)' as never, 0);
    expect(rf(t.newick, R.nj_k80), t.newick).toBe(0);
    expect(t.parsimonySteps).toBe(R.fitch_nj);
  });

  itPrimates('maximum parsimony reaches the phangorn::pratchet best length', async () => {
    const [names, seqs] = primateAlignment();
    const D = (s: string[]) => fullMatrix(computeEvolutionaryDistances(names, s, 'p-distance' as never).pairwiseMatrix, s.length);
    const r = await searchTree({ method: 'MP', labels: names, seqs, protein: false, distances: D, randomAdditions: 10, resampling: 'none', replicates: 0 } as never);
    expect(r.score).toBe(R.mp_best);
  });

  itPrimates('log-likelihood of a fixed tree matches IQ-TREE / phangorn', () => {
    const [names, seqs] = primateAlignment();
    const u = analyzeUserTree(R.nj_k80, names, seqs);
    // the user-tree analysis reports a JC69 likelihood with optimised branch lengths
    expect(Math.abs(num(u.mlLogLikelihood) - TOOLS.iqtree['JC/fixed'].logLik), `app ${u.mlLogLikelihood} vs IQ-TREE ${TOOLS.iqtree['JC/fixed'].logLik}`).toBeLessThan(0.5);
  });

  itPrimates('ML tree search reaches the IQ-TREE optimum', () => {
    const [names, seqs] = primateAlignment();
    for (const [model, key] of [['HKY+G', 'HKY+G4/search'], ['GTR+G', 'GTR+G4/search'], ['JC', 'JC/search']]) {
      const r = mlTreeSearch(names, seqs, model);
      const ref = TOOLS.iqtree[key];
      expect(r.logLikelihood, `${model}: app ${r.logLikelihood} vs IQ-TREE ${ref.logLik}`).toBeGreaterThan(ref.logLik - 1);
      expect(rf(r.newick, ref.tree), `${model} topology`).toBeLessThanOrEqual(2);
    }
  });

  itPrimates('Tajima D, π and θ match pegas (complete deletion of gap columns)', () => {
    const [, seqs] = primateAlignment();
    const r = runSelectionAndNeutralityTests(seqs);
    const cd = R.complete_deletion;
    expect(r.tajimaNeutrality.segregatingSitesS).toBe(cd.seg_sites);
    expect(r.tajimaNeutrality.nucleotideDiversityPi).toBeCloseTo(cd.nuc_div, 3);
    expect(r.tajimaNeutrality.tajimaD).toBeCloseTo(cd.tajima[0], 2);
  });

  it.skipIf(!havePaml)('pairwise dN and dS match PAML yn00 (Nei–Gojobori 1986)', () => {
    const report: string[] = [];
    let worst = 0;
    for (const [file, y] of Object.entries(TOOLS.yn00) as [string, { input: string; ng86: Record<string, { dN: number; dS: number }> }][]) {
      const [, seqs] = fetchedAlignment(TOOLS, y.input, readPamlSeqs);
      for (const [k, v] of Object.entries(y.ng86)) {
        const [i, j] = k.split('-').map(Number);
        const r = runSelectionAndNeutralityTests([seqs[i], seqs[j]]);
        const dev = Math.max(Math.abs(num(r.dN) - v.dN), Math.abs(num(r.dS) - v.dS));
        worst = Math.max(worst, dev);
        if (dev > 0.0001) report.push(`${file} ${k}: app dN ${num(r.dN).toFixed(4)} dS ${num(r.dS).toFixed(4)} vs yn00 ${v.dN} ${v.dS}`);
      }
    }
    expect(worst, report.slice(0, 20).join('\n')).toBeLessThanOrEqual(0.0001);
  });

  itPrimates('model selection: every model fitted on the NJ topology matches IQ-TREE log-likelihoods', () => {
    const [, seqs] = primateAlignment();
    const rows = findBestSubstitutionModels(seqs);
    const iq: Record<string, string> = { JC: 'JC', K2: 'K2P', HKY: 'HKY', TN93: 'TN', GTR: 'GTR' };
    const report: string[] = [];
    let worst = 0;
    for (const row of rows) {
      const [base, ...rest] = row.model.split('+');
      const fam = iq[base];
      if (!fam) continue;
      const key = `${fam}${rest.includes('I') ? '+I' : ''}${rest.includes('G') ? '+G4' : ''}/fixed`;
      const ref = TOOLS.iqtree[key];
      if (!ref) continue;
      const d = row.logLikelihood - ref.logLik;
      worst = Math.min(worst, d);
      report.push(`${row.model}: app ${row.logLikelihood} IQ-TREE ${ref.logLik} (${d >= 0 ? '+' : ''}${d.toFixed(3)})`);
    }
    expect(report.length, 'models compared').toBeGreaterThanOrEqual(16);
    expect(worst, report.join('\n')).toBeGreaterThan(-0.5);
    // the BIC winner is one of the models IQ-TREE also fits best
    expect(['HKY+G', 'TN93+G', 'GTR+G', 'HKY+G+I', 'TN93+G+I']).toContain(rows[0].model);
  });

  itPrimates('site rates: the Γ shape matches IQ-TREE / phangorn (TN93+G4)', () => {
    const [, seqs] = primateAlignment();
    const r = estimateGammaAndSiteRates(seqs, 4);
    const ref = TOOLS.iqtree['TN+G4/fixed'].alpha;
    expect(Math.abs(num(r.gammaShapeAlpha) - ref) / ref, `app α ${r.gammaShapeAlpha} vs IQ-TREE ${ref}`).toBeLessThan(0.03);
  });

  itPrimates('molecular clock test: likelihoods with and without a clock match phangorn', () => {
    const [names, seqs] = primateAlignment();
    const r = runMolecularClockAndTimetree(names, seqs);
    const c = R.clock;
    expect(Math.abs(num(r.clockTestML.lnLWithoutClock) - c.free), `free ${r.clockTestML.lnLWithoutClock} vs ${c.free}`).toBeLessThan(0.5);
    expect(Math.abs(num(r.clockTestML.lnLWithClock) - c.clock), `clock ${r.clockTestML.lnLWithClock} vs ${c.clock}`).toBeLessThan(1);
  });

  it('protein ML search (LG, WAG, JTT, +Γ) reaches the IQ-TREE optimum without external programs', () => {
    const P = TOOLS.protein;
    const report: string[] = [];
    for (const [model, key] of [['LG', 'LG'], ['LG+G', 'LG+G4'], ['WAG+G', 'WAG+G4'], ['JTT+G', 'JTT+G4']]) {
      const t0 = Date.now();
      const r = mlTreeSearch(P.names, P.seqs, model);
      const ref = P.iqtree[key];
      report.push(`${model}: app ${r.logLikelihood} vs IQ-TREE ${ref.logLik} (RF ${rf(r.newick, ref.tree)}, ${Date.now() - t0} ms)`);
      expect(r.logLikelihood, report.join('\n')).toBeGreaterThan(ref.logLik - 2);
    }
    console.log('PROT', report.join('; '));
  }, 600000);
});
