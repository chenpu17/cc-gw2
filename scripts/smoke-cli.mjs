import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

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

async function main() {
  const homeDir = await mkdtemp(path.join(os.tmpdir(), 'cc-gw-smoke-'))
  const port = await getFreePort()
  const cliPath = path.join(process.cwd(), 'src/cli/dist/index.js')
  const child = spawn(process.execPath, [cliPath, 'start', '--foreground', '--port', String(port)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      HOME: homeDir,
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
