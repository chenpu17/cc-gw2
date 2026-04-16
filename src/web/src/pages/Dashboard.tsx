import { AlertTriangle, BarChart3, Database, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageHeader } from '@/components/PageHeader'
import { PageState } from '@/components/PageState'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import {
  DashboardChartsGrid,
  DashboardGettingStarted,
  DashboardInsightsGrid,
  DashboardLoading,
  GatewayStatusBar,
  ModelMetricsTable,
  MonitoringGrid,
  RecentRequestsTable
} from './dashboard/DashboardSections'
import { useDashboardPageState } from './dashboard/useDashboardPageState'

export default function DashboardPage() {
  const { t } = useTranslation()
  const state = useDashboardPageState()
  const showGettingStarted = state.recentLogs.length === 0 || state.models.length === 0

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        icon={<BarChart3 className="h-5 w-5" aria-hidden="true" />}
        title={t('nav.dashboard')}
        description={t('dashboard.description')}
        badge={state.selectedEndpointLabel}
        eyebrow="Operations"
        breadcrumb="Gateway / Dashboard"
        helper={t('dashboard.charts.requestsDesc')}
        actions={
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            <div className="text-xs text-muted-foreground/60">
              {t('dashboard.filters.endpoint')}
              {' · '}
              {state.selectedEndpointLabel}
            </div>
            <Select value={state.endpointFilter} onValueChange={state.setEndpointFilter}>
              <SelectTrigger className="w-full sm:w-[168px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t('dashboard.filters.endpointAll')}</SelectItem>
                <SelectItem value="anthropic">{t('dashboard.filters.endpointAnthropic')}</SelectItem>
                <SelectItem value="openai">{t('dashboard.filters.endpointOpenAI')}</SelectItem>
                {state.customEndpoints.map((endpoint) => (
                  <SelectItem key={endpoint.id} value={endpoint.id}>
                    {endpoint.label || endpoint.id}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={() => void state.handleRefresh()} disabled={state.isRefreshing} className="w-full sm:w-auto">
              <RefreshCw className={cn('mr-2 h-4 w-4', state.isRefreshing && 'animate-spin')} aria-hidden="true" />
              {state.isRefreshing ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => void state.handleCompact()} disabled={state.compacting} className="w-full sm:w-auto">
              <Database className="mr-2 h-4 w-4" aria-hidden="true" />
              {state.compacting ? t('dashboard.actions.compacting') : t('dashboard.actions.compact')}
            </Button>
          </div>
        }
      />

      {state.isBootstrapping ? (
        <DashboardLoading />
      ) : state.bootstrapError ? (
        <PageState
          icon={<AlertTriangle className="h-5 w-5" aria-hidden="true" />}
          tone="danger"
          title={t('common.status.error')}
          description={state.bootstrapError}
          action={(
            <Button variant="outline" onClick={() => void state.handleRefresh()}>
              {t('common.actions.refresh')}
            </Button>
          )}
        />
      ) : (
        <>
          <GatewayStatusBar
            selectedEndpointLabel={state.selectedEndpointLabel}
            status={state.status}
            todayRequests={state.overview?.today.requests ?? 0}
          />

          {showGettingStarted ? (
            <DashboardGettingStarted
              endpointCount={state.customEndpoints.length}
              providerCount={state.status?.providers ?? 0}
              selectedEndpointLabel={state.selectedEndpointLabel}
            />
          ) : null}

          <MonitoringGrid
            dbSizeDisplay={state.dbSizeDisplay}
            memoryDisplay={state.memoryDisplay}
            overview={state.overview}
            status={state.status}
          />

          <DashboardInsightsGrid
            busiestDay={state.busiestDay}
            fastestTtftModel={state.fastestTtftModel}
            topModel={state.topModel}
            totalRequestsInRange={state.totalRequestsInRange}
          />

          <DashboardChartsGrid
            dailyEmpty={!state.daily.length}
            dailyOption={state.dailyOption}
            dailyPending={state.dailyPending}
            models={state.models}
            modelRequestsOption={state.modelRequestsOption}
            modelUsagePending={state.modelUsagePending}
            ttftOption={state.ttftOption}
            tpotOption={state.tpotOption}
          />

          <ModelMetricsTable models={state.models} loading={state.modelUsagePending} />
          <RecentRequestsTable records={state.recentLogs} loading={state.latestLogsPending} />
        </>
      )}
    </div>
  )
}
