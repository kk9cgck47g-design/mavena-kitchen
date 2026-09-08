'use client';

import { useLocale, useTranslations } from 'next-intl';

import { Price } from '@/components/ui/price';
import { Skeleton } from '@/components/ui/skeleton';
import type { CheckoutQuote } from '@/lib/checkout-types';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import { cn } from '@/lib/utils';
import type { CartItem } from '@/stores/cart';

/**
 * What the customer is about to pay for.
 *
 * Note what carries a price here and what does not. The dish names and
 * quantities come from the cart in `localStorage`, because that is where the
 * customer's choices live. Every amount comes from the server's quote — none of
 * it is added up in this component, and the cart's cached `unitPrice` is not
 * read at all.
 *
 * That is why the lines show no per-item price: the cart could tell us one, and
 * it would be the price from whenever the dish was added rather than the price
 * the order is being charged at. Showing a stale number next to an authoritative
 * total is worse than showing no number.
 */
export function OrderSummary({
  items,
  quote,
  /** True while a fresh quote is in flight and the amounts shown are the previous ones. */
  stale,
  className,
}: {
  items: CartItem[];
  quote: CheckoutQuote | null;
  stale?: boolean;
  className?: string;
}) {
  const t = useTranslations('cart');
  const tc = useTranslations('checkout');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  /** Every amount, and only once nothing blocks the order. */
  const priced = quote && quote.blocker === null ? quote : null;

  /**
   * What the food costs, which survives a blocked quote.
   *
   * A pin outside every zone stops the order, not the arithmetic — the server
   * sends `subtotal` alongside the blocker precisely so this screen can still
   * answer it. Reading it only from `priced` meant the most common first state
   * of this page, before a city has been chosen, was three grey bars that never
   * resolved: the request had long since come back, so nothing was ever going to
   * replace them.
   */
  const subtotal = quote?.subtotal ?? null;

  /** No answer has arrived yet — the one state a skeleton is honest about. */
  const awaiting = quote === null;

  return (
    <div className={cn('bg-card rounded-3xl border border-white/6 p-5 sm:p-6', className)}>
      <h2 className="text-lg font-bold">{tc('summary')}</h2>

      <ul className="mt-4 space-y-3">
        {items.map((item) => (
          <li key={item.key} className="flex gap-3 text-sm">
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
          </li>
        ))}
      </ul>

      {/* `aria-busy` rather than replacing the numbers: a total that vanishes and
          reappears on every change reads as a glitch, and a screen reader that
          re-announces it each time is worse. */}
      <dl
        aria-busy={stale}
        className={cn(
          'mt-5 space-y-2 border-t border-white/8 pt-5 text-sm transition-opacity',
          stale && 'opacity-50',
        )}
      >
        <Row label={t('subtotal')}>
          {subtotal !== null ? (
            <Price amount={subtotal} />
          ) : awaiting ? (
            <Placeholder />
          ) : (
            <NotYet />
          )}
        </Row>

        <Row label={t('deliveryFee')}>
          {priced ? (
            priced.zone === null ? (
              // Pickup: not free delivery, no delivery.
              <NotYet />
            ) : priced.isFreeDelivery ? (
              <span className="text-lime-400 font-semibold">{t('free')}</span>
            ) : (
              <Price amount={priced.deliveryFee} />
            )
          ) : awaiting ? (
            <Placeholder />
          ) : (
            <NotYet />
          )}
        </Row>

        {/*
          How much more buys free delivery.

          The server has always sent `amountToFreeDelivery` and nothing read it,
          so a customer 300 ֏ short of a free delivery paid for one without ever
          being told. It sits directly under the fee it is about, and only when
          there is something to say: null when the zone has no threshold, and
          null again once the threshold is met.
        */}
        {priced && priced.amountToFreeDelivery !== null && priced.amountToFreeDelivery > 0 && (
          <p className="text-lime-400 text-xs">
            {t('freeDeliveryHint', { amount: formatAmd(priced.amountToFreeDelivery, locale) })}
          </p>
        )}

        <div className="flex items-baseline justify-between gap-4 border-t border-white/8 pt-3">
          <dt className="font-semibold">{t('total')}</dt>
          <dd>
            {priced ? (
              <Price amount={priced.total} className="text-xl font-bold" />
            ) : awaiting ? (
              <Placeholder wide />
            ) : (
              <NotYet />
            )}
          </dd>
        </div>

        {priced && (
          <p className="text-muted-foreground pt-1 text-xs">
            {tc('eta', { minutes: priced.etaMinutes })}
          </p>
        )}
      </dl>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

/** Stands in for an amount the server has not stated yet. Never a zero — that would be a claim. */
function Placeholder({ wide }: { wide?: boolean }) {
  return <Skeleton className={cn('h-4', wide ? 'w-24' : 'w-16')} />;
}

/**
 * An amount that has no value yet and is not being waited for.
 *
 * Distinct from `Placeholder` on purpose: a shimmer promises that a number is
 * on its way, and for a delivery that is blocked — no city, no pin, out of zone
 * — none is. A dash says "not yet" and stops moving.
 */
function NotYet() {
  return <span className="text-muted-foreground">—</span>;
}
