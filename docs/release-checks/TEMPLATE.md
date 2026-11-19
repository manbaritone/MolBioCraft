# Release record v<version>

Copy this file to `docs/release-checks/v<version>.md` for the release; that copy is the release record. Its items are those of `docs/RELEASE_CHECKLIST.md`, which says how to run each one.

Every item on every OS gets a Result: **pass**, **fail** or **not run**. A **fail** or a **not run** gives its Reason; a not run names why, for example "no machine" (D0216). An honest "not run" with its reason is a valid record: a platform is only claimed when someone ran it, and PRD F27 stays Partial until a Windows or Linux run passes. No item is left blank.

Build names the release commit and the artefact the check ran on (the `workflow_dispatch` artefacts of `release.yml` on that commit, checked before the tag), for example `abc1234 MolBioCraft-1.2.0-Linux-x86_64.deb`.

- Release: v<version>
- Release commit: <commit>
- release.yml workflow_dispatch run: <run URL or id>

## macOS

Artefact: `MolBioCraft-<version>-macOS-universal.dmg`

| Item | Result | Reason | Who | Date | Build |
|---|---|---|---|---|---|
| M1 First launch |  |  |  |  |  |
| M2 Open dialog |  |  |  |  |  |
| M3 Import dialogs |  |  |  |  |  |
| M4 Save dialog |  |  |  |  |  |
| M5 Export dialog |  |  |  |  |  |
| M6 File association open |  |  |  |  |  |
| M7 Print |  |  |  |  |  |
| M8 Native menu |  |  |  |  |  |
| M9 Native Undo / Redo |  |  |  |  |  |
| M10 Shift+Cmd+R |  |  |  |  |  |
| M11 Quit |  |  |  |  |  |
| M12 US-01M6P2B4 AC3 |  |  |  |  |  |

## Windows

Artefact: `MolBioCraft-<version>-Windows-x64.msi`, `MolBioCraft-<version>-Windows-x64-Portable.exe`

| Item | Result | Reason | Who | Date | Build |
|---|---|---|---|---|---|
| W1 MSI install |  |  |  |  |  |
| W2 Portable EXE |  |  |  |  |  |
| W3 Open dialog |  |  |  |  |  |
| W4 Import dialogs |  |  |  |  |  |
| W5 Save dialog |  |  |  |  |  |
| W6 Export dialog |  |  |  |  |  |
| W7 File association open |  |  |  |  |  |
| W8 US-01M7QCXX AC4 (MSI) |  |  |  |  |  |
| W9 Print |  |  |  |  |  |
| W10 In-window menu |  |  |  |  |  |
| W11 Shift+Ctrl+R |  |  |  |  |  |
| W12 Undo / Redo |  |  |  |  |  |
| W13 Quit |  |  |  |  |  |

## Linux

Artefact: `MolBioCraft-<version>-Linux-x86_64.deb`

| Item | Result | Reason | Who | Date | Build |
|---|---|---|---|---|---|
| L1 Install |  |  |  |  |  |
| L2 Open dialog |  |  |  |  |  |
| L3 Import dialogs |  |  |  |  |  |
| L4 Save dialog |  |  |  |  |  |
| L5 Export dialog |  |  |  |  |  |
| L6 US-01M6P2BS AC4 |  |  |  |  |  |
| L7 File association open |  |  |  |  |  |
| L8 US-01M7QCXX AC4 (.deb) |  |  |  |  |  |
| L9 Print |  |  |  |  |  |
| L10 In-window menu |  |  |  |  |  |
| L11 Shift+Ctrl+R |  |  |  |  |  |
| L12 Undo / Redo |  |  |  |  |  |
| L13 Quit |  |  |  |  |  |
