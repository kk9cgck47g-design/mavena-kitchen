import { z } from 'zod';

/**
 * Domain vocabulary shared by the database schema, the server services and the UI.
 *
 * These live outside `src/server` on purpose: client components need the same
 * literals (to label a status badge, to render a payment option), and importing
 * the Drizzle schema into a client bundle would drag the driver along with it.
 */

// --- Cities ---------------------------------------------------------------

/**
 * Cities the demo delivers to. One, for now.
 *
 * It stays a tuple rather than collapsing to a single literal because every
 * consumer — the Postgres enum, the checkout's city picker, the zone map's
 * toggle — is written against a list. Adding a second city is then a data
 * change rather than a structural one, which is the point of keeping the
 * vocabulary in one place.
 */
export const CITY_CODES = ['YEREVAN'] as const;
export type CityCode = (typeof CITY_CODES)[number];

/** Whether a value read from storage or a URL is still a city we serve. */
export function isCityCode(value: unknown): value is CityCode {
  return typeof value === 'string' && (CITY_CODES as readonly string[]).includes(value);
}

// --- Orders ---------------------------------------------------------------

export const ORDER_TYPES = ['DELIVERY', 'PICKUP'] as const;
export type OrderType = (typeof ORDER_TYPES)[number];

/**
 * `AWAITING_PAYMENT` comes first because it happens first, and because of what
 * it protects: `NEW` means "the kitchen has this and it will be paid for". An
 * order that has been placed but not yet paid online is not that, and giving it
 * `NEW` would put unpaid food on the kitchen screen — with nothing left to
 * distinguish it from the paid orders around it.
 *
 * Only online orders ever enter it. Cash and card-on-delivery are paid on
 * arrival, so for them the promise is the courier's, not the gateway's, and they
 * start at `NEW` exactly as before.
 */
export const ORDER_STATUSES = [
  'AWAITING_PAYMENT',
  'NEW',
  'CONFIRMED',
  'PREPARING',
  'READY',
  'DELIVERING',
  'COMPLETED',
  'CANCELLED',
] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Statuses after which an order no longer moves. */
export const TERMINAL_ORDER_STATUSES: readonly OrderStatus[] = ['COMPLETED', 'CANCELLED'];

/**
 * Allowed status transitions, enforced on the server.
 *
 * The UI hides impossible buttons, but the UI is not a security boundary: a
 * stale admin tab or a double-tap must not be able to move a delivered order
 * back into the kitchen.
 *
 * Pickup orders skip DELIVERING, which is why READY leads to both.
 *
 * `AWAITING_PAYMENT` has exactly two ways out and no way back in. It leads to
 * `NEW` when a payment is confirmed and to `CANCELLED` when the payment window
 * closes; nothing may return an order to it, because a paid order that could be
 * pushed back into "awaiting payment" is an invitation to charge twice.
 */
export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  AWAITING_PAYMENT: ['NEW', 'CANCELLED'],
  NEW: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['DELIVERING', 'COMPLETED', 'CANCELLED'],
  DELIVERING: ['COMPLETED', 'CANCELLED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ORDER_STATUS_TRANSITIONS[from].includes(to);
}

/**
 * Statuses the kitchen is responsible for.
 *
 * An order awaiting payment is not one of them, and neither is a cancelled one.
 * Used by the panel's counters so that "requires attention" never means "watch
 * for money that may never arrive".
 */
export function isKitchenVisible(status: OrderStatus): boolean {
  return status !== 'AWAITING_PAYMENT';
}

// --- Payments -------------------------------------------------------------

