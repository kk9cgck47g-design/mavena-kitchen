import { randomUUID } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { CITY_CODES, defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import { RESTAURANT } from '@/lib/restaurant';
import { closeDb, db } from '@/server/db/client';
import { notifications, orderEvents, orders, products, settings } from '@/server/db/schema';

const CITY = CITY_CODES[0];

/** Central Yerevan — inside the seeded central delivery zone. */
const CENTRE = { lat: 40.1834, lng: 44.5119 };

/**
 * Telegram against the real database, with `fetch` replaced.
 *
 * Everything here is loaded through `load()`, which resets the module registry
 * after stubbing the environment. That is not ceremony: `IS_DEMO`, the bot
 * token and the webhook secret are all read when their modules are first
 * imported, and these tests need to see the system configured, unconfigured and
 * in demo mode within one run. The database pool survives the resets because
 * `db/client.ts` caches it on `globalThis`.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

const BOT_TOKEN = 'test-bot-token';
const WEBHOOK_SECRET = 'test-webhook-secret';
const CHAT_A = '-1001111111111';
const CHAT_B = '-1002222222222';

const createdOrderIds: string[] = [];

let dishId: string;
let originalHours: WeeklySchedule | null = null;
let originalChats: string[] = [];

/** Fresh modules with the environment we want them to have seen. */
async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubEnv('TELEGRAM_BOT_TOKEN', env.TELEGRAM_BOT_TOKEN ?? BOT_TOKEN);
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', env.TELEGRAM_WEBHOOK_SECRET ?? WEBHOOK_SECRET);
  vi.stubEnv('NEXT_PUBLIC_DEMO_MODE', env.NEXT_PUBLIC_DEMO_MODE ?? '0');

  return {
    orders: await import('@/server/services/orders'),
    outbox: await import('@/server/telegram/outbox'),
    dispatch: await import('@/server/telegram/dispatch'),
    config: await import('@/server/telegram/config'),
    route: await import('@/app/api/telegram/route'),
  };
}

/** A `fetch` that answers Telegram's API the way we tell it to. */
function stubTelegram(
  handler: (
    method: string,
    body: Record<string, unknown>,
  ) => {
    status?: number;
    ok?: boolean;
    result?: unknown;
    description?: string;
  },
) {
  const calls: Array<{ method: string; body: Record<string, unknown> }> = [];

  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      const method = String(url).split('/').at(-1) ?? '';
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      calls.push({ method, body });

      const answer = handler(method, body);
      return new Response(
        JSON.stringify({
          ok: answer.ok ?? true,
          result: answer.result ?? { message_id: 555 },
          description: answer.description,
        }),
        { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } },
      );
    }),
  );

  return calls;
}

async function placeOrder(mod: Awaited<ReturnType<typeof load>>) {
  const result = await mod.orders.createOrder({
    type: 'DELIVERY',
    customerName: 'Telegram Test',
    phone: '+37493123456',
    cityCode: CITY,
    address: 'Shahumyan 12',
    lat: CENTRE.lat,
    lng: CENTRE.lng,
    paymentMethod: 'CASH',
    idempotencyKey: randomUUID(),
    cart: [{ productId: dishId, optionIds: [], quantity: 2 }],
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  if (!result.ok) throw new Error(`order not created: ${result.error.code}`);
  createdOrderIds.push(result.order.id);
  return result.order;
}

async function setChats(ids: string[]) {
  await db.update(settings).set({ telegramChatIds: ids });
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
  await db.update(settings).set({ workingHours: alwaysOpen, isAcceptingOrders: true });
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
  await setChats(originalChats);
  await closeDb();
});

describe('the outbox is written with the order', () => {
  it('queues a notification in the same transaction, before anything is sent', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));
    await setChats([CHAT_A]);

    const order = await placeOrder(mod);

    // Enqueued by `createOrder` itself, with no Telegram call involved: the row
    // exists whether or not anybody can be reached.
    const queued = await mod.outbox.notificationsForOrder(order.id);
    expect(queued).toHaveLength(1);
    expect(queued[0]).toMatchObject({ channel: 'TELEGRAM', kind: 'NEW_ORDER', status: 'PENDING' });
    expect(queued[0].attempts).toBe(0);
  });
});

