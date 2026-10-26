#!/usr/bin/env node
import { Command, Option } from 'commander'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { green, yellow } from 'colorette'
import {
  detectInstallContext,
  runManualUpgrade,
  runServerUpgrade
} from './upgrade'

const program = new Command()

const DEFAULT_PORT = 4100
const CLI_ENTRY = fileURLToPath(import.meta.url)

function resolveHomeDir(): string {
  const override = process.env.CC_GW_HOME?.trim()
  return override ? override : path.join(os.homedir(), '.cc-gw')
}

const HOME_DIR = resolveHomeDir()
const PID_FILE = path.join(HOME_DIR, 'cc-gw.pid')
const LOG_DIR = path.join(HOME_DIR, 'logs')
const LOG_FILE = path.join(LOG_DIR, 'cc-gw.log')
const CONFIG_FILE = path.join(HOME_DIR, 'config.json')
const require = createRequire(import.meta.url)

function resolvePackageVersion(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const candidates = [
    path.resolve(__dirname, '../../../package.json'),
    path.resolve(__dirname, '../../package.json'),
    path.resolve(__dirname, '../package.json')
  ]
  for (const candidate of candidates) {
    try {
      const pkg = require(candidate)
      if (pkg && typeof pkg.version === 'string') {
        return pkg.version
      }
    } catch {}
  }
  return '0.0.0'
}

const CLI_VERSION = resolvePackageVersion()

function resolveProjectRoot(): string {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const candidates = [
    path.resolve(__dirname, '../../..'),
    path.resolve(__dirname, '../..'),
    process.cwd()
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(path.join(candidate, 'package.json'))) {
      return candidate
    }
  }
  return candidates[0]
}

function resolveExecutableName(): string {
  return process.platform === 'win32' ? 'cc-gw-server.exe' : 'cc-gw-server'
}

function resolveNativePackageBinary(): string | null {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const executable = resolveExecutableName()
  const packageMap: Record<string, string> = {
    'darwin-arm64': '@chenpu17/cc-gw-darwin-arm64',
    'linux-x64': '@chenpu17/cc-gw-linux-x64',
    'linux-arm64': '@chenpu17/cc-gw-linux-arm64',
    'win32-x64': '@chenpu17/cc-gw-win32-x64'
  }
  const packageName = packageMap[`${process.platform}-${process.arch}`]
  if (!packageName) {
    return null
  }

  try {
    const packageJsonPath = require.resolve(`${packageName}/package.json`, {
      paths: [__dirname]
    })
    const packageDir = path.dirname(packageJsonPath)
    const candidate = path.join(packageDir, 'bin', executable)
    if (fs.existsSync(candidate)) {
      return candidate
    }
  } catch {}

  return null
}

function resolveBundledBinary(): string | null {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const executable = resolveExecutableName()
  const targetDir = `${process.platform}-${process.arch}`
  const candidates = [
    path.resolve(__dirname, `../../../bin/${targetDir}/${executable}`),
    path.resolve(__dirname, `../../../../bin/${targetDir}/${executable}`)
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate
    }
  }

  return null
}

function resolveServerCommand(): { command: string; args: string[]; cwd?: string } {
  const envOverride = process.env.CC_GW_SERVER_BIN
  if (envOverride && fs.existsSync(envOverride)) {
    return { command: envOverride, args: [] }
  }

  const packaged = resolveNativePackageBinary()
  if (packaged) {
    return { command: packaged, args: [] }
  }

  const bundled = resolveBundledBinary()
  if (bundled) {
    return { command: bundled, args: [] }
  }

  const projectRoot = resolveProjectRoot()
  const executable = resolveExecutableName()
  const candidates = [
    path.join(projectRoot, 'target', 'release', executable),
    path.join(projectRoot, 'target', 'debug', executable)
  ]

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return { command: candidate, args: [] }
    }
  }

  return {
    command: 'cargo',
    args: ['run', '-p', 'cc-gw-server', '--'],
    cwd: projectRoot
  }
}

