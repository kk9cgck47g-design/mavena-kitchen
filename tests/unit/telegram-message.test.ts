import { describe, expect, it } from 'vitest';

import { CITY_CODES, ORDER_STATUSES, canTransition, type OrderStatus } from '@/lib/domain';
import type { OrderView } from '@/lib/order-types';
import { secretsMatch } from '@/server/telegram/config';
import {
  escapeHtml,
  parseCallbackData,
  renderOrderMessage,
  statusButtons,
} from '@/server/telegram/message';

/** The formatter separates thousands with a non-breaking space. */
const NBSP = '\u00A0';

function order(overrides: Partial<OrderView> = {}): OrderView {
  return {
    id: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
    publicCode: 'MK-482193',
    status: 'NEW',
    type: 'DELIVERY',
    customerName: 'Անի Գ.',
    phone: '+37400000101',
    cityCode: CITY_CODES[0],
    address: 'Դեմո փողոց 14',
    landmark: 'Դեղատան դիմաց',
    lat: 40.1834,
    lng: 44.5119,
    notes: null,
    paymentMethod: 'CASH',
    paymentStatus: 'PENDING',
    paymentExpiresAt: null,
    subtotal: 2700,
    deliveryFee: 500,
    discount: 0,
    total: 3200,
    etaMinutes: 35,
    createdAt: '2026-08-08T09:00:00.000Z',
    updatedAt: '2026-08-08T09:00:00.000Z',
    cancelReason: null,
    items: [
      {
        id: 'i1',
        name: { hy: 'Բուրգեր', ru: 'Бургер с говядиной', en: 'Beef burger' },
        options: [{ name: { hy: 'Մեծ', ru: 'Большой', en: 'Large' }, priceDelta: 200 }],
        unitPrice: 1350,
        quantity: 2,
        lineTotal: 2700,
        image: null,
      },
    ],
    ...overrides,
  };
}

describe('renderOrderMessage', () => {
  it('carries everything the kitchen needs to act without opening anything', () => {
    const text = renderOrderMessage(order(), 'https://example.com/admin/orders/7c9e6679');

    expect(text).toContain('MK-482193');
    expect(text).toContain('Бургер с говядиной');
    expect(text).toContain('Большой');
    expect(text).toContain(`2${NBSP}700${NBSP}֏`); // line total
    expect(text).toContain(`3${NBSP}200${NBSP}֏`); // order total
    expect(text).toContain('Наличными');
    expect(text).toContain('35 мин');
    expect(text).toContain('Դեմո փողոց 14');
    expect(text).toContain('Դեղատան դիմաց');
    expect(text).toContain('+374 00 000101');
    expect(text).toContain('https://example.com/admin/orders/7c9e6679');
  });

  it('says which kind of order it is, and omits delivery lines for pickup', () => {
    expect(renderOrderMessage(order(), 'x')).toContain('Доставка');

    const pickup = renderOrderMessage(
      order({
        type: 'PICKUP',
        address: null,
        landmark: null,
        lat: null,
        lng: null,
        deliveryFee: 0,
      }),
      'x',
    );

    expect(pickup).toContain('Самовывоз');
    expect(pickup).not.toContain('Адрес:');
    expect(pickup).not.toContain('Ориентир:');
    expect(pickup).not.toContain('openstreetmap');
  });

  it('includes a map link when there is a pin', () => {
    expect(renderOrderMessage(order(), 'x')).toContain('mlat=40.1834&mlon=44.5119');
  });

  it('shows the customer note when there is one', () => {
    expect(renderOrderMessage(order({ notes: 'Без лука' }), 'x')).toContain('Без лука');
    expect(renderOrderMessage(order(), 'x')).not.toContain('Комментарий');
  });

  it('escapes what the customer typed, so a name cannot become markup', () => {
    // Telegram parses a subset of HTML; an unescaped `<` either breaks the
    // message or is interpreted, and both are the customer's text deciding how
    // the kitchen ticket renders.
    const text = renderOrderMessage(order({ customerName: '<b>Ани</b> & co' }), 'x');

    expect(text).toContain('&lt;b&gt;Ани&lt;/b&gt; &amp; co');
    expect(text).not.toContain('<b>Ани</b>');
  });

  it('escapes ampersands and angle brackets in isolation', () => {
    expect(escapeHtml('a & b < c > d')).toBe('a &amp; b &lt; c &gt; d');
  });
});

describe('statusButtons', () => {
  it('offers exactly the moves the domain permits, for every status', () => {
    for (const status of ORDER_STATUSES) {
      const offered = statusButtons({ publicCode: 'MK-482193', status })
        .flat()
        .map((button) => parseCallbackData(button.callback_data)?.to);

      for (const to of ORDER_STATUSES) {
        expect(offered.includes(to)).toBe(canTransition(status, to));
      }
    }
  });

  it('offers nothing once the order is finished', () => {
    expect(statusButtons({ publicCode: 'MK-482193', status: 'COMPLETED' })).toEqual([]);
    expect(statusButtons({ publicCode: 'MK-482193', status: 'CANCELLED' })).toEqual([]);
  });

  it('keeps cancel on its own row, away from the thumb aiming at confirm', () => {
    const rows = statusButtons({ publicCode: 'MK-482193', status: 'NEW' });

    expect(rows).toHaveLength(2);
    expect(rows[0].every((b) => !b.callback_data.endsWith('CANCELLED'))).toBe(true);
    expect(rows[1].every((b) => b.callback_data.endsWith('CANCELLED'))).toBe(true);
  });

  it('stays inside Telegram’s 64-byte callback limit', () => {
    // Which is why the payload carries the public code rather than the UUID.
    for (const status of ORDER_STATUSES) {
      for (const button of statusButtons({ publicCode: 'MK-482193', status }).flat()) {
        expect(Buffer.byteLength(button.callback_data, 'utf8')).toBeLessThanOrEqual(64);
      }
    }
  });
});

describe('parseCallbackData', () => {
  it('round-trips what statusButtons produced', () => {
    const [button] = statusButtons({ publicCode: 'MK-482193', status: 'NEW' }).flat();
    expect(parseCallbackData(button.callback_data)).toEqual({
      publicCode: 'MK-482193',
      to: 'CONFIRMED' satisfies OrderStatus,
    });
  });

  it('refuses anything it did not produce', () => {
    expect(parseCallbackData('')).toBeNull();
    expect(parseCallbackData('st:MK-482193')).toBeNull();
    expect(parseCallbackData('delete:MK-482193:NEW')).toBeNull();
    expect(parseCallbackData('st:MK-482193:DROP TABLE')).toBeNull();
    // A status that is not in the domain is not a status.
    expect(parseCallbackData('st:MK-482193:SHIPPED')).toBeNull();
  });
});

describe('secretsMatch', () => {
  it('accepts only an exact match', () => {
    expect(secretsMatch('correct-horse', 'correct-horse')).toBe(true);
    expect(secretsMatch('correct-horse', 'correct-hors3')).toBe(false);
    expect(secretsMatch('correct-horse', 'correct-hors')).toBe(false);
    expect(secretsMatch('', '')).toBe(true);
  });
});
