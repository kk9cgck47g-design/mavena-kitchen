'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ArrowLeft, ExternalLink, MapPin, Phone } from 'lucide-react';

import { changeOrderStatus } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import type { OrderStatus } from '@/lib/domain';
import { formatAmd } from '@/lib/money';
import { allowedTransitions, type OrderEventView, type OrderView } from '@/lib/order-types';
import { formatArmenianPhone, phoneHref } from '@/lib/phone';
import { pickLocalized } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';
import { demoEventsFor, demoStatusOf, useDemoAdmin } from '@/stores/demo-admin';
import { Card, StatusBadge } from './admin-ui';

/**
 * One order, everything about it, and the only thing staff can change.
 *
 * The buttons offered come from `allowedTransitions`, which reads the domain's
 * own table — so the panel can never offer a move the server would reject, and
 * adding a status to the domain adds it here without anyone remembering to.
 * The server checks again inside a transaction regardless; this decides what to
 * draw, not what is permitted.
 */
export function OrderDetail({
  order,
  events: baseEvents,
  trackingToken,
  demo,
}: {
  order: OrderView;
  events: OrderEventView[];
  /** Link to what the customer sees. Null when it is not worth showing. */
  trackingToken: string | null;
  demo: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');

  const changes = useDemoAdmin((s) => s.changes);
  const advance = useDemoAdmin((s) => s.advance);

  const status = demo ? demoStatusOf(changes, order.id, order.status) : order.status;
  const events = demo ? demoEventsFor(changes, order.id, baseEvents) : baseEvents;
  const transitions = allowedTransitions(status);

  function move(to: OrderStatus, note?: string) {
    setError(null);

    if (demo) {
      // Nothing leaves the browser. The store enforces the same state machine.
      advance(order.id, order.status, to, note);
      setCancelling(false);
      setReason('');
      return;
    }

    startTransition(async () => {
      const result = await changeOrderStatus({ orderId: order.id, to, note });

      if (!result.ok) {
        setError(
          result.code === 'ILLEGAL_TRANSITION'
            ? ADMIN_TEXT.order.illegalTransition
            : ADMIN_TEXT.order.changeFailed,
        );
        return;
      }

      setCancelling(false);
      setReason('');
      // The row this page renders has moved; pull it again rather than guessing
      // what else changed with it.
      router.refresh();
    });
  }

  const isDelivery = order.type === 'DELIVERY';
  const mapHref =
    order.lat !== null && order.lng !== null
      ? `https://www.openstreetmap.org/?mlat=${order.lat}&mlon=${order.lng}#map=18/${order.lat}/${order.lng}`
      : null;

  return (
    <div className="space-y-5">
      <Link
        href="/admin/orders"
        className="text-muted-foreground hover:text-foreground -mt-2 mb-1 inline-flex min-h-11 items-center gap-2 text-sm font-medium"
      >
        <ArrowLeft className="size-4" />
        {ADMIN_TEXT.order.back}
      </Link>

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tabular-nums sm:text-3xl">{order.publicCode}</h1>
        <StatusBadge status={status} />
        <span className="text-muted-foreground text-sm tabular-nums">
          {ADMIN_TEXT.order.placed}{' '}
          {new Date(order.createdAt).toLocaleString('ru-RU', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>

      {/* The action bar comes before the detail: on a phone in a kitchen this
          is what the screen is opened for. */}
      <Card>
        <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
          {ADMIN_TEXT.order.changeStatus}
        </p>

        {transitions.length === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">{ADMIN_TEXT.order.noTransitions}</p>
        ) : (
          <div className="mt-3 flex flex-wrap gap-2">
            {transitions.map((to) =>
              to === 'CANCELLED' ? (
                <button
                  key={to}
                  type="button"
                  disabled={pending}
                  onClick={() => setCancelling((open) => !open)}
                  aria-expanded={cancelling}
                  className="border-destructive/40 text-destructive hover:bg-destructive/10 flex min-h-11 items-center rounded-xl border px-4 text-sm font-semibold transition-colors disabled:opacity-50"
                >
                  {ADMIN_TEXT.order.confirmCancel}
                </button>
              ) : (
                <button
                  key={to}
                  type="button"
                  disabled={pending}
                  onClick={() => move(to)}
                  className="bg-lime-500 text-primary-foreground hover:bg-lime-400 flex min-h-11 items-center rounded-xl px-4 text-sm font-bold transition-colors disabled:opacity-50"
                >
                  {pending ? ADMIN_TEXT.order.changing : ADMIN_TEXT.status[to]}
                </button>
              ),
            )}
          </div>
        )}

        {cancelling && (
          <div className="mt-4 space-y-2">
            <label htmlFor="cancel-reason" className="text-muted-foreground block text-sm">
              {ADMIN_TEXT.order.cancelPrompt}
            </label>
            <textarea
              id="cancel-reason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              rows={2}
              maxLength={300}
              className="bg-elevated w-full rounded-xl border border-white/8 p-3 text-base outline-none focus-visible:border-lime-500/60 sm:text-sm"
            />
            <button
              type="button"
              disabled={pending}
              onClick={() => move('CANCELLED', reason.trim() || undefined)}
              className="bg-destructive/12 text-destructive border-destructive/40 flex min-h-11 items-center rounded-xl border px-4 text-sm font-bold disabled:opacity-50"
            >
              {pending ? ADMIN_TEXT.order.changing : ADMIN_TEXT.order.confirmCancel}
            </button>
          </div>
        )}

        {error && (
          <p aria-live="polite" className="text-destructive mt-3 text-sm">
            {error}
          </p>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="font-bold">{ADMIN_TEXT.order.items}</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {order.items.map((item) => (
              <li key={item.id} className="flex gap-3">
                <span className="bg-elevated text-muted-foreground flex size-6 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums">
                  {item.quantity}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{pickLocalized(item.name, 'ru')}</span>
                  {item.options.length > 0 && (
                    <span className="text-muted-foreground block text-xs">
                      {item.options.map((option) => pickLocalized(option.name, 'ru')).join(' · ')}
                    </span>
                  )}
                </span>
                <span className="shrink-0 tabular-nums">{formatAmd(item.lineTotal, 'ru')}</span>
              </li>
            ))}
          </ul>

          <dl className="mt-4 space-y-1.5 border-t border-white/8 pt-4 text-sm">
            <Row label={ADMIN_TEXT.order.subtotal} value={formatAmd(order.subtotal, 'ru')} />
            {isDelivery && (
              <Row label={ADMIN_TEXT.order.deliveryFee} value={formatAmd(order.deliveryFee, 'ru')} />
            )}
            <div className="flex items-baseline justify-between gap-4 pt-1">
              <dt className="font-semibold">{ADMIN_TEXT.order.total}</dt>
              <dd className="text-lg font-bold tabular-nums">{formatAmd(order.total, 'ru')}</dd>
            </div>
            <Row
              label={ADMIN_TEXT.order.payment}
              value={
                // For an online order the method alone is not the answer to
                // "have they paid?" — which is the only reason anyone reads this
                // line before handing food over.
                order.paymentMethod === 'ONLINE'
                  ? `${ADMIN_TEXT.payment.ONLINE} · ${ADMIN_TEXT.paymentStatus[order.paymentStatus]}`
                  : ADMIN_TEXT.payment[order.paymentMethod]
              }
            />
            <Row
              label={ADMIN_TEXT.order.eta}
              value={`${order.etaMinutes} ${ADMIN_TEXT.order.minutes}`}
            />
          </dl>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="font-bold">
              {isDelivery ? ADMIN_TEXT.order.delivery : ADMIN_TEXT.order.pickup}
            </h2>

            <dl className="mt-3 space-y-1.5 text-sm">
              <Row label={ADMIN_TEXT.order.customer} value={order.customerName} />
              <div className="flex items-baseline justify-between gap-4">
                <dt className="text-muted-foreground">{ADMIN_TEXT.order.phone}</dt>
                <dd>
                  <a
                    href={phoneHref(order.phone)}
                    className="text-lime-400 inline-flex min-h-11 items-center gap-1.5 font-semibold tabular-nums"
                  >
                    <Phone className="size-3.5" />
                    {formatArmenianPhone(order.phone)}
                  </a>
                </dd>
              </div>
              {isDelivery && <Row label={ADMIN_TEXT.order.address} value={order.address ?? '—'} />}
              {isDelivery && order.landmark && (
                <Row label={ADMIN_TEXT.order.landmark} value={order.landmark} />
              )}
            </dl>

            {mapHref && (
              <a
                href={mapHref}
                target="_blank"
                rel="noreferrer"
                className="bg-elevated mt-3 flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/8 text-sm font-semibold transition-colors hover:bg-white/8"
              >
                <MapPin className="size-4" />
                {ADMIN_TEXT.order.openMap}
                <span className="text-muted-foreground text-xs tabular-nums">
                  {order.lat?.toFixed(5)}, {order.lng?.toFixed(5)}
                </span>
              </a>
            )}
          </Card>

          <Card>
            <h2 className="font-bold">{ADMIN_TEXT.order.notes}</h2>
            <p className={cn('mt-2 text-sm', !order.notes && 'text-muted-foreground')}>
              {order.notes || ADMIN_TEXT.order.noNotes}
            </p>
            {order.cancelReason && (
              <p className="text-destructive mt-3 border-t border-white/8 pt-3 text-sm">
                {ADMIN_TEXT.order.cancelReason}: {order.cancelReason}
              </p>
            )}
          </Card>
        </div>
      </div>

      <Card>
        <h2 className="font-bold">{ADMIN_TEXT.order.history}</h2>
        <ol className="mt-3 space-y-2 text-sm">
          {events.map((event) => (
            <li key={event.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
              <span className="text-muted-foreground tabular-nums">
                {new Date(event.createdAt).toLocaleString('ru-RU', {
                  day: 'numeric',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
              <span className="font-medium">
                {event.fromStatus ? `${ADMIN_TEXT.status[event.fromStatus]} → ` : ''}
                {ADMIN_TEXT.status[event.toStatus]}
              </span>
              <span className="text-muted-foreground text-xs">
                {ADMIN_TEXT.order.source[event.source] ?? event.source}
              </span>
              {event.note && <span className="text-muted-foreground w-full text-xs">{event.note}</span>}
            </li>
          ))}
        </ol>
      </Card>

      {trackingToken && (
        <a
          href={`/ru/order/${trackingToken}`}
          target="_blank"
          rel="noreferrer"
          className="bg-elevated flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/8 text-sm font-semibold transition-colors hover:bg-white/8"
        >
          <ExternalLink className="size-4" />
          {ADMIN_TEXT.demo.trackingHint}
        </a>
      )}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-right font-medium">{value}</dd>
    </div>
  );
}
