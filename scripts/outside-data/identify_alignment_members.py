"""Identify every member of the sample alignments by an exact match to a public NCBI record
(US-01M6TGKH), and record the result.

A member is identified when its ungapped sequence equals an NCBI record, or a region of one, at
100% identity over the member's full length. Each member goes through these steps in order, and
the first that finds an exact match identifies it; every match is confirmed on the record efetch
returns:

1. A member that names its accession: efetch that record and compare.
2. A member whose set has a CANDIDATE_QUERY: an E-utilities esearch for its organism's records of
   that gene, then efetch every candidate (and every earlier version of a RefSeq candidate) and
   compare. The query names the gene and organism the member describes, so this is the efetch
   check of the records the member names, not a similarity search. A protein member not found so
   is looked up in UniParc by the MD5 of its sequence, and the RefSeq and INSDC protein records
   UniParc lists for it are efetched and compared.
3. Every other member: NCBI BLAST through the public URL API (blastn megablast on core_nt, blastp
   on nr), keeping only hits at 100% identity over the member's full length with no gap, then the
   earlier versions of each RefSeq hit (BLAST searches only current versions), then the records
   CANDIDATES names.
4. A member with no exact match is replaced when REPLACEMENTS names the record it is to become,
   and dropped otherwise. A set left with fewer than two members is dropped, and so is the
   fictitious-character set, unsearched.

Among several exact matches the citation is the whole record over a region, then a RefSeq record of
one organism, then an INSDC record, then a RefSeq WP_ record, then a UniProtKB or PDB chain record,
then the shorter record, then the lower accession. The results are recorded in RESULTS below.
src/__tests__/sampleAlignmentProvenance.test.ts checks the library against RESULTS, and every
citation against the records scripts/outside-data/fetch.sh downloads; the test never runs BLAST.

The members are read from the data file as it stood before this unit (SOURCE_REV), since the
dropped members are no longer in the current file.

Usage: python3 scripts/outside-data/identify_alignment_members.py [search|report]
  search  run the steps above, resumably: the cache (by default
          /private/tmp/mbc-identify-alignment-members, or $IDENTIFY_CACHE) holds every reply and
          every BLAST RID, so a re-run picks up where the last stopped. While a BLAST search is
          still running it says so and exits with status 3; run it again later.
  report  print RESULTS

NCBI's usage guidelines are kept: one BLAST request every 10 seconds, several queries to one
request, each RID polled no more than once a minute, and E-utilities at most three requests a
second. Only the standard library and curl are used.
"""
import hashlib, json, os, re, subprocess, sys, time, urllib.parse

SOURCE_REV = '21d5ce5'
DATA_FILE = 'crates/molbiocraft-cloning/src/sample_alignments_data.rs'
CACHE = os.environ.get('IDENTIFY_CACHE', '/private/tmp/mbc-identify-alignment-members')
EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils'
BLAST = 'https://blast.ncbi.nlm.nih.gov/Blast.cgi'
# The sets the sample library shipped, by the function that builds their members. The assembly
# reads (coi_assembly) are not alignment members; US-01M6TDSV replaces them by simulation.
SETS = {
    'coxii_cds': 'doc-aln-coxii-cds', 'hiv_env': 'doc-aln-hiv-env', 'ig_variable': 'doc-aln-ig-variable',
    'lysr_family': 'doc-aln-lysr-family', 'pairwise_protein': 'doc-aln-pairwise-protein',
    'people': 'doc-aln-people', 'three_kingdoms': 'doc-aln-three-kingdoms',
    'transcript_variants': 'doc-aln-transcript-variants',
}
PROTEIN_SETS = {'lysr_family', 'pairwise_protein', 'three_kingdoms'}
# The fictitious-character set is dropped whole, unsearched: its members describe themselves as
# made up (D0065).
FICTITIOUS = {'people'}
PLACEHOLDER = re.compile(r'^(3K|COX2|PWPROT|TXVAR|PEOPLE)_\d+$')
# Step 2: per set, the esearch queries for a member's records, ORG standing for its organism.
CANDIDATE_QUERIES = {
    'coxii_cds': [
        '(mitochondrion[Title] AND "complete genome"[Title] AND refseq[filter]) AND "ORG"[Organism]',
        '(COX2[Gene] OR COII[Gene] OR CO2[Gene] OR COX2[Title] OR COII[Title] OR CO2[Title] OR '
        '"cytochrome oxidase subunit II"[Title] OR "cytochrome c oxidase subunit II"[Title] OR '
        '"cytochrome c oxidase II"[Title] OR (mitochondrion[Title] AND "complete genome"[Title])) AND "ORG"[Organism]',
    ],
    'three_kingdoms': [
        '("alanine--tRNA ligase"[Title] OR "alanyl-tRNA synthetase"[Title] OR alaS[Gene] OR AARS[Gene] '
        'OR AARS1[Gene]) AND "ORG"[Organism]',
    ],
    'pairwise_protein': [
        '(papain[Title] OR actinidin[Title] OR "cysteine protease"[Title] OR "cysteine proteinase"[Title]) '
        'AND "ORG"[Organism]',
    ],
}
# The organism a member gives as a common name, as NCBI's taxonomy names it. Whale and Seal name no
# species, so the query searches the RefSeq mitochondrial genomes of the order or family.
ORGANISMS = {'Human': 'Homo sapiens', 'Chicken': 'Gallus gallus', 'Cow': 'Bos taurus', 'Mouse': 'Mus musculus',
             'Rat': 'Rattus norvegicus', 'Whale': 'Cetacea', 'Seal': 'Phocidae'}
