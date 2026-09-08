import { describe, expect, it } from 'vitest';

import { CITY_CODES, type CityCode } from '@/lib/domain';
import type { Polygon } from '@/lib/geo';
import { uniformLocalized } from '@/lib/i18n/locales';
import { ZONES } from '@/server/db/delivery-data';
import { findZoneForPoint, quoteDelivery, type DeliveryZoneRule } from '@/server/services/delivery';

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
 * A city this deployment does not serve.
 *
 * The type admits only the configured cities, which is right everywhere the
 * application decides something. `findZoneForPoint` is the exception: it is
 * handed rows from a database that outlives any one configuration, and its job
 * includes ignoring a zone that belongs somewhere else. Proving it does requires
 * a code the type will not produce, so it is cast here and nowhere else.
 */
const OTHER_CITY = 'ELSEWHERE' as CityCode;

/** Central Yerevan — inside the demo delivery area. */
const CENTRE = { lat: 40.1834, lng: 44.5119 };

/** Gyumri: a real place, 120 km away, outside every demo polygon by any margin. */
const FAR_AWAY = { lat: 40.7894, lng: 43.8475 };

function zone(overrides: Partial<DeliveryZoneRule> = {}): DeliveryZoneRule {
  return {
    id: 'z-centre',
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

describe('findZoneForPoint', () => {
  it('finds the zone containing the pin', () => {
    expect(findZoneForPoint(CENTRE, CITY, [zone()])?.id).toBe('z-centre');
  });

  it('returns null for a pin outside every zone', () => {
    expect(findZoneForPoint(FAR_AWAY, CITY, [zone()])).toBeNull();
  });

  it('never matches a zone from another city', () => {
    const elsewhereZone = zone({
      id: 'z-elsewhere',
      cityCode: OTHER_CITY,
      polygon: square(FAR_AWAY.lat, FAR_AWAY.lng, 0.02),
    });

    expect(findZoneForPoint(FAR_AWAY, CITY, [elsewhereZone])).toBeNull();
    expect(findZoneForPoint(FAR_AWAY, OTHER_CITY, [elsewhereZone])?.id).toBe('z-elsewhere');
  });

  it('skips deactivated zones', () => {
    expect(findZoneForPoint(CENTRE, CITY, [zone({ isActive: false })])).toBeNull();
  });

  it('prefers the lower priority when zones overlap', () => {
    const wide = zone({
      id: 'z-wide',
      polygon: square(CENTRE.lat, CENTRE.lng, 0.05),
      fee: 1000,
      priority: 10,
    });
    const inner = zone({ id: 'z-inner', fee: 500, priority: 1 });

    expect(findZoneForPoint(CENTRE, CITY, [wide, inner])?.id).toBe('z-inner');
  });

  it('is deterministic when priority and fee tie', () => {
    const a = zone({ id: 'z-a', polygon: square(CENTRE.lat, CENTRE.lng, 0.05) });
    const b = zone({ id: 'z-b', polygon: square(CENTRE.lat, CENTRE.lng, 0.05) });

    expect(findZoneForPoint(CENTRE, CITY, [a, b])?.id).toBe(
      findZoneForPoint(CENTRE, CITY, [b, a])?.id,
    );
  });
});

describe('quoteDelivery', () => {
  it('charges nothing for pickup and ignores zones entirely', () => {
    const quote = quoteDelivery({ type: 'PICKUP', subtotal: 500, zones: [] });

    expect(quote).toEqual({ ok: true, kind: 'PICKUP', fee: 0 });
  });

  it('charges the zone fee for a normal delivery', () => {
    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 5000,
      cityCode: CITY,
      point: CENTRE,
      zones: [zone()],
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok || quote.kind !== 'DELIVERY') return;
    expect(quote.fee).toBe(500);
    expect(quote.etaMinutes).toBe(40);
    expect(quote.isFree).toBe(false);
    expect(quote.amountToFreeDelivery).toBe(5000);
  });

  it('makes delivery free exactly at the threshold', () => {
    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 10_000,
      cityCode: CITY,
      point: CENTRE,
      zones: [zone()],
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok || quote.kind !== 'DELIVERY') return;
    expect(quote.fee).toBe(0);
    expect(quote.isFree).toBe(true);
    expect(quote.amountToFreeDelivery).toBeNull();
  });

  it('keeps charging when the zone never offers free delivery', () => {
    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 999_999,
      cityCode: CITY,
      point: CENTRE,
      zones: [zone({ freeDeliveryFrom: null })],
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok || quote.kind !== 'DELIVERY') return;
    expect(quote.fee).toBe(500);
    expect(quote.amountToFreeDelivery).toBeNull();
  });

  it('blocks an address outside the delivery area', () => {
    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 5000,
      cityCode: CITY,
      point: FAR_AWAY,
      zones: [zone()],
    });

    expect(quote).toEqual({ ok: false, reason: 'OUT_OF_ZONE' });
  });

  it('reports exactly how much is missing below the minimum order', () => {
    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 2200,
      cityCode: CITY,
      point: CENTRE,
      zones: [zone()],
    });

    expect(quote.ok).toBe(false);
    if (quote.ok || quote.reason !== 'BELOW_MIN_ORDER') return;
    expect(quote.missing).toBe(800);
    expect(quote.minOrder).toBe(3000);
  });

  it('demands a city and a pin before quoting', () => {
    expect(quoteDelivery({ type: 'DELIVERY', subtotal: 5000, zones: [] })).toEqual({
      ok: false,
      reason: 'CITY_REQUIRED',
    });

    expect(quoteDelivery({ type: 'DELIVERY', subtotal: 5000, cityCode: CITY, zones: [] })).toEqual({
      ok: false,
      reason: 'LOCATION_REQUIRED',
    });
  });

  it("applies another city's rules to that city's order, not this one's", () => {
    const zones = [
      zone(),
      zone({
        id: 'z-elsewhere',
        cityCode: OTHER_CITY,
        polygon: square(FAR_AWAY.lat, FAR_AWAY.lng, 0.02),
        fee: 800,
        minOrder: 4000,
        etaMinutes: 60,
      }),
    ];

    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 5000,
      cityCode: OTHER_CITY,
      point: FAR_AWAY,
      zones,
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok || quote.kind !== 'DELIVERY') return;
    expect(quote.fee).toBe(800);
    expect(quote.etaMinutes).toBe(60);
  });
});

