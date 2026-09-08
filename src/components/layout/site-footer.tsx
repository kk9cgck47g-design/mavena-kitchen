import { Clock, Mail, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { LogoLockup } from '@/components/brand/logo';
import { InstagramIcon } from '@/components/brand/social-icons';
import { DemoFooterNote } from '@/components/demo/demo-notice';
import { Link } from '@/i18n/navigation';
import { pickLocalized, type Locale } from '@/lib/i18n/locales';
import { RESTAURANT, SERVED_CITIES } from '@/lib/restaurant';
import { todaysHours } from '@/server/services/opening-hours';
import { getSettings } from '@/server/services/settings';

export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations('nav');
  const tf = await getTranslations('footer');
  const th = await getTranslations('home');

  // The hours the site prints have to be the hours the site takes orders by.
  // `getSettings` is cached and already read by every page that matters, so
  // asking for it here costs nothing.
  const settings = await getSettings();
  const hours = todaysHours(settings.workingHours);

  const year = new Date().getFullYear();

  return (
    <footer className="mt-20 border-t border-white/8">
      <DemoFooterNote />
      <div className="mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:grid-cols-2 sm:px-6 lg:grid-cols-[1.2fr_1fr_1fr] lg:gap-12 lg:px-8">
        <div className="sm:col-span-2 lg:col-span-1">
          <LogoLockup className="text-2xl" stacked />
          <p className="text-muted-foreground mt-5 max-w-xs text-sm leading-relaxed">
            {pickLocalized(RESTAURANT.tagline, locale)} · {pickLocalized(SERVED_CITIES, locale)}
          </p>
        </div>

        {/* The footer is where people navigate from on a phone once they have
            scrolled to the end, so its links carry a real 44px target rather
            than a 20px line of text. Vertical padding instead of a gap keeps
            the targets adjacent without overlapping. */}
        <nav className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-widest uppercase">
            {tf('navigation')}
          </p>
          {(['/menu', '/about', '/contacts'] as const).map((href) => (
            <Link
              key={href}
              href={href}
              className="text-muted-foreground hover:text-foreground flex w-fit items-center py-3 transition-colors"
            >
              {t(href.slice(1) as 'menu' | 'about' | 'contacts')}
            </Link>
          ))}
        </nav>

        {/* Interactive contact rows get the same 44px target as navigation. */}
        <div className="flex flex-col gap-1 text-sm">
          <p className="text-muted-foreground mb-1 text-xs font-semibold tracking-widest uppercase">
            {tf('contacts')}
          </p>

          <a
            href={`mailto:${RESTAURANT.email}`}
            className="flex w-fit items-center gap-3 py-3 transition-colors hover:text-lime-400"
          >
            <Mail className="size-4 shrink-0 text-lime-500" />
            <span>{RESTAURANT.email}</span>
          </a>

          {/* Only once the handle is confirmed — see `restaurant.ts`. */}
          {RESTAURANT.instagram && RESTAURANT.instagramUrl && (
            <a
              href={RESTAURANT.instagramUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="flex w-fit items-center gap-3 py-3 transition-colors hover:text-lime-400"
            >
              <InstagramIcon className="size-4 shrink-0 text-lime-500" />
              <span>@{RESTAURANT.instagram}</span>
            </a>
          )}

          <p className="text-muted-foreground flex items-center gap-3 py-3">
            <MapPin className="size-4 shrink-0 text-lime-500" />
            {pickLocalized(RESTAURANT.address, locale)}
          </p>

          <p className="text-muted-foreground flex items-center gap-3 py-3">
            <Clock className="size-4 shrink-0 text-lime-500" />
            {hours ? (
              <span className="tabular-nums">
                {hours.opensAt} – {hours.closesAt}
              </span>
            ) : (
              <span>{th('closedNow')}</span>
            )}
          </p>
        </div>
      </div>

      <div className="border-t border-white/8">
        {/* Last thing on the page, so it owns the home-indicator strip — and,
            being the last thing on the page, its padding is also what the
            document's height ends on. A reserve that changed with Safari's
            toolbar would move the end of the page every time the toolbar did,
            so this one is the constant. See `--bottom-inset-reserve`. */}
        <div
          className="text-muted-foreground mx-auto max-w-7xl px-4 py-6 text-xs sm:px-6 lg:px-8"
          style={{ paddingBottom: 'max(1.5rem, var(--bottom-inset-reserve))' }}
        >
          © {year} {RESTAURANT.name}
        </div>
      </div>
    </footer>
  );
}
