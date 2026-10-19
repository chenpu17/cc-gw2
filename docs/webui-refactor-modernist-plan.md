# cc-gw2 WebUI 重构计划 — Modernist 设计系统

> 本文档是 Web 控制台全面重构的 single source of truth,基于 4 份专家 agent 报告综合(设计系统迁移 / IA 与交互 / 后端 API 缺口 / 工程化与风险)。
>
> 设计稿:`WebUI 系统全面重构.zip`(项目根,git 未跟踪)。视觉真相 = 主设计稿 `控制台重构.dc.html`(dc-runtime SPA mockup)+ Modernist 设计系统 `styles.css`。`ref/*.png` 仅作信息架构参考(其圆角+蓝绿是旧风格,不作视觉依据)。

## 1. 目标与策略

- **in-place 渐进式重构**(不重做)。11 页已存在,外壳(AppLayout 侧边栏+顶栏+三组导航)已对齐设计稿。
- **视觉**:Modernist 设计系统(主 HTML 为准)。
- **行为层**:Radix a11y(focus trap / aria / 键盘)全保留,只覆盖样式。
- **分支**:留 main,小 PR 逐个合,不开长期分支(CI gate 绿即 main 可发)。

## 2. Modernist 设计系统要点

| 维度 | 规格 |
|---|---|
| 圆角 | **0**(例外:live 脉冲点 / radio dot / switch thumb。头像**方形**) |
| accent | 红 `#ec3013` → 走 `--primary`(**不**走 shadcn `--accent`) |
| 底/面/字 | bg `#f3f2f2` / surface `#eae9e9` / 卡片白 `#fff` / 墨字 `#201e1d` |
| 字体 | Archivo(800 标题)+ Noto Sans SC,全局 `tabular-nums` |
| 分隔 | 2px 强线(`--rule` = 墨字 40%),section 间靠线非留白 |
| 语义色 | ok=深灰 `neutral-800`、warn=红 `accent-700`、err=红 `accent-600`(**无绿**) |
| 阴影 | 去(平面卡 border-only),仅浮层(dialog/popover)留最轻一档 |
| dark | `[data-theme="dark"]`,accent `#ff563c` |

## 3. 分阶段路线图

| 阶段 | 内容 | 工作量 | 依赖 |
|---|---|---|---|
| **P0** 设计系统地基 | 去 hsl() 切纯 hex、`--radius:0` + 补 xl/2xl/3xl 映射、红 primary、语义色重定义、Archivo+Noto SC+tabular-nums | 0.5–1 天 | 无;可独立合并 |
| **P1** ui 组件库重写 | 22 个 ui 文件 cva 重写;**必做** badge 去硬编码(与 P0 语义色同 PR) | 1.5–2.5 天 | P0 |
| **P2** 外壳 AppLayout | 侧边栏/顶栏/用户区视觉对齐 + 主区 1280px 居中 + ⌘K/RPM | 1 天 | 与 P1 并行 |
| **P3** 逐页换皮 | 10 页 / 11 baseline,逐页同 PR 重生成快照 | 4–6 天 | P0+P1+P2 |
| **P4** 净新增交互(前端) | ⌘K / 列设置 / 路由三栏 / 日志行内 / 命中模拟壳 / insights | 3–5 天 | 部分阻塞于 P5 |
| **P5** 后端缺口 | 命中模拟 + 事件统计 + KPI delta + trace 派生(+ P2 可后补) | TBD | 与 P3 并行 |
| **P6** 收口 | 全量 baseline 锁终态 + CI 补 typecheck | 0.5 天 | — |

关键路径:**P0 → P1 → P3 → P6**(P2 并行;P4/P5 在 P3 后)。

## 4. 五条不可碰红线

