"""Reference results for the core sequence tools: translation (Biopython, all NCBI tables), ORFs
(EMBOSS getorf), restriction digests (Biopython Restriction), protein parameters (ExPASy
ProtParam, fetched online and cached in test-data/expasy/), primer Tm (Primer3), RNA MFE folding
(ViennaRNA), tryptic digests (pyteomics), DNA statistics (Biopython) and BLAST (NCBI BLAST+).
Writes test-data/reference/seqtools.json."""
import json, os, re, subprocess, sys, tempfile, urllib.request
from Bio import SeqIO
from Bio.Seq import Seq
from Bio.Data import CodonTable
from Bio.Restriction import Analysis, RestrictionBatch
from Bio.SeqUtils import gc_fraction, molecular_weight
import primer3, RNA
from pyteomics import mass, parser

T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
rec = lambda a: next(SeqIO.parse(f'{T}/ncbi/{a}.fasta', 'fasta'))
seq = lambda a: str(rec(a).seq).upper()
up = lambda a: str(next(SeqIO.parse(f'{T}/uniprot/{a}.fasta', 'fasta')).seq).upper()
out = {}

# ── translation ──
lam = seq('J02459')
dna = lam[1000:2500]
out['translate'] = [{'table': t, 'frame': f, 'dna': dna, 'protein': str(Seq(dna[f:len(dna) - (len(dna) - f) % 3]).translate(table=t))}
                    for t in sorted(CodonTable.unambiguous_dna_by_id) for f in range(3)]

