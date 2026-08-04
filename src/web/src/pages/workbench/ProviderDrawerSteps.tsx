import type { RefObject } from 'react'
import { useTranslation } from 'react-i18next'
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
import type { ProviderConfig, ProviderModelConfig } from '@/types/providers'
import { cn } from '@/lib/utils'
import type { ProviderTestResult } from './shared'
import { TestResultInline } from './TestResultInline'

export interface FormModel extends ProviderModelConfig {
  _key: string
}

export interface FormHeader {
  name: string
  value: string
  _key: string
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
  extraHeaders: FormHeader[]
}

export interface FormErrors {
  id?: string
  baseUrl?: string
  models?: string
  extraHeaders?: string
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
  onAddHeader: () => void
  onRemoveHeader: (index: number) => void
  onHeaderChange: (index: number, patch: Partial<FormHeader>) => void
  onModelIdChange: (index: number, value: string) => void
  onModelChange: (index: number, patch: Partial<FormModel>) => void
  onAddModel: () => void
  onRemoveModel: (index: number) => void
  onModelNonStreamViaStreamChange: (index: number, value: string) => void
  onSetDefaultModel: (id: string) => void
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
    label: ''
  }
}

export function createEmptyHeader(): FormHeader {
  return {
    _key: createKey(),
    name: '',
    value: ''
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
  custom: {}
}

export const PROVIDER_TYPE_OPTIONS: Array<{ value: ProviderConfig['type']; label: string }> = [
  { value: 'openai', label: 'OpenAI' },
  { value: 'deepseek', label: 'DeepSeek' },
  { value: 'huawei', label: 'Huawei Cloud' },
  { value: 'kimi', label: 'Kimi' },
  { value: 'anthropic', label: 'Anthropic' },
  { value: 'custom', label: 'Custom' }
]

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
      extraHeaders: []
    }
  }

  return {
    id: provider.id,
    label: provider.label ?? provider.id,
    baseUrl: provider.baseUrl,
    apiKey: provider.apiKey ?? '',
    type: provider.type ?? 'custom',
    defaultModel: provider.defaultModel ?? '',
    models: (provider.models ?? []).map((model) => ({
      ...model,
      _key: createKey()
    })),
    authMode: provider.authMode ?? defaultAuthModeForType(provider.type ?? 'custom'),
    nonStreamViaStream: provider.nonStreamViaStream ?? false,
    useAbsoluteUrl: provider.useAbsoluteUrl ?? false,
    extraHeaders: Object.entries(provider.extraHeaders ?? {}).map(([name, value]) => ({
      name,
      value,
      _key: createKey()
    }))
  }
}

export function mapPresetModel(model: Omit<FormModel, '_key'>): FormModel {
  return {
    _key: createKey(),
    id: model.id,
    label: model.label,
    nonStreamViaStream: model.nonStreamViaStream
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
  onAddHeader,
  onRemoveHeader,
  onHeaderChange
}: ProviderStepShared) {
  const { t } = useTranslation()
  return (
    <div className="space-y-8">
      <section className="space-y-5" aria-labelledby="provider-type-fields">
        <div className="space-y-1">
          <h3 id="provider-type-fields" className="text-sm font-semibold">{t('providers.drawer.sections.type')}</h3>
          <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.type')}</p>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          {PROVIDER_TYPE_OPTIONS.map((option) => {
            const active = option.value === form.type
            return (
              <button
                key={option.value ?? 'custom'}
                type="button"
                onClick={() => onTypeChange(option.value)}
                className={cn(
                  'rounded-2xl border px-4 py-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                  active
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border bg-card text-foreground hover:border-primary/20 hover:bg-accent/50'
                )}
              >
                <div className="text-sm font-semibold">{option.label}</div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {PROVIDER_TYPE_PRESETS[option.value ?? 'custom']?.baseUrl ?? t('providers.drawer.hints.customProvider')}
                </div>
              </button>
            )
          })}
        </div>
      </section>

      <section className="space-y-4" aria-labelledby="provider-basic-info">
        <div className="space-y-1">
          <h3 id="provider-basic-info" className="text-sm font-semibold">{t('providers.drawer.sections.basic')}</h3>
          <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.basic')}</p>
        </div>

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

        <Label className="flex flex-col gap-2 text-sm">
          <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.baseUrl')}</span>
          <Input
            value={form.baseUrl}
            onChange={(event) => onFieldChange('baseUrl')(event.target.value)}
            placeholder={t('providers.drawer.fields.baseUrlPlaceholder')}
            aria-invalid={Boolean(errors.baseUrl)}
          />
          {errors.baseUrl ? <span className="text-xs text-destructive">{errors.baseUrl}</span> : null}
        </Label>
      </section>

      <section className="space-y-4" aria-labelledby="provider-auth-fields">
        <div className="space-y-1">
          <h3 id="provider-auth-fields" className="text-sm font-semibold">{t('providers.drawer.sections.auth')}</h3>
          <p className="text-xs text-muted-foreground">{t('providers.drawer.hints.auth')}</p>
        </div>

        <Label className="flex flex-col gap-2 text-sm">
          <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.apiKey')}</span>
          <Input
            value={form.apiKey}
            onChange={(event) => onFieldChange('apiKey')(event.target.value)}
            placeholder={t('providers.drawer.fields.apiKeyPlaceholder')}
          />
        </Label>

        <fieldset className="grid gap-2 rounded-xl border border-transparent bg-card p-4 text-xs shadow-[var(--surface-shadow)]">
          <legend className="px-1 text-muted-foreground">
            {t('providers.drawer.fields.authMode')}
          </legend>
          <p className="text-[11px] text-muted-foreground">
            {t('providers.drawer.fields.authModeHint')}
          </p>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-accent focus-within:bg-accent">
            <input
              type="radio"
              name="provider-auth-mode"
              value="apiKey"
              checked={form.authMode === 'apiKey'}
              onChange={() => onAuthModeChange('apiKey')}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>{describeAuthMode(form.type, 'apiKey', t)}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-accent focus-within:bg-accent">
            <input
              type="radio"
              name="provider-auth-mode"
              value="authToken"
              checked={form.authMode === 'authToken'}
              onChange={() => onAuthModeChange('authToken')}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>{t('providers.drawer.fields.authModeAuthToken')}</span>
          </label>
          <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-transparent px-3 py-2 transition hover:bg-accent focus-within:bg-accent">
            <input
              type="radio"
              name="provider-auth-mode"
              value="xAuthToken"
              checked={form.authMode === 'xAuthToken'}
              onChange={() => onAuthModeChange('xAuthToken')}
              className="mt-0.5 h-4 w-4 accent-primary"
            />
            <span>{t('providers.drawer.fields.authModeXAuthToken')}</span>
          </label>
        </fieldset>

        <Disclosure
          open={advancedOpen}
          onOpenChange={onAdvancedOpenChange}
          summary={t('providers.drawer.fields.advancedOptions')}
          className="rounded-xl border border-transparent bg-card shadow-[var(--surface-shadow)]"
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
                    className="rounded-xl border border-transparent bg-secondary/40 p-3"
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
    </div>
  )
}

