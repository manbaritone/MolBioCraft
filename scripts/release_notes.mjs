#!/usr/bin/env node
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * Prints the release notes for one version: the body of its `## [<version>]` section in
 * CHANGELOG.md (Keep a Changelog), without the heading and up to the next `## [` heading, trimmed.
 * The publish job of .github/workflows/release.yml writes them to release-notes.md and hands them
 * to the GitHub Release (CR-01M704A6).
 *
 *   node scripts/release_notes.mjs 1.0.0                 > release-notes.md
 *   node scripts/release_notes.mjs 1.0.0 path/CHANGELOG.md
 *
 * Exits 1, printing nothing to stdout, when the version is missing, has no section, has two, or its section
 * is empty or holds only headings, so a tag without notes fails before anything is published.
 */
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const [version, changelogArg] = process.argv.slice(2);
const changelog = changelogArg ?? path.join(path.dirname(url.fileURLToPath(import.meta.url)), '..', 'CHANGELOG.md');

function fail(message) {
  console.error(`release_notes: ${message}`);
  process.exit(1);
}

if (!version) fail('usage: node scripts/release_notes.mjs <version> [CHANGELOG.md]');

const lines = fs.readFileSync(changelog, 'utf8').replace(/\r\n/g, '\n').split('\n');
// The heading is `## [<version>]`, optionally followed by ` - <date>`; the version is compared as text.
const heads = lines.flatMap((l, i) => (l.startsWith(`## [${version}]`) ? [i] : []));
if (heads.length === 0) fail(`${changelog} has no "## [${version}]" section`);
if (heads.length > 1) fail(`${changelog} has ${heads.length} "## [${version}]" sections (lines ${heads.map((i) => i + 1).join(', ')}); keep one`);
const start = heads[0];
const next = lines.findIndex((l, i) => i > start && l.startsWith('## ['));
const section = lines.slice(start + 1, next < 0 ? lines.length : next);
const body = section.join('\n').trim();
// headings with nothing under them (an "### Added" left from the template) are not notes
if (section.every((l) => l.trim() === '' || l.startsWith('#'))) fail(`the "## [${version}]" section of ${changelog} is empty`);

process.stdout.write(`${body}\n`);
