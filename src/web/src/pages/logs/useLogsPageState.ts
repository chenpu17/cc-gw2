import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
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
  loadStoredPageSize,
  toTimestamp,
  isSameDateFilter,
  type DateInput,
  type QuickView,
  type StatusFilter
} from './shared'

const AUTO_REFRESH_INTERVAL_MS = 3_000
// Only auto-scroll back to the top when the user is already near the top,
// so polling never yanks the page away from someone reading older rows.
const AUTO_SCROLL_TOP_THRESHOLD_PX = 200

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
  const [clientKindFilter, setClientKindFilter] = usePersistentState<string>(
    storageKeys.logs.clientKindFilter,
    'all'
  )
  const [sessionFilter, setSessionFilter] = usePersistentState<string>(
    storageKeys.logs.sessionFilter,
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
  const [autoRefresh, setAutoRefresh] = usePersistentState<boolean>(
    storageKeys.logs.autoRefresh,
    true
  )
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
  const [expandedLogId, setExpandedLogId] = useState<number | null>(null)
  // Auto-refresh only while the user is at the top of the list: prepending
  // rows mid-read shifts content under the cursor every 3s.
  const [scrolledAwayFromTop, setScrolledAwayFromTop] = useState(false)

  useEffect(() => {
    // The console scrolls inside the app shell (`app-scroll`), not the window:
    // window.scrollY stays 0 there, so listening to it never paused refresh.
    const scroller = document.querySelector<HTMLElement>('[data-testid="app-scroll"]')
    const scrollTop = () => (scroller ? scroller.scrollTop : window.scrollY)
    const onScroll = () => {
      setScrolledAwayFromTop(scrollTop() >= AUTO_SCROLL_TOP_THRESHOLD_PX)
    }
    onScroll()
    const target: EventTarget = scroller ?? window
    target.addEventListener('scroll', onScroll, { passive: true })
    return () => target.removeEventListener('scroll', onScroll)
  }, [])
  const [selectedApiKeys, setSelectedApiKeys] = usePersistentState<number[]>(
    storageKeys.logs.selectedApiKeys,
    [],
    {
      serialize: JSON.stringify,
      deserialize: (raw) => {
        try {
          const parsed = JSON.parse(raw)
          if (!Array.isArray(parsed)) return []
          return parsed
            .map((value) => Number(value))
            .filter((value) => Number.isInteger(value) && value > 0)
        } catch {
          return []
        }
      }
    }
  )
  // Advanced filters default to expanded; the toggle is session-only (not persisted).
  // Narrow screens start with the filter grid collapsed so the first screen
  // shows the request list, not eight controls.
  const [filtersExpanded, setFiltersExpanded] = useState(
    () => typeof window === 'undefined' || window.matchMedia('(min-width: 768px)').matches
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
  const [searchParams, setSearchParams] = useSearchParams()
  // One-shot: dashboard and event deep links seed the filters once, then the
  // params are stripped so a later reload does not resurrect a stale scope
  // over whatever the user has since changed (filters persist in storage).
  const urlFiltersAppliedRef = useRef(false)
  useEffect(() => {
    if (urlFiltersAppliedRef.current) return
    const keys = ['status', 'endpoint', 'provider', 'model', 'clientKind', 'session', 'from', 'to'] as const
    if (!keys.some((key) => searchParams.has(key))) return
    urlFiltersAppliedRef.current = true

    // A deep link describes a complete scope ("failed requests on this
    // endpoint"), so start from a clean slate instead of intersecting with
    // whatever filters happened to persist from the previous visit.
    setProviderFilter('all')
    setEndpointFilter('all')
    setModelFilter('')
    setClientKindFilter('all')
    setSessionFilter('')
    setStatusFilter('all')
    setFromDate('')
    setToDate('')
    setSelectedApiKeys([])

    const status = searchParams.get('status')
    if (status === 'success' || status === 'error') {
      setStatusFilter(status)
    }
    const endpoint = searchParams.get('endpoint')
    if (endpoint) setEndpointFilter(endpoint)
    const provider = searchParams.get('provider')
    if (provider) setProviderFilter(provider)
    const model = searchParams.get('model')
    if (model) setModelFilter(model)
    const clientKind = searchParams.get('clientKind')
    if (clientKind) setClientKindFilter(clientKind)
    const session = searchParams.get('session')
    if (session) setSessionFilter(session)
    const from = searchParams.get('from')
    if (from) setFromDate(from)
    const to = searchParams.get('to')
    if (to) setToDate(to)

    const next = new URLSearchParams(searchParams)
    for (const key of keys) next.delete(key)
    setSearchParams(next, { replace: true })
  }, [
    searchParams,
    setClientKindFilter,
    setEndpointFilter,
    setFromDate,
    setModelFilter,
    setProviderFilter,
    setSearchParams,
    setSelectedApiKeys,
    setSessionFilter,
    setStatusFilter,
    setToDate
  ])

  const deferredModelFilter = useDeferredValue(modelFilter)
  const appliedModelFilter = modelFilter === '' ? '' : deferredModelFilter
  const deferredSessionFilter = useDeferredValue(sessionFilter)
  const appliedSessionFilter = sessionFilter === '' ? '' : deferredSessionFilter

  useEffect(() => {
    setPage(1)
    setExpandedLogId(null)
  }, [providerFilter, endpointFilter, appliedModelFilter, clientKindFilter, appliedSessionFilter, statusFilter, fromDate, toDate, pageSize, selectedApiKeys])

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
    if (clientKindFilter !== 'all') {
      params.clientKind = clientKindFilter
    }
    if (appliedSessionFilter.trim().length > 0) {
      params.session = appliedSessionFilter.trim()
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
  }, [appliedModelFilter, appliedSessionFilter, clientKindFilter, endpointFilter, fromDate, page, pageSize, providerFilter, selectedApiKeys, statusFilter, toDate])

  const logsQuery = useApiQuery<LogListResponse, ApiError>(
    queryKeys.logs.list(queryParams),
    logsApi.listRequest(queryParams),
    {
      gcTime: 60_000,
      // Poll only on the first page (newest logs live there); paging through
      // history stays stable instead of jumping on every refresh. Pause while
      // a row is expanded or the detail drawer is open so the panel under the
      // user does not shift mid-read.
      refetchInterval:
        autoRefresh && page === 1 && expandedLogId === null && !isDetailOpen && !scrolledAwayFromTop
          ? AUTO_REFRESH_INTERVAL_MS
          : false
    }
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
  /** Display currency of per-record cost fields (billing, v0.16). */
  const costCurrency = logsQuery.data?.cost_currency
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
    if (clientKindFilter !== 'all') {
      filters.push({
        key: 'clientKind',
        label: `${t('logs.filters.clientKind')}: ${t(`dashboard.usage.clientKinds.${clientKindFilter}`, { defaultValue: clientKindFilter })}`,
        onRemove: () => setClientKindFilter('all')
      })
    }
    if (appliedSessionFilter.trim()) {
      filters.push({
        key: 'session',
        label: `${t('logs.filters.session')}: ${appliedSessionFilter.trim()}`,
        onRemove: () => setSessionFilter('')
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
  }, [appliedModelFilter, appliedSessionFilter, clientKindFilter, endpointFilter, endpointLabelMap, fromDate, providerFilter, providerLabelMap, selectedApiKeys.length, statusFilter, t, toDate])

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
  // Local-calendar "today" so the quick view matches what a native
  // <input type="date"> would select in this timezone. toISOString() would
  // shift non-UTC users onto yesterday around midnight.
  const todayString = useMemo(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  }, [])

  const activeQuickView = useMemo<QuickView | null>(() => {
    // Client-kind and session filters are orthogonal to every preset; while
    // either is set no quick view can claim the current state.
    const hasExtras = clientKindFilter !== 'all' || appliedSessionFilter.trim() !== ''
    if (hasExtras) {
      return null
    }
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
  }, [appliedModelFilter, appliedSessionFilter, clientKindFilter, endpointFilter, fromDate, providerFilter, selectedApiKeys.length, statusFilter, toDate, todayString])

  const handleResetFilters = useCallback(() => {
    setProviderFilter('all')
    setModelFilter('')
    setClientKindFilter('all')
    setSessionFilter('')
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

  const handleToggleExpand = useCallback((id: number) => {
    setExpandedLogId((current) => (current === id ? null : id))
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
    autoRefresh,
    clientKindFilter,
    columnOptions,
    customEndpoints: customEndpointsQuery.data?.endpoints,
    endpointFilter,
    exporting,
    expandedLogId,
    filtersExpanded,
    fromDate,
    handleCloseDetail,
    handleExport,
    handleOpenDetail,
    handleResetFilters,
    handleToggleExpand,
    isDetailOpen,
    items,
    costCurrency,
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
    sessionFilter,
    setAutoRefresh,
    setClientKindFilter,
    setEndpointFilter,
    setFiltersExpanded,
    setFromDate,
    setModelFilter,
    setPage,
    setPageSize,
    setProviderFilter,
    setRowDensity,
    setSelectedApiKeys,
    setSessionFilter,
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
