import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

test('web console pages load and navigation works', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)

  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await expect(page.getByText('今日请求数')).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新' })).toBeVisible()
  await expect(page.getByRole('button', { name: '释放数据库空间' })).toBeVisible()

  await page.getByRole('link', { name: '请求日志' }).click()
  await expect(page).toHaveURL(/\/ui\/logs$/)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: '模型与路由管理' }).click()
  await expect(page).toHaveURL(/\/ui\/models$/)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: '事件' }).click()
  await expect(page).toHaveURL(/\/ui\/events$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /事件/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '最新' })).toBeVisible()
  await expect(page.getByPlaceholder('按事件类型过滤（可留空）')).toBeVisible()

  await page.getByRole('link', { name: 'API 密钥' }).click()
  await expect(page).toHaveURL(/\/ui\/api-keys$/)
  await expect(page.getByRole('heading', { name: 'API 密钥管理', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: '设置' }).click()
  await expect(page).toHaveURL(/\/ui\/settings$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /设置/ })).toBeVisible()

  await page.getByRole('link', { name: '使用指南' }).click()
  await expect(page).toHaveURL(/\/ui\/help$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /使用指南/ })).toBeVisible()

  await page.getByRole('link', { name: '关于' }).click()
  await expect(page).toHaveURL(/\/ui\/about$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /关于/ })).toBeVisible()
})

test('theme and language switchers open menus', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()

  await page.getByTestId('theme-switcher-trigger').click({ force: true })
  await expect(page.getByRole('menuitem', { name: '亮色' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: '跟随系统' })).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('menuitem', { name: '亮色' })).not.toBeVisible()
  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await expect(page.getByRole('menuitem', { name: '中文' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'English' })).toBeVisible()
})

test('deep links and language preference survive reloads under /ui basename', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/models`)
  await expect(page).toHaveURL(/\/ui\/models$/)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/ui\/models$/)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible()

  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Models & Routing', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Models & Routing', level: 1 })).toBeVisible()

  await page.goto(`${harness.baseUrl()}/ui/not-found`)
  await expect(page).toHaveURL(/\/ui\/?$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
})
