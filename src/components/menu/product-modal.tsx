'use client';

import { useRouter } from 'next/navigation';
import { X } from 'lucide-react';

import { ProductDetail } from '@/components/menu/product-detail';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { pickLocalized, isLocale, type Locale } from '@/lib/i18n/locales';
import type { MenuProduct } from '@/lib/menu-types';
import { useLocale, useTranslations } from 'next-intl';

/**
 * The dish sheet.
 *
 * Rendered through an intercepted route, so opening a dish from the menu keeps
 * the menu mounted underneath — the customer returns to their exact scroll
 * position instead of the top of the page. The URL is still real and shareable,
 * and a direct visit or a refresh falls through to the standalone page.
 *
 * This is the change that makes the site feel like an app rather than a website
 * with modals bolted on.
 *
 * `router.back()` rather than a state flag: the modal *is* a history entry, so
 * the phone's back gesture has to close it, and it must not leave a dead URL
 * behind.
 */
export function ProductModal({ product }: { product: MenuProduct }) {
  const router = useRouter();
  const tc = useTranslations('common');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  return (
    <Dialog defaultOpen onOpenChange={(open) => !open && router.back()}>
      <DialogContent
        showCloseButton={false}
        /*
          `flex flex-col` replaces the base component's `grid`, and that is the
          whole reason the options list scrolls.

          A grid container sizes its rows from their content. Give it a
          `max-height` and the row does not shrink to obey it — it overflows,
          and `overflow-hidden` quietly cuts the remainder off. Measured on a
          745px-tall viewport, which is what an iPhone actually reports once
          Safari's toolbar is counted: the panel was capped at 685px and its
          contents were 842px, so the list below the fold and the entire add
          button were clipped away with no way to reach them. The inner
          scroller could not help, because it had been handed its full content
          height and so had nothing left to scroll.

          A column flexbox does shrink its items, which is what a height cap
          has to mean. `min-h-0` further down is the other half — without it a
          flex item refuses to go below its content size.

          `svh`, not `dvh`: a cap on the dynamic viewport re-resolves every time
          Safari's toolbar moves, so the panel would resize itself while the
          options list is being scrolled.
        */
        className="bg-card flex max-h-[92svh] flex-col gap-0 overflow-hidden rounded-3xl border-white/10 p-0 sm:max-w-xl"
      >
        <DialogTitle className="sr-only">{pickLocalized(product.name, locale)}</DialogTitle>

        <button
          type="button"
          onClick={() => router.back()}
          aria-label={tc('close')}
          className="glass absolute top-4 right-4 z-10 flex size-11 items-center justify-center rounded-full border border-white/12 transition-colors hover:bg-white/12"
        >
          <X className="size-4.5" />
        </button>

        <ProductDetail product={product} layout="modal" onAdded={() => router.back()} />
      </DialogContent>
    </Dialog>
  );
}
