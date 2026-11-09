#!/bin/bash
# Downloads the public data sets used by the outside-data checks into test-data/ (git-ignored). With
# the committed test-data/reference/ and test-data/sim/ (PROVENANCE.md) they are all the reference
# check needs, apart from the private lab runs it names as local-only.
# Re-running skips files already present. Usage: scripts/outside-data/fetch.sh [test-data]
set -uo pipefail
T="${1:-test-data}"
get() { local url="$1" out="$T/$2"; mkdir -p "$(dirname "$out")"; [ -s "$out" ] && return 0; curl -sSfL --retry 3 --max-time 180 -o "$out" "$url" || { echo "FAIL $url"; rm -f "$out"; }; }
note() { mkdir -p "$T/$1"; printf '%s\nDownloaded: %s\n' "$2" "$(date -u +%F)" > "$T/$1/SOURCE.txt"; }

# UniProt proteins (FASTA + flat file); ExPASy ProtParam results are cached by ref_seqtools.py
for a in P68871 P69905 P02144 P68082 P00698 P61626 P01308 P04637 P0DTC2 P00533 P02769 P00760 P0A7Y4 P01009 P00720 P62593; do
  get "https://rest.uniprot.org/uniprotkb/$a.fasta" "uniprot/$a.fasta"; get "https://rest.uniprot.org/uniprotkb/$a.txt" "uniprot/$a.txt"; done
note uniprot "Source: UniProtKB REST (https://rest.uniprot.org), CC BY 4.0"
# NCBI nucleotide records (GenBank with parts, FASTA, GFF3)
for a in L09137 J02459 J01749 NC_001422 NC_045512 V01555 X02514 NC_001416 M77789; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=gbwithparts&retmode=text" "ncbi/$a.gb"
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=fasta&retmode=text" "ncbi/$a.fasta"; sleep 0.4; done
for a in NC_001422 NC_045512 NC_001416; do get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=gff3&retmode=text" "ncbi/$a.gff3"; sleep 0.4; done
note ncbi "Source: NCBI Nucleotide via E-utilities (public domain US government data)"
for a in L09137 J01749 J02459 V01555 X02514; do get "https://www.ebi.ac.uk/ena/browser/api/embl/$a?lineLimit=0" "ena/$a.embl"; done
note ena "Source: ENA browser API (https://www.ebi.ac.uk/ena), EMBL format"
# MrBayes example alignments. GPL-3.0, so never committed (D0016): the committed references keep only
# the SHA-256 of primates.nex and of its alignment, and the tests check this download against them.
# Fetched from a fixed commit, not a branch, so an upstream edit cannot change the input under the
# checksum: 77da419 (2020-07-03) is the last develop commit to touch any of the four files, and its
# primates.nex has the SHA-256 align.json and phylo_r.json record.
MRBAYES_COMMIT=77da419ecb2a335fb185a79c0d7d42d413562f19
for f in primates.nex hymfossil.nex cynmix.nex finch.nex; do get "https://raw.githubusercontent.com/NBISweden/MrBayes/$MRBAYES_COMMIT/examples/$f" "mrbayes/$f"; done
note mrbayes "Source: https://github.com/NBISweden/MrBayes/tree/$MRBAYES_COMMIT/examples (GPL-3.0), commit $MRBAYES_COMMIT
GPL-3.0 input: fetched, never committed (D0016). test-data/reference/phylo_r.json and align.json record its SHA-256."
# Pfam seed alignments (InterPro API)
for p in PF00042 PF00018 PF00595 PF00076 PF00046 PF00013 PF00072 PF00106 PF00004 PF00041 PF00047 PF00071 PF00089 PF00153 PF00226 PF00240 PF00271 PF00400 PF00512 PF00169 PF00168 PF00017 PF00025 PF00036 PF00079 PF00102; do
  get "https://www.ebi.ac.uk/interpro/wwwapi//entry/pfam/$p/?annotation=alignment:seed" "pfam/$p.seed.sto.gz"; done
