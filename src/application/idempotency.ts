import { createHash } from 'node:crypto';
import type { ErrorBody } from '../domain/errors.js';

/** What a request asked for, in a fixed shape per operation. */
export interface IdempotentRequest {
  operation: string;
  [field: string]: string | number;
}

export type Outcome<T> = { ok: true; value: T } | { ok: false; error: ErrorBody };

/** An outcome as persisted: the value is plain JSON. */
export type StoredOutcome = Outcome<unknown>;

export interface Execution<T> {
  outcome: Outcome<T>;
  /** True when the outcome was stored by an earlier request with the same key. */
  replayed: boolean;
}

/**
 * Hash of the operation and its normalized parameters. Two requests with
 * the same key must have the same fingerprint to be the same request.
 */
export function fingerprint(request: IdempotentRequest): string {
  const canonical = JSON.stringify(Object.entries(request).sort(([a], [b]) => a.localeCompare(b)));
  return createHash('sha256').update(canonical).digest('hex');
}
