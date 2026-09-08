'use server';

import { IS_DEMO } from '@/lib/demo';
import { configuredProvider } from '@/server/payments/registry';
import { decideStubSession } from '@/server/payments/stub';

/**
 * Pressing a button on the fake payment page.
 *
 * This action is the stub gateway's own server, not ours. It writes to
 * `stub_payments` and touches nothing else — no order, no payment row, no
 * notification. That separation is the whole point of the stub: the outcome
 * becomes true at the provider, and our side of the system finds out the way it
 * will find out from a real bank, by asking.
 *
 * Two guards, and both are refusals rather than checks the UI could skip. The
 * page is a test fixture, and a fixture reachable on a deployment that takes real
 * payments would be a URL for deciding real orders.
 */

export type DecideStubResponse =
  | { ok: true; returnUrl: string }
  | { ok: false; code: 'UNAVAILABLE' | 'NOT_FOUND' };

export async function decideStubPayment(
  reference: unknown,
  outcome: unknown,
): Promise<DecideStubResponse> {
  // The preview has no database for the stub to write to, and its payment flow is
  // entirely in the browser's own session. Nothing server-side to do.
  if (IS_DEMO) return { ok: false, code: 'UNAVAILABLE' };

  // Only while the stub is the configured provider. With a real acquirer in place
  // this endpoint answers nothing, whatever it is sent.
  if (configuredProvider()?.name !== 'stub') return { ok: false, code: 'UNAVAILABLE' };

  if (typeof reference !== 'string' || reference.length === 0 || reference.length > 200) {
    return { ok: false, code: 'NOT_FOUND' };
  }

  if (outcome !== 'PAID' && outcome !== 'FAILED') return { ok: false, code: 'UNAVAILABLE' };

  const session = await decideStubSession(reference, outcome);
  if (!session) return { ok: false, code: 'NOT_FOUND' };

  /*
    The customer is sent back to the merchant's return URL — the one handed over
    when the session was created — exactly as a real gateway would. The decision
    itself is not passed along: the return URL learns which attempt to ask about,
    and asks.
  */
  return { ok: true, returnUrl: session.returnUrl };
}