note pfam "Source: Pfam seed alignments via the InterPro API (CC0)"
# pasilla RNA-seq counts (Bioconductor)
get https://raw.githubusercontent.com/bioc/pasilla/devel/inst/extdata/pasilla_gene_counts.tsv pasilla/pasilla_gene_counts.tsv
get https://raw.githubusercontent.com/bioc/pasilla/devel/inst/extdata/pasilla_sample_annotation.csv pasilla/pasilla_sample_annotation.csv
note pasilla "Source: Bioconductor pasilla (Brooks et al. 2011), LGPL"
# PAML example codon alignments. GPL-3.0, so never committed (D0016): phylo_tools.json keeps only the
# SHA-256 of HIVenvSweden.txt and lysozymeSmall.txt and of their alignments. Fetched, with the dat/
# matrices below, from a fixed commit: 5ac3120 (2018-05-15) is the last master commit to touch any
# of those files, and its two codon alignments have the SHA-256 phylo_tools.json records.
PAML_COMMIT=5ac3120e005e14dfc2b1886bf230fde85f995242
for f in lysozyme/lysozymeSmall.txt lysozyme/lysozymeSmall.trees HIVNSsites/HIVenvSweden.txt HIVNSsites/HIVenvSweden.trees; do get "https://raw.githubusercontent.com/abacus-gene/paml/$PAML_COMMIT/examples/$f" "paml/$(basename $f)"; done
note paml "Source: https://github.com/abacus-gene/paml/tree/$PAML_COMMIT/examples and dat/ (GPL-3.0), commit $PAML_COMMIT
GPL-3.0 inputs: fetched, never committed (D0016). test-data/reference/phylo_tools.json records the SHA-256 of the two codon alignments."
# RCSB structures
for p in 1CRN 4HHB 1UBQ 6VXX; do get "https://files.rcsb.org/download/$p.pdb" "rcsb/$p.pdb"; get "https://files.rcsb.org/download/$p.cif" "rcsb/$p.cif"; done
note rcsb "Source: RCSB PDB (https://www.rcsb.org), CC0"
# RCSB PDB tools fixtures: alignment pairs (globin fold: 1MBN myoglobin vs 4HHB; ubiquitin fold: 1UBQ vs
# 1A5R SUMO-1, NMR), an assembly, ligand files, and recorded Data / FASTA / Search API responses
for p in 1MBN 1A5R; do get "https://files.rcsb.org/download/$p.pdb" "rcsb/$p.pdb"; get "https://files.rcsb.org/download/$p.cif" "rcsb/$p.cif"; done
# The entries the sample library's C-alpha traces are taken from (1D66 GAL4-DNA, 1A4Y ribonuclease
# inhibitor-angiogenin): sample_structures.rs checks each trace against its entry's CA atoms
for p in 1D66 1A4Y; do get "https://files.rcsb.org/download/$p.pdb" "rcsb/$p.pdb"; done
get https://files.rcsb.org/download/4HHB-assembly1.cif rcsb/4HHB-assembly1.cif
get https://files.rcsb.org/ligands/download/HEM.cif rcsb/ligands/HEM.cif
get https://files.rcsb.org/ligands/download/HEM_ideal.sdf rcsb/ligands/HEM_ideal.sdf
get https://www.rcsb.org/fasta/entry/4HHB/download rcsb/fasta/4HHB.fasta
get https://www.rcsb.org/fasta/entity/4HHB_1/download rcsb/fasta/4HHB_1.fasta
get https://www.rcsb.org/fasta/chain/4HHB.A/download rcsb/fasta/4HHB.A.fasta
get https://data.rcsb.org/rest/v1/core/entry/4HHB rcsb/api/entry_4HHB.json
get https://data.rcsb.org/rest/v1/core/polymer_entity/4HHB/1 rcsb/api/polymer_entity_4HHB_1.json
get https://data.rcsb.org/rest/v1/core/polymer_entity_instance/4HHB/A rcsb/api/polymer_entity_instance_4HHB_A.json
get https://data.rcsb.org/rest/v1/core/assembly/4HHB/1 rcsb/api/assembly_4HHB_1.json
get https://data.rcsb.org/rest/v1/core/chemcomp/HEM rcsb/api/chemcomp_HEM.json
rcsb_search() { get "https://search.rcsb.org/rcsbsearch/v2/query?json=$(python3 -c 'import sys,urllib.parse;print(urllib.parse.quote(sys.argv[1]))' "$2")" "rcsb/api/search_$1.json"; }
rcsb_search full_text '{"query":{"type":"terminal","service":"full_text","parameters":{"value":"hemoglobin"}},"return_type":"entry","request_options":{"paginate":{"start":0,"rows":5}}}'
rcsb_search sequence '{"query":{"type":"terminal","service":"sequence","parameters":{"evalue_cutoff":0.1,"identity_cutoff":0.9,"sequence_type":"protein","value":"VLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR"}},"return_type":"polymer_entity","request_options":{"paginate":{"start":0,"rows":5},"scoring_strategy":"sequence"}}'
rcsb_search seqmotif '{"query":{"type":"terminal","service":"seqmotif","parameters":{"value":"C-x(2,4)-C-x(3)-[LIVMFYWC]-x(8)-H-x(3,5)-H","pattern_type":"prosite","sequence_type":"protein"}},"return_type":"polymer_entity","request_options":{"paginate":{"start":0,"rows":5}}}'
rcsb_search structure '{"query":{"type":"terminal","service":"structure","parameters":{"value":{"entry_id":"4HHB","assembly_id":"1"},"operator":"strict_shape_match"}},"return_type":"assembly","request_options":{"paginate":{"start":0,"rows":5}}}'
note rcsb "Source: RCSB PDB (https://www.rcsb.org): coordinates, ligands and FASTA from files.rcsb.org / www.rcsb.org,
API responses from data.rcsb.org (Data API REST v1) and search.rcsb.org (Search API v2, recorded responses), CC0.
Search API responses are point-in-time snapshots: hit lists change as the archive grows; tests must assert shape, not counts."
# The public records the sample library's primers, proteins, yadF clone and genome records are taken
# from (US-01M6TDFV). src/__tests__/sampleScientificAccuracy.test.ts checks each sample against them.
# iGEM Registry parts behind the BioBrick and M13 sequencing primers (CC BY 4.0, NOTICE section 6).
# The registry answers a quick burst with 429, so the parts are fetched a second apart.
for p in BBa_G00100 BBa_G00101 BBa_G00103 BBa_G00104 BBa_G00105 BBa_G00106 BBa_G00107; do
  get "https://api.registry.igem.org/v1/parts/slugs/$(printf '%s' "$p" | tr 'A-Z_' 'a-z-')" "igem/$p.json"; sleep 1; done
