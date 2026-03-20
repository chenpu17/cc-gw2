import type { GatewayConfig, WebAuthStatusResponse } from '@/types/providers'

export type LogLevel = NonNullable<GatewayConfig['logLevel']>

export const LOG_LEVEL_OPTIONS: Array<{ value: LogLevel; labelKey: string }> = [
  { value: 'fatal', labelKey: 'fatal' },
  { value: 'error', labelKey: 'error' },
  { value: 'warn', labelKey: 'warn' },
  { value: 'info', labelKey: 'info' },
  { value: 'debug', labelKey: 'debug' },
  { value: 'trace', labelKey: 'trace' }
]

export interface FormState {
  port: string
  host: string
  logRetentionDays: string
  logExportTimeoutSeconds: string
  storeRequestPayloads: boolean
  storeResponsePayloads: boolean
  logLevel: LogLevel
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

export interface FormErrors {
  port?: string
  logRetentionDays?: string
  logExportTimeoutSeconds?: string
  bodyLimitMb?: string
  httpPort?: string
  httpsPort?: string
  protocol?: string
}

export interface AuthFormState {
  enabled: boolean
  username: string
  password: string
  confirmPassword: string
}

export interface AuthFormErrors {
  username?: string
  password?: string
  confirmPassword?: string
}

export const SETTINGS_SECTIONS = [
  { id: 'section-basics', labelKey: 'settings.sections.basics' },
  { id: 'section-protocol', labelKey: 'settings.sections.protocol' },
  { id: 'section-security', labelKey: 'settings.sections.security' },
  { id: 'section-config-file', labelKey: 'settings.sections.configFile' },
  { id: 'section-cleanup', labelKey: 'settings.sections.cleanup' }
] as const

export function deriveFormState(config: GatewayConfig): FormState {
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

export function deriveAuthFormState(auth: WebAuthStatusResponse): AuthFormState {
  return {
    enabled: auth.enabled,
    username: auth.username ?? '',
    password: '',
    confirmPassword: ''
  }
}
