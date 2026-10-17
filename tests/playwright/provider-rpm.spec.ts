import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

// RPM 限流（排队等待）:Provider 每分钟请求上限 + 最长等待。
// 本文件验证：UI 两个数字输入可填写并保存 → config 持久化 rpmLimit /
// rpmMaxWaitSeconds；清空后字段回到 null（不限流）；以及真实转发链路上
// 超限请求返回 429 + Retry-After。排队等待的精确计时由 Rust 单测的
// paused clock 覆盖，e2e 只覆盖"立即拒绝"契约（maxWait=0）。
test('provider RPM limit fields render and persist via provider panel', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const providerId = `rpm-ui-${Date.now()}`

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增提供商' })
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: 'OpenAI 兼容', exact: true }).click()
  await createDialog.getByPlaceholder('如 openai').fill(providerId)
  await createDialog.getByPlaceholder('https://api.example.com/v1').fill('http://127.0.0.1:9/v1')
  await createDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText(`已添加提供商：${providerId}`)).toBeVisible()

  // 详情面板：高级选项默认折叠，展开后填写 RPM 上限与最长等待 + 一个模型
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  const advanced = panel.locator('details').filter({ hasText: '高级选项' }).first()
  await advanced.locator('summary').click()
  await expect(panel.getByText('RPM 限流（排队等待）')).toBeVisible()
  await panel.getByPlaceholder('如 60').fill('60')
  await panel.getByPlaceholder('默认 30').fill('45')
  await panel.getByRole('button', { name: '新增模型' }).click()
  await panel.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model')
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}`)).toBeVisible()

  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const provider = config.providers.find((item: any) => item.id === providerId)
  expect(provider).toBeTruthy()
  expect(provider.rpmLimit).toBe(60)
  expect(provider.rpmMaxWaitSeconds).toBe(45)

  // 未设置限流的其他 provider：字段保持 null/缺失，现有行为不受影响
  for (const other of config.providers.filter((item: any) => item.id !== providerId)) {
    expect(other.rpmLimit === undefined || other.rpmLimit === null).toBeTruthy()
  }

  // 面板清空两个字段 → 保存后回到 null（关闭限流）
  await page.getByTestId('provider-rail-row').filter({ hasText: providerId }).click()
  await expect(page.getByTestId('provider-detail-panel')).toBeVisible()
  // 保存后回到只读档案，重新进入编辑（面板未重挂载，高级选项仍保持展开）
  await panel.getByTestId('provider-edit').click()
  await panel.getByPlaceholder('如 60').fill('')
  await panel.getByPlaceholder('默认 30').fill('')
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}`)).toBeVisible()

  // 用 poll 而非立即 GET：同文案的残留 toast 可能让断言先行满足，而 PUT
  // 尚未落库（双保存竞态）。
  await expect
    .poll(async () => {
      const clearedResponse = await request.get(`${baseUrl}/api/config`)
      const clearedConfig = await clearedResponse.json()
      const clearedProvider = clearedConfig.providers.find((item: any) => item.id === providerId)
      // 注意不能用 ?? —— 清空后的值本身就是 null
      return clearedProvider ? clearedProvider.rpmLimit : 'pending'
    })
    .toBeNull()
  const finalResponse = await request.get(`${baseUrl}/api/config`)
  const finalConfig = await finalResponse.json()
  const finalProvider = finalConfig.providers.find((item: any) => item.id === providerId)
  // Rust 序列化未设置的 Option 字段为 null，而非键缺失
  expect(finalProvider.rpmMaxWaitSeconds).toBeNull()
})

