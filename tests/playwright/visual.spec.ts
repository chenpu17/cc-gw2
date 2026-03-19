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
  await page.waitForLoadState('networkidle')
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

test('dashboard visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '仪表盘', level: 1 }))
  await expectPageSnapshot(page, 'dashboard-page.png')
})

test('logs visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/logs`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '请求日志', level: 1 }))
  await expectPageSnapshot(page, 'logs-page.png')
})

test('model management visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/models`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '模型与路由管理', level: 1 }))
  await expectPageSnapshot(page, 'model-management-page.png')
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
  await expectPageSnapshot(page, 'help-page.png')
})

test('about visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/about`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }).filter({ hasText: /关于/ }))
  await expectPageSnapshot(page, 'about-page.png')
})

test('login visual shell stays aligned with redesign baseline', async ({ page }) => {
  await page.goto(`${authHarness.baseUrl()}/ui/login`)
  await waitForVisualReady(page, page.getByRole('heading', { name: '登录', level: 1 }))
  await expectPageSnapshot(page, 'login-page.png')
})
