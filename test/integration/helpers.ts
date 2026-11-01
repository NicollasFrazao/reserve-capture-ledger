import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type pg from 'pg';
import { expect, inject } from 'vitest';
import type { Clock } from '../../src/application/clock.js';
import { LedgerService } from '../../src/application/ledger-service.js';
import type { Transaction, TransactionRunner } from '../../src/application/ports.js';
import { createPool, PgTransactionRunner } from '../../src/infrastructure/database.js';
import { buildApp } from '../../src/http/app.js';

/** A clock the test moves by hand. Starts at the real current time. */
export class FakeClock implements Clock {
  private current = new Date();

  now(): Date {
    return new Date(this.current);
  }

  advanceSeconds(seconds: number): void {
    this.current = new Date(this.current.getTime() + seconds * 1000);
  }
}

export interface TestContext {
  pool: pg.Pool;
  runner: PgTransactionRunner;
  clock: FakeClock;
  service: LedgerService;
  app: FastifyInstance;
  close(): Promise<void>;
}

export function createTestContext(wrapRunner?: (runner: TransactionRunner) => TransactionRunner): TestContext {
  const pool = createPool(inject('databaseUrl'), 20);
  const runner = new PgTransactionRunner(pool);
  const clock = new FakeClock();
  const service = new LedgerService(wrapRunner ? wrapRunner(runner) : runner, clock);
  const app = buildApp(service);
  return {
    pool,
    runner,
    clock,
    service,
    app,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}

/**
 * Wraps a runner so a test can replace parts of every transaction, e.g. to
 * inject a failure or slow a step down and widen a race window.
 */
export function interceptTransactions(
  override: (tx: Transaction) => Partial<Transaction>,
): (runner: TransactionRunner) => TransactionRunner {
  return (runner) => ({
    transaction: (work) =>
      runner.transaction((tx) =>
        work({
          accounts: tx.accounts,
          reservations: tx.reservations,
          ledger: tx.ledger,
          idempotency: tx.idempotency,
          savepoint: (inner) => tx.savepoint(inner),
          ...override(tx),
        }),
      ),
  });
}

/** Makes every account lock take `ms` longer, so concurrent requests overlap for sure. */
export const slowAccountLocks = (ms: number): ((runner: TransactionRunner) => TransactionRunner) =>
  interceptTransactions((tx) => ({
    accounts: {
      find: (id) => tx.accounts.find(id),
      ensureExists: (id) => tx.accounts.ensureExists(id),
      save: (account) => tx.accounts.save(account),
      lock: async (id) => {
        const account = await tx.accounts.lock(id);
        await new Promise((resolve) => setTimeout(resolve, ms));
        return account;
      },
    },
  }));

export const newAccountId = (): string => `acct-${randomUUID()}`;
export const newKey = (): string => randomUUID();

/** POST with an Idempotency-Key, returning status, headers and the parsed body. */
export async function post(
  app: FastifyInstance,
  url: string,
  body: unknown,
  key: string | null = newKey(),
): Promise<{ status: number; body: Record<string, unknown>; raw: string; replayed: boolean }> {
  const response = await app.inject({
    method: 'POST',
    url,
    headers: key === null ? {} : { 'idempotency-key': key },
    ...(body === undefined ? {} : { payload: body as Record<string, unknown> }),
  });
  return {
    status: response.statusCode,
    body: response.json<Record<string, unknown>>(),
    raw: response.body,
    replayed: response.headers['idempotent-replayed'] === 'true',
  };
}

export async function fundedAccount(app: FastifyInstance, amount: number): Promise<string> {
  const id = newAccountId();
  const { status } = await post(app, `/accounts/${id}/credits`, { amount });
  expect(status).toBe(201);
  return id;
}

export async function countRows(pool: pg.Pool, sql: string, params: unknown[]): Promise<number> {
  const { rows } = await pool.query<{ count: number }>(`SELECT count(*)::int AS count FROM (${sql}) AS t`, params);
  return rows[0]?.count ?? 0;
}

/**
 * The ledger invariant, checked against the whole database: every
 * account's balance equals the sum of its ledger entries, its held amount
 * equals the sum of its active reservations, and its last entry's
 * balance_after is its balance.
 */
export async function expectLedgerConsistent(pool: pg.Pool): Promise<void> {
  const { rows: discrepancies } = await pool.query('SELECT * FROM account_discrepancies');
  expect(discrepancies).toEqual([]);

  const { rows: staleSnapshots } = await pool.query(`
    SELECT a.id FROM accounts a
    JOIN LATERAL (
      SELECT balance_after FROM ledger_entries e WHERE e.account_id = a.id ORDER BY e.id DESC LIMIT 1
    ) last ON true
    WHERE last.balance_after <> a.balance`);
  expect(staleSnapshots).toEqual([]);
}
