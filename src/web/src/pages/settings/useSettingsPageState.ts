import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAppMutation } from '@/hooks/useAppMutation'
import { useToast } from '@/providers/ToastProvider'
import { gatewayApi } from '@/services/gateway'
import { settingsApi } from '@/services/settings'
import { copyToClipboard } from '@/utils/clipboard'
import { type ApiError } from '@/services/api'
import { queryKeys } from '@/services/queryKeys'
import type { ConfigInfoResponse, GatewayConfig, WebAuthStatusResponse } from '@/types/providers'
import {
  deriveAuthFormState,
  deriveFormState,
  SETTINGS_SECTIONS,
  type AuthFormErrors,
  type AuthFormState,
  type FormErrors,
  type FormState,
  type LogLevel
} from './shared'

export function useSettingsPageState() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [activeSection, setActiveSection] = useState<string>(SETTINGS_SECTIONS[0].id)
  const sectionRefs = useRef<Map<string, HTMLElement>>(new Map())

  const handleSectionClick = useCallback((id: string) => {
    const element = sectionRefs.current.get(id)
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [])

  const setSectionRef = useCallback(
    (id: string) => (element: HTMLElement | null) => {
      if (element) {
        sectionRefs.current.set(id, element)
      } else {
        sectionRefs.current.delete(id)
      }
    },
    []
  )

  const configQuery = useApiQuery<ConfigInfoResponse, ApiError>(
    queryKeys.config.info(),
    gatewayApi.configInfoRequest()
  )
  const authQuery = useApiQuery<WebAuthStatusResponse, ApiError>(
    queryKeys.auth.web(),
    settingsApi.authStatusRequest()
  )

  const saveAuthMutation = useAppMutation<
    { auth?: WebAuthStatusResponse },
    { enabled: boolean; username?: string; password?: string }
  >({
    mutationFn: settingsApi.saveWebAuth,
    successToast: () => ({ title: t('settings.auth.toast.success') }),
    errorToast: (error) => ({ title: t('settings.auth.toast.failure', { message: error.message }) }),
    invalidateKeys: [queryKeys.auth.web()]
  })

  const cleanupLogsMutation = useAppMutation({
    mutationFn: settingsApi.cleanupLogs,
    successToast: (data) => ({
      title:
        data.deleted > 0
          ? t('settings.toast.cleanupSuccess', { count: data.deleted })
          : t('settings.toast.cleanupNone')
    }),
    errorToast: (error) => ({
      title: t('settings.toast.cleanupFailure', { message: error.message })
    })
  })

  const clearLogsMutation = useAppMutation({
    mutationFn: settingsApi.clearLogs,
    successToast: (data) => ({
      title: t('settings.toast.clearAllSuccess', {
        logs: data.deleted,
        metrics: data.metricsCleared
      })
    }),
    errorToast: (error) => ({
      title: t('settings.toast.clearAllFailure', { message: error.message })
    })
  })

  const [config, setConfig] = useState<GatewayConfig | null>(null)
  const [configPath, setConfigPath] = useState('')
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
    if (!config?.defaults) return null

    const mappings: string[] = []
    if (config.defaults.completion) mappings.push(t('settings.defaults.completion', { model: config.defaults.completion }))
    if (config.defaults.reasoning) mappings.push(t('settings.defaults.reasoning', { model: config.defaults.reasoning }))
    if (config.defaults.background) mappings.push(t('settings.defaults.background', { model: config.defaults.background }))
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
    return authForm.username.trim() !== (authSettings.username ?? '')
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
  const protocolChangesPending = useMemo(() => {
    if (!initialForm) return false

    const protocolFields: Array<keyof FormState> = [
      'httpEnabled',
      'httpPort',
      'httpHost',
      'httpsEnabled',
      'httpsPort',
      'httpsHost',
      'httpsKeyPath',
      'httpsCertPath',
      'httpsCaPath',
      'port',
      'host'
    ]

    return protocolFields.some((field) => form[field] !== initialForm[field])
  }, [form, initialForm])

  useEffect(() => {
    if (!configQuery.data) return
    setConfig(configQuery.data.config)
    setConfigPath(configQuery.data.path)
    setForm(deriveFormState(configQuery.data.config))
  }, [configQuery.data])

  useEffect(() => {
    if (!authQuery.data) return
    setAuthSettings(authQuery.data)
    setAuthForm(deriveAuthFormState(authQuery.data))
    setAuthErrors({})
  }, [authQuery.data])

  useEffect(() => {
    if (!configQuery.isError || !configQuery.error) return
    pushToast({
      title: t('settings.toast.loadFailure', { message: configQuery.error.message }),
      variant: 'error'
    })
  }, [configQuery.error, configQuery.isError, pushToast, t])

  useEffect(() => {
    if (!authQuery.isError || !authQuery.error) return
    pushToast({
      title: t('settings.toast.authLoadFailure', { message: authQuery.error.message }),
      variant: 'error'
    })
  }, [authQuery.error, authQuery.isError, pushToast, t])

  const handleInputChange = useCallback(
    (field: 'port' | 'host' | 'logRetentionDays' | 'logExportTimeoutSeconds' | 'bodyLimitMb') =>
      (value: string) => {
        setForm((previous) => ({ ...previous, [field]: value }))
      },
    []
  )

  const validate = useCallback((): boolean => {
    const nextErrors: FormErrors = {}

    if (!form.httpEnabled && !form.httpsEnabled) {
      nextErrors.protocol = t('settings.validation.protocolRequired')
    }

    if (form.httpEnabled) {
      const httpPortValue = Number(form.httpPort)
      if (!Number.isFinite(httpPortValue) || httpPortValue < 1 || httpPortValue > 65535) {
        nextErrors.httpPort = t('settings.validation.httpPort')
      }
    }

    if (form.httpsEnabled) {
      const httpsPortValue = Number(form.httpsPort)
      if (!Number.isFinite(httpsPortValue) || httpsPortValue < 1 || httpsPortValue > 65535) {
        nextErrors.httpsPort = t('settings.validation.httpsPort')
      }

      if (!form.httpsKeyPath || !form.httpsCertPath) {
        nextErrors.protocol = t('settings.validation.httpsCertificate')
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
  }, [form, t])

  const validateAuth = useCallback((): boolean => {
    const nextErrors: AuthFormErrors = {}
    const usernameValue = authForm.username.trim()
    const usernameChanged = authSettings ? usernameValue !== (authSettings.username ?? '') : true
    const nextNeedsPassword = authForm.enabled && (!authSettings?.hasPassword || usernameChanged)

    if (authForm.enabled && !usernameValue) {
      nextErrors.username = t('settings.auth.validation.username')
    }
    if (authForm.password && authForm.password.length < 6) {
      nextErrors.password = t('settings.auth.validation.minLength')
    }
    if (nextNeedsPassword && !authForm.password) {
      nextErrors.password = t('settings.auth.validation.passwordRequired')
    }
    if (authForm.password || authForm.confirmPassword) {
      if (authForm.password !== authForm.confirmPassword) {
        nextErrors.confirmPassword = t('settings.auth.validation.confirmMismatch')
      }
    }

    setAuthErrors(nextErrors)
    return Object.keys(nextErrors).length === 0
  }, [authForm, authSettings, t])

  const handleSave = useCallback(async () => {
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
      await gatewayApi.saveConfig(payload)
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

      pushToast({
        title: protocolChanged ? t('settings.toast.protocolRestartRequired') : t('settings.toast.saveSuccess'),
        variant: 'success'
      })
      void configQuery.refetch()
    } catch (error) {
      pushToast({
        title: t('settings.toast.saveFailure', { message: error instanceof Error ? error.message : 'unknown' }),
        variant: 'error'
      })
    } finally {
      setSaving(false)
    }
  }, [config, configQuery, form, pushToast, t, validate])

  const handleReset = useCallback(() => {
    if (!config) return
    setForm(deriveFormState(config))
    setErrors({})
  }, [config])

  const handleAuthSave = useCallback(async () => {
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
      const response = await saveAuthMutation.mutateAsync(payload)
      if (response.auth) {
        setAuthSettings(response.auth)
        setAuthForm({
          enabled: response.auth.enabled,
          username: response.auth.username ?? '',
          password: '',
          confirmPassword: ''
        })
        setAuthErrors({})
      }
      void authQuery.refetch()
    } catch {
    } finally {
      setSavingAuth(false)
    }
  }, [authForm, authQuery, saveAuthMutation, validateAuth])

  const handleAuthReset = useCallback(() => {
    if (!authSettings) return
    setAuthForm(deriveAuthFormState(authSettings))
    setAuthErrors({})
  }, [authSettings])

  const handleCopyPath = useCallback(async () => {
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
  }, [configPath, pushToast, t])

  const handleCleanupLogs = useCallback(async () => {
    setCleaning(true)
    try {
      await cleanupLogsMutation.mutateAsync()
    } catch {
    } finally {
      setCleaning(false)
    }
  }, [cleanupLogsMutation])

  const handleClearAllLogs = useCallback(async () => {
    setClearingAll(true)
    try {
      await clearLogsMutation.mutateAsync()
    } catch {
    } finally {
      setClearingAll(false)
    }
  }, [clearLogsMutation])

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

    for (const element of elements) {
      observer.observe(element)
    }

    return () => observer.disconnect()
  }, [isLoading])

  return {
    activeSection,
    authErrors,
    authForm,
    authQuery,
    authSettings,
    clearingAll,
    cleaning,
    config,
    configPath,
    configQuery,
    confirmCleanupOpen,
    confirmClearAllOpen,
    defaultsSummary,
    errors,
    form,
    handleAuthReset,
    handleAuthSave,
    handleCleanupLogs,
    handleClearAllLogs,
    handleCopyPath,
    handleInputChange,
    handleReset,
    handleSave,
    handleSectionClick,
    isAuthDirty,
    isConfigDirty,
    isLoading,
    needsPassword,
    protocolSummaryLabel,
    protocolChangesPending,
    saving,
    savingAuth,
    sectionRefs,
    setAuthForm,
    setConfirmCleanupOpen,
    setConfirmClearAllOpen,
    setErrors,
    setForm,
    setSectionRef,
    t
  }
}
