import { useTranslation } from 'react-i18next'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { ArrowRight, GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TargetCombobox } from './TargetCombobox'
import type { ModelRouteEntry } from './shared'

/**
 * One draggable model-route rule. Drag listeners live ONLY on the grip handle
 * (setActivatorNodeRef) so the source input, the TargetCombobox and the delete
 * button stay fully interactive. Sharp corners, flat — no framer-motion here.
 */
export function RoutingRuleRow({
  entry,
  index,
  savingRoute,
  options,
  sourceListId,
  onRouteChange,
  onRemoveRoute
}: {
  entry: ModelRouteEntry
  index: number
  savingRoute: boolean
  options: RoutingRuleRowOptions
  sourceListId: string
  onRouteChange: (id: string, field: 'source' | 'target', value: string) => void
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
        'flex items-center gap-2 border border-border bg-card p-2',
        isDragging && 'z-10 opacity-60 shadow-[var(--surface-shadow-lg)]'
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        data-testid="route-rule-grip"
        aria-label={t('workbench.routing.dragHandle')}
        className="flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span className="w-4 shrink-0 text-center text-[10.5px] tabular-nums text-muted-foreground">{index + 1}</span>
      <Input
        data-testid="route-rule-source"
        value={entry.source}
        onChange={(event) => onRouteChange(entry.id, 'source', event.target.value)}
        placeholder={t('settings.routing.sourcePlaceholder')}
        list={sourceListId}
        disabled={savingRoute}
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      <div data-testid="route-rule-target" className="min-w-0 flex-[1.15]">
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
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
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
