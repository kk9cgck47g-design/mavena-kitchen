'use client';

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { Banknote, Bike, CreditCard, Globe, Info, Loader2, ShoppingBag, Store } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';

import {
  placeOrder,
  requestQuote,
  type PlaceOrderError,
} from '@/app/[locale]/(site)/checkout/actions';
import { OrderSummary } from '@/components/checkout/order-summary';
import { PinMap, type PinMapZone } from '@/components/checkout/pin-map';
import { Price } from '@/components/ui/price';
import { Skeleton } from '@/components/ui/skeleton';
import { Link, useRouter } from '@/i18n/navigation';
import type { CheckoutBlocker, CheckoutQuote, OrderingWindow } from '@/lib/checkout-types';
import { IS_DEMO } from '@/lib/demo';
import type { CityCode, PaymentMethod } from '@/lib/domain';
import { isPointInPolygon, type LatLng } from '@/lib/geo';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { formatAmd } from '@/lib/money';
import { normalizeArmenianPhone } from '@/lib/phone';
import type { CartLine } from '@/lib/schemas/cart';
import { cn } from '@/lib/utils';
import { toServerLines, useCart } from '@/stores/cart';
import { enabledPaymentMethod, useCheckoutDraft } from '@/stores/checkout-draft';

/**
 * Checkout, one screen.
 *
 * Not a wizard: on a phone a three-step flow means three chances to abandon, and
 * the whole form is short enough to scroll. Delivery-versus-pickup sits at the
 * very top because that choice decides which fields exist at all.
 *
 * Every amount on this screen comes from `requestQuote`. The cart's cached unit
 * prices are used for names and quantities only — see `order-summary.tsx`.
 */

export interface CheckoutCity {
  code: CityCode;
  name: string;
  /** Where the map opens for this city. */
  center: LatLng;
  defaultZoom: number;
  /** False when the city has no active delivery zone, so it cannot be delivered to at all. */
  canDeliver: boolean;
}

/** How long the map must sit still before its position is worth a round trip. */
const PIN_DEBOUNCE_MS = 400;

/**
 * The last answer from the server.
 *
 * Held across a re-quote on purpose, so the totals dim rather than blink out and
 * back on every change. Once the map arrives that will be every drag of the pin.
 * A failure does clear it: a stale total presented as current is worse than no
 * total at all.
 */
type QuoteResult =
  | { status: 'ready'; quote: CheckoutQuote; ordering: OrderingWindow }
  /** The request itself failed — distinct from a quote that came back refusing. */
  | { status: 'failed' };

/**
 * How far the one irreversible action on this screen has got.
 *
 * `placed` is kept separate from simply navigating away because the cart is
 * emptied at that moment: the screen must have something to render for the beat
 * between an empty cart and the tracking page, and it must not be the "your
 * cart is empty" screen.
 *
 * `demo` is its own state rather than an error. Nothing went wrong — the
 * preview refused on purpose, and telling someone their order failed would be
 * a lie in the other direction.
 */
type SubmitState =
  | { status: 'idle' }
  | { status: 'sending' }
  | { status: 'demo' }
  | { status: 'failed'; error: PlaceOrderError }
  | { status: 'placed' };

const PAYMENT_ICONS: Record<string, typeof Banknote> = {
  CASH: Banknote,
  CARD_ON_DELIVERY: CreditCard,
  ONLINE: Globe,
};

