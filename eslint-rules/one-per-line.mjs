/**
 * Local ESLint rule: one item per line whenever there is more than one.
 *
 * Applies to:
 * - the parameters of a function or method definition;
 * - the arguments of a call or `new`;
 * - the properties of an object literal and of an object destructuring;
 * - the elements of an array literal and of an array destructuring;
 * - the members of an inline type literal (`{ a: T; b: U }`).
 *
 * Skipped: decorators, parameters that carry decorators, and the test DSL
 * (`describe`, `it`, `test`, the hooks, and their `.each` / `.only` / `.skip`
 * forms), whose `(name, callback)` shape reads better on one line.
 *
 * The fixer only inserts line breaks; indentation is left to
 * `@stylistic/indent` and the trailing comma to `@stylistic/comma-dangle`.
 */

/** Test functions whose `(name, callback)` calls stay on one line. */
const TEST_DSL = new Set([
  'describe',
  'it',
  'test',
  'beforeAll',
  'afterAll',
  'beforeEach',
  'afterEach',
]);

/** True for `it(...)`, `it.only(...)` and `it.each(table)(...)`. */
function isTestDslCall(callee) {
  if (callee?.type === 'Identifier') {
    return TEST_DSL.has(callee.name);
  }

  if (callee?.type === 'MemberExpression') {
    return isTestDslCall(callee.object);
  }

  if (callee?.type === 'CallExpression') {
    return isTestDslCall(callee.callee);
  }

  return false;
}

/** True when every item sits on a line of its own between `open` and `close`. */
function isOnePerLine(open, items, close) {
  if (open.loc.end.line === items[0].loc.start.line) {
    return false;
  }

  for (let index = 1; index < items.length; index += 1) {
    if (items[index - 1].loc.end.line === items[index].loc.start.line) {
      return false;
    }
  }

  return items[items.length - 1].loc.end.line !== close.loc.start.line;
}

/** Builds the fixes that move each item that shares a line onto its own. */
function lineBreakFixes(fixer, sourceCode, { open, items, close }) {
  const fixes = [];

  if (open.loc.end.line === items[0].loc.start.line) {
    fixes.push(fixer.insertTextAfter(open, '\n'));
  }

  for (let index = 1; index < items.length; index += 1) {
    if (items[index - 1].loc.end.line !== items[index].loc.start.line) {
      continue;
    }

    const comma = sourceCode.getTokenAfter(items[index - 1], (token) => token.value === ',');

    fixes.push(
      comma && comma.range[1] <= items[index].range[0]
        ? fixer.insertTextAfter(comma, '\n')
        : fixer.insertTextBefore(items[index], '\n'),
    );
  }

  if (items[items.length - 1].loc.end.line === close.loc.start.line) {
    fixes.push(fixer.insertTextBefore(close, '\n'));
  }

  return fixes;
}

/** Reports a list of more than one item that is not laid out one per line. */
function check(context, node, { items: rawItems, open, close }) {
  const items = rawItems.filter(Boolean);

  if (items.length <= 1 || !open || !close || isOnePerLine(open, items, close)) {
    return;
  }

  context.report({
    node,
    messageId: 'onePerLine',
    fix: (fixer) => lineBreakFixes(fixer, context.sourceCode, { open, items, close }),
  });
}

/** Checks the parameters of a function or method definition. */
function checkParams(context, node) {
  const params = node.params ?? [];

  if (params.length <= 1 || params.some((param) => (param.decorators?.length ?? 0) > 0)) {
    return;
  }

  const sourceCode = context.sourceCode;

  check(context, node, {
    items: params,
    open: sourceCode.getFirstToken(node, (token) => token.value === '('),
    close: sourceCode.getTokenAfter(params[params.length - 1], (token) => token.value === ')'),
  });
}

/** Checks the arguments of a call or `new`, skipping decorators and the test DSL. */
function checkArgs(context, node) {
  const args = node.arguments ?? [];

  if (args.length <= 1 || node.parent?.type === 'Decorator' || isTestDslCall(node.callee)) {
    return;
  }

  const sourceCode = context.sourceCode;

  check(context, node, {
    items: args,
    open: sourceCode.getTokenBefore(args[0], (token) => token.value === '('),
    close: sourceCode.getTokenAfter(args[args.length - 1], (token) => token.value === ')'),
  });
}

/** Checks the items between `{}` or `[]`. */
function checkBracketed(context, node, items) {
  const sourceCode = context.sourceCode;

  check(context, node, {
    items,
    open: sourceCode.getFirstToken(node),
    close: sourceCode.getLastToken(node),
  });
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'layout',
    docs: { description: 'One item per line when there is more than one (params, args, objects, arrays).' },
    fixable: 'whitespace',
    schema: [],
    messages: { onePerLine: 'With more than one item, each must sit on its own line.' },
  },

  create(context) {
    const params = (node) => checkParams(context, node);
    const args = (node) => checkArgs(context, node);

    return {
      ObjectExpression: (node) => checkBracketed(context, node, node.properties),
      ObjectPattern: (node) => checkBracketed(context, node, node.properties),
      ArrayExpression: (node) => checkBracketed(context, node, node.elements),
      ArrayPattern: (node) => checkBracketed(context, node, node.elements),
      TSTypeLiteral: (node) => checkBracketed(context, node, node.members),
      FunctionDeclaration: params,
      FunctionExpression: params,
      ArrowFunctionExpression: params,
      TSDeclareFunction: params,
      CallExpression: args,
      NewExpression: args,
    };
  },
};
