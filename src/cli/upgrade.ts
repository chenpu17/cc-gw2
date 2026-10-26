import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

/**
 * Manual / self-upgrade engine.
 *
 * `cc-gw upgrade` runs this from a terminal; the running gateway also spawns
 * it (`--from-server`) when the user confirms an upgrade in the Web UI. The
 * helper must outlive the server it is upgrading, so it never assumes the
 * gateway process is its parent.
 */

const DEFAULT_PACKAGE_NAME = '@chenpu17/cc-gw'
const DEFAULT_REGISTRY = 'https://registry.npmjs.org'
const GLOBAL_METHODS = new Set(['npm-global', 'pnpm-global', 'yarn-global', 'bun-global'])

export type InstallMethod =
  | 'npm-global'
  | 'pnpm-global'
  | 'yarn-global'
  | 'bun-global'
  | 'npx'
  | 'local'
  | 'unknown'

export interface InstallContext {
  cliPath: string
  nodeBin: string
  packageRoot: string
  method: InstallMethod
  writable: boolean
  npmCliPath: string | null
}

export interface UpgradeBaseOptions {
  cliPath: string
  nodeBin: string
  homeDir: string
  packageName?: string
  registryBaseUrl?: string
  currentVersion: string
  log?: (line: string) => void
}

export interface ManualUpgradeOptions extends UpgradeBaseOptions {
  targetVersion?: string
  checkOnly: boolean
  assumeYes: boolean
  restart: boolean
  rollback: boolean
}

export interface ServerUpgradeOptions extends UpgradeBaseOptions {
  targetVersion: string
  fromVersion: string
  id: string
  stateFile: string
  logFile: string
  restart: boolean
  rollback: boolean
  /** PID of the gateway that spawned this helper (authoritative over cc-gw.pid). */
  serverPid?: number
  /** Port the gateway is listening on; reused when restarting it. */
  port?: number
  protocol?: 'http' | 'https'
}

export interface UpgradeState {
  id?: string
  phase?: string
  fromVersion?: string
  toVersion?: string
  startedAt?: number
  updatedAt?: number
  finishedAt?: number | null
  error?: string | null
  rolledBack?: boolean
  platform?: string
  installMethod?: string | null
  logPath?: string | null
  serverPid?: number
  instanceToken?: string
  pid?: number
  [key: string]: unknown
}

interface RegistryInfo {
  currentVersion: string
  latestVersion: string
  channel: string
  packageName: string
  publishedAt: string | null
}

interface Logger {
  line: (message: string) => void
  raw: (chunk: string) => void
  close: () => Promise<void>
}

function createLogger(logFile?: string): Logger {
  const stream = logFile
    ? fs.createWriteStream(logFile, { flags: 'a' })
    : null
  let streamFailed = false
  // Without an error listener an unwritable log file (EACCES/ENOSPC) throws an
  // uncaught event and kills the helper mid-upgrade.
  stream?.on('error', (error) => {
    streamFailed = true
    process.stderr.write(`[cc-gw] upgrade log write failed: ${error.message}\n`)
  })
  const write = (text: string) => {
    if (stream && !streamFailed) {
      stream.write(text)
    } else {
      process.stdout.write(text)
    }
  }
  return {
    line: (message: string) => write(`[${new Date().toISOString()}] ${message}\n`),
    raw: write,
    close: () =>
      new Promise<void>((resolve) => {
        if (!stream || streamFailed) {
          resolve()
          return
        }
        stream.end(resolve)
      })
  }
}

export function resolveHomeDir(): string {
  const override = process.env.CC_GW_HOME?.trim()
  return override ? override : path.join(os.homedir(), '.cc-gw')
}

export function resolvePackageName(explicit?: string): string {
  return explicit?.trim() || process.env.CC_GW_VERSION_CHECK_PACKAGE_NAME?.trim() || DEFAULT_PACKAGE_NAME
}

export function resolveRegistryBase(): string {
  const override = process.env.CC_GW_VERSION_CHECK_REGISTRY_BASE_URL?.trim()
  return (override || DEFAULT_REGISTRY).replace(/\/+$/, '')
}

