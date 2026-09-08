import { and, count, desc, eq, gte, ilike, inArray, or, sql } from 'drizzle-orm';

import type { OrderStatus } from '@/lib/domain';
import { ORDER_STATUSES } from '@/lib/domain';
import type { OrderEventView, OrderView } from '@/lib/order-types';
import type { Amd } from '@/lib/money';
import { normalizeArmenianPhone } from '@/lib/phone';
import { db } from '@/server/db/client';
import { orderEvents, orderItems, orders } from '@/server/db/schema';
import { PUBLIC_CODE_PREFIX } from './order-codes';
import { toOrderEventView, toOrderView } from './orders';

/**
 * Reads for the staff panel.
 *
 * Separate from `orders.ts` because the questions are different: a customer
 * asks about one order they already have the token for, while the kitchen asks
 * "what is waiting", "what did today look like" and "find me the order this
 * person is phoning about". Those want indexes, filters and aggregates, and
 * they must never be reachable without a session — every function here is
 * called only from a route that has already resolved one.
 *
 * Nothing here writes. Status changes go through `updateOrderStatus`, which
 * owns the state machine.
 */

export const ORDER_PAGE_SIZE = 25;

export interface OrderListItem {
  id: string;
  publicCode: string;
  status: OrderStatus;
  type: 'DELIVERY' | 'PICKUP';
  customerName: string;
  phone: string;
  total: Amd;
  etaMinutes: number;
  createdAt: string;
  itemCount: number;
}

export interface OrderListQuery {
  /** Empty means every status. */
  statuses?: readonly OrderStatus[];
  /** Public code or phone number. Anything else matches nothing. */
  search?: string;
  page?: number;
}

export interface OrderListResult {
  orders: OrderListItem[];
  total: number;
  page: number;
  pageSize: number;
}

/**
 * Turn what someone typed into the search box into something worth querying.
 *
 * Two kinds of thing get typed there and no others: an order code read off a
 * receipt or heard on the phone, and the number the customer is calling from.
 * Both are matched exactly rather than fuzzily — a partial-match search across
 * a customer table is how staff end up browsing strangers' phone numbers.
 *
 * A phone number is normalised first, so `093 12 34 56`, `+37493123456` and
 * `0093123456` all find the same order.
 */
export function parseOrderSearch(raw: string): { code?: string; phone?: string } | null {
  const value = raw.trim();
  if (value.length < 3) return null;

  const phone = normalizeArmenianPhone(value);
  if (phone) return { phone };

  // `482193`, `MK-482193` and `mk482193` are all the same code.
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 4) return { code: `${PUBLIC_CODE_PREFIX}-${digits}` };

  return null;
}

export async function listOrders(query: OrderListQuery = {}): Promise<OrderListResult> {
  const page = Math.max(1, query.page ?? 1);
  const statuses = query.statuses?.filter((status) => ORDER_STATUSES.includes(status)) ?? [];
  const search = query.search ? parseOrderSearch(query.search) : null;

  const filters = [
    statuses.length > 0 ? or(...statuses.map((status) => eq(orders.status, status))) : undefined,
    search?.phone ? eq(orders.phone, search.phone) : undefined,
    search?.code ? ilike(orders.publicCode, search.code) : undefined,
    // A search that parsed to nothing must return nothing rather than
    // everything: silently ignoring it looks like "no filter applied".
    query.search && !search ? sql`false` : undefined,
  ].filter(Boolean);

  const where = filters.length > 0 ? and(...filters) : undefined;

  const [rows, [totals]] = await Promise.all([
    db
      .select({
        id: orders.id,
        publicCode: orders.publicCode,
        status: orders.status,
        type: orders.type,
        customerName: orders.customerName,
        phone: orders.phone,
        total: orders.total,
        etaMinutes: orders.etaMinutes,
        createdAt: orders.createdAt,
      })
      .from(orders)
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(ORDER_PAGE_SIZE)
      .offset((page - 1) * ORDER_PAGE_SIZE),
    db.select({ value: count() }).from(orders).where(where),
  ]);

  // A second grouped query rather than a correlated subquery in the select
  // list: it is one round trip either way, and this one is legible enough to
  // debug at the psql prompt when a count looks wrong.
  const counts = new Map<string, number>();

  if (rows.length > 0) {
    const grouped = await db
      .select({
        orderId: orderItems.orderId,
        quantity: sql<number>`coalesce(sum(${orderItems.quantity}), 0)::int`,
      })
      .from(orderItems)
      .where(
        inArray(
          orderItems.orderId,
          rows.map((row) => row.id),
        ),
      )
      .groupBy(orderItems.orderId);

    for (const row of grouped) counts.set(row.orderId, row.quantity);
  }

  return {
    orders: rows.map((row) => ({
      ...row,
      createdAt: row.createdAt.toISOString(),
      itemCount: counts.get(row.id) ?? 0,
    })),
    total: totals?.value ?? 0,
    page,
    pageSize: ORDER_PAGE_SIZE,
  };
}

