import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';

import { RESTAURANT_TIME_ZONE } from '@/lib/domain';
import { INTL_TAGS } from '@/lib/i18n/locales';
import { routing } from './routing';

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: (await import(`../messages/${locale}.json`)).default,
    // Dates in the UI mean restaurant-local time — an ETA of 19:40 is 19:40 in
    // the restaurant's own city, whatever the visitor's device thinks.
    timeZone: RESTAURANT_TIME_ZONE,
    formats: {
      number: {
        amd: {
          style: 'currency',
          currency: 'AMD',
          currencyDisplay: 'narrowSymbol',
          maximumFractionDigits: 0,
          minimumFractionDigits: 0,
        },
      },
    },
    // Keeps `Intl` output consistent with `formatAmd` in `src/lib/money.ts`.
    now: new Date(),
    onError(error) {
      if (process.env.NODE_ENV === 'development') console.warn(error);
    },
    getMessageFallback({ key }) {
      return process.env.NODE_ENV === 'development' ? `[${INTL_TAGS[locale]}:${key}]` : '';
    },
  };
});
