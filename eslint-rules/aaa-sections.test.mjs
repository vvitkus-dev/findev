// Run: npm run test:lint-rules  (Node built-in test runner + ESLint RuleTester)
import { describe, it } from 'node:test';
import { RuleTester } from 'eslint';
import rule from './aaa-sections.js';

RuleTester.describe = describe;
RuleTester.it = it;

const tester = new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: 'module' } });

tester.run('local/aaa-sections', rule, {
  valid: [
    {
      name: 'full Arrange / Act / Assert',
      code: `it('x', () => {
        // Arrange
        const a = 1;
        // Act
        const b = a + 1;
        // Assert
        expect(b).toBe(2);
      });`,
    },
    {
      name: 'Arrange omitted',
      code: `it('x', async () => {
        // Act
        await fixture.whenStable();
        // Assert
        expect(1).toBe(1);
      });`,
    },
    {
      name: 'combined Act & Assert one-liner',
      code: `test('throws', () => {
        // Act & Assert
        expect(() => f()).toThrow();
      });`,
    },
    {
      name: 'multiple Assert sections allowed',
      code: `it('x', () => {
        // Act
        run();
        // Assert
        expect(a).toBe(1);
        // Assert — side effects
        expect(b).toBe(2);
      });`,
    },
    {
      name: 'it.each form',
      code: `it.each([1])('x %i', (n) => {\n// Act\nconst r = n;\n// Assert\nexpect(r).toBe(1);\n});`,
    },
    { name: 'non-test calls ignored', code: `describe('d', () => { foo(); });` },
  ],
  invalid: [
    {
      name: 'no sections',
      code: `it('x', () => { expect(1).toBe(1); });`,
      errors: [{ messageId: 'missingAct' }],
    },
    {
      name: 'two Act sections',
      code: `it('x', () => {\n// Act\na();\n// Assert\nexpect(1).toBe(1);\n// Act\nb();\n// Assert\nexpect(2).toBe(2);\n});`,
      errors: [{ messageId: 'multipleAct' }],
    },
    {
      name: 'missing Assert',
      code: `it('x', () => {\n// Arrange\nconst a = 1;\n// Act\nrun(a);\n});`,
      errors: [{ messageId: 'missingAssert' }],
    },
    {
      name: 'Assert before Act only',
      code: `it('x', () => {\n// Assert\nexpect(1).toBe(1);\n// Act\nrun();\n});`,
      errors: [{ messageId: 'missingAssert' }],
    },
    {
      name: 'Arrange after Act',
      code: `it('x', () => {\n// Act\nrun();\n// Arrange\nconst a = 1;\n// Assert\nexpect(a).toBe(1);\n});`,
      errors: [{ messageId: 'arrangeAfterAct' }],
    },
  ],
});
