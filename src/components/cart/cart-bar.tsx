'use client';

import { ShoppingBag } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { Price } from '@/components/ui/price';
import { usePathname } from '@/i18n/navigation';
import { cartCount, cartSubtotal, useCart } from '@/stores/cart';
import { useUi } from '@/stores/ui';

/**
 * Routes that already own the bottom of the screen.
 *
 * Checkout and the cart page are about the cart itself. A dish page has its own
 * sticky "Add" bar, and two stacked bars competing for the same thumb is worse
 * than none — the customer taps the wrong one.
 *
 * A confirmed order is on the list for a different reason. Its cart was emptied
 * when it was placed, so the bar is normally absent anyway — but someone who
 * orders, starts a second basket and then reopens the tracking link would
 * otherwise find a running total floating over the order they have already
 * paid for.
 */
const HIDDEN_PATHS = ['/checkout', '/cart', '/order'];
const DISH_PAGE = /^\/menu\/.+/;

function isHidden(pathname: string): boolean {
  return HIDDEN_PATHS.some((route) => pathname.startsWith(route)) || DISH_PAGE.test(pathname);
}

/**
 * Sticky cart bar, thumb-height.
 *
 * The single most important control in a mobile ordering app, and the one the
 * original concept had no equivalent of anywhere. Without it, the running total
 * lives in a badge in the top-right corner — the hardest place on a phone to
 * reach and the easiest to forget.
 *
 * It only appears once there is something in the cart, so it never steals space
 * from the menu while the customer is still browsing.
 */
export function CartBar() {
  const t = useTranslations('cart');
  const pathname = usePathname();

  const items = useCart((s) => s.items);
  const hydrated = useCart((s) => s.hydrated);
  const openCart = useUi((s) => s.openCart);
  const cartOpen = useUi((s) => s.cartOpen);

  const count = cartCount(items);

  /** There is a cart worth showing a bar for, whether or not it is on screen. */
  const inCart = hydrated && count > 0 && !isHidden(pathname);

  return (
    <>
      {/*
        The bar is fixed, so it floats over whatever is at the bottom of the
        page — the last row of dishes, or the footer. This spacer reserves the
        same height in normal flow so nothing ends up permanently underneath it.
        It exists only while there is a cart, so an empty cart costs no dead
        space.

        Deliberately keyed off `inCart` and not off whether the bar is currently
        drawn: opening the cart hides the bar, and removing the spacer with it
        would shorten the document by 130px underneath a page that is scroll
        locked. Closing the sheet would then land the reader somewhere they
        never scrolled to.
      */}
      {inCart && (
        <div
          aria-hidden
          className="lg:hidden"
          // Matches the bar's own height plus the inset it reserves, so the last
          // row of dishes clears it on a notched phone as well as a flat one.
          // The reserve is the constant rather than `env()`: this spacer is in
          // normal flow, so an inset that changes as Safari's toolbar moves
          // would change the height of the document while the reader is at the
          // bottom of it. See `--bottom-inset-reserve`.
          style={{ height: 'calc(6rem + var(--bottom-inset-reserve))' }}
        />
      )}

      {/*
        The whole animated subtree goes the instant the cart sheet opens, rather
        than the bar being animated out of view.

        Measured before: the exit spring kept the bar mounted and painting for
        half a second after the sheet appeared, and for most of that time its box
        hung ~30px below the bottom of the viewport. The only thing hiding it was
        the sheet's own panel covering exactly the viewport — the scrim over the
        rest is `black/10`, which hides nothing. On iOS Safari the visible area
        and the layout viewport disagree for the length of a browser-chrome
        transition, and locking the page's scroll is itself enough to start one,
        so those frames are exactly when a strip below the sheet becomes visible
        — with a lime bar sitting in it.

        Unmounting the `AnimatePresence` rather than its child is what makes the
        cut immediate: there is no exit animation to run. Reopening still springs
        the bar back in, and the empty-cart case still animates out normally.
      */}
      {!cartOpen && (
        <AnimatePresence>
          {inCart && (
            <motion.div
              initial={{ y: 96, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 96, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 320, damping: 34 }}
              className="fixed inset-x-0 bottom-0 z-40 p-3 lg:hidden"
              style={{
                paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
                // Landscape on a notched phone puts the rounded corner and the
                // camera cutout inside the viewport now that the page draws
                // edge to edge.
                paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
                paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
              }}
            >
              <button
                type="button"
                onClick={openCart}
                className="bg-lime-500 text-primary-foreground shadow-lime flex h-16 w-full items-center gap-3 rounded-3xl px-5 text-left active:brightness-95"
              >
                <span className="relative flex size-10 items-center justify-center rounded-full bg-black/15">
                  <ShoppingBag className="size-5" />
                </span>

                <span className="flex-1">
                  <span className="block text-sm/tight font-semibold opacity-80">{t('title')}</span>
                  <span className="block text-xs/tight opacity-70 tabular-nums">
                    {t('itemCount', { count })}
                  </span>
                </span>

                <Price amount={cartSubtotal(items)} className="text-lg font-extrabold" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </>
  );
}
