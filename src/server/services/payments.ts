import { and, asc, eq, gte, inArray, isNotNull, lt, or } from 'drizzle-orm';

import { IS_DEMO } from '@/lib/demo';
import {
  LATE_PAYMENT_GRACE_HOURS,
  PAYMENT_ATTEMPT_MINUTES,
  type PaymentStatus,
} from '@/lib/domain';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { assertAmd, type Amd } from '@/lib/money';
import { siteUrl } from '@/lib/site-url';
import { db } from '@/server/db/client';
import { orders, payments } from '@/server/db/schema';
import type { Order, Payment } from '@/server/db/schema';
import { configuredProvider } from '@/server/payments/registry';
import type { PaymentOutcome } from '@/server/payments/provider';
import { enqueueNotification } from '@/server/telegram/outbox';
import { applyStatusTransition } from './orders';

/**
 * The money, from "send the customer to the bank" to "the kitchen may start".
 *
 * Two rules run through everything here, and most of the code is one of them.
 *
 * **The provider is asked, never told.** No caller of this module decides that a
 * payment succeeded. The return URL does not, the panel does not, the sweep does
 * not — each of them only says "please find out about this attempt", and
 * `confirmPayment` asks the adapter. A browser navigation is something a customer
 * can repeat, share or fabricate; it is not evidence that money moved.
 *
 * **Confirming is idempotent, at three depths.** The same attempt may be
 * confirmed by a return, a refresh of that return, a sweep running at the same
 * moment and later by a member of staff, and all of them must add up to one paid
 * order and one kitchen ticket. So: the row is locked before it is read, the
 * write is conditional on the status it was read at, and the database carries a
 * unique index that permits one paid attempt per order regardless. The last one
 * is the only one that is still true if the first two are wrong.
 */

// --- Starting and resuming -------------------------------------------------

export type StartPaymentError =
  | { code: 'DEMO_MODE' }
  | { code: 'NO_PROVIDER' }
  | { code: 'ORDER_NOT_FOUND' }
  /** The order is not waiting for money — already paid, cancelled, or cash. */
  | { code: 'NOT_PAYABLE'; paymentStatus: PaymentStatus }
  /** The window closed. Retrying is not possible; ordering again is. */
  | { code: 'WINDOW_CLOSED' }
  | { code: 'PROVIDER_FAILED' };

export type StartPaymentResult =
  | { ok: true; redirectUrl: string; paymentId: string; resumed: boolean }
  | { ok: false; error: StartPaymentError };

/**
 * Get the customer to a page where they can pay.
 *
 * Used for the first attempt and for every retry, because they are the same act:
 * "this order needs paying, where do I send them?" Whether that means resuming an
 * attempt or opening a new one is this function's business and nobody else's, and
 * keeping it that way is what makes the retry button on the tracking page a
 * single call with no state of its own.
 *
 * A live attempt is resumed rather than replaced. Replacing one would be tidier
 * to reason about and is the wrong thing to do: the customer may be looking at
 * the bank's page right now, and abandoning the session they are about to
 * complete means money arriving against an attempt we have stopped waiting on.
 * An attempt is only superseded once it is settled or past its own expiry.
 */