// ---------------------------------------------------------------------------
// 真实转发链路：rpmLimit=1 / rpmMaxWaitSeconds=0 的 provider，第一个请求占用
// 窗口内唯一槽位，第二个请求在最长等待内无法获得空位 → 立即 429 +
// Retry-After: 60 + provider_rate_limit_exceeded，并记录事件。
// ---------------------------------------------------------------------------
test('rpm-capped provider rejects excess request with 429 and Retry-After', async ({ request }) => {
  const baseUrl = harness.baseUrl()

  const cfgResp = await request.get(`${baseUrl}/api/config`)
  expect(cfgResp.ok()).toBeTruthy()
  const baseCfg: any = await cfgResp.json()
  const next = { ...baseCfg }
  next.providers = [
    {
      id: 'rpm-stub',
      label: 'RPM Stub',
      type: 'openai',
      baseUrl: `http://127.0.0.1:${(harness as any).stubPort}`,
      apiKey: 'stub-key',
      rpmLimit: 1,
      rpmMaxWaitSeconds: 0,
      defaultModel: 'rpm-model',
      models: [{ id: 'rpm-model', label: 'RPM Model' }],
    },
  ]
  const defaults = { ...baseCfg.defaults, completion: 'rpm-model' }
  next.defaults = defaults
  next.endpointRouting = {
    anthropic: { defaults: { ...defaults }, modelRoutes: {} },
    openai: { defaults: { ...defaults }, modelRoutes: {} },
  }
  const resp = await request.put(`${baseUrl}/api/config`, { data: next })
  expect(resp.ok(), 'PUT /api/config should succeed').toBeTruthy()

  const first = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'rpm-model', messages: [{ role: 'user', content: 'first' }] },
    headers: { 'content-type': 'application/json' },
  })
  expect(first.status()).toBe(200)

  const second = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'rpm-model', messages: [{ role: 'user', content: 'second' }] },
    headers: { 'content-type': 'application/json' },
  })
  expect(second.status()).toBe(429)
  expect(second.headers()['retry-after']).toBe('60')
  const body = await second.json()
  expect(body.error.code).toBe('provider_rate_limit_exceeded')
  expect(body.error.message).toContain('RPM limit')

  // 拒绝事件已记录，可在事件页追溯
  const eventsResponse = await request.get(`${baseUrl}/api/events?limit=10`)
  expect(eventsResponse.ok()).toBeTruthy()
  const events = await eventsResponse.json()
  const rejected = (events.events ?? []).some(
    (event: any) => event.type === 'provider_rate_limit_rejected'
  )
  expect(rejected).toBeTruthy()
})

// ---------------------------------------------------------------------------
// 全链路：RPM 在 WebUI 抽屉里设置 → 真实客户端流量立即受限。UI 创建
// rpmLimit=1 / rpmMaxWaitSeconds=5 的 provider（上游指向 harness 内置
// stub），第一个请求占用窗口内唯一槽位返回 200；第二个请求的槽位在
// ~60s 后，超过 5s 最长等待 → 立即 429 + Retry-After: 60。
// ---------------------------------------------------------------------------
test('RPM limit set via WebUI panel throttles real client traffic', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const providerId = `rpm-live-${Date.now()}`

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增提供商' })
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: 'OpenAI 兼容', exact: true }).click()
  await createDialog.getByPlaceholder('如 openai').fill(providerId)
  await createDialog.getByPlaceholder('https://api.example.com/v1').fill(
    `http://127.0.0.1:${(harness as any).stubPort}`
  )
  await createDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText(`已添加提供商：${providerId}`)).toBeVisible()

  // 详情面板：密钥 + RPM 1/5 + 模型
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await panel.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  // 高级选项默认折叠，展开后填写 RPM 字段
  const advanced = panel.locator('details').filter({ hasText: '高级选项' }).first()
  await advanced.locator('summary').click()
  await panel.getByPlaceholder('如 60').fill('1')
  await panel.getByPlaceholder('默认 30').fill('5')
  await panel.getByRole('button', { name: '新增模型' }).click()
  await panel.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('rpm-chain-model')
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}`)).toBeVisible()

  const post = (content: string) =>
    request.post(`${baseUrl}/openai/v1/chat/completions`, {
      data: { model: 'rpm-chain-model', messages: [{ role: 'user', content }] },
      headers: { 'content-type': 'application/json' },
    })

  const first = await post('first')
  expect(first.status()).toBe(200)

  const second = await post('second')
  expect(second.status()).toBe(429)
  expect(second.headers()['retry-after']).toBe('60')
  const body = await second.json()
  expect(body.error.code).toBe('provider_rate_limit_exceeded')
})
