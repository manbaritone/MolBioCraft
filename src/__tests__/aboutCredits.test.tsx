/// <reference types="vite/client" />
// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import nodeFs from 'node:fs';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AboutMolBioCraftModal } from '../components/MenusPreferencesAndBlastModal';

// Read from disk: a `?raw` CSS import comes back empty under Vitest's CSS handling.
const appCss = nodeFs.readFileSync(new URL('../App.css', import.meta.url), 'utf8');

const NAMES = ['Thanakrit Wongsatit', 'Krittanai Trisakulwattana'] as const;

function renderAbout(): string {
  return renderToStaticMarkup(React.createElement(AboutMolBioCraftModal, { onClose: () => {} }));
}

function countOf(haystack: string, needle: string): number {
  return haystack.split(needle).length - 1;
}

/** The markup of the section whose labelling heading reads exactly 'Credits'. */
function creditsSection(html: string): string {
  const heading = /<(h[1-6]) id="([^"]+)"[^>]*>Credits<\/\1>/.exec(html);
  expect(heading, 'a heading that reads exactly "Credits"').not.toBeNull();
  const headingId = heading![2];
  const open = new RegExp(`<section[^>]*aria-labelledby="${headingId}"[^>]*>`).exec(html);
  expect(open, 'a section labelled by the Credits heading').not.toBeNull();
  const start = open!.index;
  const end = html.indexOf('</section>', start);
  expect(end).toBeGreaterThan(start);
  return html.slice(start, end + '</section>'.length);
}

function textOf(markup: string): string {
  return markup.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

describe('About dialog credits', () => {
  it('US-01M7CCPZ AC1 lists Thanakrit Wongsatit then Krittanai Trisakulwattana under a Credits heading, once each, with equal prominence', () => {
    const html = renderAbout();
    const section = creditsSection(html);

    // Each name appears exactly once in the whole dialog, and inside the Credits section.
    for (const name of NAMES) {
      expect(countOf(html, name), `${name} appears once in the dialog`).toBe(1);
      expect(section).toContain(name);
    }
    // In the order the operator gave them.
    expect(section.indexOf(NAMES[0])).toBeLessThan(section.indexOf(NAMES[1]));

    // The section sits beneath the developer attribution.
    const attribution = html.indexOf('Developed by <strong>Bundit Boonyarit</strong>');
    expect(attribution).toBeGreaterThan(-1);
    expect(attribution).toBeLessThan(html.indexOf(section));

    // Each name is the whole text of its own element, and both elements share tag and class.
    const holders = NAMES.map((name) => {
      const m = new RegExp(`<(\\w+) class="([^"]+)"[^>]*>${name}</\\1>`).exec(section);
      expect(m, `${name} is the sole text of a classed element`).not.toBeNull();
      return { tag: m![1], cls: m![2] };
    });
    expect(holders[0]).toEqual(holders[1]);
    expect(holders[0].tag).not.toMatch(/^(strong|b|em|h[1-6])$/);

    // Plain selectable text: not a link or button, and selection is switched back on,
    // because the app body turns it off for everything beneath it.
    expect(appCss).toMatch(/\bbody\s*\{[^}]*user-select:\s*none/);
    expect(section).not.toMatch(/<(a|button)\b/);
    expect(section).not.toMatch(/user-select:\s*none/);
    const sectionOpen = /^<section[^>]*>/.exec(section)![0];
    expect(sectionOpen).toMatch(/(^|[;"])user-select:text(;|")/);
    expect(sectionOpen).toMatch(/-webkit-user-select:text(;|")/);
  });

  it('US-01M7CCPZ AC2 keeps the attribution, version, licence, copyright and notices, and the credits name no role, affiliation or artwork', () => {
    const html = renderAbout();
    const section = creditsSection(html);

    // The credits carry only the heading and the two names.
    const text = textOf(section);
    expect(text).toBe(`Credits ${NAMES[0]} ${NAMES[1]}`);
    for (const word of ['developer', 'advisor', 'designer', 'logo', 'artwork']) {
      expect(text.toLowerCase(), `credits must not say "${word}"`).not.toContain(word);
    }
    // No affiliation link and no artwork inside the credits.
    expect(section).not.toMatch(/<(a|img|svg)\b/);

    // Everything the dialog said before is still there, unchanged.
    expect(html).toContain('Developed by <strong>Bundit Boonyarit</strong>');
    expect(html).toContain('MolBioCraft v1.0.0');
    expect(html).toContain('CC BY-NC 4.0 (SPDX: CC-BY-NC-4.0) — Open-Source Research Workbench');
    expect(html).toContain('Copyright © 2026 Bundit Boonyarit. All rights reserved.');
    expect(html).toContain('https://github.com/manbaritone/MolBioCraft/issues');
    expect(html).toContain(
      'Permitted for personal study, classroom teaching, and non-commercial academic research.'
    );
    expect(html).toContain('Commercial use requires prior written authorization from the developer.');
  });

  it('US-01M7CCPZ AC3 scrolls the dialog body instead of clipping it, with the close control outside the scroller', () => {
    const html = renderAbout();
    const bodyOpen = /<div class="about-single-page-body"([^>]*)>/.exec(html);
    expect(bodyOpen, 'the About body').not.toBeNull();
    const style = /style="([^"]*)"/.exec(bodyOpen![1])?.[1] ?? '';

    expect(style).toMatch(/(^|;)overflow-y:auto(;|$)/);
    const maxHeight = /(^|;)max-height:([^;]+)/.exec(style)?.[2] ?? 'none';
    expect(maxHeight).not.toBe('none');
    // A flex child of the dialog column must be allowed to shrink below its content to scroll.
    expect(style).toMatch(/(^|;)min-height:0(;|$)/);
    // Centring an overflowing column pushes its top out of scroll reach; start-align instead.
    expect(style).toMatch(/(^|;)justify-content:flex-start(;|$)/);

    // The stylesheet cannot override the inline overflow with !important.
    const rule = /\.about-single-page-body\s*\{([^}]*)\}/.exec(appCss);
    expect(rule, 'the .about-single-page-body rule in App.css').not.toBeNull();
    expect(rule![1]).not.toContain('!important');

    // The credits scroll with the body; the Close button stays in the footer outside it.
    const bodyStart = bodyOpen!.index;
    const footerStart = html.indexOf('about-single-page-footer');
    expect(footerStart).toBeGreaterThan(bodyStart);
    const body = html.slice(bodyStart, footerStart);
    expect(body).toContain(creditsSection(html));
    expect(body).not.toContain('>Close</button>');
    expect(html.slice(footerStart)).toContain('>Close</button>');
  });
});
