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

  // v0.16 成本列：列偏好 v3 迁移后默认可见
  await expect(page.locator('thead').getByText('成本')).toBeVisible()

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

test('logs deep links seed status and client filters then clear the query string', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: { 'content-type': 'application/json' }
  })
  expect(valid.status()).toBe(200)
  await pollForAnyLog(request, baseUrl)

  // 仪表盘错误率卡片 / 客户端卡片下钻都走这条路径：URL 只负责播种，
  // 之后由持久化过滤器接管，地址栏不残留参数。
  await page.goto(`${baseUrl}/ui/logs?status=error&clientKind=anthropic-compatible`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.getByText('状态: 失败')).toBeVisible()
  await expect(page.getByText('客户端: Anthropic 兼容客户端')).toBeVisible()
  await expect(page).toHaveURL(/\/ui\/logs$/)

  // 深链播种的是持久化状态，刷新后仍然生效
  await page.reload()
  await expect(page.getByText('状态: 失败')).toBeVisible()
  await expect(page.getByText('客户端: Anthropic 兼容客户端')).toBeVisible()
})

test('payload copy falls back to execCommand inside the detail dialog', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: { 'content-type': 'application/json' }
  })
  expect(valid.status()).toBe(200)
  await pollForAnyLog(request, baseUrl)

  // 非安全上下文 + Radix 焦点陷阱：降级用的隐藏 textarea 必须挂在对话框内部，
  // 否则焦点被抢回，execCommand 复制到的是空内容。
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: undefined, configurable: true })
    ;(window as unknown as { __ccGwCopied: string | null }).__ccGwCopied = null
    const original = document.execCommand.bind(document)
    document.execCommand = (command: string) => {
      if (command === 'copy') {
        const active = document.activeElement as HTMLTextAreaElement | null
        ;(window as unknown as { __ccGwCopied: string | null }).__ccGwCopied = active?.value ?? null
        return true
      }
      return original(command)
    }
  })

  await page.goto(`${baseUrl}/ui/logs`)
  await page.getByRole('button', { name: '详情' }).first().click()
  const dialog = page.getByRole('dialog', { name: '日志详情' })
  await expect(dialog).toBeVisible()

  await dialog.getByTestId('log-payload-client-request').getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('请求体已复制到剪贴板。')).toBeVisible()
  const copied = await page.evaluate(
    () => (window as unknown as { __ccGwCopied: string | null }).__ccGwCopied
  )
  expect(copied ?? '').toContain('Hello from Playwright logs test')
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

  // 「客户端」列：默认可见（识别出的 client_kind，无则 '—'），可隐藏
  await expect(page.locator('th').filter({ hasText: '客户端' }).first()).toBeVisible()
  await page.getByRole('button', { name: '列设置' }).click()
  await columnPanel.getByRole('checkbox', { name: '客户端' }).click()
  await page.keyboard.press('Escape')
  await expect(page.locator('th').filter({ hasText: '客户端' }).first()).toHaveCount(0)

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

test('logs table auto-hides low-priority columns as the content area narrows', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: { 'content-type': 'application/json' }
  })
  expect(valid.status()).toBe(200)
  await pollForAnyLog(request, baseUrl)

  // 1000px viewport → content column ≈910px, below the 920px step.
  await page.setViewportSize({ width: 1000, height: 900 })
  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()

  await expect(page.getByText(/窄屏已隐藏 \d+ 列/)).toBeVisible()
  for (const label of ['错误信息', '客户端', '密钥', '请求模型', '路由模型']) {
    await expect(page.locator('th').filter({ hasText: label }).first()).toHaveCount(0)
  }
  for (const label of ['Tokens', '成本', '耗时', '状态']) {
    await expect(page.locator('th').filter({ hasText: label }).first()).toBeVisible()
  }

  // Header and body cell counts must stay in lockstep after columns drop.
  const headerCells = await page.locator('thead tr th').count()
  const firstRowCells = await page.locator('tbody tr[data-log-id]').first().locator('td').count()
  expect(firstRowCells).toBe(headerCells)

  // Just above the md breakpoint the sidebar is collapsed and the desktop
  // table is still rendered (~770px container). It must keep hiding columns
  // instead of treating that container width as "mobile".
  await page.setViewportSize({ width: 860, height: 900 })
  await expect(page.getByText(/窄屏已隐藏 5 列/)).toBeVisible()

  // Widening restores the full set (canonical 1440 desktop) and the table fits
  // the content column without horizontal scrolling.
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(page.getByText(/窄屏已隐藏 \d+ 列/)).toHaveCount(0)
  for (const label of ['错误信息', '客户端', '密钥', '请求模型', '路由模型']) {
    await expect(page.locator('th').filter({ hasText: label }).first()).toBeVisible()
  }
  const zhWidths = await page.evaluate(() => {
    const table = document.querySelector('table')
    return table ? { scroll: table.scrollWidth, client: table.parentElement?.clientWidth ?? 0 } : null
  })
  expect(zhWidths).not.toBeNull()
  expect(zhWidths!.scroll).toBeLessThanOrEqual(zhWidths!.client + 1)

  // English headers/values are wider than Chinese, so the same width that fits
  // all 13 zh columns needs an auto-hidden column in en. The exact count is
  // content-dependent (it grows as more columns are needed), so assert the
  // en-localized badge and the structural outcome instead of a fixed number.
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.evaluate(() => window.localStorage.setItem('cc-gw-language', 'en'))
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Request Logs', level: 1 })).toBeVisible()
  const hiddenBadge = page.getByText(/^\d+ columns? hidden$/)
  await expect(hiddenBadge).toBeVisible()
  await expect(page.locator('th').filter({ hasText: 'Error' })).toHaveCount(0)
  const enWidths = await page.evaluate(() => {
    const table = document.querySelector('table')
    return table ? { scroll: table.scrollWidth, client: table.parentElement?.clientWidth ?? 0 } : null
  })
  expect(enWidths).not.toBeNull()
  expect(enWidths!.scroll).toBeLessThanOrEqual(enWidths!.client + 1)
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
