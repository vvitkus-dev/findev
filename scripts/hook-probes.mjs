#!/usr/bin/env node
// Proves the git hooks actually block bad commits/pushes (specs/quality-gates/tasks.md Q1).
// Runs in a throwaway detached git worktree so the real working tree and branches are never touched.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const repo = resolve('.');
const wt = mkdtempSync(join(tmpdir(), 'hook-probes-'));

/** Run a command inside the worktree; returns { code, out }. */
function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { cwd: wt, encoding: 'utf8', ...opts });
  return { code: r.status ?? -1, out: `${r.stdout ?? ''}${r.stderr ?? ''}` };
}
const git = (...args) => sh('git', args);

/** Stage `files`, try to commit with `message`; returns the commit result and resets the index. */
function tryCommit(files, message) {
  for (const [path, code] of Object.entries(files)) writeFileSync(join(wt, path), code);
  git('add', ...Object.keys(files));
  const head = git('rev-parse', 'HEAD').out.trim();
  const r = git('commit', '-m', message);
  const committed = git('rev-parse', 'HEAD').out.trim() !== head;
  // Leave the worktree clean for the next probe whatever happened.
  if (committed) git('reset', '--hard', head);
  git('reset', '--hard', 'HEAD');
  git('clean', '-fdq');
  return { ...r, committed };
}

const CLEAN_TS = 'export const answer = 42;\n';

/** @type {{ name: string, run: () => { ok: boolean, detail: string } }[]} */
const PROBES = [
  // Q1.1 — pre-commit (lint-staged)
  {
    name: 'pre-commit blocks a staged lint error',
    run: () => {
      const r = tryCommit(
        { 'src/app/__hook_probe.ts': 'export const x: any = 1;\n' },
        'feat: probe',
      );
      return {
        ok: !r.committed && /no-explicit-any/.test(r.out),
        detail: `committed=${r.committed}`,
      };
    },
  },
  {
    name: 'pre-commit allows a clean staged file',
    run: () => {
      const r = tryCommit({ 'src/app/__hook_probe.ts': CLEAN_TS }, 'feat: probe');
      return {
        ok: r.committed,
        detail: `committed=${r.committed}${r.committed ? '' : `\n${r.out}`}`,
      };
    },
  },
  // Q1.2 — commit-msg (commitlint)
  {
    name: 'commit-msg blocks a non-conventional message',
    run: () => {
      const r = tryCommit({ 'src/app/__hook_probe.ts': CLEAN_TS }, 'Added stuff');
      return {
        ok: !r.committed && /type-empty|subject-empty/.test(r.out),
        detail: `committed=${r.committed}`,
      };
    },
  },
  {
    name: 'commit-msg blocks AI attribution',
    run: () => {
      const msg = 'feat: probe\n\nCo-Authored-By: Claude <noreply@anthropic.com>';
      const r = tryCommit({ 'src/app/__hook_probe.ts': CLEAN_TS }, msg);
      return {
        ok: !r.committed && /no-ai-attribution/.test(r.out),
        detail: `committed=${r.committed}`,
      };
    },
  },
  // Q1.3 — pre-push (verify:fast): a lint-clean but failing unit test must not reach the remote
  {
    name: 'pre-push blocks a failing unit test',
    run: () => {
      const spec = [
        "describe('hook probe', () => {",
        "  it('fails on purpose', () => {",
        '    // Act',
        '    const value = [1].length;',
        '',
        '    // Assert',
        '    expect(value).toBe(2);',
        '  });',
        '});',
        '',
      ].join('\n');
      const remote = mkdtempSync(join(tmpdir(), 'hook-probes-remote-'));
      try {
        spawnSync('git', ['init', '--bare', '--quiet', remote]);
        writeFileSync(join(wt, 'src/app/__hook_probe.spec.ts'), spec);
        git('add', 'src/app/__hook_probe.spec.ts');
        const c = git('commit', '-m', 'test: failing probe');
        if (c.code !== 0) return { ok: false, detail: `setup commit failed:\n${c.out}` };
        const r = git('push', remote, 'HEAD:refs/heads/probe');
        const landed =
          spawnSync('git', ['--git-dir', remote, 'rev-parse', '--verify', '-q', 'probe']).status ===
          0;
        git('reset', '--hard', 'HEAD~1');
        return {
          ok: r.code !== 0 && !landed && /fails on purpose/.test(r.out),
          detail: `pushed=${landed}`,
        };
      } finally {
        rmSync(remote, { recursive: true, force: true });
      }
    },
  },
];

let failed = 0;
try {
  const add = spawnSync('git', ['worktree', 'add', '--detach', '--quiet', wt, 'HEAD'], {
    cwd: repo,
    encoding: 'utf8',
  });
  if (add.status !== 0) throw new Error(`git worktree add failed: ${add.stderr}`);
  symlinkSync(join(repo, 'node_modules'), join(wt, 'node_modules'), 'dir');
  // `.husky/_` hook shims are git-ignored; `npm ci` creates them via the `prepare` script.
  const husky = sh(join(wt, 'node_modules/.bin/husky'), []);
  if (husky.code !== 0) throw new Error(`husky install failed: ${husky.out}`);

  for (const p of PROBES) {
    const { ok, detail } = p.run();
    if (!ok) failed++;
    console[ok ? 'log' : 'error'](`${ok ? 'PASS' : 'FAIL'}  ${p.name} (${detail})`);
  }
} finally {
  spawnSync('git', ['worktree', 'remove', '--force', wt], { cwd: repo });
  rmSync(wt, { recursive: true, force: true });
  spawnSync('git', ['worktree', 'prune'], { cwd: repo });
}
console.log(
  failed
    ? `\n${failed} hook probe(s) failed`
    : `\nAll ${PROBES.length} hook probes behaved as expected`,
);
process.exit(failed ? 1 : 0);
