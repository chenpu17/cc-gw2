import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toApiError } from '@/services/api'
import { gatewayApi } from '@/services/gateway'
import { queryKeys } from '@/services/queryKeys'
import type {
  GatewayConfig,
  ProviderConfig,
  ProviderPreset,
  ProviderPresetsResponse
} from '@/types/providers'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  AppDialogBody,
  AppDialogContent,
  AppDialogFooter,
  AppDialogHeader
} from '@/components/DialogShell'
import { Dialog, DialogDescription, DialogTitle } from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { useApiQuery } from '@/hooks/useApiQuery'
import {
  defaultAuthModeForType,
  PROVIDER_TYPE_OPTIONS,
  PROVIDER_TYPE_PRESETS
} from './ProviderDrawerSteps'

/** Select value grammar: `preset:<catalogId>` | `manual:<type>` */
const PRESET_PREFIX = 'preset:'
const MANUAL_PREFIX = 'manual:'

interface CreateProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  config: GatewayConfig | null
  existingProviderIds: string[]
  /** Called with the new provider id after a successful save. */
  onCreated: (providerId: string) => void
}

/**
 * Small create dialog: pick a preset template (or manual type), fill
 * id/label/baseUrl, land in the detail panel for everything else (keys,
 * endpoints, models). The catalog comes from `GET /api/provider-presets`.
 */
