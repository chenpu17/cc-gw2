import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness({ aggregate: true, secondaryUpstream: true })

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
// 跨供应商降级：agg-cross-model 成员链横跨两个独立上游进程
// [stub:stub-model-broken(恒 500), secondary:stub-model-secondary]，
// 验证不同 provider / 不同 baseUrl 之间的透明切换。
// ---------------------------------------------------------------------------
test('aggregate model fails over across providers on separate upstreams', async ({ request }) => {
  const baseUrl = harness.baseUrl()

  const response = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload('agg-cross-model'),
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status()).toBe(200)
  const body = await response.json()
  expect(JSON.stringify(body.content)).toContain('Secondary stub response')

  // 日志行记录实际服务的 secondary 供应商后端
  const logsResponse = await request.get(`${baseUrl}/api/logs?limit=20`)
  expect(logsResponse.ok()).toBeTruthy()
  const logs = await logsResponse.json()
  const row = (logs.items ?? []).find((item: any) => item.client_model === 'agg-cross-model')
  expect(row).toBeTruthy()
  expect(row.provider).toBe('secondary')
  expect(row.model).toBe('stub-model-secondary')

  // 降级链：主 stub 的坏模型 500 → 独立 secondary 上游接管
  const eventsResponse = await request.get(`${baseUrl}/api/events?limit=50`)
  expect(eventsResponse.ok()).toBeTruthy()
  const events = await eventsResponse.json()
  const failoverEvent = (events.events ?? []).find(
    (event: any) =>
      event.type === 'provider_failover' &&
      (event.details?.attempts ?? []).some((attempt: any) => attempt.provider === 'secondary')
  )
  expect(failoverEvent).toBeTruthy()
  const attempts = failoverEvent.details?.attempts ?? []
  expect(attempts).toHaveLength(2)
  expect(attempts[0].provider).toBe('stub')
  expect(attempts[0].model).toBe('stub-model-broken')
  expect(attempts[0].outcome).toBe('failed:status')
  expect(attempts[0].status).toBe(500)
  expect(attempts[1].provider).toBe('secondary')
  expect(attempts[1].model).toBe('stub-model-secondary')
  expect(attempts[1].outcome).toBe('selected')
})

// ---------------------------------------------------------------------------
// WebUI 全链路：模板对话框创建聚合供应商（无 baseUrl）→ 详情面板聚合模型区
// 配置成员 → 保存 → rail 以聚合形态展示 → 真实流量命中成员后端。
// ---------------------------------------------------------------------------
test('aggregate provider can be configured via the drawer and serves traffic', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增 Provider' })
  await expect(createDialog).toBeVisible()

  // 手动配置组选「Aggregate」：隐藏 Base URL，展示聚合说明文案
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: 'Aggregate', exact: true }).click()
  await expect(createDialog.getByText('聚合供应商没有自己的上游地址与密钥')).toBeVisible()
  await expect(createDialog.getByPlaceholder('https://api.example.com/v1')).toHaveCount(0)
  await createDialog.getByPlaceholder('如 openai').fill('agg-ui')
  await createDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('已添加 Provider：agg-ui')).toBeVisible()

  // 创建后自动选中，聚合模型区直接在详情面板内联展示
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('heading', { name: '聚合模型' })).toBeVisible()

  await panel.getByRole('button', { name: '新增模型' }).click()
  await panel.getByPlaceholder('如 glm-5.1').fill('glm-ui')

  await panel.getByTestId('aggregate-add-member').click()
  await panel.getByPlaceholder('选择 providerId:modelId').fill('Stub Model')
  await page.getByRole('option', { name: 'Stub Model' }).click()
  const memberRow = panel.getByTestId('aggregate-member-row').first()
  await expect(memberRow.locator('input')).toHaveValue('stub:stub-model')
  await expect(memberRow).toContainText('首选')

  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新 Provider：agg-ui')).toBeVisible()

  // rail：聚合徽章
  const railRow = page.getByTestId('provider-rail-row').filter({ hasText: 'agg-ui' })
  await expect(railRow).toBeVisible()
  await expect(railRow.getByText('聚合', { exact: true })).toBeVisible()

  // 真实流量：请求聚合模型名，命中成员后端
  const response = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload('glm-ui'),
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status()).toBe(200)
  const responseBody = await response.json()
  expect(JSON.stringify(responseBody.content)).toContain('Stub response')
})

