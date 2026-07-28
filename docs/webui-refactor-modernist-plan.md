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
