# WebUI vs cc-gw.pen Audit

> 生成日期：2026-03-19
>
> 主稿：`/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`
>
> 目标：对照真实 Pencil 主稿，核查当前 WebUI 实现是否保留了正确的信息架构、主动作、危险动作和页面语义

## 1. 审计范围

本文件关注的是“实现语义是否对齐设计主稿”，不是要求当前 WebUI 和 Pencil 逐像素一致。

本轮对照重点：

- 顶层页面是否完整对应 `cc-gw.pen`
- 主动作、关键状态、危险动作是否保留
- 高风险页的信息架构是否和设计主稿表达一致
- 当前代码是否已经偏离此前确认过的交互原则

不作为本轮阻塞项的内容：

- 视觉微差异
- 文案细节差异
- 某些 stub 数据导致的图表空态

## 2. 本轮使用的依据

设计稿与导出图：

- `docs/assets/cc-gw-pen/35hVw.png`
- `docs/assets/cc-gw-pen/m9KBD.png`
- `docs/assets/cc-gw-pen/4Xi2W.png`
- `docs/assets/cc-gw-pen/LHySw.png`
- `docs/assets/cc-gw-pen/YLPhl.png`
- `docs/assets/cc-gw-pen/dfplC.png`
- `docs/assets/cc-gw-pen/De4DR.png`
- `docs/assets/cc-gw-pen/FNOoh.png`
- `docs/assets/cc-gw-pen/1UGHX.png`

当前实现证据：

- `src/web/src/pages/`
- `tests/playwright/pages.spec.ts`
- `tests/playwright/visual.spec.ts`
- `tests/playwright/visual.spec.ts-snapshots/`

本轮新补的对照资产：

- `docs/assets/cc-gw-pen-compare/about-compare.png`
- `docs/assets/cc-gw-pen-compare/dashboard-compare.png`
- `docs/assets/cc-gw-pen-compare/events-compare.png`
- `docs/assets/cc-gw-pen-compare/help-compare.png`
- `docs/assets/cc-gw-pen-compare/logs-compare.png`
- `docs/assets/cc-gw-pen-compare/model-management-compare.png`
- `docs/assets/cc-gw-pen-compare/api-keys-compare.png`
- `docs/assets/cc-gw-pen-compare/settings-compare.png`
- `docs/assets/cc-gw-pen-compare/login-compare.png`

## 3. 总结结论

当前 WebUI 与 `cc-gw.pen` 的关系可以概括为：

- 功能语义：对齐
- 信息架构：对齐
- 高风险交互：对齐
- 设计表达：大体对齐，但当前实现比 Pencil 主稿更偏“产品化落地 UI”，不是原稿的逐像素复刻

本轮没有发现新的功能级回退。

当前真正需要注意的，不是“缺功能”，而是后续重做时不要把已经校正好的页面逻辑再画错。

## 4. 页面级审计矩阵

| 页面 | Pencil 画板 | 当前实现证据 | 结论 | 备注 |
| --- | --- | --- | --- | --- |
| Dashboard | `35hVw` | `src/web/src/pages/Dashboard.tsx` | 对齐 | 视觉布局有演化，但总览 + 洞察 + 运维语义保留 |
| Logs | `m9KBD` | `src/web/src/pages/Logs.tsx` | 对齐 | 宽表优先和详情弹层都保留 |
| Model Management | `4Xi2W` | `src/web/src/pages/ModelManagement.tsx` | 对齐 | 单工作区逻辑正确，页头唯一 `Add Endpoint` 正确 |
| API Keys | `LHySw` | `src/web/src/pages/ApiKeys.tsx` | 对齐 | quick start、analytics、inventory 三层结构保留 |
| Settings | `YLPhl` | `src/web/src/pages/Settings.tsx` | 对齐 | manual save、restart required、cleanup/clear-all 分离保留 |
| Events | `dfplC` | `src/web/src/pages/Events.tsx` | 对齐 | 以代码语义核查为主，sticky filters + card stream 保留 |
| Help | `De4DR` | `src/web/src/pages/Help.tsx` | 对齐 | 单页文档中心、锚点入口、代码复制保留 |
| About | `FNOoh` | `src/web/src/pages/About.tsx` | 对齐 | build metadata + runtime snapshot + manual refresh 保留 |
| Login | `1UGHX` | `src/web/src/pages/Login.tsx` | 对齐 | 独立入口、回跳、auth disabled 语义保留 |

