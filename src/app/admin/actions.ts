'use server';

import { redirect } from 'next/navigation';
import { revalidatePath, updateTag } from 'next/cache';
import { z } from 'zod';

import { IS_DEMO } from '@/lib/demo';
import {
  ADMIN_ROLES,
  ORDER_STATUSES,
  satisfiesRole,
  type AdminRole,
  type OrderStatus,
} from '@/lib/domain';
import {
  adminAvailability,
  currentAdmin,
  endSession,
  startSession,
  verifyCredentials,
  type AdminSession,
} from '@/server/auth/admin-session';
import {
  checkLoginAllowed,
  clearLoginAttempts,
  recordLoginAttempt,
} from '@/server/auth/login-throttle';
import { clientIp } from '@/server/http/client-ip';
import { setDishAvailability, setDishPrice } from '@/server/services/admin-menu';
import {
  changeOwnPassword,
  createStaff,
  MIN_PASSWORD_LENGTH,
  revokeSessions,
  setStaffActive,
  setStaffPassword,
  setStaffRole,
} from '@/server/services/admin-staff';
import { updateOrderStatus } from '@/server/services/orders';
import { confirmPayment, paymentsForOrder } from '@/server/services/payments';
import { MENU_CACHE_TAG } from '@/server/services/menu';
import {
  isValidChatId,
  setAcceptingOrders,
  SETTINGS_CACHE_TAG,
  setTelegramChatIds,
} from '@/server/services/settings';
import { isTelegramConfigured } from '@/server/telegram/config';
import { dispatchForOrder, dispatchNotification, sendTestMessage } from '@/server/telegram/dispatch';
import { notificationsForOrder, requeue } from '@/server/telegram/outbox';

/**
 * Everything the staff panel can change.
 *
 * Two rules hold for every action in this file, and they are checked here
 * rather than in the components that call them. A server action is a public
 * POST endpoint: the fact that our own UI only renders a button when it is
 * legal to press is a nicety for the user, not a control.
 *
 *   1. A session is required. `guard()` is the first line of each one.
 *   2. The demo cannot write. It has no database, its panel changes state in
 *      the browser, and none of these are called from it — but if one ever
 *      were, it refuses before it reaches a service.
 */

type Guarded =
  | { ok: true; admin: AdminSession }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' };

/**
 * @param require the minimum role. Omitted means any signed-in member of staff.
 *
 * A role checked here and not only in the page that renders the button, because
 * a server action is a public POST endpoint: hiding a control decides what a
 * manager sees, and this decides what they can do.
 */
async function guard(options: { require?: AdminRole } = {}): Promise<Guarded> {
  if (IS_DEMO) return { ok: false, code: 'DEMO_MODE' };
  if (adminAvailability() !== 'ready') return { ok: false, code: 'FORBIDDEN' };

  const admin = await currentAdmin();
  if (!admin) return { ok: false, code: 'FORBIDDEN' };

  if (options.require && !satisfiesRole(admin.role, options.require)) {
    return { ok: false, code: 'FORBIDDEN' };
  }

  return { ok: true, admin };
}

// --- Session --------------------------------------------------------------

const credentialsSchema = z.object({
  email: z.string().trim().min(3).max(160),
  password: z.string().min(1).max(200),
});

export type LoginResult =
  | { ok: true }
  | { ok: false; code: 'INVALID' | 'UNAVAILABLE' }
  /** Too many attempts. `retryAt` is when the window resets, as an ISO string. */
  | { ok: false; code: 'RATE_LIMITED'; retryAt: string };

export async function signIn(_previous: unknown, formData: FormData): Promise<LoginResult> {
  if (adminAvailability() !== 'ready') return { ok: false, code: 'UNAVAILABLE' };

  const parsed = credentialsSchema.safeParse({
    email: formData.get('email'),
    password: formData.get('password'),
  });

  // One message for a bad email, a bad password and a malformed form. Telling
  // them apart would turn this into a way to find out who works here.
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  const email = parsed.data.email.trim().toLowerCase();
  const ip = await clientIp();

  // Before bcrypt, deliberately. See `login-throttle.ts` for why the order of
  // these three calls is the whole of the protection.
  const verdict = await checkLoginAllowed(email, ip);
  if (!verdict.allowed) return { ok: false, code: 'RATE_LIMITED', retryAt: verdict.retryAt };

  await recordLoginAttempt(email, ip);

  const admin = await verifyCredentials(email, parsed.data.password);
  if (!admin) return { ok: false, code: 'INVALID' };

  await clearLoginAttempts(email, ip);

  await startSession(admin.id);
  redirect('/admin');
}

