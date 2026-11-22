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
      <img src="https://img.shields.io/badge/version-1.1.0-0284c7.svg" alt="Version 1.1.0" />
    </a>
    <img src="https://img.shields.io/badge/platform-macOS%20(Universal)%20%7C%20Windows%20(x64)%20%7C%20Linux%20(x86__64)-475569.svg" alt="Platform: macOS | Windows | Linux" />
    <img src="https://img.shields.io/badge/works-100%25%20offline-15803d.svg" alt="Works 100% offline" />
    <a href="LICENSE">
      <img src="https://img.shields.io/badge/license-CC%20BY--NC%204.0-d97706.svg" alt="License: CC BY-NC 4.0 (Creative Commons Attribution-NonCommercial 4.0 International)" />
    </a>
  </p>

  <p>
    <a href="https://www.buymeacoffee.com/8zwp8mftb9u"><img src="https://img.buymeacoffee.com/button-api/?text=Buy%20me%20an%20iced%20cocoa&amp;emoji=%E2%98%95&amp;slug=8zwp8mftb9u&amp;button_colour=FFDD00&amp;font_colour=000000&amp;font_family=Poppins&amp;outline_colour=000000&amp;coffee_colour=ffffff" alt="Buy me an iced cocoa" /></a>
  </p>

</div>

