import type { OrderStatus } from '@/lib/domain';
import type { OrderEventView } from '@/lib/order-types';

/**
 * How the demo panel's session-local changes layer over the generated orders.
 *
 * Pure, and deliberately outside the Zustand store in `stores/demo-admin.ts`:
 * that module is a client module wired to `sessionStorage`, which cannot be
 * imported in a Node test. This is the part with rules in it, so this is the
 * part worth testing.
 */

export interface DemoStatusChange {
  status: OrderStatus;
  /** ISO, so it renders through the same formatter as a real event. */
  at: string;
  note: string | null;
}

export type DemoChanges = Record<string, DemoStatusChange[]>;

/** Where an order stands once this session's changes are applied. */
export function demoStatusOf(
  changes: DemoChanges,
  orderId: string,
  original: OrderStatus,
): OrderStatus {
  return changes[orderId]?.at(-1)?.status ?? original;
}

/**
 * The audit trail as the panel should show it: what the order arrived with,
 * then whatever this session did to it.
 *
 * Each synthesised event carries the status it moved *from*, chained through
 * the session's changes, so the history reads the same way a real one does
 * rather than repeating the original status on every line.
 */
export function demoEventsFor(
  changes: DemoChanges,
  orderId: string,
  base: OrderEventView[],
): OrderEventView[] {
  const mine = changes[orderId] ?? [];
  let from: OrderStatus = base.at(-1)?.toStatus ?? 'NEW';

  const added = mine.map((change, index): OrderEventView => {
    const event: OrderEventView = {
      id: `${orderId}-demo-${index}`,
      fromStatus: from,
      toStatus: change.status,
      source: 'ADMIN',
      note: change.note,
      createdAt: change.at,
    };
    from = change.status;
    return event;
  });

  return [...base, ...added];
}
