import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { ProviderConfig } from '@/types/providers'
import { resolveModelLabel } from './shared'

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
  onProviderTypeChange,
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
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="grid gap-3 rounded-lg border border-border bg-secondary p-4 sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_220px_auto]">
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('providers.filters.searchPlaceholder')}
            </Label>
            <Input
              value={providerSearch}
              onChange={(event) => onProviderSearchChange(event.target.value)}
              placeholder={t('providers.filters.searchPlaceholder')}
            />
          </div>
          <div className="space-y-2">
            <Label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
              {t('providers.filters.typeAll')}
            </Label>
            <Select value={providerTypeFilter} onValueChange={onProviderTypeChange}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('providers.filters.typeAll')}</SelectItem>
                <SelectItem value="openai">OpenAI</SelectItem>
                <SelectItem value="anthropic">Anthropic</SelectItem>
                <SelectItem value="deepseek">DeepSeek</SelectItem>
                <SelectItem value="huawei">Huawei</SelectItem>
                <SelectItem value="kimi">Kimi</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-end sm:col-span-2 xl:col-span-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              disabled={!providerSearch.trim() && providerTypeFilter === 'all'}
              className="w-full xl:w-auto"
            >
              {t('common.actions.reset')}
            </Button>
          </div>
        </div>

        {configPending ? (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-border bg-secondary text-sm text-muted-foreground">
            {t('common.loading')}
          </div>
        ) : providersLength === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            <p className="font-medium">{t('providers.emptyState')}</p>
            <p className="mt-2 text-xs">{t('providers.emptyStateSub', { default: '点击上方按钮添加您的第一个提供商' })}</p>
          </div>
        ) : filteredProviders.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-12 text-center text-sm text-muted-foreground">
            <p className="font-medium">{t('providers.emptyFiltered')}</p>
          </div>
        ) : (
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(280px,1fr))]">
            {filteredProviders.map((provider) => (
              <Card key={provider.id} className="flex flex-col overflow-hidden" data-testid="provider-card">
                <CardContent className="flex flex-1 flex-col gap-4 pt-6">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold tracking-[-0.02em]">{provider.label || provider.id}</h3>
                        {provider.type ? <TypeBadge type={provider.type} /> : null}
                      </div>
                      <p className="text-xs text-muted-foreground">ID: {provider.id}</p>
                      <code className="block max-w-full break-all rounded-lg border border-border bg-secondary px-2.5 py-1.5 text-[11px] text-muted-foreground">
                        {provider.baseUrl}
                      </code>
                    </div>
                    {provider.defaultModel ? (
                      <Badge variant="default" className="text-xs">
                        {defaultLabels.get(provider.id) ?? provider.defaultModel}
                      </Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">
                        {t('providers.card.noDefault')}
                      </Badge>
                    )}
                  </div>

                  <div className="grid gap-2 sm:grid-cols-3">
                    <ProviderMetaCard
                      label={t('providers.card.authMode')}
                      value={describeAuthMode(provider)}
                    />
                    <ProviderMetaCard
                      label={t('providers.card.modelsTitle')}
                      value={provider.models?.length
                        ? t('providers.card.modelCount', { count: provider.models.length })
                        : t('providers.card.passthrough')}
                    />
                    <ProviderMetaCard
                      label={t('providers.card.defaultModelLabel')}
                      value={provider.defaultModel
                        ? defaultLabels.get(provider.id) ?? provider.defaultModel
                        : t('providers.card.noDefault')}
                      truncate
                    />
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2">
                    <ProviderMetaCard
                      label="Routing readiness"
                      value={provider.defaultModel ? 'Ready' : 'Needs default'}
                    />
                    <ProviderMetaCard
                      label="Endpoint type"
                      value={provider.type ? provider.type : 'custom'}
                    />
                  </div>

                  <div className="space-y-2 rounded-lg border border-border bg-secondary p-3">
                    <Label className="text-xs uppercase tracking-[0.16em] text-muted-foreground">{t('providers.card.modelsTitle')}</Label>
                    {provider.models && provider.models.length > 0 ? (
                      <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                        {provider.models.map((model) => (
                          <Badge key={model.id} variant="outline" className="text-xs">
                            {resolveModelLabel(model)}
                          </Badge>
                        ))}
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">{t('providers.card.noModels')}</p>
                    )}
                  </div>

                  <div className="mt-auto grid gap-2 border-t border-border pt-4 sm:grid-cols-3">
                    <Button variant="default" size="sm" onClick={() => onOpenEdit(provider)} className="w-full">
                      {t('providers.actions.edit')}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => onTestConnection(provider)}
                      disabled={testingProviderId === provider.id}
                      className="w-full"
                    >
                      {testingProviderId === provider.id ? t('common.actions.testingConnection') : t('providers.actions.test')}
                    </Button>
                    <Button variant="destructive" size="sm" onClick={() => onRequestDelete(provider)} className="w-full">
                      {t('providers.actions.delete')}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ProviderMetaCard({ label, value, truncate }: { label: string; value: string; truncate?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-secondary px-3 py-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1 text-sm font-medium', truncate && 'truncate')}>{value}</p>
    </div>
  )
}

function TypeBadge({ type }: { type: NonNullable<ProviderConfig['type']> }) {
  const config: Record<NonNullable<ProviderConfig['type']>, { label: string; variant: 'default' | 'secondary' | 'success' | 'warning' | 'info' | 'purple' | 'pink' | 'outline' }> = {
    openai: { label: 'OpenAI', variant: 'success' },
    deepseek: { label: 'DeepSeek', variant: 'info' },
    huawei: { label: '华为云', variant: 'warning' },
    kimi: { label: 'Kimi', variant: 'purple' },
    anthropic: { label: 'Anthropic', variant: 'pink' },
    custom: { label: 'Custom', variant: 'secondary' }
  }
  const { label, variant } = config[type] || config.custom
  return <Badge variant={variant} className="text-xs">{label}</Badge>
}
