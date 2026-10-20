import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

// 「使用绝对路径」开关:勾选后 baseUrl 原样作上游 URL，不按协议追加后缀。
// 本 test 验证：UI 开关可勾选并渲染 → 保存后 config 持久化 useAbsoluteUrl=true。
// 真实转发行为（勾选/不勾选落到不同上游路径）见下方独立 test。
test('useAbsoluteUrl switch renders, persists, and bypasses path suffix end-to-end', async ({
  page,
  request
}) => {
  const baseUrl = harness.baseUrl()
  const providerId = `abs-url-${Date.now()}`
  const stubRoot = `http://127.0.0.1:${harness.stubPort}`

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增提供商' })
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: 'OpenAI 兼容', exact: true }).click()
  await createDialog.getByPlaceholder('如 openai').fill(providerId)
  // baseUrl 只填到 stub 根；不勾选时网关会追加 /v1/chat/completions（stub 200），
  // 勾选时原样用根路径（stub 对 POST / 返回 404），两者可区分。
  await createDialog.getByPlaceholder('https://api.example.com/v1').fill(stubRoot)
  await createDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText(`已添加提供商：${providerId}`)).toBeVisible()

  // 详情面板内联编辑：密钥 + 高级选项里的「使用绝对路径」开关。
  // 高级选项默认折叠，先展开。
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await panel.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  const advanced = panel.locator('details').filter({ hasText: '高级选项' }).first()
  await advanced.locator('summary').click()
  const absoluteSwitch = panel.getByRole('switch', { name: '使用绝对路径' })
  await expect(absoluteSwitch).toBeVisible()
  await expect(absoluteSwitch).not.toBeChecked()
  await absoluteSwitch.click()
  await expect(absoluteSwitch).toBeChecked()

  await panel.getByRole('button', { name: '新增模型' }).click()
  await panel.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model')
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}`)).toBeVisible()

  // 持久化断言：config 里 useAbsoluteUrl === true
  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const provider = config.providers.find((item: any) => item.id === providerId)
  expect(provider).toBeTruthy()
  expect(provider.useAbsoluteUrl).toBe(true)
})

// 端到端转发验证：借 stub 对 POST /v1/chat/completions 返回 200、对其它 POST 返回 404，
// 证明 useAbsoluteUrl 在真实转发链路里切换上游路径（勾选→原样根路径→404；不勾选→追加后缀→200）。
test('useAbsoluteUrl bypasses path suffix in real proxy forwarding', async ({ request }) => {
  const baseUrl = harness.baseUrl()
  const stubRoot = `http://127.0.0.1:${harness.stubPort}`

  const cfgResp = await request.get(`${baseUrl}/api/config`)
  expect(cfgResp.ok()).toBeTruthy()
  const baseCfg: any = await cfgResp.json()

  async function deploy(useAbsoluteUrl: boolean) {
    const next = { ...baseCfg }
    next.providers = [
      {
        id: 'abs-target',
        label: 'Abs Target',
        type: 'openai',
        baseUrl: stubRoot,
        apiKey: 'stub-key',
        useAbsoluteUrl,
        defaultModel: 'abs-model',
        models: [{ id: 'abs-model', label: 'Abs Model' }],
      },
    ]
    const defaults = { ...baseCfg.defaults, completion: 'abs-target:abs-model' }
    next.defaults = defaults
    next.endpointRouting = {
      anthropic: { defaults: { ...defaults }, modelRoutes: {} },
      openai: { defaults: { ...defaults }, modelRoutes: {} },
    }
    const resp = await request.put(`${baseUrl}/api/config`, { data: next })
    expect(resp.ok(), 'PUT /api/config should succeed').toBeTruthy()
  }

  // 勾选：baseUrl（stub 根）原样 → POST / → stub 仅认 /v1/chat/completions → 404
  await deploy(true)
  const onResp = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'abs-model', messages: [{ role: 'user', content: 'hi' }] },
    headers: { 'content-type': 'application/json' },
  })
  expect(onResp.status()).toBe(404)

  // 不勾选：追加 /v1/chat/completions → stub 认 → 200
  await deploy(false)
  const offResp = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: { model: 'abs-model', messages: [{ role: 'user', content: 'hi' }] },
    headers: { 'content-type': 'application/json' },
  })
  expect(offResp.status()).toBe(200)
})
