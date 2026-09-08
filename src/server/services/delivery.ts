import type { CityCode, OrderType } from '@/lib/domain';
import { isPointInPolygon, type LatLng, type Polygon } from '@/lib/geo';
import { type Amd, clampToZero } from '@/lib/money';
import type { LocalizedText } from '@/lib/i18n/locales';

/**
 * Delivery rules.
 *
 * Each city keeps an entirely separate zone set, so their fees, minimums
 * and ETAs never leak into each other. Like pricing, this is a pure function so
 * the interesting cases (pin outside every zone, overlapping zones, exactly at
 * the free-delivery threshold) can be tested without a database.
 */

export interface DeliveryZoneRule {
  id: string;
  cityCode: CityCode;
  name: LocalizedText;
  polygon: Polygon;
  fee: Amd;
  minOrder: Amd;
  /** Subtotal from which delivery costs nothing. `null` = never free. */
  freeDeliveryFrom: Amd | null;
  etaMinutes: number;
  isActive: boolean;
  /** Lower wins on overlap, so a cheap inner zone can sit inside a wider one. */
  priority: number;
}

export interface DeliveryQuoteInput {
  type: OrderType;
  subtotal: Amd;
  cityCode?: CityCode | null;
  /** The pin the customer dragged. Required for delivery. */
  point?: LatLng | null;
  zones: readonly DeliveryZoneRule[];
}

export type DeliveryQuote =
  | { ok: true; kind: 'PICKUP'; fee: 0 }
  | {
      ok: true;
      kind: 'DELIVERY';
      zone: DeliveryZoneRule;
      fee: Amd;
      etaMinutes: number;
      isFree: boolean;
      /** How much more the customer must add to stop paying for delivery. `null` if not applicable. */
      amountToFreeDelivery: Amd | null;
    }
  | { ok: false; reason: 'CITY_REQUIRED' | 'LOCATION_REQUIRED' | 'OUT_OF_ZONE' }
  | {
      ok: false;
      reason: 'BELOW_MIN_ORDER';
      zone: DeliveryZoneRule;
      minOrder: Amd;
      /** Exactly how much is missing, so the UI can say "add 800 ֏ more". */
      missing: Amd;
    };

/**
 * Resolve the zone a point falls into.
 *
 * Zones may overlap; the lowest `priority` wins, then the cheapest fee. Without
 * a deterministic rule, a customer could see a different delivery price on
 * reload for the same address.
 */
export function findZoneForPoint(
  point: LatLng,
  cityCode: CityCode,
  zones: readonly DeliveryZoneRule[],
): DeliveryZoneRule | null {
  const matches = zones
    .filter((zone) => zone.isActive && zone.cityCode === cityCode)
    .filter((zone) => isPointInPolygon(point, zone.polygon));

  if (matches.length === 0) return null;

  return matches.sort((a, b) => a.priority - b.priority || a.fee - b.fee || a.id.localeCompare(b.id))[0];
}

export function quoteDelivery(input: DeliveryQuoteInput): DeliveryQuote {
  if (input.type === 'PICKUP') {
    return { ok: true, kind: 'PICKUP', fee: 0 };
  }

  if (!input.cityCode) return { ok: false, reason: 'CITY_REQUIRED' };
  if (!input.point) return { ok: false, reason: 'LOCATION_REQUIRED' };

  const zone = findZoneForPoint(input.point, input.cityCode, input.zones);
  if (!zone) return { ok: false, reason: 'OUT_OF_ZONE' };

  if (input.subtotal < zone.minOrder) {
    return {
      ok: false,
      reason: 'BELOW_MIN_ORDER',
      zone,
      minOrder: zone.minOrder,
      missing: clampToZero(zone.minOrder - input.subtotal),
    };
  }

  // The threshold is inclusive: hitting it exactly earns free delivery.
  const isFree = zone.freeDeliveryFrom !== null && input.subtotal >= zone.freeDeliveryFrom;

  const amountToFreeDelivery =
    zone.freeDeliveryFrom === null || isFree
      ? null
      : clampToZero(zone.freeDeliveryFrom - input.subtotal);

  return {
    ok: true,
    kind: 'DELIVERY',
    zone,
    fee: isFree ? 0 : zone.fee,
    etaMinutes: zone.etaMinutes,
    isFree,
    amountToFreeDelivery,
  };
}
