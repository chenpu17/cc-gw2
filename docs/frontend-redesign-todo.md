# Frontend Redesign TODO

> 生成日期：2026-03-19
>
> 配套文档：
> - `docs/frontend-redesign-requirements.md`
> - `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`

## 目标

这份 TODO 不是“灵感清单”，而是后续前端重设计、重开发、联调、验收的执行单。

目标只有两个：

- 新前端完整覆盖当前产品能力
- 新前端在信息架构、视觉、交互和实现上可持续维护

## 当前状态快照

- [x] 需求基线文档已沉淀到 `docs/frontend-redesign-requirements.md`
- [x] 开发计划已沉淀到 `docs/frontend-redesign-development-plan.md`
- [x] Pencil 当前主设计稿已切换并沉淀到 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`
- [x] 主画板与关键规格稿已经过一轮业务语义复核
- [x] 前端基础骨架已开始落地：
  - [x] 路由定义集中化
  - [x] RequireAuth 独立组件化
  - [x] QueryClient 默认策略统一
  - [x] query keys 注册表落地
  - [x] App Shell 导航与路由元数据对齐
- [x] 基础设施第二批收口已开始：
  - [x] auth service 抽离
  - [x] Events 页面迁移到统一 query 数据流
  - [x] API/request 解包能力收口
  - [x] localStorage key 注册表开始落地
- [x] 高风险页拆层已开始：
  - [x] Logs service 抽离
  - [x] Model Management service 抽离第一版
  - [x] Gateway config 访问边界抽离第一版
- [x] Sprint A 继续推进：
  - [x] settings service 抽离
  - [x] apiKeys service 抽离
  - [x] 通用 mutation 封装落地第一版
- [x] Sprint B 已开始：
  - [x] Logs filters card 抽离
  - [x] Logs table card 抽离
  - [x] Logs detail drawer 抽离
  - [x] Logs row / shared utils 抽离
- [x] Sprint C 第一轮已开始：
  - [x] Model Management page container 收口
  - [x] providers workspace 抽离
  - [x] routing workspace 抽离
  - [x] test connection / preset diff / endpoint drawer 拆到独立组件
  - [x] Model Management 状态与动作收口到独立 hook
  - [x] tabs/card 总览、providers workspace、routing workspace 已回接并通过类型检查
- [x] Sprint D 第一轮已开始：
  - [x] Settings page container 收口
  - [x] Settings sections / sticky save bar / state hook 拆出
  - [x] API Keys inventory / analytics / dialogs / state hook 拆出
  - [x] Settings / API Keys 已回接并通过类型检查与构建
- [x] Batch 1 第一批已开始：
  - [x] Logs page container 收口
  - [x] Logs query/filter state hook 抽出
  - [x] Logs export hook 抽出
  - [x] Logs detail state hook 抽出
  - [x] Logs table preferences hook 抽出
  - [x] Logs 详情从右侧抽屉改为弹层表达
  - [x] Logs 默认宽表列信息补强
  - [x] Logs filters / table / detail modal 视觉已继续增强
  - [x] Logs Playwright 回归已补齐一条主链路
  - [x] Logs 已回接并通过类型检查与构建
- [x] Batch 2 第一轮已继续推进：
  - [x] Model Management 页面头部固定为稳定控制台语义，不再随 tab 漂移
  - [x] Providers / system routing / custom endpoints 的关系表达已复核并重新分组
  - [x] 自定义端点已补回显式编辑入口，不再只有切换/删除
  - [x] Routing workspace 已调整为“路由编辑优先，模板收纳在后”
  - [x] Route rows 已补移动端堆叠布局
  - [x] Endpoint drawer / test dialog / preset diff dialog 视觉一致性已继续增强
  - [x] Endpoint drawer 创建/更新后已主动刷新 custom endpoints 查询，避免 UI 延迟回显
  - [x] Model Management Playwright 已补一条主链路，覆盖 provider create、endpoint create/edit、route save、preset save/apply
  - [x] Model Management 当前改动已通过类型检查与构建
- [x] Batch 3 第一轮已继续推进：
  - [x] Settings 页头、overview、section nav、内容区层次已继续收口
  - [x] Settings sticky save bar 与 protocol restart 提示已继续增强
  - [x] Settings danger zone / config file 表达已继续增强
  - [x] Settings 保持 manual save，不回退为 autosave
  - [x] API Keys 页头、analytics、inventory、dialogs 视觉已继续增强
  - [x] API Keys wildcard / restricted / unrestricted 语义区分已继续增强
  - [x] Settings Playwright 已补一条保存主链路
  - [x] Settings / API Keys 当前改动已通过类型检查与构建
- [x] Batch 4 / 5 / 6 本轮已继续推进：
  - [x] Dashboard 已拆到 page container + state hook + sections
  - [x] Dashboard 已保留 endpoint filter、聚合 refresh、compact DB 独立动作
  - [x] Events 已按新视觉重构，并保留 cursor + level/type filter 语义
  - [x] Help / About / Login 已完成一轮视觉增强与层级收口
  - [x] 通用 empty / loading 状态组件已落地到 `PageState`
  - [x] `Loader` / `PageSection` / `AppLayout` 已完成一轮共享壳层增强
  - [x] Dashboard / Events / About / Login 等改动已通过类型检查、构建与 Playwright 回归
- [x] Pencil 视觉主稿已继续补齐并重绘：
  - [x] Dashboard / Logs / Model Management / API Keys / Settings / Events / Help / About / Login 已在 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen` 建立主画板
  - [x] Model Management 已明确表达 provider pool / built-in routing / custom endpoints / presets 的单工作区关系
  - [x] API Keys 已明确表达 wildcard / restricted / unrestricted 与 quick start / analytics / inventory 的关系
  - [x] Settings 已明确表达 overview / section nav / manual save / restart required / cleanup vs clear-all
  - [x] Shared States & Dialogs 参考板已补齐 loading / empty / filtered empty / destructive error / confirm / success / detail modal / form drawer
