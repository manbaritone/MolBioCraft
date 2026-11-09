// Copyright 2026 MolBioCraft Contributors
// SPDX-License-Identifier: CC-BY-NC-4.0

/**
 * The versioned pre-push hook, scripts/git-hooks/pre-push (D0016, D0020, BG-01M6T4EH, BG-01M6WGTY,
 * BG-01M6XSZ9, BG-01M6XSCW).
 *
 * The hook is run as git runs it, `sh pre-push <remote> <url>` from the top of the pushing
 * repository with one `<local ref> <local sha> <remote ref> <remote sha>` line per pushed ref on
 * stdin, in throwaway repositories built in a temporary folder. Where git's own behaviour matters (a
 * replace ref, a tag on a tree), the hook is also installed in the throwaway repository and a real
 * `git push` to a bare repository in the same folder is refused, and the bare repository is checked
 * to hold nothing of it. Each case is a branch from one clean root commit, so a case's history holds
 * only what that case commits.
 *
 * Local-folder guard: a ref whose history holds any path under the top-level folder the hook's
 * LOCAL_FOLDER names is refused, whether the tip still holds it or not. The test reads that name
 * from the hook and checks that .gitignore's rule ignores the same folder, and reads nothing in the
 * folder; BG-01M6T4EH AC2's check exempts this file and the hook by name. The cases are the ones a
 * plausible shortcut gets wrong:
 * - the tip no longer holds the folder (a check of the tip tree alone passes it);
 * - the folder's only content equals a folder met first elsewhere in the same tree, so their trees
 *   share one id and `git rev-list --objects` names that tree and its blob only at the other path (a
 *   check that greps rev-list's paths passes it);
 * - the folder was added and removed on a side branch merged in with no net change, so the merge is
 *   TREESAME to both parents (a path-limited walk without --full-history follows the first parent
 *   only and passes it);
 * - a clean ref holding the name as a nested folder (`src-tauri/<name>/`), in a file name
 *   (`docs/<name>.md`), as a prefix (`<name>X/`) and as a top-level file pushes (a match on the
 *   word anywhere in a path, or on the name without the folder's slash, refuses it), and so does an
 *   annotated tag on that clean commit (a release's `v*` tag goes through the same hook);
 * - a push from a bare clone, as the purge's mirror pushes, is checked the same way;
 * - a replace ref that hides the commit adding the folder (git reads replaced objects, but sends the
 *   stored ones; a hook that leaves replace refs on passes it);
 * - a lightweight or annotated tag on a tree that holds the folder (a path-limited rev-list on a
 *   tree prints nothing and exits 0, so a hook that asks it passes it), while a tag on the root tree
 *   of a commit with no path under the folder pushes;
 * - a lightweight or annotated tag on the tree that IS the folder, or a directory inside it, whose
 *   entries are the fonts' own names and hold no path under the folder, so a hook that asks only
 *   what the tree contains clears it and the bytes reach the remote (BG-01M6XSZ9); the case asserts
 *   the throwaway bare remote receives neither the tag, nor the tree, nor the file in it;
 * - a tag on a blob, vendor or not: a blob carries no path and no history, so the hook cannot place
 *   it and refuses it (BG-01M6XSZ9), where it used to push;
 * - a graft file, in .git/info/grafts or named by GIT_GRAFT_FILE in the pusher's environment, that
 *   cuts the commit adding the folder out of the tip's ancestry (the tip's own stored parents still
 *   name it, so a hook that leaves grafts on exits 0 and leaves the push to be caught, or not, by
 *   the remote rejecting a pack with objects missing, BG-01M6XSZ9);
 * - the folder in another letter case (`Resources/`, `RESOURCES/`), under core.ignorecase true and
 *   false (a case-sensitive pathspec passes it, and it lands in the same folder on a
 *   case-insensitive file system);
 * - a push with GIT_LITERAL_PATHSPECS set, as `git --literal-pathspecs push` sets it for the hook
 *   (literal pathspecs turn off the `:(top,icase)` magic, so the folder's pathspec matches nothing
 *   and a hook that keeps the variable passes every ref the folder check should refuse), while a
 *   clean branch and tag still push with it set.
 * A delete (all-zero local sha) is allowed, a last stdin line git did not terminate with a newline
 * is judged like any other (a loop that only reads drops it, BG-01M6XSZ9), and one bad ref among
 * several fails the push. A ref
 * whose sha the clone lacks is refused with a message saying git could not read it (a hook that
 * returns no reason for it passes it silently), on stdin and through a real `git push <sha>:<ref>`,
 * for which git hands the hook the sha as the local ref.
 *
 * GPL guards: the hook's PRE_STRIP commit and GPL_BLOBS ids name objects only this repository's
 * unpushed history holds, so they are checked on a copy of the hook whose two assignments name a
 * fixture commit and three fixture blobs instead. The copy refuses a history holding the commit and
 * one holding any of the blobs, also when a replace ref hides them and when a tag on a tree or blob
 * carries a blob, and the shipped file's two assignments are pinned to 5d3e45e and the three blob
 * ids of align.json, phylo_r.json and phylo_tools.json as 5d3e45e committed them.
 *
 * The hook needs a POSIX shell, so on Windows these tests are skipped (it.skipIf), which the run
 * reports as skipped; the macOS and Linux CI runs run them.
 */
import { expect, it } from 'vitest';

interface NodeFs {
  mkdtempSync: (prefix: string) => string;
  mkdirSync: (p: string, o?: { recursive: boolean }) => void;
  writeFileSync: (p: string, data: string) => void;
  readFileSync: (p: string) => Uint8Array;
  rmSync: (p: string, o: { recursive: boolean; force: boolean }) => void;
}
interface NodePath {
  join: (...p: string[]) => string;
  resolve: (...p: string[]) => string;
  dirname: (p: string) => string;
}
interface NodeOs { tmpdir: () => string }
interface NodeUrl { fileURLToPath: (u: string) => string }
interface SpawnResult { status: number | null; stdout: string; stderr: string; error?: Error }
interface NodeChildProcess {
  spawnSync: (
    cmd: string,
    args: string[],
    o: { cwd?: string; env?: Record<string, string | undefined>; input?: string; encoding: 'utf8' },
  ) => SpawnResult;
}
interface NodeProcess { platform: string; env: Record<string, string | undefined> }

const load = <T,>(spec: string): Promise<T> => import(/* @vite-ignore */ spec) as Promise<T>;
const [fs, path, os, url, cp] = await Promise.all([
  load<NodeFs>('node:fs'),
  load<NodePath>('node:path'),
  load<NodeOs>('node:os'),
  load<NodeUrl>('node:url'),
  load<NodeChildProcess>('node:child_process'),
]);
const proc = (globalThis as unknown as { process: NodeProcess }).process;

