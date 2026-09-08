/**
 * How to open connections, given where this is running and what it is running
 * against.
 *
 * Pure, and separate from `client.ts`, because the decision it makes is the one
 * most likely to cause an outage that looks like something else. Under a
 * transaction-mode pooler — Neon's pooled endpoint, Supabase's 6543 port, a
 * PgBouncer somebody put in front — a client connection is handed a different
 * server connection per transaction. A named prepared statement created on one
 * of them does not exist on the next, and `postgres.js` prepares by default.
 *
 * The failure that produces is the bad kind: not a clean error at boot but
 * `prepared statement "s1" does not exist` appearing on a fraction of requests
 * once there is enough traffic for the pooler to start reusing connections. It
 * looks exactly like "the database is flaky" and it arrives on the busiest
 * evening, because that is when the pooler has something to pool.
 *
 * So the mode is decided explicitly here rather than left to a default, and it
 * is decided from the connection string, which is the only thing that actually
 * knows.
 */

/** Connection tuning, in the shape `postgres.js` wants it. */
export interface PoolTuning {
  /** Connections per process. */
  max: number;
  /** Whether named prepared statements are safe. False under a transaction pooler. */
  prepare: boolean;
  /** Seconds a connection may sit unused before it is closed. */
  idle_timeout: number;
  /** Seconds to wait for a connection before giving up. */
  connect_timeout: number;
}

/**
 * Does this connection string point at a transaction-mode pooler?
 *
 * Recognised by the shapes the managed providers actually use:
 *
 *   - Neon's pooled endpoint puts `-pooler` in the hostname.
 *   - Supabase's transaction pooler listens on 6543 (its session pooler, 5432,
 *     is safe and is correctly not matched).
 *   - A self-hosted PgBouncer is usually named as such.
 *
 * Heuristics, and they can be wrong in one direction or the other, which is why
 * `DATABASE_POOLED` overrides this. Getting it wrong towards `false` is the
 * expensive mistake, so anything ambiguous should be pointed at the override.
 */
export function usesTransactionPooler(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL we can read. Assume a direct connection rather than silently
    // disabling prepared statements on a database that wanted them.
    return false;
  }

  const host = parsed.hostname.toLowerCase();

  if (host.includes('-pooler')) return true;
  if (host.includes('pgbouncer')) return true;
  if (parsed.port === '6543') return true;

  return false;
}

/**
 * Everything `postgres.js` needs to be told, for one deployment.
 *
 * `max` is where the two runtimes differ and where the arithmetic matters. A
 * long-lived server multiplexes every request over one pool, so ten connections
 * serve the whole site. A serverless platform gives each concurrent invocation
 * its own module scope and therefore its own pool, so the total held open is
 * instances × max — one apiece is not stinginess, it is the only setting whose
 * total stays bounded when the platform decides to run eighty of them at once.
 *
 * That is also why a pooler is not optional at any real concurrency: eighty
 * direct connections is past what a small Postgres will accept, and the pooler
 * is what turns them back into a handful.
 */
export function poolTuning(args: {
  url: string;
  serverless: boolean;
  /** `DATABASE_POOLED`, when set. Overrides the guess in either direction. */
  pooledOverride?: boolean;
}): PoolTuning {
  const pooled = args.pooledOverride ?? usesTransactionPooler(args.url);

  return {
    max: args.serverless ? 1 : 10,
    prepare: !pooled,
    idle_timeout: 20,
    /*
      Ten seconds, and it is a deliberate ceiling rather than patience. When
      connections run out, this is how long a request waits before failing —
      and a customer who has waited ten seconds has already decided the site is
      broken. Failing at that point at least frees the slot for somebody else
      instead of holding it while they leave.
    */
    connect_timeout: 10,
  };
}
