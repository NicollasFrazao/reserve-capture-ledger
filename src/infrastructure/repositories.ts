import type {
  AccountRepository,
  IdempotencyRecord,
  IdempotencyRepository,
  LedgerRepository,
  ReservationRepository,
} from '../application/ports.js';
import type { StoredOutcome } from '../application/idempotency.js';
import { Account } from '../domain/account.js';
import type { LedgerEntryKind, LedgerEntryView, NewLedgerEntry } from '../domain/ledger-entry.js';
import { Money } from '../domain/money.js';
import { Reservation, type ReservationStatus } from '../domain/reservation.js';
import type { Queryable } from './queryable.js';

interface AccountRow {
  id: string;
  balance: number;
  held: number;
}

function toAccount(row: AccountRow): Account {
  return Account.restore({
    id: row.id,
    balance: Money.of(row.balance),
    held: Money.of(row.held),
  });
}

/** Accounts over the `accounts` table. `lock` is `SELECT ... FOR UPDATE`. */
export class PgAccountRepository implements AccountRepository {
  /** @param db - The pool, or the client of the current transaction. */
  constructor(private readonly db: Queryable) {}

  /** {@inheritDoc AccountRepository.find} */
  async find(id: string): Promise<Account | null> {
    const { rows } = await this.db.query<AccountRow>(
      'SELECT id, balance, held FROM accounts WHERE id = $1',
      [id],
    );

    return rows[0] ? toAccount(rows[0]) : null;
  }

  /** {@inheritDoc AccountRepository.lock} */
  async lock(id: string): Promise<Account | null> {
    const { rows } = await this.db.query<AccountRow>(
      'SELECT id, balance, held FROM accounts WHERE id = $1 FOR UPDATE',
      [id],
    );

    return rows[0] ? toAccount(rows[0]) : null;
  }

  /** {@inheritDoc AccountRepository.ensureExists} */
  async ensureExists(id: string): Promise<void> {
    await this.db.query(
      'INSERT INTO accounts (id) VALUES ($1) ON CONFLICT (id) DO NOTHING',
      [id],
    );
  }

  /** {@inheritDoc AccountRepository.save} */
  async save(account: Account): Promise<void> {
    await this.db.query(
      'UPDATE accounts SET balance = $2, held = $3, updated_at = now() WHERE id = $1',
      [
        account.id,
        account.balance.units,
        account.held.units,
      ],
    );
  }
}

interface ReservationRow {
  id: string;
  account_id: string;
  amount: number;
  status: ReservationStatus;
  captured_amount: number | null;
  expires_at: Date;
  created_at: Date;
  finalized_at: Date | null;
}

const RESERVATION_COLUMNS =
  'id, account_id, amount, status, captured_amount, expires_at, created_at, finalized_at';

function toReservation(row: ReservationRow): Reservation {
  return Reservation.restore({
    id: row.id,
    accountId: row.account_id,
    amount: Money.of(row.amount),
    status: row.status,
    capturedAmount: row.captured_amount === null ? null : Money.of(row.captured_amount),
    expiresAt: row.expires_at,
    createdAt: row.created_at,
    finalizedAt: row.finalized_at,
  });
}

/** Reservations over the `reservations` table; the database refuses any change to a final one. */
export class PgReservationRepository implements ReservationRepository {
  /** @param db - The pool, or the client of the current transaction. */
  constructor(private readonly db: Queryable) {}

