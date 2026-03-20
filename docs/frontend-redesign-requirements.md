# Frontend Redesign Requirements

> 生成日期：2026-03-17
>
> 最近复核：2026-03-18
>
> 代码依据：
> - `src/web`
> - `crates/cc-gw-server/src`
> - `README.md`
> - `docs/api-compatibility.md`

## 1. 文档目的

这份文档不是视觉设计稿，而是给后续前端整体重设计、重开发、Pencil 重绘使用的“功能与能力基线”。

目标只有一个：在重做前端时，不丢当前产品已经承载的业务能力，也不把前后端耦合点遗漏掉。

换句话说，后续新的前端不只是“长得更好看”，而是要完整覆盖当前控制台已经承担的职责：

- 网关配置中心
- Provider 与模型路由控制台
- API Key 与访问控制后台
- 请求日志与问题排查台
- 事件与运行态观测台
- Web UI 自身登录保护入口
- 用户帮助与产品说明入口

## 2. 当前前端的产品定位

当前前端不是一个单纯的仪表盘，而是一套本地 AI Gateway 管理控制台。

它服务的核心链路是：

1. 启动网关
2. 配置 Provider
3. 配置内置或自定义端点
4. 配置模型路由
5. 生成或管理 API Key
6. 让 Claude Code / Codex / 其他客户端通过网关发请求
7. 在控制台查看日志、事件、统计、运行状态
8. 在必要时调整安全、日志、监听协议与存储策略

因此，后续重做前端时，必须把“配置 + 观测 + 运维 + 帮助”视为同一个产品，而不是拆成几个互不关联的小页面。

## 3. 全局能力清单

这些能力不是某一个页面独有，而是整套前端必须保留的基础设施能力。

| 能力 | 当前状态 | 说明 |
| --- | --- | --- |
| SPA 路由 | 已有 | 基于 React Router，入口在 `/ui`，也兼容根路径重定向 |
| 懒加载页面 | 已有 | 各主页面按路由 lazy load |
| 登录保护 | 已有 | 未登录时访问主应用会跳转 `/login` |
| 会话态刷新 | 已有 | 前端会读取 `/auth/session`，且在 401 后自动刷新登录态 |
| 中英双语 | 已有 | `zh` / `en` 两套文案 |
| 主题切换 | 已有 | `light` / `dark` / `system` |
| 响应式布局 | 已有 | 桌面侧栏 + 移动端抽屉导航 |
| 统一 Toast | 已有 | 成功/失败/提示统一通知 |
| 统一 Confirm Dialog | 已有 | 删除、清理、危险操作二次确认 |
| Loading / Empty / Error State | 已有 | 大部分页面都有显式状态处理 |
| 数据请求缓存 | 已有 | 基于 React Query |
| 剪贴板复制 | 已有 | 多页面支持复制路径、密钥、配置片段、日志载荷 |
| 图表能力 | 已有 | 基于 ECharts |
| 本地持久化 | 已有 | 主题、日志列显示、日志密度写入 `localStorage` |
| 自动刷新 | 已有 | Dashboard 通过轮询刷新关键指标 |
| `/ui` 基路径兼容 | 已有 | 前端 Router 会根据当前路径自动判断 basename |

## 3.1 应用壳层能力

这些能力虽然不属于某一页业务，但会直接影响后续信息架构和 Pencil 组件拆分。

- 桌面端双形态侧栏
  - 紧凑侧栏
  - 完整侧栏
- 移动端抽屉式导航覆盖层
- 顶部页头会根据当前路由展示：
  - 当前页面标题
  - 当前页面描述
  - 当前登录用户名
  - 退出登录按钮
  - 语言切换入口
  - 主题切换入口
- 提供无障碍 `skip to content` 入口

因此后续重做时，不能只设计“内容页”，还必须先定义一层稳定的 console shell。

## 3.2 统一交互基础设施

当前前端除了“能请求数据”，还已经形成了一些明确的体验策略：

- 查询请求默认保留旧数据，避免筛选切换时界面闪烁
- Toast 支持：
  - success / error / info
  - 自动消失时长
  - 手动关闭
  - dismiss 过渡状态
- Confirm Dialog 已作为危险操作标准模式
- 骨架屏已在 Dashboard、表格等场景使用，而不是所有地方都用 spinner
- 某些列表页带有本地持久化显示偏好

这意味着重做时不应该只列“组件清单”，还要列“交互策略清单”。

## 4. 当前信息架构与页面路由

| 路由 | 页面 | 主要职责 |
| --- | --- | --- |
| `/` | Dashboard | 运行态总览、趋势、数据库状态、最近请求 |
| `/logs` | Logs | 请求日志检索、筛选、导出、查看详情 |
| `/events` | Events | 安全事件 / 系统事件查看 |
| `/models` | Model Management | Provider 管理、内置端点路由、自定义端点管理 |
| `/providers` | Model Management | 与 `/models` 复用同一页面 |
| `/api-keys` | API Keys | API Key 创建、启停、限制端点、统计 |
| `/settings` | Settings | 基础配置、协议、Web Auth、配置路径、日志清理 |
| `/help` | Help | 使用说明、客户端接入说明、FAQ |
| `/about` | About | 版本、构建信息、运行时信息 |
| `/login` | Login | Web UI 登录页 |

## 5. 页面级功能清单

## 5.1 登录页 Login

当前必须保留的能力：

