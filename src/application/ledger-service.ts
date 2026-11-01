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

const SECONDS_PER_MINUTE = 60;
const MINUTES_PER_HOUR = 60;
const SECONDS_PER_HOUR = MINUTES_PER_HOUR * SECONDS_PER_MINUTE;
const DEFAULT_TTL_MINUTES = 15;
const MAX_TTL_HOURS = 24;
const DEFAULT_SWEEP_BATCH = 100;

/** A top-up request. */
export interface CreditInput {
  accountId: string;
  /** Minor units; must be positive. */
  amount: number;
  idempotencyKey: string;
}

/** A request to hold part of an account's available balance. */
export interface ReserveInput {
  accountId: string;
  /** Minor units; must be positive. */
  amount: number;
  /** Seconds until the hold expires; the service default when omitted. */
  ttlSeconds?: number | undefined;
  idempotencyKey: string;
}

/** A request to charge part (or all) of a reservation. */
export interface CaptureInput {
  reservationId: string;
  /** Minor units; positive and at most the reserved amount. */
  amount: number;
  idempotencyKey: string;
}

/** A request to cancel a reservation. */
export interface ReleaseInput {
  reservationId: string;
  idempotencyKey: string;
}

/** The account after a top-up, and the ledger entry that records it. */
export interface CreditResult {
  account: AccountView;
  entry: LedgerEntryView;
}

/** The new reservation, and the account with its hold. */
export interface ReserveResult {
  reservation: ReservationView;
  account: AccountView;
}

/** The captured reservation, the account after the charge, and the ledger entry that records it. */
export interface CaptureResult {
  reservation: ReservationView;
  account: AccountView;
  entry: LedgerEntryView;
}

/** The released reservation, and the account with the hold lifted. */
export interface ReleaseResult {
  reservation: ReservationView;
  account: AccountView;
}

/** Tunables of {@link LedgerService}. */
export interface LedgerServiceOptions {
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
}

const DEFAULT_OPTIONS: LedgerServiceOptions = {
  defaultTtlSeconds: DEFAULT_TTL_MINUTES * SECONDS_PER_MINUTE,
  maxTtlSeconds: MAX_TTL_HOURS * SECONDS_PER_HOUR,
};

/**
 * The use cases: credit, reserve, capture, release, read, and the expiry sweep.
 *
 * @remarks
 * Every write runs in one database transaction that also claims the
 * idempotency key and stores the outcome, so an operation and the record that
 * it happened commit or roll back together.
 *
 * Lock order, the same in every write: idempotency key, then account row,
 * then reservation row. A fixed order is what rules out deadlocks.
 *
 * Writes resolve to an {@link Execution}: business rejections (the
 * {@link LedgerError} subclasses raised inside the transaction) come back as a
 * failed outcome, not as a rejected promise, because they are stored and
 * replayed like successes. Only invalid input, detected before anything is
 * written, is thrown.
 */
export class LedgerService {
  private readonly options: LedgerServiceOptions;

  /**
   * @param db - Opens the transactions every operation runs in.
   * @param clock - The current time; a fake one in tests.
   * @param options - Overrides of the default and maximum reservation lifetime.
   */
  constructor(
    private readonly db: TransactionRunner,
    private readonly clock: Clock = systemClock,
    options: Partial<LedgerServiceOptions> = {},
  ) {
    this.options = {
      ...DEFAULT_OPTIONS,
      ...options,
    };
  }

  /**
   * Adds credits to an account, opening it on its first top-up.
   *
   * @throws {@link InvalidAmount} when the amount is not a positive integer of minor units.
   */
  credit(input: CreditInput): Promise<Execution<CreditResult>> {
    const amount = Money.positive(input.amount);

    const request = {
      operation: 'credit',
      accountId: input.accountId,
      amount: amount.units,
    };

    return this.idempotent(
      input.idempotencyKey,
      request,
      async (tx) => {
        await tx.accounts.ensureExists(input.accountId);

        const account = await this.lockAccount(
          tx,
          input.accountId,
        );

        account.credit(amount);
        await tx.accounts.save(account);

        const entry = await tx.ledger.append({
          accountId: account.id,
          kind: 'credit',
          amount: amount.units,
          balanceAfter: account.balance.units,
          reservationId: null,
        });

        return {
          account: account.toView(),
          entry,
        };
      },
    );
  }

