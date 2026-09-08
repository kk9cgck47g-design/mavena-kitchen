import { demoMenu, demoUuid } from '@/server/demo/catalog';
import type { OrderEventView, OrderView } from '@/lib/order-types';
import type { MenuProduct } from '@/lib/menu-types';
import type { OrderStatus, PaymentMethod, PaymentStatus } from '@/lib/domain';
import { PUBLIC_CODE_PREFIX } from '@/server/services/order-codes';

/**
 * A kitchen's worth of orders that never existed.
 *
 * The published preview has no database, so the admin panel has nothing to
 * show — and an admin panel with nothing in it demonstrates nothing. These are
 * built from the same `demoMenu()` the storefront serves, so dishes, prices and
 * option names stay consistent across the portfolio preview.
 *
 * Deterministic by construction: ids and tracking tokens come from
 * `demoUuid`, and timestamps are offsets from the moment of the request. Two
 * renders a second apart therefore agree about everything except the clock,
 * and nothing here is ever written anywhere.
 *
 * Status changes made in the demo panel are not applied here. They live in a
 * client-side store (`stores/demo-admin.ts`) that layers over this list, which
 * is what keeps the preview incapable of persisting anything at all.
 */

interface DemoSeed {
  key: string;
  status: OrderStatus;
  type: 'DELIVERY' | 'PICKUP';
  /** How long ago the order was placed. Drives both the list order and the dashboard. */
  minutesAgo: number;
  customerName: string;
  phone: string;
  address?: string;
  landmark?: string;
  notes?: string;
  paymentMethod: PaymentMethod;
  /**
   * Only meaningful for an `ONLINE` order. Left off everywhere else, where the
   * money arrives with the courier and the order carries `PENDING` until it does.
   */
  paymentStatus?: PaymentStatus;
  /** Dish slugs and quantities. Resolved against the live demo menu. */
  lines: Array<[slug: string, quantity: number]>;
}

/*
  Every customer below is invented, and invented visibly.

  These rows are rendered by the public demo panel, which opens without a login,
  so anyone can read them. A full name beside a real-looking mobile number and a
  street address with a flat number is the shape of a genuine customer record —
  and it stays that shape whether or not the person exists. Recognisable is
  exactly what it must not be.

  So: a given name and an initial, which is how an order list is anonymised in
  practice and still reads naturally on the board; addresses on a street that
  says it is a demo; and numbers on `+374 00`, which is not an allocated
  Armenian mobile prefix and therefore cannot reach a handset. They stay valid
  input for `normalizeArmenianPhone`, because the panel's search and the
  Telegram ticket both have to keep working on them.

  Armenian script is kept deliberately: these strings are the only place the
  admin board is exercised with the alphabet most of its real content is in.
*/

/**
 * Chosen to cover the whole board: one of every live status, both order types,
 * every payment method, an order with a note and one without, and the two
 * terminal states. This makes every important panel state inspectable.
 *
 * `h` is the online order nobody has paid for yet, and it is here for the same
 * reason the rest are: the panel needs to make that state recognisable on sight.
 * It is also the demo's entry point into the payment
 * flow — the tracking page for it offers the fake payment page, and the whole
 * walk from there back to a paid order happens in the browser's own session. See
 * `stores/demo-payment.ts`.
 */
