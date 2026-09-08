'use client';

import { useCallback, useSyncExternalStore } from 'react';

/**
 * Subscribe to a media query.
 *
 * `useSyncExternalStore` rather than state-plus-effect: `matchMedia` is exactly
 * the external store this API exists for. It reads the current value during
 * render instead of setting state inside an effect, which avoids the extra
 * render pass and the tearing that comes with it.
 *
 * The server snapshot is `false`, so SSR and the first client render agree.
 *
 * Only reach for this when the behaviour cannot be expressed in CSS — plain
 * responsive classes need no JavaScript and never flash.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onStoreChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onStoreChange);
      return () => list.removeEventListener('change', onStoreChange);
    },
    [query],
  );

  const getSnapshot = useCallback(() => window.matchMedia(query).matches, [query]);

  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}

/** Tailwind's `sm` breakpoint. */
export const SM_UP = '(min-width: 40rem)';

/**
 * Read the motion preference at the moment it is needed.
 *
 * The CSS in `globals.css` already neutralises transitions and animations, but
 * it cannot reach `scrollTo({ behavior: 'smooth' })` — an explicit behaviour in
 * JavaScript overrides `scroll-behavior` entirely. Anything that scrolls
 * programmatically has to ask, and it has to ask when it scrolls rather than
 * when it rendered, so a preference changed mid-session is honoured.
 */
export function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}
