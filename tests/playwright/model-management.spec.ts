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
    expect(response.status()).toBe(200)
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
  await providerDrawer.getByRole('button', { name: '保存设置' }).click()

  await expect(page.getByText(`已添加 Provider：${providerId}`)).toBeVisible()
  // 新建后自动选中并弹出详情对话框
  const detailDialog = page.getByRole('dialog', { name: providerId })
  await expect(detailDialog).toBeVisible()

  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const createdProvider = config.providers.find((provider: any) => provider.id === providerId)
  expect(createdProvider).toBeTruthy()
  expect(createdProvider.baseUrl).toBe(providerBaseUrl)

  // 操作按钮在详情对话框内
  await detailDialog.getByRole('button', { name: '测试连接' }).click()

  await detailDialog.getByRole('button', { name: '编辑' }).click()
  const editProviderDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await expect(editProviderDrawer).toBeVisible()
  await editProviderDrawer.getByPlaceholder('如 官方主账号').fill('Playwright Provider Updated')
  await editProviderDrawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText('已更新 Provider：Playwright Provider Updated')).toBeVisible()
  // 编辑时详情对话框关闭，表格行展示新名称
  await expect(page.locator('[data-testid="provider-row"]').filter({ hasText: 'Playwright Provider Updated' })).toBeVisible()

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

  // 点击端点行打开路由编辑弹框，路由规则在弹框内编辑
  await endpointRow.click()
  const routeDialog = page.getByTestId('route-editor-dialog')
  await expect(routeDialog).toBeVisible()
  await expect(routeDialog.getByRole('button', { name: '新增映射' })).toBeVisible()

  await routeDialog.getByRole('button', { name: '新增映射' }).click()
  await routeDialog.getByLabel('route-source-1').fill(sourceModel)
  await routeDialog.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  // TargetCombobox 的弹层 portal 到 body，不在 dialog DOM 内；选项为 role="option"
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('stub-model-playwright')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*stub-model-playwright`) }).last().click()
  await routeDialog.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  let routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  // 路由模板收进「高级」Disclosure，需先展开
  await routeDialog.locator('summary').filter({ hasText: '高级' }).click()
  await routeDialog.getByRole('button', { name: /路由模板/ }).click()
  await routeDialog.getByPlaceholder('输入模板名称，例如 fox').fill(presetName)
  await routeDialog.getByRole('button', { name: '保存模板' }).click()
  await expect(page.getByText(`已保存模板 "${presetName}"。`)).toBeVisible()

  await routeDialog.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('透传')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*透传原始模型`) }).click()
  await routeDialog.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(updatedTargetModel)

  const presetRow = routeDialog.locator('div').filter({ hasText: presetName }).filter({
    has: page.getByRole('button', { name: '应用' }),
  }).first()
  await presetRow.getByRole('button', { name: '应用' }).click()
  const diffDialog = page.getByRole('dialog', { name: '应用模板确认' })
  await expect(diffDialog).toBeVisible()
  await diffDialog.getByRole('button', { name: '确认应用' }).click()
  await expect(page.getByText(`已应用模板 "${presetName}"。`)).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  // 端点编辑在路由视图的端点表格中发起；先关闭路由弹框，再点行内「编辑」
  await routeDialog.getByRole('button', { name: '关闭' }).click()
  await expect(routeDialog).not.toBeVisible()
  await endpointRow.getByRole('button', { name: '编辑' }).click()
  const endpointEditDialog = page.getByRole('dialog', { name: '编辑端点' })
  await endpointEditDialog.getByPlaceholder('如 我的自定义 API').fill(updatedEndpointLabel)
  await endpointEditDialog.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('端点更新成功')).toBeVisible()
  // 重新打开路由弹框后「高级」Disclosure 处于收起态，需重新展开
  const updatedEndpointRow = page.locator('[data-testid="endpoint-row"]').filter({ hasText: updatedEndpointLabel })
  await updatedEndpointRow.click()
  await expect(routeDialog).toBeVisible()
  await routeDialog.locator('summary').filter({ hasText: '高级' }).click()

  const updatedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(updatedEndpoint.label).toBe(updatedEndpointLabel)

  const presetDeleteRow = routeDialog.locator('div').filter({ hasText: presetName }).filter({
    has: page.getByRole('button', { name: '应用' }),
  }).first()
  await expect(presetDeleteRow).toBeVisible()
  // presetDeleteRow 是宽松匹配（可能含详情面板的 Provider「删除」），模板行的「删除」在最后
  await presetDeleteRow.getByRole('button', { name: '删除' }).last().click()
  const deletePresetDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deletePresetDialog).toBeVisible()
  await deletePresetDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`模板 "${presetName}" 已删除。`)).toBeVisible()
  // 等删除确认框完全退出，避免残留动画中的「删除」按钮被误点
  await expect(deletePresetDialog).not.toBeVisible()

  // 关闭路由弹框后再切换视图；Provider 删除按钮在「供应商」视图的详情对话框内。
  // 用页脚「关闭」按钮而不是 Escape：确认框退出动画期间其 layer 仍挂在
  // DismissableLayer 栈顶，会吞掉 Escape（按钮点击由 Playwright 等待可点后触发）。
  await routeDialog.getByRole('button', { name: '关闭' }).click()
  await expect(routeDialog).not.toBeVisible()
  await page.getByRole('tab', { name: '供应商' }).click()
  await page.locator('[data-testid="provider-row"]').filter({ hasText: 'Playwright Provider Updated' }).click()
  const providerDetailDialog = page.getByRole('dialog', { name: 'Playwright Provider Updated' })
  await expect(providerDetailDialog).toBeVisible()
  await providerDetailDialog.getByRole('button', { name: '删除' }).click()
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

  // 新建后自动选中并弹出详情对话框，编辑在对话框内发起
  const detailDialog = page.getByRole('dialog', { name: providerId })
  await expect(detailDialog).toBeVisible()
  await detailDialog.getByRole('button', { name: '编辑' }).click()
  const editDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await editDrawer.getByPlaceholder('如 官方主账号').fill(`${providerId}-edited`)
  await editDrawer.getByRole('button', { name: '保存设置' }).click()
  await expect(page.getByText(`已更新 Provider：${providerId}-edited`)).toBeVisible()

  // 编辑时详情对话框关闭，重新点击表格行打开后再测试连接
  await page.locator('[data-testid="provider-row"]').filter({ hasText: `${providerId}-edited` }).click()
  const editedDetailDialog = page.getByRole('dialog', { name: `${providerId}-edited` })
  await expect(editedDetailDialog).toBeVisible()
  await editedDetailDialog.getByRole('button', { name: '测试连接' }).click()
  // 详情对话框是模态框，切视图前先关闭
  await page.keyboard.press('Escape')
  await expect(editedDetailDialog).not.toBeVisible()

  // 端点在「路由」视图的端点表格中创建，点击行打开路由编辑弹框管理规则
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
  const routeDialog = page.getByTestId('route-editor-dialog')
  await expect(routeDialog).toBeVisible()
  await routeDialog.getByRole('button', { name: '新增映射' }).click()
  await routeDialog.getByLabel('route-source-1').fill('reset-source')
  await routeDialog.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  // TargetCombobox 的弹层 portal 到 body，不在 dialog DOM 内；选项为 role="option"
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('stub-model-edit')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*stub-model-edit`) }).last().click()
  await routeDialog.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  await routeDialog.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('透传')
  await page.getByRole('option', { name: new RegExp(`${providerId}.*透传原始模型`) }).click()
  await routeDialog.getByRole('button', { name: '重置' }).click()
  await routeDialog.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  const resetEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(resetEndpoint.routing.modelRoutes['reset-source']).toBe(`${providerId}:stub-model-edit`)

  await routeDialog.locator('summary').filter({ hasText: '高级' }).click()
  await routeDialog.getByRole('button', { name: /路由模板/ }).click()
  await routeDialog.getByPlaceholder('输入模板名称，例如 fox').fill('preset-delete-test')
  await routeDialog.getByRole('button', { name: '保存模板' }).click()
  await expect(page.getByText('已保存模板 "preset-delete-test"。')).toBeVisible()
  const presetDeleteRow = routeDialog.locator('div').filter({ hasText: 'preset-delete-test' }).filter({
    has: page.getByRole('button', { name: '应用' }),
  }).first()
  await expect(presetDeleteRow).toBeVisible()
  await presetDeleteRow.getByRole('button', { name: '删除' }).last().click()
  const deleteDialog = page.getByRole('dialog', { name: '删除' }).first()
  await deleteDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('模板 "preset-delete-test" 已删除。')).toBeVisible()
  // 等删除确认框完全退出，避免残留动画中的「删除」按钮被误点
  await expect(deleteDialog).not.toBeVisible()

  // 关闭路由弹框后再切换视图；Provider 删除按钮在「供应商」视图的详情对话框内。
  // 用页脚「关闭」按钮而不是 Escape：确认框退出动画期间其 layer 仍挂在
  // DismissableLayer 栈顶，会吞掉 Escape（按钮点击由 Playwright 等待可点后触发）。
  await routeDialog.getByRole('button', { name: '关闭' }).click()
  await expect(routeDialog).not.toBeVisible()
  await page.getByRole('tab', { name: '供应商' }).click()
  await page.locator('[data-testid="provider-row"]').filter({ hasText: `${providerId}-edited` }).click()
  const providerDetailDialog = page.getByRole('dialog', { name: `${providerId}-edited` })
  await expect(providerDetailDialog).toBeVisible()
  await providerDetailDialog.getByRole('button', { name: '删除' }).click()
  const confirmDialog = page.getByRole('dialog', { name: '删除' })
  await expect(confirmDialog).toBeVisible()
  await confirmDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除 Provider：${providerId}-edited`)).toBeVisible()
})
