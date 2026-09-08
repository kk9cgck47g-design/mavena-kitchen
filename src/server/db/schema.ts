import { relations, sql } from 'drizzle-orm';
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import {
  ADMIN_ROLES,
  CITY_CODES,
  DISCOUNT_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_KINDS,
  NOTIFICATION_STATUSES,
  OPTION_GROUP_TYPES,
  ORDER_STATUSES,
  ORDER_TYPES,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  type ProductBadge,
  type WeeklySchedule,
} from '@/lib/domain';
import type { Polygon } from '@/lib/geo';
import type { LocalizedText } from '@/lib/i18n/locales';

/**
 * Column names are generated in snake_case — `casing: 'snake_case'` is set both in
 * `drizzle.config.ts` and where the client is created. Do not create a Drizzle
 * client without it, or every query will look for camelCase columns that do not exist.
 *
 * Money is `integer` everywhere: whole Armenian drams. See `src/lib/money.ts`.
 */

// --- Enums ----------------------------------------------------------------

export const cityCodeEnum = pgEnum('city_code', CITY_CODES);
export const orderTypeEnum = pgEnum('order_type', ORDER_TYPES);
export const orderStatusEnum = pgEnum('order_status', ORDER_STATUSES);
export const paymentMethodEnum = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatusEnum = pgEnum('payment_status', PAYMENT_STATUSES);
export const optionGroupTypeEnum = pgEnum('option_group_type', OPTION_GROUP_TYPES);
export const discountTypeEnum = pgEnum('discount_type', DISCOUNT_TYPES);
export const adminRoleEnum = pgEnum('admin_role', ADMIN_ROLES);

// --- Settings (singleton) -------------------------------------------------

/**
 * A single row (`id = 1`) holding restaurant-wide configuration.
 *
 * `isAcceptingOrders` is the kill switch: one toggle in the admin panel stops the
 * checkout button site-wide when the kitchen is swamped or the power is out.
 * It is deliberately separate from `workingHours`, which is the regular schedule.
 */
export const settings = pgTable('settings', {
  id: integer().primaryKey().default(1),
  isAcceptingOrders: boolean().notNull().default(true),
  /** Shown to customers when ordering is off, e.g. "Too many orders, back in an hour". */
  pausedMessage: jsonb().$type<LocalizedText>(),
  workingHours: jsonb().$type<WeeklySchedule>().notNull(),
  /** Default kitchen time, used for the customer-facing ETA. */
  prepTimeMinutes: integer().notNull().default(30),
  /** How far ahead a customer may schedule an order, in days. `0` disables pre-orders. */
  preOrderDaysAhead: integer().notNull().default(2),
  phones: text().array().notNull().default([]),
  addressLine: jsonb().$type<LocalizedText>(),
  /** Restaurant's own location — used for the pickup pin and the contact map. */
  lat: doublePrecision(),
  lng: doublePrecision(),
  socials: jsonb().$type<Record<string, string>>().notNull().default({}),
  /** Telegram chats that receive new-order notifications. */
  telegramChatIds: text().array().notNull().default([]),
  updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
});

// --- Menu -----------------------------------------------------------------

export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    imageUrl: text(),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('categories_slug_key').on(table.slug),
    index('categories_sort_idx').on(table.sortOrder),
  ],
);

export const products = pgTable(
  'products',
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    slug: text().notNull(),
    name: jsonb().$type<LocalizedText>().notNull(),
    description: jsonb().$type<LocalizedText>(),
    /** Price before any options are applied. Whole drams. */
    basePrice: integer().notNull(),
    images: text().array().notNull().default([]),
    /** Permanently hidden — the dish is off the menu. */
    isActive: boolean().notNull().default(true),
    /** Temporarily out of stock (the daily "86" list). Kept separate from `isActive`
     *  so that flipping it back on is a one-tap operation for kitchen staff. */
    isAvailable: boolean().notNull().default(true),
    badges: jsonb().$type<ProductBadge[]>().notNull().default([]),
    allergens: text().array().notNull().default([]),
    weightGrams: integer(),
    calories: integer(),
    sortOrder: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('products_slug_key').on(table.slug),
    index('products_category_idx').on(table.categoryId, table.sortOrder),
  ],
);