- 根据 `/auth/session` 判断当前是否启用 Web Auth
- Web Auth 未启用时自动跳回主页面
- 已登录时自动跳回访问来源页
- 支持用户名 + 密码登录
- 支持登录失败错误提示
- 支持登录过程 loading 状态
- 支持记录原始跳转目标，登录成功后回跳

这意味着新前端不能只做一个静态登录壳子，必须保留完整的会话跳转逻辑。

### 当前实现审查补充

- `/login` 不是独立鉴权系统，而是 `RequireAuth + AuthProvider` 的补充入口
- 未登录访问受保护页面时，路由会把原始 `location` 放进 state，登录成功后回跳原目标页
- 当前只保留原始 `pathname`，不保留 query/hash
- 如果 Web Auth 未启用，登录页会直接返回主页面，不保留空壳
- 登录页错误来源有两层：
  - 本地表单校验未填写
  - 服务端登录失败 / session 刷新错误
- AuthProvider 会在首次启动时主动请求 `/auth/session`
- 且会在任意接口 `401` 后再次刷新 session 状态
- 当前没有：
  - MFA
  - SSO
  - 忘记密码
  - 验证码

## 5.2 仪表盘 Dashboard

这是当前前端的运行总览页，至少包含以下能力：

### 业务视角

- 端点维度筛选：`all` / `anthropic` / `openai` / 自定义端点
- 今日请求量
- 今日输入 Tokens
- 今日输出 Tokens
- 今日缓存读取 Tokens
- 今日缓存写入 Tokens
- 平均响应耗时

### 趋势与分析

- 最近 14 天请求趋势
- 最近 14 天 Token 趋势
- 最近 7 天模型使用排行
- 模型平均延迟
- TTFT（首 Token 耗时）对比
- TPOT（平均 ms/token）对比

### 运行态

- 当前监听 host / port
- Provider 数量
- 活跃请求数
- 活跃来源地址数
- 活跃会话数
- 最近 1 小时来源地址数
- 最近 1 小时会话数

### 数据库与运维

- 数据库大小
- WAL / freelist / 进程 RSS 等数据库相关信息
- 触发数据库 compact
- compact 成功/失败提示

### 最近请求

- 最近 5 条请求日志
- 按端点筛选联动刷新

### 交互机制

- 自动轮询刷新
- 手动刷新
- 请求失败 toast 提示
- 骨架屏加载态
- Header 顶部动作应保留为 `Refresh`
- Header 刷新按钮是聚合刷新，不是单图表刷新
- `compact DB` 是独立运维动作：
  - 防重复提交
  - 独立 loading 文案
  - 成功后额外刷新数据库信息
- 首屏加载不是单个 spinner，而是：
  - 6 个统计卡 skeleton
  - 4 个图表 skeleton
  - 5 行最近请求 skeleton table
- 首屏加载结束后，各模块仍保留各自独立的 loading / empty state：
  - 图表区可单独 empty
  - 模型表可单独 empty
  - 最近请求表可单独 empty

### 洞察层

当前 Dashboard 不只是展示数字，还会给出轻量分析型卡片：

- 统计周期内总请求量
- 最忙的一天
- 最高频模型
- 最快 TTFT 模型

因此后续设计上应把它视为“总览 + 洞察 + 运维”的组合页，而不是仅仅图表看板。

## 5.3 请求日志 Logs

这是当前排障最核心的页面之一，重做时绝对不能弱化。

### 检索与过滤

- Provider 筛选
- 端点筛选（内置端点 + 自定义端点）
- 模型筛选
- 状态筛选（全部 / 成功 / 失败）
- 起止日期筛选
- API Key 多选筛选
- 分页
- 每页条数切换

### 快捷视图

- All
- Errors
- Today
- Anthropic
- OpenAI

### 列表展示能力

- 可配置可见列
- 至少保留以下列体系：
  - endpoint
  - provider
  - requestedModel
  - routedModel
  - apiKey
  - inputTokens
  - cacheReadTokens
  - cacheCreationTokens
  - outputTokens
  - latency
  - ttft
  - tpot
  - status
  - error
- 支持舒适/紧凑两种行密度
- 列选择与行密度写入本地存储
- 至少保留 1 列，不能全部关闭
- 宽表横向滚动与滚动提示

### 导出能力

- 按当前筛选条件导出日志
- 导出文件为 ZIP
- 导出超时时间读取配置项 `logExportTimeoutSeconds`
- 前端侧发起浏览器下载

### 日志详情

当前代码实现使用右侧详情抽屉，但本轮重设计评审决定不再让详情常驻占用表格横向空间。

因此后续重做时，建议改为：

- 行内 `查看详情` 按钮触发 modal / overlay / 独立详情流
- 主日志表始终优先保证宽表浏览效率
- 详情打开后仍要保留当前筛选上下文与回到列表位置

不管最终采用 modal 还是全屏详情层，下面这些详情能力都必须完整保留：

- 基本摘要
- 路由信息（请求模型 -> 实际路由模型）
- 时间、会话 ID、端点、Provider
- 状态码、错误信息
- Tokens 与缓存 Tokens
- TTFT / TPOT / latency
- API Key 信息
- 脱敏后的 API Key 原值展示
- 客户端请求 payload
- 上游请求 payload
- 上游响应 payload
- 客户端响应 payload
- 在未发生协议改写时可退化为 2 个 payload 区块；发生协议改写时应支持 4 个独立区块
- 支持复制各个 payload 区块内容

### 查询与浏览体验

