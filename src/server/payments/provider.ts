import type { Amd } from '@/lib/money';
import type { Locale } from '@/lib/i18n/locales';

/**
 * What this system needs from a payment provider, and nothing else.
 *
 * No acquirer has been chosen yet, so this interface is deliberately written
 * without one in mind. It describes the shape every hosted redirect flow has —
 * ask for a session, send the customer away, find out later what happened — and
 * says nothing about how a particular gateway spells any of it.
 *
 * Three things are load-bearing:
 *
 * **`fetchStatus` is the only source of truth.** Not the return URL, not a
 * callback. A customer coming back to our site is a hint that something happened
 * and is worth asking about; it is not evidence of payment, because it is a
 * browser navigation that anyone can perform, repeat or skip entirely. Every
 * confirmation in this system therefore ends up asking the provider directly,
 * and a provider that also pushes notifications is a convenience — its webhook
 * route would call the same reconciliation, not a second path to `PAID`.
 *
 * This also decides the behaviour nobody thinks about until it costs money: the
 * customer who pays and immediately closes the tab. Nothing returns, nothing is
 * pushed, and the only thing that recovers the order is a sweep asking about
 * every attempt it is still waiting on.
 *
 * **Amounts are whole drams on both sides.** Some gateways want minor units,
 * some want strings, some want a currency code repeated three ways. All of that
 * is the adapter's problem and must not leak past it: the core compares an
 * integer number of drams against an integer number of drams, and a rounding
 * convention invented at this boundary would be a rounding convention applied to
 * somebody's money.
 *
 * **Card data never appears here, in any form.** There is no field for it in any
 * of these types and there must never be one. The customer types their card on
 * the provider's own page, on the provider's own domain; what crosses this
 * interface is an identifier, an amount and an outcome. That is what keeps this
 * server out of PCI scope, and it is a property of the interface rather than a
 * habit of its implementations.
 */

export interface PaymentSessionRequest {
  /**
   * Our own identifier for this attempt — the `payments` row id.
   *
   * Sent so the provider can echo it back and so their support can find the
   * attempt when we phone about it. Not a secret, and not used to authorise
   * anything: `confirmPayment` re-reads the row and re-asks the provider.
   */
  reference: string;
  /** `MK-482193`. For the human staring at a payment page — theirs and ours. */
  publicCode: string;
  /** Whole drams. The adapter converts if its gateway insists on something else. */
  amount: Amd;
  /**
   * Where the customer is sent when the provider is done with them, whatever
   * the outcome.
   *
   * One URL for success and failure alike, because the outcome is not taken from
   * the return: both land on the same handler, which asks `fetchStatus` what
   * actually happened. A provider that requires separate success and failure URLs
   * can point both at this one.
   */
  returnUrl: string;
  /** So the provider's own page, if it has translations, matches the site. */
  locale: Locale;
}

export interface PaymentSession {
  /**
   * The provider's identifier for the attempt.
   *
   * Stored on the `payments` row and unique per provider, which is what makes
   * every later answer about this attempt land on one row.
   */
  externalId: string;
  /** Absolute URL. The customer's browser goes here and leaves our site. */
  redirectUrl: string;
  /** Whatever the provider said, kept verbatim. Must contain no card data. */
  raw: unknown;
}

/**
 * What the provider says about an attempt.
 *
 * `PENDING` and `UNKNOWN` are kept apart because they mean opposite things about
 * waiting. `PENDING` is "not yet, ask again" — the customer may still be typing.
 * `UNKNOWN` is "no such attempt", which asking again will not improve: either the
 * session was never created or the provider has forgotten it, and both are for a
 * person to look at rather than a loop to retry.
 */
export type PaymentOutcome =
  | { state: 'PENDING' }
  | {
      state: 'PAID';
      /**
       * What the provider says was actually taken, in whole drams.
       *
       * Checked against what the attempt asked for before anything is marked
       * paid. It is not assumed to match — that check is the point of returning
       * it, and a gateway misconfigured to charge a different amount is exactly
       * the case that must not slip through as a successful order.
       */
      amount: Amd;
      raw: unknown;
    }
  | { state: 'FAILED'; reason: string | null; raw: unknown }
  | { state: 'UNKNOWN' };

export interface PaymentProvider {
  /** Stored on every `payments` row this adapter creates. */
  readonly name: string;

  /**
   * Open an attempt and return where to send the customer.
   *
   * Called once per attempt. The core guarantees at most one live attempt per
   * order — see `startPayment` — so an adapter does not need its own idempotency
   * beyond whatever its gateway requires.
   */
  createSession(request: PaymentSessionRequest): Promise<PaymentSession>;

  /**
   * Ask what happened to an attempt.
   *
   * Must be safe to call repeatedly and at any time, including long after the
   * outcome was recorded: the sweep calls it on a schedule and the return
   * handler calls it on a navigation the customer can repeat by refreshing.
   * Nothing about the answer may depend on how many times it has been asked.
   */
  fetchStatus(externalId: string): Promise<PaymentOutcome>;
}
