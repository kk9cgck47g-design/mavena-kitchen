import type { CityCode } from '@/lib/domain';
import type { Polygon } from '@/lib/geo';
import type { LocalizedText } from '@/lib/i18n/locales';

/**
 * The city and its starting delivery rules.
 *
 * Shared by the database seed and the demo catalogue so the two can never drift.
 * In production these live in the database and are edited in the admin panel;
 * this file only provides the initial values.
 *
 * The three zones are demonstration data. They are drawn to sit roughly over the
 * central, middle and outer parts of Yerevan so the map reads as a real city
 * rather than a test fixture — but they are delivery areas invented for this
 * demo and nothing more. They are not municipal district boundaries and must not
 * be described as any.
 */

/**
 * Where the map opens: central Yerevan, on the axis between Republic Square and
 * the Opera.
 *
 * Not the same value as the restaurant's own pin, which lives in
 * `lib/restaurant.ts` and is the one thing on the map that is about the business
 * rather than about the city. The two sit a couple of streets apart and both
 * fall inside the central zone.
 */
export const YEREVAN = { lat: 40.183, lng: 44.514 };

function t(hy: string, ru: string, en: string): LocalizedText {
  return { hy, ru, en };
}

/**
 * Build a closed GeoJSON ring from `[lng, lat]` pairs.
 *
 * GeoJSON wants the first and last position to be identical, and a ring written
 * out by hand is exactly where that gets forgotten — so the closing point is
 * appended here rather than typed at the end of every list below. Longitude
 * first: the axis order is the most common bug in map data, and `lib/geo.ts`
 * says so at greater length.
 */
function ring(points: readonly (readonly [number, number])[]): Polygon {
  const first = points[0];
  return {
    type: 'Polygon',
    coordinates: [[...points.map(([lng, lat]): [number, number] => [lng, lat]), [first[0], first[1]]]],
  };
}

export interface SeedCity {
  code: CityCode;
  name: LocalizedText;
  center: { lat: number; lng: number };
  defaultZoom: number;
  sortOrder: number;
}

export const CITIES: SeedCity[] = [
  {
    code: 'YEREVAN',
    name: t('Երևան', 'Ереван', 'Yerevan'),
    center: YEREVAN,
    /*
      Twelve, where a small town wanted fourteen. The outer zone is about 17 km
      across; at 14 it does not fit the frame at all, and somebody opening the
      contacts page is shown three streets instead of a delivery area.
    */
    defaultZoom: 12,
    sortOrder: 0,
  },
];

export interface SeedZone {
  id: string;
  cityCode: CityCode;
  name: LocalizedText;
  polygon: Polygon;
  fee: number;
  minOrder: number;
  freeDeliveryFrom: number | null;
  etaMinutes: number;
  priority: number;
}

/**
 * Three nested areas, cheapest in the middle.
 *
 * Nested on purpose. Every address in the centre falls inside all three
 * polygons, so the choice between them is made by `priority` and by nothing
 * else — which is the rule the delivery engine exists to apply, exercised here
 * by ordinary use rather than by a contrived corner case. The priorities read as
 * a ladder: the smallest and cheapest area is consulted first, and an address
 * only falls through to a wider, dearer one because it missed the tighter ones.
 *
 * The outlines are deliberately unalike — a compact eight-sided core, a rounder
 * ten-sided middle, a wide twelve-sided envelope — because three concentric
 * rectangles would look like exactly what they were.
 */
export const ZONES: SeedZone[] = [
  {
    id: 'zone-yerevan-central',
    cityCode: 'YEREVAN',
    name: t('Կենտրոնական գոտի', 'Центральная зона', 'Central zone'),
    polygon: ring([
      [44.5, 40.176],
      [44.509, 40.171],
      [44.521, 40.173],
      [44.529, 40.18],
      [44.528, 40.189],
      [44.519, 40.195],
      [44.506, 40.193],
      [44.499, 40.185],
    ]),
    fee: 400,
    minOrder: 2000,
    freeDeliveryFrom: 6000,
    etaMinutes: 25,
    priority: 0,
  },
  {
    id: 'zone-yerevan-inner',
    cityCode: 'YEREVAN',
    name: t('Միջին գոտի', 'Средняя зона', 'Inner zone'),
    polygon: ring([
      [44.478, 40.166],
      [44.495, 40.156],
      [44.518, 40.154],
      [44.54, 40.162],
      [44.552, 40.178],
      [44.554, 40.196],
      [44.542, 40.21],
      [44.52, 40.217],
      [44.496, 40.21],
      [44.48, 40.193],
    ]),
    fee: 700,
    minOrder: 3000,
    freeDeliveryFrom: 10_000,
    etaMinutes: 40,
    priority: 10,
  },
  {
    id: 'zone-yerevan-outer',
    cityCode: 'YEREVAN',
    name: t('Արտաքին գոտի', 'Внешняя зона', 'Outer zone'),
    polygon: ring([
      [44.43, 40.145],
      [44.47, 40.125],
      [44.52, 40.122],
      [44.565, 40.135],
      [44.59, 40.16],
      [44.595, 40.19],
      [44.585, 40.22],
      [44.555, 40.24],
      [44.51, 40.245],
      [44.465, 40.235],
      [44.435, 40.21],
      [44.425, 40.178],
    ]),
    fee: 1100,
    minOrder: 4000,
    freeDeliveryFrom: 15_000,
    etaMinutes: 60,
    priority: 20,
  },
];
