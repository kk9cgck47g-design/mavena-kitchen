import { randomUUID } from 'node:crypto';
import { inArray, like } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';

import { closeDb, db } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';
import {
  consumeRateLimit,
  LIMITS,
  rateLimitKey,
  type RateLimitRule,
} from '@/server/services/rate-limit';

/**
 * The limits standing in front of the endpoints anybody can call.
 *
 * Exercised through the same keys and rules the actions use, rather than through
 * the actions themselves: a server action needs a request context for cookies
 * and headers, which a test does not have. What is being checked is that the
 * numbers are the ones intended and that the keys separate the actors they are
 * meant to separate — a limit keyed wrongly is a limit that either rations
 * customers or protects nobody.
 *
 * Requires `pnpm db:up && pnpm db:migrate`.
 */

const keysUsed: string[] = [];

function fresh(scope: string): string {
  const key = rateLimitKey(scope, `test-${randomUUID()}`);
  keysUsed.push(key);
  return key;
}

/** Spend an allowance and report where it stopped. */
async function spend(key: string, rule: RateLimitRule, times: number): Promise<boolean[]> {
  const results: boolean[] = [];
  for (let i = 0; i < times; i += 1) {
    results.push((await consumeRateLimit(key, rule)).allowed);
  }
  return results;
}

afterAll(async () => {
  if (keysUsed.length > 0) {
    await db.delete(rateLimits).where(inArray(rateLimits.key, keysUsed));
  }
  await db.delete(rateLimits).where(like(rateLimits.key, '%test-%'));
  await closeDb();
});

describe('orders', () => {
  it('stops a phone number after its allowance', async () => {
    // The limit that stands between a script and a cook's evening: every order
    // that succeeds prints a ticket.
    const key = fresh('order:phone');
    const outcomes = await spend(key, LIMITS.ordersByPhone, LIMITS.ordersByPhone.limit + 2);

    expect(outcomes.slice(0, LIMITS.ordersByPhone.limit).every(Boolean)).toBe(true);
    expect(outcomes.slice(LIMITS.ordersByPhone.limit).some(Boolean)).toBe(false);
  });

  it('leaves a different phone number unaffected', async () => {
    // Two customers on one carrier gateway are two customers. If the phone limit
    // leaked across numbers, a busy evening would start refusing real orders.
    const exhausted = fresh('order:phone');
    await spend(exhausted, LIMITS.ordersByPhone, LIMITS.ordersByPhone.limit + 1);

    const other = fresh('order:phone');
    expect((await consumeRateLimit(other, LIMITS.ordersByPhone)).allowed).toBe(true);
  });

  it('gives an address far more room than a phone', async () => {
    /*
      Deliberate, and the reason is how customers reach us. A mobile carrier puts
      many subscribers behind one address, so on a customer-facing action an
      address is a neighbourhood. The address limit exists to stop a script; the
      phone limit is the one that identifies a person.
    */
    expect(LIMITS.ordersByIp.limit).toBeGreaterThan(LIMITS.ordersByPhone.limit * 3);
  });
});

describe('quoting and tracking', () => {
  it('lets one customer fill in a form without being rationed', async () => {
    /*
      The checkout asks for a quote on every settled change — a dozen or more for
      one order, and every drag of the map pin. A limit that a single honest
      customer could reach would break the screen rather than protect it.
    */
    const key = fresh('quote:ip');
    const outcomes = await spend(key, LIMITS.quotesByIp, 30);

    expect(outcomes.every(Boolean)).toBe(true);
  });

  it('lets a tracking page poll for the life of an order', async () => {
    // Six polls a minute, for the twenty minutes food takes. Several customers
    // on one gateway have to fit inside this too.
    const perCustomer = 6 * 20;
    expect(LIMITS.trackingByIp.limit).toBeGreaterThan(perCustomer * 2);

    const key = fresh('track:ip');
    expect((await spend(key, LIMITS.trackingByIp, perCustomer)).every(Boolean)).toBe(true);
  });
});

describe('payments', () => {
  it('lets a customer retry a declined card several times', async () => {
    // Retrying is expected — a declined card, a different card, a changed mind.
    // The limit is there for a loop, not for a customer having a bad evening.
    const key = fresh('pay:token');
    const outcomes = await spend(key, LIMITS.paymentStartsByOrder, 5);

    expect(outcomes.every(Boolean)).toBe(true);
    expect(LIMITS.paymentStartsByOrder.limit).toBeGreaterThanOrEqual(5);
  });

  it('stops an order opening sessions without end', async () => {
    const key = fresh('pay:token');
    const outcomes = await spend(
      key,
      LIMITS.paymentStartsByOrder,
      LIMITS.paymentStartsByOrder.limit + 2,
    );

    expect(outcomes.slice(LIMITS.paymentStartsByOrder.limit).some(Boolean)).toBe(false);
  });

  it('separates one order from another', async () => {
    const exhausted = fresh('pay:token');
    await spend(exhausted, LIMITS.paymentStartsByOrder, LIMITS.paymentStartsByOrder.limit + 1);

    const other = fresh('pay:token');
    expect((await consumeRateLimit(other, LIMITS.paymentStartsByOrder)).allowed).toBe(true);
  });
});

describe('the numbers themselves', () => {
  it('never sets a limit that a single honest customer could reach', () => {
    // A cheap guard against somebody tightening one of these later without
    // thinking about what the screen above it does.
    expect(LIMITS.quotesByIp.limit).toBeGreaterThanOrEqual(120);
    expect(LIMITS.trackingByIp.limit).toBeGreaterThanOrEqual(240);
    expect(LIMITS.ordersByPhone.limit).toBeGreaterThanOrEqual(5);
  });

  it('keeps the login limits tight, because nobody legitimate types a password twenty times', () => {
    expect(LIMITS.loginByEmail.limit).toBeLessThanOrEqual(15);
    // Higher than the account limit: a whole kitchen may share one address, and
    // locking that would lock out the shift.
    expect(LIMITS.loginByIp.limit).toBeGreaterThan(LIMITS.loginByEmail.limit);
  });
});
