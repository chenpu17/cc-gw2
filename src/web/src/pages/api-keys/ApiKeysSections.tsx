import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { EChart, echarts, type EChartOption } from '@/components/EChart'
import { PageSection } from '@/components/PageSection'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'
import { Copy, Eye, EyeOff, Key, Shield, Trash2 } from 'lucide-react'
import type { ApiKeySummary } from '@/types/apiKeys'
import { RANGE_OPTIONS } from './shared'

export function ApiKeysQuickStartSection() {
  const { t } = useTranslation()

  return (
    <PageSection
      eyebrow="Recommended"
      title={t('apiKeys.quickStart.title')}
      description={t('apiKeys.quickStart.description')}
      contentClassName="pt-5"
    >
      <div className="grid gap-4 md:grid-cols-3">
        <QuickStartCard
          icon={<Key className="h-4 w-4" aria-hidden="true" />}
          title={t('apiKeys.quickStart.create.title')}
          description={t('apiKeys.quickStart.create.description')}
        />
        <QuickStartCard
          icon={<Shield className="h-4 w-4" aria-hidden="true" />}
          title={t('apiKeys.quickStart.restrict.title')}
          description={t('apiKeys.quickStart.restrict.description')}
        />
        <QuickStartCard
          icon={<EyeOff className="h-4 w-4" aria-hidden="true" />}
          title={t('apiKeys.quickStart.wildcard.title')}
          description={t('apiKeys.quickStart.wildcard.description')}
        />
      </div>
    </PageSection>
  )
}

