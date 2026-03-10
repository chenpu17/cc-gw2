import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { NATIVE_TARGETS } from './native-targets.mjs'

const projectRoot = process.cwd()
const rootPackagePath = path.join(projectRoot, 'package.json')
const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'))
const version = rootPackage.version

if (!rootPackage.optionalDependencies) {
  throw new Error('root package.json is missing optionalDependencies for native packages')
}
for (const target of NATIVE_TARGETS) {
  if (!(target.packageName in rootPackage.optionalDependencies)) {
    throw new Error(`missing optional dependency entry: ${target.packageName}`)
  }
}

for (const target of NATIVE_TARGETS) {
  const packagePath = path.join(projectRoot, 'packages', 'native', target.id, 'package.json')
  const pkg = JSON.parse(fs.readFileSync(packagePath, 'utf8'))
  pkg.version = version
  fs.writeFileSync(packagePath, `${JSON.stringify(pkg, null, 2)}\n`, 'utf8')
}

console.log(`synced native package versions to ${version}`)
