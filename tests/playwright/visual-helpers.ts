import { test as base, expect, type Locator, type Page, type TestInfo } from '@playwright/test'

export { expect }

export type VisualLocale = 'zh' | 'en'

/**
 * Visual-regression `test` controller.
 *
 * Pins BOTH visual axes to the baseline family, deterministically:
 *
 * 1. Locale. The app's i18n (`src/web/src/i18n/index.ts`) ignores
 *    `navigator.language` and reads `localStorage['cc-gw-language']` exactly
 *    once at module init, defaulting to zh — and persists whatever it resolved
 *    back to storage. Playwright's `context.locale`/`colorScheme` use options
 *    therefore have no effect, and a pre-paint `context.addInitScript` races
 *    with that init often enough to render zh (which then self-persists,
 *    corrupting later reloads). Half of en captures came out zh, so baselines
 *    were non-deterministic.
 *
 * 2. Theme family + color mode. The app persists `cc-gw-theme` and
 *    `cc-gw-skin` on every load (`usePersistentState` writes on mount), and
 *    the switcher UI writes them on click. Baselines must always render
 *    light + minimal regardless of what a previous test or a future default
 *    flip leaves in storage.
 *
 * Fix for all three: override the `page` fixture so every `page.goto`
 * re-writes the storage keys AFTER first paint and reloads once. The second
 * load re-inits the app against the pinned values — deterministic. (zh +
 * light + minimal are also the app defaults, so for them the reload merely
 * re-renders the same thing; the pin is insurance, not a behavior change.)
 */
export const visualTest = base.extend<{ page: Page }>({
  page: async ({ page }, use, testInfo) => {
    const locale = currentLocale(testInfo)
    const realGoto = page.goto.bind(page) as Page['goto']
    const pinnedGoto: Page['goto'] = async (url, options) => {
      const response = await realGoto(url, options)
      await page.evaluate((lng) => {
        try {
          window.localStorage.setItem('cc-gw-language', lng)
          window.localStorage.setItem('cc-gw-theme', 'light')
          window.localStorage.setItem('cc-gw-skin', 'minimal')
        } catch {
          // storage may be unavailable on about:blank — ignore
        }
      }, locale)
      await page.reload()
      return response
    }
    page.goto = pinnedGoto
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
  /** Capture the whole page, below the fold included (injects the unroll below). */
  fullPage?: boolean
  /** Per-pixel diff tolerance override; defaults to 0.015 (1.5%). */
  maxDiffPixelRatio?: number
}

/**
 * Hand scroll ownership back to the document.
 *
 * The console pins itself to the viewport and scrolls an inner div:
 * `global.css` sets `height: 100%` on html/body/#root, `AppLayout` wraps
 * everything in an `h-screen overflow-hidden` shell, and the page content
 * scrolls inside `data-testid="app-scroll"`. Playwright's fullPage size is
 * `max(body.scrollHeight, documentElement.scrollHeight)`, so it never exceeds
 * the viewport and `fullPage: true` silently degenerates to a viewport capture
 * — everything below the fold never reaches a baseline.
 *
 * Relaxing that one constraint (test-only, injected — same precedent as
 * `hideVolatileVisualValues`) makes the document as tall as its content, which
 * is what `fullPage` always meant.
 */
const FULL_PAGE_UNROLL_CSS = [
  // Required, not cosmetic: all three carry `overflow-x: hidden`, which
  // computes the other axis to `auto` — each is a viewport-pinned clipping
  // box, and `#root` in particular would swallow the taller shell where
  // Playwright's full-page measurement cannot see it.
  'html, body, #root { height: auto !important; }',
  // `min-height` keeps the old full-viewport floor for short pages (a page
  // shorter than the viewport would otherwise cut the sidebar's border-r
  // partway down). `overflow: hidden` stays: the shell remains the nearest
  // scrollport, so `sticky` children still render at their flow position.
  '[data-testid="app-shell"] { height: auto !important; min-height: 100vh !important; }',
  '[data-testid="app-scroll"] { overflow: visible !important; }',
].join('\n')

export async function unrollForFullPage(page: Page): Promise<void> {
  await page.addStyleTag({ content: FULL_PAGE_UNROLL_CSS })
}

/**
 * Tripwire so the unroll can never silently regress to viewport-sized
 * baselines: a renamed testid or an ancestor re-pinned to `height: 100%`
 * fails loudly here instead of quietly shrinking the capture back to one
 * viewport.
 */
export async function assertDocumentOwnsScroll(page: Page): Promise<void> {
  const metrics = await page.evaluate(() => {
    const scroll = document.querySelector('[data-testid="app-scroll"]') as HTMLElement | null
    return {
      hasScroll: Boolean(scroll),
      clientHeight: scroll?.clientHeight ?? -1,
      scrollHeight: scroll?.scrollHeight ?? -1,
      docHeight: document.documentElement.scrollHeight,
    }
  })
  expect(metrics.hasScroll, 'app-scroll testid missing (AppLayout.tsx)').toBe(true)
  expect(
    metrics.scrollHeight,
    'app-scroll still clips its content: fullPage would capture only the viewport',
  ).toBeLessThanOrEqual(metrics.clientHeight + 1)
  expect(
    metrics.docHeight,
    'document scroller does not span the app content',
  ).toBeGreaterThanOrEqual(metrics.scrollHeight)
}

export async function expectPageSnapshot(page: Page, name: string, options: SnapshotOptions = {}): Promise<void> {
  if (options.fullPage) {
    await unrollForFullPage(page)
    await assertDocumentOwnsScroll(page)
  }
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: options.fullPage ?? false,
    // The env override exists only for drift probing (`VISUAL_MAX_DIFF_PIXEL_RATIO=0.000001`);
    // the default is unchanged.
    maxDiffPixelRatio: options.maxDiffPixelRatio ?? Number(process.env.VISUAL_MAX_DIFF_PIXEL_RATIO ?? 0.015),
  })
}

/**
 * Mask elements flagged `data-visual-volatile` (timestamps, ids, ports…).
 *
 * `"true"` hides the element outright — right for a text node, which has no box
 * styling of its own to lose. `"text"` only makes the glyphs transparent and
 * keeps the element's border/fill in frame: use it for `<input>` values, where
 * hiding the element would punch a hole in the card *and* drop the input's own
 * rendering out of the regression net.
 */
export async function hideVolatileVisualValues(page: Page): Promise<void> {
  await page.addStyleTag({
    content: [
      '[data-visual-volatile="true"] { visibility: hidden !important; }',
      '[data-visual-volatile="text"] { color: transparent !important; }',
    ].join('\n'),
  })
}
