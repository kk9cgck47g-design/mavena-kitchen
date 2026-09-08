import { describe, expect, it } from 'vitest';

import en from '@/messages/en.json';
import hy from '@/messages/hy.json';
import ru from '@/messages/ru.json';
import { BROWSER_STORAGE_KEYS } from '@/lib/browser-storage';
import { RESTAURANT } from '@/lib/restaurant';
import {
  generatePublicCode,
  PUBLIC_CODE_DIGITS,
  PUBLIC_CODE_PREFIX,
} from '@/server/services/order-codes';
import { CHECKOUT_DRAFT_VERSION } from '@/stores/checkout-draft';

describe('Mavena Kitchen identity', () => {
  it('defines one fictional brand consistently in every locale', () => {
    expect(RESTAURANT).toMatchObject({
      name: 'Mavena Kitchen',
      nameParts: ['Mavena', 'Kitchen'],
      orderCodePrefix: 'MK',
      email: 'hello@mavena.example',
    });
    expect('phone' in RESTAURANT).toBe(false);
    expect([hy.brand.name, ru.brand.name, en.brand.name]).toEqual([
      RESTAURANT.name,
      RESTAURANT.name,
      RESTAURANT.name,
    ]);
  });

  it('generates only MK public order codes', () => {
    expect(PUBLIC_CODE_PREFIX).toBe('MK');
    expect(PUBLIC_CODE_DIGITS).toBe(6);

    for (let index = 0; index < 25; index += 1) {
      expect(generatePublicCode()).toMatch(/^MK-\d{6}$/);
    }
  });

  it('uses new browser identifiers without weakening checkout migration safety', () => {
    expect(BROWSER_STORAGE_KEYS).toEqual({
      cart: 'mavena-kitchen-cart',
      checkout: 'mavena-kitchen-checkout',
      demoAdmin: 'mavena-kitchen-demo-admin',
      adminSession: 'mk_admin_session',
    });
    expect(CHECKOUT_DRAFT_VERSION).toBe(2);
  });
});
