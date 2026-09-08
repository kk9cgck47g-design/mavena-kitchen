import { defineRouting } from 'next-intl/routing';

import { DEFAULT_LOCALE, LOCALES } from '@/lib/i18n/locales';

/**
 * Armenian lives at the root (`/menu`), the other two are prefixed
 * (`/ru/menu`, `/en/menu`).
 *
 * The root belongs to the primary audience: an unprefixed domain is what local
 * search results and shared links look like, and it keeps the URL customers type
 * as short as possible.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: 'as-needed',
  localeDetection: true,
});
