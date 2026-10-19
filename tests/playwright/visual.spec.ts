import type { Page } from '@playwright/test'
import { createGatewayHarness } from './harness'
import {
  expect,
  visualTest as test,
  waitForVisualReady,
  expectPageSnapshot,
  hideVolatileVisualValues,
} from './visual-helpers'

const harness = createGatewayHarness()
const authHarness = createGatewayHarness({
  auth: {
    enabled: true,
    username: 'visual-admin',
    password: 'secret123',
  },
})
// The events page renders the *whole* event log, so its baseline would encode
// how many events the earlier tests in this file happened to record (and would
// silently change if one of them were edited). Its own harness keeps the log to
// exactly what this test seeds.
const eventsHarness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
  await authHarness.start()
  await eventsHarness.start()
})

test.afterAll(async () => {
  await eventsHarness.stop()
  await authHarness.stop()
  await harness.stop()
})

// Locale-agnostic anchor: every page exposes exactly one top-level <h1>.
// Avoids hard-coding zh heading copy so the same suite runs under en too.
function h1(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

/** The primary accent token, as `getComputedStyle` would report it in RGB. */
const PRIMARY_ACCENT: [number, number, number] = [236, 48, 19] // --primary #ec3013

/**
 * Normalize a computed color to RGB. The Tailwind tokens go through relative
 * color syntax (`rgb(from var(--x) r g b / <alpha-value>)`), which Chromium
 * serializes as `color(srgb r g b)` with 0–1 components rather than `rgb()`.
 */
function toRgb(value: string): [number, number, number] {
  const srgb = value.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)/)
  if (srgb) {
    return [1, 2, 3].map((i) => Math.round(Number(srgb[i]) * 255)) as [number, number, number]
  }
  const rgb = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/)
  if (rgb) {
    return [1, 2, 3].map((i) => Number(rgb[i])) as [number, number, number]
  }
  throw new Error(`unparsed color: ${value}`)
}

test('dashboard visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)
  await waitForVisualReady(page, h1(page))
  // The runtime address carries the harness's ephemeral port.
  await hideVolatileVisualValues(page)
  await expectPageSnapshot(page, 'dashboard-page.png', { fullPage: true })
})

test('landing visual shell stays aligned with product-site baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/`)
  await waitForVisualReady(page, h1(page))
  await expectPageSnapshot(page, 'landing-page.png')
})

test('logs visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/logs`)
  await waitForVisualReady(page, h1(page))
  await expectPageSnapshot(page, 'logs-page.png', { fullPage: true })
})

test('providers workbench visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/providers`)
  await waitForVisualReady(page, h1(page))
  await expectPageSnapshot(page, 'model-management-page.png')
})

test('routing workbench visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing`)
  await waitForVisualReady(page, h1(page))
  // Wait for the routing simulator to resolve a hit (target line contains →)
  // so we don't capture a loading skeleton.
  await expect(page.getByTestId('routing-hit-simulator')).toContainText('→')
  await expectPageSnapshot(page, 'routing-workbench-page.png')
})

test('api keys visual shell stays aligned with redesign baseline', async ({ page, request }) => {
  // The enable/disable toggle's variant only differs on a *disabled* row: with
  // every key enabled, `variant="outline"` and the old conditional render the
  // same. Turn the wildcard off so the off state is in frame, then restore it
  // so later tests in this file still see the default key state.
  const list = await request.get(`${harness.baseUrl()}/api/keys`)
  const wildcard = (await list.json()).find((k: { isWildcard: boolean }) => k.isWildcard)
  const toggleWildcard = (enabled: boolean) =>
    wildcard
      ? request.patch(`${harness.baseUrl()}/api/keys/${wildcard.id}`, { data: { enabled } })
      : Promise.resolve()
  await toggleWildcard(false)

  try {
    await page.goto(`${harness.baseUrl()}/ui/api-keys`)
    await waitForVisualReady(page, h1(page))
    await hideVolatileVisualValues(page)

    // The snapshot alone cannot guard this: one button is ~1324 px = 0.077% of
    // the image, well under the 1.5% tolerance, so reverting the variant to
    // `enabled ? 'outline' : 'default'` would still pass. Assert the computed
    // fill instead — the off-state toggle must not carry the primary accent.
    const toggle = page.locator('[data-testid="api-key-toggle"]:visible').first()
    await expect(toggle).toBeVisible()
    const fill = await toggle.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(toRgb(fill), 'disabled-key toggle must not use the primary accent').not.toEqual(PRIMARY_ACCENT)

    await expectPageSnapshot(page, 'api-keys-page.png')
  } finally {
    await toggleWildcard(true)
  }
})

test('settings visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/settings`)
  await waitForVisualReady(page, h1(page))
  // Two port fields default to the harness's ephemeral port.
  await hideVolatileVisualValues(page)
  await expectPageSnapshot(page, 'settings-page.png', { fullPage: true })
})

test('events visual shell stays aligned with redesign baseline', async ({ page, request }) => {
  // Seed one event (creating an API key records an `api_key_created` event) so
  // the pager strip's page-count readout renders. With zero events it is
  // absent, which left its position in the strip untested. On this harness's
  // empty log that is the *only* event, so the counts are deterministic too.
  await request.post(`${eventsHarness.baseUrl()}/api/keys`, { data: { name: 'Visual Event Seed' } })

  await page.goto(`${eventsHarness.baseUrl()}/ui/events`)
  await waitForVisualReady(page, h1(page))
  // Two matches by design: the card's message and its API-key meta chip.
  await expect(page.getByText('Visual Event Seed').first()).toBeVisible()
  await hideVolatileVisualValues(page)
  await expectPageSnapshot(page, 'events-page.png', { fullPage: true })
})

test('help visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/help`)
  await waitForVisualReady(page, h1(page))
  await expectPageSnapshot(page, 'help-page.png', { fullPage: true })
})

test('about visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/about`)
  await waitForVisualReady(page, h1(page))
  await hideVolatileVisualValues(page)
  await expectPageSnapshot(page, 'about-page.png')
})

test('login visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${authHarness.baseUrl()}/ui/login`)
  // The page <h1> sits in the marketing panel (hidden lg:block), so it's
  // invisible at narrow widths. Anchor on the always-visible username field.
  await waitForVisualReady(page, page.locator('#username'))
  await expectPageSnapshot(page, 'login-page.png')
})