- 筛选条件变化后自动回到第一页
- 提供快捷视图状态识别，而不只是几个快捷按钮
- 宽表滚动场景有显式提示
- 表格应优先展示更多列，详情不应长期占据右侧宽度

### 重要业务约束

- 只有在 Settings 里启用 `storeRequestPayloads` / `storeResponsePayloads` 时，日志详情里的原始请求/响应内容才有意义
- 因此日志页与设置页是强耦合的，后续重做 UI 时不能把这两块当成互不相干的模块

## 5.4 模型管理 Model Management

这是当前产品最复杂的前端模块，实际上同时覆盖三类业务：

1. Provider 管理
2. 内置端点路由管理
3. 自定义端点管理

### 当前真实页面逻辑

这里有一个对后续重做非常关键的实现事实：

- 当前页面不是 “Provider / Routes / Presets 三栏同时编辑”
- 当前页面是 tab 驱动的单工作区
- system tabs 包括：
  - `providers`
  - `anthropic`
  - `openai`
- 每个自定义端点会再生成自己的 tab
- 上方 tab 只负责切换上下文，下方始终只有一个 active workspace

也就是说，后续 Pencil 重做时应按“切换上下文 -> 进入唯一工作区”的模式设计，而不是把 Provider、内置路由、Preset、自定义端点管理并排塞进同一屏主工作区。

补充说明：

- 顶部切换区不是普通 tabs 条，而是：
  - 一组内置视图大卡片：`providers` / `anthropic` / `openai`
  - 一条自定义端点横向卡片带
- 页面右上角的主操作是 `Add Endpoint`
- `Add Provider` 只出现在 providers 工作区内部，不在页面总头部

### A. Provider 管理

#### 列表与筛选

- 查看全部 Provider
- 按关键词搜索
- 按 Provider 类型筛选：
  - OpenAI
  - Anthropic
  - DeepSeek
  - Huawei
  - Kimi
  - Custom

#### Provider 卡片信息

- label / id
- baseUrl
- type
- authMode
- 模型数量
- 默认模型
- 所有模型标签列表

#### 新建/编辑 Provider

当前表单能力包括：

- `id`
- `label`
- `baseUrl`
- `apiKey`
- `type`
- `authMode`
  - `apiKey`
  - `authToken`
  - `xAuthToken`
- `defaultModel`
- `models[]`
  - model id
  - model label

并且当前 Provider 编辑器还具备一些不应在重做中丢失的高级交互：

- `id -> label` 自动同步
- 根据 provider type 自动带入 baseUrl 预设
- 某些类型会带入模型预设
- 默认模型合法性校验
- 打开时焦点管理
- 支持 Esc 关闭
- 存在 advanced 模式，不是永远展示所有细节

#### Provider 类型预设

当前内置了基础预设 URL：

- OpenAI
- DeepSeek
- Huawei Cloud
- Kimi
- Anthropic
- Custom

#### Provider 连通性测试

- 支持调用 `/api/providers/{id}/test`
- Anthropic 类型支持附加 Claude CLI 兼容 Header 预设
- 支持带附加 `headers` 与 `query` 做诊断测试
- 会显示响应状态、耗时、返回样本
- 用于快速验证上游是否可用

#### 危险操作

- 删除 Provider
- 二次确认

#### 当前实现审查发现

- 删除 Provider 时，当前代码会清理内置 `anthropic` / `openai` 路由里引用该 Provider 的规则
- 但没有看到同步清理“自定义端点 routing”里对该 Provider 的引用

这意味着后续重做时，前端交互上最好显式提示影响范围，且后续实现阶段建议补齐这部分一致性处理。

### B. 内置端点路由管理

当前内置端点至少有：

- `anthropic`
- `openai`

#### 路由规则编辑

- 每条规则是 `source model -> target provider:model`
- 支持新增规则
- 支持删除规则
- 支持重置为服务端当前保存值
- 支持保存
- 支持脏状态识别
- target 选择器本质上是可搜索、可自由输入的 combobox，不只是固定下拉框

#### 路由建议

当前会根据端点类型给出常见模型建议，一键填入 source model。

#### Anthropic 端点特有能力

- 对携带 Anthropic 协议的端点，可开启/关闭 Claude Code 请求校验
- 前端当前以开关形式控制
- 这不是纯展示项，而是后端验证行为开关

#### 路由预设 Presets

当前已具备完整路由预设能力：

- 保存当前路由为 preset
- 查看 preset 规则数
- 应用 preset
- 删除 preset
- 在应用前弹出 diff 对比
  - 新增规则
  - 删除规则
  - 修改规则

并且当前 preset 区是折叠面板，不是永久展开的常驻列表。

### C. 自定义端点管理

自定义端点不是“加一个名字”这么简单，当前模型管理页实际上是它的主控台。

#### 自定义端点列表

- 动态生成 tab/card
- 显示 label、description、protocol 标签
- 支持切换当前端点视图
- 支持删除可删除端点

注意：当前页面虽然有 `EndpointDrawer` 编辑态，但在主界面上并没有显式“编辑自定义端点”的入口；主界面层面当前更偏“新建 + 切换 + 删除”。

#### 新建/编辑自定义端点

当前支持：

- `id`
- `label`
- `enabled`
- `paths[]`
  - `path`
  - `protocol`

#### 多路径能力

每个自定义端点支持多个 path，而不是单一路径。

这是后续重做时不能丢的关键能力，因为它直接影响后端路由注册。

#### 当前前端暴露的协议选项

前端当前在自定义端点表单里暴露：

- `anthropic`
- `openai-auto`

