import { createEnv } from '@t3-oss/env-nextjs';
import { z } from 'zod';

/**
 * Validated environment. Fails the build rather than the checkout page:
 * a missing DATABASE_URL should surface at deploy time, not when a customer
 * taps "Order".
 *
 * Integrations that are not wired up yet (Telegram, Cloudinary, MapTiler) are
 * optional — the app degrades gracefully instead of refusing to boot.
 */
export const env = createEnv({
  server: {
    /**
     * Optional so the design preview can deploy with no database at all
     * (`NEXT_PUBLIC_DEMO_MODE=1`). Any real deployment must set it: the database
     * client throws a pointed error the first time it is touched without one,
     * which is better than a build that succeeds and then 500s on every page.
     */
    DATABASE_URL: z.string().min(1).optional(),
    /**
     * Whether `DATABASE_URL` points at a transaction-mode pooler.
     *
     * Normally unset: `server/db/pooling.ts` works it out from the hostname,
     * which is right for Neon and Supabase. Set it when the guess is wrong — a
     * PgBouncer on a hostname that says nothing about itself, or a pooled
     * provider whose URLs do not match the shapes we know.
     *
     * `'1'` disables prepared statements, which is the safe direction. `'0'`
     * forces them on and is only correct for a genuinely direct connection.
     */
    DATABASE_POOLED: z.enum(['0', '1']).optional(),
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
    CLOUDINARY_CLOUD_NAME: z.string().optional(),
    CLOUDINARY_API_KEY: z.string().optional(),
    CLOUDINARY_API_SECRET: z.string().optional(),
    AUTH_SECRET: z.string().min(16).optional(),
    /**
     * Guards the scheduled retry endpoint. Vercel sends it as
     * `Authorization: Bearer …` on every cron invocation; without it the
     * endpoint is closed rather than open.
     */
    CRON_SECRET: z.string().min(16).optional(),
    /**
     * Which payment adapter takes money, or nothing at all.
     *
     * Unset means online payment is not offered — the checkout shows cash and
     * card-on-delivery only, and the server refuses `ONLINE` if it is asked for
     * anyway. That is the correct state for every deployment until an acquiring
     * contract exists.
     *
     * An enum rather than a free string, so a typo disables payment loudly at
     * boot instead of quietly at checkout. A real adapter adds its name here and
     * to `server/payments/registry.ts`.
     */
    PAYMENT_PROVIDER: z.enum(['stub']).optional(),
  },
  client: {
    /**
     * Optional: Vercel supplies its own deployment URL, and `siteUrl()` falls
     * back to it. Requiring this would fail a first deploy for a value that only
     * affects absolute URLs in metadata.
     */
    NEXT_PUBLIC_SITE_URL: z.string().url().optional(),
    NEXT_PUBLIC_MAPTILER_KEY: z.string().optional(),
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: z.string().optional(),
    /** `'1'` serves the menu from memory and refuses to create orders. */
    NEXT_PUBLIC_DEMO_MODE: z.enum(['0', '1']).optional(),
  },
  runtimeEnv: {
    DATABASE_URL: process.env.DATABASE_URL,
    DATABASE_POOLED: process.env.DATABASE_POOLED,
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_WEBHOOK_SECRET: process.env.TELEGRAM_WEBHOOK_SECRET,
    CLOUDINARY_CLOUD_NAME: process.env.CLOUDINARY_CLOUD_NAME,
    CLOUDINARY_API_KEY: process.env.CLOUDINARY_API_KEY,
    CLOUDINARY_API_SECRET: process.env.CLOUDINARY_API_SECRET,
    AUTH_SECRET: process.env.AUTH_SECRET,
    CRON_SECRET: process.env.CRON_SECRET,
    PAYMENT_PROVIDER: process.env.PAYMENT_PROVIDER,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_MAPTILER_KEY: process.env.NEXT_PUBLIC_MAPTILER_KEY,
    NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  },
  emptyStringAsUndefined: true,
});
