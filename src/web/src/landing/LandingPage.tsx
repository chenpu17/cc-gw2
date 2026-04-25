import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  CheckCircle2,
  ChevronDown,
  Copy,
  FileText,
  Gauge,
  Github,
  KeyRound,
  Languages,
  Lock,
  Network,
  Repeat,
  Terminal,
  XCircle,
  Zap,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/utils/clipboard'
import { BrandMark } from '@/components/BrandMark'
import dashboardShotZh from '../../../../docs/assets/compare-pen/live-dashboard.png'
import logsShotZh from '../../../../docs/assets/compare-pen/live-logs.png'
import modelsShotZh from '../../../../docs/assets/compare-pen/live-model-management.png'
import apiKeysShotZh from '../../../../docs/assets/compare-pen/live-api-keys.png'
import profilerShotZh from '../../../../docs/assets/compare-pen/live-events.png'
import dashboardShotEn from '../../../../docs/assets/compare-pen/live-en-dashboard.png'
import logsShotEn from '../../../../docs/assets/compare-pen/live-en-logs.png'
import modelsShotEn from '../../../../docs/assets/compare-pen/live-en-model-management.png'
import apiKeysShotEn from '../../../../docs/assets/compare-pen/live-en-api-keys.png'
import profilerShotEn from '../../../../docs/assets/compare-pen/live-en-events.png'
import packageJson from '../../../../package.json' with { type: 'json' }

const packageVersion = (packageJson as { version?: string }).version ?? '0.0.0'

type Lang = 'zh' | 'en'
type T = { zh: string; en: string }
type TImg = { zh: string; en: string }
const t = (lang: Lang, v: T) => v[lang]

// ---------- copy ----------

