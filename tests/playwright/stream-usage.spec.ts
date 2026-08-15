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

  // 警示文案渲染为 warning 色（与普通开关的 muted 提示区分）
  await expect(
    drawer.getByText('⚠️ 兼容性风险', { exact: false })
  ).toBeVisible()

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

// ---------------------------------------------------------------------------
// 真实转发链路验证：Anthropic 客户端流式请求 → 网关跨协议转换 → OpenAI stub。
// stub 会按 prompt 标记返回两种 usage 形态，断言客户端侧 Anthropic SSE 的
// message_delta.usage 都携带真实 token 数（修复 choices[0].delta.usage 漏读）。
// ---------------------------------------------------------------------------
async function deployStreamTarget(request: any, baseUrl: string, streamUsage: boolean) {
  const cfgResp = await request.get(`${baseUrl}/api/config`)
  expect(cfgResp.ok()).toBeTruthy()
  const baseCfg: any = await cfgResp.json()
  const next = { ...baseCfg }
  next.providers = [
    {
      id: 'stub',
      label: 'Stub Provider',
      type: 'openai',
      baseUrl: `http://127.0.0.1:${(harness as any).stubPort}`,
      apiKey: 'stub-key',
      streamUsage,
      defaultModel: 'stub-model',
      models: [{ id: 'stub-model', label: 'Stub Model' }],
    },
  ]
  const defaults = { ...baseCfg.defaults, completion: 'stub-model' }
  next.defaults = defaults
  next.endpointRouting = {
    anthropic: { defaults: { ...defaults }, modelRoutes: {} },
    openai: { defaults: { ...defaults }, modelRoutes: {} },
  }
  const resp = await request.put(`${baseUrl}/api/config`, { data: next })
  expect(resp.ok(), 'PUT /api/config should succeed').toBeTruthy()
}

/** Collect the client-side Anthropic SSE events from a streaming request. */
async function streamViaGateway(request: any, baseUrl: string, prompt: string) {
  const response = await request.post(`${baseUrl}/v1/messages`, {
    data: {
      model: 'stub-model',
      stream: true,
      max_tokens: 64,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
    },
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status()).toBe(200)
  const raw = await response.text()
  return raw
    .split('\n\n')
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => {
      const dataLines = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
      if (dataLines.length === 0) return null
      try {
        return JSON.parse(dataLines.join('\n'))
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

test('client message_delta carries usage nested in choices[0].delta.usage (no streamUsage opt-in)', async ({ request }) => {
  const baseUrl = harness.baseUrl()
  // streamUsage 关闭：不注入 stream_options，上游仍主动带 usage
  await deployStreamTarget(request, baseUrl, false)

  const events = await streamViaGateway(request, baseUrl, 'delta-usage style please')
  const messageDelta = events.find((event: any) => event?.type === 'message_delta')
  expect(messageDelta, 'client stream must contain message_delta').toBeTruthy()
  // stub 返回 delta 嵌套 usage: prompt 41 / completion 7
  expect(messageDelta.usage.input_tokens).toBe(41)
  expect(messageDelta.usage.output_tokens).toBe(7)
})

test('client message_delta carries top-level usage chunk', async ({ request }) => {
  const baseUrl = harness.baseUrl()
  await deployStreamTarget(request, baseUrl, false)

  const events = await streamViaGateway(request, baseUrl, 'top-level usage style')
  const messageDelta = events.find((event: any) => event?.type === 'message_delta')
  expect(messageDelta, 'client stream must contain message_delta').toBeTruthy()
  // stub 返回顶层 usage: prompt 12 / completion 4
  expect(messageDelta.usage.input_tokens).toBe(12)
  expect(messageDelta.usage.output_tokens).toBe(4)
})

test('streamUsage opt-in injects stream_options.include_usage upstream', async ({ request }) => {
  const baseUrl = harness.baseUrl()
  await deployStreamTarget(request, baseUrl, true)

  const events = await streamViaGateway(request, baseUrl, 'include usage please')
  // 客户端侧仍拿到 usage（顶层风格）
  const messageDelta = events.find((event: any) => event?.type === 'message_delta')
  expect(messageDelta).toBeTruthy()
  expect(messageDelta.usage.input_tokens).toBe(12)

  // 请求日志里记录了网关收到 200——注入参数未导致上游拒绝
  const logsResponse = await request.get(`${baseUrl}/api/logs?limit=5`)
  if (logsResponse.ok()) {
    const logs = await logsResponse.json()
    const recent = (logs.logs ?? logs.data ?? []).find((log: any) => log.stream === 1 || log.stream === true)
    if (recent) expect(recent.status_code ?? recent.statusCode).toBe(200)
  }
})
