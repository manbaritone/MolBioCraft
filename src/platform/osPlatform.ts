// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Cross-Platform OS Abstraction, Adapter Factory, Path Normalization,
 * Filesystem Case/Unicode Guard, Tri-State System Theme Sync, Structured Logging,
 * Deterministic Resource Management, and Non-Blocking Async Task Engine
 * for macOS (Intel & Apple Silicon), Windows (x64 & ARM64), and Linux (x86_64 & ARM64).
 */

export type SupportedOS = 'macos' | 'windows' | 'linux';
export type CpuArch = 'arm64' | 'x86_64' | 'unknown';
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
export type ThemePreference = 'system' | 'light' | 'dark';

export type ErrorCode =
  | 'ERR_INVALID_FILENAME'
  | 'ERR_WINDOWS_RESERVED_NAME'
  | 'ERR_PATH_TOO_LONG'
  | 'ERR_FILE_LOCKED'
  | 'ERR_PERMISSION_DENIED'
  | 'ERR_SANDBOX_VIOLATION'
  | 'ERR_READ_ONLY_FILESYSTEM'
  | 'ERR_TASK_ABORTED'
  | 'ERR_CORRUPT_PACKET'
  | 'ERR_EMPTY_SEQUENCE'
  | 'ERR_UNSUPPORTED_INPUT';

export class MolBioCraftError extends Error {
  public readonly code: ErrorCode;
  public readonly osContext: SupportedOS;
  public readonly details?: Record<string, unknown>;

  constructor(
    code: ErrorCode,
    message: string,
    osContext: SupportedOS = detectHostOS(),
    details?: Record<string, unknown>
  ) {
    super(`[${code}] ${message}`);
    this.name = 'MolBioCraftError';
    this.code = code;
    this.osContext = osContext;
    this.details = details;
    Object.setPrototypeOf(this, MolBioCraftError.prototype);
  }
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  module: string;
  message: string;
  metadata?: Record<string, unknown>;
}

type LogListener = (entry: LogEntry) => void;

class StructuredLogger {
  private readonly buffer: LogEntry[] = [];
  private readonly maxEntries = 500;
  private readonly listeners = new Set<LogListener>();

  private write(
    level: LogLevel,
    module: string,
    message: string,
    metadata?: Record<string, unknown>
  ): LogEntry {
    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      module,
      message,
      metadata,
    };
    this.buffer.push(entry);
    if (this.buffer.length > this.maxEntries) {
      this.buffer.shift();
    }
    const formatted = `[${entry.timestamp}] [${level}] [${module}] ${message}`;
    if (level === 'ERROR') {
      console.error(formatted, metadata ?? '');
    } else if (level === 'WARN') {
      console.warn(formatted, metadata ?? '');
    } else {
      console.info(formatted, metadata ?? '');
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Never allow telemetry observer errors to disrupt caller flow
      }
    }
    return entry;
  }

  public debug(module: string, message: string, metadata?: Record<string, unknown>) {
    return this.write('DEBUG', module, message, metadata);
  }

  public info(module: string, message: string, metadata?: Record<string, unknown>) {
    return this.write('INFO', module, message, metadata);
  }

  public warn(module: string, message: string, metadata?: Record<string, unknown>) {
    return this.write('WARN', module, message, metadata);
  }

  public error(module: string, message: string, metadata?: Record<string, unknown>) {
    return this.write('ERROR', module, message, metadata);
  }

  public subscribe(listener: LogListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getRecentLogs(): ReadonlyArray<LogEntry> {
    return this.buffer;
  }
}

export const Logger = new StructuredLogger();

/**
 * Detect current operating system without relying on deprecated navigator.platform hacks.
 * Prefers modern User-Agent Client Hints (navigator.userAgentData) -> navigator.userAgent -> process.platform.
 */
export function detectHostOS(userAgentOverride?: string): SupportedOS {
  if (userAgentOverride !== undefined) {
    const lowerOverride = userAgentOverride.toLowerCase();
    // windows
    if (lowerOverride.includes('win32') || lowerOverride.includes('windows')) {
      return 'windows';
    }
    // macos
    if (lowerOverride.includes('mac') || lowerOverride.includes('darwin')) {
      return 'macos';
    }
    // linux
    return 'linux';
  }

  const uaDataPlatform = (
    globalThis as { navigator?: { userAgentData?: { platform?: string } } }
  ).navigator?.userAgentData?.platform;

  const nodePlatform = (globalThis as { process?: { platform?: string } }).process?.platform;
  const ua =
    uaDataPlatform ||
    (typeof navigator !== 'undefined' ? navigator.userAgent : '') ||
    nodePlatform ||
    '';

  const lower = ua.toLowerCase();
  // windows
  if (lower.includes('win32') || lower.includes('windows')) {
    return 'windows';
  }
  // macos
  if (lower.includes('mac') || lower.includes('darwin')) {
    return 'macos';
  }
  // linux
  return 'linux';
}

/**
 * Detect CPU architecture (Apple Silicon / ARM64 vs Intel / AMD x86_64).
 */
