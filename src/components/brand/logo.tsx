import { RESTAURANT } from '@/lib/restaurant';
import { cn } from '@/lib/utils';

/**
 * Original Mavena Kitchen monogram.
 *
 * The cream stroke draws an angular M; its final stem is shared with two lime
 * diagonals that form a K. Five straight segments remain distinct at favicon
 * size, while the open construction feels lighter than an enclosed badge on the
 * existing dark surfaces.
 */

interface MarkProps {
  className?: string;
  /** Renders in a single colour for stamps and disabled states. */
  monochrome?: boolean;
}

export function LogoMark({ className, monochrome = false }: MarkProps) {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      aria-hidden="true"
      className={cn('size-9 shrink-0', className)}
    >
      <path
        d="M7 37V11L19 26L31 11V37"
        stroke="currentColor"
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M31 24L41 11M31 24L42 37"
        stroke={monochrome ? 'currentColor' : 'var(--color-lime-500)'}
        strokeWidth="5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface LockupProps {
  className?: string;
  /** Stacks the two words in footer-scale lockups. */
  stacked?: boolean;
  markClassName?: string;
}

export function LogoLockup({ className, stacked = false, markClassName }: LockupProps) {
  const [first, second] = RESTAURANT.nameParts;

  return (
    <span className={cn('flex min-w-0 items-center gap-2 sm:gap-2.5', className)}>
      <LogoMark className={cn('text-coal-50 size-9', markClassName)} />
      <span
        className={cn(
          'font-display leading-[0.86] font-black tracking-[-0.045em] uppercase',
          stacked ? 'flex flex-col text-[1.05em]' : 'truncate text-[0.9em]',
        )}
      >
        <span>{first}</span>
        <span className={cn(stacked ? 'text-lime-500' : 'ml-[0.28em] text-lime-500')}>
          {second}
        </span>
      </span>
    </span>
  );
}
