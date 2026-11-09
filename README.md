<div align="center">
  <img src="packaging/logo.svg" alt="MolBioCraft Plasmid Vector + DNA + Protein Helix Logo" width="128" height="128" />
  <h1>MolBioCraft</h1>
  <p><strong>Molecular &amp; Evolutionary Biology Workbench</strong></p>

  <p>
    <a href="https://github.com/manbaritone/MolBioCraft/actions/workflows/ci.yml">
      <img src="https://github.com/manbaritone/MolBioCraft/actions/workflows/ci.yml/badge.svg" alt="CI Status" />
    </a>
    <a href="https://github.com/manbaritone/MolBioCraft/actions/workflows/release.yml">
      <img src="https://github.com/manbaritone/MolBioCraft/actions/workflows/release.yml/badge.svg" alt="Build and Release" />
    </a>
    <a href="https://github.com/manbaritone/MolBioCraft/releases">
      <img src="https://img.shields.io/badge/version-1.0.0-0284c7.svg" alt="Version 1.0.0" />
    </a>
    <img src="https://img.shields.io/badge/platform-macOS%20(Universal)%20%7C%20Windows%20(x64)%20%7C%20Linux%20(x86__64)-475569.svg" alt="Platform: macOS | Windows | Linux" />
    <img src="https://img.shields.io/badge/works-100%25%20offline-15803d.svg" alt="Works 100% offline" />
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-d97706.svg" alt="License: CC BY-NC 4.0 (Creative Commons Attribution-NonCommercial 4.0 International)" />
    </a>
  </p>

  <p>
    <a href="https://www.buymeacoffee.com/8zwp8mftb9u"><img src="https://img.buymeacoffee.com/button-api/?text=Buy me an iced cocoa&emoji=☕&slug=8zwp8mftb9u&button_colour=FFDD00&font_colour=000000&font_family=Poppins&outline_colour=000000&coffee_colour=ffffff" alt="Buy me an iced cocoa" /></a>
  </p>

</div>


## Overview

**MolBioCraft** is a free, non-commercial research workbench for bench and computational biologists. It brings the everyday tasks of a molecular biology lab — plasmid maps, restriction digests, cloning simulations, primer design, CRISPR, sequence alignment, phylogenetics, Sanger trace review, protein biophysics and 3D structure — into one window, with every result drawn as a publication-ready figure.

- **Offline and private** — all analysis runs on your computer. Nothing is uploaded; the app works on air-gapped machines.
- **One workspace, many tools** — open GenBank, FASTA, EMBL, GFF3, ABI traces, PDB/mmCIF, VCF, FASTQ, SAM and BED files side by side and move results between studios.
- **Scientifically traceable** — every algorithm cites its source method (SantaLucia Tm, Gotoh alignment, Felsenstein likelihood, Kabsch superposition, Mott trimming…); see [`PROVENANCE.md`](./PROVENANCE.md).
- **Figures you can publish** — maps, gels, trees, chromatograms, alignments and dotplots export as SVG, PNG or PDF.
- **Cross-platform** — one app for macOS (Apple Silicon and Intel), Windows 10/11 and Linux.


## What You Can Do

