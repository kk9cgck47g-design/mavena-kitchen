/**
 * Every browser key that carries the brand in its name.
 *
 * Collected in one place because they are a set: a rebrand that renames three of
 * them and forgets the fourth leaves a returning visitor half-migrated, with a
 * cart under the new name and a session cookie under the old one. Renaming a key
 * abandons whatever was stored under the previous one, which is the intended
 * effect — the values behind them are conveniences, not records.
 */
export const BROWSER_STORAGE_KEYS = {
  cart: 'mavena-kitchen-cart',
  checkout: 'mavena-kitchen-checkout',
  demoAdmin: 'mavena-kitchen-demo-admin',
  adminSession: 'mk_admin_session',
} as const;