/**
 * A set of choices attached to a dish — "Size", "Add-ons", "Sauce".
 *
 * `SINGLE` renders as radio buttons, `MULTI` as checkboxes. `minSelect`/`maxSelect`
 * are validated server-side when an order is placed, not just in the UI.
 */
export const optionGroups = pgTable(
  'option_groups',
  {
    id: uuid().primaryKey().defaultRandom(),
    productId: uuid()
      .notNull()
      .references(() => products.id, { onDelete: 'cascade' }),
    name: jsonb().$type<LocalizedText>().notNull(),
    type: optionGroupTypeEnum().notNull(),
    minSelect: smallint().notNull().default(0),
    maxSelect: smallint().notNull().default(1),
    sortOrder: integer().notNull().default(0),
    isActive: boolean().notNull().default(true),
  },
  (table) => [index('option_groups_product_idx').on(table.productId, table.sortOrder)],
);

export const options = pgTable(
  'options',
  {
    id: uuid().primaryKey().defaultRandom(),
    groupId: uuid()
      .notNull()
      .references(() => optionGroups.id, { onDelete: 'cascade' }),
    name: jsonb().$type<LocalizedText>().notNull(),
    /** Added to the dish price. May be `0` (e.g. choosing a sauce at no charge). */
    priceDelta: integer().notNull().default(0),
    isDefault: boolean().notNull().default(false),
    isActive: boolean().notNull().default(true),
    sortOrder: integer().notNull().default(0),
  },
  (table) => [index('options_group_idx').on(table.groupId, table.sortOrder)],
);

// --- Delivery -------------------------------------------------------------

export const cities = pgTable('cities', {
  code: cityCodeEnum().primaryKey(),
  name: jsonb().$type<LocalizedText>().notNull(),
  /** Where the map opens when this city is selected. */
  centerLat: doublePrecision().notNull(),
  centerLng: doublePrecision().notNull(),
  defaultZoom: smallint().notNull().default(14),
  isActive: boolean().notNull().default(true),
  sortOrder: integer().notNull().default(0),
});

/**
 * Delivery rules per area. Each city owns its own zones, so their fees,
 * minimum order and ETA are fully independent — which is the whole point.
 *
 * `polygon` is the served area. An address whose pin falls outside every active
 * zone of the selected city cannot be ordered to; the customer is told so
 * explicitly rather than discovering it after paying.
 */
export const deliveryZones = pgTable(
  'delivery_zones',
  {
    id: uuid().primaryKey().defaultRandom(),
    cityCode: cityCodeEnum()
      .notNull()
      .references(() => cities.code, { onDelete: 'restrict' }),
    name: jsonb().$type<LocalizedText>().notNull(),
    polygon: jsonb().$type<Polygon>().notNull(),
    fee: integer().notNull().default(0),
    minOrder: integer().notNull().default(0),
    /** Order subtotal from which delivery becomes free. `null` = never free. */
    freeDeliveryFrom: integer(),
    etaMinutes: integer().notNull().default(45),
    isActive: boolean().notNull().default(true),
    /** Lower values win when zones overlap, letting a cheap inner zone sit inside a wider one. */
    priority: integer().notNull().default(0),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('delivery_zones_city_idx').on(table.cityCode, table.priority)],
);

// --- Orders ---------------------------------------------------------------

