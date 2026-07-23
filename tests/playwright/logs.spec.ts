import { expect, test } from '@playwright/test'
import fs from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

const messagePayload = {
  model: 'stub-model',
  messages: [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: 'Hello from Playwright logs test',
        },
      ],
    },
  ],
}

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

async function pollForAnyLog(request: any, baseUrl: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${baseUrl}/api/logs?limit=10`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    const item = body.items?.[0]
    if (item) {
      return item
    }
    await delay(250)
  }

  throw new Error('log entry not found in time')
}

test('logs web ui supports filters, columns, detail modal and export', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })

  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
    },
  })
  expect(valid.status()).toBe(200)

  await pollForAnyLog(request, baseUrl)

  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.getByTestId('logs-filters-card')).toHaveCSS('position', 'static')
  await expect(page.getByRole('button', { name: '列设置' })).toBeVisible()

  await page.getByRole('button', { name: '列设置' }).click()
  await expect(page.locator('label').filter({ hasText: 'Tokens' })).toBeVisible()
  await expect(page.locator('label').filter({ hasText: '耗时' })).toBeVisible()
  await page.locator('label').filter({ hasText: 'Tokens' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('thead').getByText('Tokens')).not.toBeVisible()

  // 筛选面板默认展开，无需手动展开
  await page.getByRole('button', { name: '仅看失败' }).click()
  await expect(page.getByText('状态: 失败')).toBeVisible()
  await page.getByRole('button', { name: '全部流量' }).click()
  await page.getByPlaceholder('如 deepseek-chat').fill('stub-model')
  await expect(page.getByText('stub-model').first()).toBeVisible()

  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: '50' }).click()
  await page.reload()
  await expect(page.getByRole('combobox').last()).toContainText('50')
  await expect(page.locator('thead').getByText('Tokens')).not.toBeVisible()

  const detailButton = page.getByRole('button', { name: '详情' }).first()
  await expect(detailButton).toBeVisible()
  await detailButton.click()

  const detailDialog = page.getByRole('dialog', { name: '日志详情' })
  await expect(detailDialog).toBeVisible()
  await expect(detailDialog.getByRole('tab', { name: '客户端请求体' })).toBeVisible()
  await expect(detailDialog.getByRole('tab', { name: '客户端响应体' })).toBeVisible()
  await detailDialog.getByTestId('log-payload-client-request').getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('请求体已复制到剪贴板。')).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Hello from Playwright logs test')
  // payload 区改为 Tabs，仅挂载激活 tab，需先切换到「客户端响应体」
  await detailDialog.getByRole('tab', { name: '客户端响应体' }).click()
  await detailDialog.getByTestId('log-payload-client-response').getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('响应体已复制到剪贴板。')).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('Stub response:')
  await page.keyboard.press('Escape')
  await expect(detailDialog).not.toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出(?: ZIP)? 日志/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/cc-gw-logs-.*\.zip$/)
})

test('log detail response payload copy and download preserve large full content', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseUrl })

  const marker = 'large-log-response-marker'
  const largeContent = `${marker}:${'x'.repeat(180_000)}`
  const valid = await request.post(`${baseUrl}/v1/chat/completions`, {
    data: {
      model: 'stub-model',
      messages: [{ role: 'user', content: largeContent }]
    },
    headers: { 'content-type': 'application/json' }
  })
  expect(valid.status()).toBe(200)

  await pollForAnyLog(request, baseUrl)

  await page.goto(`${baseUrl}/ui/logs`)
  await page.getByRole('button', { name: '详情' }).first().click()

  const detailDialog = page.getByRole('dialog', { name: '日志详情' })
  // payload 区改为 Tabs，先切到「客户端响应体」
  await detailDialog.getByRole('tab', { name: '客户端响应体' }).click()
  const responsePanel = detailDialog.getByTestId('log-payload-client-response')
  await expect(responsePanel.getByText(/仅显示前/)).toBeVisible()

  await responsePanel.getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('响应体已复制到剪贴板。')).toBeVisible()
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain(marker)
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toContain('x'.repeat(1000))

  const downloadPromise = page.waitForEvent('download')
  await responsePanel.getByRole('button', { name: '下载' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/cc-gw-log-.*客户端响应体.*\.json$/)
  const downloadPath = await download.path()
  expect(downloadPath).toBeTruthy()
  const downloadedText = await fs.readFile(downloadPath!, 'utf8')
  expect(downloadedText).toContain(marker)
  expect(downloadedText.length).toBeGreaterThan(180_000)
})

test('logs table controls respect column toggles, pagination, and export payloads', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: { 'content-type': 'application/json' }
  })
  expect(valid.status()).toBe(200)

  await pollForAnyLog(request, baseUrl)

  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.getByTestId('logs-filters-card')).toHaveCSS('position', 'static')

  await page.getByRole('button', { name: '列设置' }).click()
  const columnPanel = page.getByRole('dialog').filter({ hasText: '列设置' }).first()
  await columnPanel.getByRole('checkbox', { name: 'Tokens' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('th').filter({ hasText: 'Tokens' }).first()).toHaveCount(0)

  await page.getByRole('button', { name: '列设置' }).click()
  await columnPanel.getByRole('button', { name: '重置' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('th').filter({ hasText: 'Tokens' }).first()).toBeVisible()

  const paginationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname.endsWith('/logs') && url.searchParams.get('limit') === '50'
  })
  // 筛选默认展开后第一个 combobox 是 provider 筛选，每页条数选择器在最后
  const perPageCombobox = page.getByRole('combobox').last()
  await perPageCombobox.click()
  await page.getByRole('option', { name: '50' }).click()
  await paginationResponse

  await page.getByPlaceholder('如 deepseek-chat').fill('stub-model')
  const exportResponse = page.waitForResponse((response) => response.url().endsWith('/logs/export') && response.request().method() === 'POST')
  await page.getByRole('button', { name: /导出(?: ZIP)? 日志/ }).click()
  const loggedExport = await exportResponse
  const exportPayload = loggedExport.request().postDataJSON()
  expect(exportPayload?.model).toBe('stub-model')
})

test('logs table assigns the same color marker to rows from the same session', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const requests = [
    { user: 'session-color-a', content: 'first session row' },
    { user: 'session-color-b', content: 'second session row' },
    { user: 'session-color-a', content: 'third session row' },
  ]

  for (const entry of requests) {
    const response = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
      data: {
        model: 'stub-model',
        user: entry.user,
        messages: [{ role: 'user', content: entry.content }]
      },
      headers: {
        'content-type': 'application/json'
      }
    })
    expect(response.status()).toBe(200)
  }

  await pollForAnyLog(request, baseUrl)

  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()

  const sessionARows = page.locator('tbody tr[data-session-id="session-color-a"]')
  const sessionBRows = page.locator('tbody tr[data-session-id="session-color-b"]')
  await expect(sessionARows).toHaveCount(2)
  await expect(sessionBRows).toHaveCount(1)

  const sessionAColor = await sessionARows.first().getAttribute('data-session-color')
  expect(sessionAColor).toBeTruthy()
  await expect(sessionARows.nth(1)).toHaveAttribute('data-session-color', sessionAColor ?? '')

  const sessionBColor = await sessionBRows.first().getAttribute('data-session-color')
  expect(sessionBColor).toBeTruthy()
  expect(sessionBColor).not.toBe(sessionAColor)
})
