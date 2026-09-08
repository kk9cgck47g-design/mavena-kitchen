import { NextResponse } from 'next/server';

import { IS_DEMO } from '@/lib/demo';
import { env } from '@/lib/env';
import { configuredProvider } from '@/server/payments/registry';
import { sweepPayments } from '@/server/services/payments';
import { pruneRateLimits } from '@/server/services/rate-limit';
import { secretsMatch } from '@/server/telegram/config';

/**
 * The sweep, on somebody else's schedule.
 *
 * Unlike the Telegram retry next door, this one is not optional. That endpoint
 * covers a kitchen that did not get a message, which a person notices and can
 * re-send by hand. This one covers a customer who paid and closed the tab — and
 * nobody notices that, because from the outside it looks exactly like a customer
 * who did not pay. The order gets cancelled, the money stays taken, and the first
 * anyone hears of it is a phone call.
 *
 * So: online payment should not be switched on for real without something calling
 * this every few minutes. `README.md` lists the options; none of them needs a code
 * change. The endpoint is safe to call as often as a scheduler likes — see
 * `sweepPayments`, where every step is conditional on the state it re-reads under
 * a lock.
 *
 * Guarded exactly like the Telegram sweep: `CRON_SECRET`, compared in constant
 * time, and a 404 when the variable is absent so the endpoint is closed rather
 * than open on a deployment that never configured one.
 */

/** Reads a header and moves money's paperwork. Never statically evaluated. */
export const dynamic = 'force-dynamic';

/**
 * How many attempts one run may ask about, and how many orders it may expire.
 *
 * Bounded for the same reason the Telegram sweep is: a serverless function has a
 * wall-clock limit, and each attempt here costs a round trip to somebody else's
 * server. A backlog is worked through oldest-first over successive runs, and a
 * run that is killed halfway leaves everything it did not reach exactly as it
 * found it.
 */
const BATCH_LIMIT = 25;

export async function GET(request: Request): Promise<Response> {
  if (IS_DEMO) return NextResponse.json({ ok: false }, { status: 404 });

  const secret = env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false }, { status: 404 });

  const presented = request.headers.get('authorization') ?? '';
  if (!secretsMatch(presented, `Bearer ${secret}`)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  // Authorised, but there is no provider to ask. Reported as a success with
  // nothing done rather than an error: a deployment that takes no online payments
  // has an empty sweep, and a scheduler pointed at it should not be logging
  // failures every five minutes.
  if (!configuredProvider()) {
    return NextResponse.json({ ok: true, skipped: 'no provider configured' });
  }

  try {
    /*
      Housekeeping, on the one job that already runs on a schedule. Rate-limit
      rows are keyed rather than appended, so the table grows with the number of
      distinct actors ever seen and not with traffic — this keeps it tidy rather
      than keeping it from exploding.
    */
    await pruneRateLimits();

    const outcome = await sweepPayments(BATCH_LIMIT);

    // `needsRefund` is the number worth an alert. Everything else in this
    // response is routine; that one means the restaurant is holding money it is
    // not entitled to, and it will sit there until a person acts.
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    console.error('[cron] payment sweep failed', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
