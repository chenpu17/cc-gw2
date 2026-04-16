import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { BookOpen, Info, Terminal, Code } from 'lucide-react'
import { PageHeader } from '@/components/PageHeader'
import { PageSection } from '@/components/PageSection'
import { copyToClipboard } from '@/utils/clipboard'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

interface HelpSection {
  title: string
  items: string[]
}

const quickPathCardClasses =
  'group rounded-[1rem] border border-white/70 bg-card/95 p-3.5 shadow-[0_18px_42px_-38px_rgba(15,23,42,0.24)] transition hover:-translate-y-0.5 hover:shadow-[0_22px_48px_-40px_rgba(59,130,246,0.18)]'

export default function HelpPage(): JSX.Element {
  const { t } = useTranslation()

  const sections = useMemo<HelpSection[]>(() => {
    const configSteps = t('help.sections.configuration.items', { returnObjects: true }) as string[]
    const claudeCodeSteps = t('help.sections.claudeCodeConfig.items', { returnObjects: true }) as string[]
    const codexSteps = t('help.sections.codexConfig.items', { returnObjects: true }) as string[]
    const usageSteps = t('help.sections.usage.items', { returnObjects: true }) as string[]
    const tips = t('help.sections.tips.items', { returnObjects: true }) as string[]
    return [
      {
        title: t('help.sections.configuration.title'),
        items: configSteps
      },
      {
        title: t('help.sections.claudeCodeConfig.title'),
        items: claudeCodeSteps
      },
      {
        title: t('help.sections.codexConfig.title'),
        items: codexSteps
      },
      {
        title: t('help.sections.usage.title'),
        items: usageSteps
      },
      {
        title: t('help.sections.tips.title'),
        items: tips
      }
    ]
  }, [t])

  const faqItems = t('help.faq.items', { returnObjects: true }) as Array<{ q: string; a: string }>
  const starterFlow = sections[0].items.slice(0, 3)
  const quickPaths = useMemo(
    () => [
      {
        id: 'configuration',
        title: sections[0].title,
        subtitle: summarizeHelpItem(sections[0].items[0] ?? '')
      },
      {
        id: 'claude',
        title: sections[1].title,
        subtitle: summarizeHelpItem(sections[1].items[0] ?? '')
      },
      {
        id: 'codex',
        title: sections[2].title,
        subtitle: summarizeHelpItem(sections[2].items[0] ?? '')
      },
      {
        id: 'faq',
        title: t('help.faq.title'),
        subtitle: t('help.meta.faqCount', { count: faqItems.length })
      }
    ],
    [faqItems.length, sections, t]
  )

  return (
    <div className="space-y-5">
      <PageHeader
        icon={<BookOpen className="h-5 w-5" aria-hidden="true" />}
        title={t('help.title')}
        description={t('help.intro')}
        breadcrumb={t('help.meta.breadcrumb')}
        helper={t('help.helper')}
        badge={t('help.meta.guides', { count: sections.length })}
      />

      <Card className="rounded-[1.2rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)] xl:hidden">
        <CardContent className="space-y-3 p-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.95rem] bg-accent text-primary">
              <Info className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-semibold text-foreground">{t('help.note')}</p>
              <p className="text-xs leading-5 text-muted-foreground">{t('help.helper')}</p>
            </div>
          </div>

          <div className="rounded-[0.95rem] bg-secondary/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/78">{t('help.meta.recommendedFlow')}</p>
            <div className="-mx-1 mt-2 flex gap-2 overflow-x-auto px-1 pb-1">
              {quickPaths.map((path) => (
                <a
                  key={path.id}
                  href={`#help-${path.id}`}
                  className="w-[190px] shrink-0 rounded-[0.95rem] border border-white/65 bg-background/82 px-3 py-2.5 shadow-[0_10px_24px_-20px_rgba(15,23,42,0.18)]"
                >
                  <p className="text-[13px] font-semibold text-foreground">{path.title}</p>
                  <p className="mt-1 line-clamp-2 text-[11px] leading-4.5 text-muted-foreground">{path.subtitle}</p>
                </a>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {starterFlow.map((item, index) => (
                <span
                  key={`${index}-${item}`}
                  className="inline-flex items-center rounded-full bg-background/78 px-2.5 py-1 text-[11px] text-muted-foreground"
                >
                  <span className="mr-1.5 inline-flex h-4.5 w-4.5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="line-clamp-1">{summarizeHelpItem(item)}</span>
                </span>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)] xl:items-start">
        <aside className="hidden space-y-4 xl:sticky xl:top-24 xl:block">
          <Card className="rounded-[1.25rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)]">
            <CardContent className="space-y-3 p-4">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[1rem] bg-accent text-primary">
                  <Info className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="space-y-1.5">
                  <p className="text-sm font-semibold text-foreground">{t('help.note')}</p>
                  <p className="text-xs leading-5 text-muted-foreground">{t('help.helper')}</p>
                </div>
              </div>
              <div className="rounded-[1rem] bg-secondary/55 p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]">
                <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary/78">{t('help.meta.recommendedFlow')}</p>
                <ol className="mt-2.5 space-y-2">
                  {starterFlow.map((item, index) => (
                    <li key={`${index}-${item}`} className="flex gap-2.5 text-xs leading-5 text-muted-foreground">
                      <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary text-[10px] font-semibold text-primary-foreground">
                        {index + 1}
                      </span>
                      <span>{summarizeHelpItem(item)}</span>
                    </li>
                  ))}
                </ol>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            {quickPaths.map((path) => (
              <a
                key={path.id}
                href={`#help-${path.id}`}
                className={quickPathCardClasses}
              >
                <p className="text-sm font-semibold">{path.title}</p>
                <p className="mt-1.5 line-clamp-2 text-xs leading-5 text-muted-foreground">{path.subtitle}</p>
              </a>
            ))}
          </div>
        </aside>

        <div className="space-y-6">
          <div id="help-configuration">
            <PageSection title={<SectionHeading eyebrow="01" title={sections[0].title} />} description={t('help.clientConfig.subtitle')}>
              <StepList items={sections[0].items} compact />
            </PageSection>
          </div>

          <div className="space-y-1 text-center">
            <h2 className="text-xl font-semibold">{t('help.clientConfig.title')}</h2>
            <p className="text-sm text-muted-foreground">{t('help.clientConfig.subtitle')}</p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div id="help-claude">
              <PageSection title={<SectionHeading eyebrow="02" title={sections[1].title} />} className="rounded-[1.35rem]">
                <WorkflowBanner
                  icon={<Code className="h-4 w-4" />}
                  iconClassName="bg-primary text-primary-foreground"
                  title="Claude Code"
                  subtitle={t('help.meta.claudeWorkflow')}
                />
                <StepList items={sections[1].items} />
              </PageSection>
            </div>

            <div id="help-codex">
              <PageSection title={<SectionHeading eyebrow="03" title={sections[2].title} />} className="rounded-[1.35rem]">
                <WorkflowBanner
                  icon={<Terminal className="h-4 w-4" />}
                  iconClassName="bg-emerald-600 text-white"
                  title="Codex CLI"
                  subtitle={t('help.meta.codexWorkflow')}
                />
                <StepList items={sections[2].items} />
              </PageSection>
            </div>
          </div>

          <div className="mt-8">
            <div className="mb-6 space-y-1 text-center">
              <h2 className="text-lg font-semibold">{t('help.advancedGuide.title')}</h2>
              <p className="text-sm text-muted-foreground">{t('help.advancedGuide.subtitle')}</p>
            </div>
            <div className="grid gap-6 lg:grid-cols-2">
              <PageSection title={<SectionHeading eyebrow="04" title={sections[3].title} />}>
                <StepList items={sections[3].items} />
              </PageSection>
              <PageSection title={<SectionHeading eyebrow="05" title={sections[4].title} />}>
                <StepList items={sections[4].items} />
              </PageSection>
            </div>
          </div>

          <div id="help-faq">
            <PageSection title={<SectionHeading eyebrow="FAQ" title={t('help.faq.title')} />}>
              <FaqList items={faqItems} />
            </PageSection>
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground/80">
        {eyebrow}
      </p>
      <h2 className="text-base font-semibold text-foreground">{title}</h2>
    </div>
  )
}

function WorkflowBanner({
  icon,
  iconClassName,
  title,
  subtitle
}: {
  icon: JSX.Element
  iconClassName: string
  title: string
  subtitle: string
}) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-[1rem] bg-secondary/78 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)] dark:bg-slate-900/[0.56] dark:shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
      <div className={cn('flex h-10 w-10 items-center justify-center rounded-[0.95rem]', iconClassName)}>
        {icon}
      </div>
      <div>
        <span className="text-sm font-medium">{title}</span>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
    </div>
  )
}

