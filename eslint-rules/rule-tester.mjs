/**
 * ESLint's RuleTester wired to Vitest, so the rule tests run in the same
 * runner as the rest of the suite.
 */
import { RuleTester } from 'eslint';
import tseslint from 'typescript-eslint';
import { afterAll, describe, it } from 'vitest';

RuleTester.describe = describe;
RuleTester.it = it;
RuleTester.itOnly = it.only;
RuleTester.afterAll = afterAll;

/** A RuleTester that parses TypeScript. */
export const ruleTester = new RuleTester({
  languageOptions: { parser: tseslint.parser, ecmaVersion: 2023, sourceType: 'module' },
});
