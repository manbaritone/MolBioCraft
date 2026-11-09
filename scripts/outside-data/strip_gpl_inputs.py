"""Removes the GPL-3.0 input alignments that the reference scripts embed in their JSON (D0016) and
keeps, for each input, the SHA-256 of the fetched file and of the alignment the reference tool read
from it. Run it after the ref_* scripts and before committing test-data/reference/:

    python3 -I scripts/outside-data/strip_gpl_inputs.py test-data

- phylo_r.json (ref_phylo.R): `names` / `seqs`, the MrBayes primates alignment as ape read it.
- align.json (ref_align.py): the `reference` / `unaligned` rows of the MrBayes-primates family.
- phylo_tools.json (ref_phylo_tools.py): `names` / `seqs` of the PAML HIV env and lysozyme
  alignments under `yn00`. Run ref_phylo_tools.py before stripping phylo_r.json: it reads the
  primates alignment from there.

Each stripped file gains `inputs`: {path: {sha256, alignment_sha256, licence}}, where
`alignment_sha256` is the SHA-256 of one "name<TAB>sequence" line per taxon, in file order, joined
with "\\n" (UTF-8). Before removing anything, the script re-reads each input file and checks that it
gives exactly the embedded alignment, so the checksums describe what the tool used. The tests read
the inputs that fetch.sh downloads and check both checksums before comparing. A file that is
already stripped is checked against its input files and left as it is.
"""
import hashlib, json, os, re, sys

T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
GPL = 'GPL-3.0'


def sha256_file(path):
    with open(path, 'rb') as fh:
        return hashlib.sha256(fh.read()).hexdigest()


def alignment_sha256(names, seqs):
    return hashlib.sha256('\n'.join(f'{n}\t{s}' for n, s in zip(names, seqs)).encode('utf-8')).hexdigest()


def read_nexus_matrix(path):
    """The MATRIX block of a non-interleaved NEXUS file: (names, upper-case sequences), in file order."""
    names, seqs, inside = [], [], False
    for line in open(path, encoding='utf-8'):
        t = line.strip()
        if not inside:
            inside = t.lower() == 'matrix'
            continue
        if t.startswith(';'):
            break
        if t:
            name, *rest = t.split()
            names.append(name)
            seqs.append(''.join(rest).upper())
    if not names:
        sys.exit(f'{path}: no MATRIX rows')
    return names, seqs


def read_paml_seqs(path):
    """PAML sequential format, exactly as ref_phylo_tools.py reads it."""
    lines = [l.rstrip() for l in open(path).read().split('\n')]
    n, L = map(int, lines[0].split()[:2])
    names, seqs = [], []
    body = [l for l in lines[1:] if l.strip()]
    i = 0
    while len(names) < n and i < len(body):
        parts = body[i].split(None, 1)
        i += 1
        name = parts[0]
        s = re.sub(r'[^A-Za-z\-?]', '', parts[1]) if len(parts) > 1 else ''
        while len(s) < L and i < len(body):
            s += re.sub(r'[^A-Za-z\-?]', '', body[i]); i += 1
        names.append(name); seqs.append(s[:L].upper())
    return names, seqs


def align_reference(names, seqs):
    """ref_align.py's reference rows: the first 40, '.' and '?' as gaps, all-gap columns dropped."""
    recs = [(n, s.upper().replace('.', '-').replace('?', '-')) for n, s in zip(names, seqs)][:40]
    keep = [c for c in range(len(recs[0][1])) if any(s[c] != '-' for _, s in recs)]
    return [n for n, _ in recs], [''.join(s[c] for c in keep) for _, s in recs]


def entry(rel, names, seqs):
    return {'sha256': sha256_file(f'{T}/{rel}'), 'alignment_sha256': alignment_sha256(names, seqs), 'licence': GPL}


def check(doc, rel, names, seqs, what):
    """An input already recorded in `doc` must match the file and the alignment read from it."""
    want = doc['inputs'][rel]
    got = entry(rel, names, seqs)
    if want != got:
        sys.exit(f'{what}: {rel} does not match its recorded checksums ({want} vs {got})')


def load(name):
    with open(f'{T}/reference/{name}') as fh:
        return json.load(fh)


def save(name, doc):
    with open(f'{T}/reference/{name}', 'w') as fh:
        json.dump(doc, fh)
    print('stripped', name)


NEX = 'mrbayes/primates.nex'
nex = read_nexus_matrix(f'{T}/{NEX}')

# phylo_r.json: the primates alignment as ape::read.nexus.data read it (upper-cased)
r = load('phylo_r.json')
if 'seqs' in r:
    if (r['names'], r['seqs']) != nex:
        sys.exit(f'phylo_r.json: its names / seqs are not the alignment in {NEX}')
    del r['names'], r['seqs']
    r['inputs'] = {NEX: entry(NEX, *nex)}
    save('phylo_r.json', r)
else:
    check(r, NEX, *nex, 'phylo_r.json')

# align.json: the MrBayes-primates family's reference and unaligned rows
a = load('align.json')
ref = align_reference(*nex)
fams = [f for f in a['msa'] if f['family'] == 'MrBayes-primates']
if len(fams) != 1:
    sys.exit('align.json: expected one MrBayes-primates family')
fam = fams[0]
if 'reference' in fam:
    raw = {n: s.replace('-', '') for n, s in zip(*ref)}
    if list(fam['reference'].items()) != list(zip(*ref)) or fam['unaligned'] != raw:
        sys.exit(f'align.json: the MrBayes-primates rows are not the alignment in {NEX}')
    del fam['reference'], fam['unaligned']
    fam['input'] = NEX
    a['inputs'] = {NEX: entry(NEX, *ref)}
    save('align.json', a)
else:
    check(a, NEX, *ref, 'align.json')

# phylo_tools.json: the PAML codon alignments under yn00
t = load('phylo_tools.json')
changed = False
for f, y in t['yn00'].items():
    rel = f'paml/{f}'
    aln = read_paml_seqs(f'{T}/{rel}')
    if 'seqs' in y:
        if (y['names'], y['seqs']) != aln:
            sys.exit(f'phylo_tools.json: yn00 {f} names / seqs are not the alignment in {rel}')
        del y['names'], y['seqs']
        y['input'] = rel
        t.setdefault('inputs', {})[rel] = entry(rel, *aln)
        changed = True
    else:
        check(t, rel, *aln, 'phylo_tools.json')
if changed:
    save('phylo_tools.json', t)
