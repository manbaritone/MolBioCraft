// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { afterEach, describe, expect, it, vi } from 'vitest';
import { captureSvg } from '../core/figureCapture';
import {
  FIGURE_FORMAT_META,
  PX_TO_PT,
  SVG_FILE_PROLOGUE,
  buildPdfDocument,
  deflate,
  delimitedText,
  figureFileName,
  finalizeSvgMarkup,
  isImageFormat,
  plainTextTable,
  resolveCssVariables,
  rgbaToPdf,
  rgbaToRgb,
  type FigureTable,
} from '../core/figureExport';

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);
/** The whole `.svg` file finalizeSvgMarkup writes around a root element. */
const asFile = (markup: string) => `${SVG_FILE_PROLOGUE}${markup}\n`;

describe('exporting a figure', () => {
  describe('SVG markup', () => {
    it('resolves theme tokens so the file renders outside the app', () => {
      const tokens: Record<string, string> = { '--mbc-green': '#16a34a', '--mbc-text-main': '#0f172a' };
      const out = resolveCssVariables(
        '<rect fill="var(--mbc-green)"/><text fill="var(--mbc-text-main)">x</text>',
        (name) => tokens[name] ?? ''
      );
      expect(out).toBe('<rect fill="#16a34a"/><text fill="#0f172a">x</text>');
    });

    it('falls back to the declared fallback, then to currentColor, for a token it cannot find', () => {
      const out = resolveCssVariables('<a fill="var(--missing, #ff0000)"/><b fill="var(--gone)"/>', () => '');
      expect(out).toBe('<a fill="#ff0000"/><b fill="currentColor"/>');
    });

    it('resolves a token that is only reachable through another token"s fallback', () => {
      const out = resolveCssVariables('<a fill="var(--missing, var(--mbc-amber))"/>', (name) =>
        name === '--mbc-amber' ? '#f59e0b' : ''
      );
      expect(out).toBe('<a fill="#f59e0b"/>');
    });

    it('keeps a quoted font list inside its attribute, so the file is still valid XML (BG-01M7CC8J)', () => {
      // WebKit returns font tokens with double quotes; pasted in raw they closed style="..." early,
      // the image never loaded, and PNG, JPEG and PDF of the circular map saved nothing.
      const out = resolveCssVariables(
        '<svg xmlns="http://www.w3.org/2000/svg"><text style="font-family: var(--font-mono)">A&amp;B</text></svg>',
        (name) => (name === '--font-mono' ? ' "Google Sans Code", ui-monospace, "SF Mono" & <x>' : '')
      );
      expect(out).toContain('font-family: &quot;Google Sans Code&quot;, ui-monospace, &quot;SF Mono&quot; &amp; &lt;x&gt;');
      // The attribute closes where it should, and nothing in it is a raw quote, '<' or bare '&'.
      const attr = out.match(/^<svg xmlns="[^"]*"><text style="([^"]*)">A&amp;B<\/text><\/svg>$/);
      expect(attr).not.toBeNull();
      expect(attr![1]).not.toMatch(/[<>]|&(?!(?:amp|lt|gt|quot);)/);
    });

    it('gives the file a namespace, a real pixel size and an opaque background', () => {
      const out = finalizeSvgMarkup('<svg width="100%" height="100%" viewBox="0 0 1180 300"><g/></svg>', {
        width: 1180,
        height: 300,
        background: 'rgb(255, 255, 255)',
        title: 'Kyte-Doolittle hydropathy',
      });
      expect(out.startsWith('<?xml version="1.0"')).toBe(true);
      expect(out).toContain('xmlns="http://www.w3.org/2000/svg"');
      expect(out).toContain('width="1180"');
      expect(out).toContain('height="300"');
      expect(out).toContain('viewBox="0 0 1180 300"');
      expect(out).toContain('<title>Kyte-Doolittle hydropathy</title>');
      expect(out).toContain('<rect x="0" y="0" width="100%" height="100%" fill="rgb(255, 255, 255)"/>');
      // The background goes behind the drawing, not in front of it.
      expect(out.indexOf('<rect')).toBeLessThan(out.indexOf('<g/>'));
      // The pixel size replaces the root's own; a second width or height would make the XML malformed.
      expect(out).toContain('<svg width="1180" height="300" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1180 300">');
    });

    const XMLNS = 'xmlns="http://www.w3.org/2000/svg"';
    const finalize = (markup: string, title?: string) => finalizeSvgMarkup(markup, { width: 80, height: 40, title });

    it('keeps child sizes when the root has only a viewBox', () => {
      // 35 of the 188 <svg> elements in src/components set no width, the cloning gel among them.
      // On such a root the first width and height in the markup belong to a child: a filter
      // region, a rect, an image, an inset drawing.
      const children =
        '<defs><filter id="glow" x="-30%" y="-100%" width="160%" height="300%"/></defs>' +
        '<rect x="0" y="0" width="430" height="350" rx="8"/>' +
        '<image href="lane.png" width="44" height="10"/>' +
        '<svg x="20" y="30" width="200" height="120" viewBox="0 0 10 6"><rect width="5" height="5"/></svg>';
      const out = finalizeSvgMarkup(`<svg viewBox="0 0 430 350">${children}</svg>`, { width: 430, height: 350 });
      expect(out).toBe(asFile(`<svg width="430" height="350" ${XMLNS} viewBox="0 0 430 350">${children}</svg>`));
    });

    it('replaces the root width and height instead of writing a second pair', () => {
      expect(finalize('<svg width="100%" height="100%" viewBox="0 0 8 4"><rect width="2" height="1"/></svg>')).toBe(
        asFile(`<svg width="80" height="40" ${XMLNS} viewBox="0 0 8 4"><rect width="2" height="1"/></svg>`)
      );
    });

    it('gives a root that has only a width its height, and leaves the children alone', () => {
      expect(finalize('<svg width="50%" viewBox="0 0 8 4"><rect width="2" height="1"/></svg>')).toBe(
        asFile(`<svg width="80" height="40" ${XMLNS} viewBox="0 0 8 4"><rect width="2" height="1"/></svg>`)
      );
    });

    it('gives a root that has only a height its width, and leaves the children alone', () => {
      expect(finalize('<svg height="300" viewBox="0 0 8 4"><rect width="2" height="1"/></svg>')).toBe(
        asFile(`<svg width="80" height="40" ${XMLNS} viewBox="0 0 8 4"><rect width="2" height="1"/></svg>`)
      );
    });

    it('reads the root size in whatever order the attributes come, without touching look-alike names', () => {
      expect(
        finalize('<svg data-height="tall" viewBox="0 0 8 4" height="9" stroke-width="2" width="9"><rect width="2" height="1"/></svg>')
      ).toBe(
        asFile(
          `<svg width="80" height="40" ${XMLNS} data-height="tall" viewBox="0 0 8 4" stroke-width="2"><rect width="2" height="1"/></svg>`
        )
      );
    });

    it('replaces a single-quoted root size', () => {
      expect(finalize("<svg width='100%' height='100%' viewBox='0 0 8 4'><rect width='2' height='1'/></svg>")).toBe(
        asFile(`<svg width="80" height="40" ${XMLNS} viewBox='0 0 8 4'><rect width='2' height='1'/></svg>`)
      );
    });

    it('replaces the root size in a start tag that runs over several lines', () => {
      expect(
        finalize('<svg\n  viewBox="0 0 8 4"\n\twidth = "100%"\n  height=\n"100%"\n>\n<rect width="2" height="1"/>\n</svg>')
      ).toBe(asFile(`<svg width="80" height="40" ${XMLNS}\n  viewBox="0 0 8 4"\n>\n<rect width="2" height="1"/>\n</svg>`));
    });

    it('is not fooled by a ">" inside a root attribute value', () => {
      // A label like this is where a parser that stops at the first ">" would end the tag early,
      // leave the root width in place and drop the title into the middle of an attribute.
      expect(
        finalize(`<svg aria-label="5' > 3'" width="100%" viewBox="0 0 8 4"><rect width="2" height="1"/></svg>`, 'Gel')
      ).toBe(
        asFile(
          `<svg width="80" height="40" ${XMLNS} aria-label="5' > 3'" viewBox="0 0 8 4"><title>Gel</title><rect width="2" height="1"/></svg>`
        )
      );
    });

    it('opens a self-closing root before putting a title or background inside it', () => {
      expect(finalize('<svg viewBox="0 0 8 4" />', 'Empty')).toBe(
        asFile(`<svg width="80" height="40" ${XMLNS} viewBox="0 0 8 4"><title>Empty</title></svg>`)
      );
      expect(finalize('<svg viewBox="0 0 8 4"/>')).toBe(asFile(`<svg width="80" height="40" ${XMLNS} viewBox="0 0 8 4"/>`));
    });

    it('refuses markup that has no svg start tag to size, rather than writing an unsized file', () => {
      expect(() => finalize('<g width="2"/>')).toThrow(/does not open with an <svg> start tag/);
      expect(() => finalize('<svgx width="2"/>')).toThrow(/does not open with an <svg> start tag/);
      expect(() => finalize('<svg')).toThrow(/ends inside its <svg> start tag/);
      expect(() => finalize('<svg viewBox="0 0 8 4"')).toThrow(/ends inside its <svg> start tag/);
      expect(() => finalize('<svg viewBox="0 0 8 4>')).toThrow(/ends inside its <svg> start tag/);
      expect(() => finalize('<svg viewBox=0>')).toThrow(/unquoted value/);
    });

    it('escapes a document name that would otherwise break the XML', () => {
      const out = finalizeSvgMarkup('<svg viewBox="0 0 10 10"/>', {
        width: 10,
        height: 10,
        title: 'pET-28a(+) <eGFP> & "friends"',
      });
      expect(out).toContain('<title>pET-28a(+) &lt;eGFP&gt; &amp; &quot;friends&quot;</title>');
    });

    it('keeps an existing namespace rather than declaring a second one', () => {
      const out = finalizeSvgMarkup('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"/>', {
        width: 8,
        height: 8,
      });
      expect(out.match(/xmlns="http:\/\/www\.w3\.org\/2000\/svg"/g)).toHaveLength(1);
    });
  });

  describe('through the export path', () => {
    /**
     * Just enough of an element for captureSvg to measure, clone, style and serialize without a
     * browser: the test suite runs in node and the project carries no DOM library.
     */
    class FakeElement {
      parentElement: FakeElement | null = null;
      readonly children: FakeElement[];
      constructor(
        readonly tagName: string,
        private readonly attrs: [string, string][],
        children: FakeElement[] = [],
        private readonly onScreen = { width: 0, height: 0 }
      ) {
        this.children = children;
        children.forEach((child) => {
          child.parentElement = this;
        });
      }
      getAttribute(name: string): string | null {
        return this.attrs.find(([n]) => n === name)?.[1] ?? null;
      }
      setAttribute(name: string, value: string): void {
        const hit = this.attrs.find(([n]) => n === name);
        if (hit) hit[1] = value;
        else this.attrs.push([name, value]);
      }
      getBoundingClientRect() {
        return this.onScreen;
      }
      cloneNode(): FakeElement {
        const attrs = this.attrs.map(([n, v]): [string, string] => [n, v]);
        return new FakeElement(this.tagName, attrs, this.children.map((child) => child.cloneNode()), this.onScreen);
      }
      serialize(): string {
        const attrs = this.attrs.map(([n, v]) => ` ${n}="${v.replace(/&/g, '&amp;').replace(/"/g, '&quot;')}"`).join('');
        const inner = this.children.map((child) => child.serialize()).join('');
        return inner ? `<${this.tagName}${attrs}>${inner}</${this.tagName}>` : `<${this.tagName}${attrs}/>`;
      }
    }

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('exports a figure whose root has only a viewBox at its drawn size, with every child size intact', () => {
      // Shaped like the cloning studio's agarose gel (CloningAndGelStudio.tsx), the export the
      // review found this defect in: its first width and height are the glow filter's region.
      const el = (tag: string, attrs: Record<string, string>, children: FakeElement[] = []) =>
        new FakeElement(tag, Object.entries(attrs), children);
      const gel = new FakeElement(
        'svg',
        [
          ['viewBox', '0 0 430 350'],
          ['class', 'virtual-gel-svg'],
        ],
        [
          el('defs', {}, [el('filter', { id: 'cloning-gel-glow', x: '-30%', y: '-100%', width: '160%', height: '300%' })]),
          el('rect', { x: '0', y: '0', width: '430', height: '350', rx: '8', fill: '#090d16' }),
          el('rect', { x: '50', y: '20', width: '44', height: '10', rx: '2', fill: '#04060b' }),
          el('rect', { x: '52', y: '96', width: '40', height: '3.5', filter: 'url(#cloning-gel-glow)' }),
        ],
        // Shrunk to fit a narrow card on screen; the file is written at the size it was drawn at.
        { width: 312, height: 254 }
      );
      const card = el('div', {}, [gel]);
      vi.stubGlobal('document', { documentElement: el('html', {}, [card]) });
      vi.stubGlobal('getComputedStyle', () => ({ backgroundColor: 'rgb(9, 13, 22)', getPropertyValue: () => '' }));
      vi.stubGlobal(
        'XMLSerializer',
        class {
          serializeToString(node: FakeElement) {
            return node.serialize();
          }
        }
      );

      const capture = captureSvg(gel as unknown as SVGSVGElement, { title: 'pUC19 — virtual agarose gel' });

      expect([capture.cssWidth, capture.cssHeight]).toEqual([430, 350]);
      expect(capture.markup).toBe(
        asFile(
          '<svg width="430" height="350" viewBox="0 0 430 350" class="virtual-gel-svg" xmlns="http://www.w3.org/2000/svg">' +
            '<title>pUC19 — virtual agarose gel</title>' +
            '<rect x="0" y="0" width="100%" height="100%" fill="rgb(9, 13, 22)"/>' +
            '<defs><filter id="cloning-gel-glow" x="-30%" y="-100%" width="160%" height="300%"/></defs>' +
            '<rect x="0" y="0" width="430" height="350" rx="8" fill="#090d16"/>' +
            '<rect x="50" y="20" width="44" height="10" rx="2" fill="#04060b"/>' +
            '<rect x="52" y="96" width="40" height="3.5" filter="url(#cloning-gel-glow)"/>' +
            '</svg>'
        )
      );
    });
  });

  describe('tables', () => {
    const table: FigureTable = {
      headers: ['Enzyme', 'Cuts', 'Positions'],
      rows: [
        ['EcoRI', '1', '4'],
        ['BamHI', '2', '198, 1,204'],
        ['NotI', '0', ''],
      ],
      caption: 'Unique cutters in pET-28a(+)-eGFP',
    };

    it('writes tab-separated values a spreadsheet can open', () => {
      expect(delimitedText(table, 'tsv')).toBe(
        'Enzyme\tCuts\tPositions\nEcoRI\t1\t4\nBamHI\t2\t198, 1,204\nNotI\t0\t\n'
      );
    });

    it('quotes a comma-separated field that contains a comma or a quote', () => {
      const quoted = delimitedText(
        { headers: ['a'], rows: [['one, two'], ['he said "no"']] },
        'csv'
      );
      expect(quoted).toBe('a\n"one, two"\n"he said ""no"""\n');
    });

    it('never lets a cell break the row it is in', () => {
      const out = delimitedText(
        { headers: ['note'], rows: [['line one\nline two\tindented']] },
        'tsv'
      );
      expect(out.trimEnd().split('\n')).toHaveLength(2);
      expect(out).toContain('line one line two indented');
    });

    it('lays the values out in columns for the plain-text form', () => {
      const lines = plainTextTable(table).split('\n');
      expect(lines[0]).toBe('Unique cutters in pET-28a(+)-eGFP');
      expect(lines[2]).toBe('Enzyme  Cuts  Positions');
      expect(lines[3]).toBe('------  ----  ----------');
      expect(lines[4]).toBe('EcoRI   1     4');
      expect(lines[5]).toBe('BamHI   2     198, 1,204');
      // A trailing empty cell leaves no trailing spaces behind.
      expect(lines[6]).toBe('NotI    0');
    });
  });

  describe('PDF', () => {
    const image = { data: new Uint8Array([1, 2, 3, 4]), filter: 'FlateDecode' as const, pixelWidth: 4, pixelHeight: 2 };

    it('writes a one-page document sized from the image', () => {
      const pdf = buildPdfDocument(image, { createdAt: new Date(Date.UTC(2026, 10, 5, 9, 30, 0)) });
      const text = latin1(pdf);
      expect(text.startsWith('%PDF-1.4\n')).toBe(true);
      expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
      expect(text).toContain('/MediaBox [0 0 3 1.5]');
      expect(text).toContain('/Subtype /Image /Width 4 /Height 2');
      expect(text).toContain('/Filter /FlateDecode');
      expect(text).toContain('/CreationDate (D:20261105093000Z)');
    });

    it('addresses every object at the byte offset it really starts at', () => {
      // A PDF reader finds each object through the cross-reference table, so an offset measured in
      // JavaScript string length rather than bytes would make the file unopenable.
      const pdf = buildPdfDocument({ ...image, data: new Uint8Array([0xe9, 0xff, 0x00, 0x80]) });
      const text = latin1(pdf);
      const xrefAt = Number(text.slice(text.lastIndexOf('startxref') + 9).trim().split('\n')[0]);
      expect(text.slice(xrefAt, xrefAt + 4)).toBe('xref');

      const offsets = text
        .slice(xrefAt)
        .split('\n')
        .filter((line) => / 00000 n $/.test(line))
        .map((line) => Number(line.slice(0, 10)));
      expect(offsets).toHaveLength(6);
      offsets.forEach((offset, index) => {
        expect(text.slice(offset, offset + 8)).toBe(`${index + 1} 0 obj\n`);
      });
    });

    it('escapes a title that would close the PDF string early', () => {
      const pdf = buildPdfDocument(image, { title: 'Fold (MFE) \\ arc' });
      expect(latin1(pdf)).toContain('/Title (Fold \\(MFE\\) \\\\ arc)');
    });

    it('sizes the page from the CSS size, not the pixel count, so a 3x raster is not 3x the page', () => {
      const pdf = buildPdfDocument(
        { ...image, pixelWidth: 3540, pixelHeight: 900 },
        { pageWidthPt: 1180 * PX_TO_PT, pageHeightPt: 300 * PX_TO_PT }
      );
      expect(latin1(pdf)).toContain('/MediaBox [0 0 885 225]');
    });
  });

  describe('pixels', () => {
    it('composites a transparent pixel onto the page background', () => {
      const rgba = new Uint8Array([
        255, 0, 0, 255, // opaque red
        0, 0, 0, 0, // fully transparent
        0, 0, 0, 128, // half-transparent black
      ]);
      expect(Array.from(rgbaToRgb(rgba))).toEqual([255, 0, 0, 255, 255, 255, 127, 127, 127]);
    });

    it('composites onto a dark background when that is what the figure sat on', () => {
      const rgba = new Uint8Array([0, 0, 0, 0]);
      expect(Array.from(rgbaToRgb(rgba, [30, 33, 38]))).toEqual([30, 33, 38]);
    });

    it('deflates losslessly, so the PDF image is the figure and not an approximation of it', async () => {
      const original = new Uint8Array(3000);
      for (let i = 0; i < original.length; i += 1) original[i] = (i * 31) % 256;
      const compressed = await deflate(original);
      const stream = new DecompressionStream('deflate');
      const round = new Uint8Array(
        await new Response(new Blob([compressed as BlobPart]).stream().pipeThrough(stream)).arrayBuffer()
      );
      expect(Array.from(round)).toEqual(Array.from(original));
    });

    it('builds a complete PDF from raw pixels', async () => {
      const rgba = new Uint8Array(4 * 4 * 4).fill(200);
      const pdf = await rgbaToPdf(rgba, 4, 4, { cssWidth: 2, cssHeight: 2, title: 'tiny' });
      const text = latin1(pdf);
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('/Width 4 /Height 4');
      expect(text).toContain('/MediaBox [0 0 1.5 1.5]');
    });
  });

  describe('file names', () => {
    it('gives each format the extension its readers expect', () => {
      expect(figureFileName('pET-28a(+)-eGFP — Hydropathy', 'png')).toBe('pET-28a(+)-eGFP_—_Hydropathy.png');
      expect(figureFileName('Fold', 'jpeg')).toBe('Fold.jpg');
      expect(figureFileName('Fold', 'svg')).toBe('Fold.svg');
      expect(figureFileName('Fold', 'pdf')).toBe('Fold.pdf');
      expect(figureFileName('Fold', 'tsv')).toBe('Fold.tsv');
    });

    it('strips the characters a file system would refuse', () => {
      expect(figureFileName('a/b\\c:d*e?f"g<h>i|j', 'png')).toBe('a_b_c_d_e_f_g_h_i_j.png');
    });

    it('replaces an extension rather than appending to it', () => {
      expect(figureFileName('eGFP_Clone3_Sanger_Fwd.ab1', 'png')).toBe('eGFP_Clone3_Sanger_Fwd.png');
    });

    it('still produces a usable name when there is nothing left of the original', () => {
      expect(figureFileName('///', 'pdf')).toBe('MolBioCraft_Figure.pdf');
    });

    it('separates the drawing formats from the value formats', () => {
      expect(isImageFormat('png')).toBe(true);
      expect(isImageFormat('pdf')).toBe(true);
      expect(isImageFormat('tsv')).toBe(false);
      expect(FIGURE_FORMAT_META.tsv.mimeType).toContain('tab-separated-values');
    });
  });
});

describe('US-01M7DVNS AC3: the PNG and PDF of a rotated circular map rasterize its rotated SVG', () => {
  it('US-01M7DVNS AC3 the FigureExportButton PNG and PDF paint the same rotated markup as its SVG file, drawn where the screen draws the map', async () => {
    const React = await import('react');
    const { mountApp } = await import('./appHarness');
    const { LiveDocument, LiveElement, parseMarkup } = await import('./liveDom');
    const seq = 'ATGC'.repeat(750);
    const doc = {
      id: 'rot-x', name: 'pRotX', accession: 'ROT-X', sequence: seq, topology: 'circular' as const, moleculeType: 'DNA' as const,
      organism: '', description: '', primers: [], history: [], updatedAt: '2026-11-17T00:00:00.000Z',
      features: [
        { id: 'f1', name: 'bla', type: 'CDS', start: 1001, end: 1600, strand: 1 as const, color: '#e57373' },
        { id: 'f2', name: 'rop', type: 'gene', start: 2001, end: 2400, strand: -1 as const, color: '#64b5f6' },
      ],
    };
    const app = await mountApp();
    const realCreate = URL.createObjectURL;
    const realImage = (globalThis as { Image?: unknown }).Image;
    const blobs = new Map<string, Blob>();
    const painted: string[] = [];
    try {
      await app.restoreSession({ documents: [doc as never], activeDocId: doc.id, viewerTab: 'sequence-view', workspace: { mapRotation: { [doc.id]: 90 } } });
      const drawn = (root: InstanceType<typeof LiveElement>) =>
        [...root.querySelectorAll('[data-map-part="origin-wedge"]'), ...root.querySelectorAll('[data-map-part="feature-arc"]')].map((el) => [
          el.getAttribute('data-map-part'), el.getAttribute('data-draw-angle'), el.getAttribute('d') ?? el.getAttribute('x1'),
        ]);
      const onScreen = drawn(app.one('svg.plasmid-svg'));
      expect(onScreen.map((p) => p[0])).toEqual(['origin-wedge', 'feature-arc', 'feature-arc']);
      expect(onScreen[0][1], 'the restored map is turned to 90 degrees').toBe('90');
      const fileOf = (markup: string) => {
        const root = parseMarkup(markup.slice(markup.indexOf('<svg')), new LiveDocument()).find((n) => n instanceof LiveElement);
        if (!root) throw new Error('no <svg> in the markup');
        return root as InstanceType<typeof LiveElement>;
      };

      // The rasterizer's inputs, read where it takes them: the markup blob the Image loads, painted on a canvas.
      URL.createObjectURL = (obj: Blob | MediaSource) => {
        const url = realCreate(obj as Blob);
        blobs.set(url, obj as Blob);
        return url;
      };
      (globalThis as { Image?: unknown }).Image = class {
        decoding = '';
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        markup = '';
        set src(url: string) {
          const blob = blobs.get(url);
          if (!blob) { queueMicrotask(() => this.onerror?.()); return; }
          void blob.text().then((t) => { this.markup = t; this.onload?.(); });
        }
      };
      const liveCreate = app.doc.createElement.bind(app.doc);
      vi.spyOn(app.doc, 'createElement').mockImplementation(((tag: string) => {
        if (tag !== 'canvas') return liveCreate(tag);
        const canvas = { width: 0, height: 0, markup: '' };
        return Object.assign(canvas, {
          getContext: () => ({
            fillStyle: '',
            fillRect() {},
            drawImage(image: { markup: string }) { canvas.markup = image.markup; painted.push(image.markup); },
            getImageData: (_x: number, _y: number, w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4).fill(255) }),
          }),
          toBlob: (cb: (b: Blob) => void, type: string) => cb(new Blob([`${type} ${canvas.width}x${canvas.height}`], { type })),
        });
      }) as never);

      const exportAs = async (ext: string) => {
        const trigger = app.all('.circular-hud-actions .mbc-figure-export-trigger');
        expect(trigger, 'the circular map has one figure export').toHaveLength(1);
        await app.click(trigger[0]);
        const item = app.all('.circular-hud-actions .mbc-figure-export-item').filter((b) => b.textContent.trim().startsWith(ext));
        expect(item, `the figure menu offers ${ext}`).toHaveLength(1);
        const before = app.downloads().length;
        await app.click(item[0]);
        // The PDF encoder deflates the painted pixels before the file is saved: wait for the file, up to a bound.
        const until = performance.now() + 20_000;
        while (app.downloads().length === before && performance.now() < until) {
          await React.act(async () => { await new Promise((r) => setImmediate(r)); });
        }
        await app.settle();
        const files = app.downloads().slice(before).filter((f) => f.filename.toLowerCase().endsWith(`.${ext.toLowerCase()}`));
        expect(files, `one .${ext.toLowerCase()} saved: ${app.all(".mbc-figure-export-note, .statusbar-toast-text").map((n) => n.textContent).join(" / ")}`).toHaveLength(1);
        return files[0];
      };
      const svgFile = await (await exportAs('SVG')).text();
      expect(drawn(fileOf(svgFile)), 'the SVG file is drawn as the screen is').toEqual(onScreen);
      expect(painted, 'an SVG is not rasterized').toEqual([]);
      await exportAs('PNG');
      await exportAs('PDF');
      expect(painted, 'the PNG and the PDF each paint one drawing').toHaveLength(2);
      for (const [i, markup] of painted.entries()) {
        expect(drawn(fileOf(markup)), `${['PNG', 'PDF'][i]}: the painted markup is the rotated map`).toEqual(onScreen);
        expect(markup, `${['PNG', 'PDF'][i]}: the same markup as the SVG file`).toBe(svgFile);
      }
    } finally {
      URL.createObjectURL = realCreate;
      (globalThis as { Image?: unknown }).Image = realImage;
      app.unmount();
    }
  });
});