function resolveNpmCliPath(nodeBin: string): string | null {
  const dir = path.dirname(nodeBin)
  const candidates = process.platform === 'win32'
    ? [
        path.join(dir, 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      ]
    : [
        path.join(dir, '..', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js'),
        path.join(dir, '..', 'libexec', 'lib', 'node_modules', 'npm', 'bin', 'npm-cli.js')
      ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return path.resolve(candidate)
    }
  }
  return null
}

function npmGlobalRoot(nodeBin: string): string | null {
  const dir = path.dirname(nodeBin)
  const candidate = process.platform === 'win32'
    ? path.join(dir, 'node_modules')
    : path.join(dir, '..', 'lib', 'node_modules')
  return path.resolve(candidate)
}

/**
 * Candidate node_modules directories that can hold npm globals. The node
 * binary's own prefix covers Homebrew/nvm; the extra entries cover Windows
 * (`%APPDATA%\npm`) and distro packages where node lives under /usr but npm's
 * global prefix is /usr/local, plus any explicit `npm_config_prefix`.
 */
function npmGlobalRoots(nodeBin: string): string[] {
  const roots = new Set<string>()
  const nodeRoot = npmGlobalRoot(nodeBin)
  if (nodeRoot) {
    roots.add(nodeRoot)
  }
  const configuredPrefix = process.env.npm_config_prefix?.trim() || process.env.NPM_CONFIG_PREFIX?.trim()
  if (configuredPrefix) {
    roots.add(path.resolve(configuredPrefix, 'node_modules'))
  }
  if (process.platform === 'win32') {
    for (const key of ['APPDATA', 'LOCALAPPDATA']) {
      const base = process.env[key]?.trim()
      if (base) {
        roots.add(path.resolve(base, 'npm', 'node_modules'))
      }
    }
  } else {
    // Distro packages put node under /usr while npm's prefix stays /usr/local;
    // Homebrew (Apple Silicon and Linuxbrew) keeps globals outside the versioned
    // Cellar directory that process.execPath resolves to.
    roots.add('/usr/local/lib/node_modules')
    roots.add('/opt/homebrew/lib/node_modules')
    roots.add('/home/linuxbrew/.linuxbrew/lib/node_modules')
  }
  return [...roots]
}

function isWritable(target: string): boolean {
  try {
    fs.accessSync(target, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Classify how this CLI copy was installed from its own path. Pure filesystem
 * inspection: no package-manager invocation, so calling it on every `start`
 * stays cheap and never blocks startup.
 */
export function detectInstallContext(cliPath: string, nodeBin = process.execPath): InstallContext {
  const packageRoot = path.resolve(path.dirname(cliPath), '../../..')
  const parentNodeModules = path.resolve(packageRoot, '../..')
  const npmRoots = npmGlobalRoots(nodeBin)
  const npmCliPath = resolveNpmCliPath(nodeBin)
  const normalizedRoot = packageRoot.split(path.sep).join('/')

  let method: InstallMethod = 'unknown'
  if (/\/_npx\/|\/\.npm\/_npx\//.test(normalizedRoot)) {
    method = 'npx'
  } else if (/\/pnpm\/global\//.test(normalizedRoot) || /\/\.pnpm\/global\//.test(normalizedRoot)) {
    method = 'pnpm-global'
  } else if (/\/yarn\/global\//.test(normalizedRoot) || /\/\.yarn\/global\//.test(normalizedRoot)) {
    method = 'yarn-global'
  } else if (/\/\.bun\/install\/global\//.test(normalizedRoot) || /\/bun\/install\/global\//.test(normalizedRoot)) {
    method = 'bun-global'
  } else if (npmRoots.includes(parentNodeModules)) {
    method = 'npm-global'
  } else if (packageRoot.includes(`${path.sep}node_modules${path.sep}`)) {
    method = 'local'
  }

  const envMethod = process.env.CC_GW_INSTALL_METHOD?.trim()
  if (envMethod && (GLOBAL_METHODS.has(envMethod) || ['npx', 'local', 'unknown'].includes(envMethod))) {
    method = envMethod as InstallMethod
  }

  const writableTarget = GLOBAL_METHODS.has(method) ? parentNodeModules : packageRoot
  return {
    cliPath,
    nodeBin,
    packageRoot,
    method,
    writable: isWritable(writableTarget),
    npmCliPath
  }
}

export function isAutoUpgradeSupported(context: InstallContext): boolean {
  if (!GLOBAL_METHODS.has(context.method) || !context.writable) {
    return false
  }
  // On Windows only npm exposes a JS entry (npm-cli.js) we can run with node;
  // spawning a .cmd/.bat shim for pnpm/yarn/bun fails with EINVAL/ENOENT.
  if (process.platform === 'win32') {
    return context.method === 'npm-global' && Boolean(context.npmCliPath)
  }
  return true
}

export function manualInstallCommand(
  method: InstallMethod,
  packageName: string,
  target = 'latest',
  sudo = false
): string {
  const prefix = sudo ? 'sudo ' : ''
  switch (method) {
    case 'pnpm-global':
      return `${prefix}pnpm add -g ${packageName}@${target}`
    case 'yarn-global':
      return `${prefix}yarn global add ${packageName}@${target}`
    case 'bun-global':
      return `${prefix}bun add -g ${packageName}@${target}`
    default:
      return `${prefix}npm install -g ${packageName}@${target}`
  }
}

function parseVersion(version: string): { numbers: number[]; prerelease: string[] } | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(version.trim())
  if (!match) {
    return null
  }
  return {
    numbers: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4] ? match[4].split('.') : []
  }
}

export function compareVersions(left: string, right: string): number {
  const a = parseVersion(left)
  const b = parseVersion(right)
  if (!a || !b) {
    return left === right ? 0 : left.localeCompare(right)
  }
  for (let index = 0; index < 3; index += 1) {
    if (a.numbers[index] !== b.numbers[index]) {
      return a.numbers[index] > b.numbers[index] ? 1 : -1
    }
  }
  if (a.prerelease.length === 0 && b.prerelease.length > 0) {
    return 1
  }
  if (b.prerelease.length === 0 && a.prerelease.length > 0) {
    return -1
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index]
    const rightPart = b.prerelease[index]
    if (leftPart === undefined) {
      return -1
    }
    if (rightPart === undefined) {
      return 1
    }
    const leftNumber = /^\d+$/.test(leftPart) ? Number(leftPart) : null
    const rightNumber = /^\d+$/.test(rightPart) ? Number(rightPart) : null
    if (leftNumber !== null && rightNumber !== null) {
      if (leftNumber !== rightNumber) {
        return leftNumber > rightNumber ? 1 : -1
      }
      continue
    }
    if (leftNumber !== null) {
      return -1
    }
    if (rightNumber !== null) {
      return 1
    }
    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1
    }
  }
  return 0
}

