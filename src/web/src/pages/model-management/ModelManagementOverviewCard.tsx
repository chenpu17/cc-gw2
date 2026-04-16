import { ArrowDown, X } from 'lucide-react'
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
  customEndpoints,
  customTabs,
  isDirtyByEndpoint,
  onDeleteEndpoint,
  onEditEndpoint,
  onSelectTab,
  systemTabs
}: {
  activeTab: string
  customEndpoints: CustomEndpoint[]
  customTabs: ManagementTab[]
  isDirtyByEndpoint: Record<string, boolean>
  onDeleteEndpoint: (action: ConfirmAction) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onSelectTab: (tabKey: string) => void
  systemTabs: ManagementTab[]
}) {
  const { t } = useTranslation()
  const activeTabInfo = [...systemTabs, ...customTabs].find((tab) => tab.key === activeTab) ?? null

  return (
    <Card className="overflow-hidden rounded-[1.35rem] border border-white/70 bg-card/95 shadow-[0_22px_56px_-46px_rgba(15,23,42,0.22)]">
      <CardContent className="space-y-4 p-4 sm:p-5">
        <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.6fr)]">
          <div className="rounded-[1.1rem] bg-secondary/60 p-2.5">
            <div className="mb-2 flex items-center justify-between px-1">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
                {t('modelManagement.overview.providerAndSystem')}
              </p>
            </div>
            <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {systemTabs.map((tab) => {
              const isActive = activeTab === tab.key
              const tabDirty = tab.key !== 'providers' && isDirtyByEndpoint[tab.key]
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => onSelectTab(tab.key)}
                  aria-pressed={isActive}
                  className={cn(
                    'group flex min-h-[76px] flex-col justify-between rounded-[0.95rem] px-3 py-3 text-left transition-all',
                    isActive
                      ? 'bg-card text-foreground shadow-[0_14px_34px_-28px_rgba(15,23,42,0.3)] ring-1 ring-primary/10'
                      : 'bg-transparent text-muted-foreground hover:bg-card/58 hover:text-foreground'
                  )}
                >
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <span className="block truncate text-[15px] font-semibold text-foreground">
                        {tab.label}
                      </span>
                      <div className="mt-0.5 text-[10px] uppercase tracking-[0.14em] text-muted-foreground/70">
                        {tab.key === 'providers'
                          ? t('modelManagement.overview.providerPoolTag')
                          : t('modelManagement.overview.systemEndpointTag')}
                      </div>
                    </div>
                    {tabDirty ? <span className="mt-1 h-2.5 w-2.5 rounded-full bg-amber-500" /> : null}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-3">
                    <span className="line-clamp-1 text-xs text-muted-foreground/70">{tab.description}</span>
                    {isActive ? (
                      <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                        <ArrowDown className="h-3.5 w-3.5" />
                      </span>
                    ) : null}
                  </div>
                </button>
              )
            })}
            </div>
          </div>

          {activeTabInfo ? (
            <div className="flex min-h-[116px] flex-col justify-between rounded-[1.1rem] bg-[linear-gradient(135deg,hsl(var(--primary)/0.1),rgba(255,255,255,0.78))] p-4 ring-1 ring-primary/10 dark:bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(15,23,42,0.72))] dark:ring-white/10">
              <div className="flex items-center gap-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <ArrowDown className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/75">
                    Active workspace
                  </p>
                  <p className="truncate text-sm font-semibold text-foreground">{activeTabInfo.label}</p>
                </div>
              </div>
              <p className="mt-3 line-clamp-2 text-xs leading-5 text-muted-foreground">{activeTabInfo.description}</p>
            </div>
          ) : null}
        </div>

        {customTabs.length > 0 ? (
          <div className="space-y-2.5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/75">
              {t('modelManagement.overview.customEndpoints')}
            </p>
            <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
              {customTabs.map((tab) => {
                const isActive = activeTab === tab.key
                const tabDirty = isDirtyByEndpoint[tab.key]
                const endpoint = customEndpoints.find((item) => item.id === tab.key)
                return (
                  <div
                    key={tab.key}
                    className={cn(
                      'group relative flex min-w-0 flex-col gap-2.5 overflow-hidden rounded-[1.05rem] border px-3 py-3 text-left transition-all sm:px-3.5',
                      isActive
                        ? 'border-primary/20 bg-secondary/80 text-foreground shadow-[0_14px_34px_-30px_rgba(59,130,246,0.32)]'
                        : 'border-border/55 bg-background/42 hover:bg-secondary/50'
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => onSelectTab(tab.key)}
                      aria-pressed={isActive}
                      className="min-w-0 flex-1 text-left"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate text-sm font-semibold text-foreground sm:text-[15px]"
                          title={tab.label}
                        >
                          {tab.label}
                        </span>
                        {tabDirty ? <span className="h-2 w-2 rounded-full bg-amber-500" /> : null}
                      </div>
                      <div className="mt-1.5 flex items-end justify-between gap-3">
                        <p className="line-clamp-2 text-[11px] leading-4.5 text-muted-foreground/72 sm:line-clamp-1 sm:text-xs">
                          {tab.description}
                        </p>
                        {isActive ? (
                          <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
                            <ArrowDown className="h-3.5 w-3.5" />
                          </span>
                        ) : null}
                      </div>
                    </button>
                    <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                      <Badge
                        variant={endpoint?.enabled === false ? 'secondary' : 'success'}
                        className="rounded-full border-0 px-2 py-0.5 text-[10px]"
                      >
                        {endpoint?.enabled === false
                          ? t('modelManagement.overview.endpointDisabled')
                          : t('modelManagement.overview.endpointEnabled')}
                      </Badge>
                      {(tab.protocols ?? []).slice(0, 2).map((protocol) => (
                        <Badge
                          key={`${tab.key}-${protocol}`}
                          variant="outline"
                          className="max-w-[130px] truncate rounded-full text-[10px]"
                          title={getProtocolLabel(protocol, t)}
                        >
                          {getProtocolLabel(protocol, t)}
                        </Badge>
                      ))}
                    </div>
                    <div className="min-w-0 rounded-[0.8rem] bg-secondary/55 px-2.5 py-2">
                      <p className="mb-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/70">
                        {t('modelManagement.overview.endpointPaths')}
                      </p>
                      <div className="space-y-1">
                        {getEndpointPathSummaries(endpoint, t).map((item) => (
                          <p key={item} className="truncate text-xs font-medium text-foreground" title={item}>
                            {item}
                          </p>
                        ))}
                      </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 justify-start rounded-full px-2 text-[11px]"
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
                          className="flex h-7 w-full items-center justify-center rounded-md text-muted-foreground transition hover:bg-destructive/10 hover:text-destructive sm:w-7"
                          title={t('common.delete')}
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {tab.canDelete ? null : (
                      <div className="text-[11px] text-muted-foreground/70">
                        {t('modelManagement.overview.endpointManagedExternally')}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}

function getEndpointPathSummaries(endpoint: CustomEndpoint | undefined, t: (key: string, options?: Record<string, unknown>) => string) {
  if (!endpoint) return [t('common.noData')]

  if (endpoint.paths?.length) {
    const paths = endpoint.paths.slice(0, 2).map((pathItem) => `${pathItem.path} · ${getProtocolLabel(pathItem.protocol, t)}`)
    if (endpoint.paths.length > 2) {
      paths.push(t('modelManagement.overview.endpointMorePaths', { count: endpoint.paths.length - 2 }))
    }
    return paths
  }

  if (endpoint.path) {
    return [`${endpoint.path} · ${getProtocolLabel(endpoint.protocol ?? 'anthropic', t)}`]
  }

  return [t('common.noData')]
}
