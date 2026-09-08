import type { OptionGroupType, ProductBadge } from '@/lib/domain';
import type { LocalizedText } from '@/lib/i18n/locales';

/**
 * The shape of the menu as the UI sees it.
 *
 * Declared here rather than in `server/services/menu.ts` so client components can
 * import it without pulling the database client into their dependency graph.
 * The service produces these; components consume them.
 */

export interface MenuOption {
  id: string;
  name: LocalizedText;
  priceDelta: number;
  isDefault: boolean;
  isActive: boolean;
}

export interface MenuOptionGroup {
  id: string;
  name: LocalizedText;
  type: OptionGroupType;
  minSelect: number;
  maxSelect: number;
  isActive: boolean;
  options: MenuOption[];
}

export interface MenuProduct {
  id: string;
  slug: string;
  categoryId: string;
  name: LocalizedText;
  description: LocalizedText | null;
  basePrice: number;
  images: string[];
  isActive: boolean;
  isAvailable: boolean;
  badges: ProductBadge[];
  allergens: string[];
  weightGrams: number | null;
  calories: number | null;
  optionGroups: MenuOptionGroup[];
}

export interface MenuCategory {
  id: string;
  slug: string;
  name: LocalizedText;
  imageUrl: string | null;
  products: MenuProduct[];
}

/** A chosen option, as carried in the cart. */
export interface SelectedOption {
  id: string;
  name: LocalizedText;
  priceDelta: number;
}

/**
 * Does this dish force a decision before it can be ordered?
 *
 * Drives whether the "+" button adds straight to the cart or opens the sheet.
 * Adding a default size the customer never picked is how the wrong thing gets
 * delivered.
 */
export function hasRequiredChoice(product: MenuProduct): boolean {
  return product.optionGroups.some((group) => group.isActive && group.minSelect > 0);
}

/**
 * The pre-ticked options for a dish: whatever is marked default, and for a
 * required single-choice group with nothing marked, the first available option
 * so the sheet never opens in an unorderable state.
 */
export function defaultSelection(product: MenuProduct): SelectedOption[] {
  const selected: SelectedOption[] = [];

  for (const group of product.optionGroups) {
    if (!group.isActive) continue;

    const available = group.options.filter((option) => option.isActive);
    const defaults = available.filter((option) => option.isDefault);

    const chosen =
      defaults.length > 0
        ? group.type === 'SINGLE'
          ? defaults.slice(0, 1)
          : defaults.slice(0, group.maxSelect)
        : group.minSelect > 0 && group.type === 'SINGLE'
          ? available.slice(0, 1)
          : [];

    for (const option of chosen) {
      selected.push({ id: option.id, name: option.name, priceDelta: option.priceDelta });
    }
  }

  return selected;
}

/** Base price plus the deltas of the selected options. Display only — the server reprices. */
export function unitPriceFor(product: MenuProduct, selected: readonly SelectedOption[]): number {
  return selected.reduce((total, option) => total + option.priceDelta, product.basePrice);
}

/** Cheapest orderable configuration, used for the "from ..." label on cards. */
export function minimumPrice(product: MenuProduct): number {
  return product.optionGroups
    .filter((group) => group.isActive && group.minSelect > 0)
    .reduce((total, group) => {
      const deltas = group.options.filter((o) => o.isActive).map((o) => o.priceDelta);
      return total + (deltas.length > 0 ? Math.min(...deltas) : 0);
    }, product.basePrice);
}
