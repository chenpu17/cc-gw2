import type { AxiosRequestConfig } from 'axios'

/** One row of the merged builtin + override price table (`/api/billing/prices`). */
export interface BillingPriceEntry {
  /** Builtin: canonical model id; override: raw key (`model-id` | `providerId:modelId`). */
  key: string
  source: 'builtin' | 'override'
  /** Present when the override key is `providerId:modelId`. */
  scopedProvider?: string | null
  currency: string
  /** Per 1M tokens, native currency. */
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
  label?: string | null
}

export interface BillingPricesResponse {
  displayCurrency: string
  entries: BillingPriceEntry[]
}

export const billingApi = {
  pricesRequest(): AxiosRequestConfig {
    return {
      url: '/api/billing/prices',
      method: 'GET' as const
    }
  }
}
