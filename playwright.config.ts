import { defineConfig, devices } from '@playwright/test';

import type { Locale } from './src/lib/i18n/locales';

/**
 * End-to-end tests, in two lanes.
 *
 * **Storefront** is everything that does not create an order: the menu, a dish
 * sheet with its required choice and its extras, the cart, and the checkout form
 * up to but not including the button. It carries the breadth — browsers, widths,
 * languages — plus the three checks that ride along on every page it visits: no
 * horizontal overflow, no unexpected console error, no new axe violation.
 *
 * **Ordering** is the two flows that reach a real record: delivery paid in cash,
 * and pickup paid through the stub acquirer. It carries the depth, runs only in
 * Chromium, and is the only lane that writes to the database.
 *
 * The split is what keeps the matrix small. A checkout total does not break
 * differently in WebKit, and a 320px layout does not break differently for cash
 * than for card — so each axis is varied where it can actually fail, and nowhere
 * else. Two ordering tests and one sweep per project cover what a naive
 * three-payments × two-fulfilments × three-locales × four-widths × three-browsers
 * matrix would have spent 216 runs on.
 */

const PORT = Number(process.env.E2E_PORT ?? 3100);

/** Locale and viewport travel together, so a project is one honest device. */
interface SweepProject {
  name: string;
  locale: Locale;
  /** What the browser reports, which is also what next-intl negotiates against. */
  acceptLanguage: string;
  browser: 'chromium' | 'firefox' | 'webkit';
  viewport: { width: number; height: number };
  touch: boolean;
}

/*
  Why these five and not more.

  Armenian is the default locale and the widest of the three — every layout
  failure this project has had showed up there first, so it gets the narrow
  widths. Russian is what the owner will be shown. English is the shortest and
  the least likely to break anything, so it gets a single desktop smoke.

  320 and 360 are the widths where the dish sheet and the menu card actually
  overflowed; 393 is the modern default. WebKit sits on mobile because Mobile
  Safari is the one engine the manual audit could not reach at all, and Firefox
  sits on desktop because that is where it costs least to keep.
*/
const SWEEP: SweepProject[] = [
  {
    name: 'hy-320-chromium',
    locale: 'hy',
    acceptLanguage: 'hy-AM',
    browser: 'chromium',
    viewport: { width: 320, height: 568 },
    touch: true,
  },
  {
    name: 'hy-360-webkit',
    locale: 'hy',
    acceptLanguage: 'hy-AM',
    browser: 'webkit',
    viewport: { width: 360, height: 800 },
    touch: true,
  },
  {
    name: 'ru-393-webkit',
    locale: 'ru',
    acceptLanguage: 'ru-RU',
    browser: 'webkit',
    viewport: { width: 393, height: 852 },
    touch: true,
  },
  {
    name: 'ru-desktop-chromium',
    locale: 'ru',
    acceptLanguage: 'ru-RU',
    browser: 'chromium',
    viewport: { width: 1280, height: 720 },
    touch: false,
  },
  {
    name: 'en-desktop-firefox',
    locale: 'en',
    acceptLanguage: 'en-US',
    browser: 'firefox',
    viewport: { width: 1280, height: 720 },
    touch: false,
  },
];

const engine = {
  chromium: devices['Desktop Chrome'],
  firefox: devices['Desktop Firefox'],
  webkit: devices['Desktop Safari'],
} as const;

export default defineConfig({
  testDir: './e2e',
  /*
    Files run in parallel, tests inside a file do not. That is the whole of the
    serialisation the ordering lane needs: both of its flows live in one file, so
    they queue behind each other on one worker without a special case here.
  */
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  /*
    Zero, deliberately, including in CI. A retry turns a flaky test into a green
    tick and a lost afternoon later; if something here is unstable the run should
    say so the first time.
  */
  retries: 0,
  workers: process.env.CI ? 3 : 4,
  timeout: 90_000,
  expect: { timeout: 10_000 },

  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }], ['list']]
    : [['list'], ['html', { open: 'never' }]],

  globalSetup: './e2e/support/global-setup.ts',
  globalTeardown: './e2e/support/global-teardown.ts',

  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    /*
      The application already branches on `prefers-reduced-motion` — the menu's
      scroll-spy and the map both read it — so asking for it here removes smooth
      scrolling and spring animations from the equation rather than papering over
      them with waits. It lives under `contextOptions` because that is where this
      version of Playwright accepts it.
    */
    contextOptions: { reducedMotion: 'reduce' },
    actionTimeout: 15_000,
  },

  projects: [
    ...SWEEP.map((project) => ({
      name: project.name,
      testMatch: /storefront\.spec\.ts/,
      metadata: { appLocale: project.locale },
      use: {
        ...engine[project.browser],
        viewport: project.viewport,
        hasTouch: project.touch,
        locale: project.acceptLanguage,
      },
    })),
    {
      name: 'a11y',
      testMatch: /a11y\.spec\.ts/,
      metadata: { appLocale: 'ru' as Locale },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, locale: 'ru-RU' },
    },
    {
      /*
        The only lane that writes. One browser, because the thing under test is
        the server's arithmetic and its record-keeping, and neither of those has
        an opinion about rendering engines.
      */
      name: 'ordering',
      testMatch: /ordering\.spec\.ts/,
      metadata: { appLocale: 'ru' as Locale },
      use: { ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 }, locale: 'ru-RU' },
    },
  ],

  webServer: {
    command: `pnpm build && pnpm exec next start --port ${PORT}`,
    /*
      The origin the application believes it is served from, which the payment
      adapter uses to build the page it sends a customer to and the URL it sends
      them back to. Left to its own devices it resolves to port 3000 — from
      `.env.local` on a developer's machine, and from the hard-coded fallback in
      `lib/site-url.ts` in CI — so the online flow redirected the browser to a
      port with nothing behind it and landed on a blank page.

      Set here rather than in an env file because it has to follow `E2E_PORT`,
      and passed to the command because `NEXT_PUBLIC_` values are inlined by the
      build rather than read at runtime. A real environment variable takes
      precedence over `.env.local`, so this wins without editing anything.
    */
    env: { NEXT_PUBLIC_SITE_URL: `http://localhost:${PORT}` },
    /*
      `port`, not `url`, and that is load-bearing. Waiting on a URL means
      Playwright fetches a page before the tests do, and that first render is
      enough to populate the sixty-second settings cache with the opening hours
      as they were *before* `globalSetup` widened them. Waiting for the port to
      accept a connection asks the server nothing, so the first request the
      application ever answers is a test's.
    */
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 240_000,
    stdout: 'pipe',
    stderr: 'pipe',
  },
});
