import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { config as loadEnv } from 'dotenv';
import { drizzle } from 'drizzle-orm/postgres-js';
import { inArray, like } from 'drizzle-orm';
import postgres from 'postgres';

import { defaultWeeklySchedule, type WeeklySchedule } from '../../src/lib/domain';
import { orders, products, rateLimits, settings, stubPayments } from '../../src/server/db/schema';

/**
 * The database side of the end-to-end suite.
 *
 * Every rule here is lifted from `tests/integration/create-order.test.ts`, which
 * solved these problems first: snapshot the settings row, open the restaurant
 * for the duration of the run, track what was created, delete it afterwards and
 * put the settings back. This file exists because Playwright runs in its own
 * processes and needs the same discipline in a form two of them can share.
 */

loadEnv({ path: '.env.local', quiet: true });
loadEnv({ path: '.env', quiet: true });

/**
 * Where the snapshot lives between `globalSetup` and `globalTeardown`.
 *
 * A file rather than module state, and that is the point: the two hooks are not
 * guaranteed to share a module instance, and a run killed with Ctrl-C never
 * reaches teardown at all. On disk the snapshot outlives both, so the next
 * setup can notice one is still lying around and put the settings back before
 * it does anything else. Under `test-results/`, which is already ignored.
 */
const SNAPSHOT_FILE = 'test-results/.e2e-settings-snapshot.json';

/**
 * The phone block this suite orders from: `+374 9355 ####`.
 *
 * Cleanup keys off it. Collecting ids as the tests create them would mean
 * passing state between worker processes and would still miss anything a
 * crashed worker left behind; a reserved block is deterministic, needs no
 * bookkeeping, and cannot match a real customer because no real order exists in
 * a development database. The seed creates none.
 */
export const E2E_PHONE_PREFIX = '+3749355';

/** What to type into the phone field. Normalises to `E2E_PHONE_PREFIX` + suffix. */
export function e2ePhoneInput(suffix: string): string {
  if (!/^\d{4}$/.test(suffix)) throw new Error(`phone suffix must be 4 digits, got ${suffix}`);
  return `09355${suffix}`;
}

interface SettingsSnapshot {
  workingHours: WeeklySchedule;
  isAcceptingOrders: boolean;
}

export function openDb() {
  const url = process.env.DATABASE_URL;

  if (!url) {
    throw new Error(
      'DATABASE_URL is not set. The end-to-end suite orders against a real database — ' +
        'start one with `pnpm db:up` and copy `.env.example` to `.env.local`.',
    );
  }

  const sql = postgres(url, { max: 1 });
  /*
    `casing: 'snake_case'` is not optional, and it is not a style choice: the
    schema declares columns in camelCase and leans on this to map them to the
    snake_case ones that actually exist. Without it every query here compiles and
    then fails at the database with `column "publicCode" does not exist`. It has
    to match `drizzle.config.ts` and `server/db/client.ts`.
  */
  return { db: drizzle(sql, { casing: 'snake_case' }), close: () => sql.end({ timeout: 5 }) };
}

type Db = ReturnType<typeof openDb>['db'];

function alwaysOpen(): WeeklySchedule {
  const week = defaultWeeklySchedule();
  for (const day of Object.values(week)) {
    day.isClosed = false;
    day.opensAt = '00:00';
    day.closesAt = '23:59';
  }
  return week;
}

async function readSettings(db: Db): Promise<SettingsSnapshot> {
  const [row] = await db.select().from(settings).limit(1);
  if (!row) throw new Error('No settings row — run `pnpm db:seed` first.');
  return { workingHours: row.workingHours, isAcceptingOrders: row.isAcceptingOrders };
}

async function writeSettings(db: Db, next: SettingsSnapshot): Promise<void> {
  await db.update(settings).set(next);
}