export function detectCpuArch(hintOverride?: string): CpuArch {
  const procArch = (globalThis as { process?: { arch?: string } }).process?.arch;
  const raw = (
    hintOverride ??
    procArch ??
    (typeof navigator !== 'undefined' ? navigator.userAgent : '')
  ).toLowerCase();

  // Note: every Chromium/Safari user agent contains "AppleWebKit", so "apple"
  // is not evidence of Apple Silicon (it made every browser report arm64).
  if (raw.includes('arm64') || raw.includes('aarch64')) {
    return 'arm64';
  }
  // macOS user agents are frozen at "Intel Mac OS X" even on Apple Silicon, so
  // the architecture cannot be inferred from them.
  if (raw.includes('macintosh') || raw.includes('mac os x')) {
    return 'unknown';
  }
  if (
    raw.includes('x86_64') ||
    raw.includes('x64') ||
    raw.includes('win64') ||
    raw.includes('amd64') ||
    raw.includes('intel')
  ) {
    return 'x86_64';
  }
  return 'unknown';
}

export interface ShortcutModifiers {
  shift?: boolean;
  alt?: boolean;
  ctrlOnly?: boolean;
}

/**
 * Format keyboard shortcuts according to platform HIG:
 * - macOS: Symbols (⌃, ⌥, ⇧, ⌘) e.g. ⇧⌘M, ⌥⌘S, ⌘O
 * - Windows & Linux: Explicit chord labels e.g. Ctrl+Shift+M, Ctrl+Alt+S, Ctrl+O
 */
export function formatPlatformShortcut(
  key: string,
  os: SupportedOS = detectHostOS(),
  modifiers: ShortcutModifiers = {}
): string {
  // Support compound shorthand inputs such as "Shift+M" or "Alt+Shift+S"
  let shift = Boolean(modifiers.shift);
  let alt = Boolean(modifiers.alt);
  let baseKey = key.trim();

  if (baseKey.includes('+')) {
    const parts = baseKey.split('+').map((p) => p.trim());
    baseKey = parts[parts.length - 1] || baseKey;
    for (const part of parts.slice(0, -1)) {
      const p = part.toLowerCase();
      if (p === 'shift' || p === '⇧') shift = true;
      if (p === 'alt' || p === 'opt' || p === 'option' || p === '⌥') alt = true;
    }
  }

  const cleanKey = baseKey.toUpperCase();

  // macos
  if (os === 'macos') {
    const prefix = `${modifiers.ctrlOnly ? '⌃' : ''}${alt ? '⌥' : ''}${shift ? '⇧' : ''}${
      modifiers.ctrlOnly ? '' : '⌘'
    }`;
    return `${prefix}${cleanKey}`;
  }

  // windows & linux
  const parts: string[] = ['Ctrl'];
  if (alt) parts.push('Alt');
  if (shift) parts.push('Shift');
  parts.push(cleanKey);
  return parts.join('+');
}

/**
 * Match a DOM KeyboardEvent against the platform's primary command modifier
 * (metaKey ⌘ on macOS; ctrlKey on Windows and Linux).
 */
export function isPlatformPrimaryModifier(
  event: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey'>,
  os: SupportedOS = detectHostOS()
): boolean {
  // macos
  if (os === 'macos') {
    return event.metaKey && !event.ctrlKey;
  }
  // windows & linux
  return event.ctrlKey && !event.metaKey;
}

export interface PlatformEnvironmentVars {
  home?: string;
  appData?: string;
  localAppData?: string;
  xdgConfigHome?: string;
  xdgDataHome?: string;
  xdgStateHome?: string;
  xdgCacheHome?: string;
  xdgRuntimeDir?: string;
  sandboxEnabled?: boolean;
  flatpakId?: string;
}

export interface PlatformAppDirectories {
  appSupportDir: string;
  dataDir: string;
  logsDir: string;
  cacheDir: string;
  tempDir: string;
  registryRootKey?: string;
  desktopEntryPath?: string;
}

export interface WindowChromeConventions {
  menuBarLocation: 'system-top-bar' | 'in-window-top';
  windowControlsSide: 'left-traffic-lights' | 'right-caption-buttons' | 'freedesktop-wm';
  trayBackend: string;
  notificationBackend: string;
  installerFormats: string[];
  filesystemSummary: string;
}

export interface PlatformAdapter {
  readonly os: SupportedOS;
  readonly filesystemCaseSensitive: boolean;
  readonly pathSeparator: '/' | '\\';
  readonly defaultLineEnding: 'LF' | 'CRLF';
  readonly windowChrome: WindowChromeConventions;
  resolveDirectories(env?: PlatformEnvironmentVars): PlatformAppDirectories;
  normalizePath(rawPath: string): string;
  formatShortcut(key: string, modifiers?: ShortcutModifiers): string;
  validatePathAccess(
    targetPath: string,
    env?: PlatformEnvironmentVars,
    grantedPaths?: string[]
  ): { allowed: true; normalizedPath: string };
}

/**
 * Windows MAX_PATH (260 chars total / 248 chars directory) safe path threshold.
 * Prepends the Win32 extended-length path prefix (`\\?\` or `\\?\UNC\`) on Windows
 * after resolving relative `.` and `..` segments when paths reach or exceed 248 characters.
 */
export const WINDOWS_MAX_PATH_THRESHOLD = 248;

function collapsePosixSegments(posixPath: string): string {
  const isAbsolute = posixPath.startsWith('/');
  const rawParts = posixPath.split('/');
  const stack: string[] = [];
  for (const part of rawParts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (stack.length > 0 && stack[stack.length - 1] !== '..') {
        stack.pop();
      } else if (!isAbsolute) {
        stack.push('..');
      }
    } else {
      stack.push(part);
    }
  }
  const joined = stack.join('/');
  return isAbsolute ? `/${joined}` : joined || '.';
}

