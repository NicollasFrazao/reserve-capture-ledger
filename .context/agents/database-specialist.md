---
type: agent
name: Database Specialist
description: Schema changes, constraints, triggers, row locks and migrations on PostgreSQL 16
agentType: database-specialist
phases: [P, E, V]
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Database specialist

## The schema in one paragraph

`accounts` (`balance`, `held`, both `bigint`, `CHECK held <= balance`), `reservations` (one-way
status guarded by a trigger, never deleted), `ledger_entries` (append-only by trigger, signed
amounts, `balance_after`, at most one capture per reservation), `idempotency_keys` (key, operation,
fingerprint, `json` outcome), and the `account_discrepancies` view, which must always be empty.
All in `migrations/001_schema.sql`.

## Rules

- A change is a new migration file `migrations/NNN_description.sql`, applied in name order, each in
  its own transaction, under an advisory lock. Never edit an applied file.
- Every new invariant gets a database guard (`CHECK`, `UNIQUE`, trigger) **and** a raw-SQL test in
  `test/integration/invariants.test.ts` that tries to break it.
- `bigint` columns are parsed as numbers by `createPool`'s type parser, which throws outside the safe
  integer range. Do not introduce `numeric` for amounts.
- Locks: `SELECT ... FOR UPDATE` on the account before the reservation, in every write. Isolation
  is `READ COMMITTED`; correctness comes from the locks and constraints, not the level.
- Keep `json` (not `jsonb`) for stored outcomes: replays must be byte for byte.
- `TRUNCATE` on `ledger_entries` is refused by a trigger; the test suite recreates its database
  instead of truncating.

## Verifying a change

`npm run test:integration` recreates `<database>_test` from the migrations, so a broken migration
fails at global setup. `migrate.test.ts` builds the schema on an empty database as well.
