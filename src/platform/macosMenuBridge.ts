// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import {
  exitDesktopAppTauri,
  isTauriDesktopRuntime,
  listenTauriEvent,
  openNativeFilesDialogTauri,
  readDroppedFileBytesTauri,
  saveNativeBinaryFileDialogTauri,
  takePendingOpenFilesTauri,
  saveNativeFileDialogTauri,
  setConfirmBeforeQuitTauri,
  startDesktopWindowDraggingTauri,
  TauriDragDropEventPayload,
  toggleDesktopWindowMaximizeTauri,
  UnlistenFn,
} from '../lib/tauriIpc';
import { createPlatformAdapter, sanitizeExportFilename, SupportedOS } from './osPlatform';

export interface DropdownViewportPosition {
  top: number;
  left: number;
  maxHeight: number;
}

export interface SubmenuViewportPosition {
  top: number;
  left?: number;
  right?: number;
  maxWidth: number;
  maxHeight: number;
  flippedLeft: boolean;
  stackedBelow: boolean;
}

/**
 * 'folder' selects a folder picker in the Tauri desktop app; the Cocoa bundle
 * bridge treats it as a plain 'import'.
 */
export type NativeFileOpenMode = 'replace' | 'merge' | 'import' | 'prefs' | 'folder';

export interface NativeOpenedFilePayload {
  fileName: string;
  base64: string;
  mode: NativeFileOpenMode;
}

/**
 * A desktop Import Folder that left supported files out past its file limit (BG-01M6S17Y): the
 * files it read and the files it did not, as the backend's reply counts them.
 */
export interface NativeFolderImportLeftOutPayload {
  filesRead: number;
  filesLeftOut: number;
}

interface MacosWebKitBridgeGlobals {
  __MBC_NATIVE_MACOS_MENUBAR__?: boolean;
  __MBC_MACOS_APP_BUNDLE__?: boolean;
  webkit?: {
    messageHandlers?: {
      mbcNative?: {
        postMessage?: (payload: Record<string, unknown>) => void;
      };
    };
  };
}

/**
 * Compute viewport-clamped `position: fixed` coordinates for toolbar and menu bar dropdown popups.
 * Prevents clipping inside scroll containers and keeps wide/tall menus (e.g. Cloning, Tree, Workflows)
 * strictly inside the horizontal and vertical viewport bounds.
 */
export function computeViewportClampedMenuPosition(
  triggerRect: Pick<DOMRect, 'left' | 'bottom' | 'top'>,
  viewportWidth: number,
  viewportHeight: number,
  minMenuWidth = 260
): DropdownViewportPosition {
  const safeVw = Math.max(320, viewportWidth);
  const safeVh = Math.max(240, viewportHeight);
  const margin = 10;

  const maxLeft = Math.max(margin, safeVw - minMenuWidth - margin);
  const left = Math.round(Math.max(margin, Math.min(triggerRect.left, maxLeft)));
  const top = Math.round(Math.max(margin, triggerRect.bottom + 4));
  const maxHeight = Math.round(Math.max(160, safeVh - top - 14));

  return { top, left, maxHeight };
}

/**
 * Compute viewport-clamped coordinates for right-click context menus.
 * Places the context menu at the cursor position (cursorX, cursorY) and automatically flips
 * or shifts upwards if opening downward would exceed the viewport bottom.
 */
export function computeViewportClampedContextMenuPosition(
  cursorX: number,
  cursorY: number,
  viewportWidth: number,
  viewportHeight: number,
  minMenuWidth = 240,
  estimatedHeight = 340
): DropdownViewportPosition {
  const safeVw = Math.max(320, viewportWidth);
  const safeVh = Math.max(240, viewportHeight);
  const margin = 10;

  const maxLeft = Math.max(margin, safeVw - minMenuWidth - margin);
  const left = Math.round(Math.max(margin, Math.min(cursorX, maxLeft)));

  let top = Math.round(cursorY);
  if (top + estimatedHeight > safeVh - margin) {
    top = Math.max(margin, Math.min(safeVh - estimatedHeight - margin, Math.round(cursorY - estimatedHeight)));
  }
  const maxHeight = Math.round(Math.max(160, safeVh - top - margin));

  return { top, left, maxHeight };
}

