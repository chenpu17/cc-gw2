import { useState, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, ChevronDown, ChevronUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Disclosure } from '@/components/ui/disclosure'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import type {
  AggregateMemberConfig,
  BalanceAdapterId,
  FailoverPolicyConfig,
  ProviderConfig,
  ProviderEndpointProtocol,
  ProviderModelConfig
} from '@/types/providers'
import { cn } from '@/lib/utils'
import type { ProviderTestResult } from './shared'
import type { TargetOption } from './TargetCombobox'
import { TestResultInline } from './TestResultInline'

export interface FormModel extends Omit<ProviderModelConfig, 'members' | 'failover'> {
  _key: string
  /** Draft-state member chain (aggregate models); array order = priority. */
  members: FormMember[]
  /** Draft failover inputs as strings; empty = keep gateway default. */
  failover: FormFailover
}

export interface FormMember extends AggregateMemberConfig {
  _key: string
}

/** Draft row of the provider's additional protocol endpoints. */
export interface FormEndpoint {
  _key: string
  id: string
  label: string
  protocol: ProviderEndpointProtocol
  baseUrl: string
}

/** Draft row of the provider's named keys; `active` is radio-exclusive. */
export interface FormKey {
  _key: string
  id: string
  label: string
  value: string
  active: boolean
}

export interface FormFailover {
  consecutiveFailures: string
  cooldownSeconds: string
  failureWindowSeconds: string
  triggerStatusCodes: string
}

export interface FormHeader {
  name: string
  value: string
  _key: string
}

/** Per-aggregate-model error messages keyed by the model's `_key`. */
export interface FormErrors {
  id?: string
  baseUrl?: string
  models?: string
  extraHeaders?: string
  rpmLimit?: string
  rpmMaxWaitSeconds?: string
  members?: Record<string, string>
  failover?: Record<string, string>
  endpoints?: Record<string, string>
  keys?: Record<string, string>
}

export interface FormState {
  id: string
  label: string
  baseUrl: string
  apiKey: string
  type: ProviderConfig['type']
  defaultModel: string
  models: FormModel[]
  authMode: 'apiKey' | 'authToken' | 'xAuthToken'
  nonStreamViaStream: boolean
  useAbsoluteUrl: boolean
  streamUsage: boolean
  rpmLimit: string
  rpmMaxWaitSeconds: string
  extraHeaders: FormHeader[]
  endpoints: FormEndpoint[]
  keys: FormKey[]
  /** '' = none; select value shim for the optional balance adapter. */
  balanceAdapter: '' | BalanceAdapterId
}

export type ProviderStepId = 'basics' | 'models'

export interface TestVerificationProps {
  /** false shows a "save first" hint instead of the run button */
  available: boolean
  testing: boolean
  result: ProviderTestResult | null
  onTest: () => void
}

export interface ProbeModelsProps {
  /** false disables the button (e.g. no Base URL yet) */
  available: boolean
  onProbe: () => void
}

export interface ProviderStepShared {
  form: FormState
  errors: FormErrors
  isCreate: boolean
  advancedOpen: boolean
  onAdvancedOpenChange: (open: boolean) => void
  idInputRef: RefObject<HTMLInputElement>
  onProviderIdChange: (value: string) => void
  onFieldChange: (field: keyof FormState) => (value: string) => void
  onTypeChange: (value: ProviderConfig['type']) => void
  onAuthModeChange: (value: FormState['authMode']) => void
  onNonStreamViaStreamChange: (checked: boolean) => void
  onUseAbsoluteUrlChange: (checked: boolean) => void
  onStreamUsageChange: (checked: boolean) => void
  onAddHeader: () => void
  onRemoveHeader: (index: number) => void
  onHeaderChange: (index: number, patch: Partial<FormHeader>) => void
  onModelIdChange: (index: number, value: string) => void
  onModelChange: (index: number, patch: Partial<FormModel>) => void
  onAddModel: () => void
  onRemoveModel: (index: number) => void
  onModelNonStreamViaStreamChange: (index: number, value: string) => void
  onSetDefaultModel: (id: string) => void
  /** Extra protocol endpoint rows; optional — setup wizard doesn't use them. */
  onEndpointChange?: (index: number, patch: Partial<FormState['endpoints'][number]>) => void
  onAddEndpoint?: () => void
  onRemoveEndpoint?: (index: number) => void
  /** Aggregate-model member chain editing (keyed by _key so reorder is safe).
   * Optional: only the workbench drawer wires these; the setup wizard renders
   * concrete provider types only. */
  memberOptions?: TargetOption[]
  onAddMember?: (modelKey: string) => void
  onRemoveMember?: (modelKey: string, memberKey: string) => void
  onMemberTargetChange?: (modelKey: string, memberKey: string, target: string) => void
  onReorderMembers?: (modelKey: string, activeKey: string, overKey: string) => void
  onModelFailoverChange?: (modelKey: string, patch: Partial<FormFailover>) => void
  testVerification?: TestVerificationProps
  probeModels?: ProbeModelsProps
}

