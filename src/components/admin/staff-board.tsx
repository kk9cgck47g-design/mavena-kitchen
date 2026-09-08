'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { KeyRound, ShieldCheck, UserPlus } from 'lucide-react';

import {
  addStaff,
  changeMyPassword,
  changeStaffActive,
  changeStaffRole,
  resetStaffPassword,
  signOutEverywhere,
  type StaffActionResult,
} from '@/app/admin/actions';
import { ADMIN_TEXT } from '@/app/admin/strings';
import type { AdminRole } from '@/lib/domain';
import type { StaffMember } from '@/server/services/admin-staff';
import { cn } from '@/lib/utils';
import { Card } from './admin-ui';

/**
 * Who can get in, and what they can change once they are.
 *
 * The screen exists because until now there was no way to add a second account
 * without a SQL prompt — which is also why the roles it manages were never worth
 * enforcing. Nothing here is clever; what it has to be is unambiguous, because
 * the owner using it is deciding who can change prices.
 *
 * Two things are stated on the screen rather than left to be discovered. Every
 * change here ends that person's sessions immediately, and passwords are handed
 * over in person — there is no email on this system and therefore no reset link.
 */

export function StaffBoard({ staff, currentUserId }: { staff: StaffMember[]; currentUserId: string }) {
  return (
    <div className="space-y-5">
      <p className="text-muted-foreground border-white/8 rounded-2xl border border-dashed p-4 text-sm leading-relaxed">
        {ADMIN_TEXT.staff.sessionsNote}
      </p>

      <AddStaffForm />

      <div className="space-y-3">
        {staff.map((member) => (
          <StaffRow key={member.id} member={member} isSelf={member.id === currentUserId} />
        ))}
      </div>

      <MyPasswordCard />
    </div>
  );
}

function AddStaffForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AdminRole>('MANAGER');
  const [password, setPassword] = useState('');

  function submit() {
    setError(null);
    setDone(false);

    startTransition(async () => {
      const result = await addStaff({ email, name, role, password });

      if (!result.ok) {
        setError(messageFor(result));
        return;
      }

      setEmail('');
      setName('');
      setPassword('');
      setRole('MANAGER');
      setDone(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-bold">
        <UserPlus className="size-4" />
        {ADMIN_TEXT.staff.add}
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={ADMIN_TEXT.staff.name}>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={80}
            className={FIELD}
          />
        </Field>

        <Field label={ADMIN_TEXT.staff.email}>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="off"
            maxLength={160}
            className={FIELD}
          />
        </Field>

        <Field label={ADMIN_TEXT.staff.role}>
          <select
            value={role}
            onChange={(event) => setRole(event.target.value as AdminRole)}
            className={FIELD}
          >
            <option value="MANAGER">{ADMIN_TEXT.staff.roleManager}</option>
            <option value="OWNER">{ADMIN_TEXT.staff.roleOwner}</option>
          </select>
        </Field>

        <Field label={ADMIN_TEXT.staff.password}>
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="text"
            /* Deliberately not a password field and deliberately not autofilled:
               the owner is typing a password *for somebody else* and has to be
               able to read it back to them. A masked field here produces typos
               that surface as "I cannot log in" tomorrow. */
            autoComplete="off"
            maxLength={200}
            className={FIELD}
          />
        </Field>
      </div>

      <p className="text-muted-foreground mt-2 text-xs">{ADMIN_TEXT.staff.passwordHint}</p>

      <button
        type="button"
        disabled={pending}
        onClick={submit}
        className="bg-lime-500 text-primary-foreground hover:bg-lime-400 mt-4 flex min-h-11 items-center rounded-xl px-4 text-sm font-bold transition-colors disabled:opacity-50"
      >
        {pending ? ADMIN_TEXT.staff.adding : ADMIN_TEXT.staff.add}
      </button>

      <Feedback error={error} done={done ? ADMIN_TEXT.staff.added : null} />
    </Card>
  );
}

function StaffRow({ member, isSelf }: { member: StaffMember; isSelf: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [password, setPassword] = useState('');

  function run(action: () => Promise<StaffActionResult>) {
    setError(null);
    setDone(false);

    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(messageFor(result));
        return;
      }
      setResetting(false);
      setPassword('');
      setDone(true);
      router.refresh();
    });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <div className="min-w-0">
          <p className="font-semibold">
            {member.name}
            {isSelf && <span className="text-muted-foreground font-normal"> · вы</span>}
          </p>
          <p className="text-muted-foreground text-sm break-all">{member.email}</p>
        </div>

        <div className="flex items-center gap-2">
          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-bold',
              member.role === 'OWNER'
                ? 'bg-lime-500/15 text-lime-400 border border-lime-500/30'
                : 'bg-white/8 text-muted-foreground border border-white/10',
            )}
          >
            {member.role === 'OWNER' ? ADMIN_TEXT.staff.roleOwner : ADMIN_TEXT.staff.roleManager}
          </span>

          <span
            className={cn(
              'rounded-full px-2.5 py-1 text-xs font-bold',
              member.isActive
                ? 'bg-white/8 text-muted-foreground border border-white/10'
                : 'bg-destructive/12 text-destructive border-destructive/30 border',
            )}
          >
            {member.isActive ? ADMIN_TEXT.staff.active : ADMIN_TEXT.staff.inactive}
          </span>
        </div>
      </div>

      <p className="text-muted-foreground mt-2 text-xs tabular-nums">
        {ADMIN_TEXT.staff.lastLogin}:{' '}
        {member.lastLoginAt
          ? new Date(member.lastLoginAt).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
          : ADMIN_TEXT.staff.never}
      </p>

      <div className="mt-3 flex flex-wrap gap-2">
        <SmallButton
          disabled={pending}
          onClick={() =>
            run(() => changeStaffActive({ userId: member.id, isActive: !member.isActive }))
          }
        >
          {member.isActive ? ADMIN_TEXT.staff.disable : ADMIN_TEXT.staff.enable}
        </SmallButton>

        <SmallButton
          disabled={pending}
          onClick={() =>
            run(() =>
              changeStaffRole({
                userId: member.id,
                role: member.role === 'OWNER' ? 'MANAGER' : 'OWNER',
              }),
            )
          }
        >
          {member.role === 'OWNER' ? ADMIN_TEXT.staff.makeManager : ADMIN_TEXT.staff.makeOwner}
        </SmallButton>

        <SmallButton disabled={pending} onClick={() => setResetting((open) => !open)}>
          {ADMIN_TEXT.staff.resetPassword}
        </SmallButton>
      </div>

      {resetting && (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <div className="min-w-0 flex-1">
            <Field label={ADMIN_TEXT.staff.password}>
              <input
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                type="text"
                autoComplete="off"
                maxLength={200}
                className={FIELD}
              />
            </Field>
          </div>
          <SmallButton
            disabled={pending}
            onClick={() => run(() => resetStaffPassword({ userId: member.id, password }))}
          >
            {pending ? ADMIN_TEXT.staff.saving : ADMIN_TEXT.staff.saved}
          </SmallButton>
        </div>
      )}

      <Feedback error={error} done={done ? ADMIN_TEXT.staff.saved : null} />
    </Card>
  );
}

