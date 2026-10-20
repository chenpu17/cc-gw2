import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { CustomEndpoint } from '@/types/endpoints'
import type { ManagementTab } from './shared'

interface RailRow {
  key: string
  label: string
  enabled: boolean
  custom?: CustomEndpoint
}

/**
 * Column-1 endpoint rail (lg+): every endpoint is a selectable row — status
 * dot, label, rule count — with inline edit/delete on custom endpoints, so
 * any endpoint is reachable in one click no matter how long the list grows.
 * Below lg the rail is hidden and the toolbar Select (EndpointSwitcher) takes
 * over as the narrow fallback.
 */
export function RoutingEndpointRail({
  tabs,
  customEndpoints,
  routeCounts,
  selectedEndpointId,
  onSelect,
  onEditEndpoint,
  onDeleteEndpoint
}: {
  tabs: ManagementTab[]
  customEndpoints: CustomEndpoint[]
  routeCounts: Record<string, number>
  selectedEndpointId: string | null
  onSelect: (endpointId: string) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
}) {
  const { t } = useTranslation()

  const rows: RailRow[] = tabs.map((tab) => {
    const custom = customEndpoints.find((endpoint) => endpoint.id === tab.key)
    if (!custom) {
      return { key: tab.key, label: tab.label, enabled: true }
    }
    return { key: tab.key, label: custom.label || custom.id, enabled: custom.enabled !== false, custom }
  })

  return (
    <aside
      data-testid="endpoint-rail"
      aria-label={t('workbench.endpointRail.title')}
      className="hidden lg:flex lg:sticky lg:top-4 flex-col gap-1 border border-border bg-card p-1.5 shadow-[var(--surface-shadow)] lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
    >
      <div className="px-2 pb-1 pt-2">
        <h2 className="text-[12.5px] font-semibold">{t('workbench.endpointRail.title')}</h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground">{t('workbench.endpointRail.subtitle')}</p>
      </div>
      {rows.map((row) => {
        const isSelected = row.key === selectedEndpointId
        const count = routeCounts[row.key] ?? 0
        const disabled = !row.enabled
        return (
          <div
            key={row.key}
            data-testid="routing-endpoint-row"
            className={cn(
              'flex items-stretch border transition-colors',
              isSelected ? 'border-foreground bg-secondary' : 'border-transparent hover:bg-accent',
              disabled ? 'opacity-60' : ''
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(row.key)}
              aria-current={isSelected ? 'true' : undefined}
              className="flex min-w-0 flex-1 items-center gap-2 px-2 py-2 text-left"
            >
              <span
                className={cn(
                  'h-1.5 w-1.5 shrink-0 rounded-full',
                  disabled ? 'bg-muted-foreground/30' : isSelected ? 'bg-foreground' : 'bg-muted-foreground/50'
                )}
                aria-hidden
              />
              <span className="min-w-0 flex-1 truncate text-xs font-medium" title={row.label}>
                {row.label}
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                {t('workbench.endpointRail.ruleCount', { count })}
              </span>
            </button>
            {row.custom ? (
              <div className="flex items-center gap-0.5 pr-1">
                <button
                  type="button"
                  data-testid="endpoint-edit"
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
                    data-testid="endpoint-delete"
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
    </aside>
  )
}
