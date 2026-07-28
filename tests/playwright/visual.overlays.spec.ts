/**
 * Overlay open-state visual regression.
 *
 * Two tiers:
 *  - `@overlay-only` describe (desktop-zh project only — en/narrow projects
 *    `grepInvert` it): full sweep of every dialog/drawer opening state, driven
 *    with zh selectors already proven by model-management / api-keys / logs
 *    specs. A serial `setup` test seeds provider + endpoint + preset + log so
 *    subsequent tests can open each overlay against stable data.
 *  - Sampled overlays (no tag → all four projects): CommandPalette,
 *    ProviderDrawer edit, LogDetailsDrawer — locale-agnostic selectors
 *    (testid / structural / role-without-name) so they run under en too.
 */
import { visualTest as test, expect, waitForVisualReady, expectPageSnapshot, hideVolatileVisualValues } from './visual-helpers'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

const PROVIDER_ID = 'overlay-demo'
const ENDPOINT_LABEL = 'Overlay Endpoint'
const ENDPOINT_ID = 'overlay-endpoint'
const SOURCE_MODEL = 'claude-overlay'
const TARGET_MODEL = `${PROVIDER_ID}:stub-model-overlay`

test.describe.serial('@overlay-only overlay open states', () => {
  test('setup: seed provider, endpoint, route, preset, and a request log', async ({ page, request }) => {
    const baseUrl = harness.baseUrl()

    // Provider via UI (two-step drawer)
    await page.goto(`${baseUrl}/ui/providers`)
    await page.getByRole('button', { name: '新增提供商' }).first().click()
    const drawer = page.locator('aside').filter({ hasText: '新增 Provider' })
    await drawer.getByRole('button', { name: /OpenAI/ }).click()
    await drawer.getByPlaceholder('如 openai').fill(PROVIDER_ID)
    await drawer.getByPlaceholder('https://api.example.com/v1').fill(`http://127.0.0.1:${harness.stubPort}`)
    await drawer.getByPlaceholder('可留空以从环境变量读取').fill('stub-key')
    await drawer.getByRole('button', { name: '下一步' }).click()
    await drawer.getByRole('button', { name: '新增模型' }).click()
    await drawer.getByPlaceholder('如 claude-sonnet-4-5-20250929').fill('stub-model-overlay')
    await drawer.getByLabel('设为默认模型').check()
    await drawer.getByRole('button', { name: '保存设置' }).click()
    await expect(page.getByText(`已添加 Provider：${PROVIDER_ID}`)).toBeVisible()

    // Endpoint + route + preset on the routing view
    await page.getByRole('tab', { name: '路由' }).click()
    await page.getByRole('button', { name: '新建端点' }).first().click()
    const endpointDialog = page.getByRole('dialog', { name: '创建端点' })
    await endpointDialog.getByPlaceholder('如 custom-api').fill(ENDPOINT_ID)
    await endpointDialog.getByPlaceholder('如 我的自定义 API').fill(ENDPOINT_LABEL)
    await endpointDialog.getByPlaceholder('如 /custom/api').fill('/overlay/v1/chat/completions')
    await endpointDialog.getByRole('button', { name: '创建' }).click()
    await expect(page.getByText('端点创建成功')).toBeVisible()

    await page.locator('[data-testid="endpoint-row"]').filter({ hasText: ENDPOINT_LABEL }).click()
    const workspace = page.getByTestId('routing-workspace')
    await workspace.getByTestId('add-route').click()
    await workspace.getByTestId('route-rule-source').fill(SOURCE_MODEL)
    await workspace.getByPlaceholder('如 kimi:kimi-k2-0905-preview').click()
    await page.getByPlaceholder('搜索 Provider、模型名或 ID').fill('stub-model-overlay')
    await page.getByRole('option', { name: new RegExp(`${PROVIDER_ID}.*stub-model-overlay`) }).last().click()
    await workspace.getByTestId('save-routes').click()
    await expect(page.getByText('模型路由已更新。').first()).toBeVisible()

    await workspace.getByTestId('preset-name-input').fill('overlay-preset')
    await workspace.getByTestId('save-preset').click()
    await expect(page.getByText('已保存模板 "overlay-preset"。')).toBeVisible()

    // Generate a request log through the gateway (stub provider returns 200)
    for (let i = 0; i < 3; i += 1) {
      await request.post(`${baseUrl}/v1/messages`, {
        data: {
          model: 'stub-model',
          messages: [{ role: 'user', content: [{ type: 'text', text: `overlay log ${i}` }] }],
        },
        headers: { 'content-type': 'application/json' },
      })
    }
  })

  test('command palette open', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers`)
    await page.getByTestId('command-palette-trigger').click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-command-palette.png')
  })

  test('provider drawer — create mode', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.getByRole('button', { name: '新增提供商' }).first().click()
    const drawer = page.locator('aside').filter({ hasText: '新增 Provider' })
    await expect(drawer).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-provider-drawer-create.png')
  })

  test('provider drawer — edit mode', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    const card = page.locator('[data-testid="provider-card"]').filter({ hasText: PROVIDER_ID })
    await card.getByRole('button', { name: '编辑' }).click()
    const drawer = page.locator('aside').filter({ hasText: '编辑 Provider' })
    await expect(drawer).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-provider-drawer-edit.png')
  })

  test('endpoint dialog — create mode', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.getByRole('button', { name: '新建端点' }).first().click()
    await expect(page.getByRole('dialog', { name: '创建端点' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-endpoint-dialog-create.png')
  })

  test('endpoint dialog — edit mode', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    const row = page.locator('[data-testid="endpoint-row"]').filter({ hasText: ENDPOINT_LABEL })
    await row.getByRole('button', { name: '编辑' }).click()
    await expect(page.getByRole('dialog', { name: '编辑端点' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-endpoint-dialog-edit.png')
  })

  test('preset diff dialog — apply', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    // Re-select the seeded endpoint so the workspace + preset row mount.
    await page.locator('[data-testid="endpoint-row"]').filter({ hasText: ENDPOINT_LABEL }).click()
    const workspace = page.getByTestId('routing-workspace')
    const presetRow = workspace.getByTestId('preset-row').filter({ hasText: 'overlay-preset' })
    await presetRow.getByTestId('apply-preset').click()
    await expect(page.getByRole('dialog', { name: '应用模板确认' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-preset-diff.png')
  })

  test('confirm dialog — delete preset', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/providers?tab=routing`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.locator('[data-testid="endpoint-row"]').filter({ hasText: ENDPOINT_LABEL }).click()
    const workspace = page.getByTestId('routing-workspace')
    const presetRow = workspace.getByTestId('preset-row').filter({ hasText: 'overlay-preset' })
    await presetRow.getByTestId('delete-preset').click()
    await expect(page.getByRole('dialog', { name: '删除' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-confirm-delete-preset.png')
    // Cancel — keep the preset so other suites stay stable.
    await page.keyboard.press('Escape')
  })

  test('api key dialog — create', async ({ page, request }) => {
    // Ensure a clean key slate: disable the wildcard so only explicit keys show.
    const list = await request.get(`${harness.baseUrl()}/api/keys`)
    const wildcard = (await list.json()).find((k: { isWildcard: boolean }) => k.isWildcard)
    if (wildcard) {
      await request.patch(`${harness.baseUrl()}/api/keys/${wildcard.id}`, { data: { enabled: false } })
    }

    await page.goto(`${harness.baseUrl()}/ui/api-keys`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.getByRole('button', { name: '创建新密钥' }).click()
    await expect(page.getByRole('dialog').first()).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-api-key-create.png')
  })

  test('api key dialog — created (reveal)', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/api-keys`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.getByRole('button', { name: '创建新密钥' }).click()
    await page.getByLabel(/输入密钥名称/).fill('Overlay Visual Key')
    await page.getByRole('button', { name: /^创建$/ }).click()
    const created = page.getByRole('dialog', { name: 'API 密钥已创建' })
    await expect(created).toBeVisible()
    // Mask the revealed key value so the baseline never stores a live secret.
    await created.getByText(/^sk-/).first().evaluate((el) => el.setAttribute('data-visual-volatile', 'true'))
    await hideVolatileVisualValues(page)
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-api-key-created.png')
  })

  test('api key dialog — edit endpoints', async ({ page, request }) => {
    const resp = await request.post(`${harness.baseUrl()}/api/keys`, {
      data: { name: 'Overlay Edit Key' },
    })
    const created = await resp.json()

    await page.goto(`${harness.baseUrl()}/ui/api-keys`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    const row = page.getByRole('row').filter({ hasText: 'Overlay Edit Key' }).first()
    await row.getByRole('button', { name: '编辑端点权限' }).click()
    await expect(page.getByRole('dialog', { name: '编辑端点权限' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-api-key-edit-endpoints.png')
    await page.keyboard.press('Escape')
    await request.delete(`${harness.baseUrl()}/api/keys/${created.id}`)
  })

  test('log details drawer — loaded record', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/logs`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.getByRole('button', { name: '详情' }).first().click()
    const drawer = page.getByRole('dialog', { name: '日志详情' })
    await expect(drawer).toBeVisible()
    await expect(drawer.getByRole('tab', { name: '客户端请求体' })).toBeVisible()
    await page.waitForTimeout(300)
    await expectPageSnapshot(page, 'overlay-log-details-drawer.png')
  })

  test('log inline detail — expanded row', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/logs`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    // Chevron toggle is the first button in the row (aria-label varies by locale).
    await page.locator('tbody tr').first().locator('button').first().click()
    await expect(page.getByTestId(/log-row-expanded-wrapper/).first()).toBeVisible()
    await page.waitForTimeout(300)
    await expectPageSnapshot(page, 'overlay-log-inline-detail.png')
  })

  test('settings — cleanup confirm dialog', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/settings`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.locator('#section-cleanup').getByRole('button', { name: '清理历史日志' }).click()
    await expect(page.getByRole('dialog', { name: '清理历史日志' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-settings-cleanup.png')
    await page.keyboard.press('Escape')
  })

  test('settings — clear-all confirm dialog (destructive)', async ({ page }) => {
    await page.goto(`${harness.baseUrl()}/ui/settings`)
    await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
    await page.locator('#section-cleanup').getByRole('button', { name: '彻底清空' }).click()
    await expect(page.getByRole('dialog', { name: '彻底清空日志' })).toBeVisible()
    await page.waitForTimeout(200)
    await expectPageSnapshot(page, 'overlay-settings-clear-all.png')
    await page.keyboard.press('Escape')
  })
})

// ---------------------------------------------------------------------------
// Sampled overlays — run under ALL projects (incl. en / narrow). Locale-
// agnostic selectors only: testid, structural position, role without name.
// ---------------------------------------------------------------------------

test('sampled: command palette (all locales)', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/providers`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
  // Keyboard shortcut works whether or not the header pill is iconified at
  // narrow widths; Cmd+K on darwin, Ctrl+K elsewhere.
  await page.keyboard.press('ControlOrMeta+k')
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(200)
  await expectPageSnapshot(page, 'sample-command-palette.png')
})

test('sampled: provider drawer edit (all locales)', async ({ page }) => {
  await page.goto(`${harness.baseUrl()}/ui/providers`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
  // Stub provider is harness-seeded; its footer's last button is "edit".
  const stubCard = page.locator('[data-testid="provider-card"]').filter({ hasText: 'Stub Provider' })
  await stubCard.getByRole('button').last().click()
  // The drawer renders as <aside role="dialog">; bare `aside` also matches the
  // two sidebar shells + the drawer's preview panel → strict-mode violation.
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(200)
  await expectPageSnapshot(page, 'sample-provider-drawer-edit.png')
})

test('sampled: log details drawer (all locales)', async ({ page, request }) => {
  await request.post(`${harness.baseUrl()}/v1/messages`, {
    data: { model: 'stub-model', messages: [{ role: 'user', content: [{ type: 'text', text: 'sample log' }] }] },
    headers: { 'content-type': 'application/json' },
  })
  await page.goto(`${harness.baseUrl()}/ui/logs`)
  await waitForVisualReady(page, page.getByRole('heading', { level: 1 }))
  // Desktop renders a per-row 详情/Detail button; narrow renders each log as a
  // card (LogCard) whose accessible name begins with the timestamp. Both open
  // the same details drawer.
  const desktopDetail = page.getByRole('button', { name: /详情|Detail/ }).first()
  if (await desktopDetail.count() > 0) {
    await desktopDetail.click()
  } else {
    await page.getByRole('button', { name: /^\d{4}-\d{2}-\d{2}/ }).first().click()
  }
  await expect(page.getByRole('dialog')).toBeVisible()
  await page.waitForTimeout(300)
  await expectPageSnapshot(page, 'sample-log-details-drawer.png')
})
