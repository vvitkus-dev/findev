#!/usr/bin/env node
// Claude Code PostToolUse hook (docs/QUALITY_GATES_PLAN.md Q1.4).
// Formats + lints the single file the agent just edited. On lint errors exits 2 with the
// errors on stderr, which Claude Code feeds back to the agent so it fixes them immediately.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bin = (name) => join(root, 'node_modules/.bin', name);

let filePath;
try {
  const payload = JSON.parse(readFileSync(0, 'utf8'));
  filePath = payload.tool_input?.file_path ?? payload.tool_response?.filePath;
} catch {
  process.exit(0); // not a hook payload we understand — never block the agent on that
}
if (typeof filePath !== 'string') process.exit(0);

const abs = resolve(root, filePath);
const rel = relative(root, abs);
const ext = extname(abs);
const outsideRepo = rel.startsWith('..');
if (outsideRepo || !existsSync(abs) || !['.ts', '.html', '.scss'].includes(ext)) process.exit(0);

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });

// 1) Format (respects .prettierignore).
run(bin('prettier'), ['--write', '--ignore-unknown', '--log-level', 'warn', rel]);

// 2) Lint TS / templates (respects eslint ignores; zero warnings, like the CI gate).
if (ext === '.ts' || ext === '.html') {
  const r = run(bin('eslint'), ['--max-warnings', '0', '--no-warn-ignored', rel]);
  if (r.status !== 0) {
    process.stderr.write(
      `Quality gate (ESLint) failed for ${rel} — fix these before continuing:\n${r.stdout}${r.stderr}`,
    );
    process.exit(2);
  }
}
process.exit(0);
