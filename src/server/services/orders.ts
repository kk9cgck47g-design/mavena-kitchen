import { and, desc, eq } from 'drizzle-orm';

import { IS_DEMO } from '@/lib/demo';
import {
  canTransition,
  PAYMENT_WINDOW_MINUTES,
  type OrderStatus,
  type PaymentStatus,
} from '@/lib/domain';
import { type Amd } from '@/lib/money';
import type { OrderEventView, OrderView } from '@/lib/order-types';
import type { CheckoutInput } from '@/lib/schemas/checkout';
import { availablePaymentMethods } from '@/lib/schemas/checkout';
import { db, type Tx } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { orderEvents, orderItems, orders } from '@/server/db/schema';
import type { Order, OrderEvent, OrderItem } from '@/server/db/schema';
import { demoOrderByToken } from '@/server/demo/orders';
import { configuredProvider } from '@/server/payments/registry';
import { enqueueNotification } from '@/server/telegram/outbox';
import {
  buildCheckoutQuote,
  type CheckoutBlocker,
  type DeliveryBlocker,
} from './checkout-quote';
import { getPricingProducts } from './menu';
import { generatePublicCode, generateTrackingToken } from './order-codes';
import { getOrderingWindow } from './opening-hours';
import { type PricedLine, type PricingIssue } from './pricing';
import { getActiveDeliveryZones, getSettings } from './settings';

/**
 * Order creation — the one place where money becomes real.
 *
 * Everything the browser sent is treated as a request, not a fact. Prices,
 * delivery fees and the total are recomputed here from the database; the
 * opening hours, the kill switch and the delivery zone are all re-checked. A
 * client that lies gets a rejection, never a discount.
 */

export type CreateOrderError =
  | { code: 'DEMO_MODE' }
  | { code: 'ORDERING_CLOSED'; isOpen: boolean; isPaused: boolean }
  | { code: 'PAYMENT_METHOD_UNAVAILABLE' }
  | { code: 'SCHEDULE_INVALID' }
  | { code: 'CART_INVALID'; issues: PricingIssue[] }
  | { code: 'DELIVERY_UNAVAILABLE'; blocker: DeliveryBlocker }
  /** The recomputed total is not the one the customer agreed to. */
  | { code: 'TOTAL_CHANGED'; total: Amd; expected: Amd };

export interface CreatedOrder {
  id: string;
  publicCode: string;
  trackingToken: string;
  subtotal: Amd;
  deliveryFee: Amd;
  total: Amd;
  etaMinutes: number;
  /**
   * `AWAITING_PAYMENT` for an online order, `NEW` for everything else.
   *
   * Read off the stored row rather than derived by the caller, so the replay of
   * a double-tap reports where the order actually is — which for an online order
   * may by then already be `NEW`, because the payment went through between the
   * two taps.
   */
  status: OrderStatus;
}

export type CreateOrderResult =
  | { ok: true; order: CreatedOrder; alreadyExisted: boolean }
  | { ok: false; error: CreateOrderError };

const PUBLIC_CODE_ATTEMPTS = 5;

