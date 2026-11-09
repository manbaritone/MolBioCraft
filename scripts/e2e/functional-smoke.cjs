// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0
/*
 * Functional smoke test: drives the built web workbench in headless Chromium
 * and checks the regressions fixed by the functional-integrity audit
 * (MOLBIOCRAFT_FUNCTIONAL_INTEGRITY_AUDIT.md, section C).
 *
 *   npm run test:e2e                                 # = node scripts/e2e/functional-smoke.cjs --serve
 *
 * --serve: fails unless public/molbiocraft_wasm.wasm (written by `npm run wasm:build`) is present
 * and non-empty and nothing already answers on port 4173, runs `npm run build`, serves dist/ with
 * `vite preview --port 4173 --strictPort`, waits until it answers, runs the scenarios against
 * http://localhost:4173/ and stops the server when the run passes, fails, errors or is interrupted
 * (Ctrl-C, SIGTERM, SIGHUP); its exit code is the smoke result (130/143/129 when interrupted).
 *
 * Without --serve it tests a server you run yourself:
 *   npm run build && npx vite preview --port 4173 &
 *   node scripts/e2e/functional-smoke.cjs            # BASE_URL defaults to http://localhost:4173/
 *
 * Needs the `playwright` devDependency and its Chromium (`npx playwright install chromium`;
 * `--with-deps` on a bare Linux). Shortcuts are pressed with ControlOrMeta: Ctrl on Linux and
 * Windows, Cmd on macOS, the modifier the app maps them to. Prints one PASS/FAIL line per scenario
 * and "N/13 scenarios passed"; exits 0 only when all 13 ran and passed, so a failed scenario, a
 * script error and a run in which no scenario ran all exit 1.
 */
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const SERVE = process.argv.includes('--serve');
const PREVIEW_PORT = 4173;
const BASE_URL = SERVE ? `http://localhost:${PREVIEW_PORT}/` : (process.env.BASE_URL || 'http://localhost:4173/');
const SCENARIO_COUNT = 13; // the record() calls below; a run that records any other number fails
const ROOT = path.resolve(__dirname, '..', '..');
const results = [];
const record = (name, pass, detail = '') => { results.push({ name, pass, detail }); };
let browser = null;
let server = null;

