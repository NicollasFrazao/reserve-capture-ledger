import type pg from 'pg';

/** Anything that can run a query: the pool or a checked-out client. */
export type Queryable = Pick<pg.PoolClient, 'query'>;
