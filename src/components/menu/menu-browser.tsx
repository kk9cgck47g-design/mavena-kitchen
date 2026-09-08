'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';

import { DishCard } from '@/components/menu/dish-card';
import { prefersReducedMotion } from '@/hooks/use-media-query';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import type { MenuCategory } from '@/lib/menu-types';
import { cn } from '@/lib/utils';

/**
 * Fallback for the line a heading has to cross to count as reached — header
 * plus rail. The real value is measured from the rail itself; this only covers
 * the first frame, before there is anything to measure.
 */
const SCROLL_OFFSET = 132;

/** A heading this far under the rail still counts as reached. */
const REACHED_TOLERANCE = 8;

/** Clear space a pill needs on both sides before the rail leaves it alone. */
const RAIL_EDGE_PADDING = 24;

/** Scroll positions within this many pixels of each other are the same position. */
const ARRIVAL_EPSILON = 2;

/**
 * The menu.
 *
 * Categories are a scroll-spy, not a filter. The concept treated them as tabs
 * that swap the visible set; that means a network request or a re-render per
 * tap, a layout jump, and no sense of how big the menu is. Here every dish is on
 * one page: tapping a pill scrolls to it, and scrolling highlights the pill.
 * Nothing to wait for, and the customer can still just keep scrolling — which is
 * what people actually do when they are hungry and undecided.
 *
 * Two rules make it survive a touchscreen, and both were learned the hard way:
 *
 *   1. **A tap stays lit until the page actually arrives.** The earlier version
 *      suppressed the spy for a flat 700 ms, but a smooth scroll takes as long
 *      as the distance demands — measured at 1.35 s from the top of this menu to
 *      the last category. The spy woke up mid-flight and lit every section the
 *      page happened to be passing, so tapping "Desserts" flashed through
 *      "Sauces" and "Drinks" on the way. The target is clamped to the document,
 *      so "have we arrived" has a real answer, and no timer has to guess.
 *
 *   2. **The rail belongs to whoever touched it last.** Auto-centring runs only
 *      when the active pill is genuinely out of sight, and never while a finger
 *      is on the rail. Re-centring a rail the customer has just swiped is what
 *      made it feel like it was fighting back.
 *
 * The rail is scrolled through its own `scrollTo`, never `scrollIntoView`:
 * `scrollIntoView` walks up and scrolls every ancestor that helps, including the
 * document, which turns a horizontal nudge into a vertical jump.
 */
