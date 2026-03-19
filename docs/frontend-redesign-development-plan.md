# Frontend Redesign Development Plan

> 生成日期：2026-03-19
>
> 关联文档：
> - `docs/frontend-redesign-requirements.md`
> - `docs/frontend-redesign-todo.md`
> - `docs/frontend-redesign-final-audit.md`
> - `docs/frontend-redesign-webui-vs-cc-gw-pen-audit.md`
> - `docs/frontend-redesign-pencil-handoff.md`
> - `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`

## 1. 开发目标

本计划用于指导前端整体重设计、重开发的实际执行。

核心目标：

- 完整覆盖当前前端已承载的业务能力
- 在不破坏后端契约的前提下完成 UI/交互/代码结构升级
- 让后续前端具备可持续迭代能力，而不是一次性重写

## 1.1 当前状态

- Stage 0 的文档冻结已完成
- `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen` 已作为当前主设计稿继续推进，并完成一轮主画板语义校正
- Stage 1 已开始落地第一批基础设施：
  - 路由定义集中化
  - `RequireAuth` 独立组件化
  - QueryClient 默认策略统一
  - query keys 注册表落地
  - App Shell 导航与路由元数据统一
- Stage 1 第二批已继续推进：
  - auth service 抽离
  - Events 页面迁移到统一 query 数据流
  - API response 解包与基础请求能力继续收口
- Stage 2 的前置拆层也已开始：
  - Logs service 抽离
  - Model Management service 抽离第一版
  - Gateway config 访问边界抽离第一版
- Sprint A 基础设施收口继续推进：
  - settings service 抽离
  - apiKeys service 抽离
  - 通用 mutation 封装落地第一版
- Sprint B / Sprint C 已进入高风险页拆层：
  - Logs page 已拆到 filters / table / detail drawer / row 模块
  - Model Management 已拆到 overview / providers workspace / routing workspace / dialogs / state hook
- Sprint D 第一轮拆层已继续推进：
  - Settings 已拆到 sections / sticky save bar / state hook
  - API Keys 已拆到 analytics / inventory / dialogs / state hook
- Batch 1 第一批拆层已开始：
  - Logs 已拆到 page container / query-filter state hook / export hook / detail state hook
  - Logs table preferences 与 detail modal 表达已继续收口
  - Logs 已补一条 Playwright 主链路回归，覆盖 filters / detail / export 基础流程
- Batch 2 第一轮视觉收口已继续推进：
  - Model Management 已切回稳定页头 + 单工作区表达
  - providers / system routing / custom endpoints 的关系已按资源与路由上下文重新分组
  - custom endpoint 已补回编辑入口
  - routing workspace 已调整为路由编辑优先、presets 次级收纳
  - route rows 已补响应式堆叠布局
  - endpoint drawer / test dialog / preset diff dialog 已继续统一视觉层级
  - endpoint drawer 创建/更新后会主动刷新 custom endpoints 查询，避免列表回显滞后
  - 已补一条 Model Management Playwright 主链路，覆盖 provider create、endpoint create/edit、route save、preset save/apply
- Batch 3 第一轮视觉收口已继续推进：
  - Settings 已继续收口到稳定页头、overview、section nav、sticky save bar 与 danger zone 表达
  - Settings 已保持 manual save 语义，并补一条 config save Playwright 主链路
  - API Keys 已继续增强 analytics、inventory、dialogs 的视觉层次
  - API Keys 已强化 wildcard / restricted / unrestricted 的业务语义表达
- Batch 4 / Batch 5 / Batch 6 本轮已继续推进：
  - Dashboard 已拆成 page container + state hook + sections，并保留 endpoint filter、聚合 refresh、compact DB 独立动作
  - Events 已按新视觉重构，同时保留 cursor 分页与 level/type filter 语义
  - Help / About / Login 已完成一轮视觉增强与层级收口
  - PageState / Loader / PageSection / AppLayout 已完成一轮共享壳层统一
