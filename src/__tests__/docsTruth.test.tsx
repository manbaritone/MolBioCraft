// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P23W: what README.md and PRODUCT.md say about the app is checked against the app.
 *
 * - AC1: every row of README's "Keyboard Shortcuts" table (menu path, macOS label, Windows & Linux
 *   label) is a row of the Preferences Keyboard tab of the mounted App, read on a macOS host and on a
 *   Linux host (Windows formats its labels as Linux does, formatPlatformShortcut). Every shortcut
 *   PRODUCT.md names is the label of such a row. A planted row, label or shortcut fails the check.
 * - BG-01M7V0BV: a PRODUCT.md range such as '⌘1–⌘9' is read key by key, not by its two ends; the words
 *   PRODUCT.md writes beside a shortcut ('⌘O open session') name its command-registry row (a key: the
 *   row's item; a range: the submenu every key of it sits in); and README and PRODUCT.md call the
 *   Keyboard tab's second editor by the name its own heading gives it.
 * - AC2 (re-pointed by US-01M6Q16Q, D0237): README's "Scientific Studios" list names the studio
 *   registry's 11 studios, in rail order, by registry name, and names its 2 document panels apart;
 *   PRODUCT.md counts 11 studios and 2 panels and names the same. The mounted App's tab strip and
 *   inspector title read viewerTabLabel, which gives the registry name whatever the record.
 * - AC3: every font family README.md or PRODUCT.md names outside a URL has a folder under
 *   src/assets/fonts.
 */

import { describe, expect, it, vi } from 'vitest';
import { viewerTabLabel, type ViewerTab } from '../core/documentViews';
import { DOCUMENT_PANELS, STUDIOS, studioForTab } from '../core/studioRegistry';
import { COMMAND_BY_ID, COMMANDS, SECOND_KEYS, formatCommandShortcut } from '../core/commandRegistry';
import type { SequenceDocument } from '../types/bio';
import type { GenomicsSubTabId } from '../core/analysisContext';
import { macHost, mountApp, type AppHarness, type MountOptions } from './appHarness';

// A macOS host's Tauri runtime (AC1's mac host); the other mounts are Linux hosts.
vi.mock('../lib/tauriIpc', async (importOriginal) => (await import('./appHarness')).tauriIpcMock(await importOriginal<object>()));

vi.setConfig({ testTimeout: 120_000 });

interface NodeFs {
  readFileSync: (p: string) => Uint8Array;
  readdirSync: (p: string, o: { withFileTypes: true }) => { name: string; isDirectory: () => boolean }[];
}
interface NodePath {
  join: (...p: string[]) => string;
  resolve: (...p: string[]) => string;
  dirname: (p: string) => string;
}
interface NodeUrl { fileURLToPath: (u: string) => string }

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, url] = await Promise.all([load<NodeFs>('node:fs'), load<NodePath>('node:path'), load<NodeUrl>('node:url')]);

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => new TextDecoder().decode(fs.readFileSync(path.join(REPO, ...rel.split('/'))));
const README = read('README.md');
const PRODUCT = read('PRODUCT.md');

