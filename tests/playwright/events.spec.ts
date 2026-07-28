import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const credentials = {
  username: 'events-admin',
  password: 'secret123',
}

const harness = createGatewayHarness({
  auth: {
    enabled: true,
    username: credentials.username,
    password: credentials.password,
  },
})

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

test('events page supports live stream, level filtering, type filtering, and reset flows', async ({ page }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/login`)
  await expect(page.getByRole('heading', { name: '登录 cc-gw 控制台' })).toBeVisible()

  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page.getByText('登录失败，请检查账号或密码后重试')).toBeVisible()

  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/ui\/?$/)

  await page.goto(`${baseUrl}/ui/events`)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /事件/ })).toBeVisible()
  await expect(page.getByTestId('events-filters-card')).toHaveCSS('position', 'static')
  await expect(page.getByText('Web login failed')).toBeVisible()
  await expect(page.getByText('Web login succeeded')).toBeVisible()
  // 头部统计卡(后端 /api/events/stats 全量聚合)反映了上面的登录事件:
  // web_auth_login_failure(warn)+ web_auth_login_success(info)
  const statsGrid = page.getByTestId('events-stats-grid')
  await expect(statsGrid.getByTestId('events-stat-warn')).toContainText(/[1-9]/)
  await expect(statsGrid.getByTestId('events-stat-info')).toContainText(/[1-9]/)
  await expect(statsGrid.getByTestId('events-stat-total')).toContainText(/[1-9]/)
  // SSE 实时流已连接
  await expect(page.getByText('实时更新中')).toBeVisible()

  // 级别筛选改为 SegmentedControl
  const levelFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/events')
      && url.searchParams.get('level') === 'warn'
  })
  await page.getByRole('button', { name: '警告', exact: true }).click()
  await levelFilterResponse

  // 类型过滤改为枚举下拉
  const typeFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/events')
      && url.searchParams.get('level') === 'warn'
      && url.searchParams.get('type') === 'web_auth_login_failure'
  })
  await page.getByRole('combobox').click()
  await page.getByRole('option', { name: 'web_auth_login_failure' }).click()
  await typeFilterResponse

  await expect(page.getByText('web_auth_login_failure', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Invalid credentials')).toBeVisible()
  await expect(page.getByText('Web login succeeded')).not.toBeVisible()

  await page.getByRole('button', { name: '重置' }).first().click()
  await expect(page.getByRole('combobox')).toContainText('全部类型')
  await expect(page.getByText('Web login failed')).toBeVisible()
  await expect(page.getByText('Web login succeeded')).toBeVisible()

  // 手动刷新按钮仅在断连时出现；通过切换级别验证列表会重新拉取
  const infoFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/events')
      && url.searchParams.get('level') === 'info'
  })
  await page.getByRole('button', { name: '提示', exact: true }).click()
  await infoFilterResponse
})
