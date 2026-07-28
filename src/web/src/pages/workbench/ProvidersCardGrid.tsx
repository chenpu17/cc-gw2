import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { PageState } from '@/components/PageState'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useApiQuery } from '@/hooks/useApiQuery'
import { queryKeys } from '@/services/queryKeys'
import type { ModelUsageMetric } from '@/pages/dashboard/types'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig, ProviderConfig } from '@/types/providers'
import { PROVIDER_TYPE_OPTIONS } from './ProviderDrawerSteps'
import { ProviderCard } from './ProviderCard'
import { findRoutesForProvider, type ProviderTestResult } from './shared'

type ProviderSortMode = 'usage' | 'name'

/**
 * Providers card grid: filter/sort toolbar on top, 3-column responsive grid of
 * {@link ProviderCard}s below. Each card is the detail surface (test/edit actions
 * inline); there is no separate detail dialog. 24h request counts and avg latency
 * are aggregated client-side from /api/stats/model; route-reference counts from
 * the routing config. Sort-by-usage degrades silently to name sort on failure.
 */
export function ProvidersCardGrid({
  providersLength,
  filteredProviders,
  testResults,
  providerSearch,
  providerTypeFilter,
  configPending,
  defaultLabels,
  config,
  customEndpoints,
  onTest,
  onEdit,
  onProviderSearchChange,
  onProviderTypeChange,
  onResetFilters
}: {
  providersLength: number
  filteredProviders: ProviderConfig[]
  testResults: Record<string, ProviderTestResult>
  providerSearch: string
  providerTypeFilter: string
  configPending: boolean
  defaultLabels: Map<string, string>
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  onTest: (provider: ProviderConfig) => void
  onEdit: (provider: ProviderConfig) => void
  onProviderSearchChange: (value: string) => void
  onProviderTypeChange: (value: string) => void
  onResetFilters: () => void
}) {
  const { t } = useTranslation()
  const [sortMode, setSortMode] = useState<ProviderSortMode>('usage')

  const usageQuery = useApiQuery<ModelUsageMetric[]>(
    queryKeys.stats.model(1, 50),
    { url: '/api/stats/model', method: 'GET', params: { days: 1, limit: 50 } },
    { retry: false }
  )

  // Aggregate per-model stats into per-provider 24h request counts and a
  // request-weighted average latency. Providers absent from the stats get 0
  // requests and null latency (rendered as '—').
  const { requestsByProvider, latencyByProvider } = useMemo(() => {
    const reqs = new Map<string, number>()
    const latencySum = new Map<string, number>()
    const latencyWeight = new Map<string, number>()
    for (const metric of usageQuery.data ?? []) {
      const id = metric.provider
      reqs.set(id, (reqs.get(id) ?? 0) + metric.requests)
      if (metric.avgLatencyMs > 0) {
        latencySum.set(id, (latencySum.get(id) ?? 0) + metric.avgLatencyMs * metric.requests)
        latencyWeight.set(id, (latencyWeight.get(id) ?? 0) + metric.requests)
      }
    }
    const lat = new Map<string, number | null>()
    for (const id of reqs.keys()) {
      const weight = latencyWeight.get(id) ?? 0
      lat.set(id, weight > 0 ? (latencySum.get(id) ?? 0) / weight : null)
    }
    return { requestsByProvider: reqs, latencyByProvider: lat }
  }, [usageQuery.data])

  const routeCountByProvider = useMemo(() => {
    const map = new Map<string, number>()
    for (const provider of filteredProviders) {
      map.set(provider.id, findRoutesForProvider(config, customEndpoints, provider.id).length)
    }
    return map
  }, [config, customEndpoints, filteredProviders])

  const sortedProviders = useMemo(() => {
    const list = [...filteredProviders]
    const byName = (a: ProviderConfig, b: ProviderConfig) =>
      (a.label || a.id).localeCompare(b.label || b.id)
    if (sortMode === 'usage' && usageQuery.isSuccess) {
      // Zero-usage providers sink to the bottom, name as tie-break
      list.sort(
        (a, b) =>
          (requestsByProvider.get(b.id) ?? 0) - (requestsByProvider.get(a.id) ?? 0) || byName(a, b)
      )
    } else {
      list.sort(byName)
    }
    return list
  }, [filteredProviders, sortMode, usageQuery.isSuccess, requestsByProvider])

  return (
    <div className="space-y-3">
      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-wrap items-center gap-2 bg-secondary/50 px-4 py-3">
            <Input
              value={providerSearch}
              onChange={(event) => onProviderSearchChange(event.target.value)}
              placeholder={t('providers.filters.searchPlaceholder')}
              className="h-9 w-full sm:w-64"
            />
            <Select value={providerTypeFilter} onValueChange={onProviderTypeChange}>
              <SelectTrigger className="h-9 w-[130px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('providers.filters.typeAll')}</SelectItem>
                {PROVIDER_TYPE_OPTIONS.map((option) => (
                  <SelectItem key={option.value ?? 'custom'} value={option.value ?? 'custom'}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={sortMode} onValueChange={(value) => setSortMode(value as ProviderSortMode)}>
              <SelectTrigger className="h-9 w-[104px] text-xs" aria-label={t('providers.list.sortLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="usage">{t('providers.list.sortUsage')}</SelectItem>
                <SelectItem value="name">{t('providers.list.sortName')}</SelectItem>
              </SelectContent>
            </Select>
            <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-1 text-[11px]">
              {filteredProviders.length}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              disabled={!providerSearch.trim() && providerTypeFilter === 'all'}
              className="h-9 shrink-0 rounded-full px-2.5 text-xs"
            >
              {t('common.actions.reset')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {configPending ? (
        <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
          {t('common.loading')}
        </div>
      ) : providersLength === 0 ? (
        <PageState
          compact
          title={t('providers.emptyState')}
          description={(
            <>
              <p>{t('providers.emptyStateSub')}</p>
              <p className="mt-1">{t('workbench.list.emptyHint')}</p>
            </>
          )}
        />
      ) : filteredProviders.length === 0 ? (
        <PageState compact title={t('providers.emptyFiltered')} />
      ) : (
        <div className="grid gap-3.5 sm:grid-cols-2 xl:grid-cols-3">
          {sortedProviders.map((provider) => (
            <ProviderCard
              key={provider.id}
              provider={provider}
              defaultModel={defaultLabels.get(provider.id)}
              modelCount={provider.models?.length ?? 0}
              requests24h={usageQuery.isSuccess ? requestsByProvider.get(provider.id) ?? 0 : null}
              avgLatencyMs={usageQuery.isSuccess ? latencyByProvider.get(provider.id) ?? null : null}
              routeCount={routeCountByProvider.get(provider.id) ?? 0}
              testResult={testResults[provider.id] ?? null}
              onTest={() => onTest(provider)}
              onEdit={() => onEdit(provider)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
