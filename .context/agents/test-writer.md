---
type: agent
name: Test Writer
description: Unit and integration tests for the ledger, including race tests and fault injection
agentType: test-writer
phases: [E, V]
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Test writer

Read [testing-strategy.md](../docs/testing-strategy.md) first; it explains the three Vitest
projects and the integration database.

## Unit tests (`test/unit/`)

Domain only, no database, no mocks: construct `Money`, `Account`, `Reservation` and assert on
their views and the errors they throw. Use a fixed `t0` and an `at(seconds)` helper for time.

## Integration tests (`test/integration/`)

- `const ctx = createTestContext();` per file; `afterEach(() => expectLedgerConsistent(ctx.pool))`;
  `afterAll(() => ctx.close())`.
- Fresh state per test: `fundedAccount(ctx.app, amount)`, `newAccountId()`, `newKey()`.
- Go through HTTP with `post(app, url, body, key)`; assert on `status`, `body`, `raw` (byte
  comparison for replays) and `replayed`.
- Move time with `ctx.clock.advanceSeconds(n)`, then `ctx.service.expireDue()`. Never sleep.
- Races: fire with `Promise.all`; to guarantee overlap, use a second context built with
  `slowAccountLocks(50)`.
- Faults: `interceptTransactions((tx) => ({ ledger: { append: ... } }))` to fail or delay one step.
- Count rows with `countRows(pool, sql, params)` to prove "one effect".

## Done means

The test fails when the behaviour it covers is removed (try it), the gate is green, and coverage
stays at or above 80% on all four metrics.
