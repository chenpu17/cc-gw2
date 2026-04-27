import { expect, test, type Page } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()
const profilerTitle = /Profiler|性能分析/
const startRecording = /Start Recording|开始录制/
const stopRecording = /Stop Recording|停止录制/
const timelineTab = /Timeline|时间线/
const breakdownTab = /Breakdown|拆解视图/
const flowTab = /Flow|交互流/
const perTurnBreakdown = /Per-Turn Breakdown|逐轮拆解/
const clearAction = /Clear|清空/
const waitingForRequests = /Waiting for requests…|等待请求进入\.\.\./
const toolCallsTab = /Tool Calls|工具调用/
const turnOneTitleSelector = 'button[title="Turn 1"], button[title="第 1 轮"]'

function sessionItemName(sessionId: string, turns: number) {
  return new RegExp(`${sessionId}.*(${turns} turns|${turns} 轮)`)
}

function sessionSummaryName(sessionId: string, turns: number) {
  return new RegExp(`${sessionId}.*(${turns} turns|${turns} 轮).*(tokens|tok)`)
}

function turnButtonName(turn: number) {
  return new RegExp(`(T${turn}.*TTFT.*tool calls|T${turn}.*TTFT.*工具调用)`, 'i')
}

async function startProfilerFromUi(page: Page) {
  await page.getByRole('button', { name: startRecording }).first().click()
  await expect(page.getByRole('button', { name: stopRecording }).first()).toBeVisible()
}

async function stopProfilerFromUi(page: Page) {
  await page.getByRole('button', { name: stopRecording }).first().click()
  await expect(page.getByRole('button', { name: startRecording }).first()).toBeVisible()
}

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

async function resetProfiler(request: any, baseUrl: string) {
  await request.post(`${baseUrl}/api/profiler/stop`)
  await request.post(`${baseUrl}/api/profiler/sessions/clear`)
}

async function sendChatTurn(request: any, baseUrl: string, sessionId: string, content: string) {
  const response = await request.post(`${baseUrl}/openai/v1/chat/completions`, {
    data: {
      model: 'stub-model',
      session_id: sessionId,
      messages: [{ role: 'user', content }]
    },
    headers: {
      'content-type': 'application/json'
    }
  })

  expect(response.status()).toBe(200)
}

async function pollForProfilerSession(
  request: any,
  baseUrl: string,
  sessionId: string,
  turnCount?: number
) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const response = await request.get(`${baseUrl}/api/profiler/sessions?limit=100`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    const session = (body.items ?? []).find((item: any) => item.sessionId === sessionId)
    if (session && (turnCount == null || session.turnCount === turnCount)) {
      return session
    }
    await delay(250)
  }

  throw new Error(`profiler session not found in time: ${sessionId}`)
}

test('profiler UI records, displays, and explores a captured session', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const sessionId = 'prof-e2e-1'

  await resetProfiler(request, baseUrl)

  await page.goto(`${baseUrl}/ui/`)
  await page.getByRole('link', { name: '性能分析' }).click()
  await expect(page).toHaveURL(/\/ui\/profiler$/)
  await expect(page.getByText(profilerTitle).first()).toBeVisible()

  await startProfilerFromUi(page)

  await sendChatTurn(request, baseUrl, sessionId, 'first profiler turn')
  await sendChatTurn(request, baseUrl, sessionId, 'second profiler turn')
  await pollForProfilerSession(request, baseUrl, sessionId, 2)

  const sessionItem = page.getByRole('button', { name: sessionItemName(sessionId, 2) })
  await expect(sessionItem).toBeVisible({ timeout: 15_000 })
  await sessionItem.click()

  await expect(page.getByText(sessionSummaryName(sessionId, 2)).first()).toBeVisible()

  await page.getByRole('button', { name: timelineTab }).click()
  await expect(page.getByText(/Compressed overview|压缩总览/).first()).toBeVisible()
  await expect(page.getByText(/Total latency|总延迟/).first()).toBeVisible()
  await expect(page.getByText(/Tool executing|工具调用/).first()).toBeVisible()
  await expect(page.getByText(/TTFT/).first()).toBeVisible()
  await expect(page.locator(turnOneTitleSelector).first()).toBeVisible()

  await page.getByRole('button', { name: breakdownTab }).click()
  await expect(page.getByText(perTurnBreakdown)).toBeVisible()
  await expect(page.getByRole('button', { name: turnButtonName(1) })).toBeVisible()
  await expect(page.getByText('first profiler turn').first()).toBeVisible()
  await expect(page.getByText('Stub response:first profiler turn').first()).toBeVisible()
  await page.getByRole('button', { name: turnButtonName(2) }).click()
  await expect(page.getByText('second profiler turn').first()).toBeVisible()
  await expect(page.getByText('Stub response:second profiler turn').first()).toBeVisible()

  await page.getByRole('button', { name: flowTab }).click()
  await expect(page.getByText('2 turns').first()).toBeVisible()
  await expect(page.getByText('Agent').first()).toBeVisible()
  await expect(page.getByText('LLM').first()).toBeVisible()

  await stopProfilerFromUi(page)
})

