import { useId, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const RECENT_LIMIT = 6

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

  const groups = useMemo<OptionGroup[]>(() => {
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

    const providerGroups = new Map<string, OptionGroup>()
    const customOptions: TargetOption[] = []
    for (const option of filteredOptions) {
      if (option.kind === 'custom' || !option.providerId) {
        customOptions.push(option)
        continue
      }

      const key = `provider:${option.providerId}`
      const existing = providerGroups.get(key)
      if (existing) {
        existing.options.push(option)
      } else {
        providerGroups.set(key, {
          key,
          label: option.providerLabel ?? option.providerId,
          options: [option]
        })
      }
    }

    nextGroups.push(...providerGroups.values())
    if (customOptions.length > 0) {
      nextGroups.push({
        key: 'custom',
        label: t('modelManagement.targetPicker.custom'),
        options: customOptions,
        muted: true
      })
    }

    return nextGroups
  }, [optionByValue, options, recentTargets, search, t])

  const filteredCount = groups.reduce((sum, group) => sum + group.options.length, 0)

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
        className="flex max-h-[min(28rem,var(--radix-popover-content-available-height))] flex-col overflow-hidden rounded-xl border border-[color:var(--surface-border)] bg-popover/96 p-0 shadow-[var(--surface-shadow-lg)] backdrop-blur"
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
        <div className="space-y-2 border-b border-border/70 px-3 py-3">
          <Input
            ref={searchInputRef}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('modelManagement.targetPicker.searchPlaceholder')}
            className="h-9"
            autoComplete="off"
          />
          <div className="text-xs text-muted-foreground">
            {search.trim()
              ? t('modelManagement.targetPicker.matchCount', { count: filteredCount })
              : t('modelManagement.targetPicker.helper')}
          </div>
        </div>
        {filteredCount === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-muted-foreground">{t('common.noMatches')}</div>
        ) : (
          <div id={listboxId} role="listbox" className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {groups.map((group) => (
              <div key={group.key} className="py-1">
                <div className={cn(
                  'sticky top-0 z-10 flex items-center justify-between bg-popover/95 px-2 py-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground backdrop-blur',
                  group.muted && 'opacity-80'
                )}>
                  <span className="truncate">{group.label}</span>
                  <span>{group.options.length}</span>
                </div>
                <div className="space-y-1">
                  {group.options.map((option) => (
                    <button
                      key={`${group.key}-${option.value}`}
                      type="button"
                      role="option"
                      aria-selected={option.value === value.trim()}
                      className={cn(
                        'flex w-full min-w-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                        option.value === value.trim() && 'bg-accent/90 text-accent-foreground'
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
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
