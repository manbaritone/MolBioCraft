"""Simulated Illumina reads with known truth from real genomes, plus standard-pipeline results:
- phiX174 (NC_001422): wgsim reads (150 bp, ~2% errors) with SNPs / small indels; BWA-MEM +
  bcftools call variants; SPAdes contigs.
- lambda (J02459) 12 kb segment with an engineered 500-bp deletion, 300-bp insertion and 1-kb
  inversion: reads for Find Structural Variants.
Writes test-data/sim/ and test-data/reference/ngs.json. Needs wgsim, bwa, samtools, bcftools, spades.py."""
import json, os, random, re, subprocess, sys, tempfile
from Bio import SeqIO

T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
S = f'{T}/sim'
os.makedirs(S, exist_ok=True)
run = lambda *a, **k: subprocess.run(list(a), check=True, **k)
phix = str(next(SeqIO.parse(f'{T}/ncbi/NC_001422.fasta', 'fasta')).seq).upper()
open(f'{S}/phix_ref.fa', 'w').write(f'>phiX174\n{phix}\n')

# wgsim: -N reads, -1/-2 lengths, -e base error, -r mutation rate, -R indel fraction, -S seed
truth_txt = subprocess.run(['wgsim', '-N', '1500', '-1', '150', '-2', '150', '-e', '0.002', '-r', '0.003', '-R', '0.2', '-X', '0.3', '-S', '11',
                            f'{S}/phix_ref.fa', f'{S}/phix_r1.fq', f'{S}/phix_r2.fq'], check=True, capture_output=True, text=True).stdout
truth = []
for l in truth_txt.strip().split('\n'):
    f = l.split('\t')
    if len(f) >= 4:
        truth.append({'pos': int(f[1]), 'ref': f[2], 'alt': f[3], 'het': f[3] not in 'ACGT-' and len(f[3]) == 1})
# BWA-MEM + bcftools (haploid)
with tempfile.TemporaryDirectory() as d:
    run('bwa', 'index', f'{S}/phix_ref.fa', stderr=subprocess.DEVNULL)
    with open(f'{d}/a.sam', 'w') as fh:
        run('bwa', 'mem', '-t', '2', f'{S}/phix_ref.fa', f'{S}/phix_r1.fq', stdout=fh, stderr=subprocess.DEVNULL)
    run('samtools', 'sort', '-o', f'{d}/a.bam', f'{d}/a.sam', stderr=subprocess.DEVNULL)
    run('samtools', 'index', f'{d}/a.bam')
    mapped = int(subprocess.run(['samtools', 'view', '-c', '-F', '0x904', f'{d}/a.bam'], check=True, capture_output=True, text=True).stdout)
    vcf = subprocess.run(f'bcftools mpileup -f {S}/phix_ref.fa {d}/a.bam 2>/dev/null | bcftools call -mv --ploidy 1 2>/dev/null', shell=True, check=True, capture_output=True, text=True).stdout
calls = []
for l in vcf.split('\n'):
    if l and not l.startswith('#'):
        f = l.split('\t')
        calls.append({'pos': int(f[1]), 'ref': f[3], 'alt': f[4], 'qual': float(f[5])})
# SPAdes on the read pairs
with tempfile.TemporaryDirectory() as d:
    run('spades.py', '-1', f'{S}/phix_r1.fq', '-2', f'{S}/phix_r2.fq', '-o', f'{d}/sp', '--only-assembler', '-t', '2', '-k', '33,55', stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    contigs = [str(r.seq) for r in SeqIO.parse(f'{d}/sp/contigs.fasta', 'fasta')]

# structural variants in a lambda segment
lam = str(next(SeqIO.parse(f'{T}/ncbi/J02459.fasta', 'fasta')).seq).upper()
ref = lam[10000:22000]
rng = random.Random(5)
comp = {'A': 'T', 'C': 'G', 'G': 'C', 'T': 'A'}
rc = lambda s: ''.join(comp[c] for c in reversed(s))
ins = ''.join(rng.choice('ACGT') for _ in range(300))
# deletion 2001-2500, insertion after 5000, inversion 8001-9000 (1-based reference coordinates)
alt = ref[:2000] + ref[2500:5000] + ins + ref[5000:8000] + rc(ref[8000:9000]) + ref[9000:]
open(f'{S}/sv_ref.fa', 'w').write(f'>lambda_10001_22000\n{ref}\n')
reads = []
for k in range(1400):
    p = rng.randrange(0, len(alt) - 150)
    s = alt[p:p + 150]
    if rng.random() < 0.5: s = rc(s)
    reads.append(s)
open(f'{S}/sv_reads.fa', 'w').write(''.join(f'>sv{k}\n{s}\n' for k, s in enumerate(reads)))
sv_truth = [{'type': 'Deletion', 'start': 2001, 'end': 2500, 'size': 500}, {'type': 'Insertion', 'start': 5000, 'end': 5000, 'size': 300}, {'type': 'Inversion', 'start': 8001, 'end': 9000, 'size': 1000}]

json.dump({'phix': {'truth': truth, 'bcftools': calls, 'bwa_mapped': mapped, 'reads': 1500, 'spades_contigs': contigs, 'genome_length': len(phix)},
           'sv': {'truth': sv_truth}}, open(f'{T}/reference/ngs.json', 'w'))
print('truth variants', len(truth), 'bcftools', len(calls), 'bwa mapped', mapped, 'spades contigs', [len(c) for c in contigs][:5])
