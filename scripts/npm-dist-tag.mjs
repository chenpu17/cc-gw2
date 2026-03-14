import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

function resolvePackageJsonPath() {
  return path.resolve(import.meta.dirname, '../package.json')
}

export function resolveDistTag(version, override) {
  const normalizedOverride = override?.trim()
  if (normalizedOverride) {
    return normalizedOverride
  }

  const prerelease = version.split('-', 2)[1]
  if (!prerelease) {
    return 'latest'
  }

  const [identifier] = prerelease.split('.', 1)
  return identifier?.trim() || 'latest'
}

export function readRootPackageVersion() {
  const packageJsonPath = resolvePackageJsonPath()
  const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'))
  return packageJson.version
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const version = readRootPackageVersion()
  const distTag = resolveDistTag(version, process.env.NPM_DIST_TAG)
  process.stdout.write(`${distTag}\n`)
}