# Members whose organism names no taxon to search; BLAST identifies them (step 3).
NO_CANDIDATE_QUERY = {'Frog', 'Loach', 'Carp'}


def members(rev=SOURCE_REV):
    src = subprocess.run(['git', 'show', f'{rev}:{DATA_FILE}'], check=True, capture_output=True, text=True).stdout
    out = {}
    for m in re.finditer(r'fn (\w+)_members\(\) -> Vec<AlignmentMemberSequence> \{(.*?)\n\}\n', src, re.S):
        if m.group(1) not in SETS:
            continue
        rows = []
        for blk in re.split(r'\n        AlignmentMemberSequence \{', m.group(2))[1:]:
            field = lambda k: (re.search(rf'\n            {k}: (?:Some\()?"((?:[^"\\]|\\.)*)"', blk) or [None, None])[1]
            notes = re.findall(r'notes: Some\("([\d,]+) -> ([\d,]+)"\)', blk)
            seq = field('sequence').replace('-', '').upper()
            rows.append({'id': field('id'), 'name': field('name'), 'accession': field('accession'),
                         'organism': field('organism'),
                         'seq': seq if m.group(1) in PROTEIN_SETS else seq.replace('U', 'T'),
                         'region': [int(a.replace(',', '')) for a in notes[0]] if notes else None})
        out[m.group(1)] = rows
    missing = set(SETS) - set(out)
    if missing:
        sys.exit(f'{DATA_FILE}@{rev}: no members found for {sorted(missing)}')
    return out


ABSENT = 'ABSENT\n'


def curl(url, data=None, attempts=4, absent_ok=False):
    """GET (or POST form data), retrying a transient failure; an empty reply is a failure. With
    absent_ok, an HTTP 400 (E-utilities' answer for an accession.version that does not exist)
    returns ABSENT, so a missing record is told apart from a failed request."""
    code = ''
    for i in range(attempts):
        cmd = ['curl', '-sS', '-L', '--max-time', '300', '-w', '\n%{http_code}', url]
        if data is not None:
            cmd[1:1] = ['--data-binary', '@-']
        r = subprocess.run(cmd, input=data, capture_output=True, text=True)
        body, _, code = r.stdout.rpartition('\n')
        if r.returncode == 0 and code == '200' and body.strip():
            return body
        if r.returncode == 0 and code == '400' and absent_ok:
            return ABSENT
        time.sleep(10 * (i + 1))
    sys.exit(f'curl failed {attempts} times: {url} (HTTP {code or "-"}; {r.stderr.strip() or "empty reply"})')


def cached(key, make):
    path = os.path.join(CACHE, key)
    if os.path.exists(path) and os.path.getsize(path) > 0:
        with open(path) as f:
            return f.read()
    text = make()
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path + '.part', 'w') as f:
        f.write(text)
    os.replace(path + '.part', path)
    return text


def accession_of(fasta_id):
    """NCBI's accession.version for a FASTA id: pdb|1BP4|A is 1BP4_A, sp|P00784.1|NAME is P00784.1."""
    parts = fasta_id.split('|')
    if parts[0] == 'pdb' and len(parts) >= 3:
        return f'{parts[1]}_{parts[2]}'
    if parts[0] in ('sp', 'tr') and len(parts) >= 2:
        return parts[1]
    return fasta_id


