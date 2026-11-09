// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

export const MENU_FUNCTION_INFO_STORAGE_KEY = 'mbc.showMenuFunctionInfo';
export const MENU_FUNCTION_INFO_EVENT = 'mbc:menu-func-info-changed';

export function readStoredShowMenuFunctionInfo(): boolean {
  try {
    if (typeof localStorage === 'undefined' || !localStorage) return true;
    const raw = localStorage.getItem(MENU_FUNCTION_INFO_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== '0' && raw !== 'false';
  } catch {
    return true;
  }
}

export function writeStoredShowMenuFunctionInfo(enabled: boolean): void {
  try {
    if (typeof localStorage !== 'undefined' && localStorage) {
      localStorage.setItem(MENU_FUNCTION_INFO_STORAGE_KEY, enabled ? 'true' : 'false');
    }
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(
        new CustomEvent<boolean>(MENU_FUNCTION_INFO_EVENT, { detail: enabled })
      );
    }
  } catch {
    // Ignore storage errors in restricted test sandboxes
  }
}

const MENU_LABEL_DESCRIPTIONS: Record<string, string> = {
  // Alignment & Assembly
  'Multiple Alignment': 'Align a set of homologous DNA, RNA, or protein sequences such as genes',
  'MAFFT Alignment': 'Align multiple homologous sequences rapidly using iterative FFT refinement',
  'MUSCLE Alignment': 'Compute progressive log-expectation multiple sequence alignment',
  'Clustal Omega': 'Align multiple protein or nucleotide sequences using seeded HMM guide trees',
  'Multi-Engine MSA': 'Align multiple selected sequences with configurable scoring and gap penalties',
  'Sequence Alignment': 'Align homologous DNA, RNA, or protein sequences across selected records',
  'Alignment Explorer': 'Inspect conservation, consensus residues, and polymorphic columns in alignments',
  'Pairwise & Dotplot': 'Compare two sequences globally, locally, or via k-mer synteny dotplot',
  'Global (Needleman-Wunsch)': 'Align two similar-length sequences end-to-end across their entire span',
  'Local (Smith-Waterman)': 'Identify the highest-scoring conserved local region between two sequences',
  'K-mer Dotplot': 'Visualize direct repeats, inversions, and syntenic diagonals between two sequences',
  'Read Mapping & Contigs': 'Map sequencing reads to a reference template or assemble overlapping contigs',
  'Map Reads': 'Align Sanger traces or short reads against a reference sequence construct',
  'Map & Assemble': 'Map reads to a reference template or assemble overlapping fragments de novo',
  'De Novo Assembly': 'Assemble overlapping reads or amplicons into consensus contigs without a reference',
  'Sanger Contigs': 'Assemble forward and reverse capillary chromatogram reads into a verified contig',
  'Merge Reads': 'Merge overlapping forward and reverse reads with quality-weighted base calling',
  'Contig Assembly': 'Assemble overlapping sequencing reads into a quality-scored consensus sequence',
  'Genome Alignment': 'Compare large chromosomal loci, structural rearrangements, and syntenic blocks',
  'Genome Synteny': 'Detect conserved collinear gene blocks and inversions across genomic loci',
  'Genome Variants': 'Inspect SNPs, indels, and structural differences relative to a reference locus',
  'Consensus & Batch': 'Extract consensus sequences, concatenate loci, or export alignment summaries',
  'Generate Consensus': 'Derive a majority or threshold consensus sequence from aligned records',
  'Export Consensus': 'Save the computed alignment consensus sequence as a standalone FASTA file',

  // Phylogenetics & Evolution
  'Tree Reconstruction': 'Infer evolutionary trees from aligned nucleotide or protein sequences',
  'Phylogenetic Tree': 'Reconstruct evolutionary relationships with bootstrap branch support',
  'Neighbor-Joining': 'Build a fast distance-matrix phylogenetic tree from pairwise divergences',
  'UPGMA Clustering': 'Construct an ultrametric hierarchical clustering tree assuming uniform rates',
  'Minimum Evolution': 'Search for the tree topology minimizing total branch-length sum',
  'Maximum Likelihood': 'Infer the highest-likelihood evolutionary tree under explicit substitution models',
  'RAxML (Rapid ML)': 'Run rapid maximum-likelihood tree search with GTR or protein gamma models',
  'PhyML (SH-aLRT)': 'Estimate maximum-likelihood phylogeny with SH-like approximate likelihood support',
  'FastTree (Approx ML)': 'Compute fast approximate maximum-likelihood trees for large alignments',
  'Maximum Parsimony': 'Find tree topologies requiring the fewest evolutionary character changes',
  'MrBayes (MCMC)': 'Estimate posterior clade probabilities via Bayesian Markov chain Monte Carlo',
  'Substitution Models': 'Evaluate nucleotide or amino acid substitution matrices and rate heterogeneity',
  'Best Fit Models': 'Rank substitution models by AIC and BIC information criteria on the alignment',
  'Rate Matrix': 'Inspect transition/transversion ratios and instantaneous substitution rates',
  'Homogeneity Test': 'Test compositional stationarity and base-frequency homogeneity across taxa',
  'Codon Usage & Data': 'Analyze base composition, codon bias, and informative alignment sites',
  'Codon Composition': 'Summarize positional base frequencies and GC content at 1st, 2nd, and 3rd codon sites',
  'Codon Usage (RSCU)': 'Compute Relative Synonymous Codon Usage bias and effective codon numbers',
  'Distances & Diversity': 'Calculate evolutionary distance matrices and population diversity statistics',
  'Pairwise Distances': 'Compute p-distance, Kimura 2-parameter, or Tamura-Nei distance matrices',
  'Population Diversity': 'Estimate nucleotide diversity (pi), Watterson theta, and Tajima D statistics',
  'Selection & Rates': 'Measure purifying or diversifying selection and site-specific evolutionary rates',
  'Codon Selection (dN/dS)': 'Estimate nonsynonymous-to-synonymous substitution ratios (omega) across codons',
  'Gamma Site Rates': 'Model among-site evolutionary rate variation under a discrete gamma distribution',
  'Ancestral States': 'Reconstruct inferred ancestral nucleotide or amino acid sequences at internal nodes',
  'Ancestors (ML)': 'Infer marginal maximum-likelihood ancestral states at internal tree nodes',
  'Ancestors (Parsimony)': 'Reconstruct most-parsimonious ancestral character states across internal branches',
  'Clocks & Variants': 'Test molecular-clock divergence times and evaluate variant functional impact',
  'Molecular Clocks': 'Calibrate node divergence times and test strict molecular-clock rate constancy',
  'Variant Impact': 'Score coding and regulatory substitutions by evolutionary conservation',
  'Analyze User Tree': 'Evaluate branch lengths, log-likelihood, and Robinson-Foulds distance on a tree',

  // Cloning, Vectors & Restriction Enzymes
  'Restriction Cloning': 'Cut vector and insert with restriction endonucleases and ligate compatible overhangs',
  'Restriction Ligation': 'Simulate sticky- or blunt-end digest and T4 DNA ligase construct circularization',
  'Ligate Fragments': 'Join compatible digested DNA fragments into a linear or circular product',
  'Restriction Digest': 'Cleavage-map the active sequence and compute exact restriction fragment lengths',
  'Enzyme Digest': 'Simulate single or multi-enzyme restriction cleavage and buffer compatibility',
  'Agarose Digest': 'Simulate restriction digestion and preview band migration on an agarose gel',
  'Digest & Gel': 'Run virtual restriction digestion and visualize fragment bands on an agarose gel',
  'Agarose Gel': 'Simulate DNA fragment migration across configurable agarose gel percentages',
  'Choose Enzymes': 'Filter restriction endonucleases by cut frequency, overhang geometry, or supplier',
  'Find Sites': 'Scan the active sequence for recognition sites across the REBASE enzyme catalog',
  'Non-Cutters': 'List restriction enzymes with zero cleavage sites in the active construct',
  'Silent Mutations': 'Identify synonymous codon changes that introduce or remove a restriction site',
  'Suppliers & Methylation': 'Check Dam, Dcm, and CpG methylation sensitivity alongside commercial availability',
  'Enzymes Table': 'Display all restriction cleavage coordinates, overhangs, and fragment sizes in a table',
  'Enzymes View': 'Inspect recognition motifs, cleavage positions, and cut frequencies across the map',
  'Gel Preferences': 'Configure default agarose concentration, voltage, stain palette, and DNA ladder',
  'Seamless Assembly': 'Join overlapping DNA fragments without restriction scars via exonuclease assembly',
  'Gibson Assembly': 'Assemble overlapping DNA fragments isothermally with 5-prime exonuclease, polymerase, and ligase',
  'NEBuilder HiFi': 'Simulate high-fidelity seamless multi-fragment overlap assembly and primer tails',
  'In-Fusion': 'Join PCR amplicons sharing 15-bp terminal homology into a linearized vector',
  'Golden Gate': 'Perform scarless Type IIS BsaI, BsmBI, or BbsI multi-part Golden Gate assembly',
  'Parts Cloning': 'Assemble standardized promoter, RBS, CDS, and terminator parts in defined syntax',
  'PCR Cloning': 'Amplify target inserts with custom primers or splice fragments by overlap extension',
  'PCR Amplification': 'Simulate polymerase chain reaction amplicon generation from bound primer pairs',
  'Overlap PCR': 'Splice two or more DNA segments together via chimeric overlap-extension PCR',
  'Anneal Oligos': 'Hybridize complementary forward and reverse oligonucleotides with cloning overhangs',
  'Annealed Oligo Cloning': 'Anneal complementary oligos and ligate directly into a digested vector cassette',
  'Mutagenesis': 'Introduce targeted point substitutions, insertions, or deletions into a construct',
  'Site Mutagenesis': 'Design mutagenic primers and simulate targeted codon or nucleotide substitution',
  'Point Mutation': 'Introduce targeted base substitutions or randomized sequence variants',
  'Gateway Cloning': 'Perform att-site recombinase BP and LR transfers between donor and destination vectors',
  'BP / LR Cloning': 'Simulate bacteriophage lambda integrase BP entry and LR expression reactions',
  'Gateway BP Reaction': 'Recombine an attB-flanked amplicon with an attP donor vector to form an entry clone',
  'Gateway LR Reaction': 'Transfer an attL entry insert into an attR destination expression vector',
  'Annotate att Sites': 'Detect and annotate attB, attP, attL, and attR recombination motifs automatically',
  'Add attB Sites': 'Append directional attB1 and attB2 recombination tails to primers or inserts',
  'TA & GC Cloning': 'Clone A-tailed or G-tailed PCR amplicons directly into linearized T- or C-vectors',
  'TA / GC Cloning': 'Ligate 3-prime A-overhang or G-overhang PCR products into linearized receiver vectors',
  'TOPO Cloning': 'Simulate topoisomerase I-mediated rapidTA, blunt, or directional CACC cloning',
  'TA Vectors': 'Choose a linearized 3-prime-T overhang receiver plasmid for Taq PCR cloning',
  'GC Vectors': 'Choose a linearized G/C-overhang receiver plasmid for amplicon capture',
  'TOPO TA Vectors': 'Select a topoisomerase-charged 3-prime-T plasmid for rapid PCR insert capture',
  'Blunt TOPO Vectors': 'Select a topoisomerase-charged blunt plasmid for proofreading polymerase amplicons',
  'D-TOPO Vectors': 'Select a directional 5-prime-CACC topoisomerase vector for oriented ORF expression',
  'Donor Vectors': 'Choose an attP donor backbone for Gateway BP entry clone generation',
  'Gateway Donors': 'Choose an attP donor backbone for Gateway BP entry clone generation',
  'Destination Vectors': 'Choose an attR expression backbone for Gateway LR recombination',
  'Gateway Destinations': 'Choose an attR expression backbone for Gateway LR recombination',
  'Vector Catalog': 'Browse 60 curated bacterial, mammalian, yeast, viral, and plant expression vectors',
  'Built-In Vectors': 'Select from curated standard cloning and expression plasmid backbones',
  'Vector Architect': 'Compose a custom plasmid from modular origins, promoters, markers, and tags',
  'Custom Vector': 'Assemble a bespoke vector backbone from modular replication and selection parts',
  'Vector QC': 'Validate custom vector topology, resistance markers, reading frames, and forbidden sites',
  'Custom Vector QC': 'Run automated sequence quality checks on custom onboarding vector backbones',
  'Codon Optimization': 'Adapt coding sequence codon usage for high-level host expression',
  'Optimize Codons': 'Recode an open reading frame for target organism codon preference and GC balance',
  'Sanger Validation': 'Align capillary chromatogram traces against a cloned plasmid to verify junctions',
  'Verify Sanger': 'Check cloned junctions and coding regions against Sanger sequencing traces',

  // Primers & CRISPR
  'Design Primer Pair': 'Design forward and reverse PCR primers with balanced SantaLucia Tm and low dimer risk',
  'Design PCR Primers': 'Automatically pick optimal forward and reverse primers across the selected target region',
  'Add Primer': 'Create a custom oligonucleotide primer and map its hybridization site on the sequence',
  'Add Primers': 'Create or attach oligonucleotide primers to the active template construct',
  'Import Oligo List': 'Batch-import primer names and sequences from CSV, TSV, or FASTA oligo lists',
  'Export Primers': 'Export bound primers with sequences, lengths, GC%, and melting temperatures',
  'Map Saved Primers': 'Scan all saved project primers for exact and mismatch binding sites on the template',
  'Binding Specificity': 'Evaluate off-target secondary hybridization sites, hairpins, and primer dimers',
  'Selection Tm': 'Calculate salt-corrected melting temperature, GC%, and molecular mass of the selection',
  'Selection to Oligo': 'Extract the highlighted sequence span into a standalone oligonucleotide primer document',
  "Add 5' Overhang": 'Prepend a restriction site, Kozak motif, or assembly homology tail to the 5-prime end',
  'In-Silico PCR': 'Predict PCR amplicon products, sizes, and annealing temperatures from primer binding sites',
  'Find CRISPR Sites': 'Locate SpCas9, SaCas9, or Cas12a PAM protospacers with on-target efficiency scores',
  'Primers & CRISPR': 'Open primer thermodynamics, in-silico PCR, and CRISPR guide RNA design tools',
  'Primer Preferences': 'Configure monovalent salt, Mg2+, oligo concentration, and thermodynamic Tm parameters',

  // Annotation, Sequence & Tools
  'Add Feature': 'Annotate a coding region, promoter, terminator, origin, or regulatory element span',
  'Edit Annotations': 'Inspect, filter, edit, or recolor sequence features in the annotations table',
  'Detect Common Features': 'Automatically scan the sequence for curated promoters, origins, markers, and tags',
  'Detect Features': 'Auto-annotate standard plasmid regulatory elements, tags, and resistance genes',
  'Add Tag / Protease': 'Annotate affinity purification tags (6xHis, FLAG, GST) and protease cleavage motifs',
  'Manage Library': 'View and curate the reusable feature dictionary for automated plasmid annotation',
  'Extract Features': 'Extract annotated CDS or feature intervals into new standalone sequence documents',
  'Transfer Features': 'Project annotations from a homologous reference plasmid onto the active sequence',
  'Annotate by BLAST': 'Transfer functional feature annotations from top local BLAST sequence hits',
  'Find ORFs': 'Detect open reading frames across all six translation frames above minimum codon length',
  'Predict Genes': 'Identify prokaryotic coding genes and ribosomal binding motifs across genomic DNA',
  'CpG & Repeats': 'Locate CpG islands, tandem repeats, inverted repeats, and low-complexity regions',
  'Find Motifs': 'Search for IUPAC nucleotide or PROSITE-style protein sequence motifs and regex patterns',
  'Call Variants': 'Detect SNPs, MNPs, and indels from aligned reads or homologous sequences',
  '16S / ITS Taxonomy': 'Classify bacterial 16S rRNA or fungal ITS amplicons against curated taxonomic markers',
  'Trim NGS Reads': 'Trim sequencing adapters and low-Phred-quality ends from raw read datasets',
  'Protein Domains': 'Identify conserved functional domains, signal peptides, and transmembrane helices',
  '3D Structure & Coils': 'Inspect 3D biomolecular coordinates, coiled-coil heptads, and secondary structure',
  '3D Protein Viewer': 'Render interactive 3D protein and nucleic acid structures with structural superposition',
  'Reverse Complement': 'Convert the active DNA sequence or highlighted region to its antiparallel complement',
  'Reverse Only': 'Reverse the 5-prime-to-3-prime character direction without complementing bases',
  'Complement Only': 'Replace each nucleotide with its Watson-Crick pairing partner without reversing',
  'Convert DNA / RNA': 'Toggle thymine (T) and uracil (U) residues between DNA and RNA representations',
  'Circular Topology': 'Toggle the active construct between circular plasmid and linear fragment topology',
  'Set Origin': 'Rotate circular plasmid numbering so position 1 begins at the selected base',
  'Extract Region': 'Slice the currently selected coordinate interval into a new sequence document',
  'Translate Frames': 'Translate nucleotide codons into amino acids using the active genetic code',
  'Back Translate': 'Convert a protein amino acid sequence into a host-optimized DNA coding sequence',
  'Mutate & Shuffle': 'Generate randomized point mutants or dinucleotide-preserving shuffled controls',
  'BLAST Search': 'Run local nucleotide or protein similarity search against project and custom BLAST databases',
  'BLAST Setup': 'Configure local BLAST scoring matrices, E-value thresholds, and word-size parameters',
  'Local BLAST DBs': 'Build and manage indexed local sequence collections for instant offline BLAST queries',
  'NCBI & UniProt': 'Fetch annotated reference sequences and protein records by accession identifier',
  'DNA Calculations': 'Convert DNA/protein mass-to-moles, A260/A280 concentration, and ligation molar ratios',
  'Sanger Studio': 'Inspect 4-dye ABI capillary chromatograms, Phred quality bars, and base-call edits',
  'Sanger Traces': 'Open 4-dye Sanger capillary trace chromatograms for base-call and junction review',
  'NGS Assembly': 'Analyze short- and long-read coverage, read mapping pileups, and variant calls',
  'NGS Reads': 'Import and inspect FASTQ sequencing reads, quality distributions, and reference pileups',
  'NGS & 3D Structure': 'Open high-throughput read genomics alongside interactive 3D structure analysis',
  'GenBank Submission': 'Prepare NCBI feature table (.tbl) and flatfile exports for database deposition',
  'Guided Pipelines': 'Run automated multi-step molecular biology and evolutionary analysis pipelines',
  'Guided Pipeline': 'Launch an end-to-end automated QC, assembly, annotation, or phylogeny workflow',
  'Lineage Manager': 'Trace construct ancestry, parent-child cloning steps, and workflow history',
  'Workflow Manager': 'Execute, chain, and audit reproducible batch molecular biology workflows',
  'Manage Workflows': 'Configure and run multi-step batch processing pipelines across project folders',
  'Run Workflow': 'Execute an automated multi-step sequence processing pipeline on selected files',
  'Bioinformatics Plugins': 'Run specialized gene prediction, CRISPR array, species delimitation, and domain tools',
  'Eukaryotic Gene Predictor': 'Predict multi-exon eukaryotic coding genes and canonical GT-AG splice junctions',
  'Microbial Gene Predictor': 'Predict bacterial, archaeal, and viral ORFs with upstream 16S Shine-Dalgarno RBS sites',
  'CRISPR Repeat Array Finder': 'Detect bacterial and archaeal CRISPR direct-repeat arrays and spacer repertoires',
  'Microsatellite & Tandem Repeats': 'Scan sequences for perfect and imperfect short tandem repeats and microsatellites',
  'Haplotype & Allele Partitioner': 'Partition allele multisets, Nei haplotype diversity, and segregating sites across sequences',
  'Taxonomic Sequence Classifier': 'Classify query sequences across taxonomic lineages using k-mer and CpG dinucleotide signatures',
  'Species Delimitation': 'Assess putative evolutionary species boundaries using coalescent P(RD) and barcoding gap metrics',
  'Protein Domains & Epitopes': 'Scan conserved protein motifs, GOR IV secondary structure, and Kolaskar-Tongaonkar B-cell epitopes',
  'Transmembrane & Signal Topology': 'Predict transmembrane alpha-helices, N-in/N-out topology, and N-terminal signal peptides',
  'Adapter & Quality Read Trimmer': 'Screen reads for sequencing adapters and perform Mott running-sum Phred quality trimming',
  'Whole-Genome Synteny Blocks': 'Map locally collinear synteny blocks and spaced-seed anchors across genomic sequences',
  'HPC Phylogeny Job Builder': 'Export PHYLIP alignments and generate Slurm and CLI batch scripts for HPC phylogenetics',
  'External CLI Suite': 'Inspect and generate command-line pipelines for user-installed open-source alignment and tree tools',
  'Mask Selection': 'Replace nucleotides in the highlighted interval with N ambiguity masking characters',
  'Mask Homopolymers': 'Mask low-complexity homopolymer runs to prevent spurious alignment seeds',
  'Concatenate': 'Join multiple selected sequence documents end-to-end into a single supermatrix or locus',
  'Concatenate Sequences': 'Join multiple selected sequence documents end-to-end into a combined record',

  // File, Session, View & Workspace
  'Blank Session': 'Start a clean research workspace with an empty MCS starter construct',
  'Sample Project': 'Load the 72-document multi-discipline sample library across all 12 folders',
  'New Sequence': 'Create a new DNA, RNA, protein, primer, or probe sequence document from raw residues',
  'Add Sequence': 'Create and append a new DNA, RNA, or protein sequence to the active project',
  'Text Document': 'Create a new text and structured flatfile document in the active project folder',
  'Enzyme Set': 'Create and manage a custom restriction enzyme set for cleavage screening',
  'Flatfile Document': 'Open a structured GenBank, EMBL, FASTA, or GFF3 text record editor',
  'Flatfile View': 'Inspect and export the active document in formatted GenBank, FASTA, EMBL, or GFF3 text',
  'Open Session': 'Load a saved MolBioCraft (.mbc) project session file from disk',
  'Project Session': 'Browse disk to open a saved MolBioCraft (.mbc) project workspace',
  'Merge Session': 'Import documents from another .mbc session file into the current workspace',
  'Save Session': 'Save all project documents, folders, history, and workspace state to an .mbc archive',
  'Save Session As': 'Save a copy of the active project workspace under a new .mbc session filename',
  'Close Session': 'Close the active project workspace and return to the welcome start screen',
  'Restore Autosave': 'Recover the most recently autosaved local workbench project draft',
  'Back Up Project': 'Export a timestamped full-project backup archive of all documents and folders',
  'Restore Backup': 'Restore project folders, documents, and construct lineage from a backup archive',
  'Import Files': 'Import GenBank, FASTA, FASTQ, EMBL, AB1 chromatogram, GFF3, or PDB/CIF files',
  'Import Folder': 'Batch-import an entire directory of sequence, chromatogram, and structure files',
  'Import From Clipboard': 'Create a new sequence document directly from FASTA, GenBank, or raw bases on the clipboard',
  'Import Other': 'Restore project backups, or import sample documents, preferences, or database links',
  'Sample Documents': 'Import the curated multi-discipline sample library into the active workspace',
  'MolBioCraft Preferences': 'Load saved workbench display, enzyme, and thermodynamic settings from JSON',
  'New Database Connection': 'Configure and connect to remote or local sequence and protein reference databases',
  'Import Sequence Files': 'Import standard sequence, plasmid map, chromatogram, or structure files from disk',
  'Sequence Files': 'Import or export standard GenBank, FASTA, and EMBL files',
  'Sequence File': 'Open an individual sequence, chromatogram, or plasmid file from disk',
  'Open Sequence File': 'Open an individual sequence, chromatogram, or plasmid file from disk',
  'From Clipboard': 'Create a new sequence document directly from FASTA, GenBank, or raw bases on the clipboard',
  'Export GenBank': 'Export the active sequence with full feature qualifiers in NCBI GenBank (.gb) format',
  'Export FASTA': 'Export nucleotide or protein residues in standard FASTA (.fasta) format',
  'Export EMBL': 'Export sequence and feature annotations in EBI EMBL flatfile (.embl) format',
  'Export GFF3': 'Export genomic feature coordinates and qualifiers in Generic Feature Format v3 (.gff3)',
  'Batch FASTA': 'Export all checked table documents together into a multi-record FASTA file',
  'Export MBC JSON': 'Export the active workbench or selected documents in structured JSON (.mbc) format',
  'Export Folder as MBC': 'Package the active folder and documents into a ZIP archive saved with .mbc extension',
  'Export Folder': 'Export every sequence document in the current folder as a multi-record GenBank archive',
  'Export Lineage': 'Export construct cloning history and parent-child provenance records',
  'Save SVG Map': 'Export a publication-grade scalable vector graphic (.svg) of the plasmid or linear map',
  'Export SVG Map': 'Batch-export scalable vector plasmid maps (.svg) for selected constructs',
  'Print / Export PDF': 'Open high-resolution print layout for PDF report or physical lab-notebook printing',
  'Import Preferences': 'Load saved workbench display, enzyme, and thermodynamic settings from JSON',
  'Export Preferences': 'Save current workbench preferences to a portable .mbcprefs.json profile',
  'Preferences': 'Configure theme, menu function info, thermodynamics, genetic codes, and editor defaults',
  'New Folder': 'Create a custom organizational folder under All Project Files in the left sidebar',
  'New Subfolder': 'Create a new custom project folder to organize related constructs and reads',
  'Rename Folder': 'Rename the currently selected custom project folder',
  'Set Folder Color': 'Assign a color accent badge to the currently selected project folder',
  'Cycle Folder Color': 'Cycle through accent badge colors for the active project folder',
  'Move to Folder': 'Move checked table documents into another project folder',
  'Toggle Favorite': 'Star or unstar selected documents for one-click access in the Favorites view',
  'Move to Trash': 'Soft-delete selected documents to Deleted Items without permanent data loss',
  'Restore from Trash': 'Restore soft-deleted documents from Deleted Items back to their original folder',
  'Empty Trash': 'Permanently remove all documents currently sitting in Deleted Items',
  'Copy Sequence': 'Copy the selected residues or full active sequence to the system clipboard',
  'Select Sequence': 'Highlight the entire nucleotide or amino acid span of the active document',
  'Find in Sequence': 'Search forward or reverse strands for exact or IUPAC subsequence matches',
  'Next Feature': 'Jump selection focus to the next annotated feature along the active construct',
  'Project Sidebar': 'Show or hide the left project folders, sample library, and database navigation tree',
  'Document Table': 'Show or hide the multi-column project document table pane',
  'Inspector': "Show or hide the right-hand inspector that holds the active task window's settings",
  'Show Menu Function Info': 'Toggle floating short function descriptions when hovering or focusing menu items',
  'Split Top / Bottom': 'Stack the active sequence viewer canvas on top with the document table below it',
  'Split Left / Right': 'Arrange the document table and sequence viewer side by side',
  'Expand Viewer': 'Maximize the active sequence studio by collapsing surrounding table and sidebar panes',
  'Split Map & Sequence': 'Display synchronized circular plasmid map and nucleotide sequence tracks together',
  'Circular Map': 'Focus the canvas on the interactive circular plasmid topology map',
  'Linear Sequence': 'Focus the canvas on the linear nucleotide, translation, and restriction site tracks',
  'Sequence View': 'Open the interactive circular/linear plasmid map and nucleotide track editor',
  'Open Sequence View': 'Open the interactive circular/linear plasmid map and nucleotide track editor',
  'Annotations Table': 'View and filter all features, qualifiers, intervals, and translated CDS weights',
  'Secondary Structure': 'Fold DNA or RNA single-strand hairpins and minimum-free-energy secondary structures',
  'Lineage & History': 'Inspect the interactive DAG of cloning, mutagenesis, and edit operations',
  'Zoom In': 'Increase map and sequence track magnification for base-level inspection',
  'Zoom Out': 'Decrease magnification to overview larger plasmid or chromosomal regions',
  'Actual Size (100%)': 'Reset sequence map magnification back to 100% default scale',
  'Back': 'Return to the previously viewed document in navigation history',
  'Forward': 'Advance to the next document in navigation history',
  'Search Workspace': 'Focus the global search bar to filter documents, accessions, and menu commands',
  'Filter Folder': 'Open multi-rule column filters on the current folder document table',
  'Lock Column Order': 'Prevent accidental drag-and-drop rearrangement of document table columns',
  'Save Current State': 'Persist the current visible columns and column arrangement for this folder',
  'Load Column State': 'Restore the previously saved visible column preset for this folder',
  'Batch Restriction': 'Simulate restriction enzyme digestion across all checked documents simultaneously',
  'Apply Variants': 'Apply variant substitutions onto a reference sequence to build a mutant construct',
  'Group by Prefix': 'Organize checked documents automatically into folders based on filename prefixes',
  'Modify Intervals': 'Trim or adjust annotated feature start and end coordinates across selected records',
  'Sample Sequences': 'Draw a reproducible random subset of sequences from the current alignment or folder',
  'Set CDS Translation': 'Assign reading frame and genetic code table metadata to annotated CDS features',
  'Add to Project': 'Save the currently previewed sequence construct into the active project',
  'Add to Session': 'Save the currently previewed sequence construct into the active project',
  'Keyboard Shortcuts': 'View all keyboard accelerators for navigation, cloning, alignment, and editing',
  'Sample Tutorial': 'Open guided walkthroughs using built-in plasmids, chromatograms, and alignments',
  'Vector Guide': 'Review expression host selection, replication origins, promoters, and affinity tags',
  'Check for Updates': 'Verify whether a newer MolBioCraft desktop release is available',
  'About MolBioCraft': 'Display version, scientific capabilities, and academic research license details',
  'Quit MolBioCraft': 'Close all open workbench sessions and exit the MolBioCraft application',
};

