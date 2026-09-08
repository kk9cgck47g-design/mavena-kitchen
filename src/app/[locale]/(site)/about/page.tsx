import type { Metadata } from 'next';
import Image from 'next/image';
import { HandHeart, MapPinned, ReceiptText } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { aboutPhoto } from '@/server/db/placeholder-photos';
import { getPublicMenu } from '@/server/services/menu';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('about');
  return { title: t('title'), description: t('lead') };
}

export default async function AboutPage() {
  const t = await getTranslations('about');
  const th = await getTranslations('home');
  const menu = await getPublicMenu();

  const dishCount = menu.reduce((total, category) => total + category.products.length, 0);

  const values = [
    { icon: ReceiptText, title: t('value1Title'), text: t('value1Text') },
    { icon: HandHeart, title: t('value2Title'), text: t('value2Text') },
    { icon: MapPinned, title: t('value3Title'), text: t('value3Text') },
  ];

  return (
    <div className="px-4 pt-24 pb-8 sm:px-6 sm:pt-28 lg:px-8">
      <header className="mx-auto max-w-3xl text-center">
        <h1 className="text-hero font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mx-auto mt-5 max-w-xl text-lg text-balance">
          {t('lead')}
        </p>
      </header>

      <div className="relative mx-auto mt-14 aspect-[21/9] max-w-6xl overflow-hidden rounded-3xl">
        <Image
          src={aboutPhoto()}
          alt=""
          fill
          priority
          sizes="(min-width: 1152px) 72rem, 100vw"
          className="object-cover"
        />
        <div className="from-coal-1000/80 absolute inset-0 bg-gradient-to-t to-transparent" />
      </div>

      <section className="mx-auto mt-16 grid max-w-6xl gap-12 lg:grid-cols-[1fr_1.3fr]">
        <h2 className="text-section font-bold text-balance">{t('storyTitle')}</h2>
        <p className="text-muted-foreground text-lg leading-relaxed">{t('storyText')}</p>
      </section>

      <section className="mx-auto mt-20 max-w-6xl">
        <h2 className="text-section font-bold">{t('valuesTitle')}</h2>

        <div className="mt-8 grid gap-4 sm:grid-cols-3">
          {values.map(({ icon: Icon, title, text }) => (
            <div key={title} className="bg-card rounded-3xl border border-white/6 p-7">
              <span className="bg-lime-500/12 text-lime-400 flex size-12 items-center justify-center rounded-2xl">
                <Icon className="size-5.5" />
              </span>
              <p className="mt-5 text-lg font-semibold">{title}</p>
              <p className="text-muted-foreground mt-2 leading-relaxed">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="mx-auto mt-20 max-w-6xl">
        <dl className="bg-card grid gap-px overflow-hidden rounded-3xl border border-white/6 sm:grid-cols-3">
          {[
            { value: '3+', label: th('aboutStatYears') },
            { value: String(dishCount), label: th('aboutStatDishes') },
            { value: '35', label: th('aboutStatMinutes') },
          ].map((stat) => (
            <div key={stat.label} className="bg-card p-8 text-center">
              <dt className="text-lime-500 text-4xl font-bold tabular-nums">{stat.value}</dt>
              <dd className="text-muted-foreground mt-2 text-sm">{stat.label}</dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
