import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { env } from '@/lib/env';
import { poolTuning } from './pooling';
import * as schema from './schema';

/**
 * The database connection, created on first use rather than on import.
 *
 * Laziness is load-bearing, not tidiness. In demo mode the site serves its menu
 * from memory and there is no Postgres anywhere; if this module opened a
 * connection at import time, merely importing a service module would crash the
 * whole deployment. Reaching `db` without a `DATABASE_URL` now fails with a
 * clear message at the moment someone actually tries to query — which in demo
 * mode never happens.
 *
 * A single pool is reused across hot reloads. Without the global, the dev server
 * opens a fresh pool on every recompile and exhausts Postgres within a few
 * minutes of editing.
 */

const globalForDb = globalThis as unknown as {
  __mavenaKitchenSql?: ReturnType<typeof postgres>;
};

function createSql() {
  if (!env.DATABASE_URL) {
    throw new Error(
      'DATABASE_URL is not set. Set it, or run with NEXT_PUBLIC_DEMO_MODE=1 to serve the menu from memory.',
    );
  }

  /*
    Tuning lives in `pooling.ts`, which is pure and tested. The one decision
    worth restating here is that `prepare` is not left to its default: under a
    transaction-mode pooler, prepared statements fail on a fraction of requests
    once traffic is heavy enough for connections to be reused, which reads as
    "the database is flaky" on exactly the evening it must not.
  */
  return postgres(
    env.DATABASE_URL,
    poolTuning({
      url: env.DATABASE_URL,
      serverless: Boolean(process.env.VERCEL),
      pooledOverride: env.DATABASE_POOLED === undefined ? undefined : env.DATABASE_POOLED === '1',
    }),
  );
}

function createDb() {
  const sql = globalForDb.__mavenaKitchenSql ?? createSql();

  if (process.env.NODE_ENV !== 'production') {
    globalForDb.__mavenaKitchenSql = sql;
  }

  /**
   * `casing: 'snake_case'` must match `drizzle.config.ts`. The schema declares
   * columns in camelCase and relies on this to map them.
   */
  return drizzle(sql, { schema, casing: 'snake_case' });
}

export type Db = ReturnType<typeof createDb>;

/**
 * A transaction handle, as handed to the callback of `db.transaction`.
 *
 * Named so that a function which must commit together with its caller can say
 * so in its signature. Anything writing a row that has to exist if and only if
 * another row does — an outbox entry beside an order, a status change beside a
 * confirmed payment — takes one of these rather than reaching for `db`.
 */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** For reads and single-statement writes that do not care either way. */
export type DbOrTx = Db | Tx;

let instance: Db | undefined;

/** Explicit accessor, for callers that want the connection to open right now. */
export function getDb(): Db {
  instance ??= createDb();
  return instance;
}

/**
 * Behaves exactly like a Drizzle client, but nothing connects until the first
 * property is touched.
 */
export const db = new Proxy({} as Db, {
  get(_target, property, receiver) {
    return Reflect.get(getDb(), property, receiver);
  },
}) as Db;

/** Close the pool. Used by scripts and tests; the server keeps it open. */
export async function closeDb(): Promise<void> {
  const sql = globalForDb.__mavenaKitchenSql;
  if (sql) {
    await sql.end();
    globalForDb.__mavenaKitchenSql = undefined;
    instance = undefined;
  }
}

export { schema };
