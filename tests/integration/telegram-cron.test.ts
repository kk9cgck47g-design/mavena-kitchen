import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { closeDb, db } from '@/server/db/client';
import { orders, products, settings } from '@/server/db/schema';

/**
 * The scheduled sweep: who may run it, and what it does when it runs.
 *
 * Loaded through `load()` for the same reason as the Telegram tests — the demo
 * flag, the bot token and the cron secret are all read when their modules are
 * first imported, and this file needs to see the endpoint configured,
 * unconfigured and in demo mode within one run.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

const BOT_TOKEN = 'test-bot-token';
const CRON_SECRET = 'cron-secret-at-least-16-chars';
const CHAT_A = '-1001111111111';
const CHAT_B = '-1002222222222';

const createdOrderIds: string[] = [];

let dishId: string;
let originalHours: WeeklySchedule | null = null;
let originalChats: string[] = [];

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN ?? BOT_TOKEN);
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', 'irrelevant-here-but-set');
  vi.stubEnv('CRON_SECRET', env.CRON_SECRET ?? CRON_SECRET);
  vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', env.NEXT_PUBLIC_DEMO_MODE ?? '0');

  return {
    orders: await import('@/server/services/orders'),
    outbox: await import('@/server/telegram/outbox'),
    route: await import('@/app/api/cron/telegram/route'),
  };
}

function stubTelegram(handler: (body: Record<string, unknown>) => { ok: boolean; status?: number }) {
  const calls: Array<Record<string, unknown>> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      if (String(url).endsWith('/sendMessage')) calls.push(body);

      const answer = handler(body);
      return new Response(
        JSON.stringify({ ok: answer.ok, result: { message_id: 1 }, description: 'stubbed' }),
        { status: answer.status ?? (answer.ok ? 200 : 503), headers: { 'content-type': 'application/json' } },
      );
    }),
  );

  return calls;
}

function cronRequest(authorization: string | null) {
  return new Request('http://localhost/api/cron/telegram', {
    method: 'GET',
    headers: authorization ? { authorization } : {},
  });
}

async function placeOrder(mod: Awaited<ReturnType<typeof load>>) {
  const result = await mod.orders.createOrder({
    type: 'PICKUP',
    customerName: 'Cron Test',
    phone: '+37493123456',
    paymentMethod: 'CASH',
    idempotencyKey: randomUUID(),
    cart: [{ productId: dishId, optionIds: [], quantity: 2 }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (!result.ok) throw new Error(`order not created: ${result.error.code}`);
  createdOrderIds.push(result.order.id);
  return result.order;
}

beforeAll(async () => {
  const [dish] = await db.select().from(products).where(eq(products.slug, 'burger-beef')).limit(1);
  if (!dish) throw new Error('Seed data missing — run `pnpm db:seed` first.');
  dishId = dish.id;

  const [current] = await db.select().from(settings).limit(1);
  originalHours = current?.workingHours ?? null;
  originalChats = current?.telegramChatIds ?? [];

  const alwaysOpen = defaultWeeklySchedule();
  for (const day of Object.values(alwaysOpen)) {
    day.isClosed = false;
    day.opensAt = '00:00';
    day.closesAt = '23:59';
  }
  await db
    .update(settings)
    .set({ workingHours: alwaysOpen, isAcceptingOrders: true, telegramChatIds: [CHAT_A] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

afterAll(async () => {
  if (createdOrderIds.length > 0) {
    await db.delete(orders).where(inArray(orders.id, createdOrderIds));
  }
  if (originalHours) await db.update(settings).set({ workingHours: originalHours });
  await db.update(settings).set({ telegramChatIds: originalChats });
  await closeDb();
});

describe('authorisation', () => {
  it('refuses a request with no Authorization header', async () => {
    const mod = await load();
    const calls = stubTelegram(() => ({ ok: true }));

    await placeOrder(mod);
    const response = await mod.route.GET(cronRequest(null));

    expect(response.status).toBe(401);
    // Nothing was dispatched, which is the property that matters.
    expect(calls).toHaveLength(0);
  });

  it('refuses a wrong secret', async () => {
    const mod = await load();
    const calls = stubTelegram(() => ({ ok: true }));

    await placeOrder(mod);
    const response = await mod.route.GET(cronRequest('Bearer not-the-cron-secret'));

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('refuses the secret without its Bearer prefix', async () => {
    const mod = await load();
    const calls = stubTelegram(() => ({ ok: true }));

    await placeOrder(mod);
    const response = await mod.route.GET(cronRequest(CRON_SECRET));

    expect(response.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('is closed, not open, when no secret is configured', async () => {
    const mod = await load({ CRON_SECRET: '' });
    const calls = stubTelegram(() => ({ ok: true }));

    await placeOrder(mod);

    // A missing secret must never mean "anyone may run this".
    expect((await mod.route.GET(cronRequest(null))).status).toBe(404);
    expect((await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`))).status).toBe(404);
    expect(calls).toHaveLength(0);
  });

  it('accepts the secret Vercel Cron sends', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    await placeOrder(mod);
    const response = await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true });
  });
});

describe('sweeping', () => {
  it('delivers what was still queued and marks it sent', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: false, status: 503 }));

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);
    expect(queued.status).toBe('PENDING');

    // Telegram comes back; the scheduled run finds the backlog.
    const calls = stubTelegram(() => ({ ok: true }));
    const response = await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, sent: expect.any(Number) });
    expect(calls.some((body) => body.chat_id === CHAT_A)).toBe(true);

    const after = await mod.outbox.getNotification(queued.id);
    expect(after!.status).toBe('SENT');
  });

  it('sends nothing twice, however often it runs', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);
    await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    const [sent] = await mod.outbox.notificationsForOrder(order.id);
    expect(sent.status).toBe('SENT');

    // Two more sweeps. A SENT row is never selected again, so an overlapping
    // schedule cannot post a second copy of anybody's ticket.
    const calls = stubTelegram(() => ({ ok: true }));
    await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));
    await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(calls.filter((body) => String(body.text).includes(order.publicCode))).toHaveLength(0);
  });

  it('does not re-send to a chat that already has it', async () => {
    const mod = await load();
    await db.update(settings).set({ telegramChatIds: [CHAT_A, CHAT_B] });

    // One screen is unreachable on the first pass.
    stubTelegram((body) => (body.chat_id === CHAT_B ? { ok: false, status: 502 } : { ok: true }));

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);
    await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    const partial = await mod.outbox.getNotification(queued.id);
    expect(partial!.status).toBe('PENDING');
    expect(Object.keys(partial!.deliveries)).toEqual([CHAT_A]);

    // The sweep runs again with both reachable.
    const calls = stubTelegram(() => ({ ok: true }));
    await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    const mine = calls.filter((body) => String(body.text).includes(order.publicCode));
    expect(mine).toHaveLength(1);
    expect(mine[0].chat_id).toBe(CHAT_B);

    await db.update(settings).set({ telegramChatIds: [CHAT_A] });
  });

  it('bounds one run, so a backlog is drained over several', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const response = await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));
    const body = (await response.json()) as { sent: number; failed: number };

    // The route asks for 25 at most; whatever it reports having handled cannot
    // exceed that however long the queue is.
    expect(body.sent + body.failed).toBeLessThanOrEqual(25);
  });
});

describe('demo mode', () => {
  it('has no sweep at all', async () => {
    const mod = await load({ NEXT_PUBLIC_DEMO_MODE: '1' });
    const calls = stubTelegram(() => ({ ok: true }));

    const response = await mod.route.GET(cronRequest(`Bearer ${CRON_SECRET}`));

    expect(response.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});
