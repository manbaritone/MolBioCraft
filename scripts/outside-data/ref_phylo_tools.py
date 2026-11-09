"""IQ-TREE maximum-likelihood references (best tree and fixed-topology log-likelihoods) for the
MrBayes primate alignment, and PAML yn00 pairwise dN/dS (Nei-Gojobori 1986 and Yang-Nielsen
2000) for the PAML HIV env and lysozyme codon alignments. Writes test-data/reference/phylo_tools.json."""
import json, os, re, subprocess, sys, tempfile
T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
r = json.load(open(f'{T}/reference/phylo_r.json'))
out = {'iqtree': {}}
with tempfile.TemporaryDirectory() as d:
    open(f'{d}/a.fa', 'w').write(''.join(f'>{n}\n{s}\n' for n, s in zip(r['names'], r['seqs'])))
    open(f'{d}/nj.tre', 'w').write(r['nj_k80'] + '\n')
    models = [b + r for b in ('JC', 'K2P', 'HKY', 'TN', 'GTR') for r in ('', '+G4', '+I', '+I+G4')]
    for m in models:
        for mode in (('search', 'fixed') if m in ('JC', 'K2P', 'HKY', 'GTR', 'HKY+G4', 'GTR+G4') else ('fixed',)):
            pre = f'{d}/{m.replace("+", "_")}_{mode}'
            cmd = ['iqtree', '-s', f'{d}/a.fa', '-m', m, '-nt', '1', '-seed', '1', '-pre', pre, '-quiet', '-redo']
            if mode == 'fixed': cmd += ['-te', f'{d}/nj.tre']
            subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            log = open(pre + '.iqtree').read()
            lnl = float(re.search(r'Log-likelihood of the tree: (-?[\d.]+)', log).group(1))
            tree = open(pre + '.treefile').read().strip()
            alpha = re.search(r'Gamma shape alpha: ([\d.]+)', log)
            out['iqtree'][f'{m}/{mode}'] = {'logLik': lnl, 'tree': tree, 'alpha': float(alpha.group(1)) if alpha else None}
            print(m, mode, lnl)

def read_paml_seqs(path):
    """PAML sequential format: either 'name  sequence' on one line or the name on its own line."""
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

out['yn00'] = {}
for f in ('HIVenvSweden.txt', 'lysozymeSmall.txt'):
    names, seqs = read_paml_seqs(f'{T}/paml/{f}')
    with tempfile.TemporaryDirectory() as d:
        open(f'{d}/s.txt', 'w').write(f'{len(names)} {len(seqs[0])}\n' + ''.join(f'{n}\n{s}\n' for n, s in zip(names, seqs)))
        open(f'{d}/yn00.ctl', 'w').write(f'seqfile = {d}/s.txt\noutfile = {d}/out\nverbose = 0\nicode = 0\nweighting = 0\ncommonf3x4 = 0\n')
        subprocess.run(['yn00', 'yn00.ctl'], cwd=d, stdout=subprocess.DEVNULL)
        txt = open(f'{d}/out').read()
        # Nei & Gojobori 1986: lower-triangular "w (dN dS)"
        ng = txt.split('Nei & Gojobori 1986')[1].split('(B)')[0]
        pairs = {}
        for l in ng.split('\n'):
            head = l[:20].strip()
            if head not in names: continue
            i = names.index(head)
            vals = re.findall(r'(-?[\d.]+) \(\s*(-?[\d.]+)\s+(-?[\d.]+)\)', l[20:])
            for j, (w, dn, ds) in enumerate(vals):
                pairs[f'{i}-{j}'] = {'w': float(w), 'dN': float(dn), 'dS': float(ds)}
        out['yn00'][f] = {'names': names, 'seqs': seqs, 'ng86': pairs}
        print(f, len(pairs))
# protein ML: Pfam globin seed (first 24 sequences) with LG / LG+G4 / WAG+G4
import gzip
from Bio import AlignIO
with gzip.open(f'{T}/pfam/PF00042.seed.sto.gz', 'rt', encoding='latin1') as fh:
    aln = AlignIO.read(fh, 'stockholm')
recs = [(r.id.replace('/', '_'), str(r.seq).upper().replace('.', '-')) for r in aln][:24]
keep = [c for c in range(len(recs[0][1])) if any(s[c] != '-' for _, s in recs)]
recs = [(n, ''.join(s[c] for c in keep)) for n, s in recs]
out['protein'] = {'names': [n for n, _ in recs], 'seqs': [s for _, s in recs], 'iqtree': {}}
with tempfile.TemporaryDirectory() as d:
    open(f'{d}/p.fa', 'w').write(''.join(f'>{n}\n{s}\n' for n, s in recs))
    for m in ('LG', 'LG+G4', 'WAG+G4', 'JTT+G4'):
        pre = f'{d}/{m.replace("+", "_")}'
        subprocess.run(['iqtree', '-s', f'{d}/p.fa', '-m', m, '-nt', '1', '-seed', '1', '-pre', pre, '-quiet', '-redo'], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        log = open(pre + '.iqtree').read()
        out['protein']['iqtree'][m] = {'logLik': float(re.search(r'Log-likelihood of the tree: (-?[\d.]+)', log).group(1)), 'tree': open(pre + '.treefile').read().strip()}
        print('protein', m, out['protein']['iqtree'][m]['logLik'])
json.dump(out, open(f'{T}/reference/phylo_tools.json', 'w'))
