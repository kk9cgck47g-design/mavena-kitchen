import { z } from 'zod';

import { CITY_CODES, ORDER_TYPES, PAYMENT_METHODS, type PaymentMethod } from '@/lib/domain';
import { normalizeArmenianPhone } from '@/lib/phone';
import { cartLineSchema, cartSchema, MAX_CART_LINES } from './cart';

/**
 * The checkout payload.
 *
 * Note what this system deliberately does NOT collect: apartment, entrance,
 * floor. The delivery area is compact enough that a map pin plus a landmark beats
 * three extra fields nobody wants to fill in on a phone.
 */

const nameSchema = z
  .string()
  .trim()
  .min(2)
  .max(80)
  // Strip control and formatting characters, so a name cannot break the Telegram
  // kitchen ticket or smuggle invisible text into it.
  .transform((value) => value.replace(/[\p{Cc}\p{Cf}]/gu, ''));

const phoneSchema = z
  .string()
  .trim()
  .transform((value, ctx) => {
    const normalized = normalizeArmenianPhone(value);
    if (!normalized) {
      ctx.addIssue({ code: 'custom', message: 'INVALID_PHONE' });
      return z.NEVER;
    }
    return normalized;
  });

const baseCheckoutSchema = z.object({
  customerName: nameSchema,
  phone: phoneSchema,
  notes: z.string().trim().max(500).optional(),
  paymentMethod: z.enum(PAYMENT_METHODS),
  /** ISO string; validated against the pre-order window on the server. */
  scheduledFor: z.iso.datetime({ offset: true }).optional(),
  /** Generated once per checkout attempt in the browser. Turns a double-tap into one order. */
  idempotencyKey: z.uuid(),
  /**
   * The total the customer was shown and agreed to.
   *
   * The server still recomputes everything from the database and ignores this
   * as an input to any sum — it is a promise to compare against, not a price.
   * If the menu moved or a zone was redrawn while the address was being typed,
   * the order is refused and the new amount is shown, rather than a total
   * nobody has seen being charged silently.
   *
   * Optional because it is a promise not every caller can make: our own form
   * always quotes before it submits, so it always can. A wrong or missing value
   * can only ever cause a refusal, never a discount, so there is nothing here
   * for a hostile client to gain.
   */
  expectedTotal: z.number().int().min(0).optional(),
  cart: cartSchema,
});

export const checkoutSchema = z.discriminatedUnion('type', [
  baseCheckoutSchema.extend({
    type: z.literal('DELIVERY'),
    cityCode: z.enum(CITY_CODES),
    address: z.string().trim().min(3).max(200),
    landmark: z.string().trim().max(200).optional(),
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
  }),
  baseCheckoutSchema.extend({
    type: z.literal('PICKUP'),
  }),
]);

export type CheckoutInput = z.infer<typeof checkoutSchema>;
export type DeliveryCheckoutInput = Extract<CheckoutInput, { type: 'DELIVERY' }>;

/**
 * What the browser may ask a price for.
 *
 * Looser than `checkoutSchema` on purpose. A quote is requested continuously
 * while the customer is still filling the form in, so a half-finished delivery —
 * no city chosen yet, no pin dropped — is the normal case rather than an error.
 * Those come back as a `CITY_REQUIRED` / `LOCATION_REQUIRED` blocker, which the
 * screen can render as guidance; a validation failure could only be rendered as
 * "something went wrong".
 *
 * An empty cart is accepted for the same reason: removing the last line is a
 * thing customers do, and the answer to it is a screen, not an exception.
 *
 * The bounds are still enforced. This is a public POST endpoint, and nothing
 * here is trusted just because our own form usually sends it.
 */
export const quoteRequestSchema = z.object({
  type: z.enum(ORDER_TYPES),
  cityCode: z.enum(CITY_CODES).nullish(),
  lat: z.number().min(-90).max(90).nullish(),
  lng: z.number().min(-180).max(180).nullish(),
  cart: z.array(cartLineSchema).max(MAX_CART_LINES),
});

export type QuoteRequest = z.infer<typeof quoteRequestSchema>;

/**
 * The methods that need no payment provider: the money changes hands at the door.
 *
 * Always available, whatever else is or is not configured. If online payment
 * breaks, is switched off, or was never set up, ordering still works — which is
 * the point of keeping these two as a floor rather than as one option among
 * three.
 */
export const OFFLINE_PAYMENT_METHODS = ['CASH', 'CARD_ON_DELIVERY'] as const;

/**
 * What the customer may choose from.
 *
 * A function of the deployment rather than a constant, because `ONLINE` is real
 * only where a provider is configured. Offering it anywhere else would put a
 * button on screen that the server refuses — which the customer would discover by
 * pressing it, having already filled in the form.
 *
 * The server calls this too, with its own answer about the provider, and refuses
 * anything not in the result. A client claiming online payment is available gains
 * nothing: it is not the client's claim that is checked.
 */
export function availablePaymentMethods(onlineEnabled: boolean): readonly PaymentMethod[] {
  return onlineEnabled ? [...OFFLINE_PAYMENT_METHODS, 'ONLINE'] : OFFLINE_PAYMENT_METHODS;
}

/**
 * The fallback when nothing is known yet — a fresh draft, or a persisted
 * preference for a method no longer on offer.
 *
 * Cash, because it is the one method that cannot stop being possible.
 */
export const DEFAULT_PAYMENT_METHOD: PaymentMethod = 'CASH';

/** `ORDER_TYPES` is re-exported so callers do not need two imports to build a form. */
export { ORDER_TYPES };