function collapseWindowsSegments(winPath: string): string {
  const isUnc = winPath.startsWith('\\\\');
  if (isUnc) {
    const trimmed = winPath.slice(2).replace(/\\{2,}/g, '\\');
    const parts = trimmed.split('\\').filter(Boolean);
    if (parts.length <= 2) {
      return `\\\\${parts.join('\\')}`;
    }
    const [server, share, ...rest] = parts;
    const stack: string[] = [];
    for (const seg of rest) {
      if (seg === '.') continue;
      if (seg === '..') {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(seg);
      }
    }
    return `\\\\${[server, share, ...stack].join('\\')}`;
  }

  const driveMatch = /^([A-Za-z]:)(?:\\(.*))?$/.exec(winPath);
  if (driveMatch) {
    const drive = driveMatch[1];
    const rest = (driveMatch[2] ?? '').split('\\');
    const stack: string[] = [];
    for (const seg of rest) {
      if (!seg || seg === '.') continue;
      if (seg === '..') {
        if (stack.length > 0) stack.pop();
      } else {
        stack.push(seg);
      }
    }
    return `${drive}\\${stack.join('\\')}`;
  }

  return winPath.replace(/\\{2,}/g, '\\');
}

/**
 * Normalize slashes, resolve lexical `.`/`..` segments, and apply Win32 `\\?\` or `\\?\UNC\`
 * extended-length path prefixes on Windows when paths exceed MAX_PATH thresholds.
 */
