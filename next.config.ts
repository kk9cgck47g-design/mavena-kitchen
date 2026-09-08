import type { NextConfig } from 'next';
import createNextIntlPlugin from 'next-intl/plugin';

const withNextIntl = createNextIntlPlugin('./src/i18n/request.ts');

/**
 * Response headers, applied to everything.
 *
 * The cheap half of the security work: no code changes, no runtime cost, and
 * each one closes something off rather than mitigating it afterwards.
 *
 * A full `Content-Security-Policy` is deliberately not here. This site loads a
 * map that runs a web worker from a `blob:` URL and pulls tiles from a third
 * party, and next-intl inlines a bootstrap script — so a strict policy needs
 * per-request nonces and a round of finding out what breaks. That is its own
 * piece of work. What is set below is the part of CSP that costs nothing and
 * cannot break anything: `frame-ancestors`, which is the modern spelling of
 * clickjacking protection.
 */
const SECURITY_HEADERS = [
  /*
    A year, and no `preload`. Preloading means asking browsers to hard-code the
    domain as HTTPS-only before they have ever visited it, and removing it again
    takes months — not a commitment to make on behalf of a restaurant whose
    domain is not settled.
  */
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' },

  /** Stops a browser from deciding an uploaded file is really a script. */
  { key: 'X-Content-Type-Options', value: 'nosniff' },

  /*
    The order tracking page sets `no-referrer` on itself, because its URL is the
    secret. This is the site-wide floor for everything else: an outbound link
    tells the destination which site sent the visitor, never which page.
  */
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },

  /*
    Nothing here is meant to be framed, and the admin panel least of all — a
    framed panel is a clickjacked "cancel order" button. Both spellings, because
    `X-Frame-Options` is what older browsers read and `frame-ancestors` is what
    current ones do.
  */
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },

  /*
    Geolocation stays available to our own origin — the checkout's "my location"
    button is the one feature that needs it. Everything else a food site has no
    business asking for.
  */
  {
    key: 'Permissions-Policy',
    value: 'camera=(), microphone=(), geolocation=(self), payment=(), usb=()',
  },
];

/**
 * The policy a real CSP would have to be, reported on and not enforced.
 *
 * Development only, and that is the whole point of it: a report-only header in
 * production fires violations into every customer's console and tells nobody,
 * because there is no reporting endpoint to send them to. In development it goes
 * to the console of the person who can act on it, which is where a draft policy
 * is useful.
 *
 * Enforcing it needs two things this does not have. `'unsafe-inline'` on scripts
 * has to become a per-request nonce, which means threading one through the
 * layout; and somebody has to click through the map, the checkout and the
 * payment page to find what else breaks. Until then this is a statement of what
 * the site actually loads, kept next to the code that loads it so it goes stale
 * loudly rather than quietly.
 */
const DRAFT_CSP =
  process.env.NODE_ENV === 'development'
    ? {
        key: 'Content-Security-Policy-Report-Only',
        value: [
          "default-src 'self'",
          // `unsafe-inline` is Next's bootstrap script; `unsafe-eval` is the dev
          // server's refresh runtime and would not be needed in production.
          "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
          // Tailwind and next/font both emit inline style.
          "style-src 'self' 'unsafe-inline'",
          // Dish photography, map tiles, and the canvas the map draws into.
          "img-src 'self' data: blob: https://res.cloudinary.com https://images.unsplash.com https://api.maptiler.com https://tile.openstreetmap.org",
          "font-src 'self' data:",
          // maplibre runs its renderer in a worker created from a blob.
          "worker-src 'self' blob:",
          // Tiles and styles are fetched, not just referenced. `ws:` is the dev
          // server's hot reload.
          "connect-src 'self' ws: https://api.maptiler.com https://tile.openstreetmap.org",
          "frame-ancestors 'none'",
          "base-uri 'self'",
          // Nothing on this site posts anywhere else. When a real payment
          // provider arrives it will be a redirect rather than a cross-origin
          // form, so this should still hold — and if it does not, that is worth
          // finding out here.
          "form-action 'self'",
          "object-src 'none'",
        ].join('; '),
      }
    : null;

/**
 * Hosts the dev server will serve `/_next/*` to, beyond localhost.
 *
 * Next refuses those requests from any other origin by default, and it is right
 * to: a dev server that hands its module graph to whatever page asks is a
 * DNS-rebinding target. The cost is that opening the site from a phone on the
 * same network gets the server-rendered HTML and then a 403 on every client
 * chunk — the page looks nearly right and does nothing, which is a confusing
 * way to spend an hour. Testing on a real handset is the only way to see what
 * Safari actually does, so the door has to open, but only as wide as the person
 * testing says and never in a committed file: this reads a machine-local
 * setting instead of pinning somebody's LAN address into the repository.
 *
 *   DEV_ALLOWED_ORIGINS="192.168.1.42"   in .env.local, then restart `next dev`
 *
 * Ignored entirely by `next build`; this only ever affects the dev server.
 */
const devAllowedOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  // The dev overlay badge sits in the bottom-left corner, exactly where the
  // mobile cart bar and the sheet close button live. Hiding it keeps those
  // reachable while developing on a phone-sized viewport.
  devIndicators: false,

  ...(devAllowedOrigins.length > 0 ? { allowedDevOrigins: devAllowedOrigins } : {}),

  /** Free information about the stack, given away on every response. */
  poweredByHeader: false,

  headers() {
    return Promise.resolve([
      {
        source: '/:path*',
        headers: [...SECURITY_HEADERS, ...(DRAFT_CSP ? [DRAFT_CSP] : [])],
      },
    ]);
  },

  images: {
    remotePatterns: [
      // Real dish photography will be served from Cloudinary.
      { protocol: 'https', hostname: 'res.cloudinary.com' },
      // Placeholder photography until the restaurant's own shoot arrives.
      { protocol: 'https', hostname: 'images.unsplash.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    // Matches the card, hero and sheet widths actually used in the layout —
    // narrowing this list avoids generating variants nothing ever requests.
    imageSizes: [96, 128, 256, 384],
    deviceSizes: [420, 640, 828, 1080, 1280, 1920],
  },
  experimental: {
    // Keeps the client bundle small: only the icons actually used get bundled.
    optimizePackageImports: ['lucide-react', 'motion'],
  },
};

export default withNextIntl(nextConfig);
