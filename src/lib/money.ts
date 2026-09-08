import { type Locale } from '@/lib/i18n/locales';

/**
 * Money is always an integer number of Armenian drams.
 *
 * The dram has no subunit in everyday use, so there is no reason to carry
 * fractions — and every reason not to: floating point arithmetic on prices
 * silently produces 1499.9999999999998. Nothing in this codebase may store or
 * compute a price as a float.
 */
export type Amd = number;

export class MoneyError extends Error {}

/** Throws if the value is not a safe, non-negative integer. Use at every boundary. */
export function assertAmd(value: unknown, field = 'amount'): asserts value is Amd {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw new MoneyError(`${field} must be an integer number of drams, got: ${String(value)}`);
  }
  if (value < 0) {
    throw new MoneyError(`${field} must not be negative, got: ${value}`);
  }
}

export function sumAmd(values: readonly Amd[]): Amd {
  return values.reduce<Amd>((total, value) => total + value, 0);
}

/** Multiply a price by a quantity. Kept as a function so the integer invariant is enforced in one place. */
export function multiplyAmd(unitPrice: Amd, quantity: number): Amd {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new MoneyError(`quantity must be a non-negative integer, got: ${String(quantity)}`);
  }
  return unitPrice * quantity;
}

/**
 * Apply a percentage discount, rounding down so the customer is never charged
 * more than the advertised discount implies.
 */
export function applyPercent(amount: Amd, percent: number): Amd {
  if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
    throw new MoneyError(`percent must be between 0 and 100, got: ${String(percent)}`);
  }
  return Math.floor((amount * percent) / 100);
}

/** Never let a subtraction produce a negative total. */
export function clampToZero(amount: Amd): Amd {
  return amount < 0 ? 0 : amount;
}

/** The dram sign, U+058F. */
const DRAM = '֏';

/** U+00A0. Keeps `1 350 ֏` from breaking across two lines. */
const NBSP = '\u00A0';

interface AmdFormat {
  /**
   * How many digits the leftmost group must have before grouping is used at
   * all. Armenian is 2, which is why `1350` is written without a separator
   * while `12 500` has one. Russian and English group from four digits up.
   */
  minimumGroupingDigits: number;
  groupSeparator: string;
  place: (digits: string) => string;
}

const FORMATS: Record<Locale, AmdFormat> = {
  hy: {
    minimumGroupingDigits: 2,
    groupSeparator: NBSP,
    place: (digits) => `${digits}${NBSP}${DRAM}`,
  },
  ru: {
    minimumGroupingDigits: 1,
    groupSeparator: NBSP,
    place: (digits) => `${digits}${NBSP}${DRAM}`,
  },
  en: {
    minimumGroupingDigits: 1,
    groupSeparator: ',',
    place: (digits) => `${DRAM}${digits}`,
  },
};

/**
 * e.g. `3500 ֏`.
 *
 * Written out rather than handed to `Intl.NumberFormat`, and that is not
 * reinvention for its own sake.
 *
 * `Intl` output depends on the CLDR data of whatever runtime is executing it,
 * and server and browser do not ship the same one. Node 24 renders `1350 ֏` for
 * Armenian — correct, because Armenian does not separate four-digit numbers —
 * while current Chromium renders `1 350 ֏`. Every Armenian price between 1000
 * and 9999 therefore came out of the server one way and out of the client
 * another, React found the mismatch during hydration, and threw away the entire
 * server-rendered page to re-render it in the browser. On the primary locale,
 * on the menu.
 *
 * A price is the one string on this site that must be identical everywhere it
 * is produced. Twelve lines of arithmetic buy that guarantee outright, and they
 * cannot drift when a runtime updates its locale data.
 *
 * The rules encoded here are CLDR's, and the `narrowSymbol` choice they replace
 * stays: the default rendering gives the literal string "AMD" in Russian and
 * English, and customers here expect the sign.
 */
export function formatAmd(amount: Amd, locale: Locale): string {
  const format = FORMATS[locale] ?? FORMATS.hy;
  const negative = amount < 0;
  const digits = group(
    Math.abs(Math.trunc(amount)).toString(),
    format.groupSeparator,
    format.minimumGroupingDigits,
  );

  return `${negative ? '-' : ''}${format.place(digits)}`;
}

/** Insert a separator every three digits from the right, if the number is long enough to qualify. */
function group(digits: string, separator: string, minimumGroupingDigits: number): string {
  if (digits.length < 3 + minimumGroupingDigits) return digits;

  let out = '';
  for (let i = digits.length; i > 0; i -= 3) {
    const chunk = digits.slice(Math.max(0, i - 3), i);
    out = out === '' ? chunk : `${chunk}${separator}${out}`;
  }
  return out;
}
