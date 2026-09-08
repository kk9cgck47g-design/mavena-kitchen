import type { Metadata, Viewport } from 'next';
import { Google_Sans } from 'next/font/google';

import { AdminNav } from '@/components/admin/admin-nav';
import { adminAvailability, currentAdmin } from '@/server/auth/admin-session';
import { ADMIN_TEXT } from './strings';
import '../globals.css';

/**
 * The staff panel's own shell.
 *
 * A separate root layout, not a variation on the storefront's: this segment has
 * no locale prefix (see the proxy matcher), no cart, no marketing header, and a
 * different audience standing at a different screen. Sharing a layout with the
 * shop would mean threading "is this the admin?" through every piece of it.
 *
 * Only Google Sans is loaded here. Archivo exists for the wordmark on the
 * storefront and there is no wordmark here.
 */

const googleSans = Google_Sans({
  subsets: ['latin', 'cyrillic', 'armenian'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-google-sans',
  display: 'swap',
});

export const metadata: Metadata = {
  title: `${ADMIN_TEXT.brand} · ${ADMIN_TEXT.panel}`,
  // Staff-only and full of customer data. Nothing here should ever be indexed
  // or leak a URL through a referrer.
  robots: { index: false, follow: false, nocache: true },
  referrer: 'no-referrer',
};

export const viewport: Viewport = {
  themeColor: '#0A0A09',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const availability = adminAvailability();
  const admin = availability === 'ready' ? await currentAdmin() : null;

  return (
    <html lang="ru" className={googleSans.variable}>
      {/* `svh` for the same reason as the storefront: a page height tied to the
          dynamic viewport moves whenever Safari's toolbar does. */}
      <body className="min-h-svh antialiased">
        {/* The nav is hidden on the login screen and when the panel is not
            configured: neither has anywhere to navigate to. */}
        {(availability === 'demo' || admin) && (
          <AdminNav
            demo={availability === 'demo'}
            name={admin?.name ?? null}
            /* The preview shows the whole panel — there is nobody to keep out of
               it and nothing behind it to protect. */
            isOwner={availability === 'demo' || admin?.role === 'OWNER'}
          />
        )}
        <main>{children}</main>
      </body>
    </html>
  );
}
