import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';

import { CITY_CODES, defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { closeDb, db } from '@/server/db/client';
import { notifications, orders, products, settings } from '@/server/db/schema';
import { getOrderingWindow } from '@/server/services/opening-hours';
import { createOrder, getOrderView, updateOrderStatus } from '@/server/services/orders';
import { quoteCheckout } from '@/server/services/checkout-quote';
import { getSettings, setAcceptingOrders } from '@/server/services/settings';

/**
 * The kill switch, and — just as importantly — what it must not switch off.
 *
 * An owner presses this because something has gone wrong in the kitchen, which
 * is the worst possible moment for it to also break the orders already in the
 * oven, the panel they are looking at, or the tracking page the customer with
 * food coming is refreshing. So half of this file is about the blast radius
 * rather than the effect.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

const CITY = CITY_CODES[0];

/** Central Yerevan — inside the seeded central delivery zone. */
const CENTRE = { lat: 40.1834, lng: 44.5119 };
const TEST_DISH_SLUG = 'burger-beef';

const createdOrderIds: string[] = [];
let dishId: string;
let originalHours: WeeklySchedule | null = null;

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DELIVERY' as const,
    customerName: 'Pause Test',
    // A fresh number per order: the order rate limit is keyed by phone, and a
    // suite that shares one would start refusing itself rather than testing
    // anything.
    phone: `+3749${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}`,
    cityCode: CITY,
    address: 'Shahumyan 12',
    lat: CENTRE.lat,
    lng: CENTRE.lng,
    paymentMethod: 'CASH' as const,
    idempotencyKey: randomUUID(),
    cart: [{ productId: dishId, optionIds: [], quantity: 2 }],
    ...overrides,
  };
}

async function place(overrides: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await createOrder(checkout(overrides) as any);
  if (result.ok) createdOrderIds.push(result.order.id);
  return result;
}

beforeAll(async () => {
  const [dish] = await db.select().from(products).where(eq(products.slug, TEST_DISH_SLUG)).limit(1);
  if (!dish) throw new Error('Seed data missing — run `pnpm db:seed` first.');
  dishId = dish.id;

  const [current] = await db.select().from(settings).limit(1);
  originalHours = current?.workingHours ?? null;

  const alwaysOpen = defaultWeeklySchedule();
  for (const day of Object.values(alwaysOpen)) {
    day.isClosed = false;
    day.opensAt = '00:00';
    day.closesAt = '23:59';
  }
  await db.update(settings).set({ workingHours: alwaysOpen });
});

afterEach(async () => {
  // Every test leaves the shop open, so one failing test cannot close the
  // restaurant for the rest of the suite.
  await setAcceptingOrders(true);
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  if (originalHours) {
    await db.update(settings).set({ workingHours: originalHours });
  }
  await setAcceptingOrders(true);
  await closeDb();
});

describe('pausing', () => {
  it('is written and read back', async () => {
    await setAcceptingOrders(false);
    expect((await getSettings()).isAcceptingOrders).toBe(false);

    await setAcceptingOrders(true);
    expect((await getSettings()).isAcceptingOrders).toBe(true);
  });

  it('closes ordering even inside opening hours', async () => {
    // The distinction the window has always drawn: `isOpen` is the schedule,
    // `isPaused` is a decision, and `canOrder` needs both.
    const alwaysOpen = defaultWeeklySchedule();
    for (const day of Object.values(alwaysOpen)) {
      day.isClosed = false;
      day.opensAt = '00:00';
      day.closesAt = '23:59';
    }

    const open = getOrderingWindow(alwaysOpen, true);
    expect(open).toEqual({ isOpen: true, isPaused: false, canOrder: true });

    const paused = getOrderingWindow(alwaysOpen, false);
    expect(paused.isOpen).toBe(true);
    expect(paused.isPaused).toBe(true);
    expect(paused.canOrder).toBe(false);
  });

  it('refuses a new order at the source', async () => {
    await setAcceptingOrders(false);

    const result = await place();

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ORDERING_CLOSED');
    if (result.error.code !== 'ORDERING_CLOSED') return;

    // `isPaused` rather than `isOpen: false`, so the screen can say "we have
    // stopped taking orders" instead of "we are closed" while the lights are on.
    expect(result.error.isPaused).toBe(true);
    expect(result.error.isOpen).toBe(true);
  });

  it('refuses a pre-order too', async () => {
    /*
      A scheduled order is normally allowed while the restaurant is shut — that is
      the whole point of pre-ordering. A pause is different: it means the kitchen
      cannot commit to anything, including tomorrow lunchtime.
    */
    await setAcceptingOrders(false);

    const tomorrow = new Date(Date.now() + 20 * 60 * 60 * 1000).toISOString();
    const result = await place({ scheduledFor: tomorrow });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('ORDERING_CLOSED');
  });

  it('creates no order and no kitchen ticket', async () => {
    await setAcceptingOrders(false);

    const input = checkout();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await createOrder(input as any);

    const rows = await db
      .select()
      .from(orders)
      .where(eq(orders.idempotencyKey, input.idempotencyKey));

    expect(rows).toHaveLength(0);
  });

  it('takes orders again the moment it is switched back', async () => {
    await setAcceptingOrders(false);
    expect((await place()).ok).toBe(false);

    await setAcceptingOrders(true);
    expect((await place()).ok).toBe(true);
  });
});

describe('what a pause must not break', () => {
  it('still quotes, so the checkout can explain itself', async () => {
    /*
      The screen needs a total to render beside the notice. If quoting failed
      while paused, the customer would meet an error rather than a sentence
      telling them what is going on.
    */
    await setAcceptingOrders(false);

    const { quote, window } = await quoteCheckout({
      type: 'DELIVERY',
      cityCode: CITY,
      point: CENTRE,
      cart: [{ productId: dishId, optionIds: [], quantity: 2 }],
    });

    expect(window.isPaused).toBe(true);
    expect(window.canOrder).toBe(false);

    // Priced normally, and no blocker of its own: being paused is not a problem
    // with this basket. The narrowing is what proves it — a quote carrying a
    // blocker has no total to read.
    if (quote.blocker !== null) throw new Error(`quote was blocked: ${quote.blocker.code}`);
    expect(quote.total).toBeGreaterThan(0);
  });

  it('leaves an order placed before the pause alone', async () => {
    const created = await place();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await setAcceptingOrders(false);

    const view = await getOrderView(created.order.trackingToken);
    expect(view).not.toBeNull();
    expect(view!.status).toBe('NEW');
    expect(view!.total).toBe(created.order.total);
  });

  it('lets the kitchen keep working through it', async () => {
    // The panel is what the owner is standing at when they press pause. If
    // statuses stopped moving, the orders already cooking would be stranded.
    const created = await place();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await setAcceptingOrders(false);

    const confirmed = await updateOrderStatus({ orderId: created.order.id, to: 'CONFIRMED' });
    expect(confirmed.ok).toBe(true);

    const preparing = await updateOrderStatus({ orderId: created.order.id, to: 'PREPARING' });
    expect(preparing.ok).toBe(true);
    if (preparing.ok) expect(preparing.order.status).toBe('PREPARING');
  });

  it('keeps the kitchen ticket that was already queued', async () => {
    const created = await place();
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    await setAcceptingOrders(false);

    // Queued when the order was placed, and still there to be sent or retried.
    // Pausing must not strand a ticket the kitchen has not seen yet.
    const queued = await db
      .select()
      .from(notifications)
      .where(eq(notifications.orderId, created.order.id));

    expect(queued).toHaveLength(1);
    expect(queued[0].status).toBe('PENDING');
  });
});
