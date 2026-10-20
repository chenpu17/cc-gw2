import { useTranslation } from 'react-i18next'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig } from '@/types/providers'
import { EndpointConfigCard } from './EndpointConfigCard'
import { RoutingDefaultsCard } from './RoutingDefaultsCard'
import { RoutingFlowBanner } from './RoutingFlowBanner'
import { RoutingRulesList } from './RoutingRulesList'
import { RoutingSimulator } from './RoutingSimulator'
import type { RoutingState } from './useRoutingState'

/**
 * Routing page workspace: two columns. Main (2fr) = default forwarding +
 * draggable model-route rules; side (1fr, sticky) = hit simulator + endpoint
 * config. Endpoint switching and presets live in the page toolbar (switcher
 * Select / templates dialog) — the old col-1 rail and permanent presets card
 * are gone.
 */
export function RoutingWorkspace({
  routing,
  config,
  customEndpoints,
  selectedEndpointId,
  onSelectEndpoint
}: {
  routing: RoutingState
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  selectedEndpointId: string | null
  onSelectEndpoint: (endpointId: string) => void
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
      <div className="grid items-start gap-3.5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-3.5">
          <RoutingDefaultsCard routing={routing} endpoint={endpoint} />
          <RoutingRulesList routing={routing} endpoint={endpoint} tabInfo={tabInfo} />
        </div>

        <div className="flex flex-col gap-3.5 lg:sticky lg:top-4">
          <RoutingSimulator tabs={routing.endpointTabs} endpoint={endpoint} onEndpointChange={onSelectEndpoint} />
          <EndpointConfigCard routing={routing} endpoint={endpoint} tabInfo={tabInfo} config={config} customEndpoints={customEndpoints} />
        </div>
      </div>
    </div>
  )
}