1. **语义色翻转必须与 badge 去硬编码同 PR**(R2,风险最高)。`--success` 改深灰 + `badge.tsx` 去 `bg-emerald-100` 等硬编码必须捆绑,否则新旧绿/红并存致误读。
2. **零圆角非单旋钮**。`rounded-xl`(121 处)是硬编码,token 改 0 抓不到——必须补 `borderRadius.xl/2xl/3xl` 映射。规则:**一维指示点=圆,二维容器=方**。
3. **dashboard spotlight 精确 7 个**(`dashboard.spec.ts:97 toHaveCount(7)`):StatusBand 3(active/rpm/cpu)+ InfraDisclosure 4(ingress/egress/database/memory)。→ **InfraDisclosure 必须保持折叠**(`</details>`/CSS 隐藏,不能条件渲染,否则计数掉到 3);**勿引入 `dashboard-runtime-strip`**(断言 `toHaveCount(0)`)。
4. **14 个 testid 冻结不改名**(DOM 可变 id 不动);路由 path 不变(routing 在 `/providers?tab=routing`,跨页深链用 query param)。
5. **shadcn `accent` ≠ Modernist accent**。shadcn `accent`=hover 浅底(neutral-100),红色走 `primary`。保留 shadcn 语义,写进 PR 注释。

## 5. 后端缺口

| 缺口 | 优先级 | 工作量 | 说明 |
|---|---|---|---|
| **路由命中模拟** `POST /api/routing/simulate` | **P0 唯一阻塞** | M | 复用纯函数 `resolve_route`,重构成返回 `RouteResolution{target, source}` 再包 handler |
| 事件统计 `GET /api/events/stats` | P1 | S | 两条 `GROUP BY level/type` |
| KPI delta(yesterday) | P1 | S | `MetricsOverview` 加 `yesterday` + `deltaPct` |
| 日志 trace 派生字段 | P1 | S | `LogDetail.trace`,用现有 timestamp/ttft/latency 拼 3 真实锚点 |
| 路由规则精确命中数 | P2 | M-L | migration 加 `matched_route` 列 |
| Provider 健康 / P50 | P2 | M / S-M | 健康派生;P50 或卡片文案改「平均」零改动 |
| 真 5 段 trace 埋点 | P2 | L | 不推荐阻塞 |
| **modelRoutes 保序语义** | **阻塞性前置确认** | — | `Record<string,string>` 若 HashMap 无序则拖拽排序不生效 |
| ✅ 连接测试带 header / TTFT·TPOT 均值 / 密钥用量 / 模型分布 | — | 0 | 已具备 |

## 6. 净新增交互(前端)

| 交互 | 性质 | 库 |
|---|---|---|
| ⌘K 命令面板 / 顶栏 RPM 脉冲 | 纯前端 | `cmdk` |
| 日志列设置 dialog(14 列)/ 模板常驻 / dashboard insights / providers 表→卡片 | 纯前端 | — |
| 路由弹窗 → 三栏 + 规则拖拽 | 前端为主 | `@dnd-kit`(阻塞于 modelRoutes 保序) |
| 日志行内展开(链路 + payload + metrics) | 前端 + 降级 | 自绘 timeline |
| 命中模拟 UI | 前端壳(stub) | — |

## 7. 逐页工作量

8 页视觉重构:**events / settings / setup / help / about / login**(S)、**dashboard / api-keys**(M)。**3 页 L**:**logs**(行内链路)、**routing**(三栏+命中模拟+拖拽)、**providers**(卡片网格+抽屉)。

## 8. 风险矩阵 top 5

| 风险 | 影响/概率 | 缓解 |
|---|---|---|
| 语义色颠覆致误读 | 高/高 | 原子红线(4.1) |
| 后端缺口阻塞净新增 | 高/中 | P5 并行、契约先行、前端 stub 解耦 |
| visual 快照全面失配 | 中/高 | 不在 CI 缓冲;P0-P2 不重生成,P3 逐页同 PR 重生成 |
| modelRoutes 无序致拖拽失效 | 中/? | 阻塞性前置确认 |
| Switch/Checkbox Radix DOM 与手画样式冲突 | 中/中 | a11y 行为层保留,Switch 列为「圆例外」 |

