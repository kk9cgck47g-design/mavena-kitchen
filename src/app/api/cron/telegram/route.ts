import { NextResponse } from 'next/server';

import { IS_DEMO } from '@/lib/demo';
import { env } from '@/lib/env';
import { secretsMatch } from '@/server/telegram/config';
import { dispatchPending } from '@/server/telegram/dispatch';

/**
 * The unattended half of redelivery.
 *
 * The outbox has always been able to be retried; the only thing that does so
 * today is a person pressing a button in the panel, which is fine for a failure
 * somebody noticed and useless for the one nobody did. This is the sweep: it
 * asks whether anything is still owed to the kitchen and sends it.
 *
 * Nothing calls it on a schedule yet, and that is a deployment decision rather
 * than an unfinished one. Vercel's Hobby plan allows a cron job once a day,
 * which for a kitchen notification arrives roughly a day too late, and the
 * project is not moving to Pro for this alone. The endpoint is complete: point
 * a Vercel cron or any external scheduler at it with the header below and it
 * starts working with no code change. See the Telegram section of README.md.
 *
 * It adds no retry logic of its own — that would be a second policy to keep in
 * step with the first. It calls `dispatchPending`, which is the same function
 * the panel's button reaches, and every rule about what may be retried, how
 * many times, and to which chats stays in one place.
 *
 * Idempotence comes from the same place it always has: a `SENT` row is never
 * selected, and a partially delivered one records which chats already have the
 * message, so a sweep that runs while a previous one is still finishing cannot
 * send anybody a second copy of anything.
 */

/** Never statically evaluated: it reads a header and writes to the world. */
export const dynamic = 'force-dynamic';

/**
 * How many messages one run may send.
 *
 * A backlog is worked through oldest first over successive runs rather than in
 * one long invocation. Serverless functions have a wall-clock limit, and a
 * sweep that tried to drain a hundred queued messages would be killed halfway
 * with no record of where it got to — whereas a bounded run either finishes or
 * leaves everything it did not reach exactly as it found it.
 */
const BATCH_LIMIT = 25;

export async function GET(request: Request): Promise<Response> {
  // The preview has no database, no bot and nothing to sweep.
  if (IS_DEMO) return NextResponse.json({ ok: false }, { status: 404 });

  const secret = env.CRON_SECRET;

  // No secret configured means closed, not open. A 404 rather than a 401, so a
  // scanner is not told there is something here worth getting authorised for.
  if (!secret) return NextResponse.json({ ok: false }, { status: 404 });

  // Vercel Cron sends exactly this header, built from `CRON_SECRET`.
  const presented = request.headers.get('authorization') ?? '';
  const expected = `Bearer ${secret}`;

  if (!secretsMatch(presented, expected)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  try {
    const outcome = await dispatchPending(BATCH_LIMIT);
    return NextResponse.json({ ok: true, ...outcome });
  } catch (error) {
    // A failed sweep is not an emergency: everything it did not send is still
    // PENDING and the next run will find it. Reported as 500 so that a run
    // failing repeatedly is visible in Vercel's cron log rather than silent.
    console.error('[cron] telegram sweep failed', error);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
