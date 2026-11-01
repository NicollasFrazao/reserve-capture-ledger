/**
 * The serializable form of a {@link LedgerError}: what a client receives and
 * what an idempotency record stores.
 */
export interface ErrorBody {
  code: string;
  message: string;
  details: Record<string, string | number>;
}

/**
 * Base class of every expected, business-level failure.
 *
 * @remarks
 * Each subclass has a stable machine-readable `code`. The application layer
 * stores these failures as outcomes (so a retry replays them) and the HTTP
 * adapter maps the code to a status. Anything that is not a `LedgerError` is
 * treated as unexpected and is never stored.
 */
export abstract class LedgerError extends Error {
  abstract readonly code: string;

  /**
   * @param message - Human-readable explanation, safe to show to a client.
   * @param details - Structured values a client can act on without parsing the message.
   */
  constructor(
    message: string,
    readonly details: Readonly<Record<string, string | number>> = {},
  ) {
    super(message);
    this.name = new.target.name;
  }

  /** Returns the plain form sent to clients and stored with idempotency keys. */
  toJSON(): ErrorBody {
    return {
      code: this.code,
      message: this.message,
      details: { ...this.details },
    };
  }
}

/** An amount that is not a safe, non-negative integer of minor units, or zero where a positive one is required. */
export class InvalidAmount extends LedgerError {
  readonly code = 'invalid_amount';

  /**
   * @param value - The rejected value.
   * @param reason - Which rule it broke.
   */
  constructor(
    value: number,
    reason: string,
  ) {
    super(
      `invalid amount ${value}: ${reason}`,
      { value },
    );
  }
}

/** No account has the given id. Accounts are opened by their first credit. */
export class AccountNotFound extends LedgerError {
  readonly code = 'account_not_found';

  /** @param accountId - The id that was looked up. */
  constructor(accountId: string) {
    super(
      `account ${accountId} does not exist`,
      { accountId },
    );
  }
}

/** No reservation has the given id. */
export class ReservationNotFound extends LedgerError {
  readonly code = 'reservation_not_found';

  /** @param reservationId - The id that was looked up. */
  constructor(reservationId: string) {
    super(
      `reservation ${reservationId} does not exist`,
      { reservationId },
    );
  }
}

/** The available balance (balance minus active holds) does not cover a reservation. */
export class InsufficientFunds extends LedgerError {
  readonly code = 'insufficient_funds';

  /**
   * @param accountId - The account that was asked to hold.
   * @param requested - The amount asked for.
   * @param available - The amount that was available at that moment.
   */
  constructor(
    accountId: string,
    requested: number,
    available: number,
  ) {
    super(
      `account ${accountId} has ${available} available, ${requested} requested`,
      {
        accountId,
        requested,
        available,
      },
    );
  }
}

/** A reservation was asked to leave a state it can no longer leave (every final state is terminal). */
export class InvalidTransition extends LedgerError {
  readonly code = 'invalid_transition';

  /**
   * @param reservationId - The reservation asked to move.
   * @param from - Its current status.
   * @param to - The status it was asked to move to.
   */
  constructor(
    reservationId: string,
    from: string,
    to: string,
  ) {
    super(
      `reservation ${reservationId} cannot go from ${from} to ${to}`,
      {
        reservationId,
        from,
        to,
      },
    );
  }
}

/** A capture arrived after the reservation's expiry time, even if the sweep has not expired it yet. */
export class ReservationExpired extends LedgerError {
  readonly code = 'reservation_expired';

  /**
   * @param reservationId - The reservation that was captured too late.
   * @param expiresAt - When it expired.
   */
  constructor(
    reservationId: string,
    expiresAt: Date,
  ) {
    super(
      `reservation ${reservationId} expired at ${expiresAt.toISOString()}`,
      {
        reservationId,
        expiresAt: expiresAt.toISOString(),
      },
    );
  }
}

/** A capture asked for more than the reservation holds. */
export class CaptureExceedsReservation extends LedgerError {
  readonly code = 'capture_exceeds_reservation';

  /**
   * @param reservationId - The reservation being captured.
   * @param requested - The amount asked for.
   * @param reserved - The amount the reservation holds.
   */
  constructor(
    reservationId: string,
    requested: number,
    reserved: number,
  ) {
    super(
      `cannot capture ${requested} from reservation ${reservationId} of ${reserved}`,
      {
        reservationId,
        requested,
        reserved,
      },
    );
  }
}
