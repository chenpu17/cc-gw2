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

async function pollForKeyDeletion(request: any, baseUrl: string, apiKeyId: number) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await request.get(`${baseUrl}/api/keys`)
    expect(response.status()).toBe(200)
    const keys = await response.json()
    if (!keys.find((item: any) => item.id === apiKeyId)) {
      return
    }
    await delay(250)
  }

  throw new Error('api key not deleted in time')
}

test('api key web ui covers create, reveal, restrict, toggle, analytics, and delete flows', async ({ page, request }) => {
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
  await createdDialog.getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('密钥已复制到剪贴板')).toBeVisible()

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

  const createdKeyCard = page.locator(
    'xpath=//h3[normalize-space()="Playwright Test Key"]/ancestor::div[@data-testid="api-key-card"][1]'
  )

  await createdKeyCard.getByRole('button', { name: '显示完整密钥' }).click()
  await expect(createdKeyCard.getByRole('button', { name: '隐藏密钥' })).toBeVisible()
  await createdKeyCard.getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('密钥已复制到剪贴板')).toBeVisible()
  await createdKeyCard.getByRole('button', { name: '隐藏密钥' }).click()
  await expect(createdKeyCard.getByRole('button', { name: '显示完整密钥' })).toBeVisible()

  await createdKeyCard.getByRole('button', { name: '编辑端点权限' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑端点权限' })
  await expect(editDialog).toBeVisible()
  await editDialog.getByRole('checkbox', { name: /Anthropic \(anthropic\)/ }).check()
  await editDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('API 密钥已更新').first()).toBeVisible()
  await expect(createdKeyCard.getByText('已限制端点')).toBeVisible()
  await expect(createdKeyCard.getByText(/^anthropic$/).first()).toBeVisible()

  await createdKeyCard.getByRole('button', { name: '禁用', exact: true }).click()
  await expect(page.getByText('API 密钥已更新').first()).toBeVisible()
  await expect(createdKeyCard.getByText(/^已禁用$/).first()).toBeVisible()

  await createdKeyCard.getByRole('button', { name: '启用', exact: true }).click()
  await expect(page.getByText('API 密钥已更新').first()).toBeVisible()
  await expect(createdKeyCard.getByText(/^已启用$/).first()).toBeVisible()

  await page.getByRole('button', { name: '近 30 天' }).click()
  await expect(page.getByText('展示最近 30 天的密钥调用情况')).toBeVisible()

  await createdKeyCard.getByRole('button', { name: '删除' }).last().click()
  const deleteDialog = page.getByRole('dialog', { name: '删除 API 密钥' })
  await expect(deleteDialog).toBeVisible()
  await deleteDialog.getByRole('button', { name: '删除' }).click()
  await pollForKeyDeletion(request, baseUrl, created.id)

  const finalKeysResponse = await request.get(`${baseUrl}/api/keys`)
  expect(finalKeysResponse.status()).toBe(200)
  const finalKeys = await finalKeysResponse.json()
  expect(finalKeys.find((item: any) => item.id === created.id)).toBeFalsy()

  await page.goto(`${baseUrl}/ui/logs`)
  await expect(page.getByRole('heading', { name: '请求日志', level: 1 })).toBeVisible()
  await expect(page.getByText('Playwright Test Key')).toBeVisible()
})

