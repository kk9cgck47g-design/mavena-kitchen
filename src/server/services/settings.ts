import { asc, eq } from 'drizzle-orm';

import { defaultWeeklySchedule } from '@/lib/domain';
import { IS_DEMO } from '@/lib/demo';
import { cachedRead } from '@/server/cache';
import { db } from '@/server/db/client';
import { cities, deliveryZones, settings } from '@/server/db/schema';
import type { Settings } from '@/server/db/schema';
import { demoCities, demoSettings, demoZones } from '@/server/demo/catalog';
import type { DeliveryZoneRule } from './delivery';

/** The settings row always has id 1. */
export const SETTINGS_ID = 1;

export const SETTINGS_CACHE_TAG = 'settings';
export const DELIVERY_CACHE_TAG = 'delivery';

/**
 * Restaurant settings, with a safe fallback.
 *
 * If the row is somehow missing, the site stays up with sensible defaults and
 * ordering switched OFF. Failing closed is the right call here: taking orders
 * the kitchen has not agreed to is worse than showing "temporarily unavailable".
 */
export const getSettings = cachedRead(getSettingsUncached, ['restaurant-settings'], {
  tags: [SETTINGS_CACHE_TAG],
  /*
    A minute, and short on purpose. This row carries `isAcceptingOrders` — the
    switch that stops the site taking orders when the kitchen is swamped — and
    everything that writes it revalidates the tag, so the panel is instant. The
    minute is what bounds a change made any other way, and "the kitchen said stop
    and it kept taking orders" is not something to leave to a five-minute window.
  */
  revalidate: 60,
});

async function getSettingsUncached(): Promise<Settings> {
  if (IS_DEMO) return demoSettings();

  const [row] = await db.select().from(settings).where(eq(settings.id, SETTINGS_ID)).limit(1);

  if (row) return row;

  return {
    id: SETTINGS_ID,
    isAcceptingOrders: false,
    pausedMessage: null,
    workingHours: defaultWeeklySchedule(),
    prepTimeMinutes: 30,
    preOrderDaysAhead: 0,
    phones: [],
    addressLine: null,
    lat: null,
    lng: null,
    socials: {},
    telegramChatIds: [],
    updatedAt: new Date(),
  };
}

/**
 * The chats that receive kitchen tickets.
 *
 * Stored on the settings row rather than in the environment, and that is the
 * difference between a working feature and one the owner cannot switch on: a
 * chat id is discovered by adding the bot to a group and reading what it
 * reports, which happens after the deployment exists. An environment variable
 * would mean a redeploy every time a screen is added to the kitchen.
 *
 * Ids are stored as text because Telegram group ids are negative and larger
 * than a 32-bit integer, and supergroup ids are larger still.
 */
export async function setTelegramChatIds(ids: readonly string[]): Promise<void> {
  const cleaned = [...new Set(ids.map((id) => id.trim()).filter((id) => id.length > 0))];

  await db
    .update(settings)
    .set({ telegramChatIds: cleaned, updatedAt: new Date() })
    .where(eq(settings.id, SETTINGS_ID));
}

/**
 * The kill switch.
 *
 * One boolean, and everything downstream of it was already built: the ordering
 * window derives `isPaused` from it, the checkout renders a notice and refuses to
 * enable its button, and `createOrder` refuses at the source. What was missing
 * was anything that could write it — the schema described a toggle in the admin
 * panel that did not exist, so an owner whose kitchen was swamped had no way to
 * stop the site taking orders.
 *
 * Deliberately not a schedule and not a duration. An owner pressing this is
 * dealing with something — a delivery that failed, a fryer that died, forty
 * orders in ten minutes — and does not know when it ends. A timer would either
 * turn ordering back on while the kitchen is still drowning, or need to be
 * cancelled from the same screen anyway.
 *
 * The customer-facing message stays the translated built-in one rather than
 * anything typed here, and that is not laziness: the panel is Russian-only and
 * the storefront is not. A free-text note would show Armenian and English
 * customers Russian, which is worse than a correct sentence in their own
 * language.
 */
export async function setAcceptingOrders(isAccepting: boolean): Promise<void> {
  await db
    .update(settings)
    .set({ isAcceptingOrders: isAccepting, updatedAt: new Date() })
    .where(eq(settings.id, SETTINGS_ID));
}

/** A chat id is a signed integer, possibly a large negative one for a group. */
export function isValidChatId(value: string): boolean {
  return /^-?\d{5,20}$/.test(value.trim());
}

/**
 * Cities and zones, cached together under one tag.
 *
 * Both are read on every checkout quote — which the form asks for on every
 * settled change, so it is the hottest path in the application — and both change
 * when somebody redraws a delivery area, which is a handful of times a year.
 *
 * Safe to cache in a way the settings row needed thought about: neither of these
 * shapes carries a `Date`, so nothing is quietly turned into a string on the way
 * through the cache. `getActiveDeliveryZones` already mapped its rows to a
 * timestamp-free view for its own reasons; that is what makes it cacheable
 * without a second look.
 */
export const getActiveCities = cachedRead(getActiveCitiesUncached, ['active-cities'], {
  tags: [DELIVERY_CACHE_TAG],
  revalidate: 300,
});

async function getActiveCitiesUncached() {
  if (IS_DEMO) return demoCities();

  return db
    .select()
    .from(cities)
    .where(eq(cities.isActive, true))
    .orderBy(asc(cities.sortOrder));
}

export const getActiveDeliveryZones = cachedRead(
  getActiveDeliveryZonesUncached,
  ['active-delivery-zones'],
  { tags: [DELIVERY_CACHE_TAG], revalidate: 300 },
);

async function getActiveDeliveryZonesUncached(): Promise<DeliveryZoneRule[]> {
  if (IS_DEMO) return demoZones();

  const rows = await db
    .select()
    .from(deliveryZones)
    .where(eq(deliveryZones.isActive, true))
    .orderBy(asc(deliveryZones.priority));

  return rows.map((row) => ({
    id: row.id,
    cityCode: row.cityCode,
    name: row.name,
    polygon: row.polygon,
    fee: row.fee,
    minOrder: row.minOrder,
    freeDeliveryFrom: row.freeDeliveryFrom,
    etaMinutes: row.etaMinutes,
    isActive: row.isActive,
    priority: row.priority,
  }));
}
