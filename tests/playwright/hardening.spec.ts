import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

test('settings supports https protocol save flow with restart-required hint', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/settings`)
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible()

  const protocolSection = page.locator('#section-protocol')
  await protocolSection.getByRole('switch').nth(1).click()

  await protocolSection.getByPlaceholder('~/.cc-gw/certs/key.pem').fill('/tmp/cc-gw/key.pem')
  await protocolSection.getByPlaceholder('~/.cc-gw/certs/cert.pem').fill('/tmp/cc-gw/cert.pem')
  await protocolSection.getByPlaceholder('留空则不使用').fill('/tmp/cc-gw/ca.pem')

  await expect(page.getByText('待保存 1 项')).toBeVisible()
  await expect(page.getByText('cc-gw restart --daemon', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '保存设置' }).first().click()
  await expect(page.getByText(/请执行 cc-gw restart --daemon 重启服务使协议配置生效|系统配置已更新|配置已保存/)).toBeVisible()

  const updatedConfigResponse = await request.get(`${baseUrl}/api/config/info`)
  expect(updatedConfigResponse.status()).toBe(200)
  const updatedConfigInfo = await updatedConfigResponse.json()
  expect(updatedConfigInfo.config.https.enabled).toBe(true)
  expect(updatedConfigInfo.config.https.keyPath).toBe('/tmp/cc-gw/key.pem')
  expect(updatedConfigInfo.config.https.certPath).toBe('/tmp/cc-gw/cert.pem')
  expect(updatedConfigInfo.config.https.caPath).toBe('/tmp/cc-gw/ca.pem')
})

test('help page code blocks can be copied end-to-end', async ({ page, context }) => {
  const baseUrl = harness.baseUrl()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })

  await page.goto(`${baseUrl}/ui/help`)
  await expect(page.getByRole('heading', { name: '使用指南', level: 1 })).toBeVisible()

  const firstCodeBlock = page.locator('pre code').first()
  await expect(firstCodeBlock).toBeVisible()
  const expectedCode = (await firstCodeBlock.textContent())?.trim() ?? ''

  await page.getByRole('button', { name: '复制' }).first().click()
  const copiedText = await page.evaluate(() => navigator.clipboard.readText())
  expect(copiedText.trim()).toBe(expectedCode)
})

test('about page keeps manual refresh semantics and checks npm updates through the backend', async ({ page }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/about`)
  await expect(page.getByRole('heading', { name: '关于', level: 1 })).toBeVisible()

  const refreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname.endsWith('/api/status')
  })
  await page.getByRole('button', { name: '刷新' }).click()
  await refreshResponse
  await expect(page.locator('#main-content').getByText('运行状态', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: '检查更新' }).click()
  await expect(page.locator('#main-content').getByText(/当前已是最新版本 v0\.8\.3/)).toBeVisible()
})
