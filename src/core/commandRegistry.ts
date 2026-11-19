// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The command registry (US-01M6Q1N2, PRD FR-4): each in-window command once, with its id, label,
 * menu path and shortcut. The in-window menubar reads its labels and shortcuts from here, and the
 * toolbar dropdowns, ⌘K and the reserved operation shortcuts are projections of the menubar or of
 * this list, so a label or key changed here changes everywhere it is shown.
 *
 * The metadata is static, so a script can read paths and keys without mounting the App (the native
 * menu follows in US-01M6Q159); the handlers and availability are bound at render time by the App's
 * menu nodes, which carry these ids. Generated commands (Open Tabs, the vector presets, the table
 * columns) are yielded by the menubar at render time and are not listed here; ⌘K indexes what they
 * yield.
 */

import { formatPlatformShortcut, type SupportedOS } from '../platform/osPlatform';
import { STUDIOS } from './studioRegistry';

export interface CommandSpec {
  readonly id: string;
  /** The label every surface shows; for a dynamic-label command, its resting form. */
  readonly label: string;
  /** Where it sits on the menubar: the top menu, then its submenus. */
  readonly path: readonly string[];
  /** 'Mod+Shift+E' (Mod is ⌘ on macOS, Ctrl elsewhere; Alt, Shift, then the key), or a bare 'F1'. */
  readonly shortcut?: string;
  /** The menubar shows a state-dependent label (Undo with the last edit, Light or Dark Appearance). */
  readonly dynamicLabel?: true;
  /** The native menu's id for the same command, which its dispatcher handles with the same handler. */
  readonly nativeId?: string;
  /** The commandAvailability rule that enables it, where one does. */
  readonly rule?: string;
}

