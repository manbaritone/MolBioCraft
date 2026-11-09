// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Context help: one topic per options window and per document view.
 * Each topic says what the tool does, how it works, the options that matter, and what it saves.
 */

export interface HelpTopic {
  title: string;
  /** One or two sentences: what it is for. */
  summary: string;
  /** How it works (method, references). */
  method?: string;
  /** Options worth knowing about. */
  options?: string[];
  /** What the result is and where it goes. */
  result?: string;
  /** Menu path. */
  where?: string;
}

const opt = (...x: string[]) => x;

export const OPERATION_HELP: Record<string, HelpTopic> = {
  'align-multiple': {
    title: 'Multiple Alignment', where: 'Align → Multiple Alignment…',
    summary: 'Aligns the selected sequences (or the members of an unaligned list) into one alignment document.',
    method: 'Progressive alignment with refinement passes in the built-in engine; the method list also offers the other built-in strategies.',
    options: opt('Alignment method: speed vs accuracy.', 'Circular sequences: rotate each circular sequence (reverse-complementing it if needed) to start where the first one starts, so different origins do not split the alignment.'),
    result: 'A new alignment document in the current folder, linked to its inputs.',
  },
  'align-pairwise': {
    title: 'Pairwise Alignment', where: 'Align → Pairwise Alignment…',
    summary: 'Aligns two sequences globally (Needleman–Wunsch), locally (Smith–Waterman) or with free end gaps.',
    options: opt('Mode, scoring matrix (BLOSUM62 / PAM250 for proteins, IUPAC-aware for DNA), gap open and extension costs.'),
    result: 'An alignment document with identity and similarity.',
  },
  'build-tree': {
    title: 'Build Tree', where: 'Tree → Build Tree…',
    summary: 'Builds a phylogenetic tree from an alignment (or aligns first).',
    method: 'Neighbor-Joining and UPGMA on model distances; Minimum Evolution (balanced ME, NNI search); Maximum Parsimony (Fitch, SPR from NJ plus random-addition trees); Maximum Likelihood (JC…GTR +G +I, NNI with branch-length and model optimisation); or an installed FastTree / PhyML / RAxML / MrBayes.',
    options: opt('Resampling: bootstrap, jackknife, little bootstraps (long alignments) or the interior-branch test (NJ/ME).', 'Data subset: complete / pairwise / partial deletion of gaps and missing data; codon positions.', 'Root with outgroup.'),
    result: 'A tree document with the method, support type, search details and the alignment it was built from.',
  },
  'digest-fragments': {
    title: 'Digest into Fragments', where: 'Cloning → Digest into Fragments…',
    summary: 'Cuts a sequence with chosen restriction enzymes and saves each fragment as a document, keeping annotations that lie inside fragments.',
  },
  'design-primers': {
    title: 'Design Primers', where: 'Primers → Design Primers…',
    summary: 'Designs a PCR primer pair for a target region with Tm, GC, length and 3′-clamp constraints.',
    options: opt('Primers may move a set number of bases outside the region to reach the target Tm.', 'Optionally saves the PCR product.'),
    result: 'Primers added to the sequence (and the product as a document).',
  },
  'find-orfs': { title: 'Find ORFs', where: 'Annotate → Find ORFs…', summary: 'Annotates open reading frames above a minimum length on one or both strands, optionally with alternative start codons.' },
  'clone-insert': {
    title: 'Clone Insert into Vector', where: 'Cloning → Clone Insert into Vector…',
    summary: 'Simulates restriction/ligation, Gibson, Golden Gate, Gateway, TOPO and other cloning methods and saves the construct.',
  },
  'de-novo-assemble': {
    title: 'De Novo Assemble', where: 'Sequence → De Novo Assemble…',
    summary: 'Assembles reads into contigs with the built-in greedy overlap assembler (up to 1,000 reads per run).',
    result: 'Contig documents with their reads as an alignment.',
  },
  'map-to-reference': {
    title: 'Map to Reference', where: 'Sequence → Map to Reference…',
    summary: 'Maps reads to one or more references on both strands and calls variants.',
    options: opt('Variant filters: frequency, coverage and trace quality.', 'Several references: each read goes to its best reference.'),
    result: 'One contig per reference with consensus, coverage and variant annotations; unmapped reads are listed with the reason.',
  },
  'find-duplicates': { title: 'Find Duplicates', where: 'Edit → Find Duplicates…', summary: 'Selects documents that repeat another by residues (optionally either strand), name or accession, keeping the newest or oldest copy.' },
  'batch-rename': { title: 'Batch Rename', where: 'Edit → Batch Rename…', summary: 'Renames many documents from a template ({name}, {accession}, {organism}, {n:3} …), with prefix, suffix and regular-expression replacement, previewed before applying.' },
  'translation-align': { title: 'Translation Alignment', where: 'Align → Translation Alignment…', summary: 'Aligns coding sequences as proteins and threads the codons back, so gaps fall between whole codons.' },
  'mask-alignment': { title: 'Mask Alignment', where: 'Align → Mask Alignment…', summary: 'Removes or annotates columns by gap content, gap %, constant sites, ambiguities, codon position or a NEXUS CHARSET.' },
  'generate-consensus': { title: 'Generate Consensus', where: 'Align → Generate Consensus…', summary: 'Makes a consensus sequence from an alignment with a majority threshold and gap handling.' },
  'consensus-tree': { title: 'Consensus Tree', where: 'Tree → Consensus Tree…', summary: 'Majority-rule (to strict) consensus of several trees with % support, optional burn-in and outgroup.' },
  'test-saved-primers': { title: 'Test with Saved Primers', where: 'Primers → Test with Saved Primers…', summary: 'Finds where saved primer documents bind the selected sequences (both strands, mismatches allowed outside the 3′ clamp).' },
  'trim-ends': { title: 'Trim Ends', where: 'Sequence → Trim Ends…', summary: 'Trims reads by quality, adapters or low complexity, as annotations or trimmed copies.' },
  'back-translate': { title: 'Back-Translate', where: 'Sequence → Back-Translate…', summary: 'Turns a protein into DNA using the most frequent codons of a host, or IUPAC-degenerate codons.' },
  'add-to-alignment': { title: 'Add Sequences to Alignment', where: 'Align → Add Sequences to Alignment…', summary: 'Aligns new sequences to an existing alignment’s consensus without re-aligning the existing rows.' },
  'validate-clone': { title: 'Validate Clone', where: 'Cloning → Validate Clone…', summary: 'Maps sequencing reads to the expected construct and reports whether it is confirmed (coverage, no consistent discrepancies).' },
  'import-metadata': { title: 'Import Metadata from Spreadsheet', where: 'File → Import → Metadata from Spreadsheet…', summary: 'Adds columns from a CSV/TSV to documents matched by name or accession.' },
  'merge-pairs': { title: 'Merge Paired Reads', where: 'Sequence → Merge Paired Reads…', summary: 'Pairs mates by name, overlaps read 1 with reverse-complemented read 2 and resolves conflicts by base quality.' },
  'compare-annotations': { title: 'Compare Annotations', where: 'Annotate → Compare Annotations…', summary: 'Marks annotations as identical, overlapping or only in one of two documents.' },
  'read-qc': { title: 'Read QC Report', where: 'Sequence → Read QC Report…', summary: 'FastQC-style quality modules with PASS / WARN / FAIL: per-base quality, N content, GC, lengths, duplication, overrepresented sequences, adapters.' },
  'compute-distances': {
    title: 'Compute Distances', where: 'Tree → Compute Distances…',
    summary: 'Pairwise, overall mean, within-, between- and net between-group distances with optional standard errors.',
    options: opt('Groups come from a "Group" metadata field or "Group: X" in the description.', 'Data subset options: gaps, missing data and codon positions.'),
  },
  'condense-tree': { title: 'Condense Tree', where: 'Tree → Condense Tree…', summary: 'Collapses interior branches with support below a cutoff.' },
  'gene-duplications': { title: 'Gene Duplication Inference', where: 'Tree → Gene Duplication Inference…', summary: 'Reconciles a gene tree with a species tree (LCA mapping) and marks duplication nodes; can root the gene tree to minimise duplications.' },
  'highlight-sites': { title: 'Highlight Sites', where: 'Align → Highlight Sites…', summary: 'Annotates conserved, variable, singleton, parsimony-informative and 0/2/4-fold degenerate sites and counts them.' },
  'evo-models': { title: 'Models', where: 'Phylogeny → Models', summary: 'Best substitution models (ranked by BIC), substitution pattern and Ts/Tv, disparity index test, composition by codon position, codon usage (RSCU).' },
  'evo-diversity': { title: 'Diversity', where: 'Phylogeny → Diversity', summary: 'Nei (1987) nucleotide diversity within and between populations, GST and haplotype diversity.' },
  'evo-selection': { title: 'Selection', where: 'Phylogeny → Selection', summary: 'Codon-based Z-tests (neutral, positive, purifying), Fisher’s exact test, Tajima’s D and codon-by-codon pN − pS. Uses every column so codons stay in frame.' },
  'evo-rates': { title: 'Site Rates', where: 'Phylogeny → Rates', summary: 'Discrete-gamma shape and the relative rate of every site.' },
  'evo-ancestors': { title: 'Ancestral Sequences', where: 'Phylogeny → Ancestors', summary: 'Maximum-likelihood (empirical Bayes) or parsimony ancestral sequences on the NJ tree, as FASTA, with optional per-site root probabilities.' },
  'evo-clocks': { title: 'Molecular Clock Tests', where: 'Phylogeny → Clocks', summary: 'ML likelihood-ratio clock test or Tajima’s relative-rate test.' },
  timetree: {
    title: 'Compute Timetree', where: 'Tree → Compute Timetree…',
    summary: 'Turns a tree with branch lengths into a timetree using calibrations (MRCA of two taxa, minimum and/or maximum age).',
    method: 'RelTime-style relative rates (sister lineages’ rates in the ratio of their lineage lengths, ancestral rate their geometric mean) or mean path length; optional bootstrap 95% intervals sampling calibration ranges.',
    result: 'The timetree (branch lengths in Mya) and a divergence-time table.',
  },
  'degenerate-primers': {
    title: 'Design Degenerate Primers', where: 'Primers → Design Degenerate Primers…',
    summary: 'Designs primer pairs on an alignment; bases that differ between sequences become IUPAC codes.',
    options: opt('Bases below the inclusion % are ignored (they will mismatch).', 'Degeneracy limit and exact 3′ bases.', 'Tm range must hold for the lowest- and highest-GC versions.'),
  },
  'annotate-from-documents': { title: 'Annotate from Documents', where: 'Annotate → Annotate from Documents…', summary: 'Copies features from chosen reference documents onto the selected sequences where each feature matches with the required identity (both strands, across the origin, one annotation per site).' },
  'import-primers': { title: 'Import Primers from Spreadsheet', where: 'Primers → Import Primers from Spreadsheet…', summary: 'Creates primer documents from a CSV/TSV list of names and sequences (headers detected; 5′/3′ labels and /5Phos/-style modifications stripped).' },
  'annotate-by-blast': { title: 'Annotate by BLAST', where: 'Annotate → Annotate by BLAST…', summary: 'BLASTs the selected sequences against a local database and copies annotations from the best annotated hits.' },
  'crispr-editing': {
    title: 'CRISPR Editing Analysis', where: 'Primers → CRISPR Guides → CRISPR Editing Analysis…',
    summary: 'Estimates indel frequencies in edited Sanger reads against an unedited control read.',
    method: 'TIDE (Brinkman et al. 2014): cut site 3 bp upstream of the PAM; downstream base proportions decomposed by non-negative least squares into control shifted by each indel size.',
    result: 'A report with the indel spectrum, editing efficiency, R² and aberrant signal.',
  },
  expression: {
    title: 'Compare Expression Levels', where: 'Annotate → Compare Expression Levels…',
    summary: 'Differential expression between two conditions from a gene × sample count table (CSV/TSV, featureCounts, HTSeq).',
    method: 'The DESeq2 procedure (Love, Huber & Anders 2014): median-of-ratios size factors, Cox–Reid gene-wise dispersions, a parametric mean–dispersion trend, empirical-Bayes MAP dispersions, NB GLM fold changes with a Wald test, Cook’s-distance outlier flagging, independent filtering and Benjamini–Hochberg. On the pasilla data set it reproduces Bioconductor DESeq2 1.50 (fold changes within 0.03 log2, p-value correlation 0.9999). Fold-change shrinkage (lfcShrink) is not applied.',
    result: 'A results document with volcano, MA and PCA plots and a sortable table (CSV export).',
  },
  'expression-levels': {
    title: 'Calculate Expression Levels', where: 'Align → Calculate Expression Levels…',
    summary: 'Counts reads per annotated gene in reference-mapping contigs (one per sample) and reports reads, FPKM and TPM.',
    options: opt('Annotation types to count on (gene, CDS …) and the minimum overlap.', 'Reads overlapping several genes: split, count to each, or leave out.'),
    result: 'A report with a stored count table, which Compare Expression Levels can load (“From a document…”).',
  },
  'structural-variants': {
    title: 'Find Structural Variants', where: 'Align → Find Structural Variants…',
    summary: 'Finds deletions, insertions, tandem duplications and inversion breakpoints from reads that are split across a breakpoint.',
    method: 'Reads are placed by exact 15-mer matches; a read with two segments on different diagonals or strands, or with an end matching nowhere, marks a breakpoint. Calls need several supporting reads.',
    result: 'An annotated copy of the reference and a report.',
  },
  microsatellites: {
    title: 'Microsatellite Analysis', where: 'Annotate → Microsatellite Analysis…',
    summary: 'Sizes fragment-analysis runs (.fsa, imported with File → Import) against a size standard and calls microsatellite alleles from a marker panel.',
    method: 'Size-standard peaks are matched in order to the standard by dynamic programming (smoothest mobility curve, allowing missing or extra peaks); scans are sized by the Local Southern method (Elder and Southern 1983), leaving out the anomalously migrating 250 and 340 bp GeneScan 500 fragments. Peaks: off-scale pull-up in other dyes removed; a peak within 1.2 bp of one at least twice its height (−A shoulder) merged, so microvariants 1 bp apart (TH01 9.3/10) are kept. Alleles: peaks in the marker’s dye and size range, stutter one repeat below a taller peak removed, second allele kept above the heterozygote balance. With a kit definition (OSIRIS LadderInfo XML) and an allelic-ladder run, the ladder peaks of each marker are matched in order to the kit’s ladder alleles (kit sizes are only approximate), and sample peaks within ±0.5 bp of a ladder allele take its name; others are off-ladder (OL), with a suggested designation such as 9.3.',
    options: opt('Size standard (GeneScan 500/600/1200 LIZ, 500 ROX, Promega ILS 600 or custom) and its dye.', 'Marker panel: name, dye, min bp, max bp, repeat unit per line, or Load kit file… for an OSIRIS kit XML.', 'Allelic ladder: runs named “ladder”, a chosen run, or none.', 'Peak height threshold, stutter %, heterozygote balance %.'),
    result: 'Each run shows a sized electropherogram with allele labels; a genotype table lists alleles per sample and marker.',
  },
  'align-structures': {
    title: 'Align Structures', where: 'Align → Align Structures…',
    summary: 'Superposes a chain of structure B onto a chain of structure A (two structure documents, or two chains of one entry) and reports RMSD, TM-score, sequence identity and the equivalent residues, as RCSB’s Pairwise Structure Alignment does.',
    method: 'By structure: a TM-align-style alignment of the Cα traces that does not look at the sequences, with the TM-score normalised by each chain (a re-implementation of the published method; no TM-align code is run). By sequence: residues are paired by a global sequence alignment (BLOSUM62) and the pairs are superposed by the Kabsch method; its TM-score is approximate (TM≈), not a TM-align TM-score.',
    options: opt('Structure A (the reference) and structure B, and a chain of each; a chain needs at least 10 residues with Cα coordinates.', 'Align: by structure or by sequence.'),
    result: 'The scores in the window; Add alignment to workbench creates the structure-based sequence alignment as an alignment document carrying the scores and the B-onto-A matrix, and Export FASTA and Save matrix (JSON) save them as files.',
  },
  'make-blast-db': { title: 'Make BLAST Database from Selection', where: 'Tools → Databases → Make BLAST Database from Selection…', summary: 'Creates a local BLAST database from exactly the selected documents; it is kept between sessions in this browser.' },
};

