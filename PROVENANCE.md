# MolBioCraft Clean-Room Provenance & Legal Inventory

**License:** Creative Commons Attribution-NonCommercial 4.0 International (`CC BY-NC 4.0`, `SPDX-License-Identifier: CC-BY-NC-4.0`)  
**Status:** Non-Commercial Software for Personal, Educational, and Scientific Research

---

## 1. Clean-Room Development Policy

1. **Independent Implementation**: All source code, UI layouts, visual themes, icons, and documentation in `MolBioCraft` are independently authored from published scientific literature, open bioinformatics format specifications, and permissively licensed open-source libraries.
2. **Prohibited Proprietary Sources**: No source code, decompiled binaries, extracted assets, UI layouts, or proprietary plugin archives from commercial molecular-biology applications may be inspected, copied, or used to benchmark or build `MolBioCraft`. Any local `resources/` directory is git-ignored (the `/resources/` rule in `.gitignore`; BG-01M6T4EH untracked the folder) and excluded from all build pipelines.
3. **Open Standards First**: `MolBioCraft` prioritizes openly specified exchange formats:
   - **INSDC GenBank (`.gb`, `.gbk`) & EMBL (`.embl`)** flatfiles
   - **FASTA (`.fa`, `.fasta`, `.fna`, `.faa`) & FASTQ (`.fq`, `.fastq`)**
   - **GA4GH GFF3 (`.gff3`), BED (`.bed`), VCF (`.vcf`), & SAM (`.sam`)** via `noodles-*`
   - **Applied Biosystems ABIF v1.0 (`.ab1`)** binary tag directory specification for Sanger capillary chromatograms
   - **wwPDB (`.pdb`, `.cif`)** structural coordinate files
   - **MolBioCraft Native Session (`.mbc`, `.mbc.gz`)** open JSON/Gzip schema with dual FNV-1a and IEEE 802.3 CRC32 integrity verification

---

## 2. Scientific Algorithm Provenance

Every computational capability is derived directly from peer-reviewed scientific publications:

