'use client';

import Image from 'next/image';
import { useRef } from 'react';
import { ArrowRight, Clock } from 'lucide-react';
import { motion, useReducedMotion, useScroll, useTransform } from 'motion/react';
import { useTranslations } from 'next-intl';

import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/utils';
import { heroPhoto } from '@/server/db/placeholder-photos';

/**
 * Hero.
 *
 * The concept called for a glowing neon "HOT & TASTY". That is the most-copied
 * burger-site device of the last five years, it ages visibly, its thin strokes
 * fail contrast checks, and rendering it as an image wrecks LCP — the exact
 * opposite of the speed this project is built for.
 *
 * So: one full-bleed photograph, an editorial typographic lockup, and motion
 * that comes from the image itself. Confidence instead of glow.
 *
 * The parallax runs on `transform` only, driven by motion values rather than
 * React state, so it stays on the compositor and never triggers a re-render
 * while scrolling.
 */
export function Hero({
  isOpen,
  hours,
}: {
  isOpen: boolean;
  /**
   * Today's window, read from the settings the panel writes. `null` on a day the
   * restaurant is closed, and then the row is simply not drawn — the badge above
   * has already said so, and a clock with nothing to show is worse than no clock.
   */
  hours: { opensAt: string; closesAt: string } | null;
}) {
  const t = useTranslations('home');
  const containerRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end start'],
  });

  // The image drifts slower than the page and the text drifts faster, which is
  // what produces depth. Both are no-ops when the OS asks for reduced motion.
  const imageY = useTransform(scrollYProgress, [0, 1], ['0%', reduceMotion ? '0%' : '18%']);
  const imageScale = useTransform(scrollYProgress, [0, 1], [1, reduceMotion ? 1 : 1.12]);
  const contentY = useTransform(scrollYProgress, [0, 1], ['0%', reduceMotion ? '0%' : '-24%']);
  const contentOpacity = useTransform(scrollYProgress, [0, 0.7], [1, reduceMotion ? 1 : 0]);

  return (
    <section
      ref={containerRef}
      className="grain relative flex min-h-[100svh] items-end overflow-hidden"
    >
      <motion.div style={{ y: imageY, scale: imageScale }} className="absolute inset-0 -z-10">
        <Image
          src={heroPhoto()}
          alt=""
          fill
          priority
          sizes="100vw"
          className="object-cover object-center"
        />

        {/*
          Three scrims, each doing a different job. One would either leave the
          headline sitting on a bright bun or flatten the photograph into mud.

          - a flat wash that guarantees a contrast floor wherever the crop lands
          - a bottom-up wash so the headline and buttons always have something
            solid behind them
          - a left-to-right wash so the text column holds on wide screens, where
            the subject drifts to the right of the frame
          - a short top wash so the fixed header stays legible before it turns
            to glass on scroll
        */}
        <div className="bg-coal-1000/25 absolute inset-0" />
        <div className="from-coal-1000 via-coal-1000/45 absolute inset-0 bg-gradient-to-t to-transparent" />
        <div className="from-coal-1000 via-coal-1000/30 absolute inset-0 bg-gradient-to-r to-transparent" />
        <div className="from-coal-1000/75 absolute inset-x-0 top-0 h-32 bg-gradient-to-b to-transparent" />
      </motion.div>

      <motion.div
        style={{ y: contentY, opacity: contentOpacity }}
        className="mx-auto w-full max-w-7xl px-4 pt-32 pb-16 sm:px-6 sm:pb-24 lg:px-8"
      >
        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
          <span className="relative flex size-2">
            <span
              className={cn(
                'absolute inline-flex size-full rounded-full',
                isOpen ? 'bg-lime-500 animate-ping opacity-75' : 'bg-muted-foreground',
              )}
            />
            <span
              className={cn(
                'relative inline-flex size-2 rounded-full',
                isOpen ? 'bg-lime-500' : 'bg-muted-foreground',
              )}
            />
          </span>
          <p className="text-xs font-semibold tracking-[0.2em] uppercase">
            {isOpen ? t('openNow') : t('closedNow')}
          </p>
          <span className="bg-border h-4 w-px" />
          <p className="text-muted-foreground text-xs font-semibold tracking-[0.2em] uppercase">
            {t('eyebrow')}
          </p>
        </div>

        <h1 className="text-display mt-6 max-w-4xl font-bold text-balance">
          {t('heroTitleTop')}
          <br />
          <span className="text-lime-500">{t('heroTitleBottom')}</span>
        </h1>

        <p className="text-muted-foreground mt-6 max-w-lg text-lg leading-relaxed text-balance sm:text-xl">
          {t('heroSubtitle')}
        </p>

        <div className="mt-9 flex flex-col gap-3 sm:flex-row sm:items-center">
          <Link
            href="/menu"
            className="bg-lime-500 text-primary-foreground shadow-lime hover:bg-lime-400 group flex h-14 items-center justify-center gap-2 rounded-2xl px-8 text-base font-bold transition-colors active:scale-[0.98]"
          >
            {t('orderNow')}
            <ArrowRight className="size-5 transition-transform duration-300 group-hover:translate-x-1" />
          </Link>

          <Link
            href="/menu"
            className="glass flex h-14 items-center justify-center rounded-2xl border border-white/12 px-8 text-base font-semibold transition-colors hover:bg-white/8"
          >
            {t('seeMenu')}
          </Link>
        </div>

        {hours && (
          <div className="text-muted-foreground mt-10 flex items-center gap-2 text-sm">
            <Clock className="size-4" />
            <span className="tabular-nums">
              {hours.opensAt} – {hours.closesAt}
            </span>
          </div>
        )}
      </motion.div>
    </section>
  );
}
