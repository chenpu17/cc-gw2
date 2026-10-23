import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

// 一个自定义端点的同一个基础路径同时挂 Anthropic 与 OpenAI 协议后，
// Claude Code（/v1/messages）和 Codex（/v1/responses）客户端都能直接工作，
// 且创建后无需先保存路由规则——默认空 routing 让 direct match 立即生效。
test('one custom endpoint base path serves Anthropic and OpenAI clients', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const endpointId = `multi-${Date.now()}`
  const endpointPath = `/multi-${endpointId}`

  await page.goto(`${baseUrl}/ui/routing`)
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const dialog = page.getByRole('dialog', { name: '创建端点' })
  await dialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await dialog.getByPlaceholder('如 我的自定义 API').fill('Multi Protocol Endpoint')
  await dialog.getByPlaceholder('如 /myapi').fill(endpointPath)

  // 默认已勾选 OpenAI（Chat + Responses），再勾选 Anthropic
  const anthropicToggle = dialog.getByRole('button', { name: 'Anthropic', exact: true })
  await expect(anthropicToggle).toHaveAttribute('aria-pressed', 'false')
  await anthropicToggle.click()
  await expect(anthropicToggle).toHaveAttribute('aria-pressed', 'true')

  // 预览展示所选协议自动注册的子路径
  for (const resolved of [
    `${endpointPath}/v1/messages`,
    `${endpointPath}/v1/messages/count_tokens`,
    `${endpointPath}/v1/chat/completions`,
    `${endpointPath}/v1/responses`,
    `${endpointPath}/v1/models`
  ]) {
    await expect(dialog.getByText(resolved, { exact: true })).toBeVisible()
  }

  await dialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('端点创建成功')).toBeVisible()

  // 落库为同一基础路径的两条协议项（编辑器按基础路径合并展示）
  const endpointsResponse = await request.get(`${baseUrl}/api/custom-endpoints`)
  expect(endpointsResponse.ok()).toBeTruthy()
  const body = await endpointsResponse.json()
  const created = body.endpoints.find((item: any) => item.id === endpointId)
  expect(created).toBeTruthy()
  expect(created.paths).toEqual(
    expect.arrayContaining([
      { path: endpointPath, protocol: 'anthropic' },
      { path: endpointPath, protocol: 'openai-auto' }
    ])
  )
  // 创建即带空 routing，无需先到路由页保存一次
  expect(created.routing).toBeTruthy()

  // Claude Code 侧：Anthropic Messages 入口
  const anthropic = await request.post(`${baseUrl}${endpointPath}/v1/messages`, {
    data: {
      model: 'stub-model',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'hello from claude code' }]
    },
    headers: { 'content-type': 'application/json' }
  })
  expect(anthropic.status()).toBe(200)
  expect((await anthropic.json()).type).toBe('message')

  // OpenAI Chat 入口（Codex wire_api = "chat" / 通用 OpenAI SDK）
  const chat = await request.post(`${baseUrl}${endpointPath}/v1/chat/completions`, {
    data: { model: 'stub-model', messages: [{ role: 'user', content: 'hello from chat sdk' }] },
    headers: { 'content-type': 'application/json' }
  })
  expect(chat.status()).toBe(200)
  expect((await chat.json()).object).toBe('chat.completion')

  // Codex 默认入口：Responses API
  const responses = await request.post(`${baseUrl}${endpointPath}/v1/responses`, {
    data: { model: 'stub-model', input: 'hello from codex' },
    headers: { 'content-type': 'application/json' }
  })
  expect(responses.status()).toBe(200)
  expect((await responses.json()).object).toBe('response')
})

// 编辑已有端点时，同一基础路径的两条协议项合并成一行展示，保存后仍保持两项。
test('editing a dual-protocol endpoint keeps one base path row', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const endpointId = `multi-edit-${Date.now()}`
  const endpointPath = `/multi-edit-${endpointId}`

  const createResponse = await request.post(`${baseUrl}/api/custom-endpoints`, {
    data: {
      id: endpointId,
      label: 'Dual Protocol Endpoint',
      paths: [
        { path: endpointPath, protocol: 'anthropic' },
        { path: endpointPath, protocol: 'openai-auto' }
      ]
    }
  })
  expect(createResponse.ok()).toBeTruthy()

  await page.goto(`${baseUrl}/ui/routing`)
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()
  const row = page.getByTestId('routing-endpoint-row').filter({ hasText: 'Dual Protocol Endpoint' })
  await expect(row).toBeVisible()
  await row.getByTestId('endpoint-edit').click()

  const dialog = page.getByRole('dialog', { name: '编辑端点' })
  // 同一基础路径只渲染一行，且两个协议都已选中
  const pathInputs = dialog.getByPlaceholder('如 /myapi')
  await expect(pathInputs).toHaveCount(1)
  await expect(pathInputs).toHaveValue(endpointPath)
  await expect(dialog.getByRole('button', { name: 'Anthropic', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )
  await expect(dialog.getByRole('button', { name: 'OpenAI', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true'
  )

  await dialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('端点更新成功')).toBeVisible()

  const endpointsResponse = await request.get(`${baseUrl}/api/custom-endpoints`)
  const body = await endpointsResponse.json()
  const updated = body.endpoints.find((item: any) => item.id === endpointId)
  expect(updated.paths).toHaveLength(2)
  expect(updated.paths).toEqual(
    expect.arrayContaining([
      { path: endpointPath, protocol: 'anthropic' },
      { path: endpointPath, protocol: 'openai-auto' }
    ])
  )
})