export async function startPayment(
  orderId: string,
  locale: Locale = 'hy',
): Promise<StartPaymentResult> {
  // The preview has no database to record an attempt in and no business opening
  // one. Refused here as well as in the registry, so a caller that somehow holds
  // a provider still cannot start anything.
  if (IS_DEMO) return { ok: false, error: { code: 'DEMO_MODE' } };

  const provider = configuredProvider();
  if (!provider) return { ok: false, error: { code: 'NO_PROVIDER' } };

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId)).limit(1);
  if (!order) return { ok: false, error: { code: 'ORDER_NOT_FOUND' } };

  if (order.paymentMethod !== 'ONLINE' || order.status !== 'AWAITING_PAYMENT') {
    return { ok: false, error: { code: 'NOT_PAYABLE', paymentStatus: order.paymentStatus } };
  }

  // Checked against the order's own deadline, not against the attempt's. A new
  // attempt started a minute before the sweep cancels the order would send
  // somebody to pay for an order about to be withdrawn.
  if (order.paymentExpiresAt && order.paymentExpiresAt.getTime() <= Date.now()) {
    return { ok: false, error: { code: 'WINDOW_CLOSED' } };
  }

  const live = await livePayment(order.id);
  if (live?.redirectUrl) {
    return { ok: true, redirectUrl: live.redirectUrl, paymentId: live.id, resumed: true };
  }

  /*
    The row comes first, and it comes before the provider is called.

    That ordering is the whole reason an abandoned payment is recoverable. If the
    session were opened first and the row written afterwards, a crash between the
    two would leave an attempt live at the provider that nothing here knows about
    — payable by the customer, invisible to every sweep, and reconcilable only by
    someone reading a bank statement. A row with no session is the harmless
    failure of the two: nothing can be paid against it, and it expires unnoticed.

    `payments_one_pending_per_order` makes the insert the point where a race is
    settled. Two tabs pressing "pay" at once produce one `PENDING` row and one
    unique violation, and the loser resumes what the winner created.
  */
  assertAmd(order.total, 'order total');

  let attempt: Payment;
  try {
    const [inserted] = await db
      .insert(payments)
      .values({
        orderId: order.id,
        provider: provider.name,
        amount: order.total,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + PAYMENT_ATTEMPT_MINUTES * 60_000),
      })
      .returning();
    attempt = inserted;
  } catch (error) {
    // Somebody else won the insert. Their attempt is the live one; use it.
    const raced = await livePayment(order.id);
    if (raced?.redirectUrl) {
      return { ok: true, redirectUrl: raced.redirectUrl, paymentId: raced.id, resumed: true };
    }
    throw error;
  }

  try {
    const session = await provider.createSession({
      reference: attempt.id,
      publicCode: order.publicCode,
      amount: order.total,
      returnUrl: paymentReturnUrl(attempt.id, locale),
      locale,
    });

    const [updated] = await db
      .update(payments)
      .set({
        externalId: session.externalId,
        redirectUrl: session.redirectUrl,
        raw: session.raw ?? null,
        updatedAt: new Date(),
      })
      .where(eq(payments.id, attempt.id))
      .returning();

    return { ok: true, redirectUrl: updated.redirectUrl!, paymentId: updated.id, resumed: false };
  } catch (error) {
    console.error('[payments] opening a session failed', error);

    /*
      The attempt is retired rather than left `PENDING`, and `FAILED` is the
      honest status: we know it never became payable, because it never got an
      external id. Leaving it pending would block the customer's next attempt on
      the one-pending-per-order index until it expired, which is fifteen minutes
      of a working payment method looking broken.
    */
    await db
      .update(payments)
      .set({
        status: 'FAILED',
        failureReason: 'Could not open a session with the provider',
        updatedAt: new Date(),
      })
      // Strictly the attempt we just created, which is `PENDING` by construction.
      // Nothing expired belongs in this path.
      .where(and(eq(payments.id, attempt.id), eq(payments.status, 'PENDING')));

    return { ok: false, error: { code: 'PROVIDER_FAILED' } };
  }
}

/**
 * The attempt a customer could still be paying, if there is one.
 *
 * Pending, given a session by the provider, and not past its own expiry. Anything
 * else may be superseded.
 */
async function livePayment(orderId: string): Promise<Payment | null> {
  const [row] = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, orderId), eq(payments.status, 'PENDING')))
    .orderBy(asc(payments.createdAt))
    .limit(1);

  if (!row) return null;
  if (!row.externalId || !row.redirectUrl) return null;
  if (row.expiresAt && row.expiresAt.getTime() <= Date.now()) return null;

  return row;
}

/**
 * Where the provider sends the customer back to.
 *
 * The locale is ours, put there by us at the moment the session was created, so
 * the customer lands back in the language they were shopping in. A provider that
 * mangles it costs a wrong translation and nothing else — nothing is authorised
 * by this URL, and the handler behind it re-reads the attempt and re-asks the
 * provider rather than believing any part of what arrives.
 */
