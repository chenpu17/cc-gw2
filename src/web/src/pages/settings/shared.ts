import type {
  BillingConfig,
  GatewayConfig,
  ModelPriceOverride,
  WebAuthStatusResponse
} from '@/types/providers'

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

/** One editable price-override row (string fields — validated on save). */
export interface BillingOverrideRow {
  key: string
  currency: string
  input: string
  output: string
  cacheRead: string
  cacheCreation: string
  label: string
}

export interface BillingFormState {
  displayCurrency: 'CNY' | 'USD'
  /** Single UI input: 1 USD = X CNY (serialized into rates for either direction). */
  usdCnyRate: string
  overrides: BillingOverrideRow[]
}

export interface BillingFormErrors {
  usdCnyRate?: string
  /** Error per override row, indexed like `overrides`. */
  overrides?: Array<{ key?: string; prices?: string } | undefined>
}

export const DEFAULT_USD_CNY_RATE = '7.2'

function emptyOverrideRow(): BillingOverrideRow {
  return {
    key: '',
    currency: 'CNY',
    input: '',
    output: '',
    cacheRead: '',
    cacheCreation: '',
    label: ''
  }
}

export function deriveBillingFormState(config: GatewayConfig): BillingFormState {
  const billing = config.billing
  const displayCurrency: 'CNY' | 'USD' = billing?.displayCurrency === 'USD' ? 'USD' : 'CNY'
  const rates = billing?.rates ?? {}
  // Recover the single "1 USD = X CNY" input from whichever direction the
  // config stores it; fall back to the builtin default.
  let usdCnyRate = DEFAULT_USD_CNY_RATE
  if (displayCurrency === 'CNY' && typeof rates.USD === 'number' && rates.USD > 0) {
    usdCnyRate = String(rates.USD)
  } else if (displayCurrency === 'USD' && typeof rates.CNY === 'number' && rates.CNY > 0) {
    usdCnyRate = String(1 / rates.CNY)
  }

  const overrides: BillingOverrideRow[] = Object.entries(billing?.modelPrices ?? {}).map(
    ([key, price]) => ({
      key,
      currency: price.currency?.toUpperCase() === 'USD' ? 'USD' : 'CNY',
      input: String(price.input ?? 0),
      output: String(price.output ?? 0),
      cacheRead: String(price.cacheRead ?? 0),
      cacheCreation: String(price.cacheCreation ?? 0),
      label: price.label ?? ''
    })
  )

  return { displayCurrency, usdCnyRate, overrides: overrides.length > 0 ? overrides : [emptyOverrideRow()] }
}

/** Rows with a key or any price entered count as content; fully-blank rows are
 * dropped on save instead of erroring. */
export function billingOverrideRowHasContent(row: BillingOverrideRow): boolean {
  return Boolean(
    row.key.trim() ||
      row.input.trim() ||
      row.output.trim() ||
      row.cacheRead.trim() ||
      row.cacheCreation.trim() ||
      row.label.trim()
  )
}

/** Assemble `billing` for the save payload from the form. */
export function serializeBillingForm(form: BillingFormState): BillingConfig | undefined {
  const rate = Number(form.usdCnyRate)
  const rates: Record<string, number> =
    form.displayCurrency === 'CNY'
      ? { USD: Number.isFinite(rate) && rate > 0 ? rate : Number(DEFAULT_USD_CNY_RATE) }
      : { CNY: Number.isFinite(rate) && rate > 0 ? 1 / rate : 1 / Number(DEFAULT_USD_CNY_RATE) }

  const modelPrices: Record<string, ModelPriceOverride> = {}
  for (const row of form.overrides) {
    if (!billingOverrideRowHasContent(row)) continue
    const key = row.key.trim()
    if (!key) continue
    modelPrices[key] = {
      currency: row.currency,
      input: Number(row.input) || 0,
      output: Number(row.output) || 0,
      cacheRead: Number(row.cacheRead) || 0,
      cacheCreation: Number(row.cacheCreation) || 0,
      ...(row.label.trim() ? { label: row.label.trim() } : {})
    }
  }

  return {
    displayCurrency: form.displayCurrency,
    rates,
    ...(Object.keys(modelPrices).length > 0 ? { modelPrices } : {})
  }
}

export const SETTINGS_SECTIONS = [
  { id: 'section-basics', labelKey: 'settings.sections.basics' },
  { id: 'section-protocol', labelKey: 'settings.sections.protocol' },
  { id: 'section-security', labelKey: 'settings.sections.security' },
  { id: 'section-billing', labelKey: 'settings.sections.billing' },
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
