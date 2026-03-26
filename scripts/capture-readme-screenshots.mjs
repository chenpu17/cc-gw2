import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from '@playwright/test'

const projectRoot = process.cwd()
const outputDir = path.join(projectRoot, 'docs', 'assets', 'readme')

function resolveBuiltServerBinary() {
  const executable = process.platform === 'win32' ? 'cc-gw-server.exe' : 'cc-gw-server'
  const candidates = [
    path.join(projectRoot, 'target', 'release', executable),
    path.join(projectRoot, 'target', 'debug', executable),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

async function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('Unable to determine free port')))
        return
      }
      server.close((error) => {
        if (error) reject(error)
        else resolve(address.port)
      })
    })
  })
}

function createLegacyPasswordRecord(password) {
  const passwordSalt = crypto.randomBytes(16).toString('hex')
  const passwordHash = crypto
    .createHash('sha256')
    .update(passwordSalt, 'utf8')
    .update(password, 'utf8')
    .digest('hex')

  return { passwordHash, passwordSalt }
}

function writeConfig(tempHome, gatewayPort, stubPort) {
  const configDir = path.join(tempHome, '.cc-gw')
  fs.mkdirSync(configDir, { recursive: true })
  const configPath = path.join(configDir, 'config.json')
  const authRecord = createLegacyPasswordRecord('secret123')
  const baseDefaults = {
    completion: 'stub-model',
    reasoning: null,
    background: null,
    longContextThreshold: 60_000,
  }

  const config = {
    host: '127.0.0.1',
    port: gatewayPort,
    providers: [
      {
        id: 'stub',
        label: 'Stub Provider',
        type: 'openai',
        baseUrl: `http://127.0.0.1:${stubPort}`,
        apiKey: 'stub-key',
        defaultModel: 'stub-model',
        models: [{ id: 'stub-model', label: 'Stub Model' }],
      },
    ],
    defaults: { ...baseDefaults },
    endpointRouting: {
      anthropic: { defaults: { ...baseDefaults }, modelRoutes: {} },
      openai: { defaults: { ...baseDefaults }, modelRoutes: {} },
    },
    logRetentionDays: 30,
    modelRoutes: {},
    storeRequestPayloads: true,
    storeResponsePayloads: true,
    logLevel: 'error',
    webAuth: {
      enabled: false,
      username: 'visual-admin',
      passwordHash: authRecord.passwordHash,
      passwordSalt: authRecord.passwordSalt,
    },
  }

  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8')
}

async function startStubProvider(port) {
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/v1/models') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        object: 'list',
        data: [{ id: 'stub-model', object: 'model' }],
      }))
      return
    }

    if (req.method !== 'POST') {
      res.statusCode = 405
      res.end()
      return
    }

    const chunks = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      let body = {}
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {}

      if (req.url === '/v1/chat/completions') {
        const message = Array.isArray(body.messages) && body.messages.length > 0
          ? body.messages[body.messages.length - 1]?.content ?? ''
          : ''
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'chatcmpl_stub',
          object: 'chat.completion',
          model: body.model ?? 'stub-model',
          choices: [{
            index: 0,
            message: { role: 'assistant', content: `Stub response:${typeof message === 'string' ? message : ''}` },
            finish_reason: 'stop',
          }],
          usage: {
            prompt_tokens: 12,
            completion_tokens: 4,
            total_tokens: 16,
          },
        }))
        return
      }

      if (req.url === '/v1/responses') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          id: 'resp_stub',
          object: 'response',
          model: body.model ?? 'stub-model',
          status: 'completed',
          output: [{
            id: 'out_1',
            type: 'output_message',
            role: 'assistant',
            content: [{ type: 'output_text', text: 'Stub responses output' }],
          }],
          output_text: 'Stub responses output',
          usage: {
            input_tokens: 8,
            output_tokens: 3,
            total_tokens: 11,
            prompt_tokens: 8,
            completion_tokens: 3,
          },
        }))
        return
      }

      res.statusCode = 404
      res.end()
    })
  })

  await new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return server
}