export async function signOut(): Promise<void> {
  await endSession();
  redirect('/admin/login');
}

// --- Orders ---------------------------------------------------------------

export type StatusChangeResult =
  | { ok: true; status: OrderStatus }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID' | 'NOT_FOUND' | 'ILLEGAL_TRANSITION' };

const statusChangeSchema = z.object({
  orderId: z.uuid(),
  to: z.enum(ORDER_STATUSES),
  note: z.string().trim().max(300).optional(),
});

/**
 * Move an order along.
 *
 * The transition itself is decided by `updateOrderStatus`, inside a transaction
 * that re-reads the row: two managers tapping different buttons at the same
 * moment cannot both win, and a stale tab cannot move a delivered order back
 * into the kitchen. Nothing about the state machine is restated here.
 */
export async function changeOrderStatus(payload: unknown): Promise<StatusChangeResult> {
  const allowed = await guard();
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = statusChangeSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  const admin = await currentAdmin();

  const result = await updateOrderStatus({
    orderId: parsed.data.orderId,
    to: parsed.data.to,
    byUserId: admin?.id ?? null,
    note: parsed.data.note ?? null,
    source: 'ADMIN',
  });

  if (!result.ok) return { ok: false, code: result.code };

  // The list and the detail page both show this status.
  revalidatePath('/admin/orders');
  revalidatePath(`/admin/orders/${parsed.data.orderId}`);
  revalidatePath('/admin');

  return { ok: true, status: result.order.status };
}

// --- Ordering pause -------------------------------------------------------

export type PauseResult =
  | { ok: true; isAcceptingOrders: boolean }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID' };

/**
 * Stop the site taking orders, or start again.
 *
 * Owner-only, because it decides whether the business is trading. A manager
 * whose evening is going badly should be telephoning the owner, not closing the
 * shop.
 *
 * The tag update is what makes it a switch rather than a suggestion: the settings
 * row is cached, and without this the site would keep accepting orders for up to
 * a minute after the kitchen said stop. `updateTag` expires immediately, so the
 * next customer to load the checkout sees it.
 */
export async function setOrderingPaused(payload: unknown): Promise<PauseResult> {
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = z.object({ isAcceptingOrders: z.boolean() }).safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  await setAcceptingOrders(parsed.data.isAcceptingOrders);

  updateTag(SETTINGS_CACHE_TAG);
  revalidatePath('/admin/settings');

  return { ok: true, isAcceptingOrders: parsed.data.isAcceptingOrders };
}

// --- Staff ----------------------------------------------------------------

export type StaffActionResult =
  | { ok: true }
  | {
      ok: false;
      code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID' | 'EMAIL_TAKEN' | 'NOT_FOUND' | 'WEAK_PASSWORD' | 'LAST_OWNER' | 'WRONG_PASSWORD';
    };

const newStaffSchema = z.object({
  email: z.email().max(160),
  name: z.string().trim().min(2).max(80),
  role: z.enum(ADMIN_ROLES),
  password: z.string().min(MIN_PASSWORD_LENGTH).max(200),
});

/**
 * Everything on this screen is owner-only, and every one of these ends the
 * affected person's sessions — see `admin-staff.ts` for why a demoted manager
 * keeping a working cookie would make the roles advisory.
 */
export async function addStaff(payload: unknown): Promise<StaffActionResult> {
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = newStaffSchema.safeParse(payload);
  if (!parsed.success) {
    // A password below the floor is worth saying out loud; the owner can fix it.
    // Everything else about the form is our own UI's problem.
    const weak = parsed.error.issues.some((issue) => issue.path[0] === 'password');
    return { ok: false, code: weak ? 'WEAK_PASSWORD' : 'INVALID' };
  }

  const result = await createStaff(parsed.data);
  if (!result.ok) return { ok: false, code: result.code };

  revalidatePath('/admin/staff');
  return { ok: true };
}

export async function changeStaffActive(payload: unknown): Promise<StaffActionResult> {
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = z.object({ userId: z.uuid(), isActive: z.boolean() }).safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  const result = await setStaffActive(parsed.data.userId, parsed.data.isActive);
  if (!result.ok) return { ok: false, code: result.code };

  revalidatePath('/admin/staff');
  return { ok: true };
}

export async function changeStaffRole(payload: unknown): Promise<StaffActionResult> {
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = z.object({ userId: z.uuid(), role: z.enum(ADMIN_ROLES) }).safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  const result = await setStaffRole(parsed.data.userId, parsed.data.role);
  if (!result.ok) return { ok: false, code: result.code };

  revalidatePath('/admin/staff');
  return { ok: true };
}

