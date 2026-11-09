// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod rest_api;

use commands::bio_commands::{
    cmd_batch_sequence_stats, cmd_genome_tracks, cmd_genome_viewport, cmd_pairwise_align,
    cmd_platform_diagnostics, cmd_primer_thermodynamics, cmd_rest_api_info,
    cmd_reverse_complement, cmd_rust_bio_invoke, cmd_sequence_stats,
};
use commands::fs_commands::{
    cmd_native_open_files_dialog, cmd_native_save_file_dialog, cmd_read_dropped_file_bytes,
    cmd_read_workspace_file, cmd_take_pending_open_files, cmd_write_workspace_file,
};
use commands::window_commands::{
    cmd_ack_quit_request, cmd_app_exit, cmd_print_webview, cmd_set_confirm_before_quit, cmd_sync_native_menu_state,
    cmd_window_start_dragging, cmd_window_toggle_maximize,
};
use commands::tree_tool_commands::{
    cmd_cancel_external_tree, cmd_detect_tree_programs, cmd_run_external_tree,
};
use commands::AppBackendState;
#[cfg(target_os = "macos")]
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem, Submenu},
    AppHandle, Runtime,
};
use tauri::{Emitter, Manager};

#[cfg(target_os = "macos")]
fn submenu_escaped<R: Runtime>(
    app: &AppHandle<R>,
    label: &str,
    enabled: bool,
    items: &[&dyn tauri::menu::IsMenuItem<R>],
) -> tauri::Result<Submenu<R>> {
    Submenu::with_items(app, label.replace('&', "&&"), enabled, items)
}

/// One command of the native menu bar: the id the frontend dispatcher routes (App.tsx
/// `onMenuAction`, which receives every menu event's id through `mbc://native-menu`), its label
/// and its accelerator.
#[cfg(any(target_os = "macos", test))]
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct NativeMenuCommand {
    id: &'static str,
    label: &'static str,
    accel: Option<&'static str>,
}

/// A [`NativeMenuCommand`]. Its name ends in `item(` so that the frontend's contract test
/// (src/__tests__/nativeMenuContract.test.ts) reads these ids with those of the builder's own
/// `item(` calls, and checks the dispatcher has a case for each.
#[cfg(any(target_os = "macos", test))]
const fn menu_item(id: &'static str, label: &'static str, accel: Option<&'static str>) -> NativeMenuCommand {
    NativeMenuCommand { id, label, accel }
}

/// The operation windows at the top of the native Alignment menu, in menu order; the submenus
/// follow them. [`build_macos_menu`] builds one item from each.
#[cfg(any(target_os = "macos", test))]
const ALIGNMENT_MENU_WINDOWS: &[NativeMenuCommand] = &[
    menu_item("align:msa-dialog", "Multiple Alignment…", None),
    menu_item("align:pairwise-dialog", "Pairwise Alignment…", None),
    menu_item("align:structures-dialog", "Align Structures…", None),
    menu_item("align:qc-dialog", "Read QC Report…", None),
    menu_item("align:merge-pairs-dialog", "Merge Paired Reads…", None),
    menu_item("align:trim-dialog", "Trim Ends…", None),
    menu_item("align:denovo-dialog", "De Novo Assemble…", None),
    menu_item("align:map-dialog", "Map to Reference…", None),
    menu_item("align:expression-levels-dialog", "Calculate Expression Levels…", None),
    menu_item("align:structural-variants-dialog", "Find Structural Variants…", None),
    menu_item("align:translation-dialog", "Translation Alignment…", None),
    menu_item("align:highlight-sites-dialog", "Highlight Sites…", None),
    menu_item("align:add-to-alignment-dialog", "Add Sequences to Alignment…", None),
    menu_item("align:mask-dialog", "Mask Alignment…", None),
    menu_item("align:consensus-dialog", "Generate Consensus…", None),
];

/// The operation-window items of the native Alignment menu, in menu order, each made by `make`
/// from its [`NativeMenuCommand`]. [`build_macos_menu`] makes its menu items with this, and the
/// test makes the commands themselves with it, so what the test checks is the list the menu is
/// built from rather than a copy of it.
#[cfg(any(target_os = "macos", test))]
fn alignment_menu_window_items<T, E>(
    make: impl FnMut(&NativeMenuCommand) -> Result<T, E>,
) -> Result<Vec<T>, E> {
    ALIGNMENT_MENU_WINDOWS.iter().map(make).collect()
}

