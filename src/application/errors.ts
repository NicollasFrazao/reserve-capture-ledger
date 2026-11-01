import { LedgerError } from '../domain/errors.js';

export class IdempotencyKeyConflict extends LedgerError {
  readonly code = 'idempotency_key_conflict';

  constructor(key: string) {
    super(`idempotency key ${key} was already used for a different request`, { key });
  }
}

export class InvalidTtl extends LedgerError {
  readonly code = 'invalid_ttl';

  constructor(ttlSeconds: number, max: number) {
    super(`ttlSeconds must be an integer between 1 and ${max}, got ${ttlSeconds}`, { ttlSeconds, max });
  }
}
