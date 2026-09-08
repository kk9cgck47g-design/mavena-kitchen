import type { Instrumentation } from 'next';

/**
 * Somewhere for a server error to go other than nowhere.
 *
 * Until now a failure in a Server Action or a route handler produced a stack
 * trace in a log nobody reads, which for the paths that matter here is the same
 * as silence. The two that matter most are the payment sweep and the Telegram
 * dispatch: both run unattended, both fail quietly by design — a kitchen that
 * cannot be reached must not fail a customer's order — and neither has anybody
 * watching. "The tickets stopped arriving on Tuesday" is a thing an owner should
 * not be the one to discover.
 *
 * This deliberately reports to a log rather than to a service. Sending errors
 * anywhere costs a DSN, which is the owner's secret to hold and not something to
 * invent here — so what this does is make the log worth reading and leave one
 * obvious place to plug a reporter in. On Vercel these lines are searchable and
 * can be drained to whatever gets chosen later; `reportServerError` is the seam.
 *
 * What is not logged is as deliberate as what is. Headers carry the session
 * cookie and the customer's address bar carries tracking tokens, and an error
 * report is a place things end up being kept for a long time. Only the route, the
 * kind of request and the error itself go in.
 */

export const onRequestError: Instrumentation.onRequestError = (error, request, context) => {
  const message = error instanceof Error ? error.message : String(error);

  /*
    React replaces the error it shows the client with a digest when a Server
    Component throws, so the digest is what ties a customer saying "it said
    something went wrong" to the line in the log that explains it.
  */
  const digest =
    typeof error === 'object' && error !== null && 'digest' in error
      ? String((error as { digest: unknown }).digest)
      : undefined;

  reportServerError({
    message,
    digest,
    stack: error instanceof Error ? error.stack : undefined,
    // The route file, not the URL the customer was on: a tracking token in a
    // path is a credential, and this is exactly the kind of place it would
    // outlive its order.
    route: context.routePath,
    kind: context.routeType,
    method: request.method,
  });
};

export interface ServerErrorReport {
  message: string;
  digest?: string;
  stack?: string;
  route: string;
  kind: string;
  method: string;
}

/**
 * One line, structured, on stderr.
 *
 * JSON rather than prose because the first thing anybody does with these is
 * search them, and the second thing is count them. Replace the body of this
 * function to send them somewhere — it is called for every server error and for
 * nothing else.
 */
export function reportServerError(report: ServerErrorReport): void {
  console.error(`[error] ${JSON.stringify(report)}`);
}
