import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CITY_CODES, defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { closeDb, db } from '@/server/db/client';
import { ZONES } from '@/server/db/delivery-data';
import { orders, products, settings } from '@/server/db/schema';
import { createOrder, getOrderByTrackingToken, updateOrderStatus } from '@/server/services/orders';

/**
 * End-to-end exercise of the order pipeline against the real database:
 * pricing → delivery quote → insert → snapshots → status machine.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

const CITY = CITY_CODES[0];

/**
 * The zone a pin in the middle of town resolves to, read from the same data the
 * database was seeded with rather than copied out of it as numbers. Edit a fee
 * or an ETA in `delivery-data.ts` and these tests follow it instead of failing.
 */
const CENTRAL = ZONES.find((zone) => zone.id === 'zone-yerevan-central')!;

const CENTRE = { lat: 40.1834, lng: 44.5119 };
const FAR_AWAY = { lat: 40.7894, lng: 43.8475 }; // Gyumri — outside every zone.

const createdOrderIds: string[] = [];

/** Beef Burger — the simplest real dish: no required option groups. */
const TEST_DISH_SLUG = 'burger-beef';

let dishId: string;
let dishPrice: number;

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DELIVERY' as const,
    customerName: 'Test Customer',
    phone: '+37493123456',
    cityCode: CITY,
    address: 'Shahumyan 12',
    lat: CENTRE.lat,
    lng: CENTRE.lng,
    paymentMethod: 'CASH' as const,
    idempotencyKey: randomUUID(),
    // Two, not one: the central zone has a minimum order, and a single burger
    // would trip it in every test that is not about minimums.
    cart: [{ productId: dishId, optionIds: [], quantity: 2 }],
    ...overrides,
  };
}

/**
 * Deliberately loose: several tests build a payload by spreading over one from
 * `checkout()` to add a field or reuse an idempotency key, and the point of
 * some of them is to hand `createOrder` something the form would never send.
 */
async function place(input: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await createOrder(input as any);
  if (result.ok) createdOrderIds.push(result.order.id);
  return result;
}

let originalHours: WeeklySchedule | null = null;

beforeAll(async () => {
  const [dish] = await db.select().from(products).where(eq(products.slug, TEST_DISH_SLUG)).limit(1);

  if (!dish) throw new Error('Seed data missing — run `pnpm db:seed` first.');

  dishId = dish.id;
  dishPrice = dish.basePrice;

  // `createOrder` checks the opening hours against the real clock, so with the
  // seeded 10:00–23:00 schedule this whole suite passed in the afternoon and
  // failed at night. Open the restaurant around the clock for the duration of
  // the run; the hours themselves are covered by the unit tests, which inject a
  // fixed instant.
  const [current] = await db.select().from(settings).limit(1);
  originalHours = current?.workingHours ?? null;

  const alwaysOpen = defaultWeeklySchedule();
  for (const day of Object.values(alwaysOpen)) {
    day.isClosed = false;
    day.opensAt = '00:00';
    day.closesAt = '23:59';
  }
  await db.update(settings).set({ workingHours: alwaysOpen, isAcceptingOrders: true });
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  if (originalHours) {
    await db.update(settings).set({ workingHours: originalHours });
  }
  await closeDb();
});