export function createKey(): string {
  if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID()
  }
  return Math.random().toString(36).slice(2, 10)
}

export function createEmptyModel(): FormModel {
  return {
    _key: createKey(),
    id: '',
    label: '',
    members: [],
    failover: createEmptyFailover()
  }
}

export function createEmptyMember(): FormMember {
  return {
    _key: createKey(),
    target: ''
  }
}

export function createEmptyFailover(): FormFailover {
  return {
    consecutiveFailures: '',
    cooldownSeconds: '',
    failureWindowSeconds: '',
    triggerStatusCodes: ''
  }
}

export function formFailoverFromConfig(failover?: FailoverPolicyConfig): FormFailover {
  return {
    consecutiveFailures:
      failover?.consecutiveFailures != null ? String(failover.consecutiveFailures) : '',
    cooldownSeconds: failover?.cooldownSeconds != null ? String(failover.cooldownSeconds) : '',
    failureWindowSeconds:
      failover?.failureWindowSeconds != null ? String(failover.failureWindowSeconds) : '',
    triggerStatusCodes: failover?.triggerStatusCodes?.join(', ') ?? ''
  }
}

export function createEmptyHeader(): FormHeader {
  return {
    _key: createKey(),
    name: '',
    value: ''
  }
}

export function createEmptyEndpoint(): FormEndpoint {
  return {
    _key: createKey(),
    id: '',
    label: '',
    protocol: 'anthropic',
    baseUrl: ''
  }
}

export function createEmptyKey(active = false): FormKey {
  return {
    _key: createKey(),
    id: '',
    label: '',
    value: '',
    active
  }
}

export const PROVIDER_TYPE_PRESETS: Record<Exclude<ProviderConfig['type'], undefined> | 'openai', {
  baseUrl?: string
  models?: Array<Omit<FormModel, '_key'>>
  defaultModel?: string
}> = {
  openai: {
    baseUrl: 'https://api.openai.com/v1'
  },
  deepseek: {
    baseUrl: 'https://api.deepseek.com/v1'
  },
  huawei: {
    baseUrl: 'https://api.modelarts-maas.com/v1'
  },
  kimi: {
    baseUrl: 'https://api.moonshot.cn/v1'
  },
  anthropic: {
    baseUrl: 'https://api.anthropic.com/v1'
  },
  custom: {},
  aggregate: {}
}

export const PROVIDER_ENDPOINT_PROTOCOL_OPTIONS: Array<{
  value: ProviderEndpointProtocol
  label: string
}> = [
  { value: 'anthropic', label: 'Anthropic Messages' },
  { value: 'openai', label: 'OpenAI Chat Completions' },
  { value: 'openai-responses', label: 'OpenAI Responses' }
]

export const PROVIDER_TYPE_OPTIONS: Array<{ value: ProviderConfig['type']; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'huawei', label: 'Huawei Cloud' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom' },
  { value: 'aggregate', label: 'Aggregate' }
]

/** Type chips shown in BasicsStep: protocol families only — vendor identity
 * belongs to preset creation; the current vendor type (if any) is pinned as
 * an extra active chip so it stays visible and preserved. */
