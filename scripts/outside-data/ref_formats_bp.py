"""Biopython parses of Biopython's own format test files (test-data/biopython-tests): alignments
(Clustal, PHYLIP, Stockholm, NEXUS, aligned FASTA), multi-record GenBank / EMBL, FASTQ in each
quality encoding, BAM. Writes test-data/reference/formats_bp.json."""
import glob, json, os, shutil, subprocess, sys, warnings
from Bio import AlignIO, SeqIO
warnings.filterwarnings('ignore')
T = sys.argv[1] if len(sys.argv) > 1 else 'test-data'
B = f'{T}/biopython-tests'
out = {'alignments': {}, 'records': {}, 'fastq': {}, 'bam': {}}

def aln(path, fmt, **kw):
    try:
        a = AlignIO.read(path, fmt, **kw)
    except Exception as e:
        return None
    return {'format': fmt, 'names': [r.id for r in a], 'seqs': [str(r.seq).upper() for r in a]}

for p in sorted(glob.glob(f'{B}/Clustalw/*.aln')):
    r = aln(p, 'clustal')
    if r: out['alignments'][os.path.relpath(p, B)] = r
for p in sorted(glob.glob(f'{B}/Phylip/*.phy')):
    for fmt in (('phylip-sequential', 'phylip', 'phylip-relaxed') if 'sequential' in p else ('phylip', 'phylip-relaxed', 'phylip-sequential')):
        r = aln(p, fmt)
        if r:
            out['alignments'][os.path.relpath(p, B)] = r
            break
for p in sorted(glob.glob(f'{B}/Stockholm/*.sth')) + sorted(glob.glob(f'{B}/Stockholm/*.sto')):
    r = aln(p, 'stockholm')
    if r: out['alignments'][os.path.relpath(p, B)] = r
for p in sorted(glob.glob(f'{B}/Clustalw/*.fa')):
    r = aln(p, 'fasta')
    if r: out['alignments'][os.path.relpath(p, B)] = r

def feats(rec):
    return [{'type': f.type, 'start': int(f.location.start) + 1, 'end': int(f.location.end), 'strand': f.location.strand or 0} for f in rec.features if f.location is not None]
for d, fmt, exts in (('GenBank', 'genbank', ('*.gb', '*.gbk', '*.genbank')), ('EMBL', 'embl', ('*.embl',))):
    for ext in exts:
        for p in sorted(glob.glob(f'{B}/{d}/{ext}')):
            try:
                recs = list(SeqIO.parse(p, fmt))
            except Exception as e:
                print('skip', p, str(e)[:80]); continue
            if not recs: continue
            out['records'][os.path.relpath(p, B)] = {'format': fmt, 'records': [{'id': r.id, 'name': r.name, 'length': len(r.seq), 'seq': (str(r.seq).upper() if r.seq.defined else ''), 'features': feats(r)} for r in recs]}

for p, fmt in [(f'{B}/Quality/example.fastq', 'fastq'), (f'{B}/Quality/illumina_faked.fastq', 'fastq-illumina'), (f'{B}/Quality/solexa_faked.fastq', 'fastq-solexa'),
               (f'{B}/Quality/sanger_faked.fastq', 'fastq'), (f'{B}/Quality/tricky.fastq', 'fastq'), (f'{B}/Quality/zero_length.fastq', 'fastq')]:
    if not os.path.exists(p): continue
    try:
        recs = list(SeqIO.parse(p, fmt))
    except Exception as e:
        print('skip', p, e); continue
    q = 'solexa_quality' if fmt == 'fastq-solexa' else 'phred_quality'
    out['fastq'][os.path.relpath(p, B)] = {'format': fmt, 'records': [{'id': r.id, 'seq': str(r.seq), 'qual': r.letter_annotations[q]} for r in recs]}

# BAM files decoded by samtools (first 11 SAM columns; tags are not imported)
samtools = shutil.which('samtools')
if samtools and os.path.exists(f'{T}/sim/phix.sam') and not os.path.exists(f'{T}/sim/phix.bam'):
    subprocess.run([samtools, 'view', '-b', '-o', f'{T}/sim/phix.bam', f'{T}/sim/phix.sam'], check=True)
for p in sorted(glob.glob(f'{B}/SamBam/*.bam')) + sorted(glob.glob(f'{T}/sim/*.bam')):
    if not samtools: break
    view = subprocess.run([samtools, 'view', p], capture_output=True, text=True, check=True).stdout
    sq = subprocess.run([samtools, 'view', '-H', p], capture_output=True, text=True, check=True).stdout
    out['bam'][os.path.relpath(p, T)] = {'refs': [l.split('\t')[1][3:] for l in sq.splitlines() if l.startswith('@SQ')],
                                         'records': ['\t'.join(l.split('\t')[:11]) for l in view.splitlines()]}

json.dump(out, open(f'{T}/reference/formats_bp.json', 'w'))
print({k: len(v) for k, v in out.items()})
