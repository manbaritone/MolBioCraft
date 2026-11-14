// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * BG-01M7CDQT: a test run in the main checkout collects the main checkout's tests only.
 *
 * Agent worktrees live inside the repository (Claude Code's under .claude/, sprint lanes under
 * sdlc-studio/.local/worktrees/), so a path-filtered run would otherwise also run each worktree's
 * copy against that tree's code: a Verify expecting one test file reads four, and a lane's
 * half-built test fails another unit's check.
 */

import { describe, expect, it } from 'vitest';
import viteConfig from '../../vite.config';

type ConfigFn = (env: { mode: string; command: 'serve' | 'build' }) => { test?: { exclude?: string[] } };

const exclude = (viteConfig as unknown as ConfigFn)({ mode: 'test', command: 'serve' }).test?.exclude ?? [];
// The folder each "any depth, whole folder" exclude glob keeps out; other globs give null.
const excludedDirs = exclude
  .map((glob) => /^\*\*\/([^*/]+)\/\*\*$/.exec(glob)?.[1] ?? null)
  .filter((dir): dir is string => dir !== null);
/** True when some path segment of `path` is a folder the run keeps out. */
const excluded = (path: string) => path.split('/').some((segment) => excludedDirs.includes(segment));

describe('BG-01M7CDQT the test run stays in the main checkout', () => {
  it('skips the copies in sprint lane worktrees and in Claude Code worktrees', () => {
    expect(excluded('sdlc-studio/.local/worktrees/lane-US01M7CC6K/src/__tests__/figureExport.test.ts')).toBe(true);
    expect(excluded('.claude/worktrees/agent-1/src/__tests__/figureExport.test.ts')).toBe(true);
  });

  it('still collects the main checkout tests', () => {
    expect(excluded('src/__tests__/figureExport.test.ts')).toBe(false);
  });
});
