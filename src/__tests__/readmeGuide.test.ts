// SPDX-License-Identifier: CC-BY-NC-4.0
// US-01M80N12: the README says what 1.1.0 brings (only what the CHANGELOG says), has a Contents
// line whose links all resolve, cites the right month and version, and describes Protein & 3D,
// the Node version CI builds on and the local Windows/Linux cross-builds.
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import { describe, expect, it } from 'vitest';

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const read = (rel: string): string => fs.readFileSync(path.join(REPO, ...rel.split('/')), 'utf8').replace(/\r/g, '');
const README = read('README.md');
const CHANGELOG = read('CHANGELOG.md');
const VERSION = (JSON.parse(read('package.json')) as { version: string }).version;

/** The body of a `## ` section, up to the next `## ` heading; '' when there is no such heading. */
const section = (md: string, heading: string): string => {
  const start = md.indexOf(`\n## ${heading}\n`);
  if (start < 0) return '';
  const next = md.indexOf('\n## ', start + 4);
  return md.slice(start, next < 0 ? undefined : next);
};

/** GitHub's heading anchor: the rendered text, lower case, punctuation dropped, spaces as hyphens. */
const slug = (heading: string): string =>
  heading
    .replace(/&amp;/g, '&')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, '')
    .replace(/\s/g, '-');

/** The `## ` headings outside fenced code, in order. */
const headings = (md: string): string[] => {
  let fenced = false;
  const out: string[] = [];
  for (const line of md.split('\n')) {
    if (line.startsWith('```')) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) out.push(line.slice(3).trim());
  }
  return out;
};

describe('US-01M80N12 the README guides a reader to 1.1.0', () => {
  it("readmeGuide AC1 the What's New section lists only CHANGELOG 1.1.0 entries and links the full notes", () => {
    const order = headings(README);
    const at = order.indexOf(`What's New in ${VERSION}`);
    expect(at, "a What's New section for this version").toBeGreaterThan(0);
    expect(order[at - 1], 'it follows Overview').toBe('Overview');
    expect(order[at + 1], 'it precedes What You Can Do').toBe('What You Can Do');

    const notes = section(CHANGELOG, `[${VERSION}] - 2026-11-22`);
    const changelogTitles = new Set([...notes.matchAll(/^- \*\*(.+?)\*\*/gm)].map((m) => m[1]));
    expect(changelogTitles.size, 'the CHANGELOG [1.1.0] entries').toBeGreaterThan(5);

    const body = section(README, `What's New in ${VERSION}`);
    const bullets = body.split('\n').filter((l) => l.startsWith('- '));
    expect(bullets.length, 'at least six highlights').toBeGreaterThanOrEqual(6);
    for (const b of bullets) {
      const title = /^- \*\*(.+?)\*\*/.exec(b)?.[1];
      expect(title, `${b.slice(0, 60)} starts with a bold title`).toBeDefined();
      expect(changelogTitles.has(title as string), `"${title}" is a CHANGELOG [${VERSION}] entry title`).toBe(true);
    }
    expect(body).toContain('(CHANGELOG.md#110---2026-11-22)');
  });

  it('readmeGuide AC2 the Contents line links every section by its GitHub anchor', () => {
    const contents = README.split('\n').find((l) => l.startsWith('**Contents:**')) ?? '';
    expect(contents, 'a **Contents:** line').not.toBe('');
    expect(README.indexOf(contents), 'after the header block').toBeGreaterThan(README.indexOf('</div>'));
    const links = [...contents.matchAll(/\[([^\]]+)\]\(#([^)]+)\)/g)].map((m) => m[2]);
    const sections = headings(README);
    expect(links, 'one link per section, in order').toEqual(sections.map(slug));
  });

  it('readmeGuide AC3 the BibTeX month and version match CITATION.cff and package.json', () => {
    const released = /^date-released: "(\d{4})-(\d{2})-\d{2}"$/m.exec(read('CITATION.cff'));
    expect(released, 'CITATION.cff date-released').not.toBeNull();
    const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
    const bib = section(README, 'Citation');
    expect(bib).toMatch(new RegExp(`^month = ${months[Number(released![2]) - 1]},$`, 'm'));
    expect(bib).toMatch(new RegExp(`^year = \\{${released![1]}\\}$`, 'm'));
    expect(bib).toContain(`version = {${VERSION}},`);
  });

  it('readmeGuide AC4 the README describes Protein & 3D, Node 22 and the local cross-builds', () => {
    const studio = README.split('\n').find((l) => l.startsWith('10. **Protein & 3D**')) ?? '';
    for (const term of ['ProtParam', 'hydropathy', 'Mol*']) expect(studio, `Protein & 3D names ${term}`).toContain(term);
    const build = section(README, 'Under the Hood &amp; Building from Source');
    expect(build).toMatch(/CI builds on Node\.js 22/);
    expect(build).toContain('cargo xwin check --target x86_64-pc-windows-msvc --manifest-path src-tauri/Cargo.toml');
    expect(build).toContain('ubuntu:22.04');
    expect(build).toMatch(/\.msi[^.]*only on Windows/);
  });
});