export function CheckoutScreen({
  ordering: initialOrdering,
  pausedMessage,
  cities,
  zones,
  pickup,
  paymentMethods,
}: {
  ordering: OrderingWindow;
  pausedMessage: string | null;
  cities: CheckoutCity[];
  /** Every active zone, for drawing the map and for the instant in-zone check. */
  zones: PinMapZone[];
  pickup: { address: string; contact: string };
  /**
   * Which methods this deployment can actually take, decided on the server.
   *
   * A prop rather than a constant because `ONLINE` exists only where a provider
   * is configured, and that is not something a browser can know. The server
   * checks the choice again when the order is placed — this only decides what to
   * draw.
   */
  paymentMethods: readonly PaymentMethod[];
}) {
  const t = useTranslations('checkout');
  const tc = useTranslations('cart');
  const te = useTranslations('errors');
  const tcom = useTranslations('common');
  const td = useTranslations('demo');
  const tp = useTranslations('payment');
  const raw = useLocale();
  const locale: Locale = isLocale(raw) ? raw : 'hy';
  const router = useRouter();

  const items = useCart((s) => s.items);
  const cartHydrated = useCart((s) => s.hydrated);
  const clearCart = useCart((s) => s.clear);

  const type = useCheckoutDraft((s) => s.type);
  const customerName = useCheckoutDraft((s) => s.customerName);
  const phone = useCheckoutDraft((s) => s.phone);
  const cityCode = useCheckoutDraft((s) => s.cityCode);
  const address = useCheckoutDraft((s) => s.address);
  const landmark = useCheckoutDraft((s) => s.landmark);
  const lat = useCheckoutDraft((s) => s.lat);
  const lng = useCheckoutDraft((s) => s.lng);
  const storedPayment = useCheckoutDraft((s) => s.paymentMethod);
  const draftHydrated = useCheckoutDraft((s) => s.hydrated);
  const update = useCheckoutDraft((s) => s.update);

  const paymentMethod = enabledPaymentMethod(storedPayment, paymentMethods);

  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [retry, setRetry] = useState(0);

  /**
   * Not in the draft, deliberately. "No onions, ring the bell twice" is about
   * one order; attaching last week's note to this week's is how the wrong thing
   * gets delivered. See the note at the top of `checkout-draft.ts`.
   */
  const [notes, setNotes] = useState('');

  const [submit, setSubmit] = useState<SubmitState>({ status: 'idle' });

  /**
   * Guards the submit against its own second tap.
   *
   * A ref rather than the state above, because two taps a frame apart both read
   * the same `submit` — React has not re-rendered in between — and both would
   * pass a state check. This one is written synchronously, so the second tap
   * sees it. The server's idempotency key is the backstop if a request escapes
   * anyway; this stops it from being sent in the first place.
   */
  const sending = useRef(false);

  /**
   * True while a text field has focus, which on a phone means the on-screen
   * keyboard is up.
   *
   * iOS pins a `position: fixed` element to the bottom of the visual viewport,
   * so the action bar rides up to sit on the keyboard — directly over the field
   * being typed into. Standing it down while typing is simpler and steadier than
   * measuring `visualViewport`, and costs nothing: the button is for when the
   * form is finished, and finishing it starts with dismissing the keyboard.
   *
   * The spacer below stays put, so the page does not jump as focus moves.
   */
  const [typing, setTyping] = useState(false);

  /**
   * A transition rather than a `quoting` flag of our own.
   *
   * `isQuoting` is then derived by React instead of being set at the top of the
   * effect, which is both one less piece of state to keep honest and the thing
   * that keeps the effect from writing state synchronously as it runs.
   */
  const [isQuoting, startQuote] = useTransition();

  /**
   * The exact payload, as a string.
   *
   * Doubles as the effect's dependency: a fresh array every render would re-quote
   * forever, and a length check would miss a swapped option. Serialising once
   * gives a value that changes when and only when the server's answer could.
   */
  const cartPayload = useMemo(() => JSON.stringify(toServerLines(items)), [items]);

  /**
   * One key per order attempt, which the server uses to collapse a repeat into
   * the order it already made.
   *
   * Minted on the first submit for a given cart and kept for as long as that
   * cart stands. That is what makes the two required behaviours fall out of one
   * rule: a failed submit creates nothing, so retrying after fixing an address
   * is the same attempt at the same order and keeps the key — and if that first
   * request in fact succeeded but its answer never arrived, the retry is handed
   * the original order rather than making a second one. Change the cart and it
   * is a different order, so the key goes with it; carrying it across would make
   * the server answer a new basket with the previous order.
   *
   * A ref rather than state: nothing renders from it, it must not be persisted
   * (a key in `localStorage` would outlive its order and turn next week's
   * identical basket into a replay of last week's), and computing it on demand
   * keeps `randomUUID` off the server render entirely.
   */
  const attempt = useRef<{ cart: string; key: string } | null>(null);

  function attemptKeyFor(cart: string): string {
    if (attempt.current?.cart !== cart) {
      attempt.current = { cart, key: crypto.randomUUID() };
    }
    return attempt.current.key;
  }

  const isEmpty = cartHydrated && items.length === 0;
  const ready = cartHydrated && draftHydrated;

  const selectedCity = cities.find((city) => city.code === cityCode) ?? null;

  /**
   * The saved pin, handed to the map as its opening camera.
   *
   * Read at the moment `PinMap` mounts, which is after the draft has come back
   * from `localStorage` — the map does not exist before a city is chosen. It is
   * snapshotted there and ignored afterwards: once the map is up it owns its own
   * camera, and feeding the stored value back in would fight every pan.
   */
  const restoredPoint: LatLng | null = lat !== null && lng !== null ? { lat, lng } : null;

  /**
   * The map's camera, once it has stopped for long enough to be worth asking
   * about. Panning fires `moveend` on every gesture; without this a customer
   * nudging their way down a street would spend a request per nudge.
   */
  const pinKey = type === 'DELIVERY' && lat !== null && lng !== null ? `${lat},${lng}` : '';
  const settledPinKey = useDebounced(pinKey, PIN_DEBOUNCE_MS);
  const pinSettling = pinKey !== settledPinKey;

  const handlePinChange = useCallback(
    (point: LatLng) => update({ lat: point.lat, lng: point.lng }),
    [update],
  );

  /**
   * Is the pin in a zone? Answered here for the pin's colour and for an
   * immediate warning, using the same ray-casting the server uses.
   *
   * This is a hint, never a decision. It cannot price anything, it does not
   * unlock the submit button, and the server runs the check again against zones
   * it has just read. A client that lied about it would gain a green pin and
   * nothing else.
   */
  const inside = useMemo(() => {
    if (type !== 'DELIVERY' || cityCode === null || lat === null || lng === null) return null;

    return zones.some(
      (zone) => zone.cityCode === cityCode && isPointInPolygon({ lat, lng }, zone.polygon),
    );
  }, [type, cityCode, lat, lng, zones]);

  /**
   * A city was chosen but the map has not said where it is pointing yet.
   *
   * Quoting through this window would ask about a pin belonging to the city the
   * customer just switched away from, and answer with a delivery fee for the
   * wrong town. Waiting is both cheaper and truthful.
   */
  const awaitingPin = type === 'DELIVERY' && cityCode !== null && lat === null;

  useEffect(() => {
    // `pinSettling` gates as well as debounces. Without it the first render
    // after the draft comes back from localStorage would fire a quote carrying
    // the debounced value rather than the restored one — asking about no
    // location at all, and answering "place the pin" to someone whose pin was
    // sitting there the whole time.
    if (!ready || isEmpty || awaitingPin || pinSettling) return;

    let cancelled = false;

    startQuote(async () => {
      try {
        const [pinLat, pinLng] = settledPinKey ? settledPinKey.split(',').map(Number) : [];

        const response = await requestQuote({
          type,
          cityCode: type === 'DELIVERY' ? cityCode : null,
          lat: pinLat ?? null,
          lng: pinLng ?? null,
          cart: JSON.parse(cartPayload) as CartLine[],
        });

        // A slow answer to a question the customer has already changed must not
        // overwrite the answer to the current one.
        if (cancelled) return;

        setResult(
          response.ok
            ? { status: 'ready', quote: response.quote, ordering: response.ordering }
            : { status: 'failed' },
        );
      } catch {
        if (!cancelled) setResult({ status: 'failed' });
      }
    });

    return () => {
      cancelled = true;
    };
  }, [
    ready,
    isEmpty,
    awaitingPin,
    pinSettling,
    type,
    cityCode,
    settledPinKey,
    cartPayload,
    retry,
    startQuote,
  ]);

  const quote = result?.status === 'ready' ? result.quote : null;

  /**
   * The server's answer wins over the one rendered with the page. Someone who
   * opened the menu at 22:50 and is still here at 23:05 has to find out that the
   * kitchen closed, without reloading.
   */
  const ordering = result?.status === 'ready' ? result.ordering : initialOrdering;

  const nameInvalid = customerName.trim().length < 2;
  const phoneInvalid = normalizeArmenianPhone(phone) === null;
  const addressInvalid = type === 'DELIVERY' && address.trim().length < 3;

  /** Amounts on screen are one gesture behind while the map is still settling. */
  const stale = isQuoting || pinSettling || awaitingPin;

  /**
   * The one amount the mobile action bar has room for: the total when the order
   * can be placed, and otherwise the subtotal, which a blocked quote still
   * knows. `null` only when the cart itself could not be priced.
   */
  const barAmount = quote === null ? null : quote.blocker === null ? quote.total : quote.subtotal;

  const inFlight = submit.status === 'sending';
  const finished = submit.status === 'placed';

  const canSubmit =
    ordering.canOrder &&
    !nameInvalid &&
    !phoneInvalid &&
    !addressInvalid &&
    !stale &&
    quote?.blocker === null &&
    !inFlight &&
    !finished;

  function touch(field: string) {
    setTouched((current) => ({ ...current, [field]: true }));
  }

  async function handleSubmit() {
    // Two guards for two different races. The ref catches the second tap of a
    // double-tap, which arrives before React has re-rendered anything; the
    // derived `canSubmit` catches a click on a button that should not have been
    // live at all.
    if (sending.current || !canSubmit || quote?.blocker !== null) return;

    sending.current = true;
    setSubmit({ status: 'sending' });

    try {
      const response = await placeOrder({
        type,
        customerName,
        phone,
        notes: notes.trim() || undefined,
        paymentMethod,
        idempotencyKey: attemptKeyFor(cartPayload),
        // What the customer is looking at as they press the button. The server
        // recomputes the total regardless and refuses if the two disagree.
        expectedTotal: quote.total,
        cart: toServerLines(items),
        ...(type === 'DELIVERY'
          ? {
              cityCode,
              address: address.trim(),
              landmark: landmark.trim() || undefined,
              lat,
              lng,
            }
          : {}),
      });

      if (!response.ok) {
        // Demo is a refusal by design, not a failure. Everything else keeps the
        // attempt key: nothing was created, so the retry is the same attempt.
        setSubmit(
          response.error.code === 'DEMO_MODE'
            ? { status: 'demo' }
            : { status: 'failed', error: response.error },
        );

        // A changed price or a withdrawn dish means the numbers on screen are
        // wrong as well as the order refused. Ask again so the customer decides
        // against the real ones.
        if (response.error.code === 'TOTAL_CHANGED' || response.error.code === 'CART_INVALID') {
          setRetry((n) => n + 1);
        }
        return;
      }

      /*
        Past this line an order exists. The cart is emptied here and nowhere
        else — not on submit, not optimistically — because a cart cleared for an
        order that was refused is a customer rebuilding their dinner from memory.

        For an online order it is emptied too, and that is the right call even
        though the money has not moved: the basket has become an order, the order
        is on the tracking page, and the way back from a failed payment is the
        retry button there rather than a rebuilt basket. Keeping the cart would
        invite a second order for the same food.

        `placed` is set first so the render below has a state that is neither
        the form nor the empty-cart screen while the navigation happens.
      */
      setSubmit({ status: 'placed' });
      clearCart();

      /*
        Off to the provider's own page, if there is one to go to.

        `location.assign`, not the router: this is a different origin once a real
        acquirer is wired up, and Next's router cannot navigate off the app. The
        redirect is not followed by anything on this screen — whatever happens
        next, the customer comes back to the tracking page through the return
        handler, which is the only thing that decides whether they paid.

        No redirect means the order is waiting and the session could not be
        opened. The tracking page is the right destination for that too: it says
        so, and offers to try again.
      */
      if (response.redirectUrl) {
        window.location.assign(response.redirectUrl);
        return;
      }

      router.replace(`/order/${response.trackingToken}`);
    } catch {
      setSubmit({ status: 'failed', error: { code: 'UNAVAILABLE' } });
    } finally {
      // Released even on success: the screen is navigating away, and leaving it
      // latched would strand anyone the navigation failed for.
      sending.current = false;
    }
  }

  function selectCity(next: CityCode) {
    if (next === cityCode) return;

    /*
      The pin belongs to the city it was dropped in. Cities are far enough apart
      that a point saved for one is never inside a zone of another, so carrying
      it across would quote a delivery to the wrong place — or, worse, look like
      a valid address. Dropping it lets the map recentre and report where it
      actually is.
    */
    update({ cityCode: next, lat: null, lng: null });
  }

  return (
    <div className="px-4 pt-24 pb-8 sm:px-6 sm:pt-28 lg:px-8">
      <header className="mx-auto max-w-5xl">
        <h1 className="text-hero font-bold tracking-tight">{t('title')}</h1>
      </header>

      {/* Checked before `isEmpty`: the cart has just been emptied on purpose,
          and the tracking page is one navigation away. */}
      {finished ? (
        <Placed label={t('submitting')} />
      ) : !ready ? (
        <LoadingSkeleton />
      ) : isEmpty ? (
        <EmptyCart />
      ) : (
        <div className="mx-auto mt-8 grid max-w-5xl gap-8 lg:mt-12 lg:grid-cols-[1fr_21rem] lg:items-start lg:gap-10">
          {/* React's focus events bubble, so one pair here covers every field. */}
          <div
            className="space-y-8"
            onFocus={(event) => {
              if (isTextEntry(event.target)) setTyping(true);
            }}
            onBlur={(event) => {
              if (isTextEntry(event.target)) setTyping(false);
            }}
          >
            {IS_DEMO && <Notice tone="info">{td('orderDisabled')}</Notice>}

            {!ordering.canOrder && (
              <Notice tone="warning">
                {ordering.isPaused ? (pausedMessage ?? te('paused')) : te('closed')}
              </Notice>
            )}

            <Section id="method" title={t('methodSection')} group>
              <div className="grid grid-cols-2 gap-3">
                <MethodCard
                  icon={Bike}
                  label={t('delivery')}
                  hint={t('deliveryHint')}
                  active={type === 'DELIVERY'}
                  onClick={() => update({ type: 'DELIVERY' })}
                />
                <MethodCard
                  icon={Store}
                  label={t('pickup')}
                  hint={t('pickupHint')}
                  active={type === 'PICKUP'}
                  onClick={() => update({ type: 'PICKUP' })}
                />
              </div>
            </Section>

            <Section id="contact" title={t('contactSection')}>
              <Field
                id="customerName"
                label={t('name')}
                error={touched.customerName && nameInvalid ? te('invalidName') : null}
              >
                <input
                  id="customerName"
                  value={customerName}
                  onChange={(event) => update({ customerName: event.target.value })}
                  onBlur={() => touch('customerName')}
                  placeholder={t('namePlaceholder')}
                  autoComplete="name"
                  maxLength={80}
                  aria-invalid={touched.customerName && nameInvalid}
                  className={fieldClass}
                />
              </Field>

              <Field
                id="phone"
                label={t('phone')}
                error={touched.phone && phoneInvalid ? te('invalidPhone') : null}
              >
                <input
                  id="phone"
                  value={phone}
                  onChange={(event) => update({ phone: event.target.value })}
                  onBlur={() => touch('phone')}
                  placeholder={t('phonePlaceholder')}
                  // `tel`, not `number`: a number input strips the leading zero of
                  // `093...` and offers a spinner nobody wants on a phone number.
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  maxLength={20}
                  aria-invalid={touched.phone && phoneInvalid}
                  className={fieldClass}
                />
              </Field>
            </Section>

            {type === 'DELIVERY' ? (
              <Section id="address" title={t('addressSection')} group>
                <div className="grid gap-3 sm:grid-cols-2">
                  {cities.map((city) => (
                    <button
                      key={city.code}
                      type="button"
                      aria-pressed={cityCode === city.code}
                      disabled={!city.canDeliver}
                      onClick={() => selectCity(city.code)}
                      className={cn(
                        'flex min-h-11 items-center justify-center rounded-2xl border px-4 py-3 text-sm font-semibold transition-colors',
                        'disabled:cursor-not-allowed disabled:opacity-40',
                        cityCode === city.code
                          ? 'border-lime-500/60 bg-lime-500/10'
                          : 'bg-elevated border-white/8 hover:border-white/16',
                      )}
                    >
                      {city.name}
                    </button>
                  ))}
                </div>

                {selectedCity && (
                  <>
                    <Field
                      id="address"
                      label={t('address')}
                      error={touched.address && addressInvalid ? te('invalidAddress') : null}
                    >
                      <input
                        id="address"
                        value={address}
                        onChange={(event) => update({ address: event.target.value })}
                        onBlur={() => touch('address')}
                        placeholder={t('addressPlaceholder')}
                        autoComplete="street-address"
                        maxLength={200}
                        aria-invalid={touched.address && addressInvalid}
                        className={fieldClass}
                      />
                    </Field>

                    <PinMap
                      city={selectedCity}
                      zones={zones}
                      initialPoint={restoredPoint}
                      onChange={handlePinChange}
                      inside={inside}
                    />

                    <Field id="landmark" label={t('landmark')} error={null}>
                      <input
                        id="landmark"
                        value={landmark}
                        onChange={(event) => update({ landmark: event.target.value })}
                        placeholder={t('landmarkPlaceholder')}
                        maxLength={200}
                        className={fieldClass}
                      />
                      <p className="text-muted-foreground text-xs">{t('landmarkHint')}</p>
                    </Field>
                  </>
                )}
              </Section>
            ) : (
              <Section id="pickup" title={t('pickupAddress')}>
                <div className="bg-card rounded-2xl border border-white/6 p-5">
                  <p className="font-semibold">{pickup.address}</p>
                  <a
                    href={`mailto:${pickup.contact}`}
                    className="text-muted-foreground hover:text-foreground mt-1 inline-block text-sm transition-colors"
                  >
                    {pickup.contact}
                  </a>
                </div>
              </Section>
            )}

            {/*
              Driven by what the server said it can take, not by the enum.
              `ONLINE` appears only where a provider is configured: offering a
              method the server would refuse is how a customer finds a dead end
              by pressing it, having already filled in the form above.
            */}
            <Section id="payment" title={t('paymentSection')} group>
              <div className="grid gap-3 sm:grid-cols-2">
                {paymentMethods.map((method) => (
                  <MethodCard
                    key={method}
                    icon={PAYMENT_ICONS[method] ?? Banknote}
                    label={tp(method)}
                    hint={tp(`${method}_HINT`)}
                    active={paymentMethod === method}
                    onClick={() => update({ paymentMethod: method })}
                  />
                ))}
              </div>
            </Section>

            <Section id="notes" title={t('notes')}>
              <textarea
                id="notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder={t('notesPlaceholder')}
                rows={3}
                maxLength={500}
                className={cn(fieldClass, 'h-auto resize-none py-3 leading-relaxed')}
              />
            </Section>

            {result?.status === 'failed' && (
              <Notice tone="warning">
                <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  {te('generic')}
                  <button
                    type="button"
                    onClick={() => setRetry((n) => n + 1)}
                    className="min-h-11 font-semibold underline underline-offset-4"
                  >
                    {tcom('retry')}
                  </button>
                </span>
              </Notice>
            )}

            {/*
              Two ways to learn the pin is out of range, and they do different
              jobs. This one is instant, from the polygon check in the browser,
              so dragging past the edge of a zone says so immediately. The one
              below is the server's, and it is the one that decides — it arrives
              a moment later and carries the amounts.
            */}
            {inside === false && quote?.blocker?.code !== 'OUT_OF_ZONE' && (
              <Notice tone="warning">{te('outOfZone')}</Notice>
            )}

            {quote?.blocker && quote.blocker.code !== 'EMPTY_CART' && (
              <Notice tone="warning">{blockerMessage(quote.blocker, te, locale)}</Notice>
            )}

            {/* The preview refused on purpose. Phrased as a state of the demo
                rather than as a failure, because nothing failed — and because
                "your order could not be sent" would leave someone wondering
                whether to try again. */}
            {submit.status === 'demo' && <Notice tone="info">{td('orderNotSent')}</Notice>}

            {submit.status === 'failed' && (
              <Notice tone="warning">{submitErrorMessage(submit.error, te, locale)}</Notice>
            )}

            {/* On a narrow screen the summary belongs in the flow, after the
                fields it summarises. On a wide one it is the sidebar instead. */}
            <OrderSummary items={items} quote={quote} stale={stale} className="lg:hidden" />

            <div className="hidden lg:block">
              <SubmitButton
                disabled={!canSubmit}
                busy={inFlight}
                label={inFlight ? t('submitting') : t('submit')}
                onClick={handleSubmit}
              />
            </div>
          </div>

          <aside className="hidden lg:sticky lg:top-28 lg:block">
            <OrderSummary items={items} quote={quote} stale={stale} />
          </aside>
        </div>
      )}

      {/* The mobile action bar. Fixed, so it floats over the end of the page —
          the spacer below reserves its height in normal flow. */}
      {ready && !isEmpty && !finished && (
        <>
          <div
            aria-hidden
            className="lg:hidden"
            // The bar measures ~114px: its padding, the total row and a 56px
            // button. Reserving a little more than that keeps the last field
            // clear of it on a notched phone as well as a flat one. The reserve
            // is the constant rather than `env()` because this spacer is in
            // normal flow — see `--bottom-inset-reserve`.
            style={{ height: 'calc(7.5rem + var(--bottom-inset-reserve))' }}
          />
          <div
            hidden={typing}
            className="glass fixed inset-x-0 bottom-0 z-40 border-t border-white/8 p-3 lg:hidden"
            style={{
              paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
              paddingLeft: 'max(0.75rem, env(safe-area-inset-left))',
              paddingRight: 'max(0.75rem, env(safe-area-inset-right))',
            }}
          >
            {/*
              The label follows the number rather than the other way round.
              A blocked quote has no total, but it still carries what the food
              costs — and a bar that showed a shimmering nothing while the
              customer worked out why the button was grey was the worst of both:
              no amount, and a promise that one was loading when it was not.
            */}
            <div className="mb-2 flex items-baseline justify-between px-2">
              <span className="text-muted-foreground text-sm">
                {quote?.blocker === null ? tc('total') : tc('subtotal')}
              </span>
              {barAmount !== null ? (
                <Price amount={barAmount} className="text-lg font-bold" />
              ) : result === null ? (
                <Skeleton className="h-5 w-20" />
              ) : (
                <span className="text-muted-foreground text-lg">—</span>
              )}
            </div>
            <SubmitButton
              disabled={!canSubmit}
              busy={inFlight}
              label={inFlight ? t('submitting') : t('submit')}
              onClick={handleSubmit}
            />
          </div>
        </>
      )}
    </div>
  );
}

