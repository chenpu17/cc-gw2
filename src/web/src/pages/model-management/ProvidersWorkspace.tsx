import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Globe, Loader2, Boxes, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import type { ProviderConfig } from '@/types/providers'

export function ProvidersWorkspace({
  providersLength,
  filteredProviders,
  defaultLabels,
  providerSearch,
  providerTypeFilter,
  configPending,
  testingProviderId,
  onOpenEdit,
  onTestConnection,
  onRequestDelete,
  onProviderSearchChange,
  onResetFilters
}: {
  providersLength: number
  filteredProviders: ProviderConfig[]
  defaultLabels: Map<string, string>
  providerSearch: string
  providerTypeFilter: string
  configPending: boolean
  testingProviderId: string | null
  onOpenEdit: (provider: ProviderConfig) => void
  onTestConnection: (provider: ProviderConfig) => void
  onRequestDelete: (provider: ProviderConfig) => void
  onProviderSearchChange: (value: string) => void
  onProviderTypeChange: (value: string) => void
  onResetFilters: () => void
}) {
  const { t } = useTranslation()
  const describeAuthMode = (provider: ProviderConfig) => {
    const effectiveAuthMode = provider.authMode ?? (provider.type === 'anthropic' ? 'authToken' : 'apiKey')
    if (effectiveAuthMode === 'authToken') return 'Bearer'
    if (effectiveAuthMode === 'xAuthToken') return 'X-Auth-Token'
    if (provider.type === 'anthropic') return 'X-API-Key'
    return t('providers.card.providerDefault')
  }

  return (
    <Card className="rounded-[1.35rem] border border-white/70 bg-card/95 shadow-[0_22px_56px_-46px_rgba(15,23,42,0.24)]">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="flex flex-col gap-3 rounded-[1.1rem] bg-secondary/60 p-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <Input
              value={providerSearch}
              onChange={(event) => onProviderSearchChange(event.target.value)}
              placeholder={t('providers.filters.searchPlaceholder')}
              className="h-10 bg-card/90 sm:max-w-[520px]"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary" className="rounded-full px-3 py-1 text-xs">
              {t('providers.count', { count: filteredProviders.length })}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              disabled={!providerSearch.trim() && providerTypeFilter === 'all'}
              className="h-8 rounded-full px-3 text-xs"
            >
              {t('common.actions.reset')}
            </Button>
          </div>
        </div>

        {configPending ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg bg-secondary text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : providersLength === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border/30 p-12 text-center text-sm text-muted-foreground">
            <p className="font-medium">{t('providers.emptyState')}</p>
            <p className="mt-2 text-xs">{t('providers.emptyStateSub', { default: '点击上方按钮添加您的第一个提供商' })}</p>
          </div>
        ) : filteredProviders.length === 0 ? (
          <div className="rounded-lg border-2 border-dashed border-border/30 p-12 text-center text-sm text-muted-foreground">
            <p className="font-medium">{t('providers.emptyFiltered')}</p>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {filteredProviders.map((provider) => {
                const authModeDisplay = describeAuthMode(provider)
                const modelCount = provider.models?.length ?? 0
                const defaultModelId = defaultLabels.get(provider.id)

                return (
                  <ProviderCard
                    key={provider.id}
                    provider={provider}
                    authMode={authModeDisplay}
                    modelCount={modelCount}
                    defaultModel={defaultModelId}
                    isTesting={testingProviderId === provider.id}
                    onEdit={() => onOpenEdit(provider)}
                    onTest={() => onTestConnection(provider)}
                    onDelete={() => onRequestDelete(provider)}
                    t={t}
                  />
                )
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderCard({
  provider,
  authMode,
  modelCount,
  defaultModel,
  isTesting,
  onEdit,
  onTest,
  onDelete,
  t
}: {
  provider: ProviderConfig
  authMode: string
  modelCount: number
  defaultModel?: string
  isTesting: boolean
  onEdit: () => void
  onTest: () => void
  onDelete: () => void
  t: any
}) {
  const hasDefaultModel = Boolean(defaultModel)
  const statusTone = hasDefaultModel ? 'success' : 'warning'
  const statusLabel = hasDefaultModel ? t('providers.status.ready') : t('providers.status.needsDefault')

  return (
    <Card className="overflow-hidden rounded-[1.05rem] border border-border/60 bg-[linear-gradient(180deg,rgba(255,255,255,0.97)_0%,rgba(250,251,253,0.94)_100%)] shadow-[0_16px_36px_-32px_rgba(15,23,42,0.2)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_22px_42px_-34px_rgba(59,130,246,0.18)] dark:border-white/10 dark:bg-[linear-gradient(180deg,rgba(15,23,42,0.92)_0%,rgba(2,6,23,0.88)_100%)]">
      <CardContent className="space-y-3 p-3.5">
        <div className="flex items-start justify-between gap-2.5">
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2.5">
              <h4 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-foreground" title={provider.label || provider.id}>
                {provider.label || provider.id}
              </h4>
            </div>
            <code className="mt-0.5 block truncate text-[11px] text-muted-foreground" title={provider.id}>
              {provider.id}
            </code>
          </div>
          <Badge variant={statusTone} className="shrink-0 rounded-full px-2 py-0.5 text-[10px]">
            {statusLabel}
          </Badge>
        </div>

        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <MetaPill icon={<ShieldCheck className="h-3.5 w-3.5" />} label={t('providers.card.authMode')} value={authMode} />
          <MetaPill
            icon={<Boxes className="h-3.5 w-3.5" />}
            label={t('providers.card.modelsTitle')}
            value={modelCount > 0 ? t('providers.card.modelCount', { count: modelCount }) : t('providers.card.passthrough')}
          />
        </div>

        <div className="space-y-2 rounded-[0.9rem] bg-secondary/45 p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] dark:bg-slate-900/[0.42]">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <Globe className="h-3.5 w-3.5 shrink-0" />
            <code className="truncate" title={provider.baseUrl}>{provider.baseUrl}</code>
          </div>
          <div className="flex min-w-0 items-center justify-between gap-2">
            <span className="shrink-0 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
              {t('providers.card.defaultModelLabel')}
            </span>
            {defaultModel ? (
              <code className="min-w-0 truncate rounded-full border border-border/65 bg-background/82 px-2.5 py-1 text-[11px] text-foreground dark:border-white/10 dark:bg-slate-950/[0.58]" title={defaultModel}>
                {defaultModel}
              </code>
            ) : (
              <span className="truncate text-[11px] text-muted-foreground">{t('providers.card.noDefault')}</span>
            )}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1.5 border-t border-border/45 pt-2">
          <Button variant="ghost" size="sm" onClick={onEdit} className="h-7 rounded-full px-2 text-[11px]">
            {t('providers.actions.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={onTest}
            disabled={isTesting}
            className="h-7 rounded-full px-2 text-[11px]"
          >
            {isTesting ? (
              <>
                <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                {t('common.actions.testingConnection')}
              </>
            ) : (
              t('providers.actions.test')
            )}
          </Button>
          <Button variant="ghost" size="sm" onClick={onDelete} className="h-7 rounded-full px-2 text-[11px] text-destructive hover:bg-destructive/10 hover:text-destructive">
            {t('providers.actions.delete')}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

function MetaPill({
  icon,
  label,
  value
}: {
  icon: ReactNode
  label: string
  value: string
}) {
  return (
    <div className="min-w-0 rounded-[0.8rem] bg-secondary/55 px-2.5 py-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.58)] dark:bg-slate-900/[0.5]">
      <div className="mb-1 flex min-w-0 items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <p className="truncate text-[12px] font-medium text-foreground" title={value}>{value}</p>
    </div>
  )
}