test('profiler clear removes old turns before reusing the same session id', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const sessionId = 'prof-reuse'
  const oldMessage = 'old profiler turn'
  const newMessage = 'new profiler turn'

  await resetProfiler(request, baseUrl)

  await page.goto(`${baseUrl}/ui/profiler`)
  await expect(page.getByText(profilerTitle).first()).toBeVisible()

  await startProfilerFromUi(page)

  await sendChatTurn(request, baseUrl, sessionId, oldMessage)
  await pollForProfilerSession(request, baseUrl, sessionId, 1)

  const firstSessionItem = page.getByRole('button', { name: sessionItemName(sessionId, 1) })
  await expect(firstSessionItem).toBeVisible({ timeout: 15_000 })
  await firstSessionItem.click()
  await page.getByRole('button', { name: breakdownTab }).click()
  await expect(page.getByText(oldMessage).first()).toBeVisible()

  await page.getByRole('button', { name: clearAction }).click()
  await expect(page.getByText(waitingForRequests)).toBeVisible()

  await sendChatTurn(request, baseUrl, sessionId, newMessage)
  await pollForProfilerSession(request, baseUrl, sessionId, 1)

  const reusedSessionItem = page.getByRole('button', { name: sessionItemName(sessionId, 1) })
  await expect(reusedSessionItem).toBeVisible({ timeout: 15_000 })
  await reusedSessionItem.click()

  await page.getByRole('button', { name: breakdownTab }).click()
  await expect(page.getByText('new profiler turn').first()).toBeVisible()
  await expect(page.getByText('old profiler turn')).toHaveCount(0)
  await expect(page.getByRole('button', { name: turnButtonName(1) })).toBeVisible()
})

test('profiler timeline stays scrollable when a session has many turns', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const sessionId = 'prof-many-turns'
  const turnCount = 28

  await resetProfiler(request, baseUrl)

  await page.goto(`${baseUrl}/ui/profiler`)
  await expect(page.getByText(profilerTitle).first()).toBeVisible()

  await startProfilerFromUi(page)

  for (let turn = 1; turn <= turnCount; turn += 1) {
    await sendChatTurn(request, baseUrl, sessionId, `many profiler turn ${turn}`)
  }
  await pollForProfilerSession(request, baseUrl, sessionId, turnCount)

  const sessionItem = page.getByRole('button', { name: sessionItemName(sessionId, turnCount) })
  await expect(sessionItem).toBeVisible({ timeout: 15_000 })
  await sessionItem.click()

  await page.getByRole('button', { name: timelineTab }).click()

  const sessionContent = page.getByTestId('profiler-session-content')
  await expect(sessionContent).toBeVisible()

  const scrollMetrics = await sessionContent.evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight
  }))
  expect(scrollMetrics.scrollHeight).toBeGreaterThan(scrollMetrics.clientHeight)

  await sessionContent.evaluate((element) => {
    element.scrollTo({ top: element.scrollHeight, behavior: 'auto' })
  })

  await expect(page.getByTestId('profiler-turn-detail')).toBeInViewport()
  await expect(page.getByRole('button', { name: toolCallsTab })).toBeVisible()
  await expect(page.getByText('many profiler turn 1').first()).toBeVisible()

  await stopProfilerFromUi(page)
})