note igem "Source: iGEM Registry of Standard Biological Parts (https://api.registry.igem.org/v1/parts/slugs/<part>), CC BY 4.0"
# The T7, T3 and SP6 phage genomes behind the promoter primers, and J04639 (the Taq polA gene record)
for a in NC_001604 NC_003298 NC_004831 J04639; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=fasta&retmode=text" "ncbi/$a.fasta"; sleep 0.4; done
# The HCMV AD169 and WHV8 genomes and human GRCh38.p14 EEF1A1 locus behind the design primers (BG-01M6XWXX)
for a in X17403.1 J04514.1; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=fasta&retmode=text" "ncbi/$a.fasta"; sleep 0.4; done
get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=NC_000006.12&seq_start=73515750&seq_stop=73521211&rettype=fasta&retmode=text" "ncbi/NC_000006.12.fasta"; sleep 0.4
# NCBI record summaries (accession, length, topology, GI) of the 33 genome samples
for a in NC_000913 NC_002516.2 NC_012660.1 NC_000964.3 J04639.1 AC_000158.1 AC_000159.1 AC_000160.1 NC_001709.1 \
  NT_033779.5 NC_001133.9 NC_009144.3 NC_000001.11 NC_000002.12 NC_000003.12 NC_000004.12 NC_000023.11 NC_000024.10 \
  EU545435.1 NC_003070.9 NC_003071.7 NC_003074.8 NC_003075.7 NC_003076.8 NC_000932.1 NC_001284.2 NC_002549.1 NC_001802 \
  JX413110 NC_001416.1 NC_001604.1 NC_004718.3 NC_045512.2; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=nuccore&id=$a&retmode=json" "ncbi/esummary/nuccore/$a.json"; sleep 0.4; done
