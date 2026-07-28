import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'
import { type ManagementTab } from './shared'

/** Compact primary path shown for each endpoint in the rail. */
const BUILTIN_ENDPOINT_PATHS: Record<string, string> = {
  anthropic: '/anthropic',
  openai: '/openai'
}

function getEndpointPrimaryPath(endpoint: CustomEndpoint): string {
  if (endpoint.paths?.length) return endpoint.paths[0].path
  if (endpoint.path) return endpoint.path
  return `/${endpoint.id}`
}

interface RailRow {
  key: string
  label: string
  path: string
  protocols: EndpointProtocol[]
  enabled: boolean
  custom?: CustomEndpoint
}

/**
 * Column-1 endpoint rail. Each endpoint is a selectable button (label + path +
 * rule count); custom endpoints gain inline edit/delete actions. Replaces the
 * old endpoint table — clicking a row now SELECTS the endpoint (driving cols
 * 2+3) instead of opening a dialog. `data-testid="endpoint-row"` is preserved
 * on the row wrapper so the edit/delete buttons are reachable inside it.
 */
export function RoutingEndpointRail({
  tabs,
  customEndpoints,
  routeCounts,
  selectedEndpointId,
  onSelect,
  onCreate,
  onEditEndpoint,
  onDeleteEndpoint
}: {
  tabs: ManagementTab[]
  customEndpoints: CustomEndpoint[]
  routeCounts: Record<string, number>
  selectedEndpointId: string | null
  onSelect: (endpointId: string) => void
  onCreate: () => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
}) {
  const { t } = useTranslation()

  const rows: RailRow[] = tabs.map((tab) => {
    const custom = customEndpoints.find((endpoint) => endpoint.id === tab.key)
    if (!custom) {
      return {
        key: tab.key,
        label: tab.label,
        path: BUILTIN_ENDPOINT_PATHS[tab.key] ?? `/${tab.key}`,
        protocols: (tab.protocols ?? []) as EndpointProtocol[],
        enabled: true
      }
    }
    const pathSource = custom.paths ?? (custom.path ? [{ path: custom.path, protocol: custom.protocol ?? 'anthropic' }] : [])
    return {
      key: tab.key,
      label: custom.label || custom.id,
      path: getEndpointPrimaryPath(custom),
      protocols: [...new Set(pathSource.map((item) => item.protocol))] as EndpointProtocol[],
      enabled: custom.enabled !== false,
      custom
    }
  })

  return (
    <section
      data-testid="endpoint-rail"
      className="flex gap-2 overflow-x-auto border border-border bg-card shadow-[var(--surface-shadow)] lg:h-full lg:flex-col lg:overflow-visible"
    >
      <div className="hidden shrink-0 border-b border-border/60 px-3 py-2.5 lg:block">
        <h2 className="text-[12.5px] font-semibold">{t('workbench.endpointRail.title')}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('workbench.endpointRail.subtitle')}</p>
      </div>
      <div className="flex gap-1.5 p-2 lg:flex-col lg:gap-1">
        {rows.map((row) => {
          const isSelected = row.key === selectedEndpointId
          const count = routeCounts[row.key] ?? 0
          const disabled = !row.enabled
          return (
            <div
              key={row.key}
              data-testid="endpoint-row"
              className={cn(
                'flex shrink-0 items-stretch border transition-colors lg:shrink',
                isSelected ? 'border-primary/40 bg-primary/5' : 'border-border bg-card hover:bg-accent',
                disabled ? 'opacity-60' : ''
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(row.key)}
                className="flex min-w-0 flex-1 items-center gap-2 px-2.5 py-2 text-left"
              >
                <span
                  className={cn('h-1.5 w-1.5 shrink-0 rounded-full', isSelected ? 'bg-primary' : 'bg-muted-foreground/40')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[11.5px] font-medium" title={row.label}>
                    {row.label}
                  </span>
                  <span className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                    <span className="truncate font-mono">{row.path}</span>
                    <span aria-hidden>·</span>
                    <span className="shrink-0 tabular-nums">
                      {t('workbench.endpointRail.ruleCount', { count })}
                    </span>
                  </span>
                </span>
              </button>
              {row.custom ? (
                <div className="flex items-center gap-0.5 pr-1">
                  <button
                    type="button"
                    onClick={() => onEditEndpoint(row.custom!)}
                    className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-foreground"
                    title={t('common.edit')}
                    aria-label={t('common.edit')}
                  >
                    <Pencil className="h-3 w-3" aria-hidden />
                  </button>
                  {row.custom.deletable !== false ? (
                    <button
                      type="button"
                      onClick={() => onDeleteEndpoint(row.custom!)}
                      className="flex h-6 w-6 items-center justify-center text-muted-foreground hover:text-destructive"
                      title={t('common.delete')}
                      aria-label={t('common.delete')}
                    >
                      <Trash2 className="h-3 w-3" aria-hidden />
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
        <button
          type="button"
          data-testid="create-endpoint"
          onClick={onCreate}
          className="flex shrink-0 items-center justify-center border border-dashed border-border px-3 py-2 text-[11.5px] text-muted-foreground transition-colors hover:border-primary hover:text-primary lg:shrink"
        >
          + {t('workbench.endpointRail.add')}
        </button>
      </div>
    </section>
  )
}