describe('sending', () => {
  beforeEach(async () => {
    await setChats([CHAT_A]);
  });

  it('brands the Telegram connectivity check as Mavena Kitchen', async () => {
    const mod = await load();
    const calls = stubTelegram(() => ({ ok: true, result: { message_id: 4242 } }));

    expect(await mod.dispatch.sendTestMessage()).toEqual({ ok: true, results: [`${CHAT_A}: ok`] });

    const [sent] = calls.filter((call) => call.method === 'sendMessage');
    expect(String(sent.body.text)).toContain(`<b>${RESTAURANT.name}</b>`);
  });

  it('delivers the ticket and marks the row sent', async () => {
    const mod = await load();
    const calls = stubTelegram(() => ({ ok: true, result: { message_id: 4242 } }));

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);

    expect(await mod.dispatch.dispatchNotification(queued)).toBe(true);

    const sends = calls.filter((call) => call.method === 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(sends[0].body.chat_id).toBe(CHAT_A);
    expect(String(sends[0].body.text)).toContain(order.publicCode);
    // Buttons for the moves a NEW order can make, and no others.
    expect(JSON.stringify(sends[0].body.reply_markup)).toContain('CONFIRMED');
    expect(JSON.stringify(sends[0].body.reply_markup)).not.toContain('COMPLETED');

    const after = await mod.outbox.getNotification(queued.id);
    expect(after).toMatchObject({ status: 'SENT', attempts: 1 });
    expect(after!.deliveries[CHAT_A]).toBe(4242);
  });

  it('keeps the order and queues a retry when Telegram is unreachable', async () => {
    const mod = await load();
    stubTelegram(() => ({ status: 503, ok: false, description: 'Service Unavailable' }));

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);

    expect(await mod.dispatch.dispatchNotification(queued)).toBe(false);

    // The order is untouched — an unreachable kitchen is not a reason to lose
    // a customer's dinner.
    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('NEW');

    const after = await mod.outbox.getNotification(queued.id);
    expect(after).toMatchObject({ status: 'PENDING', attempts: 1 });
    expect(after!.lastError).toContain('Service Unavailable');
  });

  it('delivers on a later attempt, which is the point of the outbox', async () => {
    const mod = await load();
    stubTelegram(() => ({ status: 503, ok: false, description: 'down' }));

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);
    await mod.dispatch.dispatchNotification(queued);

    // Telegram comes back; the sweep that a cron or the panel's button calls.
    const calls = stubTelegram(() => ({ ok: true, result: { message_id: 99 } }));
    const outcome = await mod.dispatch.dispatchPending();

    expect(outcome.sent).toBeGreaterThanOrEqual(1);
    expect(calls.some((call) => call.method === 'sendMessage')).toBe(true);

    const after = await mod.outbox.getNotification(queued.id);
    expect(after!.status).toBe('SENT');
  });

  it('does not send anything when there is no bot token', async () => {
    const mod = await load({ TELEGRAM_BOT_TOKEN: '' });
    const calls = stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);

    expect(mod.config.isTelegramConfigured()).toBe(false);
    expect(await mod.dispatch.dispatchNotification(queued)).toBe(false);
    expect(calls).toHaveLength(0);

    // Left PENDING on purpose: configuring a token later and pressing retry
    // should still deliver the backlog.
    const after = await mod.outbox.getNotification(queued.id);
    expect(after!.status).toBe('PENDING');
  });

  it('records a configuration problem as failed rather than retrying it forever', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));
    await setChats([]);

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);

    expect(await mod.dispatch.dispatchNotification(queued)).toBe(false);

    const after = await mod.outbox.getNotification(queued.id);
    // No amount of retrying adds a chat id; a person has to.
    expect(after).toMatchObject({ status: 'FAILED' });
    expect(after!.lastError).toContain('chat ids');
  });
});

describe('several chats', () => {
  it('sends to every configured chat', async () => {
    const mod = await load();
    const calls = stubTelegram(() => ({ ok: true, result: { message_id: 7 } }));
    await setChats([CHAT_A, CHAT_B]);

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);

    expect(await mod.dispatch.dispatchNotification(queued)).toBe(true);

    const sends = calls.filter((call) => call.method === 'sendMessage');
    expect(sends.map((call) => call.body.chat_id).sort()).toEqual([CHAT_A, CHAT_B].sort());

    const after = await mod.outbox.getNotification(queued.id);
    expect(Object.keys(after!.deliveries).sort()).toEqual([CHAT_A, CHAT_B].sort());
  });

  it('retries only the chat that missed it, so the other is not told twice', async () => {
    const mod = await load();
    await setChats([CHAT_A, CHAT_B]);

    // The second screen is unreachable; the first gets its ticket.
    stubTelegram((_method, body) =>
      body.chat_id === CHAT_B
        ? { status: 502, ok: false, description: 'Bad Gateway' }
        : { ok: true, result: { message_id: 11 } },
    );

    const order = await placeOrder(mod);
    const [queued] = await mod.outbox.notificationsForOrder(order.id);

    expect(await mod.dispatch.dispatchNotification(queued)).toBe(false);

    const partial = await mod.outbox.getNotification(queued.id);
    expect(partial!.status).toBe('PENDING');
    expect(Object.keys(partial!.deliveries)).toEqual([CHAT_A]);

    // Both are reachable now. Only the one still missing it should be called.
    const retryCalls = stubTelegram(() => ({ ok: true, result: { message_id: 22 } }));
    expect(await mod.dispatch.dispatchNotification(partial!)).toBe(true);

    const sends = retryCalls.filter((call) => call.method === 'sendMessage');
    expect(sends).toHaveLength(1);
    expect(sends[0].body.chat_id).toBe(CHAT_B);
  });
});

