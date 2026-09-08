import { describe, expect, it } from 'vitest';

import { CITY_CODES, type CityCode } from '@/lib/domain';
import type { Polygon } from '@/lib/geo';
import { uniformLocalized } from '@/lib/i18n/locales';
import type { CartLine } from '@/lib/schemas/cart';
import { buildCheckoutQuote, type CheckoutQuoteInput } from '@/server/services/checkout-quote';
import type { DeliveryZoneRule } from '@/server/services/delivery';
import type { PricingProduct } from '@/server/services/pricing';

/**
 * The quote the checkout screen renders.
 *
 * Every amount the customer sees before committing comes from here, so the
 * cases that matter are the ones where an order is *almost* placeable: outside
 * the zone, a few hundred drams under the minimum, a dish that went on the stop
 * list while the cart sat in localStorage.
 */

/** Axis-aligned square, GeoJSON order: [lng, lat]. */
function square(centerLat: number, centerLng: number, halfSize: number): Polygon {
  return {
    type: 'Polygon',
    coordinates: [
      [
        [centerLng - halfSize, centerLat - halfSize],
        [centerLng + halfSize, centerLat - halfSize],
        [centerLng + halfSize, centerLat + halfSize],
        [centerLng - halfSize, centerLat + halfSize],
        [centerLng - halfSize, centerLat - halfSize],
      ],
    ],
  };
}

const CITY = CITY_CODES[0];

/**
 * A city this deployment does not serve, for the stale-draft case below. The
 * type admits only configured cities; a draft written before the list changed
 * does not, which is the whole point of the test.
 */
const OTHER_CITY = 'ELSEWHERE' as CityCode;

/** Central Yerevan — inside the demo delivery area. */
const CENTRE = { lat: 40.1834, lng: 44.5119 };

/** Gyumri: 120 km away, outside every zone by any margin. */
const FAR_AWAY = { lat: 40.7894, lng: 43.8475 };

const PREP_TIME = 25;

function zone(overrides: Partial<DeliveryZoneRule> = {}): DeliveryZoneRule {
  return {
    id: 'z-central',
    cityCode: CITY,
    name: uniformLocalized('Centre'),
    polygon: square(CENTRE.lat, CENTRE.lng, 0.02),
    fee: 500,
    minOrder: 3000,
    freeDeliveryFrom: 10_000,
    etaMinutes: 40,
    isActive: true,
    priority: 0,
    ...overrides,
  };
}

/** 1500 ֏ a piece, no option groups — quantity alone moves the subtotal. */
function product(overrides: Partial<PricingProduct> = {}): PricingProduct {
  return {
    id: 'p1',
    name: uniformLocalized('Beef Burger'),
    basePrice: 1500,
    images: ['https://cdn.example/burger.jpg'],
    isActive: true,
    isAvailable: true,
    optionGroups: [],
    ...overrides,
  };
}

function menu(...products: PricingProduct[]) {
  return new Map(products.map((p) => [p.id, p]));
}

function cart(quantity: number): CartLine[] {
  return [{ productId: 'p1', optionIds: [], quantity }];
}

function quote(
  input: Partial<CheckoutQuoteInput> = {},
  options: { products?: PricingProduct[]; zones?: DeliveryZoneRule[] } = {},
) {
  return buildCheckoutQuote({
    input: {
      type: 'DELIVERY',
      cityCode: CITY,
      point: CENTRE,
      cart: cart(4), // 6000 ֏ — clears the 3000 minimum, short of free delivery.
      ...input,
    },
    productsById: menu(...(options.products ?? [product()])),
    zones: options.zones ?? [zone()],
    prepTimeMinutes: PREP_TIME,
  });
}

