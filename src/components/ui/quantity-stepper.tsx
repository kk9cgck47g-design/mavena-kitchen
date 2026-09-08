'use client';

import { Minus, Plus, Trash2 } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

import { cn } from '@/lib/utils';

/**
 * A transparent 44px square centred on the button.
 *
 * The control renders as small as its row allows — 36px in a cart line, and
 * narrower than it is tall everywhere, so a primary action still fits beside it
 * on a 375px screen. The tappable region does not shrink with it. Neighbouring
 * buttons are far enough apart that these never overlap.
 */
const HIT_AREA =
  'after:absolute after:top-1/2 after:left-1/2 after:size-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-[""]';

/**
 * Minus / count / plus.
 *
 * Two details that decide whether this feels cheap or considered:
 *
 * - Hit targets are 44px even when the control renders smaller. Anything less is
 *   a miss-tap on a phone, and this control gets used more than any other.
 * - The digit slides in the direction of the change, so a rapid tap-tap-tap
 *   reads as counting up rather than as random flicker.
 */
export function QuantityStepper({
  value,
  onChange,
  min = 1,
  max = 50,
  size = 'md',
  /** Show a bin icon instead of a minus when stepping below `min` removes the line. */
  removeAtMin = false,
  className,
  ariaLabel,
}: {
  value: number;
  onChange: (next: number) => void;
  min?: number;
  max?: number;
  size?: 'sm' | 'md' | 'lg';
  removeAtMin?: boolean;
  className?: string;
  ariaLabel?: string;
}) {
  const atMin = value <= min;
  const showRemove = removeAtMin && atMin;

  // Buttons keep full height for the tap target but stay narrow, so the control
  // does not eat the width a primary action needs beside it on a 375px screen.
  //
  // `lg` narrows again below `sm`, and that is a width budget rather than a
  // style: it sits beside the dish sheet's add button, whose label carries a
  // price and cannot wrap. At its full 130px the two together needed 167px more
  // than a 320px screen has, and the button — the one control that matters —
  // was the half that overflowed. Losing 24px here buys it back everywhere from
  // 360px up. The tap targets do not move: `HIT_AREA` is a fixed 44px square
  // centred on each button, so it is only the drawn width that changes.
  const sizes = {
    sm: { box: 'h-9', btn: 'h-9 w-9', text: 'text-sm w-7', icon: 'size-3.5' },
    md: { box: 'h-11', btn: 'h-11 w-10', text: 'text-base w-8', icon: 'size-4' },
    lg: { box: 'h-14', btn: 'h-14 w-9 sm:w-11', text: 'text-lg w-8 sm:w-10', icon: 'size-5' },
  }[size];

  return (
    <div
      className={cn(
        'bg-elevated inline-flex items-center rounded-full border border-white/8 select-none',
        sizes.box,
        className,
      )}
      role="group"
      aria-label={ariaLabel}
    >
      <button
        type="button"
        onClick={() => onChange(value - 1)}
        disabled={atMin && !removeAtMin}
        aria-label={showRemove ? 'Remove' : 'Decrease'}
        className={cn(
          'relative flex items-center justify-center rounded-full transition-colors',
          HIT_AREA,
          'hover:bg-white/8 active:bg-white/12 disabled:opacity-30 disabled:hover:bg-transparent',
          showRemove && 'text-destructive',
          sizes.btn,
        )}
      >
        {showRemove ? <Trash2 className={sizes.icon} /> : <Minus className={sizes.icon} />}
      </button>

      <span className={cn('relative overflow-hidden text-center font-semibold', sizes.text)}>
        {/* `mode="popLayout"` lets the outgoing digit leave while the incoming one
            arrives, so the width never collapses mid-transition. */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={value}
            initial={{ y: '60%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-60%', opacity: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            className="block tabular-nums"
          >
            {value}
          </motion.span>
        </AnimatePresence>
      </span>

      <button
        type="button"
        onClick={() => onChange(value + 1)}
        disabled={value >= max}
        aria-label="Increase"
        className={cn(
          'relative flex items-center justify-center rounded-full transition-colors',
          HIT_AREA,
          'hover:bg-white/8 active:bg-white/12 disabled:opacity-30 disabled:hover:bg-transparent',
          sizes.btn,
        )}
      >
        <Plus className={sizes.icon} />
      </button>
    </div>
  );
}
