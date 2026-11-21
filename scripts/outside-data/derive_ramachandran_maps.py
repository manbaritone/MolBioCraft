r"""Writes the six Top8000 Ramachandran grids that crates/molbiocraft-protein/src/rama8000_grids.rs
embeds (GENERAL, ILE_VAL, GLYCINE, PRE_PROLINE, TRANS_PROLINE, CIS_PROLINE) from the Richardson
Lab Top8000 Ramachandran contour grids, and checks the committed grids against them node for node
(D0009, BG-01M6PVR9, BG-01M6PXQ7).

Source data (not committed: fetch it into a directory outside the repository)
  Repository  https://github.com/rlabduke/reference_data
  Commit      5ee6875fc29eccc3c9dc7cbe705ff9fd1b505d7d (2026-09-13, "Relicense to CC-BY-4.0 per
              Duke OTC authorization, Sept 2026"). The six data files are unchanged since they were
              added in 534d5419ae5297a84392a1b0a84217b2c516a193 (2016-11-14).
  Files       Top8000/Top8000_ramachandran_pct_contour_grids/rama8000-*.data (SHA-256 in GRIDS below)
  Licence     Creative Commons Attribution 4.0 International (CC BY 4.0),
              https://creativecommons.org/licenses/by/4.0/
              Copyright (c) 2016-2026 David C. Richardson, Jane S. Richardson, and contributors.
              Produced by the Richardson Lab, Duke University.
  Citation    Williams CJ, Headd JJ, Moriarty NW, Prisant MG, Videau LL, Deis LN, Verma V, Keedy DA,
              Hintze BJ, Chen VB, Jain S, Lewis SM, Arendall WB, Snoeyink J, Adams PD, Lovell SC,
              Richardson JS, Richardson DC (2018) MolProbity: More and better reference data for
              improved all-atom structure validation. Protein Science 27(1):293-315.
              https://doi.org/10.1002/pro.3330

Usage (Python standard library only; run with -I, since it reads downloaded files):
    python3 -I scripts/outside-data/derive_ramachandran_maps.py --fetch GRID_DIR \
        --check crates/molbiocraft-protein/src/rama8000_grids.rs
  --fetch downloads any of the six files missing from GRID_DIR from the pinned commit. Every file
  is checked against its SHA-256 before it is read. Without --check the whole of rama8000_grids.rs
  is printed; with --check the six committed grids are compared with the files node for node, and
  each differing node is printed. The exit status is 1 on any difference.

How the embedded grids are written (the changes this script makes to the source data)
  1. Each file gives a value at 2-degree nodes: phi (x1) and psi (x2) = -179, -177, ..., 179.
     A node the file does not list has the value 0, as in cctbx mmtbx/rotamer/n_dim_table.py.
  2. Each value is rounded to the nearest 32-bit float, the precision cctbx's NDimTable holds its
     lookup table in (flex.float), and written as the shortest decimal that reads back as that
     float. The grid is refused if the rounding moves any node across MolProbity's cutoffs (as
     coded in cctbx mmtbx/validation/ramalyze.py, evalScore: favoured at a value of at least
     0.02, allowed at least 0.0005 for the general case, 0.0020 for cis-Pro and 0.0010 for every
     other class, else outlier).
  3. Node (phi, psi) is element 180 * i + j of its array, i = (phi + 179) / 2 and
     j = (psi + 179) / 2, the order of cctbx's lookup table and of the files' own lines.
  The engine classifies a residue by bilinear interpolation of its class's grid at its (phi, psi),
  as NDimTable.valueAt does, at those cutoffs.
"""
import argparse, hashlib, math, os, re, struct, sys, urllib.request

COMMIT = '5ee6875fc29eccc3c9dc7cbe705ff9fd1b505d7d'
URL = ('https://raw.githubusercontent.com/rlabduke/reference_data/' + COMMIT
       + '/Top8000/Top8000_ramachandran_pct_contour_grids/')

FAVOURED = 0.02
# Rust static: (grid file, allowed cutoff, SHA-256 of the file at COMMIT).
GRIDS = {
    'GENERAL': ('rama8000-general-noGPIVpreP.data', 0.0005,
                'ccdbc6a201ca2510119e77b0dd169ca2cdea7f2c9ed348555a3b1129f8c2b00a'),
    'ILE_VAL': ('rama8000-ileval-nopreP.data', 0.0010,
                '567e1318128a50b8f44362427bf717d564749936d22d5dbfd34e5b0c17819276'),
    'GLYCINE': ('rama8000-gly-sym.data', 0.0010,
                '89c75a5ac036ff3309c51b46a2412f30137827abaff4606209ed41e04fcba637'),
    'PRE_PROLINE': ('rama8000-prepro-noGP.data', 0.0010,
                    '1cc10b92911d47ca775f0a8131a029b42634dbe26364cece4cfdc8c85b9c3fab'),
    'TRANS_PROLINE': ('rama8000-transpro.data', 0.0010,
                      '092b4c0bcd2fe846a063000c83d13cbe62ff43b2dafd67ecb8a47042cce747ec'),
    'CIS_PROLINE': ('rama8000-cispro.data', 0.0020,
                    '143a3004668baefaf6749bd9c2acbe829d3b1a93059c74ba766b04f1e00f43ab'),
}
NODES = [-179 + 2 * k for k in range(180)]
COUNT = len(NODES) ** 2
AXIS_HEADER = re.compile(r'^#\s+x[12]: -180\.0 180\.0 180 true$')


