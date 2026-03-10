import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getNativeTargetByPlatformArch } from './native-targets.mjs'

const projectRoot = process.cwd()
const platform = process.platform
const arch = process.arch
const nativeTarget = getNativeTargetByPlatformArch(platform, arch)

if (!nativeTarget) {
  console.error(`unsupported local target for bundling: ${platform}-${arch}`)
  process.exit(1)
}

const executable = nativeTarget.executable

const source = path.join(projectRoot, 'target', 'release', executable)
if (!fs.existsSync(source)) {
  console.error(`missing release binary: ${source}`)
  process.exit(1)
}

const targetDir = path.join(projectRoot, 'bin', `${platform}-${arch}`)
const target = path.join(targetDir, executable)
fs.mkdirSync(targetDir, { recursive: true })
fs.copyFileSync(source, target)

const packageDir = path.join(projectRoot, 'packages', 'native', nativeTarget.id, 'bin')
const packageTarget = path.join(packageDir, executable)
fs.mkdirSync(packageDir, { recursive: true })
fs.copyFileSync(source, packageTarget)

if (platform !== 'win32') {
  fs.chmodSync(target, 0o755)
  fs.chmodSync(packageTarget, 0o755)
}

console.log(`bundled native binary: ${target}`)
console.log(`bundled native package binary: ${packageTarget}`)