export function updateChannelForVersion(version: string): string {
  const identifier = parseVersion(version)?.prerelease[0]
  return identifier === 'alpha' || identifier === 'beta' || identifier === 'rc' ? identifier : 'latest'
}

async function fetchRegistryInfo(
  currentVersion: string,
  packageName: string,
  registryBase: string
): Promise<RegistryInfo> {
  const encoded = packageName.replace('@', '%40').replace('/', '%2F')
  const url = `${registryBase}/${encoded}`
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(10_000)
  })
  if (!response.ok) {
    throw new Error(`npm registry returned ${response.status}`)
  }
  const payload = await response.json() as {
    'dist-tags'?: Record<string, string>
    time?: Record<string, string>
  }
  const channel = updateChannelForVersion(currentVersion)
  const distTags = payload['dist-tags'] ?? {}
  const latestVersion = distTags[channel] ?? distTags.latest
  if (!latestVersion) {
    throw new Error(`npm dist-tag "${channel}" not found`)
  }
  return {
    currentVersion,
    latestVersion,
    channel,
    packageName,
    publishedAt: payload.time?.[latestVersion] ?? null
  }
}

function buildInstallCommand(
  context: InstallContext,
  packageName: string,
  targetVersion: string,
  registryBase: string
): { command: string; args: string[]; shell?: boolean } {
  const spec = `${packageName}@${targetVersion}`
  const registryArgs = registryBase !== DEFAULT_REGISTRY ? ['--registry', registryBase] : []
  switch (context.method) {
    case 'pnpm-global':
      return { command: 'pnpm', args: ['add', '-g', spec, ...registryArgs] }
    case 'yarn-global':
      return { command: 'yarn', args: ['global', 'add', spec, ...registryArgs] }
    case 'bun-global':
      return { command: 'bun', args: ['add', '-g', spec, ...registryArgs] }
    case 'npm-global':
    default: {
      const npmArgs = [
        'install',
        '-g',
        spec,
        '--no-fund',
        '--no-audit',
        '--loglevel=error',
        '--ignore-scripts',
        ...registryArgs
      ]
      if (context.npmCliPath) {
        return { command: context.nodeBin, args: [context.npmCliPath, ...npmArgs] }
      }
      if (process.platform === 'win32') {
        // Node refuses to spawn .cmd shims directly. Route through cmd.exe with
        // every argument validated/quoted so the spec cannot inject shell syntax.
        assertSafeInstallArgs(packageName, targetVersion, registryBase)
        const line = ['npm', ...npmArgs].map(quoteCmdArg).join(' ')
        return { command: process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', line] }
      }
      return { command: 'npm', args: npmArgs }
    }
  }
}

function assertSafeInstallArgs(
  packageName: string,
  targetVersion: string,
  registryBase: string
): void {
  if (!/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(packageName)) {
    throw new Error(`refusing to install invalid package name: ${packageName}`)
  }
  if (!/^[0-9a-z.+_-]+$/i.test(targetVersion)) {
    throw new Error(`refusing to install invalid version spec: ${targetVersion}`)
  }
  if (!/^https?:\/\/[a-z0-9.:/_-]+$/i.test(registryBase)) {
    throw new Error(`refusing to use invalid registry: ${registryBase}`)
  }
}

function quoteCmdArg(value: string): string {
  return `"${value.replace(/"/g, '""')}"`
}

/**
 * Read the on-disk package version after an install. Returns null when the
 * package layout is not what we expect (e.g. a source checkout); callers only
 * enforce the check when a version is readable.
 */
function readInstalledVersion(context: InstallContext): string | null {
  try {
    const payload = JSON.parse(
      fs.readFileSync(path.join(context.packageRoot, 'package.json'), 'utf8')
    ) as { version?: unknown }
    return typeof payload.version === 'string' ? payload.version : null
  } catch {
    return null
  }
}

function verifyInstalledVersion(
  context: InstallContext,
  expectedVersion: string,
  logger: Logger
): void {
  if (!parseVersion(expectedVersion)) {
    return
  }
  const actual = readInstalledVersion(context)
  if (!actual) {
    logger.line('warning: could not read the installed package version')
    return
  }
  if (compareVersions(actual, expectedVersion) !== 0) {
    throw new Error(`installed version ${actual} does not match requested ${expectedVersion}`)
  }
}

function waitForProcess(child: ChildProcess, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {}
      resolve(null)
    }, timeoutMs)
    // Surface ENOENT/EACCES/EINVAL instead of reporting a misleading timeout.
    child.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve(code)
    })
  })
}

