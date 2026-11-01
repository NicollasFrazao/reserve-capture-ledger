# 0002. Claim the idempotency key in the operation's own transaction

- Status: accepted
- Date: 2026-11-01

## Context

Clients retry on timeouts, and duplicates can arrive at the same moment. A retried capture must not
charge twice, and its response must be the original one.

## Options

1. **Check, then insert**: look the key up; if absent, run the operation and store the key.
2. **Claim in a separate transaction** with an "in progress" state, run the operation, then
   complete the key; duplicates that find "in progress" get a 409.
3. **Claim in the operation's transaction**: `INSERT ... ON CONFLICT DO NOTHING`, run the operation,
   store the outcome, commit all of it together.

## Decision

Option 3.

- Option 1 races: two requests both see "absent". The parallel replay tests fail with it.
- Option 2 needs a recovery path for keys stuck "in progress" after a crash, and pushes a retry
  loop onto clients.
- With option 3, a duplicate's insert waits on the unique index until the original commits, then
  replays the outcome. A crash rolls back the key with the effect, so the client can simply retry.

## Consequences

- A duplicate waits for the original instead of failing fast. Fine for millisecond transactions;
  long-running operations would want option 2.
- Business rejections are stored and replayed too (same key, same answer); a savepoint discards
  their partial writes. Unexpected errors store nothing.
- Keys are kept forever; purging them by age is listed in [tech-debt.md](../tech-debt.md).
