// @ts-check
// Mutation testing (docs/QUALITY_GATES_PLAN.md Q5.1): Stryker changes the critical pure modules
// one mutant at a time; a mutant that no test notices is a gap in the tests, not the code.
// Run: npm run test:mutation → reports/mutation/index.html. Weekly in CI (too slow per push).
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: 'vitest',
  vitest: { configFile: 'stryker/vitest.config.mts' },
  mutate: [
    'src/app/core/producer/engine/metrics.ts',
    'src/app/core/producer/engine/producer-settings.ts',
    'src/app/shared/format/market-format.ts',
  ],
  coverageAnalysis: 'perTest',
  thresholds: { high: 90, low: 80, break: 80 },
  reporters: ['clear-text', 'progress', 'html', 'json'],
  htmlReporter: { fileName: 'reports/mutation/index.html' },
  jsonReporter: { fileName: 'reports/mutation/mutation.json' },
  tempDirName: '.stryker-tmp',
  cleanTempDir: 'always',
};