export async function createOrder(input: CheckoutInput): Promise<CreateOrderResult> {
  // Refused at the source, not merely hidden in the UI. The published preview
  // has no database and nobody watching a kitchen screen; an order placed
  // against it would be a promise to a real person that nothing can keep.
  if (IS_DEMO) return { ok: false, error: { code: 'DEMO_MODE' } };

  // A retry of a request that already succeeded must return the original order,
  // not a second one. Checked before any work so a double-tap is cheap.
  const existing = await findByIdempotencyKey(input.idempotencyKey);
  if (existing) {
    return { ok: true, alreadyExisted: true, order: toCreatedOrder(existing) };
  }

  const settings = await getSettings();

  const window = getOrderingWindow(settings.workingHours, settings.isAcceptingOrders);
  const scheduledFor = input.scheduledFor ? new Date(input.scheduledFor) : null;

  // A pre-order for tomorrow lunchtime is fine while the restaurant is closed
  // tonight; an immediate order is not.
  if (!window.canOrder && !scheduledFor) {
    return {
      ok: false,
      error: { code: 'ORDERING_CLOSED', isOpen: window.isOpen, isPaused: window.isPaused },
    };
  }

  if (window.isPaused) {
    return {
      ok: false,
      error: { code: 'ORDERING_CLOSED', isOpen: window.isOpen, isPaused: true },
    };
  }

  if (scheduledFor && !isWithinPreOrderWindow(scheduledFor, settings.preOrderDaysAhead)) {
    return { ok: false, error: { code: 'SCHEDULE_INVALID' } };
  }

  /*
    Asked of the deployment, not of the request. `ONLINE` is available only where
    an adapter is actually configured — a client that sends it anyway is refused
    here, which is also what keeps the method honest while no acquirer exists.
  */
  const methods = availablePaymentMethods(configuredProvider() !== null);
  if (!(methods as readonly string[]).includes(input.paymentMethod)) {
    return { ok: false, error: { code: 'PAYMENT_METHOD_UNAVAILABLE' } };
  }

  // Prices come from the database, never from the request — and never from the
  // quote the browser was last shown either. The menu and the zones are read
  // again here, so a dish that went on the stop list or a zone that was redrawn
  // while the customer was filling in their address is caught now rather than
  // honoured.
  const [productsById, zones] = await Promise.all([
    getPricingProducts(input.cart.map((line) => line.productId)),
    getActiveDeliveryZones(),
  ]);

  const { quote, lines } = buildCheckoutQuote({
    input: {
      type: input.type,
      cityCode: input.type === 'DELIVERY' ? input.cityCode : null,
      point: input.type === 'DELIVERY' ? { lat: input.lat, lng: input.lng } : null,
      cart: input.cart,
    },
    productsById,
    zones,
    prepTimeMinutes: settings.prepTimeMinutes,
  });

  if (quote.blocker) {
    return { ok: false, error: toCreateOrderError(quote.blocker) };
  }

  /*
    The customer pressed a button that named a number. Between the quote that
    produced it and this moment the kitchen may have raised a price or the owner
    may have redrawn a zone — both are checked above only for whether the order
    is *possible*, not for whether it still costs what was agreed.

    Refusing is the honest answer. Charging the recomputed total would be
    defensible arithmetic and an indefensible surprise, and quietly keeping the
    old one would mean selling at a price the restaurant has withdrawn. The new
    amount goes back with the refusal so the screen can show it and ask again.

    After the blocker check on purpose: an address that has fallen outside every
    zone should say so, not report a changed price as the reason.
  */
  if (input.expectedTotal !== undefined && input.expectedTotal !== quote.total) {
    return {
      ok: false,
      error: { code: 'TOTAL_CHANGED', total: quote.total, expected: input.expectedTotal },
    };
  }

  const inserted = await insertOrder({
    input,
    scheduledFor,
    zoneId: quote.zone?.id ?? null,
    subtotal: quote.subtotal,
    deliveryFee: quote.deliveryFee,
    discount: quote.discount,
    total: quote.total,
    etaMinutes: quote.etaMinutes,
    lines,
  });

  return {
    ok: true,
    alreadyExisted: inserted.raced,
    order: toCreatedOrder(inserted.order),
  };
}

/**
 * Translate a quote's refusal into the error the caller expects.
 *
 * The codes are kept distinct because the UI does different things with them: a
 * bad cart line points at a dish, an unreachable address points at the map.
 */
function toCreateOrderError(blocker: CheckoutBlocker): CreateOrderError {
  switch (blocker.code) {
    case 'CART_INVALID':
      return { code: 'CART_INVALID', issues: blocker.issues };
    // `checkoutSchema` requires at least one line, so a validated payload cannot
    // reach this. Mapped rather than thrown so that a future caller which skips
    // the schema gets a refusal instead of a 500.
    case 'EMPTY_CART':
      return { code: 'CART_INVALID', issues: [] };
    default:
      return { code: 'DELIVERY_UNAVAILABLE', blocker };
  }
}

