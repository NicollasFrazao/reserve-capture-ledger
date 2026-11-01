import { createHash } from 'node:crypto';
import type { ErrorBody } from '../domain/errors.js';

/** What a request asked for, normalized into one fixed shape per operation. */
export interface IdempotentRequest {
  operation: string;
  [field: string]: string | number;
}

/** The result of an operation: its value, or the business error that rejected it. */
export type Outcome<T> = {
  ok: true;
  value: T;
} | {
  ok: false;
  error: ErrorBody;
};

/** An outcome as persisted with its key: the value is plain JSON. */
export type StoredOutcome = Outcome<unknown>;

/** What a write returns: the outcome, and whether it was replayed from an earlier request. */
export interface Execution<T> {
  outcome: Outcome<T>;
  /** True when the outcome was stored by an earlier request with the same key. */
  replayed: boolean;
}

/**
 * Hashes the operation and its normalized parameters.
 *
 * @remarks
 * Two requests with the same key must have the same fingerprint to count as
 * the same request. The operation is part of the hash, so a key reused on
 * another endpoint is a conflict, not a replay. Field order does not matter.
 */
export function fingerprint(request: IdempotentRequest): string {
  const canonical = JSON.stringify(Object.entries(request).sort((
    [left],
    [right],
  ) => left.localeCompare(right)));

  return createHash('sha256').update(canonical).digest('hex');
}
