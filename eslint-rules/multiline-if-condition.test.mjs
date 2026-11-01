import { ruleTester } from './rule-tester.mjs';
import rule from './multiline-if-condition.mjs';

const error = { messageId: 'multiline' };

ruleTester.run('multiline-if-condition', rule, {
  valid: [
    { name: 'a single clause stays inline', code: 'if (isDue) {\n  run();\n}' },
    { name: 'a logical operator inside a call is not the condition', code: 'if (check(a || b)) {\n  run();\n}' },
    {
      name: 'one clause per line, operators leading',
      code: 'if (\n  amount > available\n  || isFrozen\n) {\n  refuse();\n}',
    },
    {
      name: 'while loops follow the same layout',
      code: 'while (\n  hasNext\n  && budget > 0\n) {\n  step();\n}',
    },
  ],
  invalid: [
    {
      name: 'two clauses on one line',
      code: 'if (amount > available || isFrozen) {\n  refuse();\n}',
      // The fixer only inserts breaks; the space it leaves before them is `no-trailing-spaces`' to remove.
      output: 'if (\n  amount > available \n  || isFrozen\n) {\n  refuse();\n}',
      errors: [error],
    },
    {
      name: 'indented statement keeps its indentation',
      code: 'function f() {\n  if (a && b && c) {\n    run();\n  }\n}',
      output: 'function f() {\n  if (\n    a \n    && b \n    && c\n  ) {\n    run();\n  }\n}',
      errors: [error],
    },
    {
      name: 'operator trailing a line is moved to lead the next',
      code: 'if (\n  a &&\n  b\n) {\n  run();\n}',
      output: 'if (\n  a \n  &&\n  b\n) {\n  run();\n}',
      errors: [error],
    },
    {
      name: 'do-while is checked too',
      code: 'do {\n  step();\n} while (a || b);',
      output: 'do {\n  step();\n} while (\n  a \n  || b\n);',
      errors: [error],
    },
  ],
});
