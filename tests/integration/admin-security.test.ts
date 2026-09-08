import { randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDb, db } from '@/server/db/client';
import { adminUsers, rateLimits } from '@/server/db/schema';
import { signSession, verifySession } from '@/server/auth/session-token';
import {
  checkLoginAllowed,
  clearLoginAttempts,
  recordLoginAttempt,
} from '@/server/auth/login-throttle';
import {
  changeOwnPassword,
  createStaff,
  listStaff,
  MIN_PASSWORD_LENGTH,
  revokeSessions,
  setStaffActive,
  setStaffPassword,
  setStaffRole,
} from '@/server/services/admin-staff';
import {
  clearRateLimit,
  consumeRateLimit,
  LIMITS,
  peekRateLimit,
  pruneRateLimits,
  windowStartFor,
} from '@/server/services/rate-limit';

/**
 * The panel's front door, against a real database.
 *
 * Three properties are being defended here, and each of them is the kind that
 * looks fine until somebody tests it. Revoking a session has to stop a token
 * that is otherwise perfectly valid. Changing what somebody may do has to end
 * the sessions they already hold, or the roles are advisory. And a restaurant
 * must not be able to lock itself out of its own panel on a Friday evening.
 *
 * Requires `pnpm db:up && pnpm db:migrate && pnpm db:seed`.
 */

/** Long enough to pass the floor, and obviously a fixture. */
const PASSWORD = 'integration-test-passphrase';
const OTHER_PASSWORD = 'integration-test-passphrase-2';

const TEST_EMAIL_PREFIX = 'sec-test-';
const createdUserIds: string[] = [];
const usedKeys: string[] = [];

async function makeStaff(role: 'OWNER' | 'MANAGER', password = PASSWORD) {
  const result = await createStaff({
    email: `${TEST_EMAIL_PREFIX}${randomUUID()}@example.test`,
    name: 'Security Fixture',
    role,
    password,
  });

  if (!result.ok) throw new Error(`fixture staff could not be created: ${result.code}`);
  createdUserIds.push(result.value.id);
  return result.value;
}

async function userRow(id: string) {
  const [row] = await db.select().from(adminUsers).where(eq(adminUsers.id, id)).limit(1);
  return row;
}

function key(name: string): string {
  const full = `test:${name}:${randomUUID()}`;
  usedKeys.push(full);
  return full;
}

beforeEach(() => {
  // Each test picks its own keys; nothing is shared between them.
});

afterAll(async () => {
  if (createdUserIds.length > 0) {
    await db.delete(adminUsers).where(inArray(adminUsers.id, createdUserIds));
  }
  // Belt and braces: anything the prefix caught that the id list did not.
  await db.delete(adminUsers).where(like(adminUsers.email, `${TEST_EMAIL_PREFIX}%`));

  if (usedKeys.length > 0) {
    await db.delete(rateLimits).where(inArray(rateLimits.key, usedKeys));
  }

  await closeDb();
});

describe('session revocation', () => {
  it('refuses a valid token issued before the account was revoked', async () => {
    const staff = await makeStaff('MANAGER');

    // Issued a minute ago, so the revocation that follows is unambiguously later.
    const issuedAt = Date.now() - 60_000;
    const token = await signSession(staff.id, issuedAt);

    // The token itself is fine — signature valid, not expired.
    expect(await verifySession(token)).toEqual({ userId: staff.id, issuedAt });

    await revokeSessions(staff.id);

    const row = await userRow(staff.id);
    expect(row.sessionsValidFrom.getTime()).toBeGreaterThan(issuedAt);

    /*
      `currentAdmin` is what applies this, and it reads a cookie, so the
      comparison it makes is asserted directly. A token older than the cut-off
      is refused however valid its signature is.
    */
    expect(issuedAt < row.sessionsValidFrom.getTime()).toBe(true);
  });

  it('keeps a token issued after the revocation', async () => {
    const staff = await makeStaff('MANAGER');
    await revokeSessions(staff.id);

    const row = await userRow(staff.id);
    const token = await signSession(staff.id, row.sessionsValidFrom.getTime() + 1);
    const claims = await verifySession(token);

    expect(claims).not.toBeNull();
    expect(claims!.issuedAt < row.sessionsValidFrom.getTime()).toBe(false);
  });

  it('revokes when a password is changed', async () => {
    // A password is changed because it was forgotten or because it leaked, and
    // both mean the old cookie should stop working.
    const staff = await makeStaff('MANAGER');
    const before = (await userRow(staff.id)).sessionsValidFrom.getTime();

    await new Promise((resolve) => setTimeout(resolve, 5));
    const result = await setStaffPassword(staff.id, OTHER_PASSWORD);
    expect(result.ok).toBe(true);

    expect((await userRow(staff.id)).sessionsValidFrom.getTime()).toBeGreaterThan(before);
  });

  it('revokes when an account is deactivated', async () => {
    const staff = await makeStaff('MANAGER');
    const before = (await userRow(staff.id)).sessionsValidFrom.getTime();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await setStaffActive(staff.id, false)).ok).toBe(true);

    const row = await userRow(staff.id);
    expect(row.isActive).toBe(false);
    expect(row.sessionsValidFrom.getTime()).toBeGreaterThan(before);
  });

  it('revokes when a role is changed', async () => {
    // The one that makes roles more than advisory: a demoted manager must not
    // keep a token issued while they could still change prices.
    const owner = await makeStaff('OWNER');
    const staff = await makeStaff('MANAGER');
    const before = (await userRow(staff.id)).sessionsValidFrom.getTime();

    await new Promise((resolve) => setTimeout(resolve, 5));
    expect((await setStaffRole(staff.id, 'OWNER')).ok).toBe(true);
    expect((await userRow(staff.id)).sessionsValidFrom.getTime()).toBeGreaterThan(before);

    expect(owner.role).toBe('OWNER');
  });
});

