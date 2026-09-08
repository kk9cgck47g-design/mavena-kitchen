'use client';

import { useLocale, useTranslations } from 'next-intl';
import { useTransition } from 'react';

import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALES, type Locale } from '@/lib/i18n/locales';
import { cn } from '@/lib/utils';

/** Shown in each language's own script, which is how people find their own. */
const LABELS: Record<Locale, string> = {
  hy: 'ՀԱՅ',
  ru: 'РУС',
  en: 'ENG',
};

/**
 * Three-way segmented control.
 *
 * A segmented control rather than a dropdown: with exactly three options, the
 * dropdown's extra tap buys nothing, and seeing your own language on screen is
 * faster to recognise than reading a menu label.
 */
export function LocaleSwitcher({ className }: { className?: string }) {
  const t = useTranslations('common');
  const current = useLocale() as Locale;
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function switchTo(locale: Locale) {
    if (locale === current) return;
    startTransition(() => {
      // `usePathname` from next-intl already returns the locale-stripped path
      // with dynamic segments filled in, so a dish slug or an order token
      // survives the switch instead of dumping the customer on the index.
      router.replace(pathname, { locale });
    });
  }

  return (
    <div
      className={cn(
        'bg-elevated inline-flex items-center rounded-full border border-white/8 p-0.5',
        pending && 'opacity-60',
        className,
      )}
      role="group"
      aria-label={t('language')}
    >
      {LOCALES.map((locale) => {
        const isCurrent = locale === current;

        return (
          <button
            key={locale}
            type="button"
            onClick={() => switchTo(locale)}
            // Only the selected one carries the attribute. Emitting
            // `aria-current="false"` on the others is legal but says nothing,
            // and it invites styling hooks that then have to encode "false".
            aria-current={isCurrent ? 'true' : undefined}
            lang={locale}
            className={cn(
              'relative rounded-full px-2.5 py-1.5 text-[0.7rem] font-semibold tracking-wide transition-colors',
              // Hit area, not size. The pill is deliberately small — three of
              // them plus a logo have to share a phone header — so the target
              // is grown with a transparent overlay instead of by inflating the
              // control. 42x28 px of tappable pill means the neighbouring
              // language is one slip of the thumb away.
              'after:absolute after:inset-x-0 after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-[""]',
              // Lime means "selected" in this control, so the focus ring must
              // not also be lime — otherwise a focused-but-unselected language
              // looks exactly as chosen as the real one. The rest of the site
              // keeps the global lime ring, where nothing competes with it.
              'focus-visible:outline-coal-50 focus-visible:outline-2 focus-visible:outline-offset-2',
              isCurrent
                ? 'bg-lime-500 text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground',
            )}
          >
            {LABELS[locale]}
          </button>
        );
      })}
    </div>
  );
}