/**
 * Delete everything this suite could have written.
 *
 * `orders` cascades to items, events, payments and the notification outbox, so
 * only `stub_payments` needs naming separately: it stands in for the bank's own
 * storage and deliberately has no foreign key to us. It is matched by the order
 * code it was labelled with.
 *
 * Rate limits are matched two ways. The phone keys are exact. The address keys
 * end in `unknown` because that is what `clientIp()` returns when no proxy
 * header is present, which is every request a locally started server sees — so
 * those rows are this suite's own traffic and nobody else's.
 */
export async function deleteE2eData(db: Db): Promise<number> {
  const created = await db
    .select({ id: orders.id, publicCode: orders.publicCode })
    .from(orders)
    .where(like(orders.phone, `${E2E_PHONE_PREFIX}%`));

  if (created.length > 0) {
    await db.delete(stubPayments).where(
      inArray(
        stubPayments.label,
        created.map((order) => order.publicCode),
      ),
    );
    await db.delete(orders).where(
      inArray(
        orders.id,
        created.map((order) => order.id),
      ),
    );
  }

  await db.delete(rateLimits).where(like(rateLimits.key, `order:phone:${E2E_PHONE_PREFIX}%`));
  await db.delete(rateLimits).where(like(rateLimits.key, '%:unknown'));

  return created.length;
}

/** How many orders from this suite's phone block are still in the database. */
export async function countE2eOrders(db: Db): Promise<number> {
  const rows = await db
    .select({ id: orders.id })
    .from(orders)
    .where(like(orders.phone, `${E2E_PHONE_PREFIX}%`));
  return rows.length;
}

function saveSnapshot(snapshot: SettingsSnapshot): void {
  mkdirSync(dirname(SNAPSHOT_FILE), { recursive: true });
  writeFileSync(SNAPSHOT_FILE, JSON.stringify(snapshot, null, 2));
}

function takeSnapshot(): SettingsSnapshot | null {
  if (!existsSync(SNAPSHOT_FILE)) return null;
  try {
    return JSON.parse(readFileSync(SNAPSHOT_FILE, 'utf8')) as SettingsSnapshot;
  } catch {
    return null;
  }
}

function dropSnapshot(): void {
  rmSync(SNAPSHOT_FILE, { force: true });
}

/**
 * Open the restaurant, and remember how it was.
 *
 * Runs before the application starts. That ordering is what makes it work:
 * `getSettings()` is cached for sixty seconds inside a request, so a write made
 * while the server is already answering would not be seen for up to a minute.
 * A server that has not served anything yet has nothing cached, and
 * `playwright.config.ts` waits on the port rather than fetching a page,
 * precisely so the readiness check does not warm the cache either.
 */
export async function prepareDatabase(): Promise<void> {
  const { db, close } = openDb();

  try {
    // A previous run that never reached teardown left the restaurant open.
    // Put it back before touching anything, so the snapshot taken below is the
    // real one and not this suite's own leftovers.
    const stale = takeSnapshot();
    if (stale) {
      await writeSettings(db, stale);
      dropSnapshot();
    }

    const [dish] = await db.select({ id: products.id }).from(products).limit(1);
    if (!dish) throw new Error('No products — run `pnpm db:seed` first.');

    const leftovers = await deleteE2eData(db);
    if (leftovers > 0) {
      console.log(`[e2e] removed ${leftovers} order(s) left by an earlier run`);
    }

    saveSnapshot(await readSettings(db));
    await writeSettings(db, { workingHours: alwaysOpen(), isAcceptingOrders: true });
  } finally {
    await close();
  }
}

/** Delete what the run created and put the settings back, whatever happened. */
export async function restoreDatabase(): Promise<void> {
  const { db, close } = openDb();

  try {
    const removed = await deleteE2eData(db);
    console.log(`[e2e] removed ${removed} order(s) created by this run`);

    const snapshot = takeSnapshot();
    if (snapshot) {
      await writeSettings(db, snapshot);
      dropSnapshot();
    }

    const left = await countE2eOrders(db);
    if (left > 0) throw new Error(`[e2e] ${left} test order(s) survived cleanup`);
  } finally {
    await close();
  }
}
