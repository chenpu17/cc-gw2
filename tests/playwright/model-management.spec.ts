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

  await page.goto(`${baseUrl}/ui/models`)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).click()

  const providerDrawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await expect(providerDrawer).toBeVisible()
  await providerDrawer.getByPlaceholder('如 openai').fill(providerId)
  await providerDrawer.getByRole('button', { name: /OpenAI/ }).click()
  await providerDrawer.getByPlaceholder('https://api.example.com/v1').fill(providerBaseUrl)
  await providerDrawer.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  await providerDrawer.getByRole('button', { name: '新增模型' }).click()
  await providerDrawer.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-playwright')
  await providerDrawer.getByLabel('设为默认模型').check()
  await providerDrawer.getByRole('button', { name: '保存' }).click()

  await expect(page.getByText(`已添加 Provider：${providerId}`)).toBeVisible()
  await expect(page.getByRole('heading', { name: providerId, level: 3 })).toBeVisible()

  const configResponse = await request.get(`${baseUrl}/api/config`)
  expect(configResponse.status()).toBe(200)
  const config = await configResponse.json()
  const createdProvider = config.providers.find((provider: any) => provider.id === providerId)
  expect(createdProvider).toBeTruthy()
  expect(createdProvider.baseUrl).toBe(providerBaseUrl)

  const providerCard = page.locator(
    `xpath=//h3[normalize-space()="${providerId}"]/ancestor::div[contains(@class,"surface-1")][1]`
  )
  await expect(providerCard.getByRole('button', { name: '测试连接' })).toBeVisible()
  await providerCard.getByRole('button', { name: '测试连接' }).click()

  await providerCard.getByRole('button', { name: '编辑' }).click()
  const editProviderDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await expect(editProviderDrawer).toBeVisible()
  await editProviderDrawer.getByPlaceholder('如 官方主账号').fill('Playwright Provider Updated')
  await editProviderDrawer.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('已更新 Provider：Playwright Provider Updated')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Playwright Provider Updated', level: 3 })).toBeVisible()

  const providerTestResponse = await request.post(`${baseUrl}/api/providers/${providerId}/test`, {
    data: {},
  })
  expect(providerTestResponse.status()).toBe(200)
  const providerTest = await providerTestResponse.json()
  expect(providerTest.ok).toBe(true)
  expect(providerTest.status).toBe(200)

  await page.getByRole('button', { name: '添加端点' }).first().click()
  await page.getByPlaceholder('如 custom-api').fill(endpointId)
  await page.getByPlaceholder('如 我的自定义 API').fill(endpointLabel)
  await page.getByPlaceholder('如 /custom/api').fill('/playwright/v1/chat/completions')
  await page.getByRole('button', { name: '创建' }).click()

  await expect(page.getByText('端点创建成功')).toBeVisible()
  await expect(page.getByRole('button', { name: endpointLabel })).toBeVisible()

  const createdEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(createdEndpoint.label).toBe(endpointLabel)
  expect(createdEndpoint.paths[0].path).toBe('/playwright/v1/chat/completions')

  await page.getByRole('button', { name: endpointLabel }).click()
  await expect(page.getByRole('heading', { name: `${endpointLabel} 路由配置`, level: 2 })).toBeVisible()

  await page.getByRole('button', { name: '新增映射' }).click()
  await page.getByLabel('route-source-1').fill(sourceModel)
  await page.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByRole('button', { name: new RegExp(`${providerId}.*stub-model-playwright`) }).dispatchEvent('mousedown')
  await page.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  let routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  await page.getByRole('button', { name: '路由模板 0' }).click()
  await page.getByPlaceholder('输入模板名称，例如 fox').fill(presetName)
  await page.getByRole('button', { name: '保存模板' }).click()
  await expect(page.getByText(`已保存模板 "${presetName}"。`)).toBeVisible()

  await page.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByRole('button', { name: new RegExp(`${providerId}.*透传原始模型`) }).dispatchEvent('mousedown')
  await page.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(updatedTargetModel)

  const presetsPanel = page.locator('div').filter({ hasText: '路由模板' }).first()
  await presetsPanel.getByRole('button', { name: '应用' }).click()
  const diffDialog = page.getByRole('dialog', { name: '应用模板确认' })
  await expect(diffDialog).toBeVisible()
  await diffDialog.getByRole('button', { name: '确认应用' }).click()
  await expect(page.getByText(`已应用模板 "${presetName}"。`)).toBeVisible()

  routedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(routedEndpoint.routing.modelRoutes[sourceModel]).toBe(targetModel)

  const endpointCard = page.locator('div').filter({
    has: page.getByRole('button', { name: endpointLabel }),
  }).filter({
    has: page.getByRole('button', { name: '编辑' }),
  }).first()
  await endpointCard.getByRole('button', { name: '编辑' }).click()
  const endpointDrawer = page.locator('div').filter({
    hasText: '编辑端点',
  }).filter({
    has: page.getByPlaceholder('如 我的自定义 API'),
  }).last()
  await endpointDrawer.getByPlaceholder('如 我的自定义 API').fill(updatedEndpointLabel)
  await endpointDrawer.getByRole('button', { name: '保存', exact: true }).click()
  await expect(page.getByText('端点更新成功')).toBeVisible()
  await expect(page.getByRole('button', { name: updatedEndpointLabel })).toBeVisible()

  const updatedEndpoint = await pollCustomEndpoint(request, baseUrl, endpointId)
  expect(updatedEndpoint.label).toBe(updatedEndpointLabel)

  const presetRow = page.locator('div').filter({ hasText: presetName }).filter({
    has: page.getByRole('button', { name: '应用' }),
  }).first()
  await expect(presetRow).toBeVisible()
  await presetRow.getByRole('button', { name: '删除' }).last().click()
  const deletePresetDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deletePresetDialog).toBeVisible()
  await deletePresetDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`模板 "${presetName}" 已删除。`)).toBeVisible()

  await page.getByRole('button', { name: /模型提供商/ }).click()
  const updatedProviderCard = page.locator(
    'xpath=//h3[normalize-space()="Playwright Provider Updated"]/ancestor::div[contains(@class,"surface-1")][1]'
  )
  await updatedProviderCard.getByRole('button', { name: '删除' }).click()
  const deleteProviderDialog = page.getByRole('dialog', { name: '删除' })
  await expect(deleteProviderDialog).toBeVisible()
  await deleteProviderDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除 Provider：Playwright Provider Updated`)).toBeVisible()

  const finalConfigResponse = await request.get(`${baseUrl}/api/config`)
  expect(finalConfigResponse.status()).toBe(200)
  const finalConfig = await finalConfigResponse.json()
  expect(finalConfig.providers.find((provider: any) => provider.id === providerId)).toBeFalsy()
})

test('model management supports provider edit, delete, route reset, and preset delete', async ({ page }) => {
  const baseUrl = harness.baseUrl()
  await page.goto(`${baseUrl}/ui/models`)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible()

  const providerId = `pm-edit-${Date.now()}`
  const providerBaseUrl = `http://127.0.0.1:${harness.stubPort}`
  await page.getByRole('button', { name: '新增提供商' }).click()
  const drawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await drawer.getByPlaceholder('如 openai').fill(providerId)
  await drawer.getByRole('button', { name: /OpenAI/ }).click()
  await drawer.getByPlaceholder('https://api.example.com/v1').fill(providerBaseUrl)
  await drawer.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
  await drawer.getByRole('button', { name: '新增模型' }).click()
  await drawer.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-edit')
  await drawer.getByRole('button', { name: '保存' }).click()

  const providerCard = page.locator(
    `xpath=//h3[normalize-space()="${providerId}"]/ancestor::div[contains(@class,"surface-1")][1]`
  )
  await providerCard.getByRole('button', { name: '编辑' }).click()
  const editDrawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
  await editDrawer.getByPlaceholder('如 官方主账号').fill(`${providerId}-edited`)
  await editDrawer.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText(`已更新 Provider：${providerId}-edited`)).toBeVisible()

  const editedProviderCard = page.locator(
    `xpath=//h3[normalize-space()="${providerId}-edited"]/ancestor::div[contains(@class,"surface-1")][1]`
  )
  await editedProviderCard.getByRole('button', { name: '测试连接' }).click()

  await page.getByRole('button', { name: '添加端点' }).first().click()
  const endpointId = `pm-edit-endpoint-${Date.now()}`
  await page.getByPlaceholder('如 custom-api').fill(endpointId)
  await page.getByPlaceholder('如 我的自定义 API').fill('Edit Endpoint')
  await page.getByPlaceholder('如 /custom/api').fill(`/playwright/${endpointId}`)
  await page.getByRole('button', { name: '创建' }).click()
  await expect(page.getByText('端点创建成功')).toBeVisible()

  await page.getByRole('button', { name: 'Edit Endpoint' }).click()
  await page.getByRole('button', { name: '新增映射' }).click()
  await page.getByLabel('route-source-1').fill('reset-source')
  await page.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
  await page.getByRole('button', { name: /stub-model-edit/ }).first().dispatchEvent('mousedown')
  await page.getByRole('button', { name: '保存路由' }).click()
  await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

  await page.getByRole('button', { name: new RegExp(`${providerId}.*stub-model-edit`) }).click()
  await page.getByRole('button', { name: new RegExp(`${providerId}.*透传原始模型`) }).dispatchEvent('mousedown')
  await page.getByRole('button', { name: '重置' }).click()
  await expect(page.getByRole('button', { name: new RegExp(`${providerId}.*stub-model-edit`) })).toBeVisible()

  await page.getByRole('button', { name: /路由模板/ }).click()
  await page.getByPlaceholder('输入模板名称，例如 fox').fill('preset-delete-test')
  await page.getByRole('button', { name: '保存模板' }).click()
  await expect(page.getByText('已保存模板 "preset-delete-test"。')).toBeVisible()
  const presetDeleteRow = page.locator('div').filter({ hasText: 'preset-delete-test' }).filter({
    has: page.getByRole('button', { name: '应用' }),
  }).first()
  await expect(presetDeleteRow).toBeVisible()
  await presetDeleteRow.getByRole('button', { name: '删除' }).last().click()
  const deleteDialog = page.getByRole('dialog', { name: '删除' }).first()
  await deleteDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText('模板 "preset-delete-test" 已删除。')).toBeVisible()

  await page.getByRole('button', { name: /模型提供商/ }).click()
  await editedProviderCard.getByRole('button', { name: '删除' }).click()
  const confirmDialog = page.getByRole('dialog', { name: '删除' })
  await confirmDialog.getByRole('button', { name: '删除' }).click()
  await expect(page.getByText(`已删除 Provider：${providerId}-edited`)).toBeVisible()
})
