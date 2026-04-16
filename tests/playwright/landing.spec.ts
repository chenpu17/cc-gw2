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

  await expect(page.locator('h1')).toContainText('别再让 AI 配置')
  await expect(page.getByText('散落在每个项目里')).toBeVisible()
  await expect(page.getByText('不用在每个项目里重复配置 baseURL 和 API Key')).toBeVisible()
  await expect(page.getByText('OpenAI SDK', { exact: true })).toBeVisible()
  await expect(page.getByText('Key 管理，不再散落在脚本里')).toBeVisible()
  await expect(page.getByText('先接一个客户端，马上看到价值')).toBeVisible()
  await expect(page.getByText('控制台不是摆设，是你每天排查和切换的地方')).toBeVisible()
  await expect(page.locator('header').getByRole('link', { name: '打开控制台' })).toBeVisible()
  await expect(page.locator('button[aria-label="复制 先在本地跑起来代码"]')).toBeVisible()
  await expect(page.getByRole('img', { name: 'cc-gw dashboard screenshot' })).toBeVisible()
})

test('mobile landing keeps section navigation reachable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 })
  await page.goto(`${harness.baseUrl()}/`)

  const mobileNav = page.getByRole('navigation', { name: '移动端页面导航' })
  await expect(mobileNav).toBeVisible()
  await expect(mobileNav.getByRole('link', { name: '收益' })).toBeVisible()
  await expect(mobileNav.getByRole('link', { name: '开始' })).toBeVisible()
  await expect(mobileNav.getByRole('link', { name: '打开控制台' })).toBeVisible()
})

test('root landing and /ui split stay reachable', async ({ request }) => {
  const landing = await request.get(`${harness.baseUrl()}/`)
  expect(landing.ok()).toBeTruthy()
  expect(landing.headers()['content-type']).toContain('text/html')
  const landingHtml = await landing.text()
  expect(landingHtml).toContain('landing-root')
  expect(landingHtml).toContain('别再让 AI 配置散落在每个项目里')
  expect(landingHtml).toContain('统一 OpenAI / Anthropic 协议入口')

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