- [x] 当前轮次的前端重开发与联调已完成首轮闭环：
  - [x] `pnpm --filter @cc-gw/web exec tsc --noEmit`
  - [x] `pnpm --filter @cc-gw/web build`
  - [x] `pnpm exec playwright test tests/playwright/pages.spec.ts tests/playwright/auth.spec.ts tests/playwright/logs.spec.ts tests/playwright/model-management.spec.ts tests/playwright/settings.spec.ts tests/playwright/api-keys.spec.ts --reporter=line`
  - [x] `pnpm exec playwright test tests/playwright/visual.spec.ts --update-snapshots --reporter=line`
  - [x] `pnpm exec playwright test tests/playwright/hardening.spec.ts --reporter=line`
  - [x] `pnpm exec playwright test --reporter=line`

## 当前剩余执行清单

本轮主线已经完成，下面先记录最终收口结果，再补一份后续若继续推进时可直接执行的增强清单。

### 最终剩余 TODO（建议直接按这个顺序一次性推进）

这一段替代零散补丁式推进，作为后续最后一轮 WebUI 重构收口的主清单：

#### Phase A：Logs 最后一轮收口

- [x] `LA1` 复核 `src/web/src/pages/logs/` 当前状态边界，确认 query / export / detail / preference 的职责没有再回流到页面容器
- [x] `LA2` 补齐 Logs 空态 / 错态 / loading / skeleton 在筛选、导出、详情弹层中的统一表达
- [x] `LA3` 收口 Logs 通用表格壳层依赖，减少页面内自持的 density / scroll hint / column persistence 逻辑
- [x] `LA4` 补一轮 Logs 行为回归：筛选组合、列控制、详情弹层、导出、复制、分页/偏移联动

#### Phase B：Model Management / Settings / API Keys 最后一轮收口

