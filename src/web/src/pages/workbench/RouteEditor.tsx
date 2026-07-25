import { useEffect, useRef, useState } from 'react'
import { ArrowRight, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { PageState } from '@/components/PageState'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CustomEndpoint } from '@/types/endpoints'
import type { DefaultsConfig, GatewayConfig, RoutingPreset } from '@/types/providers'
import { TargetCombobox } from './TargetCombobox'
import {
  getEndpointCompatibility,
  CLAUDE_MODEL_SUGGESTIONS,
  OPENAI_MODEL_SUGGESTIONS,
  type ManagementTab,
  type ModelRouteEntry
} from './shared'

export interface RouteEditorProps {
  endpoint: string
  tabInfo?: ManagementTab
  config: GatewayConfig | null
  customEndpoints: CustomEndpoint[]
  routes: ModelRouteEntry[]
  routeError?: string | null
  savingRoute: boolean
  isDirty: boolean
  defaults: DefaultsConfig | null
  defaultsDirty: boolean
  savingDefaults: boolean
  presets: RoutingPreset[]
  presetName: string
  presetError?: string | null
  savingPreset: boolean
  applyingPreset: string | null
  deletingPreset: string | null
  presetsExpanded: boolean
  savingCompatibilityPolicy: boolean
  writing: boolean
  providerModelOptions: Array<{ value: string; label: string }>
  onDefaultsChange: (field: keyof DefaultsConfig, value: string | number | null) => void
  onSaveDefaults: () => void
  onTogglePresetsExpanded: () => void
  onPresetNameChange: (value: string) => void
  onSavePreset: () => void
  onRequestPresetDiff: (preset: RoutingPreset) => void
  onRequestDeletePreset: (preset: RoutingPreset) => void
  onCompatibilityEnabledChange: (enabled: boolean) => void
  onRouteChange: (id: string, field: 'source' | 'target', value: string) => void
  onRemoveRoute: (id: string) => void
  onAddSuggestion: (model: string) => void
  onAddRoute: () => void
  onResetRoutes: () => void
  onSaveRoutes: () => void
}

/**
 * Per-endpoint routing editor: default forwarding, model-specific rules and
 * the advanced section (presets, OpenAI compatibility, wildcard semantics).
 * Rendered inside the route editor dialog from the routing view's endpoint
 * table.
 */
