---
type: doc
name: security
description: Threat model, what is out of scope, and how to report a vulnerability
category: security
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Security

## Threat model, in scope

| Threat | Mitigation |
| --- | --- |
| A retried or replayed request charges twice | Idempotency keys with stored outcomes; a key reused with another payload is a 409 |
| Concurrent requests overdraw an account | Row lock on the account; `CHECK (held <= balance)` |
| A bug or a manual query rewrites history | Ledger triggers refuse `UPDATE`, `DELETE`, `TRUNCATE`; reservations cannot leave a final state |
| SQL injection | Every query is parameterized (`$1`); `sonarjs/sql-queries` flags SQL built from strings |
| Malformed input reaching the domain | zod at the HTTP boundary (`.strict()` rejects unknown fields), `Money` at the domain boundary |
| Internal details leaking in errors | Unexpected errors answer a generic `internal_error`; details go to the server log only |
| Vulnerable dependencies | `npm audit --omit=dev --audit-level=high` as a CI job; Dependabot for npm and Actions; CodeQL |
| Secrets in code | `sonarjs/no-hardcoded-secrets` and `no-hardcoded-passwords`; configuration from the environment |

The only credentials in the repository are the local docker compose ones (`ledger` / `ledger`),
used by the development and CI databases and nowhere else.

## Out of scope (documented, not forgotten)

- **No authentication or authorization.** Any caller can move any account. A real deployment puts
  the service behind an authenticating gateway and scopes idempotency keys per client.
- **Idempotency keys are global**, not per client: one client could block another's key.
- **No rate limiting.**
- **TLS** is the job of the proxy in front of the service.

## Reporting a vulnerability

See `SECURITY.md` at the repository root: report privately through GitHub's private vulnerability
reporting, not in a public issue.
