# cc-gw

GitHub 仓库：[chenpu17/cc-gw2](https://github.com/chenpu17/cc-gw2)

`cc-gw` 是一个本地网关项目，使用 Rust 重写原先的 Node.js 后端，同时保留现有 Web UI、CLI 使用方式、配置文件和 SQLite 数据格式的兼容性。

当前主线已收敛到 `v0.8.4` 正式版，核心收益是后端完成 Rust 化之后，在相同常驻场景下内存占用实测可降至旧 Node.js 实现的约 `1/20`，同时继续保持对既有 CLI、Web UI、配置目录与 SQLite 数据的兼容。

说明：

- 当前 GitHub 仓库名是 `cc-gw2`
- 对外 npm 包名仍然是 `@chenpu17/cc-gw`
- 命令行入口仍然是 `cc-gw`

## 项目目标

- Web 前端保持不改，继续复用现有管理台
- 后端接口尽量对齐旧 Node.js 版本的外部行为
- SQLite 数据、配置目录、密钥格式继续兼容旧版本
- CLI 保持 `start`、`stop`、`restart`、`status`、`version` 等命令习惯
- npm 安装默认使用预编译原生二进制，不要求用户本机安装 Rust
- 发布目标尽量提供自包含二进制，减少宿主机运行时依赖

## 正式版亮点

- Rust 后端已替代旧 Node.js 服务端，兼容原有使用方式
- 常驻内存占用实测下降到旧实现的约 `1/20`
- npm 安装默认分发预编译原生二进制，普通用户不需要本机 Rust 环境
- Web 控制台、CLI 命令习惯、配置文件路径与 SQLite 数据格式继续兼容

## 控制台预览

以下截图通过仓库脚本自动生成，固定为英文界面与亮色主题：

<table>
  <tr>
    <td><img src="./docs/assets/readme/dashboard-en-light.png" alt="Dashboard screenshot in English light theme" /></td>
    <td><img src="./docs/assets/readme/models-en-light.png" alt="Models and routing screenshot in English light theme" /></td>
  </tr>
  <tr>
    <td align="center"><sub>Dashboard</sub></td>
    <td align="center"><sub>Models &amp; Routing</sub></td>
  </tr>
</table>

## 快速开始

全局安装：

```bash
npm install -g @chenpu17/cc-gw
```

以前台模式启动：

```bash
cc-gw start --foreground --port 4100
```

或以守护进程模式启动：

```bash
cc-gw start --daemon --port 4100
```

启动后访问：

```text
http://127.0.0.1:4100/ui
```

默认本地数据目录：

- 配置：`~/.cc-gw/config.json`
- 数据库：`~/.cc-gw/data/gateway.db`
- 日志：`~/.cc-gw/logs`
- PID：`~/.cc-gw/cc-gw.pid`

## 当前实现

- Rust workspace：`crates/cc-gw-core`、`crates/cc-gw-server`
- 兼容型 CLI：`src/cli`
- 原 Web 前端：`src/web`
- 兼容配置路径：`~/.cc-gw/config.json`
- 兼容数据库路径：`~/.cc-gw/data/gateway.db`
- 兼容旧 `encryption.key`、旧 `api_keys.key_ciphertext`、旧 Web Auth `scrypt` 密码格式
- 已覆盖 Web 管理台和客户端依赖的核心接口，包括 `/ui`、`/assets/*`、`/favicon.ico`、`/api/*`、`/v1/*`、`/openai/v1/*`
- 已实现 Anthropic / OpenAI Chat / OpenAI Responses 的代理与流式转换
- 已实现 API Key、日志、事件、统计、路由预设、自定义端点和 SQLite 兼容迁移

## 本地开发

```bash
pnpm install
pnpm build
pnpm dev
```

直接通过 CLI 前台启动：

```bash
pnpm --filter @cc-gw/cli exec tsx index.ts start --foreground
```

`pnpm build` 会执行：

1. 构建 Rust 服务端
2. 构建 `src/cli/dist`
3. 构建 `src/web/dist`
4. 为当前平台生成 `bin/<platform>-<arch>/cc-gw-server`
5. 同步当前平台 native npm 子包中的原生二进制

CLI 启动时的后端解析顺序：

1. 平台专用 native npm 子包
2. `CC_GW_SERVER_BIN`
3. 工作区 `bin/<platform>-<arch>/cc-gw-server`
4. 工作区 `target/release` 或 `target/debug`
5. `cargo run -p cc-gw-server --`

## 安装与发布

对外发布模型：

- 根包：`@chenpu17/cc-gw`
- 平台包：`@chenpu17/cc-gw-darwin-arm64`
- 平台包：`@chenpu17/cc-gw-linux-x64`
- 平台包：`@chenpu17/cc-gw-linux-arm64`
- 平台包：`@chenpu17/cc-gw-win32-x64`

用户安装：

```bash
npm install -g @chenpu17/cc-gw
```

安装时会通过 `optionalDependencies` 自动拉取当前平台的预编译二进制，无需本地编译 Rust。
Linux 版本使用 `musl`，Windows 版本使用静态 CRT，目标是让用户只需 `npm install` 即可直接运行。

本地在仓库中直接验证未发布包时，需要额外安装当前平台 native 包；否则 CLI 会回退到 `cargo run`：

```bash
pnpm pack:dry-run
pnpm --dir packages/native/darwin-arm64 pack --pack-destination ../../../.pack/native
npm install -g ./.pack/native/chenpu17-cc-gw-darwin-arm64-0.8.4.tgz
npm install -g ./.pack/chenpu17-cc-gw-0.8.4.tgz
```

当前发布目标：

- macOS arm64
- Linux x64
- Linux arm64
- Windows x64（npm 包名为 `win32-x64`）

## 验证

建议在上传或发版前执行：

```bash
cargo test
pnpm build
pnpm smoke:cli
pnpm pack:dry-run
```

首次运行 Web E2E 前，先安装 Playwright Chromium：

```bash
pnpm exec playwright install --with-deps chromium
pnpm test:e2e:web
```

如需刷新 `README` 中使用的英文亮色截图：

```bash
pnpm docs:readme-screenshots
```

如果只想跑分层回归，可直接用：

```bash
pnpm test:e2e:web:core
pnpm test:e2e:web:hardening
pnpm test:e2e:web:visual
```

如需刷新页面级截图基线：

```bash
pnpm test:e2e:web:update-snapshots
```

当前仓库已具备：

- Web UI 构建通过
- Web Playwright E2E 通过
- 页面级视觉截图基线回归
- 低频危险路径 E2E
- CLI smoke 流程可单独执行
- GitHub Actions CI 与 release workflow 已落地

## CI 与文档

- 文档索引：[`docs/README.md`](docs/README.md)
- 系统设计：[`docs/system-design.md`](docs/system-design.md)
- 存储设计：[`docs/database-schema.md`](docs/database-schema.md)
- API 兼容矩阵：[`docs/api-compatibility.md`](docs/api-compatibility.md)
- 日常校验：[`ci.yml`](.github/workflows/ci.yml)
- 发布流水线：[`release.yml`](.github/workflows/release.yml)
- npm 打包说明：[`docs/npm-packaging.md`](docs/npm-packaging.md)
- GitHub 上传和发版清单：[`docs/github-release-checklist.md`](docs/github-release-checklist.md)
