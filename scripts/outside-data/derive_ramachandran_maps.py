r"""Derives the six 10-degree Ramachandran region maps of crates/molbiocraft-protein/src/backbone.rs
(GENERAL_REGIONS, ILE_VAL_REGIONS, GLYCINE_REGIONS, PRE_PROLINE_REGIONS, TRANS_PROLINE_REGIONS,
CIS_PROLINE_REGIONS) from the Richardson Lab Top8000 Ramachandran contour grids, and checks the
committed maps against them cell for cell (D0009, BG-01M6PVR9).

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
        --check crates/molbiocraft-protein/src/backbone.rs
  --fetch downloads any of the six files missing from GRID_DIR from the pinned commit. Every file
  is checked against its SHA-256 before it is read. Without --check the six maps are printed as
  Rust array literals; with --check they are compared with the committed constants, and each
  differing cell is printed. The exit status is 1 on any difference.

How a map is derived (the changes this script makes to the source data)
  1. Each file gives a value at 2-degree nodes: phi (x1) and psi (x2) = -179, -177, ..., 179.
     A node the file does not list has the value 0, as in cctbx mmtbx/rotamer/n_dim_table.py.
  2. Each node is classified with MolProbity's cutoffs, as coded in cctbx
     mmtbx/validation/ramalyze.py (ramalyze.evalScore): favoured when value >= 0.02; else allowed
     when value >= 0.0005 for the general case, >= 0.0020 for cis-Pro and >= 0.0010 for every
     other class; else outlier.
  3. Each 10-degree cell takes the median class of the 25 nodes inside it: favoured when at least
     13 of them are favoured, outlier when at least 13 are outliers, allowed otherwise.
  4. Row r of a map holds psi in [170 - 10 r, 180 - 10 r) and column c holds phi in
     [-180 + 10 c, -170 + 10 c); '#' is favoured, '+' allowed and '.' outlier.
"""
import argparse, hashlib, math, os, re, sys, urllib.request

COMMIT = '5ee6875fc29eccc3c9dc7cbe705ff9fd1b505d7d'
URL = ('https://raw.githubusercontent.com/rlabduke/reference_data/' + COMMIT
       + '/Top8000/Top8000_ramachandran_pct_contour_grids/')

FAVOURED = 0.02
# Rust constant: (grid file, allowed cutoff, SHA-256 of the file at COMMIT).
GRIDS = {
    'GENERAL_REGIONS': ('rama8000-general-noGPIVpreP.data', 0.0005,
                        'ccdbc6a201ca2510119e77b0dd169ca2cdea7f2c9ed348555a3b1129f8c2b00a'),
    'ILE_VAL_REGIONS': ('rama8000-ileval-nopreP.data', 0.0010,
                        '567e1318128a50b8f44362427bf717d564749936d22d5dbfd34e5b0c17819276'),
    'GLYCINE_REGIONS': ('rama8000-gly-sym.data', 0.0010,
                        '89c75a5ac036ff3309c51b46a2412f30137827abaff4606209ed41e04fcba637'),
    'PRE_PROLINE_REGIONS': ('rama8000-prepro-noGP.data', 0.0010,
                            '1cc10b92911d47ca775f0a8131a029b42634dbe26364cece4cfdc8c85b9c3fab'),
    'TRANS_PROLINE_REGIONS': ('rama8000-transpro.data', 0.0010,
                              '092b4c0bcd2fe846a063000c83d13cbe62ff43b2dafd67ecb8a47042cce747ec'),
    'CIS_PROLINE_REGIONS': ('rama8000-cispro.data', 0.0020,
                            '143a3004668baefaf6749bd9c2acbe829d3b1a93059c74ba766b04f1e00f43ab'),
}
NODES = [-179 + 2 * k for k in range(180)]
AXIS_HEADER = re.compile(r'^#\s+x[12]: -180\.0 180\.0 180 true$')