| Domain | Algorithm / Model | Primary Published Source | Crate Implementation |
| :--- | :--- | :--- | :--- |
| **Nomenclature & Complementarity** | 15-letter degenerate IUPAC nucleotide & 20+2 amino acid codes | NC-IUB (*Biochem. J.* 1985, 229:281–286) | `crates/molbiocraft-core/src/iupac.rs` |
| **Sub-Linear Motif Indexing** | Burrows-Wheeler Transform (BWT) & FM-Index backward search; Aho-Corasick automaton | Ferragina & Manzini (*FOCS* 2000); Aho & Corasick (*CACM* 1975) | `crates/molbiocraft-core/src/genome_index.rs` |
| **PWM & Profile HMM Scanning** | Log-odds Position Weight Matrix & Viterbi decoding | Durbin et al., *Biological Sequence Analysis* (1998) | `crates/molbiocraft-core/src/hmm_pssm_motifs.rs` |
| **Primer & Duplex Thermodynamics** | Unified Nearest-Neighbor $\Delta H^\circ, \Delta S^\circ, \Delta G^\circ_{37}$ & divalent $[Mg^{2+}]$ salt correction | SantaLucia (*PNAS* 1998, 95:1460–1465); Owczarzy et al. (*Biochemistry* 2008, 47:5336–5353) | `crates/molbiocraft-cloning/src/thermodynamics.rs` |
| **Restriction Cleavage & Methylation** | Type II & Type IIS recognition patterns, sense/antisense cleavage offsets, `Dam`/`Dcm`/`CpG` overlap | Roberts et al., REBASE (*Nucleic Acids Res.* 2023, 51:D629–D630) | `crates/molbiocraft-cloning/src/rebase_catalog.rs` |
| **CRISPR Guide Scoring** | SpCas9/Cas12a PAM scanning, on-target efficiency & mismatch specificity | Doench et al. (*Nat. Biotechnol.* 2016); Hsu et al. (*Nat. Biotechnol.* 2013) | `crates/molbiocraft-cloning/src/cloning_crispr.rs` |
| **Pairwise & Multiple Alignment** | Affine-gap global (Needleman-Wunsch/Gotoh), local (Smith-Waterman), Partial Order Alignment (POA) | Needleman & Wunsch (1970); Smith & Waterman (1981); Gotoh (1982); Lee et al. (2002) | `crates/molbiocraft-align/src/pairwise.rs`, `poa_and_banded.rs` |
| **Evolutionary Distances & Trees** | JC69, K80, TN93, GTR substitution models; Neighbor-Joining; Felsenstein pruning ML | Jukes & Cantor (1969); Kimura (1980); Tamura & Nei (1993); Saitou & Nei (1987); Felsenstein (1981) | `crates/molbiocraft-phylo/src/distances.rs`, `trees.rs`, `models_selection.rs` |
| **Protein Biophysics** | Henderson-Hasselbalch $pI$, Kyte-Doolittle GRAVY, extinction coefficient $\varepsilon_{280}$ | Bjellqvist et al. (1993); Kyte & Doolittle (1982); Pace et al. (1995) | `crates/molbiocraft-protein/src/biophysics_3d.rs` |
| **Ramachandran Regions** | Favoured / allowed / outlier from 10° maps derived from the Top8000 contour grids at MolProbity's cutoffs (D0009; data under "Embedded third-party data" below) | Williams et al. (*Protein Sci.* 2018, 27:293–315); cutoffs as coded in cctbx `mmtbx/validation/ramalyze.py` | `crates/molbiocraft-protein/src/backbone.rs` |
| **Sanger Trace Quality Trimming** | Phred error probability $P = 10^{-Q/10}$ & Mott running-sum minimum-error segment | Ewing & Green (*Genome Res.* 1998) | `crates/molbiocraft-formats/src/chromatogram_mbc.rs` |
| **Spliced Eukaryotic Gene Prediction** | Canonical donor (`GT`) / acceptor (`AG`) splice junctions, Kozak translation initiation consensus (`RccATGG`), and coding reading-frame exon chaining | Breathnach & Chambon (*Annu. Rev. Biochem.* 1981, 50:349–383); Kozak (*Nucleic Acids Res.* 1987, 15:8125–8148); Burge & Karlin (*J. Mol. Biol.* 1997, 268:78–94) | `src/plugins/pluginEngine.ts` (`runEukaryoticSplicedGenePrediction`) |
| **CRISPR Direct-Repeat Array Detection** | Direct-repeat (21–37 bp) and variable spacer (19–48 bp) array window scanning | Bland et al. (*BMC Bioinformatics* 2007, 8:209); Mojica et al. (*J. Mol. Evol.* 2005, 60:174–182) | `src/plugins/pluginEngine.ts` (`runCrisprRepeatArrayFinder`) |
| **Haplotype & Allele Partitioning** | Allele multiset partitioning, Shannon information entropy $H$, Watterson segregating sites, and unbiased haplotype diversity $H_d = \frac{n}{n-1}(1 - \sum p_i^2)$ | Nei, *Molecular Evolutionary Genetics* (1987); Watterson (*Theor. Popul. Biol.* 1975, 7:256–276) | `src/plugins/pluginEngine.ts` (`runHaplotypeAllelePartitioner`) |
| **Phylogenetic Species Delimitation** | Coalescent clade distinctiveness $P(\text{RD})$, reciprocal monophyly, and intra- vs inter-group genetic distance barcoding gap | Rodrigo et al. (*Philos. Trans. R. Soc. B* 2008, 363:3893–3902); Rosenberg (*Evolution* 2003, 57:1465–1477); Hebert et al. (*Proc. R. Soc. B* 2003, 270:313–321) | `src/plugins/pluginEngine.ts` (`runSpeciesDelimitationPlugin`) |
| **Protein Conserved Motifs & Antigenicity** | Conserved sequence motifs (P-loop NTPase, C2H2 zinc finger, EF-hand, kinase catalytic loop), GOR IV secondary structure propensities, and Kolaskar-Tongaonkar B-cell antigenic determinants | Walker et al. (*EMBO J.* 1982, 1:945–951); Garnier et al. (*Methods Enzymol.* 1996, 266:540–553); Kolaskar & Tongaonkar (*FEBS Lett.* 1990, 276:172–174) | `src/plugins/pluginEngine.ts` (`runProteinDomainsAndEpitopesSuite`) |
| **Microbial Gene & RBS Prediction** | Prokaryotic/viral 6-frame coding periodicity (ATG/GTG/TTG starts, NCBI Table 11) and upstream 16S rRNA Shine-Dalgarno ribosome-binding site conservation | Delcher et al. (*Nucleic Acids Res.* 1999, 27:4636–4641); Salzberg et al. (*Nucleic Acids Res.* 1998, 26:544–548); Shine & Dalgarno (*PNAS* 1974, 71:1342–1346) | `src/plugins/pluginEngine.ts` (`runMicrobialInterpolatedMarkovGenePredictor`) |
| **Microsatellite & Tandem Repeat Detection** | Primitive $k = 1\text{–}6\text{ bp}$ short tandem repeat (STR / SSR) tract scanning and copy-number purity | Benson (*Nucleic Acids Res.* 1999, 27:573–580); Tautz & Renz (*Nucleic Acids Res.* 1984, 12:4127–4138) | `src/plugins/pluginEngine.ts` (`runTandemRepeatMicrosatelliteFinder`) |
| **Transmembrane & Signal Peptide Topology** | 19-residue Kyte-Doolittle hydropathy helix windowing, positive-inside orientation rule, and tripartite Sec/SPI N-terminal signal peptide cleavage scanning | Kyte & Doolittle (*J. Mol. Biol.* 1982, 157:105–132); von Heijne (*Nucleic Acids Res.* 1986, 14:4683–4690; *J. Mol. Biol.* 1992, 225:487–494) | `src/plugins/pluginEngine.ts` (`runTransmembraneAndSignalPeptideTopology`) |
| **Taxonomic Sequence Classification** | Oligonucleotide $k$-mer signature matching and Karlin-Burge dinucleotide relative abundance odds ratios ($\rho_{\text{CpG}}, \rho_{\text{TA}}$) | Wang et al. (*Appl. Environ. Microbiol.* 2007, 73:5261–5267); Karlin & Burge (*Trends Genet.* 1995, 11:283–290) | `src/plugins/pluginEngine.ts` (`runTaxonomicSequenceClassifier`) |
| **Adapter & Quality Read Trimming** | Universal sequencing adapter $k$-mer screening and Mott running-sum Phred quality trimming | Ewing & Green (*Genome Res.* 1998, 8:186–194); Bolger, Lohse & Usadel (*Bioinformatics* 2014, 30:2114–2120) | `src/plugins/pluginEngine.ts` (`runAdapterAndQualityReadTrimmer`) |
| **Whole-Genome Synteny & Collinear Blocks** | Weight-11 spaced-seed anchor indexing (`111010010100110111`) and Locally Collinear Block (LCB) breakpoint detection | Ma, Tromp & Li (*Bioinformatics* 2002, 18:440–445); Pevzner & Tesler (*Genome Res.* 2003, 13:37–45) | `src/plugins/pluginEngine.ts` (`runGenomeSyntenyCollinearBlocks`) |

