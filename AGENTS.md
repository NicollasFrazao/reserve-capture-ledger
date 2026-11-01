# reserve-capture-ledger: context index

The knowledge base of this repository, for people and for coding agents. Start with the project
overview, then open the guide the task needs.

## Mandatory for anyone editing this repository

**Before editing any file, read [`development-conventions.md`](/.context/docs/development-conventions.md).**
It is the normative file: the quality gate to run before every commit, the layer rules, the
documentation and readability rules the lint enforces, commits and branches, and the language
everything is written in. Its rules are commands, not background reading.

Two more readings, each with the moment it applies:

- **before changing the schema, a lock or the idempotency flow** —
  [`architecture.md`](/.context/docs/architecture.md), sections "Invariants" and "Concurrency";
- **before writing a test that touches the database** —
  [`testing-strategy.md`](/.context/docs/testing-strategy.md), section "Integration tests".

> **This file is the source of the agent surfaces.** `AGENTS.md`, `.claude/CLAUDE.md` and
> `.github/copilot-instructions.md` are byte-for-byte copies of `.context/docs/README.md`, written by
> `npm run export:context` and verified by `npm run check:context` (a CI job). Edit this file, never
> a copy. The rules themselves are not copied into the surfaces: they live in
> `development-conventions.md`, one hop away, so there is a single place to change them.

## Guides

| Guide | What it answers |
| --- | --- |
| [Project overview](/.context/docs/project-overview.md) | What the service does, for whom, and what it deliberately does not do |
| [Architecture](/.context/docs/architecture.md) | Layers and their import rules, invariants, concurrency, idempotency |
| [Development conventions](/.context/docs/development-conventions.md) | **Normative.** Quality gate, code rules, commits, branches, PRs, language |
| [Development workflow](/.context/docs/development-workflow.md) | Setup, day-to-day commands, recipes (new operation, new migration) |
| [Testing strategy](/.context/docs/testing-strategy.md) | Test layers, the integration database, race tests, coverage |
| [Data flow](/.context/docs/data-flow.md) | A request from HTTP to the ledger and back; the expiry sweep |
| [Glossary](/.context/docs/glossary.md) | Domain vocabulary and the only abbreviations allowed in names |
| [Security](/.context/docs/security.md) | Threat model, what is out of scope, how to report a vulnerability |
| [Tooling](/.context/docs/tooling.md) | Every npm script, hook and CI job, and what each one catches |
| [Technical debt](/.context/docs/tech-debt.md) | Known gaps, with the reason they are still open |
| [Decision records](/.context/docs/adr/README.md) | Why the row lock, why idempotency in the same transaction, why numbers |

## Agents and skills

Playbooks tailored to this repository, for agents that support them:

- [`agents/code-reviewer.md`](/.context/agents/code-reviewer.md), [`agents/database-specialist.md`](/.context/agents/database-specialist.md), [`agents/test-writer.md`](/.context/agents/test-writer.md)
- [`skills/code-review`](/.context/skills/code-review/SKILL.md), [`skills/commit-message`](/.context/skills/commit-message/SKILL.md), [`skills/test-generation`](/.context/skills/test-generation/SKILL.md)

## Repository map

- `src/domain/` — entities and value objects (`Money`, `Account`, `Reservation`), errors; no imports
- `src/application/` — `LedgerService` (use cases and idempotency), ports, clock
- `src/infrastructure/` — `pg` pool and transactions, repositories, migration runner, config
- `src/http/` — Fastify routes, zod validation, error mapping
- `src/server.ts` — composition root and the expiry sweep
- `migrations/` — the SQL schema, with the database-side guards
- `test/unit/`, `test/integration/` — Vitest; integration runs against a real PostgreSQL
- `eslint-rules/` — local readability rules, with RuleTester tests
- `scripts/` — `check-context-surfaces.mjs` (export and check of the agent surfaces)
- `.github/` — CI, CodeQL, Dependabot, PR and issue templates, CODEOWNERS
