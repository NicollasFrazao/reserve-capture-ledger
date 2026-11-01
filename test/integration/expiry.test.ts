import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { countRows, createTestContext, expectLedgerConsistent, fundedAccount, post } from './helpers.js';

const ctx = createTestContext();

afterEach(async () => {
  await expectLedgerConsistent(ctx.pool);
});

afterAll(async () => {
  await ctx.close();
});

async function reserve(
  accountId: string,
  amount: number,
  ttlSeconds: number,
): Promise<string> {
  const response = await post(
    ctx.app,
    '/reservations',
    {
      accountId,
      amount,
      ttlSeconds,
    },
  );

  expect(response.status).toBe(201);

  return (response.body.reservation as { id: string }).id;
}

async function statusOf(reservationId: string): Promise<string | undefined> {
  const { rows } = await ctx.pool.query<{ status: string }>(
    'SELECT status FROM reservations WHERE id = $1',
    [
      reservationId,
    ],
  );

  return rows[0]?.status;
}

describe('reservation expiry', () => {
  it('the sweep frees a hold once its time has passed, and not before', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    const reservationId = await reserve(
      id,
      60,
      60,
    );

    ctx.clock.advanceSeconds(59);
    await ctx.service.expireDue();
    expect(await statusOf(reservationId)).toBe('reserved');

    ctx.clock.advanceSeconds(1);
    await ctx.service.expireDue();
    expect(await statusOf(reservationId)).toBe('expired');

    expect(await ctx.service.getAccount(id)).toEqual({
      id,
      balance: 100,
      held: 0,
      available: 100,
    });
  });

  it('a capture after expiry is refused even if the sweep has not run yet', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    const reservationId = await reserve(
      id,
      60,
      30,
    );

    ctx.clock.advanceSeconds(31);

    const late = await post(
      ctx.app,
      `/reservations/${reservationId}/capture`,
      { amount: 60 },
    );

    expect(late.status).toBe(409);
    expect((late.body.error as { code: string }).code).toBe('reservation_expired');

    expect(await ctx.service.getAccount(id)).toMatchObject({
      balance: 100,
      held: 60,
    });

    await ctx.service.expireDue();

    expect(await ctx.service.getAccount(id)).toMatchObject({
      balance: 100,
      held: 0,
    });

    const afterSweep = await post(
      ctx.app,
      `/reservations/${reservationId}/release`,
      undefined,
    );

    expect(afterSweep.status).toBe(409);

    expect(afterSweep.body.error).toMatchObject({
      code: 'invalid_transition',
      details: { from: 'expired' },
    });
  });

  it('the sweep leaves final reservations alone', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    const captured = await reserve(
      id,
      30,
      10,
    );

    const released = await reserve(
      id,
      30,
      10,
    );

    await post(
      ctx.app,
      `/reservations/${captured}/capture`,
      { amount: 30 },
    );

    await post(
      ctx.app,
      `/reservations/${released}/release`,
      undefined,
    );

    ctx.clock.advanceSeconds(11);
    await ctx.service.expireDue();

    expect(await statusOf(captured)).toBe('captured');
    expect(await statusOf(released)).toBe('released');

    expect(await ctx.service.getAccount(id)).toEqual({
      id,
      balance: 70,
      held: 0,
      available: 70,
    });
  });

  it('sweeps running side by side expire each reservation exactly once', async () => {
    const accounts = await Promise.all([
      fundedAccount(
        ctx.app,
        100,
      ),
      fundedAccount(
        ctx.app,
        100,
      ),
    ]);

    const reservationIds: string[] = [];

    for (const accountId of accounts) {
      for (let count = 0; count < 10; count += 1) {
        reservationIds.push(await reserve(
          accountId,
          10,
          5,
        ));
      }
    }

    ctx.clock.advanceSeconds(6);

    const due = await countRows(
      ctx.pool,
      "SELECT 1 FROM reservations WHERE status = 'reserved' AND expires_at <= $1",
      [ctx.clock.now()],
    );

    const counts = await Promise.all(Array.from(
      { length: 4 },
      () => ctx.service.expireDue(1000),
    ));

    expect(counts.reduce(
      (
        total,
        count,
      ) => total + count,
      0,
    )).toBe(due);

    for (const reservationId of reservationIds) {
      expect(await statusOf(reservationId)).toBe('expired');
    }

    for (const accountId of accounts) {
      expect(await ctx.service.getAccount(accountId)).toMatchObject({
        balance: 100,
        held: 0,
      });
    }
  });
});
