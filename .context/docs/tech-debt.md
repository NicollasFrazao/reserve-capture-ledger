---
type: doc
name: tech-debt
description: Known gaps, with the reason each is still open
category: debt
generated: 2026-11-01
status: filled
scaffoldVersion: "2.0.0"
---

# Technical debt

Known gaps, each a decision with a reason. When one is picked up, it becomes an issue and its number
goes here.

| Id | Gap | Why it is open | What closes it |
| --- | --- | --- | --- |
| TD-01 | No authentication; idempotency keys are global | Out of scope for a showcase of the ledger mechanics | Auth at the gateway, `client_id` in the key's primary key |
| TD-02 | Idempotency keys are never purged | Correct by default; purging needs a retention decision | Scheduled `DELETE FROM idempotency_keys WHERE created_at < now() - interval '...'` |
| TD-03 | A hot account serializes all its writes | Accepted in ADR 0001 | Conditional update, or sub-accounts |
| TD-04 | The sweep runs in-process with `setInterval` | Simple and safe to run in every replica | A scheduled job, or `pg_cron` |
| TD-05 | Single currency, single-entry ledger | Out of scope | `currency` on `Money` and tables; double-entry accounts |
| TD-06 | Runs from source with `tsx`, no build or image | Out of scope | `tsc` build to `dist/` and a container image |
| TD-07 | No listing endpoints (ledger history, reservations) | Not needed by the scenarios | Keyset-paginated `GET` routes |
| TD-09 | Dependabot ignores TypeScript majors | typescript-eslint does not support TypeScript 7 yet | Remove the `typescript` ignore rule in `.github/dependabot.yml` once typescript-eslint supports 7.x |