export function normalizeCrossPlatformPath(rawPath: string, targetOs: SupportedOS): string {
  if (!rawPath || !rawPath.trim()) {
    throw new MolBioCraftError(
      'ERR_INVALID_FILENAME',
      'File path cannot be empty or whitespace.',
      targetOs
    );
  }

  const unicodeNormalized = rawPath.trim().normalize('NFC');

  // macos
  if (targetOs === 'macos') {
    const forward = unicodeNormalized.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    return forward.includes('/../') || forward.includes('/./')
      ? collapsePosixSegments(forward)
      : forward;
  }

  // linux
  if (targetOs === 'linux') {
    const forward = unicodeNormalized.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
    return forward.includes('/../') || forward.includes('/./')
      ? collapsePosixSegments(forward)
      : forward;
  }

  // windows
  if (unicodeNormalized.startsWith('\\\\?\\')) {
    return unicodeNormalized;
  }
  const winPath = unicodeNormalized.replace(/\//g, '\\');
  const isUnc = winPath.startsWith('\\\\');
  const collapsed = collapseWindowsSegments(
    isUnc
      ? '\\\\' + winPath.slice(2).replace(/\\{2,}/g, '\\')
      : winPath.replace(/\\{2,}/g, '\\')
  );

  if (collapsed.length >= WINDOWS_MAX_PATH_THRESHOLD) {
    if (isUnc) {
      return `\\\\?\\UNC\\${collapsed.slice(2)}`;
    }
    if (/^[A-Za-z]:\\/.test(collapsed)) {
      return `\\\\?\\${collapsed}`;
    }
    throw new MolBioCraftError(
      'ERR_PATH_TOO_LONG',
      `Relative Windows path (${collapsed.length} chars) exceeds MAX_PATH and cannot use the \\\\?\\ prefix without an absolute drive or UNC root.`,
      'windows',
      { length: collapsed.length }
    );
  }
  return collapsed;
}

/**
 * Resolve standard OS-specific application storage directories:
 * - macOS: ~/Library/Application Support/org.molbiocraft.desktop (App Sandbox compliant)
 * - Windows: %APPDATA%\MolBioCraft, %LOCALAPPDATA%\MolBioCraft, and HKCU\Software\MolBioCraft
 * - Linux: XDG Base Directory Specification ($XDG_CONFIG_HOME, $XDG_DATA_HOME, $XDG_STATE_HOME, $XDG_CACHE_HOME)
 */
export function resolveAppDirectories(
  os: SupportedOS,
  homeOrEnv: PlatformEnvironmentVars = {}
): PlatformAppDirectories {
  // macos
  if (os === 'macos') {
    const home = (homeOrEnv.home || '/Users/user').replace(/\/+$/, '');
    const bundleId = 'org.molbiocraft.desktop';
    const support = `${home}/Library/Application Support/${bundleId}`;
    return {
      appSupportDir: support,
      dataDir: `${support}/Workspaces`,
      logsDir: `${home}/Library/Logs/${bundleId}`,
      cacheDir: `${home}/Library/Caches/${bundleId}`,
      tempDir: `${home}/Library/Caches/${bundleId}/tmp`,
    };
  }

  // windows
  if (os === 'windows') {
    const roaming = (homeOrEnv.appData || 'C:\\Users\\Default\\AppData\\Roaming').replace(
      /[\\/]+$/,
      ''
    );
    const local = (homeOrEnv.localAppData || 'C:\\Users\\Default\\AppData\\Local').replace(
      /[\\/]+$/,
      ''
    );
    return {
      appSupportDir: `${roaming}\\MolBioCraft`,
      dataDir: `${local}\\MolBioCraft\\Data`,
      logsDir: `${local}\\MolBioCraft\\Logs`,
      cacheDir: `${local}\\MolBioCraft\\Cache`,
      tempDir: `${local}\\Temp\\MolBioCraft`,
      registryRootKey: 'HKCU\\Software\\MolBioCraft',
    };
  }

  // linux
  const linuxHome = (homeOrEnv.home || '/home/user').replace(/\/+$/, '');
  const xdgConfig = (homeOrEnv.xdgConfigHome || `${linuxHome}/.config`).replace(/\/+$/, '');
  const xdgData = (homeOrEnv.xdgDataHome || `${linuxHome}/.local/share`).replace(/\/+$/, '');
  const xdgState = (homeOrEnv.xdgStateHome || `${linuxHome}/.local/state`).replace(/\/+$/, '');
  const xdgCache = (homeOrEnv.xdgCacheHome || `${linuxHome}/.cache`).replace(/\/+$/, '');
  const xdgRuntime = homeOrEnv.xdgRuntimeDir
    ? homeOrEnv.xdgRuntimeDir.replace(/\/+$/, '')
    : '/tmp';

  return {
    appSupportDir: `${xdgConfig}/molbiocraft`,
    dataDir: `${xdgData}/molbiocraft`,
    logsDir: `${xdgState}/molbiocraft/logs`,
    cacheDir: `${xdgCache}/molbiocraft`,
    tempDir: `${xdgRuntime}/molbiocraft`,
    desktopEntryPath: `${xdgData}/applications/molbiocraft.desktop`,
  };
}

// macos
class MacOSPlatformAdapter implements PlatformAdapter {
  public readonly os: SupportedOS = 'macos';
  public readonly filesystemCaseSensitive = false;
  public readonly pathSeparator = '/' as const;
  public readonly defaultLineEnding = 'LF' as const;
  public readonly windowChrome: WindowChromeConventions = {
    menuBarLocation: 'system-top-bar',
    windowControlsSide: 'left-traffic-lights',
    trayBackend: 'NSStatusBar / NSStatusItem (macOS Menu Bar Extra)',
    notificationBackend: 'UNUserNotificationCenter (macOS Notification Center)',
    installerFormats: ['Universal .dmg (arm64 + x86_64)', 'Signed & Sandboxed .app Bundle'],
    filesystemSummary: 'APFS (Case-insensitive, case-preserving by default; NFC/NFD Unicode safe)',
  };

  public resolveDirectories(env: PlatformEnvironmentVars = {}): PlatformAppDirectories {
    return resolveAppDirectories('macos', env);
  }

  public normalizePath(rawPath: string): string {
    return normalizeCrossPlatformPath(rawPath, 'macos');
  }

  public formatShortcut(key: string, modifiers?: ShortcutModifiers): string {
    return formatPlatformShortcut(key, 'macos', modifiers);
  }

  public validatePathAccess(
    targetPath: string,
    env: PlatformEnvironmentVars = {},
    securityScopedBookmarks: string[] = []
  ): { allowed: true; normalizedPath: string } {
    const norm = this.normalizePath(targetPath);

    // Mounted .dmg installer volumes on macOS are read-only (EROFS)
    if (norm.startsWith('/Volumes/MolBioCraft')) {
      throw new MolBioCraftError(
        'ERR_READ_ONLY_FILESYSTEM',
        `Cannot write to read-only macOS disk image volume "${norm}". Drag MolBioCraft.app to /Applications first.`,
        'macos',
        { path: norm }
      );
    }

    // System Integrity Protection (SIP) & root system directories
    if (norm.startsWith('/System/') || norm.startsWith('/usr/bin/') || norm.startsWith('/sbin/')) {
      throw new MolBioCraftError(
        'ERR_PERMISSION_DENIED',
        `macOS System Integrity Protection (SIP) prohibits writing to "${norm}".`,
        'macos',
        { path: norm }
      );
    }

    if (env.sandboxEnabled) {
      const dirs = this.resolveDirectories(env);
      const allowedRoots = [
        dirs.appSupportDir,
        dirs.logsDir,
        dirs.cacheDir,
        dirs.tempDir,
        ...securityScopedBookmarks.map((b) => this.normalizePath(b).replace(/\/+$/, '')),
      ];
      const permitted = allowedRoots.some(
        (root) => norm === root || norm.startsWith(`${root}/`)
      );
      if (!permitted) {
        throw new MolBioCraftError(
          'ERR_SANDBOX_VIOLATION',
          `macOS App Sandbox blocks direct file access to "${norm}" without an NSOpenPanel/NSSavePanel Security-Scoped Bookmark.`,
          'macos',
          { path: norm, allowedContainer: dirs.appSupportDir }
        );
      }
    }

    return { allowed: true, normalizedPath: norm };
  }
}

// windows
class WindowsPlatformAdapter implements PlatformAdapter {
  public readonly os: SupportedOS = 'windows';
  public readonly filesystemCaseSensitive = false;
  public readonly pathSeparator = '\\' as const;
  public readonly defaultLineEnding = 'CRLF' as const;
  public readonly windowChrome: WindowChromeConventions = {
    menuBarLocation: 'in-window-top',
    windowControlsSide: 'right-caption-buttons',
    trayBackend: 'Shell_NotifyIconW (Win32 Notification Area / System Tray)',
    notificationBackend: 'Windows Toast Notification XML (WinRT ToastNotificationManager)',
    installerFormats: ['NSIS 64-bit Setup (.exe)', 'Windows Installer 64-bit (.msi)'],
    filesystemSummary: 'NTFS (Case-insensitive, MAX_PATH \\\\?\\ extended-length & sharing-lock aware)',
  };

  public resolveDirectories(env: PlatformEnvironmentVars = {}): PlatformAppDirectories {
    return resolveAppDirectories('windows', env);
  }

  public normalizePath(rawPath: string): string {
    return normalizeCrossPlatformPath(rawPath, 'windows');
  }

  public formatShortcut(key: string, modifiers?: ShortcutModifiers): string {
    return formatPlatformShortcut(key, 'windows', modifiers);
  }

  public validatePathAccess(
    targetPath: string,
    _env: PlatformEnvironmentVars = {},
    _grantedPaths: string[] = []
  ): { allowed: true; normalizedPath: string } {
    const norm = this.normalizePath(targetPath);
    const stripped = norm.replace(/^\\\\\?\\/, '');
    if (
      /^C:\\Windows(\\|$)/i.test(stripped) ||
      /^C:\\Program Files(\\|$)/i.test(stripped) ||
      /^C:\\Program Files \(x86\)(\\|$)/i.test(stripped)
    ) {
      throw new MolBioCraftError(
        'ERR_PERMISSION_DENIED',
        `Windows UAC prohibits standard user writes to protected directory "${norm}". Use %APPDATA%\\MolBioCraft or a user workspace folder.`,
        'windows',
        { path: norm }
      );
    }
    return { allowed: true, normalizedPath: norm };
  }
}

// linux
class LinuxPlatformAdapter implements PlatformAdapter {
  public readonly os: SupportedOS = 'linux';
  public readonly filesystemCaseSensitive = true;
  public readonly pathSeparator = '/' as const;
  public readonly defaultLineEnding = 'LF' as const;
  public readonly windowChrome: WindowChromeConventions = {
    menuBarLocation: 'in-window-top',
    windowControlsSide: 'freedesktop-wm',
    trayBackend: 'org.kde.StatusNotifierItem / Ayatana AppIndicator (D-Bus)',
    notificationBackend: 'org.freedesktop.Notifications (D-Bus Desktop Notifications)',
    installerFormats: ['Debian/Ubuntu (.deb)', 'Fedora/RHEL (.rpm)', 'Portable AppImage'],
    filesystemSummary: 'EXT4 / XFS / Btrfs on LVM (Strictly case-sensitive POSIX; XDG Base Dir compliant)',
  };

  public resolveDirectories(env: PlatformEnvironmentVars = {}): PlatformAppDirectories {
    return resolveAppDirectories('linux', env);
  }

  public normalizePath(rawPath: string): string {
    return normalizeCrossPlatformPath(rawPath, 'linux');
  }

  public formatShortcut(key: string, modifiers?: ShortcutModifiers): string {
    return formatPlatformShortcut(key, 'linux', modifiers);
  }

  public validatePathAccess(
    targetPath: string,
    env: PlatformEnvironmentVars = {},
    portalGrantedPaths: string[] = []
  ): { allowed: true; normalizedPath: string } {
    const norm = this.normalizePath(targetPath);
    if (norm.startsWith('/proc/') || norm.startsWith('/sys/')) {
      throw new MolBioCraftError(
        'ERR_READ_ONLY_FILESYSTEM',
        `Linux kernel virtual filesystem "${norm}" does not support regular sequence file persistence.`,
        'linux',
        { path: norm }
      );
    }
    if (
      norm.startsWith('/usr/') ||
      norm.startsWith('/etc/') ||
      norm.startsWith('/opt/molbiocraft/') ||
      norm.startsWith('/sbin/')
    ) {
      throw new MolBioCraftError(
        'ERR_PERMISSION_DENIED',
        `Linux non-root user cannot modify system package directory "${norm}". Write to $XDG_DATA_HOME/molbiocraft or user home instead.`,
        'linux',
        { path: norm }
      );
    }
    if (env.flatpakId) {
      const dirs = this.resolveDirectories(env);
      const allowedRoots = [
        dirs.appSupportDir,
        dirs.dataDir,
        dirs.logsDir,
        dirs.cacheDir,
        dirs.tempDir,
        ...portalGrantedPaths.map((p) => this.normalizePath(p).replace(/\/+$/, '')),
      ];
      const permitted = allowedRoots.some(
        (root) => norm === root || norm.startsWith(`${root}/`)
      );
      if (!permitted) {
        throw new MolBioCraftError(
          'ERR_SANDBOX_VIOLATION',
          `Linux Flatpak sandbox (${env.flatpakId}) requires org.freedesktop.portal.FileChooser authorization for "${norm}".`,
          'linux',
          { path: norm, flatpakId: env.flatpakId }
        );
      }
    }
    return { allowed: true, normalizedPath: norm };
  }
}

/**
 * Factory returning the clean OS-specific PlatformAdapter for macOS, Windows, or Linux.
 */
export function createPlatformAdapter(os: SupportedOS = detectHostOS()): PlatformAdapter {
  // macos
  if (os === 'macos') {
    return new MacOSPlatformAdapter();
  }
  // windows
  if (os === 'windows') {
    return new WindowsPlatformAdapter();
  }
  // linux
  return new LinuxPlatformAdapter();
}

/**
 * Validate a sequence/plasmid filename for macOS (APFS), Windows (NTFS), and Linux (EXT4/XFS/LVM).
 * - Normalizes Unicode to NFC (prevents macOS NFD vs Windows/Linux NFC duplicate-file drift).
 * - Rejects Windows reserved DOS device names (CON, PRN, AUX, NUL, COM1-9, LPT1-9, superscripts),
 *   illegal punctuation, control characters, and trailing dots/spaces.
 * - Evaluates both exact collisions and case-sensitivity portability warnings across APFS, NTFS, and EXT4/XFS.
 */
const WINDOWS_RESERVED_NAMES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  'COM1',
  'COM2',
  'COM3',
  'COM4',
  'COM5',
  'COM6',
  'COM7',
  'COM8',
  'COM9',
  'COM\u00B9',
  'COM\u00B2',
  'COM\u00B3',
  'LPT1',
  'LPT2',
  'LPT3',
  'LPT4',
  'LPT5',
  'LPT6',
  'LPT7',
  'LPT8',
  'LPT9',
  'LPT\u00B9',
  'LPT\u00B2',
  'LPT\u00B3',
]);

