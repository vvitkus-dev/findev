// Commit-message gate (docs/QUALITY_GATES_PLAN.md Q1.2): conventional commits + no AI attribution.
const AI_ATTRIBUTION =
  /\b(claude|anthropic)\b|generated (with|by) .*\b(ai|claude|copilot|chatgpt)\b/i;

export default {
  extends: ['@commitlint/config-conventional'],
  plugins: [
    {
      rules: {
        'no-ai-attribution': ({ raw }) => [
          !AI_ATTRIBUTION.test(raw ?? ''),
          'commit messages must not mention AI assistants (no Claude/Anthropic/"Generated with" lines)',
        ],
      },
    },
  ],
  rules: {
    'no-ai-attribution': [2, 'always'],
    'subject-case': [2, 'never', ['sentence-case', 'start-case', 'pascal-case', 'upper-case']],
    'header-max-length': [2, 'always', 100],
  },
};
