import type { CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import type { LogRecord } from '@/types/logs'
import { Badge } from '@/components/ui/badge'
import { formatDateTime, formatLatency, formatNumber, getLogStatusMeta, getSessionRowTone } from './utils'

interface LogCardProps {
  record: LogRecord
  providerLabelMap: Map<string, string>
  onSelect: (id: number) => void
}

export function LogCard({ record, providerLabelMap, onSelect }: LogCardProps) {
  const { t } = useTranslation()
  const statusMeta = getLogStatusMeta(record, t)
  const providerLabel = providerLabelMap.get(record.provider) ?? record.provider
  const sessionTone = getSessionRowTone(record.session_id)
  const accentStyle = sessionTone?.accentStyle as CSSProperties | undefined

  return (
    <button
      type="button"
      data-session-id={sessionTone?.sessionId}
      data-session-color={sessionTone?.colorKey}
      style={accentStyle}
      onClick={() => onSelect(record.id)}
      className="w-full space-y-2 border-b border-border/50 px-4 py-3 text-left transition-colors hover:bg-muted/50"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{formatDateTime(record.timestamp)}</span>
        <Badge variant={statusMeta.variant} className="text-xs">
          {statusMeta.label}
        </Badge>
      </div>
      <div className="flex items-center justify-between gap-3 text-xs">
        <span className="min-w-0 truncate font-medium" title={providerLabel}>
          {providerLabel}
        </span>
        <span className="min-w-0 truncate text-muted-foreground" title={record.model}>
          {record.model}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
        <span>{formatLatency(record.latency_ms, t('common.units.ms'))}</span>
        {record.ttft_ms != null ? (
          <span>
            {t('logs.table.columns.latencyTtft')} {formatNumber(record.ttft_ms)}
          </span>
        ) : null}
      </div>
    </button>
  )
}
