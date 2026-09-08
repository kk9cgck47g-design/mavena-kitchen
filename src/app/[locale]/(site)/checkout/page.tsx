import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';

import { CheckoutScreen } from '@/components/checkout/checkout-screen';
import { isLocale, pickLocalized, type Locale } from '@/lib/i18n/locales';
import { RESTAURANT } from '@/lib/restaurant';
import { availablePaymentMethods } from '@/lib/schemas/checkout';
import { isOnlinePaymentOffered } from '@/server/payments/registry';
import { getOrderingWindow } from '@/server/services/opening-hours';
import { getActiveCities, getActiveDeliveryZones, getSettings } from '@/server/services/settings';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('checkout');
  return {
    title: t('title'),
    // Nothing here should ever appear in a search result or a shared preview:
    // it is a form about one person's order, useful to nobody else.
    robots: { index: false, follow: false },
  };
}

/**
 * Checkout.
 *
 * The page itself only reads: settings, cities, zones and whether the kitchen is
 * taking orders at all. Everything interactive lives in `CheckoutScreen`,
 * because the cart it is checking out is in `localStorage` and therefore cannot
 * be known on the server.
 *
 * No amount is computed here. The screen asks the server for a quote and renders
 * that; see `server/services/checkout-quote.ts` for why.
 */
export default async function CheckoutPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: raw } = await params;
  const locale: Locale = isLocale(raw) ? raw : 'hy';

  const [settings, cities, zones] = await Promise.all([
    getSettings(),
    getActiveCities(),
    getActiveDeliveryZones(),
  ]);

  /**
   * A city with no active zone cannot receive a delivery, whatever the city
   * table says. Offering it would let someone pick a city, drop a pin and only
   * then be told the whole city is unreachable.
   */
  const deliverable = new Set(zones.map((zone) => zone.cityCode));

  return (
    <CheckoutScreen
      ordering={getOrderingWindow(settings.workingHours, settings.isAcceptingOrders)}
      pausedMessage={settings.pausedMessage ? pickLocalized(settings.pausedMessage, locale) : null}
      cities={cities.map((city) => ({
        code: city.code,
        name: pickLocalized(city.name, locale),
        center: { lat: city.centerLat, lng: city.centerLng },
        defaultZoom: city.defaultZoom,
        canDeliver: deliverable.has(city.code),
      }))}
      /*
        The polygons go to the browser, which is not a leak: they are already
        drawn in full on `/contacts`, because "do you deliver to me?" is a
        question a customer should be able to answer before building a cart.
        Having them here is what lets the pin turn red the moment it leaves a
        zone, instead of a round trip later.
      */
      zones={zones.map((zone) => ({
        id: zone.id,
        cityCode: zone.cityCode,
        name: pickLocalized(zone.name, locale),
        polygon: zone.polygon,
      }))}
      pickup={{
        // Read from the source-controlled identity rather than the settings row.
        // The settings table is editable at runtime, and the pickup block is the
        // one place a stray edit would put a contact detail in front of every
        // visitor — so the public preview shows only what is committed here.
        address: pickLocalized(RESTAURANT.address, locale),
        contact: RESTAURANT.email,
      }}
      /*
        Decided here because only the server can decide it: online payment is
        real exactly where a provider is configured, which is a property of the
        deployment rather than of the browser. The same function answers the
        question again when the order is placed, so this is what to draw and not
        what is permitted.
      */
      paymentMethods={availablePaymentMethods(isOnlinePaymentOffered())}
    />
  );
}