export function ApiKeysAnalyticsSection({
  activeKeysValue,
  enabledKeysValue,
  loading,
  onRangeChange,
  rangeDays,
  requestsChartOption,
  totalKeysValue,
  tokensChartOption,
  usageLength
}: {
  activeKeysValue: string
  enabledKeysValue: string
  loading: boolean
  onRangeChange: (days: number) => void
  rangeDays: number
  requestsChartOption: EChartOption
  totalKeysValue: string
  tokensChartOption: EChartOption
  usageLength: number
}) {
  const { t } = useTranslation()

  return (
    <PageSection
      eyebrow="Usage"
      title={t('apiKeys.analytics.title')}
      description={t('apiKeys.analytics.description', { days: rangeDays })}
      actions={
        <div className="flex w-full items-center gap-1 overflow-x-auto rounded-full border border-border bg-secondary p-1 sm:w-auto">
          {RANGE_OPTIONS.map((option) => {
            const active = rangeDays === option.value
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onRangeChange(option.value)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-xs font-medium transition-all',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
                )}
              >
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <MetricCard label={t('apiKeys.analytics.cards.total')} value={totalKeysValue} />
          <MetricCard label={t('apiKeys.analytics.cards.enabled')} value={enabledKeysValue} />
          <MetricCard label={t('apiKeys.analytics.cards.active', { days: rangeDays })} value={activeKeysValue} />
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <AnalyticsChartCard
            title={t('apiKeys.analytics.charts.requests')}
            loading={loading}
            empty={usageLength === 0}
            emptyText={t('apiKeys.analytics.empty')}
            option={requestsChartOption}
          />
          <AnalyticsChartCard
            title={t('apiKeys.analytics.charts.tokens')}
            loading={loading}
            empty={usageLength === 0}
            emptyText={t('apiKeys.analytics.empty')}
            option={tokensChartOption}
          />
        </div>
      </div>
    </PageSection>
  )
}

export function ApiKeysInventorySection({
  filteredKeys,
  formatDate,
  hasWildcard,
  isDeleting,
  isRevealing,
  keys,
  onCopy,
  onDelete,
  onEditEndpoints,
  onFilterChange,
  onHide,
  onReveal,
  onStatusFilterChange,
  onToggleEnabled,
  restrictedCount,
  revealedKeys,
  search,
  statusFilter,
  unrestrictedCount,
  wildcardCount
}: {
  filteredKeys: ApiKeySummary[]
  formatDate: (isoString: string | null) => string
  hasWildcard: boolean
  isDeleting: number | null
  isRevealing: number | null
  keys: ApiKeySummary[]
  onCopy: (key: string) => void
  onDelete: (key: ApiKeySummary) => void
  onEditEndpoints: (key: ApiKeySummary) => void
  onFilterChange: (value: string) => void
  onHide: (id: number) => void
  onReveal: (id: number) => void
  onStatusFilterChange: (value: 'all' | 'enabled' | 'disabled') => void
  onToggleEnabled: (id: number, enabled: boolean) => void
  restrictedCount: number
  revealedKeys: Map<number, string>
  search: string
  statusFilter: 'all' | 'enabled' | 'disabled'
  unrestrictedCount: number
  wildcardCount: number
}) {
  const { t } = useTranslation()

  return (
    <PageSection
      eyebrow="Inventory"
      title={t('apiKeys.list.title')}
      description={hasWildcard ? t('apiKeys.wildcardHint') : undefined}
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline">{`${filteredKeys.length}/${keys.length}`}</Badge>
          <Badge variant="outline">{t('apiKeys.summary.wildcard', { count: wildcardCount })}</Badge>
          <Badge variant="outline">{t('apiKeys.summary.restricted', { count: restrictedCount })}</Badge>
        </div>
      }
    >
      <div className="space-y-4">
        <div className="grid gap-4 md:grid-cols-3">
          <InventoryStatCard
            label={t('apiKeys.list.title')}
            value={`${filteredKeys.length}/${keys.length}`}
            helper={t('apiKeys.filters.searchPlaceholder')}
          />
          <InventoryStatCard
            label={t('apiKeys.summary.wildcard', { count: wildcardCount })}
            value={String(wildcardCount)}
            helper={t('apiKeys.wildcardHint')}
          />
          <InventoryStatCard
            label={t('apiKeys.summary.restricted', { count: restrictedCount })}
            value={String(restrictedCount)}
            helper={t('apiKeys.summary.unrestricted', { count: unrestrictedCount })}
          />
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-secondary p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,360px)] xl:grid-cols-[minmax(0,1fr)_180px_auto]">
          <Input
            value={search}
            onChange={(event) => onFilterChange(event.target.value)}
            placeholder={t('apiKeys.filters.searchPlaceholder')}
          />
          <div className="flex items-center gap-1 overflow-x-auto rounded-full border border-border bg-secondary p-1">
            {(['all', 'enabled', 'disabled'] as const).map((value) => (
              <button
                key={value}
                type="button"
                onClick={() => onStatusFilterChange(value)}
                className={cn(
                  'inline-flex h-8 shrink-0 items-center rounded-full px-3.5 text-xs font-medium transition-all',
                  statusFilter === value
                    ? 'bg-primary text-primary-foreground'
                    : 'text-muted-foreground hover:bg-primary/5 hover:text-foreground'
                )}
              >
                {t(`apiKeys.filters.${value}`)}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:col-span-2 xl:col-span-1">
            <Badge variant="secondary">{t('apiKeys.summary.wildcard', { count: wildcardCount })}</Badge>
            <Badge variant="secondary">{t('apiKeys.summary.restricted', { count: restrictedCount })}</Badge>
          </div>
        </div>

        {keys.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border">
            <p className="text-sm text-muted-foreground">{t('apiKeys.list.empty')}</p>
          </div>
        ) : filteredKeys.length === 0 ? (
          <div className="flex h-32 items-center justify-center rounded-lg border border-dashed border-border">
            <p className="text-sm text-muted-foreground">{t('apiKeys.list.emptyFiltered')}</p>
          </div>
        ) : (
          <div className="grid gap-4">
            {filteredKeys.map((key) => (
              <ApiKeyCard
                key={key.id}
                formatDate={formatDate}
                isDeleting={isDeleting === key.id}
                isRevealing={isRevealing === key.id}
                keySummary={key}
                onCopy={onCopy}
                onDelete={onDelete}
                onEditEndpoints={onEditEndpoints}
                onHide={onHide}
                onReveal={onReveal}
                onToggleEnabled={onToggleEnabled}
                revealedValue={revealedKeys.get(key.id)}
              />
            ))}
          </div>
        )}
      </div>
    </PageSection>
  )
}

function QuickStartCard({ description, icon, title }: { description: string; icon: ReactNode; title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
        {icon}
      </div>
      <p className="mt-3 text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  )
}

function ApiKeyCard({
  formatDate,
  isDeleting,
  isRevealing,
  keySummary,
  onCopy,
  onDelete,
  onEditEndpoints,
  onHide,
  onReveal,
  onToggleEnabled,
  revealedValue
}: {
  formatDate: (isoString: string | null) => string
  isDeleting: boolean
  isRevealing: boolean
  keySummary: ApiKeySummary
  onCopy: (key: string) => void
  onDelete: (key: ApiKeySummary) => void
  onEditEndpoints: (key: ApiKeySummary) => void
  onHide: (id: number) => void
  onReveal: (id: number) => void
  onToggleEnabled: (id: number, enabled: boolean) => void
  revealedValue?: string
}) {
  const { t } = useTranslation()
  const totalTokens = (keySummary.totalInputTokens + keySummary.totalOutputTokens).toLocaleString()
  const accessMode = keySummary.isWildcard
    ? 'wildcard'
    : (keySummary.allowedEndpoints?.length ?? 0) > 0
      ? 'restricted'
      : 'unrestricted'
    return (
    <Card data-testid="api-key-card">
      <CardContent className="space-y-4 pt-4">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base font-semibold">{keySummary.name}</h3>
              {keySummary.isWildcard ? (
                <Badge variant="secondary">{t('apiKeys.wildcard')}</Badge>
              ) : null}
              <Badge variant={keySummary.enabled ? 'default' : 'outline'}>
                {keySummary.enabled ? t('apiKeys.status.enabled') : t('apiKeys.status.disabled')}
              </Badge>
              {!keySummary.isWildcard ? (
                <Badge variant="outline" className="text-xs">
                  {(keySummary.allowedEndpoints?.length ?? 0) > 0 ? t('apiKeys.endpointRestricted') : t('apiKeys.allEndpoints')}
                </Badge>
              ) : null}
              {!keySummary.isWildcard && keySummary.allowedEndpoints && keySummary.allowedEndpoints.length > 0 ? (
                keySummary.allowedEndpoints.map((endpoint) => (
                  <Badge key={endpoint} variant="outline" className="text-xs">
                    {endpoint}
                  </Badge>
                ))
              ) : !keySummary.isWildcard ? (
                <Badge variant="secondary" className="text-xs opacity-60">
                  {t('apiKeys.allEndpoints')}
                </Badge>
              ) : null}
            </div>

            <div className="grid gap-2 sm:grid-cols-3">
              <KeyMetaChip label={t('apiKeys.requestCount')} value={keySummary.requestCount.toLocaleString()} />
              <KeyMetaChip label={t('apiKeys.totalTokens')} value={totalTokens} />
              <KeyMetaChip
                label={t('apiKeys.maxConcurrency')}
                value={keySummary.maxConcurrency ? String(keySummary.maxConcurrency) : t('apiKeys.maxConcurrencyPlaceholder')}
              />
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <code className="block max-w-full break-all rounded-lg border border-border bg-secondary px-3 py-1.5 font-mono text-sm">
                {keySummary.isWildcard
                  ? t('apiKeys.wildcard')
                  : revealedValue ?? keySummary.maskedKey ?? '********'}
              </code>
              {!keySummary.isWildcard ? (
                <div className="flex items-center gap-1 self-start">
                  {revealedValue ? (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onCopy(revealedValue)}
                        aria-label={t('common.actions.copy')}
                        title={t('common.actions.copy')}
                      >
                        <Copy className="h-4 w-4" aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        onClick={() => onHide(keySummary.id)}
                        aria-label={t('apiKeys.actions.hide')}
                        title={t('apiKeys.actions.hide')}
                      >
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => onReveal(keySummary.id)}
                      disabled={isRevealing}
                      aria-label={t('apiKeys.actions.reveal')}
                      title={t('apiKeys.actions.reveal')}
                    >
                      {isRevealing ? (
                        <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  )}
                </div>
              ) : null}
            </div>

            {keySummary.isWildcard ? (
              <p className="text-sm text-muted-foreground">{t('apiKeys.wildcardHint')}</p>
            ) : keySummary.description ? (
              <p className="whitespace-pre-wrap text-sm text-muted-foreground">{keySummary.description}</p>
            ) : null}
            {!keySummary.isWildcard ? (
              <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
                {(keySummary.allowedEndpoints?.length ?? 0) > 0
                  ? `${t('apiKeys.allowedEndpoints')}: ${keySummary.allowedEndpoints?.join(', ')}`
                  : t('apiKeys.allEndpoints')}
              </div>
            ) : null}

            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('apiKeys.created')}
                </span>
                <p className="font-medium">{formatDate(keySummary.createdAt)}</p>
              </div>
              <div className="space-y-1">
                <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {t('apiKeys.lastUsed')}
                </span>
                <p className="font-medium">{formatDate(keySummary.lastUsedAt)}</p>
              </div>
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
            <Button variant="outline" size="sm" onClick={() => onEditEndpoints(keySummary)} className="w-full lg:w-auto">
              <Shield className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
              {keySummary.isWildcard ? t('apiKeys.maxConcurrency') : t('apiKeys.editEndpoints')}
            </Button>
            <Button
              variant={keySummary.enabled ? 'outline' : 'default'}
              size="sm"
              onClick={() => onToggleEnabled(keySummary.id, keySummary.enabled)}
              className="w-full lg:w-auto"
            >
              {keySummary.enabled ? t('apiKeys.actions.disable') : t('apiKeys.actions.enable')}
            </Button>
            {!keySummary.isWildcard ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:w-9"
                onClick={() => onDelete(keySummary)}
                disabled={isDeleting}
                aria-label={t('apiKeys.actions.delete')}
              >
                <Trash2 className="h-4 w-4" aria-hidden="true" />
              </Button>
            ) : null}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="pt-4">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold text-foreground">{value}</p>
      </CardContent>
    </Card>
  )
}

function InventoryStatCard({ helper, label, value }: { helper: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 text-lg font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  )
}

function KeyMetaChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-secondary px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-medium">{value}</p>
    </div>
  )
}

function AnalyticsChartCard({
  empty,
  emptyText,
  loading,
  option,
  title
}: {
  empty: boolean
  emptyText: string
  loading: boolean
  option: EChartOption
  title: string
}) {
  const { t } = useTranslation()

  return (
    <Card>
      <CardContent className="space-y-4 pt-4">
        <h3 className="text-base font-semibold">{title}</h3>
        {loading ? (
          <div className="flex h-[280px] items-center justify-center">
            <span className="text-sm text-muted-foreground">{t('common.loadingShort')}</span>
          </div>
        ) : empty ? (
          <div className="flex h-[280px] items-center justify-center rounded-lg border border-dashed border-border">
            <span className="text-sm text-muted-foreground">{emptyText}</span>
          </div>
        ) : (
          <EChart echarts={echarts} option={option} style={{ height: 280 }} notMerge lazyUpdate />
        )}
      </CardContent>
    </Card>
  )
}
