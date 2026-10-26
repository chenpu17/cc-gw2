import { mkdtemp, readFile, rm } from 'node:fs/promises'
import fs from 'node:fs'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

function resolveBuiltServerBinary() {
  const executable = process.platform === 'win32' ? 'cc-gw-server.exe' : 'cc-gw-server'
  const candidates = [
    path.join(process.cwd(), 'target', 'release', executable),
    path.join(process.cwd(), 'target', 'debug', executable),
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close(() => reject(new Error('failed to allocate port')))
        return
      }
      const { port } = address
      server.close((error) => {
        if (error) reject(error)
        else resolve(port)
      })
    })
  })
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function getJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        if (response.statusCode !== 200) {
          reject(new Error(`unexpected status: ${response.statusCode}`))
          return
        }
        try {
          resolve(JSON.parse(body))
        } catch (error) {
          reject(error)
        }
      })
    })
    request.on('error', reject)
  })
}

async function waitForHealth(url, attempts = 50) {
  for (let index = 0; index < attempts; index += 1) {
    try {
      const body = await getJson(url)
      if (body && body.status === 'ok') {
        return body
      }
    } catch {}
    await wait(200)
  }
  throw new Error(`health check did not succeed: ${url}`)
}

/**
 * `cc-gw upgrade --check` must work offline against any registry base URL and
 * must not install anything. Exercised here because it is the only upgrade path
 * the release smoke test can safely run.
 */
async function verifyUpgradeCheck(homeDir, cliPath) {
  const registryPort = await getFreePort()
  const registry = http.createServer((request, response) => {
    if (request.url?.includes('cc-gw')) {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ 'dist-tags': { latest: '0.0.1' } }))
      return
    }
    response.statusCode = 404
    response.end()
  })
  await new Promise((resolve, reject) => {
    registry.once('error', reject)
    registry.listen(registryPort, '127.0.0.1', resolve)
  })

  try {
    const child = spawn(process.execPath, [cliPath, 'upgrade', '--check'], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        HOME: homeDir,
        CC_GW_VERSION_CHECK_REGISTRY_BASE_URL: `http://127.0.0.1:${registryPort}`,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    child.stdout.on('data', (chunk) => {
      output += chunk.toString()
    })
    child.stderr.on('data', (chunk) => {
      output += chunk.toString()
    })
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(code))
    })
    if (exitCode !== 0) {
      throw new Error(`upgrade --check exited with code ${exitCode}\n${output}`)
    }
    if (!output.includes('当前已是最新版本')) {
      throw new Error(`unexpected upgrade --check output:\n${output}`)
    }
  } finally {
    await new Promise((resolve) => registry.close(() => resolve()))
  }
}

async function main() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'cc-gw-smoke-'))
  const port = await getFreePort()
  const cliPath = path.join(process.cwd(), 'src/cli/dist/index.js')
  const serverBinary = resolveBuiltServerBinary()
  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
      ...(serverBinary ? { CC_GW_SERVER_BIN: serverBinary } : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  let stdout = ''
  let stderr = ''
  child.stdout.on('data', (chunk) => {
    const text = chunk.toString()
    stdout += text
    process.stdout.write(text)
  })
  child.stderr.on('data', (chunk) => {
    const text = chunk.toString()
    stderr += text
    process.stderr.write(text)
  })

  try {
    await waitForHealth(`http://127.0.0.1:${port}/health`)
    const configPath = path.join(homeDir, '.cc-gw', 'config.json')
    const config = JSON.parse(await readFile(configPath, 'utf8'))
    if (config?.port !== port) {
      throw new Error(`expected config port ${port}, got ${config?.port}`)
    }
    await verifyUpgradeCheck(homeDir, cliPath)
    child.kill('SIGINT')
    const exitCode = await new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('exit', (code) => resolve(code))
    })
    if (exitCode !== 0) {
      throw new Error(`cli exited with code ${exitCode}\nstdout:\n${stdout}\nstderr:\n${stderr}`)
    }
  } finally {
    if (!child.killed) {
      child.kill('SIGTERM')
    }
    await rm(homeDir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