---

## 3. Dependency & License Inventory

MolBioCraft is licensed under `CC BY-NC 4.0` (`SPDX-License-Identifier: CC-BY-NC-4.0`), and each third-party dependency remains under its own open-source licence:

| Dependency | Version | SPDX License | Source | Obligations |
| :--- | :--- | :--- | :--- | :--- |
| `bio` | `2.0` | `MIT` | crates.io (`rust-bio`) | Retain copyright notice in `NOTICE`. |
| `noodles-*` | `0.16`–`0.73` | `MIT` | crates.io (`zaeleus/noodles`) | Retain copyright notice in `NOTICE`. |
| `aho-corasick`, `memchr` | `1.1`, `2.7` | `Unlicense OR MIT` | crates.io | Retain notice in `NOTICE`. |
| `petgraph`, `rayon`, `serde`, `serde_json`, `csv`, `crc32fast`, `flate2`, `rustc-hash` | Workspace | `MIT OR Apache-2.0` | crates.io | Retain notices in `NOTICE`. |
| `nalgebra`, `ndarray`, `statrs` | `0.33`, `0.16`, `0.18` | `Apache-2.0` / `MIT` | crates.io | Retain notices in `NOTICE`. |
| `triple_accel` | `0.4` | `MIT` | crates.io | Retain notice in `NOTICE`. |
| `tauri`, `rfd`, `objc2-app-kit` | `2.0.0`, `0.15`, `0.3` | `MIT OR Apache-2.0` / `MIT` | crates.io | Retain notices in `NOTICE`. |
| `r-efi` | `5.3.0`, `6.0.0` | `MIT` (`MIT OR Apache-2.0 OR LGPL-2.1-or-later`, taken under `MIT`) | `github.com/r-efi/r-efi` / crates.io | Retain notice in `NOTICE`. |
| `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`, `option-ext` | `0.37.0`, `0.7.1`, `0.38.0`, `0.3.5`, `0.2.0` | `MPL-2.0` | `github.com/servo/rust-cssparser`, `github.com/servo/stylo`, `github.com/upsuper/dtoa-short`, `github.com/soc/option-ext` / crates.io | Unmodified transitive desktop-shell crates; source URLs listed in `NOTICE` section 3. |
| `react`, `react-dom`, `lucide-react` | `18.3.1`, `0.468.0` | `MIT` / `ISC` | npmjs.com | Retain notices in `NOTICE`. |
| `molstar` | `5.13.1` | `MIT` | `github.com/molstar/molstar` / npmjs.com | Retain notice in `NOTICE` (cite Sehnal et al., *Nucleic Acids Res.* 2021, 49:W431–W437). |

