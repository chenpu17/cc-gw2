# Frontend Redesign Implementation Map

> 生成日期：2026-03-19
>
> 作用：把当前前端实现、Pencil 主稿和后续开发入口对应起来

## 对照原则

这份文档不是需求说明，而是给后续开发直接找入口用的实现地图。

默认对照顺序：

1. 先看 `docs/frontend-redesign-requirements.md`
2. 再看 `docs/frontend-redesign-pencil-board-index.md`
3. 最后按本文件进入具体代码目录

## 全局壳层

| 能力 | 代码入口 |
| --- | --- |
| 路由定义 | `src/web/src/app/routes.tsx` |
| Router / basename / RequireAuth 装配 | `src/web/src/app/router.tsx` |
| 页面壳层 / 侧栏 / 顶部栏 | `src/web/src/layouts/AppLayout.tsx` |
| 页面头部 | `src/web/src/components/PageHeader.tsx` |
| 页面区块容器 | `src/web/src/components/PageSection.tsx` |
| 页面空态 / 错态 / loading | `src/web/src/components/PageState.tsx` |
| Dialog 壳层 | `src/web/src/components/DialogShell.tsx` |
| 全局主题与视觉 token | `src/web/src/styles/global.css` |

## 页面到画板到代码

| 页面 | Pencil 画板 | 页面入口 | 主要子模块 |
| --- | --- | --- | --- |
| Dashboard | `35hVw` | `src/web/src/pages/Dashboard.tsx` | `src/web/src/pages/dashboard/` |
| Logs | `m9KBD` | `src/web/src/pages/Logs.tsx` | `src/web/src/pages/logs/` |
| Model Management | `4Xi2W` | `src/web/src/pages/ModelManagement.tsx` | `src/web/src/pages/model-management/`, `src/web/src/pages/providers/` |
| API Keys | `LHySw` | `src/web/src/pages/ApiKeys.tsx` | `src/web/src/pages/api-keys/` |
| Settings | `YLPhl` | `src/web/src/pages/Settings.tsx` | `src/web/src/pages/settings/` |
| Events | `dfplC` | `src/web/src/pages/Events.tsx` | 页面内聚合实现为主 |
| Help | `De4DR` | `src/web/src/pages/Help.tsx` | 页面内聚合实现为主 |
| About | `FNOoh` | `src/web/src/pages/About.tsx` | 页面内聚合实现为主 |
| Login | `1UGHX` | `src/web/src/pages/Login.tsx` | 页面内聚合实现为主 |

## 高风险页优先入口

### Logs

- 页面入口：`src/web/src/pages/Logs.tsx`
- 状态：`src/web/src/pages/logs/useLogsPageState.ts`
- 表格偏好：`src/web/src/pages/logs/useLogsTablePreferences.ts`
- 导出：`src/web/src/pages/logs/useLogExport.ts`
- 详情：`src/web/src/pages/logs/useLogDetailState.ts`
- 主要视图：
  - `src/web/src/pages/logs/LogsFiltersCard.tsx`
  - `src/web/src/pages/logs/LogsTableCard.tsx`
  - `src/web/src/pages/logs/LogDetailsDrawer.tsx`（文件名沿用旧命名，但当前实现是 dialog/modal，不再是右侧常驻详情栏）

### Model Management

- 页面入口：`src/web/src/pages/ModelManagement.tsx`
- 状态：`src/web/src/pages/model-management/useModelManagementState.ts`
- 总览卡：`src/web/src/pages/model-management/ModelManagementOverviewCard.tsx`
- providers workspace：`src/web/src/pages/model-management/ProvidersWorkspace.tsx`
- routing workspace：`src/web/src/pages/model-management/RoutingWorkspace.tsx`
- provider drawer：`src/web/src/pages/providers/ProviderDrawer.tsx`
- endpoint drawer：`src/web/src/pages/model-management/EndpointDrawer.tsx`
- 业务语义：单工作区结构；`Add Endpoint` 只保留页头入口，`Add Provider` 只在 providers workspace 内出现，providers 与 routing 通过当前 workspace 切换表达
- Pencil 变体参考：
  - `HPCKv` `cc-gw Model Management - Routing Active`
  - `Gs19Z` `cc-gw Model Management - OpenAI Routing`
  - `L97Mo` `cc-gw Model Management - Custom Endpoint Routing`

### API Keys

- 页面入口：`src/web/src/pages/ApiKeys.tsx`
- 状态：`src/web/src/pages/api-keys/useApiKeysPageState.ts`
- sections：`src/web/src/pages/api-keys/ApiKeysSections.tsx`
- dialogs：`src/web/src/pages/api-keys/ApiKeysDialogs.tsx`

### Settings

- 页面入口：`src/web/src/pages/Settings.tsx`
- 状态：`src/web/src/pages/settings/useSettingsPageState.ts`
- sections：`src/web/src/pages/settings/SettingsSections.tsx`

## 共享状态与交互参考

Pencil 参考规格稿：

- `9FpU3` `cc-gw Provider Drawer Spec`
- `HAAVq` `cc-gw Endpoint Drawer Spec`
- `12Owq` `cc-gw Preset Diff Dialog Spec`
- `xWqVa` `cc-gw Test Connection Dialog Spec`
- `f3aI1` `cc-gw Confirm Dialog Spec`
- `iifrG` `cc-gw API Key Create Dialog Spec`
- `LU3iR` `cc-gw API Key Success Dialog Spec`
- `CfH1U` `cc-gw Settings Cleanup Confirm Spec`
- `XNUv3` `cc-gw API Key Edit Endpoints Dialog Spec`
- `US1IC` `cc-gw API Key Delete Confirm Spec`
- `OrXL5` `cc-gw Dashboard Compact State Spec`
- `vfcHw` `cc-gw Dashboard States Spec`
- `bJqVh` `cc-gw Settings Save States Spec`
- `l2m76` `cc-gw API Key Inventory States Spec`

代码实现优先入口：

- `src/web/src/components/PageState.tsx`
- `src/web/src/components/ConfirmDialog.tsx`
- `src/web/src/components/DialogShell.tsx`
- `src/web/src/components/Loader.tsx`

## 回归入口

| 能力 | 代码入口 |
| --- | --- |
| 顶层页面导航与 basename 回归 | `tests/playwright/pages.spec.ts` |
| 登录与认证回归 | `tests/playwright/auth.spec.ts` |
| Logs 业务回归 | `tests/playwright/logs.spec.ts` |
| Model Management 业务回归 | `tests/playwright/model-management.spec.ts` |
| Settings 业务回归 | `tests/playwright/settings.spec.ts` |
| API Keys 业务回归 | `tests/playwright/api-keys.spec.ts` |
| 页面级视觉截图基线 | `tests/playwright/visual.spec.ts` |
| 低频危险路径 E2E | `tests/playwright/hardening.spec.ts` |

## 建议后续开发顺序

1. 先改共享壳层与 token
2. 再改 Logs / Model Management / API Keys / Settings
3. 再统一 Dashboard / Events / Help / About / Login
4. 最后补响应式、联调、回归和设计文档冻结
