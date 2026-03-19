import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/providers/ToastProvider'
import { toApiError } from '@/services/api'
import { logsApi } from '@/services/logs'

interface UseLogExportOptions {
  exportTimeoutMs: number
  queryParams: Record<string, unknown>
  total: number
}

export function useLogExport({
  exportTimeoutMs,
  queryParams,
  total
}: UseLogExportOptions) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [exporting, setExporting] = useState(false)

  const handleExport = useCallback(async () => {
    if (exporting) return

    setExporting(true)
    try {
      const exportLimit = total > 0 ? Math.min(total, 5000) : 1000
      const payload: Record<string, unknown> = { ...queryParams, limit: exportLimit, offset: 0 }
      const blob = await logsApi.exportArchive(payload, exportTimeoutMs)
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = `cc-gw-logs-${timestamp}.zip`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)

      pushToast({
        title: t('logs.toast.exportSuccess.title'),
        description: t('logs.toast.exportSuccess.desc'),
        variant: 'success'
      })
    } catch (error) {
      const apiError = toApiError(error)
      pushToast({
        title: t('logs.toast.exportError.title'),
        description: t('logs.toast.exportError.desc', { message: apiError.message }),
        variant: 'error'
      })
    } finally {
      setExporting(false)
    }
  }, [exportTimeoutMs, exporting, pushToast, queryParams, t, total])

  return {
    exporting,
    handleExport
  }
}
