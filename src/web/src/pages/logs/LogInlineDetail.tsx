import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link } from 'react-router-dom'
import { Copy, ExternalLink } from 'lucide-react'
import type { ApiKeySummary } from '@/types/apiKeys'
import { Button } from '@/components/ui/button'
import { PageState } from '@/components/PageState'
import { Skeleton } from '@/components/Skeleton'
import { cn } from '@/lib/utils'
import { useLogDetailState } from './useLogDetailState'
import {
  buildLogTrace,
  buildPayloadDisplay,
  formatLatency,
  formatNumber,
  type LogTraceTone
} from './utils'

interface LogInlineDetailProps {
  logId: number
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
}

const TONE_FILL: Record<LogTraceTone, string> = {
  accent: 'bg-primary',
  ok: 'bg-success',
  warn: 'bg-warning',
  error: 'bg-destructive'
}

interface PayloadSection {
  key: string
  title: string
  value: string | null
  emptyLabel: string
  copyToast: string
  display: ReturnType<typeof buildPayloadDisplay>
}

/**
 * Inline expansion panel rendered inside the logs table row. Mirrors the mockup:
 * a 2-column split — left is the derived request-trace timeline, right is a
 * compact metrics grid + tabbed payloads + action row. Mobile keeps the drawer.
 */