describe('production Yerevan delivery zones', () => {
  const productionZones: DeliveryZoneRule[] = ZONES.map((productionZone) => ({
    ...productionZone,
    isActive: true,
  }));

  it.each([
    {
      label: 'Central-only resolution through priority',
      point: CENTRE,
      zoneId: 'zone-yerevan-central',
      fee: 400,
      etaMinutes: 25,
    },
    {
      label: 'Inner outside Central',
      point: { lat: 40.18, lng: 44.49 },
      zoneId: 'zone-yerevan-inner',
      fee: 700,
      etaMinutes: 40,
    },
    {
      label: 'Outer outside Inner',
      point: { lat: 40.18, lng: 44.45 },
      zoneId: 'zone-yerevan-outer',
      fee: 1100,
      etaMinutes: 60,
    },
  ])('quotes the actual $label point', ({ point, zoneId, fee, etaMinutes }) => {
    const quote = quoteDelivery({
      type: 'DELIVERY',
      subtotal: 5000,
      cityCode: CITY,
      point,
      zones: productionZones,
    });

    expect(quote.ok).toBe(true);
    if (!quote.ok || quote.kind !== 'DELIVERY') return;
    expect(quote.zone.id).toBe(zoneId);
    expect(quote.fee).toBe(fee);
    expect(quote.etaMinutes).toBe(etaMinutes);
  });

  it('rejects the actual Gyumri fixture as out of zone', () => {
    expect(
      quoteDelivery({
        type: 'DELIVERY',
        subtotal: 5000,
        cityCode: CITY,
        point: FAR_AWAY,
        zones: productionZones,
      }),
    ).toEqual({ ok: false, reason: 'OUT_OF_ZONE' });
  });
});
