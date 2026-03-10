import http from 'node:http'
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

export interface GatewayHarness {
  tempHome: string
  gatewayPort: number
  stubPort: number
  gatewayProcess: ChildProcessWithoutNullStreams | null
  stubServer: http.Server | null
  start: () => Promise<void>
  stop: () => Promise<void>
  baseUrl: () => string
}

export interface GatewayHarnessOptions {
  auth?: {
    enabled: boolean
    username: string
    password: string
  }
}

async function findFreePort(): Promise<number> {
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

async function startStubProvider(port: number): Promise<http.Server> {
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

    const chunks: Buffer[] = []
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)))
    req.on('end', () => {
      let body: any = {}
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

  await new Promise<void>((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve())
  })

  return server
}

function createLegacyPasswordRecord(password: string): { passwordHash: string; passwordSalt: string } {
  const passwordSalt = crypto.randomBytes(16).toString('hex')
  const passwordHash = crypto
    .createHash('sha256')
    .update(passwordSalt, 'utf8')
    .update(password, 'utf8')
    .digest('hex')

  return { passwordHash, passwordSalt }
}

function writeConfig(
  tempHome: string,
  gatewayPort: number,
  stubPort: number,
  options: GatewayHarnessOptions = {}
): void {
  const configDir = path.join(tempHome, '.cc-gw')
  fs.mkdirSync(configDir, { recursive: true })
  const configPath = path.join(configDir, 'config.json')
  const baseDefaults = {
    completion: 'stub-model',
    reasoning: null,
    background: null,
    longContextThreshold: 60_000,
  }

  const authRecord = options.auth?.enabled ? createLegacyPasswordRecord(options.auth.password) : null

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
    requestLogging: false,
    responseLogging: false,
    webAuth: {
      enabled: options.auth?.enabled ?? false,
      username: options.auth?.enabled ? options.auth.username : '',
      passwordHash: authRecord?.passwordHash ?? '',
      passwordSalt: authRecord?.passwordSalt ?? '',
    },
  }

  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8')
}

async function waitForServer(port: number): Promise<void> {
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

async function startGateway(tempHome: string, gatewayPort: number): Promise<ChildProcessWithoutNullStreams> {
  const cliPath = path.join(process.cwd(), 'src/cli/dist/index.js')
  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(gatewayPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: tempHome,
      NODE_ENV: 'test',
    },
    stdio: 'pipe',
  })

  child.stdout.on('data', (chunk) => {
    process.stdout.write(`[gateway] ${chunk}`)
  })
  child.stderr.on('data', (chunk) => {
    process.stderr.write(`[gateway-err] ${chunk}`)
  })

  return child
}

export function createGatewayHarness(options: GatewayHarnessOptions = {}): GatewayHarness {
  const harness: GatewayHarness = {
    tempHome: '',
    gatewayPort: 0,
    stubPort: 0,
    gatewayProcess: null,
    stubServer: null,
    baseUrl: () => `http://127.0.0.1:${harness.gatewayPort}`,
    start: async () => {
      harness.stubPort = await findFreePort()
      harness.gatewayPort = await findFreePort()
      harness.tempHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-web-e2e-'))
      harness.stubServer = await startStubProvider(harness.stubPort)
      writeConfig(harness.tempHome, harness.gatewayPort, harness.stubPort, options)
      harness.gatewayProcess = await startGateway(harness.tempHome, harness.gatewayPort)
      await waitForServer(harness.gatewayPort)
    },
    stop: async () => {
      if (harness.gatewayProcess) {
        harness.gatewayProcess.kill('SIGINT')
        await new Promise<void>((resolve) => {
          harness.gatewayProcess?.once('exit', () => resolve())
          setTimeout(() => resolve(), 2_000)
        })
      }
      if (harness.stubServer) {
        await new Promise<void>((resolve) => harness.stubServer?.close(() => resolve()))
      }
      if (harness.tempHome && fs.existsSync(harness.tempHome)) {
        fs.rmSync(harness.tempHome, { recursive: true, force: true })
      }
    },
  }
  return harness
}