function resolveWebDist(): string | null {
  const __filename = fileURLToPath(import.meta.url)
  const __dirname = path.dirname(__filename)
  const hasIndex = (dir: string): boolean => fs.existsSync(path.join(dir, 'index.html'))
  const candidates = [
    path.resolve(__dirname, '../web/dist'),
    path.resolve(__dirname, '../../web/dist'),
    path.resolve(__dirname, '../../../src/web/dist'),
    path.resolve(process.cwd(), 'src/web/dist')
  ]

  for (const candidate of candidates) {
    if (hasIndex(candidate)) {
      return candidate
    }
  }
  return null
}

async function ensureHomeDir(): Promise<void> {
  await fsp.mkdir(LOG_DIR, { recursive: true })
}

async function ensureConfigTemplate(port?: string): Promise<boolean> {
  try {
    await fsp.access(CONFIG_FILE)
    return false
  } catch {
    const selectedPort = port ? Number.parseInt(port, 10) || DEFAULT_PORT : DEFAULT_PORT
    const baseDefaults = {
      completion: null,
      reasoning: null,
      background: null,
      longContextThreshold: 60000
    }
    const template = {
      http: {
        enabled: true,
        port: selectedPort,
        host: '127.0.0.1'
      },
      https: {
        enabled: false,
        port: 4443,
        host: '127.0.0.1',
        keyPath: '',
        certPath: '',
        caPath: ''
      },
      host: '127.0.0.1',
      port: selectedPort,
      providers: [],
      defaults: { ...baseDefaults },
      storeRequestPayloads: true,
      storeResponsePayloads: true,
      enableRoutingFallback: false,
      endpointRouting: {
        anthropic: {
          defaults: { ...baseDefaults },
          modelRoutes: {}
        },
        openai: {
          defaults: { ...baseDefaults },
          modelRoutes: {}
        }
      },
      logRetentionDays: 30,
      modelRoutes: {},
      logLevel: 'info',
      bodyLimit: 10 * 1024 * 1024,
      webAuth: {
        enabled: false,
        username: '',
        passwordHash: '',
        passwordSalt: ''
      }
    }
    await fsp.mkdir(path.dirname(CONFIG_FILE), { recursive: true })
    await fsp.writeFile(CONFIG_FILE, JSON.stringify(template, null, 2), 'utf-8')
    return true
  }
}

async function readConfiguredPort(): Promise<number | null> {
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed.port === 'number' && Number.isFinite(parsed.port)) {
      return parsed.port
    }
  } catch {}
  return null
}

async function hasNoConfiguredProviders(): Promise<boolean> {
  try {
    const raw = await fsp.readFile(CONFIG_FILE, 'utf-8')
    const parsed = JSON.parse(raw)
    return !parsed || !Array.isArray(parsed.providers) || parsed.providers.length === 0
  } catch {
    return false
  }
}