但从后端类型定义与接口能力看，系统实际还支持：

- `openai-chat`
- `openai-responses`

这意味着：

- 当前前端对后端协议能力并没有完全展开
- 后续重做时可以考虑把协议维度设计得更完整，但不能破坏现有 `openai-auto` 语义

#### 自定义端点独立路由

每个自定义端点都有自己的模型路由区、自己的 preset 集，以及自己的启停状态。

也就是说，自定义端点不是 Provider 的附属属性，而是一级业务对象。

#### 实现与类型能力差异

当前前端表单里只暴露了：

- `anthropic`
- `openai-auto`

但类型定义已经支持：

- `openai-chat`
- `openai-responses`

因此后续重做时，设计稿里应预留更完整的协议表达方式；即便首版继续只开放部分协议，也不要把信息架构做死。

## 5.5 事件页 Events

当前事件页主要用于查看安全/系统事件。

必须保留的能力：

- 按等级筛选：`info` / `warn` / `error`
- 按事件类型筛选
- 最新 / 更早翻页（基于 cursor）
- 手动刷新
- 重置筛选
- 事件列表展示：
  - 类型
  - 等级
  - 标题
  - 消息
  - source
  - endpoint
  - IP
  - API Key 信息
  - user-agent
  - details

这个页面目前更偏“审计与安全事件台”，后续设计上可以更强调安全感知。

### 当前实现审查补充

- 当前事件页不是表格，而是事件卡片流
- 顶部筛选卡当前是 sticky 的，会随滚动保留在顶部
- 分页不是 page number，而是 cursor 模式：
  - `Newest`
  - `Older`
- “事件数量” badge 显示的是当前页 `events.length`，不是全量统计
- 刷新是手动 refresh，不是自动轮询
- 每次筛选变化都会重新请求并回到最新 cursor 视图
- 详情不是单独页面，而是卡片内 `details` 折叠区，直接展示 JSON
- 空态是整页 centered placeholder，不是表格空行

## 5.6 API Keys

这是访问控制与客户端分流的核心页面。

### 列表与筛选

- 搜索 key 名称 / 描述 / 端点
- 按状态筛选：
  - all
  - enabled
  - disabled

### 创建 API Key

当前支持：

- name
- description
- allowedEndpoints

并且创建成功后：

- 弹出一次性成功对话框
- 显示完整明文 key
- 支持复制
- 明确提醒“只展示一次”

### 引导层

当前 API Keys 页面不只是管理页，还自带 Quick Start 引导区：

- 引导创建 key
- 引导限制 endpoints
- 引导理解 wildcard key

### Key 列表卡片

当前展示维度包括：

- name
- 是否 wildcard
- enabled 状态
- 允许的 endpoints
- requestCount
- totalTokens
- createdAt
- lastUsedAt
- description
- maskedKey

### 单个 Key 操作

- 启用 / 禁用
- 删除（非 wildcard）
- reveal 明文 key
- hide 明文 key
- copy key
- 编辑允许访问的 endpoints

### Wildcard Key 语义

这是必须保留的特殊业务语义：

- wildcard key 不是普通 key
- 它代表更宽松的兼容行为
- 前端当前会显式区分 wildcard key
- wildcard key 不能按普通 key 的方式删除或细粒度限制

### Endpoint 限制

API Key 支持限制到：

- `anthropic`
- `openai`
- 自定义端点

并且要明确一个关键交互语义：

- 空选择 = 不限制端点 = 允许全部端点

这意味着 API Key 页面与自定义端点模块强耦合。

### 统计与分析

当前页面自带 API Key 使用分析：

- 时间范围切换：1 / 7 / 30 天
- 总 key 数
- 启用 key 数
- 活跃 key 数
- Top 10 请求量图
- Top 10 Token 消耗图

因此它不是简单 CRUD 页，而是“访问控制 + 使用统计”页面。

设计对齐时还需要注意：

- 顶部核心 summary 应优先表达 3 个真实代码语义：
  - Total Keys
  - Enabled Keys
  - Active Keys
- 其它如 endpoint restriction / wildcard policy 等信息可以作为补充摘要，但不应冒充主统计指标

### 当前实现审查补充

- API Key 主列表当前是卡片式 inventory，不是表格
- reveal 是逐卡片触发的局部状态机：
  - 未 reveal 前显示 masked key
  - reveal 后同位置切换为明文 key
  - 同时出现 copy / hide 动作
  - 已 reveal 的 key 再点击不会重复请求
  - wildcard key 不走 reveal / copy / hide 这套交互
- 编辑端点限制通过独立 dialog 完成，不在卡片内直接改
- 保存端点限制时：
  - 有选择 -> 提交具体 endpoint 列表
  - 空选择 -> 向后端提交 `null`，表示 unrestricted
- “All endpoints” 在当前实现里其实是反向语义：
  - `selected.length === 0`
  - 代表允许全部端点，而不是“没有权限”
- 列表存在两种空态：
  - 系统里一个 key 都没有
  - 有 key，但被搜索 / 状态筛选过滤为空
- 创建成功后不是只 toast，而是会弹出二次成功 dialog：
  - 展示完整明文 key
  - 警告“只展示一次”
  - 提供 copy
- 当前没有批量操作，也没有 key 名称/描述的二次编辑入口

## 5.7 设置页 Settings

设置页当前承担的是“系统运维设置”职责。

### 概览区

- 当前协议状态（HTTP / HTTPS）
- 当前安全状态（Web Auth 开关）
- 配置文件路径

### Section 导航

