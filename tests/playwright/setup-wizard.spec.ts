import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

// 冷启动向导回归：/setup 复用 workbench 的 BasicsStep/ModelsStep/
// useProviderForm 共享原语（v0.15 重写了这些原语），这里钉住最小创建流：
// 类型卡 → id/baseUrl/key → 模型 → 保存并继续 → config 落库 → 进入路由步。
test('setup wizard creates a provider via the shared form primitives', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const stubBase = `http://127.0.0.1:${harness.stubPort}`

  // 冷启动形态：清空 providers，让向导从 provider 表单开始
  const cfgResp = await request.get(`${baseUrl}/api/config`)
  expect(cfgResp.ok()).toBeTruthy()
  const baseCfg: any = await cfgResp.json()
  const emptied = { ...baseCfg, providers: [] }
  const putResp = await request.put(`${baseUrl}/api/config`, { data: emptied })
  expect(putResp.ok(), 'PUT /api/config should succeed').toBeTruthy()

  await page.goto(`${baseUrl}/ui/setup`)
  await expect(page.getByRole('heading', { name: '引导设置', level: 1 })).toBeVisible()
  // 步骤标题是 CardTitle（非 heading role），用步骤内的表单标题锚定
  await expect(page.getByRole('heading', { name: '选择 Provider 类型' })).toBeVisible()

  // 类型卡 + 基础信息（与面板同一套表单原语）
  await page.getByRole('button', { name: /OpenAI/ }).first().click()
  await page.getByPlaceholder('如 openai').fill('wizard-provider')
  await page.getByPlaceholder('https://api.example.com/v1').fill(stubBase)
  await page.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')

  await page.getByRole('button', { name: '新增模型' }).click()
  await page.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model')
  await page.getByRole('button', { name: '保存并继续' }).click()

  // 保存成功进入路由步（CardDescription 文案锚定）；config 里 provider 已落库
  await expect(page.getByText('为 Anthropic 端点添加一条路由', { exact: false })).toBeVisible()
  const savedConfig: any = await (await request.get(`${baseUrl}/api/config`)).json()
  const provider = savedConfig.providers.find((item: any) => item.id === 'wizard-provider')
  expect(provider).toBeTruthy()
  expect(provider.baseUrl).toBe(stubBase)
  expect(provider.apiKey).toBe('stub-key')
  expect(provider.models.map((model: any) => model.id)).toEqual(['stub-model'])
})
