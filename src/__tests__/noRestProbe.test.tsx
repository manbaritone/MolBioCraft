// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * US-01M6P2QG AC3: with the UI's REST discovery removed (D0174), the start-up splash completes in
 * the desktop runtime and in the web runtime without asking the shell for a REST endpoint and without
 * fetching anything from the local machine.
 *
 * The real App is mounted with appHarness's mountApp, which leaves src/lib/tauriIpc unmocked on a
 * Linux host, so the App and its splash run the real IPC module:
 *
 * - desktop: a stand-in Tauri shell (`__TAURI_INTERNALS__`) records every command the WebView invokes
 *   and answers a REST-info command the way the shell does, so a REST discovery would both show in the
 *   record and be handed an endpoint to call;
 * - web: the page is served from `localhost` (liveDom's location) in a development build (Vitest runs
 *   with `import.meta.env.DEV` set), the conditions under which the old web discovery fetched the
 *   companion server's health endpoint on the loopback address.
 *
 * In both, every fetch is recorded, the splash is first seen on the page (so a test that never mounted
 * it cannot pass), and the App's own timers are run until the splash has gone.
 *
 * Wrong implementations, and what catches each: the App's mount effect or the splash still running a
 * REST discovery (a REST command in the desktop record; a loopback fetch on the web); a discovery that
 * only fetches, on either runtime (the loopback fetch check covers both); a splash that waits on a
 * backend check that never settles, or whose completion was dropped with the check (the splash still
 * on the page after its timers have run).
 *
 * US-01M6P2WH AC1 (D0174): the desktop shell's own Rust sources no longer describe a REST server, REST
 * API, loopback address or the old port and path, so a doc comment orphaned by the removal (as round 1
 * left one above queue_open_files) cannot keep documenting a server the shell no longer runs.
 */

import nodeFs from 'node:fs';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mountApp, type AppHarness } from './appHarness';

const SPLASH = '.mbc-startup-splash-overlay';
/** A URL on the local machine: the loopback addresses and localhost, by name or by address. */
const LOOPBACK = /^[a-z]+:\/\/(127\.\d+\.\d+\.\d+|localhost|\[::1\]|0\.0\.0\.0)(:\d+)?(\/|$)/i;

interface TauriGlobals { __TAURI_INTERNALS__?: unknown; fetch: typeof fetch }
const g = globalThis as unknown as TauriGlobals;

let app: AppHarness | null = null;
const realFetch = g.fetch;

afterEach(() => {
  app?.unmount();
  app = null;
  g.fetch = realFetch;
  delete g.__TAURI_INTERNALS__;
});

/** Records every URL the page fetches; each fetch fails, as with no server listening. */
function recordFetches(): string[] {
  const urls: string[] = [];
  g.fetch = (async (input: RequestInfo | URL) => {
    urls.push(typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url);
    throw new TypeError('Failed to fetch');
  }) as typeof fetch;
  return urls;
}

/** Runs the App's timers until the splash has gone, at most 10 s of app time, and says whether it went. */
async function runSplashToCompletion(harness: AppHarness): Promise<boolean> {
  for (let elapsed = 0; elapsed < 10_000; elapsed += 250) {
    await React.act(async () => { vi.advanceTimersByTime(250); });
    await harness.settle();
    if (harness.all(SPLASH).length === 0) return true;
  }
  return false;
}

describe('startup splash completes without a REST probe', () => {
  it('in the desktop runtime: no REST command is invoked and nothing on the local machine is fetched', async () => {
    const fetched = recordFetches();
    const invoked: string[] = [];
    g.__TAURI_INTERNALS__ = {
      invoke: async (cmd: string) => {
        invoked.push(cmd);
        // The shell's reply to the REST-info command: an active server, so a discovery would go on to use it.
        if (/rest/i.test(cmd)) return { active: true, port: 8080, base_url: 'http://127.0.0.1:8080/api/v1' };
        if (cmd === 'cmd_take_pending_open_files') return [];
        if (cmd === 'plugin:event|listen') return 1;
        return null;
      },
      transformCallback: () => 0,
    };

    app = await mountApp();
    expect(app.all(SPLASH)).toHaveLength(1);
    // The stand-in shell is the one the App talks to (a guard: an App that never reached it proves nothing).
    expect(invoked.length).toBeGreaterThan(0);

    expect(await runSplashToCompletion(app)).toBe(true);
    expect(invoked.filter((cmd) => /rest/i.test(cmd))).toEqual([]);
    expect(fetched.filter((url) => LOOPBACK.test(url))).toEqual([]);
  });

  it('in the web runtime: nothing on the local machine is fetched, even in a development build served from localhost', async () => {
    const fetched = recordFetches();
    expect(g.__TAURI_INTERNALS__).toBeUndefined();
    expect(import.meta.env.DEV).toBe(true);

    app = await mountApp();
    expect(app.win.location.hostname).toBe('localhost');
    expect(app.all(SPLASH)).toHaveLength(1);

    expect(await runSplashToCompletion(app)).toBe(true);
    expect(fetched.filter((url) => LOOPBACK.test(url))).toEqual([]);
  });
});

describe('the desktop shell runs no REST server', () => {
  /** What a shell source says only while it still serves REST: the server, its API, its loopback address, port or path. */
  const STALE_REST = /REST (server|API)|RESTful|loopback|127\.0\.0\.1|18420|api\/v1/i;

  /** Every Rust source under src-tauri/src, as a path relative to the repository root. */
  function shellSources(dir = 'src-tauri/src/'): string[] {
    return nodeFs.readdirSync(new URL(`../../${dir}`, import.meta.url), { withFileTypes: true }).flatMap((entry) =>
      entry.isDirectory() ? shellSources(`${dir}${entry.name}/`) : entry.name.endsWith('.rs') ? [`${dir}${entry.name}`] : []);
  }

  it('its sources name no REST server, REST API, loopback address, 127.0.0.1, port 18420 or /api/v1', () => {
    const sources = shellSources();
    // A guard: the walk reached the shell's entry point and its command modules.
    expect(sources).toEqual(expect.arrayContaining(['src-tauri/src/main.rs', 'src-tauri/src/commands/mod.rs']));
    const stale = sources.flatMap((file) =>
      nodeFs.readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8').split('\n')
        .flatMap((line, i) => (STALE_REST.test(line) ? [`${file}:${i + 1}: ${line.trim()}`] : [])));
    expect(stale).toEqual([]);
  });
});
