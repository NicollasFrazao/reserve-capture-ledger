import { ruleTester } from './rule-tester.mjs';
import rule from './one-per-line.mjs';

const error = { messageId: 'onePerLine' };

ruleTester.run('one-per-line', rule, {
  valid: [
    { name: 'a single argument stays inline', code: 'run(amount);' },
    { name: 'a single property stays inline', code: 'const a = { amount };' },
    { name: 'one argument per line', code: 'transfer(\n  from,\n  to,\n);' },
    { name: 'one property per line', code: 'const a = {\n  id,\n  amount,\n};' },
    { name: 'the test DSL keeps name and callback together', code: "it('works', () => {\n  run();\n});" },
    { name: 'the .each form of the test DSL too', code: "it.each([1])('case %s', (value) => {\n  run(value);\n});" },
    { name: 'empty lists are fine', code: 'run(); const a = {}; const b = [];' },
  ],
  invalid: [
    {
      name: 'two arguments on one line',
      code: 'transfer(from, to);',
      // Breaks only; indentation and leftover spaces are `@stylistic/indent` and `no-trailing-spaces`.
      output: 'transfer(\nfrom,\n to\n);',
      errors: [error],
    },
    {
      name: 'object literal properties',
      code: 'const a = { id, amount };',
      output: 'const a = {\n id,\n amount \n};',
      errors: [error],
    },
    {
      name: 'array elements',
      code: 'const a = [1, 2];',
      output: 'const a = [\n1,\n 2\n];',
      errors: [error],
    },
    {
      name: 'function parameters',
      code: 'function f(a, b) {\n  return a;\n}',
      output: 'function f(\na,\n b\n) {\n  return a;\n}',
      errors: [error],
    },
    {
      name: 'inline type literal members',
      code: 'type T = { a: string; b: number };',
      output: 'type T = {\n a: string; \nb: number \n};',
      errors: [error],
    },
  ],
});