async function runScenarios() {
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const pageErrors = [];
  page.on('pageerror', (e) => pageErrors.push(e.message));
  const banner = async () => (await page.locator('.statusbar-toast-text').allTextContents()).join(' | ');
  const menu = async (...path) => {
    await page.keyboard.press('Escape');
    await page.mouse.move(700, 600);
    await page.waitForTimeout(200);
    await page.locator('[aria-label="Main Menu Bar"] >> text=' + path[0]).first().click();
    for (const label of path.slice(1)) {
      await page.waitForTimeout(150);
      const handle = await page.locator('.desktop-menu-popup').last().getByText(label, { exact: true }).first().elementHandle({ timeout: 5000 });
      await handle.evaluate((el) => el.click());
    }
    await page.waitForTimeout(400);
  };
  const dialogTitle = async () => {
    const d = page.locator('dialog[open]');
    return (await d.count()) ? (await d.first().innerText()).split('\n')[0] : '';
  };
  const statusLine = async () => (await page.locator('footer, .mbc-statusbar, [class*="statusbar"]').first().innerText().catch(() => ''));

  await page.goto(BASE_URL);
  await page.waitForTimeout(9000);

  // S1: Sample session, Reverse Complement via Ctrl+Shift+R (menu-derived shortcut; reload blocker fixed)
  await page.getByText('Sample Project', { exact: true }).first().click();
  await page.waitForTimeout(1500);
  await page.locator('.mbc-viewer-canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press('ControlOrMeta+Shift+R');
  await page.waitForTimeout(800);
  let b = await banner();
  record('S1 Ctrl+Shift+R runs Reverse Complement on Linux (shortcut was swallowed by reload blocker)', /Reverse Complement/.test(b), b);

  // S2: Unsaved-changes guard on New Session > Blank
  await menu('File', 'New Session', 'Blank Session');
  let t = await dialogTitle();
  record('S2a New Session › Blank asks before discarding unsaved edits', /Unsaved Changes/.test(t), t);
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click();
  await page.waitForTimeout(400);
  let status = await statusLine();
  record('S2b Cancel keeps the session', /Sample_Session/.test(status), status.slice(0, 120));
  await menu('File', 'New Session', 'Blank Session');
  await page.locator('dialog[open]').getByRole('button', { name: 'Discard Changes' }).click();
  await page.waitForTimeout(800);
  status = await statusLine();
  record('S2c Discard starts the blank session', /Untitled_Session/.test(status), status.slice(0, 120));

  // S3: Undo history does not leak into the new session
  await page.keyboard.press('ControlOrMeta+Z');
  await page.waitForTimeout(500);
  b = await banner();
  record('S3 Ctrl+Z in the new session does not replay the previous session', !/Undid/.test(b), b);

  // S4: Vector catalog opens in a blank session
  await page.getByRole('button', { name: /Vectors/ }).first().click().catch(() => {});
  await page.waitForTimeout(1500);
  const canvasText = await page.locator('.mbc-viewer-canvas').first().innerText().catch(() => '');
  record('S4 Vectors opens the vector studio in a blank session (was a silent no-op)', /vector/i.test(canvasText) && canvasText.length > 200, canvasText.slice(0, 100).replace(/\n/g, ' '));

  // S5: Sample library again (blank session is pristine: no prompt), trash a doc, Empty Trash asks
  await menu('File', 'New Session', 'Starter & Import', 'Sample Project');
  await page.waitForTimeout(800);
  t = await dialogTitle();
  if (/Unsaved|Autosaved/.test(t)) { await page.locator('dialog[open]').getByRole('button', { name: /Discard/ }).click(); await page.waitForTimeout(800); }
  record('S5a Pristine blank session is replaced without a prompt', !/Unsaved/.test(t), t || '(no dialog)');
  await menu('File', 'Favorites & Trash', 'Move to Trash');
  b = await banner();
  record('S5b Move to Trash moves the active document', /Moved 1 document to Deleted Items/.test(b), b);
  await menu('File', 'Favorites & Trash', 'Empty Trash');
  t = await dialogTitle();
  record('S5c Empty Trash asks for confirmation before permanent erase', /Empty Deleted Items/.test(t), t);
  await page.locator('dialog[open]').getByRole('button', { name: 'Cancel' }).click().catch(() => {});

  // S6: every General-tab preference is wired (44c4c8f), so none is disabled, the dialog says
  // they all apply immediately, and the retired "not connected" note is gone (BG-01M6ZCXA)
  await page.keyboard.press('ControlOrMeta+,');
  await page.waitForTimeout(800);
  const disabled = await page.locator('dialog[open] input:disabled, dialog[open] select:disabled').count();
  const note = await page.locator('dialog[open]').getByText(/All preferences are saved automatically/).count();
  const staleNote = await page.locator('dialog[open]').getByText(/not connected to the workbench yet/).count();
  const live = await page.locator('dialog[open] #prefs-appearance-select:enabled').count();
  record('S6 Preferences (General tab): every control is live and the dialog says changes apply immediately', disabled === 0 && note > 0 && staleNote === 0 && live === 1, `disabled=${disabled} note=${note} staleNote=${staleNote} appearanceEnabled=${live}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // S7: Filter Folder opens and focuses the filter field (focused a missing element before)
  await page.keyboard.press('ControlOrMeta+Alt+F');
  await page.waitForTimeout(500);
  const focusedId = await page.evaluate(() => document.activeElement && document.activeElement.id);
  record('S7 Ctrl+Alt+F focuses the document filter', focusedId === 'mbc-folder-filter-input', String(focusedId));

  // S8: Shift+Ctrl+R typed in a text field is still blocked as a hard reload
  // (pass-2 review finding: the reload blocker skipped Shift, and the shortcut
  // dispatcher ignores text fields, so nothing cancelled the browser reload).
  await page.evaluate(() => {
    window.__mbcReloadChord = null;
    window.addEventListener('keydown', (ev) => {
      if ((ev.ctrlKey || ev.metaKey) && ev.shiftKey && (ev.key === 'R' || ev.key === 'r')) {
        window.__mbcReloadChord = ev.defaultPrevented;
      }
    });
  });
  await page.locator('#mbc-folder-filter-input').focus();
  await page.keyboard.press('ControlOrMeta+Shift+R');
  await page.waitForTimeout(300);
  const reloadBlocked = await page.evaluate(() => window.__mbcReloadChord);
  record('S8 Shift+Ctrl+R in a text field cannot hard-reload (default prevented)', reloadBlocked === true, String(reloadBlocked));
  await page.keyboard.press('Escape');

  record('No uncaught page errors', pageErrors.length === 0, pageErrors.slice(0, 3).join(' || '));
}

/** Prints every recorded scenario and the passed/total line; returns 0 only when all SCENARIO_COUNT ran and passed. */
function report(error) {
  for (const r of results) console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.name} :: ${String(r.detail).slice(0, 120).replace(/\n/g, ' ')}`);
  if (error) console.error('SMOKE ERROR', error.message);
  const passed = results.filter((r) => r.pass).length;
  const ok = !error && results.length === SCENARIO_COUNT && passed === SCENARIO_COUNT;
  const ran = results.length === SCENARIO_COUNT ? '' : ` (${results.length} of ${SCENARIO_COUNT} ran)`;
  console.log(`${ok ? 'SMOKE PASSED' : 'SMOKE FAILED'}: ${passed}/${SCENARIO_COUNT} scenarios passed${ran}`);
  return ok ? 0 : 1;
}

/** True when an HTTP server answers `url` (any status); false when nothing does. */
async function answers(url) {
  try {
    await fetch(url, { signal: AbortSignal.timeout(2000) });
    return true;
  } catch {
    return false;
  }
}

function requireWasm() {
  const wasm = path.join(ROOT, 'public', 'molbiocraft_wasm.wasm');
  let size;
  try {
    size = fs.statSync(wasm).size;
    fs.accessSync(wasm, fs.constants.R_OK);
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`${wasm} is missing; run npm run wasm:build first`);
    throw new Error(`${wasm} is unreadable (${e.code}); run npm run wasm:build first`);
  }
  if (size === 0) throw new Error(`${wasm} is empty; run npm run wasm:build first`);
}

