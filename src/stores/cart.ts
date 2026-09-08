'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import type { LocalizedText } from '@/lib/i18n/locales';
import { BROWSER_STORAGE_KEYS } from '@/lib/browser-storage';
import { cartLineKey, MAX_LINE_QUANTITY } from '@/lib/schemas/cart';
import type { CartLine } from '@/lib/schemas/cart';

/**
 * The cart.
 *
 * It holds display data — name, unit price, photo — so the UI can update
 * instantly without a round trip. That data is a *cache*, not a source of truth:
 * `toServerLines()` deliberately strips everything with a currency attached, and
 * the server reprices from the database when the order is placed. If a price
 * changed while the cart sat in localStorage overnight, the server rejects with
 * "prices have changed" rather than honouring the stale one.
 */

export interface CartItemOption {
  id: string;
  name: LocalizedText;
  priceDelta: number;
}

export interface CartItem {
  /** productId + sorted option ids. Same dish with different options stays separate. */
  key: string;
  productId: string;
  slug: string;
  name: LocalizedText;
  image: string | null;
  options: CartItemOption[];
  /** Cached for display only. The server recomputes this. */
  unitPrice: number;
  quantity: number;
}

interface CartState {
  items: CartItem[];
  /** Set once the persisted cart has been read, to avoid an SSR/client mismatch. */
  hydrated: boolean;

  add: (item: Omit<CartItem, 'key' | 'quantity'>, quantity?: number) => void;
  setQuantity: (key: string, quantity: number) => void;
  increment: (key: string) => void;
  decrement: (key: string) => void;
  remove: (key: string) => void;
  clear: () => void;
  setHydrated: () => void;
}

export const useCart = create<CartState>()(
  persist(
    (set) => ({
      items: [],
      hydrated: false,

      add: (item, quantity = 1) =>
        set((state) => {
          const key = cartLineKey(
            item.productId,
            item.options.map((option) => option.id),
          );
          const existing = state.items.find((line) => line.key === key);

          if (existing) {
            return {
              items: state.items.map((line) =>
                line.key === key
                  ? {
                      ...line,
                      quantity: Math.min(line.quantity + quantity, MAX_LINE_QUANTITY),
                      // Refresh the cached price — the menu may have moved since
                      // this line was first added.
                      unitPrice: item.unitPrice,
                    }
                  : line,
              ),
            };
          }

          return { items: [...state.items, { ...item, key, quantity }] };
        }),

      setQuantity: (key, quantity) =>
        set((state) => ({
          items:
            quantity <= 0
              ? state.items.filter((line) => line.key !== key)
              : state.items.map((line) =>
                  line.key === key
                    ? { ...line, quantity: Math.min(quantity, MAX_LINE_QUANTITY) }
                    : line,
                ),
        })),

      increment: (key) =>
        set((state) => ({
          items: state.items.map((line) =>
            line.key === key
              ? { ...line, quantity: Math.min(line.quantity + 1, MAX_LINE_QUANTITY) }
              : line,
          ),
        })),

      // Stepping below one removes the line — the alternative is a stuck "1" the
      // customer has to hunt for a separate delete button to clear.
      decrement: (key) =>
        set((state) => ({
          items: state.items.flatMap((line) =>
            line.key === key
              ? line.quantity <= 1
                ? []
                : [{ ...line, quantity: line.quantity - 1 }]
              : [line],
          ),
        })),

      remove: (key) => set((state) => ({ items: state.items.filter((l) => l.key !== key) })),

      clear: () => set({ items: [] }),

      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: BROWSER_STORAGE_KEYS.cart,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({ items: state.items }),
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);

// --- Derived values -------------------------------------------------------
// Plain functions rather than selectors that build new objects: returning a new
// object from a Zustand selector re-renders on every store change.

export function cartCount(items: CartItem[]): number {
  return items.reduce((total, line) => total + line.quantity, 0);
}

export function cartSubtotal(items: CartItem[]): number {
  return items.reduce((total, line) => total + line.unitPrice * line.quantity, 0);
}

/** Strip the cart down to what the server is willing to accept. */
export function toServerLines(items: CartItem[]): CartLine[] {
  return items.map((line) => ({
    productId: line.productId,
    optionIds: line.options.map((option) => option.id),
    quantity: line.quantity,
  }));
}
