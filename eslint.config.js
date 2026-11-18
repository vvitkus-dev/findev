// @ts-check
// Quality gates: docs/QUALITY_GATES_PLAN.md (Q0.2–Q0.6). Zero warnings allowed (`ng lint --max-warnings 0`).
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const sonarjs = require('eslint-plugin-sonarjs');
const vitest = require('@vitest/eslint-plugin');

// ---- Architecture & API bans (Q0.4) ---------------------------------------
// Flat config REPLACES (not merges) a rule set in an earlier block, so every block
// builds its options from these helpers to keep the global bans in place.
const FORMS_BAN = {
  name: '@angular/forms',
  importNames: [
    'FormGroup',
    'FormControl',
    'FormArray',
    'FormBuilder',
    'NonNullableFormBuilder',
    'ReactiveFormsModule',
    'FormsModule',
  ],
  message: 'Use Signal Forms from @angular/forms/signals (angular-developer skill).',
};
const restrictedImports = (...patterns) => [
  'error',
  { paths: [FORMS_BAN], patterns: patterns.flat() },
];
const NO_FEATURES = { group: ['**/features/**', '**/features'], message: 'core/shared must not depend on features.' };
const NO_CORE = { group: ['**/core/**', '**/core'], message: 'shared must not depend on core.' };
const NO_FRAMEWORK = {
  group: ['@angular/*', '@angular/**', 'rxjs', 'rxjs/*'],
  message: 'core/producer/engine runs in the Web Worker and must stay framework-free.',
};
const FEATURES = ['dashboard', 'settings'];
const otherFeatures = (name) =>
  FEATURES.filter((f) => f !== name).map((other) => ({
    regex: `(^|/)features/${other}(/|$)|^(\\.\\./)+${other}(/|$)`,
    message: 'Features must not import other features; move shared code to shared/ or core/.',
  }));

const BAN_INJECTABLE = {
  selector: "Decorator[expression.callee.name='Injectable']",
  message: 'Use @Service() (Angular 22) instead of @Injectable.',
};
const BAN_MATH_RANDOM = {
  selector: "MemberExpression[object.name='Math'][property.name='random']",
  message: 'Randomness lives in the Wasm generator; tests use fixed seeds.',
};
const BAN_MANUAL_CD = {
  selector: 'CallExpression[callee.property.name=/^(detectChanges|markForCheck)$/]',
  message: 'Zoneless tests: Act → await fixture.whenStable() → Assert (angular-developer skill).',
};
const restrictedSyntax = (...bans) => ['error', BAN_INJECTABLE, ...bans];

module.exports = defineConfig([
  {
    ignores: ['dist/**', '.angular/**', 'coverage/**', 'reports/**', '.claude/**', 'public/**'],
  },

  // ---- TypeScript (Q0.2) -------------------------------------------------
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      angular.configs.tsRecommended,
    ],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    processor: angular.processInlineTemplates,
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        { type: 'attribute', prefix: 'app', style: 'camelCase' },
      ],
      '@angular-eslint/component-selector': [
        'error',
        { type: 'element', prefix: 'app', style: 'kebab-case' },
      ],
      // Modern Angular (angular-developer skill)
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-inject': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      // Type safety
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-module-boundary-types': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      eqeqeq: ['error', 'always'],
      'no-console': ['error', { allow: ['warn', 'error'] }],
      'no-restricted-imports': restrictedImports(),
      'no-restricted-syntax': restrictedSyntax(),
    },
  },

  // ---- Architecture boundaries (Q0.4) — order matters: later blocks win ----
  {
    files: ['src/app/core/**/*.ts'],
    rules: {
      'no-restricted-imports': restrictedImports(NO_FEATURES),
      'no-restricted-syntax': restrictedSyntax(BAN_MATH_RANDOM),
    },
  },
  {
    files: ['src/app/core/producer/engine/**/*.ts'],
    rules: { 'no-restricted-imports': restrictedImports(NO_FEATURES, NO_FRAMEWORK) },
  },
  {
    files: ['src/app/shared/**/*.ts'],
    rules: { 'no-restricted-imports': restrictedImports(NO_FEATURES, NO_CORE) },
  },
  ...FEATURES.map((feature) => ({
    files: [`src/app/features/${feature}/**/*.ts`],
    rules: { 'no-restricted-imports': restrictedImports(otherFeatures(feature)) },
  })),
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    rules: { 'no-restricted-syntax': restrictedSyntax(BAN_MATH_RANDOM, BAN_MANUAL_CD) },
  },

  // ---- Test hygiene (Q0.5) ------------------------------------------------
  {
    files: ['**/*.spec.ts', '**/*.test.ts'],
    plugins: { vitest },
    rules: {
      ...vitest.configs.recommended.rules,
      'vitest/no-focused-tests': 'error',
      'vitest/no-disabled-tests': 'error',
      'vitest/no-commented-out-tests': 'error',
      'vitest/expect-expect': 'error',
      'vitest/valid-expect': 'error',
      'vitest/no-identical-title': 'error',
      'vitest/no-conditional-in-test': 'error',
      'vitest/no-conditional-expect': 'error',
      'vitest/no-standalone-expect': 'error',
      'vitest/require-top-level-describe': 'error',
      'vitest/max-nested-describe': ['error', { max: 2 }],
      'vitest/consistent-test-it': ['error', { fn: 'it', withinDescribe: 'it' }],
      'vitest/prefer-to-be': 'error',
    },
  },

  // ---- Complexity & size limits (Q0.3) -----------------------------------
  {
    files: ['**/*.ts'],
    plugins: { sonarjs },
    rules: {
      complexity: ['error', 10],
      'max-depth': ['error', 3],
      'max-params': ['error', 4],
      'max-lines-per-function': ['error', { max: 60, skipBlankLines: true, skipComments: true }],
      'max-lines': ['error', { max: 300, skipBlankLines: true, skipComments: true }],
      'sonarjs/cognitive-complexity': ['error', 15],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', 'e2e/**/*.ts'],
    rules: {
      'max-lines-per-function': 'off',
      'max-lines': ['error', { max: 600, skipBlankLines: true, skipComments: true }],
    },
  },

  // ---- Angular templates (Q0.2, Q0.3) ------------------------------------
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/button-has-type': 'error',
      '@angular-eslint/template/no-any': 'error',
      '@angular-eslint/template/cyclomatic-complexity': ['error', { maxComplexity: 8 }],
      '@angular-eslint/template/conditional-complexity': ['error', { maxComplexity: 4 }],
    },
  },
]);