# ── ORFs (getorf -find 1: translation between STOP codons, ATG-started via -find 3 equivalent) ──
orfs = {}
for acc, circ in (('NC_001422', True), ('J02459', False), ('L09137', True)):
    s = seq(acc)
    with tempfile.TemporaryDirectory() as d:
        open(f'{d}/s.fa', 'w').write(f'>s\n{s}\n')
        subprocess.run(['getorf', '-sequence', f'{d}/s.fa', '-outseq', f'{d}/o.fa', '-find', '3', '-minsize', '300', '-table', '0', '-circular', 'Y' if circ else 'N', '-auto'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        rows = []
        for r in SeqIO.parse(f'{d}/o.fa', 'fasta'):
            m = re.search(r'\[(\d+) - (\d+)\]( \(REVERSE SENSE\))?', r.description)
            a, b = int(m.group(1)), int(m.group(2))
            rows.append({'start': a, 'end': b, 'reverse': bool(m.group(3)), 'nt': len(r.seq)})
    orfs[acc] = {'circular': circ, 'seq': s, 'orfs': rows}
out['orfs'] = orfs

# ── restriction ──
enz = ['EcoRI', 'HindIII', 'BamHI', 'PstI', 'SalI', 'XhoI', 'NotI', 'BsaI', 'BsmBI', 'SapI', 'AluI', 'HaeIII', 'MboI', 'TaqI', 'NdeI', 'NcoI', 'KpnI', 'SacI', 'XbaI', 'SmaI', 'EcoRV', 'SpeI', 'BglII', 'ClaI', 'ApaI', 'PvuII', 'ScaI', 'BsaAI', 'AvaI', 'HincII']
rb = RestrictionBatch(enz)
digests = {}
for acc, circ in (('J02459', False), ('L09137', True), ('J01749', True), ('NC_001422', True)):
    s = Seq(seq(acc))
    an = Analysis(rb, s, linear=not circ)
    res = an.full()
    cuts = {str(e): sorted(v) for e, v in res.items()}
    digests[acc] = {'circular': circ, 'length': len(s), 'cuts': cuts}
out['restriction'] = digests

# ── protein parameters (ExPASy ProtParam) ──
os.makedirs(f'{T}/expasy', exist_ok=True)
prot = {}
for f in sorted(os.listdir(f'{T}/uniprot')):
    if not f.endswith('.fasta'): continue
    acc = f[:-6]
    cache = f'{T}/expasy/{acc}.txt'
    if not os.path.exists(cache):
        html = urllib.request.urlopen(f'https://web.expasy.org/cgi-bin/protparam/protparam1?{acc}@noft@', timeout=60).read().decode('latin1')
        open(cache, 'w').write(re.sub(r'<[^>]*>', '', html))
    txt = open(cache).read()
    g = lambda pat: float(re.search(pat, txt).group(1))
    ext = [float(x) for x in re.findall(r'Ext\. coefficient\s+(\d+)', txt)]
    prot[acc] = {'seq': up(acc), 'mw': g(r'Molecular weight:\s*([\d.]+)'), 'pI': g(r'Theoretical pI:\s*([\d.]+)'),
                 'ext_cystine': ext[0] if ext else None, 'ext_reduced': ext[1] if len(ext) > 1 else (ext[0] if ext else None),
                 'instability': g(r'computed to be\s*([\d.]+)'), 'aliphatic': g(r'Aliphatic index:\s*([\d.]+)'), 'gravy': g(r'GRAVY\):\s*(-?[\d.]+)')}
out['protparam'] = prot

# ── primer Tm (Primer3: SantaLucia 1998 nearest neighbour, SantaLucia salt correction) ──
primers = ['GTAAAACGACGGCCAGT', 'CAGGAAACAGCTATGAC', 'TAATACGACTCACTATAGGG', 'ATTTAGGTGACACTATAG', 'GCTAGTTATTGCTCAGCGG', 'AGCGGATAACAATTTCACACAGGA',
           'ACGCGTCGACGTCGGCCATAGCGGCCGCGGAA', 'TTGACAATTAATCATCGGCTCGTATAATG', 'GGGGCGCGCCCC', 'ATATATATATATATATAT', 'CCCAGTCACGACGTTGTAAAACG', 'GAGCGGATAACAATTTCACACAGG']
out['tm'] = [{'seq': p, 'na_mm': 50, 'mg_mm': mg, 'dntp_mm': 0.0, 'primer_nm': 250,
              'tm': primer3.calc_tm(p, mv_conc=50, dv_conc=mg, dntp_conc=0.0, dna_conc=250)} for p in primers for mg in (0.0, 1.5)]

# ── RNA folding (ViennaRNA RNAfold, Turner 2004, 37 °C) ──
rnas = {
    'tRNA-Phe (yeast)': 'GCGGAUUUAGCUCAGUUGGGAGAGCGCCAGACUGAAGAUCUGGAGGUCCUGUGUUCGAUCCACAGAAUUCGCACCA',
    'SARS-CoV-2 5′ 120 nt': seq('NC_045512')[:120].replace('T', 'U'),
    'lambda 200 nt': lam[30000:30200].replace('T', 'U'),
    'pUC19 lac 150 nt': seq('L09137')[2200:2350].replace('T', 'U'),
}
out['rnafold'] = []
for name, s in rnas.items():
    st, mfe = RNA.fold(s)
    out['rnafold'].append({'name': name, 'seq': s, 'structure': st, 'mfe': mfe})

# ── tryptic digest (pyteomics; monoisotopic [M+H]+, carbamidomethyl Cys) ──
out['digest'] = []
for acc in ('P02769', 'P68871', 'P00698'):
    s = up(acc)
    peps = parser.cleave(s, parser.expasy_rules['trypsin'], missed_cleavages=1)
    rows = []
    for p in sorted(peps):
        m = mass.calculate_mass(sequence=p) + 57.021464 * p.count('C') + 1.007276
        if 400 <= m <= 4500: rows.append({'peptide': p, 'mh': m})
    out['digest'].append({'acc': acc, 'seq': s, 'peptides': rows})

# ── DNA statistics ──
out['dnastats'] = [{'acc': a, 'seq': seq(a), 'gc': gc_fraction(seq(a)), 'mw_ss': molecular_weight(Seq(seq(a)), 'DNA'), 'mw_ds': molecular_weight(Seq(seq(a)), 'DNA', double_stranded=True)} for a in ('L09137', 'NC_001422')]

# ── BLAST+ (scoring matched to the app: blastn -task blastn +2/-3 gaps 5/2; BLOSUM62 11/1 without
#    composition-based statistics) ──
def blast(prog, query, subjects, dbtype, extra=()):
    with tempfile.TemporaryDirectory() as d:
        open(f'{d}/db.fa', 'w').write(''.join(f'>{a}\n{s}\n' for a, s in subjects.items()))
        subprocess.run(['makeblastdb', '-in', f'{d}/db.fa', '-dbtype', dbtype, '-out', f'{d}/db'], check=True, stdout=subprocess.DEVNULL)
        open(f'{d}/q.fa', 'w').write(f'>q\n{query}\n')
        r = subprocess.run([prog, '-query', f'{d}/q.fa', '-db', f'{d}/db', '-outfmt', '6 sseqid pident length qstart qend sstart send evalue bitscore', '-evalue', '1e-5', *extra], check=True, capture_output=True, text=True).stdout
    keys = ['sseqid', 'pident', 'length', 'qstart', 'qend', 'sstart', 'send', 'evalue', 'bitscore']
    return [dict(zip(keys, l.split('\t'))) for l in r.strip().split('\n') if l]
nsub = {a: seq(a) for a in ('J01749', 'J02459', 'NC_001422', 'X02514', 'V01555')}
psub = {a: up(a) for a in ('P69905', 'P02144', 'P68082', 'P04637', 'P61626', 'P01308', 'P62593')}
out['blast'] = {
    'blastn': {'query': seq('L09137'), 'subjects': nsub, 'hits': blast('blastn', seq('L09137'), nsub, 'nucl', ['-task', 'blastn', '-reward', '2', '-penalty', '-3', '-gapopen', '5', '-gapextend', '2', '-dust', 'no'])},
    'blastp': {'query': up('P68871'), 'subjects': psub, 'hits': blast('blastp', up('P68871'), psub, 'prot', ['-comp_based_stats', '0', '-seg', 'no'])},
    'blastx': {'query': seq('J01749')[3000:4361], 'subjects': psub, 'hits': blast('blastx', seq('J01749')[3000:4361], psub, 'prot', ['-comp_based_stats', '0', '-seg', 'no'])},
    'tblastn': {'query': up('P62593'), 'subjects': {a: seq(a) for a in ('J01749', 'L09137', 'J02459')}, 'hits': blast('tblastn', up('P62593'), {a: seq(a) for a in ('J01749', 'L09137', 'J02459')}, 'nucl', ['-comp_based_stats', '0', '-seg', 'no'])},
}
hits_n, hits_p = out['blast']['blastn']['hits'], out['blast']['blastp']['hits']
json.dump(out, open(f'{T}/reference/seqtools.json', 'w'))
print({k: len(v) for k, v in out.items()})
for k, v in out['blast'].items(): print(k, v['hits'][:5])
