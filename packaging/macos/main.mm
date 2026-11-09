// Copyright 2026 MolBioCraft Contributors
// Licensed under the MolBioCraft Personal & Academic Research License v1.0 (Non-Commercial)

#import <Cocoa/Cocoa.h>
#import <WebKit/WebKit.h>

@class MolBioCraftAppDelegate;

@interface MolBioCraftWebView : WKWebView
@property (assign, nonatomic) MolBioCraftAppDelegate *appDelegate;
@property (assign, nonatomic) BOOL leftMouseDownActive;
@property (assign, nonatomic) BOOL dragStartedWithPhysicalButton;
@property (assign, nonatomic) BOOL windowDragArmed;
@property (assign, nonatomic) NSPoint dragStartMouseScreen;
@property (assign, nonatomic) NSPoint dragStartWindowOrigin;
- (NSPoint)screenLocationForMouseEvent:(NSEvent *)event;
- (void)translateArmedWindowToMouseScreenLocation:(NSPoint)curMouseScreen;
- (void)disarmWindowDrag;
@end

@interface MolBioCraftAppDelegate : NSObject <
    NSApplicationDelegate,
    NSWindowDelegate,
    WKUIDelegate,
    WKNavigationDelegate,
    WKDownloadDelegate,
    WKScriptMessageHandler
>
@property (strong, nonatomic) NSWindow *window;
@property (strong, nonatomic) MolBioCraftWebView *webView;
@property (strong, nonatomic) NSEvent *lastLeftMouseDownEvent;
@property (strong, nonatomic) id localMouseEventMonitor;
@property (strong, nonatomic) NSMutableArray<NSURL *> *pendingOpenURLs;
@property (assign, nonatomic) BOOL webViewReady;
@property (assign, nonatomic) BOOL confirmBeforeQuit;
@property (assign, nonatomic) BOOL quitApproved;
- (void)handleNativeMenuAction:(NSMenuItem *)sender;
- (void)promptNativeOpenFileWithMode:(NSString *)mode;
- (void)promptNativeSaveFileNamed:(NSString *)suggestedName content:(NSString *)content;
- (void)deliverLocalFileURLsToWebView:(NSArray<NSURL *> *)urls;
- (void)notifyNativeFileDragActive:(BOOL)active fileCount:(NSUInteger)count;
@end

static NSString *escapeJsString(NSString *input) {
    if (!input) return @"";
    NSMutableString *s = [input mutableCopy];
    [s replaceOccurrencesOfString:@"\\" withString:@"\\\\" options:0 range:NSMakeRange(0, s.length)];
    [s replaceOccurrencesOfString:@"\"" withString:@"\\\"" options:0 range:NSMakeRange(0, s.length)];
    [s replaceOccurrencesOfString:@"\n" withString:@"\\n" options:0 range:NSMakeRange(0, s.length)];
    [s replaceOccurrencesOfString:@"\r" withString:@"\\r" options:0 range:NSMakeRange(0, s.length)];
    return s;
}

static NSMenuItem *makeActionItem(
    NSString *title,
    NSString *actionId,
    NSString *keyEq,
    NSEventModifierFlags mods,
    MolBioCraftAppDelegate *target
) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title
                                                  action:@selector(handleNativeMenuAction:)
                                           keyEquivalent:(keyEq ?: @"")];
    if (keyEq.length > 0) {
        [item setKeyEquivalentModifierMask:mods];
    }
    [item setTarget:target];
    [item setRepresentedObject:actionId];
    return item;
}

static NSMenu *addSubmenu(NSMenu *parent, NSString *title) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:nil keyEquivalent:@""];
    NSMenu *sub = [[NSMenu alloc] initWithTitle:title];
    [item setSubmenu:sub];
    [parent addItem:item];
    return sub;
}