def fail(message):
    sys.exit(f'derive_ramachandran_maps: {message}')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def f32(value):
    """The 32-bit float nearest to value (as a Python float)."""
    return struct.unpack('<f', struct.pack('<f', value))[0]


def literal(value):
    """The shortest decimal that reads back as the 32-bit float value, as a Rust f32 literal."""
    if value == 0:
        return '0.0'
    for digits in range(1, 10):
        text = f'{value:.{digits}g}'
        if f32(float(text)) == value:
            break
    return text if any(ch in text for ch in '.e') else text + '.0'


def classify(value, allowed):
    if value >= FAVOURED:
        return 'favoured'
    return 'allowed' if value >= allowed else 'outlier'


def fetch(grid_dir):
    os.makedirs(grid_dir, exist_ok=True)
    for name, _, want in GRIDS.values():
        path = os.path.join(grid_dir, name)
        if os.path.exists(path):
            continue
        try:
            with urllib.request.urlopen(URL + name, timeout=60) as response:
                data = response.read()
        except OSError as e:
            fail(f'download failed: {URL + name}: {e}')
        if sha256(data) != want:
            fail(f'download {URL + name}: SHA-256 {sha256(data)}, expected {want}')
        with open(path + '.part', 'wb') as fh:
            fh.write(data)
        os.replace(path + '.part', path)
        print(f'fetched {name}', file=sys.stderr)


def read_grid(path, want_sha256):
    """{(phi, psi): value} for the nodes the file lists. Fails, naming the file, when it is missing,
    unreadable, empty, not the pinned version, or has a line off the 2-degree lattice."""
    if not os.path.exists(path):
        fail(f'missing: {path} (run with --fetch)')
    try:
        with open(path, 'rb') as fh:
            data = fh.read()
    except OSError as e:
        fail(f'unreadable: {path}: {e}')
    if not data.strip():
        fail(f'empty: {path}')
    if sha256(data) != want_sha256:
        fail(f'{path}: SHA-256 {sha256(data)}, expected {want_sha256} (the file at {COMMIT})')
    lines = data.decode('ascii').splitlines()
    header = [l for l in lines if l.startswith('#')]
    if not any(l.strip() == '# Number of dimensions: 2' for l in header) \
            or sum(bool(AXIS_HEADER.match(l.strip())) for l in header) != 2:
        fail(f'{path}: header is not a 2-D table of 180 wrapping bins over -180..180 per axis')
    nodes, lattice = {}, set(NODES)
    for n, line in enumerate(lines, 1):
        if line.startswith('#') or not line.strip():
            continue
        fields = line.split()
        if len(fields) != 3:
            fail(f'{path}:{n}: expected "phi psi value", got {line!r}')
        phi, psi, value = float(fields[0]), float(fields[1]), float(fields[2])
        if phi not in lattice or psi not in lattice:
            fail(f'{path}:{n}: node ({phi}, {psi}) is not on the 2-degree lattice')
        if not (math.isfinite(value) and value >= 0):
            fail(f'{path}:{n}: value {fields[2]} is not a finite non-negative number')
        if (int(phi), int(psi)) in nodes:
            fail(f'{path}:{n}: node ({phi}, {psi}) listed twice')
        nodes[(int(phi), int(psi))] = value
    if not nodes:
        fail(f'empty: {path} lists no nodes')
    return nodes


def derive(path, nodes, allowed):
    """The 32400 node values in array order, each rounded to f32. Fails when the rounding moves a
    node into another class."""
    values = []
    for phi in NODES:
        for psi in NODES:
            value = nodes.get((phi, psi), 0.0)
            rounded = f32(value)
            if classify(rounded, allowed) != classify(value, allowed):
                fail(f'{path}: node ({phi}, {psi}) value {value!r} is {classify(value, allowed)} but '
                     f'{classify(rounded, allowed)} as the f32 {rounded!r}, so f32 cannot hold this grid')
            values.append(rounded)
    return values


