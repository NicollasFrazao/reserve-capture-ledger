/**
 * Base class of every expected, business-level failure. Each one has a
 * stable machine-readable code; the HTTP adapter maps codes to status codes.
 */
export abstract class LedgerError extends Error {
  abstract readonly code: string;

  constructor(
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }

  toJSON(): ErrorBody {
    return { code: this.code, message: this.message, details: { ...this.details } };
  }
}

export interface ErrorBody {
  code: string;
  message: string;
  details: Record<string, string | number>;
}

export class InvalidAmount extends LedgerError {
  readonly code = 'invalid_amount';

  constructor(value: number, reason: string) {
    super(`invalid amount ${value}: ${reason}`, { value });
  }
}

export class AccountNotFound extends LedgerError {
  readonly code = 'account_not_found';

  constructor(accountId: string) {
    super(`account ${accountId} does not exist`, { accountId });
  }
}

export class ReservationNotFound extends LedgerError {
  readonly code = 'reservation_not_found';

  constructor(reservationId: string) {
    super(`reservation ${reservationId} does not exist`, { reservationId });
  }
}

export class InsufficientFunds extends LedgerError {
  readonly code = 'insufficient_funds';

  constructor(accountId: string, requested: number, available: number) {
    super(`account ${accountId} has ${available} available, ${requested} requested`, {
      accountId,
      requested,
      available,
    });
  }
}

export class InvalidTransition extends LedgerError {
  readonly code = 'invalid_transition';

  constructor(reservationId: string, from: string, to: string) {
    super(`reservation ${reservationId} cannot go from ${from} to ${to}`, { reservationId, from, to });
  }
}

export class ReservationExpired extends LedgerError {
  readonly code = 'reservation_expired';

  constructor(reservationId: string, expiresAt: Date) {
    super(`reservation ${reservationId} expired at ${expiresAt.toISOString()}`, {
      reservationId,
      expiresAt: expiresAt.toISOString(),
    });
  }
}

export class CaptureExceedsReservation extends LedgerError {
  readonly code = 'capture_exceeds_reservation';

  constructor(reservationId: string, requested: number, reserved: number) {
    super(`cannot capture ${requested} from reservation ${reservationId} of ${reserved}`, {
      reservationId,
      requested,
      reserved,
    });
  }
}
