import { MENU } from '../src/server/db/menu-data';

import { expect, parseAmount, test } from './fixtures/app';
import { e2ePhoneInput } from './support/db';
import {
  CENTRAL_ZONE,
  addButton,
  chooseFulfilment,
  choosePayment,
  chooseOption,
  CITY,
  cityName,
  fillContact,
  openCart,
  openDishSheet,
  setQuantity,
  submitButton,
  summaryAmounts,
} from './fixtures/checkout';

/**
 * The two flows that produce a real order.
 *
 * Two, not six. `delivery + cash` and `pickup + online` between them exercise
 * every distinct path the server takes: both fulfilment branches, the address
 * and map half of the form, the zone fee and the no-zone case, the cash path
 * that finishes at once and the online path that goes out to an acquirer and
 * comes back. `delivery + online` and `pickup + cash` are recombinations of
 * halves already covered and would only cost time.
 *
 * They run in one file, so Playwright queues them on a single worker without any
 * special configuration — which is what keeps two orders from racing each other
 * through the same rate limit.
 *
 * Nothing here is mocked. Real database, real pricing, real order record, real
 * tracking page, and the acquirer that was already a stub before any of this
 * existed.
 */

const products = MENU.flatMap((category) => category.products);

const COMBO = products.find((product) => product.slug === 'beef-burger-combo')!;
const DRINK = COMBO.optionGroups![0].options[1];
const EXTRA = COMBO.optionGroups![1].options[0];
const COMBO_QUANTITY = 2;
const COMBO_SUBTOTAL = (COMBO.basePrice + DRINK.priceDelta + EXTRA.priceDelta) * COMBO_QUANTITY;

/** Pickup has no minimum, so a single plain dish is enough and is quicker. */
const SIMPLE = products.find((product) => product.slug === 'cheeseburger-beef')!;

/** Distinct per run and per flow, so neither trips the eight-orders-an-hour limit. */
const RUN = String(Date.now()).slice(-2);

const ORDER_CODE = /MK-\d{6}/;

test.describe.configure({ mode: 'serial' });

test('delivery paid in cash: order, totals, address and tracking', async ({ page, app }) => {
  const { t, locale } = app;
  const phone = e2ePhoneInput(`${RUN}01`);

  const address = 'Դեմո փողոց 15, բն. 4';
  const landmark = 'Зелёная калитка напротив аптеки';
  const notes = 'Без лука, позвонить за 5 минут';

  await test.step('build a cart with a required choice and an extra', async () => {
    await app.goto('/menu');
    const sheet = await openDishSheet(page, COMBO.slug);
    await chooseOption(sheet, DRINK.name[locale]);
    await chooseOption(sheet, EXTRA.name[locale]);
    await setQuantity(sheet, COMBO_QUANTITY);
    await addButton(sheet).click();
    await expect(sheet).toBeHidden();

    const cart = await openCart(page, t.cart.title);
    await cart.getByRole('link', { name: t.cart.checkout }).click();
  });

  await test.step('address the order and check what it will cost', async () => {
    await page.getByRole('button', { name: cityName(CITY.code, locale) }).click();
    await fillContact(page, { name: 'Playwright Delivery', phone, address, landmark, notes });

    const total = COMBO_SUBTOTAL + CENTRAL_ZONE.fee;
    await expect
      .poll(() => summaryAmounts(page))
      .toEqual([
        COMBO_SUBTOTAL,
        CENTRAL_ZONE.fee,
        CENTRAL_ZONE.freeDeliveryFrom! - COMBO_SUBTOTAL,
        total,
      ]);
  });

  await test.step('place it', async () => {
    const submit = submitButton(page, t.checkout.submit);
    await expect(submit).toBeEnabled();
    await submit.click();
    await expect(page.getByRole('heading', { name: t.order.thanks })).toBeVisible();
  });

  await test.step('the order says back exactly what was ordered', async () => {
    const body = page.locator('main');

    await expect(body).toContainText(ORDER_CODE);

    // The options travelled: they are frozen into the order's own snapshot, not
    // read back out of the cart.
    await expect(body).toContainText(DRINK.name[locale]);
    await expect(body).toContainText(EXTRA.name[locale]);

    await expect(body).toContainText(address);
    await expect(body).toContainText(landmark);
    await expect(body).toContainText(notes);
    await expect(body).toContainText(t.payment.CASH);

    const amounts = (await body.innerText())
      .split('\n')
      .filter((line) => line.includes('֏'))
      .map(parseAmount);

    expect(amounts, 'line total, subtotal, delivery fee and total').toEqual(
      expect.arrayContaining([COMBO_SUBTOTAL, CENTRAL_ZONE.fee, COMBO_SUBTOTAL + CENTRAL_ZONE.fee]),
    );

    // Delivery has one more stage than pickup, and the tracker starts at the first.
    await expect(page.locator('ol li')).toHaveCount(6);
    await expect(body).toContainText(
      t.order.currentStep.replace('{step}', '1').replace('{total}', '6'),
    );
  });

  await test.step('the tracking page is reachable again and accessible', async () => {
    const trackingUrl = page.url();
    await page.reload();
    await expect(page.getByRole('heading', { name: t.order.thanks })).toBeVisible();
    expect(page.url()).toBe(trackingUrl);

    await app.expectNoHorizontalOverflow('tracking');
    await app.expectNoNewA11yViolations('tracking');
  });
});

