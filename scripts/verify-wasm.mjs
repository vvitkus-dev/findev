#!/usr/bin/env node
// Verifies the compiled producer against the ABI contract (specs/market-dashboard/design.md §3.1):
// exact exports, no imports, version, size budget, and a generate round trip whose records
// satisfy every market invariant. Usage: node scripts/verify-wasm.mjs [path] (default: public/wasm/producer.wasm)
import { readFileSync } from 'node:fs';

const PATH = process.argv[2] ?? 'public/wasm/producer.wasm';
const MAX_BYTES = 64 * 1024;
const EXPECTED = {
  memory: 'memory',
  abi_version: 'function',
  record_words: 'function',
  producer_create: 'function',
  producer_generate: 'function',
  producer_destroy: 'function',
};
const ABI_VERSION = 1;
const WORDS = 7;
const MAX_BOOK_QTY = 1000;

const errors = [];
const check = (ok, message) => {
  if (!ok) errors.push(message);
  return ok;
};

function checkShape(bytes, module) {
  check(bytes.length <= MAX_BYTES, `size ${bytes.length} B exceeds ${MAX_BYTES} B`);
  const actual = Object.fromEntries(
    WebAssembly.Module.exports(module).map((e) => [e.name, e.kind]),
  );
  check(
    JSON.stringify(Object.entries(actual).sort()) ===
      JSON.stringify(Object.entries(EXPECTED).sort()),
    `exports mismatch: got ${JSON.stringify(actual)}`,
  );
  const imports = WebAssembly.Module.imports(module);
  check(imports.length === 0, `module must not import anything, got ${JSON.stringify(imports)}`);
}

function recordErrors(w, instruments) {
  const [instrument, price, qty, bid, ask, bidQty, askQty] = w;
  return [
    instrument < instruments || 'instrument out of range',
    price > 0 || 'price ≤ 0',
    (bid > 0 && bid < ask) || 'not 0 < bid < ask',
    price === bid || price === ask || 'price not at bid/ask',
    qty >= 1 || 'trade qty < 1',
    (bidQty <= MAX_BOOK_QTY && askQty <= MAX_BOOK_QTY) || 'book qty out of range',
  ].filter((r) => r !== true);
}

function generateCopy(e, instruments, seedLo, seedHi, n) {
  const p = e.producer_create(instruments, seedLo, seedHi);
  const ptr = e.producer_generate(p, n);
  // A fresh view after generate: memory growth detaches earlier buffers.
  const words = ptr === 0 ? null : new Uint32Array(e.memory.buffer, ptr, n * WORDS).slice();
  e.producer_destroy(p);
  return words;
}

function checkRoundTrip(e) {
  check(e.abi_version() === ABI_VERSION, `abi_version() = ${e.abi_version()}, want ${ABI_VERSION}`);
  check(e.record_words() === WORDS, `record_words() = ${e.record_words()}, want ${WORDS}`);
  const words = generateCopy(e, 5, 0xdeadbeef, 1, 1000);
  if (!check(words !== null, 'producer_generate returned null for a valid call')) return;
  for (let i = 0; i < 1000; i++) {
    const bad = recordErrors(words.subarray(i * WORDS, (i + 1) * WORDS), 5);
    if (!check(bad.length === 0, `record ${i}: ${bad.join(', ')}`)) break;
  }
  const again = generateCopy(e, 5, 0xdeadbeef, 1, 1000);
  check(again !== null && again.every((w, i) => w === words[i]), 'same seed is not deterministic');
}

function checkInvalidInputs(e) {
  const p = e.producer_create(1, 1, 0);
  const results = {
    'create(0)': e.producer_create(0, 1, 0),
    'create(51)': e.producer_create(51, 1, 0),
    'generate(null)': e.producer_generate(0, 1),
    'generate(p, 0)': e.producer_generate(p, 0),
    'generate(p, 1001)': e.producer_generate(p, 1001),
  };
  e.producer_destroy(p);
  e.producer_destroy(0);
  for (const [call, value] of Object.entries(results))
    check(value === 0, `${call} = ${value}, want 0`);
}

let bytes;
try {
  bytes = readFileSync(PATH);
} catch {
  console.error(`FAIL ${PATH} not found — run npm run wasm:build`);
  process.exit(1);
}
const module = new WebAssembly.Module(bytes);
checkShape(bytes, module);
if (errors.length === 0) {
  const { exports } = new WebAssembly.Instance(module, {});
  checkRoundTrip(exports);
  checkInvalidInputs(exports);
}
if (errors.length) {
  console.error(`FAIL ${PATH}\n  - ${errors.join('\n  - ')}`);
  process.exit(1);
}
console.log(`OK exports=${Object.keys(EXPECTED).length} size=${bytes.length}B`);
