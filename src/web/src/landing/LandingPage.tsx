import { useState, type ReactNode } from 'react'
import {
  ArrowRight,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Copy,
  GitBranch,
  KeyRound,
  Terminal,
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/utils/clipboard'
import { BrandMark } from '@/components/BrandMark'
import dashboardShot from '../../../../docs/assets/compare-pen/live-dashboard.png'
import logsShot from '../../../../docs/assets/compare-pen/live-logs.png'
import modelsShot from '../../../../docs/assets/compare-pen/live-model-management.png'
import apiKeysShot from '../../../../docs/assets/compare-pen/live-api-keys.png'
import eventsShot from '../../../../docs/assets/compare-pen/live-events.png'
import packageJson from '../../../../package.json' with { type: 'json' }

const packageVersion = (packageJson as { version?: string }).version ?? '0.0.0'

const navItems = [
  { href: '#architecture', label: '痛点' },
  { href: '#features', label: '收益' },
  { href: '#quickstart', label: '开始' },
  { href: '#console', label: '控制台' },
  { href: '#fit', label: '适合谁' },
  { href: '#faq', label: 'FAQ' },
]

const compatibilityBadges = ['OpenAI SDK', 'Anthropic SDK', 'Claude Code', 'cURL', 'LangChain', 'Vercel AI SDK']

const runtimeMetrics = [
  { value: '1 个', label: '团队统一入口' },
  { value: '少改', label: '业务代码少被打扰' },
  { value: '可查', label: '日志链路可追踪' },
  { value: '本地', label: '轻量自托管优先' },
]

const heroProofPoints = [
  '不用在每个项目里重复配置 baseURL 和 API Key',
  '出问题先看日志、链路和 Profiler，不再靠猜',
  '换 provider、模型和路由时，尽量不打扰业务代码',
]

const scenarioCards = [
  {
    title: '个人开发者',
    body: '你同时在用 Claude Code、OpenAI SDK 和几个脚本工具，已经不想再维护多套 Key 与地址。',
  },
  {
    title: 'AI 产品小队',
    body: '团队开始共享模型调用，想统一入口、路由和日志，但还不想先上复杂平台。',
  },
  {
    title: '1-100 人研发团队',
    body: '需要给多个环境、多个客户端和不同成员分配调用权限，同时保留轻量自托管的灵活性。',
  },
]

const featureCards = [
  {
    icon: GitBranch,
    title: '换模型，不再到处改配置',
    body: '客户端继续请求同一个入口，模型映射、Provider 切换和路由策略交给网关处理。',
  },
  {
    icon: BarChart3,
    title: '排查问题，不再只能靠猜',
    body: '请求日志、上游链路、TTFT/TPOT、Token usage 和事件记录都能在控制台看到。',
  },
  {
    icon: KeyRound,
    title: 'Key 管理，不再散落在脚本里',
    body: '为不同客户端、环境或成员创建独立 Key，方便审计、停用和隔离风险。',
  },
  {
    icon: CheckCircle2,
    title: '先本地跑，再给团队共享',
    body: 'npm 安装即可启动，个人先试，团队需要时再迁到共享机器或轻量自托管实例。',
  },
]

const firstDayJourney = [
  {
    icon: Terminal,
    eyebrow: '01',
    title: '先接一个你已经在用的客户端',
    body: '从 Claude Code、OpenAI SDK 或 Anthropic SDK 里挑一个，不需要先迁所有项目。',
    detail: '目标是让第一个真实请求先跑通，并进入控制台可观测范围。',
  },
  {
    icon: KeyRound,
    eyebrow: '02',
    title: '把密钥和访问范围收回来',
    body: '给不同成员、环境或工具分开 API Key，避免继续共享同一个万能 Key。',
    detail: '这样做之后，停用、排查和审计都会轻很多。',
  },
  {
    icon: GitBranch,
    eyebrow: '03',
    title: '开始通过路由和日志持续调优',
    body: '模型切换、Provider 替换和请求追踪都逐步从业务代码外迁到网关层。',
    detail: '一旦流量和协作变复杂，价值会明显放大。',
  },
]

const firstDayOutcomes = [
  '客户端开始只认一个统一入口，而不是多套 base URL',
  '调用问题能先在控制台定位，而不是在客户端里盲猜',
  '模型和 Provider 的演进不必每次都打扰业务代码',
]

const quickStartSteps = [
  {
    title: '先在本地跑起来',
    body: '不用先改团队流程，也不要求大家安装 Rust。先让一个统一入口可用。',
    code: 'npm install -g @chenpu17/cc-gw\ncc-gw start --foreground --port 4100',
  },
  {
    title: '接入一个现有客户端',
    body: '先选 Claude Code、OpenAI SDK 或 Anthropic SDK 中的一个，把 base URL 指到 cc-gw。',
    code: "baseURL = 'http://127.0.0.1:4100/openai/v1'\n# 或 http://127.0.0.1:4100/anthropic",
  },
  {
    title: '开始用控制台接管日常',
    body: '请求进来后，再慢慢管理路由、日志、API Keys、事件和 Profiler。',
    code: 'Product site: http://127.0.0.1:4100/\nConsole:      http://127.0.0.1:4100/ui/',
  },
]

const faqItems = [
  {
    question: '我只有一个人用，也需要 cc-gw 吗？',
    answer:
      '如果你只有一个脚本、一个 provider，可能暂时不需要。但只要你同时用 Claude Code、OpenAI SDK、Anthropic SDK，或者经常切模型和 Key，一个统一入口就会省很多维护成本。',
  },
  {
    question: '它会不会绑死某个模型供应商？',
    answer:
      '不会。cc-gw 的价值正是把 Provider 和客户端解耦。客户端面对 cc-gw，背后的 OpenAI / Anthropic 兼容 Provider、模型映射和路由规则都可以继续调整。',
  },
  {
    question: '它是企业级 AI 平台吗？',
    answer:
      '不是。它更适合个人开发者、AI 产品小队和 1-100 人研发团队，用轻量方式先解决入口、日志、路由、Key 管理和排查问题，而不是做大型治理平台。',
  },
]

const consoleTabs = [
  { id: 'dashboard', label: 'Dashboard', shot: dashboardShot },
  { id: 'logs', label: 'Logs', shot: logsShot },
  { id: 'models', label: 'Models & Routing', shot: modelsShot },
  { id: 'apikeys', label: 'API Keys', shot: apiKeysShot },
  { id: 'events', label: 'Events', shot: eventsShot },
]

function Section({
  id,
  eyebrow,
  title,
  description,
  children,
  className,
}: {
  id?: string
  eyebrow: string
  title: string
  description: string
  children: ReactNode
  className?: string
}) {
  return (
    <section id={id} className={cn('mx-auto w-full max-w-6xl px-6 py-14 sm:px-8 lg:px-10', className)}>
      <div className="max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-[0.16em] text-indigo-600">{eyebrow}</div>
        <h2 className="mt-3 text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h2>
        <p className="mt-4 text-base leading-8 text-slate-600 sm:text-lg">{description}</p>
      </div>
      <div className="mt-8">{children}</div>
    </section>
  )
}

function NavLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      className="rounded-full px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
    >
      {children}
    </a>
  )
}

