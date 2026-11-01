import pg from 'pg';
import type { Transaction, TransactionRunner } from '../application/ports.js';
import {
  PgAccountRepository,
  PgIdempotencyRepository,
  PgLedgerRepository,
  PgReservationRepository,
} from './repositories.js';

const DEFAULT_POOL_SIZE = 10;

/**
 * Parses a bigint column into a number.
 *
 * @remarks
 * pg returns bigint as a string, because it can exceed
 * `Number.MAX_SAFE_INTEGER`. Amounts here never do, so they are parsed into
 * numbers, and a value that would lose precision fails loudly instead.
 *
 * @throws {@link RangeError} when the value is outside the safe integer range.
 */
function parseInt8(value: string): number {
  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`bigint ${value} is outside the safe integer range`);
  }

  return parsed;
}

const types: pg.CustomTypesConfig = {
  getTypeParser(
    oid,
    format,
  ) {
    if (
      oid === pg.types.builtins.INT8
      && format !== 'binary'
    ) {
      return parseInt8;
    }

    return pg.types.getTypeParser(
      oid,
      format,
    ) as unknown;
  },
};

/**
 * Creates the connection pool, with bigint columns parsed as numbers.
 *
 * @param connectionString - A `postgres://` URL.
 * @param max - The most connections the pool opens.
 */
export function createPool(
  connectionString: string,
  max = DEFAULT_POOL_SIZE,
): pg.Pool {
  const pool = new pg.Pool({
    connectionString,
    max,
    types,
  });

  // An idle client losing its connection must not crash the process; the
  // pool discards it and the next checkout opens a new one.
  pool.on(
    'error',
    (error) => {
      console.error(
        'idle database client error',
        error,
      );
    },
  );

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

/** Runs each transaction on its own pooled connection, at PostgreSQL's default READ COMMITTED level. */
export class PgTransactionRunner implements TransactionRunner {
  /** @param pool - Where connections are checked out from. */
  constructor(private readonly pool: pg.Pool) {}

  /**
   * Runs `work` between BEGIN and COMMIT, and rolls back if it throws.
   *
   * @throws whatever `work` throws, after the rollback.
   */
  async transaction<T>(work: (tx: Transaction) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    let isBroken = false;

    try {
      await client.query('BEGIN');
      const result = await work(new PgTransaction(client));

      await client.query('COMMIT');

      return result;
    } catch (error) {
      isBroken = await this.rollback(client);

      throw error;
    } finally {
      // A client whose ROLLBACK failed is in an unknown state: destroy it.
      client.release(isBroken);
    }
  }

  /** Rolls back; resolves to true when even that failed and the connection must be discarded. */
  private async rollback(client: pg.PoolClient): Promise<boolean> {
    try {
      await client.query('ROLLBACK');

      return false;
    } catch {
      return true;
    }
  }
}
