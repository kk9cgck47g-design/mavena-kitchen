'use client';

import { useState } from 'react';
import { Mail, Menu as MenuIcon, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { motion, useMotionValueEvent, useScroll } from 'motion/react';

import { LogoLockup } from '@/components/brand/logo';
import { CartButton } from '@/components/cart/cart-button';
import { DemoChip } from '@/components/demo/demo-chip';
import { LocaleSwitcher } from '@/components/layout/locale-switcher';
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { Link, usePathname } from '@/i18n/navigation';
import { RESTAURANT } from '@/lib/restaurant';
import { cn } from '@/lib/utils';

const NAV = [
  { href: '/menu', key: 'menu' },
  { href: '/about', key: 'about' },
  { href: '/contacts', key: 'contacts' },
] as const;

/**
 * Sticky header.
 *
 * Transparent while it sits over the hero photograph, then fading into glass once
 * the page scrolls — one of only two places glass is used, because this genuinely
 * floats over moving content.
 *
 * The transition is driven by a motion value rather than a scroll listener that
 * calls setState on every frame: this way the opacity animates on the compositor
 * and React re-renders only when the boolean actually flips.
 */
export function SiteHeader() {
  const t = useTranslations('nav');
  const tc = useTranslations('common');
  const pathname = usePathname();
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  /*
   * Two thresholds, not one.
   *
   * iOS Safari nudges the scroll offset by a handful of pixels every time its
   * toolbar expands or collapses, and it does that on every change of scroll
   * direction. A bare `latest > 24` turns that nudge, right at the top of the
   * page, into the header's background switching on and off while the customer
   * is holding still. Once the glass is on it takes a deliberate scroll back to
   * the top to turn it off again.
   */
  useMotionValueEvent(scrollY, 'change', (latest) => {
    setScrolled((was) => (was ? latest > 8 : latest > 24));
  });

  return (
    <motion.header
      className={cn(
        'fixed inset-x-0 top-0 z-50 transition-[background,border-color,box-shadow] duration-500',
        scrolled ? 'glass border-b border-white/8' : 'border-b border-transparent',
      )}
      // The page draws edge to edge now (`viewportFit: 'cover'`). In a browser
      // tab every one of these is zero and nothing moves. Installed to the home
      // screen with a translucent status bar, or held in landscape on a notched
      // phone, they are what keeps the row clear of the hardware. Applied to
      // the bar rather than to the row inside it, so the row keeps its own
      // responsive padding.
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}
    >
      {/*
        The row is a fixed budget: logo + demo chip + two 44 px buttons must
        fit inside the narrowest phone. `min-w-0` on the logo is what makes it
        a budget rather than a wish — without it the lockup refuses to shrink
        and pushes the menu button off the right edge instead, which is how a
        320 px screen ended up with no way to open the navigation at all.
      */}
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-3 sm:h-18 sm:gap-3 sm:px-6 lg:px-8">
        {/* `self-stretch` makes the brand link as tall as the header row, which
            is both a better tap target and the behaviour people expect from a
            logo. */}
        <Link
          href="/"
          aria-label={RESTAURANT.name}
          className="flex min-w-0 items-center self-stretch"
        >
          <LogoLockup
            className="xs:text-lg text-base sm:text-xl"
            markClassName="size-8 sm:size-9"
          />
        </Link>

        <DemoChip />

        <nav className="ml-6 hidden items-center gap-1 lg:flex">
          {NAV.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'relative rounded-full px-4 py-2 text-sm font-medium transition-colors',
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {active && (
                  // A shared layoutId slides the pill between items instead of
                  // popping it — the cheapest possible "expensive" detail.
                  <motion.span
                    layoutId="nav-pill"
                    className="absolute inset-0 rounded-full bg-white/8"
                    transition={{ type: 'spring', stiffness: 380, damping: 32 }}
                  />
                )}
                <span className="relative">{t(item.key)}</span>
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-1.5 sm:gap-2">
          <a
            href={`mailto:${RESTAURANT.email}`}
            className="text-muted-foreground hover:text-foreground hidden items-center gap-2 rounded-full px-3 py-2 text-sm font-medium transition-colors xl:flex"
          >
            <Mail className="size-4" />
            <span>{RESTAURANT.email}</span>
          </a>

          <LocaleSwitcher className="hidden sm:flex" />
          <CartButton />

          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger
              aria-label={t('menu')}
              className="bg-elevated flex size-11 items-center justify-center rounded-full border border-white/8 transition-colors hover:bg-white/8 lg:hidden"
            >
              <MenuIcon className="size-5" />
            </SheetTrigger>

            {/*
              The width carries the `data-[side=right]:` prefix on purpose. The
              base component sets `data-[side=right]:w-3/4`, and tailwind-merge
              only drops a class when the replacement has the exact same
              modifiers — a bare `w-[…]` survives alongside it and then loses the
              cascade to the attribute selector, which is more specific. So the
              intended width silently did nothing and the panel was 75vw.
            */}
            <SheetContent
              side="right"
              showCloseButton={false}
              className="border-white/8 p-0 data-[side=right]:w-[min(22rem,88vw)]"
            >
              <SheetTitle className="sr-only">{t('menu')}</SheetTitle>

              <div className="flex h-full flex-col">
                {/* The stock close button is a 28 px square in the corner. On a
                    phone that is well under the 44 px a thumb needs, and it is
                    the control every customer reaches for first. */}
                <SheetClose
                  aria-label={tc('close')}
                  className="bg-elevated absolute top-4 right-4 flex size-11 items-center justify-center rounded-full border border-white/8 transition-colors hover:bg-white/8"
                >
                  <X className="size-5" />
                </SheetClose>

                {/* Clears the 44 px close button plus its inset, so the
                    wordmark is never truncated by it. */}
                <div className="border-b border-white/8 p-6 pr-16">
                  {/* One size down on the narrowest phones: at 320px the panel
                      is 282px wide and the close button takes 64px of it, which
                      is not enough for the wordmark at `text-xl`. */}
                  <LogoLockup className="xs:text-xl text-lg" />
                </div>

                <nav className="flex flex-col p-3">
                  {NAV.map((item) => (
                    <SheetClose key={item.href} asChild>
                      <Link
                        href={item.href}
                        className="rounded-xl px-4 py-3.5 text-lg font-semibold transition-colors hover:bg-white/6"
                      >
                        {t(item.key)}
                      </Link>
                    </SheetClose>
                  ))}
                </nav>

                <div className="mt-auto space-y-4 border-t border-white/8 p-6">
                  <LocaleSwitcher />
                  {/* The demo contact stays a full-size tap target on mobile. */}
                  <a
                    href={`mailto:${RESTAURANT.email}`}
                    className="flex min-h-11 items-center gap-3 text-sm font-medium"
                  >
                    <Mail className="size-4 text-lime-500" />
                    <span>{RESTAURANT.email}</span>
                  </a>
                </div>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </motion.header>
  );
}