def parse_fasta(text):
    """{accession.version: sequence}. UniProtKB entries NCBI Protein mirrors (sp|, tr|) are left
    out: a member cites the NCBI record, not a copy of another database's."""
    recs, head = {}, None
    for line in text.splitlines():
        if line.startswith('>'):
            fid = line[1:].split()[0]
            head = None if fid.startswith(('sp|', 'tr|')) else accession_of(fid)
            if head:
                recs[head] = []
        elif head:
            recs[head].append(line.strip())
    return {h: ''.join(v).upper() for h, v in recs.items()}


def efetch(db, ids):
    """The FASTA records of `ids` (accession, accession.version or GI), keyed by accession.version."""
    key = f'efetch/{db}/' + hashlib.sha1(','.join(ids).encode()).hexdigest()
    def make():
        time.sleep(0.4)
        return curl(f'{EUTILS}/efetch.fcgi?db={db}&id={",".join(ids)}&rettype=fasta&retmode=text', absent_ok=True)
    text = cached(key, make)
    return {} if text == ABSENT else parse_fasta(text)


def esearch(db, term):
    key = f'esearch/{db}/' + hashlib.sha1(term.encode()).hexdigest()
    def make():
        time.sleep(0.4)
        return curl(f'{EUTILS}/esearch.fcgi?db={db}&retmode=json&retmax=1000&term=' + urllib.parse.quote(term))
    return json.loads(cached(key, make))['esearchresult']['idlist']


def revcomp(s):
    return s[::-1].translate(str.maketrans('ACGTRYKMBVDHN', 'TGCAYRMKVBHDN'))


def locate(seq, record, protein):
    """(start, end, strand) of every exact occurrence of seq in record, 1-based and inclusive."""
    hits = []
    for strand, s in ((1, seq),) if protein else ((1, seq), (-1, revcomp(seq))):
        i = record.find(s)
        while i >= 0:
            hits.append((i + 1, i + len(s), strand))
            i = record.find(s, i + 1)
    return hits


def citation(acc_ver, rec_len, hit):
    start, end, strand = hit
    if start == 1 and end == rec_len and strand == 1:
        return {'record': acc_ver}
    return {'record': acc_ver, 'start': start, 'end': end, 'strand': strand}


def rank(acc_ver, rec_len, seq_len):
    """Sort key among exact matches: whole record; then a RefSeq record of one organism, an INSDC
    record, a RefSeq WP_ record (one protein shared by many genomes, so not of the member's own
    organism), then a UniProtKB or PDB chain record; then the shorter record; then the lower
    accession."""
    if re.match(r'^WP_', acc_ver):
        kind = 2
    elif re.match(r'^[A-Z]{2}_', acc_ver):
        kind = 0
    elif re.match(r'^([A-Z]\d{5}|[A-Z]{2}\d{6}|[A-Z]{3}\d{5,7})\.\d+$', acc_ver):
        kind = 1
    else:
        kind = 3
    return (rec_len != seq_len, kind, rec_len, acc_ver)


def best_exact(r, records, protein):
    """The best citation for member r among {accession.version: sequence}, or None."""
    found = []
    for acc_ver, rec in records.items():
        for hit in locate(r['seq'], rec, protein):
            found.append((rank(acc_ver, len(rec), len(r['seq'])), citation(acc_ver, len(rec), hit)))
    return min(found, key=lambda f: f[0])[1] if found else None


def earlier_versions(accessions):
    """Every earlier version of each RefSeq accession.version. BLAST and esearch see only the
    current version of a record, so a member taken from an earlier one matches none of them."""
    out = []
    for acc in sorted(set(accessions)):
        m = re.match(r'^([A-Z]{2}_\d+)\.(\d+)$', acc)
        if m:
            out += [f'{m.group(1)}.{i}' for i in range(1, int(m.group(2)))]
    return out


def fetch_all(db, ids):
    recs = {}
    for i in range(0, len(ids), 200):
        recs.update(efetch(db, ids[i:i + 200]))
    return recs


def by_named_accession(fn, r):
    """Step 1."""
    if not r['accession'] or PLACEHOLDER.match(r['accession']):
        return None
    recs = efetch('protein' if fn in PROTEIN_SETS else 'nuccore', [r['accession']])
    recs = {a: s for a, s in recs.items() if a.startswith(r['accession'] + '.')}
    if r['region'] and len(recs) == 1:
        (acc_ver, rec), = recs.items()
        a, b = sorted(r['region'])
        hits = [h for h in locate(r['seq'], rec, fn in PROTEIN_SETS) if (h[0], h[1]) == (a, b)]
        if hits:
            return citation(acc_ver, len(rec), hits[0])
    return best_exact(r, recs, fn in PROTEIN_SETS)


