# Release checklist: native checks on macOS, Windows and Linux

Nothing here is automated (TSD G7): a person at each OS runs these checks on the release
candidate and records the results before the release is tagged.

## How a release is checked

1. Choose the release commit. Run `release.yml` with `workflow_dispatch` on that commit (the
   dispatch path builds the installers and uploads them as workflow artifacts; it publishes
   nothing).
2. Download the artefacts: `MolBioCraft-<version>-macOS-universal.dmg`,
   `MolBioCraft-<version>-Windows-x64.msi`, `MolBioCraft-<version>-Windows-x64-Portable.exe` and
   `MolBioCraft-<version>-Linux-x86_64.deb`.
3. Copy `docs/release-checks/TEMPLATE.md` to `docs/release-checks/v<version>.md` and record
   every item below on every OS. That copy is the release record.
4. Every item gets a result: **pass**, **fail**, or **not run** with its reason, for example
   "no machine" (D0216). An honest "not run" is a valid record. A platform is only claimed when
   someone ran it: PRD F27 stays Partial until a Windows or Linux run passes.
5. Record the build each result came from: the commit and the artefact file name.

Item sources: the coverage gaps and P1 rows of `MOLBIOCRAFT_FUNCTIONAL_INTEGRITY_AUDIT.md`
(native menus and their state, file associations, print, undo and redo routing, native open and
save dialogs, the installers, window close and quit, Shift+Cmd/Ctrl+R in a text field), the
README's "First launch of an unsigned build", and the manual criteria of US-01M6P2B4 (AC3),
US-01M6P2BS (AC4) and US-01M7QCXX (AC4), which are checked here, in the same native session.

Menu paths below are the app's own labels. On macOS they are the native menu bar; on Windows and
Linux they are the in-window menu bar (the app builds a native menu bar on macOS only).

## macOS

Artefact: `MolBioCraft-<version>-macOS-universal.dmg` (universal, ad-hoc signed).

| Item | Check |
|---|---|
| M1 First launch | Open the dmg, drag `MolBioCraft.app` to Applications, Control-click it and choose **Open**, then **Open** again (on macOS 15 or later, **Open Anyway** in System Settings > Privacy & Security). The app opens. |
| M2 Open dialog | File > Open Session > Open Session (Cmd+O) shows the macOS open panel; a picked `.mbc` session opens. |
| M3 Import dialogs | File > Import Data > Sequence Files > Import Files (Cmd+I) and Import Folder each show the open panel; the picked files or folder are imported. |
| M4 Save dialog | File > Save Session > Save Session As shows the macOS save panel; the saved `.mbc` reopens. Cancelling the panel leaves the session unsaved. |
| M5 Export dialog | File > Export Sequences > Export GenBank (Shift+Cmd+E) shows the save panel and writes a `.gb` file that opens again. |
| M6 File association open | With the app closed, double-click a `.gb` (and a `.mbc`) in Finder: the app opens it. With the app running, Finder Open With > MolBioCraft opens the file in the running window. |
| M7 Print | File > Print & PDF > Print / Export PDF (Cmd+P) shows the system print dialog (the audit's D12 row: macOS print was never run). |
| M8 Native menu | The native menu bar shows MolBioCraft, File, Edit, View and the other menus; items enable and disable as a session opens and closes (native menu state sync). |
| M9 Native Undo / Redo | Edit > Undo (Cmd+Z) and Edit > Redo (Shift+Cmd+Z) undo and redo a document edit; with focus in a text field they undo and redo the typed text. |
| M10 Shift+Cmd+R | Shift+Cmd+R runs Sequence > Strand > Reverse Complement on the open sequence and never reloads the window, including with focus in a text field. |
| M11 Quit | MolBioCraft > Quit MolBioCraft (Cmd+Q) and the window's close button, with unsaved changes, show the quit confirmation; with the confirmation turned off, the first close quits. |
| M12 US-01M6P2B4 AC3 | From the release-profile build (`npm run package:installers`, the universal dmg), the app launches, opens a session and exports a GenBank file. |

## Windows

Artefacts: `MolBioCraft-<version>-Windows-x64.msi` and `MolBioCraft-<version>-Windows-x64-Portable.exe` (unsigned).

| Item | Check |
|---|---|
| W1 MSI install | Run the MSI; when SmartScreen says "Windows protected your PC", choose **More info**, then **Run anyway**. It installs (and installs the WebView2 runtime if it is missing) and the app starts. |
| W2 Portable EXE | Run the Portable EXE past SmartScreen the same way; it starts on the WebView2 runtime Windows 10 and 11 include. |
| W3 Open dialog | File > Open Session > Open Session (Ctrl+O) shows the Windows open dialog; a picked `.mbc` session opens. |
| W4 Import dialogs | File > Import Data > Import Files (Ctrl+I) and Import Folder each show the Windows dialog; the picks are imported. |
| W5 Save dialog | File > Save Session > Save Session As shows the Windows save dialog; the saved `.mbc` reopens. Cancelling leaves the session unsaved. |
| W6 Export dialog | File > Export Sequences > Export GenBank (Ctrl+Shift+E) shows the save dialog and writes a `.gb` file that opens again. |
| W7 File association open | With the app closed, double-click a `.gb` (and a `.mbc`) in Explorer: the installed app opens it. |
| W8 US-01M7QCXX AC4 (MSI) | With the installed (MSI) app running, double-click a `.gb`: it opens in the running window and no second window appears. Checked once more with a relative path from a terminal (`molbiocraft-desktop rel/x.gb`, the installed app binary): it opens in the running window, no second window. |
| W9 Print | File > Print & PDF > Print / Export PDF (Ctrl+P) shows the WebView2 print dialog. |
| W10 In-window menu | The in-window menu bar's menus open, and their items enable and disable as a session opens and closes. |
| W11 Shift+Ctrl+R | Shift+Ctrl+R runs Reverse Complement on the open sequence and never reloads the window, including with focus in a text field. |
| W12 Undo / Redo | Edit > Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z), labelled with the action they undo or redo, undo and redo a document edit; in a text field they act on the typed text. |
| W13 Quit | File > Quit MolBioCraft (Ctrl+Q) and the window's close button, with unsaved changes, show the quit confirmation; with the confirmation turned off, the first close quits. |

