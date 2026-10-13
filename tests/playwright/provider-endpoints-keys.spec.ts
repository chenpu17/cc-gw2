import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

/** GET /api/config, tolerating the startup warm-up window. */
async function getConfig(request: any, baseUrl: string) {
  const response = await request.get(`${baseUrl}/api/config`)
  expect(response.status()).toBe(200)
  return response.json()
}

/** PUT the whole config back with `providers` replaced. */
async function putProviders(request: any, baseUrl: string, providers: any[]) {
  const config = await getConfig(request, baseUrl)
  const response = await request.put(`${baseUrl}/api/config`, {
    data: { ...config, providers },
  })
  expect(response.status()).toBe(200)
}

/** Requests the stub upstream received, via its introspection route. */
async function stubRequests(request: any) {
  const response = await request.get(`http://127.0.0.1:${harness.stubPort}/__test/requests`)
  expect(response.status()).toBe(200)
  const body = await response.json()
  return body.requests as Array<{
    url: string
    authorization: string | null
    model: string | null
  }>
}

test('preset template create fills the detail panel and config', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增 Provider' })
  await expect(createDialog).toBeVisible()

  // 预设目录来自 GET /api/provider-presets（Rust 单源 8 条）
  const presetsResponse = await request.get(`${baseUrl}/api/provider-presets`)
  expect(presetsResponse.status()).toBe(200)
  const { presets } = await presetsResponse.json()
  expect(presets.length).toBe(8)

  // DeepSeek 预设：类型/Base URL/余额适配器一并预填（预设选项的可访问名 =
  // 标签 + 描述，需按描述消歧，避免命中手动配置组里的 DeepSeek 类型）
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: /DeepSeek.*开放平台/ }).click()
  await expect(createDialog.getByPlaceholder('https://api.example.com/v1')).toHaveValue('https://api.deepseek.com/v1')
  await createDialog.getByPlaceholder('如 openai').fill('preset-deepseek')
  await createDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('已添加 Provider：preset-deepseek')).toBeVisible()

  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  // 详情面板余额分区显示已保存的适配器（DeepSeek）
  await expect(panel.getByRole('heading', { name: '余额' })).toBeVisible()
  await expect(panel.getByRole('combobox', { name: '余额适配器' })).toContainText('DeepSeek')

  const config = await getConfig(request, baseUrl)
  const created = config.providers.find((provider: any) => provider.id === 'preset-deepseek')
  expect(created.type).toBe('openai')
  expect(created.baseUrl).toBe('https://api.deepseek.com/v1')
  expect(created.balanceAdapter).toBe('deepseek')
})

