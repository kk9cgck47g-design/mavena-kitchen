import Link from 'next/link';

import { DemoBanner } from '@/components/admin/demo-banner';
import { Card, PageHeader, StatTile } from '@/components/admin/admin-ui';
import { ORDER_STATUSES } from '@/lib/domain';
import { formatAmd } from '@/lib/money';
import { getDashboardStats, type DashboardStats } from '@/server/services/admin-orders';
import { demoOrders } from '@/server/demo/orders';
import { adminGate, Unconfigured } from './guard';
import { ADMIN_TEXT } from './strings';

/**
 * What today looks like through this system, and only through this system.
 *
 * Every figure counts orders placed on the website. The restaurant also sells
 * across its counter and over the phone, and none of that is visible here — so
 * none of this is revenue, and the page says so rather than leaving the owner
 * to assume otherwise from a number with a currency sign on it. Getting that
 * wrong would not be a rounding error; it would be a business decision made on
 * a figure that is missing most of the day.
 */
export default async function AdminDashboardPage() {
  const gate = await adminGate();
  if (gate.mode === 'unconfigured') return <Unconfigured />;

  const stats = gate.mode === 'demo' ? demoStats() : await getDashboardStats();

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {gate.mode === 'demo' && <DemoBanner />}

      <PageHeader
        title={ADMIN_TEXT.dashboard.title}
        subtitle={ADMIN_TEXT.dashboard.subtitle}
        action={
          <Link
            href="/admin/orders"
            className="bg-elevated flex min-h-11 items-center rounded-xl border border-white/8 px-4 text-sm font-semibold transition-colors hover:bg-white/8"
          >
            {ADMIN_TEXT.dashboard.goToOrders}
          </Link>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatTile label={ADMIN_TEXT.dashboard.ordersToday} value={String(stats.ordersToday)} />
        <StatTile
          label={ADMIN_TEXT.dashboard.siteTotalToday}
          value={formatAmd(stats.siteTotalToday, 'ru')}
        />
        <StatTile
          label={ADMIN_TEXT.dashboard.averageOrder}
          value={formatAmd(stats.averageOrderToday, 'ru')}
        />
        <StatTile
          label={ADMIN_TEXT.dashboard.awaitingAction}
          value={String(stats.awaitingAction)}
          accent={stats.awaitingAction > 0}
        />
      </div>

      <p className="text-muted-foreground text-xs leading-relaxed">
        {ADMIN_TEXT.dashboard.disclaimer}
      </p>

      <Card>
        <h2 className="font-bold">{ADMIN_TEXT.dashboard.byStatus}</h2>

        {stats.ordersToday === 0 ? (
          <p className="text-muted-foreground mt-3 text-sm">{ADMIN_TEXT.dashboard.emptyDay}</p>
        ) : (
          <dl className="mt-4 grid gap-x-6 gap-y-2 sm:grid-cols-2 lg:grid-cols-3">
            {ORDER_STATUSES.map((status) => (
              <div
                key={status}
                className="flex items-baseline justify-between gap-4 border-b border-white/6 pb-2"
              >
                <dt className="text-muted-foreground text-sm">{ADMIN_TEXT.status[status]}</dt>
                <dd className="font-bold tabular-nums">{stats.byStatus[status]}</dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </div>
  );
}

/**
 * The same figures, computed over the generated orders.
 *
 * Deliberately duplicating the arithmetic rather than the query: the real one
 * is SQL and there is no database here. It is four sums over seven rows, and
 * keeping it in the demo module would hide it from the page it belongs to.
 */
function demoStats(): DashboardStats {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);

  const today = demoOrders().filter((order) => new Date(order.createdAt) >= startOfDay);
  const counted = today.filter((order) => order.status !== 'CANCELLED');
  const total = counted.reduce((sum, order) => sum + order.total, 0);

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as DashboardStats['byStatus'];
  for (const order of today) byStatus[order.status] += 1;

  return {
    since: startOfDay.toISOString(),
    ordersToday: today.length,
    siteTotalToday: total,
    averageOrderToday: counted.length > 0 ? Math.floor(total / counted.length) : 0,
    byStatus,
    awaitingAction: byStatus.NEW + byStatus.CONFIRMED + byStatus.PREPARING + byStatus.READY,
  };
}
