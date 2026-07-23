import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, Loader2 } from 'lucide-react'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig, ProviderConfig } from '@/types/providers'
import {
  findRoutesForProvider,
  type ManagementTab,
  type ProviderTestResult
} from './shared'
import { TestResultInline } from './TestResultInline'

/**
 * Detail dialog for the provider selected in the table: metadata, the latest
 * test result and the routing rules that reference this provider. Footer
 * actions: edit (opens the provider drawer), test connection, delete.
 */
export function ProviderDetailDialog({
  provider,
  defaultModel,
  config,
  customEndpoints,
  tabs,
  testResult,
  isTesting,
  onClose,
  onEdit,
  onTest,
  onDelete,
  onViewRoute,
  onAddRule
}: {
  provider: ProviderConfig | null
  defaultModel?: string
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  tabs: ManagementTab[]
  testResult: ProviderTestResult | null
  isTesting: boolean
  onClose: () => void
  onEdit: () => void
  onTest: () => void
  onDelete: () => void
  onViewRoute: (endpoint: string) => void
  onAddRule: () => void
}) {
  const { t } = useTranslation()
  const routeReferences = useMemo(
    () => (provider ? findRoutesForProvider(config, customEndpoints, provider.id) : []),
    [config, customEndpoints, provider]
  )
  const endpointLabel = (endpointId: string) =>
    tabs.find((tab) => tab.key === endpointId)?.label ?? endpointId

  if (!provider) return null

  const authMode = describeAuthMode(provider, t)
  const modelCount = provider.models?.length ?? 0

  return (
    <Dialog open onOpenChange={(isOpen) => !isOpen && onClose()}>
      <AppDialogContent className="max-w-xl">
        <AppDialogHeader>
          <div className="flex min-w-0 items-center gap-2">
            <DialogTitle className="truncate" title={provider.label || provider.id}>
              {provider.label || provider.id}
            </DialogTitle>
            <Badge variant={defaultModel ? 'success' : 'warning'} className="shrink-0 rounded-full px-2 py-0.5 text-[10px]">
              {defaultModel ? t('providers.status.ready') : t('providers.status.needsDefault')}
            </Badge>
          </div>
          <DialogDescription className="truncate font-mono text-xs">
            {provider.id}
          </DialogDescription>
        </AppDialogHeader>

        <AppDialogBody className="space-y-4">
          <div className="grid gap-2 rounded-xl bg-secondary/60 p-3 text-xs sm:grid-cols-2">
            <DetailItem label={t('providers.card.authMode')} value={authMode} />
            <DetailItem
              label={t('providers.card.modelsTitle')}
              value={modelCount > 0 ? t('providers.card.modelCount', { count: modelCount }) : t('providers.card.passthrough')}
            />
            <DetailItem label={t('providers.card.baseUrl')} value={provider.baseUrl} mono />
            <DetailItem
              label={t('providers.card.defaultModelLabel')}
              value={defaultModel ?? t('providers.card.noDefault')}
              mono={Boolean(defaultModel)}
            />
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
              {t('workbench.testResult.title')}
            </p>
            {testResult ? (
              <TestResultInline result={testResult} />
            ) : (
              <p className="rounded-lg bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                {t('workbench.testResult.never')}
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
              {t('workbench.detail.routesTitle')}
            </p>
            {routeReferences.length === 0 ? (
              <div className="space-y-2 rounded-lg bg-secondary/50 px-3 py-2">
                <p className="text-xs text-muted-foreground">
                  {t('workbench.detail.routesEmptyHint')}
                </p>
                <Button variant="outline" size="sm" className="h-7 text-xs" onClick={onAddRule}>
                  {t('workbench.detail.addRuleCta')}
                </Button>
              </div>
            ) : (
              <div className="space-y-1.5">
                {routeReferences.map((reference) => (
                  <button
                    key={`${reference.endpoint}-${reference.source}`}
                    type="button"
                    onClick={() => onViewRoute(reference.endpoint)}
                    title={t('workbench.detail.viewRoute')}
                    className="flex w-full min-w-0 items-center gap-2 rounded-lg bg-secondary/50 px-3 py-2 text-left text-xs transition-colors hover:bg-accent"
                  >
                    <Badge variant="outline" className="shrink-0 text-[10px]">
                      {endpointLabel(reference.endpoint)}
                    </Badge>
                    <code className="min-w-0 truncate text-foreground">{reference.source}</code>
                    <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                    <code className="min-w-0 truncate text-muted-foreground">{reference.target}</code>
                  </button>
                ))}
              </div>
            )}
          </div>
        </AppDialogBody>

        <AppDialogFooter className="sm:justify-between">
          <Button
            variant="outline"
            onClick={onDelete}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
          >
            {t('providers.actions.delete')}
          </Button>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={onTest} disabled={isTesting}>
              {isTesting ? (
                <>
                  <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />
                  {t('common.actions.testingConnection')}
                </>
              ) : (
                t('providers.actions.test')
              )}
            </Button>
            <Button onClick={onEdit}>
              {t('providers.actions.edit')}
            </Button>
          </div>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}

function DetailItem({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">{label}</p>
      {mono ? (
        <code className="block truncate text-foreground" title={value}>{value}</code>
      ) : (
        <p className="truncate text-foreground" title={value}>{value}</p>
      )}
    </div>
  )
}

function describeAuthMode(provider: ProviderConfig, t: (key: string) => string) {
  const effectiveAuthMode = provider.authMode ?? (provider.type === 'anthropic' ? 'authToken' : 'apiKey')
  if (effectiveAuthMode === 'authToken') return 'Bearer'
  if (effectiveAuthMode === 'xAuthToken') return 'X-Auth-Token'
  if (provider.type === 'anthropic') return 'X-API-Key'
  return t('providers.card.providerDefault')
}
