import { describe, expect, it } from 'vitest';

import {
  canTransition,
  isKitchenVisible,
  isPaid,
  isSettled,
  ORDER_STATUSES,
  ORDER_STATUS_TRANSITIONS,
  PAYMENT_ATTEMPT_MINUTES,
  PAYMENT_STATUSES,
  PAYMENT_WINDOW_MINUTES,
  type OrderStatus,
} from '@/lib/domain';
import { demoPaymentReference, demoTokenFromReference } from '@/lib/demo';
import { paymentPresentation, statusStepIndex, statusSteps } from '@/lib/order-types';
import {
  availablePaymentMethods,
  DEFAULT_PAYMENT_METHOD,
  OFFLINE_PAYMENT_METHODS,
} from '@/lib/schemas/checkout';
import { enabledPaymentMethod } from '@/stores/checkout-draft';

/**
 * The rules an online order lives by, tested without a database or a provider.
 *
 * Everything here is a pure function, and everything here is a rule that would
 * cost money to get wrong: which statuses may follow which, whether an unpaid
 * order can reach the kitchen, and what the customer is told at each point.
 */

describe('the AWAITING_PAYMENT status', () => {
  it('has exactly two ways out, and no way back in', () => {
    expect(ORDER_STATUS_TRANSITIONS.AWAITING_PAYMENT).toEqual(['NEW', 'CANCELLED']);

    // The important half. A paid order that could be pushed back into "awaiting
    // payment" is an order that could be charged a second time.
    for (const from of ORDER_STATUSES) {
      expect(canTransition(from, 'AWAITING_PAYMENT')).toBe(false);
    }
  });

  it('cannot jump straight into the kitchen or past it', () => {
    expect(canTransition('AWAITING_PAYMENT', 'NEW')).toBe(true);
    expect(canTransition('AWAITING_PAYMENT', 'CANCELLED')).toBe(true);

    expect(canTransition('AWAITING_PAYMENT', 'CONFIRMED')).toBe(false);
    expect(canTransition('AWAITING_PAYMENT', 'PREPARING')).toBe(false);
    expect(canTransition('AWAITING_PAYMENT', 'COMPLETED')).toBe(false);
  });

  it('is the one status the kitchen is not responsible for', () => {
    expect(isKitchenVisible('AWAITING_PAYMENT')).toBe(false);

    for (const status of ORDER_STATUSES.filter((s) => s !== 'AWAITING_PAYMENT')) {
      expect(isKitchenVisible(status)).toBe(true);
    }
  });

  it('is not a step on the progress bar the customer sees', () => {
    for (const type of ['DELIVERY', 'PICKUP'] as const) {
      expect(statusSteps(type)).not.toContain('AWAITING_PAYMENT');

      // `-1`, like a cancelled order: it has not joined the track. Drawing it as
      // step one would tell the customer their food was underway.
      expect(statusStepIndex('AWAITING_PAYMENT', type)).toBe(-1);
      expect(statusStepIndex('NEW', type)).toBe(0);
    }
  });
});

describe('payment statuses', () => {
  it('treats only PAID as money received', () => {
    expect(isPaid('PAID')).toBe(true);

    for (const status of PAYMENT_STATUSES.filter((s) => s !== 'PAID')) {
      expect(isPaid(status)).toBe(false);
    }
  });

  it('treats everything except PENDING as an answer', () => {
    expect(isSettled('PENDING')).toBe(false);

    for (const status of PAYMENT_STATUSES.filter((s) => s !== 'PENDING')) {
      expect(isSettled(status)).toBe(true);
    }
  });

  it('keeps EXPIRED distinct from FAILED', () => {
    // Not cosmetic. `FAILED` is the provider refusing, which is final; `EXPIRED`
    // is us giving up, which money can still arrive after. Collapsing the two
    // would make a late payment indistinguishable from a declined one.
    expect(PAYMENT_STATUSES).toContain('EXPIRED');
    expect(PAYMENT_STATUSES).toContain('FAILED');
  });
});

describe('the payment window', () => {
  it('gives an attempt less time than the order it belongs to', () => {
    // Otherwise a first attempt that stalls uses up the whole window, and the
    // customer has no time left to start a second one inside the same order.
    expect(PAYMENT_ATTEMPT_MINUTES).toBeLessThan(PAYMENT_WINDOW_MINUTES);
    expect(PAYMENT_ATTEMPT_MINUTES).toBeGreaterThan(0);
  });
});

