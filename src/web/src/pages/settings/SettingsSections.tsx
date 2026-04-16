import type { Dispatch, Ref, SetStateAction } from 'react'
import { AlertCircle, Copy, Shield } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent } from '@/components/ui/card'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Loader } from '@/components/Loader'
import { cn } from '@/lib/utils'
import { LOG_LEVEL_OPTIONS, SETTINGS_SECTIONS, type AuthFormErrors, type AuthFormState, type FormErrors, type FormState, type LogLevel } from './shared'

export function SettingsSectionNav({
  activeSection,
  onSelectSection
}: {
  activeSection: string
  onSelectSection: (id: string) => void
}) {
  const { t } = useTranslation()

  return (
    <>
      <nav className="hidden xl:block">
        <div className="sticky top-20 rounded-[1.1rem] border border-white/70 bg-card/95 p-3.5 shadow-[0_20px_48px_-42px_rgba(15,23,42,0.24)]">
          <p className="mb-2.5 px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t('settings.sections.jump')}
          </p>
          <div className="space-y-1.5">
            {SETTINGS_SECTIONS.map((section, index) => (
              <button
                key={section.id}
                type="button"
                onClick={() => onSelectSection(section.id)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-[0.85rem] px-3 py-2 text-left text-sm font-semibold transition-all duration-200',
                  activeSection === section.id
                    ? 'bg-secondary text-foreground shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <span className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-semibold',
                  activeSection === section.id
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-secondary text-muted-foreground'
                )}
                >
                  {index + 1}
                </span>
                <span>{t(section.labelKey)}</span>
              </button>
            ))}
          </div>
        </div>
      </nav>

      <div className="xl:hidden">
        <div className="overflow-x-auto pb-1">
          <div className="flex w-max gap-2 px-1">
          {SETTINGS_SECTIONS.map((section) => (
            <button
              key={section.id}
              type="button"
              onClick={() => onSelectSection(section.id)}
              className={cn(
                'rounded-full px-4 py-2 text-xs font-semibold transition-all duration-150',
                activeSection === section.id
                  ? 'bg-secondary text-foreground font-medium'
                  : 'text-muted-foreground hover:text-foreground hover:bg-secondary/50'
              )}
            >
              {t(section.labelKey)}
            </button>
          ))}
          </div>
        </div>
      </div>
    </>
  )
}

export function SettingsOverviewPanel({
  configPath,
  defaultsSummary,
  form,
  protocolSummaryLabel,
  protocolChangesPending,
  isAuthDirty,
  isConfigDirty,
  authEnabled,
  authUsername
}: {
  configPath: string
  defaultsSummary: string | null
  form: FormState
  protocolSummaryLabel: string
  protocolChangesPending: boolean
  isAuthDirty: boolean
  isConfigDirty: boolean
  authEnabled: boolean
  authUsername?: string
}) {
  const { t } = useTranslation()

  return (
    <Card
      variant="ghost"
      className="rounded-[1.25rem] border border-white/70 bg-card/95 shadow-[0_20px_50px_-42px_rgba(15,23,42,0.24)]"
    >
      <CardContent className="space-y-3 p-4">
        <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
          <div className="space-y-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-primary/75">
              {t('settings.overview.title')}
            </p>
            <p className="text-sm text-muted-foreground">{t('settings.overview.description')}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge variant={isConfigDirty || isAuthDirty ? 'warning' : 'success'}>
              {isConfigDirty || isAuthDirty ? t('modelManagement.actions.unsaved') : t('common.status.success')}
            </Badge>
            {protocolChangesPending ? (
              <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
                {t('settings.protocol.restartWarning')}
              </Badge>
            ) : null}
          </div>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <OverviewCard
            label={t('settings.overview.cards.protocols')}
            value={protocolSummaryLabel}
            helper={`${form.httpHost || '127.0.0.1'}:${form.httpPort}${form.httpsEnabled ? ` / ${form.httpsHost || '127.0.0.1'}:${form.httpsPort}` : ''}`}
          />
          <OverviewCard
            label={t('settings.overview.cards.security')}
            value={authEnabled ? t('settings.overview.values.authEnabled') : t('settings.overview.values.authDisabled')}
            helper={authUsername ? `${t('settings.auth.username')}: ${authUsername}` : t('settings.auth.enableHint')}
          />
          <OverviewCard
            label={t('settings.overview.cards.configFile')}
            value={configPath || t('settings.file.unknown')}
            helper={defaultsSummary ?? t('settings.defaults.none')}
            mono
          />
        </div>
      </CardContent>
    </Card>
  )
}

