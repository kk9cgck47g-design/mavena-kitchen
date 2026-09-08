'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';

import { signIn, type LoginResult } from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';

/**
 * Email and password, and one message for every way it can fail.
 *
 * Distinguishing "no such account" from "wrong password" would turn this form
 * into a way to find out who works at the restaurant, so the action returns a
 * single code and this renders a single sentence.
 *
 * A plain `<form action={...}>`, so it submits without JavaScript. That is not
 * theoretical here: this is the screen a manager opens on the worst connection
 * in the building.
 */
export function LoginForm() {
  const [state, action] = useActionState<LoginResult | null, FormData>(signIn, null);

  return (
    <form action={action} className="mt-8 space-y-4">
      <div className="space-y-1.5">
        <label htmlFor="email" className="text-muted-foreground text-sm font-medium">
          {ADMIN_TEXT.login.email}
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="username"
          required
          className="bg-elevated h-12 w-full rounded-xl border border-white/8 px-4 text-base outline-none focus-visible:border-lime-500/60"
        />
      </div>

      <div className="space-y-1.5">
        <label htmlFor="password" className="text-muted-foreground text-sm font-medium">
          {ADMIN_TEXT.login.password}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          className="bg-elevated h-12 w-full rounded-xl border border-white/8 px-4 text-base outline-none focus-visible:border-lime-500/60"
        />
      </div>

      {/*
        Being locked out is the one failure worth telling apart from the rest.
        It is not a wrong password, the person cannot fix it by trying harder,
        and without saying so the screen tells a manager their password is wrong
        when it is not. It leaks nothing: an attacker already knows they have
        been trying.
      */}
      {state && !state.ok && (
        <p aria-live="polite" className="text-destructive text-sm">
          {state.code === 'RATE_LIMITED'
            ? `${ADMIN_TEXT.login.rateLimited} ${formatRetry(state.retryAt)}`
            : ADMIN_TEXT.login.failed}
        </p>
      )}

      <Submit />
    </form>
  );
}

/** "in 43 minutes", rounded up so it never promises sooner than it means. */
function formatRetry(retryAt: string): string {
  const minutes = Math.max(1, Math.ceil((new Date(retryAt).getTime() - Date.now()) / 60_000));
  return ADMIN_TEXT.login.retryIn.replace('{minutes}', String(minutes));
}

function Submit() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="bg-lime-500 text-primary-foreground hover:bg-lime-400 flex h-12 w-full items-center justify-center rounded-xl text-base font-bold transition-colors disabled:opacity-60"
    >
      {pending ? ADMIN_TEXT.login.submitting : ADMIN_TEXT.login.submit}
    </button>
  );
}