static void setupMainMenu(MolBioCraftAppDelegate *delegate) {
    const NSEventModifierFlags CMD = NSEventModifierFlagCommand;
    const NSEventModifierFlags SHIFT_CMD = NSEventModifierFlagCommand | NSEventModifierFlagShift;
    const NSEventModifierFlags OPT_CMD = NSEventModifierFlagCommand | NSEventModifierFlagOption;
    const NSEventModifierFlags CTRL_CMD = NSEventModifierFlagCommand | NSEventModifierFlagControl;
    const NSEventModifierFlags SHIFT_OPT_CMD =
        NSEventModifierFlagCommand | NSEventModifierFlagOption | NSEventModifierFlagShift;

    NSMenu *menubar = [[NSMenu alloc] init];
    [NSApp setMainMenu:menubar];

    // 1. MolBioCraft Application Menu
    NSMenuItem *appMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:appMenuItem];
    NSMenu *appMenu = [[NSMenu alloc] initWithTitle:@"MolBioCraft"];
    [appMenu addItem:makeActionItem(@"About MolBioCraft", @"app:about", @"", 0, delegate)];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItem:makeActionItem(@"Preferences", @"app:preferences", @",", CMD, delegate)];
    [appMenu addItem:makeActionItem(@"Toggle Theme", @"app:toggle-theme", @"l", SHIFT_CMD, delegate)];
    [appMenu addItem:[NSMenuItem separatorItem]];
    NSMenuItem *servicesItem = [[NSMenuItem alloc] initWithTitle:@"Services" action:nil keyEquivalent:@""];
    NSMenu *servicesMenu = [[NSMenu alloc] initWithTitle:@"Services"];
    [servicesItem setSubmenu:servicesMenu];
    [NSApp setServicesMenu:servicesMenu];
    [appMenu addItem:servicesItem];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItemWithTitle:@"Hide MolBioCraft" action:@selector(hide:) keyEquivalent:@"h"];
    NSMenuItem *hideOthers = [appMenu addItemWithTitle:@"Hide Others"
                                                action:@selector(hideOtherApplications:)
                                         keyEquivalent:@"h"];
    [hideOthers setKeyEquivalentModifierMask:OPT_CMD];
    [appMenu addItemWithTitle:@"Show All" action:@selector(unhideAllApplications:) keyEquivalent:@""];
    [appMenu addItem:[NSMenuItem separatorItem]];
    [appMenu addItem:makeActionItem(@"Quit MolBioCraft", @"app:request-quit", @"q", CMD, delegate)];
    [appMenuItem setSubmenu:appMenu];

    // 2. File Menu (New Session + Nested Sub-Menus)
    NSMenuItem *fileMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:fileMenuItem];
    NSMenu *fileMenu = [[NSMenu alloc] initWithTitle:@"File"];

    NSMenu *newSessionMenu = addSubmenu(fileMenu, @"New Session");
    [newSessionMenu addItem:makeActionItem(@"Blank Session", @"new-session:blank", @"n", OPT_CMD, delegate)];
    [newSessionMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *nsSeqVec = addSubmenu(newSessionMenu, @"Sequences & Vectors");
    [nsSeqVec addItem:makeActionItem(@"New Sequence", @"new-session:sequence", @"n", CMD, delegate)];
    [nsSeqVec addItem:makeActionItem(@"Vector Catalog", @"new-session:vector-catalog", @"", 0, delegate)];
    [nsSeqVec addItem:makeActionItem(@"Custom Vector", @"new-session:vector-architect", @"", 0, delegate)];
    [nsSeqVec addItem:makeActionItem(@"Vector QC", @"new-session:twist-onboarding", @"", 0, delegate)];
    [nsSeqVec addItem:makeActionItem(@"Flatfile Document", @"new-session:text-doc", @"", 0, delegate)];

    NSMenu *nsCloning = addSubmenu(newSessionMenu, @"Cloning & Primers");
    [nsCloning addItem:makeActionItem(@"Restriction Cloning", @"new-session:cloning-restriction", @"", 0, delegate)];
    [nsCloning addItem:makeActionItem(@"Seamless Assembly", @"new-session:cloning-assembly", @"", 0, delegate)];
    [nsCloning addItem:makeActionItem(@"Primers & CRISPR", @"new-session:primers-crispr", @"", 0, delegate)];
    [nsCloning addItem:makeActionItem(@"Enzyme Digest", @"new-session:enzyme-set", @"", 0, delegate)];

    NSMenu *nsAlign = addSubmenu(newSessionMenu, @"Alignment & Trees");
    [nsAlign addItem:makeActionItem(@"Sequence Alignment", @"new-session:align-task", @"", 0, delegate)];
    [nsAlign addItem:makeActionItem(@"Phylogenetic Tree", @"new-session:phylo-task", @"", 0, delegate)];

    NSMenu *nsSeqGen = addSubmenu(newSessionMenu, @"Sequencing & Genomics");
    [nsSeqGen addItem:makeActionItem(@"Sanger Traces", @"new-session:sanger-task", @"", 0, delegate)];
    [nsSeqGen addItem:makeActionItem(@"NGS & Genomics", @"new-session:ngs-genomics", @"", 0, delegate)];
    [nsSeqGen addItem:makeActionItem(@"Guided Pipeline", @"new-session:pipeline-task", @"", 0, delegate)];

    NSMenu *nsImport = addSubmenu(newSessionMenu, @"Starter & Import");
    [nsImport addItem:makeActionItem(@"Import Files", @"new-session:import-files", @"", 0, delegate)];
    [nsImport addItem:makeActionItem(@"Paste from Clipboard", @"new-session:import-clipboard", @"", 0, delegate)];
    [nsImport addItem:makeActionItem(@"New Folder", @"new-session:folder", @"n", SHIFT_CMD, delegate)];
    [nsImport addItem:[NSMenuItem separatorItem]];
    [nsImport addItem:makeActionItem(@"Sample Project", @"new-session:sample-library", @"", 0, delegate)];

    [fileMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *fileOpenSub = addSubmenu(fileMenu, @"Open Session");
    [fileOpenSub addItem:makeActionItem(@"Open Session", @"file:open-session", @"o", CMD, delegate)];
    [fileOpenSub addItem:makeActionItem(@"Merge Session", @"file:merge-session", @"", 0, delegate)];
    [fileOpenSub addItem:[NSMenuItem separatorItem]];
    [fileOpenSub addItem:makeActionItem(@"Restore Autosave", @"file:restore-autosave", @"", 0, delegate)];

    NSMenu *fileSaveSub = addSubmenu(fileMenu, @"Save Session");
    [fileSaveSub addItem:makeActionItem(@"Save Session", @"file:save-session", @"s", OPT_CMD, delegate)];
    [fileSaveSub addItem:makeActionItem(@"Save Session As", @"file:save-session-as", @"s", SHIFT_OPT_CMD, delegate)];
    [fileSaveSub addItem:[NSMenuItem separatorItem]];
    [fileSaveSub addItem:makeActionItem(@"Close Session", @"file:close-session", @"w", SHIFT_CMD, delegate)];

    NSMenu *fileFoldersSub = addSubmenu(fileMenu, @"Folders");
    [fileFoldersSub addItem:makeActionItem(@"Rename Folder", @"file:rename-folder", @"", 0, delegate)];
    [fileFoldersSub addItem:makeActionItem(@"Folder Color", @"file:set-folder-color", @"", 0, delegate)];
    [fileFoldersSub addItem:makeActionItem(@"Move to Folder", @"file:move-to-folder", @"", 0, delegate)];

    NSMenu *fileFavTrashSub = addSubmenu(fileMenu, @"Favorites & Trash");
    [fileFavTrashSub addItem:makeActionItem(@"Toggle Favorite", @"file:toggle-favorite", @"", 0, delegate)];
    [fileFavTrashSub addItem:[NSMenuItem separatorItem]];
    [fileFavTrashSub addItem:makeActionItem(@"Move to Trash", @"file:soft-delete", @"", 0, delegate)];
    [fileFavTrashSub addItem:makeActionItem(@"Restore from Trash", @"file:restore-deleted", @"", 0, delegate)];
    [fileFavTrashSub addItem:makeActionItem(@"Empty Trash", @"file:erase-deleted", @"", 0, delegate)];

    NSMenu *fileBackupSub = addSubmenu(fileMenu, @"Project Backup");
    [fileBackupSub addItem:makeActionItem(@"Back Up Project", @"file:backup-data", @"", 0, delegate)];
    [fileBackupSub addItem:makeActionItem(@"Restore Backup", @"file:restore-backup", @"", 0, delegate)];

    NSMenu *filePrefsSub = addSubmenu(fileMenu, @"Preferences");
    [filePrefsSub addItem:makeActionItem(@"Import Preferences", @"file:import-preferences", @"", 0, delegate)];
    [filePrefsSub addItem:makeActionItem(@"Export Preferences", @"file:export-preferences", @"", 0, delegate)];

    [fileMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *fileImportSub = addSubmenu(fileMenu, @"Import Data");
    NSMenu *fileImpSeqSub = addSubmenu(fileImportSub, @"Sequence Files");
    [fileImpSeqSub addItem:makeActionItem(@"Import Files", @"file:import-files", @"i", CMD, delegate)];
    [fileImpSeqSub addItem:makeActionItem(@"Import Folder", @"file:import-folder", @"", 0, delegate)];
    [fileImpSeqSub addItem:makeActionItem(@"Metadata from Spreadsheet\u2026", @"file:import-metadata", @"", 0, delegate)];
    [fileImpSeqSub addItem:makeActionItem(@"Paste from Clipboard", @"file:import-clipboard", @"i", SHIFT_CMD, delegate)];
    NSMenu *fileImpOtherSub = addSubmenu(fileImportSub, @"Import Other");
    [fileImpOtherSub addItem:makeActionItem(@"Restore Backup", @"file:restore-backup", @"", 0, delegate)];
    [fileImpOtherSub addItem:makeActionItem(@"Sample Documents", @"file:import-samples", @"", 0, delegate)];
    [fileImpOtherSub addItem:makeActionItem(@"MolBioCraft Preferences", @"file:import-preferences", @"", 0, delegate)];
    [fileImpOtherSub addItem:makeActionItem(@"New Database Connection", @"file:import-ncbi-db", @"", 0, delegate)];
    NSMenu *fileImpTracesSub = addSubmenu(fileImportSub, @"Traces & Reads");
    [fileImpTracesSub addItem:makeActionItem(@"Sanger Traces", @"file:import-sanger", @"", 0, delegate)];
    [fileImpTracesSub addItem:makeActionItem(@"NGS Reads & Variants", @"file:import-ngs", @"", 0, delegate)];
    NSMenu *fileImpVecSub = addSubmenu(fileImportSub, @"Vector Catalog");
    [fileImpVecSub addItem:makeActionItem(@"Browse Vector Catalog", @"file:import-vector-catalog", @"", 0, delegate)];
    [fileImpVecSub addItem:makeActionItem(@"Custom Vector QC", @"file:import-twist-vector", @"", 0, delegate)];
    NSMenu *fileImpDbSub = addSubmenu(fileImportSub, @"Databases");
    [fileImpDbSub addItem:makeActionItem(@"NCBI & UniProt", @"file:import-ncbi-db", @"", 0, delegate)];

    NSMenu *fileExportSeqSub = addSubmenu(fileMenu, @"Export Sequences");
    [fileExportSeqSub addItem:makeActionItem(@"Export GenBank", @"file:save-gb", @"s", CMD, delegate)];
    [fileExportSeqSub addItem:makeActionItem(@"Export FASTA", @"file:save-fasta", @"s", SHIFT_CMD, delegate)];
    [fileExportSeqSub addItem:makeActionItem(@"Export EMBL", @"file:export-embl", @"", 0, delegate)];
    [fileExportSeqSub addItem:makeActionItem(@"Export GFF3", @"file:export-gff3", @"", 0, delegate)];

    NSMenu *fileExportBatchSub = addSubmenu(fileMenu, @"Batch & SVG Export");
    [fileExportBatchSub addItem:makeActionItem(@"Batch FASTA", @"file:export-batch-fasta", @"", 0, delegate)];
    [fileExportBatchSub addItem:makeActionItem(@"Export MBC JSON", @"file:export-mbc-json", @"", 0, delegate)];
    [fileExportBatchSub addItem:makeActionItem(@"Export Folder as MBC", @"file:export-folder-mbc", @"", 0, delegate)];
    [fileExportBatchSub addItem:makeActionItem(@"Export Folder", @"file:export-folder-gb", @"", 0, delegate)];
    [fileExportBatchSub addItem:makeActionItem(@"Export Lineage", @"file:export-lineage", @"", 0, delegate)];
    [fileExportBatchSub addItem:makeActionItem(@"Export Consensus", @"file:export-consensus", @"", 0, delegate)];
    [fileExportBatchSub addItem:[NSMenuItem separatorItem]];
    [fileExportBatchSub addItem:makeActionItem(@"Save SVG Map", @"file:save-svg-image", @"", 0, delegate)];

    NSMenu *filePrintSub = addSubmenu(fileMenu, @"Print & PDF");
    [filePrintSub addItem:makeActionItem(@"Print / Export PDF", @"file:print", @"p", CMD, delegate)];
    [fileMenuItem setSubmenu:fileMenu];

    // 3. Edit Menu (retains native responder selectors for text editing + nested sequence sub-menus)
    NSMenuItem *editMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:editMenuItem];
    NSMenu *editMenu = [[NSMenu alloc] initWithTitle:@"Edit"];
    [editMenu addItemWithTitle:@"Undo" action:NSSelectorFromString(@"undo:") keyEquivalent:@"z"];
    NSMenuItem *redoItem = [editMenu addItemWithTitle:@"Redo"
                                               action:NSSelectorFromString(@"redo:")
                                        keyEquivalent:@"z"];
    [redoItem setKeyEquivalentModifierMask:SHIFT_CMD];
    [editMenu addItem:[NSMenuItem separatorItem]];
    [editMenu addItemWithTitle:@"Cut" action:@selector(cut:) keyEquivalent:@"x"];
    [editMenu addItemWithTitle:@"Copy" action:@selector(copy:) keyEquivalent:@"c"];
    [editMenu addItemWithTitle:@"Paste" action:@selector(paste:) keyEquivalent:@"v"];
    [editMenu addItemWithTitle:@"Select All" action:@selector(selectAll:) keyEquivalent:@"a"];
    [editMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *editSeqSelSub = addSubmenu(editMenu, @"Selection");
    [editSeqSelSub addItem:makeActionItem(@"Copy Region", @"edit:copy-sequence", @"c", SHIFT_CMD, delegate)];
    [editSeqSelSub addItem:makeActionItem(@"Select Full Sequence", @"edit:select-all-sequence", @"a", SHIFT_CMD, delegate)];

    NSMenu *editFindSub = addSubmenu(editMenu, @"Find & Navigate");
    [editFindSub addItem:makeActionItem(@"Find in Sequence", @"edit:find-in-doc", @"f", CMD, delegate)];
    [editFindSub addItem:makeActionItem(@"Next Feature", @"edit:next-feature", @"g", CMD, delegate)];
    [editFindSub addItem:makeActionItem(@"Find Duplicates\u2026", @"edit:find-duplicates", @"", 0, delegate)];
    [editFindSub addItem:makeActionItem(@"Batch Rename\u2026", @"edit:batch-rename", @"", 0, delegate)];
    [editMenuItem setSubmenu:editMenu];

    // 4. View Menu
    NSMenuItem *viewMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:viewMenuItem];
    NSMenu *viewMenu = [[NSMenu alloc] initWithTitle:@"View"];

    NSMenu *viewNavSub = addSubmenu(viewMenu, @"History");
    [viewNavSub addItem:makeActionItem(@"Back", @"view:back", @"[", CMD, delegate)];
    [viewNavSub addItem:makeActionItem(@"Forward", @"view:forward", @"]", CMD, delegate)];

    NSMenu *viewSearchSub = addSubmenu(viewMenu, @"Search & Filter");
    [viewSearchSub addItem:makeActionItem(@"Filter Folder", @"view:filter-folder", @"f", OPT_CMD, delegate)];
    [viewSearchSub addItem:makeActionItem(@"Search Tools & Files", @"view:search-tools", @"f", SHIFT_CMD, delegate)];

    NSMenu *viewPanelsSub = addSubmenu(viewMenu, @"Panels");
    [viewPanelsSub addItem:makeActionItem(@"Toggle Sidebar", @"view:toggle-sidebar", @"s", CTRL_CMD, delegate)];
    [viewPanelsSub addItem:makeActionItem(@"Toggle File Table", @"view:toggle-doctable", @"", 0, delegate)];
    [viewPanelsSub addItem:makeActionItem(@"Toggle Inspector", @"view:toggle-inspector", @"i", OPT_CMD, delegate)];

    NSMenu *viewSplitExpandSub = addSubmenu(viewMenu, @"Split & Expand");
    [viewSplitExpandSub addItem:makeActionItem(@"Split Top / Bottom", @"view:split-top-bottom", @"", 0, delegate)];
    [viewSplitExpandSub addItem:makeActionItem(@"Split Left / Right", @"view:split-left-right", @"", 0, delegate)];
    [viewSplitExpandSub addItem:[NSMenuItem separatorItem]];
    [viewSplitExpandSub addItem:makeActionItem(@"Expand Document View", @"view:expand-doc-view", @"o", SHIFT_CMD, delegate)];

    NSMenu *viewColsSub = addSubmenu(viewMenu, @"Table Columns");
    [viewColsSub addItem:makeActionItem(@"Cloning Preset", @"view:col-preset-cloning", @"", 0, delegate)];
    [viewColsSub addItem:makeActionItem(@"Alignment Preset", @"view:col-preset-align", @"", 0, delegate)];
    [viewColsSub addItem:makeActionItem(@"Genomics Preset", @"view:col-preset-genomics", @"", 0, delegate)];
    [viewColsSub addItem:makeActionItem(@"Show All Columns", @"view:col-preset-all", @"", 0, delegate)];
    [viewColsSub addItem:[NSMenuItem separatorItem]];
    [viewColsSub addItem:makeActionItem(@"Lock Column Order", @"view:col-lock", @"", 0, delegate)];

    [viewMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *viewLayoutSub = addSubmenu(viewMenu, @"Map Layout");
    [viewLayoutSub addItem:makeActionItem(@"Split Map & Linear", @"view:layout-split", @"1", CMD, delegate)];
    [viewLayoutSub addItem:makeActionItem(@"Circular Map", @"view:layout-circular", @"2", CMD, delegate)];
    [viewLayoutSub addItem:makeActionItem(@"Linear Sequence", @"view:layout-linear", @"4", CMD, delegate)];

    NSMenu *viewSpecSub = addSubmenu(viewMenu, @"Studio Views");
    [viewSpecSub addItem:makeActionItem(@"Enzymes View", @"view:enzymes", @"3", CMD, delegate)];
    [viewSpecSub addItem:makeActionItem(@"Annotations Table", @"view:annotations", @"5", CMD, delegate)];
    [viewSpecSub addItem:makeActionItem(@"Flatfile View", @"view:text", @"6", CMD, delegate)];
    [viewSpecSub addItem:makeActionItem(@"Secondary Structure", @"view:secondary-structure", @"7", CMD, delegate)];
    [viewSpecSub addItem:makeActionItem(@"History & Lineage", @"view:lineage", @"8", CMD, delegate)];

    [viewMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *viewZoomSub = addSubmenu(viewMenu, @"Zoom");
    [viewZoomSub addItem:makeActionItem(@"Zoom In", @"view:zoom-in", @"=", CMD, delegate)];
    [viewZoomSub addItem:makeActionItem(@"Zoom Out", @"view:zoom-out", @"-", CMD, delegate)];
    [viewZoomSub addItem:makeActionItem(@"Actual Size (100%)", @"view:zoom-reset", @"0", CMD, delegate)];
    [viewZoomSub addItem:[NSMenuItem separatorItem]];
    [viewZoomSub addItem:makeActionItem(@"Set Origin", @"view:set-origin", @"0", SHIFT_CMD, delegate)];
    [viewMenuItem setSubmenu:viewMenu];

    // Enzymes Submenu (condensed under Cloning)
    NSMenuItem *enzymesMenuItem = [[NSMenuItem alloc] initWithTitle:@"Enzymes" action:nil keyEquivalent:@""];
    NSMenu *enzymesMenu = [[NSMenu alloc] initWithTitle:@"Enzymes"];

    NSMenu *enzSelectSub = addSubmenu(enzymesMenu, @"Enzyme Views");
    [enzSelectSub addItem:makeActionItem(@"Choose Enzymes", @"enzymes:choose", @"e", CMD, delegate)];
    [enzSelectSub addItem:makeActionItem(@"Digest into Fragments\u2026", @"enzymes:digest-dialog", @"", 0, delegate)];
    [enzSelectSub addItem:makeActionItem(@"Enzymes Table", @"enzymes:table", @"3", CMD, delegate)];

    NSMenu *enzScreenSub = addSubmenu(enzymesMenu, @"Site Screening");
    [enzScreenSub addItem:makeActionItem(@"Non-Cutters", @"enzymes:noncutters", @"", 0, delegate)];
    [enzScreenSub addItem:makeActionItem(@"Silent Mutations", @"enzymes:silent-mutations", @"", 0, delegate)];

    NSMenu *enzSuppSub = addSubmenu(enzymesMenu, @"Methylation");
    [enzSuppSub addItem:makeActionItem(@"Suppliers & Methylation", @"enzymes:suppliers", @"", 0, delegate)];
    [enzSuppSub addItem:makeActionItem(@"Gel Preferences", @"prefs:gels", @"", 0, delegate)];
    [enzymesMenuItem setSubmenu:enzymesMenu];

    // Features Submenu (condensed under Sequence)
    NSMenuItem *featuresMenuItem = [[NSMenuItem alloc] initWithTitle:@"Features" action:nil keyEquivalent:@""];
    NSMenu *featuresMenu = [[NSMenu alloc] initWithTitle:@"Features"];

    NSMenu *featAnnotSub = addSubmenu(featuresMenu, @"Add & Detect");
    [featAnnotSub addItem:makeActionItem(@"Add Feature", @"features:add", @"t", CMD, delegate)];
    [featAnnotSub addItem:makeActionItem(@"Detect Common Features", @"features:detect-common", @"", 0, delegate)];
    [featAnnotSub addItem:makeActionItem(@"Add Tag / Protease", @"features:add-protease", @"", 0, delegate)];

    NSMenu *featLibSub = addSubmenu(featuresMenu, @"Feature Library");
    [featLibSub addItem:makeActionItem(@"Manage Library", @"features:manage-library", @"", 0, delegate)];
    [featLibSub addItem:makeActionItem(@"Transfer Features", @"annotate:transfer", @"", 0, delegate)];
    [featLibSub addItem:makeActionItem(@"Extract Features", @"tools:extract-annotations", @"", 0, delegate)];
    [featuresMenuItem setSubmenu:featuresMenu];

    // Primers Submenu (condensed under Cloning)
    NSMenuItem *primersMenuItem = [[NSMenuItem alloc] initWithTitle:@"Primers" action:nil keyEquivalent:@""];
    NSMenu *primersMenu = [[NSMenu alloc] initWithTitle:@"Primers"];

    NSMenu *prmDesignSub = addSubmenu(primersMenu, @"Design Primers");
    [prmDesignSub addItem:makeActionItem(@"Add Primer", @"primers:add", @"", 0, delegate)];
    [prmDesignSub addItem:makeActionItem(@"Import Primers from Spreadsheet\u2026", @"primers:add-list", @"", 0, delegate)];
    [prmDesignSub addItem:makeActionItem(@"Design Primers\u2026", @"primers:design-dialog", @"", 0, delegate)];
    [prmDesignSub addItem:makeActionItem(@"Design Degenerate Primers\u2026", @"primers:degenerate-dialog", @"", 0, delegate)];
    [prmDesignSub addItem:makeActionItem(@"Test with Saved Primers\u2026", @"primers:test-saved-dialog", @"", 0, delegate)];
    [prmDesignSub addItem:makeActionItem(@"Design Primer Pair", @"primers:design", @"", 0, delegate)];
    [prmDesignSub addItem:makeActionItem(@"Selection to Oligo", @"primers:convert-to-oligo", @"", 0, delegate)];

    NSMenu *prmHybSub = addSubmenu(primersMenu, @"Specificity");
    [prmHybSub addItem:makeActionItem(@"Map Saved Primers", @"primers:import-saved", @"", 0, delegate)];
    [prmHybSub addItem:makeActionItem(@"Off-Target Check", @"primers:specificity", @"", 0, delegate)];
    [prmHybSub addItem:makeActionItem(@"Export Primers", @"primers:export", @"", 0, delegate)];

    NSMenu *prmPcrMutSub = addSubmenu(primersMenu, @"PCR & Mutagenesis");
    [prmPcrMutSub addItem:makeActionItem(@"In-Silico PCR", @"primers:pcr", @"", 0, delegate)];
    [prmPcrMutSub addItem:makeActionItem(@"Overlap PCR", @"actions:soe-pcr", @"", 0, delegate)];
    [prmPcrMutSub addItem:makeActionItem(@"Site Mutagenesis", @"primers:mutagenesis", @"", 0, delegate)];

    NSMenu *prmCrisprSub = addSubmenu(primersMenu, @"CRISPR Guides");
    [prmCrisprSub addItem:makeActionItem(@"Find CRISPR Sites", @"primers:crispr", @"", 0, delegate)];
    [prmCrisprSub addItem:makeActionItem(@"CRISPR Editing Analysis\u2026", @"primers:crispr-editing-dialog", @"", 0, delegate)];

    [primersMenu addItem:[NSMenuItem separatorItem]];
    NSMenu *prmPrefsSub = addSubmenu(primersMenu, @"Primer Settings");
    [prmPrefsSub addItem:makeActionItem(@"Primer Preferences", @"primers:preferences", @"", 0, delegate)];
    [primersMenuItem setSubmenu:primersMenu];

    // Alignment Submenu (condensed under Tools)
    NSMenuItem *alignmentMenuItem = [[NSMenuItem alloc] initWithTitle:@"Alignment" action:nil keyEquivalent:@""];
    NSMenu *alignmentMenu = [[NSMenu alloc] initWithTitle:@"Alignment"];

    [alignmentMenu addItem:makeActionItem(@"Multiple Alignment\u2026", @"align:msa-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Pairwise Alignment\u2026", @"align:pairwise-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Align Structures\u2026", @"align:structures-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Read QC Report\u2026", @"align:qc-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Merge Paired Reads\u2026", @"align:merge-pairs-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Trim Ends\u2026", @"align:trim-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"De Novo Assemble\u2026", @"align:denovo-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Map to Reference\u2026", @"align:map-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Calculate Expression Levels\u2026", @"align:expression-levels-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Find Structural Variants\u2026", @"align:structural-variants-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Translation Alignment\u2026", @"align:translation-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Highlight Sites\u2026", @"align:highlight-sites-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Add Sequences to Alignment\u2026", @"align:add-to-alignment-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Mask Alignment\u2026", @"align:mask-dialog", @"", 0, delegate)];
    [alignmentMenu addItem:makeActionItem(@"Generate Consensus\u2026", @"align:consensus-dialog", @"", 0, delegate)];
    NSMenu *alnMsaSub = addSubmenu(alignmentMenu, @"Multiple Alignment");
    [alnMsaSub addItem:makeActionItem(@"MAFFT Alignment", @"align:msa-mafft", @"a", OPT_CMD, delegate)];
    [alnMsaSub addItem:makeActionItem(@"Clustal Omega", @"align:msa-clustalo", @"", 0, delegate)];
    [alnMsaSub addItem:makeActionItem(@"MUSCLE Alignment", @"align:msa-muscle", @"", 0, delegate)];

    NSMenu *alnPairwiseSub = addSubmenu(alignmentMenu, @"Pairwise & Dotplot");
    [alnPairwiseSub addItem:makeActionItem(@"Global Pairwise (NW)", @"align:pairwise-nw", @"", 0, delegate)];
    [alnPairwiseSub addItem:makeActionItem(@"Local Pairwise (SW)", @"align:pairwise-sw", @"", 0, delegate)];
    [alnPairwiseSub addItem:makeActionItem(@"K-mer Dotplot", @"align:dotplot", @"", 0, delegate)];

    NSMenu *alnReadsSub = addSubmenu(alignmentMenu, @"Read Mapping & Contigs");
    [alnReadsSub addItem:makeActionItem(@"Map to Reference", @"align:map-reference", @"", 0, delegate)];
    [alnReadsSub addItem:makeActionItem(@"De Novo Assembly", @"align:denovo-assemble", @"", 0, delegate)];
    [alnReadsSub addItem:makeActionItem(@"Sanger Contigs", @"align:sanger-contig", @"", 0, delegate)];

    NSMenu *alnGenomeSub = addSubmenu(alignmentMenu, @"Genome Alignment");
    [alnGenomeSub addItem:makeActionItem(@"Whole-Genome Synteny", @"align:whole-genome", @"", 0, delegate)];

    [alignmentMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *alnOpsSub = addSubmenu(alignmentMenu, @"Consensus & Batch");
    [alnOpsSub addItem:makeActionItem(@"Generate Consensus", @"tools:generate-consensus", @"", 0, delegate)];
    [alnOpsSub addItem:makeActionItem(@"Concatenate Sequences", @"tools:concatenate", @"", 0, delegate)];
    [alnOpsSub addItem:makeActionItem(@"Mask Homopolymers", @"tools:mask-low-complexity", @"", 0, delegate)];
    [alnOpsSub addItem:makeActionItem(@"Export Consensus", @"file:export-consensus", @"", 0, delegate)];
    [alignmentMenuItem setSubmenu:alignmentMenu];

    // Phylogenetics Submenu (condensed under Tools)
    NSMenuItem *phyloMenuItem = [[NSMenuItem alloc] initWithTitle:@"Phylogenetics" action:nil keyEquivalent:@""];
    NSMenu *phyloMenu = [[NSMenu alloc] initWithTitle:@"Phylogenetics"];

    [phyloMenu addItem:makeActionItem(@"Build Tree\u2026", @"phylo:build-tree", @"", 0, delegate)];
    [phyloMenu addItem:makeActionItem(@"Compute Distances\u2026", @"phylo:compute-distances-dialog", @"", 0, delegate)];
    [phyloMenu addItem:makeActionItem(@"Consensus Tree\u2026", @"phylo:consensus-tree", @"", 0, delegate)];
    [phyloMenu addItem:makeActionItem(@"Condense Tree\u2026", @"phylo:condense-tree", @"", 0, delegate)];
    [phyloMenu addItem:makeActionItem(@"Compute Timetree\u2026", @"phylo:timetree", @"", 0, delegate)];
    [phyloMenu addItem:makeActionItem(@"Gene Duplication Inference\u2026", @"phylo:gene-duplications", @"", 0, delegate)];
    NSMenu *phyloTreeSub = addSubmenu(phyloMenu, @"Tree Reconstruction");
    [phyloTreeSub addItem:makeActionItem(@"Maximum Likelihood (ML)", @"phylo:tree-ml", @"t", OPT_CMD, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"FastTree ML", @"phylo:tree-fasttree", @"", 0, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"PhyML (SH-aLRT)", @"phylo:tree-phyml", @"", 0, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"RAxML (GTR+G)", @"phylo:tree-raxml", @"", 0, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"MrBayes MCMC", @"phylo:tree-mrbayes", @"", 0, delegate)];
    [phyloTreeSub addItem:[NSMenuItem separatorItem]];
    [phyloTreeSub addItem:makeActionItem(@"Neighbor-Joining (NJ)", @"phylo:tree-nj", @"", 0, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"Minimum Evolution (ME)", @"phylo:tree-me", @"", 0, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"UPGMA Tree", @"phylo:tree-upgma", @"", 0, delegate)];
    [phyloTreeSub addItem:makeActionItem(@"Maximum Parsimony (MP)", @"phylo:tree-mp", @"", 0, delegate)];

    NSMenu *phyloUserAncSub = addSubmenu(phyloMenu, @"Ancestral States");
    [phyloUserAncSub addItem:makeActionItem(@"User Tree Analysis", @"phylo:usertree", @"", 0, delegate)];
    [phyloUserAncSub addItem:makeActionItem(@"Ancestral ML", @"phylo:ancestors-ml", @"", 0, delegate)];
    [phyloUserAncSub addItem:makeActionItem(@"Ancestral Parsimony", @"phylo:ancestors-mp", @"", 0, delegate)];

    NSMenu *phyloModelsSub = addSubmenu(phyloMenu, @"Substitution Models");
    [phyloModelsSub addItem:makeActionItem(@"Best Model Fit", @"phylo:models-best", @"", 0, delegate)];
    [phyloModelsSub addItem:makeActionItem(@"Rate Matrix", @"phylo:models-matrix", @"", 0, delegate)];
    [phyloModelsSub addItem:makeActionItem(@"Homogeneity Test", @"phylo:models-disparity", @"", 0, delegate)];

    NSMenu *phyloCodonSub = addSubmenu(phyloMenu, @"Codon Usage & Data");
    [phyloCodonSub addItem:makeActionItem(@"Alignment Data", @"phylo:data", @"", 0, delegate)];
    [phyloCodonSub addItem:makeActionItem(@"Base Composition", @"phylo:models-composition", @"", 0, delegate)];
    [phyloCodonSub addItem:makeActionItem(@"Codon Usage (RSCU)", @"phylo:models-rscu", @"", 0, delegate)];

    NSMenu *phyloDistDivSub = addSubmenu(phyloMenu, @"Distances & Diversity");
    [phyloDistDivSub addItem:makeActionItem(@"Pairwise Distances", @"phylo:distance", @"", 0, delegate)];
    [phyloDistDivSub addItem:makeActionItem(@"Population Diversity", @"phylo:diversity", @"", 0, delegate)];

    NSMenu *phyloSelSub = addSubmenu(phyloMenu, @"Selection & Rates");
    [phyloSelSub addItem:makeActionItem(@"Codon Selection (dN/dS)", @"phylo:selection", @"", 0, delegate)];
    [phyloSelSub addItem:makeActionItem(@"Site Gamma Rates", @"phylo:rates", @"", 0, delegate)];

    NSMenu *phyloClockSub = addSubmenu(phyloMenu, @"Clocks & Variants");
    [phyloClockSub addItem:makeActionItem(@"Molecular Clock", @"phylo:clocks", @"", 0, delegate)];
    [phyloClockSub addItem:makeActionItem(@"Variant Impact", @"phylo:diagnose", @"", 0, delegate)];
    [phyloMenuItem setSubmenu:phyloMenu];

    // 6. Cloning Menu (condenses Cloning Actions, Enzymes, and Primers)
    NSMenuItem *actionsMenuItem = [[NSMenuItem alloc] init];
    NSMenu *actionsMenu = [[NSMenu alloc] initWithTitle:@"Cloning"];

    [actionsMenu addItem:makeActionItem(@"Clone Insert into Vector\u2026", @"actions:clone-dialog", @"", 0, delegate)];
    [actionsMenu addItem:makeActionItem(@"Validate Clone\u2026", @"actions:validate-clone-dialog", @"", 0, delegate)];

    NSMenu *actRestSub = addSubmenu(actionsMenu, @"Restriction Cloning");
    [actRestSub addItem:makeActionItem(@"Find Sites", @"enzymes:find-sites", @"", 0, delegate)];
    [actRestSub addItem:makeActionItem(@"Digest into Fragments\u2026", @"enzymes:digest-dialog", @"", 0, delegate)];
    [actRestSub addItem:makeActionItem(@"Agarose Digest", @"tools:agarose-gel", @"", 0, delegate)];
    [actRestSub addItem:makeActionItem(@"Ligate Fragments", @"actions:ligate-fragments", @"", 0, delegate)];
    [actRestSub addItem:makeActionItem(@"Restriction Ligation", @"actions:restriction-cloning", @"", 0, delegate)];
    [actRestSub addItem:makeActionItem(@"Anneal Oligos", @"actions:anneal-oligos", @"", 0, delegate)];
    [actRestSub addItem:makeActionItem(@"Non-Cutters", @"enzymes:noncutters", @"", 0, delegate)];

    NSMenu *actPcrSub = addSubmenu(actionsMenu, @"PCR Cloning");
    [actPcrSub addItem:makeActionItem(@"PCR Amplification", @"actions:pcr", @"d", CMD, delegate)];
    [actPcrSub addItem:makeActionItem(@"Overlap PCR", @"actions:soe-pcr", @"", 0, delegate)];

    NSMenu *actMutSub = addSubmenu(actionsMenu, @"Mutagenesis");
    [actMutSub addItem:makeActionItem(@"Site Mutagenesis", @"actions:mutagenesis", @"j", CMD, delegate)];
    [actMutSub addItem:makeActionItem(@"Point Mutation", @"sequence:mutate-shuffle", @"", 0, delegate)];

    NSMenu *actSeamlessSub = addSubmenu(actionsMenu, @"Seamless Assembly");
    [actSeamlessSub addItem:makeActionItem(@"Gibson Assembly", @"actions:gibson", @"", 0, delegate)];
    [actSeamlessSub addItem:makeActionItem(@"Golden Gate", @"actions:golden-gate", @"", 0, delegate)];
    [actSeamlessSub addItem:makeActionItem(@"NEBuilder HiFi", @"actions:hifi", @"", 0, delegate)];
    [actSeamlessSub addItem:makeActionItem(@"In-Fusion", @"actions:in-fusion", @"", 0, delegate)];
    [actSeamlessSub addItem:makeActionItem(@"Parts Cloning", @"actions:parts-cloning", @"", 0, delegate)];

    [actionsMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *actGatewaySub = addSubmenu(actionsMenu, @"Gateway Cloning");
    [actGatewaySub addItem:makeActionItem(@"BP / LR Cloning", @"actions:gateway", @"", 0, delegate)];
    [actGatewaySub addItem:makeActionItem(@"Annotate att Sites", @"actions:annotate-att", @"", 0, delegate)];
    [actGatewaySub addItem:makeActionItem(@"Add attB Sites", @"actions:add-attb", @"", 0, delegate)];
    [actGatewaySub addItem:[NSMenuItem separatorItem]];
    NSMenu *gwDonorSub = addSubmenu(actGatewaySub, @"Donor Vectors");
    [gwDonorSub addItem:makeActionItem(@"pDONR221", @"action-vec:gw-pdonr221", @"", 0, delegate)];
    [gwDonorSub addItem:makeActionItem(@"pDONR201", @"action-vec:gw-pdonr201", @"", 0, delegate)];
    [gwDonorSub addItem:makeActionItem(@"pDONR207", @"action-vec:gw-pdonr207", @"", 0, delegate)];
    [gwDonorSub addItem:makeActionItem(@"pDONR/Zeo", @"action-vec:gw-pdonr-zeo", @"", 0, delegate)];
    [gwDonorSub addItem:makeActionItem(@"pDONR221 P1-P4", @"action-vec:gw-pdonr221-p1p4", @"", 0, delegate)];
    [gwDonorSub addItem:makeActionItem(@"pDONR221 P4r-P3r", @"action-vec:gw-pdonr221-p4rp3r", @"", 0, delegate)];
    [gwDonorSub addItem:makeActionItem(@"pDONR221 P3-P2", @"action-vec:gw-pdonr221-p3p2", @"", 0, delegate)];
    NSMenu *gwDestSub = addSubmenu(actGatewaySub, @"Destination Vectors");
    [gwDestSub addItem:makeActionItem(@"pDEST14", @"action-vec:gw-pdest14", @"", 0, delegate)];
    [gwDestSub addItem:makeActionItem(@"pDEST15", @"action-vec:gw-pdest15", @"", 0, delegate)];
    [gwDestSub addItem:makeActionItem(@"pDEST17", @"action-vec:gw-pdest17", @"", 0, delegate)];
    [gwDestSub addItem:makeActionItem(@"pcDNA-DEST40", @"action-vec:gw-pcdna-dest40", @"", 0, delegate)];
    [gwDestSub addItem:makeActionItem(@"pLenti6/V5-DEST", @"action-vec:gw-plenti6-v5-dest", @"", 0, delegate)];
    [gwDestSub addItem:makeActionItem(@"pBAD-DEST49", @"action-vec:gw-pbad-dest49", @"", 0, delegate)];

    NSMenu *actTaGcSub = addSubmenu(actionsMenu, @"TA & GC Cloning");
    [actTaGcSub addItem:makeActionItem(@"TA / GC Cloning", @"actions:ta-gc", @"", 0, delegate)];
    [actTaGcSub addItem:[NSMenuItem separatorItem]];
    NSMenu *taVecSub = addSubmenu(actTaGcSub, @"TA Vectors");
    [taVecSub addItem:makeActionItem(@"pGEM-T Easy", @"action-vec:ta-pgem-t-easy", @"", 0, delegate)];
    [taVecSub addItem:makeActionItem(@"pGEM-T", @"action-vec:ta-pgem-t", @"", 0, delegate)];
    [taVecSub addItem:makeActionItem(@"pCR2.1", @"action-vec:ta-pcr21", @"", 0, delegate)];
    [taVecSub addItem:makeActionItem(@"pCR4-TA", @"action-vec:ta-pcr4", @"", 0, delegate)];
    [taVecSub addItem:makeActionItem(@"pTZ57R/T", @"action-vec:ta-ptz57r-t", @"", 0, delegate)];
    NSMenu *gcVecSub = addSubmenu(actTaGcSub, @"GC Vectors");
    [gcVecSub addItem:makeActionItem(@"pGC Blue", @"action-vec:gc-pgc-blue", @"", 0, delegate)];
    [gcVecSub addItem:makeActionItem(@"pSMART GC HK", @"action-vec:gc-psmart-gc-hk", @"", 0, delegate)];
    [gcVecSub addItem:makeActionItem(@"pSMART GC LK", @"action-vec:gc-psmart-gc-lk", @"", 0, delegate)];

    NSMenu *actTopoSub = addSubmenu(actionsMenu, @"TOPO Cloning");
    [actTopoSub addItem:makeActionItem(@"TOPO Cloning", @"actions:topo", @"", 0, delegate)];
    [actTopoSub addItem:[NSMenuItem separatorItem]];
    NSMenu *topoTaSub = addSubmenu(actTopoSub, @"TOPO TA Vectors");
    [topoTaSub addItem:makeActionItem(@"pCR2.1-TOPO", @"action-vec:topo-pcr21-topo", @"", 0, delegate)];
    [topoTaSub addItem:makeActionItem(@"pCR4-TOPO", @"action-vec:topo-pcr4-topo", @"", 0, delegate)];
    [topoTaSub addItem:makeActionItem(@"pcDNA3.1/V5-His-TOPO", @"action-vec:topo-pcdna31-v5-his-topo", @"", 0, delegate)];
    NSMenu *topoBluntSub = addSubmenu(actTopoSub, @"Blunt TOPO Vectors");
    [topoBluntSub addItem:makeActionItem(@"pCR-Blunt II-TOPO", @"action-vec:topo-pcr-blunt-ii", @"", 0, delegate)];
    [topoBluntSub addItem:makeActionItem(@"pCR4Blunt-TOPO", @"action-vec:topo-pcr4blunt", @"", 0, delegate)];
    NSMenu *topoDirSub = addSubmenu(actTopoSub, @"D-TOPO Vectors");
    [topoDirSub addItem:makeActionItem(@"pENTR/D-TOPO", @"action-vec:topo-pentr-d-topo", @"", 0, delegate)];
    [topoDirSub addItem:makeActionItem(@"pET100/D-TOPO", @"action-vec:topo-pet100-d-topo", @"", 0, delegate)];
    [topoDirSub addItem:makeActionItem(@"pET151/D-TOPO", @"action-vec:topo-pet151-d-topo", @"", 0, delegate)];
    [topoDirSub addItem:makeActionItem(@"pcDNA3.1D/V5-His-TOPO", @"action-vec:topo-pcdna31d-v5-his-topo", @"", 0, delegate)];
    [actionsMenu addItem:[NSMenuItem separatorItem]];
    [actionsMenu addItem:enzymesMenuItem];
    [actionsMenu addItem:primersMenuItem];
    [actionsMenuItem setSubmenu:actionsMenu];

    // 7. Tools Menu (condenses Alignment, Phylogenetics, and Bioinformatics Tools)
    NSMenuItem *toolsMenuItem = [[NSMenuItem alloc] init];
    NSMenu *toolsMenu = [[NSMenu alloc] initWithTitle:@"Tools"];
    [toolsMenu addItem:alignmentMenuItem];
    [toolsMenu addItem:phyloMenuItem];
    [toolsMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *toolsGelSub = addSubmenu(toolsMenu, @"Gel & Calculators");
    [toolsGelSub addItem:makeActionItem(@"Agarose Gel", @"tools:agarose-gel", @"g", SHIFT_CMD, delegate)];
    [toolsGelSub addItem:makeActionItem(@"DNA Calculations", @"tools:dna-calc", @"m", SHIFT_CMD, delegate)];

    NSMenu *toolsBlastVecSub = addSubmenu(toolsMenu, @"BLAST & Vectors");
    [toolsBlastVecSub addItem:makeActionItem(@"BLAST Search", @"tools:blast", @"b", SHIFT_CMD, delegate)];
    [toolsBlastVecSub addItem:makeActionItem(@"Vector Catalog", @"tools:vectors", @"", 0, delegate)];
    [toolsBlastVecSub addItem:makeActionItem(@"Vector Architect", @"tools:vectors-architect", @"", 0, delegate)];
    [toolsBlastVecSub addItem:makeActionItem(@"Primers & CRISPR", @"tools:primers", @"", 0, delegate)];

    NSMenu *toolsDbsSub = addSubmenu(toolsMenu, @"Databases");
    [toolsDbsSub addItem:makeActionItem(@"NCBI & UniProt", @"tools:databases-explorer", @"", 0, delegate)];
    [toolsDbsSub addItem:makeActionItem(@"Make BLAST Database from Selection\u2026", @"tools:make-blast-db", @"", 0, delegate)];
    [toolsDbsSub addItem:makeActionItem(@"Local BLAST DBs", @"tools:local-blast-dbs", @"", 0, delegate)];
    [toolsDbsSub addItem:makeActionItem(@"BLAST Setup", @"tools:blast-setup", @"", 0, delegate)];

    NSMenu *toolsBatchSub = addSubmenu(toolsMenu, @"Batch Operations");
    [toolsBatchSub addItem:makeActionItem(@"Extract Features", @"tools:extract-annotations", @"", 0, delegate)];
    [toolsBatchSub addItem:makeActionItem(@"Mask Selection", @"tools:mask-selection", @"", 0, delegate)];
    [toolsBatchSub addItem:makeActionItem(@"Mask Homopolymers", @"tools:mask-low-complexity", @"", 0, delegate)];
    [toolsBatchSub addItem:makeActionItem(@"Concatenate", @"tools:concatenate", @"", 0, delegate)];
    [toolsBatchSub addItem:makeActionItem(@"Generate Consensus", @"tools:generate-consensus", @"", 0, delegate)];

    NSMenu *toolsSeqNgsSub = addSubmenu(toolsMenu, @"Sequencing & NGS");
    [toolsSeqNgsSub addItem:makeActionItem(@"Sanger Studio", @"tools:sanger", @"", 0, delegate)];
    [toolsSeqNgsSub addItem:makeActionItem(@"NGS Assembly", @"tools:ngs-suite", @"", 0, delegate)];
    [toolsSeqNgsSub addItem:makeActionItem(@"Genome Variants", @"tools:genome-variants", @"", 0, delegate)];
    [toolsSeqNgsSub addItem:makeActionItem(@"GenBank Submission", @"tools:genbank-submit", @"", 0, delegate)];

    [toolsMenu addItem:[NSMenuItem separatorItem]];

    NSMenu *toolsPipelinesSub = addSubmenu(toolsMenu, @"Pipelines");
    [toolsPipelinesSub addItem:makeActionItem(@"Guided Pipelines", @"tools:pipelines", @"y", SHIFT_CMD, delegate)];
    [toolsPipelinesSub addItem:makeActionItem(@"Lineage Manager", @"tools:workflows", @"", 0, delegate)];

    NSMenu *toolsWfBatchSub = addSubmenu(toolsMenu, @"Batch Workflows");
    [toolsWfBatchSub addItem:makeActionItem(@"Manage Workflows\u2026", @"workflows:manage", @"", 0, delegate)];
    [toolsWfBatchSub addItem:makeActionItem(@"Run Workflow\u2026", @"workflows:run", @"", 0, delegate)];
    [toolsWfBatchSub addItem:makeActionItem(@"Group by Prefix", @"workflows:group-by-name", @"", 0, delegate)];
    [toolsWfBatchSub addItem:makeActionItem(@"Modify Intervals", @"workflows:modify-intervals", @"", 0, delegate)];
    [toolsWfBatchSub addItem:makeActionItem(@"Sample Sequences", @"workflows:random-sample", @"", 0, delegate)];
    [toolsWfBatchSub addItem:makeActionItem(@"Set CDS Translation", @"workflows:set-cds-translation", @"", 0, delegate)];

    NSMenu *toolsPluginsSub = addSubmenu(toolsMenu, @"Bioinformatics Plugins");
    [toolsPluginsSub addItem:makeActionItem(@"Eukaryotic Gene Predictor", @"tools:plugin-euk-gene", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Microbial Gene Predictor", @"tools:plugin-microbial-gene", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"CRISPR Repeat Array Finder", @"tools:plugin-crispr-arrays", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Microsatellite & Tandem Repeats", @"tools:plugin-tandem-repeats", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Haplotype & Allele Partitioner", @"tools:plugin-haplotype-part", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Taxonomic Sequence Classifier", @"tools:plugin-taxonomic-class", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Species Delimitation", @"tools:plugin-species-delim", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Protein Domains & Epitopes", @"tools:plugin-protein-domains", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Transmembrane & Signal Topology", @"tools:plugin-tm-topology", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Adapter & Quality Read Trimmer", @"tools:plugin-adapter-trimmer", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"Whole-Genome Synteny Blocks", @"tools:plugin-synteny-blocks", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"HPC Phylogeny Job Builder", @"tools:plugin-hpc-phylo", @"", 0, delegate)];
    [toolsPluginsSub addItem:makeActionItem(@"External CLI Suite", @"tools:plugin-ext-cli", @"", 0, delegate)];

    NSMenu *toolsSettingsSub = addSubmenu(toolsMenu, @"Settings");
    [toolsSettingsSub addItem:makeActionItem(@"Preferences", @"tools:preferences", @"p", SHIFT_CMD, delegate)];
    [toolsMenuItem setSubmenu:toolsMenu];

    // Annotate Submenu (condensed under Sequence)
    NSMenuItem *annotMenuItem = [[NSMenuItem alloc] initWithTitle:@"Annotate" action:nil keyEquivalent:@""];
    NSMenu *annotMenu = [[NSMenu alloc] initWithTitle:@"Annotate"];

    NSMenu *annotGenesSub = addSubmenu(annotMenu, @"Genes & ORFs");
    [annotGenesSub addItem:makeActionItem(@"Find ORFs\u2026", @"annotate:find-orfs-dialog", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Annotate from Documents\u2026", @"annotate:from-documents-dialog", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Microsatellite Analysis\u2026", @"annotate:microsatellites-dialog", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Compare Expression Levels\u2026", @"annotate:expression-dialog", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Compare Annotations\u2026", @"annotate:compare-dialog", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Show ORFs", @"annotate:find-orfs", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Microbial Genes", @"annotate:glimmer-genes", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"CpG & Repeats", @"annotate:cpg-repeats", @"", 0, delegate)];
    [annotGenesSub addItem:makeActionItem(@"Find Motifs", @"annotate:find-motifs", @"", 0, delegate)];

    NSMenu *annotVarSub = addSubmenu(annotMenu, @"CRISPR & Variants");
    [annotVarSub addItem:makeActionItem(@"Find CRISPR Sites", @"annotate:find-crispr", @"", 0, delegate)];
    [annotVarSub addItem:makeActionItem(@"Call Variants", @"annotate:freebayes-str", @"", 0, delegate)];
    [annotVarSub addItem:makeActionItem(@"16S / ITS Taxonomy", @"annotate:classify-16s", @"", 0, delegate)];

    NSMenu *annotQcSub = addSubmenu(annotMenu, @"Read QC & Transfer");
    [annotQcSub addItem:makeActionItem(@"Trim NGS Reads", @"annotate:bbduk-trim", @"", 0, delegate)];
    [annotQcSub addItem:makeActionItem(@"Transfer Annotations", @"annotate:transfer", @"", 0, delegate)];
    [annotQcSub addItem:makeActionItem(@"Annotate by BLAST\u2026", @"annotate:blast", @"", 0, delegate)];

    NSMenu *annotProtSub = addSubmenu(annotMenu, @"Protein & 3D");
    [annotProtSub addItem:makeActionItem(@"Protein Domains", @"annotate:protein-domains", @"", 0, delegate)];
    [annotProtSub addItem:makeActionItem(@"3D Structure & Coils", @"annotate:coils-tm-pdb", @"", 0, delegate)];
    [annotMenuItem setSubmenu:annotMenu];

    // 5. Sequence Menu (condenses Sequence transformations, Features, and Annotate)
    NSMenuItem *seqMenuItem = [[NSMenuItem alloc] init];
    NSMenu *seqMenu = [[NSMenu alloc] initWithTitle:@"Sequence"];

    NSMenu *seqStrandSub = addSubmenu(seqMenu, @"Strand");
    [seqStrandSub addItem:makeActionItem(@"Reverse Complement", @"sequence:reverse-complement", @"r", SHIFT_CMD, delegate)];
    [seqStrandSub addItem:makeActionItem(@"Complement Only", @"sequence:complement-only", @"", 0, delegate)];
    [seqStrandSub addItem:makeActionItem(@"Reverse Only", @"sequence:reverse-only", @"", 0, delegate)];

    NSMenu *seqTransSub = addSubmenu(seqMenu, @"Translation");
    [seqTransSub addItem:makeActionItem(@"Back-Translate\u2026", @"sequence:back-translate-dialog", @"", 0, delegate)];
    [seqTransSub addItem:makeActionItem(@"Translate Frames", @"sequence:translate", @"", 0, delegate)];
    [seqTransSub addItem:makeActionItem(@"Back Translate", @"sequence:back-translate", @"", 0, delegate)];
    [seqTransSub addItem:makeActionItem(@"Convert DNA / RNA", @"sequence:convert-dna-rna", @"", 0, delegate)];

    NSMenu *seqTopoSub = addSubmenu(seqMenu, @"Topology & Edit");
    [seqTopoSub addItem:makeActionItem(@"Circular Topology", @"sequence:toggle-topology", @"", 0, delegate)];
    [seqTopoSub addItem:makeActionItem(@"Extract Region", @"sequence:extract-region", @"", 0, delegate)];
    [seqTopoSub addItem:makeActionItem(@"Mutate & Shuffle", @"sequence:mutate-shuffle", @"", 0, delegate)];

    NSMenu *seqAsmSub = addSubmenu(seqMenu, @"Read Assembly");
    [seqAsmSub addItem:makeActionItem(@"Merge Reads", @"sequence:contig-assembly", @"", 0, delegate)];
    [seqAsmSub addItem:makeActionItem(@"De Novo Assembly", @"sequence:denovo-assemble", @"", 0, delegate)];

    [seqMenu addItem:[NSMenuItem separatorItem]];
    [seqMenu addItem:featuresMenuItem];
    [seqMenu addItem:annotMenuItem];
    [seqMenuItem setSubmenu:seqMenu];

    [menubar addItem:seqMenuItem];
    [menubar addItem:actionsMenuItem];
    [menubar addItem:toolsMenuItem];

    // 8. Window Menu
    NSMenuItem *windowMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:windowMenuItem];
    NSMenu *windowMenu = [[NSMenu alloc] initWithTitle:@"Window"];
    [windowMenu addItemWithTitle:@"Minimize" action:@selector(performMiniaturize:) keyEquivalent:@"m"];
    [windowMenu addItemWithTitle:@"Zoom" action:@selector(performZoom:) keyEquivalent:@""];
    NSMenuItem *fullScreenItem = [windowMenu addItemWithTitle:@"Toggle Full Screen"
                                                       action:@selector(toggleFullScreen:)
                                                keyEquivalent:@"f"];
    [fullScreenItem setKeyEquivalentModifierMask:CTRL_CMD];
    [windowMenu addItem:[NSMenuItem separatorItem]];
    [windowMenu addItemWithTitle:@"Bring All to Front" action:@selector(arrangeInFront:) keyEquivalent:@""];
    [windowMenuItem setSubmenu:windowMenu];
    [NSApp setWindowsMenu:windowMenu];

    // 9. Help Menu (enables macOS native Spotlight Menu Search across all menus)
    NSMenuItem *helpMenuItem = [[NSMenuItem alloc] init];
    [menubar addItem:helpMenuItem];
    NSMenu *helpMenu = [[NSMenu alloc] initWithTitle:@"Help"];

    NSMenu *helpGuidesSub = addSubmenu(helpMenu, @"Guides");
    [helpGuidesSub addItem:makeActionItem(@"Show Help Panel", @"help:panel", @"", 0, delegate)];
    [helpGuidesSub addItem:makeActionItem(@"Keyboard Shortcuts", @"help:shortcuts", @"", 0, delegate)];
    [helpGuidesSub addItem:makeActionItem(@"Tutorials & Samples", @"help:tutorials", @"", 0, delegate)];
    [helpGuidesSub addItem:makeActionItem(@"Load Example Data\u2026", @"help:examples", @"", 0, delegate)];
    [helpGuidesSub addItem:makeActionItem(@"Vector Guide", @"help:vector-guide", @"", 0, delegate)];

    NSMenu *helpAboutSub = addSubmenu(helpMenu, @"About");
    [helpAboutSub addItem:makeActionItem(@"Check for Updates", @"help:updates", @"", 0, delegate)];
    [helpAboutSub addItem:makeActionItem(@"About MolBioCraft", @"help:about", @"", 0, delegate)];
    [helpMenuItem setSubmenu:helpMenu];
    [NSApp setHelpMenu:helpMenu];
}

@implementation MolBioCraftWebView

- (BOOL)acceptsFirstMouse:(NSEvent *)event {
    return YES;
}

- (NSPoint)screenLocationForMouseEvent:(NSEvent *)event {
    if (self.dragStartedWithPhysicalButton || (([NSEvent pressedMouseButtons] & 1) != 0) || !event || !self.window) {
        return [NSEvent mouseLocation];
    }
    return [self.window convertPointToScreen:[event locationInWindow]];
}

- (void)disarmWindowDrag {
    self.windowDragArmed = NO;
    self.leftMouseDownActive = NO;
    self.dragStartedWithPhysicalButton = NO;
}

- (void)translateArmedWindowToMouseScreenLocation:(NSPoint)curMouseScreen {
    if (!self.windowDragArmed || !self.window) {
        return;
    }
    if (([self.window styleMask] & NSWindowStyleMaskFullScreen) != 0) {
        [self disarmWindowDrag];
        return;
    }
    BOOL buttonStillHeld = self.dragStartedWithPhysicalButton
        ? (([NSEvent pressedMouseButtons] & 1) != 0)
        : self.leftMouseDownActive;
    if (!buttonStillHeld) {
        [self disarmWindowDrag];
        return;
    }

    NSRect curFrame = self.window.frame;
    NSRect proposedFrame = NSMakeRect(
        self.dragStartWindowOrigin.x + (curMouseScreen.x - self.dragStartMouseScreen.x),
        self.dragStartWindowOrigin.y + (curMouseScreen.y - self.dragStartMouseScreen.y),
        curFrame.size.width,
        curFrame.size.height
    );

    NSScreen *targetScreen = nil;
    for (NSScreen *screen in [NSScreen screens]) {
        if (NSPointInRect(curMouseScreen, screen.frame)) {
            targetScreen = screen;
            break;
        }
    }
    if (!targetScreen) {
        targetScreen = self.window.screen ?: [NSScreen mainScreen];
    }
    if (targetScreen) {
        proposedFrame = [self.window constrainFrameRect:proposedFrame toScreen:targetScreen];
    }

    if (!NSEqualPoints(proposedFrame.origin, curFrame.origin)) {
        [self.window setFrameOrigin:proposedFrame.origin];
    }
}

- (void)mouseDown:(NSEvent *)event {
    self.windowDragArmed = NO;
    self.leftMouseDownActive = YES;
    self.dragStartedWithPhysicalButton = (([NSEvent pressedMouseButtons] & 1) != 0);
    self.dragStartMouseScreen = [self screenLocationForMouseEvent:event];
    self.dragStartWindowOrigin = self.window ? self.window.frame.origin : NSZeroPoint;
    self.appDelegate.lastLeftMouseDownEvent = event;
    [super mouseDown:event];
}

- (void)mouseDragged:(NSEvent *)event {
    if (self.windowDragArmed) {
        [self translateArmedWindowToMouseScreenLocation:[self screenLocationForMouseEvent:event]];
        return;
    }
    [super mouseDragged:event];
}

- (void)mouseUp:(NSEvent *)event {
    [self disarmWindowDrag];
    [super mouseUp:event];
}

- (NSArray<NSURL *> *)extractDraggedFileURLs:(id<NSDraggingInfo>)sender {
    NSPasteboard *pboard = [sender draggingPasteboard];
    if (!pboard) return @[];
    NSArray<NSURL *> *urls = [pboard readObjectsForClasses:@[[NSURL class]]
                                                   options:@{NSPasteboardURLReadingFileURLsOnlyKey: @YES}];
    return urls ?: @[];
}

- (NSDragOperation)draggingEntered:(id<NSDraggingInfo>)sender {
    NSArray<NSURL *> *urls = [self extractDraggedFileURLs:sender];
    if (urls.count > 0) {
        [self.appDelegate notifyNativeFileDragActive:YES fileCount:urls.count];
        return NSDragOperationCopy;
    }
    return [super draggingEntered:sender];
}

- (NSDragOperation)draggingUpdated:(id<NSDraggingInfo>)sender {
    NSArray<NSURL *> *urls = [self extractDraggedFileURLs:sender];
    if (urls.count > 0) {
        return NSDragOperationCopy;
    }
    return [super draggingUpdated:sender];
}

- (void)draggingExited:(id<NSDraggingInfo>)sender {
    [self.appDelegate notifyNativeFileDragActive:NO fileCount:0];
    [super draggingExited:sender];
}

- (BOOL)performDragOperation:(id<NSDraggingInfo>)sender {
    NSArray<NSURL *> *urls = [self extractDraggedFileURLs:sender];
    if (urls.count > 0) {
        [self.appDelegate notifyNativeFileDragActive:NO fileCount:0];
        [self.appDelegate deliverLocalFileURLsToWebView:urls];
        return YES;
    }
    return [super performDragOperation:sender];
}

@end

@implementation MolBioCraftAppDelegate

- (instancetype)init {
    self = [super init];
    if (self) {
        _pendingOpenURLs = [[NSMutableArray alloc] init];
        _webViewReady = NO;
        _confirmBeforeQuit = YES;
        _quitApproved = NO;
    }
    return self;
}

- (void)applicationDidFinishLaunching:(NSNotification *)notification {
    NSString *resourcePath = [[NSBundle mainBundle] resourcePath];

    // Create Main Window (Unified titleless full-size content view with inline traffic lights & zero software name)
    NSRect frame = NSMakeRect(0, 0, 1540, 940);
    NSUInteger style = NSWindowStyleMaskTitled |
                       NSWindowStyleMaskClosable |
                       NSWindowStyleMaskMiniaturizable |
                       NSWindowStyleMaskResizable |
                       NSWindowStyleMaskFullSizeContentView;

    self.window = [[NSWindow alloc] initWithContentRect:frame
                                              styleMask:style
                                                backing:NSBackingStoreBuffered
                                                  defer:NO];
    [self.window setTitle:@""];
    [self.window setTitleVisibility:NSWindowTitleHidden];
    [self.window setTitlebarAppearsTransparent:YES];
    [self.window setMinSize:NSMakeSize(1100, 720)];
    [self.window setDelegate:self];
    [self.window center];

    // Configure WKWebView + Native macOS Menu Bridge
    WKWebViewConfiguration *config = [[WKWebViewConfiguration alloc] init];
    WKUserContentController *contentController = [[WKUserContentController alloc] init];
    NSString *bootJs = @"window.__MBC_NATIVE_MACOS_MENUBAR__ = true; window.__MBC_MACOS_APP_BUNDLE__ = true;";
    WKUserScript *bootScript = [[WKUserScript alloc] initWithSource:bootJs
                                                      injectionTime:WKUserScriptInjectionTimeAtDocumentStart
                                                   forMainFrameOnly:YES];
    [contentController addUserScript:bootScript];
    [contentController addScriptMessageHandler:self name:@"mbcNative"];
    config.userContentController = contentController;

    @try {
        [config.preferences setValue:@YES forKey:@"developerExtrasEnabled"];
        [config.preferences setValue:@YES forKey:@"allowFileAccessFromFileURLs"];
    } @catch (NSException *ignored) {
        // Guard against future macOS SDK KVC preference key changes
    }

    self.webView = [[MolBioCraftWebView alloc] initWithFrame:[[self.window contentView] bounds]
                                               configuration:config];
    self.webView.appDelegate = self;
    [self.webView setAutoresizingMask:(NSViewWidthSizable | NSViewHeightSizable)];
    [self.webView setUIDelegate:self];
    [self.webView setNavigationDelegate:self];
    [self.webView registerForDraggedTypes:@[NSPasteboardTypeFileURL]];
    [[self.window contentView] addSubview:self.webView];

    MolBioCraftWebView *capturedWebView = self.webView;
    self.localMouseEventMonitor = [NSEvent addLocalMonitorForEventsMatchingMask:(NSEventMaskLeftMouseDragged | NSEventMaskLeftMouseUp)
                                                                        handler:^NSEvent * _Nullable(NSEvent *ev) {
        if (!capturedWebView) {
            return ev;
        }
        if (ev.type == NSEventTypeLeftMouseUp) {
            [capturedWebView disarmWindowDrag];
            return ev;
        }
        if (ev.type == NSEventTypeLeftMouseDragged && capturedWebView.windowDragArmed) {
            NSPoint curScreen = [capturedWebView screenLocationForMouseEvent:ev];
            [capturedWebView translateArmedWindowToMouseScreenLocation:curScreen];
            return capturedWebView.windowDragArmed ? nil : ev;
        }
        return ev;
    }];

    // Load bundled standalone HTML
    NSString *htmlPath = [resourcePath stringByAppendingPathComponent:@"dist/molbiocraft-standalone.html"];
    if ([[NSFileManager defaultManager] fileExistsAtPath:htmlPath]) {
        NSURL *fileURL = [NSURL fileURLWithPath:htmlPath];
        NSURL *readAccessDir = [NSURL fileURLWithPath:resourcePath isDirectory:YES];
        [self.webView loadFileURL:fileURL allowingReadAccessToURL:readAccessDir];
    } else {
        [self.webView loadHTMLString:@"<h2 style='color:white;font-family:sans-serif'>MolBioCraft bundle missing</h2>" baseURL:nil];
    }

    [self.window makeKeyAndOrderFront:nil];
    if (@available(macOS 14.0, *)) {
        [NSApp activate];
    } else {
#pragma clang diagnostic push
#pragma clang diagnostic ignored "-Wdeprecated-declarations"
        [NSApp activateIgnoringOtherApps:YES];
#pragma clang diagnostic pop
    }
}

- (void)handleNativeMenuAction:(NSMenuItem *)sender {
    NSString *actionId = [sender representedObject];
    if (!actionId || !self.webView) return;

    // Directly handle native file open panels from macOS Menu Bar without WebKit user-gesture restriction
    if ([actionId isEqualToString:@"file:open-session"] || [actionId isEqualToString:@"file:restore-backup"]) {
        [self promptNativeOpenFileWithMode:@"replace"];
        return;
    }
    if ([actionId isEqualToString:@"file:merge-session"]) {
        [self promptNativeOpenFileWithMode:@"merge"];
        return;
    }
    if ([actionId isEqualToString:@"file:import-files"] || [actionId isEqualToString:@"new-session:import-files"]) {
        [self promptNativeOpenFileWithMode:@"import"];
        return;
    }
    if ([actionId isEqualToString:@"file:import-preferences"]) {
        [self promptNativeOpenFileWithMode:@"prefs"];
        return;
    }

    NSString *safeId = escapeJsString(actionId);
    NSString *js = [NSString stringWithFormat:
        @"window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: \"%@\" }));",
        safeId];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (void)promptNativeOpenFileWithMode:(NSString *)mode {
    if (!self.window || !self.webView) return;
    if ([self.window attachedSheet] != nil) return;
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setCanChooseFiles:YES];
    [panel setCanChooseDirectories:NO];
    [panel setAllowsMultipleSelection:[mode isEqualToString:@"import"]];
    void (^deliverResults)(NSModalResponse) = ^(NSModalResponse result) {
        if (result == NSModalResponseOK && [[panel URLs] count] > 0) {
            NSString *safeMode = escapeJsString(mode);
            for (NSURL *url in [panel URLs]) {
                NSData *data = [NSData dataWithContentsOfURL:url];
                if (!data) continue;
                NSString *b64 = [data base64EncodedStringWithOptions:0];
                NSString *safeName = escapeJsString([url lastPathComponent]);
                NSString *js = [NSString stringWithFormat:
                    @"window.dispatchEvent(new CustomEvent('mbc:native-file-open', { detail: { fileName: \"%@\", base64: \"%@\", mode: \"%@\" } }));",
                    safeName, b64, safeMode];
                [self.webView evaluateJavaScript:js completionHandler:nil];
            }
        }
    };
    if ([self.window isVisible]) {
        [panel beginSheetModalForWindow:self.window completionHandler:deliverResults];
    } else {
        deliverResults([panel runModal]);
    }
}

- (void)promptNativeSaveFileNamed:(NSString *)suggestedName content:(NSString *)content base64:(NSString *)base64 {
    if (!self.window) return;
    if ([self.window attachedSheet] != nil) return;
    NSSavePanel *savePanel = [NSSavePanel savePanel];
    [savePanel setCanCreateDirectories:YES];
    [savePanel setNameFieldStringValue:(suggestedName.length > 0 ? suggestedName : @"molbiocraft_export.gb")];
    void (^deliverSave)(NSModalResponse) = ^(NSModalResponse result) {
        if (result == NSModalResponseOK && [savePanel URL] != nil) {
            NSData *payloadData = nil;
            if (base64.length > 0) {
                payloadData = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
            } else {
                payloadData = [(content ?: @"") dataUsingEncoding:NSUTF8StringEncoding];
            }
            NSError *writeErr = nil;
            BOOL ok = payloadData ? [payloadData writeToURL:[savePanel URL] options:NSDataWritingAtomic error:&writeErr] : NO;
            if (ok && self.webView) {
                NSString *savedName = escapeJsString([[savePanel URL] lastPathComponent]);
                NSString *js = [NSString stringWithFormat:
                    @"window.dispatchEvent(new CustomEvent('mbc:native-file-saved', { detail: \"%@\" }));",
                    savedName];
                [self.webView evaluateJavaScript:js completionHandler:nil];
            }
        }
    };
    if ([self.window isVisible]) {
        [savePanel beginSheetModalForWindow:self.window completionHandler:deliverSave];
    } else {
        deliverSave([savePanel runModal]);
    }
}

#pragma mark - WKScriptMessageHandler (JS -> Native macOS Save/Open Bridge)

- (void)userContentController:(WKUserContentController *)userContentController
      didReceiveScriptMessage:(WKScriptMessage *)message {
    if (![message.name isEqualToString:@"mbcNative"]) return;
    if (![message.body isKindOfClass:[NSDictionary class]]) return;

    NSDictionary *payload = (NSDictionary *)message.body;
    NSString *msgType = payload[@"type"];
    if ([msgType isEqualToString:@"saveFile"]) {
        NSString *filename = [payload[@"filename"] isKindOfClass:[NSString class]] ? payload[@"filename"] : @"molbiocraft_export.gb";
        NSString *content = [payload[@"content"] isKindOfClass:[NSString class]] ? payload[@"content"] : @"";
        NSString *base64 = [payload[@"base64"] isKindOfClass:[NSString class]] ? payload[@"base64"] : @"";
        dispatch_async(dispatch_get_main_queue(), ^{
            [self promptNativeSaveFileNamed:filename content:content base64:base64];
        });
    } else if ([msgType isEqualToString:@"openFile"]) {
        NSString *mode = [payload[@"mode"] isKindOfClass:[NSString class]] ? payload[@"mode"] : @"import";
        dispatch_async(dispatch_get_main_queue(), ^{
            [self promptNativeOpenFileWithMode:mode];
        });
    } else if ([msgType isEqualToString:@"windowDrag"]) {
        if (self.window &&
            self.webView &&
            (([self.window styleMask] & NSWindowStyleMaskFullScreen) == 0)) {
            BOOL buttonActive = self.webView.dragStartedWithPhysicalButton
                ? (([NSEvent pressedMouseButtons] & 1) != 0)
                : self.webView.leftMouseDownActive;
            if (buttonActive) {
                self.webView.windowDragArmed = YES;
                NSPoint curScreen = [self.webView screenLocationForMouseEvent:self.lastLeftMouseDownEvent];
                [self.webView translateArmedWindowToMouseScreenLocation:curScreen];
            }
        }
    } else if ([msgType isEqualToString:@"windowZoom"]) {
        if (self.webView) {
            [self.webView disarmWindowDrag];
        }
        if (self.window) {
            [self.window performZoom:nil];
        }
    } else if ([msgType isEqualToString:@"setConfirmBeforeQuit"]) {
        NSNumber *confirmVal = [payload[@"confirm"] isKindOfClass:[NSNumber class]] ? payload[@"confirm"] : @YES;
        self.confirmBeforeQuit = [confirmVal boolValue];
    } else if ([msgType isEqualToString:@"confirmQuitNow"]) {
        self.quitApproved = YES;
        dispatch_async(dispatch_get_main_queue(), ^{
            [NSApp terminate:nil];
        });
    }
}

- (void)notifyNativeFileDragActive:(BOOL)active fileCount:(NSUInteger)count {
    if (!self.webView || !self.webViewReady) return;
    NSString *js = [NSString stringWithFormat:
        @"window.dispatchEvent(new CustomEvent('mbc:native-file-drag', { detail: { active: %@, count: %lu } }));",
        active ? @"true" : @"false",
        (unsigned long)count];
    [self.webView evaluateJavaScript:js completionHandler:nil];
}

- (void)deliverLocalFileURLsToWebView:(NSArray<NSURL *> *)urls {
    if (!urls || urls.count == 0) return;
    if (!self.webView || !self.webViewReady) {
        if (!self.pendingOpenURLs) {
            self.pendingOpenURLs = [[NSMutableArray alloc] init];
        }
        [self.pendingOpenURLs addObjectsFromArray:urls];
        return;
    }

    for (NSURL *url in urls) {
        if (![url isFileURL]) continue;
        NSData *data = [NSData dataWithContentsOfURL:url];
        if (!data) continue;
        NSString *b64 = [data base64EncodedStringWithOptions:0];
        NSString *rawName = [url lastPathComponent] ?: @"dropped_sequence.gb";
        NSString *safeName = escapeJsString(rawName);
        NSString *lowerExt = [[url pathExtension] lowercaseString];
        NSString *mode = ([lowerExt isEqualToString:@"mbc"] || [lowerExt isEqualToString:@"mcb"]) ? @"replace" : @"import";
        NSString *js = [NSString stringWithFormat:
            @"window.dispatchEvent(new CustomEvent('mbc:native-file-open', { detail: { fileName: \"%@\", base64: \"%@\", mode: \"%@\" } }));",
            safeName, b64, mode];
        [self.webView evaluateJavaScript:js completionHandler:nil];
    }
}

- (void)webView:(WKWebView *)webView didFinishNavigation:(WKNavigation *)navigation {
    self.webViewReady = YES;
    if (self.pendingOpenURLs.count > 0) {
        NSArray<NSURL *> *queued = [self.pendingOpenURLs copy];
        [self.pendingOpenURLs removeAllObjects];
        [self deliverLocalFileURLsToWebView:queued];
    }
}

- (void)application:(NSApplication *)application openURLs:(NSArray<NSURL *> *)urls {
    [self deliverLocalFileURLsToWebView:urls];
}

- (BOOL)application:(NSApplication *)sender openFile:(NSString *)filename {
    if (!filename || filename.length == 0) return NO;
    NSURL *url = [NSURL fileURLWithPath:filename];
    if (!url) return NO;
    [self deliverLocalFileURLsToWebView:@[url]];
    return YES;
}

- (void)application:(NSApplication *)sender openFiles:(NSArray<NSString *> *)filenames {
    NSMutableArray<NSURL *> *urls = [[NSMutableArray alloc] initWithCapacity:filenames.count];
    for (NSString *path in filenames) {
        if (path.length > 0) {
            NSURL *u = [NSURL fileURLWithPath:path];
            if (u) [urls addObject:u];
        }
    }
    [self deliverLocalFileURLsToWebView:urls];
    [sender replyToOpenOrPrint:NSApplicationDelegateReplySuccess];
}

- (void)applicationDidResignActive:(NSNotification *)notification {
    if (self.webView) {
        [self.webView disarmWindowDrag];
    }
}

- (void)applicationWillTerminate:(NSNotification *)notification {
    if (self.localMouseEventMonitor) {
        [NSEvent removeMonitor:self.localMouseEventMonitor];
        self.localMouseEventMonitor = nil;
    }
}

- (BOOL)windowShouldClose:(NSWindow *)sender {
    if (self.confirmBeforeQuit && !self.quitApproved && self.webView && self.webViewReady) {
        [self.webView evaluateJavaScript:@"window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: \"app:request-quit\" }));"
                       completionHandler:nil];
        return NO;
    }
    return YES;
}

- (NSApplicationTerminateReply)applicationShouldTerminate:(NSApplication *)sender {
    if (self.confirmBeforeQuit && !self.quitApproved && self.webView && self.webViewReady) {
        [self.webView evaluateJavaScript:@"window.dispatchEvent(new CustomEvent('mbc:native-menu', { detail: \"app:request-quit\" }));"
                       completionHandler:nil];
        return NSTerminateCancel;
    }
    return NSTerminateNow;
}

- (BOOL)applicationShouldTerminateAfterLastWindowClosed:(NSApplication *)sender {
    return YES;
}

#pragma mark - WKUIDelegate (Native NSOpenPanel & JS Alert/Confirm/Prompt Sheets)

- (void)webView:(WKWebView *)webView
runOpenPanelWithParameters:(WKOpenPanelParameters *)parameters
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(NSArray<NSURL *> * _Nullable URLs))completionHandler {
    NSOpenPanel *panel = [NSOpenPanel openPanel];
    [panel setCanChooseFiles:YES];
    [panel setCanChooseDirectories:parameters.allowsDirectories];
    [panel setAllowsMultipleSelection:parameters.allowsMultipleSelection];
    [panel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK) {
            completionHandler([panel URLs]);
        } else {
            completionHandler(nil);
        }
    }];
}

- (void)webView:(WKWebView *)webView
runJavaScriptAlertPanelWithMessage:(NSString *)message
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(void))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"MolBioCraft"];
    [alert setInformativeText:message ?: @""];
    [alert addButtonWithTitle:@"OK"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(__unused NSModalResponse returnCode) {
        completionHandler();
    }];
}

- (void)webView:(WKWebView *)webView
runJavaScriptConfirmPanelWithMessage:(NSString *)message
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(BOOL result))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"MolBioCraft"];
    [alert setInformativeText:message ?: @""];
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];
    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse returnCode) {
        completionHandler(returnCode == NSAlertFirstButtonReturn);
    }];
}

