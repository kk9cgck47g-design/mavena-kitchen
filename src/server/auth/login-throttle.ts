import {
  clearRateLimit,
  consumeRateLimit,
  LIMITS,
  peekRateLimit,
  rateLimitKey,
} from '@/server/services/rate-limit';

/**
 * How many times somebody may try to log in.
 *
 * Split out of the sign-in action so it can be tested against a real database
 * without a browser. A server action cannot be called from a test — it needs a
 * request context for cookies and headers — and the login limit is the single
 * most important control in the panel, so "covered by reading the code" was not
 * good enough.
 *
 * Two keys, and they catch different attacks. Per-account stops guessing at one
 * password; per-address stops spraying one guess across many accounts, which the
 * per-account limit cannot see. Locking is per-account rather than per-address
 * alone because a kitchen shares one connection, and one attacker should not be
 * able to lock out the whole staff by failing against a colleague's email.
 */

export interface LoginThrottleVerdict {
  allowed: boolean;
  /** When the longest-held limit resets, as an ISO string. */
  retryAt: string;
}

function keysFor(email: string, ip: string) {
  return {
    email: rateLimitKey('login:email', email),
    ip: rateLimitKey('login:ip', ip),
  };
}

/**
 * May this attempt proceed?
 *
 * Asked before the password is compared, and that ordering is half the point. A
 * bcrypt comparison at cost 12 costs a quarter of a second of CPU by design;
 * answering a hundred at once falls over without anybody having guessed
 * anything. A locked-out attacker has to be turned away before the expensive
 * part, not after it.
 *
 * Peeks rather than consumes: the attempt is counted by `recordLoginAttempt`,
 * and counting here too would charge two against every try.
 */
export async function checkLoginAllowed(email: string, ip: string): Promise<LoginThrottleVerdict> {
  const keys = keysFor(email, ip);

  const [byEmail, byIp] = await Promise.all([
    peekRateLimit(keys.email, LIMITS.loginByEmail),
    peekRateLimit(keys.ip, LIMITS.loginByIp),
  ]);

  const retryAt = byEmail.resetAt.getTime() > byIp.resetAt.getTime() ? byEmail.resetAt : byIp.resetAt;

  return { allowed: byEmail.allowed && byIp.allowed, retryAt: retryAt.toISOString() };
}

/**
 * Count one attempt, whatever it turns out to be.
 *
 * Called before the answer is known, so a right guess costs the same as a wrong
 * one. Counting only failures would let somebody probe indefinitely as long as
 * they occasionally got one right.
 */
export async function recordLoginAttempt(email: string, ip: string): Promise<void> {
  const keys = keysFor(email, ip);

  await Promise.all([
    consumeRateLimit(keys.email, LIMITS.loginByEmail),
    consumeRateLimit(keys.ip, LIMITS.loginByIp),
  ]);
}

/**
 * Forget the attempts once somebody is in.
 *
 * A member of staff who mistyped twice and then got it right should not still be
 * carrying those two an hour later.
 */
export async function clearLoginAttempts(email: string, ip: string): Promise<void> {
  const keys = keysFor(email, ip);
  await Promise.all([clearRateLimit(keys.email), clearRateLimit(keys.ip)]);
}