export const VIEW_HELP: Record<string, HelpTopic> = {
  'sequence-view': { title: 'Sequence view', summary: 'The sequence with annotations, translation, ORFs, primers and restriction sites. Select a region to copy, annotate, extract or design primers on it.' },
  'annotations-table': { title: 'Annotations table', summary: 'Every annotation with its type, position and strand. Sort, filter and edit annotations here.' },
  'text-view': { title: 'Text view', summary: 'Text documents and reports, the flatfile (GenBank / FASTA / EMBL / GFF3) of sequences, or the source text of imported files. Analysis results such as expression comparisons show their plots here.' },
  'sequence-alignment': { title: 'Alignment view', summary: 'Alignments and contigs: consensus, identity, colouring, annotations per row, and tools such as dotplot, distances and translation.' },
  phylogenetics: { title: 'Tree Explorer', summary: 'Tree documents: phylogram, cladogram, circular and radial layouts; support cutoff, branch lengths, time axis for timetrees; click a branch to root, flip, compress, colour or rename; save edits and export Newick / SVG / PNG.' },
  'primers-pcr': { title: 'Primers & PCR', summary: 'Primer design, in-silico PCR, primer properties and saved primers for the sequence.' },
  'cloning-gel': { title: 'Cloning & gel', summary: 'Restriction digests, virtual gels and cloning simulations.' },
  'sanger-contig': { title: 'Sanger traces', summary: 'Chromatograms with base calls and quality, trimming and contig assembly.' },
  'genomics-ngs': { title: 'Genomics & NGS', summary: 'Read mapping, variant calling and genome-scale tools.' },
  'history-hybrid': { title: 'History', summary: 'Every operation that made or changed this document, with links to parent documents.' },
  'document-info': { title: 'Info', summary: 'Document properties and metadata, custom fields (Manage fields… to define your own) and notes.' },
};

/** Topics matching a query (title, summary, method, options). */
export function searchHelp(query: string): { id: string; topic: HelpTopic }[] {
  const q = query.trim().toLowerCase();
  const all = [...Object.entries(OPERATION_HELP), ...Object.entries(VIEW_HELP)].map(([id, topic]) => ({ id, topic }));
  if (!q) return all;
  return all.filter(({ topic }) => [topic.title, topic.summary, topic.method ?? '', ...(topic.options ?? []), topic.where ?? ''].join(' ').toLowerCase().includes(q));
}