function paymentReturnUrl(paymentId: string, locale: Locale): string {
  return `${siteUrl()}/api/payments/return/${paymentId}?lang=${locale}`;
}

// --- Confirming ------------------------------------------------------------

/**
 * The attempt statuses a confirmation may still act on.
 *
 * `EXPIRED` belongs here and it is the whole reason this constant exists. Expiry
 * is our patience running out, not the provider's answer, so an expired attempt
 * can still turn out to have been paid — and the conditional writes below have to
 * accept it or the late payment is discovered and then silently dropped, which is
 * worse than never having looked.
 */
const OPEN_ATTEMPT_STATUSES = ['PENDING', 'EXPIRED'] as const;

export type ConfirmOutcome =
  /** Money received and the order is now the kitchen's. */
  | { code: 'PAID'; orderId: string; trackingToken: string }
  /** Money received, and it was already recorded. Nothing changed this time. */
  | { code: 'ALREADY_PAID'; orderId: string; trackingToken: string }
  /** The provider says no. The customer may try again while the window is open. */
  | { code: 'FAILED'; orderId: string; trackingToken: string; reason: string | null }
  /** The provider is still waiting for the customer. */
  | { code: 'PENDING'; orderId: string; trackingToken: string }
  /**
   * Money arrived for an order we had already given up on, or for an amount we
   * did not ask for. Recorded, flagged, and left for a person.
   */
  | { code: 'NEEDS_REFUND'; orderId: string; trackingToken: string; reason: string }
  | { code: 'NOT_FOUND' }
  | { code: 'NO_PROVIDER' };

/**
 * Find out what happened to one attempt, and make the order agree with it.
 *
 * Every route into this system funnels here: the customer returning, that return
 * being refreshed, the sweep, a member of staff pressing "check". The function is
 * therefore written to be called at any time, in any order, concurrently with
 * itself, without a caller having to know whether somebody else got there first.
 */
export async function confirmPayment(paymentId: string): Promise<ConfirmOutcome> {
  if (IS_DEMO) return { code: 'NOT_FOUND' };

  const provider = configuredProvider();
  if (!provider) return { code: 'NO_PROVIDER' };

  const [attempt] = await db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
  if (!attempt || attempt.provider !== provider.name) return { code: 'NOT_FOUND' };

  const [order] = await db.select().from(orders).where(eq(orders.id, attempt.orderId)).limit(1);
  if (!order) return { code: 'NOT_FOUND' };

  // Settled attempts are not re-asked about. A paid one has nothing to gain from
  // another round trip, and a failed one would be re-decided by a provider that
  // has since forgotten it.
  if (attempt.status === 'PAID') {
    return { code: 'ALREADY_PAID', orderId: order.id, trackingToken: order.trackingToken };
  }
  if (attempt.status === 'FAILED' || attempt.status === 'REFUNDED') {
    return {
      code: 'FAILED',
      orderId: order.id,
      trackingToken: order.trackingToken,
      reason: attempt.failureReason,
    };
  }
  if (!attempt.externalId) {
    // Never got a session, so there is nothing the provider could know about it.
    return { code: 'PENDING', orderId: order.id, trackingToken: order.trackingToken };
  }

  /*
    Asked outside the transaction, deliberately.

    An HTTP call to somebody else's server inside a transaction holds a database
    connection open for as long as they feel like taking, and under a sweep that
    is several of them at once. The answer is then applied under a lock that
    re-reads everything, so nothing is decided on the strength of a row read
    before the round trip.
  */
  let outcome: PaymentOutcome;
  try {
    outcome = await provider.fetchStatus(attempt.externalId);
  } catch (error) {
    console.error('[payments] asking the provider failed', error);
    return { code: 'PENDING', orderId: order.id, trackingToken: order.trackingToken };
  }

  if (outcome.state === 'PENDING') {
    return { code: 'PENDING', orderId: order.id, trackingToken: order.trackingToken };
  }

  /*
    The provider has no record of an attempt we opened. Not retried and not
    treated as a failure: it is a disagreement about reality between us and them,
    and the two readings — a session that never took, or one whose reference we
    have lost — are told apart by a person with access to both sides.
  */
  if (outcome.state === 'UNKNOWN') {
    console.error(
      `[payments] provider does not recognise attempt ${attempt.id} (${attempt.externalId})`,
    );
    return { code: 'PENDING', orderId: order.id, trackingToken: order.trackingToken };
  }

  if (outcome.state === 'FAILED') {
    return recordFailure(attempt.id, order, outcome.reason, outcome.raw);
  }

  return recordPayment(attempt.id, order.id, outcome.amount, outcome.raw);
}

