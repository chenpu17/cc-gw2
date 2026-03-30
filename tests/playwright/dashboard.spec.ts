import { expect, test } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

const anthropicPayload = {
  model: 'stub-model',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Hello from dashboard anthropic test',
        },
      ],
    },
  ],
}

const openAiPayload = {
  model: 'stub-model',
  messages: [
    {
      role: 'user',
      content: 'Hello from dashboard openai test',
    },
  ],
}

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

async function pollForDashboardData(request: any, baseUrl: string) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const overviewResponse = await request.get(`${baseUrl}/api/stats/overview`)
    expect(overviewResponse.status()).toBe(200)
    const overview = await overviewResponse.json()

    const logsResponse = await request.get(`${baseUrl}/api/logs?limit=10`)
    expect(logsResponse.status()).toBe(200)
    const logs = await logsResponse.json()
    const endpoints = new Set((logs.items ?? []).map((item: any) => item.endpoint))

    if ((overview.today?.requests ?? 0) >= 2 && endpoints.has('anthropic') && endpoints.has('openai')) {
      return
    }

    await delay(250)
  }

  throw new Error('dashboard data did not become ready in time')
}

test('dashboard supports refresh, endpoint filters, compaction, and recent request visibility', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  const anthropicResponse = await request.post(`${baseUrl}/v1/messages`, {
    data: anthropicPayload,
    headers: {
      'content-type': 'application/json',
    },
  })
  expect(anthropicResponse.status()).toBe(200)

  const openAiResponse = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: openAiPayload,
    headers: {
      'content-type': 'application/json',
    },
  })
  expect(openAiResponse.status()).toBe(200)

  await pollForDashboardData(request, baseUrl)

  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await expect(page.getByText('最新请求')).toBeVisible()
  await expect(page.getByText('今日请求数')).toBeVisible()
  await expect(page.getByText('RPM')).toBeVisible()
  await expect(page.getByText('TPM')).toBeVisible()
  await expect(page.getByText('stub').first()).toBeVisible()

  const endpointSelect = page.getByRole('combobox').first()
  const filterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/stats/overview')
      && url.searchParams.get('endpoint') === 'openai'
  })
  await endpointSelect.click()
  await page.getByRole('option', { name: 'openai' }).click()
  await filterResponse
  await expect(endpointSelect).toContainText('openai')
  await expect(page.getByText('端点筛选 · openai')).toBeVisible()

  await page.reload()
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await expect(endpointSelect).toContainText('openai')

  const refreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/stats/overview')
      && url.searchParams.get('endpoint') === 'openai'
  })
  await page.getByRole('button', { name: '刷新' }).click()
  await refreshResponse

  await page.getByRole('button', { name: '释放数据库空间' }).click()
  await expect(page.getByText('数据库整理完成')).toBeVisible()
})
