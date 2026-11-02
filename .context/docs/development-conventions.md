---
type: doc
name: development-conventions
description: Normative conventions — quality gate, layer rules, documentation and readability, commits, branches, PRs, language
category: workflow
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Development conventions

What is mandatory when changing this repository. Setup and step-by-step recipes are in
[development-workflow.md](development-workflow.md); this file holds only what must hold without
anything prompting it, written as commands.

## Quality gate

**Before every commit, run the gate, one command at a time** (the integration tests need
`docker compose up -d --wait` first):

```bash
npm run lint                # ESLint, --max-warnings 0
npm run typecheck           # tsc --noEmit, strict
npm run check:architecture  # dependency-cruiser layer rules
npm run check:unused        # knip: unused files, exports, types, dependencies
npm run test:coverage       # unit + tooling + integration, 80% on all four metrics
npm run check:context       # agent surfaces are copies of .context/docs/README.md
```

These are exactly the CI jobs, one job per command, and every one of them is meant to be a required
check on `master`. A green local gate means a green CI.

- Run them **one at a time**. Each of `lint`, `typecheck` and `test:coverage` takes a few hundred MB
  to over a GB; running them in parallel on a small machine is how it runs out of memory.
- The `pre-commit` hook runs ESLint on the staged files only, and `commit-msg` runs commitlint. They
  are a fast first filter, not the gate: a change to a signature can break a file you did not stage.
- A rule is fixed in the code, never silenced. A targeted `eslint-disable-next-line <rule>` is
  allowed only with a comment on the same line saying why the rule does not apply there. No
  file-level or blanket disables.

## Layer rules

Enforced by `npm run check:architecture` (`.dependency-cruiser.cjs`). See
[architecture.md](architecture.md) for the reasoning.

- `src/domain/` imports **nothing** outside `src/domain/`: no other layer, no npm package, no Node
  built-in. A domain rule that needs I/O is not a domain rule.
- `src/application/` imports only `src/domain/`, its own folder and Node built-ins. It talks to the
  database through the interfaces in `ports.ts`.
- `src/http/` and `src/infrastructure/` never import each other. They meet in `src/server.ts`, the
  composition root, which is the only module that reads the environment (through `loadConfig`).
- No import cycles, type-only ones included. No module that nothing imports (entry points excepted).
- Business failures are `LedgerError` subclasses with a stable snake_case `code`. Adding one means
  adding its HTTP status to `STATUS_BY_CODE` in `src/http/app.ts` and its row to the README's error
  table; an unmapped code is a 500.

## Invariants you must not break

- Money is integer minor units, always. Construct it with `Money.of` / `Money.positive`; never
  do arithmetic on raw numbers outside `Money`.
- Every change to a balance appends a ledger entry in the same transaction. The
  `account_discrepancies` view must stay empty; every integration test checks it.
- Every write takes its locks in the order **idempotency key, account, reservation**. A new
  operation that locks in another order can deadlock with the existing ones.
- Every write goes through `LedgerService.idempotent`, so the key, the effect and the stored outcome
  commit together.
- Schema changes are new files in `migrations/` (`NNN_description.sql`); an applied migration is
  never edited.

## Documentation in code (TSDoc)

Enforced by `eslint-plugin-jsdoc` and the local `jsdoc-tag-spacing` rule.

- **Every exported symbol has a doc comment**: classes, functions, methods of exported classes,
  interfaces, type aliases and exported constants. One summary sentence saying what it does for the
  caller; `@remarks` for the why.
- `@param` and `@returns` only when they add something the type does not say. When present, they
  have a description (`@param amount - minor units, positive`).
- `@throws {@link ErrorClass} when ...` for every error a caller must handle. A function with a
  `throw` statement and no `@throws` fails the lint.
- Tag order: `@remarks`, `@typeParam`, `@param`, `@returns`, `@throws`, `@example`, `@see`. No blank
  line between tags of the same kind, exactly one between kinds, one after the summary.
- An implementation of a port method may use `{@inheritDoc Port.method}` instead of repeating it.
- Comments explain **why**, not what. No commented-out code (`sonarjs/no-commented-code`). No
  `TODO` / `FIXME` comments at all (`sonarjs/todo-tag`, `sonarjs/fixme-tag`): deferred work is an
  issue, listed in [tech-debt.md](tech-debt.md) with its number.

## Readability rules

Enforced by ESLint, at error level:

- Cognitive complexity at most **15** per function (`sonarjs/cognitive-complexity`); nesting at most
  **3** (`max-depth`); at most **4** parameters (`@typescript-eslint/max-params`) — beyond that, take
  an input object with a named interface, as `LedgerService` does.
- One statement per line. With more than one item, every parameter, argument, property, array
  element and type-literal member goes on its own line (`local/one-per-line`; the test DSL's
  `(name, callback)` is exempt). A condition with `&&` / `||` puts each clause on its own line, with
  the operator leading (`local/multiline-if-condition`). Control-block bodies are never inline
  (`local/block-multiline`, `curly: all`).
- Blank lines around multi-line blocks and statements, and before `return`, `throw` and control
  statements.
- No magic numbers in `src/`: name them (`HTTP_CREATED`, `DEFAULT_TTL_MINUTES`). Tests are exempt,
  because a literal amount is the readable form of a test case.
- No unused code: variables, imports, function arguments, private class members, dead stores,
  collections never read (`sonarjs`, `@typescript-eslint/no-unused-vars`,
  `@typescript-eslint/no-unused-private-class-members`), and no unused file, export, type or
  dependency across the project (`knip`). Remove it; do not export it "for later".
- No duplicated string literal three times or more in `src/` (`sonarjs/no-duplicate-string`): name it.

## Naming

- Intention-revealing names in the domain vocabulary of [glossary.md](glossary.md): `reserve`,
  `capture`, `release`, `hold`, `available`, `outcome`.
- No abbreviations except those in the glossary (`id`, `tx`, `db`, `ttl`, `http`, `url`, `sql`).
  `id-length` rejects one-letter names, including in callbacks (`(response) =>`, not `(r) =>`).
- Booleans read as predicates: `isDue`, `isBroken`, `isSweeping`, `replayed`.

## Language

Everything is in English: identifiers, comments, log messages, error messages, documentation,
commit messages, PR and issue text.

## Branches, commits and pull requests

- `master` is the default branch and is never pushed to directly. Branch prefixes: `feat/`, `fix/`,
  `docs/`, `refactor/`, `chore/`, `test/`, `ci/`.
- Commits follow **Conventional Commits** (`type(scope): description`), checked by commitlint in the
  `commit-msg` hook and, for every commit of a pull request, in CI.
- **The commit type is the version.** `feat` → minor; `fix`, `perf`, `refactor` → patch; a `!` after
  the type or a `BREAKING CHANGE:` footer → major; `docs`, `test`, `build`, `ci`, `chore`, `style` →
  no release. A `!` is a statement that a client integration breaks, not emphasis.
- Small pull requests, one concern each. The PR template asks for the what and why, the issue, the
  verification **as results** ("137/137 tests, coverage 96/92/97/96"), and the risks.
- Link the issue with an English closing keyword (`Closes #12`, `Fixes #12`); anything else does not
  link, silently.

## Context base

`.context/docs/` is the source. `AGENTS.md`, `.claude/CLAUDE.md` and
`.github/copilot-instructions.md` are copies of `.context/docs/README.md` written by
`npm run export:context`; edit the source and re-export. Never generate the surfaces with the
dotcontext `exportDocs`, `exportContext` or `reverseSync` tools: they write targets this repository
does not control and re-import generated files as sources.
