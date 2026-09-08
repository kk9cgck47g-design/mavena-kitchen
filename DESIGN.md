# Mavena Kitchen — design notes

Mavena Kitchen is a fictional burger restaurant in Yerevan, invented for this
project. This document records how the interface looks and why, in the order the
decisions constrain each other.

---

## 1. What the product has to do

One sequence carries almost all of the value: **see the food → configure it →
know what it costs → say where it goes.** Everything else — tracking, the admin
panel — is read more often than it is operated.

That shapes everything. The menu is the shop window and gets the photography and
the space. The checkout is a form somebody fills in once, on a phone, possibly
outdoors, and gets clarity instead of personality. The admin panel is a working
tool for a shift and gets density.

The interface is built mobile-first and stays usable from 320px, because ordering
food is a phone interaction. Nothing important hides behind a hover.

---

## 2. Typography, and the constraint that settles it

Three languages ship together: Armenian, Russian, English. Of the families on
Google Fonts, only a handful carry Armenian glyphs, and **Google Sans** is the one
that also covers Cyrillic and Latin.

That single fact settles the system. One typeface sets body and headline content
in all three languages, so an Armenian headline looks like a sibling of the
English one instead of the primary audience getting a visibly weaker face.

**Archivo** is Latin-only and appears in exactly two places: the wordmark and the
hero lockup. Both are Latin by nature, because the brand name is. Using it for
real headlines would reintroduce the problem the single-family decision exists to
avoid.

The stack is written out by family name rather than through next/font's generated
variables, deliberately. The metric-matched fallback next/font pairs with a family
carries a catch-all unicode-range, and left in the stack it swallows every script
before the next real family is reached — Armenian would silently render in
whatever the device happened to have, and the Armenian webfont would never be
downloaded at all.

Display sizes run on `clamp()`, so headlines shrink with the viewport instead of
stepping at breakpoints.

---

## 3. Charcoal and lime

The surfaces are a warm near-black: `coal-1000` for the page, `coal-900` for
cards, `coal-850` for anything raised above them. Warm rather than neutral,
because photographs of hot food sit on it and a blue-grey ground makes them look
refrigerated.

**Lime is the only accent, and it means one thing: this is the action, or this is
available.** The add button, the active category, the free-delivery threshold once
it is met, the current step of an order. It is never decoration. When everything
else is a shade of charcoal, one saturated colour carries the entire interactive
hierarchy — and spending it on ornament would take that away.

Red is the only other hue, and only for destructive states.

---

## 4. Contrast

Dark interfaces fail accessibility quietly. Text that looks fine to a designer on
a good monitor is well under the threshold on a phone in daylight.

The rule here is that **every colour pair is measured, not judged.** The muted
foreground — dish descriptions, form hints, summary labels — clears 4.5:1 against
the darkest surface the palette puts behind it, and the badge text on lime clears
it too. axe runs over the home page, the menu, the dish sheet, the cart, the
checkout and the tracking page on every test run, with an empty allowlist, so a
regression fails a build instead of waiting to be noticed.

Two consequences are worth stating, because this design got both wrong before it
got them right:

- **State is never carried by dimming alone.** The tracker's future steps are
  distinguished by their marker — a number instead of a tick, a neutral border
  instead of lime — not by fading their labels below the readable line.
- **Third-party controls are styled, not accepted.** The map's attribution and the
  toast's description ship with colours meant for a light interface. A licence
  credit nobody can read is not a credit.

Motion is optional throughout: cards fade and lift into place, the hero drifts
against the scroll, and all of it stops when the operating system asks for
reduced motion.

---

## 5. The mark

An original monogram, drawn as code rather than shipped as an image.

A cream stroke draws an angular **M**; its final stem is shared with two lime
diagonals that form a **K**. Five straight segments, which is what survives at
favicon size — an illustrated mark turns to mush at 24px in a header, and this one
has to work there, on a browser tab and as a monochrome stamp.

Because it is a path set drawn from `currentColor` plus one accent, a single
component covers all three without three files to keep in sync. The wordmark sets
the two words in Archivo at its heaviest weight with the second in lime — the same
lime that means "action" everywhere else, used here as identity rather than
instruction, which is the one place that is legitimate.

---

## 6. Photography

Dish photographs are stock, under a licence that permits commercial use without
attribution. Every one was reviewed on the actual charcoal background before being
kept, against three criteria: a dark or neutral backdrop, so a card does not punch
a bright rectangle through the page; warm directional light; and shallow depth of
field.

That check cannot be done from a filename. The first pass was chosen from search
thumbnails and several picks turned out to be white plates on red-checked paper —
obvious in place, invisible in a list.

Every URL goes through one builder, so crop, quality and format are identical
across the menu. That is the other half of looking like a single shoot.

---

## 7. The components, briefly

**Dish card.** Photograph, name, a two-line description, price, one action. The
action is an add button when the dish needs no choices and an opener when it does,
so the card never lies about what tapping it will do. Sold-out dishes stay visible
and legible rather than vanishing — a menu that silently shrinks is harder to
trust than one that says what is off today.

**Dish sheet.** A panel rather than a page, so the menu stays behind it. Required
option groups come first and the action bar is pinned, because the two things a
customer needs are "what must I choose" and "what does it cost now".

**Cart and checkout.** Every amount is the server's. The summary shows the
subtotal before an address exists, because the food has a price whether or not the
delivery does; anything not yet known is a dash rather than a skeleton that never
resolves.

**Delivery map.** Three nested zones over Yerevan, cheapest in the middle, drawn
as areas rather than listed as prices — because the question being asked is "is my
street in it". A pin outside every zone is refused explicitly, on screen, before
anybody pays.

**Tracking.** One page behind one unguessable link, no account. A status timeline
with the current step marked, and the total frozen as it was when the order was
placed.

**Admin.** Density over decoration: a board where a shift sees everything needing
attention without scrolling, and status changes that are one tap. Russian only —
it is a staff tool, not a storefront.
