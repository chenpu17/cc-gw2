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
  verticalListSortingStrategy,
  useSortable
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { ProviderStepShared } from './ProviderDrawerSteps'
import { TargetCombobox } from './TargetCombobox'

/** The aggregate-only slice of the shared step props, made required. */
type AggregateStepProps = ProviderStepShared &
  Required<
    Pick<
      ProviderStepShared,
      | 'memberOptions'
      | 'onAddMember'
      | 'onRemoveMember'
      | 'onMemberTargetChange'
      | 'onReorderMembers'
      | 'onModelFailoverChange'
    >
  >

/**
 * Step 2 for `aggregate` providers: each aggregated model is a card holding
 * the client-facing model id, a dnd-kit member chain (drag to reorder =
 * failover priority, grip-only drag like RoutingRuleRow) and an advanced
 * failover-policy disclosure. No upstream test/probe — members are tested on
 * their own provider cards.
 */
export function AggregateModelsStep(props: AggregateStepProps) {
  const { t } = useTranslation()
  const {
    form,
    errors,
    onModelIdChange,
    onAddModel,
    onRemoveModel,
    onAddMember,
    onRemoveMember,
    onMemberTargetChange,
    onReorderMembers,
    onModelFailoverChange,
    memberOptions
  } = props

  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="aggregate-model-fields">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 id="aggregate-model-fields" className="text-sm font-semibold">
              {t('providers.aggregate.drawer.stepTitle')}
            </h3>
            <p className="text-xs text-muted-foreground">
              {t('providers.aggregate.drawer.modelsDescription')}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={onAddModel}
            className="bg-card text-xs"
          >
            {t('providers.drawer.fields.addModel')}
          </Button>
        </div>

        {errors.models ? <p className="text-xs text-destructive">{errors.models}</p> : null}

        <div className="space-y-4">
          {form.models.map((model, index) => (
            <div
              key={model._key}
              data-testid="aggregate-model-card"
              className="rounded-xl border border-transparent bg-card p-4 shadow-[var(--surface-shadow)]"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {t('providers.aggregate.drawer.modelIdLabel')}
                  </span>
                  <Input
                    value={model.id}
                    onChange={(event) => onModelIdChange(index, event.target.value)}
                    placeholder={t('providers.aggregate.drawer.modelIdPlaceholder')}
                    className="font-mono"
                  />
                </Label>
                <p className="self-end text-xs leading-relaxed text-muted-foreground">
                  {t('providers.aggregate.drawer.modelIdHint')}
                </p>
              </div>

              <MemberChain
                modelKey={model._key}
                members={model.members}
                options={memberOptions}
                error={errors.members?.[model._key]}
                onAddMember={onAddMember}
                onRemoveMember={onRemoveMember}
                onMemberTargetChange={onMemberTargetChange}
                onReorderMembers={onReorderMembers}
              />

              <Disclosure
                summary={t('providers.aggregate.drawer.failoverTitle')}
                className="mt-4 rounded-xl bg-secondary/50"
                summaryClassName="px-3 py-2 text-xs font-medium"
                contentClassName="space-y-4 px-3 py-3"
              >
                <div className="grid gap-3 md:grid-cols-3">
                  <Label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {t('providers.aggregate.drawer.consecutiveFailures')}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      value={model.failover.consecutiveFailures}
                      onChange={(event) =>
                        onModelFailoverChange(model._key, {
                          consecutiveFailures: event.target.value
                        })
                      }
                      placeholder={t('providers.aggregate.drawer.consecutiveFailuresHint')}
                    />
                  </Label>
                  <Label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {t('providers.aggregate.drawer.cooldownSeconds')}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      max={86400}
                      value={model.failover.cooldownSeconds}
                      onChange={(event) =>
                        onModelFailoverChange(model._key, { cooldownSeconds: event.target.value })
                      }
                      placeholder={t('providers.aggregate.drawer.cooldownSecondsHint')}
                    />
                  </Label>
                  <Label className="flex flex-col gap-1.5 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {t('providers.aggregate.drawer.failureWindowSeconds')}
                    </span>
                    <Input
                      type="number"
                      min={1}
                      value={model.failover.failureWindowSeconds}
                      onChange={(event) =>
                        onModelFailoverChange(model._key, {
                          failureWindowSeconds: event.target.value
                        })
                      }
                      placeholder={t('providers.aggregate.drawer.failureWindowSecondsHint')}
                    />
                  </Label>
                </div>
                <Label className="flex flex-col gap-1.5 text-sm">
                  <span className="text-xs text-muted-foreground">
                    {t('providers.aggregate.drawer.triggerStatusCodes')}
                  </span>
                  <Input
                    value={model.failover.triggerStatusCodes}
                    onChange={(event) =>
                      onModelFailoverChange(model._key, { triggerStatusCodes: event.target.value })
                    }
                    placeholder={t('providers.aggregate.drawer.triggerStatusCodesHint')}
                    className="font-mono text-xs"
                    spellCheck={false}
                  />
                </Label>
                {errors.failover?.[model._key] ? (
                  <p className="text-xs text-destructive">{errors.failover[model._key]}</p>
                ) : null}
                <p className="text-[11px] text-muted-foreground">
                  {t('providers.aggregate.drawer.defaultsHint')}
                </p>
              </Disclosure>

              <div className="mt-3 flex justify-end">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 text-destructive"
                  onClick={() => onRemoveModel(index)}
                >
                  {t('providers.drawer.fields.removeModel')}
                </Button>
              </div>
            </div>
          ))}

          {form.models.length === 0 ? (
            <div className="rounded-xl border border-warning/30 bg-warning-bg p-5">
              <p className="text-sm font-semibold text-warning">
                {t('providers.aggregate.drawer.noModelsTitle')}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-warning">
                {t('providers.aggregate.drawer.noModelsHint')}
              </p>
            </div>
          ) : null}
        </div>
      </section>
    </div>
  )
}

