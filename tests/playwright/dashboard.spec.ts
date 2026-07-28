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
    // Tolerate a transient non-200 (server still warming up) by retrying
    // instead of hard-failing — the loop's terminal throw still gates correctness.
    if (overviewResponse.status() !== 200) {
      await delay(250)
      continue
    }
    const overview = await overviewResponse.json()

    const logsResponse = await request.get(`${baseUrl}/api/logs?limit=10`)
    if (logsResponse.status() !== 200) {
      await delay(250)
      continue
    }
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
  // 'RPM' 同时出现在顶栏徽标「实时 N RPM」与状态带标签里——限定状态带避免歧义
  await expect(page.getByTestId('dashboard-spotlight-grid').getByText('RPM')).toBeVisible()
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

  // 趋势期洞察 4 卡：有数据时常驻；最高频模型 = stub-model（两条请求都打到它）
  const insights = page.getByTestId('dashboard-insights-grid')
  await expect(insights).toBeVisible()
  await expect(insights).toContainText('趋势期总请求')
  await expect(insights).toContainText('最忙的一天')
  await expect(insights).toContainText('最高频模型')
  await expect(insights).toContainText('最快 TTFT 模型')
  await expect(insights).toContainText('stub-model')

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

function overviewSection(
  requests: number,
  inputTokens: number,
  outputTokens: number,
  errorCount: number
) {
  return {
    requests,
    inputTokens,
    outputTokens,
    errorCount,
    cachedTokens: 0,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    avgLatencyMs: 0
  }
}

/**
 * Intercept /api/dashboard/summary and overlay a custom overview shape onto the
 * real payload, falling through untouched when the upstream isn't JSON (e.g. an
 * intermittent error page) so the mock never throws opaquely.
 */
async function mockOverview(page: import('@playwright/test').Page, overview: Record<string, unknown>) {
  await page.route('**/api/dashboard/summary**', async (route) => {
    let json: Record<string, unknown>
    try {
      const response = await route.fetch()
      const contentType = response.headers()['content-type'] ?? ''
      if (!contentType.toLowerCase().includes('application/json')) {
        await route.fulfill({ response })
        return
      }
      json = await response.json()
    } catch {
      // `route.fetch()` may already have consumed the response by the time json
      // parsing fails; `route.continue()` would then throw. Fulfill a stub 502
      // so the handler always settles cleanly.
      await route.fulfill({ status: 502, contentType: 'application/json', body: '{}' })
      return
    }
    json.overview = { ...(json.overview ?? {}), ...overview }
    // `yesterday: null` lets a test exercise the "no prior-day baseline" path by
    // stripping the key, so the frontend reads overview.yesterday as missing
    // regardless of what the real backend returned.
    if (overview.yesterday === null) {
      delete json.overview.yesterday
    }
    await route.fulfill({ json })
  })
}

test('dashboard today cards render delta pills vs yesterday', async ({ page }) => {
  const baseUrl = harness.baseUrl()
  // Inject a controlled today/yesterday pair so the delta chips have a non-zero
  // prior-day baseline — the harness seeds no yesterday data, so without this
  // the chips stay hidden. The rest of the payload passes through unchanged.
  await mockOverview(page, {
    today: overviewSection(110, 220, 110, 2),
    yesterday: overviewSection(100, 200, 100, 1)
  })

  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()

  const todayGrid = page.getByTestId('dashboard-today-grid')
  // requests 110 vs 100, input 220 vs 200, output 110 vs 100 → all +10.0%
  await expect(todayGrid).toContainText('+10.0%')
  // requests card carries the prior-day baseline hint
  await expect(todayGrid).toContainText('昨日同期 100')
})

test('dashboard today cards hide delta pills when there is no yesterday baseline', async ({ page }) => {
  const baseUrl = harness.baseUrl()
  // today has traffic but yesterday is explicitly stripped (fresh-install shape)
  // → relDelta returns undefined for every metric → no delta chips render.
  // Passing `yesterday: null` (rather than relying on the real backend) keeps
  // the test deterministic across the midnight boundary and decouples it from
  // data written by sibling tests sharing this harness.
  await mockOverview(page, {
    today: overviewSection(110, 220, 110, 0),
    yesterday: null
  })

  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()

  const todayGrid = page.getByTestId('dashboard-today-grid')
  // Prove the mock actually took effect (today=110 rendered). Without this the
  // test would pass vacuously if the route handler silently fell through.
  await expect(todayGrid).toContainText('110')
  // No prior-day baseline → no signed delta pills (e.g. "+10.0%") anywhere.
  // The error-rate value "0.0%" is unsigned, so it doesn't match.
  await expect(todayGrid).not.toContainText(/[+-]\d/)
})
