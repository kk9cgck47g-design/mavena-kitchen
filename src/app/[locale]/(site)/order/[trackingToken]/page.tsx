import type { Metadata } from 'next';
import { CheckCircle2, Mail, MapPin, Store } from 'lucide-react';
import { getFormatter, getTranslations } from 'next-intl/server';

import { OrderTracker } from '@/components/order/order-tracker';
import { PaymentPanel } from '@/components/order/payment-panel';
import { Link } from '@/i18n/navigation';
import { IS_DEMO } from '@/lib/demo';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import { RESTAURANT } from '@/lib/restaurant';
import { getOrderView } from '@/server/services/orders';

/**
 * The order, from the moment it is placed until it arrives.
 *
 * The URL carries the tracking token and nothing else. It is not the order's
 * number: this page shows a name, a phone number and a home address, so an
 * identifier anyone could count up to would hand every customer's details to
 * whoever bothered to try. The short `MK-xxxxxx` code is for reading aloud on
 * the phone and appears on the page, never in the address bar.
 *
 * Everything that moves lives in `OrderTracker`; everything here is settled the
 * moment the order exists and never changes again.
 */

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('order');

  return {
    title: t('thanks'),
    // Never indexed and never sent as a referrer: the URL is the secret, and a
    // search engine or an outbound link would spread it.
    robots: { index: false, follow: false },
    referrer: 'no-referrer',
  };
}

