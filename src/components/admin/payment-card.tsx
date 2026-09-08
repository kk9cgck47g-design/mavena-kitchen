'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { checkOrderPayment } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import { formatAmd } from '@/lib/money';
import type { PaymentAttemptView } from '@/server/services/payments';
import { Card } from './admin-ui';

/**
 * What happened with the money, for the person who has to answer the phone about
 * it.
 *
 * Every attempt is listed rather than only the last, because the question staff
 * actually get asked is "I paid, why does it say I did not?" — and the answer is
 * usually in the attempt before the one that worked. A single summary line would
 * hide exactly the row that explains the call.
 *
 * Two things here are more than reporting. `needsRefund` means the restaurant is
 * holding drams it is not entitled to; nothing in the software will resolve that,
 * so it is stated in full rather than shown as a status colour. And the "check"
 * button re-asks the provider on demand — the same call the sweep makes, for the
 * case where somebody is on the phone now and the schedule is minutes away.
 */

export function PaymentCard({
  orderId,
  attempts,
  awaiting,
  expiresAt,
}: {
  orderId: string;
  attempts: PaymentAttemptView[];
  /** True while the order is still holding for payment. */
  awaiting: boolean;
  expiresAt: string | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function check() {
    setError(null);
    startTransition(async () => {
      const result = await checkOrderPayment(orderId);
      if (!result.ok) {
        setError(ADMIN_TEXT.payments.checkFailed);
        return;
      }
      // The order may have moved to NEW and grown a kitchen ticket. Pull it again
      // rather than guessing which parts of this page are now stale.
      router.refresh();
    });
  }

  const needsRefund = attempts.filter((attempt) => attempt.needsRefund);

  /*
    Offered whenever an attempt could still turn out to have been paid — including
    on a cancelled order whose window closed, which is exactly when a customer
    rings to say the money left their account. Tying this button to "the order is
    still waiting" would hide it in the one case where somebody needs it.
  */
  const checkable = attempts.some(
    (attempt) => attempt.status === 'PENDING' || attempt.status === 'EXPIRED',
  );

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-bold">{ADMIN_TEXT.payments.title}</h2>

        {checkable && (
          <button
            type="button"
            disabled={pending}
            onClick={check}
            className="bg-elevated flex min-h-11 items-center gap-2 rounded-xl border border-white/8 px-4 text-sm font-semibold transition-colors hover:bg-white/8 disabled:opacity-50"
          >
            <RefreshCw className={pending ? 'size-4 animate-spin' : 'size-4'} />
            {pending ? ADMIN_TEXT.payments.checking : ADMIN_TEXT.payments.check}
          </button>
        )}
      </div>

      {needsRefund.length > 0 && (
        <p className="border-destructive/40 bg-destructive/10 text-destructive mt-3 flex items-start gap-2 rounded-xl border p-3 text-sm font-semibold">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          {ADMIN_TEXT.payments.needsRefund}
        </p>
      )}

      {awaiting && (
        <p className="text-muted-foreground mt-3 text-sm">
          {ADMIN_TEXT.payments.awaiting}
          {expiresAt && (
            <>
              {' · '}
              {ADMIN_TEXT.payments.expiresAt}{' '}
              <span className="tabular-nums">
                {new Date(expiresAt).toLocaleTimeString('ru-RU', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </>
          )}
        </p>
      )}

      {attempts.length === 0 ? (
        <p className="text-muted-foreground mt-3 text-sm">{ADMIN_TEXT.payments.none}</p>
      ) : (
        <ol className="mt-4 space-y-3">
          {attempts.map((attempt, index) => (
            <li key={attempt.id} className="border-t border-white/8 pt-3 text-sm first:border-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                <span className="font-semibold">
                  {ADMIN_TEXT.payments.attempt} {index + 1} ·{' '}
                  {ADMIN_TEXT.paymentStatus[attempt.status]}
                </span>
                <span className="tabular-nums">{formatAmd(attempt.amount, 'ru')}</span>
              </div>

              <dl className="text-muted-foreground mt-1 space-y-0.5 text-xs">
                <Line label={ADMIN_TEXT.payments.provider} value={attempt.provider} />
                {attempt.externalId && (
                  <Line label={ADMIN_TEXT.payments.reference} value={attempt.externalId} />
                )}
                {attempt.confirmedAt && (
                  <Line
                    label={ADMIN_TEXT.payments.at}
                    value={new Date(attempt.confirmedAt).toLocaleString('ru-RU', {
                      day: 'numeric',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  />
                )}
                {attempt.failureReason && (
                  <Line label={ADMIN_TEXT.payments.reason} value={attempt.failureReason} />
                )}
              </dl>
            </li>
          ))}
        </ol>
      )}

      {error && (
        <p aria-live="polite" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
    </Card>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt>{label}:</dt>
      <dd className="min-w-0 break-all">{value}</dd>
    </div>
  );
}
