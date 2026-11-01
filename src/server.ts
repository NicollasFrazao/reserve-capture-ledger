// Composition root: wires the pool, the service and the HTTP app, and runs the
// expiry sweep. The only module that reads the environment.
import { LedgerService } from './application/ledger-service.js';
import { buildApp } from './http/app.js';
import { loadConfig } from './infrastructure/config.js';
import { createPool, PgTransactionRunner } from './infrastructure/database.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl);
const service = new LedgerService(new PgTransactionRunner(pool));

const app = buildApp(
  service,
  { logger: true },
);

// The sweep runs in-process for simplicity. It is safe to run in every
// replica at once: the row locks decide which one expires a hold.
let isSweeping = false;

async function sweepOnce(): Promise<void> {
  if (isSweeping) {
    return;
  }

  isSweeping = true;

  try {
    const expired = await service.expireDue();

    if (expired > 0) {
      app.log.info(
        { expired },
        'expired reservations',
      );
    }
  } catch (error) {
    app.log.error(
      error,
      'expiry sweep failed',
    );
  } finally {
    isSweeping = false;
  }
}

const sweep = setInterval(
  () => void sweepOnce(),
  config.sweepIntervalMs,
);

async function shutdown(): Promise<void> {
  clearInterval(sweep);
  await app.close();
  await pool.end();
}

process.once(
  'SIGINT',
  () => void shutdown(),
);

process.once(
  'SIGTERM',
  () => void shutdown(),
);

await app.listen({
  port: config.port,
  host: '0.0.0.0',
});