HEADER = '''// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

//! The six Top8000 Ramachandran grids of the Richardson Laboratory, Duke University (Williams et
//! al. 2018, *Protein Sci.* 27:293-315, doi:10.1002/pro.3330), files
//! `Top8000/Top8000_ramachandran_pct_contour_grids/rama8000-*.data` of
//! <https://github.com/rlabduke/reference_data> at commit `{commit}`.
//! Copyright (c) 2016-2026 David C. Richardson, Jane S. Richardson, and contributors; licensed
//! CC BY 4.0 (<https://creativecommons.org/licenses/by/4.0/>), provided as-is. Their use does not
//! imply endorsement by the Richardson Lab or Duke University.
//!
//! Generated by `scripts/outside-data/derive_ramachandran_maps.py` (do not edit; its `--check`
//! compares every node with the SHA-256-pinned files). The changes made to the data: each value is
//! rounded to the nearest `f32` (the precision cctbx's `NDimTable` holds the table in), a node a
//! file does not list is 0, and node (phi, psi) is element `180 * i + j`, i = (phi + 179) / 2 and
//! j = (psi + 179) / 2, for phi, psi = -179, -177, ..., 179.

/// Nodes per axis: phi and psi = -179, -177, ..., 179.
pub const NODES_PER_AXIS: usize = 180;
'''


def rust_module(grids):
    out = [HEADER.format(commit=COMMIT)]
    for const, (name, allowed, _) in GRIDS.items():
        values = grids[const]
        out.append(f'\n/// `{name}`, allowed cutoff {allowed:.4f}.\n#[rustfmt::skip]\n'
                   f'pub static {const}: [f32; {COUNT}] = [\n')
        for i, phi in enumerate(NODES):
            row = values[180 * i:180 * (i + 1)]
            out.append(f'// phi {phi}\n' + ','.join(literal(v) for v in row) + ',\n')
        out.append('];\n')
    return ''.join(out)


def committed_grids(rust_path):
    """{static: (values, the /// lines above it)} for the six statics in the Rust file."""
    if not os.path.exists(rust_path):
        fail(f'missing: {rust_path}')
    try:
        with open(rust_path, encoding='utf-8') as fh:
            text = fh.read()
    except OSError as e:
        fail(f'unreadable: {rust_path}: {e}')
    found = {}
    pattern = r'((?:^///[^\n]*\n)*)(?:#\[rustfmt::skip\]\n)?pub static (\w+): \[f32; (\d+)\] = \[(.*?)\];'
    for m in re.finditer(pattern, text, re.S | re.M):
        body = re.sub(r'//[^\n]*', '', m.group(4))
        items = [t.strip() for t in body.split(',') if t.strip()]
        if int(m.group(3)) != COUNT or len(items) != COUNT:
            fail(f'{rust_path}: {m.group(2)} holds {len(items)} values, not {COUNT}')
        try:
            values = [float(t) for t in items]
        except ValueError as e:
            fail(f'{rust_path}: {m.group(2)}: {e}')
        found[m.group(2)] = ([f32(v) for v in values], m.group(1))
    missing = sorted(set(GRIDS) - set(found))
    if missing:
        fail(f'{rust_path}: grids not found: {", ".join(missing)}')
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('grid_dir', help='directory holding the six rama8000-*.data files')
    ap.add_argument('--fetch', action='store_true', help='download the files missing from grid_dir')
    ap.add_argument('--check', metavar='RAMA8000_GRIDS_RS', help='compare with the grids committed in this file')
    args = ap.parse_args()
    if args.fetch:
        fetch(args.grid_dir)
    derived = {}
    for const, (name, allowed, digest) in GRIDS.items():
        path = os.path.join(args.grid_dir, name)
        derived[const] = derive(path, read_grid(path, digest), allowed)
    if not args.check:
        sys.stdout.write(rust_module(derived))
        return
    committed, differing, doc_mismatches = committed_grids(args.check), 0, 0
    for const, (name, allowed, _) in GRIDS.items():
        values, doc = committed[const]
        if f'`{name}`' not in doc or f'allowed cutoff {allowed:.4f}' not in doc:
            doc_mismatches += 1
            print(f'{const}: its doc comment does not name `{name}` and allowed cutoff {allowed:.4f}')
        n = 0
        for k, (got, want) in enumerate(zip(values, derived[const])):
            if struct.pack('<f', got) != struct.pack('<f', want):
                n += 1
                print(f'{const} node (phi {NODES[k // 180]}, psi {NODES[k % 180]}): '
                      f'committed {literal(got)}, file {literal(want)}')
        print(f'{const}: {n} of {COUNT} nodes differ ({name}, allowed >= {allowed})')
        differing += n
    print(f'total: {differing} of {COUNT * len(GRIDS)} nodes differ; {doc_mismatches} doc comment mismatches')
    sys.exit(1 if differing or doc_mismatches else 0)


if __name__ == '__main__':
    main()
