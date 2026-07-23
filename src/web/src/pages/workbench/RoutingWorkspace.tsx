import { useTranslation } from 'react-i18next'
import type { CustomEndpoint } from '@/types/endpoints'
import type { DefaultsConfig } from '@/types/providers'
import { RoutingEndpointsTable } from './RoutingEndpointsTable'
import type { ManagementTab } from './shared'

/**
 * Routing view of the providers workbench: a short guide on how client model
 * requests flow through the rules, plus the endpoint table. Route editing
 * happens in the route editor dialog opened from the table.
 */
export function RoutingWorkspace({
  tabs,
  customEndpoints,
  routeCounts,
  defaultsByEndpoint,
  onEditRoute,
  onEditEndpoint,
  onDeleteEndpoint
}: {
  tabs: ManagementTab[]
  customEndpoints: CustomEndpoint[]
  routeCounts: Record<string, number>
  defaultsByEndpoint: Record<string, DefaultsConfig | undefined>
  onEditRoute: (endpointId: string) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="space-y-4">
      <div className="space-y-1 rounded-lg border bg-card px-4 py-3 text-xs text-muted-foreground">
        <p>{t('workbench.routingGuide.flow')}</p>
        <p>{t('workbench.routingGuide.hint')}</p>
      </div>

      <RoutingEndpointsTable
        tabs={tabs}
        customEndpoints={customEndpoints}
        routeCounts={routeCounts}
        defaultsByEndpoint={defaultsByEndpoint}
        onEditRoute={onEditRoute}
        onEditEndpoint={onEditEndpoint}
        onDeleteEndpoint={onDeleteEndpoint}
      />
    </div>
  )
}
