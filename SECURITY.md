# Security policy

## Reporting a vulnerability

Please do not open a public issue. Report it privately through GitHub's
[private vulnerability reporting](https://github.com/NicollasFrazao/reserve-capture-ledger/security/advisories/new)
with:

- what an attacker can do (for example: charge an account twice, overdraw it, rewrite the ledger);
- the requests or the test that reproduce it;
- the commit you tested.

You can expect an acknowledgement within a week. Fixes are released on `main` and credited in the
advisory unless you prefer otherwise.

## Supported versions

Only the latest commit on `main` is supported.

## Scope

The service has no authentication by design (see the README, "Out of scope"); reports that amount to
"anyone can call the API" are known. Everything that breaks the documented guarantees — idempotency,
no overdraft, append-only ledger, one-way reservation states — is in scope.
