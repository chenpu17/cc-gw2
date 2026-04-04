import { useCallback, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { useToast } from '@/providers/ToastProvider'
import { useApiQuery } from '@/hooks/useApiQuery'
import { usePersistentState } from '@/hooks/usePersistentState'
import { type ApiError } from '@/services/api'
import { gatewayApi, type ProviderSummary } from '@/services/gateway'
import { logsApi } from '@/services/logs'
import { queryKeys } from '@/services/queryKeys'
import { storageKeys } from '@/services/storageKeys'
import type { LogListResponse } from '@/types/logs'
import type { ApiKeySummary } from '@/types/apiKeys'
import type { CustomEndpointsResponse } from '@/types/endpoints'
import type { GatewayConfig } from '@/types/providers'
import { useLogExport } from './useLogExport'
import { useLogsTablePreferences } from './useLogsTablePreferences'
import {
  LOG_COLUMN_ORDER,
  PAGE_SIZE_OPTIONS,
  loadStoredApiKeyFilters,
  loadStoredPageSize,
  toTimestamp,
  isSameDateFilter,
  type DateInput,
  type QuickView,
  type StatusFilter
} from './shared'

export function useLogsPageState() {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const queryClient = useQueryClient()
  const [providerFilter, setProviderFilter] = usePersistentState<string>(
    storageKeys.logs.providerFilter,
    'all'
  )
  const [endpointFilter, setEndpointFilter] = usePersistentState<string>(
    storageKeys.logs.endpointFilter,
    'all'
  )
  const [modelFilter, setModelFilter] = usePersistentState<string>(
    storageKeys.logs.modelFilter,
    ''
  )
  const [statusFilter, setStatusFilter] = usePersistentState<StatusFilter>(
    storageKeys.logs.statusFilter,
    'all'
  )
  const [fromDate, setFromDate] = usePersistentState<DateInput>(
    storageKeys.logs.fromDate,
    ''
  )
  const [toDate, setToDate] = usePersistentState<DateInput>(
    storageKeys.logs.toDate,
    ''
  )
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = usePersistentState<number>(
    storageKeys.logs.pageSize,
    loadStoredPageSize,
    {
      serialize: (value) => String(value),
      deserialize: (raw) => {
        const next = Number(raw)
        return PAGE_SIZE_OPTIONS.includes(next) ? next : PAGE_SIZE_OPTIONS[0]
      }
    }
  )
  const [selectedLogId, setSelectedLogId] = useState<number | null>(null)
  const [isDetailOpen, setIsDetailOpen] = useState(false)
  const [selectedApiKeys, setSelectedApiKeys] = usePersistentState<number[]>(
    storageKeys.logs.selectedApiKeys,
    loadStoredApiKeyFilters
  )
  const [filtersExpanded, setFiltersExpanded] = usePersistentState<boolean>(
    storageKeys.logs.filtersExpanded,
    false
  )
  const {
    resetVisibleColumns,
    rowDensity,
    setRowDensity,
    showScrollHint,
    tableScrollRef,
    toggleColumn,
    visibleColumnCount,
    visibleColumns,
    visibleColumnSet
  } = useLogsTablePreferences()
  const deferredModelFilter = useDeferredValue(modelFilter)
  const appliedModelFilter = modelFilter === '' ? '' : deferredModelFilter

  useEffect(() => {
    setPage(1)
  }, [providerFilter, endpointFilter, appliedModelFilter, statusFilter, fromDate, toDate, pageSize, selectedApiKeys])

  const queryParams = useMemo(() => {
    const params: Record<string, unknown> = {
      limit: pageSize,
      offset: (page - 1) * pageSize
    }

    if (providerFilter !== 'all') {
      params.provider = providerFilter
    }
    if (endpointFilter !== 'all') {
      params.endpoint = endpointFilter
    }
    if (appliedModelFilter.trim().length > 0) {
      params.model = appliedModelFilter.trim()
    }
    if (statusFilter !== 'all') {
      params.status = statusFilter
    }

    const fromTs = toTimestamp(fromDate)
    const toTs = toTimestamp(toDate, true)
    if (fromTs !== undefined) {
      params.from = fromTs
    }
    if (toTs !== undefined) {
      params.to = toTs
    }
    if (selectedApiKeys.length > 0) {
      params.apiKeys = selectedApiKeys.join(',')
    }

    return params
  }, [appliedModelFilter, endpointFilter, fromDate, page, pageSize, providerFilter, selectedApiKeys, statusFilter, toDate])

  const logsQuery = useApiQuery<LogListResponse, ApiError>(
    queryKeys.logs.list(queryParams),
    logsApi.listRequest(queryParams),
    { gcTime: 60_000 }
  )
  const providersQuery = useApiQuery<ProviderSummary[], ApiError>(
    queryKeys.providers.all(),
    gatewayApi.providersRequest()
  )
  const apiKeysQuery = useApiQuery<ApiKeySummary[], ApiError>(
    queryKeys.apiKeys.all(),
    { url: '/api/keys', method: 'GET' }
  )
  const customEndpointsQuery = useApiQuery<CustomEndpointsResponse, ApiError>(
    queryKeys.customEndpoints.all(),
    { url: '/api/custom-endpoints', method: 'GET' }
  )
  const exportConfigQuery = useApiQuery<GatewayConfig, ApiError>(
    queryKeys.config.exportTimeout(),
    gatewayApi.configRequest()
  )

  useEffect(() => {
    if (!logsQuery.isError || !logsQuery.error) return
    pushToast({
      title: t('logs.toast.listError.title'),
      description: t('logs.toast.listError.desc', { message: logsQuery.error.message }),
      variant: 'error'
    })
  }, [logsQuery.error, logsQuery.isError, pushToast, t])

  useEffect(() => {
    if (!providersQuery.isError || !providersQuery.error) return
    pushToast({
      title: t('logs.toast.providerError.title'),
      description: t('logs.toast.providerError.desc', { message: providersQuery.error.message }),
      variant: 'error'
    })
  }, [providersQuery.error, providersQuery.isError, pushToast, t])

  const total = logsQuery.data?.total ?? 0
  const totalPages = total > 0 ? Math.ceil(total / pageSize) : 0
  const items = logsQuery.data?.items ?? []
  const exportTimeoutMs = useMemo(() => {
    const timeoutSeconds = exportConfigQuery.data?.logExportTimeoutSeconds
    if (typeof timeoutSeconds === 'number' && Number.isFinite(timeoutSeconds)) {
      const boundedSeconds = Math.min(Math.max(Math.round(timeoutSeconds), 5), 600)
      return boundedSeconds * 1000
    }
    return 60_000
  }, [exportConfigQuery.data?.logExportTimeoutSeconds])

  useEffect(() => {
    if (totalPages > 0 && page > totalPages) {
      setPage(totalPages)
    }
  }, [page, totalPages])

  const providerOptions = providersQuery.data ?? []
  const providerLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    for (const provider of providerOptions) {
      if (provider.id) {
        map.set(provider.id, provider.label ?? provider.id)
      }
    }
    return map
  }, [providerOptions])

  const endpointLabelMap = useMemo(() => {
    const map = new Map<string, string>()
    map.set('anthropic', t('logs.filters.endpointAnthropic'))
    map.set('openai', t('logs.filters.endpointOpenAI'))
    for (const endpoint of customEndpointsQuery.data?.endpoints ?? []) {
      map.set(endpoint.id, endpoint.label || endpoint.id)
    }
    return map
  }, [customEndpointsQuery.data?.endpoints, t])

  const activeFilters = useMemo(() => {
    const filters: Array<{ key: string; label: string; onRemove: () => void }> = []
    if (providerFilter !== 'all') {
      const providerLabel = providerLabelMap.get(providerFilter) ?? providerFilter
      filters.push({
        key: 'provider',
        label: `${t('logs.filters.provider')}: ${providerLabel}`,
        onRemove: () => setProviderFilter('all')
      })
    }
    if (endpointFilter !== 'all') {
      const endpointLabel = endpointLabelMap.get(endpointFilter) ?? endpointFilter
      filters.push({
        key: 'endpoint',
        label: `${t('logs.filters.endpoint')}: ${endpointLabel}`,
        onRemove: () => setEndpointFilter('all')
      })
    }
    if (appliedModelFilter.trim()) {
      filters.push({
        key: 'model',
        label: `${t('logs.filters.modelId')}: ${appliedModelFilter.trim()}`,
        onRemove: () => setModelFilter('')
      })
    }
    if (statusFilter !== 'all') {
      const statusLabel = statusFilter === 'success'
        ? t('logs.filters.statusSuccess')
        : t('logs.filters.statusError')
      filters.push({
        key: 'status',
        label: `${t('logs.filters.status')}: ${statusLabel}`,
        onRemove: () => setStatusFilter('all')
      })
    }
    if (fromDate) {
      filters.push({
        key: 'from',
        label: `${t('logs.filters.startDate')}: ${fromDate}`,
        onRemove: () => setFromDate('')
      })
    }
    if (toDate) {
      filters.push({
        key: 'to',
        label: `${t('logs.filters.endDate')}: ${toDate}`,
        onRemove: () => setToDate('')
      })
    }
    if (selectedApiKeys.length > 0) {
      filters.push({
        key: 'apiKeys',
        label: t('logs.filters.apiKeySelected', { count: selectedApiKeys.length }),
        onRemove: () => setSelectedApiKeys([])
      })
    }
    return filters
  }, [appliedModelFilter, endpointFilter, endpointLabelMap, fromDate, providerFilter, providerLabelMap, selectedApiKeys.length, statusFilter, t, toDate])

  const apiKeys = apiKeysQuery.data ?? []
  const apiKeyMap = useMemo(() => {
    const map = new Map<number, ApiKeySummary>()
    for (const key of apiKeys) {
      map.set(key.id, key)
    }
    return map
  }, [apiKeys])

  const columnOptions = useMemo(
    () => LOG_COLUMN_ORDER.map((id) => ({
      id,
      label: t(`logs.table.columns.${id}` as const)
    })),
    [t]
  )
  const todayString = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const activeQuickView = useMemo<QuickView | null>(() => {
    if (
      providerFilter === 'all' &&
      endpointFilter === 'all' &&
      appliedModelFilter.trim() === '' &&
      statusFilter === 'all' &&
      fromDate === '' &&
      toDate === '' &&
      selectedApiKeys.length === 0
    ) {
      return 'all'
    }
    if (
      statusFilter === 'error' &&
      endpointFilter === 'all' &&
      providerFilter === 'all' &&
      appliedModelFilter.trim() === '' &&
      fromDate === '' &&
      toDate === '' &&
      selectedApiKeys.length === 0
    ) {
      return 'errors'
    }
    if (
      isSameDateFilter(fromDate, toDate, todayString) &&
      endpointFilter === 'all' &&
      providerFilter === 'all' &&
      appliedModelFilter.trim() === '' &&
      statusFilter === 'all' &&
      selectedApiKeys.length === 0
    ) {
      return 'today'
    }
    if (
      endpointFilter === 'anthropic' &&
      providerFilter === 'all' &&
      appliedModelFilter.trim() === '' &&
      statusFilter === 'all' &&
      fromDate === '' &&
      toDate === '' &&
      selectedApiKeys.length === 0
    ) {
      return 'anthropic'
    }
    if (
      endpointFilter === 'openai' &&
      providerFilter === 'all' &&
      appliedModelFilter.trim() === '' &&
      statusFilter === 'all' &&
      fromDate === '' &&
      toDate === '' &&
      selectedApiKeys.length === 0
    ) {
      return 'openai'
    }
    return null
  }, [appliedModelFilter, endpointFilter, fromDate, providerFilter, selectedApiKeys.length, statusFilter, toDate, todayString])

  const handleResetFilters = useCallback(() => {
    setProviderFilter('all')
    setModelFilter('')
    setEndpointFilter('all')
    setStatusFilter('all')
    setFromDate('')
    setToDate('')
    setSelectedApiKeys([])
  }, [])

  const applyQuickView = useCallback((view: QuickView) => {
    setPage(1)
    handleResetFilters()

    if (view === 'all') return
    if (view === 'errors') {
      setStatusFilter('error')
      return
    }
    if (view === 'today') {
      setFromDate(todayString)
      setToDate(todayString)
      return
    }
    if (view === 'anthropic') {
      setEndpointFilter('anthropic')
      return
    }
    if (view === 'openai') {
      setEndpointFilter('openai')
    }
  }, [handleResetFilters, todayString])

  const { exporting, handleExport } = useLogExport({
    exportTimeoutMs,
    queryParams,
    total
  })

  const handleOpenDetail = useCallback((id: number) => {
    queryClient.removeQueries({ queryKey: ['logs', 'detail'], type: 'inactive' })
    setSelectedLogId(id)
    setIsDetailOpen(true)
  }, [queryClient])

  const handleCloseDetail = useCallback(() => {
    setIsDetailOpen(false)
  }, [])

  useEffect(() => {
    if (isDetailOpen || selectedLogId === null) {
      return
    }

    queryClient.removeQueries({ queryKey: queryKeys.logs.detail(selectedLogId), exact: true })
    setSelectedLogId(null)
  }, [isDetailOpen, queryClient, selectedLogId])

  return {
    activeFilters,
    activeQuickView,
    apiKeyMap,
    apiKeys,
    apiKeysQuery,
    applyQuickView,
    columnOptions,
    customEndpoints: customEndpointsQuery.data?.endpoints,
    endpointFilter,
    exporting,
    filtersExpanded,
    fromDate,
    handleCloseDetail,
    handleExport,
    handleOpenDetail,
    handleResetFilters,
    isDetailOpen,
    items,
    logsQuery,
    modelFilter,
    page,
    pageSize,
    providerFilter,
    providerLabelMap,
    providerOptions,
    rowDensity,
    resetVisibleColumns,
    selectedApiKeys,
    selectedLogId,
    setEndpointFilter,
    setFiltersExpanded,
    setFromDate,
    setModelFilter,
    setPage,
    setPageSize,
    setProviderFilter,
    setRowDensity,
    setSelectedApiKeys,
    setStatusFilter,
    setToDate,
    showScrollHint,
    statusFilter,
    tableScrollRef,
    toDate,
    toggleColumn,
    total,
    totalPages,
    visibleColumnCount,
    visibleColumns,
    visibleColumnSet
  }
}
