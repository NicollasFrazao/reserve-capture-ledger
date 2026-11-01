---
type: doc
name: development-workflow
description: Setup, day-to-day commands and step-by-step recipes
category: workflow
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Development workflow

The rules are in [development-conventions.md](development-conventions.md); this file is the how.

## Setup

Requirements: Node.js 22 and Docker.

```bash
npm ci                         # also installs the git hooks (husky, via "prepare")
docker compose up -d --wait    # PostgreSQL 16 on localhost:5432 (user/password/db: ledger)
npm run migrate                # applies migrations/ to the development database
npm start                      # http://localhost:3000, with the expiry sweep every 5 s
```

Configuration comes from the environment, read once by `loadConfig` (`src/infrastructure/config.ts`):
`DATABASE_URL`, `PORT`, `SWEEP_INTERVAL_MS`. Invalid numbers fail at startup.

## Day to day

| Task | Command |
| --- | --- |
| Domain tests only, no database | `npm run test:unit` |
| Integration tests (database up) | `npm run test:integration` |
| Local ESLint rules and scripts | `npm run test:tooling` |
| Everything, with the coverage gate | `npm run test:coverage` |
| One file | `npx vitest run test/unit/money.test.ts` |
| Fix what ESLint can fix | `npx eslint . --fix` |
| Layer rules | `npm run check:architecture` |
| Unused files, exports, dependencies | `npm run check:unused` |
| Regenerate the agent surfaces | `npm run export:context` |

Before committing, the full gate in [development-conventions.md](development-conventions.md#quality-gate).

## Recipe: a new operation

1. Domain first: the rule as a method on `Account` or `Reservation`, throwing a new `LedgerError`
   subclass if it can be refused. Unit-test it in `test/unit/`.
2. Application: an input interface and a method on `LedgerService` that builds a fixed-shape
   request (`operation` plus normalized parameters) and runs its work through `this.idempotent`.
   Lock the account before the reservation.
3. Persistence: a port method in `ports.ts` and its `Pg*Repository` implementation, if needed.
4. HTTP: a route in `src/http/app.ts` with a zod schema and the `Idempotency-Key`; add new error
   codes to `STATUS_BY_CODE`.
5. Integration tests: the happy path, the replay, the conflict, and the race if the operation
   touches money. Every file ends with `expectLedgerConsistent`.
6. README: the endpoint and any new error code.

## Recipe: a schema change

1. A new file `migrations/NNN_description.sql`; never edit an applied one.
2. Add a `CHECK` or trigger for any new invariant, and a test in `invariants.test.ts` that tries
   to break it with raw SQL.
3. If balances or holds are involved, keep `account_discrepancies` meaningful.
4. The integration suite recreates its database each run, so `npm run test:integration` applies it.

## Recipe: a pull request

Branch from `main` with a prefix (`feat/`, `fix/`...), commit in Conventional Commits, run the gate,
open the PR with the template filled in with results, and `Closes #N` in English.
