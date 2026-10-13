import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
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
import { cn } from '@/lib/utils'
import type { GatewayConfig, ProviderConfig } from '@/types/providers'
import { PROVIDER_TYPE_OPTIONS, providerTypeLabel } from './ProviderDrawerSteps'
import { ProviderDetailPanel } from './ProviderDetailPanel'
import type { ProvidersState } from './useProvidersState'

interface ProvidersMasterDetailProps {
  providers: ProvidersState
  config: GatewayConfig | null
  configPending: boolean
  selectedProviderId: string | null
  onSelectProvider: (providerId: string) => void
  onTest: (provider: ProviderConfig) => void
  onRequestDelete: (provider: ProviderConfig) => void
}

/**
 * Providers view: left rail (search + type filter + provider rows) and the
 * inline-editing detail panel on the right. Replaces the old card grid +
 * multi-step drawer.
 */
export function ProvidersMasterDetail({
  providers,
  config,
  configPending,
  selectedProviderId,
  onSelectProvider,
  onTest,
  onRequestDelete
}: ProvidersMasterDetailProps) {
  const { t } = useTranslation()
  const {
    filteredProviders,
    providerSearch,
    setProviderSearch,
    providerTypeFilter,
    setProviderTypeFilter
  } = providers
  const providersLength = providers.providers.length

  const selectedProvider = useMemo(
    () => providers.providers.find((item) => item.id === selectedProviderId) ?? null,
    [providers.providers, selectedProviderId]
  )

  const renderRailRowMeta = (provider: ProviderConfig) => {
    const parts: string[] = []
    const modelCount = provider.models?.length ?? 0
    parts.push(t('providers.masterDetail.modelsMeta', { count: modelCount }))
    if (provider.type !== 'aggregate') {
      const keyCount = provider.keys?.length ?? 0
      parts.push(
        keyCount > 0
          ? t('providers.masterDetail.keysMeta', { count: keyCount })
          : t('providers.masterDetail.noKeysMeta')
      )
    }
    return parts.join(' · ')
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[300px_minmax(0,1fr)]">
      <Card className="h-fit overflow-hidden lg:sticky lg:top-4">
        <CardContent className="p-0">
          <div className="space-y-2 border-b border-border bg-secondary/50 px-3 py-3">
            <Input
              value={providerSearch}
              onChange={(event) => setProviderSearch(event.target.value)}
              placeholder={t('providers.filters.searchPlaceholder')}
              className="h-9"
            />
            <div className="flex items-center gap-2">
              <Select value={providerTypeFilter} onValueChange={setProviderTypeFilter}>
                <SelectTrigger className="h-9 flex-1 text-xs" aria-label={t('providers.table.type')}>
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
              <Badge variant="secondary" className="shrink-0 rounded-full px-2.5 py-1 text-[11px]">
                {filteredProviders.length}
              </Badge>
            </div>
          </div>

          {configPending ? (
            <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
              {t('common.loading')}
            </div>
          ) : providersLength === 0 ? (
            <div className="p-4">
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
            </div>
          ) : filteredProviders.length === 0 ? (
            <div className="p-4">
              <PageState compact title={t('providers.emptyFiltered')} />
            </div>
          ) : (
            <ul className="max-h-[60vh] overflow-y-auto p-2 lg:max-h-[calc(100vh-320px)]">
              {filteredProviders.map((provider) => {
                const active = provider.id === selectedProviderId
                return (
                  <li key={provider.id}>
                    <button
                      type="button"
                      onClick={() => onSelectProvider(provider.id)}
                      aria-current={active ? 'true' : undefined}
                      className={cn(
                        'motion-surface w-full border border-transparent px-3 py-2.5 text-left',
                        active
                          ? 'border-primary/40 bg-primary/5'
                          : 'hover:bg-muted/40'
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-medium">
                          {provider.label || provider.id}
                        </span>
                        <Badge variant={active ? 'default' : 'secondary'} className="shrink-0 text-[10px]">
                          {providerTypeLabel(provider.type, t)}
                        </Badge>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {provider.id} · {renderRailRowMeta(provider)}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {configPending ? (
        <Card>
          <CardContent className="flex min-h-[240px] items-center justify-center text-sm text-muted-foreground">
            {t('common.loading')}
          </CardContent>
        </Card>
      ) : selectedProvider ? (
        <ProviderDetailPanel
          key={selectedProvider.id}
          provider={selectedProvider}
          allProviders={providers.providers}
          testResult={providers.testResults[selectedProvider.id] ?? null}
          testing={providers.testingProviderId === selectedProvider.id}
          onTest={onTest}
          onRequestDelete={onRequestDelete}
          onSubmit={providers.handleUpdateProvider}
        />
      ) : (
        <Card>
          <CardContent className="p-0">
            <PageState
              title={t('providers.masterDetail.emptyDetailTitle')}
              description={t('providers.masterDetail.emptyDetailHint')}
            />
          </CardContent>
        </Card>
      )}
    </div>
  )
}
