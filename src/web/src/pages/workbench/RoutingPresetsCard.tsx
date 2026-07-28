import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { RoutingPreset } from '@/types/providers'
import type { RoutingState } from './useRoutingState'

/**
 * Column-2 routing-presets card. Always visible (no "高级" disclosure) per the
 * mockup. Save the current rule set as a named template, or apply/delete an
 * existing one. Apply opens the PresetDiffDialog (hosted by the page); delete
 * goes through the page-level confirm dialog.
 */
export function RoutingPresetsCard({
  routing,
  endpoint,
  onRequestDeletePreset
}: {
  routing: RoutingState
  endpoint: string
  onRequestDeletePreset: (endpoint: string, preset: RoutingPreset) => void
}) {
  const { t } = useTranslation()
  const presets = routing.presetsByEndpoint[endpoint] ?? []
  const presetName = routing.presetNameByEndpoint[endpoint] ?? ''
  const presetError = routing.presetErrorByEndpoint[endpoint]
  const savingPreset = routing.savingPresetFor === endpoint
  const applyingPreset = routing.applyingPreset?.endpoint === endpoint ? routing.applyingPreset.name : null
  const deletingPreset = routing.deletingPreset?.endpoint === endpoint ? routing.deletingPreset.name : null
  const writing = routing.writingEndpoint === endpoint

  return (
    <Card data-testid="routing-presets-card" className="shadow-[var(--surface-shadow)]">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-[13px] font-semibold">{t('modelManagement.presets.title')}</h3>
          <Button
            variant="outline"
            size="sm"
            data-testid="save-preset"
            onClick={() => void routing.handleSavePreset(endpoint)}
            disabled={savingPreset || writing}
          >
            {savingPreset ? t('modelManagement.presets.saving') : t('modelManagement.presets.save')}
          </Button>
        </div>
        <p className="text-[11px] text-muted-foreground">{t('modelManagement.presets.description')}</p>
        <Input
          data-testid="preset-name-input"
          value={presetName}
          onChange={(event) => routing.handlePresetNameChange(endpoint, event.target.value)}
          placeholder={t('modelManagement.presets.namePlaceholder')}
          disabled={savingPreset}
          className="h-8 text-xs"
        />
        {presetError ? <p className="text-xs text-destructive">{presetError}</p> : null}
        {presets.length === 0 ? (
          <p className="py-2 text-center text-[11px] text-muted-foreground">{t('modelManagement.presets.empty')}</p>
        ) : (
          <TooltipProvider>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
              {presets.map((preset) => {
                const isApplying = applyingPreset === preset.name
                const isDeleting = deletingPreset === preset.name
                const entries = Object.entries(preset.modelRoutes ?? {})
                const count = entries.length
                return (
                  <div
                    key={preset.name}
                    data-testid="preset-row"
                    className="flex items-center justify-between gap-2 border border-border bg-secondary/40 px-2.5 py-2"
                  >
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <div className="min-w-0 flex-1 cursor-default">
                          <span className="block truncate text-[11px] font-medium">{preset.name}</span>
                          <Badge variant="outline" className="mt-0.5 text-[10px] font-normal">
                            {count > 0
                              ? t('modelManagement.presets.rulesCount', { count })
                              : t('modelManagement.presets.noRules')}
                          </Badge>
                        </div>
                      </TooltipTrigger>
                      {count > 0 ? (
                        <TooltipContent side="bottom" className="max-w-xs">
                          <div className="space-y-1 text-xs">
                            {entries.slice(0, 5).map(([source, target]) => (
                              <div key={source} className="flex items-center gap-1">
                                <span className="truncate">{source}</span>
                                <ArrowRight className="h-3 w-3 shrink-0" />
                                <span className="truncate">{target}</span>
                              </div>
                            ))}
                            {count > 5 ? <div className="text-muted-foreground">…+{count - 5}</div> : null}
                          </div>
                        </TooltipContent>
                      ) : null}
                    </Tooltip>
                    <div className="flex shrink-0 items-center gap-2">
                      <button
                        type="button"
                        data-testid="apply-preset"
                        className="text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
                        onClick={() => routing.setPresetDiffDialog({ endpoint, preset })}
                        disabled={isApplying || isDeleting || writing}
                      >
                        {isApplying ? t('modelManagement.presets.applying') : t('modelManagement.presets.apply')}
                      </button>
                      <button
                        type="button"
                        data-testid="delete-preset"
                        className="text-[11px] text-muted-foreground hover:text-destructive disabled:opacity-50"
                        aria-label={t('common.delete')}
                        onClick={() => onRequestDeletePreset(endpoint, preset)}
                        disabled={isDeleting || isApplying || writing}
                      >
                        {isDeleting ? t('modelManagement.presets.deleting') : t('modelManagement.presets.delete')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </TooltipProvider>
        )}
      </CardContent>
    </Card>
  )
}