export function LogInlineDetail({ logId, providerLabelMap, apiKeyMap }: LogInlineDetailProps) {
  const { t } = useTranslation()
  const {
    record,
    isPending,
    isError,
    errorMessage,
    statusMeta,
    providerLabel,
    handleCopy,
    refetch
  } = useLogDetailState({ apiKeyMap, logId, open: true, providerLabelMap })

  const payloadSections = useMemo<PayloadSection[]>(() => {
    if (!record) return []
    const sections: Array<Omit<PayloadSection, 'display'>> = [
      {
        key: 'client-request',
        title: t('logs.detail.payload.clientRequest'),
        value: record.payload?.client_request ?? null,
        emptyLabel: t('logs.detail.payload.emptyRequest'),
        copyToast: 'logs.detail.copy.requestSuccess'
      }
    ]
    if (record.payload?.upstream_request) {
      sections.push({
        key: 'upstream-request',
        title: t('logs.detail.payload.upstreamRequest'),
        value: record.payload.upstream_request,
        emptyLabel: t('logs.detail.payload.emptyRequest'),
        copyToast: 'logs.detail.copy.requestSuccess'
      })
    }
    if (record.payload?.upstream_response) {
      sections.push({
        key: 'upstream-response',
        title: t('logs.detail.payload.upstreamResponse'),
        value: record.payload.upstream_response,
        emptyLabel: t('logs.detail.payload.emptyResponse'),
        copyToast: 'logs.detail.copy.responseSuccess'
      })
    }
    sections.push({
      key: 'client-response',
      title: t('logs.detail.payload.clientResponse'),
      value: record.payload?.client_response ?? null,
      emptyLabel: t('logs.detail.payload.emptyResponse'),
      copyToast: 'logs.detail.copy.responseSuccess'
    })
    return sections.map((section) => ({
      ...section,
      display: buildPayloadDisplay(section.value, section.emptyLabel)
    }))
  }, [record, t])

  const [activeKey, setActiveKey] = useState('client-request')
  const activeSection = payloadSections.find((section) => section.key === activeKey) ?? payloadSections[0]

  if (isPending) {
    return (
      <div className="py-3">
        <Skeleton className="h-28 w-full" />
      </div>
    )
  }
  if (isError) {
    return (
      <PageState
        compact
        tone="danger"
        title={t('logs.detail.loadError')}
        description={errorMessage ?? t('common.unknownError')}
        action={
          <Button variant="outline" size="sm" onClick={() => void refetch()}>
            {t('common.actions.refresh')}
          </Button>
        }
      />
    )
  }
  if (!record) {
    return <PageState compact title={t('logs.detail.loadError')} description={t('common.noData')} />
  }

  const trace = buildLogTrace(record, providerLabel, t)
  const ms = t('common.units.ms')
  const metrics = [
    { label: t('logs.detail.info.status'), value: statusMeta?.label ?? '-' },
    { label: t('logs.detail.info.latency'), value: formatLatency(record.latency_ms, ms) },
    { label: t('logs.detail.info.ttft'), value: formatLatency(record.ttft_ms, ms) },
    { label: t('logs.detail.info.inputTokens'), value: formatNumber(record.input_tokens) },
    { label: t('logs.detail.info.outputTokens'), value: formatNumber(record.output_tokens) },
    { label: t('logs.detail.info.cacheReadTokens'), value: formatNumber(record.cache_read_tokens) }
  ]
  const hasTtft = record.ttft_ms != null
  const sessionId = record.session_id

  return (
    <div data-testid="log-row-expanded" className="grid gap-5 py-1 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      {/* Left — derived request-trace timeline */}
      <div className="min-w-0">
        <p className="mb-3 text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {t('logs.detail.trace.title')}
        </p>
        <ol data-testid="log-trace-timeline" className="flex flex-col">
          {trace.map((step, index) => (
            <li key={step.id} className="grid grid-cols-[14px_1fr] gap-3">
              <div className="flex flex-col items-center" aria-hidden="true">
                <span className={cn('mt-1 h-[9px] w-[9px] rounded-full', TONE_FILL[step.tone])} />
                {index < trace.length - 1 ? <span className="mt-[3px] w-px flex-1 bg-border" /> : null}
              </div>
              <div className="pb-3.5">
                <div className="flex items-baseline gap-2.5">
                  <span className="text-xs font-semibold">{step.title}</span>
                  {step.atLabel ? (
                    <span className="text-[10.5px] tabular-nums text-muted-foreground">{step.atLabel}</span>
                  ) : null}
                  {step.durLabel ? (
                    <span className="ml-auto text-[10.5px] tabular-nums text-muted-foreground">{step.durLabel}</span>
                  ) : null}
                </div>
                {step.detail ? (
                  <div className="mt-1 text-[11px] leading-[1.55] text-muted-foreground">{step.detail}</div>
                ) : null}
                <div className="mt-1.5 h-1 w-full max-w-[220px] bg-secondary">
                  <div
                    className={cn('h-full', TONE_FILL[step.tone])}
                    style={{ width: `${step.barPct}%` }}
                  />
                </div>
              </div>
            </li>
          ))}
        </ol>
        {!hasTtft ? (
          <p className="mt-1 text-[10.5px] text-muted-foreground/70">{t('logs.detail.trace.degraded')}</p>
        ) : null}
      </div>

      {/* Right — metrics, tabbed payload, actions */}
      <div className="flex min-w-0 flex-col gap-3">
        <div className="grid grid-cols-3 gap-2">
          {metrics.map((metric) => (
            <div key={metric.label} className="border border-border bg-card px-2.5 py-2">
              <div className="text-[10.5px] text-muted-foreground">{metric.label}</div>
              <div className="mt-0.5 text-[13px] font-semibold tabular-nums">{metric.value}</div>
            </div>
          ))}
        </div>

        <div className="border border-border bg-card">
          <div className="flex gap-0.5 border-b border-border bg-secondary/50 p-1.5" role="tablist">
            {payloadSections.map((section) => {
              const isActive = section.key === activeSection?.key
              return (
                <button
                  key={section.key}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setActiveKey(section.key)}
                  className={cn(
                    'px-2.5 py-1 text-[10.5px] font-medium transition-colors',
                    isActive ? 'bg-card text-foreground' : 'text-muted-foreground hover:text-foreground'
                  )}
                >
                  {section.title}
                </button>
              )
            })}
          </div>
          <pre
            data-testid={`log-payload-${activeSection?.key ?? 'none'}`}
            className="m-0 max-h-[172px] overflow-auto whitespace-pre-wrap p-3 font-mono text-[10.5px] leading-[1.65] text-muted-foreground"
          >
            {activeSection?.display.text || t('logs.detail.payload.emptyRequest')}
          </pre>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-[30px] flex-1"
            onClick={() => {
              if (activeSection) {
                handleCopy(activeSection.title, activeSection.value, activeSection.copyToast)
              }
            }}
          >
            <Copy className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" />
            {t('logs.detail.inline.copyRequest')}
          </Button>
          {sessionId ? (
            <Button
              variant="outline"
              size="sm"
              className="h-[30px] flex-1"
              onClick={() => handleCopy(t('logs.detail.inline.copySession'), sessionId, 'logs.detail.inline.sessionCopied')}
            >
              {t('logs.detail.inline.copySession')}
            </Button>
          ) : null}
          <Button asChild variant="outline" size="sm" className="h-[30px] flex-1">
            <Link to="/providers?tab=routing">
              {t('logs.detail.inline.viewRule')}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" aria-hidden="true" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  )
}
