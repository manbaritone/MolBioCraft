# Outside-data checks

MolBioCraft's results are compared with established tools on public data. The raw public inputs
are git-ignored and downloaded into `test-data/` by `fetch.sh`. The reference results
(`test-data/reference/*.json`) and the simulated reads (`test-data/sim/`) are our own computations
from those inputs and are committed (D0010), with each input's source and licence in
`PROVENANCE.md`. A clean clone plus `fetch.sh` therefore holds everything the reference check
(`scripts/check_reference_suite.mjs`) needs, apart from the private lab runs below. Tests find
`test-data/` through `src/__tests__/testData.ts` (Rust: the same `MOLBIOCRAFT_TEST_DATA_DIR` and
`MOLBIOCRAFT_REQUIRE_TEST_DATA` rules): a suite whose named files are absent is skipped with a
`skipped: reference data absent` line, and fails instead under `MOLBIOCRAFT_REQUIRE_TEST_DATA=1`.

1. Download the data: `scripts/outside-data/fetch.sh test-data`. Each failed download or GitHub API
   listing prints a `FAIL <url>` line. The anonymous GitHub API allows 60 requests an hour and a run
   makes 12, so set `GITHUB_TOKEN` when fetching repeatedly.
2. Only to rebuild the committed references: install the reference tools with
   `mamba env create -p .refenv -f scripts/outside-data/environment.yml`.
3. Rebuild the references (each writes `test-data/reference/*.json`; `ref_ngs.py` also writes
   `test-data/sim/`). Run `ref_phylo_tools.py` after `ref_phylo.R`, since it reads the primates
   alignment from `phylo_r.json`. Then run `python3 -I scripts/outside-data/strip_gpl_inputs.py
   test-data`: it replaces the GPL-3.0 input alignments the scripts embed (MrBayes primates, PAML
   HIV env and lysozyme) with their SHA-256 checksums (D0016). Commit the results with any
   `PROVENANCE.md` change:

| Script | Reference tools | Data | Checked by |
|---|---|---|---|
| `ref_align.py` | Biopython PairwiseAligner, MAFFT, MUSCLE, Clustal Omega | UniProt / GenBank pairs, 26 Pfam seeds, MrBayes primates | `crates/molbiocraft-align/tests/outside_data_reference.rs` |
| `ref_phylo.R`, `ref_phylo_tools.py` | ape, phangorn, pegas; IQ-TREE; PAML yn00 | MrBayes primates; PAML lysozyme / HIV env | `src/__tests__/outsideDataPhylo.test.ts` |
| `ref_seqtools.py` | Biopython, EMBOSS getorf, ExPASy ProtParam (online), Primer3, ViennaRNA, pyteomics, BLAST+ | GenBank genomes, UniProt proteins | `src/__tests__/outsideDataSeqTools.test.ts` |
| `ref_deseq2.R` (`ref_expression.py`: PyDESeq2) | Bioconductor DESeq2 | pasilla counts | `src/__tests__/outsideDataExpression.test.ts` |
| `ref_ice.py` | Synthego ICE 1.2 | ICE test traces | `src/__tests__/outsideDataCrispr.test.ts` |
| `ref_ngs.py` | wgsim (truth), BWA-MEM + bcftools, SPAdes | phiX174, lambda | `src/__tests__/outsideDataNgs.test.ts` |
| `ref_formats.py` | Biopython, samtools, bcftools | NCBI GenBank / GFF3, ENA EMBL, AB1, RCSB PDB / mmCIF | `src/__tests__/outsideDataFormats.test.ts` |
| `ref_formats_bp.py` | Biopython (AlignIO, SeqIO) | Biopython Tests/ files: Clustal, PHYLIP, Stockholm, multi-record GenBank / EMBL, FASTQ (Sanger, Illumina 1.3+, Solexa), BAM | `src/__tests__/importExportRoundTrip.test.ts` |
| `ref_structure.py` | tmtools (TM-align), Biopython | RCSB PDB entries | `src/__tests__/structureAlignment.test.ts`, `structureView.test.ts`, `ramachandran.test.ts`; `crates/molbiocraft-protein/tests/structure_superposition_reference.rs`, `crates/molbiocraft-formats/tests/structure_model_reference.rs` |

Run Python scripts with the environment's interpreter and `-I`, e.g.
`PATH=.refenv/bin:$PATH .refenv/bin/python -I scripts/outside-data/ref_align.py test-data`;
R scripts with `.refenv/bin/Rscript`. Synthego ICE (`ref_ice.py`) needs Python 3.9 with
`biopython=1.78 numpy=1.21 pandas=1.3 scipy scikit-learn xlrd openpyxl xlsxwriter matplotlib flask`
and `pip install --no-deps git+https://github.com/synthego-open/ice`.

Fragment-analysis runs (NCBI OSIRIS kits and ladders, CRAN `trace`, Biopython `test.fsa`) are
checked by `src/__tests__/fragmentAnalysisRealRuns.test.ts`. `fetch.sh` downloads them from a fixed
commit, listing each folder with one GitHub git trees API call. The API calls authenticate with
`GITHUB_TOKEN`, or else with `gh auth token` when the GitHub CLI is logged in; without either they
use the anonymous limit of 60 requests an hour.

- `test-data/osiris-ncbi/`: github.com/ncbi/osiris at `OSIRIS_COMMIT`, every run under
  `osiris/docs/TestAnalysis` (into `runs/`) and seven kit files from
  `osiris/OsirisXML/LadderSpecifications` (into `kits/`). Public domain.
- `test-data/trace-cran/`: github.com/zachariahmclean/trace at `TRACE_COMMIT`, every run in
  `data-raw/cell_line_fsa_list_files`, plus `data/metadata.rda`, `data/example_data_repeat_table.rda`
  and `LICENSE`. MIT.

The private lab runs in `test-data/All_Cnu_microsatellites_combined/` have no recorded source or
licence. They are never committed or fetched. Their one test (`matches all 16 GeneScan 500 LIZ peaks
on the 3730xl runs`) is declared local-only in `scripts/check_reference_suite.mjs`, which names it on
every run and lets only it skip, only while the folder is absent. Every other test in that file must
pass, and one that prints the skip line while it runs (it returned early) fails the check.