async function runInstall(
  context: InstallContext,
  packageName: string,
  targetVersion: string,
  registryBase: string,
  homeDir: string,
  logger: Logger
): Promise<void> {
  const { command, args } = buildInstallCommand(context, packageName, targetVersion, registryBase)
  logger.line(`installing ${packageName}@${targetVersion} via ${context.method}`)
  logger.line(`$ ${command} ${args.join(' ')}`)
  const child = spawn(command, args, {
    cwd: homeDir,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, npm_config_yes: 'true' }
  })
  child.stdout?.on('data', (chunk) => logger.raw(String(chunk)))
  child.stderr?.on('data', (chunk) => logger.raw(String(chunk)))
  const exitCode = await waitForProcess(child, 10 * 60 * 1000)
  if (exitCode !== 0) {
    throw new Error(exitCode === null ? 'install timed out' : `install exited with code ${exitCode}`)
  }
  logger.line(`installed ${packageName}@${targetVersion}`)
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM'
  }
}

function readPidFile(homeDir: string): number | null {
  try {
    const raw = fs.readFileSync(path.join(homeDir, 'cc-gw.pid'), 'utf8').trim()
    const pid = Number.parseInt(raw, 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function removePidFile(homeDir: string): void {
  try {
    fs.unlinkSync(path.join(homeDir, 'cc-gw.pid'))
  } catch {}
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Best-effort identity check before signalling a PID taken from a file: a stale
 * `cc-gw.pid` whose PID was reused would otherwise make the helper SIGTERM an
 * unrelated process. When the command line cannot be inspected (Windows, no
 * `ps`) keep the previous behavior so a real gateway is still stopped.
 */
function processLooksLikeGateway(pid: number): boolean {
  if (process.platform === 'win32') {
    return true
  }
  try {
    const output = execFileSync('ps', ['-p', String(pid), '-o', 'command='], {
      encoding: 'utf8',
      timeout: 2_000,
      stdio: ['ignore', 'pipe', 'ignore']
    })
    return /cc-gw-server/i.test(output)
  } catch {
    return true
  }
}

function resolveServicePid(homeDir: string, serverPid?: number): number | null {
  // The gateway passed its own PID; us trusting it is not the same as trusting
  // a file that any crashed run may have left behind.
  if (serverPid && isProcessAlive(serverPid)) {
    return serverPid
  }
  const pid = readPidFile(homeDir)
  if (pid === null || !isProcessAlive(pid) || !processLooksLikeGateway(pid)) {
    return null
  }
  return pid
}

function isServiceRunning(homeDir: string, serverPid?: number): boolean {
  return resolveServicePid(homeDir, serverPid) !== null
}

async function waitForExit(pid: number, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!isProcessAlive(pid)) {
      return true
    }
    await sleep(200)
  }
  return !isProcessAlive(pid)
}

async function stopService(
  homeDir: string,
  timeoutMs: number,
  logger: Logger,
  serverPid?: number
): Promise<void> {
  const pid = resolveServicePid(homeDir, serverPid)
  if (!pid) {
    removePidFile(homeDir)
    return
  }
  logger.line(`waiting for gateway pid ${pid} to exit`)
  if (await waitForExit(pid, timeoutMs)) {
    logger.line('gateway stopped')
    removePidFile(homeDir)
    return
  }
  logger.line('gateway did not exit in time; sending SIGTERM')
  try {
    process.kill(pid, 'SIGTERM')
  } catch {}
  if (await waitForExit(pid, 5_000)) {
    logger.line('gateway stopped after SIGTERM')
    removePidFile(homeDir)
    return
  }
  logger.line('gateway still alive; sending SIGKILL')
  try {
    process.kill(pid, 'SIGKILL')
  } catch {}
  await waitForExit(pid, 5_000)
  removePidFile(homeDir)
}

interface ProbeTarget {
  protocol: 'http' | 'https'
  host: string
  port: number
}

interface ProbeOverride {
  port?: number
  protocol?: 'http' | 'https'
}

function resolveProbeTarget(homeDir: string, override: ProbeOverride = {}): ProbeTarget {
  let config: Record<string, unknown> = {}
  try {
    config = JSON.parse(fs.readFileSync(path.join(homeDir, 'config.json'), 'utf8')) as Record<string, unknown>
  } catch {}

  const httpConfig = (config.http ?? {}) as Record<string, unknown>
  const httpsConfig = (config.https ?? {}) as Record<string, unknown>
  const portOverride = Number.parseInt(process.env.PORT ?? '', 10)
  const httpEnabled = httpConfig.enabled !== false
  const useHttps = override.protocol
    ? override.protocol === 'https'
    : !httpEnabled && httpsConfig.enabled === true
  const overridePort =
    typeof override.port === 'number' && Number.isFinite(override.port) && override.port > 0
      ? override.port
      : null

  const pickHost = (value: unknown, fallback: string): string => {
    const host = typeof value === 'string' ? value.trim() : ''
    if (!host || host === '0.0.0.0' || host === '::' || host === '[::]') {
      return fallback
    }
    return host
  }

  if (useHttps) {
    const port = overridePort ?? (Number(httpsConfig.port) || 4443)
    return {
      protocol: 'https',
      host: pickHost(httpsConfig.host, '127.0.0.1'),
      port
    }
  }

  const configuredPort = Number(config.port) || Number(httpConfig.port) || 4100
  return {
    protocol: 'http',
    host: pickHost(httpConfig.host ?? config.host, '127.0.0.1'),
    port: overridePort ?? (Number.isFinite(portOverride) ? portOverride : configuredPort)
  }
}

function probeHealth(
  target: ProbeTarget,
  timeoutMs = 1500
): Promise<{ status: string; version?: string } | null> {
  return new Promise((resolve) => {
    const requestOptions: https.RequestOptions = {
      host: target.host,
      port: target.port,
      path: '/health',
      timeout: timeoutMs,
      rejectUnauthorized: false
    }
    const transport = target.protocol === 'https' ? https : http
    const request = transport.get(requestOptions, (response) => {
      let body = ''
      response.setEncoding('utf8')
      response.on('data', (chunk) => {
        body += chunk
      })
      response.on('end', () => {
        try {
          const parsed = JSON.parse(body) as { status?: string; version?: string }
          resolve({ status: parsed.status ?? '', version: parsed.version })
        } catch {
          resolve(null)
        }
      })
    })
    request.on('timeout', () => {
      request.destroy()
      resolve(null)
    })
    request.on('error', () => resolve(null))
  })
}

async function waitForVersion(
  target: ProbeTarget,
  expectedVersion: string | null,
  timeoutMs: number
): Promise<string | null> {
  // `--target latest`/`beta` are valid npm specs but never equal the semver
  // reported by /health; only enforce a comparison when we know the version.
  const expected =
    expectedVersion && parseVersion(expectedVersion) ? expectedVersion : null
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const health = await probeHealth(target)
    if (
      health?.status === 'ok' &&
      (!expected || (health.version && compareVersions(health.version, expected) === 0))
    ) {
      return health.version ?? ''
    }
    await sleep(500)
  }
  return null
}

function spawnWithLogging(
  command: string,
  args: string[],
  cwd: string,
  logger: Logger
): ChildProcess {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, CC_GW_HOME: cwd },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  child.stdout?.on('data', (chunk) => logger.raw(String(chunk)))
  child.stderr?.on('data', (chunk) => logger.raw(String(chunk)))
  return child
}

