import { CartBar } from '@/components/cart/cart-bar';
import { CartSheet } from '@/components/cart/cart-sheet';
import { SiteFooter } from '@/components/layout/site-footer';
import { SiteHeader } from '@/components/layout/site-header';
import { isLocale, type Locale } from '@/lib/i18n/locales';

export default async function SiteLayout({
  children,
  modal,
  params,
}: {
  children: React.ReactNode;
  /** Intercepted-route slot — holds the dish sheet over the menu. */
  modal: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  return (
    <div className="flex min-h-svh flex-col">
      <SiteHeader />

      {/* The header is fixed so it can sit over the hero; pages that do not
          start with a full-bleed image add their own top padding. */}
      <main className="flex-1">{children}</main>

      {modal}

      <SiteFooter locale={locale} />

      <CartSheet />
      <CartBar />
    </div>
  );
}