const REPO = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..', '..');
const HOOK = path.join(REPO, 'scripts', 'git-hooks', 'pre-push');
const HOOK_TEXT = new TextDecoder().decode(fs.readFileSync(HOOK));
const GITIGNORE_LINES = new TextDecoder().decode(fs.readFileSync(path.join(REPO, '.gitignore'))).split('\n');
const ZERO = '0'.repeat(40);
/** The folder the hook guards, as its one LOCAL_FOLDER assignment names it. */
const FOLDER = /^LOCAL_FOLDER=([A-Za-z_]+)$/m.exec(HOOK_TEXT)?.[1] ?? '';
const under = (rest: string): string => `${FOLDER}/${rest}`;

const SHIPPED_PRE_STRIP = "PRE_STRIP='5d3e45e4701f6d19c0e136c2efebada4fb40f3ff 3e51fc0a925eef9115c1a7da695fc6f00ea7d9a6'";
const SHIPPED_GPL_BLOBS =
  "GPL_BLOBS='60b8930f52c66f80d946cb55bbec853d4da969d8 1cb2d4897ebf482b0d181f5b95d0d3f0ae1e9ef5 d069805e91be727c01eefe2f2dc1f17a487c3ebf'";

/** The hook needs a POSIX shell: on Windows each test is skipped, and the run reports it skipped. */
const posix = it.skipIf(proc.platform === 'win32');
/** Each test runs dozens of git processes: on a loaded machine one took 4.7 s, near Vitest's 5 s default. */
const TIMEOUT_MS = 60_000;

/** A throwaway repository with one clean root commit on branch `root`, and helpers to drive it. */
function fixture() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbc-prepush-'));
  // No inherited GIT_* variable, user or system config may reach the fixture repositories.
  const env: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(proc.env)) if (!k.startsWith('GIT_')) env[k] = v;
  Object.assign(env, {
    HOME: tmp,
    XDG_CONFIG_HOME: tmp,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  });
  /** Runs git, without asserting its exit status, with `extra` added to the fixture's environment. */
  const run = (dir: string, args: string[], input?: string, extra: Record<string, string> = {}): SpawnResult =>
    cp.spawnSync('git', args, { cwd: dir, env: { ...env, ...extra }, input, encoding: 'utf8' });
  const git = (dir: string, ...args: string[]): string => {
    const r = run(dir, args);
    expect(r.status, `git ${args.join(' ')}: ${r.stderr}`).toBe(0);
    return r.stdout.trim();
  };
  const work = path.join(tmp, 'work');
  fs.mkdirSync(work, { recursive: true });
  git(work, 'init', '-q');
  git(work, 'checkout', '-q', '-b', 'root');
  /** Writes (string) or removes (null) each file, then commits; returns the commit id. */
  const commit = (files: Record<string, string | null>, message: string): string => {
    for (const [rel, body] of Object.entries(files)) {
      const file = path.join(work, ...rel.split('/'));
      if (body === null) {
        git(work, 'rm', '-q', '--', rel);
      } else {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, body);
        git(work, 'add', '--', rel);
      }
    }
    git(work, 'commit', '-q', '--allow-empty', '-m', message);
    return git(work, 'rev-parse', 'HEAD');
  };
  /**
   * As commit, but through the index alone: nothing is written to the work tree, so two paths that
   * differ only in letter case stay two paths on a case-insensitive file system.
   */
  const commitIndex = (files: Record<string, string | null>, message: string): string => {
    for (const [rel, body] of Object.entries(files)) {
      if (body === null) {
        git(work, 'rm', '-q', '--cached', '--', rel);
      } else {
        const r = run(work, ['hash-object', '-w', '--stdin'], body);
        expect(r.status, `git hash-object: ${r.stderr}`).toBe(0);
        git(work, 'update-index', '--add', '--cacheinfo', `100644,${r.stdout.trim()},${rel}`);
      }
    }
    git(work, 'commit', '-q', '--allow-empty', '-m', message);
    return git(work, 'rev-parse', 'HEAD');
  };
  const branch = (name: string, from = 'root'): void => {
    git(work, 'checkout', '-q', '-f', '-b', name, from);
  };
  /** A pushed ref's full name: a bare name is a branch. */
  const full = (ref: string): string => (ref.startsWith('refs/') ? ref : `refs/heads/${ref}`);
  const line = (ref: string, sha: string): string => `${full(ref)} ${sha} ${full(ref)} ${ZERO}\n`;
  /** Runs the hook as git runs it, with `extra` added to the fixture's environment. */
  const push = (hook: string, dir: string, input: string, extra: Record<string, string> = {}): SpawnResult =>
    cp.spawnSync('sh', [hook, 'origin', 'https://example.invalid/molbiocraft.git'], {
      cwd: dir,
      env: { ...env, ...extra },
      input,
      encoding: 'utf8',
    });
  const refused = (r: SpawnResult, ref: string): void => {
    expect(r.status, `${ref} must be refused; stderr: ${r.stderr}`).toBe(1);
    expect(r.stderr).toContain(`pre-push: refusing to push ${full(ref)} to origin ${full(ref)}: `);
  };
  const refusedForFolder = (r: SpawnResult, ref: string): void => {
    refused(r, ref);
    expect(r.stderr, `${ref}'s refusal must name the folder`).toContain(`holds a path under ${under('')} (commit `);
  };
  const refusedForTree = (r: SpawnResult, ref: string): void => {
    refused(r, ref);
    expect(r.stderr, `${ref}'s refusal must name the tree and the folder`).toContain(`it names a tree that holds a path under ${under('')} (`);
  };
  const passes = (r: SpawnResult, what: string): void => {
    expect(r.stderr, `${what} must push`).toBe('');
    expect(r.status, `${what} must push`).toBe(0);
  };
  /** A copy of the hook whose PRE_STRIP and GPL_BLOBS assignments name fixture objects. */
  const hookCopy = (preStrip: string, blobIds: string[]): string => {
    expect(HOOK_TEXT.split('\n'), 'the shipped hook keeps the pre-strip commit').toContain(SHIPPED_PRE_STRIP);
    expect(HOOK_TEXT.split('\n'), 'the shipped hook keeps the three GPL blob ids').toContain(SHIPPED_GPL_BLOBS);
    let copyText = HOOK_TEXT;
    for (const [shipped, fixtureLine] of [
      [SHIPPED_PRE_STRIP, `PRE_STRIP='${preStrip}'`],
      [SHIPPED_GPL_BLOBS, `GPL_BLOBS='${blobIds.join(' ')}'`],
    ]) {
      expect(copyText.split(shipped).length, `the hook holds ${shipped} once`).toBe(2);
      copyText = copyText.replace(shipped, fixtureLine);
    }
    const copy = path.join(tmp, 'pre-push-fixture');
    fs.writeFileSync(copy, copyText);
    return copy;
  };
  /** The blob id of a body, written to the fixture repository. */
  const blob = (body: string): string => {
    const r = run(work, ['hash-object', '-w', '--stdin'], body);
    expect(r.status, `git hash-object: ${r.stderr}`).toBe(0);
    return r.stdout.trim();
  };
  /** A bare repository to push to, with the shipped hook installed in the fixture repository. */
  const remoteWithHook = (): string => {
    const remote = path.join(tmp, 'remote.git');
    git(tmp, 'init', '-q', '--bare', remote);
    const r = cp.spawnSync('sh', [HOOK, '--install'], { cwd: work, env, encoding: 'utf8' });
    expect(r.status, `pre-push --install: ${r.stderr}`).toBe(0);
    return remote;
  };
  /** Whether the bare repository has the ref, or the object. */
  const has = (remote: string, name: string): boolean => run(remote, ['rev-parse', '--verify', '-q', name]).status === 0;
  const hasObject = (remote: string, sha: string): boolean => run(remote, ['cat-file', '-e', sha]).status === 0;

  commit({ 'README.md': 'fixture\n' }, 'root');
  return {
    tmp, env, work, run, git, commit, commitIndex, branch, line, push, refused, refusedForFolder, refusedForTree, passes,
    hookCopy, blob, remoteWithHook, has, hasObject,
    cleanup: (): void => fs.rmSync(tmp, { recursive: true, force: true }),
  };
}

