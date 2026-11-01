import { describe, expect, it } from 'vitest';
import { fingerprint } from '../../src/application/idempotency.js';

describe('fingerprint', () => {
  it('is stable and ignores the order fields were written in', () => {
    expect(fingerprint({ operation: 'reserve', accountId: 'a1', amount: 10 })).toBe(
      fingerprint({ amount: 10, accountId: 'a1', operation: 'reserve' }),
    );
  });

  it('changes with any parameter', () => {
    const base = fingerprint({ operation: 'reserve', accountId: 'a1', amount: 10 });
    expect(fingerprint({ operation: 'reserve', accountId: 'a1', amount: 11 })).not.toBe(base);
    expect(fingerprint({ operation: 'reserve', accountId: 'a2', amount: 10 })).not.toBe(base);
  });

  it('changes with the operation, so one key cannot be reused across endpoints', () => {
    expect(fingerprint({ operation: 'credit', accountId: 'a1', amount: 10 })).not.toBe(
      fingerprint({ operation: 'reserve', accountId: 'a1', amount: 10 }),
    );
  });
});
