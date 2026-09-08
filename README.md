# Mavena Kitchen

Online ordering for **Mavena Kitchen**, a fictional restaurant in Yerevan,
Armenia. The brand, the menu, the delivery areas and every customer in the demo
data are invented for this project; nothing here belongs to a real business.

Three languages (Armenian, Russian, English), guest checkout with no registration,
map-pin addresses instead of apartment/entrance/floor fields, and Telegram as the
guaranteed channel for reaching the kitchen.

**What it demonstrates.** A whole ordering business, not a menu page: prices and
delivery fees recomputed server-side from the database on every request, an order
pipeline that survives a double-tapped submit button, polygon delivery zones with
overlap resolved by priority, a payment lifecycle with retries, expiry and a
reconciliation sweep, an outbox for notifications that cannot be lost, role-split
staff access, rate limits keyed on what actually identifies a person, and a test
suite that runs against a real Postgres rather than a mock.

**No real payment credentials are included, and that is deliberate.** Online
payment runs through a stub acquirer that takes no money and implements the full
redirect flow. Adding a bank means writing one adapter; everything around it is
built and tested. See [Online payment](#online-payment).

---

## Getting started

Requires Node.js 22+ and Docker.

```bash
pnpm install
```

```bash
cp .env.example .env.local
```

```bash
pnpm db:up && pnpm db:migrate && pnpm db:seed
```

```bash
pnpm dev
```

The site runs at http://localhost:3000 — Armenian at `/`, Russian at `/ru`, English at `/en`.
Seeded admin account: `owner@mavena.example` / `ChangeMe123!`.

## Commands

| Command                  | What it does                                                                      |
| ------------------------ | --------------------------------------------------------------------------------- |
| `pnpm dev`               | Dev server                                                                        |
| `pnpm build`             | Production build                                                                  |
| `pnpm test`              | Unit + integration tests (integration needs the database running)                 |
| `pnpm typecheck`         | `tsc --noEmit`                                                                    |
| `pnpm db:up` / `db:down` | Local Postgres via Docker                                                         |
| `pnpm db:generate`       | Create a migration from schema changes                                            |
| `pnpm db:migrate`        | Apply migrations                                                                  |
| `pnpm db:seed`           | Reset menu, cities, zones and settings to placeholder data                        |
| `pnpm db:studio`         | Browse the database                                                               |
| `pnpm load-test`         | Fifty concurrent users against a running server. `--users`, `--seconds`, `--base` |

## Layout

```
src/
  app/[locale]/     Storefront (Armenian at the root, /ru and /en prefixed)
  app/admin/        Staff dashboard — no locale prefix, staff-only
  server/db/        Drizzle schema, migrations, seed
  server/services/  Business logic — no Next.js imports, unit-testable
  server/payments/  The provider interface and its adapters. One file per acquirer.
  lib/              Shared with the client: money, geo, domain vocabulary, schemas
  messages/         UI translations
tests/unit/         Pure logic: pricing, delivery zones, opening hours, money
tests/integration/  Order pipeline against a real database
```

**Components never query the database.** They call `server/services/*`, which keeps
the business logic portable and testable — and means a separate API service can be
split out later without a rewrite.

## Decisions worth knowing before you change something

**Money is always an integer number of drams.** No floats touch a price, anywhere.
See `src/lib/money.ts`.

**The client never sends prices.** The cart carries product ids, option ids and
quantities; the server recomputes every amount from the database. A cart that
carried its own totals could be edited in DevTools.

**Order items are snapshots, not joins.** `order_items` freezes the dish name,
price and chosen options. Raising a price tomorrow must not rewrite yesterday's
orders or yesterday's revenue.

**Orders have two identifiers.** `publicCode` (`MK-482193`) is for reading aloud on
the phone. `trackingToken` is the only thing in the tracking URL, because that page
shows a customer's name, phone and home address — a sequential number would leak
every customer's details to anyone who can count.

**Delivery zones are polygons, per city.** Each zone keeps its own fee, minimum
and ETA, and zones may overlap — the demo ships three nested areas over Yerevan,
so which one applies is decided by priority rather than by their order in the
table. A pin outside every active zone is refused explicitly rather than
discovered after the customer pays.

**No geocoding.** The courier needs coordinates and a landmark, not a parsed
address. The pin the customer drags _is_ the address.

**Never name a new enum value in the same migration that adds it.** Postgres
refuses to use a new enum value in the transaction that created it, and
drizzle-kit applies every pending migration in one transaction — so a partial
index or a check constraint mentioning a status you have just added fails the whole
deploy, on a fresh database and nowhere else — and drizzle-kit reports it as a
spinner that stops. See the comment on `orders_awaiting_payment_idx` in
`schema.ts`.

**Two fonts, and the order is load-bearing.** See the comment in
`src/app/[locale]/layout.tsx` — get it wrong and Armenian silently renders in
whatever the device has, or in boxes.

## Choices that differ from the obvious default

- **bcryptjs**, not argon2 — no native binary, so nothing to break on Windows or
  on a serverless deploy. Adequate for a handful of staff accounts.
- **The font stack is written out by family name** in `globals.css` rather than
  taken from next/font's generated variables. The metric-matched fallback it
  pairs with a family has a catch-all unicode-range, and in the stack it swallows
  every script before the next real family is reached — Armenian would render in
  whatever the device happened to have. `adjustFontFallback: false` states the
  same decision at the source. It does not silence Next's "failed to find font
  override values for `Google Sans`" build warning, which is that family being
  absent from next/font's metrics table; Google Sans is the only family on Google
  Fonts covering all three scripts, so the warning stays and the typography
  works.

## Demo mode

Setting `NEXT_PUBLIC_DEMO_MODE=1` serves the menu from `src/server/db/menu-data.ts`
instead of Postgres and refuses to create orders. That is what the public design
preview runs on: it needs no database, holds no secrets, and cannot take an order
nobody is going to cook.

It is not a second copy of the menu — `src/server/demo/catalog.ts` reads the same
constants the database seed writes, so the two can never diverge.

The preview labels itself: a "Demo" chip in the header, a note in the footer
listing what is not wired up, and a disabled checkout button.

## Deploying the preview

The repository is private. On Vercel, import it and set exactly one environment
variable:

```
NEXT_PUBLIC_DEMO_MODE = 1
```

Nothing else is required — no database, no API keys. `pnpm install` runs
`scripts/copy-maplibre-worker.mjs` via postinstall, which the map needs.

For a real deployment instead: leave `NEXT_PUBLIC_DEMO_MODE` unset, set
`DATABASE_URL` to a Postgres instance, run the migrations and seed it.

## Built

**Storefront.** Landing page, menu with a category scroll-spy, dish sheet with
options (an intercepted route, so it has a real URL and returns you to your
scroll position), cart, about, and contacts with a delivery-zone map. The
fictional demo catalogue is available in three languages: 29 dishes, 10
categories, 68 options.

**Ordering.** One-screen checkout with a map pin for the address, every amount
quoted by the server, and an order that is refused rather than silently repriced
if the menu moves between the quote and the button. Tracking at
`/order/[trackingToken]` with a status bar that updates by polling, without a
reload.

**Staff panel** at `/admin`: today's figures, order list with status filters and
search, order detail with the full audit trail, status changes through the
domain's own state machine, and price/availability for the menu. Password
required; see "What a real deployment would still need" below.

**Telegram.** A kitchen ticket per order, sent from a transactional outbox so a
Telegram outage can never cost an order, with status buttons that go through the
same `updateOrderStatus` the panel uses.

**Online payment.** Provider-independent, and complete except for the acquirer.
An online order waits at `AWAITING_PAYMENT` and reaches the kitchen only once
money is confirmed; the customer can retry, the window expires, and money that
arrives late is recorded and flagged rather than quietly kept. A stub provider
implements the whole redirect flow so all of it runs locally. See below.

## Not built yet

|                     |                                                                                  |
| ------------------- | -------------------------------------------------------------------------------- |
| A real acquirer     | No bank chosen. The stub is the only adapter — see "Connecting a real provider". |
| Refunds             | Recorded as needed, never issued. A person moves the money.                      |
| Scheduled sweeps    | Both endpoints built, no scheduler — see below.                                  |
| Menu caching        | `revalidateTag` is not wired up, so every route is dynamic.                      |
| Staff roles         | `OWNER` / `MANAGER` are stored but not enforced anywhere.                        |
| Login rate limiting | Nothing throttles password attempts.                                             |

## Holding up under a Friday evening

**The menu, the settings row, the cities and the delivery zones are cached; the
prices an order is computed from are not.** That line is the whole design. A
stale menu costs somebody seeing a price a few minutes old on a browsing screen —
and cannot cost them the wrong charge, because `getPricingProducts` is read live
at checkout and the quoted total is compared against the recomputed one before an
order is accepted. Verified by changing a price in the database directly: the
storefront kept showing the old one, the pricing path returned the new one
immediately.

Every admin edit calls `updateTag`, so a price change or a stop-list toggle is
visible at once rather than at the end of a revalidation window.

`cachedRead` in `server/cache.ts` wraps `unstable_cache` for one reason worth
knowing: `unstable_cache` throws outside a Next request rather than simply not
caching, and the functions being cached here are also called from tests and from
anything operational written later. Outside a request there is nothing to share a
result with, so running the query is the correct answer, not a degraded one.

**Connections.** `server/db/pooling.ts` decides `prepare` from the connection
string, because prepared statements break under a transaction-mode pooler in a way
that only appears once traffic is heavy enough for connections to be reused. Set
`DATABASE_POOLED` when the guess is wrong. On a serverless platform the total held
open is instances × max, which is why max is one there.

### Measured

`pnpm load-test --users 100 --seconds 25` against a production build on one
machine, with Postgres local:

```
  path        requests   failed     p50      p95      max
  checkout         596        0    385ms   521ms   672ms
  home            1006        0    380ms   538ms   685ms
  menu            1650        0    383ms   537ms   686ms
  3597 requests, 0 failed, 143.9/s
```

Database connections held during that run, sampled every 400ms: **zero**. All four
page types were served entirely from cache.

The quote path — the hottest write-adjacent one, and the one the load test cannot
reach because a Server Action needs its own action id — was measured directly and
uncached: 100 concurrent quotes complete in 98ms wall, p95 96ms.

What this does not tell you: real latency on Vercel with a remote database, where
the round trip dominates. It tells you nothing falls over, and that the cache is
carrying the read load it was added to carry.

## Online payment

Set `PAYMENT_PROVIDER` and the checkout offers a third method. Leave it unset and
online payment does not exist: the method is not shown, and the server refuses it
if a client sends it anyway.

```bash
PAYMENT_PROVIDER=stub pnpm dev
```

**The customer's card never touches this server.** It is typed on the provider's
own page, on the provider's own domain. What crosses our boundary is a reference,
an amount and an outcome — there is no field for a card number anywhere in
`server/payments`, and the stub's fake page deliberately has none either, because
a convincing fake card field is a real place for somebody to type a real card.

### The flow

1. Checkout creates the order at `AWAITING_PAYMENT`, then opens a payment session
   and redirects the browser to the provider.
2. The customer pays, or does not.
3. The provider returns them to `/api/payments/return/[paymentId]`.
4. That handler asks the provider what happened, and makes the order agree.
5. On confirmed payment the order becomes `NEW`, and _that_ is when the kitchen
   ticket is queued.

**The order is not the kitchen's until the money is confirmed.** `AWAITING_PAYMENT`
exists so that `NEW` keeps meaning "the kitchen has this and it will be paid for".
Nothing is queued in the outbox when an online order is placed; the ticket is
written in the same transaction that records the payment, which keeps the outbox
rule the rest of the system already has — the notification exists if and only if
there is something to notify about.

**The return URL is not how we learn that somebody paid.** It is a browser
navigation: refreshable, shareable, skippable. All it does is name the attempt
worth asking about. Every path to `PAID` ends in `confirmPayment` asking the
provider — the return, the sweep, and the panel's "check payment" button are three
callers of one function, not three ways of deciding.

That is also why there is one return URL rather than `/paid` and `/failed`. Two
URLs invite the code behind them to believe the path, and the path is chosen by
whoever is navigating.

**Confirmation is idempotent at three depths**, because a return, a refresh of
that return, a sweep and a member of staff can all arrive at once: the row is
locked before it is read, the write is conditional on the status it was read at,
and a unique index permits one paid attempt per order regardless. The last one
stays true if the first two are wrong.

**The amount is checked, not accepted.** What the provider says was taken is
compared against what the attempt asked for. A mismatch is refused in both
directions — less would be an unauthorised discount, more is a customer owed money
— and neither is resolved automatically. The attempt is flagged `needsRefund` and
the panel says so in words.

**An unpaid order expires** after `PAYMENT_WINDOW_MINUTES`, and the sweep cancels
it. Attempts go to `EXPIRED`, not `FAILED`, and the distinction carries weight:
`FAILED` is the provider refusing, `EXPIRED` is us giving up. Only the second can
still be settled afterwards.

**Money that arrives late is kept and flagged, not acted on.** Reviving a
cancelled order would put a ticket in front of a kitchen half an hour after the
customer gave up, and food arriving for somebody who has already eaten is worse
than a refund. The payment is recorded as `PAID` because it is, the order stays
cancelled, and `needsRefund` puts it in front of a person.

### The sweep is not optional

`GET /api/cron/payments`, guarded by `CRON_SECRET` exactly like the Telegram one.

It exists for the customer who pays and closes the tab. No return fires, and a
provider without callbacks pushes nothing — so from the outside that customer is
indistinguishable from one who never paid. Their order is cancelled and their
money stays taken, and the first anyone hears of it is a phone call. Nothing else
in the system covers this.

So: **do not switch `PAYMENT_PROVIDER` on for real without a scheduler calling
this every few minutes.** The options are the same as for the Telegram sweep
below, and neither needs a code change.

### The stub provider

`PAYMENT_PROVIDER=stub` runs the full flow against a page on this site. It keeps
its records in `stub_payments`, which stands in for the bank's own database and
which nothing outside `server/payments/stub.ts` may read — the moment our side
reads a provider's storage instead of asking it a question, the abstraction is
decorative.

The fake page offers "pay" and "decline", and closing it without choosing is the
third and most interesting case: it leaves the attempt pending, which is exactly
what the sweep is for. All of it is covered in `tests/integration/payments.test.ts`
— double returns, concurrent confirmations, wrong amounts, expiry, late payment,
retry, and the kitchen being told exactly once.

Drop the table and the `/pay/[reference]` route the day a real adapter lands.

### Connecting a real provider

What is left is one file and some credentials. `PaymentProvider` in
`src/server/payments/provider.ts` is two methods — `createSession` and
`fetchStatus` — and everything else in this document is already built on them.

Adding an acquirer means: a new adapter in `src/server/payments/`, its name in the
`PROVIDERS` map in `registry.ts` and in the `PAYMENT_PROVIDER` enum in
`lib/env.ts`, its credentials in the environment, and whatever amount conversion
its API wants (several Armenian gateways expect minor units — ×100 — and that
conversion belongs inside the adapter, because everything on our side of the
boundary is whole drams and must stay that way).

Nothing about the order lifecycle, the sweep, the expiry, the idempotency or the
screens should need to change. If it does, this interface is wrong and is the thing
to fix.

### Demo mode takes no payments

The preview shows the flow and cannot move a dram. `configuredProvider()` returns
`null` there before the variable is even read, so every server path that would take
money refuses; the method still appears at checkout, one seeded order sits at
`AWAITING_PAYMENT`, and the fake page writes its outcome to a store that lives in
the browser tab and dies with it. `tests/unit/payments-demo.test.ts` proves it by
removing `DATABASE_URL` and showing the demo paths still answer — a function that
returns normally without a connection string demonstrably never reached Postgres.

## Telegram

A new order writes a row to the `notifications` outbox **inside the same
transaction as the order**, and the message is sent after the response has gone
out. That split is deliberate: an unreachable kitchen can never fail a
customer's order, and anything that does not get through stays `PENDING` and can
be sent again.

Delivery is tracked per chat, so a retry only goes to the screens still missing
the ticket. Retrying is therefore safe to do as often as you like.

Two secrets, both from the environment and never committed —
`TELEGRAM_BOT_TOKEN` and `TELEGRAM_WEBHOOK_SECRET`. Chat ids are **not**
environment variables: they live on the settings row and are edited in the panel
(Telegram tab), because a chat id only exists once the bot has been added to a
group, which happens after the deployment does. The same screen has a test
button, which is the only way to find out you pasted the wrong id before a
customer's order does it for you.

Register the webhook once, using the same secret:

```bash
curl -F "url=https://YOUR-DOMAIN/api/telegram" -F "secret_token=YOUR_WEBHOOK_SECRET" https://api.telegram.org/botYOUR_BOT_TOKEN/setWebhook
```

### Automatic retry is built but not scheduled

`GET /api/cron/telegram` re-sends everything still queued. It is guarded by
`CRON_SECRET` (`Authorization: Bearer …`), answers 404 when that variable is
absent so it is closed rather than open, refuses in demo mode, and handles at
most 25 messages per run so one invocation cannot run away.

**Nothing calls it on a schedule.** Vercel's Hobby plan limits cron jobs to once
a day, which for a kitchen notification is close to useless, and the project is
not moving to Pro for this alone. Until a scheduler exists, an undelivered
ticket is re-sent by hand from the order screen in the panel, which reports the
delivery state of every order.

To switch it on later, either:

- **Vercel Pro** — add `vercel.json` and redeploy:

  ```json
  {
    "$schema": "https://openapi.vercel.sh/vercel.json",
    "crons": [{ "path": "/api/cron/telegram", "schedule": "*/5 * * * *" }]
  }
  ```

  Vercel supplies the `Authorization` header from `CRON_SECRET` on its own.

- **Any external scheduler** (GitHub Actions on a schedule, cron-job.org, a box
  you already own) — call the same URL every few minutes with the header set
  yourself:

  ```bash
  curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/telegram
  ```

Neither option needs a code change; the endpoint and `dispatchPending()` are
finished and covered by tests.

## Staff, roles and sessions

Two roles, and the line between them is "can this change money or access?".

|                                   | MANAGER | OWNER |
| --------------------------------- | ------- | ----- |
| Orders, statuses, the stop list   | yes     | yes   |
| Checking whether a payment landed | yes     | yes   |
| Prices                            | no      | yes   |
| Telegram settings                 | no      | yes   |
| Staff accounts                    | no      | yes   |

Checked in the page gate and again in every Server Action. Hiding a button decides
what a manager sees; the action decides what they can do, and an action is a
public POST endpoint whatever the UI renders.

**Sessions are revocable.** Tokens carry an issue time and `admin_users.sessionsValidFrom`
says how far back an account still honours them — the check is free, because
`currentAdmin` already reads that row. It moves when somebody signs out
everywhere, when a password changes, when an account is deactivated and when a
role changes. A demoted manager keeping a working cookie would make the roles
advisory. What it cannot do is revoke one device and keep another; for a handful
of staff that was not worth a session table.

**Accounts are created in the panel**, at `/admin/staff`. The seed only ever
creates the first owner, and never touches accounts once any exist — it used to
delete them all, which is how a restaurant loses access to its own panel. There is
no email on this system and therefore no reset link: the owner sets a password and
hands it over in person.

The panel refuses to leave itself without an active owner. Deactivating or
demoting the last one is rejected rather than applied.

## Pausing the shop

`Настройки → Приём заказов`, owner only. It stops the site taking new orders and
changes nothing else: orders already placed keep moving, the panel keeps working,
queued kitchen tickets are still sent, and tracking pages keep updating. Customers
see a notice in their own language and a disabled button; the checkout still
quotes, so the screen has a total to show beside the explanation.

Everything downstream of the switch was already built — the ordering window
derives `isPaused` from it, and `createOrder` refuses at the source. What was
missing was anything that could write it.

Three decisions worth knowing:

**No timer, no schedule.** An owner pressing this is dealing with something and
does not know when it ends. A duration would either resume while the kitchen is
still drowning or need cancelling from the same screen anyway.

**The message is the built-in translated one**, not free text. The panel is
Russian-only and the storefront is not; a typed note would show Armenian and
English customers Russian, which is worse than a correct sentence in their own
language.

**Pausing asks for confirmation, resuming does not.** Stopping the shop by
accident costs orders; starting it by accident costs a moment.

It also refuses pre-orders. A scheduled order is normally allowed while the
restaurant is shut — that is what pre-ordering is for — but a pause means the
kitchen cannot commit to anything, including tomorrow.

## Rate limits

Postgres-backed, keyed, fixed-window. Not Redis — that would mean another service
to keep alive and another secret to hold, for a restaurant whose busiest minute
fits comfortably inside what an upsert can take.

The keys matter more than the numbers, and the reason is how customers connect:
a mobile carrier puts a whole neighbourhood behind one address, so on a
customer-facing action an address is not a person. Those limits are set for a
busy evening and
paired with a key that identifies an actual customer — the phone number on the
order, the token of the order being paid for. Login is the opposite case: a
handful of accounts, worth attacking, and nobody legitimate types a password
twenty times.

The login check runs **before** bcrypt. A comparison at cost 12 costs a quarter of
a second by design, so a hundred simultaneous attempts would fell the function
without anybody having guessed anything.

Every limit fails **open**: if the limiter itself cannot be reached the request is
allowed. A database hiccup must not take the site down on its way to protecting
it — which is also why no limit here is the only thing standing between somebody
and an action that matters.

## Operations

**Errors.** `src/instrumentation.ts` catches every server error Next reports and
writes one structured line. It reports to a log rather than to a service on
purpose: sending them anywhere costs a DSN, which is the owner's secret to hold.
`reportServerError` is the seam — replace its body and everything routes through
it. Headers and URLs are deliberately not logged: the first carries the session
cookie, the second carries tracking tokens.

**CI.** `.github/workflows/ci.yml` runs typecheck, lint, the full suite and a
build on every push and pull request, with a real Postgres — the interesting tests
here are exactly the ones that cannot run against a mock.

**Backups.** Not configured, and this is the remaining operational gap. Neon's
point-in-time restore is a plan feature; confirm it is on before launch and write
down who restores and from what. Order history is the one thing in this system
that cannot be regenerated.

**A draft CSP** is served report-only in development. Enforcing it needs a
per-request nonce to replace `'unsafe-inline'` on scripts, and somebody to click
through the map and the checkout to find what else breaks.

## What a real deployment would still need

This is a portfolio build. If it were going live, these come first:

- Set `AUTH_SECRET`. Without it the panel refuses to render at all, which is the
  intended failure mode.
- Set `SEED_ADMIN_PASSWORD` before seeding a real database. The seed refuses the
  built-in development password against anything that is not localhost.
- Point `DATABASE_URL` at a pooled endpoint, and check `DATABASE_POOLED` if the
  hostname does not announce itself.
- Confirm point-in-time restore is on, and write down the restore procedure.
- Decide who gets a `MANAGER` account and create them in the panel.

Still open, and each one is a decision rather than a task:

- **Backups** are unconfigured; see Operations above.
- **A real acquirer**, whenever one is chosen. Everything except the adapter is
  built and tested against the stub.

## Verified on mobile

The storefront has been swept at 320, 375, 390 and 430 px in an emulated
viewport: no horizontal overflow, no tap target under 44 px, no console errors.

What emulation cannot answer, and what a real iPhone still has to confirm:
the safe-area insets at the bottom of every page (`viewportFit: 'cover'` is on,
so the cart bar, the cart sheet, the dish action bar and the footer each reserve
the home indicator themselves), momentum scrolling in the category rail,
two-finger panning on the contacts map, Safari and the in-app browsers, and
landscape.
