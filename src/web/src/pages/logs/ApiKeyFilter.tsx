import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import { cn } from '@/lib/utils'
import { Label } from '@/components/ui/label'

interface ApiKeyFilterProps {
  apiKeys: ApiKeySummary[]
  selected: number[]
  onChange: (next: number[]) => void
  disabled?: boolean
  className?: string
}

export function ApiKeyFilter({
  apiKeys,
  selected,
  onChange,
  disabled,
  className
}: ApiKeyFilterProps) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const handle = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false)
      }
    }
    window.addEventListener('mousedown', handle)
    return () => window.removeEventListener('mousedown', handle)
  }, [open])

  const selectedLabels = useMemo(() => {
    if (selected.length === 0) return []
    const mapping = new Map<number, ApiKeySummary>()
    for (const key of apiKeys) {
      mapping.set(key.id, key)
    }
    return selected
      .map((id) => {
        const key = mapping.get(id)
        if (!key) return null
        if (key.isWildcard) {
          return t('apiKeys.wildcard')
        }
        return key.name
      })
      .filter((value): value is string => Boolean(value))
  }, [apiKeys, selected, t])

  const summaryText = selected.length === 0
    ? t('logs.filters.apiKeyAll')
    : t('logs.filters.apiKeySelected', { count: selected.length })

  const handleToggle = (id: number) => {
    if (selected.includes(id)) {
      onChange(selected.filter((item) => item !== id))
    } else {
      onChange([...selected, id])
    }
  }

  return (
    <div className={cn('relative space-y-2', className)} ref={containerRef}>
      <Label>{t('logs.filters.apiKey')}</Label>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled || apiKeys.length === 0}
        title={t('logs.filters.apiKeyHint')}
        className={cn(
          'flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 text-sm ring-offset-background transition-all focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
          selected.length > 0 && 'border-primary',
          open && 'ring-2 ring-ring ring-offset-2'
        )}
      >
        <span className="truncate">
          {summaryText}
          {selectedLabels.length > 0 && (
            <span className="ml-1 text-xs text-muted-foreground">
              {selectedLabels.join(', ')}
            </span>
          )}
        </span>
        <svg
          className={cn('h-4 w-4 opacity-50 transition-transform', open && 'rotate-180')}
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.25a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
            clipRule="evenodd"
          />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-30 mt-2 w-64 rounded-lg border bg-popover p-2 shadow-[var(--surface-shadow-lg)]">
          <div className="flex items-center justify-between rounded-lg bg-secondary px-3 py-2 text-xs">
            <span>{summaryText}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              disabled={selected.length === 0}
              className="text-primary hover:underline disabled:opacity-40"
            >
              {t('common.actions.reset')}
            </button>
          </div>
          <div className="max-h-56 overflow-y-auto py-2">
            {apiKeys.map((key) => {
              const label = key.isWildcard ? t('apiKeys.wildcard') : key.name
              const checked = selected.includes(key.id)
              return (
                <label
                  key={key.id}
                  className={cn(
                    'flex cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition hover:bg-primary/5',
                    checked && 'bg-primary/10 text-primary'
                  )}
                >
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border"
                    checked={checked}
                    onChange={() => handleToggle(key.id)}
                  />
                  <span className="truncate">{label}</span>
                </label>
              )
            })}
            {apiKeys.length === 0 && (
              <p className="px-2 py-2 text-xs text-muted-foreground">
                {t('logs.filters.apiKeyAll')}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