/**
 * Compute viewport-clamped `position: fixed` coordinates for cascading nested sub-menus (`▸`).
 * Places sub-menus to the inline-end (right) of their trigger row by default, automatically
 * flipping to inline-start (left, anchored via `right` so arbitrary submenu widths never overlap
 * the parent menu) when near the right viewport edge, and stacking below the trigger on narrow
 * viewports (< 440 px) so a submenu never covers its own trigger.
 */
export function computeViewportClampedSubmenuPosition(
  triggerRect: Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>,
  viewportWidth: number,
  viewportHeight: number,
  minSubmenuWidth = 275,
  estimatedHeight = 260
): SubmenuViewportPosition {
  const safeVw = Math.max(320, viewportWidth);
  const safeVh = Math.max(240, viewportHeight);
  const margin = 10;
  const gap = 3;

  // Narrow screen (< 440px): open below the trigger row so the submenu never covers its own trigger
  if (safeVw < 440) {
    const maxWidth = Math.max(200, safeVw - margin * 2);
    const clampedWidth = Math.min(minSubmenuWidth, maxWidth);
    const left = Math.round(
      Math.max(margin, Math.min(triggerRect.left + 12, safeVw - clampedWidth - margin))
    );
    const top = Math.round(
      Math.max(margin, Math.min(triggerRect.bottom + 2, safeVh - 150))
    );
    const maxHeight = Math.round(Math.max(140, safeVh - top - margin));
    return {
      top,
      left,
      maxWidth,
      maxHeight,
      flippedLeft: false,
      stackedBelow: true,
    };
  }

  const spaceRight = safeVw - triggerRect.right - margin - gap;
  const spaceLeft = triggerRect.left - margin - gap;

  const desiredTop = triggerRect.top - 5;
  const effectiveEstHeight = Math.min(estimatedHeight, safeVh - margin * 2);
  const maxAllowedTop = Math.max(margin, safeVh - effectiveEstHeight - margin);
  const top = Math.round(Math.max(margin, Math.min(desiredTop, maxAllowedTop)));
  const maxHeight = Math.round(Math.max(160, safeVh - top - margin));

  if (spaceRight >= minSubmenuWidth || spaceRight >= spaceLeft) {
    const left = Math.round(
      Math.max(margin, Math.min(triggerRect.right + gap, safeVw - Math.min(minSubmenuWidth, safeVw - margin * 2) - margin))
    );
    const maxWidth = Math.round(Math.max(210, safeVw - left - margin));
    return {
      top,
      left,
      maxWidth,
      maxHeight,
      flippedLeft: false,
      stackedBelow: false,
    };
  }

  // Flip to inline-start (left of parent menu), anchored by `right` so dynamic width never overlaps parent
  const right = Math.round(Math.max(margin, safeVw - triggerRect.left + gap));
  const maxWidth = Math.round(Math.max(210, safeVw - right - margin));
  return {
    top,
    right,
    maxWidth,
    maxHeight,
    flippedLeft: true,
    stackedBelow: false,
  };
}

/**
 * Whether a keydown is a reload chord (Cmd/Ctrl+R, with or without Shift) the
 * page must cancel. Shift+Cmd+R is Reverse Complement: on the native macOS
 * menu bar the AppKit key equivalent runs it, and a page-cancelled key
 * equivalent is not passed on to the menu, so it is left alone there. Every
 * other host runs it from the in-window shortcut dispatcher, which handles the
 * chord even though it was cancelled here.
 */
export function shouldBlockReloadChord(
  ev: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'>,
  nativeMacMenuBar: boolean
): boolean {
  if (!(ev.metaKey || ev.ctrlKey) || (ev.key !== 'r' && ev.key !== 'R')) return false;
  return !(ev.shiftKey && nativeMacMenuBar);
}