export function CreateProviderDialog({
  open,
  onOpenChange,
  config,
  existingProviderIds,
  onCreated
}: CreateProviderDialogProps) {
  const { t, i18n } = useTranslation()
  const [template, setTemplate] = useState('')
  const [providerId, setProviderId] = useState('')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const presetsQuery = useApiQuery<ProviderPresetsResponse>(
    queryKeys.providers.presets(),
    { url: '/api/provider-presets', method: 'GET' },
    { retry: false, staleTime: Infinity, enabled: open }
  )
  const presets = useMemo(() => presetsQuery.data?.presets ?? [], [presetsQuery.data])

  const reset = () => {
    setTemplate('')
    setProviderId('')
    setLabel('')
    setBaseUrl('')
    setError(null)
    setSaving(false)
  }

  const close = (next: boolean) => {
    if (!next) {
      onOpenChange(false)
      reset()
    }
  }

  const applyTemplate = (value: string) => {
    setTemplate(value)
    setError(null)
    if (value.startsWith(PRESET_PREFIX)) {
      const preset = presets.find((item) => item.id === value.slice(PRESET_PREFIX.length))
      if (preset) {
        setBaseUrl(preset.baseUrl)
        return
      }
    }
    if (value.startsWith(MANUAL_PREFIX)) {
      const type = value.slice(MANUAL_PREFIX.length) as ProviderConfig['type']
      setBaseUrl(PROVIDER_TYPE_PRESETS[type ?? 'custom']?.baseUrl ?? '')
    }
  }

  const handleProviderIdChange = (value: string) => {
    setProviderId(value)
    // Label syncs with the id while empty or still equal to the previous id.
    if (!label.trim() || label === providerId) {
      setLabel(value)
    }
  }

  const selectedPreset: ProviderPreset | undefined = template.startsWith(PRESET_PREFIX)
    ? presets.find((item) => item.id === template.slice(PRESET_PREFIX.length))
    : undefined
  const manualType: ProviderConfig['type'] = template.startsWith(MANUAL_PREFIX)
    ? (template.slice(MANUAL_PREFIX.length) as ProviderConfig['type'])
    : undefined
  const isAggregate = manualType === 'aggregate'

  /** EN locale overrides the zh catalog description when a translation exists. */
  const describePreset = (preset: ProviderPreset): string => {
    const key = `providers.presets.catalog.${preset.id}`
    return i18n.exists(key) ? t(key) : preset.description
  }

  const handleSubmit = async () => {
    if (!config) {
      setError(t('providers.presets.errors.missingConfig'))
      return
    }
    const trimmedId = providerId.trim()
    const trimmedUrl = baseUrl.trim()
    if (!trimmedId) {
      setError(t('providers.drawer.errors.idRequired'))
      return
    }
    if (existingProviderIds.includes(trimmedId)) {
      setError(t('providers.drawer.errors.idDuplicate'))
      return
    }
    if (!isAggregate) {
      if (!trimmedUrl) {
        setError(t('providers.drawer.errors.baseUrlInvalid'))
        return
      }
      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl)
      } catch {
        setError(t('providers.drawer.errors.baseUrlInvalid'))
        return
      }
    }

    const type: ProviderConfig['type'] = selectedPreset
      ? selectedPreset.type
      : manualType ?? 'custom'
    const payload: ProviderConfig = {
      id: trimmedId,
      label: label.trim() || trimmedId,
      type,
      baseUrl: isAggregate ? undefined : trimmedUrl,
      authMode: defaultAuthModeForType(type),
      ...(selectedPreset?.balanceAdapter ? { balanceAdapter: selectedPreset.balanceAdapter } : null)
    }
    if (selectedPreset && selectedPreset.defaultModels.length > 0) {
      payload.models = selectedPreset.defaultModels.map((id) => ({ id }))
      payload.defaultModel = selectedPreset.defaultModels[0]
    }

    setSaving(true)
    try {
      const nextConfig: GatewayConfig = { ...config, providers: [...config.providers, payload] }
      await gatewayApi.saveConfig(nextConfig)
    } catch (saveError) {
      setSaving(false)
      setError(t('providers.drawer.toast.saveFailure', { message: toApiError(saveError).message }))
      return
    }
    onCreated(trimmedId)
    close(false)
  }

  return (
    <Dialog open={open} onOpenChange={close}>
      <AppDialogContent className="max-w-lg">
        <AppDialogHeader>
          <DialogTitle>{t('providers.presets.title')}</DialogTitle>
          <DialogDescription>{t('providers.presets.description')}</DialogDescription>
        </AppDialogHeader>
        <AppDialogBody className="space-y-4">
          <Label className="flex flex-col gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('providers.presets.template')}</span>
            <Select value={template} onValueChange={applyTemplate}>
              <SelectTrigger aria-label={t('providers.presets.template')}>
                <SelectValue placeholder={t('providers.presets.templatePlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                {presets.length > 0 ? (
                  <SelectGroup>
                    <SelectLabel>{t('providers.presets.groupPresets')}</SelectLabel>
                    {presets.map((preset) => (
                      <SelectItem key={preset.id} value={`${PRESET_PREFIX}${preset.id}`}>
                        <span className="flex flex-col">
                          <span>{preset.label}</span>
                          <span className="text-[11px] text-muted-foreground">
                            {describePreset(preset)}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : null}
                <SelectGroup>
                  <SelectLabel>{t('providers.presets.groupManual')}</SelectLabel>
                  {PROVIDER_TYPE_OPTIONS.map((option) => (
                    <SelectItem key={option.value ?? 'custom'} value={`${MANUAL_PREFIX}${option.value ?? 'custom'}`}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </Label>

          {selectedPreset ? (
            <p className="border border-border bg-secondary/50 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
              {describePreset(selectedPreset)}
              {selectedPreset.noModelProbe
                ? ` ${t('providers.presets.noModelProbeNote')}`
                : ''}
            </p>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <Label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.id')}</span>
              <Input
                value={providerId}
                onChange={(event) => handleProviderIdChange(event.target.value)}
                placeholder={t('providers.drawer.fields.idPlaceholder')}
                aria-invalid={Boolean(error)}
              />
            </Label>
            <Label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.label')}</span>
              <Input
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={t('providers.drawer.fields.labelPlaceholder')}
              />
            </Label>
          </div>

          {isAggregate ? (
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('providers.aggregate.drawer.explainerBody')}
            </p>
          ) : (
            <Label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.baseUrl')}</span>
              <Input
                value={baseUrl}
                onChange={(event) => setBaseUrl(event.target.value)}
                placeholder={t('providers.drawer.fields.baseUrlPlaceholder')}
                aria-invalid={Boolean(error)}
              />
            </Label>
          )}

          {error ? (
            <p className="text-xs text-destructive" aria-live="polite">
              {error}
            </p>
          ) : null}
        </AppDialogBody>
        <AppDialogFooter>
          <Button variant="outline" onClick={() => close(false)} disabled={saving}>
            {t('common.actions.cancel')}
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={saving || !template}>
            {saving ? t('common.actions.saving') : t('providers.presets.createAction')}
          </Button>
        </AppDialogFooter>
      </AppDialogContent>
    </Dialog>
  )
}