export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    /** Short, human-speakable code for the phone: `MK-4821`. Not a secret. */
    publicCode: text().notNull(),
    /** Unguessable token; the only thing that appears in the tracking URL.
     *  The order page exposes name, phone and address, so it must not be enumerable. */
    trackingToken: text().notNull(),

    type: orderTypeEnum().notNull(),
    status: orderStatusEnum().notNull().default('NEW'),

    customerName: text().notNull(),
    phone: text().notNull(),

    /** Delivery details. Null for pickup. */
    cityCode: cityCodeEnum().references(() => cities.code, { onDelete: 'set null' }),
    address: text(),
    /** Optional free-text hint: "opposite the pharmacy", "green gate". */
    landmark: text(),
    lat: doublePrecision(),
    lng: doublePrecision(),
    zoneId: uuid().references(() => deliveryZones.id, { onDelete: 'set null' }),

    notes: text(),
    /** Set when the customer asks for a specific time instead of "as soon as possible". */
    scheduledFor: timestamp({ withTimezone: true }),

    /**
     * The waiting time the customer was quoted, frozen like the prices.
     *
     * It could be derived from `zoneId` on every read, but that would mean
     * re-drawing a zone tomorrow silently rewrites what yesterday's customer was
     * promised — and the tracking page would then contradict the confirmation
     * they are looking at. Delivery orders take it from their zone, pickup
     * orders from `settings.prepTimeMinutes`.
     */
    etaMinutes: integer().notNull(),

    paymentMethod: paymentMethodEnum().notNull(),
    paymentStatus: paymentStatusEnum().notNull().default('PENDING'),

    /**
     * When an unpaid online order stops being held, and `null` for every other
     * payment method — cash and card-on-delivery are settled by the courier, so
     * there is nothing to time out.
     *
     * A column rather than `createdAt + 30 minutes` computed at read time,
     * because the sweep that cancels these has to be able to ask the database
     * for them: `status = 'AWAITING_PAYMENT' and payment_expires_at < now()` is
     * an index lookup, whereas the arithmetic version is a scan of every order
     * ever placed. It also means the deadline the customer sees counting down is
     * the same value the sweep enforces, rather than two derivations that agree
     * until one of them changes.
     */
    paymentExpiresAt: timestamp({ withTimezone: true }),

    /** All amounts recomputed server-side at creation; client values are never trusted. */
    subtotal: integer().notNull(),
    deliveryFee: integer().notNull().default(0),
    discount: integer().notNull().default(0),
    total: integer().notNull(),

    promoCodeId: uuid(),

    /** Client-generated per checkout attempt. The unique index turns a double-tap
     *  into one order instead of two. */
    idempotencyKey: text().notNull(),

    cancelReason: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('orders_public_code_key').on(table.publicCode),
    uniqueIndex('orders_tracking_token_key').on(table.trackingToken),
    uniqueIndex('orders_idempotency_key').on(table.idempotencyKey),
    index('orders_status_created_idx').on(table.status, table.createdAt),
    /*
      The sweep's only query: which unpaid orders are past their deadline.

      Composite rather than a partial index on `status = 'AWAITING_PAYMENT'`,
      which is what this wants to be and cannot be. Postgres refuses to use a new
      enum value in the transaction that added it, and drizzle-kit applies every
      pending migration in one transaction — so a deployment that introduces the
      status and an index mentioning it fails as a whole and leaves the schema
      untouched, on a fresh database and nowhere else. Leading with `status`
      makes this serve the same lookup anyway.

      The same trap waits for any future status: name it in DDL in the migration
      that adds it and the deploy breaks.
    */
    index('orders_awaiting_payment_idx').on(table.status, table.paymentExpiresAt),
    index('orders_created_idx').on(table.createdAt),
    index('orders_phone_idx').on(table.phone),
  ],
);

/**
 * A frozen copy of what was ordered.
 *
 * Names, prices and chosen options are snapshots, not joins. When the owner
 * raises a price tomorrow, yesterday's orders and yesterday's revenue must not
 * change. `productId` survives only as a reporting reference and is nulled if
 * the dish is ever deleted.
 */
export const orderItems = pgTable(
  'order_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    productId: uuid().references(() => products.id, { onDelete: 'set null' }),
    nameSnapshot: jsonb().$type<LocalizedText>().notNull(),
    imageSnapshot: text(),
    /** Base price plus the selected option deltas, per unit. */
    unitPrice: integer().notNull(),
    quantity: integer().notNull(),
    lineTotal: integer().notNull(),
    optionsSnapshot: jsonb()
      .$type<Array<{ groupName: LocalizedText; name: LocalizedText; priceDelta: number }>>()
      .notNull()
      .default([]),
    sortOrder: integer().notNull().default(0),
  },
  (table) => [index('order_items_order_idx').on(table.orderId, table.sortOrder)],
);

