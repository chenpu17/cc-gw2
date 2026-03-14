import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Settings as SettingsIcon, Copy, Shield, AlertCircle } from 'lucide-react'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useToast } from '@/providers/ToastProvider'
import { Loader } from '@/components/Loader'
import { PageHeader } from '@/components/PageHeader'
import { ConfirmDialog } from '@/components/ConfirmDialog'
import { cn } from '@/lib/utils'
import { copyToClipboard } from '@/utils/clipboard'
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
import { apiClient, type ApiError } from '@/services/api'
import type { ConfigInfoResponse, GatewayConfig, WebAuthStatusResponse } from '@/types/providers'

type LogLevel = NonNullable<GatewayConfig['logLevel']>

const LOG_LEVEL_OPTIONS: Array<{ value: LogLevel; labelKey: string }> = [
  { value: 'fatal', labelKey: 'fatal' },
  { value: 'error', labelKey: 'error' },
  { value: 'warn', labelKey: 'warn' },
  { value: 'info', labelKey: 'info' },
  { value: 'debug', labelKey: 'debug' },
  { value: 'trace', labelKey: 'trace' }
]

interface FormState {
  port: string
  host: string
  logRetentionDays: string
  logExportTimeoutSeconds: string
  storeRequestPayloads: boolean
  storeResponsePayloads: boolean
  logLevel: LogLevel
  requestLogging: boolean
  responseLogging: boolean
  bodyLimitMb: string
  enableRoutingFallback: boolean
  httpEnabled: boolean
  httpPort: string
  httpHost: string
  httpsEnabled: boolean
  httpsPort: string
  httpsHost: string
  httpsKeyPath: string
  httpsCertPath: string
  httpsCaPath: string
}

interface FormErrors {
  port?: string
  logRetentionDays?: string
  logExportTimeoutSeconds?: string
  bodyLimitMb?: string
  httpPort?: string
  httpsPort?: string
  protocol?: string
}

interface AuthFormState {
  enabled: boolean
  username: string
  password: string
  confirmPassword: string
}

interface AuthFormErrors {
  username?: string
  password?: string
  confirmPassword?: string
}

interface CleanupResponse {
  success: boolean
  deleted: number
}

interface ClearResponse {
  success: boolean
  deleted: number
  metricsCleared: number
}

const SETTINGS_SECTIONS = [
  { id: 'section-basics', labelKey: 'settings.sections.basics' },
  { id: 'section-protocol', labelKey: 'settings.sections.protocol' },
  { id: 'section-security', labelKey: 'settings.sections.security' },
  { id: 'section-config-file', labelKey: 'settings.sections.configFile' },
  { id: 'section-cleanup', labelKey: 'settings.sections.cleanup' }
] as const

function deriveFormState(config: GatewayConfig): FormState {
  const legacyStore = config.storePayloads
  const deriveStoreFlag = (value?: boolean) =>
    typeof value === 'boolean' ? value : typeof legacyStore === 'boolean' ? legacyStore : true

  return {
    port: String(config.port ?? config.http?.port ?? ''),
    host: config.host ?? config.http?.host ?? '127.0.0.1',
    logRetentionDays: String(config.logRetentionDays ?? 30),
    logExportTimeoutSeconds: String(config.logExportTimeoutSeconds ?? 60),
    storeRequestPayloads: deriveStoreFlag(config.storeRequestPayloads),
    storeResponsePayloads: deriveStoreFlag(config.storeResponsePayloads),
    logLevel: (config.logLevel as LogLevel) ?? 'info',
    requestLogging: config.requestLogging !== false,
    responseLogging: config.responseLogging ?? config.requestLogging !== false,
    bodyLimitMb: (() => {
      const raw = config.bodyLimit
      if (typeof raw === 'number' && Number.isFinite(raw) && raw > 0) {
        return String(Math.max(1, Math.round(raw / (1024 * 1024))))
      }
      return '10'
    })(),
    enableRoutingFallback: config.enableRoutingFallback === true,
    httpEnabled: config.http?.enabled !== false,
    httpPort: String(config.http?.port ?? config.port ?? 4100),
    httpHost: config.http?.host ?? config.host ?? '127.0.0.1',
    httpsEnabled: config.https?.enabled === true,
    httpsPort: String(config.https?.port ?? 4443),
    httpsHost: config.https?.host ?? config.host ?? '127.0.0.1',
    httpsKeyPath: config.https?.keyPath ?? '',
    httpsCertPath: config.https?.certPath ?? '',
    httpsCaPath: config.https?.caPath ?? ''
  }
}

function deriveAuthFormState(auth: WebAuthStatusResponse): AuthFormState {
  return {
    enabled: auth.enabled,
    username: auth.username ?? '',
    password: '',
    confirmPassword: ''
  }
}

