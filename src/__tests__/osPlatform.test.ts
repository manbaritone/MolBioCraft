// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import {
  createPlatformAdapter,
  detectCpuArch,
  detectHostOS,
  executeWithFileLockRetry,
  formatPlatformShortcut,
  isPlatformPrimaryModifier,
  MolBioCraftError,
  normalizeCrossPlatformPath,
  normalizeLineEndings,
  resolveAppDirectories,
  runAsyncBioTask,
  validateCrossPlatformFilename,
  withManagedResource,
} from '../platform/osPlatform';

describe('Cross-Platform OS Abstraction Layer (macOS, Windows & Linux)', () => {
  it('detects macOS, Windows, and Linux hosts, CPU architectures, and formats native shortcuts', () => {
    expect(detectHostOS('Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5)')).toBe('macos');
    expect(detectHostOS('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('windows');
    expect(detectHostOS('Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:131.0)')).toBe('linux');

    expect(detectCpuArch('arm64')).toBe('arm64');
    expect(detectCpuArch('x86_64')).toBe('x86_64');
    // Regression: "AppleWebKit" in every browser UA used to mean arm64.
    expect(
      detectCpuArch('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36')
    ).toBe('x86_64');
    expect(
      detectCpuArch('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15')
    ).toBe('unknown');

    // macOS HIG symbols vs Windows/Linux chord labels
    expect(formatPlatformShortcut('O', 'macos')).toBe('⌘O');
    expect(formatPlatformShortcut('Shift+M', 'macos')).toBe('⇧⌘M');
    expect(formatPlatformShortcut('S', 'macos', { alt: true })).toBe('⌥⌘S');

    expect(formatPlatformShortcut('O', 'windows')).toBe('Ctrl+O');
    expect(formatPlatformShortcut('Shift+M', 'windows')).toBe('Ctrl+Shift+M');
    expect(formatPlatformShortcut('Shift+M', 'linux')).toBe('Ctrl+Shift+M');
    expect(formatPlatformShortcut('S', 'linux', { alt: true })).toBe('Ctrl+Alt+S');

    // Primary command modifier matching (Cmd on macOS vs Ctrl on Windows/Linux)
    expect(isPlatformPrimaryModifier({ metaKey: true, ctrlKey: false }, 'macos')).toBe(true);
    expect(isPlatformPrimaryModifier({ metaKey: false, ctrlKey: true }, 'macos')).toBe(false);
    expect(isPlatformPrimaryModifier({ metaKey: false, ctrlKey: true }, 'windows')).toBe(true);
    expect(isPlatformPrimaryModifier({ metaKey: false, ctrlKey: true }, 'linux')).toBe(true);
  });

  it('resolves macOS App Sandbox, Windows AppData + Registry, and Linux XDG Base Directories', () => {
    // macos
    const macDirs = resolveAppDirectories('macos', { home: '/Users/researcher' });
    expect(macDirs.appSupportDir).toBe(
      '/Users/researcher/Library/Application Support/org.molbiocraft.desktop'
    );
    expect(macDirs.logsDir).toBe('/Users/researcher/Library/Logs/org.molbiocraft.desktop');

    // windows
    const winDirs = resolveAppDirectories('windows', {
      appData: 'C:\\Users\\researcher\\AppData\\Roaming',
      localAppData: 'C:\\Users\\researcher\\AppData\\Local',
    });
    expect(winDirs.appSupportDir).toBe('C:\\Users\\researcher\\AppData\\Roaming\\MolBioCraft');
    expect(winDirs.logsDir).toBe('C:\\Users\\researcher\\AppData\\Local\\MolBioCraft\\Logs');
    expect(winDirs.registryRootKey).toBe('HKCU\\Software\\MolBioCraft');

    // linux (XDG Base Directory Specification)
    const linuxDirs = resolveAppDirectories('linux', {
      home: '/home/biologist',
      xdgConfigHome: '/home/biologist/.config',
      xdgDataHome: '/home/biologist/.local/share',
      xdgStateHome: '/home/biologist/.local/state',
      xdgCacheHome: '/home/biologist/.cache',
      xdgRuntimeDir: '/run/user/1000',
    });
    expect(linuxDirs.appSupportDir).toBe('/home/biologist/.config/molbiocraft');
    expect(linuxDirs.dataDir).toBe('/home/biologist/.local/share/molbiocraft');
    expect(linuxDirs.logsDir).toBe('/home/biologist/.local/state/molbiocraft/logs');
    expect(linuxDirs.cacheDir).toBe('/home/biologist/.cache/molbiocraft');
    expect(linuxDirs.tempDir).toBe('/run/user/1000/molbiocraft');
    expect(linuxDirs.desktopEntryPath).toBe(
      '/home/biologist/.local/share/applications/molbiocraft.desktop'
    );
  });

  it('normalizes slashes, resolves relative segments, and applies Win32 \\\\?\\ and \\\\?\\UNC\\ prefixes safely', () => {
    // macos & linux success
    expect(
      normalizeCrossPlatformPath('/Volumes/LabDrive//Constructs/../Vectors\\pET28a.gb', 'macos')
    ).toBe('/Volumes/LabDrive/Vectors/pET28a.gb');
    expect(
      normalizeCrossPlatformPath('/mnt/lvm_bio//projects/./crispr\\guide.fasta', 'linux')
    ).toBe('/mnt/lvm_bio/projects/crispr/guide.fasta');

    // windows standard path success
    expect(
      normalizeCrossPlatformPath('C:/Users/Lab/Documents//Plasmids/../pUC19.gb', 'windows')
    ).toBe('C:\\Users\\Lab\\Documents\\pUC19.gb');

    // windows MAX_PATH (>= 248 chars) extended-length drive & UNC prefix success
    const longFolder = 'A'.repeat(255);
    const longWinDrive = normalizeCrossPlatformPath(
      `C:/Users/Lab/Temp/../${longFolder}/pET28a.gb`,
      'windows'
    );
    expect(longWinDrive).toBe(`\\\\?\\C:\\Users\\Lab\\${longFolder}\\pET28a.gb`);

    const longWinUnc = normalizeCrossPlatformPath(
      `//nas-core01/genomics/raw/../${longFolder}/trace.ab1`,
      'windows'
    );
    expect(longWinUnc).toBe(`\\\\?\\UNC\\nas-core01\\genomics\\${longFolder}\\trace.ab1`);

    // Failure states: empty path & relative long path exceeding MAX_PATH
    expect(() => normalizeCrossPlatformPath('   ', 'windows')).toThrowError(MolBioCraftError);
    expect(() =>
      normalizeCrossPlatformPath(`relative/sub/${longFolder}/construct.gb`, 'windows')
    ).toThrowError(/ERR_PATH_TOO_LONG/);
  });

  it('enforces OS-specific sandbox, read-only mount, and permission guards via PlatformAdapter factory', () => {
    // macos adapter: App Sandbox & read-only DMG detection
    const mac = createPlatformAdapter('macos');
    expect(mac.filesystemCaseSensitive).toBe(false);
    expect(
      mac.validatePathAccess(
        '/Users/lab/Library/Application Support/org.molbiocraft.desktop/session.mbc',
        { home: '/Users/lab', sandboxEnabled: true }
      ).allowed
    ).toBe(true);
    expect(() =>
      mac.validatePathAccess('/Users/lab/Desktop/unbookmarked.gb', {
        home: '/Users/lab',
        sandboxEnabled: true,
      })
    ).toThrowError(/ERR_SANDBOX_VIOLATION/);
    expect(() => mac.validatePathAccess('/Volumes/MolBioCraft/MolBioCraft.app')).toThrowError(
      /ERR_READ_ONLY_FILESYSTEM/
    );

    // windows adapter: UAC protected system directory guard
    const win = createPlatformAdapter('windows');
    expect(win.defaultLineEnding).toBe('CRLF');
    expect(() => win.validatePathAccess('C:\\Program Files\\MolBioCraft\\write.gb')).toThrowError(
      /ERR_PERMISSION_DENIED/
    );

    // linux adapter: case-sensitive POSIX + /proc read-only + /usr permission + Flatpak portal guard
    const linux = createPlatformAdapter('linux');
    expect(linux.filesystemCaseSensitive).toBe(true);
    expect(() => linux.validatePathAccess('/proc/self/mem')).toThrowError(
      /ERR_READ_ONLY_FILESYSTEM/
    );
    expect(() => linux.validatePathAccess('/usr/share/molbiocraft/vectors.gb')).toThrowError(
      /ERR_PERMISSION_DENIED/
    );
    expect(() =>
      linux.validatePathAccess('/home/lab/Documents/plasmid.gb', {
        home: '/home/lab',
        flatpakId: 'org.molbiocraft.desktop',
      })
    ).toThrowError(/ERR_SANDBOX_VIOLATION/);
    expect(
      linux.validatePathAccess(
        '/home/lab/Documents/plasmid.gb',
        { home: '/home/lab', flatpakId: 'org.molbiocraft.desktop' },
        ['/home/lab/Documents']
      ).allowed
    ).toBe(true);
  });

  it('normalizes NFD/NFC Unicode filenames, enforces 255-byte limits, and distinguishes Linux EXT4 vs APFS/NTFS casing', () => {
    // Decomposed NFD ("e\u0301") normalized to composed NFC ("\u00E9")
    const nfdName = 'Cafe\u0301_Vector.gb';
    const nfcRes = validateCrossPlatformFilename(nfdName, [], 'macos');
    expect(nfcRes.sanitized).toBe('Caf\u00E9_Vector.gb');

    // Case collision warning on macOS/Windows vs cross-OS portability warning on Linux EXT4/XFS
    const macWarn = validateCrossPlatformFilename('pUC19.gb', ['puc19.gb'], 'macos');
    expect(macWarn.caseCollisionWarning).toContain('APFS/NTFS');

    const linuxWarn = validateCrossPlatformFilename('pUC19.gb', ['puc19.gb'], 'linux');
    expect(linuxWarn.caseCollisionWarning).toContain('Linux EXT4/XFS is case-sensitive');

    // Failure states: Windows reserved device names (including superscript), >255 UTF-8 bytes, illegal chars
    expect(() => validateCrossPlatformFilename('CON.gb')).toThrowError(/ERR_WINDOWS_RESERVED_NAME/);
    expect(() => validateCrossPlatformFilename('COM\u00B9.fasta')).toThrowError(
      /ERR_WINDOWS_RESERVED_NAME/
    );
    expect(() => validateCrossPlatformFilename(`${'A'.repeat(256)}.gb`, [], 'linux')).toThrowError(
      /ERR_PATH_TOO_LONG/
    );
    expect(() => validateCrossPlatformFilename('pET28:eGFP.gb')).toThrowError(
      /ERR_INVALID_FILENAME/
    );
  });

  it('recovers from transient file locks, fails fast on permission errors, and prevents resource leaks', async () => {
    let lockAttempts = 0;
    const recovered = await executeWithFileLockRetry(
      'SaveGenBank',
      async () => {
        lockAttempts++;
        if (lockAttempts === 1) {
          throw new Error('EBUSY: ERROR_SHARING_VIOLATION file locked');
        }
        return 'SAVED_OK';
      },
      3,
      5,
      'windows'
    );
    expect(recovered).toBe('SAVED_OK');
    expect(lockAttempts).toBe(2);

    // Permission denied fails immediately on attempt 1 without wasteful retries
    let permAttempts = 0;
    await expect(
      executeWithFileLockRetry(
        'WriteProtectedDir',
        async () => {
          permAttempts++;
          throw new Error('EACCES: permission denied');
        },
        3,
        5,
        'linux'
      )
    ).rejects.toThrowError(/ERR_PERMISSION_DENIED/);
    expect(permAttempts).toBe(1);

    // Deterministic handle closure on both success and failure
    let closedOnSuccess = false;
    const val = await withManagedResource(
      'SqliteIndexCursor',
      () => ({
        readHeader: () => 'MBC1',
        close: () => {
          closedOnSuccess = true;
        },
      }),
      async (res) => res.readHeader()
    );
    expect(val).toBe('MBC1');
    expect(closedOnSuccess).toBe(true);

    let closedOnFailure = false;
    await expect(
      withManagedResource(
        'Ab1FileStream',
        () => ({
          close: () => {
            closedOnFailure = true;
          },
        }),
        async () => {
          throw new MolBioCraftError('ERR_CORRUPT_PACKET', 'Truncated ABIF directory');
        }
      )
    ).rejects.toThrowError(/ERR_CORRUPT_PACKET/);
    expect(closedOnFailure).toBe(true);
  });

  it('executes non-blocking async bio tasks with progress checkpoints and AbortController cancellation', async () => {
    const stages: string[] = [];
    const okTask = await runAsyncBioTask(
      'TestDigestTask',
      async ({ checkpoint }) => {
        await checkpoint('Stage 1', 50);
        await checkpoint('Stage 2', 100);
        return 42;
      },
      {
        onProgress: (stage) => stages.push(stage),
      }
    );
    expect(okTask.data).toBe(42);
    expect(stages).toEqual(['Stage 1', 'Stage 2']);

    // Failure state: task cancelled mid-flight via AbortController
    const controller = new AbortController();
    await expect(
      runAsyncBioTask(
        'AbortedMsaTask',
        async ({ checkpoint }) => {
          await checkpoint('Pairwise distances', 25);
          controller.abort();
          await checkpoint('Progressive alignment', 75);
          return 'UNREACHABLE';
        },
        { signal: controller.signal }
      )
    ).rejects.toThrowError(/ERR_TASK_ABORTED/);
  });

  it('normalizes CRLF and LF line endings cleanly across Windows and POSIX', () => {
    const mixed = 'LOCUS       pUC19\r\nDEFINITION  Vector\rORIGIN\n//';
    expect(normalizeLineEndings(mixed, 'LF')).toBe(
      'LOCUS       pUC19\nDEFINITION  Vector\nORIGIN\n//'
    );
    expect(normalizeLineEndings(mixed, 'CRLF')).toBe(
      'LOCUS       pUC19\r\nDEFINITION  Vector\r\nORIGIN\r\n//'
    );
  });
});