/**
 * Determine whether the application is running inside a native macOS desktop container
 * (Cocoa/WKWebView `.app` bundle or Tauri macOS runtime) whose menus are integrated into
 * the macOS system top menu bar (`NSMenu`).
 */
export function isNativeMacMenuBarActive(effectiveOs: SupportedOS): boolean {
  const adapter = createPlatformAdapter(effectiveOs);
  if (adapter.windowChrome.menuBarLocation !== 'system-top-bar') {
    return false;
  }
  const g = globalThis as unknown as MacosWebKitBridgeGlobals;
  if (g.__MBC_NATIVE_MACOS_MENUBAR__ === true) {
    return true;
  }
  return isTauriDesktopRuntime();
}

/**
 * Dispatch a message to `window.webkit.messageHandlers.mbcNative` while strictly preserving
 * `handler` as the `this` receiver (`JSUserMessageHandler::postMessage` in WebKit C++ silently
 * drops calls if `postMessage` is invoked unbound without its `WKScriptMessageHandler` instance).
 */
function postMacosNativeBridgeMessage(payload: Record<string, unknown>): boolean {
  const g = globalThis as unknown as MacosWebKitBridgeGlobals;
  const handler = g.webkit?.messageHandlers?.mbcNative;
  if (g.__MBC_MACOS_APP_BUNDLE__ && handler && typeof handler.postMessage === 'function') {
    handler.postMessage(payload);
    return true;
  }
  return false;
}

/**
 * Invoke native macOS `NSSavePanel` via `WKScriptMessageHandler` when running inside `MolBioCraft.app`.
 * Returns `true` if delegated to native Cocoa save sheet, or `false` to fall back to browser Blob download.
 */
/** Surface a native dialog / IPC failure to the workbench instead of swallowing it. */
function dispatchNativeFileError(err: unknown): void {
  if (typeof window === 'undefined') return;
  const message = err instanceof Error ? err.message : String(err);
  window.dispatchEvent(new CustomEvent<string>('mbc:native-file-error', { detail: message }));
}

function dispatchNativeFileSaved(savedName: string | null): void {
  if (savedName && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string>('mbc:native-file-saved', { detail: savedName }));
  }
}

export function postMacosNativeSave(filename: string, content: string): boolean {
  if (
    postMacosNativeBridgeMessage({
      type: 'saveFile',
      filename,
      content,
    })
  ) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    void saveNativeFileDialogTauri(filename, content)
      .then(dispatchNativeFileSaved)
      .catch(dispatchNativeFileError);
    return true;
  }
  return false;
}

export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

/**
 * Invoke native macOS `NSSavePanel` with binary bytes (e.g. `.mcb` folder ZIP archive).
 */
export function postMacosNativeSaveBinary(filename: string, bytes: Uint8Array): boolean {
  const base64 = encodeBytesToBase64(bytes);
  if (
    postMacosNativeBridgeMessage({
      type: 'saveFile',
      filename,
      base64,
    })
  ) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    // The browser <a download> fallback is a no-op inside the Tauri webview, so
    // binary exports (folder .mbc ZIP archives) need the native save path too.
    void saveNativeBinaryFileDialogTauri(filename, base64)
      .then(dispatchNativeFileSaved)
      .catch(dispatchNativeFileError);
    return true;
  }
  return false;
}

/** Decode a `data:` URL (e.g. canvas.toDataURL('image/png')) into bytes. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(',');
  const meta = dataUrl.slice(0, Math.max(0, comma));
  const body = dataUrl.slice(comma + 1);
  if (/;base64$/i.test(meta)) {
    const bin = atob(body);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }
  return new TextEncoder().encode(decodeURIComponent(body));
}

/**
 * Save a file produced inside a studio (CSV/TSV tables, SVG/PNG figures,
 * protocols, VCF...). Uses the native Save dialog in the macOS bundle and the
 * Tauri desktop app — where an `<a download>` click is a silent no-op — and a
 * browser download elsewhere. Native-dialog completion/errors are reported
 * through the `mbc:native-file-saved` / `mbc:native-file-error` events.
 * Returns 'native', 'downloaded', or false when no save path exists.
 */