## 9. MVP vs 完整

- **MVP(换皮先行,3–4 天)**:P0+P1+P2 → token 全局生效即呈 Modernist 观感。
- **完整(10–15 天 + 后端 P5)**:全量逐页 + 净新增交互 + 后端缺口。

## 10. 关键技术决策

- **去 `hsl()` 切纯 hex 变量**:Modernist 用 `color-mix(in srgb, …)`,不兼容 HSL 通道。改 `global.css :root` 为 hex + `tailwind.config.cjs` 去 `hsl()` 包装 + 改 6 处手写 `hsl(var())` 用法 + `chartTheme.ts` 的 hsl helper。
- **保留 shadcn 语义 token 名**(`primary/card/muted/border/…`),只重指向 hex → ~70% 视觉面靠 token 自动迁移。
- **dark theme**:统一 `[data-theme="dark"]`(现状 `.dark` class + `data-theme` 双设冗余,功能正常)。
- **字体**:在 `index.html` `<head>` 加 Google Fonts link(非 `@import`,避免阻塞渲染)。

## 11. testid 契约

**冻结 14 个(勿改名)**:`api-key-card`、`dashboard-all-clear`、`dashboard-overview-panel`、`dashboard-runtime-address`、`dashboard-setup-progress`、`dashboard-spotlight-grid`、`dashboard-today-grid`、`endpoint-row`、`events-filters-card`、`language-switcher-trigger`、`logs-filters-card`、`provider-row`、`route-editor-dialog`、`theme-switcher-trigger`。约定 `{page}-{region}`。

**新增**:`routing-endpoint-selector`、`routing-rules-table`、`routing-hit-simulator`、`routing-templates`、`log-row-expanded`、`log-trace-timeline`、`command-palette`、`command-palette-trigger`、`header-rpm-badge`、`dashboard-insights`、`dashboard-model-distribution`、`api-keys-usage-chart`。

**测试基础设施**(产品代码里的锚点,勿改名):`app-shell`(`AppLayout.tsx` 视口高度外壳)、`app-scroll`(真正的滚动容器)。视觉套件的整页截图靠它们注入 unroll,见 §15。

## 12. P0 实施清单(✅ 已实施:typecheck + build 绿)

原子改动(必须同 PR):

1. `src/web/src/styles/global.css` — `:root` 与 `.dark,[data-theme="dark"]` 重写为 hex(Modernist 值 + 语义色重定义);`--radius:0`;body 字体改 Archivo+Noto SC + `tabular-nums`;scrollbar 方形 9px;`::selection` 红;`.metric-number` 字体改 Archivo。✅
2. `src/web/tailwind.config.cjs` — colors 全部 `hsl(var(--x))` → `var(--x)`;`borderRadius` 补 `xl/2xl/3xl: 'var(--radius)'` + 保留 `full`;`fontFamily` 加 Archivo+Noto SC + heading。✅
3. `src/web/index.html` — `<head>` 加字体 preconnect+link;`body` class 从 `bg-slate-*` 改 `bg-background text-foreground`。✅
4. `src/web/src/components/ui/badge.tsx` — 去 `bg-emerald/amber/indigo/violet/pink` 硬编码 → `--success/--warning/--error` token(R2);purple/pink 折叠进单一红 accent。✅
5. 6 处手写 `hsl(var())`:`ToastProvider.tsx:111`、`useApiKeysPageState.ts:186`、`ProviderDrawerSteps.tsx`(4 处 accent-color,replace_all)。✅
6. `src/web/src/components/chartTheme.ts` — hsl helper 改 `cssVar` 直接读 hex;fallback 全换 Modernist 值。✅

验收:`pnpm typecheck` ✅ + `pnpm --filter @cc-gw/web build` ✅(2.65s)+ `pnpm test:e2e:web:core`(运行中;visual 全红属预期,P3 逐页重生成)。

