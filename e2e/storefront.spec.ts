import { MENU } from '../src/server/db/menu-data';
import { RESTAURANT } from '../src/lib/restaurant';

import { expect, parseAmount, test } from './fixtures/app';
import {
  CENTRAL_ZONE,
  addButton,
  chooseOption,
  CITY,
  cityName,
  openCart,
  openDishSheet,
  setQuantity,
  summary,
  summaryAmounts,
} from './fixtures/checkout';

/**
 * One pass through the storefront, per project, without placing an order.
 *
 * Written as a single test with steps rather than as a dozen tests, because the
 * interesting thing is the journey: a cart built in step three is what step six
 * prices. Splitting it would mean rebuilding that state from scratch each time,
 * which is slower and tests less.
 *
 * The three ambient checks — overflow, console errors, axe-known-violations —
 * are not steps here. Console errors are collected by an automatic fixture for
 * the whole test; overflow is asserted at each layout worth asserting.
 */

/** A combo: one required single-choice group, one optional extra. Exercises both kinds. */
const COMBO_SLUG = 'beef-burger-combo';
const COMBO = MENU.flatMap((category) => category.products).find(
  (product) => product.slug === COMBO_SLUG,
)!;

const DRINK_GROUP = COMBO.optionGroups![0];
const EXTRA_GROUP = COMBO.optionGroups![1];

/** Not the default, so choosing it proves the choice took. */
const DRINK = DRINK_GROUP.options[1];
const EXTRA = EXTRA_GROUP.options[0];

/*
  Two, and the reason is the numbers rather than a whim. At this quantity the
  cart sits above the central zone's minimum order and below its free-delivery
  threshold, which is the one band where all four amounts in the summary say
  something different: a subtotal, a fee that is actually charged, a total, and a
  distance still to go before delivery stops costing anything. One of those
  disappears at either end of the band.
*/
const QUANTITY = 2;
const UNIT = COMBO.basePrice + DRINK.priceDelta + EXTRA.priceDelta;
const SUBTOTAL = UNIT * QUANTITY;

test('storefront: menu, dish options, cart and a priced checkout', async ({ page, app }) => {
  const { t, locale } = app;

  await test.step('home page renders and fits', async () => {
    await app.goto('/');
    await expect(page).toHaveTitle(new RegExp(RESTAURANT.name));
    await expect(page.getByLabel(RESTAURANT.name)).toBeVisible();
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await app.expectNoHorizontalOverflow('home');
  });

  await test.step('menu lists dishes', async () => {
    await app.goto('/menu');
    await expect(page.locator('article')).not.toHaveCount(0);
    await app.expectNoHorizontalOverflow('menu');
  });

  await test.step('dish sheet prices the chosen options', async () => {
    const sheet = await openDishSheet(page, COMBO_SLUG);

    await chooseOption(sheet, DRINK.name[locale]);
    await chooseOption(sheet, EXTRA.name[locale]);
    await setQuantity(sheet, QUANTITY);

    // The button carries the live total; that arithmetic is the thing under test.
    await expect.poll(async () => parseAmount(await addButton(sheet).innerText())).toBe(SUBTOTAL);

    await app.expectNoHorizontalOverflow('dish sheet');
    await addButton(sheet).click();
    await expect(sheet).toBeHidden();
  });

  await test.step('cart keeps the options and the subtotal', async () => {
    const cart = await openCart(page, t.cart.title);

    await expect(cart).toContainText(DRINK.name[locale]);
    await expect(cart).toContainText(EXTRA.name[locale]);
    await expect(cart).toContainText(String(QUANTITY));

    await app.expectNoHorizontalOverflow('cart');
    await cart.getByRole('link', { name: t.cart.checkout }).click();
  });

  await test.step('checkout shows the subtotal before an address exists', async () => {
    await expect(page.getByRole('heading', { name: t.checkout.title })).toBeVisible();

    /*
      A guard, and the reason this step exists on its own: the summary once
      threw the subtotal away along with the blocker, so a checkout with no
      address yet showed three loading skeletons that never resolved. The server
      knows what the food costs whether or not it knows where to take it — so
      exactly one amount is expected here, and no skeleton.
    */
    await expect.poll(() => summaryAmounts(page)).toEqual([SUBTOTAL]);
    await expect(summary(page).locator('[data-slot="skeleton"]')).toHaveCount(0);

    await app.expectNoHorizontalOverflow('checkout, no city');
  });

  await test.step('choosing a city quotes delivery, total and the free-delivery hint', async () => {
    await page.getByRole('button', { name: cityName(CITY.code, locale) }).click();

    const total = SUBTOTAL + CENTRAL_ZONE.fee;
    const toFreeDelivery = CENTRAL_ZONE.freeDeliveryFrom! - SUBTOTAL;

    /*
      Four amounts, in the order the summary lists them: what the food costs,
      what delivery adds, what the two come to, and how much more earns free
      delivery. Asserted together because they have to agree with each other —
      that is what a customer checks, and a subtotal that is right beside a total
      that is not would pass three separate assertions.
    */
    await expect
      .poll(() => summaryAmounts(page))
      .toEqual([SUBTOTAL, CENTRAL_ZONE.fee, toFreeDelivery, total]);

    await app.expectNoHorizontalOverflow('checkout, priced');
  });
});
