import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';

import { assertAmd, type Amd } from '@/lib/money';
import { localeUrl } from '@/lib/site-url';
import { db } from '@/server/db/client';
import { stubPayments } from '@/server/db/schema';
import type {
  PaymentOutcome,
  PaymentProvider,
  PaymentSession,
  PaymentSessionRequest,
} from './provider';

/**
 * A payment provider that takes no money.
 *
 * It stands in for the acquirer nobody has signed with yet, and it is not a
 * placeholder in the sense of being unfinished: it implements the full redirect
 * flow, including the parts that only matter when something goes wrong. A
 * customer is sent to a page on a URL of the provider's choosing, decides there,
 * and is sent back; the outcome is discoverable afterwards by asking, and is
 * discoverable whether or not the customer ever came back. That is exactly the
 * shape of a real hosted-page gateway, which is why swapping one in is a new file
 * in this directory rather than a change to anything that uses it.
 *
 * It keeps its records in `stub_payments`, which belongs to it alone and stands
 * in for the bank's own database. Nothing outside this file may read that table:
 * the moment the payment core reads a provider's storage instead of asking a
 * provider a question, the abstraction is decorative.
 *
 * What it deliberately does not simulate: cards. The fake page has no card
 * field, because a fake card field is a real place for somebody to type a real
 * card number — into our logs, our error reports and our database. The decision
 * it offers is "paid" or "declined", which is all the flow behind it can react
 * to anyway.
 */

export const stubPaymentProvider: PaymentProvider = {
  name: 'stub',

  async createSession(request: PaymentSessionRequest): Promise<PaymentSession> {
    assertAmd(request.amount, 'payment amount');

    // Opaque and unguessable, like a real gateway reference — and it ends up in
    // a URL the customer opens, so it must not be a number somebody can count.
    const externalId = `stub_${randomUUID()}`;

    await db.insert(stubPayments).values({
      externalId,
      amount: request.amount,
      state: 'PENDING',
      label: request.publicCode,
      returnUrl: request.returnUrl,
    });

    return {
      externalId,
      // The pretend gateway's own page. Not under `/api`, because a customer
      // looks at it — and locale-prefixed, because they were reading the site in
      // some language a moment ago.
      redirectUrl: localeUrl(request.locale, `/pay/${externalId}`),
      raw: { provider: 'stub', reference: request.reference, amount: request.amount },
    };
  },

  async fetchStatus(externalId: string): Promise<PaymentOutcome> {
    const [row] = await db
      .select()
      .from(stubPayments)
      .where(eq(stubPayments.externalId, externalId))
      .limit(1);

    // A reference the provider has never heard of. Distinct from "not yet", and
    // treated as such by the caller: asking again will not help.
    if (!row) return { state: 'UNKNOWN' };

    if (row.state === 'PAID') {
      return {
        state: 'PAID',
        amount: row.amount,
        raw: { provider: 'stub', externalId, decidedAt: row.decidedAt?.toISOString() ?? null },
      };
    }

    if (row.state === 'FAILED') {
      return {
        state: 'FAILED',
        reason: 'Declined on the stub payment page',
        raw: { provider: 'stub', externalId, decidedAt: row.decidedAt?.toISOString() ?? null },
      };
    }

    return { state: 'PENDING' };
  },
};

// --- The fake gateway's own side of the page -------------------------------
//
// Everything below is what a bank's server would do and is not part of the
// payment core. It is exported for the stub page and for tests, and is the only
// code in the codebase that may touch `stub_payments`.

export interface StubSessionView {
  externalId: string;
  amount: Amd;
  label: string | null;
  state: string;
  returnUrl: string;
}

export async function getStubSession(externalId: string): Promise<StubSessionView | null> {
  const [row] = await db
    .select()
    .from(stubPayments)
    .where(eq(stubPayments.externalId, externalId))
    .limit(1);

  if (!row) return null;

  return {
    externalId: row.externalId,
    amount: row.amount,
    label: row.label,
    state: row.state,
    returnUrl: row.returnUrl,
  };
}

/**
 * Press a button on the fake page.
 *
 * Only a `PENDING` session may be decided, and the guard is `where state =
 * 'PENDING'` rather than a read followed by a write: two taps on "pay" a
 * heartbeat apart must not produce two decisions, for the same reason a real
 * gateway will not let you pay the same session twice. The second one finds
 * nothing to update and is told where the first one already went.
 */
export async function decideStubSession(
  externalId: string,
  outcome: 'PAID' | 'FAILED',
): Promise<StubSessionView | null> {
  const [updated] = await db
    .update(stubPayments)
    .set({ state: outcome, decidedAt: new Date() })
    .where(and(eq(stubPayments.externalId, externalId), eq(stubPayments.state, 'PENDING')))
    .returning();

  if (updated) {
    return {
      externalId: updated.externalId,
      amount: updated.amount,
      label: updated.label,
      state: updated.state,
      returnUrl: updated.returnUrl,
    };
  }

  // Already decided, or never existed. Either way the caller wants to know where
  // to send the customer, which is what it would have wanted on success too.
  return getStubSession(externalId);
}
