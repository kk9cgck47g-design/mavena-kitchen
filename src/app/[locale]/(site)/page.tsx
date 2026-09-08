import Image from 'next/image';
import { ArrowRight, BikeIcon, ChefHat, FlameKindling } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { Hero } from '@/components/home/hero';
import { DishCard } from '@/components/menu/dish-card';
import { Link } from '@/i18n/navigation';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import { aboutPhoto } from '@/server/db/placeholder-photos';
import { getPublicMenu } from '@/server/services/menu';
import { getOrderingWindow, todaysHours } from '@/server/services/opening-hours';
import { getActiveCities, getActiveDeliveryZones, getSettings } from '@/server/services/settings';

export default async function HomePage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const t = await getTranslations('home');
  const tc = await getTranslations('contacts');
  const tn = await getTranslations('nav');
  const tcom = await getTranslations('common');

  const [menu, settings, zones, cities] = await Promise.all([
    getPublicMenu(),
    getSettings(),
    getActiveDeliveryZones(),
    getActiveCities(),
  ]);

  const window = getOrderingWindow(settings.workingHours, settings.isAcceptingOrders);

  // "Ordered most often" is driven by the HIT badge the owner controls in the
  // admin panel, not by a hard-coded list of slugs.
  const featured = menu
    .flatMap((category) => category.products)
    .filter((product) => product.badges.includes('HIT'))
    .slice(0, 4);

  const dishCount = menu.reduce((total, category) => total + category.products.length, 0);
  const fastestEta = Math.min(...zones.map((zone) => zone.etaMinutes));
  /*
    The slow end of the range as well as the fast one. The copy used to say
    "35–55 minutes" as a fixed string, which was wrong the moment a slower zone
    was added — and would go on being wrong every time a zone is edited.
    Both ends are read from the zones now, so the sentence cannot drift.
  */
  const slowestEta = Math.max(...zones.map((zone) => zone.etaMinutes));

  const features = [
    {
      icon: BikeIcon,
      title: t('featureFastTitle'),
      text: t('featureFastText', { from: fastestEta, to: slowestEta }),
    },
    { icon: FlameKindling, title: t('featureFreshTitle'), text: t('featureFreshText') },
    { icon: ChefHat, title: t('featureQualityTitle'), text: t('featureQualityText') },
  ];

  return (
    <>
      <Hero isOpen={window.canOrder} hours={todaysHours(settings.workingHours)} />

      {/* --- Value strip ------------------------------------------------- */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="bg-card shadow-card grid gap-px overflow-hidden rounded-3xl border border-white/6 sm:grid-cols-3">
          {features.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-card flex items-start gap-4 p-6 sm:p-7">
              <span className="bg-lime-500/12 text-lime-400 flex size-11 shrink-0 items-center justify-center rounded-2xl">
                <Icon className="size-5" />
              </span>
              <div>
                <p className="font-semibold">{title}</p>
                <p className="text-muted-foreground mt-1 text-sm leading-snug">{text}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* --- Featured ----------------------------------------------------- */}
      {featured.length > 0 && (
        <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h2 className="text-section font-bold">{t('featuredTitle')}</h2>
              <p className="text-muted-foreground mt-2">{t('featuredSubtitle')}</p>
            </div>

            <Link
              href="/menu"
              // `-my-3 py-3`: a 44px tap target, same position on the page.
              className="group text-muted-foreground hover:text-foreground -my-3 flex items-center gap-2 py-3 text-sm font-semibold transition-colors"
            >
              {t('seeAll')}
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>

          <div className="mt-8 grid grid-cols-2 gap-4 sm:gap-5 lg:grid-cols-4">
            {featured.map((product) => (
              <DishCard key={product.id} product={product} featured />
            ))}
          </div>
        </section>
      )}

      {/* --- Categories --------------------------------------------------- */}
      <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-section font-bold">{t('categoriesTitle')}</h2>
        <p className="text-muted-foreground mt-2">{t('categoriesSubtitle')}</p>

        <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 md:grid-cols-4 lg:grid-cols-5">
          {menu.map((category) => (
            <Link
              key={category.id}
              href={`/menu#category-${category.slug}`}
              className="group bg-card relative overflow-hidden rounded-2xl border border-white/6 p-5 transition-colors hover:border-white/12"
            >
              {category.products[0]?.images[0] && (
                <Image
                  src={category.products[0].images[0]}
                  alt=""
                  fill
                  sizes="(min-width: 1024px) 20vw, (min-width: 640px) 33vw, 50vw"
                  className="object-cover opacity-20 transition-[opacity,transform] duration-500 group-hover:scale-105 group-hover:opacity-35"
                />
              )}
              {/* The tile is a label first and a picture second, so the photo is
                  pushed well back — otherwise ten thumbnails at full strength turn
                  the section into visual noise. */}
              <div className="bg-coal-1000/45 absolute inset-0" />
              <div className="from-coal-1000 absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />

              <div className="relative flex h-24 flex-col justify-end">
                <p className="leading-tight font-semibold text-balance">
                  {pickLocalized(category.name, locale)}
                </p>
                <p className="text-muted-foreground mt-1 text-xs tabular-nums">
                  {category.products.length}
                </p>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* --- About -------------------------------------------------------- */}
      <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="bg-card grid overflow-hidden rounded-3xl border border-white/6 lg:grid-cols-2">
          <div className="flex flex-col justify-center p-8 sm:p-12">
            <h2 className="text-section font-bold text-balance">{t('aboutTitle')}</h2>
            <p className="text-muted-foreground mt-5 leading-relaxed">{t('aboutText')}</p>

            {/*
              Every figure here is read from the system, not asserted.

              The first used to be a literal `3+` against a claim about the
              business nobody had confirmed, sitting in lime beside two numbers
              that were genuinely derived. The count of delivery zones actually
              configured says something true, and goes on being true when a zone
              is added or removed.
            */}
            <dl className="mt-9 grid grid-cols-3 gap-4">
              {[
                { value: String(zones.length), label: t('aboutStatZones') },
                { value: String(dishCount), label: t('aboutStatDishes') },
                { value: String(fastestEta), label: t('aboutStatMinutes') },
              ].map((stat) => (
                <div key={stat.label}>
                  <dt className="text-lime-500 text-3xl font-bold tabular-nums">{stat.value}</dt>
                  <dd className="text-muted-foreground mt-1 text-xs leading-snug">{stat.label}</dd>
                </div>
              ))}
            </dl>

            <Link
              href="/about"
              className="group mt-6 flex w-fit items-center gap-2 py-3 text-sm font-semibold"
            >
              {tn('about')}
              <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
            </Link>
          </div>

          <div className="relative min-h-64 lg:min-h-full">
            <Image
              src={aboutPhoto(1200)}
              alt=""
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
            />
            {/* The blend runs along whichever edge meets the text: downwards when
                the image stacks above it, sideways once they sit side by side. */}
            <div className="from-card absolute inset-0 bg-gradient-to-b to-transparent lg:bg-gradient-to-r" />
          </div>
        </div>
      </section>

      {/* --- Delivery ----------------------------------------------------- */}
      <section className="mx-auto mt-24 max-w-7xl px-4 sm:px-6 lg:px-8">
        <h2 className="text-section font-bold">{t('deliveryTitle')}</h2>
        <p className="text-muted-foreground mt-2 max-w-xl">{t('deliverySubtitle')}</p>

        <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {zones.map((zone) => {
            const city = cities.find((c) => c.code === zone.cityCode);
            return (
              <div
                key={zone.id}
                className="bg-card flex flex-col rounded-3xl border border-white/6 p-6"
              >
                <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
                  {city ? pickLocalized(city.name, locale) : zone.cityCode}
                </p>
                <p className="mt-1 text-lg font-semibold">{pickLocalized(zone.name, locale)}</p>

                <dl className="mt-5 space-y-2.5 text-sm">
                  <Row label={t('deliveryTitle')} value={formatAmd(zone.fee, locale)} />
                  <Row label={tc('minOrder')} value={formatAmd(zone.minOrder, locale)} />
                  {zone.freeDeliveryFrom !== null && (
                    <Row
                      label={tc('freeFrom')}
                      value={formatAmd(zone.freeDeliveryFrom, locale)}
                      accent
                    />
                  )}
                  <Row label={tc('eta')} value={tcom('minutes', { count: zone.etaMinutes })} />
                </dl>
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <Link
            href="/menu"
            className="bg-lime-500 text-primary-foreground shadow-lime hover:bg-lime-400 group flex h-14 items-center gap-2 rounded-2xl px-8 font-bold transition-colors"
          >
            {t('orderNow')}
            <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>
        </div>
      </section>
    </>
  );
}

function Row({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={accent ? 'text-lime-400 font-semibold tabular-nums' : 'font-medium tabular-nums'}>
        {value}
      </dd>
    </div>
  );
}