## 13. P1 实测残留清单(grep 扫描后,远小于预估)

关键发现:**绝大多数组件已通过 `shadow-[var(--surface-shadow)]` 走变量**(P0 已把 `--surface-shadow` 设 `none` → 自动变平面卡),故 P1 不是 22 文件全量重写,只需清理下列残留:

| 文件 | 问题 | P1 处理 |
|---|---|---|
| `toast.tsx:34` | `border-emerald-500/22 bg-emerald-500/10 text-emerald-950`(success 变体硬编码) | → `border-success/20 bg-success-bg text-success` |
| `toast.tsx:80` | `group-[.destructive]:focus:ring-red-400 ... ring-offset-red-600` | → `focus:ring-destructive ring-offset-destructive` |
| `metric-card.tsx:90-91` | `bg-emerald-100 text-emerald-800` / `bg-red-100 text-red-700`(正负 delta) | → `bg-success-bg text-success` / `bg-error-bg text-error` |
| `button.tsx:13,15` | `shadow-sm`(default + destructive) | 删(Modernist 按钮平面化,仅浮层留最轻一档) |
| `switch.tsx:12,20` | 硬编码 `rgba(15,23,42,…)` inset/thumb shadow | 评估:thumb 保留最轻深度或移除(P1 定) |

**`rounded-full` 合法例外(保留)**:switch track/thumb、step-nav 步骤节点、badge 的 `before:rounded-full` 成功点、scroll-area thumb —— 均属「一维指示点=圆」。
**`rounded-full` 待定(pill 容器,对照设计稿)**:segmented-control、metric-card delta pill、toast action button —— Modernist 倾向方,但需对照 mockup 终定。

→ P1 实际工作量从「22 文件 cva 重写」收窄为「2 文件去硬编码 + 1 处删 shadow + 2-3 处 pill 判断」。

---

设计稿文件:`WebUI 系统全面重构.zip`(项目根);解压临时副本 `/tmp/webui-redesign/`。

---

## 14. 一致性收尾约定（控件族 / 分页 / 术语）

前 13 节是「从旧 UI 迁到 Modernist」的账。本节记录迁移完成后、控制台里仍然存在的
**同一种交互有多种表达**问题，以及定下来的规则。规则本体同步写进
`.claude/skills/modernist-webui/SKILL.md`（"Control families" 与 "Pagination" 两小节）。

### 14.1 控件族（按语义选，不按手感选）

| 语义 | 控件 | 选中态 |
|---|---|---|
| 视图态：小集合里选一个（筛选 / 密度 / 范围 / 维度） | `SegmentedControl` | `bg-foreground text-background` |
| 布尔开 / 关（含持久化配置） | `Switch` | ink track |
| 并列面板 / 同级视图切换 | `Tabs` | `border-b-2 border-foreground` |
| 表单字段选值 | checkbox / radio / chip group | `border-foreground` / `bg-secondary` |
| 从实体列表里选一项（导航） | selection surface | `border-foreground bg-secondary` |

`SegmentedControl` 的 `value` 放宽为 `T | null`：`null` = 无选中段，用于「当前状态是
自定义组合、任何预设都不描述」的情形，不要靠高亮一个不成立的段来回避。

本轮把两处手搓实现收回组件族：

| 位置 | 原状 | 现状 |
|---|---|---|
| `pages/logs/LogsFiltersCard.tsx` 日志快捷筛选 | 5 个 ghost `Button`，选中态 `bg-card`（全站仅此一处） | `SegmentedControl<QuickView>` |
| `pages/logs/LogInlineDetail.tsx` payload 切换 | 手搓 `role="tablist"` pill tablist | `Tabs`/`TabsList`/`TabsTrigger`/`TabsContent`，与 `LogDetailsDrawer.tsx` 的同一切换器统一 |

