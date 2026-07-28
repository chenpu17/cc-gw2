/**
 * Seeded data-state visual regression (desktop-zh only — `@data` is in the
 * en/narrow `grepInvert` list). Generates realistic traffic through the gateway
 * before navigating, so dashboard / logs show populated metrics, charts and
 * rows rather than empty-state shells (covered by visual.spec.ts).
 */
import { visualTest as test, expect, expectPageSnapshot, waitForVisualReady } from './visual-helpers'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

test.describe('@data seeded data-state', () => {
  test.beforeAll(async ({ request }) => {
    const baseUrl = harness.baseUrl()
    // Mix of anthropic-protocol and openai-protocol requests to vary the logs.
    for (let i = 0; i < 12; i += 1) {
      await request.post(`${baseUrl}/v1/messages`, {
        data: {
          model: 'stub-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: `data-state request ${i}` }] }],
        },
        headers: { 'content-type': 'application/json' },
      })
    }
    for (let i = 0; i < 4; i += 1) {
      await request.post(`${baseUrl}/v1/chat/completions`, {
        data: {
          model: 'stub-model',
          messages: [{ role: 'user', content: `openai data-state ${i}` }],
        },
        headers: { 'content-type': 'application/json' },
      })
    }
    // A couple of auth failures populate an error/warn event + a 401 log row.
    for (let i = 0; i < 2; i += 1) {
      await request.post(`${baseUrl}/v1/messages`, {
        data: { model: 'stub-model', messages: [{ role: 'user', content: 'bad' }] },
        headers: { 'content-type': 'application/json', 'x-api-key': `invalid-${i}` },
      })
    }
  })

  test('dashboard with seeded traffic', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    // Let the daily-metrics / model-usage queries settle after first paint.
    await page.waitForTimeout(500)
    await expectPageSnapshot(page, 'data-dashboard.png', { fullPage: true })
  })

  test('logs with seeded rows', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/logs`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await expect(page.locator('tbody tr').first()).toBeVisible()
    await page.waitForTimeout(300)
    await expectPageSnapshot(page, 'data-logs.png', { fullPage: true })
  })

  test('events with seeded entries', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/events`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.waitForTimeout(300)
    await expectPageSnapshot(page, 'data-events.png', { fullPage: true })
  })
})
