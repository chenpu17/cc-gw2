import { defineConfig } from '@playwright/test'

const DESKTOP_VIEWPORT = { width: 1440, height: 1200 }
const NARROW_VIEWPORT = { width: 390, height: 844 }

/**
 * Visual coverage matrix.
 *
 * `desktop-zh` is the canonical project: it runs every spec (core/hardening
 * included), so CI (`test:e2e:web:core` / `:hardening`) still runs behavior
 * suites exactly once. The three non-canonical projects are restricted via
 * `testMatch` to `visual*.spec.ts` only — they never re-run behavior suites,
 * keeping CI time unchanged. Within visual specs, `grepInvert` excludes the
 * desktop-zh-only `@overlay-only` (full overlay sweep) and `@data` (seeded
 * data-state) suites, so en/narrow projects capture page shells + the sampled
 * overlays only.
 *
 * `snapshotPathTemplate` drops the platform suffix (visual baselines are
 * darwin-only local artifacts — CI never runs them) and encodes the project
 * name instead, e.g. `dashboard-page-desktop-zh.png`.
 */
export default defineConfig({
  testDir: './tests/playwright',
  timeout: 120_000,
  expect: {
    timeout: 15_000,
  },
  fullyParallel: false,
  workers: 1,
  snapshotPathTemplate: '{snapshotDir}/{testFileDir}/{testFileName}-snapshots/{arg}-{projectName}.png',
  use: {
    headless: true,
    trace: 'retain-on-failure',
  },
  projects: [
    {
      name: 'desktop-zh',
      use: { viewport: DESKTOP_VIEWPORT, colorScheme: 'light' },
      metadata: { locale: 'zh' },
    },
    {
      name: 'desktop-en',
      testMatch: /visual.*\.spec\.ts$/,
      grepInvert: /@overlay-only|@data/,
      use: { viewport: DESKTOP_VIEWPORT, colorScheme: 'light' },
      metadata: { locale: 'en' },
    },
    {
      name: 'narrow-zh',
      testMatch: /visual.*\.spec\.ts$/,
      grepInvert: /@overlay-only|@data/,
      use: { viewport: NARROW_VIEWPORT, colorScheme: 'light' },
      metadata: { locale: 'zh' },
    },
    {
      name: 'narrow-en',
      testMatch: /visual.*\.spec\.ts$/,
      grepInvert: /@overlay-only|@data/,
      use: { viewport: NARROW_VIEWPORT, colorScheme: 'light' },
      metadata: { locale: 'en' },
    },
  ],
})