async function recordFailure(
  paymentId: string,
  order: Order,
  reason: string | null,
  raw: unknown,
): Promise<ConfirmOutcome> {
  /*
    The attempt fails; the order does not.

    A declined card is not an abandoned order — it is a customer about to try a
    different one — so the order stays `AWAITING_PAYMENT` with its window running
    and `paymentStatus` stays `PENDING`. Cancelling here would take the decision
    away from the person still holding their wallet, and would do it on the
    evidence of one refusal.
  */
  await db
    .update(payments)
    .set({
      status: 'FAILED',
      failureReason: reason,
      raw: raw ?? null,
      updatedAt: new Date(),
    })
    .where(and(eq(payments.id, paymentId), eq(payments.status, 'PENDING')));

  return { code: 'FAILED', orderId: order.id, trackingToken: order.trackingToken, reason };
}

/**
 * Money arrived. Decide what that means for the order, and commit all of it at
 * once.
 */
async function recordPayment(
  paymentId: string,
  orderId: string,
  paidAmount: Amd,
  raw: unknown,
): Promise<ConfirmOutcome> {
  return db.transaction(async (tx) => {
    // Locked in a fixed order — payment, then order — because the sweep and a
    // return can arrive together, and two transactions taking the same two rows
    // in opposite orders is a deadlock waiting for a busy evening.
    const [attempt] = await tx
      .select()
      .from(payments)
      .where(eq(payments.id, paymentId))
      .for('update')
      .limit(1);

    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
      .limit(1);

    if (!attempt || !order) return { code: 'NOT_FOUND' } as const;

    // Somebody else confirmed it while we were asking the provider. Theirs stands.
    if (attempt.status === 'PAID') {
      return {
        code: 'ALREADY_PAID',
        orderId: order.id,
        trackingToken: order.trackingToken,
      } as const;
    }

    /*
      The amount check, and it is a refusal rather than an adjustment.

      What arrived is compared against what this attempt asked for — not against
      the order's total, which could have been recomputed by anything in between.
      A mismatch means the money that moved is not the money we quoted, and there
      is no version of "close enough" that is safe: charging less than the order
      is a discount nobody authorised, and charging more is a customer owed a
      refund. Neither is a decision for code, so the order is left unpaid and the
      attempt is flagged for a person.
    */
    if (paidAmount !== attempt.amount) {
      await tx
        .update(payments)
        .set({
          status: 'FAILED',
          failureReason: `Amount mismatch: asked for ${attempt.amount}, provider reports ${paidAmount}`,
          needsRefund: true,
          raw: raw ?? null,
          updatedAt: new Date(),
        })
        .where(eq(payments.id, attempt.id));

      console.error(
        `[payments] amount mismatch on attempt ${attempt.id}: expected ${attempt.amount}, got ${paidAmount}`,
      );

      return {
        code: 'NEEDS_REFUND',
        orderId: order.id,
        trackingToken: order.trackingToken,
        reason: 'AMOUNT_MISMATCH',
      } as const;
    }

    const paidAt = new Date();

    /*
      Late payment: the money is real, the order is not there to receive it.

      The window closed, the sweep cancelled the order, and the provider settled
      afterwards — which happens, because a customer who takes twenty minutes over
      a 3-D Secure code has no idea a clock was running. The payment is recorded
      as `PAID`, because it is, and the order is left cancelled: reviving it would
      put a ticket in front of a kitchen half an hour after the customer gave up,
      and food arriving for someone who has eaten is worse than a refund. Flagged
      for a person, who calls and either re-takes the order or gives the money
      back.

      Not reachable through `applyStatusTransition`, and that is the point —
      `CANCELLED` is terminal there, so this is not a transition at all. Only
      `paymentStatus` moves.
    */
    if (order.status === 'CANCELLED') {
      await tx
        .update(payments)
        .set({
          status: 'PAID',
          confirmedAt: paidAt,
          needsRefund: true,
          raw: raw ?? null,
          updatedAt: paidAt,
        })
        .where(and(eq(payments.id, attempt.id), inArray(payments.status, OPEN_ATTEMPT_STATUSES)));

      await tx
        .update(orders)
        .set({ paymentStatus: 'PAID', updatedAt: paidAt })
        .where(eq(orders.id, order.id));

      console.error(
        `[payments] late payment on cancelled order ${order.publicCode} — refund needed`,
      );

      return {
        code: 'NEEDS_REFUND',
        orderId: order.id,
        trackingToken: order.trackingToken,
        reason: 'LATE_PAYMENT',
      } as const;
    }

    /*
      An order that is neither awaiting payment nor cancelled, being paid.

      Should not happen: only `AWAITING_PAYMENT` orders have live attempts, and
      the only way out of it is here. Recorded rather than thrown, because the
      money is real either way and a thrown error would lose the fact of it.
    */
    if (order.status !== 'AWAITING_PAYMENT') {
      await tx
        .update(payments)
        .set({ status: 'PAID', confirmedAt: paidAt, raw: raw ?? null, updatedAt: paidAt })
        .where(and(eq(payments.id, attempt.id), inArray(payments.status, OPEN_ATTEMPT_STATUSES)));

      await tx
        .update(orders)
        .set({ paymentStatus: 'PAID', paymentExpiresAt: null, updatedAt: paidAt })
        .where(eq(orders.id, order.id));

      return {
        code: 'PAID',
        orderId: order.id,
        trackingToken: order.trackingToken,
      } as const;
    }

    // Conditional on the status it was read at. Belt to the lock's braces, and
    // the thing that makes a concurrent confirmation a no-op rather than a second
    // capture.
    const [paid] = await tx
      .update(payments)
      .set({ status: 'PAID', confirmedAt: paidAt, raw: raw ?? null, updatedAt: paidAt })
      .where(and(eq(payments.id, attempt.id), inArray(payments.status, OPEN_ATTEMPT_STATUSES)))
      .returning();

    if (!paid) {
      return {
        code: 'ALREADY_PAID',
        orderId: order.id,
        trackingToken: order.trackingToken,
      } as const;
    }

    const moved = await applyStatusTransition(tx, {
      orderId: order.id,
      to: 'NEW',
      source: 'PAYMENT',
      note: 'Оплата подтверждена',
    });

    if (!moved.ok) {
      // The state machine refused, so the order is not the kitchen's and must not
      // be announced as if it were. Rolling back is the only honest answer: it
      // undoes the `PAID` write above too, leaving the attempt pending and
      // re-askable, rather than committing a paid order stuck outside the flow.
      throw new Error(
        `Paid order ${order.publicCode} could not be moved to NEW (${moved.ok === false ? moved.code : ''})`,
      );
    }

    await tx
      .update(orders)
      .set({
        paymentStatus: 'PAID',
        // Nothing left to count down to, and it stops the sweep from ever looking
        // at this order again.
        paymentExpiresAt: null,
        updatedAt: paidAt,
      })
      .where(eq(orders.id, order.id));

    /*
      The kitchen is told here, and only here, for an online order.

      Same transaction as the payment and the status change, so the three commit
      together or not at all — the outbox rule the rest of the system already
      keeps, applied at the moment that matters for an order paid in advance. The
      unique index on `(orderId, channel, kind)` makes a second confirmation
      unable to queue a second ticket even if it got this far.
    */
    await enqueueNotification(tx, { orderId: order.id, kind: 'NEW_ORDER' });

    return { code: 'PAID', orderId: order.id, trackingToken: order.trackingToken } as const;
  });
}

