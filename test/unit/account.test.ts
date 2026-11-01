import { describe, expect, it } from 'vitest';
import { Account } from '../../src/domain/account.js';
import { InsufficientFunds } from '../../src/domain/errors.js';
import { Money } from '../../src/domain/money.js';

const funded = (
  balance: number,
  held = 0,
): Account =>
  Account.restore({
    id: 'a1',
    balance: Money.of(balance),
    held: Money.of(held),
  });

describe('Account', () => {
  it('opens empty', () => {
    expect(Account.open('a1').toView()).toEqual({
      id: 'a1',
      balance: 0,
      held: 0,
      available: 0,
    });
  });

  it('adds credits to the balance', () => {
    const account = funded(100);
    account.credit(Money.of(50));

    expect(account.toView()).toEqual({
      id: 'a1',
      balance: 150,
      held: 0,
      available: 150,
    });
  });

  it('holds part of the available balance', () => {
    const account = funded(100);
    account.hold(Money.of(60));

    expect(account.toView()).toEqual({
      id: 'a1',
      balance: 100,
      held: 60,
      available: 40,
    });
  });

  it('can hold exactly what is available', () => {
    const account = funded(
      100,
      40,
    );

    account.hold(Money.of(60));
    expect(account.available.isZero()).toBe(true);
  });

  it('refuses a hold larger than the available balance, not the total balance', () => {
    const account = funded(
      100,
      60,
    );

    expect(() => {
      account.hold(Money.of(41));
    }).toThrow(InsufficientFunds);

    try {
      account.hold(Money.of(41));
    } catch (error) {
      expect((error as InsufficientFunds).toJSON()).toMatchObject({
        code: 'insufficient_funds',
        details: {
          requested: 41,
          available: 40,
        },
      });
    }

    expect(account.held.units).toBe(60);
  });

  it('releasing a hold gives it back to available without touching the balance', () => {
    const account = funded(
      100,
      60,
    );

    account.releaseHold(Money.of(60));

    expect(account.toView()).toEqual({
      id: 'a1',
      balance: 100,
      held: 0,
      available: 100,
    });
  });

  it('settling a hold debits only the captured part', () => {
    const account = funded(
      100,
      60,
    );

    account.settleHold(
      Money.of(60),
      Money.of(45),
    );

    expect(account.toView()).toEqual({
      id: 'a1',
      balance: 55,
      held: 0,
      available: 55,
    });
  });

  it('cannot settle more than was held', () => {
    expect(() => {
      funded(
        100,
        60,
      ).settleHold(
        Money.of(60),
        Money.of(61),
      );
    }).toThrow();
  });

  it('cannot be restored holding more than its balance', () => {
    expect(() => funded(
      10,
      11,
    )).toThrow();
  });
});