/** Append-only audit trail: who moved the order where, and when. */
export const orderEvents = pgTable(
  'order_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    fromStatus: orderStatusEnum(),
    toStatus: orderStatusEnum().notNull(),
    byUserId: uuid().references(() => adminUsers.id, { onDelete: 'set null' }),
    /** Set when the change came from the Telegram bot rather than the dashboard. */
    source: text().notNull().default('ADMIN'),
    note: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('order_events_order_idx').on(table.orderId, table.createdAt)],
);

// --- Outbound notifications ----------------------------------------------

export const notificationChannelEnum = pgEnum('notification_channel', NOTIFICATION_CHANNELS);
export const notificationKindEnum = pgEnum('notification_kind', NOTIFICATION_KINDS);
export const notificationStatusEnum = pgEnum('notification_status', NOTIFICATION_STATUSES);

/**
 * A transactional outbox: things the outside world should be told about.
 *
 * The row is written in the same transaction as the order it belongs to, so it
 * exists if and only if the order does. The sending happens afterwards and
 * outside — a kitchen that cannot be reached must never be a reason to refuse a
 * customer's order, and an HTTP call inside a transaction holds a database
 * connection open for as long as somebody else's server feels like taking.
 *
 * That split is what makes redelivery possible without any of it being in the
 * request path: a message that was never sent is a `PENDING` row, and anything
 * that can read this table can try again — the admin panel's retry button
 * today, a scheduled sweep later. `createOrder` does not have to learn about
 * either.
 *
 * `deliveries` records which chats already received it, keyed by chat id. A
 * retry therefore sends only to the ones still missing it, instead of shouting
 * twice at the screen that got the message the first time.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    channel: notificationChannelEnum().notNull(),
    kind: notificationKindEnum().notNull(),
    status: notificationStatusEnum().notNull().default('PENDING'),
    attempts: integer().notNull().default(0),
    /** `{ [chatId]: telegramMessageId }` for the chats that have it. */
    deliveries: jsonb().$type<Record<string, number>>().notNull().default({}),
    /** Last failure, for the panel to show and for a human to read. */
    lastError: text(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('notifications_pending_idx').on(table.status, table.createdAt),
    index('notifications_order_idx').on(table.orderId),
    // One notification of a given kind per order per channel. A double-tapped
    // checkout that races past the idempotency check must not enqueue twice.
    uniqueIndex('notifications_order_kind_key').on(table.orderId, table.channel, table.kind),
  ],
);

// --- Promo codes (schema ready, UI comes later) ---------------------------

export const promoCodes = pgTable(
  'promo_codes',
  {
    id: uuid().primaryKey().defaultRandom(),
    code: text().notNull(),
    discountType: discountTypeEnum().notNull(),
    /** Percent (0-100) or a fixed amount in drams, depending on `discountType`. */
    discountValue: integer().notNull(),
    minOrder: integer().notNull().default(0),
    /** Ceiling for percent discounts, so "50% off" cannot cost more than intended. */
    maxDiscount: integer(),
    usageLimit: integer(),
    usageCount: integer().notNull().default(0),
    perPhoneLimit: integer(),
    startsAt: timestamp({ withTimezone: true }),
    endsAt: timestamp({ withTimezone: true }),
    isActive: boolean().notNull().default(true),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('promo_codes_code_key').on(table.code)],
);

// --- Payments -------------------------------------------------------------

/**
 * One row per attempt at paying for an order, not one per order.
 *
 * A customer whose card is declined tries again, and both attempts are worth
 * keeping: the first is why the second exists, and a provider that later reports
 * an outcome for either of them has to be matched to the right one. `orders`
 * carries the summary (`paymentStatus`); this carries the history.
 *
 * No card data of any kind reaches this table, and none reaches this server.
 * The customer types their card on the provider's own page; what comes back is
 * an identifier and an outcome. `raw` is the provider's payload kept verbatim
 * for the day somebody disputes a charge — which is exactly why nothing may be
 * put in it that we would not want to still have in a year.
 */
