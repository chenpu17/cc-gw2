# GitHub Upload And Release Checklist

## 1. 首次上传前

- 确认仓库根目录不提交本地产物：`node_modules`、`target`、`bin`、`src/*/dist`、`test-results`、`.pack`
- 确认 `README.md`、`LICENSE`、`.gitignore`、`.github/workflows/*.yml` 已就绪
- 确认 npm 包名已归属当前发布账号：
  - `@chenpu17/cc-gw`
  - `@chenpu17/cc-gw-darwin-arm64`
  - `@chenpu17/cc-gw-linux-x64`
  - `@chenpu17/cc-gw-linux-arm64`
  - `@chenpu17/cc-gw-win32-x64`

## 2. 本地验收

首次机器运行 Playwright 时先安装浏览器：

```bash
pnpm exec playwright install --with-deps chromium
```

完整检查：

```bash
cargo test
pnpm build
pnpm test:e2e:web:core
pnpm test:e2e:web:hardening
pnpm test:e2e:web:visual
pnpm smoke:cli
pnpm pack:dry-run
```

当前本地最新核验记录（2026-03-19）：

- `pnpm smoke:cli` 通过
- `pnpm pack:dry-run` 通过
- 根包 dry-run 产物：`.pack/chenpu17-cc-gw-0.8.0-alpha.11.tgz`
- 根包 tarball 大小：`466942 bytes`
- 已确认根包包含 `src/cli/dist`、`src/web/dist`、`README.md`、`LICENSE`

如本轮修改涉及页面结构、主题或信息层级，再额外执行：

```bash
pnpm test:e2e:web:update-snapshots
git diff -- tests/playwright/visual.spec.ts-snapshots
```

## 3. 初始化 Git 仓库

如果当前目录还没初始化：

```bash
git init -b main
git add .
git commit -m "Initial import"
```

关联 GitHub：

```bash
git remote add origin git@github.com:chenpu17/cc-gw2.git
git push -u origin main
```

## 4. GitHub 仓库设置

- 在 GitHub 仓库里配置 `NPM_TOKEN` secret
- 确认 Actions 权限允许读取代码并运行工作流
- 如果要保护主分支，至少要求 `CI` 工作流通过后才能合并

## 5. 版本发布

发布前：

```bash
pnpm run sync:native-versions
```

确认版本号一致后打 tag：

```bash
git tag v0.8.0-alpha.11
git push origin v0.8.0-alpha.11
```

`release.yml` 会按下面顺序执行：

1. 打包根 npm 包
2. 构建四个平台 native npm 包
3. 根据版本号自动选择 npm dist-tag
4. 先发布 native 包，再发布根包

dist-tag 规则：

- `0.8.0` -> `latest`
- `0.8.0-alpha.11` -> `alpha`
- `0.8.0-beta.1` -> `beta`
- `0.8.0-rc.0` -> `rc`

如果想临时改成别的标签，可在 GitHub Actions 手动运行 `Release` 时填写 `dist_tag`。

## 6. 首次发版后核查

- 用 macOS arm64、Linux x64、Linux arm64、Windows x64（npm 包名 `win32-x64`）分别验证安装
- 验证 `npm install -g @chenpu17/cc-gw` 后 `cc-gw start --foreground` 可直接启动
- 验证旧 `~/.cc-gw` 配置和 SQLite 数据可直接复用
- 验证 `/ui` 下核心页、截图基线页、HTTPS 配置保存、Help 复制、About 手动刷新无回退
- 验证根包 tgz 解包后仍包含 `src/cli/dist/index.js` 与 `src/web/dist/index.html`