// --- The sweep -------------------------------------------------------------

export interface SweepResult {
  /** Attempts we asked the provider about. */
  reconciled: number;
  /** Of those, the ones that turned out to be paid. */
  paid: number;
  /** Orders whose window closed with no money. */
  expired: number;
  /** Payments that arrived too late or in the wrong amount. Somebody must look. */
  needsRefund: number;
}

/**
 * The unattended half of the whole design.
 *
 * Two jobs, in this order, and the order is the point.
 *
 * First, ask about every attempt still pending. This is what recovers the
 * customer who paid and closed the tab before the return could fire — the one
 * case in this system where doing nothing loses somebody's money. Nothing else
 * in the flow covers it: there is no return to handle and, for a provider without
 * callbacks, nothing arrives unprompted.
 *
 * Then expire what is genuinely unpaid. Only after the asking, so an order is
 * never cancelled a second before its payment is discovered — which would create
 * the late-payment case out of an order that had in fact been paid on time.
 */
export async function sweepPayments(limit = 25): Promise<SweepResult> {
  const result: SweepResult = { reconciled: 0, paid: 0, expired: 0, needsRefund: 0 };

  if (IS_DEMO || !configuredProvider()) return result;

  for (const id of await pendingPaymentIds(limit)) {
    const outcome = await confirmPayment(id);
    result.reconciled += 1;

    if (outcome.code === 'PAID' || outcome.code === 'ALREADY_PAID') result.paid += 1;
    if (outcome.code === 'NEEDS_REFUND') result.needsRefund += 1;
  }

  result.expired = await expireUnpaidOrders(limit);

  return result;
}