- 当前基线验证保持通过：
  - `pnpm --filter @cc-gw/web exec tsc --noEmit`
  - `pnpm --filter @cc-gw/web build`
  - `pnpm exec playwright test tests/playwright/pages.spec.ts tests/playwright/auth.spec.ts tests/playwright/logs.spec.ts tests/playwright/model-management.spec.ts tests/playwright/settings.spec.ts tests/playwright/api-keys.spec.ts`
- 当前轮次的 WebUI 重构已完成首轮闭环，后续重点转为发版级加固、视觉微调与截图回归
- 2026-03-19 新增两类发版级回归资产：
  - `tests/playwright/visual.spec.ts`：覆盖 Dashboard / Logs / Model Management / API Keys / Settings / Events / Help / About / Login 的页面级截图基线
  - `tests/playwright/hardening.spec.ts`：覆盖 HTTPS protocol 保存、Help 代码复制、About 手动刷新与检查更新反馈
- 2026-03-19 最新全量验证已再次通过：
  - `pnpm --filter @cc-gw/web exec tsc --noEmit`
  - `pnpm --filter @cc-gw/web build`
  - `pnpm exec playwright test --reporter=line`

## 1.2 本轮收口结论与后续增强计划

本轮一次性收口已经完成，截图回归与低频危险路径 E2E 也已补齐；后续如果继续推进，建议按下面 5 个方向做增强而不是回到零散补丁模式：

### Final Pass A：Logs 终局收口

- 收口 `src/web/src/pages/logs/` 的状态与动作边界
- 抽通用表格壳层，避免 Logs 独占 density / column persistence / scroll hint 逻辑
- 补齐 Logs 最后一轮视觉一致性与交互回归

### Final Pass B：Models / Settings / API Keys 回归补完

- 补足 Model Management 剩余编辑、删除、reset、preset delete 回归
- 补足 Settings 的 auth save / cleanup / clear logs / copy config path 回归
- 补足 API Keys 的 reveal / hide / copy / edit restriction / toggle / delete / analytics range 回归

### Final Pass C：基础设施统一

- 收口 `storageKeys`
- 收口通用 mutation、toast、invalidate、error mapping
- 统一 PageHeader / PageSection / PageState / Dialog / ConfirmDialog / Drawer 一致性

### Final Pass D：响应式与体验验收

- 逐页检查桌面、平板、移动端布局
- 重点检查表格、弹层、抽屉、表单和长列表可用性
- 逐页复核色彩、信息密度、空态、loading、danger 状态表达

### Final Pass E：最终验证与文档冻结

- 跑完整 typecheck / build / Playwright 套件
- 复核 `/ui` basename、深链、回跳、首屏 chunk 可用性
- 用需求文档、Pencil 稿、实现结果做最终一致性比对
- 回写并冻结计划与 TODO 文档

当前收口进展补记：

- 已补 `storageKeys` 注册表，统一 theme / language / dashboard endpoint / logs filters & page size / api keys analytics range 等页面级持久化键
- 已补通用持久化 hook 与 horizontal scroll hint hook，并回接 Logs / Dashboard / API Keys / Theme / Language
- Logs 已补 error empty state 与重试动作，表格滚动提示和分页偏好已继续收口
- Model Management 已复核并修正 Provider 删除时的路由影响面：
  - 保留 system endpoint validation 配置
  - 同步清理 custom endpoint routing 中引用被删除 provider 的目标
- Custom Endpoint 编辑器已补回 `openai-chat` / `openai-responses` 协议选项展示，避免信息架构继续收窄到 `openai-auto`
- 关键验证已再次通过：
  - `pnpm --filter @cc-gw/web exec tsc --noEmit`
  - `pnpm --filter @cc-gw/web build`
  - `pnpm exec playwright test tests/playwright/pages.spec.ts tests/playwright/auth.spec.ts tests/playwright/logs.spec.ts tests/playwright/model-management.spec.ts tests/playwright/settings.spec.ts tests/playwright/api-keys.spec.ts --reporter=line`
