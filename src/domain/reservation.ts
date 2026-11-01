import { CaptureExceedsReservation, InvalidTransition, ReservationExpired } from './errors.js';
import { Money } from './money.js';

export type ReservationStatus = 'reserved' | 'captured' | 'released' | 'expired';

/** The only moves a reservation can make. Every final state is terminal. */
const TRANSITIONS: Readonly<Record<ReservationStatus, readonly ReservationStatus[]>> = {
  reserved: ['captured', 'released', 'expired'],
  captured: [],
  released: [],
  expired: [],
};

export function canTransition(from: ReservationStatus, to: ReservationStatus): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface ReservationProps {
  id: string;
  accountId: string;
  amount: Money;
  status: ReservationStatus;
  capturedAmount: Money | null;
  expiresAt: Date;
  createdAt: Date;
  finalizedAt: Date | null;
}

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
 */
export class Reservation {
  private constructor(private props: ReservationProps) {}

  static create(input: {
    id: string;
    accountId: string;
    amount: Money;
    now: Date;
    ttlSeconds: number;
  }): Reservation {
    return new Reservation({
      id: input.id,
      accountId: input.accountId,
      amount: input.amount,
      status: 'reserved',
      capturedAmount: null,
      expiresAt: new Date(input.now.getTime() + input.ttlSeconds * 1000),
      createdAt: input.now,
      finalizedAt: null,
    });
  }

  static restore(props: ReservationProps): Reservation {
    return new Reservation({ ...props });
  }

  get id(): string {
    return this.props.id;
  }

  get accountId(): string {
    return this.props.accountId;
  }

  get amount(): Money {
    return this.props.amount;
  }

  get status(): ReservationStatus {
    return this.props.status;
  }

  get capturedAmount(): Money | null {
    return this.props.capturedAmount;
  }

  get expiresAt(): Date {
    return this.props.expiresAt;
  }

  get createdAt(): Date {
    return this.props.createdAt;
  }

  get finalizedAt(): Date | null {
    return this.props.finalizedAt;
  }

  /** The part of the hold that went back to the account, once final. */
  get releasedAmount(): Money | null {
    if (this.props.status === 'reserved') return null;
    return this.props.amount.minus(this.props.capturedAmount ?? Money.zero);
  }

  isDue(now: Date): boolean {
    return this.props.status === 'reserved' && this.props.expiresAt.getTime() <= now.getTime();
  }

  /**
   * Charges `amount` (at most the reserved amount) and gives the rest back.
   * A reservation past its expiry can no longer be captured, even if the
   * sweep has not reached it yet.
   */
  capture(amount: Money, now: Date): void {
    this.assertCanMoveTo('captured');
    if (this.isDue(now)) throw new ReservationExpired(this.id, this.props.expiresAt);
    if (amount.isGreaterThan(this.props.amount)) {
      throw new CaptureExceedsReservation(this.id, amount.units, this.props.amount.units);
    }
    this.props = { ...this.props, status: 'captured', capturedAmount: amount, finalizedAt: now };
  }

  /** Cancels the hold. Allowed until the reservation is final, even past expiry. */
  release(now: Date): void {
    this.assertCanMoveTo('released');
    this.props = { ...this.props, status: 'released', finalizedAt: now };
  }

  /** Called by the sweep once the expiry time has passed. */
  expire(now: Date): void {
    this.assertCanMoveTo('expired');
    if (!this.isDue(now)) {
      throw new Error(`reservation ${this.id} is not due until ${this.props.expiresAt.toISOString()}`);
    }
    this.props = { ...this.props, status: 'expired', finalizedAt: now };
  }

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
    if (!canTransition(this.props.status, to)) {
      throw new InvalidTransition(this.id, this.props.status, to);
    }
  }
}
