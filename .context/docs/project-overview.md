---
type: doc
name: project-overview
description: What the service does, for whom, and what it deliberately leaves out
category: overview
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Project overview

`reserve-capture-ledger` is a small HTTP service that bills per request with prepaid credits. A
client **reserves** the most a unit of work can cost, does the work, then **captures** what it
actually cost; the rest of the hold returns to the account. Abandoned work is **released**, and a
hold nobody resolves **expires**. Every balance change is a row in an append-only ledger.

It is a portfolio project: small on purpose, with the weight on correctness under retries and
concurrency rather than on features.

## Failure modes it exists to prevent

| Failure | Prevented by |
| --- | --- |
| Double charge when a client retries | `Idempotency-Key`, stored outcome, replay |
| Double charge when duplicates arrive together | key claimed under a unique constraint in the operation's transaction |
| Overdraft under parallel reserves | account row lock + `CHECK (held <= balance)` |
| Credits locked forever by a crashed client | reservation expiry and the sweep |
| Capture and release both "winning" | one-way state machine, in the domain and in a trigger |
| Balance drifting from its history | append-only ledger, invariant view checked by every integration test |

## Stack

Node.js 22, TypeScript 5.9 (strict), Fastify 5, zod 4, `pg` 8 (no ORM), PostgreSQL 16, Vitest 4.

## Interfaces

HTTP only: `POST /accounts/{id}/credits`, `GET /accounts/{id}`, `POST /reservations`,
`POST /reservations/{id}/capture`, `POST /reservations/{id}/release`. The contract, with examples
and the error table, is in the repository `README.md`.

## Out of scope

Authentication and per-client key scoping, purging old idempotency keys, multiple currencies,
double-entry bookkeeping, listing endpoints, packaging (the service runs from source with `tsx`).
These are recorded in [tech-debt.md](tech-debt.md) so they are decisions, not accidents.
