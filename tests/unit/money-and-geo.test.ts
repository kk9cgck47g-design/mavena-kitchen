import { describe, expect, it } from 'vitest';

import { isPointInPolygon, type Polygon } from '@/lib/geo';
import { DEFAULT_LOCALE, pickLocalized } from '@/lib/i18n/locales';
import {
  applyPercent,
  assertAmd,
  clampToZero,
  formatAmd,
  MoneyError,
  multiplyAmd,
} from '@/lib/money';

describe('money', () => {
  it('rejects fractional amounts at the boundary', () => {
    expect(() => assertAmd(1500.5)).toThrow(MoneyError);
    expect(() => assertAmd('1500' as unknown as number)).toThrow(MoneyError);
    expect(() => assertAmd(-1)).toThrow(MoneyError);
    expect(() => assertAmd(1500)).not.toThrow();
  });

  it('rejects a fractional quantity', () => {
    expect(() => multiplyAmd(1000, 1.5)).toThrow(MoneyError);
    expect(() => multiplyAmd(1000, -1)).toThrow(MoneyError);
  });

  it('rounds percentage discounts down, never against the customer', () => {
    // 33% of 1000 is 330.0 exactly; 33% of 1001 is 330.33 → 330.
    expect(applyPercent(1000, 33)).toBe(330);
    expect(applyPercent(1001, 33)).toBe(330);
    expect(Number.isInteger(applyPercent(9999, 17))).toBe(true);
  });

  it('refuses a nonsensical percentage', () => {
    expect(() => applyPercent(1000, 101)).toThrow(MoneyError);
    expect(() => applyPercent(1000, -5)).toThrow(MoneyError);
  });

  it('never lets a total go negative', () => {
    expect(clampToZero(-500)).toBe(0);
    expect(clampToZero(500)).toBe(500);
  });
});

/**
 * These assertions are the reason `formatAmd` does not call `Intl.NumberFormat`.
 *
 * Intl's grouping comes from the CLDR data of whichever runtime evaluates it,
 * and Node and the browser do not ship the same one: Node renders Armenian
 * `1350 ֏` while Chromium renders `1 350 ֏`. Server and client disagreeing on a
 * price is a hydration failure, and React responds by discarding the whole
 * server-rendered page. A price has to be one string, everywhere.
 */
describe('formatAmd', () => {
  const NBSP = '\u00A0';

  it('does not group four-digit Armenian amounts, and does group five-digit ones', () => {
    expect(formatAmd(1350, 'hy')).toBe(`1350${NBSP}֏`);
    expect(formatAmd(12500, 'hy')).toBe(`12${NBSP}500${NBSP}֏`);
    expect(formatAmd(999, 'hy')).toBe(`999${NBSP}֏`);
  });

  it('groups from four digits up in Russian and English', () => {
    expect(formatAmd(1350, 'ru')).toBe(`1${NBSP}350${NBSP}֏`);
    expect(formatAmd(1350, 'en')).toBe('֏1,350');
    expect(formatAmd(999, 'ru')).toBe(`999${NBSP}֏`);
  });

  it('puts the sign where each language puts it', () => {
    expect(formatAmd(500, 'hy').endsWith('֏')).toBe(true);
    expect(formatAmd(500, 'ru').endsWith('֏')).toBe(true);
    expect(formatAmd(500, 'en').startsWith('֏')).toBe(true);
  });

  it('separates every group in a long amount', () => {
    expect(formatAmd(1234567, 'ru')).toBe(`1${NBSP}234${NBSP}567${NBSP}֏`);
    expect(formatAmd(1234567, 'en')).toBe('֏1,234,567');
  });

  it('uses a non-breaking space, so a price never wraps mid-number', () => {
    expect(formatAmd(12500, 'hy')).not.toContain(' ');
    expect(formatAmd(1350, 'ru')).not.toContain(' ');
  });

  it('is stable across locales for a zero amount', () => {
    expect(formatAmd(0, 'hy')).toBe(`0${NBSP}֏`);
    expect(formatAmd(0, 'en')).toBe('֏0');
  });
});

describe('pickLocalized', () => {
  it('falls back to Armenian when a translation is missing', () => {
    const text = { hy: 'Խորոված', ru: '', en: '' };

    expect(pickLocalized(text, 'ru')).toBe('Խորոված');
    expect(pickLocalized(text, DEFAULT_LOCALE)).toBe('Խորոված');
  });

  it('uses the exact translation when present', () => {
    expect(pickLocalized({ hy: 'Խորոված', ru: 'Хоровац', en: 'Khorovats' }, 'en')).toBe(
      'Khorovats',
    );
  });

  it('returns an empty string rather than throwing on missing text', () => {
    expect(pickLocalized(null, 'hy')).toBe('');
  });
});

describe('isPointInPolygon', () => {
  // Unit square with corners (0,0) and (1,1); GeoJSON order is [lng, lat].
  const unitSquare: Polygon = {
    type: 'Polygon',
    coordinates: [
      [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
        [0, 0],
      ],
    ],
  };

  it('accepts an interior point', () => {
    expect(isPointInPolygon({ lat: 0.5, lng: 0.5 }, unitSquare)).toBe(true);
  });

  it('rejects an exterior point', () => {
    expect(isPointInPolygon({ lat: 1.5, lng: 0.5 }, unitSquare)).toBe(false);
    expect(isPointInPolygon({ lat: 0.5, lng: -0.5 }, unitSquare)).toBe(false);
  });

  it('does not confuse latitude with longitude', () => {
    const tallStrip: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [0.1, 0],
          [0.1, 1],
          [0, 1],
          [0, 0],
        ],
      ],
    };

    // Inside: lng 0.05 within [0, 0.1], lat 0.5 within [0, 1].
    expect(isPointInPolygon({ lat: 0.5, lng: 0.05 }, tallStrip)).toBe(true);
    // Swapped axes would wrongly pass; it must not.
    expect(isPointInPolygon({ lat: 0.05, lng: 0.5 }, tallStrip)).toBe(false);
  });

  it('handles a concave zone correctly', () => {
    // L-shape occupying the bottom row and left column of a 2x2 square.
    const lShape: Polygon = {
      type: 'Polygon',
      coordinates: [
        [
          [0, 0],
          [2, 0],
          [2, 1],
          [1, 1],
          [1, 2],
          [0, 2],
          [0, 0],
        ],
      ],
    };

    expect(isPointInPolygon({ lat: 0.5, lng: 1.5 }, lShape)).toBe(true);
    // The notch in the top-right corner is outside the zone.
    expect(isPointInPolygon({ lat: 1.5, lng: 1.5 }, lShape)).toBe(false);
  });

  it('rejects a degenerate ring instead of crashing', () => {
    const degenerate = { type: 'Polygon', coordinates: [[[0, 0] as [number, number]]] } as Polygon;
    expect(isPointInPolygon({ lat: 0, lng: 0 }, degenerate)).toBe(false);
  });
});
