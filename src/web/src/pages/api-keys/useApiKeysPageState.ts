import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type EChartOption } from '@/components/EChart'
import { useApiQuery } from '@/hooks/useApiQuery'
import { useAppMutation } from '@/hooks/useAppMutation'
import { usePersistentState } from '@/hooks/usePersistentState'
import { useToast } from '@/providers/ToastProvider'
import { type ApiError } from '@/services/api'
import { apiKeysApi } from '@/services/apiKeys'
import { queryKeys } from '@/services/queryKeys'
import { storageKeys } from '@/services/storageKeys'
import type {
  ApiKeyOverviewStats,
  ApiKeySummary,
  ApiKeyUsageMetric,
  NewApiKeyResponse
} from '@/types/apiKeys'
import { copyToClipboard } from '@/utils/clipboard'
import { RANGE_OPTIONS, useAvailableEndpoints } from './shared'

export function useApiKeysPageState() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKeyDescription, setNewKeyDescription] = useState('')
  const [newKeyEndpoints, setNewKeyEndpoints] = useState<string[]>([])
  const [newKeyMaxConcurrency, setNewKeyMaxConcurrency] = useState<string>('')
  const [newlyCreatedKey, setNewlyCreatedKey] = useState<NewApiKeyResponse | null>(null)
  const [isDeleting, setIsDeleting] = useState<number | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ApiKeySummary | null>(null)
  const [rangeDays, setRangeDays] = usePersistentState<number>(
    storageKeys.apiKeys.rangeDays,
    7,
    {
      serialize: (value) => String(value),
      deserialize: (raw) => {
        const next = Number(raw)
        return RANGE_OPTIONS.some((option) => option.value === next) ? next : 7
      }
    }
  )
  const [revealedKeys, setRevealedKeys] = useState<Map<number, string>>(new Map())
  const [isRevealing, setIsRevealing] = useState<number | null>(null)
  const [editEndpointsKey, setEditEndpointsKey] = useState<ApiKeySummary | null>(null)
  const [editEndpointsSelection, setEditEndpointsSelection] = useState<string[]>([])
  const [editMaxConcurrency, setEditMaxConcurrency] = useState('')
  const [search, setSearch] = usePersistentState<string>(storageKeys.apiKeys.search, '')
  const [statusFilter, setStatusFilter] = usePersistentState<'all' | 'enabled' | 'disabled'>(
    storageKeys.apiKeys.statusFilter,
    'all',
    {
      serialize: (value) => value,
      deserialize: (raw) => (raw === 'enabled' || raw === 'disabled' ? raw : 'all')
    }
  )

  const availableEndpoints = useAvailableEndpoints()

  const keysQuery = useApiQuery<ApiKeySummary[], ApiError>(
    queryKeys.apiKeys.all(),
    apiKeysApi.listRequest()
  )
  const overviewQuery = useApiQuery<ApiKeyOverviewStats, ApiError>(
    queryKeys.apiKeys.overview(rangeDays),
    apiKeysApi.overviewRequest(rangeDays)
  )
  const usageQuery = useApiQuery<ApiKeyUsageMetric[], ApiError>(
    queryKeys.apiKeys.usage(rangeDays),
    apiKeysApi.usageRequest(rangeDays)
  )

  const createKeyMutation = useAppMutation<
    NewApiKeyResponse,
    { name: string; description?: string; allowedEndpoints?: string[]; maxConcurrency?: number | null }
  >({
    mutationFn: apiKeysApi.create,
    invalidateKeys: [
      queryKeys.apiKeys.all(),
      queryKeys.apiKeys.overview(rangeDays),
      queryKeys.apiKeys.usage(rangeDays)
    ],
    successToast: () => ({ title: t('apiKeys.toast.keyCreated') }),
    errorToast: (error) => ({ title: t('apiKeys.toast.createFailure', { message: error.message }) })
  })

  const updateKeyMutation = useAppMutation<void, { id: number; enabled?: boolean; allowedEndpoints?: string[] | null; maxConcurrency?: number | null }>({
    mutationFn: ({ id, ...payload }) => apiKeysApi.update(id, payload),
    invalidateKeys: [
      queryKeys.apiKeys.all(),
      queryKeys.apiKeys.overview(rangeDays),
      queryKeys.apiKeys.usage(rangeDays)
    ],
    successToast: () => ({ title: t('apiKeys.toast.keyUpdated') }),
    errorToast: (error) => ({ title: t('apiKeys.toast.updateFailure', { message: error.message }) })
  })

  const deleteKeyMutation = useAppMutation<void, { id: number }>({
    mutationFn: ({ id }) => apiKeysApi.delete(id),
    invalidateKeys: [
      queryKeys.apiKeys.all(),
      queryKeys.apiKeys.overview(rangeDays),
      queryKeys.apiKeys.usage(rangeDays)
    ],
    successToast: () => ({ title: t('apiKeys.toast.keyDeleted') }),
    errorToast: (error) => ({ title: t('apiKeys.toast.deleteFailure', { message: error.message }) })
  })

  const revealKeyMutation = useAppMutation<{ key: string }, { id: number }>({
    mutationFn: ({ id }) => apiKeysApi.reveal(id),
    errorToast: (error) => ({
      title: t('apiKeys.toast.revealFailure'),
      description: error.message
    })
  })

  const keys = keysQuery.data ?? []
  const overview = overviewQuery.data
  const usage = usageQuery.data ?? []
  const hasWildcard = keys.some((item) => item.isWildcard)
  const wildcardCount = keys.filter((item) => item.isWildcard).length
  const restrictedCount = keys.filter(
    (item) => !item.isWildcard && (item.allowedEndpoints?.length ?? 0) > 0
  ).length
  const unrestrictedCount = keys.filter(
    (item) => !item.isWildcard && ((item.allowedEndpoints?.length ?? 0) === 0)
  ).length
  const totalKeysValue = overview ? overview.totalKeys.toLocaleString() : '-'
  const enabledKeysValue = overview ? overview.enabledKeys.toLocaleString() : '-'
  const activeKeysValue = overview ? overview.activeKeys.toLocaleString() : '-'

  const filteredKeys = useMemo(() => {
    return keys.filter((key) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' ? key.enabled : !key.enabled)
      if (!matchesStatus) return false

      const keyword = search.trim().toLowerCase()
      if (!keyword) return true

      return [
        key.name,
        key.description ?? '',
        key.maskedKey ?? '',
        ...(key.allowedEndpoints ?? [])
      ]
        .join(' ')
        .toLowerCase()
        .includes(keyword)
    })
  }, [keys, search, statusFilter])

  const requestsChartOption = useMemo<EChartOption>(() => {
    const categories = usage.map((item) => item.apiKeyName ?? t('apiKeys.analytics.unknownKey'))
    return {
      tooltip: { trigger: 'axis' },
      grid: { left: 60, right: 20, top: 40, bottom: 40 },
      xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: 'value' },
      series: [
        {
          name: t('apiKeys.analytics.requestsSeries'),
          type: 'bar',
          data: usage.map((item) => item.requests),
          itemStyle: { color: 'hsl(var(--primary))' }
        }
      ]
    }
  }, [t, usage])

  const tokensChartOption = useMemo<EChartOption>(() => {
    const categories = usage.map((item) => item.apiKeyName ?? t('apiKeys.analytics.unknownKey'))
    return {
      tooltip: { trigger: 'axis' },
      legend: {
        data: [t('apiKeys.analytics.tokens.input'), t('apiKeys.analytics.tokens.output')]
      },
      grid: { left: 60, right: 20, top: 50, bottom: 40 },
      xAxis: { type: 'category', data: categories, axisLabel: { interval: 0, rotate: 20 } },
      yAxis: { type: 'value' },
      series: [
        {
          name: t('apiKeys.analytics.tokens.input'),
          type: 'bar',
          stack: 'tokens',
          itemStyle: { color: '#22c55e' },
          data: usage.map((item) => item.inputTokens)
        },
        {
          name: t('apiKeys.analytics.tokens.output'),
          type: 'bar',
          stack: 'tokens',
          itemStyle: { color: '#0ea5e9' },
          data: usage.map((item) => item.outputTokens)
        }
      ]
    }
  }, [t, usage])

  const resetCreateForm = useCallback(() => {
    setNewKeyName('')
    setNewKeyDescription('')
    setNewKeyEndpoints([])
    setNewKeyMaxConcurrency('')
  }, [])

  const handleCreateDialogChange = useCallback((open: boolean) => {
    setIsCreateDialogOpen(open)
    if (!open) {
      resetCreateForm()
    }
  }, [resetCreateForm])

  const handleCreateKey = useCallback(async () => {
    if (!newKeyName.trim()) {
      pushToast({ title: t('apiKeys.errors.nameRequired'), variant: 'error' })
      return
    }

    try {
      const response = await createKeyMutation.mutateAsync({
        name: newKeyName.trim(),
        description: newKeyDescription.trim() || undefined,
        allowedEndpoints: newKeyEndpoints.length > 0 ? newKeyEndpoints : undefined,
        maxConcurrency: newKeyMaxConcurrency ? Number(newKeyMaxConcurrency) : null
      })
      setNewlyCreatedKey(response)
      handleCreateDialogChange(false)
    } catch {
    }
  }, [createKeyMutation, handleCreateDialogChange, newKeyDescription, newKeyEndpoints, newKeyMaxConcurrency, newKeyName, pushToast, t])

  const handleToggleEnabled = useCallback(async (id: number, enabled: boolean) => {
    try {
      await updateKeyMutation.mutateAsync({ id, enabled: !enabled })
    } catch {
    }
  }, [updateKeyMutation])

  const handleDeleteKey = useCallback(async () => {
    if (!deleteTarget) return

    setIsDeleting(deleteTarget.id)
    try {
      await deleteKeyMutation.mutateAsync({ id: deleteTarget.id })
      setDeleteTarget(null)
    } catch {
    } finally {
      setIsDeleting(null)
    }
  }, [deleteTarget, deleteKeyMutation])

  const handleRevealKey = useCallback(async (id: number) => {
    if (revealedKeys.has(id)) {
      return
    }

    setIsRevealing(id)
    try {
      const response = await revealKeyMutation.mutateAsync({ id })
      setRevealedKeys((previous) => new Map(previous).set(id, response.key))
    } catch {
    } finally {
      setIsRevealing(null)
    }
  }, [revealKeyMutation, revealedKeys])

  const handleHideKey = useCallback((id: number) => {
    setRevealedKeys((previous) => {
      const next = new Map(previous)
      next.delete(id)
      return next
    })
  }, [])

  const handleCopyKey = useCallback(async (key: string) => {
    try {
      await copyToClipboard(key)
      pushToast({ title: t('apiKeys.toast.keyCopied'), variant: 'success' })
    } catch (error) {
      pushToast({
        title: t('apiKeys.toast.copyFailure'),
        description: error instanceof Error ? error.message : t('common.unknownError'),
        variant: 'error'
      })
    }
  }, [pushToast, t])

  const handleOpenEditEndpoints = useCallback((key: ApiKeySummary) => {
    setEditEndpointsKey(key)
    setEditEndpointsSelection(key.allowedEndpoints ?? [])
    setEditMaxConcurrency(key.maxConcurrency ? String(key.maxConcurrency) : '')
  }, [])

  const handleSaveEndpoints = useCallback(async () => {
    if (!editEndpointsKey) return

    try {
      await updateKeyMutation.mutateAsync({
        id: editEndpointsKey.id,
        ...(editEndpointsKey.isWildcard
          ? {}
          : { allowedEndpoints: editEndpointsSelection.length > 0 ? editEndpointsSelection : null }),
        maxConcurrency: editMaxConcurrency ? Number(editMaxConcurrency) : null
      })
      setEditEndpointsKey(null)
    } catch {
    }
  }, [editEndpointsKey, editEndpointsSelection, editMaxConcurrency, updateKeyMutation])

  const formatDate = useCallback((isoString: string | null) => {
    if (!isoString) return t('common.noData')
    return new Date(isoString).toLocaleString()
  }, [t])

  return {
    activeKeysValue,
    availableEndpoints,
    deleteTarget,
    editEndpointsKey,
    editEndpointsSelection,
    editMaxConcurrency,
    enabledKeysValue,
    filteredKeys,
    formatDate,
    handleCopyKey,
    handleCreateDialogChange,
    handleCreateKey,
    handleDeleteKey,
    handleHideKey,
    handleOpenEditEndpoints,
    handleRevealKey,
    handleSaveEndpoints,
    handleToggleEnabled,
    hasWildcard,
    isCreateDialogOpen,
    isDeleting,
    isRevealing,
    keys,
    keysQuery,
    newKeyDescription,
    newKeyEndpoints,
    newKeyName,
    newlyCreatedKey,
    rangeDays,
    requestsChartOption,
    restrictedCount,
    revealedKeys,
    search,
    setDeleteTarget,
    setEditEndpointsKey,
    setEditEndpointsSelection,
    setEditMaxConcurrency,
    setNewKeyDescription,
    setNewKeyEndpoints,
    setNewKeyName,
    setNewlyCreatedKey,
    setRangeDays,
    setSearch,
    setStatusFilter,
    statusFilter,
    tokensChartOption,
    totalKeysValue,
    unrestrictedCount,
    usage,
    usageQuery,
    wildcardCount
  }
}
