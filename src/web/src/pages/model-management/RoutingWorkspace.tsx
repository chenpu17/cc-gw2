import { ArrowRight, ChevronDown, ChevronRight, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import type { CustomEndpoint } from '@/types/endpoints'
import type { GatewayConfig, RoutingPreset } from '@/types/providers'
import { SectionIntro } from './SectionIntro'
import { TargetCombobox } from './TargetCombobox'
import {
  CLAUDE_MODEL_SUGGESTIONS,
  getEndpointValidation,
  isAnthropicEndpoint,
  OPENAI_MODEL_SUGGESTIONS,
  type ManagementTab,
  type ModelRouteEntry
} from './shared'

export function RoutingWorkspace({
  endpoint,
  tabs,
  customEndpoints,
  config,
  routes,
  routeError,
  savingRoute,
  isDirty,
  presets,
  presetName,
  presetError,
  savingPreset,
  applyingPreset,
  deletingPreset,
  presetsExpanded,
  savingClaudeValidation,
  providerModelOptions,
  onTogglePresetsExpanded,
  onPresetNameChange,
  onSavePreset,
  onRequestPresetDiff,
  onRequestDeletePreset,
  onToggleClaudeValidation,
  onRouteChange,
  onRemoveRoute,
  onAddSuggestion,
  onAddRoute,
  onResetRoutes,
  onSaveRoutes
}: {
  endpoint: string
  tabs: ManagementTab[]
  customEndpoints: CustomEndpoint[]
  config: GatewayConfig | null
  routes: ModelRouteEntry[]
  routeError?: string | null
  savingRoute: boolean
  isDirty: boolean
  presets: RoutingPreset[]
  presetName: string
  presetError?: string | null
  savingPreset: boolean
  applyingPreset: string | null
  deletingPreset: string | null
  presetsExpanded: boolean
  savingClaudeValidation: boolean
  providerModelOptions: Array<{ value: string; label: string }>
  onTogglePresetsExpanded: () => void
  onPresetNameChange: (value: string) => void
  onSavePreset: () => void
  onRequestPresetDiff: (preset: RoutingPreset) => void
  onRequestDeletePreset: (preset: RoutingPreset) => void
  onToggleClaudeValidation: (enabled: boolean) => void
  onRouteChange: (id: string, field: 'source' | 'target', value: string) => void
  onRemoveRoute: (id: string) => void
  onAddSuggestion: (model: string) => void
  onAddRoute: () => void
  onResetRoutes: () => void
  onSaveRoutes: () => void
}) {
  const { t } = useTranslation()
  const tabInfo = tabs.find((tab) => tab.key === endpoint)
  const hasAnthropicProtocol = tabInfo?.protocols?.includes('anthropic') ?? (endpoint === 'anthropic')
  const suggestions = hasAnthropicProtocol ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS
  const endpointLabel = tabInfo?.label ?? endpoint
  const endpointDescription = tabInfo?.isSystem === false
    ? tabInfo.description
    : t(`settings.routing.descriptionByEndpoint.${endpoint}`)
  const sourceListId = `route-source-${endpoint}`
  const anthropicProtocol = isAnthropicEndpoint(endpoint, customEndpoints)
  const validation = getEndpointValidation(endpoint, config, customEndpoints)
  const claudeValidationEnabled = anthropicProtocol && validation?.mode === 'claude-code'
  const existingSources = new Set(routes.map((entry) => entry.source.trim()).filter(Boolean))

  return (
    <Card className="surface-1">
      <CardContent className="space-y-6 pt-6">
        <SectionIntro
          eyebrow="Routing Workspace"
          title={t('settings.routing.titleByEndpoint', { endpoint: endpointLabel })}
          description={endpointDescription}
          breadcrumb={[t('modelManagement.title'), endpointLabel]}
          aside={(
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{routes.length} rules</Badge>
              {isDirty ? (
                <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
                  {t('modelManagement.actions.unsaved')}
                </Badge>
              ) : (
                <Badge variant="secondary">{t('common.status.success')}</Badge>
              )}
            </div>
          )}
        />

        <div className="grid gap-3 md:grid-cols-4">
          <RoutingWorkspaceStat label="Rules" value={routes.length.toString()} helper="Current model routes" tone="blue" />
          <RoutingWorkspaceStat label="Presets" value={presets.length.toString()} helper="Reusable routing templates" tone="emerald" />
          <RoutingWorkspaceStat label="Protocols" value={(tabInfo?.protocols?.length ?? 0).toString()} helper="Bound to this endpoint" tone="amber" />
          <RoutingWorkspaceStat
            label="Validation"
            value={anthropicProtocol ? (claudeValidationEnabled ? 'Claude Code' : 'Disabled') : 'Standard'}
            helper={anthropicProtocol ? 'Anthropic compatibility mode' : 'Default endpoint routing'}
            tone="rose"
          />
        </div>

        <div className="rounded-[1.2rem] border border-border/70 bg-background/55 px-4 py-3 text-xs text-muted-foreground">
          {t('settings.routing.wildcardHint')}
        </div>

        {anthropicProtocol ? (
          <div className="rounded-[1.25rem] border border-blue-200 bg-blue-50/75 p-4 dark:border-blue-800 dark:bg-blue-950">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">
                  {t('modelManagement.claudeValidation.title')}
                </p>
                <p className="text-xs text-blue-700 dark:text-blue-300">
                  {t('modelManagement.claudeValidation.description')}
                </p>
              </div>
              <div className="flex items-center gap-2 self-start sm:self-auto">
                <Switch
                  checked={claudeValidationEnabled}
                  onCheckedChange={onToggleClaudeValidation}
                  disabled={savingClaudeValidation}
                />
                <span className={cn('text-xs font-medium', claudeValidationEnabled ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground')}>
                  {claudeValidationEnabled
                    ? t('modelManagement.claudeValidation.statusEnabled')
                    : t('modelManagement.claudeValidation.statusDisabled')}
                </span>
              </div>
            </div>
          </div>
        ) : null}

        {routeError ? <p className="text-sm text-destructive">{routeError}</p> : null}

        <div className="space-y-3 rounded-[1.35rem] border border-border/70 bg-[linear-gradient(135deg,rgba(255,255,255,0.7),rgba(248,250,252,0.82))] p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <Label className="text-sm font-semibold text-foreground">{t('modelManagement.routesEditorTitle')}</Label>
                <Badge variant="outline">{routes.length} active</Badge>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t('modelManagement.overview.routesEditorHint')}</p>
            </div>
            <div className="self-start rounded-xl border border-border/60 bg-background/80 px-3 py-2 text-[11px] text-muted-foreground">
              {endpointLabel} workspace
            </div>
          </div>

          {routes.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-border/70 bg-background/45 p-12 text-center text-sm text-muted-foreground">
              <p className="font-medium">{t('settings.routing.empty')}</p>
              <p className="mt-2 text-xs">{t('modelManagement.emptyRoutesHint')}</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="hidden grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-3 px-1 text-xs font-medium text-muted-foreground md:grid">
                <span>{t('settings.routing.source')}</span>
                <span />
                <span>{t('settings.routing.target')}</span>
                <span />
              </div>
              {routes.map((entry, index) => (
                <div key={entry.id} className="rounded-[1rem] border border-border/60 bg-background/80 p-3">
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
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                  <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] md:items-center">
                    <div className="space-y-1">
                      <Label className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground md:hidden">
                        {t('settings.routing.source')}
                      </Label>
                      <Input
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
                        {t('settings.routing.target')}
                      </Label>
                      <TargetCombobox
                        value={entry.target}
                        onChange={(value) => onRouteChange(entry.id, 'target', value)}
                        options={providerModelOptions}
                        disabled={savingRoute}
                        placeholder={t('settings.routing.targetPlaceholder')}
                      />
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="hidden h-8 w-8 text-muted-foreground hover:text-destructive md:inline-flex"
                      onClick={() => onRemoveRoute(entry.id)}
                      disabled={savingRoute}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-3 rounded-[1.25rem] border border-border/70 bg-background/55 p-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <Label className="text-sm font-semibold text-foreground">{t('settings.routing.suggested')}</Label>
              <Badge variant="outline">{suggestions.length} presets</Badge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">{t('modelManagement.overview.suggestionHint')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {suggestions.map((model) => {
              const alreadyAdded = existingSources.has(model)
              return (
                <Button
                  key={`${endpoint}-${model}`}
                  variant={alreadyAdded ? 'ghost' : 'outline'}
                  size="sm"
                  onClick={() => onAddSuggestion(model)}
                  disabled={savingRoute || alreadyAdded}
                  className={alreadyAdded ? 'opacity-50' : ''}
                >
                  {model}
                </Button>
              )
            })}
          </div>
        </div>

        <div className="flex flex-col gap-3 rounded-[1.25rem] border border-white/50 bg-card/82 p-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1">
            <p className="text-sm font-medium">{t('modelManagement.actions.footerTitle')}</p>
            <p className="text-xs text-muted-foreground">
              {isDirty ? t('modelManagement.actions.footerDirtyHint') : t('modelManagement.actions.footerSavedHint')}
            </p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3 md:flex md:flex-wrap md:items-center">
            <Button variant="outline" size="sm" onClick={onAddRoute} disabled={savingRoute} className="w-full">
              {t('settings.routing.add')}
            </Button>
            <Button variant="outline" size="sm" onClick={onResetRoutes} disabled={savingRoute || !isDirty} className="w-full">
              {t('common.actions.reset')}
            </Button>
            <Button size="sm" onClick={onSaveRoutes} disabled={savingRoute} className="relative w-full">
              {savingRoute ? t('common.actions.saving') : t('modelManagement.actions.saveRoutes')}
              {isDirty ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-amber-500" /> : null}
            </Button>
          </div>
        </div>

        <RoutingPresetsSection
          presets={presets}
          presetName={presetName}
          presetError={presetError}
          savingPreset={savingPreset}
          applyingPreset={applyingPreset}
          deletingPreset={deletingPreset}
          expanded={presetsExpanded}
          onToggleExpanded={onTogglePresetsExpanded}
          onPresetNameChange={onPresetNameChange}
          onSavePreset={onSavePreset}
          onRequestPresetDiff={onRequestPresetDiff}
          onRequestDeletePreset={onRequestDeletePreset}
        />

        <datalist id={sourceListId}>
          {suggestions.map((model) => (
            <option key={`${sourceListId}-${model}`} value={model} />
          ))}
        </datalist>
      </CardContent>
    </Card>
  )
}

function RoutingWorkspaceStat({
  helper,
  label,
  tone,
  value
}: {
  helper: string
  label: string
  tone: 'amber' | 'blue' | 'emerald' | 'rose'
  value: string
}) {
  const toneClassName = {
    blue: 'border-blue-200 bg-blue-50/70 text-blue-700',
    emerald: 'border-emerald-200 bg-emerald-50/70 text-emerald-700',
    amber: 'border-amber-200 bg-amber-50/70 text-amber-700',
    rose: 'border-rose-200 bg-rose-50/70 text-rose-700'
  }[tone]

  return (
    <div className={cn('rounded-[1.15rem] border px-4 py-3', toneClassName)}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] opacity-80">{label}</p>
      <p className="mt-2 truncate text-base font-semibold">{value}</p>
      <p className="mt-1 text-xs opacity-80">{helper}</p>
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
  expanded: boolean
  onToggleExpanded: () => void
  onPresetNameChange: (value: string) => void
  onSavePreset: () => void
  onRequestPresetDiff: (preset: RoutingPreset) => void
  onRequestDeletePreset: (preset: RoutingPreset) => void
}) {
  const { t } = useTranslation()

  return (
    <div className="rounded-[1.25rem] border border-dashed border-border/70 bg-background/45">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-primary/5"
        onClick={onToggleExpanded}
      >
        <div className="flex items-center gap-2">
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
          <h3 className="font-medium">{t('modelManagement.presets.title')}</h3>
          <Badge variant="secondary" className="text-xs">{presets.length}</Badge>
        </div>
      </button>
      {expanded ? (
        <div className="space-y-4 border-t px-4 pb-4 pt-3">
          <p className="text-sm text-muted-foreground">{t('modelManagement.presets.description')}</p>
          <div className="flex flex-col gap-3 md:flex-row md:items-center">
            <Input
              value={presetName}
              onChange={(event) => onPresetNameChange(event.target.value)}
              placeholder={t('modelManagement.presets.namePlaceholder')}
              disabled={savingPreset}
              className="w-full md:w-48"
            />
            <Button onClick={onSavePreset} disabled={savingPreset} className="w-full md:w-auto">
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
                      className="flex flex-col gap-3 rounded-[1.15rem] border border-white/50 bg-card/88 px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:flex-row sm:items-center sm:justify-between"
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
                        <Button size="sm" onClick={() => onRequestPresetDiff(preset)} disabled={isApplying || isDeleting} className="w-full sm:w-auto">
                          {isApplying ? t('modelManagement.presets.applying') : t('modelManagement.presets.apply')}
                        </Button>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => onRequestDeletePreset(preset)}
                          disabled={isDeleting || isApplying}
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
