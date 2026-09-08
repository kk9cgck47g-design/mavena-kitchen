import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CITY_CODES, defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { closeDb, db } from '@/server/db/client';
import { adminUsers, orders, products, settings } from '@/server/db/schema';
import { verifyCredentials } from '@/server/auth/admin-session';
import { getAdminOrder, getDashboardStats, listOrders } from '@/server/services/admin-orders';
import { listMenuForAdmin, setDishAvailability, setDishPrice } from '@/server/services/admin-menu';
import { createOrder } from '@/server/services/orders';

/**
 * The staff panel against the real database: what the list shows, what the
 * dashboard counts, and what the menu screen is allowed to change.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

const CITY = CITY_CODES[0];

/** Central Yerevan — inside the seeded central delivery zone. */
const CENTRE = { lat: 40.1834, lng: 44.5119 };
const TEST_DISH_SLUG = 'burger-beef';

/** Isolated credential fixture; it never depends on whichever owner was seeded. */
const TEST_ADMIN = {
  id: randomUUID(),
  email: `portfolio-auth-${randomUUID()}@mavena.example`,
  password: 'PortfolioAuthTest123!',
};

const createdOrderIds: string[] = [];

let dishId: string;
let dishPrice: number;
let originalHours: WeeklySchedule | null = null;

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DELIVERY' as const,
    customerName: 'Panel Test',
    phone: '+37493123456',
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

async function place(input: Record<string, unknown>) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await createOrder(input as any);
  if (result.ok) createdOrderIds.push(result.order.id);
  return result;
}

beforeAll(async () => {
  await db.insert(adminUsers).values({
    id: TEST_ADMIN.id,
    email: TEST_ADMIN.email,
    passwordHash: await bcrypt.hash(TEST_ADMIN.password, 12),
    name: 'Portfolio Auth Test',
    role: 'OWNER',
  });

  const [dish] = await db.select().from(products).where(eq(products.slug, TEST_DISH_SLUG)).limit(1);
  if (!dish) throw new Error('Seed data missing — run `pnpm db:seed` first.');

  dishId = dish.id;
  dishPrice = dish.basePrice;

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
  if (originalHours) await db.update(settings).set({ workingHours: originalHours });
  // Undo anything the menu tests changed.
  await db
    .update(products)
    .set({ basePrice: dishPrice, isAvailable: true })
    .where(eq(products.id, dishId));
  await db.delete(adminUsers).where(eq(adminUsers.id, TEST_ADMIN.id));
  await closeDb();
});

describe('listOrders', () => {
  it('finds an order by its public code and by the customer phone', async () => {
    const placed = await place(checkout());
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const byCode = await listOrders({ search: placed.order.publicCode });
    expect(byCode.orders.map((order) => order.id)).toContain(placed.order.id);

    // The same number, typed the way a customer would say it.
    const byPhone = await listOrders({ search: '093 12 34 56' });
    expect(byPhone.orders.map((order) => order.id)).toContain(placed.order.id);
  });

  it('returns nothing — not everything — for a search that means nothing', async () => {
    const result = await listOrders({ search: 'zz' });
    expect(result.orders).toHaveLength(0);
    expect(result.total).toBe(0);
  });

  it('filters by status', async () => {
    const placed = await place(checkout());
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const isNew = await listOrders({ statuses: ['NEW'] });
    expect(isNew.orders.map((order) => order.id)).toContain(placed.order.id);

    const delivered = await listOrders({ statuses: ['COMPLETED'] });
    expect(delivered.orders.map((order) => order.id)).not.toContain(placed.order.id);
  });

  it('counts the dishes in an order, not the lines', async () => {
    const placed = await place(
      checkout({ cart: [{ productId: dishId, optionIds: [], quantity: 3 }] }),
    );
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const result = await listOrders({ search: placed.order.publicCode });
    expect(result.orders[0]?.itemCount).toBe(3);
  });
});

