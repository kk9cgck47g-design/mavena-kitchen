import { NextResponse } from 'next/server';

import { IS_DEMO } from '@/lib/demo';
import { secretsMatch, webhookSecret } from '@/server/telegram/config';
import { handleTelegramUpdate, type TelegramUpdate } from '@/server/telegram/webhook';

/**
 * Telegram's webhook.
 *
 * The one URL in this application that a third party posts to unprompted, so
 * the order of the checks matters more than usual:
 *
 *   1. Demo refuses outright. The preview has no database and no bot; an
 *      endpoint that accepted updates there would be accepting them from
 *      anybody.
 *   2. No secret configured means the webhook is closed, not open. Telegram
 *      only sends the header if `setWebhook` was given a `secret_token`, so a
 *      deployment that never configured one has nothing to verify against and
 *      must not fall back to trusting the caller.
 *   3. The header is compared in constant time.
 *
 * Everything after that is `handleTelegramUpdate`, which decides nothing about
 * status itself — it calls the same `updateOrderStatus` the panel does.
 *
 * The reply is always 200 once the secret checks out. Telegram retries any
 * other status, and a redelivery loop caused by a transient database error
 * would keep re-pressing a button nobody pressed twice.
 */

export async function POST(request: Request): Promise<Response> {
  if (IS_DEMO) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const secret = webhookSecret();
  if (!secret) {
    // Deliberately a 404: an endpoint that answers "unauthorised" tells a
    // scanner that there is something here to get authorised for.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const presented = request.headers.get('x-telegram-bot-api-secret-token');
  if (!presented || !secretsMatch(presented, secret)) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  let update: TelegramUpdate;
  try {
    update = (await request.json()) as TelegramUpdate;
  } catch {
    return NextResponse.json({ ok: true });
  }

  try {
    const outcome = await handleTelegramUpdate(update);
    return NextResponse.json({ ok: true, outcome });
  } catch (error) {
    // Swallowed on purpose. See the note above about redelivery loops; the
    // detail belongs in the log, where somebody can act on it.
    console.error('[telegram] webhook failed', error);
    return NextResponse.json({ ok: true });
  }
}