async function insertOrder(args: {
  input: CheckoutInput;
  scheduledFor: Date | null;
  zoneId: string | null;
  subtotal: Amd;
  deliveryFee: Amd;
  discount: Amd;
  total: Amd;
  etaMinutes: number;
  lines: readonly PricedLine[];
}): Promise<{ order: Order; raced: boolean }> {
  const { input } = args;
  const isDelivery = input.type === 'DELIVERY';

  /*
    An online order is not an order the kitchen has yet.

    It starts at `AWAITING_PAYMENT` and, crucially, queues nothing: the outbox
    row that tells the kitchen is written when the payment is confirmed, in that
    transaction, by `confirmPayment`. The invariant the outbox has always had is
    unchanged — the notification exists if and only if there is something to
    notify about — but for an online order the thing worth notifying about is a
    paid order, not a placed one. Queue it here and the kitchen cooks food that
    nobody has paid for, with nothing on the ticket to say so.

    Cash and card-on-delivery are untouched. Their money arrives with the
    courier, so placing the order *is* the commitment, and the ticket goes out
    exactly as before.
  */
  const isOnline = input.paymentMethod === 'ONLINE';
  const initialStatus: OrderStatus = isOnline ? 'AWAITING_PAYMENT' : 'NEW';
  const paymentExpiresAt = isOnline
    ? new Date(Date.now() + PAYMENT_WINDOW_MINUTES * 60_000)
    : null;

  for (let attempt = 0; attempt < PUBLIC_CODE_ATTEMPTS; attempt += 1) {
    try {
      return await db.transaction(async (tx) => {
        const [order] = await tx
          .insert(orders)
          .values({
            publicCode: generatePublicCode(),
            trackingToken: generateTrackingToken(),
            type: input.type,
            status: initialStatus,
            customerName: input.customerName,
            phone: input.phone,
            cityCode: isDelivery ? input.cityCode : null,
            address: isDelivery ? input.address : null,
            landmark: isDelivery ? (input.landmark ?? null) : null,
            lat: isDelivery ? input.lat : null,
            lng: isDelivery ? input.lng : null,
            zoneId: args.zoneId,
            notes: input.notes ?? null,
            scheduledFor: args.scheduledFor,
            etaMinutes: args.etaMinutes,
            paymentMethod: input.paymentMethod,
            paymentStatus: 'PENDING',
            paymentExpiresAt,
            subtotal: args.subtotal,
            deliveryFee: args.deliveryFee,
            discount: args.discount,
            total: args.total,
            idempotencyKey: input.idempotencyKey,
          })
          .returning();

        await tx.insert(orderItems).values(
          args.lines.map((line, index) => ({
            orderId: order.id,
            productId: line.productId,
            nameSnapshot: line.nameSnapshot,
            imageSnapshot: line.imageSnapshot,
            unitPrice: line.unitPrice,
            quantity: line.quantity,
            lineTotal: line.lineTotal,
            optionsSnapshot: line.optionsSnapshot,
            sortOrder: index,
          })),
        );

        await tx.insert(orderEvents).values({
          orderId: order.id,
          fromStatus: null,
          toStatus: initialStatus,
          source: 'CUSTOMER',
        });

        /*
          Queued in the same transaction as the order, so the two commit
          together: an order that exists with nobody queued to be told about it
          is an order the kitchen never sees, and there is no later moment at
          which that could be noticed.

          This is a row, not a request. Telegram is not called here — an HTTP
          call inside a transaction holds a database connection open for as long
          as somebody else's server feels like taking, and a kitchen that cannot
          be reached must never be a reason to refuse an order. Delivery happens
          after the response, and anything left `PENDING` can be retried by
          whoever gets round to it. `createOrder` does not have to know how.

          Skipped for an online order, which has not been paid for yet. See the
          note above `isOnline`; the same call is made by `confirmPayment` inside
          the transaction that records the money, so the rule that the row
          commits with the thing it announces still holds.
        */
        if (!isOnline) {
          await enqueueNotification(tx, { orderId: order.id, kind: 'NEW_ORDER' });
        }

        return { order, raced: false };
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;

      // Two requests with the same idempotency key hit the gap between the
      // pre-check and the insert. The other one won; return its order.
      const raced = await findByIdempotencyKey(input.idempotencyKey);
      if (raced) return { order: raced, raced: true };

      // Otherwise it was a public-code collision — vanishingly rare, but retry.
    }
  }

  throw new Error('Could not allocate a unique public order code');
}


/**
 * Every field is read back off the stored row, the ETA included.
 *
 * It used to be passed in alongside, which meant the idempotent early return —
 * the one that answers a double-tap — had no quote to take it from and passed
 * zero. The second tap of a double-tap therefore told the customer their food
 * would arrive in 0 minutes.
 */
function toCreatedOrder(order: Order): CreatedOrder {
  return {
    id: order.id,
    publicCode: order.publicCode,
    trackingToken: order.trackingToken,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    total: order.total,
    etaMinutes: order.etaMinutes,
    status: order.status,
  };
}

/**
 * Pre-orders may be placed up to `daysAhead` days out, and never in the past.
 * A minute of slack absorbs clock skew between the customer's phone and the server.
 */
export function isWithinPreOrderWindow(
  scheduledFor: Date,
  daysAhead: number,
  now: Date = new Date(),
): boolean {
  if (daysAhead <= 0) return false;
  if (Number.isNaN(scheduledFor.getTime())) return false;

  const earliest = now.getTime() - 60_000;
  const latest = now.getTime() + daysAhead * 24 * 60 * 60 * 1000;

  return scheduledFor.getTime() >= earliest && scheduledFor.getTime() <= latest;
}

async function findByIdempotencyKey(key: string): Promise<Order | null> {
  const [row] = await db.select().from(orders).where(eq(orders.idempotencyKey, key)).limit(1);
  return row ?? null;
}

// --- Reads ----------------------------------------------------------------

export async function getOrderByTrackingToken(token: string) {
  // The preview creates no orders, so it has none to show — and no database to
  // look in. Answering "not found" is both true and the only thing that will
  // not throw.
  if (IS_DEMO) return null;

  const [order] = await db
    .select()
    .from(orders)
    .where(eq(orders.trackingToken, token))
    .limit(1);

  if (!order) return null;

  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(orderItems.sortOrder);

  return { order, items };
}

/**
 * An order shaped for a screen rather than for a query.
 *
 * The tracking page and the admin panel are client components; handing them
 * Drizzle rows would mean importing the schema — and with it the driver — into
 * their bundles. This is also where `Date` becomes an ISO string, once, instead
 * of at every call site that crosses the boundary.
 */
export async function getOrderView(token: string): Promise<OrderView | null> {
  // The preview has no database. Its orders are generated per request and its
  // tokens are prefixed, so the two can never be confused for one another.
  if (IS_DEMO) return demoOrderByToken(token);

  const found = await getOrderByTrackingToken(token);
  if (!found) return null;

  return toOrderView(found.order, found.items);
}

/**
 * Just enough to answer "has anything changed?".
 *
 * Polled by the tracking screen every few seconds, so it reads one row and
 * returns four fields — not the whole order with its items. The heavy part of
 * that page is static once the order exists; only the status moves.
 */
export async function getOrderStatusSnapshot(token: string): Promise<{
  status: OrderStatus;
  updatedAt: string;
  etaMinutes: number;
  cancelReason: string | null;
  /**
   * Carried alongside the status because for an online order the two move
   * together and the screen needs both to say anything true. `AWAITING_PAYMENT`
   * with `PENDING` is "we are waiting for you"; `CANCELLED` with `EXPIRED` is
   * "you ran out of time", which is a different sentence from `CANCELLED` with
   * `PENDING` — that one is the restaurant's decision, not the clock's.
   */
  paymentStatus: PaymentStatus;
} | null> {
  if (IS_DEMO) {
    const order = demoOrderByToken(token);
    return order
      ? {
          status: order.status,
          updatedAt: order.updatedAt,
          etaMinutes: order.etaMinutes,
          cancelReason: order.cancelReason,
          paymentStatus: order.paymentStatus,
        }
      : null;
  }

  const [row] = await db
    .select({
      status: orders.status,
      updatedAt: orders.updatedAt,
      etaMinutes: orders.etaMinutes,
      cancelReason: orders.cancelReason,
      paymentStatus: orders.paymentStatus,
    })
    .from(orders)
    .where(eq(orders.trackingToken, token))
    .limit(1);

  if (!row) return null;

  return {
    status: row.status,
    updatedAt: row.updatedAt.toISOString(),
    etaMinutes: row.etaMinutes,
    cancelReason: row.cancelReason,
    paymentStatus: row.paymentStatus,
  };
}

export function toOrderView(order: Order, items: OrderItem[]): OrderView {
  return {
    id: order.id,
    publicCode: order.publicCode,
    status: order.status,
    type: order.type,
    customerName: order.customerName,
    phone: order.phone,
    cityCode: order.cityCode,
    address: order.address,
    landmark: order.landmark,
    lat: order.lat,
    lng: order.lng,
    notes: order.notes,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    paymentExpiresAt: order.paymentExpiresAt?.toISOString() ?? null,
    subtotal: order.subtotal,
    deliveryFee: order.deliveryFee,
    discount: order.discount,
    total: order.total,
    etaMinutes: order.etaMinutes,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    cancelReason: order.cancelReason,
    items: items.map((item) => ({
      id: item.id,
      name: item.nameSnapshot,
      options: item.optionsSnapshot.map((option) => ({
        name: option.name,
        priceDelta: option.priceDelta,
      })),
      unitPrice: item.unitPrice,
      quantity: item.quantity,
      lineTotal: item.lineTotal,
      image: item.imageSnapshot,
    })),
  };
}

export function toOrderEventView(event: OrderEvent): OrderEventView {
  return {
    id: event.id,
    fromStatus: event.fromStatus,
    toStatus: event.toStatus,
    source: event.source,
    note: event.note,
    createdAt: event.createdAt.toISOString(),
  };
}

// --- Status changes -------------------------------------------------------

export type UpdateStatusResult =
  | { ok: true; order: Order }
  | { ok: false; code: 'NOT_FOUND' | 'ILLEGAL_TRANSITION'; from?: OrderStatus };

/**
 * Move an order along the state machine.
 *
 * The transition is validated inside the transaction against the row's current
 * status, not against whatever the admin's browser last rendered. Two managers
 * tapping different buttons at the same moment must not be able to move a
 * delivered order back into the kitchen.
 */
export async function updateOrderStatus(args: {
  orderId: string;
  to: OrderStatus;
  byUserId?: string | null;
  note?: string | null;
  source?: string;
}): Promise<UpdateStatusResult> {
  return db.transaction((tx) => applyStatusTransition(tx, args));
}

/**
 * The state machine itself, inside a transaction somebody else opened.
 *
 * Split out for one caller: confirming a payment has to move the order to `NEW`,
 * write the audit event and queue the kitchen ticket as a single atomic act. An
 * order that went `NEW` in one transaction and queued its notification in another
 * can end up paid, visible and never announced — and there is no later moment at
 * which anyone would notice.
 *
 * Restating the transition rules there instead would have been the alternative,
 * and it is exactly the kind of duplication that drifts: two implementations of
 * "may this order move?" agree until one of them is amended.
 *
 * The row is locked and re-read here rather than trusted from the caller, so the
 * check is against what the order is now, not what it was when the caller
 * decided to act.
 */
export async function applyStatusTransition(
  tx: Tx,
  args: {
    orderId: string;
    to: OrderStatus;
    byUserId?: string | null;
    note?: string | null;
    source?: string;
  },
): Promise<UpdateStatusResult> {
  const [current] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, args.orderId))
    .for('update')
    .limit(1);

  if (!current) return { ok: false, code: 'NOT_FOUND' } as const;

  if (!canTransition(current.status, args.to)) {
    return { ok: false, code: 'ILLEGAL_TRANSITION', from: current.status } as const;
  }

  const [updated] = await tx
    .update(orders)
    .set({
      status: args.to,
      updatedAt: new Date(),
      cancelReason: args.to === 'CANCELLED' ? (args.note ?? null) : current.cancelReason,
    })
    .where(and(eq(orders.id, args.orderId), eq(orders.status, current.status)))
    .returning();

  await tx.insert(orderEvents).values({
    orderId: args.orderId,
    fromStatus: current.status,
    toStatus: args.to,
    byUserId: args.byUserId ?? null,
    note: args.note ?? null,
    source: args.source ?? 'ADMIN',
  });

  return { ok: true, order: updated } as const;
}

export async function getOrderEvents(orderId: string) {
  return db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(desc(orderEvents.createdAt));
}