/** The owner resetting somebody else's forgotten password. */
export async function resetStaffPassword(payload: unknown): Promise<StaffActionResult> {
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = z
    .object({ userId: z.uuid(), password: z.string().min(MIN_PASSWORD_LENGTH).max(200) })
    .safeParse(payload);

  if (!parsed.success) return { ok: false, code: 'WEAK_PASSWORD' };

  const result = await setStaffPassword(parsed.data.userId, parsed.data.password);
  if (!result.ok) return { ok: false, code: result.code };

  revalidatePath('/admin/staff');
  return { ok: true };
}

/**
 * Changing your own password. Any signed-in member of staff, not just the owner.
 *
 * Ends every session including this browser's, then issues a fresh one — so the
 * person doing it stays signed in here and is signed out everywhere else, which
 * is what somebody changing a password because it leaked actually wants.
 */
export async function changeMyPassword(payload: unknown): Promise<StaffActionResult> {
  const allowed = await guard();
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = z
    .object({
      currentPassword: z.string().min(1).max(200),
      newPassword: z.string().min(MIN_PASSWORD_LENGTH).max(200),
    })
    .safeParse(payload);

  if (!parsed.success) return { ok: false, code: 'WEAK_PASSWORD' };

  const result = await changeOwnPassword({
    userId: allowed.admin.id,
    currentPassword: parsed.data.currentPassword,
    newPassword: parsed.data.newPassword,
  });

  if (!result.ok) return { ok: false, code: result.code };

  // Issued after the revocation, so this token is newer than the cut-off. See
  // the note in `currentAdmin` about the comparison being strict.
  await startSession(allowed.admin.id);

  return { ok: true };
}

/** Sign out of every other device. Same mechanism, without the password change. */
export async function signOutEverywhere(): Promise<StaffActionResult> {
  const allowed = await guard();
  if (!allowed.ok) return { ok: false, code: allowed.code };

  await revokeSessions(allowed.admin.id);
  await startSession(allowed.admin.id);

  return { ok: true };
}

// --- Payments -------------------------------------------------------------

export type CheckPaymentResult =
  | { ok: true; outcome: string }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID' | 'UNAVAILABLE' };

/**
 * Ask the provider about this order's payment, now.
 *
 * The manual half of reconciliation, and it exists for one situation: a customer
 * is on the phone saying they paid, and the sweep runs in four minutes. It calls
 * the same `confirmPayment` the sweep and the return handler call — there is one
 * implementation of "did this get paid?", and pressing a button is not a second
 * way of deciding it.
 *
 * Safe to press repeatedly, including on an order that is already paid: the
 * function it delegates to re-reads the row under a lock and does nothing twice.
 * If the money turns out to be there, the order moves to `NEW` and the kitchen
 * ticket is queued and sent from here, exactly as it would have been by the sweep.
 */
export async function checkOrderPayment(orderId: unknown): Promise<CheckPaymentResult> {
  const allowed = await guard();
  if (!allowed.ok) return { ok: false, code: allowed.code };

  if (typeof orderId !== 'string' || !z.uuid().safeParse(orderId).success) {
    return { ok: false, code: 'INVALID' };
  }

  const attempts = await paymentsForOrder(orderId);

  // Oldest first from the service; the interesting one is whichever is still
  // pending, and failing that the most recent.
  const target = attempts.find((attempt) => attempt.status === 'PENDING') ?? attempts.at(-1);
  if (!target) return { ok: false, code: 'UNAVAILABLE' };

  const outcome = await confirmPayment(target.id);

  // A payment that has just been confirmed has queued a kitchen ticket inside the
  // same transaction. Sending it here means the cook sees the order as soon as the
  // manager finishes checking, rather than at the next sweep.
  if (outcome.code === 'PAID') await dispatchForOrder(orderId);

  revalidatePath(`/admin/orders/${orderId}`);
  revalidatePath('/admin/orders');
  revalidatePath('/admin');

  return { ok: true, outcome: outcome.code };
}

// --- Notifications --------------------------------------------------------

export type ResendResult =
  | { ok: true; delivered: boolean }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID' | 'NOT_FOUND' | 'NOT_CONFIGURED' };

/**
 * Try the kitchen again.
 *
 * The whole reason the outbox exists: a ticket that never arrived is a row, not
 * a lost event, so somebody can press this and have it sent — to the chats that
 * are still missing it and no others. Safe to press repeatedly.
 *
 * This is the manual half of redelivery. The automatic half is
 * `dispatchPending`, which is the same call and is waiting for a scheduled job
 * to be pointed at it.
 */
