# Product

<!-- impeccable:product-schema 1 -->

## Platform

desktop (macOS, Windows, Linux) & web (WebAssembly)

## Users

Molecular biologists, evolutionary biologists, and bioinformatics core facility staff — bench scientists and computational researchers who need a unified, offline-capable desktop workbench for the full molecular and evolutionary biology workflow: plasmid design and cloning simulation, primer and CRISPR guide design, sequence alignment and phylogenetics, Sanger chromatogram analysis and contig assembly, protein biophysics and 3D structure visualization, and guided multi-step QC pipelines. They work at the bench or desk, often air-gapped or with limited cloud access, and need publication-quality vector output.

## Product Purpose

MolBioCraft makes it possible to perform the entire molecular and evolutionary biology research workflow — from plasmid construction through phylogenetic inference to protein structure analysis — in a single native desktop application that runs fully offline, computes in compiled Rust, and exports crisp, scalable SVG for every visualization. Success means a researcher can design a cloning strategy, simulate the gel, order primers, verify the construct by Sanger sequencing, build the phylogenetic tree, and prepare publication figures without leaving the app or uploading data to a cloud service.

## Positioning

The meaningfully different mechanism is a unified full-stack Rust workbench: 7 pure-Rust bioinformatics crates (core, formats, align, phylo, cloning, protein, WASM) exposed via an embedded multi-threaded RESTful server, Tauri v2 IPC, and zero-import WebAssembly — all wrapped in a native Tauri v2 desktop shell with a React/SVG frontend. Unlike cloud-dependent platforms, single-focus plasmid editors, or monolithic commercial suites, MolBioCraft delivers cloning, phylogeny, protein, Sanger, and NGS in one offline-first desktop app with an extensible Rust crate ecosystem and a non-commercial academic license.

## Operating Context

- Desktop-first usage on macOS (Universal arm64/x86_64), Windows 10/11 (x64), and Linux (x86_64)
- Air-gapped and offline environments common in institutional research
- File formats: GenBank (.gb), FASTA (.fasta), EMBL (.embl), GFF3 (.gff3), ABI Sanger (.ab1), PDB/mmCIF, VCF/FASTQ/SAM/BED (via noodles), custom .mbc session files
- Drag-and-drop binary file ingestion, native OS file dialogs (rfd), native macOS 9-menu AppKit menu bar (muda)
- Keyboard-driven navigation: ⌘1–⌘9 studio switching, ⌘K command palette, ⌘N new sequence, ⌘O/⌘S session management
- Guided 4-step pipelines for recombinant construct QC, CRISPR knockout/HDR design, viral vector packaging, protein expression QC
- Publication workflow: every visualization renders as crisp multi-tone SVG suitable for direct figure assembly

## Capabilities and Constraints

- 11 scientific studios: Sequence Map, Annotations, Flatfile, Cloning & Gel, Vectors & Architect, Primers & CRISPR, Alignment, Phylogenetics, Sanger & Contig, Protein & 3D, Pipelines & NGS
- 10 cloning simulators (Restriction-Ligation, Gibson, In-Fusion, NEBuilder HiFi, MoClo, Golden Gate, TA/GC, TOPO, Gateway, SOE-PCR)
- REBASE enzyme database, 69-vector backbone catalog, 98-part modular vector architect, 9-rule custom vector onboarding QC
- SantaLucia/Owczarzy Tm calculation, Zuker/Nussinov MFE folding, SpCas9/LbCas12a CRISPR guide design with HDR ssODN
- Pairwise Gotoh affine (DNA/BLOSUM62), 2D k-mer synteny dotplot, MSA (MAFFT, Clustal-Omega, POA, MUSCLE), ClustalX conservation
- ML/NJ/UPGMA trees, JC69/K80/HKY85/GTR+G model selection (BIC/AICc), dN/dS (Nei-Gojobori), Tajima's D, RSCU
- 4-dye ABI chromatogram viewer with Phred quality, Mott trimming, heterozygote peak calling, POA consensus assembly
- ProtParam (MW, pI, ε280, GRAVY, instability, aliphatic), Kyte-Doolittle hydropathy, 6-frame ORF, E. coli CAI, 3D Kabsch SVD RMSD superposition
- Mol* 3D structure viewer for PDB/mmCIF (presets, colour schemes, ligands, sequence panel, Model B superposition), with its floating toolbar docked at the bottom of the view and full-window expand that stays inside the app window
- 13 built-in Bioinformatics Plugins (eukaryotic and microbial gene prediction, CRISPR arrays, tandem repeats, haplotypes, taxonomic classification, species delimitation, protein domains/epitopes, TM topology, read trimming, synteny blocks, HPC phylogeny jobs, external CLI tools), reachable from the native and in-window Tools menus, the Workflows toolbar menu and search
- Identical menu structure on the native macOS menu bar and the in-window (Windows, Linux, web) menu bar
- Persisted, exportable Preferences (default folder, default Author, default export formats per molecule type, per-studio defaults, custom shortcuts)
- Embedded RESTful API at http://127.0.0.1:18420/api/v1/* for local automation
- Non-commercial Creative Commons license (CC BY-NC 4.0, SPDX: CC-BY-NC-4.0) — no commercial use permitted

