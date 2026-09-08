import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type BrowserContext, type Page } from '@playwright/test';

import en from '../../src/messages/en.json';
import hy from '../../src/messages/hy.json';
import ru from '../../src/messages/ru.json';
import type { Locale } from '../../src/lib/i18n/locales';

/**
 * The checks that ride along on every page, and the two stubs that make a run
 * repeatable.
 *
 * Nothing the application decides is stubbed. Pricing, the checkout action, the
 * database, order creation, tracking and the payment provider are all the real
 * ones — the payment provider was already a stub before any test existed, by the
 * product's own design. What is stubbed is imagery: map tiles and dish
 * photographs, which are bytes fetched from somebody else's CDN and have no
 * bearing on whether a total is right.
 */

const MESSAGES = { hy, ru, en } as const;

/** The application's own copy, so a selector is never a hardcoded translation. */
export function messages(locale: Locale): (typeof MESSAGES)['ru'] {
  return MESSAGES[locale] as (typeof MESSAGES)['ru'];
}

/** A one-pixel transparent PNG. Small enough to be free, real enough to decode. */
const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

/**
 * Hosts whose bytes are not under test.
 *
 * Map tiles come from a donation-funded service that rate-limits, and dish
 * photographs come from Unsplash through Next's optimiser. Left alone, both make
 * a run's duration depend on somebody else's afternoon. The map's *behaviour* — the pin, `moveend` re-quoting, the
 * in-zone test — is our code and stays real; only the picture underneath it is
 * a coloured square. Card and sheet geometry is driven by aspect-ratio classes,
 * so a one-pixel image changes no layout.
 */
async function stubImagery(context: BrowserContext): Promise<void> {
  const png = { status: 200, contentType: 'image/png', body: PIXEL };

  await context.route(/tile\.openstreetmap\.org|api\.maptiler\.com/, (route) => route.fulfill(png));
  await context.route(/images\.unsplash\.com/, (route) => route.fulfill(png));
  // Our own optimiser, and it has to be intercepted too: the fetch to Unsplash
  // happens on the server, where `context.route` cannot reach it.
  await context.route('**/_next/image**', (route) => route.fulfill(png));
}

/**
 * Console output that is expected and therefore not a failure.
 *
 * Deliberately a short list with a reason attached to each entry rather than a
 * blanket filter: the value of this check is that anything new shows up, and a
 * pattern that swallowed a class of messages would quietly give that up. Each
 * one names the audit finding that will delete it.
 */
const EXPECTED_CONSOLE: Array<{ match: RegExp }> = [];

function isExpected(text: string): boolean {
  return EXPECTED_CONSOLE.some((entry) => entry.match.test(text));
}

export interface AppFixture {
  locale: Locale;
  t: (typeof MESSAGES)['ru'];
  /** Navigate to a path, prefixing the locale the way the router expects. */
  goto: (path: string) => Promise<void>;
  /** Fails with the offending elements named, not just a boolean. */
  expectNoHorizontalOverflow: (label: string) => Promise<void>;
  /** Fails only on violations that are not already known and recorded. */
  expectNoNewA11yViolations: (label: string) => Promise<void>;
}

/**
 * Violations this suite tolerates. Empty, and meant to stay that way.
 *
 * It held `color-contrast` while the muted foreground sat at 4.26:1 against the
 * card surface, the badge text at 4.46:1 on lime, and two third-party controls
 * — a toast description and the map's attribution — at their libraries'
 * defaults. All four are fixed in the stylesheet, so the set is empty and the
 * check is now "no violations" rather than "no new ones".
 *
 * Adding an entry here should feel like a decision, not a shortcut: it turns a
 * failure into a silence.
 */
const KNOWN_A11Y_VIOLATIONS = new Set<string>();

