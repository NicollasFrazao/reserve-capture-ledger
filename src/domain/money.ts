import { InvalidAmount } from './errors.js';

/**
 * A non-negative amount of credits in integer minor units.
 *
 * Amounts are JavaScript numbers restricted to safe integers: exact, JSON
 * friendly, and far beyond any realistic balance (2^53 - 1 minor units).
 * Fractions and floats are rejected at the boundary instead of rounded.
 */
export class Money {
  static readonly zero = new Money(0);

  private constructor(readonly units: number) {}

  static of(units: number): Money {
    if (!Number.isSafeInteger(units)) throw new InvalidAmount(units, 'must be a safe integer of minor units');
    if (units < 0) throw new InvalidAmount(units, 'must not be negative');
    return units === 0 ? Money.zero : new Money(units);
  }

  /** An amount that must be strictly positive, as every operation requires. */
  static positive(units: number): Money {
    const money = Money.of(units);
    if (money.isZero()) throw new InvalidAmount(units, 'must be greater than zero');
    return money;
  }

  plus(other: Money): Money {
    return Money.of(this.units + other.units);
  }

  minus(other: Money): Money {
    if (other.units > this.units) {
      throw new InvalidAmount(this.units - other.units, 'the result would be negative');
    }
    return Money.of(this.units - other.units);
  }

  isZero(): boolean {
    return this.units === 0;
  }

  isGreaterThan(other: Money): boolean {
    return this.units > other.units;
  }

  equals(other: Money): boolean {
    return this.units === other.units;
  }

  toJSON(): number {
    return this.units;
  }
}
