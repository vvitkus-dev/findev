// @ts-check
// Local rule `local/aaa-sections` (specs/quality-gates/tasks.md Q0.6).
// Every it()/test() body must be structured with section comments:
//   // Arrange   (optional, at most once, before Act)
//   // Act       (exactly once; Angular's `await fixture.whenStable()` belongs here)
//   // Assert    (at least once, after Act)
// `// Act & Assert` is accepted for one-liners such as `expect(() => f()).toThrow()`.

const SECTION = /^\s*(Arrange|Act & Assert|Act|Assert)\b/;
const TEST_FNS = new Set(['it', 'test']);
// Playwright hangs suites, hooks and steps off `test`; their callbacks are not tests.
const NOT_TESTS = new Set([
  'describe',
  'beforeEach',
  'afterEach',
  'beforeAll',
  'afterAll',
  'step',
  'use',
  'extend',
]);

/** @param {import('eslint').Rule.Node} callee */
function isTestCall(callee) {
  if (callee.type === 'Identifier') return TEST_FNS.has(callee.name);
  // it.each(...)(...) / test.concurrent(...)
  if (callee.type === 'MemberExpression' && callee.object.type === 'Identifier') {
    const member = callee.property.type === 'Identifier' ? callee.property.name : '';
    return TEST_FNS.has(callee.object.name) && !NOT_TESTS.has(member);
  }
  if (callee.type === 'CallExpression') return isTestCall(callee.callee);
  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
  meta: {
    type: 'suggestion',
    docs: { description: 'Enforce Arrange / Act / Assert sections in tests' },
    schema: [],
    messages: {
      missingAct: 'Test must contain exactly one `// Act` section (or `// Act & Assert`).',
      multipleAct: 'Test has {{count}} `// Act` sections; one behaviour per test — split it.',
      missingAssert: 'Test must contain an `// Assert` section after `// Act`.',
      arrangeAfterAct: '`// Arrange` must come before `// Act`.',
      multipleArrange: 'Test has more than one `// Arrange` section.',
    },
  },
  create(context) {
    const sourceCode = context.sourceCode;
    return {
      CallExpression(node) {
        if (!isTestCall(node.callee)) return;
        const fn = node.arguments.find(
          (a) => a.type === 'ArrowFunctionExpression' || a.type === 'FunctionExpression',
        );
        if (!fn || fn.body.type !== 'BlockStatement') return;

        const sections = sourceCode
          .getCommentsInside(fn.body)
          .filter((c) => c.type === 'Line')
          .map((c) => SECTION.exec(c.value)?.[1])
          .filter((s) => s !== undefined);

        const acts = sections.filter((s) => s === 'Act' || s === 'Act & Assert');
        if (acts.length === 0) return context.report({ node, messageId: 'missingAct' });
        if (acts.length > 1) {
          return context.report({
            node,
            messageId: 'multipleAct',
            data: { count: String(acts.length) },
          });
        }

        const actIdx = sections.findIndex((s) => s === 'Act' || s === 'Act & Assert');
        const arranges = sections.filter((s) => s === 'Arrange');
        if (arranges.length > 1) context.report({ node, messageId: 'multipleArrange' });
        if (sections.lastIndexOf('Arrange') > actIdx)
          context.report({ node, messageId: 'arrangeAfterAct' });

        const combined = sections[actIdx] === 'Act & Assert';
        const assertAfterAct = sections.slice(actIdx + 1).includes('Assert');
        if (!combined && !assertAfterAct) context.report({ node, messageId: 'missingAssert' });
      },
    };
  },
};
