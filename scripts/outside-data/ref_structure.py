"""Reference results for the structure tools, from independent implementations: TM-align
(tmtools bindings of Zhang's TM-align) for sequence-independent pairwise alignment, Biopython
(PairwiseAligner + SVDSuperimposer) for sequence-based superposition, Biopython backbone phi/psi
for Ramachandran analysis, and Biopython MMCIFParser / MMCIF2Dict for atom, chain, model and
secondary-structure counts. Reads test-data/rcsb/ (scripts/outside-data/fetch.sh).
Writes test-data/reference/structure.json."""
import json, math, sys
import numpy as np
import tmtools
from Bio import Align
from Bio.Align import substitution_matrices
from Bio.PDB import MMCIFParser, PPBuilder, is_aa
from Bio.PDB.MMCIF2Dict import MMCIF2Dict
from Bio.SVDSuperimposer import SVDSuperimposer
from Bio.SeqUtils import seq1

T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
parser = MMCIFParser(QUIET=True)
_cache = {}


def structure(pdb):
    if pdb not in _cache:
        _cache[pdb] = parser.get_structure(pdb, f'{T}/rcsb/{pdb}.cif')
    return _cache[pdb]


def chain_ca(pdb, chain):
    """First model, polymer residues with a CA, in file order: (one-letter sequence, Nx3 coords)."""
    ch = next(structure(pdb).get_models())[chain]
    res = [r for r in ch if is_aa(r, standard=False) and 'CA' in r and r.id[0] == ' ']
    return ''.join(seq1(r.get_resname()) for r in res), np.array([r['CA'].coord for r in res], float)


def tm_align(a, b):
    sa, ca = chain_ca(*a)
    sb, cb = chain_ca(*b)
    r = tmtools.tm_align(ca, cb, sa, sb)
    pairs = [(x, y) for x, y in zip(r.seqxA, r.seqyA) if x != '-' and y != '-']
    dist_ok = [m for m in r.seqM if m == ':']
    ident = sum(1 for x, y in pairs if x == y)
    return {'chain_1': f'{a[0]}.{a[1]}', 'chain_2': f'{b[0]}.{b[1]}', 'length_1': len(sa), 'length_2': len(sb),
            'tm_score_norm_1': round(float(r.tm_norm_chain1), 5), 'tm_score_norm_2': round(float(r.tm_norm_chain2), 5),
            'rmsd': round(float(r.rmsd), 3), 'aligned_length': len(pairs), 'close_pairs_lt_5A': len(dist_ok),
            'identity_aligned': round(ident / len(pairs), 4) if pairs else 0.0,
            'alignment_1': r.seqxA, 'alignment_2': r.seqyA,
            'rotation': np.round(r.u, 6).tolist(), 'translation': np.round(r.t, 4).tolist()}


def sequence_superposition(a, b):
    """Smith-Waterman-3D style: align sequences (global, BLOSUM62, open -10, extend -0.5), superpose
    the aligned CA pairs by SVD and report the RMSD over all of them."""
    sa, ca = chain_ca(*a)
    sb, cb = chain_ca(*b)
    al = Align.PairwiseAligner(mode='global', substitution_matrix=substitution_matrices.load('BLOSUM62'),
                               open_gap_score=-10, extend_gap_score=-0.5)
    aln = al.align(sa, sb)[0]
    idx = [(i, j) for (s1, e1), (s2, e2) in zip(*aln.aligned) for i, j in zip(range(s1, e1), range(s2, e2))]
    x = np.array([ca[i] for i, _ in idx]); y = np.array([cb[j] for _, j in idx])
    sup = SVDSuperimposer(); sup.set(y, x); sup.run()
    return {'chain_1': f'{a[0]}.{a[1]}', 'chain_2': f'{b[0]}.{b[1]}', 'method': 'BLOSUM62 global, open -10, extend -0.5, SVD',
            'equivalent_residues': len(idx), 'identity': round(sum(sa[i] == sb[j] for i, j in idx) / len(idx), 4),
            'rmsd': round(float(sup.get_rms()), 3), 'score': round(float(aln.score), 1)}


def ramachandran(pdb, chain):
    pp = PPBuilder().build_peptides(next(structure(pdb).get_models())[chain])
    rows = []
    for peptide in pp:
        for res, (phi, psi) in zip(peptide, peptide.get_phi_psi_list()):
            rows.append({'seq_id': res.id[1], 'resname': res.get_resname(),
                         'phi': None if phi is None else round(math.degrees(phi), 2),
                         'psi': None if psi is None else round(math.degrees(psi), 2)})
    return rows


def counts(pdb):
    s = structure(pdb)
    d = MMCIF2Dict(f'{T}/rcsb/{pdb}.cif')
    group = d.get('_atom_site.group_PDB', [])
    model_ids = d.get('_atom_site.pdbx_PDB_model_num', [])
    first = model_ids[0] if model_ids else None
    in_first = [g for g, m in zip(group, model_ids) if m == first]
    m0 = next(s.get_models())
    as_list = lambda v: v if isinstance(v, list) else ([v] if v else [])
    return {'models': len(s), 'atom_records_model_1': in_first.count('ATOM'), 'hetatm_records_model_1': in_first.count('HETATM'),
            'chains_model_1': sorted(c.id for c in m0),
            'polymer_residues_with_ca': {c.id: sum(1 for r in c if is_aa(r, standard=False) and 'CA' in r and r.id[0] == ' ') for c in m0},
            'helices_struct_conf': len(as_list(d.get('_struct_conf.id'))),
            'strands_struct_sheet_range': len(as_list(d.get('_struct_sheet_range.id')))}


out = {
    'tools': {'tmtools': getattr(tmtools, '__version__', 'unknown'), 'biopython': __import__('Bio').__version__},
    'tm_align': [tm_align(('4HHB', 'A'), ('4HHB', 'B')), tm_align(('1MBN', 'A'), ('4HHB', 'A')),
                 tm_align(('1UBQ', 'A'), ('1A5R', 'A')), tm_align(('4HHB', 'A'), ('4HHB', 'A'))],
    'sequence_superposition': [sequence_superposition(('4HHB', 'A'), ('4HHB', 'B')),
                               sequence_superposition(('1MBN', 'A'), ('4HHB', 'A'))],
    'ramachandran': {'1UBQ.A': ramachandran('1UBQ', 'A')},
    'counts': {p: counts(p) for p in ('1CRN', '1UBQ', '4HHB', '1A5R', '1MBN')},
}
with open(f'{T}/reference/structure.json', 'w') as fh:
    json.dump(out, fh, indent=1)
print('wrote', f'{T}/reference/structure.json')
