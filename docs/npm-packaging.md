# npm Packaging

## Build Output

根目录执行：

```bash
pnpm build
```

会依次完成：

1. `cargo build --release -p cc-gw-server`
2. `pnpm --filter @cc-gw/cli build`
3. `pnpm --filter @cc-gw/web build`
4. `node scripts/bundle-native-binary.mjs`

最终产物：

- `src/cli/dist/index.js`
- `src/web/dist/*`
- `bin/<platform>-<arch>/cc-gw-server`
- `packages/native/<platform>-<arch>/bin/cc-gw-server`

当前 macOS Apple Silicon 产物路径示例：

```text
bin/darwin-arm64/cc-gw-server
packages/native/darwin-arm64/bin/cc-gw-server
```

## CLI Resolution Order

`cc-gw` CLI 在运行 `start` 时，按下面顺序寻找后端：

1. 平台专用 native npm 子包 `@chenpu17/cc-gw-<platform>-<arch>`
2. 环境变量 `CC_GW_SERVER_BIN`
3. 工作区 `bin/<platform>-<arch>/cc-gw-server`
4. 工作区 `target/release/cc-gw-server`
5. 工作区 `target/debug/cc-gw-server`
6. `cargo run -p cc-gw-server --`

这保证了：

- npm 包安装后可以直接启动，不依赖本机 Rust 工具链
- 本地开发仍然可以覆盖二进制
- 没有预编译产物时也能退回 Cargo 工作流

## Package Layout

发布时包含两个层级：

- 根包 `@chenpu17/cc-gw`
  - 提供 CLI、Web 静态资源
  - 通过 `optionalDependencies` 引用平台包
- 平台包
  - `@chenpu17/cc-gw-darwin-arm64`
  - `@chenpu17/cc-gw-linux-x64`
  - `@chenpu17/cc-gw-linux-arm64`
- `@chenpu17/cc-gw-win32-x64`

其中：

- Linux 产物基于 `musl` 目标构建，尽量减少宿主机依赖
- Windows x64 产物对应 npm 平台包 `win32-x64`，并启用静态 CRT
- macOS arm64 发布原生二进制

## Smoke Verification

构建完成后，可直接运行：

```bash
pnpm smoke:cli
```

这个脚本会：

- 创建临时 `HOME`
- 使用打包后的 `src/cli/dist/index.js`
- 通过 CLI 拉起服务
- 轮询 `/health`
- 校验生成的 `~/.cc-gw/config.json`
- 发送 `SIGINT` 并确认正常退出

## Publish Notes

发布 npm 包前确认：

- `cargo test`
- `pnpm build`
- `pnpm exec playwright install chromium`（首次本地运行时）
- `pnpm test:e2e:web`
- `pnpm smoke:cli`
- `pnpm pack:dry-run`
- 根包内容包含 `src/cli/dist`、`src/web/dist`
- 平台 native 包内容包含 `bin/cc-gw-server`
- 目标平台二进制名称与 CLI 解析规则一致

测试版发布规则：

- 如果根包版本号是 `0.8.0-alpha.5`、`0.8.0-beta.1`、`0.8.0-rc.0` 这种 prerelease，发布脚本会自动把 dist-tag 设为 `alpha`、`beta`、`rc`
- 稳定版如 `0.8.0` 才会默认发布到 `latest`
- 如需手工覆盖，可设置 `NPM_DIST_TAG=next`

本地发布已打包产物：

```bash
NPM_DIST_TAG=alpha pnpm publish:packed -- --dir artifacts
```

仅做发布命令预演：

```bash
pnpm publish:packed -- --dir artifacts --dry-run
```

## Local Unpublished Install

如果还没把 native 包发布到 npm，只在本地用 root tgz 做 `npm install -g`，CLI 无法自动下载平台包，会回退到 `cargo run`。

本地模拟真实安装时，先安装当前平台 native 包，再安装 root 包。例如 macOS arm64：

```bash
pnpm pack:dry-run
pnpm --dir packages/native/darwin-arm64 pack --pack-destination ../../../.pack/native
npm install -g ./.pack/native/chenpu17-cc-gw-darwin-arm64-0.8.0-alpha.5.tgz
npm install -g ./.pack/chenpu17-cc-gw-0.8.0-alpha.5.tgz
```

## CI

仓库内提供了 [ci.yml](../.github/workflows/ci.yml)：

- `ubuntu-latest` 与 `macos-latest` 跑 `cargo test`
- 跑 `pnpm build`
- 在 `ubuntu-latest` 安装 Playwright Chromium 并跑 `pnpm exec playwright test`
- 跑 `pnpm smoke:cli`
- 跑 `pnpm pack:dry-run`

发布流水线见 [release.yml](../.github/workflows/release.yml)：

- `build-root-package` 打包根 npm 包
- `build-native-packages` 矩阵构建四个平台 native 包
- `publish-npm` 先发布 native 子包，再发布根包
- 默认根据根包版本号推导 npm dist-tag；如 `0.8.0-alpha.5` 会发布到 `alpha`，不会覆盖 `latest`

另外，`prepack` 会自动触发 `pnpm run build:package`，只打包 CLI 与 Web 资源；native 二进制由独立平台包承载。