**明确不改**（它们各自属于别的族，不是「不一致」）：
`ProvidersWorkbench.tsx` 视图选择卡（带计数与说明的顶层视图选择器 → selection surface 族）、
`ProviderDrawerSteps.tsx` 的提供商类型 chip（表单字段选值 → chip group 族）。

### 14.2 按钮不得承载状态色

`ApiKeysSections.tsx` 的「启用 / 禁用」曾是 `variant={enabled ? 'outline' : 'default'}` ——
每一行被禁用的密钥都渲染成主色红，一屏能出现十几个红按钮，把「红色只给提交型动作，
且同屏最多一个」直接冲掉。**状态由旁边的「已启用 / 已禁用」Badge 读出，按钮只表达动作**，
故两态统一 `variant="outline"`。这也解释了为什么这里不改成 `Switch`：会与 Badge 重复读数。

### 14.3 分页：两种物种，两种位置，同一种形状

位置跟随数据源，用词跟随位置。**不要为了「统一」把 offset 表格的页脚分页搬到页头。**

| 列表类型 | 位置 | 用词 |
|---|---|---|
| 已知总数的表格（offset） | 卡片页脚；左「每页条数」，右 `[< 上一页] 第 N / M 页 [下一页 >]` | 上一页 / 下一页 / 第 N / M 页 / 每页 |
| 未知总数的游标流（实时追加） | 页头工具栏；一条带边框的组：`[< 最新] 本页 N 条 [更早 >]` | 最新 / 更早 |

两者共用同一条组：`flex items-center gap-2 border border-border bg-secondary px-2 py-1.5`，
方向 `ChevronLeft`/`ChevronRight` 放在**文字外侧**，页码/条数读数居中走 `metric-number`。
本轮给日志页脚补了方向箭头，并把事件页的 `本页 N 条` 从工具栏 `info` 槽移入导航组。

### 14.4 中文术语统一为「提供商」（**Web 文案**）

**本节范围是 `src/web/src/i18n/locales/zh/`**，即控制台前端自己的文案。Rust 侧面向用户的
中文串不在本轮范围内，见本节末尾「遗留项」。

Web 文案里此前并存四种写法：英文 `Provider`（约 45 条 live 词条）、「供应商」（约 14 条）、
「提供商」（约 13 条）、「服务商」（1 条）。统一为**提供商**。

决定性理由：`providers.actions.add`（新增提供商）、工作台页签（模型提供商）、日志列名
（提供商）已是「提供商」，且 **9 个 Playwright spec 依赖「新增提供商」这个按钮名**。

**不动**：`providerId:modelId` / `providerId:*` / `provider:model` 等用户实际输入的字面量
（故 `转发到（Provider:模型）` 归一为 `转发到（provider:model）`，与兄弟键
`转发目标（provider:model）` 及 en 文案一致，而不是改成 `提供商:模型`——那不是合法输入）；
「上游 / upstream」概念；en 文案。

顺带修掉使用指南里已失效的页名：`模型供应商 / Models` → `模型与路由 / Providers & Routing`，
`"路由管理"` → `"路由"`（对齐 `nav.providers` 与工作台的 routing 页签）。

**遗留项（本轮明确未动）**：Rust 侧仍有 **30 条 live** 面向用户的中文串内嵌英文 `Provider`
（另有 5 条测试断言随它们走），会以三种形式出现在控制台里——配置校验错误 toast、余额/路由
失败的 `gateway_events.title`、以及 API 错误响应体：

| 文件 | 条数 | 例 |
|---|---|---|
| `cc-gw-core/src/config.rs` | 19 | `Provider {} 的 RPM 限额不能超过 {MAX_RPM_LIMIT}`、`Provider ID 不能为空` |
| `cc-gw-core/src/routing.rs` | 4 | `未配置任何模型提供商，请先在 Web UI 中添加 Provider。`（半句已改，半句未改） |
| `cc-gw-server/src/admin_routes.rs` | 4 | `Provider {id} 余额刷新失败` → 渲染成 **Events 页一行标题** |
| `cc-gw-core/src/balance.rs` | 2 | `Provider {} 未配置余额适配器，无法查询余额` |
| `cc-gw-server/src/proxy_routes.rs` | 1 | `已自动切换到 Provider {}（共 {} 次尝试）` |

