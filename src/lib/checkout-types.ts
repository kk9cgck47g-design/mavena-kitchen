import type { CityCode, OrderType } from '@/lib/domain';
import type { LatLng } from '@/lib/geo';
import type { LocalizedText } from '@/lib/i18n/locales';
import type { Amd } from '@/lib/money';
import type { CartLine } from '@/lib/schemas/cart';

/**
 * The vocabulary of a checkout, shared by the server services and the UI.
 *
 * Declared here for the same reason as `menu-types.ts`: the checkout screen has
 * to switch on every one of these to decide what to tell the customer, and
 * importing them from `server/services/*` would drag the Drizzle client into a
 * client bundle. The services below produce these; components consume them.
 */

// --- Pricing failures -----------------------------------------------------

export type PricingIssueCode =
  | 'PRODUCT_NOT_FOUND'
  | 'PRODUCT_UNAVAILABLE'
  | 'OPTION_NOT_FOUND'
  | 'OPTION_UNAVAILABLE'
  | 'OPTION_NOT_ALLOWED'
  | 'TOO_FEW_OPTIONS'
  | 'TOO_MANY_OPTIONS';

export interface PricingIssue {
  code: PricingIssueCode;
  /** Index of the offending line in the submitted cart, so the UI can highlight it. */
  lineIndex: number;
  productId: string;
  productName?: LocalizedText;
  groupId?: string;
  groupName?: LocalizedText;
  optionId?: string;
  /** For TOO_FEW_OPTIONS / TOO_MANY_OPTIONS. */
  expected?: number;
  actual?: number;
}

// --- Ordering window ------------------------------------------------------

/**
 * Whether the restaurant will take an order right now.
 *
 * `isOpen` and `isPaused` are kept apart because "closed for the night" and "we
 * stopped taking orders because the kitchen is swamped" need different wording.
 */
export interface OrderingWindow {
  /** Both the schedule and the manual kill switch must allow it. */
  canOrder: boolean;
  isOpen: boolean;
  isPaused: boolean;
}

// --- Quotes ---------------------------------------------------------------

export interface CheckoutQuoteInput {
  type: OrderType;
  /** Required for delivery, ignored for pickup. */
  cityCode?: CityCode | null;
  /** The pin the customer placed. Required for delivery, ignored for pickup. */
  point?: LatLng | null;
  cart: readonly CartLine[];
}

/**
 * The zone a pin landed in, as the customer may see it.
 *
 * Deliberately without the polygon: the checkout page already receives every
 * active zone to draw the map, and echoing the geometry back on every keystroke
 * would be the largest thing in the response for no gain.
 */
export interface QuotedZone {
  id: string;
  name: LocalizedText;
  fee: Amd;
  minOrder: Amd;
  freeDeliveryFrom: Amd | null;
  etaMinutes: number;
}

/** Why this order cannot be placed as it currently stands. */
export type CheckoutBlocker =
  | { code: 'EMPTY_CART' }
  | { code: 'CART_INVALID'; issues: PricingIssue[] }
  | { code: 'CITY_REQUIRED' }
  | { code: 'LOCATION_REQUIRED' }
  | { code: 'OUT_OF_ZONE' }
  | { code: 'BELOW_MIN_ORDER'; zone: QuotedZone; minOrder: Amd; missing: Amd };

/** The blockers that are about where the order is going rather than what is in it. */
export type DeliveryBlocker = Exclude<
  CheckoutBlocker,
  { code: 'EMPTY_CART' } | { code: 'CART_INVALID' }
>;

/**
 * A quote, safe to send to the browser.
 *
 * A union rather than one shape with nullable amounts, so a blocked quote has no
 * `total` to render at all. The alternative — `total: number | null` — puts the
 * burden of remembering the null check on every call site, and the one place
 * that forgets shows a customer a price for an order they cannot place.
 */
export type CheckoutQuote =
  | {
      blocker: null;
      subtotal: Amd;
      deliveryFee: Amd;
      discount: Amd;
      total: Amd;
      etaMinutes: number;
      /** Null for pickup. */
      zone: QuotedZone | null;
      isFreeDelivery: boolean;
      /** How much more to add before delivery stops costing anything. Null if not applicable. */
      amountToFreeDelivery: Amd | null;
    }
  | {
      blocker: CheckoutBlocker;
      /**
       * Known whenever the cart itself priced cleanly — an address outside the
       * zones does not stop the customer from seeing what their food costs.
       * Null only when the cart could not be priced at all.
       */
      subtotal: Amd | null;
      /** Set for `BELOW_MIN_ORDER`, so the UI can name the minimum's source. */
      zone: QuotedZone | null;
    };
