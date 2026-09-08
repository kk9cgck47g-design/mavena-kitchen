'use server';

import { after } from 'next/server';
import { getLocale } from 'next-intl/server';

import type { CheckoutQuote, OrderingWindow } from '@/lib/checkout-types';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { checkoutSchema, quoteRequestSchema } from '@/lib/schemas/checkout';
import { quoteCheckout } from '@/server/services/checkout-quote';
import { clientIp } from '@/server/http/client-ip';
import { createOrder, type CreateOrderError } from '@/server/services/orders';
import { startPayment } from '@/server/services/payments';
import { consumeRateLimit, LIMITS, rateLimitKey } from '@/server/services/rate-limit';
import { dispatchForOrder } from '@/server/telegram/dispatch';

/**
 * What an order would cost, asked repeatedly while the form is being filled in.
 *
 * Reachable by direct POST like every Server Action, so the payload is parsed
 * rather than trusted. There is nothing to authorise — quoting is exactly as
 * public as the menu and the delivery zones already are on `/contacts` — but it
 * reads the database, so the input has to be bounded before it gets there.
 *
 * It creates nothing. The order itself is a separate action with its own
 * validation, so a caller who finds this endpoint can learn a price and nothing
 * more.
 */

export type QuoteResponse =
  | { ok: true; quote: CheckoutQuote; ordering: OrderingWindow }
  /** The request was malformed — our own form cannot produce this. */
  | { ok: false; code: 'INVALID_REQUEST' }
  /** The menu or the settings could not be read. Distinct from a refusal to deliver. */
  | { ok: false; code: 'UNAVAILABLE' };

export async function requestQuote(payload: unknown): Promise<QuoteResponse> {
  const parsed = quoteRequestSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID_REQUEST' };

  /*
    Generous, and keyed by address alone because there is nothing else to key it
    by — nobody has identified themselves at this point. In this city that address is
    a carrier gateway shared by a neighbourhood, so this is set for a busy
    evening of a whole town rather than for one person: it exists to stop a
    script from making us price things all night, not to ration customers.
  */
  const quoteVerdict = await consumeRateLimit(
    rateLimitKey('quote:ip', await clientIp()),
    LIMITS.quotesByIp,
  );

  // Reported as "unavailable" rather than as a refusal of its own. The screen
  // already knows how to keep the last good total and offer to try again, and a
  // customer who has done nothing wrong should not be told they have.
  if (!quoteVerdict.allowed) return { ok: false, code: 'UNAVAILABLE' };

  const { type, cityCode, lat, lng, cart } = parsed.data;

  try {
    const { quote, window: ordering } = await quoteCheckout({
      type,
      cityCode,
      // Both halves or neither: a latitude on its own is not a location.
      point: typeof lat === 'number' && typeof lng === 'number' ? { lat, lng } : null,
      cart,
    });

    return { ok: true, quote, ordering };
  } catch (error) {
    // The customer gets "try again"; the detail goes to the server log, where it
    // is useful, rather than into a response, where it would only leak.
    console.error('[checkout] quote failed', error);
    return { ok: false, code: 'UNAVAILABLE' };
  }
}

/**
 * Place the order.
 *
 * The one action here that changes anything, and the last point at which any of
 * it can be refused. It validates the payload and then hands it to
 * `createOrder`, which recomputes every amount from the database, re-reads the
 * menu, the zones, the opening hours and the kill switch, and rejects a payload
 * that no longer adds up. Nothing the browser sent about money survives that.
 *
 * What comes back is a tracking token and nothing else. The order's amounts,
 * code and address are read from the row by the page the customer lands on, so
 * a caller who guesses at this endpoint learns whether their own request
 * succeeded and no more.
 *
 * In demo mode `createOrder` refuses before it touches anything, and this
 * action reports that refusal like any other — see the note there for why the
 * ban lives in the service and not in the UI.
 */

export type PlaceOrderError =
  | CreateOrderError
  /** The payload did not validate — our own form cannot produce this. */
  | { code: 'INVALID_REQUEST' }
  /** This phone number or address has placed too many orders in a short time. */
  | { code: 'TOO_MANY_ORDERS' }
  /** Something failed on the way. Nothing is known about whether an order exists. */
  | { code: 'UNAVAILABLE' };

