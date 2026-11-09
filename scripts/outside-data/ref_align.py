"""Reference results for pairwise and multiple alignment (Biopython PairwiseAligner, MAFFT,
MUSCLE, Clustal Omega) on UniProt / GenBank sequences and Pfam seed alignments, and an independent
computation of the sample alignments' statistics (`samples`, US-01M6TDSV).
Writes test-data/reference/align.json. Run with the reference conda env (see README.md).

    ref_align.py [test-data]             everything (needs MAFFT, MUSCLE and Clustal Omega)
    ref_align.py [test-data] --samples   only `samples`, merged into the existing align.json
"""
import gzip, hashlib, json, math, os, re, statistics, subprocess, sys, tempfile
from collections import Counter
from Bio import SeqIO, AlignIO
from Bio.Align import PairwiseAligner, substitution_matrices
from Bio.Seq import Seq

ARGS = [a for a in sys.argv[1:] if not a.startswith('--')]
T = ARGS[0] if ARGS else 'test-data'
SAMPLES_ONLY = '--samples' in sys.argv[1:]

# ---- The sample alignments' statistics (US-01M6TDSV) ----------------------------------------------
# Read from the rows the library ships (sample_alignments_data.rs) and computed here without
# MolBioCraft's code: Biopython where it has the call (residue counting with Seq.count, codon
# translation with Seq.translate), plain Python where it has none (pooled pairwise identity,
# identical sites, the identity matrix, codon counts). src/__tests__/alignmentScientificAccuracy.test.ts
# checks the library's stored and computed statistics against these values, and checks that
# `rows_sha256` is the SHA-256 of the rows the library holds, so the values describe those rows.
SAMPLES_RS = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'crates', 'molbiocraft-cloning', 'src', 'sample_alignments_data.rs')
SAMPLE_SETS = ('coxii_cds', 'hiv_env', 'ig_variable', 'lysr_family', 'pairwise_protein', 'three_kingdoms', 'transcript_variants')


def sample_rows(rs_path):
    """{doc id: [(member id, name, row)]}, from each `fn <set>_members()` of the Rust source."""
    src = open(rs_path, encoding='utf-8').read()
    sets = {}
    for fn in SAMPLE_SETS:
        a = src.index(f'fn {fn}_members()')
        b = src.index('\nfn ', a + 5)
        rows = []
        for part in src[a:b].split('        AlignmentMemberSequence {')[1:]:
            field = lambda k: re.search(r'\n            ' + k + r': "([^"]*)"', part).group(1)
            rows.append((field('id'), field('name'), field('sequence')))
        if not rows:
            sys.exit(f'{rs_path}: no members in fn {fn}_members()')
        sets['doc-aln-' + fn.replace('_', '-')] = rows
    return sets


def rows_sha256(rows):
    """SHA-256 of one "id<TAB>row" line per member, in order, joined with "\\n" (UTF-8)."""
    return hashlib.sha256('\n'.join(f'{i}\t{s}' for i, _, s in rows).encode('utf-8')).hexdigest()


def span(s):
    """First and last residue column (0-based) of a row; outside it the row has only end gaps."""
    return len(s) - len(s.lstrip('-')), len(s.rstrip('-')) - 1


def pooled_pairwise_identity(seqs):
    """Identical residue pairs and compared columns, pooled over all pairs, inside each pair's
    overlap: end gaps are not compared, gap-gap columns are skipped, gap-residue columns differ."""
    same = compared = 0
    spans = [span(s) for s in seqs]
    for i in range(len(seqs)):
        for j in range(i + 1, len(seqs)):
            for c in range(max(spans[i][0], spans[j][0]), min(spans[i][1], spans[j][1]) + 1):
                x, y = seqs[i][c], seqs[j][c]
                if x == '-' and y == '-':
                    continue
                compared += 1
                same += x == y
    return same, compared


def identical_sites(seqs):
    """Columns where every row spanning the column carries the same residue (no gap)."""
    spans = [span(s) for s in seqs]
    n = 0
    for c in range(len(seqs[0])):
        col = [s[c] for s, (a, b) in zip(seqs, spans) if a <= c <= b]
        n += bool(col) and '-' not in col and len(set(col)) == 1
    return n


