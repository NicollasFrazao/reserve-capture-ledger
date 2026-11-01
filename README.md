# reserve-capture-ledger

[![CI](https://github.com/NicollasFrazao/reserve-capture-ledger/actions/workflows/ci.yml/badge.svg)](https://github.com/NicollasFrazao/reserve-capture-ledger/actions/workflows/ci.yml)

Idempotent per-request billing on **PostgreSQL**, in TypeScript.

A client that pays per request first **reserves** the most a request can cost, does the work, then **captures** what it actually cost; the rest of the hold goes back to the account. If the work is abandoned, the client **releases** the hold, and a hold nobody resolves **expires**. Every change to a balance is a row in an append-only ledger.

The interesting part is not the arithmetic. It is keeping that arithmetic right when clients retry, when requests race each other, and when a process dies halfway.

## What it prevents

| Failure mode | How it happens | What stops it here |
|---|---|---|
| Double charge on retries | A timeout makes the client resend a capture that had already succeeded | `Idempotency-Key`: the second request gets the stored response and changes nothing |
| Double charge on simultaneous retries | Two copies of the same request arrive at the same moment, both see "key not used yet" | The key is claimed with an `INSERT` under a unique constraint, inside the operation's transaction; the second copy waits for the first, then replays its response |
| Overdraft under concurrency | Fifty reserves read the same available balance before any of them writes | The account row is locked (`SELECT … FOR UPDATE`) for the read-check-write; a `CHECK (held <= balance)` makes an overdraft impossible to commit anyway |
| Lost holds | A client reserves and crashes; the credits stay locked forever | Every reservation has an expiry; a sweep releases expired holds, and a late capture is refused |
| Double settlement | A capture and a release race on the same reservation | Reservations move `reserved → captured \| released \| expired` exactly once, enforced by the domain and by a database trigger |
| Books that drift | A bug updates a balance without recording why | The balance is checked against the sum of ledger entries after every test scenario; ledger rows cannot be updated or deleted |

## How it works

```mermaid
flowchart LR
    C[Client] -- "POST + Idempotency-Key" --> H[HTTP adapter<br/>Fastify + zod]
    H --> S[LedgerService<br/>application]
    S --> D[Domain<br/>Account, Reservation, Money]
    S -- "one transaction per request" --> R[Repositories<br/>pg]
    R --> P[(PostgreSQL 16)]
    W[Expiry sweep<br/>setInterval] --> S
```

Every write follows the same path, in one database transaction:

```mermaid
sequenceDiagram
    participant S as LedgerService
    participant DB as PostgreSQL
    S->>DB: BEGIN
    S->>DB: INSERT idempotency_keys ON CONFLICT DO NOTHING
    alt key already existed
        S->>DB: SELECT fingerprint, outcome
        Note over S: same fingerprint: replay the stored outcome<br/>different fingerprint: 409
    else key claimed
        S->>DB: SAVEPOINT
        S->>DB: SELECT … FROM accounts FOR UPDATE
        Note over S: domain decides (hold, capture, release)
        S->>DB: UPDATE accounts / reservations, INSERT ledger_entries
        S->>DB: UPDATE idempotency_keys SET outcome
    end
    S->>DB: COMMIT
```

The key, the effect and the stored response commit together or not at all. There is no state in which the effect happened and the key does not know about it, or the reverse.

## Data model

```mermaid
erDiagram
    accounts ||--o{ reservations : holds
    accounts ||--o{ ledger_entries : records
    reservations ||--o| ledger_entries : "captured as"
    accounts {
        text id PK
        bigint balance "CHECK >= 0"
        bigint held "CHECK held <= balance"
    }
    reservations {
        uuid id PK
        text account_id FK
        bigint amount "CHECK > 0"
        text status "reserved | captured | released | expired"
        bigint captured_amount "set iff captured, <= amount"
        timestamptz expires_at
        timestamptz finalized_at
    }
    ledger_entries {
        bigint id PK
        text account_id FK
        text kind "credit | capture"
        bigint amount "signed: + credit, - capture"
        bigint balance_after
        uuid reservation_id "UNIQUE, set iff capture"
    }
    idempotency_keys {
        text key PK
        text operation
        text fingerprint "sha256 of operation + parameters"
        json outcome
    }
```

- Amounts are integers of minor units everywhere: `bigint` in the database, safe integers in TypeScript. A fraction is rejected, never rounded.
- `available = balance - held`. `held` is a running total of active reservations, kept on the account row so a reserve needs one locked row, not an aggregate.
- Two facts are stored twice on purpose and checked against each other: `balance` against `sum(ledger_entries.amount)`, and `held` against the active reservations. The `account_discrepancies` view lists any account where they disagree; the tests require it to be empty.
- The database enforces the rules a bug in the application could break: non-negative balances, `held <= balance`, one capture per reservation, signs that match the entry kind, terminal reservation states, and an append-only ledger (triggers reject `UPDATE`, `DELETE` and `TRUNCATE`).

The schema is a single file: [`migrations/001_schema.sql`](migrations/001_schema.sql).

## API

Every `POST` requires an `Idempotency-Key` header (1 to 255 visible ASCII characters). A response that comes from a stored outcome carries `Idempotent-Replayed: true`. Amounts are integers of minor units.

### `POST /accounts/{id}/credits`

Top-up. Opens the account on its first credit. `id`: letters, digits, `_` or `-`, up to 64.

```http
POST /accounts/acct-42/credits
Idempotency-Key: 7d1f0c2e-topup-0001
Content-Type: application/json

{"amount": 10000}
```

`201 Created`

```json
{
  "account": {"id": "acct-42", "balance": 10000, "held": 0, "available": 10000},
  "entry": {"id": 1, "accountId": "acct-42", "kind": "credit", "amount": 10000,
            "balanceAfter": 10000, "reservationId": null, "createdAt": "2026-11-01T22:41:27.536Z"}
}
```

### `POST /reservations`

Holds `amount` of the available balance. `ttlSeconds` is optional (default 900, maximum 86400).

```json
{"accountId": "acct-42", "amount": 2500, "ttlSeconds": 300}
```

`201 Created`

```json
{
  "reservation": {"id": "ccaeadfb-8339-4644-ad09-5269cc2ff6a0", "accountId": "acct-42", "amount": 2500,
                  "status": "reserved", "capturedAmount": null, "releasedAmount": null,
                  "expiresAt": "2026-11-01T22:46:27.558Z", "createdAt": "2026-11-01T22:41:27.558Z",
                  "finalizedAt": null},
  "account": {"id": "acct-42", "balance": 10000, "held": 2500, "available": 7500}
}
```

### `POST /reservations/{id}/capture`

Debits `amount` (at most the reserved amount) and releases the rest. Returns `200` with the final `reservation` (`capturedAmount`, `releasedAmount`), the `account` and the ledger `entry`.

```json
{"amount": 1800}
```

### `POST /reservations/{id}/release`

Cancels the hold; nothing is debited. No body (or `{}`). Returns `200` with the `reservation` and the `account`. Allowed until the reservation is final, including after its expiry time if the sweep has not reached it yet.

### `GET /accounts/{id}`

```json
{"id": "acct-42", "balance": 8200, "held": 0, "available": 8200}
```

### Errors

Every error has the same shape:

```json
{"error": {"code": "insufficient_funds", "message": "account acct-42 has 30 available, 31 requested",
           "details": {"accountId": "acct-42", "requested": 31, "available": 30}}}
```

| Status | `code` | When |
|---|---|---|
| 400 | `bad_request` | Missing or malformed `Idempotency-Key`, invalid body or path, malformed JSON |
| 400 | `invalid_amount`, `invalid_ttl` | Amount or TTL out of range |
| 404 | `account_not_found`, `reservation_not_found` | Unknown id |
| 409 | `idempotency_key_conflict` | The key was already used for a different request (other payload or other endpoint) |
| 409 | `invalid_transition` | The reservation is already captured, released or expired |
| 409 | `reservation_expired` | Capture after the expiry time |
| 422 | `insufficient_funds` | The available balance does not cover the reservation |
| 422 | `capture_exceeds_reservation` | Capture larger than the reserved amount |
| 500 | `internal_error` | Anything unexpected; nothing was stored, so the same key can be retried |

## Design decisions and trade-offs

**Row lock, not a conditional update.** The alternative to `SELECT … FOR UPDATE` is a single statement such as `UPDATE accounts SET held = held + $1 WHERE id = $2 AND balance - held >= $1`, which holds the row lock for less time. I chose the explicit lock because an operation here writes several rows (account, reservation, ledger entry, idempotency outcome) that must agree, and because it keeps the rule in the domain model: the code reads the account, `Account.hold()` decides, and the error says how much was available. With the conditional update the rule moves into SQL, and a zero-row result does not tell "insufficient funds" from "no such account" without a second query. The cost is that writes to one account are serialized. For very hot accounts, the usual next steps are a conditional update, or splitting the balance into sub-accounts.

**Lock order.** Every write takes its locks in the same order: idempotency key, then account, then reservation. A capture first reads the reservation without a lock to learn its account, locks the account, then locks and re-reads the reservation. One fixed order is what keeps parallel captures, releases and sweeps free of deadlocks.

**Idempotency inside the operation's transaction.** The key is claimed with `INSERT … ON CONFLICT DO NOTHING`, not with "select, then insert if missing" (two requests can both see "missing"). When a second request with the same key arrives while the first is still running, PostgreSQL makes its insert wait on the unique index until the first commits; it then reads and replays the stored outcome. The trade-off: a duplicate waits for the original instead of getting an immediate "in progress" error. Transactions here last milliseconds, so waiting is simpler for clients. Long-running operations would want the other design.

**Business rejections are stored too.** If a reserve fails with `insufficient_funds`, retrying it with the same key returns the same `422`, even after a top-up. Same key, same request, same answer; a new attempt takes a new key. A savepoint makes sure a rejected operation leaves no partial writes behind while its outcome is still recorded. Unexpected errors (a lost connection, a bug) roll back the whole transaction, key included, so the client can retry safely.

**The fingerprint covers the operation.** It is a SHA-256 of the operation name and its normalized parameters, so the same key sent to another endpoint is a conflict, not a replay.

**`json`, not `jsonb`, for stored outcomes.** `jsonb` reorders object keys. `json` keeps the text as written, so a replayed response is byte for byte the original.

**`READ COMMITTED` and locks, not `SERIALIZABLE`.** Serializable isolation would also prevent the overdraft, but it reports conflicts as serialization failures that every caller must retry. Explicit row locks make the contention point visible in the code and need no retry loop.

**Expiry in two places.** A sweep frees expired holds in small transactions; it is safe to run in every replica, because the row locks decide who expires a reservation and the loser sees it is no longer due. A capture also checks the expiry itself, so a late capture is refused even if the sweep is behind. A release after expiry is allowed: the client gives up the hold either way.

**The database as a backstop.** The domain enforces every rule, and the schema enforces the important ones again with `CHECK` constraints and triggers. The tests exercise both: the domain in unit tests, the triggers by writing SQL that tries to break them.

## Tests

```
test/unit/          domain: Money, Account, Reservation state machine, request fingerprint
test/integration/   real PostgreSQL, through the HTTP adapter
  lifecycle         credit, reserve, capture, release; error mapping and validation
  idempotency       replays (sequential and parallel), 409 on a different payload or endpoint,
                    stored rejections, and a crash mid-operation that leaves the key retryable
  concurrency       50 parallel reserves on an account that affords 23: exactly 23 succeed;
                    a capture racing a release: exactly one wins
  expiry            sweep timing, late capture, final states untouched, four sweeps in parallel
  invariants        a seeded random workload of every operation, plus the database guards
```

Every integration test ends by checking the ledger invariant on the whole database: no row in `account_discrepancies`, and each account's last `balance_after` equals its balance.

The race tests do not rely on luck. The parallel replay tests slow down the account lock by 50 ms, so the duplicates are certain to arrive while the original is in flight. Removing `FOR UPDATE` from the account lock makes the concurrency tests fail, and replacing the `ON CONFLICT` claim with a check-then-insert makes the parallel replay tests fail.

The integration suite drops and recreates a separate `<database>_test` database at the start of each run, so it never touches development data.

## Project layout

```
src/
  domain/            Money, Account, Reservation (state machine), errors: no I/O
  application/       LedgerService (use cases + idempotency), ports, clock
  infrastructure/    pg pool and transactions, repositories, migration runner
  http/app.ts        Fastify routes, zod validation, error mapping
  server.ts          entry point: HTTP server and the expiry sweep
migrations/          SQL schema
test/                Vitest: unit and integration projects
```

The application layer depends on repository interfaces (`ports.ts`), not on `pg`; the infrastructure layer implements them. The domain has no dependencies at all.

## Running it

Requirements: Node.js 22 and Docker.

```bash
docker compose up -d --wait   # PostgreSQL 16 on localhost:5432
npm ci
npm run lint
npm run typecheck
npm test                      # unit + integration (needs the database)
npm run test:unit             # domain only, no database
```

To run the API:

```bash
npm run migrate
npm start                     # http://localhost:3000
```

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | `postgres://ledger:ledger@localhost:5432/ledger` | Database; the tests use the same server with a `_test` suffix on the name |
| `PORT` | `3000` | HTTP port |
| `SWEEP_INTERVAL_MS` | `5000` | How often the expiry sweep runs |

## Out of scope

- Authentication and per-client scoping of idempotency keys (keys are global here)
- Purging old idempotency keys (a scheduled `DELETE` by `created_at`)
- Multiple currencies; every amount is in one unit of credit
- Double-entry bookkeeping; the ledger records one side of each movement
- Listing endpoints (ledger history, reservations by account) and pagination
- A build step and container image for the API; it runs from source with `tsx`

## License

[MIT](LICENSE) © Nícollas Frazão
