import { describe, expect, it } from 'vitest';
import {
  CaptureExceedsReservation,
  InvalidTransition,
  ReservationExpired,
} from '../../src/domain/errors.js';
import { Money } from '../../src/domain/money.js';
import { canTransition, Reservation, type ReservationStatus } from '../../src/domain/reservation.js';

const t0 = new Date('2026-01-01T12:00:00.000Z');
const at = (seconds: number): Date => new Date(t0.getTime() + seconds * 1000);

const newReservation = (
  amount = 100,
  ttlSeconds = 60,
): Reservation => Reservation.create({
  id: 'r1',
  accountId: 'a1',
  amount: Money.of(amount),
  now: t0,
  ttlSeconds,
});

describe('Reservation', () => {
  it('starts reserved and expires ttlSeconds after creation', () => {
    const reservation = newReservation();

    expect(reservation.status).toBe('reserved');
    expect(reservation.expiresAt).toEqual(at(60));
    expect(reservation.releasedAmount).toBeNull();
  });

  it('captures part of the amount and releases the rest', () => {
    const reservation = newReservation(100);

    reservation.capture(
      Money.of(70),
      at(10),
    );

    expect(reservation.toView()).toMatchObject({
      status: 'captured',
      capturedAmount: 70,
      releasedAmount: 30,
      finalizedAt: at(10).toISOString(),
    });
  });

  it('captures the full amount', () => {
    const reservation = newReservation(100);

    reservation.capture(
      Money.of(100),
      at(10),
    );

    expect(reservation.releasedAmount?.units).toBe(0);
  });

  it('refuses to capture more than was reserved', () => {
    const reservation = newReservation(100);

    expect(() => {
      reservation.capture(
        Money.of(101),
        at(10),
      );
    }).toThrow(CaptureExceedsReservation);

    expect(reservation.status).toBe('reserved');
  });

  it('refuses to capture once past expiry, even before the sweep', () => {
    const reservation = newReservation(
      100,
      60,
    );

    expect(() => {
      reservation.capture(
        Money.of(10),
        at(60),
      );
    }).toThrow(ReservationExpired);

    expect(reservation.status).toBe('reserved');
  });

  it('releases the whole amount', () => {
    const reservation = newReservation(100);

    reservation.release(at(5));

    expect(reservation.toView()).toMatchObject({
      status: 'released',
      capturedAmount: null,
      releasedAmount: 100,
    });
  });

  it('can be released after its expiry time', () => {
    const reservation = newReservation(
      100,
      60,
    );

    reservation.release(at(120));

    expect(reservation.status).toBe('released');
  });

  it('expires only once due', () => {
    const reservation = newReservation(
      100,
      60,
    );

    expect(reservation.isDue(at(59))).toBe(false);

    expect(() => {
      reservation.expire(at(59));
    }).toThrow(/not due/);

    expect(reservation.isDue(at(60))).toBe(true);
    reservation.expire(at(60));

    expect(reservation.toView()).toMatchObject({
      status: 'expired',
      releasedAmount: 100,
    });

    expect(reservation.isDue(at(61))).toBe(false);
  });

  describe('state machine', () => {
    const statuses: ReservationStatus[] = [
      'reserved',
      'captured',
      'released',
      'expired',
    ];

    const allowed = new Set([
      'reserved>captured',
      'reserved>released',
      'reserved>expired',
    ]);

    const pairs = statuses.flatMap((from) => statuses.map((to) => [
      from,
      to,
    ] as const));

    it.each(pairs)('%s -> %s', (
      from,
      to,
    ) => {
      expect(canTransition(
        from,
        to,
      )).toBe(allowed.has(`${from}>${to}`));
    });

    const finalizers: [ReservationStatus, (reservation: Reservation) => void][] = [
      [
        'captured',
        (reservation) => {
          reservation.capture(
            Money.of(10),
            at(1),
          );
        },
      ],
      [
        'released',
        (reservation) => {
          reservation.release(at(1));
        },
      ],
      [
        'expired',
        (reservation) => {
          reservation.expire(at(60));
        },
      ],
    ];

    it.each(finalizers)('a %s reservation accepts no further move', (
      _status,
      finalize,
    ) => {
      const reservation = newReservation(
        100,
        60,
      );

      finalize(reservation);

      expect(() => {
        reservation.capture(
          Money.of(1),
          at(2),
        );
      }).toThrow(InvalidTransition);

      expect(() => {
        reservation.release(at(2));
      }).toThrow(InvalidTransition);

      expect(() => {
        reservation.expire(at(120));
      }).toThrow(InvalidTransition);
    });
  });
});
