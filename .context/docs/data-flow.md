---
type: doc
name: data-flow
description: A request from HTTP to the ledger and back, and the expiry sweep
category: data-flow
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Data flow

## A write (credit, reserve, capture, release)

```
HTTP request
  -> src/http/app.ts        Idempotency-Key header and body validated (zod); 400 on failure, nothing stored
  -> LedgerService.<op>     input normalized: Money.positive(amount), ttl checked; invalid input throws, nothing stored
  -> idempotent()           BEGIN
                            INSERT idempotency_keys ... ON CONFLICT DO NOTHING
                              conflict: SELECT the stored record
                                same fingerprint      -> replay the stored outcome (Idempotent-Replayed: true)
                                different fingerprint -> 409 idempotency_key_conflict
                              claimed:
                                SAVEPOINT
                                SELECT ... FROM accounts FOR UPDATE      (then the reservation, FOR UPDATE)
                                domain decides; LedgerError -> ROLLBACK TO SAVEPOINT, outcome = the error
                                UPDATE accounts / reservations, INSERT ledger_entries
                                UPDATE idempotency_keys SET outcome
                            COMMIT
  -> reply()                outcome -> status code + body; the same outcome always gives the same response
```

Any error that is not a `LedgerError` (a lost connection, a bug) rolls back everything, key
included, and becomes a `500 internal_error`; the client can retry with the same key.

## A read

`GET /accounts/{id}` reads the account row without a lock and returns `balance`, `held` and
`available`. It is not idempotency-keyed: reads have no effect to protect.

## The expiry sweep

`src/server.ts` calls `LedgerService.expireDue()` every `SWEEP_INTERVAL_MS` (default 5 s), never
two at once in one process:

1. one transaction lists up to 100 reservations with `status = 'reserved' AND expires_at <= now`;
2. for each, a transaction locks the account, then the reservation, re-checks that it is still due,
   marks it `expired` and lowers the account's `held`.

No ledger entry is written: a hold never changed the balance.

## Tables touched per operation

| Operation | accounts | reservations | ledger_entries | idempotency_keys |
| --- | --- | --- | --- | --- |
| credit | upsert, `balance +=` | — | `credit`, positive | claim + outcome |
| reserve | `held +=` | insert `reserved` | — | claim + outcome |
| capture | `held -=` reserved, `balance -=` captured | `captured` | `capture`, negative | claim + outcome |
| release | `held -=` reserved | `released` | — | claim + outcome |
| sweep | `held -=` reserved | `expired` | — | — |

## External integrations

None. PostgreSQL is the only dependency.
