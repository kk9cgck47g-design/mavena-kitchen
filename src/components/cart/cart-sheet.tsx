'use client';

import Image from 'next/image';
import { ArrowRight, ShoppingBag, X } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useLocale, useTranslations } from 'next-intl';

import { Price } from '@/components/ui/price';
import { QuantityStepper } from '@/components/ui/quantity-stepper';
import { Sheet, SheetClose, SheetContent, SheetTitle } from '@/components/ui/sheet';
import { useMediaQuery, SM_UP } from '@/hooks/use-media-query';
import { Link } from '@/i18n/navigation';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { DISH_BLUR_DATA_URL } from '@/server/db/placeholder-photos';
import { cartCount, cartSubtotal, useCart } from '@/stores/cart';
import { useUi } from '@/stores/ui';

/**
 * The cart.
 *
 * A right-hand drawer on desktop, a bottom sheet on mobile — the sheet component
 * switches side by breakpoint. On a phone, a drawer that slides from the right
 * puts its close button in the hardest corner to reach; sliding up keeps
 * everything under the thumb.
 */
export function CartSheet() {
  const t = useTranslations('cart');
  const tc = useTranslations('common');
  const rawLocale = useLocale();
  const locale: Locale = isLocale(rawLocale) ? rawLocale : 'hy';

  const open = useUi((s) => s.cartOpen);
  const setOpen = useUi((s) => s.setCartOpen);
  const isDesktop = useMediaQuery(SM_UP);

  const items = useCart((s) => s.items);
  const setQuantity = useCart((s) => s.setQuantity);
  const clear = useCart((s) => s.clear);

  const count = cartCount(items);
  const subtotal = cartSubtotal(items);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/*
        `side` is switched in JS rather than with responsive classes. The sheet
        keys every position rule off `data-side`, so a `sm:left-auto` override
        loses to `data-[side=bottom]:inset-x-0` on specificity — and even winning
        that fight would leave the panel sliding up from the bottom on desktop,
        because the animation direction is baked into the same attribute.

        `showCloseButton={false}`: the built-in close is absolutely positioned at
        top-right, directly on top of the "Clear" action. Owning the header row
        puts both in one flex line with real spacing.

        `svh` rather than `dvh` on the height cap: the dynamic unit is
        re-resolved as Safari's toolbar moves, so an open sheet would resize
        itself under the thumb halfway through a scroll of its own contents. The
        small viewport is the one that holds still.
      */}
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        showCloseButton={false}
        className="bg-card max-h-[88svh] rounded-t-3xl border-white/8 p-0 sm:max-h-none sm:w-full sm:max-w-[28rem] sm:rounded-none sm:rounded-l-3xl"
      >
        <div className="flex max-h-[88svh] flex-col sm:h-full sm:max-h-none">
          <header className="flex items-center gap-4 border-b border-white/8 px-5 py-5 sm:px-6">
            <SheetTitle className="flex-1 text-2xl font-bold tracking-tight">
              {t('title')}
              {count > 0 && (
                <span className="text-muted-foreground ml-2 text-base font-medium tabular-nums">
                  {count}
                </span>
              )}
            </SheetTitle>

            {count > 0 && (
              <button
                type="button"
                onClick={clear}
                // Negative margin cancels the padding, so the row keeps its
                // layout while the tap target reaches 44px.
                className="text-muted-foreground hover:text-destructive -my-3 py-3 text-sm font-medium transition-colors"
              >
                {t('clear')}
              </button>
            )}

            <SheetClose
              aria-label={tc('close')}
              className="bg-elevated flex size-11 shrink-0 items-center justify-center rounded-full border border-white/8 transition-colors hover:bg-white/8"
            >
              <X className="size-4" />
            </SheetClose>
          </header>

          {items.length === 0 ? (
            <EmptyCart />
          ) : (
            <>
              {/* `overscroll-contain`: a flick that runs out of list stops
                  there instead of handing the rest of the gesture to the page
                  behind the sheet — which on iOS also means it cannot start a
                  browser-chrome transition from inside a modal. */}
              <ul className="flex-1 divide-y divide-white/6 overflow-y-auto overscroll-contain px-5 sm:px-6">
                <AnimatePresence initial={false}>
                  {items.map((item) => (
                    <motion.li
                      key={item.key}
                      layout
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0, marginTop: 0 }}
                      transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                      className="overflow-hidden"
                    >
                      <div className="flex gap-4 py-4">
                        <div className="bg-elevated relative size-20 shrink-0 overflow-hidden rounded-2xl">
                          {item.image && (
                            <Image
                              src={item.image}
                              alt=""
                              fill
                              sizes="80px"
                              placeholder="blur"
                              blurDataURL={DISH_BLUR_DATA_URL}
                              className="object-cover"
                            />
                          )}
                        </div>

                        <div className="min-w-0 flex-1">
                          <p className="leading-snug font-semibold">
                            {pickLocalized(item.name, locale)}
                          </p>

                          {item.options.length > 0 && (
                            <p className="text-muted-foreground mt-1 text-sm leading-snug">
                              {item.options
                                .map((option) => pickLocalized(option.name, locale))
                                .join(' · ')}
                            </p>
                          )}

                          <div className="mt-3 flex items-center justify-between gap-3">
                            <QuantityStepper
                              size="sm"
                              value={item.quantity}
                              removeAtMin
                              onChange={(next) => setQuantity(item.key, next)}
                            />
                            <Price
                              amount={item.unitPrice * item.quantity}
                              className="font-semibold"
                            />
                          </div>
                        </div>
                      </div>
                    </motion.li>
                  ))}
                </AnimatePresence>
              </ul>

              {/* The sheet is fixed to the bottom edge, so the checkout button
                  is exactly where the home indicator lives. */}
              <footer
                className="glass space-y-4 border-t border-white/8 px-5 py-5 sm:px-6"
                style={{ paddingBottom: 'max(1.25rem, env(safe-area-inset-bottom))' }}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-muted-foreground">{t('subtotal')}</span>
                  <Price amount={subtotal} className="text-2xl font-bold" />
                </div>

                {/* Delivery is quoted at checkout, where the address is known.
                    Showing a guess here and correcting it later is how carts get
                    abandoned. True in the demo too: the preview quotes real fees
                    from the same zones, it just cannot place the order. */}
                <p className="text-muted-foreground text-xs">{t('deliveryAtCheckout')}</p>

                {/*
                  Live in the demo as well. The button used to be rendered dead,
                  because there was no checkout to send anyone to; now there is,
                  and it prices a real order without being able to create one.
                  The warning that nothing will be sent belongs on the screen
                  where the order would be placed, not two steps earlier.
                */}
                <Link
                  href="/checkout"
                  onClick={() => setOpen(false)}
                  className="bg-lime-500 text-primary-foreground shadow-lime hover:bg-lime-400 active:bg-lime-600 flex h-14 items-center justify-center gap-2 rounded-2xl text-base font-bold transition-colors"
                >
                  {t('checkout')}
                  <ArrowRight className="size-5" />
                </Link>
              </footer>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function EmptyCart() {
  const t = useTranslations('cart');
  const setOpen = useUi((s) => s.setCartOpen);

  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-4 px-8 pb-8 text-center"
      style={{ paddingBottom: 'max(2rem, env(safe-area-inset-bottom))' }}
    >
      <div className="bg-elevated flex size-20 items-center justify-center rounded-full">
        <ShoppingBag className="text-muted-foreground size-8" />
      </div>
      <div>
        <p className="text-lg font-semibold">{t('empty')}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t('emptyHint')}</p>
      </div>
      <Link
        href="/menu"
        onClick={() => setOpen(false)}
        className="bg-elevated mt-2 rounded-full border border-white/8 px-6 py-3 text-sm font-semibold transition-colors hover:bg-white/8"
      >
        {t('browseMenu')}
      </Link>
    </div>
  );
}
