import { IS_DEMO } from '@/lib/demo';
import { env } from '@/lib/env';
import type { PaymentProvider } from './provider';
import { stubPaymentProvider } from './stub';

/**
 * Which provider, if any, is taking money on this deployment.
 *
 * Online payment is off unless `PAYMENT_PROVIDER` names an adapter. Off is the
 * safe default in both directions: a deployment that has not been given an
 * acquirer cannot offer a payment method it has no way to complete, and one that
 * loses the variable stops offering it rather than accepting orders it can never
 * collect on.
 *
 * `stub` is the only adapter that exists. A real one is added to this map and to
 * the enum in `lib/env.ts`, and nothing else in the system changes — which is the
 * whole reason the abstraction is shaped the way it is.
 */

const PROVIDERS: Record<string, () => PaymentProvider> = {
  stub: () => stubPaymentProvider,
};

/**
 * The adapter that can actually charge somebody, or `null`.
 *
 * Null in demo mode, unconditionally and before the variable is even read. The
 * preview has no database for the stub to keep its records in, and more to the
 * point a public preview that could open a payment session — even a fake one —
 * is a payment session somebody can be sent a link to. Everything that takes
 * money is refused at the source there, exactly as order creation is.
 */
export function configuredProvider(): PaymentProvider | null {
  if (IS_DEMO) return null;

  const name = env.PAYMENT_PROVIDER;
  if (!name) return null;

  return PROVIDERS[name]?.() ?? null;
}

/**
 * Whether the checkout may show online payment at all.
 *
 * Not the same question as `configuredProvider()`, and the difference is demo
 * mode: the preview exists to show the product, so the method appears there and
 * the payment states are walkable, while nothing behind it can move a dram. Every
 * server path that would take money asks `configuredProvider()` instead and gets
 * `null`.
 */
export function isOnlinePaymentOffered(): boolean {
  return IS_DEMO || configuredProvider() !== null;
}
