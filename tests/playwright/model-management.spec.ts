import { expect, test } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

test('web ui can create a provider, test connectivity, and add a custom endpoint', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const providerId = 'playwright-provider'
  const endpointId = 'playwright-endpoint'
  const endpointLabel = 'Playwright Endpoint'
  const providerBaseUrl = `http://127.0.0.1:${harness.stubPort}`

  await page.goto(`${baseUrl}/ui/models`)
  await expect(page.getByRole('heading', { name: '模型与路由管理', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '新增提供商' }).click()

  const providerDrawer = page.locator('aside').filter({ hasText: '新增 Provider' })
  await expect(providerDrawer).toBeVisible()
  await providerDrawer.getByPlaceholder('如 openai').fill(providerId)
  await providerDrawer.locator('select').selectOption('openai')
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
    `xpath=//h3[normalize-space()="${providerId}"]/ancestor::div[contains(@class,"flex-col")][1]`
  )
  await expect(providerCard.getByRole('button', { name: '测试连接' })).toBeVisible()

  const providerTestResponse = await request.post(`${baseUrl}/api/providers/${providerId}/test`, {
    data: {},
  })
  expect(providerTestResponse.status()).toBe(200)
  const providerTest = await providerTestResponse.json()
  expect(providerTest.ok).toBe(true)
  expect(providerTest.status).toBe(200)

  await page.getByRole('button', { name: '添加端点' }).click()
  await page.getByPlaceholder('如 custom-api').fill(endpointId)
  await page.getByPlaceholder('如 我的自定义 API').fill(endpointLabel)
  await page.getByPlaceholder('如 /custom/api').fill('/playwright/v1/chat/completions')
  await page.getByRole('button', { name: '创建' }).click()

  await expect(page.getByText('端点创建成功')).toBeVisible()
  await expect(page.getByRole('button', { name: endpointLabel })).toBeVisible()

  const endpointsResponse = await request.get(`${baseUrl}/api/custom-endpoints`)
  expect(endpointsResponse.status()).toBe(200)
  const endpoints = await endpointsResponse.json()
  const createdEndpoint = endpoints.endpoints.find((endpoint: any) => endpoint.id === endpointId)
  expect(createdEndpoint).toBeTruthy()
  expect(createdEndpoint.label).toBe(endpointLabel)
  expect(createdEndpoint.paths[0].path).toBe('/playwright/v1/chat/completions')
})