export interface AdminOrderDetail {
  order: OrderView;
  events: OrderEventView[];
}

export async function getAdminOrder(id: string): Promise<AdminOrderDetail | null> {
  const [order] = await db.select().from(orders).where(eq(orders.id, id)).limit(1);
  if (!order) return null;

  const [items, events] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, id)).orderBy(orderItems.sortOrder),
    db.select().from(orderEvents).where(eq(orderEvents.orderId, id)).orderBy(orderEvents.createdAt),
  ]);

  return {
    order: toOrderView(order, items),
    events: events.map(toOrderEventView),
  };
}

/**
 * Today, as the restaurant experiences it.
 *
 * Every figure here counts orders that came through this website and nothing
 * else. The restaurant also sells across its counter and over the phone, and
 * this system cannot see any of it — so nothing in this shape may be labelled
 * revenue, and the panel says "through the site" on every number.
 *
 * Cancelled orders are excluded from the money but kept in the status counts:
 * they are not sales, and they are worth seeing. Orders awaiting an online
 * payment are excluded on the same grounds and for a sharper reason — nobody has
 * paid for them, and half of them never will. Counting them would inflate the
 * day's figure by every abandoned checkout and then quietly deflate it again as
 * the sweep cancelled them.
 */
export interface DashboardStats {
  since: string;
  ordersToday: number;
  siteTotalToday: Amd;
  averageOrderToday: Amd;
  byStatus: Record<OrderStatus, number>;
  /** Orders that need somebody to look at them right now. */
  awaitingAction: number;
}

export async function getDashboardStats(now: Date = new Date()): Promise<DashboardStats> {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  const [[today], statusRows] = await Promise.all([
    db
      .select({
        orders: count(),
        total: sql<number>`coalesce(sum(case when ${orders.status} not in ('CANCELLED', 'AWAITING_PAYMENT') then ${orders.total} else 0 end), 0)::int`,
        paidCount: sql<number>`count(*) filter (where ${orders.status} not in ('CANCELLED', 'AWAITING_PAYMENT'))::int`,
      })
      .from(orders)
      .where(gte(orders.createdAt, startOfDay)),
    db
      .select({ status: orders.status, value: count() })
      .from(orders)
      .where(gte(orders.createdAt, startOfDay))
      .groupBy(orders.status),
  ]);

  const byStatus = Object.fromEntries(ORDER_STATUSES.map((status) => [status, 0])) as Record<
    OrderStatus,
    number
  >;

  for (const row of statusRows) byStatus[row.status] = row.value;

  const siteTotalToday = today?.total ?? 0;
  const counted = today?.paidCount ?? 0;

  return {
    since: startOfDay.toISOString(),
    ordersToday: today?.orders ?? 0,
    siteTotalToday,
    // Integer drams throughout, so the average is floored rather than carrying
    // a fraction of a dram that does not exist.
    averageOrderToday: counted > 0 ? Math.floor(siteTotalToday / counted) : 0,
    byStatus,
    awaitingAction: byStatus.NEW + byStatus.CONFIRMED + byStatus.PREPARING + byStatus.READY,
  };
}
