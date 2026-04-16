import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const projectRoot = path.resolve(__dirname, '..')
const outputDir = path.join(projectRoot, 'docs/assets/compare-pen')
const baseUrl = process.env.CC_GW_SCREENSHOT_BASE_URL ?? 'http://127.0.0.1:4173'

const captures = [
  ['live-dashboard.png', `${baseUrl}/ui/`],
  ['live-logs.png', `${baseUrl}/ui/logs`],
  ['live-model-management.png', `${baseUrl}/ui/models`],
  ['live-api-keys.png', `${baseUrl}/ui/api-keys`],
  ['live-events.png', `${baseUrl}/ui/events`],
  ['live-help.png', `${baseUrl}/ui/help`],
  ['live-settings.png', `${baseUrl}/ui/settings`],
  ['live-about.png', `${baseUrl}/ui/about`],
]

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })

  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1200 },
      colorScheme: 'light',
      deviceScaleFactor: 1,
    })

    await context.addInitScript(() => {
      window.localStorage.setItem('cc-gw-language', 'zh')
      window.localStorage.setItem('cc-gw-theme', 'light')
    })

    for (const [fileName, url] of captures) {
      const page = await context.newPage()
      await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
      await page.screenshot({
        path: path.join(outputDir, fileName),
        fullPage: true,
      })
      console.log(`captured ${path.relative(projectRoot, path.join(outputDir, fileName))}`)
      await page.close()
    }

    await context.close()
  } finally {
    await browser.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
