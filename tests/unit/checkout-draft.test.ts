import { describe, expect, it } from 'vitest';

import { CITY_CODES } from '@/lib/domain';
import { migrateCheckoutDraft } from '@/stores/checkout-draft';

/**
 * What happens to a draft left in a browser by an older version of this app.
 *
 * This runs exactly once per returning visitor, on their first load after a
 * deployment, and never again — which makes it the hardest path in the app to
 * reproduce by hand and the easiest to get wrong unnoticed. The visitor whose
 * draft names a city that has been removed does not report a bug; they see a
 * checkout that cannot quote a delivery and they leave.
 */

const CITY = CITY_CODES[0];

/** A complete draft as the store would have persisted it. */
function draft(overrides: Record<string, unknown> = {}) {
  return {
    type: 'DELIVERY',
    customerName: 'Անի Հակոբյան',
    phone: '+37493123456',
    cityCode: CITY,
    address: 'Bagramyan 21',
    landmark: 'Opposite the pharmacy',
    lat: 40.1834,
    lng: 44.5119,
    paymentMethod: 'CASH',
    ...overrides,
  };
}

describe('migrateCheckoutDraft', () => {
  it('leaves a draft naming a city we still serve exactly as it is', () => {
    const stored = draft();

    expect(migrateCheckoutDraft(stored)).toEqual(stored);
  });

  it('keeps a draft that never got as far as choosing a city', () => {
    const stored = draft({ cityCode: null, address: '', landmark: '', lat: null, lng: null });

    expect(migrateCheckoutDraft(stored)).toEqual(stored);
  });

  it('drops the geography of a draft naming a city we no longer serve', () => {
    const migrated = migrateCheckoutDraft(draft({ cityCode: 'RETIRED_CITY' }));

    expect(migrated.cityCode).toBeNull();
    expect(migrated.address).toBe('');
    expect(migrated.landmark).toBe('');
    expect(migrated.lat).toBeNull();
    expect(migrated.lng).toBeNull();
  });

  it('keeps the person: the name, the phone and how they paid last time', () => {
    const migrated = migrateCheckoutDraft(
      draft({ cityCode: 'DISCONTINUED_CITY', paymentMethod: 'ONLINE' }),
    );

    expect(migrated.customerName).toBe('Անի Հակոբյան');
    expect(migrated.phone).toBe('+37493123456');
    expect(migrated.paymentMethod).toBe('ONLINE');
    expect(migrated.type).toBe('DELIVERY');
  });

  it('drops the pin along with the city, not one without the other', () => {
    // A pin kept on its own would sit in another province with nothing on screen
    // to explain it, and the map would open somewhere the customer never chose.
    const migrated = migrateCheckoutDraft(draft({ cityCode: 'RETIRED_CITY' }));

    expect(migrated.lat).toBeNull();
    expect(migrated.lng).toBeNull();
  });

  it('survives storage holding something that is not a draft at all', () => {
    expect(migrateCheckoutDraft(null)).toEqual({});
    expect(migrateCheckoutDraft(undefined)).toEqual({});
    expect(migrateCheckoutDraft('corrupted')).toEqual({});
    expect(migrateCheckoutDraft(42)).toEqual({});
  });

  it('does not invent a city for a draft that has no cityCode key', () => {
    const migrated = migrateCheckoutDraft({ customerName: 'Old', phone: '+37493123456' });

    expect(migrated.customerName).toBe('Old');
    expect(migrated.cityCode).toBeUndefined();
  });
});