function StepList({ items, compact = false }: { items: string[]; compact?: boolean }) {
  return (
    <ol className={cn('flex flex-col', compact ? 'gap-2' : 'gap-2.5')}>
      {items.map((item, index) => (
        <li
          key={`${index}-${item}`}
          className={cn(
            'flex gap-3 rounded-[1.05rem] border border-border/50 bg-card/92 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.24)] dark:border-white/10 dark:bg-slate-950/[0.38] dark:shadow-[0_16px_36px_-30px_rgba(0,0,0,0.32)]',
            compact ? 'p-3' : 'p-3.5'
          )}
        >
          <span className={cn(
            'flex shrink-0 items-center justify-center rounded-[0.95rem] bg-primary text-xs font-semibold text-primary-foreground shadow-[0_10px_22px_-14px_hsl(var(--primary)/0.7)]',
            compact ? 'h-7 w-7 text-[11px]' : 'h-8 w-8'
          )}>
            {index + 1}
          </span>
          <div className="min-w-0 flex-1 text-sm text-muted-foreground">
            <StepContent content={item} />
          </div>
        </li>
      ))}
    </ol>
  )
}

function StepContent({ content }: { content: string }) {
  const { t } = useTranslation()
  const parts = content.split('```')

  return (
    <div className="space-y-3">
      {parts.map((part, index) => {
        if (!part.trim()) return null

        if (index % 2 === 1) {
          const [language, ...codeLines] = part.split('\n')
          const code = codeLines.join('\n').trim()
          return (
            <div key={index} className="overflow-hidden rounded-[0.95rem] border border-border/55 bg-secondary/60 dark:border-white/10 dark:bg-slate-900/[0.52]">
              <div className="flex items-center justify-between border-b border-border/55 px-3 py-2 dark:border-white/10">
                <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {language || 'bash'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => copyToClipboard(code)}
                >
                  {t('common.actions.copy')}
                </Button>
              </div>
              <pre className="overflow-x-auto px-3 py-3 font-mono text-[12px] leading-6 text-foreground">
                <code className="block min-w-full whitespace-pre">{code}</code>
              </pre>
            </div>
          )
        }

        return <TextBlock key={index} content={part} />
      })}
    </div>
  )
}

