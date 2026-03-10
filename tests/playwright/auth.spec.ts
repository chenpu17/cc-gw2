import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const credentials = {
  username: 'playwright-admin',
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

test('unauthenticated users are redirected to login and can sign in/out', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/logs`)

  await expect(page).toHaveURL(/\/ui\/login$/)
  await expect(page.getByText('登录 cc-gw 控制台')).toBeVisible()

  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill(credentials.password)
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page).toHaveURL(/\/ui\/logs$/)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.getByText(`已登录：${credentials.username}`)).toBeVisible()

  await page.getByRole('button', { name: '退出登录' }).click()
  await expect(page).toHaveURL(/\/ui\/login$/)
  await expect(page.getByText('登录 cc-gw 控制台')).toBeVisible()
})

test('login rejects invalid credentials', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)

  await expect(page).toHaveURL(/\/ui\/login$/)
  await page.getByLabel('用户名').fill(credentials.username)
  await page.getByLabel('密码').fill('wrong-password')
  await page.getByRole('button', { name: '登录' }).click()

  await expect(page.getByText('登录失败，请检查账号或密码后重试')).toBeVisible()
  await expect(page).toHaveURL(/\/ui\/login$/)
})