export function MenuBrowser({ categories }: { categories: MenuCategory[] }) {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const [activeSlug, setActiveSlug] = useState(categories[0]?.slug ?? '');
  const railRef = useRef<HTMLDivElement>(null);

  /**
   * Where a pill tap asked the page to go. While this is set the tapped pill
   * stays lit; it clears when the page reaches that position, or the moment the
   * customer scrolls themselves and takes over.
   */
  const pendingScroll = useRef<{ slug: string; top: number } | null>(null);

  /** True between pressing on the rail and letting go of it. */
  const railUnderUser = useRef(false);

  /**
   * The viewport line that decides which section is being read: the bottom edge
   * of the rail once it is stuck. Derived from the sticky offset and the rail's
   * own height rather than hard-coded, so it stays correct at every breakpoint
   * and does not drift when the header changes size.
   */
  const stuckRailBottom = useCallback((): number => {
    const sticky = railRef.current?.parentElement;
    if (!sticky) return SCROLL_OFFSET;

    const top = Number.parseFloat(window.getComputedStyle(sticky).top);
    return (Number.isFinite(top) ? top : 0) + sticky.getBoundingClientRect().height;
  }, []);

  // --- Scroll-spy ---------------------------------------------------------
  useEffect(() => {
    const headings = categories
      .map((category) => document.getElementById(`category-${category.slug}`))
      .filter((el): el is HTMLElement => el !== null);

    if (headings.length === 0) return;

    let frame = 0;

    const visibleSlug = (): string => {
      // At the very bottom nothing further can cross the line, so the last
      // section wins even when it is too short to reach it on its own.
      const atBottom =
        window.scrollY + window.innerHeight >=
        document.documentElement.scrollHeight - ARRIVAL_EPSILON;

      if (atBottom) return headings[headings.length - 1].id;

      const line = stuckRailBottom() + REACHED_TOLERANCE;
      let reached = headings[0];
      for (const heading of headings) {
        if (heading.getBoundingClientRect().top > line) break;
        reached = heading;
      }
      return reached.id;
    };

    const read = () => {
      frame = 0;

      const pending = pendingScroll.current;
      if (pending) {
        if (Math.abs(window.scrollY - pending.top) > ARRIVAL_EPSILON) return;
        pendingScroll.current = null;
      }

      setActiveSlug(visibleSlug().replace('category-', ''));
    };

    // One read per frame at most. Scroll events fire far faster than the screen
    // refreshes, and every read touches layout.
    const onScroll = () => {
      if (frame === 0) frame = window.requestAnimationFrame(read);
    };

    // Any scroll the customer starts themselves abandons the pill they tapped —
    // they have changed their mind, and the spy should follow them, not the
    // journey it was in the middle of.
    const releasePending = () => {
      pendingScroll.current = null;
    };

    read();

    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    window.addEventListener('wheel', releasePending, { passive: true });
    window.addEventListener('touchstart', releasePending, { passive: true });
    window.addEventListener('keydown', releasePending);

    return () => {
      if (frame !== 0) window.cancelAnimationFrame(frame);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      window.removeEventListener('wheel', releasePending);
      window.removeEventListener('touchstart', releasePending);
      window.removeEventListener('keydown', releasePending);
    };
  }, [categories, stuckRailBottom]);

  // --- The rail follows, but never leads ----------------------------------
  useEffect(() => {
    const rail = railRef.current;
    if (!rail || railUnderUser.current) return;

    const pill = rail.querySelector<HTMLElement>(`[data-slug="${activeSlug}"]`);
    if (!pill) return;

    // Rects rather than `offsetLeft`: the pills' offset parent is not the rail,
    // so offsets are measured against the wrong box.
    const railRect = rail.getBoundingClientRect();
    const pillRect = pill.getBoundingClientRect();
    const left = rail.scrollLeft + pillRect.left - railRect.left;
    const right = left + pillRect.width;

    const inView =
      left >= rail.scrollLeft + RAIL_EDGE_PADDING &&
      right <= rail.scrollLeft + rail.clientWidth - RAIL_EDGE_PADDING;

    // Already comfortably in view: leave the rail exactly where the customer
    // left it.
    if (inView) return;

    rail.scrollTo({
      left: left - (rail.clientWidth - pillRect.width) / 2,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
  }, [activeSlug]);

  // --- Who is driving the rail --------------------------------------------
  useEffect(() => {
    const rail = railRef.current;
    if (!rail) return;

    const claim = () => {
      railUnderUser.current = true;
    };
    const release = () => {
      railUnderUser.current = false;
    };

    // Release on the window: a swipe that ends with the finger off the rail is
    // still a finished swipe, and leaving the flag set would disable centring
    // for the rest of the session.
    rail.addEventListener('pointerdown', claim);
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);

    return () => {
      rail.removeEventListener('pointerdown', claim);
      window.removeEventListener('pointerup', release);
      window.removeEventListener('pointercancel', release);
    };
  }, []);

  function scrollToCategory(slug: string) {
    const heading = document.getElementById(`category-${slug}`);
    if (!heading) return;

    const maxTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const top = Math.min(
      Math.max(0, heading.getBoundingClientRect().top + window.scrollY - stuckRailBottom()),
      maxTop,
    );

    setActiveSlug(slug);

    // Clamped to what the document can actually do, so arrival is detectable.
    // Recording a target we are already at would leave the spy suppressed with
    // no scroll event coming to release it.
    pendingScroll.current =
      Math.abs(window.scrollY - top) <= ARRIVAL_EPSILON ? null : { slug, top };

    window.scrollTo({ top, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  }

  return (
    <>
      <div className="glass sticky top-(--header-height) z-30 -mx-4 border-b border-white/8 px-4 sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
        {/*
          The rail scrolls horizontally and previously ended in a hard clip, so a
          half-cut pill was the only hint that more categories existed. The mask
          fades the last few pixels instead, which reads as "keeps going" rather
          than "broken layout". Pure CSS — no extra element, no scroll listener.

          `overscroll-x-contain` stops a flick that reaches the end of the rail
          from turning into the browser's back gesture.
        */}
        <div
          ref={railRef}
          className="no-scrollbar mx-auto flex max-w-7xl gap-2 overflow-x-auto overscroll-x-contain py-3 [mask-image:linear-gradient(to_right,transparent,black_16px,black_calc(100%-28px),transparent)]"
        >
          {categories.map((category) => (
            <button
              key={category.slug}
              type="button"
              data-slug={category.slug}
              onClick={() => scrollToCategory(category.slug)}
              aria-current={category.slug === activeSlug ? 'true' : undefined}
              className={cn(
                'relative shrink-0 rounded-full px-4 py-2.5 text-sm font-semibold whitespace-nowrap transition-colors duration-200',
                // 42px drawn, 44px tappable — the rail's own padding absorbs the
                // extra pixel at each edge.
                'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
                // Lime is the selected pill here, so the focus ring is not lime —
                // the same reasoning as the locale switcher.
                'focus-visible:outline-coal-50 focus-visible:outline-2 focus-visible:outline-offset-2',
                category.slug === activeSlug
                  ? 'bg-lime-500 text-primary-foreground'
                  : 'bg-elevated text-muted-foreground hover:text-foreground border border-white/8',
              )}
            >
              {pickLocalized(category.name, locale)}
            </button>
          ))}
        </div>
      </div>

      <div className="mx-auto max-w-7xl space-y-16 py-10">
        {categories.map((category, categoryIndex) => (
          <section key={category.id} aria-labelledby={`category-${category.slug}`}>
            {/* `scroll-mt` keeps the anchor clear of the fixed header when the
                browser jumps to a #hash on load. Derived from the header rather
                than written out: a flat 132px was right only on a phone in a
                browser tab, and landed 8px high from the `sm` breakpoint up and
                a whole status bar high once the site is installed to the home
                screen. 4.25rem is the rail. */}
            <h2
              id={`category-${category.slug}`}
              className="text-section scroll-mt-[calc(var(--header-height)+4.25rem)] font-bold"
            >
              {pickLocalized(category.name, locale)}
            </h2>

            <div className="mt-6 grid grid-cols-2 gap-4 sm:gap-5 md:grid-cols-3 lg:grid-cols-4">
              {category.products.map((product, productIndex) => (
                <DishCard
                  key={product.id}
                  product={product}
                  // Only the first row of the first category is above the fold.
                  priority={categoryIndex === 0 && productIndex < 4}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}
