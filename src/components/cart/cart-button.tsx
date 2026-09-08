'use client';

import { ShoppingBag } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useTranslations } from 'next-intl';

import { cartCount, useCart } from '@/stores/cart';
import { useUi } from '@/stores/ui';
import { cn } from '@/lib/utils';

/**
 * Header cart button with a count badge.
 *
 * Reads `hydrated` before showing the count. Without that guard the server
 * renders 0, the client rehydrates localStorage and renders 3, and React logs a
 * hydration mismatch — and worse, the badge visibly flickers on every page load
 * for anyone with a cart.
 */
export function CartButton({ className }: { className?: string }) {
  const t = useTranslations('cart');
  const items = useCart((s) => s.items);
  const hydrated = useCart((s) => s.hydrated);
  const openCart = useUi((s) => s.openCart);

  const count = hydrated ? cartCount(items) : 0;

  return (
    <button
      type="button"
      onClick={openCart}
      aria-label={t('title')}
      className={cn(
        'bg-elevated relative flex size-11 items-center justify-center rounded-full border border-white/8 transition-colors hover:bg-white/8',
        className,
      )}
    >
      <ShoppingBag className="size-5" />

      <AnimatePresence>
        {count > 0 && (
          <motion.span
            initial={{ scale: 0.4, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 520, damping: 24 }}
            className="bg-lime-500 text-primary-foreground absolute -top-1 -right-1 flex min-w-5 items-center justify-center rounded-full px-1.5 text-[0.7rem] font-bold tabular-nums"
          >
            {count}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}
