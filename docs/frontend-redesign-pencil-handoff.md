# Frontend Redesign Pencil Handoff

> 生成日期：2026-03-19
>
> 用途：给后续使用 Pencil 重新设计 WebUI 的设计人员直接接手
>
> 配套文档：
> - `docs/frontend-redesign-requirements.md`
> - `docs/frontend-redesign-development-plan.md`
> - `docs/frontend-redesign-todo.md`
> - `docs/frontend-redesign-final-audit.md`
> - `docs/frontend-redesign-webui-vs-cc-gw-pen-audit.md`
> - `docs/frontend-redesign-pencil-board-index.md`

## 1. 这份文档解决什么问题

这份文档不是功能需求总表，也不是开发计划，而是给 Pencil 设计执行用的交接说明。

目标只有两个：

- 让设计人员知道哪些业务语义绝对不能画错
- 让后续重绘的画板结构、页面主次关系、关键状态覆盖一次到位

## 2. 当前交接状态

当前代码实现已经完成一轮重构与收口，功能基线稳定。

当前设计资产状态已经明确：

- 历史文档里对 Pencil 主稿路径有过误记
- 当前仓库内实际应使用的主稿是 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`
- 后续设计、评审、导出和代码对照都应统一以这份仓库内主稿为准

这份 handoff 可以直接作为后续重绘输入。

### 2.1 当前 `cc-gw.pen` 已落地的主画板

以下画板已经在 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen` 中建立并完成一轮业务语义与视觉收口：

- `35hVw` `cc-gw Dashboard Redesign`
- `m9KBD` `cc-gw Logs Redesign`
- `4Xi2W` `cc-gw Model Routing Redesign`
- `LHySw` `cc-gw API Keys Redesign`
- `YLPhl` `cc-gw Settings Redesign`
- `dfplC` `cc-gw Events Redesign`
- `De4DR` `cc-gw Help Redesign`
- `FNOoh` `cc-gw About Redesign`
- `1UGHX` `cc-gw Login Redesign`

状态与弹层规格稿当前拆成独立画板，而不是单一总板：

- `9FpU3` Provider Drawer Spec
- `HAAVq` Endpoint Drawer Spec
- `12Owq` Preset Diff Dialog Spec
- `xWqVa` Test Connection Dialog Spec
- `f3aI1` Confirm Dialog Spec
- `iifrG` API Key Create Dialog Spec
- `LU3iR` API Key Success Dialog Spec
- `CfH1U` Settings Cleanup Confirm Spec
- `XNUv3` API Key Edit Endpoints Dialog Spec
- `US1IC` API Key Delete Confirm Spec
- `OrXL5` Dashboard Compact State Spec
- `vfcHw` Dashboard States Spec
- `bJqVh` Settings Save States Spec
- `l2m76` API Key Inventory States Spec

当前这套画板的视觉方向是：

- 黑色侧栏 + 浅色主内容区
- 红/橙/蓝/紫/绿作为业务语义辅助色
- 偏 command center / operator console / terminal swiss 的控制台风格

## 3. 先画什么，不要先画什么

推荐先画：

1. App Shell
2. Dashboard
3. Logs
4. Model Management
5. API Keys
6. Settings
7. Events
8. Help / About / Login

不要先做的事：

- 不要先做局部组件细节美化，再回头拼页面
- 不要先做花哨运营视觉，忽略控制台信息架构
- 不要把高风险页面误画成营销站式布局

## 4. 全局设计不变量

这些是整套前端的设计硬约束。

### 4.1 控制台壳层

必须保留：

- 桌面端侧栏导航
- 移动端抽屉导航
- 顶部全局控制区
- 语言切换
- 主题切换
- 当前登录态信息
- 退出登录入口
- skip to content 语义

### 4.2 页面头部

所有主页面应有统一页头结构：

- icon
- title
- description
- breadcrumb / eyebrow
- helper 文案
- 页面级动作区

但页头动作不能一刀切：

- Dashboard 要有 endpoint filter + refresh + compact DB
- Logs 要有密度切换 + 列控制 + 导出 + 刷新
- API Keys 要有 create key
- Settings 要有 save / reset
- Model Management 顶部不放 Add Provider，只放全局上下文信息

### 4.3 状态表达

每个高风险页面都必须覆盖：

- loading
- empty
- filtered empty
- destructive / error
- retry

并且这些状态不能只靠 toast 表达。

### 4.4 响应式原则

必须同时考虑：

- desktop
- tablet
- mobile

窄屏下要优先保证：

- 主动作能点到
- 筛选器不拥挤
- 表格能横向滚动并有提示
- sticky bar / chips / segmented controls 可用

## 5. 五个最高优先级页面怎么画

## 5.1 Dashboard

应被理解为：总览 + 洞察 + 运维。

必须保留的视觉层：

- 顶部 spotlight / 运行态主摘要
- 6 个统计卡
- 洞察卡组
- 4 张图表卡
- 最近请求表
- 模型性能表

不能画错的交互语义：

- header 的 refresh 是聚合刷新
- compact DB 是独立运维动作
- endpoint filter 会联动整页数据
- 首屏加载不是单 spinner，而是 skeleton 组合

不建议画成：

- 只有图表没有运维入口
- 只有 KPI 卡没有洞察层
- 把最近请求改成卡片流，弱化扫描效率

## 5.2 Logs

应被理解为：排障宽表 + 筛选面板 + 独立详情弹层。

必须保留：

- 宽表优先
- 多列信息密度
- 列显隐
- 舒适/紧凑密度
- 导出
- quick views
- filter panel
- detail modal