describe('what the customer is told about the money', () => {
  it('says nothing at all when there is nothing to pay online', () => {
    for (const method of OFFLINE_PAYMENT_METHODS) {
      expect(
        paymentPresentation({ paymentMethod: method, paymentStatus: 'PENDING', status: 'NEW' }),
      ).toBe('NOT_NEEDED');
    }
  });

  it('asks for payment only while the order is still waiting for it', () => {
    expect(
      paymentPresentation({
        paymentMethod: 'ONLINE',
        paymentStatus: 'PENDING',
        status: 'AWAITING_PAYMENT',
      }),
    ).toBe('AWAITING');
  });

  it('reports a declined attempt as still awaiting, because it is', () => {
    // A declined card leaves the order exactly where it was: unpaid, inside its
    // window, and retryable. The screen should ask again, not announce a failure
    // the customer can do nothing about.
    expect(
      paymentPresentation({
        paymentMethod: 'ONLINE',
        paymentStatus: 'PENDING',
        status: 'AWAITING_PAYMENT',
      }),
    ).toBe('AWAITING');
  });

  it('reports an unpaid cancelled order as expired', () => {
    expect(
      paymentPresentation({
        paymentMethod: 'ONLINE',
        paymentStatus: 'EXPIRED',
        status: 'CANCELLED',
      }),
    ).toBe('EXPIRED');
  });

  it('reports a paid order as paid, whatever the order is doing', () => {
    for (const status of ['NEW', 'PREPARING', 'COMPLETED'] as OrderStatus[]) {
      expect(paymentPresentation({ paymentMethod: 'ONLINE', paymentStatus: 'PAID', status })).toBe(
        'PAID',
      );
    }

  });

  it('does not tell somebody their cancelled order is on its way', () => {
    /*
      The late-payment case, and the reason `REFUND_DUE` exists as its own state.
      The money is real, so denying it would be a lie about the customer's bank
      statement — but the order is cancelled, so `PAID` would promise food that
      nobody is cooking. It is neither, and the screen says so.
    */
    expect(
      paymentPresentation({
        paymentMethod: 'ONLINE',
        paymentStatus: 'PAID',
        status: 'CANCELLED',
      }),
    ).toBe('REFUND_DUE');
  });
});

describe('which methods are on offer', () => {
  it('offers online payment only where a provider is configured', () => {
    expect(availablePaymentMethods(false)).not.toContain('ONLINE');
    expect(availablePaymentMethods(true)).toContain('ONLINE');
  });

  it('always offers the two that need no provider', () => {
    for (const enabled of [true, false]) {
      const methods = availablePaymentMethods(enabled);
      expect(methods).toContain('CASH');
      expect(methods).toContain('CARD_ON_DELIVERY');
    }
  });

  it('drops a remembered preference that is no longer available', () => {
    // A months-old draft saying `ONLINE`, read on a deployment that has since
    // switched online payment off. Trusting it would put a method on screen that
    // the server refuses.
    expect(enabledPaymentMethod('ONLINE', availablePaymentMethods(false))).toBe('CASH');
    expect(enabledPaymentMethod('ONLINE', availablePaymentMethods(true))).toBe('ONLINE');
    expect(enabledPaymentMethod('CASH', availablePaymentMethods(true))).toBe('CASH');
  });

  it('falls back to cash when nothing at all is on offer', () => {
    expect(enabledPaymentMethod('ONLINE', [])).toBe(DEFAULT_PAYMENT_METHOD);
    expect(DEFAULT_PAYMENT_METHOD).toBe('CASH');
  });
});

describe('demo payment references', () => {
  it('round-trips a tracking token', () => {
    const token = 'demo-6f9619ff-8b86-d011-b42d-00c04fc964ff';
    expect(demoTokenFromReference(demoPaymentReference(token))).toBe(token);
  });

  it('refuses anything that is not a demo reference', () => {
    // The prefix is what keeps a demo reference from ever being mistaken for a
    // real provider's, which is what would let the fake page act on a real order.
    expect(demoTokenFromReference('stub_6f9619ff-8b86-d011-b42d-00c04fc964ff')).toBeNull();
    expect(demoTokenFromReference('')).toBeNull();
  });
});
