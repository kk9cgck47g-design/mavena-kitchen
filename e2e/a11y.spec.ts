import { expect, test } from './fixtures/app';
import { addButton, openCart, openDishSheet } from './fixtures/checkout';

/**
 * axe on the screens a customer cannot avoid.
 *
 * One browser only. axe reads the accessibility tree the DOM produces, and that
 * is the same DOM everywhere — running it in three engines would triple the time
 * to re-learn the same thing.
 *
 * The assertion is "nothing", not "nothing new". The allowlist in
 * `fixtures/app.ts` is empty, and a failure here names the element, the two
 * colours and the ratio rather than only the rule that broke.
 */

const DISH_SLUG = 'beef-burger-combo';

test('home, menu and the dish sheet are free of new accessibility violations', async ({
  page,
  app,
}) => {
  await app.goto('/');
  await app.expectNoNewA11yViolations('home');

  await app.goto('/menu');
  await app.expectNoNewA11yViolations('menu');

  const sheet = await openDishSheet(page, DISH_SLUG);
  await app.expectNoNewA11yViolations('dish sheet');
  await addButton(sheet).click();
  await expect(sheet).toBeHidden();
});

test('the cart and the checkout form are free of new accessibility violations', async ({
  page,
  app,
}) => {
  const { t } = app;

  await app.goto('/menu');
  const sheet = await openDishSheet(page, DISH_SLUG);
  await addButton(sheet).click();
  await expect(sheet).toBeHidden();

  const cart = await openCart(page, t.cart.title);
  await app.expectNoNewA11yViolations('cart');

  await cart.getByRole('link', { name: t.cart.checkout }).click();
  await expect(page.getByRole('heading', { name: t.checkout.title })).toBeVisible();
  await app.expectNoNewA11yViolations('checkout');
});