## Brand Commitments

- Name: MolBioCraft (wordmark set in Space Grotesk)
- License: Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0) — SPDX: CC-BY-NC-4.0
- Visual language: Multi-tone bioinformatics SVG iconography across all studios (plasmid maps, trees, gels, chromatograms, 3D structures)
- Typography system: Google Sans (UI controls, menus, tables, body, section/dialog headers), Space Grotesk (MolBioCraft brand wordmark, display and brand-voice headlines), Google Sans Code (nucleotide/amino-acid sequence and coordinates)
- Cross-platform native desktop packages: macOS universal .dmg (`arm64` + `x86_64`), Windows x64 `.msi` and portable `.exe`, Linux x86_64 `.deb` (built by the Tauri bundler on native runners)

## Evidence on Hand

- 7 pure-Rust crates with Cargo workspace (`crates/`) — compiled, tested, WASM-targeted
- Tauri v2 native runtime (`src-tauri/`) with 9-menu OS bar, rfd dialogs, embedded RESTful server
- React 18 + TypeScript + Vite frontend (`src/`) with 11 studio implementations and a shared right-hand inspector
- Custom multi-tone SVG component library for all visualization types
- Embedded font assets (subset WOFF2 in `src/assets/fonts`): Google Sans, Space Grotesk, and Google Sans Code
- Packaging metadata for all 3 platforms (`packaging/`)
- Universal macOS `.app` and `.dmg` installer builder (`scripts/build_installers.sh`) and native 3-OS release workflow (`.github/workflows/release.yml`)
- CI/CD pipelines for test, build, and release (`.github/workflows/`)
- Version 1.0.0 with local universal macOS build output in `release/`
- No fabricated testimonials, benchmarks, or commercial deployment claims

## Product Principles

1. **Offline-first, compute-local** — No cloud dependency; all computation runs in compiled Rust on the user's machine
2. **Unified depth over fragmented breadth** — One workbench spans cloning through phylogeny to protein structure, not a collection of shallow tools
3. **Vector-native output** — Every visualization is crisp, scalable SVG suitable for direct publication use
4. **Extensible Rust core** — The 7-crate workspace and REST/WASM/IPC interfaces enable scripting, automation, and third-party extension
5. **Respect the researcher's environment** — Native OS integration, keyboard-first navigation, air-gapped operation, non-commercial licensing aligned with academic values

## Accessibility & Inclusion

- Keyboard-first navigation with full shortcut coverage (⌘1–⌘9, ⌘K, ⌘F, ⌘N, ⌘O, ⌘S, ⌘I, ⇧⌘R, ⌘B, ⌥⌘I, ⌘,)
- High-contrast multi-tone SVG palettes (Standard and Okabe-Ito colorblind-safe)
- Scalable vector output maintains legibility at any zoom level
- Screen-reader accessible React components with semantic HTML structure
- WCAG 2.2 AA contrast floor (4.5:1 text contrast in light and night themes, 11px minimum UI font size, 24px minimum control target)