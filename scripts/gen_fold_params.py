"""Generate the folding energy tables in `crates/molbiocraft-cloning/src/fold_params*.rs`.

Reads a ViennaRNA 2.x parameter file pair -- `rna_turner2004.par` and `dna_mathews2004.par`,
which ship with ViennaRNA -- and emits the 37 degree free energies (`dg`) or, in exactly the
same index layout, the enthalpies (`enthalpy`), which let the folder re-derive every loop energy
at another temperature as `dH - (dH - dG37) * (T + 273.15) / 310.15`.

    python3 gen_fold_params.py rna_turner2004.par dna_mathews2004.par dg
    python3 gen_fold_params.py rna_turner2004.par dna_mathews2004.par enthalpy

Running it with `dg` reproduces `fold_params.rs` constant for constant, which is how the index
layout here is checked before the enthalpy tables generated from it are trusted.
"""
import re, sys

INF = 10_000_000

def sections(path):
    secs, cur = {}, None
    for line in open(path):
        line = re.sub(r'/\*.*?\*/', '', line)
        if line.startswith('#'):
            cur = line[1:].strip(); secs[cur] = []
            continue
        if cur is None: continue
        secs[cur] += line.split()
    return secs

def nums(vals):
    return [INF if v == 'INF' else int(v) for v in vals]

def stack(vals):
    v = nums(vals); out = [INF] * 64
    for t1 in range(1, 8):
        for t2 in range(1, 8):
            out[t1 * 8 + t2] = v[(t1 - 1) * 7 + (t2 - 1)]
    return out

def mismatch(vals):
    v = nums(vals); out = [0] * 200
    for t in range(1, 8):
        for b1 in range(5):
            for b2 in range(5):
                out[t * 25 + b1 * 5 + b2] = v[((t - 1) * 5 + b1) * 5 + b2]
    return out

def dangle(vals):
    v = nums(vals); out = [0] * 40
    for t in range(1, 8):
        for b in range(5):
            out[t * 5 + b] = v[(t - 1) * 5 + b]
    return out

def int11(vals):
    v = nums(vals); out = [INF] * 1600; k = 0
    for t1 in range(1, 8):
        for t2 in range(1, 8):
            for b1 in range(5):
                for b2 in range(5):
                    out[((t1 * 8 + t2) * 5 + b1) * 5 + b2] = v[k]; k += 1
    return out

def int21(vals):
    v = nums(vals); out = [INF] * 8000; k = 0
    for t1 in range(1, 8):
        for t2 in range(1, 8):
            for b1 in range(5):
                for b2 in range(5):
                    for b3 in range(5):
                        out[(((t1 * 8 + t2) * 5 + b1) * 5 + b2) * 5 + b3] = v[k]; k += 1
    return out

def int22(vals):
    v = nums(vals); out = [INF] * 40000; k = 0
    for t1 in range(1, 7):
        for t2 in range(1, 7):
            for b1 in range(1, 5):
                for b2 in range(1, 5):
                    for b3 in range(1, 5):
                        for b4 in range(1, 5):
                            out[((((t1 * 8 + t2) * 5 + b1) * 5 + b2) * 5 + b3) * 5 + b4] = v[k]; k += 1
    return out

def loops(vals):
    """Hexa/tetra/triloop sections: sequence, dG, dH."""
    g, h = [], []
    for i in range(0, len(vals), 3):
        g.append((vals[i], int(vals[i + 1])))
        h.append((vals[i], int(vals[i + 2])))
    return g, h

def emit(name, values, out):
    out.append(f'pub(crate) const {name}: [i32; {len(values)}] = [{", ".join(str(x) for x in values)}];')

def emit_loops(name, pairs, out):
    body = ', '.join(f'("{s}", {e})' for s, e in pairs)
    out.append(f'pub(crate) const {name}: [(&str, i32); {len(pairs)}] = [{body}];')

TABLES = [
    ('STACK', 'stack', stack),
    ('MM_HAIRPIN', 'mismatch_hairpin', mismatch),
    ('MM_INTERNAL', 'mismatch_internal', mismatch),
    ('MM_INTERNAL_1N', 'mismatch_internal_1n', mismatch),
    ('MM_INTERNAL_23', 'mismatch_internal_23', mismatch),
    ('MM_MULTI', 'mismatch_multi', mismatch),
    ('MM_EXTERIOR', 'mismatch_exterior', mismatch),
    ('INT11', 'int11', int11),
    ('INT21', 'int21', int21),
    ('INT22', 'int22', int22),
    ('HAIRPIN', 'hairpin', nums),
    ('BULGE', 'bulge', nums),
    ('INTERNAL', 'internal', nums),
    ('DANGLE5', 'dangle5', dangle),
    ('DANGLE3', 'dangle3', dangle),
]

def generate(prefix, path, enthalpy):
    s = sections(path)
    out = []
    suffix = '_H' if enthalpy else ''
    for name, key, shape in TABLES:
        src = s[key + '_enthalpies'] if enthalpy else s[key]
        emit(f'{prefix}_{name}{suffix}', shape(src), out)
    ml = nums(s['ML_params'])          # cu dG, cu dH, cc dG, cc dH, branch dG, branch dH
    ninio = nums(s['NINIO'])           # dG, dH, max
    misc = nums(s['Misc'])             # duplex dG, duplex dH, terminal AU dG, terminal AU dH
    if enthalpy:
        emit(f'{prefix}_ML_H', [ml[1], ml[3], ml[5]], out)
        emit(f'{prefix}_NINIO_H', [ninio[1], ninio[2]], out)
        out.append(f'pub(crate) const {prefix}_TERMINAL_AU_H: i32 = {misc[3]};')
    else:
        emit(f'{prefix}_ML', [ml[0], ml[2], ml[4]], out)
        emit(f'{prefix}_NINIO', [ninio[0], ninio[2]], out)
        out.append(f'pub(crate) const {prefix}_TERMINAL_AU: i32 = {misc[2]};')
        out.append(f'pub(crate) const {prefix}_LXC: f64 = 107.856;')
    for label, key in (('TETRALOOPS', 'Tetraloops'), ('TRILOOPS', 'Triloops'), ('HEXALOOPS', 'Hexaloops')):
        g, h = loops(s[key])
        emit_loops(f'{prefix}_{label}{suffix}', h if enthalpy else g, out)
    return out

if __name__ == '__main__':
    rna, dna, mode = sys.argv[1], sys.argv[2], sys.argv[3]
    enth = mode == 'enthalpy'
    lines = generate('RNA', rna, enth) + generate('DNA', dna, enth)
    print('\n'.join(lines))
