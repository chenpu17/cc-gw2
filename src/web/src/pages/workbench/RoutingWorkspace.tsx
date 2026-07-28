import { useTranslation } from 'react-i18next'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig, RoutingPreset } from '@/types/providers'
import { EndpointConfigCard } from './EndpointConfigCard'
import { RoutingDefaultsCard } from './RoutingDefaultsCard'
import { RoutingEndpointRail } from './RoutingEndpointRail'
import { RoutingFlowBanner } from './RoutingFlowBanner'
import { RoutingPresetsCard } from './RoutingPresetsCard'
import { RoutingRulesList } from './RoutingRulesList'
import { RoutingSimulator } from './RoutingSimulator'
import type { RoutingState } from './useRoutingState'

/**
 * Routing view of the providers workbench: a 3-column inline workspace (no
 * dialog). Col 1 = endpoint rail (selection drives the rest); col 2 = default
 * forwarding + draggable model-route rules + presets; col 3 = hit simulator +
 * endpoint config. Mirrors the redesign mockup's `isRouting` view.
 */
export function RoutingWorkspace({
  routing,
  config,
  customEndpoints,
  selectedEndpointId,
  routeCounts,
  onSelectEndpoint,
  onCreateEndpoint,
  onEditEndpoint,
  onDeleteEndpoint,
  onRequestDeletePreset
}: {
  routing: RoutingState
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  selectedEndpointId: string | null
  routeCounts: Record<string, number>
  onSelectEndpoint: (endpointId: string) => void
  onCreateEndpoint: () => void
  onEditEndpoint: (endpoint: CustomEndpoint) => void
  onDeleteEndpoint: (endpoint: CustomEndpoint) => void
  onRequestDeletePreset: (endpoint: string, preset: RoutingPreset) => void
}) {
  useTranslation()
  const endpoint = selectedEndpointId ?? routing.endpointTabs[0]?.key ?? 'anthropic'
  const tabInfo = routing.endpointTabs.find((tab) => tab.key === endpoint)
  const defaults = routing.defaultsByEndpoint[endpoint]

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
      <div className="grid items-start gap-3.5 lg:grid-cols-[200px_minmax(0,1fr)_288px]">
        <RoutingEndpointRail
          tabs={routing.endpointTabs}
          customEndpoints={customEndpoints}
          routeCounts={routeCounts}
          selectedEndpointId={endpoint}
          onSelect={onSelectEndpoint}
          onCreate={onCreateEndpoint}
          onEditEndpoint={onEditEndpoint}
          onDeleteEndpoint={onDeleteEndpoint}
        />

        <div className="flex flex-col gap-3.5">
          <RoutingDefaultsCard routing={routing} endpoint={endpoint} />
          <RoutingRulesList routing={routing} endpoint={endpoint} tabInfo={tabInfo} />
          <RoutingPresetsCard routing={routing} endpoint={endpoint} onRequestDeletePreset={onRequestDeletePreset} />
        </div>

        <div className="flex flex-col gap-3.5">
          <RoutingSimulator tabs={routing.endpointTabs} endpoint={endpoint} onEndpointChange={onSelectEndpoint} />
          <EndpointConfigCard routing={routing} endpoint={endpoint} tabInfo={tabInfo} config={config} customEndpoints={customEndpoints} />
        </div>
      </div>
    </div>
  )
}