function MemberChain({
  modelKey,
  members,
  options,
  error,
  onAddMember,
  onRemoveMember,
  onMemberTargetChange,
  onReorderMembers
}: {
  modelKey: string
  members: Array<{ _key: string; target: string }>
  options: AggregateStepProps['memberOptions']
  error?: string
  onAddMember: AggregateStepProps['onAddMember']
  onRemoveMember: AggregateStepProps['onRemoveMember']
  onMemberTargetChange: AggregateStepProps['onMemberTargetChange']
  onReorderMembers: AggregateStepProps['onReorderMembers']
}) {
  const { t } = useTranslation()
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event
    if (!over || active.id === over.id) return
    onReorderMembers(modelKey, String(active.id), String(over.id))
  }

  return (
    <div className="mt-4 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">
          {t('providers.aggregate.drawer.membersTitle')}
        </p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          data-testid="aggregate-add-member"
          onClick={() => onAddMember(modelKey)}
          className="h-7 bg-card px-2.5 text-[11px]"
        >
          {t('providers.aggregate.drawer.addMember')}
        </Button>
      </div>

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      {members.length === 0 ? (
        <p className="border border-dashed border-border bg-secondary/40 px-3 py-3 text-xs text-muted-foreground">
          {t('providers.aggregate.drawer.memberEmptyHint')}
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext
            items={members.map((member) => member._key)}
            strategy={verticalListSortingStrategy}
          >
            <div className="flex flex-col gap-1.5">
              {members.map((member, index) => (
                <MemberRow
                  key={member._key}
                  modelKey={modelKey}
                  member={member}
                  index={index}
                  options={options}
                  onRemoveMember={onRemoveMember}
                  onMemberTargetChange={onMemberTargetChange}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}

      <p className="text-[11px] leading-relaxed text-muted-foreground">
        {t('providers.aggregate.drawer.memberHint')}
      </p>
    </div>
  )
}

function MemberRow({
  modelKey,
  member,
  index,
  options,
  onRemoveMember,
  onMemberTargetChange
}: {
  modelKey: string
  member: { _key: string; target: string }
  index: number
  options: AggregateStepProps['memberOptions']
  onRemoveMember: AggregateStepProps['onRemoveMember']
  onMemberTargetChange: AggregateStepProps['onMemberTargetChange']
}) {
  const { t } = useTranslation()
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({ id: member._key })

  return (
    <div
      ref={setNodeRef}
      data-testid="aggregate-member-row"
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={cn(
        'flex items-center gap-2 border border-border bg-card p-2',
        isDragging && 'z-10 opacity-60 shadow-[var(--surface-shadow-lg)]'
      )}
    >
      <button
        ref={setActivatorNodeRef}
        type="button"
        data-testid="aggregate-member-grip"
        aria-label={t('workbench.routing.dragHandle')}
        className="flex h-7 w-4 shrink-0 cursor-grab touch-none items-center justify-center text-muted-foreground hover:text-foreground active:cursor-grabbing"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <span className="w-4 shrink-0 text-center text-[10.5px] tabular-nums text-muted-foreground">
        {index + 1}
      </span>
      {index === 0 ? (
        <Badge variant="outline" className="shrink-0 px-1.5 text-[10px] font-normal text-muted-foreground">
          {t('providers.aggregate.drawer.primaryBadge')}
        </Badge>
      ) : null}
      <div className="min-w-0 flex-1">
        <TargetCombobox
          value={member.target}
          onChange={(value) => onMemberTargetChange(modelKey, member._key, value)}
          options={options}
          placeholder={t('providers.aggregate.drawer.memberPlaceholder')}
          ariaLabel={t('providers.aggregate.drawer.memberTarget')}
        />
      </div>
      <Button
        variant="ghost"
        size="icon"
        data-testid="aggregate-member-delete"
        className="h-7 w-7 shrink-0 text-muted-foreground hover:text-destructive"
        onClick={() => onRemoveMember(modelKey, member._key)}
        aria-label={t('common.delete')}
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </Button>
    </div>
  )
}
