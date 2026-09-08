import { z } from 'zod';

/** A single dish can be ordered at most this many times in one line. */
export const MAX_LINE_QUANTITY = 50;
/** Distinct lines per cart. Generous for a real order, tight enough to bound work per request. */
export const MAX_CART_LINES = 60;

/**
 * What the browser is allowed to tell the server about the cart.
 *
 * Note what is absent: prices, names, totals. The client sends identity and
 * quantity only; everything with a currency attached is derived from the
 * database in `priceCart`. This is the single most important boundary in the
 * application — a cart that carried its own prices could be edited in DevTools.
 */
export const cartLineSchema = z.object({
  productId: z.uuid(),
  optionIds: z.array(z.uuid()).max(40).default([]),
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

export type CartLine = z.infer<typeof cartLineSchema>;

export const cartSchema = z.array(cartLineSchema).min(1).max(MAX_CART_LINES);

export type Cart = z.infer<typeof cartSchema>;

/**
 * Stable identity for a cart line in the UI.
 *
 * Two lines merge only when they are the same dish with the same options, so
 * "large pizza with extra cheese" stays separate from "large pizza". Option ids
 * are sorted because selection order is not meaningful.
 */
export function cartLineKey(productId: string, optionIds: readonly string[]): string {
  return [productId, ...[...optionIds].sort()].join('|');
}