export const payments = pgTable(
  'payments',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'cascade' }),
    /** Which adapter owns this row: `stub` today, an acquirer's name later. */
    provider: text().notNull(),
    /**
     * The provider's identifier for the attempt. Null only in the instant
     * between our insert and their answer.
     */
    externalId: text(),
    /**
     * What we asked to be charged, in whole drams, frozen at the moment the
     * attempt was created.
     *
     * Compared against the amount the provider reports before anything is
     * marked paid. The order's total is not used for that comparison directly:
     * the question is whether the money that arrived matches the money this
     * attempt asked for.
     */
    amount: integer().notNull(),
    status: paymentStatusEnum().notNull().default('PENDING'),
    /** Where the customer was sent. Kept so a resumed attempt needs no new session. */
    redirectUrl: text(),
    /** When this attempt stops being usable and may be replaced by another. */
    expiresAt: timestamp({ withTimezone: true }),
    /** When we recorded the money as arrived. Null until then. */
    confirmedAt: timestamp({ withTimezone: true }),
    /** Why it failed, in whatever words the provider used. For staff, not customers. */
    failureReason: text(),
    /**
     * Money we hold that we should not.
     *
     * Set when a payment is confirmed for an order we have already cancelled, or
     * when the amount that arrived is not the amount we asked for. Neither is
     * something software should resolve on its own — one is a refund, the other
     * is a phone call — so this is a flag for a person, surfaced in the panel.
     */
    needsRefund: boolean().notNull().default(false),
    /** Raw provider payload, kept verbatim for dispute resolution. */
    raw: jsonb(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('payments_order_idx').on(table.orderId, table.createdAt),
    /*
      Unique, not merely indexed. This is the backstop under every idempotency
      check in `confirmPayment`: two returns landing at once, a return racing the
      sweep, a provider delivering the same callback twice — all of them resolve
      to the same row, and any attempt to create a second row for one provider
      reference fails in the database rather than in whichever code path
      remembered to look.
    */
    uniqueIndex('payments_external_key')
      .on(table.provider, table.externalId)
      .where(sql`external_id is not null`),
    /*
      At most one paid attempt per order, and at most one live one.

      The application already refuses to charge twice; these make it impossible
      rather than merely intended. The `PAID` half is the one that matters most —
      it is the difference between "we believe our locking is correct" and "the
      database will not store a second capture even if it is not".
    */
    uniqueIndex('payments_one_paid_per_order')
      .on(table.orderId)
      .where(sql`status = 'PAID'`),
    uniqueIndex('payments_one_pending_per_order')
      .on(table.orderId)
      .where(sql`status = 'PENDING'`),
  ],
);

/**
 * The stub provider's own records — a stand-in for a bank's database.
 *
 * This is not part of the payment core and nothing outside
 * `server/payments/stub.ts` may read it. It exists because a stub that forgets
 * its decisions is a stub the interesting cases cannot be tested against: "the
 * customer paid and then closed the tab" is only reproducible if the decision
 * outlives the request that made it, and the whole point of the reconciliation
 * sweep is to recover exactly that.
 *
 * Keeping it in its own table rather than in `payments.raw` is the boundary made
 * visible: our side of the flow reads a provider's answer, never a provider's
 * storage. Everything here is what a gateway would hold and nothing more — no
 * order id, no customer, and (as with a real gateway that never shows us a card)
 * no card data, because the fake page has no field to type one into.
 *
 * Drop it the day a real adapter replaces the stub.
 */
export const stubPayments = pgTable('stub_payments', {
  /** The provider reference. Ours to invent here, opaque everywhere else. */
  externalId: text().primaryKey(),
  /** What the merchant asked to be charged, in whole drams. */
  amount: integer().notNull(),
  /** `PENDING` until somebody presses a button on the fake page: then `PAID` or `FAILED`. */
  state: text().notNull().default('PENDING'),
  /** A human-readable label for the fake page — the order's public code. */
  label: text(),
  /** Where the merchant wants the customer sent back to. */
  returnUrl: text().notNull(),
  createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  decidedAt: timestamp({ withTimezone: true }),
});

// --- Staff ----------------------------------------------------------------

