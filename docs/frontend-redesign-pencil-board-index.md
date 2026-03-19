# Frontend Redesign Pencil Board Index

> 生成日期：2026-03-19
>
> 当前主稿：`/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`
>
> 导出目录：`docs/assets/cc-gw-pen/`
>
> 当前实现对照图：`docs/assets/cc-gw-pen-compare/`
>
> 代码映射：`docs/frontend-redesign-implementation-map.md`

## 用途

这份文档用于给后续设计评审、前端重开发和产品确认直接对照当前 Pencil 主稿。

目标：

- 明确当前可用的主画板清单
- 给出每个画板对应的导出预览图
- 标记每个页面最重要的业务表达约束

## 主画板清单

| 画板 ID | 页面 | 导出图 |
| --- | --- | --- |
| `35hVw` | Dashboard | `docs/assets/cc-gw-pen/35hVw.png` |
| `m9KBD` | Logs | `docs/assets/cc-gw-pen/m9KBD.png` |
| `4Xi2W` | Model Management | `docs/assets/cc-gw-pen/4Xi2W.png` |
| `LHySw` | API Keys | `docs/assets/cc-gw-pen/LHySw.png` |
| `YLPhl` | Settings | `docs/assets/cc-gw-pen/YLPhl.png` |
| `dfplC` | Events | `docs/assets/cc-gw-pen/dfplC.png` |
| `De4DR` | Help | `docs/assets/cc-gw-pen/De4DR.png` |
| `FNOoh` | About | `docs/assets/cc-gw-pen/FNOoh.png` |
| `1UGHX` | Login | `docs/assets/cc-gw-pen/1UGHX.png` |

## 状态与规格稿清单

`cc-gw.pen` 当前不是单一 `Shared States & Dialogs` 总画板，而是拆成多块规格稿：

| 画板 ID | 用途 |
| --- | --- |
| `9FpU3` | Provider Drawer Spec |
| `HAAVq` | Endpoint Drawer Spec |
| `12Owq` | Preset Diff Dialog Spec |
| `xWqVa` | Test Connection Dialog Spec |
| `f3aI1` | Confirm Dialog Spec |
| `iifrG` | API Key Create Dialog Spec |
| `LU3iR` | API Key Success Dialog Spec |
| `CfH1U` | Settings Cleanup Confirm Spec |
| `XNUv3` | API Key Edit Endpoints Dialog Spec |
| `US1IC` | API Key Delete Confirm Spec |
| `OrXL5` | Dashboard Compact State Spec |
| `vfcHw` | Dashboard States Spec |
| `bJqVh` | Settings Save States Spec |
| `l2m76` | API Key Inventory States Spec |

## 页面语义备注

### Dashboard

- 聚合总览页，不是纯图表页
- 必须保留 endpoint filter、aggregate refresh、compact DB 独立动作
- 最近请求与模型性能都应保留扫描式结构

### Logs

- 宽表优先，不退回卡片流
- 详情应通过 modal / overlay 触发，不占用常驻右侧宽度
- 列控制、密度切换、导出、quick views 是主操作

### Model Management

- 单工作区控制台，不是并排多栏编辑器
- provider pool、built-in routing、custom endpoints、presets 必须分层表达
- Add Endpoint 是页面级动作，Add Provider 只在 providers workspace 内

### API Keys

- 强调访问控制与使用分析
- wildcard、restricted、unrestricted 三种语义必须明确分开
- 空 endpoint selection = unrestricted，不是 no access

### Settings

- manual save 是硬约束，不能误导成 autosave
- protocol 变更与 restart required 必须显式提示
- cleanup 与 clear-all 必须分开表达风险等级

### Events

- sticky filters + cursor pagination + card stream 是核心结构
- 详情区展示结构化 payload，而不是覆盖列表语义

### Help

- 单页文档中心，不拆成零散帮助页
- Claude / Codex 配置路径要并列表达
- 代码块和 FAQ 需要支持快速复制和扫描

### About

- 区分 build metadata 与 live runtime
- refresh 是手动快照刷新，不是实时流
- operational notes 是排障辅助，不是营销信息

### Login

- 独立入口页
- 需要同时兼顾品牌、登录态说明和首屏操作聚焦

### 状态与弹层规格稿组

- 已拆成独立 spec frames，而不是一个总板
- 已覆盖 loading / empty / filtered empty / destructive error
- 已覆盖 confirm / success / detail modal / form drawer
- 后续前端实现应优先复用这些状态表达，不要各页各画一套

## 建议用法

后续如果继续推进前端重开发，建议固定按下面顺序对照：

1. 先看 `docs/frontend-redesign-requirements.md`
2. 再看 `docs/frontend-redesign-pencil-handoff.md`
3. 然后对照本文件和 `docs/assets/cc-gw-pen/*.png`
4. 最后进入具体页面实现或组件拆分