export function validateCrossPlatformFilename(
  filename: string,
  existingFilenames: string[] = [],
  hostOs: SupportedOS = detectHostOS()
): {
  valid: true;
  sanitized: string;
  exactCollision?: boolean;
  caseCollisionWarning?: string;
} {
  const nfcRaw = filename.normalize('NFC');
  const trimmed = nfcRaw.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new MolBioCraftError(
      'ERR_INVALID_FILENAME',
      'Filename cannot be empty or a relative directory token.',
      hostOs
    );
  }

  if (/[<>:"/\\|?*\x00-\x1F]/.test(trimmed)) {
    throw new MolBioCraftError(
      'ERR_INVALID_FILENAME',
      `Filename "${filename}" contains characters forbidden across Windows NTFS, macOS APFS, or Linux POSIX filesystems.`,
      hostOs
    );
  }

  if (nfcRaw.endsWith('.') || nfcRaw.endsWith(' ')) {
    throw new MolBioCraftError(
      'ERR_INVALID_FILENAME',
      `Filename "${filename}" cannot end with a trailing period or space on Windows.`,
      hostOs
    );
  }

  // UTF-8 byte length check (255 bytes max filename component on Linux EXT4/XFS and macOS APFS)
  const utf8ByteLen = new TextEncoder().encode(trimmed).byteLength;
  if (utf8ByteLen > 255) {
    throw new MolBioCraftError(
      'ERR_PATH_TOO_LONG',
      `Filename "${trimmed.slice(0, 32)}..." (${utf8ByteLen} UTF-8 bytes) exceeds the 255-byte component limit on Linux EXT4/XFS and macOS APFS.`,
      hostOs,
      { utf8ByteLen }
    );
  }

  const stem = trimmed.split('.')[0].toUpperCase();
  if (WINDOWS_RESERVED_NAMES.has(stem)) {
    throw new MolBioCraftError(
      'ERR_WINDOWS_RESERVED_NAME',
      `Filename "${filename}" uses a reserved Windows DOS device name (${stem}).`,
      hostOs
    );
  }

  const normalizedExisting = existingFilenames.map((f) => f.normalize('NFC'));
  const exactCollision = normalizedExisting.includes(trimmed);
  const lowerCandidate = trimmed.toLowerCase();
  const caseOnlyCollision = normalizedExisting.find(
    (existing) => existing !== trimmed && existing.toLowerCase() === lowerCandidate
  );

  let caseCollisionWarning: string | undefined;
  if (caseOnlyCollision) {
    // linux: EXT4/XFS allows both files simultaneously, which breaks git/cloud sync to macOS & Windows
    if (hostOs === 'linux') {
      caseCollisionWarning = `Linux EXT4/XFS is case-sensitive and permits "${trimmed}" alongside "${caseOnlyCollision}", which will collide on macOS APFS and Windows NTFS.`;
    } else {
      caseCollisionWarning = `Case-insensitive collision with existing file "${caseOnlyCollision}" on APFS/NTFS.`;
    }
  }

  return {
    valid: true,
    sanitized: trimmed,
    exactCollision: exactCollision || undefined,
    caseCollisionWarning,
  };
}

