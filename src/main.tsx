// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { isNativeMacMenuBarActive, shouldBlockReloadChord } from './platform/macosMenuBridge';
import { detectHostOS } from './platform/osPlatform';

const nativeMacMenuBar = isNativeMacMenuBarActive(detectHostOS());
import './App.css';

try {
  const meta = document.querySelector<HTMLMetaElement>('meta[name="color-scheme"]');
  if (meta) {
    meta.content = localStorage.getItem('color-scheme') ?? 'light dark';
  }
} catch {
  // Ignore storage restrictions in sandboxed environments
}

// Eliminate native browser context menu (which includes "Reload", "Back", "Inspect")
window.addEventListener('contextmenu', (e) => {
  const target = e.target as HTMLElement | null;
  const isInput = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable);
  if (!isInput) {
    e.preventDefault();
  }
});

// Remove reload function completely (Cmd+R, Ctrl+R, F5)
window.addEventListener('keydown', (e) => {
  // Shift+Cmd/Ctrl+R (Reverse Complement) is blocked as a hard reload too,
  // except on the native macOS menu bar, whose key equivalent runs it.
  if (shouldBlockReloadChord(e, nativeMacMenuBar)) {
    e.preventDefault();
  }
  if (e.key === 'F5') {
    e.preventDefault();
  }
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary label="MolBioCraft" root>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