export async function resendOrderNotification(orderId: unknown): Promise<ResendResult> {
  const allowed = await guard();
  if (!allowed.ok) return { ok: false, code: allowed.code };

  if (typeof orderId !== 'string' || !z.uuid().safeParse(orderId).success) {
    return { ok: false, code: 'INVALID' };
  }

  if (!isTelegramConfigured()) return { ok: false, code: 'NOT_CONFIGURED' };

  const queued = await notificationsForOrder(orderId);
  if (queued.length === 0) return { ok: false, code: 'NOT_FOUND' };

  // A message that gave up is put back in the queue before being tried, so the
  // attempt counter starts again rather than the retry bouncing off the limit.
  await requeue(queued.filter((row) => row.status === 'FAILED').map((row) => row.id));

  let delivered = false;
  for (const notification of await notificationsForOrder(orderId)) {
    if (notification.status === 'SENT') continue;
    delivered = (await dispatchNotification(notification)) || delivered;
  }

  revalidatePath(`/admin/orders/${orderId}`);
  return { ok: true, delivered };
}

// --- Telegram settings ----------------------------------------------------

export type ChatIdsResult =
  | { ok: true; saved: string[] }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID'; invalid?: string[] };

/**
 * Which chats get the tickets.
 *
 * Kept in the database rather than the environment because a chat id only
 * exists after somebody has added the bot to a group — which happens after the
 * deployment does. Putting it in an env var would mean a redeploy every time a
 * second screen appears in the kitchen.
 */
export async function saveTelegramChatIds(raw: unknown): Promise<ChatIdsResult> {
  // Which chats receive every order is not a shift decision — it decides who
  // finds out the restaurant has customers.
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  if (typeof raw !== 'string') return { ok: false, code: 'INVALID' };

  const candidates = raw
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  const invalid = candidates.filter((value) => !isValidChatId(value));
  // Saving the good ones and dropping the rest would leave the owner believing
  // a screen is connected when it is not.
  if (invalid.length > 0) return { ok: false, code: 'INVALID', invalid };

  await setTelegramChatIds(candidates);
  // The settings row is cached, and it carries more than chat ids.
  updateTag(SETTINGS_CACHE_TAG);
  revalidatePath('/admin/settings');

  return { ok: true, saved: candidates };
}

export type TestMessageResult =
  | { ok: true; results: string[] }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE'; results?: string[] }
  | { ok: false; code: 'FAILED'; results: string[] };

export async function sendTelegramTest(): Promise<TestMessageResult> {
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const result = await sendTestMessage();
  return result.ok ? { ok: true, results: result.results } : { ok: false, code: 'FAILED', results: result.results };
}

// --- Menu -----------------------------------------------------------------

export type MenuActionResult =
  | { ok: true }
  | { ok: false; code: 'FORBIDDEN' | 'DEMO_MODE' | 'INVALID' | 'NOT_FOUND' | 'INVALID_PRICE' };

const priceSchema = z.object({ id: z.uuid(), price: z.number().int().min(0) });

export async function updateDishPrice(payload: unknown): Promise<MenuActionResult> {
  // What the restaurant charges. The stop list next door stays with the shift.
  const allowed = await guard({ require: 'OWNER' });
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = priceSchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  const result = await setDishPrice(parsed.data.id, parsed.data.price);
  if (!result.ok) return { ok: false, code: result.code };

  /*
    The storefront's menu is cached; without this the price the owner just
    changed would still be on the shop for up to five minutes, which is exactly
    the window in which somebody orders at the old one.
  */
  updateTag(MENU_CACHE_TAG);
  revalidatePath('/admin/menu');
  return { ok: true };
}

const availabilitySchema = z.object({ id: z.uuid(), isAvailable: z.boolean() });

export async function updateDishAvailability(payload: unknown): Promise<MenuActionResult> {
  const allowed = await guard();
  if (!allowed.ok) return { ok: false, code: allowed.code };

  const parsed = availabilitySchema.safeParse(payload);
  if (!parsed.success) return { ok: false, code: 'INVALID' };

  const result = await setDishAvailability(parsed.data.id, parsed.data.isAvailable);
  if (!result.ok) return { ok: false, code: result.code };

  /*
    The storefront's menu is cached; without this the price the owner just
    changed would still be on the shop for up to five minutes, which is exactly
    the window in which somebody orders at the old one.
  */
  updateTag(MENU_CACHE_TAG);
  revalidatePath('/admin/menu');
  return { ok: true };
}