def pair_identity(a, b):
    """% identity of two rows over their overlap, gap-gap columns skipped."""
    (a0, a1), (b0, b1) = span(a), span(b)
    matches = valid = 0
    for c in range(max(a0, b0), min(a1, b1) + 1):
        if a[c] == '-' and b[c] == '-':
            continue
        valid += 1
        matches += a[c] == b[c]
    return (matches / valid) * 100


def sample_statistics():
    out = {}
    for doc_id, rows in sample_rows(SAMPLES_RS).items():
        seqs = [s.upper() for _, _, s in rows]
        lengths = [len(s.replace('-', '')) for s in seqs]
        aligned = len(set(map(len, seqs))) == 1 and any('-' in s for s in seqs)
        composition = Counter()
        for s in seqs:
            ungapped = Seq(s.replace('-', ''))
            for ch in set(str(ungapped)):
                composition[ch] += ungapped.count(ch)
        rec = {
            'rows_sha256': rows_sha256(rows), 'aligned': aligned, 'ids': [i for i, _, _ in rows],
            'composition': dict(sorted(composition.items())), 'residues': sum(lengths),
            'lengths': {'mean': statistics.mean(lengths), 'sd': statistics.stdev(lengths), 'min': min(lengths), 'max': max(lengths)},
        }
        if aligned:
            width = len(seqs[0])
            same, compared = pooled_pairwise_identity(seqs)
            sites = identical_sites(seqs)
            # Percentages rounded to one decimal as the app reports them (half up).
            rec.update({
                'width': width,
                'pairwise_identity': {'same': same, 'compared': compared, 'pct': math.floor((same / compared) * 1000 + 0.5) / 10},
                'identical_sites': {'count': sites, 'pct': math.floor((1000 * sites) / width + 0.5) / 10},
                'identity_matrix': [[i, j, pair_identity(seqs[i], seqs[j])] for i in range(len(seqs)) for j in range(i + 1, len(seqs))],
            })
        elif set(composition) <= set('ACGTU'):
            codons, amino = Counter(), Counter()
            for s in seqs:
                clean = Seq(s.replace('-', '').replace('U', 'T'))
                whole = len(clean) - len(clean) % 3
                for i in range(0, whole, 3):
                    codons[str(clean[i:i + 3])] += 1
                for aa in str(clean[:whole].translate(table=1)):
                    amino[aa] += 1
            rec.update({'codon_usage': dict(sorted(codons.items())), 'translated_composition': dict(sorted(amino.items()))})
        out[doc_id] = rec
    return out


if SAMPLES_ONLY:
    path = f'{T}/reference/align.json'
    doc = json.load(open(path))
    doc['samples'] = sample_statistics()
    json.dump(doc, open(path, 'w'))
    print('samples', len(doc['samples']))
    sys.exit(0)

seq = lambda p: str(next(SeqIO.parse(p, 'fasta')).seq).upper()
up = lambda a: seq(f'{T}/uniprot/{a}.fasta')
nc = lambda a: seq(f'{T}/ncbi/{a}.fasta')

def score(a, b, mode, matrix, ms=5, mm=-4, go=-10, ge=-1):
    al = PairwiseAligner()
    if matrix == 'dna':
        al.match_score, al.mismatch_score = ms, mm
    else:
        al.substitution_matrix = substitution_matrices.load(matrix.upper())
    # rust-bio: a gap of length k costs go + k*ge
    al.open_gap_score, al.extend_gap_score = go + ge, ge
    if mode == 'local':
        al.mode = 'local'
    else:
        al.mode = 'global'
        if mode == 'semiglobal':
            al.end_gap_score = 0
    return int(al.score(a, b))

pairs = []
prot = [('P68871', 'P69905'), ('P68871', 'P02144'), ('P02144', 'P68082'), ('P00698', 'P61626'), ('P68871', 'P04637'), ('P01308', 'P61626'), ('P00760', 'P01009'), ('P0DTC2', 'P00533')]
for a, b in prot:
    for mode in ('global', 'local', 'semiglobal'):
        for m in ('blosum62', 'pam250'):
            pairs.append({'name': f'{a}-{b}', 'mode': mode, 'matrix': m, 'a': up(a), 'b': up(b), 'go': -10, 'ge': -1, 'score': score(up(a), up(b), mode, m)})
