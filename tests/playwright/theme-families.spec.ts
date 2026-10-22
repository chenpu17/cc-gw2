import { expect, test, type Page } from '@playwright/test'
import { createGatewayHarness } from './harness'

const harness = createGatewayHarness()

test.beforeAll(async () => {
  await harness.start()
})

test.afterAll(async () => {
  await harness.stop()
})

/**
 * 主题家族(风格轴 data-skin)× 明暗轴(data-theme)的哨兵矩阵。
 *
 * 断言 themes/*.css 十个 token 块的级联契约(见
 * src/web/src/styles/themes/index.css 头注释 Rule A/B/C):
 * - 每个家族 light 块是完整集(颜色 + 结构);
 * - dark 下颜色换族、结构变量仍属本族 —— 基础 dark 块只放 minimal 的颜色,
 *   不得把任何结构变量渗透给其他家族(圆角是这一渗透最灵敏的哨兵);
 * - 存储里的未知 skin 值由 ThemeProvider 清洗回默认族;
 * - 玻璃机制(--surface-blur)只在其家族产生 backdrop-filter。
 *
 * 计算值经 normalizeToken 归一:minifier 会把 0.625rem 输出成 .625rem。
 */

interface FamilyExpectation {
  skin: string
  lightPrimary: string
  radius: string
  darkBackground: string
  darkPrimary: string
}

const FAMILIES: FamilyExpectation[] = [
  { skin: 'minimal', lightPrimary: '#5e6ad2', radius: '10px', darkBackground: '#0d0e12', darkPrimary: '#7f89ff' },
  { skin: 'classic', lightPrimary: '#2563eb', radius: '0.625rem', darkBackground: '#09090b', darkPrimary: '#60a5fa' },
  { skin: 'paper', lightPrimary: '#b4552d', radius: '6px', darkBackground: '#2f3437', darkPrimary: '#e0855f' },
  { skin: 'glass', lightPrimary: '#7c3aed', radius: '1rem', darkBackground: '#0e0c1d', darkPrimary: '#a78bfa' },
  { skin: 'modernist', lightPrimary: '#ec3013', radius: '0px', darkBackground: '#201e1d', darkPrimary: '#ff563c' },
  { skin: 'neon', lightPrimary: '#008f6b', radius: '4px', darkBackground: '#050b09', darkPrimary: '#35f0a3' },
  { skin: 'aurora', lightPrimary: '#6d4afc', radius: '14px', darkBackground: '#07081a', darkPrimary: '#9b86ff' },
  { skin: 'sakura', lightPrimary: '#cf3f74', radius: '12px', darkBackground: '#1b1117', darkPrimary: '#f472b6' },
  { skin: 'ocean', lightPrimary: '#0e7490', radius: '6px', darkBackground: '#06141b', darkPrimary: '#38bdf8' }
]

/** Families that opt into `--surface-blur` (backdrop-filter). */
const BLUR_SKINS = new Set(['glass', 'aurora'])

function normalizeToken(value: string): string {
  return value.trim().toLowerCase().replace(/^\.(\d)/, '0.$1')
}

/** 首载后写入存储再 reload:pre-paint 脚本在第二次加载时应用双轴属性。 */
async function seedAndReload(page: Page, storage: Record<string, string>) {
  await page.goto(`${harness.baseUrl()}/ui/`)
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
  await page.evaluate((entries) => {
    for (const [key, value] of Object.entries(entries)) {
      window.localStorage.setItem(key, value)
    }
  }, storage)
  await page.reload()
  await expect(page.getByRole('heading', { name: '仪表盘', level: 1 })).toBeVisible()
}

function rootToken(page: Page, name: string) {
  return page.evaluate(
    (n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(),
    name
  )
}

for (const family of FAMILIES) {
  test(`light: ${family.skin} 渲染家族色与家族结构`, async ({ page }) => {
    await seedAndReload(page, { 'cc-gw-theme': 'light', 'cc-gw-skin': family.skin })
    await expect(page.locator('html')).toHaveAttribute('data-skin', family.skin)
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    expect(normalizeToken(await rootToken(page, '--primary'))).toBe(family.lightPrimary)
    expect(normalizeToken(await rootToken(page, '--radius'))).toBe(family.radius)
  })

  test(`dark: ${family.skin} 颜色换暗族,结构仍属本族`, async ({ page }) => {
    await seedAndReload(page, { 'cc-gw-theme': 'dark', 'cc-gw-skin': family.skin })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await expect(page.locator('html')).toHaveClass(/dark/)
    expect(normalizeToken(await rootToken(page, '--background'))).toBe(family.darkBackground)
    expect(normalizeToken(await rootToken(page, '--primary'))).toBe(family.darkPrimary)
    // Rule B/C 守卫:基础 dark 块只有颜色,圆角不得被其他家族渗透
    expect(normalizeToken(await rootToken(page, '--radius'))).toBe(family.radius)
  })
}

test('存储里的未知 skin 值被清洗回默认族', async ({ page }) => {
  await seedAndReload(page, { 'cc-gw-theme': 'light', 'cc-gw-skin': 'neon-2000' })
  await expect(page.locator('html')).toHaveAttribute('data-skin', 'minimal')
  expect(normalizeToken(await rootToken(page, '--primary'))).toBe('#5e6ad2')
  expect(normalizeToken(await rootToken(page, '--radius'))).toBe('10px')
})

test('blur 机制只在声明的家族开启 backdrop-filter,其余家族无', async ({ page }) => {
  const headerFilter = () =>
    page.evaluate(
      () => getComputedStyle(document.querySelector('[data-testid="app-shell"] header')!).backdropFilter
    )
  for (const family of FAMILIES) {
    await seedAndReload(page, { 'cc-gw-theme': 'light', 'cc-gw-skin': family.skin })
    const filter = await headerFilter()
    if (BLUR_SKINS.has(family.skin)) {
      expect(filter, `${family.skin} should blur`).toContain('blur')
    } else {
      expect(filter, `${family.skin} should stay opaque`).toBe('none')
    }
  }
})
