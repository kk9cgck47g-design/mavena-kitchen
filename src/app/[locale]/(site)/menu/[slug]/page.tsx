import type { Metadata } from 'next';
import { ArrowLeft } from 'lucide-react';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';

import { ProductDetail } from '@/components/menu/product-detail';
import { Link } from '@/i18n/navigation';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { getProductBySlug } from '@/server/services/menu';

/**
 * Standalone dish page.
 *
 * Reached by a direct link, a refresh or a shared URL — the intercepted modal
 * handles the in-app case. Both render the same `ProductDetail`, so the two can
 * never drift apart.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; locale: string }>;
}): Promise<Metadata> {
  const { slug, locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'hy';
  const product = await getProductBySlug(slug);

  if (!product) return {};

  const name = pickLocalized(product.name, locale);
  const description = product.description ? pickLocalized(product.description, locale) : undefined;

  return {
    title: name,
    description,
    openGraph: {
      title: name,
      description,
      images: product.images[0] ? [product.images[0]] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const product = await getProductBySlug(slug);

  if (!product) notFound();

  const t = await getTranslations('product');

  return (
    <div className="mx-auto max-w-6xl px-4 pt-24 pb-8 sm:px-6 sm:pt-28 lg:px-8">
      <Link
        href="/menu"
        // The padding grows the tap target to 44px; the negative top margin and
        // the halved bottom margin put the text back exactly where it was.
        className="text-muted-foreground hover:text-foreground group -mt-3 mb-3 inline-flex items-center gap-2 py-3 text-sm font-medium transition-colors"
      >
        <ArrowLeft className="size-4 transition-transform duration-300 group-hover:-translate-x-1" />
        {t('back')}
      </Link>

      <ProductDetail product={product} layout="page" />
    </div>
  );
}
