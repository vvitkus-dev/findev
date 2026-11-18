import { defineConfig } from 'vitest/config';

// Extra Vitest settings merged by `@angular/build:unit-test` (angular.json → test → ci → runnerConfig).
// Q2.2: critical-path coverage floors. The 65 % global floor lives in angular.json (coverageThresholds).
// Ratchet: raise freely; lowering needs a `chore(quality): lower threshold — <reason>` commit.
const CRITICAL = { statements: 85, branches: 85, functions: 85, lines: 85 };

export default defineConfig({
  test: {
    coverage: {
      thresholds: {
        'src/app/core/producer/**': CRITICAL,
        'src/app/shared/format/**': CRITICAL,
      },
    },
  },
});
