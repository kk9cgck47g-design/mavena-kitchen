/**
 * Dish photography for the demo menu.
 *
 * THIS IS THE ONLY FILE THAT KNOWS WHERE DISH PHOTOS COME FROM. Point the ids
 * somewhere else — a different library, or `dishPhoto` at Cloudinary — and
 * reseed: no component changes, no layout changes.
 *
 * The images are Unsplash's, used under the Unsplash Licence, which permits
 * commercial and non-commercial use without permission or attribution. Nothing
 * here is a photograph of anybody's actual food, which is the point: a demo
 * menu that borrowed a real restaurant's shoot would be borrowing the one asset
 * a restaurant actually owns.
 *
 * Every photo was reviewed on the actual charcoal background before being kept,
 * against three criteria: a dark or neutral backdrop so a card does not punch a
 * bright rectangle through the page, warm directional light, and shallow depth
 * of field. The first pass was chosen from search-result thumbnails and several
 * picks turned out to be white plates and red-checked paper — obvious once seen
 * in place, invisible from a filename. Anything replacing these should be
 * checked the same way: rendered on #0A0A09, not judged from a search page.
 *
 * All URLs go through one builder, so crop, quality and format are identical
 * across the whole menu — the other half of looking like a single shoot.
 */

const UNSPLASH = 'https://images.unsplash.com/photo-';

/** One crop, one quality, one format for every dish in the menu. */
export function dishPhoto(photoId: string, width = 1200): string {
  return `${UNSPLASH}${photoId}?auto=format&fit=crop&crop=entropy&w=${width}&q=72`;
}

/**
 * A flat dark tile used as the `blurDataURL` for every dish image. Uniform on
 * purpose: the placeholder should read as "the photo is arriving", not as a
 * different-coloured flash before each one.
 */
export const DISH_BLUR_DATA_URL =
  'data:image/svg+xml;base64,' +
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#1a1815"/></svg>`,
  ).toString('base64');

/** Dish slug → Unsplash photo id. */
export const PLACEHOLDER_PHOTOS: Record<string, string> = {
  // Burgers
  'burger-beef': '1568901346375-23c9450c58cd',
  'cheeseburger-beef': '1586190848861-99aa4a171e90',
  'double-cheeseburger': '1572802419224-296b0aeee0d9',
  'angus-burger': '1550547660-d9450f859349',
  'chicken-burger': '1499028344343-cd173ffc68a9',
  'chicken-burger-classic': '1571091655789-405eb7a3a3a8',
  'chicken-cheeseburger': '1596662951482-0c4ba74a6df6',
  'chicken-cheeseburger-double': '1607013251379-e6eecfffe234',
  'chicken-burger-deluxe': '1565299507177-b0ac66763828',

  // Hot dogs
  'hot-dog-lite': '1678033382919-fa907632fdda',
  'hot-dog': '1607103071568-159bb70b4bf0',
  longer: '1657614985416-86232e1905a1',

  // Rolls
  'chicken-roll': '1719282666354-38af51d0ba24',
  'chicken-roll-duo': '1760888548893-bc2f7e09e972',

  // Chicken
  'chicken-strips': '1647724394693-2c93af726785',
  'chicken-wings': '1735353783227-80b22ef618d9',
  'chicken-drumsticks': '1730900737724-5b752e1ed3dd',
  nuggets: '1690519315596-460e394a9168',

  // Potato
  fries: '1676566399758-51b0d3927d48',
  'potato-wedges': '1714651620426-1ae32ca6b418',

  // Combo
  'mavena-box': '1608767221051-2b9d18f35a2f',
  'beef-burger-combo': '1551782450-a2132b4ba21d',
  'mini-basket': '1556710986-4a70434a76c0',
  'basket-combo': '1645371958635-88dd6c8e1be7',

  // Salads, sauces, drinks, dessert
  salad: '1765751077345-4dbeb15244c4',
  sauce: '1562639275-3509e6674658',
  'soft-drinks': '1629186235045-80d4147d90dc',
  'coffee-tea': '1613158556069-e7d8eae76214',
  'ice-cream': '1580915411954-282cb1b0d780',
};

/**
 * Hero shot.
 *
 * Dark, but not empty — the two failure modes pull in opposite directions. A
 * bright product shot leaves the headline, the status dot and the logo all
 * fighting for contrast; a genuinely black frame plus the scrims needed for text
 * hides the food altogether and the page reads as an empty void with type on it.
 * This one is a lit subject against a dark ground, which survives both. Warm
 * bokeh behind it does the work the concept's neon sign was reaching for —
 * evening, appetite, a place that is open — without the cliché or the contrast
 * problems.
 */
export const HERO_PHOTO = '1615297928064-24977384d0da';

export function heroPhoto(width = 1800): string {
  return `${UNSPLASH}${HERO_PHOTO}?auto=format&fit=crop&crop=entropy&w=${width}&q=80`;
}

/** Wide editorial shot for the About page. */
export const ABOUT_PHOTO = '1608767221051-2b9d18f35a2f';

export function aboutPhoto(width = 1800): string {
  return `${UNSPLASH}${ABOUT_PHOTO}?auto=format&fit=crop&crop=entropy&w=${width}&q=80`;
}