- [x] `MB1` 为 Model Management 补剩余 Playwright 主链路：provider edit/delete、test connection、route reset、preset delete
- [x] `MB2` 继续复核模型管理页面的业务表达，确保 provider pool / built-in routing / custom endpoint routing / preset 的语义不漂移
- [x] `SB1` 为 Settings 补全回归：auth save、cleanup logs、clear logs、copy config path、protocol restart hint
- [x] `KB1` 为 API Keys 补全回归：reveal/hide/copy、edit endpoints、enable/disable、delete、analytics range
- [x] `KB2` 统一 API Keys 成功弹层、限制端点弹层、危险操作确认弹层的状态反馈与视觉层级

#### Phase C：基础设施最终收口

- [x] `IC1` 抽象通用 table shell：horizontal scroll hint / density / column persistence / sticky affordance
- [x] `IC2` 完成 `src/web/src/services/storageKeys.ts` 收口，统一 theme / logs / dashboard / page-scoped persistence key
- [x] `IC3` 复核 `useAppMutation`、toast、invalidate、error mapping 的一致性，消除页面各自补丁逻辑
- [x] `IC4` 复核 PageHeader / PageSection / PageState / ConfirmDialog / Dialog / Drawer 的视觉与交互一致性

#### Phase D：响应式与可用性最终收口

- [x] `RD1` 逐页检查 desktop / tablet / mobile 下的主导航、抽屉、表格、弹层、表单布局（本轮已完成关键高风险页的逐页走查与断点修补）
- [x] `RD2` 重点补齐 Logs / Models / Settings / API Keys 在窄屏下的操作可达性与滚动体验（本轮已补页头动作区、筛选条、分段控件、卡片操作区与 sticky bar）
- [x] `RD3` 复核 Dashboard / Events / Help / About / Login 的首屏层级、按钮密度、色彩与可读性（本轮已完成低风险页首屏动作区、登录首屏与运行态卡片的审查与优化）
- [x] `RD4` 统一页面级 empty / loading / destructive 状态的文案与交互动作（本轮已补 Dashboard / Events / About 的错误态与 PageState tone 表达）

#### Phase E：最终验收与文档冻结

