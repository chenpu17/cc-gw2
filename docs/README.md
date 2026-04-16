# Docs

当前对外入口约定：

- `GET /`：产品官网和定位说明
- `GET /ui/`：Web 管理控制台

当前文档按下面几类维护：

- [system-design.md](./system-design.md)
  - 系统目标、兼容性边界、模块拆分、请求链路、数据存储和运行模型
- [database-schema.md](./database-schema.md)
  - 本地目录结构、SQLite 表设计和兼容迁移策略
- [api-compatibility.md](./api-compatibility.md)
  - 对外 HTTP 接口、别名路径和当前兼容范围
- [product-positioning.md](./product-positioning.md)
  - 产品定位、适用团队规模、推荐叙事和官网/README 一致性基线
- [landing-publishing.md](./landing-publishing.md)
  - 官网入口、分享资产、SEO 文件与发版前核对清单
- [media-kit.md](./media-kit.md)
  - 架构图、社交分享图、README 截图和对外分享文案建议
- [demo-script.md](./demo-script.md)
  - 录屏、演示和官网讲解流程
- [launch-copy.md](./launch-copy.md)
  - 中文/英文发布文案、GitHub Release Notes 和社区帖子模板
- [frontend-redesign-requirements.md](./frontend-redesign-requirements.md)
  - 当前前端功能盘点、前后端耦合点和重设计基线
- [npm-packaging.md](./npm-packaging.md)
  - npm 包结构、平台二进制分发和 CLI 解析顺序
- [github-release-checklist.md](./github-release-checklist.md)
  - GitHub 上传、CI/Release 配置和正式发版前检查项
- [frontend-redesign-final-audit.md](./frontend-redesign-final-audit.md)
  - 当前 WebUI 重构后的功能、视觉与回归审计结果
- [frontend-redesign-implementation-map.md](./frontend-redesign-implementation-map.md)
  - Pencil 画板、页面实现入口与 Playwright 回归入口
- [api-key-max-concurrency.md](./api-key-max-concurrency.md)
  - API Key 单 Key 最大并发限制：语义、数据库变更、内存追踪、429 响应和管理台 UI

如果后续继续补文档，优先遵守这条规则：

- 设计类内容写进 `system-design.md`
- 存储和兼容明细写进 `database-schema.md` 与 `api-compatibility.md`
- 交付和发版类内容写进 `npm-packaging.md` 或 `github-release-checklist.md`
- 不再保留阶段性 todo 或一次性迁移计划文档