test('pickup paid online: stub acquirer, return, paid', async ({ page, app }) => {
  const { t } = app;
  const phone = e2ePhoneInput(`${RUN}02`);

  await test.step('one dish, collected in person', async () => {
    await app.goto('/menu');
    const sheet = await openDishSheet(page, SIMPLE.slug);
    await addButton(sheet).click();
    await expect(sheet).toBeHidden();

    const cart = await openCart(page, t.cart.title);
    await cart.getByRole('link', { name: t.cart.checkout }).click();

    await chooseFulfilment(page, t.checkout.pickup);
    await choosePayment(page, t.payment.ONLINE);
    await fillContact(page, { name: 'Playwright Pickup', phone });
  });

  await test.step('pickup costs no delivery, so the total is the subtotal', async () => {
    await expect.poll(() => summaryAmounts(page)).toEqual([SIMPLE.basePrice, SIMPLE.basePrice]);
    await expect(submitButton(page, t.checkout.submit)).toBeEnabled();
  });

  await test.step('the acquirer is asked for the right amount', async () => {
    await submitButton(page, t.checkout.submit).click();

    await expect(page.getByRole('heading', { name: t.pay.title })).toBeVisible();
    await expect(page.locator('main')).toContainText(ORDER_CODE);
    await expect(page.locator('main')).toContainText(String(SIMPLE.basePrice).slice(0, 1));

    const amounts = (await page.locator('main').innerText())
      .split('\n')
      .filter((line) => line.includes('֏'))
      .map(parseAmount);
    expect(amounts, 'the amount the stub was asked to take').toContain(SIMPLE.basePrice);
  });

  await test.step('paying sends the order to the kitchen', async () => {
    await page.getByRole('button', { name: t.pay.confirm }).click();

    await expect(page.getByRole('heading', { name: t.order.thanks })).toBeVisible();
    await expect(page.locator('main')).toContainText(t.order.paid);
    await expect(page.locator('main')).toContainText(t.order.paidHint);
    await expect(page.locator('main')).toContainText(t.payment.ONLINE);

    // Pickup skips "on the way", so the tracker is one stage shorter.
    await expect(page.locator('ol li')).toHaveCount(5);

    // No delivery line at all, as opposed to a delivery line reading zero.
    await expect(page.locator('main')).not.toContainText(t.cart.deliveryFee);
  });
});
