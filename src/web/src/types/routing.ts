/**
 * Routing hit-simulation contract — mirrors the `RouteMatchReason` enum and
 * `RoutingSimulateResponse` from `cc-gw-core::routing` / the
 * `POST /api/routing/simulate` admin handler. Variant names and struct-variant
 * fields are both camelCase on the wire.
 */
export type RouteMatchReason =
  | { kind: 'modelRoute'; viaAlias: boolean }
  | { kind: 'directMatch' }
  | { kind: 'thinkingDefault' }
  | { kind: 'longContextDefault'; tokenEstimate: number; threshold: number }
  | { kind: 'completionDefault' }
  | { kind: 'fallback' }

export interface RoutingSimulateRequest {
  /** `"anthropic"` | `"openai"` | a custom-endpoint id */
  endpoint: string
  model?: string
  thinking?: boolean
  /** Optional request body; used only for the long-context token estimate. */
  body?: unknown
}

export interface RoutingSimulateResponse {
  providerId: string
  providerLabel: string
  modelId: string
  reason: RouteMatchReason
}