describe('buildCheckoutQuote', () => {
  it('quotes a delivery order: subtotal, zone fee, total and the zone ETA', () => {
    const { quote: q } = quote();

    expect(q.blocker).toBeNull();
    if (q.blocker) return;

    expect(q.subtotal).toBe(6000);
    expect(q.deliveryFee).toBe(500);
    expect(q.discount).toBe(0);
    expect(q.total).toBe(6500);
    expect(q.etaMinutes).toBe(40);
    expect(q.zone?.id).toBe('z-central');
    expect(q.isFreeDelivery).toBe(false);
    expect(q.amountToFreeDelivery).toBe(4000);
  });

  it('quotes a pickup order with no fee, no zone and the kitchen prep time', () => {
    const { quote: q } = quote({ type: 'PICKUP' });

    expect(q.blocker).toBeNull();
    if (q.blocker) return;

    expect(q.deliveryFee).toBe(0);
    expect(q.total).toBe(q.subtotal);
    expect(q.zone).toBeNull();
    expect(q.etaMinutes).toBe(PREP_TIME);
    expect(q.amountToFreeDelivery).toBeNull();
  });

  it('ignores a stale city and pin left over from a delivery the customer switched away from', () => {
    const { quote: q } = quote({ type: 'PICKUP', cityCode: OTHER_CITY, point: FAR_AWAY });

    // An address outside every zone must not block a pickup order.
    expect(q.blocker).toBeNull();
    if (q.blocker) return;
    expect(q.deliveryFee).toBe(0);
  });

  it('drops the delivery fee at the free-delivery threshold', () => {
    const { quote: q } = quote({ cart: cart(7) }); // 10 500 ֏

    expect(q.blocker).toBeNull();
    if (q.blocker) return;

    expect(q.deliveryFee).toBe(0);
    expect(q.isFreeDelivery).toBe(true);
    expect(q.total).toBe(10_500);
    expect(q.amountToFreeDelivery).toBeNull();
  });

  it('still reports the subtotal when the address is outside every zone', () => {
    const { quote: q } = quote({ point: FAR_AWAY });

    expect(q.blocker).toEqual({ code: 'OUT_OF_ZONE' });
    expect(q.subtotal).toBe(6000);
    expect(q.zone).toBeNull();
  });

  it('says exactly how much is missing below the minimum, and from which zone', () => {
    const { quote: q } = quote({ cart: cart(1) }); // 1500 ֏ against a 3000 minimum

    expect(q.blocker).toMatchObject({ code: 'BELOW_MIN_ORDER', minOrder: 3000, missing: 1500 });
    expect(q.subtotal).toBe(1500);
    expect(q.zone?.name.hy).toBe('Centre');
  });

  it('asks for a city and then for a pin, in that order', () => {
    expect(quote({ cityCode: null, point: null }).quote.blocker).toEqual({
      code: 'CITY_REQUIRED',
    });
    expect(quote({ point: null }).quote.blocker).toEqual({ code: 'LOCATION_REQUIRED' });
  });

  it('reports an empty cart as its own state rather than as a broken one', () => {
    const { quote: q, lines } = quote({ cart: [] });

    expect(q.blocker).toEqual({ code: 'EMPTY_CART' });
    expect(q.subtotal).toBeNull();
    expect(lines).toEqual([]);
  });

  it('refuses to price a cart holding a dish that went on the stop list', () => {
    const { quote: q } = quote({}, { products: [product({ isAvailable: false })] });

    expect(q.blocker).toMatchObject({ code: 'CART_INVALID' });
    if (!q.blocker || q.blocker.code !== 'CART_INVALID') return;
    expect(q.blocker.issues[0].code).toBe('PRODUCT_UNAVAILABLE');
    expect(q.subtotal).toBeNull();
  });

  it('never exposes a total for an order that cannot be placed', () => {
    // The union is what enforces this at compile time; this asserts the shape a
    // blocked quote is actually serialised with.
    const blocked = quote({ point: FAR_AWAY }).quote;

    expect(blocked).not.toHaveProperty('total');
    expect(blocked).not.toHaveProperty('deliveryFee');
    expect(blocked).not.toHaveProperty('etaMinutes');
  });

  it('hands back the priced lines for the order snapshot, prices included', () => {
    const { lines } = quote({ cart: cart(2) });

    expect(lines).toHaveLength(1);
    expect(lines[0].unitPrice).toBe(1500);
    expect(lines[0].lineTotal).toBe(3000);
    expect(lines[0].nameSnapshot.hy).toBe('Beef Burger');
  });

  it('keeps every amount a whole number of drams', () => {
    const { quote: q } = quote({ cart: cart(3) });

    expect(q.blocker).toBeNull();
    if (q.blocker) return;

    for (const amount of [q.subtotal, q.deliveryFee, q.discount, q.total]) {
      expect(Number.isInteger(amount)).toBe(true);
    }
  });

  it('applies the zone the pin is actually in when zones overlap', () => {
    const outskirts = zone({
      id: 'z-outskirts',
      polygon: square(CENTRE.lat, CENTRE.lng, 0.05),
      fee: 900,
      etaMinutes: 55,
      priority: 10,
    });

    // Inside both; the lower priority wins, as `findZoneForPoint` decides.
    const inner = quote({}, { zones: [outskirts, zone()] }).quote;
    expect(inner.blocker).toBeNull();
    if (inner.blocker) return;
    expect(inner.deliveryFee).toBe(500);
    expect(inner.etaMinutes).toBe(40);

    // Inside the wide zone only.
    const outer = quote(
      { point: { lat: CENTRE.lat + 0.04, lng: CENTRE.lng } },
      { zones: [outskirts, zone()] },
    ).quote;
    expect(outer.blocker).toBeNull();
    if (outer.blocker) return;
    expect(outer.deliveryFee).toBe(900);
    expect(outer.etaMinutes).toBe(55);
  });
});
