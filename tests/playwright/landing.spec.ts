import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

test('root landing page explains positioning', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/`)

  await expect(page.locator('h1')).toContainText('你的 API Key')
  await expect(page.getByText('不该躺在 30 个 .env 里')).toBeVisible()
  await expect(page.getByText('客户端只改 baseURL，不动业务逻辑')).toBeVisible()
  await expect(page.getByText('OpenAI SDK', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('用 Anthropic 的代码，调 GPT-4o；反过来也行')).toBeVisible()
  await expect(page.getByText('四段 payload，分开存')).toBeVisible()
  await expect(page.getByText('所有东西都在你机器的 ~/.cc-gw 下')).toBeVisible()
  await expect(page.locator('header').getByRole('link', { name: '打开控制台' })).toBeVisible()
  await expect(page.locator('button[aria-label="Copy install command"]')).toBeVisible()
  await expect(page.locator('button[aria-label="Copy step 1: Install"]')).toBeVisible()
  await expect(page.getByRole('img', { name: 'cc-gw dashboard screenshot' })).toBeVisible()
})

test('landing exposes a language toggle', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/`)
  const toggle = page.getByRole('button', { name: 'Toggle language' })
  await expect(toggle).toBeVisible()
  await toggle.click()
  await expect(page.locator('h1')).toContainText('Your API key')
  await expect(page.getByText('shouldn’t live in 30 .env files')).toBeVisible()
})

test('mobile landing keeps section navigation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${harness.baseUrl()}/`)

  const mobileNav = page.getByRole('navigation', { name: 'Mobile section navigation' })
  await expect(mobileNav).toBeVisible()
  await expect(mobileNav.getByRole('link', { name: '怎么用' })).toBeVisible()
  await expect(mobileNav.getByRole('link', { name: '开始' })).toBeVisible()
  await expect(mobileNav.getByRole('link', { name: '打开控制台' })).toBeVisible()
})

test('root landing and /ui split stay reachable', async ({ request }) => {
  const landing = await request.get(`${harness.baseUrl()}/`)
  expect(landing.ok()).toBeTruthy()
  expect(landing.headers()['content-type']).toContain('text/html')
  const landingHtml = await landing.text()
  expect(landingHtml).toContain('landing-root')
  expect(landingHtml).toContain('你的 API Key 不该躺在 30 个 .env 里')
  expect(landingHtml).toContain('local-first AI gateway')

  const consoleEntry = await request.get(`${harness.baseUrl()}/ui/`)
  expect(consoleEntry.ok()).toBeTruthy()
  expect(consoleEntry.headers()['content-type']).toContain('text/html')
})

test('landing share asset is publicly reachable', async ({ request }) => {
  const png = await request.get(`${harness.baseUrl()}/cc-gw-social-card.png`)
  expect(png.ok()).toBeTruthy()
  expect(png.headers()['content-type']).toContain('image/png')

  const svg = await request.get(`${harness.baseUrl()}/cc-gw-social-card.svg`)
  expect(svg.ok()).toBeTruthy()
  expect(svg.headers()['content-type']).toContain('image/svg+xml')
  const body = await svg.text()
  expect(body).toContain('cc-gw')
})

test('landing robots file is reachable', async ({ request }) => {
  const robots = await request.get(`${harness.baseUrl()}/robots.txt`)
  expect(robots.ok()).toBeTruthy()
  expect(await robots.text()).toContain('Sitemap: /sitemap.xml')
})

test('landing manifest file is reachable', async ({ request }) => {
  const manifest = await request.get(`${harness.baseUrl()}/site.webmanifest`)
  expect(manifest.ok()).toBeTruthy()
  expect(manifest.headers()['content-type']).toContain('application/manifest+json')
  const body = await manifest.text()
  expect(body).toContain('"name": "cc-gw"')
  expect(body).toContain('"start_url": "/"')
})