const COPY = {
  nav: {
    why: { zh: '现状', en: 'The mess' },
    how: { zh: '怎么用', en: 'How' },
    debug: { zh: '排查', en: 'Debug' },
    local: { zh: '本地优先', en: 'Local-first' },
    start: { zh: '开始', en: 'Start' },
    faq: { zh: 'FAQ', en: 'FAQ' },
  },
  ctaConsole: { zh: '打开控制台', en: 'Open console' },
  ctaInstall: { zh: '立即安装', en: 'Install now' },
  ctaPreview: { zh: '看看控制台长什么样', en: 'Preview the console' },
  hero: {
    badge: {
      zh: 'v' + packageVersion + ' · Rust 内核 · 完全开源',
      en: 'v' + packageVersion + ' · Rust core · Open source',
    },
    h1Top: { zh: '你的 API Key', en: 'Your API key' },
    h1Bottom: {
      zh: '不该躺在 30 个 .env 里',
      en: 'shouldn’t live in 30 .env files',
    },
    lead: {
      zh: 'cc-gw 在你的机器上跑一个本地网关。Claude Code、OpenAI SDK、Anthropic SDK 全部指向同一个地址。换模型、换 provider、查日志，再也不用翻业务代码。',
      en: 'cc-gw runs a small gateway right on your machine. Point Claude Code, the OpenAI SDK, and the Anthropic SDK at one address — then swap models, switch providers, and trace requests without touching your app code.',
    },
    note: {
      zh: '不需要本机有 Rust 环境，npm 自动拉对应平台的预编译二进制。',
      en: 'No Rust toolchain needed — npm pulls the right prebuilt binary for your platform.',
    },
    proof: [
      { zh: '一条命令装好，本机就能跑', en: 'One command to install, runs on your laptop' },
      { zh: '客户端只改 baseURL，不动业务逻辑', en: 'Clients only change baseURL — your code stays put' },
      { zh: '所有数据都在 ~/.cc-gw 下，不走云', en: 'Everything lives under ~/.cc-gw — nothing leaves your box' },
    ] as T[],
    works: { zh: '已经在以下客户端里跑通', en: 'Tested with' },
  },
  why: {
    eyebrow: { zh: '现状', en: 'The mess' },
    title: {
      zh: 'AI 接进来不难，难的是接进来之后',
      en: 'Wiring up AI is easy. Living with it isn’t.',
    },
    description: {
      zh: '你大概率已经踩过下面这三件事里的至少两件。这就是为什么有了 cc-gw。',
      en: 'You’ve probably hit at least two of these. That’s why cc-gw exists.',
    },
    cards: [
      {
        title: { zh: 'Key 散在各个 .env 里', en: 'Keys scattered across .env files' },
        body: {
          zh: '每个项目自己一份 baseURL、自己一份 key、自己一份模型名。时间一长，没人敢动，也没人记得清。',
          en: 'Every project keeps its own baseURL, its own key, its own model name. Six months in, nobody dares touch it.',
        },
        sample: 'OPENAI_BASE_URL=https://...\nANTHROPIC_API_KEY=sk-ant-...\nMODEL=gpt-4o-2024-08-06',
      },
      {
        title: { zh: '出错只能猜', en: 'Debugging is just guessing' },
        body: {
          zh: '是 payload 错？协议不对？上游挂了？key 被收回了？没有统一日志，只能 curl 一遍试一遍。',
          en: 'Bad payload? Wrong protocol? Upstream down? Key revoked? Without one log to look at, you curl your way through every theory.',
        },
        sample: '$ curl ... 401\n# 是 key 过期？还是 endpoint 写错了？\n# Or has the key been rotated?',
      },
      {
        title: { zh: '换模型像拆地雷', en: 'Swapping models is a minefield' },
        body: {
          zh: '想从 GPT-4o 换 Claude Sonnet？要么 grep 30 个文件挨个改，要么改一堆环境变量然后祈祷。',
          en: 'Want to try Claude Sonnet instead of GPT-4o? Either grep 30 files or rotate a pile of env vars and pray.',
        },
        sample: '- model: gpt-4o\n+ model: claude-sonnet-4-5\n  // 30 处需要同步修改…',
      },
    ],
  },
  how: {
    eyebrow: { zh: '怎么解决', en: 'The fix' },
    title: {
      zh: '一个本地入口，背后什么都能换',
      en: 'One local endpoint. Anything behind it can change.',
    },
    description: {
      zh: '客户端只认 cc-gw。模型、provider、路由策略，全都在网关里调，业务代码不动。',
      en: 'Your clients only know cc-gw. Models, providers, routing rules — all live in the gateway. Your code never moves.',
    },
    diagramLabels: {
      clients: { zh: '你的客户端', en: 'Your clients' },
      gateway: { zh: '本地网关', en: 'Local gateway' },
      providers: { zh: '上游 Provider', en: 'Upstream providers' },
    },
    differentiator: {
      eyebrow: { zh: '一个真正的差异化', en: 'A real superpower' },
      title: {
        zh: '用 Anthropic 的代码，调 GPT-4o；反过来也行',
        en: 'Write Anthropic code, route to GPT-4o. Or the other way around.',
      },
      body: {
        zh: 'cc-gw 在网关层完成 Anthropic ↔ OpenAI Chat ↔ OpenAI Responses 三端六方向的协议转换，包括 SSE 流式。所以 Claude Code 里写的代码可以路由到 GPT-4o，OpenAI SDK 写的代码也可以路由到 Claude。',
        en: 'cc-gw does full bidirectional translation across Anthropic, OpenAI Chat, and OpenAI Responses — including SSE streaming. So your Claude Code can run on GPT-4o, and your OpenAI SDK can run on Claude.',
      },
      example: { zh: '示例：客户端协议 → 上游模型', en: 'Example: client protocol → upstream model' },
    },
    flowSteps: [
      { zh: '客户端发起请求', en: 'Client sends request' },
      { zh: '按规则匹配 Provider', en: 'Routes to the right provider' },
      { zh: '协议转换 + 流式透传', en: 'Translates protocol + streams through' },
      { zh: '回包同时落日志', en: 'Logs the round-trip on the way back' },
    ] as T[],
  },
  debug: {
    eyebrow: { zh: '排查', en: 'Observability' },
    title: {
      zh: '出了事，能看到一整段对话',
      en: 'When things break, see the whole conversation',
    },
    description: {
      zh: '不只是一条请求的耗时。Profiler 把多轮对话的每一 turn 串成 session，TTFT、TPOT、token 用量全都记下来。',
      en: 'Not just a single request. The Profiler stitches every turn of a multi-turn conversation into one session, with TTFT, TPOT, and token counts all recorded.',
    },
    payload: {
      title: { zh: '四段 payload，分开存', en: 'Four payloads, stored separately' },
      body: {
        zh: '每个请求都会保留：客户端发出的、网关转给上游的、上游回来的、再转回客户端的。跨协议有 bug？两侧对照一下就清楚了。',
        en: 'For every request we keep four blobs: what the client sent, what we sent upstream, what came back, and what the client finally received. Cross-protocol bug? Compare both sides — done.',
      },
      stages: [
        { zh: '客户端请求', en: 'Client request' },
        { zh: '上游请求', en: 'Upstream request' },
        { zh: '上游响应', en: 'Upstream response' },
        { zh: '客户端响应', en: 'Client response' },
      ] as T[],
      clientSide: { zh: '客户端侧', en: 'client side' },
      upstreamSide: { zh: '上游侧', en: 'upstream side' },
    },
    pillars: [
      {
        icon: FileText,
        title: { zh: 'Logs', en: 'Logs' },
        body: {
          zh: '按 endpoint / Key / 状态码筛选，定位失败请求只要几秒。可选保留完整 payload。',
          en: 'Filter by endpoint, key, or status code. Optional full-payload capture.',
        },
      },
      {
        icon: Gauge,
        title: { zh: 'Profiler', en: 'Profiler' },
        body: {
          zh: '按 session 聚合多轮 turn。每轮 TTFT / TPOT / tokens 一目了然，慢的那 turn 一眼能挑出。',
          en: 'Multi-turn sessions, one row per turn. TTFT, TPOT, tokens — spot the slow turn instantly.',
        },
      },
      {
        icon: Network,
        title: { zh: 'Events', en: 'Events' },
        body: {
          zh: '配置变更、Key 增删、鉴权失败、并发拒绝，全部以事件形式可追溯。',
          en: 'Config changes, key edits, auth failures, concurrency rejects — all auditable as events.',
        },
      },
    ],
  },
  local: {
    eyebrow: { zh: '本地优先', en: 'Local-first' },
    title: {
      zh: '所有东西都在你机器的 ~/.cc-gw 下',
      en: 'Everything lives under ~/.cc-gw on your machine',
    },
    description: {
      zh: '没有云端，没有遥测，没有外部依赖。配置可以版本管理，数据库可以直接打开，要离线跑就离线跑。',
      en: 'No cloud. No telemetry. No external dependencies. Version-control your config, open the SQLite file with any tool, run it offline if you want to.',
    },
    pillars: [
      {
        icon: Lock,
        title: { zh: 'Key 加密落库', en: 'Keys encrypted at rest' },
        body: {
          zh: 'API Key 用 AES-256-GCM 加密存储，索引只走 SHA-256 哈希，明文永不落盘。',
          en: 'API keys encrypted with AES-256-GCM. Lookups go through SHA-256 hashes — plaintext never hits disk.',
        },
      },
      {
        icon: KeyRound,
        title: { zh: '按客户端独立 Key', en: 'Per-client API keys' },
        body: {
          zh: '为不同客户端、环境、成员发独立 Key。可设并发上限，可配 endpoint 白名单，停用即时生效。',
          en: 'Issue separate keys per client, env, or teammate. Set concurrency caps, restrict to specific endpoints, revoke instantly.',
        },
      },
      {
        icon: Repeat,
        title: { zh: '配置热改，无需重启', en: 'Hot reload — no restart' },
        body: {
          zh: '改路由、加自定义 endpoint、调默认模型，控制台保存即生效。Rust 后端常驻，开发机也能长期挂着。',
          en: 'Edit routing, add custom endpoints, change defaults — saves apply live. The Rust process is light enough to leave running on your laptop.',
        },
      },
      {
        icon: Zap,
        title: { zh: '老用户数据无痛迁移', en: 'Old data just works' },
        body: {
          zh: '从旧 Node 版本升级？config.json 和 gateway.db 直接继承，自动做 schema 迁移，历史日志一条不丢。',
          en: 'Upgrading from the old Node build? Your config.json and gateway.db carry over — schema is migrated in place, no log loss.',
        },
      },
    ],
    treeCaption: {
      zh: '一切都在这个目录下，备份它就等于备份了整个 cc-gw。',
      en: 'Back up this folder and you’ve backed up your entire cc-gw setup.',
    },
  },
  start: {
    eyebrow: { zh: '开始', en: 'Get started' },
    title: { zh: '4 步跑起来', en: 'Up and running in four steps' },
    description: {
      zh: '不用先改团队流程。先让一个客户端走通，看到价值再往后扩。',
      en: 'No team-wide migration. Get one client through first — expand from there.',
    },
    steps: [
      {
        title: { zh: '安装', en: 'Install' },
        body: {
          zh: '一条命令搞定，npm 会自动拉对应平台的预编译二进制。',
          en: 'One command. npm grabs the prebuilt binary for your platform automatically.',
        },
        code: 'npm install -g @chenpu17/cc-gw',
      },
      {
        title: { zh: '启动', en: 'Start' },
        body: {
          zh: '前台模式方便观察日志；想常驻就 `--daemon`。默认绑定 127.0.0.1:4100。',
          en: 'Foreground for live logs, or `--daemon` to keep it running. Binds to 127.0.0.1:4100 by default.',
        },
        code: 'cc-gw start --foreground --port 4100',
      },
      {
        title: { zh: '加 Provider', en: 'Add a provider' },
        body: {
          zh: '打开控制台，把你的 OpenAI / Anthropic / 兼容 provider 填进去。',
          en: 'Open the console and plug in your OpenAI, Anthropic, or any compatible provider.',
        },
        code: 'open http://127.0.0.1:4100/ui',
      },
      {
        title: { zh: '指过去', en: 'Point your client' },
        body: {
          zh: '客户端只改 baseURL。Anthropic 协议走根路径，OpenAI 协议加 /openai/v1 前缀。',
          en: 'Just change baseURL. Anthropic protocol uses the root path; OpenAI uses /openai/v1.',
        },
        code: "ANTHROPIC_BASE_URL='http://127.0.0.1:4100'\nOPENAI_BASE_URL='http://127.0.0.1:4100/openai/v1'",
      },
    ],
  },
  console: {
    eyebrow: { zh: '控制台', en: 'Console' },
    title: { zh: '不是摆设，是你每天用的地方', en: 'Not for show — you’ll be in here daily' },
    description: {
      zh: '请求进来之后，趋势、日志、路由、Key、Profiler 都在同一个台子里。',
      en: 'Once requests start flowing, trends, logs, routing, keys, and profiler all live under one roof.',
    },
  },
  fit: {
    eyebrow: { zh: '适合谁', en: 'Who it’s for' },
    title: {
      zh: '诚实地说：它不是为所有人做的',
      en: 'Honestly: it’s not for everyone',
    },
    description: {
      zh: '如果你的 AI 调用已经开始扩张，但又没到要上组织级治理平台的程度，cc-gw 多半正好卡在合适的位置。',
      en: 'If your AI usage is growing but you’re not ready for an enterprise governance platform, cc-gw probably sits right where you need it.',
    },
    yesTitle: { zh: '适合', en: 'Good fit' },
    noTitle: { zh: '不适合', en: 'Not a fit' },
    yes: [
      { zh: '同时在用 Claude Code、OpenAI SDK、Anthropic SDK', en: 'Already juggling Claude Code, OpenAI SDK, and Anthropic SDK' },
      { zh: '2-10 人 AI 小队，需要共享入口和日志', en: 'A 2–10 person AI team that needs a shared entrypoint and shared logs' },
      { zh: '10-100 人研发团队，开始多人共享模型调用', en: 'A 10–100 dev team starting to share model calls across people' },
      { zh: '想自托管，对数据归属敏感', en: 'You self-host. Data sovereignty matters.' },
      { zh: '受不了把 key、baseURL 散在每个项目里', en: 'You’re tired of keys and baseURLs sprinkled across every repo' },
    ] as T[],
    no: [
      { zh: '需要跨 BU 治理、复杂审批流', en: 'You need cross-BU governance and complex approval flows' },
      { zh: '需要企业 SSO 与组织级策略中台', en: 'Enterprise SSO and org-level policy hubs' },
      { zh: '需要多副本 HA 集群', en: 'High-availability multi-replica clusters' },
      { zh: '强 Compliance 场景（金融、医疗等）', en: 'Heavily regulated industries (finance, healthcare)' },
      { zh: '希望一套大平台囊括所有 AI 成本结算', en: 'A single platform to handle all AI cost reconciliation' },
    ] as T[],
  },
  faq: {
    eyebrow: { zh: 'FAQ', en: 'FAQ' },
    title: { zh: '你可能想问', en: 'You probably want to ask' },
    description: {
      zh: '从是否值得装、会不会绑死、数据放哪几个最常见的疑问开始。',
      en: 'Starting with the questions people ask most: is it worth it, does it lock me in, where does my data live.',
    },
    items: [
      {
        q: { zh: '我一个人用，也值得装吗？', en: 'I’m a solo dev — is it still worth it?' },
        a: {
          zh: '只用一个 provider、一个项目，可能不需要。但只要你同时在用 Claude Code 和 OpenAI SDK，或者经常切模型，统一入口能省下来的维护时间会很可观。',
          en: 'If you use one provider and one project, probably not. But the moment you’re juggling Claude Code and the OpenAI SDK — or switching models often — having one entrypoint pays back fast.',
        },
      },
      {
        q: { zh: '会不会被 cc-gw 绑死？', en: 'Will I get locked into cc-gw?' },
        a: {
          zh: '不会。客户端用的还是 OpenAI / Anthropic 标准协议，不要 cc-gw 也能工作。配置和数据都是 JSON + SQLite，可以直接读、直接迁。',
          en: 'No. Your clients still speak standard OpenAI / Anthropic protocols and work fine without cc-gw. Your config is plain JSON, your data is plain SQLite — read or migrate it any time.',
        },
      },
      {
        q: { zh: '数据存在哪里？会上传吗？', en: 'Where does my data live? Does anything get uploaded?' },
        a: {
          zh: '全部在本机 ~/.cc-gw/ 下：config.json、SQLite 数据库、加密密钥、日志文件。请求只在你和上游 provider 之间转发，cc-gw 自己不发遥测。',
          en: 'Everything is local under ~/.cc-gw/: config.json, the SQLite database, the encryption key, and log files. Requests flow only between you and the upstream provider — cc-gw sends no telemetry.',
        },
      },
      {
        q: { zh: '它和 LiteLLM、One API 这些有啥区别？', en: 'How is it different from LiteLLM or One API?' },
        a: {
          zh: '主要三点：(1) 默认本地优先、零云依赖；(2) 跨协议三端六方向真正双向转换，包括 SSE 流式；(3) 内置按 session 聚合的 Profiler 和四段 payload 存储，专门给跨协议排查用。',
          en: 'Three things: (1) local-first by default, zero cloud dependency; (2) true bidirectional translation across Anthropic, OpenAI Chat, and OpenAI Responses — streaming included; (3) a built-in Profiler that groups multi-turn sessions, plus four-segment payload storage purpose-built for cross-protocol debugging.',
        },
      },
      {
        q: { zh: '安装需要本机有 Rust 吗？', en: 'Do I need Rust installed?' },
        a: {
          zh: '不需要。npm 包通过 optionalDependencies 自动拉对应平台的预编译二进制：macOS arm64、Linux x64/arm64、Windows x64。',
          en: 'No. The npm package uses optionalDependencies to pull the right prebuilt binary for your platform: macOS arm64, Linux x64/arm64, and Windows x64.',
        },
      },
    ],
  },
  cta: {
    title: { zh: '今天就把这件事处理掉', en: 'Take care of this today' },
    body: {
      zh: '一条命令就能装好。先在本地跑通一个客户端，看到价值再往后扩。',
      en: 'One command to install. Get one client running locally, see if it pays back, then keep going.',
    },
  },
  footer: {
    tagline: {
      zh: 'cc-gw · 给开发者和小团队的本地优先 AI 网关',
      en: 'cc-gw · A local-first AI gateway for developers and small teams',
    },
    console: { zh: '控制台', en: 'Console' },
    changelog: { zh: '更新日志', en: 'Changelog' },
  },
}

