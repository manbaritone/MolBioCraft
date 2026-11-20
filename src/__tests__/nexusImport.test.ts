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
    // BG-01M6VZT1 AC1: and the matrix opens beside it, as an alignment; matrix-only and tree-only
    // files carry no second document.
    expect(both.kind === 'tree' && both.alignment?.doc.alignmentMeta?.sequences?.map((s) => s.name))
      .toEqual(['Alpha', 'Beta two', 'Gamma', 'Delta']);
    expect('alignment' in routed).toBe(false);
    const treeOnly = importNexusOrNewickDocument(mrBayesNexus, 'run.nex');
    expect(treeOnly.kind === 'tree' && treeOnly.alignment).toBeUndefined();
  });
});

const twoTrees = `BEGIN TREES;
  TREE best = ((Alpha:0.1,'Beta two':0.2):0.05,Gamma:0.3,Delta:0.4);
  TREE second = ((Alpha:0.1,Gamma:0.2):0.05,'Beta two':0.3,Delta:0.4);
END;`;

describe('BG-01M6VZT1 a NEXUS file with a matrix and trees', () => {
  it('BG-01M6VZT1 AC1 a NEXUS file with a matrix and a TREES block opens the tree and the matrix as an alignment beside it', () => {
    // Wrong implementations: the matrix dropped (the old route); the alignment built from the tree's
    // tips or from a re-read that ignores MATCHCHAR, MISSING, GAP or interleaving; the tree replaced
    // by the alignment. Each fixture is compared row for row with its matrix-only import.
    const cases: Array<[string, string, number]> = [
      [sequentialNexus, 'both.nex', 4],
      [`${interleavedNexus}
begin trees;
  tree t1 = ((A:0.1,B:0.2):0.05,C:0.3);
end;`, 'prot.nexus', 3],
    ];
    for (const [text, fileName, count] of cases) {
      const fileText = text.includes('begin trees') ? text : `${text}\n${twoTrees}`;
      const matrixOnly = importNexusOrNewickDocument(text.split(/\nbegin trees;/i)[0], fileName);
      expect(matrixOnly.kind, fileName).toBe('alignment');
      const out = importNexusOrNewickDocument(fileText, fileName);
      expect(out.kind, fileName).toBe('tree');
      if (out.kind !== 'tree') continue;
      expect(out.doc.documentKind).toBe('tree');
      expect(out.doc.folder).toBe('Tree Documents');
      expect(out.alignment, fileName).toBeDefined();
      const aln = out.alignment!;
      expect(aln.sequenceCount).toBe(count);
      expect(aln.doc.documentKind).toBe('alignment');
      expect(aln.doc.folder).toBe('Alignments');
      const rows = (d: typeof aln.doc) => d.alignmentMeta?.sequences?.map((s) => [s.name, s.sequence]);
      expect(rows(aln.doc), fileName).toEqual(rows(matrixOnly.doc));
      expect(aln.doc.moleculeType).toBe(matrixOnly.doc.moleculeType);
      expect(aln.doc.docMetadata?.['NEXUS Layout']).toBe(matrixOnly.doc.docMetadata?.['NEXUS Layout']);
    }
    // Not only equal to the matrix-only route: the rows the NEXUS reader reads (MATCHCHAR, MISSING,
    // GAP, state sets and interleaving resolved; quoted names unquoted).
    const sequential = importNexusOrNewickDocument(`${sequentialNexus}\n${twoTrees}`, 'both.nex');
    expect(sequential.kind === 'tree' && sequential.alignment?.doc.alignmentMeta?.sequences?.map((s) => [s.name, s.sequence]))
      .toEqual([['Alpha', 'ACGTACGTACGT'], ['Beta two', 'ACATACGT-CGN'], ['Gamma', 'ACGTRCGTA-GT'], ['Delta', 'ACGTACGTACGN']]);
    // A matrix the reader does not read is named as not opened, in a sentence; the tree still opens.
    const standard = `${sequentialNexus.replace('DATATYPE=DNA', 'DATATYPE=STANDARD')}\n${twoTrees}`;
    const refused = importNexusOrNewickDocument(standard, 'morph.nex');
    expect(refused.kind).toBe('tree');
    if (refused.kind !== 'tree') return;
    expect(refused.alignment).toBeUndefined();
    const sentence = 'The character matrix was not opened: NEXUS DATATYPE=STANDARD is not a DNA, RNA or protein alignment.';
    expect(refused.warnings).toContain(sentence);
    expect(String(refused.doc.docMetadata?.Notes)).toContain(`- ${sentence}\n`);
    expect(refused.doc.docMetadata?.Newick).toBe("((Alpha:0.1,'Beta two':0.2):0.05,Gamma:0.3,Delta:0.4);");
  });

  it('BG-01M6VZT1 AC2 a posterior or support comment on an internal node is kept as its label', () => {
    expect(extractNewickTree('((A:1,B:1)[&posterior=0.95]:0.5,C:1,D:1);')).toBe('((A:1,B:1)0.95:0.5,C:1,D:1);');
    // Every key the criterion names, in any case, and BEAST's many-key comment.
    expect(extractNewickTree('((A:1,B:1)[&PROB=1.0]:0.5,C:1,D:1);')).toBe('((A:1,B:1)1.0:0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&Probability=0.5],C:1,D:1);')).toBe('((A:1,B:1)0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1) [&support=87] :0.5,C:1,D:1);')).toBe('((A:1,B:1)87:0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&height=1.2,height_95%_HPD={1.0,1.4},posterior=0.99]:0.5,C:1,D:1);'))
      .toBe('((A:1,B:1)0.99:0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,(B:1,E:1)[&posterior=0.7]:1)[&posterior=1]:0.5,C:1,D:1)[&posterior=1];'))
      .toBe('((A:1,(B:1,E:1)0.7:1)1:0.5,C:1,D:1)1;');
    // Every other comment is still stripped: other keys, plain comments, a tip's comment, and a
    // comment on a node that already has a label (its own label is kept).
    expect(extractNewickTree('((A:1,B:1)[&height=1.2]:0.5,C:1,D:1);')).toBe('((A:1,B:1):0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&prob="0.9"]:0.5,C:1,D:1);')).toBe('((A:1,B:1)0.9:0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&prob_stddev=0.1]:0.5,C:1,D:1);')).toBe('((A:1,B:1):0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&range={1,support=0.5,2}]:0.5,C:1,D:1);')).toBe('((A:1,B:1):0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&posterior=high]:0.5,C:1,D:1);')).toBe('((A:1,B:1):0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[posterior=0.95]:0.5,C:1,D:1);')).toBe('((A:1,B:1):0.5,C:1,D:1);');
    expect(extractNewickTree('((A[&posterior=0.5]:1,B:1):0.5,C:1,D:1);')).toBe('((A:1,B:1):0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)0.8[&posterior=0.95]:0.5,C:1,D:1);')).toBe('((A:1,B:1)0.8:0.5,C:1,D:1);');
    expect(extractNewickTree('((A:1,B:1)[&posterior=0.95]0.8:0.5,C:1,D:1);')).toBe('((A:1,B:1)0.8:0.5,C:1,D:1);');
    expect(extractNewickTree("(('x)[&posterior=0.9]':1,B:1):0.5,C:1,D:1);")).toBe("(('x)[&posterior=0.9]':1,B:1):0.5,C:1,D:1);");
    // The NEXUS TREES path (TRANSLATE applied to tips, never to the lifted label).
    const nexus = `#NEXUS
begin trees;
  translate 1 Homo_sapiens, 2 Pan, 3 Gorilla;
  tree con = [&U] ((1:0.1,2:0.1)[&prob=1]:0.05,3[&prob=1.0]:0.2,1:0.1);
end;`;
    expect(extractNewickTree(nexus)).toBe('((Homo_sapiens:0.1,Pan:0.1)1:0.05,Gorilla:0.2,Homo_sapiens:0.1);');
  });

  it('BG-01M6VZT1 AC3 a TREES block with two trees opens the first and records that one more was not opened', () => {
    const text = `${sequentialNexus}\n${twoTrees}`;
    const out = importNexusOrNewickDocument(text, 'both.nex');
    expect(out.doc.docMetadata?.Newick).toBe("((Alpha:0.1,'Beta two':0.2):0.05,Gamma:0.3,Delta:0.4);");
    expect(out.doc.docMetadata?.['Trees in file']).toBe(2);
    expect(out.doc.docMetadata?.Notes).toBe('Warnings:\n- 1 more tree in the file was not opened; only the first is shown.\n');
    expect(out.kind === 'tree' && out.warnings).toEqual(['1 more tree in the file was not opened; only the first is shown.']);
    // Three trees over two TREES blocks, and a plain Newick file of three trees, count every tree.
    const three = `${text}\nBEGIN TREES;\n  TREE third = (Alpha,Gamma,(Delta,'Beta two'));\nEND;`;
    expect(createTreeDocument(three, 'three.nex').docMetadata?.['Trees in file']).toBe(3);
    expect(String(createTreeDocument(three, 'three.nex').docMetadata?.Notes)).toContain('2 more trees in the file were not opened');
    const nwk = createTreeDocument("(A:1,B:1,C:1);\n('x;y':1,B:1,C:1);\n[(D,E,F);]\n(A,C,B);\n", 'boot.nwk');
    expect(nwk.docMetadata?.Newick).toBe('(A:1,B:1,C:1);');
    expect(nwk.docMetadata?.['Trees in file']).toBe(3);
    // One tree: no count and no note.
    const one = createTreeDocument(`${sequentialNexus}\nBEGIN TREES;\n  TREE best = (Alpha,Gamma,Delta);\nEND;`, 'one.nex');
    expect(one.docMetadata?.['Trees in file']).toBeUndefined();
    expect(one.docMetadata?.Notes).toBeUndefined();
    expect(createTreeDocument(mrBayesNexus, 'run.nex').docMetadata?.Notes).toBeUndefined();
  });
});
