import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from './config.js';
import { createPool } from './database.js';

const MIGRATIONS_DIR = fileURLToPath(new URL(
  '../../migrations/',
  import.meta.url,
));

/** Arbitrary constant: the advisory lock that keeps two migrators apart. */
const MIGRATION_LOCK = 4_242_001;

/**
 * Applies the `.sql` files in `migrations/` that have not run yet.
 *
 * @remarks
 * Files run in name order, each in its own transaction, under an advisory lock
 * so two processes starting together do not apply the same file twice.
 *
 * @returns The names of the files this call applied.
 */
export async function migrate(pool: pg.Pool): Promise<string[]> {
  const client = await pool.connect();

  try {
    await client.query(
      'SELECT pg_advisory_lock($1)',
      [MIGRATION_LOCK],
    );

    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const pending = await pendingMigrations(client);

    for (const name of pending) {
      await applyMigration(
        client,
        name,
      );
    }

    return pending;
  } finally {
    await client.query(
      'SELECT pg_advisory_unlock($1)',
      [MIGRATION_LOCK],
    ).catch(() => undefined);

    client.release();
  }
}

async function pendingMigrations(client: pg.PoolClient): Promise<string[]> {
  const { rows } = await client.query<{ name: string }>('SELECT name FROM schema_migrations');
  const done = new Set(rows.map((row) => row.name));
  const files = await readdir(MIGRATIONS_DIR);

  return files
    .filter((name) => name.endsWith('.sql') && !done.has(name))
    .sort((
      left,
      right,
    ) => left.localeCompare(right));
}

async function applyMigration(
  client: pg.PoolClient,
  name: string,
): Promise<void> {
  const sql = await readFile(
    join(
      MIGRATIONS_DIR,
      name,
    ),
    'utf8',
  );

  try {
    await client.query('BEGIN');
    await client.query(sql);

    await client.query(
      'INSERT INTO schema_migrations (name) VALUES ($1)',
      [name],
    );

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');

    throw error;
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = createPool(
    loadConfig().databaseUrl,
    1,
  );

  try {
    const applied = await migrate(pool);

    console.log(applied.length > 0 ? `applied: ${applied.join(', ')}` : 'database is up to date');
  } finally {
    await pool.end();
  }
}