posix('refuses a history that holds a resources path and passes one that does not', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, refusedForFolder, passes } = f;
  try {
    // The hook guards the folder .gitignore ignores, and the cases below are built from that name.
    expect(FOLDER, 'the hook names its folder in one LOCAL_FOLDER=<name> line').not.toBe('');
    expect(GITIGNORE_LINES, `.gitignore ignores the folder the hook guards, as /${FOLDER}/`).toContain(`/${FOLDER}/`);

    // Clean: the name in other places, never the top-level folder.
    branch('clean');
    const clean = commit(
      {
        'src/a.txt': 'a\n',
        [`src-tauri/${FOLDER}/icon.txt`]: 'icon\n',
        [`docs/${FOLDER}.md`]: 'notes\n',
        [`${FOLDER}X/b.txt`]: 'b\n',
        [FOLDER]: 'a file, not the folder\n',
      },
      'clean',
    );
    // An annotated tag on the clean commit, as the purge's mirror push sends one.
    git(work, 'tag', '-a', '-m', 'clean tag', 'v-clean', clean);
    const cleanTag = git(work, 'rev-parse', 'refs/tags/v-clean');
    expect(git(work, 'cat-file', '-t', cleanTag), 'the clean tag must be an annotated tag object').toBe('tag');
    // The tip holds the folder.
    branch('tip');
    const tip = commit({ [under('Poppins/x.txt')]: 'font\n' }, 'tip holds the folder');
    // Added, then removed: only the history holds it.
    branch('removed');
    commit({ [under('Google_Sans/y.txt')]: 'font y\n' }, 'add the folder');
    const removed = commit({ [under('Google_Sans/y.txt')]: null }, 'remove the folder');
    // The folder equals other/, a tree met first, so the two share one tree id.
    branch('twin');
    commit({ 'other/f.txt': 'same\n', [under('f.txt')]: 'same\n' }, 'twin trees');
    const twin = commit({ [under('f.txt')]: null }, 'remove the twin');
    expect(git(work, 'rev-parse', 'HEAD~1:other'), 'the fixture must give the folder and other/ one tree id').toBe(
      git(work, 'rev-parse', `HEAD~1:${FOLDER}`),
    );
    // A side branch adds and removes the folder, and a merge with no net change brings it in.
    branch('mainline');
    commit({ 'src/main.txt': 'main\n' }, 'mainline');
    branch('side', 'root');
    commit({ [under('Space_Grotesk/z.txt')]: 'font z\n' }, 'side adds the folder');
    commit({ [under('Space_Grotesk/z.txt')]: null }, 'side removes the folder');
    git(work, 'checkout', '-q', 'mainline');
    git(work, 'merge', '-q', '--no-ff', '--no-edit', 'side');
    const merged = git(work, 'rev-parse', 'HEAD');
    expect(
      git(work, 'ls-tree', '-r', '--name-only', merged).split('\n').filter((p) => p.startsWith(under(''))),
      'the merge tip must hold no path under the folder',
    ).toEqual([]);

    // The shipped hook, run as git runs it.
    passes(push(HOOK, work, line('clean', clean)), 'a history with no path under the folder');
    passes(push(HOOK, work, line('refs/tags/v-clean', cleanTag)), 'an annotated tag on a clean commit');
    refusedForFolder(push(HOOK, work, line('tip', tip)), 'tip');
    refusedForFolder(push(HOOK, work, line('removed', removed)), 'removed');
    refusedForFolder(push(HOOK, work, line('twin', twin)), 'twin');
    refusedForFolder(push(HOOK, work, line('mainline', merged)), 'mainline');
    passes(push(HOOK, work, `refs/heads/tip ${ZERO} refs/heads/tip ${tip}\n`), 'a delete');
    const mixed = push(HOOK, work, line('clean', clean) + line('removed', removed));
    refusedForFolder(mixed, 'removed');
    expect(mixed.stderr, 'only the bad ref is named').not.toContain('refs/heads/clean');

    // A bare clone, as the purge's mirror pushes.
    const bare = path.join(f.tmp, 'bare.git');
    git(f.tmp, 'clone', '-q', '--bare', work, bare);
    passes(push(HOOK, bare, line('clean', clean)), 'a clean ref from a bare clone');
    passes(push(HOOK, bare, line('refs/tags/v-clean', cleanTag)), 'an annotated tag on a clean commit from a bare clone');
    refusedForFolder(push(HOOK, bare, line('mainline', merged)), 'mainline');

    // GPL guards, on a copy whose two assignments name fixture objects.
    branch('prestrip');
    const preStrip = commit({ 'test-data/reference/notes.txt': 'pre-strip\n' }, 'pre-strip');
    const gplBodies = ['gpl one\n', 'gpl two\n', 'gpl three\n'];
    const gplIds = gplBodies.map((body) => f.blob(body));
    const gplTips = gplBodies.map((body, i) => {
      branch(`gpl${i}`);
      commit({ 'test-data/reference/align.json': body }, `gpl ${i}`);
      return commit({ 'test-data/reference/align.json': 'checksums\n' }, `strip ${i}`);
    });
    const copy = f.hookCopy(preStrip, gplIds);
    passes(push(copy, work, line('clean', clean)), 'a clean ref under the fixture GPL ids');
    passes(push(copy, work, line('refs/tags/v-clean', cleanTag)), 'an annotated tag on a clean commit under the fixture GPL ids');
    const pre = push(copy, work, line('prestrip', preStrip));
    refused(pre, 'prestrip');
    expect(pre.stderr).toContain(`its history holds ${preStrip}`);
    gplTips.forEach((sha, i) => {
      const r = push(copy, work, line(`gpl${i}`, sha));
      refused(r, `gpl${i}`);
      expect(r.stderr).toContain(`(blob ${gplIds[i]})`);
    });
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses a push whose resources/ commit is hidden by a replace ref', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, passes } = f;
  try {
    const root = git(work, 'rev-parse', 'root');
    const rootTree = git(work, 'rev-parse', 'root^{tree}');
    /** Replaces the commit `sha` by one with the root as its only parent and `tree` as its tree. */
    const hide = (sha: string, tree: string): void => {
      git(work, 'replace', sha, git(work, 'commit-tree', '-p', root, '-m', `stands in for ${sha}`, tree));
    };

    // The folder: added, removed, and the adding commit replaced by one that never held it.
    branch('hidden');
    const added = commit({ [under('R/s.txt')]: 's\n' }, 'add the folder');
    const hiddenTip = commit({ [under('R/s.txt')]: null }, 'remove the folder');
    hide(added, rootTree);
    expect(
      git(work, 'rev-list', '--full-history', hiddenTip, '--', `:(top)${FOLDER}/`),
      'the replace ref must hide the folder from a walk that reads replaced objects',
    ).toBe('');
    // A clean branch and an annotated tag on it, which must still push through the same hook.
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');
    git(work, 'tag', '-a', '-m', 'clean tag', 'v-clean', clean);

    // A real push, the hook installed as git runs it: git sends the stored commits, folder and all,
    // so the hook must refuse it and the remote must receive nothing of it.
    const remote = f.remoteWithHook();
    const r = f.run(work, ['push', remote, 'refs/heads/hidden']);
    expect(r.status, `the push must fail; stderr: ${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain(`pre-push: refusing to push refs/heads/hidden to ${remote} refs/heads/hidden: `);
    expect(r.stderr, 'the refusal must name the commit that removes the folder').toContain(
      `holds a path under ${under('')} (commit ${hiddenTip} changes one)`,
    );
    expect(f.has(remote, 'refs/heads/hidden'), 'the remote must not receive the ref').toBe(false);
    expect(f.hasObject(remote, added), 'the remote must not receive the commit that adds the folder').toBe(false);
    // The regression guard: a clean branch and an annotated tag on it push through the same hook.
    const ok = f.run(work, ['push', remote, 'refs/heads/clean', 'refs/tags/v-clean']);
    expect(ok.status, `a clean branch and tag must push; stderr: ${ok.stderr}`).toBe(0);
    expect(f.has(remote, 'refs/heads/clean') && f.has(remote, 'refs/tags/v-clean'), 'the remote must hold both').toBe(true);

    // The GPL guards read the stored history too, on a copy whose assignments name fixture objects.
    // The pre-strip commit, hidden by replacing its child with a commit whose parent is the root.
    branch('prestrip');
    const preStrip = commit({ 'test-data/reference/notes.txt': 'pre-strip\n' }, 'pre-strip');
    const child = commit({ 'src/b.txt': 'b\n' }, 'after the pre-strip commit');
    const preTip = commit({ 'src/c.txt': 'c\n' }, 'tip');
    hide(child, git(work, 'rev-parse', `${child}^{tree}`));
    expect(
      f.run(work, ['merge-base', '--is-ancestor', preStrip, preTip]).status,
      'the replace ref must hide the pre-strip commit from a merge-base that reads replaced objects',
    ).toBe(1);
    // A GPL blob, committed and stripped, with the committing commit replaced.
    const gplBody = 'gpl one\n';
    const gplId = f.blob(gplBody);
    branch('gplhidden');
    const gplCommit = commit({ 'test-data/reference/align.json': gplBody }, 'gpl');
    const gplTip = commit({ 'test-data/reference/align.json': 'checksums\n' }, 'strip');
    hide(gplCommit, rootTree);
    expect(
      git(work, 'rev-list', '--objects', gplTip).split('\n').map((l) => l.split(' ')[0]),
      'the replace ref must hide the GPL blob from a listing that reads replaced objects',
    ).not.toContain(gplId);
    const copy = f.hookCopy(preStrip, [gplId]);
    const pre = push(copy, work, line('prestrip', preTip));
    refused(pre, 'prestrip');
    expect(pre.stderr).toContain(`its history holds ${preStrip}`);
    const gpl = push(copy, work, line('gplhidden', gplTip));
    refused(gpl, 'gplhidden');
    expect(gpl.stderr).toContain(`(blob ${gplId})`);
    passes(push(copy, work, line('clean', clean)), 'a clean ref under the fixture GPL ids, with replace refs present');
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses a lightweight tag on a tree that holds resources/', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, refusedForTree, passes } = f;
  try {
    branch('withfolder');
    const holding = git(work, 'rev-parse', `${commit({ [under('Poppins/x.txt')]: 'font\n' }, 'holds the folder')}^{tree}`);
    branch('clean');
    const cleanCommit = commit(
      {
        'src/a.txt': 'a\n',
        [`src-tauri/${FOLDER}/icon.txt`]: 'icon\n',
        [`docs/${FOLDER}.md`]: 'notes\n',
        [`${FOLDER}X/b.txt`]: 'b\n',
        [FOLDER]: 'a file, not the folder\n',
      },
      'clean',
    );
    const cleanTree = git(work, 'rev-parse', `${cleanCommit}^{tree}`);
    expect(
      git(work, 'rev-list', '--full-history', holding, '--', `:(top)${FOLDER}/`),
      'a path-limited walk of a tree prints nothing, which is the shortcut this case catches',
    ).toBe('');
    git(work, 'tag', 'tree-tag', holding);
    git(work, 'tag', '-a', '-m', 'annotated, on a tree', 'tree-annotated', holding);
    git(work, 'tag', 'clean-tree-tag', cleanTree);
    const annotated = git(work, 'rev-parse', 'refs/tags/tree-annotated');
    expect(git(work, 'cat-file', '-t', 'refs/tags/tree-tag'), 'the lightweight tag must name the tree itself').toBe('tree');

    refusedForTree(push(HOOK, work, line('refs/tags/tree-tag', holding)), 'refs/tags/tree-tag');
    refusedForTree(push(HOOK, work, line('refs/tags/tree-annotated', annotated)), 'refs/tags/tree-annotated');
    passes(push(HOOK, work, line('refs/tags/clean-tree-tag', cleanTree)), 'a lightweight tag on a clean tree');
    // A blob carries no path and no history, so the hook cannot tell a font of the local
    // third-party folder from any other file content, and refuses every blob (BG-01M6XSZ9);
    // 'refuses a vendor blob' below drives the folder case and the remote.
    const blobId = f.blob('a blob\n');
    refused(push(HOOK, work, line('refs/tags/blob-tag', blobId)), 'refs/tags/blob-tag');

    // A real push sends the tree's own id, and the remote must receive nothing of it.
    const remote = f.remoteWithHook();
    const r = f.run(work, ['push', remote, 'refs/tags/tree-tag']);
    expect(r.status, `the push must fail; stderr: ${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain(`pre-push: refusing to push refs/tags/tree-tag to ${remote} refs/tags/tree-tag: `);
    expect(r.stderr, 'git must hand the hook the tree itself').toContain(`it names a tree that holds a path under ${under('')} (`);
    expect(f.has(remote, 'refs/tags/tree-tag'), 'the remote must not receive the tag').toBe(false);
    expect(f.hasObject(remote, holding), 'the remote must not receive the tree').toBe(false);
    const ok = f.run(work, ['push', remote, 'refs/tags/clean-tree-tag']);
    expect(ok.status, `a tag on a clean tree must push; stderr: ${ok.stderr}`).toBe(0);

    // The GPL guards on a tree or blob: the blob check still lists them, and the pre-strip check,
    // which only a commit's history can hold, does not fail on them.
    const gplBody = 'gpl one\n';
    const gplId = f.blob(gplBody);
    branch('prestrip');
    const preStrip = commit({ 'test-data/reference/notes.txt': 'pre-strip\n' }, 'pre-strip');
    branch('gpltree');
    const gplTree = git(work, 'rev-parse', `${commit({ 'test-data/reference/align.json': gplBody }, 'gpl')}^{tree}`);
    const copy = f.hookCopy(preStrip, [gplId]);
    passes(push(copy, work, line('refs/tags/clean-tree-tag', cleanTree)), 'a tag on a clean tree under the fixture GPL ids');
    refused(push(copy, work, line('refs/tags/blob-tag', blobId)), 'refs/tags/blob-tag');
    refusedForTree(push(copy, work, line('refs/tags/tree-tag', holding)), 'refs/tags/tree-tag');
    for (const [ref, sha] of [
      ['refs/tags/gpl-tree', gplTree],
      ['refs/tags/gpl-blob', gplId],
    ]) {
      const g = push(copy, work, line(ref, sha));
      refused(g, ref);
      expect(g.stderr).toContain(`(blob ${gplId})`);
    }
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses a path under resources/ in any letter case', () => {
  const f = fixture();
  const { work, git, commitIndex, branch, line, push, refusedForFolder, refusedForTree, passes } = f;
  try {
    const variants = [
      FOLDER.charAt(0).toUpperCase() + FOLDER.slice(1),
      FOLDER.toUpperCase(),
      [...FOLDER].map((c, i) => (i % 2 ? c.toUpperCase() : c)).join(''),
    ];
    for (const v of variants) expect(v, 'each variant must differ from the name in letter case only').not.toBe(FOLDER);
    expect(variants.map((v) => v.toLowerCase())).toEqual(variants.map(() => FOLDER.toLowerCase()));

    // Each variant on its own branch: the tip holds it, or only the history does.
    const tips = variants.map((v, i) => {
      branch(`case${i}`);
      return commitIndex({ [`${v}/f${i}.txt`]: `case ${i}\n` }, `holds ${v}/`);
    });
    branch('caseremoved');
    commitIndex({ [`${variants[0]}/g.txt`]: 'g\n' }, `add ${variants[0]}/`);
    const removed = commitIndex({ [`${variants[0]}/g.txt`]: null }, `remove ${variants[0]}/`);
    const caseTree = git(work, 'rev-parse', `${tips[1]}^{tree}`);
    // Clean: the variants in other places, never the top-level folder.
    branch('caseclean');
    const clean = commitIndex(
      {
        [`src/${variants[0]}/c.txt`]: 'c\n',
        [`${variants[1]}X/b.txt`]: 'b\n',
        [variants[0]]: 'a file, not the folder\n',
      },
      'clean in any case',
    );

    for (const ignorecase of ['true', 'false']) {
      git(work, 'config', 'core.ignorecase', ignorecase);
      tips.forEach((sha, i) => refusedForFolder(push(HOOK, work, line(`case${i}`, sha)), `case${i}`));
      refusedForFolder(push(HOOK, work, line('caseremoved', removed)), 'caseremoved');
      refusedForTree(push(HOOK, work, line('refs/tags/case-tree', caseTree)), 'refs/tags/case-tree');
      passes(push(HOOK, work, line('caseclean', clean)), `a history with the name in other places, core.ignorecase=${ignorecase}`);
    }
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses resources/ even when GIT_LITERAL_PATHSPECS is set', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, refusedForFolder, refusedForTree, passes } = f;
  try {
    branch('tip');
    const tip = commit({ [under('Poppins/x.txt')]: 'font\n' }, 'tip holds the folder');
    const holding = git(work, 'rev-parse', `${tip}^{tree}`);
    git(work, 'tag', 'tree-tag', holding);
    branch('removed');
    commit({ [under('Google_Sans/y.txt')]: 'font y\n' }, 'add the folder');
    const removed = commit({ [under('Google_Sans/y.txt')]: null }, 'remove the folder');
    // Clean: the name in other places, never the top-level folder, and an annotated tag on it.
    branch('clean');
    const clean = commit(
      { [`src-tauri/${FOLDER}/icon.txt`]: 'icon\n', [`docs/${FOLDER}.md`]: 'notes\n', [FOLDER]: 'a file, not the folder\n' },
      'clean',
    );
    git(work, 'tag', '-a', '-m', 'clean tag', 'v-clean', clean);
    const cleanTag = git(work, 'rev-parse', 'refs/tags/v-clean');

    // The variable defeats the hook's pathspec in git itself, which is the bypass this case catches.
    for (const value of ['1', 'true']) {
      const walk = f.run(work, ['rev-list', '--full-history', '-n', '1', removed, '--', `:(top,icase)${FOLDER}/`], undefined, {
        GIT_LITERAL_PATHSPECS: value,
      });
      expect(walk.status, `rev-list with GIT_LITERAL_PATHSPECS=${value}: ${walk.stderr}`).toBe(0);
      expect(walk.stdout, `GIT_LITERAL_PATHSPECS=${value} must make the folder's pathspec match nothing`).toBe('');
    }

    // The shipped hook, run as git runs it, with and without the variable: the same verdicts.
    const variants: Record<string, string>[] = [{}, { GIT_LITERAL_PATHSPECS: '1' }, { GIT_LITERAL_PATHSPECS: 'true' }];
    for (const extra of variants) {
      const label = JSON.stringify(extra);
      refusedForFolder(push(HOOK, work, line('tip', tip), extra), 'tip');
      refusedForFolder(push(HOOK, work, line('removed', removed), extra), 'removed');
      refusedForTree(push(HOOK, work, line('refs/tags/tree-tag', holding), extra), 'refs/tags/tree-tag');
      passes(push(HOOK, work, line('clean', clean), extra), `a clean history, ${label}`);
      passes(push(HOOK, work, line('refs/tags/v-clean', cleanTag), extra), `an annotated tag on a clean commit, ${label}`);
    }

    // A real push, the hook installed in the throwaway repository: once with the variable in the
    // pusher's environment, once through `git --literal-pathspecs`, which sets it for the hook.
    const remote = f.remoteWithHook();
    const literal = { GIT_LITERAL_PATHSPECS: '1' };
    const cases: [string[], Record<string, string>][] = [
      [['push', remote, 'refs/heads/removed'], literal],
      [['--literal-pathspecs', 'push', remote, 'refs/heads/removed'], {}],
      [['--literal-pathspecs', 'push', remote, 'refs/tags/tree-tag'], {}],
    ];
    for (const [args, extra] of cases) {
      const ref = args[args.length - 1];
      const r = f.run(work, args, undefined, extra);
      expect(r.status, `git ${args.join(' ')} must fail; stderr: ${r.stderr}`).not.toBe(0);
      expect(r.stderr).toContain(`pre-push: refusing to push ${ref} to ${remote} ${ref}: `);
      expect(r.stderr, 'the refusal must name the folder').toContain(`a path under ${under('')} (`);
      expect(f.has(remote, ref), `the remote must not receive ${ref}`).toBe(false);
    }
    expect(f.hasObject(remote, removed), 'the remote must not receive the commit that removes the folder').toBe(false);
    const ok = f.run(work, ['--literal-pathspecs', 'push', remote, 'refs/heads/clean', 'refs/tags/v-clean'], undefined, literal);
    expect(ok.status, `a clean branch and tag must push with the variable set; stderr: ${ok.stderr}`).toBe(0);
    expect(f.has(remote, 'refs/heads/clean') && f.has(remote, 'refs/tags/v-clean'), 'the remote must hold both').toBe(true);

    // Setting both GIT_GLOB_PATHSPECS and GIT_NOGLOB_PATHSPECS makes git reject every command that
    // carries a pathspec, so the folder history walk (on a commit) and the tree listing (on a tree)
    // fail closed with their own refusal messages rather than passing silently (BG-01M6XSCW).
    const incompatible = { GIT_GLOB_PATHSPECS: '1', GIT_NOGLOB_PATHSPECS: '1' };
    const badWalk = push(HOOK, work, line('tip', tip), incompatible);
    refused(badWalk, 'tip');
    expect(badWalk.stderr).toContain(
      `git could not walk its history, so it cannot tell whether that history holds a path under ${under('')} (CR-01M6T9MT)`,
    );
    const badTree = push(HOOK, work, line('refs/tags/tree-tag', holding), incompatible);
    refused(badTree, 'refs/tags/tree-tag');
    expect(badTree.stderr).toContain(
      `git could not list the tree it names, so it cannot tell whether that tree holds a path under ${under('')} (CR-01M6T9MT)`,
    );
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses an object it cannot read', () => {
  const f = fixture();
  const { work, commit, branch, line, push, refused, passes } = f;
  const UNREADABLE = 'git could not read the object it names, so it cannot tell what that object holds (D0020)';
  try {
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');
    // A well-formed id the clone lacks: hashed, never written.
    const hashed = f.run(work, ['hash-object', '--stdin'], 'never written to this clone\n');
    expect(hashed.status, `hash-object: ${hashed.stderr}`).toBe(0);
    const missing = hashed.stdout.trim();
    expect(missing, 'a full object id').toMatch(/^[0-9a-f]{40}$/);
    expect(f.run(work, ['cat-file', '-e', missing]).status, 'the clone must lack the object').not.toBe(0);

    passes(push(HOOK, work, line('clean', clean)), 'a clean ref the clone holds');
    const r = push(HOOK, work, line('missing', missing));
    refused(r, 'missing');
    expect(r.stderr, 'the refusal must say git could not read the object').toContain(UNREADABLE);
    // Beside a clean ref, the push still fails and names only the unreadable one.
    const mixed = push(HOOK, work, line('clean', clean) + line('missing', missing));
    refused(mixed, 'missing');
    expect(mixed.stderr).toContain(UNREADABLE);
    expect(mixed.stderr, 'only the unreadable ref is named').not.toContain('refs/heads/clean');

    // A real push of the missing sha: git runs the hook with it, and the remote receives nothing.
    const remote = f.remoteWithHook();
    const real = f.run(work, ['push', remote, `${missing}:refs/heads/missing`]);
    expect(real.status, `the push must fail; stderr: ${real.stderr}`).not.toBe(0);
    expect(real.stderr).toContain(`pre-push: refusing to push ${missing} to ${remote} refs/heads/missing: ${UNREADABLE}`);
    expect(f.has(remote, 'refs/heads/missing'), 'the remote must not receive the ref').toBe(false);
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

const NO_COMMIT_TREE = "no commit's root tree in this clone";
const NAMES_A_BLOB = 'it names a blob';

posix('refuses a vendor tree: a tag on the tree that is the folder, or a folder inside it', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, passes } = f;
  try {
    branch('withfolder');
    const holds = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'holds the folder');
    const folderTree = git(work, 'rev-parse', `${holds}:${FOLDER}`);
    const innerTree = git(work, 'rev-parse', `${holds}:${under('Poppins')}`);
    const vendorBlob = git(work, 'rev-parse', `${holds}:${under('Poppins/x.txt')}`);
    const empty = git(work, 'hash-object', '-t', 'tree', '/dev/null');
    // The shortcut this case catches: neither tree holds a path *under* the folder, because each IS
    // the folder or a folder inside it, so a listing limited to the folder's pathspec is empty and a
    // hook that asks only what the tree contains clears it (BG-01M6XSZ9).
    for (const [what, tree] of [
      ['the folder itself', folderTree],
      ['a folder inside it', innerTree],
    ] as const) {
      expect(
        git(work, 'diff-tree', '-r', '--name-only', empty, `${tree}^{tree}`, '--', `:(top,icase)${FOLDER}/`),
        `${what} holds no path under ${under('')}, which is the shortcut this case catches`,
      ).toBe('');
    }
    git(work, 'tag', 'vtree', innerTree);
    git(work, 'tag', '-a', '-m', 'on the folder itself', 'vfolder', folderTree);
    const annotated = git(work, 'rev-parse', 'refs/tags/vfolder');
    expect(git(work, 'cat-file', '-t', annotated), 'the annotated tag must be a tag object on a tree').toBe('tag');

    for (const [ref, sha] of [
      ['refs/tags/vtree', innerTree],
      ['refs/tags/vfolder', annotated],
    ] as const) {
      const r = push(HOOK, work, line(ref, sha));
      refused(r, ref);
      expect(r.stderr, `${ref}'s refusal must say the tree is no commit's tree`).toContain(NO_COMMIT_TREE);
    }
    // A tag on the root tree of a commit this clone holds still pushes: its entries are the
    // repository's own top-level paths, so the listing above means what it says.
    branch('clean');
    const cleanTree = git(work, 'rev-parse', `${commit({ 'src/a.txt': 'a\n' }, 'clean')}^{tree}`);
    passes(push(HOOK, work, line('refs/tags/clean-tree', cleanTree)), "a tag on a commit's root tree with no path under the folder");

    // A real push sends the tree's own id: the remote must receive neither the tag, nor the tree,
    // nor the file inside it.
    const remote = f.remoteWithHook();
    const r = f.run(work, ['push', remote, 'refs/tags/vtree']);
    expect(r.status, `the push must fail; stderr: ${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain(`pre-push: refusing to push refs/tags/vtree to ${remote} refs/tags/vtree: `);
    expect(r.stderr, 'git must hand the hook the tree itself').toContain(NO_COMMIT_TREE);
    expect(f.has(remote, 'refs/tags/vtree'), 'the remote must not receive the tag').toBe(false);
    expect(f.hasObject(remote, innerTree), 'the remote must not receive the tree').toBe(false);
    expect(f.hasObject(remote, vendorBlob), 'the remote must not receive the file inside the tree').toBe(false);
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses a vendor blob, and every other blob the hook cannot place', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused } = f;
  try {
    branch('withfolder');
    const holds = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'holds the folder');
    const vendorBlob = git(work, 'rev-parse', `${holds}:${under('Poppins/x.txt')}`);
    // A blob is content with no name and no history: a file of the local third-party folder and an
    // innocent file are the same shape to the hook, so it refuses both rather than guess.
    for (const [what, sha] of [
      ['a vendor blob', vendorBlob],
      ['any other blob', f.blob('a blob\n')],
    ] as const) {
      const r = push(HOOK, work, line('refs/tags/b', sha));
      refused(r, 'refs/tags/b');
      expect(r.stderr, `${what} must be refused for being a blob`).toContain(NAMES_A_BLOB);
    }

    // A real push of a tag on the vendor blob: the remote must receive neither the tag nor the bytes.
    const remote = f.remoteWithHook();
    git(work, 'tag', 'vblob', vendorBlob);
    const r = f.run(work, ['push', remote, 'refs/tags/vblob']);
    expect(r.status, `the push must fail; stderr: ${r.stderr}`).not.toBe(0);
    expect(r.stderr).toContain(`pre-push: refusing to push refs/tags/vblob to ${remote} refs/tags/vblob: `);
    expect(f.has(remote, 'refs/tags/vblob'), 'the remote must not receive the tag').toBe(false);
    expect(f.hasObject(remote, vendorBlob), 'the remote must not receive the vendor bytes').toBe(false);
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

/**
 * A graft file rewrites ancestry: it cuts the commit that adds the folder out of the tip's history,
 * so a walk that reads grafts finds nothing and the hook clears a history that holds the folder
 * (BG-01M6XSZ9), although the tip's own stored parents still name the commit the graft cut out.
 * Driven from both sources git reads a graft file from: the repository's own .git/info/grafts, and
 * the file GIT_GRAFT_FILE names in the pusher's environment.
 */
const graftCase = (source: 'info/grafts' | 'GIT_GRAFT_FILE'): void => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refusedForFolder, passes } = f;
  try {
    const root = git(work, 'rev-parse', 'root');
    branch('grafted');
    const added = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'add the folder');
    const tip = commit({ [under('Poppins/x.txt')]: null }, 'remove the folder');
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');

    const extra: Record<string, string> = {};
    const graft = `${tip} ${root}\n`;
    if (source === 'GIT_GRAFT_FILE') {
      const file = path.join(f.tmp, 'grafts');
      fs.writeFileSync(file, graft);
      extra.GIT_GRAFT_FILE = file;
    } else {
      fs.mkdirSync(path.join(work, '.git', 'info'), { recursive: true });
      fs.writeFileSync(path.join(work, '.git', 'info', 'grafts'), graft);
    }
    // The graft really does cut the folder out of git's own walk and ancestry test, which is the
    // hole this case catches.
    const walk = f.run(work, ['rev-list', '--full-history', '-n', '1', tip, '--', `:(top,icase)${FOLDER}/`], undefined, extra);
    expect(walk.status, `rev-list under the ${source} graft: ${walk.stderr}`).toBe(0);
    expect(walk.stdout, `the ${source} graft must hide the folder from a walk that reads it`).toBe('');
    expect(
      f.run(work, ['merge-base', '--is-ancestor', added, tip], undefined, extra).status,
      `the ${source} graft must hide the commit that adds the folder from an ancestry test that reads it`,
    ).toBe(1);

    refusedForFolder(push(HOOK, work, line('grafted', tip), extra), 'grafted');
    // Silently, too: the hook turns grafts off by naming a file git cannot open, and `passes` holds
    // it to an empty stderr. An existing empty file would turn them off as well, but git then prints
    // its graft-file deprecation advice on every call from a repository that has .git/info/grafts.
    passes(push(HOOK, work, line('clean', clean), extra), `a clean history under a ${source} graft`);

    // A real push, the hook installed as git runs it: the hook refuses it, rather than the remote
    // happening to reject the pack for the objects the graft left out of it.
    const remote = f.remoteWithHook();
    const r = f.run(work, ['push', remote, 'refs/heads/grafted'], undefined, extra);
    expect(r.status, `the push must fail; stderr: ${r.stderr}`).not.toBe(0);
    expect(r.stderr, `the ${source} graft push must be refused by the hook`).toContain(
      `pre-push: refusing to push refs/heads/grafted to ${remote} refs/heads/grafted: `,
    );
    expect(f.has(remote, 'refs/heads/grafted'), 'the remote must not receive the ref').toBe(false);
    expect(f.hasObject(remote, added), 'the remote must not receive the commit that adds the folder').toBe(false);
  } finally {
    f.cleanup();
  }
};

posix('refuses a history a graft file in .git/info cuts the folder out of', () => graftCase('info/grafts'), TIMEOUT_MS);
posix('refuses a history a graft file named by GIT_GRAFT_FILE cuts the folder out of', () => graftCase('GIT_GRAFT_FILE'), TIMEOUT_MS);

posix('judges a final stdin line with no trailing newline', () => {
  const f = fixture();
  const { work, commit, branch, line, push, refusedForFolder, passes } = f;
  try {
    branch('tip');
    const tip = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'tip holds the folder');
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');
    /** The ref line as a last line git did not terminate: a loop that only reads drops it. */
    const unterminated = (ref: string, sha: string): string => line(ref, sha).replace(/\n$/, '');
    expect(unterminated('tip', tip).endsWith('\n'), 'the case must feed a line with no trailing newline').toBe(false);

    refusedForFolder(push(HOOK, work, unterminated('tip', tip)), 'tip');
    refusedForFolder(push(HOOK, work, line('clean', clean) + unterminated('tip', tip)), 'tip');
    passes(push(HOOK, work, unterminated('clean', clean)), 'a clean ref on a line with no trailing newline');
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

const PARTIAL_CLONE_REFUSAL =
  'this clone is a partial clone, which lacks objects of that history and would fetch them from its remote, so it cannot tell whether that history holds the GPL-3.0 alignments (D0020)';
const OBJECT_WALK_REFUSAL =
  'git could not list the objects of its history, so it cannot tell whether that history holds the GPL-3.0 alignments (D0020)';
const SHIPPED_PRE_STRIP_SHA = '5d3e45e4701f6d19c0e136c2efebada4fb40f3ff';

posix('refuses a push from a partial clone, including one whose tip holds resources/', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, refusedForFolder, passes } = f;
  try {
    expect(HOOK_TEXT, 'the unreachable post-peel object-kind branch is removed').not.toContain(
      'which this hook cannot check (D0020)',
    );
    branch('tip');
    const tip = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'tip holds the folder');
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');
    expect(git(work, 'ls-tree', '-r', '--name-only', tip)).toContain(under('Poppins/x.txt'));

    // Driven through extensions.partialClone, including a real push whose tip holds the folder.
    git(work, 'config', 'extensions.partialClone', 'origin');
    for (const [ref, sha] of [
      ['tip', tip],
      ['clean', clean],
    ] as const) {
      const r = push(HOOK, work, line(ref, sha));
      refused(r, ref);
      expect(r.stderr).toContain(PARTIAL_CLONE_REFUSAL);
    }
    const remote = f.remoteWithHook();
    const real = f.run(work, ['push', remote, 'refs/heads/tip']);
    expect(real.status, `partial clone push must fail; stderr: ${real.stderr}`).not.toBe(0);
    expect(real.stderr).toContain(`pre-push: refusing to push refs/heads/tip to ${remote} refs/heads/tip: ${PARTIAL_CLONE_REFUSAL}`);
    expect(f.has(remote, 'refs/heads/tip'), 'the remote must not receive the ref').toBe(false);
    expect(f.hasObject(remote, tip), 'the remote must not receive the tip commit').toBe(false);
    git(work, 'config', '--unset', 'extensions.partialClone');

    // Driven through remote.<name>.promisor=true.
    git(work, 'config', 'remote.origin.promisor', 'true');
    const promisor = push(HOOK, work, line('tip', tip));
    refused(promisor, 'tip');
    expect(promisor.stderr).toContain(PARTIAL_CLONE_REFUSAL);
    git(work, 'config', '--unset', 'remote.origin.promisor');

    // Once no longer flagged as a partial clone, the folder check still refuses tip and passes clean.
    refusedForFolder(push(HOOK, work, line('tip', tip)), 'tip');
    passes(push(HOOK, work, line('clean', clean)), 'clean after clearing partial-clone config');
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses a push from a shallow clone lacking the pre-strip commit, including one whose tip holds resources/', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused } = f;
  try {
    branch('tip');
    const preStrip = commit({ 'test-data/reference/notes.txt': 'pre-strip\n' }, 'pre-strip');
    const tip = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'tip holds the folder');
    const shallow = path.join(f.tmp, 'shallow');
    git(f.tmp, 'clone', '-q', '--depth', '1', '--no-local', '-b', 'tip', work, shallow);
    expect(git(shallow, 'rev-parse', '--is-shallow-repository'), 'must be a real shallow clone').toBe('true');
    expect(git(shallow, 'ls-tree', '-r', '--name-only', tip)).toContain(under('Poppins/x.txt'));
    expect(f.run(shallow, ['cat-file', '-e', `${preStrip}^{commit}`]).status, 'shallow clone must lack the older commit').not.toBe(0);

    const shipped = push(HOOK, shallow, line('tip', tip));
    refused(shipped, 'tip');
    expect(shipped.stderr).toContain(
      `this clone is shallow and lacks ${SHIPPED_PRE_STRIP_SHA}, so it cannot tell whether that history holds it (D0020)`,
    );

    const copy = f.hookCopy(preStrip, []);
    const fixtureShallow = push(copy, shallow, line('tip', tip));
    refused(fixtureShallow, 'tip');
    expect(fixtureShallow.stderr).toContain(
      `this clone is shallow and lacks ${preStrip}, so it cannot tell whether that history holds it (D0020)`,
    );

    // A real push from the shallow clone to a bare remote transfers nothing.
    const remote = path.join(f.tmp, 'shallow-remote.git');
    git(f.tmp, 'init', '-q', '--bare', remote);
    const install = cp.spawnSync('sh', [HOOK, '--install'], { cwd: shallow, env: f.env, encoding: 'utf8' });
    expect(install.status, `pre-push --install in shallow: ${install.stderr}`).toBe(0);
    const real = f.run(shallow, ['push', remote, 'refs/heads/tip']);
    expect(real.status, `shallow clone push must fail; stderr: ${real.stderr}`).not.toBe(0);
    expect(real.stderr).toContain(
      `pre-push: refusing to push refs/heads/tip to ${remote} refs/heads/tip: this clone is shallow and lacks ${SHIPPED_PRE_STRIP_SHA}, so it cannot tell whether that history holds it (D0020)`,
    );
    expect(f.has(remote, 'refs/heads/tip'), 'the remote must not receive the ref').toBe(false);
    expect(f.hasObject(remote, tip), 'the remote must not receive the tip commit').toBe(false);
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses when merge-base fails to check whether the history holds the pre-strip commit', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, passes } = f;
  try {
    branch('prestrip');
    const preStrip = commit({ 'test-data/reference/notes.txt': 'pre-strip\n' }, 'pre-strip');
    branch('broken');
    const mid = commit({ [under('Poppins/x.txt')]: 'invented font bytes\n' }, 'mid commit to remove');
    const tip = commit({ 'src/after.txt': 'after\n' }, 'tip whose parent object is missing');
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');

    // Remove the parent commit object so cat-file on tip and preStrip both succeed, while
    // merge-base --is-ancestor fails with exit status 128 when walking tip's parents.
    fs.rmSync(path.join(work, '.git', 'objects', mid.slice(0, 2), mid.slice(2)), { recursive: false, force: false });
    expect(git(work, 'cat-file', '-t', `${tip}^{}`)).toBe('commit');
    expect(f.run(work, ['cat-file', '-e', `${preStrip}^{commit}`]).status).toBe(0);
    expect(f.run(work, ['merge-base', '--is-ancestor', preStrip, tip]).status).toBeGreaterThan(1);

    const copy = f.hookCopy(preStrip, []);
    const r = push(copy, work, line('broken', tip));
    refused(r, 'broken');
    expect(r.stderr).toContain(`git could not tell whether its history holds ${preStrip} (D0020)`);
    passes(push(copy, work, line('clean', clean)), 'a clean branch whose commit graph is intact');
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);

posix('refuses when the object walk fails to list the objects of the history', () => {
  const f = fixture();
  const { work, git, commit, branch, line, push, refused, passes } = f;
  try {
    branch('prestrip');
    const preStrip = commit({ 'test-data/reference/notes.txt': 'pre-strip\n' }, 'pre-strip');
    branch('broken');
    const tip = commit(
      { [under('Poppins/x.txt')]: 'invented font bytes\n', 'sub/item.txt': 'subtree to remove\n' },
      'tip whose subtree object is missing',
    );
    branch('clean');
    const clean = commit({ 'src/a.txt': 'a\n' }, 'clean');

    // Remove the subtree object for sub/ so commit-level checks (cat-file -t and merge-base) pass,
    // while rev-list --objects fails when descending into tip's tree.
    const subTree = git(work, 'rev-parse', `${tip}:sub`);
    fs.rmSync(path.join(work, '.git', 'objects', subTree.slice(0, 2), subTree.slice(2)), { recursive: false, force: false });
    expect(git(work, 'cat-file', '-t', `${tip}^{}`)).toBe('commit');
    expect(f.run(work, ['merge-base', '--is-ancestor', preStrip, tip]).status).toBe(1);
    expect(f.run(work, ['rev-list', '--objects', tip]).status).not.toBe(0);

    for (const hook of [HOOK, f.hookCopy(preStrip, [])]) {
      const r = push(hook, work, line('broken', tip));
      refused(r, 'broken');
      expect(r.stderr).toContain(OBJECT_WALK_REFUSAL);
    }
    passes(push(HOOK, work, line('clean', clean)), 'a clean branch whose objects are intact');
  } finally {
    f.cleanup();
  }
}, TIMEOUT_MS);