async function startService(
  context: InstallContext,
  homeDir: string,
  logger: Logger,
  port?: number
): Promise<void> {
  // A gateway started with `cc-gw start --port 5000` does not persist that
  // override to config.json; without passing it back the restart silently moves
  // the service. The server passes its bound port to the helper.
  const args = [context.cliPath, 'start', '--daemon']
  if (port && Number.isFinite(port)) {
    args.push('--port', String(port))
  }
  logger.line(`starting gateway via cc-gw start --daemon${port ? ` --port ${port}` : ''}`)
  const child = spawnWithLogging(context.nodeBin, args, homeDir, logger)
  const exitCode = await waitForProcess(child, 60_000)
  if (exitCode !== 0) {
    throw new Error(exitCode === null ? 'cc-gw start timed out' : `cc-gw start exited with code ${exitCode}`)
  }
}

export function readUpgradeState(stateFile: string): UpgradeState | null {
  try {
    return JSON.parse(fs.readFileSync(stateFile, 'utf8')) as UpgradeState
  } catch {
    return null
  }
}

export function writeUpgradeState(stateFile: string, state: UpgradeState): void {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const tmp = `${stateFile}.${process.pid}.tmp`
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, 'utf8')
  fs.renameSync(tmp, stateFile)
}

export function updateUpgradeState(stateFile: string, patch: UpgradeState): UpgradeState {
  const current = readUpgradeState(stateFile) ?? {}
  const next: UpgradeState = {
    ...current,
    ...patch,
    updatedAt: Date.now()
  }
  writeUpgradeState(stateFile, next)
  return next
}

