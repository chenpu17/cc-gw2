import { useTranslation } from 'react-i18next'
import { Disclosure } from '@/components/ui/disclosure'
import { cn } from '@/lib/utils'
import type { ErrorDetail } from './utils'

/**
 * Expansion for `error_detail` — the extended error context captured
 * independent of payload storage: failure stage, the full (unsanitized)
 * error chain, the aggregate failover attempt chain, and a truncated
 * upstream response body. `compact` renders the slim inline-table variant.
 */
export function ErrorDetailBlock({ detail, compact = false }: { detail: ErrorDetail; compact?: boolean }) {
  const { t } = useTranslation()

  const stageLabel = (stage: string): string =>
    t(`logs.detail.errorDetail.stages.${stage}`, { defaultValue: stage })

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      {detail.stage ? (
        <span className="border border-border bg-secondary px-1.5 py-0.5 text-[11px] font-medium text-foreground">
          {stageLabel(detail.stage)}
        </span>
      ) : null}
      {detail.upstreamStatus != null ? (
        <span className="border border-destructive/40 bg-destructive/10 px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-destructive">
          HTTP {detail.upstreamStatus}
        </span>
      ) : null}
      {detail.failoverAttempts?.length ? (
        <span className="text-[11px] text-muted-foreground">
          {t('logs.detail.errorDetail.attemptsCount', { count: detail.failoverAttempts.length })}
        </span>
      ) : null}
    </div>
  )

  const attempts = detail.failoverAttempts ?? []

  return (
    <Disclosure
      defaultOpen
      summaryClassName="px-1 py-1"
      contentClassName={cn('mt-1 space-y-2', compact && 'text-[11px]')}
      summary={
        <span className={cn('text-xs font-medium text-foreground', compact && 'text-[11px]')}>
          {t('logs.detail.errorDetail.title')}
        </span>
      }
    >
      <div className="space-y-2" data-testid="log-error-detail">
        {header}

        {detail.message ? (
          <p
            className={cn(
              'whitespace-pre-wrap break-all border-l-2 border-destructive/50 bg-destructive/5 px-2.5 py-1.5 font-mono',
              compact ? 'text-[10.5px] leading-[1.55]' : 'text-[11px] leading-[1.6]'
            )}
          >
            {detail.message}
          </p>
        ) : null}

        {attempts.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead>
                <tr className="border-b border-border text-left text-muted-foreground">
                  <th className="py-1 pr-3 font-medium">{t('logs.detail.errorDetail.attemptBackend')}</th>
                  <th className="py-1 pr-3 font-medium">{t('logs.detail.errorDetail.attemptOutcome')}</th>
                  <th className="py-1 pr-3 text-right font-medium">{t('logs.detail.errorDetail.attemptStatus')}</th>
                  <th className="py-1 text-right font-medium">{t('logs.detail.errorDetail.attemptLatency')}</th>
                </tr>
              </thead>
              <tbody className="tabular-nums">
                {attempts.map((attempt, index) => (
                  <tr key={index} className="border-b border-border/50 last:border-b-0">
                    <td className="py-1 pr-3">
                      <span className="font-medium">{attempt.provider ?? '—'}</span>
                      <span className="text-muted-foreground"> / {attempt.model ?? '—'}</span>
                    </td>
                    <td className="py-1 pr-3 text-muted-foreground">{attempt.outcome ?? '—'}</td>
                    <td className="py-1 pr-3 text-right">
                      {attempt.status != null ? (
                        <span className={attempt.status >= 400 ? 'text-destructive' : 'text-foreground'}>
                          {attempt.status}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="py-1 text-right text-muted-foreground">
                      {attempt.latencyMs != null ? `${attempt.latencyMs} ms` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {detail.upstreamBody ? (
          <div className="space-y-0.5">
            <p className={cn('text-muted-foreground', compact ? 'text-[10.5px]' : 'text-[11px]')}>
              {t('logs.detail.errorDetail.upstreamBody')}
            </p>
            <pre
              className={cn(
                'm-0 max-h-[180px] overflow-auto whitespace-pre-wrap border border-border bg-secondary/50 p-2 font-mono text-muted-foreground',
                compact ? 'text-[10.5px] leading-[1.55]' : 'text-[11px] leading-[1.6]'
              )}
            >
              {detail.upstreamBody}
            </pre>
          </div>
        ) : null}
      </div>
    </Disclosure>
  )
}
