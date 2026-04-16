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

  await page.getByRole('link', { name: '模型供应商' }).first().click()
  await expect(page).toHaveURL(/\/ui\/models$/)
  await expect(page.getByRole('heading', { name: '模型提供商', level: 1 })).toBeVisible()
  await expect(page.getByText('配置导览')).toHaveCount(0)
  await expect(page.getByText('将资源池与流量入口拆开维护，减少信息混排。')).toHaveCount(0)
  await expect(page.getByText('Model Access')).toHaveCount(0)
  await expect(page.getByText('Configured')).toHaveCount(0)
  await expect(page.getByText('Visible')).toHaveCount(0)
  await expect(page.getByText('Connection Status')).toHaveCount(0)
  await expect(page.getByText('先维护上游 Provider 供应池，再进入路由管理为内置端点和自定义端点配置映射规则。')).toHaveCount(0)

  await page.getByRole('link', { name: '路由管理' }).first().click()
  await expect(page).toHaveURL(/\/ui\/routing$/)
  await expect(page.getByRole('heading', { name: '路由管理', level: 1 })).toBeVisible()
  await expect(page.getByText('配置导览')).toHaveCount(0)
  await expect(page.getByText('Current model routes')).toHaveCount(0)
  await expect(page.getByText('Reusable routing templates')).toHaveCount(0)
  await expect(page.getByText('Bound to this endpoint')).toHaveCount(0)
  await expect(page.getByText('Anthropic compatibility mode')).toHaveCount(0)
  await expect(page.getByText('当前工作区正在编辑')).toHaveCount(0)
  await expect(page.getByText('优先在此处切换和维护自定义端点')).toHaveCount(0)
  await expect(page.getByText('Provider 供应池')).toHaveCount(0)
  await expect(page.getByText('Endpoint 入口层')).toHaveCount(0)
  await expect(page.getByText('当前工作区', { exact: true })).toHaveCount(0)
  await expect(page.getByText('路由模板', { exact: true })).toBeVisible()
  await expect(page.getByText('路由操作', { exact: true })).toBeVisible()
  await expect(page.getByText('常用 Anthropic 模型', { exact: true })).toBeVisible()

  await page.getByRole('link', { name: '事件' }).click()
  await expect(page).toHaveURL(/\/ui\/events$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /事件/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '最新' })).toBeVisible()
  await expect(page.getByPlaceholder('按事件类型过滤（可留空）')).toBeVisible()

  await page.getByRole('link', { name: '性能分析' }).click()
  await expect(page).toHaveURL(/\/ui\/profiler$/)
  await expect(page.getByRole('heading', { name: '性能分析', level: 1 })).toBeVisible()

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
  await page.goto(`${harness.baseUrl()}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await expect(page.getByRole('menuitem', { name: '中文' })).toBeVisible()
  await expect(page.getByRole('menuitem', { name: 'English' })).toBeVisible()
})

test('deep links and language preference survive reloads under /ui basename', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/models`)
  await expect(page).toHaveURL(/\/ui\/models$/)
  await expect(page.getByRole('heading', { name: '模型提供商', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/ui\/models$/)
  await expect(page.getByRole('heading', { name: '模型提供商', level: 1 })).toBeVisible()

  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Model Providers', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Model Providers', level: 1 })).toBeVisible()

  await page.goto(`${harness.baseUrl()}/ui/not-found`)
  await expect(page).toHaveURL(/\/ui\/?$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
})
