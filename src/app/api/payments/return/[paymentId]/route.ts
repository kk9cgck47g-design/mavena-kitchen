import { NextResponse } from 'next/server';

import { IS_DEMO } from '@/lib/demo';
import { localeUrl } from '@/lib/site-url';
import { clientIp } from '@/server/http/client-ip';
import { confirmPayment, orderForPayment, paymentLocale } from '@/server/services/payments';
import { consumeRateLimit, LIMITS, rateLimitKey } from '@/server/services/rate-limit';

/**
 * Where the provider drops the customer when it is finished with them.
 *
 * The most misunderstood URL in a payment integration, so: **this is not how we
 * learn that somebody paid.** It is a browser navigation. The customer can
 * refresh it, bookmark it, share it, arrive at it having paid nothing, or never
 * arrive at all — none of which says anything about money. All it does is tell us
 * which attempt is worth asking the provider about, and `confirmPayment` does the
 * asking.
 *
 * That is also why there is one URL rather than a success one and a failure one.
 * Sending customers to `/paid` and `/failed` invites the code behind them to
 * believe the path they arrived on, and the path is chosen by whoever is
 * navigating.
 *
 * Nothing here is authorised by the URL either. The payment id names a row; it
 * grants nothing. What comes back is a redirect to the order's tracking page,
 * whose token is the actual credential, read from the order rather than from the
 * request.
 */

/** Reads a route param and writes to the database. Never prerendered. */
export const dynamic = 'force-dynamic';

export async function GET(
  request: Request,
  // Typed inline rather than through Next's generated `RouteContext` helper,
  // which only exists after `next typegen` has run — and `pnpm typecheck` is a
  // bare `tsc`. Same shape, and the same way pages in this codebase type params.
  context: { params: Promise<{ paymentId: string }> },
): Promise<Response> {
  // The preview takes no payments, so it has no returns to handle.
  if (IS_DEMO) return NextResponse.json({ ok: false }, { status: 404 });

  const { paymentId } = await context.params;
  const locale = paymentLocale(new URL(request.url).searchParams.get('lang'));

  /*
    A public GET that makes us call somebody else's gateway, so it is worth a
    limit — but the customer arriving here has just paid, and a bare error is the
    wrong thing to show them.

    So what is rationed is the call to the provider, not the trip home: over the
    limit, they still land on their own order, and the reconciliation is left to
    the sweep, which asks about every pending attempt anyway. Nothing is lost but
    a few seconds.
  */
  const verdict = await consumeRateLimit(
    rateLimitKey('return:ip', await clientIp()),
    LIMITS.paymentReturnsByIp,
  );

  if (!verdict.allowed) {
    const order = await orderForPayment(paymentId);
    return NextResponse.redirect(
      order ? localeUrl(locale, `/order/${order.trackingToken}`) : localeUrl(locale, '/'),
    );
  }

  const outcome = await confirmPayment(paymentId);

  /*
    Nothing recognisable to come back to.

    Home rather than a 404 page: whoever is here is a person holding a link that
    does not resolve, and the useful thing to give them is the site. A 404 would
    also confirm to anyone probing ids which ones exist, and this endpoint should
    answer the same way whatever it is handed.
  */
  if (outcome.code === 'NOT_FOUND' || outcome.code === 'NO_PROVIDER') {
    return NextResponse.redirect(localeUrl(locale, '/'));
  }

  const tracking = localeUrl(locale, `/order/${outcome.trackingToken}`);

  /*
    A declined attempt is passed on as a query parameter, and it is presentation
    only: the tracking page renders "that did not go through, try again" instead
    of leaving the customer to infer it from an unchanged screen. The page does
    not trust it for anything — the order's own state decides what may be done
    next, and someone appending `?payment=failed` by hand changes a sentence and
    nothing else.
  */
  if (outcome.code === 'FAILED') {
    return NextResponse.redirect(`${tracking}?payment=failed`);
  }

  /*
    Money we should not be holding — it arrived after we cancelled the order, or
    for an amount we did not ask for. The customer is told to expect a call
    rather than left with a paid-looking page for an order nobody is cooking;
    `paymentPresentation` derives the same thing from the order for anyone who
    comes back later without the parameter.
  */
  if (outcome.code === 'NEEDS_REFUND') {
    return NextResponse.redirect(`${tracking}?payment=refund`);
  }

  // `PAID`, `ALREADY_PAID` and `PENDING` all land on the page itself, which
  // reads the order and says what is true of it. A refresh of a return that
  // already succeeded is therefore just another arrival here — the second visit
  // changes nothing and shows the same paid order.
  return NextResponse.redirect(tracking);
}
