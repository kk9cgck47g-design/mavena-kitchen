import createMiddleware from 'next-intl/middleware';

import { routing } from '@/i18n/routing';

/**
 * Locale negotiation. (Next 16 renamed this convention from `middleware` to `proxy`.)
 */
export default createMiddleware(routing);

export const config = {
  /**
   * Everything except Next internals, the API and static assets.
   *
   * `/admin` is excluded on purpose: the dashboard is staff-only and single
   * language, so putting it behind locale negotiation would only add a redirect
   * to every kitchen tap.
   */
  matcher: ['/((?!api|admin|_next|_vercel|.*\\..*).*)'],
};