const compatibilityBadges = ['Claude Code', 'OpenAI SDK', 'Anthropic SDK', 'cURL', 'LangChain', 'Vercel AI SDK']

const protocolExamples = [
  {
    client: 'Anthropic SDK',
    upstream: { zh: 'OpenAI · GPT-4o', en: 'OpenAI · GPT-4o' } as T,
    accent: 'from-amber-500/20 to-rose-500/20 text-amber-600',
  },
  {
    client: 'OpenAI SDK',
    upstream: { zh: 'Anthropic · Claude Sonnet', en: 'Anthropic · Claude Sonnet' } as T,
    accent: 'from-cyan-500/20 to-indigo-500/20 text-cyan-600',
  },
  {
    client: 'Claude Code',
    upstream: { zh: '本地 Ollama / 自建模型', en: 'Local Ollama / self-hosted' } as T,
    accent: 'from-emerald-500/20 to-teal-500/20 text-emerald-600',
  },
]

const compatibleProviders: T = {
  zh: '兼容 provider · 自建模型',
  en: 'Compatible providers · self-hosted',
}

const codeUi = {
  copy: { zh: '复制', en: 'Copy' } as T,
  copied: { zh: '已复制', en: 'Copied' } as T,
}

const directoryTree = `~/.cc-gw/
├── config.json          # 直接编辑也行 / edit by hand if you like
├── encryption.key       # 自动生成 / auto-generated
├── cc-gw.pid
├── data/
│   └── gateway.db       # SQLite (WAL) — 直接 sqlite3 打开
└── logs/
    └── cc-gw.log`

