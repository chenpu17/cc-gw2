import { useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { LogDetail } from '@/types/logs'
import { copyToClipboard } from '@/utils/clipboard'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import { logsApi } from '@/services/logs'
import { queryKeys } from '@/services/queryKeys'
import type { ApiError } from '@/services/api'
import { getLogErrorSourceMeta, getLogStatusMeta } from './utils'

interface UseLogDetailStateOptions {
  apiKeyMap: Map<number, ApiKeySummary>
  logId: number | null
  open: boolean
  providerLabelMap: Map<string, string>
}

export function useLogDetailState({
  apiKeyMap,
  logId,
  open,
  providerLabelMap
}: UseLogDetailStateOptions) {
  const { t } = useTranslation()
  const { pushToast } = useToast()

  const logDetailQuery = useApiQuery<LogDetail, ApiError>(
    queryKeys.logs.detail(logId),
    logsApi.detailRequest(logId),
    {
      enabled: open && logId !== null,
      staleTime: 30_000,
      gcTime: 15_000,
      placeholderData: undefined
    }
  )

  useEffect(() => {
    if (!logDetailQuery.isError || !logDetailQuery.error) return

    pushToast({
      title: t('logs.detail.loadError'),
      description: logDetailQuery.error.message,
      variant: 'error'
    })
  }, [logDetailQuery.error, logDetailQuery.isError, pushToast, t])

  const handleCopy = useCallback(
    async (label: string, content: string | null | undefined, successKey: string) => {
      if (!content) {
        pushToast({ title: t('logs.detail.copy.empty', { label }), variant: 'info' })
        return
      }

      try {
        await copyToClipboard(content)
        pushToast({ title: t(successKey), variant: 'success' })
      } catch (error) {
        pushToast({
          title: t('logs.detail.copy.failure'),
          description: error instanceof Error ? error.message : t('logs.detail.copy.failureFallback'),
          variant: 'error'
        })
      }
    },
    [pushToast, t]
  )

  const handleDownloadPayload = useCallback(
    (label: string, content: string | null | undefined) => {
      if (!content) {
        pushToast({ title: t('logs.detail.copy.empty', { label }), variant: 'info' })
        return
      }

      const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const safeLabel = label
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, '-')
        .replace(/^-+|-+$/g, '') || 'payload'

      anchor.href = url
      anchor.download = `cc-gw-log-${logId ?? 'payload'}-${safeLabel}-${timestamp}.json`
      document.body.appendChild(anchor)
      anchor.click()
      document.body.removeChild(anchor)
      URL.revokeObjectURL(url)
    },
    [logId, pushToast, t]
  )

  const record = logDetailQuery.data
  const providerLabel = record ? providerLabelMap.get(record.provider) ?? record.provider : ''
  const apiKeyMeta = record && record.api_key_id != null ? apiKeyMap.get(record.api_key_id) : undefined
  const errorSourceMeta = record ? getLogErrorSourceMeta(record, t) : null
  const statusMeta = record ? getLogStatusMeta(record, t) : null

  return {
    apiKeyMeta,
    errorSourceMeta,
    errorMessage: logDetailQuery.isError ? logDetailQuery.error?.message ?? null : null,
    handleCopy,
    handleDownloadPayload,
    isError: logDetailQuery.isError,
    isPending: logDetailQuery.isPending,
    providerLabel,
    refetch: logDetailQuery.refetch,
    record,
    statusMeta
  }
}