  /**
   * Holds `amount` of the available balance until it is captured, released or expires.
   *
   * @remarks
   * Fails with an `insufficient_funds` or `account_not_found` outcome.
   *
   * @throws {@link InvalidAmount} when the amount is not a positive integer of minor units.
   * @throws {@link InvalidTtl} when the lifetime is outside the allowed range.
   */
  reserve(input: ReserveInput): Promise<Execution<ReserveResult>> {
    const amount = Money.positive(input.amount);
    const ttlSeconds = this.validTtl(input.ttlSeconds);

    const request = {
      operation: 'reserve',
      accountId: input.accountId,
      amount: amount.units,
      ttlSeconds,
    };

    return this.idempotent(
      input.idempotencyKey,
      request,
      async (tx) => {
        const account = await this.lockAccount(
          tx,
          input.accountId,
        );

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

        return {
          reservation: reservation.toView(),
          account: account.toView(),
        };
      },
    );
  }

  /**
   * Debits `amount` (at most what was reserved) and releases the rest of the hold.
   *
   * @remarks
   * Fails with a `reservation_not_found`, `invalid_transition`,
   * `reservation_expired` or `capture_exceeds_reservation` outcome.
   *
   * @throws {@link InvalidAmount} when the amount is not a positive integer of minor units.
   */
  capture(input: CaptureInput): Promise<Execution<CaptureResult>> {
    const amount = Money.positive(input.amount);

    const request = {
      operation: 'capture',
      reservationId: input.reservationId,
      amount: amount.units,
    };

    return this.idempotent(
      input.idempotencyKey,
      request,
      async (tx) => {
        const {
          account,
          reservation,
        } = await this.lockReservation(
          tx,
          input.reservationId,
        );

        reservation.capture(
          amount,
          this.clock.now(),
        );

        account.settleHold(
          reservation.amount,
          amount,
        );

        await tx.reservations.save(reservation);
        await tx.accounts.save(account);

        const entry = await tx.ledger.append({
          accountId: account.id,
          kind: 'capture',
          amount: -amount.units,
          balanceAfter: account.balance.units,
          reservationId: reservation.id,
        });

        return {
          reservation: reservation.toView(),
          account: account.toView(),
          entry,
        };
      },
    );
  }

  /**
   * Cancels the hold; nothing is debited.
   *
   * @remarks
   * Fails with a `reservation_not_found` or `invalid_transition` outcome.
   */
  release(input: ReleaseInput): Promise<Execution<ReleaseResult>> {
    const request = {
      operation: 'release',
      reservationId: input.reservationId,
    };

    return this.idempotent(
      input.idempotencyKey,
      request,
      async (tx) => {
        const {
          account,
          reservation,
        } = await this.lockReservation(
          tx,
          input.reservationId,
        );

        reservation.release(this.clock.now());
        account.releaseHold(reservation.amount);
        await tx.reservations.save(reservation);
        await tx.accounts.save(account);

        return {
          reservation: reservation.toView(),
          account: account.toView(),
        };
      },
    );
  }

  /**
   * Reads an account's balance, held and available amounts.
   *
   * @throws {@link AccountNotFound} when no account has that id.
   */
  async getAccount(accountId: string): Promise<AccountView> {
    const account = await this.db.transaction((tx) => tx.accounts.find(accountId));

    if (account === null) {
      throw new AccountNotFound(accountId);
    }

    return account.toView();
  }

  /**
   * Expires reservations whose time has passed and frees their holds.
   *
   * @remarks
   * Each one is expired in its own short transaction, so the sweep never
   * holds many account locks at once, and several sweeps can run side by
   * side: whoever locks a reservation second sees it is no longer due.
   *
   * @param limit - The most reservations to look at in this call.
   *
   * @returns How many reservations this call expired.
   */
  async expireDue(limit = DEFAULT_SWEEP_BATCH): Promise<number> {
    const now = this.clock.now();

    const dueIds = await this.db.transaction((tx) => tx.reservations.findDueIds(
      now,
      limit,
    ));

    let expired = 0;

    for (const id of dueIds) {
      if (await this.db.transaction((tx) => this.expireOne(
        tx,
        id,
        now,
      ))) {
        expired += 1;
      }
    }

    return expired;
  }

