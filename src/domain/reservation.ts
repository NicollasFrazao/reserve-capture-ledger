import { CaptureExceedsReservation, InvalidTransition, ReservationExpired } from './errors.js';
import { Money } from './money.js';

/** Where a reservation is in its life. Only `reserved` is not final. */
export type ReservationStatus = 'reserved' | 'captured' | 'released' | 'expired';

const MILLISECONDS_PER_SECOND = 1000;

/** The only moves a reservation can make. Every final state is terminal. */
const TRANSITIONS: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> = {
  reserved: [
    'captured',
    'released',
    'expired',
  ],
  captured: [],
  released: [],
  expired: [],
};

/** Tells whether the state machine allows moving from `from` to `to`. */
export function canTransition(
  from: ReservationStatus,
  to: ReservationStatus,
): boolean {
  return TRANSITIONS[from].includes(to);
}

/** The stored state a {@link Reservation} is rebuilt from. */
export interface ReservationState {
  id: string;
  accountId: string;
  amount: Money;
  status: ReservationStatus;
  capturedAmount: Money | null;
  expiresAt: Date;
  createdAt: Date;
  finalizedAt: Date | null;
}

/** What it takes to place a new reservation. */
export interface NewReservation {
  id: string;
  accountId: string;
  amount: Money;
  now: Date;
  ttlSeconds: number;
}

/** The plain form of a reservation returned to clients. Amounts are minor units, dates ISO 8601. */
export interface ReservationView {
  id: string;
  accountId: string;
  amount: number;
  status: ReservationStatus;
  capturedAmount: number | null;
  releasedAmount: number | null;
  expiresAt: string;
  createdAt: string;
  finalizedAt: string | null;
}

/**
 * A hold on part of an account's balance, waiting to be captured (charged),
 * released (cancelled) or to expire.
 *
 * @remarks
 * The entity only decides; the matching change to the account's balance is
 * the caller's (see `LedgerService`), inside the same transaction.
 */
export class Reservation {
  private constructor(private state: ReservationState) {}

  /** Places a new reservation that expires `ttlSeconds` after `now`. */
  static create(input: NewReservation): Reservation {
    return new Reservation({
      id: input.id,
      accountId: input.accountId,
      amount: input.amount,
      status: 'reserved',
      capturedAmount: null,
      expiresAt: new Date(input.now.getTime() + input.ttlSeconds * MILLISECONDS_PER_SECOND),
      createdAt: input.now,
      finalizedAt: null,
    });
  }

  /** Rebuilds a reservation from stored state. */
  static restore(state: ReservationState): Reservation {
    return new Reservation({ ...state });
  }

  /** The reservation's id (a UUID). */
  get id(): string {
    return this.state.id;
  }

  /** The account whose balance is held. */
  get accountId(): string {
    return this.state.accountId;
  }

  /** The amount held when the reservation was placed. */
  get amount(): Money {
    return this.state.amount;
  }

  /** Where the reservation is in its life. */
  get status(): ReservationStatus {
    return this.state.status;
  }

  /** The amount charged, once captured; null otherwise. */
  get capturedAmount(): Money | null {
    return this.state.capturedAmount;
  }

  /** After this instant the reservation can no longer be captured. */
  get expiresAt(): Date {
    return this.state.expiresAt;
  }

  /** When the reservation was placed. */
  get createdAt(): Date {
    return this.state.createdAt;
  }

  /** When the reservation reached a final state; null while reserved. */
  get finalizedAt(): Date | null {
    return this.state.finalizedAt;
  }

  /** The part of the hold that went back to the account once final; null while reserved. */
  get releasedAmount(): Money | null {
    if (this.state.status === 'reserved') {
      return null;
    }

    return this.state.amount.minus(this.state.capturedAmount ?? Money.zero);
  }

  /** Tells whether the reservation is still active and its expiry time has passed. */
  isDue(now: Date): boolean {
    return this.state.status === 'reserved' && this.state.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Charges `amount` (at most the reserved amount) and gives the rest back.
   *
   * @remarks
   * A reservation past its expiry can no longer be captured, even if the
   * sweep has not reached it yet.
   *
   * @throws {@link InvalidTransition} when the reservation is already final.
   * @throws {@link ReservationExpired} when the expiry time has passed.
   * @throws {@link CaptureExceedsReservation} when `amount` is more than was reserved.
   */
  capture(
    amount: Money,
    now: Date,
  ): void {
    this.assertCanMoveTo('captured');

    if (this.isDue(now)) {
      throw new ReservationExpired(
        this.id,
        this.state.expiresAt,
      );
    }

    if (amount.isGreaterThan(this.state.amount)) {
      throw new CaptureExceedsReservation(
        this.id,
        amount.units,
        this.state.amount.units,
      );
    }

    this.state = {
      ...this.state,
      status: 'captured',
      capturedAmount: amount,
      finalizedAt: now,
    };
  }

  /**
   * Cancels the hold. Allowed until the reservation is final, even past its expiry time.
   *
   * @throws {@link InvalidTransition} when the reservation is already final.
   */
  release(now: Date): void {
    this.assertCanMoveTo('released');

    this.state = {
      ...this.state,
      status: 'released',
      finalizedAt: now,
    };
  }

  /**
   * Marks the reservation expired; called by the sweep once its time has passed.
   *
   * @throws {@link InvalidTransition} when the reservation is already final.
   * @throws {@link RangeError} when the expiry time has not passed, which would be a bug in the sweep.
   */
  expire(now: Date): void {
    this.assertCanMoveTo('expired');

    if (!this.isDue(now)) {
      throw new RangeError(`reservation ${this.id} is not due until ${this.state.expiresAt.toISOString()}`);
    }

    this.state = {
      ...this.state,
      status: 'expired',
      finalizedAt: now,
    };
  }

  /** Returns the plain form sent to clients. */
  toView(): ReservationView {
    return {
      id: this.id,
      accountId: this.accountId,
      amount: this.amount.units,
      status: this.status,
      capturedAmount: this.capturedAmount?.units ?? null,
      releasedAmount: this.releasedAmount?.units ?? null,
      expiresAt: this.expiresAt.toISOString(),
      createdAt: this.createdAt.toISOString(),
      finalizedAt: this.finalizedAt?.toISOString() ?? null,
    };
  }

  private assertCanMoveTo(to: ReservationStatus): void {
    if (!canTransition(
      this.state.status,
      to,
    )) {
      throw new InvalidTransition(
        this.id,
        this.state.status,
        to,
      );
    }
  }
}
