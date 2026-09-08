import { cn } from '@/lib/utils';

/**
 * Brand glyphs.
 *
 * lucide-react v1 dropped brand icons, so these are drawn here. Keeping them as
 * local components rather than pulling a second icon package for two glyphs also
 * keeps them on `currentColor` and on the same stroke weight as everything else.
 */

export function InstagramIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('size-4', className)}
    >
      <rect width="20" height="20" x="2" y="2" rx="5.5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.4" cy="6.6" r="1.1" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function TelegramIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={cn('size-4', className)}>
      <path d="M21.6 4.3 18.5 19c-.2 1-.9 1.3-1.7.8l-4.7-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9L18 6.4c.4-.3-.1-.5-.6-.2L7.4 12.6l-4.6-1.4c-1-.3-1-1 .2-1.5l18-6.9c.8-.3 1.5.2 1.2 1.5Z" />
    </svg>
  );
}