function TextBlock({ content }: { content: string }) {
  const lines = content
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line) => line.trim().length > 0)

  if (lines.length === 0) return null

  const unorderedLines = lines.filter((line) => /^[-•*]\s+/.test(line.trim()))
  const orderedLines = lines.filter((line) => /^\d+[).]\s+/.test(line.trim()))
  const leading = lines.filter((line) => !/^([-•*]|\d+[).])\s+/.test(line.trim()))
  const bullets = unorderedLines.map((line) => line.replace(/^[-•*]\s+/, ''))
  const ordered = orderedLines.map((line) => {
    const match = line.trim().match(/^(\d+)[).]\s+(.*)$/)
    return {
      index: match?.[1] ?? '',
      text: match?.[2] ?? line.trim()
    }
  })

  return (
    <div className="space-y-2.5">
      {leading.length > 0 ? (
        <div className="space-y-2">
          {leading.map((line, index) => (
            <p key={`${line}-${index}`} className="leading-6">
              {renderInlineRichText(line)}
            </p>
          ))}
        </div>
      ) : null}
      {bullets.length > 0 ? (
        <ul className="space-y-1.5 rounded-[0.95rem] bg-secondary/38 px-3 py-2.5 dark:bg-slate-900/[0.34]">
          {bullets.map((line, index) => (
            <li key={`${line}-${index}`} className="flex gap-2 text-sm leading-6">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{renderInlineRichText(line)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {ordered.length > 0 ? (
        <ol className="space-y-2 rounded-[0.95rem] bg-secondary/38 px-3 py-2.5 dark:bg-slate-900/[0.34]">
          {ordered.map((item) => (
            <li key={`${item.index}-${item.text}`} className="flex gap-2.5 text-sm leading-6">
              <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/12 px-1.5 text-[11px] font-semibold text-primary">
                {item.index}
              </span>
              <span>{renderInlineRichText(item.text)}</span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  )
}

function renderInlineRichText(text: string) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)

  return parts.map((part, index) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code
          key={index}
          className="rounded-md bg-secondary/72 px-1.5 py-0.5 text-[0.95em] text-foreground dark:bg-slate-900/[0.58]"
        >
          {part.slice(1, -1)}
        </code>
      )
    }
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={index} className="font-medium text-foreground">{part.slice(2, -2)}</strong>
    }
    return <span key={index}>{part}</span>
  })
}

function FaqList({ items }: { items: Array<{ q: string; a: string }> }) {
  if (items.length === 0) {
    return null
  }
  return (
    <dl className="space-y-2">
      {items.map((item, index) => (
        <details
          key={item.q}
          className="group overflow-hidden rounded-[1rem] border border-border/50 bg-card/92 shadow-[0_16px_36px_-30px_rgba(15,23,42,0.24)]"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-foreground">
            <span>{item.q}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground transition group-open:bg-primary/10 group-open:text-primary">
              {index + 1}
            </span>
          </summary>
          <div className="border-t border-border/50 px-4 py-3">
            <dd className="text-sm text-muted-foreground">
              <FaqAnswer content={item.a} />
            </dd>
          </div>
        </details>
      ))}
    </dl>
  )
}

function FaqAnswer({ content }: { content: string }) {
  return <StepContent content={content} />
}

function summarizeHelpItem(content: string) {
  return content
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/^[-•*]\s+/gm, '')
    .replace(/^\d+[).]\s+/gm, '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)[0]
    ?.replace(/\s+/g, ' ') ?? ''
}