def by_candidate_query(fn, r):
    """Step 2."""
    if fn not in CANDIDATE_QUERIES or r['organism'] in NO_CANDIDATE_QUERY:
        return None
    db = 'protein' if fn in PROTEIN_SETS else 'nuccore'
    org = ORGANISMS.get(r['organism'], r['organism'])
    for query in CANDIDATE_QUERIES[fn]:
        recs = fetch_all(db, esearch(db, query.replace('ORG', org)))
        got = best_exact(r, recs, fn in PROTEIN_SETS)
        if not got:
            got = best_exact(r, fetch_all(db, earlier_versions(recs)), fn in PROTEIN_SETS)
        if got:
            return got
    return None


def by_uniparc(fn, r):
    """Step 2, for a protein: UniParc (www.uniprot.org/uniparc) holds each distinct protein
    sequence once, keyed by its MD5, with the RefSeq and INSDC (EMBL) protein records that carry
    it. Look the member up by the MD5 of its sequence, then efetch each NCBI record listed and
    compare. The lookup is exact by construction: only an identical sequence has that key."""
    if fn not in PROTEIN_SETS:
        return None
    md5 = hashlib.md5(r['seq'].encode()).hexdigest().upper()
    tsv = cached(f'uniparc/{md5}', lambda: curl(f'https://rest.uniprot.org/uniparc/search?query=checksum:{md5}&fields=upi,length&format=tsv'))
    upis = [line.split('\t')[0] for line in tsv.splitlines()[1:] if line.strip()]
    ids = []
    for upi in upis:
        xrefs = json.loads(cached(f'uniparc/{upi}.json', lambda: curl(f'https://rest.uniprot.org/uniparc/{upi}/databases?format=json&size=500')))
        ids += [f"{x['id']}.{x['version']}" for x in xrefs.get('results', [])
                if x.get('database') in ('RefSeq', 'EMBL', 'EMBL_CON') and x.get('version')]
    return best_exact(r, fetch_all('protein', sorted(set(ids))), True) if ids else None


class Pending(Exception):
    pass


def blast(fn, rows):
    """Step 3's search: one BLAST request for these members (cached by their ids), its hits per member."""
    if not rows:
        return {}
    program, database = ('blastp', 'nr') if fn in PROTEIN_SETS else ('blastn', 'core_nt')
    key = f'blast/{fn}-' + hashlib.sha1(','.join(r['id'] for r in rows).encode()).hexdigest()[:12]
    def put():
        fasta = ''.join(f">{r['id']}\n{r['seq']}\n" for r in rows)
        params = {'CMD': 'Put', 'PROGRAM': program, 'DATABASE': database, 'QUERY': fasta,
                  'HITLIST_SIZE': '50', 'EXPECT': '1e-10', 'FORMAT_TYPE': 'XML'}
        if program == 'blastn':
            params['MEGABLAST'] = 'on'
        time.sleep(10)
        reply = curl(BLAST, data=urllib.parse.urlencode(params))
        rid = re.search(r'RID = (\S+)', reply)
        if not rid:
            sys.exit(f'BLAST Put returned no RID:\n{reply[:2000]}')
        return rid.group(1)
    rid = cached(key + '.rid', put).strip()
    def get():
        status = curl(f'{BLAST}?CMD=Get&FORMAT_OBJECT=SearchInfo&RID={rid}')
        state = (re.search(r'Status=(\w+)', status) or [None, 'NONE'])[1]
        if state == 'WAITING':
            raise Pending(f'{key}: RID {rid} still running')
        if state != 'READY':
            sys.exit(f'{key}: BLAST RID {rid} is {state}; delete {key}.rid from the cache to search again')
        if 'ThereAreHits=no' in status:
            return '<empty/>'
        time.sleep(10)
        return curl(f'{BLAST}?CMD=Get&FORMAT_TYPE=XML&RID={rid}')
    last = os.path.join(CACHE, key + '.polled')
    if not os.path.exists(os.path.join(CACHE, key + '.xml')) and os.path.exists(last) and time.time() - os.path.getmtime(last) < 60:
        raise Pending(f'{key}: RID {rid} polled under a minute ago')
    try:
        xml = cached(key + '.xml', get)
    finally:
        open(last, 'w').close()
    return blast_hits(xml)