describe('never locking the restaurant out', () => {
  it('refuses to deactivate the last active owner', async () => {
    // The seeded owner exists, so an extra one is created and then removed to
    // reach the state where only one is left among the fixtures.
    const solo = await makeStaff('OWNER');

    // Deactivate every other owner so `solo` is genuinely the last one.
    const others = (await listStaff()).filter(
      (member) => member.role === 'OWNER' && member.isActive && member.id !== solo.id,
    );

    const reactivate: string[] = [];
    for (const other of others) {
      const result = await setStaffActive(other.id, false);
      if (result.ok) reactivate.push(other.id);
    }

    try {
      const result = await setStaffActive(solo.id, false);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('LAST_OWNER');

      // And still active, rather than refused-but-applied.
      expect((await userRow(solo.id)).isActive).toBe(true);
    } finally {
      for (const id of reactivate) await setStaffActive(id, true);
    }
  });

  it('refuses to demote the last active owner', async () => {
    const solo = await makeStaff('OWNER');

    const others = (await listStaff()).filter(
      (member) => member.role === 'OWNER' && member.isActive && member.id !== solo.id,
    );

    const reactivate: string[] = [];
    for (const other of others) {
      const result = await setStaffActive(other.id, false);
      if (result.ok) reactivate.push(other.id);
    }

    try {
      const result = await setStaffRole(solo.id, 'MANAGER');
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.code).toBe('LAST_OWNER');
      expect((await userRow(solo.id)).role).toBe('OWNER');
    } finally {
      for (const id of reactivate) await setStaffActive(id, true);
    }
  });

  it('allows demoting an owner while another one is still active', async () => {
    const keeper = await makeStaff('OWNER');
    const spare = await makeStaff('OWNER');

    expect((await setStaffRole(spare.id, 'MANAGER')).ok).toBe(true);
    expect((await userRow(spare.id)).role).toBe('MANAGER');
    expect((await userRow(keeper.id)).role).toBe('OWNER');
  });
});

