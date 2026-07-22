import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { LogRecord } from '@/types/logs'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { LogColumnId, RowDensity } from './shared'
import { formatDateTime, formatLatency, formatNumber, getLogStatusMeta, getSessionRowTone } from './utils'

interface LogRowProps {
  record: LogRecord
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
  onSelect: (id: number) => void
  isEven: boolean
  density: RowDensity
  visibleColumnSet: ReadonlySet<LogColumnId>
}

export function LogRow({
  record,
  providerLabelMap,
  apiKeyMap,
  onSelect,
  isEven,
  density,
  visibleColumnSet
}: LogRowProps) {
  const { t } = useTranslation()
  const providerLabel = providerLabelMap.get(record.provider) ?? record.provider
  const endpointLabel = record.endpoint || '-'
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

  return (
    <tr
      data-session-id={sessionTone?.sessionId}
      data-session-color={sessionTone?.colorKey}
      className={cn(
        'transition-colors duration-160 ease-surface',
        isEven ? 'bg-muted/30' : '',
        'hover:bg-muted/50'
      )}
    >
      <td className={cn('sticky left-0 z-10 text-xs', cellPadding, stickyCellBg)} style={timeCellStyle}>{formatDateTime(record.timestamp)}</td>
      {visibleColumnSet.has('endpoint') && (
        <td className={cn(cellPadding, 'text-xs')}>{endpointLabel}</td>
      )}
      {visibleColumnSet.has('provider') && (
        <td className={cn(cellPadding, 'text-xs')}>
          <div className="max-w-[100px] truncate" title={providerLabel}>{providerLabel}</div>
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
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums align-top')}>
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="whitespace-nowrap">
              {t('logs.table.columns.tokenIn')} {formatNumber(record.input_tokens)}
              <span className="mx-1 text-muted-foreground/50">·</span>
              {t('logs.table.columns.tokenOut')} {formatNumber(record.output_tokens)}
            </span>
            {(() => {
              const cacheTotal = (record.cache_read_tokens ?? 0) + (record.cache_creation_tokens ?? 0)
              return cacheTotal > 0 ? (
                <span className="whitespace-nowrap text-[11px] text-muted-foreground/70">
                  {t('logs.table.columns.tokenCache')} {formatNumber(cacheTotal)}
                </span>
              ) : null
            })()}
          </span>
        </td>
      )}
      {visibleColumnSet.has('duration') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums align-top')}>
          <span className="inline-flex flex-col items-end gap-0.5">
            <span className="whitespace-nowrap">{formatLatency(record.latency_ms, 'ms')}</span>
            {(record.ttft_ms != null || record.tpot_ms != null) && (
              <span
                className="whitespace-nowrap text-[11px] text-muted-foreground/70"
                title={`${t('logs.table.columns.latencyTtft')} ${formatLatency(record.ttft_ms, 'ms')} · ${t('logs.table.columns.latencyTpot')} ${formatLatency(record.tpot_ms, 'ms/tk')}`}
              >
                {t('logs.table.columns.latencyTtft')} {formatNumber(record.ttft_ms)}
                <span className="mx-1 text-muted-foreground/50">·</span>
                {t('logs.table.columns.latencyTpot')} {formatNumber(record.tpot_ms)}
              </span>
            )}
          </span>
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
            {record.error ? record.error : '-'}
          </div>
        </td>
      )}
      <td className={cn('sticky right-0 z-10 text-center', cellPadding, stickyCellBg)}>
        <Button variant="outline" size="sm" onClick={() => onSelect(record.id)}>
          {t('logs.actions.detail')}
        </Button>
      </td>
    </tr>
  )
}
