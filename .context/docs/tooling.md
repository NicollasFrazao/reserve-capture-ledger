---
type: doc
name: tooling
description: Every npm script, hook and CI job, and what each one catches
category: tooling
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Tooling

## npm scripts

| Script | What it runs | Catches |
| --- | --- | --- |
| `lint` | `eslint . --max-warnings 0` | type-aware errors, sonarjs bugs and smells, unused code, complexity, missing TSDoc, layout |
| `typecheck` | `tsc --noEmit` | type errors, strict mode, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes` |
| `check:architecture` | `depcruise src test` | layer violations, cycles, orphans, unresolvable imports |
| `check:unused` | `knip` | unused files, exports, types and dependencies |
| `test` / `test:coverage` | Vitest, all projects (with the 80% gate) | behaviour |
| `test:unit`, `test:integration`, `test:tooling` | one Vitest project | — |
| `check:context` / `export:context` | `scripts/check-context-surfaces.mjs` | agent surfaces drifting from `.context/docs/README.md` |
| `migrate`, `start` | `tsx` on the migration runner / the server | — |

## ESLint (`eslint.config.js`)

- `typescript-eslint` `strictTypeChecked` and `stylisticTypeChecked`.
- `eslint-plugin-sonarjs` `recommended` (230 rules at error), plus rules it leaves off:
  `cognitive-complexity` (15), `no-unused-function-argument`, `no-duplicate-string` (threshold 3),
  `no-collapsible-if`, `prefer-immediate-return`, `no-commented-code`, `no-inconsistent-returns`,
  `no-variable-usage-before-declaration`. Unused and dead code from `recommended`: `no-unused-vars`,
  `unused-import`, `no-dead-store`, `no-redundant-jump`, `no-identical-functions`,
  `no-unused-collection`, `no-redundant-assignments`, `no-small-switch`, `no-useless-catch`,
  `no-ignored-return`, `no-all-duplicated-branches`, `todo-tag`, `fixme-tag`.
- `eslint-plugin-jsdoc` (`recommended-typescript-error`, `require-jsdoc` on exports, `require-throws`,
  tag order, one blank line after the summary).
- `@stylistic`: indentation, quotes, semicolons, trailing commas, line length 120, one statement
  per line, blank lines around multi-line blocks.
- Local rules in `eslint-rules/`, each with RuleTester tests: `one-per-line`,
  `multiline-if-condition`, `block-multiline`, `jsdoc-tag-spacing`.
- Core: `max-depth` 3, `@typescript-eslint/max-params` 4, `id-length` 2, `curly`, `eqeqeq`,
  `@typescript-eslint/no-magic-numbers` (off in tests).

## Git hooks (husky)

- `pre-commit`: `lint-staged`, which runs `eslint --max-warnings 0` on staged `.ts`, `.js`,
  `.mjs` and `.cjs` files, and `npm run check:context` when a context file or surface is staged.
- `commit-msg`: `commitlint` with `@commitlint/config-conventional`.

## CI (`.github/workflows/ci.yml`)

One job per check: `lint`, `typecheck`, `architecture`, `unused`, `test` (with coverage, against a
`postgres:16-alpine` service), `audit` (`npm audit --omit=dev --audit-level=high`), `context`, and
`commitlint` (pull requests only, every commit of the PR). CodeQL runs in its own workflow
(`codeql.yml`), and Dependabot opens weekly updates for npm and GitHub Actions.
