import { ruleTester } from './rule-tester.mjs';
import rule from './jsdoc-tag-spacing.mjs';

/** Builds a doc comment followed by a declaration; an empty string is a blank comment line. */
function doc(...lines) {
  const body = lines.map((line) => (line === '' ? ' *' : ` * ${line}`)).join('\n');

  return `/**\n${body}\n */\nexport const value = 1;\n`;
}

ruleTester.run('jsdoc-tag-spacing', rule, {
  valid: [
    {
      name: 'same tag together, a different tag after one blank line',
      code: doc('Adds.', '', '@param a - first', '@param b - second', '', '@returns the sum'),
    },
    { name: 'metadata tags together', code: doc('@internal', '@deprecated use the other one') },
    { name: 'metadata tags with one blank line', code: doc('@internal', '', '@remarks Kept for replays.') },
    { name: '`@return` and `@returns` are one group', code: doc('@returns first', '@return second') },
    { name: 'a scoped package name is not a tag', code: doc('@param key - the key', '@scope/package owns it.') },
    { name: 'a decorator inside an example is not a tag', code: doc('@example', '@Injectable()', 'class A {}', '', '@returns nothing') },
    { name: 'a blank line inside a description is text', code: doc('@param a - first', '', '  more about a', '@param b - b') },
    { name: 'nothing inside a fence is a tag', code: doc('Usage:', '```', '@param a', '', '@param b', '```', '@returns nothing') },
    { name: 'a plain block comment is ignored', code: '/*\n * @param a\n *\n * @param b\n */\nexport const value = 1;\n' },
  ],
  invalid: [
    {
      name: 'blank line between two @param',
      code: doc('@param a - first', '', '@param b - second'),
      output: doc('@param a - first', '@param b - second'),
      errors: [{ messageId: 'noBlankSameType' }],
    },
    {
      name: 'no blank line between @param and @throws',
      code: doc('@param a - first', '@throws {@link RangeError} when negative'),
      output: doc('@param a - first', '', '@throws {@link RangeError} when negative'),
      errors: [{ messageId: 'missingBlankDiffType' }],
    },
    {
      name: 'two blank lines between groups',
      code: doc('@param a - first', '', '', '@returns the sum'),
      output: doc('@param a - first', '', '@returns the sum'),
      errors: [{ messageId: 'extraBlankDiffType' }],
    },
    {
      name: 'every violation in a comment is fixed in one pass',
      code: doc('@param a - first', '', '@param b - second', '@returns the sum'),
      output: doc('@param a - first', '@param b - second', '', '@returns the sum'),
      errors: [{ messageId: 'noBlankSameType' }, { messageId: 'missingBlankDiffType' }],
    },
  ],
});