#[cfg(target_os = "macos")]
fn build_macos_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let item = |id: &str, label: &str, accel: Option<&str>| {
        MenuItem::with_id(app, id, label.replace('&', "&&"), true, accel)
    };
    let sep = || PredefinedMenuItem::separator(app);

    let app_menu = submenu_escaped(
        app,
        "MolBioCraft",
        true,
        &[
            &item("app:about", "About MolBioCraft", None)?,
            &sep()?,
            &item("app:preferences", "Preferences", Some("CmdOrCtrl+,"))?,
            &item("app:toggle-theme", "Toggle Theme", Some("CmdOrCtrl+Shift+L"))?,
            &sep()?,
            &PredefinedMenuItem::services(app, None)?,
            &sep()?,
            &PredefinedMenuItem::hide(app, None)?,
            &PredefinedMenuItem::hide_others(app, None)?,
            &PredefinedMenuItem::show_all(app, None)?,
            &sep()?,
            &item("app:request-quit", "Quit MolBioCraft", Some("CmdOrCtrl+Q"))?,
        ],
    )?;

    let new_session_seq_vec = submenu_escaped(
        app,
        "Sequences & Vectors",
        true,
        &[
            &item("new-session:sequence", "New Sequence", Some("CmdOrCtrl+N"))?,
            &item("new-session:vector-catalog", "Vector Catalog", None)?,
            &item("new-session:vector-architect", "Custom Vector", None)?,
            &item("new-session:twist-onboarding", "Vector QC", None)?,
            &item("new-session:text-doc", "Flatfile Document", None)?,
        ],
    )?;

    let new_session_cloning = submenu_escaped(
        app,
        "Cloning & Primers",
        true,
        &[
            &item("new-session:cloning-restriction", "Restriction Cloning", None)?,
            &item("new-session:cloning-assembly", "Seamless Assembly", None)?,
            &item("new-session:primers-crispr", "Primers & CRISPR", None)?,
            &item("new-session:enzyme-set", "Enzyme Digest", None)?,
        ],
    )?;

    let new_session_align = submenu_escaped(
        app,
        "Alignment & Trees",
        true,
        &[
            &item("new-session:align-task", "Sequence Alignment", None)?,
            &item("new-session:phylo-task", "Phylogenetic Tree", None)?,
        ],
    )?;

    let new_session_seq_gen = submenu_escaped(
        app,
        "Sequencing & Genomics",
        true,
        &[
            &item("new-session:sanger-task", "Sanger Traces", None)?,
            &item("new-session:ngs-genomics", "NGS & Genomics", None)?,
            &item("new-session:pipeline-task", "Guided Pipeline", None)?,
        ],
    )?;

    let new_session_import = submenu_escaped(
        app,
        "Starter & Import",
        true,
        &[
            &item("new-session:import-files", "Import Files", None)?,
            &item("new-session:import-clipboard", "Paste from Clipboard", None)?,
            &item(
                "new-session:folder",
                "New Folder",
                Some("CmdOrCtrl+Shift+N"),
            )?,
            &sep()?,
            &item("new-session:sample-library", "Sample Project", None)?,
        ],
    )?;

    let new_session_menu = submenu_escaped(
        app,
        "New Session",
        true,
        &[
            &item("new-session:blank", "Blank Session", Some("CmdOrCtrl+Alt+N"))?,
            &sep()?,
            &new_session_seq_vec,
            &new_session_cloning,
            &new_session_align,
            &new_session_seq_gen,
            &new_session_import,
        ],
    )?;

    let file_open_sub = submenu_escaped(
        app,
        "Open Session",
        true,
        &[
            &item("file:open-session", "Open Session", Some("CmdOrCtrl+O"))?,
            &item("file:merge-session", "Merge Session", None)?,
            &sep()?,
            &item("file:restore-autosave", "Restore Autosave", None)?,
        ],
    )?;

    let file_save_sub = submenu_escaped(
        app,
        "Save Session",
        true,
        &[
            &item("file:save-session", "Save Session", Some("CmdOrCtrl+Alt+S"))?,
            &item(
                "file:save-session-as",
                "Save Session As",
                Some("CmdOrCtrl+Alt+Shift+S"),
            )?,
            &sep()?,
            &item(
                "file:close-session",
                "Close Session",
                Some("CmdOrCtrl+Shift+W"),
            )?,
        ],
    )?;

    let file_folders_sub = submenu_escaped(
        app,
        "Folders",
        true,
        &[
            &item("file:rename-folder", "Rename Folder", None)?,
            &item("file:set-folder-color", "Folder Color", None)?,
            &item("file:move-to-folder", "Move to Folder", None)?,
        ],
    )?;

    let file_fav_trash_sub = submenu_escaped(
        app,
        "Favorites & Trash",
        true,
        &[
            &item("file:toggle-favorite", "Toggle Favorite", None)?,
            &sep()?,
            &item("file:soft-delete", "Move to Trash", None)?,
            &item("file:restore-deleted", "Restore from Trash", None)?,
            &item("file:erase-deleted", "Empty Trash", None)?,
        ],
    )?;

    let file_backup_sub = submenu_escaped(
        app,
        "Project Backup",
        true,
        &[
            &item("file:backup-data", "Back Up Project", None)?,
            &item("file:restore-backup", "Restore Backup", None)?,
        ],
    )?;

    let file_prefs_sub = submenu_escaped(
        app,
        "Preferences",
        true,
        &[
            &item("file:import-preferences", "Import Preferences", None)?,
            &item("file:export-preferences", "Export Preferences", None)?,
        ],
    )?;

    let file_imp_seq_sub = submenu_escaped(
        app,
        "Sequence Files",
        true,
        &[
            &item("file:import-files", "Import Files", Some("CmdOrCtrl+I"))?,
            &item("file:import-folder", "Import Folder", None)?,
            &item("file:import-metadata", "Metadata from Spreadsheet…", None)?,
            &item(
                "file:import-clipboard",
                "Paste from Clipboard",
                Some("CmdOrCtrl+Shift+I"),
            )?,
        ],
    )?;

    let file_imp_other_sub = submenu_escaped(
        app,
        "Import Other",
        true,
        &[
            &item("file:restore-backup", "Restore Backup", None)?,
            &item("file:import-samples", "Sample Documents", None)?,
            &item("file:import-preferences", "MolBioCraft Preferences", None)?,
            &item("file:import-ncbi-db", "New Database Connection", None)?,
        ],
    )?;

    let file_imp_traces_sub = submenu_escaped(
        app,
        "Traces & Reads",
        true,
        &[
            &item("file:import-sanger", "Sanger Traces", None)?,
            &item("file:import-ngs", "NGS Reads & Variants", None)?,
        ],
    )?;

    let file_imp_vec_sub = submenu_escaped(
        app,
        "Vector Catalog",
        true,
        &[
            &item("file:import-vector-catalog", "Browse Vector Catalog", None)?,
            &item("file:import-twist-vector", "Custom Vector QC", None)?,
        ],
    )?;

    let file_imp_db_sub = submenu_escaped(
        app,
        "Databases",
        true,
        &[&item("file:import-ncbi-db", "NCBI & UniProt", None)?],
    )?;

    let file_import_sub = submenu_escaped(
        app,
        "Import Data",
        true,
        &[
            &file_imp_seq_sub,
            &file_imp_other_sub,
            &file_imp_traces_sub,
            &file_imp_vec_sub,
            &file_imp_db_sub,
        ],
    )?;

    let file_export_seq_sub = submenu_escaped(
        app,
        "Export Sequences",
        true,
        &[
            &item("file:save-gb", "Export GenBank", Some("CmdOrCtrl+S"))?,
            &item(
                "file:save-fasta",
                "Export FASTA",
                Some("CmdOrCtrl+Shift+S"),
            )?,
            &item("file:export-embl", "Export EMBL", None)?,
            &item("file:export-gff3", "Export GFF3", None)?,
        ],
    )?;

    let file_export_batch_sub = submenu_escaped(
        app,
        "Batch & SVG Export",
        true,
        &[
            &item("file:export-batch-fasta", "Batch FASTA", None)?,
            &item("file:export-batch-fastq", "Reads as FASTQ", None)?,
            &item("file:export-mbc-json", "Export MBC JSON", None)?,
            &item("file:export-folder-mbc", "Export Folder as MBC", None)?,
            &item("file:export-folder-gb", "Export Folder", None)?,
            &item("file:export-lineage", "Export Lineage", None)?,
            &item("file:export-consensus", "Export Consensus", None)?,
            &sep()?,
            &item("file:save-svg-image", "Save SVG Map", None)?,
        ],
    )?;

    let file_print_sub = submenu_escaped(
        app,
        "Print & PDF",
        true,
        &[&item("file:print", "Print / Export PDF", Some("CmdOrCtrl+P"))?],
    )?;

    let file_menu = submenu_escaped(
        app,
        "File",
        true,
        &[
            &new_session_menu,
            &sep()?,
            &file_open_sub,
            &file_save_sub,
            &file_folders_sub,
            &file_fav_trash_sub,
            &file_backup_sub,
            &file_prefs_sub,
            &sep()?,
            &file_import_sub,
            &file_export_seq_sub,
            &file_export_batch_sub,
            &file_print_sub,
        ],
    )?;

    let edit_seq_sel_sub = submenu_escaped(
        app,
        "Selection",
        true,
        &[
            &item(
                "edit:copy-sequence",
                "Copy Region",
                Some("CmdOrCtrl+Shift+C"),
            )?,
            &item(
                "edit:select-all-sequence",
                "Select Full Sequence",
                Some("CmdOrCtrl+Shift+A"),
            )?,
        ],
    )?;

    let edit_find_sub = submenu_escaped(
        app,
        "Find & Navigate",
        true,
        &[
            &item("edit:find-in-doc", "Find in Sequence", Some("CmdOrCtrl+F"))?,
            &item("edit:next-feature", "Next Feature", Some("CmdOrCtrl+G"))?,
            &item("edit:find-duplicates", "Find Duplicates…", None)?,
            &item("edit:batch-rename", "Batch Rename…", None)?,
        ],
    )?;

    let edit_menu = submenu_escaped(
        app,
        "Edit",
        true,
        &[
            // Custom items (not PredefinedMenuItem::undo/redo): the predefined
            // ones send `undo:` to WKWebView's text undo manager and never reach
            // the workbench's document undo stack. The frontend dispatcher keeps
            // text-field undo when an input has focus.
            &item("edit:undo", "Undo", Some("CmdOrCtrl+Z"))?,
            &item("edit:redo", "Redo", Some("CmdOrCtrl+Shift+Z"))?,
            &sep()?,
            &PredefinedMenuItem::cut(app, None)?,
            &PredefinedMenuItem::copy(app, None)?,
            &PredefinedMenuItem::paste(app, None)?,
            &PredefinedMenuItem::select_all(app, None)?,
            &sep()?,
            &edit_seq_sel_sub,
            &edit_find_sub,
        ],
    )?;

    let view_nav_sub = submenu_escaped(
        app,
        "History",
        true,
        &[
            &item("view:back", "Back", Some("CmdOrCtrl+["))?,
            &item("view:forward", "Forward", Some("CmdOrCtrl+]"))?,
        ],
    )?;

    let view_search_sub = submenu_escaped(
        app,
        "Search & Filter",
        true,
        &[
            &item("view:filter-folder", "Filter Folder", Some("CmdOrCtrl+Alt+F"))?,
            &item(
                "view:search-tools",
                "Search Tools & Files",
                Some("CmdOrCtrl+Shift+F"),
            )?,
        ],
    )?;

    let view_panels_sub = submenu_escaped(
        app,
        "Panels",
        true,
        &[
            &item(
                "view:toggle-sidebar",
                "Toggle Sidebar",
                Some("CmdOrCtrl+Ctrl+S"),
            )?,
            &item("view:toggle-doctable", "Toggle File Table", None)?,
            &item(
                "view:toggle-inspector",
                "Toggle Inspector",
                Some("CmdOrCtrl+Alt+I"),
            )?,
        ],
    )?;

    let view_split_expand_sub = submenu_escaped(
        app,
        "Split & Expand",
        true,
        &[
            &item("view:split-top-bottom", "Split Top / Bottom", None)?,
            &item("view:split-left-right", "Split Left / Right", None)?,
            &sep()?,
            &item(
                "view:expand-doc-view",
                "Expand Document View",
                Some("CmdOrCtrl+Shift+O"),
            )?,
        ],
    )?;

    let view_cols_sub = submenu_escaped(
        app,
        "Table Columns",
        true,
        &[
            &item("view:col-preset-cloning", "Cloning Preset", None)?,
            &item("view:col-preset-align", "Alignment Preset", None)?,
            &item("view:col-preset-genomics", "Genomics Preset", None)?,
            &item("view:col-preset-all", "Show All Columns", None)?,
            &sep()?,
            &item("view:col-lock", "Lock Column Order", None)?,
        ],
    )?;

    let view_layout_sub = submenu_escaped(
        app,
        "Map Layout",
        true,
        &[
            &item("view:layout-split", "Split Map & Linear", Some("CmdOrCtrl+1"))?,
            &item("view:layout-circular", "Circular Map", Some("CmdOrCtrl+2"))?,
            &item("view:layout-linear", "Linear Sequence", Some("CmdOrCtrl+4"))?,
        ],
    )?;

    let view_spec_sub = submenu_escaped(
        app,
        "Studio Views",
        true,
        &[
            &item("view:enzymes", "Enzymes View", Some("CmdOrCtrl+3"))?,
            &item("view:annotations", "Annotations Table", Some("CmdOrCtrl+5"))?,
            &item("view:text", "Flatfile View", Some("CmdOrCtrl+6"))?,
            &item(
                "view:secondary-structure",
                "Secondary Structure",
                Some("CmdOrCtrl+7"),
            )?,
            &item("view:lineage", "History & Lineage", Some("CmdOrCtrl+8"))?,
        ],
    )?;

    let view_zoom_sub = submenu_escaped(
        app,
        "Zoom",
        true,
        &[
            &item("view:zoom-in", "Zoom In", Some("CmdOrCtrl+="))?,
            &item("view:zoom-out", "Zoom Out", Some("CmdOrCtrl+-"))?,
            &item("view:zoom-reset", "Actual Size (100%)", Some("CmdOrCtrl+0"))?,
            &sep()?,
            &item(
                "view:set-origin",
                "Set Origin",
                Some("CmdOrCtrl+Shift+0"),
            )?,
        ],
    )?;

    let view_menu = submenu_escaped(
        app,
        "View",
        true,
        &[
            &view_nav_sub,
            &view_search_sub,
            &view_panels_sub,
            &view_split_expand_sub,
            &view_cols_sub,
            &sep()?,
            &view_layout_sub,
            &view_spec_sub,
            &sep()?,
            &view_zoom_sub,
        ],
    )?;

    let enz_select_sub = submenu_escaped(
        app,
        "Enzyme Views",
        true,
        &[
            &item("enzymes:choose", "Choose Enzymes", Some("CmdOrCtrl+E"))?,
            &item("enzymes:digest-dialog", "Digest into Fragments…", None)?,
            &item("enzymes:table", "Enzymes Table", Some("CmdOrCtrl+3"))?,
        ],
    )?;

    let enz_screen_sub = submenu_escaped(
        app,
        "Site Screening",
        true,
        &[
            &item("enzymes:noncutters", "Non-Cutters", None)?,
            &item("enzymes:silent-mutations", "Silent Mutations", None)?,
        ],
    )?;

    let enz_supp_sub = submenu_escaped(
        app,
        "Methylation",
        true,
        &[
            &item("enzymes:suppliers", "Suppliers & Methylation", None)?,
            &item("prefs:gels", "Gel Preferences", None)?,
        ],
    )?;

    let enzymes_menu = submenu_escaped(
        app,
        "Enzymes",
        true,
        &[&enz_select_sub, &enz_screen_sub, &enz_supp_sub],
    )?;

    let feat_annot_sub = submenu_escaped(
        app,
        "Add & Detect",
        true,
        &[
            &item("features:add", "Add Feature", Some("CmdOrCtrl+T"))?,
            &item("features:detect-common", "Detect Common Features", None)?,
            &item("features:add-protease", "Add Tag / Protease", None)?,
        ],
    )?;

    let feat_lib_sub = submenu_escaped(
        app,
        "Feature Library",
        true,
        &[
            &item("features:manage-library", "Manage Library", None)?,
            &item("annotate:transfer", "Transfer Features", None)?,
            &item("tools:extract-annotations", "Extract Features", None)?,
        ],
    )?;

    let features_menu = submenu_escaped(
        app,
        "Features",
        true,
        &[&feat_annot_sub, &feat_lib_sub],
    )?;

    let prm_design_sub = submenu_escaped(
        app,
        "Design Primers",
        true,
        &[
            &item("primers:design-dialog", "Design Primers…", None)?,
            &item("primers:degenerate-dialog", "Design Degenerate Primers…", None)?,
            &item("primers:test-saved-dialog", "Test with Saved Primers…", None)?,
            &item("primers:add", "Add Primer", None)?,
            &item("primers:add-list", "Import Primers from Spreadsheet…", None)?,
            &item("primers:design", "Design Primer Pair", None)?,
            &item("primers:convert-to-oligo", "Selection to Oligo", None)?,
        ],
    )?;

    let prm_hyb_sub = submenu_escaped(
        app,
        "Specificity",
        true,
        &[
            &item("primers:import-saved", "Map Saved Primers", None)?,
            &item("primers:specificity", "Off-Target Check", None)?,
            &item("primers:export", "Export Primers", None)?,
        ],
    )?;

    let prm_pcr_mut_sub = submenu_escaped(
        app,
        "PCR & Mutagenesis",
        true,
        &[
            &item("primers:pcr", "In-Silico PCR", None)?,
            &item("actions:soe-pcr", "Overlap PCR", None)?,
            &item("primers:mutagenesis", "Site Mutagenesis", None)?,
        ],
    )?;

    let prm_crispr_sub = submenu_escaped(
        app,
        "CRISPR Guides",
        true,
        &[
            &item("primers:crispr", "Find CRISPR Sites", None)?,
            &item("primers:crispr-editing-dialog", "CRISPR Editing Analysis…", None)?,
        ],
    )?;

    let prm_prefs_sub = submenu_escaped(
        app,
        "Primer Settings",
        true,
        &[&item("primers:preferences", "Primer Preferences", None)?],
    )?;

    let primers_menu = submenu_escaped(
        app,
        "Primers",
        true,
        &[
            &prm_design_sub,
            &prm_hyb_sub,
            &prm_pcr_mut_sub,
            &prm_crispr_sub,
            &sep()?,
            &prm_prefs_sub,
        ],
    )?;

    let aln_msa_sub = submenu_escaped(
        app,
        "Multiple Alignment",
        true,
        &[
            &item(
                "align:msa-mafft",
                "MAFFT Alignment",
                Some("CmdOrCtrl+Alt+A"),
            )?,
            &item("align:msa-clustalo", "Clustal Omega", None)?,
            &item("align:msa-muscle", "MUSCLE Alignment", None)?,
        ],
    )?;

    let aln_pairwise_sub = submenu_escaped(
        app,
        "Pairwise & Dotplot",
        true,
        &[
            &item("align:pairwise-nw", "Global Pairwise (NW)", None)?,
            &item("align:pairwise-sw", "Local Pairwise (SW)", None)?,
            &item("align:dotplot", "K-mer Dotplot", None)?,
        ],
    )?;

    let aln_reads_sub = submenu_escaped(
        app,
        "Read Mapping & Contigs",
        true,
        &[
            &item("align:map-reference", "Map to Reference", None)?,
            &item("align:denovo-assemble", "De Novo Assembly", None)?,
            &item("align:sanger-contig", "Sanger Contigs", None)?,
        ],
    )?;

    let aln_genome_sub = submenu_escaped(
        app,
        "Genome Alignment",
        true,
        &[&item("align:whole-genome", "Whole-Genome Synteny", None)?],
    )?;

    let aln_ops_sub = submenu_escaped(
        app,
        "Consensus & Batch",
        true,
        &[
            &item("tools:generate-consensus", "Generate Consensus", None)?,
            &item("tools:concatenate", "Concatenate Sequences", None)?,
            &item("tools:mask-low-complexity", "Mask Homopolymers", None)?,
            &item("file:export-consensus", "Export Consensus", None)?,
            &item("tools:plugin-haplotype-part", "Haplotype & Allele Partitioner", None)?,
            &item("tools:plugin-ext-cli", "External CLI Suite", None)?,
        ],
    )?;

    // The operation windows, as alignment_menu_window_items makes them, then the submenus.
    let alignment_windows = alignment_menu_window_items(|w| item(w.id, w.label, w.accel))?;
    let alignment_sep = sep()?;
    let mut alignment_items: Vec<&dyn tauri::menu::IsMenuItem<R>> = alignment_windows
        .iter()
        .map(|w| w as &dyn tauri::menu::IsMenuItem<R>)
        .collect();
    alignment_items.extend([
        &aln_msa_sub as &dyn tauri::menu::IsMenuItem<R>,
        &aln_pairwise_sub as &dyn tauri::menu::IsMenuItem<R>,
        &aln_reads_sub as &dyn tauri::menu::IsMenuItem<R>,
        &aln_genome_sub as &dyn tauri::menu::IsMenuItem<R>,
        &alignment_sep as &dyn tauri::menu::IsMenuItem<R>,
        &aln_ops_sub as &dyn tauri::menu::IsMenuItem<R>,
    ]);
    let alignment_menu = submenu_escaped(app, "Alignment", true, &alignment_items)?;

    let phylo_tree_sub = submenu_escaped(
        app,
        "Tree Reconstruction",
        true,
        &[
            &item(
                "phylo:tree-ml",
                "Maximum Likelihood (ML)",
                Some("CmdOrCtrl+Alt+T"),
            )?,
            &item("phylo:tree-fasttree", "FastTree (runs if installed)", None)?,
            &item("phylo:tree-phyml", "PhyML (runs if installed)", None)?,
            &item("phylo:tree-raxml", "RAxML (runs if installed)", None)?,
            &item("phylo:tree-mrbayes", "MrBayes (runs if installed)", None)?,
            &sep()?,
            &item("phylo:tree-nj", "Neighbor-Joining (NJ)", None)?,
            &item("phylo:tree-me", "Minimum Evolution (ME)", None)?,
            &item("phylo:tree-upgma", "UPGMA Tree", None)?,
            &item("phylo:tree-mp", "Maximum Parsimony (MP)", None)?,
        ],
    )?;

    let phylo_user_anc_sub = submenu_escaped(
        app,
        "Ancestral States",
        true,
        &[
            &item("phylo:usertree", "User Tree Analysis", None)?,
            &item("phylo:ancestors-ml", "Ancestral ML", None)?,
            &item("phylo:ancestors-mp", "Ancestral Parsimony", None)?,
        ],
    )?;

    let phylo_models_sub = submenu_escaped(
        app,
        "Substitution Models",
        true,
        &[
            &item("phylo:models-best", "Best Model Fit", None)?,
            &item("phylo:models-matrix", "Rate Matrix", None)?,
            &item("phylo:models-disparity", "Homogeneity Test", None)?,
        ],
    )?;

    let phylo_codon_sub = submenu_escaped(
        app,
        "Codon Usage & Data",
        true,
        &[
            &item("phylo:data", "Alignment Data", None)?,
            &item("phylo:models-composition", "Base Composition", None)?,
            &item("phylo:models-rscu", "Codon Usage (RSCU)", None)?,
        ],
    )?;

    let phylo_dist_div_sub = submenu_escaped(
        app,
        "Distances & Diversity",
        true,
        &[
            &item("phylo:distance", "Pairwise Distances", None)?,
            &item("phylo:diversity", "Population Diversity", None)?,
        ],
    )?;

    let phylo_sel_sub = submenu_escaped(
        app,
        "Selection & Rates",
        true,
        &[
            &item("phylo:selection", "Codon Selection (dN/dS)", None)?,
            &item("phylo:rates", "Site Gamma Rates", None)?,
        ],
    )?;

    let phylo_clock_sub = submenu_escaped(
        app,
        "Clocks & Variants",
        true,
        &[
            &item("phylo:clocks", "Molecular Clock", None)?,
            &item("phylo:diagnose", "Variant Impact", None)?,
            &item("tools:plugin-species-delim", "Species Delimitation", None)?,
            &item("tools:plugin-hpc-phylo", "HPC Phylogeny Job Builder", None)?,
        ],
    )?;

    let phylogenetics_menu = submenu_escaped(
        app,
        "Phylogenetics",
        true,
        &[
            &item("phylo:build-tree", "Build Tree…", None)?,
            &item("phylo:compute-distances-dialog", "Compute Distances…", None)?,
            &item("phylo:consensus-tree", "Consensus Tree…", None)?,
            &item("phylo:condense-tree", "Condense Tree…", None)?,
            &item("phylo:timetree", "Compute Timetree…", None)?,
            &item("phylo:gene-duplications", "Gene Duplication Inference…", None)?,
            &phylo_tree_sub,
            &phylo_user_anc_sub,
            &phylo_models_sub,
            &phylo_codon_sub,
            &phylo_dist_div_sub,
            &phylo_sel_sub,
            &phylo_clock_sub,
        ],
    )?;

    let act_rest_sub = submenu_escaped(
        app,
        "Restriction Cloning",
        true,
        &[
            &item("enzymes:find-sites", "Find Sites", None)?,
            &item("enzymes:digest-dialog", "Digest into Fragments…", None)?,
            &item("tools:agarose-gel", "Agarose Digest", None)?,
            &item("actions:ligate-fragments", "Ligate Fragments", None)?,
            &item("actions:restriction-cloning", "Restriction Ligation", None)?,
            &item("actions:anneal-oligos", "Anneal Oligos", None)?,
            &item("enzymes:noncutters", "Non-Cutters", None)?,
        ],
    )?;

    let act_pcr_sub = submenu_escaped(
        app,
        "PCR Cloning",
        true,
        &[
            &item("actions:pcr", "PCR Amplification", Some("CmdOrCtrl+D"))?,
            &item("actions:soe-pcr", "Overlap PCR", None)?,
        ],
    )?;

    let act_mut_sub = submenu_escaped(
        app,
        "Mutagenesis",
        true,
        &[
            &item(
                "actions:mutagenesis",
                "Site Mutagenesis",
                Some("CmdOrCtrl+J"),
            )?,
            &item("sequence:mutate-shuffle", "Point Mutation", None)?,
        ],
    )?;

    let act_seamless_sub = submenu_escaped(
        app,
        "Seamless Assembly",
        true,
        &[
            &item("actions:gibson", "Gibson Assembly", None)?,
            &item("actions:golden-gate", "Golden Gate", None)?,
            &item("actions:hifi", "NEBuilder HiFi", None)?,
            &item("actions:in-fusion", "In-Fusion", None)?,
            &item("actions:parts-cloning", "Parts Cloning", None)?,
        ],
    )?;

    let gw_donor_sub = submenu_escaped(
        app,
        "Donor Vectors",
        true,
        &[
            &item("action-vec:gw-pdonr221", "pDONR221", None)?,
            &item("action-vec:gw-pdonr201", "pDONR201", None)?,
            &item("action-vec:gw-pdonr207", "pDONR207", None)?,
            &item("action-vec:gw-pdonr-zeo", "pDONR/Zeo", None)?,
            &item("action-vec:gw-pdonr221-p1p4", "pDONR221 P1-P4", None)?,
            &item("action-vec:gw-pdonr221-p4rp3r", "pDONR221 P4r-P3r", None)?,
            &item("action-vec:gw-pdonr221-p3p2", "pDONR221 P3-P2", None)?,
        ],
    )?;

    let gw_dest_sub = submenu_escaped(
        app,
        "Destination Vectors",
        true,
        &[
            &item("action-vec:gw-pdest14", "pDEST14", None)?,
            &item("action-vec:gw-pdest15", "pDEST15", None)?,
            &item("action-vec:gw-pdest17", "pDEST17", None)?,
            &item("action-vec:gw-pcdna-dest40", "pcDNA-DEST40", None)?,
            &item("action-vec:gw-plenti6-v5-dest", "pLenti6/V5-DEST", None)?,
            &item("action-vec:gw-pbad-dest49", "pBAD-DEST49", None)?,
        ],
    )?;

    let act_gateway_sub = submenu_escaped(
        app,
        "Gateway Cloning",
        true,
        &[
            &item("actions:gateway", "BP / LR Cloning", None)?,
            &item("actions:annotate-att", "Annotate att Sites", None)?,
            &item("actions:add-attb", "Add attB Sites", None)?,
            &sep()?,
            &gw_donor_sub,
            &gw_dest_sub,
        ],
    )?;

    let ta_vec_sub = submenu_escaped(
        app,
        "TA Vectors",
        true,
        &[
            &item("action-vec:ta-pgem-t-easy", "pGEM-T Easy", None)?,
            &item("action-vec:ta-pgem-t", "pGEM-T", None)?,
            &item("action-vec:ta-pcr21", "pCR2.1", None)?,
            &item("action-vec:ta-pcr4", "pCR4-TA", None)?,
            &item("action-vec:ta-ptz57r-t", "pTZ57R/T", None)?,
        ],
    )?;

    let gc_vec_sub = submenu_escaped(
        app,
        "GC Vectors",
        true,
        &[
            &item("action-vec:gc-pgc-blue", "pGC Blue", None)?,
            &item("action-vec:gc-psmart-gc-hk", "pSMART GC HK", None)?,
            &item("action-vec:gc-psmart-gc-lk", "pSMART GC LK", None)?,
        ],
    )?;

    let act_ta_gc_sub = submenu_escaped(
        app,
        "TA & GC Cloning",
        true,
        &[
            &item("actions:ta-gc", "TA / GC Cloning", None)?,
            &sep()?,
            &ta_vec_sub,
            &gc_vec_sub,
        ],
    )?;

    let topo_ta_sub = submenu_escaped(
        app,
        "TOPO TA Vectors",
        true,
        &[
            &item("action-vec:topo-pcr21-topo", "pCR2.1-TOPO", None)?,
            &item("action-vec:topo-pcr4-topo", "pCR4-TOPO", None)?,
            &item("action-vec:topo-pcdna31-v5-his-topo", "pcDNA3.1/V5-His-TOPO", None)?,
        ],
    )?;

    let topo_blunt_sub = submenu_escaped(
        app,
        "Blunt TOPO Vectors",
        true,
        &[
            &item("action-vec:topo-pcr-blunt-ii", "pCR-Blunt II-TOPO", None)?,
            &item("action-vec:topo-pcr4blunt", "pCR4Blunt-TOPO", None)?,
        ],
    )?;

    let topo_dir_sub = submenu_escaped(
        app,
        "D-TOPO Vectors",
        true,
        &[
            &item("action-vec:topo-pentr-d-topo", "pENTR/D-TOPO", None)?,
            &item("action-vec:topo-pet100-d-topo", "pET100/D-TOPO", None)?,
            &item("action-vec:topo-pet151-d-topo", "pET151/D-TOPO", None)?,
            &item("action-vec:topo-pcdna31d-v5-his-topo", "pcDNA3.1D/V5-His-TOPO", None)?,
        ],
    )?;

    let act_topo_sub = submenu_escaped(
        app,
        "TOPO Cloning",
        true,
        &[
            &item("actions:topo", "TOPO Cloning", None)?,
            &sep()?,
            &topo_ta_sub,
            &topo_blunt_sub,
            &topo_dir_sub,
        ],
    )?;

    let cloning_menu = submenu_escaped(
        app,
        "Cloning",
        true,
        &[
            &item("actions:clone-dialog", "Clone Insert into Vector…", None)?,
            &item("actions:validate-clone-dialog", "Validate Clone…", None)?,
            &act_rest_sub,
            &act_pcr_sub,
            &act_mut_sub,
            &act_seamless_sub,
            &sep()?,
            &act_gateway_sub,
            &act_ta_gc_sub,
            &act_topo_sub,
            &sep()?,
            &enzymes_menu,
            &primers_menu,
        ],
    )?;

    let tools_gel_sub = submenu_escaped(
        app,
        "Gel & Calculators",
        true,
        &[
            &item(
                "tools:agarose-gel",
                "Agarose Gel",
                Some("CmdOrCtrl+Shift+G"),
            )?,
            &item(
                "tools:dna-calc",
                "DNA Calculations",
                Some("CmdOrCtrl+Shift+M"),
            )?,
        ],
    )?;

    let tools_blast_vec_sub = submenu_escaped(
        app,
        "BLAST & Vectors",
        true,
        &[
            &item("tools:blast", "BLAST Search", Some("CmdOrCtrl+Shift+B"))?,
            &item("tools:vectors", "Vector Catalog", None)?,
            &item("tools:vectors-architect", "Vector Architect", None)?,
            &item("tools:primers", "Primers & CRISPR", None)?,
        ],
    )?;

    let tools_dbs_sub = submenu_escaped(
        app,
        "Databases",
        true,
        &[
            &item("tools:databases-explorer", "NCBI & UniProt", None)?,
            &item("tools:make-blast-db", "Make BLAST Database from Selection…", None)?,
            &item("tools:local-blast-dbs", "Local BLAST DBs", None)?,
            &item("tools:blast-setup", "BLAST Setup", None)?,
        ],
    )?;

    let tools_batch_sub = submenu_escaped(
        app,
        "Batch Operations",
        true,
        &[
            &item("tools:extract-annotations", "Extract Features", None)?,
            &item("tools:mask-selection", "Mask Selection", None)?,
            &item("tools:mask-low-complexity", "Mask Homopolymers", None)?,
            &item("tools:concatenate", "Concatenate", None)?,
            &item("tools:generate-consensus", "Generate Consensus", None)?,
        ],
    )?;

    let tools_seq_ngs_sub = submenu_escaped(
        app,
        "Sequencing & NGS",
        true,
        &[
            &item("tools:sanger", "Sanger Studio", None)?,
            &item("tools:ngs-suite", "NGS Assembly", None)?,
            &item("tools:genome-variants", "Genome Variants", None)?,
            &item("tools:genbank-submit", "GenBank Submission", None)?,
        ],
    )?;

    let tools_pipelines_sub = submenu_escaped(
        app,
        "Pipelines",
        true,
        &[
            &item(
                "tools:pipelines",
                "Guided Pipelines",
                Some("CmdOrCtrl+Shift+Y"),
            )?,
            &item("tools:workflows", "Lineage Manager", None)?,
        ],
    )?;

    let tools_wf_batch_sub = submenu_escaped(
        app,
        "Batch Workflows",
        true,
        &[
            &item("workflows:manage", "Manage Workflows…", None)?,
            &item("workflows:run", "Run Workflow…", None)?,
            &item("workflows:group-by-name", "Group by Prefix", None)?,
            &item("workflows:modify-intervals", "Modify Intervals", None)?,
            &item("workflows:random-sample", "Sample Sequences", None)?,
            &item("workflows:set-cds-translation", "Set CDS Translation", None)?,
        ],
    )?;

    let tools_plugins_sub = submenu_escaped(
        app,
        "Bioinformatics Plugins",
        true,
        &[
            &item("tools:plugin-euk-gene", "Eukaryotic Gene Predictor", None)?,
            &item("tools:plugin-microbial-gene", "Microbial Gene Predictor", None)?,
            &item("tools:plugin-crispr-arrays", "CRISPR Repeat Array Finder", None)?,
            &item("tools:plugin-tandem-repeats", "Microsatellite & Tandem Repeats", None)?,
            &item("tools:plugin-haplotype-part", "Haplotype & Allele Partitioner", None)?,
            &item("tools:plugin-taxonomic-class", "Taxonomic Sequence Classifier", None)?,
            &item("tools:plugin-species-delim", "Species Delimitation", None)?,
            &item("tools:plugin-protein-domains", "Protein Domains & Epitopes", None)?,
            &item("tools:plugin-tm-topology", "Transmembrane & Signal Topology", None)?,
            &item("tools:plugin-adapter-trimmer", "Adapter & Quality Read Trimmer", None)?,
            &item("tools:plugin-synteny-blocks", "Whole-Genome Synteny Blocks", None)?,
            &item("tools:plugin-hpc-phylo", "HPC Phylogeny Job Builder", None)?,
            &item("tools:plugin-ext-cli", "External CLI Suite", None)?,
        ],
    )?;

    let tools_settings_sub = submenu_escaped(
        app,
        "Settings",
        true,
        &[&item(
            "tools:preferences",
            "Preferences",
            Some("CmdOrCtrl+Shift+P"),
        )?],
    )?;

    let tools_menu = submenu_escaped(
        app,
        "Tools",
        true,
        &[
            &alignment_menu,
            &phylogenetics_menu,
            &sep()?,
            &tools_gel_sub,
            &tools_blast_vec_sub,
            &tools_dbs_sub,
            &tools_batch_sub,
            &tools_seq_ngs_sub,
            &sep()?,
            &tools_pipelines_sub,
            &tools_wf_batch_sub,
            &tools_plugins_sub,
            &tools_settings_sub,
        ],
    )?;

    let seq_strand_sub = submenu_escaped(
        app,
        "Strand",
        true,
        &[
            &item(
                "sequence:reverse-complement",
                "Reverse Complement",
                Some("CmdOrCtrl+Shift+R"),
            )?,
            &item("sequence:complement-only", "Complement Only", None)?,
            &item("sequence:reverse-only", "Reverse Only", None)?,
        ],
    )?;

    let seq_trans_sub = submenu_escaped(
        app,
        "Translation",
        true,
        &[
            &item("sequence:back-translate-dialog", "Back-Translate…", None)?,
            &item("sequence:translate", "Translate Frames", None)?,
            &item("sequence:back-translate", "Back Translate", None)?,
            &item("sequence:convert-dna-rna", "Convert DNA / RNA", None)?,
        ],
    )?;

    let seq_topo_sub = submenu_escaped(
        app,
        "Topology & Edit",
        true,
        &[
            &item("sequence:toggle-topology", "Circular Topology", None)?,
            &item("sequence:extract-region", "Extract Region", None)?,
            &item("sequence:mutate-shuffle", "Mutate & Shuffle", None)?,
        ],
    )?;

    let seq_asm_sub = submenu_escaped(
        app,
        "Read Assembly",
        true,
        &[
            &item("sequence:contig-assembly", "Merge Reads", None)?,
            &item("sequence:denovo-assemble", "De Novo Assembly", None)?,
        ],
    )?;

    let annot_genes_sub = submenu_escaped(
        app,
        "Genes & ORFs",
        true,
        &[
            &item("annotate:find-orfs-dialog", "Find ORFs…", None)?,
            &item("annotate:from-documents-dialog", "Annotate from Documents…", None)?,
            &item("annotate:microsatellites-dialog", "Microsatellite Analysis…", None)?,
            &item("annotate:expression-dialog", "Compare Expression Levels…", None)?,
            &item("annotate:compare-dialog", "Compare Annotations…", None)?,
            &item("annotate:find-orfs", "Show ORFs", None)?,
            &item("annotate:glimmer-genes", "Microbial Genes", None)?,
            &item("annotate:cpg-repeats", "CpG & Repeats", None)?,
            &item("annotate:find-motifs", "Find Motifs", None)?,
        ],
    )?;

    let annot_var_sub = submenu_escaped(
        app,
        "CRISPR & Variants",
        true,
        &[
            &item("annotate:find-crispr", "Find CRISPR Sites", None)?,
            &item("annotate:freebayes-str", "Call Variants", None)?,
            &item("annotate:classify-16s", "16S / ITS Taxonomy", None)?,
        ],
    )?;

    let annot_qc_sub = submenu_escaped(
        app,
        "Read QC & Transfer",
        true,
        &[
            &item("annotate:bbduk-trim", "Trim NGS Reads", None)?,
            &item("annotate:transfer", "Transfer Annotations", None)?,
            &item("annotate:blast", "Annotate by BLAST…", None)?,
        ],
    )?;

    let annot_prot_sub = submenu_escaped(
        app,
        "Protein & 3D",
        true,
        &[
            &item("annotate:protein-domains", "Protein Domains", None)?,
            &item("annotate:coils-tm-pdb", "3D Structure & Coils", None)?,
        ],
    )?;

    let annotate_menu = submenu_escaped(
        app,
        "Annotate",
        true,
        &[
            &annot_genes_sub,
            &annot_var_sub,
            &annot_qc_sub,
            &annot_prot_sub,
        ],
    )?;

    let sequence_menu = submenu_escaped(
        app,
        "Sequence",
        true,
        &[
            &seq_strand_sub,
            &seq_trans_sub,
            &seq_topo_sub,
            &seq_asm_sub,
            &sep()?,
            &features_menu,
            &annotate_menu,
        ],
    )?;

    let window_menu = submenu_escaped(
        app,
        "Window",
        true,
        &[
            &PredefinedMenuItem::minimize(app, None)?,
            &PredefinedMenuItem::maximize(app, None)?,
            &PredefinedMenuItem::fullscreen(app, None)?,
        ],
    )?;

    let help_guides_sub = submenu_escaped(
        app,
        "Guides",
        true,
        &[
            &item("help:panel", "Show Help Panel", Some("F1"))?,
            &item("help:shortcuts", "Keyboard Shortcuts", None)?,
            &item("help:tutorials", "Tutorials & Samples", None)?,
            &item("help:examples", "Load Example Data…", None)?,
            &item("help:vector-guide", "Vector Guide", None)?,
        ],
    )?;

    let help_about_sub = submenu_escaped(
        app,
        "About",
        true,
        &[
            &item("help:updates", "Check for Updates", None)?,
            &item("help:about", "About MolBioCraft", None)?,
        ],
    )?;

    let help_menu = submenu_escaped(
        app,
        "Help",
        true,
        &[&help_guides_sub, &help_about_sub],
    )?;

    Menu::with_items(
        app,
        &[
            &app_menu,
            &file_menu,
            &edit_menu,
            &view_menu,
            &sequence_menu,
            &cloning_menu,
            &tools_menu,
            &window_menu,
            &help_menu,
        ],
    )
}

