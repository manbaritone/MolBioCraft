// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P23W: what README.md and PRODUCT.md say about the app is checked against the app.
 *
 * - AC1: every row of README's "Keyboard Shortcuts" table (menu path, macOS label, Windows & Linux
 *   label) is a row of the Preferences Keyboard tab of the mounted App, read on a macOS host and on a
 *   Linux host (Windows formats its labels as Linux does, formatPlatformShortcut). Every shortcut
 *   PRODUCT.md names is the label of such a row. A planted row, label or shortcut fails the check.
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
import type { SequenceDocument } from '../types/bio';
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

/** Every shortcut label PRODUCT.md names: a ⌘/⌥/⇧/⌃ chord, a Ctrl+ chord or a bare function key. */
function productShortcuts(md: string): string[] {
  const found = md.match(/[⌃⌥⇧⌘]+(?:F\d{1,2}|\S)|\bCtrl\+(?:(?:Alt|Shift)\+)*(?:F\d{1,2}|\S)|\bF\d{1,2}\b/g) ?? [];
  if (found.length === 0) throw new Error('PRODUCT.md names no shortcut');
  return found;
}

/** Each PRODUCT.md shortcut that is not the label of a Keyboard-tab row (a ⌘ form on macOS, any other on Linux). */
function productShortcutMismatches(md: string, mac: readonly TabRow[], linux: readonly TabRow[]): string[] {
  return productShortcuts(md).filter((s) => !(/[⌃⌥⇧⌘]/.test(s) ? mac : linux).some(([, label]) => label === s));
}

/** Opens Preferences by its own command, chooses the Keyboard tab and reads its rows as [path, label]. */
async function keyboardTabRows(app: AppHarness): Promise<TabRow[]> {
  await app.menu('app:preferences');
  await app.click(app.one('#prefs-tab-keyboard', 'Preferences Keyboard tab'));
  const rows = app.all('tr.mbc-menu-shortcut-row').map((r): TabRow => {
    const cells = r.querySelectorAll('td');
    return [words(cells[0].textContent), words(cells[1].textContent)];
  });
  if (rows.length === 0) throw new Error('the Keyboard tab shows no row');
  return rows;
}

const tabRows = new Map<string, Promise<TabRow[]>>();
/** The Keyboard tab's rows on a host, read once per host from a freshly mounted App. */
function rowsOn(host: 'macos' | 'linux'): Promise<TabRow[]> {
  if (!tabRows.has(host)) {
    const opts: MountOptions = host === 'macos' ? macHost() : {};
    tabRows.set(host, mountApp(opts).then(async (app) => {
      try {
        return await keyboardTabRows(app);
      } finally {
        app.unmount();
      }
    }));
  }
  return tabRows.get(host)!;
}

/** A label no Keyboard-tab row shows (⌃ with ⌘ is never formatted; the Linux form adds a modifier no row has). */
const UNUSED_MAC = '⌃⌥⇧⌘J';
const UNUSED_LINUX = 'Ctrl+Alt+Shift+Super+J';

describe('US-01M6P23W AC1: README\'s Keyboard Shortcuts and PRODUCT.md\'s shortcuts are Keyboard-tab rows', () => {
  it('US-01M6P23W AC1 every README Keyboard Shortcuts row is a Keyboard-tab row on a macOS and a Linux host', async () => {
    const mac = await rowsOn('macos');
    const linux = await rowsOn('linux');
    // The hosts really differ: the same Export GenBank row reads ⌘S on one and Ctrl+S on the other.
    expect(mac.find((r) => r[0] === 'File > Export Sequences > Export GenBank')?.[1]).toBe('⌘S');
    expect(linux.find((r) => r[0] === 'File > Export Sequences > Export GenBank')?.[1]).toBe('Ctrl+S');
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
    expect(viewerTabLabel('genomics-ngs', { ...dna, moleculeType: 'Protein' } as SequenceDocument)).toBe('Protein & 3D');
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
      const tabs = app.all('button[role="tab"][data-view]').map((b) => [b.getAttribute('data-view') as ViewerTab, words(b.querySelector('.mbc-vtab-name')?.textContent ?? '')] as const);
      expect(tabs.length).toBeGreaterThanOrEqual(4);
      expect(tabs.map(([tab]) => tab)).toContain('annotations-table');
      for (const [tab, label] of tabs) expect(label, tab).toBe(viewerTabLabel(tab, dna));
      // The annotation count is its own element beside the name.
      expect(app.all('button[role="tab"][data-view="annotations-table"] .mbc-vtab-count').map((c) => words(c.textContent))).toEqual(['3']);
      // A studio's inspector button is named by its pane title, which the open tab's label gives
      // (the Sequence and Chromatogram tabs keep their own "... View Controls" titles).
      const checked: string[] = [];
      for (const [tab] of tabs) {
        if (tab === 'sequence-view' || tab === 'sanger-contig') continue;
        await app.clickTab(tab);
        const button = app.inspectorButton();
        if (!button) continue;
        expect(button.getAttribute('aria-label'), tab).toMatch(/^(Show|Hide) /);
        expect(button.getAttribute('aria-label')!.replace(/^(Show|Hide) /, ''), tab).toBe(`${viewerTabLabel(tab, dna)} Controls Inspector`);
        checked.push(tab);
      }
      expect(checked.length, `an inspector title was checked (tabs: ${tabs.map(([t]) => t).join(', ')})`).toBeGreaterThanOrEqual(1);

      // An unaligned set: its tab and its inspector read Alignment, the registry name, not "Sequences".
      const reads = ['ATGGCCATTGTAATGGGCCGC', 'ATGGCCATTGTTATGGGCCGC', 'ATGGCGATTGTAATGGGCCGC'];
      const unaligned = { ...plainDna(0, 0), id: 'docs-truth-set', name: 'docs-truth-set', sequence: reads[0], folder: 'Alignments',
        documentKind: 'alignment',
        alignmentMeta: { isAligned: false, sequences: reads.map((seq, i) => ({ id: `dt-r${i}`, name: `read ${i + 1}`, sequence: seq })) },
      } as unknown as SequenceDocument;
      await app.restoreSession({ documents: [unaligned], activeDocId: unaligned.id, viewerTab: 'sequence-alignment' });
      const alignmentTab = app.all('button[role="tab"][data-view="sequence-alignment"]');
      expect(alignmentTab.map((b) => words(b.querySelector('.mbc-vtab-name')?.textContent ?? ''))).toEqual(['Alignment']);
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
