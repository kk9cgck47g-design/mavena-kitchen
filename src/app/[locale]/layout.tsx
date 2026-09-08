import type { Metadata, Viewport } from 'next';
import { Archivo, Google_Sans } from 'next/font/google';
import { NextIntlClientProvider, hasLocale } from 'next-intl';
import { getTranslations } from 'next-intl/server';
import { notFound } from 'next/navigation';

import { Toaster } from '@/components/ui/sonner';
import { routing } from '@/i18n/routing';
import { DEFAULT_LOCALE, INTL_TAGS, isLocale, type Locale } from '@/lib/i18n/locales';
import { RESTAURANT } from '@/lib/restaurant';
import { siteUrl } from '@/lib/site-url';
import '../globals.css';

/**
 * Typography.
 *
 * Of every family on Google Fonts, only six carry Armenian glyphs — and Google
 * Sans is the one that also covers Cyrillic and Latin. That single fact settles
 * the whole system: one typeface sets Armenian, Russian and English content, so
 * headlines look like siblings across all three languages instead of the primary
 * audience getting a visibly weaker face.
 *
 * Archivo is Latin-only and is used ONLY for brand moments that are Latin by
 * nature — the wordmark and the hero lockup. The restaurant's name is Latin, so
 * that is legitimate; using it for real headlines would not be.
 *
 * The stack itself is written out by family name in globals.css, not via these
 * variables. next/font pairs each family with a metric-matched fallback whose
 * unicode-range is U+0-10FFFF — a catch-all that swallows every script before
 * the next real family is reached. Left in place it means Armenian silently
 * renders in whatever the device happens to have, and the Armenian webfont is
 * never even downloaded.
 */
const googleSans = Google_Sans({
  subsets: ['latin', 'cyrillic', 'armenian'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-google-sans',
  display: 'swap',
  /*
    No metric-matched fallback — the decision the comment above explains, stated
    rather than inherited.

    Today next/font ships no metrics for this family, so it skips the fallback on
    its own and says so: "Failed to find font override values for font `Google
    Sans`" on every build. That warning is not silenced by this option, which
    Turbopack evaluates after the lookup it warns about; it is the build
    reporting a gap in its own metrics table, and it goes away when Google Sans
    is added to that table or when the typeface changes. Neither is worth doing
    to quieten a line of build output — Google Sans is the only family on Google
    Fonts covering Armenian, Cyrillic and Latin, which is the whole reason the
    typography works across three languages.

    What the option does buy is that the day those metrics do arrive, the
    fallback is still not generated. Its unicode-range is a catch-all, and left
    in the stack it swallows every script before the next real family is reached
    — Armenian silently rendering in whatever the device happens to have.
  */
  adjustFontFallback: false,
});

const archivo = Archivo({
  subsets: ['latin'],
  weight: ['700', '800', '900'],
  variable: '--font-archivo',
  display: 'swap',
});

/**
 * Site-wide metadata, in the language of the page.
 *
 * This was a static object with an English title and an English description,
 * which every locale inherited: an Armenian visitor's browser tab, their
 * bookmark and anything they shared to a chat all read "Burgers worth the
 * wait". Only the inner pages were ever translated, because only they defined
 * their own. The per-page `title` values feed the template below, so they are
 * unaffected.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : DEFAULT_LOCALE;
  const t = await getTranslations({ locale, namespace: 'brand' });

  const title = `${RESTAURANT.name} — ${t('tagline')}`;
  const description = t('description');

  return {
    metadataBase: new URL(siteUrl()),
    title: { default: title, template: `%s · ${RESTAURANT.name}` },
    description,
    applicationName: RESTAURANT.name,
    /*
      `icon.svg` alone leaves browsers probing `/favicon.ico` and logging the
      404 they get, which is noise in every console the site is opened in.
      Declaring the shortcut explicitly points that probe at the icon that does
      exist, and costs no second asset to maintain.
    */
    icons: { icon: '/icon.svg', shortcut: '/icon.svg', apple: '/icon.svg' },
    appleWebApp: { capable: true, statusBarStyle: 'black-translucent', title: RESTAURANT.name },
    openGraph: {
      type: 'website',
      siteName: RESTAURANT.name,
      title,
      description,
      locale: INTL_TAGS[locale],
    },
  };
}

export const viewport: Viewport = {
  themeColor: '#0A0A09',
  // The layout is fluid down to 320px; zoom stays enabled because disabling it
  // is an accessibility failure, not a design choice.
  width: 'device-width',
  initialScale: 1,
  /**
   * Without this, iOS reports every `env(safe-area-inset-*)` as zero — the
   * whole family only becomes non-zero once the page opts into drawing under
   * the notch and the home indicator. Every use of it in this codebase (the
   * cart bar, the dish page's action bar, the footer) was therefore doing
   * nothing at all, and the lime cart bar sat directly under the home
   * indicator on any modern iPhone.
   */
  viewportFit: 'cover',
};

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) notFound();

  return (
    <html lang={locale} className={`${googleSans.variable} ${archivo.variable}`}>
      {/*
        `svh`, not `dvh`. The dynamic unit is re-resolved every time Safari's
        toolbar expands or collapses, so a page whose height comes from this
        minimum grows and shrinks by the height of that toolbar while it
        animates — and the browser answers by clamping the scroll position,
        which reads as the page kicking underneath you. The small viewport is
        the one that never changes; the hero has always used it for the same
        reason.
      */}
      <body className="min-h-svh antialiased">
        <NextIntlClientProvider>
          {children}
          {/*
            Offset below the fixed header. A top-centre toast at the default
            offset lands squarely on top of it, so "added to the cart" hid the
            cart button and its counter at exactly the moment the customer
            wanted to watch the number go up.
          */}
          <Toaster
            position="top-center"
            offset="calc(var(--header-height) + 0.75rem)"
            mobileOffset="calc(var(--header-height) + 0.75rem)"
          />
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
