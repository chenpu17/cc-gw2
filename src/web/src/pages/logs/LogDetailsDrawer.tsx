import { useTranslation } from 'react-i18next'
import type { ApiKeySummary } from '@/types/apiKeys'
import { AppDialogBody, AppDialogContent, AppDialogHeader } from '@/components/DialogShell'
import { PageLoadingState, PageState } from '@/components/PageState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogDescription,
  DialogTitle
} from '@/components/ui/dialog'
import { useLogDetailState } from './useLogDetailState'
import { formatDateTime, formatLatency, formatNumber, formatPayloadDisplay, formatStreamLabel } from './utils'

interface LogDetailsDrawerProps {
  open: boolean
  logId: number | null
  onClose: () => void
  providerLabelMap: Map<string, string>
  apiKeyMap: Map<number, ApiKeySummary>
}

export function LogDetailsDrawer({
  open,
  logId,
  onClose,
  providerLabelMap,
  apiKeyMap
}: LogDetailsDrawerProps) {
  const { t } = useTranslation()
  const {
    apiKeyMeta,
    errorMessage,
    handleCopy,
    isError,
    isPending,
    providerLabel,
    refetch,
    record,
    statusCode
  } = useLogDetailState({
    apiKeyMap,
    logId,
    open,
    providerLabelMap
  })

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!nextOpen) onClose() }}>
      <AppDialogContent className="w-[min(96vw,1200px)] max-w-[1200px]">
        <AppDialogHeader className="pr-14">
          <DialogTitle>{t('logs.detail.title')}</DialogTitle>
          <DialogDescription>
            {record ? t('logs.detail.id', { id: record.id }) : t('logs.detail.loadError')}
          </DialogDescription>
        </AppDialogHeader>

        <AppDialogBody className="max-h-[78vh]">
          {isPending ? (
            <PageLoadingState compact className="min-h-[240px]" label={t('common.loading')} />
          ) : isError ? (
            <PageState
              compact
              className="min-h-[240px]"
              tone="danger"
              title={t('logs.detail.loadError')}
              description={errorMessage ?? t('common.unknownError')}
              action={(
                <Button variant="outline" onClick={() => void refetch()}>
                  {t('common.actions.refresh')}
                </Button>
              )}
            />
          ) : !record ? (
            <PageState
              compact
              className="min-h-[240px]"
              title={t('logs.detail.loadError')}
              description={t('common.noData')}
            />
          ) : (
            <div className="space-y-6 text-sm">
              <section className="space-y-4 rounded-[1.35rem] border border-white/50 bg-card/80 p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('logs.detail.infoSection')}
                    </h3>
                    <div className="flex flex-wrap items-center gap-2 rounded-[1.1rem] border border-border/70 bg-background/70 p-3 text-xs shadow-[0_1px_2px_rgba(15,23,42,0.03)]">
                      <span className="font-medium">
                        {t('logs.detail.summary.route', {
                          from: record.client_model ?? t('logs.detail.info.noRequestedModel'),
                          to: record.model
                        })}
                      </span>
                      <span className="text-muted-foreground">
                        {t('logs.detail.summary.latency', {
                          value: formatLatency(record.latency_ms, t('common.units.ms'))
                        })}
                      </span>
                      {record.ttft_ms !== null ? (
                        <span className="text-muted-foreground">
                          TTFT: {formatLatency(record.ttft_ms, t('common.units.ms'))}
                        </span>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={record.error ? 'destructive' : 'default'}>
                      {statusCode?.toString()}
                    </Badge>
                    <Badge variant="outline">
                      {record.stream ? t('logs.stream.streaming') : t('logs.stream.single')}
                    </Badge>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-4">
                  <DetailStatCard label={t('logs.detail.info.latency')} value={formatLatency(record.latency_ms, t('common.units.ms'))} />
                  <DetailStatCard label={t('logs.detail.info.ttft')} value={formatLatency(record.ttft_ms, t('common.units.ms'))} />
                  <DetailStatCard label={t('logs.detail.info.tpot')} value={formatLatency(record.tpot_ms, t('common.units.msPerToken'))} />
                  <DetailStatCard label={t('logs.detail.info.status')} value={statusCode?.toString() ?? '-'} />
                </div>

                <dl className="grid gap-x-4 gap-y-3 md:grid-cols-2 xl:grid-cols-4">
                  <DetailItem label={t('logs.detail.info.time')} value={formatDateTime(record.timestamp)} />
                  <DetailItem label={t('logs.detail.info.sessionId')} value={record.session_id ?? '-'} />
                  <DetailItem label={t('logs.detail.info.endpoint')} value={record.endpoint || '-'} />
                  <DetailItem label={t('logs.detail.info.provider')} value={providerLabel} />
                  <DetailItem label={t('logs.detail.info.requestedModel')} value={record.client_model ?? t('logs.detail.info.noRequestedModel')} />
                  <DetailItem label={t('logs.detail.info.model')} value={record.model} />
                  <DetailItem label={t('logs.detail.info.stream')} value={formatStreamLabel(record.stream)} />
                  <DetailItem label={t('logs.detail.info.status')} value={statusCode} />
                </dl>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <DetailStatCard label={t('logs.detail.info.inputTokens')} value={formatNumber(record.input_tokens)} />
                  <DetailStatCard label={t('logs.detail.info.cacheReadTokens')} value={formatNumber(record.cache_read_tokens)} />
                  <DetailStatCard label={t('logs.detail.info.cacheCreationTokens')} value={formatNumber(record.cache_creation_tokens)} />
                  <DetailStatCard label={t('logs.detail.info.outputTokens')} value={formatNumber(record.output_tokens)} />
                </div>

                {record.error ? (
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">{t('logs.detail.info.error')}</p>
                    <p className="rounded-[1rem] border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                      {record.error}
                    </p>
                  </div>
                ) : null}
              </section>

              <div className="grid gap-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
                <section className="space-y-3 rounded-[1.35rem] border border-white/50 bg-card/80 p-5">
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {t('logs.detail.apiKey.title')}
                  </h3>
                  <dl className="grid gap-x-4 gap-y-3 sm:grid-cols-2">
                    <DetailItem
                      label={t('logs.detail.apiKey.name')}
                      value={
                        record.api_key_id == null && !record.api_key_name
                          ? t('logs.detail.apiKey.missing')
                          : apiKeyMeta?.isWildcard
                            ? t('apiKeys.wildcard')
                            : apiKeyMeta?.name ?? record.api_key_name ?? t('logs.detail.apiKey.missing')
                      }
                    />
                    <DetailItem label={t('logs.detail.apiKey.identifier')} value={record.api_key_id ?? t('common.noData')} />
                    <DetailItem
                      label={t('logs.detail.apiKey.masked')}
                      value={
                        apiKeyMeta?.isWildcard
                          ? t('apiKeys.wildcard')
                          : apiKeyMeta?.maskedKey ?? record.api_key_name ?? t('logs.detail.apiKey.maskedUnavailable')
                      }
                    />
                    <DetailItem
                      label={t('logs.detail.apiKey.lastUsed')}
                      value={apiKeyMeta?.lastUsedAt ? new Date(apiKeyMeta.lastUsedAt).toLocaleString() : t('common.noData')}
                    />
                  </dl>
                  <div className="rounded-[1rem] border border-border/70 bg-background/70 p-3 text-xs">
                    <p className="font-medium">{t('logs.detail.apiKey.rawMasked')}</p>
                    <p className="mt-1 break-all font-mono">
                      {record.api_key_value_available
                        ? record.api_key_value_masked ?? t('logs.detail.apiKey.rawUnavailable')
                        : t('logs.detail.apiKey.rawUnavailable')}
                    </p>
                    <p className="mt-2 text-[11px] text-muted-foreground">
                      {t('logs.detail.apiKey.rawMaskedHint')}
                    </p>
                  </div>
                </section>

                <section className="space-y-4 rounded-[1.35rem] border border-white/50 bg-card/80 p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('logs.detail.payload.request')}
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(t('logs.detail.payload.request'), record.payload?.prompt, 'logs.detail.copy.requestSuccess')}
                    >
                      {t('common.actions.copy')}
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[1rem] border border-border/70 bg-background/70 p-3 text-xs">
                    {formatPayloadDisplay(record.payload?.prompt, t('logs.detail.payload.emptyRequest'))}
                  </pre>

                  <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t('logs.detail.payload.response')}
                    </h3>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopy(t('logs.detail.payload.response'), record.payload?.response, 'logs.detail.copy.responseSuccess')}
                    >
                      {t('common.actions.copy')}
                    </Button>
                  </div>
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[1rem] border border-border/70 bg-background/70 p-3 text-xs">
                    {formatPayloadDisplay(record.payload?.response, t('logs.detail.payload.emptyResponse'))}
                  </pre>
                </section>
              </div>
            </div>
          )}
        </AppDialogBody>
      </AppDialogContent>
    </Dialog>
  )
}

function DetailStatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-border/70 bg-background/60 px-3 py-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
      <p className="mt-2 text-sm font-semibold">{value}</p>
    </div>
  )
}

function DetailItem({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{value ?? '-'}</dd>
    </div>
  )
}
