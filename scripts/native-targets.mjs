export const NATIVE_TARGETS = [
  {
    id: 'darwin-arm64',
    packageName: '@chenpu17/cc-gw-darwin-arm64',
    os: ['darwin'],
    cpu: ['arm64'],
    rustTarget: 'aarch64-apple-darwin',
    executable: 'cc-gw-server',
  },
  {
    id: 'linux-x64',
    packageName: '@chenpu17/cc-gw-linux-x64',
    os: ['linux'],
    cpu: ['x64'],
    rustTarget: 'x86_64-unknown-linux-musl',
    executable: 'cc-gw-server',
  },
  {
    id: 'linux-arm64',
    packageName: '@chenpu17/cc-gw-linux-arm64',
    os: ['linux'],
    cpu: ['arm64'],
    rustTarget: 'aarch64-unknown-linux-musl',
    executable: 'cc-gw-server',
  },
  {
    id: 'win32-ia32',
    packageName: '@chenpu17/cc-gw-win32-ia32',
    os: ['win32'],
    cpu: ['ia32'],
    rustTarget: 'i686-pc-windows-msvc',
    executable: 'cc-gw-server.exe',
  },
]

export function getNativeTargetById(id) {
  return NATIVE_TARGETS.find((target) => target.id === id) ?? null
}

export function getNativeTargetByPlatformArch(platform, arch) {
  return NATIVE_TARGETS.find(
    (target) => target.os.includes(platform) && target.cpu.includes(arch),
  ) ?? null
}