function renderCodeLine(line: string): ReactNode {
  if (line.trimStart().startsWith('#')) {
    return <span className="text-slate-400">{line}</span>
  }
  const assignMatch = line.match(/^(\w+)(\s*=\s*)(.+)$/)
  if (assignMatch) {
    const key = assignMatch[1] ?? ''
    const op = assignMatch[2] ?? ''
    const val = assignMatch[3] ?? ''
    const isStr = val.startsWith("'") || val.startsWith('"')
    return (
      <>
        <span className="text-indigo-300">{key}</span>
        <span className="text-slate-100">{op}</span>
        <span className={isStr ? 'text-emerald-400' : 'text-slate-100'}>{val}</span>
      </>
    )
  }
  const kvMatch = line.match(/^([A-Za-z][A-Za-z\s]*:\s+)(.+)$/)
  if (kvMatch) {
    return (
      <>
        <span className="text-indigo-300">{kvMatch[1]}</span>
        <span className="text-emerald-400">{kvMatch[2]}</span>
      </>
    )
  }
  const parts = line.split(/(--[\w-]+)/g)
  if (parts.length > 1) {
    return (
      <>
        {parts.map((part, i) =>
          part.startsWith('--') ? (
            <span key={i} className="text-indigo-300">
              {part}
            </span>
          ) : (
            <span key={i} className="text-slate-100">
              {part}
            </span>
          ),
        )}
      </>
    )
  }
  return <span className="text-slate-100">{line}</span>
}

