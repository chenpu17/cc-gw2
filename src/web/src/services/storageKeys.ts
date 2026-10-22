export const storageKeys = {
  themeMode: 'cc-gw-theme',
  // 风格家族(data-skin 轴),与明暗模式(cc-gw-theme)相互独立
  skin: 'cc-gw-skin',
  language: 'cc-gw-language',
  dashboard: {
    endpointFilter: 'cc-gw.dashboard.endpoint-filter',
    usageDimension: 'cc-gw.dashboard.usage-dimension',
    trendMode: 'cc-gw.dashboard.trend-mode'
  },
  logs: {
    // v3 = v2 + `cost` column (billing, v0.16); v2 value migrates on first read.
    visibleColumns: 'cc-gw.logs.visible-columns-v3',
    density: 'cc-gw.logs.density',
    pageSize: 'cc-gw.logs.page-size',
    providerFilter: 'cc-gw.logs.provider-filter',
    endpointFilter: 'cc-gw.logs.endpoint-filter',
    modelFilter: 'cc-gw.logs.model-filter',
    clientKindFilter: 'cc-gw.logs.client-kind-filter',
    sessionFilter: 'cc-gw.logs.session-filter',
    statusFilter: 'cc-gw.logs.status-filter',
    fromDate: 'cc-gw.logs.from-date',
    toDate: 'cc-gw.logs.to-date',
    selectedApiKeys: 'cc-gw.logs.selected-api-keys',
    autoRefresh: 'cc-gw.logs.auto-refresh'
  },
  apiKeys: {
    rangeDays: 'cc-gw.api-keys.range-days',
    search: 'cc-gw.api-keys.search',
    statusFilter: 'cc-gw.api-keys.status-filter',
    viewMode: 'cc-gw.api-keys.inventory-view-mode',
    activeTab: 'cc-gw.api-keys.active-tab',
    quickStartDismissed: 'cc-gw.api-keys.quick-start-dismissed'
  },
  modelManagement: {
    recentRouteTargets: 'cc-gw.model-management.recent-route-targets'
  },
  workbench: {
    providerSelection: 'cc-gw.workbench.provider-selection'
  }
} as const
