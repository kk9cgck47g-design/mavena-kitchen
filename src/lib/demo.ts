/**
 * Demo mode.
 *
 * The published preview exists to show the design, not to take real orders.
 * With `NEXT_PUBLIC_DEMO_MODE=1` the site serves its menu from the same
 * constants the database seed uses, so it needs no Postgres at all: every page
 * renders from memory and the whole thing deploys as a static site.
 *
 * Two things this buys beyond convenience. There is no database to leak and no
 * connection string to store — the deployment holds nothing worth stealing. And
 * anything that would touch the real world (placing an order, notifying the
 * kitchen, taking payment) is refused at the source rather than merely hidden in
 * the UI, so a demo link can never produce an order nobody is going to cook.
 *
 * `NEXT_PUBLIC_` because both the server and the client need it: the server to
 * pick a data source, the client to label the disabled controls.
 */
export const IS_DEMO = process.env.NEXT_PUBLIC_DEMO_MODE === '1';

/**
 * The demo's stand-in for a payment provider's reference.
 *
 * A demo order has no payment row to point at, so the fake payment page is
 * reached by the one identifier a demo order does have: its tracking token, with a
 * prefix that keeps it from ever being mistaken for a real provider's reference.
 *
 * These live here rather than beside the demo payment store because a server
 * component needs them, and that store is `'use client'` — a function exported
 * from a client module is a reference the server cannot call.
 */
const DEMO_PAYMENT_PREFIX = 'demo-pay-';

export function demoPaymentReference(trackingToken: string): string {
  return `${DEMO_PAYMENT_PREFIX}${trackingToken}`;
}

/** The token behind a demo reference, or null if this is not one. */
export function demoTokenFromReference(reference: string): string | null {
  return reference.startsWith(DEMO_PAYMENT_PREFIX)
    ? reference.slice(DEMO_PAYMENT_PREFIX.length)
    : null;
}
