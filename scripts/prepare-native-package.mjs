import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { getNativeTargetById } from './native-targets.mjs'

function parseArgs(argv) {
  const args = { target: '', source: '' }
  for (let index = 2; index < argv.length; index += 1) {
    const current = argv[index]
    if (current === '--target') {
      args.target = argv[index + 1] ?? ''
      index += 1
      continue
    }
    if (current === '--source') {
      args.source = argv[index + 1] ?? ''
      index += 1
      continue
    }
  }
  return args
}

const { target: targetId, source } = parseArgs(process.argv)
if (!targetId || !source) {
  console.error('usage: node scripts/prepare-native-package.mjs --target <id> --source <binary>')
  process.exit(1)
}

const target = getNativeTargetById(targetId)
if (!target) {
  console.error(`unknown native target: ${targetId}`)
  process.exit(1)
}

const projectRoot = process.cwd()
const sourcePath = path.resolve(projectRoot, source)
if (!fs.existsSync(sourcePath)) {
  console.error(`missing source binary: ${sourcePath}`)
  process.exit(1)
}

const packageRoot = path.join(projectRoot, 'packages', 'native', target.id)
const binDir = path.join(packageRoot, 'bin')
const targetPath = path.join(binDir, target.executable)

fs.mkdirSync(binDir, { recursive: true })
fs.copyFileSync(sourcePath, targetPath)

if (process.platform !== 'win32' || !target.executable.endsWith('.exe')) {
  fs.chmodSync(targetPath, 0o755)
}

console.log(`prepared native package binary: ${targetPath}`)

