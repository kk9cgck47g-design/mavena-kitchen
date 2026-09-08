import { config } from 'dotenv';

// Vitest runs outside Next.js, which would otherwise load `.env.local` for us.
config({ path: '.env.local', quiet: true });
config({ path: '.env', quiet: true });

/**
 * The payment tests need a provider, and the stub is the one that exists.
 *
 * Set here rather than in `.env.local` so that a developer's own environment is
 * not quietly changed by running the suite — and so the suite behaves the same
 * on a machine that has never configured payments at all. `dotenv` does not
 * overwrite what is already set, so an explicit `PAYMENT_PROVIDER` in the
 * environment still wins.
 */
process.env.PAYMENT_PROVIDER ??= 'stub';
