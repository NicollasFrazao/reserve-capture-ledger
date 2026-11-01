import { randomUUID } from 'node:crypto';
import type { Account, AccountView } from '../domain/account.js';
import { AccountNotFound, LedgerError, ReservationNotFound } from '../domain/errors.js';
import type { LedgerEntryView } from '../domain/ledger-entry.js';
import { Money } from '../domain/money.js';
import { Reservation, type ReservationView } from '../domain/reservation.js';
import { type Clock, systemClock } from './clock.js';
import { IdempotencyKeyConflict, InvalidTtl } from './errors.js';
import { type Execution, fingerprint, type IdempotentRequest, type Outcome } from './idempotency.js';
import type { Transaction, TransactionRunner } from './ports.js';

export interface CreditResult {
  account: AccountView;
  entry: LedgerEntryView;
}

export interface ReserveResult {
  reservation: ReservationView;
  account: AccountView;
}

export interface CaptureResult {
  reservation: ReservationView;
  account: AccountView;
  entry: LedgerEntryView;
}

export interface ReleaseResult {
  reservation: ReservationView;
  account: AccountView;
}

export interface LedgerServiceOptions {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
}

const DEFAULT_OPTIONS: LedgerServiceOptions = { defaultTtlSeconds: 15 * 60, maxTtlSeconds: 24 * 60 * 60 };

/**
 * The use cases. Every write runs in one database transaction that also
 * claims the idempotency key and stores the outcome, so an operation and
 * the record that it happened commit or roll back together.
 *
 * Lock order, the same in every write: idempotency key, then account row,
 * then reservation row. A fixed order is what rules out deadlocks.
 */
export class LedgerService {
  private readonly options: LedgerServiceOptions;

  constructor(
    private readonly db: TransactionRunner,
    private readonly clock: Clock = systemClock,
    options: Partial<LedgerServiceOptions> = {},
  ) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Adds credits to an account, opening it on its first top-up. */
  credit(input: { accountId: string; amount: number; idempotencyKey: string }): Promise<Execution<CreditResult>> {
    const amount = Money.positive(input.amount);
    const request = { operation: 'credit', accountId: input.accountId, amount: amount.units };

    return this.idempotent(input.idempotencyKey, request, async (tx) => {
      await tx.accounts.ensureExists(input.accountId);
      const account = await this.lockAccount(tx, input.accountId);
      account.credit(amount);
      await tx.accounts.save(account);
      const entry = await tx.ledger.append({
        accountId: account.id,
        kind: 'credit',
        amount: amount.units,
        balanceAfter: account.balance.units,
        reservationId: null,
      });
      return { account: account.toView(), entry };
    });
  }

  /** Holds `amount` of the available balance, or fails with InsufficientFunds. */
  reserve(input: {
    accountId: string;
    amount: number;
    ttlSeconds?: number | undefined;
    idempotencyKey: string;
  }): Promise<Execution<ReserveResult>> {
    const amount = Money.positive(input.amount);
    const ttlSeconds = input.ttlSeconds ?? this.options.defaultTtlSeconds;
    if (!Number.isSafeInteger(ttlSeconds) || ttlSeconds < 1 || ttlSeconds > this.options.maxTtlSeconds) {
      throw new InvalidTtl(ttlSeconds, this.options.maxTtlSeconds);
    }
    const request = { operation: 'reserve', accountId: input.accountId, amount: amount.units, ttlSeconds };

    return this.idempotent(input.idempotencyKey, request, async (tx) => {
      const account = await this.lockAccount(tx, input.accountId);
      account.hold(amount);
      const reservation = Reservation.create({
        id: randomUUID(),
        accountId: account.id,
        amount,
        now: this.clock.now(),
        ttlSeconds,
      });
      await tx.reservations.insert(reservation);
      await tx.accounts.save(account);
      return { reservation: reservation.toView(), account: account.toView() };
    });
  }

  /** Debits `amount` (at most what was reserved) and releases the rest of the hold. */
  capture(input: { reservationId: string; amount: number; idempotencyKey: string }): Promise<Execution<CaptureResult>> {
    const amount = Money.positive(input.amount);
    const request = { operation: 'capture', reservationId: input.reservationId, amount: amount.units };

    return this.idempotent(input.idempotencyKey, request, async (tx) => {
      const { account, reservation } = await this.lockReservation(tx, input.reservationId);
      reservation.capture(amount, this.clock.now());
      account.settleHold(reservation.amount, amount);
      await tx.reservations.save(reservation);
      await tx.accounts.save(account);
      const entry = await tx.ledger.append({
        accountId: account.id,
        kind: 'capture',
        amount: -amount.units,
        balanceAfter: account.balance.units,
        reservationId: reservation.id,
      });
      return { reservation: reservation.toView(), account: account.toView(), entry };
    });
  }

