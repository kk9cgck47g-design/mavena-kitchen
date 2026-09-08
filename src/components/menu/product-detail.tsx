'use client';

import { useMemo, useState } from 'react';
import Image from 'next/image';
import { Check, Flame } from 'lucide-react';
import { motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Price } from '@/components/ui/price';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import type { MenuOptionGroup, MenuProduct, SelectedOption } from '@/lib/menu-types';
import { defaultSelection, unitPriceFor } from '@/lib/menu-types';
import { cn } from '@/lib/utils';
import { DISH_BLUR_DATA_URL } from '@/server/db/placeholder-photos';
import { useCart } from '@/stores/cart';

const BADGE_STYLES: Record<string, string> = {
  NEW: 'bg-lime-500 text-primary-foreground',
  HIT: 'bg-white text-coal-950',
  SPICY: 'bg-destructive text-white',
  VEGETARIAN: 'bg-lime-700 text-white',
};

/**
 * Dish detail: photo, options, quantity, add.
 *
 * Shared by the modal and the standalone page, so the two can never drift apart.
 *
 * The add button always carries the live total. A customer picking a large size
 * and two extras should never have to work out what they are about to pay — the
 * number under their thumb updates as they tap.
 */
export function ProductDetail({
  product,
  onAdded,
  layout = 'page',
}: {
  product: MenuProduct;
  /** Lets the modal close itself once the dish is in the cart. */
  onAdded?: () => void;
  layout?: 'page' | 'modal';
}) {
  const t = useTranslations('product');
  const tm = useTranslations('menu');
  const tb = useTranslations('badge');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const add = useCart((s) => s.add);

  const [selected, setSelected] = useState<SelectedOption[]>(() => defaultSelection(product));
  const [quantity, setQuantity] = useState(1);

  const groups = product.optionGroups.filter((group) => group.isActive);
  const unitPrice = useMemo(() => unitPriceFor(product, selected), [product, selected]);
  const selectedIds = useMemo(() => new Set(selected.map((o) => o.id)), [selected]);

  /** A group is unsatisfied when fewer options are ticked than it demands. */
  const unsatisfied = groups.filter(
    (group) => countIn(group, selectedIds) < group.minSelect,
  );
  const canAdd = product.isAvailable && unsatisfied.length === 0;

  function toggle(group: MenuOptionGroup, optionId: string) {
    const option = group.options.find((o) => o.id === optionId);
    if (!option || !option.isActive) return;

    setSelected((current) => {
      const groupOptionIds = new Set(group.options.map((o) => o.id));
      const outsideGroup = current.filter((o) => !groupOptionIds.has(o.id));
      const insideGroup = current.filter((o) => groupOptionIds.has(o.id));
      const alreadyOn = insideGroup.some((o) => o.id === optionId);

      if (group.type === 'SINGLE') {
        // A required single-choice group cannot be emptied by tapping the
        // active option — that would leave the dish unorderable with no
        // explanation. Optional ones can.
        if (alreadyOn && group.minSelect > 0) return current;
        if (alreadyOn) return outsideGroup;
        return [...outsideGroup, toSelected(option)];
      }

      if (alreadyOn) {
        return [...outsideGroup, ...insideGroup.filter((o) => o.id !== optionId)];
      }

      // At the limit, adding another silently drops the oldest rather than
      // refusing the tap. Refusing feels broken; the customer just sees nothing.
      const next =
        insideGroup.length >= group.maxSelect ? insideGroup.slice(1) : insideGroup;

      return [...outsideGroup, ...next, toSelected(option)];
    });
  }

  function handleAdd() {
    if (!canAdd) return;

    add(
      {
        productId: product.id,
        slug: product.slug,
        name: product.name,
        image: product.images[0] ?? null,
        options: selected,
        unitPrice,
      },
      quantity,
    );

    toast.success(tm('added'), { description: pickLocalized(product.name, locale) });
    onAdded?.();
  }

  const name = pickLocalized(product.name, locale);
  const description = product.description ? pickLocalized(product.description, locale) : null;

  return (
    <div
      className={cn(
        'flex flex-col',
        // In the modal this is the one child of a column flexbox with a height
        // cap, so it has to be allowed to shrink below its own content —
        // `min-h-0` is what lifts the automatic minimum size that would
        // otherwise keep it at full height and push the action bar out of the
        // panel. On the page there is no cap and nothing to shrink against.
        layout === 'modal' ? 'min-h-0 flex-1' : 'h-full lg:flex-row lg:gap-12',
      )}
    >
      <div
        className={cn(
          'relative shrink-0 overflow-hidden',
          layout === 'modal'
            // The cap only ever bites on a short viewport — a phone held
            // sideways, where the aspect ratio alone would ask for more height
            // than the whole panel has and leave nothing for the options or the
            // add button. 45svh is chosen to clear the ratio everywhere it
            // already fits: every portrait width from 320 up, and the desktop
            // panel, keep the photograph they were designed with, uncropped.
            ? 'aspect-[16/10] max-h-[45svh] w-full'
            : 'aspect-square w-full rounded-3xl lg:sticky lg:top-28 lg:w-1/2 lg:self-start',
        )}
      >
        {product.images[0] && (
          <Image
            src={product.images[0]}
            alt={name}
            fill
            priority
            sizes={layout === 'modal' ? '(min-width: 640px) 40rem, 100vw' : '(min-width: 1024px) 50vw, 100vw'}
            placeholder="blur"
            blurDataURL={DISH_BLUR_DATA_URL}
            className={cn('object-cover', !product.isAvailable && 'grayscale')}
          />
        )}

        {layout === 'modal' && (
          <div className="from-card absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t to-transparent" />
        )}

        {product.badges.length > 0 && (
          <div className="absolute top-4 left-4 flex flex-wrap gap-1.5">
            {product.badges.map((badge) => (
              <span
                key={badge}
                className={cn(
                  'rounded-full px-2.5 py-1 text-[0.65rem] font-bold tracking-wide uppercase',
                  BADGE_STYLES[badge],
                )}
              >
                {tb(badge)}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={cn('flex min-h-0 flex-1 flex-col', layout === 'modal' && 'overflow-hidden')}>
        <div
          className={cn(
            'flex-1',
            // `overscroll-contain` in the modal: a flick that reaches the end
            // of the options list stops there rather than scrolling the menu
            // behind the sheet.
            layout === 'modal'
              ? 'overflow-y-auto overscroll-contain px-5 pt-5 pb-4 sm:px-7'
              : 'pt-8',
          )}
        >
          <h1 className="text-3xl leading-tight font-bold text-balance sm:text-4xl">{name}</h1>

          {description && (
            <p className="text-muted-foreground mt-3 leading-relaxed">{description}</p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
            <Price amount={unitPrice} className="text-2xl font-bold" />

            {product.weightGrams && (
              <span className="text-muted-foreground">
                {t('weight')} · {product.weightGrams} g
              </span>
            )}
            {product.calories && (
              <span className="text-muted-foreground">
                {t('calories')} · {product.calories}
              </span>
            )}
          </div>

          {!product.isAvailable && (
            <p className="bg-destructive/12 text-destructive mt-5 rounded-2xl px-4 py-3 text-sm font-medium">
              {tm('unavailable')}
            </p>
          )}

          <div className="mt-8 space-y-7">
            {groups.map((group) => {
              const chosen = countIn(group, selectedIds);
              const missing = chosen < group.minSelect;

              return (
                <fieldset key={group.id}>
                  <legend className="flex w-full items-baseline justify-between gap-3">
                    <span className="font-semibold">{pickLocalized(group.name, locale)}</span>
                    <span
                      className={cn(
                        'text-xs font-medium',
                        missing ? 'text-lime-400' : 'text-muted-foreground',
                      )}
                    >
                      {group.type === 'SINGLE'
                        ? group.minSelect > 0
                          ? t('required')
                          : t('optional')
                        : t('chooseUpTo', { count: group.maxSelect })}
                    </span>
                  </legend>

                  <div className="mt-3 space-y-2">
                    {group.options
                      .filter((option) => option.isActive)
                      .map((option) => {
                        const active = selectedIds.has(option.id);
                        return (
                          <button
                            key={option.id}
                            type="button"
                            onClick={() => toggle(group, option.id)}
                            aria-pressed={active}
                            className={cn(
                              'flex w-full items-center gap-3 rounded-2xl border px-4 py-3.5 text-left transition-colors',
                              active
                                ? 'border-lime-500/60 bg-lime-500/10'
                                : 'bg-elevated border-white/8 hover:border-white/16',
                            )}
                          >
                            <span
                              className={cn(
                                'flex size-5 shrink-0 items-center justify-center border transition-colors',
                                // Explicit radius, not `rounded-md`: the token
                                // scale is tuned for cards, and at 20px it
                                // rounds a checkbox into a circle — which reads
                                // as "pick one" when the group allows several.
                                group.type === 'SINGLE' ? 'rounded-full' : 'rounded-[6px]',
                                active
                                  ? 'bg-lime-500 border-lime-500 text-primary-foreground'
                                  : 'border-white/25',
                              )}
                            >
                              {active && <Check className="size-3.5" strokeWidth={3.5} />}
                            </span>

                            <span className="flex-1 text-sm leading-snug font-medium">
                              {pickLocalized(option.name, locale)}
                            </span>

                            {option.priceDelta > 0 && (
                              <span className="text-muted-foreground text-sm font-semibold tabular-nums">
                                +{formatAmd(option.priceDelta, locale)}
                              </span>
                            )}
                          </button>
                        );
                      })}
                  </div>
                </fieldset>
              );
            })}
          </div>
        </div>

        {/* The action bar never scrolls away — on a long options list the add
            button would otherwise be below the fold exactly when it is wanted. */}
        <div
          className={cn(
            // `flex-wrap` is what keeps the add button whole on a narrow phone.
            // Its label ends in a price and must not break, so its minimum size
            // is the whole string; with a single line the row simply overflowed
            // and the panel's `overflow-hidden` cut the price off — measured at
            // 320px, 41px of the button was outside the sheet. Wrapping hands it
            // its own full-width row instead, and only when it genuinely does
            // not fit: the basis below is what the browser measures against.
            'flex flex-wrap items-center gap-3 border-t border-white/8',
            layout === 'modal' ? 'glass px-5 py-4 sm:px-7' : 'bg-background sticky bottom-0 py-5',
          )}
          // The page bar is stuck to the bottom edge of the screen, so it
          // reserves the home indicator. A sticky element still occupies its
          // place in normal flow, so this padding is part of the document's
          // height and has to be the constant rather than `env()`; see
          // `--bottom-inset-reserve`.
          //
          // The modal used to reserve nothing, on the reasoning that a centred
          // panel stops short of the bottom edge anyway. That holds on a
          // desktop. It does not hold on an iPhone, where a `position: fixed`
          // panel is centred on the layout viewport while the part you can see
          // is shorter than that — the panel sits lower than it looks and the
          // add button is the first thing to meet the browser's own bar. A
          // floor of `max(1rem, …)` leaves the designed padding untouched
          // wherever the inset is zero, which is every device this does not
          // apply to.
          style={
            layout === 'page'
              ? { paddingBottom: 'max(1.25rem, var(--bottom-inset-reserve))' }
              : { paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }
          }
        >
          <QuantityStepper
            value={quantity}
            onChange={setQuantity}
            size="lg"
            max={50}
            className="shrink-0"
          />

          <motion.button
            type="button"
            onClick={handleAdd}
            disabled={!canAdd}
            whileTap={canAdd ? { scale: 0.98 } : undefined}
            className={cn(
              // `grow basis-40` rather than `flex-1`. A zero basis makes the
              // button's hypothetical size zero, so it always "fits" on the
              // line and then overflows it; a real basis is what lets the row
              // decide to wrap.
              'flex h-14 min-w-0 grow basis-40 items-center justify-center gap-2 rounded-2xl px-4 text-[0.95rem] font-bold whitespace-nowrap transition-colors sm:px-5 sm:text-base',
              canAdd
                ? 'bg-lime-500 text-primary-foreground shadow-lime hover:bg-lime-400'
                : 'bg-elevated text-muted-foreground cursor-not-allowed',
            )}
          >
            {canAdd ? (
              t('addForPrice', { price: formatAmd(unitPrice * quantity, locale) })
            ) : unsatisfied.length > 0 ? (
              <>
                <Flame className="size-4" />
                {pickLocalized(unsatisfied[0].name, locale)}
              </>
            ) : (
              tm('unavailable')
            )}
          </motion.button>
        </div>
      </div>
    </div>
  );
}

function countIn(group: MenuOptionGroup, selectedIds: ReadonlySet<string>): number {
  return group.options.filter((option) => selectedIds.has(option.id)).length;
}

function toSelected(option: { id: string; name: SelectedOption['name']; priceDelta: number }) {
  return { id: option.id, name: option.name, priceDelta: option.priceDelta };
}