function acquireLock(homeDir: string): () => void {
  const lockPath = path.join(homeDir, 'upgrade.lock')
  fs.mkdirSync(homeDir, { recursive: true })
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, startedAt: Date.now() }), { flag: 'wx' })
      return () => {
        try {
          fs.unlinkSync(lockPath)
        } catch {}
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
      let stale = false
      try {
        const payload = JSON.parse(fs.readFileSync(lockPath, 'utf8')) as { pid?: number }
        stale = !payload.pid || !isProcessAlive(payload.pid)
      } catch {
        stale = true
      }
      if (!stale) {
        throw new Error('another cc-gw upgrade is already running')
      }
      try {
        fs.unlinkSync(lockPath)
      } catch {}
    }
  }
  throw new Error('failed to acquire upgrade lock')
}

interface UpgradeRunOptions {
  context: InstallContext
  packageName: string
  registryBase: string
  homeDir: string
  fromVersion: string
  targetVersion: string
  restart: boolean
  rollback: boolean
  stateFile: string
  logPath: string | null
  logger: Logger
  serverPid?: number
  port?: number
  protocol?: 'http' | 'https'
}

async function performUpgrade(options: UpgradeRunOptions): Promise<void> {
  const {
    context,
    homeDir,
    logger,
    stateFile,
    targetVersion,
    fromVersion,
    packageName,
    registryBase
  } = options
  const target = resolveProbeTarget(homeDir, { port: options.port, protocol: options.protocol })
  const restartAfterInstall = options.restart && isServiceRunning(homeDir, options.serverPid)
  let installedNew = false
  let serviceStopped = false

  // The server treats a state that has not changed for ten minutes as stale
  // (an install may legitimately take that long). Refresh `updatedAt` so a live
  // upgrade is never mistaken for a crashed one and a second helper is started.
  const heartbeat = setInterval(() => {
    const current = readUpgradeState(stateFile)
    if (!current || current.phase === 'succeeded' || current.phase === 'failed') {
      return
    }
    try {
      writeUpgradeState(stateFile, { ...current, updatedAt: Date.now() })
    } catch {}
  }, 30_000)
  heartbeat.unref()

  // Ctrl-C/terminal close/exit during the window in which the service is
  // stopped would leave nothing running. Restart it before exiting.
  const signalHandler = (signal: NodeJS.Signals) => {
    clearInterval(heartbeat)
    logger.line(`received ${signal}`)
    const current = readUpgradeState(stateFile)
    if (current && current.phase !== 'succeeded' && current.phase !== 'failed') {
      try {
        updateUpgradeState(stateFile, {
          phase: 'failed',
          error: `upgrade interrupted by ${signal}`,
          finishedAt: Date.now()
        })
      } catch {}
    }
    const finish = () => process.exit(signal === 'SIGINT' ? 130 : 143)
    if (!serviceStopped) {
      finish()
      return
    }
    logger.line('restarting the gateway after the interrupted upgrade')
    startService(context, homeDir, logger, options.port).then(finish, finish)
  }
  process.once('SIGINT', signalHandler)
  process.once('SIGTERM', signalHandler)

  try {
    /**
     * Restore the previous version. `restartService` is true whenever the service
     * currently running is (or may be) the new version: in that case it must be
     * stopped before the old package is reinstalled and then started again.
     */
    const rollback = async (message: string, restartService: boolean): Promise<never> => {
      let rolledBack = false
      if (options.rollback) {
        logger.line(`upgrade failed: ${message}; attempting rollback to ${fromVersion}`)
        if (restartService) {
          // stopService is a no-op when nothing is running; call it regardless so
          // a new process without a readable pid file cannot keep serving while
          // the old package is restored underneath it.
          updateUpgradeState(stateFile, { phase: 'draining' })
          await stopService(homeDir, 30_000, logger, options.serverPid)
          serviceStopped = true
        }
        try {
          await runInstall(context, packageName, fromVersion, registryBase, homeDir, logger)
          verifyInstalledVersion(context, fromVersion, logger)
          rolledBack = true
        } catch (rollbackError) {
          logger.line(`rollback install failed: ${(rollbackError as Error).message}`)
        }
        if (rolledBack && restartService) {
          try {
            await startService(context, homeDir, logger, options.port)
            serviceStopped = false
          } catch (startError) {
            logger.line(`rollback start failed: ${(startError as Error).message}`)
            rolledBack = false
          }
        }
        // Don't claim a rollback if the service still reports the new version.
        if (rolledBack && isServiceRunning(homeDir, options.serverPid)) {
          const version = await waitForVersion(target, fromVersion, 30_000)
          if (!version) {
            logger.line(`rollback health check did not confirm ${fromVersion}`)
            rolledBack = false
          }
        }
      }
      updateUpgradeState(stateFile, {
        phase: 'failed',
        error: message,
        rolledBack,
        finishedAt: Date.now()
      })
      throw new Error(message)
    }

    updateUpgradeState(stateFile, {
      phase: 'installing',
      installMethod: context.method,
      platform: `${process.platform}-${process.arch}`,
      logPath: options.logPath
    })

    const installFirst = process.platform !== 'win32'

    if (installFirst) {
      try {
        await runInstall(context, packageName, targetVersion, registryBase, homeDir, logger)
        verifyInstalledVersion(context, targetVersion, logger)
        installedNew = true
      } catch (error) {
        // The old service was never stopped, so a failed install leaves it untouched.
        await rollback(`install failed: ${(error as Error).message}`, false)
      }
    }

    if (restartAfterInstall) {
      updateUpgradeState(stateFile, { phase: 'draining' })
      await stopService(homeDir, 30_000, logger, options.serverPid)
      serviceStopped = true
    }

    if (!installFirst) {
      try {
        await runInstall(context, packageName, targetVersion, registryBase, homeDir, logger)
        verifyInstalledVersion(context, targetVersion, logger)
        installedNew = true
      } catch (error) {
        await rollback(`install failed: ${(error as Error).message}`, restartAfterInstall)
      }
    }

    if (!restartAfterInstall) {
      updateUpgradeState(stateFile, { phase: 'succeeded', finishedAt: Date.now(), error: null })
      return
    }

    updateUpgradeState(stateFile, { phase: 'starting' })
    try {
      await startService(context, homeDir, logger, options.port)
      serviceStopped = false
    } catch (error) {
      await rollback(`start failed: ${(error as Error).message}`, true)
    }

    updateUpgradeState(stateFile, { phase: 'verifying' })
    const version = await waitForVersion(target, targetVersion, 40_000)
    if (!version) {
      await rollback(
        installedNew
          ? 'new version did not become healthy'
          : 'gateway did not become healthy',
        true
      )
    }

    logger.line(`upgrade succeeded: ${fromVersion} -> ${version}`)
    updateUpgradeState(stateFile, { phase: 'succeeded', finishedAt: Date.now(), error: null })
  } finally {
    clearInterval(heartbeat)
    process.removeListener('SIGINT', signalHandler)
    process.removeListener('SIGTERM', signalHandler)
  }
}

