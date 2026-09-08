'use client';

import { useState } from 'react';
import { CreditCard, Loader2, ShieldAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import { decideStubPayment } from '@/app/[locale]/(site)/pay/[reference]/actions';
import { useRouter } from '@/i18n/navigation';
import { isLocale, type Locale } from '@/lib/i18n/locales';
import { formatAmd, type Amd } from '@/lib/money';
import { cn } from '@/lib/utils';
import { useDemoPayment } from '@/stores/demo-payment';

/**
 * The page a customer would be looking at on their bank's website.
 *
 * It is on our domain because the provider it stands for does not exist yet, and
 * it says so at the top in as many words. Everything else about it is faithful to
 * the flow: the customer arrives here from the checkout, the decision is made
 * here, and they are sent back to a URL the merchant chose — with the merchant
 * learning the outcome by asking, not by being told on the way back.
 *
 * There is no card field, and its absence is a deliberate part of the design
 * rather than an unfinished form. A convincing fake card field is a real place for
 * somebody to type a real card number, and from there it is in a form value, a
 * server action payload, a log line and an error report. The one thing this
 * codebase must never be able to do is hold a card, so it has nowhere to put one —
 * here least of all, on the page most likely to invite it.
 *
 * Two backings, one screen. Against the stub provider it calls a server action
 * that writes to the fake gateway's own table. In the published demo, where there
 * is no table and no provider, the same buttons write to a store that lives in the
 * tab and dies with it.
 */

export function StubPaymentScreen({
  reference,
  publicCode,
  amount,
  settled,
  demo,
}: {
  /** The provider's reference for this attempt, or the demo's stand-in for one. */
  reference: string;
  /** `MK-482193`, so the customer can see they are paying for the right thing. */
  publicCode: string | null;
  amount: Amd;
  /** True when this session has already been decided and cannot be decided again. */
  settled: boolean;
  /** In demo mode the decision stays in the browser. `trackingToken` is where to go back to. */
  demo: { trackingToken: string } | null;
}) {
  const t = useTranslations('pay');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';
  const router = useRouter();

  const decideDemo = useDemoPayment((s) => s.decide);

  const [pending, setPending] = useState<'PAID' | 'FAILED' | null>(null);
  const [failed, setFailed] = useState(false);

  async function decide(outcome: 'PAID' | 'FAILED') {
    if (pending) return;
    setPending(outcome);
    setFailed(false);

    // The demo never leaves the browser: the outcome goes into the session store
    // and the customer is walked back to their order, which reads it.
    if (demo) {
      decideDemo(demo.trackingToken, outcome);
      router.replace(`/order/${demo.trackingToken}`);
      return;
    }

    try {
      const response = await decideStubPayment(reference, outcome);

      if (!response.ok) {
        setPending(null);
        setFailed(true);
        return;
      }

      // Back to the merchant, exactly as a gateway would. `location.assign`
      // rather than the router: the return URL is an API route, and with a real
      // provider this whole page would be on another origin anyway.
      window.location.assign(response.returnUrl);
    } catch {
      setPending(null);
      setFailed(true);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 pt-24 pb-16 sm:px-6 sm:pt-28">
      {/* First thing on the page, before the amount. Nobody should be able to
          mistake this for a real payment form, including a screenshot of it. */}
      <div className="flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
        <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-400" />
        <p className="text-sm leading-relaxed text-amber-200">{t('simulatorNotice')}</p>
      </div>

      <section className="bg-card mt-6 rounded-3xl border border-white/6 p-6">
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-lime-500/12 text-lime-400">
          <CreditCard className="size-7" />
        </span>

        <h1 className="mt-5 text-center text-xl font-bold">{t('title')}</h1>

        <dl className="mt-6 space-y-2 border-t border-white/8 pt-5 text-sm">
          {publicCode && (
            <div className="flex items-baseline justify-between gap-4">
              <dt className="text-muted-foreground">{t('order')}</dt>
              <dd className="font-semibold tabular-nums">{publicCode}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4">
            <dt className="text-muted-foreground">{t('amount')}</dt>
            <dd className="text-xl font-bold tabular-nums">{formatAmd(amount, locale)}</dd>
          </div>
        </dl>

        {settled ? (
          <p aria-live="polite" className="text-muted-foreground mt-6 text-center text-sm">
            {t('alreadySettled')}
          </p>
        ) : (
          <>
            <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
              {t('noCardNotice')}
            </p>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void decide('PAID')}
                className="text-primary-foreground flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-lime-500 text-base font-bold transition-colors hover:bg-lime-400 disabled:opacity-60"
              >
                {pending === 'PAID' && <Loader2 className="size-4 animate-spin" />}
                {pending === 'PAID' ? t('processing') : t('confirm')}
              </button>

              <button
                type="button"
                disabled={pending !== null}
                onClick={() => void decide('FAILED')}
                className={cn(
                  'flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-colors disabled:opacity-60',
                  'text-muted-foreground border-white/12 hover:bg-white/6',
                )}
              >
                {pending === 'FAILED' && <Loader2 className="size-4 animate-spin" />}
                {pending === 'FAILED' ? t('processing') : t('decline')}
              </button>
            </div>

            {/* The third outcome, and the one worth being able to reproduce: the
                customer who neither pays nor declines. Closing the tab here leaves
                the attempt pending, which is precisely what the reconciliation
                sweep exists to resolve. */}
            <p className="text-muted-foreground mt-4 text-center text-xs leading-relaxed">
              {t('abandonHint')}
            </p>
          </>
        )}

        {failed && (
          <p aria-live="polite" className="text-destructive mt-4 text-center text-sm">
            {t('decisionFailed')}
          </p>
        )}
      </section>
    </div>
  );
}