const words = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A Markdown cell or item as the reader sees it: no bold, no code ticks, entities decoded. */
const plain = (s: string) => words(s.replace(/\*\*/g, '').replace(/`/g, '').replace(/&amp;/g, '&'));

/** The lines of a `## heading` section, up to the next heading of any level. Throws when the heading is missing. */
function sectionLines(md: string, heading: string): string[] {
  const lines = md.split('\n');
  const start = lines.findIndex((l) => l.trim() === `## ${heading}`);
  if (start < 0) throw new Error(`no "## ${heading}" heading`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^#{1,6} /.test(l));
  return end < 0 ? rest : rest.slice(0, end);
}

// ─── AC1: the Keyboard Shortcuts table and PRODUCT.md's shortcuts ───

interface DocShortcutRow { path: string; mac: string; other: string }
type TabRow = [path: string, label: string];

/** README's Keyboard Shortcuts table, one row per menu path. Throws when the table has no row. */
function readmeShortcutRows(md: string): DocShortcutRow[] {
  const table = sectionLines(md, 'Keyboard Shortcuts').filter((l) => l.trim().startsWith('|'));
  const rows = table.slice(2).map((l) => {
    const cells = l.trim().replace(/^\||\|$/g, '').split('|').map(plain);
    if (cells.length !== 3) throw new Error(`a Keyboard Shortcuts row has ${cells.length} cells, not 3: ${l}`);
    return { path: cells[0], mac: cells[1], other: cells[2] };
  });
  if (rows.length === 0) throw new Error('README\'s Keyboard Shortcuts table has no row');
  return rows;
}

/** Each README row that is not a Keyboard-tab row on the macOS host and on the Linux host. */
function shortcutTableMismatches(md: string, mac: readonly TabRow[], linux: readonly TabRow[]): string[] {
  const has = (rows: readonly TabRow[], p: string, label: string) => rows.some(([rp, rl]) => rp === p && rl === label);
  return readmeShortcutRows(md).flatMap((r) => [
    ...(has(mac, r.path, r.mac) ? [] : [`macOS: ${r.path} ${r.mac}`]),
    ...(has(linux, r.path, r.other) ? [] : [`Linux: ${r.path} ${r.other}`]),
  ]);
}

/** One shortcut key, as PRODUCT.md writes it: a ⌘/⌥/⇧/⌃ chord, a Ctrl+ chord or a bare function key. */
const KEY = String.raw`[⌃⌥⇧⌘]+(?:F\d{1,2}|\S)|\bCtrl\+(?:(?:Alt|Shift)\+)*(?:F\d{1,2}|\S)|\bF\d{1,2}\b`;
/** A key or a 'first–last' range of keys, then the words PRODUCT.md writes beside it, if any. */
const CLAIM = new RegExp(`(${KEY})(?:–(${KEY}))?(?: ([a-z][^,.;:()\n⌃⌥⇧⌘]*))?`, 'g');

/** Every key of a 'first–last' range ('⌘1–⌘9' is ⌘1, ⌘2, … ⌘9). Throws when the two ends are not one run of keys. */
function expandRange(first: string, last: string): string[] {
  const [head, lastHead] = [first.slice(0, -1), last.slice(0, -1)];
  const [from, to] = [first.charCodeAt(first.length - 1), last.charCodeAt(last.length - 1)];
  if (head !== lastHead || to <= from) throw new Error(`the range ${first}–${last} is not one run of keys`);
  return Array.from({ length: to - from + 1 }, (_, i) => head + String.fromCharCode(from + i));
}

/** A shortcut PRODUCT.md names: its text, every key it covers and the words beside it (null when it has none). */
interface ShortcutClaim { text: string; keys: string[]; description: string | null }

/** Every shortcut PRODUCT.md names, with a range expanded to each of its keys. */
function productShortcutClaims(md: string): ShortcutClaim[] {
  return [...md.matchAll(CLAIM)].map((m) => ({
    text: words(m[0]),
    keys: m[2] ? expandRange(m[1], m[2]) : [m[1]],
    description: m[3] ? words(m[3]) : null,
  }));
}

/** Every shortcut label PRODUCT.md names, each key of a range on its own. */
function productShortcuts(md: string): string[] {
  const found = productShortcutClaims(md).flatMap((c) => c.keys);
  if (found.length === 0) throw new Error('PRODUCT.md names no shortcut');
  return found;
}

/** The Keyboard-tab rows that show `key` (a ⌘ form on macOS, any other on Linux). */
const rowsShowing = (key: string, mac: readonly TabRow[], linux: readonly TabRow[]) =>
  (/[⌃⌥⇧⌘]/.test(key) ? mac : linux).filter(([, label]) => label === key);

/** Each PRODUCT.md shortcut that is not the label of a Keyboard-tab row. */
function productShortcutMismatches(md: string, mac: readonly TabRow[], linux: readonly TabRow[]): string[] {
  return productShortcuts(md).filter((s) => rowsShowing(s, mac, linux).length === 0);
}

const wordsOf = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * The command registry's keys on a host as [menu path > item, label]: each command's shortcut and
 * each second key, under the path of the command it runs (the menubar's own source, D0017 (3)).
 */
function registryRows(os: 'macos' | 'linux'): TabRow[] {
  const row = (id: string, key: string): TabRow => {
    const c = COMMAND_BY_ID.get(id);
    if (!c) throw new Error(`the command registry has no command "${id}"`);
    return [[...c.path, c.label].join(' > '), formatCommandShortcut(key, os)!];
  };
  return [
    ...COMMANDS.flatMap((c) => (c.shortcut ? [row(c.id, c.shortcut)] : [])),
    ...SECOND_KEYS.map((k) => row(k.commandId, k.shortcut)),
  ];
}

/**
 * Each described PRODUCT.md shortcut whose words do not name its registry row (registryRows): a key's words hold
 * every word of the item its row runs ('⌘O open session' and File > Open Session), a range's hold
 * every word of the submenu each of its keys' rows sits in ('⌥⌘1–⌥⌘3 switch the map layout' and
 * View > Map Layout). A key no row shows is a mismatch. Throws when PRODUCT.md describes no shortcut.
 */
function productDescriptionMismatches(md: string, mac: readonly TabRow[], linux: readonly TabRow[]): string[] {
  const described = productShortcutClaims(md).filter((c) => c.description !== null);
  if (described.length === 0) throw new Error('PRODUCT.md describes no shortcut');
  return described.filter((c) => {
    const said = new Set(wordsOf(c.description!));
    const named = (row: TabRow) => {
      const segments = row[0].split(' > ');
      const name = segments[segments.length - (c.keys.length > 1 ? 2 : 1)];
      return name !== undefined && wordsOf(name).every((w) => said.has(w));
    };
    return !c.keys.every((k) => rowsShowing(k, mac, linux).some(named));
  }).map((c) => c.text);
}

/** What the Keyboard tab shows: its shortcut rows as [path, label], and the heading of its options-window editor. */
interface KeyboardTab { rows: TabRow[]; editor: string }

/** Opens Preferences by its own command, chooses the Keyboard tab and reads its rows and its editor's heading. */
async function readKeyboardTab(app: AppHarness): Promise<KeyboardTab> {
  await app.menu('app:preferences');
  await app.click(app.one('#prefs-tab-keyboard', 'Preferences Keyboard tab'));
  const rows = app.all('tr.mbc-menu-shortcut-row').map((r): TabRow => {
    const cells = r.querySelectorAll('td');
    return [words(cells[0].textContent), words(cells[1].textContent)];
  });
  if (rows.length === 0) throw new Error('the Keyboard tab shows no row');
  const legend = app.one('table.mbc-op-shortcuts', 'Keyboard tab options-window editor').closest('fieldset')?.querySelector('legend');
  if (!legend) throw new Error('the Keyboard tab\'s options-window editor has no heading');
  return { rows, editor: words(legend.textContent ?? '') };
}

const keyboardTabs = new Map<string, Promise<KeyboardTab>>();
/** The Keyboard tab on a host, read once per host from a freshly mounted App. */
function tabOn(host: 'macos' | 'linux'): Promise<KeyboardTab> {
  if (!keyboardTabs.has(host)) {
    const opts: MountOptions = host === 'macos' ? macHost() : {};
    keyboardTabs.set(host, mountApp(opts).then(async (app) => {
      try {
        return await readKeyboardTab(app);
      } finally {
        app.unmount();
      }
    }));
  }
  return keyboardTabs.get(host)!;
}
/** The Keyboard tab's rows on a host. */
const rowsOn = (host: 'macos' | 'linux'): Promise<TabRow[]> => tabOn(host).then((t) => t.rows);

/** A label no Keyboard-tab row shows (⌃ with ⌘ is never formatted; the Linux form adds a modifier no row has). */
const UNUSED_MAC = '⌃⌥⇧⌘J';
const UNUSED_LINUX = 'Ctrl+Alt+Shift+Super+J';

describe('US-01M6P23W AC1: README\'s Keyboard Shortcuts and PRODUCT.md\'s shortcuts are Keyboard-tab rows', () => {
  it('US-01M6P23W AC1 every README Keyboard Shortcuts row is a Keyboard-tab row on a macOS and a Linux host', async () => {
    const mac = await rowsOn('macos');
    const linux = await rowsOn('linux');
    // The hosts really differ: the same Export GenBank row reads ⇧⌘E on one and Ctrl+Shift+E on the other (US-01M6Q1CF, D0244).
    expect(mac.find((r) => r[0] === 'File > Export Sequences > Export GenBank')?.[1]).toBe('⇧⌘E');
    expect(linux.find((r) => r[0] === 'File > Export Sequences > Export GenBank')?.[1]).toBe('Ctrl+Shift+E');
    expect(readmeShortcutRows(README).length).toBeGreaterThanOrEqual(10);
    expect(shortcutTableMismatches(README, mac, linux)).toEqual([]);
  });

  it('US-01M6P23W AC1 every shortcut PRODUCT.md names is a Keyboard-tab row\'s label', async () => {
    const mac = await rowsOn('macos');
    const linux = await rowsOn('linux');
    expect(productShortcuts(PRODUCT).length).toBeGreaterThanOrEqual(5);
    expect(productShortcutMismatches(PRODUCT, mac, linux)).toEqual([]);
  });

  it('US-01M6P23W AC1 a planted row, a wrong label and a planted PRODUCT.md shortcut each fail the check', async () => {
    const mac = await rowsOn('macos');
    const linux = await rowsOn('linux');
    expect(mac.some((r) => r[1] === UNUSED_MAC) || linux.some((r) => r[1] === UNUSED_LINUX)).toBe(false);
    const rows = readmeShortcutRows(README);
    const lines = README.split('\n');
    const lastRow = lines.findIndex((l) => plain(l).startsWith(`| ${rows[rows.length - 1].path} |`));
    expect(lastRow).toBeGreaterThan(0);
    const withLine = (at: number, line: string, replace: boolean) =>
      [...lines.slice(0, at), line, ...lines.slice(replace ? at + 1 : at)].join('\n');

    // A row whose menu path the app has no such item for, with a real label.
    const fakePath = withLine(lastRow + 1, `| **File > Planted Fake Command** | \`${rows[0].mac}\` | \`${rows[0].other}\` |`, false);
    expect(readmeShortcutRows(fakePath)).toHaveLength(rows.length + 1);
    expect(shortcutTableMismatches(fakePath, mac, linux)).toEqual([
      `macOS: File > Planted Fake Command ${rows[0].mac}`, `Linux: File > Planted Fake Command ${rows[0].other}`]);

    // A real path given a label the app never shows, on each host's column.
    const first = lines.findIndex((l) => plain(l).startsWith(`| ${rows[0].path} |`));
    const wrongMac = withLine(first, `| **${rows[0].path}** | \`${UNUSED_MAC}\` | \`${rows[0].other}\` |`, true);
    expect(shortcutTableMismatches(wrongMac, mac, linux)).toEqual([`macOS: ${rows[0].path} ${UNUSED_MAC}`]);
    const wrongLinux = withLine(first, `| **${rows[0].path}** | \`${rows[0].mac}\` | \`${UNUSED_LINUX}\` |`, true);
    expect(shortcutTableMismatches(wrongLinux, mac, linux)).toEqual([`Linux: ${rows[0].path} ${UNUSED_LINUX}`]);
    // The old table's ⌘B (no item binds it) is caught too.
    const oldToggle = withLine(lastRow + 1, '| **Toggle Left Project Explorer** | `⌘B` | `Ctrl+B` |', false);
    expect(shortcutTableMismatches(oldToggle, mac, linux)).toHaveLength(2);

    // PRODUCT.md: an unbound mac chord and an unbound Ctrl chord.
    expect(productShortcutMismatches(`${PRODUCT}\nKeys: ${UNUSED_MAC}.`, mac, linux)).toEqual([UNUSED_MAC]);
    expect(productShortcutMismatches(`${PRODUCT}\nKeys: Ctrl+Alt+Shift+J.`, mac, linux)).toEqual(
      linux.some((r) => r[1] === 'Ctrl+Alt+Shift+J') ? [] : ['Ctrl+Alt+Shift+J']);
    expect(productShortcutMismatches(`${PRODUCT}\nKeys: ⌘B.`, mac, linux)).toEqual(mac.some((r) => r[1] === '⌘B') ? [] : ['⌘B']);
    // An absent table or a PRODUCT.md without a shortcut fails loudly rather than passing as "no mismatch".
    expect(() => readmeShortcutRows('# MolBioCraft\n')).toThrow(/no "## Keyboard Shortcuts" heading/);
    expect(() => readmeShortcutRows('## Keyboard Shortcuts\n\nNone.\n')).toThrow(/has no row/);
    expect(() => productShortcuts('No keys here.')).toThrow(/names no shortcut/);
  });
});

describe('BG-01M7V0BV PRODUCT.md\'s shortcut words and ranges, and the options-window editor\'s name', () => {
  it('BG-01M7V0BV a range is read key by key: every key of ⌘1–⌘9 and ⌥⌘1–⌥⌘3 is a Keyboard-tab row', async () => {
    const mac = await rowsOn('macos');
    const linux = await rowsOn('linux');
    expect(productShortcuts('⌘1–⌘9 and ⌥⌘1–⌥⌘3')).toEqual(
      ['⌘1', '⌘2', '⌘3', '⌘4', '⌘5', '⌘6', '⌘7', '⌘8', '⌘9', '⌥⌘1', '⌥⌘2', '⌥⌘3']);
    expect(productShortcuts('⌘1–⌘9, ⌥⌘1–⌥⌘3 switch the map layout')).toHaveLength(12);
    expect(productShortcuts('Ctrl+1–Ctrl+3')).toEqual(['Ctrl+1', 'Ctrl+2', 'Ctrl+3']);
    for (const k of ['⌘5', '⌥⌘2']) expect(productShortcuts(PRODUCT)).toContain(k);
    // A middle key the app does not bind fails each check, though both ends are rows.
    const [regMac, regLinux] = [registryRows('macos'), registryRows('linux')];
    for (const k of ['⌘5', '⌥⌘2']) {
      expect(productShortcutMismatches(PRODUCT, mac.filter((r) => r[1] !== k), linux)).toContain(k);
      expect(productDescriptionMismatches(PRODUCT, regMac.filter((r) => r[1] !== k), regLinux).length).toBe(1);
    }
    // "the first nine studios in rail order": ⌘n runs the registry's n-th studio.
    STUDIOS.slice(0, 9).forEach((s, i) =>
      expect(mac.filter((r) => r[1] === `⌘${i + 1}`).map((r) => r[0])).toEqual([`View > Studios > ${s.name}`]));
    expect(() => productShortcuts('⌘9–⌘1')).toThrow(/not one run of keys/);
    expect(() => productShortcuts('⌘1–⌥⌘3')).toThrow(/not one run of keys/);
  });

  it('BG-01M7V0BV every shortcut PRODUCT.md describes is described by its command-registry row\'s item or submenu', () => {
    const [mac, linux] = [registryRows('macos'), registryRows('linux')];
    expect(mac.find((r) => r[1] === '⇧⌘E')?.[0]).toBe('File > Export Sequences > Export GenBank');
    expect(linux.find((r) => r[1] === 'Ctrl+Shift+E')?.[0]).toBe('File > Export Sequences > Export GenBank');
    const described = productShortcutClaims(PRODUCT).filter((c) => c.description !== null);
    expect(described.map((c) => c.text)).toEqual(expect.arrayContaining(
      ['⌘1–⌘9 open the first nine studios in rail order', '⌥⌘1–⌥⌘3 switch the map layout', '⌘O open session', '⇧⌘E export GenBank']));
    expect(described.length).toBeGreaterThanOrEqual(7);
    expect(productDescriptionMismatches(PRODUCT, mac, linux)).toEqual([]);
  });

  it('BG-01M7V0BV the M4 mutant and other wrong words beside a shortcut each fail the check', async () => {
    const [mac, linux] = [registryRows('macos'), registryRows('linux')];
    const swap = (from: string, to: string) => {
      expect(PRODUCT).toContain(from);
      return PRODUCT.replace(from, to);
    };
    // M4: the key is a real row, its words are not.
    expect(productShortcutMismatches(swap('⌘O open session', '⌘O print the map'), await rowsOn('macos'), await rowsOn('linux'))).toEqual([]);
    expect(productDescriptionMismatches(swap('⌘O open session', '⌘O print the map'), mac, linux)).toEqual(['⌘O print the map']);
    expect(productDescriptionMismatches(swap('⌘S save session', '⌘S open session'), mac, linux)).toEqual(['⌘S open session']);
    expect(productDescriptionMismatches(swap('⌥⌘1–⌥⌘3 switch the map layout', '⌥⌘1–⌥⌘3 switch the studio'), mac, linux))
      .toEqual(['⌥⌘1–⌥⌘3 switch the studio']);
    // A range is described by the submenu its keys share, not by one item's words.
    expect(productDescriptionMismatches(swap('⌘1–⌘9 open the first nine studios', '⌘1–⌘9 open the first nine layouts'), mac, linux))
      .toEqual(['⌘1–⌘9 open the first nine layouts in rail order']);
    // A range spanning two submenus has no one submenu to name.
    expect(productDescriptionMismatches(`${PRODUCT}\nKeys: ⌘8–⌘K studios.`, mac, linux)).toEqual(['⌘8–⌘K studios']);
    expect(() => productDescriptionMismatches('Keys: ⌘K, ⌘O.', mac, linux)).toThrow(/describes no shortcut/);
  });

  it('BG-01M7V0BV README and PRODUCT.md call the options-window editor by the Keyboard tab\'s own heading', async () => {
    const { editor } = await tabOn('macos');
    const name = editor.split(' & ')[0];
    expect(name).toMatch(/-window shortcuts$/);
    for (const [doc, md] of [['README.md', README], ['PRODUCT.md', PRODUCT]] as const) {
      expect(md.toLowerCase(), doc).toContain(name.toLowerCase());
      expect(md.match(/operations?[- ]windows?/gi), doc).toBeNull();
    }
  });
});

// ─── AC2: the Scientific Studios list and the studio count ───

/** The bold names of README's numbered Scientific Studios items, in order. Throws when there is none. */
function readmeStudioNames(md: string): string[] {
  const names = sectionLines(md, 'Scientific Studios')
    .map((l) => /^\d+\. \*\*([^*]+)\*\*/.exec(l)?.[1])
    .filter((n): n is string => n !== undefined)
    .map(plain);
  if (names.length === 0) throw new Error('README\'s Scientific Studios section lists no studio');
  return names;
}

/** Every studio count PRODUCT.md states ("11 scientific studios", "11 studio implementations"). */
function productStudioCounts(md: string): number[] {
  const counts = [...md.matchAll(/\b(\d+) (?:scientific )?studio/gi)].map((m) => Number(m[1]));
  if (counts.length === 0) throw new Error('PRODUCT.md states no studio count');
  return counts;
}

/** Every document-panel count PRODUCT.md states ("2 document panels"). */
function productPanelCounts(md: string): number[] {
  const counts = [...md.matchAll(/\b(\d+) document panels?/gi)].map((m) => Number(m[1]));
  if (counts.length === 0) throw new Error('PRODUCT.md states no document-panel count');
  return counts;
}

/** The names after "Studios:" and "Panels:" in PRODUCT.md's capability line. */
function productNames(md: string, label: 'Studios' | 'Panels'): string[] {
  const hit = new RegExp(`\\b${label}: ([^.]+)\\.`).exec(md);
  if (!hit) throw new Error(`PRODUCT.md names no ${label.toLowerCase()}`);
  return hit[1].split(',').map(words);
}

/** The bold names of README's sentence naming the document panels, in order. Throws when there is none. */
function readmePanelNames(md: string): string[] {
  const line = sectionLines(md, 'Scientific Studios').find((l) => /document panels/i.test(l));
  if (!line) throw new Error('README\'s Scientific Studios section names no document panels');
  return [...line.matchAll(/\*\*([^*]+)\*\*/g)].map((m) => plain(m[1]));
}

const plainDna = (features: number, primers: number): SequenceDocument => ({
  id: 'docs-truth-dna', name: 'docs-truth-dna', accession: 'DT_1', description: 'A plain DNA record', moleculeType: 'DNA',
  topology: 'linear', sequence: 'ATGGCCATTGTAATGGGCCGCTGAAAGGGTGCCCGA', history: [],
  features: Array.from({ length: features }, (_, i) => ({ id: `f${i}`, name: `f${i}`, type: 'misc_feature', start: 1, end: 9, strand: 1, color: '#888888' })),
  primers: Array.from({ length: primers }, (_, i) => ({ id: `p${i}`, name: `p${i}`, sequence: 'ATGGCC', start: 1, end: 6, strand: 1 })),
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', folder: 'Plasmids & Vectors',
} as unknown as SequenceDocument);

describe('US-01M6P23W AC2: README names the registry\'s 11 studios and 2 panels, and PRODUCT.md counts them', () => {
  // US-01M6Q16Q AC9 (D0237): the check reads the studio registry, not VIEWER_TAB_ORDER's 13 labels.
  const studios = STUDIOS.map((s) => s.name);
  const panels = DOCUMENT_PANELS.map((p) => p.name);

  it('US-01M6P23W AC2 README\'s Scientific Studios list is the registry\'s studios in rail order, by registry name, and its panels apart', () => {
    expect(studios).toHaveLength(11);
    expect(new Set(studios).size).toBe(11);
    expect(readmeStudioNames(README)).toEqual(studios);
    expect(readmePanelNames(README)).toEqual(panels);
  });

  it('US-01M6P23W AC2 a dropped, swapped or renamed studio fails, and so does a missing list', () => {
    const items = README.split('\n').filter((l) => /^\d+\. \*\*/.test(l) && readmeStudioNames(README).includes(plain(/\*\*([^*]+)\*\*/.exec(l)![1])));
    expect(items).toHaveLength(11);
    const dropped = README.replace(`${items[10]}\n`, '');
    expect(readmeStudioNames(dropped)).not.toEqual(studios);
    const swapped = README.replace(items[0], '\u0000').replace(items[1], items[0]).replace('\u0000', items[1]);
    expect(readmeStudioNames(swapped)).not.toEqual(studios);
    const renamed = README.replace(items[2], items[2].replace(`**${studios[2]}**`, '**Text View**'));
    expect(readmeStudioNames(renamed)).not.toEqual(studios);
    // A panel listed as a studio, or a studio name still in its old wording, fails too.
    expect(readmeStudioNames(README.replace(items[10], `${items[10]}\n12. **History** — the history.`))).not.toEqual(studios);
    expect(readmeStudioNames(README.replace('**Sanger & Contig**', '**Chromatogram**'))).not.toEqual(studios);
    expect(readmePanelNames(README.replace('**Info**', '**Document info**'))).not.toEqual(panels);
    expect(() => readmeStudioNames('## Scientific Studios\n\nTabs.\n')).toThrow(/lists no studio/);
    expect(() => readmePanelNames('## Scientific Studios\n\n1. **Sequence Map** — x\n')).toThrow(/names no document panels/);
  });

  it('US-01M6P23W AC2 every studio count PRODUCT.md states is 11, every panel count 2, and it names the registry\'s studios and panels', () => {
    expect(productStudioCounts(PRODUCT).length).toBeGreaterThanOrEqual(2);
    expect(productStudioCounts(PRODUCT).filter((n) => n !== STUDIOS.length)).toEqual([]);
    expect(productPanelCounts(PRODUCT).filter((n) => n !== DOCUMENT_PANELS.length)).toEqual([]);
    expect(productNames(PRODUCT, 'Studios')).toEqual(studios);
    expect(productNames(PRODUCT, 'Panels')).toEqual(panels);
    expect(productStudioCounts(`${PRODUCT}\n- 13 scientific studios`).filter((n) => n !== 11)).toEqual([13]);
    expect(() => productStudioCounts('No count.')).toThrow(/no studio count/);
    expect(() => productNames('No list.', 'Studios')).toThrow(/names no studios/);
  });

  it('US-01M6P23W AC2 viewerTabLabel gives the registry name whatever the record', () => {
    const dna = plainDna(2, 1);
    expect(viewerTabLabel('annotations-table', dna)).toBe('Annotations');
    expect(viewerTabLabel('annotations-table')).toBe('Annotations');
    expect(viewerTabLabel('text-view', dna)).toBe('Flatfile');
    expect(viewerTabLabel('text-view', { ...dna, docMetadata: { 'Document Type': 'Text Document' } } as SequenceDocument)).toBe('Flatfile');
    expect(viewerTabLabel('sequence-alignment', { ...dna, documentKind: 'contig' } as SequenceDocument)).toBe('Alignment');
    expect(viewerTabLabel('sequence-alignment', { ...dna, alignmentMeta: { isAligned: false } } as unknown as SequenceDocument)).toBe('Alignment');
    expect(viewerTabLabel('protein-3d', { ...dna, moleculeType: 'Protein' } as SequenceDocument)).toBe('Protein & 3D');
    expect(viewerTabLabel('genomics-ngs', { ...dna, moleculeType: 'Protein' } as SequenceDocument)).toBe('Pipelines & NGS');
    expect(viewerTabLabel('genomics-ngs', dna)).toBe('Pipelines & NGS');
    expect(viewerTabLabel('history-hybrid', { ...dna, docMetadata: { 'Document Type': 'Enzyme Set' } } as SequenceDocument)).toBe('History');
    for (const tab of ['sequence-view', 'cloning-gel', 'vector-library', 'primers-pcr', 'phylogenetics', 'sanger-contig', 'guided-pipelines', 'document-info'] as const) {
      expect(viewerTabLabel(tab, dna), tab).toBe(studioForTab(tab).name);
    }
  });

  it('US-01M6P23W AC2 the mounted App\'s tab strip and inspector title read viewerTabLabel', async () => {
    // Primers are left out of the mounted record (the fixture's primer is not a full PrimerRecord).
    const dna = plainDna(3, 0);
    const app = await mountApp();
    try {
      await app.restoreSession({ documents: [dna], activeDocId: dna.id, viewerTab: 'annotations-table' });
      // The studio rail's entries (US-01M6Q1BD, D0242): each by the tab and genomics view it opens. Only an
      // enabled entry is visited below, since a disabled one does not switch (AC2).
      const rail = app.railTabs().map((b) => ({
        tab: b.getAttribute('data-view') as ViewerTab, view: (b.getAttribute('data-genomics-view') ?? undefined) as GenomicsSubTabId | undefined,
        studio: b.getAttribute('data-studio')!, label: words(b.querySelector('.mbc-studio-rail-name')?.textContent ?? ''), enabled: b.getAttribute('aria-disabled') !== 'true',
      }));
      const tabs = rail.filter((t) => t.enabled);
      expect(tabs.length).toBeGreaterThanOrEqual(4);
      expect(tabs.map(({ tab }) => tab)).toContain('annotations-table');
      for (const { tab, view, label } of rail) expect(label, tab).toBe(viewerTabLabel(tab, dna, view));
      // The annotation count is its own element beside the name.
      expect(app.all('button[role="tab"][data-studio="annotations"] .mbc-studio-rail-count').map((c) => words(c.textContent))).toEqual(['3']);
      // A studio's inspector button is named by its pane title, which the open tab's label gives,
      // the Sequence tab's included (D0239: no tab keeps a title of its own).
      const checked: string[] = [];
      for (const { tab, view, studio } of tabs) {
        await app.clickStudio(studio);
        const button = app.inspectorButton();
        if (!button) continue;
        expect(button.getAttribute('aria-label'), tab).toMatch(/^(Show|Hide) /);
        expect(button.getAttribute('aria-label')!.replace(/^(Show|Hide) /, ''), tab).toBe(`${viewerTabLabel(tab, dna, view)} Controls Inspector`);
        checked.push(tab);
      }
      expect(checked.length, `an inspector title was checked (tabs: ${tabs.map(({ tab }) => tab).join(', ')})`).toBeGreaterThanOrEqual(1);

      // An unaligned set: its tab and its inspector read Alignment, the registry name, not "Sequences".
      const reads = ['ATGGCCATTGTAATGGGCCGC', 'ATGGCCATTGTTATGGGCCGC', 'ATGGCGATTGTAATGGGCCGC'];
      const unaligned = { ...plainDna(0, 0), id: 'docs-truth-set', name: 'docs-truth-set', sequence: reads[0], folder: 'Alignments',
        documentKind: 'alignment',
        alignmentMeta: { isAligned: false, sequences: reads.map((seq, i) => ({ id: `dt-r${i}`, name: `read ${i + 1}`, sequence: seq })) },
      } as unknown as SequenceDocument;
      await app.restoreSession({ documents: [unaligned], activeDocId: unaligned.id, viewerTab: 'sequence-alignment' });
      const alignmentTab = app.railTabs().filter((b) => b.getAttribute('data-studio') === 'alignment');
      expect(alignmentTab.map((b) => words(b.querySelector('.mbc-studio-rail-name')?.textContent ?? ''))).toEqual(['Alignment']);
      expect(app.inspectorButton()?.getAttribute('aria-label')?.replace(/^(Show|Hide) /, '')).toBe('Alignment Controls Inspector');
    } finally {
      app.unmount();
    }
  });
});

// ─── AC3: the fonts the docs name are bundled ───

/** Font families a product document could plausibly name; longer names first so "Google Sans Code" is not read as "Google Sans". */
const FONT_FAMILIES = [
  'Google Sans Code', 'Google Sans', 'Space Grotesk', 'Poppins', 'Inter', 'IBM Plex Mono', 'IBM Plex Sans', 'Roboto Mono',
  'Roboto', 'JetBrains Mono', 'Fira Code', 'Fira Sans', 'Source Code Pro', 'Source Sans Pro', 'Source Sans', 'Open Sans',
  'Noto Sans Mono', 'Noto Sans', 'Lato', 'Montserrat', 'Helvetica Neue', 'Helvetica', 'Arial', 'SF Pro', 'SF Mono', 'Menlo',
  'Consolas', 'Courier New', 'Segoe UI', 'Ubuntu Mono', 'Cascadia Code',
].sort((a, b) => b.length - a.length);

/** The font families named in a Markdown text outside its URLs (a link target, an image src, a bare http(s) URL). */
function namedFonts(md: string): string[] {
  let text = md.replace(/https?:\/\/[^\s)"'>]+/g, ' ').replace(/\]\([^)]*\)/g, '] ');
  const found = new Set<string>();
  for (const family of FONT_FAMILIES) {
    const re = new RegExp(`\\b${family.replace(/ /g, '\\s+')}\\b`, 'g');
    if (re.test(text)) found.add(family);
    text = text.replace(re, ' ');
  }
  return [...found];
}

const fontFolders = () => new Set(fs.readdirSync(path.join(REPO, 'src', 'assets', 'fonts'), { withFileTypes: true })
  .filter((e) => e.isDirectory()).map((e) => e.name));
const folderOf = (family: string) => family.toLowerCase().replace(/\s+/g, '-');

describe('US-01M6P23W AC3: every font the docs name is bundled under src/assets/fonts', () => {
  it('US-01M6P23W AC3 each font family README.md or PRODUCT.md names outside a URL has a folder', () => {
    const folders = fontFolders();
    expect(folders.size).toBeGreaterThanOrEqual(1);
    const named = [...new Set([...namedFonts(README), ...namedFonts(PRODUCT)])];
    expect(named.length, 'PRODUCT.md names its typefaces').toBeGreaterThanOrEqual(3);
    expect(named.filter((f) => !folders.has(folderOf(f)))).toEqual([]);
  });

  it('US-01M6P23W AC3 an unbundled family fails, a URL is not read, and a longer name is not read as its prefix', () => {
    const folders = fontFolders();
    const missing = (md: string) => namedFonts(md).filter((f) => !folders.has(folderOf(f)));
    expect(missing(`${PRODUCT}\n- Body text set in Inter`)).toEqual(['Inter']);
    expect(missing(`${README}\n[badge](https://example.org/?font_family=Inter)`)).toEqual([]);
    expect(missing(`${README}\n<img src="https://example.org/?font_family=IBM%20Plex%20Mono&x=Inter" />`)).toEqual([]);
    expect(namedFonts('Sequences use Google Sans Code.')).toEqual(['Google Sans Code']);
    expect(namedFonts('Menus use Google Sans; sequences use Google Sans Code.').sort()).toEqual(['Google Sans', 'Google Sans Code']);
  });
});