/**
 * Attempts worth asking about, oldest first.
 *
 * Two kinds, and the second is easy to leave out and expensive to leave out.
 *
 * `PENDING` is the obvious one: a customer may still be paying, or may have paid
 * and closed the tab.
 *
 * `EXPIRED` is the one that matters. Expiry is our patience running out, not the
 * provider's answer, so a settlement can still arrive after we have cancelled the
 * order — and once an attempt leaves `PENDING` nothing else in the system ever
 * asks about it again. Without this clause a late payment is money kept in silence
 * until the customer telephones, which is precisely the outcome the sweep exists
 * to prevent. Kept for `LATE_PAYMENT_GRACE_HOURS` and then dropped, so the queue
 * does not grow by every abandoned checkout forever.
 */
async function pendingPaymentIds(limit: number): Promise<string[]> {
  const graceCutoff = new Date(Date.now() - LATE_PAYMENT_GRACE_HOURS * 60 * 60 * 1000);

  const rows = await db
    .select({ id: payments.id })
    .from(payments)
    .where(
      and(
        isNotNull(payments.externalId),
        or(
          eq(payments.status, 'PENDING'),
          and(eq(payments.status, 'EXPIRED'), gte(payments.updatedAt, graceCutoff)),
        ),
      ),
    )
    .orderBy(asc(payments.createdAt))
    .limit(limit);

  return rows.map((row) => row.id);
}

/**
 * Cancel the online orders whose window has closed with nothing paid.
 *
 * Each order is handled in its own transaction rather than the batch sharing one:
 * a single order that cannot be cancelled — because a payment landed for it
 * between the query and the lock — must not take the rest of the sweep with it.
 */
export async function expireUnpaidOrders(limit = 25): Promise<number> {
  const stale = await db
    .select({ id: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'AWAITING_PAYMENT'),
        isNotNull(orders.paymentExpiresAt),
        lt(orders.paymentExpiresAt, new Date()),
      ),
    )
    .orderBy(asc(orders.paymentExpiresAt))
    .limit(limit);

  let expired = 0;

  for (const { id } of stale) {
    try {
      if (await expireOrder(id)) expired += 1;
    } catch (error) {
      console.error(`[payments] could not expire order ${id}`, error);
    }
  }

  return expired;
}

