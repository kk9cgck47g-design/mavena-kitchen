import { asc, eq, ne, and, count } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import type { AdminRole } from '@/lib/domain';
import { db } from '@/server/db/client';
import { isUniqueViolation } from '@/server/db/errors';
import { adminUsers } from '@/server/db/schema';

/**
 * Staff accounts.
 *
 * Until now the only way to create one was the seed, and the seed deleted every
 * account before it wrote one — so adding a manager meant either wiping the
 * owner or opening a SQL prompt. That is not a gap in convenience; it is the
 * reason roles were never worth enforcing, because there was never more than one
 * account to distinguish.
 *
 * Two invariants hold across everything here.
 *
 * **There is always at least one active owner.** Every path that could remove
 * the last one is refused: deactivating yourself as the only owner, demoting
 * yourself as the only owner. A restaurant locked out of its own panel at seven
 * on a Friday has no recovery that does not involve a database console.
 *
 * **Changing what somebody may do ends their current sessions.** A demoted
 * manager or a deactivated account keeping a working cookie for the rest of the
 * shift would make the whole role system advisory. `sessionsValidFrom` moves on
 * every change, and `currentAdmin` refuses tokens older than it.
 */

/** bcrypt cost. Matches the seed; ~250ms per hash, which is the point. */
const BCRYPT_ROUNDS = 12;

/**
 * The shortest password this system will store.
 *
 * Twelve, not eight. There is no second factor here and no lockout beyond the
 * rate limit, so length is doing most of the work — and these are a handful of
 * accounts typed rarely, not something anybody has to key in hourly.
 */
export const MIN_PASSWORD_LENGTH = 12;

export interface StaffMember {
  id: string;
  email: string;
  name: string;
  role: AdminRole;
  isActive: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

export type StaffError =
  | 'EMAIL_TAKEN'
  | 'NOT_FOUND'
  | 'WEAK_PASSWORD'
  | 'LAST_OWNER'
  | 'WRONG_PASSWORD';

export type StaffResult<T = void> = { ok: true; value: T } | { ok: false; code: StaffError };

export async function listStaff(): Promise<StaffMember[]> {
  const rows = await db.select().from(adminUsers).orderBy(asc(adminUsers.createdAt));

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }));
}

export async function createStaff(input: {
  email: string;
  name: string;
  role: AdminRole;
  password: string;
}): Promise<StaffResult<StaffMember>> {
  if (input.password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: 'WEAK_PASSWORD' };

  const email = normaliseEmail(input.email);
  const passwordHash = await bcrypt.hash(input.password, BCRYPT_ROUNDS);

  try {
    const [row] = await db
      .insert(adminUsers)
      .values({ email, name: input.name.trim(), role: input.role, passwordHash })
      .returning();

    return { ok: true, value: toStaffMember(row) };
  } catch (error) {
    // The unique index is the check. Looking first and inserting after would
    // leave a gap two simultaneous creations could both pass through.
    if (isUniqueViolation(error)) return { ok: false, code: 'EMAIL_TAKEN' };
    throw error;
  }
}

/**
 * Turn an account on or off.
 *
 * Deactivating is the delete: rows are kept because `order_events.byUserId`
 * points at them, and a departed manager's name should stay on the status
 * changes they made.
 */
export async function setStaffActive(userId: string, isActive: boolean): Promise<StaffResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .for('update')
      .limit(1);

    if (!user) return { ok: false, code: 'NOT_FOUND' } as const;

    // Counted inside the transaction and against the other rows, so two owners
    // deactivating each other at the same moment cannot both succeed.
    if (!isActive && user.role === 'OWNER' && !(await hasAnotherActiveOwner(tx, userId))) {
      return { ok: false, code: 'LAST_OWNER' } as const;
    }

    await tx
      .update(adminUsers)
      .set({
        isActive,
        // Deactivation has to bite now, not at the end of their shift.
        sessionsValidFrom: isActive ? user.sessionsValidFrom : new Date(),
      })
      .where(eq(adminUsers.id, userId));

    return { ok: true, value: undefined } as const;
  });
}

export async function setStaffRole(userId: string, role: AdminRole): Promise<StaffResult> {
  return db.transaction(async (tx) => {
    const [user] = await tx
      .select()
      .from(adminUsers)
      .where(eq(adminUsers.id, userId))
      .for('update')
      .limit(1);

    if (!user) return { ok: false, code: 'NOT_FOUND' } as const;

    if (user.role === 'OWNER' && role !== 'OWNER' && !(await hasAnotherActiveOwner(tx, userId))) {
      return { ok: false, code: 'LAST_OWNER' } as const;
    }

    await tx
      .update(adminUsers)
      // A demoted manager must not keep a token that was issued while they could
      // still change prices.
      .set({ role, sessionsValidFrom: new Date() })
      .where(eq(adminUsers.id, userId));

    return { ok: true, value: undefined } as const;
  });
}

/**
 * Set somebody else's password. The owner's reset path.
 *
 * Ends their sessions, because a password is changed either because it was
 * forgotten or because it was exposed, and both mean the old cookie should stop
 * working.
 */
export async function setStaffPassword(userId: string, password: string): Promise<StaffResult> {
  if (password.length < MIN_PASSWORD_LENGTH) return { ok: false, code: 'WEAK_PASSWORD' };

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);

  const updated = await db
    .update(adminUsers)
    .set({ passwordHash, sessionsValidFrom: new Date() })
    .where(eq(adminUsers.id, userId))
    .returning({ id: adminUsers.id });

  return updated.length > 0
    ? { ok: true, value: undefined }
    : { ok: false, code: 'NOT_FOUND' };
}

/**
 * Change your own password, having proved you know the current one.
 *
 * The current-password check is what stops a borrowed unlocked screen from
 * becoming a permanent takeover.
 */
export async function changeOwnPassword(args: {
  userId: string;
  currentPassword: string;
  newPassword: string;
}): Promise<StaffResult> {
  if (args.newPassword.length < MIN_PASSWORD_LENGTH) return { ok: false, code: 'WEAK_PASSWORD' };

  const [user] = await db.select().from(adminUsers).where(eq(adminUsers.id, args.userId)).limit(1);
  if (!user) return { ok: false, code: 'NOT_FOUND' };

  if (!(await bcrypt.compare(args.currentPassword, user.passwordHash))) {
    return { ok: false, code: 'WRONG_PASSWORD' };
  }

  return setStaffPassword(args.userId, args.newPassword);
}

/**
 * Invalidate every token this account holds.
 *
 * The caller signs the person back in afterwards if it is their own session
 * being ended — see the note in `currentAdmin` about the comparison being
 * strict, which is what lets a freshly issued token survive its own revocation.
 */
export async function revokeSessions(userId: string): Promise<void> {
  await db
    .update(adminUsers)
    .set({ sessionsValidFrom: new Date() })
    .where(eq(adminUsers.id, userId));
}

// --- Helpers ---------------------------------------------------------------

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function hasAnotherActiveOwner(tx: Tx, excludingUserId: string): Promise<boolean> {
  const [row] = await tx
    .select({ value: count() })
    .from(adminUsers)
    .where(
      and(
        eq(adminUsers.role, 'OWNER'),
        eq(adminUsers.isActive, true),
        ne(adminUsers.id, excludingUserId),
      ),
    );

  return (row?.value ?? 0) > 0;
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}


function toStaffMember(row: typeof adminUsers.$inferSelect): StaffMember {
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    isActive: row.isActive,
    lastLoginAt: row.lastLoginAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