const runShell = (command) => new Promise((resolve, reject) => {
  const child = spawn(command, { cwd: ROOT, stdio: 'inherit', shell: true });
  child.on('error', reject);
  child.on('exit', (code, signal) => resolve(code === null ? `signal ${signal}` : code));
});

function stopServer() {
  if (!server || server.exitCode !== null || server.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => server.kill('SIGKILL'), 5000);
    server.once('exit', () => { clearTimeout(force); resolve(); });
    server.kill('SIGTERM');
  });
}

/** Builds the web app and serves it with `vite preview` on PREVIEW_PORT; resolves once it answers. */
async function buildAndServe() {
  // Last resort when the process exits without reaching stopServer(): an interrupt below calls process.exit().
  process.on('exit', () => { if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGTERM'); });
  for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143], ['SIGHUP', 129]]) {
    process.on(signal, () => { console.error(`SMOKE INTERRUPTED (${signal}): stopping the preview server`); process.exit(code); });
  }
  requireWasm();
  if (await answers(BASE_URL)) throw new Error(`something already answers on ${BASE_URL}; stop it so the smoke test runs against this build`);
  const built = await runShell('npm run build');
  if (built !== 0) throw new Error(`npm run build failed (exit ${built})`);
  const vite = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js');
  server = spawn(process.execPath, [vite, 'preview', '--port', String(PREVIEW_PORT), '--strictPort'], { cwd: ROOT, stdio: 'inherit' });
  const deadline = Date.now() + 60000;
  for (;;) {
    if (server.exitCode !== null || server.signalCode !== null) throw new Error(`vite preview exited (${server.exitCode ?? server.signalCode}) before answering on ${BASE_URL}`);
    if (await answers(BASE_URL)) return;
    if (Date.now() > deadline) throw new Error(`vite preview did not answer on ${BASE_URL} within 60 s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

(async () => {
  let error = null;
  try {
    if (SERVE) await buildAndServe();
    await runScenarios();
  } catch (e) {
    error = e;
  }
  if (browser) await browser.close().catch(() => {});
  const code = report(error);
  await stopServer();
  process.exit(code);
})();