/** There is no public sign-up. Accounts are created by the owner only. */
export const adminUsers = pgTable(
  'admin_users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    passwordHash: text().notNull(),
    name: text().notNull(),
    role: adminRoleEnum().notNull().default('MANAGER'),
    isActive: boolean().notNull().default(true),
    lastLoginAt: timestamp({ withTimezone: true }),
    /**
     * Sessions issued before this moment are refused.
     *
     * The whole of session revocation, in one column. The tokens are signed and
     * stateless, so there is no row to delete to invalidate one — but every
     * request already reads this user's row to check they still exist and are
     * still active, so comparing the token's issue time against this costs
     * nothing extra and turns "log out everywhere" into a single write.
     *
     * Moved on three occasions, and each is a case where a token must stop
     * working immediately rather than in eight hours: the owner presses "sign
     * out everywhere", somebody's password is changed, or an account is
     * deactivated.
     *
     * What it deliberately does not do is name individual devices. Revocation
     * here is all-or-nothing per person, which for a handful of staff is the
     * right trade for a column against a table.
     */
    sessionsValidFrom: timestamp({ withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex('admin_users_email_key').on(table.email)],
);

/**
 * How often something has been done lately, and by whom.
 *
 * A fixed-window counter per key: one row, one upsert, one round trip. Not
 * Redis, and that is a scoping decision — an external store would mean another
 * service to keep alive and another secret to hold, for a restaurant in two
 * towns whose busiest minute is comfortably inside what a Postgres upsert can
 * take.
 *
 * Rows are keyed rather than appended, so the table's size is bounded by the
 * number of distinct actors ever seen, not by the number of requests. Pruning is
 * therefore housekeeping rather than a requirement.
 *
 * The known weakness of a fixed window is the boundary: an actor can spend a
 * full allowance at the end of one window and another at the start of the next.
 * Accepted deliberately — the alternative costs a row per event, and every limit
 * here is set for "stop the obviously abusive" rather than "meter precisely".
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    /** `scope:identifier`, e.g. `login:email:owner@example.com`. */
    key: text().primaryKey(),
    /** Start of the window this count belongs to. A different value resets the count. */
    windowStart: timestamp({ withTimezone: true }).notNull(),
    count: integer().notNull().default(0),
    updatedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index('rate_limits_updated_idx').on(table.updatedAt)],
);

// --- Relations ------------------------------------------------------------

export const categoriesRelations = relations(categories, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  optionGroups: many(optionGroups),
}));

export const optionGroupsRelations = relations(optionGroups, ({ one, many }) => ({
  product: one(products, {
    fields: [optionGroups.productId],
    references: [products.id],
  }),
  options: many(options),
}));

export const optionsRelations = relations(options, ({ one }) => ({
  group: one(optionGroups, {
    fields: [options.groupId],
    references: [optionGroups.id],
  }),
}));

export const citiesRelations = relations(cities, ({ many }) => ({
  zones: many(deliveryZones),
}));

export const deliveryZonesRelations = relations(deliveryZones, ({ one }) => ({
  city: one(cities, {
    fields: [deliveryZones.cityCode],
    references: [cities.code],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  items: many(orderItems),
  events: many(orderEvents),
  payments: many(payments),
  zone: one(deliveryZones, {
    fields: [orders.zoneId],
    references: [deliveryZones.id],
  }),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));

export const orderEventsRelations = relations(orderEvents, ({ one }) => ({
  order: one(orders, {
    fields: [orderEvents.orderId],
    references: [orders.id],
  }),
  user: one(adminUsers, {
    fields: [orderEvents.byUserId],
    references: [adminUsers.id],
  }),
}));

export const paymentsRelations = relations(payments, ({ one }) => ({
  order: one(orders, {
    fields: [payments.orderId],
    references: [orders.id],
  }),
}));

// --- Inferred types -------------------------------------------------------

export type Category = typeof categories.$inferSelect;
export type Product = typeof products.$inferSelect;
export type OptionGroup = typeof optionGroups.$inferSelect;
export type Option = typeof options.$inferSelect;
export type City = typeof cities.$inferSelect;
export type DeliveryZone = typeof deliveryZones.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type OrderItem = typeof orderItems.$inferSelect;
export type OrderEvent = typeof orderEvents.$inferSelect;
export type PromoCode = typeof promoCodes.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type StubPayment = typeof stubPayments.$inferSelect;
export type RateLimit = typeof rateLimits.$inferSelect;
export type AdminUser = typeof adminUsers.$inferSelect;
export type Settings = typeof settings.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