export default function SettingsPage() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const handleSectionClick = useCallback((id: string) => {
    const el = sectionRefs.current.get(id)
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const setSectionRef = useCallback((id: string) => (el: HTMLElement | null) => {
    if (el) {
      sectionRefs.current.set(id, el)
    } else {
      sectionRefs.current.delete(id)
    }
  }, [])

  const configQuery = useApiQuery<ConfigInfoResponse, ApiError>(
    ['config', 'info'],
    { url: '/api/config/info', method: 'GET' }
  )
  const authQuery = useApiQuery<WebAuthStatusResponse, ApiError>(
    ['auth', 'web'],
    { url: '/api/auth/web', method: 'GET' }
  )

  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [configPath, setConfigPath] = useState<string>('')
  const [form, setForm] = useState<FormState>({
    port: '',
    host: '',
    logRetentionDays: '',
    logExportTimeoutSeconds: '60',
    storeRequestPayloads: true,
    storeResponsePayloads: true,
    logLevel: 'info',
    requestLogging: true,
    responseLogging: true,
    bodyLimitMb: '10',
    enableRoutingFallback: false,
    httpEnabled: true,
    httpPort: '4100',
    httpHost: '127.0.0.1',
    httpsEnabled: false,
    httpsPort: '4443',
    httpsHost: '127.0.0.1',
    httpsKeyPath: '',
    httpsCertPath: '',
    httpsCaPath: ''
  })
  const [errors, setErrors] = useState<FormErrors>({})
  const [saving, setSaving] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [clearingAll, setClearingAll] = useState(false)
  const [confirmCleanupOpen, setConfirmCleanupOpen] = useState(false)
  const [confirmClearAllOpen, setConfirmClearAllOpen] = useState(false)
  const [authSettings, setAuthSettings] = useState<WebAuthStatusResponse | null>(null)
  const [authForm, setAuthForm] = useState<AuthFormState>({
    enabled: false,
    username: '',
    password: '',
    confirmPassword: ''
  })
  const [authErrors, setAuthErrors] = useState<AuthFormErrors>({})
  const [savingAuth, setSavingAuth] = useState(false)

  const defaultsSummary = useMemo(() => {
    if (!config) return null
    const defaults = config.defaults
    if (!defaults) return null
    const mappings: string[] = []
    if (defaults.completion) mappings.push(t('settings.defaults.completion', { model: defaults.completion }))
    if (defaults.reasoning) mappings.push(t('settings.defaults.reasoning', { model: defaults.reasoning }))
    if (defaults.background) mappings.push(t('settings.defaults.background', { model: defaults.background }))
    return mappings.length > 0 ? mappings.join(' ｜ ') : t('settings.defaults.none')
  }, [config, t])
  const protocolSummaryLabel = useMemo(() => {
    if (form.httpEnabled && form.httpsEnabled) return t('settings.overview.values.httpAndHttps')
    if (form.httpsEnabled) return t('settings.overview.values.httpsOnly')
    return t('settings.overview.values.httpOnly')
  }, [form.httpEnabled, form.httpsEnabled, t])

  const needsPassword = useMemo(() => {
    if (!authForm.enabled) return false
    if (!authSettings?.hasPassword) return true
    return authForm.username.trim() !== (authSettings?.username ?? '')
  }, [authForm.enabled, authForm.username, authSettings])

  const initialForm = useMemo(() => (config ? deriveFormState(config) : null), [config])
  const isConfigDirty = useMemo(
    () => (initialForm ? JSON.stringify(form) !== JSON.stringify(initialForm) : false),
    [form, initialForm]
  )
  const initialAuthForm = useMemo(
    () => (authSettings ? deriveAuthFormState(authSettings) : null),
    [authSettings]
  )
  const isAuthDirty = useMemo(
    () => (initialAuthForm ? JSON.stringify(authForm) !== JSON.stringify(initialAuthForm) : false),
    [authForm, initialAuthForm]
  )

  useEffect(() => {
    if (configQuery.data) {
      setConfig(configQuery.data.config)
      setConfigPath(configQuery.data.path)
      setForm(deriveFormState(configQuery.data.config))
    }
  }, [configQuery.data])

  useEffect(() => {
    if (authQuery.data) {
      setAuthSettings(authQuery.data)
      setAuthForm(deriveAuthFormState(authQuery.data))
      setAuthErrors({})
    }
  }, [authQuery.data])

  useEffect(() => {
    if (configQuery.isError && configQuery.error) {
      pushToast({
        title: t('settings.toast.loadFailure', { message: configQuery.error.message }),
        variant: 'error'
      })
    }
  }, [configQuery.isError, configQuery.error, pushToast, t])

  useEffect(() => {
    if (authQuery.isError && authQuery.error) {
      pushToast({
        title: t('settings.toast.authLoadFailure', { message: authQuery.error.message }),
        variant: 'error'
      })
    }
  }, [authQuery.isError, authQuery.error, pushToast, t])

  const handleInputChange = (
    field: 'port' | 'host' | 'logRetentionDays' | 'logExportTimeoutSeconds' | 'bodyLimitMb'
  ) => (value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }))
  }

  const validate = (): boolean => {
    const nextErrors: FormErrors = {}

    if (!form.httpEnabled && !form.httpsEnabled) {
      nextErrors.protocol = '至少需要启用 HTTP 或 HTTPS 协议'
    }

    if (form.httpEnabled) {
      const httpPortValue = Number(form.httpPort)
      if (!Number.isFinite(httpPortValue) || httpPortValue < 1 || httpPortValue > 65535) {
        nextErrors.httpPort = 'HTTP 端口必须在 1-65535 之间'
      }
    }

    if (form.httpsEnabled) {
      const httpsPortValue = Number(form.httpsPort)
      if (!Number.isFinite(httpsPortValue) || httpsPortValue < 1 || httpsPortValue > 65535) {
        nextErrors.httpsPort = 'HTTPS 端口必须在 1-65535 之间'
      }

      if (!form.httpsKeyPath || !form.httpsCertPath) {
        nextErrors.protocol = 'HTTPS 已启用但缺少证书路径，请手动配置受信任的证书'
      }
    }

    const portValue = Number(form.port)
    if (!Number.isFinite(portValue) || portValue < 1 || portValue > 65535) {
      nextErrors.port = t('settings.validation.port')
    }
    const retentionValue = Number(form.logRetentionDays)
    if (!Number.isFinite(retentionValue) || retentionValue < 1 || retentionValue > 365) {
      nextErrors.logRetentionDays = t('settings.validation.retention')
    }
    const logExportTimeoutValue = Number(form.logExportTimeoutSeconds)
    if (!Number.isFinite(logExportTimeoutValue) || logExportTimeoutValue < 5 || logExportTimeoutValue > 600) {
      nextErrors.logExportTimeoutSeconds = t('settings.validation.logExportTimeout')
    }
    const bodyLimitValue = Number(form.bodyLimitMb)
    if (!Number.isFinite(bodyLimitValue) || bodyLimitValue < 1 || bodyLimitValue > 2048) {
      nextErrors.bodyLimitMb = t('settings.validation.bodyLimit')
    }
    setErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const validateAuth = (): boolean => {
    const nextErrors: AuthFormErrors = {}
    const usernameValue = authForm.username.trim()
    const usernameChanged = authSettings ? usernameValue !== (authSettings.username ?? '') : true
    const needsPassword =
      authForm.enabled &&
      (!authSettings?.hasPassword || usernameChanged)

    if (authForm.enabled && !usernameValue) {
      nextErrors.username = t('settings.auth.validation.username')
    }

    if (authForm.password && authForm.password.length < 6) {
      nextErrors.password = t('settings.auth.validation.minLength')
    }

    if (needsPassword && !authForm.password) {
      nextErrors.password = t('settings.auth.validation.passwordRequired')
    }

    if (authForm.password || authForm.confirmPassword) {
      if (authForm.password !== authForm.confirmPassword) {
        nextErrors.confirmPassword = t('settings.auth.validation.confirmMismatch')
      }
    }

    setAuthErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }

  const handleSave = async () => {
    if (!config) {
      pushToast({ title: t('settings.toast.loadFailure', { message: t('settings.toast.missingConfig') }), variant: 'error' })
      return
    }
    if (!validate()) return
    setSaving(true)
    try {
      const portValue = Number(form.port)
      const retentionValue = Number(form.logRetentionDays)
      const logExportTimeoutValue = Number(form.logExportTimeoutSeconds)
      const bodyLimitValue = Number(form.bodyLimitMb)

      const nextConfig: GatewayConfig = {
        ...config,
        http: {
          enabled: form.httpEnabled,
          port: Number(form.httpPort),
          host: form.httpHost.trim() || '127.0.0.1'
        },
        https: {
          enabled: form.httpsEnabled,
          port: Number(form.httpsPort),
          host: form.httpsHost.trim() || '127.0.0.1',
          keyPath: form.httpsKeyPath.trim(),
          certPath: form.httpsCertPath.trim(),
          caPath: form.httpsCaPath.trim() || undefined
        },
        port: portValue,
        host: form.host.trim() || undefined,
        logRetentionDays: retentionValue,
        logExportTimeoutSeconds: Math.min(Math.max(Math.round(logExportTimeoutValue), 5), 600),
        storeRequestPayloads: form.storeRequestPayloads,
        storeResponsePayloads: form.storeResponsePayloads,
        logLevel: form.logLevel,
        requestLogging: form.requestLogging,
        responseLogging: form.responseLogging,
        bodyLimit: Math.max(1, Math.floor(bodyLimitValue * 1024 * 1024)),
        enableRoutingFallback: form.enableRoutingFallback
      }
      const payload = { ...nextConfig } as GatewayConfig & { webAuth?: never }
      delete payload.webAuth
      await apiClient.put('/api/config', payload)
      setConfig({ ...nextConfig, webAuth: config.webAuth })

      const normalizeOptionalPath = (value?: string) => value?.trim() || undefined
      const previousRootPort = config.port ?? config.http?.port ?? 4100
      const nextRootPort = nextConfig.port ?? nextConfig.http?.port ?? 4100
      const previousRootHost = config.host?.trim() || config.http?.host?.trim() || '127.0.0.1'
      const nextRootHost = nextConfig.host?.trim() || nextConfig.http?.host?.trim() || '127.0.0.1'
      const protocolChanged =
        previousRootPort !== nextRootPort ||
        previousRootHost !== nextRootHost ||
        config.http?.enabled !== nextConfig.http?.enabled ||
        config.http?.port !== nextConfig.http?.port ||
        (config.http?.host ?? config.host ?? '127.0.0.1') !== (nextConfig.http?.host ?? nextConfig.host ?? '127.0.0.1') ||
        config.https?.enabled !== nextConfig.https?.enabled ||
        config.https?.port !== nextConfig.https?.port ||
        (config.https?.host ?? config.host ?? '127.0.0.1') !== (nextConfig.https?.host ?? nextConfig.host ?? '127.0.0.1') ||
        config.https?.keyPath !== nextConfig.https?.keyPath ||
        config.https?.certPath !== nextConfig.https?.certPath ||
        normalizeOptionalPath(config.https?.caPath) !== normalizeOptionalPath(nextConfig.https?.caPath)

      if (protocolChanged) {
        pushToast({
          title: t('settings.toast.protocolRestartRequired'),
          variant: 'success'
        })
      } else {
        pushToast({ title: t('settings.toast.saveSuccess'), variant: 'success' })
      }
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('settings.toast.saveFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleReset = () => {
    if (!config) return
    setForm(deriveFormState(config))
    setErrors({})
  }

  const handleAuthSave = async () => {
    if (!validateAuth()) return
    setSavingAuth(true)
    try {
      const payload: { enabled: boolean; username?: string; password?: string } = {
        enabled: authForm.enabled,
        username: authForm.username.trim() || undefined
      }
      if (authForm.password) {
        payload.password = authForm.password
      }
      const response = await apiClient.post('/api/auth/web', payload)
      const updatedAuth = (response.data as { auth?: WebAuthStatusResponse })?.auth
      if (updatedAuth) {
        setAuthSettings(updatedAuth)
        setAuthForm({
          enabled: updatedAuth.enabled,
          username: updatedAuth.username ?? '',
          password: '',
          confirmPassword: ''
        })
        setAuthErrors({})
      }
      pushToast({ title: t('settings.auth.toast.success'), variant: 'success' })
      void authQuery.refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown'
      pushToast({
        title: t('settings.auth.toast.failure', { message }),
        variant: 'error'
      })
    } finally {
      setSavingAuth(false)
    }
  }

  const handleAuthReset = () => {
    if (!authSettings) return
    setAuthForm(deriveAuthFormState(authSettings))
    setAuthErrors({})
  }

  const handleCopyPath = async () => {
    if (!configPath) {
      pushToast({ title: t('settings.toast.copyFailure', { message: t('settings.file.unknown') }), variant: 'error' })
      return
    }
    try {
      await copyToClipboard(configPath)
      pushToast({ title: t('settings.toast.copySuccess'), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('settings.toast.copyFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    }
  }

  const handleCleanupLogs = async () => {
    setCleaning(true)
    try {
      const response = await apiClient.post<CleanupResponse>('/api/logs/cleanup')
      const deleted = response.data.deleted ?? 0
      pushToast({
        title:
          deleted > 0
            ? t('settings.toast.cleanupSuccess', { count: deleted })
            : t('settings.toast.cleanupNone'),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('settings.toast.cleanupFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    } finally {
      setCleaning(false)
    }
  }

  const handleClearAllLogs = async () => {
    setClearingAll(true)
    try {
      const response = await apiClient.post<ClearResponse>('/api/logs/clear')
      const { deleted, metricsCleared } = response.data
      pushToast({
        title: t('settings.toast.clearAllSuccess', {
          logs: deleted,
          metrics: metricsCleared
        }),
        variant: 'success'
      })
    } catch (error) {
      pushToast({
        title: t('settings.toast.clearAllFailure', {
          message: error instanceof Error ? error.message : 'unknown'
        }),
        variant: 'error'
      })
    } finally {
      setClearingAll(false)
    }
  }

  const isLoading = configQuery.isPending || (!config && configQuery.isFetching)

  useEffect(() => {
    if (isLoading) return

    const elements = Array.from(sectionRefs.current.values())
    if (elements.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSection(entry.target.id)
            break
          }
        }
      },
      { rootMargin: '-80px 0px -60% 0px', threshold: 0 }
    )

    for (const el of elements) {
      observer.observe(el)
    }
    return () => observer.disconnect()
  }, [isLoading])

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<SettingsIcon className="h-5 w-5" aria-hidden="true" />}
        title={t('settings.title')}
        description={t('settings.description')}
        eyebrow="Gateway Controls"
        breadcrumb="Gateway / Settings"
        helper={t('settings.overview.description')}
        badge={isConfigDirty || isAuthDirty ? t('modelManagement.actions.unsaved') : undefined}
        actions={
          config ? (
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={handleReset} disabled={saving || !isConfigDirty}>
                {t('common.actions.reset')}
              </Button>
              <Button onClick={() => void handleSave()} disabled={saving || !isConfigDirty}>
                {saving ? t('common.actions.saving') : t('common.actions.save')}
              </Button>
            </div>
          ) : null
        }
      />

      {isLoading ? (
        <Card>
          <CardContent className="flex min-h-[220px] items-center justify-center">
            <Loader />
          </CardContent>
        </Card>
      ) : !config ? (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-destructive">{t('settings.toast.missingConfig')}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-[200px_1fr] gap-6">
          {/* Sticky sidebar nav - hidden on mobile */}
          <nav className="hidden xl:block">
            <div className="sticky top-20 space-y-1">
              <p className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {t('settings.sections.jump')}
              </p>
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionClick(section.id)}
                  className={cn(
                    'block w-full rounded-2xl px-3.5 py-2.5 text-left text-sm transition-all',
                    activeSection === section.id
                      ? 'bg-primary/10 font-medium text-primary shadow-[inset_0_0_0_1px_rgba(59,130,246,0.08)]'
                      : 'text-muted-foreground hover:bg-background/80 hover:text-foreground'
                  )}
                >
                  {t(section.labelKey)}
                </button>
              ))}
            </div>
          </nav>

          <div className="flex flex-col gap-6">
          <Card className="border-white/40 bg-card/88 backdrop-blur">
            <CardContent className="space-y-4 pt-5">
              <div className="space-y-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  {t('settings.overview.title')}
                </p>
                <p className="text-sm text-muted-foreground">{t('settings.overview.description')}</p>
              </div>
              <div className="grid gap-4 md:grid-cols-3">
                <OverviewCard
                  label={t('settings.overview.cards.protocols')}
                  value={protocolSummaryLabel}
                  helper={`${form.httpHost || '127.0.0.1'}:${form.httpPort}${form.httpsEnabled ? ` / ${form.httpsHost || '127.0.0.1'}:${form.httpsPort}` : ''}`}
                />
                <OverviewCard
                  label={t('settings.overview.cards.security')}
                  value={authSettings?.enabled ? t('settings.overview.values.authEnabled') : t('settings.overview.values.authDisabled')}
                  helper={authSettings?.username ? `${t('settings.auth.username')}: ${authSettings.username}` : t('settings.auth.enableHint')}
                />
                <OverviewCard
                  label={t('settings.overview.cards.configFile')}
                  value={configPath || t('settings.file.unknown')}
                  helper={t('settings.file.description')}
                  mono
                />
              </div>
            </CardContent>
          </Card>

          <div className="xl:hidden">
            <div className="flex flex-wrap gap-2">
              {SETTINGS_SECTIONS.map((section) => (
                <button
                  key={section.id}
                  type="button"
                  onClick={() => handleSectionClick(section.id)}
                  className={cn(
                    'rounded-full border px-3.5 py-2 text-xs font-medium transition-all',
                    activeSection === section.id
                      ? 'border-primary/20 bg-primary text-primary-foreground shadow-[0_10px_24px_-18px_rgba(59,130,246,0.8)]'
                      : 'border-border/70 bg-background/80 text-muted-foreground hover:border-primary/20 hover:bg-primary/5 hover:text-foreground'
                  )}
                >
                  {t(section.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Basic Settings */}
          <Card id="section-basics" ref={setSectionRef('section-basics')}>
            <CardContent className="pt-6">
              <h3 className="mb-4 text-sm font-semibold">{t('settings.sections.basics')}</h3>
              <div className="grid gap-5 md:grid-cols-2">
                <div className="space-y-2">
                  <Label>{t('settings.fields.port')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={form.port}
                    onChange={(e) => handleInputChange('port')(e.target.value)}
                    aria-invalid={Boolean(errors.port)}
                  />
                  {errors.port && (
                    <p className="text-xs text-destructive">{errors.port}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.host')}</Label>
                  <Input
                    value={form.host}
                    onChange={(e) => handleInputChange('host')(e.target.value)}
                    placeholder={t('settings.fields.hostPlaceholder')}
                  />
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.retention')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={365}
                    value={form.logRetentionDays}
                    onChange={(e) => handleInputChange('logRetentionDays')(e.target.value)}
                    aria-invalid={Boolean(errors.logRetentionDays)}
                  />
                  {errors.logRetentionDays && (
                    <p className="text-xs text-destructive">{errors.logRetentionDays}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.logExportTimeout')}</Label>
                  <Input
                    type="number"
                    min={5}
                    max={600}
                    value={form.logExportTimeoutSeconds}
                    onChange={(e) => handleInputChange('logExportTimeoutSeconds')(e.target.value)}
                    aria-invalid={Boolean(errors.logExportTimeoutSeconds)}
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.fields.logExportTimeoutHint')}</p>
                  {errors.logExportTimeoutSeconds && (
                    <p className="text-xs text-destructive">{errors.logExportTimeoutSeconds}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.bodyLimit')}</Label>
                  <Input
                    type="number"
                    min={1}
                    max={2048}
                    value={form.bodyLimitMb}
                    onChange={(e) => handleInputChange('bodyLimitMb')(e.target.value)}
                    aria-invalid={Boolean(errors.bodyLimitMb)}
                  />
                  <p className="text-xs text-muted-foreground">{t('settings.fields.bodyLimitHint')}</p>
                  {errors.bodyLimitMb && (
                    <p className="text-xs text-destructive">{errors.bodyLimitMb}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label>{t('settings.fields.logLevel')}</Label>
                  <Select
                    value={form.logLevel}
                    onValueChange={(value) => setForm((prev) => ({ ...prev, logLevel: value as LogLevel }))}
                  >
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

                <div className="md:col-span-2 grid gap-4 sm:grid-cols-2">
                  <div className="flex items-center justify-between rounded-[1.2rem] border border-border/70 bg-background/55 p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.storeRequestPayloads')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.storeRequestPayloadsHint')}</p>
                    </div>
                    <Switch
                      checked={form.storeRequestPayloads}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, storeRequestPayloads: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-[1.2rem] border border-border/70 bg-background/55 p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.storeResponsePayloads')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.storeResponsePayloadsHint')}</p>
                    </div>
                    <Switch
                      checked={form.storeResponsePayloads}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, storeResponsePayloads: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-[1.2rem] border border-border/70 bg-background/55 p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.requestLogging')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.requestLoggingHint')}</p>
                    </div>
                    <Switch
                      checked={form.requestLogging}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, requestLogging: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-[1.2rem] border border-border/70 bg-background/55 p-4">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium">{t('settings.fields.responseLogging')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.fields.responseLoggingHint')}</p>
                    </div>
                    <Switch
                      checked={form.responseLogging}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, responseLogging: checked }))}
                    />
                  </div>

                  <div className="flex items-center justify-between rounded-[1.2rem] border border-amber-200 bg-amber-50/85 p-4 dark:border-amber-800 dark:bg-amber-950">
                    <div className="space-y-1">
                      <Label className="text-sm font-medium text-amber-700 dark:text-amber-300">
                        {t('settings.fields.enableRoutingFallback')}
                      </Label>
                      <p className="text-xs text-amber-600 dark:text-amber-400">
                        {t('settings.fields.enableRoutingFallbackHint')}
                      </p>
                    </div>
                    <Switch
                      checked={form.enableRoutingFallback}
                      onCheckedChange={(checked) => setForm((prev) => ({ ...prev, enableRoutingFallback: checked }))}
                    />
                  </div>
                </div>

                <div className="md:col-span-2 rounded-[1.2rem] border border-border/70 bg-background/55 p-4">
                  <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                    {t('settings.fields.defaults')}
                  </Label>
                  <p className="mt-2 text-sm">{defaultsSummary ?? t('settings.defaults.none')}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Protocol Settings */}
          <Card id="section-protocol" ref={setSectionRef('section-protocol')}>
            <CardContent className="pt-6 space-y-6">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.sections.protocol')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.protocol.description')}</p>
              </div>

              {/* Restart Warning */}
              <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50/85 p-4 dark:border-amber-800 dark:bg-amber-950">
                <div className="flex items-start gap-3">
                  <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                  <div className="space-y-2">
                    <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                      {t('settings.protocol.restartWarning')}
                    </p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      {t('settings.protocol.restartHint')}
                    </p>
                    <code className="block rounded-xl bg-amber-100/90 px-3 py-2 text-xs font-mono text-amber-900 dark:bg-amber-900 dark:text-amber-100">
                      cc-gw restart --daemon
                    </code>
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      {t('settings.protocol.restartTip')}
                    </p>
                  </div>
                </div>
              </div>

              {errors.protocol && (
                <div className="rounded-[1.2rem] border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
                  <AlertCircle className="inline h-4 w-4 mr-2" />
                  {errors.protocol}
                </div>
              )}

              {/* HTTP Config */}
              <div className="rounded-[1.4rem] border border-blue-200 bg-blue-50/60 p-5 dark:border-blue-800 dark:bg-blue-950/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-1">
                    <Label className="text-sm font-medium text-blue-800 dark:text-blue-200">
                      {t('settings.protocol.http.enable')}
                    </Label>
                    <p className="text-xs text-blue-600 dark:text-blue-400">
                      {t('settings.protocol.http.hint')}
                    </p>
                  </div>
                  <Switch
                    checked={form.httpEnabled}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, httpEnabled: checked }))}
                  />
                </div>

                {form.httpEnabled && (
                  <div className="grid gap-4 sm:grid-cols-2 mt-4 pt-4 border-t border-blue-200 dark:border-blue-800">
                    <div className="space-y-2">
                      <Label>{t('settings.protocol.http.port')}</Label>
                      <Input
                        type="number"
                        min={1}
                        max={65535}
                        value={form.httpPort}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpPort: e.target.value }))}
                        aria-invalid={Boolean(errors.httpPort)}
                      />
                      {errors.httpPort && (
                        <p className="text-xs text-destructive">{errors.httpPort}</p>
                      )}
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.http.host')}</Label>
                      <Input
                        value={form.httpHost}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpHost: e.target.value }))}
                        placeholder="127.0.0.1"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* HTTPS Config */}
              <div className="rounded-[1.4rem] border border-green-200 bg-green-50/60 p-5 dark:border-green-800 dark:bg-green-950/50">
                <div className="flex items-center justify-between mb-4">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <Label className="text-sm font-medium text-green-800 dark:text-green-200">
                        {t('settings.protocol.https.enable')}
                      </Label>
                      <Shield className="h-4 w-4 text-green-600 dark:text-green-400" />
                    </div>
                    <p className="text-xs text-green-600 dark:text-green-400">
                      {t('settings.protocol.https.hint')}
                    </p>
                  </div>
                  <Switch
                    checked={form.httpsEnabled}
                    onCheckedChange={(checked) => setForm((prev) => ({ ...prev, httpsEnabled: checked }))}
                  />
                </div>

                {form.httpsEnabled && (
                  <div className="space-y-4 mt-4 pt-4 border-t border-green-200 dark:border-green-800">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label>{t('settings.protocol.https.port')}</Label>
                        <Input
                          type="number"
                          min={1}
                          max={65535}
                          value={form.httpsPort}
                          onChange={(e) => setForm((prev) => ({ ...prev, httpsPort: e.target.value }))}
                          aria-invalid={Boolean(errors.httpsPort)}
                        />
                        {errors.httpsPort && (
                          <p className="text-xs text-destructive">{errors.httpsPort}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.protocol.https.host')}</Label>
                        <Input
                          value={form.httpsHost}
                          onChange={(e) => setForm((prev) => ({ ...prev, httpsHost: e.target.value }))}
                          placeholder="127.0.0.1"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.https.keyPath')}</Label>
                      <Input
                        value={form.httpsKeyPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpsKeyPath: e.target.value }))}
                        placeholder="~/.cc-gw/certs/key.pem"
                        className="font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.https.certPath')}</Label>
                      <Input
                        value={form.httpsCertPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpsCertPath: e.target.value }))}
                        placeholder="~/.cc-gw/certs/cert.pem"
                        className="font-mono text-xs"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label>{t('settings.protocol.https.caPath')}</Label>
                      <Input
                        value={form.httpsCaPath}
                        onChange={(e) => setForm((prev) => ({ ...prev, httpsCaPath: e.target.value }))}
                        placeholder="留空则不使用"
                        className="font-mono text-xs"
                      />
                    </div>

                    {/* HTTPS Certificate Warning */}
                    <div className="rounded-[1.2rem] border border-amber-200 bg-amber-50/85 p-4 dark:border-amber-800 dark:bg-amber-950">
                      <div className="flex items-start gap-3">
                        <AlertCircle className="h-5 w-5 text-amber-600 dark:text-amber-400 mt-0.5 flex-shrink-0" />
                        <div className="space-y-2 flex-1">
                          <p className="text-sm font-medium text-amber-800 dark:text-amber-200">
                            {t('settings.protocol.https.warning')}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                            <strong>{t('settings.protocol.https.invalidCert')}</strong>
                            {t('settings.protocol.https.invalidCertDetail')}
                          </p>
                          <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">
                            <strong>{t('settings.protocol.https.recommended')}</strong>
                            {t('settings.protocol.https.recommendedDetail')}
                          </p>
                          <p className="text-xs text-amber-600 dark:text-amber-400 leading-relaxed">
                            {t('settings.protocol.https.tip')}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Security Settings */}
          <Card id="section-security" ref={setSectionRef('section-security')}>
            <CardContent className="pt-6 space-y-5">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.sections.security')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.auth.description')}</p>
              </div>

              {authQuery.isPending && !authSettings ? (
                <div className="flex min-h-[120px] items-center justify-center">
                  <Loader />
                </div>
              ) : (
                <div className="space-y-6">
                  <div className="flex items-center justify-between rounded-[1.2rem] border border-border/70 bg-background/55 p-4">
                    <div className="space-y-2">
                      <Label className="text-sm font-medium">{t('settings.auth.enable')}</Label>
                      <p className="text-xs text-muted-foreground">{t('settings.auth.enableHint')}</p>
                      <div className="flex flex-wrap gap-2 text-xs font-medium text-muted-foreground">
                        <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">/ui</span>
                        <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">/api/*</span>
                        <span className="rounded-full border border-border/70 bg-background/70 px-3 py-1">Cookie Session</span>
                      </div>
                    </div>
                    <Switch
                      checked={authForm.enabled}
                      onCheckedChange={(checked) => setAuthForm((prev) => ({ ...prev, enabled: checked }))}
                    />
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-2 sm:col-span-2">
                        <Label>{t('settings.auth.username')}</Label>
                        <Input
                          value={authForm.username}
                          onChange={(e) => setAuthForm((prev) => ({ ...prev, username: e.target.value }))}
                          placeholder={t('settings.auth.usernamePlaceholder')}
                        />
                        {authErrors.username && (
                          <p className="text-xs text-destructive">{authErrors.username}</p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.auth.password')}</Label>
                        <Input
                          type="password"
                          value={authForm.password}
                          disabled={!authForm.enabled}
                          onChange={(e) => setAuthForm((prev) => ({ ...prev, password: e.target.value }))}
                          placeholder={t('settings.auth.passwordPlaceholder')}
                        />
                        {authErrors.password ? (
                          <p className="text-xs text-destructive">{authErrors.password}</p>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            {t(needsPassword ? 'settings.auth.passwordHintRequired' : 'settings.auth.passwordHintOptional')}
                          </p>
                        )}
                      </div>

                      <div className="space-y-2">
                        <Label>{t('settings.auth.confirmPassword')}</Label>
                        <Input
                          type="password"
                          value={authForm.confirmPassword}
                          disabled={!authForm.enabled}
                          onChange={(e) => setAuthForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                          placeholder={t('settings.auth.confirmPasswordPlaceholder')}
                        />
                        {authErrors.confirmPassword && (
                          <p className="text-xs text-destructive">{authErrors.confirmPassword}</p>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-col gap-4">
                      <div className="rounded-[1.2rem] border border-border/70 bg-card/88 p-4">
                        <p className="text-xs uppercase tracking-wide text-muted-foreground">
                          {t('settings.auth.status')}
                        </p>
                        <p className="mt-2 text-base font-semibold">
                          {authSettings?.enabled
                            ? t('settings.auth.statusEnabled')
                            : t('settings.auth.statusDisabled')}
                        </p>
                        {authSettings?.username && (
                          <div className="mt-3 rounded-xl bg-primary/10 px-3 py-2 text-xs font-medium text-primary">
                            {t('settings.auth.username')}: {authSettings.username}
                          </div>
                        )}
                      </div>

                      <div className="rounded-[1.2rem] border border-border/70 bg-background/55 p-4 text-xs text-muted-foreground">
                        {t(needsPassword ? 'settings.auth.passwordHintRequired' : 'settings.auth.passwordHintOptional')}
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center justify-end gap-3">
                    <Button onClick={() => void handleAuthSave()} disabled={savingAuth || !isAuthDirty}>
                      {savingAuth ? t('common.actions.saving') : t('settings.auth.actions.save')}
                    </Button>
                    <Button variant="outline" onClick={handleAuthReset} disabled={savingAuth || !isAuthDirty}>
                      {t('common.actions.reset')}
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Config File */}
          <Card id="section-config-file" ref={setSectionRef('section-config-file')}>
            <CardContent className="pt-6 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold">{t('settings.sections.configFile')}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{t('settings.file.description')}</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => void handleCopyPath()}>
                  <Copy className="mr-2 h-4 w-4" />
                  {t('common.actions.copy')}
                </Button>
              </div>
              <code className="block break-all rounded-[1.2rem] border border-border/70 bg-background/70 px-4 py-3 text-xs">
                {configPath || t('settings.file.unknown')}
              </code>
            </CardContent>
          </Card>

          {/* Cleanup */}
          <Card id="section-cleanup" ref={setSectionRef('section-cleanup')}>
            <CardContent className="pt-6 space-y-4">
              <div>
                <h3 className="text-sm font-semibold">{t('settings.sections.cleanup')}</h3>
                <p className="mt-1 text-xs text-muted-foreground">{t('settings.cleanup.description')}</p>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="rounded-2xl border border-amber-300/70 bg-amber-50/70 p-4 dark:border-amber-700/70 dark:bg-amber-950/20">
                  <div className="space-y-2">
                    <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300">
                      {t('settings.cleanup.softLabel')}
                    </Badge>
                    <p className="text-sm font-medium">{t('settings.cleanup.softTitle')}</p>
                    <p className="text-xs text-muted-foreground">{t('settings.cleanup.softDescription')}</p>
                    <Button
                      variant="outline"
                      onClick={() => setConfirmCleanupOpen(true)}
                      disabled={cleaning}
                      className="border-amber-500/40 text-amber-700 hover:bg-amber-500/10 dark:text-amber-300"
                    >
                      {cleaning ? t('common.actions.cleaning') : t('common.actions.cleanup')}
                    </Button>
                  </div>
                </div>
                <div className="rounded-[1.3rem] border border-destructive/40 bg-destructive/5 p-4">
                  <div className="space-y-2">
                    <Badge variant="outline" className="border-destructive/40 bg-destructive/10 text-destructive">
                      {t('settings.cleanup.hardLabel')}
                    </Badge>
                    <p className="text-sm font-medium">{t('settings.cleanup.hardTitle')}</p>
                    <p className="text-xs text-muted-foreground">{t('settings.cleanup.clearAllWarning')}</p>
                    <Button
                      variant="destructive"
                      onClick={() => setConfirmClearAllOpen(true)}
                      disabled={clearingAll}
                    >
                      {clearingAll ? t('settings.cleanup.clearingAll') : t('settings.cleanup.clearAll')}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
          </div>

          {(isConfigDirty || isAuthDirty) && (
            <div className="sticky bottom-4 z-20 flex flex-col gap-3 rounded-[1.35rem] border border-primary/20 bg-background/95 p-4 shadow-[0_24px_64px_-28px_rgba(15,23,42,0.35)] backdrop-blur md:flex-row md:items-center md:justify-between">
              <div className="space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{t('modelManagement.actions.unsaved')}</Badge>
                  {isConfigDirty && <Badge variant="outline">{t('settings.sections.basics')}</Badge>}
                  {isAuthDirty && <Badge variant="outline">{t('settings.sections.security')}</Badge>}
                </div>
                <p className="text-sm text-muted-foreground">{t('modelManagement.actions.footerDirtyHint')}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {isAuthDirty && (
                  <>
                    <Button variant="outline" onClick={handleAuthReset} disabled={savingAuth}>
                      {t('common.actions.reset')}
                    </Button>
                    <Button onClick={() => void handleAuthSave()} disabled={savingAuth}>
                      {savingAuth ? t('common.actions.saving') : t('settings.auth.actions.save')}
                    </Button>
                  </>
                )}
                {isConfigDirty && (
                  <>
                    <Button variant="outline" onClick={handleReset} disabled={saving}>
                      {t('common.actions.reset')}
                    </Button>
                    <Button onClick={() => void handleSave()} disabled={saving}>
                      {saving ? t('common.actions.saving') : t('common.actions.save')}
                    </Button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      <ConfirmDialog
        open={confirmCleanupOpen}
        onOpenChange={(open) => {
          if (!open && !cleaning) {
            setConfirmCleanupOpen(false)
          }
        }}
        title={t('settings.cleanup.softTitle')}
        description={t('settings.cleanup.confirmCleanup')}
        confirmLabel={cleaning ? t('common.actions.loading') : t('common.actions.cleanup')}
        cancelLabel={t('common.actions.cancel')}
        loading={cleaning}
        confirmVariant="default"
        onConfirm={async () => {
          await handleCleanupLogs()
          setConfirmCleanupOpen(false)
        }}
      />

      <ConfirmDialog
        open={confirmClearAllOpen}
        onOpenChange={(open) => {
          if (!open && !clearingAll) {
            setConfirmClearAllOpen(false)
          }
        }}
        title={t('settings.cleanup.clearAll')}
        description={t('settings.cleanup.confirmClearAll')}
        confirmLabel={clearingAll ? t('common.actions.loading') : t('settings.cleanup.clearAll')}
        cancelLabel={t('common.actions.cancel')}
        loading={clearingAll}
        onConfirm={async () => {
          await handleClearAllLogs()
          setConfirmClearAllOpen(false)
        }}
      />
    </div>
  )
}

function OverviewCard({
  label,
  value,
  helper,
  mono = false
}: {
  label: string
  value: string
  helper: string
  mono?: boolean
}) {
  return (
    <div className="rounded-[1.2rem] border border-border/70 bg-background/60 p-4">
      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        {label}
      </p>
      <p className={cn('mt-2 text-sm font-semibold text-foreground', mono && 'break-all font-mono text-xs')}>
        {value}
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        {helper}
      </p>
    </div>
  )
}
