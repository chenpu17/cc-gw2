import { expect, test, type Locator, type Page } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()
const authHarness = createGatewayHarness({
  auth: {
    enabled: true,
    username: 'visual-admin',
    password: 'secret123',
  },
})

test.use({
  viewport: { width: 1440, height: 1200 },
  colorScheme: 'light',
})

test.beforeAll(async () => {
  await harness.start()
  await authHarness.start()
})

test.afterAll(async () => {
  await authHarness.stop()
  await harness.stop()
})

async function waitForVisualReady(page: Page, anchor: Locator) {
  await anchor.waitFor({ state: 'visible' })
  // Dashboard/Events 挂了 SSE 长连接，networkidle 永远等不到，改用 load + 固定沉降时间
  await page.waitForLoadState('load')
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready
    }
  })
  await page.waitForTimeout(350)
}

async function expectPageSnapshot(page: Page, name: string) {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: false,
    maxDiffPixelRatio: 0.015,
  })
}

async function hideVolatileVisualValues(page: Page) {
  await page.addStyleTag({
    content: '[data-visual-volatile="true"] { visibility: hidden !important; }',
  })
}

test('dashboard visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '仪表盘', level: 1 }))
  await expectPageSnapshot(page, 'dashboard-page.png')
})

test('landing visual shell stays aligned with product-site baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/`)
  await waitForVisualReady(page, page.locator('h1'))
  await expectPageSnapshot(page, 'landing-page.png')
})

test('logs visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/logs`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '请求日志', level: 1 }))
  await expectPageSnapshot(page, 'logs-page.png')
})

test('providers workbench visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/providers`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '模型与路由工作台', level: 1 }))
  await expectPageSnapshot(page, 'model-management-page.png')
})

test('routing workbench visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '模型与路由工作台', level: 1 }))
  // 命中模拟器:等待解析结果落地(目标行始终含 →),避免截到加载骨架
  await expect(page.getByTestId('routing-hit-simulator')).toContainText('→')
  await expectPageSnapshot(page, 'routing-workbench-page.png')
})

test('api keys visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/api-keys`)
  await waitForVisualReady(page, page.getByRole('heading', { name: 'API 密钥管理', level: 1 }))
  await expectPageSnapshot(page, 'api-keys-page.png')
})

test('settings visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/settings`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '设置', level: 1 }))
  await expectPageSnapshot(page, 'settings-page.png')
})

test('events visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/events`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }).filter({ hasText: /事件/ }))
  await expectPageSnapshot(page, 'events-page.png')
})

test('help visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/help`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }).filter({ hasText: /使用指南/ }))
  await expect(page).toHaveScreenshot('help-page.png', {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixelRatio: 0.015,
  })
})

test('about visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/about`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }).filter({ hasText: /关于/ }))
  await hideVolatileVisualValues(page)
  await expectPageSnapshot(page, 'about-page.png')
})

test('login visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${authHarness.baseUrl()}/ui/login`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '登录', level: 1 }))
  await expectPageSnapshot(page, 'login-page.png')
})
