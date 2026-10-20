# Web 控制台主题系统(双轴:风格家族 × 明暗模式)

控制台 UI(`/ui`)支持两个正交的外观轴,在 `<html>` 上以两个属性表达:

| 轴 | 属性 / 类 | 取值 | 持久化键 |
|---|---|---|---|
| 风格家族(skin) | `data-skin` | `minimal` · `classic` · `paper` · `glass` · `modernist` | `cc-gw-skin` |
| 明暗模式(mode) | `data-theme` + `.dark` 类 | `light` · `dark` | `cc-gw-theme`(存 `light/dark/system`) |

两轴完全独立:任意家族 × 任意明暗都合法(共 10 组合)。用户偏好由
`ThemeProvider` 经 `usePersistentState` 持久化;切换入口两处:头部
`ThemeSwitcher` 下拉(家族分组 + 明暗分组)、⌘K 命令面板(明暗切换、
家族循环)。

## 级联契约

真相源:`src/web/src/styles/themes/`(每族一个文件 + `index.css` barrel)。
**barrel 中 `@import` 的顺序就是级联契约,勿重排**。每族 light 块为 (0,1,0),
家族 dark 块与基础 dark 块为 (0,2,0),靠"后定义的同优先级获胜"实现覆盖:

1. **Rule A** — 家族 light 块(`[data-skin="x"]`)定义**完整变量集**:
   结构变量(`--radius`、`--surface-shadow(-lg)`、`--surface-border`、
   `--ease-surface`、`--surface-alpha`、`--surface-blur`、`--font-*`、
   `--font-heading-weight/tracking`)+ 全部颜色。
2. **Rule B** — 家族 dark 块(`[data-skin="x"][data-theme="dark"],
   [data-skin="x"].dark`)同样是**完整集**(颜色 + 表面变量),保证 dark 下
   结构不串族,并盖过基础 dark 块。
3. **Rule C** — **基础 dark 块**(minimal.css 的 `:root[data-theme="dark"],
   .dark`)**只放 minimal 的颜色,不放结构变量**。它以 (0,2,0) 匹配任意
   skin——若含结构变量,会压过其他家族 light 块的 (0,1,0) 造成渗透。
   minimal 自身的结构变量由 `:root, [data-skin="minimal"]` light 块提供。

`data-skin` 缺失或非法(含 pre-paint 阶段的陈旧存储值)→ 无家族块命中 →
落回 `:root` + 基础 dark = **默认族 minimal**;boot 后 `ThemeProvider` 把
`dataset.skin` 清洗回合法值。

## 家族目录

| 家族 | 气质 | light `--primary` | `--radius` | 字体 | 特殊机制 |
|---|---|---|---|---|---|
| **minimal**(默认) | Linear 风,zinc 中性 + 靛蓝 | `#5e6ad2` | `8px` | Inter / Noto Sans SC | — |
| **classic** | shadcn 风,zinc + 蓝,柔和圆角 | `#2563eb` | `0.625rem` | Inter | 常规阴影 |
| **paper** | Notion 暖纸,陶土 accent | `#b4552d` | `6px` | 正文 Inter,**标题 Source Serif 4** | — |
| **glass** | 毛玻璃,紫 accent | `#7c3aed` | `1rem` | Inter | `--surface-alpha` + `--surface-blur` + body 渐变 |
| **modernist** | 原设计系统:直角、单一红、无绿、零阴影 | `#ec3013` | `0px` | Archivo | 无绿/无玻璃是其族签名 |

状态色:除 modernist 外均为常规语义(green success 合法);modernist 沿用
"无绿"(success = 深灰)与红系 warn/err。

## 半透明表面(glass)机制

- `tailwind.config.cjs` 的 `withAlpha` 用相对颜色语法包装 token —— 这会
  **丢弃原值的 alpha**,因此 `--card`/`--popover`/`--background` 必须**永远是
  不透明 hex**。