唯一的「供应商」残留是 `admin_routes.rs:776`（`该供应商的地址无法推导模型列表端点`）。
不改的原因：超出本轮「控制台 UI」范围，且部分串是 API 错误响应体，客户端可能在匹配这些文本；
要改需连带移动 `config.rs` 内联测试模块里的 5 条断言。**改中文串时不要顺手改
`ProviderConfig` / `ProviderProtocol` 等类型名**——那是代码标识符，不是文案。

### 14.5 失效词条清理

术语审计暴露一批含旧术语的死键。**先删再改名**，改名 diff 就只剩 live 词条。
每个键删除前重新 grep 确认无引用 —— 本仓库存在 `` t(`logs.quickViews.${view}`) `` 这类
动态键名，误删会渲染成裸键名。已删除：`nav.models`/`nav.routing`、
`providers.{count, card.providerDefault, quickAddHuawei.*, aggregate.drawer.typeHint, drawer.{createTitle, editTitle, summary.*, fields.type, hints.auth, hints.customProvider, hints.checkUrl}}`、
`dashboard.labels.providers`、`settings.routing.{description, descriptionByEndpoint.*}`、
`modelManagement.{guide.*, overview.*, providersSemantics.*, routing.selectTarget}`、
`workbench.{routingGuide.*, defaults.description, detail.*}`。

---

## 15. 视觉捕获机制（整页截图）

### 15.1 问题

视觉套件里的 `expectPageSnapshot(page, name, { fullPage: true })` 曾经**从来没截到过整页**。
根因是滚动权不在 document 手上：

- `styles/global.css:91-95` — `html, body, #root { height: 100%; overflow-x: hidden }`。
  带 `overflow-x: hidden` 的元素按 CSS Overflow 规范另一轴计算值变成 `auto`，
  于是 `#root` 自己就是一个钉在视口高度的 scroll box。
- `layouts/AppLayout.tsx:270` — 外壳 `flex h-screen overflow-hidden`。
- `layouts/AppLayout.tsx:351` — 真正的滚动容器 `overflow-y-auto`（`data-testid="app-scroll"`）。

Playwright 的 `_fullPageSize` 只读 `max(body.scrollHeight, documentElement.scrollHeight)`，
而折叠线以下的像素全在内层容器的 scroll box 里，两个数都不超过视口——`fullPage: true`
静默退化成视口截图。

### 15.2 修法：测试期注入 unroll

`tests/playwright/visual-helpers.ts` 的 `unrollForFullPage()` 在快照前用
`page.addStyleTag` 注入（与 `hideVolatileVisualValues` 同一机制）：

```css
html, body, #root { height: auto !important; }
[data-testid="app-shell"] { height: auto !important; min-height: 100vh !important; }
[data-testid="app-scroll"] { overflow: visible !important; }
```

四条约束，缺一条都会失效：

1. `html/body/#root { height: auto }` 必需——只解外壳高度没用，`#root` 仍会裁掉。
   **保留 `overflow-x: hidden`**，只覆盖 height。
2. `min-height: 100vh` 保住的是一屏地板：否则 help / 空 logs 这类短页会截出比视口还矮的
   图，侧边栏 `border-r` 半路断掉。
3. 外壳**保留 `overflow: hidden`**（不要改成 `visible`）：它作为最近的 scrollport，
   让 `StickySettingsSaveBar` 的 `sticky bottom-4` 仍按内容流位置渲染。
   高度已是 auto，裁不到任何东西。
4. `app-scroll { overflow: visible }` 是保险，彻底去掉内层滚动。

