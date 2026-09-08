import { EmptyState } from '@/components/admin/admin-ui';
import { DemoBanner } from '@/components/admin/demo-banner';
import { NotificationCard } from '@/components/admin/notification-card';
import { OrderDetail } from '@/components/admin/order-detail';
import { PaymentCard } from '@/components/admin/payment-card';
import { isTelegramConfigured } from '@/server/telegram/config';
import { notificationsForOrder } from '@/server/telegram/outbox';
import { getAdminOrder } from '@/server/services/admin-orders';
import { paymentsForOrder } from '@/server/services/payments';
import { demoBaseEvents, demoOrderById, demoTokenFor } from '@/server/demo/orders';
import { db } from '@/server/db/client';
import { orders } from '@/server/db/schema';
import { eq } from 'drizzle-orm';
import { adminGate, Unconfigured } from '../../guard';
import { ADMIN_TEXT } from '../../strings';

export default async function AdminOrderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const gate = await adminGate();
  if (gate.mode === 'unconfigured') return <Unconfigured />;

  const { id } = await params;

  if (gate.mode === 'demo') {
    const order = demoOrderById(id);
    if (!order) return <NotFound />;

    return (
      <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <DemoBanner />
        <OrderDetail
          order={order}
          events={demoBaseEvents(order)}
          trackingToken={demoTokenFor(order)}
          demo
        />
      </div>
    );
  }

  const detail = await getAdminOrder(id);
  if (!detail) return <NotFound />;

  // The tracking link is what staff read out to a customer who has lost theirs,
  // so the panel needs the token — it is on the row, not in the view type, which
  // deliberately never carries it to the storefront.
  const [row] = await db
    .select({ trackingToken: orders.trackingToken })
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  // Whether the kitchen was actually told. A silent failure here is the one
  // that costs a customer their dinner, so it gets a place on the screen.
  const queued = await notificationsForOrder(id);
  const notification = queued.find((row) => row.channel === 'TELEGRAM') ?? null;

  // Only online orders have any of this. For cash the money is the courier's
  // business, and an empty payment card on every order would be noise on the one
  // screen that has to stay scannable.
  const attempts =
    detail.order.paymentMethod === 'ONLINE' ? await paymentsForOrder(id) : [];

  return (
    <div className="mx-auto max-w-4xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
      <OrderDetail
        order={detail.order}
        events={detail.events}
        trackingToken={row?.trackingToken ?? null}
        demo={false}
      />

      {detail.order.paymentMethod === 'ONLINE' && (
        <PaymentCard
          orderId={id}
          attempts={attempts}
          awaiting={detail.order.status === 'AWAITING_PAYMENT'}
          expiresAt={detail.order.paymentExpiresAt}
        />
      )}

      <NotificationCard
        orderId={id}
        configured={isTelegramConfigured()}
        summary={
          notification && {
            status: notification.status,
            attempts: notification.attempts,
            deliveredChats: Object.keys(notification.deliveries).length,
            lastError: notification.lastError,
          }
        }
      />
    </div>
  );
}

function NotFound() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-16 sm:px-6">
      <EmptyState title={ADMIN_TEXT.order.notFound} />
    </div>
  );
}
