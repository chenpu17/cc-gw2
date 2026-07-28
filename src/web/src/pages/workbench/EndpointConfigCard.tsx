import { useTranslation } from 'react-i18next'
import { cn } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig } from '@/types/providers'
import {
  CLAUDE_MODEL_SUGGESTIONS,
  OPENAI_MODEL_SUGGESTIONS,
  getEndpointCompatibility,
  type ManagementTab
} from './shared'
import type { RoutingState } from './useRoutingState'

/**
 * Column-3 endpoint config: OpenAI compatibility toggle (openai-protocol
 * endpoints only) and common-model suggestion chips that add a new rule.
 * Absorbs the compatibility + suggestions sections that used to live behind
 * the route editor's "高级" disclosure.
 */
export function EndpointConfigCard({
  routing,
  endpoint,
  tabInfo,
  config,
  customEndpoints
}: {
  routing: RoutingState
  endpoint: string
  tabInfo?: ManagementTab
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
}) {
  const { t } = useTranslation()
  const routes = routing.routesByEndpoint[endpoint] || []
  const savingRoute = routing.savingRouteFor === endpoint
  const savingCompat = routing.savingCompatibilityPolicy
  const writing = routing.writingEndpoint === endpoint

  const openaiProtocol = tabInfo?.protocols?.some((protocol) => protocol.startsWith('openai')) ?? endpoint === 'openai'
  const compatibility = getEndpointCompatibility(endpoint, config, customEndpoints)
  const compatibilityEnabled = openaiProtocol ? compatibility?.enabled ?? false : false
  const hasAnthropicProtocol = tabInfo?.protocols?.includes('anthropic') ?? endpoint === 'anthropic'
  const suggestions = hasAnthropicProtocol ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS
  const existingSources = new Set(routes.map((entry) => entry.source.trim()).filter(Boolean))

  return (
    <Card data-testid="endpoint-config-card" className="shadow-[var(--surface-shadow)]">
      <CardContent className="space-y-3 p-4">
        <h3 className="text-[12.5px] font-semibold">{t('workbench.endpointConfig.title')}</h3>

        {openaiProtocol ? (
          <div className="flex items-center justify-between gap-2 border border-border/60 bg-secondary/30 px-2.5 py-2">
            <div className="min-w-0 space-y-0.5">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('modelManagement.openaiCompatibility.toggleLabel')}
              </Label>
              <p className="text-[10.5px] text-muted-foreground">
                {compatibilityEnabled
                  ? t('modelManagement.openaiCompatibility.enabledHint')
                  : t('modelManagement.openaiCompatibility.disabledHint')}
              </p>
            </div>
            <Switch
              data-testid="compatibility-toggle"
              checked={compatibilityEnabled}
              onCheckedChange={(enabled) => void routing.handleCompatibilityEnabledChange(endpoint, enabled)}
              disabled={savingCompat || writing}
              aria-label={t('modelManagement.openaiCompatibility.toggleLabel')}
            />
          </div>
        ) : null}

        <div>
          <p className="mb-1.5 text-[11px] text-muted-foreground">{t('settings.routing.suggested')}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((model) => {
              const already = existingSources.has(model)
              return (
                <button
                  key={`${endpoint}-${model}`}
                  data-testid="suggestion-chip"
                  type="button"
                  onClick={() => routing.handleAddSuggestion(endpoint, model)}
                  disabled={savingRoute || already}
                  className={cn(
                    'h-6 border px-2 text-[10.5px] transition-colors',
                    already
                      ? 'border-border bg-secondary/40 text-muted-foreground/50'
                      : 'border-border bg-card hover:border-primary hover:text-primary'
                  )}
                >
                  {model}
                </button>
              )
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