fn main() {
    let backend_state = AppBackendState::default();
    // Windows / Linux file associations launch the app with the document path.
    backend_state.queue_open_files(commands::open_file_args(std::env::args().skip(1)));
    let _ = rest_api::spawn_embedded_rest_server(backend_state.clone(), rest_api::DEFAULT_REST_PORT);

    let builder = tauri::Builder::default()
        .manage(backend_state)
        .setup(|_app| {
            #[cfg(target_os = "macos")]
            {
                let menu = build_macos_menu(_app.handle())?;
                _app.set_menu(menu)?;
            }
            Ok(())
        })
        .on_menu_event(|app, event| {
            let _ = app.emit("mbc://native-menu", event.id().0.as_str());
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.state::<AppBackendState>();
                if state.should_veto_close(std::time::Instant::now()) {
                    api.prevent_close();
                    let _ = window
                        .app_handle()
                        .emit("mbc://native-menu", "app:request-quit");
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            cmd_platform_diagnostics,
            cmd_rest_api_info,
            cmd_sequence_stats,
            cmd_batch_sequence_stats,
            cmd_reverse_complement,
            cmd_primer_thermodynamics,
            cmd_pairwise_align,
            cmd_rust_bio_invoke,
            cmd_detect_tree_programs,
            cmd_run_external_tree,
            cmd_cancel_external_tree,
            cmd_genome_viewport,
            cmd_genome_tracks,
            cmd_read_workspace_file,
            cmd_write_workspace_file,
            cmd_read_dropped_file_bytes,
            cmd_native_open_files_dialog,
            cmd_native_save_file_dialog,
            cmd_take_pending_open_files,
            cmd_window_start_dragging,
            cmd_window_toggle_maximize,
            cmd_print_webview,
            cmd_ack_quit_request,
            cmd_sync_native_menu_state,
            cmd_set_confirm_before_quit,
            cmd_app_exit
        ]);

    let app = builder
        .build(tauri::generate_context!())
        .expect("error while building MolBioCraft Tauri application");

    app.run(|app_handle, event| {
        // macOS delivers file-association / Finder "Open With" requests as an
        // Apple Event, both at launch and while running.
        #[cfg(any(target_os = "macos", target_os = "ios"))]
        if let tauri::RunEvent::Opened { urls } = &event {
            let paths: Vec<std::path::PathBuf> =
                urls.iter().filter_map(|u| u.to_file_path().ok()).collect();
            if !paths.is_empty() {
                app_handle.state::<AppBackendState>().queue_open_files(paths);
                let _ = app_handle.emit("mbc://open-files-pending", ());
            }
        }
        if let tauri::RunEvent::ExitRequested { api, code, .. } = event {
            let state = app_handle.state::<AppBackendState>();
            if code.is_none() && state.should_veto_close(std::time::Instant::now()) {
                api.prevent_exit();
                let _ = app_handle.emit("mbc://native-menu", "app:request-quit");
            }
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The Alignment menu lists Align Structures… with the other operation windows, under the id
    /// the frontend dispatcher opens the structure alignment window for
    /// (`case 'align:structures-dialog'`, checked by src/__tests__/structureToolsWiring.test.tsx
    /// and nativeMenuContract.test.ts). Building the menu itself needs a Tauri app handle (the mock
    /// runtime is behind tauri's `test` feature, which this crate does not enable), so this runs
    /// `alignment_menu_window_items`, which `build_macos_menu` makes the menu's window items with,
    /// and reads the commands it makes them from.
    #[test]
    fn native_menu_lists_align_structures() {
        let built = alignment_menu_window_items(|w| Ok::<_, ()>(*w)).unwrap();
        let ids: Vec<&str> = built.iter().map(|w| w.id).collect();
        let at = ids
            .iter()
            .position(|id| *id == "align:structures-dialog")
            .expect("Align Structures… is in the native Alignment menu");
        assert_eq!(
            built[at],
            NativeMenuCommand { id: "align:structures-dialog", label: "Align Structures…", accel: None }
        );
        // Beside the other two-input alignment window.
        assert_eq!(ids[at - 1], "align:pairwise-dialog");
        // One item per id: a repeated id would send two items to one dispatcher case.
        let mut unique = ids.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), ids.len(), "{ids:?}");
        // Every item is an Alignment-menu window command (`align:…-dialog`).
        assert!(ids.iter().all(|id| id.starts_with("align:") && id.ends_with("-dialog")), "{ids:?}");
    }
}
