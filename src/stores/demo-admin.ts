'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { canTransition, type OrderStatus } from '@/lib/domain';
import { BROWSER_STORAGE_KEYS } from '@/lib/browser-storage';
import type { DemoChanges } from '@/lib/demo-admin-state';

/**
 * Everything the demo admin panel "changes".
 *
 * This store is the reason the published preview can have a working admin panel
 * without a database and without any way to write to one. The orders themselves
 * come from `server/demo/orders.ts` and are regenerated, identically, on every
 * request; this holds only the differences a visitor has made during their
 * visit, and the panel renders `override ?? original`.
 *
 * There is no server action behind any of it. A demo status change is a `set()`
 * in the browser — not a request that a server refuses, but a request that is
 * never made. The one server-side ban that matters (`createOrder` refusing in
 * demo) is untouched and unrelated.
 *
 * `sessionStorage`, not `localStorage`, and that choice does two jobs. It lets a
 * status changed in the panel show up on the customer's tracking screen in
 * another tab of the same session, which is the whole point of the
 * demonstration. And it makes the reset honest: closing the tab clears it, so
 * the next visitor to the preview finds the kitchen as it was designed rather
 * than mid-shift because a stranger left it that way.
 *
 * The rules for reading it back live in `lib/demo-admin-state.ts`, which is
 * plain and testable; this file is the wiring.
 */

interface DemoAdminState {
  /** Order id → the changes made to it, oldest first. */
  changes: DemoChanges;
  hydrated: boolean;

  /**
   * Returns false when the move is not legal from where the order stands. The
   * demo enforces the real state machine — a panel that let an owner drag a
   * cancelled order back into the kitchen would be teaching them something
   * untrue about the system they are being shown.
   */
  advance: (orderId: string, from: OrderStatus, to: OrderStatus, note?: string) => boolean;
  reset: () => void;
  setHydrated: () => void;
}

export const useDemoAdmin = create<DemoAdminState>()(
  persist(
    (set, get) => ({
      changes: {},
      hydrated: false,

      advance: (orderId, from, to, note) => {
        const current = get().changes[orderId] ?? [];
        const standing = current.at(-1)?.status ?? from;

        if (!canTransition(standing, to)) return false;

        set((state) => ({
          changes: {
            ...state.changes,
            [orderId]: [
              ...current,
              { status: to, at: new Date().toISOString(), note: note ?? null },
            ],
          },
        }));

        return true;
      },

      reset: () => set({ changes: {} }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: BROWSER_STORAGE_KEYS.demoAdmin,
      storage: createJSONStorage(() => sessionStorage),
      partialize: (state) => ({ changes: state.changes }),
      version: 1,
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

export { demoEventsFor, demoStatusOf } from '@/lib/demo-admin-state';
export type { DemoChanges, DemoStatusChange } from '@/lib/demo-admin-state';
