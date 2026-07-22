import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { PageToolbar } from '@/components/PageToolbar'
import { PageSection } from '@/components/PageSection'
import { copyToClipboard } from '@/utils/clipboard'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'

interface HelpSection {
  id: string
  title: string
  items: string[]
}

export default function HelpPage(): JSX.Element {
  const { t } = useTranslation()

  const sections = useMemo<HelpSection[]>(() => {
    return [
      {
        id: 'tour',
        title: t('help.sections.consoleTour.title'),
        items: t('help.sections.consoleTour.items', { returnObjects: true }) as string[]
      },
      {
        id: 'configuration',
        title: t('help.sections.configuration.title'),
        items: t('help.sections.configuration.items', { returnObjects: true }) as string[]
      },
      {
        id: 'claude',
        title: t('help.sections.claudeCodeConfig.title'),
        items: t('help.sections.claudeCodeConfig.items', { returnObjects: true }) as string[]
      },
      {
        id: 'codex',
        title: t('help.sections.codexConfig.title'),
        items: t('help.sections.codexConfig.items', { returnObjects: true }) as string[]
      },
      {
        id: 'usage',
        title: t('help.sections.usage.title'),
        items: t('help.sections.usage.items', { returnObjects: true }) as string[]
      },
      {
        id: 'tips',
        title: t('help.sections.tips.title'),
        items: t('help.sections.tips.items', { returnObjects: true }) as string[]
      }
    ]
  }, [t])

  const faqItems = t('help.faq.items', { returnObjects: true }) as Array<{ q: string; a: string }>

  const tocEntries = useMemo(
    () => [
      ...sections.map((section) => ({ id: section.id, title: section.title })),
      { id: 'faq', title: t('help.faq.title') }
    ],
    [sections, t]
  )

  return (
    <div className="space-y-4">
      <PageToolbar
        info={
          <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-muted-foreground">
            {t('help.meta.guides', { count: sections.length })}
          </span>
        }
      />

      <div className="rounded-lg border border-border/60 bg-card px-4 py-3 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">{t('help.note')}</p>
        <p className="mt-1 text-xs leading-5">{t('help.helper')}</p>
      </div>

      <div className="grid gap-5 xl:grid-cols-[208px_minmax(0,1fr)] xl:items-start">
        <aside className="hidden xl:sticky xl:top-4 xl:block">
          <nav aria-label={t('help.meta.tocTitle')} className="rounded-lg border border-border/60 bg-card p-3">
            <p className="mb-2 px-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {t('help.meta.tocTitle')}
            </p>
            <ol className="space-y-0.5 text-sm">
              {tocEntries.map((entry) => (
                <li key={entry.id}>
                  <a
                    href={`#help-${entry.id}`}
                    className="block truncate rounded-md px-2 py-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
                  >
                    {entry.title}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="min-w-0 space-y-5">
          {/* Console Tour */}
          <div id="help-tour">
            <PageSection title={sections[0].title}>
              <StepList items={sections[0].items} compact />
            </PageSection>
          </div>

          {/* Initial Setup */}
          <div id="help-configuration">
            <PageSection title={sections[1].title}>
              <StepList items={sections[1].items} />
            </PageSection>
          </div>

          {/* Client config: Claude + Codex side-by-side */}
          <div className="grid gap-5 lg:grid-cols-2">
            <div id="help-claude">
              <PageSection title={sections[2].title} description={t('help.meta.claudeWorkflow')}>
                <StepList items={sections[2].items} />
              </PageSection>
            </div>
            <div id="help-codex">
              <PageSection title={sections[3].title} description={t('help.meta.codexWorkflow')}>
                <StepList items={sections[3].items} />
              </PageSection>
            </div>
          </div>

          {/* Daily Usage */}
          <div id="help-usage">
            <PageSection title={sections[4].title}>
              <StepList items={sections[4].items} />
            </PageSection>
          </div>

          {/* Tips */}
          <div id="help-tips">
            <PageSection title={sections[5].title}>
              <StepList items={sections[5].items} />
            </PageSection>
          </div>

          {/* FAQ */}
          <div id="help-faq">
            <PageSection title={t('help.faq.title')}>
              <FaqList items={faqItems} />
            </PageSection>
          </div>
        </div>
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
            'flex gap-3 rounded-lg border border-border/50 bg-card',
            compact ? 'p-3' : 'p-3.5'
          )}
        >
          <span className={cn(
            'flex shrink-0 items-center justify-center rounded-md bg-primary text-xs font-semibold text-primary-foreground',
            compact ? 'h-6 w-6 text-[11px]' : 'h-7 w-7'
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
            <div key={index} className="overflow-hidden rounded-md border border-border/55 bg-secondary">
              <div className="flex items-center justify-between border-b border-border/55 px-3 py-1.5">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  {language || 'bash'}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 rounded px-2 text-[11px] text-muted-foreground hover:text-foreground"
                  onClick={() => copyToClipboard(code)}
                >
                  {t('common.actions.copy')}
                </Button>
              </div>
              <pre className="overflow-x-auto px-3 py-2.5 font-mono text-[12px] leading-6 text-foreground">
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
    <div className="space-y-2">
      {leading.length > 0 ? (
        <div className="space-y-1.5">
          {leading.map((line, index) => (
            <p key={`${line}-${index}`} className="leading-6">
              {renderInlineRichText(line)}
            </p>
          ))}
        </div>
      ) : null}
      {bullets.length > 0 ? (
        <ul className="space-y-1.5 rounded-md bg-secondary px-3 py-2">
          {bullets.map((line, index) => (
            <li key={`${line}-${index}`} className="flex gap-2 text-sm leading-6">
              <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>{renderInlineRichText(line)}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {ordered.length > 0 ? (
        <ol className="space-y-1.5 rounded-md bg-secondary px-3 py-2">
          {ordered.map((item) => (
            <li key={`${item.index}-${item.text}`} className="flex gap-2.5 text-sm leading-6">
              <span className="mt-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary/15 px-1.5 text-[11px] font-semibold text-primary">
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
          className="rounded bg-secondary px-1.5 py-0.5 text-[0.95em] text-foreground"
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
          className="group overflow-hidden rounded-lg border border-border/50 bg-card"
        >
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium text-foreground">
            <span>{item.q}</span>
            <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground transition group-open:bg-primary/10 group-open:text-primary">
              {index + 1}
            </span>
          </summary>
          <div className="border-t border-border/50 px-4 py-3">
            <dd className="text-sm text-muted-foreground">
              <StepContent content={item.a} />
            </dd>
          </div>
        </details>
      ))}
    </dl>
  )
}