## Linux

Artefact: `MolBioCraft-<version>-Linux-x86_64.deb` (x86_64; WebKitGTK 4.1, GTK 3).

| Item | Check |
|---|---|
| L1 Install | `sudo apt install ./MolBioCraft-<version>-Linux-x86_64.deb` installs it with its dependencies; MolBioCraft starts from the applications menu. |
| L2 Open dialog | File > Open Session > Open Session (Ctrl+O) shows the GTK open dialog; a picked `.mbc` session opens. |
| L3 Import dialogs | File > Import Data > Import Files (Ctrl+I) and Import Folder each show the GTK dialog; the picks are imported. |
| L4 Save dialog | File > Save Session > Save Session As shows the GTK save dialog; the saved `.mbc` reopens. Cancelling leaves the session unsaved. |
| L5 Export dialog | File > Export Sequences > Export GenBank (Ctrl+Shift+E) shows the save dialog and writes a `.gb` file that opens again. |
| L6 US-01M6P2BS AC4 | On a Linux desktop with neither `xdg-desktop-portal` nor `zenity` installed, File > Open, Import Folder and Save each show the GTK dialog, and a pick is imported or saved. |
| L7 File association open | With the app closed, double-click a `.gb` (and a `.mbc`) in the file manager: the app opens it. |
| L8 US-01M7QCXX AC4 (.deb) | With the app (.deb) running, double-click a `.gb`: it opens in the running window and no second window appears. Checked once more with a relative path from a terminal (`molbiocraft-desktop rel/x.gb`): it opens in the running window, no second window. This needs a D-Bus session bus; without one the second launch runs as a second app. |
| L9 Print | File > Print & PDF > Print / Export PDF (Ctrl+P) shows the WebKitGTK print dialog. |
| L10 In-window menu | The in-window menu bar's menus open, and their items enable and disable as a session opens and closes. |
| L11 Shift+Ctrl+R | Shift+Ctrl+R runs Reverse Complement on the open sequence and never reloads the window, including with focus in a text field. |
| L12 Undo / Redo | Edit > Undo (Ctrl+Z) and Redo (Ctrl+Shift+Z), labelled with the action they undo or redo, undo and redo a document edit; in a text field they act on the typed text. |
| L13 Quit | File > Quit MolBioCraft (Ctrl+Q) and the window's close button, with unsaved changes, show the quit confirmation; with the confirmation turned off, the first close quits. |
