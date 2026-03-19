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
    <Card className="sticky top-20 z-20 overflow-hidden border-[rgba(24,16,13,0.08)] bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(252,249,245,0.92))] backdrop-blur">
      <CardContent className="pt-4">
        <div className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">{t('logs.filtersTitle')}</p>
                <Badge variant="outline">{t('logs.summary.total', { value: total.toLocaleString() })}</Badge>
                {activeFilters.length > 0 && (
                  <Badge variant="secondary">{t('common.filters.activeCount', { count: activeFilters.length })}</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground">{t('logs.filtersDescription')}</p>
            </div>
            <div className="flex items-center gap-2">
              {activeFilters.length > 0 && (
                <Button variant="ghost" size="sm" onClick={handleResetFilters}>
                  {t('common.actions.reset')}
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setFiltersExpanded((prev) => !prev)}
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

          <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto]">
            <div className="flex min-h-[52px] items-center rounded-[1.15rem] border border-border/70 bg-background/72 px-3 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
              {activeFilters.length > 0 ? (
                <div className="flex flex-wrap items-center gap-2">
                  {activeFilters.map((f) => (
                    <Badge
                      key={f.key}
                      variant="secondary"
                      role="button"
                      tabIndex={0}
                      className="cursor-pointer gap-1 border border-transparent bg-primary/10 text-primary hover:bg-destructive/10 hover:text-destructive"
                      onClick={f.onRemove}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); f.onRemove() } }}
                    >
                      {f.label}
                      <X className="h-3 w-3" aria-hidden="true" />
                    </Badge>
                  ))}
                </div>
              ) : (
                <span className="text-sm text-muted-foreground">{t('common.filters.allRequests')}</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:min-w-[360px]">
              <SummaryChip label={t('common.filters.activeCount', { count: activeFilters.length })} value={activeFilters.length.toString()} accent="blue" />
              <SummaryChip label={t('logs.filters.apiKey')} value={selectedApiKeys.length.toString()} accent="emerald" />
              <SummaryChip label={t('logs.filters.provider')} value={providerFilter === 'all' ? t('common.noData') : '1'} accent="amber" />
              <SummaryChip label={t('logs.filters.endpoint')} value={endpointFilter === 'all' ? t('common.noData') : '1'} accent="rose" />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 rounded-[1.15rem] border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.88),rgba(252,249,245,0.82))] p-2">
            {(['all', 'errors', 'today', 'anthropic', 'openai'] as QuickView[]).map((view) => (
              <Button
                key={view}
                variant={activeQuickView === view ? 'default' : 'outline'}
                size="sm"
                className={cn(
                  'rounded-full border-transparent',
                  activeQuickView === view && view === 'all' && 'bg-[#121212] text-white hover:bg-[#121212]/90',
                  activeQuickView === view && view === 'errors' && 'bg-rose-500 text-white hover:bg-rose-500/90',
                  activeQuickView === view && view === 'today' && 'bg-emerald-500 text-white hover:bg-emerald-500/90',
                  activeQuickView === view && (view === 'anthropic' || view === 'openai') && 'bg-amber-500 text-white hover:bg-amber-500/90'
                )}
                onClick={() => applyQuickView(view)}
              >
                {t(`logs.quickViews.${view}` as const)}
              </Button>
            ))}
          </div>
        </div>
        {filtersExpanded && (
          <div className="mt-4 grid gap-4 rounded-[1.3rem] border border-white/60 bg-background/72 p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)] md:grid-cols-2 xl:grid-cols-4 animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="space-y-2">
              <Label>{t('logs.filters.provider')}</Label>
              <Select value={providerFilter} onValueChange={setProviderFilter}>
                <SelectTrigger className="bg-background/90">
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
                <SelectTrigger className="bg-background/90">
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
                className="bg-background/90"
              />
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.status')}</Label>
              <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
                <SelectTrigger className="bg-background/90">
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
              <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} className="bg-background/90" />
            </div>

            <div className="space-y-2">
              <Label>{t('logs.filters.endDate')}</Label>
              <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} className="bg-background/90" />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SummaryChip({
  accent,
  label,
  value
}: {
  accent: 'amber' | 'blue' | 'emerald' | 'rose'
  label: string
  value: string
}) {
  const accentClassName = {
    blue: 'border-blue-200 bg-blue-50/80 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50/80 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50/80 text-amber-700',
    rose: 'border-rose-200 bg-rose-50/80 text-rose-700'
  }[accent]

  return (
    <div className={cn('rounded-[1rem] border px-3 py-2', accentClassName)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-1 text-sm font-semibold">{value}</p>
    </div>
  )
}
