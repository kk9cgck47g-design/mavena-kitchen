'use client';

import { useEffect, useState } from 'react';
import { Check, Clock, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { pollOrderStatus, type OrderStatusSnapshot } from '@/app/[locale]/(site)/order/actions';
import { IS_DEMO } from '@/lib/demo';
import type { OrderStatus, OrderType } from '@/lib/domain';
import { isTerminal, statusSteps, statusStepIndex } from '@/lib/order-types';
import { cn } from '@/lib/utils';
import { demoStatusOf, useDemoAdmin } from '@/stores/demo-admin';
import { useDemoPayment } from '@/stores/demo-payment';

/**
 * The part of the tracking screen that moves.
 *
 * How it stays current, and why it is not a socket: the question "has this
 * order changed?" is asked by one customer, about one row, for the twenty
 * minutes their food is being made. A poll every ten seconds is roughly a
 * hundred queries of four columns over the life of an order — nothing next to a
 * connection held open per customer, on a platform where holding connections
 * open is the expensive thing. It also survives a phone locking, a tunnel and a
 * switch from wifi to mobile data without a reconnection strategy, because
 * there is nothing to reconnect.
 *
 * Three things keep even that modest cost honest:
 *
 *   - Polling stops the moment the order reaches a terminal state. A delivered
 *     order is never going to change again.
 *   - It pauses while the tab is hidden, and asks once immediately on return,
 *     so a phone in a pocket is not making requests.
 *   - The answer is four fields, not the order.
 *
 * In demo mode there is nothing to poll. The status comes from the same
 * session-local store the demo admin panel writes to, so an owner can move an
 * order in one tab and watch this screen follow in another — which is the point
 * of the demonstration, and still writes to no database anywhere.
 */

const POLL_MS = 10_000;

export function OrderTracker({
  token,
  type,
  initial,
  demoOrderId,
}: {
  token: string;
  type: OrderType;
  initial: OrderStatusSnapshot;
  /** Only set in demo mode, where the status is read from the session store. */
  demoOrderId: string | null;
}) {
  const t = useTranslations('order');
  const ts = useTranslations('orderStatus');

  const [snapshot, setSnapshot] = useState(initial);

  const demoChanges = useDemoAdmin((s) => s.changes);
  const demoStatus =
    IS_DEMO && demoOrderId ? demoStatusOf(demoChanges, demoOrderId, initial.status) : null;

  /*
    The demo's fake payment, layered the same way the demo panel's status changes
    are. An order that started at `AWAITING_PAYMENT` and was paid on the fake page
    becomes `NEW` here, so the progress bar appears at the moment it would in
    production — which is the thing the demo exists to show.
  */
  const demoPaid = useDemoPayment((s) => s.outcomes)[token] === 'PAID';

  const reported: OrderStatus = demoStatus ?? snapshot.status;
  const status: OrderStatus =
    IS_DEMO && demoPaid && reported === 'AWAITING_PAYMENT' ? 'NEW' : reported;
  const done = isTerminal(status);

  useEffect(() => {
    // Demo has no server to ask, and a finished order has nothing left to say.
    if (IS_DEMO || isTerminal(initial.status)) return;

    let cancelled = false;
    let timer: number | undefined;
    /** The loop's own view of where the order stands. Never read during render. */
    let current: OrderStatus = initial.status;

    const schedule = () => {
      if (cancelled || document.hidden) return;
      timer = window.setTimeout(() => void ask(), POLL_MS);
    };

    const ask = async () => {
      if (cancelled) return;

      const next = await pollOrderStatus(token);

      if (cancelled) return;
      // No answer is not the same as no order: keep what is on screen and try
      // again rather than reporting a problem the customer cannot act on.
      if (!next) return schedule();

      setSnapshot(next);
      current = next.status;

      // Nothing more will ever happen to it.
      if (isTerminal(current)) return;
      schedule();
    };

    // A tab returning to the foreground should not wait out the interval before
    // catching up — that is exactly the moment the customer is looking at it.
    const onVisibility = () => {
      if (document.hidden) {
        window.clearTimeout(timer);
        return;
      }
      if (!isTerminal(current)) void ask();
    };

    schedule();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [token, initial.status]);

  /*
    Nothing to track yet.

    An unpaid order has made no progress and will make none until it is paid, so
    the bar is not drawn at all — `PaymentPanel` above it is the whole story, and
    six greyed-out steps under it would read as "your food is on its way, step one
    of six". The effect above keeps polling regardless, which is what flips this
    screen over when the money is confirmed by a sweep rather than by the customer
    coming back.

    After the hooks, not before: an early return above them would change how many
    hooks this component calls between renders.
  */
  if (status === 'AWAITING_PAYMENT') return null;

  /*
    Cancelled because the payment window closed, which `PaymentPanel` has already
    said — in the customer's language and with the one thing they want to know,
    that nothing was charged. Two panels explaining the same cancellation is worse
    than one.

    A cancelled order that *was* paid is not skipped: there the panel talks about
    the money owed back and this block still has something of its own to say.
  */
  if (status === 'CANCELLED' && snapshot.paymentStatus === 'EXPIRED') return null;

  if (status === 'CANCELLED') {
    return (
      <section aria-live="polite" className="mt-8">
        <div className="border-destructive/30 bg-destructive/10 flex items-start gap-3 rounded-3xl border p-5">
          <XCircle className="text-destructive mt-0.5 size-5 shrink-0" />
          <div className="min-w-0">
            <p className="text-destructive font-bold">{ts('CANCELLED')}</p>
            <p className="text-muted-foreground mt-1 text-sm">
              {snapshot.cancelReason ?? t('cancelledHint')}
            </p>
          </div>
        </div>
      </section>
    );
  }

  const steps = statusSteps(type);
  const reached = statusStepIndex(status, type);

  return (
    // `aria-live` on the whole block: the status arriving without a page load is
    // the one thing on this screen a customer must not have to notice visually.
    <section aria-live="polite" className="mt-8">
      <div className="bg-card rounded-3xl border border-white/6 p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span
            className={cn(
              'rounded-full px-3 py-1.5 text-xs font-bold',
              done ? 'bg-lime-500 text-primary-foreground' : 'bg-lime-500/15 text-lime-400',
            )}
          >
            {ts(status)}
          </span>

          {!done && (
            <span className="text-muted-foreground flex items-center gap-2 text-sm tabular-nums">
              <Clock className="size-4" />
              {t('eta', { minutes: snapshot.etaMinutes })}
            </span>
          )}
        </div>

        {/* An ordered list, not a row of divs: this is a sequence, and a screen
            reader should be able to say which of how many. */}
        <ol className="mt-6 space-y-4">
          {steps.map((step, index) => {
            const passed = index < reached;
            const current = index === reached;

            return (
              <li key={step} className="flex items-center gap-3">
                <span
                  aria-hidden
                  className={cn(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-bold',
                    passed && 'border-lime-500/40 bg-lime-500/15 text-lime-400',
                    current && 'border-lime-500 bg-lime-500 text-primary-foreground',
                    !passed && !current && 'border-white/12 text-muted-foreground',
                  )}
                >
                  {passed ? <Check className="size-3.5" strokeWidth={3} /> : index + 1}
                </span>

                <span
                  className={cn(
                    'text-sm',
                    /*
                      A step that has not happened yet used to be dimmed further,
                      to 60% of the muted foreground — 3.29:1, under AA for body
                      text. The dimming was never what said "not yet" anyway:
                      the marker beside it does, with a number instead of a tick
                      and a neutral border instead of lime, and the current step
                      is the bold one. Removing the extra fade loses nothing a
                      reader was using and stops the labels being the least
                      legible text on a page people open to read one thing.
                    */
                    current ? 'font-semibold' : 'text-muted-foreground',
                  )}
                >
                  {ts(step)}
                </span>

                {current && (
                  <span className="sr-only">
                    {t('currentStep', { step: index + 1, total: steps.length })}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
