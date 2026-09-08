import type {
  CheckoutBlocker,
  CheckoutQuote,
  CheckoutQuoteInput,
  DeliveryBlocker,
  OrderingWindow,
  QuotedZone,
} from '@/lib/checkout-types';
import { assertAmd, clampToZero } from '@/lib/money';
import { quoteDelivery, type DeliveryZoneRule } from './delivery';
import { getPricingProducts } from './menu';
import { getOrderingWindow } from './opening-hours';
import { priceCart, type PricedLine, type PricingProduct } from './pricing';
import { getActiveDeliveryZones, getSettings } from './settings';

/**
 * What an order would cost, without placing it.
 *
 * The checkout page needs every amount it displays — subtotal, delivery fee,
 * total, ETA — before the customer commits, and it must not compute any of them
 * itself. The cart in `localStorage` caches a unit price for instant feedback
 * while browsing, but that cache can be a day stale or edited in DevTools, so
 * nothing on the checkout screen is allowed to come from it.
 *
 * This is the same arithmetic `createOrder` performs, run through the same two
 * functions, which is the point: a quote that disagreed with the order the
 * customer then receives is worse than no quote at all. `createOrder` calls
 * `buildCheckoutQuote` too and re-reads the menu and the zones when it does, so
 * a quote is never carried over from the browser — only reproduced.
 */

/**
 * Re-exported so callers already talking to this module do not need a second
 * import. The definitions live in `lib/checkout-types.ts` because the checkout
 * screen switches on all of them.
 */
export type {
  CheckoutBlocker,
  CheckoutQuote,
  CheckoutQuoteInput,
  DeliveryBlocker,
  QuotedZone,
};

export interface PricedCheckout {
  quote: CheckoutQuote;
  /**
   * The priced lines behind the quote. Server-side only — this is what
   * `createOrder` freezes into `order_items`, and it never leaves the server.
   */
  lines: PricedLine[];
}

// --- Pure core ------------------------------------------------------------

/**
 * Price an order against a menu snapshot and a zone list.
 *
 * Pure, like `priceCart` and `quoteDelivery` that it composes, for the same
 * reason: this is where money is decided, so every interesting case has to be
 * testable without a database.
 */
export function buildCheckoutQuote(args: {
  input: CheckoutQuoteInput;
  productsById: ReadonlyMap<string, PricingProduct>;
  zones: readonly DeliveryZoneRule[];
  /** Kitchen time. The ETA for a pickup order, which has no zone to take one from. */
  prepTimeMinutes: number;
}): PricedCheckout {
  const { input } = args;

  // Not an error worth reporting — the customer simply has not chosen anything
  // yet. The checkout page uses it to decide to send them back to the menu.
  if (input.cart.length === 0) {
    return { quote: { blocker: { code: 'EMPTY_CART' }, subtotal: null, zone: null }, lines: [] };
  }

  const priced = priceCart(input.cart, args.productsById);

  if (!priced.ok) {
    return {
      quote: {
        blocker: { code: 'CART_INVALID', issues: priced.issues },
        subtotal: null,
        zone: null,
      },
      lines: [],
    };
  }

  const { subtotal, lines } = priced;

  const delivery = quoteDelivery({
    type: input.type,
    subtotal,
    // Pickup ignores both, whatever the caller passed.
    cityCode: input.type === 'DELIVERY' ? (input.cityCode ?? null) : null,
    point: input.type === 'DELIVERY' ? (input.point ?? null) : null,
    zones: args.zones,
  });

  if (!delivery.ok) {
    const blocker: DeliveryBlocker =
      delivery.reason === 'BELOW_MIN_ORDER'
        ? {
            code: 'BELOW_MIN_ORDER',
            zone: toQuotedZone(delivery.zone),
            minOrder: delivery.minOrder,
            missing: delivery.missing,
          }
        : { code: delivery.reason };

    return {
      quote: {
        blocker,
        subtotal,
        zone: blocker.code === 'BELOW_MIN_ORDER' ? blocker.zone : null,
      },
      lines,
    };
  }

  const isDelivery = delivery.kind === 'DELIVERY';
  const deliveryFee = isDelivery ? delivery.fee : 0;
  const discount = 0; // Promo codes land here once the UI exists.
  const total = clampToZero(subtotal + deliveryFee - discount);

  assertAmd(total, 'total');

  return {
    quote: {
      blocker: null,
      subtotal,
      deliveryFee,
      discount,
      total,
      etaMinutes: isDelivery ? delivery.etaMinutes : args.prepTimeMinutes,
      zone: isDelivery ? toQuotedZone(delivery.zone) : null,
      isFreeDelivery: isDelivery ? delivery.isFree : false,
      amountToFreeDelivery: isDelivery ? delivery.amountToFreeDelivery : null,
    },
    lines,
  };
}

function toQuotedZone(zone: DeliveryZoneRule): QuotedZone {
  return {
    id: zone.id,
    name: zone.name,
    fee: zone.fee,
    minOrder: zone.minOrder,
    freeDeliveryFrom: zone.freeDeliveryFrom,
    etaMinutes: zone.etaMinutes,
  };
}

// --- Loader ---------------------------------------------------------------

export interface CheckoutQuoteResult {
  quote: CheckoutQuote;
  /**
   * Re-checked on every quote rather than only when the page loads. Someone who
   * opened the menu at 22:50 and is still choosing at 23:05 must find out that
   * the kitchen has closed before they fill in an address, not after.
   */
  window: OrderingWindow;
}

/**
 * Quote an order against the live menu, zones and settings.
 *
 * Works unchanged in demo mode: every loader it calls already serves the same
 * constants the seed writes, so the published preview quotes real fees and real
 * minimums without a database anywhere.
 */
export async function quoteCheckout(input: CheckoutQuoteInput): Promise<CheckoutQuoteResult> {
  const [settings, zones, productsById] = await Promise.all([
    getSettings(),
    getActiveDeliveryZones(),
    getPricingProducts(input.cart.map((line) => line.productId)),
  ]);

  const { quote } = buildCheckoutQuote({
    input,
    productsById,
    zones,
    prepTimeMinutes: settings.prepTimeMinutes,
  });

  return {
    quote,
    window: getOrderingWindow(settings.workingHours, settings.isAcceptingOrders),
  };
}