puc, pbr, phix, lam = nc('L09137'), nc('J01749'), nc('NC_001422'), nc('J02459')
dna = [('pUC19-pBR322', puc, pbr), ('pUC19-ori-pBR322', puc[1000:2400], pbr), ('phiX-half', phix[:2700], phix[2500:5386]), ('lambda-6k', lam[:6000], lam[3000:9500])]
for name, a, b in dna:
    for mode in ('global', 'local', 'semiglobal'):
        pairs.append({'name': name, 'mode': mode, 'matrix': 'dna', 'a': a, 'b': b, 'ms': 5, 'mm': -4, 'go': -10, 'ge': -1, 'score': score(a, b, mode, 'dna')})

def read_fasta_aln(path):
    return {r.id: str(r.seq).upper().replace('.', '-') for r in SeqIO.parse(path, 'fasta')}

def qscore(ref, test):
    """Fraction of residue pairs aligned in the reference that the test alignment also aligns."""
    def pairs_of(aln):
        cols = {}
        names = sorted(aln)
        idx = {n: 0 for n in names}
        out = set()
        L = len(next(iter(aln.values())))
        for c in range(L):
            col = []
            for n in names:
                ch = aln[n][c]
                if ch != '-':
                    col.append((n, idx[n])); idx[n] += 1
            for i in range(len(col)):
                for j in range(i + 1, len(col)):
                    out.add((col[i], col[j]))
        return out
    r = pairs_of(ref)
    t = pairs_of(test)
    return len(r & t) / max(1, len(r))

def families():
    for pf in sorted(os.listdir(f'{T}/pfam')):
        if not pf.endswith('.sto.gz'): continue
        with gzip.open(f'{T}/pfam/{pf}', 'rt', encoding='latin1') as fh:
            yield pf.split('.')[0], AlignIO.read(fh, 'stockholm')
    # DNA: curated alignments shipped with MrBayes
    for nx in ('primates.nex', 'cynmix.nex', 'hymfossil.nex'):
        p = f'{T}/mrbayes/{nx}'
        if os.path.exists(p):
            try:
                yield 'MrBayes-' + nx.split('.')[0], AlignIO.read(p, 'nexus')
            except Exception as e:
                print('skip', nx, e)

msa = []
for fam, aln in families():
    pf = fam
    recs = [(r.id, str(r.seq).upper().replace('.', '-').replace('?', '-').replace('N', 'N')) for r in aln][:40]
    ref = {i: s for i, s in recs}
    # drop columns that are all gaps after the subset
    keep = [c for c in range(len(recs[0][1])) if any(s[c] != '-' for _, s in recs)]
    ref = {i: ''.join(s[c] for c in keep) for i, s in ref.items()}
    raw = {i: s.replace('-', '') for i, s in ref.items()}
    tools = {}
    with tempfile.TemporaryDirectory() as d:
        inp = f'{d}/in.fa'
        open(inp, 'w').write(''.join(f'>{i}\n{s}\n' for i, s in raw.items()))
        cmds = {
            'mafft-auto': f'mafft --auto --quiet {inp} > {d}/o.fa',
            'mafft-linsi': f'mafft --localpair --maxiterate 1000 --quiet {inp} > {d}/o.fa',
            'muscle': f'muscle -align {inp} -output {d}/o.fa > /dev/null 2>&1 || muscle -in {inp} -out {d}/o.fa -quiet',
            'clustalo': f'clustalo -i {inp} -o {d}/o.fa --force',
        }
        for k, c in cmds.items():
            subprocess.run(c, shell=True, check=True)
            tools[k] = round(qscore(ref, read_fasta_aln(f'{d}/o.fa')), 4)
    msa.append({'family': fam, 'dna': fam.startswith('MrBayes'), 'n': len(raw), 'reference': ref, 'unaligned': raw, 'q': tools})
    print(pf, len(raw), tools)

os.makedirs(f'{T}/reference', exist_ok=True)
json.dump({'pairwise': pairs, 'msa': msa, 'samples': sample_statistics()}, open(f'{T}/reference/align.json', 'w'))
print('pairwise', len(pairs))
