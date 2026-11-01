---
type: doc
name: glossary
description: Domain vocabulary and the only abbreviations allowed in names
category: glossary
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Glossary

Use these words in code, tests, logs and docs, with these meanings.

| Term | Meaning |
| --- | --- |
| **account** | Owner of a balance of credits. Opened by its first credit; its id is chosen by the client. |
| **credit** | A top-up: adds to the balance and appends a positive ledger entry. Also the unit of value. |
| **minor units** | Integer subdivisions of a credit. Every amount in the system is in minor units. |
| **balance** | Everything the account owns, held or not. Always equals the sum of its ledger entries. |
| **hold** | Part of the balance set aside for one reservation. `held` is the sum of active holds. |
| **available** | `balance - held`: what a new reservation can still hold. |
| **reservation** | A hold with a lifetime, waiting to be captured, released or to expire. |
| **reserve** | Place a reservation. Refused with `insufficient_funds` when `available` does not cover it. |
| **capture** | Charge part or all of a reservation; the rest of the hold is released in the same step. |
| **release** | Cancel a reservation; nothing is charged. |
| **expire** | What the sweep does to a reservation past `expiresAt`; same effect as a release. |
| **final state** | `captured`, `released` or `expired`. Terminal: nothing leaves a final state. |
| **sweep** | The periodic job that expires due reservations. |
| **due** | A reservation still `reserved` whose `expiresAt` has passed. |
| **ledger entry** | One balance movement: `credit` (positive) or `capture` (negative), with `balance_after`. |
| **idempotency key** | The client-chosen `Idempotency-Key` header that makes a retried write safe. |
| **fingerprint** | SHA-256 of the operation and its normalized parameters; tells a replay from a conflict. |
| **outcome** | The stored result of a keyed write: a value, or a `LedgerError` body. Replayed as is. |
| **replay** | Answering a repeated key with its stored outcome, without running the operation. |
| **invariant** | A fact that must hold after every transaction, e.g. `held <= balance`. |

## Abbreviations allowed in names

`id`, `db` (the transaction runner), `tx` (a transaction), `ttl` (time to live, in seconds), `http`,
`url`, `sql`, `uuid`, `json`, `ctx` (the per-file test context). Anything else is spelled out.
