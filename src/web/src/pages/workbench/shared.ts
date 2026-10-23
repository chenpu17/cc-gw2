import type { CustomEndpoint, EndpointProtocol } from '@/types/endpoints'
import type {
  DefaultsConfig,
  EndpointRoutingConfig,
  GatewayConfig,
  ProviderConfig,
  ProviderModelConfig,
  RoutingPreset
} from '@/types/providers'

/** Which route map a rule belongs to. `all` is the shared map; the other two
 * scope the rule to a protocol family, letting one unified endpoint branch the
 * same source model by protocol. */
export type RouteScope = 'all' | 'anthropic' | 'openai'

export const ROUTE_SCOPES: RouteScope[] = ['all', 'anthropic', 'openai']

export interface ModelRouteEntry {
  id: string
  source: string
  target: string
  scope: RouteScope
}

/** Saved routes for one endpoint, split the same way the backend stores them. */
export interface ScopedRouteMaps {
  all: Record<string, string>
  anthropic: Record<string, string>
  openai: Record<string, string>
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

/** Protocol badge label shared by the endpoint table and the route editor dialog header. */
export function getEndpointProtocolLabel(protocol: EndpointProtocol, t: (key: string) => string): string {
  if (protocol === 'anthropic') return t('modelManagement.protocolAnthropic')
  if (protocol === 'openai-chat') return t('modelManagement.protocolOpenAIChat')
  if (protocol === 'openai-responses') return t('modelManagement.protocolOpenAIResponses')
  return t('modelManagement.protocolOpenAI')
}

/** Protocol families an endpoint serves, derived from its configured path
 * protocols (`anthropic` / `openai-auto` / `openai-chat` / `openai-responses`).
 * A unified endpoint serves both and can use protocol-scoped route rules. */
export function getEndpointFamilies(protocols?: string[]): {
  anthropic: boolean
  openai: boolean
} {
  const list = protocols ?? []
  return {
    anthropic: list.includes('anthropic'),
    openai: list.some((protocol) => protocol.startsWith('openai'))
  }
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

export function mapRoutesToEntries(
  routes: Record<string, string> | undefined,
  scope: RouteScope = 'all'
): ModelRouteEntry[] {
  if (!routes) return []
  return Object.entries(routes).map(([source, target]) => ({
    id: createEntryId(),
    source,
    target,
    scope
  }))
}

export function deriveRoutesFromConfig(
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[]
): Record<string, ModelRouteEntry[]> {
  if (!config) return {}

  const result: Record<string, ModelRouteEntry[]> = {}
  const routing = config.endpointRouting ?? {}

  const systemEntries = (
    shared: Record<string, string> | undefined,
    byProtocol?: { anthropic?: Record<string, string>; openai?: Record<string, string> }
  ): ModelRouteEntry[] => [
    ...mapRoutesToEntries(shared, 'all'),
    ...mapRoutesToEntries(byProtocol?.anthropic, 'anthropic'),
    ...mapRoutesToEntries(byProtocol?.openai, 'openai')
  ]

  const anthropicRouting = routing.anthropic
  result.anthropic = systemEntries(
    anthropicRouting?.modelRoutes ?? config.modelRoutes ?? {},
    anthropicRouting?.modelRoutesByProtocol
  )
  result.openai = systemEntries(
    routing.openai?.modelRoutes ?? {},
    routing.openai?.modelRoutesByProtocol
  )

  for (const endpoint of mapManagedEndpoints(config, customEndpoints)) {
    const endpointRouting = endpoint.routing
    result[endpoint.id] = endpointRouting
      ? systemEntries(endpointRouting.modelRoutes, endpointRouting.modelRoutesByProtocol)
      : []
  }

  return result
}

export function getSavedRouteMapsFromConfig(
  config: GatewayConfig,
  customEndpoints: ManagedEndpointLike[],
  endpoint: string
): ScopedRouteMaps {
  const customEndpoint = mapManagedEndpoints(config, customEndpoints).find((item) => item.id === endpoint)
  if (customEndpoint) {
    return {
      all: customEndpoint.routing?.modelRoutes ?? {},
      anthropic: customEndpoint.routing?.modelRoutesByProtocol?.anthropic ?? {},
      openai: customEndpoint.routing?.modelRoutesByProtocol?.openai ?? {}
    }
  }

  const routing = config.endpointRouting ?? {}
  if (endpoint === 'anthropic') {
    return {
      all: routing.anthropic?.modelRoutes ?? config.modelRoutes ?? {},
      anthropic: routing.anthropic?.modelRoutesByProtocol?.anthropic ?? {},
      openai: routing.anthropic?.modelRoutesByProtocol?.openai ?? {}
    }
  }
  if (endpoint === 'openai') {
    return {
      all: routing.openai?.modelRoutes ?? {},
      anthropic: routing.openai?.modelRoutesByProtocol?.anthropic ?? {},
      openai: routing.openai?.modelRoutesByProtocol?.openai ?? {}
    }
  }
  return { all: {}, anthropic: {}, openai: {} }
}

/** Shared (`modelRoutes`) map only. Kept for callers that predate protocol
 * scoping (setup wizard counts); use {@link getSavedRouteMapsFromConfig} when
 * the protocol branch matters. */
export function getSavedRoutesFromConfig(
  config: GatewayConfig,
  customEndpoints: ManagedEndpointLike[],
  endpoint: string
): Record<string, string> {
  return getSavedRouteMapsFromConfig(config, customEndpoints, endpoint).all
}

/** Effective defaults for an endpoint. System endpoints fall back to the
 * global defaults; custom endpoints never inherit them — an unconfigured
 * custom endpoint has no defaults at all (the gateway rejects its requests
 * until routing is configured). */
export function getSavedDefaultsFromConfig(
  config: GatewayConfig,
  customEndpoints: ManagedEndpointLike[],
  endpoint: string
): DefaultsConfig {
  if (endpoint === 'anthropic' || endpoint === 'openai') {
    return config.endpointRouting?.[endpoint]?.defaults ?? config.defaults
  }

  const customEndpoint = mapManagedEndpoints(config, customEndpoints).find((item) => item.id === endpoint)
  return (
    customEndpoint?.routing?.defaults ?? {
      completion: null,
      reasoning: null,
      background: null,
      longContextThreshold: config.defaults.longContextThreshold
    }
  )
}

export function deriveDefaultsFromConfig(
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[]
): Record<string, DefaultsConfig> {
  if (!config) return {}

  const result: Record<string, DefaultsConfig> = {
    anthropic: getSavedDefaultsFromConfig(config, customEndpoints, 'anthropic'),
    openai: getSavedDefaultsFromConfig(config, customEndpoints, 'openai')
  }

  for (const endpoint of mapManagedEndpoints(config, customEndpoints)) {
    result[endpoint.id] = getSavedDefaultsFromConfig(config, customEndpoints, endpoint.id)
  }

  return result
}

export function mapEntriesToScopedRoutes(entries: ModelRouteEntry[]): ScopedRouteMaps {
  const routes: ScopedRouteMaps = { all: {}, anthropic: {}, openai: {} }
  for (const entry of entries) {
    const source = entry.source.trim()
    const target = entry.target.trim()
    if (source && target) {
      routes[entry.scope ?? 'all'][source] = target
    }
  }
  return routes
}

/** Stable signature of scoped routes for dirty comparison. Scope maps are
 * always compared in the same key order so only content/order changes count. */
export function scopedRoutesSignature(routes: ScopedRouteMaps): string {
  return JSON.stringify({
    all: routes.all ?? {},
    anthropic: routes.anthropic ?? {},
    openai: routes.openai ?? {}
  })
}

export function areRouteEntriesDirty(entries: ModelRouteEntry[], saved: ScopedRouteMaps): boolean {
  return scopedRoutesSignature(mapEntriesToScopedRoutes(entries)) !== scopedRoutesSignature(saved)
}

/** Flatten a preset's shared + protocol maps into display-ready rows. */
export function collectPresetRoutes(
  preset: Pick<RoutingPreset, 'modelRoutes' | 'modelRoutesByProtocol'>
): Array<{ source: string; target: string; scope: RouteScope }> {
  return [
    ...Object.entries(preset.modelRoutes ?? {}).map(([source, target]) => ({
      source,
      target,
      scope: 'all' as const
    })),
    ...Object.entries(preset.modelRoutesByProtocol?.anthropic ?? {}).map(([source, target]) => ({
      source,
      target,
      scope: 'anthropic' as const
    })),
    ...Object.entries(preset.modelRoutesByProtocol?.openai ?? {}).map(([source, target]) => ({
      source,
      target,
      scope: 'openai' as const
    }))
  ]
}

export function getRouteScopeLabel(scope: RouteScope, t: (key: string) => string): string {
  if (scope === 'anthropic') return t('workbench.routing.scopeAnthropic')
  if (scope === 'openai') return t('workbench.routing.scopeOpenai')
  return t('workbench.routing.scopeAll')
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

export function getEndpointCompatibility(
  endpoint: string,
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[]
): { enabled: boolean } | undefined {
  if (!config) return undefined

  if (endpoint === 'anthropic' || endpoint === 'openai') {
    return config.endpointRouting?.[endpoint]?.compatibility
  }

  const customEndpoint = mapManagedEndpoints(config, customEndpoints).find((item) => item.id === endpoint)
  return customEndpoint?.routing?.compatibility
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
      // One base path can serve several protocols (the editor stores one
      // `paths[]` entry per protocol); describe it once, not once per entry.
      const protocolsByPath = new Map<string, string[]>()
      for (const pathItem of endpoint.paths) {
        const protocolsForPath = protocolsByPath.get(pathItem.path) ?? []
        protocolsForPath.push(pathItem.protocol)
        protocolsByPath.set(pathItem.path, protocolsForPath)
      }
      description = `${t('modelManagement.tabs.customEndpoint')}: ${[...protocolsByPath.entries()]
        .map(([path, protocolsForPath]) => `${path} (${protocolsForPath.join(', ')})`)
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

export interface ProviderTestResult {
  ok: boolean
  status?: number
  statusText?: string
  durationMs?: number
  message?: string
  testedAt: number
}

export function routeTargetMatchesProvider(target: string, providerId: string): boolean {
  if (!target) return false
  const [targetProvider] = target.split(':')
  return targetProvider === providerId || target === providerId
}

export interface ProviderRouteReference {
  endpoint: string
  source: string
  target: string
}

export function findRoutesForProvider(
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[],
  providerId: string
): ProviderRouteReference[] {
  if (!config) return []

  const endpointIds = [
    'anthropic',
    'openai',
    ...mapManagedEndpoints(config, customEndpoints).map((endpoint) => endpoint.id)
  ]
  const references: ProviderRouteReference[] = []

  for (const endpoint of endpointIds) {
    const maps = getSavedRouteMapsFromConfig(config, customEndpoints, endpoint)
    for (const scope of ROUTE_SCOPES) {
      for (const [source, target] of Object.entries(maps[scope])) {
        if (routeTargetMatchesProvider(target, providerId)) {
          references.push({ endpoint, source, target })
        }
      }
    }
  }

  return references
}

export function countProviderRouteReferences(
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[],
  providerId: string
): number {
  return findRoutesForProvider(config, customEndpoints, providerId).length
}

export interface ProviderReferenceSummary {
  routes: number
  /** Default forwarding slots (completion/reasoning/background) pointing at it. */
  defaults: number
  /** Aggregate-model membership entries pointing at it. */
  aggregateMembers: number
}

/** Everything deleting a provider will implicitly rewrite in the config. */
export function summarizeProviderReferences(
  config: GatewayConfig | null,
  customEndpoints: ManagedEndpointLike[],
  providerId: string
): ProviderReferenceSummary {
  if (!config) return { routes: 0, defaults: 0, aggregateMembers: 0 }

  const endpointIds = [
    'anthropic',
    'openai',
    ...mapManagedEndpoints(config, customEndpoints).map((endpoint) => endpoint.id)
  ]

  let defaults = 0
  for (const endpoint of endpointIds) {
    const saved = getSavedDefaultsFromConfig(config, customEndpoints, endpoint)
    for (const target of [saved.completion, saved.reasoning, saved.background]) {
      if (target && routeTargetMatchesProvider(target, providerId)) defaults += 1
    }
  }

  let aggregateMembers = 0
  for (const provider of config.providers ?? []) {
    if (provider.type !== 'aggregate') continue
    for (const model of provider.models ?? []) {
      for (const member of model.members ?? []) {
        if (routeTargetMatchesProvider(member.target, providerId)) aggregateMembers += 1
      }
    }
  }

  return {
    routes: countProviderRouteReferences(config, customEndpoints, providerId),
    defaults,
    aggregateMembers
  }
}
