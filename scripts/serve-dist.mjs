#!/usr/bin/env node
// Serves the Pages build the way GitHub Pages does, for the E2E suite (docs/QUALITY_GATES_PLAN.md Q3.1):
// the app lives under a sub-path (`/findev/`), `/x` is served from `x.html`, unknown paths get
// `404.html` with status 404 (the SPA fallback), and `.wasm` is served as `application/wasm`.
// Usage: node scripts/serve-dist.mjs [--dir dist/findev/browser] [--base /findev/] [--port 4300]
import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    dir: { type: 'string', default: 'dist/findev/browser' },
    base: { type: 'string', default: '/findev/' },
    port: { type: 'string', default: '4300' },
  },
});
const root = resolve(values.dir);
const base = values.base.endsWith('/') ? values.base : `${values.base}/`;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

if (!existsSync(join(root, 'index.html'))) {
  console.error(`serve-dist: ${root}/index.html not found — run npm run build:pages first`);
  process.exit(1);
}

/** The file for a URL path inside the base, or null (outside the base, traversal, missing). */
function resolveFile(pathname) {
  if (!pathname.startsWith(base) && `${pathname}/` !== base) return null;
  const relative = decodeURIComponent(pathname.slice(base.length));
  const file = normalize(join(root, relative));
  if (file !== root && !file.startsWith(root + sep)) return null;
  // Like Pages: `/settings` is served from `settings.html` when there is no such file.
  if (!existsSync(file)) return existsSync(`${file}.html`) ? `${file}.html` : null;
  if (statSync(file).isDirectory()) {
    const index = join(file, 'index.html');
    return existsSync(index) ? index : null;
  }
  return file;
}

function send(res, status, file) {
  res.writeHead(status, {
    'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  createReadStream(file).pipe(res);
}

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  const file = resolveFile(pathname);
  if (file !== null) return send(res, 200, file);
  const fallback = join(root, '404.html');
  if (pathname.startsWith(base) && existsSync(fallback)) return send(res, 404, fallback);
  res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
});

server.listen(Number(values.port), () => {
  console.log(`serve-dist: ${root} at http://localhost:${values.port}${base}`);
});
