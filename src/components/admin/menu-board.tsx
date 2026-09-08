'use client';

import { useState, useTransition } from 'react';

import { updateDishAvailability, updateDishPrice } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import { pickLocalized } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import type { AdminMenuItem } from '@/server/services/admin-menu';
import { cn } from '@/lib/utils';
import { Card, EmptyState } from './admin-ui';

/**
 * Price and availability, dish by dish.
 *
 * Each row saves on its own. A single form over the whole menu would mean one
 * failed field discards thirty edits, and it would make "the wings have run
 * out" — the thing this screen is opened for mid-service — a four-tap job
 * instead of one.
 *
 * The price is only ever the starting price. Dishes with option groups say so,
 * because a size-based dish is sold at base plus a delta and showing the base
 * alone would misrepresent what a customer pays.
 */
export function MenuBoard({
  items,
  readOnly,
  canEditPrices,
}: {
  items: AdminMenuItem[];
  readOnly: boolean;
  /** False for a manager: the stop list is theirs, the price is not. */
  canEditPrices: boolean;
}) {
  if (items.length === 0) return <EmptyState title={ADMIN_TEXT.menu.title} />;

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <MenuRow key={item.id} item={item} readOnly={readOnly} canEditPrices={canEditPrices} />
      ))}
    </div>
  );
}

function MenuRow({
  item,
  readOnly,
  canEditPrices,
}: {
  item: AdminMenuItem;
  readOnly: boolean;
  canEditPrices: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [price, setPrice] = useState(String(item.basePrice));
  const [available, setAvailable] = useState(item.isAvailable);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const dirty = price.trim() !== String(item.basePrice);

  function savePrice() {
    const value = Number(price.trim());

    if (!Number.isSafeInteger(value) || value < 0) {
      setMessage({ tone: 'error', text: ADMIN_TEXT.menu.invalidPrice });
      return;
    }

    startTransition(async () => {
      const result = await updateDishPrice({ id: item.id, price: value });
      setMessage(
        result.ok
          ? { tone: 'ok', text: ADMIN_TEXT.menu.saved }
          : {
              tone: 'error',
              text:
                result.code === 'INVALID_PRICE'
                  ? ADMIN_TEXT.menu.invalidPrice
                  : ADMIN_TEXT.menu.saveFailed,
            },
      );
    });
  }

  function toggleAvailability() {
    const next = !available;
    // Flipped immediately: the kitchen taps this while holding a pan, and a
    // control that waits for a round trip gets tapped twice.
    setAvailable(next);
    setMessage(null);

    startTransition(async () => {
      const result = await updateDishAvailability({ id: item.id, isAvailable: next });
      if (!result.ok) {
        setAvailable(!next);
        setMessage({ tone: 'error', text: ADMIN_TEXT.menu.saveFailed });
      }
    });
  }

  return (
    <Card className={cn('flex flex-wrap items-center gap-x-4 gap-y-3', !item.isActive && 'opacity-60')}>
      <div className="min-w-0 flex-1">
        <p className="font-semibold">{pickLocalized(item.name, 'ru')}</p>
        <p className="text-muted-foreground mt-0.5 text-xs">
          {pickLocalized(item.categoryName, 'ru')}
          {item.hasOptions && ` · ${ADMIN_TEXT.menu.hasOptions}`}
          {!item.isActive && ` · ${ADMIN_TEXT.menu.inactive}`}
        </p>
        {message && (
          <p
            aria-live="polite"
            className={cn(
              'mt-1 text-xs font-semibold',
              message.tone === 'ok' ? 'text-lime-400' : 'text-destructive',
            )}
          >
            {message.text}
          </p>
        )}
      </div>

      {/* Wraps. The price field, "Save" and the availability switch want 302px
          side by side and a 320px screen leaves the card 256px, so without this
          the row pushed the whole panel 15px wider than the viewport and the
          page scrolled sideways. From 375px up they still fit on one line. */}
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={`price-${item.id}`} className="sr-only">
          {ADMIN_TEXT.menu.price}
        </label>
        <input
          id={`price-${item.id}`}
          value={price}
          disabled={readOnly || pending || !canEditPrices}
          onChange={(event) => {
            setPrice(event.target.value.replace(/[^\d]/g, ''));
            setMessage(null);
          }}
          inputMode="numeric"
          className="bg-elevated h-11 w-24 rounded-xl border border-white/8 px-3 text-right text-base tabular-nums outline-none focus-visible:border-lime-500/60 disabled:opacity-50 sm:text-sm"
        />

        <button
          type="button"
          disabled={readOnly || pending || !dirty || !canEditPrices}
          onClick={savePrice}
          className="bg-elevated flex min-h-11 items-center rounded-xl border border-white/8 px-3.5 text-sm font-semibold transition-colors hover:bg-white/8 disabled:opacity-40"
        >
          {ADMIN_TEXT.menu.save}
        </button>

        <button
          type="button"
          role="switch"
          aria-checked={available}
          disabled={readOnly || pending}
          onClick={toggleAvailability}
          className={cn(
            'flex min-h-11 items-center rounded-xl border px-3.5 text-sm font-semibold transition-colors disabled:opacity-40',
            available
              ? 'border-lime-500/40 bg-lime-500/12 text-lime-400'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {available ? ADMIN_TEXT.menu.available : ADMIN_TEXT.menu.unavailable}
        </button>
      </div>

      <p className="text-muted-foreground w-full text-xs sm:w-auto">
        {item.hasOptions && `${ADMIN_TEXT.menu.fromPrice} `}
        {formatAmd(item.basePrice, 'ru')}
      </p>
    </Card>
  );
}