| Research task | What MolBioCraft gives you |
| :--- | :--- |
| **View and annotate a plasmid or genome** | Interactive circular map and linear sequence view side by side, feature arcs, restriction sites, ORFs, GC ring, 3-frame translation, inline feature editing and automatic detection of common plasmid features. |
| **Plan a restriction digest** | REBASE enzyme sets (unique, dual, commercial or custom cutters), non-cutter lists, Dam/Dcm/CpG methylation blocking, fragment tables and a virtual agarose gel with standard ladders. |
| **Simulate cloning** | Restriction-ligation, Gibson, NEBuilder-style HiFi, In-Fusion, Golden Gate / MoClo parts, LIC, SLIC, SLiCE, yeast homologous recombination, TA/GC, TOPO (blunt and directional), Gateway BP/LR, annealed oligos and SOE-PCR — then validate the clone. |
| **Design vectors** | 69-backbone vector catalog, 98-part modular vector architect and a 9-rule onboarding QC check for custom vectors. |
| **Design primers and mutations** | SantaLucia + Owczarzy salt-corrected Tm, hairpin and dimer folding, flanking PCR primer design, multiplex and diagnostic primer sets, a primer library, point and site-directed mutagenesis. |
| **Design CRISPR edits** | SpCas9 and LbCas12a guide finding and ranking, cloning oligos, silent-PAM HDR ssODN donors and genotyping primers. |
| **Align sequences** | Pairwise global/local alignment (DNA scoring or BLOSUM62/PAM250) with editable scores, dotplots, multiple sequence alignment with conservation colouring, consensus building and BLAST-style search. |
| **Build and test phylogenies** | Neighbor-Joining, UPGMA and maximum-likelihood trees, JC69/K80/HKY85/GTR+Γ model ranking by BIC/AICc, dN/dS, Tajima's D, RSCU, molecular clock tools; rectangular, cladogram and radial tree views. |
| **Review Sanger sequencing** | 4-dye ABI `.ab1` / `.scf` chromatograms with Phred quality, Mott trimming, mixed-peak (heterozygote) calling and multi-read consensus contig assembly with variant calls. |
| **Characterise proteins** | ProtParam biophysics (MW, pI, ε280, GRAVY, instability, aliphatic index), hydropathy plots, coiled-coil and transmembrane prediction, antigenic epitopes, back-translation and multi-host codon optimisation. |
| **Explore 3D structures** | Interactive Mol* 3D viewer for PDB/mmCIF files with representation presets, colour schemes, ligands, file-declared secondary structure, sequence-to-structure highlighting, a Ramachandran plot, Kabsch Cα superposition with RMSD/TM-score, and structure-based chain alignment. |
| **Work with NGS and genomes** | VCF/FASTQ/SAM/BED inspectors, read trimming and mapping, whole-genome synteny, gene and CpG-island prediction, repeat scans and GenBank submission prep. |
| **Run reproducible QC** | Guided multi-step pipelines that produce a report for construct QC, CRISPR knockouts, viral vector packaging and protein expression. |
| **Automate locally** | A local REST API (`127.0.0.1:18420/api/v1`) exposes the analysis engine to scripts on the same machine. |


## Scientific Studios

Each studio is a tab in the main window; the right-hand **Inspector** (`⌥⌘I` / `Ctrl+Alt+I`) holds the settings for whichever studio is open.

1. **Sequence Map (`⌘1`)** — Circular plasmid map and linear sequence view side by side under one zoom, with restriction sites, ORFs, primers, translation, GC and hydropathy tracks, and a construct summary bar (length, GC, Tm, ORF status).
2. **Annotations (`⌘2`)** — Sortable, filterable feature and primer table with one-click selection and GFF3 export.
3. **Flatfile (`⌘3`)** — Live GenBank, FASTA, EMBL and GFF3 text of the open record.
4. **Cloning & Gel (`⌘4`)** — All cloning simulators, a co-digest buffer planner and a darkroom-style virtual agarose gel that stays beside its controls.
5. **Vectors & Architect (`⌘5`)** — Vector catalog, modular part assembly and custom-vector QC.
6. **Primers & CRISPR (`⌘6`)** — Oligo analysis, PCR design, mutagenesis and CRISPR guide/donor design.
7. **Alignment (`⌘7`)** — Pairwise, dotplot and multiple alignment, with distance matrices, length graphs, virtual gels and alignment-image export.
8. **Phylogenetics (`⌘8`)** — Tree building, model selection and molecular-evolution statistics, with the tree kept in view.
9. **Sanger & Contig (`⌘9`)** — Chromatogram review, trimming and contig assembly.
10. **Genomics & 3D Structure** — NGS assembly, genome variants, gene/CpG/repeat prediction, coiled-coils, transmembrane topology and the Mol* 3D structure viewer.
11. **Protein, Plugins & History** — Protein biophysics and codon tools, the Bioinformatics Plugins runner, and an undoable history/lineage of every operation.

