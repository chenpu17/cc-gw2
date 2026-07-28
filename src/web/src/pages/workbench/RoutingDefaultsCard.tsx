import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Disclosure } from '@/components/ui/disclosure'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TargetCombobox } from './TargetCombobox'
import type { RoutingState } from './useRoutingState'

/**
 * Column-2 default-forwarding card. Accent (primary) treatment per the mockup —
 * this is where unmatched requests go, so it must read as the emphasized default.
 * `*` → completion target, with reasoning / background / threshold behind a
 * "更多默认设置" disclosure and a dedicated Save button.
 */
export function RoutingDefaultsCard({
  routing,
  endpoint
}: {
  routing: RoutingState
  endpoint: string
}) {
  const { t } = useTranslation()
  const defaults = routing.defaultsByEndpoint[endpoint] ?? null
  const defaultsDirty = routing.isDefaultsDirtyByEndpoint[endpoint] ?? false
  const savingDefaults = routing.savingDefaultsFor === endpoint
  const writing = routing.writingEndpoint === endpoint
  const options = routing.providerModelOptions

  return (
    <Card data-testid="routing-defaults-card" className="border-primary/40 bg-primary/5 shadow-none">
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-[13px] font-semibold text-primary">{t('workbench.defaults.title')}</h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('workbench.defaults.cardSubtitle')}</p>
          </div>
          <Disclosure
            summary={<span className="text-[11px] font-medium text-muted-foreground">{t('workbench.defaults.moreLabel')}</span>}
            summaryClassName="px-2 py-1"
            contentClassName="mt-3 space-y-3"
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  {t('workbench.defaults.reasoningLabel')}
                </Label>
                <TargetCombobox
                  value={defaults?.reasoning ?? ''}
                  onChange={(value) => routing.handleDefaultsChange(endpoint, 'reasoning', value)}
                  options={options}
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
                  onChange={(value) => routing.handleDefaultsChange(endpoint, 'background', value)}
                  options={options}
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
                value={defaults?.longContextThreshold || ''}
                onChange={(event) => {
                  const parsed = Number.parseInt(event.target.value, 10)
                  routing.handleDefaultsChange(endpoint, 'longContextThreshold', Number.isFinite(parsed) ? parsed : 0)
                }}
                disabled={savingDefaults}
                className="md:w-56"
              />
            </div>
          </Disclosure>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <span className="border border-border bg-card px-2.5 py-2 font-mono text-xs">*</span>
          <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" aria-hidden />
          <div data-testid="default-target" className="min-w-[180px] flex-1">
            <TargetCombobox
              value={defaults?.completion ?? ''}
              onChange={(value) => routing.handleDefaultsChange(endpoint, 'completion', value)}
              options={options}
              disabled={savingDefaults}
              ariaLabel={t('workbench.defaults.completionLabel')}
              placeholder={t('workbench.defaults.targetPlaceholder')}
            />
          </div>
          <Button
            size="sm"
            data-testid="save-defaults"
            onClick={() => void routing.handleSaveDefaults(endpoint)}
            disabled={savingDefaults || !defaultsDirty || writing}
            className="relative"
          >
            {savingDefaults ? t('common.actions.saving') : t('workbench.defaults.save')}
            {defaultsDirty ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning" /> : null}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
