import { afterAll, afterEach, describe, expect, inject, it } from 'vitest';
import { createPool } from '../../src/infrastructure/database.js';
import { migrate } from '../../src/infrastructure/migrate.js';
import { createTestContext, expectLedgerConsistent } from './helpers.js';

const ctx = createTestContext();

afterEach(async () => {
  await expectLedgerConsistent(ctx.pool);
});

afterAll(async () => {
  await ctx.close();
});

describe('migrate', () => {
  it('builds the schema on an empty database', async () => {
    const scratchUrl = new URL(inject('databaseUrl'));
    const scratchName = `${scratchUrl.pathname.slice(1)}_scratch`;

    scratchUrl.pathname = `/${scratchName}`;
    await ctx.pool.query(`DROP DATABASE IF EXISTS "${scratchName}" WITH (FORCE)`);
    await ctx.pool.query(`CREATE DATABASE "${scratchName}"`);

    const scratch = createPool(
      scratchUrl.toString(),
      1,
    );

    try {
      expect(await migrate(scratch)).toEqual(['001_schema.sql']);
      const { rows } = await scratch.query<{ count: number }>('SELECT count(*)::int AS count FROM account_discrepancies');

      expect(rows[0]?.count).toBe(0);
    } finally {
      await scratch.end();
      await ctx.pool.query(`DROP DATABASE "${scratchName}" WITH (FORCE)`);
    }
  });

  it('records every applied file and applies nothing twice', async () => {
    const { rows } = await ctx.pool.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');

    expect(rows.map((row) => row.name)).toEqual(['001_schema.sql']);
    expect(await migrate(ctx.pool)).toEqual([]);
  });

  it('is safe to run from several processes at once', async () => {
    const results = await Promise.all([
      migrate(ctx.pool),
      migrate(ctx.pool),
      migrate(ctx.pool),
    ]);

    expect(results).toEqual([
      [],
      [],
      [],
    ]);
  });
});
