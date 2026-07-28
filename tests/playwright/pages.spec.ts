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
  // 无数据时首屏为新手引导卡；刷新按钮始终在工具栏
  await expect(page.getByText('先走通这三步')).toBeVisible()
  await expect(page.getByRole('button', { name: '刷新' })).toBeVisible()

  await page.getByRole('link', { name: '请求日志' }).click()
  await expect(page).toHaveURL(/\/ui\/logs$/)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()

  // /models 与 /routing 已合并为 /providers 工作台
  await page.getByRole('link', { name: '模型与路由' }).first().click()
  await expect(page).toHaveURL(/\/ui\/providers$/)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()
  // 默认进入「供应商」视图
  await expect(page.getByRole('button', { name: '新增提供商' })).toBeVisible()
  await expect(page.getByText('配置导览')).toHaveCount(0)
  // 端点与路由规则在「路由」视图中：主体是端点表格，工具栏提供「新建端点」
  await page.getByRole('tab', { name: '路由' }).click()
  await expect(page).toHaveURL(/\/ui\/providers\?tab=routing$/)
  await expect(page.getByRole('button', { name: '新建端点' }).first()).toBeVisible()
  await expect(page.getByRole('button', { name: '管理端点' })).toHaveCount(0)
  // 端点 rail：点击内置端点选中它（URL 带上 endpoint 参数，不再开弹窗）
  await page.locator('[data-testid="endpoint-row"]').filter({ hasText: 'Anthropic' }).first().click()
  await expect(page).toHaveURL(/\/ui\/providers\?tab=routing&endpoint=anthropic$/)
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()
  // 三栏内联：规则、模板、命中模拟 常驻可见（不再折叠进「高级」Disclosure）
  await expect(workspace.getByTestId('routing-rules-card')).toBeVisible()
  await expect(workspace.getByTestId('routing-presets-card')).toBeVisible()
  await expect(workspace.getByTestId('routing-hit-simulator')).toBeVisible()

  await page.getByRole('link', { name: '事件' }).click()
  await expect(page).toHaveURL(/\/ui\/events$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /事件/ })).toBeVisible()
  await expect(page.getByRole('button', { name: '最新' })).toBeVisible()
  // 事件类型过滤改为枚举下拉
  await expect(page.getByRole('combobox')).toBeVisible()

  await page.getByRole('link', { name: 'API 密钥' }).click()
  await expect(page).toHaveURL(/\/ui\/api-keys$/)
  await expect(page.getByRole('heading', { name: 'API 密钥管理', level: 1 })).toBeVisible()

  await page.getByRole('link', { name: '设置' }).click()
  await expect(page).toHaveURL(/\/ui\/settings$/)
  await expect(page.getByRole('heading', { level: 1 }).filter({ hasText: /设置/ })).toBeVisible()

  // 使用指南已从侧边导航移除，仅保留直达路由
  await page.goto(`${harness.baseUrl()}/ui/help`)
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
  // 旧路径 /ui/models 会重定向到 /ui/providers
  await page.goto(`${harness.baseUrl()}/ui/models`)
  await expect(page).toHaveURL(/\/ui\/providers$/)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/ui\/providers$/)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await page.getByRole('menuitem', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Providers & Routing Workbench', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Providers & Routing Workbench', level: 1 })).toBeVisible()

  await page.goto(`${harness.baseUrl()}/ui/not-found`)
  await expect(page).toHaveURL(/\/ui\/?$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
})
