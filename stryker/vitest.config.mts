import { defineConfig } from 'vitest/config';

// Mutation testing (specs/quality-gates/tasks.md Q5.1): the framework-free specs of the mutated
// modules, in plain Node. `ng test` stays the source of truth for the full Angular suite.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/app/core/producer/engine/metrics.spec.ts',
      'src/app/core/producer/engine/producer-settings.spec.ts',
      'src/app/shared/format/market-format.spec.ts',
    ],
  },
});