function CodeBlock({ code, label, className }: { code: string; label: string; className?: string }) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    await copyToClipboard(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className={cn('relative min-w-0', className)}>
      <button
        type="button"
        aria-label={`复制 ${label}`}
        onClick={handleCopy}
        className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-slate-100 transition hover:bg-white/15 sm:px-3 sm:py-1.5 sm:text-xs"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
        {copied ? '已复制' : '复制'}
      </button>
      <pre className="max-w-full overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 sm:p-5 sm:text-sm sm:leading-7">
        <code>
          {code.split('\n').map((line, i) => (
            <span key={i} className="block">
              {renderCodeLine(line)}
            </span>
          ))}
        </code>
      </pre>
    </div>
  )
}

function QuickInstallBar() {
  const [copied, setCopied] = useState(false)
  const cmd = 'npm install -g @chenpu17/cc-gw'

  async function handleCopy() {
    await copyToClipboard(cmd)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1800)
  }

  return (
    <div className="inline-flex items-center gap-3 rounded-2xl border border-slate-200 bg-slate-50 pl-4 pr-2 py-2">
      <span className="select-all font-mono text-sm text-slate-700">{cmd}</span>
      <span className="rounded-full bg-slate-100 px-2 py-1 text-xs font-medium text-slate-500">v{packageVersion}</span>
      <button
        type="button"
        aria-label="复制安装命令"
        onClick={handleCopy}
        className="inline-flex h-7 w-7 items-center justify-center rounded-xl bg-white text-slate-500 shadow-sm transition hover:bg-slate-100 hover:text-slate-700"
      >
        {copied ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  )
}

