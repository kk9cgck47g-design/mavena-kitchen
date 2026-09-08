import { DEFAULT_LOCALE, type Locale } from '@/lib/i18n/locales';

/**
 * The site's own absolute URL, used for metadata and shareable links.
 *
 * Resolution order matters:
 *   1. `NEXT_PUBLIC_SITE_URL` — the real domain, once there is one.
 *   2. `VERCEL_URL` — the deployment's own hostname. Every preview deployment
 *      gets a different one, so hard-coding a single URL would give every
 *      preview the production URL in its Open Graph tags.
 *   3. localhost, for development.
 */
export function siteUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit;

  const vercel = process.env.NEXT_PUBLIC_VERCEL_URL ?? process.env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;

  return 'http://localhost:3000';
}

/**
 * An absolute URL for a storefront path, prefixed for the locale.
 *
 * Armenian sits at the root and takes no prefix — `localePrefix: 'as-needed'` in
 * `i18n/routing.ts`. Written out here rather than left to `next-intl`'s navigation
 * helpers because the callers are outside React: a payment adapter building the
 * page it will send a customer to, and a route handler redirecting one back. Both
 * need a string, on the server, with no request context to hand.
 */
export function localeUrl(locale: Locale, path: string): string {
  const prefix = locale === DEFAULT_LOCALE ? '' : `/${locale}`;
  return `${siteUrl()}${prefix}${path}`;
}
