// ESLint flat config. `npm run lint` runs it with --max-warnings 0, so every
// finding fails, and every rule below is set to "error" to say so plainly.
// The reasons behind the choices are in .context/docs/development-conventions.md.
import js from '@eslint/js';
import stylistic from '@stylistic/eslint-plugin';
import jsdoc from 'eslint-plugin-jsdoc';
import sonarjs from 'eslint-plugin-sonarjs';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import blockMultiline from './eslint-rules/block-multiline.mjs';
import jsdocTagSpacing from './eslint-rules/jsdoc-tag-spacing.mjs';
import multilineIfCondition from './eslint-rules/multiline-if-condition.mjs';
import onePerLine from './eslint-rules/one-per-line.mjs';

const MAX_COGNITIVE_COMPLEXITY = 15;
const MAX_NESTING_DEPTH = 3;
const MAX_PARAMETERS = 4;
const MAX_LINE_LENGTH = 120;
const DUPLICATE_STRING_THRESHOLD = 3;

const local = {
  rules: {
    'block-multiline': blockMultiline,
    'jsdoc-tag-spacing': jsdocTagSpacing,
    'multiline-if-condition': multilineIfCondition,
    'one-per-line': onePerLine,
  },
};

/** Sonar rules on top of `recommended` (which already has the unused-code rules at error). */
const sonarRules = {
  ...sonarjs.configs.recommended.rules,
  'sonarjs/cognitive-complexity': ['error', MAX_COGNITIVE_COMPLEXITY],
  // Off in `recommended`, on here: dead code, duplication and needless indirection.
  'sonarjs/no-unused-function-argument': 'error',
  'sonarjs/no-duplicate-string': ['error', { threshold: DUPLICATE_STRING_THRESHOLD }],
  'sonarjs/no-collapsible-if': 'error',
  'sonarjs/prefer-immediate-return': 'error',
  'sonarjs/no-commented-code': 'error',
  'sonarjs/no-inconsistent-returns': 'error',
  'sonarjs/no-variable-usage-before-declaration': 'error',
};

const readabilityRules = {
  'max-depth': ['error', MAX_NESTING_DEPTH],
  '@typescript-eslint/max-params': ['error', { max: MAX_PARAMETERS }],
  curly: ['error', 'all'],
  eqeqeq: ['error', 'always', { null: 'ignore' }],
  'id-length': ['error', { min: 2, properties: 'never', exceptions: ['T'] }],
  '@typescript-eslint/no-unused-vars': 'error',
  '@typescript-eslint/no-unused-expressions': 'error',
  '@typescript-eslint/no-unused-private-class-members': 'error',
  '@typescript-eslint/no-magic-numbers': [
    'error',
    {
      ignore: [-1, 0, 1, 2],
      ignoreEnums: true,
      ignoreNumericLiteralTypes: true,
      ignoreReadonlyClassProperties: true,
      ignoreTypeIndexes: true,
      ignoreDefaultValues: true,
    },
  ],
  '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
  'local/block-multiline': 'error',
  'local/multiline-if-condition': 'error',
  'local/one-per-line': 'error',
};

