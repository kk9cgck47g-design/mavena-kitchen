import { siteUrl } from '@/lib/site-url';
import { RESTAURANT } from '@/lib/restaurant';
import { getOrderView } from '@/server/services/orders';
import { getSettings } from '@/server/services/settings';
import { db } from '@/server/db/client';
import { orders } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { sendMessage } from './client';
import { isTelegramConfigured } from './config';
import { renderOrderMessage, statusButtons } from './message';
import { notificationsForOrder, pendingNotifications, recordAttempt } from './outbox';
import type { Notification } from '@/server/db/schema';

/**
 * Turning outbox rows into messages.
 *
 * Never called from inside a transaction and never awaited by anything the
 * customer is waiting on. A kitchen that cannot be reached is a fact to record,
 * not a reason to fail an order that has already been paid attention to — so
 * every path through here ends in an outbox row being updated, and none of them
 * throws.
 *
 * Redelivery falls out of that: a message that did not get through leaves a
 * `PENDING` row, and `dispatchPending` will pick it up next time it is called —
 * from the panel's retry button today, from a scheduled sweep whenever one is
 * added. Neither requires `createOrder` to change.
 */

export interface DispatchOutcome {
  sent: number;
  skipped: number;
  failed: number;
}

/**
 * Send one queued notification to every chat that has not had it yet.
 *
 * Partial success is a first-class outcome. With two screens in a kitchen, one
 * unreachable chat must not cost the other one its ticket, and a retry must not
 * shout twice at the screen that already got it — which is why `deliveries` is
 * keyed by chat id and merged rather than replaced.
 */
export async function dispatchNotification(notification: Notification): Promise<boolean> {
  if (!isTelegramConfigured()) {
    // Nothing is wrong and nothing will be retried into existence: without a
    // token there is no bot. The row stays PENDING so that configuring one
    // later and pressing retry still delivers the backlog.
    return false;
  }

  const settings = await getSettings();
  const chatIds = settings.telegramChatIds.filter((id) => id.trim().length > 0);

  if (chatIds.length === 0) {
    await recordAttempt(notification.id, {
      deliveries: notification.deliveries,
      complete: false,
      // A missing chat id is a configuration problem, not a network one.
      // Retrying on a timer would never fix it; a person has to add one.
      retryable: false,
      error: 'No Telegram chat ids configured',
    });
    return false;
  }

  const order = await loadOrder(notification.orderId);

  if (!order) {
    await recordAttempt(notification.id, {
      deliveries: notification.deliveries,
      complete: false,
      retryable: false,
      error: 'Order no longer exists',
    });
    return false;
  }

  const text = renderOrderMessage(order, `${siteUrl()}/admin/orders/${order.id}`);
  const buttons = statusButtons(order);

  const deliveries = { ...notification.deliveries };
  const errors: string[] = [];
  let retryable = false;

  for (const chatId of chatIds) {
    // Already has it. This is what makes a retry safe to run as often as
    // anyone likes.
    if (deliveries[chatId] !== undefined) continue;

    const result = await sendMessage({ chatId, text, buttons });

    if (result.ok) {
      deliveries[chatId] = result.value.message_id;
    } else {
      errors.push(`${chatId}: ${result.error}`);
      retryable ||= result.retryable;
    }
  }

  const complete = chatIds.every((chatId) => deliveries[chatId] !== undefined);

  await recordAttempt(notification.id, {
    deliveries,
    complete,
    retryable,
    error: errors.length > 0 ? errors.join('; ') : null,
  });

  return complete;
}

/**
 * Work through the backlog.
 *
 * The entry point for anything that wants to catch up: the retry button, and a
 * cron job the day one is added. Bounded per call so it cannot run for longer
 * than the platform allows.
 */
export async function dispatchPending(limit = 20): Promise<DispatchOutcome> {
  if (!isTelegramConfigured()) return { sent: 0, skipped: 0, failed: 0 };

  const queued = await pendingNotifications(limit);
  const outcome: DispatchOutcome = { sent: 0, skipped: 0, failed: 0 };

  for (const notification of queued) {
    try {
      if (await dispatchNotification(notification)) outcome.sent += 1;
      else outcome.failed += 1;
    } catch (error) {
      // The loop must survive one bad row: the next order's ticket is more
      // important than this one's stack trace.
      outcome.failed += 1;
      console.error('[telegram] dispatch failed', notification.id, error);
    }
  }

  return outcome;
}

/**
 * Send whatever is queued for one order, swallowing anything that goes wrong.
 *
 * Called at each of the moments a ticket becomes sendable, and there are now
 * three: an offline order being placed, an online order's payment being confirmed,
 * and a member of staff checking that payment by hand. All three want the same
 * behaviour — the caller does not wait on Telegram and cannot be failed by it —
 * so they share one function rather than three copies of the same try/catch.
 *
 * Anything that does not get through stays `PENDING` for the panel's retry button
 * or the sweep, which is the outbox's whole point.
 */
export async function dispatchForOrder(orderId: string): Promise<void> {
  try {
    for (const notification of await notificationsForOrder(orderId)) {
      if (notification.status === 'PENDING') await dispatchNotification(notification);
    }
  } catch (error) {
    console.error('[telegram] dispatching for order failed', orderId, error);
  }
}

/**
 * A message to prove the wiring works.
 *
 * The one thing an owner needs on the day they set this up: they have added the
 * bot to a group, pasted an id they are not sure about, and want to know
 * whether it is right before a customer's order finds out for them.
 */
export async function sendTestMessage(): Promise<{ ok: boolean; results: string[] }> {
  if (!isTelegramConfigured()) return { ok: false, results: ['Telegram is not configured'] };

  const settings = await getSettings();
  const chatIds = settings.telegramChatIds.filter((id) => id.trim().length > 0);

  if (chatIds.length === 0) return { ok: false, results: ['No chat ids configured'] };

  const results: string[] = [];
  let ok = true;

  for (const chatId of chatIds) {
    const result = await sendMessage({
      chatId,
      text: `<b>${RESTAURANT.name}</b>\nПроверка связи. Если вы это видите — уведомления о заказах будут приходить сюда.`,
    });

    if (result.ok) results.push(`${chatId}: ok`);
    else {
      ok = false;
      results.push(`${chatId}: ${result.error}`);
    }
  }

  return { ok, results };
}

/** The order, in the shape the message renderer wants. */
async function loadOrder(orderId: string) {
  const [row] = await db
    .select({ trackingToken: orders.trackingToken })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);

  return row ? getOrderView(row.trackingToken) : null;
}