当前有 5 个 section：

1. Basics
2. Protocol
3. Security
4. Config File
5. Cleanup

并且：

- 桌面端有 sticky section 导航
- 移动端有 section 切换 chips

### A. Basics

当前支持修改：

- 监听 port
- 监听 host
- 日志保留天数
- 日志导出超时时间
- 请求体大小限制
- log level
- store request payloads
- store response payloads
- enable routing fallback

### B. Protocol

当前支持：

- HTTP 开关
- HTTP host / port
- HTTPS 开关
- HTTPS host / port
- HTTPS key path
- HTTPS cert path
- HTTPS ca path

并且前端已经明确表达：

- 这类改动通常需要 restart 才生效
- 页面会展示重启提示与命令示例

### C. Security

当前支持 Web Auth 配置：

- enabled
- username
- password
- confirm password

并清晰表达登录保护范围：

- `/ui`
- `/api/*`
- Cookie Session

关键业务规则：

- 从产品视角看，这套 Web Auth 用来保护控制台与管理接口
- 从后端实现视角看，真正被服务端会话强制保护的是 `/api/*`
- `/ui` 更接近公开入口壳 + 前端路由守卫
- 不保护 `/anthropic`、`/openai` 这类模型代理端点
- 也不保护匹配到的自定义代理路由

并且当前密码规则并不是“启用就随便填一下”：

- 首次启用且当前没有密码记录时，必须填写新密码
- 修改用户名时，也会要求重新设置密码

这是后续设计和文案里必须说清楚的事情。

### D. Config File

- 显示配置文件路径
- 支持一键复制

### E. Cleanup

当前提供两类运维操作：

- Soft cleanup：只清理超过保留期的日志
- Hard clear all：清空全部日志与相关统计

并且都有危险确认弹窗。

### 设置页交互模式

- 基础配置与安全配置是两套保存流程
- 页面有脏状态识别
- 底部有 sticky 未保存操作条
- 协议相关改动会根据差异提示“需重启生效”或“可立即保存”

这意味着重做时不能把所有设置做成“改完立即保存”的纯散点表单，否则会改变当前操作模型。

### 当前实现审查补充

- 页面并非只有内容区，还包含：
  - 桌面端 sticky section 导航
  - 移动端 section chips
- 加载态分两层：
  - 首屏配置加载是 page-level card + loader
  - Security / Web Auth 区还有独立 section-level loader
- 配置读取失败时有明确 missing config 错误态
- 底部 sticky 未保存条只在 `Basics` / `Security` 有脏状态时出现
- `Protocol` 虽然属于配置保存的一部分，但页面当前更强调：
  - restart warning
  - 证书路径校验
  - HTTP / HTTPS 至少启一个
- “需重启生效”在当前实现里是动态判定，不是静态标签：
  - 只有协议相关字段真的变化时才提示 restart required
  - 其他普通设置保存仍走普通成功反馈
- Web Auth 不是“开关即完成”：
  - 启用时若服务端还没有密码，必须设置密码
  - 用户名变化时，也会强制要求重新设置密码
- Cleanup / Clear All 都是两段式危险操作：
  - 先确认弹窗
  - 再进入不可随意关闭的处理态

## 5.8 Help

Help 页是当前产品内置文档中心，至少包含：

- 基础配置步骤
- Claude Code 接入说明
- Codex 接入说明
- 使用步骤
- Tips
- FAQ
- 代码片段展示
- 一键复制代码片段
- 页面内锚点导航
- FAQ 区块
- 快捷导航卡片
- 步骤文本中的代码块渲染

这个页面对于降低首次接入门槛非常关键，尤其是本项目本质上是本地网关，不是开箱即用的纯 SaaS 产品。

### 当前实现审查补充

- 页面顶部有快捷锚点卡片，可直接跳到：
  - configuration
  - claude
  - codex
  - faq
- 内容主体不是纯富文本，而是由 i18n 文案驱动的结构化 section
- 当前并不是通用 Markdown 渲染器，而是有限格式解析器
- step/faq 内容支持运行时格式化：
  - emoji
  - `**bold**`
  - 多行文本
  - fenced code block
  - FAQ 编号列表
- 代码块支持页面内一键复制
- Help 与 Logs / Settings 存在产品语义联动：
  - 文档里会引导用户去 Logs 验证请求
  - 也会说明 Settings 对日志与 payload 的影响

## 5.9 About

当前 About 页至少包含：

- 应用名
- 前端版本
- 构建时间
- backend runtime
- backend version
- host / port
- provider 数量
- active requests
- platform
- pid
- runtime 状态刷新

补充说明：

- 页面里有“检查更新”入口，但当前更像提示性动作，不是完整的在线升级系统
- 后续重做时不要误认为这里已有真实的升级中心能力

### 当前实现审查补充

- About 的运行态数据来自 `/api/status`
- 页面不是自动轮询，而是：
  - 初次加载一次
  - 用户手动点击 refresh 再拉取
- query 当前有 60 秒 stale cache，不应误设计成实时监控页
- 应用信息与运行态信息是两块独立 section
- 运行态 section 有独立 loading / empty / refreshing 状态
- “检查更新”当前只触发 info toast，不会进入真实升级流程

## 6. 前端依赖的后端接口能力

说明：

- 本节是结合 `src/web` 与 `crates/cc-gw-server/src` 共同整理的前后端契约
- 因此这里既包含前端实际调用的接口，也包含这些接口的关键参数约束
- 它比“只看前端代码”更完整，适合作为后续重做时的契约基线