  /** {@inheritDoc ReservationRepository.find} */
  async find(id: string): Promise<Reservation | null> {
    const { rows } = await this.db.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id = $1`,
      [id],
    );

    return rows[0] ? toReservation(rows[0]) : null;
  }

  /** {@inheritDoc ReservationRepository.lock} */
  async lock(id: string): Promise<Reservation | null> {
    const { rows } = await this.db.query<ReservationRow>(
      `SELECT ${RESERVATION_COLUMNS} FROM reservations WHERE id = $1 FOR UPDATE`,
      [id],
    );

    return rows[0] ? toReservation(rows[0]) : null;
  }

  /** {@inheritDoc ReservationRepository.insert} */
  async insert(reservation: Reservation): Promise<void> {
    await this.db.query(
      `INSERT INTO reservations (id, account_id, amount, status, expires_at, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        reservation.id,
        reservation.accountId,
        reservation.amount.units,
        reservation.status,
        reservation.expiresAt,
        reservation.createdAt,
      ],
    );
  }

  /** {@inheritDoc ReservationRepository.save} */
  async save(reservation: Reservation): Promise<void> {
    await this.db.query(
      'UPDATE reservations SET status = $2, captured_amount = $3, finalized_at = $4 WHERE id = $1',
      [
        reservation.id,
        reservation.status,
        reservation.capturedAmount?.units ?? null,
        reservation.finalizedAt,
      ],
    );
  }

  /** {@inheritDoc ReservationRepository.findDueIds} */
  async findDueIds(
    now: Date,
    limit: number,
  ): Promise<string[]> {
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM reservations
       WHERE status = 'reserved' AND expires_at <= $1
       ORDER BY expires_at
       LIMIT $2`,
      [
        now,
        limit,
      ],
    );

    return rows.map((row) => row.id);
  }
}

interface LedgerEntryRow {
  id: number;
  account_id: string;
  kind: LedgerEntryKind;
  amount: number;
  balance_after: number;
  reservation_id: string | null;
  created_at: Date;
}

/** The ledger over the append-only `ledger_entries` table. */
export class PgLedgerRepository implements LedgerRepository {
  /** @param db - The pool, or the client of the current transaction. */
  constructor(private readonly db: Queryable) {}

  /** {@inheritDoc LedgerRepository.append} */
  async append(entry: NewLedgerEntry): Promise<LedgerEntryView> {
    const { rows } = await this.db.query<LedgerEntryRow>(
      `INSERT INTO ledger_entries (account_id, kind, amount, balance_after, reservation_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, account_id, kind, amount, balance_after, reservation_id, created_at`,
      [
        entry.accountId,
        entry.kind,
        entry.amount,
        entry.balanceAfter,
        entry.reservationId,
      ],
    );

    const row = rows[0];

    if (!row) {
      throw new Error('INSERT ... RETURNING returned no row');
    }

    return {
      id: row.id,
      accountId: row.account_id,
      kind: row.kind,
      amount: row.amount,
      balanceAfter: row.balance_after,
      reservationId: row.reservation_id,
      createdAt: row.created_at.toISOString(),
    };
  }
}

/** Idempotency keys over the `idempotency_keys` table, claimed with `INSERT ... ON CONFLICT DO NOTHING`. */
export class PgIdempotencyRepository implements IdempotencyRepository {
  /** @param db - The pool, or the client of the current transaction. */
  constructor(private readonly db: Queryable) {}

  /** {@inheritDoc IdempotencyRepository.claim} */
  async claim(
    key: string,
    operation: string,
    fingerprint: string,
  ): Promise<boolean> {
    const { rowCount } = await this.db.query(
      `INSERT INTO idempotency_keys (key, operation, fingerprint) VALUES ($1, $2, $3)
       ON CONFLICT (key) DO NOTHING`,
      [
        key,
        operation,
        fingerprint,
      ],
    );

    return rowCount === 1;
  }

  /** {@inheritDoc IdempotencyRepository.find} */
  async find(key: string): Promise<IdempotencyRecord | null> {
    const { rows } = await this.db.query<IdempotencyRecord>(
      'SELECT operation, fingerprint, outcome FROM idempotency_keys WHERE key = $1',
      [key],
    );

    return rows[0] ?? null;
  }

  /** {@inheritDoc IdempotencyRepository.complete} */
  async complete(
    key: string,
    outcome: StoredOutcome,
  ): Promise<void> {
    await this.db.query(
      'UPDATE idempotency_keys SET outcome = $2 WHERE key = $1',
      [
        key,
        JSON.stringify(outcome),
      ],
    );
  }
}
