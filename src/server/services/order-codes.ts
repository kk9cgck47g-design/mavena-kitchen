import { randomBytes, randomInt } from 'node:crypto';

import { RESTAURANT } from '@/lib/restaurant';

/**
 * The two identifiers every order carries, and why there are two.
 *
 * `publicCode` is read aloud on the phone — short, all digits, no ambiguity
 * between O and 0. It is not a secret and is safe to print on a receipt.
 *
 * `trackingToken` is the only thing in the tracking URL. That page shows the
 * customer's name, phone and home address, so the identifier guarding it must be
 * impossible to guess or enumerate. A sequential order number would leak every
 * customer's details to anyone who can count.
 */

export const PUBLIC_CODE_PREFIX = RESTAURANT.orderCodePrefix;
export const PUBLIC_CODE_DIGITS = 6;

export function generatePublicCode(): string {
  const max = 10 ** PUBLIC_CODE_DIGITS;
  return `${PUBLIC_CODE_PREFIX}-${String(randomInt(0, max)).padStart(PUBLIC_CODE_DIGITS, '0')}`;
}

/** 256 bits, URL-safe. */
export function generateTrackingToken(): string {
  return randomBytes(32).toString('base64url');
}
