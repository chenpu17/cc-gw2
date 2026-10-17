import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import type { BalanceAdapterId } from '@/types/providers'
import type { FormErrors, FormKey, FormState } from './ProviderDrawerSteps'

const BALANCE_ADAPTER_OPTIONS: Array<{ value: BalanceAdapterId; label: string }> = [
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'moonshot', label: 'Moonshot / Kimi' },
  { value: 'siliconflow', label: 'SiliconFlow' },
  { value: 'openrouter', label: 'OpenRouter' }
]

export interface SurfacesSectionProps {
  form: FormState
  errors: FormErrors
  onKeyChange: (index: number, patch: Partial<FormKey>) => void
  onAddKey: () => void
  onRemoveKey: (index: number) => void
}

/**
 * Named keys inline table for the provider detail panel.
 * Non-aggregate providers only.
 */
export function ProviderSurfacesSection({
  form,
  errors,
  onKeyChange,
  onAddKey,
  onRemoveKey
}: SurfacesSectionProps) {
  const { t } = useTranslation()
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set())

  const toggleReveal = (key: string) => {
    setRevealedKeys((previous) => {
      const next = new Set(previous)
      if (next.has(key)) {
        next.delete(key)
      } else {
        next.add(key)
      }
      return next
    })
  }

  return (
    <section className="space-y-3" aria-labelledby="provider-keys-fields">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-1">
          <h3 id="provider-keys-fields" className="text-sm font-semibold">
            {form.keys.length > 0
              ? `${t('providers.keys.title')} (${form.keys.length})`
              : t('providers.keys.title')}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {t('providers.keys.hint')}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddKey}
          className="bg-card text-xs"
        >
          {t('providers.keys.add')}
        </Button>
      </div>

      {form.keys.length > 0 ? (
        <div className="divide-y divide-border border border-border">
          {form.keys.map((key, index) => {
            const error = errors.keys?.[key._key]
            return (
              <div key={key._key} className="space-y-2 p-3" data-testid="provider-key-row">
                <div className="grid gap-2 md:grid-cols-[auto_minmax(0,0.8fr)_minmax(0,0.8fr)_minmax(0,2fr)_auto_auto] md:items-center">
                  <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <input
                      type="radio"
                      name={`provider-active-key-${form.id}`}
                      checked={key.active}
                      onChange={() => onKeyChange(index, { active: true })}
                      aria-label={t('providers.keys.active')}
                      className="h-4 w-4 accent-primary"
                    />
                    {t('providers.keys.active')}
                  </label>
                  <Input
                    value={key.id}
                    onChange={(event) => onKeyChange(index, { id: event.target.value })}
                    placeholder={t('providers.keys.idPlaceholder')}
                    aria-label={t('providers.keys.id')}
                    className="h-8 text-xs"
                    aria-invalid={Boolean(error)}
                  />
                  <Input
                    value={key.label}
                    onChange={(event) => onKeyChange(index, { label: event.target.value })}
                    placeholder={t('providers.keys.labelPlaceholder')}
                    aria-label={t('providers.keys.label')}
                    className="h-8 text-xs"
                  />
                  <div className="flex gap-1.5">
                    <Input
                      type={revealedKeys.has(key._key) ? 'text' : 'password'}
                      value={key.value}
                      onChange={(event) => onKeyChange(index, { value: event.target.value })}
                      placeholder={t('providers.keys.valuePlaceholder')}
                      aria-label={t('providers.keys.value')}
                      autoComplete="off"
                      className="h-8 font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 shrink-0 px-0"
                      onClick={() => toggleReveal(key._key)}
                      aria-label={
                        revealedKeys.has(key._key)
                          ? t('providers.keys.hide')
                          : t('providers.keys.reveal')
                      }
                    >
                      {revealedKeys.has(key._key) ? (
                        <EyeOff className="h-4 w-4" aria-hidden="true" />
                      ) : (
                        <Eye className="h-4 w-4" aria-hidden="true" />
                      )}
                    </Button>
                  </div>
                  <span className="text-right">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-auto px-2 text-xs text-destructive"
                      onClick={() => onRemoveKey(index)}
                    >
                      {t('common.delete')}
                    </Button>
                  </span>
                </div>
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t('providers.keys.empty')}
        </p>
      )}
    </section>
  )
}

/** Balance adapter picker — small standalone select used by the balance section. */
export function BalanceAdapterSelect({
  value,
  onChange
}: {
  value: '' | BalanceAdapterId
  onChange: (value: '' | BalanceAdapterId) => void
}) {
  const { t } = useTranslation()
  return (
    <Select value={value || 'none'} onValueChange={(next) => onChange(next === 'none' ? '' : (next as BalanceAdapterId))}>
      <SelectTrigger className="h-8 w-[220px] text-xs" aria-label={t('providers.balance.adapter')}>
        <SelectValue placeholder={t('providers.balance.adapterNone')} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">{t('providers.balance.adapterNone')}</SelectItem>
        {BALANCE_ADAPTER_OPTIONS.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