export default function LandingPage() {
  const [activeTab, setActiveTab] = useState('dashboard')
  const [openFaqIndex, setOpenFaqIndex] = useState<number | null>(null)

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top,#eef4ff_0%,#f8fbff_26%,#ffffff_62%)] text-slate-950">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b border-white/70 bg-white/88 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 py-4 sm:px-8 lg:px-10">
          <div className="flex items-center gap-3">
            <BrandMark className="h-11 w-11 shadow-[0_18px_40px_-24px_rgba(79,70,229,0.55)]" title="cc-gw" />
            <div>
              <div className="text-lg font-semibold tracking-tight">cc-gw</div>
              <div className="text-xs text-slate-500">AI gateway for builders</div>
            </div>
          </div>

          <nav className="hidden items-center gap-1 md:flex">
            {navItems.map((item) => (
              <NavLink key={item.href} href={item.href}>
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="flex items-center gap-3">
            <a
              href="/ui/"
              className="hidden rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:border-slate-400 hover:text-slate-950 sm:inline-flex"
            >
              打开控制台
            </a>
            <a
              href="https://github.com/chenpu17/cc-gw2"
              className="inline-flex items-center gap-2 rounded-full bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500"
            >
              GitHub
              <ArrowRight className="h-4 w-4" />
            </a>
          </div>
        </div>

        <nav
          aria-label="移动端页面导航"
          className="flex gap-2 overflow-x-auto border-t border-slate-200/70 px-4 py-2 md:hidden"
        >
          {[...navItems, { href: '/ui/', label: '打开控制台' }].map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="shrink-0 rounded-full bg-slate-100 px-3 py-1.5 text-sm font-medium text-slate-700"
            >
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main>
        {/* Hero Section */}
        <section className="mx-auto w-full max-w-6xl px-6 py-12 sm:px-8 lg:px-10 lg:py-14">
          <div className="overflow-hidden rounded-[2rem] border border-white/70 bg-white/78 px-6 py-8 shadow-[0_30px_80px_-44px_rgba(15,23,42,0.24)] ring-1 ring-slate-900/5 backdrop-blur xl:px-8 xl:py-9">
            <div className="grid gap-8 xl:grid-cols-[minmax(0,1.04fr)_minmax(420px,0.96fr)] xl:items-center">
              <div>
                <div className="inline-flex items-center rounded-full border border-indigo-100 bg-indigo-50/80 px-4 py-2 text-sm font-semibold text-indigo-700 shadow-sm">
                  Local-first · Open Source · Rust-powered
                </div>

                <h1 className="mt-5 max-w-4xl text-[2.25rem] font-bold tracking-[-0.04em] text-slate-950 sm:text-[2.75rem] xl:text-[3rem] xl:leading-[1.05]">
                  别再让 AI 配置
                  <span className="block bg-gradient-to-r from-indigo-700 via-violet-600 to-cyan-600 bg-clip-text text-transparent">
                    散落在每个项目里
                  </span>
                </h1>

                <p className="mt-5 max-w-2xl text-[1.02rem] leading-8 text-slate-600 xl:text-[1.08rem]">
                  cc-gw 帮你把 Claude Code、OpenAI SDK、Anthropic SDK 和内部工具统一到一个本地优先入口。Key、路由、日志和排查都回到控制台里管理。
                </p>

                <div className="mt-5 hidden gap-2.5 md:grid md:max-w-xl">
                  {heroProofPoints.map((item) => (
                    <div
                      key={item}
                      className="flex items-center gap-3 rounded-2xl border border-slate-200/70 bg-white/80 px-4 py-3 text-sm text-slate-700 shadow-[0_10px_30px_-24px_rgba(15,23,42,0.18)]"
                    >
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-7 flex flex-wrap items-center gap-3">
                  <a
                    href="https://www.npmjs.com/package/@chenpu17/cc-gw"
                    className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-indigo-600 to-violet-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_18px_36px_-20px_rgba(79,70,229,0.6)] transition hover:from-indigo-500 hover:to-violet-500"
                  >
                    <Terminal className="h-4 w-4" />
                    3 分钟开始接入
                  </a>
                  <a
                    href="/ui/"
                    className="inline-flex items-center justify-center rounded-2xl border border-slate-300 bg-white px-5 py-3 text-sm font-semibold text-slate-800 transition hover:border-slate-400"
                  >
                    先看控制台 →
                  </a>
                </div>

                <p className="mt-3 text-sm text-slate-500">
                  不用先改团队流程。先接一个客户端，看到价值后再慢慢迁移。
                </p>

                <div className="mt-5">
                  <QuickInstallBar />
                </div>

                <div className="mt-5">
                  <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Works with</div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {compatibilityBadges.map((badge) => (
                      <div
                        key={badge}
                        className="rounded-full border border-slate-200 bg-slate-50/88 px-3 py-1.5 text-sm text-slate-700"
                      >
                        {badge}
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="relative xl:pl-4">
                <div className="absolute inset-x-6 top-0 h-36 rounded-full bg-gradient-to-r from-indigo-200/60 via-violet-200/45 to-cyan-200/55 blur-3xl" />
                <div className="relative rounded-[2rem] border border-white/80 bg-gradient-to-b from-white to-slate-50 p-3 shadow-[0_32px_80px_-40px_rgba(15,23,42,0.34)] ring-1 ring-slate-900/5">
                  <div className="flex items-center gap-1.5 border-b border-slate-100 px-4 py-3">
                    <div className="h-3 w-3 rounded-full bg-slate-200" />
                    <div className="h-3 w-3 rounded-full bg-slate-200" />
                    <div className="h-3 w-3 rounded-full bg-slate-200" />
                    <div className="ml-3 flex-1 rounded-md bg-slate-100 px-3 py-1 text-xs text-slate-400">
                      http://127.0.0.1:4100/ui/
                    </div>
                  </div>
                  <img
                    src={dashboardShot}
                    alt="cc-gw dashboard screenshot"
                    className="max-h-[340px] w-full rounded-[1.25rem] object-cover object-top sm:max-h-[440px] xl:max-h-none"
                  />
                </div>

                <div className="mt-4 hidden gap-3 sm:grid sm:grid-cols-2">
                  <div className="rounded-2xl border border-white/80 bg-white/88 p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.28)]">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Live Ops</div>
                    <div className="mt-2 text-3xl font-bold tracking-tight text-slate-950">12</div>
                    <div className="mt-1 text-sm text-slate-600">Active Requests right now</div>
                  </div>
                  <div className="rounded-2xl border border-white/80 bg-gradient-to-br from-indigo-50 via-white to-cyan-50 p-4 shadow-[0_18px_40px_-30px_rgba(15,23,42,0.22)]">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Included</div>
                    <div className="mt-2 text-sm font-semibold text-slate-900">Logs · Routing · API Keys · Profiler</div>
                    <div className="mt-1 text-sm text-slate-600">不是单纯转发，而是可管理的团队入口。</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* Metrics Strip */}
        <div className="py-6">
          <div className="mx-auto grid max-w-6xl gap-4 px-6 sm:grid-cols-2 sm:px-8 xl:grid-cols-4 xl:px-10">
            {runtimeMetrics.map(({ value, label }) => (
              <div
                key={label}
                className="rounded-[1.4rem] border border-white/75 bg-white/82 px-6 py-5 shadow-[0_20px_50px_-36px_rgba(15,23,42,0.26)] ring-1 ring-slate-900/5"
              >
                <div className="text-3xl font-bold tracking-tight text-slate-950">{value}</div>
                <div className="mt-1 text-sm text-slate-500">{label}</div>
              </div>
            ))}
          </div>
        </div>

        <Section
          eyebrow="Day One"
          title="从用户视角看，cc-gw 的第一天应该是轻量、可见、可回退的"
          description="不是先重构整套 AI 平台，而是先让一个客户端进来、一个入口稳定下来、一次排查变得更简单。"
          className="pt-4"
        >
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)]">
            <div className="grid gap-4">
              {firstDayJourney.map(({ icon: Icon, eyebrow, title, body, detail }) => (
                <div
                  key={title}
                  className="grid gap-4 rounded-[1.6rem] border border-white/80 bg-white/88 p-5 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.22)] sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start"
                >
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-cyan-100 text-indigo-600">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-500">{eyebrow}</div>
                    <h3 className="mt-2 text-lg font-semibold text-slate-950">{title}</h3>
                    <p className="mt-2 text-sm leading-7 text-slate-600">{body}</p>
                    <div className="mt-3 rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-500 ring-1 ring-slate-200/70">
                      {detail}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="rounded-[1.8rem] border border-slate-900/10 bg-slate-950 px-6 py-6 text-white shadow-[0_24px_64px_-38px_rgba(15,23,42,0.5)]">
              <div className="inline-flex items-center rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-indigo-200">
                What You Get
              </div>
              <h3 className="mt-4 text-2xl font-semibold tracking-tight">不是更重的治理系统，而是更顺手的 AI 工作台</h3>
              <p className="mt-3 text-sm leading-7 text-slate-300">
                对个人开发者和小团队来说，价值不是“功能全”，而是接入当天就能少踩坑、少改配置、少猜问题。
              </p>

              <div className="mt-5 space-y-3">
                {firstDayOutcomes.map((item) => (
                  <div
                    key={item}
                    className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />
                    <span className="text-sm leading-6 text-slate-200">{item}</span>
                  </div>
                ))}
              </div>

              <div className="mt-6 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
                {[
                  { value: '3-10 分钟', label: '通常能完成第一次接入' },
                  { value: '1 个入口', label: '客户端开始收口到同一地址' },
                  { value: '先本地', label: '看到价值后再考虑共享部署' },
                ].map((item) => (
                  <div key={item.label} className="rounded-2xl bg-white/6 px-4 py-3 ring-1 ring-white/10">
                    <div className="text-lg font-semibold text-white">{item.value}</div>
                    <div className="mt-1 text-xs text-slate-300">{item.label}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Architecture Section */}
        <Section
          id="architecture"
          eyebrow="Why"
          title="AI 接入一多，最先乱的不是模型，而是日常维护"
          description="用户真正遇到的问题，通常不是“能不能调通”，而是调通之后配置散落、Key 难管、日志难查、模型切换牵一发动全身。"
        >
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-[1.6rem] border border-rose-100 bg-white/88 p-6 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.22)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-rose-50 text-rose-500">
                  <XCircle className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-rose-500">Before</p>
                  <h3 className="text-lg font-semibold text-slate-950">没有统一入口时</h3>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                {[
                  {
                    title: '配置到处复制',
                    body: '每个项目、脚本、客户端都有自己的 base URL、Key 和模型名，时间一久没人敢动。',
                  },
                  {
                    title: '报错难以定位',
                    body: '到底是客户端 payload、协议转换、上游模型，还是 Key 权限问题？没有统一日志就只能猜。',
                  },
                  {
                    title: '切换成本太高',
                    body: '想换 Provider、改默认模型或拆环境，经常要动业务代码、环境变量和多人本地配置。',
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-rose-100/80 bg-rose-50/50 px-4 py-4">
                    <h4 className="text-sm font-semibold text-slate-950">{item.title}</h4>
                    <p className="mt-1.5 text-sm leading-7 text-slate-600">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-[1.6rem] border border-emerald-100 bg-white/88 p-6 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.22)]">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-50 text-emerald-500">
                  <CheckCircle2 className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-500">After</p>
                  <h3 className="text-lg font-semibold text-slate-950">有了 cc-gw 之后</h3>
                </div>
              </div>
              <div className="mt-5 space-y-4">
                {[
                  {
                    title: '客户端只认一个入口',
                    body: 'Claude Code、OpenAI SDK、Anthropic SDK 和内部工具都先接到 cc-gw，配置明显收敛。',
                  },
                  {
                    title: '日志和链路有地方看',
                    body: '请求是否进来、打到了哪里、哪里慢、哪里错，都可以先从控制台开始排查。',
                  },
                  {
                    title: '路由演进不打扰业务',
                    body: '改默认模型、切 Provider、拆 endpoint 或按客户端分 Key，都尽量留在网关层完成。',
                  },
                ].map((item) => (
                  <div key={item.title} className="rounded-2xl border border-emerald-100/80 bg-emerald-50/50 px-4 py-4">
                    <h4 className="text-sm font-semibold text-slate-950">{item.title}</h4>
                    <p className="mt-1.5 text-sm leading-7 text-slate-600">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </Section>

        {/* Features Section */}
        <Section
          id="features"
          eyebrow="Benefits"
          title="它先解决的是接入后的维护成本，不是再发明一套平台流程"
          description="当你已经开始同时接多个模型、多个客户端和多个环境时，cc-gw 的价值体现在收口入口、保留观测性，并把变更尽量留在网关层。"
        >
          <div className="grid gap-4 md:grid-cols-2">
            {featureCards.map(({ icon: Icon, title, body }) => (
              <div
                key={title}
                className="rounded-[1.5rem] border border-white/80 bg-white/88 p-6 shadow-[0_18px_44px_-34px_rgba(15,23,42,0.26)] transition-shadow hover:shadow-[0_24px_54px_-34px_rgba(15,23,42,0.3)]"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-100 to-cyan-100 text-indigo-600">
                  <Icon className="h-5 w-5" />
                </div>
                <div className="mt-4 text-lg font-semibold text-slate-950">{title}</div>
                <p className="mt-2 text-sm leading-7 text-slate-600">{body}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Quick Start Section */}
        <Section
          id="quickstart"
          eyebrow="Quick Start"
          title="先接一个客户端，马上看到价值"
          description="不用一次性迁完整个团队。先从一个常用客户端开始，把请求、日志和路由接进控制台。"
          className="pt-2"
        >
          <div className="space-y-4">
            {quickStartSteps.map((step, index) => (
              <div
                key={step.title}
                className="grid gap-5 rounded-[1.6rem] border border-white/80 bg-white/88 p-5 shadow-[0_18px_48px_-36px_rgba(15,23,42,0.26)] lg:grid-cols-[80px_minmax(0,0.8fr)_minmax(0,1.1fr)] lg:items-start"
              >
                <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-100 to-violet-100 text-lg font-semibold text-indigo-700">
                  0{index + 1}
                </div>
                <div>
                  <div className="text-lg font-semibold text-slate-950">{step.title}</div>
                  <p className="mt-3 text-sm leading-7 text-slate-600">{step.body}</p>
                </div>
                <CodeBlock label={`${step.title}代码`} code={step.code} />
              </div>
            ))}
          </div>
        </Section>

        {/* Console Showcase Section */}
        <Section
          id="console"
          eyebrow="Console"
          title="控制台不是摆设，是你每天排查和切换的地方"
          description="请求进来之后，你能看到趋势、过滤日志、调整路由、管理 API Keys，并用 Profiler 追踪慢请求和异常。"
        >
          <div className="overflow-hidden rounded-[1.7rem] border border-white/80 bg-white/88 shadow-[0_22px_56px_-38px_rgba(15,23,42,0.28)] ring-1 ring-slate-900/5">
            <div className="flex flex-wrap gap-1 border-b border-slate-100 px-4 pt-4">
              {consoleTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={cn(
                    'rounded-t-lg px-4 py-2 text-sm font-medium transition-colors',
                    activeTab === tab.id
                      ? 'border-b-2 border-indigo-600 bg-indigo-50 text-indigo-700'
                      : 'text-slate-500 hover:text-slate-900',
                  )}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            <div className="p-4">
              <img
                src={consoleTabs.find((t) => t.id === activeTab)?.shot ?? dashboardShot}
                alt={activeTab}
                className="w-full rounded-xl border border-slate-100"
              />
            </div>
            <div className="grid gap-3 px-4 pb-4 md:grid-cols-3">
              {[
                '先看请求有没有进来，再看它去了哪个上游、用了多少 Token、哪里慢。',
                '业务代码只面对一个入口，协议兼容和模型路由留给网关慢慢演进。',
                '更像小团队自己的 AI 调用工作台，而不是只会转发请求的代理。',
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-xl border border-slate-100 bg-gradient-to-br from-slate-50 to-white px-4 py-3 text-sm leading-6 text-slate-600"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>
        </Section>

        {/* Fit Section */}
        <Section
          id="fit"
          eyebrow="Fit"
          title="什么时候它会明显省事，什么时候你其实还不需要它"
          description="如果你的 AI 接入已经开始扩张，但又没到要上组织级治理平台的程度，cc-gw 往往正好卡在那个合适的区间。"
        >
          <div className="mb-5 grid gap-4 lg:grid-cols-3">
            {scenarioCards.map((item) => (
              <div
                key={item.title}
                className="rounded-[1.45rem] border border-white/80 bg-white/88 p-5 shadow-[0_18px_40px_-34px_rgba(15,23,42,0.18)]"
              >
                <p className="text-sm font-semibold text-slate-950">{item.title}</p>
                <p className="mt-2 text-sm leading-7 text-slate-600">{item.body}</p>
              </div>
            ))}
          </div>
          <div className="grid gap-5 lg:grid-cols-2">
            <div className="rounded-[1.6rem] border border-emerald-100 bg-emerald-50/72 p-7 shadow-[0_18px_46px_-34px_rgba(16,185,129,0.22)]">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">适合谁</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  '个人开发者、AI 产品小队',
                  '1-100 人的软件研发团队',
                  '正在用多个 AI provider 的团队',
                  '觉得 key、baseURL 和模型配置越来越乱',
                  '想要先收口再慢慢治理的团队',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div className="rounded-[1.6rem] border border-slate-200 bg-white/78 p-7 shadow-[0_18px_46px_-34px_rgba(15,23,42,0.16)]">
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-200">
                  <XCircle className="h-4 w-4 text-slate-500" />
                </div>
                <h3 className="text-base font-semibold text-slate-900">不适合谁</h3>
              </div>
              <ul className="space-y-2.5">
                {[
                  '需要跨 BU 统一治理的大企业',
                  '需要复杂审批流程和审计流转',
                  '企业 SSO 与组织级策略中台',
                  '需要 HA/高可用集群部署',
                  'Compliance-first 的金融/医疗场景',
                ].map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-slate-700">
                    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Section>

        {/* FAQ Section */}
        <Section
          id="faq"
          eyebrow="FAQ"
          title="常见问题"
          description="从是否值得试、是否会绑死、是否过重这几个用户关心的问题开始。"
          className="pb-24"
        >
          <div className="grid gap-4">
            {faqItems.map((item, i) => (
              <div
                key={item.question}
                className="overflow-hidden rounded-[1.35rem] border border-white/80 bg-white/88 shadow-[0_16px_40px_-34px_rgba(15,23,42,0.2)]"
              >
                <button
                  type="button"
                  onClick={() => setOpenFaqIndex(openFaqIndex === i ? null : i)}
                  className="flex w-full items-center justify-between px-6 py-5 text-left"
                >
                  <span className="text-base font-semibold text-slate-900">{item.question}</span>
                  <ChevronDown
                    className={cn('h-5 w-5 text-slate-400 transition-transform', openFaqIndex === i && 'rotate-180')}
                  />
                </button>
                {openFaqIndex === i && (
                  <div className="px-6 pb-5 text-sm leading-7 text-slate-600">{item.answer}</div>
                )}
              </div>
            ))}
          </div>

          {/* CTA Footer Block */}
          <div
            className="relative mt-8 overflow-hidden rounded-[1.8rem] border border-slate-800/20 bg-slate-950 px-8 py-10 text-white shadow-[0_28px_80px_-44px_rgba(15,23,42,0.5)]"
            style={{
              backgroundImage:
                'radial-gradient(circle at top left, rgba(129,140,248,0.2), transparent 32%), radial-gradient(circle at bottom right, rgba(34,211,238,0.12), transparent 28%), radial-gradient(rgba(255,255,255,0.07) 1px, transparent 1px)',
              backgroundSize: 'auto, auto, 24px 24px',
            }}
          >
            <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
              <div>
                <div className="text-3xl font-semibold tracking-tight">先把 AI 调用管顺，再慢慢扩展团队协作。</div>
                <p className="mt-4 max-w-3xl text-base leading-8 text-slate-300">
                  不需要一开始就建设企业级平台。先用 cc-gw 把入口、路由、日志和 Key 管理收回来，今天就能开始。
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row lg:flex-col">
                <a
                  href="https://www.npmjs.com/package/@chenpu17/cc-gw"
                  className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-semibold text-slate-950 transition hover:bg-slate-100"
                >
                  npm 安装
                </a>
                <a
                  href="/ui/"
                  className="inline-flex items-center justify-center rounded-2xl border border-white/20 bg-white/5 px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
                >
                  打开控制台
                </a>
              </div>
            </div>
          </div>
        </Section>
      </main>

      {/* Footer */}
      <footer className="border-t border-white/80 bg-white/70">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-6 py-8 text-sm text-slate-500 sm:px-8 lg:flex-row lg:items-center lg:justify-between lg:px-10">
          <div>
            <div>cc-gw · Local-first AI gateway for personal developers and small software teams.</div>
            <div className="mt-1 text-xs">v{packageVersion}</div>
          </div>
          <div className="flex flex-wrap gap-4">
            <a href="/ui/" className="hover:text-slate-900">
              控制台
            </a>
            <a href="https://www.npmjs.com/package/@chenpu17/cc-gw" className="hover:text-slate-900">
              npm
            </a>
            <a href="https://github.com/chenpu17/cc-gw2" className="hover:text-slate-900">
              GitHub
            </a>
            <a href="https://github.com/chenpu17/cc-gw2/releases" className="hover:text-slate-900">
              Changelog
            </a>
          </div>
        </div>
      </footer>
    </div>
  )
}
