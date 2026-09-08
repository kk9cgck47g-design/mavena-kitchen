import { randomUUID } from 'node:crypto';
import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { CITY_CODES, defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { closeDb, db } from '@/server/db/client';
import { ZONES } from '@/server/db/delivery-data';
import {
  notifications,
  orderEvents,
  orders,
  payments,
  products,
  settings,
  stubPayments,
} from '@/server/db/schema';
import { configuredProvider } from '@/server/payments/registry';
import { decideStubSession } from '@/server/payments/stub';
import { createOrder } from '@/server/services/orders';
import {
  confirmPayment,
  expireUnpaidOrders,
  paymentsForOrder,
  startPayment,
  sweepPayments,
} from '@/server/services/payments';

/**
 * The online payment flow, end to end, against a real database and the stub
 * provider.
 *
 * The cases here are not a checklist of features. Each one is a way this could
 * take somebody's money and give them nothing, or give away food nobody paid for,
 * and most of them are invisible in a happy-path demo: the customer who closes the
 * tab, the return that arrives twice, the sweep racing a payment, the money that
 * lands after we gave up.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

const CITY = CITY_CODES[0];

/** Read from the seed's own constants, so a zone edit moves the test with it. */
const CENTRAL = ZONES.find((zone) => zone.id === 'zone-yerevan-central')!;

/** Central Yerevan — inside the seeded central delivery zone. */
const CENTRE = { lat: 40.1834, lng: 44.5119 };
const TEST_DISH_SLUG = 'burger-beef';

const createdOrderIds: string[] = [];
const createdReferences: string[] = [];

let dishId: string;
let dishPrice: number;
let originalHours: WeeklySchedule | null = null;

function checkout(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DELIVERY' as const,
    customerName: 'Payment Test',
    phone: '+37493123456',
    cityCode: CITY,
    address: 'Shahumyan 12',
    lat: CENTRE.lat,
    lng: CENTRE.lng,
    paymentMethod: 'ONLINE' as const,
    idempotencyKey: randomUUID(),
    // Two, so the central zone's minimum order is not what is being tested.
    cart: [{ productId: dishId, optionIds: [], quantity: 2 }],
    ...overrides,
  };
}

/** An online order, placed and waiting. The starting point of nearly every case. */
async function placeOnline(overrides: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result = await createOrder(checkout(overrides) as any);
  if (!result.ok) throw new Error(`could not place the order: ${result.error.code}`);

  createdOrderIds.push(result.order.id);
  return result.order;
}

/** Place it and send the customer to the provider, returning both halves. */
async function placeAndStart(overrides: Record<string, unknown> = {}) {
  const order = await placeOnline(overrides);

  const started = await startPayment(order.id, 'ru');
  if (!started.ok) throw new Error(`could not start the payment: ${started.error.code}`);

  const attempt = await attemptRow(started.paymentId);
  if (attempt.externalId) createdReferences.push(attempt.externalId);

  return { order, started, attempt };
}

async function attemptRow(paymentId: string) {
  const [row] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  return row;
}

async function orderRow(orderId: string) {
  const [row] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  return row;
}

async function ticketsFor(orderId: string) {
  return db.select().from(notifications).where(eq(notifications.orderId, orderId));
}

async function eventsFor(orderId: string) {
  return db
    .select()
    .from(orderEvents)
    .where(eq(orderEvents.orderId, orderId))
    .orderBy(orderEvents.createdAt);
}

/** Force an order's deadline into the past, the way half an hour of waiting would. */
async function expireWindow(orderId: string) {
  await db
    .update(orders)
    .set({ paymentExpiresAt: new Date(Date.now() - 60_000) })
    .where(eq(orders.id, orderId));
}

