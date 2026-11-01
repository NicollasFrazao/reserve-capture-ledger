/**
 * The source of the current time. Injected so tests can move time by hand
 * instead of sleeping until a reservation expires.
 */
export interface Clock {
  now(): Date;
}

/** The real clock. */
export const systemClock: Clock = {
  now(): Date {
    return new Date();
  },
};
