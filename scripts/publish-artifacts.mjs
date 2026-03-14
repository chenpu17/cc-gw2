import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { readRootPackageVersion, resolveDistTag } from './npm-dist-tag.mjs'

function parseArgs(argv) {
  const options = {
    dir: 'artifacts',
    tag: process.env.NPM_DIST_TAG?.trim() || '',
    dryRun: false
  }

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--') {
      continue
    }
    if (arg === '--dir') {
      options.dir = argv[index + 1] ?? options.dir
      index += 1
      continue
    }
    if (arg === '--tag') {
      options.tag = argv[index + 1] ?? options.tag
      index += 1
      continue
    }
    if (arg === '--dry-run') {
      options.dryRun = true
      continue
    }
    throw new Error(`Unknown argument: ${arg}`)
  }

  return options
}

function collectTgzFiles(rootDir) {
  const results = []

  function walk(currentDir) {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true })
    for (const entry of entries) {
      const absolutePath = path.join(currentDir, entry.name)
      if (entry.isDirectory()) {
        walk(absolutePath)
        continue
      }
      if (entry.isFile() && entry.name.endsWith('.tgz')) {
        results.push(absolutePath)
      }
    }
  }

  walk(rootDir)
  return results
}

function publishOrder(files) {
  return [...files].sort((left, right) => {
    const leftRoot = left.includes('root-package') || /chenpu17-cc-gw-[\dA-Za-z.-]+\.tgz$/.test(left)
    const rightRoot = right.includes('root-package') || /chenpu17-cc-gw-[\dA-Za-z.-]+\.tgz$/.test(right)
    if (leftRoot === rightRoot) {
      return left.localeCompare(right)
    }
    return leftRoot ? 1 : -1
  })
}

function runPublish(file, tag, dryRun) {
  const args = ['publish', file, '--access', 'public', '--tag', tag]
  if (dryRun) {
    args.push('--dry-run')
  }

  const result = spawnSync('npm', args, {
    stdio: 'inherit',
    env: process.env
  })

  if (result.status !== 0) {
    throw new Error(`npm publish failed for ${file}`)
  }
}

const options = parseArgs(process.argv.slice(2))
const rootDir = path.resolve(process.cwd(), options.dir)
if (!fs.existsSync(rootDir)) {
  throw new Error(`Artifacts directory does not exist: ${rootDir}`)
}

const files = collectTgzFiles(rootDir)
if (files.length === 0) {
  throw new Error(`No .tgz artifacts found in ${rootDir}`)
}

const version = readRootPackageVersion()
const tag = resolveDistTag(version, options.tag)

console.log(`Publishing ${files.length} package(s) with dist-tag "${tag}" from ${rootDir}`)

for (const file of publishOrder(files)) {
  console.log(`\n> npm publish ${path.relative(process.cwd(), file)} --tag ${tag}${options.dryRun ? ' --dry-run' : ''}`)
  runPublish(file, tag, options.dryRun)
}
