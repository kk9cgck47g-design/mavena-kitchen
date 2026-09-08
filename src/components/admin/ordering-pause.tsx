'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { PauseCircle, PlayCircle } from 'lucide-react';

import { setOrderingPaused } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import { cn } from '@/lib/utils';
import { Card } from './admin-ui';

/**
 * The one control on this screen that changes what customers can do.
 *
 * Two things about how it behaves are deliberate.
 *
 * It does not flip optimistically. Every other toggle in this panel does — the
 * stop list is tapped by somebody holding a pan, and waiting for a round trip
 * gets it tapped twice — but this one decides whether the business is trading,
 * and a switch that shows "paused" before the server agrees is a switch an owner
 * walks away from believing something that is not true.
 *
 * And pausing asks first. Resuming does not: the risk is asymmetric, since
 * stopping the shop by accident costs orders and starting it by accident costs a
 * moment.
 */
export function OrderingPause({
  isAcceptingOrders,
  readOnly,
}: {
  isAcceptingOrders: boolean;
  readOnly: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function apply(next: boolean) {
    setError(null);

    startTransition(async () => {
      const result = await setOrderingPaused({ isAcceptingOrders: next });

      if (!result.ok) {
        setError(
          result.code === 'DEMO_MODE'
            ? ADMIN_TEXT.pause.demoBlocked
            : ADMIN_TEXT.pause.failed,
        );
        return;
      }

      setConfirming(false);
      // The dashboard counts and the storefront both change with this.
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-bold">
            {isAcceptingOrders ? (
              <PlayCircle className="text-lime-400 size-4" />
            ) : (
              <PauseCircle className="size-4 text-amber-400" />
            )}
            {ADMIN_TEXT.pause.title}
          </h2>

          <p
            aria-live="polite"
            className={cn(
              'mt-1 text-sm font-semibold',
              isAcceptingOrders ? 'text-lime-400' : 'text-amber-400',
            )}
          >
            {isAcceptingOrders ? ADMIN_TEXT.pause.accepting : ADMIN_TEXT.pause.paused}
          </p>

          <p className="text-muted-foreground mt-2 text-sm leading-relaxed">
            {isAcceptingOrders ? ADMIN_TEXT.pause.acceptingHint : ADMIN_TEXT.pause.pausedHint}
          </p>
        </div>

        {!readOnly && (
          <button
            type="button"
            disabled={pending}
            onClick={() => (isAcceptingOrders ? setConfirming(true) : apply(true))}
            className={cn(
              'flex min-h-11 shrink-0 items-center rounded-xl px-4 text-sm font-bold transition-colors disabled:opacity-50',
              isAcceptingOrders
                ? 'border-destructive/40 text-destructive hover:bg-destructive/10 border'
                : 'bg-lime-500 text-primary-foreground hover:bg-lime-400',
            )}
          >
            {pending
              ? ADMIN_TEXT.pause.saving
              : isAcceptingOrders
                ? ADMIN_TEXT.pause.pause
                : ADMIN_TEXT.pause.resume}
          </button>
        )}
      </div>

      {confirming && (
        <div className="border-destructive/40 bg-destructive/10 mt-4 rounded-xl border p-4">
          <p className="text-sm leading-relaxed">{ADMIN_TEXT.pause.confirm}</p>

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={pending}
              onClick={() => apply(false)}
              className="bg-destructive/12 text-destructive border-destructive/40 flex min-h-11 items-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50"
            >
              {pending ? ADMIN_TEXT.pause.saving : ADMIN_TEXT.pause.confirmPause}
            </button>

            <button
              type="button"
              disabled={pending}
              onClick={() => setConfirming(false)}
              className="bg-elevated flex min-h-11 items-center rounded-xl border border-white/8 px-4 text-sm font-semibold hover:bg-white/8 disabled:opacity-50"
            >
              {ADMIN_TEXT.pause.cancel}
            </button>
          </div>
        </div>
      )}

      {error && (
        <p aria-live="polite" className="text-destructive mt-3 text-sm">
          {error}
        </p>
      )}
    </Card>
  );
}