- 半透明只能经修饰符:`bg-card/[var(--surface-alpha)]` 编译为
  `rgb(from var(--card) r g b / var(--surface-alpha))`(Tailwind 3.4 支持
  var() 作 alpha 值)。非 glass 家族 `--surface-alpha: 1`,像素等价于
  `bg-card`。
- 模糊走 `.surface-blur` 类(`global.css`):`backdrop-filter:
  var(--surface-blur, none)`。默认 `none` 而非 `blur(0px)` —— 后者仍会创建
  stacking context。
- 已应用表面:Card base、dropdown/popover/select 浮层、dialog、command、
  tooltip、toast、AppLayout header/侧栏/移动 tab bar/抽屉、Login 卡。
  `solid` Card 变体(`bg-card` 字面量,twMerge 会覆盖 base 的 alpha 版)给
  **密集表格容器**保持不透明:logs 表卡、api-keys 表卡、settings 内置定价表。
  输入框/按钮/badge/遮罩一律不透明。
- tailwind-merge 会把 `bg-card/[var(--surface-alpha)]` 与 `bg-card` /
  `bg-muted/30` 视为同组去重(后者胜),无需手动处理冲突。

## 防 FOUC

`index.html` 内联 pre-paint 脚本(先于样式表)读 `cc-gw-theme` /
`cc-gw-skin`,system 模式经 `matchMedia` 解析,首帧前设置两个属性;storage
不可用时保持 HTML 上的默认属性。`landing.html` 钉死
`data-theme="light" data-skin="modernist"` —— 营销页不参与换肤,其视觉基线
是钉住的回归绊线(必须零 diff)。

## 默认族旋钮(改动默认族时须同步全部位置)

1. `ThemeProvider.tsx` 的 `DEFAULT_SKIN`
2. `themes/minimal.css` 占据的 `:root` 块(no-JS / 非法值兜底)
3. `index.html` 的 `<html>` 默认属性与 pre-paint 注释
4. `tests/playwright/visual-helpers.ts` 的钉值(`cc-gw-theme: light` +
   `cc-gw-skin: minimal`)
5. `tests/playwright/visual.spec.ts` 的 `PRIMARY_ACCENT`
6. `tests/playwright/theme-families.spec.ts` 的哨兵表

## 图表

ECharts 无法解析 `var()`(canvas)。所有图表颜色必须经 `useChartTheme`
(`components/chartTheme.ts`)取解析后的 hex;其 memo 依赖
`[resolved, skin]` 双轴。硬编码图表色是 bug。

## 测试

- `theme-families.spec.ts`(core 套件):5 族 × 亮/暗哨兵矩阵(`--primary`、
  `--radius`、`--background`)、Rule B/C 渗透守卫、脏 skin 清洗、glass
  backdrop-filter 开关。计算值经 `normalizeToken` 归一(minifier 丢前导零:
  `0.625rem` → `.625rem`)。
- 视觉基线:**light + minimal** 钉值,由 `visual-helpers.ts` 在每次 goto 后
  写入 storage 并 reload(与 locale 钉值同一机制,防自持久化污染)。
- 每族独立视觉基线暂不做(60 张已是 4 项目规模,未来按需扩展)。

## 加新家族 checklist

1. `styles/themes/<name>.css`:light 块完整集 + dark 块完整集(对照
   `classic.css` 的结构;逐变量不得缺)。
2. `themes/index.css` barrel 追加 `@import`(**加在末尾** = 更高覆盖优先级;
   插入中间会改变同优先级覆盖顺序,须重跑哨兵矩阵)。
3. `ThemeProvider.tsx`:`SKINS` 数组追加(切换器与清洗守卫自动生效)。
4. i18n:`{zh,en}/common.ts` 的 `common.theme.families.<name>` 成对补齐。
5. `ThemeSwitcher.tsx` 的 `skins` 数组补图标项(lucide)。
6. `theme-families.spec.ts`:哨兵表加一行(取 CSS 里的 `--primary` /
   `--radius` / dark `--background` / dark `--primary`)。
7. Google Fonts(`index.html`):如需新字体族则扩充链接,并同步
   `tailwind.config.cjs` fallback。