test('maxConcurrency: create via API, display in card, edit via dialog, and clear', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  await disableWildcard(request, baseUrl)

  // Create a key with maxConcurrency=3 via API
  const createResp = await request.post(`${baseUrl}/api/keys`, {
    data: { name: 'Concurrency Key', maxConcurrency: 3 },
  })
  expect(createResp.status()).toBe(200)
  const created = await createResp.json()
  expect(created.name).toBe('Concurrency Key')
  const apiKeyValue = created.key

  // Verify via list API
  const listResp = await request.get(`${baseUrl}/api/keys`)
  const allKeys = await listResp.json()
  const listed = allKeys.find((k: any) => k.id === created.id)
  expect(listed.maxConcurrency).toBe(3)

  // Load the UI and verify the card displays the concurrency value
  await page.goto(`${baseUrl}/ui/api-keys`)
  await expect(page.getByRole('heading', { name: 'API 密钥管理', level: 1 })).toBeVisible()

  const card = page.locator(
    'xpath=//h3[normalize-space()="Concurrency Key"]/ancestor::div[@data-testid="api-key-card"][1]'
  )
  await expect(card).toBeVisible()

  // Edit maxConcurrency via the edit dialog
  await card.getByRole('button', { name: '编辑端点权限' }).click()
  const editDialog = page.getByRole('dialog', { name: '编辑端点权限' })
  await expect(editDialog).toBeVisible()
  const concurrencyInput = editDialog.locator('input[type="number"]')
  await concurrencyInput.clear()
  await concurrencyInput.fill('10')
  await editDialog.getByRole('button', { name: '保存' }).click()
  await expect(page.getByText('API 密钥已更新').first()).toBeVisible()

  // Verify the update via API
  const updatedResp = await request.get(`${baseUrl}/api/keys`)
  const updatedKeys = await updatedResp.json()
  const updated = updatedKeys.find((k: any) => k.id === created.id)
  expect(updated.maxConcurrency).toBe(10)

  // Clear maxConcurrency via API PATCH
  const patchResp = await request.patch(`${baseUrl}/api/keys/${created.id}`, {
    data: { maxConcurrency: null },
  })
  expect(patchResp.status()).toBe(200)

  const clearedResp = await request.get(`${baseUrl}/api/keys`)
  const clearedKeys = await clearedResp.json()
  const cleared = clearedKeys.find((k: any) => k.id === created.id)
  expect(cleared.maxConcurrency).toBeNull()

  // Verify the request still works with the key (unlimited now)
  const validReq = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKeyValue!,
    },
  })
  expect(validReq.status()).toBe(200)

  // Clean up
  await request.delete(`${baseUrl}/api/keys/${created.id}`)
})

test('wildcard key: edit maxConcurrency via UI dialog saves without allowedEndpoints', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()

  // Find the wildcard key
  const listResp = await request.get(`${baseUrl}/api/keys`)
  const allKeys = await listResp.json()
  const wildcard = allKeys.find((k: any) => k.isWildcard)
  expect(wildcard).toBeTruthy()
  const wildcardId = wildcard.id

  // Enable wildcard so it appears in the UI
  await request.patch(`${baseUrl}/api/keys/${wildcardId}`, {
    data: { enabled: true },
  })

  // Load the API keys page
  await page.goto(`${baseUrl}/ui/api-keys`)
  await expect(page.getByRole('heading', { name: 'API 密钥管理', level: 1 })).toBeVisible()

  // Find the wildcard card
  const wildcardCard = page.locator(
    'xpath=//h3[normalize-space()="Wildcard"]/ancestor::div[@data-testid="api-key-card"][1]'
  )
  await expect(wildcardCard).toBeVisible()

  // Click the "最大并发数" button (wildcard shows maxConcurrency label, not editEndpoints)
  await wildcardCard.getByRole('button', { name: '最大并发数' }).click()

  // The edit dialog should open; for wildcard, endpoint selector is hidden
  const editDialog = page.getByRole('dialog', { name: '编辑端点权限' })
  await expect(editDialog).toBeVisible()

  // Endpoint selector should NOT be visible for wildcard
  await expect(editDialog.getByText(/Empty selection means unrestricted/)).not.toBeVisible()

  // Fill in maxConcurrency
  const concurrencyInput = editDialog.locator('input[type="number"]')
  await concurrencyInput.clear()
  await concurrencyInput.fill('5')
  await editDialog.getByRole('button', { name: '保存' }).click()

  // Verify success toast
  await expect(page.getByText('API 密钥已更新').first()).toBeVisible()

  // Verify via API that maxConcurrency was set and allowedEndpoints was NOT sent
  const afterResp = await request.get(`${baseUrl}/api/keys`)
  const afterKeys = await afterResp.json()
  const updatedWildcard = afterKeys.find((k: any) => k.id === wildcardId)
  expect(updatedWildcard.maxConcurrency).toBe(5)
  // Wildcard should still have no allowedEndpoints
  expect(updatedWildcard.allowedEndpoints).toBeNull()

  // Clean up: clear maxConcurrency
  await request.patch(`${baseUrl}/api/keys/${wildcardId}`, {
    data: { maxConcurrency: null, enabled: false },
  })
})
