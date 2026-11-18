#!/usr/bin/env node
// Post-deploy smoke check (Implementation step 8.4/8.5):
//   node scripts/smoke-deploy.mjs <base-url> [--sha <short-sha>] [--timeout <seconds>]
// 1. GET <base>/            → 200, HTML contains <app-root
// 2. GET <base>/wasm/producer.wasm → 200, content-type application/wasm
// 3. GET <base>/dashboard, /settings → 200 with the app shell (one page per route)
//    GET <base>/no-such-page        → 404 with the app shell (404.html fallback)
// 4. --sha: the main bundle referenced by index.html contains the commit SHA (the live site is
//    the new build, not a cached old one).
// Pages can take a moment to switch over after a deploy, so failed checks are retried until
// --timeout (default 0 = single attempt).

const args = process.argv.slice(2);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? undefined : args.splice(i, 2)[1];
};
const sha = option('--sha');
const timeoutSec = Number(option('--timeout') ?? 0);
const [base] = args;
if (!base || Number.isNaN(timeoutSec)) {
  console.error('usage: node scripts/smoke-deploy.mjs <base-url> [--sha <sha>] [--timeout <s>]');
  process.exit(2);
}
const root = base.endsWith('/') ? base : `${base}/`;

async function get(path) {
  const res = await fetch(new URL(path, root), { cache: 'no-store', redirect: 'follow' });
  return {
    status: res.status,
    type: res.headers.get('content-type') ?? '',
    body: await res.text(),
  };
}

/** null when the response has one of `statuses` and contains the app shell. */
const shellProblem = (r, statuses) =>
  statuses.includes(r.status) && r.body.includes('<app-root')
    ? null
    : `status ${r.status}, app shell ${r.body.includes('<app-root') ? 'present' : 'missing'}`;

const checks = [
  [
    'index serves the app shell',
    async () => {
      const r = await get('');
      return r.status === 200 && r.body.includes('<app-root') ? null : `status ${r.status}`;
    },
  ],
  [
    'wasm is served as application/wasm',
    async () => {
      const r = await get('wasm/producer.wasm');
      return r.status === 200 && r.type.startsWith('application/wasm')
        ? null
        : `status ${r.status}, content-type "${r.type}"`;
    },
  ],
  ...['dashboard', 'settings'].map((route) => [
    `deep link /${route} serves the app shell with status 200`,
    async () => shellProblem(await get(route), [200]),
  ]),
  [
    'unknown URL falls back to the app shell (404.html)',
    async () => shellProblem(await get('no-such-page'), [404]),
  ],
];
if (sha) {
  checks.push([
    `live bundle is build ${sha}`,
    async () => {
      const index = await get('');
      const main = /src="(main-[^"]+\.js)"/.exec(index.body)?.[1];
      if (!main) return 'no main-*.js in index.html';
      const bundle = await get(main);
      return bundle.body.includes(sha) ? null : `${main} does not contain ${sha}`;
    },
  ]);
}

async function runAll() {
  const failures = [];
  for (const [name, check] of checks) {
    const problem = await check().catch((e) => String(e));
    console.log(`${problem ? 'FAIL' : 'PASS'}  ${name}${problem ? ` — ${problem}` : ''}`);
    if (problem) failures.push(name);
  }
  return failures;
}

const deadline = Date.now() + timeoutSec * 1000;
for (;;) {
  console.log(`smoke: ${root}`);
  const failures = await runAll();
  if (failures.length === 0) {
    console.log('OK smoke-deploy');
    process.exit(0);
  }
  if (Date.now() >= deadline) {
    console.error(`smoke-deploy failed: ${failures.join('; ')}`);
    process.exit(1);
  }
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}
