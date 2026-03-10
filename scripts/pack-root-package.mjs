import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { spawnSync } from 'node:child_process'

const projectRoot = process.cwd()
const outputDir = path.join(projectRoot, '.pack')
fs.rmSync(outputDir, { recursive: true, force: true })
fs.mkdirSync(outputDir, { recursive: true })

const result = spawnSync('pnpm', ['pack', '--pack-destination', outputDir], {
  cwd: projectRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32',
})

if (result.status !== 0) {
  process.exit(result.status ?? 1)
}

for (const entry of fs.readdirSync(outputDir)) {
  const file = path.join(outputDir, entry)
  const stat = fs.statSync(file)
  console.log(`${entry}\t${stat.size} bytes`)
}