const layoutRules = {
  '@stylistic/indent': ['error', 2, { SwitchCase: 1, offsetTernaryExpressions: true }],
  '@stylistic/quotes': ['error', 'single', { avoidEscape: true }],
  '@stylistic/semi': ['error', 'always'],
  '@stylistic/member-delimiter-style': [
    'error',
    {
      multiline: { delimiter: 'semi', requireLast: true },
      singleline: { delimiter: 'semi', requireLast: false },
    },
  ],
  '@stylistic/comma-dangle': ['error', 'always-multiline'],
  '@stylistic/max-len': [
    'error',
    {
      code: MAX_LINE_LENGTH,
      ignoreComments: true,
      ignoreUrls: true,
      ignoreStrings: true,
      ignoreTemplateLiterals: true,
      ignoreRegExpLiterals: true,
    },
  ],
  '@stylistic/max-statements-per-line': ['error', { max: 1 }],
  '@stylistic/function-paren-newline': ['error', 'multiline-arguments'],
  '@stylistic/object-curly-spacing': ['error', 'always'],
  '@stylistic/object-curly-newline': ['error', { multiline: true, consistent: true }],
  '@stylistic/padding-line-between-statements': [
    'error',
    { blankLine: 'always', prev: '*', next: ['if', 'return', 'throw', 'for', 'while', 'try'] },
    { blankLine: 'always', prev: ['if', 'for', 'while', 'try'], next: '*' },
    { blankLine: 'always', prev: 'multiline-block-like', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-block-like' },
    { blankLine: 'always', prev: 'multiline-const', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-const' },
    { blankLine: 'always', prev: 'multiline-expression', next: '*' },
    { blankLine: 'always', prev: '*', next: 'multiline-expression' },
  ],
  '@stylistic/lines-between-class-members': ['error', 'always', { exceptAfterSingleLine: false }],
  '@stylistic/padded-blocks': ['error', 'never'],
  '@stylistic/no-multiple-empty-lines': ['error', { max: 1, maxBOF: 0, maxEOF: 0 }],
  '@stylistic/no-trailing-spaces': 'error',
  '@stylistic/eol-last': ['error', 'always'],
};

const documentationRules = {
  ...jsdoc.configs['flat/recommended-typescript-error'].rules,
  // Every exported symbol carries a doc comment (TSDoc). The fixer is off: it
  // inserts an empty block, which satisfies the rule and documents nothing.
  'jsdoc/require-jsdoc': [
    'error',
    {
      publicOnly: true,
      enableFixer: false,
      require: {
        ArrowFunctionExpression: true,
        ClassDeclaration: true,
        FunctionDeclaration: true,
        MethodDefinition: true,
      },
      contexts: [
        'TSInterfaceDeclaration',
        'TSTypeAliasDeclaration',
        'TSEnumDeclaration',
        'ExportNamedDeclaration > VariableDeclaration',
      ],
      checkConstructors: false,
    },
  ],
  // @param / @returns only when they add something the type does not say.
  'jsdoc/require-param': 'off',
  'jsdoc/require-returns': 'off',
  // A function that throws says so with @throws.
  'jsdoc/require-throws': 'error',
  // TSDoc's `@throws {@link X}` and inline links are not JSDoc types.
  'jsdoc/valid-types': 'off',
  'jsdoc/check-tag-names': ['error', { typed: true, definedTags: ['remarks', 'privateRemarks', 'typeParam'] }],
  // One blank line after the summary; the blank lines between tags are the local rule's.
  'jsdoc/tag-lines': ['error', 'any', { startLines: 1 }],
  // Tag order; one group per tag, so the blank lines agree with `local/jsdoc-tag-spacing`.
  'jsdoc/sort-tags': [
    'error',
    {
      linesBetween: 1,
      tagSequence: ['remarks', 'typeParam', 'param', 'returns', 'throws', 'example', 'see'].map((tag) => ({ tags: [tag] })),
    },
  ],
  // TSDoc writes `@throws {@link InsufficientFunds} when ...`, which this rule does not read as a type.
  'jsdoc/require-throws-type': 'off',
  'local/jsdoc-tag-spacing': 'error',
};

export default tseslint.config(
  { ignores: ['node_modules/', 'coverage/', '.context/'] },

  {
    files: ['**/*.ts'],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked, ...tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    settings: { jsdoc: { mode: 'typescript' } },
    plugins: { '@stylistic': stylistic, jsdoc, sonarjs, local },
    rules: {
      ...sonarRules,
      ...readabilityRules,
      ...layoutRules,
      ...documentationRules,
    },
  },

  {
    // Tests: amounts written as literals are the readable form of a test case,
    // and repeated literal URLs and messages are the assertions themselves.
    files: ['test/**/*.ts'],
    rules: {
      '@typescript-eslint/no-magic-numbers': 'off',
      'sonarjs/no-duplicate-string': 'off',
    },
  },

  {
    // Plain JavaScript tooling: the local rules, their tests, the scripts and this file.
    files: ['**/*.{js,mjs}'],
    extends: [js.configs.recommended],
    languageOptions: { globals: { ...globals.nodeBuiltin } },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
      'no-eval': 'error',
    },
  },

  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { ...globals.node } },
  },
);
