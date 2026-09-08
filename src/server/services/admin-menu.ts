import { asc, eq } from 'drizzle-orm';

import type { LocalizedText } from '@/lib/i18n/locales';
import { assertAmd, type Amd } from '@/lib/money';
import { db } from '@/server/db/client';
import { categories, optionGroups, products } from '@/server/db/schema';

/**
 * The two things a kitchen changes about its menu during service.
 *
 * Price, and whether a dish can be ordered at all. Everything else — new
 * dishes, option groups, photography — is a slower job that belongs with the
 * owner's real content, and is deliberately not here: a half-built dish editor
 * invites someone to create a product with no options and no price at seven on
 * a Friday.
 *
 * `isAvailable` and `isActive` are kept apart because they mean different
 * things and are undone at different speeds. Available is the daily stop list:
 * the wings have run out, put them back tomorrow. Active is "this is not on our
 * menu any more". Collapsing them would make a lunchtime shortage look like a
 * decision to stop selling something.
 *
 * Nothing here touches a price on an order that already exists. `order_items`
 * froze its own copy when the order was placed, which is the whole reason
 * raising a price at noon cannot rewrite the morning's takings.
 */

export interface AdminMenuItem {
  id: string;
  slug: string;
  name: LocalizedText;
  categoryName: LocalizedText;
  basePrice: Amd;
  isAvailable: boolean;
  isActive: boolean;
  image: string | null;
  /** True when the dish has option groups whose deltas ride on top of the base price. */
  hasOptions: boolean;
}

export async function listMenuForAdmin(): Promise<AdminMenuItem[]> {
  const rows = await db
    .select({
      id: products.id,
      slug: products.slug,
      name: products.name,
      basePrice: products.basePrice,
      isAvailable: products.isAvailable,
      isActive: products.isActive,
      images: products.images,
      categoryName: categories.name,
      categorySort: categories.sortOrder,
      sortOrder: products.sortOrder,
    })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .orderBy(asc(categories.sortOrder), asc(products.sortOrder), asc(products.slug));

  // Which dishes carry option groups, so the panel can mark a price as the
  // starting point rather than the whole story: a size-based dish is sold at
  // base price plus a delta, and showing "750 ֏" flat would be a lie about
  // what the customer pays.
  const withOptions = new Set(
    (
      await db
        .selectDistinct({ productId: optionGroups.productId })
        .from(optionGroups)
        .where(eq(optionGroups.isActive, true))
    ).map((row) => row.productId),
  );

  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    name: row.name,
    categoryName: row.categoryName,
    basePrice: row.basePrice,
    isAvailable: row.isAvailable,
    isActive: row.isActive,
    image: row.images[0] ?? null,
    hasOptions: withOptions.has(row.id),
  }));
}

/** The most a dish may cost, in drams. A guard against a slipped keyboard, not a policy. */
export const MAX_DISH_PRICE = 500_000;

export type MenuUpdateResult =
  | { ok: true }
  | { ok: false; code: 'NOT_FOUND' | 'INVALID_PRICE' };

export async function setDishPrice(id: string, price: number): Promise<MenuUpdateResult> {
  if (!Number.isSafeInteger(price) || price < 0 || price > MAX_DISH_PRICE) {
    return { ok: false, code: 'INVALID_PRICE' };
  }

  assertAmd(price, 'basePrice');

  const updated = await db
    .update(products)
    .set({ basePrice: price, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning({ id: products.id });

  return updated.length > 0 ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
}

export async function setDishAvailability(
  id: string,
  isAvailable: boolean,
): Promise<MenuUpdateResult> {
  const updated = await db
    .update(products)
    .set({ isAvailable, updatedAt: new Date() })
    .where(eq(products.id, id))
    .returning({ id: products.id });

  return updated.length > 0 ? { ok: true } : { ok: false, code: 'NOT_FOUND' };
}
