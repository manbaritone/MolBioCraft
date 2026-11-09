// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MicrosatelliteDialog } from '../components/FragmentViews';

describe('Microsatellite Analysis options window', () => {
  it('offers loading a kit file next to the panel', () => {
    const html = renderToStaticMarkup(<MicrosatelliteDialog runs={[]} onApply={() => {}} onClose={() => {}} />);
    expect(html).toContain('Load kit file…');
    expect(html).toContain('accept=".xml,.txt,.csv,.tsv"');
    expect(html).toContain('OSIRIS LadderInfo');
  });
});
