'use client';

import { useTranslations } from 'next-intl';

import { IS_DEMO } from '@/lib/demo';
import { cn } from '@/lib/utils';

/**
 * Permanent "Demo" chip for the header.
 *
 * A client component because the header is one. `IS_DEMO` reads a
 * `NEXT_PUBLIC_` variable, so it is inlined into the bundle at build time and
 * this compiles away to nothing in a real deployment.
 */
export function DemoChip({ className }: { className?: string }) {
  const t = useTranslations('demo');

  if (!IS_DEMO) return null;

  return (
    <span
      title={t('text')}
      className={cn(
        'bg-lime-500/12 text-lime-400 border-lime-500/25 flex shrink-0 items-center gap-1.5 rounded-full border px-1.5 py-1 text-[0.6rem] font-bold tracking-wide uppercase xs:px-2 sm:px-2.5 sm:text-[0.65rem]',
        className,
      )}
    >
      <span className="bg-lime-400 size-1.5 rounded-full" />
      {/*
        Below 376 px the word is dropped and the dot carries the signal — the
        header simply has no room for it there, and the footer notice is where
        the demo is actually explained. The label stays in the accessibility
        tree at every width, so nothing is lost to a screen reader.
      */}
      <span className="sr-only xs:not-sr-only">{t('label')}</span>
    </span>
  );
}
