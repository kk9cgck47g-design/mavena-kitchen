'use client';

import { create } from 'zustand';

/**
 * Ephemeral UI state. Separate from the cart store because none of this should
 * ever be persisted — reopening the site to a cart drawer left open from
 * yesterday would be baffling.
 */
interface UiState {
  cartOpen: boolean;
  openCart: () => void;
  closeCart: () => void;
  setCartOpen: (open: boolean) => void;
}

export const useUi = create<UiState>((set) => ({
  cartOpen: false,
  openCart: () => set({ cartOpen: true }),
  closeCart: () => set({ cartOpen: false }),
  setCartOpen: (cartOpen) => set({ cartOpen }),
}));
