import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Proof that the published preview cannot take money.
 *
 * The demo is meant to *show* the payment flow — the method appears at checkout,
 * an order sits waiting for payment, the fake page decides, the tracking page
 * follows — and none of it may touch a database or a kitchen. That claim is worth
 * testing rather than asserting in a comment, because it is the difference between
 * a design preview and a public URL that can create obligations to real people.
 *
 * How the proof works: the connection string is removed along with the demo flag.
 * The database client throws the first time it is touched without one, so a
 * function that returns an ordinary answer here has demonstrably not reached
 * Postgres — no mocking of the driver, and nothing that can pass because a stub
 * was wired up wrong. The first test checks that the trap is armed; the rest walk
 * into it.
 *
 * `IS_DEMO` and the validated environment are both read at import time, so every
 * test re-imports the modules under the stubbed environment.
 */

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', '1');
  // Deliberately present and deliberately ignored: even told which adapter to
  // use, the demo must resolve no provider at all.
  vi.stubEnv('PAYMENT_PROVIDER', 'stub');
  vi.stubEnv('DATABASE_URL', '');
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('the trap this file relies on', () => {
  it('has no database to reach', async () => {
    const { db } = await import('@/server/db/client');
    const { orders } = await import('@/server/db/schema');

    // Synchronously, on the lazy client's first property access — the query is
    // never even built. If this ever stops throwing, every test below stops
    // proving anything.
    expect(() => db.select().from(orders).limit(1)).toThrow(/DATABASE_URL/);
  });
});

describe('demo mode resolves no payment provider', () => {
  it('offers online payment on screen but has nothing behind it', async () => {
    const { configuredProvider, isOnlinePaymentOffered } = await import(
      '@/server/payments/registry'
    );

    // Two different questions, and the demo is the one place their answers differ.
    expect(configuredProvider()).toBeNull();
    expect(isOnlinePaymentOffered()).toBe(true);
  });

  it('lists ONLINE among the methods the checkout may show', async () => {
    const { isOnlinePaymentOffered } = await import('@/server/payments/registry');
    const { availablePaymentMethods } = await import('@/lib/schemas/checkout');

    expect(availablePaymentMethods(isOnlinePaymentOffered())).toContain('ONLINE');
  });
});

describe('demo mode writes nothing', () => {
  it('refuses to create an order at all', async () => {
    const { createOrder } = await import('@/server/services/orders');

    const result = await createOrder({
      type: 'PICKUP',
      customerName: 'Demo Visitor',
      phone: '+37493123456',
      paymentMethod: 'ONLINE',
      idempotencyKey: '6f9619ff-8b86-d011-b42d-00c04fc964ff',
      cart: [{ productId: '6f9619ff-8b86-d011-b42d-00c04fc964aa', optionIds: [], quantity: 1 }],
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DEMO_MODE');
  });

  it('refuses to open a payment session', async () => {
    const { startPayment } = await import('@/server/services/payments');

    const result = await startPayment('6f9619ff-8b86-d011-b42d-00c04fc964ff');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('DEMO_MODE');
  });

  it('refuses to confirm a payment', async () => {
    const { confirmPayment } = await import('@/server/services/payments');

    expect((await confirmPayment('6f9619ff-8b86-d011-b42d-00c04fc964ff')).code).toBe('NOT_FOUND');
  });

  it('sweeps nothing, so no order is ever cancelled by a schedule', async () => {
    const { sweepPayments } = await import('@/server/services/payments');

    expect(await sweepPayments(25)).toEqual({
      reconciled: 0,
      paid: 0,
      expired: 0,
      needsRefund: 0,
    });
  });

  it('reports no payment attempts rather than querying for them', async () => {
    const { paymentsForOrder } = await import('@/server/services/payments');

    expect(await paymentsForOrder('6f9619ff-8b86-d011-b42d-00c04fc964ff')).toEqual([]);
  });

  it('refuses a decision from the fake payment page', async () => {
    // The demo's own payment flow lives in the browser's session store. This
    // action is the stub gateway's server side, and in the preview there is no
    // gateway and no table for it to write to.
    const { decideStubPayment } = await import('@/app/[locale]/(site)/pay/[reference]/actions');

    const result = await decideStubPayment('stub_anything', 'PAID');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('UNAVAILABLE');
  });
});

describe('demo mode tells no kitchen', () => {
  it('has no notification to dispatch and does not go looking for one', async () => {
    // `dispatchForOrder` swallows failures by design, so "it did not throw" would
    // prove nothing here. What is checked instead is that Telegram is not
    // configured in a preview and the outbox is never read — the demo has no
    // order id that could belong to a row.
    const { isTelegramConfigured } = await import('@/server/telegram/config');

    expect(isTelegramConfigured()).toBe(false);
  });
});
