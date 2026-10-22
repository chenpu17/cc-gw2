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

  // 「模型与路由」拆为 提供商 /providers + 路由 /routing 两个独立页
  await page.getByRole('link', { name: '提供商' }).first().click()
  await expect(page).toHaveURL(/\/ui\/providers$/)
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '新增提供商' })).toBeVisible()
  await expect(page.getByText('配置导览')).toHaveCount(0)

  await page.getByRole('link', { name: '路由' }).first().click()
  await expect(page).toHaveURL(/\/ui\/routing(\?endpoint=anthropic)?$/)
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()
  await expect(page.getByRole('button', { name: '新建端点' }).first()).toBeVisible()
  // 旧「管理端点」入口已退役；端点的编辑/删除挂在左栏 rail 自定义行行内
  await expect(page.getByRole('button', { name: '管理端点' })).toHaveCount(0)
  // 端点导航栏：点击内置端点 OpenAI 行，选中即同步 URL（默认已选
  // Anthropic，重复点同一行无变化，所以换另一内置端点来验证）。
  await page.getByTestId('routing-endpoint-row').filter({ hasText: 'OpenAI' }).locator('button').first().click()
  await expect(page).toHaveURL(/\/ui\/routing\?endpoint=openai$/)
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()
  // 两栏内联：规则与命中模拟常驻；模板移入「模板」工具栏弹窗
  await expect(workspace.getByTestId('routing-rules-card')).toBeVisible()
  await expect(workspace.getByTestId('routing-hit-simulator')).toBeVisible()
  await page.getByRole('button', { name: '模板' }).click()
  const presetsDialog = page.getByRole('dialog', { name: '路由模板' })
  await expect(presetsDialog.getByTestId('routing-presets-card')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(presetsDialog).not.toBeVisible()

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

  // 使用指南已回到侧边导航「系统」组，命令行面板同样可检索
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
  await expect(page.getByRole('menuitemradio', { name: '亮色' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: '跟随系统' })).toBeVisible()
  // 风格家族分组:五个可选项
  for (const family of ['极简', '经典', '纸张', '玻璃', 'Modernist']) {
    await expect(page.getByRole('menuitemradio', { name: family })).toBeVisible()
  }
  // 点击切族 → data-skin 立即生效 → reload 后持久化 → 切回默认
  await page.getByRole('menuitemradio', { name: '纸张' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'paper')
  await page.reload()
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'paper')
  await page.getByTestId('theme-switcher-trigger').click({ force: true })
  await page.getByRole('menuitemradio', { name: '极简' }).click()
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'minimal')

  await page.goto(`${harness.baseUrl()}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await expect(page.getByRole('menuitemradio', { name: '中文' })).toBeVisible()
  await expect(page.getByRole('menuitemradio', { name: 'English' })).toBeVisible()
})

test('deep links and language preference survive reloads under /ui basename', async ({ page }) => {
  // 旧路径 /ui/models 会重定向到 /ui/providers（提供商页）
  await page.goto(`${harness.baseUrl()}/ui/models`)
  await expect(page).toHaveURL(/\/ui\/providers$/)
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page).toHaveURL(/\/ui\/providers$/)
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()

  // 旧合并页 ?tab=routing 深链重定向到独立 /routing 页（端点参数透传）
  await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing&endpoint=anthropic`)
  await expect(page).toHaveURL(/\/ui\/routing\?endpoint=anthropic$/)
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()

  await page.goto(`${harness.baseUrl()}/ui/providers`)
  await page.getByTestId('language-switcher-trigger').click({ force: true })
  await page.getByRole('menuitemradio', { name: 'English' }).click()
  await expect(page.getByRole('heading', { name: 'Providers', level: 1 })).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: 'Providers', level: 1 })).toBeVisible()

  await page.goto(`${harness.baseUrl()}/ui/not-found`)
  await expect(page).toHaveURL(/\/ui\/?$/)
  await expect(page.getByRole('heading', { name: 'Dashboard', level: 1 })).toBeVisible()
})
