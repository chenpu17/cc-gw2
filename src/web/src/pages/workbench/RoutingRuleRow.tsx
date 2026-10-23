import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowRight, GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { TargetCombobox } from './TargetCombobox'
import type { ModelRouteEntry, RouteScope } from './shared'

/**
 * One draggable model-route rule. Drag listeners live ONLY on the grip handle
 * (setActivatorNodeRef) so the source input, the TargetCombobox and the delete
 * button stay fully interactive. Sharp corners, flat — no framer-motion here.
 *
 * `showScope` is set for unified custom endpoints (Anthropic + OpenAI on one
 * base path): each rule can be scoped to the shared map or to one protocol
 * family, so the same source model can branch by protocol.
 */
export function RoutingRuleRow({
  entry,
  index,
  savingRoute,
  options,
  sourceListId,
  showScope = false,
  onRouteChange,
  onScopeChange,
  onRemoveRoute
}: {
  entry: ModelRouteEntry
  index: number
  savingRoute: boolean
  options: RoutingRuleRowOptions
  sourceListId: string
  showScope?: boolean
  onRouteChange: (id: string, field: 'source' | 'target', value: string) => void
  onScopeChange: (id: string, scope: RouteScope) => void
  onRemoveRoute: (id: string) => void
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: entry.id })

  return (
    <div
      ref={setNodeRef}
      data-testid="route-rule-row"
      data-id={entry.id}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        // Narrow: source / target / scope stack over three rows so none of the
        // inputs collapses to a sliver; sm+ returns to the single-line row.
        'grid grid-cols-[auto_auto_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1.5 border border-border bg-card p-2 sm:flex sm:gap-2',
        isDragging && 'z-10 opacity-60 shadow-[var(--surface-shadow-lg)]'
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        data-testid="route-rule-grip"
        aria-label={t('workbench.routing.dragHandle')}
        className="row-span-2 flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing sm:row-span-1"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span className="w-4 shrink-0 text-center text-[10.5px] tabular-nums text-muted-foreground">{index + 1}</span>
      {showScope ? (
        <Select
          value={entry.scope ?? 'all'}
          onValueChange={(value) => onScopeChange(entry.id, value as RouteScope)}
          disabled={savingRoute}
        >
          <SelectTrigger
            data-testid="route-rule-scope"
            className="col-start-2 col-span-2 row-start-3 h-8 w-full shrink-0 text-[11px] sm:col-auto sm:row-auto sm:w-[104px]"
            aria-label={`${t('workbench.routing.scopeLabel')} ${entry.source || index + 1}`}
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('workbench.routing.scopeAll')}</SelectItem>
            <SelectItem value="anthropic">{t('workbench.routing.scopeAnthropic')}</SelectItem>
            <SelectItem value="openai">{t('workbench.routing.scopeOpenai')}</SelectItem>
          </SelectContent>
        </Select>
      ) : null}
      <Input
        data-testid="route-rule-source"
        value={entry.source}
        onChange={(event) => onRouteChange(entry.id, 'source', event.target.value)}
        placeholder={t('settings.routing.sourcePlaceholder')}
        list={sourceListId}
        disabled={savingRoute}
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <ArrowRight
        className="row-start-2 col-start-2 h-3.5 w-3.5 shrink-0 text-muted-foreground sm:col-auto sm:row-auto"
        aria-hidden
      />
      <div
        data-testid="route-rule-target"
        className="row-start-2 col-start-3 min-w-0 sm:col-auto sm:row-auto sm:flex-[1.15]"
      >
        <TargetCombobox
          value={entry.target}
          onChange={(value) => onRouteChange(entry.id, 'target', value)}
          options={options}
          disabled={savingRoute}
          ariaLabel={t('workbench.routing.targetLabel')}
          placeholder={t('settings.routing.targetPlaceholder')}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        data-testid="route-rule-delete"
        className="row-span-2 col-start-4 h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive sm:col-auto sm:row-span-1"
        onClick={() => onRemoveRoute(entry.id)}
        disabled={savingRoute}
        aria-label={t('common.delete')}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  )
}

export type RoutingRuleRowOptions = Array<{ value: string; label: string }>