const TYPE_CHIP_OPTIONS: Array<{ value: NonNullable<ProviderConfig['type']>; labelKey: string }> = [
  { value: 'openai', labelKey: 'providers.presets.manualOpenAiCompatible' },
  { value: 'anthropic', labelKey: 'providers.presets.manualAnthropicCompatible' },
  { value: 'aggregate', labelKey: 'providers.aggregate.typeLabel' }
]

/** Localized label for a provider type; brand names stay untranslated. */
export function providerTypeLabel(
  type: ProviderConfig['type'] | undefined,
  t: (key: string) => string
): string {
  if (type === 'aggregate') return t('providers.aggregate.typeLabel')
  return (
    PROVIDER_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? 'Custom'
  )
}

export const PROVIDER_STEPS: Array<{ id: ProviderStepId; labelKey: string }> = [
  { id: 'basics', labelKey: 'providers.drawer.steps.basics' },
  { id: 'models', labelKey: 'providers.drawer.steps.modelsVerify' }
]

export function defaultAuthModeForType(type: ProviderConfig['type']): FormState['authMode'] {
  return type === 'anthropic' ? 'authToken' : 'apiKey'
}

export function describeAuthMode(
  type: ProviderConfig['type'],
  authMode: FormState['authMode'],
  t: (key: string) => string
): string {
  if (authMode === 'authToken') return t('providers.drawer.fields.authModeAuthToken')
  if (authMode === 'xAuthToken') return t('providers.drawer.fields.authModeXAuthToken')
  if (type === 'anthropic') return t('providers.drawer.fields.authModeApiKey')
  return t('providers.drawer.fields.authModeProviderDefault')
}

export function buildInitialState(provider?: ProviderConfig): FormState {
  if (!provider) {
    return {
      id: '',
      label: '',
      baseUrl: '',
      apiKey: '',
      type: 'custom',
      defaultModel: '',
      models: [],
      authMode: defaultAuthModeForType('custom'),
      nonStreamViaStream: false,
      useAbsoluteUrl: false,
      streamUsage: false,
      rpmLimit: '',
      rpmMaxWaitSeconds: '',
      extraHeaders: [],
      endpoints: [],
      keys: [],
      balanceAdapter: ''
    }
  }

  return {
    id: provider.id,
    label: provider.label ?? provider.id,
    baseUrl: provider.baseUrl ?? '',
    apiKey: provider.apiKey ?? '',
    type: provider.type ?? 'custom',
    defaultModel: provider.defaultModel ?? '',
    models: (provider.models ?? []).map((model) => ({
      ...model,
      _key: createKey(),
      // Rust serializes unset Options as null — normalize so the tri-state
      // select reads unset as "inherit" (not "disabled").
      nonStreamViaStream: model.nonStreamViaStream ?? undefined,
      members: (model.members ?? []).map((member) => ({
        ...member,
        _key: createKey()
      })),
      failover: formFailoverFromConfig(model.failover)
    })),
    authMode: provider.authMode ?? defaultAuthModeForType(provider.type ?? 'custom'),
    nonStreamViaStream: provider.nonStreamViaStream ?? false,
    useAbsoluteUrl: provider.useAbsoluteUrl ?? false,
    // Older backends don't return this field; missing/null both map to off.
    streamUsage: provider.streamUsage === true,
    // Rust serializes unset Option fields as null; missing/null both map to unset.
    rpmLimit: provider.rpmLimit != null ? String(provider.rpmLimit) : '',
    rpmMaxWaitSeconds:
      provider.rpmMaxWaitSeconds != null ? String(provider.rpmMaxWaitSeconds) : '',
    extraHeaders: Object.entries(provider.extraHeaders ?? {}).map(([name, value]) => ({
      name,
      value,
      _key: createKey()
    })),
    endpoints: (provider.endpoints ?? []).map((endpoint) => ({
      _key: createKey(),
      id: endpoint.id,
      label: endpoint.label ?? '',
      protocol: endpoint.protocol,
      baseUrl: endpoint.baseUrl
    })),
    keys: (provider.keys ?? []).map((key) => ({
      _key: createKey(),
      id: key.id,
      label: key.label ?? '',
      value: key.value,
      active: key.active === true
    })),
    balanceAdapter: provider.balanceAdapter ?? ''
  }
}