/** The menubar's commands, in menu order. */
const MENUBAR_COMMANDS: readonly CommandSpec[] = [
  { id: 'app-about-modal', label: 'About MolBioCraft', path: ['MolBioCraft', 'About MolBioCraft'] },
  { id: 'app-prefs-open', label: 'Preferences', path: ['MolBioCraft', 'Settings'], shortcut: 'Mod+,' },
  { id: 'app-quit-cmd', label: 'Quit MolBioCraft', path: ['MolBioCraft'], shortcut: 'Mod+Q' },
  { id: 'file-ns-blank', label: 'Blank Session', path: ['File', 'New Session'], shortcut: 'Mod+Alt+N' },
  { id: 'file-ns-new-seq', label: 'New Sequence', path: ['File', 'New Session', 'Sequences & Vectors'], shortcut: 'Mod+N' },
  { id: 'file-ns-vec-cat', label: 'Vector Catalog', path: ['File', 'New Session', 'Sequences & Vectors'] },
  { id: 'file-ns-vec-arch', label: 'Custom Vector', path: ['File', 'New Session', 'Sequences & Vectors'] },
  { id: 'file-ns-twist', label: 'Vector QC', path: ['File', 'New Session', 'Sequences & Vectors'] },
  { id: 'file-ns-text-doc', label: 'Flatfile Document', path: ['File', 'New Session', 'Sequences & Vectors'] },
  { id: 'file-ns-new-text-doc', label: 'Text Document', path: ['File', 'New Session', 'Sequences & Vectors'] },
  { id: 'file-ns-new-enzyme-set', label: 'Enzyme Set', path: ['File', 'New Session', 'Sequences & Vectors'] },
  { id: 'file-ns-clone-rest', label: 'Restriction Cloning', path: ['File', 'New Session', 'Cloning & Primers'] },
  { id: 'file-ns-clone-asm', label: 'Seamless Assembly', path: ['File', 'New Session', 'Cloning & Primers'] },
  { id: 'file-ns-primers', label: 'Primers & CRISPR', path: ['File', 'New Session', 'Cloning & Primers'] },
  { id: 'file-ns-enzymes', label: 'Enzyme Digest', path: ['File', 'New Session', 'Cloning & Primers'] },
  { id: 'file-ns-align', label: 'Sequence Alignment', path: ['File', 'New Session', 'Alignment & Trees'] },
  { id: 'file-ns-phylo', label: 'Phylogenetic Tree', path: ['File', 'New Session', 'Alignment & Trees'] },
  { id: 'file-ns-sanger', label: 'Sanger Traces', path: ['File', 'New Session', 'Sequencing & Genomics'] },
  { id: 'file-ns-ngs', label: 'NGS & 3D Structure', path: ['File', 'New Session', 'Sequencing & Genomics'] },
  { id: 'file-ns-pipeline', label: 'Guided Pipeline', path: ['File', 'New Session', 'Sequencing & Genomics'] },
  { id: 'file-ns-imp-files', label: 'Import Files', path: ['File', 'New Session', 'Starter & Import'], shortcut: 'Mod+I' },
  { id: 'file-ns-imp-clip', label: 'From Clipboard', path: ['File', 'New Session', 'Starter & Import'], shortcut: 'Mod+Shift+I' },
  { id: 'file-ns-folder', label: 'New Folder', path: ['File', 'New Session', 'Starter & Import'], shortcut: 'Mod+Shift+N' },
  { id: 'file-ns-samples', label: 'Sample Project', path: ['File', 'New Session', 'Starter & Import'] },
  { id: 'file-open-mbc', label: 'Open Session', path: ['File', 'Open Session'], shortcut: 'Mod+O' },
  { id: 'file-merge-mbc', label: 'Merge Session', path: ['File', 'Open Session'] },
  { id: 'file-restore-auto', label: 'Restore Autosave', path: ['File', 'Open Session'] },
  { id: 'file-save-mbc', label: 'Save Session', path: ['File', 'Save Session'], shortcut: 'Mod+S' },
  { id: 'file-save-mbc-as', label: 'Save Session As', path: ['File', 'Save Session'], shortcut: 'Mod+Alt+Shift+S' },
  { id: 'file-close-session', label: 'Close Session', path: ['File', 'Save Session'], shortcut: 'Mod+Shift+W' },
  { id: 'file-rename-folder', label: 'Rename Folder', path: ['File', 'Folders'] },
  { id: 'file-folder-color', label: 'Set Folder Color', path: ['File', 'Folders'] },
  { id: 'file-move-folder', label: 'Move to Folder', path: ['File', 'Folders'] },
  { id: 'file-toggle-fav', label: 'Toggle Favorite', path: ['File', 'Favorites & Trash'] },
  { id: 'file-soft-delete', label: 'Move to Trash', path: ['File', 'Favorites & Trash'] },
  { id: 'file-put-back', label: 'Restore from Trash', path: ['File', 'Favorites & Trash'] },
  { id: 'file-erase-all', label: 'Empty Trash', path: ['File', 'Favorites & Trash'] },
  { id: 'file-backup-mbc', label: 'Back Up Project', path: ['File', 'Project Backup'] },
  { id: 'file-restore-backup-mbc', label: 'Restore Backup', path: ['File', 'Project Backup'] },
  { id: 'file-import-prefs', label: 'Import Preferences', path: ['File', 'Preferences'] },
  { id: 'file-export-prefs', label: 'Export Preferences', path: ['File', 'Preferences'] },
  { id: 'file-imp-direct-files', label: 'Import Files', path: ['File', 'Import Data'], shortcut: 'Mod+I' },
  { id: 'file-imp-direct-folder', label: 'Import Folder', path: ['File', 'Import Data'] },
  { id: 'file-imp-metadata', label: 'Metadata from Spreadsheet…', path: ['File', 'Import Data'] },
  { id: 'file-imp-direct-clipboard', label: 'Import From Clipboard', path: ['File', 'Import Data'], shortcut: 'Mod+Shift+I' },
  { id: 'file-imp-other-restore-backup', label: 'Restore Backup', path: ['File', 'Import Data', 'Import Other'] },
  { id: 'file-imp-other-sample-docs', label: 'Sample Documents', path: ['File', 'Import Data', 'Import Other'] },
  { id: 'file-imp-other-mbc-prefs', label: 'MolBioCraft Preferences', path: ['File', 'Import Data', 'Import Other'] },
  { id: 'file-imp-other-new-db-conn', label: 'New Database Connection', path: ['File', 'Import Data', 'Import Other'] },
  { id: 'file-imp-gb-fasta', label: 'Sequence Files', path: ['File', 'Import Data', 'Sequence Files'], shortcut: 'Mod+I' },
  { id: 'file-imp-clipboard', label: 'From Clipboard', path: ['File', 'Import Data', 'Sequence Files'], shortcut: 'Mod+Shift+I' },
  { id: 'file-imp-sanger', label: 'Sanger Traces', path: ['File', 'Import Data', 'Traces & Reads'] },
  { id: 'file-imp-ngs', label: 'NGS Reads', path: ['File', 'Import Data', 'Traces & Reads'] },
  { id: 'file-imp-vec-cat', label: 'Built-In Vectors', path: ['File', 'Import Data', 'Vector Catalog'] },
  { id: 'file-imp-twist', label: 'Custom Vector QC', path: ['File', 'Import Data', 'Vector Catalog'] },
  { id: 'file-imp-ncbi-uniprot', label: 'NCBI & UniProt', path: ['File', 'Import Data', 'Databases'] },
  { id: 'file-imp-primer-database', label: 'Primers', path: ['File', 'Import Data', 'Databases'] },
  { id: 'file-imp-enzyme-database', label: 'Restriction Enzymes', path: ['File', 'Import Data', 'Databases'] },
  { id: 'file-imp-merge-mbc', label: 'Merge Session', path: ['File', 'Import Data', 'Session'] },
  { id: 'file-imp-prefs-json', label: 'Import Preferences', path: ['File', 'Import Data', 'Preferences'] },
  { id: 'file-exp-gb', label: 'Export GenBank', path: ['File', 'Export Sequences'], shortcut: 'Mod+Shift+E' },
  { id: 'file-exp-fasta', label: 'Export FASTA', path: ['File', 'Export Sequences'], shortcut: 'Mod+Shift+S' },
  { id: 'file-exp-embl', label: 'Export EMBL', path: ['File', 'Export Sequences'] },
  { id: 'file-exp-gff3', label: 'Export GFF3', path: ['File', 'Export Sequences'] },
  { id: 'file-exp-convert-genbank', label: 'Convert GenBank…', path: ['File', 'Export Sequences'] },
  { id: 'file-exp-ncbi-tbl', label: 'GenBank Submission', path: ['File', 'Export Sequences'] },
  { id: 'file-exp-sel-fasta', label: 'Batch FASTA', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-sel-fastastq', label: 'Reads as FASTQ', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-mbc-json', label: 'Export MBC JSON', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-folder-mbc', label: 'Export Folder as MBC', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-folder-gb', label: 'Export Folder', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-lineage-gb', label: 'Export Lineage', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-consensus-fa', label: 'Export Consensus', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-exp-svg-img', label: 'Save SVG Map', path: ['File', 'Batch & SVG Export'] },
  { id: 'file-print-cmd', label: 'Print / Export PDF', path: ['File', 'Print & PDF'], shortcut: 'Mod+P' },
  { id: 'file-quit-cmd', label: 'Quit MolBioCraft', path: ['File'], shortcut: 'Mod+Q' },
  { id: 'edit-copy-seq', label: 'Copy Sequence', path: ['Edit', 'Selection'], shortcut: 'Mod+C' },
  { id: 'edit-sel-all', label: 'Select Sequence', path: ['Edit', 'Selection'], shortcut: 'Mod+A' },
  { id: 'edit-find-doc', label: 'Find in Sequence', path: ['Edit', 'Find & Navigate'], shortcut: 'Mod+F' },
  { id: 'edit-next-feat', label: 'Next Feature', path: ['Edit', 'Find & Navigate'], shortcut: 'Mod+G' },
  { id: 'edit-find-dups', label: 'Find Duplicates…', path: ['Edit', 'Find & Navigate'] },
  { id: 'edit-batch-rename', label: 'Batch Rename…', path: ['Edit', 'Find & Navigate'] },
  { id: 'view-back', label: 'Back', path: ['View', 'History'], shortcut: 'Mod+[' },
  { id: 'view-fwd', label: 'Forward', path: ['View', 'History'], shortcut: 'Mod+]' },
  { id: 'view-filter-folder', label: 'Filter Folder', path: ['View', 'Search & Filter'], shortcut: 'Mod+Alt+F' },
  { id: 'view-search-tools', label: 'Command Palette', path: ['View', 'Search & Filter'], shortcut: 'Mod+K' },
  { id: 'view-search-project', label: 'Search Project…', path: ['View', 'Search & Filter'] },
  { id: 'view-tog-sidebar', label: 'Project Sidebar', path: ['View', 'Panels'] },
  { id: 'view-tog-doctable', label: 'Document Table', path: ['View', 'Panels'] },
  { id: 'view-tog-inspector', label: 'Inspector', path: ['View', 'Panels'], shortcut: 'Mod+Alt+I' },
  { id: 'view-split-tb', label: 'Document Table Below Viewer', path: ['View', 'Split & Expand'] },
  { id: 'view-split-lr', label: 'Document Table Beside Viewer', path: ['View', 'Split & Expand'] },
  { id: 'view-expand-doc', label: 'Expand Viewer', path: ['View', 'Split & Expand'], shortcut: 'Mod+Shift+O' },
  { id: 'view-docsplit-single', label: 'Single Pane', path: ['View', 'Document Split'] },
  { id: 'view-docsplit-side', label: 'Side by Side', path: ['View', 'Document Split'] },
  { id: 'view-docsplit-stacked', label: 'Top and Bottom', path: ['View', 'Document Split'] },
  { id: 'view-map-gallery', label: 'Map Gallery', path: ['View'], nativeId: 'view:map-gallery', rule: 'multi-record-view' },
  { id: 'view-compare-table', label: 'Compare Table', path: ['View'], nativeId: 'view:compare-table', rule: 'multi-record-view' },
  { id: 'view-restore-default-layout', label: 'Restore Default Layout', path: ['View'] },
  { id: 'view-lay-split', label: 'Split Map & Sequence', path: ['View', 'Map Layout'], shortcut: 'Mod+Alt+1' },
  { id: 'view-lay-circ', label: 'Circular Map', path: ['View', 'Map Layout'], shortcut: 'Mod+Alt+2' },
  { id: 'view-lay-lin', label: 'Linear Sequence', path: ['View', 'Map Layout'], shortcut: 'Mod+Alt+3' },
  { id: 'view-set-origin', label: 'Set Origin', path: ['View', 'Map Layout'], shortcut: 'Mod+Shift+0' },
  { id: 'view-track-features', label: 'Features', path: ['View', 'Tracks'] },
  { id: 'view-track-primers', label: 'Primers', path: ['View', 'Tracks'] },
  { id: 'view-track-restriction-sites', label: 'Restriction Sites', path: ['View', 'Tracks'] },
  { id: 'view-track-orfs', label: 'ORFs', path: ['View', 'Tracks'] },
  { id: 'view-track-translation', label: 'Translation', path: ['View', 'Tracks'] },
  { id: 'view-track-gc-graph', label: 'GC Graph', path: ['View', 'Tracks'] },
  { id: 'view-track-hydropathy-graph', label: 'Hydropathy Graph', path: ['View', 'Tracks'] },
  { id: 'view-rotate-map', label: 'Rotate Circular Map…', path: ['View'] },
  { id: 'view-reset-rotation', label: 'Reset Rotation', path: ['View'] },
  { id: 'view-enz', label: 'Enzymes View', path: ['View', 'Studio Views'] },
  { id: 'view-annot', label: 'Annotations Table', path: ['View', 'Studio Views'] },
  { id: 'view-text', label: 'Flatfile View', path: ['View', 'Studio Views'] },
  { id: 'view-mfe', label: 'Secondary Structure', path: ['View', 'Studio Views'] },
  { id: 'view-lineage', label: 'History', path: ['View', 'Studio Views'] },
  { id: 'view-zoom-in', label: 'Zoom In', path: ['View', 'Zoom'], shortcut: 'Mod+=' },
  { id: 'view-zoom-out', label: 'Zoom Out', path: ['View', 'Zoom'], shortcut: 'Mod+-' },
  { id: 'view-zoom-100', label: 'Actual Size (100%)', path: ['View', 'Zoom'], shortcut: 'Mod+0' },
  { id: 'view-fit', label: 'Fit', path: ['View', 'Zoom'] },
  { id: 'view-reset-view', label: 'Reset View', path: ['View', 'Zoom'] },
  { id: 'view-tog-menu-func-info', label: 'Show Menu Function Info', path: ['View'] },
  { id: 'seq-rc', label: 'Reverse Complement', path: ['Sequence', 'Strand'], shortcut: 'Mod+Shift+R' },
  { id: 'seq-comp', label: 'Complement Only', path: ['Sequence', 'Strand'] },
  { id: 'seq-rev', label: 'Reverse Only', path: ['Sequence', 'Strand'] },
  { id: 'seq-back-translate', label: 'Back-Translate…', path: ['Sequence', 'Translation'] },
  { id: 'seq-translate', label: 'Translate Frames', path: ['Sequence', 'Translation'] },
  { id: 'seq-back-trans', label: 'Back Translate', path: ['Sequence', 'Translation'] },
  { id: 'seq-dna-rna', label: 'Convert DNA / RNA', path: ['Sequence', 'Translation'] },
  { id: 'seq-circ-tog', label: 'Circular Topology', path: ['Sequence', 'Topology & Edit'] },
  { id: 'seq-extract', label: 'Extract Region', path: ['Sequence', 'Topology & Edit'] },
  { id: 'seq-mutate', label: 'Mutate & Shuffle', path: ['Sequence', 'Topology & Edit'] },
  { id: 'seq-merge-sanger', label: 'Merge Reads', path: ['Sequence', 'Read Assembly'] },
  { id: 'seq-denovo', label: 'De Novo Assembly', path: ['Sequence', 'Read Assembly'] },
  { id: 'feat-add', label: 'Add Feature', path: ['Sequence', 'Features', 'Add & Detect'], shortcut: 'Mod+T' },
  { id: 'feat-detect', label: 'Detect Common Features', path: ['Sequence', 'Features', 'Add & Detect'] },
  { id: 'feat-protease', label: 'Add Tag / Protease', path: ['Sequence', 'Features', 'Add & Detect'] },
  { id: 'feat-manage-lib', label: 'Manage Library', path: ['Sequence', 'Features', 'Feature Library'] },
  { id: 'feat-transfer', label: 'Transfer Features', path: ['Sequence', 'Features', 'Feature Library'] },
  { id: 'feat-extract', label: 'Extract Features', path: ['Sequence', 'Features', 'Feature Library'] },
  { id: 'ann-orfs-dialog', label: 'Find ORFs…', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-from-documents-dialog', label: 'Annotate from Documents…', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-microsatellites-dialog', label: 'Microsatellite Analysis…', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-expression-dialog', label: 'Compare Expression Levels…', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-compare-dialog', label: 'Compare Annotations…', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-orfs', label: 'Show ORFs', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-glimmer', label: 'Predict Genes', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-cpg', label: 'CpG & Repeats', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-motifs', label: 'Find Motifs', path: ['Sequence', 'Annotate', 'Genes & ORFs'] },
  { id: 'ann-crispr', label: 'Find CRISPR Sites', path: ['Sequence', 'Annotate', 'CRISPR & Variants'] },
  { id: 'ann-freebayes', label: 'Call Variants', path: ['Sequence', 'Annotate', 'CRISPR & Variants'] },
  { id: 'ann-16s', label: '16S / ITS Taxonomy', path: ['Sequence', 'Annotate', 'CRISPR & Variants'] },
  { id: 'ann-bbduk', label: 'Trim NGS Reads', path: ['Sequence', 'Annotate', 'Read QC & Transfer'] },
  { id: 'ann-blast', label: 'Annotate by BLAST…', path: ['Sequence', 'Annotate', 'Read QC & Transfer'] },
  { id: 'ann-transfer', label: 'Transfer Features', path: ['Sequence', 'Annotate', 'Read QC & Transfer'] },
  { id: 'ann-prot-dom', label: 'Protein Domains', path: ['Sequence', 'Annotate', 'Protein & 3D'] },
  { id: 'ann-pdb', label: '3D Structure & Coils', path: ['Sequence', 'Annotate', 'Protein & 3D'] },
  { id: 'act-clone-dialog', label: 'Clone Insert into Vector…', path: ['Cloning'] },
  { id: 'act-validate-clone', label: 'Validate Clone…', path: ['Cloning'] },
  { id: 'act-rest-find-sites', label: 'Find Sites', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-rest-digest-dialog', label: 'Digest into Fragments…', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-rest-frag', label: 'Agarose Digest', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-rest-ligate', label: 'Ligate Fragments', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-rest-clone', label: 'Restriction Ligation', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-anneal', label: 'Anneal Oligos', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-rest-noncut', label: 'Non-Cutters', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-pcr', label: 'PCR Amplification', path: ['Cloning', 'PCR Cloning'], shortcut: 'Mod+D' },
  { id: 'act-soe', label: 'Overlap PCR', path: ['Cloning', 'PCR Cloning'] },
  { id: 'act-mut-primer', label: 'Site Mutagenesis', path: ['Cloning', 'Mutagenesis'], shortcut: 'Mod+J' },
  { id: 'act-mut-shuffle', label: 'Point Mutation', path: ['Cloning', 'Mutagenesis'] },
  { id: 'act-gibson', label: 'Gibson Assembly', path: ['Cloning', 'Seamless Assembly'] },
  { id: 'act-goldengate', label: 'Golden Gate', path: ['Cloning', 'Seamless Assembly'] },
  { id: 'act-hifi', label: 'NEBuilder HiFi', path: ['Cloning', 'Seamless Assembly'] },
  { id: 'act-infusion', label: 'In-Fusion', path: ['Cloning', 'Seamless Assembly'] },
  { id: 'act-parts', label: 'Parts Cloning', path: ['Cloning', 'Seamless Assembly'] },
  { id: 'act-gw-lr', label: 'Gateway LR Reaction', path: ['Cloning', 'Gateway Cloning'] },
  { id: 'act-gw-bp', label: 'Gateway BP Reaction', path: ['Cloning', 'Gateway Cloning'] },
  { id: 'act-gw-annot-att', label: 'Annotate att Sites', path: ['Cloning', 'Gateway Cloning'] },
  { id: 'act-gw-add-attb', label: 'Add attB Sites', path: ['Cloning', 'Gateway Cloning'] },
  { id: 'act-ta-open', label: 'TA / GC Cloning', path: ['Cloning', 'TA & GC Cloning'] },
  { id: 'act-topo-open', label: 'TOPO Cloning', path: ['Cloning', 'TOPO Cloning'] },
  { id: 'enz-choose', label: 'Choose Enzymes', path: ['Cloning', 'Enzymes', 'Enzyme Views'], shortcut: 'Mod+E' },
  { id: 'enz-digest-dialog', label: 'Digest into Fragments…', path: ['Cloning', 'Enzymes', 'Enzyme Views'] },
  { id: 'enz-table', label: 'Enzymes Table', path: ['Cloning', 'Enzymes', 'Enzyme Views'] },
  { id: 'enz-noncut', label: 'Non-Cutters', path: ['Cloning', 'Enzymes', 'Site Screening'] },
  { id: 'enz-silent', label: 'Silent Mutations', path: ['Cloning', 'Enzymes', 'Site Screening'] },
  { id: 'enz-suppliers', label: 'Suppliers & Methylation', path: ['Cloning', 'Enzymes', 'Methylation'] },
  { id: 'enz-gel-prefs', label: 'Gel Preferences', path: ['Cloning', 'Enzymes', 'Methylation'] },
  { id: 'prm-design-dialog', label: 'Design Primers…', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-degenerate-dialog', label: 'Design Degenerate Primers…', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-test-saved-dialog', label: 'Test with Saved Primers…', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-db-binding-dialog', label: 'Find Where Stored Primers Bind…', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-add', label: 'Add Primer', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-add-list', label: 'Import Primers from Spreadsheet…', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-design-pair', label: 'Design Primer Pair', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-convert-oligo', label: 'Selection to Oligo', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-saved', label: 'Map Saved Primers', path: ['Cloning', 'Primers', 'Specificity'] },
  { id: 'prm-specificity', label: 'Binding Specificity', path: ['Cloning', 'Primers', 'Specificity'] },
  { id: 'prm-export', label: 'Export Primers', path: ['Cloning', 'Primers', 'Specificity'] },
  { id: 'prm-pcr-sim', label: 'In-Silico PCR', path: ['Cloning', 'Primers', 'PCR & Mutagenesis'], shortcut: 'Mod+D' },
  { id: 'prm-soe', label: 'Overlap PCR', path: ['Cloning', 'Primers', 'PCR & Mutagenesis'] },
  { id: 'prm-sdm', label: 'Site Mutagenesis', path: ['Cloning', 'Primers', 'PCR & Mutagenesis'], shortcut: 'Mod+J' },
  { id: 'prm-crispr', label: 'Find CRISPR Sites', path: ['Cloning', 'Primers', 'CRISPR Guides'] },
  { id: 'prm-crispr-editing', label: 'CRISPR Editing Analysis…', path: ['Cloning', 'Primers', 'CRISPR Guides'] },
  { id: 'prm-prefs', label: 'Primer Preferences', path: ['Cloning', 'Primers', 'Primer Settings'] },
  { id: 'top-align-msa-dialog', label: 'Multiple Alignment…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-pairwise-dialog', label: 'Pairwise Alignment…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-structures-dialog', label: 'Align Structures…', path: ['Tools', 'Alignment'], nativeId: 'align:structures-dialog', rule: 'align-structures' },
  { id: 'top-align-read-qc', label: 'Read QC Report…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-merge-pairs', label: 'Merge Paired Reads…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-trim-dialog', label: 'Trim Ends…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-denovo-dialog', label: 'De Novo Assemble…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-map-dialog', label: 'Map to Reference…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-expression-levels-dialog', label: 'Calculate Expression Levels…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-structural-variants-dialog', label: 'Find Structural Variants…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-translation-dialog', label: 'Translation Alignment…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-highlight-sites', label: 'Highlight Sites…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-add-to-alignment', label: 'Add Sequences to Alignment…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-mask-dialog', label: 'Mask Alignment…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-consensus-dialog', label: 'Generate Consensus…', path: ['Tools', 'Alignment'] },
  { id: 'top-align-msa-mafft', label: 'MAFFT-style Alignment', path: ['Tools', 'Alignment', 'Multiple Alignment'], shortcut: 'Mod+Alt+A' },
  { id: 'top-align-msa-clustalo', label: 'Clustal-style Alignment', path: ['Tools', 'Alignment', 'Multiple Alignment'] },
  { id: 'top-align-msa-muscle', label: 'MUSCLE-style Alignment', path: ['Tools', 'Alignment', 'Multiple Alignment'] },
  { id: 'top-align-pairwise-nw', label: 'Global (Needleman-Wunsch)', path: ['Tools', 'Alignment', 'Pairwise & Dotplot'] },
  { id: 'top-align-pairwise-sw', label: 'Local (Smith-Waterman)', path: ['Tools', 'Alignment', 'Pairwise & Dotplot'] },
  { id: 'top-align-dotplot', label: 'K-mer Dotplot', path: ['Tools', 'Alignment', 'Pairwise & Dotplot'] },
  { id: 'top-align-map-ref', label: 'Map Reads', path: ['Tools', 'Alignment', 'Read Mapping & Contigs'] },
  { id: 'top-align-denovo', label: 'De Novo Assembly', path: ['Tools', 'Alignment', 'Read Mapping & Contigs'] },
  { id: 'top-align-sanger-contig', label: 'Sanger Contigs', path: ['Tools', 'Alignment', 'Read Mapping & Contigs'] },
  { id: 'top-align-whole-genome', label: 'Genome Synteny', path: ['Tools', 'Alignment', 'Genome Alignment'] },
  { id: 'top-align-gen-consensus', label: 'Generate Consensus', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-align-concat', label: 'Concatenate Sequences', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-align-mask-lowcomp', label: 'Mask Homopolymers', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-align-export-consensus', label: 'Export Consensus', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-align-haplotype-partitioner', label: 'Haplotype & Allele Partitioner', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-align-ext-cli-suite', label: 'External CLI Suite', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-phylo-build-tree', label: 'Build Tree…', path: ['Tools', 'Phylogenetics'] },
  { id: 'top-phylo-compute-distances', label: 'Compute Distances…', path: ['Tools', 'Phylogenetics'] },
  { id: 'top-phylo-timetree', label: 'Compute Timetree…', path: ['Tools', 'Phylogenetics'] },
  { id: 'top-phylo-condense-tree', label: 'Condense Tree…', path: ['Tools', 'Phylogenetics'] },
  { id: 'top-phylo-gene-dups', label: 'Gene Duplication Inference…', path: ['Tools', 'Phylogenetics'] },
  { id: 'top-phylo-consensus-tree', label: 'Consensus Tree…', path: ['Tools', 'Phylogenetics'] },
  { id: 'top-phylo-tree-ml', label: 'Maximum Likelihood', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], shortcut: 'Mod+Alt+T' },
  { id: 'top-phylo-tree-fasttree', label: 'FastTree (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-phyml', label: 'PhyML (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-raxml', label: 'RAxML (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-mrbayes', label: 'MrBayes (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-nj', label: 'Neighbor-Joining', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-me', label: 'Minimum Evolution', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-upgma', label: 'UPGMA Clustering', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-tree-mp', label: 'Maximum Parsimony', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'] },
  { id: 'top-phylo-usertree', label: 'Analyze User Tree', path: ['Tools', 'Phylogenetics', 'Ancestral States'] },
  { id: 'top-phylo-ancestors-ml', label: 'Ancestors (ML)', path: ['Tools', 'Phylogenetics', 'Ancestral States'] },
  { id: 'top-phylo-ancestors-mp', label: 'Ancestors (Parsimony)', path: ['Tools', 'Phylogenetics', 'Ancestral States'] },
  { id: 'top-phylo-models-best', label: 'Best Fit Models', path: ['Tools', 'Phylogenetics', 'Substitution Models'] },
  { id: 'top-phylo-models-matrix', label: 'Rate Matrix', path: ['Tools', 'Phylogenetics', 'Substitution Models'] },
  { id: 'top-phylo-models-disparity', label: 'Homogeneity Test', path: ['Tools', 'Phylogenetics', 'Substitution Models'] },
  { id: 'top-phylo-data', label: 'Alignment Explorer', path: ['Tools', 'Phylogenetics', 'Codon Usage & Data'] },
  { id: 'top-phylo-models-composition', label: 'Codon Composition', path: ['Tools', 'Phylogenetics', 'Codon Usage & Data'] },
  { id: 'top-phylo-models-rscu', label: 'Codon Usage (RSCU)', path: ['Tools', 'Phylogenetics', 'Codon Usage & Data'] },
  { id: 'top-phylo-distance', label: 'Pairwise Distances', path: ['Tools', 'Phylogenetics', 'Distances & Diversity'] },
  { id: 'top-phylo-diversity', label: 'Population Diversity', path: ['Tools', 'Phylogenetics', 'Distances & Diversity'] },
  { id: 'top-phylo-selection', label: 'Codon Selection (dN/dS)', path: ['Tools', 'Phylogenetics', 'Selection & Rates'] },
  { id: 'top-phylo-rates', label: 'Gamma Site Rates', path: ['Tools', 'Phylogenetics', 'Selection & Rates'] },
  { id: 'top-phylo-clocks', label: 'Molecular Clocks', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'] },
  { id: 'top-phylo-diagnose', label: 'Variant Impact', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'] },
  { id: 'top-phylo-species-delim', label: 'Species Delimitation', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'] },
  { id: 'top-phylo-hpc-phylo-job', label: 'HPC Phylogeny Job Builder', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'] },
  { id: 'tools-gel', label: 'Agarose Gel', path: ['Tools', 'Gel & Calculators'], shortcut: 'Mod+Shift+G' },
  { id: 'tools-calc', label: 'DNA Calculations', path: ['Tools', 'Gel & Calculators'], shortcut: 'Mod+Shift+M' },
  { id: 'tools-blast', label: 'BLAST Search', path: ['Tools', 'BLAST & Vectors'], shortcut: 'Mod+Shift+B' },
  { id: 'tools-vec-cat', label: 'Vector Catalog', path: ['Tools', 'BLAST & Vectors'] },
  { id: 'tools-vec-arch', label: 'Vector Architect', path: ['Tools', 'BLAST & Vectors'] },
  { id: 'tools-db-explorer', label: 'NCBI & UniProt', path: ['Tools', 'Databases'] },
  { id: 'tools-primer-database', label: 'Primers', path: ['Tools', 'Databases'] },
  { id: 'tools-enzyme-database', label: 'Restriction Enzymes', path: ['Tools', 'Databases'] },
  { id: 'tools-make-blast-db', label: 'Make BLAST Database from Selection…', path: ['Tools', 'Databases'] },
  { id: 'tools-local-blast-dbs', label: 'Local BLAST DBs', path: ['Tools', 'Databases'] },
  { id: 'tools-blast-setup', label: 'BLAST Setup', path: ['Tools', 'Databases'] },
  { id: 'tools-extract-ann', label: 'Extract Features', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-mask-sel', label: 'Mask Selection', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-mask-lowcomp', label: 'Mask Homopolymers', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-concat-seqs', label: 'Concatenate', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-gen-consensus', label: 'Generate Consensus', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-sanger', label: 'Sanger Studio', path: ['Tools', 'Sequencing & NGS'] },
  { id: 'tools-ngs', label: 'NGS Assembly', path: ['Tools', 'Sequencing & NGS'] },
  { id: 'tools-synteny', label: 'Genome Variants', path: ['Tools', 'Sequencing & NGS'] },
  { id: 'tools-gb-sub', label: 'GenBank Submission', path: ['Tools', 'Sequencing & NGS'] },
  { id: 'tools-pipelines', label: 'Guided Pipelines', path: ['Tools', 'Pipelines'], shortcut: 'Mod+Shift+Y' },
  { id: 'tools-workflows', label: 'Lineage Manager', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-oligo', label: 'Annealed Oligo Cloning', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-batch-rest', label: 'Batch Restriction', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-align-tree-run', label: 'Align & Build Tree', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-mafft', label: 'Multi-Engine MSA', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-map-asm', label: 'Map & Assemble', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-apply-var', label: 'Apply Variants', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-manage', label: 'Manage Workflows…', path: ['Tools', 'Batch Workflows'] },
  { id: 'tools-wf-run', label: 'Run Workflow…', path: ['Tools', 'Batch Workflows'] },
  { id: 'tools-wf-group-name', label: 'Group by Prefix', path: ['Tools', 'Batch Workflows'] },
  { id: 'tools-wf-mod-intervals', label: 'Modify Intervals', path: ['Tools', 'Batch Workflows'] },
  { id: 'tools-wf-random-sample', label: 'Sample Sequences', path: ['Tools', 'Batch Workflows'] },
  { id: 'tools-wf-set-cds', label: 'Set CDS Translation', path: ['Tools', 'Batch Workflows'] },
  { id: 'tools-plugin-euk-gene', label: 'Eukaryotic Gene Predictor', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-microbial-gene', label: 'Microbial Gene Predictor', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-crispr-arrays', label: 'CRISPR Repeat Array Finder', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-tandem-repeats', label: 'Microsatellite & Tandem Repeats', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-haplotype-part', label: 'Haplotype & Allele Partitioner', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-taxonomic-class', label: 'Taxonomic Sequence Classifier', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-species-delim', label: 'Species Delimitation', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-protein-domains', label: 'Protein Domains & Epitopes', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-tm-topology', label: 'Transmembrane & Signal Topology', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-adapter-trimmer', label: 'Adapter & Quality Read Trimmer', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-synteny-blocks', label: 'Whole-Genome Synteny Blocks', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-hpc-phylo', label: 'HPC Phylogeny Job Builder', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-ext-cli', label: 'External CLI Suite', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-prefs', label: 'Preferences', path: ['Tools', 'Settings'], shortcut: 'Mod+Shift+P' },
  { id: 'help-shortcuts', label: 'Keyboard Shortcuts', path: ['Help', 'Guides'] },
  { id: 'help-vec-guide', label: 'Vector Guide', path: ['Help', 'Guides'] },
  { id: 'help-tutorials', label: 'Sample Tutorial', path: ['Help', 'Guides'] },
  { id: 'help-examples', label: 'Evolution Examples…', path: ['Help', 'Load Example Data'] },
  { id: 'help-bench-genome', label: '500 kbp Annotated Genome', path: ['Help', 'Load Example Data'] },
  { id: 'help-bench-protein', label: '10,000 aa Protein', path: ['Help', 'Load Example Data'] },
  { id: 'help-updates', label: 'Check for Updates', path: ['Help', 'About'] },
  { id: 'help-about', label: 'About MolBioCraft', path: ['Help', 'About'] },
  { id: 'view-no-tabs', label: 'No tabs open', path: ['View', 'Open Tabs'] },
];

/** Commands whose label follows state; the menubar node supplies the label, the key comes from here. */
const DYNAMIC_LABEL_COMMANDS: readonly CommandSpec[] = [
  { id: 'app-theme-toggle', label: 'Dark Appearance', path: ['MolBioCraft', 'Settings'], shortcut: 'Mod+Shift+L', dynamicLabel: true },
  { id: 'edit-undo-cmd', label: 'Undo', path: ['Edit'], shortcut: 'Mod+Z', dynamicLabel: true },
  { id: 'edit-redo-cmd', label: 'Redo', path: ['Edit'], shortcut: 'Mod+Shift+Z', dynamicLabel: true },
  { id: 'help-panel', label: 'Show Help Panel', path: ['Help', 'Guides'], shortcut: 'F1', dynamicLabel: true },
];

/** View › Studios: one command per studio of the studio registry, under its name and ⌘-digit. */
const STUDIO_COMMANDS: readonly CommandSpec[] = STUDIOS.map((s) => ({
  id: `view-studio-${s.id}`,
  label: s.name,
  path: ['View', 'Studios'],
  ...(s.digit ? { shortcut: `Mod+${s.digit}` } : {}),
}));

/**
 * Id prefixes of the commands the menubar yields at render time instead of listing: the table
 * columns and presets, Open Tabs, the vector presets, Export › Alignment Image (only while an
 * alignment is active) and the saved workflows under Tools › Batch Workflows.
 */
export const GENERATED_COMMAND_PREFIXES: readonly string[] = ['view-cols-', 'view-tab-doc-', 'act-vec-', 'file-exp-aln-img-', 'tools-wf-run-'];
export const isGeneratedCommand = (id: string): boolean => GENERATED_COMMAND_PREFIXES.some((p) => id.startsWith(p));

export const COMMANDS: readonly CommandSpec[] = [...MENUBAR_COMMANDS, ...DYNAMIC_LABEL_COMMANDS, ...STUDIO_COMMANDS];

export const COMMAND_BY_ID: ReadonlyMap<string, CommandSpec> = new Map(COMMANDS.map((c) => [c.id, c]));

/** The registry entry for `id`; a menu node naming an id the registry lacks is a programming error. */
export function command(id: string): CommandSpec {
  const c = COMMAND_BY_ID.get(id);
  if (!c) throw new Error(`The command registry has no command "${id}"`);
  return c;
}

/**
 * Second keys of registry commands that no menu shows: D0017 (3)'s ⌥⌘S for Save Session and ⇧⌘F for
 * the Command Palette (each for one release, then removed), Ctrl+Y for Redo (the document undo listener), and the two native Edit keys the
 * in-window Edit › Selection shows as ⌘C and ⌘A until US-01M6Q159 builds the native menu from here.
 */
export const SECOND_KEYS: readonly { shortcut: string; commandId: string }[] = [
  { shortcut: 'Mod+Alt+S', commandId: 'file-save-mbc' },
  { shortcut: 'Mod+Shift+F', commandId: 'view-search-tools' },
  { shortcut: 'Mod+Y', commandId: 'edit-redo-cmd' },
  { shortcut: 'Mod+Shift+C', commandId: 'edit-copy-seq' },
  { shortcut: 'Mod+Shift+A', commandId: 'edit-sel-all' },
];

/** Keys the platform owns: ⌘K (the palette), ⌘Q, ⌘W (the window) and the clipboard's ⌘C, ⌘V, ⌘X. */
export const PLATFORM_SHORTCUTS: readonly string[] = ['Mod+K', 'Mod+Q', 'Mod+W', 'Mod+C', 'Mod+V', 'Mod+X'];

/** Every key a registry command takes: its shortcut and its second keys, each once. */
export function registryShortcuts(): string[] {
  return [...new Set([
    ...COMMANDS.flatMap((c) => (c.shortcut ? [c.shortcut] : [])),
    ...SECOND_KEYS.map((k) => k.shortcut),
  ])];
}

/** The label a menu shows for a registry shortcut on `os` ('⇧⌘E' on macOS, 'Ctrl+Shift+E' elsewhere). */
export function formatCommandShortcut(shortcut: string | undefined, os: SupportedOS): string | undefined {
  if (!shortcut) return undefined;
  const parts = shortcut.split('+');
  if (parts[0] !== 'Mod') return shortcut;
  const key = parts[parts.length - 1];
  return formatPlatformShortcut(key, os, { alt: parts.includes('Alt'), shift: parts.includes('Shift') });
}

/** The toolbar dropdowns, each a named group of the menubar: the submenus it shows, by path. */
export type ToolbarGroupId = 'add' | 'import' | 'export' | 'session' | 'workflows' | 'align' | 'tree' | 'primers' | 'cloning';
export const TOOLBAR_GROUPS: Readonly<Record<ToolbarGroupId, readonly (readonly string[])[]>> = {
  add: [['File', 'New Session']],
  import: [['File', 'Import Data']],
  export: [['File', 'Export Sequences']],
  session: [['File', 'New Session'], ['File', 'Open Session'], ['File', 'Save Session'], ['File', 'Project Backup']],
  workflows: [['Tools', 'Pipelines'], ['Tools', 'Batch Workflows'], ['Tools', 'Bioinformatics Plugins']],
  align: [['Tools', 'Alignment']],
  tree: [['Tools', 'Phylogenetics']],
  primers: [['Cloning', 'Primers']],
  cloning: [['Cloning']],
};

/** Structural view of a menu node, so this module needs no React component. */
export interface RegistryMenuNode {
  kind: string;
  id?: string;
  label?: string;
  shortcut?: string;
  /** A key the row shows but the menu does not bind (the Command Palette's ⌘K, owned by its listener). */
  shortcutHint?: string;
  description?: string;
  disabled?: boolean;
  children?: RegistryMenuNode[];
  onSelect?: () => void;
  onToggle?: () => void;
}

/** The node at `path` (its top menu label first) in the menubar, or undefined. */
export function menubarNodeAt<T extends RegistryMenuNode>(
  trees: readonly (readonly T[])[], topLabels: readonly string[], path: readonly string[]
): { label: string; children: T[] } | undefined {
  const top = topLabels.indexOf(path[0]);
  if (top < 0) return undefined;
  let node: { label: string; children: T[] } = { label: path[0], children: [...trees[top]] };
  for (const label of path.slice(1)) {
    const next = node.children.find((n) => n.kind === 'submenu' && n.label === label);
    if (!next?.children) return undefined;
    node = { label, children: next.children as T[] };
  }
  return node;
}

/**
 * A toolbar dropdown's items: the menubar's own nodes for its group (the same ids, labels, keys,
 * availability and handlers). A one-submenu group shows that submenu's items; a larger group shows
 * each of its submenus. A group the menubar no longer holds is an error, not an empty menu.
 */
export function toolbarMenuItems<T extends RegistryMenuNode>(
  trees: readonly (readonly T[])[], topLabels: readonly string[], id: ToolbarGroupId
): T[] {
  const paths = TOOLBAR_GROUPS[id];
  const groups = paths.map((p) => {
    const node = menubarNodeAt(trees, topLabels, p);
    if (!node) throw new Error(`The toolbar's ${id} group names ${p.join(' › ')}, which the menubar does not hold`);
    return { path: p, node };
  });
  if (groups.length === 1) return groups[0].node.children;
  return groups.map(({ path }) => {
    const parent = menubarNodeAt(trees, topLabels, path.slice(0, -1))!;
    return parent.children.find((n) => n.kind === 'submenu' && n.label === path[path.length - 1])!;
  });
}

/** A menubar command as ⌘K lists it: the menubar's own label, key, availability and handler. */
export interface PaletteCommand {
  id: string;
  label: string;
  /** Top menu, submenus, then the label. */
  path: string[];
  shortcut?: string;
  disabled: boolean;
  /** Why it is disabled: the item's own description, else its nearest disabled submenu's. */
  reason?: string;
  run: () => void;
}

/** Every command and checkbox leaf of the menubar, in menu order, each id once (its first place). */
export function menubarCommands(trees: readonly (readonly RegistryMenuNode[])[], topLabels: readonly string[]): PaletteCommand[] {
  const out: PaletteCommand[] = [];
  const seen = new Set<string>();
  const walk = (nodes: readonly RegistryMenuNode[], path: string[], disabled: boolean, reason: string | undefined) => {
    for (const n of nodes) {
      const off = disabled || Boolean(n.disabled);
      const why = n.disabled && n.description ? n.description : reason;
      if (n.kind === 'submenu' && n.children) {
        walk(n.children, [...path, n.label ?? ''], off, why);
        continue;
      }
      const run = n.kind === 'command' ? n.onSelect : n.kind === 'checkbox' ? n.onToggle : undefined;
      if (!run || !n.id || seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({
        id: n.id, label: n.label ?? '', path: [...path, n.label ?? ''], shortcut: n.shortcut || n.shortcutHint || undefined,
        disabled: off, reason: off ? (n.disabled && n.description ? n.description : why) : undefined, run,
      });
    }
  };
  trees.forEach((t, i) => walk(t, [topLabels[i]], false, undefined));
  return out;
}

/**
 * ⌘K's matches for `query`: every command whose label or path contains it, ranked exact label,
 * label prefix, label word, label, then path; ties keep menu order.
 */
export function rankPaletteCommands<T extends { label: string; path: readonly string[] }>(commands: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...commands];
  const rank = (c: T): number => {
    const l = c.label.toLowerCase();
    if (l === q) return 0;
    if (l.startsWith(q)) return 1;
    if (l.split(/[^a-z0-9]+/).some((w) => w.startsWith(q))) return 2;
    if (l.includes(q)) return 3;
    return c.path.join(' › ').toLowerCase().includes(q) ? 4 : 9;
  };
  return commands.map((c, i) => ({ c, i, r: rank(c) })).filter((x) => x.r < 9).sort((a, b) => a.r - b.r || a.i - b.i).map((x) => x.c);
}