test('dual-endpoint provider routes native protocols and switches keys', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const stubBase = `http://127.0.0.1:${harness.stubPort}`

  // 主端点 anthropic + openai 补充端点 + 两把命名密钥（active: key-a）
  await putProviders(request, baseUrl, [
    {
      id: 'stub',
      label: 'Stub Provider',
      type: 'openai',
      baseUrl: stubBase,
      apiKey: 'legacy-key',
      defaultModel: 'stub-model',
      models: [{ id: 'stub-model', label: 'Stub Model' }],
    },
    {
      id: 'dual',
      label: 'Dual Surface',
      type: 'anthropic',
      baseUrl: stubBase,
      defaultModel: 'dual-model',
      models: [{ id: 'dual-model', label: 'Dual Model' }],
      endpoints: [
        { id: 'chat', protocol: 'openai', baseUrl: stubBase },
      ],
      keys: [
        { id: 'key-a', value: 'sk-alpha', active: true },
        { id: 'key-b', value: 'sk-beta' },
      ],
    },
  ])

  // OpenAI 协议请求命中 openai 补充端点（/v1/chat/completions 原生转发）
  const openaiResponse = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'dual-model', messages: [{ role: 'user', content: 'hello' }] },
  })
  expect(openaiResponse.status()).toBe(200)

  // Anthropic 协议请求命中主端点（/v1/messages 原生转发，非流式）
  const anthropicResponse = await request.post(`${baseUrl}/v1/messages`, {
    headers: { 'x-api-key': 'e2e-key', 'anthropic-version': '2023-06-01' },
    data: { model: 'dual-model', max_tokens: 64, messages: [{ role: 'user', content: 'hi' }] },
  })
  expect(anthropicResponse.status()).toBe(200)
  const message = await anthropicResponse.json()
  expect(message.type).toBe('message')
  expect(message.usage.input_tokens).toBe(9)

  // Stub 收到的两条请求分别落在各自协议面，且用 active 命名密钥认证
  const requests = await stubRequests(request)
  const chatHit = requests.find((item) => item.url === '/v1/chat/completions' && item.model === 'dual-model')
  const messagesHit = requests.find((item) => item.url === '/v1/messages' && item.model === 'dual-model')
  expect(chatHit).toBeTruthy()
  expect(chatHit.authorization).toBe('Bearer sk-alpha')
  expect(messagesHit).toBeTruthy()
  expect(messagesHit.authorization).toBe('Bearer sk-alpha')

  // UI：切换 active 密钥到 key-b 并保存（行序即 key-a、key-b；输入值不算
  // 文本内容，hasText 过滤不了 input，按序取第二行）
  await page.goto(`${baseUrl}/ui/providers`)
  await page.getByTestId('provider-rail-row').filter({ hasText: 'Dual Surface' }).click()
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await expect(panel.getByTestId('provider-key-row')).toHaveCount(2)
  const keyRowB = panel.getByTestId('provider-key-row').nth(1)
  await keyRowB.getByLabel('生效').check()
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新 Provider：Dual Surface')).toBeVisible()

  const afterSave = await getConfig(request, baseUrl)
  const dualProvider = afterSave.providers.find((provider: any) => provider.id === 'dual')
  expect(dualProvider.keys.map((key: any) => ({ id: key.id, active: key.active === true }))).toEqual([
    { id: 'key-a', active: false },
    { id: 'key-b', active: true },
  ])

  // 切换后再打一条请求 → stub 收到 Bearer sk-beta
  const switchedResponse = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'dual-model', messages: [{ role: 'user', content: 'again' }] },
  })
  expect(switchedResponse.status()).toBe(200)
  const switchedRequests = await stubRequests(request)
  const switchedHit = switchedRequests
    .filter((item) => item.url === '/v1/chat/completions')
    .pop()
  expect(switchedHit.authorization).toBe('Bearer sk-beta')

  // 删除当前激活的 key-b → 剩余首把（key-a）自动晋升为生效
  const activeRow = panel.getByTestId('provider-key-row').nth(1)
  await activeRow.getByRole('button', { name: '删除' }).click()
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新 Provider：Dual Surface')).toBeVisible()
  await expect
    .poll(async () => {
      const afterDelete = await getConfig(request, baseUrl)
      const provider = afterDelete.providers.find((item: any) => item.id === 'dual')
      return provider.keys.map((key: any) => ({ id: key.id, active: key.active === true }))
    })
    .toEqual([{ id: 'key-a', active: true }])

  // 晋升后的 key-a 重新生效
  const promotedResponse = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'dual-model', messages: [{ role: 'user', content: 'promoted' }] },
  })
  expect(promotedResponse.status()).toBe(200)
  const promotedHit = (await stubRequests(request))
    .filter((item: any) => item.url === '/v1/chat/completions')
    .pop()
  expect(promotedHit.authorization).toBe('Bearer sk-alpha')
})