// ---------------------------------------------------------------------------
// 全链失败的聚合请求：error_detail 落库后，日志详情抽屉展开「详细信息」
// 可见失败阶段 / 上游状态码 / failover 尝试链 / 截断的上游响应体。
// 成员使用两个全新 provider id 指向同一 stub 端口，避免与前序用例的
// backend cooldown（key = providerId:modelId）互相干扰。
// ---------------------------------------------------------------------------
test('failed aggregate request surfaces error detail in the log drawer', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.ok()).toBeTruthy()
  const config = await configResponse.json()
  const stubBaseUrl = (config.providers ?? []).find(
    (provider: any) => provider.id === 'stub'
  )?.baseUrl
  expect(stubBaseUrl).toBeTruthy()

  const deadProvider = (modelId: string) => ({
    id: modelId,
    label: modelId,
    type: 'openai',
    baseUrl: stubBaseUrl,
    apiKey: 'stub-key',
    defaultModel: 'stub-model-failing',
    models: [{ id: 'stub-model-failing', label: 'Stub Failing Model' }],
  })
  const next = {
    ...config,
    providers: [
      ...(config.providers ?? []).filter((provider: any) => provider.id !== 'agg'),
      deadProvider('deadpool-a'),
      deadProvider('deadpool-b'),
      {
        id: 'agg',
        label: '聚合测试',
        type: 'aggregate',
        models: [
          ...((config.providers ?? []).find((provider: any) => provider.id === 'agg')?.models ?? []),
          {
            id: 'dead-model',
            members: [
              { target: 'deadpool-a:stub-model-failing' },
              { target: 'deadpool-b:stub-model-failing' },
            ],
            failover: { consecutiveFailures: 1, cooldownSeconds: 60 },
          },
        ],
      },
    ],
  }
  const putResponse = await request.put(`${baseUrl}/api/config`, { data: next })
  expect(putResponse.ok(), 'PUT /api/config should succeed').toBeTruthy()

  const failed = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload('dead-model'),
    headers: { 'content-type': 'application/json' },
  })
  expect(failed.status()).toBe(500)

  // 日志行带 error_detail：上游 500 + 两条失败尝试
  const logsResponse = await request.get(`${baseUrl}/api/logs?limit=10`)
  expect(logsResponse.ok()).toBeTruthy()
  const logs = await logsResponse.json()
  const row = (logs.items ?? []).find((item: any) => item.client_model === 'dead-model')
  expect(row).toBeTruthy()
  const detail = JSON.parse(row.error_detail)
  expect(detail.stage).toBe('upstream')
  expect(detail.upstreamStatus).toBe(500)
  expect(detail.failoverAttempts).toHaveLength(2)
  expect(detail.upstreamBody).toBeTruthy()

  // 抽屉：错误块后展开「详细信息」，可见 HTTP 500 徽标与尝试链
  await page.goto(`${baseUrl}/ui/logs`)
  await page.getByRole('button', { name: '仅看失败' }).click()
  const detailButton = page.getByRole('button', { name: '详情' }).first()
  await expect(detailButton).toBeVisible()
  await detailButton.click()

  const drawer = page.getByRole('dialog', { name: '日志详情' })
  await expect(drawer).toBeVisible()
  const errorDetail = drawer.getByTestId('log-error-detail')
  await expect(errorDetail).toBeVisible()
  await expect(errorDetail.getByText('上游错误')).toBeVisible()
  await expect(errorDetail.getByText('HTTP 500')).toBeVisible()
  await expect(errorDetail).toContainText('deadpool-a')
  await expect(errorDetail).toContainText('deadpool-b')
  await expect(errorDetail).toContainText('failed:status')
  await expect(errorDetail).toContainText('上游响应体')
})
