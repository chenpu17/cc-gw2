import { expect, test } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

// /v1/messages through the stub is cross-protocol converted to OpenAI
// chat/completions, whose fixed non-stream usage { prompt 12, completion 4 }
// is what the gateway logs — the baseline every hand-computed cost below
// derives from.
const messagePayload = {
  model: 'stub-model',
  messages: [
    {
      role: 'user',
      content: [{ type: 'text', text: 'Hello from billing test' }],
    },
  ],
}

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

/** POST one request and poll until its log row appears, returning the fresh
 * item (with cost fields already attached). Tolerates earlier rows from
 * sibling tests sharing this worker, and a fresh DB if the worker restarted
 * after a failure. */
async function seedTrackedRequest(request: any, baseUrl: string) {
  const before = await (await request.get(`${baseUrl}/api/logs?limit=50`)).json()
  const knownIds = new Set((before.items ?? []).map((item: any) => item.id))
  const response = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: { 'content-type': 'application/json' },
  })
  expect(response.status()).toBe(200)
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const body = await (await request.get(`${baseUrl}/api/logs?limit=50`)).json()
    const fresh = (body.items ?? []).find((item: any) => !knownIds.has(item.id))
    if (fresh) {
      return { item: fresh, body }
    }
    await delay(250)
  }
  throw new Error('seeded log entry not found in time')
}

/** Round-trip PUT /api/config with a new `billing` block, mirroring the
 * settings page payload (webAuth + legacy logging keys stripped). */
async function putBillingConfig(request: any, baseUrl: string, billing: Record<string, unknown>) {
  const infoResponse = await request.get(`${baseUrl}/api/config/info`)
  expect(infoResponse.status()).toBe(200)
  const info = await infoResponse.json()
  const payload = { ...info.config, billing } as Record<string, unknown>
  delete payload.webAuth
  delete payload.requestLogging
  delete payload.responseLogging
  const saveResponse = await request.put(`${baseUrl}/api/config`, { data: payload })
  expect(saveResponse.status()).toBe(200)
}

/** Mirror formatCost's display for the cost asserts: 2-decimal rounding with
 * trailing zeros dropped (min fraction digits is 0 in the web util). */
function costText(value: number): string {
  return `¥${value.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')}`
}

// USD override with hand-friendly numbers (all within the config validator's
// ≤1e6-per-1M-tokens bound): 12 in × $1M/M = $12, 4 out × $137.5k/M = $0.55
// → $12.55 per request. At rate 7.2 → ¥86.4 + ¥3.96 = ¥90.36; at rate 3.6
// → ¥43.2 + ¥1.98 = ¥45.18.
const USD_OVERRIDE = {
  currency: 'USD',
  input: 1_000_000,
  output: 137_500,
  cacheRead: 0,
  cacheCreation: 0,
}
const PER_REQUEST_CNY_AT_72 = 90.36
const PER_REQUEST_CNY_AT_36 = 45.18

test('billing reports null costs and unpriced counters when no price matches', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  const { item, body } = await seedTrackedRequest(request, baseUrl)
  expect(item.cost).toBeNull()
  expect(item.cost_breakdown).toBeNull()
  expect(body.cost_currency).toBe('CNY')

  const overviewResponse = await request.get(`${baseUrl}/api/stats/overview`)
  expect(overviewResponse.status()).toBe(200)
  const overview = await overviewResponse.json()
  expect(overview.costCurrency).toBe('CNY')
  expect(overview.today.cost).toBeNull()
  expect(overview.today.unpricedRequests).toBeGreaterThanOrEqual(1)

  // Prices endpoint: builtin table present, stub-model absent (unpriced).
  const pricesResponse = await request.get(`${baseUrl}/api/billing/prices`)
  expect(pricesResponse.status()).toBe(200)
  const prices = await pricesResponse.json()
  expect(prices.displayCurrency).toBe('CNY')
  const builtin = prices.entries.filter((entry: any) => entry.source === 'builtin')
  expect(builtin.length).toBeGreaterThan(20)
  expect(builtin.some((entry: any) => entry.key === 'claude-opus-4-5')).toBe(true)
  expect(prices.entries.some((entry: any) => entry.key === 'stub-model')).toBe(false)

  // Dashboard: cost card renders the em dash plus the unpriced hint.
  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await expect(page.getByTestId('dashboard-today-value-cost')).toHaveText('—')
  await expect(page.getByTestId('dashboard-today-grid')).toContainText('条请求未计价')

  // Logs: cost column and detail breakdown render all dashes.
  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.locator('[data-testid^="log-cost-"]').first()).toHaveText('—')
  await page.getByRole('button', { name: '详情' }).first().click()
  const detailDialog = page.getByRole('dialog', { name: '日志详情' })
  await expect(detailDialog).toBeVisible()
  await expect(detailDialog.getByTestId('log-cost-breakdown')).toContainText('—')
  await expect(detailDialog).toContainText('未匹配到价格')
})