## 5. 全局对齐点

- App Shell 仍然是“控制台壳层”而不是营销站结构，路由与侧栏层级正确
- 顶部页头仍然承担标题、描述、helper、badge、页面级动作
- Logs / Settings / API Keys / Model Management 的主动作都在正确层级，没有退化成零散按钮堆
- Dialog / modal / drawer 模式已与规格稿组对应，不再各页各画一套
- 页面状态已经统一收口到 `PageState` / `DialogShell` / `ConfirmDialog`
- Web UI 缓存策略正确：HTML 与 SPA fallback 走 `no-store`，hashed assets 走 `public, max-age=31536000, immutable`

## 6. 逐页审计结论

### 6.1 Dashboard

一致点：

- 页头仍保留 endpoint 上下文、聚合 `Refresh`、独立 `Compact DB`：`src/web/src/pages/Dashboard.tsx:24`
- 页面仍按 spotlight / stats / insights / charts / tables 的层次展开：`src/web/src/pages/Dashboard.tsx:76`
- 失败态、loading、局部空态都保留，没有退回单一 spinner：`src/web/src/pages/Dashboard.tsx:62`

仍需注意：

- 当前实现比 Pencil 更“数据面板化”，而 Pencil 主稿在 spotlight 和运营语义卡上更强
- 后续如果再做设计，不要把 `Compact DB` 弱化成卡片里的次级文本动作

### 6.2 Logs

一致点：

- 宽表优先仍然成立，表格保留大量列位：`src/web/src/pages/logs/LogsTableCard.tsx:81`
- 详情已经是 dialog/modal，不再占据右侧宽度：`src/web/src/pages/logs/LogDetailsDrawer.tsx:48`
- 列显隐、密度、导出、quick views 都还在页面主操作区

仍需注意：

- 当前视觉快照在 stub 数据下会显得“空”，但这不是信息架构回退
- 后续重做时要继续优先保证横向扫描效率，而不是为了好看改成日志卡片流

### 6.3 Model Management

一致点：

- 当前真实逻辑是“上方切换上下文 + 下方唯一工作区”：`src/web/src/pages/ModelManagement.tsx:24`
- `Add Endpoint` 只在页头，`Add Provider` 只在 providers workspace：`src/web/src/pages/ModelManagement.tsx:34`
- 自定义 endpoint 协议仍暴露 `openai-auto / openai-chat / openai-responses`：`src/web/src/pages/model-management/EndpointDrawer.tsx:20`

仍需注意：

- Pencil 主稿的 overview 区语义卡更强，当前实现相对更工程化
- 后续设计时不要重新画成三栏并排编辑器，也不要把 custom endpoints 画成 provider 的附属字段

### 6.4 API Keys

一致点：

- 页头已显式展示 wildcard / restricted / unrestricted 计数：`src/web/src/pages/ApiKeys.tsx:28`
- 页面结构仍是 quick start -> analytics -> inventory：`src/web/src/pages/ApiKeys.tsx:47`
- 空 endpoint 选择仍提交为 `null`，保持 unrestricted 语义：`src/web/src/pages/api-keys/useApiKeysPageState.ts:295`

仍需注意：

- Pencil 主稿更强调“访问控制运营后台”的视觉引导，当前实现更偏直接功能面板
- wildcard key 必须持续被当成特殊对象，而不是普通 key 卡片