export function saveWorkbenchFile(
  filename: string,
  data: string | Uint8Array,
  mimeType = 'text/plain;charset=utf-8'
): 'native' | 'downloaded' | false {
  const safeName = sanitizeExportFilename(filename);
  if (typeof data === 'string' ? postMacosNativeSave(safeName, data) : postMacosNativeSaveBinary(safeName, data)) {
    return 'native';
  }
  if (
    typeof document === 'undefined' ||
    typeof Blob === 'undefined' ||
    typeof URL === 'undefined' ||
    typeof URL.createObjectURL !== 'function'
  ) {
    return false;
  }
  const part: BlobPart = typeof data === 'string' ? data : new Uint8Array(data);
  const url = URL.createObjectURL(new Blob([part], { type: mimeType }));
  const a = document.createElement('a');
  a.href = url;
  a.download = safeName;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Revoking synchronously can cancel the download in Safari / Firefox.
  window.setTimeout(() => URL.revokeObjectURL(url), 10000);
  return 'downloaded';
}

/**
 * Invoke native macOS `NSOpenPanel` via `WKScriptMessageHandler` or Tauri v2 `rfd::AsyncFileDialog`
 * when running inside a native desktop bundle. Returns `true` if delegated to native OS dialog,
 * or `false` to fall back to `<input type="file">`.
 */
export function postMacosNativeOpen(mode: NativeFileOpenMode): boolean {
  if (
    postMacosNativeBridgeMessage({
      type: 'openFile',
      mode: mode === 'folder' ? 'import' : mode,
    })
  ) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    void openNativeFilesDialogTauri(mode)
      .then((reply) => {
        if (typeof window === 'undefined') return;
        if (!reply || !Array.isArray(reply.files) || typeof reply.filesLeftOut !== 'number') {
          throw new Error('the file dialog replied without the list of files it read');
        }
        for (const entry of reply.files) {
          window.dispatchEvent(
            new CustomEvent<NativeOpenedFilePayload>('mbc:native-file-open', {
              detail: {
                fileName: entry.file_name,
                base64: entry.base64,
                mode,
              },
            })
          );
        }
        // after the files, so the workbench has them queued when it learns what was left out
        if (reply.filesLeftOut > 0) {
          window.dispatchEvent(
            new CustomEvent<NativeFolderImportLeftOutPayload>('mbc:native-folder-import-left-out', {
              detail: { filesRead: reply.files.length, filesLeftOut: reply.filesLeftOut },
            })
          );
        }
      })
      .catch(dispatchNativeFileError);
    return true;
  }
  return false;
}

/**
 * Trigger native macOS window dragging from the unified custom top tabbar (`NSWindowStyleMaskFullSizeContentView`).
 */
export function postMacosWindowDrag(): boolean {
  return postMacosNativeBridgeMessage({ type: 'windowDrag' });
}

/**
 * Trigger native macOS window zoom on double-click of empty unified top tabbar space.
 */
export function postMacosWindowZoom(): boolean {
  return postMacosNativeBridgeMessage({ type: 'windowZoom' });
}

const INTERACTIVE_WINDOW_CHROME_SELECTOR =
  'button, [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], a, input, select, textarea, label, .mbc-doc-tab, .toolbar-dropdown-anchor, .menubar-dropdown-anchor, .toolbar-global-search, .desktop-menu-popup, .cascading-menu-popup, [data-no-window-drag]';

/**
 * Returns true when an event target inside custom window chrome belongs to an interactive
 * button, tab, menu, or form control and therefore must NOT initiate OS window dragging.
 */
export function isInteractiveWindowChromeTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false;
  const candidate = target as { closest?: (selector: string) => unknown };
  if (typeof candidate.closest !== 'function') return false;
  return Boolean(candidate.closest(INTERACTIVE_WINDOW_CHROME_SELECTOR));
}

/**
 * Cross-platform native desktop window drag dispatcher supporting both the macOS Cocoa
 * `MolBioCraft.app` WKWebView bundle and Tauri v2 desktop windows (macOS, Windows, Linux).
 */