/**
 * Turn an arbitrary, data-derived name (document names such as UniProt
 * "sp|P69905|HBA_HUMAN" or region ids "chr1:100-200") into a filename that
 * passes `validateCrossPlatformFilename` on every supported OS. Unlike the
 * validator, which rejects user-typed names, this never throws: forbidden
 * characters become "_", trailing dots/spaces are trimmed, Windows device
 * names are prefixed, and the stem is shortened (keeping the extension) to
 * fit the 255-byte component limit.
 */
export function sanitizeExportFilename(filename: string, fallback = 'MolBioCraft_Export'): string {
  const nfc = String(filename ?? '').normalize('NFC');
  let cleaned = nfc
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim()
    .replace(/[. ]+$/, '');
  if (!cleaned || cleaned === '.' || cleaned === '..') cleaned = fallback;

  const dot = cleaned.lastIndexOf('.');
  const hasExt = dot > 0 && dot >= cleaned.length - 12;
  let stem = hasExt ? cleaned.slice(0, dot) : cleaned;
  const ext = hasExt ? cleaned.slice(dot) : '';
  if (!stem.replace(/[_ .]/g, '')) stem = fallback;
  if (WINDOWS_RESERVED_NAMES.has(stem.split('.')[0].toUpperCase())) stem = `_${stem}`;

  const encoder = new TextEncoder();
  const extBytes = encoder.encode(ext).byteLength;
  while (stem.length > 1 && encoder.encode(stem).byteLength + extBytes > 255) {
    // Drop whole code points so a surrogate pair is never split.
    stem = Array.from(stem).slice(0, -1).join('');
  }
  stem = stem.replace(/[. ]+$/, '') || fallback;
  return `${stem}${ext}`;
}

/**
 * Normalize line endings consistently across CRLF (Windows) and LF (macOS/Linux POSIX).
 */
export function normalizeLineEndings(
  content: string,
  targetEnding: 'LF' | 'CRLF' = 'LF'
): string {
  const lfNormalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  return targetEnding === 'CRLF' ? lfNormalized.replace(/\n/g, '\r\n') : lfNormalized;
}

/**
 * Classify native OS I/O errors into specific, non-generic MolBioCraftError codes.
 */
