// @ts-check
// Quality gates: docs/QUALITY_GATES_PLAN.md (Q0.2–Q0.6). Zero warnings allowed (`ng lint --max-warnings 0`).
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');
const sonarjs = require('eslint-plugin-sonarjs');
const vitest = require('@vitest/eslint-plugin');
const aaaSections = require('./eslint-rules/aaa-sections.js');
const eslintComments = require('@eslint-community/eslint-plugin-eslint-comments');

const local = { rules: { 'aaa-sections': aaaSections } };

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
// Relative-path regexes only: a glob like `**/core` would also match npm packages such as
// `@angular/core` (it did — caught when the first shared pipe was written).
const relativeDir = (dir) => `^\\.{1,2}/(\\.\\./)*${dir}(/|$)|(^|/)src/app/${dir}(/|$)`;
const NO_FEATURES = {
  regex: relativeDir('features'),
  message: 'core/shared must not depend on features.',
};
const NO_CORE = { regex: relativeDir('core'), message: 'shared must not depend on core.' };
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
const BAN_NEW_WORKER = {
  selector: "NewExpression[callee.name='Worker']",
  message:
    'One worker per app: create it only via the WORKER_FACTORY default in core/producer/producer-tokens.ts.',
};
const ON_FORM_FIELD = "Element:has(BoundAttribute[name='formField'])";
const FORM_FIELD_MESSAGE =
  'Signal Forms: no min/max/value/disabled/readonly on a [formField] input — use schema rules (min(), max(), disabled(), readonly()).';
const FORM_FIELD_BANS = [
  `${ON_FORM_FIELD} > :matches(TextAttribute, BoundAttribute)[name=/^(min|max|disabled|readonly)$/]`,
  `${ON_FORM_FIELD} > BoundAttribute[name='value']`,
  // A static value is allowed (and required) on radio/checkbox inputs: it names the option.
  `${ON_FORM_FIELD}:not(:has(TextAttribute[name='type'][value=/^(radio|checkbox)$/])) > TextAttribute[name='value']`,
].map((selector) => ({ selector, message: FORM_FIELD_MESSAGE }));
const restrictedSyntax = (...bans) => ['error', BAN_INJECTABLE, BAN_NEW_WORKER, ...bans];

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
        // The root tsconfig lists no files; the Playwright config is typed by the E2E project.
        projectService: {
          allowDefaultProject: ['playwright.config.ts'],
          defaultProject: 'e2e/tsconfig.json',
        },
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
      // Angular components/directives may legitimately have empty decorated classes.
      '@typescript-eslint/no-extraneous-class': ['error', { allowWithDecorator: true }],
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
    // The single allowed `new Worker` (WORKER_FACTORY default); every other ban still applies.
    files: ['src/app/core/producer/producer-tokens.ts'],
    rules: { 'no-restricted-syntax': ['error', BAN_INJECTABLE, BAN_MATH_RANDOM] },
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
    plugins: { vitest, local },
    rules: {
      ...vitest.configs.recommended.rules,
      'local/aaa-sections': 'error', // Q0.6
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

  // Playwright E2E (Q3.2): same AAA sections and no focused tests; Vitest rules don't apply.
  {
    files: ['e2e/**/*.e2e.ts'],
    plugins: { local },
    rules: { 'local/aaa-sections': 'error' },
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

  // ---- Suppression discipline (Q1.5) --------------------------------------
  // Every disable needs `-- reason`; blanket disables are banned; architecture rules can't be disabled.
  {
    files: ['**/*.ts'],
    plugins: { '@eslint-community/eslint-comments': eslintComments },
    linterOptions: { reportUnusedDisableDirectives: 'error' },
    rules: {
      '@eslint-community/eslint-comments/require-description': ['error', { ignore: [] }],
      '@eslint-community/eslint-comments/no-unlimited-disable': 'error',
      '@eslint-community/eslint-comments/disable-enable-pair': 'error',
      '@eslint-community/eslint-comments/no-restricted-disable': [
        'error',
        'no-restricted-imports',
        'no-restricted-syntax',
        'local/aaa-sections',
        'vitest/no-focused-tests',
        'vitest/no-disabled-tests',
      ],
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
      // Signal Forms: [formField] owns these; limits/state come from the schema (angular-developer skill).
      'no-restricted-syntax': ['error', ...FORM_FIELD_BANS],
    },
  },
]);