export function requestDesktopWindowDrag(): boolean {
  if (postMacosWindowDrag()) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    void startDesktopWindowDraggingTauri().catch(() => {});
    return true;
  }
  return false;
}

/**
 * Cross-platform native desktop window maximize / zoom toggle when double-clicking empty
 * window header chrome across macOS Cocoa (`performZoom:`) and Tauri v2 (`cmd_window_toggle_maximize`).
 */
export function requestDesktopWindowToggleMaximize(): boolean {
  if (postMacosWindowZoom()) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    void toggleDesktopWindowMaximizeTauri().catch(() => {});
    return true;
  }
  return false;
}

export const CONFIRM_BEFORE_QUIT_STORAGE_KEY = 'mbc.confirmBeforeQuit';

/**
 * Read persisted "Confirm before quitting" preference (`true` by default until the user
 * checks "Don't ask again" in the Confirm Quit dialog or disables it in Preferences).
 */
export function readStoredConfirmBeforeQuit(): boolean {
  try {
    if (typeof localStorage === 'undefined') return true;
    const raw = localStorage.getItem(CONFIRM_BEFORE_QUIT_STORAGE_KEY);
    if (raw === null) return true;
    return raw !== 'false' && raw !== '0';
  } catch {
    return true;
  }
}

/**
 * Persist the "Confirm before quitting" preference to localStorage.
 */
export function writeStoredConfirmBeforeQuit(confirm: boolean): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(CONFIRM_BEFORE_QUIT_STORAGE_KEY, confirm ? 'true' : 'false');
  } catch {
    // Ignore restricted storage contexts
  }
}

/**
 * Synchronize the user's "Confirm before quitting" preference with native window-close
 * and app-termination guards across macOS Cocoa (`MolBioCraft.app`) and Tauri v2.
 */
export function syncNativeConfirmBeforeQuit(confirm: boolean): boolean {
  if (postMacosNativeBridgeMessage({ type: 'setConfirmBeforeQuit', confirm })) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    void setConfirmBeforeQuitTauri(confirm).catch(() => {});
    return true;
  }
  return false;
}

/**
 * Approve and perform immediate native desktop application exit across macOS Cocoa
 * (`[NSApp terminate:nil]`) and Tauri v2 (`cmd_app_exit`).
 * Returns `false` when running in a standard web browser tab.
 */
export function performNativeAppQuit(): boolean {
  if (postMacosNativeBridgeMessage({ type: 'confirmQuitNow' })) {
    return true;
  }
  if (isTauriDesktopRuntime()) {
    void exitDesktopAppTauri().catch(() => {});
    return true;
  }
  return false;
}

/**
 * Decode a base64 payload from native macOS `NSOpenPanel` or Tauri `cmd_read_dropped_file_bytes`
 * into a standard Web `File` object, preserving exact binary bytes for `.ab1` / `.scf` / `.bam`
 * as well as UTF-8 text for `.mbc` / `.gb` / `.fasta`.
 */
export function decodeBase64ToFile(base64: string, fileName: string): File {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  return new File([bytes], fileName);
}

/**
 * Subscribe to native macOS menu bar commands and native file open/save/drag callbacks
 * across both the Cocoa/WKWebView app bundle and Tauri v2 desktop runtime.
 */
type PendingOpenFileEntry = Awaited<ReturnType<typeof takePendingOpenFilesTauri>>[number];
/** OS file-open entries taken from the backend while no subscription was live. */
const undeliveredOpenFiles: PendingOpenFileEntry[] = [];
/** Delivery function of the currently live subscription, if any. */
let liveOpenFileSink: ((entries: readonly PendingOpenFileEntry[]) => void) | null = null;

