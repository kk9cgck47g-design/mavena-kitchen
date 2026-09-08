'use client';

import { useState, useTransition } from 'react';
import { RefreshCw, Send } from 'lucide-react';

import { resendOrderNotification } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import type { NotificationStatus } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { Card } from './admin-ui';

/**
 * Whether the kitchen was actually told, and a way to try again if not.
 *
 * Worth a place on the order screen because the failure it reports is silent by
 * nature: an order arrives, the customer is thanked, and nobody in the kitchen
 * knows. Without this the first sign of a broken bot token is a cold customer
 * on the phone.
 *
 * The button is safe to press as often as anyone likes — delivery is tracked
 * per chat, so a retry goes only to the screens still missing the ticket.
 */
export interface NotificationSummary {
  status: NotificationStatus;
  attempts: number;
  deliveredChats: number;
  lastError: string | null;
}

export function NotificationCard({
  orderId,
  summary,
  configured,
}: {
  orderId: string;
  summary: NotificationSummary | null;
  configured: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  function resend() {
    setMessage(null);

    startTransition(async () => {
      const result = await resendOrderNotification(orderId);

      setMessage(
        result.ok && result.delivered
          ? { tone: 'ok', text: ADMIN_TEXT.notify.resent }
          : {
              tone: 'error',
              text:
                !result.ok && result.code === 'NOT_CONFIGURED'
                  ? ADMIN_TEXT.notify.notConfigured
                  : ADMIN_TEXT.notify.resendFailed,
            },
      );
    });
  }

  const tone =
    summary?.status === 'SENT'
      ? 'text-lime-400'
      : summary?.status === 'FAILED'
        ? 'text-destructive'
        : 'text-muted-foreground';

  return (
    <Card>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-bold">{ADMIN_TEXT.notify.title}</h2>

          {summary ? (
            <p className={cn('mt-1 text-sm font-semibold', tone)}>
              {ADMIN_TEXT.notify[summary.status]}
              <span className="text-muted-foreground ml-2 font-normal tabular-nums">
                · {ADMIN_TEXT.notify.chats}: {summary.deliveredChats} · {ADMIN_TEXT.notify.attempts}:{' '}
                {summary.attempts}
              </span>
            </p>
          ) : (
            <p className="text-muted-foreground mt-1 text-sm">{ADMIN_TEXT.notify.none}</p>
          )}

          {!configured && (
            <p className="text-muted-foreground mt-1 text-xs">{ADMIN_TEXT.notify.notConfigured}</p>
          )}

          {/* The provider's own words. Staff will not act on them, but the
              person they phone about it will. */}
          {summary?.lastError && (
            <p className="text-destructive mt-1 text-xs break-words">{summary.lastError}</p>
          )}

          {message && (
            <p
              aria-live="polite"
              className={cn(
                'mt-2 text-xs font-semibold',
                message.tone === 'ok' ? 'text-lime-400' : 'text-destructive',
              )}
            >
              {message.text}
            </p>
          )}
        </div>

        {summary && summary.status !== 'SENT' && (
          <button
            type="button"
            disabled={pending || !configured}
            onClick={resend}
            className="bg-elevated flex min-h-11 shrink-0 items-center gap-2 rounded-xl border border-white/8 px-3.5 text-sm font-semibold transition-colors hover:bg-white/8 disabled:opacity-40"
          >
            {pending ? <RefreshCw className="size-4 animate-spin" /> : <Send className="size-4" />}
            {pending ? ADMIN_TEXT.notify.resending : ADMIN_TEXT.notify.resend}
          </button>
        )}
      </div>
    </Card>
  );
}