- (void)webView:(WKWebView *)webView
runJavaScriptTextInputPanelWithPrompt:(NSString *)prompt
defaultText:(NSString *)defaultText
initiatedByFrame:(WKFrameInfo *)frame
completionHandler:(void (^)(NSString * _Nullable result))completionHandler {
    NSAlert *alert = [[NSAlert alloc] init];
    [alert setMessageText:@"MolBioCraft"];
    [alert setInformativeText:prompt ?: @""];
    [alert addButtonWithTitle:@"OK"];
    [alert addButtonWithTitle:@"Cancel"];

    NSTextField *inputField = [[NSTextField alloc] initWithFrame:NSMakeRect(0, 0, 320, 24)];
    [inputField setStringValue:(defaultText ?: @"")];
    [alert setAccessoryView:inputField];

    [alert beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse returnCode) {
        if (returnCode == NSAlertFirstButtonReturn) {
            completionHandler([inputField stringValue]);
        } else {
            completionHandler(nil);
        }
    }];
}

#pragma mark - WKNavigationDelegate & WKDownloadDelegate (Native NSSavePanel for <a download>)

- (void)webView:(WKWebView *)webView
decidePolicyForNavigationAction:(WKNavigationAction *)navigationAction
decisionHandler:(void (^)(WKNavigationActionPolicy))decisionHandler {
    if (@available(macOS 11.3, *)) {
        if (navigationAction.shouldPerformDownload) {
            decisionHandler(WKNavigationActionPolicyDownload);
            return;
        }
    }
    decisionHandler(WKNavigationActionPolicyAllow);
}

