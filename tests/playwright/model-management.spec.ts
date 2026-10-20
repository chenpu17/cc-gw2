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
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()

  // 创建走「模板 + id/label」小对话框；其余配置都在右侧详情面板内联完成
  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增提供商' })
  await expect(createDialog).toBeVisible()
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: 'OpenAI 兼容', exact: true }).click()
  // 模板自动预填 Base URL（可改写为 stub 地址）
  await expect(createDialog.getByPlaceholder('https://api.example.com/v1')).toHaveValue('https://api.openai.com/v1')
  await createDialog.getByPlaceholder('如 openai').fill(providerId)
  await createDialog.getByPlaceholder('https://api.example.com/v1').fill(providerBaseUrl)
  await createDialog.getByRole('button', { name: '创建' }).click()

  await expect(page.getByText(`已添加提供商：${providerId}`)).toBeVisible()
  // 创建后自动选中，左侧 rail 行 + 右侧详情面板同时出现
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await expect(page.getByTestId('provider-rail-row').filter({ hasText: providerId })).toBeVisible()

  // 面板内联编辑：密钥 + 模型 + 设默认
  await panel.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  await panel.getByRole('button', { name: '新增模型' }).click()
  await panel.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-playwright')
  await panel.getByLabel('设为默认模型').check()

  // 未保存草稿即可探测（后端按草稿探测），勾选导入
  await panel.getByRole('button', { name: '探测模型' }).click()
  const createProbeDialog = page.getByRole('dialog', { name: '探测可用模型' })
  await expect(createProbeDialog).toBeVisible()
  await createProbeDialog.getByPlaceholder('搜索模型 ID 或名称').fill('probe')
  await createProbeDialog.locator('label').filter({ hasText: 'stub-model-probe' }).click()
  await createProbeDialog.getByRole('button', { name: '导入 1 个模型' }).click()
  await expect(page.getByText('已导入 1 个模型')).toBeVisible()
  await expect(panel.locator('input[value="stub-model-probe"][placeholder]')).toBeVisible()

  // 已保存 Provider 的连接测试从面板 header 发起，结果内联展示
  await panel.getByRole('button', { name: '测试连接' }).first().click()
  await expect(panel.getByText('连接成功')).toBeVisible()

  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}`)).toBeVisible()

  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const createdProvider = config.providers.find((provider: any) => provider.id === providerId)
  expect(createdProvider).toBeTruthy()
  expect(createdProvider.baseUrl).toBe(providerBaseUrl)
  // 探测导入的模型随保存一起落库
  expect(createdProvider.models.map((model: any) => model.id)).toEqual(
    expect.arrayContaining(['stub-model-playwright', 'stub-model-probe'])
  )

  // 面板内改显示名称并保存
  await panel.getByTestId('provider-edit').click()
  await panel.getByPlaceholder('如 官方主账号').fill('Playwright Provider Updated')
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新提供商：Playwright Provider Updated')).toBeVisible()
  await expect(page.getByTestId('provider-rail-row').filter({ hasText: 'Playwright Provider Updated' })).toBeVisible()

  const providerTestResponse = await request.post(`${baseUrl}/api/providers/${providerId}/test`, {
    data: {},
  })
  expect(providerTestResponse.status()).toBe(200)
  const providerTest = await providerTestResponse.json()
  expect(providerTest.ok).toBe(true)
  expect(providerTest.status).toBe(200)

  // 路由规则在独立 /routing 页管理，工具栏「新建端点」弹出创建对话框
  await page.getByRole('link', { name: '路由' }).click()
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
  await endpointDialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await endpointDialog.getByPlaceholder('如 我的自定义 API').fill(endpointLabel)
  await endpointDialog.getByPlaceholder('如 /custom/api').fill('/playwright/v1/chat/completions')
  await endpointDialog.getByRole('button', { name: '创建' }).click()

  await expect(page.getByText('端点创建成功')).toBeVisible()

  const createdEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(createdEndpoint.label).toBe(endpointLabel)
  expect(createdEndpoint.paths[0].path).toBe('/playwright/v1/chat/completions')

  // 新端点经工具栏切换器选中（旧端点表格已随端点 rail 退役）
  await page.getByTestId('routing-endpoint-switcher').click()
  await page.getByRole('option', { name: new RegExp(endpointLabel) }).click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()
  await expect(workspace.getByTestId('add-route')).toBeVisible()

  await workspace.getByTestId('add-route').click()
  await workspace.getByTestId('route-rule-source').fill(sourceModel)
  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  // TargetCombobox 的弹层 portal 到 body，不在工作台 DOM 内；选项为 role="option"
  await page.getByPlaceholder('搜索提供商、模型名或 ID').fill('stub-model-playwright')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*stub-model-playwright`) }).last().click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  let routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  // 路由模板在「模板」工具栏弹窗内管理
  await page.getByRole('button', { name: '模板' }).click()
  const presetsDialog = page.getByRole('dialog', { name: '路由模板' })
  await expect(presetsDialog.getByTestId('routing-presets-card')).toBeVisible()
  await presetsDialog.getByTestId('preset-name-input').fill(presetName)
  await presetsDialog.getByTestId('save-preset').click()
  await expect(page.getByText(`已保存模板 "${presetName}"。`)).toBeVisible()
  // 关弹窗回工作台继续改规则（点 Close 按钮；Escape 依赖焦点恢复，嵌套
  // 确认框关闭后焦点可能落回 body，按 Esc 关不掉弹窗）
  await presetsDialog.getByRole('button', { name: 'Close' }).click()
  await expect(presetsDialog).not.toBeVisible()

  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByPlaceholder('搜索提供商、模型名或 ID').fill('透传')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*透传原始模型`) }).click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(updatedTargetModel)

  await page.getByRole('button', { name: '模板' }).click()
  const presetRow = presetsDialog.getByTestId('preset-row').filter({ hasText: presetName })
  await presetRow.getByTestId('apply-preset').click()
  const diffDialog = page.getByRole('dialog', { name: '应用模板确认' })
  await expect(diffDialog).toBeVisible()
  await diffDialog.getByRole('button', { name: '确认应用' }).click()
  await expect(page.getByText(`已应用模板 "${presetName}"。`)).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  // 端点编辑：切换器选中自定义端点后，点切换器旁的「编辑」
  await presetsDialog.getByRole('button', { name: 'Close' }).click()
  await expect(presetsDialog).not.toBeVisible()
  await page.getByTestId('routing-endpoint-switcher').click()
  await page.getByRole('option', { name: new RegExp(endpointLabel) }).click()
  await page.getByTestId('endpoint-edit').click()
  const endpointEditDialog = page.getByRole('dialog', { name: '编辑端点' })
  await endpointEditDialog.getByPlaceholder('如 我的自定义 API').fill(updatedEndpointLabel)
  await endpointEditDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('端点更新成功')).toBeVisible()
  // 重命名后端点 id 不变保持选中；切换器随 custom-endpoints 失效刷新 label
  await expect(page.getByTestId('routing-endpoint-switcher')).toContainText(updatedEndpointLabel)

  const updatedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(updatedEndpoint.label).toBe(updatedEndpointLabel)

  await page.getByRole('button', { name: '模板' }).click()
  const presetDeleteRow = presetsDialog.getByTestId('preset-row').filter({ hasText: presetName })
  await expect(presetDeleteRow).toBeVisible()
  await presetDeleteRow.getByTestId('delete-preset').click()
  const deletePresetDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deletePresetDialog).toBeVisible()
  await deletePresetDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`模板 "${presetName}" 已删除。`)).toBeVisible()
  // 等删除确认框完全退出，避免残留动画中的按钮被误点
  await expect(deletePresetDialog).not.toBeVisible()
  await presetsDialog.getByRole('button', { name: 'Close' }).click()
  await expect(presetsDialog).not.toBeVisible()

  // 回到提供商页，选中后经面板 header「删除」删除提供商
  await page.getByRole('link', { name: '提供商' }).click()
  await page.getByTestId('provider-rail-row').filter({ hasText: 'Playwright Provider Updated' }).click()
  const deletePanel = page.getByTestId('provider-detail-panel')
  await expect(deletePanel).toBeVisible()
  await deletePanel.getByRole('button', { name: '删除', exact: true }).click()
  const deleteProviderDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deleteProviderDialog).toBeVisible()
  await deleteProviderDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除提供商：Playwright Provider Updated`)).toBeVisible()

  const finalConfigResponse = await request.get(`${baseUrl}/api/config`)
  expect(finalConfigResponse.status()).toBe(200)
  const finalConfig = await finalConfigResponse.json()
  expect(finalConfig.providers.find((provider: any) => provider.id === providerId)).toBeFalsy()
})

