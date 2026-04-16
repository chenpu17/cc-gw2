import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Input } from '@/components/ui/input'
import { cn } from '@/lib/utils'

export interface TargetOption {
  value: string
  label: string
}

export function TargetCombobox({
  value,
  onChange,
  options,
  disabled,
  placeholder
}: {
  value: string
  onChange: (value: string) => void
  options: TargetOption[]
  disabled?: boolean
  placeholder?: string
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    if (!search.trim()) return options
    const lower = search.toLowerCase()
    return options.filter(
      (option) => option.label.toLowerCase().includes(lower) || option.value.toLowerCase().includes(lower)
    )
  }, [options, search])

  const selectOption = (nextValue: string) => {
    onChange(nextValue)
    setSearch('')
    setOpen(false)
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen)
        if (nextOpen) {
          setSearch('')
        }
      }}
    >
      <PopoverTrigger asChild>
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
        />
      </PopoverTrigger>
      <PopoverContent
        className="max-h-60 w-[var(--radix-popover-trigger-width)] overflow-y-auto rounded-xl border border-[color:var(--surface-border)] bg-popover/96 p-1.5 shadow-[var(--surface-shadow-lg)] backdrop-blur"
        align="start"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {filtered.length === 0 ? (
          <div className="px-2 py-3 text-center text-xs text-muted-foreground">{t('common.noMatches')}</div>
        ) : (
          filtered.map((option) => (
            <button
              key={option.value}
              type="button"
              className={cn(
                'flex w-full items-center rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                option.value === value.trim() && 'bg-accent/90 text-accent-foreground'
              )}
              onMouseDown={(event) => {
                event.preventDefault()
                selectOption(option.value)
              }}
            >
              <span className="truncate">{option.label}</span>
            </button>
          ))
        )}
      </PopoverContent>
    </Popover>
  )
}
