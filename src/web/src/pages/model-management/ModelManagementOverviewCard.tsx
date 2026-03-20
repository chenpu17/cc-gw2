import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'
import type { CustomEndpoint } from '@/types/endpoints'
import type { ConfirmAction, ManagementTab } from './shared'

function getProtocolLabel(protocol: string, t: (key: string) => string) {
  if (protocol === 'anthropic') return t('modelManagement.protocolAnthropic')
  if (protocol === 'openai-chat') return t('modelManagement.protocolOpenAIChat')
  if (protocol === 'openai-responses') return t('modelManagement.protocolOpenAIResponses')
  return t('modelManagement.protocolOpenAI')
}

export function ModelManagementOverviewCard({
  activeTab,
  activeTabInfo,
  customEndpoints,
  customTabs,
  isDirtyByEndpoint,
  onDeleteEndpoint,
  onEditEndpoint,
  onSelectTab,
  providerCount,
  systemTabs
}: {
  activeTab: string
  activeTabInfo: ManagementTab | null
  customEndpoints: CustomEndpoint[]
  customTabs: ManagementTab[]
  isDirtyByEndpoint: Record<string, boolean>
  onDeleteEndpoint: (action: ConfirmAction) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onSelectTab: (tabKey: string) => void
  providerCount: number
  systemTabs: ManagementTab[]
}) {
  const { t } = useTranslation()
  const dirtyCount = Object.values(isDirtyByEndpoint).filter(Boolean).length
  const totalEndpointCount = systemTabs.length - 1 + customTabs.length

  return (
    <Card className="overflow-hidden">
      <CardContent className="space-y-5 pt-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-primary/20 bg-accent text-primary">
                {t('modelManagement.tabs.providers')}
                {' · '}
                {providerCount}
              </Badge>
              <Badge variant="outline">
                {t('modelManagement.tabs.customEndpoint')}
                {' · '}
                {customTabs.length}
              </Badge>
              {dirtyCount > 0 ? (
                <Badge variant="warning">
                  {t('modelManagement.overview.unsavedCount', { count: dirtyCount })}
                </Badge>
              ) : (
                <Badge variant="success">{t('modelManagement.overview.synced')}</Badge>
              )}
            </div>
            <p className="text-sm font-semibold text-foreground">{activeTabInfo?.label}</p>
            <p className="text-sm text-muted-foreground">{activeTabInfo?.description}</p>
          </div>
          <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center">
            <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-xs text-muted-foreground">
              {customTabs.length > 0
                ? t('modelManagement.overview.headerWithCustom')
                : t('modelManagement.overview.headerWithoutCustom')}
            </div>
            <div className="rounded-lg border border-primary/20 bg-accent px-3 py-2 text-xs font-medium text-primary">
              {t('modelManagement.overview.routeWorkspacesStat')}
              {' · '}
              {totalEndpointCount}
            </div>
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-4">
          <WorkspaceStatCard label={t('modelManagement.overview.providersStat')} value={providerCount.toString()} helper={t('modelManagement.overview.providersStatHint')} />
          <WorkspaceStatCard label={t('modelManagement.overview.routeWorkspacesStat')} value={totalEndpointCount.toString()} helper={t('modelManagement.overview.routeWorkspacesStatHint')} />
          <WorkspaceStatCard label={t('modelManagement.overview.customEndpointsStat')} value={customTabs.length.toString()} helper={t('modelManagement.overview.customEndpointsStatHint')} />
          <WorkspaceStatCard label={t('modelManagement.overview.activeWorkspace')} value={activeTabInfo?.label ?? '-'} helper={activeTab === 'providers' ? t('modelManagement.overview.activeWorkspaceProvider') : t('modelManagement.overview.activeWorkspaceRouting')} />
        </div>

        <div className="grid gap-3 rounded-lg border border-border bg-secondary p-4 md:grid-cols-2">
          <SemanticsCard title={t('modelManagement.overview.resourceCardTitle')} description={t('modelManagement.overview.resourceCardDescription')} />
          <SemanticsCard title={t('modelManagement.overview.entryCardTitle')} description={t('modelManagement.overview.entryCardDescription')} />
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t('modelManagement.overview.providerAndSystem')}
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            {systemTabs.map((tab) => {
              const isActive = activeTab === tab.key
              const tabDirty = tab.key !== 'providers' && isDirtyByEndpoint[tab.key]
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onSelectTab(tab.key)}
                  className={cn(
                    'group flex min-h-[96px] flex-col justify-between rounded-lg border px-4 py-4 text-left transition-all',
                    isActive
                      ? 'border-primary/30 bg-accent'
                      : 'border-border bg-card hover:border-primary/20 hover:bg-accent/50'
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="space-y-0.5">
                      <span className={cn('text-base font-semibold', isActive ? 'text-primary' : 'text-foreground')}>
                        {tab.label}
                      </span>
                      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                        {tab.key === 'providers'
                          ? t('modelManagement.overview.providerPoolTag')
                          : t('modelManagement.overview.systemEndpointTag')}
                      </div>
                    </div>
                    {tabDirty ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
                  </div>
                  <span className="line-clamp-2 text-sm text-muted-foreground">{tab.description}</span>
                </button>
              )
            })}
          </div>
        </div>

        {customTabs.length > 0 ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {t('modelManagement.overview.customEndpoints')}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {t('modelManagement.overview.customEndpointsHint')}
                </p>
              </div>
            </div>
            <div className="overflow-x-auto pb-1">
              <div className="flex min-w-full snap-x gap-3">
                {customTabs.map((tab) => {
                  const isActive = activeTab === tab.key
                  const tabDirty = isDirtyByEndpoint[tab.key]
                  const endpoint = customEndpoints.find((item) => item.id === tab.key)
                  return (
                    <div
                      key={tab.key}
                      className={cn(
                        'group relative flex w-[260px] shrink-0 snap-start flex-col gap-3 rounded-lg border px-4 py-4 text-left transition-all',
                        isActive
                          ? 'border-primary/30 bg-accent'
                          : 'border-border bg-card hover:border-primary/20 hover:bg-accent/50'
                      )}
                    >
                      <button
                        type="button"
                        onClick={() => onSelectTab(tab.key)}
                        className="min-w-0 flex-1 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <span className={cn('truncate text-base font-semibold', isActive ? 'text-primary' : 'text-foreground')}>
                            {tab.label}
                          </span>
                          {tabDirty ? <span className="h-2 w-2 rounded-full bg-amber-500" /> : null}
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{tab.description}</p>
                      </button>
                      <div className="grid gap-2 sm:flex sm:items-start">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-full px-2 text-xs sm:w-auto"
                          disabled={!endpoint}
                          onClick={() => {
                            if (endpoint) {
                              onEditEndpoint(endpoint)
                            }
                          }}
                        >
                          {t('common.edit')}
                        </Button>
                        {tab.canDelete ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation()
                              if (endpoint) {
                                onDeleteEndpoint({
                                  kind: 'endpoint',
                                  endpoint
                                })
                              }
                            }}
                            className="flex h-7 w-full items-center justify-center rounded-full border border-transparent text-muted-foreground transition hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive sm:w-7"
                            title={t('common.delete')}
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        ) : null}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {(tab.protocols ?? []).map((protocol) => (
                          <Badge
                            key={`${tab.key}-${protocol}`}
                            variant="outline"
                            className="max-w-full truncate text-[11px]"
                          >
                            {getProtocolLabel(protocol, t)}
                          </Badge>
                        ))}
                        <Badge
                          variant={endpoint?.enabled === false ? 'secondary' : 'success'}
                          className="text-[11px]"
                        >
                          {endpoint?.enabled === false
                            ? t('modelManagement.overview.endpointDisabled')
                            : t('modelManagement.overview.endpointEnabled')}
                        </Badge>
                      </div>
                      {endpoint?.paths && endpoint.paths.length > 0 ? (
                        <div className="space-y-1 rounded-lg border border-border bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
                          {endpoint.paths.slice(0, 2).map((pathItem) => (
                            <div key={`${endpoint.id}-${pathItem.path}-${pathItem.protocol}`} className="truncate">
                              <span className="font-medium text-foreground">{pathItem.path}</span>
                              {' · '}
                              {getProtocolLabel(pathItem.protocol, t)}
                            </div>
                          ))}
                          {endpoint.paths.length > 2 ? (
                            <div>{t('modelManagement.overview.endpointMorePaths', { count: endpoint.paths.length - 2 })}</div>
                          ) : null}
                        </div>
                      ) : endpoint?.path ? (
                        <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
                          <span className="font-medium text-foreground">{endpoint.path}</span>
                          {' · '}
                          {getProtocolLabel(endpoint.protocol ?? 'anthropic', t)}
                        </div>
                      ) : null}
                      <div className="rounded-lg border border-border bg-secondary px-3 py-2 text-[11px] text-muted-foreground">
                        {tab.protocols?.length
                          ? t('modelManagement.overview.endpointProtocols', { count: tab.protocols.length })
                          : t('modelManagement.overview.endpointNoProtocol')}
                      </div>
                      {tab.canDelete ? null : (
                        <div className="text-[11px] text-muted-foreground">
                          {t('modelManagement.overview.endpointManagedExternally')}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function SemanticsCard({ description, title }: { description: string; title: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</p>
      <p className="mt-2 text-sm leading-6 text-foreground">{description}</p>
    </div>
  )
}

function WorkspaceStatCard({ helper, label, value }: { helper: string; label: string; value: string }) {
  return (
    <div className="rounded-lg border border-border bg-card px-4 py-3">
      <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</p>
      <p className="mt-2 truncate text-base font-semibold text-foreground">{value}</p>
      <p className="mt-1 text-xs text-muted-foreground">{helper}</p>
    </div>
  )
}
