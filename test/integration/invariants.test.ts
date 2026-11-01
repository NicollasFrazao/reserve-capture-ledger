import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createTestContext, expectLedgerConsistent, fundedAccount, newKey, post } from './helpers.js';

const ctx = createTestContext();

afterEach(async () => {
  await expectLedgerConsistent(ctx.pool);
});

afterAll(async () => {
  await ctx.close();
});

/** Small seeded PRNG (mulberry32), so a failing run can be replayed. */
function random(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;

    mixed = Math.imul(
      mixed ^ (mixed >>> 15),
      mixed | 1,
    );

    mixed ^= mixed + Math.imul(
      mixed ^ (mixed >>> 7),
      mixed | 61,
    );

    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

describe('ledger invariant', () => {
  it('holds after a random, concurrent mix of every operation (including retries)', async () => {
    const next = random(20261101);
    const pick = <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)] as T;

    const accounts = await Promise.all(Array.from(
      { length: 4 },
      () => fundedAccount(
        ctx.app,
        200,
      ),
    ));

    const open: string[] = [];

    for (let wave = 0; wave < 8; wave += 1) {
      await Promise.all(
        Array.from(
          { length: 25 },
          async () => {
            const roll = next();
            const amount = 1 + Math.floor(next() * 80);
            const key = newKey();

            if (roll < 0.2) {
              await post(
                ctx.app,
                `/accounts/${pick(accounts)}/credits`,
                { amount },
                key,
              );
            } else if (roll < 0.6) {
              const response = await post(
                ctx.app,
                '/reservations',
                {
                  accountId: pick(accounts),
                  amount,
                  ttlSeconds: 30,
                },
                key,
              );

              if (response.status === 201) {
                open.push((response.body.reservation as { id: string }).id);
              }

              if (next() < 0.3) {
                await post(
                  ctx.app,
                  '/reservations',
                  {
                    accountId: pick(accounts),
                    amount,
                  },
                  key,
                );
              }
            } else if (
              roll < 0.8
                   && open.length > 0
            ) {
              await post(
                ctx.app,
                `/reservations/${pick(open)}/capture`,
                { amount: 1 + Math.floor(next() * 40) },
                key,
              );
            } else if (open.length > 0) {
              await post(
                ctx.app,
                `/reservations/${pick(open)}/release`,
                undefined,
                key,
              );
            }
          },
        ),
      );

      ctx.clock.advanceSeconds(10);
      await ctx.service.expireDue();
      await expectLedgerConsistent(ctx.pool);
    }

    const { rows } = await ctx.pool.query<{ negative: number }>(
      'SELECT count(*)::int AS negative FROM accounts WHERE balance < 0 OR held > balance',
    );

    expect(rows[0]?.negative).toBe(0);
  });
});

describe('database guards (the backstop behind the domain rules)', () => {
  async function capturedReservation(): Promise<{
    accountId: string;
    reservationId: string;
  }> {
    const accountId = await fundedAccount(
      ctx.app,
      100,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId,
        amount: 40,
      },
    );

    const reservationId = (reserved.body.reservation as { id: string }).id;

    await post(
      ctx.app,
      `/reservations/${reservationId}/capture`,
      { amount: 40 },
    );

    return {
      accountId,
      reservationId,
    };
  }

  it('ledger entries cannot be updated, deleted or truncated', async () => {
    const { accountId } = await capturedReservation();

    await expect(
      ctx.pool.query(
        'UPDATE ledger_entries SET amount = 1 WHERE account_id = $1',
        [accountId],
      ),
    ).rejects.toThrow(/append-only/);

    await expect(ctx.pool.query(
      'DELETE FROM ledger_entries WHERE account_id = $1',
      [accountId],
    )).rejects.toThrow(
      /append-only/,
    );

    await expect(ctx.pool.query('TRUNCATE ledger_entries CASCADE')).rejects.toThrow(/append-only/);
  });

  it('a final reservation cannot change state or amount', async () => {
    const { reservationId } = await capturedReservation();

    await expect(
      ctx.pool.query(
        "UPDATE reservations SET status = 'reserved', captured_amount = NULL, finalized_at = NULL WHERE id = $1",
        [
          reservationId,
        ],
      ),
    ).rejects.toThrow(/cannot change/);

    await expect(ctx.pool.query(
      'DELETE FROM reservations WHERE id = $1',
      [reservationId],
    )).rejects.toThrow(
      /never deleted/,
    );
  });

  it('an active reservation cannot change its amount', async () => {
    const accountId = await fundedAccount(
      ctx.app,
      100,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId,
        amount: 40,
      },
    );

    const reservationId = (reserved.body.reservation as { id: string }).id;

    await expect(ctx.pool.query(
      'UPDATE reservations SET amount = 1 WHERE id = $1',
      [reservationId],
    )).rejects.toThrow(
      /immutable/,
    );

    await post(
      ctx.app,
      `/reservations/${reservationId}/release`,
      undefined,
    );
  });

  it('an account can never hold more than its balance, nor go negative', async () => {
    const accountId = await fundedAccount(
      ctx.app,
      100,
    );

    await expect(ctx.pool.query(
      'UPDATE accounts SET held = 101 WHERE id = $1',
      [accountId],
    )).rejects.toThrow(
      /held_within_balance/,
    );

    await expect(ctx.pool.query(
      'UPDATE accounts SET balance = -1 WHERE id = $1',
      [accountId],
    )).rejects.toThrow(
      /check constraint/,
    );
  });
});