### 3D Structure Viewer (Mol*)

- Load any PDB or mmCIF file; the structure opens on its 3D view first.
- Choose a preset (Polymer & Hetero, Cartoon, Atomic Detail, Molecular Surface, Spacefill…), style and colour scheme (secondary structure, pLDDT/B-factor, hydropathy, chain, rainbow).
- Show or hide the sequence panel, ligands, a second superposed model and Cα contacts; spin, reset and export PNG.
- The viewer's floating toolbar sits at the **bottom** of the view — reset zoom, screenshot, controls panel, expand to full window, settings and selection mode — and its menus open upward so they never leave the window. Press the expand button again or `Esc` to leave full-window view.


## Bioinformatics Plugins

Thirteen built-in analysis plugins, available from **Tools › Bioinformatics Plugins**, the toolbar's **Workflows ▾** menu and the search bar (`⌘K`). Each runs locally on the open record and cites its method in `PROVENANCE.md`.

| Plugin | What it does |
| :--- | :--- |
| **Eukaryotic Gene Predictor** | Spliced gene models from GT-AG splice junctions, Kozak starts and in-frame exon chaining. |
| **Microbial Gene Predictor** | Prokaryotic/viral 6-frame coding prediction with Shine-Dalgarno ribosome-binding sites. |
| **CRISPR Repeat Array Finder** | Direct-repeat and spacer arrays in bacterial and archaeal genomes. |
| **Microsatellite & Tandem Repeats** | 1–6 bp short tandem repeat (STR/SSR) tracts with copy number and purity. |
| **Haplotype & Allele Partitioner** | Haplotype groups, haplotype diversity, segregating sites and Shannon entropy. |
| **Taxonomic Sequence Classifier** | Assigns a lineage from oligonucleotide k-mer signatures, dinucleotide odds ratios and barcode motifs. |
| **Species Delimitation** | Clade distinctiveness, reciprocal monophyly and barcoding-gap analysis. |
| **Protein Domains & Epitopes** | Conserved motifs (P-loop, zinc fingers, EF-hand, kinase loop…), secondary-structure propensity and B-cell epitopes. |
| **Transmembrane & Signal Topology** | Hydropathy-window TM helices, positive-inside orientation and signal-peptide cleavage. |
| **Adapter & Quality Read Trimmer** | Illumina, Nextera, Nanopore and PacBio adapter removal with quality trimming. |
| **Whole-Genome Synteny Blocks** | Collinear synteny blocks between two genomes. |
| **HPC Phylogeny Job Builder** | Ready-to-submit cluster job scripts for large tree searches. |
| **External CLI Suite** | Runs MAFFT, Clustal Omega, Minimap2, Bowtie2, IQ-TREE 2, RAxML-NG, FastTree, PhyML, MrBayes, SPAdes, Flye and others when they are installed. |


## Guided Pipelines

1. **Recombinant Construct, Cloning, Primer & Strain QC** — GC and homopolymer scan, reading-frame check, unique cutters with Dam/Dcm audit, colony-PCR primers and diagnostic gel bands.
2. **CRISPR-Cas9 / Cas12a Knockout & Silent-PAM HDR Donor** — Early-exon target window, guide ranking, cloning oligos, 120-nt silent-PAM donor and genotyping primers.
3. **Viral Vector (AAV / Lentivirus) Packaging & Synthesis Gate** — Cargo-size budgets, synthesis onboarding rules and cassette orientation checks.
4. **Protein Biophysics & Soluble Expression QC** — Solubility and pI profile, multi-host codon adaptation, 5′ mRNA folding and tag/protease-site audit.


## Preferences You Control

Open **Preferences** with `⌘,` / `Ctrl+,`. Every setting is saved, applied straight away, can be exported to a `.mbcprefs.json` file and restored with **Reset All Preferences**.

