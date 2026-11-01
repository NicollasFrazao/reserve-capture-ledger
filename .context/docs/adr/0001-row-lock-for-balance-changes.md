# 0001. Serialize balance changes with a row lock on the account

- Status: accepted
- Date: 2026-11-01

## Context

Parallel reserves on one account must never hold more than its balance. Each write touches several
rows that must agree: the account (`balance`, `held`), the reservation, possibly a ledger entry, and
the idempotency record.

## Options

1. **`SELECT ... FOR UPDATE` on the account row**, decide in the domain, write all rows.
2. **Conditional update**: `UPDATE accounts SET held = held + $1 WHERE id = $2 AND balance - held >= $1`,
   then insert the reservation if a row was updated.
3. **`SERIALIZABLE` isolation** with retries on serialization failures.

## Decision

Option 1.

- The rule stays in the domain (`Account.hold`), which unit tests cover without a database, and the
  error carries how much was available.
- With option 2, a zero-row update does not tell "insufficient funds" from "no such account"
  without a second query, and the rule lives in SQL.
- Option 3 makes every caller handle serialization failures with a retry loop and hides the
  contention point.

## Consequences

- Writes to one account are serialized; the lock is held for the length of a short transaction.
  A very hot account would be the first bottleneck. Next steps then: option 2, or split the balance
  into sub-accounts.
- Every write must take locks in the same order (key, account, reservation) to stay deadlock-free.
- The `CHECK (held <= balance)` constraint remains as a backstop: a bug that skipped the lock would
  fail to commit instead of overdrawing. Removing `FOR UPDATE` makes the concurrency tests fail.