function MyPasswordCard() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  function run(action: () => Promise<StaffActionResult>, success: string) {
    setError(null);
    setMessage(null);

    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(messageFor(result));
        return;
      }
      setCurrentPassword('');
      setNewPassword('');
      setMessage(success);
      router.refresh();
    });
  }

  return (
    <Card>
      <h2 className="flex items-center gap-2 font-bold">
        <KeyRound className="size-4" />
        {ADMIN_TEXT.staff.myPassword}
      </h2>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label={ADMIN_TEXT.staff.currentPassword}>
          <input
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            type="password"
            autoComplete="current-password"
            maxLength={200}
            className={FIELD}
          />
        </Field>

        <Field label={ADMIN_TEXT.staff.newPassword}>
          <input
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            type="password"
            autoComplete="new-password"
            maxLength={200}
            className={FIELD}
          />
        </Field>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <SmallButton
          disabled={pending}
          onClick={() =>
            run(
              () => changeMyPassword({ currentPassword, newPassword }),
              ADMIN_TEXT.staff.passwordChanged,
            )
          }
        >
          {ADMIN_TEXT.staff.changePassword}
        </SmallButton>

        <SmallButton
          disabled={pending}
          onClick={() => run(signOutEverywhere, ADMIN_TEXT.staff.signedOutEverywhere)}
        >
          <ShieldCheck className="size-3.5" />
          {ADMIN_TEXT.staff.signOutEverywhere}
        </SmallButton>
      </div>

      <Feedback error={error} done={message} />
    </Card>
  );
}

// --- Small pieces ----------------------------------------------------------

const FIELD =
  'bg-elevated w-full rounded-xl border border-white/8 px-3 py-2.5 text-base outline-none focus-visible:border-lime-500/60 sm:text-sm';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-muted-foreground mb-1 block text-xs font-semibold tracking-wide uppercase">
        {label}
      </span>
      {children}
    </label>
  );
}

function SmallButton({
  disabled,
  onClick,
  children,
}: {
  disabled?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="bg-elevated flex min-h-11 items-center gap-1.5 rounded-xl border border-white/8 px-4 text-sm font-semibold transition-colors hover:bg-white/8 disabled:opacity-50"
    >
      {children}
    </button>
  );
}

function Feedback({ error, done }: { error: string | null; done: string | null }) {
  if (!error && !done) return null;

  return (
    <p
      aria-live="polite"
      className={cn('mt-3 text-sm', error ? 'text-destructive' : 'text-lime-400')}
    >
      {error ?? done}
    </p>
  );
}

function messageFor(result: Extract<StaffActionResult, { ok: false }>): string {
  return ADMIN_TEXT.staff.errors[result.code] ?? ADMIN_TEXT.staff.errors.INVALID;
}
