export type EndpointProtocol = 'anthropic' | 'openai-chat' | 'openai-responses' | 'openai-auto'

export interface DefaultsConfig {
  completion: string | null
  reasoning: string | null
  background: string | null
  longContextThreshold: number
}

export interface EndpointCompatibilityConfig {
  enabled: boolean
}

export interface ProtocolModelRoutes {
  anthropic?: Record<string, string>
  openai?: Record<string, string>
}

export interface EndpointRoutingConfig {
  defaults: DefaultsConfig
  modelRoutes: Record<string, string>
  /**
   * Protocol-family routes for unified endpoints — an Anthropic request and an
   * OpenAI request carrying the same source model can forward to different
   * targets. These take precedence over `modelRoutes`; "openai" covers both
   * Chat Completions and Responses.
   */
  modelRoutesByProtocol?: ProtocolModelRoutes
  compatibility?: EndpointCompatibilityConfig
}

export interface RoutingPreset {
  name: string
  modelRoutes: Record<string, string>
  modelRoutesByProtocol?: ProtocolModelRoutes
  createdAt: number
}

export interface EndpointPathConfig {
  path: string
  protocol: EndpointProtocol
}

export interface CustomEndpoint {
  id: string
  label: string
  deletable?: boolean
  // 新格式：支持多个路径
  paths?: EndpointPathConfig[]
  // 旧格式：向后兼容
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
  routingPresets?: RoutingPreset[]
}

export interface CustomEndpointsResponse {
  endpoints: CustomEndpoint[]
}

export interface CreateEndpointRequest {
  id: string
  label: string
  deletable?: boolean
  // 支持新旧两种格式
  paths?: EndpointPathConfig[]
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
}

export interface UpdateEndpointRequest {
  label?: string
  deletable?: boolean
  paths?: EndpointPathConfig[]
  path?: string
  protocol?: EndpointProtocol
  enabled?: boolean
  routing?: EndpointRoutingConfig
}

export interface EndpointResponse {
  success: boolean
  endpoint?: CustomEndpoint
  error?: string
}
