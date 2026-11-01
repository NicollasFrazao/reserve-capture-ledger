import { InsufficientFunds } from './errors.js';
import { Money } from './money.js';

/** The plain form of an account returned to clients. Amounts are minor units. */
export interface AccountView {
  id: string;
  balance: number;
  held: number;
  available: number;
}

/** The stored state an {@link Account} is rebuilt from. */
export interface AccountState {
  id: string;
  balance: Money;
  held: Money;
}

/**
 * An account owns a balance; part of it may be held by active reservations.
 *
 * @remarks
 * Only the available part (balance minus held) can be reserved again. The
 * invariant `held <= balance` is kept by every method and checked again by
 * the database.
 */
export class Account {
  private constructor(
    readonly id: string,
    private balanceAmount: Money,
    private heldAmount: Money,
  ) {}

  /** Opens an account with nothing in it. */
  static open(id: string): Account {
    return new Account(
      id,
      Money.zero,
      Money.zero,
    );
  }

  /**
   * Rebuilds an account from stored state.
   *
   * @throws {@link RangeError} when the state holds more than its balance, which only corrupted data can do.
   */
  static restore(state: AccountState): Account {
    if (state.held.isGreaterThan(state.balance)) {
      throw new RangeError(`account ${state.id} holds more than its balance`);
    }

    return new Account(
      state.id,
      state.balance,
      state.held,
    );
  }

  /** Everything the account owns, held or not. */
  get balance(): Money {
    return this.balanceAmount;
  }

  /** The part of the balance promised to active reservations. */
  get held(): Money {
    return this.heldAmount;
  }

  /** The part of the balance a new reservation can still hold. */
  get available(): Money {
    return this.balanceAmount.minus(this.heldAmount);
  }

  /** Adds a top-up to the balance. */
  credit(amount: Money): void {
    this.balanceAmount = this.balanceAmount.plus(amount);
  }

  /**
   * Sets aside part of the available balance for a reservation.
   *
   * @throws {@link InsufficientFunds} when `amount` is more than what is available.
   */
  hold(amount: Money): void {
    if (amount.isGreaterThan(this.available)) {
      throw new InsufficientFunds(
        this.id,
        amount.units,
        this.available.units,
      );
    }

    this.heldAmount = this.heldAmount.plus(amount);
  }

  /** Ends a hold without debiting anything: the amount becomes available again. */
  releaseHold(amount: Money): void {
    this.heldAmount = this.heldAmount.minus(amount);
  }

  /**
   * Ends a hold and debits the captured part of it; the rest becomes available again.
   *
   * @param held - The whole amount the reservation was holding.
   * @param captured - The part of it to debit.
   *
   * @throws {@link RangeError} when `captured` exceeds `held`; the reservation checks this first.
   */
  settleHold(
    held: Money,
    captured: Money,
  ): void {
    if (captured.isGreaterThan(held)) {
      throw new RangeError(`cannot settle ${captured.units} out of a hold of ${held.units}`);
    }

    this.heldAmount = this.heldAmount.minus(held);
    this.balanceAmount = this.balanceAmount.minus(captured);
  }

  /** Returns the plain form sent to clients. */
  toView(): AccountView {
    return {
      id: this.id,
      balance: this.balanceAmount.units,
      held: this.heldAmount.units,
      available: this.available.units,
    };
  }
}
