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

test('events page supports refresh, level filtering, type filtering, and reset flows', async ({ page }) => {
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

  const levelSelect = page.getByRole('combobox').first()
  const levelFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/events')
      && url.searchParams.get('level') === 'warn'
  })
  await levelSelect.click()
  await page.getByRole('option', { name: '警告' }).click()
  await levelFilterResponse

  const typeInput = page.getByPlaceholder('按事件类型过滤（可留空）')
  const typeFilterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/events')
      && url.searchParams.get('level') === 'warn'
      && url.searchParams.get('type') === 'web_auth_login_failure'
  })
  await typeInput.fill('web_auth_login_failure')
  await typeFilterResponse

  await expect(page.getByText('web_auth_login_failure', { exact: true }).first()).toBeVisible()
  await expect(page.getByText('Invalid credentials')).toBeVisible()
  await expect(page.getByText('Web login succeeded')).not.toBeVisible()

  await page.getByRole('button', { name: '重置' }).first().click()
  await expect(typeInput).toHaveValue('')
  await expect(page.getByText('Web login failed')).toBeVisible()
  await expect(page.getByText('Web login succeeded')).toBeVisible()

  const refreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/events')
  })
  await page.getByRole('button', { name: '刷新' }).click()
  await refreshResponse
})
