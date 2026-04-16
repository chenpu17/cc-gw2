import { ChevronDown, ChevronUp, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { CustomEndpointsResponse } from '@/types/endpoints'
import type { ProviderSummary } from '@/services/gateway'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ApiKeyFilter } from './ApiKeyFilter'
import type { DateInput, QuickView, StatusFilter } from './shared'

interface LogsFiltersCardProps {
  total: number
  activeFilters: Array<{ key: string; label: string; onRemove: () => void }>
  filtersExpanded: boolean
  setFiltersExpanded: (next: boolean | ((prev: boolean) => boolean)) => void
  handleResetFilters: () => void
  activeQuickView: QuickView | null
  applyQuickView: (view: QuickView) => void
  providerFilter: string
  setProviderFilter: (value: string) => void
  endpointFilter: string
  setEndpointFilter: (value: string) => void
  selectedApiKeys: number[]
  setSelectedApiKeys: (value: number[]) => void
  modelFilter: string
  setModelFilter: (value: string) => void
  statusFilter: StatusFilter
  setStatusFilter: (value: StatusFilter) => void
  fromDate: DateInput
  setFromDate: (value: DateInput) => void
  toDate: DateInput
  setToDate: (value: DateInput) => void
  providerOptions: ProviderSummary[]
  apiKeys: ApiKeySummary[]
  apiKeysLoading: boolean
  customEndpoints: CustomEndpointsResponse['endpoints'] | undefined
}

export function LogsFiltersCard(props: LogsFiltersCardProps) {
  const { t } = useTranslation()
  const {
    total,
    activeFilters,
    filtersExpanded,
    setFiltersExpanded,
    handleResetFilters,
    activeQuickView,
    applyQuickView,
    providerFilter,
    setProviderFilter,
    endpointFilter,
    setEndpointFilter,
    selectedApiKeys,
    setSelectedApiKeys,
    modelFilter,
    setModelFilter,
    statusFilter,
    setStatusFilter,
    fromDate,
    setFromDate,
    toDate,
    setToDate,
    providerOptions,
    apiKeys,
    apiKeysLoading,
    customEndpoints
  } = props

  return (
    <Card
      data-testid="logs-filters-card"
      className="overflow-hidden rounded-[1.25rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)]"
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{t('logs.filtersTitle')}</p>
                <Badge variant="secondary" className="rounded-full px-2.5 py-0.5 text-[11px] font-semibold">
                  {t('logs.summary.total', { value: total.toLocaleString() })}
                </Badge>
                {activeFilters.length > 0 && (
                  <Badge variant="outline" className="rounded-full border-transparent bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                    {t('common.filters.activeCount', { count: activeFilters.length })}
                  </Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('logs.filtersDescription')}</p>
            </div>
            <div className="flex items-center gap-1.5">
              {activeFilters.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleResetFilters} className="h-8 rounded-full px-3 text-xs">
                  {t('common.actions.reset')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFiltersExpanded((prev) => !prev)}
                className="h-8 rounded-full px-3 text-xs"
              >
                {filtersExpanded ? (
                  <>
                    {t('common.filters.collapse')}
                    <ChevronUp className="ml-1 h-4 w-4" />
                  </>
                ) : (
                  <>
                    {t('common.filters.expand')}
                    <ChevronDown className="ml-1 h-4 w-4" />
                  </>
                )}
              </Button>
            </div>
          </div>

          <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-h-10 items-center rounded-[0.9rem] bg-secondary/70 px-3 py-2">
              {activeFilters.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {activeFilters.map((f) => (
                    <Badge
                      key={f.key}
                      variant="outline"
                      role="button"
                      tabIndex={0}
                      className="flex cursor-pointer items-center gap-1 rounded-full border border-border bg-card/90 px-2.5 py-1 text-[11px] font-semibold text-foreground/90 transition hover:bg-secondary/80"
                      onClick={f.onRemove}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.onRemove() } }}
                    >
                      {f.label}
                      <X className="h-3 w-3" aria-hidden="true" />
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">{t('common.filters.allRequests')}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
              <FilterSummary label={t('logs.filters.apiKey')} value={selectedApiKeys.length.toString()} />
              <FilterSummary label={t('logs.filters.provider')} value={providerFilter === 'all' ? '0' : '1'} />
              <FilterSummary label={t('logs.filters.endpoint')} value={endpointFilter === 'all' ? '0' : '1'} />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 rounded-[0.9rem] bg-secondary/70 px-2 py-1.5">
            {(['all', 'errors', 'today', 'anthropic', 'openai'] as QuickView[]).map((view) => (
              <Button
                key={view}
                variant="ghost"
                size="sm"
                className={cn(
                  'h-7 rounded-full px-3 text-[11px] font-semibold transition-colors',
                  activeQuickView === view ? 'bg-card text-foreground shadow-[0_12px_28px_-24px_rgba(15,23,42,0.32)]' : 'text-muted-foreground'
                )}
                onClick={() => applyQuickView(view)}
              >
                {t(`logs.quickViews.${view}` as const)}
              </Button>
            ))}
          </div>
        </div>
        {filtersExpanded && (
          <div className="mt-3 grid gap-3 rounded-[1rem] bg-secondary/45 p-3 md:grid-cols-2 xl:grid-cols-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-2">
              <Label>{t('logs.filters.provider')}</Label>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.filters.providerAll')}</SelectItem>
                  {providerOptions.map((provider) => (
                    <SelectItem key={provider.id} value={provider.id}>
                      {provider.label ?? provider.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.endpoint')}</Label>
              <Select value={endpointFilter} onValueChange={setEndpointFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.filters.endpointAll')}</SelectItem>
                  <SelectItem value="anthropic">{t('logs.filters.endpointAnthropic')}</SelectItem>
                  <SelectItem value="openai">{t('logs.filters.endpointOpenAI')}</SelectItem>
                  {customEndpoints?.map((ep) => (
                    <SelectItem key={ep.id} value={ep.id}>
                      {ep.label || ep.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <ApiKeyFilter
              className="md:col-span-2"
              apiKeys={apiKeys}
              selected={selectedApiKeys}
              disabled={apiKeysLoading}
              onChange={setSelectedApiKeys}
            />

            <div className="space-y-2">
              <Label>{t('logs.filters.modelId')}</Label>
              <Input
                value={modelFilter}
                onChange={(e) => setModelFilter(e.target.value)}
                placeholder={t('logs.filters.modelPlaceholder')}
              />
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.status')}</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t('logs.filters.statusAll')}</SelectItem>
                  <SelectItem value="success">{t('logs.filters.statusSuccess')}</SelectItem>
                  <SelectItem value="error">{t('logs.filters.statusError')}</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.startDate')}</Label>
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.endDate')}</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function FilterSummary({
  label,
  value
}: {
  label: string
  value: string
}) {
  return (
    <div className="inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-card/92 px-2.5 py-1 text-[11px] text-muted-foreground shadow-[0_10px_24px_-22px_rgba(15,23,42,0.28)]">
      <span>{label}</span>
      <span className="metric-number font-semibold text-foreground">{value}</span>
    </div>
  )
}
