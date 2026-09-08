import { headers } from 'next/headers';

/**
 * Who is asking, as far as the network can say.
 *
 * Kept out of `server/services` because it reads a Next.js request context, and
 * that directory deliberately imports no Next.js.
 *
 * The order below is a trust order, not a fallback order. `x-forwarded-for` is a
 * request header like any other: on a deployment where nothing overwrites it,
 * anybody can put whatever they like in it and become a different actor for
 * every request, which makes an address-keyed limit worth nothing. So the
 * platform's own header is preferred where it exists — Vercel sets
 * `x-vercel-forwarded-for` itself and a client cannot forge it, because Vercel
 * replaces whatever arrived.
 *
 * On any other host this needs revisiting: behind an untrusted proxy, or none,
 * `x-forwarded-for` is a suggestion. That is a real limitation and the reason no
 * limit in this system is the only thing standing between somebody and an action
 * that matters — the dangerous ones are keyed by something the actor cannot
 * choose freely as well, like the phone number on the order or the account being
 * logged into.
 */

/** Used when the address cannot be determined. Shared, so it limits as a group. */
const UNKNOWN = 'unknown';

export async function clientIp(): Promise<string> {
  const store = await headers();

  // Set by Vercel, and not forgeable there: whatever a client sends under this
  // name is discarded before the function sees it.
  const vercel = store.get('x-vercel-forwarded-for');
  if (vercel) return normalise(vercel);

  const real = store.get('x-real-ip');
  if (real) return normalise(real);

  /*
    The leftmost entry is the original client; everything after it is the chain
    of proxies. Taking the last would key on our own infrastructure and limit the
    whole world as one actor.
  */
  const forwarded = store.get('x-forwarded-for');
  if (forwarded) return normalise(forwarded.split(',')[0] ?? '');

  return UNKNOWN;
}

/**
 * Trimmed, lowercased and bounded.
 *
 * The length cap is not tidiness: this value becomes part of a database key, and
 * a header is attacker-controlled input on most deployments. A megabyte of
 * `x-forwarded-for` should cost a truncated key, not a row that size.
 */
function normalise(value: string): string {
  const trimmed = value.trim().toLowerCase().slice(0, 64);
  return trimmed.length > 0 ? trimmed : UNKNOWN;
}
