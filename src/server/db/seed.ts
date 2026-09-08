import bcrypt from 'bcryptjs';
import { sql as raw } from 'drizzle-orm';

import { defaultWeeklySchedule } from '@/lib/domain';
import { RESTAURANT } from '@/lib/restaurant';
import { closeDb, db } from './client';
import { CITIES, ZONES } from './delivery-data';
import { MENU } from './menu-data';
import { PLACEHOLDER_PHOTOS, dishPhoto } from './placeholder-photos';
import {
  adminUsers,
  categories,
  cities,
  deliveryZones,
  optionGroups,
  options,
  orders,
  products,
  settings,
} from './schema';

/**
 * Seed: the fictional Mavena Kitchen portfolio menu and delivery rules.
 *
 * Dish photography comes from `placeholder-photos.ts`. The delivery zones are
 * the three demo areas drawn over Yerevan in `delivery-data.ts`, and everything
 * they carry — fee, minimum, free-delivery threshold, ETA, priority — is
 * editable afterwards in the admin panel.
 *
 * Safety: refuses to run when orders already exist, unless `--force`. Reseeding
 * a live database would drop the menu that real order history references.
 */

const force = process.argv.includes('--force');
const SEED_ADMIN_EMAIL = 'owner@mavena.example';

async function main() {
  const [{ count }] = await db.select({ count: raw<number>`count(*)::int` }).from(orders);

  if (count > 0 && !force) {
    console.error(
      `\n  Refusing to seed: the database already holds ${count} order(s).\n` +
        `  Reseeding drops the menu those orders reference.\n` +
        `  Run with --force if you are certain: pnpm db:seed --force\n`,
    );
    process.exit(1);
  }

  console.log('Clearing menu, delivery and settings tables...');
  await db.delete(options);
  await db.delete(optionGroups);
  await db.delete(products);
  await db.delete(categories);
  await db.delete(deliveryZones);
  await db.delete(cities);
  await db.delete(settings);
  // `admin_users` is deliberately not cleared. Wiping staff accounts to reseed a
  // menu is how a restaurant loses access to its own panel, and `order_events`
  // points at these rows.

  // --- Settings ----------------------------------------------------------
  await db.insert(settings).values({
    id: 1,
    isAcceptingOrders: true,
    workingHours: defaultWeeklySchedule(),
    prepTimeMinutes: 25,
    preOrderDaysAhead: 2,
    phones: [],
    addressLine: RESTAURANT.address,
    lat: RESTAURANT.location.lat,
    lng: RESTAURANT.location.lng,
    socials: RESTAURANT.instagramUrl ? { instagram: RESTAURANT.instagramUrl } : {},
    telegramChatIds: [],
  });

  // --- Cities and delivery zones -----------------------------------------
  // Both come from `delivery-data.ts`, which the demo catalogue also reads, so
  // the two can never show different rules.
  await db.insert(cities).values(
    CITIES.map((city) => ({
      code: city.code,
      name: city.name,
      centerLat: city.center.lat,
      centerLng: city.center.lng,
      defaultZoom: city.defaultZoom,
      sortOrder: city.sortOrder,
    })),
  );

  await db.insert(deliveryZones).values(
    ZONES.map((zone) => ({
      cityCode: zone.cityCode,
      name: zone.name,
      polygon: zone.polygon,
      fee: zone.fee,
      minOrder: zone.minOrder,
      freeDeliveryFrom: zone.freeDeliveryFrom,
      etaMinutes: zone.etaMinutes,
      priority: zone.priority,
    })),
  );

  // --- Menu --------------------------------------------------------------
  let productCount = 0;
  let optionCount = 0;

  for (const [categoryIndex, seedCategory] of MENU.entries()) {
    const [category] = await db
      .insert(categories)
      .values({
        slug: seedCategory.slug,
        name: seedCategory.name,
        // Category tiles borrow their first dish's photo, so there is no second
        // set of images to keep in sync with the real shoot.
        imageUrl: null,
        sortOrder: categoryIndex,
      })
      .returning();

    for (const [productIndex, seedProduct] of seedCategory.products.entries()) {
      const photoId = PLACEHOLDER_PHOTOS[seedProduct.slug];
      if (!photoId) {
        console.warn(`  ! No placeholder photo mapped for "${seedProduct.slug}"`);
      }

      const [product] = await db
        .insert(products)
        .values({
          categoryId: category.id,
          slug: seedProduct.slug,
          name: seedProduct.name,
          description: seedProduct.description ?? null,
          basePrice: seedProduct.basePrice,
          images: photoId ? [dishPhoto(photoId)] : [],
          badges: seedProduct.badges ?? [],
          weightGrams: seedProduct.weightGrams ?? null,
          sortOrder: productIndex,
        })
        .returning();

      productCount += 1;

      for (const [groupIndex, seedGroup] of (seedProduct.optionGroups ?? []).entries()) {
        const [group] = await db
          .insert(optionGroups)
          .values({
            productId: product.id,
            name: seedGroup.name,
            type: seedGroup.type,
            minSelect: seedGroup.minSelect,
            maxSelect: seedGroup.maxSelect,
            sortOrder: groupIndex,
          })
          .returning();

        await db.insert(options).values(
          seedGroup.options.map((option, optionIndex) => ({
            groupId: group.id,
            name: option.name,
            priceDelta: option.priceDelta,
            isDefault: option.isDefault ?? false,
            sortOrder: optionIndex,
          })),
        );

        optionCount += seedGroup.options.length;
      }
    }
  }

  // --- Admin account -----------------------------------------------------
  await seedOwner();

  console.log('\nSeed complete.');
  console.log(`  ${MENU.length} categories, ${productCount} dishes, ${optionCount} options`);
  console.log('  3 delivery zones (Yerevan: central, inner, outer)');
  console.log('  Dish photos are PLACEHOLDERS — see src/server/db/placeholder-photos.ts\n');
}

/**
 * Make sure somebody can log in, without ever taking that away.
 *
 * This used to delete every account and write one back, which made "add a
 * manager" impossible without a SQL prompt and made re-running the seed a way to
 * silently reset the owner's password. Now it only ever adds the first one.
 *
 * The default password is refused against anything that is not localhost. A
 * documented default is a convenience on a developer's machine and a published
 * credential on a deployment, and the difference between the two is exactly the
 * connection string.
 */
async function seedOwner(): Promise<void> {
  const [{ count: existing }] = await db
    .select({ count: raw<number>`count(*)::int` })
    .from(adminUsers);

  if (existing > 0) {
    console.log(`  Staff accounts: ${existing} already exist — left untouched.`);
    return;
  }

  const configured = process.env.SEED_ADMIN_PASSWORD;
  const local = isLocalDatabase(process.env.DATABASE_URL ?? '');

  if (!configured && !local) {
    console.error(
      '\n  Refusing to create the first owner with the built-in development password.\n' +
        '  This database is not local, and that password is published in the repository.\n' +
        '  Set SEED_ADMIN_PASSWORD and run again.\n',
    );
    process.exit(1);
  }

  const password = configured ?? 'ChangeMe123!';

  await db.insert(adminUsers).values({
    email: SEED_ADMIN_EMAIL,
    passwordHash: await bcrypt.hash(password, 12),
    name: 'Owner',
    role: 'OWNER',
  });

  console.log(
    `  Admin login: ${SEED_ADMIN_EMAIL} / ${configured ? '(SEED_ADMIN_PASSWORD)' : password}`,
  );
}

function isLocalDatabase(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === 'db';
  } catch {
    return false;
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => closeDb());