const consoleTabs = [
  { id: 'dashboard', shot: { zh: dashboardShotZh, en: dashboardShotEn }, label: { zh: '总览', en: 'Dashboard' }, blurb: { zh: '今天的请求量、延迟、健康状态，一屏看完。', en: 'Today’s request volume, latency, and health — at a glance.' } },
  { id: 'logs', shot: { zh: logsShotZh, en: logsShotEn }, label: { zh: '请求日志', en: 'Logs' }, blurb: { zh: '按 endpoint / Key / 状态码筛，几秒定位。', en: 'Filter by endpoint, key, or status. Find issues in seconds.' } },
  { id: 'routing', shot: { zh: modelsShotZh, en: modelsShotEn }, label: { zh: '模型路由', en: 'Routing' }, blurb: { zh: '别名、通配匹配、fallback 链全在 UI 里维护。', en: 'Aliases, wildcards, and fallback chains — all in the UI.' } },
  { id: 'keys', shot: { zh: apiKeysShotZh, en: apiKeysShotEn }, label: { zh: 'API Keys', en: 'API Keys' }, blurb: { zh: '按客户端发独立 Key，可设并发上限。', en: 'Per-client keys with concurrency caps.' } },
  { id: 'profiler', shot: { zh: profilerShotZh, en: profilerShotEn }, label: { zh: 'Profiler & Events', en: 'Profiler & Events' }, blurb: { zh: '多轮对话按 session 聚合，事件流可追溯。', en: 'Sessions group multi-turn calls. Events keep an audit trail.' } },
]

// ---------- atoms ----------

function highlightCode(line: string): ReactNode {
  if (line.trim().startsWith('#')) return <span className="text-slate-500">{line}</span>
  if (line.startsWith('$ ')) {
    return (
      <>
        <span className="select-none text-emerald-400">$ </span>
        <span className="text-slate-100">{line.slice(2)}</span>
      </>
    )
  }
  const assign = line.match(/^(\s*)([A-Z_][\w]*)(\s*=\s*)(.+)$/)
  if (assign) {
    const [, indent, key, op, val] = assign
    const isStr = val!.startsWith("'") || val!.startsWith('"')
    return (
      <>
        <span>{indent}</span>
        <span className="text-indigo-300">{key}</span>
        <span className="text-slate-400">{op}</span>
        <span className={isStr ? 'text-emerald-300' : 'text-slate-100'}>{val}</span>
      </>
    )
  }
  return <span className="text-slate-100">{line}</span>
}

