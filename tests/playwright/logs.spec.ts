import { expect, test } from '@playwright/test'
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
  await expect(page.locator('label').filter({ hasText: '缓存读取' })).toBeVisible()
  await expect(page.locator('label').filter({ hasText: 'TTFT(ms)' })).toBeVisible()
  await page.locator('label').filter({ hasText: '缓存读取' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('thead').getByText('缓存读取')).not.toBeVisible()

  await page.getByRole('button', { name: '展开筛选' }).click()
  await page.getByRole('button', { name: '仅看失败' }).click()
  await expect(page.getByText('状态: 失败')).toBeVisible()
  await page.getByRole('button', { name: '全部流量' }).click()
  await page.getByPlaceholder('如 deepseek-chat').fill('stub-model')
  await expect(page.getByText('stub-model').first()).toBeVisible()

  await page.getByRole('combobox').last().click()
  await page.getByRole('option', { name: '50' }).click()
  await page.reload()
  await expect(page.getByRole('combobox').last()).toContainText('50')
  await expect(page.locator('thead').getByText('缓存读取')).not.toBeVisible()

  const detailButton = page.getByRole('button', { name: '详情' }).first()
  await expect(detailButton).toBeVisible()
  await detailButton.click()

  const detailDialog = page.getByRole('dialog', { name: '日志详情' })
  await expect(detailDialog).toBeVisible()
  await expect(detailDialog.getByText('客户端请求体')).toBeVisible()
  await expect(detailDialog.getByText('客户端响应体')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(detailDialog).not.toBeVisible()

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: /导出(?: ZIP)? 日志/ }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/cc-gw-logs-.*\.zip$/)
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
  await columnPanel.getByRole('checkbox', { name: '缓存读取' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('th').filter({ hasText: '缓存读取' }).first()).toHaveCount(0)

  await page.getByRole('button', { name: '列设置' }).click()
  await columnPanel.getByRole('button', { name: '重置' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('th').filter({ hasText: '缓存读取' }).first()).toBeVisible()

  const paginationResponse = page.waitForResponse((response) => {
    const url = new URL(response.url())
    return response.request().method() === 'GET' && url.pathname.endsWith('/logs') && url.searchParams.get('limit') === '50'
  })
  const perPageCombobox = page.getByRole('combobox').nth(0)
  await perPageCombobox.click()
  await page.getByRole('option', { name: '50' }).click()
  await paginationResponse

  await page.getByRole('button', { name: '展开筛选' }).click()
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
