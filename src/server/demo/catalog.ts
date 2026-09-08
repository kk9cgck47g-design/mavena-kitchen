import { createHash } from 'node:crypto';

import { defaultWeeklySchedule, type WeeklySchedule } from '@/lib/domain';
import type { MenuCategory, MenuProduct } from '@/lib/menu-types';
import { RESTAURANT } from '@/lib/restaurant';
import { CITIES, ZONES } from '@/server/db/delivery-data';
import { MENU } from '@/server/db/menu-data';
import { PLACEHOLDER_PHOTOS, dishPhoto } from '@/server/db/placeholder-photos';
import type { City, Settings } from '@/server/db/schema';
import type { DeliveryZoneRule } from '@/server/services/delivery';

/**
 * The menu, built in memory from the same constants the seed writes to Postgres.
 *
 * This is what makes the design preview deployable with no database behind it.
 * It is not a second source of truth: both this and the seed read `MENU`,
 * `CITIES` and `ZONES`, so the demo can never show a different menu from the
 * real thing.
 *
 * Ids are derived from slugs rather than drawn at random, so that a cart saved
 * in the preview still resolves after a redeploy. They are real UUIDs all the
 * same, and that is not cosmetic: the cart the browser sends is validated by
 * `cartLineSchema`, which requires `z.uuid()` on every product and option id.
 * Readable ids like `prod-burger-beef` failed that check, so in demo mode every
 * quote came back as a malformed request and the whole checkout was unreachable
 * — while the same code worked perfectly against a database.
 */

/**
 * A stable UUID for a demo entity, derived from its slug.
 *
 * This is RFC 4122 version 5 — a SHA-1 of the name with the version and variant
 * bits set — written out rather than pulled from a dependency, because it is
 * nine lines and the alternative is a package in the tree for one function.
 */
export function demoUuid(key: string): string {
  const hash = createHash('sha1').update(`mavena-kitchen:demo:${key}`).digest();
  hash[6] = (hash[6] & 0x0f) | 0x50; // version 5
  hash[8] = (hash[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = hash.subarray(0, 16).toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** Every day, all day. Built from the real default so the shape can never drift. */
function alwaysOpenSchedule(): WeeklySchedule {
  const week = defaultWeeklySchedule();
  for (const day of Object.values(week)) {
    day.isClosed = false;
    day.opensAt = '00:00';
    day.closesAt = '23:59';
  }
  return week;
}

let cached: MenuCategory[] | null = null;

export function demoMenu(): MenuCategory[] {
  if (cached) return cached;

  cached = MENU.map((category) => ({
    id: demoUuid(`category:${category.slug}`),
    slug: category.slug,
    name: category.name,
    imageUrl: null,
    products: category.products.map((product): MenuProduct => {
      const photoId = PLACEHOLDER_PHOTOS[product.slug];

      return {
        id: demoUuid(`product:${product.slug}`),
        slug: product.slug,
        categoryId: demoUuid(`category:${category.slug}`),
        name: product.name,
        description: product.description ?? null,
        basePrice: product.basePrice,
        images: photoId ? [dishPhoto(photoId)] : [],
        isActive: true,
        isAvailable: true,
        badges: product.badges ?? [],
        allergens: [],
        weightGrams: product.weightGrams ?? null,
        calories: null,
        optionGroups: (product.optionGroups ?? []).map((group, groupIndex) => ({
          id: demoUuid(`group:${product.slug}:${groupIndex}`),
          name: group.name,
          type: group.type,
          minSelect: group.minSelect,
          maxSelect: group.maxSelect,
          isActive: true,
          options: group.options.map((option, optionIndex) => ({
            id: demoUuid(`option:${product.slug}:${groupIndex}:${optionIndex}`),
            name: option.name,
            priceDelta: option.priceDelta,
            isDefault: option.isDefault ?? false,
            isActive: true,
          })),
        })),
      };
    }),
  }));

  return cached;
}

export function demoProductBySlug(slug: string): MenuProduct | null {
  for (const category of demoMenu()) {
    const found = category.products.find((product) => product.slug === slug);
    if (found) return found;
  }
  return null;
}

export function demoSettings(): Settings {
  return {
    id: 1,
    // The preview should look open whenever someone follows the link, rather
    // than showing "closed" to anyone who opens it after 23:00.
    isAcceptingOrders: true,
    pausedMessage: null,
    /** The portfolio preview stays usable regardless of the viewer's local time. */
    workingHours: alwaysOpenSchedule(),
    prepTimeMinutes: 25,
    preOrderDaysAhead: 2,
    phones: [],
    addressLine: RESTAURANT.address,
    lat: RESTAURANT.location.lat,
    lng: RESTAURANT.location.lng,
    socials: RESTAURANT.instagramUrl ? { instagram: RESTAURANT.instagramUrl } : {},
    telegramChatIds: [],
    updatedAt: new Date(),
  };
}

export function demoCities(): City[] {
  return CITIES.map((city) => ({
    code: city.code,
    name: city.name,
    centerLat: city.center.lat,
    centerLng: city.center.lng,
    defaultZoom: city.defaultZoom,
    isActive: true,
    sortOrder: city.sortOrder,
  }));
}

export function demoZones(): DeliveryZoneRule[] {
  return ZONES.map((zone) => ({
    id: zone.id,
    cityCode: zone.cityCode,
    name: zone.name,
    polygon: zone.polygon,
    fee: zone.fee,
    minOrder: zone.minOrder,
    freeDeliveryFrom: zone.freeDeliveryFrom,
    etaMinutes: zone.etaMinutes,
    isActive: true,
    priority: zone.priority,
  }));
}