def blast_hits(xml):
    """Per query id: every HSP, with the subject's accession.version and length."""
    out = {}
    for it in re.findall(r'<Iteration>(.*?)</Iteration>', xml, re.S):
        q = re.search(r'<Iteration_query-def>([^<\s]+)', it).group(1)
        qlen = int(re.search(r'<Iteration_query-len>(\d+)', it).group(1))
        hsps = out.setdefault(q, [])
        for hit in re.findall(r'<Hit>(.*?)</Hit>', it, re.S):
            hid = re.search(r'<Hit_id>([^<]+)', hit).group(1)
            ver = re.search(r'\|([A-Z0-9_]+\.\d+)\|', '|' + hid + '|')
            acc = ver.group(1) if ver else re.search(r'<Hit_accession>([^<]+)', hit).group(1)
            slen = int(re.search(r'<Hit_len>(\d+)', hit).group(1))
            for h in re.findall(r'<Hsp>(.*?)</Hsp>', hit, re.S):
                g = lambda k: int((re.search(rf'<Hsp_{k}>(-?\d+)', h) or [0, 0])[1])
                hsps.append({'acc': acc, 'qlen': qlen, 'ident': g('identity'), 'alen': g('align-len'),
                             'gaps': g('gaps'), 'slen': slen})
    return out


def by_blast(fn, r, hsps):
    """Step 3's check: the exact hits together with the earlier versions of the RefSeq hits (so an
    earlier version that is the whole member wins over a region of the current one), then
    CANDIDATES."""
    db = 'protein' if fn in PROTEIN_SETS else 'nuccore'
    exact = [h['acc'] for h in hsps if h['ident'] == h['qlen'] == h['alen'] == len(r['seq']) and h['gaps'] == 0]
    for ids in (sorted(set(exact)) + earlier_versions(h['acc'] for h in hsps), CANDIDATES.get(r['id'], [])):
        got = best_exact(r, fetch_all(db, ids), fn in PROTEIN_SETS) if ids else None
        if got:
            return got
    return None


def best_inexact(hsps):
    if not hsps:
        return 'no BLAST hit'
    h = max(hsps, key=lambda h: (h['ident'], -h['gaps']))
    return f"closest BLAST hit {h['acc']}: {h['ident']} of {h['qlen']} identical over {h['alen']} columns, {h['gaps']} gaps"


def replace(fn, r):
    """Step 4: the record REPLACEMENTS names, which must differ from the member by substitutions only."""
    if r['id'] not in REPLACEMENTS:
        return None
    acc, why = REPLACEMENTS[r['id']]
    recs = efetch('protein' if fn in PROTEIN_SETS else 'nuccore', [acc])
    if acc not in recs or len(recs[acc]) != len(r['seq']):
        sys.exit(f"{r['id']}: replacement {acc} is not a substitution-only match")
    diffs = [f'{a}{i + 1}{b}' for i, (a, b) in enumerate(zip(r['seq'], recs[acc])) if a != b]
    return {'record': acc, 'replaces': f"{r['name']}: {why}; differs at {', '.join(diffs)}"}


def main():
    mode = sys.argv[1] if len(sys.argv) > 1 else 'report'
    if mode == 'report':
        print(json.dumps(RESULTS, indent=1))
        return
    if mode != 'search':
        sys.exit(__doc__)
    sets = members()
    out, pending = {}, []
    for fn, rows in sets.items():
        doc = SETS[fn]
        if fn in FICTITIOUS:
            out[doc] = {r['id']: 'dropped: fictitious-character set' for r in rows}
            continue
        got = {r['id']: by_named_accession(fn, r) or by_candidate_query(fn, r) or by_uniparc(fn, r) for r in rows}
        rest = [r for r in rows if not got[r['id']]]
        try:
            hits = blast(fn, rest)
        except Pending as e:
            pending.append(str(e))
            continue
        res = {}
        for r in rows:
            c = got[r['id']] or by_blast(fn, r, hits.get(r['id'], [])) or replace(fn, r)
            res[r['id']] = c or f"dropped: no exact match ({best_inexact(hits.get(r['id'], []))})"
        if sum(1 for c in res.values() if isinstance(c, dict)) < 2:
            res = {k: (v if isinstance(v, str) else 'dropped: the set keeps fewer than two members') for k, v in res.items()}
        out[doc] = res
    if pending:
        print('\n'.join(pending), file=sys.stderr)
        sys.exit(3)
    print(json.dumps(out, indent=1))


