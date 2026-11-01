import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { countRows, createTestContext, expectLedgerConsistent, fundedAccount, newKey, post } from './helpers.js';

const ctx = createTestContext();

afterEach(async () => {
  await expectLedgerConsistent(ctx.pool);
});
afterAll(async () => {
  await ctx.close();
});

describe('concurrent writes to one account', () => {
  it('50 parallel reserves on an account that affords 23: exactly 23 succeed, no overdraft', async () => {
    const id = await fundedAccount(ctx.app, 230);

    const responses = await Promise.all(
      Array.from({ length: 50 }, () => post(ctx.app, '/reservations', { accountId: id, amount: 10 })),
    );

    const statuses = responses.map((r) => r.status);
    expect(statuses.filter((s) => s === 201)).toHaveLength(23);
    expect(statuses.filter((s) => s === 422)).toHaveLength(27);
    expect(await ctx.service.getAccount(id)).toEqual({ id, balance: 230, held: 230, available: 0 });
    expect(await countRows(ctx.pool, 'SELECT 1 FROM reservations WHERE account_id = $1', [id])).toBe(23);
  });

  it('uneven amounts racing for the same balance never hold more than it', async () => {
    const id = await fundedAccount(ctx.app, 1000);
    const amounts = Array.from({ length: 40 }, (_, i) => 10 + ((i * 37) % 90));

    const responses = await Promise.all(
      amounts.map((amount) => post(ctx.app, '/reservations', { accountId: id, amount })),
    );

    const heldBySuccesses = responses
      .filter((r) => r.status === 201)
      .reduce((sum, r) => sum + (r.body.reservation as { amount: number }).amount, 0);
    const account = await ctx.service.getAccount(id);
    expect(account.held).toBe(heldBySuccesses);
    expect(account.held).toBeLessThanOrEqual(1000);
    // Every refusal was a real one: at the time, the amount did not fit.
    for (const refused of responses.filter((r) => r.status === 422)) {
      const { requested, available } = (refused.body.error as { details: { requested: number; available: number } })
        .details;
      expect(requested).toBeGreaterThan(available);
    }
  });

  it('a capture and a release racing on one reservation: exactly one wins', async () => {
    const id = await fundedAccount(ctx.app, 100);

    for (let round = 0; round < 10; round += 1) {
      const reserved = await post(ctx.app, '/reservations', { accountId: id, amount: 10 });
      const reservationId = (reserved.body.reservation as { id: string }).id;

      const [capture, release] = await Promise.all([
        post(ctx.app, `/reservations/${reservationId}/capture`, { amount: 10 }),
        post(ctx.app, `/reservations/${reservationId}/release`, undefined),
      ]);

      const statuses = [capture.status, release.status].sort();
      expect(statuses).toEqual([200, 409]);
    }
    const account = await ctx.service.getAccount(id);
    expect(account.held).toBe(0);
  });

  it('credits, reserves, captures and releases interleaved keep the books straight', async () => {
    const id = await fundedAccount(ctx.app, 500);

    await Promise.all(
      Array.from({ length: 30 }, async (_, i) => {
        if (i % 3 === 0) {
          await post(ctx.app, `/accounts/${id}/credits`, { amount: 25 });
          return;
        }
        const reserved = await post(ctx.app, '/reservations', { accountId: id, amount: 40 });
        if (reserved.status !== 201) return;
        const reservationId = (reserved.body.reservation as { id: string }).id;
        if (i % 3 === 1) {
          await post(ctx.app, `/reservations/${reservationId}/capture`, { amount: 15 }, newKey());
        } else {
          await post(ctx.app, `/reservations/${reservationId}/release`, undefined);
        }
      }),
    );

    const account = await ctx.service.getAccount(id);
    expect(account.held).toBe(0);
    expect(account.balance).toBeGreaterThanOrEqual(0);
  });
});