- 2026-03-19 收口补记：
  - Model Management / Logs / API Keys / Settings 的 Playwright 选择器已按当前重构后的真实交互更新
  - Settings cleanup / clear-all 确认弹层已补齐缺失的 i18n 标题与描述，避免界面直接显示 translation key
  - Model Management 内部保存路由 mutation 已统一切回 `useAppMutation`，前端侧已无残留裸 `useMutation` 页面补丁
  - 已新增 `DialogShell` 统一主要弹层壳层，并回接 ConfirmDialog、API Keys dialogs、Model Management dialogs、Logs detail modal
  - 已完成 Logs / Model Management / Settings / API Keys 的一轮窄屏响应式收口：页头动作区、筛选条、分段控件、卡片按钮区、sticky save bar 与 presets/action rows 已补齐移动端与平板适配
- 已完成 Dashboard / Events / About / Login 的首屏表达复核：补齐移动端动作区、登录移动端导览、Dashboard 首屏失败态、Events / About 内联错误态与统一 PageState tone
- 已完成 requirements vs implementation 的最终功能审计，并沉淀到 `docs/frontend-redesign-final-audit.md`
- 当前代码与 Pencil 主稿的主要闭环已经完成：已确认仓库内 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen` 为实际主设计稿，并完成 Dashboard / Logs / Model Management / API Keys / Settings / Events / Help / About / Login 以及状态/弹层规格稿组的页面级语义复核
  - 最新全量验证再次通过：
    - `pnpm --filter @cc-gw/web exec tsc --noEmit`
    - `pnpm --filter @cc-gw/web build`
    - `pnpm exec playwright test tests/playwright/pages.spec.ts tests/playwright/auth.spec.ts tests/playwright/logs.spec.ts tests/playwright/model-management.spec.ts tests/playwright/settings.spec.ts tests/playwright/api-keys.spec.ts --reporter=line`
  - 本轮响应式补丁后的定向验证已通过：
    - `pnpm --filter @cc-gw/web exec tsc --noEmit`
    - `pnpm --filter @cc-gw/web build`
    - `pnpm exec playwright test tests/playwright/logs.spec.ts tests/playwright/model-management.spec.ts tests/playwright/settings.spec.ts tests/playwright/api-keys.spec.ts --reporter=line`
  - 2026-03-19 最终验证补记：
    - Model Management 已按当前真实实现收口为页头唯一 “Add Endpoint” 入口，overview 区仅保留上下文摘要与工作区切换，不再制造重复主动作
    - 修正后再次执行 `pages + auth + logs + model-management + settings + api-keys` 全套 11 项测试，结果 `11 passed (28.1s)`

---

## 2. 总体策略

本次重做建议采用：

- 渐进式替换，而不是一次性推倒上线
- 先基础设施，后页面迁移
- 先高风险核心页，后说明性页面
- 先保证功能等价，再做体验增强

执行原则：

- 保持路由与后端接口契约不变
- 保持关键业务语义不变
- 保持旧功能可对照回归
- 将视觉升级、交互升级、代码结构升级同时完成

---

## 3. 推荐阶段划分

建议按 6 个阶段推进。

### Stage 0：方案冻结

目标：

- 锁定设计稿
- 锁定功能边界
- 锁定本期不做项

交付物：

- `docs/frontend-redesign-requirements.md`
- `docs/frontend-redesign-todo.md`
- `docs/frontend-redesign-development-plan.md`
- `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`

完成标准：

- 页面清单冻结
- 关键业务规则冻结
- 后端接口契约冻结
- 视觉主稿冻结

### Stage 1：基础设施重构

目标：

- 搭建新的前端骨架
- 为后续页面迁移打底

范围：

- App Shell
- Router
- Auth
- Query/Data Layer
- Toast / Confirm / Modal
- Table Shell
- Form Shell
- 状态组件

完成标准：

- 可以跑起新的壳层
- 登录、退出、受保护路由链路跑通
- 基础组件可支撑后续页面迁移

### Stage 2：高风险核心页迁移

目标：

- 优先迁移最复杂、最影响业务的页面

范围：

- Model Management
- Logs
- Settings
- API Keys

完成标准：

- 高风险页面核心能力全部可用
- 与后端契约联调通过
- 旧页面能力无明显回退

当前拆层进度：

- Logs：已完成第一轮组件化，但 query / export / detail 载荷流程仍需继续收口
- Model Management：已完成单工作区容器、providers / routing workspace、关键 dialogs/state hook，以及第一轮视觉与语义对齐
- Settings：已完成 sections + state hook + sticky save bar 第一轮收口，并完成第二轮视觉层次增强，保留手动保存与危险操作确认
- API Keys：已完成 analytics + inventory + create/reveal/edit/delete dialogs + state hook 第一轮收口，并完成第二轮 inventory / dialogs 视觉增强，保留 wildcard 与 `null = unrestricted` 语义
- Dashboard：已完成 page container / state hook / sections 模块化，以及第三轮视觉升级
- Events：已完成与新壳层对齐的一轮重构，保留 cursor 翻页与审计字段展示

### Stage 3：观测与说明页迁移

目标：

- 完成剩余页面迁移

范围：

- Dashboard
- Events
- Help
- About
- Login 视觉与交互收尾

完成标准：

- 所有顶层页面切到新实现
- 页面状态、空态、错误态完整

当前进度补充：

- Dashboard / Events / Help / About / Login 已完成一轮页面级迁移与视觉替换
- 登录页跳转、受保护路由回跳、导航深链与 `/ui` basename 已通过 Playwright 回归

### Stage 4：联调与回归

目标：

- 核对所有关键业务规则
- 处理前后端边界问题

范围：

- 所有 `/auth/*`
- 所有 `/api/*`
- 所有 query 参数
- 所有危险操作
- 所有导出/复制/弹层流程

完成标准：

- 联调问题清零
- 核心回归用例通过

当前进度补充：

- 已覆盖 `auth / logs / model management / api keys / settings / dashboard navigation` 主链路回归
- 当前剩余重点已转为表格通用壳层、storage keys 和更细粒度页面回归补强

### Stage 5：上线前收口

目标：

- 性能、构建、深链、缓存、移动端适配一起收口

范围：

- 构建产物验证
- `/ui` 路由验证
- `/assets` 资源验证
- 缓存策略验证
- 响应式验证

完成标准：

- 可上线版本 ready

---

## 4. 开发顺序建议

建议按下面顺序推进，避免返工：

1. Shell / Router / Auth / Data Layer
2. 公共组件与设计系统
3. Logs / Model Management / Settings / API Keys
4. Dashboard / Events
5. Help / About / Login
6. 联调 / 回归 / 构建部署检查

原因：

- Shell 和数据层不稳定，页面越早做越容易返工
- Logs、Models、Settings、API Keys 最复杂，应该优先暴露问题
- Help、About 风险最低，可放在后面收尾

---

## 5. 任务拆分建议

建议拆成 5 条并行主线。

### Track A：壳层与基础设施

- [ ] 重建 App Shell
- [ ] 重建导航体系
- [ ] 重建 Router
- [ ] 重建 AuthProvider / RequireAuth
- [ ] 统一 API client
- [ ] 统一 Query key / hooks
- [ ] 统一错误处理
- [ ] 统一状态组件

### Track B：设计系统与公共组件

- [ ] Button / Input / Select / Switch / Checkbox
- [ ] Card / Badge / Section Header
- [ ] Modal / Drawer / Confirm Dialog
- [ ] Table / Pagination / Column Visibility / Density Switch
- [ ] Code block / JSON viewer / Copy action
- [ ] 图表包装层

### Track C：核心业务页

- [ ] Logs
- [ ] Model Management
- [ ] API Keys
- [ ] Settings

### Track D：观测与说明页

- [ ] Dashboard
- [ ] Events
- [ ] Help
- [ ] About
- [ ] Login

### Track E：联调与验收

- [ ] 后端契约校验
- [ ] 回归用例验证
- [ ] 构建产物与部署路径验证
- [ ] 响应式验证

---

## 6. 周期建议

如果按正常节奏推进，建议按 4 个开发周期执行。

### Sprint 1：基础设施周

目标：

- 打通基础壳层
- 打通鉴权
- 落公共组件第一版

TODO：

- [ ] App Shell
- [ ] Router
- [ ] Auth
- [ ] Query/Data hooks
- [ ] Toast / Confirm / Modal
- [ ] 基础表单组件
- [ ] 基础卡片组件
- [ ] 基础状态组件

里程碑：

- 能进入主应用
- 能登录/退出
- 能渲染空白新页面骨架

### Sprint 2：核心页上半场

目标：

- 完成最复杂两页

TODO：

- [ ] Logs
- [ ] Model Management
- [ ] Logs 详情弹层
- [ ] Routing preset / diff / test dialog
- [ ] Custom endpoint 相关抽屉

里程碑：

- Logs 可用
- Models 可用
- 高复杂交互已经打通

### Sprint 3：核心页下半场

目标：

- 完成配置与访问控制页

TODO：

- [ ] API Keys
- [ ] Settings
- [ ] API Key reveal/hide/copy 状态机
- [ ] endpoint 限制 dialog
- [ ] sticky save bar
- [ ] cleanup / clear all 流程

里程碑：

- API Keys 可用
- Settings 可用
- 关键危险操作可回归

### Sprint 4：收口与上线准备

目标：

- 完成其余页面
- 完成联调与回归

TODO：

- [ ] Dashboard
- [ ] Events
- [ ] Help
- [ ] About
- [ ] Login 收尾
- [ ] 全链路联调
- [ ] 回归测试
- [ ] 构建部署验证

里程碑：

- 全页面切新
- 回归通过
- 可上线

---

## 7. 页面优先级

### P0 页面

这些页面必须优先做，风险最高：

- [ ] Model Management
- [ ] Logs
- [ ] Settings
- [ ] API Keys

### P1 页面

这些页面业务重要，但实现复杂度次一级：

- [ ] Dashboard
- [ ] Events
- [ ] Login

### P2 页面

这些页面适合在后半段收尾：

- [ ] Help
- [ ] About

---

## 8. 页面级开发 TODO

### 8.1 Logs

- [ ] 查询筛选器
- [ ] 快捷视图
- [ ] 宽表
- [ ] 列选择器
- [ ] 密度切换
- [ ] 导出 ZIP
- [ ] 详情弹层
- [ ] 载荷复制
- [ ] 与 Settings 的 payload 开关联动校验

### 8.2 Model Management

- [ ] 顶部 tabs/card 切换区
- [ ] providers workspace
- [ ] anthropic workspace
- [ ] openai workspace
- [ ] custom endpoint workspace
- [ ] Add Provider
- [ ] Add Endpoint
- [ ] Edit Provider Drawer
- [ ] Edit Endpoint Drawer
- [ ] provider test dialog
- [ ] preset diff dialog
- [ ] 删除影响范围提示

### 8.3 API Keys

- [ ] 搜索与状态筛选
- [ ] 统计卡
- [ ] Quick Start
- [ ] inventory 卡片
- [ ] 创建成功一次性明文展示
- [ ] reveal / hide / copy
- [ ] wildcard key 特殊处理
- [ ] endpoint 限制编辑
- [ ] 1/7/30 天统计

### 8.4 Settings

- [ ] Basics
- [ ] Protocol
- [ ] Security
- [ ] Config File
- [ ] Cleanup
- [ ] sticky save bar
- [ ] restart required 提示
- [ ] password rules
- [ ] cleanup / clear all confirm

### 8.5 Dashboard

- [ ] KPI 卡
- [ ] 趋势图
- [ ] 运行态卡
- [ ] DB info
- [ ] Compact DB
- [ ] 最近请求
- [ ] 骨架屏
- [ ] 分区 empty state

### 8.6 Events

- [ ] sticky filters
- [ ] level/type 筛选
- [ ] cursor 翻页
- [ ] refresh
- [ ] details 折叠区

### 8.7 Help

- [ ] anchor cards
- [ ] section renderer
- [ ] code block copy
- [ ] FAQ

### 8.8 About

- [ ] app info
- [ ] runtime status
- [ ] refresh
- [ ] update-check toast

### 8.9 Login

- [ ] 登录表单
- [ ] loading / error
- [ ] redirect back
- [ ] auth-disabled fallback

---

## 9. 依赖关系

### 强依赖

- Logs 依赖：
  - [ ] Table Shell
  - [ ] Column Visibility
  - [ ] Modal
  - [ ] JSON viewer
- Model Management 依赖：
  - [ ] Tabs
  - [ ] Drawer
  - [ ] Confirm Dialog
  - [ ] Form primitives
- API Keys 依赖：
  - [ ] Dialog
  - [ ] Card inventory patterns
  - [ ] Charts
- Settings 依赖：
  - [ ] Section Nav
  - [ ] Sticky Action Bar
  - [ ] Confirm Dialog

### 联调依赖

- [ ] `/auth/session`
- [ ] `/api/config`
- [ ] `/api/status`
- [ ] `/api/logs`
- [ ] `/api/events`
- [ ] `/api/providers`
- [ ] `/api/custom-endpoints`
- [ ] `/api/keys`

---

## 10. 风险清单

### R1：Model Management 逻辑误设计

风险：

- 很容易被误做成多栏并排编辑页

规避：

- 严格按“单工作区 + 上方切换”实现

### R2：Logs 详情侵占宽表空间

风险：

- 重新回到右侧常驻详情，导致表格可读性下降

规避：

- 详情只用 modal / overlay / 独立详情流

### R3：Settings 被误改成 autosave

风险：

- 破坏当前保存模型

规避：

- 保留 sticky save bar 与脏状态识别

### R4：API Key 权限语义被改坏

风险：

- 把空 endpoints 误当成“无权限”

规避：

- 明确保留 `null = unrestricted`

### R5：协议支持表达不完整

风险：

- 前端重做后把 `openai-chat` / `openai-responses` 扩展位做死

规避：

- UI 结构预留协议扩展

---

## 11. 联调检查单

- [ ] 登录/退出/跳回路径正确
- [ ] Dashboard endpoint query 生效
- [ ] Logs 查询参数与后端一致
- [ ] Logs 导出超时正确读取配置
- [ ] Events cursor 分页正确
- [ ] Provider test 支持 headers/query 诊断
- [ ] custom endpoint 多 path 正确保存
- [ ] routing preset diff 正确展示
- [ ] API Key endpoint 限制正确保存 `null`
- [ ] Settings restart required 动态判定正确

---

## 12. 验收标准

只有以下条件全部满足，才视为开发计划完成：

- [ ] 新前端覆盖所有顶层页面
- [ ] 所有关键业务规则与旧前端一致
- [ ] 所有接口契约联调通过
- [ ] 所有主要状态都已覆盖
- [ ] 所有危险操作都可回归
- [ ] 桌面端和移动端都可正常使用
- [ ] 设计稿、需求文档、代码实现三者一致

---

## 13. 最终执行建议

建议实际执行时采用下面方式：

- 先完成 Stage 0 和 Stage 1
- 再以 P0 页面为主线推进 Stage 2
- Stage 3 与 Stage 4 部分并行
- 最后统一做 Stage 5 收口

如果人员允许，最佳组织方式是：

- 1 人负责壳层/数据层/公共组件
- 1 人负责核心业务页
- 1 人负责联调/回归/收口

这样速度最快，返工也最少。
