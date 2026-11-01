import { InsufficientFunds } from './errors.js';
import { Money } from './money.js';

export interface AccountView {
  id: string;
  balance: number;
  held: number;
  available: number;
}

/**
 * An account owns a balance; part of it may be held by active reservations.
 * Only the available part (balance - held) can be reserved again.
 */
export class Account {
  private constructor(
    readonly id: string,
    private balanceAmount: Money,
    private heldAmount: Money,
  ) {}

  static open(id: string): Account {
    return new Account(id, Money.zero, Money.zero);
  }

  static restore(props: { id: string; balance: Money; held: Money }): Account {
    if (props.held.isGreaterThan(props.balance)) {
      throw new Error(`account ${props.id} holds more than its balance`);
    }
    return new Account(props.id, props.balance, props.held);
  }

  get balance(): Money {
    return this.balanceAmount;
  }

  get held(): Money {
    return this.heldAmount;
  }

  get available(): Money {
    return this.balanceAmount.minus(this.heldAmount);
  }

  credit(amount: Money): void {
    this.balanceAmount = this.balanceAmount.plus(amount);
  }

  /** Sets aside part of the available balance for a reservation. */
  hold(amount: Money): void {
    if (amount.isGreaterThan(this.available)) {
      throw new InsufficientFunds(this.id, amount.units, this.available.units);
    }
    this.heldAmount = this.heldAmount.plus(amount);
  }

  /** Ends a hold without debiting anything. */
  releaseHold(amount: Money): void {
    this.heldAmount = this.heldAmount.minus(amount);
  }

  /** Ends a hold and debits the captured part of it; the rest goes back to available. */
  settleHold(held: Money, captured: Money): void {
    if (captured.isGreaterThan(held)) {
      throw new Error(`cannot settle ${captured.units} out of a hold of ${held.units}`);
    }
    this.heldAmount = this.heldAmount.minus(held);
    this.balanceAmount = this.balanceAmount.minus(captured);
  }

  toView(): AccountView {
    return {
      id: this.id,
      balance: this.balanceAmount.units,
      held: this.heldAmount.units,
      available: this.available.units,
    };
  }
}
