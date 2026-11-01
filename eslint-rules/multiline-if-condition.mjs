/**
 * Local ESLint rule: a condition with more than one clause puts each clause on
 * its own line.
 *
 * When the test of an `if`, `while` or `do-while` is a logical expression
 * (`&&` / `||`), every operator leads a line of its own, and the parentheses
 * sit on lines of their own:
 *
 *   if (
 *     amount > available
 *     || isFrozen
 *   ) {
 *
 * The fixer inserts the line breaks and the indentation, because
 * `@stylistic/indent` does not indent the continuation of a logical expression.
 *
 * A logical operator under a non-logical node is left alone (`foo(a || b)`),
 * but a parenthesized logical operand is descended into, so
 * `if (a && (b || c))` is split at every operator. The result is valid but no
 * longer shows the precedence through indentation; prefer naming the inner
 * group (`const isEligible = b || c;`) in that case.
 */

/** Collects the `&&` / `||` tokens at the top of a logical expression tree. */
function collectLogicalOperators(sourceCode, node, operators) {
  if (node.type !== 'LogicalExpression') {
    return;
  }

  collectLogicalOperators(sourceCode, node.left, operators);

  const operatorToken = sourceCode.getFirstTokenBetween(
    node.left,
    node.right,
    (token) => token.value === node.operator,
  );

  if (operatorToken) {
    operators.push(operatorToken);
  }

  collectLogicalOperators(sourceCode, node.right, operators);
}

/** Checks one statement that has a `test` (if / while / do-while). */
function checkStatement(context, sourceCode, node) {
  const test = node.test;

  if (test?.type !== 'LogicalExpression') {
    return;
  }

  const open = sourceCode.getTokenBefore(test, (token) => token.value === '(');
  const close = sourceCode.getTokenAfter(test, (token) => token.value === ')');

  if (!open || !close) {
    return;
  }

  const operators = [];

  collectLogicalOperators(sourceCode, test, operators);

  const splitAfterOpen = open.loc.end.line === test.loc.start.line;
  const splitBeforeClose = test.loc.end.line === close.loc.start.line;
  const inlineOperators = operators.filter(
    (operator) => sourceCode.getTokenBefore(operator)?.loc.end.line === operator.loc.start.line,
  );

  if (!splitAfterOpen && !splitBeforeClose && inlineOperators.length === 0) {
    return;
  }

  context.report({
    node: test,
    messageId: 'multiline',
    fix(fixer) {
      const base = sourceCode.getFirstToken(node).loc.start.column;
      const inner = `\n${' '.repeat(base + 2)}`;
      const outer = `\n${' '.repeat(base)}`;
      const fixes = [];

      if (splitAfterOpen) {
        fixes.push(fixer.insertTextAfter(open, inner));
      }

      for (const operator of inlineOperators) {
        fixes.push(fixer.insertTextBefore(operator, inner));
      }

      if (splitBeforeClose) {
        fixes.push(fixer.insertTextBefore(close, outer));
      }

      return fixes;
    },
  });
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    docs: { description: 'Each clause (&& / ||) of a composite condition on its own line.' },
    fixable: 'whitespace',
    schema: [],
    messages: { multiline: 'A condition with more than one clause (&& / ||) must put each clause on its own line.' },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const check = (node) => checkStatement(context, sourceCode, node);

    return {
      IfStatement: check,
      WhileStatement: check,
      DoWhileStatement: check,
    };
  },
};
