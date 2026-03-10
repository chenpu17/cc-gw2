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
          text: 'Hello from Playwright',
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

async function disableWildcard(request: any, baseUrl: string) {
  const list = await request.get(`${baseUrl}/api/keys`)
  expect(list.status()).toBe(200)
  const keys = await list.json()
  const wildcard = keys.find((item: any) => item.isWildcard)
  if (wildcard) {
    const update = await request.patch(`${baseUrl}/api/keys/${wildcard.id}`, {
      data: { enabled: false },
    })
    expect(update.status()).toBe(200)
  }
}

async function pollForLog(request: any, baseUrl: string, apiKeyId: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${baseUrl}/api/logs?limit=10`)
    expect(response.status()).toBe(200)
    const body = await response.json()
    const item = body.items?.find((entry: any) => entry.api_key_id === apiKeyId)
    if (item) {
      return item
    }
    await delay(250)
  }
  throw new Error('log entry not found in time')
}

test('api key web ui can create a key and the key is reflected in logs', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await disableWildcard(request, baseUrl)

  await page.goto(`${baseUrl}/ui/api-keys`)
  await expect(page.getByRole('heading', { name: 'API 密钥管理', level: 1 })).toBeVisible()

  await page.getByRole('button', { name: '创建新密钥' }).click()
  await page.getByLabel(/输入密钥名称/).fill('Playwright Test Key')
  await page.getByLabel(/密钥描述/).fill('Created from Playwright')
  await page.getByRole('button', { name: /^创建$/ }).click()

  await expect(page.getByText('API 密钥创建成功')).toBeVisible()
  await expect(page.getByText('Playwright Test Key')).toBeVisible()

  const createdDialog = page.getByRole('dialog', { name: 'API 密钥已创建' })
  await expect(createdDialog).toBeVisible()
  const keyValueNode = createdDialog.getByText(/^sk-/).first()
  await expect(keyValueNode).toBeVisible()
  const apiKeyValue = (await keyValueNode.textContent())?.trim()
  expect(apiKeyValue).toBeTruthy()

  const createResponse = await request.get(`${baseUrl}/api/keys`)
  expect(createResponse.status()).toBe(200)
  const keys = await createResponse.json()
  const created = keys.find((item: any) => item.name === 'Playwright Test Key')
  expect(created).toBeTruthy()

  const invalid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
      'x-api-key': 'invalid-key',
    },
  })
  expect(invalid.status()).toBe(401)

  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKeyValue!,
    },
  })
  expect(valid.status()).toBe(200)

  const logEntry = await pollForLog(request, baseUrl, created.id)
  expect(logEntry.api_key_name).toBe('Playwright Test Key')

  await createdDialog.getByRole('button', { name: '关闭' }).click()
  await page.getByRole('link', { name: '请求日志' }).click()
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.getByText('Playwright Test Key')).toBeVisible()
})
