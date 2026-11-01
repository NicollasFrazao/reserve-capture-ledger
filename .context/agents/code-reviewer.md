---
type: agent
name: Code Reviewer
description: Review a diff against the ledger invariants, the lock order, the idempotency flow and the quality gate
agentType: code-reviewer
phases: [R, V]
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Code reviewer

## Before approving

- The gate is green: `lint`, `typecheck`, `check:architecture`, `check:unused`, `test:coverage`,
  `check:context`. The PR's Verification section states results ("137/137 tests"), not "tested".
- No new `eslint-disable` without a same-line reason; no new `TODO`.

## Where bugs hide in this code

1. **Money outside `Money`.** Arithmetic on raw `number` amounts, floats, or a missing
   `Money.positive` on a new input.
2. **A write outside `idempotent()`.** Any new route that changes state must claim a key in the same
   transaction; otherwise a retry repeats the effect.
3. **Lock order.** Key, then account (`lock`), then reservation (`lock`). A new operation that locks
   a reservation before its account can deadlock against capture and the sweep.
4. **A balance change without a ledger entry**, or a `held` change without the matching
   reservation status. `account_discrepancies` catches it only if a test exercises the path.
5. **A new `LedgerError` code not in `STATUS_BY_CODE`**: it answers 500 instead of its status.
6. **Check-then-act.** Reading a row, deciding, then writing without a lock or a constraint.
7. **Domain importing anything** (dependency-cruiser fails), or the application importing `pg`.
8. **An edited migration.** Applied migrations are immutable; a change is a new file.

## Tests to ask for

A change to money or state: the happy path, the replay, the conflict, and a race test using
`slowAccountLocks` or a parallel `Promise.all`. A new guard in SQL: a raw-SQL test that tries to
break it (`invariants.test.ts`).
