import { describe, expect, it } from 'vitest';
import { InvalidAmount } from '../../src/domain/errors.js';
import { Money } from '../../src/domain/money.js';

describe('Money', () => {
  it('accepts zero and positive integers of minor units', () => {
    expect(Money.of(0).units).toBe(0);
    expect(Money.of(1250).units).toBe(1250);
    expect(Money.of(Number.MAX_SAFE_INTEGER).units).toBe(Number.MAX_SAFE_INTEGER);
  });

  it.each([0.5, 10.01, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects %s, which is not a safe integer',
    (value) => {
      expect(() => Money.of(value)).toThrow(InvalidAmount);
    },
  );

  it('rejects negative amounts', () => {
    expect(() => Money.of(-1)).toThrow(InvalidAmount);
  });

  it('requires positive amounts where an operation needs one', () => {
    expect(() => Money.positive(0)).toThrow(/greater than zero/);
    expect(Money.positive(1).units).toBe(1);
  });

  it('adds and subtracts exactly', () => {
    expect(Money.of(100).plus(Money.of(25)).units).toBe(125);
    expect(Money.of(100).minus(Money.of(100)).isZero()).toBe(true);
  });

  it('never goes below zero', () => {
    expect(() => Money.of(10).minus(Money.of(11))).toThrow(InvalidAmount);
  });

  it('refuses a sum that would lose precision', () => {
    expect(() => Money.of(Number.MAX_SAFE_INTEGER).plus(Money.of(1))).toThrow(InvalidAmount);
  });

  it('compares by value and serializes as a plain number', () => {
    expect(Money.of(5).equals(Money.of(5))).toBe(true);
    expect(Money.of(6).isGreaterThan(Money.of(5))).toBe(true);
    expect(JSON.stringify({ amount: Money.of(42) })).toBe('{"amount":42}');
  });
});