export function BasicsSection({
  defaultsSummary,
  errors,
  form,
  onInputChange,
  onSetForm,
  sectionRef
}: {
  defaultsSummary: string | null
  errors: FormErrors
  form: FormState
  onInputChange: (field: 'port' | 'host' | 'logRetentionDays' | 'logExportTimeoutSeconds' | 'bodyLimitMb') => (value: string) => void
  onSetForm: Dispatch<SetStateAction<FormState>>
  sectionRef?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()

  return (
    <Card
      id="section-basics"
      ref={sectionRef}
      className="bg-card shadow-[var(--surface-shadow)]"
    >
      <CardContent className="pt-6">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <h3 className="text-sm font-semibold">{t('settings.sections.basics')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.description')}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-3">
            <MiniInfoCard label={t('settings.fields.retention')} value={form.logRetentionDays} />
            <MiniInfoCard label={t('settings.fields.logExportTimeout')} value={`${form.logExportTimeoutSeconds}s`} />
            <MiniInfoCard label={t('settings.fields.bodyLimit')} value={`${form.bodyLimitMb} MB`} />
          </div>
        </div>
        <div className="grid gap-5 md:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('settings.fields.port')}</Label>
            <Input type="number" min={1} max={65535} value={form.port} onChange={(e) => onInputChange('port')(e.target.value)} aria-invalid={Boolean(errors.port)} />
            {errors.port ? <p className="text-xs text-destructive">{errors.port}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>{t('settings.fields.host')}</Label>
            <Input value={form.host} onChange={(e) => onInputChange('host')(e.target.value)} placeholder={t('settings.fields.hostPlaceholder')} />
          </div>

          <div className="space-y-2">
            <Label>{t('settings.fields.retention')}</Label>
            <Input type="number" min={1} max={365} value={form.logRetentionDays} onChange={(e) => onInputChange('logRetentionDays')(e.target.value)} aria-invalid={Boolean(errors.logRetentionDays)} />
            {errors.logRetentionDays ? <p className="text-xs text-destructive">{errors.logRetentionDays}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>{t('settings.fields.logExportTimeout')}</Label>
            <Input type="number" min={5} max={600} value={form.logExportTimeoutSeconds} onChange={(e) => onInputChange('logExportTimeoutSeconds')(e.target.value)} aria-invalid={Boolean(errors.logExportTimeoutSeconds)} />
            <p className="text-xs text-muted-foreground">{t('settings.fields.logExportTimeoutHint')}</p>
            {errors.logExportTimeoutSeconds ? <p className="text-xs text-destructive">{errors.logExportTimeoutSeconds}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>{t('settings.fields.bodyLimit')}</Label>
            <Input type="number" min={1} max={2048} value={form.bodyLimitMb} onChange={(e) => onInputChange('bodyLimitMb')(e.target.value)} aria-invalid={Boolean(errors.bodyLimitMb)} />
            <p className="text-xs text-muted-foreground">{t('settings.fields.bodyLimitHint')}</p>
            {errors.bodyLimitMb ? <p className="text-xs text-destructive">{errors.bodyLimitMb}</p> : null}
          </div>

          <div className="space-y-2">
            <Label>{t('settings.fields.logLevel')}</Label>
            <Select value={form.logLevel} onValueChange={(value) => onSetForm((previous) => ({ ...previous, logLevel: value as LogLevel }))}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LOG_LEVEL_OPTIONS.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {t(`settings.fields.logLevelOption.${option.labelKey}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 md:col-span-2 sm:grid-cols-2">
            <ToggleCard
              label={t('settings.fields.storeRequestPayloads')}
              hint={t('settings.fields.storeRequestPayloadsHint')}
              checked={form.storeRequestPayloads}
              onCheckedChange={(checked) => onSetForm((previous) => ({ ...previous, storeRequestPayloads: checked }))}
            />
            <ToggleCard
              label={t('settings.fields.storeResponsePayloads')}
              hint={t('settings.fields.storeResponsePayloadsHint')}
              checked={form.storeResponsePayloads}
              onCheckedChange={(checked) => onSetForm((previous) => ({ ...previous, storeResponsePayloads: checked }))}
            />
            <ToggleCard
              label={t('settings.fields.enableRoutingFallback')}
              hint={t('settings.fields.enableRoutingFallbackHint')}
              checked={form.enableRoutingFallback}
              onCheckedChange={(checked) => onSetForm((previous) => ({ ...previous, enableRoutingFallback: checked }))}

            />
          </div>

          <div className="rounded-xl bg-secondary px-4 py-5 md:col-span-2">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">{t('settings.fields.defaults')}</Label>
            <p className="mt-2 text-sm">{defaultsSummary ?? t('settings.defaults.none')}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function ProtocolSection({
  errors,
  form,
  onSetForm,
  sectionRef
}: {
  errors: FormErrors
  form: FormState
  onSetForm: Dispatch<SetStateAction<FormState>>
  sectionRef?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()

  return (
    <Card
      id="section-protocol"
      ref={sectionRef}
      className="bg-card shadow-[var(--surface-shadow)]"
    >
      <CardContent className="space-y-6 pt-6">
        <div>
          <h3 className="text-sm font-semibold">{t('settings.sections.protocol')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.protocol.description')}</p>
        </div>

        <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/50 p-4 shadow-sm dark:bg-amber-950/24 dark:ring-amber-500/20">
          <div className="flex items-start gap-3">
            <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
            <div className="space-y-2">
              <p className="text-sm font-medium text-foreground">{t('settings.protocol.restartWarning')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.protocol.restartHint')}</p>
              <code className="block rounded-lg border border-border bg-secondary px-3 py-2 text-xs font-mono text-foreground dark:bg-secondary dark:border-border">cc-gw restart --daemon</code>
              <p className="text-xs text-muted-foreground">{t('settings.protocol.restartTip')}</p>
            </div>
          </div>
        </div>

        {errors.protocol ? (
          <div className="rounded-xl bg-destructive/10 ring-1 ring-destructive/30 p-4 text-sm text-destructive shadow-sm">
            <AlertCircle className="mr-2 inline h-4 w-4" />
            {errors.protocol}
          </div>
        ) : null}

        <div className="rounded-xl bg-secondary p-5 dark:bg-secondary">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <Label className="text-sm font-medium text-foreground">{t('settings.protocol.http.enable')}</Label>
              <p className="text-xs text-muted-foreground">{t('settings.protocol.http.hint')}</p>
            </div>
            <Switch checked={form.httpEnabled} onCheckedChange={(checked) => onSetForm((previous) => ({ ...previous, httpEnabled: checked }))} />
          </div>

          {form.httpEnabled ? (
            <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>{t('settings.protocol.http.port')}</Label>
                <Input type="number" min={1} max={65535} value={form.httpPort} onChange={(e) => onSetForm((previous) => ({ ...previous, httpPort: e.target.value }))} aria-invalid={Boolean(errors.httpPort)} />
                {errors.httpPort ? <p className="text-xs text-destructive">{errors.httpPort}</p> : null}
              </div>
              <div className="space-y-2">
                <Label>{t('settings.protocol.http.host')}</Label>
                <Input value={form.httpHost} onChange={(e) => onSetForm((previous) => ({ ...previous, httpHost: e.target.value }))} placeholder="127.0.0.1" />
              </div>
            </div>
          ) : null}
        </div>

        <div className="rounded-xl bg-secondary p-5 dark:bg-secondary">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Label className="text-sm font-medium text-foreground">{t('settings.protocol.https.enable')}</Label>
                <Shield className="h-4 w-4 text-muted-foreground" />
              </div>
              <p className="text-xs text-muted-foreground">{t('settings.protocol.https.hint')}</p>
            </div>
            <Switch checked={form.httpsEnabled} onCheckedChange={(checked) => onSetForm((previous) => ({ ...previous, httpsEnabled: checked }))} />
          </div>

          {form.httpsEnabled ? (
            <div className="mt-4 space-y-4 border-t border-border pt-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('settings.protocol.https.port')}</Label>
                  <Input type="number" min={1} max={65535} value={form.httpsPort} onChange={(e) => onSetForm((previous) => ({ ...previous, httpsPort: e.target.value }))} aria-invalid={Boolean(errors.httpsPort)} />
                  {errors.httpsPort ? <p className="text-xs text-destructive">{errors.httpsPort}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.protocol.https.host')}</Label>
                  <Input value={form.httpsHost} onChange={(e) => onSetForm((previous) => ({ ...previous, httpsHost: e.target.value }))} placeholder="127.0.0.1" />
                </div>
              </div>

              <ProtocolPathField label={t('settings.protocol.https.keyPath')} value={form.httpsKeyPath} onChange={(value) => onSetForm((previous) => ({ ...previous, httpsKeyPath: value }))} placeholder="~/.cc-gw/certs/key.pem" />
              <ProtocolPathField label={t('settings.protocol.https.certPath')} value={form.httpsCertPath} onChange={(value) => onSetForm((previous) => ({ ...previous, httpsCertPath: value }))} placeholder="~/.cc-gw/certs/cert.pem" />
              <ProtocolPathField label={t('settings.protocol.https.caPath')} value={form.httpsCaPath} onChange={(value) => onSetForm((previous) => ({ ...previous, httpsCaPath: value }))} placeholder="留空则不使用" />

              <div className="rounded-xl bg-amber-50 ring-1 ring-amber-200/50 p-4 shadow-sm dark:bg-amber-950/24 dark:ring-amber-500/20">
                <div className="flex items-start gap-3">
                  <AlertCircle className="mt-0.5 h-5 w-5 flex-shrink-0 text-amber-600 dark:text-amber-400" />
                  <div className="flex-1 space-y-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">{t('settings.protocol.https.warning')}</p>
                    <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300"><strong>{t('settings.protocol.https.invalidCert')}</strong>{t('settings.protocol.https.invalidCertDetail')}</p>
                    <p className="text-xs leading-relaxed text-amber-700 dark:text-amber-300"><strong>{t('settings.protocol.https.recommended')}</strong>{t('settings.protocol.https.recommendedDetail')}</p>
                    <p className="text-xs leading-relaxed text-amber-600 dark:text-amber-400">{t('settings.protocol.https.tip')}</p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

export function SecuritySection({
  authErrors,
  authForm,
  authLoading,
  authSettings,
  needsPassword,
  onAuthReset,
  onAuthSave,
  onSetAuthForm,
  savingAuth,
  isAuthDirty,
  sectionRef
}: {
  authErrors: AuthFormErrors
  authForm: AuthFormState
  authLoading: boolean
  authSettings: { enabled: boolean; username?: string } | null
  needsPassword: boolean
  onAuthReset: () => void
  onAuthSave: () => void
  onSetAuthForm: Dispatch<SetStateAction<AuthFormState>>
  savingAuth: boolean
  isAuthDirty: boolean
  sectionRef?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()

  return (
    <Card
      id="section-security"
      ref={sectionRef}
      className="bg-card shadow-[var(--surface-shadow)]"
    >
      <CardContent className="space-y-5 pt-6">
        <div>
          <h3 className="text-sm font-semibold">{t('settings.sections.security')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.auth.description')}</p>
        </div>

        {authLoading && !authSettings ? (
          <div className="flex min-h-[120px] items-center justify-center">
            <Loader />
          </div>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 rounded-xl bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-2">
                <Label className="text-sm font-medium">{t('settings.auth.enable')}</Label>
                <p className="text-xs text-muted-foreground">{t('settings.auth.enableHint')}</p>
                <div className="flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] tracking-[0.08em]">/ui</span>
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] tracking-[0.08em]">/api/*</span>
                  <span className="rounded-full bg-secondary px-3 py-1 text-[11px] tracking-[0.08em]">Cookie Session</span>
                </div>
              </div>
              <div className="flex items-center gap-3 self-start sm:self-auto">
                <Badge variant={authForm.enabled ? 'success' : 'secondary'}>
                  {authForm.enabled ? t('settings.auth.statusEnabled') : t('settings.auth.statusDisabled')}
                </Badge>
                <Switch checked={authForm.enabled} onCheckedChange={(checked) => onSetAuthForm((previous) => ({ ...previous, enabled: checked }))} />
              </div>
            </div>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label>{t('settings.auth.username')}</Label>
                  <Input value={authForm.username} onChange={(e) => onSetAuthForm((previous) => ({ ...previous, username: e.target.value }))} placeholder={t('settings.auth.usernamePlaceholder')} />
                  {authErrors.username ? <p className="text-xs text-destructive">{authErrors.username}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.auth.password')}</Label>
                  <Input type="password" value={authForm.password} disabled={!authForm.enabled} onChange={(e) => onSetAuthForm((previous) => ({ ...previous, password: e.target.value }))} placeholder={t('settings.auth.passwordPlaceholder')} />
                  {authErrors.password ? (
                    <p className="text-xs text-destructive">{authErrors.password}</p>
                  ) : (
                    <p className="text-xs text-muted-foreground">{t(needsPassword ? 'settings.auth.passwordHintRequired' : 'settings.auth.passwordHintOptional')}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>{t('settings.auth.confirmPassword')}</Label>
                  <Input type="password" value={authForm.confirmPassword} disabled={!authForm.enabled} onChange={(e) => onSetAuthForm((previous) => ({ ...previous, confirmPassword: e.target.value }))} placeholder={t('settings.auth.confirmPasswordPlaceholder')} />
                  {authErrors.confirmPassword ? <p className="text-xs text-destructive">{authErrors.confirmPassword}</p> : null}
                </div>
              </div>

              <div className="flex flex-col gap-4">
                <div className="rounded-xl bg-secondary p-4">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.34em] text-muted-foreground">{t('settings.auth.status')}</p>
                  <p className="mt-2 text-base font-semibold">{authSettings?.enabled ? t('settings.auth.statusEnabled') : t('settings.auth.statusDisabled')}</p>
                  {authSettings?.username ? (
                    <div className="mt-3 rounded-lg bg-accent px-3 py-2 text-xs font-medium text-primary">{t('settings.auth.username')}: {authSettings.username}</div>
                  ) : null}
                </div>
                <div className="rounded-xl bg-secondary px-4 py-3 text-xs text-muted-foreground">
                  {t(needsPassword ? 'settings.auth.passwordHintRequired' : 'settings.auth.passwordHintOptional')}
                </div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:justify-end">
              <Button onClick={onAuthSave} disabled={savingAuth || !isAuthDirty} className="w-full lg:w-auto">
                {savingAuth ? t('common.actions.saving') : t('settings.auth.actions.save')}
              </Button>
              <Button variant="outline" onClick={onAuthReset} disabled={savingAuth || !isAuthDirty} className="w-full lg:w-auto">
                {t('common.actions.reset')}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function ConfigFileSection({
  configPath,
  onCopyPath,
  sectionRef
}: {
  configPath: string
  onCopyPath: () => void
  sectionRef?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()

  return (
    <Card
      id="section-config-file"
      ref={sectionRef}
      className="bg-card shadow-[var(--surface-shadow)]"
    >
      <CardContent className="space-y-3 pt-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold">{t('settings.sections.configFile')}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t('settings.file.description')}</p>
          </div>
          <Button variant="outline" size="sm" onClick={onCopyPath} className="w-full sm:w-auto">
            <Copy className="mr-2 h-4 w-4" />
            {t('common.actions.copy')}
          </Button>
        </div>
        <code className="block break-all rounded-lg bg-secondary px-4 py-3 text-xs font-mono text-muted-foreground">
          {configPath || t('settings.file.unknown')}
        </code>
        <div className="rounded-lg bg-secondary px-4 py-3 text-xs text-muted-foreground">
          {t('help.note')}
        </div>
      </CardContent>
    </Card>
  )
}

export function CleanupSection({
  cleaning,
  clearingAll,
  onOpenCleanup,
  onOpenClearAll,
  sectionRef
}: {
  cleaning: boolean
  clearingAll: boolean
  onOpenCleanup: () => void
  onOpenClearAll: () => void
  sectionRef?: Ref<HTMLDivElement>
}) {
  const { t } = useTranslation()

  return (
    <Card
      id="section-cleanup"
      ref={sectionRef}
      className="bg-card shadow-[var(--surface-shadow)]"
    >
      <CardContent className="space-y-4 pt-6">
        <div>
          <h3 className="text-sm font-semibold">{t('settings.sections.cleanup')}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t('settings.cleanup.description')}</p>
        </div>
        <div className="rounded-lg bg-secondary px-4 py-3 text-xs text-muted-foreground">
          {t('settings.cleanup.confirmCleanup')}
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-5 dark:border-amber-800 dark:bg-amber-950/30">
            <div className="space-y-2">
              <Badge variant="warning">{t('settings.cleanup.softLabel')}</Badge>
              <p className="text-sm font-medium">{t('settings.cleanup.softTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.cleanup.softDescription')}</p>
              <Button variant="outline" onClick={onOpenCleanup} disabled={cleaning} className="w-full sm:w-auto">
                {cleaning ? t('common.actions.cleaning') : t('common.actions.cleanup')}
              </Button>
            </div>
          </div>
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-5 text-destructive">
            <div className="space-y-2">
              <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">{t('settings.cleanup.hardLabel')}</Badge>
              <p className="text-sm font-medium">{t('settings.cleanup.hardTitle')}</p>
              <p className="text-xs text-muted-foreground">{t('settings.cleanup.clearAllWarning')}</p>
              <Button variant="destructive" onClick={onOpenClearAll} disabled={clearingAll} className="w-full sm:w-auto">
                {clearingAll ? t('settings.cleanup.clearingAll') : t('settings.cleanup.clearAll')}
              </Button>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function StickySettingsSaveBar({
  isAuthDirty,
  isConfigDirty,
  protocolChangesPending,
  onAuthReset,
  onAuthSave,
  onReset,
  onSave,
  saving,
  savingAuth
}: {
  isAuthDirty: boolean
  isConfigDirty: boolean
  protocolChangesPending: boolean
  onAuthReset: () => void
  onAuthSave: () => void
  onReset: () => void
  onSave: () => void
  saving: boolean
  savingAuth: boolean
}) {
  const { t } = useTranslation()

  if (!isAuthDirty && !isConfigDirty) {
    return null
  }

  return (
    <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-xl bg-card border border-border px-6 py-5 shadow-lg md:flex-row md:items-center md:justify-between">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{t('modelManagement.actions.unsaved')}</Badge>
          {isConfigDirty ? <Badge variant="outline">{t('settings.sections.basics')}</Badge> : null}
          {isAuthDirty ? <Badge variant="outline">{t('settings.sections.security')}</Badge> : null}
          {protocolChangesPending ? (
            <Badge variant="outline" className="border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-300">
              {t('settings.sections.protocol')}
            </Badge>
          ) : null}
        </div>
        <p className="text-sm text-muted-foreground">
          {protocolChangesPending ? t('settings.toast.protocolRestartRequired') : t('modelManagement.actions.footerDirtyHint')}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-center">
        {isAuthDirty ? (
          <>
            <Button variant="outline" onClick={onAuthReset} disabled={savingAuth} className="w-full lg:w-auto">{t('common.actions.reset')}</Button>
            <Button onClick={onAuthSave} disabled={savingAuth} className="w-full lg:w-auto">{savingAuth ? t('common.actions.saving') : t('settings.auth.actions.save')}</Button>
          </>
        ) : null}
        {isConfigDirty ? (
          <>
            <Button variant="outline" onClick={onReset} disabled={saving} className="w-full lg:w-auto">{t('common.actions.reset')}</Button>
            <Button onClick={onSave} disabled={saving} className="w-full lg:w-auto">{saving ? t('common.actions.saving') : t('common.actions.save')}</Button>
          </>
        ) : null}
      </div>
    </div>
  )
}

function OverviewCard({ label, value, helper, mono = false }: { label: string; value: string; helper: string; mono?: boolean }) {
  return (
    <div className="min-w-0 rounded-[0.95rem] bg-secondary/65 px-3.5 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.62)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{label}</p>
      <p className={cn('mt-1.5 truncate text-xl font-semibold text-foreground', mono ? 'font-mono text-sm leading-tight' : '')} title={typeof value === 'string' ? value : undefined}>{value}</p>
      <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-muted-foreground">{helper}</p>
    </div>
  )
}

function MiniInfoCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-secondary px-3 py-2 text-center">
      <p className="text-[10px] font-semibold uppercase tracking-[0.3em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-semibold text-foreground">{value}</p>
    </div>
  )
}

function ToggleCard({
  checked,
  className,
  hint,
  hintClassName,
  label,
  labelClassName,
  onCheckedChange
}: {
  checked: boolean
  className?: string
  hint: string
  hintClassName?: string
  label: string
  labelClassName?: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl bg-secondary p-4 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
    >
      <div className="space-y-1">
        <Label className={cn('text-sm font-semibold text-foreground', labelClassName)}>{label}</Label>
        <p className={cn('text-xs text-muted-foreground', hintClassName)}>{hint}</p>
      </div>
      <Switch checked={checked} onCheckedChange={onCheckedChange} className="self-start sm:self-auto" />
    </div>
  )
}

function ProtocolPathField({
  label,
  onChange,
  placeholder,
  value
}: {
  label: string
  onChange: (value: string) => void
  placeholder: string
  value: string
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <Input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="font-mono text-xs" />
    </div>
  )
}
