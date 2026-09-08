import { z } from 'zod';

/**
 * Supported locales. Armenian is the default and lives at the root path (`/`),
 * the other two are prefixed (`/ru`, `/en`).
 */
export const LOCALES = ['hy', 'ru', 'en'] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'hy';

/** BCP-47 tags used for `Intl.*` formatting. */
export const INTL_TAGS: Record<Locale, string> = {
  hy: 'hy-AM',
  ru: 'ru-AM',
  en: 'en-US',
};

export function isLocale(value: unknown): value is Locale {
  return typeof value === 'string' && (LOCALES as readonly string[]).includes(value);
}

/**
 * A translatable string, stored as a single JSONB column rather than a separate
 * translations table: the menu is small, this avoids joins on every read, and a
 * fourth language can be added without a data migration.
 *
 * Only Armenian is required. Missing translations fall back to it (see `pickLocalized`),
 * so the site never renders a blank name while the owner is still filling the menu in.
 */
export const localizedTextSchema = z.object({
  hy: z.string().trim().min(1),
  ru: z.string().trim().default(''),
  en: z.string().trim().default(''),
});

export type LocalizedText = z.infer<typeof localizedTextSchema>;

/** Same as `localizedTextSchema` but allows an empty Armenian value (e.g. optional descriptions). */
export const optionalLocalizedTextSchema = z.object({
  hy: z.string().trim().default(''),
  ru: z.string().trim().default(''),
  en: z.string().trim().default(''),
});

/** Resolve a translatable value for a locale, falling back to Armenian, then to any non-empty value. */
export function pickLocalized(text: LocalizedText | null | undefined, locale: Locale): string {
  if (!text) return '';
  const exact = text[locale]?.trim();
  if (exact) return exact;

  const fallback = text[DEFAULT_LOCALE]?.trim();
  if (fallback) return fallback;

  return LOCALES.map((l) => text[l]?.trim()).find(Boolean) ?? '';
}

/** Build a `LocalizedText` where every locale holds the same value. Useful in seeds and tests. */
export function uniformLocalized(value: string): LocalizedText {
  return { hy: value, ru: value, en: value };
}

export function emptyLocalized(): LocalizedText {
  return { hy: '', ru: '', en: '' };
}