test('panel endpoint table edits save to config', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const stubBase = `http://127.0.0.1:${harness.stubPort}`

  await page.goto(`${baseUrl}/ui/providers`)
  await page.getByTestId('provider-rail-row').filter({ hasText: 'Stub Provider' }).click()
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()

  // 添加一个 openai 补充端点
  await panel.getByRole('button', { name: '添加端点' }).click()
  const endpointRow = panel.getByTestId('surface-endpoint-row')
  await expect(endpointRow).toHaveCount(1)
  await endpointRow.getByLabel('端点 ID').fill('chat-surface')
  await endpointRow.getByLabel('端点 Base URL').fill(stubBase)
  // 协议默认 anthropic → 切到 OpenAI Chat Completions
  await endpointRow.getByLabel('协议').click()
  await page.getByRole('option', { name: 'OpenAI Chat Completions' }).click()

  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新 Provider：Stub Provider')).toBeVisible()

  const config = await getConfig(request, baseUrl)
  const stubProvider = config.providers.find((provider: any) => provider.id === 'stub')
  expect(stubProvider.endpoints).toEqual([
    // 未填备注时 label 序列化为 null（Rust Option 无 skip）
    { id: 'chat-surface', protocol: 'openai', baseUrl: stubBase, label: null },
  ])

  // 删除端点行后保存 → endpoints 清空（回到仅主端点）。用 poll 断言：同文案
  // 的残留 toast 可能先满足可见断言，而第二次 PUT 尚未落库。
  const endpointRowAfter = panel.getByTestId('surface-endpoint-row')
  await endpointRowAfter.getByRole('button', { name: '删除' }).click()
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新 Provider：Stub Provider')).toBeVisible()
  await expect
    .poll(async () => {
      const afterRemove = await getConfig(request, baseUrl)
      const stubAfter = afterRemove.providers.find((provider: any) => provider.id === 'stub')
      return stubAfter.endpoints ?? 'pending'
    })
    .toEqual([])
})

test('balance refresh shows the normalized snapshot', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const stubBase = `http://127.0.0.1:${harness.stubPort}`

  // deepseek 适配器 + stub 余额端点（/user/balance 返回 110.00 CNY）
  await putProviders(request, baseUrl, [
    {
      id: 'stub',
      label: 'Stub Provider',
      type: 'openai',
      baseUrl: stubBase,
      apiKey: 'stub-key',
      defaultModel: 'stub-model',
      models: [{ id: 'stub-model', label: 'Stub Model' }],
    },
    {
      id: 'funded',
      label: 'Funded',
      type: 'openai',
      baseUrl: stubBase,
      apiKey: 'stub-key',
      balanceAdapter: 'deepseek',
      models: [{ id: 'stub-model' }],
    },
  ])

  await page.goto(`${baseUrl}/ui/providers`)
  await page.getByTestId('provider-rail-row').filter({ hasText: 'Funded' }).click()
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '刷新余额' }).click()

  await expect(panel.getByText('110.00 CNY')).toBeVisible()
  // 原始返回折叠在 Disclosure 里
  await panel.getByText('原始返回数据').click()
  await expect(panel.getByText('"is_available"')).toBeVisible()

  // 快照落在网关运行态（/api/providers/balances 可查），不写入配置
  const balancesResponse = await request.get(`${baseUrl}/api/providers/balances`)
  expect(balancesResponse.status()).toBe(200)
  const { balances } = await balancesResponse.json()
  const funded = balances.find((item: any) => item.providerId === 'funded')
  expect(funded.adapter).toBe('deepseek')
  expect(funded.display).toBe('110.00 CNY')
})

test('balance refresh failure surfaces an error toast and stores no snapshot', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  // 适配器指向不可达上游 → 刷新 502 → 错误 toast，运行态无快照
  await putProviders(request, baseUrl, [
    {
      id: 'stub',
      label: 'Stub Provider',
      type: 'openai',
      baseUrl: `http://127.0.0.1:${harness.stubPort}`,
      apiKey: 'stub-key',
      defaultModel: 'stub-model',
      models: [{ id: 'stub-model', label: 'Stub Model' }],
    },
    {
      id: 'broke',
      label: 'Broke',
      type: 'openai',
      baseUrl: 'http://127.0.0.1:9/v1',
      apiKey: 'stub-key',
      balanceAdapter: 'deepseek',
      models: [{ id: 'stub-model' }],
    },
  ])

  await page.goto(`${baseUrl}/ui/providers`)
  await page.getByTestId('provider-rail-row').filter({ hasText: 'Broke' }).click()
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: '刷新余额' }).click()

  await expect(page.getByText('余额刷新失败', { exact: false })).toBeVisible()
  const balancesResponse = await request.get(`${baseUrl}/api/providers/balances`)
  const { balances } = await balancesResponse.json()
  expect(balances.find((item: any) => item.providerId === 'broke')).toBeFalsy()
})