export function subscribeNativeMacMenuEvents(handlers: {
  onMenuAction: (actionId: string) => void;
  onNativeFileOpen: (file: File, mode: NativeFileOpenMode) => void;
  onNativeFileSaved?: (savedFilename: string) => void;
  onNativeFileError?: (message: string) => void;
  onNativeFileDrag?: (active: boolean, count: number) => void;
  /** A desktop Import Folder read `filesRead` files and left `filesLeftOut` supported files out. */
  onNativeFolderImportLeftOut?: (filesLeftOut: number, filesRead: number) => void;
}): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleDomMenu = (ev: Event) => {
    const custom = ev as CustomEvent<string>;
    if (typeof custom.detail === 'string' && custom.detail) {
      handlers.onMenuAction(custom.detail);
    }
  };

  const handleDomFileOpen = (ev: Event) => {
    const custom = ev as CustomEvent<NativeOpenedFilePayload>;
    const detail = custom.detail;
    if (detail && typeof detail.base64 === 'string' && typeof detail.fileName === 'string') {
      const file = decodeBase64ToFile(detail.base64, detail.fileName);
      handlers.onNativeFileOpen(file, detail.mode || 'import');
    }
  };

  const handleDomFileSaved = (ev: Event) => {
    const custom = ev as CustomEvent<string>;
    if (typeof custom.detail === 'string' && custom.detail) {
      handlers.onNativeFileSaved?.(custom.detail);
    }
  };

  const handleDomFileError = (ev: Event) => {
    const custom = ev as CustomEvent<string>;
    if (typeof custom.detail === 'string' && custom.detail) {
      handlers.onNativeFileError?.(custom.detail);
    }
  };

  const handleDomFileDrag = (ev: Event) => {
    const custom = ev as CustomEvent<{ active?: boolean; count?: number }>;
    const detail = custom.detail;
    if (detail && typeof detail.active === 'boolean') {
      handlers.onNativeFileDrag?.(detail.active, Number(detail.count ?? 0));
    }
  };

  const handleDomFolderImportLeftOut = (ev: Event) => {
    const detail = (ev as CustomEvent<NativeFolderImportLeftOutPayload>).detail;
    if (detail && detail.filesLeftOut > 0) {
      handlers.onNativeFolderImportLeftOut?.(detail.filesLeftOut, detail.filesRead);
    }
  };

  window.addEventListener('mbc:native-menu', handleDomMenu);
  window.addEventListener('mbc:native-file-open', handleDomFileOpen);
  window.addEventListener('mbc:native-file-saved', handleDomFileSaved);
  window.addEventListener('mbc:native-file-drag', handleDomFileDrag);
  window.addEventListener('mbc:native-file-error', handleDomFileError);
  window.addEventListener('mbc:native-folder-import-left-out', handleDomFolderImportLeftOut);

  let unlistenTauri: (() => void) | null = null;
  let unlistenOpenFiles: (() => void) | null = null;
  let active = true;

  // Files opened through OS file associations are queued by the backend
  // (they can arrive before this listener exists): drain on start and on notice.
  // Taking them empties the backend queue, so entries that resolve after this
  // subscription was torn down (React StrictMode remount) are parked for the
  // next subscription instead of being dropped.
  const deliverOpenFiles = (entries: readonly PendingOpenFileEntry[]) => {
    for (const entry of entries) {
      handlers.onNativeFileOpen(decodeBase64ToFile(entry.base64, entry.file_name), 'import');
    }
  };
  const drainPendingOpenFiles = () => {
    void takePendingOpenFilesTauri()
      .then((entries) => {
        if (active) {
          deliverOpenFiles(entries);
        } else if (liveOpenFileSink) {
          // A newer subscription is already listening: hand them to it.
          liveOpenFileSink(entries);
        } else {
          undeliveredOpenFiles.push(...entries);
        }
      })
      .catch((err) => handlers.onNativeFileError?.(err instanceof Error ? err.message : String(err)));
  };
  liveOpenFileSink = deliverOpenFiles;
  if (undeliveredOpenFiles.length > 0) {
    deliverOpenFiles(undeliveredOpenFiles.splice(0));
  }
  if (isTauriDesktopRuntime()) {
    drainPendingOpenFiles();
    void listenTauriEvent<unknown>('mbc://open-files-pending', () => {
      if (active) drainPendingOpenFiles();
    })
      .then((unlisten) => {
        if (active) {
          unlistenOpenFiles = unlisten;
        } else {
          unlisten();
        }
      })
      .catch((err) => handlers.onNativeFileError?.(`File-open listener unavailable: ${err instanceof Error ? err.message : String(err)}`));
  }

  void listenTauriEvent<string>('mbc://native-menu', (evt) => {
    if (active && typeof evt.payload === 'string' && evt.payload) {
      handlers.onMenuAction(evt.payload);
    }
  })
    .then((unlisten) => {
      if (active) {
        unlistenTauri = unlisten;
      } else {
        unlisten();
      }
    })
    .catch((err) => {
      // Not a desktop runtime (no event bridge) or the bridge failed: the
      // in-window menus still work, so log instead of an unhandled rejection.
      if (isTauriDesktopRuntime()) {
        // eslint-disable-next-line no-console
        console.warn('[MolBioCraft] native menu listener unavailable', err);
      }
    });

  return () => {
    active = false;
    if (liveOpenFileSink === deliverOpenFiles) liveOpenFileSink = null;
    window.removeEventListener('mbc:native-menu', handleDomMenu);
    window.removeEventListener('mbc:native-file-open', handleDomFileOpen);
    window.removeEventListener('mbc:native-file-saved', handleDomFileSaved);
    window.removeEventListener('mbc:native-file-drag', handleDomFileDrag);
    window.removeEventListener('mbc:native-file-error', handleDomFileError);
    window.removeEventListener('mbc:native-folder-import-left-out', handleDomFolderImportLeftOut);
    if (unlistenTauri) {
      unlistenTauri();
    }
    if (unlistenOpenFiles) {
      unlistenOpenFiles();
    }
  };
}