export type PlaceOrderResponse =
  | {
      ok: true;
      trackingToken: string;
      alreadyExisted: boolean;
      /**
       * Where to send the customer to pay, for an online order.
       *
       * Absent for cash and card-on-delivery, and absent too when the order is
       * online but a session could not be opened. That second case is not a
       * failure worth showing: the order exists and is waiting, so the browser
       * goes to the tracking page, which offers to start the payment again. An
       * order created and then reported as broken would be the worse answer.
       */
      redirectUrl?: string;
    }
  | { ok: false; error: PlaceOrderError };

export async function placeOrder(payload: unknown): Promise<PlaceOrderResponse> {
  const parsed = checkoutSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, error: { code: 'INVALID_REQUEST' } };

  /*
    Two keys, and the phone is the one doing the work.

    Every order that succeeds prints a ticket in a kitchen, so this is the limit
    standing between a script and a cook's evening. The address cannot carry it
    alone — behind a carrier gateway that is a neighbourhood — but a phone number
    is a real customer, and a number ordering eight times an hour is not one.

    Counted before the order is attempted rather than after it succeeds, so that
    concurrent submissions each cost an attempt rather than all reading the same
    count and all being allowed. The price is that a replayed submission — same
    idempotency key, no new order — also costs one. At eight an hour that is
    room for a family ordering twice and correcting a mistake.
  */
  const [byPhone, byIp] = await Promise.all([
    consumeRateLimit(rateLimitKey('order:phone', parsed.data.phone), LIMITS.ordersByPhone),
    consumeRateLimit(rateLimitKey('order:ip', await clientIp()), LIMITS.ordersByIp),
  ]);

  if (!byPhone.allowed || !byIp.allowed) {
    return { ok: false, error: { code: 'TOO_MANY_ORDERS' } };
  }

  try {
    const result = await createOrder(parsed.data);

    if (!result.ok) return { ok: false, error: result.error };

    /*
      Notifying the kitchen happens after the customer has their answer.

      `after` runs once the response has been sent, which is the only place this
      belongs: the customer should not wait on Telegram, and Telegram being slow
      or down should not delay a confirmation for an order that already exists.
      Not awaited and not able to fail the request — the outbox row was written
      inside the order's transaction, so anything that does not get through
      stays queued and can be retried from the panel.

      It lives here rather than in `createOrder` because `after` is a Next.js
      API and `server/services` deliberately imports no Next.js at all.

      An online order has nothing queued yet, so this finds nothing and does
      nothing. Its ticket is queued when the payment is confirmed, and dispatched
      by whoever confirmed it — see `sendQueuedTickets`.
    */
    after(() => dispatchForOrder(result.order.id));

    /*
      The order exists; now it needs paying.

      Deliberately after the order and never instead of it. The order is the
      record of what the customer asked for and is worth having even if the
      gateway is down — which is the difference between "we could not reach the
      bank, here is your order, try again" and losing the whole basket.

      `startPayment` resumes rather than duplicates, so the replay of a
      double-tapped submit hands back the same session the first tap opened
      instead of opening a second one against the same order.
    */
    if (parsed.data.paymentMethod === 'ONLINE' && result.order.status === 'AWAITING_PAYMENT') {
      const started = await startPayment(result.order.id, await currentLocale());

      return {
        ok: true,
        trackingToken: result.order.trackingToken,
        alreadyExisted: result.alreadyExisted,
        ...(started.ok ? { redirectUrl: started.redirectUrl } : {}),
      };
    }

    return {
      ok: true,
      trackingToken: result.order.trackingToken,
      /** True when this request replayed an order that already existed. */
      alreadyExisted: result.alreadyExisted,
    };
  } catch (error) {
    console.error('[checkout] placing the order failed', error);
    return { ok: false, error: { code: 'UNAVAILABLE' } };
  }
}

/** The locale of the page the customer is on, for the provider's page and the return trip. */
async function currentLocale(): Promise<Locale> {
  const raw = await getLocale();
  return isLocale(raw) ? raw : 'hy';
}