下面是按业务域整理的前后端关联面，而不是单纯罗列 URL。

## 6.1 登录与鉴权

| 接口 | 作用 | 前端使用位置 |
| --- | --- | --- |
| `GET /auth/session` | 读取当前登录态 | `AuthProvider`、登录流程、路由守卫 |
| `POST /auth/login` | 登录 | Login |
| `POST /auth/logout` | 退出 | 顶部导航、AuthProvider |
| `GET /api/auth/web` | 读取 Web Auth 配置 | Settings |
| `POST /api/auth/web` | 更新 Web Auth 配置 | Settings |

补充约束：

- Session Cookie 名为 `ccgw_session`
- Cookie 具备 `HttpOnly`、`SameSite=Strict` 等安全属性
- 会话默认 12 小时 TTL，读取 session 会续期

## 6.2 运行态与配置

| 接口 | 作用 | 前端使用位置 |
| --- | --- | --- |
| `GET /api/status` | 获取运行态、活跃请求等 | Dashboard、About |
| `GET /api/config` | 获取基础配置 | Logs、Model Management |
| `PUT /api/config` | 更新基础配置 | Settings、Model Management |
| `GET /api/config/info` | 获取配置与配置文件路径 | Settings |

补充约束：

- `GET /api/status` 支持 `?endpoint=`，Dashboard 按端点筛选依赖这个契约
- `PUT /api/config` 不应视为 Web Auth 的唯一写入口；Web Auth 另有专门接口 `/api/auth/web`

## 6.3 Provider / 路由 / 自定义端点

| 接口 | 作用 | 前端使用位置 |
| --- | --- | --- |
| `GET /api/providers` | 获取 Provider 列表 | Logs、Model Management |
| `POST /api/providers/{id}/test` | 测试 Provider 连通性 | Model Management |
| `GET /api/custom-endpoints` | 获取自定义端点 | Dashboard、Logs、API Keys、Model Management |
| `POST /api/custom-endpoints` | 创建自定义端点 | Model Management |
| `PUT /api/custom-endpoints/{id}` | 更新自定义端点 | Model Management |
| `DELETE /api/custom-endpoints/{id}` | 删除自定义端点 | Model Management |
| `POST /api/routing-presets/{endpoint}` | 保存路由预设 | Model Management |
| `POST /api/routing-presets/{endpoint}/apply` | 应用路由预设 | Model Management |
| `DELETE /api/routing-presets/{endpoint}/{name}` | 删除路由预设 | Model Management |

补充约束：

- `POST /api/providers/{id}/test` 除了基础连通性测试，还支持附加 `headers` 和 `query`
- Anthropic 类型的测试还会基于 query 注入某些诊断 Header

## 6.4 日志、事件、数据库

| 接口 | 作用 | 前端使用位置 |
| --- | --- | --- |
| `GET /api/logs` | 日志列表查询 | Dashboard、Logs |
| `GET /api/logs/{id}` | 单条日志详情 | Logs |
| `POST /api/logs/export` | 导出日志 | Logs |
| `POST /api/logs/cleanup` | 清理旧日志 | Settings |
| `POST /api/logs/clear` | 清空日志与统计 | Settings |
| `GET /api/events` | 事件列表 | Events |
| `GET /api/db/info` | 数据库状态 | Dashboard |
| `POST /api/db/compact` | 压缩数据库 | Dashboard |

补充约束：

- `GET /api/logs` 支持：
  - `limit`
  - `offset`
  - `provider`
  - `model`
  - `endpoint`
  - `status`
  - `from`
  - `to`
  - `apiKeys` / `apiKeyIds` / `apiKey`
- `GET /api/events` 支持：
  - `limit`
  - `cursor`
  - `level`
  - `type`

## 6.5 统计

| 接口 | 作用 | 前端使用位置 |
| --- | --- | --- |
| `GET /api/stats/overview` | 总体统计 | Dashboard |
| `GET /api/stats/daily` | 每日趋势 | Dashboard |
| `GET /api/stats/model` | 模型维度统计 | Dashboard |
| `GET /api/stats/api-keys/overview` | API Key 概览统计 | API Keys |
| `GET /api/stats/api-keys/usage` | API Key 使用排行 | API Keys |

补充约束：

- 统计接口普遍支持 `endpoint`
- 部分接口还支持 `days`、`limit`
- 后续重做筛选器时，不能擅自改掉这些 query 参数语义

## 6.6 API Key

| 接口 | 作用 | 前端使用位置 |
| --- | --- | --- |
| `GET /api/keys` | API Key 列表 | Logs、API Keys |
| `POST /api/keys` | 创建 API Key | API Keys |
| `PATCH /api/keys/{id}` | 启停 / 限制 endpoints | API Keys |
| `DELETE /api/keys/{id}` | 删除 API Key | API Keys |
| `GET /api/keys/{id}/reveal` | 显示明文 Key | API Keys |

## 7. 前端虽不直接调用，但必须理解的后端能力

之所以要把这部分写出来，是因为重做前端不能只盯着 `/api/*` 管理接口，还要理解前端到底在管理什么。

当前后端真正被前端配置与观测的，是下面这组代理能力：

- Anthropic 入口：
  - `POST /v1/messages`
  - `POST /anthropic/v1/messages`
  - `POST /anthropic/v1/v1/messages`
  - `POST /v1/messages/count_tokens`
  - `POST /anthropic/v1/messages/count_tokens`
  - `POST /anthropic/v1/v1/messages/count_tokens`
  - `POST /anthropic/api/event_logging/batch`
