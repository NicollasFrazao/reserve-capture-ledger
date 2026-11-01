import pg from 'pg';
import type { Transaction, TransactionRunner } from '../application/ports.js';
import {
  PgAccountRepository,
  PgIdempotencyRepository,
  PgLedgerRepository,
  PgReservationRepository,
} from './repositories.js';

/** Anything that can run a query: the pool or a checked-out client. */
export type Queryable = Pick<pg.PoolClient, 'query'>;

/**
 * bigint columns come back from pg as strings, because they can exceed
 * Number.MAX_SAFE_INTEGER. Amounts here never do, so they are parsed into
 * numbers, and a value that would lose precision fails loudly instead.
 */
function parseInt8(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new RangeError(`bigint ${value} is outside the safe integer range`);
  return parsed;
}

const types: pg.CustomTypesConfig = {
  getTypeParser: (oid, format) =>
    oid === pg.types.builtins.INT8 && format !== 'binary'
      ? parseInt8
      : (pg.types.getTypeParser(oid, format) as unknown),
};

export function createPool(connectionString: string, max = 10): pg.Pool {
  const pool = new pg.Pool({ connectionString, max, types });
  // An idle client losing its connection must not crash the process; the
  // pool discards it and the next checkout opens a new one.
  pool.on('error', (error) => {
    console.error('idle database client error', error);
  });
  return pool;
}

class PgTransaction implements Transaction {
  readonly accounts: PgAccountRepository;
  readonly reservations: PgReservationRepository;
  readonly ledger: PgLedgerRepository;
  readonly idempotency: PgIdempotencyRepository;

  constructor(private readonly client: pg.PoolClient) {
    this.accounts = new PgAccountRepository(client);
    this.reservations = new PgReservationRepository(client);
    this.ledger = new PgLedgerRepository(client);
    this.idempotency = new PgIdempotencyRepository(client);
  }

  async savepoint<T>(work: () => Promise<T>): Promise<T> {
    await this.client.query('SAVEPOINT operation');
    try {
      const result = await work();
      await this.client.query('RELEASE SAVEPOINT operation');
      return result;
    } catch (error) {
      await this.client.query('ROLLBACK TO SAVEPOINT operation');
      throw error;
    }
  }
}

/** One pooled connection per transaction, at the default READ COMMITTED level. */
export class PgTransactionRunner implements TransactionRunner {
  constructor(private readonly pool: pg.Pool) {}

  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let broken = false;
    try {
      await client.query('BEGIN');
      const result = await work(new PgTransaction(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      try {
        await client.query('ROLLBACK');
      } catch {
        broken = true;
      }
      throw error;
    } finally {
      // A client whose ROLLBACK failed is in an unknown state: destroy it.
      client.release(broken);
    }
  }
}