### Embedded third-party data

| Data | Version | SPDX License | Source | Shipped as | Obligations |
| :--- | :--- | :--- | :--- | :--- | :--- |
| Top8000 Ramachandran contour grids (`rama8000-*.data`). Copyright (c) 2016-2026 David C. Richardson, Jane S. Richardson, and contributors; Richardson Lab, Duke University. Cite Williams et al. (*Protein Sci.* 2018, 27:293–315, doi:10.1002/pro.3330) | Commit `5ee6875fc29eccc3c9dc7cbe705ff9fd1b505d7d`; the six files are unchanged since they were added in `534d5419` (2016-11-14) | `CC-BY-4.0` (CC BY 4.0) | `github.com/rlabduke/reference_data`, `Top8000/Top8000_ramachandran_pct_contour_grids/` | Six derived 10° region maps (`GENERAL_REGIONS`, `GLYCINE_REGIONS`, `TRANS_PROLINE_REGIONS`, `CIS_PROLINE_REGIONS`, `PRE_PROLINE_REGIONS`, `ILE_VAL_REGIONS`) in `crates/molbiocraft-protein/src/backbone.rs` (D0009). The grids themselves are not shipped or committed | Credit the authors and the Richardson Lab, link the source and the licence, keep the warranty disclaimer, state the changes made, and imply no endorsement: `NOTICE` section 6. |
| AlphaFold DB entry AF-P69905-F1 (UniProt P69905, haemoglobin subunit alpha), from the AlphaFold Protein Structure Database by Google DeepMind (DeepMind Technologies Limited) and EMBL-EBI. ALPHAFOLD DATA, COPYRIGHT (2021) DEEPMIND TECHNOLOGIES LIMITED (AlphaFold DB's copyright notice, quoted from its licence statement). Cite Jumper et al. (*Nature* 2021, 596:583–589, doi:10.1038/s41586-021-03819-2) and Varadi et al. (*Nucleic Acids Res.* 2024, 52:D368–D375, doi:10.1093/nar/gkad1011) | Model version 6 (`AF-P69905-F1-model_v6.cif`, `AF-P69905-F1-model_v6.pdb`), fetched 2026-11-06 | `CC-BY-4.0` (CC BY 4.0) | `alphafold.ebi.ac.uk/files/` | Test fixtures only (BG-01M6REVT): `AF_P69905_ATOM_SITE`, `AF_P69905_CIF` and `AF_P69905_PDB` in `src/__tests__/structureAndPipelineOrder.test.tsx`, cut to the Cα atoms of residues 1–5 with the header records that say what each file is, trailing spaces trimmed; the same five Cα records also sit under constructed headers in that file's other fixtures. Not part of any build | Keep AlphaFold DB's copyright notice (the fixtures drop the records that carry it), credit AlphaFold DB, Google DeepMind and EMBL-EBI, link the source and the licence, keep the warranty disclaimer, state the changes made, and imply no endorsement: `NOTICE` section 6. |
| iGEM Registry parts BBa_G00100, BBa_G00101 and BBa_G00103-BBa_G00107 (the VF2 and VR BioBrick primers and the five M13 universal sequencing primers), from the Registry of Standard Biological Parts, by the iGEM Foundation and the depositors of each part. The Registry supplies no copyright notice of its own with a part record | Fetched 2026-11-08 from the Registry API (`https://api.registry.igem.org/v1/parts/slugs/<part>`); the parts have been published since 2004-2005 | `CC-BY-4.0` (CC BY 4.0) | `api.registry.igem.org`, part pages at `parts.igem.org/Part:<part>` | Each part's sequence, unchanged, as one sample primer document (the `doc-primer-seq-*` documents in `crates/molbiocraft-cloning/src/sample_library_data.rs`). Shipped in the app | Credit the iGEM Foundation and the depositors, link the source and the licence, keep the warranty disclaimer, state the changes made, and imply no endorsement: `NOTICE` section 6. |

**How the maps are derived.** `scripts/outside-data/derive_ramachandran_maps.py` downloads the six grid files from the pinned commit (`--fetch`), checks each against its SHA-256, and rebuilds the maps. Each 2° node is classed with MolProbity's cutoffs, as coded in cctbx `mmtbx/validation/ramalyze.py`: favoured at a value of at least 0.02; otherwise allowed at least 0.0005 (general), 0.0020 (cis-Pro) or 0.0010 (the other classes); otherwise outlier. A node a file does not list counts as 0, as in cctbx. Each 10° cell then takes the median class of its 25 nodes. With `--check crates/molbiocraft-protein/src/backbone.rs`, the script compares the committed maps cell for cell and exits 1 on any difference. On 2026-11-06, 0 of the 7,776 cells differed.

---

## 4. Evidence Separation: Verified Permissions, Assumptions & Open Questions

### Verified Permissions
- All Rust crates and NPM packages listed above remain under their own open-source licences (`MIT`, `Apache-2.0`, `ISC`, `Unlicense`, and file-level `MPL-2.0` for the five unmodified desktop-shell crates `cssparser`, `cssparser-macros`, `selectors`, `dtoa-short`, and `option-ext`; `r-efi` is taken under `MIT`).
- The sample library is sourced from public records, and each sample is checked against the record it cites by `src/__tests__/sampleScientificAccuracy.test.ts`, which reads the records `scripts/outside-data/fetch.sh` fetches (US-01M6TDFV):
  - **NCBI** (public domain US government data), through E-utilities: the nucleotide and protein records behind the reference sequences in `sample_library_data.rs` and the 33 record summaries behind `sample_genomes_data.rs` — among them `NC_000913`, `L09137`, `J01749`, `J04639.1` (the Taq polymerase gene), the RefSeq proteins `NP_417020.1` (Fdx) and `NP_415743.1` (NarH) of *E. coli* K-12 MG1655, `3C4W_B`, the coding sequence of protein `YP_004715652` (yadF), and the phage genomes `NC_001604` (T7), `NC_003298` (T3) and `NC_004831` (SP6) that hold the promoter sequencing primers.
  - **RCSB PDB** (`CC0`): entries `1D66` and `1A4Y`, whose observed C-alpha residues and coordinates are the two structure-backed protein samples in `sample_library_data.rs`. RCSB releases its coordinate files under `CC0 1.0`, which waives attribution; `NOTICE` section 2 credits the wwPDB anyway.
  - **iGEM Registry of Standard Biological Parts** (`CC BY 4.0`): parts `BBa_G00100`, `BBa_G00101` and `BBa_G00103`-`BBa_G00107`, the seven BioBrick and M13 universal sequencing primers. The attribution the licence requires is in `NOTICE` section 6.
  - **Published standards**: BBF RFC 10 (the BioBrick prefix and suffix) and the Gateway attB1 / attB2 primer tails, from which the four yadF cloning primers are built; the construction is stated in the doc comment of `sample_library_data.rs`.
  - The re-sourced samples above (the primers, protein records, yadF clone, Taq gene and genome records) carry no other program's document data: no `Created`, `Modified` or `Designed With` field, no copied Tm or %GC (MolBioCraft computes both), and their `created_at` / `updated_at` are MolBioCraft's own. The alignment, tree and contig-assembly documents in `sample_alignments_data.rs` (the fictitious-character People alignment and its tree were dropped, US-01M6TGKH) were rebuilt from public records by US-01M6TDSV: the aligned rows are MolBioCraft's own multiple alignment of the members' records, the trees are its Neighbor-Joining trees of those alignments, and the COI and yghJ reads are seeded simulations of their NCBI references, labelled as simulated. None carries a `Created` or `Modified` field, and their `created_at` / `updated_at` are when MolBioCraft rebuilt them.
- The Top8000 Ramachandran contour grids, from which the region maps in `crates/molbiocraft-protein/src/backbone.rs` are derived, are licensed `CC BY 4.0`. At commit `5ee6875f`, both the repository's `README.md` and the `LICENSE` file in the grids' folder state it (checked 2026-11-06). The attribution is in `NOTICE` section 6.

### Reasonable Assumptions
- **ABIF (`.ab1`) Specification**: Reading big-endian `ABIF` directory entries (`DATA 9..12`, `PBAS`, `PLOC`, `PCON`) via an independently authored parser follows the published Applied Biosystems ABIF v1.0 specification.
- **AlphaFold DB Test Fixtures**: The AF-P69905-F1 fixtures in `src/__tests__/structureAndPipelineOrder.test.tsx` (BG-01M6REVT) are credited as AlphaFold DB data under `CC BY 4.0`, as recorded when they were fetched on 2026-11-06. The fixtures keep only the records that say what each file is, not the files' own licence and disclaimer records, so neither fixture holds the copyright notice those records carry. What is kept instead, as `CC BY 4.0` Section 3(a)(1)(A)(ii) requires: `NOTICE` section 6 opens the entry with the copyright notice AlphaFold DB supplies, "ALPHAFOLD DATA, COPYRIGHT (2021) DEEPMIND TECHNOLOGIES LIMITED", quoted from AlphaFold DB's licence statement and marked there as quoted, followed by the credit to AlphaFold DB, Google DeepMind and EMBL-EBI, the source URLs, the licence and its URI, the warranty disclaimer, the citations, the changes made and a no-endorsement statement. The AlphaFold DB row of the "Embedded third-party data" table and the comment on the fixtures repeat the copyright notice.
- **Biochemical Reaction Buffers**: Describing restriction digestion conditions using standard biochemical salt/pH compositions (e.g., `1x Potassium Acetate Tris-Magnesium Buffer (pH 7.9)`) avoids third-party reagent brand trademarks.

### Unresolved Legal & Patent Considerations
- **Trademark Clearance**: "MolBioCraft" is used as a provisional working name; a formal trademark search in international classes 9 and 42 should be completed prior to registered commercial branding.
- **Wet-Lab & Algorithm Patents**: Independent software implementation does not establish patent clearance for patented wet-lab protocols (e.g., specific engineered CRISPR/Cas effectors).

---

## 5. Committed Reference Test Data (D0010, D0016)

The outside-data checks compare MolBioCraft with established tools on public data (`scripts/outside-data/README.md`). The raw third-party inputs stay git-ignored and are downloaded by `scripts/outside-data/fetch.sh`. Only two folders of `test-data/` are committed, so that a clean clone and CI hold them without installing the reference tools:

- `test-data/reference/*.json`: the reference results, written by the `scripts/outside-data/ref_*` scripts.
- `test-data/sim/`: the simulated read set and its alignment and variant files.

**These files are our own computations.** We ran openly published tools on openly licensed inputs and recorded what they returned. Where a file also embeds a copy of its input sequences or records (the last column below), that embedded part stays under the input's own licence and attribution, given in the inputs column.

**GPL-3.0 inputs are never committed to main or to any pushed branch (D0016, D0020).** Only unpushed history holds copies, on the sprint branches `sdlc/sprint-02`, `sdlc/sprint-03` and `sdlc/sprint-04-old` (the branches `git for-each-ref --contains 5d3e45e` listed on 2026-11-07, rewritten to `3e51fc0` by the 2026-11-08 history rewrite): commit `5d3e45e` (`3e51fc0`) wrote them into `test-data/reference/`, and `f421e07` (`548e1be`) still had them, until `fa0f69a` (`df32388`) replaced them with checksums. Under D0020 those branches are never pushed and reach main only as a squash merge, one commit holding the final, stripped tree, so the copies never reach main. The versioned pre-push hook `scripts/git-hooks/pre-push` refuses to push any ref whose history holds `5d3e45e` or `3e51fc0`, which every commit of that history that holds the copies descends from, or holds any of the three files as `5d3e45e` / `3e51fc0` committed them, found by blob id in every tree of that history, so a squash, cherry-pick, rebase or `git commit-tree` of a pre-strip tree is refused too. A copy made some other way has another blob id and is not caught. The same hook refuses any ref whose history holds a path under the top-level `resources/` folder, which CR-01M6T9MT keeps out of every pushed history (BG-01M6T4EH); it asks each commit's own tree, so the folder is found even where the tip no longer holds it. The 2026-11-08 history rewrite removed `resources/` from earlier commits across all branches. The hook reads only the clone's own objects and never contacts the remote, and it refuses when it cannot tell: in a shallow clone that lacks `5d3e45e` / `3e51fc0`, or in a partial clone, which lacks objects and would fetch them from its remote. Git runs it only once it is installed, once in each clone, with `sh scripts/git-hooks/pre-push --install` from a checkout that has the file. That copies it into the clone's common git dir, `$(git rev-parse --git-common-dir)/hooks/pre-push`, which Git runs on every push from every worktree of the clone, whatever branch is checked out. Run it again after the hook changes, since the installed copy does not follow the file. `core.hooksPath` must stay unset, because while it is set Git runs only the hooks in that folder; the install refuses while it is set. Never set it to `scripts/git-hooks`: Git reads a relative `core.hooksPath` from the work tree of the checkout that pushes, none of the branches that hold `5d3e45e` / `3e51fc0` has the hook file, and Git runs no hook when the folder has none, so a push from a checkout of one of them would go through. The MrBayes primates alignment and the PAML HIV env and lysozyme alignments are fetched by `fetch.sh`, each from a fixed commit (below). In place of the copies the reference scripts write, the committed JSON keeps an `inputs` entry for each: the SHA-256 of the fetched file, and the SHA-256 of the alignment the reference tool read from it (one `name<TAB>sequence` line per taxon, joined with a newline). `scripts/outside-data/strip_gpl_inputs.py` replaces the copies with these entries after the `ref_*` scripts run, and first checks that each file gives exactly the alignment it removes. The tests that need these alignments read the fetched files and check both checksums before comparing. They skip, naming the file, when it is absent.

Tool versions are given only where the JSON file or `scripts/outside-data/README.md` records them. Otherwise they are not recorded: `scripts/outside-data/environment.yml` pins only `python=3.11`.

### Input sources and licences

| Input (`test-data/` folder) | Source | Licence |
| :--- | :--- | :--- |
| `uniprot/` | UniProtKB REST (`rest.uniprot.org`) | `CC BY 4.0` (UniProt Consortium) |
| `ncbi/` | NCBI Nucleotide via E-utilities | Public domain (US government data) |
| `ena/` | ENA browser API (`www.ebi.ac.uk/ena`), the same INSDC accessions as `ncbi/` | INSDC records, free and unrestricted access |
| `pfam/` | Pfam seed alignments via the InterPro API | `CC0` |
| `mrbayes/` | `github.com/NBISweden/MrBayes`, `examples/` at commit `77da419ecb2a335fb185a79c0d7d42d413562f19` (`MRBAYES_COMMIT` in `fetch.sh`); fetched, never committed (D0016) | `GPL-3.0` |
| `paml/` | `github.com/abacus-gene/paml`, `examples/` and `dat/` at commit `5ac3120e005e14dfc2b1886bf230fde85f995242` (`PAML_COMMIT`); fetched, never committed (D0016) | `GPL-3.0` |
| `pasilla/` | Bioconductor `pasilla` (Brooks et al., *Genome Res.* 2011) | `LGPL` |
| `biopython-tests/`, `biopython-abi/` | `github.com/biopython/biopython`, `Tests/` | Biopython License / `BSD-3-Clause` (`LICENSE.rst`) |
| `synthego-ice/` | `github.com/synthego-open/ice`, `ice/tests/test_data` | Synthego ICE licence: educational, research and non-profit use (`LICENSE`) |
| `rcsb/` | RCSB PDB (`files.rcsb.org`, `data.rcsb.org`, `search.rcsb.org`) | `CC0` |
| ExPASy ProtParam | `web.expasy.org/protparam`, queried online by `ref_seqtools.py`; the pages are cached in `test-data/expasy/` and not committed | ExPASy terms of use (SIB Swiss Institute of Bioinformatics) |

### Derived data sets

| Committed file | Generating script | Reference tools (versions where recorded) | Inputs | Embedded input data |
| :--- | :--- | :--- | :--- | :--- |
| `test-data/reference/align.json` | `ref_align.py` | Biopython `PairwiseAligner`, MAFFT, MUSCLE, Clustal Omega | `uniprot/`, `ncbi/` pairs; 26 `pfam/` seeds; `mrbayes/primates.nex` | Pairwise input sequences; the Pfam seeds, as reference and unaligned. Not the MrBayes primate alignment: only the SHA-256 of `mrbayes/primates.nex` and of its rows |
| `test-data/reference/deseq2_pasilla.json` | `ref_expression.py` | PyDESeq2 | `pasilla/` gene counts and sample annotation | Sample names and conditions, gene identifiers |
| `test-data/reference/deseq2_R_pasilla.json` | `ref_deseq2.R` | Bioconductor DESeq2 (R) | `pasilla/` gene counts | Gene identifiers |
| `test-data/reference/formats_bp.json` | `ref_formats_bp.py` | Biopython (`AlignIO`, `SeqIO`), samtools | `biopython-tests/` (Clustal, PHYLIP, Stockholm, NEXUS, GenBank, EMBL, FASTQ, SAM/BAM, FASTA); `test-data/sim/phix.bam` | Parsed records and alignments of the Biopython test files |
| `test-data/reference/formats.json` | `ref_formats.py` | Biopython, BWA, samtools, bcftools | `ncbi/` GenBank and GFF3, `ena/` EMBL, `biopython-abi/` and `synthego-ice/` AB1 traces, `rcsb/` PDB and mmCIF, `test-data/sim/` | Parsed sequences and features of the GenBank, EMBL and FASTQ records |
| `test-data/reference/ice.json` | `ref_ice.py` | Synthego ICE 1.2 (Python 3.9, biopython 1.78, numpy 1.21, pandas 1.3) | `synthego-ice/` control and edited traces, with the guides and donors of ICE's own tests | Guide and donor sequences |
| `test-data/reference/ngs.json` | `ref_ngs.py` | wgsim, BWA-MEM, samtools, bcftools, SPAdes | `ncbi/NC_001422` (phiX174), `ncbi/J02459` (lambda) | None beyond our own simulation truth, calls and SPAdes contigs |
| `test-data/reference/phylo_r.json` | `ref_phylo.R` | R `ape`, `phangorn`, `pegas` | `mrbayes/primates.nex` | None: the SHA-256 of `mrbayes/primates.nex` and of the alignment ape read from it |
| `test-data/reference/phylo_tools.json` | `ref_phylo_tools.py` | IQ-TREE, PAML `yn00` | The primates alignment (as `ref_phylo.R` read it) and NJ tree in `phylo_r.json`; `paml/HIVenvSweden.txt`, `paml/lysozymeSmall.txt`; `pfam/PF00042` seed | 24 Pfam globin seed sequences. Not the PAML codon alignments: only the SHA-256 of each file and of the alignment `yn00` read |
| `test-data/reference/seqtools.json` | `ref_seqtools.py` | Biopython, EMBOSS `getorf`, ExPASy ProtParam (online), Primer3, ViennaRNA, pyteomics, NCBI BLAST+ | `ncbi/` genomes, `uniprot/` proteins, ExPASy ProtParam results | Input DNA and protein sequences |
| `test-data/reference/structure.json` | `ref_structure.py` | `tmtools` 0.3.0 (TM-align), Biopython 1.88 | `rcsb/` entries | TM-align alignments of the chain sequences |

All scripts are in `scripts/outside-data/`.

### Simulated reads (`test-data/sim/`)

| Files | Written by | Tools | Inputs |
| :--- | :--- | :--- | :--- |
| `phix_ref.fa`, `phix_r1.fq`, `phix_r2.fq`, the BWA index (`phix_ref.fa.amb`, `.ann`, `.bwt`, `.pac`, `.sa`), `phix_ref.fa.fai` | `ref_ngs.py` | wgsim (1,500 pairs of 150 bp, seed 11), `bwa index`; the `.fai` is written by `bcftools mpileup` | `ncbi/NC_001422` (phiX174), public domain |
| `sv_ref.fa`, `sv_reads.fa` | `ref_ngs.py` | Python `random` (seed 5): a 12 kb lambda segment with a 500 bp deletion, a 300 bp insertion and a 1 kb inversion | `ncbi/J02459` (lambda), public domain |
| `phix.sam`, `phix.vcf` | `ref_formats.py` | BWA-MEM, samtools, bcftools | The files above |
| `phix.bam` | `ref_formats_bp.py` | `samtools view -b` | `phix.sam` |
