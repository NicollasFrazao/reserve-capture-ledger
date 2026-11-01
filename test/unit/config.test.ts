import { describe, expect, it } from 'vitest';
import { systemClock } from '../../src/application/clock.js';
import { loadConfig } from '../../src/infrastructure/config.js';

describe('loadConfig', () => {
  it('falls back to the docker compose defaults', () => {
    expect(loadConfig({})).toEqual({
      databaseUrl: 'postgres://ledger:ledger@localhost:5432/ledger',
      port: 3000,
      sweepIntervalMs: 5000,
    });
  });

  it('reads every setting from the environment', () => {
    expect(loadConfig({
      DATABASE_URL: 'postgres://app@db/credits',
      PORT: '8080',
      SWEEP_INTERVAL_MS: '250',
    })).toEqual({
      databaseUrl: 'postgres://app@db/credits',
      port: 8080,
      sweepIntervalMs: 250,
    });
  });

  it('treats an empty value as unset', () => {
    expect(loadConfig({ PORT: '' }).port).toBe(3000);
  });

  it.each([
    'abc',
    '0',
    '-1',
    '1.5',
  ])('refuses PORT=%s', (value) => {
    expect(() => loadConfig({ PORT: value })).toThrow(RangeError);
  });
});

describe('systemClock', () => {
  it('tells the real time', () => {
    const before = Date.now();
    const now = systemClock.now().getTime();

    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });
});
