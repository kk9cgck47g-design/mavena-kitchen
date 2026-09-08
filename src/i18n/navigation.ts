import { createNavigation } from 'next-intl/navigation';

import { routing } from './routing';

/**
 * Locale-aware replacements for `next/link` and the navigation hooks.
 *
 * Always import from here rather than from `next/navigation` inside the
 * storefront — these keep the active locale in the URL automatically, so a
 * Russian visitor stays on `/ru/...` when they tap a link.
 */
export const { Link, redirect, usePathname, useRouter, getPathname } = createNavigation(routing);
