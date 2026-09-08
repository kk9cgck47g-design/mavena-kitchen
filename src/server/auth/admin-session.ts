import { cookies } from 'next/headers';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcryptjs';

import { BROWSER_STORAGE_KEYS } from '@/lib/browser-storage';
import { IS_DEMO } from '@/lib/demo';
import type { AdminRole } from '@/lib/domain';
import { db } from '@/server/db/client';
import { adminUsers } from '@/server/db/schema';
import { authSecret, signSession, SESSION_TTL_MS, verifySession } from './session-token';

/**
 * Who is using the admin panel, and whether it may be used at all.
 *
 * Three states, not two, because "there is no password configured" must not
 * silently become "everyone is welcome":
 *
 *   - `demo`   — the published preview. There is no database and nothing to
 *                protect; the panel runs on generated orders and writes
 *                nowhere. No login, because there is nothing to log in to.
 *   - `ready`  — a real deployment with `AUTH_SECRET` set. Password required.
 *   - `unconfigured` — a real deployment without `AUTH_SECRET`. The panel
 *                refuses to render. This is the important one: an admin panel
 *                that quietly opens itself because a secret is missing is worse
 *                than one that will not open at all.
 */
export type AdminAvailability = 'demo' | 'ready' | 'unconfigured';

export function adminAvailability(): AdminAvailability {
  if (IS_DEMO) return 'demo';
  return authSecret() ? 'ready' : 'unconfigured';
}

export interface AdminSession {
  id: string;
  name: string;
  email: string;
  role: AdminRole;
}

const COOKIE = BROWSER_STORAGE_KEYS.adminSession;

/**
 * The signed-in user, re-read from the database on every request.
 *
 * Deliberately not trusting the token beyond the id it carries. The token says
 * "this browser knew the password eight hours ago"; whether that account still
 * exists and is still active is a question only the database can answer, and
 * the answer has to be current — disabling a member of staff has to take effect
 * on their next click, not in eight hours.
 */
export async function currentAdmin(): Promise<AdminSession | null> {
  if (IS_DEMO) return null;

  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const claims = await verifySession(token);
  if (!claims) return null;

  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.id, claims.userId))
    .limit(1);
  if (!user || !user.isActive) return null;

  /*
    Revocation, on a row this function was already reading.

    A token issued before the account's last revocation is refused however valid
    its signature is — which is what makes "sign out everywhere", a changed
    password and a deactivated account take effect on the next click rather than
    in eight hours. The comparison is `<`, so a token issued in the same
    millisecond as the revocation survives: the person doing the revoking should
    not sign themselves out by pressing it.
  */
  if (claims.issuedAt < user.sessionsValidFrom.getTime()) return null;

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

/**
 * Check a password against a stored hash.
 *
 * Runs bcrypt even when the email matched nothing, against a hash of the same
 * cost. Skipping it would make a wrong email answer measurably faster than a
 * wrong password, which turns the login form into a way to enumerate staff
 * accounts.
 */
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEe.qJXbXPAK3zJVL5wJbAqEGKp9CHFbSGO';

export async function verifyCredentials(
  email: string,
  password: string,
): Promise<AdminSession | null> {
  const [user] = await db
    .select()
    .from(adminUsers)
    .where(eq(adminUsers.email, email.trim().toLowerCase()))
    .limit(1);

  const matches = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);

  if (!user || !user.isActive || !matches) return null;

  await db.update(adminUsers).set({ lastLoginAt: new Date() }).where(eq(adminUsers.id, user.id));

  return { id: user.id, name: user.name, email: user.email, role: user.role };
}

export async function startSession(userId: string): Promise<void> {
  const store = await cookies();

  store.set(COOKIE, await signSession(userId), {
    httpOnly: true,
    // Lax rather than Strict: the panel is navigated to from bookmarks and
    // from a Telegram message later, and those top-level GETs should keep the
    // session. Nothing here is a cross-site form target.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });
}

export async function endSession(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
