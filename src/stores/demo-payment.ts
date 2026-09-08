'use client';

import { create } from 'zustand';

import type { PaymentStatus } from '@/lib/domain';

/**
 * The demo's entire payment system.
 *
 * The published preview has no database, no provider and nothing that can move a
 * dram — and it still has to be able to *show* what paying looks like, because
 * "how does the customer pay?" is the first question anyone asks of a food
 * ordering site. So the flow is real and the money is not: pressing "pay" on the
 * fake page writes a word into this store, the tracking page reads it, and the
 * order appears to have been paid.
 *
 * Deliberately in memory and nothing else. Not `localStorage`, unlike the cart
 * and the checkout draft: those exist to survive a closed tab, and this exists to
 * *not*. A reload is the demo's reset button, the same way it is for the demo
 * admin panel's status changes — see `stores/demo-admin.ts`, which this follows
 * on purpose. A preview that remembered payments across sessions would be
 * accumulating state about visitors, which is exactly what the preview is
 * designed not to do.
 *
 * Keyed by tracking token because that is what both screens have in hand. Nothing
 * about a card, a session or an amount is stored — there is nothing to store, as
 * the fake page has no card field.
 */

interface DemoPaymentState {
  /** `{ [trackingToken]: outcome }` for the orders paid in this tab. */
  outcomes: Record<string, Extract<PaymentStatus, 'PAID' | 'FAILED'>>;
  decide: (token: string, outcome: 'PAID' | 'FAILED') => void;
  reset: () => void;
}

export const useDemoPayment = create<DemoPaymentState>()((set) => ({
  outcomes: {},
  decide: (token, outcome) =>
    set((state) => ({ outcomes: { ...state.outcomes, [token]: outcome } })),
  reset: () => set({ outcomes: {} }),
}));

/**
 * How the demo order stands, given what has happened in this tab.
 *
 * Returns the order's own state when nothing has: a demo order awaiting payment
 * that nobody has paid yet is still awaiting payment, which is what the seed says.
 */
export function demoPaymentStatusOf(
  outcomes: Record<string, string>,
  token: string,
  seeded: PaymentStatus,
): PaymentStatus {
  const decided = outcomes[token];
  if (decided === 'PAID') return 'PAID';

  // A declined attempt leaves the order exactly where it was — unpaid, inside its
  // window, retryable. The same as the real thing: see `recordFailure`.
  return seeded;
}

/** True when the last attempt in this tab was declined, for the notice on the screen. */
export function demoPaymentFailed(outcomes: Record<string, string>, token: string): boolean {
  return outcomes[token] === 'FAILED';
}