  /** Cancels the hold; nothing is debited. */
  release(input: { reservationId: string; idempotencyKey: string }): Promise<Execution<ReleaseResult>> {
    const request = { operation: 'release', reservationId: input.reservationId };

    return this.idempotent(input.idempotencyKey, request, async (tx) => {
      const { account, reservation } = await this.lockReservation(tx, input.reservationId);
      reservation.release(this.clock.now());
      account.releaseHold(reservation.amount);
      await tx.reservations.save(reservation);
      await tx.accounts.save(account);
      return { reservation: reservation.toView(), account: account.toView() };
    });
  }

  async getAccount(accountId: string): Promise<AccountView> {
    const account = await this.db.transaction((tx) => tx.accounts.find(accountId));
    if (account === null) throw new AccountNotFound(accountId);
    return account.toView();
  }

  /**
   * Expires reservations whose time has passed and frees their holds.
   * Each one is expired in its own short transaction, so the sweep never
   * holds many account locks at once, and several sweeps can run side by
   * side: whoever locks a reservation second sees it is no longer due.
   * Returns how many reservations this call expired.
   */
  async expireDue(limit = 100): Promise<number> {
    const now = this.clock.now();
    const dueIds = await this.db.transaction((tx) => tx.reservations.findDueIds(now, limit));
    let expired = 0;

    for (const id of dueIds) {
      const done = await this.db.transaction(async (tx) => {
        const { account, reservation } = await this.lockReservation(tx, id);
        if (!reservation.isDue(now)) return false;
        reservation.expire(now);
        account.releaseHold(reservation.amount);
        await tx.reservations.save(reservation);
        await tx.accounts.save(account);
        return true;
      });
      if (done) expired += 1;
    }
    return expired;
  }

  /**
   * Claim the key, run the operation, store its outcome; or, if the key
   * exists, return the stored outcome without running anything.
   *
   * Business failures (LedgerError) are outcomes too: they are stored and
   * replayed, and the savepoint discards anything the failed operation
   * wrote. Any other error aborts the transaction, the key included, so
   * the client can retry it.
   */
  private idempotent<T>(
    key: string,
    request: IdempotentRequest,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<Execution<T>> {
    const requestFingerprint = fingerprint(request);

    return this.db.transaction(async (tx): Promise<Execution<T>> => {
      const claimed = await tx.idempotency.claim(key, request.operation, requestFingerprint);

      if (!claimed) {
        const stored = await tx.idempotency.find(key);
        if (stored?.outcome == null) throw new Error(`idempotency key ${key} exists without an outcome`);
        if (stored.fingerprint !== requestFingerprint) {
          return { outcome: { ok: false, error: new IdempotencyKeyConflict(key).toJSON() }, replayed: false };
        }
        return { outcome: stored.outcome as Outcome<T>, replayed: true };
      }

      let outcome: Outcome<T>;
      try {
        outcome = { ok: true, value: await tx.savepoint(() => work(tx)) };
      } catch (error) {
        if (!(error instanceof LedgerError)) throw error;
        outcome = { ok: false, error: error.toJSON() };
      }
      await tx.idempotency.complete(key, outcome);
      return { outcome, replayed: false };
    });
  }

  private async lockAccount(tx: Transaction, accountId: string): Promise<Account> {
    const account = await tx.accounts.lock(accountId);
    if (account === null) throw new AccountNotFound(accountId);
    return account;
  }

  /** Locks the reservation's account first, then the reservation, then re-reads it. */
  private async lockReservation(
    tx: Transaction,
    reservationId: string,
  ): Promise<{ account: Account; reservation: Reservation }> {
    const unlocked = await tx.reservations.find(reservationId);
    if (unlocked === null) throw new ReservationNotFound(reservationId);
    const account = await this.lockAccount(tx, unlocked.accountId);
    const reservation = await tx.reservations.lock(reservationId);
    if (reservation === null) throw new ReservationNotFound(reservationId);
    return { account, reservation };
  }
}
