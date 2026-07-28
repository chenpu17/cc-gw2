import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test'

export { expect }

export type VisualLocale = 'zh' | 'en'

/**
 * Visual-regression `test` controller.
 *
 * Forces the app locale to match the running project's `metadata.locale`. The
 * app's i18n (`src/web/src/i18n/index.ts`) ignores `navigator.language` and
 * reads `localStorage['cc-gw-language']` exactly once at module init, defaulting
 * to zh — and persists whatever it resolved back to storage. Playwright's
 * `context.locale`/`colorScheme` use options therefore have no effect, and a
 * pre-paint `context.addInitScript` races with that init often enough to render
 * zh (which then self-persists, corrupting later reloads). Half of en captures
 * came out zh, so baselines were non-deterministic.
 *
 * Fix: override the `page` fixture so every `page.goto` for a non-default
 * locale re-writes the storage key AFTER first paint and reloads once. The
 * second load re-inits i18n against the correct value — deterministic. zh is
 * the default, so it needs no enforcement.
 */
export const visualTest = base.extend<{ page: Page }>({
  page: async ({ page }, use, testInfo) => {
    const locale = currentLocale(testInfo)
    if (locale !== 'zh') {
      const realGoto = page.goto.bind(page) as Page['goto']
      const enforcedGoto: Page['goto'] = async (url, options) => {
        const response = await realGoto(url, options)
        await page.evaluate((lng) => {
          try {
            window.localStorage.setItem('cc-gw-language', lng)
          } catch {
            // storage may be unavailable on about:blank — ignore
          }
        }, locale)
        await page.reload()
        return response
      }
      page.goto = enforcedGoto
    }
    await use(page)
  },
})

export function currentLocale(testInfo: TestInfo): VisualLocale {
  const raw = testInfo.project?.metadata?.locale
  return raw === 'en' ? 'en' : 'zh'
}

/**
 * Dashboard/Events hold SSE long connections, so `networkidle` never resolves.
 * Use `load` + font readiness + a fixed settle window instead.
 */
export async function waitForVisualReady(page: Page, anchor: Locator): Promise<void> {
  await anchor.waitFor({ state: 'visible' })
  await page.waitForLoadState('load')
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await (document as Document & { fonts?: FontFaceSet }).fonts?.ready
    }
  })
  await page.waitForTimeout(350)
}

export interface SnapshotOptions {
  /** Capture the full scrollable page (logs/settings/events/dashboard). */
  fullPage?: boolean
  /** Per-pixel diff tolerance override; defaults to 0.015 (1.5%). */
  maxDiffPixelRatio?: number
}

export async function expectPageSnapshot(page: Page, name: string, options: SnapshotOptions = {}): Promise<void> {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: options.fullPage ?? false,
    maxDiffPixelRatio: options.maxDiffPixelRatio ?? 0.015,
  })
}

/** Hide elements flagged `[data-visual-volatile="true"]` (timestamps, ids, etc). */
export async function hideVolatileVisualValues(page: Page): Promise<void> {
  await page.addStyleTag({
    content: '[data-visual-volatile="true"] { visibility: hidden !important; }',
  })
}
