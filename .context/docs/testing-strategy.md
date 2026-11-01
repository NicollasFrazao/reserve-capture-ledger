---
type: doc
name: testing-strategy
description: Test layers, the integration database, race tests and coverage
category: testing
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Testing strategy

Vitest 4, three projects in `vitest.config.ts`:

| Project | Files | Needs | What it proves |
| --- | --- | --- | --- |
| `unit` | `test/unit/**/*.test.ts` | nothing | Money arithmetic, account holds, the reservation state machine, the request fingerprint, config parsing |
| `tooling` | `eslint-rules/*.test.mjs`, `scripts/*.test.mjs` | nothing | the local ESLint rules (RuleTester) and the context-surface scripts |
| `integration` | `test/integration/**/*.test.ts` | PostgreSQL | the whole stack through `app.inject`, against a real database |

`npm test` runs all three; `npm run test:coverage` adds the V8 coverage gate: **80% on lines,
branches, functions and statements** over `src/` (the composition root `src/server.ts` is
excluded: it only wires tested parts together).

## Integration tests

- `test/integration/global-setup.ts` **drops and recreates** `<database>_test` next to the database
  in `DATABASE_URL`, and migrates it. Every run starts from an empty schema; development data is
  never touched. CI uses a `services: postgres` container.
- Files run **one after another** (`fileParallelism: false`): the expiry sweep is global, and a
  sweep in one file must not expire another file's reservations. Inside a file, requests run
  concurrently wherever that is the point.
- Each test uses **fresh accounts** (`fundedAccount`, `newAccountId`) and fresh keys (`newKey`), so
  tests never share state.
- **Every file ends each test with `expectLedgerConsistent(pool)`**: the `account_discrepancies`
  view is empty and each account's last `balance_after` equals its balance, across the whole
  database.
- Time is a `FakeClock` the test advances; nothing sleeps waiting for an expiry.

## Race tests do not rely on luck

- The parallel replay tests use `slowAccountLocks(50)`: every transaction stays open 50 ms after
  locking the account, so duplicates are certain to arrive while the original is in flight.
- `interceptTransactions` decorates the transaction runner to inject a failure (the "crash
  mid-operation" test) or a delay, without mocks of `pg`.
- Verified by mutation: removing `FOR UPDATE` from the account lock fails the concurrency tests;
  replacing the `ON CONFLICT` claim with a check-then-insert fails the parallel replay tests.

## What each integration file covers

| File | Scenarios |
| --- | --- |
| `lifecycle.test.ts` | credit, reserve, capture, release, error mapping, request validation |
| `idempotency.test.ts` | sequential and parallel replays, 409 on another payload or endpoint, stored rejections, a crash that leaves the key retryable |
| `concurrency.test.ts` | 50 parallel reserves on an account that affords 23; uneven amounts; capture racing release; a mixed workload |
| `expiry.test.ts` | sweep timing, late capture, final states untouched, four sweeps in parallel |
| `invariants.test.ts` | a seeded random workload of every operation; SQL that tries to break each database guard |
| `migrate.test.ts` | the schema built on an empty database; idempotent and concurrent migration runs |

## Writing a new test

Arrange, act, assert, separated by blank lines. Assert on responses and on database state, not on
internals. A test that needs a new kind of fault decorates the runner with `interceptTransactions`
rather than mocking `pg`. Literal amounts are fine in tests (`no-magic-numbers` is off there).
