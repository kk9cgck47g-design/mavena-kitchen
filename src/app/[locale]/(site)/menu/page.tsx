import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { MenuBrowser } from '@/components/menu/menu-browser';
import { getPublicMenu } from '@/server/services/menu';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('menu');
  return { title: t('title'), description: t('subtitle') };
}

export default async function MenuPage() {
  const categories = await getPublicMenu();
  const t = await getTranslations('menu');

  return (
    <div className="px-4 pt-24 pb-16 sm:px-6 sm:pt-28 lg:px-8">
      <header className="mx-auto max-w-7xl pb-6">
        {/* Page headings use the content typeface, never Archivo. Archivo is
            Latin-only, so an Armenian heading set in it would silently fall
            through to a different face — the primary language ending up with a
            visibly weaker headline than the English one. */}
        <h1 className="text-hero font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-3 max-w-md text-lg">{t('subtitle')}</p>
      </header>

      <MenuBrowser categories={categories} />
    </div>
  );
}
