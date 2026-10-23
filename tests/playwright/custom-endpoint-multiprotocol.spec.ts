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

// 同一来源模型经统一端点进入时，按协议家族分流到不同上游：
// Anthropic 请求走 anthropic 目标，OpenAI（Chat / Responses）走 openai 目标，
// 未配置家族映射时回退共享 modelRoutes。命中模拟器可分别模拟两类协议。
test('protocol-scoped routes branch one source model by protocol', async ({ request }) => {
  const baseUrl = harness.baseUrl()

  // 第二个 provider 与 stub 指向同一上游，但 id / 模型不同，便于用上游收到的
  // model 字段证明分流目标确实不同。
  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.ok()).toBeTruthy()
  const config = await configResponse.json()
  const stub = config.providers.find((provider: any) => provider.id === 'stub')
  expect(stub).toBeTruthy()
  const altProvider = {
    id: 'branch-alt',
    label: 'Branch Alt',
    type: 'openai',
    baseUrl: stub.baseUrl,
    apiKey: 'stub-key',
    defaultModel: 'openai-model',
    models: [{ id: 'openai-model', label: 'OpenAI branch model' }]
  }
  const saveConfig = await request.put(`${baseUrl}/api/config`, {
    data: {
      ...config,
      providers: [
        ...config.providers.filter((provider: any) => provider.id !== altProvider.id),
        altProvider
      ]
    }
  })
  expect(saveConfig.ok(), 'PUT /api/config should succeed').toBeTruthy()

  const endpointId = `branch-${Date.now()}`
  const endpointPath = `/branch-${endpointId}`
  const createResponse = await request.post(`${baseUrl}/api/custom-endpoints`, {
    data: {
      id: endpointId,
      label: 'Branch Endpoint',
      paths: [
        { path: endpointPath, protocol: 'anthropic' },
        { path: endpointPath, protocol: 'openai-auto' }
      ],
      routing: {
        modelRoutes: { 'shared-model': 'stub:shared-model' },
        modelRoutesByProtocol: {
          anthropic: { 'branch-model': 'stub:anthropic-model' },
          openai: { 'branch-model': 'branch-alt:openai-model' }
        }
      }
    }
  })
  expect(createResponse.ok()).toBeTruthy()

  const postUpstreamModel = async (path: string, body: Record<string, unknown>) => {
    // Index the request this call produced instead of assuming it is the last
    // one — keeps the assertion valid if the harness adds background traffic.
    const before = harness.stubRequests().filter((item) => item.method === 'POST').length
    const response = await request.post(`${baseUrl}${endpointPath}${path}`, {
      data: body,
      headers: { 'content-type': 'application/json' }
    })
    expect(response.status()).toBe(200)
    const posts = harness.stubRequests().filter((item) => item.method === 'POST')
    expect(posts.length).toBeGreaterThan(before)
    return posts[before]?.model
  }

  // Anthropic 分支
  expect(
    await postUpstreamModel('/v1/messages', {
      model: 'branch-model',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'anthropic branch' }]
    })
  ).toBe('anthropic-model')
  // OpenAI Chat 分支
  expect(
    await postUpstreamModel('/v1/chat/completions', {
      model: 'branch-model',
      messages: [{ role: 'user', content: 'chat branch' }]
    })
  ).toBe('openai-model')
  // Responses 与 Chat 同属 openai 家族
  expect(
    await postUpstreamModel('/v1/responses', {
      model: 'branch-model',
      input: 'responses branch'
    })
  ).toBe('openai-model')
  // 没有家族映射的模型回退共享 modelRoutes
  expect(
    await postUpstreamModel('/v1/messages', {
      model: 'shared-model',
      max_tokens: 32,
      messages: [{ role: 'user', content: 'shared fallback' }]
    })
  ).toBe('shared-model')

  // 命中模拟器：同一模型按 protocol 得到不同目标
  const simulate = async (protocol: string) => {
    const response = await request.post(`${baseUrl}/api/routing/simulate`, {
      data: { endpoint: endpointId, model: 'branch-model', protocol }
    })
    expect(response.ok()).toBeTruthy()
    return response.json()
  }
  const simulatedAnthropic = await simulate('anthropic')
  expect(simulatedAnthropic).toMatchObject({
    providerId: 'stub',
    modelId: 'anthropic-model'
  })
  const simulatedOpenai = await simulate('openai')
  expect(simulatedOpenai).toMatchObject({
    providerId: 'branch-alt',
    modelId: 'openai-model'
  })

  // 路由模板同时快照共享映射与协议家族映射
  const presetResponse = await request.post(`${baseUrl}/api/routing-presets/${endpointId}`, {
    data: { name: 'branch-preset' }
  })
  expect(presetResponse.ok()).toBeTruthy()
  const endpointsResponse = await request.get(`${baseUrl}/api/custom-endpoints`)
  const endpoints = await endpointsResponse.json()
  const saved = endpoints.endpoints.find((item: any) => item.id === endpointId)
  const preset = saved.routingPresets.find((item: any) => item.name === 'branch-preset')
  expect(preset.modelRoutes['shared-model']).toBe('stub:shared-model')
  expect(preset.modelRoutesByProtocol.anthropic['branch-model']).toBe('stub:anthropic-model')
  expect(preset.modelRoutesByProtocol.openai['branch-model']).toBe('branch-alt:openai-model')

  // 应用模板恢复两套映射：先清空当前路由，再应用，两块映射都应回来
  const clearResponse = await request.put(`${baseUrl}/api/custom-endpoints/${endpointId}`, {
    data: {
      routing: {
        modelRoutes: {},
        modelRoutesByProtocol: { anthropic: {}, openai: {} }
      }
    }
  })
  expect(clearResponse.ok()).toBeTruthy()
  const applyResponse = await request.post(
    `${baseUrl}/api/routing-presets/${endpointId}/apply`,
    { data: { name: 'branch-preset' } }
  )
  expect(applyResponse.ok()).toBeTruthy()
  const afterApplyResponse = await request.get(`${baseUrl}/api/custom-endpoints`)
  const afterApply = (await afterApplyResponse.json()).endpoints.find(
    (item: any) => item.id === endpointId
  )
  expect(afterApply.routing.modelRoutes['shared-model']).toBe('stub:shared-model')
  expect(afterApply.routing.modelRoutesByProtocol?.anthropic?.['branch-model']).toBe(
    'stub:anthropic-model'
  )
  expect(afterApply.routing.modelRoutesByProtocol?.openai?.['branch-model']).toBe(
    'branch-alt:openai-model'
  )
})

