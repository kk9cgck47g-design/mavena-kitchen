import { describe, expect, it } from 'vitest';

import { uniformLocalized } from '@/lib/i18n/locales';
import type { CartLine } from '@/lib/schemas/cart';
import {
  previewUnitPrice,
  priceCart,
  type PricingProduct,
} from '@/server/services/pricing';

function product(overrides: Partial<PricingProduct> = {}): PricingProduct {
  return {
    id: 'p1',
    name: uniformLocalized('Khorovats'),
    basePrice: 3500,
    images: ['https://cdn.example/khorovats.jpg'],
    isActive: true,
    isAvailable: true,
    optionGroups: [],
    ...overrides,
  };
}

const sizeGroup = {
  id: 'g-size',
  name: uniformLocalized('Size'),
  type: 'SINGLE' as const,
  minSelect: 1,
  maxSelect: 1,
  isActive: true,
  options: [
    { id: 'o-small', name: uniformLocalized('Small'), priceDelta: 0, isActive: true },
    { id: 'o-large', name: uniformLocalized('Large'), priceDelta: 900, isActive: true },
  ],
};

const extrasGroup = {
  id: 'g-extras',
  name: uniformLocalized('Extras'),
  type: 'MULTI' as const,
  minSelect: 0,
  maxSelect: 2,
  isActive: true,
  options: [
    { id: 'o-cheese', name: uniformLocalized('Cheese'), priceDelta: 400, isActive: true },
    { id: 'o-bacon', name: uniformLocalized('Bacon'), priceDelta: 600, isActive: true },
    { id: 'o-gone', name: uniformLocalized('Truffle'), priceDelta: 2000, isActive: false },
  ],
};

function menu(...products: PricingProduct[]) {
  return new Map(products.map((p) => [p.id, p]));
}

function line(overrides: Partial<CartLine> = {}): CartLine {
  return { productId: 'p1', optionIds: [], quantity: 1, ...overrides };
}

describe('priceCart', () => {
  it('prices a plain line', () => {
    const result = priceCart([line({ quantity: 3 })], menu(product()));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].unitPrice).toBe(3500);
    expect(result.lines[0].lineTotal).toBe(10_500);
    expect(result.subtotal).toBe(10_500);
  });

  it('adds option deltas to the unit price before multiplying by quantity', () => {
    const result = priceCart(
      [line({ optionIds: ['o-large', 'o-cheese'], quantity: 2 })],
      menu(product({ optionGroups: [sizeGroup, extrasGroup] })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // (3500 + 900 + 400) * 2
    expect(result.lines[0].unitPrice).toBe(4800);
    expect(result.lines[0].lineTotal).toBe(9600);
  });

  it('snapshots names and prices so later menu edits cannot rewrite the order', () => {
    const result = priceCart(
      [line({ optionIds: ['o-large'] })],
      menu(product({ optionGroups: [sizeGroup] })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].nameSnapshot.hy).toBe('Khorovats');
    expect(result.lines[0].imageSnapshot).toBe('https://cdn.example/khorovats.jpg');
    expect(result.lines[0].optionsSnapshot).toEqual([
      { groupName: sizeGroup.name, name: uniformLocalized('Large'), priceDelta: 900 },
    ]);
  });

  it('rejects a dish that is on the daily stop list', () => {
    const result = priceCart([line()], menu(product({ isAvailable: false })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('rejects an unknown product id', () => {
    const result = priceCart([line({ productId: 'ghost' })], menu(product()));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('PRODUCT_NOT_FOUND');
  });

  it('rejects an option belonging to a different dish', () => {
    const other = product({ id: 'p2', optionGroups: [extrasGroup] });
    const result = priceCart(
      [line({ optionIds: ['o-cheese'] })],
      menu(product(), other),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('OPTION_NOT_FOUND');
  });

  it('rejects a deactivated option instead of silently charging for it', () => {
    const result = priceCart(
      [line({ optionIds: ['o-gone'] })],
      menu(product({ optionGroups: [extrasGroup] })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('OPTION_UNAVAILABLE');
  });

  it('rejects a line that omits a required group entirely', () => {
    const result = priceCart([line()], menu(product({ optionGroups: [sizeGroup] })));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ code: 'TOO_FEW_OPTIONS', expected: 1, actual: 0 });
  });

  it('rejects two choices in a single-choice group', () => {
    const result = priceCart(
      [line({ optionIds: ['o-small', 'o-large'] })],
      menu(product({ optionGroups: [sizeGroup] })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ code: 'TOO_MANY_OPTIONS', expected: 1, actual: 2 });
  });

  it('rejects more extras than the group allows', () => {
    const threeExtras = {
      ...extrasGroup,
      options: [
        ...extrasGroup.options,
        { id: 'o-egg', name: uniformLocalized('Egg'), priceDelta: 300, isActive: true },
      ],
    };
    const result = priceCart(
      [line({ optionIds: ['o-cheese', 'o-bacon', 'o-egg'] })],
      menu(product({ optionGroups: [threeExtras] })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0]).toMatchObject({ code: 'TOO_MANY_OPTIONS', expected: 2, actual: 3 });
  });

  it('does not let a duplicated option id be charged twice', () => {
    const result = priceCart(
      [line({ optionIds: ['o-cheese', 'o-cheese'] })],
      menu(product({ optionGroups: [extrasGroup] })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.lines[0].unitPrice).toBe(3900);
    expect(result.lines[0].optionsSnapshot).toHaveLength(1);
  });

  it('reports every broken line at once rather than stopping at the first', () => {
    const result = priceCart(
      [line({ productId: 'ghost' }), line({ productId: 'p2' })],
      menu(product(), product({ id: 'p2', isAvailable: false })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues.map((i) => i.code)).toEqual([
      'PRODUCT_NOT_FOUND',
      'PRODUCT_UNAVAILABLE',
    ]);
    expect(result.issues.map((i) => i.lineIndex)).toEqual([0, 1]);
  });

  it('ignores options from a deactivated group', () => {
    const result = priceCart(
      [line({ optionIds: ['o-cheese'] })],
      menu(product({ optionGroups: [{ ...extrasGroup, isActive: false }] })),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.issues[0].code).toBe('OPTION_NOT_FOUND');
  });

  it('keeps totals as exact integers across a realistic multi-line cart', () => {
    const result = priceCart(
      [
        line({ optionIds: ['o-large'], quantity: 2 }),
        line({ productId: 'p2', quantity: 3 }),
      ],
      menu(product({ optionGroups: [sizeGroup] }), product({ id: 'p2', basePrice: 1290 })),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.subtotal).toBe(4400 * 2 + 1290 * 3);
    expect(Number.isInteger(result.subtotal)).toBe(true);
  });
});

describe('previewUnitPrice', () => {
  it('prices a partial selection without complaining about required groups', () => {
    expect(previewUnitPrice(product({ optionGroups: [sizeGroup, extrasGroup] }), [])).toBe(3500);
  });

  it('ignores inactive options the UI should not have offered', () => {
    expect(
      previewUnitPrice(product({ optionGroups: [extrasGroup] }), ['o-gone', 'o-bacon']),
    ).toBe(4100);
  });
});
