import { AlertTriangle, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { PageToolbar } from '@/components/PageToolbar'
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
  AttentionAllClear,
  AttentionFeed,
  DashboardGettingStarted,
  DashboardLoading,
  InfraDisclosure,
  PerformanceDisclosure,
  RecentRequestsTable,
  SetupProgressStrip,
  StatusBand,
  TrendChart
} from './dashboard/DashboardSections'
import { useDashboardPageState, SETUP_TOTAL_STEPS } from './dashboard/useDashboardPageState'
import { formatBytes } from './dashboard/types'

export default function DashboardPage() {
  const { t } = useTranslation()
  const state = useDashboardPageState()

  const dbSizeDisplay = state.dbInfo ? formatBytes(state.dbInfo.totalBytes ?? state.dbInfo.sizeBytes) : '-'
  const memoryDisplay = formatBytes(state.dbInfo?.memoryRssBytes)

  return (
    <div className="flex flex-col gap-6">
      <PageToolbar
        actions={
          <>
            <Select value={state.endpointFilter} onValueChange={state.setEndpointFilter}>
              <SelectTrigger className="h-8 w-[168px]">
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
            <Button variant="outline" size="sm" onClick={() => void state.handleRefresh()} disabled={state.isRefreshing}>
              <RefreshCw className={cn('mr-2 h-4 w-4', state.isRefreshing && 'animate-spin')} aria-hidden="true" />
              {state.isRefreshing ? t('common.actions.refreshing') : t('common.actions.refresh')}
            </Button>
          </>
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
          {/* Cold-start guide: visible until provider + route + API key + first request are all done */}
          {!state.setupComplete ? (
            <DashboardGettingStarted
              endpointCount={state.customEndpoints.length}
              providerCount={state.status?.providers ?? 0}
            />
          ) : null}

          {/* Layer 1 — live status */}
          <StatusBand status={state.status} />

          {!state.setupComplete ? (
            <SetupProgressStrip doneCount={state.setupDoneCount} total={SETUP_TOTAL_STEPS} />
          ) : null}

          {/* Layer 2 — trends & details */}
          <TrendChart
            empty={!state.daily.length}
            loading={state.summaryPending}
            option={state.trendOption}
          />

          <PerformanceDisclosure
            modelRequestsOption={state.modelRequestsOption}
            models={state.models}
            ttftOption={state.ttftOption}
            tpotOption={state.tpotOption}
          />

          <InfraDisclosure
            compacting={state.compacting}
            dbInfo={state.dbInfo}
            dbSizeDisplay={dbSizeDisplay}
            memoryDisplay={memoryDisplay}
            onCompact={() => void state.handleCompact()}
            status={state.status}
          />

          <RecentRequestsTable records={state.recentLogs} loading={state.summaryPending} />

          {/* Layer 3 — attention: full feed while warn/error events exist, slim all-clear strip otherwise */}
          {state.attentionEvents.length > 0 ? (
            <AttentionFeed connected={state.liveConnected} failed={state.liveFailed} events={state.attentionEvents} />
          ) : (
            <AttentionAllClear connected={state.liveConnected} failed={state.liveFailed} />
          )}
        </>
      )}
    </div>
  )
}
