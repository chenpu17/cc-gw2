import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import { useApiQuery } from '@/hooks/useApiQuery'
import { queryKeys } from '@/services/queryKeys'
import { cn } from '@/lib/utils'
import type { ModelUsageMetric } from '@/pages/dashboard/types'
import type { ProviderConfig } from '@/types/providers'
import { PROVIDER_TYPE_OPTIONS } from './ProviderDrawerSteps'
import type { ProviderTestResult } from './shared'

type ProviderSortMode = 'usage' | 'name'

/**
 * Full-width providers table: filter/sort toolbar on top, one clickable row
 * per provider. Clicking a row (or pressing Enter/Space on it) opens the
 * detail dialog via onSelect.
 */
export function ProvidersTable({
  providersLength,
  filteredProviders,
  testResults,
  providerSearch,
  providerTypeFilter,
  configPending,
  defaultLabels,
  onSelect,
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
  onSelect: (provider: ProviderConfig) => void
  onProviderSearchChange: (value: string) => void
  onProviderTypeChange: (value: string) => void
  onResetFilters: () => void
}) {
  const { t } = useTranslation()
  const [sortMode, setSortMode] = useState<ProviderSortMode>('usage')

  // 7-day request counts per provider/model; aggregated per provider below.
  // Failures degrade silently to name sorting.
  const usageQuery = useApiQuery<ModelUsageMetric[]>(
    queryKeys.stats.model(7, 50),
    { url: '/api/stats/model', method: 'GET', params: { days: 7, limit: 50 } },
    { retry: false }
  )

  const usageByProvider = useMemo(() => {
    const map = new Map<string, number>()
    for (const metric of usageQuery.data ?? []) {
      map.set(metric.provider, (map.get(metric.provider) ?? 0) + metric.requests)
    }
    return map
  }, [usageQuery.data])

  const sortedProviders = useMemo(() => {
    const list = [...filteredProviders]
    const byName = (a: ProviderConfig, b: ProviderConfig) =>
      (a.label || a.id).localeCompare(b.label || b.id)
    if (sortMode === 'usage' && usageQuery.isSuccess) {
      // Zero-usage providers sink to the bottom, name as tie-break
      list.sort((a, b) => (usageByProvider.get(b.id) ?? 0) - (usageByProvider.get(a.id) ?? 0) || byName(a, b))
    } else {
      list.sort(byName)
    }
    return list
  }, [filteredProviders, sortMode, usageQuery.isSuccess, usageByProvider])

  return (
    <Card className="overflow-hidden">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center gap-2 border-b border-border bg-secondary/50 px-4 py-3">
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
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 px-4">
                  <span className="sr-only">{t('providers.table.status')}</span>
                </TableHead>
                <TableHead>{t('providers.table.name')}</TableHead>
                <TableHead>{t('providers.table.type')}</TableHead>
                <TableHead className="hidden md:table-cell">{t('providers.table.baseUrl')}</TableHead>
                <TableHead className="text-right">{t('providers.table.models')}</TableHead>
                <TableHead className="hidden lg:table-cell">{t('providers.table.defaultModel')}</TableHead>
                <TableHead className="text-right">{t('providers.table.requests7d')}</TableHead>
                <TableHead className="w-8 px-2">
                  <span className="sr-only">{t('providers.table.viewDetail')}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedProviders.map((provider) => {
                const testResult = testResults[provider.id]
                const modelCount = provider.models?.length ?? 0
                const requests7d = usageQuery.isSuccess ? usageByProvider.get(provider.id) ?? 0 : null
                const defaultModel = defaultLabels.get(provider.id)
                const typeLabel =
                  PROVIDER_TYPE_OPTIONS.find((option) => option.value === (provider.type ?? 'custom'))?.label ??
                  provider.type ??
                  'custom'

                return (
                  <TableRow
                    key={provider.id}
                    data-testid="provider-row"
                    tabIndex={0}
                    onClick={() => onSelect(provider)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault()
                        onSelect(provider)
                      }
                    }}
                    className="cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                  >
                    <TableCell className="px-4">
                      <span
                        title={
                          testResult
                            ? testResult.ok
                              ? t('providers.list.testOk')
                              : t('providers.list.testFailed')
                            : t('providers.list.untested')
                        }
                        className={cn(
                          'block h-2 w-2 rounded-full',
                          testResult ? (testResult.ok ? 'bg-success' : 'bg-destructive') : 'bg-muted-foreground/40'
                        )}
                      />
                    </TableCell>
                    <TableCell className="max-w-[220px]">
                      <p className="truncate text-sm font-medium text-foreground" title={provider.label || provider.id}>
                        {provider.label || provider.id}
                      </p>
                      {provider.label && provider.label !== provider.id ? (
                        <code className="block truncate text-[11px] text-muted-foreground" title={provider.id}>
                          {provider.id}
                        </code>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline" className="rounded-full px-2 py-0.5 text-[10px] font-normal text-muted-foreground">
                        {typeLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden max-w-[240px] md:table-cell">
                      <code className="block truncate text-xs text-muted-foreground" title={provider.baseUrl}>
                        {provider.baseUrl}
                      </code>
                    </TableCell>
                    <TableCell className="text-right tabular-nums text-muted-foreground">
                      {modelCount}
                    </TableCell>
                    <TableCell className="hidden max-w-[200px] lg:table-cell">
                      {defaultModel ? (
                        <code className="block truncate text-xs text-foreground" title={defaultModel}>
                          {defaultModel}
                        </code>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell
                      className="metric-number text-right text-muted-foreground"
                      title={requests7d != null ? t('providers.list.requests7d', { count: requests7d }) : undefined}
                    >
                      {requests7d != null ? requests7d.toLocaleString() : '—'}
                    </TableCell>
                    <TableCell className="px-2">
                      <ChevronRight className="h-4 w-4 text-muted-foreground/60 transition-transform group-hover:translate-x-0.5 group-hover:text-muted-foreground" aria-hidden />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
