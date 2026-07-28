import { useTranslation } from 'react-i18next'
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy
} from '@dnd-kit/sortable'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { PageState } from '@/components/PageState'
import { CLAUDE_MODEL_SUGGESTIONS, OPENAI_MODEL_SUGGESTIONS, type ManagementTab } from './shared'
import { RoutingRuleRow } from './RoutingRuleRow'
import type { RoutingState } from './useRoutingState'

/**
 * Column-2 model-route rules card with drag-to-reorder. Rows are a dnd-kit
 * sortable list; on drop the local draft is reordered (handleReorderRules) and
 * persists on the next 保存路由, which serializes array order into the
 * modelRoutes object (backend IndexMap preserves insertion order).
 */
export function RoutingRulesList({
  routing,
  endpoint,
  tabInfo
}: {
  routing: RoutingState
  endpoint: string
  tabInfo?: ManagementTab
}) {
  const { t } = useTranslation()
  const routes = routing.routesByEndpoint[endpoint] || []
  const routeError = routing.routeError[endpoint]
  const savingRoute = routing.savingRouteFor === endpoint
  const isDirty = routing.isDirtyByEndpoint[endpoint] ?? false
  const writing = routing.writingEndpoint === endpoint
  const options = routing.providerModelOptions
  const sourceListId = `route-source-${endpoint}`

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    routing.handleReorderRules(endpoint, String(active.id), String(over.id))
  }

  const hasAnthropicProtocol = tabInfo?.protocols?.includes('anthropic') ?? endpoint === 'anthropic'
  const suggestions = hasAnthropicProtocol ? CLAUDE_MODEL_SUGGESTIONS : OPENAI_MODEL_SUGGESTIONS

  return (
    <Card data-testid="routing-rules-card" className="shadow-[var(--surface-shadow)]">
      <CardContent className="space-y-3 p-4">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="flex items-center gap-2 text-[13px] font-semibold">
              {t('workbench.routing.rulesTitle')}
              <Badge variant="outline" className="text-[10.5px] font-normal tabular-nums">{routes.length}</Badge>
            </h3>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{t('workbench.routing.rulesSubtitle')}</p>
          </div>
          <Button variant="outline" size="sm" data-testid="add-route" onClick={() => routing.handleAddRoute(endpoint)} disabled={savingRoute}>
            {t('settings.routing.add')}
          </Button>
        </div>

        {routeError ? <p className="text-xs text-destructive">{routeError}</p> : null}

        {routes.length === 0 ? (
          <PageState
            compact
            title={t('workbench.routing.emptyTitle')}
            description={t('workbench.routing.emptyDescription')}
            action={
              <Button size="sm" onClick={() => routing.handleAddRoute(endpoint)} disabled={savingRoute}>
                {t('workbench.routing.addFirst')}
              </Button>
            }
          />
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={routes.map((entry) => entry.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-1.5">
                {routes.map((entry, index) => (
                  <RoutingRuleRow
                    key={entry.id}
                    entry={entry}
                    index={index}
                    savingRoute={savingRoute}
                    options={options}
                    sourceListId={sourceListId}
                    onRouteChange={(id, field, value) => routing.handleRouteChange(endpoint, id, field, value)}
                    onRemoveRoute={(id) => routing.handleRemoveRoute(endpoint, id)}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/60 pt-3">
          <p className="text-[11px] text-muted-foreground">
            {isDirty ? t('modelManagement.actions.footerDirtyHint') : t('modelManagement.actions.footerSavedHint')}
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              data-testid="reset-routes"
              onClick={() => routing.handleResetRoutes(endpoint)}
              disabled={savingRoute || !isDirty}
            >
              {t('common.actions.reset')}
            </Button>
            <Button
              size="sm"
              data-testid="save-routes"
              onClick={() => void routing.handleSaveRoutes(endpoint)}
              disabled={savingRoute || writing}
              className="relative"
            >
              {savingRoute ? t('common.actions.saving') : t('modelManagement.actions.saveRoutes')}
              {isDirty ? <span className="absolute -right-1 -top-1 h-2 w-2 rounded-full bg-warning" /> : null}
            </Button>
          </div>
        </div>

        <datalist id={sourceListId}>
          {suggestions.map((model) => (
            <option key={`${sourceListId}-${model}`} value={model} />
          ))}
        </datalist>
      </CardContent>
    </Card>
  )
}