beforeAll(async () => {
  const [dish] = await db.select().from(products).where(eq(products.slug, TEST_DISH_SLUG)).limit(1);
  if (!dish) throw new Error('Seed data missing — run `pnpm db:seed` first.');

  dishId = dish.id;
  dishPrice = dish.basePrice;

  // The suite must not depend on the hour it runs at; the opening hours have
  // their own unit tests with an injected clock.
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
  // Payments, items, events and notifications all cascade from the order.
  if (createdOrderIds.length > 0) {
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  if (createdReferences.length > 0) {
    await db.delete(stubPayments).where(inArray(stubPayments.externalId, createdReferences));
  }
  if (originalHours) {
    await db.update(settings).set({ workingHours: originalHours });
  }
  await closeDb();
});

describe('the stub provider is what these tests run against', () => {
  it('is the configured provider', () => {
    // Everything below is meaningless if online payment is switched off, and a
    // silently skipped payment suite is worse than a failing one.
    expect(configuredProvider()?.name).toBe('stub');
  });
});

describe('placing an online order', () => {
  it('holds it for payment instead of sending it to the kitchen', async () => {
    const order = await placeOnline();

    expect(order.status).toBe('AWAITING_PAYMENT');

    const row = await orderRow(order.id);
    expect(row.status).toBe('AWAITING_PAYMENT');
    expect(row.paymentStatus).toBe('PENDING');
    expect(row.paymentExpiresAt).not.toBeNull();
    expect(row.paymentExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('queues no kitchen ticket until the money is there', async () => {
    // The one that matters most. A ticket here means a cook starts on food that
    // may never be paid for, with nothing on the ticket to say so.
    const order = await placeOnline();

    expect(await ticketsFor(order.id)).toHaveLength(0);
  });

  it('records that the customer placed it awaiting payment', async () => {
    const order = await placeOnline();
    const events = await eventsFor(order.id);

    expect(events).toHaveLength(1);
    expect(events[0].fromStatus).toBeNull();
    expect(events[0].toStatus).toBe('AWAITING_PAYMENT');
    expect(events[0].source).toBe('CUSTOMER');
  });

  it('still sends a cash order straight to the kitchen', async () => {
    // The change must not have touched the path that was already working.
    const order = await placeOnline({ paymentMethod: 'CASH' });

    expect(order.status).toBe('NEW');
    expect((await orderRow(order.id)).paymentExpiresAt).toBeNull();
    expect(await ticketsFor(order.id)).toHaveLength(1);
  });
});

describe('starting a payment', () => {
  it('opens one attempt and hands back somewhere to send the customer', async () => {
    const { order, started, attempt } = await placeAndStart();

    expect(started.resumed).toBe(false);
    expect(started.redirectUrl).toContain('/pay/');

    expect(attempt.status).toBe('PENDING');
    expect(attempt.provider).toBe('stub');
    expect(attempt.externalId).toBeTruthy();
    expect(attempt.expiresAt).not.toBeNull();

    // The amount is frozen onto the attempt, and it is the order's total.
    expect(attempt.amount).toBe(dishPrice * 2 + CENTRAL.fee);
    expect(attempt.amount).toBe((await orderRow(order.id)).total);
  });

  it('resumes the live attempt instead of opening a second one', async () => {
    // Pressing "pay" again while the first session is still usable. Opening a new
    // one would abandon a session the customer may be completing right now.
    const { order, started } = await placeAndStart();

    const again = await startPayment(order.id, 'ru');
    expect(again.ok).toBe(true);
    if (!again.ok) return;

    expect(again.resumed).toBe(true);
    expect(again.paymentId).toBe(started.paymentId);
    expect(again.redirectUrl).toBe(started.redirectUrl);

    expect(await paymentsForOrder(order.id)).toHaveLength(1);
  });

  it("refuses once the order's window has closed", async () => {
    const order = await placeOnline();
    await expireWindow(order.id);

    const started = await startPayment(order.id, 'ru');
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.error.code).toBe('WINDOW_CLOSED');
  });

  it('refuses to start paying for a cash order', async () => {
    const order = await placeOnline({ paymentMethod: 'CASH' });

    const started = await startPayment(order.id, 'ru');
    expect(started.ok).toBe(false);
    if (started.ok) return;
    expect(started.error.code).toBe('NOT_PAYABLE');
  });
});

describe('a payment that succeeds', () => {
  it('moves the order to the kitchen and queues exactly one ticket', async () => {
    const { order, started, attempt } = await placeAndStart();

    // The customer pays on the provider's page.
    await decideStubSession(attempt.externalId!, 'PAID');

    const outcome = await confirmPayment(started.paymentId);
    expect(outcome.code).toBe('PAID');

    const row = await orderRow(order.id);
    expect(row.status).toBe('NEW');
    expect(row.paymentStatus).toBe('PAID');
    // Nothing left to count down to, and the sweep will never look at it again.
    expect(row.paymentExpiresAt).toBeNull();

    const paid = await attemptRow(started.paymentId);
    expect(paid.status).toBe('PAID');
    expect(paid.confirmedAt).not.toBeNull();
    expect(paid.needsRefund).toBe(false);

    expect(await ticketsFor(order.id)).toHaveLength(1);

    const events = await eventsFor(order.id);
    expect(events.map((event) => event.toStatus)).toEqual(['AWAITING_PAYMENT', 'NEW']);
    expect(events[1].source).toBe('PAYMENT');
  });

  it('survives the return being visited twice', async () => {
    // A refresh of the return URL, or a customer pressing back and forward. The
    // second visit must add nothing: not a second ticket, not a second capture.
    const { order, started, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');

    expect((await confirmPayment(started.paymentId)).code).toBe('PAID');
    expect((await confirmPayment(started.paymentId)).code).toBe('ALREADY_PAID');
    expect((await confirmPayment(started.paymentId)).code).toBe('ALREADY_PAID');

    expect(await ticketsFor(order.id)).toHaveLength(1);
    expect(await paymentsForOrder(order.id)).toHaveLength(1);
    expect((await orderRow(order.id)).status).toBe('NEW');
  });

  it('survives two confirmations arriving at once', async () => {
    // The return and the sweep landing together. One of them wins the conditional
    // write; both report a paid order.
    const { order, started, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');

    const [first, second] = await Promise.all([
      confirmPayment(started.paymentId),
      confirmPayment(started.paymentId),
    ]);

    expect([first.code, second.code].filter((code) => code === 'PAID')).toHaveLength(1);
    expect([first.code, second.code]).toContain('ALREADY_PAID');

    expect(await ticketsFor(order.id)).toHaveLength(1);
    expect((await orderRow(order.id)).paymentStatus).toBe('PAID');
  });

  it("cannot be recorded twice even past the application's own checks", async () => {
    // The database's backstop, tested directly. Everything above is code being
    // careful; this is what remains true if the code is not.
    const { order, started, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');
    await confirmPayment(started.paymentId);

    await expect(
      db.insert(payments).values({
        orderId: order.id,
        provider: 'stub',
        externalId: `stub_${randomUUID()}`,
        amount: 100,
        status: 'PAID',
      }),
    ).rejects.toThrow();
  });

  it('is found by the sweep when the customer closes the tab', async () => {
    /*
      The case that loses money if nothing covers it. The customer pays and never
      comes back, so no return fires and — with a provider that does not push
      notifications — nothing arrives unprompted. Only the sweep asking about a
      pending attempt recovers the order.
    */
    const { order, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');

    // No confirmPayment call here: the customer is gone.
    const result = await sweepPayments(50);
    expect(result.paid).toBeGreaterThanOrEqual(1);

    const row = await orderRow(order.id);
    expect(row.status).toBe('NEW');
    expect(row.paymentStatus).toBe('PAID');
    expect(await ticketsFor(order.id)).toHaveLength(1);
  });

  it('is not disturbed by the sweep running again', async () => {
    const { order, started, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');
    await confirmPayment(started.paymentId);

    const before = await orderRow(order.id);

    await sweepPayments(50);
    await sweepPayments(50);

    const after = await orderRow(order.id);
    expect(after.status).toBe('NEW');
    expect(after.paymentStatus).toBe('PAID');
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    expect(await ticketsFor(order.id)).toHaveLength(1);
  });
});

describe('a payment for the wrong amount', () => {
  it('is refused, flagged for a refund, and leaves the order unpaid', async () => {
    const { order, started, attempt } = await placeAndStart();

    // The gateway reports a different amount from the one we asked for — a
    // misconfigured terminal, a currency mix-up, a tampered session.
    await db
      .update(stubPayments)
      .set({ amount: attempt.amount - 500 })
      .where(eq(stubPayments.externalId, attempt.externalId!));

    await decideStubSession(attempt.externalId!, 'PAID');

    const outcome = await confirmPayment(started.paymentId);
    expect(outcome.code).toBe('NEEDS_REFUND');
    if (outcome.code !== 'NEEDS_REFUND') return;
    expect(outcome.reason).toBe('AMOUNT_MISMATCH');

    // Not paid. Charging a total nobody agreed to is the thing being prevented,
    // in both directions — less would be an unauthorised discount.
    const row = await orderRow(order.id);
    expect(row.status).toBe('AWAITING_PAYMENT');
    expect(row.paymentStatus).toBe('PENDING');

    const rejected = await attemptRow(started.paymentId);
    expect(rejected.status).toBe('FAILED');
    expect(rejected.needsRefund).toBe(true);
    expect(rejected.failureReason).toContain('Amount mismatch');

    // And above all: no ticket. The kitchen must not start on this.
    expect(await ticketsFor(order.id)).toHaveLength(0);
  });
});

describe('a payment that fails', () => {
  it('leaves the order waiting so the customer can try again', async () => {
    const { order, started, attempt } = await placeAndStart();

    await decideStubSession(attempt.externalId!, 'FAILED');

    const outcome = await confirmPayment(started.paymentId);
    expect(outcome.code).toBe('FAILED');

    // A declined card is not an abandoned order. The window is still running and
    // the customer is probably reaching for another card.
    const row = await orderRow(order.id);
    expect(row.status).toBe('AWAITING_PAYMENT');
    expect(row.paymentStatus).toBe('PENDING');

    expect((await attemptRow(started.paymentId)).status).toBe('FAILED');
    expect(await ticketsFor(order.id)).toHaveLength(0);
  });

  it('lets a second attempt be opened and paid', async () => {
    const { order, started, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'FAILED');
    await confirmPayment(started.paymentId);

    // Retry: the failed attempt is settled, so this is a new one rather than a
    // resumption.
    const retry = await startPayment(order.id, 'ru');
    expect(retry.ok).toBe(true);
    if (!retry.ok) return;

    expect(retry.resumed).toBe(false);
    expect(retry.paymentId).not.toBe(started.paymentId);

    const second = await attemptRow(retry.paymentId);
    createdReferences.push(second.externalId!);

    await decideStubSession(second.externalId!, 'PAID');
    expect((await confirmPayment(retry.paymentId)).code).toBe('PAID');

    const row = await orderRow(order.id);
    expect(row.status).toBe('NEW');
    expect(row.paymentStatus).toBe('PAID');

    // Two attempts on the record, one ticket for the kitchen.
    expect(await paymentsForOrder(order.id)).toHaveLength(2);
    expect(await ticketsFor(order.id)).toHaveLength(1);
  });
});

describe('an order nobody pays for', () => {
  it('is cancelled once its window closes, with nothing charged', async () => {
    const { order, attempt } = await placeAndStart();
    await expireWindow(order.id);

    expect(await expireUnpaidOrders(50)).toBeGreaterThanOrEqual(1);

    const row = await orderRow(order.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.paymentStatus).toBe('EXPIRED');
    expect(row.paymentExpiresAt).toBeNull();

    // The attempt is expired, not failed: nobody refused it, we stopped waiting.
    // That distinction is what makes the next test possible.
    expect((await attemptRow(attempt.id)).status).toBe('EXPIRED');
    expect(await ticketsFor(order.id)).toHaveLength(0);
  });

  it('is left alone while its window is still open', async () => {
    const { order } = await placeAndStart();

    await expireUnpaidOrders(50);

    expect((await orderRow(order.id)).status).toBe('AWAITING_PAYMENT');
  });

  it('is never cancelled after being paid, even with an expired deadline', async () => {
    /*
      The sweep's worst possible mistake: cancelling an order somebody has paid
      for. Reproduced by paying and then pushing the deadline into the past, which
      is the state a payment confirmed moments before the sweep would leave behind
      if `paymentExpiresAt` were not cleared.
    */
    const { order, started, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');
    await confirmPayment(started.paymentId);

    await db
      .update(orders)
      .set({ paymentExpiresAt: new Date(Date.now() - 60_000) })
      .where(eq(orders.id, order.id));

    await expireUnpaidOrders(50);

    expect((await orderRow(order.id)).status).toBe('NEW');
    expect((await orderRow(order.id)).paymentStatus).toBe('PAID');
  });

  it('is expired by the sweep only after it has asked the provider', async () => {
    /*
      Ordering, and it is the difference between recovering a payment and creating
      a refund. The customer paid but never returned, and the deadline has passed:
      the sweep must discover the money before deciding the order is unpaid.
    */
    const { order, attempt } = await placeAndStart();
    await decideStubSession(attempt.externalId!, 'PAID');
    await expireWindow(order.id);

    await sweepPayments(50);

    const row = await orderRow(order.id);
    expect(row.status).toBe('NEW');
    expect(row.paymentStatus).toBe('PAID');
    expect(await ticketsFor(order.id)).toHaveLength(1);
  });
});

describe('money that arrives too late', () => {
  it('is recorded, flagged for a refund, and does not revive the order', async () => {
    /*
      The customer took too long over a 3-D Secure code. We cancelled; the bank
      settled afterwards. Reviving the order would put a ticket in front of a
      kitchen half an hour after the customer gave up, and food arriving for
      somebody who has eaten is worse than a refund.
    */
    const { order, started, attempt } = await placeAndStart();
    await expireWindow(order.id);
    await expireUnpaidOrders(50);

    expect((await orderRow(order.id)).status).toBe('CANCELLED');

    // Now the money turns up.
    await decideStubSession(attempt.externalId!, 'PAID');

    const outcome = await confirmPayment(started.paymentId);
    expect(outcome.code).toBe('NEEDS_REFUND');
    if (outcome.code !== 'NEEDS_REFUND') return;
    expect(outcome.reason).toBe('LATE_PAYMENT');

    // The payment is real and recorded as such — pretending otherwise would put
    // the books at odds with the bank statement.
    const paid = await attemptRow(started.paymentId);
    expect(paid.status).toBe('PAID');
    expect(paid.needsRefund).toBe(true);
    expect(paid.confirmedAt).not.toBeNull();

    const row = await orderRow(order.id);
    expect(row.status).toBe('CANCELLED');
    expect(row.paymentStatus).toBe('PAID');

    // And the kitchen is still not told.
    expect(await ticketsFor(order.id)).toHaveLength(0);
  });

  it('is surfaced by the sweep as needing a refund', async () => {
    const { order, attempt } = await placeAndStart();
    await expireWindow(order.id);
    await expireUnpaidOrders(50);
    await decideStubSession(attempt.externalId!, 'PAID');

    const result = await sweepPayments(50);
    expect(result.needsRefund).toBeGreaterThanOrEqual(1);

    const [flagged] = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.needsRefund, true)));

    expect(flagged).toBeTruthy();
  });
});
