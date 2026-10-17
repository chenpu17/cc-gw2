import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { LogRecord } from '@/types/logs'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { LogColumnId, RowDensity } from './shared'
import { formatCost } from '@/utils/currency'
import { formatDateTime, formatLatency, formatNumber, getLogStatusMeta, getSessionRowTone } from './utils'
import { LogInlineDetail } from './LogInlineDetail'

interface LogRowProps {
  record: LogRecord
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
  onSelect: (id: number) => void
  isExpanded: boolean
  onToggleExpand: (id: number) => void
  isEven: boolean
  density: RowDensity
  visibleColumnSet: ReadonlySet<LogColumnId>
  /** Display currency for the cost cell (billing, v0.16). */
  costCurrency?: string
}

export function LogRow({
  record,
  providerLabelMap,
  apiKeyMap,
  onSelect,
  isExpanded,
  onToggleExpand,
  isEven,
  density,
  visibleColumnSet,
  costCurrency
}: LogRowProps) {
  const { t } = useTranslation()
  const providerLabel = providerLabelMap.get(record.provider) ?? record.provider
  const endpointLabel = record.endpoint || '—'
  const statusMeta = getLogStatusMeta(record, t)
  const requestedModel = record.client_model ?? t('logs.table.requestedModelFallback')
  const apiKeyMeta = record.api_key_id != null ? apiKeyMap.get(record.api_key_id) : undefined
  const apiKeyLabel = (() => {
    if (record.api_key_id == null) {
      return t('logs.table.apiKeyUnknown')
    }
    if (apiKeyMeta?.isWildcard) {
      return t('apiKeys.wildcard')
    }
    if (apiKeyMeta?.name) {
      return apiKeyMeta.name
    }
    if (record.api_key_name) {
      return record.api_key_name
    }
    return t('logs.table.apiKeyUnknown')
  })()
  const cellPadding = density === 'compact' ? 'px-3 py-1.5' : 'px-3 py-2'
  const stickyCellBg = isEven ? 'bg-muted/30' : 'bg-background'
  const sessionTone = getSessionRowTone(record.session_id)
  const timeCellStyle = sessionTone?.accentStyle as CSSProperties | undefined
  const colSpan = visibleColumnSet.size + 2
  const toggleLabel = isExpanded ? t('logs.detail.inline.collapse') : t('logs.detail.inline.expand')

  return (
    <>
      <tr
        data-log-id={record.id}
        data-session-id={sessionTone?.sessionId}
        data-session-color={sessionTone?.colorKey}
        className={cn(
          'transition-colors duration-160 ease-surface',
          isEven ? 'bg-muted/30' : '',
          isExpanded ? 'bg-muted/50' : 'hover:bg-muted/50'
        )}
      >
        <td className={cn('sticky left-0 z-10 text-xs', cellPadding, stickyCellBg)} style={timeCellStyle}>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              aria-expanded={isExpanded}
              aria-label={toggleLabel}
              onClick={() => onToggleExpand(record.id)}
              className="-ml-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <ChevronRight
                className={cn('h-3.5 w-3.5 transition-transform duration-160 ease-surface', isExpanded && 'rotate-90')}
                aria-hidden="true"
              />
            </button>
            <span className="metric-number">{formatDateTime(record.timestamp)}</span>
          </div>
        </td>
        {visibleColumnSet.has('endpoint') && (
          <td className={cn(cellPadding, 'text-xs')}>{endpointLabel}</td>
        )}
        {visibleColumnSet.has('provider') && (
          <td className={cn(cellPadding, 'text-xs')}>
            <div className="max-w-[100px] truncate" title={providerLabel}>{providerLabel}</div>
          </td>
        )}
        {visibleColumnSet.has('client') && (
          <td className={cn(cellPadding, 'text-xs text-muted-foreground')}>
            <div className="max-w-[110px] truncate" title={record.user_agent ?? record.client_kind ?? ''}>
              {record.client_kind ?? '—'}
            </div>
          </td>
        )}
        {visibleColumnSet.has('requestedModel') && (
          <td className={cn(cellPadding, 'text-xs text-muted-foreground')}>
            <div className="max-w-[120px] truncate" title={requestedModel}>{requestedModel}</div>
          </td>
        )}
        {visibleColumnSet.has('routedModel') && (
          <td className={cn(cellPadding, 'text-xs')}>
            <div className="max-w-[120px] truncate" title={record.model}>{record.model}</div>
          </td>
        )}
        {visibleColumnSet.has('apiKey') && (
          <td className={cn(cellPadding, 'text-xs text-muted-foreground')}>
            <div className="max-w-[90px] truncate" title={apiKeyLabel}>{apiKeyLabel}</div>
          </td>
        )}
        {visibleColumnSet.has('tokens') && (
          <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>
            {/* Both sides null = upstream sent no usage stats; unknown must read
                differently from a real 0. */}
            {record.input_tokens == null && record.output_tokens == null ? (
              <span className="whitespace-nowrap text-muted-foreground/70">
                {t('logs.table.tokensNoUsage')}
              </span>
            ) : (
              <span className="whitespace-nowrap">
                {t('logs.table.columns.tokenIn')} {formatNumber(record.input_tokens)}
                <span className="mx-1 text-muted-foreground/50">·</span>
                {t('logs.table.columns.tokenOut')} {formatNumber(record.output_tokens)}
              </span>
            )}
          </td>
        )}
        {visibleColumnSet.has('cost') && (
          <td className={cn(cellPadding, 'text-right text-xs tabular-nums align-top')}>
            <span
              className="whitespace-nowrap"
              title={record.cost == null ? t('logs.table.costUnpricedHint') : undefined}
              data-testid={`log-cost-${record.id}`}
            >
              {formatCost(record.cost, costCurrency)}
            </span>
          </td>
        )}
        {visibleColumnSet.has('duration') && (
          <td className={cn(cellPadding, 'text-right text-xs tabular-nums')} title={
            (record.ttft_ms != null || record.tpot_ms != null)
              ? `${t('logs.table.columns.latencyTtft')} ${formatLatency(record.ttft_ms, 'ms')} · ${t('logs.table.columns.latencyTpot')} ${formatLatency(record.tpot_ms, 'ms/tk')}`
              : undefined
          }>
            <span className="whitespace-nowrap">{formatLatency(record.latency_ms, 'ms')}</span>
          </td>
        )}
        {visibleColumnSet.has('status') && (
          <td className={cn(cellPadding, 'text-center')}>
            <Badge variant={statusMeta.variant} className="text-xs">
              {statusMeta.label}
            </Badge>
          </td>
        )}
        {visibleColumnSet.has('error') && (
          <td className={cn(cellPadding, 'text-xs text-muted-foreground')}>
            <div className="max-w-[100px] truncate" title={record.error ?? ''}>
              {record.error ? record.error : '—'}
            </div>
          </td>
        )}
        <td className={cn('sticky right-0 z-10 text-center', cellPadding, stickyCellBg)}>
          <Button variant="outline" size="sm" onClick={() => onSelect(record.id)}>
            {t('logs.actions.detail')}
          </Button>
        </td>
      </tr>
      {isExpanded ? (
        <tr data-testid={`log-row-expanded-wrapper-${record.id}`}>
          <td colSpan={colSpan} className="border-t border-border bg-secondary/30 p-0">
            <div className="px-5 pb-5 pt-3">
              <LogInlineDetail logId={record.id} providerLabelMap={providerLabelMap} apiKeyMap={apiKeyMap} />
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}