test('billing override prices flow into logs, stats and dashboard', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await putBillingConfig(request, baseUrl, {
    displayCurrency: 'CNY',
    rates: { USD: 7.2 },
    modelPrices: { 'stub-model': USD_OVERRIDE },
  })

  // Query-time semantics: every logged request (this one and any from sibling
  // tests sharing the worker) is priced retroactively and identically.
  const { item } = await seedTrackedRequest(request, baseUrl)
  expect(item.cost).toBeCloseTo(PER_REQUEST_CNY_AT_72, 6)
  expect(item.cost_breakdown.input).toBeCloseTo(86.4, 6)
  expect(item.cost_breakdown.output).toBeCloseTo(3.96, 6)
  expect(item.cost_breakdown.total).toBeCloseTo(PER_REQUEST_CNY_AT_72, 6)

  const overviewResponse = await request.get(`${baseUrl}/api/stats/overview`)
  const overview = await overviewResponse.json()
  expect(overview.today.unpricedRequests).toBe(0)
  expect(overview.today.cost).toBeCloseTo(PER_REQUEST_CNY_AT_72 * overview.today.requests, 4)
  const expectedTodayCostText = costText(PER_REQUEST_CNY_AT_72 * overview.today.requests)

  // Dimension stats carry the same fold.
  const providersResponse = await request.get(`${baseUrl}/api/stats/providers`)
  const providers = await providersResponse.json()
  const stubRow = providers.find((row: any) => row.key === 'stub')
  expect(stubRow?.cost).toBeCloseTo(PER_REQUEST_CNY_AT_72 * overview.today.requests, 4)
  expect(stubRow?.unpricedRequests).toBe(0)

  // The override surfaces in the merged price table.
  const pricesResponse = await request.get(`${baseUrl}/api/billing/prices`)
  const prices = await pricesResponse.json()
  const overrideEntry = prices.entries.find((entry: any) => entry.key === 'stub-model')
  expect(overrideEntry?.source).toBe('override')
  expect(overrideEntry?.input).toBe(1_000_000)

  // Dashboard: cost card value, usage cost column, cost trend mode.
  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByTestId('dashboard-today-value-cost')).toContainText(expectedTodayCostText)
  await expect(page.getByTestId('dashboard-today-grid')).not.toContainText('条请求未计价')
  const usageRow = page.getByTestId('dashboard-usage-row').filter({ hasText: 'stub' })
  await expect(usageRow.getByTestId('dashboard-usage-cost')).toContainText(expectedTodayCostText)
  await expect(usageRow.getByTestId('dashboard-usage-cost')).not.toContainText('*')

  const trendMode = page.getByRole('group', { name: '趋势模式' })
  await expect(trendMode.getByRole('button', { name: '流量' })).toHaveAttribute('aria-pressed', 'true')
  await trendMode.getByRole('button', { name: '成本' }).click()
  await expect(trendMode.getByRole('button', { name: '成本' })).toHaveAttribute('aria-pressed', 'true')
  // Cost mode still renders the chart canvas (switching must not blank it).
  await expect(page.locator('canvas').first()).toBeVisible()

  // Logs: row cost + detail breakdown in display currency.
  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.locator('[data-testid^="log-cost-"]').first()).toContainText(/¥90\.36/)
  await page.getByRole('button', { name: '详情' }).first().click()
  const detailDialog = page.getByRole('dialog', { name: '日志详情' })
  const breakdown = detailDialog.getByTestId('log-cost-breakdown')
  await expect(breakdown).toContainText(/¥86\.4/)
  await expect(breakdown).toContainText(/¥3\.96/)
})

