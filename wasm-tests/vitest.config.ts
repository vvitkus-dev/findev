import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

// Integration tests of the real compiled module (public/wasm/producer.wasm, from `npm run wasm:build`)
// through the production adapter. Node environment: no DOM, no Angular.
export default defineConfig({
  // Keep Vite's cache in the root node_modules (git-ignored), not wasm-tests/node_modules.
  cacheDir: fileURLToPath(new URL('../node_modules/.vite/wasm-tests', import.meta.url)),
  test: {
    root: import.meta.dirname,
    include: ['**/*.test.ts'],
    environment: 'node',
  },
});