// --- Pieces ---------------------------------------------------------------

const fieldClass =
  'bg-elevated h-12 w-full rounded-2xl border border-white/8 px-4 text-base transition-colors outline-none placeholder:text-muted-foreground focus-visible:border-lime-500/60 aria-invalid:border-destructive/70';

/**
 * A titled block of the form.
 *
 * `group` takes the heading as its accessible name, so a screen reader
 * announcing one of the choice buttons inside says which question it answers.
 */
function Section({
  id,
  title,
  group,
  children,
}: {
  id: string;
  title: string;
  group?: boolean;
  children: React.ReactNode;
}) {
  const headingId = `${id}-heading`;

  return (
    <section className="space-y-4" aria-labelledby={headingId}>
      <h2 id={headingId} className="text-lg font-bold">
        {title}
      </h2>
      {group ? (
        // The spacing lives here rather than on the section, because wrapping the
        // children moves them out of the section's own `space-y`.
        <div role="group" aria-labelledby={headingId} className="space-y-4">
          {children}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Field({
  id,
  label,
  error,
  children,
}: {
  id: string;
  label: string;
  error: string | null;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="text-muted-foreground text-sm font-medium">
        {label}
      </label>
      {children}
      {/* `aria-live` so a message appearing on blur is announced rather than
          only seen. */}
      <p aria-live="polite" className="text-destructive min-h-4 text-xs">
        {error}
      </p>
    </div>
  );
}

function MethodCard({
  icon: Icon,
  label,
  hint,
  active,
  onClick,
}: {
  icon: typeof Bike;
  label: string;
  hint: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'flex min-h-11 flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors',
        active
          ? 'border-lime-500/60 bg-lime-500/10'
          : 'bg-elevated border-white/8 hover:border-white/16',
      )}
    >
      <Icon className={cn('size-5', active ? 'text-lime-400' : 'text-muted-foreground')} />
      <span className="mt-1 font-semibold">{label}</span>
      <span className="text-muted-foreground text-xs leading-snug">{hint}</span>
    </button>
  );
}

function SubmitButton({
  disabled,
  busy,
  label,
  onClick,
}: {
  disabled: boolean;
  busy: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      // Announced as busy rather than only shown as busy: the disabled state and
      // the spinner both say "wait" to someone looking at the screen and nothing
      // at all to someone listening to it.
      aria-busy={busy}
      onClick={onClick}
      className={cn(
        'flex h-14 w-full items-center justify-center gap-2 rounded-2xl text-base font-bold transition-colors',
        disabled
          ? 'bg-elevated text-muted-foreground cursor-not-allowed'
          : 'text-primary-foreground shadow-lime bg-lime-500 hover:bg-lime-400 active:bg-lime-600',
      )}
    >
      {busy && <Loader2 className="size-4 animate-spin" />}
      {label}
    </button>
  );
}

/**
 * The beat between the order existing and the tracking page appearing.
 *
 * Short, but it must not be blank and it must not be the empty-cart screen —
 * the cart is empty at this point precisely because the order succeeded.
 */
function Placed({ label }: { label: string }) {
  return (
    <div
      aria-live="polite"
      className="text-muted-foreground mx-auto mt-16 flex max-w-md flex-col items-center gap-4"
    >
      <Loader2 className="size-8 animate-spin" />
      <p className="text-sm">{label}</p>
    </div>
  );
}

function Notice({ tone, children }: { tone: 'info' | 'warning'; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-2xl border p-4 text-sm',
        tone === 'warning'
          ? 'border-destructive/30 bg-destructive/10 text-destructive'
          : 'text-muted-foreground border-white/8 bg-white/4',
      )}
    >
      <Info className="mt-0.5 size-4 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}

function EmptyCart() {
  const t = useTranslations('cart');

  return (
    <div className="mx-auto mt-16 flex max-w-md flex-col items-center gap-4 text-center">
      <div className="bg-elevated flex size-20 items-center justify-center rounded-full">
        <ShoppingBag className="text-muted-foreground size-8" />
      </div>
      <div>
        <p className="text-lg font-semibold">{t('empty')}</p>
        <p className="text-muted-foreground mt-1 text-sm">{t('emptyHint')}</p>
      </div>
      <Link
        href="/menu"
        className="bg-elevated mt-2 flex min-h-11 items-center rounded-full border border-white/8 px-6 text-sm font-semibold transition-colors hover:bg-white/8"
      >
        {t('browseMenu')}
      </Link>
    </div>
  );
}

/**
 * Shown until both stores have read `localStorage`.
 *
 * The cart cannot be known on the server, so the first paint has nothing to show
 * either way. Rendering the real form and then swapping in a restored draft
 * would flash — and would be a hydration mismatch besides.
 */
function LoadingSkeleton() {
  return (
    <div className="mx-auto mt-8 grid max-w-5xl gap-8 lg:mt-12 lg:grid-cols-[1fr_21rem] lg:gap-10">
      <div className="space-y-6">
        <Skeleton className="h-24 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-12 rounded-2xl" />
        <Skeleton className="h-28 rounded-2xl" />
      </div>
      <Skeleton className="hidden h-64 rounded-3xl lg:block" />
    </div>
  );
}

// --- Helpers --------------------------------------------------------------

/** Does focusing this element raise the on-screen keyboard? */
function isTextEntry(target: EventTarget): boolean {
  return target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
}

/**
 * A value that lags behind, so bursts of change cost one reaction instead of ten.
 *
 * Local to checkout because it is the map that needs it: `moveend` fires on
 * every gesture, and a customer nudging their way along a street would otherwise
 * spend a server round trip per nudge.
 */
function useDebounced<T>(value: T, delay: number): T {
  const [settled, setSettled] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return settled;
}

/**
 * Why the order cannot go through, in the customer's language.
 *
 * `CART_INVALID` names the dish when the server identified one: "«Beef Burger»
 * has run out" tells someone what to do, where "prices have changed" only tells
 * them something is wrong.
 */
function blockerMessage(
  blocker: CheckoutBlocker,
  te: ReturnType<typeof useTranslations<'errors'>>,
  locale: Locale,
): string {
  switch (blocker.code) {
    case 'CITY_REQUIRED':
      return te('cityRequired');
    case 'LOCATION_REQUIRED':
      return te('locationRequired');
    case 'OUT_OF_ZONE':
      return te('outOfZone');
    case 'BELOW_MIN_ORDER':
      return te('belowMinOrder', {
        minOrder: formatAmd(blocker.minOrder, locale),
        missing: formatAmd(blocker.missing, locale),
      });
    case 'CART_INVALID': {
      const named = blocker.issues.find((issue) => issue.productName);
      return named?.productName
        ? te('unavailableItem', { name: pickLocalized(named.productName, locale) })
        : te('priceChanged');
    }
    case 'EMPTY_CART':
      return te('emptyCart');
  }
}

/**
 * Why the order was refused, in the customer's language.
 *
 * Every branch of `PlaceOrderError` is named. Several of them cannot happen from
 * this form — the payment method comes from the enabled list, there is no
 * pre-order field to produce a bad schedule, and our own payload validates —
 * but a refusal the screen has no words for renders as nothing at all, which is
 * how a customer ends up pressing a button that silently does nothing.
 */
function submitErrorMessage(
  error: PlaceOrderError,
  te: ReturnType<typeof useTranslations<'errors'>>,
  locale: Locale,
): string {
  switch (error.code) {
    case 'ORDERING_CLOSED':
      return error.isPaused ? te('paused') : te('closed');
    case 'PAYMENT_METHOD_UNAVAILABLE':
      return te('paymentUnavailable');
    case 'SCHEDULE_INVALID':
      return te('scheduleInvalid');
    case 'CART_INVALID': {
      const named = error.issues.find((issue) => issue.productName);
      return named?.productName
        ? te('unavailableItem', { name: pickLocalized(named.productName, locale) })
        : te('priceChanged');
    }
    case 'DELIVERY_UNAVAILABLE':
      return blockerMessage(error.blocker, te, locale);
    case 'TOTAL_CHANGED':
      return te('totalChanged', { total: formatAmd(error.total, locale) });
    // Demo has its own notice; if it ever reaches here, saying nothing would be
    // worse than saying something general.
    // Its own sentence, because "something went wrong" would have them pressing
    // the button again — which is the one thing that cannot help here.
    case 'TOO_MANY_ORDERS':
      return te('tooManyOrders');
    case 'DEMO_MODE':
    case 'INVALID_REQUEST':
    case 'UNAVAILABLE':
      return te('generic');
  }
}
