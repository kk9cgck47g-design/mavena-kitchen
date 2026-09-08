import type { Metadata } from 'next';
import { Clock, Mail, MapPin } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { InstagramIcon } from '@/components/brand/social-icons';
import { ZoneMap } from '@/components/map/zone-map';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import { RESTAURANT } from '@/lib/restaurant';
import { todaysHours, uniformWeeklyHours } from '@/server/services/opening-hours';
import { getActiveCities, getActiveDeliveryZones, getSettings } from '@/server/services/settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('contacts');
  return { title: t('title'), description: t('subtitle') };
}

export default async function ContactsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const t = await getTranslations('contacts');
  const tcom = await getTranslations('common');
  const tmap = await getTranslations('map');
  const th = await getTranslations('home');
  const [zones, cities, settings] = await Promise.all([
    getActiveDeliveryZones(),
    getActiveCities(),
    getSettings(),
  ]);

  /*
    "Daily 10:00 – 23:00" is only true while every day carries the same window,
    and the panel can set them per day. So: the daily wording when the week is
    uniform, today's plain range when it is not, and the closed label when today
    has no window at all. All three come from the settings row — the constant
    this used to print could not follow a change made in the panel.
  */
  const everyDay = uniformWeeklyHours(settings.workingHours);
  const today = todaysHours(settings.workingHours);
  const hoursValue = everyDay
    ? t('hoursValue', { from: everyDay.opensAt, to: everyDay.closesAt })
    : today
      ? `${today.opensAt} – ${today.closesAt}`
      : th('closedNow');

  const contactCards = [
    {
      icon: Mail,
      label: t('email'),
      value: RESTAURANT.email,
      href: `mailto:${RESTAURANT.email}`,
    },
    // Shown only once the handle is confirmed — see `restaurant.ts`. The grid
    // is `sm:grid-cols-2 lg:grid-cols-4`, so three cards reflow on their own.
    ...(RESTAURANT.instagram && RESTAURANT.instagramUrl
      ? [
          {
            icon: InstagramIcon,
            label: t('instagram'),
            value: `@${RESTAURANT.instagram}`,
            href: RESTAURANT.instagramUrl,
          },
        ]
      : []),
    {
      icon: MapPin,
      label: t('address'),
      value: pickLocalized(RESTAURANT.address, locale),
    },
    {
      icon: Clock,
      label: t('hours'),
      value: hoursValue,
    },
  ];

  return (
    <div className="px-4 pt-24 pb-8 sm:px-6 sm:pt-28 lg:px-8">
      <header className="mx-auto max-w-6xl">
        <h1 className="text-hero font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-4 max-w-xl text-lg">{t('subtitle')}</p>
      </header>

      <section className="mx-auto mt-12 grid max-w-6xl gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {contactCards.map(({ icon: Icon, label, value, href }) => {
          const body = (
            <>
              <span className="flex size-11 items-center justify-center rounded-2xl bg-lime-500/12 text-lime-400">
                <Icon className="size-5" />
              </span>
              <p className="text-muted-foreground mt-4 text-xs font-semibold tracking-widest uppercase">
                {label}
              </p>
              <p className="mt-1.5 font-semibold">{value}</p>
            </>
          );

          return href ? (
            <a
              key={label}
              href={href}
              target={href.startsWith('http') ? '_blank' : undefined}
              rel={href.startsWith('http') ? 'noreferrer noopener' : undefined}
              className="bg-card block rounded-3xl border border-white/6 p-6 transition-colors hover:border-white/14"
            >
              {body}
            </a>
          ) : (
            <div key={label} className="bg-card rounded-3xl border border-white/6 p-6">
              {body}
            </div>
          );
        })}
      </section>

      {/*
        The map shows the delivery polygons, not just a pin on the restaurant.
        The customer's actual question is "do you deliver to me?" — answering it
        here saves them building a cart first and finding out at checkout.
      */}
      <section className="mx-auto mt-16 max-w-6xl">
        <h2 className="text-section font-bold">{t('zonesTitle')}</h2>
        <p className="text-muted-foreground mt-2">{t('zonesSubtitle')}</p>

        <div className="mt-8 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="bg-card h-[22rem] overflow-hidden rounded-3xl border border-white/6 sm:h-[28rem]">
            <ZoneMap
              zones={zones.map((zone) => ({
                id: zone.id,
                cityCode: zone.cityCode,
                name: pickLocalized(zone.name, locale),
                polygon: zone.polygon,
              }))}
              cities={cities.map((city) => ({
                code: city.code,
                name: pickLocalized(city.name, locale),
                center: { lat: city.centerLat, lng: city.centerLng },
              }))}
              restaurant={RESTAURANT.location}
              twoFingerHint={tmap('twoFingerHint')}
            />
          </div>

          <div className="space-y-4">
            {zones.map((zone) => {
              const city = cities.find((c) => c.code === zone.cityCode);
              return (
                <div key={zone.id} className="bg-card rounded-3xl border border-white/6 p-6">
                  <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                    {city ? pickLocalized(city.name, locale) : zone.cityCode}
                  </p>
                  <p className="mt-1 text-lg font-semibold">{pickLocalized(zone.name, locale)}</p>

                  <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                    <dt className="text-muted-foreground">{t('minOrder')}</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {formatAmd(zone.minOrder, locale)}
                    </dd>

                    <dt className="text-muted-foreground">{t('eta')}</dt>
                    <dd className="text-right font-medium tabular-nums">
                      {tcom('minutes', { count: zone.etaMinutes })}
                    </dd>

                    {zone.freeDeliveryFrom !== null && (
                      <>
                        <dt className="text-muted-foreground">{t('freeFrom')}</dt>
                        <dd className="text-right font-semibold text-lime-400 tabular-nums">
                          {formatAmd(zone.freeDeliveryFrom, locale)}
                        </dd>
                      </>
                    )}
                  </dl>
                </div>
              );
            })}
          </div>
        </div>
      </section>
    </div>
  );
}
