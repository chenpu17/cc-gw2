import { useTranslation } from 'react-i18next'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import type { ProviderTestResult } from './shared'

/**
 * Inline rendering of the latest connection test outcome, shared by the
 * provider drawer and the provider detail panel.
 */
export function TestResultInline({ result, className }: { result: ProviderTestResult; className?: string }) {
  const { t } = useTranslation()
  return (
    <div
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-lg px-3 py-2 text-xs',
        result.ok ? 'bg-success-bg text-success' : 'bg-destructive/10 text-destructive',
        className
      )}
    >
      <Badge variant={result.ok ? 'success' : 'destructive'} className="shrink-0">
        {result.ok ? t('workbench.testResult.success') : t('workbench.testResult.failure')}
      </Badge>
      {result.status ? <span className="shrink-0">{t('workbench.testResult.status', { status: result.status })}</span> : null}
      {result.durationMs ? (
        <span className="shrink-0">{t('workbench.testResult.duration', { duration: `${result.durationMs} ms` })}</span>
      ) : null}
      {result.message ? (
        <span className="min-w-0 truncate" title={result.message}>
          {result.message}
        </span>
      ) : null}
    </div>
  )
}