async function expireOrder(orderId: string): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, orderId))
      .for('update')
      .limit(1);

    // Re-checked under the lock. A payment confirmed between the query above and
    // this moment has already moved the order to `NEW`, and cancelling a paid
    // order is the one mistake this whole sweep exists to avoid.
    if (!order || order.status !== 'AWAITING_PAYMENT') return false;
    if (order.paymentStatus === 'PAID') return false;
    if (order.paymentExpiresAt && order.paymentExpiresAt.getTime() > Date.now()) return false;

    const moved = await applyStatusTransition(tx, {
      orderId,
      to: 'CANCELLED',
      source: 'SYSTEM',
      // English, and for the audit trail rather than for anybody's screen. A sweep
      // has no locale to translate into, so the customer-facing sentence is
      // derived from `paymentStatus` instead — see `paymentPresentation`.
      note: 'Payment window closed with no payment received',
    });

    if (!moved.ok) return false;

    await tx
      .update(orders)
      .set({
        paymentStatus: 'EXPIRED',
        paymentExpiresAt: null,
        /*
          Cleared, having just been set by the transition above.

          `cancelReason` is rendered to the customer verbatim, and this reason was
          written in English by a scheduled job. The order event keeps it, which is
          where staff-facing detail belongs; the screens work out "cancelled
          because the payment window closed" from `status` and `paymentStatus`
          together, in the reader's own language.
        */
        cancelReason: null,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, orderId));

    /*
      The attempts go to `EXPIRED`, not `FAILED`, and the distinction is what
      makes a late payment recognisable as one: `FAILED` says the provider
      refused, `EXPIRED` says we stopped waiting. Only the second can still be
      settled, and `confirmPayment` treats them differently for exactly that
      reason.
    */
    await tx
      .update(payments)
      .set({ status: 'EXPIRED', updatedAt: new Date() })
      .where(and(eq(payments.orderId, orderId), eq(payments.status, 'PENDING')));

    return true;
  });
}

// --- Reads -----------------------------------------------------------------

export interface PaymentAttemptView {
  id: string;
  provider: string;
  externalId: string | null;
  amount: Amd;
  status: PaymentStatus;
  failureReason: string | null;
  needsRefund: boolean;
  createdAt: string;
  confirmedAt: string | null;
}

/** Every attempt on an order, newest first. For the panel. */
export async function paymentsForOrder(orderId: string): Promise<PaymentAttemptView[]> {
  if (IS_DEMO) return [];

  const rows = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, orderId))
    .orderBy(asc(payments.createdAt));

  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    externalId: row.externalId,
    amount: row.amount,
    status: row.status,
    failureReason: row.failureReason,
    needsRefund: row.needsRefund,
    createdAt: row.createdAt.toISOString(),
    confirmedAt: row.confirmedAt?.toISOString() ?? null,
  }));
}

/**
 * Which order an attempt belongs to, without asking the provider anything.
 *
 * For the return handler when it is rate limited: it still has to put the
 * customer back on their own order page, and doing that needs a token but not a
 * round trip to the gateway. Nothing is lost by skipping the reconciliation —
 * the sweep asks about every pending attempt anyway.
 */
export async function orderForPayment(
  paymentId: string,
): Promise<{ orderId: string; trackingToken: string } | null> {
  if (IS_DEMO) return null;

  const [row] = await db
    .select({ orderId: orders.id, trackingToken: orders.trackingToken })
    .from(payments)
    .innerJoin(orders, eq(payments.orderId, orders.id))
    .where(eq(payments.id, paymentId))
    .limit(1);

  return row ?? null;
}

/**
 * The attempt a return handler or a retry should be acting on.
 *
 * Exported for the tracking page's retry, which knows a tracking token and
 * nothing else.
 */
export async function orderIdByTrackingToken(token: string): Promise<string | null> {
  const [row] = await db
    .select({ id: orders.id })
    .from(orders)
    .where(eq(orders.trackingToken, token))
    .limit(1);

  return row?.id ?? null;
}

/**
 * The locale to hand back to a returning customer.
 *
 * Lives here because both the return route and the retry action need it and
 * neither should be guessing. An unrecognised value falls back to Armenian rather
 * than failing: the worst case is a page in the wrong language, and refusing to
 * render the order over it would be the greater harm.
 */
export function paymentLocale(raw: string | null | undefined): Locale {
  return raw && isLocale(raw) ? raw : 'hy';
}
