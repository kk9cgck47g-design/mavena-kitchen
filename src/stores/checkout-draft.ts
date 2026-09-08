'use client';

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

import { isCityCode, type CityCode, type OrderType, type PaymentMethod } from '@/lib/domain';
import { BROWSER_STORAGE_KEYS } from '@/lib/browser-storage';
import { DEFAULT_PAYMENT_METHOD } from '@/lib/schemas/checkout';

/**
 * What the checkout form remembers between orders.
 *
 * Somebody who orders from the same flat every Friday should not retype their
 * name and phone number every Friday. This is the whole reason the store exists,
 * and it is worth being deliberate about what it may hold.
 *
 * What it holds: the customer's own contact details, on the customer's own
 * device. Nothing else stores them — there are no accounts here.
 *
 * What it must never hold: an amount, an order id, a public code, a tracking
 * token. Prices are quoted by the server on every visit, and a tracking token
 * sitting in localStorage is a link to a page showing a name, a phone number and
 * a home address. Neither belongs in a cache that survives the order.
 *
 * `notes` is also excluded, and that one is a UX judgement rather than a safety
 * one: "no onions, ring the bell twice" is about one order. Silently attaching
 * last week's note to this week's order is how the wrong thing gets delivered.
 *
 * Kept apart from the cart store because the two have different lifetimes: the
 * cart empties when an order is placed, this does not.
 */

export interface CheckoutDraft {
  type: OrderType;
  customerName: string;
  phone: string;
  /** Null until chosen. */
  cityCode: CityCode | null;
  /** Free text for the courier. Never parsed — there is no geocoding here. */
  address: string;
  landmark: string;
  /**
   * The pin. Stored flat rather than as an object so a stale persisted value can
   * never arrive half-formed, and so a change is a change to a number.
   */
  lat: number | null;
  lng: number | null;
  /**
   * How they paid last time. A preference, not a payment detail.
   *
   * No card number, no token, nothing a payment provider would recognise ever
   * reaches this store — and that stays true now that online payment exists,
   * because the card is typed on the provider's page and never passes through
   * this application at all. What is remembered here is the word `ONLINE`.
   *
   * Read through `enabledPaymentMethod` rather than directly: a draft written
   * while a method was offered can outlive the offer.
   */
  paymentMethod: PaymentMethod;
}

/**
 * The stored preference, or something that actually works.
 *
 * A draft is months-lived and the list of available methods is not. Trusting a
 * stored `ONLINE` after online payment was switched off — or after the provider
 * was removed from the deployment — would put a method on screen that the server
 * refuses, and the customer would find out by pressing the button.
 *
 * The available list is passed in rather than imported, because only the server
 * knows it: whether online payment exists is a property of the deployment's
 * configuration, and a client component cannot read that.
 */
export function enabledPaymentMethod(
  stored: PaymentMethod,
  available: readonly PaymentMethod[],
): PaymentMethod {
  if (available.includes(stored)) return stored;
  return available[0] ?? DEFAULT_PAYMENT_METHOD;
}

/**
 * Bumped when a stored draft can no longer be trusted as it stands.
 *
 * 2 — the set of cities changed. A draft written against a city that no longer
 *     exists is not merely stale: `cityCode` is what the checkout looks up a
 *     delivery zone by, and the pin was dropped inside a polygon that has gone.
 */
export const CHECKOUT_DRAFT_VERSION = 2;

/**
 * What to keep from a draft written by an older version of this app.
 *
 * The instinct is to throw the whole thing away, and it is the wrong one: a name
 * and a phone number are why this store exists, and they have nothing to do with
 * which cities are served. So the geography goes and the person stays.
 *
 * Geography goes as a set — city, address, landmark and the pin together —
 * because they only mean anything in combination. Keeping the address text
 * while dropping the city would leave a courier a street with no town, and
 * keeping the pin would leave a marker sitting in another province with nothing
 * on screen to explain it.
 *
 * A null `cityCode` is not invalid, it is "not chosen yet", and a draft in that
 * state is passed through untouched.
 *
 * Exported and pure so the behaviour can be tested without a browser: this runs
 * exactly once per visitor, on their first load after a deployment, which is the
 * hardest moment in the app's life to reproduce by hand.
 */
export function migrateCheckoutDraft(persisted: unknown): Partial<CheckoutDraft> {
  if (persisted === null || typeof persisted !== 'object') return {};

  const draft = persisted as Partial<CheckoutDraft>;
  if (draft.cityCode == null || isCityCode(draft.cityCode)) return draft;

  return {
    ...draft,
    cityCode: null,
    address: '',
    landmark: '',
    lat: null,
    lng: null,
  };
}

interface CheckoutDraftState extends CheckoutDraft {
  /** Set once the persisted draft has been read, to avoid an SSR/client mismatch. */
  hydrated: boolean;
  update: (patch: Partial<CheckoutDraft>) => void;
  setHydrated: () => void;
}

const EMPTY_DRAFT: CheckoutDraft = {
  type: 'DELIVERY',
  customerName: '',
  phone: '',
  cityCode: null,
  address: '',
  landmark: '',
  lat: null,
  lng: null,
  paymentMethod: DEFAULT_PAYMENT_METHOD,
};

export const useCheckoutDraft = create<CheckoutDraftState>()(
  persist(
    (set) => ({
      ...EMPTY_DRAFT,
      hydrated: false,

      update: (patch) => set(patch),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: BROWSER_STORAGE_KEYS.checkout,
      storage: createJSONStorage(() => localStorage),
      /**
       * Explicit rather than a blocklist. A field added to the state later is
       * then not persisted by accident — it has to be named here, which is the
       * moment to ask whether it should outlive the order.
       */
      partialize: (state) => ({
        type: state.type,
        customerName: state.customerName,
        phone: state.phone,
        cityCode: state.cityCode,
        address: state.address,
        landmark: state.landmark,
        lat: state.lat,
        lng: state.lng,
        paymentMethod: state.paymentMethod,
      }),
      /**
       * Bumped when the shape or the vocabulary changes in a way an old draft
       * cannot survive. Adding a field does not qualify — persist merges over
       * the defaults above, so a draft written before the address existed simply
       * arrives with an empty one.
       *
       * Without a `migrate` alongside it the version is only half a mechanism:
       * zustand has no instruction for what to do with the mismatch, and what
       * reaches the form then depends on the version of a dependency rather than
       * on a decision taken here.
       */
      version: CHECKOUT_DRAFT_VERSION,
      migrate: migrateCheckoutDraft,
      onRehydrateStorage: () => (state) => state?.setHydrated(),
    },
  ),
);