test('billing rate change re-prices history and override removal restores nulls', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await putBillingConfig(request, baseUrl, {
    displayCurrency: 'CNY',
    rates: { USD: 3.6 },
    modelPrices: { 'stub-model': USD_OVERRIDE },
  })
  const { item } = await seedTrackedRequest(request, baseUrl)
  expect(item.cost).toBeCloseTo(PER_REQUEST_CNY_AT_36, 6)

  const overviewResponse = await request.get(`${baseUrl}/api/stats/overview`)
  const overview = await overviewResponse.json()
  const expectedText = costText(PER_REQUEST_CNY_AT_36 * overview.today.requests)
  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByTestId('dashboard-today-value-cost')).toContainText(expectedText)

  // Dropping the override re-prices the same history back to unpriced/null —
  // costs are computed at query time, never persisted.
  await putBillingConfig(request, baseUrl, { displayCurrency: 'CNY' })
  const logsResponse = await request.get(`${baseUrl}/api/logs?limit=10`)
  const logs = await logsResponse.json()
  expect(logs.items[0].cost).toBeNull()

  const freshOverviewResponse = await request.get(`${baseUrl}/api/stats/overview`)
  const freshOverview = await freshOverviewResponse.json()
  expect(freshOverview.today.cost).toBeNull()
  expect(freshOverview.today.unpricedRequests).toBeGreaterThanOrEqual(1)

  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByTestId('dashboard-today-value-cost')).toHaveText('—')
})

test('settings billing section edits overrides through the UI and saves', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  await page.goto(`${baseUrl}/ui/settings`)
  const billingSection = page.locator('#section-billing')
  await expect(billingSection).toBeVisible()
  await expect(billingSection).toContainText('展示货币')
  await expect(billingSection).toContainText('1 USD = ___ CNY')

  // Read-only builtin table inside the collapsed Disclosure.
  await billingSection.getByText('内置价格表', { exact: true }).click()
  await expect(billingSection.getByText('claude-opus-4-5')).toBeVisible()

  // Fill the blank override row: ¥1M/M in + ¥137.5k/M out → per request
  // (12 in, 4 out) ¥12 + ¥0.55 = ¥12.55.
  const row = billingSection.getByTestId('billing-override-row-0')
  await row.locator('input').first().fill('stub-model')
  const priceInputs = row.locator('input[type="number"]')
  await priceInputs.nth(0).fill('1000000')
  await priceInputs.nth(1).fill('137500')

  await expect(page.getByText('待保存 1 项').first()).toBeVisible()
  await page.getByRole('button', { name: '保存设置' }).first().click()
  await expect(page.getByText(/系统配置已更新|配置已保存/)).toBeVisible()

  const pricesResponse = await request.get(`${baseUrl}/api/billing/prices`)
  const prices = await pricesResponse.json()
  const overrideEntry = prices.entries.find((entry: any) => entry.key === 'stub-model')
  expect(overrideEntry?.source).toBe('override')
  expect(overrideEntry?.currency).toBe('CNY')
  expect(overrideEntry?.input).toBe(1_000_000)

  // Seed post-save traffic so the dashboard has something to price (a fresh
  // worker after an earlier failure starts with an empty database).
  await seedTrackedRequest(request, baseUrl)
  const overviewResponse = await request.get(`${baseUrl}/api/stats/overview`)
  const overview = await overviewResponse.json()
  await page.goto(`${baseUrl}/ui/`)
  await expect(page.getByTestId('dashboard-today-value-cost')).toContainText(
    costText(12.55 * overview.today.requests)
  )
})