# Records BLAST cannot find, named for the members that name them: MAPK10 transcript variant 4's
# RefSeq record, NM_138981.1, is no longer current (its later versions are withdrawn), so BLAST,
# which searches current records only, does not hold it.
CANDIDATES = {
    'txvar-seq-4': ['NM_138981.1'],
}
# Members with no exact match that become the record they name.
REPLACEMENTS = {
    'pwprot-seq-1': ('2ACT_A', 'replaced by chain A of PDB 2ACT, the entry it names, which records '
                     'residue 25 (Cys25, the active-site cysteine) as unknown'),
}

# The recorded result of `search` (run 2026-11-08). A citation is the record, plus start, end and
# strand when the member is a region of it; `replaces` says what a replacement replaced. Steps 1
# and 2 identified 115 members; BLAST identified coxii-seq-44, -49 and -50, and with the earlier
# RefSeq versions and CANDIDATES all four transcript variants. pwprot-seq-1's own BLAST search
# (blastp on nr, RID EZURMS2M014) was still queued at NCBI when this was recorded, after neither
# its esearch candidates nor UniParc held its sequence, so its replacement stands on those two
# checks until that search returns.
RESULTS = {
 "doc-aln-coxii-cds": {
  "coxii-seq-1": {
   "record": "NC_002083.1",
   "start": 7023,
   "end": 7706,
   "strand": 1
  },
  "coxii-seq-2": {
   "record": "NC_001645.1",
   "start": 7007,
   "end": 7690,
   "strand": 1
  },
  "coxii-seq-3": {
   "record": "NC_001643.1",
   "start": 7003,
   "end": 7686,
   "strand": 1
  },
  "coxii-seq-4": {
   "record": "NC_012920.1",
   "start": 7586,
   "end": 8269,
   "strand": 1
  },
  "coxii-seq-5": {
   "record": "EF597500.1",
   "start": 7006,
   "end": 7689,
   "strand": 1
  },
  "coxii-seq-6": {
   "record": "Y18001.1",
   "start": 7018,
   "end": 7701,
   "strand": 1
  },
  "coxii-seq-7": {
   "record": "M74004.1"
  },
  "coxii-seq-8": {
   "record": "EF484241.1"
  },
  "coxii-seq-9": {
   "record": "EF484317.1"
  },
  "coxii-seq-10": {
   "record": "AY489465.1"
  },
  "coxii-seq-11": {
   "record": "AY650206.1",
   "start": 3094,
   "end": 3777,
   "strand": 1
  },
  "coxii-seq-12": {
   "record": "AY489507.1"
  },
  "coxii-seq-13": {
   "record": "AF338715.1",
   "start": 7048,
   "end": 7735,
   "strand": 1
  },
  "coxii-seq-14": {
   "record": "AY016013.1",
   "start": 8585,
   "end": 9269,
   "strand": 1
  },
  "coxii-seq-15": {
   "record": "NC_040902.1",
   "start": 8339,
   "end": 9022,
   "strand": 1
  },
  "coxii-seq-16": {
   "record": "EF455490.1",
   "start": 8434,
   "end": 9117,
   "strand": 1
  },
  "coxii-seq-17": {
   "record": "AB104902.1",
   "start": 8251,
   "end": 8934,
   "strand": 1
  },
  "coxii-seq-18": {
   "record": "AJ421451.1",
   "start": 7028,
   "end": 7711,
   "strand": 1
  },
  "coxii-seq-19": {
   "record": "AM711896.1",
   "start": 7038,
   "end": 7721,
   "strand": 1
  },
  "coxii-seq-20": {
   "record": "M80903.1"
  },
  "coxii-seq-21": {
   "record": "AJ428577.1",
   "start": 7027,
   "end": 7710,
   "strand": 1
  },
  "coxii-seq-22": {
   "record": "AF490528.1",
   "start": 4699,
   "end": 5382,
   "strand": 1
  },
  "coxii-seq-23": {
   "record": "NC_020709.1",
   "start": 7014,
   "end": 7697,
   "strand": 1
  },
  "coxii-seq-24": {
   "record": "NC_001321.1",
   "start": 7472,
   "end": 8155,
   "strand": 1
  },
  "coxii-seq-25": {
   "record": "AJ554061.1",
   "start": 7056,
   "end": 7739,
   "strand": 1
  },
  "coxii-seq-26": {
   "record": "NC_001325.1",
   "start": 7959,
   "end": 8642,
   "strand": 1
  },
  "coxii-seq-27": {
   "record": "AH014071.2",
   "start": 2731,
   "end": 3414,
   "strand": 1
  },
  "coxii-seq-28": {
   "record": "EF551003.1",
   "start": 7966,
   "end": 8649,
   "strand": 1
  },
  "coxii-seq-29": {
   "record": "AY574047.1",
   "start": 8243,
   "end": 8930,
   "strand": 1
  },
  "coxii-seq-30": {
   "record": "DQ409327.1",
   "start": 8310,
   "end": 8997,
   "strand": 1
  },
  "coxii-seq-31": {
   "record": "X97336.1",
   "start": 7040,
   "end": 7723,
   "strand": 1
  },
  "coxii-seq-32": {
   "record": "EF597513.1",
   "start": 7045,
   "end": 7728,
   "strand": 1
  },
  "coxii-seq-33": {
   "record": "DQ093080.1"
  },
  "coxii-seq-34": {
   "record": "AM711901.1",
   "start": 7022,
   "end": 7705,
   "strand": 1
  },
  "coxii-seq-35": {
   "record": "LT559488.1"
  },
  "coxii-seq-36": {
   "record": "AY609141.1"
  },
  "coxii-seq-37": {
   "record": "AF028209.1"
  },
  "coxii-seq-38": {
   "record": "NC_005089.1",
   "start": 7013,
   "end": 7696,
   "strand": 1
  },
  "coxii-seq-39": {
   "record": "NC_001665.1",
   "start": 6991,
   "end": 7674,
   "strand": 1
  },
  "coxii-seq-40": {
   "record": "AM904729.1",
   "start": 6999,
   "end": 7682,
   "strand": 1
  },
  "coxii-seq-41": {
   "record": "AF147616.1"
  },
  "coxii-seq-42": {
   "record": "AB012104.1",
   "start": 7083,
   "end": 7769,
   "strand": 1
  },
  "coxii-seq-43": {
   "record": "AY659992.1",
   "start": 7003,
   "end": 7688,
   "strand": 1
  },
  "coxii-seq-44": {
   "record": "NC_001573.1",
   "start": 9109,
   "end": 9804,
   "strand": 1
  },
  "coxii-seq-45": {
   "record": "AF154850.1",
   "start": 8150,
   "end": 8840,
   "strand": 1
  },
  "coxii-seq-46": {
   "record": "AB185022.1",
   "start": 7182,
   "end": 7872,
   "strand": 1
  },
  "coxii-seq-47": {
   "record": "AP005985.1",
   "start": 7177,
   "end": 7867,
   "strand": 1
  },
  "coxii-seq-48": {
   "record": "AP007244.1",
   "start": 7234,
   "end": 7924,
   "strand": 1
  },
  "coxii-seq-49": {
   "record": "NC_001727.1",
   "start": 8078,
   "end": 8782,
   "strand": 1
  },
  "coxii-seq-50": {
   "record": "NC_001606.1",
   "start": 8109,
   "end": 8813,
   "strand": 1
  }
 },
 "doc-aln-hiv-env": {
  "hiv-seq-1": {
   "record": "HQ625578.1"
  },
  "hiv-seq-2": {
   "record": "HQ625579.1"
  },
  "hiv-seq-3": {
   "record": "HQ625580.1"
  },
  "hiv-seq-4": {
   "record": "HQ625581.1"
  },
  "hiv-seq-5": {
   "record": "HQ625582.1"
  },
  "hiv-seq-6": {
   "record": "HQ625583.1"
  },
  "hiv-seq-7": {
   "record": "HQ625584.1"
  },
  "hiv-seq-8": {
   "record": "HQ625585.1"
  },
  "hiv-seq-9": {
   "record": "HQ625586.1"
  },
  "hiv-seq-10": {
   "record": "HQ625587.1"
  },
  "hiv-seq-11": {
   "record": "HQ625588.1"
  },
  "hiv-seq-12": {
   "record": "HQ625589.1"
  },
  "hiv-seq-13": {
   "record": "HQ625576.1"
  },
  "hiv-seq-14": {
   "record": "HQ625575.1"
  },
  "hiv-seq-15": {
   "record": "HQ625573.1"
  },
  "hiv-seq-16": {
   "record": "HQ625572.1"
  },
  "hiv-seq-17": {
   "record": "HQ625571.1"
  },
  "hiv-seq-18": {
   "record": "HQ625570.1"
  },
  "hiv-seq-19": {
   "record": "HQ625568.1"
  },
  "hiv-seq-20": {
   "record": "HQ625567.1"
  }
 },
 "doc-aln-ig-variable": {
  "igvar-seq-1": {
   "record": "JX560779.1"
  },
  "igvar-seq-2": {
   "record": "JX560780.1"
  },
  "igvar-seq-3": {
   "record": "JX560781.1"
  },
  "igvar-seq-4": {
   "record": "JX560782.1"
  },
  "igvar-seq-5": {
   "record": "JX560783.1"
  }
 },
 "doc-aln-lysr-family": {
  "lysr-seq-1": {
   "record": "EJG11255.1"
  },
  "lysr-seq-2": {
   "record": "ZP_07993777.1"
  },
  "lysr-seq-3": {
   "record": "ZP_03841354.1"
  },
  "lysr-seq-4": {
   "record": "YP_003466443.1"
  },
  "lysr-seq-5": {
   "record": "ZP_08214735.1"
  },
  "lysr-seq-6": {
   "record": "ZP_07953273.1"
  },
  "lysr-seq-7": {
   "record": "ZP_08308204.1"
  }
 },
 "doc-aln-pairwise-protein": {
  "pwprot-seq-1": {
   "record": "2ACT_A",
   "replaces": "Kiwifruit (2ACT): replaced by chain A of PDB 2ACT, the entry it names, which records residue 25 (Cys25, the active-site cysteine) as unknown; differs at C25X"
  },
  "pwprot-seq-2": {
   "record": "1BP4_A"
  }
 },
 "doc-aln-people": {
  "people-seq-1": "dropped: fictitious-character set",
  "people-seq-2": "dropped: fictitious-character set",
  "people-seq-3": "dropped: fictitious-character set",
  "people-seq-4": "dropped: fictitious-character set",
  "people-seq-5": "dropped: fictitious-character set"
 },
 "doc-aln-three-kingdoms": {
  "3k-seq-1": {
   "record": "WP_012067924.1"
  },
  "3k-seq-2": {
   "record": "YP_002995212.1"
  },
  "3k-seq-3": {
   "record": "WP_010884393.1"
  },
  "3k-seq-4": {
   "record": "WP_010479887.1"
  },
  "3k-seq-5": {
   "record": "WP_011011385.1"
  },
  "3k-seq-6": {
   "record": "ADE04452.1"
  },
  "3k-seq-7": {
   "record": "ELZ06622.1"
  },
  "3k-seq-8": {
   "record": "ELY50302.1"
  },
  "3k-seq-9": {
   "record": "KUJ93261.1"
  },
  "3k-seq-10": {
   "record": "WIM44693.1"
  },
  "3k-seq-11": {
   "record": "NP_001121342.1"
  },
  "3k-seq-12": {
   "record": "NP_001005836.1"
  },
  "3k-seq-13": {
   "record": "AAP57355.1"
  },
  "3k-seq-14": {
   "record": "NP_001094545.1"
  },
  "3k-seq-15": {
   "record": "EPQ05513.1"
  },
  "3k-seq-16": {
   "record": "EPY90010.1"
  },
  "3k-seq-17": {
   "record": "EFN86804.1"
  },
  "3k-seq-18": {
   "record": "AAF05593.1"
  },
  "3k-seq-19": {
   "record": "XP_001658296.1"
  },
  "3k-seq-20": {
   "record": "XP_001847766.1"
  },
  "3k-seq-21": {
   "record": "YP_004112020.1"
  },
  "3k-seq-22": {
   "record": "AAR33483.1"
  },
  "3k-seq-23": {
   "record": "WP_004622793.1"
  },
  "3k-seq-24": {
   "record": "ZP_08630593.1"
  },
  "3k-seq-25": {
   "record": "YP_780527.1"
  },
  "3k-seq-26": {
   "record": "YP_005824151.1"
  },
  "3k-seq-27": {
   "record": "AOW51678.1"
  },
  "3k-seq-28": {
   "record": "EGC57364.1"
  },
  "3k-seq-29": {
   "record": "WP_143715051.1",
   "start": 3,
   "end": 877,
   "strand": 1
  },
  "3k-seq-30": {
   "record": "WP_006956591.1"
  },
  "3k-seq-31": {
   "record": "AFS36559.1"
  },
  "3k-seq-32": {
   "record": "GAC25539.1"
  },
  "3k-seq-33": {
   "record": "YP_007545091.1"
  },
  "3k-seq-34": {
   "record": "WP_017364566.1"
  },
  "3k-seq-35": {
   "record": "EEF81315.1"
  }
 },
 "doc-aln-transcript-variants": {
  "txvar-seq-1": {
   "record": "NM_138980.1"
  },
  "txvar-seq-2": {
   "record": "NM_002753.2"
  },
  "txvar-seq-3": {
   "record": "NM_138982.1"
  },
  "txvar-seq-4": {
   "record": "NM_138981.1"
  }
 }
}

if __name__ == '__main__':
    main()
