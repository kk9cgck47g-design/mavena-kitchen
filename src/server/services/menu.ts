import { asc, eq, inArray } from 'drizzle-orm';

import { IS_DEMO } from '@/lib/demo';
import { cachedRead } from '@/server/cache';
import type { MenuCategory, MenuOption, MenuOptionGroup, MenuProduct } from '@/lib/menu-types';
import { db } from '@/server/db/client';
import { categories, optionGroups, options, products } from '@/server/db/schema';
import { demoMenu, demoProductBySlug } from '@/server/demo/catalog';
import type { PricingProduct } from './pricing';

export type { MenuCategory, MenuOption, MenuOptionGroup, MenuProduct };

/**
 * Menu reads.
 *
 * Two entry points on purpose:
 *
 * - `getPublicMenu` feeds the storefront and is safe to cache aggressively —
 *   the menu changes a few times a week, and every customer sees the same one.
 * - `getPricingProducts` runs at checkout and must never be cached. A dish the
 *   kitchen took off the stop list thirty seconds ago has to be reflected
 *   immediately, and a stale price here means charging the wrong amount.
 */

/** Tag used with `revalidateTag` whenever the admin panel edits the menu. */
export const MENU_CACHE_TAG = 'menu';

/**
 * How long a menu may be stale if nothing invalidates it.
 *
 * The tag is the real mechanism — every admin edit revalidates it, so a price
 * change or a stop-list toggle is visible immediately. This is the backstop for
 * a change that reached the database another way, and five minutes is short
 * enough that nobody is left wondering whether the panel worked.
 */
const MENU_CACHE_SECONDS = 300;

/**
 * The whole storefront menu in one query set.
 *
 * Three flat queries stitched in memory rather than a nested join: the menu is
 * at most a few hundred rows, and this avoids both the N+1 problem and the
 * row explosion a three-level join would produce.
 *
 * Cached, and it is the single biggest thing that can be. Every storefront page
 * reads this — the landing page, the menu, even the about page — so uncached it
 * is three queries on every visit by every customer, which is most of what a
 * busy evening would spend the database on. The same menu is served to
 * everybody, and it changes a few times a week.
 *
 * `getPricingProducts` below is emphatically not cached, and the difference is
 * the point: this feeds a browsing screen, that one decides what somebody is
 * charged.
 */
export const getPublicMenu = cachedRead(getPublicMenuUncached, ['public-menu'], {
  tags: [MENU_CACHE_TAG],
  revalidate: MENU_CACHE_SECONDS,
});

async function getPublicMenuUncached(): Promise<MenuCategory[]> {
  if (IS_DEMO) return demoMenu();

  const [categoryRows, productRows] = await Promise.all([
    db
      .select()
      .from(categories)
      .where(eq(categories.isActive, true))
      .orderBy(asc(categories.sortOrder), asc(categories.slug)),
    db
      .select()
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.sortOrder), asc(products.slug)),
  ]);

  const productIds = productRows.map((product) => product.id);
  const groupsByProduct = await loadOptionGroups(productIds);

  const productsByCategory = new Map<string, MenuProduct[]>();
  for (const row of productRows) {
    const list = productsByCategory.get(row.categoryId) ?? [];
    list.push({
      id: row.id,
      slug: row.slug,
      categoryId: row.categoryId,
      name: row.name,
      description: row.description,
      basePrice: row.basePrice,
      images: row.images,
      isActive: row.isActive,
      isAvailable: row.isAvailable,
      badges: row.badges,
      allergens: row.allergens,
      weightGrams: row.weightGrams,
      calories: row.calories,
      optionGroups: groupsByProduct.get(row.id) ?? [],
    });
    productsByCategory.set(row.categoryId, list);
  }

  return categoryRows
    .map((category) => ({
      id: category.id,
      slug: category.slug,
      name: category.name,
      imageUrl: category.imageUrl,
      products: productsByCategory.get(category.id) ?? [],
    }))
    // An empty category is a hole in the layout; hide it until it has a dish.
    .filter((category) => category.products.length > 0);
}

/**
 * Live product data for pricing an order.
 *
 * Returns a map keyed by id because `priceCart` needs random access, and returns
 * inactive/unavailable products too — the pricer reports *why* a line failed,
 * which needs the product to exist.
 */
export async function getPricingProducts(
  productIds: readonly string[],
): Promise<Map<string, PricingProduct>> {
  if (IS_DEMO) {
    const wanted = new Set(productIds);
    return new Map(
      demoMenu()
        .flatMap((category) => category.products)
        .filter((product) => wanted.has(product.id))
        .map((product) => [product.id, product]),
    );
  }

  const ids = [...new Set(productIds)];
  if (ids.length === 0) return new Map();

  const rows = await db.select().from(products).where(inArray(products.id, ids));
  const groupsByProduct = await loadOptionGroups(rows.map((row) => row.id));

  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        name: row.name,
        basePrice: row.basePrice,
        images: row.images,
        isActive: row.isActive,
        isAvailable: row.isAvailable,
        optionGroups: groupsByProduct.get(row.id) ?? [],
      } satisfies PricingProduct,
    ]),
  );
}

async function loadOptionGroups(
  productIds: readonly string[],
): Promise<Map<string, MenuOptionGroup[]>> {
  const result = new Map<string, MenuOptionGroup[]>();
  if (productIds.length === 0) return result;

  const groupRows = await db
    .select()
    .from(optionGroups)
    .where(inArray(optionGroups.productId, [...productIds]))
    .orderBy(asc(optionGroups.sortOrder));

  if (groupRows.length === 0) return result;

  const optionRows = await db
    .select()
    .from(options)
    .where(
      inArray(
        options.groupId,
        groupRows.map((group) => group.id),
      ),
    )
    .orderBy(asc(options.sortOrder));

  const optionsByGroup = new Map<string, MenuOption[]>();
  for (const row of optionRows) {
    const list = optionsByGroup.get(row.groupId) ?? [];
    list.push({
      id: row.id,
      name: row.name,
      priceDelta: row.priceDelta,
      isDefault: row.isDefault,
      isActive: row.isActive,
    });
    optionsByGroup.set(row.groupId, list);
  }

  for (const group of groupRows) {
    const list = result.get(group.productId) ?? [];
    list.push({
      id: group.id,
      name: group.name,
      type: group.type,
      minSelect: group.minSelect,
      maxSelect: group.maxSelect,
      isActive: group.isActive,
      options: optionsByGroup.get(group.id) ?? [],
    });
    result.set(group.productId, list);
  }

  return result;
}

export async function getProductBySlug(slug: string): Promise<MenuProduct | null> {
  if (IS_DEMO) return demoProductBySlug(slug);

  const [row] = await db.select().from(products).where(eq(products.slug, slug)).limit(1);
  if (!row || !row.isActive) return null;

  const groups = await loadOptionGroups([row.id]);

  return {
    id: row.id,
    slug: row.slug,
    categoryId: row.categoryId,
    name: row.name,
    description: row.description,
    basePrice: row.basePrice,
    images: row.images,
    isActive: row.isActive,
    isAvailable: row.isAvailable,
    badges: row.badges,
    allergens: row.allergens,
    weightGrams: row.weightGrams,
    calories: row.calories,
    optionGroups: groups.get(row.id) ?? [],
  };
}