# The protein samples' NCBI records (summary and FASTA), and the coding sequence of the yadF protein
for a in 3C4W_B NP_417020.1 NP_415743.1; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=protein&id=$a&retmode=json" "ncbi/esummary/protein/$a.json"; sleep 0.4
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=$a&rettype=fasta&retmode=text" "ncbi/protein/$a.fasta"; sleep 0.4; done
get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=YP_004715652&rettype=fasta_cds_na&retmode=text" "ncbi/protein/YP_004715652.cds.fasta"
# The protein records the ExPASy and Biopython checks in crates/molbiocraft-protein/src/biophysics_3d.rs
# are run on (US-01M6TG7Q): the E. coli K-12 ferredoxin and NarH RefSeq records, and the Aequorea
# victoria GFP GenBank record AAA27721.1. The two RefSeq records are also fetched above, and get()
# skips a file already present, so this block stands on its own.
for a in NP_417020.1 NP_415743.1 AAA27721.1; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=$a&rettype=fasta&retmode=text" "ncbi/protein/$a.fasta"; sleep 0.4; done
# The records the genome, plasmid and yghJ CDS samples equal (US-01M6TGZ8; with NC_045512, NC_001416,
# NC_001604 and L09137 above): the HIV, Ebola, SARS, HPV, human and Drosophila mitochondrion genomes,
# and the coding sequences of the two yghJ proteins (E. coli K-12 MG1655 and IAI1)
for a in NC_001802.1 NC_002549.1 NC_004718.3 JX413110.1 EU545435.1 NC_001709.1; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=fasta&retmode=text" "ncbi/$a.fasta"; sleep 0.4; done
for p in YP_026189.1 YP_002388453.1; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=$p&rettype=fasta_cds_na&retmode=text" "ncbi/protein/$p.cds.fasta"; sleep 0.4; done
# The records the sample alignment members are (US-01M6TGKH): each member of sample_alignments_data.rs
# cites one by accession.version, as scripts/outside-data/identify_alignment_members.py identified it,
# and src/__tests__/sampleAlignmentProvenance.test.ts checks the member against it.
ALIGNMENT_MEMBERS_NUCCORE="AB012104.1 AB104902.1 AB185022.1 AF028209.1 AF147616.1 AF154850.1 AF338715.1 AF490528.1 AH014071.2
  AJ421451.1 AJ428577.1 AJ554061.1 AM711896.1 AM711901.1 AM904729.1 AP005985.1 AP007244.1 AY016013.1
  AY489465.1 AY489507.1 AY574047.1 AY609141.1 AY650206.1 AY659992.1 DQ093080.1 DQ409327.1 EF455490.1
  EF484241.1 EF484317.1 EF551003.1 EF597500.1 EF597513.1 HQ625567.1 HQ625568.1 HQ625570.1 HQ625571.1
  HQ625572.1 HQ625573.1 HQ625575.1 HQ625576.1 HQ625578.1 HQ625579.1 HQ625580.1 HQ625581.1 HQ625582.1
  HQ625583.1 HQ625584.1 HQ625585.1 HQ625586.1 HQ625587.1 HQ625588.1 HQ625589.1 JX560779.1 JX560780.1
  JX560781.1 JX560782.1 JX560783.1 LT559488.1 M74004.1 M80903.1 NC_001321.1 NC_001325.1 NC_001573.1
  NC_001606.1 NC_001643.1 NC_001645.1 NC_001665.1 NC_001727.1 NC_002083.1 NC_005089.1 NC_012920.1
  NC_020709.1 NC_040902.1 NM_002753.2 NM_138980.1 NM_138981.1 NM_138982.1 X97336.1 Y18001.1"
ALIGNMENT_MEMBERS_PROTEIN="1BP4_A 2ACT_A AAF05593.1 AAP57355.1 AAR33483.1 ADE04452.1 AFS36559.1 AOW51678.1 EEF81315.1
  EFN86804.1 EGC57364.1 EJG11255.1 ELY50302.1 ELZ06622.1 EPQ05513.1 EPY90010.1 GAC25539.1 KUJ93261.1
  NP_001005836.1 NP_001094545.1 NP_001121342.1 WIM44693.1 WP_004622793.1 WP_006956591.1 WP_010479887.1
  WP_010884393.1 WP_011011385.1 WP_012067924.1 WP_017364566.1 WP_143715051.1 XP_001658296.1
  XP_001847766.1 YP_002995212.1 YP_003466443.1 YP_004112020.1 YP_005824151.1 YP_007545091.1
  YP_780527.1 ZP_03841354.1 ZP_07953273.1 ZP_07993777.1 ZP_08214735.1 ZP_08308204.1 ZP_08630593.1"
for a in $ALIGNMENT_MEMBERS_NUCCORE; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=nuccore&id=$a&rettype=fasta&retmode=text" "ncbi/$a.fasta"; sleep 0.4; done
for a in $ALIGNMENT_MEMBERS_PROTEIN; do
  get "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=protein&id=$a&rettype=fasta&retmode=text" "ncbi/protein/$a.fasta"; sleep 0.4; done
