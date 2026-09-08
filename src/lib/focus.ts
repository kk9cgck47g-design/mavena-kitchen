/**
 * Where focus goes when a dialog or a sheet opens.
 *
 * Radix's focus scope autofocuses the first tabbable control inside the panel,
 * deliberately skipping links. In this app that lands on whichever button
 * happens to come first in the markup — the Armenian pill of the locale
 * switcher in the navigation panel, "clear the cart" in the cart. Both are
 * wrong for the same reason: the focus ring then sits on a control whose lime
 * styling already means "this is the selected one", so on a phone it reads as
 * two languages being active at once, and a destructive action gets highlighted
 * the moment the cart opens.
 *
 * WebKit paints that ring where Chromium does not — `:focus-visible` matches
 * for programmatically moved focus there — which is why this only ever showed
 * up on the iPhone.
 *
 * Focusing the panel itself is the behaviour the ARIA dialog pattern
 * recommends when the first control is not a sensible starting point: the
 * dialog is still announced, the focus trap still holds, and the first Tab
 * moves to the first control in document order. Radix gives the content
 * `tabindex="-1"`, so it is focusable without entering the tab sequence.
 */
export function focusPanelOnOpen(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}
