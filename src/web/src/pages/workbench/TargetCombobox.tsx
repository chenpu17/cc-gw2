import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight } from 'lucide-react'
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { usePersistentState } from '@/hooks/usePersistentState'
import { cn } from '@/lib/utils'
import { storageKeys } from '@/services/storageKeys'

export interface TargetOption {
  value: string
  label: string
  providerId?: string
  providerLabel?: string
  modelId?: string
  modelLabel?: string
  kind?: 'model' | 'passthrough' | 'custom'
  isDefault?: boolean
}

interface OptionGroup {
  key: string
  label: string
  options: TargetOption[]
  muted?: boolean
}

const RECENT_LIMIT = 3

export function TargetCombobox({
  value,
  onChange,
  options,
  disabled,
  placeholder,
  ariaLabel
}: {
  value: string
  onChange: (value: string) => void
  options: TargetOption[]
  disabled?: boolean
  placeholder?: string
  ariaLabel?: string
}) {
  const { t } = useTranslation()
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // Browse mode (empty search) drills down provider-first: providers render as
  // collapsible rows and only the expanded one lists its models. One at a time
  // keeps the panel scannable; typing a search bypasses the drill-down.
  const [expandedProviderKey, setExpandedProviderKey] = useState<string | null>(null)
  const searchInputRef = useRef<HTMLInputElement | null>(null)
  const suppressImmediateReopenRef = useRef(false)
  const [recentTargets, setRecentTargets] = usePersistentState<string[]>(
    storageKeys.modelManagement.recentRouteTargets,
    []
  )

  const optionByValue = useMemo(() => {
    const map = new Map<string, TargetOption>()
    for (const option of options) {
      map.set(option.value, option)
    }
    return map
  }, [options])

  const matchesSearch = (option: TargetOption, normalizedSearch: string) => {
    if (!normalizedSearch) return true
    return [
      option.label,
      option.value,
      option.providerId ?? '',
      option.providerLabel ?? '',
      option.modelId ?? '',
      option.modelLabel ?? ''
    ]
      .join(' ')
      .toLowerCase()
      .includes(normalizedSearch)
  }

  // All options indexed by provider (insertion order preserved), plus the
  // provider-less/custom leftovers. Shared by both modes.
  const { providerGroups, customOptions } = useMemo(() => {
    const groups = new Map<string, OptionGroup>()
    const custom: TargetOption[] = []
    for (const option of options) {
      if (option.kind === 'custom' || !option.providerId) {
        custom.push(option)
        continue
      }
      const key = `provider:${option.providerId}`
      const existing = groups.get(key)
      if (existing) {
        existing.options.push(option)
      } else {
        groups.set(key, {
          key,
          label: option.providerLabel ?? option.providerId,
          options: [option]
        })
      }
    }
    return { providerGroups: [...groups.values()], customOptions: custom }
  }, [options])

  const isSearching = search.trim().length > 0

  // Search mode: flat filtered groups (recent + per-provider matches + custom),
  // like the pre-drill-down list — typing is the power path.
  const searchGroups = useMemo<OptionGroup[]>(() => {
    const normalizedSearch = search.trim().toLowerCase()
    const filteredOptions = options.filter((option) => matchesSearch(option, normalizedSearch))
    const recentOptions = recentTargets
      .map((target) => optionByValue.get(target) ?? (normalizedSearch ? undefined : { value: target, label: target, kind: 'custom' as const }))
      .filter((option): option is TargetOption => Boolean(option))
      .filter((option) => matchesSearch(option, normalizedSearch))
      .slice(0, RECENT_LIMIT)
    const nextGroups: OptionGroup[] = []

    if (recentOptions.length > 0) {
      nextGroups.push({
        key: 'recent',
        label: t('modelManagement.targetPicker.recent'),
        options: recentOptions
      })
    }

    const filteredCustom: TargetOption[] = []
    const matchedProviders = new Map<string, OptionGroup>()
    for (const option of filteredOptions) {
      if (option.kind === 'custom' || !option.providerId) {
        filteredCustom.push(option)
        continue
      }
      const key = `provider:${option.providerId}`
      const existing = matchedProviders.get(key)
      if (existing) {
        existing.options.push(option)
      } else {
        matchedProviders.set(key, {
          key,
          label: option.providerLabel ?? option.providerId,
          options: [option]
        })
      }
    }

    nextGroups.push(...matchedProviders.values())
    if (filteredCustom.length > 0) {
      nextGroups.push({
        key: 'custom',
        label: t('modelManagement.targetPicker.custom'),
        options: filteredCustom,
        muted: true
      })
    }

    return nextGroups
  }, [optionByValue, options, recentTargets, search, t])

  const filteredCount = searchGroups.reduce((sum, group) => sum + group.options.length, 0)

  const selectOption = (nextValue: string) => {
    onChange(nextValue)
    setRecentTargets((previous) => [
      nextValue,
      ...previous.filter((target) => target !== nextValue)
    ].slice(0, RECENT_LIMIT))
    setSearch('')
    suppressImmediateReopenRef.current = true
    if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }
    setOpen(false)
    if (typeof window !== 'undefined') {
      window.requestAnimationFrame(() => {
        suppressImmediateReopenRef.current = false
      })
    } else {
      suppressImmediateReopenRef.current = false
    }
  }

  const kindLabel = (option: TargetOption) => {
    if (option.kind === 'passthrough') return t('modelManagement.targetPicker.passthrough')
    if (option.kind === 'custom') return t('modelManagement.targetPicker.customValue')
    return t('modelManagement.targetPicker.model')
  }

  const primaryLabel = (option: TargetOption) => {
    if (option.kind === 'passthrough' || option.kind === 'custom') {
      return option.label
    }
    return option.modelLabel ?? option.label
  }

  const renderOptionRow = (group: OptionGroup, option: TargetOption, indent = false) => (
    <button
      key={`${group.key}-${option.value}`}
      type="button"
      role="option"
      aria-selected={option.value === value.trim()}
      className={cn(
        'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        indent && 'pl-7',
        option.value === value.trim() && 'bg-accent text-accent-foreground'
      )}
      onMouseDown={(event) => {
        event.preventDefault()
      }}
      onClick={() => selectOption(option.value)}
    >
      <span className="min-w-0 flex-1">
        <span className="block truncate font-medium">
          {primaryLabel(option)}
        </span>
        <span className="block truncate text-xs text-muted-foreground">
          {option.value}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-1">
        {option.isDefault ? (
          <Badge variant="secondary" className="text-[10px]">
            {t('modelManagement.targetPicker.default')}
          </Badge>
        ) : null}
        <Badge variant={option.kind === 'passthrough' ? 'outline' : 'secondary'} className="text-[10px]">
          {kindLabel(option)}
        </Badge>
      </span>
    </button>
  )

  const renderGroupHeader = (group: OptionGroup) => (
    <div className={cn(
      'sticky top-0 z-10 flex items-center justify-between bg-popover px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground',
      group.muted && 'opacity-80'
    )}>
      <span className="truncate">{group.label}</span>
      <span>{group.options.length}</span>
    </div>
  )

  const recentBrowseOptions = recentTargets
    .map((target) => optionByValue.get(target) ?? { value: target, label: target, kind: 'custom' as const })
    .slice(0, RECENT_LIMIT)

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen && suppressImmediateReopenRef.current) {
          return
        }
        setOpen(nextOpen)
        if (nextOpen) {
          setSearch('')
          setExpandedProviderKey(null)
        }
      }}
    >
      {/* Anchor instead of Trigger: Radix's trigger toggles the popover on
          click, which fights the combobox's open-on-focus behavior (mousedown
          focuses the input and opens the popover, the trailing click would
          toggle it shut). Open state is fully controlled by the input below. */}
      <PopoverAnchor asChild>
        <Input
          value={value}
          onChange={(event) => {
            onChange(event.target.value)
            setSearch(event.target.value)
            if (!open) setOpen(true)
          }}
          onFocus={() => {
            setSearch('')
            setOpen(true)
          }}
          onClick={() => {
            if (!open) setOpen(true)
          }}
          placeholder={placeholder}
          disabled={disabled}
          autoComplete="off"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={open}
          aria-controls={listboxId}
          aria-autocomplete="list"
        />
      </PopoverAnchor>
      <PopoverContent
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-popover p-0 shadow-[var(--surface-shadow-lg)]"
        style={{ width: 'max(var(--radix-popover-trigger-width), 360px)' }}
        align="start"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchInputRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          // Inside the route editor dialog, returning focus to the trigger
          // would re-open the popover (the trigger opens on focus) and leave
          // it covering the save buttons. Selection already blurs explicitly.
          event.preventDefault()
        }}
      >
        <div className="space-y-2 border-b border-border px-3 py-3">
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('modelManagement.targetPicker.searchPlaceholder')}
            className="h-9"
            autoComplete="off"
          />
          <div className="text-xs text-muted-foreground">
            {isSearching
              ? t('modelManagement.targetPicker.matchCount', { count: filteredCount })
              : t('modelManagement.targetPicker.helper')}
          </div>
        </div>
        {isSearching && filteredCount === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t('common.noMatches')}</div>
        ) : (
          <div id={listboxId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {isSearching ? (
              searchGroups.map((group) => (
                <div key={group.key} className="py-1">
                  {renderGroupHeader(group)}
                  <div className="space-y-1">
                    {group.options.map((option) => renderOptionRow(group, option))}
                  </div>
                </div>
              ))
            ) : (
              <>
                {recentBrowseOptions.length > 0 ? (
                  <div className="py-1">
                    {renderGroupHeader({
                      key: 'recent',
                      label: t('modelManagement.targetPicker.recent'),
                      options: recentBrowseOptions
                    })}
                    <div className="space-y-1">
                      {recentBrowseOptions.map((option) =>
                        renderOptionRow({ key: 'recent', label: '', options: [] }, option)
                      )}
                    </div>
                  </div>
                ) : null}
                <div className="py-1">
                  {providerGroups.map((group) => {
                    const expanded = expandedProviderKey === group.key
                    return (
                      <div key={group.key}>
                        <button
                          type="button"
                          aria-expanded={expanded}
                          className={cn(
                            'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                            expanded && 'bg-accent text-accent-foreground'
                          )}
                          onMouseDown={(event) => {
                            event.preventDefault()
                          }}
                          onClick={() => setExpandedProviderKey(expanded ? null : group.key)}
                        >
                          <ChevronRight
                            className={cn('h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform', expanded && 'rotate-90')}
                            aria-hidden
                          />
                          <span className="min-w-0 flex-1 truncate font-medium">{group.label}</span>
                          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                            {t('modelManagement.targetPicker.modelCount', { count: group.options.length })}
                          </span>
                        </button>
                        {expanded ? (
                          <div className="space-y-1 pb-1">
                            {group.options.map((option) => renderOptionRow(group, option, true))}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}
                </div>
                {customOptions.length > 0 ? (
                  <div className="py-1">
                    {renderGroupHeader({
                      key: 'custom',
                      label: t('modelManagement.targetPicker.custom'),
                      options: customOptions,
                      muted: true
                    })}
                    <div className="space-y-1">
                      {customOptions.map((option) =>
                        renderOptionRow({ key: 'custom', label: '', options: [] }, option)
                      )}
                    </div>
                  </div>
                ) : null}
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
