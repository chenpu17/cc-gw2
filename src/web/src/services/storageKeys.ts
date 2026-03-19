export const storageKeys = {
  themeMode: 'cc-gw-theme',
  language: 'cc-gw-language',
  dashboard: {
    endpointFilter: 'cc-gw.dashboard.endpoint-filter'
  },
  logs: {
    visibleColumns: 'cc-gw.logs.visible-columns',
    density: 'cc-gw.logs.density',
    pageSize: 'cc-gw.logs.page-size',
    filtersExpanded: 'cc-gw.logs.filters-expanded',
    providerFilter: 'cc-gw.logs.provider-filter',
    endpointFilter: 'cc-gw.logs.endpoint-filter',
    modelFilter: 'cc-gw.logs.model-filter',
    statusFilter: 'cc-gw.logs.status-filter',
    fromDate: 'cc-gw.logs.from-date',
    toDate: 'cc-gw.logs.to-date',
    selectedApiKeys: 'cc-gw.logs.selected-api-keys'
  },
  apiKeys: {
    rangeDays: 'cc-gw.api-keys.range-days',
    search: 'cc-gw.api-keys.search',
    statusFilter: 'cc-gw.api-keys.status-filter'
  }
} as const
