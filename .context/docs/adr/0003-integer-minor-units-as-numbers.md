# 0003. Amounts are integer minor units, held as safe-integer numbers

- Status: accepted
- Date: 2026-11-01

## Context

Floating-point amounts lose fractions silently. PostgreSQL `bigint` values come back from `pg` as
strings because they can exceed `Number.MAX_SAFE_INTEGER`.

## Options

1. `bigint` in TypeScript end to end.
2. `number` restricted to safe integers, validated at every boundary.
3. A decimal library.

## Decision

Option 2.

- `Money.of` rejects anything that is not a non-negative safe integer; every operation needs
  `Money.positive`.
- The `pg` type parser turns `bigint` columns into numbers and throws on a value outside the safe
  range instead of rounding it.
- Numbers serialize to JSON as they are; `bigint` does not, and every response would need a
  conversion.

## Consequences

- The largest amount is 2^53 - 1 minor units, about 90 trillion units of a two-decimal currency.
- One currency only; adding currencies means adding it to `Money` and to every table.
