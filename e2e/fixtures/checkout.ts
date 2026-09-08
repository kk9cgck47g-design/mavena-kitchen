import { expect, type Locator, type Page } from '@playwright/test';

import type { CityCode } from '../../src/lib/domain';
import type { Locale } from '../../src/lib/i18n/locales';
import { CITIES, ZONES } from '../../src/server/db/delivery-data';

/**
 * The storefront, addressed the way a customer addresses it.
 *
 * No `data-testid` anywhere. Everything here hangs off something the page needs
 * to have for its own sake: the `id` on a form field, the `aria-label` on the
 * cart button, the `role="dialog"` on a sheet, the `href` on a dish card. Where a
 * label is involved it comes from the application's own message files rather
 * than a string typed into a test, so the same helper works in all three
 * languages and a copy change breaks loudly instead of silently selecting
 * nothing.
 */

/** Prices and rules the tests assert against, read from the same constants the seed writes. */
export const CENTRAL_ZONE = ZONES.find((zone) => zone.id === 'zone-yerevan-central')!;
export const CITY = CITIES[0];

export function cityName(code: CityCode, locale: Locale): string {
  return CITIES.find((city) => city.code === code)!.name[locale];
}

/** The dish sheet, opened from a card by its slug rather than its translated name. */
export async function openDishSheet(page: Page, slug: string): Promise<Locator> {
  await page.locator(`article a[href$="/menu/${slug}"]`).first().click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * The quantity stepper.
 *
 * `div[role="group"]` rather than `getByRole('group')`, because every option
 * `<fieldset>` in the sheet carries that role implicitly and would match too.
 * The stepper is the only element that writes the attribute out, which makes it
 * a precise hook without inventing one.
 */
export function stepper(sheet: Locator): Locator {
  return sheet.locator('div[role="group"]');
}

/**
 * The sheet's action bar: the quantity stepper and the add button.
 *
 * Found through the stepper's parent, because the bar itself is a plain `div`.
 * Position within the bar is stable — stepper first, primary action last — and
 * survives the label changing language, which selecting the add button by its
 * text would not.
 */
export function sheetActionBar(sheet: Locator): Locator {
  return stepper(sheet).locator('xpath=..');
}

export function addButton(sheet: Locator): Locator {
  return sheetActionBar(sheet).getByRole('button').last();
}

export async function setQuantity(sheet: Locator, quantity: number): Promise<void> {
  const control = stepper(sheet);
  // Decrease, count, increase — so the second button is the one that adds.
  const increase = control.getByRole('button').nth(1);
  for (let current = 1; current < quantity; current += 1) {
    await increase.click();
  }
  await expect(control).toContainText(String(quantity));
}

/** Toggle an option by its visible name; returns the name for later assertions. */
export async function chooseOption(sheet: Locator, name: string): Promise<string> {
  const option = sheet.locator('fieldset button').filter({ hasText: name }).first();
  await option.click();
  await expect(option).toHaveAttribute('aria-pressed', 'true');
  return name;
}

/**
 * Open the cart from the header.
 *
 * Scoped to the banner and matched exactly, because on a phone the sticky cart
 * bar carries the same word: its accessible name is "Cart 2 items 4 300 ֏",
 * which a loose match on "Cart" also selects. The header button is the one
 * control that exists at every width.
 */
export async function openCart(page: Page, cartLabel: string): Promise<Locator> {
  await page.getByRole('banner').getByRole('button', { name: cartLabel, exact: true }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  return sheet;
}

/**
 * The checkout summary — the sidebar on desktop, the in-flow card on a phone.
 *
 * Both are always in the DOM; only one is displayed, so the visible filter picks
 * whichever the current width is actually showing without the test needing to
 * know which that is.
 */
export function summary(page: Page): Locator {
  return page.locator('dl').filter({ visible: true }).first();
}

/**
 * Every amount the summary is currently showing, one per line.
 *
 * Line by line rather than as one string: reading the block whole would run
 * `4 300` and `500` together into `4300500`. A missing amount renders as a dash
 * and simply contributes nothing, which is what the "no city yet" case asserts.
 */
export async function summaryAmounts(page: Page): Promise<number[]> {
  const text = await summary(page).innerText();
  return text
    .split('\n')
    .filter((line) => line.includes('֏'))
    .map((line) => Number(line.replace(/\D/g, '')))
    .filter((amount) => Number.isFinite(amount) && amount > 0);
}

export async function chooseFulfilment(page: Page, label: string): Promise<void> {
  await page.getByRole('button').filter({ hasText: label }).first().click();
}

export async function choosePayment(page: Page, label: string): Promise<void> {
  await page.getByRole('button').filter({ hasText: label }).first().click();
}

export interface ContactDetails {
  name: string;
  phone: string;
  address?: string;
  landmark?: string;
  notes?: string;
}

/** Form fields carry real `id`s, so they need no invented hooks. */
export async function fillContact(page: Page, details: ContactDetails): Promise<void> {
  await page.locator('#customerName').fill(details.name);
  await page.locator('#phone').fill(details.phone);
  if (details.address !== undefined) await page.locator('#address').fill(details.address);
  if (details.landmark !== undefined) await page.locator('#landmark').fill(details.landmark);
  if (details.notes !== undefined) await page.locator('#notes').fill(details.notes);
}

export function submitButton(page: Page, label: string): Locator {
  return page.getByRole('button').filter({ hasText: label }).last();
}
