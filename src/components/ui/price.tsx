'use client';

import { useLocale } from 'next-intl';

import { isLocale, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import { cn } from '@/lib/utils';

/**
 * Renders an amount in drams.
 *
 * Always goes through `formatAmd`, so grouping and the ֏ sign follow each
 * locale's own rules — Armenian correctly does not separate four-digit numbers,
 * where Russian and English do.
 *
 * `tabular-nums` matters more than it looks: without it, digits have different
 * widths and a column of prices in a cart visibly jitters as quantities change.
 */
export function Price({
  amount,
  className,
  prefix,
}: {
  amount: number;
  className?: string;
  /** e.g. "+" for an option's price delta. */
  prefix?: string;
}) {
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  return (
    <span className={cn('tabular-nums whitespace-nowrap', className)}>
      {prefix}
      {formatAmd(amount, locale)}
    </span>
  );
}

/** Non-hook version for server components, where the locale is already known. */
export function formatPrice(amount: number, locale: Locale): string {
  return formatAmd(amount, locale);
}
