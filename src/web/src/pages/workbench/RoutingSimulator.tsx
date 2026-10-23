import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { TFunction } from 'i18next'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useApiQuery } from '@/hooks/useApiQuery'
import { routingApi } from '@/services/routing'
import type { RouteMatchReason, RoutingSimulateResponse } from '@/types/routing'
import { getEndpointFamilies, type ManagementTab } from './shared'

const DEBOUNCE_MS = 350

function getReasonMeta(
  reason: RouteMatchReason,
  t: TFunction
): { label: string; tone: 'hit' | 'fallback'; detail?: string } {
  switch (reason.kind) {
    case 'modelRoute':
      return {
        label: reason.viaAlias
          ? t('workbench.hitSim.reasonModelRouteAlias')
          : t('workbench.hitSim.reasonModelRoute'),
        tone: 'hit'
      }
    case 'directMatch':
      return { label: t('workbench.hitSim.reasonDirectMatch'), tone: 'hit' }
    case 'thinkingDefault':
      return { label: t('workbench.hitSim.reasonThinkingDefault'), tone: 'hit' }
    case 'completionDefault':
      return { label: t('workbench.hitSim.reasonCompletionDefault'), tone: 'hit' }
    case 'longContextDefault':
      return {
        label: t('workbench.hitSim.reasonLongContext'),
        tone: 'hit',
        detail: t('workbench.hitSim.longContextDetail', {
          estimate: reason.tokenEstimate.toLocaleString(),
          threshold: reason.threshold.toLocaleString()
        })
      }
    case 'fallback':
      return { label: t('workbench.hitSim.reasonFallback'), tone: 'fallback' }
  }
  // Exhaustiveness guard: if RouteMatchReason gains a variant the switch above
  // doesn't handle, the `never` assignment fails to compile, forcing an update.
  // The return below only runs for a malformed runtime payload (unknown kind).
  const _exhaustive: never = reason
  void _exhaustive
  return { label: t('workbench.hitSim.reasonFallback'), tone: 'fallback' }
}

/**
 * Routing hit-simulator: type a client model name and see, in real time, which
 * route rule the gateway would match and where the request would be forwarded.
 * Read-only. Mirrors the "命中模拟" panel in the redesign mockup.
 */
