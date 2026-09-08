import type { OrderStatus } from '@/lib/domain';
import { cn } from '@/lib/utils';
import { ADMIN_TEXT } from '@/app/admin/strings';

/**
 * The panel's small vocabulary of surfaces.
 *
 * The storefront's components are built for a customer browsing food on a
 * phone: big photography, generous spacing, motion. A kitchen screen wants the
 * opposite — density, and a status legible from an arm's length away — so the
 * panel has its own handful of primitives rather than bending the shop's.
 */

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('bg-card rounded-2xl border border-white/6 p-4 sm:p-5', className)}>
      {children}
    </div>
  );
}

export function StatTile({
  label,
  value,
  hint,
  accent,
}: {
  label: string;
  value: string;
  hint?: string;
  accent?: boolean;
}) {
  return (
    <Card>
      <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
        {label}
      </p>
      <p
        className={cn(
          'mt-2 text-2xl font-bold tabular-nums sm:text-3xl',
          accent && 'text-lime-400',
        )}
      >
        {value}
      </p>
      {hint && <p className="text-muted-foreground mt-1 text-xs">{hint}</p>}
    </Card>
  );
}

/**
 * Colour carries meaning here, so it never carries it alone: every badge also
 * says the status in words. Lime keeps the meaning it has everywhere else in
 * this system — live, actionable — and the terminal states step out of it.
 */
const STATUS_TONE: Record<OrderStatus, string> = {
  /*
    Amber, and the only status wearing it. Not lime, because lime means the
    kitchen has work to do and this order is precisely the one it must not start;
    not the destructive red either, because nothing has gone wrong — somebody is
    still finding their card. Sitting outside both palettes is the point: a glance
    down the list separates "waiting for money" from "waiting for us".
  */
  AWAITING_PAYMENT: 'bg-amber-500/15 text-amber-400 border border-amber-500/30',
  NEW: 'bg-lime-500 text-primary-foreground',
  CONFIRMED: 'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  PREPARING: 'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  READY: 'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  DELIVERING: 'bg-lime-500/15 text-lime-400 border border-lime-500/30',
  COMPLETED: 'bg-white/8 text-muted-foreground border border-white/10',
  CANCELLED: 'bg-destructive/12 text-destructive border border-destructive/30',
};

export function StatusBadge({ status, className }: { status: OrderStatus; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center rounded-full px-2.5 py-1 text-xs font-bold whitespace-nowrap',
        STATUS_TONE[status],
        className,
      )}
    >
      {ADMIN_TEXT.status[status]}
    </span>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="border-white/8 rounded-2xl border border-dashed px-6 py-14 text-center">
      <p className="font-semibold">{title}</p>
      {hint && <p className="text-muted-foreground mt-1 text-sm">{hint}</p>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
        {subtitle && <p className="text-muted-foreground mt-1 text-sm">{subtitle}</p>}
      </div>
      {action}
    </header>
  );
}
