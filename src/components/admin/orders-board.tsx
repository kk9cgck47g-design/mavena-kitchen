'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { Bike, ChevronRight, Search, Store, X } from 'lucide-react';

import { ADMIN_TEXT } from '@/app/admin/strings';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/domain';
import { formatAmd } from '@/lib/money';
import { formatArmenianPhone } from '@/lib/phone';
import type { OrderListItem } from '@/server/services/admin-orders';
import { cn } from '@/lib/utils';
import { demoStatusOf, useDemoAdmin } from '@/stores/demo-admin';
import { EmptyState, StatusBadge } from './admin-ui';

/**
 * The order list, which is the screen this panel exists for.
 *
 * Filters and the search term live in the URL rather than in component state.
 * That is what lets a manager keep "new orders" open in a pinned tab, reload it
 * without losing the filter, and send a colleague a link to exactly what they
 * are looking at. It also means the real panel filters in the database and the
 * demo filters the same parameters in memory, with no second implementation of
 * what a filter means.
 *
 * New orders are marked twice over — a lime badge and a lime edge on the row —
 * because this list is read at a glance from across a kitchen, and "which of
 * these has nobody touched yet" is the only question that matters at that
 * distance.
 */

export function OrdersBoard({
  orders,
  total,
  page,
  pageSize,
  demo,
}: {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
  demo: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();

  const activeStatuses = params.getAll('status').filter(isStatus);
  const search = params.get('q') ?? '';
  const [searchDraft, setSearchDraft] = useState(search);

  const changes = useDemoAdmin((s) => s.changes);

  function apply(next: URLSearchParams) {
    // Any change to the filters starts from the first page; staying on page 3
    // of a filter that now matches four orders shows an empty screen.
    next.delete('page');
    router.push(`${pathname}?${next.toString()}`);
  }

  function toggleStatus(status: OrderStatus) {
    const next = new URLSearchParams(params.toString());
    const current = next.getAll('status');
    next.delete('status');

    for (const value of current.includes(status)
      ? current.filter((v) => v !== status)
      : [...current, status]) {
      next.append('status', value);
    }

    apply(next);
  }

  function submitSearch(event: React.FormEvent) {
    event.preventDefault();
    const next = new URLSearchParams(params.toString());
    if (searchDraft.trim()) next.set('q', searchDraft.trim());
    else next.delete('q');
    apply(next);
  }

  function clearSearch() {
    setSearchDraft('');
    const next = new URLSearchParams(params.toString());
    next.delete('q');
    apply(next);
  }

  const pages = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-5">
      <form onSubmit={submitSearch} className="flex flex-wrap gap-2">
        <label htmlFor="order-search" className="sr-only">
          {ADMIN_TEXT.orders.searchLabel}
        </label>
        <div className="relative min-w-0 flex-1">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
          <input
            id="order-search"
            value={searchDraft}
            onChange={(event) => setSearchDraft(event.target.value)}
            placeholder={ADMIN_TEXT.orders.searchPlaceholder}
            inputMode="search"
            className="bg-elevated h-11 w-full rounded-xl border border-white/8 pr-10 pl-10 text-base outline-none focus-visible:border-lime-500/60 sm:text-sm"
          />
          {searchDraft && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label={ADMIN_TEXT.orders.searchClear}
              className="text-muted-foreground hover:text-foreground absolute top-1/2 right-1 flex size-9 -translate-y-1/2 items-center justify-center rounded-lg"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
        <button
          type="submit"
          className="bg-elevated flex min-h-11 items-center rounded-xl border border-white/8 px-4 text-sm font-semibold transition-colors hover:bg-white/8"
        >
          {ADMIN_TEXT.orders.searchApply}
        </button>
      </form>

      {/* A toolbar, not a list of links: these toggle a view. */}
      <div role="group" aria-label={ADMIN_TEXT.orders.title} className="flex flex-wrap gap-2">
        <FilterPill
          label={ADMIN_TEXT.orders.filterAll}
          active={activeStatuses.length === 0}
          onClick={() => {
            const next = new URLSearchParams(params.toString());
            next.delete('status');
            apply(next);
          }}
        />
        {ORDER_STATUSES.map((status) => (
          <FilterPill
            key={status}
            label={ADMIN_TEXT.status[status]}
            active={activeStatuses.includes(status)}
            onClick={() => toggleStatus(status)}
          />
        ))}
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title={
            activeStatuses.length > 0 || search
              ? ADMIN_TEXT.orders.emptyFiltered
              : ADMIN_TEXT.orders.empty
          }
        />
      ) : (
        <ul className="space-y-2">
          {orders.map((order) => {
            const status = demo ? demoStatusOf(changes, order.id, order.status) : order.status;
            const isNew = status === 'NEW';

            return (
              <li key={order.id}>
                <Link
                  href={`/admin/orders/${order.id}`}
                  className={cn(
                    'bg-card flex items-center gap-3 rounded-2xl border p-3.5 transition-colors hover:border-white/16 sm:p-4',
                    isNew ? 'border-lime-500/40' : 'border-white/6',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'h-10 w-1 shrink-0 rounded-full',
                      isNew ? 'bg-lime-500' : 'bg-transparent',
                    )}
                  />

                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="font-bold tabular-nums">{order.publicCode}</span>
                      <StatusBadge status={status} />
                      {order.type === 'DELIVERY' ? (
                        <Bike className="text-muted-foreground size-4" aria-label={ADMIN_TEXT.order.delivery} />
                      ) : (
                        <Store className="text-muted-foreground size-4" aria-label={ADMIN_TEXT.order.pickup} />
                      )}
                    </span>
                    <span className="text-muted-foreground mt-1 block truncate text-sm">
                      {order.customerName} · {formatArmenianPhone(order.phone)}
                    </span>
                    <span className="text-muted-foreground mt-0.5 block text-xs tabular-nums">
                      {new Date(order.createdAt).toLocaleTimeString('ru-RU', {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                      {' · '}
                      {order.itemCount} {ADMIN_TEXT.orders.itemCount}
                    </span>
                  </span>

                  <span className="shrink-0 text-right">
                    <span className="block font-bold tabular-nums">
                      {formatAmd(order.total, 'ru')}
                    </span>
                  </span>

                  <ChevronRight className="text-muted-foreground size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex items-center justify-between gap-4 pt-2">
          <PageLink page={page - 1} disabled={page <= 1} label={ADMIN_TEXT.orders.prev} params={params} pathname={pathname} />
          <span className="text-muted-foreground text-sm tabular-nums">
            {ADMIN_TEXT.orders.page} {page} {ADMIN_TEXT.orders.of} {pages}
          </span>
          <PageLink page={page + 1} disabled={page >= pages} label={ADMIN_TEXT.orders.next} params={params} pathname={pathname} />
        </nav>
      )}
    </div>
  );
}

function FilterPill({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-11 items-center rounded-full px-3.5 text-sm font-semibold transition-colors',
        'focus-visible:outline-coal-50 focus-visible:outline-2 focus-visible:outline-offset-2',
        active
          ? 'bg-lime-500 text-primary-foreground'
          : 'bg-elevated text-muted-foreground hover:text-foreground border border-white/8',
      )}
    >
      {label}
    </button>
  );
}

function PageLink({
  page,
  disabled,
  label,
  params,
  pathname,
}: {
  page: number;
  disabled: boolean;
  label: string;
  params: URLSearchParams;
  pathname: string;
}) {
  if (disabled) {
    return <span className="text-muted-foreground/50 flex min-h-11 items-center px-3 text-sm">{label}</span>;
  }

  const next = new URLSearchParams(params.toString());
  next.set('page', String(page));

  return (
    <Link
      href={`${pathname}?${next.toString()}`}
      className="bg-elevated flex min-h-11 items-center rounded-xl border border-white/8 px-4 text-sm font-semibold"
    >
      {label}
    </Link>
  );
}

function isStatus(value: string): value is OrderStatus {
  return (ORDER_STATUSES as readonly string[]).includes(value);
}