export const test = base.extend<{ app: AppFixture; consoleGuard: void }>({
  /**
   * Collects console errors for the whole test and asserts at the end.
   *
   * Automatic, so no test can forget it, and asserted on teardown rather than
   * per-navigation so a late error still counts.
   */
  consoleGuard: [
    async ({ page }, use) => {
      const problems: string[] = [];

      page.on('console', (message) => {
        if (message.type() !== 'error') return;
        const text = message.text();
        if (!isExpected(text)) problems.push(`console.error: ${text}`);
      });

      page.on('pageerror', (error) => {
        if (!isExpected(error.message)) problems.push(`pageerror: ${error.message}`);
      });

      await use();

      expect(problems, 'unexpected browser console errors').toEqual([]);
    },
    { auto: true },
  ],

  app: async ({ page, context }, use) => {
    await stubImagery(context);

    const locale = (test.info().project.metadata.appLocale ?? 'ru') as Locale;
    const t = messages(locale);

    /*
      The locale is pinned by cookie as well as by `Accept-Language`. Armenian
      lives at the unprefixed root, so without the cookie a browser that asks for
      Russian is redirected off it and the project would silently test the wrong
      language.
    */
    await context.addCookies([
      { name: 'NEXT_LOCALE', value: locale, domain: 'localhost', path: '/' },
    ]);

    const app: AppFixture = {
      locale,
      t,

      async goto(path: string) {
        const prefix = locale === 'hy' ? '' : `/${locale}`;
        const target = `${prefix}${path}` || '/';
        await page.goto(target, { waitUntil: 'domcontentloaded' });
        await expect(page.locator('body')).toBeVisible();
      },

      async expectNoHorizontalOverflow(label: string) {
        const report = await page.evaluate(() => {
          const root = document.documentElement;
          const limit = root.clientWidth;
          const offenders: string[] = [];

          for (const element of Array.from(document.querySelectorAll('*'))) {
            const style = getComputedStyle(element);
            if (style.visibility === 'hidden' || style.display === 'none') continue;

            const box = element.getBoundingClientRect();
            if (box.width === 0 && box.height === 0) continue;

            // Anything inside a horizontal scroller is meant to extend past the
            // frame — the category rail is the obvious one.
            let parent = element.parentElement;
            let scrollable = false;
            while (parent) {
              if (/auto|scroll/.test(getComputedStyle(parent).overflowX)) {
                scrollable = true;
                break;
              }
              parent = parent.parentElement;
            }
            if (scrollable) continue;

            const right = box.right + window.scrollX;
            const left = box.left + window.scrollX;
            if (right <= limit + 1 && left >= -1) continue;

            /*
              Only elements that actually put something at that position count.

              A wrapper that is wider than the screen but paints nothing itself
              is not a defect a customer can see, and there is one on every page:
              the toast container, which sonner sizes to its own `--width` and
              offsets from the header. Its box reaches past a 393px screen while
              the toast inside it is narrower and fully visible.

              Text, controls and images are the things that get cut off, so those
              are what is reported — and a clipped control inside an oversized
              wrapper is still caught, because the control overflows too. The
              document-width assertion below is unaffected either way: it is what
              catches a page that genuinely scrolls sideways.
            */
            const paints =
              /^(img|svg|input|button|a|textarea|select)$/.test(element.tagName.toLowerCase()) ||
              Array.from(element.childNodes).some(
                (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
              );
            if (!paints) continue;

            const classes = String(element.getAttribute('class') ?? '').slice(0, 60);
            offenders.push(
              `<${element.tagName.toLowerCase()} class="${classes}"> right=${Math.round(right)}`,
            );
          }

          return { limit, documentWidth: root.scrollWidth, offenders: offenders.slice(0, 5) };
        });

        expect(report.offenders, `${label}: elements past the viewport`).toEqual([]);
        expect(report.documentWidth, `${label}: document scrolls sideways`).toBeLessThanOrEqual(
          report.limit + 1,
        );
      },

      async expectNoNewA11yViolations(label: string) {
        /*
          Wait for the interface to stop moving before measuring it.

          Contrast is computed from what is composited on screen, so an element
          caught halfway through a fade is measured at partial opacity and
          reported as failing text that reads perfectly once it arrives. That is
          a real property of the frame and a useless thing to assert about: the
          question is whether the settled interface is readable.

          `getAnimations()` covers CSS transitions, CSS animations and anything
          Motion drives through the Web Animations API, which is all three of the
          things that move here.
        */
        await page.waitForFunction(
          () =>
            document.getAnimations().every((animation) => {
              // A looping decoration never finishes and never needs to: it is
              // not a state the page is on its way out of.
              if (animation.effect?.getComputedTiming().iterations === Infinity) return true;
              // Neither does a scroll-linked one. The hero's parallax is driven
              // by scroll position rather than by time, so it reports as running
              // for as long as the page exists.
              if (!(animation.timeline instanceof DocumentTimeline)) return true;
              return animation.playState !== 'running';
            }),
          undefined,
          { timeout: 5_000 },
        );

        const results = await new AxeBuilder({ page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
          .analyze();

        /*
          Named down to the element. "color-contrast (5x serious)" tells you a
          rule failed; it does not tell you which text, on what, at what ratio —
          which is everything you need to fix it and all of it is in the result
          axe already returned.
        */
        const unexpected = results.violations
          .filter((violation) => !KNOWN_A11Y_VIOLATIONS.has(violation.id))
          .flatMap((violation) =>
            violation.nodes.map((node) => {
              const data = (node.any[0]?.data ?? {}) as Record<string, unknown>;
              const detail = data.contrastRatio
                ? ` fg=${data.fgColor} bg=${data.bgColor} ratio=${data.contrastRatio}`
                : '';
              return `${violation.id} [${node.target.join(' ')}]${detail} — ${String(node.html).slice(0, 90)}`;
            }),
          );

        expect(unexpected, `${label}: new accessibility violations`).toEqual([]);
      },
    };

    await use(app);
  },
});

export { expect };

/** The dram sign. Every amount on the site carries it, in every language. */
export const DRAM = '֏';

/** `4 300 ֏` / `4300 ֏` / `֏4,300` → 4300, whichever language rendered it. */
export function parseAmount(text: string): number {
  const digits = text.replace(/[^\d]/g, '');
  if (digits.length === 0) throw new Error(`no amount in ${JSON.stringify(text)}`);
  return Number(digits);
}

/** The amount rendered by a single element. */
export async function amountOf(page: Page, selector: string): Promise<number> {
  return parseAmount(await page.locator(selector).innerText());
}