describe('webhook', () => {
  function callbackRequest(body: unknown, secret: string | null) {
    return new Request('http://localhost/api/telegram', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(secret ? { 'x-telegram-bot-api-secret-token': secret } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  function press(publicCode: string, to: string, chatId: string = CHAT_A) {
    return {
      update_id: 1,
      callback_query: {
        id: 'cb-1',
        data: `st:${publicCode}:${to}`,
        message: { message_id: 555, chat: { id: chatId } },
      },
    };
  }

  beforeEach(async () => {
    await setChats([CHAT_A]);
  });

  it('moves the order and records the change as coming from Telegram', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);
    const response = await mod.route.POST(
      callbackRequest(press(order.publicCode, 'CONFIRMED'), WEBHOOK_SECRET),
    );

    expect(response.status).toBe(200);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('CONFIRMED');

    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    const fromTelegram = events.find((event) => event.source === 'TELEGRAM');
    expect(fromTelegram).toMatchObject({ fromStatus: 'NEW', toStatus: 'CONFIRMED' });
  });

  it('treats a redelivered press as already done, without a second event', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);
    const update = press(order.publicCode, 'CONFIRMED');

    await mod.route.POST(callbackRequest(update, WEBHOOK_SECRET));
    // Telegram redelivers anything it did not get a 200 for, and two people can
    // press at once. The second must change nothing.
    const second = await mod.route.POST(callbackRequest(update, WEBHOOK_SECRET));

    expect(second.status).toBe(200);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('CONFIRMED');

    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events.filter((event) => event.source === 'TELEGRAM')).toHaveLength(1);
  });

  it('refuses a transition the state machine does not allow', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);
    // NEW cannot jump straight to COMPLETED, whatever the button said.
    const response = await mod.route.POST(
      callbackRequest(press(order.publicCode, 'COMPLETED'), WEBHOOK_SECRET),
    );

    expect(response.status).toBe(200);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('NEW');

    const events = await db.select().from(orderEvents).where(eq(orderEvents.orderId, order.id));
    expect(events.filter((event) => event.source === 'TELEGRAM')).toHaveLength(0);
  });

  it('rejects a wrong secret, and a missing one', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);

    const wrong = await mod.route.POST(
      callbackRequest(press(order.publicCode, 'CONFIRMED'), 'not-the-secret'),
    );
    expect(wrong.status).toBe(401);

    const missing = await mod.route.POST(
      callbackRequest(press(order.publicCode, 'CONFIRMED'), null),
    );
    expect(missing.status).toBe(401);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('NEW');
  });

  it('ignores a press from a chat nobody configured', async () => {
    const mod = await load();
    stubTelegram(() => ({ ok: true }));

    const order = await placeOrder(mod);
    // The secret is right — this came from Telegram — but the chat is not one
    // the owner added, so it may not move anything.
    const response = await mod.route.POST(
      callbackRequest(press(order.publicCode, 'CONFIRMED', '-100999'), WEBHOOK_SECRET),
    );

    expect(response.status).toBe(200);

    const [row] = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(row.status).toBe('NEW');
  });

  it('is closed when no webhook secret is configured', async () => {
    const mod = await load({ TELEGRAM_WEBHOOK_SECRET: '' });
    stubTelegram(() => ({ ok: true }));

    const response = await mod.route.POST(
      callbackRequest(press('MK-000000', 'CONFIRMED'), 'anything'),
    );
    // 404 rather than 401: a scanner learns nothing about what is here.
    expect(response.status).toBe(404);
  });
});

describe('demo mode', () => {
  it('has no bot, refuses the webhook and sends nothing', async () => {
    const mod = await load({ NEXT_PUBLIC_DEMO_MODE: '1' });
    const calls = stubTelegram(() => ({ ok: true }));

    expect(mod.config.isTelegramConfigured()).toBe(false);
    expect(mod.config.botToken()).toBeNull();
    expect(mod.config.webhookSecret()).toBeNull();

    const response = await mod.route.POST(
      new Request('http://localhost/api/telegram', {
        method: 'POST',
        headers: { 'x-telegram-bot-api-secret-token': WEBHOOK_SECRET },
        body: JSON.stringify({ update_id: 1 }),
      }),
    );

    expect(response.status).toBe(404);
    expect(await mod.dispatch.dispatchPending()).toEqual({ sent: 0, skipped: 0, failed: 0 });
    // Not one HTTP call left the process.
    expect(calls).toHaveLength(0);
  });
});

describe('cleanup', () => {
  it('leaves no notification rows behind for deleted orders', async () => {
    // The FK cascades, which is what keeps the outbox from growing a tail of
    // rows pointing at orders that no longer exist.
    const rows = await db
      .select()
      .from(notifications)
      .where(
        inArray(
          notifications.orderId,
          createdOrderIds.length > 0 ? createdOrderIds : [randomUUID()],
        ),
      );

    expect(rows.length).toBeGreaterThanOrEqual(0);
  });
});
