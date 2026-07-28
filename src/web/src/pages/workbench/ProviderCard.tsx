import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatLatencyValue } from '@/pages/dashboard/types'
import type { ProviderConfig } from '@/types/providers'
import { PROVIDER_TYPE_OPTIONS } from './ProviderDrawerSteps'
import type { ProviderTestResult } from './shared'

/**
 * Single provider card for the workbench grid: header (avatar + name + proto +
 * baseUrl + health pill), 3 stat tiles (models / 24h requests / avg latency),
 * default-model chip, and a footer with route-reference count + test/edit actions.
 * Card is the detail surface (mockup has no separate detail dialog).
 */
export function ProviderCard({
  provider,
  defaultModel,
  modelCount,
  requests24h,
  avgLatencyMs,
  routeCount,
  testResult,
  onTest,
  onEdit
}: {
  provider: ProviderConfig
  defaultModel?: string
  modelCount: number
  requests24h: number | null
  avgLatencyMs: number | null
  routeCount: number
  testResult?: ProviderTestResult | null
  onTest: () => void
  onEdit: () => void
}) {
  const { t } = useTranslation()
  const name = provider.label || provider.id
  const initial = name.slice(0, 1).toUpperCase() || '?'
  const typeLabel =
    PROVIDER_TYPE_OPTIONS.find((option) => option.value === (provider.type ?? 'custom'))?.label ??
    provider.type ??
    'custom'
  const health: 'ok' | 'fail' | 'untested' = testResult ? (testResult.ok ? 'ok' : 'fail') : 'untested'

  return (
    <div
      data-testid="provider-card"
      className="flex flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
    >
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-secondary text-sm font-semibold text-muted-foreground">
          {initial}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[13px] font-semibold text-foreground" title={name}>
              {name}
            </span>
            <Badge
              variant="outline"
              className="shrink-0 rounded-full px-2 py-0 text-[10px] font-normal text-muted-foreground"
            >
              {typeLabel}
            </Badge>
          </div>
          <code
            className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground"
            title={provider.baseUrl}
          >
            {provider.baseUrl}
          </code>
        </div>
        <HealthPill state={health} />
      </div>

      {/* Stat tiles */}
      <div className="mt-3 grid grid-cols-3 gap-2">
        <StatTile label={t('providers.card.statModels')} value={modelCount > 0 ? String(modelCount) : '—'} />
        <StatTile
          label={t('providers.card.statRequests24h')}
          value={requests24h != null ? requests24h.toLocaleString() : '—'}
        />
        <StatTile
          label={t('providers.card.statAvgLatency')}
          value={formatLatencyValue(avgLatencyMs, t('common.units.ms'), { maximumFractionDigits: 0 })}
        />
      </div>

      {/* Default model */}
      <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="shrink-0">{t('providers.card.defaultModelLabel')}</span>
        {defaultModel ? (
          <code
            className="min-w-0 truncate rounded bg-secondary px-1.5 py-0.5 font-mono text-[10.5px] text-foreground"
            title={defaultModel}
          >
            {defaultModel}
          </code>
        ) : (
          <span>—</span>
        )}
      </div>

      {/* Footer: route-reference count + actions */}
      <div className="mt-3 flex items-center gap-1.5 border-t border-border pt-2.5 text-[10.5px] text-muted-foreground">
        <span className="truncate">{t('providers.card.routeCount', { count: routeCount })}</span>
        <div className="ml-auto flex shrink-0 gap-1.5">
          <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={onTest}>
            {t('providers.actions.test')}
          </Button>
          <Button variant="outline" size="sm" className="h-7 px-2.5 text-[11px]" onClick={onEdit}>
            {t('providers.actions.edit')}
          </Button>
        </div>
      </div>
    </div>
  )
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-secondary/60 px-2.5 py-2">
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="metric-number mt-0.5 truncate text-[13px] font-semibold text-foreground">{value}</div>
    </div>
  )
}

function HealthPill({ state }: { state: 'ok' | 'fail' | 'untested' }) {
  const { t } = useTranslation()
  if (state === 'ok') {
    return (
      <Badge variant="success" className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
        {t('providers.card.health.ok')}
      </Badge>
    )
  }
  if (state === 'fail') {
    return (
      <Badge variant="destructive" className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
        {t('providers.card.health.fail')}
      </Badge>
    )
  }
  return (
    <Badge variant="secondary" className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
      {t('providers.card.health.untested')}
    </Badge>
  )
}
