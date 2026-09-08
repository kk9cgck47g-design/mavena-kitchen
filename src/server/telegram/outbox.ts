import { and, asc, eq, inArray } from 'drizzle-orm';

import type { NotificationKind } from '@/lib/domain';
import { NOTIFICATION_MAX_ATTEMPTS } from '@/lib/domain';
import { db, type DbOrTx } from '@/server/db/client';
import { notifications } from '@/server/db/schema';
import type { Notification } from '@/server/db/schema';

/**
 * Reading and writing the outbox.
 *
 * Kept apart from the sending so that the enqueue side has no idea Telegram
 * exists — `createOrder` calls `enqueueNotification` inside its transaction and
 * is finished with the subject. Everything about delivery lives in
 * `dispatch.ts`, and a second channel later is a new dispatcher rather than a
 * change to order creation.
 */

/**
 * Record that somebody should be told about this order.
 *
 * Takes the transaction it should join, because the whole point is that the row
 * and the order commit together: an order that exists with no outbox row is an
 * order nobody will ever be told about, and there is no later moment at which
 * that can be noticed.
 *
 * `onConflictDoNothing` rather than an error: the unique index means a retry of
 * a checkout that raced past the idempotency check finds the notification
 * already queued, which is the correct outcome and not a problem.
 */
export async function enqueueNotification(
  tx: DbOrTx,
  args: { orderId: string; kind: NotificationKind },
): Promise<void> {
  await tx
    .insert(notifications)
    .values({ orderId: args.orderId, channel: 'TELEGRAM', kind: args.kind })
    .onConflictDoNothing();
}

export async function getNotification(id: string): Promise<Notification | null> {
  const [row] = await db.select().from(notifications).where(eq(notifications.id, id)).limit(1);
  return row ?? null;
}

export async function notificationsForOrder(orderId: string): Promise<Notification[]> {
  return db.select().from(notifications).where(eq(notifications.orderId, orderId));
}

/**
 * Messages still owed to somebody.
 *
 * Ordered oldest first, so a backlog is worked through in the order the
 * customers placed their orders rather than newest-first — a kitchen catching
 * up needs the one that has been waiting longest.
 */
export async function pendingNotifications(limit = 20): Promise<Notification[]> {
  return db
    .select()
    .from(notifications)
    .where(and(eq(notifications.status, 'PENDING'), eq(notifications.channel, 'TELEGRAM')))
    .orderBy(asc(notifications.createdAt))
    .limit(limit);
}

export async function recordAttempt(
  id: string,
  outcome: {
    deliveries: Record<string, number>;
    /** True when every configured chat now has it. */
    complete: boolean;
    /** True when trying again could still help. */
    retryable: boolean;
    error: string | null;
  },
): Promise<void> {
  const [current] = await db
    .select({ attempts: notifications.attempts })
    .from(notifications)
    .where(eq(notifications.id, id))
    .limit(1);

  const attempts = (current?.attempts ?? 0) + 1;

  /*
    Three outcomes, and the difference between the last two is what stops a
    dead chat id being retried forever while a flaky network still is:

      SENT    — every chat has it.
      PENDING — worth another go, and there are attempts left.
      FAILED  — either Telegram will never accept it, or we have tried enough
                times that a person should look rather than a machine.
  */
  const status = outcome.complete
    ? 'SENT'
    : outcome.retryable && attempts < NOTIFICATION_MAX_ATTEMPTS
      ? 'PENDING'
      : 'FAILED';

  await db
    .update(notifications)
    .set({
      status,
      attempts,
      deliveries: outcome.deliveries,
      lastError: outcome.error,
      updatedAt: new Date(),
    })
    .where(eq(notifications.id, id));
}

/** Put a `FAILED` message back in the queue. The panel's retry button. */
export async function requeue(ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;

  const updated = await db
    .update(notifications)
    .set({ status: 'PENDING', attempts: 0, lastError: null, updatedAt: new Date() })
    .where(inArray(notifications.id, ids))
    .returning({ id: notifications.id });

  return updated.length;
}