const SEEDS: DemoSeed[] = [
  {
    key: 'h',
    status: 'AWAITING_PAYMENT',
    type: 'DELIVERY',
    minutesAgo: 1,
    customerName: 'Գոռ Մ.',
    phone: '+37400000101',
    address: 'Դեմո փողոց 9',
    paymentMethod: 'ONLINE',
    paymentStatus: 'PENDING',
    lines: [
      ['cheeseburger-beef', 1],
      ['fries', 1],
    ],
  },
  {
    key: 'a',
    status: 'NEW',
    type: 'DELIVERY',
    minutesAgo: 3,
    customerName: 'Անի Գ.',
    phone: '+37400000102',
    address: 'Դեմո փողոց 14, բն. 12',
    landmark: 'Դեղատան դիմաց',
    notes: 'Առանց սոխի',
    paymentMethod: 'CASH',
    lines: [
      ['burger-beef', 2],
      ['fries', 1],
    ],
  },
  {
    key: 'b',
    status: 'NEW',
    type: 'PICKUP',
    minutesAgo: 8,
    customerName: 'Դավիթ Ս.',
    phone: '+37400000103',
    paymentMethod: 'CARD_ON_DELIVERY',
    lines: [['chicken-strips', 1]],
  },
  {
    key: 'c',
    status: 'CONFIRMED',
    type: 'DELIVERY',
    minutesAgo: 17,
    customerName: 'Մարիամ Պ.',
    phone: '+37400000104',
    address: 'Դեմո փողոց 3',
    landmark: 'Կանաչ դարպաս, երկրորդ մուտք',
    paymentMethod: 'CARD_ON_DELIVERY',
    lines: [
      ['cheeseburger-beef', 1],
      ['soft-drinks', 2],
    ],
  },
  {
    key: 'd',
    status: 'PREPARING',
    type: 'DELIVERY',
    minutesAgo: 26,
    customerName: 'Արամ Հ.',
    phone: '+37400000105',
    address: 'Դեմո փողոց 21',
    notes: 'Զանգահարել հասնելուց առաջ',
    paymentMethod: 'CASH',
    lines: [
      ['hot-dog', 2],
      ['fries', 2],
    ],
  },
  {
    key: 'e',
    status: 'DELIVERING',
    type: 'DELIVERY',
    minutesAgo: 44,
    customerName: 'Նարե Ա.',
    phone: '+37400000106',
    address: 'Դեմո փողոց 7',
    paymentMethod: 'CASH',
    lines: [['burger-beef', 1]],
  },
  {
    key: 'f',
    status: 'COMPLETED',
    type: 'PICKUP',
    minutesAgo: 96,
    customerName: 'Տիգրան Կ.',
    phone: '+37400000107',
    paymentMethod: 'CASH',
    lines: [
      ['chicken-wings', 1],
      ['soft-drinks', 1],
    ],
  },
  {
    key: 'g',
    status: 'CANCELLED',
    type: 'DELIVERY',
    minutesAgo: 133,
    customerName: 'Սոնա Մ.',
    phone: '+37400000108',
    address: 'Դեմո փողոց 5',
    paymentMethod: 'CASH',
    lines: [['burger-beef', 1]],
  },
];

/** Flat lookup over the demo menu, so a seed can name a dish by slug. */
function productsBySlug(): Map<string, MenuProduct> {
  return new Map(
    demoMenu()
      .flatMap((category) => category.products)
      .map((product) => [product.slug, product]),
  );
}

/** The delivery fee the seeded central zone charges. Matches `delivery-data.ts`. */
const DEMO_DELIVERY_FEE = 400;
const DEMO_ETA_DELIVERY = 25;
const DEMO_ETA_PICKUP = 25;

/** Kept apart from the real `PAYMENT_WINDOW_MINUTES`: this one only has to look plausible. */
const DEMO_PAYMENT_WINDOW_MINUTES = 20;

/**
 * The tracking token for a demo order.
 *
 * Prefixed and derived, never random: the storefront's tracking screen has to
 * resolve these, and a token that changed between two requests would break the
 * link the panel just showed.
 */
export function demoTrackingToken(key: string): string {
  return `demo-${demoUuid(`order:${key}`)}`;
}

export function isDemoTrackingToken(token: string): boolean {
  return token.startsWith('demo-');
}

