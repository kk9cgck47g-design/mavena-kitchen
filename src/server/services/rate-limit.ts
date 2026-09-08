import { lt, sql } from 'drizzle-orm';

import { IS_DEMO } from '@/lib/demo';
import { db } from '@/server/db/client';
import { rateLimits } from '@/server/db/schema';

/**
 * How often one actor may do one thing.
 *
 * The counter is a single upsert against a keyed row, which makes a check one
 * round trip and makes concurrent checks each other's problem rather than ours:
 * two requests arriving together both increment, and Postgres decides the order.
 * A read-then-write would let both read the same count and both be allowed.
 *
 * What this is not: precise. It is a fixed window, so an actor can spend a full
 * allowance at the end of one and another at the start of the next. Every limit
 * in `limits.ts` is chosen for "stop the obviously abusive" rather than "meter
 * exactly", and doubling at a boundary does not change which side of that line
 * anybody is on.
 *
 * What it is not either: a substitute for the checks underneath it. A limit
 * makes abuse expensive; it does not make an unauthorised action authorised, and
 * every caller still validates and still checks its own permissions.
 */

export interface RateLimitRule {
  /** Requests allowed per window. */
  limit: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitVerdict {
  allowed: boolean;
  /** How many are left in this window, floored at zero. */
  remaining: number;
  /** When the window resets. Useful for telling somebody how long to wait. */
  resetAt: Date;
}

/**
 * Count one attempt against a key, and say whether it may proceed.
 *
 * Counts first and judges afterwards, deliberately. A blocked actor that stops
 * being counted would be let back in the moment their window rolled over, no
 * matter how hard they had been hammering; counting the refused attempts too
 * means somebody who keeps trying keeps the door shut on themselves.
 *
 * Never throws. If the limiter itself cannot be reached the request is allowed:
 * a database hiccup must not take the site down on its way to protecting it, and
 * the alternative — failing closed — turns one broken query into a total outage.
 * The compromise is deliberate and it is the reason no limit here is the only
 * thing standing between an actor and something dangerous.
 */
export async function consumeRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitVerdict> {
  const windowStart = windowStartFor(now, rule.windowMs);
  const resetAt = new Date(windowStart.getTime() + rule.windowMs);

  // The preview has no database and nothing worth limiting: it takes no orders,
  // sends no messages and has no panel to log into.
  if (IS_DEMO) return { allowed: true, remaining: rule.limit, resetAt };

  try {
    /*
      One statement, and the CASE is what makes it a window rather than a
      running total: an upsert landing on a row from an older window resets the
      count to one instead of adding to it.
    */
    const [row] = await db
      .insert(rateLimits)
      .values({ key, windowStart, count: 1, updatedAt: now })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          /*
            Compared against `excluded`, the row this statement tried to insert,
            rather than against a second binding of the same instant. A `Date`
            interpolated into a raw fragment has no column to take its type from
            and is handed to the driver as a string, which fails — and because
            this function fails open, the failure is a limiter that silently
            allows everything. `excluded.window_start` is already typed by the
            insert above.
          */
          count: sql`case when ${rateLimits.windowStart} = excluded.window_start then ${rateLimits.count} + 1 else 1 end`,
          windowStart,
          updatedAt: now,
        },
      })
      .returning({ count: rateLimits.count });

    const used = row?.count ?? 1;

    return {
      allowed: used <= rule.limit,
      remaining: Math.max(0, rule.limit - used),
      resetAt,
    };
  } catch (error) {
    console.error('[rate-limit] check failed, allowing the request', key, error);
    return { allowed: true, remaining: rule.limit, resetAt };
  }
}

/**
 * Ask without counting.
 *
 * For the login form, which has to know whether an account is locked out before
 * it spends a quarter of a second on bcrypt. Counting here as well would charge
 * two attempts for one.
 */
export async function peekRateLimit(
  key: string,
  rule: RateLimitRule,
  now: Date = new Date(),
): Promise<RateLimitVerdict> {
  const windowStart = windowStartFor(now, rule.windowMs);
  const resetAt = new Date(windowStart.getTime() + rule.windowMs);

  if (IS_DEMO) return { allowed: true, remaining: rule.limit, resetAt };

  try {
    const [row] = await db
      .select({ count: rateLimits.count, windowStart: rateLimits.windowStart })
      .from(rateLimits)
      .where(sql`${rateLimits.key} = ${key}`)
      .limit(1);

    // A row from a window that has passed is not a count, it is a leftover.
    const used = row && row.windowStart.getTime() === windowStart.getTime() ? row.count : 0;

    return { allowed: used < rule.limit, remaining: Math.max(0, rule.limit - used), resetAt };
  } catch (error) {
    console.error('[rate-limit] peek failed, allowing the request', key, error);
    return { allowed: true, remaining: rule.limit, resetAt };
  }
}