test('model management supports provider edit, delete, route reset, and preset delete', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()

  const providerId = `pm-edit-${Date.now()}`
  const providerBaseUrl = `http://127.0.0.1:${harness.stubPort}`
  await page.getByRole('button', { name: '新增提供商' }).first().click()
  const createDialog = page.getByRole('dialog', { name: '新增提供商' })
  await createDialog.getByRole('combobox', { name: '模板' }).click()
  await page.getByRole('option', { name: 'OpenAI 兼容', exact: true }).click()
  await createDialog.getByPlaceholder('如 openai').fill(providerId)
  await createDialog.getByPlaceholder('https://api.example.com/v1').fill(providerBaseUrl)
  await createDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText(`已添加提供商：${providerId}`)).toBeVisible()

  // 创建后自动选中详情面板，内联编辑模型后保存
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  await panel.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  await panel.getByRole('button', { name: '新增模型' }).click()
  await panel.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-edit')
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}`)).toBeVisible()

  // 面板内改显示名称并保存，rail 行随配置轮询更新（保存后回只读档案，
  // 再次编辑需显式进入）
  await panel.getByTestId('provider-edit').click()
  await panel.getByPlaceholder('如 官方主账号').fill(`${providerId}-edited`)
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText(`已更新提供商：${providerId}-edited`)).toBeVisible()
  const editedRow = page.getByTestId('provider-rail-row').filter({ hasText: `${providerId}-edited` })
  await expect(editedRow).toBeVisible()
  // 连接测试从面板 header 发起（保存后处于只读档案，结果以头部徽章展示）
  await panel.getByRole('button', { name: '测试连接' }).first().click()
  await expect(panel.getByText('已连通')).toBeVisible()

  // 端点在 /routing 页创建，工具栏切换器选中它管理规则
  await page.getByRole('link', { name: '路由' }).click()
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
  const endpointId = `pm-edit-endpoint-${Date.now()}`
  await endpointDialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await endpointDialog.getByPlaceholder('如 我的自定义 API').fill('Edit Endpoint')
  await endpointDialog.getByPlaceholder('如 /custom/api').fill(`/playwright/${endpointId}`)
  await endpointDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('端点创建成功')).toBeVisible()

  await page.getByTestId('routing-endpoint-switcher').click()
  await page.getByRole('option', { name: /Edit Endpoint/ }).click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()
  await workspace.getByTestId('add-route').click()
  await workspace.getByTestId('route-rule-source').fill('reset-source')
  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  // TargetCombobox 的弹层 portal 到 body，不在工作台 DOM 内；选项为 role="option"
  await page.getByPlaceholder('搜索提供商、模型名或 ID').fill('stub-model-edit')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*stub-model-edit`) }).last().click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByPlaceholder('搜索提供商、模型名或 ID').fill('透传')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*透传原始模型`) }).click()
  await workspace.getByTestId('reset-routes').click()
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  const resetEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(resetEndpoint.routing.modelRoutes['reset-source']).toBe(`${providerId}:stub-model-edit`)

  // 模板保存/删除都在「模板」工具栏弹窗内完成
  await page.getByRole('button', { name: '模板' }).click()
  const presetsDialog = page.getByRole('dialog', { name: '路由模板' })
  await presetsDialog.getByTestId('preset-name-input').fill('preset-delete-test')
  await presetsDialog.getByTestId('save-preset').click()
  await expect(page.getByText('已保存模板 "preset-delete-test"。')).toBeVisible()
  const presetDeleteRow = presetsDialog.getByTestId('preset-row').filter({ hasText: 'preset-delete-test' })
  await expect(presetDeleteRow).toBeVisible()
  await presetDeleteRow.getByTestId('delete-preset').click()
  const deleteDialog = page.getByRole('dialog', { name: '删除' }).first()
  await deleteDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('模板 "preset-delete-test" 已删除。')).toBeVisible()
  // 等删除确认框完全退出，避免残留动画中的按钮被误点
  await expect(deleteDialog).not.toBeVisible()
  await presetsDialog.getByRole('button', { name: 'Close' }).click()
  await expect(presetsDialog).not.toBeVisible()

  // 回到提供商页，选中后经面板 header「删除」删除提供商
  await page.getByRole('link', { name: '提供商' }).click()
  await page.getByTestId('provider-rail-row').filter({ hasText: `${providerId}-edited` }).click()
  const deletePanel = page.getByTestId('provider-detail-panel')
  await expect(deletePanel).toBeVisible()
  await deletePanel.getByRole('button', { name: '删除', exact: true }).click()
  const confirmDialog = page.getByRole('dialog', { name: '删除' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除提供商：${providerId}-edited`)).toBeVisible()
})

