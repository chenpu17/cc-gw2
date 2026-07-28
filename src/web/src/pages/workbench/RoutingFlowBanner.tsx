import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'

/**
 * Full-width request-flow banner above the 3-column routing workspace. A
 * static illustration of how a client model request flows through the selected
 * endpoint to a forward target. Mirrors the "请求流向" strip in the mockup.
 */
export function RoutingFlowBanner({
  endpointPath,
  defaultTarget
}: {
  endpointPath: string
  defaultTarget?: string | null
}) {
  const { t } = useTranslation()
  return (
    <section
      data-testid="routing-flow-banner"
      className="flex flex-wrap items-center gap-x-3 gap-y-2 border border-border bg-card px-4 py-3 shadow-[var(--surface-shadow)]"
    >
      <span className="text-[10.5px] font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {t('workbench.flow.title')}
      </span>
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="border border-border bg-secondary px-2.5 py-1 font-mono text-[11px]">
          {t('workbench.flow.clientStep')}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="border border-border bg-secondary px-2.5 py-1 text-[11px]">
          {t('workbench.flow.endpointStep')} <span className="font-mono">{endpointPath}</span>
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="border border-primary bg-primary/5 px-2.5 py-1 text-[11px] font-semibold text-primary">
          {t('workbench.flow.matchStep')}
        </span>
        <ArrowRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        <span className="border border-border bg-secondary px-2.5 py-1 font-mono text-[11px]">
          {defaultTarget || t('workbench.flow.fallbackNote')}
        </span>
      </div>
    </section>
  )
}
