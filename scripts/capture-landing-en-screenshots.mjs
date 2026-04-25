/**
 * Capture English-version screenshots of the landing page.
 * Requires the web UI to be built (`pnpm --filter @cc-gw/web build`).
 * Starts a vite preview server internally, so no external server is needed.
 *
 * Usage:
 *   node scripts/capture-landing-en-screenshots.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const outputDir = path.join(projectRoot, 'docs/assets/landing-en')

fs.mkdirSync(outputDir, { recursive: true })

// ── Start vite preview ──────────────────────────────────────────────────────
async function startPreview() {
  const proc = spawn('pnpm', ['--filter', '@cc-gw/web', 'exec', 'vite', 'preview', '--port', '4173', '--strictPort'], {
    cwd: projectRoot,
    stdio: 'pipe',
    shell: true,
  })
  proc.stdout.on('data', (d) => process.stdout.write(`[preview] ${d}`))
  proc.stderr.on('data', (d) => process.stderr.write(`[preview-err] ${d}`))

  // Wait for server to be ready
  const base = 'http://localhost:4173'
  for (let i = 0; i < 80; i++) {
    try {
      const r = await fetch(base)
      if (r.ok || r.status < 500) break
    } catch {}
    await delay(250)
  }
  return proc
}

// ── Sections to capture ─────────────────────────────────────────────────────
const sections = [
  { name: 'hero',      selector: 'section:first-of-type',  clip: false },
  { name: 'benefits',  selector: '#why',                   clip: false },
  { name: 'how',       selector: '#how',                   clip: false },
  { name: 'debug',     selector: '#debug',                 clip: false },
  { name: 'local',     selector: '#local',                 clip: false },
  { name: 'quickstart',selector: '#start',                 clip: false },
  { name: 'console',   selector: '#console',               clip: false },
  { name: 'full-page', selector: null,                     clip: false },
]

async function main() {
  const preview = await startPreview()
  const browser = await chromium.launch({ headless: true })

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 900 },
      colorScheme: 'light',
      deviceScaleFactor: 2,
    })

    const page = await context.newPage()
    await page.goto('http://localhost:4173/landing.html', { waitUntil: 'networkidle', timeout: 30_000 })

    // Switch to English
    const toggle = page.getByRole('button', { name: 'Toggle language' })
    await toggle.waitFor({ state: 'visible' })
    await toggle.click()
    await delay(400) // let re-render settle

    // Full-page screenshot
    await page.screenshot({
      path: path.join(outputDir, 'full-page.png'),
      fullPage: true,
    })
    console.log('captured full-page.png')

    // Per-section screenshots (scroll into view, screenshot that section)
    const perSection = [
      { name: 'hero',       id: null },
      { name: 'benefits',   id: '#why' },
      { name: 'how',        id: '#how' },
      { name: 'debug',      id: '#debug' },
      { name: 'local',      id: '#local' },
      { name: 'quickstart', id: '#start' },
      { name: 'console',    id: '#console' },
    ]

    for (const { name, id } of perSection) {
      try {
        if (id) {
          const el = page.locator(id)
          await el.scrollIntoViewIfNeeded()
          await delay(250)
          const box = await el.boundingBox()
          if (box) {
            await page.screenshot({
              path: path.join(outputDir, `section-${name}.png`),
              clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 1200) },
            })
          }
        } else {
          // hero: just viewport at top
          await page.evaluate(() => window.scrollTo(0, 0))
          await delay(150)
          await page.screenshot({
            path: path.join(outputDir, `section-${name}.png`),
          })
        }
        console.log(`captured section-${name}.png`)
      } catch (err) {
        console.warn(`skipped ${name}: ${err.message}`)
      }
    }

    // Mobile viewport screenshot
    await page.setViewportSize({ width: 390, height: 844 })
    await page.goto('http://localhost:4173/landing.html', { waitUntil: 'networkidle' })
    const mToggle = page.getByRole('button', { name: 'Toggle language' })
    await mToggle.waitFor({ state: 'visible' })
    await mToggle.click()
    await delay(400)
    await page.screenshot({
      path: path.join(outputDir, 'mobile-hero.png'),
      fullPage: false,
    })
    console.log('captured mobile-hero.png')

    await context.close()
    console.log(`\nAll screenshots saved to: docs/assets/landing-en/`)
  } finally {
    await browser.close()
    preview.kill('SIGTERM')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
