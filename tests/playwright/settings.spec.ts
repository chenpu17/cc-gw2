import { expect, test } from '@playwright/test'
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
          text: 'Hello from settings Playwright test',
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

test('settings web ui preserves manual save flow and supports config, maintenance, and auth flows', async ({ page, request }) => {
  const baseUrl = harness.baseUrl()
  const configInfoResponse = await request.get(`${baseUrl}/api/config/info`)
  expect(configInfoResponse.status()).toBe(200)
  const configInfo = await configInfoResponse.json()
  const originalRetention = Number(configInfo.config.logRetentionDays ?? 30)
  const nextRetention = originalRetention >= 365 ? 180 : originalRetention + 1

  await page.goto(`${baseUrl}/ui/settings`)
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible()

  const basicsSection = page.locator('#section-basics')
  const retentionInput = basicsSection.locator('input[type="number"]').nth(1)
  await retentionInput.fill(String(nextRetention))

  await expect(page.getByText('待保存 1 项')).toBeVisible()
  await page.getByRole('button', { name: '保存设置' }).first().click()
  await expect(page.getByText(/系统配置已更新|配置已保存/)).toBeVisible()

  const updatedConfigResponse = await request.get(`${baseUrl}/api/config/info`)
  expect(updatedConfigResponse.status()).toBe(200)
  const updatedConfigInfo = await updatedConfigResponse.json()
  expect(updatedConfigInfo.config.logRetentionDays).toBe(nextRetention)

  await page.locator('#section-config-file').getByRole('button', { name: '复制' }).click()
  await expect(page.getByText('配置文件路径已复制到剪贴板。')).toBeVisible()

  await page.locator('#section-cleanup').getByRole('button', { name: '清理历史日志' }).click()
  const cleanupDialog = page.getByRole('dialog', { name: '清理历史日志' })
  await expect(cleanupDialog).toBeVisible()
  await cleanupDialog.getByRole('button', { name: '清理历史日志' }).click()
  await expect(page.getByText(/已删除 \d+ 条历史日志。|没有需要删除的日志。/)).toBeVisible()

  const valid = await request.post(`${baseUrl}/v1/messages`, {
    data: messagePayload,
    headers: {
      'content-type': 'application/json',
    },
  })
  expect(valid.status()).toBe(200)

  await page.locator('#section-cleanup').getByRole('button', { name: '彻底清空' }).click()
  const clearDialog = page.getByRole('dialog', { name: '彻底清空日志' })
  await expect(clearDialog).toBeVisible()
  await clearDialog.getByRole('button', { name: '彻底清空' }).click()
  await expect(page.getByText(/日志已清空/)).toBeVisible()

  const clearedLogsResponse = await request.get(`${baseUrl}/api/logs?limit=10`)
  expect(clearedLogsResponse.status()).toBe(200)
  const clearedLogs = await clearedLogsResponse.json()
  expect(clearedLogs.items).toHaveLength(0)

  const securitySection = page.locator('#section-security')
  await securitySection.getByRole('switch').first().click()
  await securitySection.getByPlaceholder('设置用于登录的用户名').fill('settings-admin')
  await securitySection.getByPlaceholder('至少 6 位字符').fill('secret123')
  await securitySection.getByPlaceholder('再次输入登录密码').fill('secret123')
  await securitySection.getByRole('button', { name: '保存安全设置' }).click()
  await expect(page.getByText('安全设置已更新。')).toBeVisible()

  await page.context().clearCookies()
  await page.goto(`${baseUrl}/ui/login`)
  await page.getByLabel('用户名').fill('settings-admin')
  await page.getByLabel('密码').fill('secret123')
  await page.getByRole('button', { name: '登录' }).click()
  await expect(page).toHaveURL(/\/ui\/settings$/)
  await expect(page.getByRole('heading', { name: '设置', level: 1 })).toBeVisible()
})