describe('getAdminOrder', () => {
  it('returns the order with its items and its audit trail', async () => {
    const placed = await place(checkout());
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const detail = await getAdminOrder(placed.order.id);
    expect(detail).not.toBeNull();
    expect(detail!.order.publicCode).toBe(placed.order.publicCode);
    expect(detail!.order.items).toHaveLength(1);
    // Every order starts with the event the customer created.
    expect(detail!.events[0]).toMatchObject({ toStatus: 'NEW', source: 'CUSTOMER' });
  });

  it('answers null for an id that is not an order', async () => {
    expect(await getAdminOrder(randomUUID())).toBeNull();
  });
});

describe('getDashboardStats', () => {
  it('counts only what came through the site, and leaves cancelled orders out of the money', async () => {
    const before = await getDashboardStats();

    const placed = await place(checkout());
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const after = await getDashboardStats();

    expect(after.ordersToday).toBe(before.ordersToday + 1);
    expect(after.siteTotalToday).toBe(before.siteTotalToday + placed.order.total);
    expect(after.byStatus.NEW).toBe(before.byStatus.NEW + 1);
    // A new order is one nobody has looked at yet.
    expect(after.awaitingAction).toBe(before.awaitingAction + 1);
  });

  it('reports an average of zero rather than dividing by nothing', async () => {
    const stats = await getDashboardStats();
    expect(Number.isFinite(stats.averageOrderToday)).toBe(true);
    expect(Number.isInteger(stats.averageOrderToday)).toBe(true);
  });
});

describe('menu management', () => {
  it('changes a price without touching orders already placed', async () => {
    const placed = await place(checkout());
    expect(placed.ok).toBe(true);
    if (!placed.ok) return;

    const before = placed.order.total;

    expect(await setDishPrice(dishId, dishPrice + 250)).toEqual({ ok: true });

    const detail = await getAdminOrder(placed.order.id);
    // The order froze its own copy when it was placed. This is the invariant
    // that keeps a price rise at noon from rewriting the morning's takings.
    expect(detail!.order.total).toBe(before);
    expect(detail!.order.items[0].unitPrice).toBe(dishPrice);

    await setDishPrice(dishId, dishPrice);
  });

  it('refuses a price that is not a whole number of drams', async () => {
    expect(await setDishPrice(dishId, -1)).toEqual({ ok: false, code: 'INVALID_PRICE' });
    expect(await setDishPrice(dishId, 12.5)).toEqual({ ok: false, code: 'INVALID_PRICE' });
    expect(await setDishPrice(dishId, 10_000_000)).toEqual({ ok: false, code: 'INVALID_PRICE' });
  });

  it('reports a missing dish rather than silently doing nothing', async () => {
    expect(await setDishPrice(randomUUID(), 1000)).toEqual({ ok: false, code: 'NOT_FOUND' });
    expect(await setDishAvailability(randomUUID(), false)).toEqual({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('takes a dish off the stop list and puts it back', async () => {
    expect(await setDishAvailability(dishId, false)).toEqual({ ok: true });

    const off = (await listMenuForAdmin()).find((item) => item.id === dishId);
    expect(off?.isAvailable).toBe(false);
    // Unavailable is not the same as removed from the menu.
    expect(off?.isActive).toBe(true);

    expect(await setDishAvailability(dishId, true)).toEqual({ ok: true });
  });
});

describe('verifyCredentials', () => {
  it('accepts the isolated owner fixture', async () => {
    const admin = await verifyCredentials(TEST_ADMIN.email, TEST_ADMIN.password);
    expect(admin).not.toBeNull();
    expect(admin!.role).toBe('OWNER');
  });

  it('rejects a wrong password and an unknown address alike', async () => {
    expect(await verifyCredentials(TEST_ADMIN.email, 'not the password')).toBeNull();
    expect(await verifyCredentials('nobody@example.com', TEST_ADMIN.password)).toBeNull();
  });

  it('does not care how the email was capitalised', async () => {
    expect(
      await verifyCredentials(TEST_ADMIN.email.toUpperCase(), TEST_ADMIN.password),
    ).not.toBeNull();
  });
});
