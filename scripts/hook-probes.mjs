#!/usr/bin/env node
// Proves the git hooks actually block bad commits/pushes (docs/QUALITY_GATES_PLAN.md Q1).
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
