import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { ProviderConfig, ProviderPreset, ProviderPresetsResponse } from '@/types/providers'
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
  PROVIDER_ENDPOINT_PROTOCOL_OPTIONS,
  PROVIDER_TYPE_PRESETS
} from './ProviderDrawerSteps'

/** Select value grammar: `preset:<catalogId>` | `manual:<type>` */
const PRESET_PREFIX = 'preset:'
const MANUAL_PREFIX = 'manual:'

/** Manual templates: just the two protocol families — vendor specifics are
 * the preset catalog's job. Aggregate stays as a third option because it is
 * a provider kind, not a protocol template. */
const MANUAL_TEMPLATE_OPTIONS: Array<{
  value: NonNullable<ProviderConfig['type']>
  labelKey: string
}> = [
  { value: 'openai', labelKey: 'providers.presets.manualOpenAiCompatible' },
  { value: 'anthropic', labelKey: 'providers.presets.manualAnthropicCompatible' },
  { value: 'aggregate', labelKey: 'providers.aggregate.typeLabel' }
]

interface CreateProviderDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  existingProviderIds: string[]
  /** Shared create save (appends + toasts); throws on failure. */
  onSubmit: (payload: ProviderConfig) => Promise<void>
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
  existingProviderIds,
  onSubmit,
  onCreated
}: CreateProviderDialogProps) {
  const { t, i18n } = useTranslation()
  const [template, setTemplate] = useState('')
  const [providerId, setProviderId] = useState('')
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  // Dual-protocol presets: editable Base URL per extra protocol endpoint,
  // seeded from the catalog and stored by endpoint id.
  const [endpointUrls, setEndpointUrls] = useState<Record<string, string>>({})
  const [error, setError] = useState<{
    field: 'id' | 'baseUrl' | 'endpointUrl' | null
    endpointId?: string
    message: string
  } | null>(null)
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
    setEndpointUrls({})
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
        setEndpointUrls(Object.fromEntries(preset.endpoints.map((endpoint) => [endpoint.id, endpoint.baseUrl])))
        return
      }
    }
    if (value.startsWith(MANUAL_PREFIX)) {
      const type = value.slice(MANUAL_PREFIX.length) as ProviderConfig['type']
      setBaseUrl(PROVIDER_TYPE_PRESETS[type ?? 'custom']?.baseUrl ?? '')
    }
    setEndpointUrls({})
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

  /** The catalog descriptions are zh on the server; EN overrides live in
   * i18n. `i18n.exists` would match fallback keys too, so gate on the
   * resolved language and fall back to the server text via defaultValue. */
  const describePreset = (preset: ProviderPreset): string => {
    if (!i18n.resolvedLanguage?.startsWith('en')) {
      return preset.description
    }
    return t(`providers.presets.catalog.${preset.id}`, { defaultValue: preset.description })
  }

  const handleSubmit = async () => {
    const trimmedId = providerId.trim()
    const trimmedUrl = baseUrl.trim()
    if (!trimmedId) {
      setError({ field: 'id', message: t('providers.drawer.errors.idRequired') })
      return
    }
    if (existingProviderIds.includes(trimmedId)) {
      setError({ field: 'id', message: t('providers.drawer.errors.idDuplicate') })
      return
    }
    if (!isAggregate) {
      if (!trimmedUrl) {
        setError({ field: 'baseUrl', message: t('providers.drawer.errors.baseUrlInvalid') })
        return
      }
      try {
        // eslint-disable-next-line no-new
        new URL(trimmedUrl)
      } catch {
        setError({ field: 'baseUrl', message: t('providers.drawer.errors.baseUrlInvalid') })
        return
      }
      for (const endpoint of selectedPreset?.endpoints ?? []) {
        const trimmedEndpointUrl = (endpointUrls[endpoint.id] ?? endpoint.baseUrl).trim()
        try {
          // eslint-disable-next-line no-new
          new URL(trimmedEndpointUrl)
        } catch {
          setError({
            field: 'endpointUrl',
            endpointId: endpoint.id,
            message: t('providers.endpoints.errors.baseUrlInvalid')
          })
          return
        }
      }
    }

    const type: ProviderConfig['type'] = selectedPreset
      ? selectedPreset.type
      : manualType ?? 'custom'
    const defaultAuthMode = defaultAuthModeForType(type)
    const payload: ProviderConfig = {
      id: trimmedId,
      label: label.trim() || trimmedId,
      type,
      baseUrl: isAggregate ? undefined : trimmedUrl,
      // Mirror the edit path's serialize(): a default apiKey-mode for
      // non-anthropic types stays unset instead of being persisted.
      authMode: defaultAuthMode === 'apiKey' && type !== 'anthropic' ? undefined : defaultAuthMode,
      ...(selectedPreset?.balanceAdapter ? { balanceAdapter: selectedPreset.balanceAdapter } : null),
      // Dual-protocol presets carry the vendor's other wire surface so both
      // protocols are native from the start (keys are shared); the URLs are
      // editable above and default to the catalog entries.
      ...(selectedPreset && selectedPreset.endpoints.length > 0
        ? {
            endpoints: selectedPreset.endpoints.map((endpoint) => ({
              id: endpoint.id,
              protocol: endpoint.protocol,
              baseUrl: (endpointUrls[endpoint.id] ?? endpoint.baseUrl).trim()
            }))
          }
        : null)
    }
    if (selectedPreset && selectedPreset.defaultModels.length > 0) {
      payload.models = selectedPreset.defaultModels.map((id) => ({ id }))
      payload.defaultModel = selectedPreset.defaultModels[0]
    }

    setSaving(true)
    try {
      await onSubmit(payload)
    } catch (saveError) {
      setSaving(false)
      setError({
        field: null,
        message: t('providers.drawer.toast.saveFailure', { message: toApiError(saveError).message })
      })
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
                  {MANUAL_TEMPLATE_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={`${MANUAL_PREFIX}${option.value}`}>
                      {t(option.labelKey)}
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
                aria-invalid={error?.field === 'id'}
                aria-describedby={error ? 'create-provider-error' : undefined}
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
                aria-invalid={error?.field === 'baseUrl'}
                aria-describedby={error ? 'create-provider-error' : undefined}
              />
            </Label>
          )}

          {selectedPreset && selectedPreset.endpoints.length > 0 && !isAggregate ? (
            <div className="space-y-2">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('providers.presets.endpointsHint')}
              </p>
              {selectedPreset.endpoints.map((endpoint) => {
                const protocolLabel =
                  PROVIDER_ENDPOINT_PROTOCOL_OPTIONS.find((option) => option.value === endpoint.protocol)?.label ??
                  endpoint.protocol
                return (
                  <Label key={endpoint.id} className="flex flex-col gap-2 text-sm">
                    <span className="text-xs text-muted-foreground">
                      {t('providers.presets.endpointBaseUrl', { protocol: protocolLabel })}
                    </span>
                    <Input
                      value={endpointUrls[endpoint.id] ?? endpoint.baseUrl}
                      onChange={(event) =>
                        setEndpointUrls((previous) => ({ ...previous, [endpoint.id]: event.target.value }))
                      }
                      aria-invalid={
                        error?.field === 'endpointUrl' && error.endpointId === endpoint.id
                      }
                      aria-describedby={error ? 'create-provider-error' : undefined}
                    />
                  </Label>
                )
              })}
            </div>
          ) : null}

          {error ? (
            <p id="create-provider-error" className="text-xs text-destructive" aria-live="polite">
              {error.message}
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
