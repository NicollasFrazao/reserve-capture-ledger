const DEFAULT_DATABASE_URL = 'postgres://ledger:ledger@localhost:5432/ledger';
const DEFAULT_PORT = 3000;
const DEFAULT_SWEEP_INTERVAL_MS = 5000;

/** Runtime settings, read from the environment. */
export interface Config {
  databaseUrl: string;
  port: number;
  sweepIntervalMs: number;
}

/**
 * Reads the settings from `env`, falling back to the local docker compose defaults.
 *
 * @throws {@link RangeError} when a numeric setting is not a positive integer.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    databaseUrl: env.DATABASE_URL ?? DEFAULT_DATABASE_URL,
    port: positiveInteger(
      'PORT',
      env.PORT,
      DEFAULT_PORT,
    ),
    sweepIntervalMs: positiveInteger(
      'SWEEP_INTERVAL_MS',
      env.SWEEP_INTERVAL_MS,
      DEFAULT_SWEEP_INTERVAL_MS,
    ),
  };
}

function positiveInteger(
  name: string,
  raw: string | undefined,
  fallback: number,
): number {
  if (
    raw === undefined
    || raw === ''
  ) {
    return fallback;
  }

  const value = Number(raw);

  if (
    !Number.isSafeInteger(value)
    || value <= 0
  ) {
    throw new RangeError(`${name} must be a positive integer, got "${raw}"`);
  }

  return value;
}
