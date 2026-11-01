import { afterAll, afterEach, describe, expect, it } from 'vitest';
import {
  countRows,
  createTestContext,
  expectLedgerConsistent,
  fundedAccount,
  interceptTransactions,
  newAccountId,
  newKey,
  post,
  slowAccountLocks,
} from './helpers.js';

const ctx = createTestContext();
// Same database, but every transaction stays open 50 ms after locking the
// account: parallel duplicates are guaranteed to arrive while the first
// request is still in flight, which is the race under test.
const slow = createTestContext(slowAccountLocks(50));

afterEach(async () => {
  await expectLedgerConsistent(ctx.pool);
});

afterAll(async () => {
  await Promise.all([
    ctx.close(),
    slow.close(),
  ]);
});

const entriesOf = (accountId: string): Promise<number> =>
  countRows(
    ctx.pool,
    'SELECT 1 FROM ledger_entries WHERE account_id = $1',
    [accountId],
  );

const reservationsOf = (accountId: string): Promise<number> =>
  countRows(
    ctx.pool,
    'SELECT 1 FROM reservations WHERE account_id = $1',
    [accountId],
  );

describe('Idempotency-Key', () => {
  it('a retried credit is applied once and answered with the original response', async () => {
    const id = newAccountId();
    const key = newKey();

    const first = await post(
      ctx.app,
      `/accounts/${id}/credits`,
      { amount: 500 },
      key,
    );

    const second = await post(
      ctx.app,
      `/accounts/${id}/credits`,
      { amount: 500 },
      key,
    );

    const third = await post(
      ctx.app,
      `/accounts/${id}/credits`,
      { amount: 500 },
      key,
    );

    expect(first.status).toBe(201);
    expect(first.replayed).toBe(false);

    for (const retry of [
      second,
      third,
    ]) {
      expect(retry.status).toBe(201);
      expect(retry.replayed).toBe(true);
      expect(retry.raw).toBe(first.raw);
    }

    expect(await entriesOf(id)).toBe(1);
    expect(await ctx.service.getAccount(id)).toMatchObject({ balance: 500 });
  });

  it('identical requests arriving at the same time produce one effect and one response', async () => {
    const id = await fundedAccount(
      ctx.app,
      1000,
    );

    const key = newKey();

    const responses = await Promise.all(
      Array.from(
        { length: 25 },
        () => post(
          slow.app,
          '/reservations',
          {
            accountId: id,
            amount: 100,
          },
          key,
        ),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual(Array(25).fill(201));
    expect(new Set(responses.map((response) => response.raw)).size).toBe(1);
    expect(responses.filter((response) => !response.replayed)).toHaveLength(1);
    expect(await reservationsOf(id)).toBe(1);

    expect(await ctx.service.getAccount(id)).toEqual({
      id,
      balance: 1000,
      held: 100,
      available: 900,
    });
  });

  it('a capture retried in parallel debits once', async () => {
    const id = await fundedAccount(
      ctx.app,
      1000,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 400,
      },
    );

    const reservationId = (reserved.body.reservation as { id: string }).id;
    const key = newKey();

    const responses = await Promise.all(
      Array.from(
        { length: 10 },
        () => post(
          slow.app,
          `/reservations/${reservationId}/capture`,
          { amount: 250 },
          key,
        ),
      ),
    );

    expect(responses.every((response) => response.status === 200 && response.raw === responses[0]?.raw)).toBe(true);
    expect(await entriesOf(id)).toBe(2); // the top-up and one capture

    expect(await ctx.service.getAccount(id)).toEqual({
      id,
      balance: 750,
      held: 0,
      available: 750,
    });
  });

  it('the same key with a different payload is a 409 and changes nothing', async () => {
    const id = await fundedAccount(
      ctx.app,
      1000,
    );

    const key = newKey();

    await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 100,
      },
      key,
    );

    const conflict = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 101,
      },
      key,
    );

    expect(conflict.status).toBe(409);

    expect(conflict.body.error).toMatchObject({
      code: 'idempotency_key_conflict',
      details: { key },
    });

    expect(await reservationsOf(id)).toBe(1);
    expect(await ctx.service.getAccount(id)).toMatchObject({ held: 100 });
  });

  it('the same key on another endpoint is a 409', async () => {
    const id = await fundedAccount(
      ctx.app,
      1000,
    );

    const key = newKey();

    await post(
      ctx.app,
      `/accounts/${id}/credits`,
      { amount: 100 },
      key,
    );

    const conflict = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 100,
      },
      key,
    );

    expect(conflict.status).toBe(409);
    expect(await reservationsOf(id)).toBe(0);
  });

  it('a business rejection is stored and replayed too; a new key is a new attempt', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    const key = newKey();

    const refused = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 150,
      },
      key,
    );

    expect(refused.status).toBe(422);

    await post(
      ctx.app,
      `/accounts/${id}/credits`,
      { amount: 100 },
    );

    const retried = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 150,
      },
      key,
    );

    expect(retried.status).toBe(422);
    expect(retried.replayed).toBe(true);
    expect(retried.raw).toBe(refused.raw);

    const fresh = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 150,
      },
    );

    expect(fresh.status).toBe(201);
  });

  it('an unexpected failure stores nothing, so the client can retry with the same key', async () => {
    let failNextAppend = false;

    const flaky = createTestContext(
      interceptTransactions((tx) => ({
        ledger: {
          append: (entry) => {
            if (!failNextAppend) {
              return tx.ledger.append(entry);
            }

            failNextAppend = false;

            return Promise.reject(new Error('connection reset'));
          },
        },
      })),
    );

    try {
      const id = newAccountId();
      const key = newKey();

      failNextAppend = true;

      const crashed = await post(
        flaky.app,
        `/accounts/${id}/credits`,
        { amount: 300 },
        key,
      );

      expect(crashed.status).toBe(500);

      expect(await countRows(
        ctx.pool,
        'SELECT 1 FROM idempotency_keys WHERE key = $1',
        [key],
      )).toBe(0);

      expect(await countRows(
        ctx.pool,
        'SELECT 1 FROM accounts WHERE id = $1',
        [id],
      )).toBe(0);

      const retried = await post(
        flaky.app,
        `/accounts/${id}/credits`,
        { amount: 300 },
        key,
      );

      expect(retried.status).toBe(201);
      expect(retried.replayed).toBe(false);
      expect(await entriesOf(id)).toBe(1);
    } finally {
      await flaky.close();
    }
  });
});
