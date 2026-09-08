'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ExternalLink, LogOut } from 'lucide-react';

import { ADMIN_TEXT } from '@/app/admin/strings';
import { signOut } from '@/app/admin/actions';
import { cn } from '@/lib/utils';

/**
 * The panel's navigation.
 *
 * Plain `next/link`, not the locale-aware one: this segment is excluded from
 * locale negotiation in the proxy, so a link through `@/i18n/navigation` would
 * try to prefix it and land on a route that does not exist.
 */

/**
 * `owner` marks a destination a manager cannot open.
 *
 * Hidden rather than shown-and-refused: a link that always leads to "not yours"
 * is clutter on a screen used at speed. The pages and the actions behind them
 * check the role themselves — this only decides what is worth offering.
 */
const LINKS = [
  { href: '/admin', label: ADMIN_TEXT.nav.dashboard, owner: false },
  { href: '/admin/orders', label: ADMIN_TEXT.nav.orders, owner: false },
  { href: '/admin/menu', label: ADMIN_TEXT.nav.menu, owner: false },
  { href: '/admin/settings', label: ADMIN_TEXT.nav.settings, owner: true },
  { href: '/admin/staff', label: ADMIN_TEXT.nav.staff, owner: true },
] as const;

export function AdminNav({
  demo,
  name,
  isOwner,
}: {
  demo: boolean;
  name: string | null;
  /** True in demo too, where the preview shows the whole panel. */
  isOwner: boolean;
}) {
  const pathname = usePathname();
  const links = LINKS.filter((link) => isOwner || !link.owner);

  return (
    <header className="border-b border-white/8">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6">
        <span className="font-bold tracking-tight">{ADMIN_TEXT.brand}</span>

        {/* Scrolls rather than wraps or overflows. A fourth item was enough to
            push the row past a 320px screen, and a navigation bar that grows
            with the product should not be able to widen the page. */}
        <nav className="no-scrollbar -mx-1 flex min-w-0 items-center gap-1 overflow-x-auto px-1">
          {links.map((link) => {
            // `/admin` is a prefix of everything, so it only counts as active
            // when it is the whole path.
            const active =
              link.href === '/admin' ? pathname === '/admin' : pathname.startsWith(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex min-h-11 shrink-0 items-center rounded-full px-3.5 text-sm font-medium whitespace-nowrap transition-colors',
                  active
                    ? 'text-foreground bg-white/8'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {link.label}
              </Link>
            );
          })}
        </nav>

        {/* `min-w-11` on both: below `sm` the labels are hidden and each control
            collapses to a 16px icon in 8px of padding — 32px wide, which is a
            miss-tap on a phone held in one hand over a hot pan. */}
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            className="text-muted-foreground hover:text-foreground flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-2 text-sm"
          >
            <ExternalLink className="size-4" />
            <span className="hidden sm:inline">{ADMIN_TEXT.nav.openSite}</span>
          </a>

          {!demo && (
            <form action={signOut}>
              <button
                type="submit"
                className="text-muted-foreground hover:text-foreground flex min-h-11 min-w-11 items-center justify-center gap-1.5 px-2 text-sm"
              >
                <LogOut className="size-4" />
                <span className="hidden sm:inline">
                  {name ? `${ADMIN_TEXT.nav.signOut} · ${name}` : ADMIN_TEXT.nav.signOut}
                </span>
              </button>
            </form>
          )}
        </div>
      </div>
    </header>
  );
}