export async function runServerUpgrade(options: ServerUpgradeOptions): Promise<number> {
  const context = detectInstallContext(options.cliPath, options.nodeBin)
  if (!isAutoUpgradeSupported(context)) {
    throw new Error(
      `self-upgrade is not supported for this installation (${context.method}${context.writable ? '' : ', not writable'})`
    )
  }
  const logger = createLogger(options.logFile)
  let releaseLock: (() => void) | null = null
  let ownsLock = false
  try {
    releaseLock = acquireLock(options.homeDir)
    ownsLock = true
    const state = readUpgradeState(options.stateFile) ?? {}
    writeUpgradeState(options.stateFile, {
      ...state,
      id: options.id,
      phase: 'preparing',
      fromVersion: options.fromVersion,
      toVersion: options.targetVersion,
      startedAt: state.startedAt ?? Date.now(),
      updatedAt: Date.now(),
      finishedAt: null,
      error: null,
      rolledBack: false,
      installMethod: context.method,
      platform: `${process.platform}-${process.arch}`,
      logPath: options.logFile,
      pid: process.pid
    })
    await performUpgrade({
      context,
      packageName: resolvePackageName(options.packageName),
      registryBase: options.registryBaseUrl ?? resolveRegistryBase(),
      homeDir: options.homeDir,
      fromVersion: options.fromVersion,
      targetVersion: options.targetVersion,
      restart: options.restart,
      rollback: options.rollback,
      stateFile: options.stateFile,
      logPath: options.logFile,
      logger,
      serverPid: options.serverPid,
      port: options.port,
      protocol: options.protocol
    })
    return 0
  } catch (error) {
    logger.line(`upgrade failed: ${(error as Error).message}`)
    // A helper that lost the lock race does not own the run: the server may
    // already have written this id into the state file, so matching ids alone
    // are not enough, and reporting failure here would clobber the winner.
    if (ownsLock) {
      const state = readUpgradeState(options.stateFile)
      if (state?.id === options.id && state.phase !== 'failed') {
        updateUpgradeState(options.stateFile, {
          phase: 'failed',
          error: (error as Error).message,
          finishedAt: Date.now()
        })
      }
    }
    return 1
  } finally {
    releaseLock?.()
    await logger.close()
  }
}

