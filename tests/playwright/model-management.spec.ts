import { expect, test } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

async function pollCustomEndpoint(request: any, baseUrl: string, endpointId: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${baseUrl}/api/custom-endpoints`)
    // Tolerate a transient non-200 (server still warming up) by retrying
    // instead of hard-failing — the loop's terminal throw still gates correctness.
    if (response.status() !== 200) {
      await delay(250)
      continue
    }
    const body = await response.json()
    const endpoint = body.endpoints.find((item: any) => item.id === endpointId)
    if (endpoint) {
      return endpoint
    }
    await delay(250)
  }

  throw new Error(`endpoint ${endpointId} not found in time`)
}

test('web ui can manage provider, endpoint, routes, and presets', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const providerId = 'playwright-provider'
  const endpointId = 'playwright-endpoint'
  const endpointLabel = 'Playwright Endpoint'
  const updatedEndpointLabel = 'Playwright Endpoint Updated'
  const providerBaseUrl = `http://127.0.0.1:${harness.stubPort}`
  const sourceModel = 'claude-playwright'
  const targetModel = `${providerId}:stub-model-playwright`
  const updatedTargetModel = `${providerId}:*`
  const presetName = 'playwright-preset'

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).first().click()

  // Provider 抽屉从 4 步精简为 2 步：基础与认证 -> 模型与验证
  const providerDrawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await expect(providerDrawer).toBeVisible()
  await providerDrawer.getByRole('button', { name: /OpenAI/ }).click()
  await providerDrawer.getByPlaceholder('如 openai').fill(providerId)
  await providerDrawer.getByPlaceholder('https://api.example.com/v1').fill(providerBaseUrl)
  await providerDrawer.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  await providerDrawer.getByRole('button', { name: '下一步' }).click()
  await providerDrawer.getByRole('button', { name: '新增模型' }).click()
  await providerDrawer.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-playwright')
  await providerDrawer.getByLabel('设为默认模型').check()

  // 新建模式（未保存）：探测草稿配置并勾选导入
  await providerDrawer.getByRole('button', { name: '探测模型' }).click()
  const createProbeDialog = page.getByRole('dialog', { name: '探测可用模型' })
  await expect(createProbeDialog).toBeVisible()
  await createProbeDialog.getByPlaceholder('搜索模型 ID 或名称').fill('probe')
  await createProbeDialog.locator('label').filter({ hasText: 'stub-model-probe' }).click()
  await createProbeDialog.getByRole('button', { name: '导入 1 个模型' }).click()
  await expect(page.getByText('已导入 1 个模型')).toBeVisible()
  await expect(providerDrawer.locator('input[value="stub-model-probe"][placeholder]')).toBeVisible()

  // 新建模式（未保存）：对草稿发起测试连接，内联展示结果
  await providerDrawer.getByRole('button', { name: '测试连接' }).click()
  await expect(providerDrawer.getByText('连接成功')).toBeVisible()

  await providerDrawer.getByRole('button', { name: '保存设置' }).click()

  await expect(page.getByText(`已添加 Provider：${providerId}`)).toBeVisible()
  // 新建后卡片直接出现在网格中（不再自动弹详情对话框）
  const providerCard = page.locator('[data-testid="provider-card"]').filter({ hasText: providerId })
  await expect(providerCard).toBeVisible()

  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const createdProvider = config.providers.find((provider: any) => provider.id === providerId)
  expect(createdProvider).toBeTruthy()
  expect(createdProvider.baseUrl).toBe(providerBaseUrl)
  // 新建流程中探测导入的模型随保存一起落库
  expect(createdProvider.models.map((model: any) => model.id)).toEqual(
    expect.arrayContaining(['stub-model-playwright', 'stub-model-probe'])
  )

  // 操作按钮直接挂在卡片上
  await providerCard.getByRole('button', { name: '测试连接' }).click()

  await providerCard.getByRole('button', { name: '编辑' }).click()
  const editProviderDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await expect(editProviderDrawer).toBeVisible()
  await editProviderDrawer.getByPlaceholder('如 官方主账号').fill('Playwright Provider Updated')
  await editProviderDrawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText('已更新 Provider：Playwright Provider Updated')).toBeVisible()
  // 保存后抽屉关闭，卡片展示新名称
  await expect(page.locator('[data-testid="provider-card"]').filter({ hasText: 'Playwright Provider Updated' })).toBeVisible()

  const providerTestResponse = await request.post(`${baseUrl}/api/providers/${providerId}/test`, {
    data: {},
  })
  expect(providerTestResponse.status()).toBe(200)
  const providerTest = await providerTestResponse.json()
  expect(providerTest.ok).toBe(true)
  expect(providerTest.status).toBe(200)

  // 自定义端点在「路由」视图的端点表格中管理，工具栏「新建端点」弹出创建对话框
  await page.getByRole('tab', { name: '路由' }).click()
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
  await endpointDialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await endpointDialog.getByPlaceholder('如 我的自定义 API').fill(endpointLabel)
  await endpointDialog.getByPlaceholder('如 /custom/api').fill('/playwright/v1/chat/completions')
  await endpointDialog.getByRole('button', { name: '创建' }).click()

  await expect(page.getByText('端点创建成功')).toBeVisible()
  // 新端点出现在路由视图的端点表格中
  const endpointRow = page.locator('[data-testid="endpoint-row"]').filter({ hasText: endpointLabel })
  await expect(endpointRow).toBeVisible()

  const createdEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(createdEndpoint.label).toBe(endpointLabel)
  expect(createdEndpoint.paths[0].path).toBe('/playwright/v1/chat/completions')

  // 点击端点行选中它（内联三栏工作台，不再开弹窗）
  await endpointRow.click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.getByTestId('add-route')).toBeVisible()

  await workspace.getByTestId('add-route').click()
  await workspace.getByTestId('route-rule-source').fill(sourceModel)
  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  // TargetCombobox 的弹层 portal 到 body，不在工作台 DOM 内；选项为 role="option"
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('stub-model-playwright')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*stub-model-playwright`) }).last().click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  let routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  // 路由模板常驻可见（不再折叠进「高级」Disclosure）
  await workspace.getByTestId('preset-name-input').fill(presetName)
  await workspace.getByTestId('save-preset').click()
  await expect(page.getByText(`已保存模板 "${presetName}"。`)).toBeVisible()

  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('透传')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*透传原始模型`) }).click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(updatedTargetModel)

  const presetRow = workspace.getByTestId('preset-row').filter({ hasText: presetName })
  await presetRow.getByTestId('apply-preset').click()
  const diffDialog = page.getByRole('dialog', { name: '应用模板确认' })
  await expect(diffDialog).toBeVisible()
  await diffDialog.getByRole('button', { name: '确认应用' }).click()
  await expect(page.getByText(`已应用模板 "${presetName}"。`)).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  // 端点编辑：rail 行内「编辑」按钮直接发起（无需先关弹窗）
  await endpointRow.getByRole('button', { name: '编辑' }).click()
  const endpointEditDialog = page.getByRole('dialog', { name: '编辑端点' })
  await endpointEditDialog.getByPlaceholder('如 我的自定义 API').fill(updatedEndpointLabel)
  await endpointEditDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('端点更新成功')).toBeVisible()
  // 重命名后重新选中该端点（id 不变，仅 label 变）
  const updatedEndpointRow = page.locator('[data-testid="endpoint-row"]').filter({ hasText: updatedEndpointLabel })
  await updatedEndpointRow.click()

  const updatedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(updatedEndpoint.label).toBe(updatedEndpointLabel)

  const presetDeleteRow = workspace.getByTestId('preset-row').filter({ hasText: presetName })
  await expect(presetDeleteRow).toBeVisible()
  await presetDeleteRow.getByTestId('delete-preset').click()
  const deletePresetDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deletePresetDialog).toBeVisible()
  await deletePresetDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`模板 "${presetName}" 已删除。`)).toBeVisible()
  // 等删除确认框完全退出，避免残留动画中的按钮被误点
  await expect(deletePresetDialog).not.toBeVisible()

  // 切到供应商视图，经编辑抽屉内的「删除」文字链删除 Provider
  await page.getByRole('tab', { name: '供应商' }).click()
  const deleteCard = page.locator('[data-testid="provider-card"]').filter({ hasText: 'Playwright Provider Updated' })
  await deleteCard.getByRole('button', { name: '编辑' }).click()
  const deleteDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await expect(deleteDrawer).toBeVisible()
  await deleteDrawer.getByRole('button', { name: '删除' }).click()
  const deleteProviderDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deleteProviderDialog).toBeVisible()
  await deleteProviderDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除 Provider：Playwright Provider Updated`)).toBeVisible()

  const finalConfigResponse = await request.get(`${baseUrl}/api/config`)
  expect(finalConfigResponse.status()).toBe(200)
  const finalConfig = await finalConfigResponse.json()
  expect(finalConfig.providers.find((provider: any) => provider.id === providerId)).toBeFalsy()
})

test('model management supports provider edit, delete, route reset, and preset delete', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  const providerId = `pm-edit-${Date.now()}`
  const providerBaseUrl = `http://127.0.0.1:${harness.stubPort}`
  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const drawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await drawer.getByRole('button', { name: /OpenAI/ }).click()
  await drawer.getByPlaceholder('如 openai').fill(providerId)
  await drawer.getByPlaceholder('https://api.example.com/v1').fill(providerBaseUrl)
  await drawer.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  await drawer.getByRole('button', { name: '下一步' }).click()
  await drawer.getByRole('button', { name: '新增模型' }).click()
  await drawer.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-edit')
  await drawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText(`已添加 Provider：${providerId}`)).toBeVisible()

  // 新建后卡片直接出现在网格中，编辑从卡片按钮发起
  const providerCard = page.locator('[data-testid="provider-card"]').filter({ hasText: providerId })
  await expect(providerCard).toBeVisible()
  await providerCard.getByRole('button', { name: '编辑' }).click()
  const editDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await editDrawer.getByPlaceholder('如 官方主账号').fill(`${providerId}-edited`)
  await editDrawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText(`已更新 Provider：${providerId}-edited`)).toBeVisible()

  // 保存后抽屉关闭，卡片展示新名称，测试连接从卡片按钮发起
  const editedCard = page.locator('[data-testid="provider-card"]').filter({ hasText: `${providerId}-edited` })
  await expect(editedCard).toBeVisible()
  await editedCard.getByRole('button', { name: '测试连接' }).click()

  // 端点在「路由」视图创建，点击端点行选中它（内联三栏工作台管理规则）
  await page.getByRole('tab', { name: '路由' }).click()
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
  const endpointId = `pm-edit-endpoint-${Date.now()}`
  await endpointDialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await endpointDialog.getByPlaceholder('如 我的自定义 API').fill('Edit Endpoint')
  await endpointDialog.getByPlaceholder('如 /custom/api').fill(`/playwright/${endpointId}`)
  await endpointDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('端点创建成功')).toBeVisible()

  await page.locator('[data-testid="endpoint-row"]').filter({ hasText: 'Edit Endpoint' }).click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()
  await workspace.getByTestId('add-route').click()
  await workspace.getByTestId('route-rule-source').fill('reset-source')
  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  // TargetCombobox 的弹层 portal 到 body，不在工作台 DOM 内；选项为 role="option"
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('stub-model-edit')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*stub-model-edit`) }).last().click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('透传')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*透传原始模型`) }).click()
  await workspace.getByTestId('reset-routes').click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  const resetEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(resetEndpoint.routing.modelRoutes['reset-source']).toBe(`${providerId}:stub-model-edit`)

  await workspace.getByTestId('preset-name-input').fill('preset-delete-test')
  await workspace.getByTestId('save-preset').click()
  await expect(page.getByText('已保存模板 "preset-delete-test"。')).toBeVisible()
  const presetDeleteRow = workspace.getByTestId('preset-row').filter({ hasText: 'preset-delete-test' })
  await expect(presetDeleteRow).toBeVisible()
  await presetDeleteRow.getByTestId('delete-preset').click()
  const deleteDialog = page.getByRole('dialog', { name: '删除' }).first()
  await deleteDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('模板 "preset-delete-test" 已删除。')).toBeVisible()
  // 等删除确认框完全退出，避免残留动画中的按钮被误点
  await expect(deleteDialog).not.toBeVisible()

  // 切到供应商视图，经编辑抽屉内的「删除」文字链删除 Provider
  await page.getByRole('tab', { name: '供应商' }).click()
  const deleteCard = page.locator('[data-testid="provider-card"]').filter({ hasText: `${providerId}-edited` })
  await deleteCard.getByRole('button', { name: '编辑' }).click()
  const deleteDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await expect(deleteDrawer).toBeVisible()
  await deleteDrawer.getByRole('button', { name: '删除' }).click()
  const confirmDialog = page.getByRole('dialog', { name: '删除' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除 Provider：${providerId}-edited`)).toBeVisible()
})

test('routing rules can be reordered by dragging the grip handle', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const endpointId = `drag-endpoint-${Date.now()}`
  const sourceA = 'drag-source-a'
  const sourceB = 'drag-source-b'

  await page.goto(`${baseUrl}/ui/providers?tab=routing`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  // 自定义端点（stub provider 已由 harness 预置，复用其 stub-model 作为目标）
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
  await endpointDialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await endpointDialog.getByPlaceholder('如 我的自定义 API').fill('Drag Endpoint')
  await endpointDialog.getByPlaceholder('如 /custom/api').fill(`/playwright/${endpointId}`)
  await endpointDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('端点创建成功')).toBeVisible()

  await page.locator('[data-testid="endpoint-row"]').filter({ hasText: 'Drag Endpoint' }).click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()

  // 两条已填满的规则（source 各异，target 同为 stub:stub-model）
  for (const source of [sourceA, sourceB]) {
    await workspace.getByTestId('add-route').click()
    await workspace.getByTestId('route-rule-source').last().fill(source)
    // 目标输入框带 placeholder 属性，未选时与已选都匹配 → 取最后一条（最新行）
    await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').last().click()
    await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('stub-model')
    await page.getByRole('option', { name: /stub.*stub-model/ }).last().click()
  }
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  let persisted = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(Object.keys(persisted.routing.modelRoutes)).toEqual([sourceA, sourceB])

  // 鼠标拖拽第 0 行手柄到第 1 行位置：PointerSensor 需移动 ≥6px 才激活，分步移动
  const firstGrip = workspace.getByTestId('route-rule-row').first().getByTestId('route-rule-grip')
  const secondRow = workspace.getByTestId('route-rule-row').nth(1)
  const gripBox = await firstGrip.boundingBox()
  const targetBox = await secondRow.boundingBox()
  expect(gripBox).toBeTruthy()
  expect(targetBox).toBeTruthy()
  await page.mouse.move(gripBox!.x + gripBox!.width / 2, gripBox!.y + gripBox!.height / 2)
  await page.mouse.down()
  await page.mouse.move(targetBox!.x + targetBox!.width / 2, targetBox!.y + targetBox!.height / 2, { steps: 15 })
  await page.mouse.up()

  // 本地 draft 顺序已交换（sourceB 上移到首行）
  await expect.poll(
    () => workspace.getByTestId('route-rule-source').evaluateAll((inputs) => inputs.map((el) => (el as HTMLInputElement).value))
  ).toEqual([sourceB, sourceA])

  // 合成鼠标拖拽后 dnd-kit 会残留 document 级监听，吞掉保存按钮的点击。切到「供应商」
  // 再切回「路由」可卸载/重挂 RoutingWorkspace（React 清理掉残留监听）；routesByEndpoint 是
  // 页面级状态、切 tab 不丢失，[B,A] 顺序保留，端点经 URL ?endpoint= 自动重选。
  await page.getByRole('tab', { name: '供应商' }).click()
  await page.getByRole('tab', { name: '路由' }).click()
  await expect(workspace).toBeVisible()

  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  // 保存后后端 modelRoutes 的 key 顺序随之交换（验证 IndexMap 保序往返）
  persisted = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(Object.keys(persisted.routing.modelRoutes)).toEqual([sourceB, sourceA])
})

test('provider models can be probed and selectively imported', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '模型与路由工作台', level: 1 })).toBeVisible()

  // stub provider 由 harness 预置（已含 stub-model），从卡片进入编辑抽屉
  const card = page.locator('[data-testid="provider-card"]').filter({ hasText: 'Stub Provider' })
  await expect(card).toBeVisible()
  await card.getByRole('button', { name: '编辑' }).click()
  const drawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await expect(drawer).toBeVisible()
  await drawer.getByRole('button', { name: '下一步' }).click()

  // 打开探测弹窗（stub 上游返回 stub-model + stub-model-probe）
  await drawer.getByRole('button', { name: '探测模型' }).click()
  const dialog = page.getByRole('dialog', { name: '探测可用模型' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByText('共 2 个模型')).toBeVisible()

  // 已在表单中的 stub-model 置灰标记「已导入」，checkbox 禁用
  const importedRow = dialog.locator('label').filter({ hasText: '已导入' })
  await expect(importedRow).toHaveCount(1)
  await expect(importedRow).toContainText('stub-model')
  await expect(importedRow.locator('input[type="checkbox"]')).toBeDisabled()

  // 搜索过滤后勾选新模型并导入
  await dialog.getByPlaceholder('搜索模型 ID 或名称').fill('probe')
  const probeRow = dialog.locator('label').filter({ hasText: 'stub-model-probe' })
  await expect(probeRow).toHaveCount(1)
  await expect(probeRow).toContainText('Stub Probe Model')
  await probeRow.click()
  await expect(dialog.getByText('已选 1 个')).toBeVisible()
  await dialog.getByRole('button', { name: '导入 1 个模型' }).click()
  await expect(page.getByText('已导入 1 个模型')).toBeVisible()

  // 抽屉中出现新模型行（id 与 display_name 预填的 label）
  await expect(drawer.locator('input[value="stub-model-probe"][placeholder]')).toBeVisible()
  await expect(drawer.locator('input[value="Stub Probe Model"]')).toBeVisible()

  // 保存后写入配置：新模型合并进来，已有模型保持不变
  await drawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText('已更新 Provider：Stub Provider')).toBeVisible()
  const configResponse = await request.get(`${baseUrl}/api/config`)
  const config = await configResponse.json()
  const stubProvider = config.providers.find((provider: any) => provider.id === 'stub')
  const modelIds = stubProvider.models.map((model: any) => model.id)
  expect(modelIds).toContain('stub-model')
  expect(modelIds).toContain('stub-model-probe')
  const probed = stubProvider.models.find((model: any) => model.id === 'stub-model-probe')
  expect(probed.label).toBe('Stub Probe Model')
  const original = stubProvider.models.find((model: any) => model.id === 'stub-model')
  expect(original.label).toBe('Stub Model')
})
