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
  await expect(page.getByText('活跃转发连接')).toBeVisible()
  await expect(page.getByText('RPM')).toBeVisible()
  // 无 warn/error 事件时「需要关注」整区收拢为一条全绿细条
  await expect(page.getByTestId('dashboard-all-clear')).toBeVisible()
  await expect(page.getByTestId('dashboard-all-clear')).toContainText('最近无异常事件')
  // 'stub' 也会出现在折叠的「性能详情」模型表里（隐藏），过滤可见元素
  await expect(page.getByText('stub').filter({ visible: true }).first()).toBeVisible()
  await expect(page.getByTestId('dashboard-runtime-strip')).toHaveCount(0)
  await expect(page.getByTestId('dashboard-overview-panel')).toBeVisible()
  await expect(page.getByTestId('dashboard-runtime-address')).toContainText('127.0.0.1:')
  await expect(page.getByTestId('dashboard-spotlight-grid')).toBeVisible()
  // 状态带 3 个指标 + 基础设施 Disclosure 内 4 个指标（折叠但仍挂载）
  await expect(page.locator('[data-testid^="dashboard-spotlight-value-"]')).toHaveCount(7)

  const endpointSelect = page.getByRole('combobox').first()
  // 仪表盘数据改走聚合接口 /api/dashboard/summary
  const filterResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/dashboard/summary')
      && url.searchParams.get('endpoint') === 'openai'
  })
  await endpointSelect.click()
  await page.getByRole('option', { name: 'openai' }).click()
  await filterResponse
  await expect(endpointSelect).toContainText('openai')

  await page.reload()
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await expect(endpointSelect).toContainText('openai')

  const refreshResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET'
      && url.pathname.endsWith('/api/dashboard/summary')
      && url.searchParams.get('endpoint') === 'openai'
  })
  await page.getByRole('button', { name: '刷新' }).click()
  await refreshResponse

  // Compact 按钮移入「系统资源」Disclosure，需先展开
  await page.locator('summary').filter({ hasText: '系统资源' }).click()
  await page.getByRole('button', { name: '释放数据库空间' }).click()
  await expect(page.getByText('数据库整理完成')).toBeVisible()
})
