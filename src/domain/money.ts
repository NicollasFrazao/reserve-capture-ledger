import { InvalidAmount } from './errors.js';

/**
 * A non-negative amount of credits in integer minor units.
 *
 * @remarks
 * Amounts are JavaScript numbers restricted to safe integers: exact, JSON
 * friendly, and far beyond any realistic balance (2^53 - 1 minor units).
 * Fractions and floats are rejected at the boundary instead of rounded, so no
 * operation can silently create or lose a fraction of a credit.
 */
export class Money {
  /** The zero amount, shared because Money is immutable. */
  static readonly zero = new Money(0);

  private constructor(readonly units: number) {}

  /**
   * Creates an amount of `units` minor units.
   *
   * @throws {@link InvalidAmount} when `units` is negative, fractional or beyond the safe integer range.
   */
  static of(units: number): Money {
    if (!Number.isSafeInteger(units)) {
      throw new InvalidAmount(
        units,
        'must be a safe integer of minor units',
      );
    }

    if (units < 0) {
      throw new InvalidAmount(
        units,
        'must not be negative',
      );
    }

    return units === 0 ? Money.zero : new Money(units);
  }

  /**
   * Creates an amount that must be strictly positive, as every operation requires.
   *
   * @throws {@link InvalidAmount} when `units` is zero, or invalid for {@link Money.of}.
   */
  static positive(units: number): Money {
    const money = Money.of(units);

    if (money.isZero()) {
      throw new InvalidAmount(
        units,
        'must be greater than zero',
      );
    }

    return money;
  }

  /**
   * Returns the sum of both amounts.
   *
   * @throws {@link InvalidAmount} when the sum would leave the safe integer range.
   */
  plus(other: Money): Money {
    return Money.of(this.units + other.units);
  }

  /**
   * Returns this amount minus `other`.
   *
   * @throws {@link InvalidAmount} when the result would be negative.
   */
  minus(other: Money): Money {
    if (other.units > this.units) {
      throw new InvalidAmount(
        this.units - other.units,
        'the result would be negative',
      );
    }

    return Money.of(this.units - other.units);
  }

  /** Tells whether this is the zero amount. */
  isZero(): boolean {
    return this.units === 0;
  }

  /** Tells whether this amount is strictly greater than `other`. */
  isGreaterThan(other: Money): boolean {
    return this.units > other.units;
  }

  /** Compares by value. */
  equals(other: Money): boolean {
    return this.units === other.units;
  }

  /** Serializes as the plain number of minor units. */
  toJSON(): number {
    return this.units;
  }
}