- **General** — window behaviour, icon style, background swatch, default font size and default *E. coli* strain.
- **Files & Tabs** — default folder for opening and saving files, default **Author** written into new files, tab restore, history depth and file-extension display.
- **Export** — default export format for DNA, RNA, protein and alignments, LOCUS naming rules and feature qualifiers.
- **DNA, RNA, Proteins, Agarose Gels, Traces & Alignment, Enzymes, Primers** — display and analysis defaults for each studio.
- **Keyboard** — assign your own shortcuts to menu commands.


## Downloads &amp; Installation

Each release on [GitHub Releases](https://github.com/manbaritone/MolBioCraft/releases) offers four downloads, each built by the Tauri bundler on its own operating system (`<version>` is the release number, for example `1.0.0`):

| Platform | Download | Architecture | What it is |
| :--- | :--- | :--- | :--- |
| **macOS (Universal)** | `MolBioCraft-<version>-macOS-universal.dmg` | Apple Silicon (`arm64`) + Intel (`x86_64`) | Disk image holding `MolBioCraft.app`; drag it to Applications. macOS 11 or later. |
| **Windows x64 (MSI)** | `MolBioCraft-<version>-Windows-x64.msi` | `x86_64` (Windows 10/11) | Windows Installer package, installed to `C:\Program Files\MolBioCraft` (`msiexec /i` for managed deployment). |
| **Windows x64 (Portable)** | `MolBioCraft-<version>-Windows-x64-Portable.exe` | `x86_64` (Windows 10/11) | The app as one executable: run it from any folder, nothing is installed. |
| **Linux (Debian/Ubuntu)** | `MolBioCraft-<version>-Linux-x86_64.deb` | `x86_64` / `amd64` | Debian package for Ubuntu 22.04 or later and Debian 12 or later. |

Beside them each release publishes `SHA256SUMS.txt` (check a download with `sha256sum --check --ignore-missing SHA256SUMS.txt`), `NOTICE.txt` (the third-party notices) and `PROVENANCE.md` (where the bundled data comes from). The installers also carry both files: in the app's `Contents/Resources` on macOS, in the install folder on Windows, and in `/usr/share/doc/molbiocraft/` on Linux.

### First launch of an unsigned build

The builds are not yet signed by Apple or Microsoft (the macOS app carries only an ad-hoc signature), so each system asks once before it opens MolBioCraft:

- **macOS:** open the `.dmg` (a light-blue welcome window shows the app and an Applications shortcut), accept the licence, and drag `MolBioCraft.app` to Applications. The first time, Control-click the app and choose **Open**, then **Open** again in the dialog. On macOS 15 or later, if no Open button is offered, choose **Open Anyway** in System Settings › Privacy &amp; Security after the first attempt. Or clear the download quarantine in Terminal: `xattr -dr com.apple.quarantine /Applications/MolBioCraft.app`
- **Windows:** when Microsoft Defender SmartScreen says "Windows protected your PC", click **More info**, then **Run anyway**. This applies to the MSI and to the Portable EXE. The Portable EXE needs the Microsoft Edge WebView2 runtime, which Windows 10 and 11 include; the MSI downloads and installs it if it is missing.
- **Linux:** install the package with its dependencies (WebKitGTK 4.1, GTK 3):

  ```bash
  sudo apt install ./MolBioCraft-<version>-Linux-x86_64.deb
  ```

  then start **MolBioCraft** from the applications menu.

### Supported file formats

| Kind | Formats |
| :--- | :--- |
| Sequences & annotations | GenBank (`.gb`, `.gbk`), FASTA (`.fasta`, `.fa`, `.fna`, `.faa`), EMBL, GFF3 |
| Sanger traces | ABI (`.ab1`), SCF (`.scf`) |
| Alignments & trees | Clustal, FASTA, PHYLIP, NEXUS, Newick |
| Structures | PDB, mmCIF |
| NGS | VCF, FASTQ, SAM, BED |
| Sessions | MolBioCraft workbench sessions (`.mbc`) |


## Keyboard Shortcuts

| Action | macOS | Windows &amp; Linux |
| :--- | :--- | :--- |
| **Quick Command Navigator** | `⌘K` | `Ctrl+K` |
| **Find in Sequence / Search Tools** | `⌘F` / `⇧⌘F` | `Ctrl+F` / `Ctrl+Shift+F` |
| **New DNA / RNA / Protein Sequence** | `⌘N` | `Ctrl+N` |
| **Open `.mbc` Workbench Session** | `⌘O` | `Ctrl+O` |
| **Save / Save As `.mbc` Session** | `⌘S` / `⇧⌘S` | `Ctrl+S` / `Ctrl+Shift+S` |
| **Import Sequence Files / Raw Clipboard** | `⌘I` / `⇧⌘I` | `Ctrl+I` / `Ctrl+Shift+I` |
| **Clone Insert into Vector** | `⇧⌘C` | `Ctrl+Shift+C` |
| **Reverse Complement Active Construct** | `⇧⌘R` | `Ctrl+Shift+R` |
| **Toggle Left Project Explorer** | `⌘B` | `Ctrl+B` |
| **Toggle Right Inspector Panel** | `⌥⌘I` | `Ctrl+Alt+I` |
| **Switch Scientific Studios (`1`–`9`)** | `⌘1` … `⌘9` | `Ctrl+1` … `Ctrl+9` |
| **Open Preferences** | `⌘,` | `Ctrl+,` |

On macOS the commands live in the native menu bar; on Windows, Linux and the web build the same menus appear inside the window, with identical names and structure.


## Under the Hood &amp; Building from Source

MolBioCraft's analysis engine is written in Rust (seven crates: core, formats, align, phylo, cloning, protein and a WebAssembly bridge) and runs inside a Tauri v2 desktop shell with a TypeScript/React interface. 3D structures are rendered with [Mol*](https://molstar.org). Contributor details live in [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`DESIGN.md`](./DESIGN.md) and [`AGENTS.md`](./AGENTS.md).

**Prerequisites:** Rust (stable, with the `wasm32-unknown-unknown` target), Node.js 20 or later and npm. To build the macOS universal installer also add `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

```bash
git clone https://github.com/manbaritone/MolBioCraft.git
cd MolBioCraft
npm install

npm run wasm:build          # build the analysis engine for the interface
npm run dev                 # run the interface in a browser
npm test                    # interface tests
cargo test --workspace      # engine tests
cargo test --manifest-path src-tauri/Cargo.toml   # desktop shell tests

npm run package:installers  # macOS: universal MolBioCraft.app + release/MolBioCraft-<version>-macOS-universal.dmg
npm run build:standalone    # single offline HTML file: dist/molbiocraft-standalone.html
```

The Windows `.msi` and portable `.exe` and the Linux `.deb` are built by `.github/workflows/release.yml` on its `windows-latest` and `ubuntu-22.04` runners, since the Tauri bundler builds each only on its own operating system. Running that workflow by hand (workflow_dispatch) uploads all four installers as workflow artifacts without publishing a release.


## License (CC BY-NC 4.0)

Copyright © 2026 Bundit Boonyarit (`@manbaritone`) and MolBioCraft Contributors.  
**SPDX-License-Identifier**: `CC-BY-NC-4.0`

MolBioCraft is distributed under the **Creative Commons Attribution-NonCommercial 4.0 International Public License (CC BY-NC 4.0)** — see [`LICENSE`](./LICENSE) for the full legal terms, or open **`MolBioCraft → About MolBioCraft`** inside the application. Third-party components (including Mol*, MIT) and bundled fonts are listed in [`NOTICE`](./NOTICE); data and method sources are in [`PROVENANCE.md`](./PROVENANCE.md).


## Citation

```
@software{Boonyarit_MolBioCraft,
author = {{Bundit Boonyarit}},
license = {CC-BY-NC-4.0},
month = oct,
title = {{MolBioCraft: A cross-platform bioinformatics workbench for sequence analysis in molecular biology and evolutionary biology research}},
url = {https://github.com/manbaritone/MolBioCraft},
version = {1.0.0},
year = {2026}
}
```