export async function runManualUpgrade(options: ManualUpgradeOptions): Promise<number> {
  const packageName = resolvePackageName(options.packageName)
  const registryBase = options.registryBaseUrl ?? resolveRegistryBase()
  const context = detectInstallContext(options.cliPath, options.nodeBin)
  const print = options.log ?? ((line: string) => process.stdout.write(`${line}\n`))

  try {
    const registry = await fetchRegistryInfo(options.currentVersion, packageName, registryBase)
    const targetVersion = options.targetVersion ?? registry.latestVersion
    const newer = compareVersions(targetVersion, registry.currentVersion) > 0
    if (options.checkOnly) {
      print(
        newer
          ? `有新版本可用: ${registry.currentVersion} -> ${targetVersion} (${registry.channel})`
          : `当前已是最新版本: ${registry.currentVersion} (${registry.channel})`
      )
      return 0
    }
    if (!newer) {
      print(`当前已是最新版本: ${registry.currentVersion} (${registry.channel})`)
      return 0
    }
    if (!isAutoUpgradeSupported(context)) {
      print('当前安装方式不支持自动升级，请手动执行：')
      print(`  ${manualInstallCommand(context.method, packageName, targetVersion, !context.writable)}`)
      print('  cc-gw restart')
      return 1
    }
    if (!options.assumeYes) {
      if (!process.stdin.isTTY) {
        print('当前终端非交互，请加 --yes 确认升级')
        return 1
      }
      const confirmed = await confirmPrompt(
        `升级 cc-gw ${registry.currentVersion} -> ${targetVersion}？升级过程中服务会短暂中断 [y/N] `
      )
      if (!confirmed) {
        print('已取消')
        return 1
      }
    }

    const homeDir = options.homeDir
    const stateFile = path.join(homeDir, 'upgrade-state.json')
    const releaseLock = acquireLock(homeDir)
    try {
      const previous = readUpgradeState(stateFile)
      if (previous && !['succeeded', 'failed', 'idle'].includes(previous.phase ?? 'idle')) {
        const updatedAt = Number(previous.updatedAt ?? 0)
        if (Date.now() - updatedAt < 10 * 60 * 1000) {
          throw new Error('另一个升级任务正在进行中')
        }
      }
      const id = `${Date.now()}-${process.pid}`
      const running = isServiceRunning(homeDir)
      writeUpgradeState(stateFile, {
        id,
        phase: 'preparing',
        fromVersion: registry.currentVersion,
        toVersion: targetVersion,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        finishedAt: null,
        error: null,
        rolledBack: false,
        installMethod: context.method,
        platform: `${process.platform}-${process.arch}`,
        logPath: null,
        pid: process.pid
      })
      const logger = createLogger()
      try {
        await performUpgrade({
          context,
          packageName,
          registryBase,
          homeDir,
          fromVersion: registry.currentVersion,
          targetVersion,
          restart: options.restart && running,
          rollback: options.rollback,
          stateFile,
          logPath: null,
          logger
        })
      } finally {
        await logger.close()
      }
      print(`升级完成: ${targetVersion}`)
      return 0
    } finally {
      releaseLock()
    }
  } catch (error) {
    // `performUpgrade` reports failures through its own rollback paths; this
    // covers errors thrown outside them (lock/probe/etc.) so the state file
    // cannot stay non-terminal and block the next attempt for ten minutes.
    try {
      const stateFile = path.join(options.homeDir, 'upgrade-state.json')
      const state = readUpgradeState(stateFile)
      if (
        state?.pid === process.pid &&
        state.phase !== 'failed' &&
        state.phase !== 'succeeded'
      ) {
        updateUpgradeState(stateFile, {
          phase: 'failed',
          error: (error as Error).message,
          finishedAt: Date.now()
        })
      }
    } catch {}
    print(`升级失败: ${(error as Error).message}`)
    return 1
  }
}

function confirmPrompt(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    process.stdout.write(question)
    const onData = (chunk: Buffer) => {
      process.stdin.pause()
      const answer = chunk.toString().trim().toLowerCase()
      resolve(answer === 'y' || answer === 'yes')
    }
    process.stdin.resume()
    process.stdin.once('data', onData)
  })
}
