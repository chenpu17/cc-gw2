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
      staleTime: 30_000
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

  const record = logDetailQuery.data
  const providerLabel = record ? providerLabelMap.get(record.provider) ?? record.provider : ''
  const apiKeyMeta = record && record.api_key_id != null ? apiKeyMap.get(record.api_key_id) : undefined
  const statusCode = record ? record.status_code ?? (record.error ? 500 : 200) : null

  return {
    apiKeyMeta,
    errorMessage: logDetailQuery.isError ? logDetailQuery.error?.message ?? null : null,
    handleCopy,
    isError: logDetailQuery.isError,
    isPending: logDetailQuery.isPending,
    providerLabel,
    refetch: logDetailQuery.refetch,
    record,
    statusCode
  }
}
