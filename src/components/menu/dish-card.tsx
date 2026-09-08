'use client';

import Image from 'next/image';
import { Plus } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';
import { toast } from 'sonner';

import { Price } from '@/components/ui/price';
import { Link } from '@/i18n/navigation';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import type { MenuProduct } from '@/lib/menu-types';
import { defaultSelection, hasRequiredChoice, unitPriceFor } from '@/lib/menu-types';
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
 * A dish.
 *
 * Image-led by design. The concept mockup gave every dish a small thumbnail in a
 * three-column grid; when photography *is* the product, that is backwards. Here
 * the photo occupies the whole top of the card and the text sits underneath it.
 *
 * The add button behaves differently depending on the dish, which is the detail
 * that makes it feel considered: a dish with no required choice is added in one
 * tap, while a dish that must be configured (pick a size, pick a flavour) opens
 * the sheet instead. Silently adding a default size the customer never chose is
 * how you end up delivering the wrong thing.
 */
export function DishCard({
  product,
  featured = false,
  priority = false,
}: {
  product: MenuProduct;
  /** Larger treatment for bestsellers. */
  featured?: boolean;
  priority?: boolean;
}) {
  const t = useTranslations('menu');
  const tb = useTranslations('badge');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const add = useCart((s) => s.add);
  const reduceMotion = useReducedMotion();

  const soldOut = !product.isAvailable;
  const needsChoice = hasRequiredChoice(product);
  const name = pickLocalized(product.name, locale);
  const description = product.description ? pickLocalized(product.description, locale) : null;

  function quickAdd(event: React.MouseEvent) {
    // The whole card is a link to the dish sheet; the add button must not
    // navigate as well.
    event.preventDefault();
    event.stopPropagation();

    const options = defaultSelection(product);
    add({
      productId: product.id,
      slug: product.slug,
      name: product.name,
      image: product.images[0] ?? null,
      options,
      unitPrice: unitPriceFor(product, options),
    });

    toast.success(t('added'), { description: name });
  }


  return (
    <motion.article
      /*
        The card fades and lifts into place — unless the OS has asked for less
        movement, in which case it is simply there. Motion writes the opacity as
        an inline style, so the blanket `transition-duration` override in
        globals.css cannot reach it; the animation has to not be started.

        Worth more than politeness: while a card is mid-fade its text is being
        composited against the page at partial opacity, and text that reads at
        4.5:1 when it settles does not while it is arriving.
      */
      initial={reduceMotion ? false : { opacity: 0, y: 16 }}
      whileInView={reduceMotion ? undefined : { opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={reduceMotion ? { duration: 0 } : { duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      className={cn('group relative h-full', soldOut && 'opacity-55')}
    >
      <Link
        href={`/menu/${product.slug}`}
        className="block h-full focus-visible:outline-none"
        aria-label={name}
      >
        {/*
          `h-full` plus `mt-auto` on the action row: dishes without a description
          would otherwise produce shorter cards, leaving prices and add buttons
          at different heights across a row. Misaligned actions are the fastest
          way for a grid to look unfinished.
        */}
        <div
          className={cn(
            'bg-card shadow-card relative flex h-full flex-col overflow-hidden rounded-3xl border border-white/6',
            'transition-[transform,box-shadow,border-color] duration-400 ease-[cubic-bezier(0.16,1,0.3,1)]',
            !soldOut && 'group-hover:shadow-lift group-hover:-translate-y-1 group-hover:border-white/12',
            'group-focus-visible:ring-lime-500 group-focus-visible:ring-2 group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-[var(--background)]',
          )}
        >
          <div className={cn('relative overflow-hidden', featured ? 'aspect-[4/3]' : 'aspect-square')}>
            {product.images[0] ? (
              <Image
                src={product.images[0]}
                alt={name}
                fill
                priority={priority}
                placeholder="blur"
                blurDataURL={DISH_BLUR_DATA_URL}
                sizes={
                  featured
                    ? '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw'
                    : '(min-width: 1024px) 25vw, (min-width: 640px) 33vw, 50vw'
                }
                className={cn(
                  'object-cover transition-transform duration-700 ease-[cubic-bezier(0.16,1,0.3,1)]',
                  !soldOut && 'group-hover:scale-[1.06]',
                  soldOut && 'grayscale',
                )}
              />
            ) : (
              <div className="bg-elevated size-full" />
            )}

            {/* Grounds the photo into the card instead of letting it end on a
                hard edge, and gives the badges something to sit on. */}
            <div className="from-coal-1000/70 pointer-events-none absolute inset-0 bg-gradient-to-t via-transparent to-transparent" />

            {product.badges.length > 0 && !soldOut && (
              <div className="absolute top-3 left-3 flex flex-wrap gap-1.5">
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

            {soldOut && (
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="bg-coal-1000/85 rounded-full px-4 py-2 text-sm font-semibold">
                  {t('unavailable')}
                </span>
              </div>
            )}
          </div>

          <div className="flex flex-1 flex-col gap-1 p-4 sm:p-5">
            <h3
              className={cn(
                'leading-snug font-semibold text-balance',
                featured ? 'text-lg' : 'text-[0.95rem]',
              )}
            >
              {name}
            </h3>

            {description && (
              <p className="text-muted-foreground line-clamp-2 text-sm leading-snug">
                {description}
              </p>
            )}

            {/*
              `flex-wrap`, and a tighter budget below `xs` so it rarely has to.

              At 320px this row is 102px wide, and the price and the button
              together asked for 103px on the cheapest dish and 135px on
              «от 2 700 ֏» — so every card overflowed, and the four longest had
              16px of the button cut off by the card's `overflow-hidden`. Neither
              item could give way: the price cannot break and the button was
              `shrink-0`.

              So the row is allowed to wrap, and below `xs` the budget shrinks
              enough to keep 360px on one line — measured at 137px needed in
              Armenian, the widest of the three languages. The wrap is the safety
              net rather than the mechanism: if a fallback font makes the price
              wider than measured, the button drops to its own line instead of
              being clipped again.

              `justify-end` with `mr-auto` on the price rather than
              `justify-between`: identical while both share a line, and it keeps
              the button on the right once it has a line of its own.
            */}
            <div className="mt-auto flex flex-wrap items-center justify-end gap-2 pt-3 xs:gap-3">
              <span className="mr-auto flex items-baseline gap-1">
                {needsChoice && (
                  <span className="text-muted-foreground text-xs">{t('from')}</span>
                )}
                <Price
                  amount={product.basePrice}
                  className={cn('font-bold', featured ? 'text-xl' : 'text-base xs:text-lg')}
                />
              </span>

              {!soldOut && (
                <button
                  type="button"
                  onClick={needsChoice ? undefined : quickAdd}
                  aria-label={`${t('addToCart')} — ${name}`}
                  className={cn(
                    'bg-lime-500 text-primary-foreground relative flex size-9 shrink-0 items-center justify-center rounded-full xs:size-11',
                    // Drawn at 36px on the narrowest phones so the price keeps
                    // its line, tappable at 44px regardless — the transparent
                    // overlay the stepper, the category rail and the locale
                    // switcher all use for the same reason.
                    'after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]',
                    'transition-[transform,background-color] duration-200 active:scale-90',
                    'hover:bg-lime-400',
                    needsChoice && 'pointer-events-none',
                  )}
                >
                  <Plus className="size-5" strokeWidth={2.75} />
                </button>
              )}
            </div>
          </div>
        </div>
      </Link>
    </motion.article>
  );
}
