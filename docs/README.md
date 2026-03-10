# Docs

当前文档按下面几类维护：

- [system-design.md](./system-design.md)
  - 系统目标、兼容性边界、模块拆分、请求链路、数据存储和运行模型
- [database-schema.md](./database-schema.md)
  - 本地目录结构、SQLite 表设计和兼容迁移策略
- [api-compatibility.md](./api-compatibility.md)
  - 对外 HTTP 接口、别名路径和当前兼容范围
- [npm-packaging.md](./npm-packaging.md)
  - npm 包结构、平台二进制分发和 CLI 解析顺序
- [github-release-checklist.md](./github-release-checklist.md)
  - GitHub 上传、CI/Release 配置和正式发版前检查项

如果后续继续补文档，优先遵守这条规则：

- 设计类内容写进 `system-design.md`
- 存储和兼容明细写进 `database-schema.md` 与 `api-compatibility.md`
- 交付和发版类内容写进 `npm-packaging.md` 或 `github-release-checklist.md`
- 不再保留阶段性 todo 或一次性迁移计划文档