export function RoutingSimulator({
  tabs,
  endpoint: endpointProp,
  onEndpointChange,
  hasUnsavedChanges = false
}: {
  tabs: ManagementTab[]
  endpoint?: string
  onEndpointChange?: (endpointId: string) => void
  hasUnsavedChanges?: boolean
}) {
  const { t } = useTranslation()
  // `providers` is a workbench tab, not a routable endpoint.
  const endpointTabs = tabs.filter((tab) => tab.key !== 'providers')

  const [internalEndpoint, setInternalEndpoint] = useState(endpointTabs[0]?.key ?? 'anthropic')
  const endpoint = endpointProp ?? internalEndpoint
  const setEndpoint = (next: string) => {
    if (endpointProp && onEndpointChange) onEndpointChange(next)
    else setInternalEndpoint(next)
  }
  const [model, setModel] = useState('')
  const [thinking, setThinking] = useState(false)
  const [debouncedModel, setDebouncedModel] = useState('')
  const endpointProtocols = endpointTabs.find((tab) => tab.key === endpoint)?.protocols
  // Which family the endpoint's first configured path belongs to. Used as the
  // simulator's default when both families are served; for single-family
  // endpoints the backend derives the protocol from the path itself.
  const firstPathFamily: 'anthropic' | 'openai' = endpointProtocols?.[0]?.startsWith('openai')
    ? 'openai'
    : 'anthropic'
  const [protocol, setProtocol] = useState<'anthropic' | 'openai'>(firstPathFamily)

  const isCustomEndpoint = endpoint !== 'anthropic' && endpoint !== 'openai'
  const families = getEndpointFamilies(endpointProtocols)
  // Unified endpoints accept both families; the route table branches by
  // family, so the simulator must let the operator pick which one to test.
  const showProtocol = isCustomEndpoint && families.anthropic && families.openai
  const simulatedProtocol = showProtocol ? protocol : undefined

  // Switching between endpoints resets the simulator to that endpoint's first
  // path family. Guarded by a ref so a parent re-render with a new `tabs`
  // identity cannot clobber the operator's selection.
  const lastEndpointRef = useRef(endpoint)
  useEffect(() => {
    if (lastEndpointRef.current === endpoint) return
    lastEndpointRef.current = endpoint
    const pathProtocols = tabs.find((tab) => tab.key === endpoint)?.protocols
    const nextFamilies = getEndpointFamilies(pathProtocols)
    if (!nextFamilies.anthropic || !nextFamilies.openai) return
    setProtocol(pathProtocols?.[0]?.startsWith('openai') ? 'openai' : 'anthropic')
  }, [endpoint, tabs])

  // 实时预览: 输入停顿后再查询,避免每次按键都打后端。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedModel(model.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [model])

  const { data, isFetching, error } = useApiQuery<RoutingSimulateResponse>(
    ['routing', 'simulate', endpoint, debouncedModel, thinking, simulatedProtocol ?? 'auto'],
    routingApi.simulateRequest({
      endpoint,
      model: debouncedModel || undefined,
      thinking,
      // Only unified endpoints need an explicit family; elsewhere the backend
      // mirrors the real proxy path (paths[0] / legacy protocol).
      protocol: simulatedProtocol
    }),
    { retry: false, refetchOnWindowFocus: false, staleTime: Infinity }
  )

  return (
    <section
      data-testid="routing-hit-simulator"
      className="space-y-3 rounded-lg border border-border bg-card p-4"
    >
      <div>
        <h2 className="text-sm font-semibold text-foreground">{t('workbench.hitSim.title')}</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">{t('workbench.hitSim.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        {endpointProp ? null : (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('workbench.hitSim.endpointLabel')}</span>
            <Select value={endpoint} onValueChange={setEndpoint}>
              <SelectTrigger className="h-8 w-[168px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {endpointTabs.map((tab) => (
                  <SelectItem key={tab.key} value={tab.key}>
                    {tab.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {showProtocol ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t('workbench.hitSim.protocolLabel')}</span>
            <Select
              value={protocol}
              onValueChange={(value) => setProtocol(value as 'anthropic' | 'openai')}
            >
              <SelectTrigger
                data-testid="simulator-protocol"
                className="h-8 w-[128px]"
                aria-label={t('workbench.hitSim.protocolLabel')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">{t('workbench.routing.scopeAnthropic')}</SelectItem>
                <SelectItem value="openai">{t('workbench.routing.scopeOpenai')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        ) : null}
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch
            checked={thinking}
            onCheckedChange={setThinking}
            aria-label={t('workbench.hitSim.thinking')}
          />
          {t('workbench.hitSim.thinking')}
        </label>
      </div>

      <Input
        value={model}
        onChange={(event) => setModel(event.target.value)}
        placeholder={t('workbench.hitSim.modelPlaceholder')}
        className="h-9 text-xs"
        spellCheck={false}
        autoComplete="off"
        aria-label={t('workbench.hitSim.modelPlaceholder')}
      />

      {/* Simulation runs against the persisted config on the gateway, so unsaved
          draft edits here are invisible to it. Say so instead of silently
          showing a result that contradicts the editor above. */}
      {hasUnsavedChanges ? (
        <p data-testid="simulator-unsaved-notice" className="text-[11px] text-warning">
          {t('workbench.hitSim.unsavedNotice')}
        </p>
      ) : null}

      <ResultArea
        result={data}
        loading={isFetching}
        errorMessage={error?.message ?? null}
        requestedModel={debouncedModel}
      />
    </section>
  )
}

function ResultArea({
  result,
  loading,
  errorMessage,
  requestedModel
}: {
  result?: RoutingSimulateResponse
  loading: boolean
  errorMessage: string | null
  requestedModel: string
}) {
  const { t } = useTranslation()

  if (errorMessage) {
    return (
      <p className="text-xs text-muted-foreground">
        {t('workbench.hitSim.errorPrefix')}: {errorMessage}
      </p>
    )
  }

  if (!result) {
    return loading ? (
      <div className="h-[72px] animate-pulse rounded-lg border border-border bg-secondary" />
    ) : (
      <p className="text-xs text-muted-foreground">{t('workbench.hitSim.empty')}</p>
    )
  }

  const meta = getReasonMeta(result.reason, t)
  const isFallback = meta.tone === 'fallback'
  const source = requestedModel || t('workbench.hitSim.anyModel')

  return (
    <div className="space-y-1.5">
      <div
        className={
          isFallback
            ? 'rounded-lg border border-border bg-secondary px-3 py-2.5'
            : 'rounded-lg border border-success bg-success-bg px-3 py-2.5'
        }
      >
        <div
          className={
            isFallback
              ? 'text-[11px] font-semibold text-warning'
              : 'text-[11px] font-semibold text-success'
          }
        >
          {meta.label}
        </div>
        <div className="mt-1 text-xs text-foreground">{source}</div>
        <div className="mt-1 text-xs text-muted-foreground">
          → {result.providerLabel}:{result.modelId}
        </div>
        {meta.detail ? (
          <div className="mt-1 text-[11px] text-muted-foreground">{meta.detail}</div>
        ) : null}
      </div>
      {(result.candidates?.length ?? 0) > 1 ? (
        <div className="rounded-lg border border-border bg-secondary/50 px-3 py-2.5">
          <div className="text-[11px] font-semibold text-muted-foreground">
            {t('providers.aggregate.simulator.candidatesTitle')}
          </div>
          <ol className="mt-1.5 space-y-1">
            {(result.candidates ?? []).map((candidate, index) => (
              <li key={`${candidate.providerId}:${candidate.modelId}`} className="flex items-center gap-2 text-xs">
                <span className="w-4 shrink-0 text-center text-[10.5px] tabular-nums text-muted-foreground">
                  {index + 1}
                </span>
                <span className="min-w-0 truncate font-mono text-foreground">
                  {candidate.providerLabel}:{candidate.modelId}
                </span>
                {index === 0 ? (
                  <span className="shrink-0 text-[10px] font-medium text-muted-foreground">
                    {t('providers.aggregate.simulator.primaryBadge')}
                  </span>
                ) : null}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {isFallback ? (
        <p className="text-[11px] text-muted-foreground">{t('workbench.hitSim.fallbackHint')}</p>
      ) : null}
    </div>
  )
}
