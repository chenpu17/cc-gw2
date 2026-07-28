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

test.beforeAll(async () => {
  await harness.start()
  await authHarness.start()
})

test.afterAll(async () => {
  await authHarness.stop()
  await harness.stop()
})

// Locale-agnostic anchor: every page exposes exactly one top-level <h1>.
// Avoids hard-coding zh heading copy so the same suite runs under en too.
function h1(page: Page) {
  return page.getByRole('heading', { level: 1 })
}

test('dashboard visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)
  await waitForVisualReady(page, h1(page))
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

test('api keys visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/api-keys`)
  await waitForVisualReady(page, h1(page))
  await expectPageSnapshot(page, 'api-keys-page.png')
})

test('settings visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/settings`)
  await waitForVisualReady(page, h1(page))
  await expectPageSnapshot(page, 'settings-page.png', { fullPage: true })
})

test('events visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/events`)
  await waitForVisualReady(page, h1(page))
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
