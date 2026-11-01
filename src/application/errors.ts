import { LedgerError } from '../domain/errors.js';

/** The Idempotency-Key was already used for a different request (another payload or another operation). */
export class IdempotencyKeyConflict extends LedgerError {
  readonly code = 'idempotency_key_conflict';

  /** @param key - The reused key. */
  constructor(key: string) {
    super(
      `idempotency key ${key} was already used for a different request`,
      { key },
    );
  }
}

/** A reservation's time to live is not a whole number of seconds within the allowed range. */
export class InvalidTtl extends LedgerError {
  readonly code = 'invalid_ttl';

  /**
   * @param ttlSeconds - The rejected value.
   * @param max - The largest value allowed.
   */
  constructor(
    ttlSeconds: number,
    max: number,
  ) {
    super(
      `ttlSeconds must be an integer between 1 and ${max}, got ${ttlSeconds}`,
      {
        ttlSeconds,
        max,
      },
    );
  }
}