/**
 * Forget a key.
 *
 * Called when an attempt succeeds, so that a customer who mistyped their password
 * twice and then got it right is not still carrying those two attempts an hour
 * later.
 */
export async function clearRateLimit(key: string): Promise<void> {
  if (IS_DEMO) return;

  try {
    await db.delete(rateLimits).where(sql`${rateLimits.key} = ${key}`);
  } catch (error) {
    console.error('[rate-limit] clear failed', key, error);
  }
}

/**
 * Drop rows nobody will look at again.
 *
 * Housekeeping rather than a requirement: rows are keyed, so the table grows
 * with the number of distinct actors ever seen and not with traffic. Called from
 * the scheduled sweep, where there is already a periodic job running.
 */
export async function pruneRateLimits(olderThanMs = 24 * 60 * 60 * 1000): Promise<number> {
  if (IS_DEMO) return 0;

  try {
    const cutoff = new Date(Date.now() - olderThanMs);
    const deleted = await db
      .delete(rateLimits)
      .where(lt(rateLimits.updatedAt, cutoff))
      .returning({ key: rateLimits.key });

    return deleted.length;
  } catch (error) {
    console.error('[rate-limit] prune failed', error);
    return 0;
  }
}

/**
 * The start of the window an instant falls in.
 *
 * Aligned to absolute time rather than to first use, so every actor's window
 * boundary is the same and a busy minute is a busy minute for the whole system.
 */
export function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

// --- The rules -------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/**
 * Every limit in the system, in one place, with the reason it is that number.
 *
 * The reason matters more than the number here, because of where this restaurant
 * is. Customers here are on mobile networks, and a mobile carrier
 * puts many subscribers behind one address — so on any customer-facing action,
 * an address is a neighbourhood rather than a person. Limits on those are set
 * generously and paired with a second key that identifies an actual customer:
 * the phone number they are ordering with, the token of the order they are
 * paying for.
 *
 * The staff panel is the opposite case. There are a handful of accounts, they
 * are worth attacking, and nobody legitimate types a password twenty times.
 */
export const LIMITS = {
  /**
   * Login attempts per account.
   *
   * Ten an hour is far past any honest fumbling and far below anything useful
   * for guessing. Keyed by email so that locking one account cannot lock the
   * rest of the staff out, which is what a purely address-based limit would do
   * to a kitchen sharing one connection.
   */
  loginByEmail: { limit: 10, windowMs: HOUR },

  /**
   * Login attempts per address, whatever account they name.
   *
   * The one that catches spraying — many accounts, few guesses each — which the
   * per-account limit alone cannot see. Higher, because it may be a whole
   * kitchen behind one address.
   */
  loginByIp: { limit: 30, windowMs: HOUR },

  /**
   * Orders per phone number.
   *
   * A number that orders eight times in an hour is not a customer, and every
   * order past that is a ticket printing in a kitchen. Generous enough for a
   * family ordering twice and correcting a mistake.
   */
  ordersByPhone: { limit: 8, windowMs: HOUR },

  /**
   * Orders per address.
   *
   * Deliberately high: this is the limit most likely to be sitting in front of
   * real customers who share a carrier gateway. It exists to stop a script, not
   * to ration a town.
   */
  ordersByIp: { limit: 40, windowMs: HOUR },

  /**
   * Quotes per address.
   *
   * The checkout asks for one on every settled change, so a single customer
   * filling in a form legitimately spends a dozen. Set for a busy evening of a
   * whole neighbourhood.
   */
  quotesByIp: { limit: 240, windowMs: 10 * MINUTE },

  /** Tracking polls per address. One customer polls six times a minute. */
  trackingByIp: { limit: 400, windowMs: 10 * MINUTE },

  /**
   * Payment sessions per order.
   *
   * Retrying is expected — a declined card, a changed mind — but each attempt
   * opens a session at somebody else's gateway, so it is not free to us or to
   * them.
   */
  paymentStartsByOrder: { limit: 10, windowMs: HOUR },

  /** Payment sessions per address, for the case where the orders differ. */
  paymentStartsByIp: { limit: 30, windowMs: HOUR },

  /**
   * Payment returns per address.
   *
   * A public GET that makes us call the provider. Refreshing it is normal; doing
   * so a hundred times is somebody making us pay for their curiosity.
   */
  paymentReturnsByIp: { limit: 60, windowMs: 10 * MINUTE },
} as const satisfies Record<string, RateLimitRule>;

/** Namespaced so two scopes can never collide on the same identifier. */
export function rateLimitKey(scope: string, identifier: string): string {
  return `${scope}:${identifier}`;
}
