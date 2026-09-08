import { describe, expect, it } from 'vitest';

import { ORDER_STATUSES, canTransition } from '@/lib/domain';
import {
  allowedTransitions,
  isTerminal,
  statusStepIndex,
  statusSteps,
} from '@/lib/order-types';
import { demoEventsFor, demoStatusOf, type DemoChanges } from '@/lib/demo-admin-state';

describe('statusSteps', () => {
  it('routes a pickup order around DELIVERING', () => {
    // Nobody is driving anywhere; showing the step greyed out would promise a
    // delivery the customer did not ask for.
    expect(statusSteps('PICKUP')).not.toContain('DELIVERING');
    expect(statusSteps('DELIVERY')).toContain('DELIVERING');
  });

  it('never puts CANCELLED on the progress bar', () => {
    expect(statusSteps('DELIVERY')).not.toContain('CANCELLED');
    expect(statusSteps('PICKUP')).not.toContain('CANCELLED');
  });

  it('ends at COMPLETED for both order types', () => {
    expect(statusSteps('DELIVERY').at(-1)).toBe('COMPLETED');
    expect(statusSteps('PICKUP').at(-1)).toBe('COMPLETED');
  });
});

describe('statusStepIndex', () => {
  it('advances along the bar', () => {
    expect(statusStepIndex('NEW', 'DELIVERY')).toBe(0);
    expect(statusStepIndex('PREPARING', 'DELIVERY')).toBe(2);
    expect(statusStepIndex('COMPLETED', 'DELIVERY')).toBe(5);
  });

  it('takes a cancelled order off the bar entirely', () => {
    // Not "stuck at step 3": a progress bar showing progress would say the
    // order is still on its way.
    expect(statusStepIndex('CANCELLED', 'DELIVERY')).toBe(-1);
  });

  it('does not place DELIVERING on a pickup bar', () => {
    expect(statusStepIndex('DELIVERING', 'PICKUP')).toBe(-1);
    expect(statusStepIndex('COMPLETED', 'PICKUP')).toBe(4);
  });
});

describe('allowedTransitions', () => {
  it('offers exactly what the domain permits, for every status', () => {
    // The panel draws its buttons from this. If it ever disagreed with
    // `canTransition`, staff would be offered moves the server rejects.
    for (const from of ORDER_STATUSES) {
      for (const to of ORDER_STATUSES) {
        expect(allowedTransitions(from).includes(to)).toBe(canTransition(from, to));
      }
    }
  });

  it('leaves the terminal states with nowhere to go', () => {
    expect(allowedTransitions('COMPLETED')).toHaveLength(0);
    expect(allowedTransitions('CANCELLED')).toHaveLength(0);
    expect(isTerminal('COMPLETED')).toBe(true);
    expect(isTerminal('CANCELLED')).toBe(true);
    expect(isTerminal('READY')).toBe(false);
  });
});

describe('demo admin overlay', () => {
  const base = [
    {
      id: 'e1',
      fromStatus: null,
      toStatus: 'NEW' as const,
      source: 'CUSTOMER',
      note: null,
      createdAt: '2026-08-08T09:00:00.000Z',
    },
  ];

  it('shows the original status until the session changes it', () => {
    expect(demoStatusOf({}, 'order-1', 'NEW')).toBe('NEW');
  });

  it('shows the latest change, not the first', () => {
    const changes: DemoChanges = {
      'order-1': [
        { status: 'CONFIRMED', at: '2026-08-08T09:01:00.000Z', note: null },
        { status: 'PREPARING', at: '2026-08-08T09:02:00.000Z', note: null },
      ],
    };

    expect(demoStatusOf(changes, 'order-1', 'NEW')).toBe('PREPARING');
    // An untouched order is unaffected by another one's changes.
    expect(demoStatusOf(changes, 'order-2', 'READY')).toBe('READY');
  });

  it('chains the history so each line says what it moved from', () => {
    const changes: DemoChanges = {
      'order-1': [
        { status: 'CONFIRMED', at: '2026-08-08T09:01:00.000Z', note: null },
        { status: 'PREPARING', at: '2026-08-08T09:02:00.000Z', note: 'жарим' },
      ],
    };

    const events = demoEventsFor(changes, 'order-1', base);

    expect(events).toHaveLength(3);
    expect(events[1]).toMatchObject({ fromStatus: 'NEW', toStatus: 'CONFIRMED' });
    expect(events[2]).toMatchObject({ fromStatus: 'CONFIRMED', toStatus: 'PREPARING', note: 'жарим' });
  });

  it('leaves the original trail alone when nothing was changed', () => {
    expect(demoEventsFor({}, 'order-1', base)).toEqual(base);
  });
});
