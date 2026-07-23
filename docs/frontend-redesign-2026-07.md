# Frontend Redesign 2026-07

> 记录日期：2026-07-22
>
> 范围：Web 控制台信息架构重整、Dashboard 三层重构、Events 实时化、设计 token 规则
>
> 相关代码：`src/web/src/**`、`tests/playwright/**`

## 1. 信息架构

### 导航分组

侧边导航按职责分为三组：概览（仪表盘）、配置（请求日志、模型与路由、API 密钥、设置）、系统（事件、使用指南、关于）。分组标签来自 `nav.group.*`，路由定义集中在 `src/web/src/app/routes.tsx`。

### /models + /routing 合并为 /providers

原「模型供应商」与「路由管理」两个页面合并为单页工作台 `/providers`（`src/web/src/pages/ProvidersWorkbench.tsx` + `src/web/src/pages/workbench/*`）。旧路径 `/ui/models`、`/ui/routing` 通过 `<Navigate>` 301 到 `/ui/providers`，书签与深链不受影响。

工作台布局：

- 页头：端点 SegmentedControl（anthropic / openai / 自定义端点）+「端点管理」Popover（自定义端点的增删改）+「新增提供商」按钮。
- 左栏：Provider 卡片列表（搜索 + 类型筛选），点击卡片选中。
- 右栏：选中 Provider 的详情面板（编辑 / 测试连接 / 删除集中在这里，卡片不再内联操作）；未选中时显示当前端点已保存的路由表。
- 右栏下方：RoutingWorkspace —— 当前端点的路由映射编辑、路由模板（默认折叠）、端点校验/兼容策略（Disclosure 折叠）。

Provider 抽屉从 4 步精简为 2 步：基础与认证 → 模型与验证。新建 Provider 保存后自动选中，详情面板即时出现。

### /setup 冷启动向导

新增 `/setup`（`src/web/src/pages/setup/`）：面向首次部署的引导页，串起 Provider 配置、路由确认、API Key 创建三步。Dashboard 在无数据时显示新手引导卡（`DashboardGettingStarted`），可从卡片进入向导。

## 2. Dashboard 三层结构

`src/web/src/pages/Dashboard.tsx` + `dashboard/DashboardSections.tsx`：

1. **状态带（StatusBand）**：监听地址、Provider 数 + 4 个 MetricCard（活跃连接 / RPM / 1 小时活跃 IP / CPU）。`data-testid` 保留：`dashboard-spotlight-grid`、`dashboard-overview-panel`、`dashboard-runtime-address`。
2. **需要关注（AttentionFeed）**：SSE 实时推送的 warn/error 事件流，空态为「一切正常」；可跳转 /events。
3. **趋势与详情**：单张 14 天请求趋势图；「性能详情」（模型分布、TTFT/TPOT 对比、模型性能表）与「系统资源」（网络/DB/内存 + 释放数据库空间按钮）收进两个默认折叠的 Disclosure。最近请求表保留在页尾。

注意：折叠的 Disclosure 内容仍挂载在 DOM（`data-testid="dashboard-spotlight-value-*"` 共 7 个），但对用户不可见；e2e 断言可见性前需先点击对应 `<summary>` 展开。

## 3. SSE 实时化

- Events 页（`src/web/src/pages/Events.tsx`）改为 SSE 实时流（`GET /api/events/stream`，封装在 `src/web/src/hooks/useEventStream.ts`）：新事件 prepend 到 REST 快照上并按 id 去重；工具栏显示「实时更新中 / 重连中」状态，手动刷新按钮只在断连时出现。
- 级别筛选从下拉改为 SegmentedControl；类型筛选从自由文本输入改为枚举下拉（选项来自已见事件的 type 聚合）。
- Dashboard 的「需要关注」区复用同一 SSE 通道（仅 warn/error）。

## 4. 设计 token 规则

定义在 `src/web/src/styles/global.css`，Tailwind 主题通过 CSS 变量引用：

- **状态色双语义**：每个状态色成对提供前景与底色变量（如 `--success` / `--success-bg`、`--warning` / `--warning-bg`、`--error` / `--error-bg`），Badge、状态点、卡片描边统一用「前景 + 同色浅底」组合，禁止散落的一次性色值。
- **图表色接变量**：ECharts 调色板统一走 `--chart-1` … `--chart-5`，明暗两套主题各自覆盖，图表组件不硬编码 hex。
- **两级圆角**：容器/卡片用 `rounded-xl`，内部嵌套元素（输入框、徽章、次级面板）用 `rounded-lg`，保持「外壳大圆角、内容小圆角」的层级关系。

## 5. 其他页面调整

- **Logs**：移动端改为卡片视图（`md` 断点以下渲染 LogCard 列表）；筛选面板默认展开（按钮文案变为「收起筛选」）；详情弹窗的 payload 区改为 Tabs（客户端请求体 / 上游请求体 / 上游响应体 / 客户端响应体，Radix 只挂载激活 tab）。
- **Settings**：各 Section 内的独立保存按钮移除，统一走底部 StickySettingsSaveBar（脏项计数 + 重置 + 保存），配置与安全设置一次保存提交。
- **i18n**：语言包按功能拆分到 `src/web/src/i18n/locales/{zh,en}/` 下的独立文件（如 `workbench.ts`、`providers.ts`、`events.ts`），不再维护单一大字典。

## 6. 测试与基线

- Playwright spec 同步更新：选择器与前置操作路径按新 UI 重写，断言意图（功能覆盖）不变。
- 视觉基线（`tests/playwright/visual.spec.ts-snapshots`）已按本轮有意 UI 变更刷新：`/ui/models`、`/ui/routing` 两个快照改为 `/ui/providers` 工作台（列表态 + 选中详情态）。