**Contents:** [Overview](#overview) · [What's New in 1.1.0](#whats-new-in-110) · [What You Can Do](#what-you-can-do) · [Scientific Studios](#scientific-studios) · [Bioinformatics Plugins](#bioinformatics-plugins) · [Guided Pipelines](#guided-pipelines) · [Preferences](#preferences-you-control) · [Downloads & Installation](#downloads--installation) · [Keyboard Shortcuts](#keyboard-shortcuts) · [Building from Source](#under-the-hood--building-from-source) · [License](#license-cc-by-nc-40) · [Citation](#citation)


## Overview

**MolBioCraft** is a free, non-commercial research workbench for bench and computational biologists. It brings the everyday tasks of a molecular biology lab — plasmid maps, restriction digests, cloning simulations, primer design, CRISPR, sequence alignment, phylogenetics, Sanger trace review, protein biophysics and 3D structure — into one window, with every result drawn as a publication-ready figure.

- **Offline and private** — all analysis runs on your computer. Nothing is uploaded; the app works on air-gapped machines.
- **One workspace, many tools** — open GenBank, FASTA, EMBL, GFF3, ABI traces, PDB/mmCIF, VCF, FASTQ, SAM and BED files side by side and move results between studios.
- **Scientifically traceable** — every algorithm cites its source method (SantaLucia Tm, Gotoh alignment, Felsenstein likelihood, Kabsch superposition, Mott trimming…); see [`PROVENANCE.md`](./PROVENANCE.md).
- **Figures you can publish** — maps, gels, trees, chromatograms, alignments and dotplots export as SVG, PNG or PDF.
- **Cross-platform** — one app for macOS (Apple Silicon and Intel), Windows 10/11 and Linux.


## What's New in 1.1.0

Released 2026-11-22. The highlights:

- **Protein & 3D is its own studio** — ProtParam (now with the instability index), hydropathy, GOR, antigenicity, the MS digest and PTMs, coiled-coil and transmembrane prediction, and the 3D viewer with superposition and a Ramachandran plot, all in one studio.
- **Convert GenBank…** — File › Export Sequences › Convert GenBank… turns a GenBank file (gzipped or not) or the open records into `.fna`, CDS DNA, CDS protein, function tables and more, computed in the app's own engine with no Python needed.
- **The sequence superposition's TM-score is the TM-score** — superposition and Align Structures by sequence now report a per-chain Zhang-Skolnick TM-score instead of an approximate TM≈.
- **Ramachandran regions follow the Top8000 grids themselves** — each residue is classified by bilinear interpolation of its class's Top8000 2-degree grid at MolProbity's cutoffs, instead of from 10-degree cells.
- **A studio rail that never drops a studio** — the eleven studios, then History and Info, sit in a fixed rail. A studio the open document cannot use stays listed, greyed, with the reason in its tooltip.
- **Number keys open the studios, and ⌘S saves the session** — `⌘1`–`⌘9` (`Ctrl+1`–`Ctrl+9` on Windows and Linux) open the first nine studios in rail order.
- **One command list behind the menu bar, the toolbar and ⌘K** — every command has the same name, menu path and shortcut wherever it appears.
- **The Mac menu bar is the window's menu bar** — the macOS menu bar has the same menus, in the same order, as the in-window menus on Windows and Linux.
- **Databases open in the main pane** — the Database Explorer replaces the document view instead of opening as a dialog, and Back (`⌘[`) returns to your document.
- **The desktop app opens no network port** — the embedded REST API on `127.0.0.1:18420` is gone. The interface reaches the engine only through Tauri IPC and WebAssembly, so scripts that called that API have no endpoint any more.
- **Linux file dialogs need no desktop portal** — open and save dialogs use GTK's own file chooser, so they work without `xdg-desktop-portal` or `zenity`.

The `.mbc` session file format did not change, so sessions saved by the first release still open in 1.1.0. Every change is listed in the [full 1.1.0 release notes](CHANGELOG.md#110---2026-11-22).


## What You Can Do

| Research task | What MolBioCraft gives you |
| :--- | :--- |
| **View and annotate a plasmid or genome** | Interactive circular map and linear sequence view side by side, feature arcs, restriction sites, ORFs, GC ring, 3-frame translation, inline feature editing and automatic detection of common plasmid features. |
| **Plan a restriction digest** | REBASE enzyme sets (unique, dual, commercial or custom cutters), non-cutter lists, Dam/Dcm/CpG methylation blocking, fragment tables and a virtual agarose gel with standard ladders. |
| **Simulate cloning** | Restriction-ligation, Gibson, NEBuilder-style HiFi, In-Fusion, Golden Gate / MoClo parts, LIC, SLIC, SLiCE, yeast homologous recombination, TA/GC, TOPO (blunt and directional), Gateway BP/LR, annealed oligos and SOE-PCR — then validate the clone. |
| **Design vectors** | 69-backbone vector catalog, 98-part modular vector architect and a 9-rule onboarding QC check for custom vectors. |
| **Design primers and mutations** | SantaLucia (1998) nearest-neighbour, von Ahsen (2001) Mg2+ equivalence (Primer3 default) Tm, hairpin and dimer folding, flanking PCR primer design, multiplex and diagnostic primer sets, a primer library, point and site-directed mutagenesis. |
| **Design CRISPR edits** | SpCas9 and LbCas12a guide finding and ranking, cloning oligos, silent-PAM HDR ssODN donors and genotyping primers. |
| **Align sequences** | Pairwise global/local alignment (DNA scoring or BLOSUM62/PAM250) with editable scores, dotplots, multiple sequence alignment with conservation colouring, consensus building and BLAST-style search. |
| **Build and test phylogenies** | Neighbor-Joining, UPGMA and maximum-likelihood trees, JC69/K80/HKY85/GTR+Γ model ranking by BIC/AICc, dN/dS, Tajima's D, RSCU, molecular clock tools; rectangular, cladogram and radial tree views. |
| **Review Sanger sequencing** | 4-dye ABI `.ab1` / `.scf` chromatograms with Phred quality, Mott trimming, mixed-peak (heterozygote) calling and multi-read consensus contig assembly with variant calls. |
| **Characterise proteins** | ProtParam biophysics (MW, pI, ε280, GRAVY, instability, aliphatic index), hydropathy plots, coiled-coil and transmembrane prediction, antigenic epitopes, back-translation and multi-host codon optimisation. |
| **Explore 3D structures** | Interactive Mol* 3D viewer for PDB/mmCIF files with representation presets, colour schemes, ligands, file-declared secondary structure, sequence-to-structure highlighting, a Ramachandran plot, Kabsch Cα superposition with RMSD/TM-score, and structure-based chain alignment. |
| **Work with NGS and genomes** | VCF/FASTQ/SAM/BED inspectors, read trimming and mapping, whole-genome synteny, gene and CpG-island prediction, repeat scans and GenBank submission prep. |
| **Run reproducible QC** | Guided multi-step pipelines that produce a report for construct QC, CRISPR knockouts, viral vector packaging and protein expression. |


## Scientific Studios

Each studio is a tab in the main window, named here by its one name in the studio registry (`src/core/studioRegistry.ts`), the name its tab, ⌘K, the search box and the Help panel all show; a tab shows only for the records it applies to. The right-hand **Inspector** (`⌥⌘I` / `Ctrl+Alt+I`) holds the settings for whichever studio is open.

1. **Sequence Map** — Circular plasmid map and linear sequence view side by side under one zoom, with restriction sites, ORFs, primers, translation, GC and hydropathy tracks, and a construct summary bar (length, GC, Tm, ORF status).
2. **Annotations** — Sortable, filterable feature and primer table with one-click selection and GFF3 export; the tab shows the record's feature and primer count beside its name.
3. **Flatfile** — Read-only GenBank, FASTA, EMBL and GFF3 text of the open record. For a text document, tree or structure it shows the source it was read from.
4. **Cloning & Gel** — All cloning simulators, a co-digest buffer planner and a darkroom-style virtual agarose gel that stays beside its controls.
5. **Vectors & Architect** — Vector catalog, modular part assembly and custom-vector QC.
6. **Primers & CRISPR** — Oligo analysis, PCR design, mutagenesis and CRISPR guide/donor design.
7. **Alignment** — Pairwise, dotplot and multiple alignment, with distance matrices, length graphs, virtual gels and alignment-image export, for an aligned or unaligned set and for an assembled contig.
8. **Phylogenetics** — Tree building (opening on Neighbor-Joining, with UPGMA and a maximum-likelihood search), model selection and molecular-evolution statistics, with the tree kept in view.
9. **Sanger & Contig** — Sanger chromatogram review, trimming and contig assembly, for trace records.
10. **Protein & 3D** — The protein studio: ProtParam biophysics, Kyte-Doolittle hydropathy, GOR secondary structure, antigenicity, the MS digest and PTMs, coiled-coil and transmembrane prediction, and the Mol* 3D structure viewer with superposition and a Ramachandran plot, for proteins and structures.
11. **Pipelines & NGS** — The guided multi-step QC pipelines below and, for a DNA record, NGS assembly, genome variants, gene/CpG/repeat prediction and submission prep.

Two document panels sit beside the studios: **History** (provenance only: the history tree and lineage graph of every operation, which you can export) and **Info** (the record's name, dates and other details, and for a DNA sequence its sequence alerts and host strain). The panels History once held have their own hosts: protein tools in Protein & 3D, the Enzymes view in Sequence Map and Cloning & Gel (an Enzyme Set opens Cloning & Gel on it), folding in Sequence Map for an RNA and in Primers & CRISPR for a DNA, the workflow plugin runner in Pipelines & NGS, and the genetic-code tables in the Sequence Map inspector.

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
- **Keyboard** — lists every menu shortcut by its menu path (menu shortcuts are fixed), and sets the options-window shortcuts.


## Downloads &amp; Installation

Each release on [GitHub Releases](https://github.com/manbaritone/MolBioCraft/releases) offers four downloads, each built by the Tauri bundler on its own operating system (`<version>` is the release number, for example `1.1.0`):

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

The search box at the top of the window opens the command palette (`⌘K` / `Ctrl+K`) with what you type. For this release `⇧⌘F` / `Ctrl+Shift+F` also opens the palette as a second key; it will be removed in a later release.

| Menu path | macOS | Windows &amp; Linux |
| :--- | :--- | :--- |
| **Command Palette** | `⌘K` | `Ctrl+K` |
| **Edit > Find & Navigate > Find in Sequence** | `⌘F` | `Ctrl+F` |
| **File > New Session > Sequences & Vectors > New Sequence** | `⌘N` | `Ctrl+N` |
| **File > New Session > Blank Session** | `⌥⌘N` | `Ctrl+Alt+N` |
| **File > Open Session > Open Session** | `⌘O` | `Ctrl+O` |
| **File > Save Session > Save Session** | `⌘S` | `Ctrl+S` |
| **File > Save Session > Save Session As** | `⌥⇧⌘S` | `Ctrl+Alt+Shift+S` |
| **File > Export Sequences > Export GenBank** | `⇧⌘E` | `Ctrl+Shift+E` |
| **File > Export Sequences > Export FASTA** | `⇧⌘S` | `Ctrl+Shift+S` |
| **File > New Session > Starter & Import > Import Files** | `⌘I` | `Ctrl+I` |
| **File > New Session > Starter & Import > From Clipboard** | `⇧⌘I` | `Ctrl+Shift+I` |
| **Edit > Undo** | `⌘Z` | `Ctrl+Z` |
| **Edit > Redo** | `⇧⌘Z` | `Ctrl+Shift+Z` |
| **Sequence > Strand > Reverse Complement** | `⇧⌘R` | `Ctrl+Shift+R` |
| **View > Panels > Inspector** | `⌥⌘I` | `Ctrl+Alt+I` |
| **View > Studios > Sequence Map** | `⌘1` | `Ctrl+1` |
| **View > Studios > Annotations** | `⌘2` | `Ctrl+2` |
| **View > Studios > Flatfile** | `⌘3` | `Ctrl+3` |
| **View > Studios > Cloning & Gel** | `⌘4` | `Ctrl+4` |
| **View > Studios > Vectors & Architect** | `⌘5` | `Ctrl+5` |
| **View > Studios > Primers & CRISPR** | `⌘6` | `Ctrl+6` |
| **View > Studios > Alignment** | `⌘7` | `Ctrl+7` |
| **View > Studios > Phylogenetics** | `⌘8` | `Ctrl+8` |
| **View > Studios > Sanger & Contig** | `⌘9` | `Ctrl+9` |
| **View > Map Layout > Split Map & Sequence** | `⌥⌘1` | `Ctrl+Alt+1` |
| **View > Map Layout > Circular Map** | `⌥⌘2` | `Ctrl+Alt+2` |
| **View > Map Layout > Linear Sequence** | `⌥⌘3` | `Ctrl+Alt+3` |
| **Tools > BLAST & Vectors > BLAST Search** | `⇧⌘B` | `Ctrl+Shift+B` |
| **Tools > Phylogenetics > Tree Reconstruction > Maximum Likelihood** | `⌥⌘T` | `Ctrl+Alt+T` |
| **MolBioCraft > Settings > Preferences** | `⌘,` | `Ctrl+,` |
| **Help > Guides > Show or Hide Help Panel** | `F1` | `F1` |

Each row is a row of **Preferences › Keyboard**, which lists the app's shortcuts, each under the menu path of the item it runs. Menu shortcuts are fixed; the options-window shortcuts are set on the same tab.

On macOS the commands live in the native menu bar; on Windows, Linux and the web build the same menus appear inside the window, with identical names and structure.


## Under the Hood &amp; Building from Source

MolBioCraft's analysis engine is written in Rust (seven crates: core, formats, align, phylo, cloning, protein and a WebAssembly bridge) and runs inside a Tauri v2 desktop shell with a TypeScript/React interface. The interface reaches the engine only through Tauri IPC and WebAssembly; the desktop app listens on no network port. 3D structures are rendered with [Mol*](https://molstar.org). Contributor details live in [`CONTRIBUTING.md`](./CONTRIBUTING.md), [`DESIGN.md`](./DESIGN.md) and [`AGENTS.md`](./AGENTS.md).

**Prerequisites:** Rust (stable, with the `wasm32-unknown-unknown` target), Node.js 20 or later and npm (CI builds on Node.js 22). To build the macOS universal installer also add `rustup target add aarch64-apple-darwin x86_64-apple-darwin`.

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

### Checking the Windows and Linux builds on a Mac

Releases come from CI. Before you push, you can compile-check both builds and package two of them locally:

- **Windows (compile check and the portable `.exe`):** run `rustup target add x86_64-pc-windows-msvc`, `brew install llvm lld` and `cargo install --locked cargo-xwin`, and put the `bin` folders of Homebrew's `llvm` and `lld` on `PATH`. Then:

  ```bash
  cargo xwin check --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
  npm run build && cargo xwin build --release --features custom-protocol --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml
  ```

  cargo-xwin downloads Microsoft's Windows SDK and C runtime, and using it accepts Microsoft's licence. The `.msi` can be built only on Windows, because the WiX toolset runs only there.
- **Linux (`.deb`):** in an `ubuntu:22.04` container for `linux/amd64` (Docker, Colima or OrbStack), install the packages the Linux job in `release.yml` installs, then Rust and Node.js 22. Copy a clean checkout into the container rather than mounting your Mac's, whose `node_modules` holds macOS-only build tools. In it, run `npm ci`, then `tauri build --target x86_64-unknown-linux-gnu --bundles deb` with the Tauri CLI version that `release.yml` pins (`TAURI_CLI`). `tauri build` runs `npm run build` itself, and the committed engine (`public/molbiocraft_wasm.wasm`) means no WebAssembly build is needed.


## License (CC BY-NC 4.0)

Copyright © 2026 Bundit Boonyarit (`@manbaritone`) and MolBioCraft Contributors.  
**SPDX-License-Identifier**: `CC-BY-NC-4.0`

MolBioCraft is distributed under the **Creative Commons Attribution-NonCommercial 4.0 International Public License (CC BY-NC 4.0)** — see [`LICENSE`](./LICENSE) for the full legal terms, or open **`MolBioCraft → About MolBioCraft`** inside the application. Third-party components (including Mol*, MIT) and bundled fonts are listed in [`NOTICE`](./NOTICE); data and method sources are in [`PROVENANCE.md`](./PROVENANCE.md).


## Citation

```
@software{Boonyarit_MolBioCraft,
author = {{Bundit Boonyarit}},
license = {CC-BY-NC-4.0},
month = nov,
title = {{MolBioCraft: A cross-platform bioinformatics workbench for sequence analysis in molecular biology and evolutionary biology research}},
url = {https://github.com/manbaritone/MolBioCraft},
version = {1.1.0},
year = {2026}
}
```