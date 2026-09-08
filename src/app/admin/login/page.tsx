import { redirect } from 'next/navigation';

import { LoginForm } from '@/components/admin/login-form';
import { adminAvailability, currentAdmin } from '@/server/auth/admin-session';
import { Unconfigured } from '../guard';
import { ADMIN_TEXT } from '../strings';

/**
 * The only page in this segment that is reachable without a session.
 *
 * In demo mode it does not exist as a concept — there is nothing to sign in to
 * — so it sends visitors to the panel itself rather than showing a form that
 * cannot do anything.
 */
export default async function AdminLoginPage() {
  const availability = adminAvailability();

  if (availability === 'demo') redirect('/admin');
  if (availability === 'unconfigured') return <Unconfigured />;

  // Already signed in: a login form here would be a dead end with a filled-in
  // password manager.
  if (await currentAdmin()) redirect('/admin');

  return (
    <div className="mx-auto flex min-h-svh max-w-sm flex-col justify-center px-4 py-12 sm:px-6">
      <h1 className="text-2xl font-bold tracking-tight">{ADMIN_TEXT.login.title}</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        {ADMIN_TEXT.brand} · {ADMIN_TEXT.panel}
      </p>
      <LoginForm />
    </div>
  );
}