export function classifyNativeFsError(
  err: unknown,
  operationName: string,
  os: SupportedOS = detectHostOS()
): MolBioCraftError {
  if (err instanceof MolBioCraftError) {
    return err;
  }
  const msg = err instanceof Error ? err.message : String(err);
  const codeProp = (err as { code?: string })?.code ?? '';
  const combined = `${codeProp} ${msg}`;

  if (
    combined.includes('EBUSY') ||
    combined.includes('EAGAIN') ||
    combined.includes('EWOULDBLOCK') ||
    combined.includes('ERROR_SHARING_VIOLATION') ||
    combined.includes('ERROR_LOCK_VIOLATION') ||
    combined.toLowerCase().includes('locked')
  ) {
    return new MolBioCraftError(
      'ERR_FILE_LOCKED',
      `File is locked by another process during "${operationName}": ${msg}`,
      os
    );
  }

  if (combined.includes('EROFS') || combined.toLowerCase().includes('read-only file system')) {
    return new MolBioCraftError(
      'ERR_READ_ONLY_FILESYSTEM',
      `Read-only filesystem encountered during "${operationName}": ${msg}`,
      os
    );
  }

  if (
    combined.includes('ERR_SANDBOX') ||
    combined.toLowerCase().includes('security-scoped') ||
    combined.toLowerCase().includes('app sandbox')
  ) {
    return new MolBioCraftError(
      'ERR_SANDBOX_VIOLATION',
      `Sandbox security policy blocked "${operationName}": ${msg}`,
      os
    );
  }

  if (
    combined.includes('EACCES') ||
    combined.includes('EPERM') ||
    combined.includes('ACCESS_DENIED') ||
    combined.toLowerCase().includes('permission denied')
  ) {
    return new MolBioCraftError(
      'ERR_PERMISSION_DENIED',
      `OS permission denied during "${operationName}": ${msg}`,
      os
    );
  }

  if (combined.includes('ENAMETOOLONG') || combined.includes('FILENAME_EXCED_RANGE')) {
    return new MolBioCraftError(
      'ERR_PATH_TOO_LONG',
      `Path length limit exceeded during "${operationName}": ${msg}`,
      os
    );
  }

  return new MolBioCraftError(
    'ERR_INVALID_FILENAME',
    `I/O failure during "${operationName}": ${msg}`,
    os
  );
}

/**
 * Asynchronous file operation wrapper with exponential backoff for transient file locking
 * (Windows ERROR_SHARING_VIOLATION / POSIX EAGAIN / EBUSY) and immediate fail-fast
 * classification for permission/sandbox/read-only errors.
 */
export async function executeWithFileLockRetry<T>(
  operationName: string,
  task: () => Promise<T>,
  maxRetries = 3,
  baseDelayMs = 60,
  os: SupportedOS = detectHostOS()
): Promise<T> {
  let attempt = 0;
  while (true) {
    try {
      return await task();
    } catch (err) {
      attempt++;
      const classified = classifyNativeFsError(err, operationName, os);
      const isTransientLock = classified.code === 'ERR_FILE_LOCKED';

      if (!isTransientLock || attempt > maxRetries) {
        Logger.error('FileIO', `Operation "${operationName}" failed after ${attempt} attempt(s)`, {
          code: classified.code,
          os,
          error: classified.message,
        });
        if (
          isTransientLock ||
          classified.code === 'ERR_PERMISSION_DENIED' ||
          classified.code === 'ERR_SANDBOX_VIOLATION' ||
          classified.code === 'ERR_READ_ONLY_FILESYSTEM' ||
          classified.code === 'ERR_PATH_TOO_LONG'
        ) {
          throw classified;
        }
        throw err;
      }

      const waitMs = baseDelayMs * Math.pow(2, attempt - 1);
      Logger.warn(
        'FileIO',
        `Transient file lock detected in "${operationName}" (attempt ${attempt}/${maxRetries}); retrying in ${waitMs}ms`,
        { os }
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
}

/**
 * Deterministic resource lifecycle guard preventing file-handle, stream, or DB cursor leaks.
 * Guarantees `resource.close()` runs even when the async consumer throws or cancels.
 */
export interface ManagedClosable {
  close: () => void | Promise<void>;
}

export async function withManagedResource<R extends ManagedClosable, T>(
  resourceName: string,
  acquire: () => R | Promise<R>,
  consume: (resource: R) => Promise<T>
): Promise<T> {
  const resource = await acquire();
  Logger.debug('ResourceGuard', `Acquired resource "${resourceName}"`);
  try {
    return await consume(resource);
  } finally {
    try {
      await resource.close();
      Logger.debug('ResourceGuard', `Closed resource "${resourceName}" cleanly`);
    } catch (closeErr) {
      Logger.warn('ResourceGuard', `Non-fatal error while closing "${resourceName}"`, {
        error: closeErr instanceof Error ? closeErr.message : String(closeErr),
      });
    }
  }
}

/**
 * Yield back to the browser/WebView UI thread without 4ms nested setTimeout throttling
 * so multi-step bioinformatics computations never freeze the desktop interface.
 */
export function yieldToUiThread(): Promise<void> {
  if (typeof MessageChannel !== 'undefined') {
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        channel.port1.close();
        channel.port2.close();
        resolve();
      };
      channel.port2.postMessage(null);
    });
  }
  return new Promise((resolve) => setTimeout(resolve, 0));
}

export interface AsyncBioTaskContext {
  signal?: AbortSignal;
  checkpoint: (stageLabel: string, progressPct: number) => Promise<void>;
}