- OpenAI 入口：
  - `GET /openai/v1/models`
  - `GET /openai/models`
  - `POST /openai/v1/chat/completions`
  - `POST /openai/chat/completions`
  - `POST /openai/v1/responses`
  - `POST /openai/responses`
- 自定义端点动态路由：
  - 根据配置生成不同 path 与协议映射

## 7.1 自定义端点协议映射要点

“自定义端点会自动注册完整 API 路径”这件事，后续在设计和实现里要写得更具体：

- `anthropic`
  - 生成 messages / count_tokens 相关路径
  - 兼容 `/v1/v1/...` 这类历史别名
- `openai-chat`
  - 生成 models + chat completions 相关路径
- `openai-responses`
  - 生成 models + responses 相关路径
- `openai-auto`
  - 同时支持 models + chat completions + responses

因此前端里的“协议选择器”实际上是在控制后端动态路由注册行为，而不只是一个展示标签。

## 7.2 Web UI 静态托管契约

后续重做前端时，还必须理解后端对静态资源托管的约束：

- `/ui/*` 走 SPA fallback
- `/assets/*` 走静态资源托管
- `favicon` 不存在时返回 `204`
- HTML 资源默认 `no-store`
- JS/CSS/字体/图片等静态资源默认长缓存 `immutable`

这会影响：

- 构建产物路径设计
- 资源缓存策略
- 是否允许 hash 化静态资源

也就是说，前端不是在管理一个抽象配置文件，而是在管理一整套真实的代理入口、鉴权规则、路由规则、日志记录与观测体系。

## 8. 重做前端时必须保留的关键业务规则

这部分非常关键，建议直接作为后续设计评审 checklist。

### 8.1 登录保护边界

- 从产品理解上，Web Auth 是“控制台登录保护”
- 从服务端实现上，真正被 session 强制保护的是 `/api/*`
- `/ui` 更像公开入口壳，登录保护主要依赖前端路由守卫与 API 401 行为
- 不保护 `/anthropic`、`/openai` 以及自定义代理路由
- 前端必须清楚传达这个边界，避免用户误判“开了 Web 登录就等于代理接口也上锁”

### 8.2 配置改动的生效模式并不一致

- Provider、路由、自定义端点多数是热更新思路
- HTTP / HTTPS 监听、证书路径这类配置通常需要 restart
- 前端必须把“即时生效”与“需重启生效”明确区分

### 8.3 路由规则不是普通键值对

- 它承载真实模型分发逻辑
- 支持 wildcard
- target 格式是 `provider:model`
- 不同 endpoint 有自己的独立路由空间

### 8.4 自定义端点是一级对象

- 有独立 ID
- 有独立 label
- 有独立 enabled 状态
- 可有多 path
- 可有不同协议
- 可有独立路由规则与 preset

并且它不是普通配置块，而是动态路由注册规则：

- 修改 path / protocol / enabled，会直接影响后端实际匹配结果

### 8.5 Wildcard Key 是特殊对象

- 不能按普通 key 理解
- 前端必须特殊展示与限制操作

### 8.6 日志能力与设置项强耦合

- payload 是否可看，受 Settings 里的存储开关控制
- 日志导出超时，受 Settings 里的导出超时控制
- 筛选参数语义还受后端 query 契约约束，不能随意改名

### 8.7 API Key 端点限制语义不能改

- 空选择 = 不限制 = 允许全部端点
- 这不是 UI 小细节，而是权限模型的一部分

### 8.8 当前系统不是实时推送控制台

- Dashboard 用轮询
- Logs / Events 主要是手动刷新与查询
- 当前没有 WebSocket 驱动的实时控制台

后续即使升级体验，也应当明确这是“增强项”，不是当前已存在行为。

## 9. 当前没有看到或尚未完整产品化的能力

为了避免后续设计误判，这里列出当前代码中没有形成完整能力、或者只是部分具备的点：

- 没有角色/权限系统，只有单层 Web UI 登录保护
- 没有多用户管理
- 没有前端侧的服务重启入口
- 没有证书生成向导，只是填写证书路径
- 没有 Provider 测试历史与诊断报告沉淀
- 没有日志实时流
- 没有事件详情页或事件规则管理
- 没有 API Key 批量操作
- 没有 API Key 创建后的名称/描述再编辑入口
- 自定义端点协议在 UI 上没有完全展开到所有后端能力
- About 页没有完整的在线升级中心
- 没有把 `/ui` 公开壳与 `/api/*` 会话保护差异做成特别强的产品说明

## 10. 给后续重设计团队的建议输出

如果后续要基于 Pencil 重做前端，建议至少产出以下设计物：

### P0：必须先补齐

- 全局信息架构图
- 页面流转图
- 应用壳层结构图
- 桌面端主导航方案
- 移动端导航方案
- 统一表格 / 抽屉 / 对话框 / 图表规范
- 统一 Toast / 骨架屏 / loading / empty / error 规范
- 表单错误、空状态、危险操作状态规范
- 鉴权态与未登录跳转规范
- 前后端 query 参数与保存接口契约

### P1：建议优化

- Provider 新建/编辑体验分步化
- 路由规则编辑器可视化增强
- 自定义端点列表与详情关系梳理
- Logs 详情页的信息层级优化
- API Key 生命周期设计（创建、显示一次、限制、禁用、删除）
- Settings 中“立即生效”和“需重启”差异的视觉强化
- 帮助页文档中心化与信息架构优化