note ncbi "Source: NCBI Nucleotide and Protein via E-utilities (public domain US government data)"
# Synthego ICE test traces
for f in good_example_control good_example_edited low_quality_control low_quality_edited donor_example_control donor_example_knockin donor_sub_example_control donor_sub_example_edited multiplex0_control multiplex0_edited multiplex1_control multiplex1_edited; do
  get "https://raw.githubusercontent.com/synthego-open/ice/master/ice/tests/test_data/$f.ab1" "synthego-ice/$f.ab1"; done
get https://raw.githubusercontent.com/synthego-open/ice/master/ice/tests/test_analysis.py synthego-ice/test_analysis.py
get https://raw.githubusercontent.com/synthego-open/ice/master/LICENSE synthego-ice/LICENSE
note synthego-ice "Source: https://github.com/synthego-open/ice (ice/tests/test_data), see LICENSE"
# Biopython ABIF test files
for f in test.fsa 310.ab1 3100.ab1 3730.ab1 A6_1-DB3.ab1 empty.ab1 no_smpl1.ab1 nonascii_encoding.ab1 test_data; do get "https://raw.githubusercontent.com/biopython/biopython/master/Tests/Abi/$f" "biopython-abi/$f"; done
get https://raw.githubusercontent.com/biopython/biopython/master/LICENSE.rst biopython-abi/LICENSE.rst
note biopython-abi "Source: https://github.com/biopython/biopython/tree/master/Tests/Abi (Biopython License / BSD-3)"
# GitHub API listings (gh_api URL) authenticate with GITHUB_TOKEN when it is set (CI passes the job
# token), else with `gh auth token` when the GitHub CLI is installed and logged in, else go
# anonymous, which allows 60 requests an hour. The token is never printed, and curl reads its header
# from stdin, so it is not on any command line either.
gh_token="${GITHUB_TOKEN:-}"
if [ -z "$gh_token" ] && command -v gh >/dev/null 2>&1; then gh_token=$(gh auth token 2>/dev/null) || gh_token=""; fi
gh_api() { if [ -n "$gh_token" ]; then curl -sSfL --retry 3 --max-time 60 -H @- "$1" <<< "Authorization: Bearer $gh_token"; else curl -sSfL --retry 3 --max-time 60 "$1"; fi; }
# Biopython format test files (alignments, flat files, FASTQ encodings, SAM): every file
# of each Tests/ folder under 2 MB, listed with the GitHub contents API. A listing that fails (e.g.
# the anonymous API's limit) prints a FAIL line as get() does.
for d in Clustalw Phylip Stockholm Nexus GenBank EMBL Quality SamBam Fasta; do
  api="https://api.github.com/repos/biopython/biopython/contents/Tests/$d"
  names=$(gh_api "$api" | python3 -c 'import json,sys
try: l = [f["name"] for f in json.load(sys.stdin) if f["type"] == "file" and f["size"] < 2_000_000]
except Exception as e: sys.exit(f"not a contents listing: {e!r}")
print(*l, sep="\n")') || { echo "FAIL $api"; continue; }
  while read -r f; do [ -z "$f" ] || get "https://raw.githubusercontent.com/biopython/biopython/master/Tests/$d/$f" "biopython-tests/$d/$f"; done <<< "$names"
done
get https://raw.githubusercontent.com/biopython/biopython/master/LICENSE.rst biopython-tests/LICENSE.rst
note biopython-tests "Source: https://github.com/biopython/biopython/tree/master/Tests (Clustalw, Phylip, Stockholm, Nexus, GenBank, EMBL, Quality, SamBam, Fasta)
Licence: Biopython License / BSD-3 (LICENSE.rst)"
# PAML amino-acid exchangeability matrices (the built-in LG / WAG / JTT models are generated from these)
for f in lg.dat wag.dat jones.dat; do get "https://raw.githubusercontent.com/abacus-gene/paml/$PAML_COMMIT/dat/$f" "paml/$f"; done
# Fragment-analysis runs read by src/__tests__/fragmentAnalysisRealRuns.test.ts. Each folder is listed
# with one git trees API call (recursive, so a nested folder costs one request of the anonymous
# limit like a flat one), through gh_api; a failed listing prints a FAIL line as the Biopython one
# does. Both repositories are read at a fixed commit, not a branch, as MrBayes and PAML are, so an
# upstream change cannot alter the runs under the unchanged cache key (the hash of this script).
# tree_files DIR reads the listing on stdin and prints each file under
# DIR, at any depth, as "<URL-encoded path><TAB><path>" relative to DIR; a truncated listing, or one
# with no file under DIR, fails rather than fetching nothing.
tree_files() { python3 -c 'import json,sys,urllib.parse
p = sys.argv[1] + "/"
try: t = json.load(sys.stdin); l = [e["path"][len(p):] for e in t["tree"] if e["type"] == "blob" and e["path"].startswith(p)]
except Exception as e: sys.exit(f"not a trees listing: {e!r}")
if t.get("truncated") or not l: sys.exit(f"truncated listing, or no file under {p}")
for f in l: print(urllib.parse.quote(f), f, sep="\t")' "$1"; }
# NCBI OSIRIS: every STR kit test run under osiris/docs/TestAnalysis (into runs/, keeping its
# subfolders), and the definitions of the six kits those runs use plus the lane standards (into kits/).
# c9dab15 (2021-07-08) is the last master commit to touch any of these files; master's head
# (2ab5f25, 2024-04-10) holds the same bytes.
OSIRIS_COMMIT=c9dab1530c6950ff8b0a887e1ad7a610aea5ba98
raw=https://raw.githubusercontent.com/ncbi/osiris/$OSIRIS_COMMIT/osiris
api="https://api.github.com/repos/ncbi/osiris/git/trees/$OSIRIS_COMMIT?recursive=1"
files=$(gh_api "$api" | tree_files osiris/docs/TestAnalysis) || echo "FAIL $api"
while IFS=$'\t' read -r q f; do [ -z "$f" ] || get "$raw/docs/TestAnalysis/$q" "osiris-ncbi/runs/$f"; done <<< "$files"
for f in Cofiler_LadderInfo.xml GlobalFiler_LadderInfo.xml Identifiler_LadderInfo.xml PowerPlex16_LadderInfo.xml PPFusion_LadderInfo.xml ProfilerPlus_LadderInfo.xml ILSAndLadderInfo.xml; do
  get "$raw/OsirisXML/LadderSpecifications/$f" "osiris-ncbi/kits/$f"; done
note osiris-ncbi "Source: https://github.com/ncbi/osiris/tree/$OSIRIS_COMMIT (osiris/docs/TestAnalysis into runs/, osiris/OsirisXML/LadderSpecifications into kits/), commit $OSIRIS_COMMIT
Licence: public domain (NCBI public domain notice, e.g. osiris/OsirisAnalysis/bin/COPYING)
Contents: STR kit test runs (.fsa/.hid: allelic ladders, positive/negative controls, NIST MIX05 samples) and kit definitions (markers, dyes, allele bins, lane standards)."
# CRAN trace (HTT CAG repeat instability): every run in data-raw/cell_line_fsa_list_files, and the
# sample metadata (incl. validated modal repeats) and example repeat table from data/.
# a2c860e (2025-02-13) is the last main commit to touch any of these files; main's head
# (ace5465, 2025-12-23) holds the same bytes.
TRACE_COMMIT=a2c860e670fc9b407b1169dbe81f7ecf074786a0
raw=https://raw.githubusercontent.com/zachariahmclean/trace/$TRACE_COMMIT
api="https://api.github.com/repos/zachariahmclean/trace/git/trees/$TRACE_COMMIT?recursive=1"
files=$(gh_api "$api" | tree_files data-raw/cell_line_fsa_list_files) || echo "FAIL $api"
while IFS=$'\t' read -r q f; do [ -z "$f" ] || get "$raw/data-raw/cell_line_fsa_list_files/$q" "trace-cran/$f"; done <<< "$files"
for f in metadata.rda example_data_repeat_table.rda; do get "$raw/data/$f" "trace-cran/$f"; done
get "$raw/LICENSE" trace-cran/LICENSE
note trace-cran "Source: https://github.com/zachariahmclean/trace/tree/$TRACE_COMMIT (data-raw/cell_line_fsa_list_files, data/metadata.rda, data/example_data_repeat_table.rda), commit $TRACE_COMMIT
Licence: MIT (the package's DESCRIPTION: MIT + file LICENSE; LICENSE holds its year and holder, the full text is LICENSE.md upstream)
Contents: HTT CAG repeat-instability fragment runs (.fsa) and sample metadata (incl. validated modal repeats)."
echo "done"