def fail(message):
    sys.exit(f'derive_ramachandran_maps: {message}')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


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
        if (phi, psi) in nodes:
            fail(f'{path}:{n}: node ({phi}, {psi}) listed twice')
        nodes[(phi, psi)] = value
    if not nodes:
        fail(f'empty: {path} lists no nodes')
    return nodes


def classify(value, allowed):
    if value >= FAVOURED:
        return '#'
    return '+' if value >= allowed else '.'


def derive(nodes, allowed):
    """36 rows of 36 cells, row 0 = psi 170..180, column 0 = phi -180..-170."""
    rows = []
    for r in range(36):
        psis = [p for p in NODES if 170 - 10 * r <= p < 180 - 10 * r]
        row = ''
        for c in range(36):
            phis = [p for p in NODES if -180 + 10 * c <= p < -170 + 10 * c]
            classes = [classify(nodes.get((float(f), float(s)), 0.0), allowed) for f in phis for s in psis]
            assert len(classes) == 25
            row += '#' if classes.count('#') >= 13 else '.' if classes.count('.') >= 13 else '+'
        rows.append(row)
    return rows


def committed_maps(rust_path):
    """{constant: (rows, the /// line above it)} for the six constants in the Rust file."""
    if not os.path.exists(rust_path):
        fail(f'missing: {rust_path}')
    try:
        with open(rust_path, encoding='utf-8') as fh:
            text = fh.read()
    except OSError as e:
        fail(f'unreadable: {rust_path}: {e}')
    found = {}
    for m in re.finditer(r'((?:^///[^\n]*\n)*)pub const (\w+_REGIONS): \[&str; 36\] = \[(.*?)\];', text,
                         re.S | re.M):
        rows = re.findall(r'"([^"]*)"', m.group(3))
        if len(rows) != 36 or any(len(row) != 36 or set(row) - set('#+.') for row in rows):
            fail(f'{rust_path}: {m.group(2)} is not 36 rows of 36 cells of "#", "+" or "."')
        found[m.group(2)] = (rows, m.group(1))
    missing = sorted(set(GRIDS) - set(found))
    if missing:
        fail(f'{rust_path}: constants not found: {", ".join(missing)}')
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    ap.add_argument('grid_dir', help='directory holding the six rama8000-*.data files')
    ap.add_argument('--fetch', action='store_true', help='download the files missing from grid_dir')
    ap.add_argument('--check', metavar='BACKBONE_RS', help='compare with the maps committed in this file')
    args = ap.parse_args()
    if args.fetch:
        fetch(args.grid_dir)
    derived = {const: derive(read_grid(os.path.join(args.grid_dir, name), digest), allowed)
               for const, (name, allowed, digest) in GRIDS.items()}
    if not args.check:
        for const, (name, allowed, _) in GRIDS.items():
            print(f'/// `{name}`, allowed cutoff {allowed:.4f}.')
            print(f'pub const {const}: [&str; 36] = [')
            print(''.join(f'    "{row}",\n' for row in derived[const]) + '];\n')
        return
    committed, differing, doc_mismatches = committed_maps(args.check), 0, 0
    for const, (name, allowed, _) in GRIDS.items():
        rows, doc = committed[const]
        if f'`{name}`' not in doc or f'allowed cutoff {allowed:.4f}' not in doc:
            doc_mismatches += 1
            print(f'{const}: its doc comment does not name `{name}` and allowed cutoff {allowed:.4f}')
        n = 0
        for r in range(36):
            for c in range(36):
                if rows[r][c] != derived[const][r][c]:
                    n += 1
                    print(f'{const} row {r} (psi {170 - 10 * r}..{180 - 10 * r}) column {c} '
                          f'(phi {-180 + 10 * c}..{-170 + 10 * c}): committed {rows[r][c]!r}, '
                          f'derived {derived[const][r][c]!r}')
        print(f'{const}: {n} of 1296 cells differ ({name}, allowed >= {allowed})')
        differing += n
    print(f'total: {differing} of {1296 * len(GRIDS)} cells differ; {doc_mismatches} doc comment mismatches')
    sys.exit(1 if differing or doc_mismatches else 0)


if __name__ == '__main__':
    main()