// 统一端点的路由行显示协议作用域；改回「全部协议」并保存后，
// 该规则落到共享 modelRoutes，协议家族映射中被移除。
test('unified endpoint route rows expose protocol scope', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const endpointId = `scope-${Date.now()}`
  const endpointPath = `/scope-${endpointId}`

  const createResponse = await request.post(`${baseUrl}/api/custom-endpoints`, {
    data: {
      id: endpointId,
      label: 'Scope Endpoint',
      paths: [
        { path: endpointPath, protocol: 'anthropic' },
        { path: endpointPath, protocol: 'openai-auto' }
      ],
      routing: {
        modelRoutes: {},
        modelRoutesByProtocol: {
          anthropic: { 'branch-model': 'stub:anthropic-model' },
          openai: { 'branch-model': 'stub:openai-model' }
        }
      }
    }
  })
  expect(createResponse.ok()).toBeTruthy()

  await page.goto(`${baseUrl}/ui/routing`)
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()
  await page
    .getByTestId('routing-endpoint-row')
    .filter({ hasText: 'Scope Endpoint' })
    .locator('button')
    .first()
    .click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()

  const rows = workspace.getByTestId('route-rule-row')
  await expect(rows).toHaveCount(2)
  // 派生顺序：共享 → anthropic → openai
  await expect(rows.nth(0).getByTestId('route-rule-scope')).toContainText('Anthropic')
  await expect(rows.nth(1).getByTestId('route-rule-scope')).toContainText('OpenAI')

  // 命中模拟器（走 UI）：同一模型按所选协议命中不同分支
  const simulator = page.getByTestId('routing-hit-simulator')
  const protocolSelect = simulator.getByTestId('simulator-protocol')
  await expect(protocolSelect).toBeVisible()
  await simulator.getByRole('textbox').fill('branch-model')
  await expect(simulator).toContainText('anthropic-model')
  await protocolSelect.click()
  await page.getByRole('option', { name: 'OpenAI' }).last().click()
  await expect(simulator).toContainText('openai-model')

  // 把 OpenAI 分支改回共享规则并保存
  await rows.nth(1).getByTestId('route-rule-scope').click()
  await page.getByRole('option', { name: '全部协议' }).click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  // 保存后 draft 按作用域重新分组：共享行在前，Anthropic 行保留，OpenAI 行消失
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(0).getByTestId('route-rule-scope')).toContainText('全部协议')
  await expect(rows.nth(1).getByTestId('route-rule-scope')).toContainText('Anthropic')

  const endpointsResponse = await request.get(`${baseUrl}/api/custom-endpoints`)
  const endpoints = await endpointsResponse.json()
  const saved = endpoints.endpoints.find((item: any) => item.id === endpointId)
  expect(saved.routing.modelRoutes['branch-model']).toBe('stub:openai-model')
  expect(saved.routing.modelRoutesByProtocol?.anthropic?.['branch-model']).toBe(
    'stub:anthropic-model'
  )
  expect(saved.routing.modelRoutesByProtocol?.openai?.['branch-model']).toBeUndefined()
})
// 删除 Provider 时必须同时清理协议家族映射中的引用，否则后端校验会拒绝
// 整个保存，提供商也删不掉。
test('deleting a provider strips protocol-scoped routes', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const providerId = `branch-del-${Date.now()}`
  const configResponse = await request.get(`${baseUrl}/api/config`)
  const config = await configResponse.json()
  const stub = config.providers.find((provider: any) => provider.id === 'stub')
  const saveConfig = await request.put(`${baseUrl}/api/config`, {
    data: {
      ...config,
      providers: [
        ...config.providers,
        {
          id: providerId,
          label: 'Branch Delete',
          type: 'openai',
          baseUrl: stub.baseUrl,
          apiKey: 'stub-key',
          defaultModel: 'delete-model',
          models: [{ id: 'delete-model', label: 'Delete model' }]
        }
      ]
    }
  })
  expect(saveConfig.ok()).toBeTruthy()

  const endpointId = `del-${Date.now()}`
  const endpointPath = `/del-${endpointId}`
  const createResponse = await request.post(`${baseUrl}/api/custom-endpoints`, {
    data: {
      id: endpointId,
      label: 'Delete Scope Endpoint',
      paths: [
        { path: endpointPath, protocol: 'anthropic' },
        { path: endpointPath, protocol: 'openai-auto' }
      ],
      routing: {
        modelRoutes: {},
        modelRoutesByProtocol: {
          anthropic: { 'branch-model': `${providerId}:delete-model` },
          openai: { 'branch-model': `${providerId}:delete-model` }
        }
      }
    }
  })
  expect(createResponse.ok()).toBeTruthy()

  await page.goto(`${baseUrl}/ui/providers`)
  await page.getByTestId('provider-rail-row').filter({ hasText: 'Branch Delete' }).click()
  const panel = page.getByTestId('provider-detail-panel')
  await panel.getByRole('button', { name: '删除', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: '删除' })
  await dialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('已删除提供商：Branch Delete')).toBeVisible()

  const savedConfig = await (await request.get(`${baseUrl}/api/config`)).json()
  expect(savedConfig.providers.find((provider: any) => provider.id === providerId)).toBeFalsy()
  const savedEndpoint = (await (await request.get(`${baseUrl}/api/custom-endpoints`)).json())
    .endpoints.find((item: any) => item.id === endpointId)
  expect(savedEndpoint.routing.modelRoutesByProtocol?.anthropic?.['branch-model']).toBeUndefined()
  expect(savedEndpoint.routing.modelRoutesByProtocol?.openai?.['branch-model']).toBeUndefined()
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
