import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { CLAUDE_MODEL_SUGGESTIONS } from '../workbench/shared'
import type { SetupState } from './useSetupState'

const SOURCE_SUGGESTIONS = CLAUDE_MODEL_SUGGESTIONS.slice(0, 3)

export function SetupRoutingStep({ state }: { state: SetupState }) {
  const { t } = useTranslation()
  const {
    setupProvider,
    anthropicRoutes,
    routeSource,
    setRouteSource,
    routeTarget,
    setRouteTarget,
    savingRoute,
    saveDefaultRoute
  } = state

  const routeEntries = Object.entries(anthropicRoutes)
  const canSave =
    Boolean(setupProvider) && routeSource.trim().length > 0 && routeTarget.trim().length > 0 && !savingRoute

  return (
    <div className="space-y-6">
      {routeEntries.length > 0 ? (
        <section className="space-y-3" aria-labelledby="setup-existing-routes">
          <div className="space-y-1">
            <h3 id="setup-existing-routes" className="text-sm font-semibold">
              {t('setup.steps.routing.existingTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">{t('setup.steps.routing.existingHint')}</p>
          </div>
          <div className="divide-y divide-border rounded-xl border border-border">
            {routeEntries.map(([source, target]) => (
              <div key={source} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-xs">
                <code className="font-mono text-foreground">{source}</code>
                <code className="font-mono text-muted-foreground">→ {target}</code>
              </div>
            ))}
          </div>
        </section>
      ) : (
        <p className="rounded-xl bg-secondary/50 px-4 py-3 text-xs text-muted-foreground">
          {t('setup.steps.routing.emptyHint')}
        </p>
      )}

      <section className="space-y-4" aria-labelledby="setup-new-route">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{t('setup.steps.routing.sourceLabel')}</span>
              <Input value={routeSource} onChange={(event) => setRouteSource(event.target.value)} />
            </Label>
            <div className="flex flex-wrap gap-1.5">
              {SOURCE_SUGGESTIONS.map((model) => (
                <Button
                  key={model}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 rounded-md px-2.5 text-[11px] font-normal"
                  onClick={() => setRouteSource(model)}
                >
                  {model}
                </Button>
              ))}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">{t('setup.steps.routing.sourceHint')}</p>
          </div>
          <Label className="flex flex-col gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('setup.steps.routing.targetLabel')}</span>
            <Input value={routeTarget} onChange={(event) => setRouteTarget(event.target.value)} />
          </Label>
        </div>
        <div className="flex justify-end">
          <Button type="button" onClick={() => void saveDefaultRoute()} disabled={!canSave}>
            {savingRoute ? t('setup.steps.routing.saving') : t('setup.steps.routing.save')}
          </Button>
        </div>
      </section>
    </div>
  )
}
