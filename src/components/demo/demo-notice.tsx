import { Info } from 'lucide-react';
import { getTranslations } from 'next-intl/server';

import { IS_DEMO } from '@/lib/demo';

/**
 * Demo labelling.
 *
 * Someone opening a shared link has to understand within a second that this is a
 * design preview and not a working restaurant — otherwise they try to order
 * dinner from it.
 *
 * A floating badge was the first attempt and it covered a dish price, which is
 * exactly the content the preview exists to show. So the notice is split in two
 * and both parts sit in normal flow, overlapping nothing: a permanent chip in
 * the header, and the full explanation in the footer where people look for
 * context anyway.
 *
 * Both render nothing outside demo mode, so the real deployment is untouched.
 */

export async function DemoFooterNote() {
  if (!IS_DEMO) return null;

  const t = await getTranslations('demo');

  return (
    <div className="border-b border-white/8">
      <div className="mx-auto flex max-w-7xl items-start gap-3 px-4 py-6 sm:px-6 lg:px-8">
        <span className="bg-lime-500/12 text-lime-400 flex size-8 shrink-0 items-center justify-center rounded-full">
          <Info className="size-4" />
        </span>

        <div className="min-w-0">
          <p className="text-sm font-semibold">{t('title')}</p>
          <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm leading-relaxed">
            {t('text')}
          </p>
          <p className="text-muted-foreground mt-1.5 max-w-2xl text-sm leading-relaxed">
            {t('notReady')}
          </p>
        </div>
      </div>
    </div>
  );
}