describe('createOrder', () => {
  it('prices a delivery order from the database and adds the zone fee', async () => {
    const result = await place(
      checkout({ cart: [{ productId: dishId, optionIds: [], quantity: 2 }] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.subtotal).toBe(dishPrice * 2);
    expect(result.order.deliveryFee).toBe(CENTRAL.fee);
    expect(result.order.total).toBe(dishPrice * 2 + CENTRAL.fee);
    expect(result.alreadyExisted).toBe(false);
  });

  it('drops the delivery fee once the free-delivery threshold is reached', async () => {
    // However many burgers it takes to clear the central zone's threshold.
    const quantity = Math.ceil(CENTRAL.freeDeliveryFrom! / dishPrice);
    const result = await place(
      checkout({ cart: [{ productId: dishId, optionIds: [], quantity }] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryFee).toBe(0);
    expect(result.order.total).toBe(dishPrice * quantity);
  });

  it('charges nothing for delivery on a pickup order', async () => {
    const result = await place(
      checkout({
        type: 'PICKUP',
        cityCode: undefined,
        address: undefined,
        lat: undefined,
        lng: undefined,
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.deliveryFee).toBe(0);
    expect(result.order.total).toBe(dishPrice * 2);
  });

  it('freezes the quoted ETA onto the order — the zone for delivery, prep time for pickup', async () => {
    const delivery = await place(checkout());
    expect(delivery.ok).toBe(true);
    if (!delivery.ok) return;
    expect(delivery.order.etaMinutes).toBe(CENTRAL.etaMinutes);

    const pickup = await place(
      checkout({
        type: 'PICKUP',
        cityCode: undefined,
        address: undefined,
        lat: undefined,
        lng: undefined,
      }),
    );
    expect(pickup.ok).toBe(true);
    if (!pickup.ok) return;
    expect(pickup.order.etaMinutes).toBe(25); // seeded settings.prepTimeMinutes

    // Stored, not merely returned: the tracking page reads it back off the row.
    const [row] = await db.select().from(orders).where(eq(orders.id, delivery.order.id));
    expect(row.etaMinutes).toBe(CENTRAL.etaMinutes);
  });

  it('refuses an address outside every delivery zone', async () => {
    const result = await place(checkout({ lat: FAR_AWAY.lat, lng: FAR_AWAY.lng }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DELIVERY_UNAVAILABLE');
  });

  it('refuses a cart referencing an unknown dish', async () => {
    const result = await place(
      checkout({ cart: [{ productId: randomUUID(), optionIds: [], quantity: 1 }] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CART_INVALID');
  });

  it('turns a double submission into a single order', async () => {
    const input = checkout();

    const first = await place(input);
    const second = await place(input);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.order.id).toBe(first.order.id);
    expect(second.alreadyExisted).toBe(true);

    // The repeat must answer with the same order, not a hollowed-out copy of it.
    // The ETA used to be passed in alongside the row rather than read off it, so
    // the second tap of a double-tap promised delivery in 0 minutes.
    expect(second.order).toEqual(first.order);
    expect(second.order.etaMinutes).toBe(CENTRAL.etaMinutes);

    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it('collapses two simultaneous submissions into one order', async () => {
    /*
      The race the pre-check cannot catch: both requests look for an existing
      order, neither finds one, and both insert. The unique index on the
      idempotency key decides it, and the loser is expected to recognise the
      violation and return the winner's order.

      That recovery was silently broken — Drizzle wraps the driver's error and
      hangs it off `cause`, so the SQLSTATE check never matched and the loser
      threw instead. Nothing caught it because a sequential double-tap never
      reaches this path.
    */
    const input = checkout();

    const [first, second] = await Promise.all([place(input), place(input)]);

    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;

    expect(second.order.id).toBe(first.order.id);
    expect([first.alreadyExisted, second.alreadyExisted]).toContain(true);

    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey));
    expect(rows).toHaveLength(1);
  });

  it('creates the order when the quoted total is the one it recomputes', async () => {
    const expected = dishPrice * 2 + CENTRAL.fee; // two burgers plus the central-zone fee

    const result = await place(checkout({ expectedTotal: expected }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.total).toBe(expected);
  });

  it('refuses rather than silently charging a total the customer never saw', async () => {
    // What a stale tab would send: a price from before the menu moved.
    const result = await place(checkout({ expectedTotal: 1 }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('TOTAL_CHANGED');
    if (result.error.code !== 'TOTAL_CHANGED') return;

    // The refusal carries the real amount, so the screen can show it and ask again.
    expect(result.error.total).toBe(dishPrice * 2 + CENTRAL.fee);
    expect(result.error.expected).toBe(1);
  });

  it('creates nothing when it refuses, so the same key may be retried', async () => {
    const input = checkout({ expectedTotal: 1 });

    const refused = await place(input);
    expect(refused.ok).toBe(false);

    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey));
    expect(rows).toHaveLength(0);

    // The customer accepts the real price; the same attempt goes through.
    const retried = await place({ ...input, expectedTotal: dishPrice * 2 + CENTRAL.fee });
    expect(retried.ok).toBe(true);
    if (!retried.ok) return;
    expect(retried.alreadyExisted).toBe(false);
  });

  it('accepts a payment method the deployment can actually take', async () => {
    /*
      The available methods are derived from the configured provider rather than
      listed, so what this asserts depends on the environment — and the suite runs
      with the stub provider (see `tests/setup-env.ts`), which makes `ONLINE` real.
      The other half of the rule, that it is refused where no provider exists, is
      a property of `availablePaymentMethods` and is covered in
      `tests/unit/payments.test.ts` without needing a deployment to be
      misconfigured.
    */
    const result = await place(checkout({ paymentMethod: 'ONLINE' }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.order.status).toBe('AWAITING_PAYMENT');
  });

  it('refuses a payment method it has never heard of', async () => {
    // The check is a whitelist, not a passthrough. `checkoutSchema` would reject
    // this too, but `createOrder` is called directly by other server code and
    // must not depend on having been validated first.
    const result = await place(checkout({ paymentMethod: 'CRYPTO' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PAYMENT_METHOD_UNAVAILABLE');
  });

  it('keeps the order note with the order', async () => {
    const result = await place(checkout({ notes: 'No onions, ring the bell twice' }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const [row] = await db.select().from(orders).where(eq(orders.id, result.order.id));
    expect(row.notes).toBe('No onions, ring the bell twice');
  });

  it('freezes dish name and price into the order items', async () => {
    const result = await place(checkout());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const found = await getOrderByTrackingToken(result.order.trackingToken);
    expect(found).not.toBeNull();
    expect(found!.items).toHaveLength(1);
    expect(found!.items[0].unitPrice).toBe(dishPrice);
    expect(found!.items[0].nameSnapshot.hy).toBeTruthy();
  });

  it('issues a guessable public code but an unguessable tracking token', async () => {
    const result = await place(checkout());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.order.publicCode).toMatch(/^MK-\d{6}$/);
    expect(result.order.trackingToken.length).toBeGreaterThanOrEqual(43);
  });
});

describe('updateOrderStatus', () => {
  it('follows the state machine and rejects illegal jumps', async () => {
    const result = await place(checkout());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const jump = await updateOrderStatus({ orderId: result.order.id, to: 'COMPLETED' });
    expect(jump.ok).toBe(false);
    if (!jump.ok) expect(jump.code).toBe('ILLEGAL_TRANSITION');

    const confirmed = await updateOrderStatus({ orderId: result.order.id, to: 'CONFIRMED' });
    expect(confirmed.ok).toBe(true);
    if (confirmed.ok) expect(confirmed.order.status).toBe('CONFIRMED');
  });

  it('records why an order was cancelled', async () => {
    const result = await place(checkout());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const cancelled = await updateOrderStatus({
      orderId: result.order.id,
      to: 'CANCELLED',
      note: 'Customer changed their mind',
    });

    expect(cancelled.ok).toBe(true);
    if (!cancelled.ok) return;
    expect(cancelled.order.cancelReason).toBe('Customer changed their mind');

    // A cancelled order is terminal.
    const revive = await updateOrderStatus({ orderId: result.order.id, to: 'PREPARING' });
    expect(revive.ok).toBe(false);
  });

  it('reports a missing order rather than throwing', async () => {
    const missing = await updateOrderStatus({ orderId: randomUUID(), to: 'CONFIRMED' });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.code).toBe('NOT_FOUND');
  });
});