/**
 * Subscribe to Tauri v2 native OS window file drag-and-drop events (`tauri://drag-enter`,
 * `tauri://drag-leave`, `tauri://drag-drop`), reading dropped files losslessly via
 * `cmd_read_dropped_file_bytes` and reconstructing `File` instances for workbench import.
 */
export function subscribeTauriWindowFileDropEvents(handlers: {
  onDragEnter?: (paths: string[]) => void;
  onDragLeave?: () => void;
  onDropFiles: (files: File[]) => void;
  onDropError?: (message: string) => void;
}): () => void {
  if (!isTauriDesktopRuntime()) {
    return () => {};
  }

  let active = true;
  const unlisteners: UnlistenFn[] = [];
  const register = (p: Promise<UnlistenFn>) => {
    void p.then((fn) => {
      if (active) {
        unlisteners.push(fn);
      } else {
        fn();
      }
    });
  };

  register(
    listenTauriEvent<TauriDragDropEventPayload>('tauri://drag-enter', (evt) => {
      if (!active) return;
      const paths = Array.isArray(evt.payload?.paths) ? evt.payload.paths : [];
      if (paths.length > 0) {
        handlers.onDragEnter?.(paths);
      }
    })
  );

  register(
    listenTauriEvent<unknown>('tauri://drag-leave', () => {
      if (!active) return;
      handlers.onDragLeave?.();
    })
  );

  register(
    listenTauriEvent<TauriDragDropEventPayload>('tauri://drag-drop', (evt) => {
      if (!active) return;
      handlers.onDragLeave?.();
      const paths = Array.isArray(evt.payload?.paths) ? evt.payload.paths : [];
      if (paths.length === 0) return;

      void (async () => {
        const files: File[] = [];
        for (const rawPath of paths) {
          try {
            const payload = await readDroppedFileBytesTauri(rawPath);
            if (!active) return;
            files.push(decodeBase64ToFile(payload.base64, payload.file_name));
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            handlers.onDropError?.(msg);
          }
        }
        if (active && files.length > 0) {
          handlers.onDropFiles(files);
        }
      })();
    })
  );

  return () => {
    active = false;
    while (unlisteners.length > 0) {
      const fn = unlisteners.pop();
      fn?.();
    }
  };
}