- [x] `QA1` 跑完整类型检查、构建、关键 Playwright 套件并记录结果
- [x] `QA2` 复核 `/ui` basename、SPA fallback、深链访问、登录回跳、首屏 chunk 可用性
- [x] `QA3` 对照 `docs/frontend-redesign-requirements.md`、Pencil 主稿、实际实现做最终一致性核对（当前已基于 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen` 建立新主稿并完成逐页语义复核）
- [x] `QA4` 回写 `docs/frontend-redesign-todo.md` 与 `docs/frontend-redesign-development-plan.md`，冻结最后一轮收口结果

### 后续增强清单

这一段不再是阻塞项，而是后续如果继续打磨 WebUI 可直接接着做的增强单：

- [x] `N1` 收口 Logs：query / export / detail payload / detail modal 状态与动作
- [x] `N2` 对齐 Logs 到 Pencil 主稿：宽表、更多列、列控制、详情弹层、导出入口
- [x] `N3` 对齐 Model Management 到 Pencil 主稿：单工作区、providers/routing 切换、关系表达与表单层次
- [x] `N4` 对齐 Settings 到 Pencil 主稿：overview、section nav、sticky save bar、danger zone 视觉层级
- [x] `N5` 对齐 API Keys 到 Pencil 主稿：inventory、analytics、create/edit dialogs、wildcard 提示表达
- [x] `N6` 拆 Dashboard：overview / charts / ops card / recent requests
- [x] `N7` 对齐 Dashboard 与 Events / Help / About / Login 到 Pencil 主稿
- [x] `N8` 补全移动端抽屉、响应式断点、空态 / 错态 / 骨架屏（本轮完成共享状态组件与关键页响应式收口）
- [x] `N9` 全量联调回归：auth / logs / model management / api keys / settings / dashboard
- [x] `N10` 验收 `/ui` basename、SPA fallback、深链、构建产物与 chunk 拆分
- [x] `N11` 基于最终视觉稿补一轮页面级截图回归，覆盖 Dashboard / Logs / Models / API Keys / Settings / Login
- [x] `N12` 继续补低频危险路径 E2E：protocol HTTPS 配置、Help 代码复制、About 刷新运行态

### 后续执行顺序建议

如果后面继续做增强，建议严格按下面顺序跑：

1. 先做 Pencil 到代码的细节视觉微调
2. 再做发版前 smoke test 与交付物归档
3. 最后补设计交付截图与发布说明

### 全量一次性执行总清单

这一段是“从现在开始一直做到这一轮 WebUI 重构收口”为止的完整主线。

#### Batch 1：Logs 完整收口

- [x] `L1` 收口 Logs page container，只保留页面编排
- [x] `L2` 抽 Logs query/filter state hook
- [x] `L3` 抽 Logs export hook，保留 ZIP 导出与当前筛选条件联动
- [x] `L4` 抽 Logs detail hook，保留 payload copy / metadata 展示 / request-response 结构
- [x] `L5` 收口 columns / density / horizontal scroll hint / localStorage persistence
- [x] `L6` 保留宽表优先策略，补更多列信息，不回退成少列卡片视图
- [x] `L7` 保留“详情弹层”而不是右侧常驻详情栏
- [x] `L8` 按 Pencil 主稿替换 Logs 的 table / filters / detail modal 视觉结构（当前先完成前端侧第一轮落地）
- [x] `L9` 回归 Logs 查询、筛选、导出、详情、复制、列控制（当前已补主链路 Playwright + 类型检查 + 构建）

#### Batch 2：Model Management 视觉与表达收口

- [x] `M1` 复核当前 providers / routing / custom endpoints 的真实业务关系表达
- [x] `M2` 按 Pencil 主稿替换 overview card、tabs/card 切换与单工作区布局
- [x] `M3` 优化 providers workspace 的信息层次、状态标签、操作入口
- [x] `M4` 优化 routing workspace 的 preset、route editor、validation 提示表达
- [x] `M5` 优化 provider drawer / endpoint drawer / test connection / diff dialog 视觉一致性
- [x] `M6` 保留“单工作区 + tabs/card 切换上下文”，不回退成多列并排编辑
- [x] `M7` 回归 provider create/edit/delete、test connection、route save/reset、preset apply/save/delete

#### Batch 3：Settings 与 API Keys 视觉收口

- [x] `S1` 按 Pencil 主稿替换 Settings overview、section nav、content sections 视觉骨架
- [x] `S2` 优化 sticky save bar、restart required 提示与 danger zone 层次
- [x] `S3` 保留 manual save 语义，不改成 autosave
- [x] `S4` 回归 Settings 的 config save、auth save、cleanup、clear all、copy config path
- [x] `K1` 按 Pencil 主稿替换 API Keys analytics、inventory、dialogs 视觉骨架
- [x] `K2` 优化 wildcard key、restricted key、unrestricted key 的视觉区分表达
- [x] `K3` 优化 reveal/hide/copy、create success dialog、endpoint restriction dialog 的状态表现
- [x] `K4` 保留 wildcard 特殊语义与 `null = unrestricted`
- [x] `K5` 回归 API Keys create / reveal / hide / copy / edit endpoints / enable-disable / delete / analytics range

#### Batch 4：Dashboard 与低风险页面迁移

- [x] `D1` 拆 Dashboard page container，只保留页面装配
- [x] `D2` 抽 overview / charts / ops card / recent requests 子模块
- [x] `D3` 保留 header `Refresh` 聚合刷新与 compact DB 独立动作
- [x] `D4` 按 Pencil 主稿替换 Dashboard 视觉结构
- [x] `D5` 对齐 Events 页面到 Pencil 主稿，同时保留 cursor 翻页语义
- [x] `D6` 对齐 Help / About / Login 到 Pencil 主稿
- [x] `D7` 回归 Dashboard refresh / compact / endpoint filter、Events filter / pagination、Login auth redirect

#### Batch 5：基础设施与通用壳层收尾

- [x] `I1` 收口通用 empty / error / loading 状态组件
- [x] `I2` 收口通用 table shell：horizontal scroll hint / density / column persistence
- [x] `I3` 收口 storage keys，覆盖 theme / logs / dashboard / page-scoped persistence
- [x] `I4` 统一 mutation toast / invalidate / error mapping 细节
- [x] `I5` 复核 App Shell、PageHeader、PageSection、ConfirmDialog、Dialog 的一致性（本轮已完成 App Shell / PageHeader / PageSection / Loader / PageState 的一轮统一）
- [x] `I6` 补桌面侧栏、移动端抽屉、页面头部在各页的一致行为（本轮已完成关键页头与壳层一致性收口）

#### Batch 6：响应式、联调、验收

- [x] `R1` 补移动端与平板断点下的导航、表格、弹层、表单布局
- [x] `R2` 补空态、错态、骨架屏在 Dashboard / Logs / Models / API Keys / Settings 的覆盖（本轮继续补齐 Dashboard / Events / About / Login）
- [x] `R3` 全量联调 auth / logs / model management / api keys / settings / dashboard
- [x] `R4` 回归 `/login` 回跳、`/ui` basename、SPA fallback、深链访问
- [x] `R5` 校验构建产物、关键 chunk 拆分与首屏页面可用性
- [x] `R6` 按“需求文档 vs Pencil 稿 vs 实现结果”做最终一致性核对（当前已基于 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen` 建立新主稿并完成页面语义复核）

