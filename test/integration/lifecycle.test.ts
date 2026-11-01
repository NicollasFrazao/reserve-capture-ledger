import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { createTestContext, expectLedgerConsistent, fundedAccount, newAccountId, post } from './helpers.js';

const ctx = createTestContext();

afterEach(async () => {
  await expectLedgerConsistent(ctx.pool);
});

afterAll(async () => {
  await ctx.close();
});

describe('reserve, capture and release over HTTP', () => {
  it('opens an account on its first credit and reports it', async () => {
    const id = newAccountId();

    const credited = await post(
      ctx.app,
      `/accounts/${id}/credits`,
      { amount: 1000 },
    );

    expect(credited.status).toBe(201);

    expect(credited.body).toMatchObject({
      account: {
        id,
        balance: 1000,
        held: 0,
        available: 1000,
      },
      entry: {
        accountId: id,
        kind: 'credit',
        amount: 1000,
        balanceAfter: 1000,
        reservationId: null,
      },
    });

    const read = await ctx.app.inject({
      method: 'GET',
      url: `/accounts/${id}`,
    });

    expect(read.statusCode).toBe(200);

    expect(read.json()).toEqual({
      id,
      balance: 1000,
      held: 0,
      available: 1000,
    });
  });

  it('holds on reserve, debits the captured part and frees the rest', async () => {
    const id = await fundedAccount(
      ctx.app,
      1000,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 300,
      },
    );

    expect(reserved.status).toBe(201);

    expect(reserved.body.account).toEqual({
      id,
      balance: 1000,
      held: 300,
      available: 700,
    });

    const reservation = reserved.body.reservation as {
      id: string;
      status: string;
    };

    expect(reservation.status).toBe('reserved');

    const captured = await post(
      ctx.app,
      `/reservations/${reservation.id}/capture`,
      { amount: 120 },
    );

    expect(captured.status).toBe(200);

    expect(captured.body).toMatchObject({
      reservation: {
        id: reservation.id,
        status: 'captured',
        amount: 300,
        capturedAmount: 120,
        releasedAmount: 180,
      },
      account: {
        id,
        balance: 880,
        held: 0,
        available: 880,
      },
      entry: {
        kind: 'capture',
        amount: -120,
        balanceAfter: 880,
        reservationId: reservation.id,
      },
    });
  });

  it('release frees the whole hold and debits nothing', async () => {
    const id = await fundedAccount(
      ctx.app,
      500,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 200,
      },
    );

    const reservationId = (reserved.body.reservation as { id: string }).id;

    const released = await post(
      ctx.app,
      `/reservations/${reservationId}/release`,
      undefined,
    );

    expect(released.status).toBe(200);

    expect(released.body).toMatchObject({
      reservation: {
        status: 'released',
        capturedAmount: null,
        releasedAmount: 200,
      },
      account: {
        balance: 500,
        held: 0,
        available: 500,
      },
    });
  });

  it('refuses a reservation larger than the available balance', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 70,
      },
    );

    const refused = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 31,
      },
    );

    expect(refused.status).toBe(422);

    expect(refused.body).toEqual({
      error: {
        code: 'insufficient_funds',
        message: `account ${id} has 30 available, 31 requested`,
        details: {
          accountId: id,
          requested: 31,
          available: 30,
        },
      },
    });
  });

  it('refuses to capture more than was reserved, leaving everything as it was', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 50,
      },
    );

    const reservationId = (reserved.body.reservation as { id: string }).id;

    const refused = await post(
      ctx.app,
      `/reservations/${reservationId}/capture`,
      { amount: 51 },
    );

    expect(refused.status).toBe(422);
    expect((refused.body.error as { code: string }).code).toBe('capture_exceeds_reservation');

    expect(await ctx.service.getAccount(id)).toEqual({
      id,
      balance: 100,
      held: 50,
      available: 50,
    });
  });

  it('allows only one final state per reservation', async () => {
    const id = await fundedAccount(
      ctx.app,
      100,
    );

    const reserved = await post(
      ctx.app,
      '/reservations',
      {
        accountId: id,
        amount: 50,
      },
    );

    const reservationId = (reserved.body.reservation as { id: string }).id;

    await post(
      ctx.app,
      `/reservations/${reservationId}/capture`,
      { amount: 50 },
    );

    const again = await post(
      ctx.app,
      `/reservations/${reservationId}/release`,
      undefined,
    );

    expect(again.status).toBe(409);

    expect(again.body.error).toMatchObject({
      code: 'invalid_transition',
      details: {
        from: 'captured',
        to: 'released',
      },
    });
  });

  it('answers 404 for unknown accounts and reservations', async () => {
    const missingAccount = newAccountId();

    expect((await ctx.app.inject({
      method: 'GET',
      url: `/accounts/${missingAccount}`,
    })).statusCode).toBe(404);

    const reserve = await post(
      ctx.app,
      '/reservations',
      {
        accountId: missingAccount,
        amount: 1,
      },
    );

    expect(reserve.status).toBe(404);
    expect((reserve.body.error as { code: string }).code).toBe('account_not_found');

    const capture = await post(
      ctx.app,
      `/reservations/${randomUUID()}/capture`,
      { amount: 1 },
    );

    expect(capture.status).toBe(404);
    expect((capture.body.error as { code: string }).code).toBe('reservation_not_found');
  });

  describe('request validation', () => {
    it('requires the Idempotency-Key header on every write', async () => {
      const response = await post(
        ctx.app,
        `/accounts/${newAccountId()}/credits`,
        { amount: 10 },
        null,
      );

      expect(response.status).toBe(400);
      expect(response.body.error).toMatchObject({ code: 'bad_request' });
      expect((response.body.error as { message: string }).message).toMatch(/Idempotency-Key/);
    });

    it.each([
      [
        'a fraction',
        { amount: 10.5 },
      ],
      [
        'zero',
        { amount: 0 },
      ],
      [
        'a negative amount',
        { amount: -5 },
      ],
      [
        'a string',
        { amount: '10' },
      ],
      [
        'an unknown field',
        {
          amount: 10,
          currency: 'XYZ',
        },
      ],
    ])('rejects %s', async (
      _label,
      body,
    ) => {
      const response = await post(
        ctx.app,
        `/accounts/${newAccountId()}/credits`,
        body,
      );

      expect(response.status).toBe(400);
      expect((response.body.error as { code: string }).code).toBe('bad_request');
    });

    it('rejects malformed ids and a ttl above the maximum', async () => {
      expect((await post(
        ctx.app,
        '/reservations/not-a-uuid/release',
        undefined,
      )).status).toBe(400);

      expect((await post(
        ctx.app,
        '/accounts/has spaces/credits',
        { amount: 1 },
      )).status).toBe(400);

      const id = await fundedAccount(
        ctx.app,
        10,
      );

      const response = await post(
        ctx.app,
        '/reservations',
        {
          accountId: id,
          amount: 1,
          ttlSeconds: 86_401,
        },
      );

      expect(response.status).toBe(400);
      expect((response.body.error as { code: string }).code).toBe('invalid_ttl');
    });

    it('rejects malformed JSON', async () => {
      const response = await ctx.app.inject({
        method: 'POST',
        url: `/accounts/${newAccountId()}/credits`,
        headers: {
          'idempotency-key': 'k',
          'content-type': 'application/json',
        },
        payload: '{"amount":',
      });

      expect(response.statusCode).toBe(400);
    });
  });
});
