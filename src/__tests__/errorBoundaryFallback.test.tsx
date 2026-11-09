// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ErrorBoundary } from '../components/ErrorBoundary';

function fallbackMarkup(root: boolean): string {
  const boundary = new ErrorBoundary({ label: 'X', root, children: null });
  boundary.state = { error: new Error('boom') };
  return renderToStaticMarkup(<>{boundary.render()}</>);
}

describe('ErrorBoundary fallback text', () => {
  it('does not tell the user their documents are safe when the whole workbench crashed', () => {
    const root = fallbackMarkup(true);
    expect(root).not.toMatch(/unaffected/);
    expect(root).toMatch(/unsaved changes in this window were lost/);
    expect(root).toMatch(/Restart workbench/);
  });

  it('keeps the reassuring message for a contained region', () => {
    const region = fallbackMarkup(false);
    expect(region).toMatch(/Your documents are unaffected/);
    expect(region).toMatch(/Try again/);
    expect(region).toMatch(/boom/);
  });
});
