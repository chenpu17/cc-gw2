import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

// 「流式请求携带 usage 统计」开关:开启后 Anthropic→OpenAI 流式转发会附加
// stream_options.include_usage，上游在流末尾返回 token 用量。
// 本 test 验证：UI 开关存在可勾选 → 保存后 config 持久化 streamUsage=true；
// 未勾选时字段保持缺省（不下发 false），兼容不认识该字段的旧后端。
// 注入行为本身已有 Rust 单测覆盖（proxy_routes::stream_options_*）。
test('streamUsage switch renders and persists via provider drawer', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const providerId = `stream-usage-${Date.now()}`

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const drawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await drawer.getByRole('button', { name: /OpenAI/ }).click()
  await drawer.getByPlaceholder('如 openai').fill(providerId)
  await drawer.getByPlaceholder('https://api.example.com/v1').fill('http://127.0.0.1:9/v1')

  // 展开高级选项，确认开关存在、默认关闭，可勾选
  await drawer.locator('summary').filter({ hasText: '高级选项' }).click()
  const usageSwitch = drawer.getByRole('switch', { name: '流式请求携带 usage 统计' })
  await expect(usageSwitch).toBeVisible()
  await expect(usageSwitch).not.toBeChecked()
  await usageSwitch.click()
  await expect(usageSwitch).toBeChecked()

  // 视觉验证：高级选项展开，含「非流式转流式」「使用绝对路径」「流式 usage 统计」四块
  await page.setViewportSize({ width: 1440, height: 1200 })
  await drawer.screenshot({ path: '/tmp/cc-gw-visual/drawer-stream-usage.png' })

  await drawer.getByRole('button', { name: '下一步' }).click()
  await drawer.getByRole('button', { name: '新增模型' }).click()
  await drawer.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model')
  await drawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText(`已添加 Provider：${providerId}`)).toBeVisible()

  // 持久化断言：开启的 provider streamUsage === true
  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const provider = config.providers.find((item: any) => item.id === providerId)
  expect(provider).toBeTruthy()
  expect(provider.streamUsage).toBe(true)

  // 兼容性断言：其余未开启的 provider 不携带该字段（而非 false），
  // 手改配置 / 旧配置里的 null 也不会被改写。
  for (const other of config.providers.filter((item: any) => item.id !== providerId)) {
    expect(other.streamUsage === undefined || other.streamUsage === null).toBeTruthy()
  }
})