export function resolveMenuNodeFunctionDescription(
  id: string,
  label: string,
  explicitDescription?: string,
  isSubmenu = false
): string {
  if (explicitDescription && explicitDescription.trim().length > 0) {
    return explicitDescription.trim();
  }
  const cleanLabel = label.replace(/\.\.\.$/, '').trim();
  const direct = MENU_LABEL_DESCRIPTIONS[cleanLabel];
  if (direct) return direct;

  if (id.startsWith('file-rec-') || id.startsWith('home-open-rec-')) {
    return `Open recent document "${cleanLabel}" in the active sequence workspace`;
  }
  if (id.startsWith('view-tab-')) {
    return `Switch the active editor tab to "${cleanLabel}"`;
  }
  if (id.includes('-col-preset-') || id.startsWith('col-preset-')) {
    return `Apply the "${cleanLabel}" column layout to the current document table`;
  }
  if (id.includes('-col-tog-') || id.startsWith('view-cols-')) {
    return `Show or hide the "${cleanLabel}" column in the document table`;
  }
  if (
    id.includes('-vec-') ||
    id.startsWith('act-ta-vec-') ||
    id.startsWith('act-gc-vec-') ||
    id.startsWith('act-topo-') ||
    id.startsWith('act-gw-')
  ) {
    return `Load cloning vector preset ${cleanLabel} with preconfigured cloning sites`;
  }
  if (isSubmenu) {
    return `Browse ${cleanLabel} commands and specialized workbench tools`;
  }
  return `Run ${cleanLabel} in the active MolBioCraft workbench session`;
}
