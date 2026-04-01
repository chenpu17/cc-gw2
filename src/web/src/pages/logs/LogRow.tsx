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
  const rowStyle = sessionTone?.rowStyle as CSSProperties | undefined
  const stickyStyle = sessionTone?.stickyStyle as CSSProperties | undefined
  const timeCellStyle = sessionTone
    ? ({
        ...sessionTone.stickyStyle,
        ...sessionTone.accentStyle
      } as CSSProperties)
    : undefined

  return (
    <tr
      data-session-id={sessionTone?.sessionId}
      data-session-color={sessionTone?.colorKey}
      className={cn(
        'transition-colors',
        sessionTone ? '' : isEven ? 'bg-muted/30' : '',
        sessionTone ? '' : 'hover:bg-muted/50'
      )}
      style={rowStyle}
      onMouseEnter={(event) => {
        if (!sessionTone) return
        Object.assign(event.currentTarget.style, sessionTone.hoverStyle)
      }}
      onMouseLeave={(event) => {
        if (!sessionTone) return
        Object.assign(event.currentTarget.style, sessionTone.rowStyle)
      }}
    >
      <td className={cn('sticky left-0 z-10 text-xs', cellPadding, sessionTone ? '' : stickyCellBg)} style={timeCellStyle}>{formatDateTime(record.timestamp)}</td>
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
      {visibleColumnSet.has('inputTokens') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatNumber(record.input_tokens)}</td>
      )}
      {visibleColumnSet.has('cacheReadTokens') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatNumber(record.cache_read_tokens)}</td>
      )}
      {visibleColumnSet.has('cacheCreationTokens') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatNumber(record.cache_creation_tokens)}</td>
      )}
      {visibleColumnSet.has('outputTokens') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatNumber(record.output_tokens)}</td>
      )}
      {visibleColumnSet.has('latency') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatLatency(record.latency_ms, 'ms')}</td>
      )}
      {visibleColumnSet.has('ttft') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatLatency(record.ttft_ms, 'ms')}</td>
      )}
      {visibleColumnSet.has('tpot') && (
        <td className={cn(cellPadding, 'text-right text-xs tabular-nums')}>{formatLatency(record.tpot_ms, 'ms/tk')}</td>
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
      <td className={cn('sticky right-0 z-10 text-center', cellPadding, sessionTone ? '' : stickyCellBg)} style={stickyStyle}>
        <Button variant="outline" size="sm" onClick={() => onSelect(record.id)}>
          {t('logs.actions.detail')}
        </Button>
      </td>
    </tr>
  )
}
