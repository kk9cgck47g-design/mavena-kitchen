import { describe, expect, it } from 'vitest';

import { poolTuning, usesTransactionPooler } from '@/server/db/pooling';

/**
 * Which connection strings mean "do not prepare".
 *
 * Worth testing precisely because the failure it prevents is invisible in
 * development: prepared statements only break once a pooler has enough traffic
 * to start handing out different server connections, so a wrong answer here
 * passes every local run and surfaces as intermittent errors under load.
 */

const NEON_DIRECT = 'postgresql://u:p@ep-cool-name-123456.eu-central-1.aws.neon.tech/db';
const NEON_POOLED = 'postgresql://u:p@ep-cool-name-123456-pooler.eu-central-1.aws.neon.tech/db';
const SUPABASE_SESSION = 'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:5432/postgres';
const SUPABASE_TRANSACTION = 'postgresql://u:p@aws-0-eu-central-1.pooler.supabase.com:6543/postgres';
const LOCAL = 'postgresql://mavena:secret@localhost:5432/mavena_kitchen';

describe('spotting a transaction pooler', () => {
  it('recognises Neon by the -pooler host', () => {
    expect(usesTransactionPooler(NEON_POOLED)).toBe(true);
    expect(usesTransactionPooler(NEON_DIRECT)).toBe(false);
  });

  it('recognises Supabase by the port, and leaves its session pooler alone', () => {
    // 6543 is transaction mode and unsafe to prepare against; 5432 is session
    // mode, where a client keeps one server connection and prepared statements
    // are fine. Treating both as unsafe would cost performance for no reason.
    expect(usesTransactionPooler(SUPABASE_TRANSACTION)).toBe(true);
    expect(usesTransactionPooler(SUPABASE_SESSION)).toBe(false);
  });

  it('recognises a self-hosted PgBouncer by name', () => {
    expect(usesTransactionPooler('postgresql://u:p@pgbouncer.internal:5432/db')).toBe(true);
  });

  it('treats a plain local database as direct', () => {
    expect(usesTransactionPooler(LOCAL)).toBe(false);
  });

  it('does not throw on a connection string it cannot parse', () => {
    // A malformed URL must not take the process down at startup. Assuming
    // "direct" is the honest answer: it is what an unrecognised string most
    // likely is, and the override exists for when it is not.
    expect(usesTransactionPooler('not a url at all')).toBe(false);
    expect(usesTransactionPooler('')).toBe(false);
  });
});

describe('pool tuning', () => {
  it('holds one connection per serverless instance and ten on a real server', () => {
    // The arithmetic that matters: serverless total is instances x max, and the
    // platform decides how many instances. One apiece is the only setting whose
    // total stays bounded when it decides on eighty.
    expect(poolTuning({ url: LOCAL, serverless: true }).max).toBe(1);
    expect(poolTuning({ url: LOCAL, serverless: false }).max).toBe(10);
  });

  it('prepares against a direct connection and not against a pooled one', () => {
    expect(poolTuning({ url: NEON_DIRECT, serverless: true }).prepare).toBe(true);
    expect(poolTuning({ url: NEON_POOLED, serverless: true }).prepare).toBe(false);
  });

  it('lets the override win in both directions', () => {
    // The escape hatch for a pooler we do not recognise, and for a direct
    // connection that happens to look like one.
    expect(poolTuning({ url: NEON_DIRECT, serverless: true, pooledOverride: true }).prepare).toBe(
      false,
    );
    expect(poolTuning({ url: NEON_POOLED, serverless: true, pooledOverride: false }).prepare).toBe(
      true,
    );
  });

  it('always bounds how long a request waits for a connection', () => {
    const tuning = poolTuning({ url: LOCAL, serverless: true });
    expect(tuning.connect_timeout).toBeGreaterThan(0);
    expect(tuning.idle_timeout).toBeGreaterThan(0);
  });
});