- (void)webView:(WKWebView *)webView
decidePolicyForNavigationResponse:(WKNavigationResponse *)navigationResponse
decisionHandler:(void (^)(WKNavigationResponsePolicy))decisionHandler {
    if (@available(macOS 11.3, *)) {
        if (!navigationResponse.canShowMIMEType) {
            decisionHandler(WKNavigationResponsePolicyDownload);
            return;
        }
    }
    decisionHandler(WKNavigationResponsePolicyAllow);
}

- (void)webView:(WKWebView *)webView
navigationAction:(WKNavigationAction *)navigationAction
didBecomeDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    download.delegate = self;
}

- (void)webView:(WKWebView *)webView
navigationResponse:(WKNavigationResponse *)navigationResponse
didBecomeDownload:(WKDownload *)download API_AVAILABLE(macos(11.3)) {
    download.delegate = self;
}

- (void)download:(WKDownload *)download
decideDestinationUsingResponse:(NSURLResponse *)response
suggestedFilename:(NSString *)suggestedFilename
completionHandler:(void (^)(NSURL * _Nullable destination))completionHandler API_AVAILABLE(macos(11.3)) {
    NSSavePanel *savePanel = [NSSavePanel savePanel];
    [savePanel setCanCreateDirectories:YES];
    [savePanel setNameFieldStringValue:(suggestedFilename.length > 0 ? suggestedFilename : @"molbiocraft_export.gb")];
    [savePanel beginSheetModalForWindow:self.window completionHandler:^(NSModalResponse result) {
        if (result == NSModalResponseOK && [savePanel URL] != nil) {
            [[NSFileManager defaultManager] removeItemAtURL:[savePanel URL] error:nil];
            completionHandler([savePanel URL]);
        } else {
            completionHandler(nil);
        }
    }];
}

@end

int main(int argc, const char * argv[]) {
    @autoreleasepool {
        NSApplication *app = [NSApplication sharedApplication];
        [app setActivationPolicy:NSApplicationActivationPolicyRegular];
        MolBioCraftAppDelegate *delegate = [[MolBioCraftAppDelegate alloc] init];
        setupMainMenu(delegate);
        [app setDelegate:delegate];
        [app run];
    }
    return 0;
}