async function readPid(): Promise<number | null> {
  try {
    const raw = await fsp.readFile(PID_FILE, 'utf-8')
    const pid = Number.parseInt(raw.trim(), 10)
    return Number.isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

async function writePid(pid: number | undefined): Promise<void> {
  if (pid == null) return
  await fsp.writeFile(PID_FILE, String(pid), 'utf-8')
}

async function removePid(): Promise<void> {
  try {
    await fsp.unlink(PID_FILE)
  } catch {}
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function isServiceRunning(): Promise<{ running: boolean; pid?: number }> {
  const pid = await readPid()
  if (!pid) return { running: false }
  if (isProcessAlive(pid)) {
    return { running: true, pid }
  }
  await removePid()
  return { running: false }
}

async function handleStart(options: { daemon?: boolean; port?: string; foreground?: boolean }): Promise<void> {
  await ensureHomeDir()
  const { running, pid } = await isServiceRunning()
  if (running && pid) {
    console.log(yellow(`cc-gw 已在运行 (pid: ${pid})`))
    return
  }

  const configCreated = await ensureConfigTemplate(options.port)
  const server = resolveServerCommand()
  const env = { ...process.env }
  env.CC_GW_HOME = env.CC_GW_HOME || HOME_DIR

  // Lets the running server expose a one-click upgrade and spawn this CLI as
  // an external upgrade helper (the server cannot restart itself).
  const installContext = detectInstallContext(CLI_ENTRY)
  env.CC_GW_CLI_PATH = CLI_ENTRY
  env.CC_GW_NODE_BIN = process.execPath
  env.CC_GW_SERVICE_MODE = options.foreground ? 'foreground' : 'daemon'
  env.CC_GW_INSTALL_METHOD = installContext.method
  env.CC_GW_INSTALL_WRITABLE = installContext.writable ? '1' : '0'

  if (options.port) {
    env.PORT = options.port
  }

  if (!env.CC_GW_UI_ROOT) {
    const uiRoot = resolveWebDist()
    if (uiRoot) {
      env.CC_GW_UI_ROOT = uiRoot
    }
  }

  const daemonMode = options.foreground ? false : options.daemon !== false
  const spawnOptions: Parameters<typeof spawn>[2] = {
    cwd: server.cwd,
    env,
    detached: daemonMode,
    stdio: daemonMode
      ? [
          'ignore',
          fs.openSync(LOG_FILE, 'a'),
          fs.openSync(LOG_FILE, 'a')
        ]
      : 'inherit'
  }

  const child = spawn(server.command, server.args, spawnOptions)
  child.on('error', (err) => {
    console.error('启动 cc-gw 失败:', err)
  })

  await writePid(child.pid)

  if (daemonMode) {
    child.unref()
    console.log(green(`cc-gw 已以守护进程方式启动 (pid: ${child.pid})`))
  }

  let effectivePort: number
  if (options.port) {
    const parsed = Number.parseInt(options.port, 10)
    effectivePort = Number.isFinite(parsed) ? parsed : DEFAULT_PORT
  } else {
    const configured = await readConfiguredPort()
    effectivePort = configured ?? DEFAULT_PORT
  }

  if (configCreated) {
    console.log(green(`已在 ${CONFIG_FILE} 生成默认配置`))
    console.log(yellow('首次启动后，请访问 Web UI 继续配置 provider。'))
  }

  const webUiUrl = `http://127.0.0.1:${effectivePort}/ui`
  console.log(green(`服务地址: ${webUiUrl}`))
  console.log(`${green('WebUI 控制台:')} ${webUiUrl}`)
  if (await hasNoConfiguredProviders()) {
    console.log(yellow(`首次使用？打开 ${webUiUrl}/setup 按向导完成配置`))
  }

  if (!daemonMode) {
    const forwardSignal = (signal: NodeJS.Signals) => {
      if (!child.killed) {
        try {
          child.kill(signal)
        } catch {}
      }
    }

    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)

    await new Promise<void>((resolve) => {
      child.on('exit', () => resolve())
      child.on('close', () => resolve())
    })

    process.off('SIGINT', forwardSignal)
    process.off('SIGTERM', forwardSignal)
    await removePid()

    if (child.exitCode && child.exitCode !== 0) {
      process.exitCode = child.exitCode
    }
  }
}

async function handleStop(): Promise<void> {
  const pid = await readPid()
  if (!pid) {
    console.log(yellow('cc-gw 未在运行。'))
    return
  }
  if (!isProcessAlive(pid)) {
    console.log(yellow('检测到陈旧的 PID 文件，已清理。'))
    await removePid()
    return
  }
  try {
    process.kill(pid, 'SIGTERM')
    console.log(green(`已向进程 ${pid} 发送 SIGTERM`))
  } catch (err) {
    console.error(`停止 cc-gw 失败: ${(err as Error).message}`)
  } finally {
    await removePid()
  }
}

async function handleStatus(): Promise<void> {
  const { running, pid } = await isServiceRunning()
  if (running && pid) {
    console.log(green(`cc-gw 正在运行 (pid: ${pid})`))
  } else {
    console.log(yellow('cc-gw 未在运行。'))
  }
  console.log(`PID 文件: ${PID_FILE}`)
  console.log(`日志目录: ${LOG_DIR}`)
  console.log(`配置文件: ${CONFIG_FILE}`)
}

program
  .name('cc-gw')
  .description('Rust-backed Claude Code Gateway CLI')
  .version(CLI_VERSION)

program
  .command('version')
  .description('显示当前 cc-gw CLI 版本')
  .action(() => {
    console.log(`cc-gw CLI 版本: ${CLI_VERSION}`)
  })

program
  .command('start')
  .description('启动 cc-gw 服务')
  .option('--daemon', '以守护进程方式运行（默认）')
  .option('--foreground', '以前台模式运行并保持控制台输出')
  .option('--port <port>', '指定服务监听端口')
  .action(async (options) => {
    try {
      await handleStart(options)
    } catch (err) {
      console.error((err as Error).message)
      process.exitCode = 1
    }
  })

program
  .command('stop')
  .description('停止 cc-gw 服务')
  .action(async () => {
    await handleStop()
  })

program
  .command('restart')
  .description('重启 cc-gw 服务')
  .option('--daemon', '以守护进程方式运行')
  .option('--port <port>', '指定服务监听端口')
  .action(async (options) => {
    await handleStop()
    await handleStart(options)
  })

program
  .command('status')
  .description('查看 cc-gw 运行状态')
  .action(async () => {
    await handleStatus()
  })

program
  .command('upgrade')
  .description('升级 cc-gw（从 npm registry 安装新版本并重启服务）')
  .option('--target <version>', '指定目标版本（默认按当前发布通道取最新版）')
  .option('--check', '只检查是否有新版本，不执行升级')
  .option('--yes', '跳过交互确认')
  .option('--no-restart', '只安装新版本，不重启正在运行的服务')
  .option('--no-rollback', '升级失败时不自动回滚到旧版本')
  .addOption(new Option('--from-server', '由网关服务端调用（内部使用）').hideHelp())
  .addOption(new Option('--state-file <path>', '升级状态文件路径').hideHelp())
  .addOption(new Option('--log-file <path>', '升级日志文件路径').hideHelp())
  .addOption(new Option('--id <id>', '升级任务 id').hideHelp())
  .addOption(new Option('--home <dir>', 'cc-gw 数据目录').hideHelp())
  .addOption(new Option('--from-version <version>', '升级前版本').hideHelp())
  .addOption(new Option('--server-pid <pid>', '网关进程 PID').hideHelp())
  .addOption(new Option('--port <port>', '网关监听端口').hideHelp())
  .addOption(new Option('--protocol <protocol>', '健康检查协议（http/https）').hideHelp())
  .action(async (options) => {
    try {
      const homeDir = options.home ? path.resolve(options.home) : HOME_DIR
      if (options.fromServer) {
        if (!options.target || !options.fromVersion || !options.stateFile) {
          throw new Error('--from-server 需要 --target、--from-version 与 --state-file')
        }
        const serverPid = Number.parseInt(String(options.serverPid ?? ''), 10)
        const port = Number.parseInt(String(options.port ?? ''), 10)
        const protocol =
          options.protocol === 'http' || options.protocol === 'https'
            ? options.protocol
            : undefined
        process.exitCode = await runServerUpgrade({
          cliPath: CLI_ENTRY,
          nodeBin: process.execPath,
          homeDir,
          packageName: process.env.CC_GW_VERSION_CHECK_PACKAGE_NAME,
          currentVersion: options.fromVersion,
          targetVersion: options.target,
          fromVersion: options.fromVersion,
          id: options.id ?? `${Date.now()}-${process.pid}`,
          stateFile: path.resolve(options.stateFile),
          logFile: options.logFile
            ? path.resolve(options.logFile)
            : path.join(homeDir, 'logs', 'upgrade.log'),
          restart: options.restart !== false,
          rollback: options.rollback !== false,
          serverPid: Number.isFinite(serverPid) ? serverPid : undefined,
          port: Number.isFinite(port) ? port : undefined,
          protocol
        })
        return
      }

      process.exitCode = await runManualUpgrade({
        cliPath: CLI_ENTRY,
        nodeBin: process.execPath,
        homeDir,
        packageName: process.env.CC_GW_VERSION_CHECK_PACKAGE_NAME,
        currentVersion: CLI_VERSION,
        targetVersion: options.target,
        checkOnly: Boolean(options.check),
        assumeYes: Boolean(options.yes),
        restart: options.restart !== false,
        rollback: options.rollback !== false
      })
    } catch (err) {
      console.error((err as Error).message)
      process.exitCode = 1
    }
  })

program.parseAsync(process.argv)