test('currency switch re-prices the api-key usage table without a reload', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await putBillingConfig(request, baseUrl, {
    displayCurrency: 'CNY',
    rates: { USD: 7.2 },
    modelPrices: { 'stub-model': USD_OVERRIDE },
  })
  await seedTrackedRequest(request, baseUrl)

  // Load the dashboard in CNY and open the API Key dimension so the
  // api-keys usage query gets cached warm.
  await page.goto(`${baseUrl}/ui/`)
  const usageResponse = page.waitForResponse((response) =>
    response.request().method() === 'GET'
    && new URL(response.url()).pathname.endsWith('/api/stats/api-keys/usage'))
  await page.getByTestId('dashboard-usage-tab-apiKeys').click()
  await usageResponse
  await expect(page.getByTestId('dashboard-usage-row')).toHaveCount(1)
  await expect(page.getByTestId('dashboard-usage-row').first()
    .getByTestId('dashboard-usage-cost')).toContainText('¥')

  // Switch the display currency through the settings page (SPA navigation).
  await page.getByRole('link', { name: '设置', exact: true }).click()
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible()
  await page.getByRole('combobox', { name: '展示货币' }).click()
  await page.getByRole('option', { name: 'USD（$）' }).click()
  await page.getByRole('button', { name: '保存设置' }).first().click()
  await expect(page.getByText(/系统配置已更新|配置已保存/)).toBeVisible()

  // Back via the sidebar — a pure SPA move, no page reload: the dashboard
  // remounts against warm caches. The api-keys usage cache lives in its own
  // ['api-keys'] namespace and must have been invalidated with the rest,
  // otherwise the row keeps its CNY amount under the new currency symbol.
  await page.getByRole('link', { name: '仪表盘', exact: true }).click()
  await expect(page.getByTestId('dashboard-today-value-cost')).toContainText('$')
  const keyRowCost = page.getByTestId('dashboard-usage-row').first()
    .getByTestId('dashboard-usage-cost')
  await expect(keyRowCost).toContainText('$')
  await expect(keyRowCost).not.toContainText('¥')

  // The DOM amount (not just the symbol — the old bug kept ¥90.36×n under a
  // $-symbol overview) must match the API's post-switch value ($12.55/request).
  // Mirrors formatCost for USD at this magnitude: 2 decimals, trailing zeros
  // dropped, thousands separators.
  const usageApi = await (await request.get(`${baseUrl}/api/stats/api-keys/usage`)).json()
  expect(usageApi[0].cost).toBeCloseTo(12.55 * usageApi[0].requests, 4)
  const usdAmount = usageApi[0].cost
    .toFixed(2)
    .replace(/0+$/, '')
    .replace(/\.$/, '')
    .replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  await expect(keyRowCost).toContainText(`$${usdAmount}`)
})

test('scoped colon-suffixed override key round-trips and never blocks settings save', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  // 后端合法键：providerId=mock，modelId=anthropic/claude-3-7-sonnet:beta
  //（modelId 本身可含冒号；首个冒号分隔）。前端曾按冒号总数判非法，
  // 回读后不编辑它也阻断整页保存。
  const scopedKey = 'mock:anthropic/claude-3-7-sonnet:beta'
  await putBillingConfig(request, baseUrl, {
    displayCurrency: 'CNY',
    modelPrices: {
      [scopedKey]: { currency: 'CNY', input: 1_000_000, output: 137_500, cacheRead: 0, cacheCreation: 0 },
    },
  })

  await page.goto(`${baseUrl}/ui/settings`)
  const billingSection = page.locator('#section-billing')
  await expect(billingSection).toBeVisible()
  const keyInput = billingSection.getByTestId('billing-override-row-0').locator('input').first()
  await expect(keyInput).toHaveValue(scopedKey)

  // 只改无关设置（日志保留天数），保存必须放行。basics 分区第 2 个数字
  // 输入即保留天数（第 1 个是端口；Label 无 htmlFor，不能按可访问名定位）。
  await page.locator('#section-basics').locator('input[type="number"]').nth(1).fill('31')
  await page.getByRole('button', { name: '保存设置' }).first().click()
  await expect(page.getByText(/系统配置已更新|配置已保存/)).toBeVisible()

  const config = await (await request.get(`${baseUrl}/api/config`)).json()
  expect(config.logRetentionDays).toBe(31)
  expect(config.billing.modelPrices[scopedKey]).toBeTruthy()

  // 覆盖经 prices 端点透出，scoped provider 按首个冒号拆出
  const prices = await (await request.get(`${baseUrl}/api/billing/prices`)).json()
  const entry = prices.entries.find((item: any) => item.key === scopedKey)
  expect(entry?.source).toBe('override')
  expect(entry?.scopedProvider).toBe('mock')
})
