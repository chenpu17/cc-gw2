import { useTranslation } from 'react-i18next'
import { Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import type { CustomEndpoint } from '@/types/endpoints'
import type { ManagementTab } from './shared'

/**
 * Narrow-viewport endpoint selector: on lg+ the workspace's col-1 endpoint
 * rail (RoutingEndpointRail) is the primary navigation, so this Select is
 * hidden there; below lg the rail wouldn't fit and this takes over. Custom
 * endpoints keep their edit/delete affordances as icon buttons beside the
 * trigger — same behavior the rail rows have inline.
 */
export function EndpointSwitcher({
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
  selectedEndpointId: string
  onSelect: (endpointId: string) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
}) {
  const { t } = useTranslation()

  const selectedCustom = customEndpoints.find((endpoint) => endpoint.id === selectedEndpointId)
  const selectedLabel = selectedCustom
    ? selectedCustom.label || selectedCustom.id
    : tabs.find((tab) => tab.key === selectedEndpointId)?.label ?? selectedEndpointId

  return (
    <div className="flex items-center gap-1.5 lg:hidden">
      <Select value={selectedEndpointId} onValueChange={onSelect}>
        <SelectTrigger
          data-testid="routing-endpoint-switcher"
          aria-label={t('workbench.endpointSwitcher.label')}
          className="h-8 w-[230px] text-xs"
        >
          <SelectValue>{selectedLabel}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {tabs.map((tab) => {
            const custom = customEndpoints.find((endpoint) => endpoint.id === tab.key)
            const label = custom ? custom.label || custom.id : tab.label
            const count = routeCounts[tab.key] ?? 0
            return (
              <SelectItem key={tab.key} value={tab.key} className="text-xs">
                <span className="flex items-center gap-2">
                  <span className="truncate">{label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {t('workbench.endpointSwitcher.ruleCount', { count })}
                  </span>
                </span>
              </SelectItem>
            )
          })}
        </SelectContent>
      </Select>
      {selectedCustom ? (
        <>
          <Button
            variant="ghost"
            size="icon"
            data-testid="endpoint-edit"
            className="h-7 w-7"
            title={t('common.edit')}
            aria-label={t('common.edit')}
            onClick={() => onEditEndpoint(selectedCustom)}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
          </Button>
          {selectedCustom.deletable !== false ? (
            <Button
              variant="ghost"
              size="icon"
              data-testid="endpoint-delete"
              className="h-7 w-7 text-muted-foreground hover:text-destructive"
              title={t('common.delete')}
              aria-label={t('common.delete')}
              onClick={() => onDeleteEndpoint(selectedCustom)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
            </Button>
          ) : null}
        </>
      ) : null}
    </div>
  )
}