export function mapPresetModel(model: Omit<FormModel, '_key'>): FormModel {
  return {
    _key: createKey(),
    id: model.id,
    label: model.label,
    nonStreamViaStream: model.nonStreamViaStream,
    members: [],
    failover: createEmptyFailover()
  }
}

export function BasicsStep({
  form,
  errors,
  isCreate,
  advancedOpen,
  onAdvancedOpenChange,
  idInputRef,
  onProviderIdChange,
  onFieldChange,
  onTypeChange,
  onAuthModeChange,
  onNonStreamViaStreamChange,
  onUseAbsoluteUrlChange,
  onStreamUsageChange,
  onAddHeader,
  onRemoveHeader,
  onHeaderChange,
  onEndpointChange,
  onAddEndpoint,
  onRemoveEndpoint
}: ProviderStepShared) {
  const { t } = useTranslation()
  const isAggregate = form.type === 'aggregate'
  // The basic API key is masked like the named keys below it — one masking
  // policy for every credential input on the panel.
  const [apiKeyRevealed, setApiKeyRevealed] = useState(false)
  return (
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby="provider-type-fields">
        <div className="space-y-1">
          <h3 id="provider-type-fields" className="text-sm font-semibold">{t('providers.drawer.sections.type')}</h3>
          <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.type')}</p>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {/* Protocol-family chips. Vendor types (deepseek/kimi/…) come from
              preset creation and stay reachable: if the current type is one,
              it renders as an extra active chip so it is visible and kept
              until the user actively switches. */}
          {TYPE_CHIP_OPTIONS.some((option) => option.value === form.type) ? null : (
            <span
              className="border border-foreground bg-secondary px-3 py-1.5 text-xs font-medium text-foreground"
              title={t('providers.drawer.hints.typeVendorPinned')}
            >
              {providerTypeLabel(form.type, t)}
            </span>
          )}
          {TYPE_CHIP_OPTIONS.map((option) => {
            const active = option.value === form.type
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onTypeChange(option.value)}
                className={cn(
                  'border px-3 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-foreground bg-foreground text-background'
                    : 'border-border bg-card text-foreground hover:border-foreground/30 hover:bg-accent/50'
                )}
              >
                {t(option.labelKey)}
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-3" aria-labelledby="provider-basic-info">
        <h3 id="provider-basic-info" className="text-sm font-semibold">{t('providers.drawer.sections.basic')}</h3>

        <div className="grid gap-4 md:grid-cols-2">
          <Label className="flex flex-col gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.id')}</span>
            <Input
              value={form.id}
              ref={idInputRef}
              onChange={(event) => onProviderIdChange(event.target.value)}
              disabled={!isCreate}
              placeholder={t('providers.drawer.fields.idPlaceholder')}
              aria-invalid={Boolean(errors.id)}
            />
            {errors.id ? <span className="text-xs text-destructive">{errors.id}</span> : null}
          </Label>
          <Label className="flex flex-col gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.label')}</span>
            <Input
              value={form.label}
              onChange={(event) => onFieldChange('label')(event.target.value)}
              placeholder={t('providers.drawer.fields.labelPlaceholder')}
            />
          </Label>
        </div>

        {isAggregate ? (
          <div className="space-y-2 border border-border bg-card p-4">            <p className="text-sm font-semibold">{t('providers.aggregate.drawer.explainerTitle')}</p>
            <p className="text-xs leading-relaxed text-muted-foreground">
              {t('providers.aggregate.drawer.explainerBody')}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            <Label className="flex flex-col gap-2 text-sm">
              <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.baseUrlPrimary')}</span>
              <Input
                value={form.baseUrl}
                onChange={(event) => onFieldChange('baseUrl')(event.target.value)}
                placeholder={t('providers.drawer.fields.baseUrlPlaceholder')}
                aria-invalid={Boolean(errors.baseUrl)}
              />
              {errors.baseUrl ? <span className="text-xs text-destructive">{errors.baseUrl}</span> : null}
            </Label>
            {onEndpointChange && onAddEndpoint && onRemoveEndpoint ? (
              <EndpointsTable
                form={form}
                errors={errors}
                onEndpointChange={onEndpointChange}
                onAddEndpoint={onAddEndpoint}
                onRemoveEndpoint={onRemoveEndpoint}
              />
            ) : null}
          </div>
        )}
      </section>

      {isAggregate ? null : (
      <section className="space-y-3" aria-labelledby="provider-auth-fields">
        <h3 id="provider-auth-fields" className="text-sm font-semibold">{t('providers.drawer.sections.auth')}</h3>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <Label className="flex flex-col gap-2 text-sm">
            <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.apiKey')}</span>
            <div className="flex gap-1.5">
              <Input
                type={apiKeyRevealed ? 'text' : 'password'}
                value={form.apiKey}
                onChange={(event) => onFieldChange('apiKey')(event.target.value)}
                placeholder={t('providers.drawer.fields.apiKeyPlaceholder')}
                autoComplete="off"
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-9 w-9 shrink-0 px-0"
                onClick={() => setApiKeyRevealed((previous) => !previous)}
                aria-label={apiKeyRevealed ? t('providers.keys.hide') : t('providers.keys.reveal')}
              >
                {apiKeyRevealed ? (
                  <EyeOff className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Eye className="h-4 w-4" aria-hidden="true" />
                )}
              </Button>
            </div>
          </Label>
          <div className="flex flex-col gap-2">
            <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.authMode')}</span>
            <Select
              value={form.authMode}
              onValueChange={(value) => onAuthModeChange(value as FormState['authMode'])}
            >
              <SelectTrigger
                className="h-9 text-xs"
                aria-label={t('providers.drawer.fields.authMode')}
                title={t('providers.drawer.fields.authModeHint')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="apiKey">{describeAuthMode(form.type, 'apiKey', t)}</SelectItem>
                <SelectItem value="authToken">{t('providers.drawer.fields.authModeAuthToken')}</SelectItem>
                <SelectItem value="xAuthToken">{t('providers.drawer.fields.authModeXAuthToken')}</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <Disclosure
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
          summary={t('providers.drawer.fields.advancedOptions')}
          className="border border-border bg-card"
          summaryClassName="px-4 py-3 text-sm font-medium"
          contentClassName="border-t border-border px-4 py-4"
        >
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('providers.drawer.fields.nonStreamViaStream')}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('providers.drawer.fields.nonStreamViaStreamHint')}
              </p>
            </div>
            <Switch
              checked={form.nonStreamViaStream}
              onCheckedChange={onNonStreamViaStreamChange}
              aria-label={t('providers.drawer.fields.nonStreamViaStream')}
            />
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('providers.drawer.fields.useAbsoluteUrl')}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('providers.drawer.fields.useAbsoluteUrlHint')}
                </p>
              </div>
              <Switch
                checked={form.useAbsoluteUrl}
                onCheckedChange={onUseAbsoluteUrlChange}
                aria-label={t('providers.drawer.fields.useAbsoluteUrl')}
              />
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('providers.drawer.fields.streamUsage')}</p>
                <p className="text-xs leading-relaxed text-warning">
                  {t('providers.drawer.fields.streamUsageHint')}
                </p>
              </div>
              <Switch
                checked={form.streamUsage}
                onCheckedChange={onStreamUsageChange}
                aria-label={t('providers.drawer.fields.streamUsage')}
              />
            </div>
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="space-y-1">
              <p className="text-sm font-medium">{t('providers.drawer.fields.rpmLimitSection')}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('providers.drawer.fields.rpmLimitHint')}
              </p>
            </div>
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <Label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.rpmLimit')}</span>
                <Input
                  type="number"
                  min={1}
                  value={form.rpmLimit}
                  onChange={(event) => onFieldChange('rpmLimit')(event.target.value)}
                  placeholder={t('providers.drawer.fields.rpmLimitPlaceholder')}
                  aria-invalid={Boolean(errors.rpmLimit)}
                />
              </Label>
              <Label className="flex flex-col gap-1.5 text-sm">
                <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.rpmMaxWaitSeconds')}</span>
                <Input
                  type="number"
                  min={1}
                  max={3600}
                  value={form.rpmMaxWaitSeconds}
                  onChange={(event) => onFieldChange('rpmMaxWaitSeconds')(event.target.value)}
                  placeholder={t('providers.drawer.fields.rpmMaxWaitPlaceholder')}
                  aria-invalid={Boolean(errors.rpmMaxWaitSeconds)}
                />
              </Label>
            </div>
            {errors.rpmLimit ? <p className="mt-2 text-xs text-destructive">{errors.rpmLimit}</p> : null}
            {errors.rpmMaxWaitSeconds ? <p className="mt-2 text-xs text-destructive">{errors.rpmMaxWaitSeconds}</p> : null}
          </div>

          <div className="mt-4 border-t border-border pt-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <p className="text-sm font-medium">{t('providers.drawer.fields.extraHeaders')}</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {t('providers.drawer.fields.extraHeadersHint')}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onAddHeader}
                className="bg-card text-xs"
              >
                {t('providers.drawer.fields.addHeader')}
              </Button>
            </div>

            {errors.extraHeaders ? <p className="mt-2 text-xs text-destructive">{errors.extraHeaders}</p> : null}

            {form.extraHeaders.length > 0 ? (
              <div className="mt-3 space-y-3">
                {form.extraHeaders.map((header, index) => (
                  <div
                    key={header._key}
                    className="border border-border bg-secondary/40 p-3"
                  >
                    <div className="grid gap-3 md:grid-cols-2">
                      <Label className="flex flex-col gap-1.5 text-sm">
                        <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.headerName')}</span>
                        <Input
                          value={header.name}
                          onChange={(event) => onHeaderChange(index, { name: event.target.value })}
                          placeholder={t('providers.drawer.fields.headerNamePlaceholder')}
                        />
                      </Label>
                      <Label className="flex flex-col gap-1.5 text-sm">
                        <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.headerValue')}</span>
                        <Input
                          value={header.value}
                          onChange={(event) => onHeaderChange(index, { value: event.target.value })}
                          placeholder={t('providers.drawer.fields.headerValuePlaceholder')}
                        />
                      </Label>
                    </div>
                    <div className="mt-2 flex justify-end">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-auto px-2 text-destructive"
                        onClick={() => onRemoveHeader(index)}
                      >
                        {t('providers.drawer.fields.removeHeader')}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        </Disclosure>
      </section>
      )}
    </div>
  )
}

/** Extra protocol endpoint rows — rendered inside BasicsStep below the primary base URL. */
function EndpointsTable({
  form,
  errors,
  onEndpointChange,
  onAddEndpoint,
  onRemoveEndpoint
}: {
  form: FormState
  errors: FormErrors
  onEndpointChange: (index: number, patch: Partial<FormState['endpoints'][number]>) => void
  onAddEndpoint: () => void
  onRemoveEndpoint: (index: number) => void
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{t('providers.endpoints.hint')}</p>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onAddEndpoint}
          className="shrink-0 bg-card text-xs"
        >
          {t('providers.endpoints.add')}
        </Button>
      </div>
      {form.endpoints.length > 0 ? (
        <div className="divide-y divide-border border border-border">
          {form.endpoints.map((endpoint, index) => {
            const error = errors.endpoints?.[endpoint._key]
            return (
              <div key={endpoint._key} className="space-y-2 p-3" data-testid="surface-endpoint-row">
                <div className="grid gap-2 md:grid-cols-[minmax(0,0.9fr)_150px_minmax(0,1.4fr)_minmax(0,0.9fr)_auto]">
                  <Input
                    value={endpoint.id}
                    onChange={(event) => onEndpointChange(index, { id: event.target.value })}
                    placeholder={t('providers.endpoints.idPlaceholder')}
                    aria-label={t('providers.endpoints.id')}
                    className="h-8 text-xs"
                    aria-invalid={Boolean(error)}
                  />
                  <Select
                    value={endpoint.protocol}
                    onValueChange={(value) =>
                      onEndpointChange(index, {
                        protocol: value as FormState['endpoints'][number]['protocol']
                      })
                    }
                  >
                    <SelectTrigger className="h-8 text-xs" aria-label={t('providers.endpoints.protocol')}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {PROVIDER_ENDPOINT_PROTOCOL_OPTIONS.map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input
                    value={endpoint.baseUrl}
                    onChange={(event) => onEndpointChange(index, { baseUrl: event.target.value })}
                    placeholder={t('providers.endpoints.baseUrlPlaceholder')}
                    aria-label={t('providers.endpoints.baseUrl')}
                    className="h-8 font-mono text-xs"
                    aria-invalid={Boolean(error)}
                  />
                  <Input
                    value={endpoint.label}
                    onChange={(event) => onEndpointChange(index, { label: event.target.value })}
                    placeholder={t('providers.endpoints.labelPlaceholder')}
                    aria-label={t('providers.endpoints.label')}
                    className="h-8 text-xs"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-8 px-2 text-xs text-destructive"
                    onClick={() => onRemoveEndpoint(index)}
                  >
                    {t('common.delete')}
                  </Button>
                </div>
                {error ? <p className="text-xs text-destructive">{error}</p> : null}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="border border-dashed border-border px-3 py-3 text-xs text-muted-foreground">
          {t('providers.endpoints.empty')}
        </p>
      )}
    </div>
  )
}

export function ModelsStep({
  form,
  errors,
  onModelIdChange,
  onModelChange,
  onAddModel,
  onRemoveModel,
  onModelNonStreamViaStreamChange,
  onSetDefaultModel,
  testVerification,
  probeModels
}: ProviderStepShared) {
  const { t } = useTranslation()
  const availableDefaultModels = form.models.filter((model) => model.id.trim().length > 0)
  // Track which model rows have their protocol-override panel expanded.
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set())

  const toggleRow = (key: string) => {
    setExpandedRows((previous) => {
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
    <div className="space-y-5">
      <section className="space-y-3" aria-labelledby="provider-model-fields">
        <div className="flex items-start justify-between gap-4">
          <h3 id="provider-model-fields" className="text-sm font-semibold">
            {form.models.length > 0
              ? `${t('providers.drawer.fields.models')} (${form.models.length})`
              : t('providers.drawer.fields.models')}
          </h3>
          <div className="flex shrink-0 gap-2">
            {probeModels ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={probeModels.onProbe}
                disabled={!probeModels.available}
                title={probeModels.available ? undefined : t('providers.drawer.probe.needsBaseUrl')}
                className="bg-card text-xs"
              >
                {t('providers.drawer.probe.button')}
              </Button>
            ) : null}
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
        </div>

        {errors.models ? <p className="text-xs text-destructive">{errors.models}</p> : null}

        {/* Column header row — only shown when there are models */}
        {form.models.length > 0 ? (
          <div className="grid items-center gap-2 border-b border-border pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid-cols-[auto_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto]">
            <span className="w-5" />
            <span>{t('providers.drawer.fields.modelId')}</span>
            <span>{t('providers.drawer.fields.modelLabel')}</span>
            <span />
            <span />
          </div>
        ) : null}

        <div className="divide-y divide-border border border-border">
          {form.models.map((model, index) => {
            const isExpanded = expandedRows.has(model._key)
            const hasOverride = model.nonStreamViaStream !== undefined
            return (
              <div key={model._key} className="bg-card">
                {/* Primary row */}
                <div className="grid items-center gap-2 px-3 py-2 md:grid-cols-[auto_minmax(0,1fr)_minmax(0,0.8fr)_auto_auto]">
                  {/* Default radio */}
                  <input
                    type="radio"
                    name="defaultModel"
                    value={model.id}
                    aria-label={t('providers.drawer.fields.setDefault')}
                    checked={form.defaultModel === model.id}
                    onChange={() => onSetDefaultModel(model.id)}
                    disabled={model.id.trim().length === 0}
                    className="h-4 w-4 shrink-0 accent-primary"
                    title={t('providers.drawer.fields.setDefault')}
                  />
                  {/* Model ID */}
                  <Input
                    value={model.id}
                    onChange={(event) => onModelIdChange(index, event.target.value)}
                    placeholder={t('providers.drawer.fields.modelIdPlaceholder')}
                    className="h-7 font-mono text-xs"
                  />
                  {/* Display label */}
                  <Input
                    value={model.label ?? ''}
                    onChange={(event) => onModelChange(index, { label: event.target.value })}
                    placeholder={t('providers.drawer.fields.modelLabelPlaceholder')}
                    className="h-7 text-xs"
                  />
                  {/* Protocol override toggle */}
                  <button
                    type="button"
                    onClick={() => toggleRow(model._key)}
                    aria-label={t('providers.drawer.fields.modelNonStreamViaStream')}
                    title={t('providers.drawer.fields.modelNonStreamViaStream')}
                    className={cn(
                      'flex h-7 w-7 items-center justify-center border transition-colors',
                      hasOverride
                        ? 'border-foreground/60 text-foreground'
                        : 'border-border text-muted-foreground hover:text-foreground'
                    )}
                  >
                    {isExpanded ? (
                      <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                    ) : (
                      <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                    )}
                  </button>
                  {/* Remove — distinct label from the header's provider 删除,
                      so both users and E2E can tell row removal apart. */}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() => onRemoveModel(index)}
                    disabled={form.models.length === 0}
                  >
                    {t('providers.drawer.fields.removeModel')}
                  </Button>
                </div>

                {/* Expanded protocol override row */}
                {isExpanded ? (
                  <div className="border-t border-border px-3 pb-2 pt-2">
                    <div className="flex items-center gap-3">
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {t('providers.drawer.fields.modelNonStreamViaStream')}
                      </span>
                      <Select
                        value={
                          model.nonStreamViaStream === undefined
                            ? 'inherit'
                            : model.nonStreamViaStream
                              ? 'enabled'
                              : 'disabled'
                        }
                        onValueChange={(value) => onModelNonStreamViaStreamChange(index, value)}
                      >
                        <SelectTrigger className="h-7 w-48 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="inherit">{t('providers.drawer.fields.modelNonStreamViaStreamInherit')}</SelectItem>
                          <SelectItem value="enabled">{t('providers.drawer.fields.modelNonStreamViaStreamEnabled')}</SelectItem>
                          <SelectItem value="disabled">{t('providers.drawer.fields.modelNonStreamViaStreamDisabled')}</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}

          {form.models.length === 0 ? (
            <div className="border border-warning/30 bg-warning-bg p-4">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-warning">
                  {t('providers.drawer.noModelsTitle')}
                </p>
                <p className="text-xs leading-relaxed text-warning">
                  {t('providers.drawer.noModelsHint', { providerId: form.id || 'provider-id' })}
                </p>
                <div className="bg-secondary/50 p-2.5">
                  <p className="mb-1.5 text-xs font-medium text-foreground">
                    {t('providers.drawer.routeExample')}
                  </p>
                  <code className="block border border-border bg-card px-2.5 py-1.5 font-mono text-xs text-foreground">
                    &quot;claude-*&quot;: &quot;{(form.id || 'provider-id').trim() || 'provider-id'}:*&quot;
                  </code>
                </div>
              </div>
            </div>
          ) : null}
        </div>

        {availableDefaultModels.length > 1 ? (
          <div className="text-xs text-muted-foreground">
            {t('providers.drawer.defaultHint', { model: form.defaultModel || t('providers.card.noDefault') })}
          </div>
        ) : null}
      </section>

      {testVerification ? (
        <section className="space-y-3" aria-labelledby="provider-verify-fields">
          <div className="space-y-1">
            <h3 id="provider-verify-fields" className="text-sm font-semibold">{t('workbench.drawer.verifyTitle')}</h3>
            <p className="text-xs text-muted-foreground">{t('workbench.drawer.verifyHint')}</p>
          </div>
          {testVerification.available ? (
            <div className="space-y-3 border border-border bg-card p-4">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={testVerification.onTest}
                disabled={testVerification.testing}
              >
                {testVerification.testing
                  ? t('common.actions.testingConnection')
                  : t('workbench.drawer.verifyRun')}
              </Button>
              {testVerification.result ? <TestResultInline result={testVerification.result} /> : null}
            </div>
          ) : (
            <p className="bg-secondary/50 px-4 py-3 text-xs text-muted-foreground">
              {t('workbench.drawer.verifySaveFirst')}
            </p>
          )}
        </section>
      ) : null}
    </div>
  )
}