async function waitForServer(port) {
  const url = `http://127.0.0.1:${port}/health`
  for (let attempt = 0; attempt < 240; attempt += 1) {
    try {
      const response = await fetch(url)
      if (response.ok) {
        return
      }
    } catch {}
    await delay(250)
  }

  throw new Error(`Gateway did not become ready in time: ${url}`)
}

async function startGateway(tempHome, gatewayPort) {
  const cliPath = path.join(projectRoot, 'src/cli/dist/index.js')
  if (!fs.existsSync(cliPath)) {
    throw new Error('missing built CLI at src/cli/dist/index.js, run `pnpm build` first')
  }

  const serverBinary = resolveBuiltServerBinary()
  if (!serverBinary) {
    throw new Error('missing built server binary under target/release or target/debug, run `pnpm build` first')
  }

  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(gatewayPort)], {
    cwd: projectRoot,
    env: {
      ...process.env,
      HOME: tempHome,
      NODE_ENV: 'test',
      CC_GW_SERVER_BIN: serverBinary,
    },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(chunk)
  })

  await waitForServer(gatewayPort)
  return child
}

async function stopGateway(child) {
  if (!child || child.exitCode !== null) {
    return
  }

  child.kill('SIGINT')

  await Promise.race([
    new Promise((resolve) => child.once('exit', resolve)),
    delay(10_000).then(() => {
      if (child.exitCode === null) {
        child.kill('SIGKILL')
      }
    }),
  ])
}

async function waitForVisualReady(page, heading) {
  await heading.waitFor({ state: 'visible' })
  await page.waitForLoadState('networkidle')
  await page.evaluate(async () => {
    if ('fonts' in document) {
      await document.fonts.ready
    }
  })
  await page.addStyleTag({
    content: `
      *, *::before, *::after {
        animation: none !important;
        transition: none !important;
        caret-color: transparent !important;
      }
      [data-visual-volatile="true"] {
        visibility: hidden !important;
      }
    `,
  })
  await page.waitForTimeout(350)
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true })

  const gatewayPort = await findFreePort()
  const stubPort = await findFreePort()
  const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-readme-'))
  writeConfig(tempHome, gatewayPort, stubPort)

  let stubServer = null
  let gatewayProcess = null
  let browser = null

  try {
    stubServer = await startStubProvider(stubPort)
    gatewayProcess = await startGateway(tempHome, gatewayPort)

    browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1080 },
      colorScheme: 'light',
      deviceScaleFactor: 1,
    })

    await context.addInitScript(() => {
      window.localStorage.setItem('cc-gw-language', 'en')
      window.localStorage.setItem('cc-gw-theme', 'light')
    })

    const page = await context.newPage()
    const captures = [
      {
        name: 'dashboard-en-light.png',
        url: `http://127.0.0.1:${gatewayPort}/ui/`,
        heading: 'Dashboard',
      },
      {
        name: 'models-en-light.png',
        url: `http://127.0.0.1:${gatewayPort}/ui/models`,
        heading: 'Models & Routing',
      },
    ]

    for (const capture of captures) {
      await page.goto(capture.url)
      await waitForVisualReady(page, page.getByRole('heading', { name: capture.heading, level: 1 }))
      const screenshotPath = path.join(outputDir, capture.name)
      await page.screenshot({
        path: screenshotPath,
        fullPage: false,
      })
      console.log(`captured ${path.relative(projectRoot, screenshotPath)}`)
    }

    await context.close()
  } finally {
    if (browser) {
      await browser.close()
    }
    await stopGateway(gatewayProcess)
    if (stubServer) {
      await new Promise((resolve, reject) => {
        stubServer.close((error) => {
          if (error) reject(error)
          else resolve()
        })
      })
    }
    fs.rmSync(tempHome, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
