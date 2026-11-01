import pg from 'pg';
import type { TestProject } from 'vitest/node';
import { createPool } from '../../src/infrastructure/database.js';
import { migrate } from '../../src/infrastructure/migrate.js';

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

/**
 * Recreates and migrates a dedicated `<name>_test` database next to the
 * one in DATABASE_URL: every run starts from an empty schema, and the
 * suite never touches development data.
 */
export default async function setup(project: TestProject): Promise<void> {
  const baseUrl = new URL(process.env.DATABASE_URL ?? 'postgres://ledger:ledger@localhost:5432/ledger');
  const testUrl = new URL(baseUrl);
  testUrl.pathname = `${baseUrl.pathname.replace(/^\//, '')}_test`;
  const testDatabase = testUrl.pathname.slice(1);

  const admin = new pg.Client({ connectionString: baseUrl.toString() });
  await admin.connect();
  try {
    await admin.query(`DROP DATABASE IF EXISTS "${testDatabase}" WITH (FORCE)`);
    await admin.query(`CREATE DATABASE "${testDatabase}"`);
  } finally {
    await admin.end();
  }

  const pool = createPool(testUrl.toString(), 1);
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }

  project.provide('databaseUrl', testUrl.toString());
}
