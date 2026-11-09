// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { SAMPLE_LIBRARY } from '../data/sampleLibrary';
import { runBuildTree } from '../core/operationRunners';
import { leafNames, parseNewick } from '../core/treeConsensus';
import type { SequenceDocument } from '../types/bio';

const aln = SAMPLE_LIBRARY.find((d) => d.id === 'doc-aln-coxii-cds')!;
const members: SequenceDocument[] = aln.alignmentMeta!.sequences!.slice(0, 12).map((m, i) => ({
  ...aln, id: `m${i}`, name: m.name, sequence: m.sequence, alignmentMeta: undefined, features: [], documentKind: undefined,
} as SequenceDocument));

describe('Build Tree: built-in maximum likelihood', () => {
  it('saves an ML tree with its likelihood, model parameters and bootstrap support', async () => {
    const r = await runBuildTree(members, { method: 'Maximum Likelihood (ML)', mlModel: 'HKY', mlGamma: true, resampling: 'bootstrap', replicates: 5 }, { sourceLabel: 'COXII' });
    const doc = r.created[0];
    const meta = doc.docMetadata!;
    expect(String(meta['Tree method'])).toMatch(/Maximum Likelihood \(NNI search\), HKY\+G/);
    expect(Number(meta['ML log likelihood'])).toBeGreaterThanOrEqual(Number(meta['Starting tree ln L (NJ)']));
    expect(String(meta['Model parameters'])).toMatch(/Γ shape α = /);
    expect(String(meta['Branch support'])).toMatch(/bootstrap, 5 replicates/);
    const tree = parseNewick(String(meta.Newick));
    expect(leafNames(tree)).toHaveLength(12);
    expect(String(meta.Newick)).toMatch(/\)\d+:/);
  }, 120000);
  it('builds protein trees with the built-in LG / WAG / JTT models (no external program)', async () => {
    const globins = [
      ['HBB_HUMAN', 'MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH'],
      ['HBB_HORSE', 'VQLSGEEKAAVLALWDKVNEEEVGGEALGRLLVVYPWTQRFFDSFGDLSNPGAVMGNPKVKAHGKKVLHSFGEGVHHLDNLKGTFAALSELHCDKLHVDPENFRLLGNVLVVVLARHFGKDFTPELQASYQKVVAGVANALAHKYH-'],
      ['HBA_HUMAN', 'VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHF-DLSH-----GSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR--'],
      ['HBA_HORSE', 'VLSAADKTNVKAAWSKVGGHAGEYGAEALERMFLGFPTTKTYFPHF-DLSH-----GSAQVKAHGKKVGDALTLAVGHLDDLPGALSNLSDLHAHKLRVDPVNFKLLSHCLLSTLAVHLPNDFTPAVHASLDKFLSSVSTVLTSKYR--'],
      ['MYG_HUMAN', 'GLSDGEWQLVLNVWGKVEADIPGHGQEVLIRLFKGHPETLEKFDKFKHLKSEDEMKASEDLKKHGATVLTALGGILKKKGHHEAEIKPLAQSHATKHKIPVKYLEFISECIIQVLQSKHPGDFGADAQGAMNKALELFRKDMASNYKELG'],
    ].map(([name, sequence]) => ({ ...members[0], id: name, name, sequence, moleculeType: 'Protein' as const }));
    for (const model of ['LG', 'WAG', 'JTT']) {
      const r = await runBuildTree(globins, { method: 'Maximum Likelihood (ML)', mlProteinModel: model, preAligned: true }, { sourceLabel: 'x' });
      const meta = r.created[0].docMetadata ?? {};
      expect(String(meta.Newick)).toContain('MYG_HUMAN');
      expect(JSON.stringify(meta)).toContain(model);
    }
  }, 120000);
});