  private async expireOne(
    tx: Transaction,
    reservationId: string,
    now: Date,
  ): Promise<boolean> {
    const {
      account,
      reservation,
    } = await this.lockReservation(
      tx,
      reservationId,
    );

    if (!reservation.isDue(now)) {
      return false;
    }

    reservation.expire(now);
    account.releaseHold(reservation.amount);
    await tx.reservations.save(reservation);
    await tx.accounts.save(account);

    return true;
  }

  /**
   * Claims the key, runs the operation and stores its outcome; or, if the key
   * exists, returns the stored outcome without running anything.
   *
   * Business failures (LedgerError) are outcomes too: they are stored and
   * replayed, and the savepoint discards anything the failed operation wrote.
   * Any other error aborts the transaction, the key included, so the client
   * can retry it.
   */
  private idempotent<T>(
    key: string,
    request: IdempotentRequest,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<Execution<T>> {
    const requestFingerprint = fingerprint(request);

    return this.db.transaction(async (tx): Promise<Execution<T>> => {
      const claimed = await tx.idempotency.claim(
        key,
        request.operation,
        requestFingerprint,
      );

      if (!claimed) {
        return this.replay(
          tx,
          key,
          requestFingerprint,
        );
      }

      const outcome = await this.run(
        tx,
        work,
      );

      await tx.idempotency.complete(
        key,
        outcome,
      );

      return {
        outcome,
        replayed: false,
      };
    });
  }

  private async run<T>(
    tx: Transaction,
    work: (tx: Transaction) => Promise<T>,
  ): Promise<Outcome<T>> {
    try {
      return {
        ok: true,
        value: await tx.savepoint(() => work(tx)),
      };
    } catch (error) {
      if (!(error instanceof LedgerError)) {
        throw error;
      }

      return {
        ok: false,
        error: error.toJSON(),
      };
    }
  }

  private async replay<T>(
    tx: Transaction,
    key: string,
    requestFingerprint: string,
  ): Promise<Execution<T>> {
    const stored = await tx.idempotency.find(key);

    // Claim, operation and outcome commit together, so a visible key always has an outcome.
    if (stored?.outcome == null) {
      throw new Error(`idempotency key ${key} exists without an outcome`);
    }

    if (stored.fingerprint !== requestFingerprint) {
      return {
        outcome: {
          ok: false,
          error: new IdempotencyKeyConflict(key).toJSON(),
        },
        replayed: false,
      };
    }

    return {
      outcome: stored.outcome as Outcome<T>,
      replayed: true,
    };
  }

  private validTtl(ttlSeconds: number | undefined): number {
    const ttl = ttlSeconds ?? this.options.defaultTtlSeconds;

    if (
      !Number.isSafeInteger(ttl)
      || ttl < 1
      || ttl > this.options.maxTtlSeconds
    ) {
      throw new InvalidTtl(
        ttl,
        this.options.maxTtlSeconds,
      );
    }

    return ttl;
  }

  private async lockAccount(
    tx: Transaction,
    accountId: string,
  ): Promise<Account> {
    const account = await tx.accounts.lock(accountId);

    if (account === null) {
      throw new AccountNotFound(accountId);
    }

    return account;
  }

  /** Locks the reservation's account first, then the reservation, then re-reads it. */
  private async lockReservation(
    tx: Transaction,
    reservationId: string,
  ): Promise<{
    account: Account;
    reservation: Reservation;
  }> {
    const unlocked = await tx.reservations.find(reservationId);

    if (unlocked === null) {
      throw new ReservationNotFound(reservationId);
    }

    const account = await this.lockAccount(
      tx,
      unlocked.accountId,
    );

    const reservation = await tx.reservations.lock(reservationId);

    if (reservation === null) {
      throw new ReservationNotFound(reservationId);
    }

    return {
      account,
      reservation,
    };
  }
}