绝对不要画成：

- 右侧常驻详情栏长期占宽
- 少列卡片流替代宽表
- 详情页跳转后丢失列表上下文

详情层必须覆盖：

- 路由信息
- 时间 / session / endpoint / provider
- status / error
- token / cache token / ttft / tpot / latency
- API key 摘要
- request payload
- response payload
- copy request / response

## 5.3 Model Management

应被理解为：单工作区控制台，不是并排多栏编辑器。

必须保留的主结构：

- 上方总览与上下文切换区
- `providers` 工作区
- built-in endpoint routing 工作区
- custom endpoint routing 工作区
- presets 折叠区

不能画错的业务关系：

- provider pool 是资源池
- built-in routing 是系统端点路由
- custom endpoints 是一级业务对象，不是 provider 附属项
- 每个 endpoint 都有自己的 routes / presets / validation 语义

关键动作摆放要求：

- Add Endpoint 是页面级动作
- Add Provider 只在 providers workspace 内部
- provider edit / test / delete 在 provider 卡片中
- preset apply / delete 在 preset 区内

协议表达要预留：

- anthropic
- openai-auto
- openai-chat
- openai-responses

## 5.4 API Keys

应被理解为：访问控制 + 使用分析。

必须保留的层次：

- Quick Start 引导
- analytics 摘要和图表
- inventory 主列表
- create success dialog
- endpoint restriction dialog

不能画错的业务语义：

- wildcard key 是特殊对象
- wildcard key 不能被当普通 key 画
- 空 endpoint 选择 = unrestricted
- unrestricted 不是 no access

主摘要应优先表达：

- total keys
- enabled keys
- active keys

inventory 区必须支持：

- 搜索
- status filter
- reveal / hide / copy
- enable / disable
- delete
- edit endpoints

## 5.5 Settings

应被理解为：系统运维设置台，不是即时生效的碎片化表单。

必须保留：

- overview panel
- section nav
- sticky save bar
- Basics / Protocol / Security / Config File / Cleanup 五段结构
- protocol restart required 提示
- auth save 和 config save 两条保存链路

绝对不要画成：

- 改一下就自动保存的 autosave 设置页
- 没有 section nav 的超长表单页
- 没有 sticky 脏状态操作条的设置页

Cleanup 区必须清晰区分：

- soft cleanup
- hard clear all

## 6. 低风险页面怎么处理

## 6.1 Events

应保留为：审计事件卡片流。

必须保留：

- sticky filters
- level/type 筛选
- Newest / Older cursor 翻页
- 内联 details 展示
- 安全感更强的视觉气质

不要回退成普通表格页。

## 6.2 Help

应保留为：结构化文档中心。

必须保留：

- 快捷锚点卡片
- section 分块
- code block copy
- FAQ
- structured content，而不是无结构长文

## 6.3 About

应保留为：应用信息 + 运行态快照。

必须保留：

- app info 区
- runtime status 区
- 手动 refresh
- 非实时监控定位
- check updates 只是提示性动作

## 6.4 Login

应保留为：控制台登录入口。

必须保留：

- 登录表单
- 错误态
- loading
- 回跳语义
- auth disabled 时不展示空壳

## 7. Pencil 画板建议结构

建议至少建立以下主画板：

1. App Shell / Navigation
2. Dashboard
3. Logs
4. Model Management
5. API Keys
6. Settings
7. Events
8. Help
9. About
10. Login
11. Shared States Specs
12. Shared Dialog / Drawer Specs

其中共享规格建议至少覆盖：

- page loading
- page empty
- filtered empty
- destructive error
- confirm dialog
- success dialog
- detail modal

## 8. 设计验收清单

Pencil 稿完成后，至少要逐项过下面这份清单：

- [ ] 是否完整覆盖所有顶层页面
- [ ] 是否保留了 App Shell 的侧栏 / 抽屉 / 顶部全局控制
- [ ] Logs 是否仍然是宽表优先
- [ ] Logs 详情是否是 modal / overlay，而不是右侧常驻栏
- [ ] Model Management 是否仍然是单工作区切换逻辑
- [ ] API Keys 是否清晰区分 wildcard / restricted / unrestricted
- [ ] Settings 是否仍然是 manual save 模式
- [ ] Events 是否仍然是 cursor + card stream
- [ ] Help 是否仍然保留锚点 / FAQ / code copy
- [ ] About 是否仍然是手动刷新，而不是实时监控
- [ ] Login 是否仍然表达受保护控制台入口
- [ ] desktop / tablet / mobile 是否都有明确方案
- [ ] loading / empty / error / danger 状态是否都画了

## 9. 与开发侧的衔接建议

设计定稿后，建议开发按下面顺序对照实现：

1. 先对照 `docs/frontend-redesign-requirements.md` 看有没有功能漏项
2. 再对照 `docs/frontend-redesign-final-audit.md` 看当前实现与设计是否有语义偏移
3. 最后进入具体页面开发与联调

如果后续发现其他历史 Pencil 稿，也建议不要直接覆盖现有判断，而是：

- 先把旧稿与这份 handoff 对照
- 再决定是续改旧稿，还是重建新主稿

## 10. 当前结论

当前已经具备继续做 Pencil 重设计的全部文档基础。

缺的不是“需求说明”，而是旧设计稿文件本身。

所以接下来最建议做的事不是再补功能文档，而是：

1. 找到其他历史 Pencil 稿，或
2. 直接基于这份 handoff 新建新的 Pencil 主稿
