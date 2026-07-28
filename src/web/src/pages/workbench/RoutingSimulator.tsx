import { useEffect, useState } from 'react'
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
import type { ManagementTab } from './shared'

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
  onEndpointChange
}: {
  tabs: ManagementTab[]
  endpoint?: string
  onEndpointChange?: (endpointId: string) => void
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

  // 实时预览: 输入停顿后再查询,避免每次按键都打后端。
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedModel(model.trim()), DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [model])

  const { data, isFetching, error } = useApiQuery<RoutingSimulateResponse>(
    ['routing', 'simulate', endpoint, debouncedModel, thinking],
    routingApi.simulateRequest({
      endpoint,
      model: debouncedModel || undefined,
      thinking
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
      {isFallback ? (
        <p className="text-[11px] text-muted-foreground">{t('workbench.hitSim.fallbackHint')}</p>
      ) : null}
    </div>
  )
}
