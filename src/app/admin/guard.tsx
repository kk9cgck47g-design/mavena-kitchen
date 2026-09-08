import Link from 'next/link';
import { redirect } from 'next/navigation';

import { satisfiesRole, type AdminRole } from '@/lib/domain';
import { adminAvailability, currentAdmin, type AdminSession } from '@/server/auth/admin-session';
import { ADMIN_TEXT } from './strings';

/**
 * The gate every admin page passes through.
 *
 * Three outcomes, and the third is the point of writing this once rather than
 * per page:
 *
 *   - demo        — the preview. No session, no database, generated orders.
 *   - session     — a real deployment with a signed-in member of staff.
 *   - unconfigured — a real deployment with no `AUTH_SECRET`. The page is not
 *                    rendered at all. A panel that opens because a secret is
 *                    missing is worse than one that will not open.
 *
 * Pages call `adminGate()` and branch on `mode`. Forgetting to is not possible
 * without also having nothing to render, because the data comes from the gate's
 * result rather than from a separate fetch.
 */
export type AdminGate =
  | { mode: 'demo' }
  | { mode: 'session'; admin: AdminSession }
  | { mode: 'unconfigured' }
  | { mode: 'forbidden' };

/**
 * @param require the minimum role. Omitted means any signed-in member of staff.
 */
export async function adminGate(options: { require?: AdminRole } = {}): Promise<AdminGate> {
  const availability = adminAvailability();

  if (availability === 'demo') return { mode: 'demo' };
  if (availability === 'unconfigured') return { mode: 'unconfigured' };

  const admin = await currentAdmin();
  if (!admin) redirect('/admin/login');

  /*
    Not a redirect to the login page. They are signed in; sending them to a form
    they have already filled in correctly says "your password is wrong" when the
    truth is "this is not yours". A manager who follows a bookmark to the owner's
    settings should be told so and given the way back.
  */
  if (options.require && !satisfiesRole(admin.role, options.require)) {
    return { mode: 'forbidden' };
  }

  return { mode: 'session', admin };
}

/** Rendered in place of a page a signed-in member of staff may not open. */
export function Forbidden() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
      <h1 className="text-2xl font-bold">{ADMIN_TEXT.forbidden.title}</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {ADMIN_TEXT.forbidden.body}
      </p>
      <Link
        href="/admin/orders"
        className="bg-elevated mt-8 inline-flex min-h-11 items-center rounded-xl border border-white/8 px-5 text-sm font-semibold"
      >
        {ADMIN_TEXT.forbidden.back}
      </Link>
    </div>
  );
}

/** Rendered in place of any page when the deployment has no admin secret. */
export function Unconfigured() {
  return (
    <div className="mx-auto max-w-lg px-4 py-20 text-center sm:px-6">
      <h1 className="text-2xl font-bold">{ADMIN_TEXT.unconfigured.title}</h1>
      <p className="text-muted-foreground mt-3 text-sm leading-relaxed">
        {ADMIN_TEXT.unconfigured.body}
      </p>
      <p className="text-muted-foreground mt-4 text-xs">{ADMIN_TEXT.unconfigured.hint}</p>
    </div>
  );
}