function CodeBlock({
  code,
  label,
  className,
  copyLabel,
  copiedLabel,
}: {
  code: string
  label: string
  className?: string
  copyLabel: string
  copiedLabel: string
}) {
  const [copied, setCopied] = useState(false)
  async function onCopy() {
    await copyToClipboard(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        type="button"
        aria-label={`Copy ${label}`}
        onClick={onCopy}
        className="absolute right-3 top-3 z-10 inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-medium text-slate-100 transition hover:bg-white/15"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? copiedLabel : copyLabel}
      </button>
      <pre className="max-w-full overflow-x-auto rounded-2xl bg-slate-950 p-5 font-mono text-[13px] leading-7 text-slate-100 ring-1 ring-white/5 [&_::selection]:bg-blue-500/40 [&_::selection]:text-white">
        <code>
          {code.split('\n').map((line, i) => (
            <span key={i} className="block">
              {highlightCode(line) ?? '\u00a0'}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function InstallPill() {
  const [copied, setCopied] = useState(false)
  const cmd = 'npm install -g @chenpu17/cc-gw'
  async function onCopy() {
    await copyToClipboard(cmd)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }
  return (
    <div className="inline-flex w-full max-w-md items-center gap-2 rounded-2xl border border-white/15 bg-white/5 py-2 pl-4 pr-2 backdrop-blur-sm">
      <span className="select-none font-mono text-emerald-400">$</span>
      <span className="select-all truncate font-mono text-sm text-slate-100">{cmd}</span>
      <button
        type="button"
        aria-label="Copy install command"
        onClick={onCopy}
        className="ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/10 text-slate-200 transition hover:bg-white/20"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

function SectionHead({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description: string
}) {
  return (
    <div className="max-w-3xl">
      <div className="font-mono text-xs font-semibold uppercase tracking-[0.22em] text-indigo-600">
        {eyebrow}
      </div>
      <h2 className="mt-4 text-3xl font-semibold tracking-[-0.02em] text-slate-950 sm:text-4xl">
        {title}
      </h2>
      <p className="mt-4 text-base leading-8 text-slate-600 sm:text-lg">{description}</p>
    </div>
  )
}

// ---------- page ----------

export default function LandingPage() {
  const [lang, setLang] = useState<Lang>('zh')
  const [activeTab, setActiveTab] = useState(consoleTabs[0]!.id)
  const [openFaq, setOpenFaq] = useState<number | null>(0)
  const tt = (v: T) => t(lang, v)
  const activeConsole = consoleTabs.find((c) => c.id === activeTab) ?? consoleTabs[0]!

  const navItems = [
    { href: '#why', label: tt(COPY.nav.why) },
    { href: '#how', label: tt(COPY.nav.how) },
    { href: '#debug', label: tt(COPY.nav.debug) },
    { href: '#local', label: tt(COPY.nav.local) },
    { href: '#start', label: tt(COPY.nav.start) },
    { href: '#faq', label: tt(COPY.nav.faq) },
  ]

  return (
    <div className="min-h-screen bg-white text-slate-950 antialiased">
      {/* ============= HEADER ============= */}
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-3.5 sm:px-8 lg:px-10">
          <a href="#top" className="flex items-center gap-2.5">
            <BrandMark className="h-9 w-9" title="cc-gw" />
            <div className="leading-tight">
              <div className="text-[15px] font-semibold tracking-tight">cc-gw</div>
              <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-slate-500">
                local-first ai gateway
              </div>
            </div>
          </a>

          <nav className="hidden items-center gap-1 lg:flex">
            {navItems.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-lg px-3 py-1.5 text-sm text-slate-600 transition hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
              aria-label="Toggle language"
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-slate-300"
            >
              <Languages className="h-3.5 w-3.5" />
              {lang === 'zh' ? 'EN' : '中文'}
            </button>
            <a
              href="/ui/"
              className="hidden rounded-lg border border-slate-200 bg-white px-3.5 py-1.5 text-sm font-medium text-slate-700 transition hover:border-slate-300 hover:text-slate-950 sm:inline-flex"
            >
              {tt(COPY.ctaConsole)}
            </a>
            <a
              href="https://github.com/chenpu17/cc-gw2"
              className="inline-flex items-center gap-1.5 rounded-lg bg-slate-950 px-3.5 py-1.5 text-sm font-medium text-white transition hover:bg-slate-800"
            >
              <Github className="h-4 w-4" />
              GitHub
            </a>
          </div>
        </div>

        <nav
          aria-label="Mobile section navigation"
          className="flex gap-1.5 overflow-x-auto border-t border-slate-200/70 px-4 py-2 lg:hidden"
        >
          {[...navItems, { href: '/ui/', label: tt(COPY.ctaConsole) }].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-lg bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main id="top">
        {/* ============= HERO ============= */}
        <section className="relative overflow-hidden bg-slate-950 text-white [&_::selection]:bg-indigo-400/40 [&_::selection]:text-white">
          <div
            aria-hidden
            className="absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'linear-gradient(to right, rgba(148,163,184,0.18) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.18) 1px, transparent 1px)',
              backgroundSize: '48px 48px',
              maskImage: 'radial-gradient(ellipse at center top, black 30%, transparent 75%)',
              WebkitMaskImage: 'radial-gradient(ellipse at center top, black 30%, transparent 75%)',
            }}
          />
          <div
            aria-hidden
            className="pointer-events-none absolute -top-40 left-1/2 h-[640px] w-[1100px] -translate-x-1/2 rounded-full opacity-60 blur-[120px]"
            style={{
              background:
                'radial-gradient(closest-side, rgba(99,102,241,0.55), transparent 70%), radial-gradient(closest-side at 70% 60%, rgba(34,211,238,0.35), transparent 70%)',
            }}
          />

          <div className="relative mx-auto w-full max-w-6xl px-6 pb-24 pt-20 sm:px-8 lg:px-10 lg:pt-28">
            <div className="mx-auto max-w-3xl text-center">
              <span className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-3.5 py-1 text-xs font-medium text-slate-200 backdrop-blur-sm">
                <span className="inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.8)]" />
                {tt(COPY.hero.badge)}
              </span>

              <h1 className="mt-7 text-[2.4rem] font-bold leading-[1.05] tracking-[-0.035em] sm:text-6xl">
                {tt(COPY.hero.h1Top)}
                <span className="mt-2 block bg-gradient-to-r from-indigo-300 via-violet-300 to-cyan-300 bg-clip-text text-transparent">
                  {tt(COPY.hero.h1Bottom)}
                </span>
              </h1>

              <p className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg">
                {tt(COPY.hero.lead)}
              </p>

              <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
                <a
                  href="#start"
                  className="group inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 shadow-lg shadow-indigo-500/20 transition hover:bg-slate-100"
                >
                  <Terminal className="h-4 w-4" />
                  {tt(COPY.ctaInstall)}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                </a>
                <a
                  href="#console"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
                >
                  {tt(COPY.ctaPreview)}
                </a>
              </div>

              <div className="mt-7 flex flex-col items-center gap-2">
                <InstallPill />
                <p className="font-mono text-[11px] text-slate-400">{tt(COPY.hero.note)}</p>
              </div>

              <ul className="mt-10 grid gap-3 text-left sm:grid-cols-3">
                {COPY.hero.proof.map((p, i) => (
                  <li
                    key={i}
                    className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-[13px] leading-6 text-slate-200 backdrop-blur-sm"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                    <span>{tt(p)}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* hero screenshot */}
            <div className="relative mx-auto mt-16 max-w-5xl">
              <div
                aria-hidden
                className="absolute inset-x-10 -top-10 h-40 rounded-full bg-gradient-to-r from-indigo-500/30 via-violet-500/25 to-cyan-500/30 blur-3xl"
              />
              <div className="relative overflow-hidden rounded-2xl border border-white/15 bg-slate-900/60 p-1.5 shadow-[0_40px_120px_-20px_rgba(2,6,23,0.8)] ring-1 ring-white/5 backdrop-blur">
                <div className="flex items-center gap-1.5 border-b border-white/10 px-4 py-2.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <div className="ml-3 flex-1 truncate rounded-md bg-white/5 px-3 py-1 text-center font-mono text-[11px] text-slate-300">
                    127.0.0.1:4100/ui/
                  </div>
                </div>
                <img
                  src={lang === 'en' ? dashboardShotEn : dashboardShotZh}
                  alt="cc-gw dashboard screenshot"
                  className="block w-full rounded-b-xl"
                  loading="eager"
                />
              </div>
            </div>

            <div className="mt-16">
              <p className="text-center font-mono text-[11px] uppercase tracking-[0.22em] text-slate-400">
                {tt(COPY.hero.works)}
              </p>
              <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                {compatibilityBadges.map((b) => (
                  <span
                    key={b}
                    className="rounded-full border border-white/10 bg-white/5 px-3.5 py-1.5 text-sm text-slate-200 backdrop-blur-sm"
                  >
                    {b}
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ============= WHY ============= */}
        <section id="why" className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
          <SectionHead
            eyebrow={tt(COPY.why.eyebrow)}
            title={tt(COPY.why.title)}
            description={tt(COPY.why.description)}
          />
          <div className="mt-12 grid gap-5 md:grid-cols-3">
            {COPY.why.cards.map((p) => (
              <div
                key={p.title.en}
                className="group relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 transition hover:border-slate-300 hover:shadow-[0_20px_50px_-30px_rgba(15,23,42,0.25)]"
              >
                <div className="flex items-center gap-2">
                  <XCircle className="h-4 w-4 text-rose-500" />
                  <h3 className="text-base font-semibold text-slate-950">{tt(p.title)}</h3>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{tt(p.body)}</p>
                <pre className="mt-5 overflow-hidden rounded-lg bg-slate-50 p-3 font-mono text-[11.5px] leading-6 text-slate-500 ring-1 ring-slate-200">
                  {p.sample}
                </pre>
              </div>
            ))}
          </div>
        </section>

        {/* ============= HOW ============= */}
        <section id="how" className="border-y border-slate-200/80 bg-slate-50/60">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
            <SectionHead
              eyebrow={tt(COPY.how.eyebrow)}
              title={tt(COPY.how.title)}
              description={tt(COPY.how.description)}
            />

            {/* flow diagram */}
            <div className="mt-12 grid gap-6 lg:grid-cols-[1fr_auto_1fr_auto_1fr] lg:items-stretch">
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {tt(COPY.how.diagramLabels.clients)}
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  <li className="rounded-lg bg-slate-50 px-3 py-2">Claude Code</li>
                  <li className="rounded-lg bg-slate-50 px-3 py-2">OpenAI SDK</li>
                  <li className="rounded-lg bg-slate-50 px-3 py-2">Anthropic SDK</li>
                  <li className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">cURL · LangChain · …</li>
                </ul>
              </div>
              <div className="hidden flex-col items-center justify-center text-slate-300 lg:flex">
                <ArrowRight className="h-6 w-6" />
              </div>
              <div className="rounded-2xl border border-indigo-200 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-5 ring-1 ring-indigo-100">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-600">
                  {tt(COPY.how.diagramLabels.gateway)}
                </div>
                <div className="mt-3 rounded-xl bg-slate-950 px-4 py-3 font-mono text-[12px] text-slate-100">
                  127.0.0.1:4100
                </div>
                <ul className="mt-3 space-y-1.5 text-[13px] text-slate-700">
                  {COPY.how.flowSteps.map((s, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-1 inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-indigo-100 font-mono text-[10px] font-semibold text-indigo-700">
                        {i + 1}
                      </span>
                      <span>{tt(s)}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="hidden flex-col items-center justify-center text-slate-300 lg:flex">
                <ArrowRight className="h-6 w-6" />
              </div>
              <div className="rounded-2xl border border-slate-200 bg-white p-5">
                <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                  {tt(COPY.how.diagramLabels.providers)}
                </div>
                <ul className="mt-3 space-y-2 text-sm text-slate-700">
                  <li className="rounded-lg bg-slate-50 px-3 py-2">OpenAI</li>
                  <li className="rounded-lg bg-slate-50 px-3 py-2">Anthropic</li>
                  <li className="rounded-lg bg-slate-50 px-3 py-2">Azure / Bedrock</li>
                  <li className="rounded-lg bg-slate-50 px-3 py-2 text-slate-500">{tt(compatibleProviders)}</li>
                </ul>
              </div>
            </div>

            {/* differentiator */}
            <div className="mt-14 overflow-hidden rounded-3xl border border-slate-200 bg-white">
              <div className="grid gap-0 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
                <div className="border-b border-slate-200 p-8 lg:border-b-0 lg:border-r lg:p-10">
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.22em] text-indigo-600">
                    {tt(COPY.how.differentiator.eyebrow)}
                  </div>
                  <h3 className="mt-3 text-2xl font-semibold tracking-[-0.01em] text-slate-950">
                    {tt(COPY.how.differentiator.title)}
                  </h3>
                  <p className="mt-4 text-sm leading-7 text-slate-600">
                    {tt(COPY.how.differentiator.body)}
                  </p>
                </div>
                <div className="bg-slate-50/60 p-8 lg:p-10">
                  <div className="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                    {tt(COPY.how.differentiator.example)}
                  </div>
                  <ul className="mt-4 space-y-3">
                    {protocolExamples.map((ex) => (
                      <li
                        key={ex.client}
                        className="flex items-center gap-3 rounded-xl bg-white px-4 py-3 ring-1 ring-slate-200"
                      >
                        <span className="rounded-md bg-slate-100 px-2 py-1 font-mono text-xs text-slate-700">
                          {ex.client}
                        </span>
                        <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
                        <span className="rounded-md bg-gradient-to-r px-2 py-1 font-mono text-xs ring-1 ring-inset ring-slate-200 bg-slate-950 text-slate-100">
                          {tt(ex.upstream)}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ============= DEBUG ============= */}
        <section id="debug" className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
          <SectionHead
            eyebrow={tt(COPY.debug.eyebrow)}
            title={tt(COPY.debug.title)}
            description={tt(COPY.debug.description)}
          />

          <div className="mt-12 grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 md:grid-cols-3">
            {COPY.debug.pillars.map(({ icon: Icon, title, body }) => (
              <div key={title.en} className="bg-white p-7">
                <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-cyan-500/10 text-indigo-600 ring-1 ring-indigo-500/15">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="mt-5 text-base font-semibold text-slate-950">{tt(title)}</h3>
                <p className="mt-2 text-sm leading-7 text-slate-600">{tt(body)}</p>
              </div>
            ))}
          </div>

          {/* payload 4 stages */}
          <div className="mt-10 overflow-hidden rounded-2xl border border-slate-200 bg-gradient-to-br from-slate-50 to-white p-8">
            <h3 className="text-xl font-semibold text-slate-950">{tt(COPY.debug.payload.title)}</h3>
            <p className="mt-3 max-w-3xl text-sm leading-7 text-slate-600">{tt(COPY.debug.payload.body)}</p>
            <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {COPY.debug.payload.stages.map((stage, i) => {
                const isClient = i === 0 || i === 3
                return (
                  <div
                    key={i}
                    className={cn(
                      'rounded-xl border px-4 py-4',
                      isClient ? 'border-cyan-200 bg-cyan-50/60' : 'border-indigo-200 bg-indigo-50/60',
                    )}
                  >
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">
                      payload [{i + 1}/4]
                    </div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">{tt(stage)}</div>
                    <div className="mt-1 font-mono text-[11px] text-slate-500">
                      {isClient ? tt(COPY.debug.payload.clientSide) : tt(COPY.debug.payload.upstreamSide)}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ============= LOCAL ============= */}
        <section id="local" className="border-y border-slate-200/80 bg-slate-50/60">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
            <SectionHead
              eyebrow={tt(COPY.local.eyebrow)}
              title={tt(COPY.local.title)}
              description={tt(COPY.local.description)}
            />

            <div className="mt-12 grid gap-8 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:items-start">
              <div className="grid gap-px overflow-hidden rounded-2xl bg-slate-200 ring-1 ring-slate-200 sm:grid-cols-2">
                {COPY.local.pillars.map(({ icon: Icon, title, body }) => (
                  <div key={title.en} className="bg-white p-6">
                    <div className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500/10 to-cyan-500/10 text-indigo-600 ring-1 ring-indigo-500/15">
                      <Icon className="h-5 w-5" />
                    </div>
                    <h3 className="mt-4 text-base font-semibold text-slate-950">{tt(title)}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{tt(body)}</p>
                  </div>
                ))}
              </div>

              <div>
                <div className="overflow-hidden rounded-2xl border border-white/10 bg-slate-950 p-1.5 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.45)]">
                  <div className="flex items-center gap-1.5 px-3 py-2">
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                    <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                    <div className="ml-3 flex-1 truncate rounded-md bg-white/5 px-3 py-1 font-mono text-[11px] text-slate-300">
                      ~/.cc-gw
                    </div>
                  </div>
                  <pre className="overflow-x-auto px-5 pb-5 pt-2 font-mono text-[12.5px] leading-7 text-slate-100">
                    <code>
                      {directoryTree.split('\n').map((line, i) => (
                        <span key={i} className="block">
                          {line.includes('#') ? (
                            <>
                              <span>{line.slice(0, line.indexOf('#'))}</span>
                              <span className="text-slate-500">{line.slice(line.indexOf('#'))}</span>
                            </>
                          ) : (
                            line
                          )}
                        </span>
                      ))}
                    </code>
                  </pre>
                </div>
                <p className="mt-4 px-1 text-sm leading-7 text-slate-600">{tt(COPY.local.treeCaption)}</p>
              </div>
            </div>
          </div>
        </section>

        {/* ============= QUICK START ============= */}
        <section id="start" className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
          <SectionHead
            eyebrow={tt(COPY.start.eyebrow)}
            title={tt(COPY.start.title)}
            description={tt(COPY.start.description)}
          />

          <ol className="mt-12 grid gap-5 md:grid-cols-2">
            {COPY.start.steps.map((step, idx) => (
              <li
                key={step.title.en}
                className="flex flex-col rounded-2xl border border-slate-200 bg-white p-6"
              >
                <div className="flex items-center gap-3">
                  <span className="inline-flex h-8 min-w-[2rem] items-center justify-center rounded-lg bg-slate-950 px-2 font-mono text-xs font-semibold text-white">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <h3 className="text-base font-semibold text-slate-950">{tt(step.title)}</h3>
                </div>
                <p className="mt-3 text-sm leading-7 text-slate-600">{tt(step.body)}</p>
                <div className="mt-5">
                  <CodeBlock
                    label={`step ${idx + 1}: ${step.title.en}`}
                    code={step.code}
                    copyLabel={tt(codeUi.copy)}
                    copiedLabel={tt(codeUi.copied)}
                  />
                </div>
              </li>
            ))}
          </ol>
        </section>

        {/* ============= CONSOLE ============= */}
        <section id="console" className="border-y border-slate-200/80 bg-slate-50/60">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
            <SectionHead
              eyebrow={tt(COPY.console.eyebrow)}
              title={tt(COPY.console.title)}
              description={tt(COPY.console.description)}
            />

            <div className="mt-12 grid gap-8 lg:grid-cols-[280px_minmax(0,1fr)]">
              <div role="tablist" aria-orientation="vertical" className="flex flex-col gap-1.5">
                {consoleTabs.map((tab) => {
                  const active = tab.id === activeTab
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      id={`console-tab-${tab.id}`}
                      aria-selected={active}
                      aria-controls={`console-panel-${tab.id}`}
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        'rounded-xl border px-4 py-3 text-left transition',
                        active
                          ? 'border-indigo-500/30 bg-white shadow-[0_10px_30px_-18px_rgba(79,70,229,0.4)] ring-1 ring-indigo-500/10'
                          : 'border-transparent bg-transparent hover:bg-white/70',
                      )}
                    >
                      <div className={cn('text-sm font-semibold', active ? 'text-slate-950' : 'text-slate-700')}>
                        {tt(tab.label)}
                      </div>
                      <div className={cn('mt-1 text-xs leading-5', active ? 'text-slate-600' : 'text-slate-500')}>
                        {tt(tab.blurb)}
                      </div>
                    </button>
                  )
                })}
              </div>

              <div
                role="tabpanel"
                id={`console-panel-${activeConsole.id}`}
                aria-labelledby={`console-tab-${activeConsole.id}`}
                className="overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 p-1.5 shadow-[0_30px_80px_-30px_rgba(15,23,42,0.45)]"
              >
                <div className="flex items-center gap-1.5 px-3 py-2">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-400/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-amber-300/70" />
                  <span className="h-2.5 w-2.5 rounded-full bg-emerald-400/70" />
                  <div className="ml-3 flex-1 truncate rounded-md bg-white/5 px-3 py-1 font-mono text-[11px] text-slate-300">
                    127.0.0.1:4100/ui/{activeConsole.id}
                  </div>
                </div>
                <img
                  key={activeConsole.id + lang}
                  src={tt(activeConsole.shot)}
                  alt={`${tt(activeConsole.label)} screenshot`}
                  className="block w-full rounded-b-xl"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ============= FIT ============= */}
        <section id="fit" className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
          <SectionHead
            eyebrow={tt(COPY.fit.eyebrow)}
            title={tt(COPY.fit.title)}
            description={tt(COPY.fit.description)}
          />
          <div className="mt-12 grid gap-5 md:grid-cols-2">
            <div className="rounded-2xl border border-emerald-200/70 bg-gradient-to-br from-emerald-50 to-white p-7">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-slate-950">{tt(COPY.fit.yesTitle)}</h3>
              </div>
              <ul className="mt-5 space-y-3">
                {COPY.fit.yes.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-7 text-slate-700">
                    <CheckCircle2 className="mt-1 h-4 w-4 shrink-0 text-emerald-500" />
                    {tt(item)}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-2xl border border-slate-200 bg-white p-7">
              <div className="flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200/70 text-slate-500">
                  <XCircle className="h-4 w-4" />
                </div>
                <h3 className="text-base font-semibold text-slate-950">{tt(COPY.fit.noTitle)}</h3>
              </div>
              <ul className="mt-5 space-y-3">
                {COPY.fit.no.map((item, i) => (
                  <li key={i} className="flex items-start gap-3 text-sm leading-7 text-slate-600">
                    <XCircle className="mt-1 h-4 w-4 shrink-0 text-slate-400" />
                    {tt(item)}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ============= FAQ ============= */}
        <section id="faq" className="border-y border-slate-200/80 bg-slate-50/60">
          <div className="mx-auto w-full max-w-6xl px-6 py-20 sm:px-8 lg:px-10 lg:py-24">
            <SectionHead
              eyebrow={tt(COPY.faq.eyebrow)}
              title={tt(COPY.faq.title)}
              description={tt(COPY.faq.description)}
            />
            <div className="mx-auto mt-12 max-w-3xl divide-y divide-slate-200 rounded-2xl border border-slate-200 bg-white">
              {COPY.faq.items.map((item, i) => {
                const open = openFaq === i
                return (
                  <div key={i}>
                    <button
                      type="button"
                      onClick={() => setOpenFaq(open ? null : i)}
                      aria-expanded={open}
                      className="flex w-full items-center justify-between gap-6 px-6 py-5 text-left"
                    >
                      <span className="text-base font-semibold text-slate-900">{tt(item.q)}</span>
                      <ChevronDown
                        className={cn(
                          'h-5 w-5 shrink-0 text-slate-400 transition-transform',
                          open && 'rotate-180 text-slate-700',
                        )}
                      />
                    </button>
                    {open && <div className="px-6 pb-6 text-sm leading-7 text-slate-600">{tt(item.a)}</div>}
                  </div>
                )
              })}
            </div>
          </div>
        </section>

        {/* ============= CTA ============= */}
        <section className="px-6 py-24 sm:px-8 lg:px-10">
          <div className="relative mx-auto w-full max-w-6xl overflow-hidden rounded-3xl bg-slate-950 px-8 py-14 text-white shadow-[0_40px_100px_-40px_rgba(15,23,42,0.5)] sm:px-12 [&_::selection]:bg-indigo-400/40 [&_::selection]:text-white">
            <div
              aria-hidden
              className="absolute inset-0 opacity-25"
              style={{
                backgroundImage:
                  'linear-gradient(to right, rgba(148,163,184,0.16) 1px, transparent 1px), linear-gradient(to bottom, rgba(148,163,184,0.16) 1px, transparent 1px)',
                backgroundSize: '40px 40px',
                maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
                WebkitMaskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
              }}
            />
            <div
              aria-hidden
              className="pointer-events-none absolute -bottom-40 left-1/2 h-[460px] w-[900px] -translate-x-1/2 rounded-full opacity-50 blur-[100px]"
              style={{
                background:
                  'radial-gradient(closest-side, rgba(99,102,241,0.6), transparent 70%), radial-gradient(closest-side at 70% 60%, rgba(34,211,238,0.4), transparent 70%)',
              }}
            />
            <div className="relative grid gap-10 lg:grid-cols-[1.2fr_auto] lg:items-end">
              <div>
                <h2 className="text-3xl font-semibold tracking-[-0.02em] sm:text-4xl">{tt(COPY.cta.title)}</h2>
                <p className="mt-5 max-w-xl text-base leading-8 text-slate-300">{tt(COPY.cta.body)}</p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col lg:items-end">
                <a
                  href="https://www.npmjs.com/package/@chenpu17/cc-gw"
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  <Terminal className="h-4 w-4" />
                  {tt(COPY.ctaInstall)}
                </a>
                <a
                  href="/ui/"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  {tt(COPY.ctaConsole)}
                  <ArrowRight className="h-4 w-4" />
                </a>
              </div>
            </div>
          </div>
        </section>
      </main>

      {/* ============= FOOTER ============= */}
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-6 py-10 text-sm text-slate-500 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div className="flex items-center gap-3">
            <BrandMark className="h-7 w-7" title="cc-gw" />
            <div>
              <div className="text-slate-700">{tt(COPY.footer.tagline)}</div>
              <div className="font-mono text-[11px] text-slate-400">v{packageVersion}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-5">
            <a href="/ui/" className="hover:text-slate-900">{tt(COPY.footer.console)}</a>
            <a href="https://www.npmjs.com/package/@chenpu17/cc-gw" className="hover:text-slate-900">npm</a>
            <a href="https://github.com/chenpu17/cc-gw2" className="hover:text-slate-900">GitHub</a>
            <a href="https://github.com/chenpu17/cc-gw2/releases" className="hover:text-slate-900">{tt(COPY.footer.changelog)}</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
