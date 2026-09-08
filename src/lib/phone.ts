/**
 * Armenian phone numbers.
 *
 * Customers type these every way imaginable — `093 00 00 00`, `+374 93 000000`,
 * `0931234567`, `00374931234567`. All of them are the same person. Normalising
 * to one canonical form matters beyond tidiness: order lookups, rate limiting
 * and "this customer again" checks all key on the phone number, and they only
 * work if the same person always produces the same string.
 */

/** Canonical form: `+374` followed by exactly 8 digits. */
const NATIONAL_DIGITS = 8;
const COUNTRY_CODE = '374';

export function normalizeArmenianPhone(input: string): string | null {
  let digits = input.replace(/\D/g, '');

  // International prefixes, longest first.
  if (digits.startsWith('00' + COUNTRY_CODE)) digits = digits.slice(2 + COUNTRY_CODE.length);
  else if (digits.startsWith(COUNTRY_CODE)) digits = digits.slice(COUNTRY_CODE.length);
  // Domestic trunk prefix.
  else if (digits.startsWith('0')) digits = digits.slice(1);

  if (digits.length !== NATIONAL_DIGITS) return null;

  return `+${COUNTRY_CODE}${digits}`;
}

export function isValidArmenianPhone(input: string): boolean {
  return normalizeArmenianPhone(input) !== null;
}

/**
 * `+374 93 000000` — operator code, then the synthetic subscriber number unbroken.
 *
 * Armenian numbers conventionally keep the subscriber number unbroken.
 * Splitting the tail into pairs is less familiar to a local reader.
 */
export function formatArmenianPhone(canonical: string): string {
  const digits = canonical.replace(/\D/g, '').slice(-NATIONAL_DIGITS);
  if (digits.length !== NATIONAL_DIGITS) return canonical;

  return `+${COUNTRY_CODE} ${digits.slice(0, 2)} ${digits.slice(2)}`;
}

/** `tel:` href — always the canonical form, never the pretty one. */
export function phoneHref(canonical: string): string {
  return `tel:${canonical.replace(/[^\d+]/g, '')}`;
}