`expectPageSnapshot` 在 `fullPage: true` 时自动调用 unroll，调用点不可能漏。随后
`assertDocumentOwnsScroll()` 做 tripwire：若 testid 改名或祖先重新钳制高度，
用例会**显式失败**，而不是悄悄退回视口截图。基线高度另用 `sips -g pixelHeight` 核对。

**不要加 settle 等待，更不要 dispatch `resize`**：Playwright 比对前会循环到连续两张
截图一致（15 s 内），ECharts 首帧动画会被吸收；而 resize 会让 `echarts-for-react`
重新 `setOption` 并重启动画，凭空制造不确定性。`captureBeyondViewport` 路径也不改视口，
`vh` 单位仍是 1200（desktop）/ 844（narrow）。

### 15.3 哪些页面保持视口截图

工作台两页（`model-management-page.png` / `routing-workbench-page.png`）**不**开 fullPage：
它们的栏位靠 `RoutingEndpointRail.tsx:81` 的 `lg:h-full`、`ProvidersMasterDetail.tsx:164`
的 `lg:max-h-[calc(100vh-320px)]` 撑满视口，取消内层滚动会把它们压成内容高度，截出来的
图不再代表用户在 1440×1200 下的真实渲染。`landing`（独立入口，本就是 document 滚动）、
`login`（`min-h-screen` 居中）、以及全部 overlay（对话框本就该是视口截图）同理不动。

### 15.4 代价与配套

- **容差相对变宽松**：图高约 3 倍后，同一 `maxDiffPixelRatio: 0.015` 在绝对像素上更宽松。
  缓解：新增易变值用 `data-visual-volatile` 掩掉；单控件样式回归靠精确断言（见 api-keys
  用例里的按钮颜色断言）而不是快照容差。**不要**为探测方便调低默认容差——亚像素 AA 噪声
  会把它打翻；需要时用 `VISUAL_MAX_DIFF_PIXEL_RATIO` 环境变量临时覆盖。
- **易变值必须掩**：秒级时间戳、进程指标、临时端口路径在整页后才会进画面。
  约定 `data-visual-volatile="true"` → `visibility: hidden`（保留盒与列宽）；
  `"text"` → `color: transparent`（输入框）。`@data` 套件调用
  `hideVolatileVisualValues` 才会生效——新增用例别忘。
- **`pnpm test:e2e:web:update-snapshots` 必须带 `=all`**：裸 `--update-snapshots`
  等于 `changed`，对「仍在容差内判过」的过期基线**什么都不写**，是假阴性的来源。

### 15.5 已知盲区（独立复核确认，均不阻塞当前基线）

- **tripwire 只看 `app-scroll` 这一层**。若某个被截页面把正文放进自己的
  `max-h-* overflow-y-auto` 容器（目前唯一实例是设置页定价表，位于默认折叠的
  Disclosure 内；api-keys 的对话框不参与整页截图），`app-scroll` 会正常撑开、
  tripwire 全绿，而该容器的下半截不会进基线。新增此类容器时要么让它随内容撑开，
  要么把该区域移出捕获状态；需要时再给 tripwire 加「可见后代滚动容器必须不裁剪」的扫描。
- **窄屏的固定 `MobileTabBar` 会遮挡一条带**：Chromium 把 `position: fixed` 元素画在
  初始视口位置，1520px 高的窄屏整页图里它落在 y≈800–880，遮住下方约 64px 内容。
  这是确定性的，不会引起漂移，但那一条带的像素不参与比对——不要在那里放需要被
  视觉回归网保护的内容。
- **日期粒度内容无法用 `[data-visual-volatile]` 掩**：`data-dashboard` 的图表 x 轴
  标签是 canvas 绘制（DOM 掩码管不到），insights 的「最忙的一天」也来自当天数据。
  跨天运行时会有 ~0.01% 的字形差，落在 1.5% 容差内静默通过——基线不是按日期冻结的，
  判断「是否真回归」时别被这一项干扰。