export function RouteEditor({
  endpoint,
  tabInfo,
  config,
  customEndpoints,
  routes,
  routeError,
  savingRoute,
  isDirty,
  defaults,
  defaultsDirty,
  savingDefaults,
  presets,
  presetName,
  presetError,
  savingPreset,
  applyingPreset,
  deletingPreset,
  presetsExpanded,
  savingCompatibilityPolicy,
  writing,
  providerModelOptions,
  onDefaultsChange,
  onSaveDefaults,
  onTogglePresetsExpanded,
  onPresetNameChange,
  onSavePreset,
  onRequestPresetDiff,
  onRequestDeletePreset,
  onCompatibilityEnabledChange,
  onRouteChange,
  onRemoveRoute,
  onAddSuggestion,
  onAddRoute,
  onResetRoutes,
  onSaveRoutes
}: RouteEditorProps) {
  const { t } = useTranslation()
  const hasAnthropicProtocol = tabInfo?.protocols?.includes('anthropic') ?? (endpoint === 'anthropic')
  const suggestions = hasAnthropicProtocol ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS
  const sourceListId = `route-source-${endpoint}`
  const openaiProtocol = tabInfo?.protocols?.some((protocol) => protocol.startsWith('openai')) ?? (endpoint === 'openai')
  const compatibility = getEndpointCompatibility(endpoint, config, customEndpoints)
  const compatibilityEnabled = openaiProtocol ? (compatibility?.enabled ?? false) : false
  const existingSources = new Set(routes.map((entry) => entry.source.trim()).filter(Boolean))
  const [suggestionsOpen, setSuggestionsOpen] = useState(false)
  const sourceInputRefs = useRef(new Map<string, HTMLInputElement>())
  const focusNextNewRouteRef = useRef(false)

  const handleAddFirstRoute = () => {
    focusNextNewRouteRef.current = true
    onAddRoute()
  }

  useEffect(() => {
    if (!focusNextNewRouteRef.current) return
    const lastEntry = routes[routes.length - 1]
    if (!lastEntry) return
    const input = sourceInputRefs.current.get(lastEntry.id)
    if (!input) return
    focusNextNewRouteRef.current = false
    input.focus()
  }, [routes])
  const policyBadge = compatibilityEnabled
    ? <Badge variant="secondary" className="text-[11px]">{t('modelManagement.openaiCompatibility.toggleLabel')}</Badge>
    : null

  const presetsSection = (
    <RoutingPresetsSection
      presets={presets}
      presetName={presetName}
      presetError={presetError}
      savingPreset={savingPreset}
      applyingPreset={applyingPreset}
      deletingPreset={deletingPreset}
      writing={writing}
      expanded={presetsExpanded}
      onToggleExpanded={onTogglePresetsExpanded}
      onPresetNameChange={onPresetNameChange}
      onSavePreset={onSavePreset}
      onRequestPresetDiff={onRequestPresetDiff}
      onRequestDeletePreset={onRequestDeletePreset}
    />
  )

  const compatibilitySection = openaiProtocol ? (
    <Disclosure
      variant="card"
      summary={<span className="text-sm font-medium text-primary">{t('modelManagement.openaiCompatibility.title')}</span>}
      badge={policyBadge}
      summaryClassName="px-4 py-3"
      contentClassName="space-y-5 border-t border-border px-4 py-4"
    >
      <div className="space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-primary">
            {t('modelManagement.openaiCompatibility.title')}
          </p>
          <p className="max-w-2xl text-xs leading-5 text-muted-foreground">
            {t('modelManagement.openaiCompatibility.description')}
          </p>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-primary/15 bg-card px-3 py-2">
          <div className="space-y-1">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-primary/70">
              {t('modelManagement.openaiCompatibility.toggleLabel')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {compatibilityEnabled
                ? t('modelManagement.openaiCompatibility.enabledHint')
                : t('modelManagement.openaiCompatibility.disabledHint')}
            </p>
          </div>
          <Switch
            checked={compatibilityEnabled}
            onCheckedChange={onCompatibilityEnabledChange}
            disabled={savingCompatibilityPolicy || writing}
            aria-label={t('modelManagement.openaiCompatibility.toggleLabel')}
          />
        </div>
      </div>
    </Disclosure>
  ) : null

  return (
    <div className="space-y-4">
    {/* 1. Default forwarding — where every request that matches no rule below goes */}
    <Card>
      <CardContent className="space-y-4 pt-6">
        <div className="space-y-1">
          <h3 className="text-base font-semibold text-foreground">{t('workbench.defaults.title')}</h3>
          <p className="text-xs text-muted-foreground">{t('workbench.defaults.description')}</p>
        </div>

        <div className="space-y-1.5">
          <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {t('workbench.defaults.completionLabel')}
          </Label>
          <TargetCombobox
            value={defaults?.completion ?? ''}
            onChange={(value) => onDefaultsChange('completion', value)}
            options={providerModelOptions}
            disabled={savingDefaults}
            ariaLabel={t('workbench.defaults.completionLabel')}
            placeholder={t('workbench.defaults.targetPlaceholder')}
          />
        </div>

        <Disclosure
          summary={(
            <span className="text-xs font-medium text-muted-foreground">{t('workbench.defaults.moreLabel')}</span>
          )}
          summaryClassName="px-0 py-1"
          contentClassName="mt-3 space-y-4"
        >
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('workbench.defaults.reasoningLabel')}
              </Label>
              <TargetCombobox
                value={defaults?.reasoning ?? ''}
                onChange={(value) => onDefaultsChange('reasoning', value)}
                options={providerModelOptions}
                disabled={savingDefaults}
                ariaLabel={t('workbench.defaults.reasoningLabel')}
                placeholder={t('workbench.defaults.targetPlaceholder')}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                {t('workbench.defaults.backgroundLabel')}
              </Label>
              <TargetCombobox
                value={defaults?.background ?? ''}
                onChange={(value) => onDefaultsChange('background', value)}
                options={providerModelOptions}
                disabled={savingDefaults}
                ariaLabel={t('workbench.defaults.backgroundLabel')}
                placeholder={t('workbench.defaults.targetPlaceholder')}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              {t('workbench.defaults.thresholdLabel')}
            </Label>
            <Input
              type="number"
              min={1}
              value={defaults?.longContextThreshold ?? ''}
              onChange={(event) => {
                const parsed = Number.parseInt(event.target.value, 10)
                onDefaultsChange('longContextThreshold', Number.isFinite(parsed) ? parsed : 0)
              }}
              disabled={savingDefaults}
              className="md:w-56"
            />
          </div>
        </Disclosure>

        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {defaultsDirty ? t('modelManagement.actions.footerDirtyHint') : t('modelManagement.actions.footerSavedHint')}
          </p>
          <Button size="sm" onClick={onSaveDefaults} disabled={savingDefaults || !defaultsDirty || writing} className="relative">
            {savingDefaults ? t('common.actions.saving') : t('workbench.defaults.save')}
            {defaultsDirty ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" /> : null}
          </Button>
        </div>
      </CardContent>
    </Card>

    {/* 2. Model-specific exceptions — only exact client model names hit these rules */}
    <Card>
      <CardContent className="space-y-6 pt-6">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold text-foreground">{t('workbench.specific.title')}</h3>
            <Badge variant="outline">{routes.length} active</Badge>
          </div>
          <p className="text-xs text-muted-foreground">{t('workbench.specific.description')}</p>
        </div>

        {routeError ? <p className="text-sm text-destructive">{routeError}</p> : null}

        <div className="space-y-3 rounded-xl bg-secondary/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm font-semibold text-foreground">{t('workbench.routing.rulesTitle')}</Label>
            </div>
          </div>

          {routes.length === 0 ? (
            <PageState
              compact
              title={t('workbench.routing.emptyTitle')}
              description={t('workbench.routing.emptyDescription')}
              action={(
                <Button size="sm" onClick={handleAddFirstRoute} disabled={savingRoute}>
                  {t('workbench.routing.addFirst')}
                </Button>
              )}
            />
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-1 text-xs font-medium text-muted-foreground md:grid">
                <span>{t('workbench.routing.sourceLabel')}</span>
                <span />
                <span>{t('workbench.routing.targetLabel')}</span>
                <span />
              </div>
              {routes.map((entry, index) => (
                <div key={entry.id} className="rounded-xl bg-card p-3 shadow-sm">
                  <div className="mb-3 flex items-center justify-between md:hidden">
                    <Badge variant="outline" className="text-[11px]">
                      #{index + 1}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => onRemoveRoute(entry.id)}
                      disabled={savingRoute}
                      aria-label={t('common.delete')}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center">
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                        {t('workbench.routing.sourceLabel')}
                      </Label>
                      <Input
                        ref={(element) => {
                          if (element) {
                            sourceInputRefs.current.set(entry.id, element)
                          } else {
                            sourceInputRefs.current.delete(entry.id)
                          }
                        }}
                        value={entry.source}
                        onChange={(event) => onRouteChange(entry.id, 'source', event.target.value)}
                        placeholder={t('settings.routing.sourcePlaceholder')}
                        list={sourceListId}
                        disabled={savingRoute}
                        aria-label={`route-source-${index + 1}`}
                      />
                    </div>
                    <ArrowRight className="hidden h-4 w-4 flex-shrink-0 text-muted-foreground md:block" />
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                        {t('workbench.routing.targetLabel')}
                      </Label>
                      <TargetCombobox
                        value={entry.target}
                        onChange={(value) => onRouteChange(entry.id, 'target', value)}
                        options={providerModelOptions}
                        disabled={savingRoute}
                        ariaLabel={t('workbench.routing.targetLabel')}
                        placeholder={t('settings.routing.targetPlaceholder')}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden h-8 w-8 text-muted-foreground hover:text-destructive md:inline-flex"
                      onClick={() => onRemoveRoute(entry.id)}
                      disabled={savingRoute}
                      aria-label={t('common.delete')}
                    >
                      <X className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-3 rounded-xl bg-card p-4 shadow-[var(--surface-shadow)] md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('modelManagement.actions.footerTitle')}</p>
            <p className="text-xs text-muted-foreground">
              {isDirty ? t('modelManagement.actions.footerDirtyHint') : t('modelManagement.actions.footerSavedHint')}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-center">
            <Button variant="outline" size="sm" onClick={onAddRoute} disabled={savingRoute} className="w-full md:w-auto">
              {t('settings.routing.add')}
            </Button>
            <Button variant="outline" size="sm" onClick={onResetRoutes} disabled={savingRoute || !isDirty} className="w-full md:w-auto">
              {t('common.actions.reset')}
            </Button>
            <Button size="sm" onClick={onSaveRoutes} disabled={savingRoute || writing} className="relative w-full md:w-auto">
              {savingRoute ? t('common.actions.saving') : t('modelManagement.actions.saveRoutes')}
              {isDirty ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" /> : null}
            </Button>
          </div>
        </div>

        <Disclosure
          open={suggestionsOpen}
          onOpenChange={setSuggestionsOpen}
          summary={(
            <span className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium text-foreground">{t('settings.routing.suggested')}</span>
              <Badge variant="outline" className="text-[11px]">{suggestions.length}</Badge>
            </span>
          )}
          className="rounded-xl bg-secondary/50 px-4 py-3"
          summaryClassName="px-0 py-0"
          contentClassName="mt-3"
        >
          <p className="mb-2 text-[11px] text-muted-foreground">{t('modelManagement.overview.suggestionHint')}</p>
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map((model) => {
              const alreadyAdded = existingSources.has(model)
              return (
                <Button
                  key={`${endpoint}-${model}`}
                  variant={alreadyAdded ? 'ghost' : 'outline'}
                  size="sm"
                  onClick={() => onAddSuggestion(model)}
                  disabled={savingRoute || alreadyAdded}
                  className={cn(
                    'h-7 rounded-md px-2.5 text-[11px] font-normal',
                    alreadyAdded ? 'opacity-45' : 'bg-background'
                  )}
                >
                  {model}
                </Button>
              )
            })}
          </div>
        </Disclosure>

        <datalist id={sourceListId}>
          {suggestions.map((model) => (
            <option key={`${sourceListId}-${model}`} value={model} />
          ))}
        </datalist>
      </CardContent>
    </Card>

    {/* 3. Advanced — presets, OpenAI compatibility, wildcard semantics */}
    <Disclosure
      variant="card"
      summary={(
        <span className="text-sm font-medium text-foreground">{t('workbench.advanced.title')}</span>
      )}
      summaryClassName="px-4 py-3"
      contentClassName="space-y-4 border-t border-border px-4 py-4"
    >
      <p className="text-xs text-muted-foreground">{t('workbench.advanced.wildcardHint')}</p>
      {compatibilitySection}
      {presetsSection}
    </Disclosure>
    </div>
  )
}

function RoutingPresetsSection({
  presets,
  presetName,
  presetError,
  savingPreset,
  applyingPreset,
  deletingPreset,
  writing,
  expanded,
  onToggleExpanded,
  onPresetNameChange,
  onSavePreset,
  onRequestPresetDiff,
  onRequestDeletePreset
}: {
  presets: RoutingPreset[]
  presetName: string
  presetError?: string | null
  savingPreset: boolean
  applyingPreset: string | null
  deletingPreset: string | null
  writing: boolean
  expanded: boolean
  onToggleExpanded: () => void
  onPresetNameChange: (value: string) => void
  onSavePreset: () => void
  onRequestPresetDiff: (preset: RoutingPreset) => void
  onRequestDeletePreset: (preset: RoutingPreset) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-xl bg-card shadow-[var(--surface-shadow)]">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 rounded-xl p-4 text-left transition-colors hover:bg-accent"
        onClick={onToggleExpanded}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <h3 className="font-medium">{t('modelManagement.presets.title')}</h3>
          <Badge variant="secondary" className="text-xs">{presets.length}</Badge>
        </div>
      </button>
      {expanded ? (
        <div className="space-y-4 border-t border-border/45 px-4 pb-4 pt-3">
          <p className="text-sm text-muted-foreground">{t('modelManagement.presets.description')}</p>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              value={presetName}
              onChange={(event) => onPresetNameChange(event.target.value)}
              placeholder={t('modelManagement.presets.namePlaceholder')}
              disabled={savingPreset}
              className="w-full md:w-48"
            />
            <Button onClick={onSavePreset} disabled={savingPreset || writing} className="w-full md:w-auto">
              {savingPreset ? t('modelManagement.presets.saving') : t('modelManagement.presets.save')}
            </Button>
          </div>
          {presetError ? <p className="text-sm text-destructive">{presetError}</p> : null}
          {presets.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              {t('modelManagement.presets.empty')}
            </p>
          ) : (
            <TooltipProvider>
              <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                {presets.map((preset) => {
                  const isApplying = applyingPreset === preset.name
                  const isDeleting = deletingPreset === preset.name
                  const routeEntries = Object.entries(preset.modelRoutes ?? {})
                  const rulesCount = routeEntries.length
                  return (
                    <div
                      key={preset.name}
                      className="flex flex-col gap-3 rounded-xl bg-secondary/50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
                    >
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="min-w-0 flex-1 cursor-default">
                            <span className="block truncate text-sm font-medium">{preset.name}</span>
                            <Badge variant="outline" className="mt-1 text-xs">
                              {rulesCount > 0
                                ? t('modelManagement.presets.rulesCount', { count: rulesCount })
                                : t('modelManagement.presets.noRules')}
                            </Badge>
                          </div>
                        </TooltipTrigger>
                        {rulesCount > 0 ? (
                          <TooltipContent side="bottom" className="max-w-xs">
                            <div className="space-y-1 text-xs">
                              {routeEntries.slice(0, 5).map(([source, target]) => (
                                <div key={source} className="flex items-center gap-1">
                                  <span className="truncate">{source}</span>
                                  <ArrowRight className="h-3 w-3 flex-shrink-0" />
                                  <span className="truncate">{target}</span>
                                </div>
                              ))}
                              {rulesCount > 5 ? <div className="text-muted-foreground">…+{rulesCount - 5}</div> : null}
                            </div>
                          </TooltipContent>
                        ) : null}
                      </Tooltip>
                      <div className="grid flex-shrink-0 gap-2 sm:flex sm:items-center">
                        <Button size="sm" onClick={() => onRequestPresetDiff(preset)} disabled={isApplying || isDeleting || writing} className="w-full sm:w-auto">
                          {isApplying ? t('modelManagement.presets.applying') : t('modelManagement.presets.apply')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRequestDeletePreset(preset)}
                          disabled={isDeleting || isApplying || writing}
                          className="w-full sm:w-auto"
                        >
                          {isDeleting ? t('modelManagement.presets.deleting') : t('modelManagement.presets.delete')}
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            </TooltipProvider>
          )}
        </div>
      ) : null}
    </div>
  )
}