### 一次性推进建议

这一段原本用于执行期排顺序；当前轮次已经完成，因此只保留结论：

1. 高风险页优先收口的策略是正确的
2. 先基础设施、再页面、最后回归验收的顺序是正确的
3. 后续若再开启新一轮重构，可继续沿用 `Batch 1 -> Batch 6` 的推进方式

> 说明：下面这部分原本是历史拆解底稿。随着当前轮次已经完成收口，为避免继续保留大量“实际上已完成但未回写”的旧未勾选项，这里改成归档结论。

## 历史拆解归档

以下历史大项在当前轮次已完成，不再作为活跃 TODO：

- [x] 基础设施收口：`services`、`queryKeys`、`storageKeys`、通用 mutation、`PageState`、`DialogShell`、表格横向滚动提示与 density/column persistence 壳层
- [x] 高风险页面拆层：Logs / Model Management / Settings / API Keys 已完成页面容器、状态 hook、关键弹层和业务动作收口
- [x] 视觉骨架替换：Dashboard / Logs / Model Management / API Keys / Settings / Events / Help / About / Login 已完成当前轮次新视觉落地
- [x] 响应式收口：桌面端与关键移动端断点已完成主导航、页头动作区、表格、弹层、sticky save bar 与主要表单布局修正
- [x] 联调、回归、构建验收：类型检查、构建、核心 Playwright、视觉快照与低频危险路径回归均已通过
- [x] 设计冻结与对照：`cc-gw.pen`、需求文档、实现映射、最终审计与 WebUI 对照审计已全部落文档

## 非阻塞补充核验

下面这些不是当前轮次阻塞项，后续如果继续发版级打磨，可按需追加：

- [x] 补一轮静态资源缓存策略核验：HTML `no-store`、静态资源 `immutable`（2026-03-19 已实际请求核验 `/ui/`、`/ui/logs`、`/ui/not-found`、`/assets/About-DPiXWhNl.js`）
- [ ] 如后续视觉继续演进，再更新 `tests/playwright/visual.spec.ts-snapshots/` 与 `docs/assets/cc-gw-pen-compare/`
- [ ] 如后端接口继续扩展，再追加对应的契约回归与需求文档修订

## 当前完成定义

按当前文档、实现与验证结果，这一轮 WebUI 重构已满足完成定义：

- [x] 所有顶层页面已切到当前新实现
- [x] 所有关键业务规则与旧前端一致
- [x] 核心后端接口契约已通过联调与回归覆盖
- [x] 所有主状态与危险操作可正常走通
- [x] 移动端与桌面端均可用
- [x] 视觉稿、需求文档、实现结果三者已完成对照闭环