export function ModelsStep({
  form,
  errors,
  advancedOpen,
  onAdvancedOpenChange,
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
  return (
    <div className="space-y-8">
      <section className="space-y-4" aria-labelledby="provider-model-fields">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-1">
            <h3 id="provider-model-fields" className="text-sm font-semibold">{t('providers.drawer.fields.models')}</h3>
            <p className="text-xs text-muted-foreground">{t('providers.drawer.modelsDescription')}</p>
          </div>
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

        <div className="space-y-4">
          {form.models.map((model, index) => (
            <div
              key={model._key}
              className="rounded-xl border border-transparent bg-card p-4 shadow-[var(--surface-shadow)]"
            >
              <div className="grid gap-4 md:grid-cols-2">
                <Label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.modelId')}</span>
                  <Input
                    value={model.id}
                    onChange={(event) => onModelIdChange(index, event.target.value)}
                    placeholder={t('providers.drawer.fields.modelIdPlaceholder')}
                  />
                </Label>
              </div>

              <Disclosure
                open={advancedOpen}
                onOpenChange={onAdvancedOpenChange}
                summary={t('providers.drawer.fields.advancedOptions')}
                className="mt-4 rounded-xl bg-secondary/50"
                summaryClassName="px-3 py-2 text-xs font-medium"
                contentClassName="space-y-4 px-3 py-3"
              >
                <Label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.modelLabel')}</span>
                  <Input
                    value={model.label ?? ''}
                    onChange={(event) => onModelChange(index, { label: event.target.value })}
                    placeholder={t('providers.drawer.fields.modelLabelPlaceholder')}
                  />
                </Label>
                <Label className="flex flex-col gap-2 text-sm">
                  <span className="text-xs text-muted-foreground">{t('providers.drawer.fields.modelNonStreamViaStream')}</span>
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
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="inherit">{t('providers.drawer.fields.modelNonStreamViaStreamInherit')}</SelectItem>
                      <SelectItem value="enabled">{t('providers.drawer.fields.modelNonStreamViaStreamEnabled')}</SelectItem>
                      <SelectItem value="disabled">{t('providers.drawer.fields.modelNonStreamViaStreamDisabled')}</SelectItem>
                    </SelectContent>
                  </Select>
                </Label>
              </Disclosure>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <label className="flex items-center gap-2 text-muted-foreground">
                  <input
                    type="radio"
                    name="defaultModel"
                    value={model.id}
                    aria-label={t('providers.drawer.fields.setDefault')}
                    checked={form.defaultModel === model.id}
                    onChange={() => onSetDefaultModel(model.id)}
                    disabled={model.id.trim().length === 0}
                    className="h-4 w-4 accent-primary"
                  />
                  {t('providers.drawer.fields.setDefault')}
                </label>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-auto px-2 text-destructive"
                  onClick={() => onRemoveModel(index)}
                  disabled={form.models.length === 0}
                >
                  {t('providers.drawer.fields.removeModel')}
                </Button>
              </div>
            </div>
          ))}

          {form.models.length === 0 ? (
            <div className="rounded-xl border border-warning/30 bg-warning-bg p-5">
              <div className="space-y-2">
                <p className="text-sm font-semibold text-warning">
                  {t('providers.drawer.noModelsTitle')}
                </p>
                <p className="text-xs leading-relaxed text-warning">
                  {t('providers.drawer.noModelsHint', { providerId: form.id || 'provider-id' })}
                </p>
                <div className="rounded-lg bg-secondary/50 p-2.5">
                  <p className="mb-1.5 text-xs font-medium text-foreground">
                    {t('providers.drawer.routeExample')}
                  </p>
                  <code className="block rounded-lg border border-transparent bg-card px-2.5 py-1.5 font-mono text-xs text-foreground shadow-[var(--surface-shadow)]">
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
            <div className="space-y-3 rounded-xl border border-transparent bg-card p-4 shadow-[var(--surface-shadow)]">
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
            <p className="rounded-xl bg-secondary/50 px-4 py-3 text-xs text-muted-foreground">
              {t('workbench.drawer.verifySaveFirst')}
            </p>
          )}
        </section>
      ) : null}
    </div>
  )
}
