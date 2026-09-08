import type { LocalizedText } from '@/lib/i18n/locales';

/**
 * Public identity and portfolio-safe contact details.
 *
 * Mavena Kitchen is fictional. The reserved `.example` address cannot belong to
 * a real business, social profiles stay absent, and the pickup wording makes it
 * explicit that the map pin is demonstration data rather than an operating
 * restaurant somebody could visit.
 */
export const RESTAURANT = {
  name: 'Mavena Kitchen',
  /** Used where the two words are set on separate lines. */
  nameParts: ['Mavena', 'Kitchen'] as const,
  orderCodePrefix: 'MK',

  tagline: {
    hy: 'Բուրգերներ, որոնք արժե սպասել',
    ru: 'Бургеры, ради которых стоит подождать',
    en: 'Burgers worth the wait',
  } satisfies LocalizedText,

  /** Reserved example domain: visibly safe demo contact, never a real inbox. */
  email: 'hello@mavena.example',

  /** Fictional presentation copy; no street or real premises are claimed. */
  address: {
    hy: 'Երևան — ցուցադրական ինքնավերցման վայր',
    ru: 'Ереван — демонстрационная точка самовывоза',
    en: 'Yerevan — demo pickup location',
  } satisfies LocalizedText,

  /** Demo map pin inside the central delivery polygon. */
  location: { lat: 40.1834, lng: 44.5119 },

  /** No invented social accounts: absent until a portfolio-owned account exists. */
  instagram: null as string | null,
  instagramUrl: null as string | null,

  /*
    Opening hours are deliberately NOT here. They live on the settings row and
    are edited in the panel, because the same value decides whether ordering is
    open. Read `todaysHours(settings.workingHours)` instead.
  */

  cities: ['YEREVAN'] as const,
} as const;

/** Where the restaurant delivers, for copy that names it. */
export const SERVED_CITIES: LocalizedText = {
  hy: 'Երևան',
  ru: 'Ереван',
  en: 'Yerevan',
};