export const PAYMENT_METHODS = ['CASH', 'CARD_ON_DELIVERY', 'ONLINE'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

/**
 * Where the money stands — for one attempt at paying, and for the order as a
 * whole.
 *
 * `EXPIRED` is the one that earns its keep. Without it there is no way to say
 * "we stopped waiting" as distinct from "the bank said no", and those two must
 * not be confused: a declined card is final, whereas an attempt we gave up on
 * can still be settled by the provider minutes later. That case — money for an
 * order we have already cancelled — is only handleable if the abandoned attempt
 * is still recognisable as abandoned rather than filed as a failure.
 */
export const PAYMENT_STATUSES = ['PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

/** Money has arrived. The only status that may put an order in front of the kitchen. */
export function isPaid(status: PaymentStatus): boolean {
  return status === 'PAID';
}

/**
 * Nothing more will happen to this attempt on its own.
 *
 * `PENDING` is excluded because it is precisely the state worth asking the
 * provider about again; the rest are answers.
 */
export function isSettled(status: PaymentStatus): boolean {
  return status !== 'PENDING';
}

/**
 * How long an online order waits for its money before it is cancelled.
 *
 * Long enough to find a card, re-enter a code and survive one failed attempt;
 * short enough that a kitchen is not holding stock for an order nobody is going
 * to pay for. A constant rather than a setting: an owner has no way to judge it,
 * and a wrong value here either cancels paying customers or fills the panel with
 * ghosts.
 */
export const PAYMENT_WINDOW_MINUTES = 30;

/**
 * How long a single attempt at the provider stays usable.
 *
 * Shorter than the order's window, so that a customer whose first attempt
 * stalled still has time inside the same order to start a second one. See
 * `startPayment` in `server/services/payments.ts` for what "usable" buys: a live
 * attempt is resumed rather than replaced, because replacing one the customer
 * may be in the middle of paying is how money arrives against a session nobody
 * is waiting on.
 */
export const PAYMENT_ATTEMPT_MINUTES = 15;

/**
 * How long after giving up we keep asking whether the money turned up anyway.
 *
 * Expiring an attempt is our decision, not the provider's, so a settlement can
 * still land after it — and if nothing ever asks again, that money is kept
 * silently and discovered only when the customer telephones. So the sweep keeps
 * expired attempts in its sights for a while.
 *
 * Bounded, because "forever" would mean every abandoned checkout the restaurant
 * ever had costing a round trip on every sweep, for years. A day is far longer
 * than any card network takes to settle and short enough that the queue stays
 * small.
 */
export const LATE_PAYMENT_GRACE_HOURS = 24;

// --- Menu -----------------------------------------------------------------

export const OPTION_GROUP_TYPES = ['SINGLE', 'MULTI'] as const;
export type OptionGroupType = (typeof OPTION_GROUP_TYPES)[number];

export const PRODUCT_BADGES = ['NEW', 'HIT', 'SPICY', 'VEGETARIAN'] as const;
export type ProductBadge = (typeof PRODUCT_BADGES)[number];

// --- Discounts ------------------------------------------------------------

export const DISCOUNT_TYPES = ['PERCENT', 'FIXED'] as const;
export type DiscountType = (typeof DISCOUNT_TYPES)[number];

// --- Staff ----------------------------------------------------------------

export const ADMIN_ROLES = ['OWNER', 'MANAGER'] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

/**
 * Who may do what.
 *
 * A rank rather than a list of permissions, because the split here is genuinely
 * hierarchical: a manager works the shift, and the owner does that plus the
 * things that change what the business charges, who it notifies and who can log
 * in. A permission matrix would be more general and would encode the same two
 * levels with more machinery.
 *
 *   MANAGER — orders, statuses, the stop list, checking whether a payment landed.
 *   OWNER   — all of that, plus prices, Telegram settings and staff accounts.
 *
 * The dividing line is "can this change money or access?". Taking a dish off the
 * stop list is a shift decision; changing its price is not. Re-sending a kitchen
 * ticket is a shift decision; changing which chat receives them is not.
 */
const ROLE_RANK: Record<AdminRole, number> = { OWNER: 2, MANAGER: 1 };

export function satisfiesRole(actual: AdminRole, required: AdminRole): boolean {
  return ROLE_RANK[actual] >= ROLE_RANK[required];
}

// --- Outbound notifications ----------------------------------------------

/** Ways of reaching the restaurant. Telegram is the only one wired up. */
export const NOTIFICATION_CHANNELS = ['TELEGRAM'] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const NOTIFICATION_KINDS = ['NEW_ORDER'] as const;
export type NotificationKind = (typeof NOTIFICATION_KINDS)[number];

/**
 * `PENDING` is the only state that means "somebody should try again". `FAILED`
 * is for a message that has been tried enough times that a human should look
 * at it rather than a machine retrying it forever.
 */
export const NOTIFICATION_STATUSES = ['PENDING', 'SENT', 'FAILED'] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** After this many attempts a message stops being retried automatically. */
export const NOTIFICATION_MAX_ATTEMPTS = 6;

// --- Working hours --------------------------------------------------------

/** `0` = Sunday, matching `Date.prototype.getDay()`. */
export const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM in 24-hour format');

export const dayScheduleSchema = z.object({
  isClosed: z.boolean(),
  /** Inclusive opening time, restaurant-local (Asia/Yerevan). */
  opensAt: timeOfDaySchema,
  /** Exclusive closing time. May be earlier than `opensAt`, meaning it crosses midnight. */
  closesAt: timeOfDaySchema,
});

export type DaySchedule = z.infer<typeof dayScheduleSchema>;

export const weeklyScheduleSchema = z.object({
  0: dayScheduleSchema,
  1: dayScheduleSchema,
  2: dayScheduleSchema,
  3: dayScheduleSchema,
  4: dayScheduleSchema,
  5: dayScheduleSchema,
  6: dayScheduleSchema,
});

export type WeeklySchedule = z.infer<typeof weeklyScheduleSchema>;

/** The restaurant operates on Yerevan time regardless of where the customer or server is. */
export const RESTAURANT_TIME_ZONE = 'Asia/Yerevan';

export function defaultDaySchedule(): DaySchedule {
  return { isClosed: false, opensAt: '10:00', closesAt: '23:00' };
}

export function defaultWeeklySchedule(): WeeklySchedule {
  return {
    0: defaultDaySchedule(),
    1: defaultDaySchedule(),
    2: defaultDaySchedule(),
    3: defaultDaySchedule(),
    4: defaultDaySchedule(),
    5: defaultDaySchedule(),
    6: defaultDaySchedule(),
  };
}
