import { DemoBanner } from '@/components/admin/demo-banner';
import { PageHeader } from '@/components/admin/admin-ui';
import { OrdersBoard } from '@/components/admin/orders-board';
import { ORDER_STATUSES, type OrderStatus } from '@/lib/domain';
import {
  listOrders,
  ORDER_PAGE_SIZE,
  parseOrderSearch,
  type OrderListItem,
} from '@/server/services/admin-orders';
import { demoOrders } from '@/server/demo/orders';
import { adminGate, Unconfigured } from '../guard';
import { ADMIN_TEXT } from '../strings';

/**
 * Every order, newest first, filtered by whatever is in the URL.
 *
 * The real panel pushes the filters into SQL; the demo applies the same
 * parameters to its generated list. Both read them from the same place and mean
 * the same thing by them, so there is one definition of "new orders only" and
 * one of "find this phone number".
 */
export default async function AdminOrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const gate = await adminGate();
  if (gate.mode === 'unconfigured') return <Unconfigured />;

  const params = await searchParams;
  const statuses = toStatuses(params.status);
  const search = typeof params.q === 'string' ? params.q : undefined;
  const page = Math.max(1, Number(params.page) || 1);

  const result =
    gate.mode === 'demo'
      ? demoList({ statuses, search, page })
      : await listOrders({ statuses, search, page });

  return (
    <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      {gate.mode === 'demo' && <DemoBanner />}

      <PageHeader title={ADMIN_TEXT.orders.title} />

      <OrdersBoard
        orders={result.orders}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        demo={gate.mode === 'demo'}
      />
    </div>
  );
}

function toStatuses(value: string | string[] | undefined): OrderStatus[] {
  const list = value === undefined ? [] : Array.isArray(value) ? value : [value];
  return list.filter((item): item is OrderStatus =>
    (ORDER_STATUSES as readonly string[]).includes(item),
  );
}

/**
 * The demo's list, filtered in memory by exactly the rules `listOrders` applies
 * in SQL — including that an unparseable search matches nothing rather than
 * everything, which is the difference between "not found" and "filter ignored".
 */
function demoList({
  statuses,
  search,
  page,
}: {
  statuses: OrderStatus[];
  search?: string;
  page: number;
}) {
  const parsed = search ? parseOrderSearch(search) : null;

  let orders = demoOrders();

  if (statuses.length > 0) orders = orders.filter((order) => statuses.includes(order.status));

  if (search) {
    orders = parsed
      ? orders.filter(
          (order) =>
            (parsed.phone && order.phone === parsed.phone) ||
            (parsed.code && order.publicCode.toLowerCase() === parsed.code.toLowerCase()),
        )
      : [];
  }

  const items: OrderListItem[] = orders
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((order) => ({
      id: order.id,
      publicCode: order.publicCode,
      status: order.status,
      type: order.type,
      customerName: order.customerName,
      phone: order.phone,
      total: order.total,
      etaMinutes: order.etaMinutes,
      createdAt: order.createdAt,
      itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0),
    }));

  return {
    orders: items.slice((page - 1) * ORDER_PAGE_SIZE, page * ORDER_PAGE_SIZE),
    total: items.length,
    page,
    pageSize: ORDER_PAGE_SIZE,
  };
}
