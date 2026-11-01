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

const reservation = (amount = 100, ttlSeconds = 60): Reservation =>
  Reservation.create({ id: 'r1', accountId: 'a1', amount: Money.of(amount), now: t0, ttlSeconds });

describe('Reservation', () => {
  it('starts reserved and expires ttlSeconds after creation', () => {
    const r = reservation();
    expect(r.status).toBe('reserved');
    expect(r.expiresAt).toEqual(at(60));
    expect(r.releasedAmount).toBeNull();
  });

  it('captures part of the amount and releases the rest', () => {
    const r = reservation(100);
    r.capture(Money.of(70), at(10));
    expect(r.toView()).toMatchObject({
      status: 'captured',
      capturedAmount: 70,
      releasedAmount: 30,
      finalizedAt: at(10).toISOString(),
    });
  });

  it('captures the full amount', () => {
    const r = reservation(100);
    r.capture(Money.of(100), at(10));
    expect(r.releasedAmount?.units).toBe(0);
  });

  it('refuses to capture more than was reserved', () => {
    const r = reservation(100);
    expect(() => {
      r.capture(Money.of(101), at(10));
    }).toThrow(CaptureExceedsReservation);
    expect(r.status).toBe('reserved');
  });

  it('refuses to capture once past expiry, even before the sweep', () => {
    const r = reservation(100, 60);
    expect(() => {
      r.capture(Money.of(10), at(60));
    }).toThrow(ReservationExpired);
    expect(r.status).toBe('reserved');
  });

  it('releases the whole amount', () => {
    const r = reservation(100);
    r.release(at(5));
    expect(r.toView()).toMatchObject({ status: 'released', capturedAmount: null, releasedAmount: 100 });
  });

  it('can be released after its expiry time', () => {
    const r = reservation(100, 60);
    r.release(at(120));
    expect(r.status).toBe('released');
  });

  it('expires only once due', () => {
    const r = reservation(100, 60);
    expect(r.isDue(at(59))).toBe(false);
    expect(() => {
      r.expire(at(59));
    }).toThrow(/not due/);
    expect(r.isDue(at(60))).toBe(true);
    r.expire(at(60));
    expect(r.toView()).toMatchObject({ status: 'expired', releasedAmount: 100 });
    expect(r.isDue(at(61))).toBe(false);
  });

  describe('state machine', () => {
    const statuses: ReservationStatus[] = ['reserved', 'captured', 'released', 'expired'];
    const allowed = new Set(['reserved>captured', 'reserved>released', 'reserved>expired']);

    it.each(statuses.flatMap((from) => statuses.map((to) => [from, to] as const)))(
      '%s -> %s',
      (from, to) => {
        expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      },
    );

    const finalized: Array<[string, (r: Reservation) => void]> = [
      ['captured', (r) => { r.capture(Money.of(10), at(1)); }],
      ['released', (r) => { r.release(at(1)); }],
      ['expired', (r) => { r.expire(at(60)); }],
    ];

    it.each(finalized)('a %s reservation accepts no further move', (_, finalize) => {
      const r = reservation(100, 60);
      finalize(r);
      expect(() => { r.capture(Money.of(1), at(2)); }).toThrow(InvalidTransition);
      expect(() => { r.release(at(2)); }).toThrow(InvalidTransition);
      expect(() => { r.expire(at(120)); }).toThrow(InvalidTransition);
    });
  });
});
