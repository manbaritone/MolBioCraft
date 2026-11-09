// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { createTreeDocument, extractNewickTree, importNexusOrNewickDocument, parseNexusTranslate } from '../core/treeDocuments';
import { nexusHasCharacterMatrix, nexusToAlignmentDocument, parseNexusAlignment } from '../core/fileParsers';
import { layoutNewickPhylogeneticTreeRust } from '../lib/rustBioEngine';

const mrBayesNexus = `#NEXUS
[ID: 1234567]
begin trees;
   translate
      1 Homo_sapiens,
      2 'Pan troglodytes',
      3 'Gorilla; gorilla',
      4 Pongo,
      5 'O''Brien sp.',
   ;
   tree con_50_majrule = [&U] ((1:0.1,2:0.1)0.95:0.05,3[&prob=1.0]:0.2,(4:0.3,5:0.3)1.00:0.1);
end;`;

describe('NEXUS TRANSLATE tables', () => {
  it('parses quoted labels and a trailing comma', () => {
    const map = parseNexusTranslate("translate 1 Homo_sapiens, 2 'Pan troglodytes', 3 'O''Brien',");
    expect([...map.entries()]).toEqual([['1', 'Homo_sapiens'], ['2', 'Pan troglodytes'], ['3', "O'Brien"]]);
  });

  it('replaces numeric tip labels but keeps internal support values', () => {
    const newick = extractNewickTree(mrBayesNexus);
    expect(newick).toBe(
      `((Homo_sapiens:0.1,'Pan troglodytes':0.1)0.95:0.05,'Gorilla; gorilla':0.2,(Pongo:0.3,"O'Brien sp.":0.3)1.00:0.1);`,
    );
    const doc = createTreeDocument(mrBayesNexus, 'run1.con.tre.nex');
    expect(doc.docMetadata?.['No. tips']).toBe(5);
    const layout = layoutNewickPhylogeneticTreeRust(newick, 'phylogram', 900, 520);
    expect(layout.tipCount).toBe(5);
    expect(JSON.stringify(layout)).toContain('Pan troglodytes');
    expect(JSON.stringify(layout)).not.toMatch(/"label":"[1-5]"/);
  });
});

describe('Newick quoted labels', () => {
  it("accepts quoted labels containing ';'", () => {
    expect(extractNewickTree("('A;1':0.1,B:0.2,C:0.3);")).toBe("('A;1':0.1,B:0.2,C:0.3);");
    expect(() => extractNewickTree("('A;1':0.1,B:0.2")).toThrow();
  });
});

const sequentialNexus = `#NEXUS
BEGIN DATA;
  DIMENSIONS NTAX=4 NCHAR=12;
  FORMAT DATATYPE=DNA MISSING=? GAP=- MATCHCHAR=.;
  MATRIX
    Alpha     ACGTACGT
              ACGT
    'Beta two' ..A.ACGT-CG?
    Gamma     ACGT{AG}CGTA-GT
    Delta     ACGTAC GTACGN
  ;
END;`;

const interleavedNexus = `#NEXUS
begin taxa;
  dimensions ntax=3;
  taxlabels A B C;
end;
begin characters;
  dimensions nchar=10;
  format datatype=protein interleave missing=X gap=~;
  matrix
    A MKVL [1-5]
    B MKIL
    C MK~L

    A AGHWQ X
    B AGHWQ ~
    C AG?WQ (KR)
  ;
end;`;

describe('NEXUS DATA / CHARACTERS matrices', () => {
  it('parses a sequential DNA matrix with match, gap, missing and state sets', () => {
    const aln = parseNexusAlignment(sequentialNexus);
    expect(aln.names).toEqual(['Alpha', 'Beta two', 'Gamma', 'Delta']);
    expect(aln.sequences).toEqual(['ACGTACGTACGT', 'ACATACGT-CGN', 'ACGTRCGTA-GT', 'ACGTACGTACGN']);
    expect(aln.moleculeType).toBe('DNA');
    expect(aln.interleaved).toBe(false);
    expect(aln.nchar).toBe(12);
  });

  it('parses an interleaved protein CHARACTERS matrix with custom gap/missing symbols', () => {
    const aln = parseNexusAlignment(interleavedNexus);
    expect(aln.names).toEqual(['A', 'B', 'C']);
    expect(aln.sequences).toEqual(['MKVLAGHWQX', 'MKILAGHWQ-', 'MK-LAG?WQX']);
    expect(aln.moleculeType).toBe('Protein');
    expect(aln.interleaved).toBe(true);
  });

  it('rejects inconsistent dimensions and non-sequence data honestly', () => {
    expect(() => parseNexusAlignment(sequentialNexus.replace('NTAX=4', 'NTAX=5'))).toThrow(/NTAX=5/);
    expect(() => parseNexusAlignment(sequentialNexus.replace('NCHAR=12', 'NCHAR=13'))).toThrow();
    expect(() => parseNexusAlignment(sequentialNexus.replace('DATATYPE=DNA', 'DATATYPE=STANDARD'))).toThrow(/STANDARD/);
  });

  it('builds an alignment document and routes matrix-only NEXUS files to it', () => {
    const doc = nexusToAlignmentDocument(parseNexusAlignment(sequentialNexus), 'primates.nex', '2026-01-01T00:00:00.000Z');
    expect(doc.documentKind).toBe('alignment');
    expect(doc.folder).toBe('Alignments');
    expect(doc.alignmentMeta?.sequences?.map((s) => s.name)).toEqual(['Alpha', 'Beta two', 'Gamma', 'Delta']);
    expect(doc.docMetadata?.['Source Format']).toBe('NEXUS');

    const routed = importNexusOrNewickDocument(sequentialNexus, 'primates.nex');
    expect(routed.kind).toBe('alignment');
    expect(() => createTreeDocument(sequentialNexus, 'primates.nex')).toThrow(/character matrix/);
    expect(importNexusOrNewickDocument(mrBayesNexus, 'run.nex').kind).toBe('tree');
    expect(importNexusOrNewickDocument('(A:1,B:1,C:1);', 't.nwk').kind).toBe('tree');

    // The boundary: a file that holds the same matrix and a TREES block is not matrix-only, so
    // it opens as its tree, not as an alignment.
    const matrixAndTrees = `${sequentialNexus}
BEGIN TREES;
  TREE best = ((Alpha:0.1,'Beta two':0.2):0.05,Gamma:0.3,Delta:0.4);
END;`;
    expect(nexusHasCharacterMatrix(matrixAndTrees)).toBe(true);
    const both = importNexusOrNewickDocument(matrixAndTrees, 'both.nex');
    expect(both.kind).toBe('tree');
    expect(both.doc.documentKind).toBe('tree');
    expect(both.doc.docMetadata?.Newick).toBe("((Alpha:0.1,'Beta two':0.2):0.05,Gamma:0.3,Delta:0.4);");
    expect(both.doc.docMetadata?.['No. tips']).toBe(4);
  });
});
