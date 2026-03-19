import type { CustomEndpoint } from '@/types/endpoints'
import type {
  EndpointRoutingConfig,
  GatewayConfig,
  ProviderConfig,
  ProviderModelConfig,
  RoutingPreset
} from '@/types/providers'

export interface ModelRouteEntry {
  id: string
  source: string
  target: string
}

export interface AnthropicHeaderOption {
  key: string
  value: string
  label: string
  description: string
}

export interface ManagementTab {
  key: string
  label: string
  description: string
  isSystem: boolean
  canDelete: boolean
  protocols?: string[]
}

export type Endpoint = string

export type ConfirmAction =
  | { kind: 'provider'; provider: ProviderConfig }
  | { kind: 'preset'; endpoint: string; preset: RoutingPreset }
  | { kind: 'endpoint'; endpoint: CustomEndpoint }

interface ManagedEndpointLike {
  id: string
  label?: string
  deletable?: boolean
  path?: string
  protocol?: string
  paths?: Array<{ path: string; protocol: string }>
  routing?: EndpointRoutingConfig
  routingPresets?: RoutingPreset[]
}

export const CLAUDE_MODEL_SUGGESTIONS = [
  'claude-sonnet-4-5-20250929',
  'claude-sonnet-4-5-20250929-thinking',
  'claude-sonnet-4-20250514',
  'claude-opus-4-1-20250805',
  'claude-opus-4-1-20250805-thinking',
  'claude-haiku-4-5-20251001',
  'claude-haiku-4-5-20251001-thinking',
  'claude-3-5-haiku-20241022'
]

export const OPENAI_MODEL_SUGGESTIONS = [
  'gpt-4o-mini',
  'gpt-4o',
  'o4-mini',
  'o4-large',
  'gpt-5-codex'
]

export function createEntryId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

function mapManagedEndpoints(config: GatewayConfig | null, fallback: ManagedEndpointLike[]): ManagedEndpointLike[] {
  return config?.customEndpoints?.length ? config.customEndpoints : fallback
}

export function mapRoutesToEntries(routes: Record<string, string> | undefined): ModelRouteEntry[] {
  if (!routes) return []
  return Object.entries(routes).map(([source, target]) => ({
    id: createEntryId(),
    source,
    target
  }))
}

export function deriveRoutesFromConfig(
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[]
): Record<string, ModelRouteEntry[]> {
  if (!config) return {}

  const result: Record<string, ModelRouteEntry[]> = {}
  const routing = config.endpointRouting ?? {}

  result.anthropic = mapRoutesToEntries(routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {})
  result.openai = mapRoutesToEntries(routing.openai?.modelRoutes ?? {})

  for (const endpoint of mapManagedEndpoints(config, customEndpoints)) {
    if (endpoint.routing?.modelRoutes) {
      result[endpoint.id] = mapRoutesToEntries(endpoint.routing.modelRoutes)
    } else {
      result[endpoint.id] = []
    }
  }

  return result
}

export function getSavedRoutesFromConfig(
  config: GatewayConfig,
  customEndpoints: ManagedEndpointLike[],
  endpoint: string
): Record<string, string> {
  const customEndpoint = mapManagedEndpoints(config, customEndpoints).find((item) => item.id === endpoint)
  if (customEndpoint) return customEndpoint.routing?.modelRoutes ?? {}

  const routing = config.endpointRouting ?? {}
  if (endpoint === 'anthropic') return routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {}
  if (endpoint === 'openai') return routing.openai?.modelRoutes ?? {}
  return {}
}

export function mapEntriesToRoutes(entries: ModelRouteEntry[]): Record<string, string> {
  const routes: Record<string, string> = {}
  for (const entry of entries) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source && target) {
      routes[source] = target
    }
  }
  return routes
}

export function areRouteEntriesDirty(entries: ModelRouteEntry[], saved: Record<string, string>): boolean {
  return JSON.stringify(mapEntriesToRoutes(entries)) !== JSON.stringify(saved)
}

export function isAnthropicEndpoint(endpoint: string, customEndpoints: ManagedEndpointLike[]): boolean {
  if (endpoint === 'anthropic') {
    return true
  }
  const customEndpoint = customEndpoints.find((item) => item.id === endpoint)
  if (!customEndpoint) {
    return false
  }
  if (customEndpoint.paths && customEndpoint.paths.length > 0) {
    return customEndpoint.paths.some((path) => path.protocol === 'anthropic')
  }
  return customEndpoint.protocol === 'anthropic'
}

export function getEndpointValidation(
  endpoint: string,
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[]
): { mode: string; allowExperimentalBlocks?: boolean } | undefined {
  if (!config) return undefined

  if (endpoint === 'anthropic' || endpoint === 'openai') {
    return config.endpointRouting?.[endpoint]?.validation
  }

  const customEndpoint = mapManagedEndpoints(config, customEndpoints).find((item) => item.id === endpoint)
  return customEndpoint?.routing?.validation
}

export function buildPresetsMap(
  config: GatewayConfig,
  customEndpoints: ManagedEndpointLike[]
): Record<string, RoutingPreset[]> {
  const presetsMap: Record<string, RoutingPreset[]> = {
    anthropic: config.routingPresets?.anthropic ?? [],
    openai: config.routingPresets?.openai ?? []
  }

  for (const endpoint of mapManagedEndpoints(config, customEndpoints)) {
    presetsMap[endpoint.id] = endpoint.routingPresets ?? []
  }

  return presetsMap
}

export function buildTabs(
  t: (key: string, options?: Record<string, unknown>) => string,
  customEndpoints: ManagedEndpointLike[]
): ManagementTab[] {
  const baseTabs: ManagementTab[] = [
    {
      key: 'providers',
      label: t('modelManagement.tabs.providers'),
      description: t('modelManagement.tabs.providersDesc'),
      isSystem: true,
      canDelete: false
    },
    {
      key: 'anthropic',
      label: t('modelManagement.tabs.anthropic'),
      description: t('modelManagement.tabs.anthropicDesc'),
      isSystem: true,
      canDelete: false,
      protocols: ['anthropic']
    },
    {
      key: 'openai',
      label: t('modelManagement.tabs.openai'),
      description: t('modelManagement.tabs.openaiDesc'),
      isSystem: true,
      canDelete: false,
      protocols: ['openai-auto', 'openai-chat', 'openai-responses']
    }
  ]

  const customTabs = customEndpoints.map((endpoint) => {
    let description = t('modelManagement.tabs.customEndpoint')
    let protocols: string[] = []

    if (endpoint.paths && endpoint.paths.length > 0) {
      description = `${t('modelManagement.tabs.customEndpoint')}: ${endpoint.paths
        .map((pathItem) => `${pathItem.path} (${pathItem.protocol})`)
        .join(', ')}`
      protocols = [...new Set(endpoint.paths.map((pathItem) => pathItem.protocol))]
    } else if (endpoint.path) {
      const protocol = endpoint.protocol || 'anthropic'
      description = `${t('modelManagement.tabs.customEndpoint')}: ${endpoint.path} (${protocol})`
      protocols = [protocol]
    }

    return {
      key: endpoint.id,
      label: endpoint.label || endpoint.id,
      description,
      isSystem: false,
      canDelete: endpoint.deletable !== false,
      protocols
    }
  })

  return [...baseTabs, ...customTabs]
}

export function resolveModelLabel(model: ProviderModelConfig): string {
  if (model.label && model.label.trim().length > 0) {
    return `${model.label} (${model.id})`
  }
  return model.id
}
