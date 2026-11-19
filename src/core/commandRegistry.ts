// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The command registry (US-01M6Q1N2, PRD FR-4): each in-window command once, with its id, label,
 * menu path and shortcut. The in-window menubar reads its labels and shortcuts from here, and the
 * toolbar dropdowns, ⌘K and the reserved operation shortcuts are projections of the menubar or of
 * this list, so a label or key changed here changes everywhere it is shown.
 *
 * The metadata is static, so a script can read paths and keys without mounting the App: the native
 * macOS menu is generated from it (nativeMenuSpec, US-01M6Q159); the handlers and availability are bound at render time by the App's
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
  /**
   * It is enabled with no session open, as the in-window menubar shows it; its native item is then
   * enabled too (D0262: native enabled state follows the in-window availability).
   */
  readonly noSession?: true;
  /** The native item's key where AppKit reserves `shortcut` or it would clash off macOS (D0261 (3)). */
  readonly nativeShortcut?: string;
}

/** The menubar's commands, in menu order. */
const MENUBAR_COMMANDS: readonly CommandSpec[] = [
  { id: 'app-about-modal', label: 'About MolBioCraft', path: ['MolBioCraft', 'About MolBioCraft'], nativeId: 'app:about', noSession: true },
  { id: 'app-prefs-open', label: 'Preferences', path: ['MolBioCraft', 'Settings'], shortcut: 'Mod+,', nativeId: 'app:preferences', noSession: true },
  { id: 'app-quit-cmd', label: 'Quit MolBioCraft', path: ['MolBioCraft'], shortcut: 'Mod+Q', nativeId: 'app:request-quit', noSession: true },
  { id: 'file-ns-blank', label: 'Blank Session', path: ['File', 'New Session'], shortcut: 'Mod+Alt+N', nativeId: 'new-session:blank', noSession: true },
  { id: 'file-ns-new-seq', label: 'New Sequence', path: ['File', 'New Session', 'Sequences & Vectors'], shortcut: 'Mod+N', nativeId: 'new-session:sequence', noSession: true },
  { id: 'file-ns-vec-cat', label: 'Vector Catalog', path: ['File', 'New Session', 'Sequences & Vectors'], nativeId: 'new-session:vector-catalog', noSession: true },
  { id: 'file-ns-vec-arch', label: 'Custom Vector', path: ['File', 'New Session', 'Sequences & Vectors'], nativeId: 'new-session:vector-architect', noSession: true },
  { id: 'file-ns-twist', label: 'Vector QC', path: ['File', 'New Session', 'Sequences & Vectors'], nativeId: 'new-session:twist-onboarding', noSession: true },
  { id: 'file-ns-text-doc', label: 'Flatfile Document', path: ['File', 'New Session', 'Sequences & Vectors'], nativeId: 'new-session:text-doc', noSession: true },
  { id: 'file-ns-new-text-doc', label: 'Text Document', path: ['File', 'New Session', 'Sequences & Vectors'], noSession: true },
  { id: 'file-ns-new-enzyme-set', label: 'Enzyme Set', path: ['File', 'New Session', 'Sequences & Vectors'], noSession: true },
  { id: 'file-ns-clone-rest', label: 'Restriction Cloning', path: ['File', 'New Session', 'Cloning & Primers'], nativeId: 'new-session:cloning-restriction', noSession: true },
  { id: 'file-ns-clone-asm', label: 'Seamless Assembly', path: ['File', 'New Session', 'Cloning & Primers'], nativeId: 'new-session:cloning-assembly', noSession: true },
  { id: 'file-ns-primers', label: 'Primers & CRISPR', path: ['File', 'New Session', 'Cloning & Primers'], nativeId: 'new-session:primers-crispr', noSession: true },
  { id: 'file-ns-enzymes', label: 'Enzyme Digest', path: ['File', 'New Session', 'Cloning & Primers'], nativeId: 'new-session:enzyme-set', noSession: true },
  { id: 'file-ns-align', label: 'Sequence Alignment', path: ['File', 'New Session', 'Alignment & Trees'], nativeId: 'new-session:align-task', noSession: true },
  { id: 'file-ns-phylo', label: 'Phylogenetic Tree', path: ['File', 'New Session', 'Alignment & Trees'], nativeId: 'new-session:phylo-task', noSession: true },
  { id: 'file-ns-sanger', label: 'Sanger Traces', path: ['File', 'New Session', 'Sequencing & Genomics'], nativeId: 'new-session:sanger-task', noSession: true },
  { id: 'file-ns-ngs', label: 'NGS & 3D Structure', path: ['File', 'New Session', 'Sequencing & Genomics'], nativeId: 'new-session:ngs-genomics', noSession: true },
  { id: 'file-ns-pipeline', label: 'Guided Pipeline', path: ['File', 'New Session', 'Sequencing & Genomics'], nativeId: 'new-session:pipeline-task', noSession: true },
  { id: 'file-ns-imp-files', label: 'Import Files', path: ['File', 'New Session', 'Starter & Import'], shortcut: 'Mod+I', nativeId: 'new-session:import-files', noSession: true },
  { id: 'file-ns-imp-clip', label: 'From Clipboard', path: ['File', 'New Session', 'Starter & Import'], shortcut: 'Mod+Shift+I', nativeId: 'new-session:import-clipboard', noSession: true },
  { id: 'file-ns-folder', label: 'New Folder', path: ['File', 'New Session', 'Starter & Import'], shortcut: 'Mod+Shift+N', nativeId: 'new-session:folder', noSession: true },
  { id: 'file-ns-samples', label: 'Sample Project', path: ['File', 'New Session', 'Starter & Import'], nativeId: 'new-session:sample-library', noSession: true },
  { id: 'file-open-mbc', label: 'Open Session', path: ['File', 'Open Session'], shortcut: 'Mod+O', nativeId: 'file:open-session', noSession: true },
  { id: 'file-merge-mbc', label: 'Merge Session', path: ['File', 'Open Session'], nativeId: 'file:merge-session' },
  { id: 'file-restore-auto', label: 'Restore Autosave', path: ['File', 'Open Session'], nativeId: 'file:restore-autosave', noSession: true },
  { id: 'file-save-mbc', label: 'Save Session', path: ['File', 'Save Session'], shortcut: 'Mod+S', nativeId: 'file:save-session' },
  { id: 'file-save-mbc-as', label: 'Save Session As', path: ['File', 'Save Session'], shortcut: 'Mod+Alt+Shift+S', nativeId: 'file:save-session-as' },
  { id: 'file-close-session', label: 'Close Session', path: ['File', 'Save Session'], shortcut: 'Mod+Shift+W', nativeId: 'file:close-session' },
  { id: 'file-rename-folder', label: 'Rename Folder', path: ['File', 'Folders'], nativeId: 'file:rename-folder' },
  { id: 'file-folder-color', label: 'Set Folder Color', path: ['File', 'Folders'], nativeId: 'file:set-folder-color' },
  { id: 'file-move-folder', label: 'Move to Folder', path: ['File', 'Folders'], nativeId: 'file:move-to-folder' },
  { id: 'file-toggle-fav', label: 'Toggle Favorite', path: ['File', 'Favorites & Trash'], nativeId: 'file:toggle-favorite' },
  { id: 'file-soft-delete', label: 'Move to Trash', path: ['File', 'Favorites & Trash'], nativeId: 'file:soft-delete' },
  { id: 'file-put-back', label: 'Restore from Trash', path: ['File', 'Favorites & Trash'], nativeId: 'file:restore-deleted', rule: 'trash-items' },
  { id: 'file-erase-all', label: 'Empty Trash', path: ['File', 'Favorites & Trash'], nativeId: 'file:erase-deleted', rule: 'trash-items' },
  { id: 'file-backup-mbc', label: 'Back Up Project', path: ['File', 'Project Backup'], nativeId: 'file:backup-data' },
  { id: 'file-restore-backup-mbc', label: 'Restore Backup', path: ['File', 'Project Backup'], nativeId: 'file:restore-backup', noSession: true },
  { id: 'file-import-prefs', label: 'Import Preferences', path: ['File', 'Preferences'], nativeId: 'file:import-preferences', noSession: true },
  { id: 'file-export-prefs', label: 'Export Preferences', path: ['File', 'Preferences'], nativeId: 'file:export-preferences', noSession: true },
  { id: 'file-imp-direct-files', label: 'Import Files', path: ['File', 'Import Data'], shortcut: 'Mod+I', nativeId: 'file:import-files', noSession: true },
  { id: 'file-imp-direct-folder', label: 'Import Folder', path: ['File', 'Import Data'], nativeId: 'file:import-folder', noSession: true },
  { id: 'file-imp-metadata', label: 'Metadata from Spreadsheet…', path: ['File', 'Import Data'], nativeId: 'file:import-metadata' },
  { id: 'file-imp-direct-clipboard', label: 'Import From Clipboard', path: ['File', 'Import Data'], shortcut: 'Mod+Shift+I', noSession: true },
  { id: 'file-imp-other-restore-backup', label: 'Restore Backup', path: ['File', 'Import Data', 'Import Other'], noSession: true },
  { id: 'file-imp-other-sample-docs', label: 'Sample Documents', path: ['File', 'Import Data', 'Import Other'], nativeId: 'file:import-samples', noSession: true },
  { id: 'file-imp-other-mbc-prefs', label: 'MolBioCraft Preferences', path: ['File', 'Import Data', 'Import Other'], noSession: true },
  { id: 'file-imp-other-new-db-conn', label: 'New Database Connection', path: ['File', 'Import Data', 'Import Other'], nativeId: 'file:import-ncbi-db', noSession: true },
  { id: 'file-imp-gb-fasta', label: 'Sequence Files', path: ['File', 'Import Data', 'Sequence Files'], shortcut: 'Mod+I', noSession: true },
  { id: 'file-imp-clipboard', label: 'From Clipboard', path: ['File', 'Import Data', 'Sequence Files'], shortcut: 'Mod+Shift+I', nativeId: 'file:import-clipboard', noSession: true },
  { id: 'file-imp-sanger', label: 'Sanger Traces', path: ['File', 'Import Data', 'Traces & Reads'], nativeId: 'file:import-sanger', noSession: true },
  { id: 'file-imp-ngs', label: 'NGS Reads', path: ['File', 'Import Data', 'Traces & Reads'], nativeId: 'file:import-ngs', noSession: true },
  { id: 'file-imp-vec-cat', label: 'Built-In Vectors', path: ['File', 'Import Data', 'Vector Catalog'], nativeId: 'file:import-vector-catalog', noSession: true },
  { id: 'file-imp-twist', label: 'Custom Vector QC', path: ['File', 'Import Data', 'Vector Catalog'], nativeId: 'file:import-twist-vector', noSession: true },
  { id: 'file-imp-ncbi-uniprot', label: 'NCBI & UniProt', path: ['File', 'Import Data', 'Databases'], noSession: true },
  { id: 'file-imp-primer-database', label: 'Primers', path: ['File', 'Import Data', 'Databases'], noSession: true },
  { id: 'file-imp-enzyme-database', label: 'Restriction Enzymes', path: ['File', 'Import Data', 'Databases'], noSession: true },
  { id: 'file-imp-merge-mbc', label: 'Merge Session', path: ['File', 'Import Data', 'Session'], noSession: true },
  { id: 'file-imp-prefs-json', label: 'Import Preferences', path: ['File', 'Import Data', 'Preferences'], noSession: true },
  { id: 'file-exp-gb', label: 'Export GenBank', path: ['File', 'Export Sequences'], shortcut: 'Mod+Shift+E', nativeId: 'file:save-gb', rule: 'export-active-document' },
  { id: 'file-exp-fasta', label: 'Export FASTA', path: ['File', 'Export Sequences'], shortcut: 'Mod+Shift+S', nativeId: 'file:save-fasta', rule: 'export-sequence' },
  { id: 'file-exp-embl', label: 'Export EMBL', path: ['File', 'Export Sequences'], nativeId: 'file:export-embl', rule: 'export-active-document' },
  { id: 'file-exp-gff3', label: 'Export GFF3', path: ['File', 'Export Sequences'], nativeId: 'file:export-gff3', rule: 'export-active-document' },
  { id: 'file-exp-convert-genbank', label: 'Convert GenBank…', path: ['File', 'Export Sequences'], nativeId: 'file:convert-genbank', noSession: true },
  { id: 'file-exp-ncbi-tbl', label: 'GenBank Submission', path: ['File', 'Export Sequences'] },
  { id: 'file-exp-sel-fasta', label: 'Batch FASTA', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-batch-fasta' },
  { id: 'file-exp-sel-fastastq', label: 'Reads as FASTQ', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-batch-fastq' },
  { id: 'file-exp-mbc-json', label: 'Export MBC JSON', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-mbc-json' },
  { id: 'file-exp-folder-mbc', label: 'Export Folder as MBC', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-folder-mbc' },
  { id: 'file-exp-folder-gb', label: 'Export Folder', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-folder-gb' },
  { id: 'file-exp-lineage-gb', label: 'Export Lineage', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-lineage' },
  { id: 'file-exp-consensus-fa', label: 'Export Consensus', path: ['File', 'Batch & SVG Export'], nativeId: 'file:export-consensus' },
  { id: 'file-exp-svg-img', label: 'Save SVG Map', path: ['File', 'Batch & SVG Export'], nativeId: 'file:save-svg-image' },
  { id: 'file-print-cmd', label: 'Print / Export PDF', path: ['File', 'Print & PDF'], shortcut: 'Mod+P', nativeId: 'file:print' },
  { id: 'file-quit-cmd', label: 'Quit MolBioCraft', path: ['File'], shortcut: 'Mod+Q', nativeId: 'file:quit', noSession: true },
  { id: 'edit-copy-seq', label: 'Copy Sequence', path: ['Edit', 'Selection'], shortcut: 'Mod+C', nativeShortcut: 'Mod+Shift+C', nativeId: 'edit:copy-sequence', rule: 'export-sequence' },
  { id: 'edit-sel-all', label: 'Select Sequence', path: ['Edit', 'Selection'], shortcut: 'Mod+A', nativeShortcut: 'Mod+Shift+A', nativeId: 'edit:select-all-sequence' },
  { id: 'edit-find-doc', label: 'Find in Sequence', path: ['Edit', 'Find & Navigate'], shortcut: 'Mod+F', nativeId: 'edit:find-in-doc' },
  { id: 'edit-next-feat', label: 'Next Feature', path: ['Edit', 'Find & Navigate'], shortcut: 'Mod+G', nativeId: 'edit:next-feature' },
  { id: 'edit-find-dups', label: 'Find Duplicates…', path: ['Edit', 'Find & Navigate'], nativeId: 'edit:find-duplicates' },
  { id: 'edit-batch-rename', label: 'Batch Rename…', path: ['Edit', 'Find & Navigate'], nativeId: 'edit:batch-rename' },
  { id: 'view-back', label: 'Back', path: ['View', 'History'], shortcut: 'Mod+[', nativeId: 'view:back' },
  { id: 'view-fwd', label: 'Forward', path: ['View', 'History'], shortcut: 'Mod+]', nativeId: 'view:forward' },
  { id: 'view-filter-folder', label: 'Filter Folder', path: ['View', 'Search & Filter'], shortcut: 'Mod+Alt+F', nativeId: 'view:filter-folder' },
  { id: 'view-search-tools', label: 'Command Palette', path: ['View', 'Search & Filter'], shortcut: 'Mod+K', nativeId: 'view:search-tools', noSession: true },
  { id: 'view-search-project', label: 'Search Project…', path: ['View', 'Search & Filter'], nativeId: 'view:search-project' },
  { id: 'view-tog-sidebar', label: 'Project Sidebar', path: ['View', 'Panels'], nativeShortcut: 'Mod+Ctrl+S', nativeId: 'view:toggle-sidebar' },
  { id: 'view-tog-doctable', label: 'Document Table', path: ['View', 'Panels'], nativeId: 'view:toggle-doctable' },
  { id: 'view-tog-inspector', label: 'Inspector', path: ['View', 'Panels'], shortcut: 'Mod+Alt+I', nativeId: 'view:toggle-inspector' },
  { id: 'view-split-tb', label: 'Document Table Below Viewer', path: ['View', 'Split & Expand'], nativeId: 'view:split-top-bottom' },
  { id: 'view-split-lr', label: 'Document Table Beside Viewer', path: ['View', 'Split & Expand'], nativeId: 'view:split-left-right' },
  { id: 'view-expand-doc', label: 'Expand Viewer', path: ['View', 'Split & Expand'], shortcut: 'Mod+Shift+O', nativeId: 'view:expand-doc-view' },
  { id: 'view-docsplit-single', label: 'Single Pane', path: ['View', 'Document Split'], nativeId: 'view:document-split-single' },
  { id: 'view-docsplit-side', label: 'Side by Side', path: ['View', 'Document Split'], nativeId: 'view:document-split-side-by-side' },
  { id: 'view-docsplit-stacked', label: 'Top and Bottom', path: ['View', 'Document Split'], nativeId: 'view:document-split-top-bottom' },
  { id: 'view-map-gallery', label: 'Map Gallery', path: ['View'], nativeId: 'view:map-gallery', rule: 'multi-record-view' },
  { id: 'view-compare-table', label: 'Compare Table', path: ['View'], nativeId: 'view:compare-table', rule: 'multi-record-view' },
  { id: 'view-restore-default-layout', label: 'Restore Default Layout', path: ['View'], nativeId: 'view:restore-default-layout' },
  { id: 'view-lay-split', label: 'Split Map & Sequence', path: ['View', 'Map Layout'], shortcut: 'Mod+Alt+1', nativeId: 'view:layout-split', rule: 'map-layout-circle' },
  { id: 'view-lay-circ', label: 'Circular Map', path: ['View', 'Map Layout'], shortcut: 'Mod+Alt+2', nativeId: 'view:layout-circular', rule: 'map-layout-circle' },
  { id: 'view-lay-lin', label: 'Linear Sequence', path: ['View', 'Map Layout'], shortcut: 'Mod+Alt+3', nativeId: 'view:layout-linear' },
  { id: 'view-set-origin', label: 'Set Origin', path: ['View', 'Map Layout'], shortcut: 'Mod+Shift+0', nativeId: 'view:set-origin', rule: 'set-origin' },
  { id: 'view-track-features', label: 'Features', path: ['View', 'Tracks'], nativeId: 'view:track-features', rule: 'track-features' },
  { id: 'view-track-primers', label: 'Primers', path: ['View', 'Tracks'], nativeId: 'view:track-primers', rule: 'track-primers' },
  { id: 'view-track-restriction-sites', label: 'Restriction Sites', path: ['View', 'Tracks'], nativeId: 'view:track-restriction-sites', rule: 'track-restriction-sites' },
  { id: 'view-track-orfs', label: 'ORFs', path: ['View', 'Tracks'], nativeId: 'view:track-orfs', rule: 'track-orfs' },
  { id: 'view-track-translation', label: 'Translation', path: ['View', 'Tracks'], nativeId: 'view:track-translation', rule: 'track-translation' },
  { id: 'view-track-gc-graph', label: 'GC Graph', path: ['View', 'Tracks'], nativeId: 'view:track-gc-graph', rule: 'track-gc-graph' },
  { id: 'view-track-hydropathy-graph', label: 'Hydropathy Graph', path: ['View', 'Tracks'], nativeId: 'view:track-hydropathy-graph', rule: 'track-hydropathy-graph' },
  { id: 'view-rotate-map', label: 'Rotate Circular Map…', path: ['View'], nativeId: 'view:rotate-map', rule: 'rotate-map' },
  { id: 'view-reset-rotation', label: 'Reset Rotation', path: ['View'], nativeId: 'view:reset-rotation', rule: 'rotate-map' },
  { id: 'view-enz', label: 'Enzymes View', path: ['View', 'Studio Views'], nativeId: 'view:enzymes' },
  { id: 'view-annot', label: 'Annotations Table', path: ['View', 'Studio Views'], nativeId: 'view:annotations' },
  { id: 'view-text', label: 'Flatfile View', path: ['View', 'Studio Views'], nativeId: 'view:text' },
  { id: 'view-mfe', label: 'Secondary Structure', path: ['View', 'Studio Views'], nativeId: 'view:secondary-structure' },
  { id: 'view-lineage', label: 'History', path: ['View', 'Studio Views'], nativeId: 'view:lineage' },
  { id: 'view-zoom-in', label: 'Zoom In', path: ['View', 'Zoom'], shortcut: 'Mod+=', nativeId: 'view:zoom-in', rule: 'zoom-map' },
  { id: 'view-zoom-out', label: 'Zoom Out', path: ['View', 'Zoom'], shortcut: 'Mod+-', nativeId: 'view:zoom-out', rule: 'zoom-map' },
  { id: 'view-zoom-100', label: 'Actual Size (100%)', path: ['View', 'Zoom'], shortcut: 'Mod+0', nativeId: 'view:zoom-reset', rule: 'zoom-map' },
  { id: 'view-fit', label: 'Fit', path: ['View', 'Zoom'], nativeId: 'view:fit', rule: 'fit-view' },
  { id: 'view-reset-view', label: 'Reset View', path: ['View', 'Zoom'], nativeId: 'view:reset-view', rule: 'fit-view' },
  { id: 'view-tog-menu-func-info', label: 'Show Menu Function Info', path: ['View'], noSession: true },
  { id: 'seq-rc', label: 'Reverse Complement', path: ['Sequence', 'Strand'], shortcut: 'Mod+Shift+R', nativeId: 'sequence:reverse-complement', rule: 'strand-transform' },
  { id: 'seq-comp', label: 'Complement Only', path: ['Sequence', 'Strand'], nativeId: 'sequence:complement-only', rule: 'strand-transform' },
  { id: 'seq-rev', label: 'Reverse Only', path: ['Sequence', 'Strand'], nativeId: 'sequence:reverse-only', rule: 'strand-transform' },
  { id: 'seq-back-translate', label: 'Back-Translate…', path: ['Sequence', 'Translation'], nativeId: 'sequence:back-translate-dialog' },
  { id: 'seq-translate', label: 'Translate Frames', path: ['Sequence', 'Translation'], nativeId: 'sequence:translate' },
  { id: 'seq-back-trans', label: 'Back Translate', path: ['Sequence', 'Translation'], nativeId: 'sequence:back-translate' },
  { id: 'seq-dna-rna', label: 'Convert DNA / RNA', path: ['Sequence', 'Translation'], nativeId: 'sequence:convert-dna-rna', rule: 'convert-dna-rna' },
  { id: 'seq-circ-tog', label: 'Circular Topology', path: ['Sequence', 'Topology & Edit'], nativeId: 'sequence:toggle-topology' },
  { id: 'seq-extract', label: 'Extract Region', path: ['Sequence', 'Topology & Edit'], nativeId: 'sequence:extract-region' },
  { id: 'seq-mutate', label: 'Mutate & Shuffle', path: ['Sequence', 'Topology & Edit'], nativeId: 'sequence:mutate-shuffle' },
  { id: 'seq-merge-sanger', label: 'Merge Reads', path: ['Sequence', 'Read Assembly'], nativeId: 'sequence:contig-assembly' },
  { id: 'seq-denovo', label: 'De Novo Assembly', path: ['Sequence', 'Read Assembly'], nativeId: 'sequence:denovo-assemble' },
  { id: 'feat-add', label: 'Add Feature', path: ['Sequence', 'Features', 'Add & Detect'], shortcut: 'Mod+T', nativeId: 'features:add' },
  { id: 'feat-detect', label: 'Detect Common Features', path: ['Sequence', 'Features', 'Add & Detect'], nativeId: 'features:detect-common' },
  { id: 'feat-protease', label: 'Add Tag / Protease', path: ['Sequence', 'Features', 'Add & Detect'], nativeId: 'features:add-protease' },
  { id: 'feat-manage-lib', label: 'Manage Library', path: ['Sequence', 'Features', 'Feature Library'], nativeId: 'features:manage-library' },
  { id: 'feat-transfer', label: 'Transfer Features', path: ['Sequence', 'Features', 'Feature Library'], nativeId: 'annotate:transfer' },
  { id: 'feat-extract', label: 'Extract Features', path: ['Sequence', 'Features', 'Feature Library'], nativeId: 'tools:extract-annotations' },
  { id: 'ann-orfs-dialog', label: 'Find ORFs…', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:find-orfs-dialog' },
  { id: 'ann-from-documents-dialog', label: 'Annotate from Documents…', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:from-documents-dialog' },
  { id: 'ann-microsatellites-dialog', label: 'Microsatellite Analysis…', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:microsatellites-dialog' },
  { id: 'ann-expression-dialog', label: 'Compare Expression Levels…', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:expression-dialog' },
  { id: 'ann-compare-dialog', label: 'Compare Annotations…', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:compare-dialog' },
  { id: 'ann-orfs', label: 'Show ORFs', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:find-orfs' },
  { id: 'ann-glimmer', label: 'Predict Genes', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:glimmer-genes' },
  { id: 'ann-cpg', label: 'CpG & Repeats', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:cpg-repeats' },
  { id: 'ann-motifs', label: 'Find Motifs', path: ['Sequence', 'Annotate', 'Genes & ORFs'], nativeId: 'annotate:find-motifs' },
  { id: 'ann-crispr', label: 'Find CRISPR Sites', path: ['Sequence', 'Annotate', 'CRISPR & Variants'], nativeId: 'annotate:find-crispr' },
  { id: 'ann-freebayes', label: 'Call Variants', path: ['Sequence', 'Annotate', 'CRISPR & Variants'], nativeId: 'annotate:freebayes-str' },
  { id: 'ann-16s', label: '16S / ITS Taxonomy', path: ['Sequence', 'Annotate', 'CRISPR & Variants'], nativeId: 'annotate:classify-16s' },
  { id: 'ann-bbduk', label: 'Trim NGS Reads', path: ['Sequence', 'Annotate', 'Read QC & Transfer'], nativeId: 'annotate:bbduk-trim' },
  { id: 'ann-blast', label: 'Annotate by BLAST…', path: ['Sequence', 'Annotate', 'Read QC & Transfer'], nativeId: 'annotate:blast' },
  { id: 'ann-transfer', label: 'Transfer Features', path: ['Sequence', 'Annotate', 'Read QC & Transfer'] },
  { id: 'ann-prot-dom', label: 'Protein Domains', path: ['Sequence', 'Annotate', 'Protein & 3D'], nativeId: 'annotate:protein-domains' },
  { id: 'ann-pdb', label: '3D Structure & Coils', path: ['Sequence', 'Annotate', 'Protein & 3D'], nativeId: 'annotate:coils-tm-pdb' },
  { id: 'act-clone-dialog', label: 'Clone Insert into Vector…', path: ['Cloning'], nativeId: 'actions:clone-dialog' },
  { id: 'act-validate-clone', label: 'Validate Clone…', path: ['Cloning'], nativeId: 'actions:validate-clone-dialog' },
  { id: 'act-rest-find-sites', label: 'Find Sites', path: ['Cloning', 'Restriction Cloning'], nativeId: 'enzymes:find-sites' },
  { id: 'act-rest-digest-dialog', label: 'Digest into Fragments…', path: ['Cloning', 'Restriction Cloning'], nativeId: 'enzymes:digest-dialog' },
  { id: 'act-rest-frag', label: 'Agarose Digest', path: ['Cloning', 'Restriction Cloning'] },
  { id: 'act-rest-ligate', label: 'Ligate Fragments', path: ['Cloning', 'Restriction Cloning'], nativeId: 'actions:ligate-fragments' },
  { id: 'act-rest-clone', label: 'Restriction Ligation', path: ['Cloning', 'Restriction Cloning'], nativeId: 'actions:restriction-cloning' },
  { id: 'act-anneal', label: 'Anneal Oligos', path: ['Cloning', 'Restriction Cloning'], nativeId: 'actions:anneal-oligos' },
  { id: 'act-rest-noncut', label: 'Non-Cutters', path: ['Cloning', 'Restriction Cloning'], nativeId: 'enzymes:noncutters' },
  { id: 'act-pcr', label: 'PCR Amplification', path: ['Cloning', 'PCR Cloning'], shortcut: 'Mod+D', nativeId: 'actions:pcr' },
  { id: 'act-soe', label: 'Overlap PCR', path: ['Cloning', 'PCR Cloning'], nativeId: 'actions:soe-pcr' },
  { id: 'act-mut-primer', label: 'Site Mutagenesis', path: ['Cloning', 'Mutagenesis'], shortcut: 'Mod+J', nativeId: 'actions:mutagenesis' },
  { id: 'act-mut-shuffle', label: 'Point Mutation', path: ['Cloning', 'Mutagenesis'] },
  { id: 'act-gibson', label: 'Gibson Assembly', path: ['Cloning', 'Seamless Assembly'], nativeId: 'actions:gibson' },
  { id: 'act-goldengate', label: 'Golden Gate', path: ['Cloning', 'Seamless Assembly'], nativeId: 'actions:golden-gate' },
  { id: 'act-hifi', label: 'NEBuilder HiFi', path: ['Cloning', 'Seamless Assembly'], nativeId: 'actions:hifi' },
  { id: 'act-infusion', label: 'In-Fusion', path: ['Cloning', 'Seamless Assembly'], nativeId: 'actions:in-fusion' },
  { id: 'act-parts', label: 'Parts Cloning', path: ['Cloning', 'Seamless Assembly'], nativeId: 'actions:parts-cloning' },
  { id: 'act-gw-lr', label: 'Gateway LR Reaction', path: ['Cloning', 'Gateway Cloning'] },
  { id: 'act-gw-bp', label: 'Gateway BP Reaction', path: ['Cloning', 'Gateway Cloning'] },
  { id: 'act-gw-annot-att', label: 'Annotate att Sites', path: ['Cloning', 'Gateway Cloning'], nativeId: 'actions:annotate-att' },
  { id: 'act-gw-add-attb', label: 'Add attB Sites', path: ['Cloning', 'Gateway Cloning'], nativeId: 'actions:add-attb' },
  { id: 'act-ta-open', label: 'TA / GC Cloning', path: ['Cloning', 'TA & GC Cloning'], nativeId: 'actions:ta-gc' },
  { id: 'act-topo-open', label: 'TOPO Cloning', path: ['Cloning', 'TOPO Cloning'], nativeId: 'actions:topo' },
  { id: 'enz-choose', label: 'Choose Enzymes', path: ['Cloning', 'Enzymes', 'Enzyme Views'], shortcut: 'Mod+E', nativeId: 'enzymes:choose' },
  { id: 'enz-digest-dialog', label: 'Digest into Fragments…', path: ['Cloning', 'Enzymes', 'Enzyme Views'] },
  { id: 'enz-table', label: 'Enzymes Table', path: ['Cloning', 'Enzymes', 'Enzyme Views'], nativeId: 'enzymes:table' },
  { id: 'enz-noncut', label: 'Non-Cutters', path: ['Cloning', 'Enzymes', 'Site Screening'] },
  { id: 'enz-silent', label: 'Silent Mutations', path: ['Cloning', 'Enzymes', 'Site Screening'], nativeId: 'enzymes:silent-mutations' },
  { id: 'enz-suppliers', label: 'Suppliers & Methylation', path: ['Cloning', 'Enzymes', 'Methylation'], nativeId: 'enzymes:suppliers', noSession: true },
  { id: 'enz-gel-prefs', label: 'Gel Preferences', path: ['Cloning', 'Enzymes', 'Methylation'], nativeId: 'prefs:gels', noSession: true },
  { id: 'prm-design-dialog', label: 'Design Primers…', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:design-dialog' },
  { id: 'prm-degenerate-dialog', label: 'Design Degenerate Primers…', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:degenerate-dialog' },
  { id: 'prm-test-saved-dialog', label: 'Test with Saved Primers…', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:test-saved-dialog' },
  { id: 'prm-db-binding-dialog', label: 'Find Where Stored Primers Bind…', path: ['Cloning', 'Primers', 'Design Primers'] },
  { id: 'prm-add', label: 'Add Primer', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:add' },
  { id: 'prm-add-list', label: 'Import Primers from Spreadsheet…', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:add-list' },
  { id: 'prm-design-pair', label: 'Design Primer Pair', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:design' },
  { id: 'prm-convert-oligo', label: 'Selection to Oligo', path: ['Cloning', 'Primers', 'Design Primers'], nativeId: 'primers:convert-to-oligo' },
  { id: 'prm-saved', label: 'Map Saved Primers', path: ['Cloning', 'Primers', 'Specificity'], nativeId: 'primers:import-saved' },
  { id: 'prm-specificity', label: 'Binding Specificity', path: ['Cloning', 'Primers', 'Specificity'], nativeId: 'primers:specificity' },
  { id: 'prm-export', label: 'Export Primers', path: ['Cloning', 'Primers', 'Specificity'], nativeId: 'primers:export' },
  { id: 'prm-pcr-sim', label: 'In-Silico PCR', path: ['Cloning', 'Primers', 'PCR & Mutagenesis'], shortcut: 'Mod+D', nativeId: 'primers:pcr' },
  { id: 'prm-soe', label: 'Overlap PCR', path: ['Cloning', 'Primers', 'PCR & Mutagenesis'] },
  { id: 'prm-sdm', label: 'Site Mutagenesis', path: ['Cloning', 'Primers', 'PCR & Mutagenesis'], shortcut: 'Mod+J', nativeId: 'primers:mutagenesis' },
  { id: 'prm-crispr', label: 'Find CRISPR Sites', path: ['Cloning', 'Primers', 'CRISPR Guides'], nativeId: 'primers:crispr' },
  { id: 'prm-crispr-editing', label: 'CRISPR Editing Analysis…', path: ['Cloning', 'Primers', 'CRISPR Guides'], nativeId: 'primers:crispr-editing-dialog' },
  { id: 'prm-prefs', label: 'Primer Preferences', path: ['Cloning', 'Primers', 'Primer Settings'], nativeId: 'primers:preferences', noSession: true },
  { id: 'top-align-msa-dialog', label: 'Multiple Alignment…', path: ['Tools', 'Alignment'], nativeId: 'align:msa-dialog' },
  { id: 'top-align-pairwise-dialog', label: 'Pairwise Alignment…', path: ['Tools', 'Alignment'], nativeId: 'align:pairwise-dialog' },
  { id: 'top-align-structures-dialog', label: 'Align Structures…', path: ['Tools', 'Alignment'], nativeId: 'align:structures-dialog', rule: 'align-structures' },
  { id: 'top-align-read-qc', label: 'Read QC Report…', path: ['Tools', 'Alignment'], nativeId: 'align:qc-dialog' },
  { id: 'top-align-merge-pairs', label: 'Merge Paired Reads…', path: ['Tools', 'Alignment'], nativeId: 'align:merge-pairs-dialog' },
  { id: 'top-align-trim-dialog', label: 'Trim Ends…', path: ['Tools', 'Alignment'], nativeId: 'align:trim-dialog' },
  { id: 'top-align-denovo-dialog', label: 'De Novo Assemble…', path: ['Tools', 'Alignment'], nativeId: 'align:denovo-dialog' },
  { id: 'top-align-map-dialog', label: 'Map to Reference…', path: ['Tools', 'Alignment'], nativeId: 'align:map-dialog' },
  { id: 'top-align-expression-levels-dialog', label: 'Calculate Expression Levels…', path: ['Tools', 'Alignment'], nativeId: 'align:expression-levels-dialog' },
  { id: 'top-align-structural-variants-dialog', label: 'Find Structural Variants…', path: ['Tools', 'Alignment'], nativeId: 'align:structural-variants-dialog' },
  { id: 'top-align-translation-dialog', label: 'Translation Alignment…', path: ['Tools', 'Alignment'], nativeId: 'align:translation-dialog' },
  { id: 'top-align-highlight-sites', label: 'Highlight Sites…', path: ['Tools', 'Alignment'], nativeId: 'align:highlight-sites-dialog' },
  { id: 'top-align-add-to-alignment', label: 'Add Sequences to Alignment…', path: ['Tools', 'Alignment'], nativeId: 'align:add-to-alignment-dialog' },
  { id: 'top-align-mask-dialog', label: 'Mask Alignment…', path: ['Tools', 'Alignment'], nativeId: 'align:mask-dialog' },
  { id: 'top-align-consensus-dialog', label: 'Generate Consensus…', path: ['Tools', 'Alignment'], nativeId: 'align:consensus-dialog' },
  { id: 'top-align-msa-mafft', label: 'MAFFT-style Alignment', path: ['Tools', 'Alignment', 'Multiple Alignment'], shortcut: 'Mod+Alt+A', nativeId: 'align:msa-mafft' },
  { id: 'top-align-msa-clustalo', label: 'Clustal-style Alignment', path: ['Tools', 'Alignment', 'Multiple Alignment'], nativeId: 'align:msa-clustalo' },
  { id: 'top-align-msa-muscle', label: 'MUSCLE-style Alignment', path: ['Tools', 'Alignment', 'Multiple Alignment'], nativeId: 'align:msa-muscle' },
  { id: 'top-align-pairwise-nw', label: 'Global (Needleman-Wunsch)', path: ['Tools', 'Alignment', 'Pairwise & Dotplot'], nativeId: 'align:pairwise-nw' },
  { id: 'top-align-pairwise-sw', label: 'Local (Smith-Waterman)', path: ['Tools', 'Alignment', 'Pairwise & Dotplot'], nativeId: 'align:pairwise-sw' },
  { id: 'top-align-dotplot', label: 'K-mer Dotplot', path: ['Tools', 'Alignment', 'Pairwise & Dotplot'], nativeId: 'align:dotplot' },
  { id: 'top-align-map-ref', label: 'Map Reads', path: ['Tools', 'Alignment', 'Read Mapping & Contigs'], nativeId: 'align:map-reference' },
  { id: 'top-align-denovo', label: 'De Novo Assembly', path: ['Tools', 'Alignment', 'Read Mapping & Contigs'], nativeId: 'align:denovo-assemble' },
  { id: 'top-align-sanger-contig', label: 'Sanger Contigs', path: ['Tools', 'Alignment', 'Read Mapping & Contigs'], nativeId: 'align:sanger-contig' },
  { id: 'top-align-whole-genome', label: 'Genome Synteny', path: ['Tools', 'Alignment', 'Genome Alignment'], nativeId: 'align:whole-genome' },
  { id: 'top-align-gen-consensus', label: 'Generate Consensus', path: ['Tools', 'Alignment', 'Consensus & Batch'], nativeId: 'tools:generate-consensus' },
  { id: 'top-align-concat', label: 'Concatenate Sequences', path: ['Tools', 'Alignment', 'Consensus & Batch'], nativeId: 'tools:concatenate' },
  { id: 'top-align-mask-lowcomp', label: 'Mask Homopolymers', path: ['Tools', 'Alignment', 'Consensus & Batch'], nativeId: 'tools:mask-low-complexity' },
  { id: 'top-align-export-consensus', label: 'Export Consensus', path: ['Tools', 'Alignment', 'Consensus & Batch'] },
  { id: 'top-align-haplotype-partitioner', label: 'Haplotype & Allele Partitioner', path: ['Tools', 'Alignment', 'Consensus & Batch'], nativeId: 'tools:plugin-haplotype-part' },
  { id: 'top-align-ext-cli-suite', label: 'External CLI Suite', path: ['Tools', 'Alignment', 'Consensus & Batch'], nativeId: 'tools:plugin-ext-cli' },
  { id: 'top-phylo-build-tree', label: 'Build Tree…', path: ['Tools', 'Phylogenetics'], nativeId: 'phylo:build-tree' },
  { id: 'top-phylo-compute-distances', label: 'Compute Distances…', path: ['Tools', 'Phylogenetics'], nativeId: 'phylo:compute-distances-dialog' },
  { id: 'top-phylo-timetree', label: 'Compute Timetree…', path: ['Tools', 'Phylogenetics'], nativeId: 'phylo:timetree' },
  { id: 'top-phylo-condense-tree', label: 'Condense Tree…', path: ['Tools', 'Phylogenetics'], nativeId: 'phylo:condense-tree' },
  { id: 'top-phylo-gene-dups', label: 'Gene Duplication Inference…', path: ['Tools', 'Phylogenetics'], nativeId: 'phylo:gene-duplications' },
  { id: 'top-phylo-consensus-tree', label: 'Consensus Tree…', path: ['Tools', 'Phylogenetics'], nativeId: 'phylo:consensus-tree' },
  { id: 'top-phylo-tree-ml', label: 'Maximum Likelihood', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], shortcut: 'Mod+Alt+T', nativeId: 'phylo:tree-ml' },
  { id: 'top-phylo-tree-fasttree', label: 'FastTree (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-fasttree' },
  { id: 'top-phylo-tree-phyml', label: 'PhyML (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-phyml' },
  { id: 'top-phylo-tree-raxml', label: 'RAxML (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-raxml' },
  { id: 'top-phylo-tree-mrbayes', label: 'MrBayes (runs if installed)', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-mrbayes' },
  { id: 'top-phylo-tree-nj', label: 'Neighbor-Joining', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-nj' },
  { id: 'top-phylo-tree-me', label: 'Minimum Evolution', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-me' },
  { id: 'top-phylo-tree-upgma', label: 'UPGMA Clustering', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-upgma' },
  { id: 'top-phylo-tree-mp', label: 'Maximum Parsimony', path: ['Tools', 'Phylogenetics', 'Tree Reconstruction'], nativeId: 'phylo:tree-mp' },
  { id: 'top-phylo-usertree', label: 'Analyze User Tree', path: ['Tools', 'Phylogenetics', 'Ancestral States'], nativeId: 'phylo:usertree' },
  { id: 'top-phylo-ancestors-ml', label: 'Ancestors (ML)', path: ['Tools', 'Phylogenetics', 'Ancestral States'], nativeId: 'phylo:ancestors-ml' },
  { id: 'top-phylo-ancestors-mp', label: 'Ancestors (Parsimony)', path: ['Tools', 'Phylogenetics', 'Ancestral States'], nativeId: 'phylo:ancestors-mp' },
  { id: 'top-phylo-models-best', label: 'Best Fit Models', path: ['Tools', 'Phylogenetics', 'Substitution Models'], nativeId: 'phylo:models-best' },
  { id: 'top-phylo-models-matrix', label: 'Rate Matrix', path: ['Tools', 'Phylogenetics', 'Substitution Models'], nativeId: 'phylo:models-matrix' },
  { id: 'top-phylo-models-disparity', label: 'Homogeneity Test', path: ['Tools', 'Phylogenetics', 'Substitution Models'], nativeId: 'phylo:models-disparity' },
  { id: 'top-phylo-data', label: 'Alignment Explorer', path: ['Tools', 'Phylogenetics', 'Codon Usage & Data'], nativeId: 'phylo:data' },
  { id: 'top-phylo-models-composition', label: 'Codon Composition', path: ['Tools', 'Phylogenetics', 'Codon Usage & Data'], nativeId: 'phylo:models-composition' },
  { id: 'top-phylo-models-rscu', label: 'Codon Usage (RSCU)', path: ['Tools', 'Phylogenetics', 'Codon Usage & Data'], nativeId: 'phylo:models-rscu' },
  { id: 'top-phylo-distance', label: 'Pairwise Distances', path: ['Tools', 'Phylogenetics', 'Distances & Diversity'], nativeId: 'phylo:distance' },
  { id: 'top-phylo-diversity', label: 'Population Diversity', path: ['Tools', 'Phylogenetics', 'Distances & Diversity'], nativeId: 'phylo:diversity' },
  { id: 'top-phylo-selection', label: 'Codon Selection (dN/dS)', path: ['Tools', 'Phylogenetics', 'Selection & Rates'], nativeId: 'phylo:selection' },
  { id: 'top-phylo-rates', label: 'Gamma Site Rates', path: ['Tools', 'Phylogenetics', 'Selection & Rates'], nativeId: 'phylo:rates' },
  { id: 'top-phylo-clocks', label: 'Molecular Clocks', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'], nativeId: 'phylo:clocks' },
  { id: 'top-phylo-diagnose', label: 'Variant Impact', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'], nativeId: 'phylo:diagnose' },
  { id: 'top-phylo-species-delim', label: 'Species Delimitation', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'], nativeId: 'tools:plugin-species-delim' },
  { id: 'top-phylo-hpc-phylo-job', label: 'HPC Phylogeny Job Builder', path: ['Tools', 'Phylogenetics', 'Clocks & Variants'], nativeId: 'tools:plugin-hpc-phylo' },
  { id: 'tools-gel', label: 'Agarose Gel', path: ['Tools', 'Gel & Calculators'], shortcut: 'Mod+Shift+G', nativeId: 'tools:agarose-gel' },
  { id: 'tools-calc', label: 'DNA Calculations', path: ['Tools', 'Gel & Calculators'], shortcut: 'Mod+Shift+M', nativeId: 'tools:dna-calc' },
  { id: 'tools-blast', label: 'BLAST Search', path: ['Tools', 'BLAST & Vectors'], shortcut: 'Mod+Shift+B', nativeId: 'tools:blast' },
  { id: 'tools-vec-cat', label: 'Vector Catalog', path: ['Tools', 'BLAST & Vectors'], nativeId: 'tools:vectors' },
  { id: 'tools-vec-arch', label: 'Vector Architect', path: ['Tools', 'BLAST & Vectors'], nativeId: 'tools:vectors-architect' },
  { id: 'tools-db-explorer', label: 'NCBI & UniProt', path: ['Tools', 'Databases'], nativeId: 'tools:databases-explorer', noSession: true },
  { id: 'tools-primer-database', label: 'Primers', path: ['Tools', 'Databases'], nativeId: 'tools:primer-database', noSession: true },
  { id: 'tools-enzyme-database', label: 'Restriction Enzymes', path: ['Tools', 'Databases'], nativeId: 'tools:enzyme-database', noSession: true },
  { id: 'tools-make-blast-db', label: 'Make BLAST Database from Selection…', path: ['Tools', 'Databases'], nativeId: 'tools:make-blast-db', noSession: true },
  { id: 'tools-local-blast-dbs', label: 'Local BLAST DBs', path: ['Tools', 'Databases'], nativeId: 'tools:local-blast-dbs', noSession: true },
  { id: 'tools-blast-setup', label: 'BLAST Setup', path: ['Tools', 'Databases'], nativeId: 'tools:blast-setup', noSession: true },
  { id: 'tools-extract-ann', label: 'Extract Features', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-mask-sel', label: 'Mask Selection', path: ['Tools', 'Batch Operations'], nativeId: 'tools:mask-selection' },
  { id: 'tools-mask-lowcomp', label: 'Mask Homopolymers', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-concat-seqs', label: 'Concatenate', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-gen-consensus', label: 'Generate Consensus', path: ['Tools', 'Batch Operations'] },
  { id: 'tools-sanger', label: 'Sanger Studio', path: ['Tools', 'Sequencing & NGS'], nativeId: 'tools:sanger' },
  { id: 'tools-ngs', label: 'NGS Assembly', path: ['Tools', 'Sequencing & NGS'], nativeId: 'tools:ngs-suite' },
  { id: 'tools-synteny', label: 'Genome Variants', path: ['Tools', 'Sequencing & NGS'], nativeId: 'tools:genome-variants' },
  { id: 'tools-gb-sub', label: 'GenBank Submission', path: ['Tools', 'Sequencing & NGS'], nativeId: 'tools:genbank-submit' },
  { id: 'tools-pipelines', label: 'Guided Pipelines', path: ['Tools', 'Pipelines'], shortcut: 'Mod+Shift+Y', nativeId: 'tools:pipelines' },
  { id: 'tools-workflows', label: 'Lineage Manager', path: ['Tools', 'Pipelines'], nativeId: 'tools:workflows' },
  { id: 'tools-wf-oligo', label: 'Annealed Oligo Cloning', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-batch-rest', label: 'Batch Restriction', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-align-tree-run', label: 'Align & Build Tree', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-mafft', label: 'Multi-Engine MSA', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-map-asm', label: 'Map & Assemble', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-apply-var', label: 'Apply Variants', path: ['Tools', 'Pipelines'] },
  { id: 'tools-wf-manage', label: 'Manage Workflows…', path: ['Tools', 'Batch Workflows'], nativeId: 'workflows:manage' },
  { id: 'tools-wf-run', label: 'Run Workflow…', path: ['Tools', 'Batch Workflows'], nativeId: 'workflows:run' },
  { id: 'tools-wf-group-name', label: 'Group by Prefix', path: ['Tools', 'Batch Workflows'], nativeId: 'workflows:group-by-name' },
  { id: 'tools-wf-mod-intervals', label: 'Modify Intervals', path: ['Tools', 'Batch Workflows'], nativeId: 'workflows:modify-intervals' },
  { id: 'tools-wf-random-sample', label: 'Sample Sequences', path: ['Tools', 'Batch Workflows'], nativeId: 'workflows:random-sample' },
  { id: 'tools-wf-set-cds', label: 'Set CDS Translation', path: ['Tools', 'Batch Workflows'], nativeId: 'workflows:set-cds-translation' },
  { id: 'tools-plugin-euk-gene', label: 'Eukaryotic Gene Predictor', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-euk-gene' },
  { id: 'tools-plugin-microbial-gene', label: 'Microbial Gene Predictor', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-microbial-gene' },
  { id: 'tools-plugin-crispr-arrays', label: 'CRISPR Repeat Array Finder', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-crispr-arrays' },
  { id: 'tools-plugin-tandem-repeats', label: 'Microsatellite & Tandem Repeats', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-tandem-repeats' },
  { id: 'tools-plugin-haplotype-part', label: 'Haplotype & Allele Partitioner', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-taxonomic-class', label: 'Taxonomic Sequence Classifier', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-taxonomic-class' },
  { id: 'tools-plugin-species-delim', label: 'Species Delimitation', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-protein-domains', label: 'Protein Domains & Epitopes', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-protein-domains' },
  { id: 'tools-plugin-tm-topology', label: 'Transmembrane & Signal Topology', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-tm-topology' },
  { id: 'tools-plugin-adapter-trimmer', label: 'Adapter & Quality Read Trimmer', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-adapter-trimmer' },
  { id: 'tools-plugin-synteny-blocks', label: 'Whole-Genome Synteny Blocks', path: ['Tools', 'Bioinformatics Plugins'], nativeId: 'tools:plugin-synteny-blocks' },
  { id: 'tools-plugin-hpc-phylo', label: 'HPC Phylogeny Job Builder', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-plugin-ext-cli', label: 'External CLI Suite', path: ['Tools', 'Bioinformatics Plugins'] },
  { id: 'tools-prefs', label: 'Preferences', path: ['Tools', 'Settings'], shortcut: 'Mod+Shift+P', nativeId: 'tools:preferences', noSession: true },
  { id: 'help-shortcuts', label: 'Keyboard Shortcuts', path: ['Help', 'Guides'], nativeId: 'help:shortcuts', noSession: true },
  { id: 'help-vec-guide', label: 'Vector Guide', path: ['Help', 'Guides'], nativeId: 'help:vector-guide', noSession: true },
  { id: 'help-tutorials', label: 'Sample Tutorial', path: ['Help', 'Guides'], nativeId: 'help:tutorials', noSession: true },
  { id: 'help-examples', label: 'Evolution Examples…', path: ['Help', 'Load Example Data'], nativeId: 'help:examples', noSession: true },
  { id: 'help-bench-genome', label: '500 kbp Annotated Genome', path: ['Help', 'Load Example Data'], nativeId: 'help:bench-genome', noSession: true },
  { id: 'help-bench-protein', label: '10,000 aa Protein', path: ['Help', 'Load Example Data'], nativeId: 'help:bench-protein', noSession: true },
  { id: 'help-updates', label: 'Check for Updates', path: ['Help', 'About'], nativeId: 'help:updates', noSession: true },
  { id: 'help-about', label: 'About MolBioCraft', path: ['Help', 'About'], nativeId: 'help:about', noSession: true },
  { id: 'view-no-tabs', label: 'No tabs open', path: ['View', 'Open Tabs'] },
];

/** Commands whose label follows state; the menubar node supplies the label, the key comes from here. */
const DYNAMIC_LABEL_COMMANDS: readonly CommandSpec[] = [
  { id: 'app-theme-toggle', label: 'Dark Appearance', path: ['MolBioCraft', 'Settings'], shortcut: 'Mod+Shift+L', dynamicLabel: true, nativeId: 'app:toggle-theme', noSession: true },
  { id: 'edit-undo-cmd', label: 'Undo', path: ['Edit'], shortcut: 'Mod+Z', dynamicLabel: true, nativeId: 'edit:undo', noSession: true, rule: 'undo' },
  { id: 'edit-redo-cmd', label: 'Redo', path: ['Edit'], shortcut: 'Mod+Shift+Z', dynamicLabel: true, nativeId: 'edit:redo', noSession: true, rule: 'redo' },
  { id: 'help-panel', label: 'Show Help Panel', path: ['Help', 'Guides'], shortcut: 'F1', dynamicLabel: true, nativeId: 'help:panel', noSession: true },
];

/** View › Studios: one command per studio of the studio registry, under its name and ⌘-digit. */
const STUDIO_COMMANDS: readonly CommandSpec[] = STUDIOS.map((s) => ({
  id: `view-studio-${s.id}`,
  label: s.name,
  path: ['View', 'Studios'],
  ...(s.digit ? { shortcut: `Mod+${s.digit}` } : {}),
  nativeId: `view:studio-${s.id}`,
  // With no session a studio key starts the studio's task session (US-01M6Q1CF), so it is enabled then.
  noSession: true,
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

// ---------------------------------------------------------------------------
// The native macOS menu (US-01M6Q159, D0259, D0260)
// ---------------------------------------------------------------------------

/** An AppKit item with no registry command behind it (the app menu's, Edit's and Window's). */
export type NativePredefined =
  | 'services' | 'hide' | 'hide_others' | 'show_all' | 'cut' | 'copy' | 'paste' | 'select_all'
  | 'minimize' | 'maximize' | 'fullscreen';

export type NativeMenuNode =
  | { readonly type: 'item'; readonly id: string; readonly label: string; readonly accel?: string }
  | { readonly type: 'submenu'; readonly label: string; readonly items: readonly NativeMenuNode[] }
  | { readonly type: 'separator' }
  | { readonly type: 'predefined'; readonly kind: NativePredefined };

export interface NativeMenuSpec {
  readonly generated: string;
  readonly menus: readonly { readonly label: string; readonly items: readonly NativeMenuNode[] }[];
  /** Native ids the dispatcher runs that have no menu place (another surface sends them). */
  readonly dispatchOnly: readonly string[];
}

/**
 * D0260 (3): the native items with no registry command, declared once. Each sits in `path`, before
 * the command `before` names (else at the end of `path`). An item `runs` the in-window node with that
 * id (a command the menubar generates at render time); a predefined item is AppKit's own.
 */
export interface NativeOnlyEntry {
  readonly path: readonly string[];
  readonly before?: string;
  readonly predefined?: NativePredefined;
  readonly id?: string;
  readonly label?: string;
  readonly runs?: string;
  readonly noSession?: true;
  readonly rule?: string;
}

export const NATIVE_ONLY_ITEMS: readonly NativeOnlyEntry[] = [
  { path: ['MolBioCraft'], before: 'app-quit-cmd', predefined: 'services' },
  { path: ['MolBioCraft'], before: 'app-quit-cmd', predefined: 'hide' },
  { path: ['MolBioCraft'], before: 'app-quit-cmd', predefined: 'hide_others' },
  { path: ['MolBioCraft'], before: 'app-quit-cmd', predefined: 'show_all' },
  // Text editing in fields and the webview stays AppKit's (⌘X, ⌘C, ⌘V, ⌘A).
  { path: ['Edit'], before: 'edit-copy-seq', predefined: 'cut' },
  { path: ['Edit'], before: 'edit-copy-seq', predefined: 'copy' },
  { path: ['Edit'], before: 'edit-copy-seq', predefined: 'paste' },
  { path: ['Edit'], before: 'edit-copy-seq', predefined: 'select_all' },
  // View › Table Columns: the menubar generates these rows from the column presets.
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-preset-cloning', label: 'Standard Molecular Cloning', runs: 'view-cols-preset-standard-cloning' },
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-preset-align', label: 'Alignment & Phylogenetics', runs: 'view-cols-preset-alignment-phylogeny' },
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-preset-genomics', label: 'Genomics & Sequencing', runs: 'view-cols-preset-genomics-sequencing' },
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-preset-all', label: 'Show All Columns', runs: 'view-cols-preset-all-columns' },
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-lock', label: 'Lock Column Order', runs: 'view-cols-col-lock' },
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-save', label: 'Save Current State', runs: 'view-cols-col-save' },
  { path: ['View', 'Table Columns'], before: 'view-restore-default-layout', id: 'view:col-choose', label: 'Choose Columns…', runs: 'view-cols-choose' },
  // Opens the Primers studio on Design; no menubar node runs it, so the App's native handler does.
  { path: ['Tools', 'BLAST & Vectors'], id: 'tools:primers', label: 'Primers & CRISPR' },
  { path: ['Window'], predefined: 'minimize' },
  { path: ['Window'], predefined: 'maximize' },
  { path: ['Window'], predefined: 'fullscreen' },
];

/**
 * D0262: the one native-only exception to "native enabled state follows the in-window availability".
 * Undo and Redo stay enabled on the native menu in every context, so AppKit can undo inside a text
 * field; the in-window items follow the document undo stack's rule.
 */
export const NATIVE_ENABLED_ALWAYS: readonly string[] = ['edit:undo', 'edit:redo'];

/**
 * Native ids with no menu place, each the registry command it runs, or null where the App's native
 * handler runs it (a command with no menubar node).
 */
export const NATIVE_DISPATCH_ONLY: Readonly<Record<string, string | null>> = {
  // The Add/Import menus' New Sequence sends it; the same command as File › New Session › New Sequence.
  'file:new-sequence': 'file-ns-new-seq',
  // The header's Home button; the session's Home view.
  'view:home': null,
};

/**
 * Where a command whose list is kept apart (the dynamic-label and studio commands) sits in its menu:
 * before the command named here, as the menubar shows it.
 */
const NATIVE_MENU_ORDER: Readonly<Record<string, string>> = {
  'app-theme-toggle': 'app-prefs-open+',
  'edit-undo-cmd': 'edit-copy-seq',
  'edit-redo-cmd': 'edit-copy-seq',
  'help-panel': 'help-shortcuts',
};

/**
 * The dividers: each sits in the submenu at its path, before the row with that label (or before
 * AppKit's item of that kind). The in-window menubar draws the same dividers (nativeMenuRegistry AC2);
 * the app menu's and Edit's AppKit groups add their own.
 */
const NATIVE_SEPARATORS: readonly (readonly [readonly string[], string])[] = [
  [['MolBioCraft'], 'predefined:services'],
  [['Edit'], 'predefined:cut'],
  [['MolBioCraft'], 'Quit MolBioCraft'],
  [['File'], 'Import Data'],
  [['File'], 'Quit MolBioCraft'],
  [['File', 'New Session'], 'Sequences & Vectors'],
  [['File', 'New Session', 'Starter & Import'], 'Sample Project'],
  [['File', 'Open Session'], 'Restore Autosave'],
  [['File', 'Save Session'], 'Close Session'],
  [['File', 'Favorites & Trash'], 'Move to Trash'],
  [['File', 'Import Data'], 'Sequence Files'],
  [['Edit'], 'Selection'],
  [['View'], 'Show Menu Function Info'],
  [['View', 'Split & Expand'], 'Expand Viewer'],
  [['View', 'Table Columns'], 'Lock Column Order'],
  [['View', 'Map Layout'], 'Set Origin'],
  [['Sequence'], 'Features'],
  [['Cloning'], 'Gateway Cloning'],
  [['Cloning'], 'Enzymes'],
  [['Cloning', 'Gateway Cloning'], 'Donor Vectors'],
  [['Cloning', 'TA & GC Cloning'], 'TA Vectors'],
  [['Cloning', 'TOPO Cloning'], 'TOPO TA Vectors'],
  [['Cloning', 'Primers'], 'Primer Settings'],
  [['Tools'], 'Gel & Calculators'],
  [['Tools'], 'Settings'],
  [['Tools', 'Alignment'], 'Consensus & Batch'],
  [['Tools', 'Phylogenetics', 'Tree Reconstruction'], 'Neighbor-Joining'],
  [['Tools', 'Pipelines'], 'Annealed Oligo Cloning'],
  [['Tools', 'Batch Workflows'], 'Group by Prefix'],
];

/** Keys AppKit's own items take; a command keeps its in-window key but its native item does not. */
const NATIVE_RESERVED_KEYS = ['Mod+X', 'Mod+C', 'Mod+V', 'Mod+A'];

/** The menu-bar commands the native menu does not carry: Open Tabs changes at runtime (delta 10). */
const NATIVE_EXCLUDED = new Set(['view-no-tabs']);

/** 'Mod+Shift+E' as Tauri writes it: 'CmdOrCtrl+Shift+E'; a bare 'F1' stays 'F1'. */
export function toNativeAccelerator(shortcut: string | undefined): string | undefined {
  if (!shortcut) return undefined;
  if (NATIVE_RESERVED_KEYS.includes(shortcut)) throw new Error(`${shortcut} is AppKit's; give the command a nativeShortcut`);
  return shortcut.split('+').map((p) => (p === 'Mod' ? 'CmdOrCtrl' : p)).join('+');
}

/** A command's native id: its declared one (today's id, D0260 (3)), else its registry id. */
export const nativeIdOf = (c: CommandSpec): string => c.nativeId ?? c.id;

/** The top-level menus of the native macOS menu, in order (D0259). */
export const NATIVE_TOP_MENUS = ['MolBioCraft', 'File', 'Edit', 'View', 'Sequence', 'Cloning', 'Tools', 'Help', 'Window'];

/** The native macOS menu, projected from the registry and the native-only table. */
/** A vector of the catalogue the menubar's Cloning vector submenus list (src/data/cloningActionVectors). */
export interface NativeVectorPreset { readonly id: string; readonly name: string; readonly group: string }

/** Each vector group's submenu, as the in-window Cloning menu nests it. */
const NATIVE_VECTOR_GROUP_PATHS: Readonly<Record<string, readonly string[]>> = {
  'gateway-donor': ['Cloning', 'Gateway Cloning', 'Donor Vectors'],
  'gateway-dest': ['Cloning', 'Gateway Cloning', 'Destination Vectors'],
  'ta-vectors': ['Cloning', 'TA & GC Cloning', 'TA Vectors'],
  'gc-vectors': ['Cloning', 'TA & GC Cloning', 'GC Vectors'],
  'topo-ta': ['Cloning', 'TOPO Cloning', 'TOPO TA Vectors'],
  'topo-blunt': ['Cloning', 'TOPO Cloning', 'Blunt TOPO Vectors'],
  'topo-directional': ['Cloning', 'TOPO Cloning', 'D-TOPO Vectors'],
};

/** The vector presets as native items: `action-vec:<id>`, running the menubar's `act-vec-<id>`. */
export function nativeVectorItems(presets: readonly NativeVectorPreset[]): NativeOnlyEntry[] {
  return presets.map((p) => {
    const path = NATIVE_VECTOR_GROUP_PATHS[p.group];
    if (!path) throw new Error(`The vector ${p.id} is in group ${p.group}, which no Cloning submenu lists`);
    return { path, id: `action-vec:${p.id}`, label: p.name, runs: `act-vec-${p.id}`, noSession: true };
  });
}

export function nativeMenuSpec(vectorPresets: readonly NativeVectorPreset[]): NativeMenuSpec {
  type Placed = { path: readonly string[]; node: NativeMenuNode; key: string };
  const placed: Placed[] = COMMANDS.filter((c) => !NATIVE_ORDERED_APART.has(c.id) && !NATIVE_EXCLUDED.has(c.id)).map((c) => ({
    path: c.path, key: c.id,
    node: { type: 'item', id: nativeIdOf(c), label: c.label, ...(toNativeAccelerator(c.nativeShortcut ?? c.shortcut) ? { accel: toNativeAccelerator(c.nativeShortcut ?? c.shortcut) } : {}) },
  }));
  const insert = (p: Placed, before: string | undefined) => {
    const after = before?.endsWith('+');
    const anchor = before ? before.replace(/\+$/, '') : undefined;
    const at = anchor ? placed.findIndex((x) => x.key === anchor) : -1;
    if (anchor && at < 0) throw new Error(`The native menu places ${p.key} beside ${anchor}, which it does not hold`);
    if (at < 0) {
      // At the end of its path: after the last entry under that path, else at the end.
      const last = placed.map((x) => x.path.join('>').startsWith(p.path.join('>'))).lastIndexOf(true);
      placed.splice(last < 0 ? placed.length : last + 1, 0, p);
    } else placed.splice(after ? at + 1 : at, 0, p);
  };
  for (const c of COMMANDS.filter((x) => NATIVE_ORDERED_APART.has(x.id))) {
    if (c.id.startsWith('view-studio-')) continue;
    insert({ path: c.path, key: c.id, node: { type: 'item', id: nativeIdOf(c), label: c.label, ...(toNativeAccelerator(c.nativeShortcut ?? c.shortcut) ? { accel: toNativeAccelerator(c.nativeShortcut ?? c.shortcut) } : {}) } }, NATIVE_MENU_ORDER[c.id]);
  }
  const studios = COMMANDS.filter((c) => c.id.startsWith('view-studio-'));
  studios.forEach((c, i) => insert({ path: c.path, key: c.id, node: { type: 'item', id: nativeIdOf(c), label: c.label, ...(toNativeAccelerator(c.nativeShortcut ?? c.shortcut) ? { accel: toNativeAccelerator(c.nativeShortcut ?? c.shortcut) } : {}) } }, i === 0 ? NATIVE_STUDIOS_BEFORE : `${studios[i - 1].id}+`));
  [...NATIVE_ONLY_ITEMS, ...nativeVectorItems(vectorPresets)].forEach((e, i) => insert({
    path: e.path, key: e.id ?? `predefined-${i}`,
    node: e.predefined ? { type: 'predefined', kind: e.predefined } : { type: 'item', id: e.id!, label: e.label! },
  }, e.before));
  type Tree = { label: string; items: (NativeMenuNode | Tree)[] };
  const roots: Tree[] = NATIVE_TOP_MENUS.map((label) => ({ label, items: [] }));
  for (const p of placed) {
    const root = roots.find((r) => r.label === p.path[0]);
    if (!root) throw new Error(`${p.key} sits in ${p.path[0]}, which is not a native top-level menu`);
    let at: Tree = root;
    for (const label of p.path.slice(1)) {
      let next: Tree | undefined = at.items.find((n): n is Tree => !('type' in n) && n.label === label);
      if (!next) { next = { label, items: [] }; at.items.push(next); }
      at = next;
    }
    at.items.push(p.node);
  }
  for (const [path, before] of NATIVE_SEPARATORS) {
    let at: Tree | undefined = roots.find((r) => r.label === path[0]);
    for (const label of path.slice(1)) at = at?.items.find((n): n is Tree => !('type' in n) && n.label === label);
    const i = at ? at.items.findIndex((n) => (before.startsWith('predefined:')
      ? 'type' in n && n.type === 'predefined' && n.kind === before.slice('predefined:'.length)
      : ('type' in n ? n.type === 'item' && n.label === before : n.label === before))) : -1;
    if (!at || i < 0) throw new Error(`The native menu puts a divider before ${before} in ${path.join(' › ')}, which it does not hold`);
    at.items.splice(i, 0, { type: 'separator' });
  }
  // A key several commands show runs the first of them in menu order, as the in-window menubar binds
  // it (menuShortcuts: "a combination bound twice is listed once, under its first definition"); the
  // native menu gives it to that item alone, so AppKit has one item per key.
  const keyed = new Set<string>();
  const freeze = (items: (NativeMenuNode | Tree)[]): NativeMenuNode[] =>
    items.map((n): NativeMenuNode => {
      if (!('type' in n)) return { type: 'submenu', label: n.label, items: freeze(n.items) };
      if (n.type !== 'item' || !n.accel) return n;
      if (!keyed.has(n.accel)) { keyed.add(n.accel); return n; }
      return { type: 'item', id: n.id, label: n.label };
    });
  return {
    generated: 'Generated from src/core/commandRegistry.ts by scripts/gen_native_menu.mjs (npm run menu:native). Do not edit.',
    menus: roots.map((r) => ({ label: r.label, items: freeze(r.items) })),
    dispatchOnly: Object.keys(NATIVE_DISPATCH_ONLY),
  };
}

/** The commands kept in their own lists, placed by NATIVE_MENU_ORDER or as the Studios run. */
const NATIVE_ORDERED_APART = new Set([...Object.keys(NATIVE_MENU_ORDER), ...STUDIOS.map((s) => `view-studio-${s.id}`)]);
/** View › Studios sits before View › Map Layout on the menubar. */
const NATIVE_STUDIOS_BEFORE = 'view-lay-split';

/** What a native id runs: the registry command, or the in-window node a native-only item runs. */
export interface NativeTarget {
  /** The in-window node id the dispatcher runs; absent where the App's native handler runs it. */
  readonly runs?: string;
  readonly noSession: boolean;
  readonly rule?: string;
}

/** Every native id of the spec and the dispatch-only table, with what it runs. */
export function nativeTargets(vectorPresets: readonly NativeVectorPreset[]): ReadonlyMap<string, NativeTarget> {
  const out = new Map<string, NativeTarget>();
  for (const c of COMMANDS) {
    if (NATIVE_EXCLUDED.has(c.id)) continue;
    const id = nativeIdOf(c);
    if (out.has(id)) throw new Error(`Two commands take the native id ${id}`);
    out.set(id, { runs: c.id, noSession: Boolean(c.noSession), ...(c.rule ? { rule: c.rule } : {}) });
  }
  for (const e of [...NATIVE_ONLY_ITEMS, ...nativeVectorItems(vectorPresets)]) {
    if (!e.id) continue;
    if (out.has(e.id)) throw new Error(`Two commands take the native id ${e.id}`);
    out.set(e.id, { ...(e.runs ? { runs: e.runs } : {}), noSession: Boolean(e.noSession), ...(e.rule ? { rule: e.rule } : {}) });
  }
  for (const [id, runs] of Object.entries(NATIVE_DISPATCH_ONLY)) {
    if (runs === null) { out.set(id, { noSession: false }); continue; }
    const c = COMMAND_BY_ID.get(runs);
    if (!c) throw new Error(`The native id ${id} runs ${runs}, which is not a registry command`);
    out.set(id, { runs, noSession: Boolean(c.noSession), ...(c.rule ? { rule: c.rule } : {}) });
  }
  return out;
}