## 11. 一句话结论

当前前端本质上是一套“本地 AI 网关控制台”，而不是几个零散管理页。

后续重做时，至少要完整覆盖：

- 登录保护
- 仪表盘观测
- 请求日志排障
- Provider 管理
- 模型路由管理
- 自定义端点管理
- API Key 与访问控制
- 系统设置
- 帮助文档
- 产品与运行信息说明

如果缺掉其中任意一块，新前端都会在功能上退化，而不只是界面变化。

## 12. 2026-03-18 路由与页面复核结论

本轮再次按实际代码复核了前端入口与顶层页面，结论如下：

- 顶层受保护页面只有：
  - Dashboard
  - Logs
  - Events
  - Model Management
  - API Keys
  - Settings
  - About
  - Help
- 登录入口页只有 `/login`
- `/providers` 不是独立新页面，而是复用 `ModelManagementPage`
- `src/web/src/pages/providers` 目录是模型管理页内部相关组件，不是额外顶层 route page
- 当前没有发现文档之外、需要单独补一套完整信息架构的隐藏主页面

因此，后续整套前端重做时，主导航级别的信息架构就以本文档列出的页面为准，不需要额外再虚构“资源管理中心”“升级中心”“用户中心”之类并不存在的一级模块。

## 13. 当前 Pencil 交付物清单

以下界面与规格稿当前已经落到 `/Users/chenpu/workspace/claude-code/cc-gw2/cc-gw.pen`，可直接继续在 Pencil 中深化或转交设计：

### 13.1 主界面稿

| 画板 ID | 说明 |
| --- | --- |
| `35hVw` | Dashboard 重设计稿 |
| `m9KBD` | Logs 重设计稿 |
| `4Xi2W` | Model Management / Routing 重设计稿 |
| `LHySw` | API Keys 重设计稿 |
| `YLPhl` | Settings 重设计稿 |
| `dfplC` | Events 重设计稿 |
| `De4DR` | Help 重设计稿 |
| `FNOoh` | About 重设计稿 |
| `1UGHX` | Login 重设计稿 |

### 13.2 状态与规格稿

| 画板 ID | 说明 |
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

### 13.3 本轮设计校正结论

- Logs 已明确按“宽表优先”处理，不再让详情长期占用右侧宽度
- 日志详情应由按钮触发 modal / overlay / 独立详情流
- Model Management 已按真实实现回归为“单工作区 + tabs/card 切换上下文”
- 自定义端点被保留为一级对象，而不是 Provider 的附属字段
- 自定义端点协议能力在信息架构上已预留扩展位，避免把 `openai-chat` / `openai-responses` 做死
- Dashboard 已校正为页头 `Refresh` 聚合动作，避免误导成 `New Provider`
- API Keys 已校正为真实 3 个核心统计：`Total / Enabled / Active`
- API Keys 中 wildcard 被保留为特殊兼容语义，不在顶栏动作区伪装成普通 reveal 流程
- 全套设计稿已补过一轮视觉强化，当前方向为：
  - light mode
  - pastel / soft gradient
  - 品牌化页头
  - 更强的卡片分层与状态色

## 14. 后续重开发 TODO Checklist

下面这份清单建议直接作为下一阶段的重构执行单使用。

### 14.1 设计转开发前必须锁定

- 锁定全局 console shell：
  - 桌面侧栏
  - 移动端抽屉
  - 顶部标题 / 描述 / 用户 / 主题 / 语言区
- 锁定统一状态规范：
  - loading
  - skeleton
  - empty
  - error
  - toast
  - confirm dialog
- 锁定表格规范：
  - Logs 宽表列体系
  - 横向滚动提示
  - 列选择持久化
  - 密度切换持久化
- 锁定详情流规范：
  - Logs 详情 modal / overlay
  - API Key 创建成功一次性展示
  - Provider / Endpoint / Confirm 等弹窗层级

### 14.2 重开发阶段必须逐项对齐的能力

- 鉴权：
  - `AuthProvider`
  - `RequireAuth`
  - `/login` 回跳逻辑
  - Web Auth 未启用时的自动回退
- Dashboard：
  - 首屏 skeleton
  - 聚合 refresh
  - compact DB
  - endpoint 维度筛选
- Logs：
  - 全量筛选器
  - 宽表列
  - ZIP 导出
  - 详情载荷复制
- Model Management：
  - providers 工作区
  - 内置端点 routing 工作区
  - 自定义端点工作区
  - presets / diff / connection test
- API Keys：
  - reveal / hide / copy 状态机
  - wildcard 特殊语义
  - endpoint restriction = `null` 表示 unrestricted
- Settings：
  - Basics / Protocol / Security 分区
  - sticky save bar
  - restart required 动态提示
  - cleanup / clear all 危险操作
- Events / Help / About：
  - Events sticky filters + cursor pagination
  - Help 锚点与代码片段复制
  - About 的 `/api/status` 手动刷新与非升级中心定位

### 14.3 联调与验收阶段必须补的验证

- 校验所有 query 参数与当前后端接口语义一致
- 校验 `openai-auto` 与扩展协议映射不会破坏现有路由行为
- 校验删除 Provider 时对内置路由与自定义端点路由的引用清理策略
- 校验 API Key 空 endpoint 选择仍提交 `null`
- 校验 Settings 中 payload 存储开关与 Logs 详情展示逻辑联动
- 校验 `/ui`、`/assets`、SPA fallback 与缓存策略没有被新构建方式破坏
