import { IS_DEMO } from '@/lib/demo';
import { env } from '@/lib/env';

/**
 * Whether Telegram is switched on, and the two secrets that switch it on.
 *
 * Both come from the environment and neither is ever committed. A deployment
 * without them is not broken — it is a deployment that does not notify anybody,
 * which is exactly what a design preview and a local dev database should be.
 * Every entry point asks this first and returns quietly if the answer is no.
 */

export const TELEGRAM_API = 'https://api.telegram.org';

/** How long to wait on Telegram before giving up and leaving the row PENDING. */
export const TELEGRAM_TIMEOUT_MS = 8_000;

export function botToken(): string | null {
  // The preview must never reach a real bot, whatever happens to be in its
  // environment. Checked here rather than at each call site so there is one
  // place to be sure about.
  if (IS_DEMO) return null;
  return env.TELEGRAM_BOT_TOKEN ?? null;
}

export function webhookSecret(): string | null {
  if (IS_DEMO) return null;
  return env.TELEGRAM_WEBHOOK_SECRET ?? null;
}

export function isTelegramConfigured(): boolean {
  return botToken() !== null;
}

/**
 * Constant-time string comparison.
 *
 * The webhook secret is compared on every inbound request, and `===` on strings
 * stops at the first differing byte. That difference is measurable across
 * enough requests, and an attacker who can measure it can recover the secret a
 * character at a time.
 */
export function secretsMatch(a: string, b: string): boolean {
  if (a.length !== b.length) return false;

  let difference = 0;
  for (let i = 0; i < a.length; i += 1) {
    difference |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }

  return difference === 0;
}