### 6.5 Settings

一致点：

- 页面仍保留 section nav、overview、正文表单与 sticky save bar：`src/web/src/pages/Settings.tsx:54`
- 顶部保存仍是手动 save，不是 autosave：`src/web/src/pages/Settings.tsx:29`
- cleanup 与 clear-all 仍是两套 confirm 流程：`src/web/src/pages/Settings.tsx:121`

仍需注意：

- Pencil 主稿更强调上层摘要卡与风险标签，当前实现更偏“配置表单优先”
- 后续设计不要把 `restart required` 提示藏进细节文案

### 6.6 Events

一致点：

- sticky filter card 仍然存在：`src/web/src/pages/Events.tsx:117`
- cursor pagination、latest/older 切换仍然保留：`src/web/src/pages/Events.tsx:145`
- 内容主体仍是事件卡片流，不是普通表格：`src/web/src/pages/Events.tsx:245`

仍需注意：

- 目前已经补齐页面级视觉基线与对照图，但事件数据容易受 stub 数据集影响，复核时要把“空态”与“结构错误”区分开

### 6.7 Help

一致点：

- 单页文档中心结构保留，带锚点 quick links：`src/web/src/pages/Help.tsx:72`
- Claude Code 与 Codex 被并列展示：`src/web/src/pages/Help.tsx:116`
- 代码块复制能力保留：`src/web/src/pages/Help.tsx:229`

仍需注意：

- Pencil 主稿更强调“文档入口卡 + 内容分区”的落地风格
- 后续不要把 Help 拆回多个零散子页面

### 6.8 About

一致点：

- 页面仍显式区分 runtime snapshot 与 build 信息：`src/web/src/pages/About.tsx:84`
- `Check updates` 仍是提示性动作，不是假装在线升级中心：`src/web/src/pages/About.tsx:97`
- 运行态刷新仍是手动触发：`src/web/src/pages/About.tsx:158`

仍需注意：

- 当前实现已经比 Pencil 更强地突出运行态与 build card 对比
- 后续不要把 About 误画成实时运维监控页

### 6.9 Login

一致点：

- 当前仍是独立入口页，且保持登录成功回跳与 auth disabled 语义
- 视觉上采用了更完整的品牌介绍 + 登录卡布局，但没有破坏交互职责

仍需注意：

- Pencil 主稿是较简的双卡说明结构；当前实现更偏成品化登录首屏
- 后续如果再调视觉，优先保持“受保护控制台入口”的定位，而不是做成通用 SaaS 登录模板

## 7. 当前仍需盯住的设计表达差异

这些不是功能缺陷，但后续重新设计时值得刻意处理：

- Dashboard：当前实现更偏业务面板，Pencil 的指挥台感和运营语义可再强化
- Model Management：当前实现逻辑正确，但 overview 区还能更好地表达“资源池 vs 路由入口”
- API Keys：当前实现语义正确，但运营分析层的视觉存在感弱于 Pencil
- Settings：当前实现偏表单化，Pencil 的摘要/风险层次更适合后续重做
- Events / Help / About：页面级视觉基线已补齐，后续重点是继续收口信息密度和版面表达，而不是补漏测试

## 8. 可直接用于后续重做的入口

如果后续继续推进前端重做，建议固定按这个顺序使用文档：

1. `docs/frontend-redesign-requirements.md`
2. `docs/frontend-redesign-pencil-board-index.md`
3. `docs/frontend-redesign-webui-vs-cc-gw-pen-audit.md`
4. `docs/frontend-redesign-implementation-map.md`
5. `docs/frontend-redesign-pencil-handoff.md`

如果后续继续推进视觉复核，优先使用这些资产：

- `docs/assets/cc-gw-pen/*.png`
- `docs/assets/cc-gw-pen-compare/*.png`
- `tests/playwright/visual.spec.ts-snapshots/*.png`