export interface AsyncBioTaskResult<T> {
  taskName: string;
  elapsedMs: number;
  data: T;
}

/**
 * Execute an asynchronous multi-stage bioinformatics computation with UI-thread yielding,
 * AbortSignal cancellation, and structured INFO/ERROR telemetry.
 */
export async function runAsyncBioTask<T>(
  taskName: string,
  worker: (ctx: AsyncBioTaskContext) => Promise<T>,
  options: {
    signal?: AbortSignal;
    onProgress?: (stageLabel: string, progressPct: number) => void;
  } = {}
): Promise<AsyncBioTaskResult<T>> {
  const start = performance.now();
  if (options.signal?.aborted) {
    throw new MolBioCraftError(
      'ERR_TASK_ABORTED',
      `Bioinformatics task "${taskName}" was aborted prior to start.`
    );
  }

  Logger.info('BioTaskRunner', `Starting async task "${taskName}"`);

  const checkpoint = async (stageLabel: string, progressPct: number) => {
    if (options.signal?.aborted) {
      Logger.warn('BioTaskRunner', `Task "${taskName}" aborted at stage "${stageLabel}"`);
      throw new MolBioCraftError(
        'ERR_TASK_ABORTED',
        `Bioinformatics task "${taskName}" cancelled during "${stageLabel}".`
      );
    }
    options.onProgress?.(stageLabel, Math.max(0, Math.min(100, progressPct)));
    await yieldToUiThread();
  };

  try {
    await yieldToUiThread();
    const data = await worker({ signal: options.signal, checkpoint });
    const elapsedMs = Number((performance.now() - start).toFixed(2));
    Logger.info('BioTaskRunner', `Completed async task "${taskName}" in ${elapsedMs}ms`, {
      elapsedMs,
    });
    return { taskName, elapsedMs, data };
  } catch (err) {
    const elapsedMs = Number((performance.now() - start).toFixed(2));
    if (err instanceof MolBioCraftError && err.code === 'ERR_TASK_ABORTED') {
      throw err;
    }
    Logger.error('BioTaskRunner', `Task "${taskName}" failed after ${elapsedMs}ms`, {
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

/**
 * Tri-state color-scheme manager (`system` | `light` | `dark`) syncing `<meta name="color-scheme">`
 * and `localStorage["color-scheme"]` without deleting user overrides when OS preference shifts.
 */
export const COLOR_SCHEME_STORAGE_KEY = 'color-scheme';

export function readStoredThemePreference(): ThemePreference {
  try {
    const stored =
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)
        : null;
    if (stored === 'light' || stored === 'dark') {
      return stored;
    }
  } catch {
    // Blocked storage falls back cleanly to system preference
  }
  return 'system';
}

export function resolveEffectiveDarkMode(preference: ThemePreference): boolean {
  if (preference === 'dark') return true;
  if (preference === 'light') return false;
  if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  return false;
}

export function applyPlatformColorScheme(preference: ThemePreference): boolean {
  const metaContent = preference === 'system' ? 'light dark' : preference;
  if (typeof document !== 'undefined') {
    let meta = document.querySelector('meta[name="color-scheme"]') as HTMLMetaElement | null;
    if (!meta && document.head) {
      meta = document.createElement('meta');
      meta.name = 'color-scheme';
      document.head.appendChild(meta);
    }
    if (meta) {
      meta.content = metaContent;
    }
  }

  try {
    if (typeof localStorage !== 'undefined') {
      if (preference === 'system') {
        localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY);
      } else {
        localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, preference);
      }
    }
  } catch {
    // Ignore storage quota / sandbox restrictions; page theme still updates
  }

  return resolveEffectiveDarkMode(preference);
}

/**
 * Subscribe to OS dark/light mode changes (`prefers-color-scheme: dark`) and cross-window
 * `storage` updates. Returns a deterministic cleanup function to prevent listener leaks.
 */
export function subscribeSystemColorScheme(
  onSystemOrStorageChange: (systemIsDark: boolean, storedPref: ThemePreference) => void
): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return () => {};
  }
  const mql = window.matchMedia('(prefers-color-scheme: dark)');
  const handleMediaChange = (e: MediaQueryListEvent) => {
    onSystemOrStorageChange(e.matches, readStoredThemePreference());
  };
  const handleStorageChange = (e: StorageEvent) => {
    if (e.key === COLOR_SCHEME_STORAGE_KEY || e.key === null) {
      onSystemOrStorageChange(mql.matches, readStoredThemePreference());
    }
  };

  mql.addEventListener('change', handleMediaChange);
  window.addEventListener('storage', handleStorageChange);

  return () => {
    mql.removeEventListener('change', handleMediaChange);
    window.removeEventListener('storage', handleStorageChange);
  };
}

/**
 * Dispatch a non-intrusive OS desktop notification (macOS UNUserNotificationCenter,
 * Windows Toast, Linux org.freedesktop.Notifications via Web/Tauri Notification API)
 * with graceful fallback to structured workspace logging when permission is not granted.
 */
export async function dispatchDesktopNotification(
  title: string,
  body: string
): Promise<{ deliveredVia: 'native-os-notification' | 'in-app-banner' }> {
  Logger.info('DesktopNotify', `${title} — ${body}`);
  if (typeof window !== 'undefined' && 'Notification' in window) {
    try {
      if (Notification.permission === 'granted') {
        new Notification(title, { body, silent: true });
        return { deliveredVia: 'native-os-notification' };
      }
    } catch {
      // Fall back to in-app status banner inside sandboxed WebViews
    }
  }
  return { deliveredVia: 'in-app-banner' };
}