export default async function OrderPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string; trackingToken: string }>;
  /**
   * Set by the payment return handler, and presentation only: it turns an
   * unchanged screen into "that card was declined, try again". Nothing is decided
   * from it — the order's own state says what may happen next, so appending it by
   * hand changes a sentence and no more.
   */
  searchParams: Promise<{ payment?: string }>;
}) {
  const { locale: raw, trackingToken } = await params;
  const { payment: paymentHint } = await searchParams;
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const t = await getTranslations('order');
  const tc = await getTranslations('cart');
  const tch = await getTranslations('checkout');
  const tp = await getTranslations('payment');
  const format = await getFormatter();

  const order = await getOrderView(trackingToken);

  // An explanation rather than a bare 404. The link is the only way back to an
  // order, so someone who truncated it when pasting needs to be told that is
  // what happened.
  if (!order) {
    return (
      <div className="mx-auto max-w-md px-4 pt-32 pb-16 text-center sm:px-6">
        <h1 className="text-section font-bold">{t('notFound')}</h1>
        <p className="text-muted-foreground mt-3">{t('notFoundHint')}</p>
        <a
          href={`mailto:${RESTAURANT.email}`}
          className="bg-elevated mt-8 inline-flex min-h-11 items-center gap-2 rounded-full border border-white/8 px-6 text-sm font-semibold"
        >
          <Mail className="size-4 text-lime-500" />
          {RESTAURANT.email}
        </a>
      </div>
    );
  }

  const isDelivery = order.type === 'DELIVERY';

  return (
    <div className="mx-auto max-w-2xl px-4 pt-24 pb-12 sm:px-6 sm:pt-28">
      <header className="text-center">
        <span className="mx-auto flex size-16 items-center justify-center rounded-full bg-lime-500/12 text-lime-400">
          <CheckCircle2 className="size-8" />
        </span>
        <h1 className="text-section mt-5 font-bold">{t('thanks')}</h1>
        <p className="text-muted-foreground mt-2 text-lg tabular-nums">
          {t('number', { code: order.publicCode })}
        </p>
        <p className="text-muted-foreground mt-1 text-sm tabular-nums">
          {t('placedAt', {
            time: format.dateTime(new Date(order.createdAt), {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            }),
          })}
        </p>
      </header>

      {/* The money comes before the progress bar, and only for an online order.
          While an order is waiting to be paid there is no progress to report and
          exactly one thing the customer can do; putting a stalled tracker above it
          would bury the button under six greyed-out steps. */}
      <PaymentPanel
        trackingToken={trackingToken}
        paymentMethod={order.paymentMethod}
        paymentStatus={order.paymentStatus}
        status={order.status}
        paymentExpiresAt={order.paymentExpiresAt}
        justFailed={paymentHint === 'failed'}
      />

      <OrderTracker
        token={trackingToken}
        type={order.type}
        initial={{
          status: order.status,
          updatedAt: order.updatedAt,
          etaMinutes: order.etaMinutes,
          cancelReason: order.cancelReason,
          paymentStatus: order.paymentStatus,
        }}
        demoOrderId={IS_DEMO ? order.id : null}
      />

      <p className="text-muted-foreground mt-4 text-center text-sm">{t('trackHint')}</p>

      <section className="bg-card mt-8 rounded-3xl border border-white/6 p-5 sm:p-6">
        <h2 className="text-lg font-bold">{t('items')}</h2>

        <ul className="mt-4 space-y-3">
          {order.items.map((item) => (
            <li key={item.id} className="flex gap-3 text-sm">
              <span className="bg-elevated text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums">
                {item.quantity}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block leading-snug font-medium">
                  {pickLocalized(item.name, locale)}
                </span>
                {item.options.length > 0 && (
                  <span className="text-muted-foreground block text-xs leading-snug">
                    {item.options.map((option) => pickLocalized(option.name, locale)).join(' · ')}
                  </span>
                )}
              </span>
              <span className="shrink-0 font-medium tabular-nums">
                {formatAmd(item.lineTotal, locale)}
              </span>
            </li>
          ))}
        </ul>

        <dl className="mt-5 space-y-2 border-t border-white/8 pt-5 text-sm">
          <Row label={tc('subtotal')} value={formatAmd(order.subtotal, locale)} />
          {isDelivery && (
            <Row
              label={tc('deliveryFee')}
              value={order.deliveryFee === 0 ? tc('free') : formatAmd(order.deliveryFee, locale)}
              accent={order.deliveryFee === 0}
            />
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-white/8 pt-3">
            <dt className="font-semibold">{tc('total')}</dt>
            <dd className="text-xl font-bold tabular-nums">{formatAmd(order.total, locale)}</dd>
          </div>
          <Row label={tch('paymentSection')} value={tp(order.paymentMethod)} muted />
        </dl>
      </section>

      <section className="bg-card mt-4 rounded-3xl border border-white/6 p-5 sm:p-6">
        <h2 className="text-muted-foreground flex items-center gap-2 text-xs font-semibold tracking-widest uppercase">
          {isDelivery ? <MapPin className="size-4" /> : <Store className="size-4" />}
          {isDelivery ? t('deliveryTo') : t('pickupFrom')}
        </h2>

        <p className="mt-2 font-semibold">
          {isDelivery ? order.address : pickLocalized(RESTAURANT.address, locale)}
        </p>
        {isDelivery && order.landmark && (
          <p className="text-muted-foreground mt-1 text-sm">{order.landmark}</p>
        )}
        {order.notes && (
          <p className="text-muted-foreground mt-3 border-t border-white/8 pt-3 text-sm">
            {order.notes}
          </p>
        )}
      </section>

      <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
        <a
          href={`mailto:${RESTAURANT.email}`}
          className="bg-elevated flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/8 px-6 text-sm font-semibold transition-colors hover:bg-white/8"
        >
          <Mail className="size-4 text-lime-500" />
          {t('contactUs')}
        </a>
        <Link
          href="/menu"
          className="text-muted-foreground hover:text-foreground flex min-h-12 items-center justify-center px-6 text-sm font-semibold transition-colors"
        >
          {tc('browseMenu')}
        </Link>
      </div>
    </div>
  );
}

function Row({
  label,
  value,
  accent,
  muted,
}: {
  label: string;
  value: string;
  accent?: boolean;
  muted?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd
        className={
          accent
            ? 'font-semibold text-lime-400'
            : muted
              ? 'text-muted-foreground text-xs'
              : 'tabular-nums'
        }
      >
        {value}
      </dd>
    </div>
  );
}
