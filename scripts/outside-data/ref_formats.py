"""Reference parses of public files with Biopython / samtools / bcftools: GenBank (NCBI), EMBL
(ENA), AB1 traces (Biopython test files, Synthego ICE), PDB / mmCIF (RCSB), GFF3 (NCBI),
FASTQ / SAM / VCF (phiX174 simulation). Writes test-data/reference/formats.json."""
import glob, json, os, subprocess, sys, tempfile, warnings
from Bio import SeqIO
from Bio.PDB import PDBParser, MMCIFParser
warnings.filterwarnings('ignore')
T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
out = {'genbank': {}, 'embl': {}, 'ab1': {}, 'pdb': {}, 'gff3': {}, 'fastq': {}, 'sam': {}, 'vcf': {}}

def feats(rec):
    rows = []
    for f in rec.features:
        parts = list(getattr(f.location, 'parts', [f.location]))
        rows.append({'type': f.type, 'start': int(f.location.start) + 1, 'end': int(f.location.end), 'strand': f.location.strand or 0,
                     'parts': len(parts), 'qualifiers': sorted(f.qualifiers.keys())})
    return rows

for p in sorted(glob.glob(f'{T}/ncbi/*.gb')):
    r = SeqIO.read(p, 'genbank')
    out['genbank'][os.path.basename(p)] = {'length': len(r.seq), 'seq': str(r.seq).upper(), 'topology': r.annotations.get('topology'), 'molecule': r.annotations.get('molecule_type'), 'features': feats(r)}
for p in sorted(glob.glob(f'{T}/ena/*.embl')):
    r = SeqIO.read(p, 'embl')
    out['embl'][os.path.basename(p)] = {'length': len(r.seq), 'seq': str(r.seq).upper(), 'features': feats(r)}
for p in sorted(glob.glob(f'{T}/biopython-abi/*.ab1') + glob.glob(f'{T}/synthego-ice/*.ab1')):
    try:
        r = SeqIO.read(p, 'abi')
    except Exception as e:
        print('skip', p, e); continue
    raw = r.annotations['abif_raw']
    out['ab1'][os.path.relpath(p, T)] = {'basecalls': str(r.seq), 'quals': r.letter_annotations.get('phred_quality', []),
                                         'ploc': list(raw.get('PLOC2', raw.get('PLOC1', [])))}
parser_pdb, parser_cif = PDBParser(QUIET=True), MMCIFParser(QUIET=True)
for p in sorted(glob.glob(f'{T}/rcsb/*.pdb')) + sorted(glob.glob(f'{T}/rcsb/*.cif')):
    s = (parser_cif if p.endswith('.cif') else parser_pdb).get_structure('x', p)
    m = next(iter(s))
    chains = {c.id: {'residues': sum(1 for res in c if res.id[0] == ' '), 'atoms': sum(1 for res in c if res.id[0] == ' ' for _ in res)} for c in m}
    out['pdb'][os.path.basename(p)] = {'models': len(s), 'chains': chains, 'atoms_model1': sum(1 for _ in m.get_atoms())}
for p in sorted(glob.glob(f'{T}/ncbi/*.gff3')):
    rows = [l.split('\t') for l in open(p) if l.strip() and not l.startswith('#')]
    out['gff3'][os.path.basename(p)] = {'records': len(rows), 'types': sorted({r[2] for r in rows}), 'first': [[r[2], int(r[3]), int(r[4]), r[6]] for r in rows[:8]]}
fq = list(SeqIO.parse(f'{T}/sim/phix_r1.fq', 'fastq'))
out['fastq'] = {'count': len(fq), 'first': [{'id': r.id, 'seq': str(r.seq), 'qual': r.letter_annotations['phred_quality']} for r in fq[:3]], 'mean_quality': sum(sum(r.letter_annotations['phred_quality']) for r in fq) / sum(len(r) for r in fq)}
with tempfile.TemporaryDirectory() as d:
    with open(f'{T}/sim/phix.sam', 'w') as fh:
        subprocess.run(['bwa', 'mem', f'{T}/sim/phix_ref.fa', f'{T}/sim/phix_r1.fq'], check=True, stdout=fh, stderr=subprocess.DEVNULL)
    rows = [l.split('\t') for l in open(f'{T}/sim/phix.sam') if not l.startswith('@')]
    out['sam'] = {'records': len(rows), 'mapped': sum(1 for r in rows if not int(r[1]) & 4), 'first': [{'qname': r[0], 'flag': int(r[1]), 'pos': int(r[3]), 'mapq': int(r[4]), 'cigar': r[5]} for r in rows[:10]]}
    subprocess.run(f'samtools sort -o {d}/a.bam {T}/sim/phix.sam 2>/dev/null && samtools index {d}/a.bam && bcftools mpileup -f {T}/sim/phix_ref.fa {d}/a.bam 2>/dev/null | bcftools call -mv --ploidy 1 -Ov -o {T}/sim/phix.vcf 2>/dev/null', shell=True, check=True)
    vrows = [l.split('\t') for l in open(f'{T}/sim/phix.vcf') if not l.startswith('#')]
    out['vcf'] = {'records': len(vrows), 'rows': [{'chrom': r[0], 'pos': int(r[1]), 'ref': r[3], 'alt': r[4]} for r in vrows]}
json.dump(out, open(f'{T}/reference/formats.json', 'w'))
print({k: len(v) for k, v in out.items()})
