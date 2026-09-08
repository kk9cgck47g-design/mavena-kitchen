'use client';

import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Clock, CreditCard, Loader2, XCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { startOrderPayment } from '@/app/[locale]/(site)/order/actions';
import { useRouter } from '@/i18n/navigation';
import { demoPaymentReference, IS_DEMO } from '@/lib/demo';
import type { OrderStatus, PaymentMethod, PaymentStatus } from '@/lib/domain';
import { paymentPresentation } from '@/lib/order-types';
import { demoPaymentFailed, useDemoPayment } from '@/stores/demo-payment';

/**
 * Everything the customer is told about the money.
 *
 * Only rendered for an online order — cash and card-on-delivery have nothing to
 * say here, and the courier's arrival is the whole story.
 *
 * The states it has to tell apart are not variations on a theme. "We are waiting
 * for you" is an instruction with a deadline and a button. "That card was
 * declined" is the same instruction with an explanation. "Your time ran out" is
 * the end of the order and needs to make clear that nothing was charged. And "we
 * have your money but cancelled your order" is the one that must not be phrased
 * as either success or failure, because what it needs from the customer is to
 * expect a phone call.
 *
 * The retry button is the only action on this screen, and it calls one server
 * action that decides for itself whether that means resuming a live attempt or
 * opening a new one. Nothing about attempts is tracked here.
 */

