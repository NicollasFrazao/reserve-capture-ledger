import { LedgerService } from './application/ledger-service.js';
import { createPool, PgTransactionRunner } from './infrastructure/database.js';
import { buildApp } from './http/app.js';

const databaseUrl = process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost:5432/ledger';
const port = Number(process.env.PORT ?? 3000);
const sweepIntervalMs = Number(process.env.SWEEP_INTERVAL_MS ?? 5000);

const pool = createPool(databaseUrl);
const service = new LedgerService(new PgTransactionRunner(pool));
const app = buildApp(service, { logger: true });

// The expiry sweep runs in-process for simplicity. It is safe to run in
// every replica at once: the row locks decide which one expires a hold.
let sweeping = false;
const sweep = setInterval(() => {
  if (sweeping) return;
  sweeping = true;
  service
    .expireDue()
    .then((expired) => {
      if (expired > 0) app.log.info({ expired }, 'expired reservations');
    })
    .catch((error: unknown) => {
      app.log.error(error, 'expiry sweep failed');
    })
    .finally(() => {
      sweeping = false;
    });
}, sweepIntervalMs);

async function shutdown(): Promise<void> {
  clearInterval(sweep);
  await app.close();
  await pool.end();
}

process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());

await app.listen({ port, host: '0.0.0.0' });
