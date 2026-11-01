# Architecture decision records

One file per decision that shaped the code and would be expensive to reverse. Each says what was
decided, what else was considered, and what it costs. A superseded record stays, marked as such.

| # | Decision | Status |
| --- | --- | --- |
| [0001](0001-row-lock-for-balance-changes.md) | Serialize balance changes with a row lock on the account | Accepted |
| [0002](0002-idempotency-in-the-operation-transaction.md) | Claim the idempotency key in the operation's own transaction | Accepted |
| [0003](0003-integer-minor-units-as-numbers.md) | Amounts are integer minor units, held as safe-integer numbers | Accepted |
