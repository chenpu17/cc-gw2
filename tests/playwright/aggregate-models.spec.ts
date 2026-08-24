import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness({ aggregate: true })

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

const anthropicPayload = (model: string) => ({
  model,
  max_tokens: 64,
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }],
})

// ---------------------------------------------------------------------------
// 预配置链路：agg-model 成员 [stub:stub-model-failing(恒 500), stub:stub-model]，
// 阈值 1 / 冷却 60s。验证透明降级、日志后端列、provider_failover 事件、
// 健康快照冷却与冷却期跳过。
// ---------------------------------------------------------------------------
test('aggregate model fails over transparently and records the chain', async ({ request }) => {
  const baseUrl = harness.baseUrl()

  const first = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload('agg-model'),
    headers: { 'content-type': 'application/json' },
  })
  expect(first.status()).toBe(200)
  const body = await first.json()
  expect(JSON.stringify(body.content)).toContain('Stub response')

  // 日志行记录实际命中后端；client_model 保留客户端请求的聚合模型名
  const logsResponse = await request.get(`${baseUrl}/api/logs?limit=20`)
  expect(logsResponse.ok()).toBeTruthy()
  const logs = await logsResponse.json()
  const row = (logs.items ?? []).find((item: any) => item.client_model === 'agg-model')
  expect(row).toBeTruthy()
  expect(row.provider).toBe('stub')
  expect(row.model).toBe('stub-model')

  // provider_failover 事件带完整 attempts 链
  const eventsResponse = await request.get(`${baseUrl}/api/events?limit=20`)
  expect(eventsResponse.ok()).toBeTruthy()
  const events = await eventsResponse.json()
  const failoverEvent = (events.events ?? []).find((event: any) => event.type === 'provider_failover')
  expect(failoverEvent).toBeTruthy()
  const attempts = failoverEvent.details?.attempts ?? []
  expect(attempts).toHaveLength(2)
  expect(attempts[0].provider).toBe('stub')
  expect(attempts[0].model).toBe('stub-model-failing')
  expect(attempts[0].outcome).toBe('failed:status')
  expect(attempts[0].status).toBe(500)
  expect(attempts[1].model).toBe('stub-model')
  expect(attempts[1].outcome).toBe('selected')

  // 健康快照：连续失败 1 次即进入冷却
  const healthResponse = await request.get(`${baseUrl}/api/providers/backends/health`)
  expect(healthResponse.ok()).toBeTruthy()
  const health = await healthResponse.json()
  const failing = (health.backends ?? []).find((backend: any) => backend.key === 'stub:stub-model-failing')
  expect(failing).toBeTruthy()
  expect(failing.state).toBe('cooling')
  expect(failing.cooldownRemainingSeconds).toBeGreaterThan(0)

  // 冷却期内的后续请求直接跳过失败成员，仍由健康成员服务
  const second = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload('agg-model'),
    headers: { 'content-type': 'application/json' },
  })
  expect(second.status()).toBe(200)
  const secondBody = await second.json()
  expect(JSON.stringify(secondBody.content)).toContain('Stub response')
})

// ---------------------------------------------------------------------------
// WebUI 全链路：抽屉里创建聚合供应商（无 baseUrl/密钥区）→ 聚合模型步骤
// 配置成员 → 保存 → 卡片以聚合形态展示 → 真实流量命中成员后端。
// ---------------------------------------------------------------------------
test('aggregate provider can be configured via the drawer and serves traffic', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const drawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await expect(drawer).toBeVisible()

  // 聚合类型：隐藏 Base URL / 认证区，展示说明卡
  await drawer.getByRole('button', { name: /聚合/ }).click()
  await expect(drawer.getByText('聚合供应商说明')).toBeVisible()
  await expect(drawer.getByPlaceholder('https://api.example.com/v1')).toHaveCount(0)
  await drawer.getByPlaceholder('如 openai').fill('agg-ui')

  await drawer.getByRole('button', { name: '下一步' }).click()
  await expect(drawer.getByRole('heading', { name: '聚合模型' })).toBeVisible()

  await drawer.getByRole('button', { name: '新增模型' }).click()
  await drawer.getByPlaceholder('如 glm-5.1').fill('glm-ui')

  await drawer.getByTestId('aggregate-add-member').click()
  await drawer.getByPlaceholder('选择 providerId:modelId').fill('Stub Model')
  await page.getByRole('option', { name: 'Stub Model' }).click()
  const memberRow = drawer.getByTestId('aggregate-member-row').first()
  await expect(memberRow.locator('input')).toHaveValue('stub:stub-model')
  await expect(memberRow).toContainText('首选')

  await drawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText('已添加 Provider：agg-ui')).toBeVisible()

  // 卡片：聚合徽章 + 模型→成员摘要
  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: 'agg-ui' })
  await expect(card).toBeVisible()
  await expect(card.getByText('聚合', { exact: true })).toBeVisible()
  await expect(card).toContainText('glm-ui → stub:stub-model')

  // 真实流量：请求聚合模型名，命中成员后端
  const response = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload('glm-ui'),
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status()).toBe(200)
  const responseBody = await response.json()
  expect(JSON.stringify(responseBody.content)).toContain('Stub response')
})
