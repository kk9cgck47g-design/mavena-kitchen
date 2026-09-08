'use server';

import { getLocale } from 'next-intl/server';

import type { OrderStatus, PaymentStatus } from '@/lib/domain';
import { isLocale } from '@/lib/i18n/locales';
import { clientIp } from '@/server/http/client-ip';
import { getOrderStatusSnapshot } from '@/server/services/orders';
import { orderIdByTrackingToken, startPayment } from '@/server/services/payments';
import { consumeRateLimit, LIMITS, rateLimitKey } from '@/server/services/rate-limit';

/**
 * Where an order stands, asked every few seconds by the tracking screen.
 *
 * The token is the only credential, exactly as it is for the page itself, and
 * the answer is four fields — the status, when it last moved, the ETA and, if
 * it was cancelled, why. Nothing identifying comes back: someone guessing at
 * this endpoint learns that a token exists and nothing about whose it is.
 *
 * A wrong token answers `null` rather than an error. The screen treats that as
 * "no news" and keeps the order it already rendered, which is the right
 * behaviour for a link that was mistyped and for one that is momentarily
 * unreachable alike.
 */

export interface OrderStatusSnapshot {
  status: OrderStatus;
  updatedAt: string;
  etaMinutes: number;
  cancelReason: string | null;
  /**
   * Carried so the screen can stop asking a customer to pay the moment the money
   * lands — including when it lands via the sweep rather than via their own
   * return, which is exactly the case where nothing else would tell them.
   */
  paymentStatus: PaymentStatus;
}

export async function pollOrderStatus(token: unknown): Promise<OrderStatusSnapshot | null> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) return null;

  /*
    High, because this is the one endpoint customers call on a timer: six times a
    minute each, for as long as their food is being made. The screen treats a
    null as "no news" and keeps what it is showing, so being limited degrades to
    a slower-updating page rather than to an error — which is the right failure
    for something nobody asked for by pressing a button.
  */
  const verdict = await consumeRateLimit(
    rateLimitKey('track:ip', await clientIp()),
    LIMITS.trackingByIp,
  );

  if (!verdict.allowed) return null;

  try {
    return await getOrderStatusSnapshot(token);
  } catch (error) {
    // A database hiccup must not make the tracking screen say the order is
    // gone. The customer keeps what they were shown; the detail goes to the log.
    console.error('[order] status poll failed', error);
    return null;
  }
}

/**
 * Start paying for this order, or carry on paying for it.
 *
 * The retry button, and the first attempt too when the checkout could not open a
 * session. One action for both, because they are one question — "where do I send
 * this customer to pay?" — and `startPayment` owns the answer, including whether a
 * live attempt should be resumed rather than replaced.
 *
 * The tracking token is the credential, exactly as it is for the page this is
 * called from. It authorises nothing beyond this order: the token is exchanged for
 * an order id on the server and never leaves, and no amount is accepted from the
 * caller — what is charged is what is on the order.
 *
 * Reachable by direct POST like every Server Action, so the guards are the
 * server's own. A caller who guesses a token can start a payment for somebody
 * else's order, which is the one thing here worth thinking about, and it is
 * harmless in the direction that matters: they would be paying for it.
 */

export type StartOrderPaymentResponse =
  | { ok: true; redirectUrl: string }
  | { ok: false; code: 'NOT_FOUND' | 'NOT_PAYABLE' | 'WINDOW_CLOSED' | 'UNAVAILABLE' };

export async function startOrderPayment(token: unknown): Promise<StartOrderPaymentResponse> {
  if (typeof token !== 'string' || token.length === 0 || token.length > 200) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  /*
    Each of these opens a session at somebody else's gateway, so it is not free
    to us or to them. Keyed by the order as well as the address: retrying a
    declined card is expected and should not be rationed by whatever else is
    happening on the same carrier gateway.
  */
  const [byOrder, byIp] = await Promise.all([
    consumeRateLimit(rateLimitKey('pay:token', token), LIMITS.paymentStartsByOrder),
    consumeRateLimit(rateLimitKey('pay:ip', await clientIp()), LIMITS.paymentStartsByIp),
  ]);

  if (!byOrder.allowed || !byIp.allowed) return { ok: false, code: 'UNAVAILABLE' };

  try {
    const orderId = await orderIdByTrackingToken(token);
    if (!orderId) return { ok: false, code: 'NOT_FOUND' };

    const locale = await getLocale();
    const result = await startPayment(orderId, isLocale(locale) ? locale : 'hy');

    if (result.ok) return { ok: true, redirectUrl: result.redirectUrl };

    // Collapsed to what the screen can act on. "No provider configured" and "the
    // gateway would not answer" are the same sentence to a customer — try again —
    // and the difference is in the log, where somebody can do something about it.
    switch (result.error.code) {
      case 'ORDER_NOT_FOUND':
        return { ok: false, code: 'NOT_FOUND' };
      case 'NOT_PAYABLE':
        return { ok: false, code: 'NOT_PAYABLE' };
      case 'WINDOW_CLOSED':
        return { ok: false, code: 'WINDOW_CLOSED' };
      default:
        return { ok: false, code: 'UNAVAILABLE' };
    }
  } catch (error) {
    console.error('[order] starting a payment failed', error);
    return { ok: false, code: 'UNAVAILABLE' };
  }
}
