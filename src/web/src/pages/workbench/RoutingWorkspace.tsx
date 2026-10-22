import { useTranslation } from 'react-i18next'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig } from '@/types/providers'
import { EndpointConfigCard } from './EndpointConfigCard'
import { RoutingDefaultsCard } from './RoutingDefaultsCard'
import { RoutingEndpointRail } from './RoutingEndpointRail'
import { RoutingFlowBanner } from './RoutingFlowBanner'
import { RoutingRulesList } from './RoutingRulesList'
import { RoutingSimulator } from './RoutingSimulator'
import type { RoutingState } from './useRoutingState'

/**
 * Routing page workspace. lg+: three columns — endpoint rail (1), main
 * (2fr) = default forwarding + draggable model-route rules, side (1fr,
 * sticky) = hit simulator + endpoint config. Below lg the rail is hidden and
 * the toolbar Select (EndpointSwitcher) is the fallback. Templates stay a
 * toolbar dialog on every viewport.
 */
export function RoutingWorkspace({
  routing,
  config,
  customEndpoints,
  routeCounts,
  selectedEndpointId,
  onSelectEndpoint,
  onEditEndpoint,
  onDeleteEndpoint
}: {
  routing: RoutingState
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  routeCounts: Record<string, number>
  selectedEndpointId: string | null
  onSelectEndpoint: (endpointId: string) => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
}) {
  useTranslation()
  const endpoint = selectedEndpointId ?? routing.endpointTabs[0]?.key ?? 'anthropic'
  const tabInfo = routing.endpointTabs.find((tab) => tab.key === endpoint)
  const defaults = routing.defaultsByEndpoint[endpoint]
  const hasUnsavedChanges =
    Boolean(routing.isDirtyByEndpoint[endpoint]) || Boolean(routing.isDefaultsDirtyByEndpoint[endpoint])

  const endpointPath = (() => {
    if (endpoint === 'anthropic') return '/anthropic'
    if (endpoint === 'openai') return '/openai'
    const custom = customEndpoints.find((item) => item.id === endpoint)
    if (custom?.paths?.length) return custom.paths[0].path
    if (custom?.path) return custom.path
    return `/${endpoint}`
  })()

  return (
    <div data-testid="routing-workspace" className="flex flex-col gap-3.5">
      <RoutingFlowBanner endpointPath={endpointPath} defaultTarget={defaults?.completion ?? null} />
      <div className="grid items-start gap-3.5 lg:grid-cols-[210px_minmax(0,2fr)_minmax(0,1fr)]">
        <RoutingEndpointRail
          tabs={routing.endpointTabs}
          customEndpoints={customEndpoints}
          routeCounts={routeCounts}
          selectedEndpointId={selectedEndpointId}
          onSelect={onSelectEndpoint}
          onEditEndpoint={onEditEndpoint}
          onDeleteEndpoint={onDeleteEndpoint}
        />
        <div className="flex flex-col gap-3.5">
          <RoutingDefaultsCard routing={routing} endpoint={endpoint} />
          <RoutingRulesList routing={routing} endpoint={endpoint} tabInfo={tabInfo} />
        </div>

        <div className="flex flex-col gap-3.5 lg:sticky lg:top-4">
          <RoutingSimulator
            tabs={routing.endpointTabs}
            endpoint={endpoint}
            onEndpointChange={onSelectEndpoint}
            hasUnsavedChanges={hasUnsavedChanges}
          />
          <EndpointConfigCard routing={routing} endpoint={endpoint} tabInfo={tabInfo} config={config} customEndpoints={customEndpoints} />
        </div>
      </div>
    </div>
  )
}