export function PaymentPanel({
  trackingToken,
  paymentMethod,
  paymentStatus: initialPaymentStatus,
  status,
  paymentExpiresAt,
  /** Set when the customer has just come back from a declined attempt. */
  justFailed,
}: {
  trackingToken: string;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  status: OrderStatus;
  paymentExpiresAt: string | null;
  justFailed: boolean;
}) {
  const t = useTranslations('order');
  const router = useRouter();

  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In demo mode the outcome of the fake payment page lives in this tab, so the
  // panel reads it from there instead of from a row nobody wrote.
  const demoOutcomes = useDemoPayment((s) => s.outcomes);
  const demoPaid = IS_DEMO && demoOutcomes[trackingToken] === 'PAID';
  const demoDeclined = IS_DEMO && demoPaymentFailed(demoOutcomes, trackingToken);

  const paymentStatus: PaymentStatus = demoPaid ? 'PAID' : initialPaymentStatus;
  const effectiveStatus: OrderStatus = demoPaid && status === 'AWAITING_PAYMENT' ? 'NEW' : status;

  const state = paymentPresentation({ paymentMethod, paymentStatus, status: effectiveStatus });

  if (paymentMethod !== 'ONLINE') return null;

  async function pay() {
    if (starting) return;
    setStarting(true);
    setError(null);

    /*
      The demo has no session to open, so the button goes straight to the fake
      page. The reference is derived from the tracking token — see
      `demoPaymentReference` — because a demo order has no payment row to name.
    */
    if (IS_DEMO) {
      router.push(`/pay/${demoPaymentReference(trackingToken)}`);
      return;
    }

    try {
      const response = await startOrderPayment(trackingToken);

      if (!response.ok) {
        setStarting(false);
        setError(response.code === 'WINDOW_CLOSED' ? t('payExpired') : t('payStartFailed'));
        // The window closing is a change to the order, not just to this screen.
        if (response.code === 'WINDOW_CLOSED') router.refresh();
        return;
      }

      // Off to the provider. A real one is another origin, so this cannot be the
      // router.
      window.location.assign(response.redirectUrl);
    } catch {
      setStarting(false);
      setError(t('payStartFailed'));
    }
  }

  if (state === 'PAID') {
    return (
      <Panel tone="ok" icon={<CheckCircle2 className="size-5" />} title={t('paid')}>
        <p className="text-muted-foreground mt-1 text-sm">{t('paidHint')}</p>
      </Panel>
    );
  }

  if (state === 'REFUND_DUE') {
    // Money received for an order that is not happening. Phrased as neither
    // success nor failure, because what it needs from the customer is to expect a
    // phone call.
    return (
      <Panel tone="warn" icon={<AlertCircle className="size-5" />} title={t('payRefundDue')}>
        <p className="text-muted-foreground mt-1 text-sm">{t('payRefundDueHint')}</p>
      </Panel>
    );
  }

  if (state === 'REFUNDED') {
    return (
      <Panel tone="warn" icon={<AlertCircle className="size-5" />} title={t('payRefunded')}>
        <p className="text-muted-foreground mt-1 text-sm">{t('payRefundedHint')}</p>
      </Panel>
    );
  }

  if (state === 'EXPIRED') {
    return (
      <Panel tone="bad" icon={<XCircle className="size-5" />} title={t('payExpired')}>
        <p className="text-muted-foreground mt-1 text-sm">{t('payExpiredHint')}</p>
      </Panel>
    );
  }

  // `AWAITING`: the one state with something for the customer to do.
  return (
    <Panel tone="warn" icon={<CreditCard className="size-5" />} title={t('awaitingPayment')}>
      <p className="text-muted-foreground mt-1 text-sm">{t('awaitingPaymentHint')}</p>

      {(justFailed || demoDeclined) && (
        <p aria-live="polite" className="text-destructive mt-3 text-sm font-medium">
          {t('payFailed')}
        </p>
      )}

      <Countdown expiresAt={paymentExpiresAt} label={t('payWindow')} expired={t('payExpired')} />

      <button
        type="button"
        disabled={starting}
        onClick={() => void pay()}
        className="bg-lime-500 text-primary-foreground hover:bg-lime-400 mt-4 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-colors disabled:opacity-60"
      >
        {starting && <Loader2 className="size-4 animate-spin" />}
        {starting ? t('paying') : justFailed || demoDeclined ? t('payAgain') : t('payNow')}
      </button>

      {error && (
        <p aria-live="polite" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
    </Panel>
  );
}

/**
 * How long is left, ticking.
 *
 * Rendered from the deadline the server put on the order, not from a duration
 * counted down in the browser: a phone that slept for ten minutes must come back
 * to the right number, and a tab left open must not still be promising time that
 * has gone.
 *
 * The clock here is decoration over the real rule. Nothing about what may be paid
 * is decided by it — `startPayment` checks the same deadline server-side, and the
 * sweep enforces it whether or not anybody has this page open.
 */
function Countdown({
  expiresAt,
  label,
  expired,
}: {
  expiresAt: string | null;
  label: string;
  expired: string;
}) {
  const [remaining, setRemaining] = useState<number | null>(() => secondsUntil(expiresAt));

  useEffect(() => {
    if (!expiresAt) return;

    const tick = () => setRemaining(secondsUntil(expiresAt));
    tick();

    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  if (remaining === null) return null;

  if (remaining <= 0) {
    return (
      <p aria-live="polite" className="text-destructive mt-3 flex items-center gap-2 text-sm">
        <Clock className="size-4" />
        {expired}
      </p>
    );
  }

  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;

  return (
    <p className="text-muted-foreground mt-3 flex items-center gap-2 text-sm tabular-nums">
      <Clock className="size-4" />
      {label} {minutes}:{seconds.toString().padStart(2, '0')}
    </p>
  );
}

function secondsUntil(iso: string | null): number | null {
  if (!iso) return null;
  const at = new Date(iso).getTime();
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((at - Date.now()) / 1000));
}

const TONES = {
  ok: 'border-lime-500/30 bg-lime-500/10',
  warn: 'border-amber-500/30 bg-amber-500/10',
  bad: 'border-destructive/30 bg-destructive/10',
} as const;

const ICON_TONES = {
  ok: 'text-lime-400',
  warn: 'text-amber-400',
  bad: 'text-destructive',
} as const;

function Panel({
  tone,
  icon,
  title,
  children,
}: {
  tone: keyof typeof TONES;
  icon: React.ReactNode;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <section aria-live="polite" className="mt-8">
      <div className={`flex items-start gap-3 rounded-3xl border p-5 ${TONES[tone]}`}>
        <span className={`mt-0.5 shrink-0 ${ICON_TONES[tone]}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <p className="font-bold">{title}</p>
          {children}
        </div>
      </div>
    </section>
  );
}
