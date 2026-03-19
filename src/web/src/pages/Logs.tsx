import { FileText } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { LogsFiltersCard } from '@/pages/logs/LogsFiltersCard'
import { LogDetailsDrawer } from '@/pages/logs/LogDetailsDrawer'
import { LogsPageActions } from '@/pages/logs/LogsPageActions'
import { LogsTableCard } from '@/pages/logs/LogsTableCard'
import { useLogsPageState } from '@/pages/logs/useLogsPageState'

export default function LogsPage() {
  const { t } = useTranslation()
  const state = useLogsPageState()

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<FileText className="h-5 w-5" aria-hidden="true" />}
        title={t('logs.title')}
        description={t('logs.description')}
        eyebrow="Traffic Explorer"
        breadcrumb="Gateway / Logs"
        helper={t('logs.filtersDescription')}
        badge={state.total > 0 ? t('logs.summary.total', { value: state.total.toLocaleString() }) : undefined}
        actions={
          <LogsPageActions
            columnOptions={state.columnOptions}
            exporting={state.exporting}
            onExport={() => void state.handleExport()}
            onRefresh={() => void state.logsQuery.refetch()}
            onResetColumns={state.resetVisibleColumns}
            onSetDensity={state.setRowDensity}
            onToggleColumn={state.toggleColumn}
            refreshing={state.logsQuery.isFetching}
            rowDensity={state.rowDensity}
            total={state.total}
            visibleColumns={state.visibleColumns}
            visibleColumnSet={state.visibleColumnSet}
          />
        }
      />

      <LogsFiltersCard
        total={state.total}
        activeFilters={state.activeFilters}
        filtersExpanded={state.filtersExpanded}
        setFiltersExpanded={state.setFiltersExpanded}
        handleResetFilters={state.handleResetFilters}
        activeQuickView={state.activeQuickView}
        applyQuickView={state.applyQuickView}
        providerFilter={state.providerFilter}
        setProviderFilter={state.setProviderFilter}
        endpointFilter={state.endpointFilter}
        setEndpointFilter={state.setEndpointFilter}
        selectedApiKeys={state.selectedApiKeys}
        setSelectedApiKeys={state.setSelectedApiKeys}
        modelFilter={state.modelFilter}
        setModelFilter={state.setModelFilter}
        statusFilter={state.statusFilter}
        setStatusFilter={state.setStatusFilter}
        fromDate={state.fromDate}
        setFromDate={state.setFromDate}
        toDate={state.toDate}
        setToDate={state.setToDate}
        providerOptions={state.providerOptions}
        apiKeys={state.apiKeys}
        apiKeysLoading={state.apiKeysQuery.isLoading}
        customEndpoints={state.customEndpoints}
      />

      <LogsTableCard
        tableScrollRef={state.tableScrollRef}
        visibleColumnSet={state.visibleColumnSet}
        visibleColumnCount={state.visibleColumnCount}
        logsError={state.logsQuery.isError ? state.logsQuery.error?.message ?? null : null}
        logsPending={state.logsQuery.isPending}
        items={state.items}
        activeFiltersCount={state.activeFilters.length}
        handleResetFilters={state.handleResetFilters}
        handleRetry={() => void state.logsQuery.refetch()}
        providerLabelMap={state.providerLabelMap}
        apiKeyMap={state.apiKeyMap}
        handleOpenDetail={state.handleOpenDetail}
        rowDensity={state.rowDensity}
        showScrollHint={state.showScrollHint}
        pageSize={state.pageSize}
        setPageSize={state.setPageSize}
        page={state.page}
        totalPages={state.totalPages}
        setPage={state.setPage}
      />

      <LogDetailsDrawer
        open={state.isDetailOpen}
        logId={state.selectedLogId}
        onClose={state.handleCloseDetail}
        providerLabelMap={state.providerLabelMap}
        apiKeyMap={state.apiKeyMap}
      />
    </div>
  )
}
