import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test } from 'node:test'
import { runServerUpgrade } from './upgrade'

const FROM_VERSION = '1.2.3'
const TARGET_VERSION = '9.9.9'

interface Fixture {
  root: string
  homeDir: string
  cliPath: string
  nodeBin: string
  packageRoot: string
  stateFile: string
}

let fixture: Fixture | null = null

function createFixture(statePhase = 'preparing'): Fixture {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-gw-upgrade-test-'))
  const prefix = path.join(root, 'prefix')
  const binDir = path.join(prefix, 'bin')
  const npmBinDir = path.join(prefix, 'lib', 'node_modules', 'npm', 'bin')
  const packageRoot = path.join(prefix, 'lib', 'node_modules', '@chenpu17', 'cc-gw')
  const homeDir = path.join(root, 'home')
  fs.mkdirSync(binDir, { recursive: true })
  fs.mkdirSync(npmBinDir, { recursive: true })
  fs.mkdirSync(path.join(packageRoot, 'src', 'cli', 'dist'), { recursive: true })
  fs.mkdirSync(path.join(homeDir, 'logs'), { recursive: true })

  const cliPath = path.join(packageRoot, 'src', 'cli', 'dist', 'index.js')
  fs.writeFileSync(cliPath, '')
  fs.writeFileSync(
    path.join(packageRoot, 'package.json'),
    JSON.stringify({ name: '@chenpu17/cc-gw', version: FROM_VERSION })
  )

  // Make the temp prefix look like a real global npm install: node lives in
  // <prefix>/bin and npm's JS entry in <prefix>/lib/node_modules/npm.
  const nodeBin = path.join(binDir, 'node')
  fs.symlinkSync(process.execPath, nodeBin)
  fs.writeFileSync(
    path.join(npmBinDir, 'npm-cli.js'),
    `const fs = require('fs')
const path = require('path')
const args = process.argv.slice(2)
const spec = args[args.indexOf('-g') + 1] || ''
const version = spec.slice(spec.lastIndexOf('@') + 1)
if (version === process.env.FAKE_FAIL_VERSION) {
  console.error('simulated install failure')
  process.exit(1)
}
fs.writeFileSync(
  path.join(process.env.FAKE_PACKAGE_ROOT, 'package.json'),
  JSON.stringify({ name: '@chenpu17/cc-gw', version })
)
`
  )

  const stateFile = path.join(homeDir, 'upgrade-state.json')
  fs.writeFileSync(
    stateFile,
    JSON.stringify({
      id: 'test-upgrade',
      phase: statePhase,
      fromVersion: FROM_VERSION,
      toVersion: TARGET_VERSION,
      updatedAt: Date.now()
    })
  )

  fixture = { root, homeDir, cliPath, nodeBin, packageRoot, stateFile }
  delete process.env.CC_GW_INSTALL_METHOD
  process.env.FAKE_PACKAGE_ROOT = packageRoot
  return fixture
}

function runUpgrade(current: Fixture, overrides?: { id?: string; nodeBin?: string }) {
  return runServerUpgrade({
    cliPath: current.cliPath,
    nodeBin: overrides?.nodeBin ?? current.nodeBin,
    homeDir: current.homeDir,
    currentVersion: FROM_VERSION,
    targetVersion: TARGET_VERSION,
    fromVersion: FROM_VERSION,
    id: overrides?.id ?? 'test-upgrade',
    stateFile: current.stateFile,
    logFile: path.join(current.homeDir, 'logs', 'upgrade.log'),
    restart: true,
    rollback: true,
    packageName: '@chenpu17/cc-gw',
    registryBaseUrl: 'https://registry.example.test'
  })
}

function readState(current: Fixture) {
  return JSON.parse(fs.readFileSync(current.stateFile, 'utf8')) as {
    phase?: string
    rolledBack?: boolean
    error?: string | null
    toVersion?: string
  }
}

afterEach(() => {
  delete process.env.FAKE_FAIL_VERSION
  if (fixture) {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fixture = null
  }
})

test('server upgrade installs the target version and reports success', { skip: process.platform === 'win32' }, async () => {
  const current = createFixture()
  const exitCode = await runUpgrade(current)
  assert.equal(exitCode, 0)
  const state = readState(current)
  assert.equal(state.phase, 'succeeded')
  assert.equal(state.toVersion, TARGET_VERSION)
  const installed = JSON.parse(
    fs.readFileSync(path.join(current.packageRoot, 'package.json'), 'utf8')
  ) as { version?: string }
  assert.equal(installed.version, TARGET_VERSION)
})

test('failed install rolls back to the previous version and reports it', { skip: process.platform === 'win32' }, async () => {
  const current = createFixture()
  process.env.FAKE_FAIL_VERSION = TARGET_VERSION
  const exitCode = await runUpgrade(current)
  assert.equal(exitCode, 1)
  const state = readState(current)
  assert.equal(state.phase, 'failed')
  assert.equal(state.rolledBack, true)
  assert.match(state.error ?? '', /install failed/)
  const installed = JSON.parse(
    fs.readFileSync(path.join(current.packageRoot, 'package.json'), 'utf8')
  ) as { version?: string }
  assert.equal(installed.version, FROM_VERSION)
})

test('a helper that loses the lock race leaves the owner state untouched', { skip: process.platform === 'win32' }, async () => {
  const current = createFixture()
  fs.writeFileSync(
    path.join(current.homeDir, 'upgrade.lock'),
    JSON.stringify({ pid: process.pid, startedAt: Date.now() })
  )
  const exitCode = await runUpgrade(current)
  assert.equal(exitCode, 1)
  const state = readState(current)
  assert.equal(state.phase, 'preparing')
  assert.equal(state.rolledBack, undefined)
})

test('a spawn failure is reported instead of waiting for an install timeout', { skip: process.platform === 'win32' }, async () => {
  const current = createFixture()
  const missingNode = path.join(path.dirname(current.nodeBin), 'missing-node')
  const exitCode = await runUpgrade(current, { nodeBin: missingNode })
  assert.equal(exitCode, 1)
  const state = readState(current)
  assert.equal(state.phase, 'failed')
  assert.equal(state.rolledBack, false)
  // ENOENT/EACCES must surface, not a misleading "install timed out".
  assert.match(state.error ?? '', /ENOENT|spawn/i)
})