test('routing rules can be reordered by dragging the grip handle', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const endpointId = `drag-endpoint-${Date.now()}`
  const sourceA = 'drag-source-a'
  const sourceB = 'drag-source-b'

  await page.goto(`${baseUrl}/ui/routing`)
  await expect(page.getByRole('heading', { name: '路由', level: 1 })).toBeVisible()

  // 自定义端点（stub provider 已由 harness 预置，复用其 stub-model 作为目标）
  await page.getByRole('button', { name: '新建端点' }).first().click()
  const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
  await endpointDialog.getByPlaceholder('如 custom-api').fill(endpointId)
  await endpointDialog.getByPlaceholder('如 我的自定义 API').fill('Drag Endpoint')
  await endpointDialog.getByPlaceholder('如 /custom/api').fill(`/playwright/${endpointId}`)
  await endpointDialog.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('端点创建成功')).toBeVisible()

  await page.getByTestId('routing-endpoint-switcher').click()
  await page.getByRole('option', { name: /Drag Endpoint/ }).click()
  const workspace = page.getByTestId('routing-workspace')
  await expect(workspace).toBeVisible()

  // 两条已填满的规则（source 各异，target 同为 stub:stub-model）
  for (const source of [sourceA, sourceB]) {
    await workspace.getByTestId('add-route').click()
    await workspace.getByTestId('route-rule-source').last().fill(source)
    // 目标输入框带 placeholder 属性，未选时与已选都匹配 → 取最后一条（最新行）
    await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').last().click()
    await page.getByPlaceholder('搜索提供商、模型名或 ID').fill('stub-model')
    await page.getByRole('option', { name: /stub.*stub-model/ }).last().click()
  }
  await workspace.getByTestId('save-routes').click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  const persisted = await pollCustomEndpoint(request, baseUrl, endpointId)
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

  // dnd-kit 拖拽结束后，sensor 会在 document 捕获阶段残留 stopPropagation
  // 的 click 监听（detach 延迟移除，实测窗口几百毫秒），期间任何 click
  // （含 Playwright 合成点击）都会被吞掉。等窗口过期后再点保存。
  await page.waitForTimeout(800)
  await workspace.getByTestId('save-routes').click()
  // 保存 toast 用 .first() 断言会撞上第一次保存仍未消失的旧 toast（假阳性），
  // 这里直接轮询后端持久化结果，验证第二次保存确实落地且顺序已交换。
  await expect.poll(
    async () => {
      const current = await pollCustomEndpoint(request, baseUrl, endpointId)
      return Object.keys(current.routing.modelRoutes)
    },
    { timeout: 10_000 }
  ).toEqual([sourceB, sourceA])
})

test('provider models can be probed and selectively imported', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/providers`)
  await expect(page.getByRole('heading', { name: '提供商', level: 1 })).toBeVisible()

  // stub provider 由 harness 预置（已含 stub-model），在 rail 中选中进入面板
  const railRow = page.getByTestId('provider-rail-row').filter({ hasText: 'Stub Provider' })
  await expect(railRow).toBeVisible()
  await railRow.click()
  const panel = page.getByTestId('provider-detail-panel')
  await expect(panel).toBeVisible()
  // 探测入口在编辑态模型区
  await panel.getByTestId('provider-edit').click()

  // 打开探测弹窗（stub 上游返回 stub-model + stub-model-probe）
  await panel.getByRole('button', { name: '探测模型' }).click()
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

  // 面板中出现新模型行（id 与 display_name 预填的 label）
  await expect(panel.locator('input[value="stub-model-probe"][placeholder]')).toBeVisible()
  await expect(panel.locator('input[value="Stub Probe Model"]')).toBeVisible()

  // 保存后写入配置：新模型合并进来，已有模型保持不变
  await panel.getByTestId('provider-save').click()
  await expect(page.getByText('已更新提供商：Stub Provider')).toBeVisible()
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
