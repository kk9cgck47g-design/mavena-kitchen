import type { PricingIssue, PricingIssueCode } from '@/lib/checkout-types';
import { type OptionGroupType } from '@/lib/domain';
import type { LocalizedText } from '@/lib/i18n/locales';
import { type Amd, assertAmd, multiplyAmd, sumAmd } from '@/lib/money';
import type { CartLine } from '@/lib/schemas/cart';

/**
 * Re-exported so callers that already speak to this module do not need a second
 * import. The definitions live in `lib/` because the checkout screen renders
 * them, and a client component must not reach into `server/`.
 */
export type { PricingIssue, PricingIssueCode };

/**
 * Cart pricing.
 *
 * Deliberately a pure function over a menu snapshot rather than something that
 * queries the database itself: pricing is the part of this system that must be
 * exhaustively unit-tested, and a pure function makes that trivial. The caller
 * loads the menu (see `menu.ts`) and hands it in.
 */

// --- Menu snapshot the pricer works against -------------------------------

export interface PricingOption {
  id: string;
  name: LocalizedText;
  priceDelta: Amd;
  isActive: boolean;
}

export interface PricingOptionGroup {
  id: string;
  name: LocalizedText;
  type: OptionGroupType;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: PricingOption[];
}

export interface PricingProduct {
  id: string;
  name: LocalizedText;
  basePrice: Amd;
  images: string[];
  isActive: boolean;
  isAvailable: boolean;
  optionGroups: PricingOptionGroup[];
}

// --- Result ---------------------------------------------------------------

/** An option as it will be frozen into `order_items.optionsSnapshot`. */
export interface PricedOptionSnapshot {
  groupName: LocalizedText;
  name: LocalizedText;
  priceDelta: Amd;
}

export interface PricedLine {
  productId: string;
  nameSnapshot: LocalizedText;
  imageSnapshot: string | null;
  optionIds: string[];
  optionsSnapshot: PricedOptionSnapshot[];
  unitPrice: Amd;
  quantity: number;
  lineTotal: Amd;
}

export type PriceCartResult =
  | { ok: true; lines: PricedLine[]; subtotal: Amd }
  | { ok: false; issues: PricingIssue[] };

// --- Implementation -------------------------------------------------------

/**
 * Price a submitted cart against the current menu.
 *
 * Every line is checked even after the first failure: showing the customer all
 * the problems at once beats making them resubmit three times to discover them
 * one by one.
 */
export function priceCart(
  cart: readonly CartLine[],
  productsById: ReadonlyMap<string, PricingProduct>,
): PriceCartResult {
  const issues: PricingIssue[] = [];
  const lines: PricedLine[] = [];

  cart.forEach((line, lineIndex) => {
    const product = productsById.get(line.productId);

    if (!product) {
      issues.push({ code: 'PRODUCT_NOT_FOUND', lineIndex, productId: line.productId });
      return;
    }

    if (!product.isActive || !product.isAvailable) {
      issues.push({
        code: 'PRODUCT_UNAVAILABLE',
        lineIndex,
        productId: product.id,
        productName: product.name,
      });
      return;
    }

    const priced = priceLine(line, lineIndex, product, issues);
    if (priced) lines.push(priced);
  });

  if (issues.length > 0) return { ok: false, issues };

  const subtotal = sumAmd(lines.map((line) => line.lineTotal));
  assertAmd(subtotal, 'subtotal');

  return { ok: true, lines, subtotal };
}

function priceLine(
  line: CartLine,
  lineIndex: number,
  product: PricingProduct,
  issues: PricingIssue[],
): PricedLine | null {
  const before = issues.length;

  // Duplicate ids in the payload would otherwise let the same paid extra be
  // counted twice while still passing the maxSelect check.
  const selectedIds = new Set(line.optionIds);

  const activeGroups = product.optionGroups.filter((group) => group.isActive);
  const optionLocation = new Map<string, { group: PricingOptionGroup; option: PricingOption }>();
  for (const group of activeGroups) {
    for (const option of group.options) {
      optionLocation.set(option.id, { group, option });
    }
  }

  // 1. Every submitted option must belong to this product and be orderable.
  for (const optionId of selectedIds) {
    const found = optionLocation.get(optionId);
    if (!found) {
      issues.push({
        code: 'OPTION_NOT_FOUND',
        lineIndex,
        productId: product.id,
        productName: product.name,
        optionId,
      });
      continue;
    }
    if (!found.option.isActive) {
      issues.push({
        code: 'OPTION_UNAVAILABLE',
        lineIndex,
        productId: product.id,
        productName: product.name,
        groupId: found.group.id,
        groupName: found.group.name,
        optionId,
      });
    }
  }

  // 2. Every group must be satisfied — including required groups the client omitted entirely.
  const snapshots: PricedOptionSnapshot[] = [];
  const acceptedIds: string[] = [];

  for (const group of activeGroups) {
    const chosen = group.options.filter(
      (option) => selectedIds.has(option.id) && option.isActive,
    );

    const maxAllowed = group.type === 'SINGLE' ? Math.min(1, group.maxSelect || 1) : group.maxSelect;

    if (chosen.length < group.minSelect) {
      issues.push({
        code: 'TOO_FEW_OPTIONS',
        lineIndex,
        productId: product.id,
        productName: product.name,
        groupId: group.id,
        groupName: group.name,
        expected: group.minSelect,
        actual: chosen.length,
      });
    } else if (chosen.length > maxAllowed) {
      issues.push({
        code: 'TOO_MANY_OPTIONS',
        lineIndex,
        productId: product.id,
        productName: product.name,
        groupId: group.id,
        groupName: group.name,
        expected: maxAllowed,
        actual: chosen.length,
      });
    }

    for (const option of chosen) {
      assertAmd(option.priceDelta, `option ${option.id} priceDelta`);
      snapshots.push({
        groupName: group.name,
        name: option.name,
        priceDelta: option.priceDelta,
      });
      acceptedIds.push(option.id);
    }
  }

  if (issues.length > before) return null;

  assertAmd(product.basePrice, `product ${product.id} basePrice`);

  const unitPrice = product.basePrice + sumAmd(snapshots.map((s) => s.priceDelta));
  const lineTotal = multiplyAmd(unitPrice, line.quantity);

  return {
    productId: product.id,
    nameSnapshot: product.name,
    imageSnapshot: product.images[0] ?? null,
    optionIds: acceptedIds,
    optionsSnapshot: snapshots,
    unitPrice,
    quantity: line.quantity,
    lineTotal,
  };
}

/**
 * Price a single configuration for the product modal, where the customer is
 * still choosing and incomplete selections are expected rather than an error.
 */
export function previewUnitPrice(
  product: PricingProduct,
  selectedOptionIds: readonly string[],
): Amd {
  const selected = new Set(selectedOptionIds);
  let total = product.basePrice;

  for (const group of product.optionGroups) {
    if (!group.isActive) continue;
    for (const option of group.options) {
      if (option.isActive && selected.has(option.id)) total += option.priceDelta;
    }
  }

  return total;
}