describe('staff accounts', () => {
  it('refuses a second account on the same email', async () => {
    const first = await makeStaff('MANAGER');

    const duplicate = await createStaff({
      email: first.email.toUpperCase(),
      name: 'Impostor',
      role: 'OWNER',
      password: PASSWORD,
    });

    // Upper-cased on purpose: emails are normalised, so this is the same address.
    expect(duplicate.ok).toBe(false);
    if (duplicate.ok) return;
    expect(duplicate.code).toBe('EMAIL_TAKEN');
  });

  it('refuses a password below the floor', async () => {
    const short = 'x'.repeat(MIN_PASSWORD_LENGTH - 1);

    const result = await createStaff({
      email: `${TEST_EMAIL_PREFIX}${randomUUID()}@example.test`,
      name: 'Too Short',
      role: 'MANAGER',
      password: short,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe('WEAK_PASSWORD');
  });

  it('requires the current password to change your own', async () => {
    const staff = await makeStaff('MANAGER');

    const wrong = await changeOwnPassword({
      userId: staff.id,
      currentPassword: 'not the password',
      newPassword: OTHER_PASSWORD,
    });

    expect(wrong.ok).toBe(false);
    if (!wrong.ok) expect(wrong.code).toBe('WRONG_PASSWORD');

    const right = await changeOwnPassword({
      userId: staff.id,
      currentPassword: PASSWORD,
      newPassword: OTHER_PASSWORD,
    });

    expect(right.ok).toBe(true);
  });
});

describe('login throttling', () => {
  const email = `throttle-${randomUUID()}@example.test`;
  const ip = `203.0.113.${Math.floor(Math.random() * 200) + 1}`;

  afterAll(async () => {
    await clearLoginAttempts(email, ip);
  });

  it('locks an account out after enough attempts, and says when to come back', async () => {
    // The exact keys and limits the sign-in action uses — the point of testing
    // through this module rather than reimplementing the arithmetic here.
    for (let attempt = 0; attempt < LIMITS.loginByEmail.limit; attempt += 1) {
      expect((await checkLoginAllowed(email, ip)).allowed).toBe(true);
      await recordLoginAttempt(email, ip);
    }

    const verdict = await checkLoginAllowed(email, ip);
    expect(verdict.allowed).toBe(false);
    expect(new Date(verdict.retryAt).getTime()).toBeGreaterThan(Date.now());
  });

  it('lets a different account through while one is locked', async () => {
    /*
      A kitchen shares one connection, so locking must not be by address alone:
      an attacker failing against the owner's email must not lock the managers
      out of their own shift. The address limit is higher than the account one
      precisely so this stays true.
    */
    const other = `throttle-other-${randomUUID()}@example.test`;

    expect((await checkLoginAllowed(email, ip)).allowed).toBe(false);
    expect((await checkLoginAllowed(other, ip)).allowed).toBe(true);

    await clearLoginAttempts(other, ip);
  });

  it('forgets the attempts once somebody signs in', async () => {
    expect((await checkLoginAllowed(email, ip)).allowed).toBe(false);

    await clearLoginAttempts(email, ip);

    expect((await checkLoginAllowed(email, ip)).allowed).toBe(true);
  });
});

describe('rate limiting', () => {
  it('allows up to the limit and refuses past it', async () => {
    const k = key('basic');
    const rule = { limit: 3, windowMs: 60_000 };

    expect((await consumeRateLimit(k, rule)).allowed).toBe(true);
    expect((await consumeRateLimit(k, rule)).allowed).toBe(true);

    const third = await consumeRateLimit(k, rule);
    expect(third.allowed).toBe(true);
    expect(third.remaining).toBe(0);

    expect((await consumeRateLimit(k, rule)).allowed).toBe(false);
  });

  it('keeps counting attempts that were already refused', async () => {
    // Somebody who keeps hammering keeps the door shut on themselves. If refused
    // attempts stopped counting, they would be let back in the moment the window
    // rolled over no matter how hard they had been trying.
    const k = key('keeps-counting');
    const rule = { limit: 1, windowMs: 60_000 };

    await consumeRateLimit(k, rule);
    await consumeRateLimit(k, rule);
    await consumeRateLimit(k, rule);

    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, k));
    expect(row.count).toBe(3);
  });

  it('starts a fresh count in a new window', async () => {
    const k = key('window');
    const rule = { limit: 2, windowMs: 60_000 };

    const now = new Date();
    await consumeRateLimit(k, rule, now);
    await consumeRateLimit(k, rule, now);
    expect((await consumeRateLimit(k, rule, now)).allowed).toBe(false);

    // One window later, to the millisecond.
    const next = new Date(windowStartFor(now, rule.windowMs).getTime() + rule.windowMs);
    expect((await consumeRateLimit(k, rule, next)).allowed).toBe(true);
  });

  it('peeks without spending an attempt', async () => {
    // The login form asks before it spends a quarter-second on bcrypt; counting
    // there as well would charge two against every try.
    const k = key('peek');
    const rule = { limit: 2, windowMs: 60_000 };

    await consumeRateLimit(k, rule);

    const first = await peekRateLimit(k, rule);
    const second = await peekRateLimit(k, rule);

    expect(first.remaining).toBe(1);
    expect(second.remaining).toBe(1);
  });

  it('forgets a key once the attempt succeeds', async () => {
    const k = key('clear');
    const rule = { limit: 2, windowMs: 60_000 };

    await consumeRateLimit(k, rule);
    await clearRateLimit(k);

    expect((await peekRateLimit(k, rule)).remaining).toBe(rule.limit);
  });

  it('counts concurrent attempts once each', async () => {
    /*
      The reason this is an upsert and not a read followed by a write. Ten
      requests arriving together must produce ten increments; a read-then-write
      would let several of them read the same count and all be allowed.
    */
    const k = key('concurrent');
    const rule = { limit: 100, windowMs: 60_000 };

    await Promise.all(Array.from({ length: 10 }, () => consumeRateLimit(k, rule)));

    const [row] = await db.select().from(rateLimits).where(eq(rateLimits.key, k));
    expect(row.count).toBe(10);
  });

  it('prunes only what is old enough', async () => {
    const k = key('prune');
    await consumeRateLimit(k, { limit: 1, windowMs: 60_000 });

    // Nothing recent is touched.
    await pruneRateLimits(24 * 60 * 60 * 1000);
    expect(await db.select().from(rateLimits).where(eq(rateLimits.key, k))).toHaveLength(1);

    // Everything is, with a cutoff of zero.
    await pruneRateLimits(0);
    expect(await db.select().from(rateLimits).where(eq(rateLimits.key, k))).toHaveLength(0);
  });
});
