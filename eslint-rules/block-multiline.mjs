/**
 * Local ESLint rule: the body of a control block is never inline.
 *
 * For `if` / `else` / `for` / `for-in` / `for-of` / `while` / `do-while` /
 * `try` / `catch` / `finally`, a non-empty body starts on the line after `{`
 * and ends on the line before `}`. Together with `curly: all`, this removes
 * the one-line `if (x) { return; }`.
 *
 * The fixer only inserts line breaks; indentation is left to `@stylistic/indent`.
 * Function bodies are not targeted.
 */

/** Reports a non-empty block whose body shares a line with its braces. */
function checkBlock(context, sourceCode, block) {
  if (block?.type !== 'BlockStatement' || block.body.length === 0) {
    return;
  }

  const open = sourceCode.getFirstToken(block);
  const close = sourceCode.getLastToken(block);
  const needsBreakAfterOpen = open.loc.end.line === block.body[0].loc.start.line;
  const needsBreakBeforeClose = block.body[block.body.length - 1].loc.end.line === close.loc.start.line;

  if (!needsBreakAfterOpen && !needsBreakBeforeClose) {
    return;
  }

  context.report({
    node: block,
    messageId: 'multiline',
    fix(fixer) {
      const fixes = [];

      if (needsBreakAfterOpen) {
        fixes.push(fixer.insertTextAfter(open, '\n'));
      }

      if (needsBreakBeforeClose) {
        fixes.push(fixer.insertTextBefore(close, '\n'));
      }

      return fixes;
    },
  });
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    docs: { description: 'The body of a control block (if, loops, try) on lines of its own.' },
    fixable: 'whitespace',
    schema: [],
    messages: { multiline: 'A block body cannot be inline: put it on lines of its own.' },
  },

  create(context) {
    const sourceCode = context.sourceCode;
    const checkBody = (node) => checkBlock(context, sourceCode, node.body);

    return {
      IfStatement(node) {
        checkBlock(context, sourceCode, node.consequent);
        checkBlock(context, sourceCode, node.alternate);
      },
      ForStatement: checkBody,
      ForInStatement: checkBody,
      ForOfStatement: checkBody,
      WhileStatement: checkBody,
      DoWhileStatement: checkBody,
      CatchClause: checkBody,
      TryStatement(node) {
        checkBlock(context, sourceCode, node.block);
        checkBlock(context, sourceCode, node.finalizer);
      },
    };
  },
};
