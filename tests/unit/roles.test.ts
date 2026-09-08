import { describe, expect, it } from 'vitest';

import { ADMIN_ROLES, satisfiesRole, type AdminRole } from '@/lib/domain';

/**
 * Who may do what.
 *
 * Small enough to enumerate exhaustively, and worth enumerating: the difference
 * between the two roles is the difference between working a shift and changing
 * what the business charges, and a rank comparison that quietly inverted would
 * hand every manager the price list.
 */

describe('role ranking', () => {
  it('lets an owner do everything a manager can', () => {
    expect(satisfiesRole('OWNER', 'MANAGER')).toBe(true);
    expect(satisfiesRole('OWNER', 'OWNER')).toBe(true);
  });

  it('keeps a manager out of what is the owner’s', () => {
    expect(satisfiesRole('MANAGER', 'MANAGER')).toBe(true);
    expect(satisfiesRole('MANAGER', 'OWNER')).toBe(false);
  });

  it('lets every role satisfy itself, and no lower role satisfy a higher one', () => {
    // Exhaustive over the enum, so adding a third role fails here rather than
    // silently inheriting whatever the comparison happens to do with it.
    const expected: Record<AdminRole, AdminRole[]> = {
      OWNER: ['OWNER', 'MANAGER'],
      MANAGER: ['MANAGER'],
    };

    for (const actual of ADMIN_ROLES) {
      for (const required of ADMIN_ROLES) {
        expect({ actual, required, allowed: satisfiesRole(actual, required) }).toEqual({
          actual,
          required,
          allowed: expected[actual].includes(required),
        });
      }
    }
  });
});