export function demoOrders(now: Date = new Date()): OrderView[] {
  const bySlug = productsBySlug();

  return SEEDS.map((seed) => {
    const items = seed.lines.flatMap(([slug, quantity]) => {
      const product = bySlug.get(slug);
      if (!product) return [];

      const unitPrice = product.basePrice;

      return [
        {
          id: demoUuid(`item:${seed.key}:${slug}`),
          name: product.name,
          options: [],
          unitPrice,
          quantity,
          lineTotal: unitPrice * quantity,
          image: product.images[0] ?? null,
        },
      ];
    });

    const subtotal = items.reduce((sum, line) => sum + line.lineTotal, 0);
    const deliveryFee = seed.type === 'DELIVERY' ? DEMO_DELIVERY_FEE : 0;
    const createdAt = new Date(now.getTime() - seed.minutesAgo * 60_000);

    return {
      id: demoUuid(`order:${seed.key}`),
      // Derived from the key, so the code on the dashboard is the code on the
      // order however many times the page is rendered.
      publicCode: `${PUBLIC_CODE_PREFIX}-${demoUuid(`code:${seed.key}`).replace(/\D/g, '').slice(0, 6).padEnd(6, '0')}`,
      status: seed.status,
      type: seed.type,
      customerName: seed.customerName,
      phone: seed.phone,
      cityCode: seed.type === 'DELIVERY' ? 'YEREVAN' : null,
      address: seed.address ?? null,
      landmark: seed.landmark ?? null,
      // A point inside the central zone, so a demo order's pin agrees with the
      // fee above it.
      lat: seed.type === 'DELIVERY' ? 40.1855 : null,
      lng: seed.type === 'DELIVERY' ? 44.5165 : null,
      notes: seed.notes ?? null,
      paymentMethod: seed.paymentMethod,
      paymentStatus: seed.paymentStatus ?? 'PENDING',
      /*
        Always a few minutes out from the moment of the request, so the countdown
        on the demo tracking page is always running rather than always expired.
        Nothing sweeps these — there is no database and no sweep — so a fixed
        instant would have shown every visitor after the first a dead order.
      */
      paymentExpiresAt:
        seed.status === 'AWAITING_PAYMENT'
          ? new Date(now.getTime() + DEMO_PAYMENT_WINDOW_MINUTES * 60_000).toISOString()
          : null,
      subtotal,
      deliveryFee,
      discount: 0,
      total: subtotal + deliveryFee,
      etaMinutes: seed.type === 'DELIVERY' ? DEMO_ETA_DELIVERY : DEMO_ETA_PICKUP,
      createdAt: createdAt.toISOString(),
      updatedAt: createdAt.toISOString(),
      cancelReason: seed.status === 'CANCELLED' ? 'Կրկնվող պատվեր' : null,
      items,
    } satisfies OrderView;
  });
}

export function demoOrderByToken(token: string, now: Date = new Date()): OrderView | null {
  return demoOrders(now).find((order) => demoTrackingToken(orderKey(order)) === token) ?? null;
}

export function demoOrderById(id: string, now: Date = new Date()): OrderView | null {
  return demoOrders(now).find((order) => order.id === id) ?? null;
}

/** The seed key behind a generated order, recovered by matching its id. */
function orderKey(order: OrderView): string {
  return SEEDS.find((seed) => demoUuid(`order:${seed.key}`) === order.id)?.key ?? '';
}

export function demoTokenFor(order: OrderView): string {
  return demoTrackingToken(orderKey(order));
}

/**
 * The one event every demo order has: the moment the customer placed it.
 *
 * Anything after that happened in the panel during this session, so it lives in
 * the client store and is layered on top of this.
 */
export function demoBaseEvents(order: OrderView): OrderEventView[] {
  // Where the order started its life. An online order was placed awaiting
  // payment, so that — not `NEW` — is what the customer's own event says, and the
  // history in the panel reads the way a real one would.
  const placedAs: OrderStatus = order.paymentMethod === 'ONLINE' ? 'AWAITING_PAYMENT' : 'NEW';

  return [
    {
      id: `${order.id}-created`,
      fromStatus: null,
      toStatus: placedAs,
      source: 'CUSTOMER',
      note: null,
      createdAt: order.createdAt,
    },
    ...(order.status === placedAs
      ? []
      : [
          {
            id: `${order.id}-seeded`,
            fromStatus: placedAs,
            toStatus: order.status,
            source: 'ADMIN',
            note: null,
            createdAt: order.updatedAt,
          },
        ]),
  ];
}
