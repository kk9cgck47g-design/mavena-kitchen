import {
  ORDER_STATUS_TRANSITIONS,
  TERMINAL_ORDER_STATUSES,
  type CityCode,
  type OrderStatus,
  type OrderType,
  type PaymentMethod,
  type PaymentStatus,
} from '@/lib/domain';
import type { LocalizedText } from '@/lib/i18n/locales';
import type { Amd } from '@/lib/money';

/**
 * An order as the customer and the staff see it.
 *
 * Declared here, next to `checkout-types.ts` and for the same reason: the
 * tracking screen and the admin panel are client components, and importing the
 * Drizzle row types would drag the database driver into their bundles.
 *
 * Timestamps are ISO strings rather than `Date`. They cross the server/client
 * boundary on every poll, they are rendered through `Intl` on the client, and a
 * string is the one representation that means the same thing on both sides.
 */

export interface OrderViewLine {
  id: string;
  name: LocalizedText;
  options: Array<{ name: LocalizedText; priceDelta: number }>;
  unitPrice: Amd;
  quantity: number;
  lineTotal: Amd;
  image: string | null;
}

export interface OrderView {
  id: string;
  /** `MK-482193`. For reading aloud on the phone — never for access. */
  publicCode: string;
  status: OrderStatus;
  type: OrderType;

  customerName: string;
  phone: string;

  cityCode: CityCode | null;
  address: string | null;
  landmark: string | null;
  lat: number | null;
  lng: number | null;

  notes: string | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  /**
   * When an unpaid online order stops being held. Null for every other method,
   * and for an online order that has already been paid, cancelled or expired —
   * there is nothing left to count down to.
   */
  paymentExpiresAt: string | null;

  subtotal: Amd;
  deliveryFee: Amd;
  discount: Amd;
  total: Amd;
  etaMinutes: number;

  createdAt: string;
  updatedAt: string;
  cancelReason: string | null;

  items: OrderViewLine[];
}

/** One line of the audit trail behind a status change. */
export interface OrderEventView {
  id: string;
  fromStatus: OrderStatus | null;
  toStatus: OrderStatus;
  /** `ADMIN`, `CUSTOMER`, later `TELEGRAM`. */
  source: string;
  note: string | null;
  createdAt: string;
}

/**
 * The happy path, in order, for the progress bar on the tracking screen.
 *
 * Pickup has no courier, so it never passes through `DELIVERING` — showing that
 * step greyed out would promise a delivery nobody agreed to. `CANCELLED` is
 * absent from both: it is not a step along the way but the end of the road, and
 * the screen renders it as its own final state.
 *
 * `AWAITING_PAYMENT` is absent for a different reason. It is not progress
 * towards the food — nothing is happening and nothing will until the customer
 * pays — so drawing it as step one of six would tell them their order is
 * underway. The screen gives it its own state, with the one action that moves it
 * along.
 */
export function statusSteps(type: OrderType): readonly OrderStatus[] {
  return type === 'DELIVERY'
    ? ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'DELIVERING', 'COMPLETED']
    : ['NEW', 'CONFIRMED', 'PREPARING', 'READY', 'COMPLETED'];
}

export function isTerminal(status: OrderStatus): boolean {
  return TERMINAL_ORDER_STATUSES.includes(status);
}

/**
 * Where an order sits on its own progress bar, as an index into `statusSteps`.
 *
 * `-1` for a cancelled order: it has left the track entirely, and pinning it to
 * whichever step it happened to reach would draw a progress bar that is still
 * making progress. Also `-1` for one awaiting payment, which has not joined the
 * track yet — `indexOf` would answer that anyway, and saying so here is what
 * makes it a decision rather than a coincidence.
 */
export function statusStepIndex(status: OrderStatus, type: OrderType): number {
  if (status === 'CANCELLED' || status === 'AWAITING_PAYMENT') return -1;
  return statusSteps(type).indexOf(status);
}

/**
 * What the tracking screen should say about the money, in one word.
 *
 * Derived rather than stored, and derived from the order alone — no payment
 * attempt is consulted. The customer's question is "does anything need doing?",
 * and the answer comes from where the order is, not from which of two declined
 * cards was declined more recently.
 *
 *   `NOT_NEEDED` — cash or card on delivery. The courier settles it.
 *   `AWAITING`   — online, unpaid, still inside its window. Needs the customer.
 *   `EXPIRED`    — online, unpaid, window closed. The order is cancelled.
 *   `PAID`       — money received, order proceeding.
 *   `REFUND_DUE` — money received, order cancelled. Somebody owes them a call.
 *   `REFUNDED`   — money returned.
 */
export type PaymentPresentation =
  'NOT_NEEDED' | 'AWAITING' | 'EXPIRED' | 'PAID' | 'REFUND_DUE' | 'REFUNDED';

export function paymentPresentation(order: {
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
}): PaymentPresentation {
  if (order.paymentMethod !== 'ONLINE') return 'NOT_NEEDED';
  if (order.paymentStatus === 'REFUNDED') return 'REFUNDED';

  /*
    Paid, and the order is not happening. The late-payment case, and a paid order
    a manager cancels by hand.

    Kept apart from `PAID` because the two need opposite sentences: "we have your
    money, the kitchen has your order" and "we have your money, nobody is cooking
    and we will call you". Collapsing them would tell somebody whose order was
    cancelled that their food was on its way.
  */
  if (order.paymentStatus === 'PAID') {
    return order.status === 'CANCELLED' ? 'REFUND_DUE' : 'PAID';
  }

  if (order.status === 'AWAITING_PAYMENT') return 'AWAITING';

  // Unpaid and no longer waiting: the window closed and the sweep cancelled it.
  // `FAILED` lands here too — a declined attempt on an order that has since been
  // cancelled is, to the customer, the same fact.
  return 'EXPIRED';
}

/**
 * The moves staff may make from here.
 *
 * Read straight off the domain's transition table rather than restated, so the
 * buttons on the screen and the rule the server enforces cannot drift apart.
 * The server checks again inside the transaction regardless — this only decides
 * what to draw.
 */
export function allowedTransitions(status: OrderStatus): readonly OrderStatus[] {
  return ORDER_STATUS_TRANSITIONS[status];
}
